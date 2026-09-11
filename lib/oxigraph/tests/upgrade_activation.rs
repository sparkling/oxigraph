#![cfg(all(not(target_family = "wasm"), feature = "rocksdb", unix))]
#![expect(
    clippy::tests_outside_test_module,
    reason = "this is a focused activation integration test"
)]
#![expect(
    clippy::panic_in_result_fn,
    reason = "test assertions identify activation invariants"
)]

use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::sparql::{QueryResults, SparqlEvaluator};
use oxigraph::store::{
    LegacyBackupReceipt, Namespace, NamespacePrefix, Store, UpgradeOptions, UpgradeReceipt,
    WritableDataset,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::num::NonZeroUsize;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn supported() -> bool {
    cfg!(target_os = "linux") && option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") == Some("vendored")
}

fn fixture(version: u64, destination: &Path) -> Result {
    fs::create_dir_all(destination)?;
    let source = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join(if version == 0 {
            "rocksdb_bc_data"
        } else {
            "rocksdb_bc_rdf_star_data"
        });
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        fs::copy(entry.path(), destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn inventory(path: &Path) -> Result<BTreeMap<PathBuf, [u8; 32]>> {
    fn walk(root: &Path, directory: &Path, output: &mut BTreeMap<PathBuf, [u8; 32]>) -> Result {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                walk(root, &entry.path(), output)?;
            } else {
                output.insert(
                    entry.path().strip_prefix(root)?.to_owned(),
                    Sha256::digest(fs::read(entry.path())?).into(),
                );
            }
        }
        Ok(())
    }

    let mut output = BTreeMap::new();
    walk(path, path, &mut output)?;
    Ok(output)
}

fn setup(version: u64) -> Result<(tempfile::TempDir, PathBuf, PathBuf, PathBuf, UpgradeOptions)> {
    let root = tempfile::tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let workspace = root.path().join("workspace");
    fixture(version, &source)?;
    let options = UpgradeOptions::default();
    Store::backup_legacy(&source, &backup, &options.recovery.transform.backup)?;
    Store::upgrade(&source, &backup, &workspace, &options)?;
    Ok((root, source, backup, workspace, options))
}

fn activation_journey(version: u64, expected_quads: usize) -> Result {
    if !supported() {
        return Ok(());
    }
    let (root, source, backup, workspace, options) = setup(version)?;
    let target = root.path().join("active");
    let before = [
        inventory(&source)?,
        inventory(&backup)?,
        inventory(&workspace)?,
    ];
    let receipt = UpgradeReceipt::verify(&source, &backup, &workspace, &options)?;

    let activation = Store::activate_upgrade(&source, &backup, &workspace, &target, &options)?;
    assert!(
        activation.active(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        activation.directory(),
        target.canonicalize()?,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        activation.upgrade_receipt(),
        &receipt,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        activation.upgrade_receipt_fingerprint(),
        receipt.fingerprint(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        activation.logical_fingerprint(),
        receipt.logical_fingerprint(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        activation.quad_count(),
        expected_quads as u64,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        activation.named_graph_count(),
        receipt.named_graph_count(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        activation.namespace_count(),
        receipt.namespace_count(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert!(
        !receipt.active(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert!(
        !receipt.upgrade_authorized(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );

    let store = Store::open(&target)?;
    store.validate()?;
    assert_eq!(
        store.len()?,
        expected_quads,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert!(
        matches!(
            SparqlEvaluator::new()
                .parse_query("ASK { ?s ?p ?o }")?
                .on_store(&store)
                .execute()?,
            QueryResults::Boolean(true)
        ),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );

    let empty_graph: NamedOrBlankNode = NamedNode::new("urn:activation:empty-graph")?.into();
    let namespace = Namespace::new(
        NamespacePrefix::new("activation")?,
        NamedNode::new("urn:activation:")?,
    );
    store.insert_named_graph(empty_graph.clone())?;
    store.set_namespace(namespace.clone())?;

    let node = NamedNode::new("urn:activation:writable")?;
    let quad = Quad::new(node.clone(), node.clone(), node, GraphName::DefaultGraph);
    let mut transaction = store.start_transaction()?;
    transaction.insert(quad.clone());
    transaction.rollback()?;
    assert!(
        !store.contains(&quad)?,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    store.insert(quad.clone())?;
    drop(store);

    let reopened = Store::open(&target)?;
    reopened.validate()?;
    assert!(
        reopened.contains(&quad)?,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert!(
        reopened.contains_named_graph(&empty_graph)?,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        reopened.namespace(namespace.prefix())?,
        Some(namespace.clone()),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    drop(reopened);

    assert_eq!(
        inventory(&source)?,
        before[0],
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&backup)?,
        before[1],
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&workspace)?,
        before[2],
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        UpgradeReceipt::verify(&source, &backup, &workspace, &options)?,
        receipt,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    LegacyBackupReceipt::verify_ancestry_with_options(
        &source,
        &backup,
        &options.recovery.transform.backup,
    )?;
    Ok(())
}

#[test]
fn v0_activation_is_writable_and_preserves_rollback_material() -> Result {
    activation_journey(0, 16)
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_v1_activation_is_writable_and_preserves_rollback_material() -> Result {
    activation_journey(1, 8)
}

#[cfg(not(feature = "rdf-12"))]
#[test]
fn no_default_v1_construction_refuses_before_an_activation_target_exists() -> Result {
    if !supported() {
        return Ok(());
    }
    let root = tempfile::tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let workspace = root.path().join("workspace");
    let target = root.path().join("target");
    fixture(1, &source)?;
    let options = UpgradeOptions::default();
    Store::backup_legacy(&source, &backup, &options.recovery.transform.backup)?;
    let source_before = inventory(&source)?;
    let backup_before = inventory(&backup)?;

    Store::upgrade(&source, &backup, &workspace, &options).unwrap_err();
    assert!(
        !target.exists(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&source)?,
        source_before,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&backup)?,
        backup_before,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    Ok(())
}

#[test]
fn path_evidence_and_option_refusals_preserve_every_input() -> Result {
    if !supported() {
        return Ok(());
    }
    let (root, source, backup, workspace, options) = setup(0)?;
    let before = [
        inventory(&source)?,
        inventory(&backup)?,
        inventory(&workspace)?,
    ];

    let existing = root.path().join("existing");
    fs::create_dir_all(&existing)?;
    fs::write(existing.join("sentinel"), b"retain")?;
    Store::activate_upgrade(&source, &backup, &workspace, &existing, &options).unwrap_err();
    assert_eq!(
        fs::read(existing.join("sentinel"))?,
        b"retain",
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );

    for target in [
        source.join("target"),
        backup.join("target"),
        workspace.join("target"),
    ] {
        Store::activate_upgrade(&source, &backup, &workspace, &target, &options).unwrap_err();
        assert!(
            !target.exists(),
            "activation assertion failed at {}:{}",
            file!(),
            line!()
        );
    }

    let real_parent = root.path().join("real-parent");
    fs::create_dir_all(&real_parent)?;
    let linked_parent = root.path().join("linked-parent");
    std::os::unix::fs::symlink(&real_parent, &linked_parent)?;
    Store::activate_upgrade(
        &source,
        &backup,
        &workspace,
        linked_parent.join("target"),
        &options,
    )
    .unwrap_err();
    assert!(
        !real_parent.join("target").exists(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );

    let mut changed_options = options.clone();
    changed_options.recovery.max_attempts = NonZeroUsize::new(15).unwrap_or(NonZeroUsize::MIN);
    let limited_target = root.path().join("limited-target");
    Store::activate_upgrade(
        &source,
        &backup,
        &workspace,
        &limited_target,
        &changed_options,
    )
    .unwrap_err();
    assert!(
        !limited_target.exists(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );

    let unsealed = root.path().join("unsealed");
    Store::start_upgrade(&source, &backup, &unsealed, &options)?;
    let unsealed_before = inventory(&unsealed)?;
    let unsealed_target = root.path().join("unsealed-target");
    Store::activate_upgrade(&source, &backup, &unsealed, &unsealed_target, &options).unwrap_err();
    assert!(
        !unsealed_target.exists(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&unsealed)?,
        unsealed_before,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );

    assert_eq!(
        inventory(&source)?,
        before[0],
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&backup)?,
        before[1],
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&workspace)?,
        before[2],
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );

    let receipt_path = workspace.join(UpgradeReceipt::manifest_name());
    let mut bytes = fs::read(&receipt_path)?;
    bytes[0] ^= 1;
    fs::write(&receipt_path, bytes)?;
    let tampered_before = inventory(&workspace)?;
    let tampered_target = root.path().join("tampered-target");
    Store::activate_upgrade(&source, &backup, &workspace, &tampered_target, &options).unwrap_err();
    assert!(
        !tampered_target.exists(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&source)?,
        before[0],
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&backup)?,
        before[1],
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert_eq!(
        inventory(&workspace)?,
        tampered_before,
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    Ok(())
}

#[test]
fn changed_executable_refuses_before_target_creation() -> Result {
    if !supported() {
        return Ok(());
    }
    let (root, source, backup, workspace, _options) = setup(0)?;
    let target = root.path().join("target");
    let executable = std::env::current_exe()?;
    let changed_executable = root.path().join("changed-executable");
    fs::copy(executable, &changed_executable)?;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&changed_executable)?;
    file.write_all(b"changed executable bytes")?;
    file.sync_all()?;
    let mut permissions = file.metadata()?.permissions();
    permissions.set_mode(0o700);
    fs::set_permissions(&changed_executable, permissions)?;
    drop(file);

    let status = Command::new(changed_executable)
        .arg("--exact")
        .arg("changed_executable_activation_helper")
        .env("OXIGRAPH_ACTIVATION_SOURCE", &source)
        .env("OXIGRAPH_ACTIVATION_BACKUP", &backup)
        .env("OXIGRAPH_ACTIVATION_WORKSPACE", &workspace)
        .env("OXIGRAPH_ACTIVATION_TARGET", &target)
        .status()?;
    assert_eq!(
        status.code(),
        Some(73),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    assert!(
        !target.exists(),
        "activation assertion failed at {}:{}",
        file!(),
        line!()
    );
    Ok(())
}

#[test]
#[expect(
    clippy::exit,
    reason = "the child reports exact executable binding refusal"
)]
fn changed_executable_activation_helper() -> Result {
    let Some(source) = std::env::var_os("OXIGRAPH_ACTIVATION_SOURCE") else {
        return Ok(());
    };
    let result = Store::activate_upgrade(
        source,
        std::env::var_os("OXIGRAPH_ACTIVATION_BACKUP").ok_or("backup")?,
        std::env::var_os("OXIGRAPH_ACTIVATION_WORKSPACE").ok_or("workspace")?,
        std::env::var_os("OXIGRAPH_ACTIVATION_TARGET").ok_or("target")?,
        &UpgradeOptions::default(),
    );
    std::process::exit(if result.is_err() { 73 } else { 74 });
}
