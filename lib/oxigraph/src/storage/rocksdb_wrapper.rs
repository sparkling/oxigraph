//! Code inspired by [Rust RocksDB](https://github.com/rust-rocksdb/rust-rocksdb) under Apache License 2.0.

#![expect(
    unsafe_code,
    clippy::undocumented_unsafe_blocks,
    clippy::panic_in_result_fn,
    clippy::struct_field_names,
    clippy::unwrap_in_result,
    reason = "the private RocksDB wrapper owns audited FFI and byte-denominated evidence fields"
)]
#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "the diagnostics-only maintenance seam is consumed by tests until its internal observer is integrated"
    )
)]
#![cfg_attr(
    test,
    expect(
        clippy::expect_used,
        clippy::same_name_method,
        reason = "test fixtures retain attributable assertions and a RED fallback trait shadowed by the product seam"
    )
)]

use crate::storage::StorageTransactionStartError;
#[cfg(test)]
use crate::storage::TransactionOutcomeFaultPoint;
use crate::storage::TransactionStartControl;
use crate::storage::error::{CorruptionError, StorageError};
use oxrocksdb_sys::*;
use rand::random;
use std::borrow::Borrow;
#[cfg(unix)]
use std::cmp::min;
use std::collections::HashMap;
use std::error::Error;
use std::ffi::CString;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread::available_parallelism;
use std::time::Instant;
use std::{fmt, io, ptr, slice};

macro_rules! ffi_result {
    ( $($function:ident)::*( $arg1:expr $(, $arg:expr)* $(,)? ) ) => {{
        let mut error: *mut ::std::ffi::c_char = ::std::ptr::null_mut();
        let result = $($function)::*($arg1 $(, $arg)* , &mut error);
        if error.is_null() {
            Ok(result)
        } else {
            Err(ErrorStatus(::std::ffi::CString::from_raw(error)))
        }
    }}
}

pub struct ColumnFamilyDefinition {
    pub name: &'static str,
    pub use_iter: bool,
    pub min_prefix_size: usize,
    pub unordered_writes: bool,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct DbOptions {
    pub max_open_files: Option<i32>,
    pub fd_reserve: Option<u32>,
}

#[derive(Clone)]
pub struct Db {
    inner: DbKind,
}

#[derive(Clone)]
enum DbKind {
    ReadOnly(Arc<RoDbHandler>),
    ReadWrite(Arc<RwDbHandler>),
}

const ROCKSDB_MAINTENANCE_EVIDENCE_SCHEMA_VERSION: u16 = 1;
#[expect(
    dead_code,
    reason = "the exact vendored identity is retained as an independently audited contract constant"
)]
const VENDORED_ROCKSDB_VERSION: &str = "11.1.2";
#[expect(
    dead_code,
    reason = "the exact vendored identity is retained as an independently audited contract constant"
)]
const VENDORED_ROCKSDB_SOURCE_REVISION: &str = "3b446089141659fad25328c5ea3e7ed283df46e4";

const ROCKSDB_COMPACTION_PENDING: &str = "rocksdb.compaction-pending";
const ROCKSDB_PENDING_COMPACTION_BYTES: &str = "rocksdb.estimate-pending-compaction-bytes";
const ROCKSDB_BACKGROUND_ERRORS: &str = "rocksdb.background-errors";
const ROCKSDB_WRITES_STOPPED: &str = "rocksdb.is-write-stopped";
const ROCKSDB_DELAYED_WRITE_RATE: &str = "rocksdb.actual-delayed-write-rate";
const ROCKSDB_LIVE_SST_BYTES: &str = "rocksdb.live-sst-files-size";
const ROCKSDB_MEMTABLE_BYTES: &str = "rocksdb.size-all-mem-tables";
const ROCKSDB_TABLE_READER_BYTES: &str = "rocksdb.estimate-table-readers-mem";

fn rocksdb_maintenance_statistics_tickers() -> [u32; 5] {
    unsafe {
        [
            oxrocksdb_ticker_user_bytes_written(),
            oxrocksdb_ticker_stall_micros(),
            oxrocksdb_ticker_compact_read_bytes(),
            oxrocksdb_ticker_compact_write_bytes(),
            oxrocksdb_ticker_flush_write_bytes(),
        ]
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum RocksDbMaintenanceSignal<T> {
    Available(T),
    Unavailable,
    Unsupported,
}

impl<T> RocksDbMaintenanceSignal<T> {
    const fn available(&self) -> Option<&T> {
        match self {
            Self::Available(value) => Some(value),
            Self::Unavailable | Self::Unsupported => None,
        }
    }

    const fn is_available(&self) -> bool {
        matches!(self, Self::Available(_))
    }

    const fn is_unavailable(&self) -> bool {
        matches!(self, Self::Unavailable)
    }

    const fn is_unsupported(&self) -> bool {
        matches!(self, Self::Unsupported)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum RocksDbMaintenanceAuthority {
    DiagnosticsOnly,
}

impl RocksDbMaintenanceAuthority {
    const fn is_diagnostics_only(&self) -> bool {
        matches!(self, Self::DiagnosticsOnly)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum RocksDbMaintenanceBackend {
    RocksDb,
}

impl RocksDbMaintenanceBackend {
    const fn is_rocksdb(&self) -> bool {
        matches!(self, Self::RocksDb)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum RocksDbMaintenanceBuild {
    Vendored {
        rocksdb_version: &'static str,
        source_revision: &'static str,
    },
    System {
        rocksdb_version: String,
    },
}

impl RocksDbMaintenanceBuild {
    const fn is_vendored(&self) -> bool {
        matches!(self, Self::Vendored { .. })
    }

    const fn is_system(&self) -> bool {
        matches!(self, Self::System { .. })
    }

    fn rocksdb_version(&self) -> &str {
        match self {
            Self::Vendored {
                rocksdb_version, ..
            } => rocksdb_version,
            Self::System { rocksdb_version } => rocksdb_version,
        }
    }

    const fn source_revision(&self) -> Option<&str> {
        match self {
            Self::Vendored {
                source_revision, ..
            } => Some(source_revision),
            Self::System { .. } => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum RocksDbMaintenanceOpenMode {
    ReadWrite,
    ReadOnly,
}

impl RocksDbMaintenanceOpenMode {
    const fn is_read_write(&self) -> bool {
        matches!(self, Self::ReadWrite)
    }

    const fn is_read_only(&self) -> bool {
        matches!(self, Self::ReadOnly)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbMaintenanceBackendIdentity {
    backend: RocksDbMaintenanceBackend,
    build: RocksDbMaintenanceBuild,
}

impl RocksDbMaintenanceBackendIdentity {
    const fn backend(&self) -> &RocksDbMaintenanceBackend {
        &self.backend
    }

    const fn build(&self) -> &RocksDbMaintenanceBuild {
        &self.build
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbMaintenanceRuntimeIdentity {
    database_id: RocksDbMaintenanceSignal<String>,
    open_mode: RocksDbMaintenanceOpenMode,
    latest_sequence_number: u64,
}

impl RocksDbMaintenanceRuntimeIdentity {
    const fn database_id(&self) -> &RocksDbMaintenanceSignal<String> {
        &self.database_id
    }

    const fn open_mode(&self) -> &RocksDbMaintenanceOpenMode {
        &self.open_mode
    }

    const fn latest_sequence_number(&self) -> u64 {
        self.latest_sequence_number
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbCompactionEvidence {
    pending: RocksDbMaintenanceSignal<bool>,
    estimated_pending_bytes: RocksDbMaintenanceSignal<u64>,
}

impl RocksDbCompactionEvidence {
    const fn pending(&self) -> &RocksDbMaintenanceSignal<bool> {
        &self.pending
    }

    const fn estimated_pending_bytes(&self) -> &RocksDbMaintenanceSignal<u64> {
        &self.estimated_pending_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbHealthEvidence {
    background_errors: RocksDbMaintenanceSignal<u64>,
}

impl RocksDbHealthEvidence {
    const fn background_errors(&self) -> &RocksDbMaintenanceSignal<u64> {
        &self.background_errors
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbStallEvidence {
    writes_stopped: RocksDbMaintenanceSignal<bool>,
    delayed_write_rate_bytes_per_second: RocksDbMaintenanceSignal<u64>,
}

impl RocksDbStallEvidence {
    const fn writes_stopped(&self) -> &RocksDbMaintenanceSignal<bool> {
        &self.writes_stopped
    }

    const fn delayed_write_rate_bytes_per_second(&self) -> &RocksDbMaintenanceSignal<u64> {
        &self.delayed_write_rate_bytes_per_second
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbResourceEvidence {
    live_sst_bytes: RocksDbMaintenanceSignal<u64>,
    memtable_bytes: RocksDbMaintenanceSignal<u64>,
    table_reader_bytes: RocksDbMaintenanceSignal<u64>,
}

impl RocksDbResourceEvidence {
    const fn live_sst_bytes(&self) -> &RocksDbMaintenanceSignal<u64> {
        &self.live_sst_bytes
    }

    const fn memtable_bytes(&self) -> &RocksDbMaintenanceSignal<u64> {
        &self.memtable_bytes
    }

    const fn table_reader_bytes(&self) -> &RocksDbMaintenanceSignal<u64> {
        &self.table_reader_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbColumnFamilyMaintenanceEvidence {
    name: &'static str,
    compaction: RocksDbCompactionEvidence,
    health: RocksDbHealthEvidence,
    stalls: RocksDbStallEvidence,
    resources: RocksDbResourceEvidence,
}

impl RocksDbColumnFamilyMaintenanceEvidence {
    const fn name(&self) -> &str {
        self.name
    }

    const fn compaction(&self) -> &RocksDbCompactionEvidence {
        &self.compaction
    }

    const fn health(&self) -> &RocksDbHealthEvidence {
        &self.health
    }

    const fn stalls(&self) -> &RocksDbStallEvidence {
        &self.stalls
    }

    const fn resources(&self) -> &RocksDbResourceEvidence {
        &self.resources
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbAmplificationEvidence {
    user_bytes_written: RocksDbMaintenanceSignal<u64>,
    stall_micros: RocksDbMaintenanceSignal<u64>,
    compaction_read_bytes: RocksDbMaintenanceSignal<u64>,
    compaction_write_bytes: RocksDbMaintenanceSignal<u64>,
    flush_write_bytes: RocksDbMaintenanceSignal<u64>,
}

impl RocksDbAmplificationEvidence {
    const fn signals(&self) -> [&RocksDbMaintenanceSignal<u64>; 5] {
        [
            &self.user_bytes_written,
            &self.stall_micros,
            &self.compaction_read_bytes,
            &self.compaction_write_bytes,
            &self.flush_write_bytes,
        ]
    }

    const fn user_bytes_written(&self) -> &RocksDbMaintenanceSignal<u64> {
        &self.user_bytes_written
    }

    const fn flush_write_bytes(&self) -> &RocksDbMaintenanceSignal<u64> {
        &self.flush_write_bytes
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RocksDbMaintenanceEvidence {
    schema_version: u16,
    authority: RocksDbMaintenanceAuthority,
    backend: RocksDbMaintenanceBackendIdentity,
    runtime: RocksDbMaintenanceRuntimeIdentity,
    column_families: Vec<RocksDbColumnFamilyMaintenanceEvidence>,
    amplification: RocksDbAmplificationEvidence,
    build: RocksDbMaintenanceBuild,
}

impl RocksDbMaintenanceEvidence {
    const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    const fn authority(&self) -> &RocksDbMaintenanceAuthority {
        &self.authority
    }

    const fn backend(&self) -> &RocksDbMaintenanceBackendIdentity {
        let _: &RocksDbMaintenanceBuild = &self.build;
        &self.backend
    }

    const fn runtime(&self) -> &RocksDbMaintenanceRuntimeIdentity {
        &self.runtime
    }

    fn column_families(&self) -> &[RocksDbColumnFamilyMaintenanceEvidence] {
        &self.column_families
    }

    const fn amplification(&self) -> &RocksDbAmplificationEvidence {
        &self.amplification
    }
}

fn rocksdb_maintenance_build() -> RocksDbMaintenanceBuild {
    match (
        ::core::option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND"),
        ::core::option_env!("OXIGRAPH_ROCKSDB_VERSION"),
        ::core::option_env!("OXIGRAPH_ROCKSDB_SOURCE_REVISION"),
    ) {
        (Some("vendored"), Some(rocksdb_version), Some(source_revision)) => {
            RocksDbMaintenanceBuild::Vendored {
                rocksdb_version,
                source_revision,
            }
        }
        (Some("system"), Some(rocksdb_version), None) if !rocksdb_version.is_empty() => {
            RocksDbMaintenanceBuild::System {
                rocksdb_version: rocksdb_version.to_owned(),
            }
        }
        _ => ::core::unreachable!(),
    }
}

fn rocksdb_maintenance_backend_identity() -> RocksDbMaintenanceBackendIdentity {
    RocksDbMaintenanceBackendIdentity {
        backend: RocksDbMaintenanceBackend::RocksDb,
        build: rocksdb_maintenance_build(),
    }
}

fn rocksdb_unsupported_amplification() -> RocksDbAmplificationEvidence {
    RocksDbAmplificationEvidence {
        user_bytes_written: RocksDbMaintenanceSignal::Unsupported,
        stall_micros: RocksDbMaintenanceSignal::Unsupported,
        compaction_read_bytes: RocksDbMaintenanceSignal::Unsupported,
        compaction_write_bytes: RocksDbMaintenanceSignal::Unsupported,
        flush_write_bytes: RocksDbMaintenanceSignal::Unsupported,
    }
}

fn rocksdb_property_signal(value: &Result<u64, StorageError>) -> RocksDbMaintenanceSignal<u64> {
    match value {
        Ok(value) => RocksDbMaintenanceSignal::Available(*value),
        Err(_) => RocksDbMaintenanceSignal::Unavailable,
    }
}

fn rocksdb_boolean_property_signal(
    value: &Result<u64, StorageError>,
) -> RocksDbMaintenanceSignal<bool> {
    match value {
        Ok(0) => RocksDbMaintenanceSignal::Available(false),
        Ok(1) => RocksDbMaintenanceSignal::Available(true),
        Ok(_) | Err(_) => RocksDbMaintenanceSignal::Unavailable,
    }
}

struct RwDbHandler {
    db: *mut rocksdb_t,
    options: *mut rocksdb_options_t,
    read_options: *mut rocksdb_readoptions_t,
    write_options: *mut rocksdb_writeoptions_t,
    sync_write_options: *mut rocksdb_writeoptions_t,
    flush_options: *mut rocksdb_flushoptions_t,
    env_options: *mut rocksdb_envoptions_t,
    ingest_external_file_options: *mut rocksdb_ingestexternalfileoptions_t,
    compaction_options: *mut rocksdb_compactoptions_t,
    block_based_table_options: *mut rocksdb_block_based_table_options_t,
    writer_gate: Arc<WriterGate>,
    column_family_names: Vec<&'static str>,
    cf_handles: Vec<*mut rocksdb_column_family_handle_t>,
    cf_options: Vec<*mut rocksdb_options_t>,
    path: PathBuf,
    #[cfg(test)]
    transaction_outcome_fault_control: Mutex<TransactionOutcomeFaultControl>,
}

#[cfg(test)]
#[derive(Default)]
struct TransactionOutcomeFaultControl {
    plan: Option<TransactionOutcomeFaultPoint>,
    events: Vec<TransactionOutcomeFaultPoint>,
}

#[cfg(test)]
impl RwDbHandler {
    fn arm_transaction_outcome_fault(&self, point: TransactionOutcomeFaultPoint) {
        let mut control = self
            .transaction_outcome_fault_control
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        control.plan = Some(point);
        control.events.clear();
    }

    fn transaction_outcome_fault_events(&self) -> Vec<TransactionOutcomeFaultPoint> {
        self.transaction_outcome_fault_control
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .events
            .clone()
    }

    fn visit_transaction_outcome_fault_point(
        &self,
        point: TransactionOutcomeFaultPoint,
    ) -> Result<(), StorageError> {
        let mut control = self
            .transaction_outcome_fault_control
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        control.events.push(point);
        if control.plan == Some(point) {
            control.plan = None;
            return Err(StorageError::Other(
                format!("injected transaction-outcome fault at {point:?}").into(),
            ));
        }
        Ok(())
    }
}

unsafe impl Send for RwDbHandler {}

unsafe impl Sync for RwDbHandler {}

struct WriterGate {
    occupied: Mutex<bool>,
    available: Condvar,
}

impl WriterGate {
    fn acquire(self: &Arc<Self>) -> WriterPermit {
        let mut occupied = self
            .occupied
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while *occupied {
            occupied = self
                .available
                .wait(occupied)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        *occupied = true;
        WriterPermit {
            gate: Arc::clone(self),
        }
    }

    fn acquire_with_control(
        self: &Arc<Self>,
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<WriterPermit, StorageTransactionStartError> {
        control.check(started_at)?;
        let mut occupied = self
            .occupied
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while *occupied {
            let wait = control.next_wait(started_at)?;
            (occupied, _) = self
                .available
                .wait_timeout(occupied, wait)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        control.check(started_at)?;
        *occupied = true;
        Ok(WriterPermit {
            gate: Arc::clone(self),
        })
    }
}

struct WriterPermit {
    gate: Arc<WriterGate>,
}

impl Drop for WriterPermit {
    fn drop(&mut self) {
        let mut occupied = self
            .gate
            .occupied
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *occupied = false;
        self.gate.available.notify_one();
    }
}

impl Drop for RwDbHandler {
    fn drop(&mut self) {
        unsafe {
            for cf_handle in &self.cf_handles {
                rocksdb_column_family_handle_destroy(*cf_handle);
            }
            rocksdb_close(self.db);
            for cf_option in &self.cf_options {
                rocksdb_options_destroy(*cf_option);
            }
            rocksdb_readoptions_destroy(self.read_options);
            rocksdb_writeoptions_destroy(self.write_options);
            rocksdb_writeoptions_destroy(self.sync_write_options);
            rocksdb_flushoptions_destroy(self.flush_options);
            rocksdb_envoptions_destroy(self.env_options);
            rocksdb_ingestexternalfileoptions_destroy(self.ingest_external_file_options);
            rocksdb_compactoptions_destroy(self.compaction_options);
            rocksdb_options_destroy(self.options);
            rocksdb_block_based_options_destroy(self.block_based_table_options);
        }
    }
}

struct RoDbHandler {
    db: *mut rocksdb_t,
    options: *mut rocksdb_options_t,
    read_options: *mut rocksdb_readoptions_t,
    column_family_names: Vec<&'static str>,
    cf_handles: Vec<*mut rocksdb_column_family_handle_t>,
    cf_options: Vec<*mut rocksdb_options_t>,
}

unsafe impl Send for RoDbHandler {}

unsafe impl Sync for RoDbHandler {}

impl Drop for RoDbHandler {
    fn drop(&mut self) {
        unsafe {
            for cf_handle in &self.cf_handles {
                rocksdb_column_family_handle_destroy(*cf_handle);
            }
            rocksdb_close(self.db);
            for cf_option in &self.cf_options {
                rocksdb_options_destroy(*cf_option);
            }
            rocksdb_readoptions_destroy(self.read_options);
            rocksdb_options_destroy(self.options);
        }
    }
}

impl Db {
    const DEFAULT_FD_RESERVE: u32 = 48;
    const MINIMUM_MAX_OPEN_FILES: u64 = 48;

    fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence {
        let evidence = self.maintenance_evidence_with_readers(
            |column_family, property| self.read_rocksdb_property(column_family, property),
            |ticker| self.read_rocksdb_statistic(ticker),
        );
        RocksDbMaintenanceEvidence {
            schema_version: evidence.schema_version,
            authority: evidence.authority,
            backend: evidence.backend,
            runtime: evidence.runtime,
            column_families: evidence.column_families,
            amplification: evidence.amplification,
            build: rocksdb_maintenance_build(),
        }
    }

    fn maintenance_evidence_with_readers<P, S>(
        &self,
        property_reader: P,
        mut statistics_reader: S,
    ) -> RocksDbMaintenanceEvidence
    where
        P: FnMut(&str, &str) -> Result<u64, StorageError>,
        S: FnMut(u32) -> Result<u64, StorageError>,
    {
        let statistics_tickers = rocksdb_maintenance_statistics_tickers();
        let amplification = if cfg!(feature = "rocksdb-debug") && self.is_writable() {
            let mut values = Vec::with_capacity(statistics_tickers.len());
            for ticker in statistics_tickers {
                values.push(rocksdb_property_signal(&statistics_reader(ticker)));
            }
            RocksDbAmplificationEvidence {
                user_bytes_written: values.remove(0),
                stall_micros: values.remove(0),
                compaction_read_bytes: values.remove(0),
                compaction_write_bytes: values.remove(0),
                flush_write_bytes: values.remove(0),
            }
        } else {
            rocksdb_unsupported_amplification()
        };
        let (runtime, column_families) = self.collect_maintenance_evidence(property_reader);
        RocksDbMaintenanceEvidence {
            schema_version: ROCKSDB_MAINTENANCE_EVIDENCE_SCHEMA_VERSION,
            authority: RocksDbMaintenanceAuthority::DiagnosticsOnly,
            backend: rocksdb_maintenance_backend_identity(),
            runtime,
            column_families,
            amplification,
            build: rocksdb_maintenance_build(),
        }
    }

    fn collect_maintenance_evidence<P>(
        &self,
        mut property_reader: P,
    ) -> (
        RocksDbMaintenanceRuntimeIdentity,
        Vec<RocksDbColumnFamilyMaintenanceEvidence>,
    )
    where
        P: FnMut(&str, &str) -> Result<u64, StorageError>,
    {
        let names = match &self.inner {
            DbKind::ReadOnly(db) => &db.column_family_names,
            DbKind::ReadWrite(db) => &db.column_family_names,
        };
        let mut column_families = Vec::with_capacity(names.len());
        for &name in names {
            column_families.push(RocksDbColumnFamilyMaintenanceEvidence {
                name,
                compaction: RocksDbCompactionEvidence {
                    pending: rocksdb_boolean_property_signal(&property_reader(
                        name,
                        ROCKSDB_COMPACTION_PENDING,
                    )),
                    estimated_pending_bytes: rocksdb_property_signal(&property_reader(
                        name,
                        ROCKSDB_PENDING_COMPACTION_BYTES,
                    )),
                },
                health: RocksDbHealthEvidence {
                    background_errors: rocksdb_property_signal(&property_reader(
                        name,
                        ROCKSDB_BACKGROUND_ERRORS,
                    )),
                },
                stalls: RocksDbStallEvidence {
                    writes_stopped: rocksdb_boolean_property_signal(&property_reader(
                        name,
                        ROCKSDB_WRITES_STOPPED,
                    )),
                    delayed_write_rate_bytes_per_second: rocksdb_property_signal(&property_reader(
                        name,
                        ROCKSDB_DELAYED_WRITE_RATE,
                    )),
                },
                resources: RocksDbResourceEvidence {
                    live_sst_bytes: rocksdb_property_signal(&property_reader(
                        name,
                        ROCKSDB_LIVE_SST_BYTES,
                    )),
                    memtable_bytes: rocksdb_property_signal(&property_reader(
                        name,
                        ROCKSDB_MEMTABLE_BYTES,
                    )),
                    table_reader_bytes: rocksdb_property_signal(&property_reader(
                        name,
                        ROCKSDB_TABLE_READER_BYTES,
                    )),
                },
            });
        }
        (
            RocksDbMaintenanceRuntimeIdentity {
                database_id: self.rocksdb_database_id(),
                open_mode: if self.is_writable() {
                    RocksDbMaintenanceOpenMode::ReadWrite
                } else {
                    RocksDbMaintenanceOpenMode::ReadOnly
                },
                latest_sequence_number: unsafe {
                    rocksdb_get_latest_sequence_number(self.raw_rocksdb())
                },
            },
            column_families,
        )
    }

    fn raw_rocksdb(&self) -> *mut rocksdb_t {
        match &self.inner {
            DbKind::ReadOnly(db) => db.db,
            DbKind::ReadWrite(db) => db.db,
        }
    }

    fn read_rocksdb_property(
        &self,
        column_family: &str,
        property: &str,
    ) -> Result<u64, StorageError> {
        let (db, names, handles) = match &self.inner {
            DbKind::ReadOnly(handler) => (
                handler.db,
                &handler.column_family_names,
                &handler.cf_handles,
            ),
            DbKind::ReadWrite(handler) => (
                handler.db,
                &handler.column_family_names,
                &handler.cf_handles,
            ),
        };
        let index = names
            .iter()
            .position(|name| *name == column_family)
            .ok_or_else(|| {
                StorageError::Other(
                    format!("unknown RocksDB column family: {column_family}").into(),
                )
            })?;
        let property = CString::new(property).map_err(|error| {
            StorageError::Other(format!("invalid RocksDB property name: {error}").into())
        })?;
        let mut value = 0;
        let status = unsafe {
            rocksdb_property_int_cf(db, handles[index], property.as_ptr(), &raw mut value)
        };
        if status == 0 {
            Ok(value)
        } else {
            Err(StorageError::Other(
                "RocksDB property is unavailable".into(),
            ))
        }
    }

    fn read_rocksdb_statistic(&self, ticker: u32) -> Result<u64, StorageError> {
        match &self.inner {
            DbKind::ReadOnly(_) => Err(StorageError::Other(
                "RocksDB statistics are unsupported for read-only opens".into(),
            )),
            DbKind::ReadWrite(handler) => {
                Ok(unsafe { rocksdb_options_statistics_get_ticker_count(handler.options, ticker) })
            }
        }
    }

    fn rocksdb_database_id(&self) -> RocksDbMaintenanceSignal<String> {
        let mut identity_len = 0;
        let identity =
            unsafe { rocksdb_get_db_identity(self.raw_rocksdb(), &raw mut identity_len) };
        let Some(identity) = NonNull::new(identity) else {
            return RocksDbMaintenanceSignal::Unavailable;
        };
        let identity = unsafe {
            let bytes = slice::from_raw_parts(identity.as_ptr().cast::<u8>(), identity_len);
            let value = String::from_utf8_lossy(bytes).into_owned();
            rocksdb_free(identity.as_ptr().cast());
            value
        };
        if identity.is_empty() {
            RocksDbMaintenanceSignal::Unavailable
        } else {
            RocksDbMaintenanceSignal::Available(identity)
        }
    }

    pub fn open_read_write(
        path: &Path,
        column_families: Vec<ColumnFamilyDefinition>,
        db_options: DbOptions,
    ) -> Result<Self, StorageError> {
        let c_path = path_to_cstring(path)?;
        unsafe {
            let options = Self::db_options(db_options)?;
            rocksdb_options_set_create_if_missing(options, 1);
            rocksdb_options_set_create_missing_column_families(options, 1);
            rocksdb_options_set_compression(options, rocksdb_lz4_compression.try_into().unwrap());
            let block_based_table_options = rocksdb_block_based_options_create();
            assert!(
                !block_based_table_options.is_null(),
                "rocksdb_block_based_options_create returned null"
            );
            rocksdb_block_based_options_set_format_version(block_based_table_options, 5);
            rocksdb_block_based_options_set_index_block_restart_interval(
                block_based_table_options,
                16,
            );
            rocksdb_options_set_block_based_table_factory(options, block_based_table_options);
            #[cfg(feature = "rocksdb-debug")]
            {
                rocksdb_options_set_info_log_level(options, 0);
                rocksdb_options_enable_statistics(options);
                rocksdb_options_set_stats_dump_period_sec(options, 60);
            }

            let (column_family_names, c_column_family_names, cf_options) =
                Self::column_families_names_and_options(column_families, options);
            let mut cf_handles: Vec<*mut rocksdb_column_family_handle_t> =
                vec![ptr::null_mut(); column_family_names.len()];
            let c_num_column_families = c_column_family_names.len().try_into().unwrap();

            let db = ffi_result!(rocksdb_open_column_families(
                options,
                c_path.as_ptr(),
                c_num_column_families,
                c_column_family_names
                    .iter()
                    .map(|cf| cf.as_ptr())
                    .collect::<Vec<_>>()
                    .as_ptr(),
                cf_options.as_ptr().cast(),
                cf_handles.as_mut_ptr(),
            ))
            .map_err(|e| {
                for cf_option in &cf_options {
                    rocksdb_options_destroy(*cf_option);
                }
                rocksdb_options_destroy(options);
                rocksdb_block_based_options_destroy(block_based_table_options);
                e
            })?;
            assert!(!db.is_null(), "rocksdb_create returned null");
            for handle in &cf_handles {
                assert!(
                    !handle.is_null(),
                    "rocksdb_readoptions_create returned a null column family"
                );
            }

            let read_options = rocksdb_readoptions_create();
            assert!(
                !read_options.is_null(),
                "rocksdb_readoptions_create returned null"
            );
            rocksdb_readoptions_set_async_io(read_options, 1);

            let write_options = rocksdb_writeoptions_create();
            assert!(
                !write_options.is_null(),
                "rocksdb_writeoptions_create returned null"
            );

            let sync_write_options = rocksdb_writeoptions_create();
            assert!(
                !sync_write_options.is_null(),
                "rocksdb_writeoptions_create returned null"
            );
            rocksdb_writeoptions_set_sync(sync_write_options, 1);

            let flush_options = rocksdb_flushoptions_create();
            assert!(
                !flush_options.is_null(),
                "rocksdb_flushoptions_create returned null"
            );

            let env_options = rocksdb_envoptions_create();
            assert!(
                !env_options.is_null(),
                "rocksdb_envoptions_create returned null"
            );

            let ingest_external_file_options = rocksdb_ingestexternalfileoptions_create();
            assert!(
                !ingest_external_file_options.is_null(),
                "rocksdb_ingestexternalfileoptions_create returned null"
            );

            let compaction_options = rocksdb_compactoptions_create();
            assert!(
                !compaction_options.is_null(),
                "rocksdb_compactoptions_create returned null"
            );

            Ok(Self {
                inner: DbKind::ReadWrite(Arc::new(RwDbHandler {
                    db,
                    options,
                    read_options,
                    write_options,
                    sync_write_options,
                    flush_options,
                    env_options,
                    ingest_external_file_options,
                    compaction_options,
                    block_based_table_options,
                    writer_gate: Arc::new(WriterGate {
                        occupied: Mutex::new(false),
                        available: Condvar::new(),
                    }),
                    column_family_names,
                    cf_handles,
                    cf_options,
                    path: path.into(),
                    #[cfg(test)]
                    transaction_outcome_fault_control: Mutex::new(
                        TransactionOutcomeFaultControl::default(),
                    ),
                })),
            })
        }
    }

    pub fn open_read_only(
        path: &Path,
        column_families: Vec<ColumnFamilyDefinition>,
    ) -> Result<Self, StorageError> {
        unsafe {
            let c_path = path_to_cstring(path)?;
            let options = Self::db_options(DbOptions::default())?;
            let (column_family_names, c_column_family_names, cf_options) =
                Self::column_families_names_and_options(column_families, options);
            let mut cf_handles: Vec<*mut rocksdb_column_family_handle_t> =
                vec![ptr::null_mut(); column_family_names.len()];
            let c_num_column_families = c_column_family_names.len().try_into().unwrap();
            let db = ffi_result!(rocksdb_open_for_read_only_column_families(
                options,
                c_path.as_ptr(),
                c_num_column_families,
                c_column_family_names
                    .iter()
                    .map(|cf| cf.as_ptr())
                    .collect::<Vec<_>>()
                    .as_ptr(),
                cf_options.as_ptr().cast(),
                cf_handles.as_mut_ptr(),
                0, // false
            ))
            .map_err(|e| {
                for cf_option in &cf_options {
                    rocksdb_options_destroy(*cf_option);
                }
                rocksdb_options_destroy(options);
                e
            })?;
            assert!(
                !db.is_null(),
                "rocksdb_open_for_read_only_column_families returned null"
            );
            for handle in &cf_handles {
                assert!(
                    !handle.is_null(),
                    "rocksdb_open_for_read_only_column_families returned a null column family"
                );
            }
            let read_options = rocksdb_readoptions_create();
            assert!(
                !read_options.is_null(),
                "rocksdb_readoptions_create returned null"
            );
            rocksdb_readoptions_set_async_io(read_options, 1);

            Ok(Self {
                inner: DbKind::ReadOnly(Arc::new(RoDbHandler {
                    db,
                    options,
                    read_options,
                    column_family_names,
                    cf_handles,
                    cf_options,
                })),
            })
        }
    }

    fn db_options(db_options: DbOptions) -> Result<*mut rocksdb_options_t, StorageError> {
        static ROCKSDB_ENV: OnceLock<UnsafeEnv> = OnceLock::new();
        unsafe {
            let options = rocksdb_options_create();
            assert!(!options.is_null(), "rocksdb_options_create returned null");
            rocksdb_options_optimize_level_style_compaction(options, 512 * 1024 * 1024);
            rocksdb_options_increase_parallelism(
                options,
                available_parallelism()?.get().try_into().unwrap(),
            );
            if let Some(max_open_files) = db_options.max_open_files {
                rocksdb_options_set_max_open_files(options, max_open_files);
            } else if let Some(available_fd) = available_file_descriptors()? {
                let max_open_files = Self::max_open_files_from_fd_limit(
                    available_fd,
                    db_options.fd_reserve.unwrap_or(Self::DEFAULT_FD_RESERVE),
                )
                .inspect_err(|_| rocksdb_options_destroy(options))?;
                rocksdb_options_set_max_open_files(options, max_open_files);
            }
            rocksdb_options_set_info_log_level(options, 2); // We only log warnings
            rocksdb_options_set_max_log_file_size(options, 1024 * 1024); // Only 1MB log size
            rocksdb_options_set_recycle_log_file_num(options, 10); // We do not keep more than 10 log files
            rocksdb_options_set_env(
                options,
                ROCKSDB_ENV
                    .get_or_init(|| {
                        let env = rocksdb_create_default_env();
                        assert!(!env.is_null(), "rocksdb_create_default_env returned null");
                        UnsafeEnv(env)
                    })
                    .0,
            );
            Ok(options)
        }
    }

    fn max_open_files_from_fd_limit(available_fd: u64, fd_reserve: u32) -> io::Result<i32> {
        let fd_reserve = u64::from(fd_reserve);
        let minimum_fd = fd_reserve + Self::MINIMUM_MAX_OPEN_FILES;
        if available_fd < minimum_fd {
            return Err(io::Error::other(format!(
                "Oxigraph needs at least {minimum_fd} file descriptors when reserving \
                {fd_reserve} descriptors for non-RocksDB usage, \
                only {available_fd} allowed. \
                Run e.g. `ulimit -n 512` to allow 512 opened files"
            )));
        }
        // macOS sometime set the number of available file descriptors as "unlimited" i.e. UINT64_MAX
        // We use 8192 in this case because the hard limit is typically around 10240.
        Ok((available_fd - fd_reserve).try_into().unwrap_or(8192))
    }

    fn column_families_names_and_options(
        mut column_families: Vec<ColumnFamilyDefinition>,
        base_options: *mut rocksdb_options_t,
    ) -> (Vec<&'static str>, Vec<CString>, Vec<*mut rocksdb_options_t>) {
        if !column_families.iter().any(|c| c.name == "default") {
            column_families.push(ColumnFamilyDefinition {
                name: "default",
                use_iter: true,
                min_prefix_size: 0,
                unordered_writes: false,
            })
        }
        let column_family_names = column_families.iter().map(|c| c.name).collect::<Vec<_>>();
        let c_column_family_names = column_family_names
            .iter()
            .map(|name| CString::new(*name).unwrap())
            .collect();

        let cf_options = column_families
            .into_iter()
            .map(|cf| unsafe {
                let options = rocksdb_options_create_copy(base_options);
                if !cf.use_iter {
                    rocksdb_options_optimize_for_point_lookup(options, 128);
                }
                if cf.min_prefix_size > 0 {
                    rocksdb_options_set_prefix_extractor(
                        options,
                        rocksdb_slicetransform_create_fixed_prefix(cf.min_prefix_size),
                    );
                }
                if cf.unordered_writes {
                    rocksdb_options_set_unordered_write(options, 1);
                }
                options
            })
            .collect::<Vec<_>>();
        (column_family_names, c_column_family_names, cf_options)
    }

    pub fn is_writable(&self) -> bool {
        match &self.inner {
            DbKind::ReadWrite(_) => true,
            DbKind::ReadOnly(_) => false,
        }
    }

    #[cfg(test)]
    pub(crate) fn arm_transaction_outcome_fault(
        &self,
        point: TransactionOutcomeFaultPoint,
    ) -> Result<(), StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "transaction-outcome fault control requires a read-write database".into(),
            ));
        };
        db.arm_transaction_outcome_fault(point);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn transaction_outcome_fault_events(
        &self,
    ) -> Result<Vec<TransactionOutcomeFaultPoint>, StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "transaction-outcome fault control requires a read-write database".into(),
            ));
        };
        Ok(db.transaction_outcome_fault_events())
    }

    pub fn column_family(&self, name: &'static str) -> Result<ColumnFamily, StorageError> {
        let (column_family_names, cf_handles) = match &self.inner {
            DbKind::ReadOnly(db) => (&db.column_family_names, &db.cf_handles),
            DbKind::ReadWrite(db) => (&db.column_family_names, &db.cf_handles),
        };
        for (cf, cf_handle) in column_family_names.iter().zip(cf_handles) {
            if *cf == name {
                return Ok(ColumnFamily(*cf_handle));
            }
        }
        Err(CorruptionError::from_missing_column_family_name(name).into())
    }

    #[must_use]
    pub fn snapshot(&self) -> Reader<'static> {
        unsafe {
            match &self.inner {
                DbKind::ReadOnly(db) => {
                    let options = oxrocksdb_readoptions_create_copy(db.read_options);
                    Reader {
                        inner: InnerReader::ReadOnly(Arc::clone(db)),
                        options,
                    }
                }
                DbKind::ReadWrite(db) => {
                    let options = oxrocksdb_readoptions_create_copy(db.read_options);
                    let snapshot = rocksdb_create_snapshot(db.db);
                    assert!(!snapshot.is_null(), "rocksdb_create_snapshot returned null");
                    rocksdb_readoptions_set_snapshot(options, snapshot);
                    Reader {
                        inner: InnerReader::ReadWrite(Arc::new(SnapshotReader {
                            db: Arc::clone(db),
                            snapshot,
                        })),
                        options,
                    }
                }
            }
        }
    }

    pub fn start_transaction(&self) -> Result<Transaction, StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "Transaction are only possible on read-write instances".into(),
            ));
        };
        let writer_permit = db.writer_gate.acquire();
        let batch = unsafe { rocksdb_writebatch_create() };
        assert!(!batch.is_null(), "rocksdb_writebatch_create returned null");
        Ok(Transaction {
            db: Arc::clone(db),
            batch,
            _writer_permit: writer_permit,
        })
    }

    pub fn start_readable_transaction(&self) -> Result<ReadableTransaction<'_>, StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "Transaction are only possible on read-write instances".into(),
            ));
        };
        let writer_permit = db.writer_gate.acquire();
        let (batch, read_options, snapshot) = unsafe {
            let snapshot = rocksdb_create_snapshot(db.db);
            let options = oxrocksdb_readoptions_create_copy(db.read_options);
            rocksdb_readoptions_set_snapshot(options, snapshot);
            let batch = rocksdb_writebatch_wi_create(0, 1);
            (batch, options, snapshot)
        };
        assert!(!batch.is_null(), "rocksdb_writebatch_create returned null");
        Ok(ReadableTransaction {
            db,
            batch,
            snapshot,
            read_options,
            keyed_outcome: None,
            _writer_permit: writer_permit,
        })
    }

    pub fn start_readable_transaction_with_control(
        &self,
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<ReadableTransaction<'_>, StorageTransactionStartError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "Transaction are only possible on read-write instances".into(),
            )
            .into());
        };
        let writer_permit = db.writer_gate.acquire_with_control(control, started_at)?;
        let (batch, read_options, snapshot) = unsafe {
            let snapshot = rocksdb_create_snapshot(db.db);
            let options = oxrocksdb_readoptions_create_copy(db.read_options);
            rocksdb_readoptions_set_snapshot(options, snapshot);
            let batch = rocksdb_writebatch_wi_create(0, 1);
            (batch, options, snapshot)
        };
        assert!(!batch.is_null(), "rocksdb_writebatch_create returned null");
        Ok(ReadableTransaction {
            db,
            batch,
            snapshot,
            read_options,
            keyed_outcome: None,
            _writer_permit: writer_permit,
        })
    }

    pub fn start_keyed_readable_transaction_with_control(
        &self,
        outcome_column_family: &ColumnFamily,
        outcome_keys: [&[u8]; 2],
        staging_value: &[u8],
        rolled_back_value: &[u8],
        control: &TransactionStartControl,
        started_at: Instant,
    ) -> Result<ReadableTransaction<'_>, StorageTransactionStartError> {
        let [outcome_key, alternative_outcome_key] = outcome_keys;
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "Transaction are only possible on read-write instances".into(),
            )
            .into());
        };
        let writer_permit = db.writer_gate.acquire_with_control(control, started_at)?;
        if self.contains_key(outcome_column_family, outcome_key)?
            || self.contains_key(outcome_column_family, alternative_outcome_key)?
        {
            return Err(
                StorageError::Other("transaction key has already been reserved".into()).into(),
            );
        }
        put_sync(
            db,
            outcome_column_family,
            outcome_key,
            staging_value,
            #[cfg(test)]
            TransactionOutcomeFaultPoint::StagingBefore,
            #[cfg(test)]
            TransactionOutcomeFaultPoint::StagingAfter,
        )?;
        let (batch, read_options, snapshot) = unsafe {
            let snapshot = rocksdb_create_snapshot(db.db);
            let options = oxrocksdb_readoptions_create_copy(db.read_options);
            rocksdb_readoptions_set_snapshot(options, snapshot);
            let batch = rocksdb_writebatch_wi_create(0, 1);
            (batch, options, snapshot)
        };
        assert!(!batch.is_null(), "rocksdb_writebatch_create returned null");
        Ok(ReadableTransaction {
            db,
            batch,
            snapshot,
            read_options,
            keyed_outcome: Some(KeyedTransactionOutcome {
                column_family: outcome_column_family.clone(),
                key: outcome_key.to_vec(),
                rolled_back_value: rolled_back_value.to_vec(),
                phase: KeyedTransactionOutcomePhase::Staging,
            }),
            _writer_permit: writer_permit,
        })
    }

    pub fn get(
        &self,
        column_family: &ColumnFamily,
        key: &[u8],
    ) -> Result<Option<PinnableSlice>, StorageError> {
        let (db, read_options) = match &self.inner {
            DbKind::ReadOnly(db) => (db.db, db.read_options),
            DbKind::ReadWrite(db) => (db.db, db.read_options),
        };
        let slice = unsafe {
            ffi_result!(oxrocksdb_get_pinned_cf_v2(
                db,
                read_options,
                column_family.0,
                key.as_ptr().cast(),
                key.len(),
            ))
        }?;
        Ok(NonNull::new(slice).map(PinnableSlice))
    }

    pub fn contains_key(
        &self,
        column_family: &ColumnFamily,
        key: &[u8],
    ) -> Result<bool, StorageError> {
        let (db, read_options) = match &self.inner {
            DbKind::ReadOnly(db) => (db.db, db.read_options),
            DbKind::ReadWrite(db) => (db.db, db.read_options),
        };
        let mut value_len = 0;
        let mut found = 0;
        unsafe {
            ffi_result!(oxrocksdb_get_into_buffer_cf(
                db,
                read_options,
                column_family.0,
                key.as_ptr().cast(),
                key.len(),
                ptr::null_mut(),
                0,
                &raw mut value_len,
                &raw mut found
            ))
        }?;
        Ok(found != 0)
    }

    pub fn insert(
        &self,
        column_family: &ColumnFamily,
        key: &[u8],
        value: &[u8],
    ) -> Result<(), StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "Inserts are only possible on read-write instances".into(),
            ));
        };
        unsafe {
            ffi_result!(rocksdb_put_cf(
                db.db,
                db.write_options,
                column_family.0,
                key.as_ptr().cast(),
                key.len(),
                value.as_ptr().cast(),
                value.len(),
            ))
        }?;
        Ok(())
    }

    pub fn flush(&self) -> Result<(), StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "Flush is only possible on read-write instances".into(),
            ));
        };
        unsafe {
            ffi_result!(rocksdb_flush_cfs(
                db.db,
                db.flush_options,
                db.cf_handles.as_ptr().cast_mut(),
                db.cf_handles.len().try_into().unwrap()
            ))
        }?;
        Ok(())
    }

    pub fn compact(&self, column_family: &ColumnFamily) -> Result<(), StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "Compact are only possible on read-write instances".into(),
            ));
        };
        unsafe {
            rocksdb_compact_range_cf_opt(
                db.db,
                column_family.0,
                db.compaction_options,
                ptr::null(),
                0,
                ptr::null(),
                0,
            )
        }
        Ok(())
    }

    pub fn new_sst_file(&self) -> Result<SstFileWriter, StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "SST creation is only possible on read-write instances".into(),
            ));
        };
        let path = db.path.join(format!("bulk-{}.sst", random::<u128>()));
        unsafe {
            let writer = rocksdb_sstfilewriter_create(db.env_options, db.options);
            ffi_result!(rocksdb_sstfilewriter_open(
                writer,
                path_to_cstring(&path)?.as_ptr()
            ))
            .map_err(|e| {
                rocksdb_sstfilewriter_destroy(writer);
                e
            })?;
            Ok(SstFileWriter { writer, path })
        }
    }

    pub fn insert_stt_files(
        &self,
        ssts_for_cf: &[(ColumnFamily, PathBuf)],
    ) -> Result<(), StorageError> {
        let DbKind::ReadWrite(db) = &self.inner else {
            return Err(StorageError::Other(
                "SST ingestion is only possible on read-write instances".into(),
            ));
        };
        if ssts_for_cf.is_empty() {
            return Ok(()); // Rocksdb does not support empty lists
        }
        let mut paths_by_cf = HashMap::<_, Vec<_>>::new();
        for (cf, path) in ssts_for_cf {
            paths_by_cf
                .entry(cf)
                .or_default()
                .push(path_to_cstring(path)?);
        }
        let cpaths_by_cf = paths_by_cf
            .iter()
            .map(|(cf, paths)| (*cf, paths.iter().map(|p| p.as_ptr()).collect::<Vec<_>>()))
            .collect::<Vec<_>>();
        let args = cpaths_by_cf
            .iter()
            .map(|(cf, p)| rocksdb_ingestexternalfilearg_t {
                column_family: cf.0,
                external_files: p.as_ptr(),
                external_files_len: p.len(),
                options: db.ingest_external_file_options,
            })
            .collect::<Vec<_>>();
        let _writer_permit = db.writer_gate.acquire();
        unsafe {
            ffi_result!(oxrocksdb_ingest_external_files(
                db.db,
                args.as_ptr(),
                args.len()
            ))?;
        }
        Ok(())
    }

    pub fn backup(&self, target_directory: &Path) -> Result<(), StorageError> {
        let path = path_to_cstring(target_directory)?;
        unsafe {
            let checkpoint = ffi_result!(rocksdb_checkpoint_object_create(match &self.inner {
                DbKind::ReadOnly(db) => db.db,
                DbKind::ReadWrite(db) => db.db,
            }))?;
            assert!(
                !checkpoint.is_null(),
                "rocksdb_checkpoint_object_create returned null"
            );
            let result = ffi_result!(rocksdb_checkpoint_create(checkpoint, path.as_ptr(), 0));
            rocksdb_checkpoint_object_destroy(checkpoint);
            result
        }?;
        Ok(())
    }
}

// It is fine to not keep a lifetime: there is no way to use this type without the database being still in scope.
// So, no use after free possible.
#[derive(Clone, Eq, PartialEq, Hash)]
pub struct ColumnFamily(*mut rocksdb_column_family_handle_t);

unsafe impl Send for ColumnFamily {}
unsafe impl Sync for ColumnFamily {}

pub struct Reader<'a> {
    inner: InnerReader<'a>,
    options: *mut rocksdb_readoptions_t,
}

unsafe impl Send for Reader<'_> {}
unsafe impl Sync for Reader<'_> {}

#[derive(Clone)]
enum InnerReader<'a> {
    ReadOnly(Arc<RoDbHandler>),
    ReadWrite(Arc<SnapshotReader>),
    Transaction(TransactionReader<'a>),
}

struct SnapshotReader {
    db: Arc<RwDbHandler>,
    snapshot: *const rocksdb_snapshot_t,
}

unsafe impl Send for SnapshotReader {}
unsafe impl Sync for SnapshotReader {}

impl Drop for SnapshotReader {
    fn drop(&mut self) {
        unsafe { rocksdb_release_snapshot(self.db.db, self.snapshot) }
    }
}

#[derive(Clone)]
struct TransactionReader<'a> {
    db: &'a RwDbHandler,
    batch: *mut rocksdb_writebatch_wi_t,
}

unsafe impl Send for TransactionReader<'_> {}
unsafe impl Sync for TransactionReader<'_> {}

impl Clone for Reader<'_> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            options: unsafe { oxrocksdb_readoptions_create_copy(self.options) },
        }
    }
}

impl Drop for Reader<'_> {
    fn drop(&mut self) {
        unsafe { rocksdb_readoptions_destroy(self.options) }
    }
}

impl<'a> Reader<'a> {
    pub fn get(
        &self,
        column_family: &ColumnFamily,
        key: &[u8],
    ) -> Result<Option<PinnableSlice>, StorageError> {
        let slice = unsafe {
            match &self.inner {
                InnerReader::ReadOnly(inner) => ffi_result!(oxrocksdb_get_pinned_cf_v2(
                    inner.db,
                    self.options,
                    column_family.0,
                    key.as_ptr().cast(),
                    key.len(),
                )),
                InnerReader::ReadWrite(inner) => ffi_result!(oxrocksdb_get_pinned_cf_v2(
                    inner.db.db,
                    self.options,
                    column_family.0,
                    key.as_ptr().cast(),
                    key.len(),
                )),
                InnerReader::Transaction(inner) => {
                    ffi_result!(oxrocksdb_writebatch_wi_get_pinned_cf_v2(
                        inner.batch,
                        inner.db.db,
                        self.options,
                        column_family.0,
                        key.as_ptr().cast(),
                        key.len(),
                    ))
                }
            }
        }?;
        Ok(NonNull::new(slice).map(PinnableSlice))
    }

    pub fn contains_key(
        &self,
        column_family: &ColumnFamily,
        key: &[u8],
    ) -> Result<bool, StorageError> {
        let mut value_len = 0;
        let mut found = 0;
        unsafe {
            match &self.inner {
                InnerReader::ReadOnly(inner) => {
                    ffi_result!(oxrocksdb_get_into_buffer_cf(
                        inner.db,
                        self.options,
                        column_family.0,
                        key.as_ptr().cast(),
                        key.len(),
                        ptr::null_mut(),
                        0,
                        &raw mut value_len,
                        &raw mut found
                    ))
                }
                InnerReader::ReadWrite(inner) => {
                    ffi_result!(oxrocksdb_get_into_buffer_cf(
                        inner.db.db,
                        self.options,
                        column_family.0,
                        key.as_ptr().cast(),
                        key.len(),
                        ptr::null_mut(),
                        0,
                        &raw mut value_len,
                        &raw mut found
                    ))
                }
                InnerReader::Transaction(inner) => {
                    ffi_result!(oxrocksdb_writebatch_wi_get_into_buffer_cf(
                        inner.batch,
                        inner.db.db,
                        self.options,
                        column_family.0,
                        key.as_ptr().cast(),
                        key.len(),
                        ptr::null_mut(),
                        0,
                        &raw mut value_len,
                        &raw mut found
                    ))
                }
            }
        }?;
        Ok(found != 0)
    }

    #[expect(clippy::iter_not_returning_iterator)]
    pub fn iter(&self, column_family: &ColumnFamily) -> Iter<'a> {
        self.scan_prefix(column_family, &[])
    }

    pub fn scan_prefix(&self, column_family: &ColumnFamily, prefix: &[u8]) -> Iter<'a> {
        // We generate the upper bound
        let upper_bound = {
            let mut bound = prefix.to_vec();
            if let Some(index) = bound.iter().rposition(|&c| c < u8::MAX) {
                bound.truncate(index + 1);
                bound[index] += 1;
                Some(bound)
            } else {
                None
            }
        };

        unsafe {
            let options = oxrocksdb_readoptions_create_copy(self.options);
            assert!(
                !options.is_null(),
                "rocksdb_readoptions_create returned null"
            );
            if let Some(upper_bound) = &upper_bound {
                rocksdb_readoptions_set_iterate_upper_bound(
                    options,
                    upper_bound.as_ptr().cast(),
                    upper_bound.len(),
                );
            }
            let iter = match &self.inner {
                InnerReader::ReadOnly(inner) => {
                    rocksdb_create_iterator_cf(inner.db, options, column_family.0)
                }
                InnerReader::ReadWrite(inner) => {
                    rocksdb_create_iterator_cf(inner.db.db, options, column_family.0)
                }
                InnerReader::Transaction(inner) => {
                    oxrocksdb_writebatch_wi_create_iterator_with_base_readopts_cf(
                        inner.batch,
                        rocksdb_create_iterator_cf(inner.db.db, options, column_family.0),
                        options,
                        column_family.0,
                    )
                }
            };
            assert!(!iter.is_null(), "rocksdb_create_iterator returned null");
            if prefix.is_empty() {
                rocksdb_iter_seek_to_first(iter);
            } else {
                rocksdb_iter_seek(iter, prefix.as_ptr().cast(), prefix.len());
            }
            let is_currently_valid = rocksdb_iter_valid(iter) != 0;
            Iter {
                inner: iter,
                options,
                _upper_bound: upper_bound,
                _reader: self.clone(),
                is_currently_valid,
            }
        }
    }

    pub fn len(&self, column_family: &ColumnFamily) -> Result<usize, StorageError> {
        let mut count = 0;
        let mut iter = self.iter(column_family);
        while iter.is_valid() {
            count += 1;
            iter.next();
        }
        iter.status()?; // We make sure there is no read problem
        Ok(count)
    }

    pub fn is_empty(&self, column_family: &ColumnFamily) -> Result<bool, StorageError> {
        let iter = self.iter(column_family);
        iter.status()?; // We make sure there is no read problem
        Ok(!iter.is_valid())
    }
}

/// Write-only operation on the database
pub struct Transaction {
    db: Arc<RwDbHandler>,
    batch: *mut rocksdb_writebatch_t,
    _writer_permit: WriterPermit,
}

impl Drop for Transaction {
    fn drop(&mut self) {
        unsafe {
            rocksdb_writebatch_destroy(self.batch);
        }
    }
}

impl Transaction {
    pub fn insert(&mut self, column_family: &ColumnFamily, key: &[u8], value: &[u8]) {
        unsafe {
            rocksdb_writebatch_put_cf(
                self.batch,
                column_family.0,
                key.as_ptr().cast(),
                key.len(),
                value.as_ptr().cast(),
                value.len(),
            )
        }
    }

    pub fn insert_empty(&mut self, column_family: &ColumnFamily, key: &[u8]) {
        self.insert(column_family, key, &[])
    }

    pub fn remove(&mut self, column_family: &ColumnFamily, key: &[u8]) {
        unsafe {
            rocksdb_writebatch_delete_cf(
                self.batch,
                column_family.0,
                key.as_ptr().cast(),
                key.len(),
            )
        }
    }

    pub fn remove_range(&mut self, column_family: &ColumnFamily, start_key: &[u8], end_key: &[u8]) {
        unsafe {
            rocksdb_writebatch_delete_range_cf(
                self.batch,
                column_family.0,
                start_key.as_ptr().cast(),
                start_key.len(),
                end_key.as_ptr().cast(),
                end_key.len(),
            )
        }
    }

    pub fn commit(self) -> Result<(), StorageError> {
        unsafe {
            ffi_result!(rocksdb_write(self.db.db, self.db.write_options, self.batch))?;
        }
        Ok(())
    }
}

pub struct ReadableTransaction<'a> {
    db: &'a RwDbHandler,
    batch: *mut rocksdb_writebatch_wi_t,
    snapshot: *const rocksdb_snapshot_t,
    read_options: *mut rocksdb_readoptions_t,
    keyed_outcome: Option<KeyedTransactionOutcome>,
    _writer_permit: WriterPermit,
}

struct KeyedTransactionOutcome {
    column_family: ColumnFamily,
    key: Vec<u8>,
    rolled_back_value: Vec<u8>,
    phase: KeyedTransactionOutcomePhase,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum KeyedTransactionOutcomePhase {
    Staging,
    CommitAttempted,
    Terminal,
}

unsafe impl Send for ReadableTransaction<'_> {}
unsafe impl Sync for ReadableTransaction<'_> {}

impl Drop for ReadableTransaction<'_> {
    fn drop(&mut self) {
        if let Some(outcome) = &mut self.keyed_outcome {
            if outcome.phase == KeyedTransactionOutcomePhase::Staging
                && put_sync(
                    self.db,
                    &outcome.column_family,
                    &outcome.key,
                    &outcome.rolled_back_value,
                    #[cfg(test)]
                    TransactionOutcomeFaultPoint::RolledBackBefore,
                    #[cfg(test)]
                    TransactionOutcomeFaultPoint::RolledBackAfter,
                )
                .is_ok()
            {
                outcome.phase = KeyedTransactionOutcomePhase::Terminal;
            }
        }
        unsafe {
            rocksdb_writebatch_wi_destroy(self.batch);
            rocksdb_readoptions_destroy(self.read_options);
            rocksdb_release_snapshot(self.db.db, self.snapshot);
        }
    }
}

impl ReadableTransaction<'_> {
    fn keyed_outcome_mut(&mut self) -> Result<&mut KeyedTransactionOutcome, StorageError> {
        self.keyed_outcome.as_mut().ok_or_else(|| {
            StorageError::Other("keyed transaction outcome metadata is missing".into())
        })
    }

    pub fn reader(&self) -> Reader<'_> {
        Reader {
            inner: InnerReader::Transaction(TransactionReader {
                db: self.db,
                batch: self.batch,
            }),
            options: unsafe { oxrocksdb_readoptions_create_copy(self.read_options) },
        }
    }

    pub fn insert(&mut self, column_family: &ColumnFamily, key: &[u8], value: &[u8]) {
        unsafe {
            rocksdb_writebatch_wi_put_cf(
                self.batch,
                column_family.0,
                key.as_ptr().cast(),
                key.len(),
                value.as_ptr().cast(),
                value.len(),
            );
        }
    }

    pub fn insert_empty(&mut self, column_family: &ColumnFamily, key: &[u8]) {
        self.insert(column_family, key, &[])
    }

    pub fn remove(&mut self, column_family: &ColumnFamily, key: &[u8]) {
        unsafe {
            rocksdb_writebatch_wi_delete_cf(
                self.batch,
                column_family.0,
                key.as_ptr().cast(),
                key.len(),
            );
        }
    }

    pub fn commit(self) -> Result<(), StorageError> {
        if self.keyed_outcome.is_some() {
            return Err(StorageError::Other(
                "a keyed transaction must use the outcome-aware commit path".into(),
            ));
        }
        unsafe {
            ffi_result!(rocksdb_write_writebatch_wi(
                self.db.db,
                self.db.write_options,
                self.batch
            ))?;
        }
        Ok(())
    }

    pub fn commit_keyed(
        mut self,
        commit_attempted_value: &[u8],
        committed_value: &[u8],
    ) -> Result<(), StorageError> {
        let (column_family, key) = {
            let outcome = self.keyed_outcome.as_ref().ok_or_else(|| {
                StorageError::Other("an unkeyed transaction cannot use keyed commit".into())
            })?;
            if outcome.phase != KeyedTransactionOutcomePhase::Staging {
                return Err(StorageError::Other(
                    "a keyed transaction may attempt commit only once".into(),
                ));
            }
            (outcome.column_family.clone(), outcome.key.clone())
        };
        self.keyed_outcome_mut()?.phase = KeyedTransactionOutcomePhase::CommitAttempted;
        put_sync(
            self.db,
            &column_family,
            &key,
            commit_attempted_value,
            #[cfg(test)]
            TransactionOutcomeFaultPoint::CommitAttemptedBefore,
            #[cfg(test)]
            TransactionOutcomeFaultPoint::CommitAttemptedAfter,
        )?;
        self.insert(&column_family, &key, committed_value);
        #[cfg(test)]
        self.db.visit_transaction_outcome_fault_point(
            TransactionOutcomeFaultPoint::FinalBatchBefore,
        )?;
        unsafe {
            ffi_result!(rocksdb_write_writebatch_wi(
                self.db.db,
                self.db.sync_write_options,
                self.batch
            ))?;
        }
        #[cfg(test)]
        self.db
            .visit_transaction_outcome_fault_point(TransactionOutcomeFaultPoint::FinalBatchAfter)?;
        self.keyed_outcome_mut()?.phase = KeyedTransactionOutcomePhase::Terminal;
        Ok(())
    }

    pub fn rollback_keyed(mut self) -> Result<(), StorageError> {
        let outcome = self.keyed_outcome.as_ref().ok_or_else(|| {
            StorageError::Other("an unkeyed transaction cannot use keyed rollback".into())
        })?;
        if outcome.phase != KeyedTransactionOutcomePhase::Staging {
            return Err(StorageError::Other(
                "a transaction cannot roll back after commit was attempted".into(),
            ));
        }
        put_sync(
            self.db,
            &outcome.column_family,
            &outcome.key,
            &outcome.rolled_back_value,
            #[cfg(test)]
            TransactionOutcomeFaultPoint::RolledBackBefore,
            #[cfg(test)]
            TransactionOutcomeFaultPoint::RolledBackAfter,
        )?;
        self.keyed_outcome_mut()?.phase = KeyedTransactionOutcomePhase::Terminal;
        Ok(())
    }
}

fn put_sync(
    db: &RwDbHandler,
    column_family: &ColumnFamily,
    key: &[u8],
    value: &[u8],
    #[cfg(test)] before: TransactionOutcomeFaultPoint,
    #[cfg(test)] after: TransactionOutcomeFaultPoint,
) -> Result<(), StorageError> {
    #[cfg(test)]
    db.visit_transaction_outcome_fault_point(before)?;
    unsafe {
        ffi_result!(rocksdb_put_cf(
            db.db,
            db.sync_write_options,
            column_family.0,
            key.as_ptr().cast(),
            key.len(),
            value.as_ptr().cast(),
            value.len(),
        ))?;
    }
    #[cfg(test)]
    db.visit_transaction_outcome_fault_point(after)?;
    Ok(())
}

pub struct PinnableSlice(NonNull<oxrocksdb_pinnable_handle_t>);

impl Drop for PinnableSlice {
    fn drop(&mut self) {
        unsafe {
            oxrocksdb_pinnable_handle_destroy(self.0.as_ptr());
        }
    }
}

impl Deref for PinnableSlice {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        unsafe {
            let mut len = 0;
            let val = oxrocksdb_pinnable_handle_get_value(self.0.as_ptr(), &raw mut len);
            slice::from_raw_parts(val.cast(), len)
        }
    }
}

impl AsRef<[u8]> for PinnableSlice {
    fn as_ref(&self) -> &[u8] {
        self
    }
}

impl Borrow<[u8]> for PinnableSlice {
    fn borrow(&self) -> &[u8] {
        self
    }
}

pub struct Buffer {
    base: *mut u8,
    len: usize,
}

impl Drop for Buffer {
    fn drop(&mut self) {
        unsafe {
            rocksdb_free(self.base.cast());
        }
    }
}

impl Deref for Buffer {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        unsafe { slice::from_raw_parts(self.base, self.len) }
    }
}

impl AsRef<[u8]> for Buffer {
    fn as_ref(&self) -> &[u8] {
        self
    }
}

impl Borrow<[u8]> for Buffer {
    fn borrow(&self) -> &[u8] {
        self
    }
}

impl From<Buffer> for Vec<u8> {
    fn from(value: Buffer) -> Self {
        value.to_vec()
    }
}

pub struct Iter<'a> {
    inner: *mut rocksdb_iterator_t,
    is_currently_valid: bool,
    _upper_bound: Option<Vec<u8>>,
    _reader: Reader<'a>, // needed to ensure that DB still lives while iter is used
    options: *mut rocksdb_readoptions_t, /* needed to ensure that options still lives while iter is used */
}

impl Drop for Iter<'_> {
    fn drop(&mut self) {
        unsafe {
            rocksdb_iter_destroy(self.inner);
            rocksdb_readoptions_destroy(self.options);
        }
    }
}

unsafe impl Send for Iter<'_> {}

unsafe impl Sync for Iter<'_> {}

impl Iter<'_> {
    pub fn is_valid(&self) -> bool {
        self.is_currently_valid
    }

    pub fn status(&self) -> Result<(), StorageError> {
        unsafe {
            ffi_result!(rocksdb_iter_get_error(self.inner))?;
        }
        Ok(())
    }

    pub fn next(&mut self) {
        unsafe {
            rocksdb_iter_next(self.inner);
            self.is_currently_valid = rocksdb_iter_valid(self.inner) != 0;
        }
    }

    pub fn key(&self) -> Option<&[u8]> {
        if self.is_valid() {
            unsafe {
                let key = oxrocksdb_iter_key_slice(self.inner);
                Some(slice::from_raw_parts(key.data.cast(), key.size))
            }
        } else {
            None
        }
    }

    pub fn value(&self) -> Option<&[u8]> {
        if self.is_valid() {
            unsafe {
                let value = rocksdb_iter_value_slice(self.inner);
                Some(slice::from_raw_parts(value.data.cast(), value.size))
            }
        } else {
            None
        }
    }
}

pub struct SstFileWriter {
    writer: *mut rocksdb_sstfilewriter_t,
    path: PathBuf,
}

impl Drop for SstFileWriter {
    fn drop(&mut self) {
        unsafe {
            rocksdb_sstfilewriter_destroy(self.writer);
        }
    }
}

impl SstFileWriter {
    pub fn insert(&mut self, key: &[u8], value: &[u8]) -> Result<(), StorageError> {
        unsafe {
            ffi_result!(rocksdb_sstfilewriter_put(
                self.writer,
                key.as_ptr().cast(),
                key.len(),
                value.as_ptr().cast(),
                value.len(),
            ))?;
        }
        Ok(())
    }

    pub fn insert_empty(&mut self, key: &[u8]) -> Result<(), StorageError> {
        self.insert(key, &[])
    }

    pub fn finish(self) -> Result<PathBuf, StorageError> {
        unsafe {
            ffi_result!(rocksdb_sstfilewriter_finish(self.writer))?;
        }
        Ok(self.path.clone())
    }
}

struct ErrorStatus(CString);

impl ErrorStatus {
    fn message(&self) -> &str {
        self.0.to_str().unwrap_or("Invalid RocksDB error message")
    }
}

impl fmt::Debug for ErrorStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ErrorStatus")
            .field("message", &self.message())
            .finish()
    }
}

impl fmt::Display for ErrorStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.message())
    }
}

impl Error for ErrorStatus {}

impl From<ErrorStatus> for StorageError {
    fn from(status: ErrorStatus) -> Self {
        let mut parts = status.message().split(": ");
        match parts.next() {
            Some("IO error") => Self::Io(io::Error::new(
                match parts.next() {
                    Some("Timeout Acquiring Mutex" | "Timeout waiting to lock key") => {
                        io::ErrorKind::TimedOut
                    }
                    Some("No space left on device" | "Space limit reached") => {
                        io::ErrorKind::StorageFull
                    }
                    Some("Deadlock") => io::ErrorKind::Deadlock,
                    Some("Stale file handle") => io::ErrorKind::StaleNetworkFileHandle,
                    Some("Memory limit reached") => io::ErrorKind::OutOfMemory,
                    Some("No such file or directory") => io::ErrorKind::NotFound,
                    _ => io::ErrorKind::Other,
                },
                status,
            )),
            Some("Corruption") => Self::Corruption(CorruptionError::new(status)),
            _ => Self::Other(Box::new(status)),
        }
    }
}

struct UnsafeEnv(*mut rocksdb_env_t);

// Hack for OnceCell. OK because only written in OnceCell and used in a thread-safe way by RocksDB
unsafe impl Send for UnsafeEnv {}
unsafe impl Sync for UnsafeEnv {}

fn path_to_cstring(path: &Path) -> Result<CString, StorageError> {
    Ok(CString::new(path.to_str().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "The DB path is not valid UTF-8",
        )
    })?)
    .map_err(|e| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("The DB path contains null bytes: {e}"),
        )
    })?)
}

#[cfg(unix)]
fn available_file_descriptors() -> io::Result<Option<u64>> {
    let mut rlimit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    #[cfg_attr(target_pointer_width = "64", expect(clippy::useless_conversion))]
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &raw mut rlimit) } == 0 {
        Ok(Some(min(
            u64::from(rlimit.rlim_cur),
            u64::from(rlimit.rlim_max),
        )))
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn available_file_descriptors() -> io::Result<Option<u64>> {
    Ok(Some(512)) // https://docs.microsoft.com/en-us/cpp/c-runtime-library/file-handling
}

#[cfg(not(any(unix, windows)))]
fn available_file_descriptors() -> io::Result<Option<u64>> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::ErrorKind;
    use tempfile::TempDir;

    fn prefix_scan_keys(
        reader: &Reader<'_>,
        column_family: &ColumnFamily,
        prefix: &[u8],
    ) -> Result<Vec<Vec<u8>>, StorageError> {
        let mut keys = Vec::new();
        let mut iter = reader.scan_prefix(column_family, prefix);
        while iter.is_valid() {
            keys.push(
                iter.key()
                    .expect("a valid RocksDB iterator must expose its key")
                    .to_vec(),
            );
            iter.next();
        }
        iter.status()?;
        Ok(keys)
    }

    fn prefix_scan_mismatches(
        reader_name: &str,
        reader: &Reader<'_>,
        column_family: &ColumnFamily,
        prefixes: &[Vec<u8>],
        stored_keys: &[Vec<u8>],
    ) -> Result<Vec<String>, StorageError> {
        let mut mismatches = Vec::new();
        for prefix in prefixes {
            let expected = stored_keys
                .iter()
                .filter(|key| key.starts_with(prefix))
                .cloned()
                .collect::<Vec<_>>();
            assert!(
                !expected.is_empty(),
                "the prefix fixture must contain at least one matching key for {prefix:?}"
            );
            if !prefix.is_empty() {
                assert!(
                    stored_keys.iter().any(|key| !key.starts_with(prefix)),
                    "the prefix fixture must contain a non-matching key for {prefix:?}"
                );
            }

            let actual = prefix_scan_keys(reader, column_family, prefix)?;
            if actual != expected {
                mismatches.push(format!(
                    "{reader_name} prefix {prefix:?}: expected {expected:?}, got {actual:?}"
                ));
            }
        }
        Ok(mismatches)
    }

    #[test]
    fn max_open_files_from_fd_limit_default_reserve() {
        assert_eq!(
            Db::max_open_files_from_fd_limit(512, Db::DEFAULT_FD_RESERVE).unwrap(),
            464
        );
    }

    #[test]
    fn max_open_files_from_fd_limit_custom_reserve() {
        assert_eq!(Db::max_open_files_from_fd_limit(512, 128).unwrap(), 384);
    }

    #[test]
    fn max_open_files_from_fd_limit_requires_minimum_fds() {
        let error = Db::max_open_files_from_fd_limit(95, Db::DEFAULT_FD_RESERVE).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Other);
    }

    #[test]
    #[expect(clippy::panic_in_result_fn)]
    fn contains_key_handles_empty_and_non_empty_values() -> Result<(), StorageError> {
        let dir = TempDir::new()?;
        let db = Db::open_read_write(dir.path(), vec![], DbOptions::default())?;
        let default_cf = db.column_family("default")?;

        assert!(!db.contains_key(&default_cf, b"missing")?);

        db.insert(&default_cf, b"empty", &[])?;
        db.insert(&default_cf, b"non-empty", b"value")?;
        db.flush()?;

        assert!(db.contains_key(&default_cf, b"empty")?);
        assert!(db.contains_key(&default_cf, b"non-empty")?);
        assert!(!db.contains_key(&default_cf, b"missing")?);

        let rw_reader = db.snapshot();
        assert!(rw_reader.contains_key(&default_cf, b"empty")?);
        assert!(rw_reader.contains_key(&default_cf, b"non-empty")?);
        assert!(!rw_reader.contains_key(&default_cf, b"missing")?);

        let ro_db = Db::open_read_only(dir.path(), vec![])?;
        let ro_default_cf = ro_db.column_family("default")?;
        assert!(ro_db.contains_key(&ro_default_cf, b"empty")?);
        assert!(ro_db.contains_key(&ro_default_cf, b"non-empty")?);
        assert!(!ro_db.contains_key(&ro_default_cf, b"missing")?);

        let ro_reader = ro_db.snapshot();
        assert!(ro_reader.contains_key(&ro_default_cf, b"empty")?);
        assert!(ro_reader.contains_key(&ro_default_cf, b"non-empty")?);
        assert!(!ro_reader.contains_key(&ro_default_cf, b"missing")?);

        Ok(())
    }

    #[test]
    #[expect(clippy::panic_in_result_fn)]
    fn scan_prefix_never_returns_non_prefix_keys() -> Result<(), StorageError> {
        let dir = TempDir::new()?;
        let db = Db::open_read_write(dir.path(), vec![], DbOptions::default())?;
        let default_cf = db.column_family("default")?;

        let mut base_keys = vec![
            b"plain:a".to_vec(),
            b"plain:z".to_vec(),
            b"plain;".to_vec(),
            vec![0x12, 0xfe],
            vec![0x12, 0xfe, 0x00],
            vec![0x12, 0xff],
            vec![0x12, 0xff, 0x00],
            vec![0x12, 0xff, 0xff],
            vec![0x13],
            vec![0x13, 0x00],
            vec![0x13, 0xfe, 0xff],
            vec![0x13, 0xff],
            vec![0x20, 0xff, 0xff],
            vec![0x20, 0xff, 0xff, 0x00],
            vec![0x21],
            vec![0x21, 0x00],
            vec![0x21, 0xff, 0xfe],
            vec![0x21, 0xff, 0xff],
            vec![0xfe, 0xff],
            vec![0xfe, 0xff, 0x00],
            vec![0xff],
            vec![0xff, 0x00],
            vec![0xff, 0xff],
            vec![0xff, 0xff, 0x00],
            vec![0xff, 0xff, 0xff],
        ];
        base_keys.sort();
        base_keys.dedup();
        for key in &base_keys {
            db.insert(&default_cf, key, b"value")?;
        }
        db.flush()?;

        let prefixes = vec![
            Vec::new(),
            b"plain:".to_vec(),
            vec![0x12, 0xfe],
            vec![0x12, 0xff],
            vec![0x20, 0xff, 0xff],
            vec![0xfe, 0xff],
            vec![0xff, 0xff],
        ];
        let mut mismatches = Vec::new();

        {
            let snapshot_reader = db.snapshot();
            mismatches.extend(prefix_scan_mismatches(
                "read-write snapshot",
                &snapshot_reader,
                &default_cf,
                &prefixes,
                &base_keys,
            )?);
        }

        {
            let mut transaction = db.start_readable_transaction()?;
            let staged_keys = [
                b"plain:transaction".to_vec(),
                vec![0x12, 0xff, 0x80],
                vec![0x13, 0x80],
                vec![0x20, 0xff, 0xff, 0x80],
                vec![0x21, 0x80],
                vec![0xfe, 0xff, 0x80],
                vec![0xff, 0x80],
                vec![0xff, 0xff, 0x80],
            ];
            for key in &staged_keys {
                transaction.insert(&default_cf, key, b"staged");
            }
            let mut transaction_keys = base_keys.clone();
            transaction_keys.extend(staged_keys);
            transaction_keys.sort();
            transaction_keys.dedup();
            mismatches.extend(prefix_scan_mismatches(
                "readable transaction",
                &transaction.reader(),
                &default_cf,
                &prefixes,
                &transaction_keys,
            )?);
        }

        let read_only_dir = TempDir::new()?;
        {
            let seed_db = Db::open_read_write(read_only_dir.path(), vec![], DbOptions::default())?;
            let seed_cf = seed_db.column_family("default")?;
            for key in &base_keys {
                seed_db.insert(&seed_cf, key, b"value")?;
            }
            seed_db.flush()?;
        }
        let read_only_db = Db::open_read_only(read_only_dir.path(), vec![])?;
        let read_only_cf = read_only_db.column_family("default")?;
        let read_only_reader = read_only_db.snapshot();
        mismatches.extend(prefix_scan_mismatches(
            "read-only",
            &read_only_reader,
            &read_only_cf,
            &prefixes,
            &base_keys,
        )?);

        assert!(
            mismatches.is_empty(),
            "Reader::scan_prefix returned keys outside the requested prefix:\n{}",
            mismatches.join("\n")
        );
        Ok(())
    }
}

#[cfg(test)]
#[expect(
    dead_code,
    reason = "the RED fallback contract is intentionally shadowed once the product seam exists"
)]
#[path = "rocksdb_maintenance_evidence_contract_tests.rs"]
mod maintenance_evidence_contract_tests;
