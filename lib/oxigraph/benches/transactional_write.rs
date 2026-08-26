#![cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]

use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::sparql::{PreparedSparqlUpdate, SparqlEvaluator};
use oxigraph::store::Store;
use serde_json::json;
use std::env;
use std::error::Error;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Barrier};
use std::thread;
use std::time::Instant;

type BenchError = Box<dyn Error + Send + Sync>;

const SCHEMA: &str = "oxigraph.transactional-write-sample/v1";
const MAX_OPERATIONS: u64 = 1_000_000;

#[derive(Clone, Copy)]
enum Binding {
    Store,
    Dataset,
}

#[derive(Clone, Copy)]
enum Backend {
    Memory,
    RocksDb,
}

enum Case {
    Sequential {
        id: &'static str,
        binding: Binding,
        backend: Backend,
    },
    Writers {
        id: &'static str,
        writers: usize,
    },
}

impl Case {
    fn parse(value: &str) -> Result<Self, BenchError> {
        Ok(match value {
            "on-store-memory" => Self::Sequential {
                id: "on-store-memory",
                binding: Binding::Store,
                backend: Backend::Memory,
            },
            "on-dataset-memory" => Self::Sequential {
                id: "on-dataset-memory",
                binding: Binding::Dataset,
                backend: Backend::Memory,
            },
            "on-store-rocksdb" => Self::Sequential {
                id: "on-store-rocksdb",
                binding: Binding::Store,
                backend: Backend::RocksDb,
            },
            "on-dataset-rocksdb" => Self::Sequential {
                id: "on-dataset-rocksdb",
                binding: Binding::Dataset,
                backend: Backend::RocksDb,
            },
            "writers-1-rocksdb" => Self::Writers {
                id: "writers-1-rocksdb",
                writers: 1,
            },
            "writers-4-rocksdb" => Self::Writers {
                id: "writers-4-rocksdb",
                writers: 4,
            },
            "writers-16-rocksdb" => Self::Writers {
                id: "writers-16-rocksdb",
                writers: 16,
            },
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unsupported transactional benchmark case: {value}"),
                )
                .into());
            }
        })
    }

    fn id(&self) -> &'static str {
        match self {
            Self::Sequential { id, .. } | Self::Writers { id, .. } => id,
        }
    }

    fn requires_database(&self) -> bool {
        !matches!(
            self,
            Self::Sequential {
                backend: Backend::Memory,
                ..
            }
        )
    }
}

struct Arguments {
    case: Case,
    operations: u64,
    seed: u64,
    database: Option<PathBuf>,
}

fn option_value(
    args: &mut impl Iterator<Item = String>,
    option: &str,
) -> Result<String, BenchError> {
    args.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("missing value for {option}"),
        )
        .into()
    })
}

fn parse_arguments() -> Result<Arguments, BenchError> {
    let mut args = env::args().skip(1);
    let mut case = None;
    let mut operations = None;
    let mut seed = None;
    let mut database = None;
    while let Some(option) = args.next() {
        let destination = match option.as_str() {
            "--case" if case.is_none() => &mut case,
            "--operations" if operations.is_none() => &mut operations,
            "--seed" if seed.is_none() => &mut seed,
            "--database" if database.is_none() => &mut database,
            _ => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown or duplicate option: {option}"),
                )
                .into());
            }
        };
        *destination = Some(option_value(&mut args, &option)?);
    }

    let case = Case::parse(
        case.as_deref()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing --case"))?,
    )?;
    let operations = operations
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing --operations"))?
        .parse::<u64>()?;
    if !(1..=MAX_OPERATIONS).contains(&operations) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("--operations must be in 1..={MAX_OPERATIONS}"),
        )
        .into());
    }
    let seed = seed
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing --seed"))?
        .parse::<u64>()?;
    let database = database.map(PathBuf::from);
    if case.requires_database() != database.is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--database is required exactly for RocksDB cases",
        )
        .into());
    }
    if database.as_ref().is_some_and(|path| !path.is_absolute()) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "--database must be an absolute path",
        )
        .into());
    }
    Ok(Arguments {
        case,
        operations,
        seed,
        database,
    })
}

fn benchmark_quad(seed: u64, writer: usize, operation: u64) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!(
            "urn:oxigraph:g1.7:{seed}:subject:{writer}:{operation}"
        )),
        NamedNode::new_unchecked("urn:oxigraph:g1.7:predicate"),
        NamedNode::new_unchecked("urn:oxigraph:g1.7:object"),
        GraphName::DefaultGraph,
    )
}

fn prepared_update(seed: u64) -> Result<(PreparedSparqlUpdate, Quad, u64), BenchError> {
    let subject = format!("urn:oxigraph:g1.7:{seed}:sequential");
    let update = format!(
        "DELETE DATA {{ <{subject}> <urn:oxigraph:g1.7:predicate> <urn:oxigraph:g1.7:object> }};\
         INSERT DATA {{ <{subject}> <urn:oxigraph:g1.7:predicate> <urn:oxigraph:g1.7:object> }}"
    );
    let quad = Quad::new(
        NamedNode::new_unchecked(subject),
        NamedNode::new_unchecked("urn:oxigraph:g1.7:predicate"),
        NamedNode::new_unchecked("urn:oxigraph:g1.7:object"),
        GraphName::DefaultGraph,
    );
    let bytes = u64::try_from(update.len())?;
    Ok((SparqlEvaluator::new().parse_update(&update)?, quad, bytes))
}

fn open_store(backend: Backend, database: Option<&Path>) -> Result<Store, BenchError> {
    Ok(match backend {
        Backend::Memory => Store::new()?,
        Backend::RocksDb => {
            Store::open(database.ok_or_else(|| {
                io::Error::new(io::ErrorKind::InvalidInput, "missing RocksDB path")
            })?)?
        }
    })
}

fn sequential(
    binding: Binding,
    backend: Backend,
    database: Option<&Path>,
    operations: u64,
    seed: u64,
) -> Result<(u64, u64, u64), BenchError> {
    let store = open_store(backend, database)?;
    let (prepared, expected, bytes_per_operation) = prepared_update(seed)?;
    let started = Instant::now();
    for _ in 0..operations {
        match binding {
            Binding::Store => prepared.clone().on_store(&store).execute()?,
            Binding::Dataset => prepared.clone().on_dataset(&store).execute()?,
        }
    }
    let elapsed = u64::try_from(started.elapsed().as_nanos())?;
    if !store.contains(&expected)? || store.len()? != 1 {
        return Err(io::Error::other("sequential benchmark result is invalid").into());
    }
    Ok((elapsed, operations, operations * bytes_per_operation))
}

fn join_writer(handle: thread::JoinHandle<Result<(), BenchError>>) -> Result<(), BenchError> {
    handle
        .join()
        .map_err(|_| io::Error::other("benchmark writer panicked"))??;
    Ok(())
}

fn writer_block(
    writers: usize,
    database: &Path,
    operations: u64,
    seed: u64,
) -> Result<(u64, u64, u64, u64), BenchError> {
    let store = Arc::new(Store::open(database)?);
    let barrier = Arc::new(Barrier::new(writers + 2));
    let finished = Arc::new(AtomicBool::new(false));
    let reader_count = Arc::new(AtomicU64::new(0));

    let reader_store = Arc::clone(&store);
    let reader_barrier = Arc::clone(&barrier);
    let reader_finished = Arc::clone(&finished);
    let observed_reads = Arc::clone(&reader_count);
    let reader = thread::spawn(move || -> Result<(), BenchError> {
        reader_barrier.wait();
        while !reader_finished.load(Ordering::Acquire) {
            std::hint::black_box(reader_store.len()?);
            observed_reads.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    });

    let mut handles = Vec::with_capacity(writers);
    for writer in 0..writers {
        let writer_store = Arc::clone(&store);
        let writer_barrier = Arc::clone(&barrier);
        handles.push(thread::spawn(move || -> Result<(), BenchError> {
            writer_barrier.wait();
            for operation in 0..operations {
                let mut transaction = writer_store.start_transaction()?;
                transaction.insert(benchmark_quad(seed, writer, operation));
                transaction.commit()?;
            }
            Ok(())
        }));
    }

    barrier.wait();
    let started = Instant::now();
    for handle in handles {
        join_writer(handle)?;
    }
    let elapsed = u64::try_from(started.elapsed().as_nanos())?;
    finished.store(true, Ordering::Release);
    join_writer(reader)?;

    let total_operations = operations * u64::try_from(writers)?;
    if store.len()? != usize::try_from(total_operations)? {
        return Err(io::Error::other("writer benchmark lost committed data").into());
    }
    let reads = reader_count.load(Ordering::Relaxed);
    if reads == 0 {
        return Err(io::Error::other("concurrent reader made no progress").into());
    }
    Ok((elapsed, total_operations, total_operations * 128, reads))
}

fn main() -> Result<(), BenchError> {
    let arguments = parse_arguments()?;
    let case_id = arguments.case.id();
    let (elapsed_ns, operations, bytes, reader_observations) = match arguments.case {
        Case::Sequential {
            binding, backend, ..
        } => {
            let (elapsed, operations, bytes) = sequential(
                binding,
                backend,
                arguments.database.as_deref(),
                arguments.operations,
                arguments.seed,
            )?;
            (elapsed, operations, bytes, 0)
        }
        Case::Writers { writers, .. } => {
            let (elapsed, operations, bytes, reads) = writer_block(
                writers,
                arguments.database.as_deref().ok_or_else(|| {
                    io::Error::new(io::ErrorKind::InvalidInput, "missing RocksDB path")
                })?,
                arguments.operations,
                arguments.seed,
            )?;
            (elapsed, operations, bytes, reads)
        }
    };
    if elapsed_ns == 0 {
        return Err(io::Error::other("benchmark elapsed time was zero").into());
    }
    let sample = serde_json::to_string(&json!({
        "schema": SCHEMA,
        "caseId": case_id,
        "seed": arguments.seed,
        "operations": operations,
        "bytes": bytes,
        "elapsedNs": elapsed_ns,
        "readerObservations": reader_observations,
    }))?;
    writeln!(io::stdout().lock(), "{sample}")?;
    Ok(())
}
