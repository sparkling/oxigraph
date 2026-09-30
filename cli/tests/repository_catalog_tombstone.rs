#![cfg(target_os = "linux")]
//! Public tombstone tests over real RocksDB in private temporary roots only.
//!
//! Hook errors and child `process::exit(73)` are crash-phase injection: they prove the
//! conservative reconcile outcome per boundary, NOT power-loss durability. No real
//! fsync failure is injected. Nothing outside a private `TempDir` is written or deleted.
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::{BackupOptions, RestoreOptions, Store};
use oxigraph_cli::catalog::{
    BackupFailure, CatalogError, FaultPoint, ManagerLimits, Phase, QuiesceReceipt,
    RepositoryManager, TombstoneLimits,
};
use oxigraph_cli::lease::LogicalTime;
use oxigraph_cli::repository::{OpenMode, RepositoryId};
use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::rc::Rc;
use std::sync::RwLock;
use std::time::{Duration, Instant};

// Fork inherits other threads' flock descriptors until exec closes O_CLOEXEC.
static FORK_ISOLATION: RwLock<()> = RwLock::new(());

fn limits() -> ManagerLimits {
    ManagerLimits {
        repositories: 4,
        catalog_bytes: 65536,
        scan_entries: 128,
        open_handles: 2,
        store_files: 128,
        model_retention: 1,
        model_max_generation: 1000,
    }
}
fn tl() -> TombstoneLimits {
    TombstoneLimits {
        backup_files: 1000,
        backup_bytes: 64 << 20,
        backup_timeout: Duration::from_secs(60),
    }
}
fn id(value: &str) -> RepositoryId {
    RepositoryId::parse(value).unwrap()
}
fn quads() -> Vec<Quad> {
    let s = NamedNode::new_unchecked("urn:s");
    let p = NamedNode::new_unchecked("urn:p");
    let o = NamedNode::new_unchecked("urn:o");
    vec![
        Quad::new(s.clone(), p.clone(), o.clone(), GraphName::DefaultGraph),
        Quad::new(s, p, o, NamedNode::new_unchecked("urn:g")),
    ]
}
fn expected() -> HashSet<Quad> {
    quads().into_iter().collect()
}
fn root() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    dir
}
fn seed(path: &Path) {
    let mut manager = RepositoryManager::open(path, limits()).unwrap();
    manager.create(id("A"), 1).unwrap();
    {
        let handle = manager
            .open_repository(&id("A"), OpenMode::ReadWrite)
            .unwrap();
        for quad in quads() {
            handle.insert(quad).unwrap();
        }
        handle.flush().unwrap();
    }
}
fn record(manager: &RepositoryManager, name: &str) -> oxigraph_cli::catalog::RepositoryRecord {
    manager
        .list()
        .unwrap()
        .into_iter()
        .find(|r| r.id == id(name))
        .unwrap()
}
fn quiesce(manager: &RepositoryManager, name: &str) -> QuiesceReceipt {
    manager
        .begin_quiesce(&id(name), record(manager, name).changed_at)
        .unwrap()
}
fn catalog_bytes(path: &Path) -> Vec<u8> {
    fs::read(path.join("catalog")).unwrap()
}
fn children(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut all: Vec<_> = read.map(|e| e.unwrap().path()).collect();
    all.sort();
    all
}
fn latest_package(root: &Path) -> PathBuf {
    children(&root.join("backups"))
        .into_iter()
        .max_by_key(|p| {
            p.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .rsplit('-')
                .next()
                .unwrap()
                .parse::<u64>()
                .unwrap()
        })
        .unwrap()
}
fn store_quads(path: &Path) -> HashSet<Quad> {
    Store::open_read_only(path)
        .unwrap()
        .iter()
        .collect::<Result<HashSet<_>, _>>()
        .unwrap()
}
fn restored_quads(root: &Path) -> HashSet<Quad> {
    let out = tempfile::tempdir().unwrap();
    let target = out.path().join("restored");
    Store::restore_backup(latest_package(root), &target, &RestoreOptions::default()).unwrap();
    store_quads(&target.join("store"))
}
fn only_uuid(root: &Path) -> String {
    children(&root.join("repos"))
        .remove(0)
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned()
}
fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir(to).unwrap();
    for item in fs::read_dir(from).unwrap() {
        let item = item.unwrap();
        let target = to.join(item.file_name());
        if item.file_type().unwrap().is_dir() {
            copy_tree(&item.path(), &target);
        } else {
            fs::copy(item.path(), target).unwrap();
        }
    }
}

fn drive(
    path: &Path,
    hook: impl Fn(FaultPoint) -> Result<(), CatalogError> + 'static,
) -> Result<(), CatalogError> {
    let manager = RepositoryManager::open_with_hook(path, limits(), hook)?;
    let receipt = manager.begin_quiesce(&id("A"), record(&manager, "A").changed_at)?;
    manager
        .tombstone(&id("A"), &receipt, LogicalTime(100), &tl())
        .map(drop)
}

fn finish(path: &Path, want: &HashSet<Quad>) {
    let manager = RepositoryManager::open(path, limits()).unwrap();
    let rec = record(&manager, "A");
    match rec.phase {
        Phase::Closed | Phase::Quiescing => {
            let receipt = manager.begin_quiesce(&id("A"), rec.changed_at).unwrap();
            drop(
                manager
                    .tombstone(&id("A"), &receipt, LogicalTime(500), &tl())
                    .unwrap(),
            );
        }
        Phase::TombstoneIntent => drop(
            manager
                .retry_tombstone(&id("A"), rec.changed_at, LogicalTime(500), &tl())
                .unwrap(),
        ),
        _ => {}
    }
    assert_eq!(record(&manager, "A").phase, Phase::Tombstoned);
    manager.verify_tombstone(&id("A")).unwrap();
    assert_eq!(restored_quads(path), *want);
}

fn recovered(path: &Path, want: &HashSet<Quad>, complete: bool) {
    {
        let manager = RepositoryManager::open(path, limits()).unwrap();
        let before = catalog_bytes(path);
        let phase = record(&manager, "A").phase;
        let repos = children(&path.join("repos")).len();
        let trash = children(&path.join("trash")).len();
        match phase {
            Phase::Closed | Phase::Quiescing | Phase::TombstoneIntent => {
                assert_eq!((repos, trash), (1, 0), "{phase:?}");
            }
            Phase::Tombstoned => {
                assert_eq!((repos, trash), (0, 1));
                manager.verify_tombstone(&id("A")).unwrap();
                assert_eq!(restored_quads(path), *want);
            }
            other => panic!("unexpected recovered phase {other:?}"),
        }
        if phase != Phase::Closed {
            assert!(
                manager
                    .open_repository(&id("A"), OpenMode::ReadWrite)
                    .is_err()
            );
        }
        manager.reconcile().unwrap();
        assert_eq!(catalog_bytes(path), before);
    }
    let before = catalog_bytes(path);
    drop(RepositoryManager::open(path, limits()).unwrap());
    assert_eq!(catalog_bytes(path), before);
    if complete {
        finish(path, want);
    }
}

#[test]
fn tombstone_preserves_rdf_binds_receipt_and_uses_logical_time() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    manager
        .create(id("B"), manager.catalog_generation())
        .unwrap();
    let receipt = quiesce(&manager, "A");
    let uuid = children(&dir.path().join("repos"))
        .into_iter()
        .map(|p| p.file_name().unwrap().to_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(uuid.len(), 2);
    let done = manager
        .tombstone(&id("A"), &receipt, LogicalTime(100), &tl())
        .unwrap();
    assert_eq!(done.deadline(), 101);
    let info = manager.tombstone_info(&id("A")).unwrap();
    assert_eq!((info.intent_time(), info.deadline()), (100, 101));
    assert_eq!(info.phase(), Phase::Tombstoned);
    assert_eq!(info.backup_fingerprint(), Some(done.backup_fingerprint()));
    assert_eq!(record(&manager, "A").phase, Phase::Tombstoned);
    assert_eq!(record(&manager, "B").phase, Phase::Closed);
    assert_eq!(children(&dir.path().join("repos")).len(), 1);
    assert_eq!(children(&dir.path().join("trash")).len(), 1);
    assert_eq!(
        manager.open_repository(&id("A"), OpenMode::ReadOnly).err(),
        Some(CatalogError::NotReady)
    );
    manager.verify_tombstone(&id("A")).unwrap();
    assert_eq!(restored_quads(dir.path()), expected());
    assert_eq!(
        store_quads(&children(&dir.path().join("trash"))[0]),
        expected()
    );
    assert!(manager.orphan_inventory().unwrap().is_empty());
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(100), &tl())
            .unwrap_err(),
        CatalogError::Conflict
    );
    drop(manager);
    let before = catalog_bytes(dir.path());
    drop(RepositoryManager::open(dir.path(), limits()).unwrap());
    assert_eq!(catalog_bytes(dir.path()), before);
}

#[test]
fn retention_overflow_and_busy_and_limits_refuse_before_mutation() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let handle = manager
        .open_repository(&id("A"), OpenMode::ReadWrite)
        .unwrap();
    let receipt = quiesce(&manager, "A");
    let before = catalog_bytes(dir.path());
    let untouched = |dir: &Path| {
        assert_eq!(catalog_bytes(dir), before);
        assert!(!dir.join("backups").exists());
        assert!(!dir.join("trash").exists());
    };
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(100), &tl())
            .unwrap_err(),
        CatalogError::Busy
    );
    untouched(dir.path());
    drop(handle);
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(u64::MAX), &tl())
            .unwrap_err(),
        CatalogError::Retention
    );
    untouched(dir.path());
    let bad = [
        TombstoneLimits {
            backup_files: 0,
            ..tl()
        },
        TombstoneLimits {
            backup_files: 100_001,
            ..tl()
        },
        TombstoneLimits {
            backup_bytes: 0,
            ..tl()
        },
        TombstoneLimits {
            backup_bytes: u64::MAX,
            ..tl()
        },
        TombstoneLimits {
            backup_timeout: Duration::ZERO,
            ..tl()
        },
        TombstoneLimits {
            backup_timeout: Duration::from_secs(86_401),
            ..tl()
        },
        TombstoneLimits {
            backup_files: 1,
            ..tl()
        },
        TombstoneLimits {
            backup_bytes: 1,
            ..tl()
        },
    ];
    for limits in bad {
        assert_eq!(
            manager
                .tombstone(&id("A"), &receipt, LogicalTime(100), &limits)
                .unwrap_err(),
            CatalogError::Limit,
            "{limits:?}"
        );
        untouched(dir.path());
    }
    drop(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(100), &tl())
            .unwrap(),
    );
}

#[test]
fn replayed_stale_cross_root_and_used_receipts_conflict() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let (one, two) = (root(), root());
    seed(one.path());
    seed(two.path());
    let first = RepositoryManager::open(one.path(), limits()).unwrap();
    let second = RepositoryManager::open(two.path(), limits()).unwrap();
    let foreign = quiesce(&second, "A");
    let stale = quiesce(&first, "A");
    assert_eq!(stale.generation(), foreign.generation());
    assert_eq!(
        first
            .tombstone(&id("A"), &foreign, LogicalTime(1), &tl())
            .unwrap_err(),
        CatalogError::Conflict
    );
    drop(first.complete_quiesce(&id("A"), &stale).unwrap());
    let fresh = quiesce(&first, "A");
    assert_eq!(
        first
            .tombstone(&id("A"), &stale, LogicalTime(1), &tl())
            .unwrap_err(),
        CatalogError::Conflict
    );
    drop(
        first
            .tombstone(&id("A"), &fresh, LogicalTime(1), &tl())
            .unwrap(),
    );
    assert_eq!(
        first
            .tombstone(&id("A"), &fresh, LogicalTime(1), &tl())
            .unwrap_err(),
        CatalogError::Conflict
    );
}

fn occupy_first_package(dir: &Path, manager: &RepositoryManager) -> PathBuf {
    let occupied = dir.join("backups").join(format!(
        "{}-{}",
        only_uuid(dir),
        manager.catalog_generation() + 1
    ));
    fs::create_dir(dir.join("backups")).unwrap();
    fs::set_permissions(dir.join("backups"), fs::Permissions::from_mode(0o700)).unwrap();
    fs::create_dir(&occupied).unwrap();
    occupied
}

#[test]
fn occupied_package_path_leaves_intent_unpoisoned_then_retry_uses_a_new_path() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let receipt = quiesce(&manager, "A");
    let occupied = occupy_first_package(dir.path(), &manager);
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(100), &tl())
            .unwrap_err(),
        CatalogError::Backup(BackupFailure::InvalidPath)
    );
    let rec = record(&manager, "A");
    assert_eq!(rec.phase, Phase::TombstoneIntent);
    assert!(occupied.exists());
    assert_eq!(children(&dir.path().join("repos")).len(), 1);
    assert!(manager.orphan_inventory().unwrap().contains(&occupied));
    let done = manager
        .retry_tombstone(&id("A"), rec.changed_at, LogicalTime(200), &tl())
        .unwrap();
    assert_eq!(done.deadline(), 201);
    assert!(occupied.exists());
    assert_ne!(latest_package(dir.path()), occupied);
    assert_eq!(restored_quads(dir.path()), expected());
}

#[test]
fn retry_rejects_logical_time_regression_without_mutation() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let receipt = quiesce(&manager, "A");
    let occupied = occupy_first_package(dir.path(), &manager);
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(100), &tl())
            .unwrap_err(),
        CatalogError::Backup(BackupFailure::InvalidPath)
    );
    let rec = record(&manager, "A");
    assert_eq!(rec.phase, Phase::TombstoneIntent);
    let before = catalog_bytes(dir.path());
    let backups = children(&dir.path().join("backups"));
    assert_eq!(
        manager
            .retry_tombstone(&id("A"), rec.changed_at, LogicalTime(99), &tl())
            .unwrap_err(),
        CatalogError::TimeRegression
    );
    assert_eq!(catalog_bytes(dir.path()), before);
    assert_eq!(children(&dir.path().join("backups")), backups);
    let info = manager.tombstone_info(&id("A")).unwrap();
    assert_eq!((info.intent_time(), info.deadline()), (100, 101));
    assert_eq!(record(&manager, "A").phase, Phase::TombstoneIntent);
    // Equal logical time is not a regression and keeps the original deadline.
    let done = manager
        .retry_tombstone(&id("A"), rec.changed_at, LogicalTime(100), &tl())
        .unwrap();
    assert_eq!(done.deadline(), 101);
    assert!(occupied.exists());
    assert_eq!(restored_quads(dir.path()), expected());
}

#[test]
fn symlinked_trash_unknown_links_and_scan_capacity_refuse_before_mutation() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    let outside = root();
    seed(dir.path());
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let receipt = quiesce(&manager, "A");
    let before = catalog_bytes(dir.path());
    symlink(outside.path(), dir.path().join("trash")).unwrap();
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(1), &tl())
            .unwrap_err(),
        CatalogError::UnsafePath
    );
    assert_eq!(catalog_bytes(dir.path()), before);
    assert!(!dir.path().join("backups").exists());
    fs::remove_file(dir.path().join("trash")).unwrap();
    let sst = children(&dir.path().join("repos").join(only_uuid(dir.path())))
        .into_iter()
        .find(|p| p.extension().is_some_and(|e| e == "sst"))
        .unwrap();
    fs::hard_link(&sst, dir.path().join("unknown-link")).unwrap();
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(1), &tl())
            .unwrap_err(),
        CatalogError::NotReady
    );
    assert_eq!(catalog_bytes(dir.path()), before);
    assert!(!dir.path().join("backups").exists());

    let tight = root();
    let bounded = ManagerLimits {
        scan_entries: 9,
        ..limits()
    };
    {
        let mut manager = RepositoryManager::open(tight.path(), bounded).unwrap();
        manager.create(id("A"), 1).unwrap();
    }
    let manager = RepositoryManager::open(tight.path(), bounded).unwrap();
    let receipt = quiesce(&manager, "A");
    for name in ["retained-1", "retained-2"] {
        fs::write(tight.path().join(name), b"evidence").unwrap();
    }
    let before = catalog_bytes(tight.path());
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(1), &tl())
            .unwrap_err(),
        CatalogError::Limit
    );
    assert_eq!(catalog_bytes(tight.path()), before);
    assert!(!tight.path().join("backups").exists());
}

#[test]
fn capacity_reserves_package_and_trash_entries_at_the_boundary() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    let bounded = ManagerLimits {
        scan_entries: 12,
        ..limits()
    };
    {
        let mut manager = RepositoryManager::open(dir.path(), bounded).unwrap();
        manager.create(id("A"), 1).unwrap();
    }
    let manager = RepositoryManager::open(dir.path(), bounded).unwrap();
    let receipt = quiesce(&manager, "A");
    let backups = dir.path().join("backups");
    fs::create_dir(&backups).unwrap();
    fs::set_permissions(&backups, fs::Permissions::from_mode(0o700)).unwrap();
    for i in 0..(bounded.scan_entries - 1) {
        fs::create_dir(backups.join(format!("debris-{i}"))).unwrap();
    }
    // One retained entry too many: package plus trash would exceed the ceiling.
    let before = catalog_bytes(dir.path());
    assert_eq!(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(1), &tl())
            .unwrap_err(),
        CatalogError::Limit
    );
    assert_eq!(catalog_bytes(dir.path()), before);
    assert!(!dir.path().join("trash").exists());
    assert_eq!(record(&manager, "A").phase, Phase::Quiescing);
    // Exactly at the boundary: the final package plus trash entry fills it.
    fs::remove_dir(backups.join(format!("debris-{}", bounded.scan_entries - 2))).unwrap();
    drop(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(1), &tl())
            .unwrap(),
    );
    assert_eq!(record(&manager, "A").phase, Phase::Tombstoned);
    assert_eq!(
        children(&backups).len() + children(&dir.path().join("trash")).len(),
        bounded.scan_entries
    );
    manager.verify_tombstone(&id("A")).unwrap();
}

fn to_before_move(path: &Path) {
    assert_eq!(
        drive(path, |point| if point == FaultPoint::BeforeMove {
            Err(CatalogError::Injected)
        } else {
            Ok(())
        }),
        Err(CatalogError::Injected)
    );
}

fn to_after_move(path: &Path) {
    assert_eq!(
        drive(path, |point| if point == FaultPoint::AfterMove {
            Err(CatalogError::Injected)
        } else {
            Ok(())
        }),
        Err(CatalogError::Injected)
    );
}

#[test]
fn corrupt_missing_or_foreign_package_blocks_the_move_and_preserves_evidence() {
    let _guard = FORK_ISOLATION.read().unwrap();
    for case in ["flip", "missing-marker", "foreign"] {
        let dir = root();
        seed(dir.path());
        to_before_move(dir.path());
        let package = latest_package(dir.path());
        match case {
            "flip" => {
                let current = package.join("store").join("CURRENT");
                let mut bytes = fs::read(&current).unwrap();
                bytes[0] ^= 1;
                fs::write(current, bytes).unwrap();
            }
            "missing-marker" => {
                fs::remove_file(package.join("oxigraph-backup.complete")).unwrap();
            }
            _ => {
                let foreign = root();
                {
                    let store = Store::open(foreign.path().join("s")).unwrap();
                    store.insert(quads().remove(0)).unwrap();
                    store
                        .backup_with_receipt(foreign.path().join("pkg"), &BackupOptions::default())
                        .unwrap();
                }
                fs::remove_dir_all(&package).unwrap();
                copy_tree(&foreign.path().join("pkg"), &package);
            }
        }
        let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        let before = catalog_bytes(dir.path());
        assert_eq!(
            record(&manager, "A").phase,
            Phase::TombstoneBackedUp,
            "{case}"
        );
        assert_eq!(children(&dir.path().join("repos")).len(), 1, "{case}");
        assert!(children(&dir.path().join("trash")).is_empty(), "{case}");
        let error = manager.verify_tombstone(&id("A")).unwrap_err();
        match case {
            "missing-marker" => assert_eq!(error, CatalogError::Backup(BackupFailure::Io)),
            _ => assert_eq!(error, CatalogError::Backup(BackupFailure::FileMismatch)),
        }
        manager.reconcile().unwrap();
        assert_eq!(catalog_bytes(dir.path()), before);
    }
}

#[test]
fn equal_count_source_mutation_before_backed_up_restart_is_preserved() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    to_before_move(dir.path());
    let source = children(&dir.path().join("repos")).remove(0);
    {
        // Offline mutation with identical quad, named-graph and namespace counts.
        let store = Store::open(&source).unwrap();
        store.remove(&quads().remove(0)).unwrap();
        store
            .insert(Quad::new(
                NamedNode::new_unchecked("urn:s"),
                NamedNode::new_unchecked("urn:p"),
                NamedNode::new_unchecked("urn:changed"),
                GraphName::DefaultGraph,
            ))
            .unwrap();
        store.flush().unwrap();
        assert_eq!(store.len().unwrap(), 2);
        assert_eq!(store.named_graphs().count(), 1);
    }
    let mutated = store_quads(&source);
    assert_ne!(mutated, expected());
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let before = catalog_bytes(dir.path());
    assert_eq!(record(&manager, "A").phase, Phase::TombstoneBackedUp);
    assert_eq!(children(&dir.path().join("repos")), vec![source.clone()]);
    assert!(children(&dir.path().join("trash")).is_empty());
    assert_eq!(
        manager.verify_tombstone(&id("A")).unwrap_err(),
        CatalogError::Backup(BackupFailure::FileMismatch)
    );
    manager.reconcile().unwrap();
    assert_eq!(catalog_bytes(dir.path()), before);
    assert_eq!(record(&manager, "A").phase, Phase::TombstoneBackedUp);
    assert!(children(&dir.path().join("trash")).is_empty());
    drop(manager);
    let before = catalog_bytes(dir.path());
    drop(RepositoryManager::open(dir.path(), limits()).unwrap());
    assert_eq!(catalog_bytes(dir.path()), before);
    assert_eq!(store_quads(&source), mutated);
    assert_eq!(restored_quads(dir.path()), expected());
}

#[test]
fn recovered_trash_move_is_synced_before_tombstoned_is_persisted() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    to_after_move(dir.path());
    assert!(children(&dir.path().join("repos")).is_empty());
    assert_eq!(children(&dir.path().join("trash")).len(), 1);
    let before = catalog_bytes(dir.path());
    {
        // A failed recovery sync writes nothing, poisons nothing and blocks no reopen.
        let manager = RepositoryManager::open_with_hook(dir.path(), limits(), |point| {
            if point == FaultPoint::AfterMoveSynced {
                Err(CatalogError::Io)
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(record(&manager, "A").phase, Phase::TombstoneBackedUp);
        assert_eq!(
            manager.open_repository(&id("A"), OpenMode::ReadOnly).err(),
            Some(CatalogError::NotReady)
        );
        manager.verify_tombstone(&id("A")).unwrap();
    }
    assert_eq!(catalog_bytes(dir.path()), before);
    let trace = Rc::new(RefCell::new(Vec::new()));
    let seen = Rc::clone(&trace);
    let manager = RepositoryManager::open_with_hook(dir.path(), limits(), move |point| {
        seen.borrow_mut().push(point);
        Ok(())
    })
    .unwrap();
    assert_eq!(record(&manager, "A").phase, Phase::Tombstoned);
    let trace: Vec<FaultPoint> = trace.borrow().clone();
    let at = |wanted: FaultPoint| trace.iter().position(|point| *point == wanted).unwrap();
    // The sync hook fires only after repos/, trash/ and the root were synced, and the
    // recovered seal writes the catalog strictly afterwards.
    assert!(at(FaultPoint::AfterMoveSynced) < at(FaultPoint::BeforeCatalogWrite));
    assert!(at(FaultPoint::BeforeCatalogWrite) < at(FaultPoint::AfterTombstoned));
    manager.verify_tombstone(&id("A")).unwrap();
    assert_eq!(restored_quads(dir.path()), expected());
}

#[test]
fn recovery_move_refusals_leave_backed_up_and_the_root_openable() {
    let _guard = FORK_ISOLATION.read().unwrap();
    for case in ["injected", "occupied"] {
        let dir = root();
        seed(dir.path());
        let uuid = only_uuid(dir.path());
        {
            let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            manager
                .create(id("B"), manager.catalog_generation())
                .unwrap();
        }
        to_before_move(dir.path());
        let source = dir.path().join("repos").join(&uuid);
        let target = dir.path().join("trash").join(&uuid);
        let before = catalog_bytes(dir.path());
        let fired = Cell::new(false);
        let appearing = target.clone();
        let manager = RepositoryManager::open_with_hook(dir.path(), limits(), move |point| {
            match (case, point) {
                ("injected", FaultPoint::BeforeMove) => Err(CatalogError::Io),
                // The target appears after the recovery verification began.
                ("occupied", FaultPoint::BeforeVerification) if !fired.replace(true) => {
                    fs::write(&appearing, b"appeared").unwrap();
                    Ok(())
                }
                _ => Ok(()),
            }
        })
        .unwrap();
        assert_eq!(catalog_bytes(dir.path()), before, "{case}");
        assert_eq!(
            record(&manager, "A").phase,
            Phase::TombstoneBackedUp,
            "{case}"
        );
        assert!(source.exists(), "{case}");
        assert_eq!(
            manager.open_repository(&id("A"), OpenMode::ReadOnly).err(),
            Some(CatalogError::NotReady)
        );
        // The other repository is unaffected by the refused recovery.
        drop(
            manager
                .open_repository(&id("B"), OpenMode::ReadWrite)
                .unwrap(),
        );
        if case == "injected" {
            assert!(!target.exists());
            manager.verify_tombstone(&id("A")).unwrap();
        } else {
            assert_eq!(fs::read(&target).unwrap(), b"appeared");
            assert_eq!(
                manager.verify_tombstone(&id("A")).unwrap_err(),
                CatalogError::UnsafePath
            );
            assert!(manager.orphan_inventory().unwrap().contains(&target));
        }
        drop(manager);
        if case == "occupied" {
            fs::remove_file(&target).unwrap();
        }
        // A plain reopen completes the recovery.
        let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        assert_eq!(record(&manager, "A").phase, Phase::Tombstoned, "{case}");
        assert!(!source.exists());
        manager.verify_tombstone(&id("A")).unwrap();
        assert_eq!(restored_quads(dir.path()), expected());
    }
}

#[test]
fn verification_guards_the_directory_before_any_native_open() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    let outside = root();
    seed(dir.path());
    drive(dir.path(), |_| Ok(())).unwrap();
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let trash = children(&dir.path().join("trash")).remove(0);
    let saved = outside.path().join("saved");
    fs::rename(&trash, &saved).unwrap();
    let decoy = outside.path().join("decoy");
    fs::create_dir(&decoy).unwrap();
    fs::set_permissions(&decoy, fs::Permissions::from_mode(0o700)).unwrap();
    symlink(&decoy, &trash).unwrap();
    // An open through the symlink would report a storage error for the empty decoy;
    // the guard refuses first.
    assert_eq!(
        manager.verify_tombstone(&id("A")).unwrap_err(),
        CatalogError::NotReady
    );
    assert!(children(&decoy).is_empty());
    fs::remove_file(&trash).unwrap();
    fs::rename(&saved, &trash).unwrap();
    manager.verify_tombstone(&id("A")).unwrap();
    let sst = children(&trash)
        .into_iter()
        .find(|p| p.extension().is_some_and(|e| e == "sst"))
        .unwrap();
    let link = outside.path().join("unknown-link");
    fs::hard_link(&sst, &link).unwrap();
    assert_eq!(
        manager.verify_tombstone(&id("A")).unwrap_err(),
        CatalogError::NotReady
    );
    fs::remove_file(&link).unwrap();
    manager.verify_tombstone(&id("A")).unwrap();
    assert_eq!(record(&manager, "A").phase, Phase::Tombstoned);
}

#[test]
fn recreated_source_under_tombstoned_is_reported_and_refused() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    drive(dir.path(), |_| Ok(())).unwrap();
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let uuid = children(&dir.path().join("trash"))
        .remove(0)
        .file_name()
        .unwrap()
        .to_owned();
    let recreated = dir.path().join("repos").join(uuid);
    fs::create_dir(&recreated).unwrap();
    fs::set_permissions(&recreated, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(manager.orphan_inventory().unwrap().contains(&recreated));
    assert_eq!(
        manager.verify_tombstone(&id("A")).unwrap_err(),
        CatalogError::UnsafePath
    );
    assert_eq!(record(&manager, "A").phase, Phase::Tombstoned);
    fs::remove_dir(&recreated).unwrap();
    assert!(manager.orphan_inventory().unwrap().is_empty());
    manager.verify_tombstone(&id("A")).unwrap();
}

#[test]
fn corruption_after_tombstone_is_typed_and_evidence_is_preserved() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    drive(dir.path(), |_| Ok(())).unwrap();
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    manager.verify_tombstone(&id("A")).unwrap();
    let marker = latest_package(dir.path()).join("oxigraph-backup.complete");
    let saved = fs::read(&marker).unwrap();
    fs::remove_file(&marker).unwrap();
    assert_eq!(
        manager.verify_tombstone(&id("A")).unwrap_err(),
        CatalogError::Backup(BackupFailure::Io)
    );
    fs::write(&marker, saved).unwrap();
    manager.verify_tombstone(&id("A")).unwrap();
    let current = children(&dir.path().join("trash"))
        .remove(0)
        .join("CURRENT");
    fs::write(&current, b"changed\n").unwrap();
    assert!(manager.verify_tombstone(&id("A")).is_err());
    assert_eq!(record(&manager, "A").phase, Phase::Tombstoned);
    assert_eq!(fs::read(current).unwrap(), b"changed\n");
}

#[test]
fn move_failure_preserves_source_and_occupied_target() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    let path = dir.path().to_owned();
    let result = drive(dir.path(), move |point| {
        if point == FaultPoint::BeforeMove {
            let uuid = children(&path.join("repos")).remove(0);
            fs::write(
                path.join("trash").join(uuid.file_name().unwrap()),
                b"do-not-replace",
            )
            .unwrap();
        }
        Ok(())
    });
    assert_eq!(result, Err(CatalogError::UnsafePath));
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    assert_eq!(record(&manager, "A").phase, Phase::TombstoneBackedUp);
    let target = children(&dir.path().join("trash")).remove(0);
    assert_eq!(fs::read(&target).unwrap(), b"do-not-replace");
    assert_eq!(children(&dir.path().join("repos")).len(), 1);
    // The occupant is ambiguous: reported, never adopted, and verification refuses.
    assert!(manager.orphan_inventory().unwrap().contains(&target));
    assert_eq!(
        manager.verify_tombstone(&id("A")).unwrap_err(),
        CatalogError::UnsafePath
    );
}

#[test]
fn pre_tombstone_catalog_is_byte_identical_and_open_creates_no_directories() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    seed(dir.path());
    let before = catalog_bytes(dir.path());
    assert!(!String::from_utf8_lossy(&before).contains("tombstone"));
    drop(RepositoryManager::open(dir.path(), limits()).unwrap());
    assert_eq!(catalog_bytes(dir.path()), before);
    assert!(!dir.path().join("backups").exists());
    assert!(!dir.path().join("trash").exists());
}

fn baseline_hooks() -> usize {
    let dir = root();
    seed(dir.path());
    let count = Rc::new(Cell::new(0_usize));
    let seen = Rc::clone(&count);
    drive(dir.path(), move |_| {
        seen.set(seen.get() + 1);
        Ok(())
    })
    .unwrap();
    count.get()
}

#[test]
fn injected_error_at_every_hook_recovers_conservatively() {
    let _guard = FORK_ISOLATION.read().unwrap();
    let total = baseline_hooks();
    assert!(total >= 30, "{total}");
    for index in 0..total {
        let dir = root();
        seed(dir.path());
        let counter = Cell::new(0_usize);
        let _ = drive(dir.path(), move |_| {
            let current = counter.get();
            counter.set(current + 1);
            if current == index {
                Err(CatalogError::Injected)
            } else {
                Ok(())
            }
        });
        recovered(dir.path(), &expected(), false);
    }
}

#[test]
fn tombstone_child() {
    let Ok(path) = std::env::var("OX_TOMB_ROOT") else {
        return;
    };
    let index: usize = std::env::var("OX_TOMB_CRASH").unwrap().parse().unwrap();
    let counter = Cell::new(0_usize);
    drive(Path::new(&path), move |_| {
        let current = counter.get();
        counter.set(current + 1);
        if current == index {
            std::process::exit(73);
        }
        Ok(())
    })
    .unwrap();
}

fn child(path: &Path, index: usize) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("tombstone_child")
        .arg("--nocapture")
        .env("OX_TOMB_ROOT", path)
        .env("OX_TOMB_CRASH", index.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

fn reap(child: &mut Child) -> std::process::ExitStatus {
    let end = Instant::now() + Duration::from_secs(120);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        if Instant::now() >= end {
            drop(child.kill());
            drop(child.wait());
            panic!("child exceeded bound");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn process_exit_at_every_hook_recovers_and_completes() {
    let _guard = FORK_ISOLATION.write().unwrap();
    let total = baseline_hooks();
    for index in 0..total {
        let dir = root();
        seed(dir.path());
        let status = reap(&mut child(dir.path(), index));
        assert_eq!(status.code(), Some(73), "boundary {index}");
        recovered(dir.path(), &expected(), true);
    }
}
