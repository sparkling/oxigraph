//! Local SELECT comparison, not a qualification or default-promotion command.
//! Usage: query_benchmark DATASET REPETITIONS [OPTIONS] (--bag|--ordered) QUERY.rq ...
//! Input identities and raw samples are JSON lines on stdout; no files published.
use oxigraph::io::RdfFormat;
use oxigraph::model::graph::CanonicalizationAlgorithm;
use oxigraph::model::{BlankNode, Graph, Literal, NamedNode, Term, Triple, Variable};
use oxigraph::sparql::{
    BoundedJoinCostModel, BoundedJoinPlanning, CardinalityFeedbackNode, PreparedSparqlQuery,
    QueryResults, QuerySolution, SparqlEvaluator, StatisticsAvailability,
};
use oxigraph::store::{
    DerivedGenerationLimits, DerivedIndex, DerivedProvider, StatisticsProvider, Store,
    TransactionStartControl,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::sync::Arc;
use std::time::Instant;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const MODE_NAMES: [&str; 10] = [
    "greedy",
    "bounded",
    "statistics_greedy",
    "statistics_bounded",
    "shared_statistics_greedy",
    "shared_statistics_bounded",
    "bounded_conditional_v2",
    "shared_statistics_bounded_conditional_v2",
    "bounded_correlated_v3",
    "shared_statistics_bounded_correlated_v3",
];

// Keep selection outside the measured path. Explicit names prevent a typo from
// silently running the default set (and mislabelling process resource use).
struct Options {
    modes: Vec<usize>,
    limits: DerivedGenerationLimits,
    format: RdfFormat,
    union_default_graph: bool,
    statistics_setup: bool,
    input_manifest: Option<String>,
}

fn uses_statistics(mode: usize) -> bool {
    (2..=5).contains(&mode) || mode == 7 || mode == 9
}

fn selection(mut args: &[String]) -> Result<(Options, &[String])> {
    let mut modes: Vec<usize> = (0..MODE_NAMES.len()).collect();
    let mut limits = DerivedGenerationLimits::default();
    let mut format = RdfFormat::NTriples;
    let mut union_default_graph = false;
    let mut statistics_setup = true;
    let mut input_manifest = None;
    let mut seen = BTreeSet::new();
    while let Some(option) = args.first() {
        if matches!(option.as_str(), "--bag" | "--ordered") {
            break;
        }
        if !seen.insert(option) {
            return Err(format!("duplicate option {option}").into());
        }
        let value = args
            .get(1)
            .ok_or_else(|| format!("{option} requires a value"))?;
        match option.as_str() {
            "--input-manifest" => input_manifest = Some(value.clone()),
            "--mode" => {
                modes.clear();
                for selected in value.split(',') {
                    let mode = MODE_NAMES
                        .iter()
                        .position(|name| *name == selected)
                        .ok_or_else(|| {
                            format!(
                                "unknown mode {selected}; expected one of {}",
                                MODE_NAMES.join(", ")
                            )
                        })?;
                    if modes.contains(&mode) {
                        return Err(format!("duplicate mode {selected}").into());
                    }
                    modes.push(mode);
                }
            }
            "--max-input-records" => limits.input.max_records = value.parse()?,
            "--max-input-bytes" => limits.input.max_bytes = value.parse()?,
            "--format" => {
                format = match value.as_str() {
                    "nt" => RdfFormat::NTriples,
                    "nq" => RdfFormat::NQuads,
                    _ => return Err("format must be nt or nq".into()),
                };
            }
            "--default-graph" => {
                union_default_graph = match value.as_str() {
                    "stored" => false,
                    "named-union" => true,
                    _ => return Err("default graph must be stored or named-union".into()),
                };
            }
            "--setup" => {
                statistics_setup = match value.as_str() {
                    "statistics" => true,
                    "query-only" => false,
                    _ => return Err("setup must be statistics or query-only".into()),
                };
            }
            _ => return Err(format!("unknown option {option}").into()),
        }
        args = &args[2..];
    }
    let queries = args;
    if queries.is_empty() || !queries.len().is_multiple_of(2) {
        return Err("expected one or more (--bag|--ordered) QUERY.rq pairs".into());
    }
    for pair in queries.chunks_exact(2) {
        if !matches!(pair[0].as_str(), "--bag" | "--ordered") {
            return Err("each SELECT needs an explicit --bag or --ordered comparison".into());
        }
    }
    if !statistics_setup && modes.iter().any(|&mode| uses_statistics(mode)) {
        return Err("query-only setup requires a mode that does not use statistics".into());
    }
    if !statistics_setup
        && seen
            .iter()
            .any(|option| matches!(option.as_str(), "--max-input-records" | "--max-input-bytes"))
    {
        return Err("statistics input limits do not apply to query-only setup".into());
    }
    Ok((
        Options {
            modes,
            limits,
            format,
            union_default_graph,
            statistics_setup,
            input_manifest,
        },
        queries,
    ))
}

fn prepare(evaluator: SparqlEvaluator, query: &str, union: bool) -> Result<PreparedSparqlQuery> {
    let mut prepared = evaluator.parse_query(query)?;
    if union {
        prepared.dataset_mut().set_default_graph_as_union();
    }
    Ok(prepared)
}

struct Rows {
    variables: Vec<Variable>,
    rows: Vec<QuerySolution>,
}
impl Rows {
    fn collect(results: QueryResults<'_>) -> Result<Self> {
        let QueryResults::Solutions(rows) = results else {
            return Err("this comparison supports SELECT only".into());
        };
        let mut variables = rows.variables().to_vec();
        variables.sort_unstable();
        Ok(Self {
            variables,
            // Do not drop evaluation errors, cap rows silently, or deduplicate.
            rows: rows.collect::<std::result::Result<_, _>>()?,
        })
    }

    fn equivalent(&self, other: &Self, ordered: bool) -> Result<bool> {
        if self.variables != other.variables || self.rows.len() != other.rows.len() {
            return Ok(false);
        }
        // Canonicalization is outside measured execution. Distinct row nodes
        // preserve duplicates and empty bindings; remapping result blank nodes
        // keeps them disjoint from row nodes. A global bijection also preserves
        // co-identity across rows and nested RDF 1.2 triple terms.
        Ok(self.graph(ordered)? == other.graph(ordered)?)
    }

    fn graph(&self, ordered: bool) -> Result<Graph> {
        let mut graph = Graph::new();
        let mut blank_nodes = BTreeMap::new();
        for (position, row) in self.rows.iter().enumerate() {
            let row_node = BlankNode::new(format!("row{position}"))?;
            graph.insert(Triple::new(
                row_node.clone(),
                NamedNode::new("urn:benchmark:row")?,
                if ordered {
                    Term::from(Literal::from(position.to_string()))
                } else {
                    NamedNode::new("urn:benchmark:Solution")?.into()
                },
            ));
            for (column, variable) in self.variables.iter().enumerate() {
                if let Some(value) = row.get(variable) {
                    graph.insert(Triple::new(
                        row_node.clone(),
                        NamedNode::new(format!("urn:benchmark:column:{column}"))?,
                        remap(value, &mut blank_nodes)?,
                    ));
                }
            }
        }
        graph.canonicalize(CanonicalizationAlgorithm::Unstable)?;
        Ok(graph)
    }
}

fn remap(value: &Term, nodes: &mut BTreeMap<String, BlankNode>) -> Result<Term> {
    Ok(match value {
        Term::BlankNode(node) => {
            let next = BlankNode::new(format!("value{}", nodes.len()))?;
            nodes
                .entry(node.as_str().to_owned())
                .or_insert(next)
                .clone()
                .into()
        }
        #[cfg(feature = "rdf-12")]
        Term::Triple(triple) => Triple::new(
            oxigraph::model::NamedOrBlankNode::try_from(remap(
                &triple.subject.clone().into(),
                nodes,
            )?)
            .map_err(|_| "invalid triple subject")?,
            triple.predicate.clone(),
            remap(&triple.object, nodes)?,
        )
        .into(),
        _ => value.clone(),
    })
}

fn feedback(node: &CardinalityFeedbackNode) -> Value {
    json!({
        "operator": node.operator,
        "estimated_rows": node.estimated_rows,
        "estimate_basis": node.estimate_basis.map(|basis| format!("{basis:?}")),
        "observed_rows": node.observed_rows,
        "invocations": node.invocations,
        "completed_invocations": node.completed_invocations,
        "failed_invocations": node.failed_invocations,
        "abandoned_invocations": node.abandoned_invocations,
        "bound_invocations": node.bound_invocations,
        "cardinality_complete": node.cardinality_complete,
        "q_error": node.q_error,
        "children": node.children.iter().map(feedback).collect::<Vec<_>>()
    })
}

fn emit(value: &Value) -> Result {
    writeln!(std::io::stdout().lock(), "{value}")?;
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    Sha256::digest(bytes)
        .iter()
        .flat_map(|byte| {
            [
                char::from(HEX[usize::from(byte >> 4)]),
                char::from(HEX[usize::from(byte & 15)]),
            ]
        })
        .collect()
}

// This pins input identity only, not performance thresholds or promotion.
// Reject omissions, reordering, changed comparison semantics and changed graph
// interpretation before creating/loading the temporary database. No auto-refresh.
fn verify_inputs(manifest: &Value, actual: &Value) -> Result {
    if manifest["format"] != "oxigraph.query-inputs.v1" {
        return Err("unsupported query input manifest format".into());
    }
    for key in ["dataset_sha256", "rdf_format", "default_graph", "queries"] {
        if manifest.get(key).is_none() || manifest.get(key) != actual.get(key) {
            return Err(format!("input manifest mismatch: {key}").into());
        }
    }
    Ok(())
}

fn main() -> Result {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 4 || args.len() % 2 != 0 {
        return Err(
            "usage: query_benchmark DATASET REPETITIONS [--mode MODE[,MODE...]] [--format nt|nq] [--default-graph stored|named-union] [--setup statistics|query-only] [--max-input-records N] [--max-input-bytes N] [--input-manifest JSON] (--bag|--ordered) QUERY.rq ...".into(),
        );
    }
    let repetitions: usize = args[1].parse()?;
    if !(1..=100).contains(&repetitions) {
        return Err("repetitions must be 1..100".into());
    }
    let (options, queries) = selection(&args[2..])?;
    let Options {
        modes,
        limits,
        format,
        union_default_graph,
        statistics_setup,
        input_manifest,
    } = options;
    let bytes = std::fs::read(&args[0])?;
    let data_sha256 = sha256(&bytes);
    // Retain the exact query bytes validated here for execution; do not reopen
    // mutable input files after their hashes have passed the manifest check.
    let queries = queries
        .chunks_exact(2)
        .map(|pair| {
            let query = std::fs::read_to_string(&pair[1])?;
            let digest = sha256(query.as_bytes());
            Ok((pair[0] == "--ordered", pair[1].clone(), query, digest))
        })
        .collect::<Result<Vec<_>>>()?;
    let manifest_sha256 = if let Some(path) = &input_manifest {
        let manifest_bytes = std::fs::read(path)?;
        let manifest: Value = serde_json::from_slice(&manifest_bytes)?;
        verify_inputs(
            &manifest,
            &json!({
                "dataset_sha256": data_sha256,
                "rdf_format": format.file_extension(),
                "default_graph": if union_default_graph { "named-union" } else { "stored" },
                "queries": queries.iter().map(|(ordered, _, _, digest)| json!({
                    "sha256": digest, "comparison": if *ordered { "sequence" } else { "bag" }
                })).collect::<Vec<_>>()
            }),
        )?;
        Some(sha256(&manifest_bytes))
    } else {
        None
    };
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path().join("db"))?;
    let started = Instant::now();
    store.load_from_slice(format, &bytes)?;
    let load_seconds = started.elapsed().as_secs_f64();
    drop(bytes);
    let provider = StatisticsProvider::default();
    let mut statistics_build_activate_seconds = None;
    let mut statistics_verification_seconds = None;
    let statistics = if statistics_setup {
        let started = Instant::now();
        let mut index =
            DerivedIndex::create(directory.path().join("statistics"), provider.identity())?;
        let source = store.derived_snapshot(&TransactionStartControl::new())?;
        let generation = index.rebuild(&source, &provider, &limits)?;
        index.activate(&generation, &source, &provider, &limits)?;
        statistics_build_activate_seconds = Some(started.elapsed().as_secs_f64());
        let started = Instant::now();
        let shared = Arc::new(provider.read(&index.strict(&source, &limits)?, &limits.input)?);
        statistics_verification_seconds = Some(started.elapsed().as_secs_f64());
        Some((index, shared))
    } else {
        None
    };
    emit(&json!({
        "kind": "input", "format": "oxigraph.query-benchmark.v1",
        "dataset": args[0], "dataset_sha256": data_sha256,
        "input_manifest": input_manifest, "input_manifest_sha256": manifest_sha256,
        "rdf_format": format.file_extension(),
        "default_graph": if union_default_graph { "named-union" } else { "stored" },
        "setup": if statistics_setup { "statistics" } else { "query-only" },
        "quads": store.len()?, "repetitions": repetitions, "warmups_per_mode": 1,
        "max_input_records": statistics_setup.then_some(limits.input.max_records.get()),
        "max_input_logical_bytes": statistics_setup.then_some(limits.input.max_bytes.get()),
        "load_seconds": load_seconds,
        "statistics_build_activate_seconds": statistics_build_activate_seconds,
        "statistics_verification_seconds": statistics_verification_seconds,
        "cost_models": [BoundedJoinCostModel::IndependentV1.id(), BoundedJoinCostModel::ConditionalV2.id(), BoundedJoinCostModel::CorrelatedV3.id()],
        "selected_modes": modes.iter().map(|&mode| MODE_NAMES[mode]).collect::<Vec<_>>(),
        "mode_rotation": modes.len() > 1,
        "max_dp_leaves": BoundedJoinPlanning::default().max_dp_leaves(),
        "debug_assertions": cfg!(debug_assertions), "rdf_12": cfg!(feature = "rdf-12"),
        "cache": "shared process; no eviction or cold-cache claim",
        "timing": "sample excludes feedback instrumentation and result comparison; explain includes planning; feedback records are separate instrumented diagnostic runs",
        "input_contract": "bounded deterministic SELECT corpus; --ordered requires a fully determined projected sequence; no resource-ceiling claim",
        "scope": "local diagnostic; not frozen-corpus acceptance or qualification"
    }))?;
    // The store is private, receives no further writes and has no other handles.
    // Each statistics query checks that its new retained source is current.
    let mut emitted = 0;
    for (ordered, path, query, query_sha256) in &queries {
        let oracle = Rows::collect(
            prepare(
                SparqlEvaluator::new().without_optimizations(),
                query,
                union_default_graph,
            )?
            .on_store(&store)
            .execute()?,
        )?;
        emit(
            &json!({"kind": "query", "path": path, "sha256": query_sha256,
            "comparison": if *ordered { "sequence" } else { "bag" },
            "oracle": "optimization-disabled", "rows": oracle.rows.len()}),
        )?;
        // Round zero warms all modes; subsequent rounds rotate the first mode
        // to expose rather than systematically favor one cache position.
        // One separate instrumented round follows latency sampling.
        for round in 0..=repetitions + 1 {
            let instrumented = round == repetitions + 1;
            for offset in 0..modes.len() {
                let mode = modes[(offset + round) % modes.len()];
                let mode_name = MODE_NAMES[mode];
                let started = Instant::now();
                let mut evaluator = SparqlEvaluator::new();
                if mode % 2 == 1 || mode >= 6 {
                    evaluator = evaluator.with_bounded_join_planning(
                        BoundedJoinPlanning::default().with_cost_model(if mode >= 8 {
                            BoundedJoinCostModel::CorrelatedV3
                        } else if mode >= 6 {
                            BoundedJoinCostModel::ConditionalV2
                        } else {
                            BoundedJoinCostModel::IndependentV1
                        }),
                    );
                }
                let prepared = prepare(evaluator, query, union_default_graph)?;
                let prepare_seconds = started.elapsed().as_secs_f64();
                let admission_started = Instant::now();
                let (result, explanation, admission_seconds, explain_seconds) =
                    if uses_statistics(mode) {
                        let (index, shared) =
                            statistics.as_ref().ok_or("statistics setup missing")?;
                        let source = store.derived_snapshot(&TransactionStartControl::new())?;
                        let mut bound = if mode >= 4 {
                            prepared.on_statistics_snapshot(
                                source,
                                Arc::clone(shared),
                                TransactionStartControl::new(),
                            )?
                        } else {
                            prepared.on_statistics(source, index, &provider, limits.clone())?
                        };
                        // A silently rejected generation is not a statistics sample.
                        if bound.context().availability != StatisticsAvailability::Current {
                            return Err("statistics admission was not current".into());
                        }
                        let admission = admission_started.elapsed().as_secs_f64();
                        let explain_started = Instant::now();
                        if instrumented {
                            bound = bound.compute_statistics();
                        }
                        let (result, explanation) = bound.explain()?;
                        (
                            result,
                            explanation,
                            admission,
                            explain_started.elapsed().as_secs_f64(),
                        )
                    } else {
                        let mut bound = prepared.on_store(&store);
                        let admission = admission_started.elapsed().as_secs_f64();
                        let explain_started = Instant::now();
                        if instrumented {
                            bound = bound.compute_statistics();
                        }
                        let (result, explanation) = bound.explain();
                        (
                            result,
                            explanation,
                            admission,
                            explain_started.elapsed().as_secs_f64(),
                        )
                    };
                let consume_started = Instant::now();
                let actual = Rows::collect(result?)?;
                let consume_seconds = consume_started.elapsed().as_secs_f64();
                let total_seconds = started.elapsed().as_secs_f64();
                if !oracle.equivalent(&actual, *ordered)? {
                    return Err(format!("result mismatch: {path} mode {mode_name} round {round}; investigate corpus determinism and ordering before attributing an optimizer defect").into());
                }
                let observations = explanation.cardinality_feedback();
                let search = explanation.join_planning();
                emit(&json!({
                    "kind": if instrumented { "feedback" } else { "sample" }, "query_sha256": query_sha256,
                    "mode": mode_name, "round": round, "warmup": round == 0,
                    "cost_model": search.bounded.map(|options| options.cost_model().id()),
                    "rows": actual.rows.len(), "equivalent": true,
                    "prepare_seconds": prepare_seconds, "admission_seconds": admission_seconds,
                    "explain_seconds": explain_seconds, "planning_seconds": observations.planning_seconds,
                    "consume_seconds": consume_seconds, "total_seconds": total_seconds,
                    "dp_components": search.dp_components, "greedy_components": search.greedy_components,
                    "dp_states": search.dp_states, "dp_candidates": search.dp_candidates,
                    "feedback": instrumented.then(|| feedback(&observations.root))
                }))?;
                emitted += 1;
            }
        }
    }
    let queries = queries.len();
    emit(
        &json!({"kind": "complete", "queries": queries, "emitted_observations": emitted,
        "expected_observations": queries * (repetitions + 2) * modes.len(),
        "samples": queries * (repetitions + 1) * modes.len(), "feedback_records": queries * modes.len(),
        "all_equivalent": true}),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_rejects_changed_or_incomplete_inputs() -> Result {
        let manifest = json!({
            "format": "oxigraph.query-inputs.v1",
            "dataset_sha256": sha256(b"dataset"), "rdf_format": "nt", "default_graph": "stored",
            "queries": [
                {"sha256": sha256(b"q1"), "comparison": "bag"},
                {"sha256": sha256(b"q2"), "comparison": "sequence"}
            ]
        });
        verify_inputs(&manifest, &manifest)?;
        for key in ["dataset_sha256", "rdf_format", "default_graph", "queries"] {
            let mut changed = manifest.clone();
            changed[key] = Value::Null;
            assert!(verify_inputs(&manifest, &changed).is_err(), "changed {key}");
            let mut missing = manifest.clone();
            missing
                .as_object_mut()
                .ok_or("expected object")?
                .remove(key);
            assert!(verify_inputs(&missing, &manifest).is_err(), "missing {key}");
        }
        let mut changed = manifest.clone();
        changed["format"] = "oxigraph.query-inputs.v2".into();
        assert!(verify_inputs(&changed, &manifest).is_err());
        for queries in [
            json!([manifest["queries"][1], manifest["queries"][0]]),
            json!([manifest["queries"][0]]),
            json!([manifest["queries"][0], manifest["queries"][0]]),
            json!([{"sha256":sha256(b"q1"), "comparison":"sequence"}, manifest["queries"][1]]),
            json!([{"sha256":sha256(b"changed q1"), "comparison":"bag"}, manifest["queries"][1]]),
        ] {
            changed = manifest.clone();
            changed["queries"] = queries;
            assert!(verify_inputs(&manifest, &changed).is_err());
        }
        Ok(())
    }

    #[test]
    fn mode_selection_is_explicit_and_preserves_default_order() -> Result {
        let args = |values: &[&str]| values.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        let default = args(&["--bag", "q.rq", "--ordered", "ordered.rq"]);
        let (options, queries) = selection(&default)?;
        assert_eq!(options.modes, (0..MODE_NAMES.len()).collect::<Vec<_>>());
        assert_eq!(options.format, RdfFormat::NTriples);
        assert!(options.statistics_setup);
        assert!(!options.union_default_graph);
        assert_eq!(
            options.limits.input.max_records,
            DerivedGenerationLimits::default().input.max_records
        );
        assert_eq!(
            options.limits.input.max_bytes,
            DerivedGenerationLimits::default().input.max_bytes
        );
        assert_eq!(queries, default);
        for (expected, name) in MODE_NAMES.iter().enumerate() {
            let selected = args(&["--mode", name, "--bag", "q.rq"]);
            let (options, queries) = selection(&selected)?;
            assert_eq!(options.modes, [expected]);
            assert_eq!(queries, &selected[2..]);
        }
        for invalid in [
            vec![],
            vec!["--mode"],
            vec!["--mode", "greedy"],
            vec!["--mode", "typo", "--bag", "q.rq"],
            vec!["--mode", "greedy", "--mode", "bounded", "--bag", "q.rq"],
            vec!["--bag"],
            vec!["--silent", "q.rq"],
            vec!["--input-manifest"],
            vec![
                "--input-manifest",
                "a.json",
                "--input-manifest",
                "b.json",
                "--bag",
                "q.rq",
            ],
        ] {
            assert!(selection(&args(&invalid)).is_err(), "{invalid:?}");
        }
        let selected = args(&["--input-manifest", "inputs.json", "--bag", "q.rq"]);
        assert_eq!(
            selection(&selected)?.0.input_manifest.as_deref(),
            Some("inputs.json")
        );
        Ok(())
    }

    #[test]
    fn selected_mode_pairs_preserve_order_and_reject_ambiguous_inputs() -> Result {
        let args = |value: &str, setup: &str| {
            ["--mode", value, "--setup", setup, "--bag", "q.rq"].map(str::to_owned)
        };
        for (left, left_name) in MODE_NAMES.iter().enumerate() {
            for (right, right_name) in MODE_NAMES.iter().enumerate() {
                let value = format!("{left_name},{right_name}");
                let selected = args(&value, "statistics");
                if left == right {
                    assert!(selection(&selected).is_err());
                    continue;
                }
                let (options, queries) = selection(&selected)?;
                assert_eq!(options.modes, [left, right]);
                assert_eq!(queries, &selected[4..]);
                assert_eq!(
                    selection(&args(&value, "query-only")).is_err(),
                    uses_statistics(left) || uses_statistics(right)
                );
            }
        }
        for value in [
            "",
            ",",
            "greedy,",
            ",bounded",
            "greedy,,bounded",
            "greedy,typo",
            "greedy, bounded",
        ] {
            assert!(selection(&args(value, "statistics")).is_err(), "{value:?}");
        }
        let selected = args(&MODE_NAMES.join(","), "statistics");
        assert_eq!(
            selection(&selected)?.0.modes,
            (0..MODE_NAMES.len()).collect::<Vec<_>>()
        );
        Ok(())
    }

    #[test]
    fn explicit_input_limits_are_nonzero_and_enforced() -> Result {
        let args = |values: &[&str]| values.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        let selected = args(&[
            "--max-input-records",
            "2",
            "--mode",
            "greedy",
            "--max-input-bytes",
            "1024",
            "--bag",
            "q.rq",
        ]);
        let (options, queries) = selection(&selected)?;
        assert_eq!(options.modes, [0]);
        let mut limits = options.limits;
        assert_eq!(queries, &selected[6..]);
        assert_eq!(limits.input.max_records.get(), 2);
        assert_eq!(limits.input.max_bytes.get(), 1024);
        let directory = tempfile::tempdir()?;
        let store = Store::open(directory.path().join("db"))?;
        store.load_from_slice(
            RdfFormat::NTriples,
            b"<urn:s> <urn:p> <urn:a> .\n<urn:s> <urn:p> <urn:b> .\n",
        )?;
        let source = store.derived_snapshot(&TransactionStartControl::new())?;
        assert_eq!(source.scan(&limits.input, |_| Ok(()))?.records(), 2);
        limits.input.max_records = std::num::NonZeroU64::MIN;
        assert!(matches!(
            source.scan(&limits.input, |_| Ok(())),
            Err(oxigraph::store::DerivedError::Limit)
        ));
        limits.input.max_records = 2.try_into()?;
        limits.input.max_bytes = std::num::NonZeroU64::MIN;
        assert!(matches!(
            source.scan(&limits.input, |_| Ok(())),
            Err(oxigraph::store::DerivedError::Limit)
        ));
        for option in ["--max-input-records", "--max-input-bytes"] {
            for value in ["0", "-1", "18446744073709551616", "typo"] {
                assert!(selection(&args(&[option, value, "--bag", "q.rq"])).is_err());
            }
            assert!(selection(&args(&[option, "1", option, "2", "--bag", "q.rq"])).is_err());
            assert!(selection(&args(&[option])).is_err());
        }
        Ok(())
    }

    #[test]
    fn query_only_setup_cannot_silently_disable_statistics() -> Result {
        let args = |values: &[&str]| values.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        for (mode, name) in MODE_NAMES.iter().enumerate() {
            let selected = args(&[
                "--setup",
                "query-only",
                "--mode",
                name,
                "--format",
                "nq",
                "--default-graph",
                "named-union",
                "--bag",
                "q.rq",
            ]);
            let result = selection(&selected);
            if uses_statistics(mode) {
                assert!(result.is_err(), "mode {name}");
            } else {
                let (options, _) = result?;
                assert!(!options.statistics_setup);
                assert!(options.union_default_graph);
                assert_eq!(options.format, RdfFormat::NQuads);
            }
        }
        for values in [
            vec!["--setup", "query-only", "--bag", "q.rq"],
            vec![
                "--setup",
                "query-only",
                "--mode",
                "greedy",
                "--max-input-records",
                "1",
                "--bag",
                "q.rq",
            ],
            vec!["--setup", "typo", "--bag", "q.rq"],
            vec!["--format", "trig", "--bag", "q.rq"],
            vec!["--default-graph", "all", "--bag", "q.rq"],
            vec![
                "--setup",
                "statistics",
                "--setup",
                "statistics",
                "--bag",
                "q.rq",
            ],
        ] {
            assert!(selection(&args(&values)).is_err(), "{values:?}");
        }
        Ok(())
    }

    #[test]
    fn nquads_and_query_dataset_selection_are_shared_with_the_oracle() -> Result {
        let store = Store::new()?;
        store.load_from_slice(
            RdfFormat::NQuads,
            concat!(
                "<urn:default> <urn:p> <urn:o> .\n",
                "_:shared <urn:p> <urn:o> <urn:g1> .\n",
                "_:shared <urn:p> <urn:o> <urn:g2> .\n",
                "<urn:ground> <urn:p> <urn:o> <urn:g1> .\n",
                "<urn:ground> <urn:p> <urn:o> <urn:g2> .\n",
            ),
        )?;
        assert_eq!(store.len()?, 5);
        assert_eq!(
            store
                .named_graphs()
                .collect::<std::result::Result<Vec<_>, _>>()?
                .len(),
            2
        );
        for (query, union, count) in [
            ("SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }", false, 1),
            ("SELECT (COUNT(*) AS ?n) WHERE { ?s ?p ?o }", true, 2),
            (
                "SELECT (COUNT(*) AS ?n) FROM <urn:g1> FROM <urn:g2> WHERE { ?s ?p ?o }",
                false,
                3,
            ),
            (
                "SELECT (COUNT(*) AS ?n) WHERE { GRAPH ?g { ?s ?p ?o } }",
                true,
                4,
            ),
        ] {
            let expected = rows(&format!("SELECT ?n WHERE {{ VALUES ?n {{ {count} }} }}"))?;
            for evaluator in [
                SparqlEvaluator::new().without_optimizations(),
                SparqlEvaluator::new(),
                SparqlEvaluator::new().with_bounded_join_planning(BoundedJoinPlanning::default()),
            ] {
                let result = Rows::collect(
                    prepare(evaluator, query, union)?
                        .on_store(&store)
                        .execute()?,
                )?;
                assert!(
                    result.equivalent(&expected, false)?,
                    "query {query}, union {union}"
                );
            }
        }
        Ok(())
    }

    fn rows(query: &str) -> Result<Rows> {
        Rows::collect(
            SparqlEvaluator::new()
                .parse_query(query)?
                .on_store(&Store::new()?)
                .execute()?,
        )
    }

    #[test]
    fn oracle_preserves_multiplicity_unbound_columns_and_sequence() -> Result {
        let a = rows("SELECT ?x { VALUES ?x { 1 2 1 } }")?;
        let b = rows("SELECT ?x { VALUES ?x { 1 1 2 } }")?;
        assert!(a.equivalent(&b, false)?);
        assert!(!a.equivalent(&b, true)?);
        assert!(!a.equivalent(&rows("SELECT ?x { VALUES ?x { 1 2 } }")?, false)?);
        assert!(!rows("SELECT * {}")?.equivalent(&rows("SELECT * { FILTER(false) }")?, false)?);
        assert!(
            !rows("SELECT ?x { VALUES ?x { UNDEF } }")?
                .equivalent(&rows("SELECT ?y { VALUES ?y { UNDEF } }")?, false)?
        );
        Ok(())
    }

    #[test]
    fn oracle_preserves_blank_node_identity_without_row_collisions() -> Result {
        let query = "SELECT ?x ?y { BIND(BNODE('row0') AS ?x) BIND(?x AS ?y) }";
        let a = rows(query)?;
        assert!(a.equivalent(&rows(query)?, false)?);
        assert!(!a.equivalent(
            &rows("SELECT ?x ?y { BIND(BNODE() AS ?x) BIND(BNODE() AS ?y) }")?,
            false
        )?);
        Ok(())
    }
}
