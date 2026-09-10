//! Upgrade-only native readers and lease-preserving transformation.
use super::*;
use crate::store::UpgradeTransformOptions;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UpgradeProjection {
    quads: BTreeSet<Vec<u8>>,
    graphs: BTreeSet<Vec<u8>>,
    namespaces: BTreeSet<Vec<u8>>,
    bytes: u64,
}
impl UpgradeProjection {
    fn new() -> Self {
        Self {
            quads: BTreeSet::new(),
            graphs: BTreeSet::new(),
            namespaces: BTreeSet::new(),
            bytes: 0,
        }
    }
    fn add(
        &mut self,
        kind: u8,
        bytes: Vec<u8>,
        options: &UpgradeTransformOptions,
    ) -> Result<(), StorageError> {
        let count = self.quads.len() + self.graphs.len() + self.namespaces.len();
        let set = match kind {
            0 => &mut self.quads,
            1 => &mut self.graphs,
            _ => &mut self.namespaces,
        };
        if set.contains(&bytes) {
            return Ok(());
        }
        let total = self
            .bytes
            .checked_add(bytes.len() as u64)
            .ok_or_else(limit)?;
        if count >= options.max_entries.get() || total > options.max_projection_bytes.get() {
            return Err(limit());
        }
        set.insert(bytes);
        self.bytes = total;
        Ok(())
    }
    pub(crate) fn quad_count(&self) -> u64 {
        self.quads.len() as u64
    }
    pub(crate) fn graph_count(&self) -> u64 {
        self.graphs.len() as u64
    }
    pub(crate) fn namespace_count(&self) -> u64 {
        self.namespaces.len() as u64
    }
    pub(crate) fn fingerprint(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(b"oxigraph.upgrade-logical.v1\0");
        for set in [&self.quads, &self.graphs, &self.namespaces] {
            hash.update((set.len() as u64).to_be_bytes());
            for value in set {
                hash.update((value.len() as u64).to_be_bytes());
                hash.update(value);
            }
        }
        hash.finalize().into()
    }
}
fn limit() -> StorageError {
    StorageError::Other("upgrade logical projection limit exceeded".into())
}
fn controlled(options: &UpgradeTransformOptions, started: Instant) -> Result<(), StorageError> {
    if options.backup.control.is_cancelled() {
        return Err(StorageError::Other("upgrade cancelled".into()));
    }
    if options
        .backup
        .control
        .timeout()
        .is_some_and(|v| started.elapsed() >= v)
    {
        return Err(StorageError::Other("upgrade deadline elapsed".into()));
    }
    Ok(())
}
#[cfg(test)]
pub(super) fn exit_test_process_at_owned_sst() {
    if std::env::var_os("OXIGRAPH_RECOVERY_TEST_EXIT_AT_NATIVE_SST").is_some() {
        std::process::exit(73);
    }
}

fn native_options(options: &UpgradeTransformOptions) -> DbOptions {
    let options: super::super::StorageOptions = options.backup.store_options.clone().into();
    DbOptions {
        max_open_files: options.max_open_files,
        fd_reserve: options.fd_reserve,
    }
}
struct Lookup<'a> {
    reader: &'a Reader<'static>,
    strings: ColumnFamily,
}
impl StrLookup for Lookup<'_> {
    fn get_str(&self, key: &StrHash) -> Result<Option<OxString>, StorageError> {
        self.reader
            .get(&self.strings, &key.to_be_bytes())?
            .map(|v| {
                str::from_utf8(&v)
                    .map(OxString::new_owned)
                    .map_err(|e| CorruptionError::new(e).into())
            })
            .transpose()
    }
}
fn graph_name(lookup: &impl Decoder, encoded: &EncodedTerm) -> Result<GraphName, StorageError> {
    if encoded.is_default_graph() {
        Ok(GraphName::DefaultGraph)
    } else {
        Ok(lookup.decode_named_or_blank_node(encoded)?.into())
    }
}

// Independent read-only oracle. It does not invoke the mutation worker or its iterator.
#[cfg(feature = "rdf-12")]
fn project_reifier(
    encoded: &EncodedTerm,
    graph: &GraphName,
    lookup: &impl Decoder,
    output: &mut UpgradeProjection,
    options: &UpgradeTransformOptions,
    started: Instant,
    depth: usize,
) -> Result<Term, StorageError> {
    controlled(options, started)?;
    let EncodedTerm::Triple(triple) = encoded else {
        return lookup.decode_term(encoded);
    };
    if depth >= 128 {
        return Err(limit());
    }
    let subject = project_reifier(
        &triple.subject,
        graph,
        lookup,
        output,
        options,
        started,
        depth + 1,
    )?;
    let subject = match subject {
        Term::NamedNode(v) => NamedOrBlankNode::NamedNode(v),
        Term::BlankNode(v) => NamedOrBlankNode::BlankNode(v),
        _ => return Err(StorageError::SchemaUnknown),
    };
    let object = project_reifier(
        &triple.object,
        graph,
        lookup,
        output,
        options,
        started,
        depth + 1,
    )?;
    let triple = Triple::new(
        subject,
        lookup.decode_named_node(&triple.predicate)?,
        object,
    );
    let mut hasher = SipHasher24::new();
    triple.hash(&mut hasher);
    let node = BlankNode::new_from_unique_id(hasher.finish128().as_u128());
    output.add(
        0,
        Quad::new(node.clone(), rdf::REIFIES, triple, graph.clone())
            .to_string()
            .into_bytes(),
        options,
    )?;
    Ok(node.into())
}

// Inspect recursive tags iteratively before any general decoder can recurse.
// 48/49 are the legacy/current triple wire tags in binary_encoder.rs. Leaf
// decoding still uses that module, so its fixed-width formats are not copied.
fn bounded_key(
    mut key: &[u8],
    terms: usize,
    options: &UpgradeTransformOptions,
    started: Instant,
) -> Result<(), StorageError> {
    use crate::storage::binary_encoder::TermReader;
    if key.len() as u64 > options.max_projection_bytes.get() {
        return Err(limit());
    }
    let mut pending = vec![terms];
    while let Some(remaining) = pending.last_mut() {
        controlled(options, started)?;
        if *remaining == 0 {
            pending.pop();
            continue;
        }
        *remaining -= 1;
        if matches!(key.first(), Some(48 | 49)) {
            if pending.len() > 128 {
                return Err(limit());
            }
            key = &key[1..];
            pending.push(3);
        } else {
            // Only a non-triple tag reaches read_term: no recursive descent.
            key.read_term()?;
        }
    }
    if !key.is_empty() {
        return Err(StorageError::SchemaUnknown);
    }
    Ok(())
}

fn preflight_keys(
    db: &Db,
    version: u64,
    options: &UpgradeTransformOptions,
    started: Instant,
) -> Result<(), StorageError> {
    let reader = db.snapshot();
    // Include secondary indexes: the legacy mutation iterator and validate()
    // read them too, even when their malformed key is absent from a primary.
    for (family, terms) in [
        (DSPO_CF, 3),
        (DPOS_CF, 3),
        (DOSP_CF, 3),
        (SPOG_CF, 4),
        (POSG_CF, 4),
        (OSPG_CF, 4),
        (GSPO_CF, 4),
        (GPOS_CF, 4),
        (GOSP_CF, 4),
        (GRAPHS_CF, 1),
    ] {
        if version == 0 && family == GRAPHS_CF {
            continue;
        }
        let mut iter = reader.iter(&db.column_family(family)?);
        while let Some(key) = iter.key() {
            bounded_key(key, terms, options, started)?;
            iter.next();
        }
        iter.status()?;
    }
    Ok(())
}

fn project(
    db: &Db,
    version: u64,
    legacy: bool,
    options: &UpgradeTransformOptions,
    started: Instant,
) -> Result<UpgradeProjection, StorageError> {
    controlled(options, started)?;
    preflight_keys(db, version, options, started)?;
    let reader = db.snapshot();
    let lookup = Lookup {
        reader: &reader,
        strings: db.column_family(ID2STR_CF)?,
    };
    let mut out = UpgradeProjection::new();
    for (name, encoding) in [(DSPO_CF, QuadEncoding::Dspo), (GSPO_CF, QuadEncoding::Gspo)] {
        let mut iter = reader.iter(&db.column_family(name)?);
        while let Some(key) = iter.key() {
            controlled(options, started)?;
            let encoded = encoding.decode(key)?;
            if !legacy {
                let mut normalized = Vec::new();
                if name == DSPO_CF {
                    write_spo_quad(&mut normalized, &encoded);
                } else {
                    write_gspo_quad(&mut normalized, &encoded);
                }
                if normalized != key {
                    return Err(StorageError::Other(
                        "transformed store retains non-current quad encoding".into(),
                    ));
                }
            }
            let graph = graph_name(&lookup, &encoded.graph_name)?;
            if version == 0 && !graph.is_default_graph() {
                out.add(1, graph.to_string().into_bytes(), options)?;
            }
            let quad = if legacy {
                #[cfg(feature = "rdf-12")]
                {
                    let subject = project_reifier(
                        &encoded.subject,
                        &graph,
                        &lookup,
                        &mut out,
                        options,
                        started,
                        0,
                    )?;
                    let subject = match subject {
                        Term::NamedNode(v) => NamedOrBlankNode::NamedNode(v),
                        Term::BlankNode(v) => NamedOrBlankNode::BlankNode(v),
                        _ => return Err(StorageError::SchemaUnknown),
                    };
                    let object = project_reifier(
                        &encoded.object,
                        &graph,
                        &lookup,
                        &mut out,
                        options,
                        started,
                        0,
                    )?;
                    Quad::new(
                        subject,
                        lookup.decode_named_node(&encoded.predicate)?,
                        object,
                        graph,
                    )
                }
                #[cfg(not(feature = "rdf-12"))]
                {
                    lookup.decode_quad(&encoded)?
                }
            } else {
                lookup.decode_quad(&encoded)?
            };
            out.add(0, quad.to_string().into_bytes(), options)?;
            iter.next();
        }
        iter.status()?;
    }
    if version != 0 {
        let mut iter = reader.iter(&db.column_family(GRAPHS_CF)?);
        while let Some(key) = iter.key() {
            controlled(options, started)?;
            let term = decode_term(key)?;
            if term.is_default_graph() {
                return Err(StorageError::SchemaUnknown);
            }
            out.add(
                1,
                lookup
                    .decode_named_or_blank_node(&term)?
                    .to_string()
                    .into_bytes(),
                options,
            )?;
            iter.next();
        }
        iter.status()?;
    }
    let default = db.column_family(DEFAULT_CF)?;
    let mut namespaces_present = false;
    let mut namespace_schema = false;
    let mut iter = reader.iter(&default);
    while let Some(key) = iter.key() {
        controlled(options, started)?;
        let value = iter.value().ok_or(StorageError::SchemaUnknown)?;
        if key == b"oxversion" {
            if value != version.to_be_bytes() {
                return Err(StorageError::SchemaUnknown);
            }
        } else if key == NAMESPACE_SCHEMA_KEY {
            if value != NAMESPACE_SCHEMA_V1 {
                return Err(StorageError::SchemaUnknown);
            }
            namespace_schema = true;
        } else if let Some(prefix) = key.strip_prefix(NAMESPACE_MAPPING_KEY_PREFIX) {
            namespaces_present = true;
            let prefix = NamespacePrefix::new(
                str::from_utf8(prefix)
                    .map_err(CorruptionError::new)?
                    .to_owned(),
            )
            .map_err(CorruptionError::new)?;
            let (&version, iri) = value.split_first().ok_or(StorageError::SchemaUnknown)?;
            if version != NAMESPACE_RECORD_VERSION {
                return Err(StorageError::SchemaUnknown);
            }
            let iri = NamedNode::new(
                str::from_utf8(iri)
                    .map_err(CorruptionError::new)?
                    .to_owned(),
            )
            .map_err(CorruptionError::new)?;
            let mut bytes = (prefix.as_str().len() as u64).to_be_bytes().to_vec();
            bytes.extend_from_slice(prefix.as_str().as_bytes());
            bytes.extend_from_slice(&(iri.as_str().len() as u64).to_be_bytes());
            bytes.extend_from_slice(iri.as_str().as_bytes());
            out.add(2, bytes, options)?;
        } else {
            // Initial legacy profile never invents governed identity, outcomes or outbox.
            return Err(StorageError::Other(
                "upgrade profile does not support this default-column metadata".into(),
            ));
        }
        iter.next();
    }
    iter.status()?;
    if namespaces_present && !namespace_schema {
        return Err(StorageError::SchemaUnknown);
    }
    controlled(options, started)?;
    Ok(out)
}

/// Keeps the original native lock alive after all output database handles close.
pub(crate) struct TransformedStorage {
    _lease: Arc<OpenLease>,
    projection: UpgradeProjection,
}
impl TransformedStorage {
    pub(crate) fn projection(&self) -> &UpgradeProjection {
        &self.projection
    }
}
impl LegacyStoreSnapshot {
    pub(crate) fn project_upgrade(
        &self,
        options: &UpgradeTransformOptions,
        started: Instant,
    ) -> Result<UpgradeProjection, StorageError> {
        let families = RocksDbStorage::column_families()
            .into_iter()
            .filter(|cf| self.version != 0 || cf.name != GRAPHS_CF)
            .collect();
        let db = Db::open_read_only_with_options(&self._path, families, native_options(options))?;
        project(&db, self.version, true, options, started)
    }
    pub(crate) fn transform_upgrade_edge(
        self,
        target: u64,
        expected: &UpgradeProjection,
        options: &UpgradeTransformOptions,
        started: Instant,
        mut phase: impl FnMut(u64) -> Result<(), StorageError>,
    ) -> Result<TransformedStorage, StorageError> {
        let Self {
            _db,
            _lease,
            _path,
            version,
            ..
        } = self;
        if target != version + 1 || target > LATEST_STORAGE_VERSION {
            return Err(StorageError::SchemaUnknown);
        }
        controlled(options, started)?;
        phase(version)?;
        drop(_db);
        let db = Db::open_read_write_with_lease(
            &_path,
            RocksDbStorage::column_families(),
            native_options(options),
            Arc::clone(&_lease),
        )?;
        let storage = RocksDbStorage::setup_unmigrated(db)?;
        storage.migrate_versioned_to(version, target, &mut |edge| {
            controlled(options, started)?;
            phase(edge)
        })?;
        controlled(options, started)?;
        let observed = project(
            &storage.db,
            target,
            target != LATEST_STORAGE_VERSION,
            options,
            started,
        )?;
        if target == LATEST_STORAGE_VERSION {
            storage.snapshot().validate()?;
        }
        if &observed != expected {
            return Err(StorageError::Other(
                "upgrade logical projection mismatch".into(),
            ));
        }
        storage.flush()?;
        controlled(options, started)?;
        drop(storage);
        Ok(TransformedStorage {
            _lease,
            projection: observed,
        })
    }

    pub(crate) fn verify_upgrade_checkpoint(
        path: &Path,
        version: u64,
        expected: &UpgradeProjection,
        options: &UpgradeTransformOptions,
        started: Instant,
    ) -> Result<TransformedStorage, StorageError> {
        if version == LATEST_STORAGE_VERSION {
            return Self::verify_transformed(path, expected.fingerprint(), options, started);
        }
        let snapshot =
            LegacyStoreSnapshot::open(path, options.backup.store_options.clone().into())?;
        if snapshot.version != version {
            return Err(StorageError::SchemaUnknown);
        }
        let projection = snapshot.project_upgrade(options, started)?;
        if &projection != expected {
            return Err(StorageError::Other(
                "upgrade logical projection mismatch".into(),
            ));
        }
        let Self { _db, _lease, .. } = snapshot;
        drop(_db);
        Ok(TransformedStorage { _lease, projection })
    }

    pub(crate) fn transform_upgrade(
        self,
        expected: &UpgradeProjection,
        options: &UpgradeTransformOptions,
        started: Instant,
        mut phase: impl FnMut(u64) -> Result<(), StorageError>,
    ) -> Result<TransformedStorage, StorageError> {
        let Self {
            _db,
            _lease,
            _path,
            version,
            ..
        } = self;
        controlled(options, started)?;
        // Before writable open: opening v0 creates the missing graphs family.
        phase(version)?;
        drop(_db);
        let db = Db::open_read_write_with_lease(
            &_path,
            RocksDbStorage::column_families(),
            native_options(options),
            Arc::clone(&_lease),
        )?;
        let storage = RocksDbStorage::setup_unmigrated(db)?;
        storage.migrate_versioned(version, &mut |edge| {
            controlled(options, started)?;
            phase(edge)
        })?;
        controlled(options, started)?;
        phase(2)?;
        let observed = project(&storage.db, LATEST_STORAGE_VERSION, false, options, started)?;
        storage.snapshot().validate()?;
        if &observed != expected {
            return Err(StorageError::Other(
                "upgrade logical projection mismatch".into(),
            ));
        }
        storage.flush()?;
        controlled(options, started)?;
        drop(storage);
        Ok(TransformedStorage {
            _lease,
            projection: observed,
        })
    }
    pub(crate) fn verify_transformed(
        path: &Path,
        expected_fingerprint: [u8; 32],
        options: &UpgradeTransformOptions,
        started: Instant,
    ) -> Result<TransformedStorage, StorageError> {
        let lease = Arc::new(OpenLease::acquire_existing(path)?);
        let observed = RocksDbStorage::inspect_with_options(path, native_options(options))?;
        if observed.storage_version() != Some(2)
            || !observed.missing_column_families().is_empty()
            || !observed.unexpected_column_families().is_empty()
        {
            return Err(StorageError::SchemaUnknown);
        }
        let db = Db::open_read_only_with_options(
            path,
            RocksDbStorage::column_families(),
            native_options(options),
        )?;
        let storage = RocksDbStorage::setup_unmigrated(db)?;
        let projection = project(&storage.db, 2, false, options, started)?;
        storage.snapshot().validate()?;
        if projection.fingerprint() != expected_fingerprint {
            return Err(StorageError::Other(
                "upgrade logical projection mismatch".into(),
            ));
        }
        drop(storage);
        Ok(TransformedStorage {
            _lease: lease,
            projection,
        })
    }
}

#[cfg(test)]
impl LegacyStoreSnapshot {
    pub(crate) fn upgrade_lease_available(path: &Path) -> bool {
        OpenLease::acquire_existing(path).is_ok()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::store::{Store, TransformedUpgrade, UpgradeRecoveryOptions};
    type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

    fn assert_transformed(
        source: &Path,
        parent: &Path,
        quads: BTreeSet<String>,
        graphs: BTreeSet<String>,
        namespaces: Vec<Namespace>,
    ) -> Result {
        let package = parent.join("backup");
        let prepared = parent.join("prepared");
        let options = UpgradeTransformOptions::default();
        Store::backup_legacy(source, &package, &options.backup)?;
        Store::prepare_upgrade(source, &package, &prepared, &options.backup)?;
        let transformed = Store::transform_prepared_upgrade(source, &package, &prepared, &options)?;
        assert_eq!(transformed.quad_count(), quads.len() as u64);
        assert_eq!(transformed.named_graph_count(), graphs.len() as u64);
        assert_eq!(transformed.namespace_count(), namespaces.len() as u64);
        assert_eq!(
            transformed,
            TransformedUpgrade::verify(source, &package, &prepared, &options)?
        );
        // Test-only native read of the inactive result. Do not remove its guard.
        let db = Db::open_read_only(&prepared.join("store"), RocksDbStorage::column_families())?;
        let storage = RocksDbStorage::setup_unmigrated(db)?;
        let reader = storage.snapshot();
        let actual = reader
            .quads()
            .map(|quad| reader.decode_quad(&quad?).map(|quad| quad.to_string()))
            .collect::<std::result::Result<BTreeSet<_>, StorageError>>()?;
        assert_eq!(actual, quads);
        let actual = reader
            .named_graphs()
            .map(|graph| {
                reader
                    .decode_named_or_blank_node(&graph?)
                    .map(|graph| graph.to_string())
            })
            .collect::<std::result::Result<BTreeSet<_>, StorageError>>()?;
        assert_eq!(actual, graphs);
        assert_eq!(reader.namespaces()?, namespaces);

        let recovery_backup = parent.join("recovery-backup");
        let recovery_directory = parent.join("recovery-workspace");
        let recovery_options = UpgradeRecoveryOptions::default();
        Store::backup_legacy(source, &recovery_backup, &recovery_options.transform.backup)?;
        Store::start_upgrade_recovery(
            source,
            &recovery_backup,
            &recovery_directory,
            &recovery_options,
        )?;
        let recovery = Store::resume_upgrade_recovery(
            source,
            &recovery_backup,
            &recovery_directory,
            &recovery_options,
        )?;
        assert!(recovery.completed());
        assert_eq!(recovery.quad_count(), quads.len() as u64);
        assert_eq!(recovery.named_graph_count(), graphs.len() as u64);
        assert_eq!(recovery.namespace_count(), namespaces.len() as u64);
        assert_eq!(
            recovery,
            crate::store::UpgradeRecovery::verify(
                source,
                &recovery_backup,
                &recovery_directory,
                &recovery_options,
            )?
        );
        let output = recovery
            .transformed()
            .ok_or_else(|| io::Error::other("recovery output missing"))?
            .directory();
        let db = Db::open_read_only(&output.join("store"), RocksDbStorage::column_families())?;
        let storage = RocksDbStorage::setup_unmigrated(db)?;
        let reader = storage.snapshot();
        let actual = reader
            .quads()
            .map(|quad| reader.decode_quad(&quad?).map(|quad| quad.to_string()))
            .collect::<std::result::Result<BTreeSet<_>, StorageError>>()?;
        assert_eq!(actual, quads);
        let actual = reader
            .named_graphs()
            .map(|graph| {
                reader
                    .decode_named_or_blank_node(&graph?)
                    .map(|graph| graph.to_string())
            })
            .collect::<std::result::Result<BTreeSet<_>, StorageError>>()?;
        assert_eq!(actual, graphs);
        assert_eq!(reader.namespaces()?, namespaces);
        Ok(())
    }

    #[test]
    fn upgrade_v1_preserves_empty_graph_and_namespace() -> Result {
        let parent = tempfile::tempdir()?;
        let source = parent.path().join("source");
        let graph = NamedNode::new("urn:upgrade:graph")?;
        let empty = NamedNode::new("urn:upgrade:empty")?;
        let namespace =
            Namespace::new(NamespacePrefix::new("ex")?, NamedNode::new("urn:upgrade:")?);
        let quad = Quad::new(
            NamedNode::new("urn:upgrade:s")?,
            NamedNode::new("urn:upgrade:p")?,
            NamedNode::new("urn:upgrade:o")?,
            graph.clone(),
        );
        {
            let storage = RocksDbStorage::open(&source)?;
            let mut transaction = storage.start_transaction()?;
            transaction.insert(quad.clone());
            transaction.insert_named_graph(empty.clone().into());
            transaction.set_namespace(namespace.clone());
            transaction.commit()?;
            storage.update_version(1)?;
        }
        assert_transformed(
            &source,
            parent.path(),
            BTreeSet::from([quad.to_string()]),
            BTreeSet::from([graph.to_string(), empty.to_string()]),
            vec![namespace],
        )
    }

    #[cfg(feature = "rdf-12")]
    #[test]
    fn upgrade_nested_repeated_triples_preserve_graph_local_reification() -> Result {
        use crate::storage::numeric_encoder::EncodedTriple;
        fn legacy_term(term: &EncodedTerm, bytes: &mut Vec<u8>) {
            if let EncodedTerm::Triple(triple) = term {
                bytes.push(TYPE_STAR_TRIPLE);
                legacy_term(&triple.subject, bytes);
                legacy_term(&triple.predicate, bytes);
                legacy_term(&triple.object, bytes);
            } else {
                write_term(bytes, term);
            }
        }
        fn reifier(triple: &Triple) -> BlankNode {
            let mut hash = SipHasher24::new();
            triple.hash(&mut hash);
            BlankNode::new_from_unique_id(hash.finish128().as_u128())
        }
        let parent = tempfile::tempdir()?;
        let source = parent.path().join("source");
        let subject = NamedNode::new("urn:upgrade:s")?;
        let predicate = NamedNode::new("urn:upgrade:p")?;
        let object = NamedNode::new("urn:upgrade:o")?;
        let graph = NamedNode::new("urn:upgrade:graph")?;
        let empty = NamedNode::new("urn:upgrade:empty")?;
        let namespace =
            Namespace::new(NamespacePrefix::new("ex")?, NamedNode::new("urn:upgrade:")?);
        let inner = EncodedTerm::Triple(Arc::new(EncodedTriple::new(
            (&subject).into(),
            (&predicate).into(),
            (&object).into(),
        )));
        let outer = EncodedTerm::Triple(Arc::new(EncodedTriple::new(
            (&subject).into(),
            (&predicate).into(),
            inner.clone(),
        )));
        let p: EncodedTerm = (&predicate).into();
        let g: EncodedTerm = (&graph).into();
        {
            let storage = RocksDbStorage::open(&source)?;
            let mut transaction = storage.start_transaction()?;
            // Seed the string dictionary and named graph without leaving a quad.
            let seed = Quad::new(
                subject.clone(),
                predicate.clone(),
                object.clone(),
                graph.clone(),
            );
            transaction.insert(seed.clone());
            transaction.remove(&seed);
            transaction.insert_named_graph(empty.clone().into());
            transaction.set_namespace(namespace.clone());
            transaction.commit()?;
            // Independent v1 wire fixture, including all primary/secondary indexes.
            for (family, terms) in [
                (DSPO_CF, vec![&outer, &p, &inner]),
                (DPOS_CF, vec![&p, &inner, &outer]),
                (DOSP_CF, vec![&inner, &outer, &p]),
                (SPOG_CF, vec![&outer, &p, &inner, &g]),
                (POSG_CF, vec![&p, &inner, &outer, &g]),
                (OSPG_CF, vec![&inner, &outer, &p, &g]),
                (GSPO_CF, vec![&g, &outer, &p, &inner]),
                (GPOS_CF, vec![&g, &p, &inner, &outer]),
                (GOSP_CF, vec![&g, &inner, &outer, &p]),
            ] {
                let mut key = Vec::new();
                for term in terms {
                    legacy_term(term, &mut key);
                }
                storage
                    .db
                    .insert(&storage.db.column_family(family)?, &key, &[])?;
            }
            storage.update_version(1)?;
        }
        // Hand-constructed expected dataset, not the upgrade projection helper.
        let inner = Triple::new(subject.clone(), predicate.clone(), object);
        let inner_node = reifier(&inner);
        let outer = Triple::new(subject, predicate.clone(), inner_node.clone());
        let outer_node = reifier(&outer);
        let mut quads = BTreeSet::new();
        for name in [GraphName::DefaultGraph, graph.clone().into()] {
            quads.insert(
                Quad::new(
                    inner_node.clone(),
                    rdf::REIFIES,
                    inner.clone(),
                    name.clone(),
                )
                .to_string(),
            );
            quads.insert(
                Quad::new(
                    outer_node.clone(),
                    rdf::REIFIES,
                    outer.clone(),
                    name.clone(),
                )
                .to_string(),
            );
            quads.insert(
                Quad::new(
                    outer_node.clone(),
                    predicate.clone(),
                    inner_node.clone(),
                    name,
                )
                .to_string(),
            );
        }
        assert_transformed(
            &source,
            parent.path(),
            quads,
            BTreeSet::from([graph.to_string(), empty.to_string()]),
            vec![namespace],
        )
    }

    #[test]
    fn upgrade_deep_primary_or_secondary_key_refuses_before_mutation() -> Result {
        for family in [DSPO_CF, DOSP_CF] {
            let parent = tempfile::tempdir()?;
            let source = parent.path().join("source");
            let package = parent.path().join("backup");
            let prepared = parent.path().join("prepared");
            let options = UpgradeTransformOptions::default();
            {
                let storage = RocksDbStorage::open(&source)?;
                // A complete 2048-deep old subject/object chain; no recursive
                // Rust value is built or dropped by the fixture itself.
                let leaf = encode_term(&EncodedTerm::NumericalBlankNode { id: [7; 16] });
                let mut key = vec![TYPE_STAR_TRIPLE; 2048];
                key.extend_from_slice(&leaf);
                for _ in 0..2048 {
                    key.extend_from_slice(&leaf);
                    key.extend_from_slice(&leaf);
                }
                key.extend_from_slice(&leaf);
                key.extend_from_slice(&leaf);
                storage
                    .db
                    .insert(&storage.db.column_family(family)?, &key, &[])?;
                storage.update_version(1)?;
            }
            Store::backup_legacy(&source, &package, &options.backup)?;
            Store::prepare_upgrade(&source, &package, &prepared, &options.backup)?;
            assert!(
                Store::transform_prepared_upgrade(&source, &package, &prepared, &options).is_err()
            );
            assert!(!prepared.join(TransformedUpgrade::journal_name()).exists());
            assert!(!prepared.join(TransformedUpgrade::manifest_name()).exists());
            crate::store::PreparedUpgrade::verify(&prepared, &options.backup)?;
            crate::store::LegacyBackupReceipt::verify_ancestry(
                &source,
                &package,
                &options.backup.control,
            )?;
        }
        Ok(())
    }
}
