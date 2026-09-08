#![cfg(all(unix, feature = "text-index"))]
use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, Quad};
use oxigraph::sparql::{
    CancellationToken, QueryEvaluationError, QueryResults, QuerySolution, SparqlEvaluator,
    TextServiceError, TextSparqlResults,
};
use oxigraph::store::{
    DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider,
    DerivedSnapshot, Store, TextIndexProvider, TransactionStartControl,
};
use std::num::NonZeroUsize;
use std::time::Duration;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const PREFIX: &str = "PREFIX text: <urn:oxigraph:text:> ";
fn quad(id: &str, text: impl Into<Literal>, graph: GraphName) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:{id}")),
        NamedNode::new_unchecked("urn:label"),
        text.into(),
        graph,
    )
}
struct Fixture {
    store: Store,
    index: DerivedIndex,
    provider: TextIndexProvider,
    limits: DerivedGenerationLimits,
    _directory: tempfile::TempDir,
}
impl Fixture {
    fn new(quads: impl IntoIterator<Item = Quad>) -> Result<Self> {
        let directory = tempfile::tempdir()?;
        let store = Store::open(directory.path().join("db"))?;
        for quad in quads {
            store.insert(quad)?;
        }
        let provider = TextIndexProvider::default();
        let limits = DerivedGenerationLimits::default();
        let mut index = DerivedIndex::create(directory.path().join("text"), provider.identity())?;
        let source = store.derived_snapshot(&TransactionStartControl::new())?;
        let generation = index.rebuild(&source, &provider, &limits)?;
        index.activate(&generation, &source, &provider, &limits)?;
        Ok(Self {
            store,
            index,
            provider,
            limits,
            _directory: directory,
        })
    }
    fn source(&self) -> Result<DerivedSnapshot> {
        Ok(self
            .store
            .derived_snapshot(&TransactionStartControl::new())?)
    }
    fn query(&self, query: &str, eventual: bool) -> Result<TextSparqlResults> {
        let prepared = SparqlEvaluator::new().parse_query(&format!("{PREFIX}{query}"))?;
        let bound = if eventual {
            prepared.on_eventual_text_index(
                self.source()?,
                &self.index,
                self.provider.clone(),
                self.limits.clone(),
            )
        } else {
            prepared.on_text_index(
                self.source()?,
                &self.index,
                self.provider.clone(),
                self.limits.clone(),
            )
        };
        Ok(bound.execute()?)
    }
}
fn rows(
    result: TextSparqlResults,
) -> std::result::Result<Vec<QuerySolution>, QueryEvaluationError> {
    let QueryResults::Solutions(rows) = result.results else {
        panic!("expected SELECT")
    };
    rows.collect()
}
fn service_error(error: &QueryEvaluationError) -> &TextServiceError {
    let QueryEvaluationError::Service(error) = error else {
        panic!("expected typed SERVICE error: {error}")
    };
    error.downcast_ref().expect("TextServiceError")
}

#[test]
fn literal_relation_joins_without_duplicate_subject_multiplication() -> Result {
    let f = Fixture::new([
        quad("a", "red blue", GraphName::DefaultGraph),
        quad("b", "red blue", GraphName::DefaultGraph),
        quad("c", "red", NamedNode::new("urn:g")?.into()),
    ])?;
    let result = f.query(
        r#"SELECT ?s ?v ?score WHERE {
      SERVICE text:search:v1 { ?v text:query "red blue"; text:score ?score }
      ?s <urn:label> ?v
    } ORDER BY ?s"#,
        false,
    )?;
    assert!(!result.context.eventual);
    assert_eq!(
        result.context.applied.as_ref(),
        Some(&result.context.source)
    );
    let rows = rows(result)?;
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].get("s"), Some(&NamedNode::new("urn:a")?.into()));
    assert_eq!(rows[1].get("score"), Some(&Literal::from(2).into()));
    assert_eq!(rows[1].get("v"), Some(&Literal::from("red blue").into()));
    Ok(())
}

#[test]
fn no_implicit_top_100_before_outer_values_join() -> Result {
    let f = Fixture::new((0..125).map(|i| {
        quad(
            &format!("s{i:03}"),
            format!("red value {i:03}"),
            GraphName::DefaultGraph,
        )
    }))?;
    let query = r#"SELECT ?s WHERE {
      VALUES ?s { <urn:s124> }
      SERVICE text:search:v1 { ?v text:query "red" }
      ?s <urn:label> ?v
    }"#;
    assert_eq!(rows(f.query(query, false)?)?.len(), 1);
    assert_eq!(
        rows(f.query(
            r#"SELECT ?v WHERE { SERVICE text:search:v1 { ?v text:query "red" } }"#,
            false
        )?)?
        .len(),
        125
    );
    assert_eq!(
        rows(f.query(
            r#"SELECT ?v WHERE { SERVICE text:search:v1 { ?v text:query "red"; text:limit 2 } }"#,
            false
        )?)?
        .len(),
        2
    );
    // Repeated outer rows reuse one bounded relation, not another cache charge.
    let mut provider = f.provider.clone();
    provider.limits.max_candidates = NonZeroUsize::new(125).unwrap();
    let bound = SparqlEvaluator::new()
        .parse_query(&format!(
            r#"{PREFIX}SELECT ?v ?n WHERE {{
      VALUES ?n {{ 1 2 3 }} SERVICE text:search:v1 {{ ?v text:query "red" }}
    }}"#
        ))?
        .on_text_index(f.source()?, &f.index, provider, f.limits.clone());
    assert_eq!(rows(bound.execute()?)?.len(), 375);
    Ok(())
}

#[test]
fn from_merge_preserves_blank_subject_identity() -> Result {
    let g1: GraphName = NamedNode::new("urn:g1")?.into();
    let g2: GraphName = NamedNode::new("urn:g2")?.into();
    let blank = BlankNode::new("shared")?;
    let f = Fixture::new([g1, g2].map(|g| {
        Quad::new(
            blank.clone(),
            NamedNode::new_unchecked("urn:label"),
            Literal::from("red"),
            g,
        )
    }))?;
    let result = rows(f.query(
        r#"SELECT ?s FROM <urn:g1> FROM <urn:g2> WHERE {
      SERVICE text:search:v1 { ?v text:query "red" }
      ?s <urn:label> ?v
    }"#,
        false,
    )?)?;
    assert_eq!(result.len(), 2);
    assert_ne!(result[0].get("s"), result[1].get("s"));
    assert_eq!(
        rows(f.query(
            r#"SELECT ?s FROM NAMED <urn:g1> WHERE {
      SERVICE text:search:v1 { ?v text:query "red" }
      GRAPH <urn:g1> { ?s <urn:label> ?v }
    }"#,
            false
        )?)?
        .len(),
        1
    );
    assert_eq!(
        rows(f.query(
            r#"SELECT ?s FROM <urn:absent> WHERE {
      SERVICE text:search:v1 { ?v text:query "red" } ?s <urn:label> ?v
    }"#,
            false
        )?)?
        .len(),
        0
    );
    Ok(())
}

#[test]
fn same_retained_snapshot_for_text_and_rdf_after_write() -> Result {
    let old = quad("old", "red", GraphName::DefaultGraph);
    let f = Fixture::new([old.clone()])?;
    let bound = SparqlEvaluator::new()
        .parse_query(&format!(
            r#"{PREFIX}SELECT ?s WHERE {{
      SERVICE text:search:v1 {{ ?v text:query "red" }} ?s <urn:label> ?v
    }}"#
        ))?
        .on_text_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone());
    f.store.remove(&old)?;
    f.store
        .insert(quad("new", "red", GraphName::DefaultGraph))?;
    let result = rows(bound.execute()?)?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].get("s"), Some(&NamedNode::new("urn:old")?.into()));
    Ok(())
}

#[test]
fn strict_lag_is_typed_silent_is_standard_and_eventual_empty_reports_lag() -> Result {
    let old = quad("old", "red", GraphName::DefaultGraph);
    let f = Fixture::new([old.clone()])?;
    f.store.remove(&old)?;
    f.store
        .insert(quad("new", "red", GraphName::DefaultGraph))?;
    let error = rows(f.query(
        r#"SELECT ?v WHERE { SERVICE text:search:v1 { ?v text:query "red" } }"#,
        false,
    )?)
    .unwrap_err();
    assert!(
        matches!(service_error(&error), TextServiceError::Admission(error) if matches!(error.as_ref(), DerivedGenerationError::NotFresh))
    );
    let silent = rows(f.query(
        r#"SELECT ?x ?v WHERE {
      VALUES ?x { 1 } SERVICE SILENT text:search:v1 { ?v text:query "red" }
    }"#,
        false,
    )?)?;
    assert_eq!(silent.len(), 1);
    assert_eq!(silent[0].get("x"), Some(&Literal::from(1).into()));
    assert_eq!(silent[0].get("v"), None);
    let eventual = f.query(
        r#"SELECT ?v WHERE {
      SERVICE text:search:v1 { ?v text:query "red"; text:consistency text:eventual }
    }"#,
        true,
    )?;
    assert!(eventual.context.eventual);
    assert!(eventual.context.applied.is_some());
    assert_ne!(
        eventual.context.applied.as_ref(),
        Some(&eventual.context.source)
    );
    assert!(rows(eventual)?.is_empty());
    let error = rows(f.query(
        r#"SELECT ?v WHERE { SERVICE text:search:v1 { ?v text:query "red" } }"#,
        true,
    )?)
    .unwrap_err();
    assert!(matches!(
        service_error(&error),
        TextServiceError::Consistency
    ));
    Ok(())
}

#[test]
fn scope_and_required_columns_and_output_unification() -> Result {
    let f = Fixture::new([
        quad("a", "red", GraphName::DefaultGraph),
        quad(
            "b",
            Literal::new_language_tagged_literal("red", "en")?,
            NamedNode::new("urn:g")?.into(),
        ),
    ])?;
    assert_eq!(rows(f.query(r#"SELECT * WHERE { SERVICE text:search:v1 {
      ?v text:query "red"; text:graph ?g; text:predicate ?p; text:language "EN"; text:inGraph <urn:g>
    } }"#, false)?)?.len(), 1);
    // An absent graph column must not leak an unbound row or a reused binding.
    for column in ["?g", "?v"] {
        assert!(
            rows(f.query(
                &format!(
                    r#"SELECT * WHERE {{ SERVICE text:search:v1 {{
          ?v text:query "red"; text:defaultGraph true; text:graph {column}
        }} }}"#
                ),
                false
            )?)?
            .is_empty()
        );
    }
    let result = rows(f.query(
        r#"SELECT * WHERE { SERVICE text:search:v1 {
      ?v text:query "red"; text:defaultGraph true; text:isDefaultGraph ?d; text:literal ?v
    } }"#,
        false,
    )?)?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].get("d"), Some(&Literal::from(true).into()));
    assert!(
        rows(f.query(
            r#"SELECT * WHERE { SERVICE text:search:v1 {
      ?v text:query "red"; text:inPredicate <urn:other>
    } }"#,
            false
        )?)?
        .is_empty()
    );
    Ok(())
}

#[test]
fn cancellation_is_fatal_even_silent_for_both_controls() -> Result {
    let f = Fixture::new([quad("a", "red", GraphName::DefaultGraph)])?;
    for outer in [false, true] {
        let token = CancellationToken::new();
        let control = TransactionStartControl::new();
        let mut limits = f.limits.clone();
        limits.input.control = control.clone();
        let bound = SparqlEvaluator::new().with_cancellation_token(token.clone())
            .parse_query(&format!(r#"{PREFIX}SELECT ?v WHERE {{ SERVICE SILENT text:search:v1 {{ ?v text:query "red" }} }}"#))?
            .on_text_index(f.source()?, &f.index, f.provider.clone(), limits);
        if outer {
            token.cancel();
        } else {
            control.cancel();
        }
        let error = match bound.execute() {
            Ok(result) => rows(result).unwrap_err(),
            Err(error) => error,
        };
        assert!(matches!(error, QueryEvaluationError::Cancelled));
    }
    Ok(())
}

#[test]
fn caller_cancellation_remains_fatal_during_result_consumption() -> Result {
    let f = Fixture::new([
        quad("a", "red first", GraphName::DefaultGraph),
        quad("b", "red second", GraphName::DefaultGraph),
    ])?;
    let control = TransactionStartControl::new();
    let mut limits = f.limits.clone();
    limits.input.control = control.clone();
    let result = SparqlEvaluator::new().parse_query(&format!(
        r#"{PREFIX}SELECT ?v WHERE {{ SERVICE SILENT text:search:v1 {{ ?v text:query "red" }} }}"#
    ))?.on_text_index(f.source()?, &f.index, f.provider.clone(), limits).execute()?;
    let QueryResults::Solutions(mut solutions) = result.results else {
        panic!("SELECT")
    };
    assert!(solutions.next().unwrap().is_ok());
    control.cancel();
    assert!(matches!(
        solutions.next(),
        Some(Err(QueryEvaluationError::Cancelled))
    ));
    Ok(())
}

#[test]
fn rollback_and_reopen_preserve_sparql_text_journey() -> Result {
    use oxigraph::store::{TransactionKey, TransactionRequest, WritableDataset};
    let mut f = Fixture::new([])?;
    let mut initial = f
        .store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    initial.insert(quad("kept", "red", GraphName::DefaultGraph))?;
    initial.commit()?;
    let mut transaction = f
        .store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([3; 16]))?
        .into_transaction();
    transaction.insert(quad("aborted", "red", GraphName::DefaultGraph))?;
    transaction.rollback()?;
    let source = f.source()?;
    let generation = f.index.rebuild(&source, &f.provider, &f.limits)?;
    f.index
        .activate(&generation, &source, &f.provider, &f.limits)?;
    drop(source);
    let Fixture {
        store,
        index,
        provider,
        limits,
        _directory: directory,
    } = f;
    drop(index);
    drop(store);
    let store = Store::open(directory.path().join("db"))?;
    let index = DerivedIndex::open(directory.path().join("text"), provider.identity())?;
    let f = Fixture {
        store,
        index,
        provider,
        limits,
        _directory: directory,
    };
    let result = rows(f.query(
        r#"SELECT ?s WHERE {
      SERVICE text:search:v1 { ?v text:query "red" } ?s <urn:label> ?v
    }"#,
        false,
    )?)?;
    assert_eq!(result.len(), 1);
    assert_eq!(
        result[0].get("s"),
        Some(&NamedNode::new("urn:kept")?.into())
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn programmatic_incompatible_service_input_is_not_a_silent_pattern_error() -> Result {
    use oxigraph::sparql::SparqlVersion;
    let f = Fixture::new([quad("a", "red", GraphName::DefaultGraph)])?;
    for body in [
        r#"?v text:query "red"@en--ltr"#,
        r#"?v text:query <<( <urn:s> <urn:p> <urn:o> )>>"#,
    ] {
        let query = spargebra::SparqlParser::new()
            .with_version(SparqlVersion::V1_2)
            .parse_query(&format!(
                "{PREFIX}SELECT * WHERE {{ SERVICE SILENT text:search:v1 {{ {body} }} }}"
            ))?;
        let bound = SparqlEvaluator::new()
            .with_version(SparqlVersion::V1_1)
            .for_query(query)
            .on_text_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone());
        let error = match bound.execute() {
            Ok(result) => rows(result).unwrap_err(),
            Err(error) => error,
        };
        assert!(matches!(
            error,
            QueryEvaluationError::IncompatibleTerm { .. }
        ));
    }
    Ok(())
}

#[test]
fn resource_failures_and_pattern_errors_are_not_partial_results() -> Result {
    let mut f = Fixture::new([
        quad("a", "red first", GraphName::DefaultGraph),
        quad("b", "red second", GraphName::DefaultGraph),
    ])?;
    f.provider.limits.max_candidates = NonZeroUsize::MIN;
    let error = rows(f.query(
        r#"SELECT * WHERE { SERVICE text:search:v1 { ?v text:query "red" } }"#,
        false,
    )?)
    .unwrap_err();
    assert!(matches!(service_error(&error), TextServiceError::Text(_)));
    f.provider = TextIndexProvider::default();
    for body in [
        r#"?v text:query ?input"#,
        r#"?v text:query "red"; text:unknown 1"#,
        r#"?v text:query "red"; text:query "blue""#,
        r#"?v text:query "red"; text:limit 0"#,
        r#"?v text:query "red"; text:inGraph <urn:g>; text:defaultGraph true"#,
    ] {
        let error = rows(f.query(
            &format!("SELECT * WHERE {{ SERVICE text:search:v1 {{ {body} }} }}"),
            false,
        )?)
        .unwrap_err();
        assert!(matches!(
            service_error(&error),
            TextServiceError::Pattern(_)
        ));
    }
    f.limits.input.control = TransactionStartControl::new().with_timeout(Duration::ZERO);
    let result = SparqlEvaluator::new().parse_query(&format!(
        r#"{PREFIX}SELECT * WHERE {{ SERVICE SILENT text:search:v1 {{ ?v text:query "red" }} }}"#
    ))?.on_text_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone()).execute();
    let error = match result {
        Ok(result) => rows(result).unwrap_err(),
        Err(error) => error,
    };
    assert!(matches!(service_error(&error), TextServiceError::TimedOut));
    Ok(())
}

#[test]
fn opt_in_preserves_other_registered_services() -> Result {
    use oxigraph::model::Variable;
    use oxigraph::sparql::{QuerySolutionIter, ServiceHandler};
    use std::sync::Arc;
    struct Other;
    impl ServiceHandler for Other {
        type Error = std::convert::Infallible;
        fn handle(
            &self,
            _: &spargebra::algebra::QueryExpression,
            _: Option<&oxiri::Iri<oxstr::OxString>>,
        ) -> std::result::Result<QuerySolutionIter<'static>, Self::Error> {
            let variables: Arc<[Variable]> = vec![Variable::new_unchecked("n")].into();
            Ok(QuerySolutionIter::from_tuples(
                variables,
                [Ok(vec![Some(Literal::from(7).into())])],
            ))
        }
    }
    let f = Fixture::new([quad("a", "red", GraphName::DefaultGraph)])?;
    let result = SparqlEvaluator::new()
        .with_service_handler(NamedNode::new("urn:other")?, Other)
        .parse_query(&format!(
            r#"{PREFIX}SELECT ?v ?n WHERE {{
          SERVICE <urn:other> {{ ?n ?p ?o }}
          SERVICE text:search:v1 {{ ?v text:query "red" }}
        }}"#
        ))?
        .on_text_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone())
        .execute()?;
    let result = rows(result)?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].get("n"), Some(&Literal::from(7).into()));
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn directional_literals_respect_version_even_silent() -> Result {
    use oxigraph::model::BaseDirection;
    use oxigraph::sparql::SparqlVersion;
    let f = Fixture::new([quad(
        "a",
        Literal::new_directional_language_tagged_literal("red", "en", BaseDirection::Ltr)?,
        GraphName::DefaultGraph,
    )])?;
    for version in [
        SparqlVersion::V1_1,
        SparqlVersion::V1_2Basic,
        SparqlVersion::V1_2,
    ] {
        let bound = SparqlEvaluator::new().with_version(version).parse_query(&format!(
            r#"{PREFIX}SELECT ?v WHERE {{ SERVICE SILENT text:search:v1 {{ ?v text:query "red" }} }}"#
        ))?.on_text_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone());
        let result = rows(bound.execute()?);
        if version == SparqlVersion::V1_1 {
            assert!(matches!(
                result,
                Err(QueryEvaluationError::IncompatibleTerm { .. })
            ));
        } else {
            assert_eq!(result?.len(), 1);
        }
    }
    Ok(())
}
