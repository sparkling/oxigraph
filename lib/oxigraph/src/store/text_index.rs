//! Optional native text candidates on the shared ADR-0024 lifecycle.
use super::backup::check;
use super::{
    BackupCheckpoint, DerivedDelta, DerivedFiles, DerivedGenerationError, DerivedLimits,
    DerivedProvider, DerivedSnapshot, DerivedView, DerivedWriter, SemanticChange, StorageError,
};
use crate::model::{GraphName, Literal, NamedNode, Quad, Term};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::num::{NonZeroU32, NonZeroUsize};
use std::path::{Path, PathBuf};
use std::time::Instant;
use tantivy::collector::{Count, DocSetCollector};
use tantivy::directory::{Directory, RamDirectory};
use tantivy::indexer::NoMergePolicy;
use tantivy::query::{AllQuery, BooleanQuery, Occur, Query, TermQuery};
use tantivy::schema::{Field, IndexRecordOption, STORED, STRING, Schema, Value};
use tantivy::{DocAddress, DocSet, Index, IndexSettings, IndexWriter, TERMINATED, TantivyDocument};

const PROFILE_FILE: &str = "text.profile";
const MAX_TOKEN_BYTES: usize = 256;
const MAX_QUERY_BYTES: usize = 4096;
const MAX_QUERY_TERMS: usize = 32;
const WRITER_MEMORY: usize = 15_000_000;

/// Provider working-set ceilings. These bound logical documents, postings and
/// directory bytes, not process RSS. Tantivy's single writer additionally uses
/// a 15 MB arena; native buffers, collection overhead and one encoded document
/// or file copy are outside the logical ceilings. Directory size is checked at
/// document/commit boundaries, not during an engine allocation.
#[derive(Clone, Debug)]
#[expect(
    clippy::struct_field_names,
    reason = "explicit ceiling names match the shared derived limits"
)]
pub struct TextLimits {
    pub max_documents: NonZeroUsize,
    pub max_postings: NonZeroUsize,
    pub max_index_bytes: NonZeroUsize,
    pub max_candidates: NonZeroUsize,
    pub max_document_bytes: NonZeroUsize,
    pub max_inspected_bytes: NonZeroUsize,
}
impl Default for TextLimits {
    fn default() -> Self {
        Self {
            max_documents: NonZeroUsize::new(100_000).unwrap_or(NonZeroUsize::MIN),
            max_postings: NonZeroUsize::new(1_000_000).unwrap_or(NonZeroUsize::MIN),
            max_index_bytes: NonZeroUsize::new(64 * 1024 * 1024).unwrap_or(NonZeroUsize::MIN),
            max_candidates: NonZeroUsize::new(10_000).unwrap_or(NonZeroUsize::MIN),
            max_document_bytes: NonZeroUsize::new(1024 * 1024).unwrap_or(NonZeroUsize::MIN),
            max_inspected_bytes: NonZeroUsize::new(64 * 1024 * 1024).unwrap_or(NonZeroUsize::MIN),
        }
    }
}

/// Literal-level, versioned lexical search; no engine query syntax is accepted.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TextQueryMode {
    AllTerms,
    AnyTerm,
}

/// Search all literal lexical forms, including typed/language/directional
/// literals. Tokens are maximal Unicode alphanumeric runs, lowercased without
/// normalization, stemming or stop words. A token longer than 256 UTF-8 bytes
/// rejects the operation rather than silently disappearing. Query terms are
/// deduplicated; an empty query rejects. Phrase/fuzzy/prefix syntax is not used.
#[derive(Clone, Debug)]
pub struct TextQuery {
    pub text: String,
    pub mode: TextQueryMode,
    /// None means all graphs, not just the default graph.
    pub graph: Option<GraphName>,
    pub predicate: Option<NamedNode>,
    /// Exact case-insensitive language tag; empty means untagged. No stemming,
    /// language fallback, or RFC 4647 range matching is implied.
    pub language: Option<String>,
    pub limit: NonZeroUsize,
}
impl TextQuery {
    pub fn new(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            mode: TextQueryMode::AllTerms,
            graph: None,
            predicate: None,
            language: None,
            limit: NonZeroUsize::new(100).unwrap_or(NonZeroUsize::MIN),
        }
    }
    fn terms(&self) -> Result<BTreeSet<String>, TextError> {
        if self.text.len() > MAX_QUERY_BYTES
            || self.language.as_ref().is_some_and(|s| s.len() > 255)
        {
            return Err(TextError::Limit);
        }
        let terms = tokenize(&self.text)?;
        if terms.is_empty() || terms.len() > MAX_QUERY_TERMS {
            return Err(TextError::InvalidQuery);
        }
        Ok(terms)
    }
    fn in_scope(&self, quad: &Quad, literal: &Literal) -> bool {
        self.graph.as_ref().is_none_or(|g| g == &quad.graph_name)
            && self.predicate.as_ref().is_none_or(|p| p == &quad.predicate)
            && self.language.as_ref().is_none_or(|language| {
                language.eq_ignore_ascii_case(literal.language().unwrap_or(""))
            })
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TextMatch {
    pub quad: Quad,
    /// Number of distinct query terms present, NOT BM25 or a probability.
    pub score: u32,
}
#[derive(Clone, Debug)]
pub struct TextResults {
    pub matches: Vec<TextMatch>,
    /// Verified matches among this generation's candidates before the result
    /// limit. In eventual mode this is NOT the total in the primary snapshot:
    /// missing additions remain missing even when this value is zero.
    pub total_matches: usize,
    /// Unscoped index candidates inspected before primary/graph verification.
    pub candidates: usize,
    pub applied: BackupCheckpoint,
    pub source: BackupCheckpoint,
    pub eventual: bool,
}
impl TextResults {
    /// Whether the output limit omitted verified candidate matches. False does
    /// not establish eventual completeness with respect to primary contents.
    pub fn truncated(&self) -> bool {
        self.matches.len() < self.total_matches
    }
}

#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum TextError {
    #[error(transparent)]
    Generation(#[from] DerivedGenerationError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("text query must contain between 1 and 32 distinct tokens")]
    InvalidQuery,
    #[error("text provider logical resource ceiling exceeded")]
    Limit,
    #[error("text token exceeds the profile's 256-byte limit")]
    TokenTooLong,
    #[error("text profile/schema or engine format differs; rebuild required")]
    Profile,
    #[error("text index does not reproduce primary literals and token postings")]
    NotEquivalent,
    #[error("text engine error: {0}")]
    Engine(String),
}
fn engine(error: impl std::fmt::Display) -> TextError {
    TextError::Engine(error.to_string())
}
fn provider_error(error: TextError) -> DerivedGenerationError {
    match error {
        TextError::Generation(error) => error,
        TextError::Limit => DerivedGenerationError::Limit,
        other => DerivedGenerationError::Reconciliation(other.to_string()),
    }
}
fn controlled(limits: &DerivedLimits, started: Instant) -> Result<(), TextError> {
    check(&limits.control, started).map_err(DerivedGenerationError::from)?;
    Ok(())
}

/// Tantivy-backed provider with an engine-neutral query/result API. Uses RAM
/// directories copied through the shared checksummed generation writer; there
/// is no second activation, outbox, backup or restore protocol. Catch-up currently
/// rebuilds from the exact snapshot after core validates the complete delta.
#[derive(Clone, Debug, Default)]
pub struct TextIndexProvider {
    pub limits: TextLimits,
}
impl TextIndexProvider {
    /// Profile binding also records Unicode tables, RDF codec mode and exact
    /// engine version. A dependency/compiler upgrade may require a rebuild.
    pub fn profile() -> String {
        format!(
            "oxigraph.text.literal.v1\nunicode={:?}\ntantivy={}\nrdf12={}\n",
            char::UNICODE_VERSION,
            tantivy::version(),
            cfg!(feature = "rdf-12")
        )
    }

    /// Query only a retained core view. Obtain it using `DerivedIndex::strict`
    /// (typed NotFresh on lag) or explicitly `DerivedIndex::eventual`. Every
    /// candidate is checked against that SAME primary snapshot and query scope.
    /// Eventual mode can omit new additions; it never returns deleted quads.
    ///
    /// Results sort by descending matched-term count, then the v1 encoded RDF
    /// quad bytes, independent of engine segment IDs. Candidate overflow fails
    /// the entire query, even for a small output limit. No partial success on
    /// cancellation. Control checks surround engine calls; they do not preempt
    /// a Tantivy call already running. The core strict path includes a full scan.
    pub fn query(
        &self,
        view: &DerivedView<'_>,
        query: &TextQuery,
        limits: &DerivedLimits,
    ) -> Result<TextResults, TextError> {
        let started = Instant::now();
        controlled(limits, started)?;
        if view.generation().identity() != self.identity() {
            return Err(TextError::Profile);
        }
        let terms = query.terms()?;
        let index = self.open(view.generation().files(), limits, started)?;
        if index.load_metas().map_err(engine)?.payload.as_deref()
            != Some(&payload(view.generation().source()))
        {
            return Err(TextError::Profile);
        }
        let reader = index.reader().map_err(engine)?;
        let searcher = reader.searcher();
        let (_, token_field, quad_field) = schema();
        let occur = match query.mode {
            TextQueryMode::AllTerms => Occur::Must,
            TextQueryMode::AnyTerm => Occur::Should,
        };
        let clauses: Vec<(Occur, Box<dyn Query>)> = terms
            .iter()
            .map(|term| -> (Occur, Box<dyn Query>) {
                (
                    occur,
                    Box::new(TermQuery::new(
                        tantivy::Term::from_field_text(token_field, term),
                        IndexRecordOption::Basic,
                    )),
                )
            })
            .collect();
        let engine_query = BooleanQuery::new(clauses);
        let count = searcher.search(&engine_query, &Count).map_err(engine)?;
        controlled(limits, started)?;
        if count > self.limits.max_candidates.get() {
            return Err(TextError::Limit);
        }
        // The searcher is immutable, so the preceding count bounds this set.
        let candidates = searcher
            .search(&engine_query, &DocSetCollector)
            .map_err(engine)?;
        let mut found = Vec::new();
        let mut inspected_bytes = 0_usize;
        for address in candidates {
            controlled(limits, started)?;
            let doc: TantivyDocument = searcher.doc(address).map_err(engine)?;
            let (bytes, quad) = self.read_quad(&doc, quad_field, &mut inspected_bytes)?;
            let Term::Literal(literal) = &quad.object else {
                return Err(TextError::NotEquivalent);
            };
            if !query.in_scope(&quad, literal) || !view.source().contains(&quad)? {
                continue;
            }
            let tokens = tokenize(literal.value())?;
            let score = terms.intersection(&tokens).count();
            if score == 0 || (query.mode == TextQueryMode::AllTerms && score != terms.len()) {
                continue;
            }
            found.push((
                bytes,
                TextMatch {
                    quad,
                    score: u32::try_from(score).map_err(|_| TextError::Limit)?,
                },
            ));
        }
        found.sort_by(|(a, x), (b, y)| y.score.cmp(&x.score).then_with(|| a.cmp(b)));
        let total_matches = found.len();
        let matches = found
            .into_iter()
            .take(query.limit.get())
            .map(|(_, hit)| hit)
            .collect();
        controlled(limits, started)?;
        Ok(TextResults {
            matches,
            total_matches,
            candidates: count,
            applied: view.generation().source().clone(),
            source: view.source().checkpoint().clone(),
            eventual: view.is_eventual(),
        })
    }

    fn build(
        &self,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), TextError> {
        let started = Instant::now();
        controlled(limits, started)?;
        let directory = RamDirectory::create();
        let (schema, token_field, quad_field) = schema();
        let index =
            Index::create(directory.clone(), schema, IndexSettings::default()).map_err(engine)?;
        let mut writer: IndexWriter = index
            .writer_with_num_threads(1, WRITER_MEMORY)
            .map_err(engine)?;
        writer.set_merge_policy(Box::new(NoMergePolicy));
        let mut documents = 0_usize;
        let mut postings = 0_usize;
        let mut failure = None;
        source
            .scan(limits, |change| {
                let SemanticChange::QuadAdded(quad) = change else {
                    return Ok(());
                };
                let Term::Literal(literal) = &quad.object else {
                    return Ok(());
                };
                let result = (|| {
                    controlled(limits, started)?;
                    let mut document_bytes = 0_usize;
                    super::change_codec::emit(change, &mut |bytes| {
                        document_bytes = document_bytes.saturating_add(bytes.len())
                    });
                    if document_bytes > self.limits.max_document_bytes.get() {
                        return Err(TextError::Limit);
                    }
                    let tokens = tokenize(literal.value())?;
                    documents = documents.checked_add(1).ok_or(TextError::Limit)?;
                    postings = postings.checked_add(tokens.len()).ok_or(TextError::Limit)?;
                    self.check_size(documents, postings, directory.total_mem_usage())?;
                    let mut doc = TantivyDocument::default();
                    doc.add_bytes(quad_field, &super::change_codec::encode(change)?);
                    for token in tokens {
                        doc.add_text(token_field, token);
                    }
                    writer.add_document(doc).map_err(engine)?;
                    Ok::<_, TextError>(())
                })();
                if let Err(error) = result {
                    failure = Some(error);
                    return Err(StorageError::Other("text provider build stopped".into()));
                }
                Ok(())
            })
            .map_err(|error| failure.unwrap_or_else(|| TextError::Generation(error.into())))?;
        controlled(limits, started)?;
        let mut commit = writer.prepare_commit().map_err(engine)?;
        commit.set_payload(&payload(source.checkpoint()));
        commit.commit().map_err(engine)?;
        writer.wait_merging_threads().map_err(engine)?;
        self.check_size(documents, postings, directory.total_mem_usage())?;
        controlled(limits, started)?;
        output.write_file(PROFILE_FILE, Self::profile().as_bytes())?;
        let mut names: BTreeSet<PathBuf> =
            index.directory().list_managed_files().into_iter().collect();
        names.insert(PathBuf::from("meta.json"));
        names.insert(PathBuf::from(".managed.json"));
        for name in names {
            controlled(limits, started)?;
            // Read the underlying directory, preserving Tantivy file footers.
            // Deleted managed files can remain registered after engine cleanup.
            if !directory.exists(&name).map_err(engine)? {
                continue;
            }
            let bytes = directory.atomic_read(&name).map_err(engine)?;
            output.write_file(name.to_str().ok_or(TextError::Profile)?, bytes.as_slice())?;
        }
        controlled(limits, started)
    }

    fn open(
        &self,
        files: &DerivedFiles,
        limits: &DerivedLimits,
        started: Instant,
    ) -> Result<Index, TextError> {
        let directory = RamDirectory::create();
        let profile = Self::profile();
        let observed = files.read_verified(PROFILE_FILE, profile.len() + 1, limits, started)?;
        if observed != profile.as_bytes() {
            return Err(TextError::Profile);
        }
        let mut total = observed.len();
        for name in files.names().filter(|name| *name != PROFILE_FILE) {
            controlled(limits, started)?;
            let available = self
                .limits
                .max_index_bytes
                .get()
                .checked_sub(total)
                .ok_or(TextError::Limit)?;
            let bytes = files.read_verified(name, available, limits, started)?;
            total += bytes.len();
            directory
                .atomic_write(Path::new(name), &bytes)
                .map_err(engine)?;
        }
        let index = Index::open(directory).map_err(engine)?;
        if index.schema() != schema().0 {
            return Err(TextError::Profile);
        }
        let reader = index.reader().map_err(engine)?;
        let docs = usize::try_from(reader.searcher().num_docs()).map_err(|_| TextError::Limit)?;
        self.check_size(docs, 0, total)?;
        controlled(limits, started)?;
        Ok(index)
    }

    fn verify(
        &self,
        source: &DerivedSnapshot,
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> Result<(), TextError> {
        let started = Instant::now();
        let index = self.open(files, limits, started)?;
        if index.load_metas().map_err(engine)?.payload.as_deref()
            != Some(&payload(source.checkpoint()))
        {
            return Err(TextError::Profile);
        }
        let reader = index.reader().map_err(engine)?;
        let searcher = reader.searcher();
        let (_, token_field, quad_field) = schema();
        let mut expected = BTreeSet::new();
        let mut expected_bytes = 0_usize;
        let mut source_failure = None;
        source
            .scan(limits, |change| {
                let SemanticChange::QuadAdded(quad) = change else {
                    return Ok(());
                };
                let Term::Literal(literal) = &quad.object else {
                    return Ok(());
                };
                let result = (|| {
                    controlled(limits, started)?;
                    let mut size = 0_usize;
                    super::change_codec::emit(change, &mut |bytes| {
                        size = size.saturating_add(bytes.len())
                    });
                    expected_bytes = expected_bytes.checked_add(size).ok_or(TextError::Limit)?;
                    if expected.len() >= self.limits.max_documents.get()
                        || size > self.limits.max_document_bytes.get()
                        || expected_bytes > self.limits.max_inspected_bytes.get()
                    {
                        return Err(TextError::Limit);
                    }
                    // Validate profile representability before allocating the
                    // retained expected quad or handing it to the engine.
                    tokenize(literal.value())?;
                    expected.insert(super::change_codec::encode(change)?);
                    Ok::<_, TextError>(())
                })();
                if let Err(error) = result {
                    source_failure = Some(error);
                    return Err(StorageError::Other(
                        "text reconciliation source stopped".into(),
                    ));
                }
                Ok(())
            })
            .map_err(|error| {
                source_failure.unwrap_or_else(|| TextError::Generation(error.into()))
            })?;
        if u64::try_from(expected.len()).map_err(|_| TextError::Limit)? != searcher.num_docs() {
            return Err(TextError::NotEquivalent);
        }
        let mut expected_postings = BTreeSet::new();
        let mut inspected_bytes = 0_usize;
        for address in searcher
            .search(&AllQuery, &DocSetCollector)
            .map_err(engine)?
        {
            controlled(limits, started)?;
            let doc: TantivyDocument = searcher.doc(address).map_err(engine)?;
            let (bytes, quad) = self.read_quad(&doc, quad_field, &mut inspected_bytes)?;
            if !expected.remove(&bytes) {
                return Err(TextError::NotEquivalent);
            }
            let Term::Literal(literal) = quad.object else {
                return Err(TextError::NotEquivalent);
            };
            for token in tokenize(literal.value())? {
                if expected_postings.len() >= self.limits.max_postings.get() {
                    return Err(TextError::Limit);
                }
                expected_postings.insert((token, address));
            }
        }
        if !expected.is_empty() {
            return Err(TextError::NotEquivalent);
        }
        // Stored documents alone cannot prove that the inverted index will
        // find all terms. Verify the complete token->document relation too.
        for (ordinal, segment) in searcher.segment_readers().iter().enumerate() {
            let inverted = segment.inverted_index(token_field).map_err(engine)?;
            let mut stream = inverted.terms().stream().map_err(engine)?;
            while stream.advance() {
                controlled(limits, started)?;
                let token =
                    std::str::from_utf8(stream.key()).map_err(|_| TextError::NotEquivalent)?;
                let mut postings = inverted
                    .read_postings_from_terminfo(stream.value(), IndexRecordOption::Basic)?;
                while postings.doc() != TERMINATED {
                    controlled(limits, started)?;
                    let address = DocAddress::new(
                        u32::try_from(ordinal).map_err(|_| TextError::Limit)?,
                        postings.doc(),
                    );
                    if !expected_postings.remove(&(token.to_owned(), address)) {
                        return Err(TextError::NotEquivalent);
                    }
                    postings.advance();
                }
            }
        }
        if !expected_postings.is_empty() {
            return Err(TextError::NotEquivalent);
        }
        controlled(limits, started)
    }
    fn check_size(&self, docs: usize, postings: usize, bytes: usize) -> Result<(), TextError> {
        if docs > self.limits.max_documents.get()
            || postings > self.limits.max_postings.get()
            || bytes > self.limits.max_index_bytes.get()
        {
            return Err(TextError::Limit);
        }
        Ok(())
    }
    fn read_quad(
        &self,
        doc: &TantivyDocument,
        field: Field,
        inspected: &mut usize,
    ) -> Result<(Vec<u8>, Quad), TextError> {
        let mut values = doc.get_all(field);
        let bytes = values
            .next()
            .and_then(|value| value.as_bytes())
            .ok_or(TextError::NotEquivalent)?;
        if values.next().is_some() {
            return Err(TextError::NotEquivalent);
        }
        *inspected = inspected.checked_add(bytes.len()).ok_or(TextError::Limit)?;
        if bytes.len() > self.limits.max_document_bytes.get()
            || *inspected > self.limits.max_inspected_bytes.get()
        {
            return Err(TextError::Limit);
        }
        let SemanticChange::QuadAdded(quad) = super::change_codec::decode(bytes)? else {
            return Err(TextError::NotEquivalent);
        };
        Ok((bytes.to_vec(), quad))
    }
}
impl DerivedProvider for TextIndexProvider {
    fn identity(&self) -> super::ContributorIdentity {
        // Bind the profile at core admission too, not just inside query/open:
        // a new binary must not report an old incompatible profile Healthy.
        let digest = Sha256::digest(Self::profile());
        let mut id = [0; 16];
        id.copy_from_slice(&digest[..16]);
        super::ContributorIdentity::new(id, NonZeroU32::MIN)
    }
    fn rebuild(
        &self,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        self.build(source, output, limits).map_err(provider_error)
    }
    fn apply(
        &self,
        _previous: &DerivedFiles,
        _delta: &DerivedDelta,
        source: &DerivedSnapshot,
        output: &mut DerivedWriter<'_>,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        // Core validates the whole delta first. Full rebuild deliberately also
        // captures ungoverned changes; no incremental-performance claim.
        self.rebuild(source, output, limits)
    }
    fn reconcile(
        &self,
        source: &DerivedSnapshot,
        files: &DerivedFiles,
        limits: &DerivedLimits,
    ) -> Result<(), DerivedGenerationError> {
        self.verify(source, files, limits).map_err(provider_error)
    }
}
fn schema() -> (Schema, Field, Field) {
    let mut builder = Schema::builder();
    // Raw STRING values: profile tokenization is ours, with no hidden default
    // 40-byte truncation, stopword list, stemming or query-parser behavior.
    let token = builder.add_text_field("token", STRING);
    let quad = builder.add_bytes_field("quad", STORED);
    (builder.build(), token, quad)
}
fn tokenize(text: &str) -> Result<BTreeSet<String>, TextError> {
    let mut tokens = BTreeSet::new();
    for token in text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
    {
        if token.len() > MAX_TOKEN_BYTES {
            return Err(TextError::TokenTooLong);
        }
        let token = token.to_lowercase();
        if token.len() > MAX_TOKEN_BYTES {
            return Err(TextError::TokenTooLong);
        }
        tokens.insert(token);
    }
    Ok(tokens)
}
fn payload(checkpoint: &BackupCheckpoint) -> String {
    // Includes full applied receipt and physical checkpoint, not sequence alone.
    const HEX: &[u8] = b"0123456789abcdef";
    let mut result = String::from("oxigraph.text.source.v1:");
    for byte in Sha256::digest(checkpoint.encoded()) {
        result.push(char::from(HEX[usize::from(byte >> 4)]));
        result.push(char::from(HEX[usize::from(byte & 15)]));
    }
    result
}

#[cfg(test)]
#[path = "text_index_tests.rs"]
mod tests;
