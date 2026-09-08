use super::*;
use crate::store::{DerivedGenerationLimits, DerivedIndex, Store, TransactionStartControl};
type Result = std::result::Result<(), Box<dyn std::error::Error + Send + Sync>>;

// Observe actual cursor advances, not elapsed time or a synthetic work score.
#[derive(Clone, Debug)]
struct CountedQuery(std::sync::Arc<std::sync::atomic::AtomicUsize>);
struct CountedWeight {
    inner: Box<dyn tantivy::query::Weight>,
    advances: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
struct CountedScorer {
    inner: Box<dyn tantivy::query::Scorer>,
    advances: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl Query for CountedQuery {
    fn weight(
        &self,
        scoring: EnableScoring<'_>,
    ) -> tantivy::Result<Box<dyn tantivy::query::Weight>> {
        Ok(Box::new(CountedWeight {
            inner: AllQuery.weight(scoring)?,
            advances: self.0.clone(),
        }))
    }
}
impl tantivy::query::Weight for CountedWeight {
    fn scorer(
        &self,
        reader: &tantivy::SegmentReader,
        boost: tantivy::Score,
    ) -> tantivy::Result<Box<dyn tantivy::query::Scorer>> {
        Ok(Box::new(CountedScorer {
            inner: self.inner.scorer(reader, boost)?,
            advances: self.advances.clone(),
        }))
    }
    fn explain(
        &self,
        reader: &tantivy::SegmentReader,
        doc: tantivy::DocId,
    ) -> tantivy::Result<tantivy::query::Explanation> {
        self.inner.explain(reader, doc)
    }
}
impl DocSet for CountedScorer {
    fn advance(&mut self) -> tantivy::DocId {
        self.advances
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.inner.advance()
    }
    fn doc(&self) -> tantivy::DocId {
        self.inner.doc()
    }
    fn size_hint(&self) -> u32 {
        self.inner.size_hint()
    }
}
impl tantivy::query::Scorer for CountedScorer {
    fn score(&mut self) -> tantivy::Score {
        self.inner.score()
    }
}

fn candidate_fixture(
    deletes: bool,
) -> std::result::Result<Index, Box<dyn std::error::Error + Send + Sync>> {
    let (schema, token, _) = schema();
    let index = Index::create(RamDirectory::create(), schema, IndexSettings::default())?;
    let mut writer: IndexWriter = index.writer_with_num_threads(1, WRITER_MEMORY)?;
    writer.set_merge_policy(Box::new(NoMergePolicy));
    for segment in 0..3 {
        for id in segment * 4..segment * 4 + 4 {
            let mut doc = TantivyDocument::default();
            doc.add_text(token, "all");
            doc.add_text(token, format!("id{id}"));
            if id % 2 == 0 {
                doc.add_text(token, "even");
            }
            if id % 3 == 0 {
                doc.add_text(token, "third");
            }
            writer.add_document(doc)?;
        }
        writer.commit()?;
    }
    if deletes {
        writer.delete_term(tantivy::Term::from_field_text(token, "id1"));
        writer.delete_term(tantivy::Term::from_field_text(token, "id8"));
        writer.commit()?;
    }
    writer.wait_merging_threads()?;
    Ok(index)
}

#[test]
fn text_candidate_collection_is_single_pass_and_ceiling_bounded() -> Result {
    let index = candidate_fixture(false)?;
    let reader = index.reader()?;
    let searcher = reader.searcher();
    assert_eq!(searcher.segment_readers().len(), 3);
    let advances = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let query = CountedQuery(advances.clone());
    let candidates =
        collect_candidates(&searcher, &query, NonZeroUsize::new(12).unwrap(), || Ok(()))?;
    assert_eq!(candidates.len(), 12);
    assert_eq!(advances.load(std::sync::atomic::Ordering::Relaxed), 12);
    advances.store(0, std::sync::atomic::Ordering::Relaxed);
    assert!(matches!(
        collect_candidates(&searcher, &query, NonZeroUsize::new(3).unwrap(), || Ok(())),
        Err(TextError::Limit)
    ));
    assert_eq!(advances.load(std::sync::atomic::Ordering::Relaxed), 3);
    Ok(())
}

#[test]
fn text_candidate_collection_observes_cancellation_during_enumeration() -> Result {
    let index = candidate_fixture(false)?;
    let reader = index.reader()?;
    let searcher = reader.searcher();
    let advances = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let query = CountedQuery(advances.clone());
    let limits = DerivedLimits::default();
    let started = Instant::now();
    assert!(
        collect_candidates(&searcher, &query, NonZeroUsize::new(12).unwrap(), || {
            if advances.load(std::sync::atomic::Ordering::Relaxed) >= 2 {
                limits.control.cancel();
            }
            controlled(&limits, started)
        })
        .is_err()
    );
    assert_eq!(advances.load(std::sync::atomic::Ordering::Relaxed), 2);
    Ok(())
}

#[test]
fn text_candidate_collection_matches_engine_boolean_queries_and_deletions() -> Result {
    let index = candidate_fixture(true)?;
    let reader = index.reader()?;
    let searcher = reader.searcher();
    assert_eq!(searcher.segment_readers().len(), 3);
    assert_eq!(searcher.num_docs(), 10);
    let (_, token, _) = schema();
    for occur in [Occur::Must, Occur::Should] {
        for terms in [
            vec!["all"],
            vec!["even", "third"],
            vec!["all", "absent"],
            vec!["id1", "id8"],
        ] {
            let query = BooleanQuery::new(
                terms
                    .into_iter()
                    .map(|term| -> (Occur, Box<dyn Query>) {
                        (
                            occur,
                            Box::new(TermQuery::new(
                                tantivy::Term::from_field_text(token, term),
                                IndexRecordOption::Basic,
                            )),
                        )
                    })
                    .collect(),
            );
            let expected = searcher.search(&query, &DocSetCollector)?;
            let maximum = NonZeroUsize::new(expected.len()).unwrap_or(NonZeroUsize::MIN);
            let actual = collect_candidates(&searcher, &query, maximum, || Ok(()))?;
            assert_eq!(actual.len(), expected.len());
            assert_eq!(
                actual.into_iter().collect::<std::collections::HashSet<_>>(),
                expected
            );
            if let Some(below) = NonZeroUsize::new(expected.len().saturating_sub(1)) {
                assert!(matches!(
                    collect_candidates(&searcher, &query, below, || Ok(())),
                    Err(TextError::Limit)
                ));
            }
        }
    }
    Ok(())
}

#[test]
fn text_candidate_collection_empty_index_does_not_reserve_the_ceiling() -> Result {
    let (schema, _, _) = schema();
    let index = Index::create(RamDirectory::create(), schema, IndexSettings::default())?;
    let reader = index.reader()?;
    let searcher = reader.searcher();
    assert!(collect_candidates(&searcher, &AllQuery, NonZeroUsize::MAX, || Ok(()))?.is_empty());
    let limits = DerivedLimits::default();
    limits.control.cancel();
    assert!(
        collect_candidates(&searcher, &AllQuery, NonZeroUsize::MAX, || {
            controlled(&limits, Instant::now())
        })
        .is_err()
    );
    Ok(())
}

struct WrongPostings(&'static str);
impl DerivedProvider for WrongPostings {
    fn identity(&self) -> super::super::ContributorIdentity {
        TextIndexProvider::default().identity()
    }
    fn rebuild(
        &self,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> std::result::Result<(), DerivedGenerationError> {
        let directory = RamDirectory::create();
        let (schema, token_field, quad_field) = schema();
        let index = Index::create(directory.clone(), schema, IndexSettings::default())
            .map_err(|e| provider_error(engine(e)))?;
        let mut writer: IndexWriter = index
            .writer_with_num_threads(1, WRITER_MEMORY)
            .map_err(|e| provider_error(engine(e)))?;
        source.scan(limits, |change| {
            if let SemanticChange::QuadAdded(_) = change {
                let mut doc = TantivyDocument::default();
                doc.add_bytes(quad_field, &super::super::change_codec::encode(change)?);
                if !self.0.is_empty() {
                    doc.add_text(token_field, self.0);
                }
                writer
                    .add_document(doc)
                    .map_err(|e| StorageError::Other(e.into()))?;
            }
            Ok(())
        })?;
        let mut commit = writer
            .prepare_commit()
            .map_err(|e| provider_error(engine(e)))?;
        commit.set_payload(&payload(source.checkpoint()));
        commit.commit().map_err(|e| provider_error(engine(e)))?;
        writer
            .wait_merging_threads()
            .map_err(|e| provider_error(engine(e)))?;
        output.write_file(PROFILE_FILE, TextIndexProvider::profile().as_bytes())?;
        let mut names: BTreeSet<_> = index.directory().list_managed_files().into_iter().collect();
        names.insert(PathBuf::from("meta.json"));
        names.insert(PathBuf::from(".managed.json"));
        for name in names {
            if directory
                .exists(&name)
                .map_err(|e| provider_error(engine(e)))?
            {
                output.write_file(
                    name.to_str().ok_or(DerivedGenerationError::Corrupt)?,
                    directory
                        .atomic_read(&name)
                        .map_err(|e| provider_error(engine(e)))?
                        .as_slice(),
                )?;
            }
        }
        Ok(())
    }
    fn reconcile(
        &self,
        source: &DerivedSnapshot,
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> std::result::Result<(), DerivedGenerationError> {
        TextIndexProvider::default().reconcile(source, files, limits)
    }
}

#[test]
fn text_reconciliation_rejects_missing_or_extra_postings_despite_correct_stored_quads() -> Result {
    let dir = tempfile::tempdir()?;
    let db = Store::open(dir.path().join("db"))?;
    db.insert(Quad::new(
        NamedNode::new("urn:s")?,
        NamedNode::new("urn:p")?,
        Literal::from("hello"),
        GraphName::DefaultGraph,
    ))?;
    let source = db.derived_snapshot(&TransactionStartControl::new())?;
    let limits = DerivedGenerationLimits::default();
    for (case, token) in ["", "wrong"].into_iter().enumerate() {
        let provider = WrongPostings(token);
        let mut index =
            DerivedIndex::create(dir.path().join(format!("bad-{case}")), provider.identity())?;
        assert!(matches!(
            index.rebuild(&source, &provider, &limits),
            Err(DerivedGenerationError::Reconciliation(_))
        ));
        assert!(matches!(
            index.active(&limits),
            Err(DerivedGenerationError::Unavailable)
        ));
    }
    Ok(())
}

#[test]
fn text_token_profile_is_literal_and_has_no_hidden_40_byte_cutoff() -> Result {
    let token = "a".repeat(256);
    assert_eq!(tokenize(&token)?, BTreeSet::from([token]));
    assert!(matches!(
        tokenize(&"a".repeat(257)),
        Err(TextError::TokenTooLong)
    ));
    assert_eq!(
        tokenize("CAFÉ cafe\u{301} RED red")?,
        BTreeSet::from(["café".into(), "cafe".into(), "red".into()])
    );
    Ok(())
}
