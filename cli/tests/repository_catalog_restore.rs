#![cfg(target_os = "linux")]
//! Public restore tests over real RocksDB in private temporary roots only.
//!
//! Hook errors and child `process::exit(73)` model crash phases, not power loss.
//! RLIMIT_FSIZE separately proves partial EFBIG I/O. A seccomp filter installed on one
//! thread of an isolated child makes that thread's real `fsync(2)` calls return `EIO`
//! after the restart rename: a syscall error return, not a device fault and not a
//! durability proof. It cannot tell the `repos/` and `staging/` parent syncs apart; that
//! both ran before `Closed` rests on the synthetic `AfterRestorePublishSynced` hook.
//! Cancellation, timeout and limit error mapping is unit coverage, not forced restore.
//! Expected RDF, empty-graph and namespace content is
//! independent literal data, never derived from restore output. Nothing outside a
//! private `TempDir` is written or deleted.
use oxigraph::model::{GraphName, NamedNode, NamedOrBlankNode, Quad};
use oxigraph::store::{
    BackupError, BackupReceipt, GovernanceTime, Namespace, NamespacePrefix, RestoreError,
    RestoreReceipt, Store, StoreIdentity, TransactionKey, TransactionRequest,
    TransactionStartControl, WritableDataset,
};
use oxigraph_cli::catalog::{
    BackupFailure, CatalogError, FaultPoint, ManagerLimits, Phase, RepositoryManager,
    RepositoryRecord, RestoreRequest, TombstoneInfo, TombstoneLimits,
};
use oxigraph_cli::lease::LogicalTime;
use oxigraph_cli::repository::{OpenMode, RepositoryId};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::num::NonZeroUsize;
use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::rc::Rc;
use std::sync::{PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, Instant};

// Spawned children must not inherit another test's manager flock descriptors.
static FORK_ISOLATION: RwLock<()> = RwLock::new(());

fn shared() -> RwLockReadGuard<'static, ()> {
    FORK_ISOLATION
        .read()
        .unwrap_or_else(PoisonError::into_inner)
}
fn exclusive() -> RwLockWriteGuard<'static, ()> {
    FORK_ISOLATION
        .write()
        .unwrap_or_else(PoisonError::into_inner)
}

const WRITE: [FaultPoint; 5] = [
    FaultPoint::BeforeCatalogWrite,
    FaultPoint::BeforeCatalogSync,
    FaultPoint::BeforeCatalogRename,
    FaultPoint::BeforeCatalogDirectorySync,
    FaultPoint::AfterCatalogSync,
];

/// Restart-only seams: they fire only while reconciliation settles a `Validated` restore.
const RESTART: [FaultPoint; 3] = [
    FaultPoint::BeforeRestoreRecheck,
    FaultPoint::AfterRestorePublishRename,
    FaultPoint::AfterRestorePublishSynced,
];

fn limits_with(repositories: usize, scan_entries: usize) -> ManagerLimits {
    ManagerLimits {
        repositories,
        catalog_bytes: 65536,
        scan_entries,
        open_handles: 2,
        store_files: 128,
        model_retention: 10,
        model_max_generation: 1000,
    }
}
fn limits() -> ManagerLimits {
    limits_with(4, 128)
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
fn namespace() -> Namespace {
    Namespace::new(
        NamespacePrefix::new("ex").unwrap(),
        NamedNode::new_unchecked("urn:example:"),
    )
}
type Contents = (HashSet<Quad>, HashSet<NamedOrBlankNode>, Vec<Namespace>);
fn expected() -> Contents {
    (
        quads().into_iter().collect(),
        [
            NamedNode::new_unchecked("urn:g"),
            NamedNode::new_unchecked("urn:empty"),
        ]
        .into_iter()
        .map(NamedOrBlankNode::from)
        .collect(),
        vec![namespace()],
    )
}
fn contents(path: &Path) -> Contents {
    let store = Store::open_read_only(path).unwrap();
    (
        store.iter().collect::<Result<HashSet<Quad>, _>>().unwrap(),
        store
            .named_graphs()
            .collect::<Result<HashSet<NamedOrBlankNode>, _>>()
            .unwrap(),
        store
            .namespaces()
            .collect::<Result<Vec<Namespace>, _>>()
            .unwrap(),
    )
}
fn identity(path: &Path) -> StoreIdentity {
    Store::open_read_only(path)
        .unwrap()
        .governance_health(GovernanceTime::now().unwrap(), NonZeroUsize::MIN)
        .unwrap()
        .store_identity()
        .cloned()
        .unwrap()
}
fn root() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    dir
}
fn children(dir: &Path) -> Vec<PathBuf> {
    let Ok(read) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut all: Vec<_> = read.map(|e| e.unwrap().path()).collect();
    all.sort();
    all
}
fn names(dir: &Path) -> Vec<String> {
    children(dir)
        .into_iter()
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect()
}
fn catalog_bytes(path: &Path) -> Vec<u8> {
    fs::read(path.join("catalog")).unwrap()
}
fn catalog_json(path: &Path) -> serde_json::Value {
    let bytes = catalog_bytes(path);
    let start = bytes
        .iter()
        .enumerate()
        .filter(|(_, b)| **b == b'\n')
        .nth(1)
        .unwrap()
        .0
        + 1;
    serde_json::from_slice(&bytes[start..]).unwrap()
}
fn entry_field(path: &Path, name: &str, field: &str) -> String {
    catalog_json(path)["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == name)
        .unwrap()[field]
        .as_str()
        .unwrap()
        .to_owned()
}
fn uuid_of(path: &Path, name: &str) -> String {
    entry_field(path, name, "uuid")
}
fn phase_in_catalog(path: &Path, name: &str) -> String {
    entry_field(path, name, "phase")
}
fn repos_of(path: &Path, name: &str) -> PathBuf {
    path.join("repos").join(uuid_of(path, name))
}
fn restore_attempt(path: &Path, name: &str) -> PathBuf {
    let catalog = catalog_json(path);
    let entry = catalog["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == name)
        .unwrap();
    path.join("staging").join(format!(
        "{}.restore-{}",
        entry["uuid"].as_str().unwrap(),
        entry["restore"]["attempt"].as_u64().unwrap()
    ))
}
fn record(manager: &RepositoryManager, name: &str) -> RepositoryRecord {
    manager
        .list()
        .unwrap()
        .into_iter()
        .find(|r| r.id == id(name))
        .unwrap()
}
fn tree(path: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for item in fs::read_dir(dir).unwrap() {
            let path = item.unwrap().path();
            let rel = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            if fs::symlink_metadata(&path).unwrap().is_dir() {
                out.insert(format!("{rel}/"), Vec::new());
                walk(base, &path, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(path, path, &mut out);
    out
}

/// The complete preserved tombstone evidence of repository A.
#[derive(Debug, PartialEq)]
struct Evidence {
    record: RepositoryRecord,
    info: TombstoneInfo,
    trash: BTreeMap<String, Vec<u8>>,
    packages: BTreeMap<String, Vec<u8>>,
}
fn evidence(path: &Path, manager: &RepositoryManager) -> Evidence {
    Evidence {
        record: record(manager, "A"),
        info: manager.tombstone_info(&id("A")).unwrap(),
        trash: tree(&path.join("trash")),
        packages: tree(&path.join("backups")),
    }
}

fn seed(path: &Path, limits: ManagerLimits) {
    {
        let mut manager = RepositoryManager::open(path, limits).unwrap();
        manager.create(id("A"), 1).unwrap();
    }
    let db = children(&path.join("repos")).remove(0);
    let store = Store::open(&db).unwrap();
    // One governed commit gives the store a lineage identity.
    let mut tx = store
        .start_governed_transaction(TransactionRequest::default(), TransactionKey::new([1; 16]))
        .unwrap()
        .into_transaction();
    tx.insert(quads().remove(0)).unwrap();
    tx.commit().unwrap();
    store.insert(quads().remove(1)).unwrap();
    store
        .insert_named_graph(NamedNode::new_unchecked("urn:empty"))
        .unwrap();
    store.set_namespace(namespace()).unwrap();
    store.flush().unwrap();
}

/// A `Tombstoned` repository A at logical time 100 (retention 10: deadline 110).
fn tombstoned(path: &Path, limits: ManagerLimits) {
    seed(path, limits);
    let manager = RepositoryManager::open(path, limits).unwrap();
    let receipt = manager
        .begin_quiesce(&id("A"), record(&manager, "A").changed_at)
        .unwrap();
    drop(
        manager
            .tombstone(&id("A"), &receipt, LogicalTime(100), &tl())
            .unwrap(),
    );
}

fn request(manager: &RepositoryManager, source: &str, new_id: &str, now: u64) -> RestoreRequest {
    let info = manager.tombstone_info(&id(source)).unwrap();
    RestoreRequest {
        source: id(source),
        source_generation: info.generation(),
        backup_fingerprint: info.backup_fingerprint().unwrap(),
        new_id: id(new_id),
        catalog_generation: manager.catalog_generation(),
        now: LogicalTime(now),
    }
}

fn drive(
    path: &Path,
    hook: impl Fn(FaultPoint) -> Result<(), CatalogError> + 'static,
) -> Result<(), CatalogError> {
    let mut manager = RepositoryManager::open_with_hook(path, limits(), hook)?;
    let request = request(&manager, "A", "B", 105);
    manager.restore_tombstoned(request).map(drop)
}

#[test]
fn restore_publishes_a_new_uuid_with_independent_content_and_preserves_tombstone_evidence() {
    let _guard = shared();
    let dir = root();
    tombstoned(dir.path(), limits());
    let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let before = evidence(dir.path(), &manager);
    let a_uuid = uuid_of(dir.path(), "A");
    let restored = manager
        .restore_tombstoned(request(&manager, "A", "B", 105))
        .unwrap();
    assert_eq!(restored.id, id("B"));
    assert_eq!(restored.phase, Phase::Closed);
    let b_uuid = uuid_of(dir.path(), "B");
    assert_ne!(a_uuid, b_uuid);
    assert_eq!(names(&dir.path().join("repos")), vec![b_uuid.clone()]);
    assert_eq!(names(&dir.path().join("trash")), vec![a_uuid.clone()]);
    assert_eq!(manager.list().unwrap().len(), 2);
    assert_eq!(evidence(dir.path(), &manager), before);
    let info = manager.restore_info(&id("B")).unwrap();
    assert_eq!(info.source(), &id("A"));
    assert_eq!(info.source_generation(), before.info.generation());
    assert_eq!(
        Some(info.backup_fingerprint()),
        before.info.backup_fingerprint()
    );
    assert_eq!(info.intent_time(), 105);
    assert!(!format!("{info:?}").contains(&b_uuid));
    assert_eq!(
        contents(&dir.path().join("repos").join(&b_uuid)),
        expected()
    );
    assert_eq!(
        contents(&dir.path().join("trash").join(&a_uuid)),
        expected()
    );
    assert!(manager.orphan_inventory().unwrap().is_empty());
    assert_eq!(
        manager.restore_info(&id("A")).unwrap_err(),
        CatalogError::NotReady
    );
    let extra = Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:new"),
        GraphName::DefaultGraph,
    );
    {
        let handle = manager
            .open_repository(&id("B"), OpenMode::ReadWrite)
            .unwrap();
        handle.insert(extra.clone()).unwrap();
        handle.flush().unwrap();
        assert!(handle.contains(&extra).unwrap());
    }
    // Writing the restored repository never touches the tombstone evidence.
    assert_eq!(evidence(dir.path(), &manager), before);
    assert!(
        !contents(&dir.path().join("trash").join(&a_uuid))
            .0
            .contains(&extra)
    );
    drop(manager);
    let bytes = catalog_bytes(dir.path());
    drop(RepositoryManager::open(dir.path(), limits()).unwrap());
    assert_eq!(catalog_bytes(dir.path()), bytes);
}

#[test]
fn repeated_restore_gives_distinct_uuids_with_equal_store_identity_and_keeps_provenance() {
    let _guard = shared();
    let dir = root();
    tombstoned(dir.path(), limits());
    let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let a_uuid = uuid_of(dir.path(), "A");
    drop(
        manager
            .restore_tombstoned(request(&manager, "A", "B", 105))
            .unwrap(),
    );
    drop(
        manager
            .restore_tombstoned(request(&manager, "A", "C", 105))
            .unwrap(),
    );
    let (b_uuid, c_uuid) = (uuid_of(dir.path(), "B"), uuid_of(dir.path(), "C"));
    assert_ne!(b_uuid, c_uuid);
    assert_ne!(a_uuid, b_uuid);
    assert_ne!(a_uuid, c_uuid);
    let trash = identity(&dir.path().join("trash").join(&a_uuid));
    // The manager UUID differs; the governed store identity is preserved, not a fork.
    assert_eq!(identity(&dir.path().join("repos").join(&b_uuid)), trash);
    assert_eq!(identity(&dir.path().join("repos").join(&c_uuid)), trash);
    assert_eq!(
        contents(&dir.path().join("repos").join(&c_uuid)),
        expected()
    );
    // Restore of a restore: quiesce, tombstone and restore again keeps provenance.
    let receipt = manager
        .begin_quiesce(&id("B"), record(&manager, "B").changed_at)
        .unwrap();
    drop(
        manager
            .tombstone(&id("B"), &receipt, LogicalTime(200), &tl())
            .unwrap(),
    );
    drop(
        manager
            .restore_tombstoned(request(&manager, "B", "D", 205))
            .unwrap(),
    );
    assert_eq!(manager.restore_info(&id("B")).unwrap().source(), &id("A"));
    assert_eq!(manager.restore_info(&id("D")).unwrap().source(), &id("B"));
    assert_eq!(record(&manager, "D").phase, Phase::Closed);
    let d_uuid = uuid_of(dir.path(), "D");
    assert_eq!(
        contents(&dir.path().join("repos").join(&d_uuid)),
        expected()
    );
    assert_eq!(identity(&dir.path().join("repos").join(&d_uuid)), trash);
    assert!(manager.orphan_inventory().unwrap().is_empty());
}

#[test]
fn refusals_change_nothing_and_create_no_restore_staging() {
    let _guard = shared();
    let (dir, other) = (root(), root());
    tombstoned(dir.path(), limits());
    tombstoned(other.path(), limits());
    let foreign = RepositoryManager::open(other.path(), limits())
        .unwrap()
        .tombstone_info(&id("A"))
        .unwrap()
        .backup_fingerprint()
        .unwrap();
    let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    manager
        .create(id("C"), manager.catalog_generation())
        .unwrap();
    let base = request(&manager, "A", "B", 105);
    assert_ne!(foreign, base.backup_fingerprint);
    let cases = [
        (
            "stale catalog",
            RestoreRequest {
                catalog_generation: base.catalog_generation - 1,
                ..base.clone()
            },
            CatalogError::Conflict,
        ),
        (
            "stale source",
            RestoreRequest {
                source_generation: base.source_generation + 1,
                ..base.clone()
            },
            CatalogError::Conflict,
        ),
        (
            "wrong fingerprint",
            RestoreRequest {
                backup_fingerprint: [0; 32],
                ..base.clone()
            },
            CatalogError::Conflict,
        ),
        (
            "cross-root fingerprint",
            RestoreRequest {
                backup_fingerprint: foreign,
                ..base.clone()
            },
            CatalogError::Conflict,
        ),
        (
            "occupied id",
            RestoreRequest {
                new_id: id("C"),
                ..base.clone()
            },
            CatalogError::Conflict,
        ),
        (
            "unknown source",
            RestoreRequest {
                source: id("nope"),
                ..base.clone()
            },
            CatalogError::NotFound,
        ),
        (
            "closed source",
            RestoreRequest {
                source: id("C"),
                ..base.clone()
            },
            CatalogError::NotReady,
        ),
        (
            "expired",
            RestoreRequest {
                now: LogicalTime(110),
                ..base.clone()
            },
            CatalogError::RetentionExpired,
        ),
        (
            "regressed",
            RestoreRequest {
                now: LogicalTime(99),
                ..base.clone()
            },
            CatalogError::TimeRegression,
        ),
    ];
    let before = catalog_bytes(dir.path());
    for (label, request, want) in cases {
        assert_eq!(
            manager.restore_tombstoned(request).unwrap_err(),
            want,
            "{label}"
        );
        assert_eq!(catalog_bytes(dir.path()), before, "{label}");
        assert!(children(&dir.path().join("staging")).is_empty(), "{label}");
        assert!(manager.list().is_ok(), "{label}");
    }
    // The window is half open: the last valid instant still restores.
    manager
        .restore_tombstoned(RestoreRequest {
            now: LogicalTime(109),
            ..base
        })
        .unwrap();
}

#[test]
fn repository_and_scan_capacity_limits_refuse_before_intent() {
    let _guard = shared();
    let dir = root();
    let one = limits_with(1, 128);
    tombstoned(dir.path(), one);
    let mut manager = RepositoryManager::open(dir.path(), one).unwrap();
    let before = catalog_bytes(dir.path());
    assert_eq!(
        manager
            .restore_tombstoned(request(&manager, "A", "B", 105))
            .unwrap_err(),
        CatalogError::Limit
    );
    assert_eq!(catalog_bytes(dir.path()), before);
    assert!(children(&dir.path().join("staging")).is_empty());
    drop(manager);
    // A restore needs three scan slots: the restore root, the staged store, a catalog temp.
    let tight = root();
    let refused = limits_with(2, 8);
    tombstoned(tight.path(), refused);
    let mut manager = RepositoryManager::open(tight.path(), refused).unwrap();
    let before = catalog_bytes(tight.path());
    assert_eq!(
        manager
            .restore_tombstoned(request(&manager, "A", "B", 105))
            .unwrap_err(),
        CatalogError::Limit
    );
    assert_eq!(catalog_bytes(tight.path()), before);
    assert!(children(&tight.path().join("staging")).is_empty());
    drop(manager);
    let exact = root();
    let boundary = limits_with(2, 9);
    tombstoned(exact.path(), boundary);
    let mut manager = RepositoryManager::open(exact.path(), boundary).unwrap();
    manager
        .restore_tombstoned(request(&manager, "A", "B", 105))
        .unwrap();
    assert_eq!(record(&manager, "B").phase, Phase::Closed);
    assert_eq!(contents(&repos_of(exact.path(), "B")), expected());
}

fn corrupt(case: &str, path: &Path, outside: &Path) {
    let backups = path.join("backups");
    let package = children(&backups).remove(0);
    match case {
        "flip" => {
            let current = package.join("store").join("CURRENT");
            let mut bytes = fs::read(&current).unwrap();
            bytes[0] ^= 1;
            fs::write(current, bytes).unwrap();
        }
        "missing-marker" => fs::remove_file(package.join("oxigraph-backup.complete")).unwrap(),
        "missing-package" => fs::remove_dir_all(&package).unwrap(),
        "extra-file" => fs::write(package.join("store").join("extra"), b"x").unwrap(),
        "symlinked-file" => {
            let current = package.join("store").join("CURRENT");
            fs::remove_file(&current).unwrap();
            symlink(outside.join("target"), current).unwrap();
        }
        "symlinked-package" => {
            fs::rename(&package, outside.join("pkg")).unwrap();
            symlink(outside.join("pkg"), &package).unwrap();
        }
        "symlinked-backups" => {
            fs::rename(&backups, outside.join("backups")).unwrap();
            symlink(outside.join("backups"), &backups).unwrap();
        }
        other => panic!("unknown case {other}"),
    }
}

#[test]
fn package_corruption_missing_and_symlinks_refuse_before_intent() {
    let _guard = shared();
    for case in [
        "flip",
        "missing-marker",
        "missing-package",
        "extra-file",
        "symlinked-file",
        "symlinked-package",
        "symlinked-backups",
    ] {
        let (dir, outside) = (root(), root());
        tombstoned(dir.path(), limits());
        let trash = tree(&dir.path().join("trash"));
        corrupt(case, dir.path(), outside.path());
        let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        let before = catalog_bytes(dir.path());
        let error = manager
            .restore_tombstoned(request(&manager, "A", "B", 105))
            .unwrap_err();
        match case {
            "flip" => assert_eq!(error, CatalogError::Backup(BackupFailure::FileMismatch)),
            "missing-marker" => assert_eq!(error, CatalogError::Backup(BackupFailure::Io)),
            "missing-package" => {
                assert_eq!(error, CatalogError::Backup(BackupFailure::InvalidPath))
            }
            "extra-file" => assert!(matches!(error, CatalogError::Backup(_)), "{error:?}"),
            _ => assert_eq!(error, CatalogError::UnsafePath, "{case}"),
        }
        assert_eq!(catalog_bytes(dir.path()), before, "{case}");
        assert!(children(&dir.path().join("staging")).is_empty(), "{case}");
        assert_eq!(tree(&dir.path().join("trash")), trash, "{case}");
        assert!(children(&dir.path().join("repos")).is_empty(), "{case}");
    }
}

#[test]
fn occupied_restore_root_is_preserved_and_retry_uses_a_new_attempt() {
    let _guard = shared();
    for variant in ["file", "symlink"] {
        let (dir, outside) = (root(), root());
        tombstoned(dir.path(), limits());
        let target = outside.path().join("target");
        fs::write(&target, b"outside").unwrap();
        let before = {
            let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            evidence(dir.path(), &manager)
        };
        let path = dir.path().to_owned();
        let link_target = target.clone();
        let mut manager = RepositoryManager::open_with_hook(dir.path(), limits(), move |point| {
            if point == FaultPoint::BeforeRestore {
                let occupant = restore_attempt(&path, "B");
                if variant == "file" {
                    fs::write(&occupant, b"occupied").unwrap();
                } else {
                    symlink(&link_target, &occupant).unwrap();
                }
            }
            Ok(())
        })
        .unwrap();
        let request = request(&manager, "A", "B", 105);
        assert_eq!(
            manager.restore_tombstoned(request).unwrap_err(),
            CatalogError::UnsafePath,
            "{variant}"
        );
        assert_eq!(record(&manager, "B").phase, Phase::Reserved);
        assert_eq!(
            manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
            Some(CatalogError::NotReady)
        );
        drop(manager);
        let occupant = restore_attempt(dir.path(), "B");
        if variant == "file" {
            assert_eq!(fs::read(&occupant).unwrap(), b"occupied");
        } else {
            assert_eq!(fs::read_link(&occupant).unwrap(), target);
            assert_eq!(fs::read(&target).unwrap(), b"outside");
        }
        let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        let reserved = record(&manager, "B");
        assert_eq!(reserved.phase, Phase::Reserved);
        assert!(children(&dir.path().join("repos")).is_empty());
        assert_eq!(manager.orphan_inventory().unwrap(), vec![occupant.clone()]);
        assert_eq!(evidence(dir.path(), &manager), before);
        let bytes = catalog_bytes(dir.path());
        manager.reconcile().unwrap();
        assert_eq!(catalog_bytes(dir.path()), bytes);
        let provenance = manager.restore_info(&id("B")).unwrap();
        let done = manager
            .retry_restore(&id("B"), reserved.changed_at, LogicalTime(105))
            .unwrap();
        assert_eq!(done.phase, Phase::Closed);
        assert_ne!(restore_attempt(dir.path(), "B"), occupant);
        assert_eq!(manager.restore_info(&id("B")).unwrap(), provenance);
        assert_eq!(contents(&repos_of(dir.path(), "B")), expected());
        assert_eq!(manager.orphan_inventory().unwrap(), vec![occupant.clone()]);
        assert_eq!(evidence(dir.path(), &manager), before);
        if variant == "file" {
            assert_eq!(fs::read(&occupant).unwrap(), b"occupied");
        } else {
            assert_eq!(fs::read_link(&occupant).unwrap(), target);
            assert_eq!(fs::read(&target).unwrap(), b"outside");
        }
    }
}

#[test]
fn partial_restore_root_without_marker_stays_reserved_and_retry_preserves_debris() {
    let _guard = shared();
    let dir = root();
    tombstoned(dir.path(), limits());
    let before = {
        let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        evidence(dir.path(), &manager)
    };
    let path = dir.path().to_owned();
    let error = drive(dir.path(), move |point| {
        if point == FaultPoint::BeforeRestore {
            let partial = restore_attempt(&path, "B");
            fs::create_dir(&partial).unwrap();
            fs::write(partial.join("partial"), b"half").unwrap();
            return Err(CatalogError::Injected);
        }
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error, CatalogError::Injected);
    assert_eq!(phase_in_catalog(dir.path(), "B"), "Reserved");
    let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let reserved = record(&manager, "B");
    assert_eq!(reserved.phase, Phase::Reserved);
    let partial = restore_attempt(dir.path(), "B");
    let debris = tree(&partial);
    assert_eq!(fs::read(partial.join("partial")).unwrap(), b"half");
    assert!(children(&dir.path().join("repos")).is_empty());
    assert_eq!(manager.orphan_inventory().unwrap(), vec![partial.clone()]);
    let bytes = catalog_bytes(dir.path());
    manager.reconcile().unwrap();
    assert_eq!(catalog_bytes(dir.path()), bytes);
    let provenance = manager.restore_info(&id("B")).unwrap();
    let done = manager
        .retry_restore(&id("B"), reserved.changed_at, LogicalTime(105))
        .unwrap();
    assert_eq!(done.phase, Phase::Closed);
    assert_ne!(restore_attempt(dir.path(), "B"), partial);
    assert_eq!(tree(&partial), debris);
    assert_eq!(manager.orphan_inventory().unwrap(), vec![partial.clone()]);
    assert_eq!(manager.restore_info(&id("B")).unwrap(), provenance);
    assert_eq!(contents(&repos_of(dir.path(), "B")), expected());
    assert_eq!(evidence(dir.path(), &manager), before);
    drop(manager);
    let bytes = catalog_bytes(dir.path());
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    assert_eq!(catalog_bytes(dir.path()), bytes);
    assert_eq!(tree(&partial), debris);
    assert_eq!(manager.orphan_inventory().unwrap(), vec![partial]);
    assert_eq!(evidence(dir.path(), &manager), before);
}

#[test]
fn reserved_with_nothing_on_disk_awaits_an_explicit_retry() {
    let _guard = shared();
    let dir = root();
    tombstoned(dir.path(), limits());
    let error = drive(dir.path(), |point| {
        if point == FaultPoint::BeforeRestore {
            Err(CatalogError::Injected)
        } else {
            Ok(())
        }
    })
    .unwrap_err();
    assert_eq!(error, CatalogError::Injected);
    let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    let reserved = record(&manager, "B");
    assert_eq!(reserved.phase, Phase::Reserved);
    assert!(children(&dir.path().join("staging")).is_empty());
    assert_eq!(
        manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
        Some(CatalogError::NotReady)
    );
    let before = catalog_bytes(dir.path());
    for (label, generation, now, want) in [
        (
            "stale generation",
            reserved.changed_at + 1,
            105,
            CatalogError::Conflict,
        ),
        (
            "time regression",
            reserved.changed_at,
            99,
            CatalogError::TimeRegression,
        ),
        (
            "expired",
            reserved.changed_at,
            110,
            CatalogError::RetentionExpired,
        ),
    ] {
        assert_eq!(
            manager
                .retry_restore(&id("B"), generation, LogicalTime(now))
                .unwrap_err(),
            want,
            "{label}"
        );
        assert_eq!(catalog_bytes(dir.path()), before, "{label}");
    }
    let done = manager
        .retry_restore(&id("B"), reserved.changed_at, LogicalTime(105))
        .unwrap();
    assert_eq!(done.phase, Phase::Closed);
    assert_eq!(contents(&repos_of(dir.path(), "B")), expected());
    assert_eq!(
        manager
            .retry_restore(&id("B"), done.changed_at, LogicalTime(105))
            .unwrap_err(),
        CatalogError::NotReady
    );
}

#[test]
fn reconciliation_completes_every_persisted_stage_after_a_crash() {
    let _guard = shared();
    for (point, persisted) in [
        (FaultPoint::AfterRestore, "Reserved"),
        (FaultPoint::AfterRestoreMove, "Reserved"),
        (FaultPoint::AfterRestoreMoveSynced, "Reserved"),
        (FaultPoint::AfterValidation, "Validated"),
        (FaultPoint::BeforePublish, "Validated"),
        (FaultPoint::AfterPublish, "Validated"),
    ] {
        let dir = root();
        tombstoned(dir.path(), limits());
        let before = {
            let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            evidence(dir.path(), &manager)
        };
        let error = drive(dir.path(), move |actual| {
            if actual == point {
                Err(CatalogError::Injected)
            } else {
                Ok(())
            }
        })
        .unwrap_err();
        assert_eq!(error, CatalogError::Injected, "{point:?}");
        assert_eq!(phase_in_catalog(dir.path(), "B"), persisted, "{point:?}");
        let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        assert_eq!(record(&manager, "B").phase, Phase::Closed, "{point:?}");
        assert_eq!(
            contents(&repos_of(dir.path(), "B")),
            expected(),
            "{point:?}"
        );
        assert!(manager.orphan_inventory().unwrap().is_empty(), "{point:?}");
        assert_eq!(evidence(dir.path(), &manager), before, "{point:?}");
        let bytes = catalog_bytes(dir.path());
        manager.reconcile().unwrap();
        assert_eq!(catalog_bytes(dir.path()), bytes);
    }
}

/// The exact live restore sequence: intent, three five-hook persists, six
/// restore/move hooks, verification and four validation/publication/closed hooks.
fn live_hooks() -> Vec<FaultPoint> {
    let mut points = vec![FaultPoint::BeforeRestoreIntent];
    points.extend(WRITE);
    points.extend([
        FaultPoint::AfterRestoreIntent,
        FaultPoint::BeforeRestore,
        FaultPoint::AfterRestore,
        FaultPoint::BeforeRestoreMove,
        FaultPoint::AfterRestoreMove,
        FaultPoint::AfterRestoreMoveSynced,
        FaultPoint::BeforeVerification,
    ]);
    points.extend(WRITE);
    points.extend([
        FaultPoint::AfterValidation,
        FaultPoint::BeforePublish,
        FaultPoint::AfterPublish,
    ]);
    points.extend(WRITE);
    points.push(FaultPoint::AfterClosed);
    points
}

/// The observed live hook sequence of one uninterrupted restore.
fn baseline_hooks() -> Vec<FaultPoint> {
    let dir = root();
    tombstoned(dir.path(), limits());
    let trace: Trace = Rc::default();
    let seen = Rc::clone(&trace);
    drive(dir.path(), move |point| {
        seen.borrow_mut().push(point);
        Ok(())
    })
    .unwrap();
    let points = trace.borrow().clone();
    // Restart-only seams never fire on the live path.
    assert!(
        points.iter().all(|point| !RESTART.contains(point)),
        "{points:?}"
    );
    points
}

/// Hook-only crashes leave B absent, a retryable `Reserved` attempt or a verified
/// completion. Reopen settles every completed stage; explicit recovery must then
/// reach `Closed` with the independent literal content.
fn recovered(path: &Path, before: &Evidence) {
    {
        let manager = RepositoryManager::open(path, limits()).unwrap();
        if let Some(b) = manager
            .list()
            .unwrap()
            .into_iter()
            .find(|r| r.id == id("B"))
        {
            match b.phase {
                Phase::Closed => assert_eq!(contents(&repos_of(path, "B")), expected()),
                Phase::Reserved => {
                    let uuid = uuid_of(path, "B");
                    assert!(!path.join("staging").join(&uuid).exists());
                    for attempt in children(&path.join("staging")) {
                        assert!(
                            attempt
                                .file_name()
                                .unwrap()
                                .to_string_lossy()
                                .starts_with(&format!("{uuid}.restore-"))
                        );
                        assert!(!attempt.join("oxigraph-restore.complete").exists());
                    }
                }
                other => panic!("unexpected recovered phase {other:?}"),
            }
        }
        assert_eq!(evidence(path, &manager), *before);
        let bytes = catalog_bytes(path);
        manager.reconcile().unwrap();
        assert_eq!(catalog_bytes(path), bytes);
    }
    let bytes = catalog_bytes(path);
    drop(RepositoryManager::open(path, limits()).unwrap());
    assert_eq!(catalog_bytes(path), bytes);
    let mut manager = RepositoryManager::open(path, limits()).unwrap();
    match manager
        .list()
        .unwrap()
        .into_iter()
        .find(|r| r.id == id("B"))
    {
        None => drop(
            manager
                .restore_tombstoned(request(&manager, "A", "B", 105))
                .unwrap(),
        ),
        Some(b) if b.phase == Phase::Reserved => drop(
            manager
                .retry_restore(&id("B"), b.changed_at, LogicalTime(105))
                .unwrap(),
        ),
        Some(b) => assert_eq!(b.phase, Phase::Closed),
    }
    assert_eq!(record(&manager, "B").phase, Phase::Closed);
    assert_eq!(contents(&repos_of(path, "B")), expected());
    assert!(!path.join("staging").join(uuid_of(path, "B")).exists());
    assert_eq!(manager.restore_info(&id("B")).unwrap().source(), &id("A"));
    drop(
        manager
            .open_repository(&id("B"), OpenMode::ReadWrite)
            .unwrap(),
    );
    assert_eq!(evidence(path, &manager), *before);
}

#[test]
fn restore_io_child() {
    let Ok(path) = std::env::var("OX_RESTORE_IO_ROOT") else {
        return;
    };
    let cap: libc::rlim_t = std::env::var("OX_RESTORE_IO_CAP").unwrap().parse().unwrap();
    let outcome = drive(Path::new(&path), move |point| {
        if point == FaultPoint::BeforeRestore {
            let mut limit = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            // SAFETY: this isolated child owns its signal disposition and resource
            // limits; the rlimit pointer is valid for both synchronous syscalls.
            #[expect(unsafe_code)]
            unsafe {
                assert_ne!(libc::signal(libc::SIGXFSZ, libc::SIG_IGN), libc::SIG_ERR);
                assert_eq!(libc::getrlimit(libc::RLIMIT_FSIZE, &mut limit), 0);
                assert!(cap > 0 && cap <= limit.rlim_max);
                limit.rlim_cur = cap;
                assert_eq!(libc::setrlimit(libc::RLIMIT_FSIZE, &limit), 0);
            }
        }
        Ok(())
    });
    std::process::exit(if outcome == Err(CatalogError::Backup(BackupFailure::Io)) {
        74
    } else {
        75
    });
}

#[test]
fn restore_backup_io_failure_leaves_retryable_partial_attempt() {
    let _guard = exclusive();
    let dir = root();
    tombstoned(dir.path(), limits());
    let before = {
        let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        evidence(dir.path(), &manager)
    };
    let package = children(&dir.path().join("backups")).remove(0);
    let largest = children(&package.join("store"))
        .iter()
        .map(|path| fs::metadata(path).unwrap().len())
        .max()
        .unwrap();
    assert!(largest > 1);
    let mut child = ChildGuard(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "restore_io_child", "--nocapture"])
            .env("OX_RESTORE_IO_ROOT", dir.path())
            .env("OX_RESTORE_IO_CAP", (largest - 1).to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    assert_eq!(reap(&mut child).code(), Some(74));
    assert_eq!(phase_in_catalog(dir.path(), "B"), "Reserved");
    let partial = restore_attempt(dir.path(), "B");
    assert!(partial.join("store").is_dir());
    assert!(!partial.join("oxigraph-restore.complete").exists());
    assert!(
        !dir.path()
            .join("staging")
            .join(uuid_of(dir.path(), "B"))
            .exists()
    );
    assert!(children(&dir.path().join("repos")).is_empty());
    let debris = tree(&partial);
    let bytes = catalog_bytes(dir.path());
    let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    manager.reconcile().unwrap();
    assert_eq!(catalog_bytes(dir.path()), bytes);
    assert_eq!(manager.orphan_inventory().unwrap(), vec![partial.clone()]);
    let reserved = record(&manager, "B");
    let done = manager
        .retry_restore(&id("B"), reserved.changed_at, LogicalTime(105))
        .unwrap();
    assert_eq!(done.phase, Phase::Closed);
    assert_ne!(restore_attempt(dir.path(), "B"), partial);
    assert_eq!(contents(&repos_of(dir.path(), "B")), expected());
    assert_eq!(tree(&partial), debris);
    assert_eq!(manager.orphan_inventory().unwrap(), vec![partial]);
    assert_eq!(evidence(dir.path(), &manager), before);
}

#[test]
fn retry_reverifies_package_and_distinguishes_missing_from_corrupt() {
    let _guard = shared();
    for missing in [true, false] {
        let dir = root();
        tombstoned(dir.path(), limits());
        let before = {
            let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            evidence(dir.path(), &manager)
        };
        assert_eq!(
            drive(dir.path(), |point| {
                if point == FaultPoint::BeforeRestore {
                    Err(CatalogError::Injected)
                } else {
                    Ok(())
                }
            }),
            Err(CatalogError::Injected)
        );
        let mut manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        let reserved = record(&manager, "B");
        assert_eq!(reserved.phase, Phase::Reserved);
        let package = children(&dir.path().join("backups")).remove(0);
        let changed = if missing {
            package.join("oxigraph-backup.complete")
        } else {
            package.join("store/CURRENT")
        };
        let saved = fs::read(&changed).unwrap();
        if missing {
            fs::remove_file(&changed).unwrap();
        } else {
            let mut bytes = saved.clone();
            bytes[0] ^= 1;
            fs::write(&changed, bytes).unwrap();
        }
        let bytes = catalog_bytes(dir.path());
        let error = manager
            .retry_restore(&id("B"), reserved.changed_at, LogicalTime(105))
            .unwrap_err();
        if missing {
            assert_eq!(error, CatalogError::Backup(BackupFailure::Io));
            assert_eq!(catalog_bytes(dir.path()), bytes);
            assert_eq!(record(&manager, "B").phase, Phase::Reserved);
            fs::write(&changed, saved).unwrap();
            let done = manager
                .retry_restore(&id("B"), reserved.changed_at, LogicalTime(105))
                .unwrap();
            assert_eq!(done.phase, Phase::Closed);
            assert_eq!(contents(&repos_of(dir.path(), "B")), expected());
            assert_eq!(evidence(dir.path(), &manager), before);
        } else {
            assert_eq!(error, CatalogError::Backup(BackupFailure::FileMismatch));
            assert_eq!(record(&manager, "B").phase, Phase::Failed);
            assert_eq!(
                manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
                Some(CatalogError::NotReady)
            );
            assert_eq!(tree(&dir.path().join("trash")), before.trash);
            drop(manager);
            let bytes = catalog_bytes(dir.path());
            let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            manager.reconcile().unwrap();
            assert_eq!(catalog_bytes(dir.path()), bytes);
            assert_eq!(record(&manager, "B").phase, Phase::Failed);
        }
    }
}

#[test]
fn restored_content_corruption_is_failed_without_publishing() {
    let _guard = shared();
    let dir = root();
    tombstoned(dir.path(), limits());
    let before = {
        let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        evidence(dir.path(), &manager)
    };
    let path = dir.path().to_owned();
    let error = drive(dir.path(), move |point| {
        if point == FaultPoint::AfterRestoreMoveSynced {
            let file = path
                .join("staging")
                .join(uuid_of(&path, "B"))
                .join("CURRENT");
            let mut bytes = fs::read(&file).unwrap();
            bytes[0] ^= 1;
            fs::write(file, bytes).unwrap();
        }
        Ok(())
    })
    .unwrap_err();
    // CURRENT corruption is rejected by store verification before content comparison.
    assert_eq!(error, CatalogError::CorruptStore);
    assert_eq!(phase_in_catalog(dir.path(), "B"), "Failed");
    assert!(children(&dir.path().join("repos")).is_empty());
    let staged = tree(&dir.path().join("staging"));
    let bytes = catalog_bytes(dir.path());
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    manager.reconcile().unwrap();
    assert_eq!(catalog_bytes(dir.path()), bytes);
    assert_eq!(tree(&dir.path().join("staging")), staged);
    assert_eq!(evidence(dir.path(), &manager), before);
}

#[test]
fn changed_source_generation_fails_closed_on_reconciliation() {
    let _guard = shared();
    let dir = root();
    tombstoned(dir.path(), limits());
    let before = {
        let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        evidence(dir.path(), &manager)
    };
    assert_eq!(
        drive(dir.path(), |point| {
            if point == FaultPoint::BeforeRestore {
                Err(CatalogError::Injected)
            } else {
                Ok(())
            }
        }),
        Err(CatalogError::Injected)
    );
    let bytes = String::from_utf8(catalog_bytes(dir.path())).unwrap();
    let body = bytes.splitn(3, '\n').nth(2).unwrap();
    let generation = before.info.generation();
    assert!(generation > 1);
    let old = format!("\"source_generation\":{generation}");
    assert_eq!(body.matches(&old).count(), 1);
    let body = body.replace(&old, &format!("\"source_generation\":{}", generation - 1));
    let checksum: String = Sha256::digest(body.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    fs::write(
        dir.path().join("catalog"),
        format!("oxigraph-catalog-v1\n{checksum}\n{body}"),
    )
    .unwrap();
    let old_generation = catalog_json(dir.path())["generation"].as_u64().unwrap();
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    assert_eq!(record(&manager, "B").phase, Phase::Failed);
    assert_eq!(manager.catalog_generation(), old_generation + 1);
    assert_eq!(
        manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
        Some(CatalogError::NotReady)
    );
    assert_eq!(evidence(dir.path(), &manager), before);
    let bytes = catalog_bytes(dir.path());
    manager.reconcile().unwrap();
    assert_eq!(catalog_bytes(dir.path()), bytes);
    drop(manager);
    drop(RepositoryManager::open(dir.path(), limits()).unwrap());
    assert_eq!(catalog_bytes(dir.path()), bytes);
}

#[test]
fn injected_error_at_every_hook_recovers_conservatively() {
    let _guard = shared();
    let hooks = baseline_hooks();
    // Intent + three five-hook persists + six restore/move hooks + verification
    // + four validation/publication/closed hooks.
    assert_eq!(hooks.len(), 1 + 3 * 5 + 6 + 1 + 4);
    assert_eq!(hooks, live_hooks());
    for (index, point) in hooks.into_iter().enumerate() {
        let dir = root();
        tombstoned(dir.path(), limits());
        let before = {
            let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            evidence(dir.path(), &manager)
        };
        let counter = Cell::new(0_usize);
        let fired = Rc::new(Cell::new(None));
        let seen = Rc::clone(&fired);
        let result = drive(dir.path(), move |actual| {
            let current = counter.get();
            counter.set(current + 1);
            if current == index {
                seen.set(Some(actual));
                Err(CatalogError::Injected)
            } else {
                Ok(())
            }
        });
        // Every enumerated hook error surfaces unchanged to the caller.
        assert_eq!(
            result,
            Err(CatalogError::Injected),
            "hook {index} {point:?}"
        );
        assert_eq!(fired.get(), Some(point), "hook {index}");
        recovered(dir.path(), &before);
    }
}

#[test]
fn restore_child() {
    let Ok(path) = std::env::var("OX_RESTORE_ROOT") else {
        return; // An ordinary run: only the parent test re-invokes this.
    };
    let index: usize = std::env::var("OX_RESTORE_CRASH").unwrap().parse().unwrap();
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

/// Kills and reaps its child on every path, including a parent panic.
struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        drop(self.0.kill());
        drop(self.0.wait());
    }
}

fn child(path: &Path, index: usize) -> ChildGuard {
    ChildGuard(
        Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("restore_child")
            .arg("--nocapture")
            .env("OX_RESTORE_ROOT", path)
            .env("OX_RESTORE_CRASH", index.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    )
}

fn reap(child: &mut ChildGuard) -> ExitStatus {
    let end = Instant::now() + Duration::from_secs(120);
    loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            return status;
        }
        assert!(Instant::now() < end, "child exceeded bound");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn process_exit_at_every_hook_recovers_and_completes() {
    let _guard = exclusive();
    let total = baseline_hooks().len();
    for index in 0..total {
        let dir = root();
        tombstoned(dir.path(), limits());
        let before = {
            let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            evidence(dir.path(), &manager)
        };
        let status = reap(&mut child(dir.path(), index));
        assert_eq!(status.code(), Some(73), "boundary {index}");
        recovered(dir.path(), &before);
    }
}

// ---------------------------------------------------------------- Validated restart window

type Trace = Rc<RefCell<Vec<FaultPoint>>>;

/// Opens with a hook recording every point and injecting an error only at `fail`.
fn open_traced(path: &Path, fail: Option<FaultPoint>) -> (RepositoryManager, Trace) {
    let trace: Trace = Rc::default();
    let seen = Rc::clone(&trace);
    let manager = RepositoryManager::open_with_hook(path, limits(), move |point| {
        seen.borrow_mut().push(point);
        if Some(point) == fail {
            Err(CatalogError::Injected)
        } else {
            Ok(())
        }
    })
    .unwrap();
    (manager, trace)
}

/// The staged (`staging/<uuid>`) and published (`repos/<uuid>`) candidate paths of B.
fn candidate_paths(path: &Path) -> (PathBuf, PathBuf) {
    let uuid = uuid_of(path, "B");
    (
        path.join("staging").join(&uuid),
        path.join("repos").join(uuid),
    )
}

/// A durable `Validated` restore of B, left staged by an injected `AfterValidation`
/// error or already published by an injected `AfterPublish` error. Returns the
/// tombstone evidence of A captured before the restore.
fn validated_restore(path: &Path, published: bool) -> Evidence {
    tombstoned(path, limits());
    let before = {
        let manager = RepositoryManager::open(path, limits()).unwrap();
        evidence(path, &manager)
    };
    let point = if published {
        FaultPoint::AfterPublish
    } else {
        FaultPoint::AfterValidation
    };
    let result = drive(path, move |actual| {
        if actual == point {
            Err(CatalogError::Injected)
        } else {
            Ok(())
        }
    });
    assert_eq!(result, Err(CatalogError::Injected));
    assert_eq!(phase_in_catalog(path, "B"), "Validated");
    let (staged, public) = candidate_paths(path);
    assert_eq!(staged.is_dir(), !published);
    assert_eq!(public.is_dir(), published);
    before
}

fn reserved_restore_with_unrelated_repository(path: &Path) -> Evidence {
    tombstoned(path, limits());
    let before = {
        let mut manager = RepositoryManager::open(path, limits()).unwrap();
        manager
            .create(id("C"), manager.catalog_generation())
            .unwrap();
        evidence(path, &manager)
    };
    assert_eq!(
        drive(path, |point| {
            if point == FaultPoint::AfterRestoreMoveSynced {
                Err(CatalogError::Injected)
            } else {
                Ok(())
            }
        }),
        Err(CatalogError::Injected)
    );
    assert_eq!(phase_in_catalog(path, "B"), "Reserved");
    assert!(candidate_paths(path).0.is_dir());
    before
}

#[test]
fn reserved_restart_publication_refusal_is_local_and_preserves_unrelated_access() {
    let _guard = shared();
    for point in RESTART {
        let dir = root();
        let before = reserved_restore_with_unrelated_repository(dir.path());
        let (manager, trace) = open_traced(dir.path(), Some(point));
        assert!(trace.borrow().contains(&point), "{point:?}");
        assert!(!trace.borrow().contains(&FaultPoint::BeforePublish));
        assert_eq!(record(&manager, "B").phase, Phase::Validated);
        assert_eq!(
            manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
            Some(CatalogError::NotReady)
        );
        drop(
            manager
                .open_repository(&id("C"), OpenMode::ReadOnly)
                .unwrap(),
        );
        assert_eq!(evidence(dir.path(), &manager), before);
        let bytes = catalog_bytes(dir.path());
        manager.reconcile().unwrap();
        if point == FaultPoint::AfterRestorePublishRename {
            // The rename is already visible, so this hook cannot fire on retry.
            assert_eq!(record(&manager, "B").phase, Phase::Closed);
            assert_ne!(catalog_bytes(dir.path()), bytes);
        } else {
            assert_eq!(record(&manager, "B").phase, Phase::Validated);
            assert_eq!(catalog_bytes(dir.path()), bytes);
        }
        drop(manager);
        let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
        assert_settled(dir.path(), &manager, &before);
        drop(
            manager
                .open_repository(&id("C"), OpenMode::ReadOnly)
                .unwrap(),
        );
    }
}

#[test]
fn completed_package_missing_directories_fail_in_both_publication_windows() {
    let _guard = shared();
    for published in [false, true] {
        for name in ["store", "contributors"] {
            let dir = root();
            validated_restore(dir.path(), published);
            let package = children(&dir.path().join("backups")).remove(0);
            assert!(package.join(BackupReceipt::manifest_name()).is_file());
            let saved = root();
            fs::rename(package.join(name), saved.path().join(name)).unwrap();
            let preserved = tree(saved.path());
            let candidate = if published {
                candidate_paths(dir.path()).1
            } else {
                candidate_paths(dir.path()).0
            };
            let candidate_bytes = tree(&candidate);
            let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            assert_eq!(record(&manager, "B").phase, Phase::Failed, "{name}");
            assert_eq!(
                manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
                Some(CatalogError::NotReady)
            );
            assert_eq!(tree(&candidate), candidate_bytes);
            assert_eq!(tree(saved.path()), preserved);
            let bytes = catalog_bytes(dir.path());
            manager.reconcile().unwrap();
            assert_eq!(catalog_bytes(dir.path()), bytes);
            drop(manager);
            drop(RepositoryManager::open(dir.path(), limits()).unwrap());
            assert_eq!(catalog_bytes(dir.path()), bytes);
        }
    }
}

/// The restart trace that settles a `Validated` restore to `Closed`: recheck, the
/// candidate proof, a rename only if still staged, both parent syncs, the Closed write.
fn settled_trace(renamed: bool) -> Vec<FaultPoint> {
    let mut points = vec![
        FaultPoint::BeforeRestoreRecheck,
        FaultPoint::BeforeVerification,
    ];
    if !renamed {
        points.push(FaultPoint::AfterRestorePublishRename);
    }
    points.push(FaultPoint::AfterRestorePublishSynced);
    points.extend(WRITE);
    points
}

/// B is `Closed` and published only, with the independent literal content, its
/// provenance, no unexplained debris and unchanged tombstone evidence of A.
fn assert_settled(path: &Path, manager: &RepositoryManager, before: &Evidence) {
    let (staged, public) = candidate_paths(path);
    assert_eq!(record(manager, "B").phase, Phase::Closed);
    assert!(!staged.exists());
    assert_eq!(contents(&public), expected());
    assert_eq!(manager.restore_info(&id("B")).unwrap().source(), &id("A"));
    assert!(manager.orphan_inventory().unwrap().is_empty());
    assert_eq!(evidence(path, manager), *before);
    drop(
        manager
            .open_repository(&id("B"), OpenMode::ReadWrite)
            .unwrap(),
    );
    assert_eq!(evidence(path, manager), *before);
}

#[test]
fn restart_only_restore_hooks_keep_validated_nonready_until_a_clean_restart() {
    let _guard = shared();
    for published in [false, true] {
        for point in RESTART {
            let label = format!("{point:?} published={published}");
            let dir = root();
            let before = validated_restore(dir.path(), published);
            let (staged, public) = candidate_paths(dir.path());
            let bytes = catalog_bytes(dir.path());
            // Hooks fire in restart order up to the injected one. A published candidate
            // is never renamed again, so its rename hook cannot fire at all.
            let full = settled_trace(published);
            let want = match full.iter().position(|actual| *actual == point) {
                Some(stop) => full[..=stop].to_vec(),
                None => full.clone(),
            };
            let fires = want.last() == Some(&point);
            assert_eq!(
                fires,
                !(published && point == FaultPoint::AfterRestorePublishRename),
                "{label}"
            );
            let renamed = published || point != FaultPoint::BeforeRestoreRecheck;
            {
                let (manager, trace) = open_traced(dir.path(), Some(point));
                assert_eq!(*trace.borrow(), want, "{label}");
                if fires {
                    // No catalog write and no poison: Validated and non-ready.
                    assert_eq!(catalog_bytes(dir.path()), bytes, "{label}");
                    assert_eq!(record(&manager, "B").phase, Phase::Validated, "{label}");
                    assert_eq!(
                        manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
                        Some(CatalogError::NotReady),
                        "{label}"
                    );
                } else {
                    assert_eq!(record(&manager, "B").phase, Phase::Closed, "{label}");
                }
                assert_eq!(public.exists(), renamed, "{label}");
                assert_eq!(staged.exists(), !renamed, "{label}");
                assert_eq!(evidence(dir.path(), &manager), before, "{label}");
            }
            let (manager, trace) = open_traced(dir.path(), None);
            let again = if fires {
                settled_trace(renamed)
            } else {
                Vec::new()
            };
            assert_eq!(*trace.borrow(), again, "{label}");
            assert_settled(dir.path(), &manager, &before);
        }
    }
}

fn drift_quad() -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:s"),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:drift"),
        GraphName::DefaultGraph,
    )
}

/// A valid writable change of a candidate store in place: same directory inode. File
/// modes are then normalized to owner-only, so a mode guard is not what differs.
fn drift(store: &Path, change: impl FnOnce(&Store)) {
    {
        let opened = Store::open(store).unwrap();
        change(&opened);
        opened.flush().unwrap();
    }
    for file in children(store) {
        if fs::symlink_metadata(&file).unwrap().is_file() {
            fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }
}

/// Replaces the first of exactly `occurrences` matches in the catalog body and
/// re-frames it with a fresh checksum, keeping the canonical encoding.
fn rewrite_catalog(path: &Path, old: &str, new: &str, occurrences: usize) {
    let bytes = String::from_utf8(catalog_bytes(path)).unwrap();
    let body = bytes.splitn(3, '\n').nth(2).unwrap();
    assert_eq!(body.matches(old).count(), occurrences, "{old}");
    let body = body.replacen(old, new, 1);
    let checksum: String = Sha256::digest(body.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    fs::write(
        path.join("catalog"),
        format!("oxigraph-catalog-v1\n{checksum}\n{body}"),
    )
    .unwrap();
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Tamper {
    /// A valid RDF change written in place: same directory inode.
    Content,
    /// Equal RDF; only the physical sequence and governed lineage state advance.
    Metadata,
    /// The restore record's bound source generation no longer matches the source.
    RestoreRecord,
    /// The source tombstone's backup binding no longer matches the restore record.
    TombstoneBinding,
}

#[test]
fn validated_restart_fails_definite_symlink_and_package_layout_damage() {
    let _guard = shared();
    for published in [false, true] {
        for package_damage in [false, true] {
            let dir = root();
            validated_restore(dir.path(), published);
            let (staged, public) = candidate_paths(dir.path());
            let store = if published { &public } else { &staged };
            let outside = root();
            let target = outside.path().join("sentinel");
            fs::write(&target, b"must remain untouched").unwrap();
            let package = children(&dir.path().join("backups")).remove(0);
            let damaged = if package_damage {
                let path = package.join("unexpected");
                fs::write(&path, b"x").unwrap();
                fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
                assert!(matches!(
                    BackupReceipt::verify(&package, &TransactionStartControl::new()),
                    Err(BackupError::InvalidPath)
                ));
                path
            } else {
                let path = store.join("unexpected.sst");
                symlink(&target, &path).unwrap();
                path
            };
            let generation = catalog_json(dir.path())["generation"].as_u64().unwrap();
            let (manager, trace) = open_traced(dir.path(), None);
            assert_eq!(record(&manager, "B").phase, Phase::Failed);
            assert_eq!(manager.catalog_generation(), generation + 1);
            // Reconciliation also verifies A; no hook count is a native-open counter for B.
            assert!(
                !trace
                    .borrow()
                    .contains(&FaultPoint::AfterRestorePublishRename)
            );
            assert!(
                !trace
                    .borrow()
                    .contains(&FaultPoint::AfterRestorePublishSynced)
            );
            assert_eq!(
                manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
                Some(CatalogError::NotReady)
            );
            assert_eq!(staged.exists(), !published);
            assert_eq!(public.exists(), published);
            assert!(fs::symlink_metadata(&damaged).is_ok());
            assert_eq!(fs::read(&target).unwrap(), b"must remain untouched");
            let bytes = catalog_bytes(dir.path());
            manager.reconcile().unwrap();
            assert_eq!(catalog_bytes(dir.path()), bytes);
        }
    }
}

#[test]
fn validated_restart_fails_socket_and_missing_completed_receipt_source() {
    let _guard = shared();
    for published in [false, true] {
        for missing_source in [false, true] {
            let dir = root();
            validated_restore(dir.path(), published);
            let (staged, public) = candidate_paths(dir.path());
            let store = if published { &public } else { &staged };
            let saved = root();
            let marker = restore_attempt(dir.path(), "B").join("oxigraph-backup.source");
            let socket = store.join("unexpected.sock");
            if missing_source {
                fs::rename(&marker, saved.path().join("source")).unwrap();
                assert!(
                    matches!(RestoreReceipt::read(restore_attempt(dir.path(), "B")), Err(RestoreError::Backup(BackupError::Io(error))) if error.kind() == std::io::ErrorKind::NotFound)
                );
            } else {
                drop(std::os::unix::net::UnixListener::bind(&socket).unwrap());
            }
            let generation = catalog_json(dir.path())["generation"].as_u64().unwrap();
            let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
            assert_eq!(record(&manager, "B").phase, Phase::Failed);
            assert_eq!(manager.catalog_generation(), generation + 1);
            assert_eq!(
                manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
                Some(CatalogError::NotReady)
            );
            assert_eq!(staged.exists(), !published);
            assert_eq!(public.exists(), published);
            if missing_source {
                assert!(saved.path().join("source").is_file());
            } else {
                assert!(fs::symlink_metadata(&socket).is_ok());
            }
            let bytes = catalog_bytes(dir.path());
            manager.reconcile().unwrap();
            assert_eq!(catalog_bytes(dir.path()), bytes);
            drop(manager);
            drop(RepositoryManager::open(dir.path(), limits()).unwrap());
            assert_eq!(catalog_bytes(dir.path()), bytes);
        }
    }
}

#[test]
fn validated_restart_refuses_same_inode_drift_and_changed_provenance_in_both_windows() {
    let _guard = shared();
    for published in [false, true] {
        for tamper in [
            Tamper::Content,
            Tamper::Metadata,
            Tamper::RestoreRecord,
            Tamper::TombstoneBinding,
        ] {
            let label = format!("{tamper:?} published={published}");
            let dir = root();
            let before = validated_restore(dir.path(), published);
            let (staged, public) = candidate_paths(dir.path());
            let store = if published {
                public.clone()
            } else {
                staged.clone()
            };
            let inode = fs::metadata(&store).unwrap().ino();
            // Independent oracle: the library's current-primary check of the exact
            // completion receipt, which accepts the untouched candidate.
            let receipt = RestoreReceipt::read(restore_attempt(dir.path(), "B")).unwrap();
            let control = TransactionStartControl::new();
            receipt.verify_current_primary(&store, &control).unwrap();
            assert_eq!(contents(&store), expected(), "{label}");
            match tamper {
                Tamper::Content => {
                    drift(&store, |opened| opened.insert(drift_quad()).unwrap());
                    assert!(contents(&store).0.contains(&drift_quad()), "{label}");
                    assert!(
                        matches!(
                            receipt.verify_current_primary(&store, &control),
                            Err(RestoreError::StateMismatch)
                        ),
                        "{label}"
                    );
                }
                Tamper::Metadata => {
                    drift(&store, |opened| {
                        drop(
                            opened
                                .start_governed_transaction(
                                    TransactionRequest::default(),
                                    TransactionKey::new([9; 16]),
                                )
                                .unwrap()
                                .into_transaction()
                                .commit()
                                .unwrap(),
                        );
                    });
                    // Equal RDF alone is not a match: the helper refuses the new state.
                    assert_eq!(contents(&store), expected(), "{label}");
                    assert!(
                        matches!(
                            receipt.verify_current_primary(&store, &control),
                            Err(RestoreError::StateMismatch)
                        ),
                        "{label}"
                    );
                }
                Tamper::RestoreRecord => {
                    let generation = before.info.generation();
                    assert!(generation > 1, "{label}");
                    rewrite_catalog(
                        dir.path(),
                        &format!("\"source_generation\":{generation},"),
                        &format!("\"source_generation\":{},", generation - 1),
                        1,
                    );
                    // The store itself still matches: only provenance changed.
                    receipt.verify_current_primary(&store, &control).unwrap();
                }
                Tamper::TombstoneBinding => {
                    let catalog = catalog_json(dir.path());
                    assert_eq!(catalog["entries"][0]["id"], "A", "{label}");
                    let sequence = catalog["entries"][0]["tombstone"]["backup"]["sequence"]
                        .as_u64()
                        .unwrap();
                    // The first match is A's tombstone binding; B's record keeps its own.
                    rewrite_catalog(
                        dir.path(),
                        &format!("\"sequence\":{sequence},"),
                        &format!("\"sequence\":{},", sequence + 1),
                        2,
                    );
                    receipt.verify_current_primary(&store, &control).unwrap();
                }
            }
            assert_eq!(fs::metadata(&store).unwrap().ino(), inode, "{label}");
            let generation = catalog_json(dir.path())["generation"].as_u64().unwrap();
            let (manager, trace) = open_traced(dir.path(), None);
            // Drift is caught by the candidate proof after the recheck; changed provenance
            // is refused before it. Either way the only write is Failed, never Closed.
            let mut want = Vec::new();
            if matches!(tamper, Tamper::Content | Tamper::Metadata) {
                want.extend([
                    FaultPoint::BeforeRestoreRecheck,
                    FaultPoint::BeforeVerification,
                ]);
            }
            want.extend(WRITE);
            assert_eq!(*trace.borrow(), want, "{label}");
            assert_eq!(record(&manager, "B").phase, Phase::Failed, "{label}");
            assert_eq!(manager.catalog_generation(), generation + 1, "{label}");
            assert_eq!(
                manager.open_repository(&id("B"), OpenMode::ReadOnly).err(),
                Some(CatalogError::NotReady),
                "{label}"
            );
            // Nothing is renamed, adopted or deleted.
            assert_eq!(staged.exists(), !published, "{label}");
            assert_eq!(public.exists(), published, "{label}");
            assert_eq!(fs::metadata(&store).unwrap().ino(), inode, "{label}");
            assert!(manager.orphan_inventory().unwrap().is_empty(), "{label}");
            assert_eq!(evidence(dir.path(), &manager), before, "{label}");
            let bytes = catalog_bytes(dir.path());
            manager.reconcile().unwrap();
            assert_eq!(catalog_bytes(dir.path()), bytes, "{label}");
            drop(manager);
            drop(RepositoryManager::open(dir.path(), limits()).unwrap());
            assert_eq!(catalog_bytes(dir.path()), bytes, "{label}");
        }
    }
}

/// Installs a seccomp filter on the calling thread of an isolated child only: every
/// later `fsync(2)` of that thread returns `EIO` without reaching the filesystem.
/// Other threads and processes are unaffected; the filter is never removed. Returns
/// false where it cannot be installed.
fn fail_fsync_on_this_thread() -> bool {
    #[cfg(target_arch = "x86_64")]
    const AUDIT_ARCH: Option<u32> = Some(0xC000_003E);
    #[cfg(target_arch = "aarch64")]
    const AUDIT_ARCH: Option<u32> = Some(0xC000_00B7);
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    const AUDIT_ARCH: Option<u32> = None;
    #[repr(C)]
    struct Instruction {
        code: u16,
        jt: u8,
        jf: u8,
        k: u32,
    }
    #[repr(C)]
    struct Program {
        len: u16,
        filter: *const Instruction,
    }
    let Some(arch) = AUDIT_ARCH else {
        return false;
    };
    let (Ok(fsync), Ok(eio)) = (u32::try_from(libc::SYS_fsync), u32::try_from(libc::EIO)) else {
        return false;
    };
    // BPF_LD|BPF_W|BPF_ABS = 0x20, BPF_JMP|BPF_JEQ|BPF_K = 0x15, BPF_RET|BPF_K = 0x06.
    let filter = [
        // seccomp_data.arch: any other ABI is allowed unchanged.
        Instruction {
            code: 0x20,
            jt: 0,
            jf: 0,
            k: 4,
        },
        Instruction {
            code: 0x15,
            jt: 0,
            jf: 3,
            k: arch,
        },
        // seccomp_data.nr: fsync gets SECCOMP_RET_ERRNO|EIO, all else SECCOMP_RET_ALLOW.
        Instruction {
            code: 0x20,
            jt: 0,
            jf: 0,
            k: 0,
        },
        Instruction {
            code: 0x15,
            jt: 0,
            jf: 1,
            k: fsync,
        },
        Instruction {
            code: 0x06,
            jt: 0,
            jf: 0,
            k: 0x0005_0000 | eio,
        },
        Instruction {
            code: 0x06,
            jt: 0,
            jf: 0,
            k: 0x7fff_0000,
        },
    ];
    let program = Program {
        len: 6,
        filter: filter.as_ptr(),
    };
    let (zero, one, mode_filter): (libc::c_ulong, libc::c_ulong, libc::c_ulong) = (0, 1, 2);
    // SAFETY: both prctl calls are synchronous; the kernel copies the filter program,
    // which outlives the call. The filter binds only this isolated child's thread.
    #[expect(unsafe_code)]
    let installed = unsafe {
        libc::prctl(libc::PR_SET_NO_NEW_PRIVS, one, zero, zero, zero) == 0
            && libc::prctl(
                libc::PR_SET_SECCOMP,
                mode_filter,
                std::ptr::from_ref(&program) as usize as libc::c_ulong,
                zero,
                zero,
            ) == 0
    };
    installed
}

#[test]
fn restore_restart_child() {
    let Ok(path) = std::env::var("OX_RESTORE_RESTART_ROOT") else {
        return; // An ordinary run: only the parent tests re-invoke this.
    };
    let at: usize = std::env::var("OX_RESTORE_RESTART_AT")
        .unwrap()
        .parse()
        .unwrap();
    let point = RESTART[at];
    let fsync = match std::env::var("OX_RESTORE_RESTART_FAULT").unwrap().as_str() {
        "exit" => false,
        "fsync" => true,
        other => panic!("unknown fault {other}"),
    };
    let armed = Rc::new(Cell::new(false));
    let flag = Rc::clone(&armed);
    let opened = RepositoryManager::open_with_hook(Path::new(&path), limits(), move |actual| {
        if actual == point {
            if !fsync {
                std::process::exit(73);
            }
            if !flag.get() {
                if !fail_fsync_on_this_thread() {
                    std::process::exit(76);
                }
                flag.set(true);
            }
        } else if flag.get() && actual == FaultPoint::AfterRestorePublishSynced {
            // A parent sync reported success although every fsync was failing.
            std::process::exit(75);
        }
        Ok(())
    });
    let code = match opened {
        Ok(manager) if fsync && armed.get() && record(&manager, "B").phase == Phase::Validated => {
            if manager
                .list()
                .unwrap()
                .iter()
                .any(|entry| entry.id == id("C"))
            {
                drop(
                    manager
                        .open_repository(&id("C"), OpenMode::ReadOnly)
                        .unwrap(),
                );
            }
            74
        }
        _ => 75,
    };
    std::process::exit(code);
}

fn restart_child(path: &Path, point: FaultPoint, fault: &str) -> ChildGuard {
    let at = RESTART.iter().position(|actual| *actual == point).unwrap();
    ChildGuard(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "restore_restart_child", "--nocapture"])
            .env("OX_RESTORE_RESTART_ROOT", path)
            .env("OX_RESTORE_RESTART_AT", at.to_string())
            .env("OX_RESTORE_RESTART_FAULT", fault)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    )
}

#[test]
fn process_exit_at_each_restart_hook_keeps_validated_until_a_clean_restart() {
    let _guard = exclusive();
    for published in [false, true] {
        for point in RESTART {
            if published && point == FaultPoint::AfterRestorePublishRename {
                // Never fires for a published candidate; see the injected-hook test.
                continue;
            }
            let label = format!("{point:?} published={published}");
            let dir = root();
            let before = validated_restore(dir.path(), published);
            let (staged, public) = candidate_paths(dir.path());
            let bytes = catalog_bytes(dir.path());
            let status = reap(&mut restart_child(dir.path(), point, "exit"));
            assert_eq!(status.code(), Some(73), "{label}");
            assert_eq!(catalog_bytes(dir.path()), bytes, "{label}");
            let renamed = published || point != FaultPoint::BeforeRestoreRecheck;
            assert_eq!(public.exists(), renamed, "{label}");
            assert_eq!(staged.exists(), !renamed, "{label}");
            let (manager, trace) = open_traced(dir.path(), None);
            assert_eq!(*trace.borrow(), settled_trace(renamed), "{label}");
            assert_settled(dir.path(), &manager, &before);
        }
    }
}

/// Exit codes of `restore_restart_child` in fsync mode: 74 the filter was installed and
/// restart kept B `Validated`; 75 any other outcome; 76 seccomp could not be installed.
#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[test]
fn real_fsync_error_after_restart_rename_keeps_validated_until_a_resynced_recovery() {
    let _guard = exclusive();
    let dir = root();
    let before = validated_restore(dir.path(), false);
    let (staged, public) = candidate_paths(dir.path());
    let bytes = catalog_bytes(dir.path());
    // The child renames the staged candidate; its next fsync, of the repos/ parent,
    // returns EIO. The rename is visible, its durability unknown: no Closed is written.
    let status = reap(&mut restart_child(
        dir.path(),
        FaultPoint::AfterRestorePublishRename,
        "fsync",
    ));
    assert_eq!(status.code(), Some(74), "76: seccomp unavailable");
    assert_eq!(catalog_bytes(dir.path()), bytes);
    assert_eq!(phase_in_catalog(dir.path(), "B"), "Validated");
    assert!(public.is_dir());
    assert!(!staged.exists());
    // Published window: every fsync of the recovering thread fails from the recheck on.
    // Some fsync on that path failed, so Closed was not written.
    let status = reap(&mut restart_child(
        dir.path(),
        FaultPoint::BeforeRestoreRecheck,
        "fsync",
    ));
    assert_eq!(status.code(), Some(74), "76: seccomp unavailable");
    assert_eq!(catalog_bytes(dir.path()), bytes);
    assert!(public.is_dir());
    assert!(!staged.exists());
    // Clean recovery re-proves the candidate and only after both parent syncs returned
    // (synthetic `AfterRestorePublishSynced` marker, not a syscall proof) writes Closed.
    let (manager, trace) = open_traced(dir.path(), None);
    assert_eq!(*trace.borrow(), settled_trace(true));
    assert_settled(dir.path(), &manager, &before);
}

#[cfg(any(target_arch = "x86_64", target_arch = "aarch64"))]
#[test]
fn reserved_restart_parent_fsync_error_preserves_unrelated_access() {
    let _guard = exclusive();
    let dir = root();
    let before = reserved_restore_with_unrelated_repository(dir.path());
    let status = reap(&mut restart_child(
        dir.path(),
        FaultPoint::AfterRestorePublishRename,
        "fsync",
    ));
    assert_eq!(status.code(), Some(74), "76: seccomp unavailable");
    assert_eq!(phase_in_catalog(dir.path(), "B"), "Validated");
    let (staged, public) = candidate_paths(dir.path());
    assert!(!staged.exists());
    assert!(public.is_dir());
    let manager = RepositoryManager::open(dir.path(), limits()).unwrap();
    assert_settled(dir.path(), &manager, &before);
    drop(
        manager
            .open_repository(&id("C"), OpenMode::ReadOnly)
            .unwrap(),
    );
}
