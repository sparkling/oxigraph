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
use std::fmt::Write as _;
use std::fs::{read_to_string, write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr::NonNull;
use tempfile::TempDir;

const CONTRACT_SCHEMA_VERSION: u16 = 1;
const SYSTEM_9_10_0_TAG: &str = "v9.10.0";
const SYSTEM_9_10_0_VERSION: &str = "9.10.0";
const SYSTEM_9_10_0_TAG_OBJECT: &str = "c344e30e276b5359f1a0970a00395a0d70a2bf2b";
const VENDORED_VERSION: &str = "11.1.2";
const VENDORED_TAG: &str = "v11.1.2";
const VENDORED_TAG_OBJECT: &str = "9d94571e3091e14a0b428cab639c388971cb4fcb";
const VENDORED_SOURCE_REVISION: &str = "3b446089141659fad25328c5ea3e7ed283df46e4";
const SYSTEM_9_10_0_SOURCE_REVISION: &str = "ae8fb3e5000e46d8d4c9dbf3a36019c0aaceebff";
const SYSTEM_9_10_0_STATISTICS_HEADER_SHA256: &str =
    "30d32617d2aabae3d0530272904f095a5c469995a834eb540f86dc4f0dbe9c4a";
const VENDORED_STATISTICS_HEADER_SHA256: &str =
    "240568b035dc9b0f71d4d96829a83f37d5f2a0c734f8cca3a6a317ef567d6924";
const CANDIDATE_11_8_1_TAG: &str = "v11.8.1";
const CANDIDATE_11_8_1_VERSION: &str = "11.8.1";
const CANDIDATE_11_8_1_SOURCE_REVISION: &str = "abeebd9630f11bd08c28b7bd43c7bdfc62050654";
const CANDIDATE_11_8_1_STATISTICS_HEADER_SHA256: &str =
    "0df121e1d1daba03c38eee1cfa59790935f11101b13826849428bd90ad488ffb";
const TICKER_ABI_EVIDENCE_SCOPE: &str = "repository sources and frozen compiler fixtures only; not installed-system, runtime, qualification, promotion, or production evidence";
const EXTERNAL_ALIAS_FAKE_STD_SOURCE: &str = r#"
    pub mod prelude {
        pub mod rust_2024 {
            pub use ::std::prelude::rust_2024::*;
        }
    }
    pub use ::std::println;
    pub mod env {
        pub fn var_os(_name: &str) -> ::std::option::Option<::std::string::String> {
            ::std::option::Option::Some(::std::string::String::from("fabricated-feature"))
        }
        pub fn var(name: &str) -> ::std::result::Result<::std::string::String, ()> {
            ::std::result::Result::Ok(::std::string::String::from(match name {
                "DEP_ROCKSDB_BUILD_KIND" => "vendored",
                "DEP_ROCKSDB_VERSION" => "11.1.2",
                "DEP_ROCKSDB_SOURCE_REVISION" => {
                    "3b446089141659fad25328c5ea3e7ed283df46e4"
                }
                _ => "",
            }))
        }
    }
"#;
const EXTERNAL_ALIAS_FAKE_CORE_SOURCE: &str = "
    #![no_std]
    pub mod option {
        pub use ::core::option::*;
    }
    #[macro_export]
    macro_rules! panic {
        ($($tokens:tt)*) => {{}}
    }
";

const COMPACTION_PENDING: &str = "rocksdb.compaction-pending";
const PENDING_COMPACTION_BYTES: &str = "rocksdb.estimate-pending-compaction-bytes";
const BACKGROUND_ERRORS: &str = "rocksdb.background-errors";
const WRITES_STOPPED: &str = "rocksdb.is-write-stopped";
const DELAYED_WRITE_RATE: &str = "rocksdb.actual-delayed-write-rate";
const LIVE_SST_BYTES: &str = "rocksdb.live-sst-files-size";
const MEMTABLE_BYTES: &str = "rocksdb.size-all-mem-tables";
const TABLE_READER_BYTES: &str = "rocksdb.estimate-table-readers-mem";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MaintenanceTicker {
    UserBytesWritten,
    StallMicros,
    CompactionReadBytes,
    CompactionWriteBytes,
    FlushWriteBytes,
}

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

const STATISTICS_TICKERS: [MaintenanceTicker; 5] = [
    MaintenanceTicker::UserBytesWritten,
    MaintenanceTicker::StallMicros,
    MaintenanceTicker::CompactionReadBytes,
    MaintenanceTicker::CompactionWriteBytes,
    MaintenanceTicker::FlushWriteBytes,
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
        S: FnMut(MaintenanceTicker) -> Result<u64, StorageError>;
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
        S: FnMut(MaintenanceTicker) -> Result<u64, StorageError>,
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

const TICKERS_THROUGH_COMPACTION_CANCELLED: &str = "
  BLOCK_CACHE_MISS = 0,
  BLOCK_CACHE_HIT,
  BLOCK_CACHE_ADD,
  BLOCK_CACHE_ADD_FAILURES,
  BLOCK_CACHE_INDEX_MISS,
  BLOCK_CACHE_INDEX_HIT,
  BLOCK_CACHE_INDEX_ADD,
  BLOCK_CACHE_INDEX_BYTES_INSERT,
  BLOCK_CACHE_FILTER_MISS,
  BLOCK_CACHE_FILTER_HIT,
  BLOCK_CACHE_FILTER_ADD,
  BLOCK_CACHE_FILTER_BYTES_INSERT,
  BLOCK_CACHE_DATA_MISS,
  BLOCK_CACHE_DATA_HIT,
  BLOCK_CACHE_DATA_ADD,
  BLOCK_CACHE_DATA_BYTES_INSERT,
  BLOCK_CACHE_BYTES_READ,
  BLOCK_CACHE_BYTES_WRITE,
  BLOCK_CACHE_COMPRESSION_DICT_MISS,
  BLOCK_CACHE_COMPRESSION_DICT_HIT,
  BLOCK_CACHE_COMPRESSION_DICT_ADD,
  BLOCK_CACHE_COMPRESSION_DICT_BYTES_INSERT,
  BLOCK_CACHE_ADD_REDUNDANT,
  BLOCK_CACHE_INDEX_ADD_REDUNDANT,
  BLOCK_CACHE_FILTER_ADD_REDUNDANT,
  BLOCK_CACHE_DATA_ADD_REDUNDANT,
  BLOCK_CACHE_COMPRESSION_DICT_ADD_REDUNDANT,
  SECONDARY_CACHE_HITS,
  SECONDARY_CACHE_FILTER_HITS,
  SECONDARY_CACHE_INDEX_HITS,
  SECONDARY_CACHE_DATA_HITS,
  COMPRESSED_SECONDARY_CACHE_DUMMY_HITS,
  COMPRESSED_SECONDARY_CACHE_HITS,
  COMPRESSED_SECONDARY_CACHE_PROMOTIONS,
  COMPRESSED_SECONDARY_CACHE_PROMOTION_SKIPS,
  BLOOM_FILTER_USEFUL,
  BLOOM_FILTER_FULL_POSITIVE,
  BLOOM_FILTER_FULL_TRUE_POSITIVE,
  BLOOM_FILTER_PREFIX_CHECKED,
  BLOOM_FILTER_PREFIX_USEFUL,
  BLOOM_FILTER_PREFIX_TRUE_POSITIVE,
  PERSISTENT_CACHE_HIT,
  PERSISTENT_CACHE_MISS,
  SIM_BLOCK_CACHE_HIT,
  SIM_BLOCK_CACHE_MISS,
  MEMTABLE_HIT,
  MEMTABLE_MISS,
  GET_HIT_L0,
  GET_HIT_L1,
  GET_HIT_L2_AND_UP,
  COMPACTION_KEY_DROP_NEWER_ENTRY,
  COMPACTION_KEY_DROP_OBSOLETE,
  COMPACTION_KEY_DROP_RANGE_DEL,
  COMPACTION_KEY_DROP_USER,
  COMPACTION_RANGE_DEL_DROP_OBSOLETE,
  COMPACTION_OPTIMIZED_DEL_DROP_OBSOLETE,
  COMPACTION_CANCELLED,
";

const TICKERS_FROM_KEYS_THROUGH_WAL_BYTES: &str = "
  NUMBER_KEYS_WRITTEN,
  NUMBER_KEYS_READ,
  NUMBER_KEYS_UPDATED,
  BYTES_WRITTEN,
  BYTES_READ,
  NUMBER_DB_SEEK,
  NUMBER_DB_NEXT,
  NUMBER_DB_PREV,
  NUMBER_DB_SEEK_FOUND,
  NUMBER_DB_NEXT_FOUND,
  NUMBER_DB_PREV_FOUND,
  ITER_BYTES_READ,
  NUMBER_ITER_SKIP,
  NUMBER_OF_RESEEKS_IN_ITERATION,
  NO_ITERATOR_CREATED,
  NO_ITERATOR_DELETED,
  NO_FILE_OPENS,
  NO_FILE_ERRORS,
  STALL_MICROS,
  DB_MUTEX_WAIT_MICROS,
  NUMBER_MULTIGET_CALLS,
  NUMBER_MULTIGET_KEYS_READ,
  NUMBER_MULTIGET_BYTES_READ,
  NUMBER_MULTIGET_KEYS_FOUND,
  NUMBER_MERGE_FAILURES,
  GET_UPDATES_SINCE_CALLS,
  WAL_FILE_SYNCED,
  WAL_FILE_BYTES,
";

const TICKERS_WAL_PRECREATE_11_8_1: &str = "
  WAL_PRECREATE_HIT,
  WAL_PRECREATE_MISS,
  WAL_PRECREATE_WAITED,
  WAL_PRECREATE_WAIT_MICROS,
  WAL_PRECREATE_FAILED,
";

const TICKERS_MAINTENANCE_SUFFIX: &str = "
  WRITE_DONE_BY_SELF,
  WRITE_DONE_BY_OTHER,
  WRITE_WITH_WAL,
  COMPACT_READ_BYTES,
  COMPACT_WRITE_BYTES,
  FLUSH_WRITE_BYTES,
  COMPACT_READ_BYTES_MARKED,
";

const TICKER_API_HEADER_FIXTURE: &str = r#"
#pragma once
#include <stdint.h>
#ifndef ROCKSDB_LIBRARY_API
#define ROCKSDB_LIBRARY_API
#endif
#ifdef __cplusplus
extern "C" {
#endif
extern ROCKSDB_LIBRARY_API uint32_t oxrocksdb_ticker_user_bytes_written(void);
extern ROCKSDB_LIBRARY_API uint32_t oxrocksdb_ticker_stall_micros(void);
extern ROCKSDB_LIBRARY_API uint32_t oxrocksdb_ticker_compact_read_bytes(void);
extern ROCKSDB_LIBRARY_API uint32_t oxrocksdb_ticker_compact_write_bytes(void);
extern ROCKSDB_LIBRARY_API uint32_t oxrocksdb_ticker_flush_write_bytes(void);
#ifdef __cplusplus
}
#endif
"#;

fn frozen_statistics_header(
    includes_compaction_aborted: bool,
    includes_wal_precreate: bool,
) -> String {
    format!(
        "
#pragma once
#include <cstdint>
#ifndef ROCKSDB_NAMESPACE
#define ROCKSDB_NAMESPACE rocksdb
#endif
namespace ROCKSDB_NAMESPACE {{
enum Tickers : uint32_t {{
{prefix}{compaction_aborted}{middle}{wal_precreate}{suffix}}};
}}
",
        prefix = TICKERS_THROUGH_COMPACTION_CANCELLED,
        compaction_aborted = if includes_compaction_aborted {
            "  COMPACTION_ABORTED,\n"
        } else {
            ""
        },
        middle = TICKERS_FROM_KEYS_THROUGH_WAL_BYTES,
        wal_precreate = if includes_wal_precreate {
            TICKERS_WAL_PRECREATE_11_8_1
        } else {
            ""
        },
        suffix = TICKERS_MAINTENANCE_SUFFIX,
    )
}

fn frozen_9_10_0_statistics_header() -> String {
    frozen_statistics_header(false, false)
}

fn frozen_11_1_2_statistics_header() -> String {
    frozen_statistics_header(true, false)
}

fn frozen_11_8_1_statistics_header() -> String {
    frozen_statistics_header(true, true)
}

fn reviewed_ticker_abi_cpp() -> &'static str {
    r#"
#include "c.h"
#include <rocksdb/statistics.h>

extern "C" {
uint32_t oxrocksdb_ticker_user_bytes_written(void) {
  return static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::BYTES_WRITTEN);
}
uint32_t oxrocksdb_ticker_stall_micros(void) {
  return static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::STALL_MICROS);
}
uint32_t oxrocksdb_ticker_compact_read_bytes(void) {
  return static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::COMPACT_READ_BYTES);
}
uint32_t oxrocksdb_ticker_compact_write_bytes(void) {
  return static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::COMPACT_WRITE_BYTES);
}
uint32_t oxrocksdb_ticker_flush_write_bytes(void) {
  return static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::FLUSH_WRITE_BYTES);
}
}
"#
}

fn ticker_abi_assertion_main() -> &'static str {
    r#"
#include "c.h"
#include <cstdio>
#include <rocksdb/statistics.h>

int main() {
  if (oxrocksdb_ticker_user_bytes_written() !=
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::BYTES_WRITTEN) ||
      oxrocksdb_ticker_user_bytes_written() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::NUMBER_KEYS_UPDATED) ||
      oxrocksdb_ticker_user_bytes_written() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::BYTES_READ) ||
      oxrocksdb_ticker_stall_micros() !=
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::STALL_MICROS) ||
      oxrocksdb_ticker_stall_micros() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::NO_FILE_ERRORS) ||
      oxrocksdb_ticker_stall_micros() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::DB_MUTEX_WAIT_MICROS) ||
      oxrocksdb_ticker_compact_read_bytes() !=
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::COMPACT_READ_BYTES) ||
      oxrocksdb_ticker_compact_read_bytes() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::WRITE_WITH_WAL) ||
      oxrocksdb_ticker_compact_read_bytes() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::COMPACT_WRITE_BYTES) ||
      oxrocksdb_ticker_compact_write_bytes() !=
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::COMPACT_WRITE_BYTES) ||
      oxrocksdb_ticker_compact_write_bytes() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::COMPACT_READ_BYTES) ||
      oxrocksdb_ticker_compact_write_bytes() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::FLUSH_WRITE_BYTES) ||
      oxrocksdb_ticker_flush_write_bytes() !=
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::FLUSH_WRITE_BYTES) ||
      oxrocksdb_ticker_flush_write_bytes() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::COMPACT_WRITE_BYTES) ||
      oxrocksdb_ticker_flush_write_bytes() ==
          static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::COMPACT_READ_BYTES_MARKED)) {
    return 1;
  }
  std::printf("%u %u %u %u %u\n",
              oxrocksdb_ticker_user_bytes_written(),
              oxrocksdb_ticker_stall_micros(),
              oxrocksdb_ticker_compact_read_bytes(),
              oxrocksdb_ticker_compact_write_bytes(),
              oxrocksdb_ticker_flush_write_bytes());
}
"#
}

fn compile_ticker_abi_fixture(
    statistics_header: &str,
    implementation: &str,
) -> Result<std::process::Output, String> {
    let directory = TempDir::new()
        .map_err(|error| format!("failed to create ticker ABI fixture directory: {error}"))?;
    let include_directory = directory.path().join("include");
    let rocksdb_include_directory = include_directory.join("rocksdb");
    std::fs::create_dir_all(&rocksdb_include_directory)
        .map_err(|error| format!("failed to create ticker ABI include directory: {error}"))?;
    let api_header = directory.path().join("c.h");
    let statistics_header_path = rocksdb_include_directory.join("statistics.h");
    let implementation_path = directory.path().join("c.cc");
    let main_path = directory.path().join("main.cc");
    let executable_path = directory.path().join(if cfg!(windows) {
        "ticker-abi.exe"
    } else {
        "ticker-abi"
    });
    write(&api_header, TICKER_API_HEADER_FIXTURE)
        .map_err(|error| format!("failed to write ticker ABI C header: {error}"))?;
    write(&statistics_header_path, statistics_header)
        .map_err(|error| format!("failed to write frozen RocksDB statistics header: {error}"))?;
    write(&implementation_path, implementation)
        .map_err(|error| format!("failed to write ticker ABI implementation: {error}"))?;
    write(&main_path, ticker_abi_assertion_main())
        .map_err(|error| format!("failed to write ticker ABI assertion main: {error}"))?;

    let compiler = std::env::var_os("CXX").unwrap_or_else(|| std::ffi::OsString::from("c++"));
    let compilation = Command::new(&compiler)
        .arg("-std=c++20")
        .arg("-I")
        .arg(&include_directory)
        .arg("-I")
        .arg(directory.path())
        .arg(&implementation_path)
        .arg(&main_path)
        .arg("-o")
        .arg(&executable_path)
        .output()
        .map_err(|error| {
            format!(
                "C++ compiler {compiler:?} is unavailable for the required ticker ABI fixture: {error}"
            )
        })?;
    if !compilation.status.success() {
        return Err(format!(
            "ticker ABI fixture did not compile: {}",
            String::from_utf8_lossy(&compilation.stderr)
        ));
    }
    Command::new(&executable_path)
        .output()
        .map_err(|error| format!("failed to execute ticker ABI fixture: {error}"))
}

fn compile_cpp_syntax_fixture(source: &str) -> Result<std::process::Output, String> {
    let directory = TempDir::new()
        .map_err(|error| format!("failed to create C++ syntax fixture directory: {error}"))?;
    let source_path = directory.path().join("syntax.cc");
    write(&source_path, source)
        .map_err(|error| format!("failed to write C++ syntax fixture: {error}"))?;
    let compiler = std::env::var_os("CXX").unwrap_or_else(|| std::ffi::OsString::from("c++"));
    Command::new(&compiler)
        .arg("-std=c++20")
        .arg("-fsyntax-only")
        .arg(&source_path)
        .output()
        .map_err(|error| format!("failed to run C++ syntax fixture with {compiler:?}: {error}"))
}

fn resolved_ticker_values(
    statistics_header: &str,
    implementation: &str,
) -> Result<[u32; 5], String> {
    let output = compile_ticker_abi_fixture(statistics_header, implementation)?;
    if !output.status.success() {
        return Err(format!(
            "ticker ABI fixture selected an unnamed or adjacent entry (status {}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr),
        ));
    }
    let values = String::from_utf8(output.stdout)
        .map_err(|error| format!("ticker ABI fixture output was not UTF-8: {error}"))?
        .split_ascii_whitespace()
        .map(str::parse::<u32>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("ticker ABI fixture emitted a non-integer: {error}"))?;
    values
        .try_into()
        .map_err(|values: Vec<u32>| format!("ticker ABI fixture emitted {} values", values.len()))
}

#[expect(
    clippy::many_single_char_names,
    reason = "the eight SHA-256 working variables follow the standard algorithm notation"
)]
fn sha256_hex(input: &[u8]) -> String {
    const INITIAL: [u32; 8] = [
        0x6a09_e667,
        0xbb67_ae85,
        0x3c6e_f372,
        0xa54f_f53a,
        0x510e_527f,
        0x9b05_688c,
        0x1f83_d9ab,
        0x5be0_cd19,
    ];
    const ROUND: [u32; 64] = [
        0x428a_2f98,
        0x7137_4491,
        0xb5c0_fbcf,
        0xe9b5_dba5,
        0x3956_c25b,
        0x59f1_11f1,
        0x923f_82a4,
        0xab1c_5ed5,
        0xd807_aa98,
        0x1283_5b01,
        0x2431_85be,
        0x550c_7dc3,
        0x72be_5d74,
        0x80de_b1fe,
        0x9bdc_06a7,
        0xc19b_f174,
        0xe49b_69c1,
        0xefbe_4786,
        0x0fc1_9dc6,
        0x240c_a1cc,
        0x2de9_2c6f,
        0x4a74_84aa,
        0x5cb0_a9dc,
        0x76f9_88da,
        0x983e_5152,
        0xa831_c66d,
        0xb003_27c8,
        0xbf59_7fc7,
        0xc6e0_0bf3,
        0xd5a7_9147,
        0x06ca_6351,
        0x1429_2967,
        0x27b7_0a85,
        0x2e1b_2138,
        0x4d2c_6dfc,
        0x5338_0d13,
        0x650a_7354,
        0x766a_0abb,
        0x81c2_c92e,
        0x9272_2c85,
        0xa2bf_e8a1,
        0xa81a_664b,
        0xc24b_8b70,
        0xc76c_51a3,
        0xd192_e819,
        0xd699_0624,
        0xf40e_3585,
        0x106a_a070,
        0x19a4_c116,
        0x1e37_6c08,
        0x2748_774c,
        0x34b0_bcb5,
        0x391c_0cb3,
        0x4ed8_aa4a,
        0x5b9c_ca4f,
        0x682e_6ff3,
        0x748f_82ee,
        0x78a5_636f,
        0x84c8_7814,
        0x8cc7_0208,
        0x90be_fffa,
        0xa450_6ceb,
        0xbef9_a3f7,
        0xc671_78f2,
    ];

    let bit_length = u64::try_from(input.len())
        .unwrap_or_else(|_| panic!("ticker evidence input length does not fit u64"))
        .wrapping_mul(8);
    let mut padded = input.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_length.to_be_bytes());

    let mut state = INITIAL;
    for chunk in padded.chunks_exact(64) {
        let mut words = [0_u32; 64];
        for (word, bytes) in words[..16].iter_mut().zip(chunk.chunks_exact(4)) {
            *word = u32::from_be_bytes(
                bytes
                    .try_into()
                    .unwrap_or_else(|_| panic!("SHA-256 word must contain four bytes")),
            );
        }
        for index in 16..64 {
            let s0 = words[index - 15].rotate_right(7)
                ^ words[index - 15].rotate_right(18)
                ^ (words[index - 15] >> 3);
            let s1 = words[index - 2].rotate_right(17)
                ^ words[index - 2].rotate_right(19)
                ^ (words[index - 2] >> 10);
            words[index] = words[index - 16]
                .wrapping_add(s0)
                .wrapping_add(words[index - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for index in 0..64 {
            let sum1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ ((!e) & g);
            let temporary1 = h
                .wrapping_add(sum1)
                .wrapping_add(choice)
                .wrapping_add(ROUND[index])
                .wrapping_add(words[index]);
            let sum0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let temporary2 = sum0.wrapping_add(majority);
            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temporary1);
            d = c;
            c = b;
            b = a;
            a = temporary1.wrapping_add(temporary2);
        }
        for (slot, value) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *slot = slot.wrapping_add(value);
        }
    }

    let mut digest = String::with_capacity(64);
    for value in state {
        write!(&mut digest, "{value:08x}")
            .unwrap_or_else(|_| panic!("writing to a String must not fail"));
    }
    digest
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
fn frozen_rocksdb_headers_resolve_maintenance_tickers_by_cpp_name() {
    assert_eq!(SYSTEM_9_10_0_TAG, "v9.10.0");
    assert_eq!(SYSTEM_9_10_0_VERSION, "9.10.0");
    assert_eq!(
        SYSTEM_9_10_0_TAG_OBJECT,
        "c344e30e276b5359f1a0970a00395a0d70a2bf2b"
    );
    assert_eq!(
        SYSTEM_9_10_0_SOURCE_REVISION,
        "ae8fb3e5000e46d8d4c9dbf3a36019c0aaceebff"
    );
    assert_eq!(
        SYSTEM_9_10_0_STATISTICS_HEADER_SHA256,
        "30d32617d2aabae3d0530272904f095a5c469995a834eb540f86dc4f0dbe9c4a"
    );
    assert_eq!(
        VENDORED_STATISTICS_HEADER_SHA256,
        "240568b035dc9b0f71d4d96829a83f37d5f2a0c734f8cca3a6a317ef567d6924"
    );
    assert_eq!(VENDORED_TAG, "v11.1.2");
    assert_eq!(
        VENDORED_TAG_OBJECT,
        "9d94571e3091e14a0b428cab639c388971cb4fcb"
    );
    assert_eq!(CANDIDATE_11_8_1_TAG, "v11.8.1");
    assert_eq!(CANDIDATE_11_8_1_VERSION, "11.8.1");
    assert_eq!(
        CANDIDATE_11_8_1_SOURCE_REVISION,
        "abeebd9630f11bd08c28b7bd43c7bdfc62050654"
    );
    assert_eq!(
        CANDIDATE_11_8_1_STATISTICS_HEADER_SHA256,
        "0df121e1d1daba03c38eee1cfa59790935f11101b13826849428bd90ad488ffb"
    );
    assert_eq!(
        sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        "the self-contained digest oracle must agree with the SHA-256 standard vector",
    );
    assert_eq!(
        sha256_hex(include_bytes!(
            "../../../../oxrocksdb-sys/rocksdb/include/rocksdb/statistics.h"
        )),
        VENDORED_STATISTICS_HEADER_SHA256,
        "the checked-out vendored header must remain the frozen v11.1.2 header",
    );
    assert!(TICKER_ABI_EVIDENCE_SCOPE.starts_with("repository sources"));
    assert!(TICKER_ABI_EVIDENCE_SCOPE.contains("not installed-system"));
    for excluded_claim in ["runtime", "qualification", "promotion", "production"] {
        assert!(TICKER_ABI_EVIDENCE_SCOPE.contains(excluded_claim));
    }

    let system = frozen_9_10_0_statistics_header();
    let vendored = frozen_11_1_2_statistics_header();
    let candidate = frozen_11_8_1_statistics_header();
    let system_values = resolved_ticker_values(&system, reviewed_ticker_abi_cpp())
        .unwrap_or_else(|error| panic!("exact v9.10.0 header fixture: {error}"));
    let vendored_values = resolved_ticker_values(&vendored, reviewed_ticker_abi_cpp())
        .unwrap_or_else(|error| panic!("exact vendored v11.1.2 header fixture: {error}"));
    let candidate_values = resolved_ticker_values(&candidate, reviewed_ticker_abi_cpp())
        .unwrap_or_else(|error| panic!("exact candidate v11.8.1 header fixture: {error}"));

    assert!(
        system_values
            .iter()
            .zip(vendored_values)
            .all(|(system, vendored)| system != &vendored),
        "COMPACTION_ABORTED shifts every selected entry between v9.10.0 and v11.1.2",
    );
    assert_eq!(
        &vendored_values[..2],
        &candidate_values[..2],
        "the v11.8.1 WAL insertion is after the first two selected entries",
    );
    assert!(
        vendored_values[2..]
            .iter()
            .zip(&candidate_values[2..])
            .all(|(vendored, candidate)| vendored != candidate),
        "the v11.8.1 WAL insertion shifts all three compaction/flush entries",
    );

    for (named, adjacent) in [
        ("Tickers::BYTES_WRITTEN", "Tickers::NUMBER_KEYS_UPDATED"),
        ("Tickers::BYTES_WRITTEN", "Tickers::BYTES_READ"),
        ("Tickers::STALL_MICROS", "Tickers::NO_FILE_ERRORS"),
        ("Tickers::STALL_MICROS", "Tickers::DB_MUTEX_WAIT_MICROS"),
        ("Tickers::COMPACT_READ_BYTES", "Tickers::WRITE_WITH_WAL"),
        (
            "Tickers::COMPACT_READ_BYTES",
            "Tickers::COMPACT_WRITE_BYTES",
        ),
        (
            "Tickers::COMPACT_WRITE_BYTES",
            "Tickers::COMPACT_READ_BYTES",
        ),
        ("Tickers::COMPACT_WRITE_BYTES", "Tickers::FLUSH_WRITE_BYTES"),
        ("Tickers::FLUSH_WRITE_BYTES", "Tickers::COMPACT_WRITE_BYTES"),
        (
            "Tickers::FLUSH_WRITE_BYTES",
            "Tickers::COMPACT_READ_BYTES_MARKED",
        ),
    ] {
        let adjacent_mutant = reviewed_ticker_abi_cpp().replacen(named, adjacent, 1);
        assert_ne!(
            adjacent_mutant,
            reviewed_ticker_abi_cpp(),
            "adjacent-entry mutant must be live",
        );
        let output = compile_ticker_abi_fixture(&vendored, &adjacent_mutant)
            .unwrap_or_else(|error| panic!("adjacent-entry compiler control: {error}"));
        assert!(
            !output.status.success(),
            "the same-header assertion must reject {named} being replaced by {adjacent}",
        );
    }

    let stale_vendored_mapping = format!(
        r#"
#include "c.h"
extern "C" {{
uint32_t oxrocksdb_ticker_user_bytes_written(void) {{ return {}; }}
uint32_t oxrocksdb_ticker_stall_micros(void) {{ return {}; }}
uint32_t oxrocksdb_ticker_compact_read_bytes(void) {{ return {}; }}
uint32_t oxrocksdb_ticker_compact_write_bytes(void) {{ return {}; }}
uint32_t oxrocksdb_ticker_flush_write_bytes(void) {{ return {}; }}
}}
"#,
        vendored_values[0],
        vendored_values[1],
        vendored_values[2],
        vendored_values[3],
        vendored_values[4],
    );
    assert!(
        compile_ticker_abi_fixture(&vendored, &stale_vendored_mapping)
            .unwrap_or_else(|error| panic!("stale mapping vendored control: {error}"))
            .status
            .success(),
        "the hardcoded control must demonstrate why one frozen header can hide the defect",
    );
    for (label, header) in [("v9.10.0", &system), ("v11.8.1", &candidate)] {
        assert!(
            !compile_ticker_abi_fixture(header, &stale_vendored_mapping)
                .unwrap_or_else(|error| panic!("stale mapping {label} control: {error}"))
                .status
                .success(),
            "a mapping frozen to vendored v11.1.2 ordinals must fail against {label}",
        );
    }

    let inactive_named_active_generated = format!(
        r#"
#if 0
{}
#endif

#include "c.h"
#define OXROCKSDB_STATISTICS_HEADER <rocksdb/statistics.h>
#include OXROCKSDB_STATISTICS_HEADER
#define OXROCKSDB_TICKER_NAME_INNER(prefix, suffix) prefix ## suffix
#define OXROCKSDB_TICKER_NAME(prefix, suffix) \
  OXROCKSDB_TICKER_NAME_INNER(prefix, suffix)
#define OXROCKSDB_FIXED_TICKER(suffix, value) \
  extern "C" uint32_t \
  OXROCKSDB_TICKER_NAME(oxrocksdb_ticker_, suffix)(void) {{ return value; }}
OXROCKSDB_FIXED_TICKER(user_bytes_written, {})
OXROCKSDB_FIXED_TICKER(stall_micros, {})
OXROCKSDB_FIXED_TICKER(compact_read_bytes, {})
OXROCKSDB_FIXED_TICKER(compact_write_bytes, {})
OXROCKSDB_FIXED_TICKER(flush_write_bytes, {})
"#,
        reviewed_ticker_abi_cpp(),
        vendored_values[0],
        vendored_values[1],
        vendored_values[2],
        vendored_values[3],
        vendored_values[4],
    );
    assert!(
        compile_ticker_abi_fixture(&vendored, &inactive_named_active_generated)
            .unwrap_or_else(|error| panic!("inactive-name generated-ordinal control: {error}"))
            .status
            .success(),
        "the confirmed control must compile while only generated fixed-value definitions are active",
    );
    let generated_failures = ticker_cpp_implementation_failures(&inactive_named_active_generated);
    assert!(
        generated_failures.contains(&"conditional C++ preprocessor activity"),
        "inactive exact definitions must not establish active implementation provenance",
    );
    assert!(
        generated_failures.contains(&"protected C++ macro rebinding or generation")
            || generated_failures.contains(&"composed C++ resolver function name"),
        "macro-generated fixed-value resolver definitions must be rejected",
    );
    assert!(
        generated_failures.contains(&"redirected statistics header include"),
        "a macro-selected statistics header must not substitute for the exact direct include",
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
        // This C API smoke is bound to the checked-out vendored v11.1.2
        // primary surface above. Cross-version and system-header selection are
        // exercised independently by the compiler-backed ABI fixture.
        let frozen_header = frozen_11_1_2_statistics_header();
        let ticker_values = resolved_ticker_values(&frozen_header, reviewed_ticker_abi_cpp())
            .unwrap_or_else(|error| panic!("selected RocksDB ticker-name fixture: {error}"));
        // SAFETY: The live options own an enabled statistics collector. The
        // ticker value was compiled from the exact selected header's C++ name.
        assert!(
            unsafe {
                rocksdb_options_statistics_get_ticker_count(handler.options, ticker_values[0])
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

#[derive(Debug)]
struct TomlAssignment {
    path: Vec<String>,
    value: String,
}

#[derive(Debug, Default)]
struct TomlStructure {
    tables: Vec<Vec<String>>,
    assignments: Vec<TomlAssignment>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TomlMultilineString {
    Basic,
    Literal,
}

#[derive(Debug, Default)]
struct TomlValueContinuation {
    square_depth: usize,
    curly_depth: usize,
    multiline: Option<TomlMultilineString>,
}

impl TomlValueContinuation {
    fn is_active(&self) -> bool {
        self.multiline.is_some() || self.square_depth > 0 || self.curly_depth > 0
    }

    fn scan_line(&mut self, line: &str) {
        let bytes = line.as_bytes();
        let mut index = 0;
        while index < bytes.len() {
            match self.multiline {
                Some(TomlMultilineString::Basic) => {
                    if bytes[index..].starts_with(b"\"\"\"") {
                        let preceding_backslashes = bytes[..index]
                            .iter()
                            .rev()
                            .take_while(|byte| **byte == b'\\')
                            .count();
                        if preceding_backslashes % 2 == 0 {
                            self.multiline = None;
                            index += 3;
                            continue;
                        }
                    }
                    index += 1;
                }
                Some(TomlMultilineString::Literal) => {
                    if bytes[index..].starts_with(b"'''") {
                        self.multiline = None;
                        index += 3;
                    } else {
                        index += 1;
                    }
                }
                None => match bytes[index] {
                    b'#' => return,
                    b'"' if bytes[index..].starts_with(b"\"\"\"") => {
                        self.multiline = Some(TomlMultilineString::Basic);
                        index += 3;
                    }
                    b'\'' if bytes[index..].starts_with(b"'''") => {
                        self.multiline = Some(TomlMultilineString::Literal);
                        index += 3;
                    }
                    b'"' => {
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
                    }
                    b'\'' => {
                        index += 1;
                        while index < bytes.len() && bytes[index] != b'\'' {
                            index += 1;
                        }
                        index = (index + 1).min(bytes.len());
                    }
                    b'[' => {
                        self.square_depth += 1;
                        index += 1;
                    }
                    b']' => {
                        self.square_depth = self.square_depth.saturating_sub(1);
                        index += 1;
                    }
                    b'{' => {
                        self.curly_depth += 1;
                        index += 1;
                    }
                    b'}' => {
                        self.curly_depth = self.curly_depth.saturating_sub(1);
                        index += 1;
                    }
                    _ => index += 1,
                },
            }
        }
    }
}

fn decode_toml_basic_key(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut output = String::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'\\' {
            let character = input[index..].chars().next()?;
            output.push(character);
            index += character.len_utf8();
            continue;
        }
        index += 1;
        match *bytes.get(index)? {
            b'b' => output.push('\u{0008}'),
            b't' => output.push('\t'),
            b'n' => output.push('\n'),
            b'f' => output.push('\u{000c}'),
            b'r' => output.push('\r'),
            b'"' => output.push('"'),
            b'\\' => output.push('\\'),
            b'u' | b'U' => {
                let digits = if bytes[index] == b'u' { 4 } else { 8 };
                let start = index + 1;
                let end = start + digits;
                let value = u32::from_str_radix(input.get(start..end)?, 16).ok()?;
                output.push(char::from_u32(value)?);
                index = end;
                continue;
            }
            _ => return None,
        }
        index += 1;
    }
    Some(output)
}

fn parse_toml_key_path(input: &str) -> Option<Vec<String>> {
    let bytes = input.as_bytes();
    let mut segments = Vec::new();
    let mut index = 0;
    loop {
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        let segment = match *bytes.get(index)? {
            b'"' => {
                index += 1;
                let start = index;
                while index < bytes.len() {
                    match bytes[index] {
                        b'\\' => index = (index + 2).min(bytes.len()),
                        b'"' => break,
                        _ => index += 1,
                    }
                }
                let decoded = decode_toml_basic_key(input.get(start..index)?)?;
                index += 1;
                decoded
            }
            b'\'' => {
                index += 1;
                let start = index;
                while index < bytes.len() && bytes[index] != b'\'' {
                    index += 1;
                }
                let segment = input.get(start..index)?.to_owned();
                index += 1;
                segment
            }
            byte if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-') => {
                let start = index;
                while bytes
                    .get(index)
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
                {
                    index += 1;
                }
                input.get(start..index)?.to_owned()
            }
            _ => return None,
        };
        segments.push(segment);
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        match bytes.get(index) {
            None => return Some(segments),
            Some(b'.') => index += 1,
            _ => return None,
        }
    }
}

fn toml_unquoted_equals(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'#' => return None,
            b'=' => return Some(index),
            b'"' => {
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
            }
            b'\'' => {
                index += 1;
                while index < bytes.len() && bytes[index] != b'\'' {
                    index += 1;
                }
                index = (index + 1).min(bytes.len());
            }
            _ => index += 1,
        }
    }
    None
}

fn toml_table_key(line: &str) -> Option<Vec<String>> {
    let line = line.trim_start();
    if !line.starts_with('[') || line.starts_with("[[") {
        return None;
    }
    let bytes = line.as_bytes();
    let mut index = 1;
    while index < bytes.len() {
        match bytes[index] {
            b']' => return parse_toml_key_path(line.get(1..index)?.trim()),
            b'"' => {
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
            }
            b'\'' => {
                index += 1;
                while index < bytes.len() && bytes[index] != b'\'' {
                    index += 1;
                }
                index = (index + 1).min(bytes.len());
            }
            _ => index += 1,
        }
    }
    None
}

fn parse_toml_structure(source: &str) -> TomlStructure {
    let mut structure = TomlStructure::default();
    let mut table = Vec::new();
    let mut continuation = TomlValueContinuation::default();
    for line in source.lines() {
        if continuation.is_active() {
            if let Some(assignment) = structure.assignments.last_mut() {
                assignment.value.push('\n');
                assignment.value.push_str(line);
            }
            continuation.scan_line(line);
            continue;
        }
        let line = line.trim_start();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(next_table) = toml_table_key(line) {
            structure.tables.push(next_table.clone());
            table = next_table;
            continue;
        }
        let Some(equals) = toml_unquoted_equals(line) else {
            continue;
        };
        let Some(key) = parse_toml_key_path(line[..equals].trim()) else {
            continue;
        };
        let mut path = table.clone();
        path.extend(key);
        let value = line[equals + 1..].to_owned();
        structure.assignments.push(TomlAssignment { path, value });
        continuation.scan_line(&line[equals + 1..]);
    }
    structure
}

fn toml_inline_table_paths(value: &str) -> Vec<Vec<String>> {
    fn append_entry_paths(mut entry: &str, paths: &mut Vec<Vec<String>>) {
        loop {
            entry = entry.trim_start();
            if !entry.starts_with('#') {
                break;
            }
            let Some(newline) = entry.find('\n') else {
                return;
            };
            entry = &entry[newline + 1..];
        }
        let Some(equals) = toml_unquoted_equals(entry) else {
            return;
        };
        let Some(key) = parse_toml_key_path(entry[..equals].trim()) else {
            return;
        };
        paths.push(key.clone());
        for child in toml_inline_table_paths(&entry[equals + 1..]) {
            let mut nested = key.clone();
            nested.extend(child);
            paths.push(nested);
        }
    }

    let value = value.trim_start();
    if !value.starts_with('{') {
        return Vec::new();
    }
    let bytes = value.as_bytes();
    let mut paths = Vec::new();
    let mut index = 1;
    let mut entry_start = index;
    let mut curly_depth = 1_usize;
    let mut square_depth = 0_usize;
    let mut multiline = None;
    while index < bytes.len() {
        match multiline {
            Some(TomlMultilineString::Basic) => {
                if bytes[index..].starts_with(b"\"\"\"") {
                    let preceding_backslashes = bytes[..index]
                        .iter()
                        .rev()
                        .take_while(|byte| **byte == b'\\')
                        .count();
                    if preceding_backslashes % 2 == 0 {
                        multiline = None;
                        index += 3;
                        continue;
                    }
                }
                index += 1;
                continue;
            }
            Some(TomlMultilineString::Literal) => {
                if bytes[index..].starts_with(b"'''") {
                    multiline = None;
                    index += 3;
                } else {
                    index += 1;
                }
                continue;
            }
            None => {}
        }
        match bytes[index] {
            b'#' => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
                continue;
            }
            b'"' if bytes[index..].starts_with(b"\"\"\"") => {
                multiline = Some(TomlMultilineString::Basic);
                index += 3;
                continue;
            }
            b'\'' if bytes[index..].starts_with(b"'''") => {
                multiline = Some(TomlMultilineString::Literal);
                index += 3;
                continue;
            }
            b'"' => {
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
                continue;
            }
            b'\'' => {
                index += 1;
                while index < bytes.len() && bytes[index] != b'\'' {
                    index += 1;
                }
                index = (index + 1).min(bytes.len());
                continue;
            }
            b'{' => curly_depth += 1,
            b'}' => {
                curly_depth = curly_depth.saturating_sub(1);
                if curly_depth == 0 {
                    append_entry_paths(&value[entry_start..index], &mut paths);
                    break;
                }
            }
            b'[' => square_depth += 1,
            b']' => square_depth = square_depth.saturating_sub(1),
            b',' if curly_depth == 1 && square_depth == 0 => {
                append_entry_paths(&value[entry_start..index], &mut paths);
                entry_start = index + 1;
            }
            _ => {}
        }
        index += 1;
    }
    paths
}

fn toml_assignment_paths(assignment: &TomlAssignment) -> Vec<Vec<String>> {
    let mut paths = vec![assignment.path.clone()];
    for inline_path in toml_inline_table_paths(&assignment.value) {
        let mut path = assignment.path.clone();
        path.extend(inline_path);
        paths.push(path);
    }
    paths
}

fn toml_basic_or_literal_string(value: &str) -> Option<String> {
    let value = value.trim_start();
    let quote = *value.as_bytes().first()?;
    if !matches!(quote, b'"' | b'\'') {
        return None;
    }
    let bytes = value.as_bytes();
    let mut index = 1;
    while index < bytes.len() {
        match bytes[index] {
            b'\\' if quote == b'"' => index = (index + 2).min(bytes.len()),
            byte if byte == quote => {
                let decoded = if quote == b'"' {
                    decode_toml_basic_key(value.get(1..index)?)?
                } else {
                    value.get(1..index)?.to_owned()
                };
                let remainder = value.get(index + 1..)?.trim_start();
                if remainder.is_empty() || remainder.starts_with('#') {
                    return Some(decoded);
                }
                return None;
            }
            _ => index += 1,
        }
    }
    None
}

fn manifest_package_build_script(manifest: &str) -> Option<String> {
    let matches = parse_toml_structure(manifest)
        .assignments
        .into_iter()
        .filter(|assignment| assignment.path == ["package", "build"])
        .collect::<Vec<_>>();
    let [assignment] = matches.as_slice() else {
        return None;
    };
    toml_basic_or_literal_string(&assignment.value)
}

fn path_declares_build_dependency_alias(path: &[String], alias: &str) -> bool {
    if path
        .first()
        .is_some_and(|segment| segment == "build-dependencies")
    {
        return path.get(1).is_some_and(|segment| segment == alias);
    }
    if path.first().is_some_and(|segment| segment == "target") {
        return path
            .iter()
            .position(|segment| segment == "build-dependencies")
            .and_then(|index| path.get(index + 1))
            .is_some_and(|segment| segment == alias);
    }
    false
}

fn manifest_declares_build_dependency_alias(manifest: &str, alias: &str) -> bool {
    let structure = parse_toml_structure(manifest);
    structure
        .tables
        .iter()
        .any(|path| path_declares_build_dependency_alias(path, alias))
        || structure
            .assignments
            .iter()
            .flat_map(toml_assignment_paths)
            .any(|path| path_declares_build_dependency_alias(&path, alias))
}

fn workspace_manifest_declares_dependency_alias(manifest: &str, alias: &str) -> bool {
    let structure = parse_toml_structure(manifest);
    let declares = |path: &[String]| {
        path.first().is_some_and(|segment| segment == "workspace")
            && path.get(1).is_some_and(|segment| segment == "dependencies")
            && path.get(2).is_some_and(|segment| segment == alias)
    };
    structure.tables.iter().any(|path| declares(path))
        || structure
            .assignments
            .iter()
            .flat_map(toml_assignment_paths)
            .any(|path| declares(&path))
}

fn cargo_config_overrides_rocksdb_build_script(config: &str) -> bool {
    let structure = parse_toml_structure(config);
    let overrides = |path: &[String]| {
        matches!(path, [key] if key == "include")
            || matches!(
                path,
                [scope, target, links, ..]
                    if scope == "target"
                        && links == "rocksdb"
                        // Cargo 1.98 only supports links overrides under a target
                        // triple. A matching cfg() sub-table is reported as unused
                        // and does not suppress the dependency build script.
                        && !(target.starts_with("cfg(") && target.ends_with(')'))
            )
    };
    structure.tables.iter().any(|path| overrides(path))
        || structure
            .assignments
            .iter()
            .flat_map(toml_assignment_paths)
            .any(|path| overrides(&path))
}

fn cargo_config_controls_compiler(config: &str) -> bool {
    let structure = parse_toml_structure(config);
    let controls = |path: &[String]| {
        matches!(
            path,
            [scope, key]
                if scope == "build"
                    && matches!(
                        key.as_str(),
                        "rustflags" | "rustc" | "rustc-wrapper" | "rustc-workspace-wrapper"
                    )
        ) || matches!(path, [key] if key == "include")
            || matches!(path, [scope, key] if scope == "host" && key == "rustflags")
            || matches!(
                path,
                [scope, _, key]
                    if (scope == "target"
                        && matches!(key.as_str(), "rustflags" | "linker"))
                        || (scope == "host" && key == "rustflags")
            )
            || matches!(path, [scope, _, key] if scope == "profile" && key == "rustflags")
            || matches!(
                path,
                [scope, key, ..]
                    if scope == "env"
                        && [
                            "RUSTFLAGS",
                            "CARGO_ENCODED_RUSTFLAGS",
                            "RUSTC",
                            "RUSTC_WRAPPER",
                            "RUSTC_WORKSPACE_WRAPPER",
                        ]
                        .iter()
                        .any(|compiler_variable| key.eq_ignore_ascii_case(compiler_variable))
            )
    };
    structure.tables.iter().any(|path| controls(path))
        || structure
            .assignments
            .iter()
            .flat_map(toml_assignment_paths)
            .any(|path| controls(&path))
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

fn compile_and_execute_oxigraph_build_relay_fixture(
    source: &str,
    environment: &[(&str, &str)],
) -> Result<std::process::Output, String> {
    let directory = TempDir::new()
        .map_err(|error| format!("failed to create relay fixture directory: {error}"))?;
    let source_path = directory.path().join("fixture.rs");
    let executable_path = directory.path().join(if cfg!(windows) {
        "fixture.exe"
    } else {
        "fixture"
    });
    write(&source_path, source)
        .map_err(|error| format!("failed to write relay fixture: {error}"))?;
    let compilation = Command::new(
        std::env::var_os("RUSTC").unwrap_or_else(|| std::ffi::OsString::from("rustc")),
    )
    .arg("--edition=2024")
    .arg(&source_path)
    .arg("-o")
    .arg(&executable_path)
    .output()
    .map_err(|error| format!("failed to run rustc for relay fixture: {error}"))?;
    if !compilation.status.success() {
        return Err(format!(
            "relay fixture must be compiler-valid: {}",
            String::from_utf8_lossy(&compilation.stderr),
        ));
    }
    let mut command = Command::new(executable_path);
    for key in [
        "CARGO_FEATURE_ROCKSDB",
        "DEP_ROCKSDB_BUILD_KIND",
        "DEP_ROCKSDB_VERSION",
        "DEP_ROCKSDB_SOURCE_REVISION",
    ] {
        command.env_remove(key);
    }
    command.envs(environment.iter().copied());
    command
        .output()
        .map_err(|error| format!("failed to run compiled relay fixture: {error}"))
}

struct CargoLinksOverrideExecution {
    baseline: std::process::Output,
    baseline_ran_dependency_build_script: bool,
    overridden: std::process::Output,
    override_ran_dependency_build_script: bool,
    invalid_linker: std::process::Output,
    invalid_linker_ran_dependency_build_script: bool,
}

fn execute_cargo_links_override_fixture(
    relay: &str,
) -> Result<CargoLinksOverrideExecution, String> {
    let directory = TempDir::new()
        .map_err(|error| format!("failed to create Cargo links fixture directory: {error}"))?;
    let root = directory.path();
    let backend = root.join("backend");
    let cargo_config = root.join(".cargo");
    for path in [root.join("src"), backend.join("src"), cargo_config.clone()] {
        std::fs::create_dir_all(&path)
            .map_err(|error| format!("failed to create Cargo links fixture path: {error}"))?;
    }
    write(
        root.join("Cargo.toml"),
        r#"[package]
name = "relay-consumer"
version = "0.1.0"
edition = "2024"
build = "build.rs"

[dependencies]
fixture-backend = { path = "backend" }

[features]
default = ["rocksdb"]
rocksdb = []

[workspace]
"#,
    )
    .map_err(|error| format!("failed to write Cargo links fixture manifest: {error}"))?;
    write(root.join("build.rs"), relay)
        .map_err(|error| format!("failed to write Cargo links relay: {error}"))?;
    write(
        root.join("src/lib.rs"),
        r#"pub const BUILD_KIND: &str = env!("OXIGRAPH_ROCKSDB_BUILD_KIND");
pub const VERSION: &str = env!("OXIGRAPH_ROCKSDB_VERSION");
pub const SOURCE_REVISION: &str = env!("OXIGRAPH_ROCKSDB_SOURCE_REVISION");
"#,
    )
    .map_err(|error| format!("failed to write Cargo links consumer source: {error}"))?;
    write(
        backend.join("Cargo.toml"),
        r#"[package]
name = "fixture-backend"
version = "0.1.0"
edition = "2024"
links = "rocksdb"
build = "build.rs"
"#,
    )
    .map_err(|error| format!("failed to write Cargo links backend manifest: {error}"))?;
    write(
        backend.join("build.rs"),
        r#"fn main() {
    std::fs::write(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("build-script-ran"),
        b"ran",
    )
    .unwrap();
    panic!("fixture dependency build script executed");
}
"#,
    )
    .map_err(|error| format!("failed to write Cargo links backend build script: {error}"))?;
    write(backend.join("src/lib.rs"), "pub fn fixture() {}\n")
        .map_err(|error| format!("failed to write Cargo links backend source: {error}"))?;

    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| std::ffi::OsString::from("rustc"));
    let rustc_version = Command::new(&rustc)
        .arg("-vV")
        .output()
        .map_err(|error| format!("failed to inspect fixture rustc host: {error}"))?;
    if !rustc_version.status.success() {
        return Err(format!(
            "fixture rustc host inspection failed: {}",
            String::from_utf8_lossy(&rustc_version.stderr),
        ));
    }
    let rustc_version = String::from_utf8_lossy(&rustc_version.stdout);
    let host = rustc_version
        .lines()
        .find_map(|line| line.strip_prefix("host: "))
        .ok_or_else(|| "fixture rustc did not report a host triple".to_owned())?;
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| std::ffi::OsString::from("cargo"));
    let cargo_home = root.join("cargo-home");
    std::fs::create_dir_all(&cargo_home)
        .map_err(|error| format!("failed to create isolated Cargo home: {error}"))?;
    let run_cargo = |target_dir: &Path| {
        let mut command = Command::new(&cargo);
        command
            .arg("check")
            .arg("--offline")
            .current_dir(root)
            .env("CARGO_HOME", &cargo_home)
            .env("CARGO_TARGET_DIR", target_dir);
        for key in [
            "CARGO_BUILD_RUSTC",
            "CARGO_BUILD_RUSTC_WRAPPER",
            "CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
            "CARGO_BUILD_RUSTFLAGS",
            "CARGO_BUILD_TARGET",
            "CARGO_ENCODED_RUSTFLAGS",
            "RUSTC_WRAPPER",
            "RUSTC_WORKSPACE_WRAPPER",
            "RUSTFLAGS",
        ] {
            command.env_remove(key);
        }
        command.output()
    };

    let marker = backend.join("build-script-ran");
    let baseline = run_cargo(&root.join("target-baseline"))
        .map_err(|error| format!("failed to run baseline Cargo links fixture: {error}"))?;
    let baseline_ran_dependency_build_script = marker.exists();
    if baseline_ran_dependency_build_script {
        std::fs::remove_file(&marker)
            .map_err(|error| format!("failed to reset Cargo links marker: {error}"))?;
    }
    let missing_runner = root.join("runner-must-not-run");
    let missing_linker = root.join("linker-must-not-run");
    let override_config = format!(
        "[target.'{host}']\nrunner = '{}'\n\n[target.'{host}'.rocksdb]\nbuild_kind = \"vendored\"\nversion = \"{VENDORED_VERSION}\"\nsource_revision = \"{VENDORED_SOURCE_REVISION}\"\n",
        missing_runner.display(),
    );
    write(cargo_config.join("config.toml"), &override_config)
        .map_err(|error| format!("failed to write Cargo links override: {error}"))?;
    let overridden = run_cargo(&root.join("target-override"))
        .map_err(|error| format!("failed to run Cargo links override fixture: {error}"))?;
    let override_ran_dependency_build_script = marker.exists();
    if override_ran_dependency_build_script {
        std::fs::remove_file(&marker)
            .map_err(|error| format!("failed to reset overridden Cargo links marker: {error}"))?;
    }

    let linker_config = format!(
        "[target.'{host}']\nlinker = '{}'\nrunner = '{}'\n\n[target.'{host}'.rocksdb]\nbuild_kind = \"vendored\"\nversion = \"{VENDORED_VERSION}\"\nsource_revision = \"{VENDORED_SOURCE_REVISION}\"\n",
        missing_linker.display(),
        missing_runner.display(),
    );
    write(cargo_config.join("config.toml"), linker_config)
        .map_err(|error| format!("failed to write Cargo linker fixture: {error}"))?;
    let invalid_linker = run_cargo(&root.join("target-linker"))
        .map_err(|error| format!("failed to run Cargo linker fixture: {error}"))?;
    let invalid_linker_ran_dependency_build_script = marker.exists();

    Ok(CargoLinksOverrideExecution {
        baseline,
        baseline_ran_dependency_build_script,
        overridden,
        override_ran_dependency_build_script,
        invalid_linker,
        invalid_linker_ran_dependency_build_script,
    })
}

fn compile_and_execute_oxigraph_build_relay_with_external_alias(
    source: &str,
    alias: &str,
    external_crate_name: &str,
    external_source: &str,
    environment: &[(&str, &str)],
) -> Result<std::process::Output, String> {
    let directory = TempDir::new()
        .map_err(|error| format!("failed to create external-alias fixture directory: {error}"))?;
    let external_source_path = directory.path().join("external.rs");
    let external_library_path = directory.path().join("libexternal.rlib");
    let relay_source_path = directory.path().join("relay.rs");
    let executable_path = directory
        .path()
        .join(if cfg!(windows) { "relay.exe" } else { "relay" });
    write(&external_source_path, external_source)
        .map_err(|error| format!("failed to write external-alias crate: {error}"))?;
    write(&relay_source_path, source)
        .map_err(|error| format!("failed to write external-alias relay: {error}"))?;
    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| std::ffi::OsString::from("rustc"));
    let external_compilation = Command::new(&rustc)
        .arg("--edition=2024")
        .arg("--crate-name")
        .arg(external_crate_name)
        .arg("--crate-type=rlib")
        .arg(&external_source_path)
        .arg("-o")
        .arg(&external_library_path)
        .output()
        .map_err(|error| format!("failed to compile external-alias crate: {error}"))?;
    if !external_compilation.status.success() {
        return Err(format!(
            "external-alias crate must be compiler-valid: {}",
            String::from_utf8_lossy(&external_compilation.stderr),
        ));
    }
    let relay_compilation = Command::new(rustc)
        .arg("--edition=2024")
        .arg("--extern")
        .arg(format!("{alias}={}", external_library_path.display()))
        .arg(&relay_source_path)
        .arg("-o")
        .arg(&executable_path)
        .output()
        .map_err(|error| format!("failed to compile external-alias relay: {error}"))?;
    if !relay_compilation.status.success() {
        return Err(format!(
            "external-alias relay must be compiler-valid: {}",
            String::from_utf8_lossy(&relay_compilation.stderr),
        ));
    }
    let mut command = Command::new(executable_path);
    for key in [
        "CARGO_FEATURE_ROCKSDB",
        "DEP_ROCKSDB_BUILD_KIND",
        "DEP_ROCKSDB_VERSION",
        "DEP_ROCKSDB_SOURCE_REVISION",
    ] {
        command.env_remove(key);
    }
    command.envs(environment.iter().copied());
    command
        .output()
        .map_err(|error| format!("failed to run external-alias relay: {error}"))
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

fn oxigraph_build_relay_source_failures(
    manifest: &str,
    build_script: Option<&str>,
) -> Vec<&'static str> {
    let mut failures = Vec::new();
    if manifest_package_build_script(manifest).as_deref() != Some("build.rs") {
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
    let no_rocksdb_gate = [
        "{",
        "if",
        ":",
        ":",
        "std",
        ":",
        ":",
        "env",
        ":",
        ":",
        "var_os",
        "(",
        "\"CARGO_FEATURE_ROCKSDB\"",
        ")",
        ".",
        "is_none",
        "(",
        ")",
        "{",
        "return",
        ";",
        "}",
    ];
    let exact_no_rocksdb_gate = main
        .get(..no_rocksdb_gate.len())
        .is_some_and(|prefix| exact_token_sequence(prefix, &no_rocksdb_gate));
    if !exact_no_rocksdb_gate {
        failures.push("exact no-RocksDB build relay gate");
    }
    let expected_relay_body = [
        "{",
        "if",
        ":",
        ":",
        "std",
        ":",
        ":",
        "env",
        ":",
        ":",
        "var_os",
        "(",
        "\"CARGO_FEATURE_ROCKSDB\"",
        ")",
        ".",
        "is_none",
        "(",
        ")",
        "{",
        "return",
        ";",
        "}",
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
        "match",
        "(",
        "build_kind",
        ".",
        "as_str",
        "(",
        ")",
        ",",
        "rocksdb_version",
        ".",
        "as_str",
        "(",
        ")",
        ",",
        "source_revision",
        ".",
        "as_deref",
        "(",
        ")",
        ",",
        ")",
        "{",
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
        ",",
        ")",
        ",",
        ")",
        "=",
        ">",
        "{",
        "}",
        "(",
        "\"system\"",
        ",",
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
        "if",
        "!",
        "version",
        ".",
        "is_empty",
        "(",
        ")",
        "=",
        ">",
        "{",
        "}",
        "_",
        "=",
        ">",
        ":",
        ":",
        "core",
        ":",
        ":",
        "panic",
        "!",
        "(",
        "\"oxrocksdb-sys reported invalid RocksDB build metadata\"",
        ")",
        ",",
        "}",
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
        "\"cargo::rustc-env=OXIGRAPH_ROCKSDB_SOURCE_REVISION={source_revision}\"",
        ")",
        ";",
        "}",
        "}",
    ];
    let exact_relay_body = exact_token_sequence(main, &expected_relay_body);
    let exact_relay_file = tokens
        .get(..4)
        .is_some_and(|header| exact_token_sequence(header, &["fn", "main", "(", ")"]))
        && tokens
            .get(4..)
            .is_some_and(|body| exact_token_sequence(body, &expected_relay_body));
    if !exact_relay_file {
        failures.push("exact oxigraph build relay file");
    }
    if !exact_relay_body {
        failures.push("causal dependency metadata input");
        failures.push("validated RocksDB build identity relay");
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

fn oxigraph_build_relay_failures_with_provenance(
    manifest: &str,
    workspace_manifest: &str,
    cargo_configs: &[&str],
    build_script: Option<&str>,
) -> Vec<&'static str> {
    // This is a repository-controlled provenance contract, not a toolchain attestation.
    // Operator-supplied RUSTFLAGS, RUSTC wrappers, and compiler binaries remain an
    // external release-environment boundary and must be attested outside this evaluator.
    let mut failures = oxigraph_build_relay_source_failures(manifest, build_script);
    let compiler_aliases = ["std", "core"];
    let manifest_alias = compiler_aliases
        .iter()
        .any(|alias| manifest_declares_build_dependency_alias(manifest, alias));
    if manifest_alias {
        failures.push("build-script compiler namespace provenance");
    }
    if compiler_aliases.iter().any(|alias| {
        manifest_declares_build_dependency_alias(manifest, alias)
            && workspace_manifest_declares_dependency_alias(workspace_manifest, alias)
    }) {
        failures.push("workspace-inherited build-script compiler namespace provenance");
    }
    if cargo_configs
        .iter()
        .any(|config| cargo_config_controls_compiler(config))
    {
        failures.push("repository-controlled compiler configuration provenance");
    }
    if cargo_configs
        .iter()
        .any(|config| cargo_config_overrides_rocksdb_build_script(config))
    {
        failures.push("repository-controlled RocksDB links override provenance");
    }
    failures
}

fn oxigraph_build_relay_failures(manifest: &str, build_script: Option<&str>) -> Vec<&'static str> {
    oxigraph_build_relay_failures_with_provenance(manifest, "", &[], build_script)
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

const TICKER_ABI_NAMES: [(&str, &str); 5] = [
    ("oxrocksdb_ticker_user_bytes_written", "BYTES_WRITTEN"),
    ("oxrocksdb_ticker_stall_micros", "STALL_MICROS"),
    ("oxrocksdb_ticker_compact_read_bytes", "COMPACT_READ_BYTES"),
    (
        "oxrocksdb_ticker_compact_write_bytes",
        "COMPACT_WRITE_BYTES",
    ),
    ("oxrocksdb_ticker_flush_write_bytes", "FLUSH_WRITE_BYTES"),
];

fn ticker_api_header_failures(source: &str) -> Vec<&'static str> {
    let tokens = rust_tokens(source);
    let mut failures = Vec::new();
    for (function_name, _) in TICKER_ABI_NAMES {
        let declaration = [
            "extern",
            "ROCKSDB_LIBRARY_API",
            "uint32_t",
            function_name,
            "(",
            "void",
            ")",
            ";",
        ];
        if token_sequence_count(&tokens, &declaration) != 1
            || token_value_count(&tokens, function_name) != 1
        {
            failures.push("unique exported ticker declaration");
        }
    }
    failures
}

struct CppLexicalVisibility {
    source: String,
    tokens: Vec<RustToken>,
}

fn is_cpp_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn cpp_literal_quote(bytes: &[u8], start: usize, prefixes: &[&[u8]]) -> Option<usize> {
    prefixes
        .iter()
        .find(|prefix| {
            (prefix.len() == 1 || start == 0 || !is_cpp_identifier_byte(bytes[start - 1]))
                && bytes[start..].starts_with(prefix)
        })
        .map(|prefix| start + prefix.len() - 1)
}

fn cpp_literal_suffix_end(bytes: &[u8], mut end: usize) -> usize {
    while bytes
        .get(end)
        .is_some_and(|byte| is_cpp_identifier_byte(*byte))
    {
        end += 1;
    }
    end
}

fn cpp_raw_literal_end(bytes: &[u8], start: usize) -> Option<usize> {
    let quote = cpp_literal_quote(bytes, start, &[b"u8R\"", b"uR\"", b"UR\"", b"LR\"", b"R\""])?;
    let delimiter_start = quote + 1;
    let mut opening_parenthesis = None;
    for (index, current) in bytes
        .iter()
        .enumerate()
        .take(bytes.len().min(delimiter_start + 17))
        .skip(delimiter_start)
    {
        match *current {
            b'(' => {
                opening_parenthesis = Some(index);
                break;
            }
            byte if byte.is_ascii_whitespace() || matches!(byte, b'\\' | b')' | b'\r' | b'\n') => {
                return None;
            }
            _ => {}
        }
    }
    let opening_parenthesis = opening_parenthesis?;
    let delimiter = &bytes[delimiter_start..opening_parenthesis];
    let content_start = opening_parenthesis + 1;
    for closing_parenthesis in content_start..bytes.len() {
        if bytes[closing_parenthesis] != b')' {
            continue;
        }
        let delimiter_end = closing_parenthesis + 1 + delimiter.len();
        if bytes.get(closing_parenthesis + 1..delimiter_end) == Some(delimiter)
            && bytes.get(delimiter_end) == Some(&b'"')
        {
            return Some(cpp_literal_suffix_end(bytes, delimiter_end + 1));
        }
    }
    Some(bytes.len())
}

fn cpp_ordinary_literal_end(bytes: &[u8], quote: usize) -> usize {
    let delimiter = bytes[quote];
    let mut index = quote + 1;
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            index = (index + 2).min(bytes.len());
        } else if bytes[index] == delimiter {
            return cpp_literal_suffix_end(bytes, index + 1);
        } else if matches!(bytes[index], b'\r' | b'\n') {
            return index;
        } else {
            index += 1;
        }
    }
    bytes.len()
}

fn blank_cpp_lexeme(visible: &mut [u8], start: usize, end: usize) {
    for byte in &mut visible[start..end] {
        if !matches!(*byte, b'\r' | b'\n') {
            *byte = b' ';
        }
    }
}

fn cpp_lexical_visibility(source: &str) -> CppLexicalVisibility {
    let spliced = source.replace("\\\r\n", "").replace("\\\n", "");
    let bytes = spliced.as_bytes();
    let mut visible = bytes.to_vec();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index..].starts_with(b"//") {
            let end = bytes[index..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(bytes.len(), |length| index + length);
            blank_cpp_lexeme(&mut visible, index, end);
            index = end;
            continue;
        }
        if bytes[index..].starts_with(b"/*") {
            let end = bytes[index + 2..]
                .windows(2)
                .position(|window| window == b"*/")
                .map_or(bytes.len(), |length| index + length + 4);
            blank_cpp_lexeme(&mut visible, index, end);
            index = end;
            continue;
        }
        if let Some(end) = cpp_raw_literal_end(bytes, index) {
            blank_cpp_lexeme(&mut visible, index, end);
            index = end;
            continue;
        }
        if let Some(quote) =
            cpp_literal_quote(bytes, index, &[b"u8\"", b"u\"", b"U\"", b"L\"", b"\""])
        {
            let end = cpp_ordinary_literal_end(bytes, quote);
            blank_cpp_lexeme(&mut visible, index, end);
            index = end;
            continue;
        }
        if let Some(quote) = cpp_literal_quote(bytes, index, &[b"u8'", b"u'", b"U'", b"L'", b"'"]) {
            let end = cpp_ordinary_literal_end(bytes, quote);
            blank_cpp_lexeme(&mut visible, index, end);
            index = end;
            continue;
        }
        index += 1;
    }
    let source = String::from_utf8(visible)
        .unwrap_or_else(|error| panic!("C++ lexical visibility was not UTF-8: {error}"));
    let tokens = rust_tokens(&source);
    CppLexicalVisibility { source, tokens }
}

fn cpp_preprocessor_directives(visible_source: &str) -> Vec<Vec<RustToken>> {
    let mut directives = Vec::new();
    for line in visible_source.lines() {
        let trimmed = line.trim_start();
        let normalized = if let Some(directive) = trimmed.strip_prefix("%:") {
            format!("#{directive}").replace("%:%:", "##")
        } else if trimmed.starts_with('#') {
            trimmed.replace("%:%:", "##")
        } else {
            continue;
        };
        directives.push(rust_tokens(&normalized));
    }
    directives
}

fn cpp_preprocessor_provenance_failures_from_visibility(
    visibility: &CppLexicalVisibility,
) -> Vec<&'static str> {
    let mut failures = Vec::new();
    let directives = cpp_preprocessor_directives(&visibility.source);
    let protected = [
        "ROCKSDB_NAMESPACE",
        "Tickers",
        "BYTES_WRITTEN",
        "STALL_MICROS",
        "COMPACT_READ_BYTES",
        "COMPACT_WRITE_BYTES",
        "FLUSH_WRITE_BYTES",
        "rocksdb_options_statistics_get_ticker_count",
        "oxrocksdb_ticker_",
        "oxrocksdb_",
        "ticker_",
        "user_bytes_written",
        "stall_micros",
        "compact_read_bytes",
        "compact_write_bytes",
        "flush_write_bytes",
        "statistics",
    ];
    for directive in &directives {
        let values = directive
            .iter()
            .map(|token| token.0.as_str())
            .collect::<Vec<_>>();
        let Some(kind) = values.get(1).copied() else {
            continue;
        };
        if matches!(kind, "if" | "ifdef" | "ifndef" | "elif" | "else" | "endif") {
            failures.push("conditional C++ preprocessor activity");
            continue;
        }
        if matches!(kind, "define" | "undef") {
            let touches_protected_name = values[2..].iter().any(|token| {
                TICKER_ABI_NAMES
                    .iter()
                    .any(|(function_name, _)| *token == *function_name)
                    || protected.iter().any(|protected| {
                        let lowercase = token.to_ascii_lowercase();
                        *token == *protected
                            || (lowercase.contains("oxrocksdb") && lowercase.contains("ticker"))
                    })
            });
            let pastes_resolver_fragments =
                values[2..].windows(2).any(|window| window == ["#", "#"])
                    && values[2..].iter().any(|token| {
                        token.contains("oxrocksdb")
                            || token.contains("ticker_")
                            || [
                                "user_bytes_written",
                                "stall_micros",
                                "compact_read_bytes",
                                "compact_write_bytes",
                                "flush_write_bytes",
                            ]
                            .contains(token)
                    });
            if touches_protected_name || pastes_resolver_fragments {
                failures.push("protected C++ macro rebinding or generation");
            }
        }
        if matches!(kind, "include" | "include_next" | "import") {
            let direct_statistics_header = values
                == [
                    "#",
                    "include",
                    "<",
                    "rocksdb",
                    "/",
                    "statistics",
                    ".",
                    "h",
                    ">",
                ];
            let direct_literal_include = values.len() == 2 || values.get(2) == Some(&"<");
            let touches_statistics_header = values[2..]
                .iter()
                .any(|token| token.to_ascii_lowercase().contains("statistics"));
            if !direct_literal_include
                || (touches_statistics_header && (kind != "include" || !direct_statistics_header))
            {
                failures.push("redirected statistics header include");
            }
        }
    }

    let tokens = &visibility.tokens;
    for (function_name, _) in TICKER_ABI_NAMES {
        for start in 0..tokens.len() {
            let mut composed = String::new();
            let mut identifiers = 0;
            for token in &tokens[start..tokens.len().min(start + 12)] {
                if token
                    .0
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                {
                    composed.push_str(&token.0);
                    identifiers += 1;
                    if identifiers > 1 && composed == function_name {
                        failures.push("composed C++ resolver function name");
                    }
                    if !function_name.starts_with(&composed) {
                        break;
                    }
                } else if !matches!(token.0.as_str(), "(" | ")" | "," | "#") {
                    break;
                }
            }
        }
    }
    failures
}

fn cpp_preprocessor_provenance_failures(source: &str) -> Vec<&'static str> {
    let visibility = cpp_lexical_visibility(source);
    cpp_preprocessor_provenance_failures_from_visibility(&visibility)
}

fn ticker_cpp_implementation_failures(source: &str) -> Vec<&'static str> {
    let visibility = cpp_lexical_visibility(source);
    let tokens = &visibility.tokens;
    let mut failures = cpp_preprocessor_provenance_failures_from_visibility(&visibility);
    if token_sequence_count(
        tokens,
        &[
            "#",
            "include",
            "<",
            "rocksdb",
            "/",
            "statistics",
            ".",
            "h",
            ">",
        ],
    ) != 1
    {
        failures.push("selected statistics header include");
    }
    for (function_name, enum_name) in TICKER_ABI_NAMES {
        let definition = [
            "uint32_t",
            function_name,
            "(",
            "void",
            ")",
            "{",
            "return",
            "static_cast",
            "<",
            "uint32_t",
            ">",
            "(",
            "ROCKSDB_NAMESPACE",
            ":",
            ":",
            "Tickers",
            ":",
            ":",
            enum_name,
            ")",
            ";",
            "}",
        ];
        if token_sequence_count(tokens, &definition) != 1
            || token_value_count(tokens, function_name) != 1
            || token_value_count(tokens, enum_name) != 1
        {
            failures.push("unique C++ enum-name ticker definition");
        }
    }
    failures
}

fn build_compiles_and_binds_api_from_same_headers(source: &str) -> bool {
    let tokens = rust_tokens(source);
    let Some(build_api) = unique_unconditional_function_body(&tokens, "build_rocksdb_api") else {
        return false;
    };
    let Some(bindgen_api) = unique_unconditional_function_body(&tokens, "bindgen_rocksdb_api")
    else {
        return false;
    };
    has_tokens(build_api, &["for", "include", "in", "includes"])
        && has_tokens(build_api, &["config", ".", "include", "(", "include", ")"])
        && has_tokens(bindgen_api, &["for", "include", "in", "includes"])
        && has_tokens(
            bindgen_api,
            &[
                "builder",
                "=",
                "builder",
                ".",
                "clang_arg",
                "(",
                "format",
                "!",
                "(",
                "\"-I{}\"",
                ",",
                "include",
                ".",
                "display",
                "(",
                ")",
                ")",
                ")",
            ],
        )
        && token_sequence_count(
            &tokens,
            &[
                "crate",
                ":",
                ":",
                "build_rocksdb_api",
                "(",
                "&",
                "includes",
                ")",
            ],
        ) == 1
        && token_sequence_count(
            &tokens,
            &[
                "crate",
                ":",
                ":",
                "bindgen_rocksdb_api",
                "(",
                "&",
                "includes",
                ")",
            ],
        ) == 1
        && token_sequence_count(
            &tokens,
            &[
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
            ],
        ) == 1
        && token_sequence_count(
            &tokens,
            &[
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
            ],
        ) == 1
}

fn ticker_wrapper_source_failures(source: &str) -> Vec<&'static str> {
    let tokens = rust_tokens(source);
    let mut failures = Vec::new();
    let expected_header = [
        "fn",
        "rocksdb_maintenance_statistics_tickers",
        "(",
        ")",
        "-",
        ">",
        "[",
        "u32",
        ";",
        "5",
        "]",
    ];
    let expected_body = [
        "{",
        "unsafe",
        "{",
        "[",
        "oxrocksdb_ticker_user_bytes_written",
        "(",
        ")",
        ",",
        "oxrocksdb_ticker_stall_micros",
        "(",
        ")",
        ",",
        "oxrocksdb_ticker_compact_read_bytes",
        "(",
        ")",
        ",",
        "oxrocksdb_ticker_compact_write_bytes",
        "(",
        ")",
        ",",
        "oxrocksdb_ticker_flush_write_bytes",
        "(",
        ")",
        ",",
        "]",
        "}",
        "}",
    ];
    let depths = curly_depths(&tokens).unwrap_or_default();
    let declarations = (0..tokens.len().saturating_sub(1))
        .filter(|index| {
            depths.get(*index) == Some(&0)
                && tokens[*index].0 == "fn"
                && tokens[*index + 1].0 == "rocksdb_maintenance_statistics_tickers"
        })
        .collect::<Vec<_>>();
    let ticker_span = declarations
        .as_slice()
        .first()
        .and_then(|declaration| (declarations.len() == 1).then_some(*declaration));
    let ticker_span = ticker_span.and_then(|declaration| {
        let body_open = (declaration + 2..tokens.len())
            .find(|index| depths.get(*index) == Some(&0) && tokens[*index].0 == "{")?;
        let body_close = matching_delimiter(&tokens, body_open, "{", "}")?;
        Some((declaration, body_open, body_close))
    });
    if ticker_span.is_none_or(|(declaration, body_open, _)| {
        !tokens[declaration..body_open]
            .iter()
            .map(|token| token.0.as_str())
            .eq(expected_header)
    }) {
        failures.push("Rust ticker accessor signature");
    }
    if ticker_span.is_none_or(|(_, body_open, body_close)| {
        !tokens[body_open..=body_close]
            .iter()
            .map(|token| token.0.as_str())
            .eq(expected_body)
    }) {
        failures.push("direct Rust use of C++-resolved ticker names");
    }
    for (function_name, _) in TICKER_ABI_NAMES {
        if token_value_count(&tokens, function_name) != 1 {
            failures.push("unique Rust ticker accessor use");
        }
    }
    if tokens.iter().enumerate().any(|(index, token)| {
        token.0 == "const"
            && depths.get(index).copied().unwrap_or_default() <= 1
            && tokens
                .get(index + 1)
                .is_some_and(|name| name.0.contains("TICKER"))
    }) {
        failures.push("no local Rust ticker constants");
    }
    let linked = ["maintenance_evidence", "maintenance_evidence_with_readers"]
        .into_iter()
        .filter_map(|method| unique_unconditional_method_body(&tokens, "Db", method))
        .any(|body| {
            token_sequence_count(
                body,
                &[
                    "let",
                    "statistics_tickers",
                    "=",
                    "rocksdb_maintenance_statistics_tickers",
                    "(",
                    ")",
                    ";",
                ],
            ) == 1
                && token_sequence_count(body, &["for", "ticker", "in", "statistics_tickers"]) == 1
                && token_sequence_count(body, &["statistics_reader", "(", "ticker", ")"]) == 1
        });
    if !linked || token_value_count(&tokens, "rocksdb_maintenance_statistics_tickers") != 2 {
        failures.push("collector ticker linkage");
    }
    failures
}

fn ticker_abi_source_failures(
    api_header: &str,
    api_cpp: &str,
    sys_build: &str,
    wrapper: &str,
) -> Vec<&'static str> {
    let mut failures = ticker_api_header_failures(api_header);
    failures.extend(ticker_cpp_implementation_failures(api_cpp));
    if !build_compiles_and_binds_api_from_same_headers(sys_build) {
        failures.push("same-header C++ compilation and bindgen selection");
    }
    failures.extend(ticker_wrapper_source_failures(wrapper));
    failures
}

fn valid_ticker_wrapper_fixture() -> &'static str {
    "
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

        impl Db {
            fn maintenance_evidence_with_readers(&self) {
                let statistics_tickers = rocksdb_maintenance_statistics_tickers();
                for ticker in statistics_tickers {
                    let _ = statistics_reader(ticker);
                }
            }
        }
    "
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
    failures.extend(ticker_wrapper_source_failures(source));
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
            if ::std::env::var_os("CARGO_FEATURE_ROCKSDB").is_none() {
                return;
            }
            let build_kind = ::std::env::var("DEP_ROCKSDB_BUILD_KIND")
                .expect("oxrocksdb-sys must report its selected build kind");
            let rocksdb_version = ::std::env::var("DEP_ROCKSDB_VERSION")
                .expect("oxrocksdb-sys must report its RocksDB version");
            let source_revision = ::std::env::var("DEP_ROCKSDB_SOURCE_REVISION").ok();
            match (
                build_kind.as_str(),
                rocksdb_version.as_str(),
                source_revision.as_deref(),
            ) {
                (
                    "vendored",
                    "11.1.2",
                    ::core::option::Option::Some(
                        "3b446089141659fad25328c5ea3e7ed283df46e4",
                    ),
                ) => {}
                ("system", version, ::core::option::Option::None) if !version.is_empty() => {}
                _ => ::core::panic!("oxrocksdb-sys reported invalid RocksDB build metadata"),
            }
            ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}");
            ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION={rocksdb_version}");
            if let ::core::option::Option::Some(source_revision) = source_revision {
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
    let workspace_manifest = read_to_string(repository_path("Cargo.toml"))
        .unwrap_or_else(|error| panic!("the workspace manifest must be readable: {error}"));
    let cargo_config_sources = [
        ".cargo/config.toml",
        ".cargo/config",
        "lib/.cargo/config.toml",
        "lib/.cargo/config",
        "lib/oxigraph/.cargo/config.toml",
        "lib/oxigraph/.cargo/config",
    ]
    .map(|path| read_to_string(repository_path(path)).ok());
    let cargo_configs = cargo_config_sources
        .iter()
        .filter_map(Option::as_deref)
        .collect::<Vec<_>>();
    let oxigraph_build_path = repository_path("lib/oxigraph/build.rs");
    let oxigraph_build = read_to_string(&oxigraph_build_path).ok();

    let mut failures = sys_build_metadata_failures(&sys_build);
    failures.extend(oxigraph_build_relay_failures_with_provenance(
        &oxigraph_manifest,
        &workspace_manifest,
        &cargo_configs,
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
fn oxigraph_build_relay_is_feature_gated_and_fails_closed_under_compiled_execution() {
    const MANIFEST: &str = "[package]\nbuild = \"build.rs\"";
    const GATE: &str = r#"            if ::std::env::var_os("CARGO_FEATURE_ROCKSDB").is_none() {
                return;
            }
"#;
    let relay = valid_oxigraph_build_relay_fixture();
    let relay_failures = oxigraph_build_relay_failures(MANIFEST, Some(relay));
    assert!(
        relay_failures.is_empty(),
        "the reviewed relay fixture must satisfy its static contract: {relay_failures:?}",
    );

    let disabled = compile_and_execute_oxigraph_build_relay_fixture(relay, &[])
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        disabled.status.success(),
        "a no-RocksDB build must exit successfully: {}",
        String::from_utf8_lossy(&disabled.stderr),
    );
    assert!(
        disabled.stdout.is_empty(),
        "a no-RocksDB build must emit no RocksDB identity metadata: {}",
        String::from_utf8_lossy(&disabled.stdout),
    );

    let missing =
        compile_and_execute_oxigraph_build_relay_fixture(relay, &[("CARGO_FEATURE_ROCKSDB", "1")])
            .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        !missing.status.success(),
        "an enabled RocksDB build must fail closed when dependency metadata is absent",
    );

    let vendored_environment = [
        ("CARGO_FEATURE_ROCKSDB", "1"),
        ("DEP_ROCKSDB_BUILD_KIND", "vendored"),
        ("DEP_ROCKSDB_VERSION", "11.1.2"),
        (
            "DEP_ROCKSDB_SOURCE_REVISION",
            "3b446089141659fad25328c5ea3e7ed283df46e4",
        ),
    ];
    let vendored = compile_and_execute_oxigraph_build_relay_fixture(relay, &vendored_environment)
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        vendored.status.success(),
        "valid vendored metadata must relay: {}",
        String::from_utf8_lossy(&vendored.stderr),
    );
    assert_eq!(
        String::from_utf8_lossy(&vendored.stdout),
        concat!(
            "cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND=vendored\n",
            "cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION=11.1.2\n",
            "cargo::rustc-env=OXIGRAPH_ROCKSDB_SOURCE_REVISION=",
            "3b446089141659fad25328c5ea3e7ed283df46e4\n",
        ),
    );

    let system_environment = [
        ("CARGO_FEATURE_ROCKSDB", "1"),
        ("DEP_ROCKSDB_BUILD_KIND", "system"),
        ("DEP_ROCKSDB_VERSION", "11.8.1"),
    ];
    let system = compile_and_execute_oxigraph_build_relay_fixture(relay, &system_environment)
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        system.status.success(),
        "valid system metadata must relay: {}",
        String::from_utf8_lossy(&system.stderr),
    );
    assert_eq!(
        String::from_utf8_lossy(&system.stdout),
        concat!(
            "cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND=system\n",
            "cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION=11.8.1\n",
        ),
    );

    for invalid_environment in [
        vec![
            ("CARGO_FEATURE_ROCKSDB", "1"),
            ("DEP_ROCKSDB_BUILD_KIND", "other"),
            ("DEP_ROCKSDB_VERSION", "11.1.2"),
            (
                "DEP_ROCKSDB_SOURCE_REVISION",
                "3b446089141659fad25328c5ea3e7ed283df46e4",
            ),
        ],
        vec![
            ("CARGO_FEATURE_ROCKSDB", "1"),
            ("DEP_ROCKSDB_BUILD_KIND", "vendored"),
            ("DEP_ROCKSDB_VERSION", "11.1.3"),
            (
                "DEP_ROCKSDB_SOURCE_REVISION",
                "3b446089141659fad25328c5ea3e7ed283df46e4",
            ),
        ],
        vec![
            ("CARGO_FEATURE_ROCKSDB", "1"),
            ("DEP_ROCKSDB_BUILD_KIND", "vendored"),
            ("DEP_ROCKSDB_VERSION", "11.1.2"),
        ],
        vec![
            ("CARGO_FEATURE_ROCKSDB", "1"),
            ("DEP_ROCKSDB_BUILD_KIND", "system"),
            ("DEP_ROCKSDB_VERSION", ""),
        ],
        vec![
            ("CARGO_FEATURE_ROCKSDB", "1"),
            ("DEP_ROCKSDB_BUILD_KIND", "system"),
            ("DEP_ROCKSDB_VERSION", "11.8.1"),
            ("DEP_ROCKSDB_SOURCE_REVISION", "vendored-revision-leak"),
        ],
    ] {
        let invalid =
            compile_and_execute_oxigraph_build_relay_fixture(relay, invalid_environment.as_slice())
                .unwrap_or_else(|error| panic!("{error}"));
        assert!(
            !invalid.status.success(),
            "invalid enabled-feature metadata must fail closed: {invalid_environment:?}",
        );
    }

    let wrong_gate = relay.replacen("CARGO_FEATURE_ROCKSDB", "CARGO_FEATURE_ROCKSDB_WRONG", 1);
    assert!(
        oxigraph_build_relay_failures(MANIFEST, Some(&wrong_gate))
            .contains(&"exact no-RocksDB build relay gate"),
        "a gate on the wrong feature must be rejected",
    );
    let wrong_gate_execution = compile_and_execute_oxigraph_build_relay_fixture(
        &wrong_gate,
        &[("CARGO_FEATURE_ROCKSDB", "1")],
    )
    .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        wrong_gate_execution.status.success() && wrong_gate_execution.stdout.is_empty(),
        "the compiler-backed control must prove that a wrong feature gate silently skips an enabled build",
    );

    let inverted_gate = relay.replacen(".is_none()", ".is_some()", 1);
    assert!(
        oxigraph_build_relay_failures(MANIFEST, Some(&inverted_gate))
            .contains(&"exact no-RocksDB build relay gate"),
        "an inverted feature gate must be rejected",
    );
    let inverted_execution = compile_and_execute_oxigraph_build_relay_fixture(&inverted_gate, &[])
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        !inverted_execution.status.success(),
        "the compiler-backed control must prove that an inverted gate breaks no-RocksDB builds",
    );

    let late_gate = relay.replacen(GATE, "", 1).replacen(
        "                .expect(\"oxrocksdb-sys must report its selected build kind\");\n",
        concat!(
            "                .expect(\"oxrocksdb-sys must report its selected build kind\");\n",
            "            if ::std::env::var_os(\"CARGO_FEATURE_ROCKSDB\").is_none() {\n",
            "                return;\n",
            "            }\n",
        ),
        1,
    );
    assert_ne!(late_gate, relay, "late-gate mutant must be live");
    assert!(
        oxigraph_build_relay_failures(MANIFEST, Some(&late_gate))
            .contains(&"exact no-RocksDB build relay gate"),
        "a feature gate after a dependency metadata read must be rejected",
    );
    let late_execution = compile_and_execute_oxigraph_build_relay_fixture(&late_gate, &[])
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        !late_execution.status.success(),
        "the compiler-backed control must prove that a late gate breaks no-RocksDB builds",
    );

    let fabricated = relay
        .replacen(
            ".expect(\"oxrocksdb-sys must report its selected build kind\")",
            ".unwrap_or_else(|_| \"vendored\".to_owned())",
            1,
        )
        .replacen(
            ".expect(\"oxrocksdb-sys must report its RocksDB version\")",
            ".unwrap_or_else(|_| \"11.1.2\".to_owned())",
            1,
        )
        .replacen(
            ".ok();",
            ".ok().or_else(|| ::core::option::Option::Some(\"3b446089141659fad25328c5ea3e7ed283df46e4\".to_owned()));",
            1,
        );
    assert!(
        oxigraph_build_relay_failures(MANIFEST, Some(&fabricated))
            .contains(&"validated RocksDB build identity relay"),
        "fabricated dependency metadata fallbacks must be rejected",
    );
    let fabricated_execution = compile_and_execute_oxigraph_build_relay_fixture(
        &fabricated,
        &[("CARGO_FEATURE_ROCKSDB", "1")],
    )
    .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        fabricated_execution.status.success()
            && String::from_utf8_lossy(&fabricated_execution.stdout)
                .contains("OXIGRAPH_ROCKSDB_BUILD_KIND=vendored"),
        "the compiler-backed control must prove that fallback fabrication can swallow missing metadata",
    );

    let duplicate_output = relay.replacen(
        "            ::std::println!(\"cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}\");",
        concat!(
            "            ::std::println!(\"cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}\");\n",
            "            ::std::println!(\"cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}\");",
        ),
        1,
    );
    assert!(
        oxigraph_build_relay_failures(MANIFEST, Some(&duplicate_output))
            .contains(&"unique oxigraph metadata output"),
        "duplicate metadata outputs must be rejected",
    );

    let source_revision_leak = relay
        .replacen(
            ".ok();",
            ".ok().or_else(|| ::core::option::Option::Some(\"fabricated-revision\".to_owned()));",
            1,
        )
        .replacen(
            "(\"system\", version, ::core::option::Option::None)",
            "(\"system\", version, _)",
            1,
        );
    assert!(
        oxigraph_build_relay_failures(MANIFEST, Some(&source_revision_leak))
            .contains(&"validated RocksDB build identity relay"),
        "a system-source-revision fallback must be rejected",
    );
    let leak_execution = compile_and_execute_oxigraph_build_relay_fixture(
        &source_revision_leak,
        &system_environment,
    )
    .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        leak_execution.status.success()
            && String::from_utf8_lossy(&leak_execution.stdout)
                .contains("OXIGRAPH_ROCKSDB_SOURCE_REVISION=fabricated-revision"),
        "the compiler-backed control must prove that a permissive system arm can leak a revision",
    );

    let rebound_std_namespace = format!(
        r#"
            #![no_std]
            extern crate std as real_std;
            extern crate self as std;

            pub use real_std::println;

            pub mod env {{
                pub fn var_os(_name: &str) -> ::core::option::Option<real_std::ffi::OsString> {{
                    ::core::option::Option::Some(real_std::ffi::OsString::from("fabricated"))
                }}

                pub fn var(name: &str) -> ::core::result::Result<real_std::string::String, real_std::env::VarError> {{
                    ::core::result::Result::Ok(match name {{
                        "DEP_ROCKSDB_BUILD_KIND" => real_std::string::String::from("vendored"),
                        "DEP_ROCKSDB_VERSION" => real_std::string::String::from("11.1.2"),
                        "DEP_ROCKSDB_SOURCE_REVISION" => real_std::string::String::from(
                            "3b446089141659fad25328c5ea3e7ed283df46e4",
                        ),
                        _ => real_std::string::String::new(),
                    }})
                }}
            }}

            {relay}
        "#,
    );
    assert!(
        oxigraph_build_relay_failures(MANIFEST, Some(&rebound_std_namespace))
            .contains(&"exact oxigraph build relay file"),
        "crate-level namespace rebinding around an exact main must be rejected",
    );
    let rebound_execution =
        compile_and_execute_oxigraph_build_relay_fixture(&rebound_std_namespace, &[])
            .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        rebound_execution.status.success()
            && String::from_utf8_lossy(&rebound_execution.stdout)
                == String::from_utf8_lossy(&vendored.stdout),
        "the compiler-backed control must prove crate-level namespace rebinding can fabricate exact metadata from an empty environment: stdout={} stderr={}",
        String::from_utf8_lossy(&rebound_execution.stdout),
        String::from_utf8_lossy(&rebound_execution.stderr),
    );

    for (label, alias_manifest) in [
        (
            "normal std alias",
            r#"[package]
build = "build.rs"
[build-dependencies]
std = { package = "relay-fake-std", version = "1" }
"#,
        ),
        (
            "quoted core package rename",
            r#"[package]
build = "build.rs"
[build-dependencies]
"core" = { package = "relay-fake-core", version = "1" }
"#,
        ),
        (
            "literal quoted std alias",
            r#"[package]
build = "build.rs"
[build-dependencies]
'std' = "1"
"#,
        ),
        (
            "unicode escaped core alias",
            r#"[package]
build = "build.rs"
[build-dependencies]
"\u0063ore" = "1"
"#,
        ),
        (
            "dependency table std alias",
            r#"[package]
build = "build.rs"
[build-dependencies.std]
package = "relay-fake-std"
version = "1"
"#,
        ),
        (
            "quoted dependency table core alias",
            r#"[package]
build = "build.rs"
[build-dependencies."core"]
package = "relay-fake-core"
version = "1"
"#,
        ),
        (
            "top-level dotted std alias",
            r#"build-dependencies.std = { package = "relay-fake-std", version = "1" }
[package]
build = "build.rs"
"#,
        ),
        (
            "top-level quoted dotted core alias",
            r#"build-dependencies."core".package = "relay-fake-core"
build-dependencies."core".version = "1"
[package]
build = "build.rs"
"#,
        ),
        (
            "target inline std alias",
            r#"[package]
build = "build.rs"
[target.'cfg(unix)'.build-dependencies]
std = { package = "relay-fake-std", version = "1" }
"#,
        ),
        (
            "target dependency table core alias",
            r#"[package]
build = "build.rs"
[target."x86_64-unknown-linux-gnu".build-dependencies.core]
package = "relay-fake-core"
version = "1"
"#,
        ),
        (
            "target dotted literal std alias",
            r#"target.'cfg(windows)'.build-dependencies.'std' = { package = "relay-fake-std", version = "1" }
[package]
build = "build.rs"
"#,
        ),
        (
            "top-level inline build dependency table",
            r#"build-dependencies = { std = { package = "relay-fake-std", version = "1" } }
[package]
build = "build.rs"
"#,
        ),
        (
            "nested inline target build dependency table",
            r#"target = { 'cfg(unix)' = { build-dependencies = { core = { package = "relay-fake-core", version = "1" } } } }
[package]
build = "build.rs"
"#,
        ),
        (
            "multiline inline std alias",
            r#"build-dependencies = {
    # The alias remains structural after this comment.
    std = { package = "relay-fake-std", version = "1" },
}
[package]
build = "build.rs"
"#,
        ),
    ] {
        let failures = oxigraph_build_relay_failures(alias_manifest, Some(relay));
        assert!(
            failures.contains(&"build-script compiler namespace provenance"),
            "{label} must be rejected: {failures:?}",
        );
    }

    let workspace_std = r#"
        [workspace]
        [workspace.dependencies]
        "std" = { package = "relay-fake-std", version = "1" }
    "#;
    let inherited_std = r#"
        [package]
        build = "build.rs"
        [build-dependencies]
        "std".workspace = true
    "#;
    let inherited_std_failures = oxigraph_build_relay_failures_with_provenance(
        inherited_std,
        workspace_std,
        &[],
        Some(relay),
    );
    assert!(
        inherited_std_failures
            .contains(&"workspace-inherited build-script compiler namespace provenance"),
        "workspace-inherited std aliases must be rejected: {inherited_std_failures:?}",
    );
    let workspace_core = r#"
        [workspace]
        [workspace.dependencies."core"]
        package = "relay-fake-core"
        version = "1"
    "#;
    let inherited_target_core = r#"
        [package]
        build = "build.rs"
        [target.'cfg(unix)'.build-dependencies."core"]
        workspace = true
    "#;
    let inherited_target_core_failures = oxigraph_build_relay_failures_with_provenance(
        inherited_target_core,
        workspace_core,
        &[],
        Some(relay),
    );
    assert!(
        inherited_target_core_failures
            .contains(&"workspace-inherited build-script compiler namespace provenance"),
        "target-specific workspace-inherited core aliases must be rejected: {inherited_target_core_failures:?}",
    );

    for safe_manifest in [
        r#"[package]
build = "build.rs"
# [build-dependencies]
# std = { package = "relay-fake-std" }
description = "build-dependencies.core = { package = 'decoy' }"
[dependencies]
std = { package = "ordinary-runtime-dependency", version = "1" }
[build-dependencies]
std-helper = { package = "std", version = "1" }
core-helper = { package = "core", version = "1" }
"#,
        r#"build-dependencies = { helper = { package = "std", version = "1" }, core-helper = { package = "core", version = "1" } }
[package]
build = "build.rs"
"#,
        r#"build-dependencies = {
    helper = { package = "std", version = "1" },
    core-helper = { package = "core", version = "1" },
}
[package]
build = "build.rs"
"#,
        r#"[package]
build = "build.rs"
description = """
[build-dependencies]
std = { package = "multiline-string-decoy" }
"""
[package.metadata.build-dependencies.std]
value = "metadata-only"
"#,
    ] {
        let failures = oxigraph_build_relay_failures_with_provenance(
            safe_manifest,
            workspace_std,
            &[],
            Some(relay),
        );
        assert!(
            failures.is_empty(),
            "comments, irrelevant strings, ordinary aliases, and unused workspace declarations must not fail provenance: {failures:?}",
        );
    }

    for cargo_config in [
        r#"[build]
rustflags = ["--extern", "std=/tmp/libfake_std.rlib"]
"#,
        r#"build.rustc-wrapper = "tools/compiler-wrapper"
"#,
        r#"[target.'cfg(unix)']
rustflags = "--extern core=/tmp/libfake_core.rlib"
"#,
        r#"[target.x86_64-unknown-linux-gnu]
linker = "tools/build-script-linker"
"#,
        r#"[host]
rustflags = ["--extern", "std=/tmp/libfake_std.rlib"]
"#,
        r#"[env]
"RUSTC_WORKSPACE_WRAPPER" = { value = "tools/compiler-wrapper", force = true }
"#,
        r#"build = { rustflags = ["--extern", "std=/tmp/libfake_std.rlib"] }
"#,
        r#"target = { 'cfg(unix)' = { rustflags = "--extern core=/tmp/libfake_core.rlib" } }
"#,
        r#"env = { rustflags = { value = "--extern std=/tmp/libfake_std.rlib", force = true } }
"#,
        r#"include = "compiler-overrides.toml"
"#,
        r#"[profile.dev]
rustflags = ["--extern", "core=/tmp/libfake_core.rlib"]
"#,
    ] {
        let failures = oxigraph_build_relay_failures_with_provenance(
            MANIFEST,
            "[workspace]",
            &[cargo_config],
            Some(relay),
        );
        assert!(
            failures.contains(&"repository-controlled compiler configuration provenance"),
            "repository-controlled compiler overrides must be rejected: {failures:?}",
        );
    }
    let irrelevant_config = r#"
        # build.rustflags = ["--extern", "std=comment"]
        [alias]
        relay-example = "test -- build.rustflags = '--extern core=string'"
        [build]
        target-dir = "target-rustflags-core-decoy"
    "#;
    let irrelevant_config_failures = oxigraph_build_relay_failures_with_provenance(
        MANIFEST,
        "[workspace]",
        &[irrelevant_config],
        Some(relay),
    );
    assert!(
        irrelevant_config_failures.is_empty(),
        "comments and irrelevant compiler-looking config strings must not fail provenance: {irrelevant_config_failures:?}",
    );

    for (label, cargo_config) in [
        (
            "target links table",
            r#"[target.x86_64-unknown-linux-gnu.rocksdb]
build_kind = "vendored"
version = "11.1.2"
source_revision = "fabricated"
"#,
        ),
        (
            "quoted target links table",
            r#"[target."x86_64-unknown-linux-gnu"."rocksdb"]
build_kind = "vendored"
"#,
        ),
        (
            "unicode escaped target links table",
            r#"[target."x86_64-unknown-linux-gnu"."rock\u0073db"]
build_kind = "vendored"
"#,
        ),
        (
            "dotted target links override",
            r#"target.x86_64-unknown-linux-gnu.rocksdb.build_kind = "vendored"
target.x86_64-unknown-linux-gnu.rocksdb.version = "11.1.2"
"#,
        ),
        (
            "inline links override in target table",
            r#"[target.x86_64-unknown-linux-gnu]
rocksdb = { build_kind = "vendored", version = "11.1.2" }
"#,
        ),
        (
            "top-level inline links override",
            r#"target = { x86_64-unknown-linux-gnu = { rocksdb = { build_kind = "vendored" } } }
"#,
        ),
        (
            "multiline inline links override",
            r#"target = {
    x86_64-unknown-linux-gnu = {
        # Cargo treats this as a links override despite the layout.
        rocksdb = { build_kind = "vendored", version = "11.1.2" },
    },
}
"#,
        ),
        (
            "included Cargo configuration",
            r#"include = ["reviewed-base.toml", "rocksdb-override.toml"]
"#,
        ),
    ] {
        let failures = oxigraph_build_relay_failures_with_provenance(
            MANIFEST,
            "[workspace]",
            &[cargo_config],
            Some(relay),
        );
        assert!(
            failures.contains(&"repository-controlled RocksDB links override provenance"),
            "{label} must not replace oxrocksdb-sys build-script metadata: {failures:?}",
        );
    }

    for cargo_config in [
        r#"# [target.x86_64-unknown-linux-gnu.rocksdb]
# build_kind = "vendored"
[alias]
links-decoy = "test -- target.x86_64-unknown-linux-gnu.rocksdb"
"#,
        r#"[target.x86_64-unknown-linux-gnu.openssl]
include_dir = "/reviewed/openssl"
"#,
        r#"[target.x86_64-unknown-linux-gnu]
runner = "tools/reviewed-runner"
rustdocflags = ["--cfg", "docsrs"]
rocksdb-helper = { build_kind = "ordinary-application-setting" }
"#,
        // Cargo 1.98 warns that links sub-tables below cfg() target selectors are
        // unused. The real fixture below covers the supported target-triple form.
        r#"[target.'cfg(unix)'.rocksdb]
build_kind = "unused-by-cargo"
"#,
    ] {
        let failures = oxigraph_build_relay_failures_with_provenance(
            MANIFEST,
            "[workspace]",
            &[cargo_config],
            Some(relay),
        );
        assert!(
            failures.is_empty(),
            "unrelated links names, strings, runner, and Cargo-unsupported cfg links tables must not fail provenance: {failures:?}",
        );
    }

    let links_execution =
        execute_cargo_links_override_fixture(relay).unwrap_or_else(|error| panic!("{error}"));
    assert!(
        !links_execution.baseline.status.success()
            && links_execution.baseline_ran_dependency_build_script
            && String::from_utf8_lossy(&links_execution.baseline.stderr)
                .contains("fixture dependency build script executed"),
        "the Cargo control baseline must execute the links dependency build script: stdout={} stderr={}",
        String::from_utf8_lossy(&links_execution.baseline.stdout),
        String::from_utf8_lossy(&links_execution.baseline.stderr),
    );
    assert!(
        links_execution.overridden.status.success()
            && !links_execution.override_ran_dependency_build_script,
        "a target-triple links override must skip the dependency build script, inject exact DEP_ROCKSDB_* metadata into the relay, and leave its nonexistent runner unused: stdout={} stderr={}",
        String::from_utf8_lossy(&links_execution.overridden.stdout),
        String::from_utf8_lossy(&links_execution.overridden.stderr),
    );
    assert!(
        !links_execution.invalid_linker.status.success()
            && !links_execution.invalid_linker_ran_dependency_build_script
            && String::from_utf8_lossy(&links_execution.invalid_linker.stderr)
                .contains("linker-must-not-run"),
        "Cargo must prove that target linker configuration affects build-script linkage while runner configuration does not affect execution: stdout={} stderr={}",
        String::from_utf8_lossy(&links_execution.invalid_linker.stdout),
        String::from_utf8_lossy(&links_execution.invalid_linker.stderr),
    );

    let external_std_execution = compile_and_execute_oxigraph_build_relay_with_external_alias(
        relay,
        "std",
        "relay_fake_std",
        EXTERNAL_ALIAS_FAKE_STD_SOURCE,
        &[],
    )
    .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        external_std_execution.status.success() && external_std_execution.stdout == vendored.stdout,
        "the compiler-backed control must prove an external std alias can fabricate exact vendored metadata from an empty environment: stdout={} stderr={}",
        String::from_utf8_lossy(&external_std_execution.stdout),
        String::from_utf8_lossy(&external_std_execution.stderr),
    );

    let invalid_alias_environment = [
        ("CARGO_FEATURE_ROCKSDB", "1"),
        ("DEP_ROCKSDB_BUILD_KIND", "invalid"),
        ("DEP_ROCKSDB_VERSION", "invalid"),
        ("DEP_ROCKSDB_SOURCE_REVISION", "invalid"),
    ];
    let external_core_execution = compile_and_execute_oxigraph_build_relay_with_external_alias(
        relay,
        "core",
        "relay_fake_core",
        EXTERNAL_ALIAS_FAKE_CORE_SOURCE,
        &invalid_alias_environment,
    )
    .unwrap_or_else(|error| panic!("{error}"));
    assert!(
        external_core_execution.status.success()
            && String::from_utf8_lossy(&external_core_execution.stdout)
                == concat!(
                    "cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND=invalid\n",
                    "cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION=invalid\n",
                    "cargo::rustc-env=OXIGRAPH_ROCKSDB_SOURCE_REVISION=invalid\n",
                ),
        "the compiler-backed control must prove an external core alias can bypass the invalid-metadata panic: stdout={} stderr={}",
        String::from_utf8_lossy(&external_core_execution.stdout),
        String::from_utf8_lossy(&external_core_execution.stderr),
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
fn ticker_abi_contract_rejects_ordinals_stale_mappings_swaps_and_decoys() {
    let valid_build = valid_sys_build_metadata_fixture();
    let valid_wrapper = valid_ticker_wrapper_fixture();
    let valid = ticker_abi_source_failures(
        TICKER_API_HEADER_FIXTURE,
        reviewed_ticker_abi_cpp(),
        &valid_build,
        valid_wrapper,
    );
    assert!(valid.is_empty(), "valid ticker ABI fixture: {valid:?}");

    let hardcoded_cpp = reviewed_ticker_abi_cpp().replacen(
        "static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::BYTES_WRITTEN)",
        "61",
        1,
    );
    assert_ne!(
        hardcoded_cpp,
        reviewed_ticker_abi_cpp(),
        "hardcoded-ordinal mutant must be live",
    );
    assert!(
        ticker_cpp_implementation_failures(&hardcoded_cpp)
            .contains(&"unique C++ enum-name ticker definition"),
        "a C++ ordinal must not substitute for enum-name resolution",
    );

    let swapped_cpp = reviewed_ticker_abi_cpp()
        .replacen(
            "Tickers::BYTES_WRITTEN",
            "Tickers::TICKER_SWAP_PLACEHOLDER",
            1,
        )
        .replacen("Tickers::STALL_MICROS", "Tickers::BYTES_WRITTEN", 1)
        .replacen(
            "Tickers::TICKER_SWAP_PLACEHOLDER",
            "Tickers::STALL_MICROS",
            1,
        );
    assert_ne!(
        swapped_cpp,
        reviewed_ticker_abi_cpp(),
        "name-swap mutant must be live",
    );
    assert!(
        !ticker_cpp_implementation_failures(&swapped_cpp).is_empty(),
        "swapping two named counters must fail the semantic mapping",
    );

    let local_rust_constant = format!("const ROCKSDB_TICKER_DECOY: u32 = 61;\n{valid_wrapper}");
    assert!(
        ticker_wrapper_source_failures(&local_rust_constant)
            .contains(&"no local Rust ticker constants"),
        "local Rust ordinals must not reintroduce the unstable ABI",
    );
    let hardcoded_rust_array = valid_wrapper.replacen(
        "let statistics_tickers = rocksdb_maintenance_statistics_tickers();",
        "let _ = rocksdb_maintenance_statistics_tickers();\n                let statistics_tickers = [61, 76, 89, 90, 91];",
        1,
    );
    assert_ne!(
        hardcoded_rust_array, valid_wrapper,
        "hardcoded Rust array mutant must be live",
    );
    assert!(
        ticker_wrapper_source_failures(&hardcoded_rust_array).contains(&"collector ticker linkage"),
        "an unused C++ resolver decoy must not bless a Rust ordinal array",
    );
    let swapped_wrapper = valid_wrapper
        .replacen(
            "oxrocksdb_ticker_user_bytes_written()",
            "ticker_swap_placeholder()",
            1,
        )
        .replacen(
            "oxrocksdb_ticker_stall_micros()",
            "oxrocksdb_ticker_user_bytes_written()",
            1,
        )
        .replacen(
            "ticker_swap_placeholder()",
            "oxrocksdb_ticker_stall_micros()",
            1,
        );
    assert_ne!(
        swapped_wrapper, valid_wrapper,
        "Rust name-swap mutant must be live"
    );
    assert!(
        !ticker_wrapper_source_failures(&swapped_wrapper).is_empty(),
        "the Rust semantic order must not be swappable",
    );

    let cross_wired_build = valid_build.replacen(
        "crate::build_rocksdb_api(&library.include_paths);",
        "crate::build_rocksdb_api(&includes);",
        1,
    );
    assert_ne!(
        cross_wired_build, valid_build,
        "stale vendored-only include mutant must be live",
    );
    assert!(
        !build_compiles_and_binds_api_from_same_headers(&cross_wired_build),
        "the C++ boundary must compile against the selected system include paths",
    );

    let header_spoof = r#"
        // extern ROCKSDB_LIBRARY_API uint32_t oxrocksdb_ticker_user_bytes_written(void);
        const char* lie = "extern ROCKSDB_LIBRARY_API uint32_t oxrocksdb_ticker_stall_micros(void);";
    "#;
    assert!(
        !ticker_api_header_failures(header_spoof).is_empty(),
        "comments and strings must not declare ABI functions",
    );
    let cpp_spoof = r#"
        // return static_cast<uint32_t>(ROCKSDB_NAMESPACE::Tickers::BYTES_WRITTEN);
        const char* lie = "uint32_t oxrocksdb_ticker_user_bytes_written(void)";
    "#;
    assert!(
        !ticker_cpp_implementation_failures(cpp_spoof).is_empty(),
        "comments and strings must not define the C++ boundary",
    );
    let raw_cpp_spoof = format!(
        r#"
const char* lie = R"raw("
{}
")raw";
"#,
        reviewed_ticker_abi_cpp(),
    );
    let raw_cpp_failures = ticker_cpp_implementation_failures(&raw_cpp_spoof);
    assert!(
        raw_cpp_failures.contains(&"selected statistics header include"),
        "a statistics include inside a raw string must not establish header provenance",
    );
    assert_eq!(
        raw_cpp_failures
            .iter()
            .filter(|failure| **failure == "unique C++ enum-name ticker definition")
            .count(),
        TICKER_ABI_NAMES.len(),
        "all five named-enum bodies inside a raw string must remain structurally invisible",
    );
    let raw_cpp_syntax = compile_cpp_syntax_fixture(&raw_cpp_spoof)
        .unwrap_or_else(|error| panic!("raw-string syntax control: {error}"));
    assert!(
        raw_cpp_syntax.status.success(),
        "the raw-string spoof must be valid C++ before its missing active definitions are tested: {}",
        String::from_utf8_lossy(&raw_cpp_syntax.stderr),
    );
    assert!(
        compile_ticker_abi_fixture(&frozen_11_1_2_statistics_header(), &raw_cpp_spoof).is_err(),
        "the raw-string spoof must not satisfy the compiled same-header fixture",
    );
    for prefix in ["R", "u8R", "uR", "UR", "LR"] {
        let prefixed_raw_spoof = format!(
            "const auto lie = {prefix}\"tag(\n#if 0\n#define BYTES_WRITTEN hidden\noxrocksdb_ticker_user_bytes_written\n)tag\"_diagnostic;\n",
        );
        let visibility = cpp_lexical_visibility(&prefixed_raw_spoof);
        for hidden in [
            "if",
            "define",
            "BYTES_WRITTEN",
            "oxrocksdb_ticker_user_bytes_written",
            "_diagnostic",
        ] {
            assert_eq!(
                token_value_count(&visibility.tokens, hidden),
                0,
                "{prefix} raw-literal spelling leaked {hidden} into structural proof",
            );
        }
        assert!(
            cpp_preprocessor_provenance_failures_from_visibility(&visibility).is_empty(),
            "{prefix} raw-literal content must not create active directives",
        );
    }
    let wrapper_spoof = r#"
        // fn rocksdb_maintenance_statistics_tickers() -> [u32; 5] { todo!() }
        const LIE: &str = "oxrocksdb_ticker_user_bytes_written()";
    "#;
    assert!(
        !ticker_wrapper_source_failures(wrapper_spoof).is_empty(),
        "comments and strings must not establish Rust linkage",
    );

    let benign_cpp_decoy = format!(
        "{}\nuint32_t unrelated_diagnostic_counter(void) {{ return 7; }}",
        reviewed_ticker_abi_cpp(),
    );
    assert!(
        ticker_cpp_implementation_failures(&benign_cpp_decoy).is_empty(),
        "an unrelated definition must neither prove nor invalidate the named ABI",
    );
    let benign_cpp_macros = format!(
        r##"
#define UNRELATED_DIAGNOSTIC_SCALE(value) ((value) + 1)
#define UNRELATED_DIAGNOSTIC_LABEL "statistics are diagnostic"
#define UNRELATED_DIAGNOSTIC_JOIN_INNER(left, right) left ## right
#define UNRELATED_DIAGNOSTIC_JOIN(left, right) \
  UNRELATED_DIAGNOSTIC_JOIN_INNER(left, right)
// #if 0
/*
#define oxrocksdb_ticker_user_bytes_written hidden_comment
#endif
*/
const char* unrelated_preprocessor_text = "#if 0";
const char* unrelated_raw_preprocessor_text = R"tag(
#if 0
#define BYTES_WRITTEN hidden_raw_string
)tag";
int UNRELATED_DIAGNOSTIC_JOIN(unrelated_, counter)(void) {{ return 7; }}
{}
"##,
        reviewed_ticker_abi_cpp(),
    );
    assert!(
        ticker_cpp_implementation_failures(&benign_cpp_macros).is_empty(),
        "unrelated ordinary macros, comments, and strings must remain benign",
    );
    assert!(
        compile_ticker_abi_fixture(&frozen_11_1_2_statistics_header(), &benign_cpp_macros)
            .unwrap_or_else(|error| panic!("benign C++ macro control: {error}"))
            .status
            .success(),
        "the accepted benign macro control must compile and select the named entries",
    );

    let rebound_enum = format!(
        "#define BYTES_WRITTEN STALL_MICROS\n{}",
        reviewed_ticker_abi_cpp(),
    );
    assert!(
        ticker_cpp_implementation_failures(&rebound_enum)
            .contains(&"protected C++ macro rebinding or generation"),
        "rebinding an exact enum spelling must invalidate implementation provenance",
    );
    let spliced_conditional = "#i\\\nf 0\n";
    assert!(
        cpp_preprocessor_provenance_failures(spliced_conditional)
            .contains(&"conditional C++ preprocessor activity"),
        "translation-phase line splicing must not conceal a conditional directive",
    );
    let digraph_conditional = "%:if 0\n";
    assert!(
        cpp_preprocessor_provenance_failures(digraph_conditional)
            .contains(&"conditional C++ preprocessor activity"),
        "the standard preprocessor directive digraph must not conceal a conditional",
    );
    let composed_function = format!(
        "
#define OXROCKSDB_JOIN_INNER(left, right) left ## right
#define OXROCKSDB_JOIN(left, right) OXROCKSDB_JOIN_INNER(left, right)
uint32_t OXROCKSDB_JOIN(oxrocksdb_ticker_, user_bytes_written)(void) {{ return 61; }}
{}
",
        reviewed_ticker_abi_cpp(),
    );
    assert!(
        ticker_cpp_implementation_failures(&composed_function)
            .contains(&"composed C++ resolver function name"),
        "token-composed resolver names must invalidate direct-definition provenance",
    );
    let benign_wrapper_decoy =
        format!("{valid_wrapper}\nfn unrelated_diagnostic_counter() -> u32 {{ 7 }}");
    assert!(
        ticker_wrapper_source_failures(&benign_wrapper_decoy).is_empty(),
        "an unrelated Rust helper must neither prove nor invalidate ticker linkage",
    );
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
fn repository_sources_select_statistics_tickers_through_the_same_header_cpp_abi() {
    let api_header = read_to_string(repository_path("oxrocksdb-sys/api/c.h"))
        .expect("the oxrocksdb-sys C API header must be readable");
    let api_cpp = read_to_string(repository_path("oxrocksdb-sys/api/c.cc"))
        .expect("the oxrocksdb-sys C++ API implementation must be readable");
    let sys_build = read_to_string(repository_path("oxrocksdb-sys/build.rs"))
        .expect("the oxrocksdb-sys build script must be readable");
    let wrapper = include_str!("rocksdb_wrapper.rs");
    let failures = ticker_abi_source_failures(&api_header, &api_cpp, &sys_build, wrapper);
    assert!(
        failures.is_empty(),
        "RED: repository sources do not select maintenance statistics by stable C++ enum names from the exact header used by the selected RocksDB build: {failures:?}; {TICKER_ABI_EVIDENCE_SCOPE}",
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
