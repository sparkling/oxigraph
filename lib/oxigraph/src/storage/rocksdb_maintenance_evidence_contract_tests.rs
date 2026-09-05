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
use std::fs::{read_to_string, write};
use std::path::{Path, PathBuf};
use std::process::Command;
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
    System {
        rocksdb_version: String,
    },
    Missing,
}

impl MissingMaintenanceBuild {
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
            Self::Missing => "missing",
        }
    }

    const fn source_revision(&self) -> Option<&str> {
        match self {
            Self::Vendored {
                source_revision, ..
            } => Some(source_revision),
            Self::System { .. } | Self::Missing => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ExpectedMaintenanceBuild<'a> {
    Vendored {
        rocksdb_version: &'a str,
        source_revision: &'a str,
    },
    System {
        rocksdb_version: &'a str,
    },
}

fn expected_maintenance_build_from_relay<'a>(
    build_kind: Option<&'a str>,
    rocksdb_version: Option<&'a str>,
    source_revision: Option<&'a str>,
) -> Result<ExpectedMaintenanceBuild<'a>, &'static str> {
    match (build_kind, rocksdb_version, source_revision) {
        (Some("vendored"), Some(VENDORED_VERSION), Some(VENDORED_SOURCE_REVISION)) => {
            Ok(ExpectedMaintenanceBuild::Vendored {
                rocksdb_version: VENDORED_VERSION,
                source_revision: VENDORED_SOURCE_REVISION,
            })
        }
        (Some("system"), Some(rocksdb_version), None) if !rocksdb_version.is_empty() => {
            Ok(ExpectedMaintenanceBuild::System { rocksdb_version })
        }
        (Some("vendored"), _, _) => Err("invalid vendored RocksDB build metadata"),
        (Some("system"), _, _) => Err("invalid system RocksDB build metadata"),
        _ => Err("missing or unknown RocksDB build metadata"),
    }
}

fn expected_maintenance_build() -> Result<ExpectedMaintenanceBuild<'static>, &'static str> {
    expected_maintenance_build_from_relay(
        ::core::option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND"),
        ::core::option_env!("OXIGRAPH_ROCKSDB_VERSION"),
        ::core::option_env!("OXIGRAPH_ROCKSDB_SOURCE_REVISION"),
    )
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
fn build_metadata_relay_selects_an_exact_backend_identity() {
    let build = expected_maintenance_build().unwrap_or_else(|error| {
        panic!("RED: the actual oxrocksdb-sys build selection was not relayed to oxigraph: {error}")
    });
    match build {
        ExpectedMaintenanceBuild::Vendored {
            rocksdb_version,
            source_revision,
        } => {
            assert_eq!(rocksdb_version, VENDORED_VERSION);
            assert_eq!(source_revision, VENDORED_SOURCE_REVISION);
        }
        ExpectedMaintenanceBuild::System { rocksdb_version } => {
            assert!(!rocksdb_version.is_empty());
        }
    }
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
    match expected_maintenance_build().expect("build metadata relay must be valid") {
        ExpectedMaintenanceBuild::Vendored {
            rocksdb_version,
            source_revision,
        } => {
            assert!(before.backend().build().is_vendored());
            assert_eq!(before.backend().build().rocksdb_version(), rocksdb_version);
            assert_eq!(
                before.backend().build().source_revision(),
                Some(source_revision),
                "the default build must bind the exact vendored source revision",
            );
        }
        ExpectedMaintenanceBuild::System { rocksdb_version } => {
            assert!(before.backend().build().is_system());
            assert_eq!(before.backend().build().rocksdb_version(), rocksdb_version);
            assert_eq!(
                before.backend().build().source_revision(),
                None,
                "a system build must not inherit the vendored source revision",
            );
        }
    }
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

fn unique_unconditional_function_body<'a>(
    tokens: &'a [RustToken],
    name: &str,
) -> Option<&'a [RustToken]> {
    let item = unique_unconditional_top_level_item(tokens, "fn", name)?;
    let body_open = item.body_open?;
    Some(&tokens[body_open..=item.end])
}

fn unique_unconditional_function_has_header(
    tokens: &[RustToken],
    name: &str,
    expected: &[&str],
) -> bool {
    let Some(item) = unique_unconditional_top_level_item(tokens, "fn", name) else {
        return false;
    };
    let Some(body_open) = item.body_open else {
        return false;
    };
    tokens[item.declaration..body_open]
        .iter()
        .map(|token| token.0.as_str())
        .eq(expected.iter().copied())
}

fn unique_unconditional_function_has_exact_prefix_and_header(
    tokens: &[RustToken],
    name: &str,
    expected: &[&str],
) -> bool {
    let Some(depths) = curly_depths(tokens) else {
        return false;
    };
    let Some(item) = unique_unconditional_top_level_item(tokens, "fn", name) else {
        return false;
    };
    let Some(body_open) = item.body_open else {
        return false;
    };
    let prefix = prefix_start(tokens, &depths, item.declaration, 0, 0);
    tokens[prefix..body_open]
        .iter()
        .map(|token| token.0.as_str())
        .eq(expected.iter().copied())
}

fn unique_unconditional_method_body<'a>(
    tokens: &'a [RustToken],
    type_name: &str,
    method_name: &str,
) -> Option<&'a [RustToken]> {
    let depths = curly_depths(tokens)?;
    let mut bodies = Vec::new();
    for implementation in top_level_inherent_impls(tokens, type_name) {
        if implementation.conditional {
            continue;
        }
        for declaration in implementation.body_open + 1..implementation.body_close {
            if depths[declaration] != 1
                || tokens[declaration].0 != "fn"
                || tokens
                    .get(declaration + 1)
                    .is_none_or(|token| token.0 != method_name)
            {
                continue;
            }
            let body_open = (declaration + 2..implementation.body_close)
                .find(|index| depths[*index] == 1 && tokens[*index].0 == "{")?;
            let body_close = matching_delimiter(tokens, body_open, "{", "}")?;
            bodies.push(&tokens[body_open..=body_close]);
        }
    }
    (bodies.len() == 1).then(|| bodies[0])
}

fn returned_top_level_struct_field_is_direct_call(
    body: &[RustToken],
    struct_name: &str,
    field_name: &str,
    function_name: &str,
) -> bool {
    if body.first().is_none_or(|token| token.0 != "{")
        || body.last().is_none_or(|token| token.0 != "}")
    {
        return false;
    }
    let Some(depths) = curly_depths(body) else {
        return false;
    };
    let mut returned_literals = Vec::new();
    for literal in 1..body.len() - 1 {
        if depths[literal] != 1
            || body[literal].0 != struct_name
            || body.get(literal + 1).is_none_or(|token| token.0 != "{")
        {
            continue;
        }
        let Some(close) = matching_delimiter(body, literal + 1, "{", "}") else {
            return false;
        };
        let tail_expression = close + 1 == body.len() - 1;
        let direct_return = close + 2 == body.len() - 1
            && body[close + 1].0 == ";"
            && literal > 1
            && body[literal - 1].0 == "return";
        if tail_expression || direct_return {
            returned_literals.push((literal, literal + 1, close, direct_return));
        }
    }
    let [(literal, open, close, direct_return)] = returned_literals.as_slice() else {
        return false;
    };
    let return_count = token_value_count(body, "return");
    if (*direct_return && (return_count != 1 || body[*literal - 1].0 != "return"))
        || (!*direct_return && return_count != 0)
    {
        return false;
    }
    let direct_fields = (*open + 1..*close)
        .filter(|index| {
            depths[*index] == 2
                && body[*index].0 == field_name
                && body.get(*index + 1).is_some_and(|token| token.0 == ":")
                && depths[*index + 1] == 2
        })
        .collect::<Vec<_>>();
    let [field] = direct_fields.as_slice() else {
        return false;
    };
    body.get(*field..*field + 6).is_some_and(|tokens| {
        exact_token_sequence(tokens, &[field_name, ":", function_name, "(", ")", ","])
    })
}

fn token_sequence_count(tokens: &[RustToken], expected: &[&str]) -> usize {
    tokens
        .windows(expected.len())
        .filter(|window| {
            window
                .iter()
                .zip(expected)
                .all(|(actual, expected)| actual.0 == *expected)
        })
        .count()
}

fn exact_token_sequence(tokens: &[RustToken], expected: &[&str]) -> bool {
    tokens
        .iter()
        .map(|token| token.0.as_str())
        .eq(expected.iter().copied())
}

fn token_value_count(tokens: &[RustToken], expected: &str) -> usize {
    tokens.iter().filter(|token| token.0 == expected).count()
}

fn top_level_function_with_exact_attribute(
    tokens: &[RustToken],
    name: &str,
    expected_attribute: &[&str],
) -> Option<TopLevelItem> {
    let depths = curly_depths(tokens)?;
    let matching = top_level_named_items(tokens, "fn", name)
        .into_iter()
        .filter(|item| {
            let prefix = prefix_start(tokens, &depths, item.declaration, 0, 0);
            tokens[prefix..item.declaration]
                .iter()
                .map(|token| token.0.as_str())
                .eq(expected_attribute.iter().copied())
        })
        .collect::<Vec<_>>();
    (matching.len() == 1).then(|| matching[0])
}

fn manifest_package_build_script(manifest: &str) -> Option<&str> {
    let mut in_package = false;
    for line in manifest.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_package = line == "[package]";
            continue;
        }
        if !in_package || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() == "build" {
            return value.trim().strip_prefix('"')?.strip_suffix('"');
        }
    }
    None
}

fn reviewed_sys_build_helpers() -> &'static str {
    r#"
        use std::env::var;
        #[cfg(not(feature = "pkg-config"))]
        use std::env::{remove_var, set_var};
        use std::path::PathBuf;

        #[cfg(not(feature = "pkg-config"))]
        fn link(name: &str, bundled: bool) {
            let target = var("TARGET").unwrap();
            let target: Vec<_> = target.split('-').collect();
            if target.get(2) == Some(&"windows") {
                println!("cargo:rustc-link-lib=dylib={name}");
                if bundled && target.get(3) == Some(&"gnu") {
                    let dir = var("CARGO_MANIFEST_DIR").unwrap();
                    println!("cargo:rustc-link-search=native={}/{}", dir, target[0]);
                }
            }
        }

        fn bindgen_rocksdb_api(includes: &[PathBuf]) {
            println!("cargo:rerun-if-changed=api/");

            let mut builder = bindgen::Builder::default();
            for include in includes {
                builder = builder.clang_arg(format!("-I{}", include.display()));
            }
            builder
                .header("api/c.h")
                .allowlist_function("rocksdb_.*")
                .allowlist_function("oxrocksdb_.*")
                .allowlist_type("rocksdb_.*")
                .allowlist_type("oxrocksdb_.*")
                .allowlist_var("rocksdb_.*")
                .generate()
                .unwrap()
                .write_to_file(PathBuf::from(var("OUT_DIR").unwrap()).join("bindings.rs"))
                .unwrap();
        }

        fn build_rocksdb_api(includes: &[PathBuf]) {
            let target = var("TARGET").unwrap();
            let mut config = cc::Build::new();
            for include in includes {
                config.include(include);
            }
            if target.contains("msvc") {
                config.flag("-EHsc").flag("-std:c++20");
            } else {
                config.flag("-std=c++20");
            }
            if target.contains("armv5te") || target.contains("riscv64gc") {
                println!("cargo:rustc-link-lib=atomic");
            }
            config.cpp(true).file("api/c.cc").compile("oxrocksdb_api");
        }

        #[cfg(not(feature = "pkg-config"))]
        fn build_rocksdb() {
            let target = var("TARGET").unwrap();

            let mut config = cc::Build::new();
            config
                .cpp(true)
                .include("rocksdb/include/")
                .include("rocksdb/")
                .file("api/build_version.cc")
                .define("NDEBUG", Some("1"))
                .define("LZ4", Some("1"))
                .include("lz4/lib/");

            let mut lib_sources = include_str!("rocksdb/src.mk")
                .split_once("LIB_SOURCES =")
                .unwrap()
                .1
                .split_once("ifeq")
                .unwrap()
                .0
                .split('\\')
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>();

            if target.contains("x86_64") {
                let target_feature = var("CARGO_CFG_TARGET_FEATURE").unwrap();
                let target_features: Vec<_> = target_feature.split(',').collect();
                if target_features.contains(&"sse2") {
                    config.flag_if_supported("-msse2");
                }
                if target_features.contains(&"sse4.1") {
                    config.flag_if_supported("-msse4.1");
                }
                if target_features.contains(&"sse4.2") {
                    config.flag_if_supported("-msse4.2");
                    config.define("HAVE_SSE42", Some("1"));
                }
                if target_features.contains(&"pclmulqdq") && !target.contains("android") {
                    config.define("HAVE_PCLMUL", Some("1"));
                    config.flag_if_supported("-mpclmul");
                }
                if target_features.contains(&"avx2") {
                    config.define("HAVE_AVX2", Some("1"));
                    config.flag_if_supported("-mavx2");
                }
                if target_features.contains(&"bmi1") {
                    config.define("HAVE_BMI", Some("1"));
                    config.flag_if_supported("-mbmi");
                }
                if target_features.contains(&"lzcnt") {
                    config.define("HAVE_LZCNT", Some("1"));
                    config.flag_if_supported("-mlzcnt");
                }
            }

            if target.contains("apple-ios") {
                config.define("OS_MACOSX", None);
                config.define("IOS_CROSS_COMPILE", None);
                config.define("PLATFORM", "IOS");
                config.define("NIOSTATS_CONTEXT", None);
                config.define("NPERF_CONTEXT", None);
                config.define("ROCKSDB_PLATFORM_POSIX", None);
                config.define("ROCKSDB_LIB_IO_POSIX", None);
                unsafe { remove_var("SDKROOT") };
                unsafe { set_var("IPHONEOS_DEPLOYMENT_TARGET", "11.0") };
            } else if target.contains("darwin") {
                config.define("OS_MACOSX", None);
                config.define("ROCKSDB_PLATFORM_POSIX", None);
                config.define("ROCKSDB_LIB_IO_POSIX", None);
                unsafe { remove_var("SDKROOT") };
            } else if target.contains("android") {
                config.define("OS_ANDROID", None);
                config.define("ROCKSDB_PLATFORM_POSIX", None);
                config.define("ROCKSDB_LIB_IO_POSIX", None);
            } else if target.contains("linux") {
                config.define("OS_LINUX", None);
                config.define("ROCKSDB_PLATFORM_POSIX", None);
                config.define("ROCKSDB_LIB_IO_POSIX", None);
            } else if target.contains("freebsd") {
                config.define("OS_FREEBSD", None);
                config.define("ROCKSDB_PLATFORM_POSIX", None);
                config.define("ROCKSDB_LIB_IO_POSIX", None);
            } else if target.contains("windows") {
                link("rpcrt4", false);
                link("shlwapi", false);
                config.define("DWIN32", None);
                config.define("OS_WIN", None);
                config.define("_MBCS", None);
                config.define("WIN64", None);
                config.define("NOMINMAX", None);
                config.define("ROCKSDB_WINDOWS_UTF8_FILENAMES", None);

                if target.contains("pc-windows-gnu") {
                    config.define("_POSIX_C_SOURCE", Some("1"));
                    config.define("_WIN32_WINNT", Some("_WIN32_WINNT_VISTA"));
                }

                lib_sources = lib_sources
                    .iter()
                    .copied()
                    .filter(|file| {
                        !matches!(
                            *file,
                            "port/port_posix.cc"
                                | "env/env_posix.cc"
                                | "env/fs_posix.cc"
                                | "env/io_posix.cc"
                        )
                    })
                    .collect::<Vec<&'static str>>();

                lib_sources.extend([
                    "port/win/env_default.cc",
                    "port/win/port_win.cc",
                    "port/win/xpress_win.cc",
                    "port/win/io_win.cc",
                    "port/win/win_thread.cc",
                    "port/win/env_win.cc",
                    "port/win/win_logger.cc",
                ]);
            }

            config.define("ROCKSDB_SUPPORT_THREAD_LOCAL", None);

            if target.contains("msvc") {
                config.flag("-EHsc").flag("-std:c++20");
            } else {
                config.flag("-std=c++20").flag("-Wno-invalid-offsetof");
                if target.contains("x86_64") || target.contains("aarch64") {
                    config.define("HAVE_UINT128_EXTENSION", Some("1"));
                }
            }

            for file in lib_sources {
                if file != "util/build_version.cc" {
                    config.file(format!("rocksdb/{file}"));
                }
            }

            config.compile("rocksdb");
        }

        #[cfg(not(feature = "pkg-config"))]
        fn build_lz4() {
            let mut config = cc::Build::new();
            config
                .file("lz4/lib/lz4.c")
                .file("lz4/lib/lz4frame.c")
                .file("lz4/lib/lz4hc.c")
                .file("lz4/lib/xxhash.c");
            if var("TARGET").unwrap() == "i686-pc-windows-gnu" {
                config.flag("-fno-tree-vectorize");
            }
            config.compile("lz4");
        }
    "#
}

fn top_level_function_matches_reviewed_source(
    tokens: &[RustToken],
    reviewed_source: &str,
    name: &str,
) -> bool {
    let reviewed_tokens = rust_tokens(reviewed_source);
    let actual = top_level_named_items(tokens, "fn", name);
    let reviewed = top_level_named_items(&reviewed_tokens, "fn", name);
    let ([actual], [reviewed]) = (actual.as_slice(), reviewed.as_slice()) else {
        return false;
    };
    let (Some(actual_depths), Some(reviewed_depths)) =
        (curly_depths(tokens), curly_depths(&reviewed_tokens))
    else {
        return false;
    };
    let actual_prefix = prefix_start(tokens, &actual_depths, actual.declaration, 0, 0);
    let reviewed_prefix = prefix_start(
        &reviewed_tokens,
        &reviewed_depths,
        reviewed.declaration,
        0,
        0,
    );
    tokens[actual_prefix..=actual.end] == reviewed_tokens[reviewed_prefix..=reviewed.end]
}

fn sys_build_support_matches_reviewed_source(tokens: &[RustToken]) -> bool {
    let Some(depths) = curly_depths(tokens) else {
        return false;
    };
    let emitter = top_level_named_items(tokens, "fn", "emit_rocksdb_build_metadata");
    let mains = top_level_named_items(tokens, "fn", "main");
    let ([emitter], [vendored, system]) = (emitter.as_slice(), mains.as_slice()) else {
        return false;
    };
    let mut retained = vec![true; tokens.len()];
    for item in [emitter, vendored, system] {
        let prefix = prefix_start(tokens, &depths, item.declaration, 0, 0);
        retained[prefix..=item.end].fill(false);
    }
    let actual = tokens
        .iter()
        .zip(retained)
        .filter_map(|(token, retained)| retained.then_some(token))
        .collect::<Vec<_>>();
    let reviewed = rust_tokens(reviewed_sys_build_helpers());
    actual
        .into_iter()
        .map(|token| token.0.as_str())
        .eq(reviewed.iter().map(|token| token.0.as_str()))
}

fn compile_and_run_build_script_fixture(
    source: &str,
    system_feature: bool,
) -> Result<std::process::Output, String> {
    let directory = TempDir::new()
        .map_err(|error| format!("failed to create build-script fixture directory: {error}"))?;
    let source_path = directory.path().join("fixture.rs");
    let executable_path = directory.path().join(if cfg!(windows) {
        "fixture.exe"
    } else {
        "fixture"
    });
    write(&source_path, source)
        .map_err(|error| format!("failed to write build-script fixture: {error}"))?;
    let mut compiler = Command::new(
        std::env::var_os("RUSTC").unwrap_or_else(|| std::ffi::OsString::from("rustc")),
    );
    compiler
        .arg("--edition=2024")
        .arg(&source_path)
        .arg("-o")
        .arg(&executable_path);
    if system_feature {
        compiler.arg("--cfg").arg("feature=\"pkg-config\"");
    }
    let compilation = compiler
        .output()
        .map_err(|error| format!("failed to run rustc for hostile fixture: {error}"))?;
    if !compilation.status.success() {
        return Err(format!(
            "hostile fixture must be compiler-valid: {}",
            String::from_utf8_lossy(&compilation.stderr),
        ));
    }
    let execution = Command::new(executable_path)
        .output()
        .map_err(|error| format!("failed to run compiled hostile fixture: {error}"))?;
    if !execution.status.success() {
        return Err(format!(
            "compiled hostile fixture must run: {}",
            String::from_utf8_lossy(&execution.stderr),
        ));
    }
    Ok(execution)
}

fn compilable_build_script_fixture(extra: &str, vendored_main: &str, system_main: &str) -> String {
    [
        extra,
        r#"
            extern crate self as pkg_config;

            struct Config;
            struct Library {
                version: String,
                include_paths: Vec<()>,
            }

            impl Config {
                fn new() -> Self { Self }
                fn atleast_version(self, _version: &str) -> Self { self }
                fn probe(self, _name: &str) -> Result<Library, ()> {
                    Ok(Library {
                        version: "11.8.1".to_owned(),
                        include_paths: Vec::new(),
                    })
                }
            }

            fn emit_rocksdb_build_metadata(
                build_kind: &str,
                rocksdb_version: &str,
                source_revision: ::core::option::Option<&str>,
            ) {
                ::std::println!("cargo::metadata=build_kind={build_kind}");
                ::std::println!("cargo::metadata=version={rocksdb_version}");
                if let ::core::option::Option::Some(source_revision) = source_revision {
                    ::std::println!("cargo::metadata=source_revision={source_revision}");
                }
            }

            fn build_lz4() { ::std::println!("fixture-build-lz4"); }
            fn build_rocksdb() { ::std::println!("fixture-build-rocksdb"); }
            fn build_rocksdb_api<T>(_includes: &[T]) {
                ::std::println!("fixture-build-rocksdb-api");
            }
            fn bindgen_rocksdb_api<T>(_includes: &[T]) {
                ::std::println!("fixture-bindgen-rocksdb-api");
            }
        "#,
        vendored_main,
        system_main,
    ]
    .join("\n")
}

fn compilable_qualified_vendored_main() -> &'static str {
    r#"
        #[cfg(not(feature = "pkg-config"))]
        fn main() {
            crate::emit_rocksdb_build_metadata(
                "vendored",
                "11.1.2",
                ::core::option::Option::Some("3b446089141659fad25328c5ea3e7ed283df46e4"),
            );
            let includes = [::std::path::Path::new("rocksdb/include").to_path_buf()];
            crate::build_lz4();
            crate::build_rocksdb();
            crate::build_rocksdb_api(&includes);
            crate::bindgen_rocksdb_api(&includes);
        }
    "#
}

fn compilable_qualified_system_main() -> &'static str {
    r#"
        #[cfg(feature = "pkg-config")]
        fn main() {
            let library = ::pkg_config::Config::new()
                .atleast_version("9.10.0")
                .probe("rocksdb")
                .unwrap();
            ::core::assert!(
                !library.version.is_empty(),
                "pkg-config returned an empty RocksDB version"
            );
            crate::emit_rocksdb_build_metadata("system", &library.version, ::core::option::Option::None);
            crate::build_rocksdb_api(&library.include_paths);
            crate::bindgen_rocksdb_api(&library.include_paths);
        }
    "#
}

fn sys_build_metadata_failures(source: &str) -> Vec<&'static str> {
    let tokens = rust_tokens(source);
    let mut failures = Vec::new();
    for helper in [
        "build_lz4",
        "build_rocksdb",
        "build_rocksdb_api",
        "bindgen_rocksdb_api",
    ] {
        if !top_level_function_matches_reviewed_source(
            &tokens,
            reviewed_sys_build_helpers(),
            helper,
        ) {
            failures.push("reviewed build helper identity and body");
        }
    }
    if !sys_build_support_matches_reviewed_source(&tokens) {
        failures.push("reviewed build support projection");
    }
    let helper = unique_unconditional_function_body(&tokens, "emit_rocksdb_build_metadata");
    if !unique_unconditional_function_has_exact_prefix_and_header(
        &tokens,
        "emit_rocksdb_build_metadata",
        &[
            "fn",
            "emit_rocksdb_build_metadata",
            "(",
            "build_kind",
            ":",
            "&",
            "str",
            ",",
            "rocksdb_version",
            ":",
            "&",
            "str",
            ",",
            "source_revision",
            ":",
            ":",
            ":",
            "core",
            ":",
            ":",
            "option",
            ":",
            ":",
            "Option",
            "<",
            "&",
            "str",
            ">",
            ",",
            ")",
        ],
    ) || helper.is_none_or(|body| {
        !exact_token_sequence(
            body,
            &[
                "{",
                ":",
                ":",
                "std",
                ":",
                ":",
                "println",
                "!",
                "(",
                "\"cargo::metadata=build_kind={build_kind}\"",
                ")",
                ";",
                ":",
                ":",
                "std",
                ":",
                ":",
                "println",
                "!",
                "(",
                "\"cargo::metadata=version={rocksdb_version}\"",
                ")",
                ";",
                "if",
                "let",
                ":",
                ":",
                "core",
                ":",
                ":",
                "option",
                ":",
                ":",
                "Option",
                ":",
                ":",
                "Some",
                "(",
                "source_revision",
                ")",
                "=",
                "source_revision",
                "{",
                ":",
                ":",
                "std",
                ":",
                ":",
                "println",
                "!",
                "(",
                "\"cargo::metadata=source_revision={source_revision}\"",
                ")",
                ";",
                "}",
                "}",
            ],
        )
    }) {
        failures.push("dependency metadata emitter");
    }
    for literal in [
        "\"cargo::metadata=build_kind={build_kind}\"",
        "\"cargo::metadata=version={rocksdb_version}\"",
        "\"cargo::metadata=source_revision={source_revision}\"",
    ] {
        if token_sequence_count(&tokens, &[literal]) != 1 {
            failures.push("unique dependency metadata output");
        }
    }

    let mains = top_level_named_items(&tokens, "fn", "main");
    let vendored = top_level_function_with_exact_attribute(
        &tokens,
        "main",
        &[
            "#",
            "[",
            "cfg",
            "(",
            "not",
            "(",
            "feature",
            "=",
            "\"pkg-config\"",
            ")",
            ")",
            "]",
        ],
    );
    let system = top_level_function_with_exact_attribute(
        &tokens,
        "main",
        &[
            "#",
            "[",
            "cfg",
            "(",
            "feature",
            "=",
            "\"pkg-config\"",
            ")",
            "]",
        ],
    );
    if mains.len() != 2 || vendored.is_none() || system.is_none() {
        failures.push("exact dependency feature selection");
        return failures;
    }
    let vendored = vendored.and_then(|item| item.body_open.map(|open| &tokens[open..=item.end]));
    if vendored.is_none_or(|body| {
        !exact_token_sequence(
            body,
            &[
                "{",
                "crate",
                ":",
                ":",
                "emit_rocksdb_build_metadata",
                "(",
                "\"vendored\"",
                ",",
                "\"11.1.2\"",
                ",",
                ":",
                ":",
                "core",
                ":",
                ":",
                "option",
                ":",
                ":",
                "Option",
                ":",
                ":",
                "Some",
                "(",
                "\"3b446089141659fad25328c5ea3e7ed283df46e4\"",
                ")",
                ",",
                ")",
                ";",
                "let",
                "includes",
                "=",
                "[",
                ":",
                ":",
                "std",
                ":",
                ":",
                "path",
                ":",
                ":",
                "Path",
                ":",
                ":",
                "new",
                "(",
                "\"rocksdb/include\"",
                ")",
                ".",
                "to_path_buf",
                "(",
                ")",
                "]",
                ";",
                "crate",
                ":",
                ":",
                "build_lz4",
                "(",
                ")",
                ";",
                "crate",
                ":",
                ":",
                "build_rocksdb",
                "(",
                ")",
                ";",
                "crate",
                ":",
                ":",
                "build_rocksdb_api",
                "(",
                "&",
                "includes",
                ")",
                ";",
                "crate",
                ":",
                ":",
                "bindgen_rocksdb_api",
                "(",
                "&",
                "includes",
                ")",
                ";",
                "}",
            ],
        )
    }) {
        failures.push("exact vendored metadata and build selection");
    }
    if system.is_none() {
        failures.push("system feature main selection");
    }
    let system = system.and_then(|item| item.body_open.map(|open| &tokens[open..=item.end]));
    let exact_system_body = system.is_some_and(|body| {
        exact_token_sequence(
            body,
            &[
                "{",
                "let",
                "library",
                "=",
                ":",
                ":",
                "pkg_config",
                ":",
                ":",
                "Config",
                ":",
                ":",
                "new",
                "(",
                ")",
                ".",
                "atleast_version",
                "(",
                "\"9.10.0\"",
                ")",
                ".",
                "probe",
                "(",
                "\"rocksdb\"",
                ")",
                ".",
                "unwrap",
                "(",
                ")",
                ";",
                ":",
                ":",
                "core",
                ":",
                ":",
                "assert",
                "!",
                "(",
                "!",
                "library",
                ".",
                "version",
                ".",
                "is_empty",
                "(",
                ")",
                ",",
                "\"pkg-config returned an empty RocksDB version\"",
                ")",
                ";",
                "crate",
                ":",
                ":",
                "emit_rocksdb_build_metadata",
                "(",
                "\"system\"",
                ",",
                "&",
                "library",
                ".",
                "version",
                ",",
                ":",
                ":",
                "core",
                ":",
                ":",
                "option",
                ":",
                ":",
                "Option",
                ":",
                ":",
                "None",
                ")",
                ";",
                "crate",
                ":",
                ":",
                "build_rocksdb_api",
                "(",
                "&",
                "library",
                ".",
                "include_paths",
                ")",
                ";",
                "crate",
                ":",
                ":",
                "bindgen_rocksdb_api",
                "(",
                "&",
                "library",
                ".",
                "include_paths",
                ")",
                ";",
                "}",
            ],
        )
    });
    if !exact_system_body {
        failures.push("system pkg-config probe selection");
    }
    if !exact_system_body {
        failures.push("system pkg-config metadata selection");
    }
    if !exact_system_body {
        failures.push("system build tail selection");
    }
    failures
}

fn oxigraph_build_relay_failures(manifest: &str, build_script: Option<&str>) -> Vec<&'static str> {
    let mut failures = Vec::new();
    if manifest_package_build_script(manifest) != Some("build.rs") {
        failures.push("oxigraph build script declaration");
    }
    let Some(build_script) = build_script else {
        failures.push("oxigraph dependency metadata relay");
        return failures;
    };
    let tokens = rust_tokens(build_script);
    let Some(main) = unique_unconditional_function_body(&tokens, "main") else {
        failures.push("oxigraph dependency metadata relay");
        return failures;
    };
    if !unique_unconditional_function_has_header(&tokens, "main", &["fn", "main", "(", ")"]) {
        failures.push("oxigraph dependency metadata relay");
    }
    let exact_relay_body = exact_token_sequence(
        main,
        &[
            "{",
            "let",
            "build_kind",
            "=",
            ":",
            ":",
            "std",
            ":",
            ":",
            "env",
            ":",
            ":",
            "var",
            "(",
            "\"DEP_ROCKSDB_BUILD_KIND\"",
            ")",
            ".",
            "expect",
            "(",
            "\"oxrocksdb-sys must report its selected build kind\"",
            ")",
            ";",
            "let",
            "rocksdb_version",
            "=",
            ":",
            ":",
            "std",
            ":",
            ":",
            "env",
            ":",
            ":",
            "var",
            "(",
            "\"DEP_ROCKSDB_VERSION\"",
            ")",
            ".",
            "expect",
            "(",
            "\"oxrocksdb-sys must report its RocksDB version\"",
            ")",
            ";",
            "let",
            "source_revision",
            "=",
            ":",
            ":",
            "std",
            ":",
            ":",
            "env",
            ":",
            ":",
            "var",
            "(",
            "\"DEP_ROCKSDB_SOURCE_REVISION\"",
            ")",
            ".",
            "ok",
            "(",
            ")",
            ";",
            ":",
            ":",
            "std",
            ":",
            ":",
            "println",
            "!",
            "(",
            "\"cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}\"",
            ")",
            ";",
            ":",
            ":",
            "std",
            ":",
            ":",
            "println",
            "!",
            "(",
            "\"cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION={rocksdb_version}\"",
            ")",
            ";",
            "if",
            "let",
            "Some",
            "(",
            "source_revision",
            ")",
            "=",
            "source_revision",
            "{",
            ":",
            ":",
            "std",
            ":",
            ":",
            "println",
            "!",
            "(",
            "\"cargo::rustc-env=OXIGRAPH_ROCKSDB_SOURCE_REVISION={source_revision}\"",
            ")",
            ";",
            "}",
            "}",
        ],
    );
    if !exact_relay_body {
        failures.push("causal dependency metadata input");
    }
    for literal in [
        "\"cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}\"",
        "\"cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION={rocksdb_version}\"",
        "\"cargo::rustc-env=OXIGRAPH_ROCKSDB_SOURCE_REVISION={source_revision}\"",
    ] {
        if token_sequence_count(&tokens, &[literal]) != 1 {
            failures.push("unique oxigraph metadata output");
        }
    }
    if !exact_relay_body {
        failures.push("causal oxigraph metadata output");
    }
    failures
}

fn wrapper_build_selection_failures(source: &str) -> Vec<&'static str> {
    let tokens = rust_tokens(source);
    let mut failures = Vec::new();
    let Some(selector) = unique_unconditional_function_body(&tokens, "rocksdb_maintenance_build")
    else {
        failures.push("unique build metadata selector");
        return failures;
    };
    if !unique_unconditional_function_has_header(
        &tokens,
        "rocksdb_maintenance_build",
        &[
            "fn",
            "rocksdb_maintenance_build",
            "(",
            ")",
            "-",
            ">",
            "RocksDbMaintenanceBuild",
        ],
    ) {
        failures.push("unique build metadata selector");
    }
    if !exact_token_sequence(
        selector,
        &[
            "{",
            "match",
            "(",
            ":",
            ":",
            "core",
            ":",
            ":",
            "option_env",
            "!",
            "(",
            "\"OXIGRAPH_ROCKSDB_BUILD_KIND\"",
            ")",
            ",",
            ":",
            ":",
            "core",
            ":",
            ":",
            "option_env",
            "!",
            "(",
            "\"OXIGRAPH_ROCKSDB_VERSION\"",
            ")",
            ",",
            ":",
            ":",
            "core",
            ":",
            ":",
            "option_env",
            "!",
            "(",
            "\"OXIGRAPH_ROCKSDB_SOURCE_REVISION\"",
            ")",
            ",",
            ")",
            "{",
            "(",
            "Some",
            "(",
            "\"vendored\"",
            ")",
            ",",
            "Some",
            "(",
            "rocksdb_version",
            ")",
            ",",
            "Some",
            "(",
            "source_revision",
            ")",
            ")",
            "=",
            ">",
            "{",
            "RocksDbMaintenanceBuild",
            ":",
            ":",
            "Vendored",
            "{",
            "rocksdb_version",
            ",",
            "source_revision",
            ",",
            "}",
            "}",
            "(",
            "Some",
            "(",
            "\"system\"",
            ")",
            ",",
            "Some",
            "(",
            "rocksdb_version",
            ")",
            ",",
            "None",
            ")",
            "if",
            "!",
            "rocksdb_version",
            ".",
            "is_empty",
            "(",
            ")",
            "=",
            ">",
            "{",
            "RocksDbMaintenanceBuild",
            ":",
            ":",
            "System",
            "{",
            "rocksdb_version",
            ":",
            "rocksdb_version",
            ".",
            "to_owned",
            "(",
            ")",
            ",",
            "}",
            "}",
            "_",
            "=",
            ">",
            ":",
            ":",
            "core",
            ":",
            ":",
            "unreachable",
            "!",
            "(",
            ")",
            ",",
            "}",
            "}",
        ],
    ) {
        failures.push("direct unshadowed wrapper metadata selection");
    }
    for literal in [
        "\"OXIGRAPH_ROCKSDB_BUILD_KIND\"",
        "\"OXIGRAPH_ROCKSDB_VERSION\"",
        "\"OXIGRAPH_ROCKSDB_SOURCE_REVISION\"",
    ] {
        if token_sequence_count(&tokens, &[literal]) != 1
            || token_sequence_count(
                selector,
                &[
                    ":",
                    ":",
                    "core",
                    ":",
                    ":",
                    "option_env",
                    "!",
                    "(",
                    literal,
                    ")",
                ],
            ) != 1
        {
            failures.push("causal wrapper metadata input");
        }
    }
    if !has_tokens(
        selector,
        &[
            "Some",
            "(",
            "\"vendored\"",
            ")",
            ",",
            "Some",
            "(",
            "rocksdb_version",
            ")",
            ",",
            "Some",
            "(",
            "source_revision",
            ")",
        ],
    ) || !has_tokens(
        selector,
        &[
            "RocksDbMaintenanceBuild",
            ":",
            ":",
            "Vendored",
            "{",
            "rocksdb_version",
            ",",
            "source_revision",
            ",",
            "}",
        ],
    ) {
        failures.push("vendored metadata construction");
    }
    if !has_tokens(
        selector,
        &[
            "Some",
            "(",
            "\"system\"",
            ")",
            ",",
            "Some",
            "(",
            "rocksdb_version",
            ")",
            ",",
            "None",
        ],
    ) || !has_tokens(
        selector,
        &["if", "!", "rocksdb_version", ".", "is_empty", "(", ")"],
    ) || !has_tokens(
        selector,
        &[
            "RocksDbMaintenanceBuild",
            ":",
            ":",
            "System",
            "{",
            "rocksdb_version",
            ":",
            "rocksdb_version",
            ".",
            "to_owned",
            "(",
            ")",
            ",",
            "}",
        ],
    ) {
        failures.push("system metadata construction");
    }
    if has_tokens(selector, &["cfg", "!"])
        || has_tokens(selector, &["\"11.1.2\""])
        || has_tokens(selector, &["\"3b446089141659fad25328c5ea3e7ed283df46e4\""])
    {
        failures.push("noncausal wrapper build hardcode");
    }
    let collector = unique_unconditional_method_body(&tokens, "Db", "maintenance_evidence");
    if collector.is_none_or(|body| {
        !returned_top_level_struct_field_is_direct_call(
            body,
            "RocksDbMaintenanceEvidence",
            "build",
            "rocksdb_maintenance_build",
        ) || token_value_count(body, "rocksdb_maintenance_build") != 1
    }) {
        failures.push("collector build identity linkage");
    }
    failures
}

fn repository_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
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
    failures.extend(wrapper_build_selection_failures(source));
    failures
}

fn valid_sys_build_metadata_fixture() -> String {
    format!(
        "{}\n{}",
        reviewed_sys_build_helpers(),
        r#"
        fn emit_rocksdb_build_metadata(
            build_kind: &str,
            rocksdb_version: &str,
            source_revision: ::core::option::Option<&str>,
        ) {
            ::std::println!("cargo::metadata=build_kind={build_kind}");
            ::std::println!("cargo::metadata=version={rocksdb_version}");
            if let ::core::option::Option::Some(source_revision) = source_revision {
                ::std::println!("cargo::metadata=source_revision={source_revision}");
            }
        }

        #[cfg(not(feature = "pkg-config"))]
        fn main() {
            crate::emit_rocksdb_build_metadata(
                "vendored",
                "11.1.2",
                ::core::option::Option::Some("3b446089141659fad25328c5ea3e7ed283df46e4"),
            );
            let includes = [::std::path::Path::new("rocksdb/include").to_path_buf()];
            crate::build_lz4();
            crate::build_rocksdb();
            crate::build_rocksdb_api(&includes);
            crate::bindgen_rocksdb_api(&includes);
        }

        #[cfg(feature = "pkg-config")]
        fn main() {
            let library = ::pkg_config::Config::new()
                .atleast_version("9.10.0")
                .probe("rocksdb")
                .unwrap();
            ::core::assert!(
                !library.version.is_empty(),
                "pkg-config returned an empty RocksDB version"
            );
            crate::emit_rocksdb_build_metadata("system", &library.version, ::core::option::Option::None);
            crate::build_rocksdb_api(&library.include_paths);
            crate::bindgen_rocksdb_api(&library.include_paths);
        }
    "#,
    )
}

fn valid_oxigraph_build_relay_fixture() -> &'static str {
    r#"
        fn main() {
            let build_kind = ::std::env::var("DEP_ROCKSDB_BUILD_KIND")
                .expect("oxrocksdb-sys must report its selected build kind");
            let rocksdb_version = ::std::env::var("DEP_ROCKSDB_VERSION")
                .expect("oxrocksdb-sys must report its RocksDB version");
            let source_revision = ::std::env::var("DEP_ROCKSDB_SOURCE_REVISION").ok();
            ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}");
            ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION={rocksdb_version}");
            if let Some(source_revision) = source_revision {
                ::std::println!(
                    "cargo::rustc-env=OXIGRAPH_ROCKSDB_SOURCE_REVISION={source_revision}"
                );
            }
        }
    "#
}

fn valid_wrapper_build_selection_fixture() -> &'static str {
    r#"
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
                (Some("system"), Some(rocksdb_version), None)
                    if !rocksdb_version.is_empty() =>
                {
                    RocksDbMaintenanceBuild::System {
                        rocksdb_version: rocksdb_version.to_owned(),
                    }
                }
                _ => ::core::unreachable!(),
            }
        }

        impl Db {
            fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence {
                RocksDbMaintenanceEvidence {
                    build: rocksdb_maintenance_build(),
                }
            }
        }
    "#
}

#[test]
fn build_metadata_relay_is_causally_declared_across_the_dependency_boundary() {
    let sys_build = read_to_string(repository_path("oxrocksdb-sys/build.rs"))
        .expect("the oxrocksdb-sys build script must be readable");
    let oxigraph_manifest = read_to_string(repository_path("lib/oxigraph/Cargo.toml"))
        .expect("the oxigraph manifest must be readable");
    let oxigraph_build_path = repository_path("lib/oxigraph/build.rs");
    let oxigraph_build = read_to_string(&oxigraph_build_path).ok();

    let mut failures = sys_build_metadata_failures(&sys_build);
    failures.extend(oxigraph_build_relay_failures(
        &oxigraph_manifest,
        oxigraph_build.as_deref(),
    ));
    failures.extend(wrapper_build_selection_failures(include_str!(
        "rocksdb_wrapper.rs"
    )));
    assert!(
        failures.is_empty(),
        "RED: the selected RocksDB build identity is not causally relayed into maintenance evidence: {failures:?}",
    );
}

#[test]
fn build_identity_contract_rejects_hardcodes_empty_versions_revision_leaks_and_decoys() {
    let valid_sys = valid_sys_build_metadata_fixture();
    let valid_relay = valid_oxigraph_build_relay_fixture();
    let valid_wrapper = valid_wrapper_build_selection_fixture();
    let valid_sys_failures = sys_build_metadata_failures(&valid_sys);
    assert!(
        valid_sys_failures.is_empty(),
        "valid dependency fixture: {valid_sys_failures:?}",
    );
    let compilable_sync_emitter = compilable_build_script_fixture(
        "",
        compilable_qualified_vendored_main(),
        compilable_qualified_system_main(),
    );
    let async_emitter = compilable_sync_emitter.replacen(
        "            fn emit_rocksdb_build_metadata(",
        "            async fn emit_rocksdb_build_metadata(",
        1,
    );
    assert_ne!(
        async_emitter, compilable_sync_emitter,
        "async-emitter mutant must be live"
    );
    assert!(
        sys_build_metadata_failures(&async_emitter).contains(&"dependency metadata emitter"),
        "an async metadata emitter must not satisfy the synchronous build-script contract",
    );
    let async_emitter_execution = compile_and_run_build_script_fixture(&async_emitter, false)
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        !String::from_utf8_lossy(&async_emitter_execution.stdout).contains("cargo::metadata="),
        "the compiler-backed control must prove that an unawaited async emitter emits no metadata",
    );
    for hostile_emitter in [
        valid_sys.replacen(
            "        fn emit_rocksdb_build_metadata(",
            "        unsafe fn emit_rocksdb_build_metadata(",
            1,
        ),
        valid_sys.replacen(
            "        fn emit_rocksdb_build_metadata(",
            "        const fn emit_rocksdb_build_metadata(",
            1,
        ),
        valid_sys.replacen(
            "        fn emit_rocksdb_build_metadata(",
            "        extern \"C\" fn emit_rocksdb_build_metadata(",
            1,
        ),
        valid_sys.replacen(
            "        fn emit_rocksdb_build_metadata(",
            "        pub fn emit_rocksdb_build_metadata(",
            1,
        ),
        valid_sys.replacen(
            "        fn emit_rocksdb_build_metadata(",
            "        #[inline]\n        fn emit_rocksdb_build_metadata(",
            1,
        ),
    ] {
        assert_ne!(
            hostile_emitter, valid_sys,
            "metadata-emitter prefix mutant must be live",
        );
        assert!(
            sys_build_metadata_failures(&hostile_emitter).contains(&"dependency metadata emitter"),
            "the metadata emitter must retain its exact ordinary synchronous function prefix",
        );
    }
    let unqualified_none_system_main =
        compilable_qualified_system_main().replace("::core::option::Option::None", "None");
    let module_scope_none_shadow = compilable_build_script_fixture(
        r#"
            #[allow(non_upper_case_globals)]
            const None: ::core::option::Option<&str> =
                ::core::option::Option::Some("module-scope-revision-leak");
        "#,
        compilable_qualified_vendored_main(),
        &unqualified_none_system_main,
    );
    assert!(
        sys_build_metadata_failures(&module_scope_none_shadow)
            .contains(&"system pkg-config metadata selection"),
        "a module-scope None binding must not inject a system source revision",
    );
    let none_shadow_execution =
        compile_and_run_build_script_fixture(&module_scope_none_shadow, true)
            .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        String::from_utf8_lossy(&none_shadow_execution.stdout)
            .contains("cargo::metadata=source_revision=module-scope-revision-leak"),
        "the compiler-backed control must prove the unqualified None leak is live",
    );

    let unqualified_some_vendored_main = compilable_qualified_vendored_main().replace(
        "::core::option::Option::Some(\"3b446089141659fad25328c5ea3e7ed283df46e4\")",
        "Some(\"3b446089141659fad25328c5ea3e7ed283df46e4\")",
    );
    let module_scope_some_shadow = compilable_build_script_fixture(
        "
            #[allow(non_snake_case)]
            fn Some<T>(_value: T) -> ::core::option::Option<T> {
                ::core::option::Option::None
            }
        ",
        &unqualified_some_vendored_main,
        compilable_qualified_system_main(),
    );
    assert!(
        sys_build_metadata_failures(&module_scope_some_shadow)
            .contains(&"exact vendored metadata and build selection"),
        "a module-scope Some binding must not discard the vendored source revision",
    );
    let some_shadow_execution =
        compile_and_run_build_script_fixture(&module_scope_some_shadow, false)
            .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        !String::from_utf8_lossy(&some_shadow_execution.stdout)
            .contains("cargo::metadata=source_revision="),
        "the compiler-backed control must prove the unqualified Some redirection is live",
    );

    let unqualified_path_vendored_main =
        compilable_qualified_vendored_main().replace("::std::path::Path::new", "Path::new");
    let module_scope_path_shadow = compilable_build_script_fixture(
        r#"
            struct Path;
            struct RedirectedPath;
            impl Path {
                fn new(_path: &str) -> RedirectedPath {
                    ::std::println!("module-scope-path-redirection");
                    RedirectedPath
                }
            }
            impl RedirectedPath {
                fn to_path_buf(&self) -> Self { Self }
            }
        "#,
        &unqualified_path_vendored_main,
        compilable_qualified_system_main(),
    );
    assert!(
        sys_build_metadata_failures(&module_scope_path_shadow)
            .contains(&"exact vendored metadata and build selection"),
        "a module-scope Path binding must not redirect the vendored include root",
    );
    let path_shadow_execution =
        compile_and_run_build_script_fixture(&module_scope_path_shadow, false)
            .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        String::from_utf8_lossy(&path_shadow_execution.stdout)
            .contains("module-scope-path-redirection"),
        "the compiler-backed control must prove the unqualified Path redirection is live",
    );

    let replaced_helper = compilable_build_script_fixture(
        r#"
            fn renamed_reviewed_build_lz4() {
                ::std::println!("renamed-reviewed-build-lz4");
            }
        "#,
        compilable_qualified_vendored_main(),
        compilable_qualified_system_main(),
    );
    assert!(
        sys_build_metadata_failures(&replaced_helper)
            .contains(&"reviewed build helper identity and body"),
        "qualified main calls must remain bound to the reviewed helper identities and bodies",
    );
    let replaced_helper_execution = compile_and_run_build_script_fixture(&replaced_helper, false)
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        String::from_utf8_lossy(&replaced_helper_execution.stdout).contains("fixture-build-lz4"),
        "the compiler-backed control must prove replacement helpers can redirect exact main calls",
    );
    let valid_relay_failures =
        oxigraph_build_relay_failures("[package]\nbuild = \"build.rs\"", Some(valid_relay));
    assert!(
        valid_relay_failures.is_empty(),
        "valid relay fixture: {valid_relay_failures:?}",
    );
    let valid_wrapper_failures = wrapper_build_selection_failures(valid_wrapper);
    assert!(
        valid_wrapper_failures.is_empty(),
        "valid wrapper fixture: {valid_wrapper_failures:?}",
    );
    let direct_return_wrapper = valid_wrapper.replacen(
        "                RocksDbMaintenanceEvidence {\n                    build: rocksdb_maintenance_build(),\n                }",
        "                return RocksDbMaintenanceEvidence {\n                    build: rocksdb_maintenance_build(),\n                };",
        1,
    );
    assert_ne!(
        direct_return_wrapper, valid_wrapper,
        "direct-return wrapper control must be live",
    );
    let direct_return_failures = wrapper_build_selection_failures(&direct_return_wrapper);
    assert!(
        direct_return_failures.is_empty(),
        "valid direct-return wrapper fixture: {direct_return_failures:?}",
    );

    let empty_system_version = valid_sys.replace(
        "&library.version, ::core::option::Option::None",
        "\"\", ::core::option::Option::None",
    );
    assert!(
        sys_build_metadata_failures(&empty_system_version)
            .contains(&"system pkg-config metadata selection")
    );
    let system_revision_leak = valid_sys.replace(
        "&library.version, ::core::option::Option::None",
        "&library.version, ::core::option::Option::Some(\"3b446089141659fad25328c5ea3e7ed283df46e4\")",
    );
    assert!(
        sys_build_metadata_failures(&system_revision_leak)
            .contains(&"system pkg-config metadata selection")
    );
    let nested_sys_decoy = format!(
        "mod decoy {{ {valid_sys} }}\n#[cfg(not(feature = \"pkg-config\"))] fn main() {{}}\n#[cfg(feature = \"pkg-config\")] fn main() {{}}",
    );
    assert!(!sys_build_metadata_failures(&nested_sys_decoy).is_empty());
    let rebound_emitter = valid_sys.replacen(
        "        ) {\n            ::std::println!(\"cargo::metadata=build_kind={build_kind}\");",
        "        ) {\n            let build_kind = \"vendored\";\n            let rocksdb_version = \"11.1.2\";\n            let source_revision = ::core::option::Option::Some(\"3b446089141659fad25328c5ea3e7ed283df46e4\");\n            ::std::println!(\"cargo::metadata=build_kind={build_kind}\");",
        1,
    );
    assert_ne!(rebound_emitter, valid_sys, "emitter mutant must be live");
    assert!(
        sys_build_metadata_failures(&rebound_emitter).contains(&"dependency metadata emitter"),
        "metadata parameters must not be shadowed before output",
    );
    let macro_shadowed_emitter = format!(
        "macro_rules! println {{ ($($tokens:tt)*) => {{}} }}\n{}",
        valid_sys.replace("::std::println!", "println!"),
    );
    assert!(
        sys_build_metadata_failures(&macro_shadowed_emitter)
            .contains(&"dependency metadata emitter"),
        "a module-scope macro must not substitute for the standard metadata emitter",
    );
    let rebound_probe_result = valid_sys.replacen(
        "            crate::emit_rocksdb_build_metadata(\"system\", &library.version, ::core::option::Option::None);",
        "            let library = FakeLibrary { version: \"hardcoded\".to_owned() };\n            crate::emit_rocksdb_build_metadata(\"system\", &library.version, ::core::option::Option::None);",
        1,
    );
    assert_ne!(
        rebound_probe_result, valid_sys,
        "probe-result mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&rebound_probe_result)
            .contains(&"system pkg-config metadata selection"),
        "the relayed system version must come directly from the probe result",
    );
    let unchecked_system_version = valid_sys.replacen(
        "            ::core::assert!(\n                !library.version.is_empty(),\n                \"pkg-config returned an empty RocksDB version\"\n            );\n",
        "",
        1,
    );
    assert_ne!(
        unchecked_system_version, valid_sys,
        "unchecked system-version mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&unchecked_system_version)
            .contains(&"system pkg-config metadata selection"),
        "the probed system version must be rejected when empty before relay",
    );
    let deleted_vendored_build = valid_sys.replacen("            crate::build_lz4();\n", "", 1);
    assert_ne!(
        deleted_vendored_build, valid_sys,
        "vendored-build deletion mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&deleted_vendored_build)
            .contains(&"exact vendored metadata and build selection"),
        "the vendored main must retain its complete build tail",
    );
    let reordered_vendored_build = valid_sys.replacen(
        "            crate::build_lz4();\n            crate::build_rocksdb();",
        "            crate::build_rocksdb();\n            crate::build_lz4();",
        1,
    );
    assert_ne!(
        reordered_vendored_build, valid_sys,
        "vendored-build reorder mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&reordered_vendored_build)
            .contains(&"exact vendored metadata and build selection"),
        "the vendored build tail must preserve its dependency order",
    );
    let dead_vendored_build = valid_sys.replacen(
        "            crate::build_lz4();\n            crate::build_rocksdb();",
        "            if false {\n                crate::build_lz4();\n                crate::build_rocksdb();\n            }",
        1,
    );
    assert_ne!(
        dead_vendored_build, valid_sys,
        "dead vendored-build mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&dead_vendored_build)
            .contains(&"exact vendored metadata and build selection"),
        "dead build calls must not satisfy the vendored build tail",
    );
    let shadowed_vendored_build = valid_sys.replacen(
        "            crate::build_lz4();",
        "            let build_lz4 = || {};\n            build_lz4();",
        1,
    );
    assert_ne!(
        shadowed_vendored_build, valid_sys,
        "shadowed vendored-build mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&shadowed_vendored_build)
            .contains(&"exact vendored metadata and build selection"),
        "a shadowed build function must not satisfy the vendored build tail",
    );
    let alternate_main = format!("{valid_sys}\n#[cfg(any())] fn main() {{}}");
    assert!(
        sys_build_metadata_failures(&alternate_main)
            .contains(&"exact dependency feature selection"),
        "an alternate main must invalidate the exact two-main selection",
    );
    let metadata_after_return = valid_sys.replacen(
        "            crate::emit_rocksdb_build_metadata(\n                \"vendored\",",
        "            return;\n            crate::emit_rocksdb_build_metadata(\n                \"vendored\",",
        1,
    );
    assert_ne!(
        metadata_after_return, valid_sys,
        "metadata-after-return mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&metadata_after_return)
            .contains(&"exact vendored metadata and build selection"),
        "unreachable metadata must not bless the vendored build",
    );
    let vendored_cross_wiring = valid_sys.replacen(
        "            crate::build_rocksdb_api(&includes);",
        "            crate::build_rocksdb_api(&library.include_paths);",
        1,
    );
    assert_ne!(
        vendored_cross_wiring, valid_sys,
        "vendored cross-wiring mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&vendored_cross_wiring)
            .contains(&"exact vendored metadata and build selection"),
        "vendored shim compilation must use the vendored include set",
    );
    let system_cross_wiring = valid_sys.replacen(
        "            crate::build_rocksdb_api(&library.include_paths);",
        "            crate::build_rocksdb_api(&includes);",
        1,
    );
    assert_ne!(
        system_cross_wiring, valid_sys,
        "system cross-wiring mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&system_cross_wiring).contains(&"system build tail selection"),
        "system shim compilation must use the probed include paths",
    );
    let reordered_system_build = valid_sys.replacen(
        "            crate::emit_rocksdb_build_metadata(\"system\", &library.version, ::core::option::Option::None);\n            crate::build_rocksdb_api(&library.include_paths);",
        "            crate::build_rocksdb_api(&library.include_paths);\n            crate::emit_rocksdb_build_metadata(\"system\", &library.version, ::core::option::Option::None);",
        1,
    );
    assert_ne!(
        reordered_system_build, valid_sys,
        "system-build reorder mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&reordered_system_build)
            .contains(&"system build tail selection"),
        "the system build tail must retain probe, validation, relay, shim, and bindgen order",
    );
    let deleted_system_bindgen = valid_sys.replacen(
        "            crate::bindgen_rocksdb_api(&library.include_paths);\n",
        "",
        1,
    );
    assert_ne!(
        deleted_system_bindgen, valid_sys,
        "system-bindgen deletion mutant must be live",
    );
    assert!(
        sys_build_metadata_failures(&deleted_system_bindgen)
            .contains(&"system build tail selection"),
        "the system main must retain binding generation",
    );

    assert_eq!(
        manifest_package_build_script(
            "[package]\n# build = \"build.rs\"\ndescription = \"build = build.rs\""
        ),
        None,
    );
    let inactive_relay = valid_relay.replace("fn main()", "#[cfg(any())]\nfn main()");
    assert!(
        !oxigraph_build_relay_failures("[package]\nbuild = \"build.rs\"", Some(&inactive_relay),)
            .is_empty()
    );
    let rebound_relay = valid_relay.replacen(
        "            let source_revision = ::std::env::var(\"DEP_ROCKSDB_SOURCE_REVISION\").ok();",
        "            let source_revision = ::std::env::var(\"DEP_ROCKSDB_SOURCE_REVISION\").ok();\n            let build_kind = \"vendored\";\n            let rocksdb_version = \"11.1.2\";\n            let source_revision = Some(\"3b446089141659fad25328c5ea3e7ed283df46e4\");",
        1,
    );
    assert_ne!(rebound_relay, valid_relay, "relay mutant must be live");
    assert!(
        oxigraph_build_relay_failures("[package]\nbuild = \"build.rs\"", Some(&rebound_relay),)
            .contains(&"causal dependency metadata input"),
        "dependency metadata inputs must not be shadowed before relay output",
    );
    let macro_shadowed_relay = format!(
        "macro_rules! println {{ ($($tokens:tt)*) => {{}} }}\n{}",
        valid_relay.replace("::std::println!", "println!"),
    );
    assert!(
        oxigraph_build_relay_failures(
            "[package]\nbuild = \"build.rs\"",
            Some(&macro_shadowed_relay),
        )
        .contains(&"causal oxigraph metadata output"),
        "a module-scope macro must not substitute for the standard metadata relay",
    );

    let hardcoded_wrapper = r#"
        const KIND_DECOY: Option<&str> = option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND");
        const VERSION_DECOY: Option<&str> = option_env!("OXIGRAPH_ROCKSDB_VERSION");
        const REVISION_DECOY: Option<&str> = option_env!("OXIGRAPH_ROCKSDB_SOURCE_REVISION");
        fn rocksdb_maintenance_build() -> RocksDbMaintenanceBuild {
            let _ = (KIND_DECOY, VERSION_DECOY, REVISION_DECOY);
            RocksDbMaintenanceBuild::Vendored {
                rocksdb_version: "11.1.2",
                source_revision: "3b446089141659fad25328c5ea3e7ed283df46e4",
            }
        }
        impl Db {
            fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence {
                RocksDbMaintenanceEvidence { build: rocksdb_maintenance_build() }
            }
        }
    "#;
    assert!(!wrapper_build_selection_failures(hardcoded_wrapper).is_empty());
    let local_feature_only = r#"
        fn rocksdb_maintenance_build() -> RocksDbMaintenanceBuild {
            if cfg!(feature = "rocksdb-pkg-config") {
                RocksDbMaintenanceBuild::System { rocksdb_version: "system".to_owned() }
            } else {
                RocksDbMaintenanceBuild::Vendored {
                    rocksdb_version: "11.1.2",
                    source_revision: "3b446089141659fad25328c5ea3e7ed283df46e4",
                }
            }
        }
        impl Db {
            fn maintenance_evidence(&self) -> RocksDbMaintenanceEvidence {
                RocksDbMaintenanceEvidence { build: rocksdb_maintenance_build() }
            }
        }
    "#;
    assert!(!wrapper_build_selection_failures(local_feature_only).is_empty());
    let nested_wrapper_decoy = format!("mod decoy {{ {valid_wrapper} }}");
    assert!(!wrapper_build_selection_failures(&nested_wrapper_decoy).is_empty());
    let macro_shadowed_wrapper = format!(
        "macro_rules! option_env {{ ($name:literal) => {{ None }} }}\n{}",
        valid_wrapper.replace("::core::option_env!", "option_env!"),
    );
    assert!(
        wrapper_build_selection_failures(&macro_shadowed_wrapper)
            .contains(&"direct unshadowed wrapper metadata selection"),
        "a module-scope macro must not substitute for the built-in metadata selector",
    );
    let macro_shadowed_unreachable = format!(
        "macro_rules! unreachable {{ () => {{ RocksDbMaintenanceBuild::System {{ rocksdb_version: \"shadowed\".to_owned() }} }} }}\n{}",
        valid_wrapper.replace("::core::unreachable!", "unreachable!"),
    );
    assert!(
        wrapper_build_selection_failures(&macro_shadowed_unreachable)
            .contains(&"direct unshadowed wrapper metadata selection"),
        "a module-scope macro must not replace invalid-metadata rejection",
    );
    let rebound_vendored_arm = valid_wrapper.replacen(
        "                (Some(\"vendored\"), Some(rocksdb_version), Some(source_revision)) => {\n                    RocksDbMaintenanceBuild::Vendored {",
        "                (Some(\"vendored\"), Some(rocksdb_version), Some(source_revision)) => {\n                    let rocksdb_version = \"11.1.2\";\n                    let source_revision = \"3b446089141659fad25328c5ea3e7ed283df46e4\";\n                    RocksDbMaintenanceBuild::Vendored {",
        1,
    );
    assert_ne!(
        rebound_vendored_arm, valid_wrapper,
        "vendored-arm mutant must be live",
    );
    assert!(
        wrapper_build_selection_failures(&rebound_vendored_arm)
            .contains(&"direct unshadowed wrapper metadata selection"),
        "vendored match bindings must flow directly into the build identity",
    );
    let rebound_system_arm = valid_wrapper.replacen(
        "                {\n                    RocksDbMaintenanceBuild::System {",
        "                {\n                    let rocksdb_version = \"hardcoded\";\n                    RocksDbMaintenanceBuild::System {",
        1,
    );
    assert_ne!(
        rebound_system_arm, valid_wrapper,
        "system-arm mutant must be live",
    );
    assert!(
        wrapper_build_selection_failures(&rebound_system_arm)
            .contains(&"direct unshadowed wrapper metadata selection"),
        "system match bindings must flow directly into the build identity",
    );
    let shadowed_collector = valid_wrapper.replacen(
        "                RocksDbMaintenanceEvidence {\n                    build: rocksdb_maintenance_build(),",
        "                let rocksdb_maintenance_build = || RocksDbMaintenanceBuild::System { rocksdb_version: \"hardcoded\".to_owned() };\n                RocksDbMaintenanceEvidence {\n                    build: rocksdb_maintenance_build(),",
        1,
    );
    assert_ne!(
        shadowed_collector, valid_wrapper,
        "collector mutant must be live",
    );
    assert!(
        wrapper_build_selection_failures(&shadowed_collector)
            .contains(&"collector build identity linkage"),
        "the production collector must call the top-level selector directly",
    );
    let dead_branch_collector = valid_wrapper.replacen(
        "                RocksDbMaintenanceEvidence {\n                    build: rocksdb_maintenance_build(),\n                }",
        "                if false {\n                    let _ = RocksDbMaintenanceEvidence {\n                        build: rocksdb_maintenance_build(),\n                    };\n                }\n                RocksDbMaintenanceEvidence {\n                    build: RocksDbMaintenanceBuild::System {\n                        rocksdb_version: \"hardcoded\".to_owned(),\n                    },\n                }",
        1,
    );
    assert_ne!(
        dead_branch_collector, valid_wrapper,
        "dead-branch collector mutant must be live",
    );
    assert!(
        wrapper_build_selection_failures(&dead_branch_collector)
            .contains(&"collector build identity linkage"),
        "a sole selector call in a dead branch must not bless an alternate returned build",
    );

    expected_maintenance_build_from_relay(None, None, None).unwrap_err();
    assert_eq!(
        expected_maintenance_build_from_relay(
            Some("vendored"),
            Some(VENDORED_VERSION),
            Some(VENDORED_SOURCE_REVISION),
        ),
        Ok(ExpectedMaintenanceBuild::Vendored {
            rocksdb_version: VENDORED_VERSION,
            source_revision: VENDORED_SOURCE_REVISION,
        }),
    );
    assert_eq!(
        expected_maintenance_build_from_relay(Some("system"), Some("9.10.0"), None),
        Ok(ExpectedMaintenanceBuild::System {
            rocksdb_version: "9.10.0",
        }),
    );
    let fallback_system = MissingMaintenanceBuild::System {
        rocksdb_version: "9.10.0".to_owned(),
    };
    assert!(fallback_system.is_system());
    assert_eq!(fallback_system.rocksdb_version(), "9.10.0");
    assert_eq!(fallback_system.source_revision(), None);
    expected_maintenance_build_from_relay(
        Some("vendored"),
        Some("11.1.1"),
        Some(VENDORED_SOURCE_REVISION),
    )
    .unwrap_err();
    expected_maintenance_build_from_relay(Some("system"), Some(""), None).unwrap_err();
    expected_maintenance_build_from_relay(
        Some("system"),
        Some("9.10.0"),
        Some(VENDORED_SOURCE_REVISION),
    )
    .unwrap_err();
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
