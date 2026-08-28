#![expect(
    clippy::assertions_on_result_states,
    clippy::missing_assert_message,
    clippy::non_ascii_literal,
    clippy::panic_in_result_fn,
    clippy::tests_outside_test_module,
    clippy::unwrap_in_result,
    reason = "integration tests assert the public transactional namespace contract"
)]

use oxigraph::io::{RdfFormat, RdfParser};
use oxigraph::model::{Dataset, GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
use oxigraph::sparql::SparqlEvaluator;
#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
use oxigraph::store::StorageError;
use oxigraph::store::{
    Namespace, NamespacePrefix, OutcomeAwareTransactionalDataset, OutcomeAwareWritableDataset,
    Store, TransactionKey, TransactionNonCommitReason, TransactionOutcome, TransactionRequest,
    TransactionalDataset, WritableDataset, WritableNamespaceRegistry,
};
use std::cell::{RefCell, RefMut};
use std::collections::BTreeMap;
use std::convert::Infallible;

#[derive(Clone, Default)]
struct RewrittenState {
    dataset: Dataset,
    namespaces: BTreeMap<NamespacePrefix, NamedNode>,
}

#[derive(Default)]
struct RewrittenPersistencePlane {
    state: RefCell<RewrittenState>,
}

impl RewrittenPersistencePlane {
    fn namespaces(&self) -> Vec<Namespace> {
        self.state
            .borrow()
            .namespaces
            .iter()
            .map(|(prefix, iri)| Namespace::new(prefix.clone(), iri.clone()))
            .collect()
    }

    fn contains(&self, quad: &Quad) -> bool {
        self.state.borrow().dataset.contains(quad.as_ref())
    }
}

struct RewrittenTransaction<'a> {
    target: RefMut<'a, RewrittenState>,
    staged: RewrittenState,
}

impl TransactionalDataset for RewrittenPersistencePlane {
    type Error = Infallible;
    type Transaction<'a> = RewrittenTransaction<'a>;

    fn start_transaction(&self) -> Result<Self::Transaction<'_>, Self::Error> {
        let staged = self.state.borrow().clone();
        Ok(RewrittenTransaction {
            target: self.state.borrow_mut(),
            staged,
        })
    }
}

impl WritableDataset for RewrittenTransaction<'_> {
    type Error = Infallible;
    type Quads<'a>
        = Box<dyn Iterator<Item = Result<Quad, Infallible>> + 'a>
    where
        Self: 'a;
    type NamedGraphs<'a>
        = Box<dyn Iterator<Item = Result<NamedOrBlankNode, Infallible>> + 'a>
    where
        Self: 'a;

    fn quads_for_pattern<'a>(
        &'a self,
        subject: Option<&NamedOrBlankNode>,
        predicate: Option<&NamedNode>,
        object: Option<&Term>,
        graph_name: Option<Option<&NamedOrBlankNode>>,
    ) -> Self::Quads<'a> {
        let subject = subject.cloned();
        let predicate = predicate.cloned();
        let object = object.cloned();
        let graph_name = graph_name.map(Option::<&NamedOrBlankNode>::cloned);
        Box::new(
            self.staged
                .dataset
                .iter()
                .filter(move |quad| {
                    subject.as_ref().is_none_or(|term| term == &quad.subject)
                        && predicate
                            .as_ref()
                            .is_none_or(|term| term == &quad.predicate)
                        && object.as_ref().is_none_or(|term| term == &quad.object)
                        && match &graph_name {
                            Some(None) => quad.graph_name.is_default_graph(),
                            Some(Some(graph_name)) => {
                                quad.graph_name == GraphName::from(graph_name.clone())
                            }
                            None => !quad.graph_name.is_default_graph(),
                        }
                })
                .map(Ok),
        )
    }

    fn named_graphs(&self) -> Self::NamedGraphs<'_> {
        Box::new(self.staged.dataset.named_graphs().map(Ok))
    }

    fn contains_named_graph(&self, graph_name: &NamedOrBlankNode) -> Result<bool, Self::Error> {
        Ok(self
            .staged
            .dataset
            .contains_named_graph(graph_name.as_ref()))
    }

    fn insert(&mut self, quad: Quad) -> Result<(), Self::Error> {
        self.staged.dataset.insert(quad);
        Ok(())
    }

    fn remove(&mut self, quad: &Quad) -> Result<(), Self::Error> {
        self.staged.dataset.remove(quad.as_ref());
        Ok(())
    }

    fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.dataset.insert_named_graph(graph_name);
        Ok(())
    }

    fn clear_graph(&mut self, graph_name: Option<&NamedOrBlankNode>) -> Result<(), Self::Error> {
        self.staged.dataset.clear_graph(
            &graph_name.map_or(GraphName::DefaultGraph, |graph_name| {
                GraphName::from(graph_name.clone())
            }),
        );
        Ok(())
    }

    fn clear_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph_name in self.staged.dataset.named_graphs().collect::<Vec<_>>() {
            self.staged
                .dataset
                .clear_graph(&GraphName::from(graph_name));
        }
        Ok(())
    }

    fn clear_all_graphs(&mut self) -> Result<(), Self::Error> {
        self.staged.dataset.clear_graph(&GraphName::DefaultGraph);
        self.clear_all_named_graphs()
    }

    fn remove_named_graph(&mut self, graph_name: &NamedOrBlankNode) -> Result<(), Self::Error> {
        self.staged.dataset.remove_named_graph(graph_name.as_ref());
        Ok(())
    }

    fn remove_all_named_graphs(&mut self) -> Result<(), Self::Error> {
        for graph_name in self.staged.dataset.named_graphs().collect::<Vec<_>>() {
            self.staged.dataset.remove_named_graph(graph_name.as_ref());
        }
        Ok(())
    }

    fn clear(&mut self) -> Result<(), Self::Error> {
        self.staged.dataset.clear();
        Ok(())
    }

    fn commit(self) -> Result<(), Self::Error> {
        let Self { mut target, staged } = self;
        *target = staged;
        Ok(())
    }

    fn rollback(self) -> Result<(), Self::Error> {
        Ok(())
    }
}

impl WritableNamespaceRegistry for RewrittenTransaction<'_> {
    type Namespaces<'a>
        = std::vec::IntoIter<Result<Namespace, Infallible>>
    where
        Self: 'a;

    fn namespaces(&self) -> Self::Namespaces<'_> {
        self.staged
            .namespaces
            .iter()
            .map(|(prefix, iri)| Ok(Namespace::new(prefix.clone(), iri.clone())))
            .collect::<Vec<_>>()
            .into_iter()
    }

    fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, Self::Error> {
        Ok(self
            .staged
            .namespaces
            .get(prefix)
            .map(|iri| Namespace::new(prefix.clone(), iri.clone())))
    }

    fn set_namespace(&mut self, namespace: Namespace) -> Result<(), Self::Error> {
        let (prefix, iri) = namespace.into_parts();
        self.staged.namespaces.insert(prefix, iri);
        Ok(())
    }

    fn remove_namespace(&mut self, prefix: &NamespacePrefix) -> Result<(), Self::Error> {
        self.staged.namespaces.remove(prefix);
        Ok(())
    }

    fn clear_namespaces(&mut self) -> Result<(), Self::Error> {
        self.staged.namespaces.clear();
        Ok(())
    }
}

fn namespace(prefix: &str, iri: &str) -> Namespace {
    Namespace::new(
        NamespacePrefix::new(prefix.to_owned()).unwrap(),
        NamedNode::new(iri.to_owned()).unwrap(),
    )
}

fn quad() -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:namespace-test:s"),
        NamedNode::new_unchecked("urn:namespace-test:p"),
        NamedNode::new_unchecked("urn:namespace-test:o"),
        NamedNode::new_unchecked("urn:namespace-test:g"),
    )
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[expect(
    unsafe_code,
    clippy::panic,
    reason = "the public corruption evaluator builds raw RocksDB fixtures"
)]
fn write_raw_default_cf(path: &std::path::Path, records: &[(&[u8], &[u8])]) {
    use oxrocksdb_sys::*;
    use std::ffi::{CStr, CString};
    use std::ptr;

    const COLUMN_FAMILIES: [&str; 12] = [
        "default", "id2str", "spog", "posg", "ospg", "gspo", "gpos", "gosp", "dspo", "dpos",
        "dosp", "graphs",
    ];

    // SAFETY: pointers are checked before use, byte slices remain alive for
    // each call, and every opened handle is destroyed before returning.
    unsafe {
        let path = CString::new(path.to_string_lossy().as_bytes()).unwrap();
        let names = COLUMN_FAMILIES
            .iter()
            .map(|name| CString::new(*name).unwrap())
            .collect::<Vec<_>>();
        let name_pointers = names.iter().map(|name| name.as_ptr()).collect::<Vec<_>>();
        let options = rocksdb_options_create();
        assert!(!options.is_null(), "RocksDB options allocation failed");
        let family_options = vec![options.cast_const(); names.len()];
        let mut handles = vec![ptr::null_mut(); names.len()];
        let mut error = ptr::null_mut();
        let database = rocksdb_open_column_families(
            options,
            path.as_ptr(),
            names.len().try_into().unwrap(),
            name_pointers.as_ptr(),
            family_options.as_ptr(),
            handles.as_mut_ptr(),
            &raw mut error,
        );
        if !error.is_null() {
            let message = CStr::from_ptr(error).to_string_lossy().into_owned();
            rocksdb_free(error.cast());
            rocksdb_options_destroy(options);
            panic!("failed to open raw corruption fixture: {message}");
        }
        assert!(!database.is_null(), "RocksDB returned a null database");
        let write_options = rocksdb_writeoptions_create();
        assert!(
            !write_options.is_null(),
            "RocksDB write-options allocation failed"
        );
        for (key, value) in records {
            rocksdb_put_cf(
                database,
                write_options,
                handles[0],
                key.as_ptr().cast(),
                key.len(),
                value.as_ptr().cast(),
                value.len(),
                &raw mut error,
            );
            if !error.is_null() {
                let message = CStr::from_ptr(error).to_string_lossy().into_owned();
                rocksdb_free(error.cast());
                panic!("failed to write raw corruption fixture: {message}");
            }
        }
        rocksdb_writeoptions_destroy(write_options);
        for handle in handles {
            rocksdb_column_family_handle_destroy(handle);
        }
        rocksdb_close(database);
        rocksdb_options_destroy(options);
    }
}

fn exercise_registry<T: WritableNamespaceRegistry>(
    transaction: &mut T,
) -> Result<Vec<Namespace>, T::Error> {
    transaction.insert(quad())?;
    let duplicate_iri = "https://example.com/shared/";
    for mapping in [
        namespace("é", "https://example.com/composed/"),
        namespace("z", duplicate_iri),
        namespace("", "https://example.com/default/"),
        namespace("e\u{301}", "https://example.com/decomposed/"),
        namespace("a", duplicate_iri),
    ] {
        transaction.set_namespace(mapping)?;
    }

    let overwritten = namespace("a", "https://example.com/overwritten/");
    transaction.set_namespace(overwritten.clone())?;
    transaction.set_namespace(overwritten)?;
    transaction.remove_namespace(&NamespacePrefix::new("missing").unwrap())?;

    let result = transaction
        .namespaces()
        .collect::<Result<Vec<_>, T::Error>>()?;
    assert_eq!(
        result
            .iter()
            .map(|namespace| namespace.prefix().as_str())
            .collect::<Vec<_>>(),
        ["", "a", "e\u{301}", "z", "é"]
    );
    assert_eq!(
        transaction
            .namespace(&NamespacePrefix::new("a").unwrap())?
            .unwrap()
            .iri()
            .as_str(),
        "https://example.com/overwritten/"
    );

    transaction.clear_namespaces()?;
    assert_eq!(transaction.namespaces().count(), 0);
    assert_eq!(
        transaction
            .quads_for_pattern(None, None, None, None)
            .collect::<Result<Vec<_>, T::Error>>()?,
        vec![quad()]
    );
    for namespace in &result {
        transaction.set_namespace(namespace.clone())?;
    }
    assert_eq!(
        transaction
            .namespaces()
            .collect::<Result<Vec<_>, T::Error>>()?,
        result
    );
    Ok(result)
}

#[test]
fn namespace_prefix_contract_starts_with_validated_public_values()
-> Result<(), Box<dyn std::error::Error>> {
    let default_prefix = NamespacePrefix::new("")?;
    let unicode_prefix = NamespacePrefix::new("é́")?;
    assert!(NamespacePrefix::new("1invalid").is_err());
    assert!(NamespacePrefix::new("invalid.").is_err());

    let namespace = Namespace::new(default_prefix, NamedNode::new("https://example.com/")?);
    assert_eq!(namespace.prefix().as_str(), "");
    assert_eq!(namespace.iri().as_str(), "https://example.com/");
    assert_eq!(unicode_prefix.as_str(), "é́");

    let store = Store::new()?;
    store.set_namespace(namespace.clone())?;
    assert_eq!(store.namespace(namespace.prefix())?, Some(namespace));
    Ok(())
}

#[test]
fn namespace_prefix_uses_exact_pn_prefix_unicode_grammar() {
    for valid in [
        "",
        "a",
        "a0",
        "a.b",
        "a_b-c",
        "é",
        "e\u{301}",
        "a\u{b7}b",
        "a\u{203f}",
        "\u{10000}x",
    ] {
        assert!(
            NamespacePrefix::new(valid).is_ok(),
            "valid prefix {valid:?}"
        );
    }
    for invalid in [
        ".", "1a", "_a", "-a", "a.", "a:b", "a/b", "a b", "\u{37e}", "\u{fdd0}",
    ] {
        assert!(
            NamespacePrefix::new(invalid).is_err(),
            "invalid prefix {invalid:?}"
        );
    }
}

#[test]
fn rewritten_and_native_planes_share_the_same_extension_contract()
-> Result<(), Box<dyn std::error::Error>> {
    let rewritten = RewrittenPersistencePlane::default();
    let rewritten_expected = {
        let mut transaction = rewritten.start_transaction()?;
        let expected = exercise_registry(&mut transaction)?;
        WritableDataset::commit(transaction)?;
        expected
    };
    assert_eq!(rewritten.namespaces(), rewritten_expected);
    assert!(rewritten.contains(&quad()));

    let store = Store::new()?;
    let native_expected = {
        let mut transaction = store.start_transaction()?;
        let expected = exercise_registry(&mut transaction)?;
        transaction.commit()?;
        expected
    };
    assert_eq!(
        store.namespaces().collect::<Result<Vec<_>, _>>()?,
        native_expected
    );
    assert_eq!(rewritten_expected, native_expected);
    assert!(store.contains(&quad())?);
    Ok(())
}

#[test]
fn rewritten_plane_rolls_back_and_drops_mixed_namespace_writes()
-> Result<(), Box<dyn std::error::Error>> {
    let rewritten = RewrittenPersistencePlane::default();
    let rolled_back = namespace("rolled", "https://example.com/rolled/");
    let mut transaction = rewritten.start_transaction()?;
    transaction.set_namespace(rolled_back)?;
    transaction.insert(quad())?;
    WritableDataset::rollback(transaction)?;
    assert!(rewritten.namespaces().is_empty());
    assert!(!rewritten.contains(&quad()));

    let dropped = namespace("dropped", "https://example.com/dropped/");
    let mut transaction = rewritten.start_transaction()?;
    transaction.set_namespace(dropped)?;
    transaction.insert(quad())?;
    drop(transaction);
    assert!(rewritten.namespaces().is_empty());
    assert!(!rewritten.contains(&quad()));
    Ok(())
}

fn exercise_store_transaction_boundaries(store: &Store) -> Result<(), Box<dyn std::error::Error>> {
    let baseline = namespace("base", "https://example.com/base/");
    store.set_namespace(baseline.clone())?;
    let old_iterator = store.namespaces();

    let committed = namespace("committed", "https://example.com/committed/");
    let expected_quad = quad();
    let mut transaction = store.start_transaction()?;
    transaction.set_namespace(committed.clone())?;
    transaction.insert(expected_quad.clone());
    assert_eq!(
        transaction.namespace(committed.prefix())?,
        Some(committed.clone())
    );
    assert!(transaction.contains(&expected_quad)?);
    assert_eq!(store.namespace(committed.prefix())?, None);
    assert!(!store.contains(&expected_quad)?);
    transaction.commit()?;

    assert_eq!(store.namespace(committed.prefix())?, Some(committed));
    assert!(store.contains(&expected_quad)?);
    assert_eq!(old_iterator.collect::<Result<Vec<_>, _>>()?, vec![baseline]);

    let rolled_back = namespace("rolled", "https://example.com/rolled/");
    let mut transaction = store.start_transaction()?;
    transaction.set_namespace(rolled_back.clone())?;
    transaction.remove(&expected_quad);
    WritableDataset::rollback(transaction)?;
    assert_eq!(store.namespace(rolled_back.prefix())?, None);
    assert!(store.contains(&expected_quad)?);

    let dropped = namespace("dropped", "https://example.com/dropped/");
    let mut transaction = store.start_transaction()?;
    transaction.set_namespace(dropped.clone())?;
    transaction.remove(&expected_quad);
    drop(transaction);
    assert_eq!(store.namespace(dropped.prefix())?, None);
    assert!(store.contains(&expected_quad)?);
    Ok(())
}

#[test]
fn memory_namespace_and_rdf_mutations_share_transaction_boundaries()
-> Result<(), Box<dyn std::error::Error>> {
    exercise_store_transaction_boundaries(&Store::new()?)
}

#[test]
fn namespace_overwrite_history_and_clear_operations_are_independent()
-> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    let prefix = NamespacePrefix::new("cycle")?;
    let first = Namespace::new(
        prefix.clone(),
        NamedNode::new("https://example.com/first/")?,
    );
    let second = Namespace::new(
        prefix.clone(),
        NamedNode::new("https://example.com/second/")?,
    );
    store.set_namespace(first.clone())?;

    let mut transaction = store.start_transaction()?;
    transaction.set_namespace(second)?;
    transaction.set_namespace(first.clone())?;
    transaction.commit()?;
    assert_eq!(store.namespace(&prefix)?, Some(first));

    let transient = namespace("transient", "https://example.com/transient/");
    let mut transaction = store.start_transaction()?;
    transaction.set_namespace(transient.clone())?;
    transaction.remove_namespace(transient.prefix())?;
    transaction.commit()?;
    assert_eq!(store.namespace(transient.prefix())?, None);

    let expected_quad = quad();
    store.insert(expected_quad.clone())?;
    store.clear()?;
    assert!(store.namespace(&prefix)?.is_some());
    assert!(store.is_empty()?);

    store.insert(expected_quad.clone())?;
    let quads_before_namespace_clear = store.iter().collect::<Result<Vec<_>, _>>()?;
    let graphs_before_namespace_clear = store.named_graphs().collect::<Result<Vec<_>, _>>()?;
    store.clear_namespaces()?;
    assert_eq!(store.namespaces().count(), 0);
    assert_eq!(
        store.iter().collect::<Result<Vec<_>, _>>()?,
        quads_before_namespace_clear
    );
    assert_eq!(
        store.named_graphs().collect::<Result<Vec<_>, _>>()?,
        graphs_before_namespace_clear
    );
    assert!(store.contains(&expected_quad)?);

    // Missing removal and repeated clear are both idempotent no-ops.
    store.remove_namespace(&prefix)?;
    store.clear_namespaces()?;
    assert!(store.contains(&expected_quad)?);
    Ok(())
}

fn exercise_keyed_store_boundaries(store: &Store) -> Result<(), Box<dyn std::error::Error>> {
    let committed_key = TransactionKey::new([0x71; 16]);
    let committed = namespace("keyed", "https://example.com/keyed/");
    let expected_quad = quad();
    let mut transaction = store
        .start_transaction_with_key(TransactionRequest::default(), committed_key.clone())?
        .into_transaction();
    transaction.set_namespace(committed.clone())?;
    transaction.insert(expected_quad.clone());
    OutcomeAwareWritableDataset::commit_with_outcome(transaction)?;
    assert_eq!(
        store.lookup_transaction_outcome(&committed_key)?,
        TransactionOutcome::Committed
    );
    assert_eq!(store.namespace(committed.prefix())?, Some(committed));
    assert!(store.contains(&expected_quad)?);

    let rolled_back_key = TransactionKey::new([0x72; 16]);
    let rolled_back = namespace("discarded", "https://example.com/discarded/");
    let mut transaction = store
        .start_transaction_with_key(TransactionRequest::default(), rolled_back_key.clone())?
        .into_transaction();
    transaction.set_namespace(rolled_back.clone())?;
    transaction.remove(&expected_quad);
    OutcomeAwareWritableDataset::rollback_with_outcome(transaction)?;
    assert_eq!(
        store.lookup_transaction_outcome(&rolled_back_key)?,
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert_eq!(store.namespace(rolled_back.prefix())?, None);
    assert!(store.contains(&expected_quad)?);
    Ok(())
}

#[test]
fn memory_keyed_transactions_publish_or_discard_rdf_and_namespaces_together()
-> Result<(), Box<dyn std::error::Error>> {
    exercise_keyed_store_boundaries(&Store::new()?)
}

#[test]
fn parser_sparql_and_dump_do_not_consume_or_persist_registry_prefixes()
-> Result<(), Box<dyn std::error::Error>> {
    let store = Store::new()?;
    store.load_from_slice(
        RdfParser::from_format(RdfFormat::Turtle),
        b"@prefix transient: <https://example.com/transient/> . transient:s transient:p transient:o .",
    )?;
    assert_eq!(store.namespaces().count(), 0);

    let registered = namespace("ex", "https://example.com/registered/");
    store.set_namespace(registered.clone())?;
    assert!(
        SparqlEvaluator::new()
            .parse_query("SELECT * WHERE { ex:s ex:p ex:o }")
            .is_err()
    );
    SparqlEvaluator::new()
        .parse_query(
            "PREFIX local: <https://example.com/local/> SELECT * WHERE { local:s local:p local:o }",
        )?
        .on_store(&store)
        .execute()?;
    assert_eq!(
        store.namespaces().collect::<Result<Vec<_>, _>>()?,
        vec![registered]
    );

    let dump = String::from_utf8(store.dump_to_writer(RdfFormat::TriG, Vec::new())?)?;
    assert!(!dump.contains("@prefix"));
    assert!(!dump.contains("PREFIX"));
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_namespace_registry_survives_reopen_and_supports_legacy_read_only_open()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    {
        let store = Store::open(directory.path())?;
        assert_eq!(store.namespaces().count(), 0);
    }
    {
        let legacy = Store::open_read_only(directory.path())?;
        assert_eq!(legacy.namespaces().count(), 0);
        assert!(
            legacy
                .set_namespace(namespace("nope", "https://example.com/nope/"))
                .is_err()
        );
    }

    let expected = {
        let store = Store::open(directory.path())?;
        let mut transaction = store.start_transaction()?;
        let expected = exercise_registry(&mut transaction)?;
        transaction.commit()?;

        store.clear_namespaces()?;
        assert_eq!(store.namespaces().count(), 0);
        assert!(store.contains(&quad())?);
        for namespace in &expected {
            store.set_namespace(namespace.clone())?;
        }
        store.clear()?;
        assert!(store.is_empty()?);
        assert_eq!(store.namespaces().collect::<Result<Vec<_>, _>>()?, expected);
        expected
    };
    {
        let store = Store::open_read_only(directory.path())?;
        assert_eq!(store.namespaces().collect::<Result<Vec<_>, _>>()?, expected);
    }
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_store_level_namespace_mutations_preserve_rdf_and_topology_across_reopen()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let first = namespace("first", "https://example.com/first/");
    let second = namespace("second", "https://example.com/second/");
    let expected_quad = quad();
    let empty_graph = NamedNode::new("urn:namespace-test:empty-graph")?;

    {
        let store = Store::open(directory.path())?;
        store.insert(expected_quad.clone())?;
        store.insert_named_graph(empty_graph)?;
        store.set_namespace(first.clone())?;
        store.set_namespace(second.clone())?;
        store.remove_namespace(first.prefix())?;
        assert_eq!(store.namespace(first.prefix())?, None);
        assert_eq!(store.namespace(second.prefix())?, Some(second.clone()));
    }

    let (expected_quads, expected_graphs) = {
        let store = Store::open(directory.path())?;
        assert_eq!(store.namespace(first.prefix())?, None);
        assert_eq!(store.namespace(second.prefix())?, Some(second));

        store.set_namespace(first)?;
        let expected_quads = store.iter().collect::<Result<Vec<_>, _>>()?;
        let expected_graphs = store.named_graphs().collect::<Result<Vec<_>, _>>()?;
        store.clear_namespaces()?;
        assert_eq!(store.namespaces().count(), 0);
        assert_eq!(store.iter().collect::<Result<Vec<_>, _>>()?, expected_quads);
        assert_eq!(
            store.named_graphs().collect::<Result<Vec<_>, _>>()?,
            expected_graphs
        );
        assert!(store.contains(&expected_quad)?);
        (expected_quads, expected_graphs)
    };

    let store = Store::open_read_only(directory.path())?;
    assert_eq!(store.namespaces().count(), 0);
    assert_eq!(store.iter().collect::<Result<Vec<_>, _>>()?, expected_quads);
    assert_eq!(
        store.named_graphs().collect::<Result<Vec<_>, _>>()?,
        expected_graphs
    );
    assert!(store.contains(&expected_quad)?);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_runs_the_same_commit_rollback_drop_and_snapshot_evaluator()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    {
        let store = Store::open(directory.path())?;
        exercise_store_transaction_boundaries(&store)?;
    }
    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store
            .namespace(&NamespacePrefix::new("committed")?)?
            .unwrap()
            .iri()
            .as_str(),
        "https://example.com/committed/"
    );
    assert_eq!(store.namespace(&NamespacePrefix::new("rolled")?)?, None);
    assert_eq!(store.namespace(&NamespacePrefix::new("dropped")?)?, None);
    assert!(store.contains(&quad())?);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
fn rocksdb_runs_the_same_keyed_mixed_commit_and_rollback_evaluator()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    {
        let store = Store::open(directory.path())?;
        exercise_keyed_store_boundaries(&store)?;
    }
    let store = Store::open_read_only(directory.path())?;
    assert_eq!(
        store.lookup_transaction_outcome(&TransactionKey::new([0x71; 16]))?,
        TransactionOutcome::Committed
    );
    assert_eq!(
        store.lookup_transaction_outcome(&TransactionKey::new([0x72; 16]))?,
        TransactionOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
    );
    assert!(store.namespace(&NamespacePrefix::new("keyed")?)?.is_some());
    assert_eq!(store.namespace(&NamespacePrefix::new("discarded")?)?, None);
    assert!(store.contains(&quad())?);
    Ok(())
}

#[cfg(all(not(target_family = "wasm"), feature = "rocksdb"))]
#[test]
#[expect(clippy::panic, reason = "the evaluator rejects accepted corruption")]
fn rocksdb_namespace_records_fail_closed_on_corruption() -> Result<(), Box<dyn std::error::Error>> {
    const SCHEMA: &[u8] = b"\0oxigraph.namespace.schema\0";
    const MAPPING: &[u8] = b"\0oxigraph.namespace.mapping.v1\0";
    const VALID_IRI: &[u8] = b"https://example.com/valid/";

    let mapping = |prefix: &[u8]| {
        let mut key = MAPPING.to_vec();
        key.extend_from_slice(prefix);
        key
    };
    let value = |version: u8, iri: &[u8]| {
        let mut value = vec![version];
        value.extend_from_slice(iri);
        value
    };
    let cases = [
        ("unknown schema version", vec![(SCHEMA.to_vec(), vec![2])]),
        (
            "mapping without marker",
            vec![(mapping(b"ex"), value(1, VALID_IRI))],
        ),
        (
            "invalid prefix utf8",
            vec![
                (SCHEMA.to_vec(), vec![1]),
                (mapping(&[0xff]), value(1, VALID_IRI)),
            ],
        ),
        (
            "invalid prefix grammar",
            vec![
                (SCHEMA.to_vec(), vec![1]),
                (mapping(b"ex."), value(1, VALID_IRI)),
            ],
        ),
        (
            "unknown record version",
            vec![
                (SCHEMA.to_vec(), vec![1]),
                (mapping(b"ex"), value(2, VALID_IRI)),
            ],
        ),
        (
            "invalid iri utf8",
            vec![
                (SCHEMA.to_vec(), vec![1]),
                (mapping(b"ex"), value(1, &[0xff])),
            ],
        ),
        (
            "invalid iri",
            vec![
                (SCHEMA.to_vec(), vec![1]),
                (mapping(b"ex"), value(1, b"not an iri")),
            ],
        ),
        (
            "unknown reserved record",
            vec![(b"\0oxigraph.namespace.future\0".to_vec(), vec![1])],
        ),
    ];

    for (label, records) in cases {
        let directory = tempfile::tempdir()?;
        drop(Store::open(directory.path())?);
        let records = records
            .iter()
            .map(|(key, value)| (key.as_slice(), value.as_slice()))
            .collect::<Vec<_>>();
        write_raw_default_cf(directory.path(), &records);
        let Err(error) = Store::open(directory.path()) else {
            panic!("{label} was accepted")
        };
        assert!(
            matches!(error, StorageError::Corruption(_)),
            "{label} returned the wrong error: {error}"
        );
    }
    Ok(())
}
