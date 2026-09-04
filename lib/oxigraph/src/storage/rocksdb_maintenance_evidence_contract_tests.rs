#![allow(
    clippy::panic,
    reason = "test-only fixture failures must remain immediate and attributable"
)]
#![allow(
    clippy::redundant_closure_for_method_calls,
    reason = "closure dispatch remains valid when the frozen product signal type replaces the evaluator fallback"
)]
#![allow(
    clippy::struct_field_names,
    reason = "explicit byte units are part of the typed maintenance evidence contract"
)]

use super::*;
use std::collections::BTreeSet;
use std::ffi::{CStr, CString};
use std::ptr::NonNull;
use tempfile::TempDir;

const CONTRACT_SCHEMA_VERSION: u16 = 1;
const VENDORED_VERSION: &str = "11.1.2";
const VENDORED_SOURCE_REVISION: &str = "3b446089141659fad25328c5ea3e7ed283df46e4";

const COMPACTION_PENDING: &str = "rocksdb.compaction-pending";
const PENDING_COMPACTION_BYTES: &str = "rocksdb.estimate-pending-compaction-bytes";
const BACKGROUND_ERRORS: &str = "rocksdb.background-errors";
const WRITES_STOPPED: &str = "rocksdb.is-write-stopped";
const DELAYED_WRITE_RATE: &str = "rocksdb.actual-delayed-write-rate";
const LIVE_SST_BYTES: &str = "rocksdb.live-sst-files-size";
const MEMTABLE_BYTES: &str = "rocksdb.size-all-mem-tables";
const TABLE_READER_BYTES: &str = "rocksdb.estimate-table-readers-mem";

const USER_BYTES_WRITTEN_TICKER: u32 = 61;
const STALL_MICROS_TICKER: u32 = 76;
const COMPACTION_READ_BYTES_TICKER: u32 = 89;
const COMPACTION_WRITE_BYTES_TICKER: u32 = 90;
const FLUSH_WRITE_BYTES_TICKER: u32 = 91;

const INTEGER_PROPERTIES: [&str; 8] = [
    COMPACTION_PENDING,
    PENDING_COMPACTION_BYTES,
    BACKGROUND_ERRORS,
    WRITES_STOPPED,
    DELAYED_WRITE_RATE,
    LIVE_SST_BYTES,
    MEMTABLE_BYTES,
    TABLE_READER_BYTES,
];

const STATISTICS_TICKERS: [u32; 5] = [
    USER_BYTES_WRITTEN_TICKER,
    STALL_MICROS_TICKER,
    COMPACTION_READ_BYTES_TICKER,
    COMPACTION_WRITE_BYTES_TICKER,
    FLUSH_WRITE_BYTES_TICKER,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProbeSignal<T> {
    Available(T),
    Unavailable,
    Unsupported,
}

impl<T> ProbeSignal<T> {
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

#[derive(Debug)]
struct MissingCompactionEvidence {
    pending: ProbeSignal<bool>,
    estimated_pending_bytes: ProbeSignal<u64>,
}

impl MissingCompactionEvidence {
    const fn pending(&self) -> &ProbeSignal<bool> {
        &self.pending
    }

    const fn estimated_pending_bytes(&self) -> &ProbeSignal<u64> {
        &self.estimated_pending_bytes
    }
}

#[derive(Debug)]
struct MissingHealthEvidence {
    background_errors: ProbeSignal<u64>,
}

impl MissingHealthEvidence {
    const fn background_errors(&self) -> &ProbeSignal<u64> {
        &self.background_errors
    }
}

#[derive(Debug)]
struct MissingStallEvidence {
    writes_stopped: ProbeSignal<bool>,
    delayed_write_rate_bytes_per_second: ProbeSignal<u64>,
}

impl MissingStallEvidence {
    const fn writes_stopped(&self) -> &ProbeSignal<bool> {
        &self.writes_stopped
    }

    const fn delayed_write_rate_bytes_per_second(&self) -> &ProbeSignal<u64> {
        &self.delayed_write_rate_bytes_per_second
    }
}

#[derive(Debug)]
struct MissingResourceEvidence {
    live_sst_bytes: ProbeSignal<u64>,
    memtable_bytes: ProbeSignal<u64>,
    table_reader_bytes: ProbeSignal<u64>,
}

impl MissingResourceEvidence {
    const fn live_sst_bytes(&self) -> &ProbeSignal<u64> {
        &self.live_sst_bytes
    }

    const fn memtable_bytes(&self) -> &ProbeSignal<u64> {
        &self.memtable_bytes
    }

    const fn table_reader_bytes(&self) -> &ProbeSignal<u64> {
        &self.table_reader_bytes
    }
}

#[derive(Debug)]
struct MissingColumnFamilyEvidence {
    name: &'static str,
    compaction: MissingCompactionEvidence,
    health: MissingHealthEvidence,
    stalls: MissingStallEvidence,
    resources: MissingResourceEvidence,
}

impl MissingColumnFamilyEvidence {
    const fn name(&self) -> &str {
        self.name
    }

    const fn compaction(&self) -> &MissingCompactionEvidence {
        &self.compaction
    }

    const fn health(&self) -> &MissingHealthEvidence {
        &self.health
    }

    const fn stalls(&self) -> &MissingStallEvidence {
        &self.stalls
    }

    const fn resources(&self) -> &MissingResourceEvidence {
        &self.resources
    }
}

#[derive(Debug)]
struct MissingAmplificationEvidence {
    user_bytes_written: ProbeSignal<u64>,
    stall_micros: ProbeSignal<u64>,
    compaction_read_bytes: ProbeSignal<u64>,
    compaction_write_bytes: ProbeSignal<u64>,
    flush_write_bytes: ProbeSignal<u64>,
}

impl MissingAmplificationEvidence {
    const fn signals(&self) -> [&ProbeSignal<u64>; 5] {
        [
            &self.user_bytes_written,
            &self.stall_micros,
            &self.compaction_read_bytes,
            &self.compaction_write_bytes,
            &self.flush_write_bytes,
        ]
    }

    const fn user_bytes_written(&self) -> &ProbeSignal<u64> {
        &self.user_bytes_written
    }

    const fn flush_write_bytes(&self) -> &ProbeSignal<u64> {
        &self.flush_write_bytes
    }
}

#[derive(Debug)]
enum MissingMaintenanceAuthority {
    DiagnosticsOnly,
    Missing,
}

impl MissingMaintenanceAuthority {
    const fn is_diagnostics_only(&self) -> bool {
        matches!(self, Self::DiagnosticsOnly)
    }
}

#[derive(Debug)]
enum MissingMaintenanceBackend {
    RocksDb,
    Missing,
}

impl MissingMaintenanceBackend {
    const fn is_rocksdb(&self) -> bool {
        matches!(self, Self::RocksDb)
    }
}

#[derive(Debug)]
enum MissingMaintenanceBuild {
    Vendored {
        rocksdb_version: &'static str,
        source_revision: &'static str,
    },
    Missing,
}

impl MissingMaintenanceBuild {
    const fn is_vendored(&self) -> bool {
        matches!(self, Self::Vendored { .. })
    }

    const fn rocksdb_version(&self) -> &str {
        match self {
            Self::Vendored {
                rocksdb_version, ..
            } => rocksdb_version,
            Self::Missing => "missing",
        }
    }

    const fn source_revision(&self) -> Option<&str> {
        match self {
            Self::Vendored {
                source_revision, ..
            } => Some(source_revision),
            Self::Missing => None,
        }
    }
}

#[derive(Debug)]
struct MissingMaintenanceBackendIdentity {
    backend: MissingMaintenanceBackend,
    build: MissingMaintenanceBuild,
}

impl MissingMaintenanceBackendIdentity {
    const fn backend(&self) -> &MissingMaintenanceBackend {
        &self.backend
    }

    const fn build(&self) -> &MissingMaintenanceBuild {
        &self.build
    }
}

#[derive(Debug)]
enum MissingMaintenanceOpenMode {
    ReadWrite,
    ReadOnly,
}

impl MissingMaintenanceOpenMode {
    const fn is_read_write(&self) -> bool {
        matches!(self, Self::ReadWrite)
    }

    const fn is_read_only(&self) -> bool {
        matches!(self, Self::ReadOnly)
    }
}

#[derive(Debug)]
struct MissingMaintenanceRuntimeIdentity {
    database_id: ProbeSignal<String>,
    open_mode: MissingMaintenanceOpenMode,
    latest_sequence_number: u64,
}

impl MissingMaintenanceRuntimeIdentity {
    const fn database_id(&self) -> &ProbeSignal<String> {
        &self.database_id
    }

    const fn open_mode(&self) -> &MissingMaintenanceOpenMode {
        &self.open_mode
    }

    const fn latest_sequence_number(&self) -> u64 {
        self.latest_sequence_number
    }
}

#[derive(Debug)]
struct MissingMaintenanceEvidence {
    schema_version: u16,
    authority: MissingMaintenanceAuthority,
    backend: MissingMaintenanceBackendIdentity,
    runtime: MissingMaintenanceRuntimeIdentity,
    column_families: Vec<MissingColumnFamilyEvidence>,
    amplification: MissingAmplificationEvidence,
}

impl MissingMaintenanceEvidence {
    const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    const fn authority(&self) -> &MissingMaintenanceAuthority {
        &self.authority
    }

    const fn backend(&self) -> &MissingMaintenanceBackendIdentity {
        &self.backend
    }

    const fn runtime(&self) -> &MissingMaintenanceRuntimeIdentity {
        &self.runtime
    }

    fn column_families(&self) -> &[MissingColumnFamilyEvidence] {
        &self.column_families
    }

    const fn amplification(&self) -> &MissingAmplificationEvidence {
        &self.amplification
    }
}

fn unsupported_amplification() -> MissingAmplificationEvidence {
    MissingAmplificationEvidence {
        user_bytes_written: ProbeSignal::Unsupported,
        stall_micros: ProbeSignal::Unsupported,
        compaction_read_bytes: ProbeSignal::Unsupported,
        compaction_write_bytes: ProbeSignal::Unsupported,
        flush_write_bytes: ProbeSignal::Unsupported,
    }
}

fn property_signal(result: &Result<u64, StorageError>) -> ProbeSignal<u64> {
    match result {
        Ok(value) => ProbeSignal::Available(*value),
        Err(_) => ProbeSignal::Unavailable,
    }
}

fn boolean_property_signal(result: &Result<u64, StorageError>) -> ProbeSignal<bool> {
    match result {
        Ok(0) => ProbeSignal::Available(false),
        Ok(1) => ProbeSignal::Available(true),
        Ok(_) | Err(_) => ProbeSignal::Unavailable,
    }
}

trait MissingMaintenanceEvidenceContract {
    fn maintenance_evidence(&self) -> MissingMaintenanceEvidence;

    fn maintenance_evidence_with_readers<P, S>(
        &self,
        property_reader: P,
        statistics_reader: S,
    ) -> MissingMaintenanceEvidence
    where
        P: FnMut(&str, &str) -> Result<u64, StorageError>,
        S: FnMut(u32) -> Result<u64, StorageError>;
}

impl MissingMaintenanceEvidenceContract for Db {
    fn maintenance_evidence(&self) -> MissingMaintenanceEvidence {
        MissingMaintenanceEvidence {
            schema_version: 0,
            authority: MissingMaintenanceAuthority::Missing,
            backend: MissingMaintenanceBackendIdentity {
                backend: MissingMaintenanceBackend::Missing,
                build: MissingMaintenanceBuild::Missing,
            },
            runtime: MissingMaintenanceRuntimeIdentity {
                open_mode: if self.is_writable() {
                    MissingMaintenanceOpenMode::ReadWrite
                } else {
                    MissingMaintenanceOpenMode::ReadOnly
                },
                database_id: ProbeSignal::Unavailable,
                latest_sequence_number: 0,
            },
            column_families: Vec::new(),
            amplification: unsupported_amplification(),
        }
    }

    fn maintenance_evidence_with_readers<P, S>(
        &self,
        mut property_reader: P,
        mut statistics_reader: S,
    ) -> MissingMaintenanceEvidence
    where
        P: FnMut(&str, &str) -> Result<u64, StorageError>,
        S: FnMut(u32) -> Result<u64, StorageError>,
    {
        let names = match &self.inner {
            DbKind::ReadOnly(db) => &db.column_family_names,
            DbKind::ReadWrite(db) => &db.column_family_names,
        };
        let mut column_families = Vec::with_capacity(names.len());
        for &name in names {
            column_families.push(MissingColumnFamilyEvidence {
                name,
                compaction: MissingCompactionEvidence {
                    pending: boolean_property_signal(&property_reader(name, COMPACTION_PENDING)),
                    estimated_pending_bytes: property_signal(&property_reader(
                        name,
                        PENDING_COMPACTION_BYTES,
                    )),
                },
                health: MissingHealthEvidence {
                    background_errors: property_signal(&property_reader(name, BACKGROUND_ERRORS)),
                },
                stalls: MissingStallEvidence {
                    writes_stopped: boolean_property_signal(&property_reader(name, WRITES_STOPPED)),
                    delayed_write_rate_bytes_per_second: property_signal(&property_reader(
                        name,
                        DELAYED_WRITE_RATE,
                    )),
                },
                resources: MissingResourceEvidence {
                    live_sst_bytes: property_signal(&property_reader(name, LIVE_SST_BYTES)),
                    memtable_bytes: property_signal(&property_reader(name, MEMTABLE_BYTES)),
                    table_reader_bytes: property_signal(&property_reader(name, TABLE_READER_BYTES)),
                },
            });
        }
        let amplification = if cfg!(feature = "rocksdb-debug") && self.is_writable() {
            let mut values = Vec::with_capacity(STATISTICS_TICKERS.len());
            for ticker in STATISTICS_TICKERS {
                values.push(match statistics_reader(ticker) {
                    Ok(value) => ProbeSignal::Available(value),
                    Err(_) => ProbeSignal::Unavailable,
                });
            }
            MissingAmplificationEvidence {
                user_bytes_written: values.remove(0),
                stall_micros: values.remove(0),
                compaction_read_bytes: values.remove(0),
                compaction_write_bytes: values.remove(0),
                flush_write_bytes: values.remove(0),
            }
        } else {
            unsupported_amplification()
        };
        MissingMaintenanceEvidence {
            schema_version: CONTRACT_SCHEMA_VERSION,
            authority: MissingMaintenanceAuthority::DiagnosticsOnly,
            backend: MissingMaintenanceBackendIdentity {
                backend: MissingMaintenanceBackend::RocksDb,
                build: MissingMaintenanceBuild::Vendored {
                    rocksdb_version: VENDORED_VERSION,
                    source_revision: VENDORED_SOURCE_REVISION,
                },
            },
            runtime: MissingMaintenanceRuntimeIdentity {
                open_mode: if self.is_writable() {
                    MissingMaintenanceOpenMode::ReadWrite
                } else {
                    MissingMaintenanceOpenMode::ReadOnly
                },
                database_id: ProbeSignal::Unavailable,
                latest_sequence_number: 0,
            },
            column_families,
            amplification,
        }
    }
}

fn error_fixture() -> StorageError {
    StorageError::Other("injected maintenance property failure".into())
}

fn open_fixture() -> Result<(TempDir, Db, ColumnFamily), StorageError> {
    let directory = TempDir::new()?;
    let db = Db::open_read_write(
        directory.path(),
        vec![ColumnFamilyDefinition {
            name: "data",
            use_iter: true,
            min_prefix_size: 0,
            unordered_writes: false,
        }],
        DbOptions::default(),
    )?;
    let data = db.column_family("data")?;
    Ok((directory, db, data))
}

#[test]
fn vendored_rocksdb_primary_surface_supports_the_bounded_contract() {
    let version = include_str!("../../../../oxrocksdb-sys/rocksdb/include/rocksdb/version.h");
    let db = include_str!("../../../../oxrocksdb-sys/rocksdb/include/rocksdb/db.h");
    let c_api = include_str!("../../../../oxrocksdb-sys/rocksdb/include/rocksdb/c.h");
    let statistics = include_str!("../../../../oxrocksdb-sys/rocksdb/include/rocksdb/statistics.h");

    for declaration in [
        "#define ROCKSDB_MAJOR 11",
        "#define ROCKSDB_MINOR 1",
        "#define ROCKSDB_PATCH 2",
    ] {
        assert!(version.contains(declaration), "missing {declaration}");
    }
    for property in INTEGER_PROPERTIES {
        assert!(
            db.contains(&format!("\"{property}\"")),
            "vendored DB::GetIntProperty does not document {property}",
        );
    }
    for declaration in [
        "rocksdb_property_int_cf(",
        "rocksdb_get_db_identity(",
        "rocksdb_get_latest_sequence_number(",
        "rocksdb_options_statistics_get_string(",
        "rocksdb_options_statistics_get_ticker_count(",
    ] {
        assert!(c_api.contains(declaration), "missing C API {declaration}");
    }
    for declaration in [
        "BYTES_WRITTEN,",
        "STALL_MICROS,",
        "COMPACT_READ_BYTES,",
        "COMPACT_WRITE_BYTES,",
        "FLUSH_WRITE_BYTES,",
    ] {
        assert!(
            statistics.contains(declaration),
            "missing statistics ticker {declaration}",
        );
    }
    assert!(
        db.contains("returns false") && db.contains("IO\n  // errors"),
        "the oracle must retain GetProperty's unavailable/error semantics",
    );
}

#[test]
fn current_c_api_exercises_available_zero_unknown_and_statistics_states() -> Result<(), StorageError>
{
    let (_directory, db, data) = open_fixture()?;
    db.insert(&data, b"key", b"value")?;
    db.flush()?;
    let DbKind::ReadWrite(handler) = &db.inner else {
        unreachable!("open_read_write returned a read-only handler")
    };
    let Some(data_index) = handler
        .column_family_names
        .iter()
        .position(|name| *name == "data")
    else {
        panic!("the fixture data column family must be present");
    };
    let data_handle = handler.cf_handles[data_index];

    for property in INTEGER_PROPERTIES {
        let property = CString::new(property)
            .unwrap_or_else(|error| panic!("property name contains NUL: {error}"));
        let mut value = u64::MAX;
        // SAFETY: The DB, matching column-family handle, property C string,
        // and writable output all remain live for the call.
        let status = unsafe {
            rocksdb_property_int_cf(handler.db, data_handle, property.as_ptr(), &raw mut value)
        };
        assert_eq!(status, 0, "supported property query failed: {property:?}");
    }

    let property = CString::new("rocksdb.not-a-maintenance-property")
        .unwrap_or_else(|error| panic!("hostile property contains NUL: {error}"));
    let mut value = 0;
    // SAFETY: The live DB/handle and output obey the C API contract.
    assert_eq!(
        unsafe {
            rocksdb_property_int_cf(handler.db, data_handle, property.as_ptr(), &raw mut value)
        },
        -1,
        "an unknown property must not be reported as an available zero",
    );

    let mut identity_len = 0;
    // SAFETY: The DB remains live and `identity_len` is writable. A non-null
    // result is freed exactly once below.
    let identity = unsafe { rocksdb_get_db_identity(handler.db, &raw mut identity_len) };
    let Some(identity) = NonNull::new(identity) else {
        panic!("the fixture database must expose its RocksDB IDENTITY value");
    };
    // SAFETY: RocksDB returned `identity_len` initialized bytes. Copy before
    // releasing the RocksDB allocation.
    let identity_bytes = unsafe {
        let bytes = slice::from_raw_parts(identity.as_ptr().cast::<u8>(), identity_len).to_vec();
        rocksdb_free(identity.as_ptr().cast());
        bytes
    };
    assert!(!identity_bytes.is_empty());
    // SAFETY: The DB remains live.
    assert!(unsafe { rocksdb_get_latest_sequence_number(handler.db) } > 0);

    // SAFETY: The options object outlives this query. A non-null result is a
    // RocksDB allocation released once after inspection.
    let statistics = unsafe { rocksdb_options_statistics_get_string(handler.options) };
    if cfg!(feature = "rocksdb-debug") {
        let Some(statistics) = NonNull::new(statistics) else {
            panic!("rocksdb-debug must attach a statistics collector");
        };
        // SAFETY: The returned pointer is NUL-terminated and remains valid
        // until the matching free below.
        let text = unsafe {
            CStr::from_ptr(statistics.as_ptr())
                .to_string_lossy()
                .into_owned()
        };
        assert!(!text.is_empty());
        // SAFETY: The statistics allocation is released exactly once.
        unsafe {
            rocksdb_free(statistics.as_ptr().cast());
        }
        // SAFETY: The live options own an enabled statistics collector and the
        // audited ticker number is valid for the pinned build.
        assert!(
            unsafe {
                rocksdb_options_statistics_get_ticker_count(
                    handler.options,
                    USER_BYTES_WRITTEN_TICKER,
                )
            } > 0
        );
    } else {
        assert!(
            statistics.is_null(),
            "statistics-disabled builds must be classified as unsupported",
        );
    }
    Ok(())
}

#[test]
fn maintenance_evidence_is_typed_identity_bound_and_diagnostic_only() -> Result<(), StorageError> {
    let (directory, db, data) = open_fixture()?;
    let before = db.maintenance_evidence();

    assert_eq!(
        before.schema_version(),
        CONTRACT_SCHEMA_VERSION,
        "RED: RocksDB maintenance evidence is not implemented at the wrapper seam",
    );
    assert!(before.authority().is_diagnostics_only());
    assert!(before.backend().backend().is_rocksdb());
    assert!(before.backend().build().is_vendored());
    assert_eq!(before.backend().build().rocksdb_version(), VENDORED_VERSION);
    assert_eq!(
        before.backend().build().source_revision(),
        Some(VENDORED_SOURCE_REVISION),
        "the default build must bind the exact vendored source revision",
    );
    assert!(before.runtime().open_mode().is_read_write());
    let Some(before_database_id) = before.runtime().database_id().available().cloned() else {
        panic!("an open database must expose its RocksDB IDENTITY");
    };
    assert!(!before_database_id.is_empty());

    db.insert(&data, b"maintenance-key", b"maintenance-value")?;
    db.flush()?;
    let after = db.maintenance_evidence();
    assert_eq!(
        after.runtime().database_id().available(),
        Some(&before_database_id),
        "runtime evidence must remain bound to the same database identity",
    );
    assert!(after.runtime().latest_sequence_number() > before.runtime().latest_sequence_number());
    assert_eq!(
        after
            .column_families()
            .iter()
            .map(|column_family| column_family.name())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["data", "default"]),
    );
    let Some(data_evidence) = after
        .column_families()
        .iter()
        .find(|column_family| column_family.name() == "data")
    else {
        panic!("maintenance evidence must cover the data column family");
    };
    assert!(data_evidence.compaction().pending().is_available());
    assert!(
        data_evidence
            .compaction()
            .estimated_pending_bytes()
            .is_available()
    );
    assert!(data_evidence.health().background_errors().is_available());
    assert!(data_evidence.stalls().writes_stopped().is_available());
    assert!(
        data_evidence
            .stalls()
            .delayed_write_rate_bytes_per_second()
            .is_available()
    );
    assert!(data_evidence.resources().live_sst_bytes().is_available());
    assert!(data_evidence.resources().memtable_bytes().is_available());
    assert!(
        data_evidence
            .resources()
            .table_reader_bytes()
            .is_available()
    );
    assert!(
        data_evidence
            .resources()
            .live_sst_bytes()
            .available()
            .is_some_and(|bytes| *bytes > 0),
        "a flushed nonempty column family must report live SST bytes",
    );
    if cfg!(feature = "rocksdb-debug") {
        assert!(
            after
                .amplification()
                .user_bytes_written()
                .available()
                .is_some_and(|bytes| *bytes > 0)
        );
        assert!(
            after
                .amplification()
                .flush_write_bytes()
                .available()
                .is_some_and(|bytes| *bytes > 0)
        );
        assert!(
            after
                .amplification()
                .signals()
                .into_iter()
                .all(|signal| signal.is_available())
        );
    } else {
        assert!(
            after
                .amplification()
                .signals()
                .into_iter()
                .all(|signal| signal.is_unsupported()),
            "disabled statistics are unsupported, never fabricated zeroes",
        );
    }

    drop(after);
    drop(db);
    let read_only = Db::open_read_only(
        directory.path(),
        vec![ColumnFamilyDefinition {
            name: "data",
            use_iter: true,
            min_prefix_size: 0,
            unordered_writes: false,
        }],
    )?;
    let read_only_evidence = read_only.maintenance_evidence();
    assert!(read_only_evidence.runtime().open_mode().is_read_only());
    assert_eq!(
        read_only_evidence.runtime().database_id().available(),
        Some(&before_database_id),
    );
    assert!(
        read_only_evidence
            .amplification()
            .signals()
            .into_iter()
            .all(|signal| signal.is_unsupported()),
        "a fresh read-only open has no owned cumulative write-statistics history",
    );
    Ok(())
}

#[test]
fn property_errors_are_unavailable_without_aborting_the_evidence() -> Result<(), StorageError> {
    let (_directory, db, _data) = open_fixture()?;
    let evidence = db.maintenance_evidence_with_readers(
        |_column_family, _property| Err(error_fixture()),
        |_ticker| Err(error_fixture()),
    );
    assert_eq!(evidence.schema_version(), CONTRACT_SCHEMA_VERSION);
    for column_family in evidence.column_families() {
        assert!(column_family.compaction().pending().is_unavailable());
        assert!(
            column_family
                .compaction()
                .estimated_pending_bytes()
                .is_unavailable()
        );
        assert!(column_family.health().background_errors().is_unavailable());
        assert!(column_family.stalls().writes_stopped().is_unavailable());
        assert!(
            column_family
                .stalls()
                .delayed_write_rate_bytes_per_second()
                .is_unavailable()
        );
        assert!(column_family.resources().live_sst_bytes().is_unavailable());
        assert!(column_family.resources().memtable_bytes().is_unavailable());
        assert!(
            column_family
                .resources()
                .table_reader_bytes()
                .is_unavailable()
        );
    }
    if cfg!(feature = "rocksdb-debug") {
        assert!(
            evidence
                .amplification()
                .signals()
                .into_iter()
                .all(|signal| signal.is_unavailable())
        );
    } else {
        assert!(
            evidence
                .amplification()
                .signals()
                .into_iter()
                .all(|signal| signal.is_unsupported())
        );
    }
    Ok(())
}

#[test]
fn hostile_boolean_values_are_unavailable_not_truthy() -> Result<(), StorageError> {
    let (_directory, db, _data) = open_fixture()?;
    let evidence = db.maintenance_evidence_with_readers(
        |_column_family, property| {
            Ok(if matches!(property, COMPACTION_PENDING | WRITES_STOPPED) {
                2
            } else {
                0
            })
        },
        |_ticker| Ok(0),
    );
    for column_family in evidence.column_families() {
        assert!(column_family.compaction().pending().is_unavailable());
        assert!(column_family.stalls().writes_stopped().is_unavailable());
        assert_eq!(
            column_family
                .compaction()
                .estimated_pending_bytes()
                .available(),
            Some(&0),
            "an available zero must not be conflated with unavailable",
        );
        assert_eq!(
            column_family.health().background_errors().available(),
            Some(&0),
        );
    }
    Ok(())
}

#[test]
fn read_only_statistics_are_unsupported_even_with_a_spoofing_reader() -> Result<(), StorageError> {
    let directory = TempDir::new()?;
    {
        let seed = Db::open_read_write(directory.path(), Vec::new(), DbOptions::default())?;
        let default = seed.column_family("default")?;
        seed.insert(&default, b"key", b"value")?;
        seed.flush()?;
    }
    let read_only = Db::open_read_only(directory.path(), Vec::new())?;
    let statistics_calls = std::cell::Cell::new(0);
    let evidence = read_only.maintenance_evidence_with_readers(
        |_column_family, _property| Ok(0),
        |_ticker| {
            statistics_calls.set(statistics_calls.get() + 1);
            Ok(u64::MAX)
        },
    );
    assert_eq!(statistics_calls.get(), 0);
    assert!(
        evidence
            .amplification()
            .signals()
            .into_iter()
            .all(|signal| signal.is_unsupported())
    );
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RustToken(String);

fn rust_tokens(source: &str) -> Vec<RustToken> {
    let bytes = source.as_bytes();
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_whitespace() {
            index += 1;
            continue;
        }
        if bytes[index..].starts_with(b"//") {
            index += 2;
            while index < bytes.len() && bytes[index] != b'\n' {
                index += 1;
            }
            continue;
        }
        if bytes[index..].starts_with(b"/*") {
            index += 2;
            let mut depth = 1_usize;
            while index < bytes.len() && depth > 0 {
                if bytes[index..].starts_with(b"/*") {
                    depth += 1;
                    index += 2;
                } else if bytes[index..].starts_with(b"*/") {
                    depth -= 1;
                    index += 2;
                } else {
                    index += 1;
                }
            }
            continue;
        }
        if bytes[index] == b'r' {
            let mut hashes = 0;
            while index + 1 + hashes < bytes.len() && bytes[index + 1 + hashes] == b'#' {
                hashes += 1;
            }
            if index + 1 + hashes < bytes.len() && bytes[index + 1 + hashes] == b'"' {
                let start = index;
                index += hashes + 2;
                while index < bytes.len() {
                    if bytes[index] == b'"'
                        && bytes
                            .get(index + 1..index + 1 + hashes)
                            .is_some_and(|suffix| suffix.iter().all(|byte| *byte == b'#'))
                    {
                        index += hashes + 1;
                        break;
                    }
                    index += 1;
                }
                tokens.push(RustToken(source[start..index].to_owned()));
                continue;
            }
        }
        if bytes[index] == b'"' {
            let start = index;
            index += 1;
            while index < bytes.len() {
                match bytes[index] {
                    b'\\' => index = (index + 2).min(bytes.len()),
                    b'"' => {
                        index += 1;
                        break;
                    }
                    _ => index += 1,
                }
            }
            tokens.push(RustToken(source[start..index].to_owned()));
            continue;
        }
        if bytes[index].is_ascii_alphabetic() || bytes[index] == b'_' {
            let start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            tokens.push(RustToken(source[start..index].to_owned()));
            continue;
        }
        if bytes[index].is_ascii_digit() {
            let start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_alphanumeric() || bytes[index] == b'_')
            {
                index += 1;
            }
            tokens.push(RustToken(source[start..index].to_owned()));
            continue;
        }
        tokens.push(RustToken(char::from(bytes[index]).to_string()));
        index += 1;
    }
    tokens
}

fn has_tokens(tokens: &[RustToken], expected: &[&str]) -> bool {
    tokens.windows(expected.len()).any(|window| {
        window
            .iter()
            .zip(expected)
            .all(|(actual, expected)| actual.0 == *expected)
    })
}

fn curly_depths(tokens: &[RustToken]) -> Option<Vec<usize>> {
    let mut depths = Vec::with_capacity(tokens.len());
    let mut depth = 0_usize;
    for token in tokens {
        depths.push(depth);
        match token.0.as_str() {
            "{" => depth += 1,
            "}" => depth = depth.checked_sub(1)?,
            _ => {}
        }
    }
    (depth == 0).then_some(depths)
}

fn matching_delimiter(tokens: &[RustToken], open: usize, left: &str, right: &str) -> Option<usize> {
    let mut depth = 0_usize;
    for (index, token) in tokens.iter().enumerate().skip(open) {
        if token.0 == left {
            depth += 1;
        } else if token.0 == right {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn prefix_start(
    tokens: &[RustToken],
    depths: &[usize],
    declaration: usize,
    scope_depth: usize,
    lower_bound: usize,
) -> usize {
    for index in (lower_bound..declaration).rev() {
        if (tokens[index].0 == ";" && depths[index] == scope_depth)
            || (tokens[index].0 == "}" && depths[index] == scope_depth + 1)
        {
            return index + 1;
        }
    }
    lower_bound
}

fn has_cfg_attribute(tokens: &[RustToken]) -> bool {
    has_tokens(tokens, &["#", "[", "cfg"]) || has_tokens(tokens, &["#", "[", "cfg_attr"])
}

fn has_only_test_cfg_attribute(tokens: &[RustToken]) -> bool {
    let cfg_attributes = tokens
        .windows(3)
        .filter(|window| {
            window.first().is_some_and(|token| token.0 == "#")
                && window.get(1).is_some_and(|token| token.0 == "[")
                && window
                    .get(2)
                    .is_some_and(|token| matches!(token.0.as_str(), "cfg" | "cfg_attr"))
        })
        .count();
    cfg_attributes == 1 && has_tokens(tokens, &["#", "[", "cfg", "(", "test", ")", "]"])
}

#[derive(Clone, Copy, Debug)]
struct TopLevelItem {
    declaration: usize,
    body_open: Option<usize>,
    end: usize,
    conditional: bool,
}

fn top_level_named_items(tokens: &[RustToken], kind: &str, name: &str) -> Vec<TopLevelItem> {
    let Some(depths) = curly_depths(tokens) else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for declaration in 0..tokens.len().saturating_sub(1) {
        if depths[declaration] != 0
            || tokens[declaration].0 != kind
            || tokens[declaration + 1].0 != name
        {
            continue;
        }
        let terminator = (declaration + 2..tokens.len())
            .find(|index| depths[*index] == 0 && matches!(tokens[*index].0.as_str(), "{" | ";"));
        let Some(terminator) = terminator else {
            continue;
        };
        let (body_open, end) = if tokens[terminator].0 == "{" {
            let Some(end) = matching_delimiter(tokens, terminator, "{", "}") else {
                continue;
            };
            (Some(terminator), end)
        } else {
            (None, terminator)
        };
        let prefix = prefix_start(tokens, &depths, declaration, 0, 0);
        items.push(TopLevelItem {
            declaration,
            body_open,
            end,
            conditional: has_cfg_attribute(&tokens[prefix..declaration]),
        });
    }
    items
}

fn unique_unconditional_top_level_item(
    tokens: &[RustToken],
    kind: &str,
    name: &str,
) -> Option<TopLevelItem> {
    let items = top_level_named_items(tokens, kind, name);
    (items.len() == 1 && !items[0].conditional).then(|| items[0])
}

fn top_level_const_matches(tokens: &[RustToken], name: &str, expected: &[&str]) -> bool {
    let Some(item) = unique_unconditional_top_level_item(tokens, "const", name) else {
        return false;
    };
    item.body_open.is_none()
        && tokens[item.declaration..=item.end]
            .iter()
            .map(|token| token.0.as_str())
            .eq(expected.iter().copied())
}

fn enum_variants(tokens: &[RustToken], enum_name: &str) -> Option<Vec<String>> {
    let item = unique_unconditional_top_level_item(tokens, "enum", enum_name)?;
    let body = item.body_open?;
    let mut delimiter_depth = 1_usize;
    let mut variants = Vec::new();
    let mut expecting_variant = true;
    for token in &tokens[body + 1..=item.end] {
        match token.0.as_str() {
            "{" | "(" | "[" => delimiter_depth += 1,
            "}" if delimiter_depth == 1 => return Some(variants),
            "}" | ")" | "]" => delimiter_depth = delimiter_depth.checked_sub(1)?,
            "," if delimiter_depth == 1 => expecting_variant = true,
            value
                if delimiter_depth == 1
                    && expecting_variant
                    && value
                        .as_bytes()
                        .first()
                        .is_some_and(u8::is_ascii_alphabetic) =>
            {
                variants.push(value.to_owned());
                expecting_variant = false;
            }
            _ => {}
        }
    }
    None
}

fn top_level_struct_field_type(
    tokens: &[RustToken],
    struct_name: &str,
    field_name: &str,
) -> Option<Vec<String>> {
    let item = unique_unconditional_top_level_item(tokens, "struct", struct_name)?;
    let body = item.body_open?;
    let mut start = body + 1;
    let mut delimiter_depth = 0_usize;
    for index in body + 1..=item.end {
        match tokens[index].0.as_str() {
            "(" | "[" | "{" | "<" => delimiter_depth += 1,
            ")" | "]" | "}" | ">" if delimiter_depth > 0 => delimiter_depth -= 1,
            "," | "}" if delimiter_depth == 0 => {
                let field = &tokens[start..index];
                if let Some(colon) = field.iter().position(|token| token.0 == ":")
                    && colon > 0
                    && field[colon - 1].0 == field_name
                {
                    return Some(
                        field[colon + 1..]
                            .iter()
                            .map(|token| token.0.clone())
                            .collect(),
                    );
                }
                start = index + 1;
            }
            _ => {}
        }
    }
    None
}

fn struct_field_has_type(
    tokens: &[RustToken],
    struct_name: &str,
    field_name: &str,
    expected_type: &[&str],
) -> bool {
    top_level_struct_field_type(tokens, struct_name, field_name).is_some_and(|actual| {
        actual
            .iter()
            .map(String::as_str)
            .eq(expected_type.iter().copied())
    })
}

#[derive(Clone, Copy, Debug)]
struct ImplSpan {
    body_open: usize,
    body_close: usize,
    conditional: bool,
    test_only: bool,
}

fn top_level_inherent_impls(tokens: &[RustToken], type_name: &str) -> Vec<ImplSpan> {
    let Some(depths) = curly_depths(tokens) else {
        return Vec::new();
    };
    let mut implementations = Vec::new();
    for declaration in 0..tokens.len().saturating_sub(1) {
        if depths[declaration] != 0 || tokens[declaration].0 != "impl" {
            continue;
        }
        let Some(body_open) = (declaration + 1..tokens.len())
            .find(|index| depths[*index] == 0 && tokens[*index].0 == "{")
        else {
            continue;
        };
        if !tokens[declaration + 1..body_open]
            .iter()
            .map(|token| token.0.as_str())
            .eq([type_name])
        {
            continue;
        }
        let Some(body_close) = matching_delimiter(tokens, body_open, "{", "}") else {
            continue;
        };
        let prefix = prefix_start(tokens, &depths, declaration, 0, 0);
        let attributes = &tokens[prefix..declaration];
        implementations.push(ImplSpan {
            body_open,
            body_close,
            conditional: has_cfg_attribute(attributes),
            test_only: has_only_test_cfg_attribute(attributes),
        });
    }
    implementations
}

#[derive(Debug)]
struct MethodSignature {
    arguments: Vec<String>,
    return_type: Vec<String>,
    conditional: bool,
    test_only: bool,
}

fn inherent_methods(
    tokens: &[RustToken],
    type_name: &str,
    method_name: &str,
) -> Vec<MethodSignature> {
    let Some(depths) = curly_depths(tokens) else {
        return Vec::new();
    };
    let mut methods = Vec::new();
    for implementation in top_level_inherent_impls(tokens, type_name) {
        for declaration in implementation.body_open + 1..implementation.body_close {
            if depths[declaration] != 1
                || tokens[declaration].0 != "fn"
                || tokens
                    .get(declaration + 1)
                    .is_none_or(|token| token.0 != method_name)
            {
                continue;
            }
            let Some(arguments_open) = (declaration + 2..implementation.body_close)
                .find(|index| depths[*index] == 1 && tokens[*index].0 == "(")
            else {
                continue;
            };
            let Some(arguments_close) = matching_delimiter(tokens, arguments_open, "(", ")") else {
                continue;
            };
            let signature_end = (arguments_close + 1..implementation.body_close)
                .find(|index| depths[*index] == 1 && matches!(tokens[*index].0.as_str(), "{" | ";"))
                .unwrap_or(implementation.body_close);
            let return_type = tokens[arguments_close + 1..signature_end]
                .iter()
                .position(|token| token.0 == "-")
                .and_then(|arrow| {
                    let arrow = arguments_close + 1 + arrow;
                    (tokens.get(arrow + 1)?.0 == ">").then(|| {
                        tokens[arrow + 2..signature_end]
                            .iter()
                            .map(|token| token.0.clone())
                            .collect()
                    })
                })
                .unwrap_or_default();
            let prefix = prefix_start(
                tokens,
                &depths,
                declaration,
                1,
                implementation.body_open + 1,
            );
            let attributes = &tokens[prefix..declaration];
            let method_conditional = has_cfg_attribute(attributes);
            methods.push(MethodSignature {
                arguments: tokens[arguments_open + 1..arguments_close]
                    .iter()
                    .map(|token| token.0.clone())
                    .collect(),
                return_type,
                conditional: implementation.conditional || method_conditional,
                test_only: (!implementation.conditional || implementation.test_only)
                    && (!method_conditional || has_only_test_cfg_attribute(attributes)),
            });
        }
    }
    methods
}

fn has_unique_unconditional_method(
    tokens: &[RustToken],
    type_name: &str,
    method_name: &str,
    expected_arguments: &[&str],
    expected_return: &[&str],
) -> bool {
    let methods = inherent_methods(tokens, type_name, method_name);
    methods.len() == 1
        && !methods[0].conditional
        && methods[0]
            .arguments
            .iter()
            .map(String::as_str)
            .eq(expected_arguments.iter().copied())
        && methods[0]
            .return_type
            .iter()
            .map(String::as_str)
            .eq(expected_return.iter().copied())
}

fn has_unique_method_in_impl(tokens: &[RustToken], type_name: &str, method_name: &str) -> bool {
    let methods = inherent_methods(tokens, type_name, method_name);
    methods.len() == 1 && (!methods[0].conditional || methods[0].test_only)
}

fn contract_source_failures(source: &str) -> Vec<&'static str> {
    let tokens = rust_tokens(source);
    let mut failures = Vec::new();
    for (name, const_name, sequence) in [
        (
            "schema version",
            "ROCKSDB_MAINTENANCE_EVIDENCE_SCHEMA_VERSION",
            &[
                "const",
                "ROCKSDB_MAINTENANCE_EVIDENCE_SCHEMA_VERSION",
                ":",
                "u16",
                "=",
                "1",
                ";",
            ][..],
        ),
        (
            "vendored version",
            "VENDORED_ROCKSDB_VERSION",
            &[
                "const",
                "VENDORED_ROCKSDB_VERSION",
                ":",
                "&",
                "str",
                "=",
                "\"11.1.2\"",
                ";",
            ],
        ),
        (
            "vendored source revision",
            "VENDORED_ROCKSDB_SOURCE_REVISION",
            &[
                "const",
                "VENDORED_ROCKSDB_SOURCE_REVISION",
                ":",
                "&",
                "str",
                "=",
                "\"3b446089141659fad25328c5ea3e7ed283df46e4\"",
                ";",
            ],
        ),
    ] {
        if !top_level_const_matches(&tokens, const_name, sequence) {
            failures.push(name);
        }
    }
    for (name, kind, type_name) in [
        ("availability enum", "enum", "RocksDbMaintenanceSignal"),
        (
            "diagnostic authority",
            "enum",
            "RocksDbMaintenanceAuthority",
        ),
        ("backend discriminator", "enum", "RocksDbMaintenanceBackend"),
        ("build identity", "enum", "RocksDbMaintenanceBuild"),
        ("open mode", "enum", "RocksDbMaintenanceOpenMode"),
        (
            "backend identity",
            "struct",
            "RocksDbMaintenanceBackendIdentity",
        ),
        (
            "runtime identity",
            "struct",
            "RocksDbMaintenanceRuntimeIdentity",
        ),
        ("top-level evidence", "struct", "RocksDbMaintenanceEvidence"),
        (
            "column-family evidence",
            "struct",
            "RocksDbColumnFamilyMaintenanceEvidence",
        ),
        ("compaction evidence", "struct", "RocksDbCompactionEvidence"),
        ("health evidence", "struct", "RocksDbHealthEvidence"),
        ("stall evidence", "struct", "RocksDbStallEvidence"),
        ("resource evidence", "struct", "RocksDbResourceEvidence"),
        (
            "amplification evidence",
            "struct",
            "RocksDbAmplificationEvidence",
        ),
    ] {
        if unique_unconditional_top_level_item(&tokens, kind, type_name).is_none() {
            failures.push(name);
        }
    }
    for (name, struct_name, field_name, field_type) in [
        (
            "typed authority field",
            "RocksDbMaintenanceEvidence",
            "authority",
            &["RocksDbMaintenanceAuthority"][..],
        ),
        (
            "typed backend identity field",
            "RocksDbMaintenanceEvidence",
            "backend",
            &["RocksDbMaintenanceBackendIdentity"],
        ),
        (
            "typed runtime identity field",
            "RocksDbMaintenanceEvidence",
            "runtime",
            &["RocksDbMaintenanceRuntimeIdentity"],
        ),
        (
            "typed backend field",
            "RocksDbMaintenanceBackendIdentity",
            "backend",
            &["RocksDbMaintenanceBackend"],
        ),
        (
            "typed build field",
            "RocksDbMaintenanceBackendIdentity",
            "build",
            &["RocksDbMaintenanceBuild"],
        ),
        (
            "typed database identity field",
            "RocksDbMaintenanceRuntimeIdentity",
            "database_id",
            &["RocksDbMaintenanceSignal", "<", "String", ">"],
        ),
        (
            "typed open mode field",
            "RocksDbMaintenanceRuntimeIdentity",
            "open_mode",
            &["RocksDbMaintenanceOpenMode"],
        ),
        (
            "typed sequence field",
            "RocksDbMaintenanceRuntimeIdentity",
            "latest_sequence_number",
            &["u64"],
        ),
    ] {
        if !struct_field_has_type(&tokens, struct_name, field_name, field_type) {
            failures.push(name);
        }
    }
    for (name, type_name, method_name, return_type) in [
        (
            "typed authority accessor",
            "RocksDbMaintenanceEvidence",
            "authority",
            &["&", "RocksDbMaintenanceAuthority"][..],
        ),
        (
            "typed backend identity accessor",
            "RocksDbMaintenanceEvidence",
            "backend",
            &["&", "RocksDbMaintenanceBackendIdentity"],
        ),
        (
            "typed runtime identity accessor",
            "RocksDbMaintenanceEvidence",
            "runtime",
            &["&", "RocksDbMaintenanceRuntimeIdentity"],
        ),
        (
            "typed backend accessor",
            "RocksDbMaintenanceBackendIdentity",
            "backend",
            &["&", "RocksDbMaintenanceBackend"],
        ),
        (
            "typed build accessor",
            "RocksDbMaintenanceBackendIdentity",
            "build",
            &["&", "RocksDbMaintenanceBuild"],
        ),
        (
            "typed database identity accessor",
            "RocksDbMaintenanceRuntimeIdentity",
            "database_id",
            &["&", "RocksDbMaintenanceSignal", "<", "String", ">"],
        ),
        (
            "typed open mode accessor",
            "RocksDbMaintenanceRuntimeIdentity",
            "open_mode",
            &["&", "RocksDbMaintenanceOpenMode"],
        ),
        (
            "typed sequence accessor",
            "RocksDbMaintenanceRuntimeIdentity",
            "latest_sequence_number",
            &["u64"],
        ),
    ] {
        if !has_unique_unconditional_method(
            &tokens,
            type_name,
            method_name,
            &["&", "self"],
            return_type,
        ) {
            failures.push(name);
        }
    }
    if !has_unique_unconditional_method(
        &tokens,
        "Db",
        "maintenance_evidence",
        &["&", "self"],
        &["RocksDbMaintenanceEvidence"],
    ) {
        failures.push("production collector");
    }
    if !has_unique_method_in_impl(&tokens, "Db", "maintenance_evidence_with_readers") {
        failures.push("fault-injection collector");
    }
    for literal in [
        "\"rocksdb.compaction-pending\"",
        "\"rocksdb.estimate-pending-compaction-bytes\"",
        "\"rocksdb.background-errors\"",
        "\"rocksdb.is-write-stopped\"",
        "\"rocksdb.actual-delayed-write-rate\"",
        "\"rocksdb.live-sst-files-size\"",
        "\"rocksdb.size-all-mem-tables\"",
        "\"rocksdb.estimate-table-readers-mem\"",
    ] {
        if !has_tokens(&tokens, &[literal]) {
            failures.push("audited integer property");
        }
    }
    for (ticker, value) in [
        ("ROCKSDB_TICKER_USER_BYTES_WRITTEN", "61"),
        ("ROCKSDB_TICKER_STALL_MICROS", "76"),
        ("ROCKSDB_TICKER_COMPACTION_READ_BYTES", "89"),
        ("ROCKSDB_TICKER_COMPACTION_WRITE_BYTES", "90"),
        ("ROCKSDB_TICKER_FLUSH_WRITE_BYTES", "91"),
    ] {
        if !top_level_const_matches(
            &tokens,
            ticker,
            &["const", ticker, ":", "u32", "=", value, ";"],
        ) {
            failures.push("audited statistics ticker");
        }
    }
    if enum_variants(&tokens, "RocksDbMaintenanceSignal")
        != Some(vec![
            "Available".to_owned(),
            "Unavailable".to_owned(),
            "Unsupported".to_owned(),
        ])
    {
        failures.push("three-state signal variants");
    }
    if enum_variants(&tokens, "RocksDbMaintenanceAuthority")
        != Some(vec!["DiagnosticsOnly".to_owned()])
    {
        failures.push("diagnostic-only variant");
    }
    if enum_variants(&tokens, "RocksDbMaintenanceBackend") != Some(vec!["RocksDb".to_owned()]) {
        failures.push("RocksDB backend variant");
    }
    if enum_variants(&tokens, "RocksDbMaintenanceBuild")
        != Some(vec!["Vendored".to_owned(), "System".to_owned()])
    {
        failures.push("vendored/system build variants");
    }
    if enum_variants(&tokens, "RocksDbMaintenanceOpenMode")
        != Some(vec!["ReadWrite".to_owned(), "ReadOnly".to_owned()])
    {
        failures.push("read-write/read-only variants");
    }
    failures
}

#[test]
fn source_contract_scanner_rejects_comment_and_string_spoofs() {
    let hostile = r#"
        // pub(crate) enum RocksDbMaintenanceSignal<T> { Available(T), Unavailable, Unsupported }
        const LIE: &str = "struct RocksDbMaintenanceEvidence; fn maintenance_evidence(&self)";
        /* enum RocksDbMaintenanceAuthority { DiagnosticsOnly } */
    "#;
    let failures = contract_source_failures(hostile);
    assert!(failures.contains(&"availability enum"));
    assert!(failures.contains(&"top-level evidence"));
    assert!(failures.contains(&"production collector"));
    assert!(failures.contains(&"diagnostic authority"));

    let authority_spoof = "
        pub(crate) enum RocksDbMaintenanceAuthority { DiagnosticsOnly, ReadinessAuthority }
    ";
    assert!(
        contract_source_failures(authority_spoof).contains(&"diagnostic-only variant"),
        "an extra readiness-capable variant must not pass the diagnostic-only guard",
    );
}

#[test]
fn authority_selection_rejects_nested_inactive_duplicate_and_dead_decoys() {
    let valid = rust_tokens(
        "enum RocksDbMaintenanceAuthority { DiagnosticsOnly }
         struct RocksDbMaintenanceEvidence {
            authority: RocksDbMaintenanceAuthority,
         }
         impl RocksDbMaintenanceEvidence {
            fn authority(&self) -> &RocksDbMaintenanceAuthority { &self.authority }
         }",
    );
    assert_eq!(
        enum_variants(&valid, "RocksDbMaintenanceAuthority"),
        Some(vec!["DiagnosticsOnly".to_owned()]),
        "the hostile control must first prove the exact top-level declaration can pass",
    );
    assert!(struct_field_has_type(
        &valid,
        "RocksDbMaintenanceEvidence",
        "authority",
        &["RocksDbMaintenanceAuthority"],
    ));
    assert!(has_unique_unconditional_method(
        &valid,
        "RocksDbMaintenanceEvidence",
        "authority",
        &["&", "self"],
        &["&", "RocksDbMaintenanceAuthority"],
    ));

    let nested = rust_tokens("mod decoy { enum RocksDbMaintenanceAuthority { DiagnosticsOnly } }");
    assert!(
        unique_unconditional_top_level_item(&nested, "enum", "RocksDbMaintenanceAuthority")
            .is_none(),
        "a nested authority declaration must not count as the contract type",
    );

    let inactive =
        rust_tokens("#[cfg(any())] enum RocksDbMaintenanceAuthority { DiagnosticsOnly }");
    assert!(
        unique_unconditional_top_level_item(&inactive, "enum", "RocksDbMaintenanceAuthority")
            .is_none(),
        "an inactive authority declaration must not count as the contract type",
    );

    let duplicate = rust_tokens(
        "enum RocksDbMaintenanceAuthority { DiagnosticsOnly }
         enum RocksDbMaintenanceAuthority { DiagnosticsOnly }",
    );
    assert!(
        unique_unconditional_top_level_item(&duplicate, "enum", "RocksDbMaintenanceAuthority")
            .is_none(),
        "duplicate authority declarations must fail closed",
    );

    let nested_good_cannot_mask_bad_top_level = rust_tokens(
        "enum RocksDbMaintenanceAuthority { DiagnosticsOnly, ReadinessAuthority }
         mod decoy { enum RocksDbMaintenanceAuthority { DiagnosticsOnly } }",
    );
    assert_ne!(
        enum_variants(
            &nested_good_cannot_mask_bad_top_level,
            "RocksDbMaintenanceAuthority"
        ),
        Some(vec!["DiagnosticsOnly".to_owned()]),
        "a nested diagnostic-only decoy must not mask authority in the real declaration",
    );

    let dead = rust_tokens(
        "enum RocksDbMaintenanceAuthority { DiagnosticsOnly }
         struct RocksDbMaintenanceEvidence { authority: bool }",
    );
    assert!(
        enum_variants(&dead, "RocksDbMaintenanceAuthority").is_some(),
        "the dead-type control must retain an otherwise-valid authority declaration",
    );
    assert!(
        !struct_field_has_type(
            &dead,
            "RocksDbMaintenanceEvidence",
            "authority",
            &["RocksDbMaintenanceAuthority"],
        ),
        "a detached authority enum must not satisfy scalar evidence",
    );
}

#[test]
fn collector_selection_rejects_nested_inactive_duplicate_and_dead_decoys() {
    let valid = rust_tokens(
        "impl Db {
            fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence { todo!() }
        }",
    );
    assert!(
        has_unique_unconditional_method(
            &valid,
            "Db",
            "maintenance_evidence",
            &["&", "self"],
            &["RocksDbMaintenanceEvidence"],
        ),
        "the hostile control must first prove the exact production collector can pass",
    );

    let nested = rust_tokens(
        "mod decoy {
            impl Db {
                fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence { todo!() }
            }
        }",
    );
    assert!(
        !has_unique_unconditional_method(
            &nested,
            "Db",
            "maintenance_evidence",
            &["&", "self"],
            &["RocksDbMaintenanceEvidence"],
        ),
        "a nested collector must not count as the wrapper collector",
    );

    let inactive = rust_tokens(
        "impl Db {
            #[cfg(any())]
            fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence { todo!() }
        }",
    );
    assert!(
        !has_unique_unconditional_method(
            &inactive,
            "Db",
            "maintenance_evidence",
            &["&", "self"],
            &["RocksDbMaintenanceEvidence"],
        ),
        "an inactive collector must not count as the production collector",
    );

    let duplicate = rust_tokens(
        "impl Db {
            fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence { todo!() }
        }
        impl Db {
            fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence { todo!() }
        }",
    );
    assert!(
        !has_unique_unconditional_method(
            &duplicate,
            "Db",
            "maintenance_evidence",
            &["&", "self"],
            &["RocksDbMaintenanceEvidence"],
        ),
        "duplicate production collectors must fail closed",
    );

    let dead = rust_tokens(
        "fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence { todo!() }
         impl Other {
            fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence { todo!() }
         }
         impl Db {
            fn maintenance_evidence(&self) -> bool { false }
         }",
    );
    assert!(
        !has_unique_unconditional_method(
            &dead,
            "Db",
            "maintenance_evidence",
            &["&", "self"],
            &["RocksDbMaintenanceEvidence"],
        ),
        "free, foreign-impl, and wrong-return collectors must not establish evidence identity",
    );

    let test_hook = rust_tokens(
        "impl Db {
            #[cfg(test)]
            fn maintenance_evidence_with_readers(&self) { }
         }",
    );
    assert!(has_unique_method_in_impl(
        &test_hook,
        "Db",
        "maintenance_evidence_with_readers",
    ));
    let inactive_hook = rust_tokens(
        "impl Db {
            #[cfg(any())]
            fn maintenance_evidence_with_readers(&self) { }
         }",
    );
    assert!(
        !has_unique_method_in_impl(&inactive_hook, "Db", "maintenance_evidence_with_readers",),
        "an inactive fault-injection decoy must not leave controls on the fallback path",
    );
}

#[test]
fn wrapper_declares_the_typed_maintenance_evidence_contract() {
    let failures = contract_source_failures(include_str!("rocksdb_wrapper.rs"));
    assert!(
        failures.is_empty(),
        "RED: the RocksDB wrapper does not implement the frozen typed maintenance evidence contract: {failures:?}",
    );
}
