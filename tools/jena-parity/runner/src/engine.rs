use crate::canonical;
use crate::model::{Observation, Scenario};
use oxigraph::io::{RdfFormat, RdfParser, RdfSerializer};
use oxigraph::model::{Dataset, GraphName, Literal, NamedNode, OxString, Quad, Term, Variable};
use oxigraph::owl2_rl::Owl2RlRdfOptions;
use oxigraph::rdfs::Rdfs12Options;
use oxigraph::reasoning::{evaluate_store_owl2_rl, evaluate_store_rdfs12};
use oxigraph::shacl::{
    GraphSnapshot, ProfileId, ProfileSet, PropertyPath, ShapesGraph, ValidationOptions,
    ValidationResult, validate,
};
use oxigraph::sparql::{
    QueryEvaluationError, QueryResults, QuerySolutionIter, ServiceHandler, SparqlEvaluator,
    SparqlVersion,
};
use oxigraph::store::Store;
use oxiri::Iri;
use serde_json::{Map, Value, json};
use spargebra::algebra::GraphPattern;
use std::collections::BTreeMap;
use std::convert::Infallible;
use std::sync::Arc;

const BASE: &str = "https://example.test/base/";
const OFFLINE_SERVICE: &str = "urn:oxigraph:jena-parity:service";
const OFFLINE_VALUE: &str = "offline-service";

pub fn observe(scenario: &Scenario) -> Observation {
    match execute(scenario) {
        Ok((kind, value)) => Observation::success(&scenario.id, kind, value),
        Err(EngineError::Unsupported(reason)) => Observation::unsupported(&scenario.id, &reason),
        Err(EngineError::Failure(kind)) => Observation::error(&scenario.id, &kind),
    }
}

fn execute(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    match scenario.operation.as_str() {
        "rdf-parse" => Ok(("dataset", parse_value(scenario)?)),
        "rdf-roundtrip" => Ok(("dataset", round_trip(scenario)?)),
        "sparql-select" | "sparql-service" => select(scenario),
        "sparql-ask" => ask(scenario),
        "sparql-construct" => construct(scenario),
        "sparql-describe" => describe(scenario),
        "sparql-update" => update(scenario),
        "shacl-validate" | "shacl-sparql-validate" => shacl(scenario),
        "entailment" => entailment(scenario),
        "sparql-unsupported" | "shacl-unsupported" => Err(EngineError::Unsupported(
            "outside-enumerated-profile".to_owned(),
        )),
        operation => Err(EngineError::Failure(format!(
            "unknown-operation:{operation}"
        ))),
    }
}

fn parse_value(scenario: &Scenario) -> Result<Value, EngineError> {
    canonical::dataset(&parse_dataset(
        scenario.data.as_deref().unwrap_or_default(),
        scenario.syntax.as_deref(),
    )?)
    .map_err(EngineError::Unsupported)
}

fn round_trip(scenario: &Scenario) -> Result<Value, EngineError> {
    let dataset = parse_dataset(
        scenario.data.as_deref().unwrap_or_default(),
        scenario.syntax.as_deref(),
    )?;
    let output_syntax = required(scenario.output_syntax.as_ref(), "outputSyntax")?;
    let mut serializer =
        RdfSerializer::from_format(rdf_format(Some(output_syntax))?).for_writer(Vec::new());
    serializer
        .serialize_dataset(&dataset)
        .map_err(|error| failure("rdf-serialize", &error))?;
    let bytes = serializer
        .finish()
        .map_err(|error| failure("rdf-serialize", &error))?;
    let reparsed = parse_dataset_bytes(&bytes, Some(output_syntax))?;
    canonical::dataset(&reparsed).map_err(EngineError::Unsupported)
}

fn select(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    let store = load_store(scenario)?;
    let query = required(scenario.query.as_ref(), "query")?;
    let results = scenario_evaluator(scenario)?
        .parse_query(query)
        .map_err(|error| failure("sparql-syntax", &error))?
        .on_store(&store)
        .execute()
        .map_err(|error| failure("sparql-evaluation", &error))?;
    let QueryResults::Solutions(mut solutions) = results else {
        return Err(EngineError::Failure("unexpected-query-form".to_owned()));
    };
    let variables = solutions
        .variables()
        .iter()
        .map(|variable| variable.as_str().to_owned())
        .collect::<Vec<_>>();
    let mut rows = Vec::new();
    for solution in &mut solutions {
        let solution = solution.map_err(|error| failure("sparql-solution", &error))?;
        rows.push(
            solution
                .iter()
                .map(|(variable, term)| (variable.as_str().to_owned(), term.clone()))
                .collect::<BTreeMap<_, _>>(),
        );
    }
    let value = canonical::solutions(&variables, &rows, scenario.ordered)
        .map_err(EngineError::Unsupported)?;
    Ok(("solutions", value))
}

fn ask(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    let store = load_store(scenario)?;
    let query = required(scenario.query.as_ref(), "query")?;
    let results = evaluator()?
        .parse_query(query)
        .map_err(|error| failure("sparql-syntax", &error))?
        .on_store(&store)
        .execute()
        .map_err(|error| failure("sparql-evaluation", &error))?;
    match results {
        QueryResults::Boolean(value) => Ok(("boolean", Value::Bool(value))),
        _ => Err(EngineError::Failure("unexpected-query-form".to_owned())),
    }
}

fn construct(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    graph_query(scenario)
}

fn describe(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    graph_query(scenario)
}

fn graph_query(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    let store = load_store(scenario)?;
    let query = required(scenario.query.as_ref(), "query")?;
    let results = evaluator()?
        .parse_query(query)
        .map_err(|error| failure("sparql-syntax", &error))?
        .on_store(&store)
        .execute()
        .map_err(|error| failure("sparql-evaluation", &error))?;
    let QueryResults::Graph(graph) = results else {
        return Err(EngineError::Failure("unexpected-query-form".to_owned()));
    };
    let mut dataset = Dataset::new();
    for triple in graph {
        let triple = triple.map_err(|error| failure("sparql-graph", &error))?;
        dataset.insert(Quad::new(
            triple.subject,
            triple.predicate,
            triple.object,
            GraphName::DefaultGraph,
        ));
    }
    let value = canonical::dataset(&dataset).map_err(EngineError::Unsupported)?;
    Ok(("dataset", value))
}

fn update(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    let store = load_store(scenario)?;
    let update = required(scenario.update.as_ref(), "update")?;
    evaluator()?
        .parse_update(update)
        .map_err(|error| failure("sparql-update-syntax", &error))?
        .on_store(&store)
        .execute()
        .map_err(|error| failure("sparql-update-evaluation", &error))?;
    let dataset = store_dataset(&store)?;
    let value = canonical::dataset(&dataset).map_err(EngineError::Unsupported)?;
    Ok(("dataset", value))
}

fn shacl(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    let data = parse_dataset(
        scenario.data.as_deref().unwrap_or_default(),
        scenario.syntax.as_deref(),
    )?;
    let shapes_data = parse_dataset(
        required(scenario.shapes.as_ref(), "shapes")?,
        Some("turtle"),
    )?;
    let data = GraphSnapshot::default_graph(data);
    let shapes_data = GraphSnapshot::default_graph(shapes_data);
    let options = ValidationOptions::default();
    let profiles = if scenario.operation == "shacl-sparql-validate" {
        ProfileSet::new([
            ProfileId::Core12Subset20260723,
            ProfileId::SparqlExtensions12Subset20260130,
        ])
        .map_err(|error| failure("shacl-profile", &error))?
    } else {
        ProfileSet::default()
    };
    let shapes = ShapesGraph::compile(&shapes_data, profiles, &options)
        .map_err(|error| failure("shacl-compile", &error))?;
    let report =
        validate(&shapes, &data, &options).map_err(|error| failure("shacl-validate", &error))?;
    let mut results = report
        .results()
        .iter()
        .map(shacl_result)
        .collect::<Vec<_>>();
    results.sort_by_key(Value::to_string);
    Ok((
        "shacl-report",
        json!({
            "conforms": report.conforms(),
            "result_count": results.len(),
            "results": results
        }),
    ))
}

fn shacl_result(result: &ValidationResult) -> Value {
    let mut value = Map::new();
    value.insert("focus_node".to_owned(), canonical::term(&result.focus_node));
    if let Some(term) = &result.value {
        value.insert("value".to_owned(), canonical::term(term));
    }
    if let Some(path) = &result.result_path {
        value.insert("result_path".to_owned(), path_value(path));
    }
    value.insert(
        "source_shape".to_owned(),
        canonical::term(&Term::from(result.source_shape.clone())),
    );
    value.insert(
        "source_constraint_component".to_owned(),
        canonical::term(&Term::from(result.source_constraint_component.clone())),
    );
    value.insert(
        "severity".to_owned(),
        canonical::term(&Term::from(result.severity.clone())),
    );
    Value::Object(value)
}

fn entailment(scenario: &Scenario) -> Result<(&'static str, Value), EngineError> {
    let store = load_store(scenario)?;
    let query = required(scenario.query.as_ref(), "query")?;
    let value = match required(scenario.reasoner.as_ref(), "reasoner")? {
        "rdfs" => {
            let closure = evaluate_store_rdfs12(&store, &Rdfs12Options::default())
                .map_err(|error| failure("rdfs-evaluation", &error))?;
            let result = evaluator()?
                .parse_query(query)
                .map_err(|error| failure("sparql-syntax", &error))?
                .on_queryable_dataset(closure.entailed())
                .execute()
                .map_err(|error| failure("sparql-evaluation", &error))?;
            query_boolean(&result)?
        }
        "owl2-rl-selected" => {
            let closure = evaluate_store_owl2_rl(&store, &Owl2RlRdfOptions::default())
                .map_err(|error| failure("owl2-rl-evaluation", &error))?;
            let result = evaluator()?
                .parse_query(query)
                .map_err(|error| failure("sparql-syntax", &error))?
                .on_queryable_dataset(closure.entailed())
                .execute()
                .map_err(|error| failure("sparql-evaluation", &error))?;
            query_boolean(&result)?
        }
        reasoner => {
            return Err(EngineError::Unsupported(format!(
                "unsupported reasoner {reasoner}"
            )));
        }
    };
    Ok(("boolean", Value::Bool(value)))
}

fn query_boolean(results: &QueryResults<'_>) -> Result<bool, EngineError> {
    match results {
        QueryResults::Boolean(value) => Ok(*value),
        _ => Err(EngineError::Failure("unexpected-query-form".to_owned())),
    }
}

fn parse_dataset(data: &str, syntax: Option<&str>) -> Result<Dataset, EngineError> {
    parse_dataset_bytes(data.as_bytes(), syntax)
}

fn parse_dataset_bytes(data: &[u8], syntax: Option<&str>) -> Result<Dataset, EngineError> {
    let parser = RdfParser::from_format(rdf_format(syntax)?)
        .with_base_iri(BASE)
        .map_err(|error| failure("rdf-base-iri", &error))?;
    parser
        .for_slice(data)
        .collect_dataset()
        .map_err(|error| failure("rdf-parse", &error))
}

fn load_store(scenario: &Scenario) -> Result<Store, EngineError> {
    let store = Store::new().map_err(|error| failure("store", &error))?;
    let parser = RdfParser::from_format(rdf_format(scenario.syntax.as_deref())?)
        .with_base_iri(BASE)
        .map_err(|error| failure("rdf-base-iri", &error))?;
    store
        .load_from_slice(parser, scenario.data.as_deref().unwrap_or_default())
        .map_err(|error| failure("rdf-load", &error))?;
    Ok(store)
}

fn store_dataset(store: &Store) -> Result<Dataset, EngineError> {
    let mut dataset: Dataset = store
        .into_iter()
        .collect::<Result<_, _>>()
        .map_err(|error| failure("store-read", &error))?;
    for graph_name in store.named_graphs() {
        dataset.insert_named_graph(graph_name.map_err(|error| failure("store-read", &error))?);
    }
    Ok(dataset)
}

fn evaluator() -> Result<SparqlEvaluator, EngineError> {
    SparqlEvaluator::new()
        .with_version(SparqlVersion::V1_2)
        .with_base_iri(BASE)
        .map_err(|error| failure("sparql-base-iri", &error))
}

fn scenario_evaluator(scenario: &Scenario) -> Result<SparqlEvaluator, EngineError> {
    let evaluator = evaluator()?;
    Ok(if scenario.operation == "sparql-service" {
        evaluator.with_service_handler(
            NamedNode::new_unchecked(OFFLINE_SERVICE),
            OfflineServiceHandler,
        )
    } else {
        evaluator
    })
}

struct OfflineServiceHandler;

impl ServiceHandler for OfflineServiceHandler {
    type Error = Infallible;

    fn handle(
        &self,
        _pattern: &GraphPattern,
        _base_iri: Option<&Iri<OxString>>,
    ) -> Result<QuerySolutionIter<'static>, Self::Error> {
        let variables: Arc<[Variable]> = [Variable::new_unchecked("remote")].into();
        Ok(QuerySolutionIter::from_tuples(
            variables,
            [Ok::<_, QueryEvaluationError>(vec![Some(
                Literal::from(OFFLINE_VALUE).into(),
            )])],
        ))
    }
}

fn rdf_format(syntax: Option<&str>) -> Result<RdfFormat, EngineError> {
    match syntax.unwrap_or("turtle") {
        "turtle" | "arq" => Ok(RdfFormat::Turtle),
        "trig" => Ok(RdfFormat::TriG),
        "ntriples" => Ok(RdfFormat::NTriples),
        "nquads" => Ok(RdfFormat::NQuads),
        "rdfxml" => Ok(RdfFormat::RdfXml),
        "jsonld" => RdfFormat::from_extension("jsonld")
            .ok_or_else(|| EngineError::Failure("jsonld-format-unavailable".to_owned())),
        syntax => Err(EngineError::Failure(format!("unknown-rdf-syntax:{syntax}"))),
    }
}

fn required<'a>(value: Option<&'a String>, name: &str) -> Result<&'a str, EngineError> {
    value
        .map(String::as_str)
        .ok_or_else(|| EngineError::Failure(format!("missing-field:{name}")))
}

fn path_value(path: &PropertyPath) -> Value {
    match path {
        PropertyPath::Predicate(predicate) => canonical::term(&Term::from(predicate.clone())),
        _ => json!({"type": "path", "value": format!("{path:?}")}),
    }
}

fn failure(kind: &str, error: &impl std::fmt::Display) -> EngineError {
    let _ = error;
    EngineError::Failure(kind.to_owned())
}

enum EngineError {
    Failure(String),
    Unsupported(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trig_round_trip_preserves_an_explicit_empty_named_graph() -> Result<(), String> {
        let scenario = Scenario {
            id: "empty-graph".to_owned(),
            domain: "rdf".to_owned(),
            operation: "rdf-roundtrip".to_owned(),
            classification: crate::model::Classification::W3cOverridesJena,
            normative_basis: "https://www.w3.org/TR/rdf12-concepts/#section-dataset".to_owned(),
            reviewed: true,
            syntax: Some("trig".to_owned()),
            output_syntax: Some("trig".to_owned()),
            data: Some("<urn:g> {}".to_owned()),
            query: None,
            update: None,
            shapes: None,
            reasoner: None,
            ordered: false,
            assertions: Vec::new(),
        };

        let observation = observe(&scenario);
        assert_eq!(observation.status, "success");
        let value = observation
            .value
            .ok_or_else(|| "round-trip observation has no value".to_owned())?;
        assert_eq!(
            value.pointer("/named_graph_count"),
            Some(&serde_json::json!(1))
        );
        assert_eq!(
            value.pointer("/named_graphs/0/value"),
            Some(&serde_json::json!("urn:g"))
        );
        Ok(())
    }

    #[test]
    fn json_ld_round_trip_preserves_an_explicit_empty_named_graph() -> Result<(), String> {
        let scenario = Scenario {
            id: "empty-jsonld-graph".to_owned(),
            domain: "rdf".to_owned(),
            operation: "rdf-roundtrip".to_owned(),
            classification: crate::model::Classification::W3cOverridesJena,
            normative_basis:
                "https://www.w3.org/TR/json-ld11-api/#deserialize-json-ld-to-rdf-algorithm"
                    .to_owned(),
            reviewed: true,
            syntax: Some("jsonld".to_owned()),
            output_syntax: Some("jsonld".to_owned()),
            data: Some("{\"@id\":\"http://example.com/empty\",\"@graph\":[]}".to_owned()),
            query: None,
            update: None,
            shapes: None,
            reasoner: None,
            ordered: false,
            assertions: Vec::new(),
        };

        let observation = observe(&scenario);
        assert_eq!(observation.status, "success");
        let value = observation
            .value
            .ok_or_else(|| "round-trip observation has no value".to_owned())?;
        assert_eq!(value.pointer("/quad_count"), Some(&serde_json::json!(0)));
        assert_eq!(
            value.pointer("/named_graph_count"),
            Some(&serde_json::json!(1))
        );
        assert_eq!(
            value.pointer("/named_graphs/0/value"),
            Some(&serde_json::json!("http://example.com/empty"))
        );
        Ok(())
    }

    #[test]
    fn sparql_graph_enumerates_an_explicit_empty_named_graph() -> Result<(), String> {
        let scenario = Scenario {
            id: "query-empty-graph".to_owned(),
            domain: "sparql".to_owned(),
            operation: "sparql-select".to_owned(),
            classification: crate::model::Classification::W3cOverridesJena,
            normative_basis: "https://www.w3.org/TR/sparql12-query/#accessByIdentifier".to_owned(),
            reviewed: true,
            syntax: Some("trig".to_owned()),
            output_syntax: None,
            data: Some("<urn:g> {}".to_owned()),
            query: Some("SELECT ?g WHERE { GRAPH ?g {} }".to_owned()),
            update: None,
            shapes: None,
            reasoner: None,
            ordered: true,
            assertions: Vec::new(),
        };

        let observation = observe(&scenario);
        assert_eq!(observation.status, "success");
        let value = observation
            .value
            .ok_or_else(|| "query observation has no value".to_owned())?;
        assert_eq!(
            value,
            serde_json::json!({
                "variables": ["g"],
                "row_count": 1,
                "ordered": true,
                "rows": [{"g": {"type": "iri", "value": "urn:g"}}]
            })
        );
        Ok(())
    }

    #[test]
    fn store_observation_preserves_an_explicit_empty_named_graph() -> Result<(), String> {
        let store = Store::new().map_err(|error| error.to_string())?;
        store
            .insert_named_graph(NamedNode::new_unchecked("urn:g"))
            .map_err(|error| error.to_string())?;

        let dataset = store_dataset(&store)
            .map_err(|_| "store observation unexpectedly failed".to_owned())?;
        let value = canonical::dataset(&dataset)?;
        assert_eq!(
            value.pointer("/named_graph_count"),
            Some(&serde_json::json!(1))
        );
        assert_eq!(
            value.pointer("/named_graphs/0/value"),
            Some(&serde_json::json!("urn:g"))
        );
        Ok(())
    }
}
