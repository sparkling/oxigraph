#![cfg(all(unix, feature = "spatial-index"))]
use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, Quad};
use oxigraph::sparql::{
    CancellationToken, QueryEvaluationError, QueryResults, QuerySolution, SparqlEvaluator,
    SpatialServiceError, SpatialSparqlResults,
};
use oxigraph::store::{
    DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider,
    DerivedSnapshot, SpatialError, SpatialIndexProvider, Store, TransactionKey, TransactionRequest,
    TransactionStartControl, WritableDataset,
};
use std::num::NonZeroUsize;
use std::time::Duration;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const PREFIX: &str = "PREFIX spatial: <urn:oxigraph:spatial:> PREFIX geo: <http://www.opengis.net/ont/geosparql#> PREFIX geof: <http://www.opengis.net/def/function/geosparql/> ";
const BODY: &str = r#"?v spatial:geometry "POLYGON((0 0,4 0,4 4,0 4,0 0))"^^geo:wktLiteral; spatial:relation geof:sfWithin"#;
fn wkt(shape: &str) -> Literal {
    Literal::new_typed_literal(
        shape.to_owned(),
        NamedNode::new_unchecked("http://www.opengis.net/ont/geosparql#wktLiteral"),
    )
}
fn quad(id: &str, shape: &str, graph: GraphName) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:{id}")),
        NamedNode::new_unchecked("urn:geometry"),
        wkt(shape),
        graph,
    )
}
struct Fixture {
    store: Store,
    index: DerivedIndex,
    provider: SpatialIndexProvider,
    limits: DerivedGenerationLimits,
    directory: tempfile::TempDir,
}
impl Fixture {
    fn new(quads: impl IntoIterator<Item = Quad>) -> Result<Self> {
        let directory = tempfile::tempdir()?;
        let store = Store::open(directory.path().join("db"))?;
        let mut tx = store
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([1; 16]),
            )?
            .into_transaction();
        for quad in quads {
            tx.insert(quad)?;
        }
        tx.commit()?;
        let provider = SpatialIndexProvider::default();
        let limits = DerivedGenerationLimits::default();
        let mut index =
            DerivedIndex::create(directory.path().join("spatial"), provider.identity())?;
        let source = store.derived_snapshot(&TransactionStartControl::new())?;
        let generation = index.rebuild(&source, &provider, &limits)?;
        index.activate(&generation, &source, &provider, &limits)?;
        Ok(Self {
            store,
            index,
            provider,
            limits,
            directory,
        })
    }
    fn source(&self) -> Result<DerivedSnapshot> {
        Ok(self
            .store
            .derived_snapshot(&TransactionStartControl::new())?)
    }
    fn query(&self, query: &str) -> Result<SpatialSparqlResults> {
        Ok(SparqlEvaluator::new()
            .parse_query(&format!("{PREFIX}{query}"))?
            .on_spatial_index(
                self.source()?,
                &self.index,
                self.provider.clone(),
                self.limits.clone(),
            )
            .execute()?)
    }
}
fn rows(
    result: SpatialSparqlResults,
) -> std::result::Result<Vec<QuerySolution>, QueryEvaluationError> {
    let QueryResults::Solutions(rows) = result.results else {
        panic!("SELECT expected")
    };
    rows.collect()
}
fn service_error(error: &QueryEvaluationError) -> &SpatialServiceError {
    let QueryEvaluationError::Service(error) = error else {
        panic!("SERVICE error expected: {error}")
    };
    error.downcast_ref().expect("spatial SERVICE error")
}

#[test]
fn spatial_literal_join_dedup_scope_and_independent_context() -> Result {
    let f = Fixture::new([
        quad("a", "POINT(1 2)", GraphName::DefaultGraph),
        quad("b", "POINT(1 2)", GraphName::DefaultGraph),
        quad("far", "POINT(40 40)", GraphName::DefaultGraph),
        quad("named", "POINT(1 2)", NamedNode::new("urn:g")?.into()),
    ])?;
    let result = f.query(&format!("SELECT ?s ?v ?ok WHERE {{ SERVICE spatial:search:v1 {{ {BODY}; spatial:matched ?ok }} ?s <urn:geometry> ?v }} ORDER BY ?s"))?;
    assert_eq!(
        result.context.applied.as_ref(),
        Some(&result.context.source)
    );
    assert!(result.context.generation.is_some());
    let results = rows(result)?;
    assert_eq!(results.len(), 2); // duplicate matching literal never multiplies subjects
    assert_eq!(results[0].get("s"), Some(&NamedNode::new("urn:a")?.into()));
    assert_eq!(results[1].get("ok"), Some(&Literal::from(true).into()));
    let result = f.query(&format!("SELECT ?v WHERE {{ SERVICE spatial:search:v1 {{ {BODY}; spatial:inPredicate <urn:absent> }} }}"))?;
    assert!(result.context.applied.is_some());
    assert!(rows(result)?.is_empty());
    assert!(rows(f.query(&format!("SELECT * WHERE {{ SERVICE spatial:search:v1 {{ {BODY}; spatial:defaultGraph true; spatial:graph ?g }} }}"))?)?.is_empty());
    let result = rows(f.query(&format!("SELECT * WHERE {{ SERVICE spatial:search:v1 {{ {BODY}; spatial:inGraph <urn:g>; spatial:graph ?g; spatial:isDefaultGraph ?d }} }}"))?)?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].get("d"), Some(&Literal::from(false).into()));
    assert_eq!(result[0].get("g"), Some(&NamedNode::new("urn:g")?.into()));
    assert!(
        rows(f.query(&format!(
            "SELECT * WHERE {{ SERVICE spatial:search:v1 {{ {BODY}; spatial:matched ?v }} }}"
        ))?)?
        .is_empty()
    );
    Ok(())
}

#[test]
fn spatial_service_agrees_with_all_exact_relation_names() -> Result {
    let shapes = [
        "POINT(1 2)",
        "POINT(8 9)",
        "POLYGON((0 0,4 0,4 4,0 4,0 0))",
        "POLYGON EMPTY",
    ];
    let f = Fixture::new(
        shapes
            .iter()
            .enumerate()
            .map(|(i, s)| quad(&i.to_string(), s, GraphName::DefaultGraph)),
    )?;
    let target = wkt("POLYGON((0 0,4 0,4 4,0 4,0 0))");
    let mut checked = 0;
    for (iri, exact) in spargeo::GEOSPARQL_EXTENSION_FUNCTIONS {
        let local = iri.as_str().rsplit('/').next().unwrap();
        if !(local.starts_with("sf") || local.starts_with("eh") || local.starts_with("rcc8")) {
            continue;
        }
        let expected = shapes
            .iter()
            .filter(|shape| {
                exact(&[wkt(shape).into(), target.clone().into()])
                    == Some(Literal::from(true).into())
            })
            .count();
        let result = rows(f.query(&format!(r#"SELECT ?v WHERE {{ SERVICE spatial:search:v1 {{ ?v spatial:geometry "POLYGON((0 0,4 0,4 4,0 4,0 0))"^^geo:wktLiteral; spatial:relation {iri} }} }}"#))?)?;
        assert_eq!(result.len(), expected, "{local}");
        checked += 1;
    }
    assert_eq!(checked, 24);
    Ok(())
}

#[test]
fn spatial_has_no_implicit_top_100_and_cache_reuses_repeated_outer_rows() -> Result {
    let f = Fixture::new((0..125).map(|i| {
        quad(
            &format!("s{i:03}"),
            &format!("POINT({i} 1)"),
            GraphName::DefaultGraph,
        )
    }))?;
    let body = r#"?v spatial:geometry "POLYGON((-1 0,200 0,200 4,-1 4,-1 0))"^^geo:wktLiteral; spatial:relation geof:sfWithin"#;
    assert_eq!(rows(f.query(&format!("SELECT ?s WHERE {{ VALUES ?s {{ <urn:s124> }} SERVICE spatial:search:v1 {{ {body} }} ?s <urn:geometry> ?v }}"))?)?.len(), 1);
    assert_eq!(
        rows(f.query(&format!(
            "SELECT ?v WHERE {{ SERVICE spatial:search:v1 {{ {body}; spatial:limit 2 }} }}"
        ))?)?
        .len(),
        2
    );
    let mut provider = f.provider.clone();
    provider.limits.max_candidates = NonZeroUsize::new(125).unwrap();
    let result = SparqlEvaluator::new().parse_query(&format!("{PREFIX}SELECT ?v ?n WHERE {{ VALUES ?n {{ 1 2 3 }} SERVICE spatial:search:v1 {{ {body} }} }}"))?
        .on_spatial_index(f.source()?, &f.index, provider, f.limits.clone()).execute()?;
    assert_eq!(rows(result)?.len(), 375);
    Ok(())
}

#[test]
fn spatial_from_merge_and_literal_scope_are_explicit() -> Result {
    let blank = BlankNode::new("shared")?;
    let f = Fixture::new(["urn:g1", "urn:g2"].map(|g| {
        Quad::new(
            blank.clone(),
            NamedNode::new_unchecked("urn:geometry"),
            wkt("POINT(1 2)"),
            NamedNode::new_unchecked(g),
        )
    }))?;
    let result = rows(f.query(&format!("SELECT ?s FROM <urn:g1> FROM <urn:g2> WHERE {{ SERVICE spatial:search:v1 {{ {BODY}; spatial:inGraph <urn:g1> }} ?s <urn:geometry> ?v }}"))?)?;
    assert_eq!(result.len(), 2); // scope qualifies literal existence, not the outer occurrence
    assert_ne!(result[0].get("s"), result[1].get("s"));
    assert_eq!(rows(f.query(&format!("SELECT ?s FROM NAMED <urn:g1> WHERE {{ SERVICE spatial:search:v1 {{ {BODY} }} GRAPH <urn:g1> {{ ?s <urn:geometry> ?v }} }}"))?)?.len(), 1);
    assert!(rows(f.query(&format!("SELECT ?s FROM <urn:absent> WHERE {{ SERVICE spatial:search:v1 {{ {BODY} }} ?s <urn:geometry> ?v }}"))?)?.is_empty());
    Ok(())
}

#[test]
fn spatial_retained_snapshot_lag_silent_bypass_and_success_marker() -> Result {
    let f = Fixture::new([quad("old", "POINT(1 2)", GraphName::DefaultGraph)])?;
    let query = format!(
        "SELECT ?s WHERE {{ SERVICE spatial:search:v1 {{ {BODY} }} ?s <urn:geometry> ?v }}"
    );
    let bound = SparqlEvaluator::new()
        .parse_query(&format!("{PREFIX}{query}"))?
        .on_spatial_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone());
    f.store
        .remove(&quad("old", "POINT(1 2)", GraphName::DefaultGraph))?;
    f.store
        .insert(quad("new-outside", "POINT(40 40)", GraphName::DefaultGraph))?;
    let old = rows(bound.execute()?)?;
    assert_eq!(old[0].get("s"), Some(&NamedNode::new("urn:old")?.into()));
    let error = rows(f.query(&query)?).unwrap_err();
    assert!(
        matches!(service_error(&error), SpatialServiceError::Admission(e) if matches!(e.as_ref(), DerivedGenerationError::NotFresh))
    );
    let result = f.query(&query.replace("SERVICE spatial", "SERVICE SILENT spatial"))?;
    assert!(result.context.applied.is_none());
    let bypass = rows(result)?;
    assert_eq!(bypass.len(), 1);
    assert_eq!(
        bypass[0].get("s"),
        Some(&NamedNode::new("urn:new-outside")?.into())
    );
    assert!(rows(f.query(&format!("SELECT ?s WHERE {{ SERVICE SILENT spatial:search:v1 {{ {BODY}; spatial:matched ?ok }} ?s <urn:geometry> ?v FILTER(?ok) }}"))?)?.is_empty());
    // Admission errors are deferred until invocation, not a failure of all RDF queries.
    assert_eq!(
        rows(f.query("SELECT ?s WHERE { ?s <urn:geometry> ?v }")?)?.len(),
        1
    );
    Ok(())
}

#[test]
fn spatial_cancellation_and_timeout_survive_silent_and_buffered_consumption() -> Result {
    let f = Fixture::new([
        quad("a", "POINT(1 2)", GraphName::DefaultGraph),
        quad("b", "POINT(2 2)", GraphName::DefaultGraph),
    ])?;
    let query =
        format!("{PREFIX}SELECT ?v WHERE {{ SERVICE SILENT spatial:search:v1 {{ {BODY} }} }}");
    for outer in [false, true] {
        let token = CancellationToken::new();
        let control = TransactionStartControl::new();
        let mut limits = f.limits.clone();
        limits.input.control = control.clone();
        let bound = SparqlEvaluator::new()
            .with_cancellation_token(token.clone())
            .parse_query(&query)?
            .on_spatial_index(f.source()?, &f.index, f.provider.clone(), limits);
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
    let control = TransactionStartControl::new();
    let mut limits = f.limits.clone();
    limits.input.control = control.clone();
    let result = SparqlEvaluator::new()
        .parse_query(&query)?
        .on_spatial_index(f.source()?, &f.index, f.provider.clone(), limits)
        .execute()?;
    let QueryResults::Solutions(mut result) = result.results else {
        panic!("SELECT")
    };
    assert!(result.next().unwrap().is_ok());
    control.cancel();
    assert!(matches!(
        result.next(),
        Some(Err(QueryEvaluationError::Cancelled))
    ));
    let mut limits = f.limits.clone();
    limits.input.control = TransactionStartControl::new().with_timeout(Duration::ZERO);
    let result = SparqlEvaluator::new()
        .parse_query(&query)?
        .on_spatial_index(f.source()?, &f.index, f.provider.clone(), limits)
        .execute();
    let error = match result {
        Ok(result) => rows(result).unwrap_err(),
        Err(error) => error,
    };
    assert!(matches!(
        service_error(&error),
        SpatialServiceError::TimedOut
    ));
    Ok(())
}

#[test]
fn spatial_profile_pattern_resource_and_post_admission_corruption_errors() -> Result {
    let mut f = Fixture::new([
        quad("a", "POINT(1 2)", GraphName::DefaultGraph),
        quad("b", "POINT(2 2)", GraphName::DefaultGraph),
    ])?;
    let query = format!("SELECT ?v WHERE {{ SERVICE spatial:search:v1 {{ {BODY} }} }}");
    f.provider.limits.max_candidates = NonZeroUsize::MIN;
    let error = rows(f.query(&query)?).unwrap_err();
    assert!(matches!(
        service_error(&error),
        SpatialServiceError::Spatial(SpatialError::Limit)
    ));
    f.provider = SpatialIndexProvider::default();
    for body in [
        format!("{BODY}; spatial:limit 0"),
        format!("{BODY}; spatial:unknown 1"),
        format!("{BODY}; spatial:inGraph <urn:g>; spatial:defaultGraph true"),
        r#"?v spatial:geometry ?input; spatial:relation geof:sfEquals"#.into(),
        format!("{BODY}; spatial:relation geof:sfEquals"),
    ] {
        let error = rows(f.query(&format!(
            "SELECT * WHERE {{ SERVICE spatial:search:v1 {{ {body} }} }}"
        ))?)
        .unwrap_err();
        assert!(matches!(
            service_error(&error),
            SpatialServiceError::Pattern(_)
        ));
    }
    let error = rows(f.query(r#"SELECT * WHERE { SERVICE spatial:search:v1 { ?v spatial:geometry "GEOMETRYCOLLECTION(POINT(1 2))"^^geo:wktLiteral; spatial:relation geof:sfEquals } }"#)?).unwrap_err();
    assert!(matches!(
        service_error(&error),
        SpatialServiceError::Spatial(SpatialError::GeometryCollection)
    ));
    let bound = SparqlEvaluator::new()
        .parse_query(&format!("{PREFIX}{query}"))?
        .on_spatial_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone());
    std::fs::write(
        f.index.active(&f.limits)?.directory().join("spatial.base"),
        b"corrupt",
    )?;
    let error = rows(bound.execute()?).unwrap_err();
    assert!(matches!(
        service_error(&error),
        SpatialServiceError::Spatial(SpatialError::Generation(DerivedGenerationError::Corrupt))
    ));
    Ok(())
}

#[test]
fn spatial_sparql_commit_rollback_catch_up_and_restart_journey() -> Result {
    let mut f = Fixture::new([quad("kept", "POINT(1 2)", GraphName::DefaultGraph)])?;
    let mut tx = f
        .store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    tx.insert(quad("aborted", "POINT(2 2)", GraphName::DefaultGraph))?;
    tx.rollback()?;
    let mut tx = f
        .store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([3; 16]))?
        .into_transaction();
    tx.insert(quad("committed", "POINT(3 2)", GraphName::DefaultGraph))?;
    tx.commit()?;
    let source = f.source()?;
    let generation = f.index.catch_up(&source, &f.provider, &f.limits)?;
    f.index
        .activate(&generation, &source, &f.provider, &f.limits)?;
    drop(source);
    let Fixture {
        store,
        index,
        provider,
        limits,
        directory,
    } = f;
    drop(index);
    drop(store);
    let f = Fixture {
        store: Store::open(directory.path().join("db"))?,
        index: DerivedIndex::open(directory.path().join("spatial"), provider.identity())?,
        provider,
        limits,
        directory,
    };
    let result = rows(f.query(&format!("SELECT ?s WHERE {{ SERVICE spatial:search:v1 {{ {BODY} }} ?s <urn:geometry> ?v }} ORDER BY ?s"))?)?;
    assert_eq!(result.len(), 2);
    assert_eq!(
        result[0].get("s"),
        Some(&NamedNode::new("urn:committed")?.into())
    );
    assert_eq!(
        result[1].get("s"),
        Some(&NamedNode::new("urn:kept")?.into())
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn spatial_programmatic_mode_errors_are_fatal_before_pattern_errors() -> Result {
    use oxigraph::sparql::SparqlVersion;
    let f = Fixture::new([])?;
    for geometry in [r#""bad"@en--ltr"#, "<<( <urn:s> <urn:p> <urn:o> )>>"] {
        let query = spargebra::SparqlParser::new().with_version(SparqlVersion::V1_2).parse_query(&format!("{PREFIX}SELECT * WHERE {{ SERVICE SILENT spatial:search:v1 {{ ?v spatial:geometry {geometry}; spatial:relation geof:sfEquals }} }}"))?;
        let result = SparqlEvaluator::new()
            .with_version(SparqlVersion::V1_1)
            .for_query(query)
            .on_spatial_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone())
            .execute();
        let error = match result {
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
fn spatial_cache_ceiling_applies_across_distinct_bodies() -> Result {
    let mut f = Fixture::new([quad("a", "POINT(1 2)", GraphName::DefaultGraph)])?;
    f.provider.limits.max_candidates = NonZeroUsize::new(2).unwrap();
    let body = |relation| {
        format!(
            "{{ SERVICE spatial:search:v1 {{ ?v spatial:geometry \"POINT(1 2)\"^^geo:wktLiteral; spatial:relation geof:{relation} }} }}"
        )
    };
    let query = format!(
        "SELECT ?v WHERE {{ {} UNION {} UNION {} }}",
        body("sfEquals"),
        body("ehEquals"),
        body("rcc8eq")
    );
    let error = rows(f.query(&query)?).unwrap_err();
    assert!(matches!(
        service_error(&error),
        SpatialServiceError::CacheLimit
    ));
    Ok(())
}

#[test]
fn spatial_opt_in_preserves_other_registered_services() -> Result {
    use oxigraph::model::Variable;
    use oxigraph::sparql::{QuerySolutionIter, ServiceHandler};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct Other(Arc<AtomicUsize>);
    impl ServiceHandler for Other {
        type Error = std::convert::Infallible;
        fn handle(
            &self,
            _: &spargebra::algebra::QueryExpression,
            _: Option<&oxiri::Iri<oxstr::OxString>>,
        ) -> std::result::Result<QuerySolutionIter<'static>, Self::Error> {
            self.0.fetch_add(1, Ordering::SeqCst);
            let variables: Arc<[Variable]> = vec![Variable::new_unchecked("n")].into();
            Ok(QuerySolutionIter::from_tuples(
                variables,
                [Ok(vec![Some(Literal::from(7).into())])],
            ))
        }
    }
    let f = Fixture::new([quad("a", "POINT(1 2)", GraphName::DefaultGraph)])?;
    let calls = Arc::new(AtomicUsize::new(0));
    let result = SparqlEvaluator::new().with_service_handler(NamedNode::new("urn:other")?, Other(Arc::clone(&calls)))
        .parse_query(&format!("{PREFIX}SELECT ?v ?n WHERE {{ SERVICE <urn:other> {{ ?n ?p ?o }} SERVICE spatial:search:v1 {{ {BODY} }} }}"))?
        .on_spatial_index(f.source()?, &f.index, f.provider.clone(), f.limits.clone()).execute()?;
    let result = rows(result)?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].get("n"), Some(&Literal::from(7).into()));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    calls.store(0, Ordering::SeqCst);
    let control = TransactionStartControl::new();
    let mut limits = f.limits.clone();
    limits.input.control = control.clone();
    let bound = SparqlEvaluator::new()
        .with_service_handler(NamedNode::new("urn:other")?, Other(Arc::clone(&calls)))
        .parse_query("SELECT ?n WHERE { SERVICE <urn:other> { ?n ?p ?o } }")?
        .on_spatial_index(f.source()?, &f.index, f.provider.clone(), limits);
    control.cancel();
    assert!(matches!(
        bound.execute(),
        Err(QueryEvaluationError::Cancelled)
    ));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    Ok(())
}
