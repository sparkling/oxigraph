#![cfg(target_os = "linux")]
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph::store::Store;
use oxigraph_cli::catalog::{
    CatalogError, FaultPoint, ManagerLimits, Phase, QuiesceReceipt, RepositoryManager,
};
use oxigraph_cli::repository::{OpenMode, RepositoryId};
use sha2::{Digest, Sha256};
use std::cell::{Cell, RefCell};
use std::error::Error;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::rc::Rc;
use std::sync::{PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, Instant};

type Test = Result<(), Box<dyn Error>>;

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

fn limits() -> ManagerLimits {
    ManagerLimits {
        repositories: 4,
        catalog_bytes: 65536,
        scan_entries: 128,
        open_handles: 2,
        store_files: 128,
        model_retention: 1,
        model_max_generation: 100,
    }
}
fn id(value: &str) -> RepositoryId {
    RepositoryId::parse(value).unwrap()
}
fn quad(n: u32) -> Quad {
    Quad::new(
        NamedNode::new_unchecked(format!("urn:s:{n}")),
        NamedNode::new_unchecked("urn:p"),
        NamedNode::new_unchecked("urn:o"),
        GraphName::DefaultGraph,
    )
}
fn root() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
    dir
}
fn database(root: &Path) -> PathBuf {
    fs::read_dir(root.join("repos"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
}
fn file_bytes(path: &Path) -> Vec<(std::ffi::OsString, Vec<u8>)> {
    let mut files = fs::read_dir(path)
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            (entry.file_name(), fs::read(entry.path()).unwrap())
        })
        .collect::<Vec<_>>();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files
}
fn generation_of(manager: &RepositoryManager, name: &str) -> u64 {
    manager
        .list()
        .unwrap()
        .into_iter()
        .find(|record| record.id == id(name))
        .unwrap()
        .changed_at
}
fn phase(manager: &RepositoryManager, name: &str) -> Phase {
    manager
        .list()
        .unwrap()
        .into_iter()
        .find(|record| record.id == id(name))
        .unwrap()
        .phase
}
fn begin(manager: &RepositoryManager, name: &str) -> QuiesceReceipt {
    manager
        .begin_quiesce(&id(name), generation_of(manager, name))
        .unwrap()
}
fn catalog_path(dir: &Path) -> PathBuf {
    dir.join("catalog")
}

/// Creates repository A holding one flushed quad, then releases the manager.
fn prepared(path: &Path) {
    let mut manager = RepositoryManager::open(path, limits()).unwrap();
    manager.create(id("A"), 1).unwrap();
    let handle = manager
        .open_repository(&id("A"), OpenMode::ReadWrite)
        .unwrap();
    handle.insert(quad(1)).unwrap();
    handle.flush().unwrap();
}

/// Idempotent begin, complete, then prove terminal Closed state and preserved RDF.
fn finish_and_verify(manager: &RepositoryManager) {
    let receipt = begin(manager, "A");
    assert_eq!(receipt.phase(), Phase::Quiescing);
    let done = manager.complete_quiesce(&id("A"), &receipt).unwrap();
    assert_eq!(done.phase(), Phase::Closed);
    assert_eq!(phase(manager, "A"), Phase::Closed);
    let handle = manager
        .open_repository(&id("A"), OpenMode::ReadOnly)
        .unwrap();
    assert!(handle.contains(&quad(1)).unwrap());
}

fn write_catalog_text(dir: &Path, body: &str) {
    let checksum: String = Sha256::digest(body.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    fs::write(
        catalog_path(dir),
        format!("oxigraph-catalog-v1\n{checksum}\n{body}"),
    )
    .unwrap();
}
fn catalog_body(dir: &Path) -> String {
    let text = fs::read_to_string(catalog_path(dir)).unwrap();
    text.splitn(3, '\n').nth(2).unwrap().to_owned()
}
/// Keeps the canonical field order: textual replacement, never a JSON round trip.
fn set_generation_max(dir: &Path) {
    let body = catalog_body(dir);
    let value: serde_json::Value = serde_json::from_str(&body).unwrap();
    let current = value["generation"].as_u64().unwrap();
    let changed = body.replacen(
        &format!("\"generation\":{current}"),
        &format!("\"generation\":{}", u64::MAX),
        1,
    );
    assert_ne!(changed, body);
    write_catalog_text(dir, &changed);
}
fn without_evidence(body: &str) -> String {
    let start = body.find(r#""evidence":{"#).unwrap();
    let end = start + body[start..].find('}').unwrap() + 1;
    format!("{}\"evidence\":null{}", &body[..start], &body[end..])
}

fn reap(child: &mut Child) -> ExitStatus {
    let end = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        if Instant::now() >= end {
            let _ = child.kill();
            let _ = child.wait();
            panic!("child exceeded bound");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Kills and reaps its child on every path, including a parent panic.
struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// ---------------------------------------------------------------- data

#[test]
fn real_disk_data_survives_begin_drain_complete_reopen() -> Test {
    let _guard = shared();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    {
        let handle = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
        handle.insert(quad(1))?;
        handle.flush()?;
        handle.insert(quad(2))?;
    }
    let before = manager.catalog_generation();
    let receipt = begin(&manager, "A");
    assert_eq!(receipt.phase(), Phase::Quiescing);
    assert_eq!(receipt.id(), &id("A"));
    assert_eq!(receipt.generation(), before + 1);
    assert_eq!(receipt.catalog_generation(), before + 1);
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    assert_eq!(
        manager.open_repository(&id("A"), OpenMode::ReadWrite).err(),
        Some(CatalogError::NotReady)
    );
    let done = manager.complete_quiesce(&id("A"), &receipt)?;
    assert_eq!(done.phase(), Phase::Closed);
    assert_eq!(done.catalog_generation(), before + 2);
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    drop(manager);
    let manager = RepositoryManager::open(dir.path(), limits())?;
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    let handle = manager.open_repository(&id("A"), OpenMode::ReadOnly)?;
    assert!(handle.contains(&quad(1))?);
    assert!(handle.contains(&quad(2))?);
    assert!(!handle.contains(&quad(3))?);
    Ok(())
}

#[test]
fn live_handle_is_fenced_before_the_store_and_completion_waits_for_actual_drop() -> Test {
    let _guard = shared();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    let handle = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
    handle.insert(quad(1))?;
    handle.flush()?;
    let snapshot = handle.snapshot();
    let receipt = begin(&manager, "A");
    assert_eq!(
        handle.contains(&quad(1)).unwrap_err(),
        CatalogError::Quiescing
    );
    assert_eq!(handle.insert(quad(2)).unwrap_err(), CatalogError::Quiescing);
    assert_eq!(handle.flush().unwrap_err(), CatalogError::Quiescing);
    assert_eq!(handle.snapshot(), snapshot);
    let bytes = fs::read(catalog_path(dir.path()))?;
    assert_eq!(
        manager.complete_quiesce(&id("A"), &receipt).unwrap_err(),
        CatalogError::Busy
    );
    assert_eq!(fs::read(catalog_path(dir.path()))?, bytes);
    assert_eq!(
        manager.open_repository(&id("A"), OpenMode::ReadOnly).err(),
        Some(CatalogError::NotReady)
    );
    assert!(Store::open(database(dir.path())).is_err());
    drop(handle);
    let done = manager.complete_quiesce(&id("A"), &receipt)?;
    assert_eq!(done.phase(), Phase::Closed);
    let handle = manager.open_repository(&id("A"), OpenMode::ReadOnly)?;
    assert!(handle.contains(&quad(1))?);
    // The fenced write never reached the store.
    assert!(!handle.contains(&quad(2))?);
    Ok(())
}

#[test]
fn read_only_handle_is_fenced_too() -> Test {
    let _guard = shared();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    let handle = manager.open_repository(&id("A"), OpenMode::ReadOnly)?;
    let receipt = begin(&manager, "A");
    assert_eq!(
        handle.contains(&quad(1)).unwrap_err(),
        CatalogError::Quiescing
    );
    assert_eq!(handle.flush().unwrap_err(), CatalogError::Quiescing);
    drop(handle);
    manager.complete_quiesce(&id("A"), &receipt)?;
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    Ok(())
}

#[test]
fn one_repository_quiescing_never_blocks_another() -> Test {
    let _guard = shared();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    manager.create(id("B"), manager.catalog_generation())?;
    let ha = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
    let hb = manager.open_repository(&id("B"), OpenMode::ReadWrite)?;
    hb.insert(quad(10))?;
    hb.flush()?;
    let ra = begin(&manager, "A");
    assert_eq!(ha.contains(&quad(1)).unwrap_err(), CatalogError::Quiescing);
    hb.insert(quad(11))?;
    assert!(hb.contains(&quad(11))?);
    hb.flush()?;
    drop(hb);
    let rb = begin(&manager, "B");
    manager.complete_quiesce(&id("B"), &rb)?;
    assert_eq!(phase(&manager, "B"), Phase::Closed);
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    assert_eq!(
        manager.complete_quiesce(&id("A"), &ra).unwrap_err(),
        CatalogError::Busy
    );
    assert_eq!(phase(&manager, "B"), Phase::Closed);
    let hb = manager.open_repository(&id("B"), OpenMode::ReadOnly)?;
    assert!(hb.contains(&quad(10))?);
    assert!(hb.contains(&quad(11))?);
    drop(hb);
    drop(ha);
    manager.complete_quiesce(&id("A"), &ra)?;
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    Ok(())
}

#[test]
fn quiescing_store_over_file_ceiling_never_blocks_restart_or_another_repository() -> Test {
    let _guard = shared();
    let dir = root();
    let (receipt, a_db) = {
        let mut manager = RepositoryManager::open(dir.path(), limits())?;
        manager.create(id("A"), 1)?;
        let a_db = database(dir.path());
        {
            let handle = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
            handle.insert(quad(1))?;
            handle.flush()?;
        }
        manager.create(id("B"), manager.catalog_generation())?;
        (begin(&manager, "A"), a_db)
    };
    // The internal UUID names the store directory and must never leak via Debug.
    let uuid = a_db.file_name().unwrap().to_str().unwrap().to_owned();
    assert!(!format!("{receipt:?}").contains(&uuid));
    // Documented growth beyond the verification ceiling while Quiescing.
    let extras: Vec<PathBuf> = (0..limits().store_files)
        .map(|i| a_db.join(format!("extra-{i}")))
        .collect();
    for path in &extras {
        fs::write(path, b"retained")?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    let catalog = fs::read(catalog_path(dir.path()))?;
    let store_bytes = file_bytes(&a_db);
    // Restart succeeds: a capacity refusal does not disprove identity.
    let manager = RepositoryManager::open(dir.path(), limits())?;
    assert_eq!(fs::read(catalog_path(dir.path()))?, catalog);
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    assert_eq!(phase(&manager, "B"), Phase::Closed);
    {
        let hb = manager.open_repository(&id("B"), OpenMode::ReadWrite)?;
        hb.insert(quad(10))?;
        hb.flush()?;
        assert!(hb.contains(&quad(10))?);
    }
    let catalog = fs::read(catalog_path(dir.path()))?;
    assert_eq!(
        manager.complete_quiesce(&id("A"), &receipt).unwrap_err(),
        CatalogError::Limit
    );
    assert_eq!(fs::read(catalog_path(dir.path()))?, catalog);
    assert_eq!(file_bytes(&a_db), store_bytes);
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    assert_eq!(
        manager.open_repository(&id("A"), OpenMode::ReadOnly).err(),
        Some(CatalogError::NotReady)
    );
    // Refusal is not poisoning: once the operator removes its own extras, the
    // original receipt still completes and the RDF is preserved.
    for path in &extras {
        fs::remove_file(path)?;
    }
    let done = manager.complete_quiesce(&id("A"), &receipt)?;
    assert_eq!(done.phase(), Phase::Closed);
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    let ha = manager.open_repository(&id("A"), OpenMode::ReadOnly)?;
    assert!(ha.contains(&quad(1))?);
    Ok(())
}

#[test]
fn another_repository_change_does_not_stale_a_receipt() -> Test {
    let _guard = shared();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    let receipt = begin(&manager, "A");
    manager.create(id("C"), manager.catalog_generation())?;
    assert_ne!(manager.catalog_generation(), receipt.catalog_generation());
    manager.complete_quiesce(&id("A"), &receipt)?;
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    assert_eq!(phase(&manager, "C"), Phase::Closed);
    assert!(
        manager
            .open_repository(&id("C"), OpenMode::ReadOnly)
            .is_ok()
    );
    Ok(())
}

// ---------------------------------------------------------------- refusals

#[test]
fn refusals_are_explicit_and_leave_state_unchanged() -> Test {
    let _guard = shared();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    manager.create(id("B"), manager.catalog_generation())?;
    let generation = generation_of(&manager, "A");
    for stale in [generation - 1, generation + 1] {
        assert_eq!(
            manager.begin_quiesce(&id("A"), stale).unwrap_err(),
            CatalogError::Conflict
        );
    }
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    assert_eq!(
        manager.begin_quiesce(&id("nope"), 1).unwrap_err(),
        CatalogError::NotFound
    );
    let ra = begin(&manager, "A");
    assert_eq!(
        manager.complete_quiesce(&id("nope"), &ra).unwrap_err(),
        CatalogError::NotFound
    );
    // Cross-repository intent: neither receipt can act on the other repository.
    let rb = begin(&manager, "B");
    assert_eq!(
        manager.complete_quiesce(&id("B"), &ra).unwrap_err(),
        CatalogError::Conflict
    );
    assert_eq!(
        manager.complete_quiesce(&id("A"), &rb).unwrap_err(),
        CatalogError::Conflict
    );
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    assert_eq!(phase(&manager, "B"), Phase::Quiescing);
    // Idempotent begin: no write, same entry generation. The informational catalog
    // generation reflects B's later transition.
    let bytes = fs::read(catalog_path(dir.path()))?;
    let again = manager.begin_quiesce(&id("A"), ra.generation())?;
    assert_eq!(again.id(), ra.id());
    assert_eq!(again.phase(), ra.phase());
    assert_eq!(again.generation(), ra.generation());
    assert_eq!(again.catalog_generation(), manager.catalog_generation());
    assert_eq!(fs::read(catalog_path(dir.path()))?, bytes);
    // Repeated completion is a conflict and the terminal state stays Closed.
    let done = manager.complete_quiesce(&id("A"), &ra)?;
    assert_eq!(done.phase(), Phase::Closed);
    assert_eq!(
        manager.complete_quiesce(&id("A"), &ra).unwrap_err(),
        CatalogError::Conflict
    );
    assert_eq!(
        manager.complete_quiesce(&id("A"), &done).unwrap_err(),
        CatalogError::Conflict
    );
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    // A receipt of an earlier quiesce cycle cannot act on a later one.
    let later = begin(&manager, "A");
    assert_ne!(later.generation(), ra.generation());
    assert_eq!(
        manager.complete_quiesce(&id("A"), &ra).unwrap_err(),
        CatalogError::Conflict
    );
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    manager.complete_quiesce(&id("A"), &later)?;
    manager.complete_quiesce(&id("B"), &rb)?;
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    assert_eq!(phase(&manager, "B"), Phase::Closed);
    Ok(())
}

#[test]
fn receipt_from_another_root_with_same_id_and_generation_is_refused() -> Test {
    let _guard = shared();
    let (x, y) = (root(), root());
    let mut mx = RepositoryManager::open(x.path(), limits())?;
    let mut my = RepositoryManager::open(y.path(), limits())?;
    mx.create(id("A"), 1)?;
    my.create(id("A"), 1)?;
    let rx = begin(&mx, "A");
    let ry = begin(&my, "A");
    // Deterministic generations collide; only the internal entry UUID differs.
    assert_eq!(rx.id(), ry.id());
    assert_eq!(rx.phase(), ry.phase());
    assert_eq!(rx.generation(), ry.generation());
    assert_eq!(rx.catalog_generation(), ry.catalog_generation());
    assert_ne!(rx, ry);
    let bytes_y = fs::read(catalog_path(y.path()))?;
    assert_eq!(
        my.complete_quiesce(&id("A"), &rx).unwrap_err(),
        CatalogError::Conflict
    );
    assert_eq!(fs::read(catalog_path(y.path()))?, bytes_y);
    assert_eq!(phase(&my, "A"), Phase::Quiescing);
    let bytes_x = fs::read(catalog_path(x.path()))?;
    assert_eq!(
        mx.complete_quiesce(&id("A"), &ry).unwrap_err(),
        CatalogError::Conflict
    );
    assert_eq!(fs::read(catalog_path(x.path()))?, bytes_x);
    assert_eq!(phase(&mx, "A"), Phase::Quiescing);
    // Refusal is not poisoning: each root still completes with its own receipt.
    assert_eq!(my.complete_quiesce(&id("A"), &ry)?.phase(), Phase::Closed);
    assert_eq!(mx.complete_quiesce(&id("A"), &rx)?.phase(), Phase::Closed);
    assert_eq!(phase(&mx, "A"), Phase::Closed);
    assert_eq!(phase(&my, "A"), Phase::Closed);
    Ok(())
}

#[test]
fn failed_entry_cannot_begin_quiesce() -> Test {
    let _guard = shared();
    let dir = root();
    let mut manager = RepositoryManager::open(
        dir.path(),
        ManagerLimits {
            store_files: 1,
            ..limits()
        },
    )?;
    assert!(manager.create(id("A"), 1).is_err());
    assert_eq!(phase(&manager, "A"), Phase::Failed);
    let generation = generation_of(&manager, "A");
    assert_eq!(
        manager.begin_quiesce(&id("A"), generation).unwrap_err(),
        CatalogError::NotReady
    );
    assert_eq!(phase(&manager, "A"), Phase::Failed);
    Ok(())
}

// ---------------------------------------------------------------- prewrite refusals

#[test]
fn generation_exhaustion_on_begin_refuses_before_write_without_poison_or_fence() -> Test {
    let _guard = shared();
    let dir = root();
    prepared(dir.path());
    set_generation_max(dir.path());
    let manager = RepositoryManager::open(dir.path(), limits())?;
    let handle = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
    let bytes = fs::read(catalog_path(dir.path()))?;
    let generation = generation_of(&manager, "A");
    assert_eq!(
        manager.begin_quiesce(&id("A"), generation).unwrap_err(),
        CatalogError::Limit
    );
    assert_eq!(fs::read(catalog_path(dir.path()))?, bytes);
    assert_eq!(phase(&manager, "A"), Phase::Closed);
    // No poison and no fence: the live handle still works.
    handle.insert(quad(2))?;
    assert!(handle.contains(&quad(2))?);
    Ok(())
}

#[test]
fn generation_exhaustion_on_complete_refuses_before_write_without_poison() -> Test {
    let _guard = shared();
    let dir = root();
    prepared(dir.path());
    let receipt = {
        let manager = RepositoryManager::open(dir.path(), limits())?;
        begin(&manager, "A")
    };
    set_generation_max(dir.path());
    let manager = RepositoryManager::open(dir.path(), limits())?;
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    let bytes = fs::read(catalog_path(dir.path()))?;
    assert_eq!(
        manager.complete_quiesce(&id("A"), &receipt).unwrap_err(),
        CatalogError::Limit
    );
    assert_eq!(fs::read(catalog_path(dir.path()))?, bytes);
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    let again = manager.begin_quiesce(&id("A"), receipt.generation())?;
    assert_eq!(again.generation(), receipt.generation());
    Ok(())
}

#[test]
fn scan_capacity_exhaustion_refuses_begin_and_complete_without_writing() -> Test {
    let _guard = shared();
    let bounded = ManagerLimits {
        scan_entries: 9,
        ..limits()
    };
    for completing in [false, true] {
        let dir = root();
        let mut manager = RepositoryManager::open(dir.path(), bounded)?;
        manager.create(id("A"), 1)?;
        let receipt = completing.then(|| begin(&manager, "A"));
        for i in 0..4 {
            fs::write(dir.path().join(format!("retained-{i}")), b"evidence")?;
        }
        let bytes = fs::read(catalog_path(dir.path()))?;
        let error = match &receipt {
            Some(receipt) => manager.complete_quiesce(&id("A"), receipt).unwrap_err(),
            None => manager
                .begin_quiesce(&id("A"), generation_of(&manager, "A"))
                .unwrap_err(),
        };
        assert_eq!(error, CatalogError::Limit);
        assert_eq!(fs::read(catalog_path(dir.path()))?, bytes);
        let expected = if completing {
            Phase::Quiescing
        } else {
            Phase::Closed
        };
        assert_eq!(phase(&manager, "A"), expected);
    }
    Ok(())
}

// ---------------------------------------------------------------- injected persistence faults

struct Probe {
    fail: Rc<Cell<Option<FaultPoint>>>,
    trace: Rc<RefCell<Vec<FaultPoint>>>,
}
fn probe() -> Probe {
    Probe {
        fail: Rc::new(Cell::new(None)),
        trace: Rc::new(RefCell::new(Vec::new())),
    }
}
fn open_probe(path: &Path, probe: &Probe) -> RepositoryManager {
    let fail = Rc::clone(&probe.fail);
    let trace = Rc::clone(&probe.trace);
    let manager = RepositoryManager::open_with_hook(path, limits(), move |point| {
        trace.borrow_mut().push(point);
        if fail.get() == Some(point) {
            Err(CatalogError::Injected)
        } else {
            Ok(())
        }
    })
    .unwrap();
    probe.trace.borrow_mut().clear();
    manager
}

#[test]
fn each_transition_has_exactly_the_five_catalog_write_boundaries() -> Test {
    let _guard = shared();
    let dir = root();
    prepared(dir.path());
    let probe = probe();
    let manager = open_probe(dir.path(), &probe);
    let receipt = begin(&manager, "A");
    assert_eq!(*probe.trace.borrow(), WRITE.to_vec());
    probe.trace.borrow_mut().clear();
    manager.complete_quiesce(&id("A"), &receipt)?;
    let mut expected = vec![FaultPoint::BeforeVerification];
    expected.extend_from_slice(&WRITE);
    assert_eq!(*probe.trace.borrow(), expected);
    Ok(())
}

#[test]
fn injected_begin_faults_poison_keep_the_fence_and_leave_the_exact_durable_phase() -> Test {
    let _guard = shared();
    let durable = [
        Phase::Closed,
        Phase::Closed,
        Phase::Closed,
        Phase::Quiescing,
        Phase::Quiescing,
    ];
    for (index, point) in WRITE.into_iter().enumerate() {
        let dir = root();
        prepared(dir.path());
        let probe = probe();
        {
            let manager = open_probe(dir.path(), &probe);
            let handle = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
            let generation = generation_of(&manager, "A");
            probe.trace.borrow_mut().clear();
            probe.fail.set(Some(point));
            assert_eq!(
                manager.begin_quiesce(&id("A"), generation).unwrap_err(),
                CatalogError::Injected
            );
            assert_eq!(*probe.trace.borrow(), WRITE[..=index].to_vec());
            assert_eq!(manager.list().unwrap_err(), CatalogError::Poisoned);
            assert_eq!(
                manager.begin_quiesce(&id("A"), generation).unwrap_err(),
                CatalogError::Poisoned
            );
            assert_eq!(
                handle.contains(&quad(1)).unwrap_err(),
                CatalogError::Quiescing
            );
            assert_eq!(handle.insert(quad(2)).unwrap_err(), CatalogError::Quiescing);
        }
        let manager = RepositoryManager::open(dir.path(), limits())?;
        assert_eq!(phase(&manager, "A"), durable[index], "point {index}");
        finish_and_verify(&manager);
        let handle = manager.open_repository(&id("A"), OpenMode::ReadOnly)?;
        assert!(!handle.contains(&quad(2))?);
    }
    Ok(())
}

#[test]
fn injected_complete_faults_poison_and_leave_the_exact_durable_phase() -> Test {
    let _guard = shared();
    let durable = [
        Phase::Quiescing,
        Phase::Quiescing,
        Phase::Quiescing,
        Phase::Closed,
        Phase::Closed,
    ];
    for (index, point) in WRITE.into_iter().enumerate() {
        let dir = root();
        prepared(dir.path());
        let probe = probe();
        {
            let manager = open_probe(dir.path(), &probe);
            let receipt = begin(&manager, "A");
            probe.trace.borrow_mut().clear();
            probe.fail.set(Some(point));
            assert_eq!(
                manager.complete_quiesce(&id("A"), &receipt).unwrap_err(),
                CatalogError::Injected
            );
            let mut expected = vec![FaultPoint::BeforeVerification];
            expected.extend_from_slice(&WRITE[..=index]);
            assert_eq!(*probe.trace.borrow(), expected);
            assert_eq!(manager.list().unwrap_err(), CatalogError::Poisoned);
            assert_eq!(
                manager.complete_quiesce(&id("A"), &receipt).unwrap_err(),
                CatalogError::Poisoned
            );
            assert_eq!(
                manager
                    .begin_quiesce(&id("A"), receipt.generation())
                    .unwrap_err(),
                CatalogError::Poisoned
            );
        }
        let manager = RepositoryManager::open(dir.path(), limits())?;
        assert_eq!(phase(&manager, "A"), durable[index], "point {index}");
        finish_and_verify(&manager);
    }
    Ok(())
}

#[test]
fn verification_refusal_on_complete_does_not_poison_and_retry_succeeds() -> Test {
    let _guard = shared();
    let dir = root();
    prepared(dir.path());
    let probe = probe();
    let manager = open_probe(dir.path(), &probe);
    let receipt = begin(&manager, "A");
    probe.trace.borrow_mut().clear();
    probe.fail.set(Some(FaultPoint::BeforeVerification));
    assert_eq!(
        manager.complete_quiesce(&id("A"), &receipt).unwrap_err(),
        CatalogError::Injected
    );
    assert_eq!(*probe.trace.borrow(), vec![FaultPoint::BeforeVerification]);
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    probe.fail.set(None);
    let done = manager.complete_quiesce(&id("A"), &receipt)?;
    assert_eq!(done.phase(), Phase::Closed);
    let handle = manager.open_repository(&id("A"), OpenMode::ReadOnly)?;
    assert!(handle.contains(&quad(1))?);
    Ok(())
}

// ---------------------------------------------------------------- processes

fn point_of(index: usize) -> FaultPoint {
    if index == 0 {
        FaultPoint::BeforeVerification
    } else {
        WRITE[index - 1]
    }
}

#[test]
fn quiesce_child() {
    let Ok(path) = std::env::var("OX_QUIESCE_ROOT") else {
        return; // An ordinary run: only the parent tests re-invoke this.
    };
    let step = std::env::var("OX_QUIESCE_STEP").unwrap();
    let point = point_of(
        std::env::var("OX_QUIESCE_POINT")
            .unwrap()
            .parse::<usize>()
            .unwrap(),
    );
    // Armed only after open: reconcile also verifies a durable Quiescing entry.
    let armed = Rc::new(Cell::new(false));
    let flag = Rc::clone(&armed);
    let manager = RepositoryManager::open_with_hook(&path, limits(), move |candidate| {
        if flag.get() && candidate == point {
            std::process::exit(73);
        }
        Ok(())
    })
    .unwrap();
    match step.as_str() {
        "begin" => {
            let generation = generation_of(&manager, "A");
            armed.set(true);
            let _ = manager.begin_quiesce(&id("A"), generation);
        }
        "complete" => {
            let receipt = begin(&manager, "A");
            armed.set(true);
            let _ = manager.complete_quiesce(&id("A"), &receipt);
        }
        "hold" => {
            let marker = std::env::var("OX_QUIESCE_MARKER").unwrap();
            let handle = manager
                .open_repository(&id("A"), OpenMode::ReadWrite)
                .unwrap();
            handle.insert(quad(2)).unwrap();
            handle.flush().unwrap();
            let receipt = begin(&manager, "A");
            assert_eq!(
                handle.contains(&quad(1)).unwrap_err(),
                CatalogError::Quiescing
            );
            fs::write(marker, receipt.generation().to_string()).unwrap();
            // Self-bounded: a parent that fails before its kill cannot leak this child.
            let end = Instant::now() + Duration::from_secs(60);
            while Instant::now() < end {
                std::thread::sleep(Duration::from_millis(50));
            }
            std::process::exit(74);
        }
        other => panic!("unknown step {other}"),
    }
    panic!("the child returned instead of exiting at its crash point");
}

fn spawn(root: &Path, step: &str, point: usize, marker: Option<&Path>) -> Child {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .arg("--exact")
        .arg("quiesce_child")
        .arg("--nocapture")
        .env("OX_QUIESCE_ROOT", root)
        .env("OX_QUIESCE_STEP", step)
        .env("OX_QUIESCE_POINT", point.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(marker) = marker {
        command.env("OX_QUIESCE_MARKER", marker);
    }
    command.spawn().unwrap()
}

#[test]
fn process_exit_during_begin_leaves_exact_recoverable_state() -> Test {
    let _guard = exclusive();
    let durable = [
        Phase::Closed,
        Phase::Closed,
        Phase::Closed,
        Phase::Quiescing,
        Phase::Quiescing,
    ];
    for (index, expected) in durable.into_iter().enumerate() {
        let dir = root();
        prepared(dir.path());
        let status = reap(&mut spawn(dir.path(), "begin", index + 1, None));
        assert_eq!(status.code(), Some(73), "begin point {index}");
        let manager = RepositoryManager::open(dir.path(), limits())?;
        assert_eq!(phase(&manager, "A"), expected, "begin point {index}");
        finish_and_verify(&manager);
    }
    Ok(())
}

#[test]
fn process_exit_during_complete_leaves_exact_recoverable_state() -> Test {
    let _guard = exclusive();
    // Point 0 is BeforeVerification; points 1..=5 are the catalog write boundaries.
    let durable = [
        Phase::Quiescing,
        Phase::Quiescing,
        Phase::Quiescing,
        Phase::Quiescing,
        Phase::Closed,
        Phase::Closed,
    ];
    for (index, expected) in durable.into_iter().enumerate() {
        let dir = root();
        prepared(dir.path());
        {
            let manager = RepositoryManager::open(dir.path(), limits())?;
            let _ = begin(&manager, "A");
        }
        let status = reap(&mut spawn(dir.path(), "complete", index, None));
        assert_eq!(status.code(), Some(73), "complete point {index}");
        let manager = RepositoryManager::open(dir.path(), limits())?;
        // Restart reconcile keeps a valid Quiescing entry; it never closes by phase alone.
        assert_eq!(phase(&manager, "A"), expected, "complete point {index}");
        finish_and_verify(&manager);
    }
    Ok(())
}

#[test]
fn killed_owner_with_a_live_handle_recovers_quiescing_and_completes() -> Test {
    let _guard = exclusive();
    let dir = root();
    prepared(dir.path());
    let marker_dir = root();
    let marker = marker_dir.path().join("ready");
    // Killed and reaped on every path, including a failed assertion below.
    let mut child = ChildGuard(spawn(dir.path(), "hold", 0, Some(&marker)));
    let end = Instant::now() + Duration::from_secs(30);
    while !marker.exists() {
        assert!(
            child.0.try_wait()?.is_none(),
            "holding child exited before becoming ready"
        );
        assert!(Instant::now() < end, "holding child did not become ready");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        RepositoryManager::open(dir.path(), limits()).err(),
        Some(CatalogError::Locked)
    );
    child.0.kill()?;
    let status = child.0.wait()?;
    // Killed by our signal, not by its own deadline exit.
    assert_eq!(status.code(), None);
    let manager = RepositoryManager::open(dir.path(), limits())?;
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    finish_and_verify(&manager);
    let handle = manager.open_repository(&id("A"), OpenMode::ReadOnly)?;
    assert!(handle.contains(&quad(2))?);
    Ok(())
}

#[test]
fn missing_or_swapped_materialization_after_quiescing_fails_closed() -> Test {
    let _guard = shared();
    for swapped in [false, true] {
        let dir = root();
        prepared(dir.path());
        let receipt = {
            let manager = RepositoryManager::open(dir.path(), limits())?;
            begin(&manager, "A")
        };
        let db = database(dir.path());
        let saved = root();
        let moved = saved.path().join("evidence");
        fs::rename(&db, &moved)?;
        let before = file_bytes(&moved);
        if swapped {
            fs::create_dir(&db)?;
            fs::set_permissions(&db, fs::Permissions::from_mode(0o700))?;
        }
        let manager = RepositoryManager::open(dir.path(), limits())?;
        assert_eq!(phase(&manager, "A"), Phase::Failed);
        assert_eq!(
            manager
                .begin_quiesce(&id("A"), generation_of(&manager, "A"))
                .unwrap_err(),
            CatalogError::NotReady
        );
        assert_eq!(
            manager.complete_quiesce(&id("A"), &receipt).unwrap_err(),
            CatalogError::Conflict
        );
        assert_eq!(
            manager.open_repository(&id("A"), OpenMode::ReadOnly).err(),
            Some(CatalogError::NotReady)
        );
        assert_eq!(file_bytes(&moved), before);
        if swapped {
            assert!(fs::read_dir(&db)?.next().is_none());
        } else {
            assert!(!db.exists());
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- format

#[test]
fn quiescing_is_additive_v1_and_unknown_or_evidence_less_phases_fail_closed() -> Test {
    let _guard = shared();
    let dir = root();
    {
        let mut manager = RepositoryManager::open(dir.path(), limits())?;
        manager.create(id("A"), 1)?;
    }
    let closed = fs::read_to_string(catalog_path(dir.path()))?;
    assert!(closed.starts_with("oxigraph-catalog-v1\n"));
    assert!(closed.contains(r#""phase":"Closed""#));
    assert!(closed.contains(r#""version":1"#));
    assert!(!closed.contains("Quiescing"));
    {
        let manager = RepositoryManager::open(dir.path(), limits())?;
        let _ = begin(&manager, "A");
    }
    let quiescing = fs::read_to_string(catalog_path(dir.path()))?;
    assert!(quiescing.starts_with("oxigraph-catalog-v1\n"));
    assert!(quiescing.contains(r#""phase":"Quiescing""#));
    assert!(quiescing.contains(r#""version":1"#));
    let body = catalog_body(dir.path());
    let quiescing_phase = r#""phase":"Quiescing""#;
    for changed in [
        body.replace(quiescing_phase, r#""phase":"Draining""#),
        body.replace(quiescing_phase, r#""phase":"quiescing""#),
        without_evidence(&body),
    ] {
        assert_ne!(changed, body);
        write_catalog_text(dir.path(), &changed);
        let bytes = fs::read(catalog_path(dir.path()))?;
        assert_eq!(
            RepositoryManager::open(dir.path(), limits()).err(),
            Some(CatalogError::InvalidCatalog)
        );
        assert_eq!(fs::read(catalog_path(dir.path()))?, bytes);
    }
    write_catalog_text(dir.path(), &body);
    let manager = RepositoryManager::open(dir.path(), limits())?;
    assert_eq!(phase(&manager, "A"), Phase::Quiescing);
    Ok(())
}
