#![expect(clippy::print_stderr, clippy::cast_precision_loss, clippy::use_debug)]

use crate::cli::{Args, Command, EntailmentProfile};
use crate::rdf_response::RdfResponseFormat;
use crate::service_description::{EndpointKind, generate_service_description};
use anyhow::{Context, bail, ensure};
use clap::Parser;
use flate2::read::MultiGzDecoder;
use oxhttp::Server;
use oxhttp::model::header::{
    ACCEPT, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_REQUEST_HEADERS, ACCESS_CONTROL_REQUEST_METHOD,
    ALLOW, CONTENT_TYPE, ORIGIN,
};
use oxhttp::model::uri::{Authority, PathAndQuery, Scheme};
use oxhttp::model::{Body, HeaderValue, Method, Request, Response, StatusCode, Uri};
use oxigraph::io::{
    DocumentLoader, JsonLdProfileSet, RdfFormat, RdfParseError, RdfParser, RdfSerializer,
};
use oxigraph::model::{GraphName, IriParseError, NamedNode, NamedOrBlankNode, RdfVersion};
use oxigraph::sparql::results::{QueryResultsFormat, QueryResultsSerializer};
use oxigraph::sparql::{
    CancellationToken, QueryEntailment, QueryEntailmentOptions, QueryResults, SparqlEvaluator,
    SparqlVersion as LibrarySparqlVersion,
};
use oxigraph::store::{BulkLoader, LoaderError, Store};
use oxiri::{Iri, IriRef};
use oxstr::OxString;
use rayon_core::ThreadPoolBuilder;
use std::cell::RefCell;
use std::cmp::{max, min};
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "linux")]
use std::env;
use std::ffi::OsStr;
use std::fs::File;
use std::io::{self, BufWriter, Read, Write, stdin, stdout};
use std::net::ToSocketAddrs;
#[cfg(target_os = "linux")]
use std::os::unix::net::UnixDatagram;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::available_parallelism;
use std::time::{Duration, Instant};
use std::{fmt, fs, str, thread};
use url::form_urlencoded;

mod cli;
mod graph_store;
#[cfg(test)]
mod graph_store_http_tests;
#[cfg(test)]
mod graph_store_read_only_tests;
mod http_validators;
mod multipart;
mod operations;
#[cfg(test)]
mod protocol_wire_tests;
mod rdf_response;
mod service_description;
#[cfg(test)]
mod simple_query_tests;
#[cfg(test)]
mod wire_http_tests;

const MAX_HTTP_BODY_SIZE: u64 = 1024 * 1024 * 128; // 128MB
const HTTP_TIMEOUT: Duration = Duration::from_secs(60);
#[cfg(test)]
static HTTP_TEST_BIND_LOCK: Mutex<()> = Mutex::new(());
const HTML_ROOT_PAGE: &str = include_str!("../templates/query.html");
#[expect(clippy::large_include_file)]
const YASGUI_JS: &str = include_str!("../templates/yasgui/yasgui.min.js");
const YASGUI_CSS: &str = include_str!("../templates/yasgui/yasgui.min.css");
const LOGO: &str = include_str!("../logo.svg");

impl From<EntailmentProfile> for QueryEntailment {
    fn from(value: EntailmentProfile) -> Self {
        match value {
            EntailmentProfile::Simple => Self::Simple,
            EntailmentProfile::Rdf12Finite => Self::Rdf12Finite,
            EntailmentProfile::Rdfs12Finite => Self::Rdfs12Finite,
            EntailmentProfile::Owl2RlRdfBounded => Self::Owl2RlRdfBounded,
        }
    }
}

pub fn main() -> anyhow::Result<()> {
    let matches = Args::parse();
    match matches.command {
        Command::Serve {
            location,
            bind,
            admin_bind,
            cors,
            union_default_graph,
            entailment,
            timeout_s,
        } => serve(
            if let Some(location) = location {
                Store::open(location)
            } else {
                Store::new()
            }?,
            &bind,
            admin_bind,
            false,
            cors,
            union_default_graph,
            entailment.into(),
            timeout_s,
        ),
        Command::ServeReadOnly {
            location,
            bind,
            admin_bind,
            cors,
            union_default_graph,
            entailment,
            timeout_s,
        } => serve(
            Store::open_read_only(location)?,
            &bind,
            admin_bind,
            true,
            cors,
            union_default_graph,
            entailment.into(),
            timeout_s,
        ),
        Command::Backup {
            location,
            destination,
            with_receipt,
        } => {
            let store = Store::open_read_only(location)?;
            if with_receipt {
                let receipt = store
                    .backup_with_receipt(destination, &oxigraph::store::BackupOptions::default())?;
                writeln!(
                    stdout().lock(),
                    "backup_complete=true files={} quads={}",
                    receipt.files().len(),
                    receipt.contents().quads()
                )?;
            } else {
                store.backup(destination)?;
            }
            Ok(())
        }
        Command::VerifyBackup { location } => {
            let receipt = oxigraph::store::BackupReceipt::verify(
                location,
                &oxigraph::store::TransactionStartControl::new(),
            )?;
            writeln!(
                stdout().lock(),
                "backup_verified=true files={} quads={}",
                receipt.files().len(),
                receipt.contents().quads()
            )?;
            Ok(())
        }
        Command::Restore {
            backup,
            destination,
            max_backup_age_ms,
            max_restore_time_ms,
        } => {
            use oxigraph::store::{
                BackupReceipt, GovernanceTime, RecoveryBaseline, RestoreOptions,
            };
            let mut options = RestoreOptions::default();
            if let (Some(age), Some(duration)) = (max_backup_age_ms, max_restore_time_ms) {
                let receipt = BackupReceipt::verify(&backup, &options.control)?;
                options.baseline = Some(RecoveryBaseline::new(
                    &receipt,
                    GovernanceTime::now()?,
                    Duration::from_millis(age),
                    Duration::from_millis(duration),
                )?);
            }
            let receipt = match Store::restore_backup(backup, destination, &options) {
                Err(oxigraph::store::RestoreError::RestoreDurationExceeded { observation }) => {
                    anyhow::bail!(
                        "restore_complete=false restore_ms={} max_restore_ms={}; no completion marker published",
                        observation.restore_duration().as_millis(),
                        observation
                            .baseline()
                            .map_or(0, |baseline| baseline.max_restore_duration().as_millis())
                    );
                }
                result => result?,
            };
            let (youngest, oldest) = receipt.checkpoint_age_range();
            let mut output = stdout().lock();
            write!(
                output,
                "restore_complete=true quads={} outbox_records={} restore_ms={} checkpoint_age_min_ms={} checkpoint_age_max_ms={} baseline={}",
                receipt.backup().contents().quads(),
                receipt.validated_outbox_records(),
                receipt.restore_duration().as_millis(),
                youngest.as_millis(),
                oldest.as_millis(),
                if receipt.baseline().is_some() {
                    "met"
                } else {
                    "unconfigured"
                }
            )?;
            write!(output, " backup_fingerprint=")?;
            for byte in receipt.backup().fingerprint() {
                write!(output, "{byte:02x}")?;
            }
            if let Some(baseline) = receipt.baseline() {
                write!(output, " baseline_fingerprint=")?;
                for byte in baseline.fingerprint() {
                    write!(output, "{byte:02x}")?;
                }
            }
            writeln!(output)?;
            Ok(())
        }
        Command::Load {
            location,
            file,
            non_atomic,
            lenient,
            format,
            base,
            graph,
            fail_on_named_graphs,
        } => {
            let store = Store::open(&location)?;
            let format = if let Some(format) = format {
                Some(rdf_format_from_name(&format)?)
            } else {
                None
            };
            let graph = if let Some(iri) = &graph {
                Some(
                    NamedNode::new(OxString::new_owned(iri))
                        .with_context(|| format!("The target graph name {iri} is invalid"))?,
                )
            } else {
                None
            };
            if !lenient {
                eprintln!(
                    "Some files like Wikidata dumps contain invalid IRIs or language tags. If you want to load them anyway use the `--lenient` option."
                );
            }
            #[expect(clippy::cast_precision_loss)]
            if file.is_empty() {
                // We read from stdin
                let start = Instant::now();
                let mut loader = store.bulk_loader().on_progress(move |size| {
                    let elapsed = start.elapsed();
                    eprintln!(
                        "{size} triples loaded in {}s ({} t/s)",
                        elapsed.as_secs(),
                        ((size as f64) / elapsed.as_secs_f64()).round()
                    )
                });
                if non_atomic {
                    loader = loader.without_atomicity();
                }
                if lenient {
                    loader = loader.on_parse_error(move |e| {
                        eprintln!("Parsing error: {e}");
                        Ok(())
                    })
                }
                bulk_load_read(
                    &mut loader,
                    stdin().lock(),
                    format.context("The --format option must be set when loading from stdin")?,
                    base.as_deref(),
                    graph,
                    lenient,
                    fail_on_named_graphs,
                )?;
                loader.commit()?;
            } else {
                parallel_bulk_load_files(
                    &store,
                    file,
                    format,
                    base.as_deref(),
                    graph.as_ref(),
                    non_atomic,
                    lenient,
                    fail_on_named_graphs,
                )?;
            }
            eprintln!(
                "If you plan to run a read-heavy workload, consider running `oxigraph optimize -l {}` before",
                location.display()
            );
            Ok(())
        }
        Command::Dump {
            location,
            file,
            format,
            graph,
        } => {
            let store = Store::open_read_only(location)?;
            let format = if let Some(format) = format {
                rdf_format_from_name(&format)?
            } else if let Some(file) = &file {
                rdf_format_from_path(file)?
            } else {
                bail!("The --format option must be set when writing to stdout")
            };
            let graph = if let Some(graph) = &graph {
                Some(if graph.eq_ignore_ascii_case("default") {
                    GraphName::DefaultGraph
                } else {
                    NamedNode::new(OxString::new_owned(graph))
                        .with_context(|| format!("The target graph name {graph} is invalid"))?
                        .into()
                })
            } else {
                None
            };
            if let Some(file) = file {
                close_file_writer(dump(
                    &store,
                    BufWriter::new(File::create(file)?),
                    format,
                    graph.as_ref(),
                )?)?;
            } else {
                dump(&store, stdout().lock(), format, graph.as_ref())?.flush()?;
            }
            Ok(())
        }
        Command::Query {
            location,
            query,
            query_file,
            query_base,
            results_file,
            results_format,
            explain,
            explain_file,
            stats,
            union_default_graph,
            entailment,
        } => {
            let query = if let Some(query) = query {
                query
            } else if let Some(query_file) = query_file {
                fs::read_to_string(&query_file).with_context(|| {
                    format!("Not able to read query file {}", query_file.display())
                })?
            } else {
                io::read_to_string(stdin().lock())?
            };
            let store = Store::open_read_only(location)?;
            let mut evaluator = SparqlEvaluator::new();
            if let Some(base) = query_base {
                evaluator = evaluator.with_base_iri(&base)?;
            }
            let mut prepared = evaluator.parse_query(&query)?;
            if union_default_graph {
                prepared.dataset_mut().set_default_graph_as_union();
            }
            let entailment = QueryEntailment::from(entailment);
            let (results, explanation) = if entailment == QueryEntailment::Simple {
                // Simple queries need only the native repeatable-read view, not
                // an owned copy of every graph in the store.
                let mut bound = prepared.on_store(&store);
                if stats {
                    bound = bound.compute_statistics();
                }
                bound.explain()
            } else {
                let options = QueryEntailmentOptions::new(entailment);
                let mut bound = prepared.on_store_with_entailment(&store, &options)?;
                if stats {
                    bound = bound.compute_statistics();
                }
                bound.explain()
            };
            let print_result = (|| {
                match results? {
                    QueryResults::Solutions(solutions) => {
                        let format = if let Some(name) = results_format {
                            if let Some(format) = QueryResultsFormat::from_extension(&name) {
                                format
                            } else if let Some(format) = QueryResultsFormat::from_media_type(&name)
                            {
                                format
                            } else {
                                bail!("The file format '{name}' is unknown")
                            }
                        } else if let Some(results_file) = &results_file {
                            format_from_path(results_file, |ext| {
                                QueryResultsFormat::from_extension(ext).with_context(|| {
                                    format!("The file extension '{ext}' is unknown")
                                })
                            })?
                        } else {
                            bail!("The --results-format option must be set when writing to stdout")
                        };
                        if let Some(results_file) = results_file {
                            let mut serializer = QueryResultsSerializer::from_format(format)
                                .serialize_solutions_to_writer(
                                    BufWriter::new(File::create(results_file)?),
                                    solutions.variables().to_vec(),
                                )?;
                            for solution in solutions {
                                serializer.serialize(&solution?)?;
                            }
                            close_file_writer(serializer.finish()?)?;
                        } else {
                            let mut serializer = QueryResultsSerializer::from_format(format)
                                .serialize_solutions_to_writer(
                                    stdout().lock(),
                                    solutions.variables().to_vec(),
                                )?;
                            for solution in solutions {
                                serializer.serialize(&solution?)?;
                            }
                            serializer.finish()?.flush()?;
                        }
                    }
                    QueryResults::Boolean(result) => {
                        let format = if let Some(name) = results_format {
                            if let Some(format) = QueryResultsFormat::from_extension(&name) {
                                format
                            } else if let Some(format) = QueryResultsFormat::from_media_type(&name)
                            {
                                format
                            } else {
                                bail!("The file format '{name}' is unknown")
                            }
                        } else if let Some(results_file) = &results_file {
                            format_from_path(results_file, |ext| {
                                QueryResultsFormat::from_extension(ext).with_context(|| {
                                    format!("The file extension '{ext}' is unknown")
                                })
                            })?
                        } else {
                            bail!("The --results-format option must be set when writing to stdout")
                        };
                        if let Some(results_file) = results_file {
                            close_file_writer(
                                QueryResultsSerializer::from_format(format)
                                    .serialize_boolean_to_writer(
                                        BufWriter::new(File::create(results_file)?),
                                        result,
                                    )?,
                            )?;
                        } else {
                            QueryResultsSerializer::from_format(format)
                                .serialize_boolean_to_writer(stdout().lock(), result)?
                                .flush()?;
                        }
                    }
                    QueryResults::Graph(triples) => {
                        let format = if let Some(name) = &results_format {
                            rdf_format_from_name(name)
                        } else if let Some(results_file) = &results_file {
                            rdf_format_from_path(results_file)
                        } else {
                            bail!("The --results-format option must be set when writing to stdout")
                        }?;
                        let serializer = RdfSerializer::from_format(format);
                        if let Some(results_file) = results_file {
                            let mut serializer =
                                serializer.for_writer(BufWriter::new(File::create(results_file)?));
                            for triple in triples {
                                serializer.serialize_triple(&triple?)?;
                            }
                            close_file_writer(serializer.finish()?)?;
                        } else {
                            let mut serializer = serializer.for_writer(stdout().lock());
                            for triple in triples {
                                serializer.serialize_triple(&triple?)?;
                            }
                            serializer.finish()?.flush()?;
                        }
                    }
                }
                Ok(())
            })();
            if let Some(explain_file) = explain_file {
                let mut file = BufWriter::new(File::create(&explain_file)?);
                match explain_file.extension().and_then(OsStr::to_str) {
                    Some("json") => {
                        explanation.write_in_json(&mut file)?;
                    }
                    Some("txt") => {
                        write!(file, "{explanation:?}")?;
                    }
                    _ => bail!(
                        "The given explanation file {} must have an extension that is .json or .txt",
                        explain_file.display()
                    ),
                }
                close_file_writer(file)?;
            } else if explain || stats {
                eprintln!("{explanation:#?}");
            }
            print_result
        }
        Command::Update {
            location,
            update,
            update_file,
            update_base,
        } => {
            let update = if let Some(update) = update {
                update
            } else if let Some(update_file) = update_file {
                fs::read_to_string(&update_file).with_context(|| {
                    format!("Not able to read update file {}", update_file.display())
                })?
            } else {
                io::read_to_string(stdin().lock())?
            };
            let store = Store::open(location)?;
            let mut evaluator = SparqlEvaluator::new();
            if let Some(base) = update_base {
                evaluator = evaluator.with_base_iri(&base)?;
            }
            evaluator
                .parse_update(&update)?
                .on_store(&store)
                .execute()?;
            Ok(())
        }
        Command::Optimize { location } => {
            let store = Store::open(location)?;
            store.optimize()?;
            Ok(())
        }
        Command::Convert {
            from_file,
            from_format,
            from_base,
            to_file,
            to_format,
            to_base,
            lenient,
            from_graph,
            from_default_graph,
            to_graph,
        } => {
            let from_format = if let Some(format) = from_format {
                rdf_format_from_name(&format)?
            } else if let Some(file) = &from_file {
                rdf_format_from_path(file)?
            } else {
                bail!("The --from-format option must be set when reading from stdin")
            };
            let mut parser = RdfParser::from_format(from_format);
            if let Some(base) = from_base {
                parser = parser
                    .with_base_iri(&base)
                    .with_context(|| format!("Invalid base IRI {base}"))?;
            }

            let to_format = if let Some(format) = to_format {
                rdf_format_from_name(&format)?
            } else if let Some(file) = &to_file {
                rdf_format_from_path(file)?
            } else {
                bail!("The --to-format option must be set when writing to stdout")
            };
            let serializer = RdfSerializer::from_format(to_format);

            let from_graph = if let Some(from_graph) = &from_graph {
                Some(
                    NamedNode::new(OxString::new_owned(from_graph))
                        .with_context(|| format!("The source graph name {from_graph} is invalid"))?
                        .into(),
                )
            } else if from_default_graph {
                Some(GraphName::DefaultGraph)
            } else {
                None
            };
            let to_graph = if let Some(to_graph) = &to_graph {
                NamedNode::new(OxString::new_owned(to_graph))
                    .with_context(|| format!("The target graph name {to_graph} is invalid"))?
                    .into()
            } else {
                GraphName::DefaultGraph
            };

            match (from_file, to_file) {
                (Some(from_file), Some(to_file)) => close_file_writer(do_convert(
                    parser,
                    File::open(from_file)?,
                    serializer,
                    BufWriter::new(File::create(to_file)?),
                    lenient,
                    &from_graph,
                    &to_graph,
                    to_base.as_deref(),
                )?),
                (Some(from_file), None) => do_convert(
                    parser,
                    File::open(from_file)?,
                    serializer,
                    stdout().lock(),
                    lenient,
                    &from_graph,
                    &to_graph,
                    to_base.as_deref(),
                )?
                .flush(),
                (None, Some(to_file)) => close_file_writer(do_convert(
                    parser,
                    stdin().lock(),
                    serializer,
                    BufWriter::new(File::create(to_file)?),
                    lenient,
                    &from_graph,
                    &to_graph,
                    to_base.as_deref(),
                )?),
                (None, None) => do_convert(
                    parser,
                    stdin().lock(),
                    serializer,
                    stdout().lock(),
                    lenient,
                    &from_graph,
                    &to_graph,
                    to_base.as_deref(),
                )?
                .flush(),
            }?;
            Ok(())
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum ParallelBulkLoadStage {
    Open,
    Load,
    Commit,
}

impl fmt::Display for ParallelBulkLoadStage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Open => "open",
            Self::Load => "load",
            Self::Commit => "commit",
        })
    }
}

#[derive(Debug)]
struct ParallelBulkLoadFailure {
    input_index: usize,
    file: PathBuf,
    stage: ParallelBulkLoadStage,
    error: anyhow::Error,
}

impl ParallelBulkLoadFailure {
    fn new(
        input_index: usize,
        file: &Path,
        stage: ParallelBulkLoadStage,
        error: impl Into<anyhow::Error>,
    ) -> Self {
        Self {
            input_index,
            file: file.to_owned(),
            stage,
            error: error.into(),
        }
    }
}

#[derive(Debug)]
struct ParallelBulkLoadFailures {
    total_files: usize,
    non_atomic: bool,
    failures: Vec<ParallelBulkLoadFailure>,
}

impl ParallelBulkLoadFailures {
    fn new(
        total_files: usize,
        non_atomic: bool,
        mut failures: Vec<ParallelBulkLoadFailure>,
    ) -> Self {
        failures.sort_by(|left, right| {
            (left.input_index, left.stage, &left.file).cmp(&(
                right.input_index,
                right.stage,
                &right.file,
            ))
        });
        Self {
            total_files,
            non_atomic,
            failures,
        }
    }
}

impl fmt::Display for ParallelBulkLoadFailures {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "parallel bulk load failed for {} of {} files; successful files remain committed",
            self.failures.len(),
            self.total_files
        )?;
        if self.non_atomic {
            f.write_str(
                "; --non-atomic was set, so failed files may also have committed partial data",
            )?;
        } else {
            f.write_str("; each failed file remains uncommitted")?;
        }
        for failure in &self.failures {
            write!(
                f,
                "\n  {}. [{}] {}: {:#}",
                failure.input_index + 1,
                failure.stage,
                failure.file.display(),
                failure.error
            )?;
        }
        Ok(())
    }
}

impl std::error::Error for ParallelBulkLoadFailures {}

fn parallel_bulk_load_files(
    store: &Store,
    files: Vec<PathBuf>,
    format: Option<RdfFormat>,
    base: Option<&str>,
    graph: Option<&NamedNode>,
    non_atomic: bool,
    lenient: bool,
    fail_on_named_graphs: bool,
) -> anyhow::Result<()> {
    let total_files = files.len();
    let failures = Mutex::new(Vec::new());
    ThreadPoolBuilder::new()
        .num_threads(max(1, available_parallelism()?.get() / 2))
        .thread_name(|i| format!("Oxigraph bulk loader thread {i}"))
        .build()?
        .scope(|scope| {
            for (input_index, file) in files.into_iter().enumerate() {
                let store = store.clone();
                let failure_sink = &failures;
                scope.spawn(move |_| {
                    if let Err(failure) = parallel_bulk_load_file(
                        &store,
                        input_index,
                        &file,
                        format,
                        base,
                        graph.cloned(),
                        non_atomic,
                        lenient,
                        fail_on_named_graphs,
                    ) {
                        match failure_sink.lock() {
                            Ok(mut failures) => failures.push(failure),
                            Err(poisoned) => poisoned.into_inner().push(failure),
                        }
                    }
                });
            }
        });
    let failures = match failures.into_inner() {
        Ok(failures) => failures,
        Err(poisoned) => poisoned.into_inner(),
    };
    if failures.is_empty() {
        Ok(())
    } else {
        Err(ParallelBulkLoadFailures::new(total_files, non_atomic, failures).into())
    }
}

fn parallel_bulk_load_file(
    store: &Store,
    input_index: usize,
    file: &Path,
    format: Option<RdfFormat>,
    base: Option<&str>,
    graph: Option<NamedNode>,
    non_atomic: bool,
    lenient: bool,
    fail_on_named_graphs: bool,
) -> Result<(), ParallelBulkLoadFailure> {
    let progress_file = file.to_owned();
    let start = Instant::now();
    let mut loader = store.bulk_loader().on_progress(move |size| {
        let elapsed = start.elapsed();
        eprintln!(
            "{} triples loaded in {}s ({} t/s) from {}",
            size,
            elapsed.as_secs(),
            ((size as f64) / elapsed.as_secs_f64()).round(),
            progress_file.display()
        )
    });
    if non_atomic {
        loader = loader.without_atomicity();
    }
    if lenient {
        let error_file = file.to_owned();
        loader = loader.on_parse_error(move |error| {
            eprintln!("Parsing error on file {}: {}", error_file.display(), error);
            Ok(())
        })
    }
    let load_result = if file.extension().is_some_and(|e| e == OsStr::new("gz")) {
        let file_reader = File::open(file).map_err(|error| {
            ParallelBulkLoadFailure::new(input_index, file, ParallelBulkLoadStage::Open, error)
        })?;
        bulk_load_read(
            &mut loader,
            MultiGzDecoder::new(file_reader),
            format
                .map_or_else(|| rdf_format_from_path(&file.with_extension("")), Ok)
                .map_err(|error| {
                    ParallelBulkLoadFailure::new(
                        input_index,
                        file,
                        ParallelBulkLoadStage::Load,
                        error,
                    )
                })?,
            base,
            graph,
            lenient,
            fail_on_named_graphs,
        )
    } else {
        bulk_load_file(
            &mut loader,
            file,
            format
                .map_or_else(|| rdf_format_from_path(file), Ok)
                .map_err(|error| {
                    ParallelBulkLoadFailure::new(
                        input_index,
                        file,
                        ParallelBulkLoadStage::Load,
                        error,
                    )
                })?,
            base,
            graph,
            lenient,
            fail_on_named_graphs,
        )
    };
    load_result.map_err(|error| {
        ParallelBulkLoadFailure::new(
            input_index,
            file,
            parallel_bulk_load_error_stage(&error),
            error,
        )
    })?;
    loader.commit().map_err(|error| {
        ParallelBulkLoadFailure::new(input_index, file, ParallelBulkLoadStage::Commit, error)
    })
}

fn parallel_bulk_load_error_stage(error: &anyhow::Error) -> ParallelBulkLoadStage {
    if matches!(
        error.downcast_ref::<LoaderError>(),
        Some(LoaderError::Parsing(RdfParseError::Io(error)))
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied
            )
    ) {
        ParallelBulkLoadStage::Open
    } else {
        ParallelBulkLoadStage::Load
    }
}

fn bulk_load_read(
    loader: &mut BulkLoader<'_>,
    reader: impl Read,
    format: RdfFormat,
    base_iri: Option<&str>,
    to_graph_name: Option<NamedNode>,
    lenient: bool,
    fail_on_named_graphs: bool,
) -> anyhow::Result<()> {
    let mut parser = RdfParser::from_format(format);
    if fail_on_named_graphs {
        parser = parser.without_named_graphs();
    }
    if let Some(to_graph_name) = to_graph_name {
        parser = parser.with_default_graph(to_graph_name);
    }
    if let Some(base_iri) = base_iri {
        parser = parser
            .with_base_iri(base_iri)
            .with_context(|| format!("Invalid base IRI {base_iri}"))?;
    }
    if lenient {
        parser = parser.lenient();
    }
    loader.load_from_reader(parser, reader)?;
    Ok(())
}

fn bulk_load_file(
    loader: &mut BulkLoader<'_>,
    path: &Path,
    format: RdfFormat,
    base_iri: Option<&str>,
    to_graph_name: Option<NamedNode>,
    lenient: bool,
    fail_on_named_graphs: bool,
) -> anyhow::Result<()> {
    let mut parser = RdfParser::from_format(format);
    if fail_on_named_graphs {
        parser = parser.without_named_graphs();
    }
    if let Some(to_graph_name) = to_graph_name {
        parser = parser.with_default_graph(to_graph_name);
    }
    if let Some(base_iri) = base_iri {
        parser = parser
            .with_base_iri(base_iri)
            .with_context(|| format!("Invalid base IRI {base_iri}"))?;
    }
    if lenient {
        parser = parser.lenient();
    }
    loader.parallel_load_from_file(parser, path)?;
    Ok(())
}

fn dump<W: Write>(
    store: &Store,
    writer: W,
    format: RdfFormat,
    from_graph_name: Option<&GraphName>,
) -> anyhow::Result<W> {
    ensure!(
        format.supports_datasets() || from_graph_name.is_some(),
        "The --graph option is required when writing a format not supporting datasets like NTriples, Turtle or RDF/XML. Use --graph \"default\" to dump only the default graph."
    );
    Ok(if let Some(from_graph_name) = from_graph_name {
        store.dump_graph_to_writer(from_graph_name, format, writer)
    } else {
        store.dump_to_writer(format, writer)
    }?)
}

fn do_convert<R: Read, W: Write>(
    mut parser: RdfParser,
    reader: R,
    mut serializer: RdfSerializer,
    writer: W,
    lenient: bool,
    from_graph: &Option<GraphName>,
    default_graph: &GraphName,
    to_base: Option<&str>,
) -> anyhow::Result<W> {
    if lenient {
        parser = parser.lenient();
    }
    let mut parser = parser
        .for_reader(reader)
        .with_document_loader(DocumentLoader::new().with_file_support());
    let first = parser.next(); // We read the first element to get prefixes and the base IRI
    if let Some(base_iri) = to_base.or_else(|| parser.base_iri()) {
        serializer = serializer
            .with_base_iri(base_iri)
            .with_context(|| format!("Invalid base IRI: {base_iri}"))?;
    }
    for (prefix_name, prefix_iri) in parser.prefixes() {
        serializer = serializer
            .with_prefix(prefix_name, prefix_iri)
            .with_context(|| format!("Invalid IRI for prefix {prefix_name}: {prefix_iri}"))?;
    }
    let mut serializer = serializer.for_writer(writer);
    let mut non_empty_output_graphs = HashSet::new();
    for quad_result in first.into_iter().chain(parser.by_ref()) {
        match quad_result {
            Ok(mut quad) => {
                if let Some(from_graph) = from_graph {
                    if quad.graph_name == *from_graph {
                        quad.graph_name = GraphName::DefaultGraph;
                    } else {
                        continue;
                    }
                }
                if quad.graph_name.is_default_graph() {
                    quad.graph_name = default_graph.clone();
                }
                match &quad.graph_name {
                    GraphName::NamedNode(graph_name) => {
                        non_empty_output_graphs
                            .insert(NamedOrBlankNode::NamedNode(graph_name.clone()));
                    }
                    GraphName::BlankNode(graph_name) => {
                        non_empty_output_graphs
                            .insert(NamedOrBlankNode::BlankNode(graph_name.clone()));
                    }
                    GraphName::DefaultGraph => {}
                }
                serializer.serialize_quad(&quad)?;
            }
            Err(e) => {
                if lenient {
                    eprintln!("Parsing error: {e}");
                } else {
                    return Err(e.into());
                }
            }
        }
    }
    for graph_name in parser.named_graphs()? {
        let source_graph = GraphName::from(graph_name.clone());
        let output_graph = if let Some(from_graph) = from_graph {
            if source_graph != *from_graph {
                continue;
            }
            default_graph.clone()
        } else {
            source_graph
        };
        let output_graph = match output_graph {
            GraphName::NamedNode(graph_name) => NamedOrBlankNode::NamedNode(graph_name),
            GraphName::BlankNode(graph_name) => NamedOrBlankNode::BlankNode(graph_name),
            GraphName::DefaultGraph => continue,
        };
        if !non_empty_output_graphs.contains(&output_graph) {
            serializer.serialize_empty_graph(&output_graph)?;
        }
    }
    Ok(serializer.finish()?)
}

fn format_from_path<T>(
    path: &Path,
    from_extension: impl FnOnce(&str) -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    if let Some(ext) = path.extension().and_then(OsStr::to_str) {
        from_extension(ext).map_err(|e| {
            e.context(format!(
                "Not able to guess the file format from file name extension '{ext}'"
            ))
        })
    } else {
        bail!(
            "The path {} has no extension to guess a file format from",
            path.display()
        )
    }
}

fn rdf_format_from_path(path: &Path) -> anyhow::Result<RdfFormat> {
    format_from_path(path, |ext| {
        RdfFormat::from_extension(ext)
            .with_context(|| format!("The file extension '{ext}' is unknown"))
    })
}

fn rdf_format_from_name(name: &str) -> anyhow::Result<RdfFormat> {
    if let Some(t) = RdfFormat::from_extension(name) {
        return Ok(t);
    }
    if let Some(t) = RdfFormat::from_media_type(name) {
        return Ok(t);
    }
    bail!("The file format '{name}' is unknown")
}

fn serve(
    store: Store,
    bind: &str,
    admin_bind: Option<std::net::SocketAddr>,
    read_only: bool,
    cors: bool,
    union_default_graph: bool,
    entailment: QueryEntailment,
    timeout_s: Option<u64>,
) -> anyhow::Result<()> {
    entailment.ensure_supported()?;
    let sparql_evaluator = sparql_evaluator();
    let timeout = timeout_s.map(Duration::from_secs);
    let admin_store = admin_bind.map(|address| (address, store.clone()));
    let started = Arc::new(AtomicBool::new(false));
    let on_request = operations::gate(Arc::clone(&started), move |request| {
        let method = request.method().clone();
        finalize_response(
            &method,
            handle_request(
                request,
                &store,
                &sparql_evaluator,
                read_only,
                union_default_graph,
                entailment,
                timeout,
            )
            .unwrap_or_else(|(status, message)| error(status, message)),
        )
    });
    let mut server = if cors {
        Server::new(cors_middleware(on_request))
    } else {
        Server::new(on_request)
    }
    .with_global_timeout(timeout.unwrap_or(HTTP_TIMEOUT))
    .with_server_name(concat!("Oxigraph/", env!("CARGO_PKG_VERSION")))?
    .with_max_concurrent_connections(available_parallelism()?.get() * 128);
    for socket in bind.to_socket_addrs()? {
        server = server.bind(socket);
    }
    let server = server.spawn()?;
    // Both listeners have CLI-process lifetime: oxhttp exposes no shutdown API.
    // Any startup/join error returns to main and terminates the process. Keep
    // notification after both successful binds; do not advertise partial startup.
    let admin_server = admin_store
        .map(|(address, store)| operations::spawn(store, address, Arc::clone(&started)))
        .transpose()?;
    #[cfg(target_os = "linux")]
    systemd_notify_ready()?;
    started.store(true, Ordering::Release);
    eprintln!("Listening for requests at http://{bind}");
    server.join()?;
    if let Some(admin_server) = admin_server {
        admin_server.join()?;
    }
    Ok(())
}

fn cors_middleware(
    on_request: impl Fn(&mut Request<Body>) -> Response<Body> + Send + Sync + 'static,
) -> impl Fn(&mut Request<Body>) -> Response<Body> + Send + Sync + 'static {
    move |request| {
        if *request.method() == Method::OPTIONS {
            let mut response = Response::builder().status(StatusCode::NO_CONTENT);
            let request_headers = request.headers();
            if request_headers.get(ORIGIN).is_some() {
                response = response.header(
                    ACCESS_CONTROL_ALLOW_ORIGIN.clone(),
                    HeaderValue::from_static("*"),
                );
            }
            if let Some(method) = request_headers.get(ACCESS_CONTROL_REQUEST_METHOD) {
                response = response.header(ACCESS_CONTROL_ALLOW_METHODS, method.clone());
            }
            if let Some(headers) = request_headers.get(ACCESS_CONTROL_REQUEST_HEADERS) {
                response = response.header(ACCESS_CONTROL_ALLOW_HEADERS, headers.clone());
            }
            response.body(Body::empty()).unwrap()
        } else {
            let mut response = on_request(request);
            if request.headers().get(ORIGIN).is_some() {
                response
                    .headers_mut()
                    .append(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
            }
            response
        }
    }
}

type HttpError = (StatusCode, String);

fn handle_request(
    request: &mut Request<Body>,
    store: &Store,
    sparql_evaluator: &SparqlEvaluator,
    read_only: bool,
    union_default_graph: bool,
    entailment: QueryEntailment,
    timeout: Option<Duration>,
) -> Result<Response<Body>, HttpError> {
    match (request.uri().path(), request.method().as_ref()) {
        ("/", "HEAD") => Response::builder()
            .header(CONTENT_TYPE, "text/html")
            .body(Body::empty())
            .map_err(internal_server_error),
        ("/", "GET") => Response::builder()
            .header(CONTENT_TYPE, "text/html")
            .body(HTML_ROOT_PAGE.into())
            .map_err(internal_server_error),
        ("/yasgui.min.css", "HEAD") => Response::builder()
            .header(CONTENT_TYPE, "text/css")
            .body(Body::empty())
            .map_err(internal_server_error),
        ("/yasgui.min.css", "GET") => Response::builder()
            .header(CONTENT_TYPE, "text/css")
            .body(YASGUI_CSS.into())
            .map_err(internal_server_error),
        ("/yasgui.min.js", "HEAD") => Response::builder()
            .header(CONTENT_TYPE, "application/javascript")
            .body(Body::empty())
            .map_err(internal_server_error),
        ("/yasgui.min.js", "GET") => Response::builder()
            .header(CONTENT_TYPE, "application/javascript")
            .body(YASGUI_JS.into())
            .map_err(internal_server_error),
        ("/logo.svg", "HEAD") => Response::builder()
            .header(CONTENT_TYPE, "image/svg+xml")
            .body(Body::empty())
            .map_err(internal_server_error),
        ("/logo.svg", "GET") => Response::builder()
            .header(CONTENT_TYPE, "image/svg+xml")
            .body(LOGO.into())
            .map_err(internal_server_error),
        ("/query", "GET") => {
            if request.uri().query().is_some() {
                reject_nonempty_sparql_get_body(request)?;
                configure_and_evaluate_sparql_query(
                    store,
                    sparql_evaluator,
                    RequestParams::from_request_url(request),
                    None,
                    None,
                    request,
                    union_default_graph,
                    entailment,
                    timeout,
                )
            } else {
                service_description_response(
                    request,
                    EndpointKind {
                        query: true,
                        update: false,
                    },
                    union_default_graph,
                    entailment,
                    sparql_evaluator,
                )
            }
        }
        ("/query", "POST" | "QUERY") => {
            let content_type = sparql_request_content_type(request)?
                .ok_or_else(|| bad_request("No Content-Type given"))?;
            if content_type.media_type == "application/sparql-query" {
                let body = limited_string_body(request)?;
                configure_and_evaluate_sparql_query(
                    store,
                    sparql_evaluator,
                    RequestParams::from_request_url(request),
                    Some(body),
                    content_type.version,
                    request,
                    union_default_graph,
                    entailment,
                    timeout,
                )
            } else if content_type.media_type == "application/x-www-form-urlencoded" {
                configure_and_evaluate_sparql_query(
                    store,
                    sparql_evaluator,
                    RequestParams::from_request_url_and_body(request)?,
                    None,
                    None,
                    request,
                    union_default_graph,
                    entailment,
                    timeout,
                )
            } else {
                Err(unsupported_media_type(&content_type.media_type))
            }
        }
        ("/update", "GET") => {
            if read_only {
                return Err(the_server_is_read_only());
            }
            service_description_response(
                request,
                EndpointKind {
                    query: false,
                    update: true,
                },
                union_default_graph,
                entailment,
                sparql_evaluator,
            )
        }
        ("/update", "POST") => {
            if read_only {
                return Err(the_server_is_read_only());
            }
            let content_type = sparql_request_content_type(request)?
                .ok_or_else(|| bad_request("No Content-Type given"))?;
            if content_type.media_type == "application/sparql-update" {
                let body = limited_string_body(request)?;
                configure_and_evaluate_sparql_update(
                    store,
                    sparql_evaluator,
                    RequestParams::from_request_url(request),
                    Some(body),
                    content_type.version,
                    request,
                    union_default_graph,
                )
            } else if content_type.media_type == "application/x-www-form-urlencoded" {
                configure_and_evaluate_sparql_update(
                    store,
                    sparql_evaluator,
                    RequestParams::from_request_url_and_body(request)?,
                    None,
                    None,
                    request,
                    union_default_graph,
                )
            } else {
                Err(unsupported_media_type(&content_type.media_type))
            }
        }
        ("/sparql", "GET") => {
            if request.uri().query().is_some() {
                reject_nonempty_sparql_get_body(request)?;
                configure_and_evaluate_sparql_query(
                    store,
                    sparql_evaluator,
                    RequestParams::from_request_url(request),
                    None,
                    None,
                    request,
                    union_default_graph,
                    entailment,
                    timeout,
                )
            } else {
                service_description_response(
                    request,
                    EndpointKind {
                        query: true,
                        update: !read_only,
                    },
                    union_default_graph,
                    entailment,
                    sparql_evaluator,
                )
            }
        }
        ("/sparql", method @ ("POST" | "QUERY")) => {
            let is_query = method == "QUERY";
            let content_type = sparql_request_content_type(request)?
                .ok_or_else(|| bad_request("No Content-Type given"))?;
            if content_type.media_type == "application/sparql-query" {
                let body = limited_string_body(request)?;
                configure_and_evaluate_sparql_query(
                    store,
                    sparql_evaluator,
                    RequestParams::from_request_url(request),
                    Some(body),
                    content_type.version,
                    request,
                    union_default_graph,
                    entailment,
                    timeout,
                )
            } else if content_type.media_type == "application/sparql-update" && !is_query {
                if read_only {
                    return Err(the_server_is_read_only());
                }
                let body = limited_string_body(request)?;
                configure_and_evaluate_sparql_update(
                    store,
                    sparql_evaluator,
                    RequestParams::from_request_url(request),
                    Some(body),
                    content_type.version,
                    request,
                    union_default_graph,
                )
            } else if content_type.media_type == "application/x-www-form-urlencoded" {
                let args = RequestParams::from_request_url_and_body(request)?;
                match (args.contains("query"), args.contains("update")) {
                    (true, true) => Err(bad_request(
                        "Both 'query' and 'update' cannot be set at the same time",
                    )),
                    (true, false) => configure_and_evaluate_sparql_query(
                        store,
                        sparql_evaluator,
                        args,
                        None,
                        None,
                        request,
                        union_default_graph,
                        entailment,
                        timeout,
                    ),
                    (false, true) => {
                        if is_query {
                            return Err(bad_request(
                                "SPARQL updates are not compatible with the QUERY HTTP method",
                            ));
                        }
                        if read_only {
                            return Err(the_server_is_read_only());
                        }
                        configure_and_evaluate_sparql_update(
                            store,
                            sparql_evaluator,
                            args,
                            None,
                            None,
                            request,
                            union_default_graph,
                        )
                    }
                    (false, false) => Err(bad_request(
                        "'query' or 'update' must be set to define the SPARQL operation to execute",
                    )),
                }
            } else {
                Err(unsupported_media_type(&content_type.media_type))
            }
        }
        (path, _) if graph_store::is_route(path) => graph_store::handle(request, store, read_only),
        ("/query" | "/sparql", _) => method_not_allowed_response(request, "GET, POST, QUERY"),
        ("/update", _) => method_not_allowed_response(request, "GET, POST"),
        _ => Err((
            StatusCode::NOT_FOUND,
            format!(
                "{} {} is not supported by this server",
                request.method(),
                request.uri().path()
            ),
        )),
    }
}

fn method_not_allowed_response(
    request: &Request<Body>,
    allow: &'static str,
) -> Result<Response<Body>, HttpError> {
    Response::builder()
        .status(StatusCode::METHOD_NOT_ALLOWED)
        .header(ALLOW, allow)
        .body(
            format!(
                "{} {} is not supported by this service",
                request.method(),
                request.uri().path()
            )
            .into(),
        )
        .map_err(internal_server_error)
}

fn base_url(request: &Request<Body>) -> String {
    let uri = request.uri();
    if uri.query().is_some() {
        // We remove the query
        let mut parts = uri.clone().into_parts();
        if let Some(path_and_query) = &mut parts.path_and_query {
            if path_and_query.query().is_some() {
                *path_and_query = PathAndQuery::try_from(path_and_query.path()).unwrap();
            }
        }
        Uri::from_parts(parts).unwrap().to_string()
    } else {
        uri.to_string()
    }
}

fn resolve_with_base(request: &Request<Body>, url: &str) -> Result<NamedNode, HttpError> {
    let iri = IriRef::parse(url).map_err(bad_request)?;
    Ok(if iri.is_absolute() {
        NamedNode::new_unchecked(OxString::new_owned(iri.into_inner()))
    } else {
        NamedNode::new_unchecked(
            Iri::parse(base_url(request))
                .map_err(bad_request)?
                .resolve(&iri)
                .map_err(bad_request)?
                .into_inner(),
        )
    })
}

struct RequestParams {
    params: HashMap<String, Vec<String>>,
}

impl RequestParams {
    fn from_request_url(request: &Request<Body>) -> Self {
        Self::parse(request.uri().query().unwrap_or_default().as_bytes())
    }

    fn from_request_url_and_body(request: &mut Request<Body>) -> Result<Self, HttpError> {
        let mut params = Self::from_request_url(request).params;
        let url_keys = params.keys().cloned().collect::<HashSet<_>>();
        let body = limited_body(request)?;
        for (key, value) in form_urlencoded::parse(&body) {
            if url_keys.contains(key.as_ref()) {
                return Err(bad_request(format!(
                    "'{key}' cannot be set both in the body and the URL query"
                )));
            }
            params
                .entry(key.into_owned())
                .or_default()
                .push(value.into_owned());
        }
        Ok(Self { params })
    }

    fn parse(data: &[u8]) -> Self {
        let mut params: HashMap<String, Vec<String>> = HashMap::new();
        for (key, value) in form_urlencoded::parse(data) {
            params
                .entry(key.into_owned())
                .or_default()
                .push(value.into_owned());
        }
        Self { params }
    }

    fn contains(&self, key: &str) -> bool {
        self.params.contains_key(key)
    }

    fn remove_required_exactly_once(&mut self, key: &str) -> Result<String, HttpError> {
        self.remove_single(key)?
            .ok_or_else(|| bad_request(format!("The URL query parameter {key} must be set")))
    }

    fn remove_single(&mut self, key: &str) -> Result<Option<String>, HttpError> {
        let values = self.remove_all(key);
        if values.len() > 1 {
            return Err(bad_request(format!(
                "The URL query parameter {key} must be set at most once"
            )));
        }
        Ok(values.into_iter().next())
    }

    fn remove_all(&mut self, key: &str) -> Vec<String> {
        self.params.remove(key).unwrap_or_default()
    }

    fn remove_flag(&mut self, key: &str) -> Result<bool, HttpError> {
        Ok(self.remove_single(key)?.is_some())
    }

    fn reject_unknown(&self, operation: &str) -> Result<(), HttpError> {
        if self.params.is_empty() {
            return Ok(());
        }
        let mut keys = self.params.keys().map(String::as_str).collect::<Vec<_>>();
        keys.sort_unstable();
        Err(bad_request(format!(
            "Unknown SPARQL {operation} parameter(s): {}",
            keys.join(", ")
        )))
    }
}

fn url_has_query_parameter(request: &Request<Body>, parameter: &str) -> bool {
    RequestParams::from_request_url(request).contains(parameter)
}

fn reject_nonempty_sparql_get_body(request: &mut Request<Body>) -> Result<(), HttpError> {
    if limited_body(request)?.is_empty() {
        Ok(())
    } else {
        Err(bad_request(
            "A SPARQL query sent using HTTP GET must not include a message body",
        ))
    }
}

fn limited_string_body(request: &mut Request<Body>) -> Result<String, HttpError> {
    String::from_utf8(limited_body(request)?)
        .map_err(|e| bad_request(format!("Invalid UTF-8 body: {e}")))
}

fn limited_body(request: &mut Request<Body>) -> Result<Vec<u8>, HttpError> {
    let body = request.body_mut();
    if let Some(body_len) = body.len() {
        if body_len > MAX_HTTP_BODY_SIZE {
            // it's too big
            return Err(bad_request(format!(
                "HTTP body payloads are limited to {MAX_HTTP_BODY_SIZE} bytes, found {body_len} bytes"
            )));
        }
        let mut payload = Vec::with_capacity(
            body_len
                .try_into()
                .map_err(|_| bad_request("Huge body size"))?,
        );
        body.read_to_end(&mut payload)
            .map_err(internal_server_error)?;
        Ok(payload)
    } else {
        let mut payload = Vec::new();
        body.take(MAX_HTTP_BODY_SIZE + 1)
            .read_to_end(&mut payload)
            .map_err(internal_server_error)?;
        if payload.len()
            > MAX_HTTP_BODY_SIZE
                .try_into()
                .map_err(internal_server_error)?
        {
            return Err(bad_request(format!(
                "HTTP body payloads are limited to {MAX_HTTP_BODY_SIZE} bytes"
            )));
        }
        Ok(payload)
    }
}

fn configure_and_evaluate_sparql_query(
    store: &Store,
    evaluator: &SparqlEvaluator,
    mut args: RequestParams,
    query: Option<String>,
    media_type_version: Option<SparqlVersion>,
    request: &Request<Body>,
    default_use_default_graph_as_union: bool,
    entailment: QueryEntailment,
    timeout: Option<Duration>,
) -> Result<Response<Body>, HttpError> {
    let is_direct_request = query.is_some();
    let default_graph_uris = args.remove_all("default-graph-uri");
    let named_graph_uris = args.remove_all("named-graph-uri");
    let mut use_default_graph_as_union = args.remove_flag("union-default-graph")?;
    if default_graph_uris.is_empty() && named_graph_uris.is_empty() {
        use_default_graph_as_union |= default_use_default_graph_as_union;
    }
    let query = if let Some(query) = query {
        if args.contains("query") {
            return Err(bad_request(
                "The query cannot be set both in the URL query parameters and the request body",
            ));
        }
        query
    } else {
        args.remove_required_exactly_once("query")?
    };
    let parameter_version = args.remove_single("version")?;
    if is_direct_request && parameter_version.is_some() {
        return Err(bad_request(
            "The version of a direct SPARQL query must be set as an application/sparql-query media type parameter",
        ));
    }
    let request_version = if let Some(version) = parameter_version {
        if media_type_version.is_some() {
            return Err(bad_request("Multiple version parameters provided"));
        }
        Some(SparqlVersion::parse(&version)?)
    } else {
        media_type_version
    };
    args.reject_unknown("query")?;
    let effective_version = validate_sparql_version(&query, request_version)?;
    evaluate_sparql_query(
        store,
        evaluator,
        &query,
        effective_version,
        use_default_graph_as_union,
        default_graph_uris,
        named_graph_uris,
        request,
        entailment,
        timeout,
    )
}

fn evaluate_sparql_query(
    store: &Store,
    evaluator: &SparqlEvaluator,
    query: &str,
    version: Option<SparqlVersion>,
    use_default_graph_as_union: bool,
    default_graph_uris: Vec<String>,
    named_graph_uris: Vec<String>,
    request: &Request<Body>,
    entailment: QueryEntailment,
    timeout: Option<Duration>,
) -> Result<Response<Body>, HttpError> {
    let mut evaluator = evaluator
        .clone()
        .with_base_iri(&base_url(request))
        .map_err(bad_request)?;
    if let Some(version) = version {
        evaluator = evaluator.with_version(version.into());
    }

    if let Some(timeout) = timeout {
        let cancellation_token = CancellationToken::new();
        evaluator = evaluator.with_cancellation_token(cancellation_token.clone());
        thread::Builder::new()
            .name("SPARQL evaluation timeout".into())
            .spawn(move || {
                thread::sleep(timeout);
                cancellation_token.cancel();
            })
            .map_err(internal_server_error)?;
    }

    let mut prepared = evaluator.parse_query(query).map_err(bad_request)?;

    if use_default_graph_as_union {
        if !default_graph_uris.is_empty() || !named_graph_uris.is_empty() {
            return Err(bad_request(
                "default-graph-uri or named-graph-uri and union-default-graph should not be set at the same time",
            ));
        }
        prepared.dataset_mut().set_default_graph_as_union()
    } else if !default_graph_uris.is_empty() || !named_graph_uris.is_empty() {
        prepared.dataset_mut().set_default_graph(
            default_graph_uris
                .into_iter()
                .map(|e| Ok(NamedNode::new(e)?.into()))
                .collect::<Result<Vec<GraphName>, IriParseError>>()
                .map_err(bad_request)?,
        );
        prepared.dataset_mut().set_available_named_graphs(
            named_graph_uris
                .into_iter()
                .map(|e| Ok(NamedNode::new(e)?.into()))
                .collect::<Result<Vec<NamedOrBlankNode>, IriParseError>>()
                .map_err(bad_request)?,
        );
    }

    let results = if entailment == QueryEntailment::Simple {
        prepared.on_store(store).execute()
    } else {
        let options = QueryEntailmentOptions::new(entailment).with_timeout(timeout);
        prepared
            .on_store_with_entailment(store, &options)
            .map_err(query_request_refused)?
            .execute()
    }
    .map_err(internal_server_error)?;
    match results {
        QueryResults::Solutions(solutions) => {
            let selected = query_results_content_negotiation(request, true)?;
            let serializer = selected.serializer()?;
            if selected.requires_term_preflight() {
                let mut body = Vec::new();
                let mut serializer = serializer
                    .serialize_solutions_to_writer(&mut body, solutions.variables().to_vec())
                    .map_err(internal_server_error)?;
                for solution in solutions {
                    let solution = solution.map_err(internal_server_error)?;
                    serializer
                        .serialize(&solution)
                        .map_err(query_results_not_acceptable)?;
                }
                serializer.finish().map_err(internal_server_error)?;
                return Response::builder()
                    .header(CONTENT_TYPE, selected.media_type())
                    .body(body.into())
                    .map_err(internal_server_error);
            }
            ReadForWrite::build_response(
                move |w| {
                    Ok((
                        serializer
                            .serialize_solutions_to_writer(w, solutions.variables().to_vec())?,
                        solutions,
                    ))
                },
                |(mut serializer, mut solutions)| {
                    Ok(if let Some(solution) = solutions.next() {
                        serializer.serialize(&solution.map_err(io::Error::other)?)?;
                        Some((serializer, solutions))
                    } else {
                        serializer.finish()?;
                        None
                    })
                },
                selected.media_type(),
            )
        }
        QueryResults::Boolean(result) => {
            let selected = query_results_content_negotiation(request, false)?;
            let mut body = Vec::new();
            selected
                .serializer()?
                .serialize_boolean_to_writer(&mut body, result)
                .map_err(internal_server_error)?;
            Response::builder()
                .header(CONTENT_TYPE, selected.media_type())
                .body(body.into())
                .map_err(internal_server_error)
        }
        QueryResults::Graph(triples) => {
            let selected = rdf_content_negotiation(request)?;
            if selected.version() == RdfVersion::V1_1 {
                let mut serializer = selected
                    .serializer()
                    .map_err(internal_server_error)?
                    .for_writer(Vec::new());
                for triple in triples {
                    let triple = triple.map_err(internal_server_error)?;
                    selected
                        .ensure_triple(&triple)
                        .map_err(rdf_response_not_acceptable)?;
                    serializer
                        .serialize_triple(&triple)
                        .map_err(internal_server_error)?;
                }
                let body = serializer.finish().map_err(internal_server_error)?;
                return Response::builder()
                    .header(CONTENT_TYPE, selected.media_type())
                    .body(body.into())
                    .map_err(internal_server_error);
            }
            ReadForWrite::build_response(
                move |w| Ok((selected.serializer()?.for_writer(w), triples)),
                move |(mut serializer, mut triples)| {
                    Ok(if let Some(t) = triples.next() {
                        let triple = t.map_err(io::Error::other)?;
                        selected.ensure_triple(&triple)?;
                        serializer.serialize_triple(&triple)?;
                        Some((serializer, triples))
                    } else {
                        serializer.finish()?;
                        None
                    })
                },
                selected.media_type(),
            )
        }
    }
}

fn configure_and_evaluate_sparql_update(
    store: &Store,
    evaluator: &SparqlEvaluator,
    mut args: RequestParams,
    update: Option<String>,
    media_type_version: Option<SparqlVersion>,
    request: &Request<Body>,
    default_use_default_graph_as_union: bool,
) -> Result<Response<Body>, HttpError> {
    let is_direct_request = update.is_some();
    let default_graph_uris = args.remove_all("using-graph-uri");
    let named_graph_uris = args.remove_all("using-named-graph-uri");
    let mut use_default_graph_as_union = args.remove_flag("using-union-graph")?;
    if default_graph_uris.is_empty() && named_graph_uris.is_empty() {
        use_default_graph_as_union |= default_use_default_graph_as_union;
    }
    let update = if let Some(update) = update {
        if args.contains("update") {
            return Err(bad_request(
                "The update cannot be set both in the URL query parameters and the request body",
            ));
        }
        update
    } else {
        args.remove_required_exactly_once("update")?
    };
    let parameter_version = args.remove_single("version")?;
    if is_direct_request && parameter_version.is_some() {
        return Err(bad_request(
            "The version of a direct SPARQL update must be set as an application/sparql-update media type parameter",
        ));
    }
    let request_version = if let Some(version) = parameter_version {
        if media_type_version.is_some() {
            return Err(bad_request("Multiple version parameters provided"));
        }
        Some(SparqlVersion::parse(&version)?)
    } else {
        media_type_version
    };
    args.reject_unknown("update")?;
    let effective_version = validate_sparql_version(&update, request_version)?;
    evaluate_sparql_update(
        store,
        evaluator,
        &update,
        effective_version,
        use_default_graph_as_union,
        default_graph_uris,
        named_graph_uris,
        request,
    )
}

fn evaluate_sparql_update(
    store: &Store,
    evaluator: &SparqlEvaluator,
    update: &str,
    version: Option<SparqlVersion>,
    use_default_graph_as_union: bool,
    default_graph_uris: Vec<String>,
    named_graph_uris: Vec<String>,
    request: &Request<Body>,
) -> Result<Response<Body>, HttpError> {
    let mut evaluator = evaluator
        .clone()
        .with_base_iri(base_url(request).as_str())
        .map_err(bad_request)?;
    if let Some(version) = version {
        evaluator = evaluator.with_version(version.into());
    }
    let mut prepared = evaluator.parse_update(update).map_err(bad_request)?;

    if use_default_graph_as_union {
        if !default_graph_uris.is_empty() || !named_graph_uris.is_empty() {
            return Err(bad_request(
                "using-graph-uri or using-named-graph-uri and using-union-graph should not be set at the same time",
            ));
        }
        for using in prepared.using_datasets_mut() {
            if !using.is_default_dataset() {
                return Err(bad_request(
                    "using-union-graph must not be used with a SPARQL UPDATE containing USING",
                ));
            }
            using.set_default_graph_as_union();
        }
    } else if !default_graph_uris.is_empty() || !named_graph_uris.is_empty() {
        let default_graph_uris = default_graph_uris
            .into_iter()
            .map(|e| Ok(NamedNode::new(e)?.into()))
            .collect::<Result<Vec<GraphName>, IriParseError>>()
            .map_err(bad_request)?;
        let named_graph_uris = named_graph_uris
            .into_iter()
            .map(|e| Ok(NamedNode::new(e)?.into()))
            .collect::<Result<Vec<NamedOrBlankNode>, IriParseError>>()
            .map_err(bad_request)?;
        for using in prepared.using_datasets_mut() {
            if !using.is_default_dataset() {
                return Err(bad_request(
                    "using-graph-uri and using-named-graph-uri must not be used with a SPARQL UPDATE containing USING",
                ));
            }
            using.set_default_graph(default_graph_uris.clone());
            using.set_available_named_graphs(named_graph_uris.clone());
        }
    }
    prepared
        .on_store(store)
        .execute()
        .map_err(internal_server_error)?;
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .map_err(internal_server_error)
}

fn rdf_content_negotiation(request: &Request<Body>) -> Result<RdfResponseFormat, HttpError> {
    content_negotiation(
        request,
        |media_range| {
            let format = RdfFormat::from_media_type(media_range)?;
            let version = match media_type_parameter(media_range, "version").ok().flatten() {
                Some("1.2-basic") => RdfVersion::V1_2Basic,
                Some("1.2") => RdfVersion::V1_2,
                _ => RdfVersion::V1_1,
            };
            Some(RdfResponseFormat::new(format, version))
        },
        |selected, media_range| match media_type_parameter(media_range, "version")? {
            None | Some("1.1") => Ok(selected.version() == RdfVersion::V1_1),
            Some("1.2-basic") => Ok(cfg!(feature = "rdf-12")
                && RdfResponseFormat::supports_rdf12(selected.format())
                && selected.version() == RdfVersion::V1_2Basic),
            Some("1.2") => Ok(cfg!(feature = "rdf-12")
                && RdfResponseFormat::supports_rdf12(selected.format())
                && selected.version() == RdfVersion::V1_2),
            Some(_) => Ok(false),
        },
        RdfResponseFormat::rdf11(RdfFormat::NQuads),
        &[
            RdfResponseFormat::rdf11(RdfFormat::NQuads),
            RdfResponseFormat::rdf11(RdfFormat::TriG),
            RdfResponseFormat::rdf11(RdfFormat::JsonLd {
                profile: JsonLdProfileSet::empty(),
            }),
            RdfResponseFormat::rdf11(RdfFormat::Turtle),
            RdfResponseFormat::rdf11(RdfFormat::NTriples),
            RdfResponseFormat::rdf11(RdfFormat::RdfXml),
            RdfResponseFormat::rdf11(RdfFormat::N3),
            #[cfg(feature = "rdf-12")]
            RdfResponseFormat::new(RdfFormat::NQuads, RdfVersion::V1_2Basic),
            #[cfg(feature = "rdf-12")]
            RdfResponseFormat::new(RdfFormat::TriG, RdfVersion::V1_2Basic),
            #[cfg(feature = "rdf-12")]
            RdfResponseFormat::new(RdfFormat::Turtle, RdfVersion::V1_2Basic),
            #[cfg(feature = "rdf-12")]
            RdfResponseFormat::new(RdfFormat::NTriples, RdfVersion::V1_2Basic),
            #[cfg(feature = "rdf-12")]
            RdfResponseFormat::new(RdfFormat::NQuads, RdfVersion::V1_2),
            #[cfg(feature = "rdf-12")]
            RdfResponseFormat::new(RdfFormat::TriG, RdfVersion::V1_2),
            #[cfg(feature = "rdf-12")]
            RdfResponseFormat::new(RdfFormat::Turtle, RdfVersion::V1_2),
            #[cfg(feature = "rdf-12")]
            RdfResponseFormat::new(RdfFormat::NTriples, RdfVersion::V1_2),
        ],
        RdfResponseFormat::media_type,
        "application/n-quads or text/turtle",
    )
}

fn query_results_content_negotiation(
    request: &Request<Body>,
    tabular_results: bool,
) -> Result<QueryResultsResponseFormat, HttpError> {
    content_negotiation(
        request,
        query_results_response_format,
        |selected, media_range| {
            accepts_query_results_parameters(selected, media_range, tabular_results)
        },
        QueryResultsResponseFormat::unversioned(QueryResultsFormat::Json),
        &[
            QueryResultsResponseFormat::unversioned(QueryResultsFormat::Json),
            #[cfg(feature = "rdf-12")]
            QueryResultsResponseFormat {
                format: QueryResultsFormat::Json,
                version: Some(RdfVersion::V1_1),
            },
            #[cfg(feature = "rdf-12")]
            QueryResultsResponseFormat {
                format: QueryResultsFormat::Json,
                version: Some(RdfVersion::V1_2Basic),
            },
            #[cfg(feature = "rdf-12")]
            QueryResultsResponseFormat {
                format: QueryResultsFormat::Json,
                version: Some(RdfVersion::V1_2),
            },
            QueryResultsResponseFormat::unversioned(QueryResultsFormat::Xml),
            #[cfg(feature = "rdf-12")]
            QueryResultsResponseFormat {
                format: QueryResultsFormat::Xml,
                version: Some(RdfVersion::V1_1),
            },
            #[cfg(feature = "rdf-12")]
            QueryResultsResponseFormat {
                format: QueryResultsFormat::Xml,
                version: Some(RdfVersion::V1_2Basic),
            },
            #[cfg(feature = "rdf-12")]
            QueryResultsResponseFormat {
                format: QueryResultsFormat::Xml,
                version: Some(RdfVersion::V1_2),
            },
            QueryResultsResponseFormat::unversioned(QueryResultsFormat::Csv),
            QueryResultsResponseFormat::unversioned(QueryResultsFormat::Tsv),
        ],
        QueryResultsResponseFormat::media_type,
        "application/sparql-results+json or text/tsv",
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct QueryResultsResponseFormat {
    format: QueryResultsFormat,
    version: Option<RdfVersion>,
}

impl QueryResultsResponseFormat {
    const fn unversioned(format: QueryResultsFormat) -> Self {
        Self {
            format,
            version: None,
        }
    }

    fn serializer(self) -> Result<QueryResultsSerializer, HttpError> {
        let serializer = QueryResultsSerializer::from_format(self.format);
        match self.version {
            Some(version) => serializer
                .with_rdf_version(version)
                .map_err(internal_server_error),
            None => Ok(serializer),
        }
    }

    const fn requires_term_preflight(self) -> bool {
        matches!(self.version, Some(RdfVersion::V1_1 | RdfVersion::V1_2Basic))
    }

    fn media_type(self) -> &'static str {
        match (self.format, self.version) {
            (QueryResultsFormat::Json, Some(RdfVersion::V1_1)) => {
                "application/sparql-results+json; version=1.1"
            }
            (QueryResultsFormat::Json, Some(RdfVersion::V1_2Basic)) => {
                "application/sparql-results+json; version=1.2-basic"
            }
            (QueryResultsFormat::Json, Some(RdfVersion::V1_2)) => {
                "application/sparql-results+json; version=1.2"
            }
            (QueryResultsFormat::Xml, Some(RdfVersion::V1_1)) => {
                "application/sparql-results+xml; version=1.1"
            }
            (QueryResultsFormat::Xml, Some(RdfVersion::V1_2Basic)) => {
                "application/sparql-results+xml; version=1.2-basic"
            }
            (QueryResultsFormat::Xml, Some(RdfVersion::V1_2)) => {
                "application/sparql-results+xml; version=1.2"
            }
            (format, None) => format.media_type(),
            (QueryResultsFormat::Csv | QueryResultsFormat::Tsv, Some(_)) => {
                unreachable!("tabular result formats do not support version parameters")
            }
            _ => unreachable!("unknown query results format"),
        }
    }
}

fn query_results_response_format(media_range: &str) -> Option<QueryResultsResponseFormat> {
    let format = QueryResultsFormat::from_media_type(media_range)?;
    let version = match media_type_parameter(media_range, "version").ok().flatten() {
        Some("1.1") => Some(RdfVersion::V1_1),
        Some("1.2-basic") => Some(RdfVersion::V1_2Basic),
        Some("1.2") => Some(RdfVersion::V1_2),
        _ => None,
    };
    Some(QueryResultsResponseFormat { format, version })
}

fn accepts_query_results_parameters(
    selected: QueryResultsResponseFormat,
    media_range: &str,
    tabular_results: bool,
) -> Result<bool, HttpError> {
    let format = selected.format;
    if !tabular_results && matches!(format, QueryResultsFormat::Csv | QueryResultsFormat::Tsv) {
        // The SPARQL CSV and TSV Results formats only encode SELECT result
        // tables, not ASK boolean results.
        return Ok(false);
    }
    let requested_version = match media_type_parameter(media_range, "version")? {
        None => None,
        Some("1.1") => Some(RdfVersion::V1_1),
        Some("1.2-basic") if cfg!(feature = "rdf-12") => Some(RdfVersion::V1_2Basic),
        Some("1.2") if cfg!(feature = "rdf-12") => Some(RdfVersion::V1_2),
        Some(_) => return Ok(false),
    };
    if requested_version != selected.version
        || (requested_version.is_some()
            && !matches!(format, QueryResultsFormat::Json | QueryResultsFormat::Xml))
    {
        return Ok(false);
    }
    if media_type_parameter(media_range, "charset")?
        .is_some_and(|charset| !charset.eq_ignore_ascii_case("utf-8"))
    {
        return Ok(false);
    }
    if format == QueryResultsFormat::Csv
        && media_type_parameter(media_range, "header")?
            .is_some_and(|header| !header.eq_ignore_ascii_case("present"))
    {
        return Ok(false);
    }
    Ok(true)
}

fn content_negotiation<F: Copy + Eq>(
    request: &Request<Body>,
    parse: impl Fn(&str) -> Option<F>,
    accepts_parameters: impl Fn(F, &str) -> Result<bool, HttpError>,
    default: F,
    supported: &[F],
    media_type: impl Fn(F) -> &'static str,
    example: &str,
) -> Result<F, HttpError> {
    let header = request
        .headers()
        .get(ACCEPT)
        .map(|h| h.to_str())
        .transpose()
        .map_err(|_| bad_request("The Accept header should be a valid ASCII string"))?
        .unwrap_or_default();

    if header.is_empty() {
        return Ok(default);
    }
    let mut candidates = supported
        .iter()
        .map(|format| (*format, ((0_u8, 0_usize), 0_u16)))
        .collect::<Vec<_>>();
    for possible in split_quoted_header_fields(header, ',')? {
        let possible = possible.trim();
        if possible.is_empty() {
            continue;
        }
        let fields = split_quoted_header_fields(possible, ';')?;
        let Some(type_subtype) = fields.first().map(|field| field.trim()) else {
            continue;
        };
        let mut media_range = type_subtype.to_owned();
        let mut quality = 1000;
        let mut found_quality = false;
        for parameter in fields.iter().skip(1) {
            let parameter = parameter.trim();
            let Some((name, value)) = parameter.split_once('=') else {
                return Err(bad_request(format!(
                    "Invalid Accept media type parameter: '{parameter}'"
                )));
            };
            if name.trim().eq_ignore_ascii_case("q") {
                if found_quality {
                    return Err(bad_request(
                        "Multiple q parameters provided in an Accept media range",
                    ));
                }
                quality = parse_http_quality(value.trim())?;
                found_quality = true;
            } else {
                if found_quality {
                    return Err(bad_request(
                        "Accept media type parameters must precede the q parameter",
                    ));
                }
                media_range.push(';');
                media_range.push_str(parameter);
            }
        }
        let (possible_base, possible_sub) = type_subtype
            .split_once('/')
            .ok_or_else(|| bad_request(format!("Invalid media type: '{possible}'")))?;
        let possible_base = possible_base.trim();
        let possible_sub = possible_sub.trim();

        let (format, specificity) = if possible_base == "*" && possible_sub == "*" {
            (None, 0)
        } else if possible_sub == "*" {
            (None, 1)
        } else {
            (parse(&media_range), 2)
        };
        if let Some(format) = format
            && !candidates.iter().any(|(candidate, _)| *candidate == format)
        {
            candidates.push((format, ((0, 0), 0)));
        }
        for (candidate, candidate_score) in &mut candidates {
            let candidate_media_type = media_type(*candidate);
            let candidate_base = candidate_media_type.split_once('/').unwrap().0;
            if (format == Some(*candidate)
                || (possible_sub == "*"
                    && (possible_base == "*" || possible_base == candidate_base)))
                && accepts_parameters(*candidate, &media_range)?
                && let Some(parameter_count) = media_type_parameter_count(&media_range)
            {
                let score = ((specificity, parameter_count), quality);
                if score > *candidate_score {
                    *candidate_score = score;
                }
            }
        }
    }

    let mut result = None;
    let mut result_quality = 0;
    for (format, (_, quality)) in candidates {
        if quality > result_quality {
            result = Some(format);
            result_quality = quality;
        }
    }

    result.ok_or_else(|| {
        (
            StatusCode::NOT_ACCEPTABLE,
            format!("The accept header does not provide any accepted format like {example}"),
        )
    })
}

fn media_type_parameter_count(media_range: &str) -> Option<usize> {
    let mut count = 0;
    for parameter in split_quoted_header_fields(media_range, ';')
        .ok()?
        .into_iter()
        .skip(1)
    {
        parameter.split_once('=')?;
        count += 1;
    }
    Some(count)
}

fn split_quoted_header_fields(value: &str, delimiter: char) -> Result<Vec<&str>, HttpError> {
    let mut fields = Vec::new();
    let mut start = 0;
    let mut quoted = false;
    let mut escaped = false;
    for (index, character) in value.char_indices() {
        if quoted {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                quoted = false;
            }
        } else if character == '"' {
            quoted = true;
        } else if character == delimiter {
            fields.push(&value[start..index]);
            start = index + character.len_utf8();
        }
    }
    if quoted || escaped {
        return Err(bad_request(
            "An HTTP header has an unterminated quoted value",
        ));
    }
    fields.push(&value[start..]);
    Ok(fields)
}

fn parse_http_quality(value: &str) -> Result<u16, HttpError> {
    let value = unquote_media_type_parameter(value)?;
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if fraction.len() > 3 || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(bad_request(format!(
            "Invalid Accept media type score: {value}"
        )));
    }
    let whole = match whole {
        "0" => 0,
        "1" if fraction.bytes().all(|byte| byte == b'0') => 1,
        _ => {
            return Err(bad_request(format!(
                "Invalid Accept media type score: {value}"
            )));
        }
    };
    if whole == 1 {
        Ok(1000)
    } else {
        let fraction = match fraction.len() {
            0 => 0,
            1 => fraction.parse::<u16>().unwrap_or_default() * 100,
            2 => fraction.parse::<u16>().unwrap_or_default() * 10,
            3 => fraction.parse::<u16>().unwrap_or_default(),
            _ => unreachable!(),
        };
        Ok(fraction)
    }
}

fn media_type_parameter<'a>(
    value: &'a str,
    parameter_name: &str,
) -> Result<Option<&'a str>, HttpError> {
    let mut result = None;
    for parameter in split_quoted_header_fields(value, ';')?.into_iter().skip(1) {
        let Some((name, value)) = parameter.split_once('=') else {
            if parameter.trim().eq_ignore_ascii_case(parameter_name) {
                return Err(bad_request(format!(
                    "The {parameter_name} media type parameter must have a value"
                )));
            }
            continue;
        };
        if !name.trim().eq_ignore_ascii_case(parameter_name) {
            continue;
        }
        if result.is_some() {
            return Err(bad_request(format!(
                "Multiple {parameter_name} media type parameters provided"
            )));
        }
        result = Some(unquote_media_type_parameter(value.trim())?);
    }
    Ok(result)
}

fn unquote_media_type_parameter(value: &str) -> Result<&str, HttpError> {
    if let Some(value) = value.strip_prefix('"') {
        value
            .strip_suffix('"')
            .ok_or_else(|| bad_request("A media type parameter has an unterminated quoted value"))
    } else {
        Ok(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum SparqlVersion {
    V11,
    #[cfg(feature = "rdf-12")]
    V12Basic,
    #[cfg(feature = "rdf-12")]
    V12,
}

impl SparqlVersion {
    fn parse(value: &str) -> Result<Self, HttpError> {
        match value {
            "1.1" => Ok(Self::V11),
            #[cfg(feature = "rdf-12")]
            "1.2-basic" => Ok(Self::V12Basic),
            #[cfg(feature = "rdf-12")]
            "1.2" => Ok(Self::V12),
            _ => Err(bad_request(format!(
                "Unsupported SPARQL version announcement '{value}'"
            ))),
        }
    }
}

impl From<SparqlVersion> for LibrarySparqlVersion {
    fn from(value: SparqlVersion) -> Self {
        match value {
            SparqlVersion::V11 => Self::V1_1,
            #[cfg(feature = "rdf-12")]
            SparqlVersion::V12Basic => Self::V1_2Basic,
            #[cfg(feature = "rdf-12")]
            SparqlVersion::V12 => Self::V1_2,
        }
    }
}

fn validate_sparql_version(
    source: &str,
    request_version: Option<SparqlVersion>,
) -> Result<Option<SparqlVersion>, HttpError> {
    // SPARQL 1.2 Query §4.3 says the protocol version announcement is
    // considered only when the operation has no VERSION directive.
    let syntax_version = sparql_syntax_version(source)?;
    let Some(effective_version) = syntax_version.or(request_version) else {
        return Ok(None);
    };
    let code = mask_sparql_comments_strings_and_iris(source);
    match effective_version {
        SparqlVersion::V11 => {
            const SPARQL_12_FUNCTIONS: &[&[u8]] = &[
                b"LANGDIR",
                b"STRLANGDIR",
                b"hasLANG",
                b"hasLANGDIR",
                b"isTRIPLE",
                b"TRIPLE",
                b"SUBJECT",
                b"PREDICATE",
                b"OBJECT",
            ];
            if contains_bytes(&code, b"<<")
                || contains_bytes(&code, b"{|")
                || contains_unescaped_byte(&code, b'~')
                || has_directional_language_tag(&code)
                || SPARQL_12_FUNCTIONS
                    .iter()
                    .any(|name| has_sparql_function_call(&code, name))
            {
                return Err(bad_request(
                    "The effective SPARQL 1.1 version does not allow SPARQL 1.2 syntax",
                ));
            }
        }
        #[cfg(feature = "rdf-12")]
        SparqlVersion::V12Basic => {
            const TRIPLE_TERM_FUNCTIONS: &[&[u8]] =
                &[b"isTRIPLE", b"TRIPLE", b"SUBJECT", b"PREDICATE", b"OBJECT"];
            if contains_bytes(&code, b"<<(")
                || has_nested_reified_triple(&code)
                || TRIPLE_TERM_FUNCTIONS
                    .iter()
                    .any(|name| has_sparql_function_call(&code, name))
            {
                return Err(bad_request(
                    "The effective SPARQL 1.2-basic version does not allow triple terms or nested reified triple patterns",
                ));
            }
        }
        #[cfg(feature = "rdf-12")]
        SparqlVersion::V12 => {}
    }
    Ok(Some(effective_version))
}

fn sparql_syntax_version(source: &str) -> Result<Option<SparqlVersion>, HttpError> {
    let bytes = source.as_bytes();
    let mut cursor = 0;
    let mut version = None;
    loop {
        skip_sparql_space_and_comments(bytes, &mut cursor);
        if consume_ascii_keyword(bytes, &mut cursor, b"BASE") {
            skip_sparql_space_and_comments(bytes, &mut cursor);
            if !consume_sparql_iriref(bytes, &mut cursor) {
                break; // The full parser will report the malformed declaration.
            }
        } else if consume_ascii_keyword(bytes, &mut cursor, b"PREFIX") {
            skip_sparql_space_and_comments(bytes, &mut cursor);
            let Some(relative_colon) = bytes[cursor..].iter().position(|byte| *byte == b':') else {
                break;
            };
            if bytes[cursor..cursor + relative_colon]
                .iter()
                .any(|byte| byte.is_ascii_whitespace() || *byte == b'<' || *byte == b'#')
            {
                break;
            }
            cursor += relative_colon + 1;
            skip_sparql_space_and_comments(bytes, &mut cursor);
            if !consume_sparql_iriref(bytes, &mut cursor) {
                break;
            }
        } else if consume_ascii_keyword(bytes, &mut cursor, b"VERSION") {
            skip_sparql_space_and_comments(bytes, &mut cursor);
            let label = consume_sparql_short_string(source, &mut cursor)?;
            let parsed = SparqlVersion::parse(label)?;
            version = Some(version.map_or(parsed, |previous: SparqlVersion| previous.max(parsed)));
        } else {
            break;
        }
    }
    Ok(version)
}

fn skip_sparql_space_and_comments(bytes: &[u8], cursor: &mut usize) {
    loop {
        while bytes.get(*cursor).is_some_and(u8::is_ascii_whitespace) {
            *cursor += 1;
        }
        if bytes.get(*cursor) != Some(&b'#') {
            return;
        }
        while bytes.get(*cursor).is_some_and(|byte| *byte != b'\n') {
            *cursor += 1;
        }
    }
}

fn consume_ascii_keyword(bytes: &[u8], cursor: &mut usize, keyword: &[u8]) -> bool {
    let Some(candidate) = bytes.get(*cursor..*cursor + keyword.len()) else {
        return false;
    };
    if !candidate.eq_ignore_ascii_case(keyword)
        || bytes
            .get(*cursor + keyword.len())
            .is_some_and(|byte| is_sparql_name_byte(*byte))
    {
        return false;
    }
    *cursor += keyword.len();
    true
}

fn consume_sparql_iriref(bytes: &[u8], cursor: &mut usize) -> bool {
    if bytes.get(*cursor) != Some(&b'<') {
        return false;
    }
    if let Some(relative_end) = bytes[*cursor + 1..].iter().position(|byte| *byte == b'>') {
        *cursor += relative_end + 2;
        true
    } else {
        false
    }
}

fn consume_sparql_short_string<'a>(
    source: &'a str,
    cursor: &mut usize,
) -> Result<&'a str, HttpError> {
    let bytes = source.as_bytes();
    let Some(quote @ (b'\'' | b'"')) = bytes.get(*cursor).copied() else {
        return Err(bad_request(
            "A SPARQL VERSION directive must use a short quoted string",
        ));
    };
    if bytes.get(*cursor + 1) == Some(&quote) && bytes.get(*cursor + 2) == Some(&quote) {
        return Err(bad_request(
            "A SPARQL VERSION directive must use a short quoted string",
        ));
    }
    let start = *cursor + 1;
    let mut current = start;
    while let Some(byte) = bytes.get(current) {
        if *byte == b'\\' {
            current += 2;
        } else if *byte == quote {
            let label = source
                .get(start..current)
                .ok_or_else(|| bad_request("Invalid UTF-8 boundary in VERSION directive"))?;
            *cursor = current + 1;
            return Ok(label);
        } else if matches!(*byte, b'\r' | b'\n') {
            break;
        } else {
            current += 1;
        }
    }
    Err(bad_request("Unterminated SPARQL VERSION directive"))
}

fn mask_sparql_comments_strings_and_iris(source: &str) -> Vec<u8> {
    let bytes = source.as_bytes();
    let mut code = bytes.to_vec();
    let mut cursor = 0;
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'#' if !is_backslash_escaped(bytes, cursor) => {
                let start = cursor;
                while cursor < bytes.len() && bytes[cursor] != b'\n' {
                    cursor += 1;
                }
                code[start..cursor].fill(b' ');
            }
            quote @ (b'\'' | b'"') if !is_backslash_escaped(bytes, cursor) => {
                let start = cursor;
                let long =
                    bytes.get(cursor + 1) == Some(&quote) && bytes.get(cursor + 2) == Some(&quote);
                cursor += if long { 3 } else { 1 };
                while cursor < bytes.len() {
                    if bytes[cursor] == b'\\' {
                        cursor = (cursor + 2).min(bytes.len());
                    } else if long
                        && bytes.get(cursor) == Some(&quote)
                        && bytes.get(cursor + 1) == Some(&quote)
                        && bytes.get(cursor + 2) == Some(&quote)
                    {
                        cursor += 3;
                        break;
                    } else if !long && bytes[cursor] == quote {
                        cursor += 1;
                        break;
                    } else {
                        cursor += 1;
                    }
                }
                code[start..cursor].fill(b' ');
            }
            b'<' if bytes.get(cursor + 1) != Some(&b'<')
                && bytes.get(cursor + 1) != Some(&b'=') =>
            {
                if let Some(end) = sparql_iriref_end(bytes, cursor) {
                    code[cursor..end].fill(b' ');
                    cursor = end;
                } else {
                    cursor += 1;
                }
            }
            _ => cursor += 1,
        }
    }
    code
}

fn sparql_iriref_end(bytes: &[u8], start: usize) -> Option<usize> {
    for (offset, byte) in bytes.get(start + 1..)?.iter().enumerate() {
        if *byte == b'>' {
            return Some(start + offset + 2);
        }
        if byte.is_ascii_whitespace()
            || matches!(*byte, b'<' | b'"' | b'{' | b'}' | b'|' | b'^' | b'`')
        {
            return None;
        }
    }
    None
}

fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
    memchr::memmem::find(haystack, needle).is_some()
}

fn contains_unescaped_byte(bytes: &[u8], target: u8) -> bool {
    bytes
        .iter()
        .enumerate()
        .any(|(position, byte)| *byte == target && !is_backslash_escaped(bytes, position))
}

fn is_backslash_escaped(bytes: &[u8], position: usize) -> bool {
    let mut backslashes = 0;
    let mut cursor = position;
    while cursor > 0 && bytes.get(cursor - 1) == Some(&b'\\') {
        backslashes += 1;
        cursor -= 1;
    }
    backslashes % 2 == 1
}

fn has_sparql_function_call(code: &[u8], name: &[u8]) -> bool {
    if name.len() > code.len() {
        return false;
    }
    for start in 0..=code.len() - name.len() {
        if !code[start..start + name.len()].eq_ignore_ascii_case(name)
            || start
                .checked_sub(1)
                .and_then(|previous| code.get(previous))
                .is_some_and(|byte| is_sparql_name_byte(*byte))
            || code
                .get(start + name.len())
                .is_some_and(|byte| is_sparql_name_byte(*byte))
        {
            continue;
        }
        let mut after = start + name.len();
        while code.get(after).is_some_and(u8::is_ascii_whitespace) {
            after += 1;
        }
        if code.get(after) == Some(&b'(') {
            return true;
        }
    }
    false
}

fn is_sparql_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b':' | b'?' | b'$')
}

fn has_directional_language_tag(code: &[u8]) -> bool {
    for marker in [b"--ltr".as_slice(), b"--rtl".as_slice()] {
        if marker.len() > code.len() {
            continue;
        }
        for position in 0..=code.len() - marker.len() {
            if !code[position..position + marker.len()].eq_ignore_ascii_case(marker)
                || code
                    .get(position + marker.len())
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
            {
                continue;
            }
            let mut tag_start = position;
            while tag_start > 0
                && code
                    .get(tag_start - 1)
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'-')
            {
                tag_start -= 1;
            }
            if tag_start > 0 && code.get(tag_start - 1) == Some(&b'@') {
                return true;
            }
        }
    }
    false
}

#[cfg(feature = "rdf-12")]
fn has_nested_reified_triple(code: &[u8]) -> bool {
    let mut depth = 0_u32;
    let mut cursor = 0;
    while cursor + 1 < code.len() {
        if code[cursor..].starts_with(b"<<(") {
            return true;
        }
        if code[cursor..].starts_with(b"<<") {
            depth += 1;
            if depth > 1 {
                return true;
            }
            cursor += 2;
        } else if code[cursor..].starts_with(b">>") {
            depth = depth.saturating_sub(1);
            cursor += 2;
        } else {
            cursor += 1;
        }
    }
    false
}

struct SparqlRequestContentType {
    media_type: String,
    version: Option<SparqlVersion>,
}

fn sparql_request_content_type(
    request: &Request<Body>,
) -> Result<Option<SparqlRequestContentType>, HttpError> {
    let Some(value) = request.headers().get(CONTENT_TYPE) else {
        return Ok(None);
    };
    let value = value
        .to_str()
        .map_err(|_| bad_request("The Content-Type header should be a valid ASCII string"))?;
    let mut parts = value.split(';');
    let media_type = parts.next().unwrap_or_default().trim().to_ascii_lowercase();
    let is_direct_sparql = matches!(
        media_type.as_str(),
        "application/sparql-query" | "application/sparql-update"
    );
    let mut version = None;
    if is_direct_sparql {
        for parameter in parts {
            let parameter = parameter.trim();
            let (name, value) = parameter.split_once('=').ok_or_else(|| {
                bad_request(format!(
                    "Invalid {media_type} media type parameter '{parameter}'"
                ))
            })?;
            if !name.trim().eq_ignore_ascii_case("version") {
                return Err(bad_request(format!(
                    "Unknown {media_type} media type parameter '{}'",
                    name.trim()
                )));
            }
            if version.is_some() {
                return Err(bad_request(
                    "Multiple version media type parameters provided",
                ));
            }
            let value = unquote_media_type_parameter(value.trim())?;
            version = Some(SparqlVersion::parse(value)?);
        }
    } else if media_type == "application/x-www-form-urlencoded" {
        for parameter in parts {
            if parameter
                .split_once('=')
                .is_some_and(|(name, _)| name.trim().eq_ignore_ascii_case("version"))
            {
                return Err(bad_request(
                    "A SPARQL version announcement for application/x-www-form-urlencoded must be a form parameter, not a media type parameter",
                ));
            }
        }
    }
    Ok(Some(SparqlRequestContentType {
        media_type,
        version,
    }))
}

fn rdf_response_media_type(format: RdfResponseFormat) -> &'static str {
    format.media_type()
}

fn sparql_evaluator() -> SparqlEvaluator {
    SparqlEvaluator::new().with_deny_all_egress_policy()
}

fn service_description_response(
    request: &Request<Body>,
    kind: EndpointKind,
    union_default_graph: bool,
    entailment: QueryEntailment,
    sparql_evaluator: &SparqlEvaluator,
) -> Result<Response<Body>, HttpError> {
    let selected = rdf_content_negotiation(request)?;
    let description = generate_service_description(
        selected,
        kind,
        union_default_graph,
        entailment,
        request_original_target_url(request)?.to_string().into(),
        sparql_evaluator,
    );
    Response::builder()
        .header(CONTENT_TYPE, rdf_response_media_type(selected))
        .body(description.into())
        .map_err(internal_server_error)
}

fn web_load_graph(
    store: &Store,
    request: &mut Request<Body>,
    format: RdfFormat,
    to_graph_name: &GraphName,
) -> Result<(), HttpError> {
    let args = RequestParams::from_request_url(request);
    let base_iri = if let GraphName::NamedNode(graph_name) = to_graph_name {
        Some(graph_name.as_str())
    } else {
        None
    };
    let mut parser = RdfParser::from_format(format)
        .without_named_graphs()
        .with_default_graph(to_graph_name.clone());
    if args.contains("lenient") {
        parser = parser.lenient();
    }
    if let Some(base_iri) = base_iri {
        parser = parser.with_base_iri(base_iri).map_err(bad_request)?;
    }
    if args.contains("no_transaction") {
        let mut loader = web_bulk_loader(store, request);
        loader
            .load_from_reader(parser, request.body_mut())
            .map_err(loader_to_http_error)?;
        loader.commit().map_err(internal_server_error)
    } else {
        store
            .load_from_reader(parser, request.body_mut())
            .map_err(loader_to_http_error)
    }
}

fn web_load_dataset(
    store: &Store,
    request: &mut Request<Body>,
    format: RdfFormat,
) -> Result<(), HttpError> {
    let args = RequestParams::from_request_url(request);
    let mut parser = RdfParser::from_format(format);
    if args.contains("lenient") {
        parser = parser.lenient();
    }
    if args.contains("no_transaction") {
        let mut loader = web_bulk_loader(store, request);
        loader
            .load_from_reader(parser, request.body_mut())
            .map_err(loader_to_http_error)?;
        loader.commit().map_err(internal_server_error)
    } else {
        store
            .load_from_reader(parser, request.body_mut())
            .map_err(loader_to_http_error)
    }
}

fn web_bulk_loader<'a>(store: &'a Store, request: &Request<Body>) -> BulkLoader<'a> {
    let start = Instant::now();
    let mut loader = store.bulk_loader().on_progress(move |size| {
        let elapsed = start.elapsed();
        eprintln!(
            "{} triples loaded in {}s ({} t/s)",
            size,
            elapsed.as_secs(),
            ((size as f64) / elapsed.as_secs_f64()).round()
        )
    });
    let args = RequestParams::from_request_url(request);
    if args.contains("lenient") {
        loader = loader.on_parse_error(move |e| {
            eprintln!("Parsing error: {e}");
            Ok(())
        })
    }
    loader
}

fn error(status: StatusCode, message: impl fmt::Display) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(message.to_string().into())
        .unwrap()
}

fn finalize_response(method: &Method, mut response: Response<Body>) -> Response<Body> {
    if *method == Method::HEAD {
        if response.body().len().is_some() {
            if let Err(error) = io::copy(response.body_mut(), &mut io::sink()) {
                response = crate::error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Failed to suppress the HEAD response body: {error}"),
                );
                drop(io::copy(response.body_mut(), &mut io::sink()));
            }
        } else {
            *response.body_mut() = Body::empty();
        }
    }
    response
}

fn bad_request(message: impl fmt::Display) -> HttpError {
    (StatusCode::BAD_REQUEST, message.to_string())
}

fn query_request_refused(message: impl fmt::Display) -> HttpError {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("Query request refused: {message}"),
    )
}

fn rdf_response_not_acceptable(message: impl fmt::Display) -> HttpError {
    (
        StatusCode::NOT_ACCEPTABLE,
        format!("The selected RDF representation cannot encode the result: {message}"),
    )
}

fn query_results_not_acceptable(message: impl fmt::Display) -> HttpError {
    (
        StatusCode::NOT_ACCEPTABLE,
        format!("The selected SPARQL Results representation cannot encode the result: {message}"),
    )
}

fn the_server_is_read_only() -> HttpError {
    (StatusCode::FORBIDDEN, "The server is read-only".into())
}

fn unsupported_media_type(content_type: &str) -> HttpError {
    (
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        format!("No supported content Content-Type given: {content_type}"),
    )
}

fn internal_server_error(message: impl fmt::Display) -> HttpError {
    eprintln!("Internal server error: {message}");
    (StatusCode::INTERNAL_SERVER_ERROR, message.to_string())
}

fn loader_to_http_error(e: LoaderError) -> HttpError {
    match e {
        LoaderError::Parsing(e) => bad_request(e),
        LoaderError::Storage(e) => internal_server_error(e),
        LoaderError::InvalidBaseIri { .. } => bad_request(e),
    }
}

/// Hacky tool to allow implementing read on top of a write loop
struct ReadForWrite<O, U: (Fn(O) -> io::Result<Option<O>>)> {
    buffer: Rc<RefCell<Vec<u8>>>,
    position: usize,
    add_more_data: U,
    state: Option<O>,
}

impl<O: 'static, U: (Fn(O) -> io::Result<Option<O>>) + 'static> ReadForWrite<O, U> {
    fn build_response(
        initial_state_builder: impl FnOnce(ReadForWriteWriter) -> io::Result<O>,
        add_more_data: U,
        content_type: &'static str,
    ) -> Result<Response<Body>, HttpError> {
        let buffer = Rc::new(RefCell::new(Vec::new()));
        let state = initial_state_builder(ReadForWriteWriter {
            buffer: Rc::clone(&buffer),
        })
        .map_err(internal_server_error)?;
        Response::builder()
            .header(CONTENT_TYPE, content_type)
            .body(Body::from_read(Self {
                buffer,
                position: 0,
                add_more_data,
                state: Some(state),
            }))
            .map_err(internal_server_error)
    }
}

impl<O, U: (Fn(O) -> io::Result<Option<O>>)> Read for ReadForWrite<O, U> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        while self.position == self.buffer.borrow().len() {
            // We read more data
            if let Some(state) = self.state.take() {
                self.buffer.borrow_mut().clear();
                self.position = 0;
                self.state = match (self.add_more_data)(state) {
                    Ok(state) => state,
                    Err(e) => {
                        eprintln!("Internal server error while streaming results: {e}");
                        self.buffer
                            .borrow_mut()
                            .write_all(e.to_string().as_bytes())?;
                        None
                    }
                }
            } else {
                return Ok(0); // End
            }
        }
        let buffer = self.buffer.borrow();
        let len = min(buffer.len() - self.position, buf.len());
        buf[..len].copy_from_slice(&buffer[self.position..self.position + len]);
        self.position += len;
        Ok(len)
    }
}

struct ReadForWriteWriter {
    buffer: Rc<RefCell<Vec<u8>>>,
}

impl Write for ReadForWriteWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.buffer.borrow_mut().write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }

    fn write_all(&mut self, buf: &[u8]) -> io::Result<()> {
        self.buffer.borrow_mut().write_all(buf)
    }
}

fn close_file_writer(writer: BufWriter<File>) -> io::Result<()> {
    let mut file = writer
        .into_inner()
        .map_err(io::IntoInnerError::into_error)?;
    file.flush()?;
    file.sync_all()
}

#[cfg(target_os = "linux")]
fn systemd_notify_ready() -> io::Result<()> {
    if let Some(path) = env::var_os("NOTIFY_SOCKET") {
        UnixDatagram::unbound()?.send_to(b"READY=1", path)?;
    }
    Ok(())
}

fn request_original_target_url<B>(request: &Request<B>) -> Result<Uri, HttpError> {
    let mut parts = request.uri().clone().into_parts();
    if let Some(host) = request.headers().get("X-Forwarded-Host") {
        parts.authority = Some(
            Authority::try_from(host.as_bytes())
                .map_err(|e| bad_request(format!("Bad X-Forwarded-Host header: {e}")))?,
        );
    }
    if let Some(proto) = request.headers().get("X-Forwarded-Proto") {
        parts.scheme = Some(
            Scheme::try_from(proto.as_bytes())
                .map_err(|e| bad_request(format!("Bad X-Forwarded-Proto header: {e}")))?,
        );
    }
    if let Some(forwarded) = request.headers().get("Forwarded") {
        for pair in forwarded.as_bytes().split(|c| *c == b';') {
            let Some((key_value_separation, _)) =
                pair.iter().enumerate().find(|(_, c)| **c == b'=')
            else {
                return Err(bad_request("Bad Forwarded header"));
            };
            let (key, value) = pair.split_at(key_value_separation);
            let value = value[1..].trim_ascii(); // We remove the split value
            match key.trim_ascii() {
                b"host" => {
                    parts.authority = Some(
                        Authority::try_from(value)
                            .map_err(|e| bad_request(format!("Bad Forwarded header: {e}")))?,
                    );
                }
                b"proto" => {
                    parts.scheme = Some(
                        Scheme::try_from(value.trim_ascii())
                            .map_err(|e| bad_request(format!("Bad Forwarded header: {e}")))?,
                    );
                }
                _ => (),
            }
        }
    }
    Uri::from_parts(parts).map_err(internal_server_error)
}

#[cfg(test)]
#[expect(clippy::panic_in_result_fn)]
mod tests {
    use super::*;
    use anyhow::{Result, anyhow};
    use assert_cmd::Command;
    use assert_fs::prelude::*;
    use assert_fs::{NamedTempFile, TempDir};
    use flate2::Compression;
    use flate2::write::GzEncoder;
    use oxhttp::model::header::{ACCEPT, LOCATION};
    use predicates::prelude::*;
    use std::fs::remove_dir_all;
    use std::io::read_to_string;
    use url::Url;

    fn cli_command() -> Command {
        let mut command = Command::new(env!("CARGO"));
        command
            .arg("run")
            .arg("--bin")
            .arg("oxigraph")
            .arg("--no-default-features");
        #[cfg(feature = "rocksdb-pkg-config")]
        command.arg("--features").arg("rocksdb-pkg-config");
        #[cfg(feature = "geosparql")]
        command.arg("--features").arg("geosparql");
        #[cfg(feature = "rdf-12")]
        command.arg("--features").arg("rdf-12");
        #[cfg(feature = "rdfs")]
        command.arg("--features").arg("rdfs");
        #[cfg(feature = "owl2-rl")]
        command.arg("--features").arg("owl2-rl");
        command.arg("--");
        command
    }

    fn initialized_cli_store(data: &'static str) -> Result<TempDir> {
        let store_dir = TempDir::new()?;
        cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--format")
            .arg("trig")
            .write_stdin(data)
            .assert()
            .success();
        Ok(store_dir)
    }

    fn assert_cli_state(store_dir: &TempDir, data: &'static str) {
        cli_command()
            .arg("dump")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--format")
            .arg("nq")
            .assert()
            .stdout(data)
            .success();
    }

    #[test]
    fn cli_help() {
        cli_command()
            .assert()
            .failure()
            .stdout("")
            .stderr(predicate::str::contains("Oxigraph"));
    }

    #[test]
    fn cli_load_optimize_and_dump_graph() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_file = NamedTempFile::new("input.ttl")?;
        input_file.write_str("<s> <http://example.com/p> <http://example.com/o> .")?;
        cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--file")
            .arg(input_file.path())
            .arg("--base")
            .arg("http://example.com/")
            .assert()
            .success();

        cli_command()
            .arg("optimize")
            .arg("--location")
            .arg(store_dir.path())
            .assert()
            .success();

        let output_file = NamedTempFile::new("output.nt")?;
        cli_command()
            .arg("dump")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--file")
            .arg(output_file.path())
            .arg("--graph")
            .arg("default")
            .assert()
            .success();
        output_file
            .assert("<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n");
        Ok(())
    }

    #[test]
    fn cli_load_file_errors_fail_the_command() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_file = NamedTempFile::new("invalid.nt")?;
        input_file.write_str("invalid")?;
        let missing_file = store_dir.child("missing.nt.gz");
        cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--file")
            .arg(input_file.path())
            .arg(missing_file.path())
            .assert()
            .failure()
            .stderr(
                predicate::str::contains("parallel bulk load failed for 2 of 2 files")
                    .and(predicate::str::contains("1. [load]"))
                    .and(predicate::str::contains("2. [open]")),
            );
        Ok(())
    }

    #[test]
    fn cli_load_can_fail_on_named_graphs() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_file = NamedTempFile::new("input.nq")?;
        input_file.write_str(
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/original> .",
        )?;
        cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--file")
            .arg(input_file.path())
            .arg("--fail-on-named-graphs")
            .assert()
            .failure()
            .stderr(predicate::str::contains("Named graphs are not allowed"));
        assert_cli_state(&store_dir, "");

        cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .args(["--format", "nq", "--fail-on-named-graphs"])
            .write_stdin(
                "<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/original> .",
            )
            .assert()
            .failure()
            .stderr(predicate::str::contains("Named graphs are not allowed"));
        assert_cli_state(&store_dir, "");

        let json_ld_file = NamedTempFile::new("input.jsonld")?;
        json_ld_file.write_str(
            r#"{"@id":"http://example.com/s","http://example.com/p":{"@id":"http://example.com/o"}}"#,
        )?;
        cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--file")
            .arg(json_ld_file.path())
            .arg("--graph")
            .arg("http://example.com/target")
            .arg("--fail-on-named-graphs")
            .assert()
            .success();
        assert_cli_state(
            &store_dir,
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/target> .\n",
        );
        Ok(())
    }

    #[test]
    fn cli_load_and_dump_dataset() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_file = NamedTempFile::new("input.nq")?;
        input_file
            .write_str("<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .")?;
        cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--file")
            .arg(input_file.path())
            .assert()
            .success();

        let output_file = NamedTempFile::new("output.nq")?;
        cli_command()
            .arg("dump")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--file")
            .arg(output_file.path())
            .assert()
            .success();
        output_file
            .assert("<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/g> .\n");
        Ok(())
    }

    #[test]
    fn cli_load_gzip_dataset() -> Result<()> {
        let store_dir = TempDir::new()?;
        let file = NamedTempFile::new("sample.nq.gz")?;
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(b"<http://example.com/s> <http://example.com/p> <http://example.com/o> .")?;
        file.write_binary(&encoder.finish()?)?;
        cli_command()
            .arg("load")
            .arg("-l")
            .arg(store_dir.path())
            .arg("-f")
            .arg(file.path())
            .assert()
            .success();

        cli_command()
            .arg("dump")
            .arg("-l")
            .arg(store_dir.path())
            .arg("--format")
            .arg("nq")
            .assert()
            .success()
            .stdout("<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n");
        Ok(())
    }

    #[test]
    fn parallel_load_reports_all_open_failures_and_keeps_successful_files() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_dir = TempDir::new()?;
        let good_file = input_dir.child("good.nt");
        good_file.write_str(
            "<http://example.com/good> <http://example.com/p> <http://example.com/o> .\n",
        )?;
        let first_missing = input_dir.child("z-missing.nt.gz");
        let second_missing = input_dir.child("a-missing.nt.gz");

        let assert = cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--format")
            .arg("nt")
            .arg("--file")
            .arg(first_missing.path())
            .arg(good_file.path())
            .arg(second_missing.path())
            .assert()
            .failure();
        let stderr = String::from_utf8(assert.get_output().stderr.clone())?;
        assert!(stderr.contains(
            "parallel bulk load failed for 2 of 3 files; successful files remain committed"
        ));
        let first_failure = format!("1. [open] {}", first_missing.path().display());
        let second_failure = format!("3. [open] {}", second_missing.path().display());
        assert!(stderr.contains(&first_failure));
        assert!(stderr.contains(&second_failure));
        assert!(stderr.find(&first_failure) < stderr.find(&second_failure));
        assert!(stderr.contains("each failed file remains uncommitted"));

        assert_cli_state(
            &store_dir,
            "<http://example.com/good> <http://example.com/p> <http://example.com/o> .\n",
        );
        Ok(())
    }

    #[test]
    fn parallel_load_parse_failure_is_file_atomic() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_dir = TempDir::new()?;
        let bad_file = input_dir.child("bad.nt");
        bad_file.write_str(
            "<http://example.com/leaked> <http://example.com/p> <http://example.com/o> .\nnot valid N-Triples\n",
        )?;
        let good_file = input_dir.child("good.nt");
        good_file.write_str(
            "<http://example.com/good> <http://example.com/p> <http://example.com/o> .\n",
        )?;

        let assert = cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--format")
            .arg("nt")
            .arg("--file")
            .arg(bad_file.path())
            .arg(good_file.path())
            .assert()
            .failure();
        let stderr = String::from_utf8(assert.get_output().stderr.clone())?;
        assert!(stderr.contains(
            "parallel bulk load failed for 1 of 2 files; successful files remain committed"
        ));
        assert!(stderr.contains(&format!("1. [load] {}", bad_file.path().display())));
        assert!(stderr.contains("each failed file remains uncommitted"));

        assert_cli_state(
            &store_dir,
            "<http://example.com/good> <http://example.com/p> <http://example.com/o> .\n",
        );
        Ok(())
    }

    #[test]
    fn parallel_load_collects_commit_failures_in_input_order() -> Result<()> {
        let store_dir = TempDir::new()?;
        drop(Store::open(store_dir.path())?);
        let store = Store::open_read_only(store_dir.path())?;
        let input_dir = TempDir::new()?;
        let first_file = input_dir.child("z-first.nt");
        first_file.write_str(
            "<http://example.com/first> <http://example.com/p> <http://example.com/o> .\n",
        )?;
        let second_file = input_dir.child("a-second.nt");
        second_file.write_str(
            "<http://example.com/second> <http://example.com/p> <http://example.com/o> .\n",
        )?;

        let error = parallel_bulk_load_files(
            &store,
            vec![first_file.path().to_owned(), second_file.path().to_owned()],
            Some(RdfFormat::NTriples),
            None,
            None,
            false,
            false,
            false,
        )
        .unwrap_err();
        let message = format!("{error:#}");
        assert!(message.contains("parallel bulk load failed for 2 of 2 files"));
        let first_failure = format!("1. [commit] {}", first_file.path().display());
        let second_failure = format!("2. [commit] {}", second_file.path().display());
        assert!(message.contains(&first_failure));
        assert!(message.contains(&second_failure));
        assert!(message.find(&first_failure) < message.find(&second_failure));
        Ok(())
    }

    #[test]
    fn cli_load_and_dump_named_graph() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_file = NamedTempFile::new("input.nt")?;
        input_file.write_str(
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n",
        )?;
        cli_command()
            .arg("load")
            .arg("-l")
            .arg(store_dir.path())
            .arg("-f")
            .arg(input_file.path())
            .arg("--graph")
            .arg("http://example.com/g")
            .assert()
            .success();

        let output_file = NamedTempFile::new("output.nt")?;
        cli_command()
            .arg("dump")
            .arg("-l")
            .arg(store_dir.path())
            .arg("-f")
            .arg(output_file.path())
            .arg("--graph")
            .arg("http://example.com/g")
            .assert()
            .success();
        output_file
            .assert("<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n");
        Ok(())
    }

    #[test]
    fn cli_load_and_dump_with_format() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_file = NamedTempFile::new("input")?;
        input_file
            .write_str("<http://example.com/s> <http://example.com/p> <http://example.com/o> .")?;
        cli_command()
            .arg("load")
            .arg("-l")
            .arg(store_dir.path())
            .arg("-f")
            .arg(input_file.path())
            .arg("--format")
            .arg("nt")
            .assert()
            .success();

        let output_file = NamedTempFile::new("output")?;
        cli_command()
            .arg("dump")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--file")
            .arg(output_file.path())
            .arg("--graph")
            .arg("default")
            .arg("--format")
            .arg("nt")
            .assert()
            .success();
        output_file
            .assert("<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n");
        Ok(())
    }

    #[test]
    fn cli_load_from_stdin_and_dump_to_stdout() -> Result<()> {
        let store_dir = TempDir::new()?;
        cli_command()
            .arg("load")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--format")
            .arg("nq")
            .write_stdin("<http://example.com/s> <http://example.com/p> <http://example.com/o> .")
            .assert()
            .success();

        cli_command()
            .arg("dump")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--format")
            .arg("nq")
            .assert()
            .success()
            .stdout("<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n");
        Ok(())
    }

    #[test]
    fn cli_backup() -> Result<()> {
        let store_dir = initialized_cli_store(
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .",
        )?;

        let backup_dir = TempDir::new()?;
        remove_dir_all(backup_dir.path())?; // The directory should not exist yet
        cli_command()
            .arg("backup")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--destination")
            .arg(backup_dir.path())
            .assert()
            .success();

        assert_cli_state(
            &store_dir,
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n",
        );
        Ok(())
    }

    #[test]
    fn cli_ask_query_inline() -> Result<()> {
        let store_dir = initialized_cli_store(
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .",
        )?;
        cli_command()
            .arg("query")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--query")
            .arg("ASK { <s> <p> <o> }")
            .arg("--query-base")
            .arg("http://example.com/")
            .arg("--results-format")
            .arg("csv")
            .assert()
            .stdout("true")
            .success();
        Ok(())
    }

    #[cfg(all(feature = "rdf-12", feature = "rdfs"))]
    #[test]
    fn cli_query_entailment_is_explicit_and_bounded() -> Result<()> {
        let store_dir = initialized_cli_store(concat!(
            "<urn:Child> <http://www.w3.org/2000/01/rdf-schema#subClassOf> <urn:Parent> .",
            "<urn:alice> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <urn:Child> .",
        ))?;
        let query = || {
            let mut command = cli_command();
            command
                .arg("query")
                .arg("--location")
                .arg(store_dir.path())
                .arg("--query")
                .arg("ASK { <urn:alice> a <urn:Parent> }")
                .arg("--results-format")
                .arg("csv");
            command
        };
        query().assert().stdout("false").success();
        query()
            .arg("--entailment")
            .arg("rdfs-1.2-finite")
            .assert()
            .stdout("true")
            .success();
        Ok(())
    }

    #[test]
    fn cli_rejects_claims_of_exact_unimplemented_entailment() -> Result<()> {
        let Err(error) = Args::try_parse_from([
            "oxigraph",
            "query",
            "--location",
            "unused",
            "--query",
            "ASK {}",
            "--results-format",
            "csv",
            "--entailment",
            "rdfs",
        ]) else {
            return Err(anyhow!("exact RDFS must not be selectable"));
        };
        ensure!(
            error.kind() == clap::error::ErrorKind::InvalidValue,
            "unexpected clap error kind: {:?}",
            error.kind()
        );
        Ok(())
    }

    #[test]
    fn cli_construct_query_stdin() -> Result<()> {
        let store_dir = initialized_cli_store(
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .",
        )?;
        cli_command()
            .arg("query")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--query-base")
            .arg("http://example.com/")
            .arg("--results-format")
            .arg("nt")
            .write_stdin("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }")
            .assert()
            .stdout("<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n")
            .success();
        Ok(())
    }

    #[test]
    fn cli_select_query_file() -> Result<()> {
        let store_dir = initialized_cli_store(
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .",
        )?;
        let input_file = NamedTempFile::new("input.rq")?;
        input_file.write_str("SELECT ?s WHERE { ?s ?p ?o }")?;
        let output_file = NamedTempFile::new("output.tsv")?;
        cli_command()
            .arg("query")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--query-file")
            .arg(input_file.path())
            .arg("--results-file")
            .arg(output_file.path())
            .assert()
            .success();
        output_file.assert("?s\n<http://example.com/s>\n");
        Ok(())
    }

    #[test]
    fn cli_simple_query_stats_preserve_union_dataset() -> Result<()> {
        let store_dir = initialized_cli_store(concat!(
            "<urn:default> <urn:p> <urn:o> . ",
            "<urn:g1> { <urn:named> <urn:p> <urn:o> } ",
            "<urn:g2> { <urn:named> <urn:p> <urn:o> }",
        ))?;
        let explanation = NamedTempFile::new("explain.json")?;
        cli_command()
            .arg("query")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--query")
            .arg("SELECT ?s WHERE { ?s <urn:p> <urn:o> }")
            .arg("--union-default-graph")
            .arg("--entailment")
            .arg("simple")
            .arg("--stats")
            .arg("--explain-file")
            .arg(explanation.path())
            .arg("--results-format")
            .arg("csv")
            .assert()
            .stdout("s\r\nurn:named\r\n")
            .success();
        explanation.assert(predicate::str::contains("number of results"));
        Ok(())
    }

    #[test]
    fn cli_ask_union_default_graph() -> Result<()> {
        let store_dir = initialized_cli_store(
            "GRAPH <http://example.com/g> { <http://example.com/s> <http://example.com/p> <http://example.com/o> }",
        )?;
        cli_command()
            .arg("query")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--query")
            .arg("ASK { ?s ?p ?o }")
            .arg("--results-format")
            .arg("tsv")
            .arg("--union-default-graph")
            .assert()
            .stdout("true")
            .success();
        Ok(())
    }

    #[test]
    fn cli_update_inline() -> Result<()> {
        let store_dir = TempDir::new()?;
        cli_command()
            .arg("update")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--update")
            .arg("INSERT DATA { <s> <p> <o> }")
            .arg("--update-base")
            .arg("http://example.com/")
            .assert()
            .success();
        assert_cli_state(
            &store_dir,
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n",
        );
        Ok(())
    }

    #[test]
    fn cli_construct_update_stdin() -> Result<()> {
        let store_dir = TempDir::new()?;
        cli_command()
            .arg("update")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--update-base")
            .arg("http://example.com/")
            .write_stdin("INSERT DATA { <s> <p> <o> }")
            .assert()
            .success();
        assert_cli_state(
            &store_dir,
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n",
        );
        Ok(())
    }

    #[test]
    fn cli_update_file() -> Result<()> {
        let store_dir = TempDir::new()?;
        let input_file = NamedTempFile::new("input.rq")?;
        input_file.write_str(
            "INSERT DATA { <http://example.com/s> <http://example.com/p> <http://example.com/o> }",
        )?;
        cli_command()
            .arg("update")
            .arg("--location")
            .arg(store_dir.path())
            .arg("--update-file")
            .arg(input_file.path())
            .assert()
            .success();
        assert_cli_state(
            &store_dir,
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n",
        );
        Ok(())
    }

    #[test]
    fn cli_convert_file() -> Result<()> {
        let input_file = NamedTempFile::new("input.ttl")?;
        input_file.write_str("@prefix schema: <http://schema.org/> .\n<#me> a schema:Person ;\n\tschema:name \"Foo Bar\"@en .\n")?;
        let output_file = NamedTempFile::new("output.rdf")?;
        cli_command()
            .arg("convert")
            .arg("--from-file")
            .arg(input_file.path())
            .arg("--from-base")
            .arg("http://example.com/")
            .arg("--to-file")
            .arg(output_file.path())
            .assert()
            .success();
        output_file
            .assert("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rdf:RDF xml:base=\"http://example.com/\" xmlns:schema=\"http://schema.org/\" xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" xmlns:its=\"http://www.w3.org/2005/11/its\">\n\t<schema:Person rdf:about=\"#me\">\n\t\t<schema:name xml:lang=\"en\">Foo Bar</schema:name>\n\t</schema:Person>\n</rdf:RDF>");
        Ok(())
    }

    #[test]
    fn cli_convert_from_default_graph_to_named_graph() {
        cli_command()
            .arg("convert")
            .arg("--from-format")
            .arg("trig")
            .arg("--to-format")
            .arg("nq")
            .arg("--from-default-graph")
            .arg("--to-graph")
            .arg("http://example.com/t")
            .write_stdin("@base <http://example.com/> . <s> <p> <o> . <g> { <sg> <pg> <og> . }")
            .assert()
            .stdout("<http://example.com/s> <http://example.com/p> <http://example.com/o> <http://example.com/t> .\n")
            .success();
    }

    #[test]
    fn cli_convert_from_named_graph() {
        cli_command()
            .arg("convert")
            .arg("--from-format")
            .arg("trig")
            .arg("--to-format")
            .arg("nq")
            .arg("--from-graph")
            .arg("http://example.com/g")
            .write_stdin("@base <http://example.com/> . <s> <p> <o> . <g> { <sg> <pg> <og> . }")
            .assert()
            .stdout("<http://example.com/sg> <http://example.com/pg> <http://example.com/og> .\n");
    }

    #[test]
    fn convert_preserves_and_maps_empty_named_graph_topology() -> Result<()> {
        let source_graph = NamedNode::new("http://example.com/source")?;
        let target_graph = NamedNode::new("http://example.com/target")?;
        let output = do_convert(
            RdfParser::from_format(RdfFormat::TriG),
            b"<http://example.com/source> {}".as_slice(),
            RdfSerializer::from_format(RdfFormat::TriG),
            Vec::new(),
            false,
            &Some(source_graph.clone().into()),
            &target_graph.clone().into(),
            None,
        )?;
        let dataset = RdfParser::from_format(RdfFormat::TriG)
            .for_slice(&output)
            .collect_dataset()?;
        assert!(dataset.contains_named_graph(&target_graph));
        assert!(!dataset.contains_named_graph(&source_graph));
        Ok(())
    }

    #[test]
    fn convert_fails_if_empty_graph_topology_is_not_representable() {
        let error = do_convert(
            RdfParser::from_format(RdfFormat::TriG),
            b"<http://example.com/empty> {}".as_slice(),
            RdfSerializer::from_format(RdfFormat::NQuads),
            Vec::new(),
            false,
            &None,
            &GraphName::DefaultGraph,
            None,
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("cannot represent an empty named graph")
        );
    }

    #[test]
    fn cli_convert_to_base() {
        cli_command()
            .arg("convert")
            .arg("--from-format")
            .arg("ttl")
            .arg("--to-format")
            .arg("ttl")
            .arg("--to-base")
            .arg("http://example.com")
            .write_stdin("@base <http://example.com/> . <s> <p> <o> .")
            .assert()
            .stdout("@base <http://example.com> .\n</s> </p> </o> .\n");
    }

    #[test]
    fn cli_convert_with_context() -> Result<()> {
        let context_file = NamedTempFile::new("context.jsonld")?;
        context_file.write_str("{\"@context\":{\"@vocab\":\"http://schema.org/\"}}")?;
        cli_command()
            .arg("convert")
            .arg("--from-format")
            .arg("jsonld")
            .arg("--to-format")
            .arg("nt")
            .write_stdin(format!(
                "{{\"@context\":\"{}\",\"@id\":\"http://example.com\",\"name\":\"example\"}}",
                Url::from_file_path(context_file.path())
                    .map_err(|()| anyhow!("Invalid context file path"))?
            ))
            .assert()
            .stdout("<http://example.com> <http://schema.org/name> \"example\" .\n");
        Ok(())
    }

    #[test]
    fn get_ui() -> Result<()> {
        ServerTest::new()?.test_status(
            Request::builder().uri("http://localhost/").body(())?,
            StatusCode::OK,
        )
    }

    #[test]
    fn post_dataset_file_to_graph_store_root_is_rejected() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store")
            .header(CONTENT_TYPE, "application/trig")
            .body("<http://example.com> <http://example.com> <http://example.com> .")?;
        ServerTest::new()?.test_status(request, StatusCode::BAD_REQUEST)
    }

    #[test]
    fn post_wrong_file() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store")
            .header(CONTENT_TYPE, "application/trig")
            .body("<http://example.com>")?;
        ServerTest::new()?.test_status(request, StatusCode::BAD_REQUEST)
    }

    #[test]
    fn post_unsupported_file() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store")
            .header(CONTENT_TYPE, "text/foo")
            .body(())?;
        ServerTest::new()?.test_status(request, StatusCode::UNSUPPORTED_MEDIA_TYPE)
    }

    #[test]
    fn get_query() -> Result<()> {
        let server = ServerTest::new()?;

        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store")
            .header(CONTENT_TYPE, "application/trig")
            .body("<http://example.com> <http://example.com> <http://example.com> .")?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "text/csv")
            .body(())?;
        server.test_body(
            request,
            "s,p,o\r\nhttp://example.com,http://example.com,http://example.com\r\n",
        )
    }

    #[test]
    fn get_query_accept_star() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "*/*")
            .body(())?;
        ServerTest::new()?.test_body(
            request,
            r#"{"head":{"vars":["s","p","o"]},"results":{"bindings":[]}}"#,
        )
    }

    #[test]
    fn get_query_accept_substar() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "text/*")
            .body(())?;
        ServerTest::new()?.test_body(request, "s,p,o\r\n")
    }

    #[test]
    fn get_query_accept_specific_exclusion() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(
                ACCEPT,
                "*/*;q=1, application/sparql-results+json;q=0, text/csv;q=0.5",
            )
            .body(())?;
        assert_eq!(
            ServerTest::new()?.exec(request).headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static("application/sparql-results+xml"))
        );
        Ok(())
    }

    #[test]
    fn get_query_accept_wildcard_exclusion() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "text/*, text/csv;q=0")
            .body(())?;
        ServerTest::new()?.test_body(request, "?s\t?p\t?o\n")
    }

    #[test]
    fn get_query_accept_parameter_specificity() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(
                ACCEPT,
                "text/csv;charset=utf-8;q=0, text/csv;q=1, text/tab-separated-values;q=0.5",
            )
            .body(())?;
        ServerTest::new()?.test_body(request, "?s\t?p\t?o\n")
    }

    #[test]
    fn get_query_accept_non_matching_parameter() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "text/csv;header=absent;q=0, text/csv;q=1")
            .body(())?;
        ServerTest::new()?.test_body(request, "s,p,o\r\n")
    }

    #[test]
    fn get_query_accept_incompatible_charset() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(
                ACCEPT,
                "text/csv;charset=iso-8859-1;q=0, text/csv;q=1, application/sparql-results+json;q=0.5",
            )
            .body(())?;
        ServerTest::new()?.test_body(request, "s,p,o\r\n")
    }

    #[test]
    fn get_query_description_accept_json_ld_profile() -> Result<()> {
        let request = Request::builder()
            .uri("http://localhost/query")
            .header(
                ACCEPT,
                "application/ld+json;profile=http://www.w3.org/ns/json-ld#streaming",
            )
            .body(())?;
        assert_eq!(
            ServerTest::new()?.exec(request).headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static(
                "application/ld+json;profile=http://www.w3.org/ns/json-ld#streaming"
            ))
        );
        Ok(())
    }

    #[test]
    fn get_store_accept_substar() -> Result<()> {
        let request = Request::builder()
            .uri("http://localhost/store?default")
            .header(ACCEPT, "text/*")
            .body(())?;
        let mut response = ServerTest::new()?.exec(request);
        read_to_string(response.body_mut())?;
        assert_eq!(
            response.headers().get(CONTENT_TYPE),
            Some(&HeaderValue::from_static("text/turtle"))
        );
        Ok(())
    }

    #[test]
    fn get_query_accept_good() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "application/sparql-results+json;charset=utf-8")
            .body(())?;
        ServerTest::new()?.test_body(
            request,
            r#"{"head":{"vars":["s","p","o"]},"results":{"bindings":[]}}"#,
        )
    }

    #[test]
    fn get_query_accept_bad() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "application/foo")
            .body(())?;
        ServerTest::new()?.test_status(request, StatusCode::NOT_ACCEPTABLE)
    }

    #[test]
    fn get_query_accept_explicit_priority() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "text/foo;q=0.5 , text/json ; q = 0.7")
            .body(())?;
        ServerTest::new()?.test_body(
            request,
            r#"{"head":{"vars":["s","p","o"]},"results":{"bindings":[]}}"#,
        )
    }

    #[test]
    fn get_query_accept_quality_and_quoted_fields_follow_http_grammar() -> Result<()> {
        let server = ServerTest::new()?;
        for accept in [
            "application/sparql-results+json;q=1.1",
            "application/sparql-results+json;q=0.0000",
            "application/sparql-results+json;q=0.8;charset=utf-8",
            "application/sparql-results+json;q=0.8;q=0.7",
            "application/sparql-results+json;note=\"unterminated",
        ] {
            server.test_status(
                Request::builder()
                    .uri("http://localhost/query?query=SELECT%20*%20WHERE%20%7B%7D")
                    .header(ACCEPT, accept)
                    .body(())?,
                StatusCode::BAD_REQUEST,
            )?;
        }
        server.test_status(
            Request::builder()
                .uri("http://localhost/query?query=SELECT%20*%20WHERE%20%7B%7D")
                .header(ACCEPT, "application/sparql-results+json;q=0")
                .body(())?,
            StatusCode::NOT_ACCEPTABLE,
        )?;

        let response = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=SELECT%20*%20WHERE%20%7B%7D")
                .header(
                    ACCEPT,
                    "application/unsupported;note=\"a,b\";q=1, APPLICATION/SPARQL-RESULTS+JSON;q=0.8",
                )
                .body(())?,
        );
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/sparql-results+json")
        );
        Ok(())
    }

    #[test]
    fn get_query_accept_implicit_priority() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "text/json,text/foo")
            .body(())?;
        ServerTest::new()?.test_body(
            request,
            r#"{"head":{"vars":["s","p","o"]},"results":{"bindings":[]}}"#,
        )
    }
    #[test]
    fn get_query_accept_implicit_and_explicit_priority() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "text/foo;q=0.9,text/csv")
            .body(())?;
        ServerTest::new()?.test_body(request, "s,p,o\r\n")
    }

    #[test]
    fn get_bad_query() -> Result<()> {
        ServerTest::new()?.test_status(
            Request::builder()
                .uri("http://localhost/query?query=SELECT")
                .body(())?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[test]
    fn get_query_union_graph() -> Result<()> {
        let server = ServerTest::new()?;

        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/1")
            .header(CONTENT_TYPE, "text/turtle")
            .body("<http://example.com> <http://example.com> <http://example.com> .")?;
        server.test_status(request, StatusCode::CREATED)?;

        let request =Request::builder().uri(
            "http://localhost/query?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}&union-default-graph"
        ).header(ACCEPT, "text/csv")
            .body(())?;
        server.test_body(
            request,
            "s,p,o\r\nhttp://example.com,http://example.com,http://example.com\r\n",
        )
    }

    #[test]
    fn post_form_query_accepts_disjoint_uri_dataset_parameters() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query?union-default-graph")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body("query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}")?;
        ServerTest::new()?.test_status(request, StatusCode::OK)
    }

    #[test]
    fn get_query_explicit_default_graphs_and_named_graphs() -> Result<()> {
        let server = ServerTest::new()?;

        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/1")
            .header(CONTENT_TYPE, "text/turtle")
            .body("<http://example.com/1> <http://example.com/1> <http://example.com/1> .")?;
        server.test_status(request, StatusCode::CREATED)?;

        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/2")
            .header(CONTENT_TYPE, "text/turtle")
            .body("<http://example.com/2> <http://example.com/2> <http://example.com/2> .")?;
        server.test_status(request, StatusCode::CREATED)?;

        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query?default-graph-uri=http://localhost/store/1")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(ACCEPT, "text/csv")
            .body("query=SELECT%20?s%20WHERE%20{%20?s%20?p%20?o%20}%20ORDER%20BY%20?s")?;
        server.test_body(request, "s\r\nhttp://example.com/1\r\n")?;

        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query?default-graph-uri=http://localhost/store/1&default-graph-uri=http://localhost/store/2")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(ACCEPT, "text/csv")
            .body("query=SELECT%20?s%20WHERE%20{%20?s%20?p%20?o%20}%20ORDER%20BY%20?s")?;
        server.test_body(
            request,
            "s\r\nhttp://example.com/1\r\nhttp://example.com/2\r\n",
        )?;

        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query?default-graph-uri=http://localhost/store/1")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(ACCEPT, "text/csv")
            .body("query=SELECT%20?s%20WHERE%20{%20GRAPH%20?g%20{%20?s%20?p%20?o%20}}%20ORDER%20BY%20?s")?;
        server.test_body(request, "s\r\n")?;

        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query?named-graph-uri=http://localhost/store/1")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(ACCEPT, "text/csv")
            .body("query=SELECT%20?s%20WHERE%20{%20GRAPH%20?g%20{%20?s%20?p%20?o%20}}%20ORDER%20BY%20?s")?;
        server.test_body(request, "s\r\nhttp://example.com/1\r\n")?;

        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query?named-graph-uri=http://localhost/store/1&named-graph-uri=http://localhost/store/2")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(ACCEPT, "text/csv")
            .body("query=SELECT%20?s%20WHERE%20{%20GRAPH%20?g%20{%20?s%20?p%20?o%20}}%20ORDER%20BY%20?s")?;
        server.test_body(
            request,
            "s\r\nhttp://example.com/1\r\nhttp://example.com/2\r\n",
        )
    }

    #[test]
    fn get_query_union_graph_and_default_graph() -> Result<()> {
        ServerTest::new()?.test_status(Request::builder().uri(
            "http://localhost/query?query=SELECT%20*%20WHERE%20{%20?s%20?p%20?o%20}&union-default-graph&default-graph-uri=http://example.com",
        ).body(())?, StatusCode::BAD_REQUEST)
    }

    #[test]
    fn get_query_description() -> Result<()> {
        ServerTest::new()?.test_status(
            Request::builder().uri("http://localhost/query").body(())?,
            StatusCode::OK,
        )
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn sparql_12_get_query_accepts_one_version_parameter() -> Result<()> {
        let request = Request::builder()
            .uri("http://localhost/query?query=ASK%20%7B%7D&version=1.2")
            .body(())?;
        ServerTest::new()?.test_status(request, StatusCode::OK)
    }

    #[test]
    fn sparql_get_query_rejects_duplicate_singleton_parameters() -> Result<()> {
        let server = ServerTest::new()?;
        server.test_status(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D&query=ASK%20%7B%7D")
                .body(())?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D&version=1.1&version=1.1")
                .body(())?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[test]
    fn sparql_get_query_preserves_repeatable_dataset_parameters() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/query?query=ASK%20%7B%7D&default-graph-uri=http%3A%2F%2Fexample.com%2Fa&default-graph-uri=http%3A%2F%2Fexample.com%2Fb",
            )
            .body(())?;
        ServerTest::new()?.test_status(request, StatusCode::OK)
    }

    #[test]
    fn sparql_get_query_rejects_unknown_parameters_and_bodies() -> Result<()> {
        let server = ServerTest::new()?;
        server.test_status(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D&unknown=value")
                .body(())?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D")
                .body("not allowed")?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[test]
    fn sparql_query_rejects_unsupported_version_labels() -> Result<()> {
        let request = Request::builder()
            .uri("http://localhost/query?query=ASK%20%7B%7D&version=9.9")
            .body(())?;
        ServerTest::new()?.test_status(request, StatusCode::BAD_REQUEST)
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn sparql_12_direct_query_accepts_a_media_type_version() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query")
            .header(CONTENT_TYPE, "application/sparql-query; version=\"1.2\"")
            .body("ASK {}")?;
        ServerTest::new()?.test_status(request, StatusCode::OK)
    }

    #[test]
    fn sparql_direct_query_rejects_misplaced_or_invalid_media_parameters() -> Result<()> {
        let server = ServerTest::new()?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query?version=1.1")
                .header(CONTENT_TYPE, "application/sparql-query")
                .body("ASK {}")?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(
                    CONTENT_TYPE,
                    "application/sparql-query; version=1.1; version=1.1",
                )
                .body("ASK {}")?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query; charset=utf-8")
                .body("ASK {}")?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[test]
    fn sparql_11_mode_ignores_feature_looking_comments_strings_and_iris() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query")
            .header(CONTENT_TYPE, "application/sparql-query; version=1.1")
            .body(concat!(
                "PREFIX ex: <http://example.com/>\n",
                "# <<( TRIPLE( \"text\"@en--ltr\n",
                "ASK { BIND(\"<<( TRIPLE( @en--ltr\" AS ?value) ",
                "BIND(ex:value\\~escaped AS ?tilde) ",
                "BIND(<http://example.com/TRIPLE(foo)--ltr> AS ?iri) }",
            ))?;
        ServerTest::new()?.test_status(request, StatusCode::OK)
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn sparql_12_syntax_version_precedes_the_protocol_parameter() -> Result<()> {
        let server = ServerTest::new()?;
        let triple_term_query = concat!(
            "VERSION \"1.1\"\n",
            "ASK { BIND( <<( <http://example.com/s> <http://example.com/p> ",
            "<http://example.com/o> )>> AS ?triple) }",
        );

        // The VERSION directive wins, so a protocol parameter cannot upgrade
        // a query that declares SPARQL 1.1.
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query; version=1.2")
                .body(triple_term_query)?,
            StatusCode::BAD_REQUEST,
        )?;
        for version in ["1.1", "1.2-basic"] {
            server.test_status(
                Request::builder()
                    .method(Method::POST)
                    .uri("http://localhost/query")
                    .header(
                        CONTENT_TYPE,
                        format!("application/sparql-query; version={version}"),
                    )
                    .body(triple_term_query)?,
                StatusCode::BAD_REQUEST,
            )?;
        }

        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query; version=1.1")
                .body(concat!(
                    "VERSION \"1.2\"\n",
                    "ASK { BIND( <<( <http://example.com/s> <http://example.com/p> ",
                    "<http://example.com/o> )>> AS ?triple) }",
                ))?,
            StatusCode::OK,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query; version=1.2")
                .body(concat!(
                    "ASK { BIND( <<( <http://example.com/s> <http://example.com/p> ",
                    "<http://example.com/o> )>> AS ?triple) }",
                ))?,
            StatusCode::OK,
        )?;

        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query")
                .body(concat!(
                    "VERSION \"1.2-basic\"\n",
                    "ASK { BIND( <<( <http://example.com/s> <http://example.com/p> ",
                    "<http://example.com/o> )>> AS ?triple) }",
                ))?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query")
                .body(concat!(
                    "VERSION \"1.2-basic\"\n",
                    "ASK { << << <http://example.com/s> <http://example.com/p> ",
                    "<http://example.com/o> >> <http://example.com/p> ",
                    "<http://example.com/o> >> <http://example.com/q> ",
                    "<http://example.com/r> }",
                ))?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query")
                .body("VERSION \"9.9\" ASK {}")?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query")
                .body("VERSION \"1.1\" VERSION \"1.2\" ASK {}")?,
            StatusCode::OK,
        )
    }

    #[test]
    fn sparql_version_directive_scanner_handles_interleaved_prologue() {
        assert_eq!(
            sparql_syntax_version(concat!(
                "# leading comment\n",
                "PREFIX ex: <http://example.com/>\n",
                "VERSION '1.1'\n",
                "BASE <http://example.com/base/>\n",
                "ASK {}",
            ))
            .unwrap(),
            Some(SparqlVersion::V11)
        );
        sparql_syntax_version("VERSION \"9.9\" ASK {}").unwrap_err();
        assert_eq!(
            sparql_syntax_version("VERSION \"1.1\" VERSION \"1.1\" ASK {}").unwrap(),
            Some(SparqlVersion::V11)
        );
        #[cfg(feature = "rdf-12")]
        assert_eq!(
            sparql_syntax_version("VERSION \"1.1\" VERSION \"1.2\" ASK {}").unwrap(),
            Some(SparqlVersion::V12)
        );
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn sparql_12_form_query_accepts_a_version_parameter() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body("query=ASK%20%7B%7D&version=1.2-basic")?;
        ServerTest::new()?.test_status(request, StatusCode::OK)
    }

    #[test]
    fn sparql_form_query_validates_version_locations() -> Result<()> {
        let server = ServerTest::new()?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body("query=ASK%20%7B%7D&version=1.1&version=1.1")?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query?version=1.1")
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body("query=ASK%20%7B%7D")?,
            StatusCode::OK,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(
                    CONTENT_TYPE,
                    "application/x-www-form-urlencoded; version=1.1",
                )
                .body("query=ASK%20%7B%7D")?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn sparql_results_versions_are_negotiated_and_emitted() -> Result<()> {
        let server = ServerTest::new()?;

        let mut json = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D&version=1.2")
                .header(ACCEPT, "application/sparql-results+json; version=1.2")
                .body(())?,
        );
        assert_eq!(
            json.headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/sparql-results+json; version=1.2")
        );
        assert_eq!(
            read_to_string(json.body_mut())?,
            r#"{"head":{},"boolean":true}"#
        );

        let mut xml = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D&version=1.2")
                .header(ACCEPT, "application/sparql-results+xml; version=1.2")
                .body(())?,
        );
        assert_eq!(
            xml.headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/sparql-results+xml; version=1.2")
        );
        assert!(read_to_string(xml.body_mut())?.contains(r#" version="1.2""#));

        for (version, expected) in [
            ("1.1", r#"{"head":{},"boolean":true}"#),
            ("1.2-basic", r#"{"head":{},"boolean":true}"#),
        ] {
            let mut response = server.exec(
                Request::builder()
                    .uri("http://localhost/query?query=ASK%20%7B%7D")
                    .header(
                        ACCEPT,
                        format!("application/sparql-results+json; version={version}"),
                    )
                    .body(())?,
            );
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response
                    .headers()
                    .get(CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok()),
                Some(format!("application/sparql-results+json; version={version}").as_str())
            );
            assert_eq!(read_to_string(response.body_mut())?, expected);
        }

        let csv = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=SELECT%20*%20WHERE%20%7B%7D&version=1.2")
                .header(ACCEPT, "text/csv")
                .body(())?,
        );
        assert_eq!(
            csv.headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/csv; charset=utf-8")
        );

        let turtle = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=CONSTRUCT%20%7B%7D%20WHERE%20%7B%7D&version=1.2")
                .header(ACCEPT, "text/turtle")
                .body(())?,
        );
        assert_eq!(
            turtle
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/turtle")
        );
        let rdf12_turtle = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=CONSTRUCT%20%7B%7D%20WHERE%20%7B%7D&version=1.2")
                .header(ACCEPT, "text/turtle; version=1.2")
                .body(())?,
        );
        assert_eq!(
            rdf12_turtle
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("text/turtle; version=1.2")
        );
        server.test_status(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D")
                .header(ACCEPT, "application/sparql-results+json; version=9.9")
                .body(())?,
            StatusCode::NOT_ACCEPTABLE,
        )?;
        let fallback = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D")
                .header(
                    ACCEPT,
                    "application/sparql-results+json; version=1.1, application/sparql-results+xml",
                )
                .body(())?,
        );
        assert_eq!(
            fallback
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/sparql-results+json; version=1.1")
        );
        Ok(())
    }

    #[cfg(not(feature = "rdf-12"))]
    #[test]
    fn rdf11_build_negotiates_only_legacy_sparql_results_versions() -> Result<()> {
        let server = ServerTest::new()?;

        let mut unversioned = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D")
                .header(ACCEPT, "application/sparql-results+json")
                .body(())?,
        );
        assert_eq!(unversioned.status(), StatusCode::OK);
        assert_eq!(
            unversioned
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/sparql-results+json")
        );
        assert_eq!(
            read_to_string(unversioned.body_mut())?,
            r#"{"head":{},"boolean":true}"#
        );

        let mut rdf11 = server.exec(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D")
                .header(ACCEPT, "application/sparql-results+json; version=1.1")
                .body(())?,
        );
        assert_eq!(rdf11.status(), StatusCode::OK);
        assert_eq!(
            read_to_string(rdf11.body_mut())?,
            r#"{"head":{},"boolean":true}"#
        );

        for version in ["1.2-basic", "1.2"] {
            server.test_status(
                Request::builder()
                    .uri("http://localhost/query?query=ASK%20%7B%7D")
                    .header(
                        ACCEPT,
                        format!("application/sparql-results+json; version={version}"),
                    )
                    .body(())?,
                StatusCode::NOT_ACCEPTABLE,
            )?;
        }
        Ok(())
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn constrained_sparql_results_versions_fail_before_committing_a_response() -> Result<()> {
        use oxigraph::model::{BaseDirection, Literal, Quad, Triple};

        let server = ServerTest::new()?;
        let triple = Triple::new(
            NamedNode::new_unchecked("urn:results:embedded-s"),
            NamedNode::new_unchecked("urn:results:embedded-p"),
            NamedNode::new_unchecked("urn:results:embedded-o"),
        );
        server.store.insert(Quad::new(
            NamedNode::new_unchecked("urn:results:triple"),
            NamedNode::new_unchecked("urn:results:value"),
            triple,
            GraphName::DefaultGraph,
        ))?;
        server.store.insert(Quad::new(
            NamedNode::new_unchecked("urn:results:directional"),
            NamedNode::new_unchecked("urn:results:value"),
            Literal::new_directional_language_tagged_literal("hello", "en", BaseDirection::Rtl)?,
            GraphName::DefaultGraph,
        ))?;

        let request = |subject: &str, version: &str| {
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query")
                .header(
                    ACCEPT,
                    format!("application/sparql-results+json; version={version}"),
                )
                .body(format!(
                    "SELECT ?value WHERE {{ <{subject}> <urn:results:value> ?value }}"
                ))
        };

        for version in ["1.1", "1.2-basic"] {
            server.test_status(
                request("urn:results:triple", version)?,
                StatusCode::NOT_ACCEPTABLE,
            )?;
        }
        server.test_status(
            request("urn:results:directional", "1.1")?,
            StatusCode::NOT_ACCEPTABLE,
        )?;

        let mut basic = server.exec(request("urn:results:directional", "1.2-basic")?);
        assert_eq!(basic.status(), StatusCode::OK);
        let basic = read_to_string(basic.body_mut())?;
        assert!(basic.contains(r#""version":"1.2-basic""#));
        assert!(basic.contains(r#""its:dir":"rtl""#));

        let mut full = server.exec(request("urn:results:triple", "1.2")?);
        assert_eq!(full.status(), StatusCode::OK);
        let full = read_to_string(full.body_mut())?;
        assert!(full.contains(r#""version":"1.2""#));
        assert!(full.contains(r#""type":"triple""#));
        Ok(())
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn sparql_graph_results_fail_closed_without_rdf12_negotiation() -> Result<()> {
        let server = ServerTest::new()?;
        let embedded = oxigraph::model::Triple::new(
            NamedNode::new_unchecked("urn:embedded:s"),
            NamedNode::new_unchecked("urn:embedded:p"),
            NamedNode::new_unchecked("urn:embedded:o"),
        );
        server.store.insert(oxigraph::model::Quad::new(
            NamedNode::new_unchecked("urn:s"),
            NamedNode::new_unchecked("urn:p"),
            embedded,
            GraphName::DefaultGraph,
        ))?;
        let request = |accept| {
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/query")
                .header(CONTENT_TYPE, "application/sparql-query")
                .header(ACCEPT, accept)
                .body("CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }")
        };
        server.test_status(
            request("application/n-triples")?,
            StatusCode::NOT_ACCEPTABLE,
        )?;

        let mut response = server.exec(request("application/n-triples; version=1.2")?);
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok()),
            Some("application/n-triples; version=1.2")
        );
        assert!(read_to_string(response.body_mut())?.contains("<<( <urn:embedded:s>"));
        Ok(())
    }

    #[test]
    fn sparql_ask_rejects_select_only_result_formats() -> Result<()> {
        let server = ServerTest::new()?;
        for media_type in ["text/csv", "text/tab-separated-values"] {
            server.test_status(
                Request::builder()
                    .uri("http://localhost/query?query=ASK%20%7B%7D")
                    .header(ACCEPT, media_type)
                    .body(())?,
                StatusCode::NOT_ACCEPTABLE,
            )?;
        }
        server.test_status(
            Request::builder()
                .uri("http://localhost/query?query=ASK%20%7B%7D")
                .header(ACCEPT, "text/csv, application/sparql-results+json")
                .body(())?,
            StatusCode::OK,
        )
    }

    #[test]
    fn sparql_csv_accept_parameters_match_the_emitted_representation() -> Result<()> {
        let server = ServerTest::new()?;
        for accept in ["text/csv; header=absent", "text/csv; charset=iso-8859-1"] {
            server.test_status(
                Request::builder()
                    .uri("http://localhost/query?query=SELECT%20*%20WHERE%20%7B%7D")
                    .header(ACCEPT, accept)
                    .body(())?,
                StatusCode::NOT_ACCEPTABLE,
            )?;
        }
        server.test_status(
            Request::builder()
                .uri("http://localhost/query?query=SELECT%20*%20WHERE%20%7B%7D")
                .header(ACCEPT, "text/csv; charset=utf-8; header=present")
                .body(())?,
            StatusCode::OK,
        )
    }

    #[test]
    fn post_query() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query")
            .header(CONTENT_TYPE, "application/sparql-query")
            .body("SELECT * WHERE { ?s ?p ?o }")?;
        ServerTest::new()?.test_status(request, StatusCode::OK)
    }

    #[test]
    fn post_bad_query() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query")
            .header(CONTENT_TYPE, "application/sparql-query")
            .body("SELECT")?;
        ServerTest::new()?.test_status(request, StatusCode::BAD_REQUEST)
    }

    #[test]
    fn post_unknown_query() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query")
            .header(CONTENT_TYPE, "application/sparql-todo")
            .body("SELECT")?;
        ServerTest::new()?.test_status(request, StatusCode::UNSUPPORTED_MEDIA_TYPE)
    }

    #[test]
    fn post_federated_query_is_denied_by_server_policy() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/query")
            .header(CONTENT_TYPE, "application/sparql-query")
            .body("ASK { SERVICE <http://127.0.0.1:9/sparql> { ?s ?p ?o } }")?;
        let mut response = ServerTest::new()?.exec(request);
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            read_to_string(response.body_mut())?,
            "SERVICE egress request: policy denied"
        );
        Ok(())
    }

    #[test]
    fn post_remote_load_is_denied_by_server_policy() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/update")
            .header(CONTENT_TYPE, "application/sparql-update")
            .body("LOAD <http://127.0.0.1:10/data.nt>")?;
        let mut response = ServerTest::new()?.exec(request);
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            read_to_string(response.body_mut())?,
            "LOAD egress request: policy denied"
        );
        Ok(())
    }

    #[test]
    fn get_update_description() -> Result<()> {
        ServerTest::new()?.test_status(
            Request::builder().uri("http://localhost/update").body(())?,
            StatusCode::OK,
        )
    }

    #[test]
    fn post_update() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/update")
            .header(CONTENT_TYPE, "application/sparql-update")
            .body(
                "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
            )?;
        ServerTest::new()?.test_status(request, StatusCode::NO_CONTENT)
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn sparql_12_update_accepts_media_type_and_form_versions() -> Result<()> {
        let server = ServerTest::new()?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/update")
                .header(CONTENT_TYPE, "application/sparql-update; version=1.2")
                .body("INSERT DATA {}")?,
            StatusCode::NO_CONTENT,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/update")
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body("update=INSERT%20DATA%20%7B%7D&version=1.2-basic")?,
            StatusCode::NO_CONTENT,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/update")
                .header(CONTENT_TYPE, "application/sparql-update; version=1.1")
                .body(concat!(
                    "VERSION \"1.2\"\n",
                    "INSERT DATA { <<( <http://example.com/s> <http://example.com/p> ",
                    "<http://example.com/o> )>> <http://example.com/source> ",
                    "<http://example.com/test> }",
                ))?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[test]
    fn sparql_update_rejects_duplicate_unknown_and_misplaced_parameters() -> Result<()> {
        let server = ServerTest::new()?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/update")
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body("update=INSERT%20DATA%20%7B%7D&update=INSERT%20DATA%20%7B%7D")?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/update")
                .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body("update=INSERT%20DATA%20%7B%7D&unknown=value")?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/update?version=1.1")
                .header(CONTENT_TYPE, "application/sparql-update")
                .body("INSERT DATA {}")?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[test]
    fn post_bad_update() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/update")
            .header(CONTENT_TYPE, "application/sparql-update")
            .body("INSERT")?;
        ServerTest::new()?.test_status(request, StatusCode::BAD_REQUEST)
    }

    #[test]
    fn post_update_read_only() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/update")
            .header(CONTENT_TYPE, "application/sparql-update")
            .body(
                "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
            )?;
        ServerTest::check_status(
            ServerTest::new()?.exec_read_only(request),
            StatusCode::FORBIDDEN,
        )
    }

    #[test]
    fn get_sparql() -> Result<()> {
        let request = Request::builder()
            .uri(
                "http://localhost/sparql?query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}",
            )
            .header(ACCEPT, "text/csv")
            .body(())?;
        ServerTest::new()?.test_body(request, "s,p,o\r\n")
    }

    #[test]
    fn get_sparql_description() -> Result<()> {
        let request = Request::builder()
            .uri("http://localhost/sparql")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        ServerTest::new()?.test_status(request, StatusCode::OK)
    }

    #[test]
    fn post_sparql_query() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/sparql")
            .header(CONTENT_TYPE, "application/sparql-query")
            .header(ACCEPT, "text/csv")
            .body("SELECT ?s ?p ?o WHERE { ?s ?p ?o }")?;
        ServerTest::new()?.test_body(request, "s,p,o\r\n")
    }

    #[test]
    fn post_sparql_update() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/sparql")
            .header(CONTENT_TYPE, "application/sparql-update")
            .body("INSERT DATA {}")?;
        ServerTest::new()?.test_status(request, StatusCode::NO_CONTENT)
    }

    #[test]
    fn post_sparql_query_form() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/sparql")
            .header(ACCEPT, "text/csv")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body("query=SELECT%20?s%20?p%20?o%20WHERE%20{%20?s%20?p%20?o%20}")?;
        ServerTest::new()?.test_body(request, "s,p,o\r\n")
    }

    #[test]
    fn post_sparql_update_form() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/sparql")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body("update=INSERT%20DATA%20{}")?;
        ServerTest::new()?.test_status(request, StatusCode::NO_CONTENT)
    }

    #[test]
    fn post_sparql_wrong_form() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/sparql")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body("")?;
        ServerTest::new()?.test_status(request, StatusCode::BAD_REQUEST)
    }

    #[test]
    fn post_sparql_update_read_only() -> Result<()> {
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/sparql")
            .header(CONTENT_TYPE, "application/sparql-update")
            .body(
                "INSERT DATA { <http://example.com> <http://example.com> <http://example.com> }",
            )?;
        ServerTest::check_status(
            ServerTest::new()?.exec_read_only(request),
            StatusCode::FORBIDDEN,
        )
    }

    #[test]
    fn graph_store_url_normalization() -> Result<()> {
        let server = ServerTest::new()?;

        // PUT
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store?graph=http://example.com")
            .header(CONTENT_TYPE, "text/turtle")
            .body("<http://example.com> <http://example.com> <http://example.com> .")?;
        server.test_status(request, StatusCode::CREATED)?;

        // GET good URI
        server.test_status(
            Request::builder()
                .uri("http://localhost/store?graph=http://example.com")
                .body(())?,
            StatusCode::OK,
        )?;

        // GET bad URI
        server.test_status(
            Request::builder()
                .uri("http://localhost/store?graph=http://example.com/")
                .body(())?,
            StatusCode::NOT_FOUND,
        )
    }

    #[test]
    fn graph_store_base_url() -> Result<()> {
        let server = ServerTest::new()?;

        // PUT creates graph content; POST only merges into existing graph content.
        server.test_status(
            Request::builder()
                .method(Method::PUT)
                .uri("http://localhost/store?graph=http://example.com")
                .header(CONTENT_TYPE, "text/turtle")
                .body(())?,
            StatusCode::CREATED,
        )?;

        // POST
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store?graph=http://example.com")
            .header(CONTENT_TYPE, "text/turtle")
            .body("<> <http://example.com/p> <http://example.com/o1> .")?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET
        let request = Request::builder()
            .uri("http://localhost/store?graph=http://example.com")
            .header(ACCEPT, "application/n-triples")
            .body(())?;
        server.test_body(
            request,
            "<http://example.com> <http://example.com/p> <http://example.com/o1> .\n",
        )?;

        // PUT
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store?graph=http://example.com")
            .header(CONTENT_TYPE, "text/turtle")
            .body("<> <http://example.com/p> <http://example.com/o2> .")?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET
        let request = Request::builder()
            .uri("http://localhost/store?graph=http://example.com")
            .header(ACCEPT, "application/n-triples")
            .body(())?;
        server.test_body(
            request,
            "<http://example.com> <http://example.com/p> <http://example.com/o2> .\n",
        )
    }

    #[test]
    fn graph_store_post_requires_existing_selected_graph() -> Result<()> {
        let server = ServerTest::new()?;
        let target = "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fnew";
        let body = "<http://example.com/s> <http://example.com/p> <http://example.com/o> .";

        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri(target)
                .header(CONTENT_TYPE, "text/turtle")
                .body(body)?,
            StatusCode::NOT_FOUND,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::PUT)
                .uri(target)
                .header(CONTENT_TYPE, "text/turtle")
                .body(())?,
            StatusCode::CREATED,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri(target)
                .header(CONTENT_TYPE, "text/turtle")
                .body(body)?,
            StatusCode::NO_CONTENT,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/store?default")
                .header(CONTENT_TYPE, "text/turtle")
                .body(body)?,
            StatusCode::NO_CONTENT,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fempty")
                .header(CONTENT_TYPE, "text/turtle")
                .body(())?,
            StatusCode::NOT_FOUND,
        )
    }

    #[test]
    fn graph_store_without_content_type_falls_back_to_rdf_xml() -> Result<()> {
        let server = ServerTest::new()?;
        let rdf_xml = concat!(
            "<?xml version=\"1.0\"?>",
            "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\" ",
            "xmlns:ex=\"http://example.com/\">",
            "<rdf:Description rdf:about=\"http://example.com/s\">",
            "<ex:p rdf:resource=\"http://example.com/o\"/>",
            "</rdf:Description></rdf:RDF>",
        );

        let put_target = "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Frdfxml-put";
        server.test_status(
            Request::builder()
                .method(Method::PUT)
                .uri(put_target)
                .body(rdf_xml)?,
            StatusCode::CREATED,
        )?;
        server.test_body(
            Request::builder()
                .uri(put_target)
                .header(ACCEPT, "application/n-triples")
                .body(())?,
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n",
        )?;

        let post_target = "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Frdfxml-post";
        server.test_status(
            Request::builder()
                .method(Method::PUT)
                .uri(post_target)
                .header(CONTENT_TYPE, "text/turtle")
                .body(())?,
            StatusCode::CREATED,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri(post_target)
                .body(rdf_xml)?,
            StatusCode::NO_CONTENT,
        )?;
        server.test_body(
            Request::builder()
                .uri(post_target)
                .header(ACCEPT, "application/n-triples")
                .body(())?,
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\n",
        )?;

        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/store?default")
                .body("<not-rdf-xml>")?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[test]
    fn service_routes_return_method_specific_allow_headers() -> Result<()> {
        let server = ServerTest::new()?;
        for (path, allow) in [
            ("/query", "GET, POST, QUERY"),
            ("/update", "GET, POST"),
            ("/sparql", "GET, POST, QUERY"),
            ("/store", "GET, HEAD, PUT, POST, DELETE"),
            ("/store/arbitrary", "GET, HEAD, PUT, POST, DELETE"),
        ] {
            let response = server.exec(
                Request::builder()
                    .method(Method::PATCH)
                    .uri(format!("http://localhost{path}"))
                    .body(())?,
            );
            assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
            assert_eq!(
                response
                    .headers()
                    .get(ALLOW)
                    .and_then(|value| value.to_str().ok()),
                Some(allow)
            );
        }
        server.test_status(
            Request::builder()
                .method(Method::DELETE)
                .uri("http://localhost/not-a-service")
                .body(())?,
            StatusCode::NOT_FOUND,
        )
    }

    #[test]
    fn graph_store_head_matches_get_metadata_without_a_body() -> Result<()> {
        let server = ServerTest::new()?;
        let target = "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fhead";
        server.test_status(
            Request::builder()
                .method(Method::PUT)
                .uri(target)
                .header(CONTENT_TYPE, "text/turtle")
                .body("<http://example.com/s> <http://example.com/p> <http://example.com/o> .")?,
            StatusCode::CREATED,
        )?;

        let mut get = server.exec(
            Request::builder()
                .uri(target)
                .header(ACCEPT, "application/n-triples")
                .body(())?,
        );
        let get_content_type = get.headers().get(CONTENT_TYPE).cloned();
        assert_eq!(get.status(), StatusCode::OK);
        assert!(!read_to_string(get.body_mut())?.is_empty());

        let mut head = server.exec(
            Request::builder()
                .method(Method::HEAD)
                .uri(target)
                .header(ACCEPT, "application/n-triples")
                .body(())?,
        );
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(head.headers().get(CONTENT_TYPE), get_content_type.as_ref());
        assert!(read_to_string(head.body_mut())?.is_empty());

        let mut not_acceptable = server.exec(
            Request::builder()
                .method(Method::HEAD)
                .uri(target)
                .header(ACCEPT, "application/not-rdf")
                .body(())?,
        );
        assert_eq!(not_acceptable.status(), StatusCode::NOT_ACCEPTABLE);
        assert!(read_to_string(not_acceptable.body_mut())?.is_empty());
        Ok(())
    }

    #[test]
    fn graph_store_rejects_ambiguous_selectors_and_invalid_multipart() -> Result<()> {
        let server = ServerTest::new()?;
        for uri in [
            "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fa&graph=http%3A%2F%2Fexample.com%2Fb",
            "http://localhost/store?default&default",
            "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fa&default",
            "http://localhost/store/direct?graph=http%3A%2F%2Fexample.com%2Fa",
        ] {
            server.test_status(
                Request::builder().uri(uri).body(())?,
                StatusCode::BAD_REQUEST,
            )?;
        }

        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/store?default")
                .header(CONTENT_TYPE, "multipart/form-data; boundary=oxigraph")
                .body("--oxigraph--\r\n")?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/store?default")
                .header(CONTENT_TYPE, "multipart/form-data")
                .body("--oxigraph--\r\n")?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/store?default")
                .header(
                    CONTENT_TYPE,
                    "multipart/form-data; boundary=one; boundary=two",
                )
                .body("--one--\r\n")?,
            StatusCode::BAD_REQUEST,
        )
    }

    #[test]
    fn graph_store_multipart_merges_parts_atomically() -> Result<()> {
        use oxigraph::model::Quad;

        let server = ServerTest::new()?;
        let target = "http://localhost/store?graph=http%3A%2F%2Fexample.com%2Fmultipart-target";
        let body = concat!(
            "--oxigraph-boundary\r\n",
            "Content-Disposition: form-data; name=\"first\"\r\n",
            "Content-Type: text/turtle; charset=utf-8\r\n",
            "\r\n",
            "<http://example.com/first> <http://example.com/p> <http://example.com/o> .\n",
            "_:same <http://example.com/blank-p> <http://example.com/blank-o1> .\r\n",
            "--oxigraph-boundary\r\n",
            "content-type: application/n-triples\r\n",
            "\r\n",
            "<http://example.com/second> <http://example.com/p> <http://example.com/o> .\n",
            "_:same <http://example.com/blank-p> <http://example.com/blank-o2> .\r\n",
            "--oxigraph-boundary--\r\n",
        );
        server.test_status(
            Request::builder()
                .method(Method::PUT)
                .uri(target)
                .header(CONTENT_TYPE, "text/turtle")
                .body(())?,
            StatusCode::CREATED,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri(target)
                .header(
                    CONTENT_TYPE,
                    "multipart/form-data; boundary=\"oxigraph-boundary\"",
                )
                .body(body)?,
            StatusCode::NO_CONTENT,
        )?;

        let graph = NamedNode::new("http://example.com/multipart-target")?;
        for subject in ["http://example.com/first", "http://example.com/second"] {
            assert!(server.store.contains(&Quad::new(
                NamedNode::new(subject)?,
                NamedNode::new("http://example.com/p")?,
                NamedNode::new("http://example.com/o")?,
                graph.clone(),
            ))?);
        }
        let blank_predicate = NamedNode::new("http://example.com/blank-p")?;
        let blank_subjects = server
            .store
            .quads_for_pattern(
                None,
                Some(&blank_predicate),
                None,
                Some(&GraphName::from(graph.clone())),
            )
            .map(|quad| Ok(quad?.subject))
            .collect::<Result<Vec<_>>>()?;
        assert_eq!(blank_subjects.len(), 2);
        assert_ne!(blank_subjects[0], blank_subjects[1]);

        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri(target)
                .header(
                    CONTENT_TYPE,
                    "multipart/form-data; boundary=oxigraph-boundary",
                )
                .body(body)?,
            StatusCode::NO_CONTENT,
        )?;

        let invalid_body = concat!(
            "--rollback\r\n",
            "Content-Type: text/turtle\r\n",
            "\r\n",
            "<http://example.com/must-not-leak> <http://example.com/p> <http://example.com/o> .\r\n",
            "--rollback\r\n",
            "Content-Type: text/turtle\r\n",
            "\r\n",
            "@prefix broken\r\n",
            "--rollback--\r\n",
        );
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri(target)
                .header(CONTENT_TYPE, "multipart/form-data; boundary=rollback")
                .body(invalid_body)?,
            StatusCode::BAD_REQUEST,
        )?;
        assert!(!server.store.contains(&Quad::new(
            NamedNode::new("http://example.com/must-not-leak")?,
            NamedNode::new("http://example.com/p")?,
            NamedNode::new("http://example.com/o")?,
            graph,
        ))?);

        let missing_part_content_type = concat!(
            "--missing-type\r\n",
            "Content-Disposition: form-data; name=\"rdf\"\r\n",
            "\r\n",
            "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\r\n",
            "--missing-type--\r\n",
        );
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri(target)
                .header(CONTENT_TYPE, "multipart/form-data; boundary=missing-type")
                .body(missing_part_content_type)?,
            StatusCode::BAD_REQUEST,
        )?;
        server.test_status(
            Request::builder()
                .method(Method::POST)
                .uri(target)
                .header(CONTENT_TYPE, "multipart/form-data; boundary=unsupported")
                .body(concat!(
                    "--unsupported\r\n",
                    "Content-Type: application/octet-stream\r\n",
                    "\r\n",
                    "not RDF\r\n",
                    "--unsupported--\r\n",
                ))?,
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        )
    }

    #[test]
    fn graph_store_multipart_without_selector_creates_a_graph() -> Result<()> {
        let server = ServerTest::new()?;
        let mut response = server.exec(
            Request::builder()
                .method(Method::POST)
                .uri("http://localhost/store")
                .header(CONTENT_TYPE, "multipart/form-data; boundary=create")
                .body(concat!(
                    "--create\r\n",
                    "Content-Type: text/turtle\r\n",
                    "\r\n",
                    "<http://example.com/s> <http://example.com/p> <http://example.com/o> .\r\n",
                    "--create--\r\n",
                ))?,
        );
        assert_eq!(
            response.status(),
            StatusCode::CREATED,
            "{}",
            read_to_string(response.body_mut())?
        );
        let location = response.headers().get(LOCATION).unwrap().to_str()?;
        server.test_status(
            Request::builder()
                .uri(location)
                .header(ACCEPT, "application/n-triples")
                .body(())?,
            StatusCode::OK,
        )
    }

    #[test]
    fn graph_store_protocol() -> Result<()> {
        // Tests from https://www.w3.org/2009/sparql/docs/tests/data-sparql11/http-rdf-update/

        let server = ServerTest::new()?;

        // PUT - Initial state
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/person/1.ttl")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(
                r#"
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix v: <http://www.w3.org/2006/vcard/ns#> .

<http://$HOST$/$GRAPHSTORE$/person/1> a foaf:Person;
    foaf:businessCard [
        a v:VCard;
        v:fn "John Doe"
    ].
"#,
            )?;
        server.test_status(request, StatusCode::CREATED)?;

        // GET of PUT - Initial state
        let request = Request::builder()
            .uri("http://localhost/store?graph=http%3A%2F%2Flocalhost%2Fstore%2Fperson%2F1.ttl")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // HEAD on an existing graph
        server.test_status(
            Request::builder()
                .method(Method::HEAD)
                .uri("http://localhost/store/person/1.ttl")
                .body(())?,
            StatusCode::OK,
        )?;

        // HEAD on a non-existing graph
        server.test_status(
            Request::builder()
                .method(Method::HEAD)
                .uri("http://localhost/store/person/4.ttl")
                .body(())?,
            StatusCode::NOT_FOUND,
        )?;

        // PUT - graph already in store
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/person/1.ttl")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(
                r#"
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix v: <http://www.w3.org/2006/vcard/ns#> .

<http://$HOST$/$GRAPHSTORE$/person/1> a foaf:Person;
    foaf:businessCard [
        a v:VCard;
        v:fn "Jane Doe"
    ].
"#,
            )?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET of PUT - graph already in store
        let request = Request::builder()
            .uri("http://localhost/store/person/1.ttl")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // PUT - default graph
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store?default")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(
                r#"
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix v: <http://www.w3.org/2006/vcard/ns#> .

[]  a foaf:Person;
    foaf:businessCard [
        a v:VCard;
        v:given-name "Alice"
    ] .
"#,
            )?;
        server.test_status(request, StatusCode::NO_CONTENT)?; // The default graph always exists in Oxigraph

        // GET of PUT - default graph
        let request = Request::builder()
            .uri("http://localhost/store?default")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // PUT - mismatched payload
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/person/1.ttl")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body("@prefix foo")?;
        server.test_status(request, StatusCode::BAD_REQUEST)?;

        // PUT - empty graph
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/person/2.ttl")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(())?;
        server.test_status(request, StatusCode::CREATED)?;

        // GET of PUT - empty graph
        let request = Request::builder()
            .uri("http://localhost/store/person/2.ttl")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // PUT - replace empty graph
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/person/2.ttl")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(
                r#"
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix v: <http://www.w3.org/2006/vcard/ns#> .

[]  a foaf:Person;
    foaf:businessCard [
        a v:VCard;
        v:given-name "Alice"
    ] .
"#,
            )?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET of replacement for empty graph
        let request = Request::builder()
            .uri("http://localhost/store/person/2.ttl")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // DELETE - existing graph
        server.test_status(
            Request::builder()
                .method(Method::DELETE)
                .uri("http://localhost/store/person/2.ttl")
                .body(())?,
            StatusCode::NO_CONTENT,
        )?;

        // GET of DELETE - existing graph
        server.test_status(
            Request::builder()
                .uri("http://localhost/store/person/2.ttl")
                .body(())?,
            StatusCode::NOT_FOUND,
        )?;

        // DELETE - non-existent graph
        server.test_status(
            Request::builder()
                .method(Method::DELETE)
                .uri("http://localhost/store/person/2.ttl")
                .body(())?,
            StatusCode::NOT_FOUND,
        )?;

        // POST - existing graph
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store/person/1.ttl")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(())?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // POST - create new graph
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(
                r#"
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix v: <http://www.w3.org/2006/vcard/ns#> .

[]  a foaf:Person;
    foaf:businessCard [
        a v:VCard;
        v:given-name "Alice"
    ] .
"#,
            )?;
        let response = server.exec(request);
        assert_eq!(response.status(), StatusCode::CREATED);
        let location = response.headers().get(LOCATION).unwrap().to_str()?;

        // GET of POST - create new graph
        let request = Request::builder()
            .uri(location)
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // POST - empty graph to existing graph
        let request = Request::builder()
            .method(Method::POST)
            .uri(location)
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(())?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET of POST - after noop
        let request = Request::builder()
            .uri(location)
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)
    }

    #[test]
    fn graph_store_lenient_bulk() -> Result<()> {
        let server = ServerTest::new()?;
        let invalid_data = "
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix v: <http://www.w3.org/2006/vcard/ns#> .

<http://$HOST$/$GRAPHSTORE$/person/1> a foaf:Person . foo";

        server.test_status(
            Request::builder()
                .method(Method::PUT)
                .uri("http://localhost/store/person/1.ttl")
                .header(CONTENT_TYPE, "text/turtle")
                .body(())?,
            StatusCode::CREATED,
        )?;

        // POST
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store/person/1.ttl?no_transaction&lenient")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(invalid_data)?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET of POST
        let request = Request::builder()
            .uri("http://localhost/store?graph=http%3A%2F%2Flocalhost%2Fstore%2Fperson%2F1.ttl")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // POST dataset
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store?lenient&no_transaction")
            .header(CONTENT_TYPE, "application/trig; charset=utf-8")
            .body(invalid_data)?;
        server.test_status(request, StatusCode::BAD_REQUEST)?;

        // GET of POST dataset
        let request = Request::builder()
            .uri("http://localhost/store?default")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // PUT
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store/person/1.ttl?lenient&no_transaction")
            .header(CONTENT_TYPE, "text/turtle; charset=utf-8")
            .body(invalid_data)?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET of PUT - Initial state
        let request = Request::builder()
            .uri("http://localhost/store?graph=http%3A%2F%2Flocalhost%2Fstore%2Fperson%2F1.ttl")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // PUT dataset
        let request = Request::builder()
            .method(Method::PUT)
            .uri("http://localhost/store?lenient&no_transaction")
            .header(CONTENT_TYPE, "application/trig; charset=utf-8")
            .body(invalid_data)?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET of PUT dataset
        let request = Request::builder()
            .uri("http://localhost/store?default")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::OK)?;

        // GET of PUT dataset - replacement
        let request = Request::builder()
            .uri("http://localhost/store?graph=http%3A%2F%2Flocalhost%2Fstore%2Fperson%2F1.ttl")
            .header(ACCEPT, "text/turtle")
            .body(())?;
        server.test_status(request, StatusCode::NOT_FOUND)
    }

    #[test]
    fn lenient_load() -> Result<()> {
        let server = ServerTest::new()?;

        server.test_status(
            Request::builder()
                .method(Method::PUT)
                .uri("http://localhost/store?graph=http://example.com")
                .header(CONTENT_TYPE, "text/turtle")
                .body(())?,
            StatusCode::CREATED,
        )?;

        // POST
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store?lenient&graph=http://example.com")
            .header(CONTENT_TYPE, "text/turtle")
            .body("< s> < p> \"\\uD83D\\uDC68\" .")?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET
        let request = Request::builder()
            .uri("http://localhost/store?graph=http://example.com")
            .header(ACCEPT, "application/n-triples")
            .body(())?;
        server.test_status(request, StatusCode::INTERNAL_SERVER_ERROR)?;

        // PUT
        let request = Request::builder().method(Method::PUT).uri(
            "http://localhost/store?lenient&graph=http://example.com",
        )
        .header(CONTENT_TYPE, "text/turtle")
        .body("< s> < p> \"\\uD83D\\uDC68\\u200D\\uD83D\\uDC69\\u200D\\uD83D\\uDC67\\u200D\\uD83D\\uDC67\" .")?;
        server.test_status(request, StatusCode::NO_CONTENT)?;

        // GET
        let request = Request::builder()
            .uri("http://localhost/store?graph=http://example.com")
            .header(ACCEPT, "application/n-triples")
            .body(())?;
        server.test_status(request, StatusCode::INTERNAL_SERVER_ERROR)?;

        // POST dataset
        let request = Request::builder()
            .method(Method::POST)
            .uri("http://localhost/store?lenient")
            .header(CONTENT_TYPE, "application/trig")
            .body("<s> <p> \"\"@abcdefghijklmn .")?;
        server.test_status(request, StatusCode::BAD_REQUEST)?;

        // GET
        let request = Request::builder()
            .uri("http://localhost/store")
            .header(ACCEPT, "application/n-quads")
            .body(())?;
        server.test_status(request, StatusCode::INTERNAL_SERVER_ERROR)
    }

    struct ServerTest {
        store: Store,
    }

    impl ServerTest {
        fn new() -> Result<Self> {
            Ok(Self {
                store: Store::new()?,
            })
        }

        fn exec(&self, request: Request<impl Into<Body>>) -> Response<Body> {
            let mut request = request.map(Into::into);
            let method = request.method().clone();
            let evaluator = sparql_evaluator();
            finalize_response(
                &method,
                handle_request(
                    &mut request,
                    &self.store,
                    &evaluator,
                    false,
                    false,
                    QueryEntailment::Simple,
                    None,
                )
                .unwrap_or_else(|(status, message)| error(status, message)),
            )
        }

        fn exec_read_only(&self, request: Request<impl Into<Body>>) -> Response<Body> {
            let mut request = request.map(Into::into);
            let method = request.method().clone();
            let evaluator = sparql_evaluator();
            finalize_response(
                &method,
                handle_request(
                    &mut request,
                    &self.store,
                    &evaluator,
                    true,
                    false,
                    QueryEntailment::Simple,
                    None,
                )
                .unwrap_or_else(|(status, message)| error(status, message)),
            )
        }

        fn test_status(
            &self,
            request: Request<impl Into<Body>>,
            expected_status: StatusCode,
        ) -> Result<()> {
            Self::check_status(self.exec(request), expected_status)
        }

        fn check_status(mut response: Response<Body>, expected_status: StatusCode) -> Result<()> {
            let body = read_to_string(response.body_mut())?;
            assert_eq!(response.status(), expected_status, "Error message: {body}");
            Ok(())
        }

        fn test_body(&self, request: Request<impl Into<Body>>, expected_body: &str) -> Result<()> {
            let mut response = self.exec(request);
            let body = read_to_string(response.body_mut())?;
            assert_eq!(response.status(), StatusCode::OK, "Error message: {body}");
            assert_eq!(&body, expected_body);
            Ok(())
        }
    }

    #[test]
    fn clap_debug() {
        use clap::CommandFactory;

        Args::command().debug_assert()
    }

    #[test]
    fn test_request_original_target_url() {
        assert_eq!(
            request_original_target_url(
                &Request::builder()
                    .uri("http://example.com/foo")
                    .body(())
                    .unwrap()
            )
            .unwrap()
            .to_string(),
            "http://example.com/foo"
        );
        assert_eq!(
            request_original_target_url(
                &Request::builder()
                    .uri("http://example.com/foo")
                    .header("X-Forwarded-Proto", "https")
                    .header("X-Forwarded-Host", "example.org")
                    .body(())
                    .unwrap()
            )
            .unwrap()
            .to_string(),
            "https://example.org/foo"
        );
        assert_eq!(
            request_original_target_url(
                &Request::builder()
                    .uri("http://example.com/foo")
                    .header("Forwarded", "by=foo ; proto = https ; host = example.org")
                    .body(())
                    .unwrap()
            )
            .unwrap()
            .to_string(),
            "https://example.org/foo"
        );
    }
}
