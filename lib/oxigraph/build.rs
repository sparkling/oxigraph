#![expect(
    clippy::expect_used,
    reason = "missing dependency metadata makes a selected RocksDB build non-diagnostic and must stop compilation"
)]

fn main() {
    let build_kind = ::std::env::var("DEP_ROCKSDB_BUILD_KIND")
        .expect("oxrocksdb-sys must report its selected build kind");
    let rocksdb_version = ::std::env::var("DEP_ROCKSDB_VERSION")
        .expect("oxrocksdb-sys must report its RocksDB version");
    let source_revision = ::std::env::var("DEP_ROCKSDB_SOURCE_REVISION").ok();
    ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}");
    ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION={rocksdb_version}");
    if let Some(source_revision) = source_revision {
        ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_SOURCE_REVISION={source_revision}");
    }
}
