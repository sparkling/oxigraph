//! Local SELECT comparison, not a qualification or default-promotion command.
//! Usage: query_benchmark DATASET.nt REPETITIONS [--mode MODE] (--bag|--ordered) QUERY.rq ...
//! Input identities and raw samples are JSON lines on stdout; no files published.
use oxigraph::io::RdfFormat;
use oxigraph::model::graph::CanonicalizationAlgorithm;
use oxigraph::model::{BlankNode, Graph, Literal, NamedNode, Term, Triple, Variable};
use oxigraph::sparql::{
    BoundedJoinCostModel, BoundedJoinPlanning, CardinalityFeedbackNode, QueryResults,
    QuerySolution, SparqlEvaluator, StatisticsAvailability,
};
use oxigraph::store::{
    DerivedGenerationLimits, DerivedIndex, DerivedProvider, StatisticsProvider, Store,
    TransactionStartControl,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Write;
use std::sync::Arc;
use std::time::Instant;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const MODE_NAMES: [&str; 8] = [
    "greedy",
    "bounded",
    "statistics_greedy",
    "statistics_bounded",
    "shared_statistics_greedy",
    "shared_statistics_bounded",
    "bounded_conditional_v2",
    "shared_statistics_bounded_conditional_v2",
];

// Keep selection outside the measured path. Explicit names prevent a typo from
// silently running the default set (and mislabelling process resource use).
fn selection(args: &[String]) -> Result<(Vec<usize>, &[String])> {
    let (modes, queries) = if args.first().is_some_and(|arg| arg == "--mode") {
        let name = args.get(1).ok_or("--mode requires a mode name")?;
        let mode = MODE_NAMES
            .iter()
            .position(|candidate| candidate == name)
            .ok_or_else(|| {
                format!(
                    "unknown mode {name}; expected one of {}",
                    MODE_NAMES.join(", ")
                )
            })?;
        (vec![mode], &args[2..])
    } else {
        ((0..MODE_NAMES.len()).collect(), args)
    };
    if queries.is_empty() || queries.len() % 2 != 0 {
        return Err("expected one or more (--bag|--ordered) QUERY.rq pairs".into());
    }
    for pair in queries.chunks_exact(2) {
        if !matches!(pair[0].as_str(), "--bag" | "--ordered") {
            return Err("each SELECT needs an explicit --bag or --ordered comparison".into());
        }
    }
    Ok((modes, queries))
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

fn main() -> Result {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 4 || args.len() % 2 != 0 {
        return Err(
            "usage: query_benchmark DATASET.nt REPETITIONS [--mode MODE] (--bag|--ordered) QUERY.rq ...".into(),
        );
    }
    let repetitions: usize = args[1].parse()?;
    if !(1..=100).contains(&repetitions) {
        return Err("repetitions must be 1..100".into());
    }
    let (modes, queries) = selection(&args[2..])?;
    let bytes = std::fs::read(&args[0])?;
    let data_sha256 = sha256(&bytes);
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path().join("db"))?;
    let started = Instant::now();
    store.load_from_slice(RdfFormat::NTriples, &bytes)?;
    let load_seconds = started.elapsed().as_secs_f64();
    drop(bytes);
    let provider = StatisticsProvider::default();
    let limits = DerivedGenerationLimits::default();
    let started = Instant::now();
    let mut index = DerivedIndex::create(directory.path().join("statistics"), provider.identity())?;
    let source = store.derived_snapshot(&TransactionStartControl::new())?;
    let generation = index.rebuild(&source, &provider, &limits)?;
    index.activate(&generation, &source, &provider, &limits)?;
    let statistics_build_activate_seconds = started.elapsed().as_secs_f64();
    let started = Instant::now();
    let shared = Arc::new(provider.read(&index.strict(&source, &limits)?, &limits.input)?);
    let statistics_verification_seconds = started.elapsed().as_secs_f64();
    drop(source);
    emit(&json!({
        "kind": "input", "format": "oxigraph.query-benchmark.v1",
        "dataset": args[0], "dataset_sha256": data_sha256,
        "quads": store.len()?, "repetitions": repetitions, "warmups_per_mode": 1,
        "load_seconds": load_seconds,
        "statistics_build_activate_seconds": statistics_build_activate_seconds,
        "statistics_verification_seconds": statistics_verification_seconds,
        "cost_models": [BoundedJoinCostModel::IndependentV1.id(), BoundedJoinCostModel::ConditionalV2.id()],
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
    for pair in queries.chunks_exact(2) {
        let [comparison, path] = pair else {
            return Err("expected comparison and query path".into());
        };
        let ordered = comparison == "--ordered";
        let query = std::fs::read_to_string(path)?;
        let query_sha256 = sha256(query.as_bytes());
        let oracle = Rows::collect(
            SparqlEvaluator::new()
                .without_optimizations()
                .parse_query(&query)?
                .on_store(&store)
                .execute()?,
        )?;
        emit(
            &json!({"kind": "query", "path": path, "sha256": query_sha256,
            "comparison": if ordered { "sequence" } else { "bag" },
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
                if mode % 2 == 1 || mode == 6 {
                    evaluator = evaluator.with_bounded_join_planning(
                        BoundedJoinPlanning::default().with_cost_model(if mode >= 6 {
                            BoundedJoinCostModel::ConditionalV2
                        } else {
                            BoundedJoinCostModel::IndependentV1
                        }),
                    );
                }
                let prepared = evaluator.parse_query(&query)?;
                let prepare_seconds = started.elapsed().as_secs_f64();
                let admission_started = Instant::now();
                let (result, explanation, admission_seconds, explain_seconds) =
                    if (2..=5).contains(&mode) || mode == 7 {
                        let source = store.derived_snapshot(&TransactionStartControl::new())?;
                        let mut bound = if mode >= 4 {
                            prepared.on_statistics_snapshot(
                                source,
                                Arc::clone(&shared),
                                TransactionStartControl::new(),
                            )?
                        } else {
                            prepared.on_statistics(source, &index, &provider, limits.clone())?
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
                if !oracle.equivalent(&actual, ordered)? {
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
    let queries = queries.len() / 2;
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
    fn mode_selection_is_explicit_and_preserves_default_order() -> Result {
        let args = |values: &[&str]| values.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
        let default = args(&["--bag", "q.rq", "--ordered", "ordered.rq"]);
        let (modes, queries) = selection(&default)?;
        assert_eq!(modes, (0..MODE_NAMES.len()).collect::<Vec<_>>());
        assert_eq!(queries, default);
        for (expected, name) in MODE_NAMES.iter().enumerate() {
            let selected = args(&["--mode", name, "--bag", "q.rq"]);
            let (modes, queries) = selection(&selected)?;
            assert_eq!(modes, [expected]);
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
        ] {
            assert!(selection(&args(&invalid)).is_err(), "{invalid:?}");
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
