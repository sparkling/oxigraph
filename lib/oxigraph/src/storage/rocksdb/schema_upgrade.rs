//! Raw, leased operations for the explicit marker-only inactive upgrade.
//! Ordinary open/setup/migration remain unchanged.
use super::*;
use crate::store::{StoreOptions, StoreSchemaEnvelope};
use sha2::{Digest, Sha256};

pub(crate) struct SchemaUpgradeSnapshot {
    storage: RocksDbStorage,
    // Drop the database before its lease.
    _lease: Option<Arc<OpenLease>>,
}

impl SchemaUpgradeSnapshot {
    pub(crate) fn open(
        path: &Path,
        lease: bool,
        marker: &[u8],
        options: &StoreOptions,
    ) -> Result<Self, StorageError> {
        let lease = lease
            .then(|| OpenLease::acquire_existing(path))
            .transpose()?
            .map(Arc::new);
        let storage_options: super::super::StorageOptions = options.clone().into();
        let native = DbOptions {
            max_open_files: storage_options.max_open_files,
            fd_reserve: storage_options.fd_reserve,
        };
        let info = RocksDbStorage::inspect_with_options(path, native)?;
        if !info.missing_column_families().is_empty()
            || !info.unexpected_column_families().is_empty()
        {
            return Err(StorageError::SchemaUnknown);
        }
        let db = Db::open_read_only_with_options(path, RocksDbStorage::column_families(), native)?;
        if db
            .get(&db.column_family(DEFAULT_CF)?, b"oxversion")?
            .as_deref()
            != Some(marker)
        {
            return Err(StorageError::SchemaUnknown);
        }
        Ok(Self {
            storage: RocksDbStorage::setup_unmigrated(db)?,
            _lease: lease,
        })
    }

    /// Exact ordered key/value comparison of all families, omitting only oxversion.
    /// A domain-separated digest and counts bind the same stream in the journal.
    pub(crate) fn compare(
        &self,
        other: &Self,
        control: &TransactionStartControl,
        started: Instant,
        max_entries: u64,
        max_bytes: u64,
    ) -> Result<([u8; 32], u64, u64), StorageError> {
        let left = self.storage.db.snapshot();
        let right = other.storage.db.snapshot();
        let mut names: Vec<_> = RocksDbStorage::column_families()
            .iter()
            .map(|cf| cf.name)
            .collect();
        names.push(DEFAULT_CF);
        names.sort_unstable();
        let mut hash = Sha256::new();
        hash.update(b"oxigraph.schema-upgrade.primary.v1\0");
        let mut entries = 0_u64;
        let mut bytes = 0_u64;
        for name in names {
            hash.update((name.len() as u64).to_be_bytes());
            hash.update(name.as_bytes());
            let left_cf = self.storage.db.column_family(name)?;
            let right_cf = other.storage.db.column_family(name)?;
            let mut a = left.iter(&left_cf);
            let mut b = right.iter(&right_cf);
            loop {
                control.check(started).map_err(|_| {
                    StorageError::Other("schema upgrade cancelled or timed out".into())
                })?;
                if name == DEFAULT_CF {
                    if a.key() == Some(b"oxversion") {
                        a.next();
                    }
                    if b.key() == Some(b"oxversion") {
                        b.next();
                    }
                }
                match (a.key(), b.key()) {
                    (None, None) => break,
                    (Some(key), Some(other_key)) if key == other_key && a.value() == b.value() => {
                        let value = a.value().ok_or(StorageError::SchemaUnknown)?;
                        entries = entries
                            .checked_add(1)
                            .filter(|v| *v <= max_entries)
                            .ok_or_else(|| {
                                StorageError::Other("schema upgrade entry limit".into())
                            })?;
                        bytes = bytes
                            .checked_add(key.len() as u64)
                            .and_then(|v| v.checked_add(value.len() as u64))
                            .filter(|v| *v <= max_bytes)
                            .ok_or_else(|| {
                                StorageError::Other("schema upgrade byte limit".into())
                            })?;
                        hash.update([1]);
                        hash.update((key.len() as u64).to_be_bytes());
                        hash.update(key);
                        hash.update((value.len() as u64).to_be_bytes());
                        hash.update(value);
                        a.next();
                        b.next();
                    }
                    _ => {
                        return Err(StorageError::Other(
                            "schema upgrade primary mismatch".into(),
                        ));
                    }
                }
            }
            a.status()?;
            b.status()?;
            hash.update([0]);
        }
        Ok((hash.finalize().into(), entries, bytes))
    }

    pub(crate) fn validate_metadata(
        &self,
        control: &TransactionStartControl,
        started: Instant,
    ) -> Result<(), StorageError> {
        self.storage.snapshot().visit_namespaces(&mut |_| Ok(()))?;
        let reader = self.storage.db.snapshot();
        let mut iter = reader.iter(&self.storage.default_cf);
        while let Some(key) = iter.key() {
            control
                .check(started)
                .map_err(|_| StorageError::Other("schema upgrade cancelled or timed out".into()))?;
            if key == b"oxversion"
                || key == NAMESPACE_SCHEMA_KEY
                || key.starts_with(NAMESPACE_MAPPING_KEY_PREFIX)
            {
                // Exact marker is checked by open; namespace values above.
            } else if key == GOVERNANCE_STATE_KEY {
                GovernanceState::decode(iter.value().ok_or(StorageError::SchemaUnknown)?)?;
            } else if let Some(suffix) = key
                .strip_prefix(TRANSACTION_OUTCOME_KEY_PREFIX)
                .or_else(|| key.strip_prefix(GOVERNED_OUTCOME_KEY_PREFIX))
            {
                let transaction_key: &[u8; 16] =
                    suffix.try_into().map_err(|_| StorageError::SchemaUnknown)?;
                self.storage.lookup_commit_receipt(transaction_key)?;
            } else if let Some(suffix) = key.strip_prefix(OUTBOX_RECORD_PREFIX) {
                let position =
                    u64::from_be_bytes(suffix.try_into().map_err(|_| StorageError::SchemaUnknown)?);
                if position == 0 {
                    return Err(StorageError::SchemaUnknown);
                }
                // Entire physically retained history is checked by the existing
                // feature inspector before the source can be admitted.
            } else {
                return Err(StorageError::SchemaUnknown);
            }
            iter.next();
        }
        iter.status()
    }

    /// Only called for a fresh guarded copy already compared with the input.
    pub(crate) fn write_envelope(
        path: &Path,
        envelope: &StoreSchemaEnvelope,
        options: &StoreOptions,
    ) -> Result<(), StorageError> {
        if !path.join(crate::store::upgrade::UPGRADE_GUARD).is_file() {
            return Err(StorageError::SchemaUnknown);
        }
        let storage_options: super::super::StorageOptions = options.clone().into();
        let observed = RocksDbStorage::inspect(path)?;
        if observed.storage_version() != Some(2)
            || !observed.missing_column_families().is_empty()
            || !observed.unexpected_column_families().is_empty()
        {
            return Err(StorageError::SchemaUnknown);
        }
        let db = Db::open_read_write(
            path,
            RocksDbStorage::column_families(),
            DbOptions {
                max_open_files: storage_options.max_open_files,
                fd_reserve: storage_options.fd_reserve,
            },
        )?;
        let default = db.column_family(DEFAULT_CF)?;
        if db.get(&default, b"oxversion")?.as_deref() != Some(2_u64.to_be_bytes().as_slice()) {
            return Err(StorageError::SchemaUnknown);
        }
        db.insert(&default, b"oxversion", &envelope.encode())?;
        db.flush()
    }
}

#[cfg(test)]
impl SchemaUpgradeSnapshot {
    pub(crate) fn put_for_test(path: &Path, key: &[u8], value: &[u8]) -> Result<(), StorageError> {
        let db = Db::open_read_write(
            path,
            RocksDbStorage::column_families(),
            DbOptions::default(),
        )?;
        db.insert(&db.column_family(DEFAULT_CF)?, key, value)?;
        db.flush()
    }
}
