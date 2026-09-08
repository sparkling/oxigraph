//! Native G3.3 baseline, not a qualification or promotion command.
//! Usage: text_benchmark (1000|10000|100000) REPETITIONS
//! Emits raw JSONL; public query timing INCLUDES payload hydration.
use oxigraph::model::{BlankNode, GraphName, Literal, NamedNode, Quad, Term};
use oxigraph::store::{
    BackupCheckpoint, BackupError, DerivedGenerationError, DerivedGenerationLimits, DerivedIndex,
    DerivedProvider, DerivedSnapshot, Store, TextError, TextIndexProvider, TextMatch, TextQuery,
    TextQueryMode, TextResults, TransactionKey, TransactionRequest, TransactionStartControl,
    WritableDataset,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::Write;
use std::num::NonZeroUsize;
use std::time::Instant;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
const PROFILE: &str = "oxigraph.text-benchmark.literal-grid.v1";

fn emit(value: &Value) -> Result {
    writeln!(std::io::stdout().lock(), "{value}")?;
    Ok(())
}

fn options(args: &[String]) -> Result<(usize, usize)> {
    let [size, repetitions] = args else {
        return Err("usage: text_benchmark (1000|10000|100000) REPETITIONS(1..100)".into());
    };
    let size = size.parse()?;
    let repetitions = repetitions.parse()?;
    if ![1_000, 10_000, 100_000].contains(&size) || !(1..=100).contains(&repetitions) {
        return Err("unsupported corpus size or repetition count".into());
    }
    Ok((size, repetitions))
}

// Every document has a distinct, equal-width IRI subject. Therefore v1 quad-byte
// tie ordering is exactly subject lexical ordering, independent of other fields.
fn document(id: usize) -> Result<Quad> {
    let mut text = format!("common token{id:08}");
    for (divisor, token) in [
        (2, "alpha"),
        (3, "beta"),
        (10, "boundary"),
        (1000, "needle"),
    ] {
        if id.is_multiple_of(divisor) {
            text.push(' ');
            text.push_str(token);
        }
    }
    let literal = match id % 3 {
        0 => Literal::new_language_tagged_literal(text, "en")?,
        1 => Literal::new_language_tagged_literal(text, "fr")?,
        _ => Literal::from(text),
    };
    let graph = match id % 4 {
        0 => GraphName::DefaultGraph,
        1 => NamedNode::new("urn:graph:a")?.into(),
        2 => NamedNode::new("urn:graph:b")?.into(),
        _ => BlankNode::new("graph")?.into(),
    };
    Ok(Quad::new(
        NamedNode::new(format!("urn:doc:{id:08}"))?,
        NamedNode::new(if id.is_multiple_of(2) {
            "urn:label"
        } else {
            "urn:comment"
        })?,
        literal,
        graph,
    ))
}

fn corpus(size: usize) -> Result<Vec<Quad>> {
    (0..size).map(document).collect()
}

fn input_hash(quads: &[Quad]) -> String {
    let mut hash = Sha256::new();
    hash.update(PROFILE);
    hash.update(b"\n");
    for quad in quads {
        hash.update(format!("{quad} .\n"));
    }
    hex(&hash.finalize())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(char::from(DIGITS[usize::from(byte >> 4)]));
        value.push(char::from(DIGITS[usize::from(byte & 15)]));
    }
    value
}

// Named public fields, not Rust Debug formatting or an invented Store identity.
fn checkpoint(point: &BackupCheckpoint) -> Value {
    json!({"profile":"oxigraph.text-benchmark.checkpoint.v1",
        "database_id":hex(point.database_id()),"storage_version":point.storage_version(),
        "rocksdb_sequence":point.rocksdb_sequence(),"governance_schema":point.governance_schema(),
        "store_identity":point.store_identity().map(|id|hex(id.as_bytes())),
        "governed_sequence":point.governed_sequence(),
        "latest_receipt":point.latest_receipt().map(|receipt|json!({
            "schema_version":receipt.schema_version(),"store_identity":hex(receipt.store_identity().as_bytes()),
            "commit_id":hex(receipt.commit_id().as_bytes()),"transaction_key":hex(receipt.transaction_key().as_bytes()),
            "sequence":receipt.sequence(),"effect_count":receipt.effect_count(),"effects_checksum":hex(receipt.effects_checksum()),
            "outbox_header":receipt.outbox_header_cursor().map(|cursor|hex(&cursor.to_bytes())),
            "outbox_end":receipt.outbox_end_cursor().map(|cursor|hex(&cursor.to_bytes()))})),
        "outbox_high_water":point.outbox_high_water().map(|cursor|hex(&cursor.to_bytes())),
        "outbox_after_receipt_sequence":point.outbox_after_receipt_sequence(),
        "retained_after":point.retained_after().map(|cursor|hex(&cursor.to_bytes()))})
}

fn cases() -> Result<Vec<(&'static str, TextQuery)>> {
    let mut queries = Vec::new();
    for (id, text) in [
        ("rare", "needle"),
        ("intersection", "needle beta"),
        ("empty", "alpha absent"),
        ("boundary", "boundary"),
        ("common", "common"),
    ] {
        let mut query = TextQuery::new(text);
        query.limit = NonZeroUsize::MAX;
        queries.push((id, query));
    }
    let mut any = TextQuery::new("needle beta");
    any.mode = TextQueryMode::AnyTerm;
    any.limit = NonZeroUsize::MAX;
    queries.push(("union", any));
    let mut scoped = TextQuery::new("boundary");
    scoped.graph = Some(GraphName::DefaultGraph);
    scoped.predicate = Some(NamedNode::new("urn:label")?);
    scoped.language = Some("EN".into());
    scoped.limit = NonZeroUsize::MAX;
    queries.push(("scoped", scoped));
    let mut predicate = TextQuery::new("beta");
    predicate.predicate = Some(NamedNode::new("urn:comment")?);
    predicate.limit = NonZeroUsize::MAX;
    queries.push(("predicate", predicate));
    let mut top = TextQuery::new("boundary");
    top.limit = NonZeroUsize::new(7).unwrap();
    queries.push(("top7", top));
    Ok(queries)
}

// Independent of the provider, Tantivy, the index generation and derived scan.
// This profile's inputs use bounded ASCII tokens; Unicode semantics have separate
// native golden tests. The oracle compares full quads, scores, order and counts.
fn oracle(quads: &[Quad], query: &TextQuery) -> (usize, Vec<TextMatch>) {
    let terms: BTreeSet<_> = query
        .text
        .split_ascii_whitespace()
        .map(str::to_ascii_lowercase)
        .collect();
    let mut candidates = 0;
    let mut matches = Vec::new();
    for quad in quads {
        let Term::Literal(literal) = &quad.object else {
            continue;
        };
        let tokens: BTreeSet<_> = literal.value().split_ascii_whitespace().collect();
        let score = terms
            .iter()
            .filter(|term| tokens.contains(term.as_str()))
            .fold(0_u32, |count, _| count + 1);
        if score == 0
            || (query.mode == TextQueryMode::AllTerms
                && terms.iter().any(|term| !tokens.contains(term.as_str())))
        {
            continue;
        }
        candidates += 1;
        if query.graph.as_ref().is_some_and(|g| g != &quad.graph_name)
            || query
                .predicate
                .as_ref()
                .is_some_and(|p| p != &quad.predicate)
            || query
                .language
                .as_ref()
                .is_some_and(|l| !l.eq_ignore_ascii_case(literal.language().unwrap_or("")))
        {
            continue;
        }
        matches.push(TextMatch {
            quad: quad.clone(),
            score,
        });
    }
    matches.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.quad.subject.to_string().cmp(&b.quad.subject.to_string()))
    });
    (candidates, matches)
}

fn verify(
    observed: std::result::Result<TextResults, TextError>,
    expected: &(usize, Vec<TextMatch>),
    query: &TextQuery,
    maximum: usize,
) -> Result<&'static str> {
    if expected.0 > maximum {
        if !matches!(observed, Err(TextError::Limit)) {
            return Err("candidate overflow was not a typed Limit".into());
        }
        return Ok("candidate_limit");
    }
    let result = observed?;
    if result.candidates != expected.0
        || result.total_matches != expected.1.len()
        || result.matches
            != expected
                .1
                .iter()
                .take(query.limit.get())
                .cloned()
                .collect::<Vec<_>>()
        || result.truncated() != (expected.1.len() > query.limit.get())
    {
        return Err("text query differs from independent ordered quad/score oracle".into());
    }
    Ok("equivalent")
}

fn snapshot(store: &Store) -> Result<DerivedSnapshot> {
    Ok(store.derived_snapshot(&TransactionStartControl::new())?)
}

fn run(size: usize, repetitions: usize) -> Result {
    let quads = corpus(size)?;
    let directory = tempfile::tempdir()?;
    let store = Store::open(directory.path().join("primary"))?;
    let started = Instant::now();
    store.extend(quads.iter().cloned())?;
    // Establish an initial governed cursor without putting bulk-load effects in
    // the outbox. The later bounded delta contains only the measured two changes.
    store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))?
        .into_transaction()
        .commit()?;
    let load_seconds = started.elapsed().as_secs_f64();
    let provider = TextIndexProvider::default();
    let limits = DerivedGenerationLimits::default();
    let source = snapshot(&store)?;
    let root = directory.path().join("text");
    let mut index = DerivedIndex::create(&root, provider.identity())?;
    emit(
        &json!({"kind":"input","profile":PROFILE,"documents":size,"repetitions":repetitions,
        "input_sha256":input_hash(&quads),"provider_profile":TextIndexProvider::profile(),
        "limits":{"documents":provider.limits.max_documents.get(),"postings":provider.limits.max_postings.get(),
            "index_bytes":provider.limits.max_index_bytes.get(),"candidates":provider.limits.max_candidates.get(),
            "document_bytes":provider.limits.max_document_bytes.get(),"inspected_bytes":provider.limits.max_inspected_bytes.get(),
            "input_records":limits.input.max_records.get(),"input_bytes":limits.input.max_bytes.get(),
            "generation_files":limits.max_files.get(),"generation_bytes":limits.max_bytes.get(),
            "retained_generations":limits.max_generations.get(),"stored_bytes":limits.max_stored_bytes.get()},
        "concurrency":1,"durability":"native Store::extend and governed commit defaults, no overrides",
        "cache_state":"post-build OS cache, not evicted; one warmup round; fresh RAM hydration per query; retained view within each round",
        "load_plus_governance_base_seconds":load_seconds,"query_timing":"includes checksum verification, RAM hydration, engine search and primary refinement; excludes strict admission and oracle"}),
    )?;
    let started = Instant::now();
    let generation = index.rebuild(&source, &provider, &limits)?;
    let rebuild_seconds = started.elapsed().as_secs_f64();
    let started = Instant::now();
    index.activate(&generation, &source, &provider, &limits)?;
    let activation_seconds = started.elapsed().as_secs_f64();
    let payload_bytes =
        generation
            .files()
            .names()
            .try_fold(0_u64, |total, name| -> Result<u64> {
                Ok(total + std::fs::metadata(generation.directory().join(name))?.len())
            })?;
    emit(
        &json!({"kind":"setup","rebuild_seconds":rebuild_seconds,"activation_seconds":activation_seconds,
        "payload_bytes":payload_bytes,"generation":hex(&generation.fingerprint()),
        "source":checkpoint(source.checkpoint())}),
    )?;
    drop(index);
    let mut index = DerivedIndex::open(root, provider.identity())?;
    let queries = cases()?;
    let expected: Vec<_> = queries
        .iter()
        .map(|(_, query)| oracle(&quads, query))
        .collect();
    let mut checks = 0;
    for round in 0..=repetitions {
        let started = Instant::now();
        let view = index.strict(&source, &limits)?;
        emit(
            &json!({"kind":"admission","round":round,"warmup":round==0,"seconds":started.elapsed().as_secs_f64()}),
        )?;
        for offset in 0..queries.len() {
            let position = (offset + round) % queries.len();
            let (id, query) = &queries[position];
            let started = Instant::now();
            let observed = provider.query(&view, query, &limits.input);
            let seconds = started.elapsed().as_secs_f64();
            if observed.as_ref().is_ok_and(|result| {
                result.eventual
                    || result.applied != *source.checkpoint()
                    || result.source != *source.checkpoint()
            }) {
                return Err("strict result checkpoint context differs from retained source".into());
            }
            let outcome = verify(
                observed,
                &expected[position],
                query,
                provider.limits.max_candidates.get(),
            )?;
            checks += 1;
            emit(
                &json!({"kind":"query","round":round,"warmup":round==0,"query":id,"seconds":seconds,
                "outcome":outcome,"oracle_candidates":expected[position].0,"oracle_matches":expected[position].1.len()}),
            )?;
        }
    }
    let query = &queries[3].1; // boundary: 100/1000/10000 candidates
    let view = index.strict(&source, &limits)?;
    for maximum in [expected[3].0, expected[3].0 - 1] {
        let mut bounded = provider.clone();
        bounded.limits.max_candidates = NonZeroUsize::new(maximum).unwrap();
        let started = Instant::now();
        let observed = bounded.query(&view, query, &limits.input);
        let seconds = started.elapsed().as_secs_f64();
        let outcome = verify(observed, &expected[3], query, maximum)?;
        emit(
            &json!({"kind":"candidate_boundary","maximum":maximum,"candidates":expected[3].0,"outcome":outcome,"seconds":seconds}),
        )?;
    }
    let cancelled = DerivedGenerationLimits::default();
    cancelled.input.control.cancel();
    let started = Instant::now();
    if !matches!(
        provider.query(&view, query, &cancelled.input),
        Err(TextError::Generation(DerivedGenerationError::Backup(
            BackupError::Cancelled
        )))
    ) {
        return Err("pre-cancelled query did not fail typed".into());
    }
    emit(
        &json!({"kind":"cancellation","case":"before_query","seconds":started.elapsed().as_secs_f64(),"typed_cancelled":true}),
    )?;
    drop(view);
    // A governed deletion plus missing addition: strict must fail, eventual may
    // omit the addition but must discard the deletion, then catch-up restores it.
    let mut changed = quads.clone();
    let removed = changed.remove(0);
    let added = document(size)?;
    changed.push(added.clone());
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([2; 16]))?
        .into_transaction();
    tx.remove(&removed)?;
    tx.insert(added)?;
    tx.commit()?;
    let newer = snapshot(&store)?;
    let started = Instant::now();
    if !matches!(
        index.strict(&newer, &limits),
        Err(DerivedGenerationError::NotFresh)
    ) {
        return Err("strict lag did not return NotFresh".into());
    }
    emit(&json!({"kind":"lag","strict_not_fresh":true,"seconds":started.elapsed().as_secs_f64()}))?;
    let mut query = TextQuery::new("needle");
    query.limit = NonZeroUsize::MAX;
    let (old_candidates, _) = oracle(&quads, &query);
    let mut retained = quads.clone();
    retained.remove(0);
    let (_, surviving) = oracle(&retained, &query);
    let eventual = provider.query(&index.eventual(&newer, &limits)?, &query, &limits.input)?;
    if !eventual.eventual || eventual.applied == eventual.source {
        return Err("missing eventual lag context".into());
    }
    emit(
        &json!({"kind":"eventual","applied":checkpoint(&eventual.applied),"source":checkpoint(&eventual.source),"candidates":eventual.candidates,"surviving":eventual.total_matches,"current_primary_matches":oracle(&changed,&query).1.len()}),
    )?;
    verify(
        Ok(eventual),
        &(old_candidates, surviving),
        &query,
        provider.limits.max_candidates.get(),
    )?;
    let started = Instant::now();
    let candidate = index.catch_up(&newer, &provider, &limits)?;
    let catch_up_seconds = started.elapsed().as_secs_f64();
    let started = Instant::now();
    index.activate(&candidate, &newer, &provider, &limits)?;
    let catch_up_activation_seconds = started.elapsed().as_secs_f64();
    verify(
        provider.query(&index.strict(&newer, &limits)?, &query, &limits.input),
        &oracle(&changed, &query),
        &query,
        provider.limits.max_candidates.get(),
    )?;
    emit(
        &json!({"kind":"complete","query_checks":checks,"lag_checks":3,"resource_checks":3,"catch_up_seconds":catch_up_seconds,
        "catch_up_activation_seconds":catch_up_activation_seconds,"changed_input_sha256":input_hash(&changed),
        "catch_up_generation":hex(&candidate.fingerprint()),"catch_up_source":checkpoint(candidate.source()),
        "all_checks_passed":true,"promotion":false}),
    )
}

fn main() -> Result {
    let (size, repetitions) = options(&std::env::args().skip(1).collect::<Vec<_>>())?;
    run(size, repetitions)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn input_options_are_bounded_and_explicit() {
        for args in [
            vec![],
            vec!["10", "30"],
            vec!["1000", "0"],
            vec!["100000", "101"],
            vec!["1000", "1", "extra"],
        ] {
            assert!(options(&args.into_iter().map(String::from).collect::<Vec<_>>()).is_err());
        }
        assert_eq!(
            options(&["10000".into(), "30".into()]).unwrap(),
            (10000, 30)
        );
    }
    #[test]
    fn fixed_corpus_and_independent_oracle_have_known_counts() -> Result {
        let quads = corpus(1000)?;
        assert_eq!(
            input_hash(&quads),
            "b1f8dd8fe88654da67250db84b0b655b8e16988d628687750136502e291ba095"
        );
        assert_eq!(
            quads[0].to_string(),
            "<urn:doc:00000000> <urn:label> \"common token00000000 alpha beta boundary needle\"@en"
        );
        for ((id, query), (candidates, matches)) in cases()?.into_iter().zip([
            (1, 1),
            (1, 1),
            (0, 0),
            (100, 100),
            (1000, 1000),
            (334, 334),
            (100, 17),
            (334, 167),
            (100, 100),
        ]) {
            let observed = oracle(&quads, &query);
            assert_eq!(
                (observed.0, observed.1.len()),
                (candidates, matches),
                "{id}"
            );
        }
        Ok(())
    }
    #[test]
    fn oracle_rejects_incorrect_counts_and_overflow_success() -> Result {
        let query = TextQuery::new("needle");
        assert!(verify(Err(TextError::Limit), &(1, vec![]), &query, 10).is_err());
        assert!(verify(Err(TextError::InvalidQuery), &(11, vec![]), &query, 10).is_err());
        assert_eq!(
            verify(Err(TextError::Limit), &(11, vec![]), &query, 10)?,
            "candidate_limit"
        );
        let directory = tempfile::tempdir()?;
        let store = Store::open(directory.path().join("primary"))?;
        let point = snapshot(&store)?.checkpoint().clone();
        let mut query = TextQuery::new("boundary");
        query.limit = NonZeroUsize::MIN;
        let expected = oracle(&corpus(20)?, &query);
        let good = TextResults {
            matches: vec![expected.1[0].clone()],
            total_matches: 2,
            candidates: 2,
            source: point.clone(),
            applied: point,
            eventual: false,
        };
        assert_eq!(
            verify(Ok(good.clone()), &expected, &query, 2)?,
            "equivalent"
        );
        assert!(verify(Ok(good.clone()), &expected, &query, 1).is_err());
        for mutation in 0..6 {
            let mut bad = good.clone();
            match mutation {
                0 => bad.candidates += 1,
                1 => bad.total_matches += 1,
                2 => bad.matches[0] = expected.1[1].clone(),
                3 => bad.matches[0].score += 1,
                4 => bad.matches.clear(),
                _ => bad.matches.push(expected.1[1].clone()),
            }
            assert!(verify(Ok(bad), &expected, &query, 2).is_err());
        }
        Ok(())
    }
}
