#![expect(
    clippy::expect_used,
    clippy::panic,
    reason = "missing or invalid dependency build metadata must stop compilation"
)]

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
                // Keep the reviewed revision visible as a distinct tuple field.
                "3b446089141659fad25328c5ea3e7ed283df46e4",
            ),
        ) => {}
        ("system", version, ::core::option::Option::None) if !version.is_empty() => {}
        _ => ::core::panic!("oxrocksdb-sys reported invalid RocksDB build metadata"),
    }
    ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_BUILD_KIND={build_kind}");
    ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_VERSION={rocksdb_version}");
    if let ::core::option::Option::Some(source_revision) = source_revision {
        ::std::println!("cargo::rustc-env=OXIGRAPH_ROCKSDB_SOURCE_REVISION={source_revision}");
    }
}
