#[cfg(feature = "rdf-12")]
use crate::model::vocab::rdf;
#[cfg(feature = "rdf-12")]
use crate::model::{BlankNode, Triple};
use crate::model::{GraphName, NamedNode, NamedOrBlankNode, Quad, Term};
#[cfg(test)]
use crate::storage::TransactionOutcomeFaultPoint;
use crate::storage::binary_encoder::{
    QuadEncoding, TYPE_STAR_TRIPLE, WRITTEN_TERM_MAX_SIZE, decode_term, encode_term,
    encode_term_pair, encode_term_quad, encode_term_triple, write_gosp_quad, write_gpos_quad,
    write_gspo_quad, write_osp_quad, write_ospg_quad, write_pos_quad, write_posg_quad,
    write_spo_quad, write_spog_quad, write_term,
};
pub use crate::storage::error::{CorruptionError, StorageError};
use crate::storage::numeric_encoder::{
    Decoder, EncodedQuad, EncodedTerm, StrHash, StrHashHasher, StrLookup, insert_term,
};
use crate::storage::rocksdb_wrapper::{
    ColumnFamily, ColumnFamilyDefinition, Db, DbOptions, Iter, ReadableTransaction, Reader,
    Transaction,
};
use crate::storage::{DEFAULT_BULK_LOAD_BATCH_SIZE, map_thread_result};
use crate::storage::{
    StorageTransactionOutcome, StorageTransactionStartError, TransactionStartControl,
};
use crate::store::receipt::GovernanceState;
use crate::store::{
    CommitReceipt, CommitReceiptOutcome, Namespace, NamespacePrefix, SemanticChangeSet,
    TransactionCommitError, TransactionKey, TransactionNonCommitReason,
};
use oxstr::OxString;
use rustc_hash::{FxBuildHasher, FxHashSet};
#[cfg(feature = "rdf-12")]
use siphasher::sip128::{Hasher128, SipHasher24};
use spareval::CancellationToken;
use std::collections::{HashMap, VecDeque};
use std::fs::remove_file;
use std::hash::BuildHasherDefault;
#[cfg(feature = "rdf-12")]
use std::hash::Hash;
use std::mem::take;
use std::ops::{Deref, DerefMut};
use std::path::{Path, PathBuf};
use std::str::Utf8Error;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;
use std::{io, thread};

const BATCH_SIZE: usize = 100_000;
const LATEST_STORAGE_VERSION: u64 = 2;
const ID2STR_CF: &str = "id2str";
const SPOG_CF: &str = "spog";
const POSG_CF: &str = "posg";
const OSPG_CF: &str = "ospg";
const GSPO_CF: &str = "gspo";
const GPOS_CF: &str = "gpos";
const GOSP_CF: &str = "gosp";
const DSPO_CF: &str = "dspo";
const DPOS_CF: &str = "dpos";
const DOSP_CF: &str = "dosp";
const GRAPHS_CF: &str = "graphs";
const DEFAULT_CF: &str = "default";
// Reserved default-CF key: versioned prefix followed by the caller's 16-byte key.
// Record bytes are `[format version, state]`; unknown versions or states are corruption.
const TRANSACTION_OUTCOME_KEY_PREFIX: &[u8] = b"\0oxigraph.transaction-outcome.v1\0";
const TRANSACTION_OUTCOME_STAGING: &[u8] = &[1, 0];
const TRANSACTION_OUTCOME_COMMIT_ATTEMPTED: &[u8] = &[1, 1];
const TRANSACTION_OUTCOME_COMMITTED: &[u8] = &[1, 2];
const TRANSACTION_OUTCOME_ROLLED_BACK: &[u8] = &[1, 3];
// Governed commits require an embedded receipt: a missing receipt is never
// mistaken for a legitimate v1 commit. Both namespaces reserve the same key space.
const GOVERNED_OUTCOME_KEY_PREFIX: &[u8] = b"\0oxigraph.transaction-outcome.v2\0";
const GOVERNED_OUTCOME_STAGING: &[u8] = &[2, 0];
const GOVERNED_OUTCOME_COMMIT_ATTEMPTED: &[u8] = &[2, 1];
const GOVERNED_OUTCOME_COMMITTED: &[u8] = &[2, 2];
const GOVERNED_OUTCOME_ROLLED_BACK: &[u8] = &[2, 3];
const GOVERNANCE_STATE_KEY: &[u8] = b"\0oxigraph.governance.v1\0";
const OUTBOX_RECORD_PREFIX: &[u8] = b"\0oxigraph.outbox.record.v1\0";

fn outbox_record_key(position: u64) -> Vec<u8> {
    let mut key = OUTBOX_RECORD_PREFIX.to_vec();
    key.extend_from_slice(&position.to_be_bytes());
    key
}
const NAMESPACE_KEY_PREFIX: &[u8] = b"\0oxigraph.namespace.";
const NAMESPACE_SCHEMA_KEY: &[u8] = b"\0oxigraph.namespace.schema\0";
const NAMESPACE_MAPPING_KEY_PREFIX: &[u8] = b"\0oxigraph.namespace.mapping.v1\0";
const NAMESPACE_MAPPING_KEY_UPPER_BOUND: &[u8] = b"\0oxigraph.namespace.mapping.v1\x01";
const NAMESPACE_SCHEMA_V1: &[u8] = &[1];
const NAMESPACE_RECORD_VERSION: u8 = 1;

#[derive(Clone, Copy, Debug, Default)]
pub struct RocksDbStorageOptions {
    pub max_open_files: Option<i32>,
    pub fd_reserve: Option<u32>,
}

impl From<RocksDbStorageOptions> for DbOptions {
    fn from(value: RocksDbStorageOptions) -> Self {
        Self {
            max_open_files: value.max_open_files,
            fd_reserve: value.fd_reserve,
        }
    }
}

/// Low level storage primitives
#[derive(Clone)]
pub struct RocksDbStorage {
    db: Db,
    default_cf: ColumnFamily,
    id2str_cf: ColumnFamily,
    spog_cf: ColumnFamily,
    posg_cf: ColumnFamily,
    ospg_cf: ColumnFamily,
    gspo_cf: ColumnFamily,
    gpos_cf: ColumnFamily,
    gosp_cf: ColumnFamily,
    dspo_cf: ColumnFamily,
    dpos_cf: ColumnFamily,
    dosp_cf: ColumnFamily,
    graphs_cf: ColumnFamily,
}

impl RocksDbStorage {
    #[cfg(test)]
    pub(crate) fn corrupt_readiness_fixture(&self, field: u8) -> Result<(), StorageError> {
        match field {
            0 => self.db.insert(&self.default_cf, b"oxversion", &[9]),
            1 => self.db.insert(&self.default_cf, GOVERNANCE_STATE_KEY, &[9]),
            2 => self.db.insert(&self.dspo_cf, &[0], &[]),
            _ => Err(StorageError::Other("unknown readiness fixture".into())),
        }
    }
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        Self::open_with_options(path, RocksDbStorageOptions::default())
    }

    pub fn open_with_options(
        path: &Path,
        options: RocksDbStorageOptions,
    ) -> Result<Self, StorageError> {
        Self::setup(Db::open_read_write(
            path,
            Self::column_families(),
            options.into(),
        )?)
    }

    pub fn open_read_only(path: &Path) -> Result<Self, StorageError> {
        Self::setup(Db::open_read_only(path, Self::column_families())?)
    }

    fn column_families() -> Vec<ColumnFamilyDefinition> {
        vec![
            ColumnFamilyDefinition {
                name: ID2STR_CF,
                use_iter: false,
                min_prefix_size: 0,
                unordered_writes: true,
            },
            ColumnFamilyDefinition {
                name: SPOG_CF,
                use_iter: true,
                min_prefix_size: 17, // named or blank node start
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: POSG_CF,
                use_iter: true,
                min_prefix_size: 17, // named node start
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: OSPG_CF,
                use_iter: true,
                min_prefix_size: 0, // There are small literals...
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: GSPO_CF,
                use_iter: true,
                min_prefix_size: 17, // named or blank node start
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: GPOS_CF,
                use_iter: true,
                min_prefix_size: 17, // named or blank node start
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: GOSP_CF,
                use_iter: true,
                min_prefix_size: 17, // named or blank node start
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: DSPO_CF,
                use_iter: true,
                min_prefix_size: 17, // named or blank node start
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: DPOS_CF,
                use_iter: true,
                min_prefix_size: 17, // named or blank node start
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: DOSP_CF,
                use_iter: true,
                min_prefix_size: 0, // There are small literals...
                unordered_writes: false,
            },
            ColumnFamilyDefinition {
                name: GRAPHS_CF,
                use_iter: true,
                min_prefix_size: 17, // named or blank node start
                unordered_writes: false,
            },
        ]
    }

    fn setup(db: Db) -> Result<Self, StorageError> {
        let this = Self {
            default_cf: db.column_family(DEFAULT_CF)?,
            id2str_cf: db.column_family(ID2STR_CF)?,
            spog_cf: db.column_family(SPOG_CF)?,
            posg_cf: db.column_family(POSG_CF)?,
            ospg_cf: db.column_family(OSPG_CF)?,
            gspo_cf: db.column_family(GSPO_CF)?,
            gpos_cf: db.column_family(GPOS_CF)?,
            gosp_cf: db.column_family(GOSP_CF)?,
            dspo_cf: db.column_family(DSPO_CF)?,
            dpos_cf: db.column_family(DPOS_CF)?,
            dosp_cf: db.column_family(DOSP_CF)?,
            graphs_cf: db.column_family(GRAPHS_CF)?,
            db,
        };
        this.migrate()?;
        this.snapshot().namespaces()?;
        Ok(this)
    }

    fn migrate(&self) -> Result<(), StorageError> {
        let mut version = self.ensure_version()?;
        if version == 0 {
            // We migrate to v1
            if !self.db.is_writable() {
                return Err(StorageError::Other(
                    "It is not possible to upgrade read-only Oxigraph instances to newer Oxigraph versions, please open in read-write regular mode to upgrade.".into(),
                ));
            }
            let mut graph_names = FxHashSet::default();
            for quad in self.snapshot().quads() {
                let quad = quad?;
                if !quad.graph_name.is_default_graph() {
                    graph_names.insert(quad.graph_name);
                }
            }
            let mut graph_names = graph_names
                .into_iter()
                .map(|g| encode_term(&g))
                .collect::<Vec<_>>();
            graph_names.sort_unstable();
            let mut stt_file = self.db.new_sst_file()?;
            for k in graph_names {
                stt_file.insert_empty(&k)?;
            }
            self.db
                .insert_stt_files(&[(self.graphs_cf.clone(), stt_file.finish()?)])?;
            version = 1;
            self.update_version(version)?;
        }
        if version == 1 {
            // We migrate to v2
            #[cfg(feature = "rdf-12")]
            fn to_rdf12_reified_triple(
                subject: &EncodedTerm,
                predicate: &EncodedTerm,
                object: &EncodedTerm,
                graph_name: &EncodedTerm,
                r: &RocksDbStorageReader<'_>,
                w: &mut RocksDbStorageTransaction<'_>,
            ) -> Result<EncodedTerm, StorageError> {
                let subject = if let EncodedTerm::Triple(t) = subject {
                    to_rdf12_reified_triple(&t.subject, &t.predicate, &t.object, graph_name, r, w)?
                } else {
                    subject.clone()
                };
                let object = if let EncodedTerm::Triple(t) = object {
                    to_rdf12_reified_triple(&t.subject, &t.predicate, &t.object, graph_name, r, w)?
                } else {
                    object.clone()
                };
                // We hash the triple
                let triple = Triple::new(
                    r.decode_named_or_blank_node(&subject)?,
                    r.decode_named_node(predicate)?,
                    r.decode_term(&object)?,
                );
                let mut hasher = SipHasher24::new();
                triple.hash(&mut hasher);
                let reifier = BlankNode::new_from_unique_id(hasher.finish128().as_u128());
                let encoded_reifier = (&reifier).into();
                w.insert(Quad::new(
                    reifier,
                    rdf::REIFIES,
                    triple,
                    if *graph_name == EncodedTerm::DefaultGraph {
                        GraphName::DefaultGraph
                    } else {
                        r.decode_named_or_blank_node(graph_name)?.into()
                    },
                ));
                Ok(encoded_reifier)
            }

            if !self.db.is_writable() {
                return Err(StorageError::Other(
                    "It is not possible to upgrade read-only Oxigraph instances to newer Oxigraph versions, please open in read-write regular mode to upgrade.".into(),
                ));
            }
            let snapshot = self.snapshot();
            #[cfg_attr(not(feature = "rdf-12"), expect(clippy::never_loop))]
            for quad in snapshot
                .dspo_quads(&[TYPE_STAR_TRIPLE])
                .chain(snapshot.spog_quads(&[TYPE_STAR_TRIPLE]))
                .chain(snapshot.dosp_quads(&[TYPE_STAR_TRIPLE]))
                .chain(snapshot.ospg_quads(&[TYPE_STAR_TRIPLE]))
            {
                #[cfg_attr(not(feature = "rdf-12"), expect(unused_variables))]
                let quad = quad?;
                #[cfg(not(feature = "rdf-12"))]
                return Err(CorruptionError::msg(
                    "You need to enable the rdf-12 Cargo feature to read a database with triple terms",
                ).into());

                #[cfg(feature = "rdf-12")]
                {
                    let mut w = self.start_transaction()?;
                    let mut new_quad = quad.clone();
                    if let EncodedTerm::Triple(t) = new_quad.subject {
                        new_quad.subject = to_rdf12_reified_triple(
                            &t.subject,
                            &t.predicate,
                            &t.object,
                            &quad.graph_name,
                            &snapshot,
                            &mut w,
                        )?;
                    }
                    if let EncodedTerm::Triple(t) = new_quad.object {
                        new_quad.object = to_rdf12_reified_triple(
                            &t.subject,
                            &t.predicate,
                            &t.object,
                            &quad.graph_name,
                            &snapshot,
                            &mut w,
                        )?;
                    }
                    w.insert(snapshot.decode_quad(&new_quad)?);
                    w.remove_encoded(&quad);
                    w.commit()?;
                }
            }
            version = 2;
            self.update_version(version)?;
        }

        match version {
            _ if version < LATEST_STORAGE_VERSION => Err(CorruptionError::msg(format!(
                "The RocksDB database is using the outdated encoding version {version}. Automated migration is not supported, please dump the store dataset using a compatible Oxigraph version and load it again using the current version"
            )).into()),
            LATEST_STORAGE_VERSION => Ok(()),
            _ => Err(CorruptionError::msg(format!(
                "The RocksDB database is using the too recent version {version}. Upgrade to the latest Oxigraph version to load this database"

            )).into())
        }
    }

    fn ensure_version(&self) -> Result<u64, StorageError> {
        Ok(
            if let Some(version) = self.db.get(&self.default_cf, b"oxversion")? {
                u64::from_be_bytes(version.as_ref().try_into().map_err(|e| {
                    CorruptionError::new(format!("Error while parsing the version key: {e}"))
                })?)
            } else {
                self.update_version(LATEST_STORAGE_VERSION)?;
                LATEST_STORAGE_VERSION
            },
        )
    }

    fn update_version(&self, version: u64) -> Result<(), StorageError> {
        self.db
            .insert(&self.default_cf, b"oxversion", &version.to_be_bytes())?;
        self.db.flush()
    }

    pub fn snapshot(&self) -> RocksDbStorageReader<'static> {
        RocksDbStorageReader {
            reader: self.db.snapshot(),
            storage: self.clone(),
        }
    }

    pub fn start_transaction(&self) -> Result<RocksDbStorageTransaction<'_>, StorageError> {
        Ok(RocksDbStorageTransaction {
            buffer: Vec::new(),
            transaction: self.db.start_transaction()?,
            storage: self,
        })
    }

    pub fn start_readable_transaction(
        &self,
    ) -> Result<RocksDbStorageReadableTransaction<'_>, StorageError> {
        Ok(RocksDbStorageReadableTransaction {
            buffer: Vec::new(),
            transaction: self.db.start_readable_transaction()?,
            storage: self,
        })
    }

    pub fn start_readable_transaction_with_control(
        &self,
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<RocksDbStorageReadableTransaction<'_>, StorageTransactionStartError> {
        Ok(RocksDbStorageReadableTransaction {
            buffer: Vec::new(),
            transaction: self
                .db
                .start_readable_transaction_with_control(control, started_at)?,
            storage: self,
        })
    }

    pub fn start_keyed_readable_transaction_with_control(
        &self,
        transaction_key: &[u8; 16],
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<RocksDbStorageKeyedReadableTransaction<'_>, StorageTransactionStartError> {
        self.start_outcome_transaction(transaction_key, false, control, started_at)
    }

    pub fn start_governed_transaction_with_control(
        &self,
        transaction_key: &[u8; 16],
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<RocksDbStorageKeyedReadableTransaction<'_>, StorageTransactionStartError> {
        self.start_outcome_transaction(transaction_key, true, control, started_at)
    }

    fn start_outcome_transaction(
        &self,
        transaction_key: &[u8; 16],
        governed: bool,
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<RocksDbStorageKeyedReadableTransaction<'_>, StorageTransactionStartError> {
        let legacy_key = transaction_outcome_key(transaction_key);
        let governed_key = governed_outcome_key(transaction_key);
        let (outcome_key, alternative_key, staging, rolled_back) = if governed {
            (
                &governed_key,
                &legacy_key,
                GOVERNED_OUTCOME_STAGING,
                GOVERNED_OUTCOME_ROLLED_BACK,
            )
        } else {
            (
                &legacy_key,
                &governed_key,
                TRANSACTION_OUTCOME_STAGING,
                TRANSACTION_OUTCOME_ROLLED_BACK,
            )
        };
        Ok(RocksDbStorageKeyedReadableTransaction {
            transaction_key: *transaction_key,
            governed,
            inner: RocksDbStorageReadableTransaction {
                buffer: Vec::new(),
                transaction: self.db.start_keyed_readable_transaction_with_control(
                    &self.default_cf,
                    [outcome_key, alternative_key],
                    staging,
                    rolled_back,
                    control,
                    started_at,
                )?,
                storage: self,
            },
        })
    }

    pub fn lookup_transaction_outcome(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<StorageTransactionOutcome, StorageError> {
        Ok(match self.lookup_commit_receipt(transaction_key)? {
            CommitReceiptOutcome::Committed(_)
            | CommitReceiptOutcome::Expired(_)
            | CommitReceiptOutcome::CommittedWithoutReceipt => StorageTransactionOutcome::Committed,
            CommitReceiptOutcome::ProvenAbsent(_) => StorageTransactionOutcome::RolledBack,
            CommitReceiptOutcome::Indeterminate => StorageTransactionOutcome::Indeterminate,
        })
    }

    pub fn lookup_commit_receipt(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<CommitReceiptOutcome, StorageError> {
        // One snapshot prevents racing a final batch's receipt and high-water state.
        let reader = self.db.snapshot();
        self.lookup_commit_receipt_with_reader(transaction_key, &reader)
    }

    pub fn lookup_shacl_receipt(
        &self,
        transaction_key: &[u8; 16],
    ) -> Result<crate::store::ShaclReceiptOutcome, StorageError> {
        let reader = self.db.snapshot();
        let outcome = self.lookup_commit_receipt_with_reader(transaction_key, &reader)?;
        if let Some(value) = reader.get(&self.default_cf, &governed_outcome_key(transaction_key))?
            && value.starts_with(crate::store::shacl_receipt::VALIDATED_OUTCOME)
        {
            return Ok(crate::store::shacl_receipt::GovernedReceipt::decode(&value)?.outcome());
        }
        Ok(crate::store::ShaclReceiptOutcome::Unavailable(outcome))
    }

    fn lookup_commit_receipt_with_reader(
        &self,
        transaction_key: &[u8; 16],
        reader: &Reader<'_>,
    ) -> Result<CommitReceiptOutcome, StorageError> {
        let legacy = reader.get(&self.default_cf, &transaction_outcome_key(transaction_key))?;
        let governed = reader.get(&self.default_cf, &governed_outcome_key(transaction_key))?;
        if legacy.is_some() && governed.is_some() {
            return Err(CorruptionError::msg(
                "transaction key reserved in both outcome namespaces",
            )
            .into());
        }
        if let Some(record) = governed {
            return match record.as_ref() {
                GOVERNED_OUTCOME_STAGING | GOVERNED_OUTCOME_COMMIT_ATTEMPTED => {
                    Ok(CommitReceiptOutcome::Indeterminate)
                }
                GOVERNED_OUTCOME_ROLLED_BACK => Ok(CommitReceiptOutcome::ProvenAbsent(
                    TransactionNonCommitReason::RolledBack,
                )),
                value if value.starts_with(&[2, 4]) => {
                    let state = reader
                        .get(&self.default_cf, GOVERNANCE_STATE_KEY)?
                        .ok_or_else(|| {
                            CorruptionError::msg("expired receipt without governance state")
                        })?;
                    Ok(CommitReceiptOutcome::Expired(
                        crate::store::ExpiredCommitReceipt::decode(
                            transaction_key,
                            value,
                            &GovernanceState::decode(&state)?,
                        )?,
                    ))
                }
                value
                    if value.starts_with(GOVERNED_OUTCOME_COMMITTED)
                        || value.starts_with(crate::store::shacl_receipt::VALIDATED_OUTCOME) =>
                {
                    let receipt = crate::store::shacl_receipt::GovernedReceipt::decode(value)?
                        .receipt()
                        .clone();
                    let state = reader
                        .get(&self.default_cf, GOVERNANCE_STATE_KEY)?
                        .ok_or_else(|| {
                            CorruptionError::msg("committed receipt without governance state")
                        })?;
                    let state = GovernanceState::decode(&state)?;
                    if receipt.transaction_key().as_bytes() != transaction_key
                        || receipt.store_identity() != &state.store_identity
                        || receipt.sequence() > state.sequence
                    {
                        return Err(CorruptionError::msg("receipt key, store identity or sequence does not match governance state").into());
                    }
                    match (&state.outbox, receipt.outbox_end_cursor()) {
                        (None, None) => (),
                        (Some(outbox), None)
                            if receipt.sequence() <= outbox.after_receipt_sequence => {}
                        (Some(outbox), Some(end))
                            if receipt.sequence() > outbox.after_receipt_sequence
                                && end.position() <= outbox.high_water
                                && receipt.outbox_header_cursor().is_some_and(|cursor| {
                                    cursor.position() > crate::store::retention::floor(&state)
                                }) => {}
                        _ => {
                            return Err(CorruptionError::msg(
                                "receipt disagrees with outbox activation or high-water",
                            )
                            .into());
                        }
                    }
                    Ok(CommitReceiptOutcome::Committed(receipt))
                }
                _ => Err(CorruptionError::msg("invalid governed outcome record").into()),
            };
        }
        let Some(record) = legacy else {
            return Ok(CommitReceiptOutcome::Indeterminate);
        };
        match record.as_ref() {
            TRANSACTION_OUTCOME_STAGING | TRANSACTION_OUTCOME_COMMIT_ATTEMPTED => {
                Ok(CommitReceiptOutcome::Indeterminate)
            }
            TRANSACTION_OUTCOME_COMMITTED => Ok(CommitReceiptOutcome::CommittedWithoutReceipt),
            TRANSACTION_OUTCOME_ROLLED_BACK => Ok(CommitReceiptOutcome::ProvenAbsent(
                TransactionNonCommitReason::RolledBack,
            )),
            value => Err(CorruptionError::msg(format!(
                "invalid transaction outcome record: {value:?}"
            ))
            .into()),
        }
    }

    pub fn read_outbox(
        &self,
        after: Option<&crate::store::OutboxCursor>,
        limit: std::num::NonZeroUsize,
    ) -> Result<crate::store::OutboxBatch, crate::store::OutboxReadError> {
        let reader = self.db.snapshot();
        self.read_outbox_snapshot(&reader, after, limit)
    }

    fn read_outbox_snapshot(
        &self,
        reader: &Reader<'_>,
        after: Option<&crate::store::OutboxCursor>,
        limit: std::num::NonZeroUsize,
    ) -> Result<crate::store::OutboxBatch, crate::store::OutboxReadError> {
        let state = reader.get(&self.default_cf, GOVERNANCE_STATE_KEY)?;
        let state = state.as_deref().map(GovernanceState::decode).transpose()?;
        if let Some(state) = &state {
            crate::store::retention::validate_cleanup_head(state, |position| {
                self.read_outbox_record(reader, position)
            })?;
        }
        let first = reader.scan_prefix(&self.default_cf, OUTBOX_RECORD_PREFIX);
        first.status()?;
        let gc = state
            .as_ref()
            .map_or(0, crate::store::retention::physical_gc);
        let high = state
            .as_ref()
            .and_then(|state| state.outbox.as_ref())
            .map_or(0, |state| state.high_water);
        let expected = (gc < high).then(|| outbox_record_key(gc + 1));
        if first.key() != expected.as_deref() {
            return Err(
                StorageError::from(CorruptionError::msg("invalid outbox origin key")).into(),
            );
        }
        crate::store::outbox::read_page(
            state.as_ref(),
            after,
            limit,
            |position| self.read_outbox_record(reader, position),
            |key| {
                if reader
                    .get(&self.default_cf, &transaction_outcome_key(key))?
                    .is_some()
                {
                    return Err(CorruptionError::msg("outbox key also has a legacy outcome").into());
                }
                let value = reader.get(&self.default_cf, &governed_outcome_key(key))?;
                value
                    .map(|value| {
                        if value.starts_with(&[2, 4]) {
                            let state = state.as_ref().ok_or_else(|| {
                                CorruptionError::msg("expired anchor without governance state")
                            })?;
                            return crate::store::retention::anchor_receipt(
                                state,
                                &crate::store::ExpiredCommitReceipt::decode(key, &value, state)?,
                            );
                        }
                        Ok(
                            crate::store::shacl_receipt::GovernedReceipt::decode(&value)?
                                .receipt()
                                .clone(),
                        )
                    })
                    .transpose()
            },
            |position| {
                let mut lower = outbox_record_key(position);
                lower.push(0); // Strictly greater, including malformed suffixes at u64::MAX.
                let records =
                    reader.scan_prefix_from(&self.default_cf, OUTBOX_RECORD_PREFIX, &lower);
                records.status()?;
                Ok(records.is_valid())
            },
        )
    }

    fn read_outbox_record(
        &self,
        reader: &Reader<'_>,
        position: u64,
    ) -> Result<Option<Vec<u8>>, StorageError> {
        let key = outbox_record_key(position);
        let mut records = reader.scan_prefix_from(&self.default_cf, OUTBOX_RECORD_PREFIX, &key);
        records.status()?;
        if records.key() != Some(key.as_slice()) {
            return Ok(None);
        }
        let value = records.value().map(<[u8]>::to_vec);
        records.next();
        records.status()?;
        if let Some(next) = records.key()
            && position
                .checked_add(1)
                .is_none_or(|position| next != outbox_record_key(position))
        {
            return Err(CorruptionError::msg("invalid or gapped outbox successor key").into());
        }
        Ok(value)
    }

    pub fn govern_outbox(
        &self,
        action: crate::store::retention::Action<'_>,
        now: crate::store::GovernanceTime,
    ) -> Result<crate::store::retention::ActionResult, crate::store::GovernanceError> {
        let mut transaction = self.db.start_readable_transaction()?;
        let prepared = {
            let reader = transaction.reader();
            let raw_state = reader.get(&self.default_cf, GOVERNANCE_STATE_KEY)?;
            // An absent lineage with any existing key is ambiguous. Do not scan
            // unbounded historical reservations to guess whether it is safe.
            if raw_state.is_none() {
                let records = reader.scan_prefix(&self.default_cf, GOVERNED_OUTCOME_KEY_PREFIX);
                records.status()?;
                if records.is_valid() {
                    return Err(crate::store::GovernanceError::LineageUnavailable);
                }
            }
            let state = raw_state
                .as_deref()
                .map(GovernanceState::decode)
                .transpose()?
                .unwrap_or_default();
            self.read_outbox_snapshot(&reader, None, std::num::NonZeroUsize::MIN)?;
            if let Some(cursor) = action.cursor() {
                self.read_outbox_snapshot(&reader, Some(cursor), std::num::NonZeroUsize::MIN)?;
            }
            crate::store::retention::prepare(&state, action, now, |position| {
                let bytes = self
                    .read_outbox_record(&reader, position)?
                    .ok_or_else(|| CorruptionError::msg("missing cleanup record"))?;
                crate::store::outbox::decode_record(&state.store_identity, position, &bytes)
            })?
        };
        if let Some(receipt) = prepared.expired {
            transaction.insert(
                &self.default_cf,
                &governed_outcome_key(receipt.transaction_key().as_bytes()),
                &crate::store::ExpiredCommitReceipt::new(&receipt).encode(),
            );
        }
        for position in prepared.remove {
            transaction.remove(&self.default_cf, &outbox_record_key(position));
        }
        transaction.insert(
            &self.default_cf,
            GOVERNANCE_STATE_KEY,
            &prepared.state.encode(),
        );
        transaction
            .commit_governance()
            .map_err(crate::store::GovernanceError::MaintenanceIndeterminate)?;
        Ok(prepared.result)
    }

    pub fn governance_health(
        &self,
        now: crate::store::GovernanceTime,
        limit: std::num::NonZeroUsize,
    ) -> Result<crate::store::GovernanceHealth, crate::store::GovernanceError> {
        let reader = self.db.snapshot();
        let bytes = reader.get(&self.default_cf, GOVERNANCE_STATE_KEY)?;
        let state = bytes.as_deref().map(GovernanceState::decode).transpose()?;
        if state.is_none() {
            let records = reader.scan_prefix(&self.default_cf, GOVERNED_OUTCOME_KEY_PREFIX);
            records.status()?;
            if records.is_valid() {
                return Err(crate::store::GovernanceError::LineageUnavailable);
            }
        }
        let page = self.read_outbox_snapshot(&reader, None, limit)?;
        crate::store::retention::health(state.as_ref(), now, &page)
    }

    #[cfg(test)]
    pub(crate) fn arm_transaction_outcome_fault(
        &self,
        point: TransactionOutcomeFaultPoint,
    ) -> Result<(), StorageError> {
        self.db.arm_transaction_outcome_fault(point)
    }

    #[cfg(test)]
    pub(crate) fn transaction_outcome_fault_events(
        &self,
    ) -> Result<Vec<TransactionOutcomeFaultPoint>, StorageError> {
        self.db.transaction_outcome_fault_events()
    }

    #[cfg(test)]
    pub(crate) fn write_raw_transaction_outcome_record(
        &self,
        transaction_key: &[u8; 16],
        record: &[u8],
    ) -> Result<(), StorageError> {
        self.db.insert(
            &self.default_cf,
            &transaction_outcome_key(transaction_key),
            record,
        )?;
        self.db.flush()
    }

    pub fn flush(&self) -> Result<(), StorageError> {
        self.db.flush()
    }

    pub fn compact(&self) -> Result<(), StorageError> {
        self.db.compact(&self.default_cf)?;
        self.db.compact(&self.gspo_cf)?;
        self.db.compact(&self.gpos_cf)?;
        self.db.compact(&self.gosp_cf)?;
        self.db.compact(&self.spog_cf)?;
        self.db.compact(&self.posg_cf)?;
        self.db.compact(&self.ospg_cf)?;
        self.db.compact(&self.dspo_cf)?;
        self.db.compact(&self.dpos_cf)?;
        self.db.compact(&self.dosp_cf)?;
        self.db.compact(&self.graphs_cf)?;
        self.db.compact(&self.id2str_cf)
    }

    pub fn backup(&self, target_directory: &Path) -> Result<(), StorageError> {
        self.db.backup(target_directory)
    }

    pub fn backup_path(&self) -> &Path {
        self.db.backup_path()
    }

    pub fn backup_identity(&self) -> Result<super::BackupStorageIdentity, StorageError> {
        let version = self
            .db
            .get(&self.default_cf, b"oxversion")?
            .ok_or_else(|| CorruptionError::msg("missing storage layout version"))?;
        let version = u64::from_be_bytes(
            version
                .as_ref()
                .try_into()
                .map_err(|_| CorruptionError::msg("invalid storage layout version"))?,
        );
        if version != LATEST_STORAGE_VERSION {
            return Err(CorruptionError::msg("incompatible storage layout version").into());
        }
        let (identity, sequence) = self.db.backup_identity()?;
        let governance = self.db.get(&self.default_cf, GOVERNANCE_STATE_KEY)?;
        let governance_schema = governance.as_ref().and_then(|value| value.first().copied());
        let governance = governance
            .as_ref()
            .map(|value| GovernanceState::decode(value.as_ref()))
            .transpose()?;
        Ok(super::BackupStorageIdentity {
            database_id: identity,
            sequence,
            storage_version: version,
            governance_schema,
            governance,
        })
    }

    pub fn bulk_loader(&self) -> RocksDbStorageBulkLoader<'_> {
        RocksDbStorageBulkLoader {
            storage: self,
            hooks: Vec::new(),
            threads: VecDeque::new(),
            sst_files: Vec::new(),
            done_counter: Arc::new(Mutex::new(0)),
            done_and_displayed_counter: 0,
            cancellation_token: CancellationToken::new(),
            atomic: true,
        }
    }
}

fn transaction_outcome_key(transaction_key: &[u8; 16]) -> Vec<u8> {
    let mut key = Vec::with_capacity(TRANSACTION_OUTCOME_KEY_PREFIX.len() + transaction_key.len());
    key.extend_from_slice(TRANSACTION_OUTCOME_KEY_PREFIX);
    key.extend_from_slice(transaction_key);
    key
}

fn governed_outcome_key(transaction_key: &[u8; 16]) -> Vec<u8> {
    let mut key = GOVERNED_OUTCOME_KEY_PREFIX.to_vec();
    key.extend_from_slice(transaction_key);
    key
}

fn namespace_mapping_key(prefix: &NamespacePrefix) -> Vec<u8> {
    let mut key = Vec::with_capacity(NAMESPACE_MAPPING_KEY_PREFIX.len() + prefix.as_str().len());
    key.extend_from_slice(NAMESPACE_MAPPING_KEY_PREFIX);
    key.extend_from_slice(prefix.as_str().as_bytes());
    key
}

fn namespace_mapping_value(iri: &NamedNode) -> Vec<u8> {
    let mut value = Vec::with_capacity(1 + iri.as_str().len());
    value.push(NAMESPACE_RECORD_VERSION);
    value.extend_from_slice(iri.as_str().as_bytes());
    value
}

#[must_use]
pub struct RocksDbStorageReader<'a> {
    reader: Reader<'a>,
    storage: RocksDbStorage,
}

impl<'a> RocksDbStorageReader<'a> {
    pub fn check_layout(&self) -> Result<(), StorageError> {
        let version = self
            .reader
            .get(&self.storage.default_cf, b"oxversion")?
            .ok_or_else(|| CorruptionError::msg("missing storage layout version"))?;
        if version.as_ref() != LATEST_STORAGE_VERSION.to_be_bytes() {
            return Err(CorruptionError::msg("incompatible storage layout version").into());
        }
        Ok(())
    }
    pub fn len(&self) -> Result<usize, StorageError> {
        Ok(self.reader.len(&self.storage.gspo_cf)? + self.reader.len(&self.storage.dspo_cf)?)
    }

    pub fn is_empty(&self) -> Result<bool, StorageError> {
        Ok(self.reader.is_empty(&self.storage.gspo_cf)?
            && self.reader.is_empty(&self.storage.dspo_cf)?)
    }

    pub fn contains(&self, quad: &EncodedQuad) -> Result<bool, StorageError> {
        let mut buffer = Vec::with_capacity(4 * WRITTEN_TERM_MAX_SIZE);
        if quad.graph_name.is_default_graph() {
            write_spo_quad(&mut buffer, quad);
            Ok(self.reader.contains_key(&self.storage.dspo_cf, &buffer)?)
        } else {
            write_gspo_quad(&mut buffer, quad);
            Ok(self.reader.contains_key(&self.storage.gspo_cf, &buffer)?)
        }
    }

    pub fn quads_for_pattern(
        &self,
        subject: Option<&EncodedTerm>,
        predicate: Option<&EncodedTerm>,
        object: Option<&EncodedTerm>,
        graph_name: Option<&EncodedTerm>,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        match subject {
            Some(subject) => match predicate {
                Some(predicate) => match object {
                    Some(object) => match graph_name {
                        Some(graph_name) => self.quads_for_subject_predicate_object_graph(
                            subject, predicate, object, graph_name,
                        ),
                        None => self.quads_for_subject_predicate_object(subject, predicate, object),
                    },
                    None => match graph_name {
                        Some(graph_name) => {
                            self.quads_for_subject_predicate_graph(subject, predicate, graph_name)
                        }
                        None => self.quads_for_subject_predicate(subject, predicate),
                    },
                },
                None => match object {
                    Some(object) => match graph_name {
                        Some(graph_name) => {
                            self.quads_for_subject_object_graph(subject, object, graph_name)
                        }
                        None => self.quads_for_subject_object(subject, object),
                    },
                    None => match graph_name {
                        Some(graph_name) => self.quads_for_subject_graph(subject, graph_name),
                        None => self.quads_for_subject(subject),
                    },
                },
            },
            None => match predicate {
                Some(predicate) => match object {
                    Some(object) => match graph_name {
                        Some(graph_name) => {
                            self.quads_for_predicate_object_graph(predicate, object, graph_name)
                        }
                        None => self.quads_for_predicate_object(predicate, object),
                    },
                    None => match graph_name {
                        Some(graph_name) => self.quads_for_predicate_graph(predicate, graph_name),
                        None => self.quads_for_predicate(predicate),
                    },
                },
                None => match object {
                    Some(object) => match graph_name {
                        Some(graph_name) => self.quads_for_object_graph(object, graph_name),
                        None => self.quads_for_object(object),
                    },
                    None => match graph_name {
                        Some(graph_name) => self.quads_for_graph(graph_name),
                        None => self.quads(),
                    },
                },
            },
        }
    }

    pub fn quads_for_pattern_in_union(
        &self,
        subject: Option<&EncodedTerm>,
        predicate: Option<&EncodedTerm>,
        object: Option<&EncodedTerm>,
        graph_names: Option<&[Option<EncodedTerm>]>,
    ) -> RocksDbMergedDecodingQuadIterator<'a> {
        let order = TripleOrder::from_pattern(subject, predicate, object);
        let iters = if let Some(graph_names) = graph_names {
            graph_names
                .iter()
                .map(|graph_name| {
                    let graph_name = graph_name.as_ref().unwrap_or(&EncodedTerm::DefaultGraph);
                    self.quads_for_pattern(subject, predicate, object, Some(graph_name))
                })
                .collect()
        } else {
            vec![self.quads_for_pattern_in_named_graphs(subject, predicate, object)]
        };
        RocksDbMergedDecodingQuadIterator::new(iters, order)
    }

    fn quads_for_pattern_in_named_graphs(
        &self,
        subject: Option<&EncodedTerm>,
        predicate: Option<&EncodedTerm>,
        object: Option<&EncodedTerm>,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(match subject {
            Some(subject) => match predicate {
                Some(predicate) => match object {
                    Some(object) => {
                        self.spog_quads(&encode_term_triple(subject, predicate, object))
                    }
                    None => self.spog_quads(&encode_term_pair(subject, predicate)),
                },
                None => match object {
                    Some(object) => self.ospg_quads(&encode_term_pair(object, subject)),
                    None => self.spog_quads(&encode_term(subject)),
                },
            },
            None => match predicate {
                Some(predicate) => match object {
                    Some(object) => self.posg_quads(&encode_term_pair(predicate, object)),
                    None => self.posg_quads(&encode_term(predicate)),
                },
                None => match object {
                    Some(object) => self.ospg_quads(&encode_term(object)),
                    None => self.spog_quads(&[]),
                },
            },
        })
    }

    pub fn quads(&self) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::pair(self.dspo_quads(&[]), self.gspo_quads(&[]))
    }

    fn quads_for_subject(&self, subject: &EncodedTerm) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::pair(
            self.dspo_quads(&encode_term(subject)),
            self.spog_quads(&encode_term(subject)),
        )
    }

    fn quads_for_subject_predicate(
        &self,
        subject: &EncodedTerm,
        predicate: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::pair(
            self.dspo_quads(&encode_term_pair(subject, predicate)),
            self.spog_quads(&encode_term_pair(subject, predicate)),
        )
    }

    fn quads_for_subject_predicate_object(
        &self,
        subject: &EncodedTerm,
        predicate: &EncodedTerm,
        object: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::pair(
            self.dspo_quads(&encode_term_triple(subject, predicate, object)),
            self.spog_quads(&encode_term_triple(subject, predicate, object)),
        )
    }

    fn quads_for_subject_object(
        &self,
        subject: &EncodedTerm,
        object: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::pair(
            self.dosp_quads(&encode_term_pair(object, subject)),
            self.ospg_quads(&encode_term_pair(object, subject)),
        )
    }

    fn quads_for_predicate(
        &self,
        predicate: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::pair(
            self.dpos_quads(&encode_term(predicate)),
            self.posg_quads(&encode_term(predicate)),
        )
    }

    fn quads_for_predicate_object(
        &self,
        predicate: &EncodedTerm,
        object: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::pair(
            self.dpos_quads(&encode_term_pair(predicate, object)),
            self.posg_quads(&encode_term_pair(predicate, object)),
        )
    }

    fn quads_for_object(&self, object: &EncodedTerm) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::pair(
            self.dosp_quads(&encode_term(object)),
            self.ospg_quads(&encode_term(object)),
        )
    }

    fn quads_for_graph(&self, graph_name: &EncodedTerm) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(if graph_name.is_default_graph() {
            self.dspo_quads(&Vec::default())
        } else {
            self.gspo_quads(&encode_term(graph_name))
        })
    }

    fn quads_for_subject_graph(
        &self,
        subject: &EncodedTerm,
        graph_name: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(if graph_name.is_default_graph() {
            self.dspo_quads(&encode_term(subject))
        } else {
            self.gspo_quads(&encode_term_pair(graph_name, subject))
        })
    }

    fn quads_for_subject_predicate_graph(
        &self,
        subject: &EncodedTerm,
        predicate: &EncodedTerm,
        graph_name: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(if graph_name.is_default_graph() {
            self.dspo_quads(&encode_term_pair(subject, predicate))
        } else {
            self.gspo_quads(&encode_term_triple(graph_name, subject, predicate))
        })
    }

    fn quads_for_subject_predicate_object_graph(
        &self,
        subject: &EncodedTerm,
        predicate: &EncodedTerm,
        object: &EncodedTerm,
        graph_name: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(if graph_name.is_default_graph() {
            self.dspo_quads(&encode_term_triple(subject, predicate, object))
        } else {
            self.gspo_quads(&encode_term_quad(graph_name, subject, predicate, object))
        })
    }

    fn quads_for_subject_object_graph(
        &self,
        subject: &EncodedTerm,
        object: &EncodedTerm,
        graph_name: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(if graph_name.is_default_graph() {
            self.dosp_quads(&encode_term_pair(object, subject))
        } else {
            self.gosp_quads(&encode_term_triple(graph_name, object, subject))
        })
    }

    fn quads_for_predicate_graph(
        &self,
        predicate: &EncodedTerm,
        graph_name: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(if graph_name.is_default_graph() {
            self.dpos_quads(&encode_term(predicate))
        } else {
            self.gpos_quads(&encode_term_pair(graph_name, predicate))
        })
    }

    fn quads_for_predicate_object_graph(
        &self,
        predicate: &EncodedTerm,
        object: &EncodedTerm,
        graph_name: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(if graph_name.is_default_graph() {
            self.dpos_quads(&encode_term_pair(predicate, object))
        } else {
            self.gpos_quads(&encode_term_triple(graph_name, predicate, object))
        })
    }

    fn quads_for_object_graph(
        &self,
        object: &EncodedTerm,
        graph_name: &EncodedTerm,
    ) -> RocksDbChainedDecodingQuadIterator<'a> {
        RocksDbChainedDecodingQuadIterator::new(if graph_name.is_default_graph() {
            self.dosp_quads(&encode_term(object))
        } else {
            self.gosp_quads(&encode_term_pair(graph_name, object))
        })
    }

    pub fn named_graphs(&self) -> RocksDbDecodingGraphIterator<'a> {
        RocksDbDecodingGraphIterator {
            iter: self.reader.iter(&self.storage.graphs_cf),
        }
    }

    pub fn contains_named_graph(&self, graph_name: &EncodedTerm) -> Result<bool, StorageError> {
        self.reader
            .contains_key(&self.storage.graphs_cf, &encode_term(graph_name))
    }

    pub fn namespaces(&self) -> Result<Vec<Namespace>, StorageError> {
        let schema_present = match self
            .reader
            .get(&self.storage.default_cf, NAMESPACE_SCHEMA_KEY)?
        {
            Some(value) if value.as_ref() == NAMESPACE_SCHEMA_V1 => true,
            Some(value) => {
                return Err(CorruptionError::msg(format!(
                    "invalid namespace schema record: {:?}",
                    value.as_ref()
                ))
                .into());
            }
            None => false,
        };

        let mut namespaces = Vec::new();
        let mut prefixes = FxHashSet::default();
        let mut iter = self
            .reader
            .scan_prefix(&self.storage.default_cf, NAMESPACE_KEY_PREFIX);
        while iter.is_valid() {
            let key = iter
                .key()
                .ok_or_else(|| CorruptionError::msg("namespace iterator lost its key"))?
                .to_vec();
            let value = iter
                .value()
                .ok_or_else(|| CorruptionError::msg("namespace iterator lost its value"))?
                .to_vec();
            if key == NAMESPACE_SCHEMA_KEY {
                if value != NAMESPACE_SCHEMA_V1 {
                    return Err(CorruptionError::msg(format!(
                        "invalid namespace schema record: {value:?}"
                    ))
                    .into());
                }
            } else if let Some(prefix_bytes) = key.strip_prefix(NAMESPACE_MAPPING_KEY_PREFIX) {
                if !schema_present {
                    return Err(CorruptionError::msg(
                        "namespace mapping record exists without a schema marker",
                    )
                    .into());
                }
                let prefix = NamespacePrefix::new(
                    str::from_utf8(prefix_bytes)
                        .map_err(CorruptionError::new)?
                        .to_owned(),
                )
                .map_err(CorruptionError::new)?;
                if !prefixes.insert(prefix.clone()) {
                    return Err(CorruptionError::msg(
                        "multiple namespace mappings are visible for one prefix",
                    )
                    .into());
                }
                let Some((&version, iri_bytes)) = value.split_first() else {
                    return Err(CorruptionError::msg("empty namespace mapping record").into());
                };
                if version != NAMESPACE_RECORD_VERSION {
                    return Err(CorruptionError::msg(format!(
                        "unknown namespace mapping record version {version}"
                    ))
                    .into());
                }
                let iri = NamedNode::new(
                    str::from_utf8(iri_bytes)
                        .map_err(CorruptionError::new)?
                        .to_owned(),
                )
                .map_err(CorruptionError::new)?;
                namespaces.push(Namespace::new(prefix, iri));
            } else {
                return Err(CorruptionError::msg(format!(
                    "unknown reserved namespace record key: {key:?}"
                ))
                .into());
            }
            iter.next();
        }
        iter.status()?;
        namespaces.sort_unstable_by(|left, right| {
            left.prefix()
                .as_str()
                .as_bytes()
                .cmp(right.prefix().as_str().as_bytes())
        });
        Ok(namespaces)
    }

    pub fn namespace(&self, prefix: &NamespacePrefix) -> Result<Option<Namespace>, StorageError> {
        Ok(self
            .namespaces()?
            .into_iter()
            .find(|namespace| namespace.prefix() == prefix))
    }

    fn spog_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.spog_cf, prefix, QuadEncoding::Spog)
    }

    fn posg_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.posg_cf, prefix, QuadEncoding::Posg)
    }

    fn ospg_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.ospg_cf, prefix, QuadEncoding::Ospg)
    }

    fn gspo_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.gspo_cf, prefix, QuadEncoding::Gspo)
    }

    fn gpos_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.gpos_cf, prefix, QuadEncoding::Gpos)
    }

    fn gosp_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.gosp_cf, prefix, QuadEncoding::Gosp)
    }

    fn dspo_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.dspo_cf, prefix, QuadEncoding::Dspo)
    }

    fn dpos_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.dpos_cf, prefix, QuadEncoding::Dpos)
    }

    fn dosp_quads(&self, prefix: &[u8]) -> RocksDbDecodingQuadIterator<'a> {
        self.inner_quads(&self.storage.dosp_cf, prefix, QuadEncoding::Dosp)
    }

    fn inner_quads(
        &self,
        column_family: &ColumnFamily,
        prefix: &[u8],
        encoding: QuadEncoding,
    ) -> RocksDbDecodingQuadIterator<'a> {
        RocksDbDecodingQuadIterator {
            iter: self.reader.scan_prefix(column_family, prefix),
            encoding,
        }
    }

    pub fn contains_str(&self, key: &StrHash) -> Result<bool, StorageError> {
        self.reader
            .contains_key(&self.storage.id2str_cf, &key.to_be_bytes())
    }

    /// Validate that all the storage invariants held in the data
    pub fn validate(&self) -> Result<(), StorageError> {
        self.namespaces()?;
        // triples
        let dspo_size = self.dspo_quads(&[]).count();
        if dspo_size != self.dpos_quads(&[]).count() || dspo_size != self.dosp_quads(&[]).count() {
            return Err(CorruptionError::new(
                "Not the same number of triples in dspo, dpos and dosp",
            )
            .into());
        }
        for spo in self.dspo_quads(&[]) {
            let spo = spo?;
            self.decode_quad(&spo)?; // We ensure that the quad is readable
            if !self.storage.db.contains_key(
                &self.storage.dpos_cf,
                &encode_term_triple(&spo.predicate, &spo.object, &spo.subject),
            )? {
                return Err(CorruptionError::new("Quad in dspo and not in dpos").into());
            }
            if !self.storage.db.contains_key(
                &self.storage.dosp_cf,
                &encode_term_triple(&spo.object, &spo.subject, &spo.predicate),
            )? {
                return Err(CorruptionError::new("Quad in dspo and not in dosp").into());
            }
        }

        // quads
        let gspo_size = self.gspo_quads(&[]).count();
        if gspo_size != self.gpos_quads(&[]).count()
            || gspo_size != self.gosp_quads(&[]).count()
            || gspo_size != self.spog_quads(&[]).count()
            || gspo_size != self.posg_quads(&[]).count()
            || gspo_size != self.ospg_quads(&[]).count()
        {
            return Err(CorruptionError::new(
                "Not the same number of triples in dspo, dpos and dosp",
            )
            .into());
        }
        for gspo in self.gspo_quads(&[]) {
            let gspo = gspo?;
            self.decode_quad(&gspo)?; // We ensure that the quad is readable
            if !self.storage.db.contains_key(
                &self.storage.gpos_cf,
                &encode_term_quad(
                    &gspo.graph_name,
                    &gspo.predicate,
                    &gspo.object,
                    &gspo.subject,
                ),
            )? {
                return Err(CorruptionError::new("Quad in gspo and not in gpos").into());
            }
            if !self.storage.db.contains_key(
                &self.storage.gosp_cf,
                &encode_term_quad(
                    &gspo.graph_name,
                    &gspo.object,
                    &gspo.subject,
                    &gspo.predicate,
                ),
            )? {
                return Err(CorruptionError::new("Quad in gspo and not in gosp").into());
            }
            if !self.storage.db.contains_key(
                &self.storage.spog_cf,
                &encode_term_quad(
                    &gspo.subject,
                    &gspo.predicate,
                    &gspo.object,
                    &gspo.graph_name,
                ),
            )? {
                return Err(CorruptionError::new("Quad in gspo and not in spog").into());
            }
            if !self.storage.db.contains_key(
                &self.storage.posg_cf,
                &encode_term_quad(
                    &gspo.predicate,
                    &gspo.object,
                    &gspo.subject,
                    &gspo.graph_name,
                ),
            )? {
                return Err(CorruptionError::new("Quad in gspo and not in posg").into());
            }
            if !self.storage.db.contains_key(
                &self.storage.ospg_cf,
                &encode_term_quad(
                    &gspo.object,
                    &gspo.subject,
                    &gspo.predicate,
                    &gspo.graph_name,
                ),
            )? {
                return Err(CorruptionError::new("Quad in gspo and not in ospg").into());
            }
            if !self
                .storage
                .db
                .contains_key(&self.storage.graphs_cf, &encode_term(&gspo.graph_name))?
            {
                return Err(
                    CorruptionError::new("Quad graph name in gspo and not in graphs").into(),
                );
            }
        }
        Ok(())
    }
}

#[must_use]
pub struct RocksDbChainedDecodingQuadIterator<'a> {
    first: RocksDbDecodingQuadIterator<'a>,
    second: Option<RocksDbDecodingQuadIterator<'a>>,
}

impl<'a> RocksDbChainedDecodingQuadIterator<'a> {
    fn new(first: RocksDbDecodingQuadIterator<'a>) -> Self {
        Self {
            first,
            second: None,
        }
    }

    fn pair(
        first: RocksDbDecodingQuadIterator<'a>,
        second: RocksDbDecodingQuadIterator<'a>,
    ) -> Self {
        Self {
            first,
            second: Some(second),
        }
    }
}

impl Iterator for RocksDbChainedDecodingQuadIterator<'_> {
    type Item = Result<EncodedQuad, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(result) = self.first.next() {
            Some(result)
        } else if let Some(second) = &mut self.second {
            second.next()
        } else {
            None
        }
    }
}

#[derive(Clone, Copy)]
enum TripleOrder {
    Spo,
    Pos,
    Osp,
}

impl TripleOrder {
    fn from_pattern(
        subject: Option<&EncodedTerm>,
        predicate: Option<&EncodedTerm>,
        object: Option<&EncodedTerm>,
    ) -> Self {
        if subject.is_some() {
            if predicate.is_none() && object.is_some() {
                Self::Osp
            } else {
                Self::Spo
            }
        } else if predicate.is_some() {
            Self::Pos
        } else if object.is_some() {
            Self::Osp
        } else {
            Self::Spo
        }
    }

    fn key(self, quad: &EncodedQuad) -> Vec<u8> {
        let mut key = Vec::with_capacity(3 * WRITTEN_TERM_MAX_SIZE);
        match self {
            Self::Spo => write_spo_quad(&mut key, quad),
            Self::Pos => write_pos_quad(&mut key, quad),
            Self::Osp => write_osp_quad(&mut key, quad),
        }
        key
    }
}

struct QuadHead {
    key: Vec<u8>,
    quad: EncodedQuad,
}

#[must_use]
pub struct RocksDbMergedDecodingQuadIterator<'a> {
    iters: Vec<RocksDbChainedDecodingQuadIterator<'a>>,
    heads: Vec<Option<QuadHead>>,
    order: TripleOrder,
    previous: Option<EncodedQuad>,
}

impl<'a> RocksDbMergedDecodingQuadIterator<'a> {
    fn new(iters: Vec<RocksDbChainedDecodingQuadIterator<'a>>, order: TripleOrder) -> Self {
        let heads = std::iter::repeat_with(|| None).take(iters.len()).collect();
        Self {
            iters,
            heads,
            order,
            previous: None,
        }
    }
}

impl Iterator for RocksDbMergedDecodingQuadIterator<'_> {
    type Item = Result<EncodedQuad, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            for (head, iter) in self.heads.iter_mut().zip(&mut self.iters) {
                if head.is_none() {
                    if let Some(quad) = iter.next() {
                        let quad = match quad {
                            Ok(quad) => quad,
                            Err(error) => return Some(Err(error)),
                        };
                        *head = Some(QuadHead {
                            key: self.order.key(&quad),
                            quad,
                        });
                    }
                }
            }
            let index = self
                .heads
                .iter()
                .enumerate()
                .filter_map(|(index, head)| Some((index, &head.as_ref()?.key)))
                .min_by(|(_, a), (_, b)| a.cmp(b))
                .map(|(index, _)| index)?;
            let mut quad = self.heads.get_mut(index)?.take()?.quad;
            quad.graph_name = EncodedTerm::DefaultGraph;
            if self.previous.as_ref() == Some(&quad) {
                continue;
            }
            self.previous = Some(quad.clone());
            return Some(Ok(quad));
        }
    }
}

struct RocksDbDecodingQuadIterator<'a> {
    iter: Iter<'a>,
    encoding: QuadEncoding,
}

impl Iterator for RocksDbDecodingQuadIterator<'_> {
    type Item = Result<EncodedQuad, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Err(e) = self.iter.status() {
            return Some(Err(e));
        }
        let term = self.encoding.decode(self.iter.key()?);
        self.iter.next();
        Some(term)
    }
}

#[must_use]
pub struct RocksDbDecodingGraphIterator<'a> {
    iter: Iter<'a>,
}

impl Iterator for RocksDbDecodingGraphIterator<'_> {
    type Item = Result<EncodedTerm, StorageError>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Err(e) = self.iter.status() {
            return Some(Err(e));
        }
        let term = decode_term(self.iter.key()?);
        self.iter.next();
        Some(term)
    }
}

impl StrLookup for RocksDbStorageReader<'_> {
    fn get_str(&self, key: &StrHash) -> Result<Option<OxString>, StorageError> {
        Ok(self
            .reader
            .get(&self.storage.id2str_cf, &key.to_be_bytes())?
            .map(|v| Ok::<_, Utf8Error>(OxString::new_owned(str::from_utf8(&v)?)))
            .transpose()
            .map_err(CorruptionError::new)?)
    }
}

#[must_use]
pub struct RocksDbStorageTransaction<'a> {
    buffer: Vec<u8>,
    transaction: Transaction,
    storage: &'a RocksDbStorage,
}

impl RocksDbStorageTransaction<'_> {
    pub fn insert(&mut self, quad: Quad) {
        let encoded = (&quad).into();
        self.buffer.clear();
        if quad.graph_name.is_default_graph() {
            write_spo_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.dspo_cf, &self.buffer);

            self.buffer.clear();
            write_pos_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.dpos_cf, &self.buffer);

            self.buffer.clear();
            write_osp_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.dosp_cf, &self.buffer);

            self.insert_term(quad.subject.into(), &encoded.subject);
            self.insert_term(quad.predicate.into(), &encoded.predicate);
            self.insert_term(quad.object, &encoded.object);
        } else {
            write_spog_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.spog_cf, &self.buffer);

            self.buffer.clear();
            write_posg_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.posg_cf, &self.buffer);

            self.buffer.clear();
            write_ospg_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.ospg_cf, &self.buffer);

            self.buffer.clear();
            write_gspo_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.gspo_cf, &self.buffer);

            self.buffer.clear();
            write_gpos_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.gpos_cf, &self.buffer);

            self.buffer.clear();
            write_gosp_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.gosp_cf, &self.buffer);

            self.insert_term(quad.subject.into(), &encoded.subject);
            self.insert_term(quad.predicate.into(), &encoded.predicate);
            self.insert_term(quad.object, &encoded.object);

            self.buffer.clear();
            write_term(&mut self.buffer, &encoded.graph_name);
            self.transaction
                .insert_empty(&self.storage.graphs_cf, &self.buffer);
            self.insert_graph_name(quad.graph_name, &encoded.graph_name);
        }
    }

    pub fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) {
        let encoded_graph_name = (&graph_name).into();

        self.buffer.clear();
        write_term(&mut self.buffer, &encoded_graph_name);
        self.transaction
            .insert_empty(&self.storage.graphs_cf, &self.buffer);
        self.insert_term(graph_name.into(), &encoded_graph_name);
    }

    pub fn set_namespace(&mut self, namespace: Namespace) {
        let (prefix, iri) = namespace.into_parts();
        self.transaction.insert(
            &self.storage.default_cf,
            NAMESPACE_SCHEMA_KEY,
            NAMESPACE_SCHEMA_V1,
        );
        self.transaction.insert(
            &self.storage.default_cf,
            &namespace_mapping_key(&prefix),
            &namespace_mapping_value(&iri),
        );
    }

    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) {
        self.transaction
            .remove(&self.storage.default_cf, &namespace_mapping_key(prefix));
    }

    pub fn clear_namespaces(&mut self) {
        self.transaction.remove_range(
            &self.storage.default_cf,
            NAMESPACE_MAPPING_KEY_PREFIX,
            NAMESPACE_MAPPING_KEY_UPPER_BOUND,
        );
    }

    fn insert_term(&mut self, term: Term, encoded: &EncodedTerm) {
        insert_term(term, encoded, &mut |key, value| {
            self.insert_str(key, &value)
        })
    }

    fn insert_graph_name(&mut self, graph_name: GraphName, encoded: &EncodedTerm) {
        match graph_name {
            GraphName::NamedNode(graph_name) => self.insert_term(graph_name.into(), encoded),
            GraphName::BlankNode(graph_name) => self.insert_term(graph_name.into(), encoded),
            GraphName::DefaultGraph => (),
        }
    }

    fn insert_str(&mut self, key: &StrHash, value: &str) {
        self.transaction.insert(
            &self.storage.id2str_cf,
            &key.to_be_bytes(),
            value.as_bytes(),
        )
    }

    pub fn remove(&mut self, quad: &Quad) {
        self.remove_encoded(&quad.into())
    }

    fn remove_encoded(&mut self, quad: &EncodedQuad) {
        self.buffer.clear();
        if quad.graph_name.is_default_graph() {
            write_spo_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.dspo_cf, &self.buffer);

            self.buffer.clear();
            write_pos_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.dpos_cf, &self.buffer);

            self.buffer.clear();
            write_osp_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.dosp_cf, &self.buffer);
        } else {
            write_spog_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.spog_cf, &self.buffer);

            self.buffer.clear();
            write_posg_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.posg_cf, &self.buffer);

            self.buffer.clear();
            write_ospg_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.ospg_cf, &self.buffer);

            self.buffer.clear();
            write_gspo_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.gspo_cf, &self.buffer);

            self.buffer.clear();
            write_gpos_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.gpos_cf, &self.buffer);

            self.buffer.clear();
            write_gosp_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.gosp_cf, &self.buffer);
        }
    }

    pub fn clear_default_graph(&mut self) {
        self.transaction
            .remove_range(&self.storage.dspo_cf, &[], &[u8::MAX]);
        self.transaction
            .remove_range(&self.storage.dpos_cf, &[], &[u8::MAX]);
        self.transaction
            .remove_range(&self.storage.dosp_cf, &[], &[u8::MAX]);
    }

    pub fn clear_all_named_graphs(&mut self) {
        self.transaction
            .remove_range(&self.storage.gspo_cf, &[], &[u8::MAX]);
        self.transaction
            .remove_range(&self.storage.gpos_cf, &[], &[u8::MAX]);
        self.transaction
            .remove_range(&self.storage.gosp_cf, &[], &[u8::MAX]);
        self.transaction
            .remove_range(&self.storage.spog_cf, &[], &[u8::MAX]);
        self.transaction
            .remove_range(&self.storage.posg_cf, &[], &[u8::MAX]);
        self.transaction
            .remove_range(&self.storage.ospg_cf, &[], &[u8::MAX]);
    }

    pub fn clear_all_graphs(&mut self) {
        self.clear_default_graph();
        self.clear_all_named_graphs();
    }

    pub fn remove_all_named_graphs(&mut self) {
        self.clear_all_named_graphs();
        self.transaction
            .remove_range(&self.storage.graphs_cf, &[], &[u8::MAX]);
    }

    pub fn clear(&mut self) {
        self.clear_default_graph();
        self.remove_all_named_graphs();
        // TODO: clear id2str?
    }

    pub fn commit(self) -> Result<(), StorageError> {
        self.transaction.commit()
    }
}

#[must_use]
pub struct RocksDbStorageReadableTransaction<'a> {
    buffer: Vec<u8>,
    transaction: ReadableTransaction<'a>,
    storage: &'a RocksDbStorage,
}

#[must_use]
pub struct RocksDbStorageKeyedReadableTransaction<'a> {
    inner: RocksDbStorageReadableTransaction<'a>,
    transaction_key: [u8; 16],
    governed: bool,
}

impl<'a> Deref for RocksDbStorageKeyedReadableTransaction<'a> {
    type Target = RocksDbStorageReadableTransaction<'a>;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for RocksDbStorageKeyedReadableTransaction<'_> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl RocksDbStorageKeyedReadableTransaction<'_> {
    pub fn commit(self) -> Result<(), StorageError> {
        if self.governed {
            return Err(StorageError::Other(
                "governed transactions require a receipt commit".into(),
            ));
        }
        self.inner.transaction.commit_keyed(
            TRANSACTION_OUTCOME_COMMIT_ATTEMPTED,
            TRANSACTION_OUTCOME_COMMITTED,
        )
    }

    pub fn commit_with_receipt(
        mut self,
        changes: &SemanticChangeSet,
        validation: Option<crate::store::shacl_receipt::ValidationCommitContext<'_>>,
    ) -> Result<CommitReceipt, TransactionCommitError<StorageError>> {
        if !self.governed {
            return Err(TransactionCommitError::Rejected(StorageError::Other(
                "receipt commit requires a governed transaction".into(),
            )));
        }
        let cf = &self.inner.storage.default_cf;
        // All fallible validation precedes CommitAttempted. The held writer permit
        // serializes this high-water allocation with every other governed writer.
        let state = self
            .inner
            .transaction
            .reader()
            .get(cf, GOVERNANCE_STATE_KEY)
            .map_err(TransactionCommitError::Rejected)?;
        if state.is_none() {
            // Absence is valid only before the first successful governed commit.
            // Never silently create a new lineage after losing its high-water key.
            let reader = self.inner.transaction.reader();
            let mut records = reader.scan_prefix(cf, GOVERNED_OUTCOME_KEY_PREFIX);
            while records.is_valid() {
                if !matches!(
                    records.value(),
                    Some(
                        GOVERNED_OUTCOME_STAGING
                            | GOVERNED_OUTCOME_COMMIT_ATTEMPTED
                            | GOVERNED_OUTCOME_ROLLED_BACK
                    )
                ) {
                    return Err(TransactionCommitError::Rejected(
                        CorruptionError::msg("governed history exists without governance state")
                            .into(),
                    ));
                }
                records.next();
            }
            records.status().map_err(TransactionCommitError::Rejected)?;
        }
        let state = state
            .as_deref()
            .map(GovernanceState::decode)
            .transpose()
            .map_err(TransactionCommitError::Rejected)?
            .unwrap_or_default();
        self.inner
            .storage
            .read_outbox(None, std::num::NonZeroUsize::MIN)
            .map_err(|error| TransactionCommitError::Rejected(error.into_storage()))?;
        let prepared = crate::store::outbox::prepare(&state, &self.transaction_key, changes)
            .map_err(TransactionCommitError::Rejected)?;
        let committed = crate::store::shacl_receipt::GovernedReceipt::new(
            prepared.receipt.clone(),
            validation.map(|context| context.evidence),
        )
        .map_err(TransactionCommitError::Rejected)?
        .encode();
        // One final WriteBatchWithIndex owns primary changes, receipt, records,
        // and both high-water marks. No notifications are appended after commit.
        for (position, bytes) in &prepared.records {
            self.inner
                .transaction
                .insert(cf, &outbox_record_key(*position), bytes);
        }
        self.inner
            .transaction
            .insert(cf, GOVERNANCE_STATE_KEY, &prepared.state.encode());
        let receipt = prepared.receipt;
        if let Some(validation) = validation {
            if let Err(source) = (validation.before_attempt)() {
                let rollback = self.rollback().err();
                return Err(TransactionCommitError::Rejected(StorageError::Other(
                    Box::new(crate::store::shacl_receipt::ValidationPreAttemptError {
                        source,
                        rollback,
                    }),
                )));
            }
        }
        self.inner
            .transaction
            .commit_keyed(GOVERNED_OUTCOME_COMMIT_ATTEMPTED, &committed)
            .map_err(|source| TransactionCommitError::Indeterminate {
                transaction_key: TransactionKey::new(self.transaction_key),
                source,
            })?;
        Ok(receipt)
    }

    pub fn rollback(self) -> Result<(), StorageError> {
        self.inner.transaction.rollback_keyed()
    }
}

impl RocksDbStorageReadableTransaction<'_> {
    pub fn reader(&self) -> RocksDbStorageReader<'_> {
        RocksDbStorageReader {
            reader: self.transaction.reader(),
            storage: self.storage.clone(),
        }
    }

    pub fn insert(&mut self, quad: Quad) {
        let encoded = (&quad).into();
        self.buffer.clear();
        if quad.graph_name.is_default_graph() {
            write_spo_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.dspo_cf, &self.buffer);

            self.buffer.clear();
            write_pos_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.dpos_cf, &self.buffer);

            self.buffer.clear();
            write_osp_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.dosp_cf, &self.buffer);

            self.insert_term(quad.subject.into(), &encoded.subject);
            self.insert_term(quad.predicate.into(), &encoded.predicate);
            self.insert_term(quad.object, &encoded.object)
        } else {
            write_spog_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.spog_cf, &self.buffer);

            self.buffer.clear();
            write_posg_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.posg_cf, &self.buffer);

            self.buffer.clear();
            write_ospg_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.ospg_cf, &self.buffer);

            self.buffer.clear();
            write_gspo_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.gspo_cf, &self.buffer);

            self.buffer.clear();
            write_gpos_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.gpos_cf, &self.buffer);

            self.buffer.clear();
            write_gosp_quad(&mut self.buffer, &encoded);
            self.transaction
                .insert_empty(&self.storage.gosp_cf, &self.buffer);

            self.insert_term(quad.subject.into(), &encoded.subject);
            self.insert_term(quad.predicate.into(), &encoded.predicate);
            self.insert_term(quad.object, &encoded.object);

            self.buffer.clear();
            write_term(&mut self.buffer, &encoded.graph_name);
            self.transaction
                .insert_empty(&self.storage.graphs_cf, &self.buffer);
            self.insert_graph_name(quad.graph_name, &encoded.graph_name)
        }
    }

    pub fn insert_named_graph(&mut self, graph_name: NamedOrBlankNode) {
        let encoded_graph_name = (&graph_name).into();

        self.buffer.clear();
        write_term(&mut self.buffer, &encoded_graph_name);
        self.transaction
            .insert_empty(&self.storage.graphs_cf, &self.buffer);
        self.insert_term(graph_name.into(), &encoded_graph_name)
    }

    pub fn set_namespace(&mut self, namespace: Namespace) {
        let (prefix, iri) = namespace.into_parts();
        self.transaction.insert(
            &self.storage.default_cf,
            NAMESPACE_SCHEMA_KEY,
            NAMESPACE_SCHEMA_V1,
        );
        self.transaction.insert(
            &self.storage.default_cf,
            &namespace_mapping_key(&prefix),
            &namespace_mapping_value(&iri),
        );
    }

    pub fn remove_namespace(&mut self, prefix: &NamespacePrefix) {
        self.transaction
            .remove(&self.storage.default_cf, &namespace_mapping_key(prefix));
    }

    pub fn clear_namespaces(&mut self) -> Result<(), StorageError> {
        let keys = {
            let reader = self.reader();
            let mut iter = reader
                .reader
                .scan_prefix(&self.storage.default_cf, NAMESPACE_MAPPING_KEY_PREFIX);
            let mut keys = Vec::new();
            while iter.is_valid() {
                keys.push(
                    iter.key()
                        .ok_or_else(|| CorruptionError::msg("namespace iterator lost its key"))?
                        .to_vec(),
                );
                iter.next();
            }
            iter.status()?;
            keys
        };
        for key in keys {
            self.transaction.remove(&self.storage.default_cf, &key);
        }
        Ok(())
    }

    fn insert_term(&mut self, term: Term, encoded: &EncodedTerm) {
        insert_term(term, encoded, &mut |key, value| {
            self.insert_str(key, &value)
        })
    }

    fn insert_graph_name(&mut self, graph_name: GraphName, encoded: &EncodedTerm) {
        match graph_name {
            GraphName::NamedNode(graph_name) => self.insert_term(graph_name.into(), encoded),
            GraphName::BlankNode(graph_name) => self.insert_term(graph_name.into(), encoded),
            GraphName::DefaultGraph => (),
        }
    }

    fn insert_str(&mut self, key: &StrHash, value: &str) {
        self.transaction.insert(
            &self.storage.id2str_cf,
            &key.to_be_bytes(),
            value.as_bytes(),
        );
    }

    pub fn remove(&mut self, quad: &Quad) {
        self.remove_encoded(&quad.into())
    }

    fn remove_encoded(&mut self, quad: &EncodedQuad) {
        self.buffer.clear();
        if quad.graph_name.is_default_graph() {
            write_spo_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.dspo_cf, &self.buffer);

            self.buffer.clear();
            write_pos_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.dpos_cf, &self.buffer);

            self.buffer.clear();
            write_osp_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.dosp_cf, &self.buffer);
        } else {
            write_spog_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.spog_cf, &self.buffer);

            self.buffer.clear();
            write_posg_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.posg_cf, &self.buffer);

            self.buffer.clear();
            write_ospg_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.ospg_cf, &self.buffer);

            self.buffer.clear();
            write_gspo_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.gspo_cf, &self.buffer);

            self.buffer.clear();
            write_gpos_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.gpos_cf, &self.buffer);

            self.buffer.clear();
            write_gosp_quad(&mut self.buffer, quad);
            self.transaction.remove(&self.storage.gosp_cf, &self.buffer);
        }
    }

    pub fn clear_graph(&mut self, graph_name: &GraphName) -> Result<(), StorageError> {
        self.clear_encoded_graph(&graph_name.into())
    }

    fn clear_encoded_graph(&mut self, graph_name: &EncodedTerm) -> Result<(), StorageError> {
        loop {
            let quads = self
                .reader()
                .quads_for_graph(graph_name)
                .take(BATCH_SIZE)
                .collect::<Result<Vec<_>, _>>()?;
            for quad in &quads {
                self.remove_encoded(quad);
            }
            if quads.len() < BATCH_SIZE {
                return Ok(());
            }
        }
    }

    pub fn clear_all_named_graphs(&mut self) -> Result<(), StorageError> {
        self.clear_all_named_graphs_in_batches(BATCH_SIZE)
    }

    fn clear_all_named_graphs_in_batches(&mut self, batch_size: usize) -> Result<(), StorageError> {
        if batch_size == 0 {
            return Err(StorageError::Other(
                "RocksDB clear batch size must be non-zero".into(),
            ));
        }

        // This transaction owns a stable snapshot and clearing a graph retains
        // its membership entry. Fixing the upper bound also makes a paging
        // regression fail instead of looping forever.
        let graph_count = self
            .reader()
            .named_graphs()
            .try_fold(0_usize, |count, graph_name| {
                graph_name?;
                count.checked_add(1).ok_or_else(|| {
                    StorageError::from(CorruptionError::msg("named graph count overflows usize"))
                })
            })?;

        let mut offset = 0;
        while offset < graph_count {
            let expected_batch_len = (graph_count - offset).min(batch_size);
            let graph_names = self
                .reader()
                .named_graphs()
                .skip(offset)
                .take(batch_size)
                .collect::<Result<Vec<_>, _>>()?;
            if graph_names.len() != expected_batch_len {
                return Err(CorruptionError::msg(format!(
                    "named graph batch at offset {offset} contained {} entries instead of {expected_batch_len}",
                    graph_names.len()
                ))
                .into());
            }
            for graph_name in &graph_names {
                self.clear_encoded_graph(graph_name)?;
            }
            offset += expected_batch_len;
        }
        Ok(())
    }

    pub fn clear_all_graphs(&mut self) -> Result<(), StorageError> {
        self.clear_all_graphs_in_batches(BATCH_SIZE)
    }

    fn clear_all_graphs_in_batches(&mut self, batch_size: usize) -> Result<(), StorageError> {
        self.clear_all_named_graphs_in_batches(batch_size)?;
        self.clear_graph(&GraphName::DefaultGraph)
    }

    pub fn remove_named_graph(
        &mut self,
        graph_name: &NamedOrBlankNode,
    ) -> Result<(), StorageError> {
        self.remove_encoded_named_graph(&graph_name.into())
    }

    fn remove_encoded_named_graph(&mut self, graph_name: &EncodedTerm) -> Result<(), StorageError> {
        self.clear_encoded_graph(graph_name)?;
        self.buffer.clear();
        write_term(&mut self.buffer, graph_name);
        self.transaction
            .remove(&self.storage.graphs_cf, &self.buffer);
        Ok(())
    }

    pub fn remove_all_named_graphs(&mut self) -> Result<(), StorageError> {
        loop {
            let graph_names = self
                .reader()
                .named_graphs()
                .take(BATCH_SIZE)
                .collect::<Result<Vec<_>, _>>()?;
            for graph_name in &graph_names {
                self.remove_encoded_named_graph(graph_name)?;
            }
            if graph_names.len() < BATCH_SIZE {
                return Ok(());
            }
        }
    }

    pub fn clear(&mut self) -> Result<(), StorageError> {
        self.remove_all_named_graphs()?;
        self.clear_graph(&GraphName::DefaultGraph)
    }

    pub fn commit(self) -> Result<(), StorageError> {
        self.transaction.commit()
    }
}

#[must_use]
pub struct RocksDbStorageBulkLoader<'a> {
    storage: &'a RocksDbStorage,
    hooks: Vec<Box<dyn Fn(u64) + Send + Sync>>,
    threads: VecDeque<JoinHandle<Result<Vec<(ColumnFamily, PathBuf)>, StorageError>>>,
    sst_files: Vec<(ColumnFamily, PathBuf)>,
    done_counter: Arc<Mutex<u64>>,
    done_and_displayed_counter: u64,
    cancellation_token: CancellationToken,
    atomic: bool,
}

impl Drop for RocksDbStorageBulkLoader<'_> {
    fn drop(&mut self) {
        self.cancellation_token.cancel();
        // We wait for threads
        while let Some(thread) = self.threads.pop_front() {
            if thread.is_finished() {
                if let Ok(Ok(files)) = thread.join() {
                    self.sst_files.extend(files);
                }
            }
        }
        // We clean the created files
        for (_, file) in &self.sst_files {
            #[expect(unused_must_use)] // We already have an error to report...
            remove_file(file);
        }
    }
}

impl RocksDbStorageBulkLoader<'_> {
    pub fn on_progress(mut self, callback: impl Fn(u64) + Send + Sync + 'static) -> Self {
        self.hooks.push(Box::new(callback));
        self
    }

    pub fn without_atomicity(mut self) -> Self {
        self.atomic = false;
        self
    }

    pub fn load_batch(
        &mut self,
        batch: Vec<Quad>,
        max_num_threads: usize,
    ) -> Result<(), StorageError> {
        self.on_possible_progress()?;
        while self.threads.len() >= max_num_threads {
            if let Some(thread) = self.threads.pop_front() {
                self.sst_files
                    .extend(map_thread_result(thread.join()).map_err(StorageError::Io)??);
                self.on_possible_progress()?;
            }
        }
        if !self.atomic {
            self.do_commit()?;
        }
        // TODO: better spawn
        let storage = self.storage.clone();
        let counter = Arc::clone(&self.done_counter);
        let cancellation_token = self.cancellation_token.clone();
        self.threads.push_back(thread::spawn(move || {
            let mut sst_files = Vec::new();
            match FileBulkLoader::new(&storage, batch.len(), cancellation_token).load(
                batch,
                &counter,
                &mut sst_files,
            ) {
                Ok(()) => Ok(sst_files),
                Err(e) => {
                    // We cleanup written files
                    for (_, file) in sst_files {
                        #[expect(unused_must_use)] // We already have an error to report...
                        remove_file(file);
                    }
                    Err(e)
                }
            }
        }));
        Ok(())
    }

    pub fn load_named_graphs(
        &mut self,
        graph_names: Vec<NamedOrBlankNode>,
        max_num_threads: usize,
    ) -> Result<(), StorageError> {
        self.on_possible_progress()?;
        while self.threads.len() >= max_num_threads {
            if let Some(thread) = self.threads.pop_front() {
                self.sst_files
                    .extend(map_thread_result(thread.join()).map_err(StorageError::Io)??);
                self.on_possible_progress()?;
            }
        }
        if !self.atomic {
            self.do_commit()?;
        }
        let storage = self.storage.clone();
        let cancellation_token = self.cancellation_token.clone();
        self.threads.push_back(thread::spawn(move || {
            let mut sst_files = Vec::new();
            match FileBulkLoader::new(&storage, graph_names.len(), cancellation_token)
                .load_named_graphs(graph_names, &mut sst_files)
            {
                Ok(()) => Ok(sst_files),
                Err(error) => {
                    for (_, file) in sst_files {
                        #[expect(unused_must_use)] // We already have an error to report...
                        remove_file(file);
                    }
                    Err(error)
                }
            }
        }));
        Ok(())
    }

    fn on_possible_progress(&mut self) -> Result<(), StorageError> {
        let new_counter = *self
            .done_counter
            .lock()
            .map_err(|_| io::Error::other("Mutex poisoned"))?;
        let display_step = DEFAULT_BULK_LOAD_BATCH_SIZE as u64;
        if new_counter / display_step > self.done_and_displayed_counter / display_step {
            for hook in &self.hooks {
                hook(new_counter);
            }
        }
        self.done_and_displayed_counter = new_counter;
        Ok(())
    }

    fn do_commit(&mut self) -> Result<(), StorageError> {
        if self.sst_files.is_empty() {
            return Ok(());
        }
        self.storage.db.insert_stt_files(&self.sst_files)?;
        for (_, file) in &self.sst_files {
            remove_file(file)?;
        }
        self.sst_files.clear();
        Ok(())
    }

    pub fn commit(mut self) -> Result<(), StorageError> {
        while let Some(thread) = self.threads.pop_front() {
            self.sst_files
                .extend(map_thread_result(thread.join()).map_err(StorageError::Io)??);
            self.on_possible_progress()?;
        }
        self.do_commit()
    }
}

struct FileBulkLoader<'a> {
    storage: &'a RocksDbStorage,
    id2str: HashMap<StrHash, Box<str>, BuildHasherDefault<StrHashHasher>>,
    quads: FxHashSet<EncodedQuad>,
    triples: FxHashSet<EncodedQuad>,
    graphs: FxHashSet<EncodedTerm>,
    cancellation_token: CancellationToken,
}

impl<'a> FileBulkLoader<'a> {
    fn new(
        storage: &'a RocksDbStorage,
        batch_size: usize,
        cancellation_token: CancellationToken,
    ) -> Self {
        Self {
            storage,
            id2str: HashMap::with_capacity_and_hasher(
                3 * batch_size,
                BuildHasherDefault::default(),
            ),
            quads: FxHashSet::with_capacity_and_hasher(batch_size, FxBuildHasher),
            triples: FxHashSet::with_capacity_and_hasher(batch_size, FxBuildHasher),
            graphs: FxHashSet::default(),
            cancellation_token,
        }
    }

    fn load(
        &mut self,
        quads: Vec<Quad>,
        counter: &Mutex<u64>,
        sst_files: &mut Vec<(ColumnFamily, PathBuf)>,
    ) -> Result<(), StorageError> {
        self.encode(quads)?;
        let size = self.triples.len() + self.quads.len();
        self.build_sst_files(sst_files)?;
        *counter
            .lock()
            .map_err(|_| io::Error::other("Mutex poisoned"))? +=
            size.try_into().unwrap_or(u64::MAX);
        Ok(())
    }

    fn load_named_graphs(
        &mut self,
        graph_names: Vec<NamedOrBlankNode>,
        sst_files: &mut Vec<(ColumnFamily, PathBuf)>,
    ) -> Result<(), StorageError> {
        self.encode_named_graphs(graph_names);
        self.build_sst_files(sst_files)
    }

    fn encode(&mut self, quads: Vec<Quad>) -> Result<(), StorageError> {
        for quad in quads {
            let encoded = EncodedQuad::from(&quad);
            if quad.graph_name.is_default_graph() {
                if self.triples.insert(encoded.clone()) {
                    self.insert_term(quad.subject.into(), &encoded.subject);
                    self.insert_term(quad.predicate.into(), &encoded.predicate);
                    self.insert_term(quad.object, &encoded.object);
                }
            } else if self.quads.insert(encoded.clone()) {
                self.insert_term(quad.subject.into(), &encoded.subject);
                self.insert_term(quad.predicate.into(), &encoded.predicate);
                self.insert_term(quad.object, &encoded.object);

                if self.graphs.insert(encoded.graph_name.clone()) {
                    self.insert_term(
                        match quad.graph_name {
                            GraphName::NamedNode(n) => n.into(),
                            GraphName::BlankNode(n) => n.into(),
                            GraphName::DefaultGraph => {
                                return Err(CorruptionError::new(
                                    "Default graph this not the default graph",
                                )
                                .into());
                            }
                        },
                        &encoded.graph_name,
                    );
                }
            }
        }
        Ok(())
    }

    fn encode_named_graphs(&mut self, graph_names: Vec<NamedOrBlankNode>) {
        for graph_name in graph_names {
            let encoded_graph_name = EncodedTerm::from(&graph_name);
            if self.graphs.insert(encoded_graph_name.clone()) {
                self.insert_term(graph_name.into(), &encoded_graph_name);
            }
        }
    }

    fn build_sst_files(
        &mut self,
        sst_files: &mut Vec<(ColumnFamily, PathBuf)>,
    ) -> Result<(), StorageError> {
        // id2str
        if !self.id2str.is_empty() {
            self.fail_if_cancelled()?;
            let mut id2str = take(&mut self.id2str)
                .into_iter()
                .map(|(k, v)| (k.to_be_bytes(), v))
                .collect::<Vec<_>>();
            id2str.sort_unstable();
            let mut id2str_sst = self.storage.db.new_sst_file()?;
            for (k, v) in id2str {
                id2str_sst.insert(&k, v.as_bytes())?;
            }
            sst_files.push((self.storage.id2str_cf.clone(), id2str_sst.finish()?));
        }

        if !self.triples.is_empty() {
            self.fail_if_cancelled()?;
            sst_files.push((
                self.storage.dspo_cf.clone(),
                self.build_sst_for_keys(
                    self.triples.iter().map(|quad| {
                        encode_term_triple(&quad.subject, &quad.predicate, &quad.object)
                    }),
                )?,
            ));
            sst_files.push((
                self.storage.dpos_cf.clone(),
                self.build_sst_for_keys(
                    self.triples.iter().map(|quad| {
                        encode_term_triple(&quad.predicate, &quad.object, &quad.subject)
                    }),
                )?,
            ));
            sst_files.push((
                self.storage.dosp_cf.clone(),
                self.build_sst_for_keys(
                    self.triples.iter().map(|quad| {
                        encode_term_triple(&quad.object, &quad.subject, &quad.predicate)
                    }),
                )?,
            ));
            self.triples.clear();
        }

        if !self.graphs.is_empty() {
            self.fail_if_cancelled()?;
            sst_files.push((
                self.storage.graphs_cf.clone(),
                self.build_sst_for_keys(self.graphs.iter().map(encode_term))?,
            ));
            self.graphs.clear();
        }

        if !self.quads.is_empty() {
            sst_files.push((
                self.storage.gspo_cf.clone(),
                self.build_sst_for_keys(self.quads.iter().map(|quad| {
                    encode_term_quad(
                        &quad.graph_name,
                        &quad.subject,
                        &quad.predicate,
                        &quad.object,
                    )
                }))?,
            ));
            sst_files.push((
                self.storage.gpos_cf.clone(),
                self.build_sst_for_keys(self.quads.iter().map(|quad| {
                    encode_term_quad(
                        &quad.graph_name,
                        &quad.predicate,
                        &quad.object,
                        &quad.subject,
                    )
                }))?,
            ));
            sst_files.push((
                self.storage.gosp_cf.clone(),
                self.build_sst_for_keys(self.quads.iter().map(|quad| {
                    encode_term_quad(
                        &quad.graph_name,
                        &quad.object,
                        &quad.subject,
                        &quad.predicate,
                    )
                }))?,
            ));
            self.fail_if_cancelled()?;
            sst_files.push((
                self.storage.spog_cf.clone(),
                self.build_sst_for_keys(self.quads.iter().map(|quad| {
                    encode_term_quad(
                        &quad.subject,
                        &quad.predicate,
                        &quad.object,
                        &quad.graph_name,
                    )
                }))?,
            ));
            sst_files.push((
                self.storage.posg_cf.clone(),
                self.build_sst_for_keys(self.quads.iter().map(|quad| {
                    encode_term_quad(
                        &quad.predicate,
                        &quad.object,
                        &quad.subject,
                        &quad.graph_name,
                    )
                }))?,
            ));
            sst_files.push((
                self.storage.ospg_cf.clone(),
                self.build_sst_for_keys(self.quads.iter().map(|quad| {
                    encode_term_quad(
                        &quad.object,
                        &quad.subject,
                        &quad.predicate,
                        &quad.graph_name,
                    )
                }))?,
            ));
            self.quads.clear();
        }
        self.fail_if_cancelled()
    }

    fn insert_term(&mut self, term: Term, encoded: &EncodedTerm) {
        insert_term(term, encoded, &mut |key, value| {
            self.id2str
                .entry(*key)
                .or_insert_with(|| value.as_ref().into());
        })
    }

    fn build_sst_for_keys(
        &self,
        values: impl Iterator<Item = Vec<u8>>,
    ) -> Result<PathBuf, StorageError> {
        let mut values = values.collect::<Vec<_>>();
        values.sort_unstable();
        let mut sst = self.storage.db.new_sst_file()?;
        for value in values {
            sst.insert_empty(&value)?;
        }
        sst.finish()
    }

    fn fail_if_cancelled(&self) -> Result<(), StorageError> {
        if self.cancellation_token.is_cancelled() {
            Err(StorageError::Other("Cancelled".into()))
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    #[expect(
        clippy::missing_assert_message,
        clippy::panic_in_result_fn,
        reason = "isolated restore compatibility and logical-corruption fixtures"
    )]
    fn restore_validates_legacy_state_secondary_indexes_and_middle_outbox_records()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use super::*;
        use crate::store::{
            BackupOptions, RestoreOptions, RestoreReceipt, Store, TransactionRequest,
        };
        let directory = tempfile::tempdir()?;
        for mode in 0..3 {
            let source_path = directory.path().join(format!("source{mode}"));
            let source = Store::open(&source_path)?;
            if mode == 1 {
                let node = NamedNode::new_unchecked("urn:restore");
                source.insert(Quad::new(
                    node.clone(),
                    node.clone(),
                    node,
                    GraphName::DefaultGraph,
                ))?;
            }
            if mode == 2 {
                for n in 1..=3 {
                    source
                        .start_governed_transaction(
                            TransactionRequest::default(),
                            TransactionKey::new([n; 16]),
                        )?
                        .into_transaction()
                        .commit()?;
                }
            }
            drop(source);
            {
                let storage = RocksDbStorage::open(&source_path)?;
                match mode {
                    0 => {
                        let hex = "01010101010101010101010101010101010000000000000004059570c219db7d76c3ff0620696221c739fda4c15b877d039a86d4eecb0b84ec";
                        let state = (0..hex.len())
                            .step_by(2)
                            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16))
                            .collect::<Result<Vec<_>, _>>()?;
                        storage
                            .db
                            .insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &state)?;
                    }
                    1 => {
                        let reader = storage.db.snapshot();
                        let records = reader.scan_prefix(&storage.dpos_cf, &[]);
                        let key = records.key().ok_or("secondary key")?.to_vec();
                        let mut damage = storage.db.start_readable_transaction()?;
                        damage.remove(&storage.dpos_cf, &key);
                        damage.commit()?;
                    }
                    _ => storage.db.insert(
                        &storage.default_cf,
                        &outbox_record_key(2),
                        b"corrupt middle record",
                    )?,
                }
            }
            let source = Store::open_read_only(&source_path)?;
            let package = directory.path().join(format!("backup{mode}"));
            let backup = source.backup_with_receipt(&package, &BackupOptions::default())?;
            let target = directory.path().join(format!("restore{mode}"));
            let result = Store::restore_backup(&package, &target, &RestoreOptions::default());
            if mode == 0 {
                let restored = result?;
                assert_eq!(restored.backup().checkpoint(), backup.checkpoint());
                assert_eq!(restored.backup().checkpoint().governance_schema(), Some(1));
                assert_eq!(restored.validated_outbox_records(), 0);
                assert_eq!(RestoreReceipt::read(&target)?, restored);
            } else {
                result
                    .err()
                    .ok_or("logical corruption accepted by restore")?;
                assert!(!target.join(RestoreReceipt::manifest_name()).exists());
            }
        }
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    #[expect(
        clippy::missing_assert_message,
        clippy::panic_in_result_fn,
        reason = "isolated literal v1 compatibility fixture"
    )]
    fn backup_preserves_v1_history_and_later_outbox_coverage_origin()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use super::*;
        use crate::store::{BackupOptions, BackupReceipt, Store, TransactionRequest};
        fn hex(value: &str) -> Result<Vec<u8>, std::num::ParseIntError> {
            (0..value.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&value[i..i + 2], 16))
                .collect()
        }
        // Independent literal schema-1 state: four earlier receipts, no outbox.
        let old_state = hex(
            "01010101010101010101010101010101010000000000000004059570c219db7d76c3ff0620696221c739fda4c15b877d039a86d4eecb0b84ec",
        )?;
        let directory = tempfile::tempdir()?;
        let source_path = directory.path().join("source");
        {
            let storage = RocksDbStorage::open(&source_path)?;
            storage
                .db
                .insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &old_state)?;
        }
        {
            let source = Store::open_read_only(&source_path)?;
            let target = directory.path().join("v1-backup");
            let receipt = source.backup_with_receipt(&target, &BackupOptions::default())?;
            assert_eq!(
                BackupReceipt::verify(&target, &TransactionStartControl::new())?,
                receipt
            );
            assert_eq!(receipt.checkpoint().governance_schema(), Some(1));
            assert_eq!(receipt.checkpoint().governed_sequence(), Some(4));
            assert!(receipt.checkpoint().store_identity().is_some());
            assert!(receipt.checkpoint().latest_receipt().is_none());
            assert!(receipt.checkpoint().outbox_high_water().is_none());
            assert!(
                receipt
                    .checkpoint()
                    .outbox_after_receipt_sequence()
                    .is_none()
            );
            let copy = RocksDbStorage::open_read_only(&target.join("store"))?;
            assert_eq!(
                copy.db
                    .get(&copy.default_cf, GOVERNANCE_STATE_KEY)?
                    .as_deref(),
                Some(old_state.as_slice())
            );
        }
        let source = Store::open(&source_path)?;
        let commit = source
            .start_governed_transaction(
                TransactionRequest::default(),
                TransactionKey::new([3; 16]),
            )?
            .into_transaction()
            .commit()?;
        assert_eq!(commit.sequence(), 5);
        let target = directory.path().join("v2-backup");
        let receipt = source.backup_with_receipt(&target, &BackupOptions::default())?;
        assert_eq!(
            BackupReceipt::verify(&target, &TransactionStartControl::new())?,
            receipt
        );
        assert_eq!(receipt.checkpoint().governance_schema(), Some(2));
        assert_eq!(receipt.checkpoint().latest_receipt(), Some(&commit));
        assert_eq!(
            receipt.checkpoint().outbox_after_receipt_sequence(),
            Some(4)
        );
        Ok(())
    }

    #[cfg(feature = "shacl")]
    #[test]
    #[expect(
        clippy::missing_assert_message,
        clippy::unwrap_used,
        clippy::panic_in_result_fn,
        reason = "isolated temporary database corruption assertions"
    )]
    fn validated_outcome_corruption_blocks_lookup_outbox_and_retention()
    -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use super::*;
        use crate::store::{
            GovernanceTime, OutboxRetentionPolicy, ShaclCommitPolicy, ShaclGraphScope,
            ShaclShapesSource, Store, TransactionRequest,
        };
        use std::num::{NonZeroU16, NonZeroU64, NonZeroUsize};
        let directory = tempfile::tempdir()?;
        let primary;
        {
            let store = Store::open(directory.path())?;
            store.configure_outbox_retention(
                OutboxRetentionPolicy::new(NonZeroU64::new(20).unwrap(), NonZeroU16::MIN)?,
                GovernanceTime::from_unix_millis(1),
            )?;
            let policy = ShaclCommitPolicy::new(
                vec![ShaclGraphScope {
                    graph_name: GraphName::DefaultGraph,
                    required: true,
                }],
                ShaclShapesSource::External(Box::new(oxshacl::GraphSnapshot::default_graph(
                    crate::model::Dataset::default(),
                ))),
            );
            primary = store
                .start_shacl_transaction(
                    TransactionRequest::default(),
                    TransactionKey::new([1; 16]),
                    policy,
                )?
                .into_transaction()
                .commit()?
                .receipt;
        }
        let storage = RocksDbStorage::open(directory.path())?;
        let key = governed_outcome_key(&[1; 16]);
        let original = storage
            .db
            .snapshot()
            .get(&storage.default_cf, &key)?
            .unwrap();
        let state = storage
            .db
            .snapshot()
            .get(&storage.default_cf, GOVERNANCE_STATE_KEY)?
            .unwrap();
        let mut variants = vec![vec![2, 5], original[..155].to_vec()];
        for index in [155, original.len() - 1] {
            let mut bytes = original.to_vec();
            bytes[index] ^= 1;
            variants.push(bytes);
        }
        for bytes in variants {
            storage.db.insert(&storage.default_cf, &key, &bytes)?;
            assert!(storage.lookup_commit_receipt(&[1; 16]).is_err());
            assert!(storage.lookup_shacl_receipt(&[1; 16]).is_err());
            assert!(storage.read_outbox(None, NonZeroUsize::MIN).is_err());
            assert!(
                storage
                    .govern_outbox(
                        crate::store::retention::Action::Maintain {
                            through: &primary.outbox_end_cursor().unwrap(),
                            limit: NonZeroUsize::MIN
                        },
                        GovernanceTime::from_unix_millis(2)
                    )
                    .is_err()
            );
            assert_eq!(
                storage
                    .db
                    .snapshot()
                    .get(&storage.default_cf, GOVERNANCE_STATE_KEY)?
                    .unwrap()
                    .as_ref(),
                state.as_ref()
            );
        }
        storage.db.insert(&storage.default_cf, &key, &original)?;
        assert!(storage.lookup_shacl_receipt(&[1; 16]).is_ok());
        Ok(())
    }
    use super::*;
    use crate::model::NamedNode;
    use tempfile::TempDir;

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::missing_assert_message,
        reason = "cleanup corruption must reject before mutation"
    )]
    fn retention_rejects_corrupt_physical_history_before_advancing_gc()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::store::retention::Action;
        use crate::store::{
            GovernanceTime, OutboxRetentionPolicy, Store, TransactionRequest, WritableDataset,
        };
        use std::num::{NonZeroU16, NonZeroU64, NonZeroUsize};
        for mode in [
            "interstitial-key",
            "damaged-event",
            "missing-event",
            "damaged-expired-receipt",
        ] {
            let directory = TempDir::new()?;
            let store = Store::open(directory.path())?;
            store.configure_outbox_retention(
                OutboxRetentionPolicy::new(NonZeroU64::new(20).unwrap(), NonZeroU16::MIN)?,
                GovernanceTime::from_unix_millis(1),
            )?;
            let mut tx = store
                .start_governed_transaction(
                    TransactionRequest::default(),
                    TransactionKey::new([1; 16]),
                )?
                .into_transaction();
            for id in 0..3 {
                let node = NamedNode::new_unchecked(format!("urn:{id}"));
                tx.insert(Quad::new(
                    node.clone(),
                    node.clone(),
                    node,
                    GraphName::DefaultGraph,
                ))?;
            }
            let first = tx.commit()?;
            let high = first.outbox_end_cursor().unwrap();
            store.maintain_outbox(
                &high,
                NonZeroUsize::MIN,
                GovernanceTime::from_unix_millis(1),
            )?;
            drop(store);
            let storage = RocksDbStorage::open(directory.path())?;
            let before = storage
                .db
                .snapshot()
                .get(&storage.default_cf, GOVERNANCE_STATE_KEY)?
                .unwrap()
                .to_vec();
            let mut damage = storage.db.start_readable_transaction()?;
            match mode {
                "interstitial-key" => {
                    let mut bad = outbox_record_key(2);
                    bad.push(0);
                    damage.insert(&storage.default_cf, &bad, b"not-a-record");
                }
                "damaged-event" => {
                    damage.insert(&storage.default_cf, &outbox_record_key(2), b"bad")
                }
                "missing-event" => damage.remove(&storage.default_cf, &outbox_record_key(2)),
                _ => damage.insert(
                    &storage.default_cf,
                    &governed_outcome_key(&[1; 16]),
                    &[2, 4],
                ),
            }
            damage.commit()?;
            assert!(
                storage
                    .governance_health(GovernanceTime::from_unix_millis(2), NonZeroUsize::MIN)
                    .is_err(),
                "{mode}"
            );
            assert!(
                storage
                    .govern_outbox(
                        Action::Maintain {
                            through: &high,
                            limit: NonZeroUsize::new(10).unwrap()
                        },
                        GovernanceTime::from_unix_millis(2)
                    )
                    .is_err(),
                "{mode}"
            );
            assert_eq!(
                storage
                    .db
                    .snapshot()
                    .get(&storage.default_cf, GOVERNANCE_STATE_KEY)?
                    .unwrap()
                    .as_ref(),
                before.as_slice(),
                "{mode}"
            );
        }
        Ok(())
    }

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::missing_assert_message,
        reason = "receipt corruption assertions"
    )]
    fn governed_receipt_lookup_rejects_malformed_and_inconsistent_metadata()
    -> Result<(), StorageError> {
        let directory = TempDir::new()?;
        let storage = RocksDbStorage::open(directory.path())?;
        let key = [1; 16];
        let state = GovernanceState {
            sequence: 1,
            ..GovernanceState::default()
        };
        let receipt = CommitReceipt::new(
            state.store_identity.clone(),
            1,
            TransactionKey::new(key),
            &SemanticChangeSet::default(),
        );
        let mut committed = GOVERNED_OUTCOME_COMMITTED.to_vec();
        committed.extend(receipt.encode());
        storage
            .db
            .insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &state.encode())?;
        for malformed in [
            vec![],
            vec![9, 2],
            vec![2, 9],
            vec![2, 0, 1],
            vec![2, 2],
            vec![2, 2, 1],
        ] {
            storage
                .db
                .insert(&storage.default_cf, &governed_outcome_key(&key), &malformed)?;
            assert!(matches!(
                storage.lookup_commit_receipt(&key),
                Err(StorageError::Corruption(_))
            ));
        }
        for (stored_key, stored_state) in [
            ([2; 16], state.clone()),
            (
                key,
                GovernanceState {
                    sequence: 1,
                    ..GovernanceState::default()
                },
            ),
        ] {
            storage.db.insert(
                &storage.default_cf,
                &governed_outcome_key(&stored_key),
                &committed,
            )?;
            storage.db.insert(
                &storage.default_cf,
                GOVERNANCE_STATE_KEY,
                &stored_state.encode(),
            )?;
            assert!(matches!(
                storage.lookup_commit_receipt(&stored_key),
                Err(StorageError::Corruption(_))
            ));
        }
        let future = CommitReceipt::new(
            state.store_identity.clone(),
            2,
            TransactionKey::new(key),
            &SemanticChangeSet::default(),
        );
        let mut future_record = GOVERNED_OUTCOME_COMMITTED.to_vec();
        future_record.extend(future.encode());
        storage
            .db
            .insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &state.encode())?;
        storage.db.insert(
            &storage.default_cf,
            &governed_outcome_key(&key),
            &future_record,
        )?;
        assert!(storage.lookup_commit_receipt(&key).is_err());
        storage
            .db
            .insert(&storage.default_cf, &governed_outcome_key(&key), &committed)?;
        storage
            .db
            .insert(&storage.default_cf, GOVERNANCE_STATE_KEY, b"corrupt")?;
        assert!(storage.lookup_commit_receipt(&key).is_err());
        storage
            .db
            .insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &state.encode())?;
        assert_eq!(
            storage.lookup_commit_receipt(&key)?,
            CommitReceiptOutcome::Committed(receipt)
        );
        storage.write_raw_transaction_outcome_record(&key, TRANSACTION_OUTCOME_COMMITTED)?;
        assert!(storage.lookup_commit_receipt(&key).is_err());
        assert!(storage.lookup_transaction_outcome(&key).is_err());
        Ok(())
    }

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::missing_assert_message,
        reason = "governed capture poisoning assertions"
    )]
    fn governed_capture_failure_never_commits_through_any_public_entry_point()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::store::{
            ChangeTrackingError, OutcomeAwareWritableDataset, Store, TransactionRequest,
            WritableDataset, WritableNamespaceRegistry,
        };
        let directory = TempDir::new()?;
        let prefix = NamespacePrefix::new("ex")?;
        let store = Store::open(directory.path())?;
        // Inject invalid persisted data only after open: open correctly rejects
        // corrupt namespaces, whereas this test exercises mutation-time poisoning.
        store.set_namespace(Namespace::new(
            prefix.clone(),
            NamedNode::new_unchecked("not an absolute IRI"),
        ))?;
        assert!(store.namespace(&prefix).is_err());
        let node = NamedNode::new_unchecked("urn:unpublished");
        let quad = Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph);
        for entry_point in 0..3 {
            let key = TransactionKey::new([entry_point; 16]);
            let mut tx = store
                .start_governed_transaction(TransactionRequest::default(), key.clone())?
                .into_transaction();
            tx.insert(quad.clone())?;
            assert!(
                tx.set_namespace(Namespace::new(
                    prefix.clone(),
                    NamedNode::new_unchecked("urn:never-committed")
                ))
                .is_err()
            );
            assert!(matches!(tx.changes(), Err(ChangeTrackingError::Failed)));
            match entry_point {
                0 => assert!(matches!(
                    tx.commit(),
                    Err(TransactionCommitError::Rejected(
                        ChangeTrackingError::Failed
                    ))
                )),
                1 => assert!(matches!(
                    WritableDataset::commit(tx),
                    Err(ChangeTrackingError::Failed)
                )),
                _ => assert!(matches!(
                    OutcomeAwareWritableDataset::commit_with_outcome(tx),
                    Err(TransactionCommitError::Rejected(
                        ChangeTrackingError::Failed
                    ))
                )),
            }
            assert_eq!(
                store.lookup_commit_receipt(&key)?,
                CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
            );
            assert!(!store.contains(&quad)?);
        }
        assert_eq!(
            store
                .start_governed_transaction(
                    TransactionRequest::default(),
                    TransactionKey::new([3; 16])
                )?
                .into_transaction()
                .commit()?
                .sequence(),
            1
        );
        Ok(())
    }

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::missing_assert_message,
        reason = "receipt pre-attempt rejection assertions"
    )]
    fn governed_receipt_rejects_bad_highwater_before_commit_attempt()
    -> Result<(), Box<dyn std::error::Error>> {
        for mode in ["corrupt", "exhausted", "missing"] {
            let directory = TempDir::new()?;
            let storage = RocksDbStorage::open(directory.path())?;
            let control = TransactionStartControl::new();
            let previous = storage
                .start_governed_transaction_with_control(&[1; 16], &control, Instant::now())
                .map_err(|_| "fresh governed transaction did not open")?
                .commit_with_receipt(&SemanticChangeSet::default(), None)?;
            let mut corrupt = storage.db.start_readable_transaction()?;
            match mode {
                "corrupt" => corrupt.insert(&storage.default_cf, GOVERNANCE_STATE_KEY, b"corrupt"),
                "exhausted" => corrupt.insert(
                    &storage.default_cf,
                    GOVERNANCE_STATE_KEY,
                    &GovernanceState {
                        store_identity: previous.store_identity().clone(),
                        sequence: u64::MAX,
                        outbox: None,
                        retention: None,
                    }
                    .encode(),
                ),
                _ => corrupt.remove(&storage.default_cf, GOVERNANCE_STATE_KEY),
            }
            corrupt.commit()?;
            let mut tx = storage
                .start_governed_transaction_with_control(&[2; 16], &control, Instant::now())
                .map_err(|_| "new key did not open before high-water validation")?;
            let node = NamedNode::new_unchecked("urn:rejected");
            let quad = Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph);
            tx.insert(quad.clone());
            let attempted_before = storage
                .transaction_outcome_fault_events()?
                .iter()
                .filter(|point| **point == TransactionOutcomeFaultPoint::CommitAttemptedBefore)
                .count();
            assert!(matches!(
                tx.commit_with_receipt(&SemanticChangeSet::default(), None),
                Err(TransactionCommitError::Rejected(StorageError::Corruption(
                    _
                )))
            ));
            assert!(!storage.snapshot().contains(&EncodedQuad::from(&quad))?);
            assert_eq!(
                storage.lookup_commit_receipt(&[2; 16])?,
                CommitReceiptOutcome::ProvenAbsent(TransactionNonCommitReason::RolledBack)
            );
            let attempted_after = storage
                .transaction_outcome_fault_events()?
                .iter()
                .filter(|point| **point == TransactionOutcomeFaultPoint::CommitAttemptedBefore)
                .count();
            assert_eq!(attempted_before, attempted_after);
        }
        Ok(())
    }

    #[test]
    #[expect(
        clippy::panic_in_result_fn,
        clippy::missing_assert_message,
        reason = "v1 compatibility and outbox corruption assertions"
    )]
    fn outbox_activates_after_literal_v1_history_and_rejects_damaged_state()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::store::{OutboxReadError, OutboxRecord};
        use std::num::NonZeroUsize;
        // Independent literal fixture: v1 layout and domain-separated SHA-256,
        // store [1;16], request [2;16], sequence 4, zero effects. No new encoder.
        fn hex(value: &str) -> Result<Vec<u8>, std::num::ParseIntError> {
            (0..value.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&value[i..i + 2], 16))
                .collect()
        }
        let old_state = hex(
            "01010101010101010101010101010101010000000000000004059570c219db7d76c3ff0620696221c739fda4c15b877d039a86d4eecb0b84ec",
        )?;
        let old_receipt = hex(
            "0101010101010101010101010101010101191187ff2c111d9989fc0c127b30c721077bf9ab543bd1225e2c9320ae09a09702020202020202020202020202020202000000000000000400000000000000007943c69a1657475b93bb37f61cbdf50ced3e3295c081c7b44846d7e9a34efd63bcc245fba5313b19fdfc53360696b49347b51010c48df1ef2f9aafd08e5d337e",
        )?;
        let directory = TempDir::new()?;
        {
            let storage = RocksDbStorage::open(directory.path())?;
            storage
                .db
                .insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &old_state)?;
            let mut committed = GOVERNED_OUTCOME_COMMITTED.to_vec();
            committed.extend_from_slice(&old_receipt);
            storage.db.insert(
                &storage.default_cf,
                &governed_outcome_key(&[2; 16]),
                &committed,
            )?;
        }
        let storage = RocksDbStorage::open(directory.path())?;
        let old = CommitReceipt::decode(&old_receipt)?;
        assert_eq!(old.sequence(), 4);
        assert_eq!(old.encode(), old_receipt);
        assert_eq!(GovernanceState::decode(&old_state)?.encode(), old_state);
        assert_eq!(
            storage.lookup_commit_receipt(&[2; 16])?,
            CommitReceiptOutcome::Committed(old.clone())
        );
        assert!(
            storage
                .read_outbox(None, NonZeroUsize::MIN)?
                .coverage()
                .is_none()
        );
        // Read-only opens do not activate an outbox or alter old record bytes.
        drop(storage);
        let read_only = RocksDbStorage::open_read_only(directory.path())?;
        assert!(
            read_only
                .read_outbox(None, NonZeroUsize::MIN)?
                .records()
                .is_empty()
        );
        drop(read_only);
        let storage = RocksDbStorage::open(directory.path())?;
        assert_eq!(
            storage
                .db
                .get(&storage.default_cf, GOVERNANCE_STATE_KEY)?
                .as_deref(),
            Some(old_state.as_slice())
        );
        let receipt = storage
            .start_governed_transaction_with_control(
                &[3; 16],
                &TransactionStartControl::new(),
                Instant::now(),
            )
            .map_err(|_| "admission failed")?
            .commit_with_receipt(&SemanticChangeSet::default(), None)?;
        assert_eq!(receipt.schema_version(), 2);
        assert_eq!(receipt.sequence(), 5);
        assert_eq!(receipt.store_identity(), old.store_identity());
        assert_eq!(
            storage.lookup_commit_receipt(&[2; 16])?,
            CommitReceiptOutcome::Committed(old)
        );
        let page = storage.read_outbox(None, NonZeroUsize::MIN)?;
        assert_eq!(page.coverage().unwrap().after_receipt_sequence(), 4);
        assert!(
            matches!(page.records(), [OutboxRecord::Commit { receipt: actual, .. }] if actual == &receipt)
        );
        let good_state = storage
            .db
            .get(&storage.default_cf, GOVERNANCE_STATE_KEY)?
            .unwrap()
            .to_vec();
        for mode in [
            "v1-state",
            "origin",
            "high-water",
            "malformed-key",
            "gap",
            "record-version",
        ] {
            let key = outbox_record_key(1);
            let good_record = storage.db.get(&storage.default_cf, &key)?.unwrap().to_vec();
            let mut malformed_key = key.clone();
            malformed_key.push(0);
            let mut damage = storage.db.start_readable_transaction()?;
            match mode {
                "v1-state" => damage.insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &old_state),
                "origin" | "high-water" => {
                    let mut state = GovernanceState::decode(&good_state)?;
                    let outbox = state.outbox.as_mut().unwrap();
                    if mode == "origin" {
                        outbox.after_receipt_sequence = 3;
                    } else {
                        outbox.high_water = 2;
                    }
                    damage.insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &state.encode());
                }
                "malformed-key" => damage.insert(&storage.default_cf, &malformed_key, &good_record),
                "gap" => damage.remove(&storage.default_cf, &key),
                _ => {
                    let mut bytes = good_record.clone();
                    bytes[0] = 9;
                    damage.insert(&storage.default_cf, &key, &bytes);
                }
            }
            damage.commit()?;
            assert!(
                matches!(
                    storage.read_outbox(None, NonZeroUsize::MIN),
                    Err(OutboxReadError::Storage(StorageError::Corruption(_)))
                ),
                "{mode}"
            );
            let control = TransactionStartControl::new();
            let next = storage
                .start_governed_transaction_with_control(&[4; 16], &control, Instant::now())
                .map_err(|_| "admission failed")?;
            assert!(
                matches!(
                    next.commit_with_receipt(&SemanticChangeSet::default(), None),
                    Err(TransactionCommitError::Rejected(StorageError::Corruption(
                        _
                    )))
                ),
                "{mode}"
            );
            if mode == "v1-state" {
                assert!(storage.lookup_commit_receipt(&[3; 16]).is_err());
            }
            let mut restore = storage.db.start_readable_transaction()?;
            restore.insert(&storage.default_cf, GOVERNANCE_STATE_KEY, &good_state);
            restore.insert(&storage.default_cf, &key, &good_record);
            restore.remove(&storage.default_cf, &malformed_key);
            // Fresh test key for each attempted corruption; not a production retry path.
            restore.remove(&storage.default_cf, &governed_outcome_key(&[4; 16]));
            restore.commit()?;
        }
        drop(storage);
        let storage = RocksDbStorage::open(directory.path())?;
        assert_eq!(storage.read_outbox(None, NonZeroUsize::MIN)?, page);
        Ok(())
    }

    #[test]
    fn test_send_sync() {
        fn is_send_sync<T: Send + Sync>() {}
        is_send_sync::<RocksDbStorage>();
        is_send_sync::<RocksDbStorageReader<'static>>();
        is_send_sync::<RocksDbStorageReadableTransaction<'_>>();
        is_send_sync::<RocksDbStorageBulkLoader<'_>>();
    }

    #[test]
    #[expect(clippy::panic_in_result_fn)]
    fn test_transaction() -> Result<(), StorageError> {
        let example = NamedNode::new_unchecked("http://example.com/1");
        let example2 = NamedNode::new_unchecked("http://example.com/2");
        let encoded_example = EncodedTerm::from(&example);
        let encoded_example2 = EncodedTerm::from(&example2);
        let default_quad = Quad::new(
            example.clone(),
            example.clone(),
            example.clone(),
            GraphName::DefaultGraph,
        );
        let encoded_default_quad = EncodedQuad::from(&default_quad);
        let named_graph_quad = Quad::new(
            example.clone(),
            example.clone(),
            example.clone(),
            example.clone(),
        );
        let encoded_named_graph_quad = EncodedQuad::from(&named_graph_quad);

        let path = TempDir::new()?;
        let storage = RocksDbStorage::open(path.as_ref())?;

        // We start with a graph
        let snapshot = storage.snapshot();
        let mut transaction = storage.start_transaction()?;
        transaction.insert_named_graph(example.clone().into());
        transaction.commit()?;
        assert!(!snapshot.contains_named_graph(&encoded_example)?);
        assert!(storage.snapshot().contains_named_graph(&encoded_example)?);
        storage.snapshot().validate()?;

        // We add two quads
        let snapshot = storage.snapshot();
        let mut transaction = storage.start_transaction()?;
        transaction.insert(default_quad.clone());
        transaction.insert(named_graph_quad.clone());
        transaction.commit()?;
        assert!(!snapshot.contains(&encoded_default_quad)?);
        assert!(!snapshot.contains(&encoded_named_graph_quad)?);
        assert!(storage.snapshot().contains(&encoded_default_quad)?);
        assert!(storage.snapshot().contains(&encoded_named_graph_quad)?);
        storage.snapshot().validate()?;

        // We remove the quads
        let snapshot = storage.snapshot();
        let mut transaction = storage.start_readable_transaction()?;
        transaction.remove(&default_quad);
        let example_graph: NamedOrBlankNode = example.into();
        transaction.remove_named_graph(&example_graph)?;
        transaction.commit()?;
        assert!(snapshot.contains(&encoded_default_quad)?);
        assert!(snapshot.contains(&encoded_named_graph_quad)?);
        assert!(snapshot.contains_named_graph(&encoded_example)?);
        assert!(!storage.snapshot().contains(&encoded_default_quad)?);
        assert!(!storage.snapshot().contains(&encoded_named_graph_quad)?);
        assert!(!storage.snapshot().contains_named_graph(&encoded_example)?);
        storage.snapshot().validate()?;

        // We add the quads again but rollback
        let snapshot = storage.snapshot();
        let mut transaction = storage.start_transaction()?;
        transaction.insert(default_quad.clone());
        transaction.insert(named_graph_quad.clone());
        transaction.insert_named_graph(example2.clone().into());
        drop(transaction);
        assert!(!snapshot.contains(&encoded_default_quad)?);
        assert!(!snapshot.contains(&encoded_named_graph_quad)?);
        assert!(!snapshot.contains_named_graph(&encoded_example)?);
        assert!(!snapshot.contains_named_graph(&encoded_example2)?);
        assert!(!storage.snapshot().contains(&encoded_default_quad)?);
        assert!(!storage.snapshot().contains(&encoded_named_graph_quad)?);
        assert!(!storage.snapshot().contains_named_graph(&encoded_example)?);
        assert!(!storage.snapshot().contains_named_graph(&encoded_example2)?);
        storage.snapshot().validate()?;

        // We add quads and graph, then clear
        let mut loader = storage.bulk_loader();
        loader.load_batch(vec![default_quad, named_graph_quad], 1)?;
        loader.commit()?;
        let mut transaction = storage.start_transaction()?;
        transaction.insert_named_graph(example2.into());
        transaction.commit()?;
        let mut transaction = storage.start_transaction()?;
        transaction.clear();
        transaction.commit()?;
        assert!(!storage.snapshot().contains(&encoded_default_quad)?);
        assert!(!storage.snapshot().contains(&encoded_named_graph_quad)?);
        assert!(!storage.snapshot().contains_named_graph(&encoded_example)?);
        assert!(!storage.snapshot().contains_named_graph(&encoded_example2)?);
        assert!(storage.snapshot().is_empty()?);
        storage.snapshot().validate()?;

        Ok(())
    }

    #[test]
    #[expect(clippy::panic_in_result_fn)]
    fn clear_graphs_in_multiple_batches_preserve_topology_and_metadata()
    -> Result<(), Box<dyn std::error::Error>> {
        for clear_all in [false, true] {
            let path = TempDir::new()?;
            let storage = RocksDbStorage::open(path.as_ref())?;

            let graphs = (0..5)
                .map(|index| NamedNode::new_unchecked(format!("urn:batch:graph:{index}")))
                .collect::<Vec<_>>();
            let named_quads = graphs
                .iter()
                .enumerate()
                .map(|(index, graph)| {
                    Quad::new(
                        NamedNode::new_unchecked(format!("urn:batch:subject:{index}")),
                        NamedNode::new_unchecked("urn:batch:predicate"),
                        NamedNode::new_unchecked("urn:batch:object"),
                        graph.clone(),
                    )
                })
                .collect::<Vec<_>>();
            let encoded_graphs = graphs.iter().map(EncodedTerm::from).collect::<Vec<_>>();
            let encoded_named_quads = named_quads
                .iter()
                .map(EncodedQuad::from)
                .collect::<Vec<_>>();

            let default_quad = Quad::new(
                NamedNode::new_unchecked("urn:batch:default-subject"),
                NamedNode::new_unchecked("urn:batch:predicate"),
                NamedNode::new_unchecked("urn:batch:object"),
                GraphName::DefaultGraph,
            );
            let encoded_default_quad = EncodedQuad::from(&default_quad);
            let namespace = Namespace::new(
                NamespacePrefix::new("batch")?,
                NamedNode::new_unchecked("urn:batch:namespace:"),
            );
            let committed_key = [0x41; 16];
            let rolled_back_key = [0x42; 16];

            let mut setup = storage.start_transaction()?;
            setup.insert(default_quad);
            for (graph, quad) in graphs.iter().zip(&named_quads) {
                setup.insert_named_graph(graph.clone().into());
                setup.insert(quad.clone());
            }
            setup.set_namespace(namespace.clone());
            setup.commit()?;

            storage.write_raw_transaction_outcome_record(
                &committed_key,
                TRANSACTION_OUTCOME_COMMITTED,
            )?;
            storage.write_raw_transaction_outcome_record(
                &rolled_back_key,
                TRANSACTION_OUTCOME_ROLLED_BACK,
            )?;

            let mut zero_batch = storage.start_readable_transaction()?;
            assert!(zero_batch.clear_all_named_graphs_in_batches(0).is_err());
            drop(zero_batch);

            let before = storage.snapshot();
            assert_eq!(
                before.named_graphs().collect::<Result<Vec<_>, _>>()?.len(),
                5
            );
            assert_eq!(before.namespaces()?, vec![namespace.clone()]);
            assert_eq!(
                storage.lookup_transaction_outcome(&committed_key)?,
                StorageTransactionOutcome::Committed
            );
            assert_eq!(
                storage.lookup_transaction_outcome(&rolled_back_key)?,
                StorageTransactionOutcome::RolledBack
            );
            before.validate()?;

            let mut transaction = storage.start_readable_transaction()?;
            if clear_all {
                transaction.clear_all_graphs_in_batches(2)?;
            } else {
                transaction.clear_all_named_graphs_in_batches(2)?;
            }
            transaction.commit()?;

            let after = storage.snapshot();
            assert_eq!(after.contains(&encoded_default_quad)?, !clear_all);
            assert_eq!(after.is_empty()?, clear_all);
            for graph in &encoded_graphs {
                assert!(after.contains_named_graph(graph)?);
            }
            for quad in &encoded_named_quads {
                assert!(!after.contains(quad)?);
            }
            assert_eq!(
                after.named_graphs().collect::<Result<Vec<_>, _>>()?.len(),
                5
            );
            assert_eq!(after.namespaces()?, vec![namespace]);
            assert_eq!(
                storage.lookup_transaction_outcome(&committed_key)?,
                StorageTransactionOutcome::Committed
            );
            assert_eq!(
                storage.lookup_transaction_outcome(&rolled_back_key)?,
                StorageTransactionOutcome::RolledBack
            );
            after.validate()?;
        }
        Ok(())
    }
}
