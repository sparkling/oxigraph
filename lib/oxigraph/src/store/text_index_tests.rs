use super::*;
use crate::store::{DerivedGenerationLimits, DerivedIndex, Store, TransactionStartControl};
type Result = std::result::Result<(), Box<dyn std::error::Error + Send + Sync>>;

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
