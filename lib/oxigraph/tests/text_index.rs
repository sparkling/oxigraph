#![cfg(all(unix, feature = "text-index"))]
use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, Quad};
use oxigraph::store::{
    BackupOptions, ContributorConsistency, ContributorDeclaration, ContributorRegistry,
    DerivedGenerationError, DerivedGenerationLimits, DerivedIndex, DerivedProvider, DerivedRestore,
    DerivedSnapshot, RestoreOptions, Store, TextError, TextIndexProvider, TextQuery, TextQueryMode,
    TransactionKey, TransactionRequest, TransactionStartControl, WritableDataset,
};
use std::num::NonZeroUsize;
use std::sync::Arc;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
fn quad(id: &str, text: impl Into<Literal>, graph: GraphName) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:{id}")),
        NamedNode::new_unchecked("urn:label"),
        text.into(),
        graph,
    )
}
fn capture(store: &Store) -> Result<DerivedSnapshot> {
    Ok(store.derived_snapshot(&TransactionStartControl::new())?)
}
fn build(
    index: &mut DerivedIndex,
    source: &DerivedSnapshot,
    provider: &TextIndexProvider,
    limits: &DerivedGenerationLimits,
) -> Result {
    let generation = index.rebuild(source, provider, limits)?;
    index.activate(&generation, source, provider, limits)?;
    Ok(())
}

#[test]
fn text_golden_profile_scope_identity_score_and_reopen() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let g: GraphName = NamedNode::new("urn:g")?.into();
    let blank: GraphName = BlankNode::new("g")?.into();
    let plain = quad("a", "Red café blue", GraphName::DefaultGraph);
    let english = quad(
        "a",
        Literal::new_language_tagged_literal("Red café blue", "EN")?,
        g.clone(),
    );
    let french = quad(
        "b",
        Literal::new_language_tagged_literal("red CAFÉ", "fr")?,
        blank.clone(),
    );
    let typed = quad(
        "c",
        Literal::new_typed_literal("blue 42", NamedNode::new("urn:opaque")?),
        g.clone(),
    );
    for q in [&plain, &english, &french, &typed] {
        db.insert(q.clone())?;
    }
    // A nonliteral object is not a text document, even if its IRI contains blue.
    db.insert(Quad::new(
        NamedNode::new("urn:iri")?,
        NamedNode::new("urn:label")?,
        NamedNode::new("urn:blue")?,
        g.clone(),
    ))?;
    let source = capture(&db)?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let root = dir.path().join("text");
    let mut index = DerivedIndex::create(&root, provider.identity())?;
    build(&mut index, &source, &provider, &limits)?;
    drop(index);
    let index = DerivedIndex::open(root, provider.identity())?;
    let view = index.strict(&source, &limits)?;
    let mut query = TextQuery::new("RED red café");
    let result = provider.query(&view, &query, &limits.input)?;
    assert_eq!(result.total_matches, 3);
    assert_eq!(result.candidates, 3);
    assert!(result.matches.iter().all(|hit| hit.score == 2));
    assert!(!result.eventual);
    assert!(!result.truncated());
    assert!(result.matches.iter().any(|hit| hit.quad == english));
    assert!(result.matches.iter().any(|hit| hit.quad == plain));
    assert!(result.matches.iter().any(|hit| hit.quad == french));
    query.graph = Some(g.clone());
    query.language = Some("en".into());
    assert_eq!(
        provider.query(&view, &query, &limits.input)?.matches[0].quad,
        english
    );
    query.language = Some("".into());
    assert_eq!(
        provider.query(&view, &query, &limits.input)?.total_matches,
        0
    );
    query.graph = Some(GraphName::DefaultGraph);
    assert_eq!(
        provider.query(&view, &query, &limits.input)?.matches[0].quad,
        plain
    );
    query.graph = Some(blank);
    query.language = None;
    assert_eq!(
        provider.query(&view, &query, &limits.input)?.matches[0].quad,
        french
    );
    query.predicate = Some(NamedNode::new("urn:other")?);
    assert_eq!(
        provider.query(&view, &query, &limits.input)?.total_matches,
        0
    );
    query = TextQuery::new("red 42");
    query.mode = TextQueryMode::AnyTerm;
    query.limit = NonZeroUsize::MIN;
    let result = provider.query(&view, &query, &limits.input)?;
    assert_eq!(result.total_matches, 4);
    assert!(result.truncated());
    assert_eq!(result.matches.len(), 1);
    // Operators are literal profile tokens, not query-parser instructions.
    assert_eq!(
        provider
            .query(&view, &TextQuery::new("red OR blue"), &limits.input)?
            .total_matches,
        0
    );
    assert!(matches!(
        provider.query(&view, &TextQuery::new("!!!"), &limits.input),
        Err(TextError::InvalidQuery)
    ));
    // No accent folding and no normalization.
    assert_eq!(
        provider
            .query(&view, &TextQuery::new("cafe"), &limits.input)?
            .total_matches,
        0
    );
    Ok(())
}

#[test]
fn text_strict_lag_eventual_candidate_refinement_and_snapshot_retention() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let old = quad("old", "searchable", GraphName::DefaultGraph);
    let added = quad("new", "searchable", GraphName::DefaultGraph);
    db.insert(old.clone())?;
    let source = capture(&db)?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("text"), provider.identity())?;
    build(&mut index, &source, &provider, &limits)?;
    db.remove(&old)?;
    db.insert(added.clone())?;
    let newer = capture(&db)?;
    assert!(matches!(
        index.strict(&newer, &limits),
        Err(DerivedGenerationError::NotFresh)
    ));
    let query = TextQuery::new("searchable");
    let eventual = provider.query(&index.eventual(&newer, &limits)?, &query, &limits.input)?;
    assert!(eventual.eventual);
    assert_eq!(eventual.candidates, 1);
    assert_eq!(eventual.total_matches, 0); // stale deletion removed, missing addition NOT recovered
    assert_ne!(eventual.applied, eventual.source);
    assert_eq!(
        provider
            .query(&index.strict(&source, &limits)?, &query, &limits.input)?
            .matches[0]
            .quad,
        old
    );
    build(&mut index, &newer, &provider, &limits)?;
    assert_eq!(
        provider
            .query(&index.strict(&newer, &limits)?, &query, &limits.input)?
            .matches[0]
            .quad,
        added
    );
    Ok(())
}

#[test]
fn text_governed_catch_up_rollback_clear_drop_and_empty_rebuild() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("text"), provider.identity())?;
    let graph = NamedNode::new("urn:g")?;
    let q = quad("s", "hello", graph.clone().into());
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction();
    tx.insert(q.clone())?;
    tx.commit()?;
    let initial = capture(&db)?;
    build(&mut index, &initial, &provider, &limits)?;
    let mut tx = db
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    tx.remove(&q)?;
    tx.insert(quad("rolled-back", "hello", GraphName::DefaultGraph))?;
    tx.rollback()?;
    let rolled = capture(&db)?;
    // Native maintenance can conservatively invalidate a physical token; rebuild
    // proves rollback did not leak a text document regardless of that token.
    build(&mut index, &rolled, &provider, &limits)?;
    assert_eq!(
        provider
            .query(
                &index.strict(&rolled, &limits)?,
                &TextQuery::new("hello"),
                &limits.input
            )?
            .matches[0]
            .quad,
        q
    );
    for step in 3..=6 {
        let mut tx = db
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([step; 16]),
            )?
            .into_transaction();
        match step {
            3 => tx.clear_graph(Some(&graph.clone().into()))?,
            4 => {
                tx.insert(q.clone())?;
            }
            5 => tx.remove_named_graph(&graph.clone().into())?,
            _ => {
                tx.insert(quad("default", "hello", GraphName::DefaultGraph))?;
                tx.clear()?;
            }
        }
        tx.commit()?;
        let source = capture(&db)?;
        let candidate = index.catch_up(&source, &provider, &limits)?;
        index.activate(&candidate, &source, &provider, &limits)?;
        let expected = usize::from(step == 4);
        assert_eq!(
            provider
                .query(
                    &index.strict(&source, &limits)?,
                    &TextQuery::new("hello"),
                    &limits.input
                )?
                .total_matches,
            expected
        );
    }
    Ok(())
}

#[test]
fn text_resource_limits_cancellation_and_corruption_are_not_partial_success() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    db.insert(quad("a", "hello world", GraphName::DefaultGraph))?;
    db.insert(quad("b", "hello", GraphName::DefaultGraph))?;
    let source = capture(&db)?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("text"), provider.identity())?;
    build(&mut index, &source, &provider, &limits)?;
    let mut bounded = provider.clone();
    bounded.limits.max_candidates = NonZeroUsize::MIN;
    assert!(matches!(
        bounded.query(
            &index.strict(&source, &limits)?,
            &TextQuery::new("hello"),
            &limits.input
        ),
        Err(TextError::Limit)
    ));
    bounded = provider.clone();
    bounded.limits.max_inspected_bytes = NonZeroUsize::MIN;
    assert!(matches!(
        bounded.query(
            &index.strict(&source, &limits)?,
            &TextQuery::new("hello"),
            &limits.input
        ),
        Err(TextError::Limit)
    ));
    for resource in 0..4 {
        bounded = provider.clone();
        match resource {
            0 => bounded.limits.max_documents = NonZeroUsize::MIN,
            1 => bounded.limits.max_postings = NonZeroUsize::MIN,
            2 => bounded.limits.max_index_bytes = NonZeroUsize::MIN,
            _ => bounded.limits.max_document_bytes = NonZeroUsize::MIN,
        }
        assert!(matches!(
            index.rebuild(&source, &bounded, &limits),
            Err(DerivedGenerationError::Limit)
        ));
        assert_eq!(
            provider
                .query(
                    &index.strict(&source, &limits)?,
                    &TextQuery::new("hello"),
                    &limits.input
                )?
                .total_matches,
            2
        );
    }
    let cancelled = DerivedGenerationLimits::default();
    let candidate = index.rebuild(&source, &provider, &limits)?;
    for resource in 0..2 {
        bounded = provider.clone();
        if resource == 0 {
            bounded.limits.max_document_bytes = NonZeroUsize::MIN;
        } else {
            bounded.limits.max_inspected_bytes = NonZeroUsize::MIN;
        }
        assert!(matches!(
            index.activate(&candidate, &source, &bounded, &limits),
            Err(DerivedGenerationError::Limit)
        ));
    }
    cancelled.input.control.cancel();
    assert!(index.rebuild(&source, &provider, &cancelled).is_err());
    assert!(
        provider
            .query(
                &index.strict(&source, &limits)?,
                &TextQuery::new("hello"),
                &cancelled.input
            )
            .is_err()
    );
    let generation = index.active(&limits)?;
    let retained_view = index.strict(&source, &limits)?;
    std::fs::write(generation.directory().join("text.profile"), b"wrong")?;
    assert!(matches!(
        provider.query(&retained_view, &TextQuery::new("hello"), &limits.input),
        Err(TextError::Generation(DerivedGenerationError::Corrupt))
    ));
    assert!(matches!(
        index.strict(&source, &limits),
        Err(DerivedGenerationError::Corrupt)
    ));
    Ok(())
}

#[test]
fn text_long_token_rejects_instead_of_silently_omitting() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    db.insert(quad("long", "x".repeat(257), GraphName::DefaultGraph))?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("text"), provider.identity())?;
    assert!(matches!(
        index.rebuild(&capture(&db)?, &provider, &limits),
        Err(DerivedGenerationError::Reconciliation(_))
    ));
    assert!(matches!(
        index.active(&limits),
        Err(DerivedGenerationError::Unavailable)
    ));
    db.remove(&quad("long", "x".repeat(257), GraphName::DefaultGraph))?;
    db.insert(quad("boundary", "x".repeat(256), GraphName::DefaultGraph))?;
    let source = capture(&db)?;
    build(&mut index, &source, &provider, &limits)?;
    let view = index.strict(&source, &limits)?;
    assert_eq!(
        provider
            .query(&view, &TextQuery::new("x".repeat(256)), &limits.input)?
            .total_matches,
        1
    );
    assert!(matches!(
        provider.query(&view, &TextQuery::new("x".repeat(257)), &limits.input),
        Err(TextError::TokenTooLong)
    ));
    Ok(())
}

#[test]
fn text_crash_child() -> Result {
    let Some(root) = std::env::var_os("OXIGRAPH_TEXT_CRASH_ROOT") else {
        return Ok(());
    };
    let root = std::path::PathBuf::from(root);
    let db = Store::open(root.join("db"))?;
    db.insert(quad("after-crash", "hello", GraphName::DefaultGraph))?;
    let source = capture(&db)?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::open(root.join("text"), provider.identity())?;
    let candidate = index.rebuild(&source, &provider, &limits)?;
    if std::env::var("OXIGRAPH_TEXT_CRASH_ACTIVATE").as_deref() == Ok("yes") {
        index.activate(&candidate, &source, &provider, &limits)?;
    }
    // No Store/index/snapshot destructors, unlike ordinary drop/reopen.
    std::process::exit(77);
}

#[test]
fn text_process_exit_before_and_after_activation_preserves_publication_boundary() -> Result {
    for activate in [false, true] {
        let dir = tempfile::tempdir()?;
        let provider = TextIndexProvider::default();
        let limits = DerivedGenerationLimits::default();
        {
            let db = Store::open(dir.path().join("db"))?;
            db.insert(quad("before-crash", "hello", GraphName::DefaultGraph))?;
            let source = capture(&db)?;
            let mut index = DerivedIndex::create(dir.path().join("text"), provider.identity())?;
            build(&mut index, &source, &provider, &limits)?;
        }
        let status = std::process::Command::new(std::env::current_exe()?)
            .args(["--exact", "text_crash_child", "--nocapture"])
            .env("OXIGRAPH_TEXT_CRASH_ROOT", dir.path())
            .env(
                "OXIGRAPH_TEXT_CRASH_ACTIVATE",
                if activate { "yes" } else { "no" },
            )
            .status()?;
        assert_eq!(status.code(), Some(77));
        let db = Store::open(dir.path().join("db"))?;
        let source = capture(&db)?;
        let index = DerivedIndex::open(dir.path().join("text"), provider.identity())?;
        let query = TextQuery::new("hello");
        if activate {
            assert_eq!(
                provider
                    .query(&index.strict(&source, &limits)?, &query, &limits.input)?
                    .total_matches,
                2
            );
        } else {
            assert!(matches!(
                index.strict(&source, &limits),
                Err(DerivedGenerationError::NotFresh)
            ));
            assert_eq!(
                provider
                    .query(&index.eventual(&source, &limits)?, &query, &limits.input)?
                    .total_matches,
                1
            );
        }
    }
    Ok(())
}

#[test]
fn text_backup_restore_reconcile_import_and_query() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    db.insert(quad("backup", "restored hello", GraphName::DefaultGraph))?;
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let mut index = DerivedIndex::create(dir.path().join("text"), provider.identity())?;
    let source = capture(&db)?;
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
    let restore = dir.path().join("restored");
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
    let restored_source = capture(&restored)?;
    let mut imported = DerivedIndex::create(dir.path().join("imported-text"), provider.identity())?;
    let contribution = std::fs::read_dir(restore.join("contributors"))?
        .next()
        .ok_or("missing contribution")??
        .path();
    let generation =
        imported.import_restored(contribution, &restored_source, &provider, &limits)?;
    imported.activate(&generation, &restored_source, &provider, &limits)?;
    assert_eq!(
        provider
            .query(
                &imported.strict(&restored_source, &limits)?,
                &TextQuery::new("hello"),
                &limits.input
            )?
            .total_matches,
        1
    );
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn text_direction_identity_and_nonliteral_triple_exclusion() -> Result {
    use oxigraph::model::{BaseDirection, Triple};
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    let s = NamedNode::new("urn:s")?;
    let p = NamedNode::new("urn:p")?;
    let nested = Triple::new(s.clone(), p.clone(), Literal::from("hello"));
    db.insert(Quad::new(
        s.clone(),
        p.clone(),
        nested,
        GraphName::DefaultGraph,
    ))?;
    for direction in [BaseDirection::Ltr, BaseDirection::Rtl] {
        db.insert(Quad::new(
            s.clone(),
            p.clone(),
            Literal::new_directional_language_tagged_literal("hello", "en", direction)?,
            GraphName::DefaultGraph,
        ))?;
    }
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let source = capture(&db)?;
    let mut index = DerivedIndex::create(dir.path().join("text"), provider.identity())?;
    build(&mut index, &source, &provider, &limits)?;
    let mut query = TextQuery::new("hello");
    query.language = Some("EN".into());
    let result = provider.query(&index.strict(&source, &limits)?, &query, &limits.input)?;
    assert_eq!(result.total_matches, 2);
    assert_ne!(result.matches[0].quad, result.matches[1].quad);
    Ok(())
}
