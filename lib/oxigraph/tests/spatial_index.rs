#![cfg(all(unix, feature = "spatial-index"))]
use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, Quad};
use oxigraph::store::{
    BackupOptions, ContributorConsistency, ContributorDeclaration, ContributorRegistry,
    DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider, DerivedRestore,
    DerivedSnapshot, RestoreOptions, SpatialError, SpatialIndexProvider, SpatialQuery, Store,
    TransactionKey, TransactionRequest, TransactionStartControl, WritableDataset,
};
use std::collections::HashSet;
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::Duration;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn wkt(value: &str) -> Literal {
    Literal::new_typed_literal(
        value.to_owned(),
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
fn query(shape: &str, relation: &str) -> SpatialQuery {
    SpatialQuery::new(
        wkt(shape),
        NamedNode::new_unchecked(format!(
            "http://www.opengis.net/def/function/geosparql/{relation}"
        )),
    )
}
fn capture(store: &Store) -> Result<DerivedSnapshot> {
    Ok(store.derived_snapshot(&TransactionStartControl::new())?)
}
fn build(
    index: &mut DerivedIndex,
    source: &DerivedSnapshot,
    provider: &SpatialIndexProvider,
    limits: &DerivedGenerationLimits,
) -> Result {
    let generation = index.rebuild(source, provider, limits)?;
    index.activate(&generation, source, provider, limits)?;
    Ok(())
}
const RELATIONS: [&str; 24] = [
    "sfEquals",
    "sfDisjoint",
    "sfIntersects",
    "sfTouches",
    "sfCrosses",
    "sfWithin",
    "sfContains",
    "sfOverlaps",
    "ehEquals",
    "ehDisjoint",
    "ehMeet",
    "ehOverlap",
    "ehCovers",
    "ehCoveredBy",
    "ehInside",
    "ehContains",
    "rcc8eq",
    "rcc8dc",
    "rcc8ec",
    "rcc8po",
    "rcc8tpp",
    "rcc8ntpp",
    "rcc8tppi",
    "rcc8ntppi",
];

#[test]
fn spatial_candidates_equal_independent_exact_relation_evaluation() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let shapes = [
        "POINT(0 0)",
        "POINT(2 2)",
        "POINT(12 48)",
        "POINT(48 12)",
        "LINESTRING(-1 0,4 0)",
        "LINESTRING(179 0,-179 1)",
        "POLYGON((0 0,4 0,4 4,0 4,0 0),(1 1,1 3,3 3,3 1,1 1))",
        "POLYGON((1 1,2 1,2 2,1 2,1 1))",
        "POLYGON EMPTY",
        "GEOMETRYCOLLECTION EMPTY",
        "POLYGON((4 0,5 0,5 1,4 1,4 0))",
        "MULTIPOINT((1 1),(5 5))",
        "MULTIPOLYGON(((0 0,2 0,2 2,0 2,0 0)),((4 0,6 0,6 2,4 2,4 0)))",
        "LINESTRING EMPTY",
        "MULTIPOINT EMPTY",
    ];
    for (i, shape) in shapes.iter().enumerate() {
        db.insert(quad(&i.to_string(), shape, GraphName::DefaultGraph))?;
    }
    db.insert(Quad::new(
        BlankNode::new("s")?,
        NamedNode::new("urn:geometry")?,
        Literal::new_typed_literal(
            r#"{"type":"Point","coordinates":[12,48]}"#,
            NamedNode::new("http://www.opengis.net/ont/geosparql#geoJSONLiteral")?,
        ),
        BlankNode::new("g")?,
    ))?;
    // These are not accepted by the exact geometry parser.
    db.insert(quad(
        "foreign",
        "<http://www.opengis.net/def/crs/EPSG/0/4326> POINT(0 0)",
        GraphName::DefaultGraph,
    ))?;
    db.insert(Quad::new(
        NamedNode::new("urn:plain")?,
        NamedNode::new("urn:geometry")?,
        Literal::from("POINT(0 0)"),
        GraphName::DefaultGraph,
    ))?;
    let all = db.iter().collect::<std::result::Result<Vec<_>, _>>()?;
    let source = capture(&db)?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("spatial"), provider.identity())?;
    build(&mut index, &source, &provider, &limits)?;
    let view = index.strict(&source, &limits)?;
    for shape in shapes {
        for name in RELATIONS {
            let q = query(shape, name);
            let (_, exact) = spargeo::GEOSPARQL_EXTENSION_FUNCTIONS
                .into_iter()
                .find(|(iri, _)| iri == &q.relation)
                .ok_or("missing exact relation")?;
            let expected: HashSet<_> = all
                .iter()
                .filter(|quad| {
                    exact(&[quad.object.clone(), q.geometry.clone()])
                        == Some(Literal::from(true).into())
                })
                .cloned()
                .collect();
            let result = provider.query(&view, &q, &limits.input)?;
            assert_eq!(
                result.total_matches,
                expected.len(),
                "{name} against {shape}"
            );
            assert_eq!(
                result.matches.into_iter().collect::<HashSet<_>>(),
                expected,
                "{name} against {shape}"
            );
        }
    }
    // Boundary contact is included, but a point in a polygon hole is disjoint
    // despite overlapping envelopes. The exact predicate, not the box, decides.
    assert!(
        provider
            .query(&view, &query("POINT(2 2)", "sfDisjoint"), &limits.input)?
            .matches
            .iter()
            .any(|q| q.subject == NamedNode::new("urn:6").unwrap())
    );
    let result = provider.query(&view, &query("POINT(12 48)", "sfEquals"), &limits.input)?;
    assert_eq!(result.total_matches, 2);
    assert!(result.candidates < shapes.len() + 1);
    Ok(())
}

#[test]
fn spatial_scope_limits_reopen_and_strict_snapshot_retention() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let original = quad("old", "POINT(1 2)", GraphName::DefaultGraph);
    let named = quad("named", "POINT(1 2)", NamedNode::new("urn:g")?.into());
    db.insert(original.clone())?;
    db.insert(named.clone())?;
    let source = capture(&db)?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let root = dir.path().join("spatial");
    let mut index = DerivedIndex::create(&root, provider.identity())?;
    build(&mut index, &source, &provider, &limits)?;
    drop(index);
    let index = DerivedIndex::open(root, provider.identity())?;
    let view = index.strict(&source, &limits)?;
    let mut q = query("POINT(1 2)", "sfEquals");
    q.limit = Some(NonZeroUsize::MIN);
    let result = provider.query(&view, &q, &limits.input)?;
    assert_eq!(result.total_matches, 2);
    assert!(result.truncated());
    assert_eq!(result.source, result.applied);
    q.graph = Some(named.graph_name.clone());
    assert_eq!(provider.query(&view, &q, &limits.input)?.matches, [named]);
    q.graph = Some(GraphName::DefaultGraph);
    assert_eq!(
        provider.query(&view, &q, &limits.input)?.matches,
        [original.clone()]
    );
    q.predicate = Some(NamedNode::new("urn:other")?);
    assert!(provider.query(&view, &q, &limits.input)?.matches.is_empty());
    q.predicate = None;
    db.remove(&original)?;
    db.insert(quad("new", "POINT(1 2)", GraphName::DefaultGraph))?;
    let newer = capture(&db)?;
    assert!(matches!(
        index.strict(&newer, &limits),
        Err(DerivedGenerationError::NotFresh)
    ));
    assert!(matches!(
        provider.query(&index.eventual(&newer, &limits)?, &q, &limits.input),
        Err(SpatialError::Generation(DerivedGenerationError::NotFresh))
    ));
    assert_eq!(
        provider.query(&view, &q, &limits.input)?.matches,
        [original]
    );
    Ok(())
}

#[test]
fn spatial_ordered_overlay_clear_drop_rollback_and_ungoverned_gap() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("spatial"), provider.identity())?;
    let graph = NamedNode::new("urn:g")?;
    let named = quad("named", "POINT(1 2)", graph.clone().into());
    let default = quad("default", "POINT(1 2)", GraphName::DefaultGraph);
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    tx.insert(named.clone())?;
    tx.commit()?;
    build(&mut index, &capture(&db)?, &provider, &limits)?;
    for step in 2..=6 {
        let mut tx = db
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([step; 16]),
            )?
            .into_transaction();
        match step {
            2 => {
                tx.clear_graph(Some(&graph.clone().into()))?;
                tx.insert(named.clone())?;
                tx.insert(default.clone())?;
            }
            3 => {
                tx.remove(&named)?;
                tx.insert(named.clone())?;
                tx.remove_named_graph(&graph.clone().into())?;
            }
            4 => {
                tx.insert(named.clone())?;
                tx.clear()?;
                tx.insert(default.clone())?;
            }
            5 => {
                tx.clear()?;
                tx.insert(named.clone())?;
            }
            _ => {
                tx.remove(&default)?;
            }
        }
        if step == 5 {
            tx.rollback()?;
        } else {
            tx.commit()?;
        }
        let source = capture(&db)?;
        let candidate = index.catch_up(&source, &provider, &limits)?;
        index.activate(&candidate, &source, &provider, &limits)?;
        if step == 4 {
            drop(index);
            index = DerivedIndex::open(dir.path().join("spatial"), provider.identity())?;
        }
        let expected = match step {
            2 => 2,
            6 => 0,
            _ => 1,
        };
        assert_eq!(
            provider
                .query(
                    &index.strict(&source, &limits)?,
                    &query("POINT(1 2)", "sfEquals"),
                    &limits.input
                )?
                .total_matches,
            expected
        );
    }
    // A later governed commit does not cover an ungoverned addition.
    db.insert(named.clone())?;
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([7; 16]))?
        .into_transaction();
    tx.insert(default)?;
    tx.commit()?;
    let source = capture(&db)?;
    assert!(matches!(
        index.catch_up(&source, &provider, &limits),
        Err(DerivedGenerationError::Reconciliation(_))
    ));
    assert!(matches!(
        index.strict(&source, &limits),
        Err(DerivedGenerationError::NotFresh)
    ));
    build(&mut index, &source, &provider, &limits)?;
    assert_eq!(
        provider
            .query(
                &index.strict(&source, &limits)?,
                &query("POINT(1 2)", "sfEquals"),
                &limits.input
            )?
            .total_matches,
        2
    );
    Ok(())
}

#[test]
fn spatial_bounded_overlay_requires_explicit_rebuild() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("spatial"), provider.identity())?;
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    tx.insert(quad("initial", "POINT(1 2)", GraphName::DefaultGraph))?;
    tx.commit()?;
    build(&mut index, &capture(&db)?, &provider, &limits)?;
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    for name in ["a", "b"] {
        tx.insert(quad(name, "POINT(1 2)", GraphName::DefaultGraph))?;
    }
    tx.commit()?;
    let source = capture(&db)?;
    let mut bounded = provider.clone();
    bounded.limits.max_overlay_records = NonZeroUsize::MIN;
    assert!(matches!(
        index.catch_up(&source, &bounded, &limits),
        Err(DerivedGenerationError::RebuildRequired)
    ));
    build(&mut index, &source, &bounded, &limits)?;
    assert_eq!(
        bounded
            .query(
                &index.strict(&source, &limits)?,
                &query("POINT(1 2)", "sfEquals"),
                &limits.input
            )?
            .total_matches,
        3
    );
    Ok(())
}

#[test]
fn spatial_errors_are_typed_not_partial_or_silent_matches() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    for name in ["a", "b"] {
        db.insert(quad(name, "POINT(1 2)", GraphName::DefaultGraph))?;
    }
    let source = capture(&db)?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("spatial"), provider.identity())?;
    build(&mut index, &source, &provider, &limits)?;
    let view = index.strict(&source, &limits)?;
    let q = query("POINT(1 2)", "sfEquals");
    let mut bounded = provider.clone();
    bounded.limits.max_candidates = NonZeroUsize::MIN;
    for relation in ["sfEquals", "sfDisjoint"] {
        let mut scoped = query("POINT(1 2)", relation);
        scoped.limit = Some(NonZeroUsize::MIN);
        scoped.graph = Some(NamedNode::new("urn:absent")?.into());
        assert!(matches!(
            bounded.query(&view, &scoped, &limits.input),
            Err(SpatialError::Limit)
        ));
    }
    for field in 0..3 {
        bounded = provider.clone();
        match field {
            0 => bounded.limits.max_documents = NonZeroUsize::MIN,
            1 => bounded.limits.max_document_bytes = NonZeroUsize::MIN,
            _ => bounded.limits.max_index_bytes = NonZeroUsize::MIN,
        }
        assert!(matches!(
            index.rebuild(&source, &bounded, &limits),
            Err(DerivedGenerationError::Limit)
        ));
    }
    let mut cancelled = limits.clone();
    cancelled.input.control = TransactionStartControl::new();
    cancelled.input.control.cancel();
    assert!(provider.query(&view, &q, &cancelled.input).is_err());
    let mut expired = limits.clone();
    expired.input.control = TransactionStartControl::new().with_timeout(Duration::ZERO);
    assert!(provider.query(&view, &q, &expired.input).is_err());
    assert!(matches!(
        provider.query(&view, &query("POINT(1e309 2)", "sfEquals"), &limits.input),
        Err(SpatialError::NonFinite)
    ));
    assert!(matches!(
        provider.query(
            &view,
            &query("POLYGON((0 0,2 2,0 2,2 0,0 0))", "sfEquals"),
            &limits.input
        ),
        Err(SpatialError::InvalidGeometry)
    ));
    assert!(matches!(
        provider.query(
            &view,
            &query("GEOMETRYCOLLECTION(LINESTRING(0 0,0 0))", "sfEquals"),
            &limits.input
        ),
        Err(SpatialError::InvalidGeometry)
    ));
    assert!(matches!(
        provider.query(&view, &query("POINT(1e200 1)", "sfEquals"), &limits.input),
        Err(SpatialError::CoordinateRange)
    ));
    // geo0.33.1 panics at a topology-position debug assertion when this
    // member-valid collection is passed to raw Relate in the matrix above.
    let overlapping =
        "GEOMETRYCOLLECTION(POLYGON((0 0,2 0,2 2,0 2,0 0)),POLYGON((1 0,3 0,3 2,1 2,1 0)))";
    assert!(matches!(
        provider.query(&view, &query(overlapping, "sfEquals"), &limits.input),
        Err(SpatialError::GeometryCollection)
    ));
    for invalid in [
        query("POINT(1 2)", "buffer"),
        query("bad", "sfEquals"),
        query("<urn:unsupported> POINT(1 2)", "sfEquals"),
    ] {
        assert!(matches!(
            provider.query(&view, &invalid, &limits.input),
            Err(SpatialError::Query)
        ));
    }
    let active = index.active(&limits)?;
    std::fs::write(active.directory().join("spatial.base"), b"corrupt")?;
    assert!(matches!(
        provider.query(&view, &q, &limits.input),
        Err(SpatialError::Generation(DerivedGenerationError::Corrupt))
    ));
    Ok(())
}

#[test]
fn spatial_nonfinite_primary_rejects_activation_and_plain_large_literals_are_ignored() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let bad = quad("infinite", "POINT(1e309 2)", GraphName::DefaultGraph);
    db.insert(bad.clone())?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("spatial"), provider.identity())?;
    assert!(matches!(
        index.rebuild(&capture(&db)?, &provider, &limits),
        Err(DerivedGenerationError::Reconciliation(_))
    ));
    assert!(matches!(
        index.active(&limits),
        Err(DerivedGenerationError::Unavailable)
    ));
    db.remove(&bad)?;
    for shape in [
        "POLYGON((0 0,2 2,0 2,2 0,0 0))",
        "POINT(1e200 1)",
        "GEOMETRYCOLLECTION(POLYGON((0 0,2 0,2 2,0 2,0 0)),POLYGON((1 0,3 0,3 2,1 2,1 0)))",
    ] {
        let outside = quad("outside", shape, GraphName::DefaultGraph);
        db.insert(outside.clone())?;
        assert!(matches!(
            index.rebuild(&capture(&db)?, &provider, &limits),
            Err(DerivedGenerationError::Reconciliation(_))
        ));
        assert!(matches!(
            index.active(&limits),
            Err(DerivedGenerationError::Unavailable)
        ));
        db.remove(&outside)?;
    }
    db.insert(Quad::new(
        NamedNode::new("urn:plain")?,
        NamedNode::new("urn:p")?,
        Literal::from("x".repeat(provider.limits.max_document_bytes.get() + 1)),
        GraphName::DefaultGraph,
    ))?;
    let source = capture(&db)?;
    build(&mut index, &source, &provider, &limits)?;
    assert_eq!(
        provider
            .query(
                &index.strict(&source, &limits)?,
                &query("POINT(1 2)", "sfEquals"),
                &limits.input
            )?
            .total_matches,
        0
    );
    Ok(())
}

#[test]
fn spatial_backup_restore_reconcile_import_and_query() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    db.insert(quad("saved", "POINT(1 2)", GraphName::DefaultGraph))?;
    let source = capture(&db)?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("spatial"), provider.identity())?;
    build(&mut index, &source, &provider, &limits)?;
    let registry = ContributorRegistry::new(vec![ContributorDeclaration::new(
        provider.identity(),
        true,
        ContributorConsistency::Strict,
        false,
    )])?;
    let backup = dir.path().join("backup");
    db.backup_with_receipt(
        &backup,
        &BackupOptions {
            contributors: registry.clone(),
            contributions: vec![index.active(&limits)?.backup_contribution(&limits)?],
            ..BackupOptions::default()
        },
    )?;
    let restore = dir.path().join("restore");
    Store::restore_backup(
        &backup,
        &restore,
        &RestoreOptions {
            contributors: registry,
            reconcilers: vec![Arc::new(DerivedRestore::new(
                Arc::new(provider.clone()),
                limits.clone(),
            ))],
            ..RestoreOptions::default()
        },
    )?;
    let restored = Store::open(restore.join("store"))?;
    let source = capture(&restored)?;
    let mut imported = DerivedIndex::create(dir.path().join("imported"), provider.identity())?;
    let contribution = std::fs::read_dir(restore.join("contributors"))?
        .next()
        .ok_or("missing contributor")??
        .path();
    let generation = imported.import_restored(contribution, &source, &provider, &limits)?;
    imported.activate(&generation, &source, &provider, &limits)?;
    assert_eq!(
        provider
            .query(
                &imported.strict(&source, &limits)?,
                &query("POINT(1 2)", "sfEquals"),
                &limits.input
            )?
            .total_matches,
        1
    );
    Ok(())
}

#[test]
fn spatial_all_graph_barriers_preserve_effect_order() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("spatial"), provider.identity())?;
    let default = quad("default", "POINT(1 2)", GraphName::DefaultGraph);
    let named = quad("named", "POINT(1 2)", NamedNode::new("urn:g")?.into());
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    tx.insert(default.clone())?;
    tx.commit()?;
    build(&mut index, &capture(&db)?, &provider, &limits)?;
    for step in 2..=4 {
        let mut tx = db
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([step; 16]),
            )?
            .into_transaction();
        tx.insert(default.clone())?;
        tx.insert(named.clone())?;
        match step {
            2 => tx.clear_all_named_graphs()?,
            3 => tx.remove_all_named_graphs()?,
            _ => tx.clear_all_graphs()?,
        }
        // A post-barrier insertion must not be suppressed by the earlier clear.
        let after = quad(
            &format!("after-{step}"),
            "POINT(1 2)",
            NamedNode::new("urn:after")?.into(),
        );
        tx.insert(after.clone())?;
        tx.commit()?;
        let source = capture(&db)?;
        let candidate = index.catch_up(&source, &provider, &limits)?;
        index.activate(&candidate, &source, &provider, &limits)?;
        let result = provider.query(
            &index.strict(&source, &limits)?,
            &query("POINT(1 2)", "sfEquals"),
            &limits.input,
        )?;
        assert!(result.matches.contains(&after));
        assert_eq!(result.total_matches, if step == 4 { 1 } else { 2 });
    }
    Ok(())
}

#[test]
fn spatial_crash_child() -> Result {
    let Some(root) = std::env::var_os("OXIGRAPH_SPATIAL_CRASH_ROOT") else {
        return Ok(());
    };
    let root = std::path::PathBuf::from(root);
    let db = Store::open(root.join("db"))?;
    db.insert(quad("after", "POINT(1 2)", GraphName::DefaultGraph))?;
    let source = capture(&db)?;
    let provider = SpatialIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::open(root.join("spatial"), provider.identity())?;
    let candidate = index.rebuild(&source, &provider, &limits)?;
    if std::env::var("OXIGRAPH_SPATIAL_CRASH_ACTIVATE").as_deref() == Ok("yes") {
        index.activate(&candidate, &source, &provider, &limits)?;
    }
    std::process::exit(77);
}

#[test]
fn spatial_process_exit_before_and_after_activation() -> Result {
    for activate in [false, true] {
        let dir = tempfile::tempdir()?;
        let provider = SpatialIndexProvider::default();
        let limits = DerivedGenerationLimits::default();
        {
            let db = Store::open(dir.path().join("db"))?;
            db.insert(quad("before", "POINT(1 2)", GraphName::DefaultGraph))?;
            let source = capture(&db)?;
            let mut index = DerivedIndex::create(dir.path().join("spatial"), provider.identity())?;
            build(&mut index, &source, &provider, &limits)?;
        }
        let status = std::process::Command::new(std::env::current_exe()?)
            .args(["--exact", "spatial_crash_child", "--nocapture"])
            .env("OXIGRAPH_SPATIAL_CRASH_ROOT", dir.path())
            .env(
                "OXIGRAPH_SPATIAL_CRASH_ACTIVATE",
                if activate { "yes" } else { "no" },
            )
            .status()?;
        assert_eq!(status.code(), Some(77));
        let db = Store::open(dir.path().join("db"))?;
        let source = capture(&db)?;
        let mut index = DerivedIndex::open(dir.path().join("spatial"), provider.identity())?;
        if !activate {
            assert!(matches!(
                index.strict(&source, &limits),
                Err(DerivedGenerationError::NotFresh)
            ));
            build(&mut index, &source, &provider, &limits)?;
        }
        assert_eq!(
            provider
                .query(
                    &index.strict(&source, &limits)?,
                    &query("POINT(1 2)", "sfEquals"),
                    &limits.input
                )?
                .total_matches,
            2
        );
    }
    Ok(())
}
