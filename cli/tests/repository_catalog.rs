#![cfg(target_os = "linux")]
use oxigraph::model::{GraphName, NamedNode, Quad};
use oxigraph_cli::catalog::{CatalogError, FaultPoint, ManagerLimits, Phase, RepositoryManager};
use oxigraph_cli::repository::{OpenMode, RepositoryId, RepositoryState};
use sha2::{Digest, Sha256};
use std::error::Error;
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, RwLock};

// Fork inherits other threads' flock descriptors until exec closes O_CLOEXEC.
// Exclude process creation from concurrent manager lifetimes in this test binary.
static FORK_ISOLATION: RwLock<()> = RwLock::new(());
use std::time::{Duration, Instant};

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
fn quad() -> Quad {
    Quad::new(
        NamedNode::new_unchecked("urn:s"),
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
fn database(root: &std::path::Path) -> std::path::PathBuf {
    fs::read_dir(root.join("repos"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
}

fn file_bytes(path: &std::path::Path) -> Vec<(std::ffi::OsString, Vec<u8>)> {
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

#[test]
fn unsafe_ancestor_is_rejected_before_lock_creation() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    let parent = root();
    let child = parent.path().join("private");
    fs::create_dir(&child)?;
    fs::set_permissions(&child, fs::Permissions::from_mode(0o700))?;
    fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o777))?;
    assert!(matches!(
        RepositoryManager::open(&child, limits()),
        Err(CatalogError::UnsafePath)
    ));
    assert!(!child.join("manager.lock").exists());
    fs::set_permissions(parent.path(), fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[test]
fn real_store_restart_limits_and_read_only() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    manager.create(id("B"), manager.catalog_generation())?;
    manager.create(id("C"), manager.catalog_generation())?;
    assert_eq!(
        manager.create(id("D"), 1).unwrap_err(),
        CatalogError::Conflict
    );
    assert_eq!(
        manager
            .create(id("A"), manager.catalog_generation())
            .unwrap_err(),
        CatalogError::Conflict
    );
    let a = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
    assert_eq!(a.snapshot().state, RepositoryState::ReadyReadWrite);
    a.insert(quad())?;
    a.flush()?;
    assert!(a.contains(&quad())?);
    assert!(matches!(
        manager.open_repository(&id("A"), OpenMode::ReadOnly),
        Err(CatalogError::Conflict)
    ));
    let b = manager.open_repository(&id("B"), OpenMode::ReadOnly)?;
    assert!(!b.contains(&quad())?);
    assert_eq!(b.insert(quad()).unwrap_err(), CatalogError::NotReady);
    assert!(matches!(
        manager.open_repository(&id("C"), OpenMode::ReadOnly),
        Err(CatalogError::Limit)
    ));
    drop(a);
    drop(b);
    drop(manager);
    let manager = RepositoryManager::open(dir.path(), limits())?;
    let before = fs::read(dir.path().join("catalog"))?;
    manager.reconcile()?;
    assert_eq!(before, fs::read(dir.path().join("catalog"))?);
    assert!(
        manager
            .open_repository(&id("A"), OpenMode::ReadOnly)?
            .contains(&quad())?
    );
    assert!(manager.list()?.iter().all(|r| r.phase == Phase::Closed));
    Ok(())
}

#[test]
fn configured_limits_fail_before_readiness() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    for bounded in [
        ManagerLimits {
            catalog_bytes: 32,
            ..limits()
        },
        ManagerLimits {
            scan_entries: 2,
            ..limits()
        },
        ManagerLimits {
            open_handles: 0,
            ..limits()
        },
    ] {
        let dir = root();
        assert!(RepositoryManager::open(dir.path(), bounded).is_err());
    }
    let dir = root();
    let one = ManagerLimits {
        repositories: 1,
        ..limits()
    };
    let mut manager = RepositoryManager::open(dir.path(), one)?;
    manager.create(id("A"), 1)?;
    let before = fs::read(dir.path().join("catalog"))?;
    assert_eq!(
        manager
            .create(id("B"), manager.catalog_generation())
            .unwrap_err(),
        CatalogError::Limit
    );
    assert_eq!(fs::read(dir.path().join("catalog"))?, before);
    drop(manager);
    assert!(RepositoryManager::open(dir.path(), limits()).is_err());
    let dir = root();
    let mut manager = RepositoryManager::open(
        dir.path(),
        ManagerLimits {
            store_files: 1,
            ..limits()
        },
    )?;
    assert!(manager.create(id("A"), 1).is_err());
    assert_eq!(manager.list()?[0].phase, Phase::Failed);
    assert!(
        manager
            .open_repository(&id("A"), OpenMode::ReadWrite)
            .is_err()
    );
    assert!(
        !fs::read_dir(dir.path().join("staging"))?
            .collect::<Vec<_>>()
            .is_empty()
    );
    Ok(())
}

#[test]
fn unsafe_paths_orphans_and_invalid_catalog_preserve_bytes() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    let parent = root();
    let dir = root();
    let outside = parent.path().join("outside");
    fs::write(&outside, b"untouched")?;
    symlink(dir.path(), parent.path().join("root-link"))?;
    assert!(RepositoryManager::open(parent.path().join("root-link"), limits()).is_err());
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    symlink(&outside, dir.path().join("repos").join("orphan-link"))?;
    assert_eq!(manager.orphan_inventory()?.len(), 1);
    drop(manager);
    assert_eq!(fs::read(&outside)?, b"untouched");
    let catalog = dir.path().join("catalog");
    let original = fs::read(&catalog)?;
    let body_start = original
        .iter()
        .enumerate()
        .filter(|(_, b)| **b == b'\n')
        .nth(1)
        .unwrap()
        .0
        + 1;
    let value: serde_json::Value = serde_json::from_slice(&original[body_start..])?;
    let mut duplicate = value.clone();
    let entry = duplicate["entries"][0].clone();
    duplicate["entries"].as_array_mut().unwrap().push(entry);
    let mut unknown = value.clone();
    unknown["version"] = 2.into();
    let mut future = value.clone();
    future["entries"][0]["changed_at"] = u64::MAX.into();
    for changed in [duplicate, unknown, future] {
        let body = serde_json::to_vec(&changed)?;
        let checksum: String = Sha256::digest(&body)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let mut bytes = format!("oxigraph-catalog-v1\n{checksum}\n").into_bytes();
        bytes.extend(body);
        fs::write(&catalog, &bytes)?;
        assert!(RepositoryManager::open(dir.path(), limits()).is_err());
        assert_eq!(fs::read(&catalog)?, bytes);
    }
    for bytes in [
        original[..40].to_vec(),
        b"oxigraph-catalog-v1\nbad\n{}".to_vec(),
    ] {
        fs::write(&catalog, &bytes)?;
        assert!(RepositoryManager::open(dir.path(), limits()).is_err());
        assert_eq!(fs::read(&catalog)?, bytes);
    }
    fs::write(&catalog, &original)?;
    fs::hard_link(&catalog, parent.path().join("linked"))?;
    assert!(RepositoryManager::open(dir.path(), limits()).is_err());
    assert_eq!(fs::read(&catalog)?, original);
    assert!(RepositoryId::parse("../outside").is_err());
    Ok(())
}

#[test]
fn missing_or_replaced_database_never_manufactures_readiness() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    for corruption in [
        "missing-current",
        "missing-manifest",
        "corrupt-manifest",
        "empty",
        "swapped",
        "symlink",
    ] {
        let dir = root();
        let outside = root();
        let mut manager = RepositoryManager::open(dir.path(), limits())?;
        manager.create(id("A"), 1)?;
        let db = database(dir.path());
        drop(manager);
        if corruption == "missing-current" {
            fs::rename(db.join("CURRENT"), db.join("CURRENT.saved"))?;
        } else if corruption == "missing-manifest" || corruption == "corrupt-manifest" {
            let manifest = fs::read_to_string(db.join("CURRENT"))?;
            let manifest = db.join(manifest.trim());
            if corruption == "missing-manifest" {
                fs::rename(&manifest, db.join("manifest.saved"))?;
            } else {
                fs::write(&manifest, b"corrupt manifest")?;
            }
        } else {
            fs::rename(&db, outside.path().join("saved"))?;
            if corruption == "symlink" {
                symlink(outside.path().join("saved"), &db)?;
            } else {
                fs::create_dir(&db)?;
                fs::set_permissions(&db, fs::Permissions::from_mode(0o700))?;
                if corruption == "swapped" {
                    drop(oxigraph::store::Store::open(&db)?);
                }
            }
        }
        let before = file_bytes(&db);
        let manager = RepositoryManager::open(dir.path(), limits())?;
        let error = manager
            .open_repository(&id("A"), OpenMode::ReadWrite)
            .err()
            .unwrap();
        let expected = if error == CatalogError::NotReady {
            Phase::Failed
        } else {
            assert!(
                matches!(error, CatalogError::Io | CatalogError::Storage),
                "{corruption}: {error:?}"
            );
            Phase::Closed
        };
        assert_eq!(manager.list()?[0].phase, expected);
        assert_eq!(
            file_bytes(&db),
            before,
            "{corruption} changed database bytes"
        );
    }
    Ok(())
}

fn reap(child: &mut Child) -> std::process::ExitStatus {
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

#[test]
fn catalog_child() {
    let Ok(path) = std::env::var("OX_CATALOG_TEST_ROOT") else {
        return;
    };
    let index: usize = std::env::var("OX_CATALOG_TEST_CRASH")
        .unwrap()
        .parse()
        .unwrap();
    if index == usize::MAX {
        let _manager = RepositoryManager::open(&path, limits()).unwrap();
        fs::write(std::path::Path::new(&path).join("child-ready"), b"ready").unwrap();
        loop {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    let counter = std::cell::Cell::new(0usize);
    let mut manager = RepositoryManager::open_with_hook(&path, limits(), move |_| {
        let current = counter.get();
        counter.set(current + 1);
        if current == index {
            std::process::exit(73);
        }
        Ok(())
    })
    .unwrap();
    manager
        .create(id("A"), manager.catalog_generation())
        .unwrap();
}

fn child(path: &std::path::Path, index: usize) -> Child {
    Command::new(std::env::current_exe().unwrap())
        .arg("--exact")
        .arg("catalog_child")
        .arg("--nocapture")
        .env("OX_CATALOG_TEST_ROOT", path)
        .env("OX_CATALOG_TEST_CRASH", index.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

#[test]
fn lock_survives_owner_lifetime_then_releases_on_kill() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.write().unwrap();
    let dir = root();
    drop(RepositoryManager::open(dir.path(), limits())?);
    let mut worker = child(dir.path(), usize::MAX);
    let end = Instant::now() + Duration::from_secs(10);
    while !dir.path().join("child-ready").exists() {
        if Instant::now() >= end {
            let _ = worker.kill();
            let _ = worker.wait();
            panic!("lock child not ready");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(matches!(
        RepositoryManager::open(dir.path(), limits()),
        Err(CatalogError::Locked)
    ));
    worker.kill()?;
    reap(&mut worker);
    drop(RepositoryManager::open(dir.path(), limits())?);
    Ok(())
}

#[test]
fn every_create_fault_boundary_recovers_without_orphan_readiness() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.write().unwrap();
    let baseline = root();
    drop(RepositoryManager::open(baseline.path(), limits())?);
    let trace = Arc::new(Mutex::new(Vec::<FaultPoint>::new()));
    let observed = Arc::clone(&trace);
    let mut manager = RepositoryManager::open_with_hook(baseline.path(), limits(), move |point| {
        observed.lock().unwrap().push(point);
        Ok(())
    })?;
    manager.create(id("A"), 1)?;
    drop(manager);
    let trace = trace.lock().unwrap().clone();
    let phases = trace.len();
    let renames: Vec<_> = trace
        .iter()
        .enumerate()
        .filter_map(|(i, point)| (*point == FaultPoint::BeforeCatalogDirectorySync).then_some(i))
        .collect();
    assert_eq!(renames.len(), 3);
    assert!(phases >= 20);
    for index in 0..phases {
        let dir = root();
        drop(RepositoryManager::open(dir.path(), limits())?);
        let status = reap(&mut child(dir.path(), index));
        assert_eq!(status.code(), Some(73), "phase{index}");
        let staging_before: Vec<_> = fs::read_dir(dir.path().join("staging"))?
            .map(|entry| {
                let path = entry.unwrap().path();
                let bytes = file_bytes(&path);
                (path, bytes)
            })
            .collect();
        let mut manager = RepositoryManager::open(dir.path(), limits())?;
        let entries = manager.list()?;
        assert_eq!(
            entries.len(),
            usize::from(index >= renames[0]),
            "boundary {index}: {:?}",
            trace[index]
        );
        for entry in entries {
            assert_eq!(
                entry.phase,
                if index < renames[1] {
                    Phase::Failed
                } else {
                    Phase::Closed
                },
                "boundary {index}: {:?}",
                trace[index]
            );
            if entry.phase == Phase::Closed {
                let handle = manager.open_repository(&entry.id, OpenMode::ReadWrite)?;
                handle.insert(quad())?;
                assert!(handle.contains(&quad())?);
            } else {
                assert_eq!(entry.phase, Phase::Failed);
                for (path, bytes) in &staging_before {
                    assert_eq!(&file_bytes(path), bytes);
                }
                let generation = manager.catalog_generation();
                assert_eq!(
                    manager.create(id("A"), generation).unwrap_err(),
                    CatalogError::Conflict
                );
            }
        }
        let before = fs::read(dir.path().join("catalog"))?;
        manager.reconcile()?;
        assert_eq!(fs::read(dir.path().join("catalog"))?, before);
        drop(manager);
        drop(RepositoryManager::open(dir.path(), limits())?);
    }
    Ok(())
}

#[test]
fn verification_refusals_preserve_closed_catalog_and_data() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    for point in [FaultPoint::BeforeVerification, FaultPoint::BeforeStoreOpen] {
        let dir = root();
        let mut manager = RepositoryManager::open(dir.path(), limits())?;
        manager.create(id("A"), 1)?;
        {
            let handle = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
            handle.insert(quad())?;
            handle.flush()?;
        }
        drop(manager);
        let original = fs::read(dir.path().join("catalog"))?;
        let fail_once = std::cell::Cell::new(true);
        let manager = RepositoryManager::open_with_hook(dir.path(), limits(), move |actual| {
            if actual == point && fail_once.replace(false) {
                Err(CatalogError::Io)
            } else {
                Ok(())
            }
        })?;
        assert!(matches!(
            manager.open_repository(&id("A"), OpenMode::ReadWrite),
            Err(CatalogError::Io)
        ));
        assert_eq!(fs::read(dir.path().join("catalog"))?, original);
        assert_eq!(manager.list()?[0].phase, Phase::Closed);
        assert!(
            manager
                .open_repository(&id("A"), OpenMode::ReadOnly)?
                .contains(&quad())?
        );
    }
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    let db = database(dir.path());
    for i in 0..limits().store_files {
        let path = db.join(format!("extra-{i}"));
        fs::write(&path, b"retained")?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    let bytes = file_bytes(&db);
    let original = fs::read(dir.path().join("catalog"))?;
    assert!(matches!(
        manager.open_repository(&id("A"), OpenMode::ReadWrite),
        Err(CatalogError::Limit)
    ));
    assert_eq!(manager.list()?[0].phase, Phase::Closed);
    assert_eq!(fs::read(dir.path().join("catalog"))?, original);
    assert_eq!(file_bytes(&db), bytes);
    Ok(())
}

#[test]
fn initial_write_debris_recovers_but_unknown_catalog_history_does_not() -> Result<(), Box<dyn Error>>
{
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    for point in [
        FaultPoint::BeforeCatalogWrite,
        FaultPoint::BeforeCatalogSync,
        FaultPoint::BeforeCatalogRename,
        FaultPoint::BeforeCatalogDirectorySync,
        FaultPoint::AfterCatalogSync,
    ] {
        let dir = root();
        assert!(matches!(
            RepositoryManager::open_with_hook(dir.path(), limits(), move |actual| {
                if actual == point {
                    Err(CatalogError::Injected)
                } else {
                    Ok(())
                }
            }),
            Err(CatalogError::Injected)
        ));
        let debris: Vec<_> = fs::read_dir(dir.path())?
            .filter_map(|entry| {
                let path = entry.unwrap().path();
                (path.extension().is_some_and(|ext| ext == "pending")).then(|| {
                    let bytes = fs::read(&path).unwrap();
                    (path, bytes)
                })
            })
            .collect();
        let manager = RepositoryManager::open(dir.path(), limits())?;
        assert!(manager.list()?.is_empty());
        for (path, bytes) in debris {
            assert!(manager.orphan_inventory()?.contains(&path));
            assert_eq!(fs::read(path)?, bytes);
        }
    }
    let dir = root();
    fs::write(
        dir.path()
            .join("catalog-12345678-1234-4123-8123-123456789012.pending"),
        b"unknown-update",
    )?;
    assert!(matches!(
        RepositoryManager::open(dir.path(), limits()),
        Err(CatalogError::MissingCatalog)
    ));
    assert!(!dir.path().join("catalog").exists());
    Ok(())
}

#[test]
fn in_process_mutation_faults_poison_and_validated_state_recovers() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    for point in [
        FaultPoint::BeforeCatalogSync,
        FaultPoint::AfterReservation,
        FaultPoint::AfterStaging,
        FaultPoint::AfterValidation,
        FaultPoint::BeforePublish,
        FaultPoint::AfterPublish,
        FaultPoint::AfterClosed,
    ] {
        let dir = root();
        drop(RepositoryManager::open(dir.path(), limits())?);
        let mut manager = RepositoryManager::open_with_hook(dir.path(), limits(), move |actual| {
            if actual == point {
                Err(CatalogError::Injected)
            } else {
                Ok(())
            }
        })?;
        assert_eq!(
            manager.create(id("A"), 1).unwrap_err(),
            CatalogError::Injected
        );
        assert_eq!(manager.list().unwrap_err(), CatalogError::Poisoned);
        assert_eq!(manager.reconcile().unwrap_err(), CatalogError::Poisoned);
        assert_eq!(
            manager.create(id("B"), 1).unwrap_err(),
            CatalogError::Poisoned
        );
        drop(manager);
        let manager = RepositoryManager::open(dir.path(), limits())?;
        match point {
            FaultPoint::BeforeCatalogSync => assert!(manager.list()?.is_empty()),
            FaultPoint::AfterReservation | FaultPoint::AfterStaging => {
                assert_eq!(manager.list()?[0].phase, Phase::Failed)
            }
            _ => {
                assert_eq!(manager.list()?[0].phase, Phase::Closed);
                let handle = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
                handle.insert(quad())?;
                assert!(handle.contains(&quad())?);
            }
        }
    }
    Ok(())
}

#[test]
fn publish_failure_preserves_validated_journal_and_orphan_bytes() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    let root_path = dir.path().to_owned();
    let mut manager = RepositoryManager::open_with_hook(dir.path(), limits(), move |point| {
        if point == FaultPoint::BeforePublish {
            let uuid = fs::read_dir(root_path.join("staging"))?
                .next()
                .unwrap()?
                .file_name();
            fs::write(root_path.join("repos").join(uuid), b"do-not-replace")?;
        }
        Ok(())
    })?;
    assert_eq!(
        manager.create(id("A"), 1).unwrap_err(),
        CatalogError::UnsafePath
    );
    assert_eq!(manager.list().unwrap_err(), CatalogError::Poisoned);
    let body = fs::read_to_string(dir.path().join("catalog"))?;
    assert!(body.contains("\"phase\":\"Validated\""));
    let conflicting = fs::read_dir(dir.path().join("repos"))?
        .next()
        .unwrap()?
        .path();
    drop(manager);
    let manager = RepositoryManager::open(dir.path(), limits())?;
    assert_eq!(manager.list()?[0].phase, Phase::Failed);
    assert_eq!(fs::read(conflicting)?, b"do-not-replace");
    Ok(())
}

#[test]
fn validated_missing_or_empty_staging_never_initializes_a_database() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    for empty in [false, true] {
        let dir = root();
        let retained = root();
        let mut manager = RepositoryManager::open_with_hook(dir.path(), limits(), |point| {
            if point == FaultPoint::AfterValidation {
                Err(CatalogError::Injected)
            } else {
                Ok(())
            }
        })?;
        assert_eq!(
            manager.create(id("A"), 1).unwrap_err(),
            CatalogError::Injected
        );
        drop(manager);
        let staging = fs::read_dir(dir.path().join("staging"))?
            .next()
            .unwrap()?
            .path();
        let original = file_bytes(&staging);
        fs::rename(&staging, retained.path().join("evidence"))?;
        if empty {
            fs::create_dir(&staging)?;
            fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))?;
        }
        let manager = RepositoryManager::open(dir.path(), limits())?;
        assert_eq!(manager.list()?[0].phase, Phase::Failed);
        assert!(matches!(
            manager.open_repository(&id("A"), OpenMode::ReadWrite),
            Err(CatalogError::NotReady)
        ));
        assert!(fs::read_dir(dir.path().join("repos"))?.next().is_none());
        assert_eq!(file_bytes(&retained.path().join("evidence")), original);
        if empty {
            assert!(fs::read_dir(staging)?.next().is_none());
        }
    }
    Ok(())
}

#[test]
fn truncated_sst_is_rejected_without_mutating_store() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    {
        let handle = manager.open_repository(&id("A"), OpenMode::ReadWrite)?;
        handle.insert(quad())?;
        handle.flush()?;
    }
    let db = database(dir.path());
    let sst = fs::read_dir(&db)?
        .find_map(|entry| {
            let path = entry.unwrap().path();
            path.extension()
                .is_some_and(|ext| ext == "sst")
                .then_some(path)
        })
        .expect("flushed RDF must materialize an SST");
    fs::OpenOptions::new().write(true).open(sst)?.set_len(3)?;
    let before = file_bytes(&db);
    assert!(
        manager
            .open_repository(&id("A"), OpenMode::ReadWrite)
            .is_err()
    );
    assert_eq!(file_bytes(&db), before);
    Ok(())
}

#[test]
fn scan_capacity_is_reserved_before_catalog_or_staging_mutation() -> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    for spare in [0, 1] {
        let dir = root();
        let bounded = ManagerLimits {
            scan_entries: 9,
            ..limits()
        };
        let mut manager = RepositoryManager::open(dir.path(), bounded)?;
        manager.create(id("A"), 1)?;
        for i in 0..(bounded.scan_entries - 5 - spare) {
            fs::write(dir.path().join(format!("retained-{i}")), b"evidence")?;
        }
        let before = fs::read(dir.path().join("catalog"))?;
        let generation = manager.catalog_generation();
        assert_eq!(
            manager.create(id("B"), generation).unwrap_err(),
            CatalogError::Limit
        );
        assert_eq!(manager.list()?.len(), 1);
        assert_eq!(fs::read(dir.path().join("catalog"))?, before);
        assert!(fs::read_dir(dir.path().join("staging"))?.next().is_none());
        drop(manager);
        let manager = RepositoryManager::open(dir.path(), bounded)?;
        assert_eq!(manager.list()?.len(), 1);
        assert_eq!(
            manager.orphan_inventory()?.len(),
            bounded.scan_entries - 5 - spare
        );
        assert_eq!(fs::read(dir.path().join("catalog"))?, before);
        assert!(
            manager
                .open_repository(&id("A"), OpenMode::ReadOnly)
                .is_ok()
        );
    }
    let dir = root();
    assert!(matches!(
        RepositoryManager::open(
            dir.path(),
            ManagerLimits {
                scan_entries: 8,
                ..limits()
            }
        ),
        Err(CatalogError::Limit)
    ));
    assert!(!dir.path().join("manager.lock").exists());
    Ok(())
}

#[test]
fn repeated_real_reopen_cycles_preserve_data_at_file_admission_ceiling()
-> Result<(), Box<dyn Error>> {
    let _fork_guard = FORK_ISOLATION.read().unwrap();
    let dir = root();
    let mut manager = RepositoryManager::open(dir.path(), limits())?;
    manager.create(id("A"), 1)?;
    drop(manager);
    let mut completed = 0;
    for cycle in 0..32 {
        let manager = RepositoryManager::open(dir.path(), limits())?;
        let handle = match manager.open_repository(&id("A"), OpenMode::ReadWrite) {
            Ok(handle) => handle,
            Err(error) => {
                assert_eq!(error, CatalogError::Limit);
                assert_eq!(manager.list()?[0].phase, Phase::Closed);
                assert!(
                    completed >= 8,
                    "must exercise repeated successful real opens"
                );
                let db = database(dir.path());
                assert!(fs::read_dir(&db)?.count() > limits().store_files);
                let before = file_bytes(&db);
                assert!(matches!(
                    manager.open_repository(&id("A"), OpenMode::ReadOnly),
                    Err(CatalogError::Limit)
                ));
                assert_eq!(file_bytes(&db), before);
                break;
            }
        };
        assert!(fs::read_dir(database(dir.path()))?.count() <= limits().store_files);
        let row = Quad::new(
            NamedNode::new_unchecked(format!("urn:cycle:{cycle}")),
            NamedNode::new_unchecked("urn:p"),
            NamedNode::new_unchecked("urn:o"),
            GraphName::DefaultGraph,
        );
        handle.insert(row.clone())?;
        handle.flush()?;
        assert!(handle.contains(&row)?);
        drop(handle);
        let count = fs::read_dir(database(dir.path()))?.count();
        if count <= limits().store_files {
            assert!(
                manager
                    .open_repository(&id("A"), OpenMode::ReadOnly)?
                    .contains(&row)?
            );
        } else {
            assert!(matches!(
                manager.open_repository(&id("A"), OpenMode::ReadOnly),
                Err(CatalogError::Limit)
            ));
        }
        completed += 1;
    }
    assert!((8..=32).contains(&completed));
    let db = database(dir.path());
    let before = file_bytes(&db);
    let reopened = RepositoryManager::open(dir.path(), limits())?;
    assert_eq!(reopened.list()?[0].phase, Phase::Closed);
    if fs::read_dir(&db)?.count() > limits().store_files {
        assert!(matches!(
            reopened.open_repository(&id("A"), OpenMode::ReadWrite),
            Err(CatalogError::Limit)
        ));
        assert_eq!(file_bytes(&db), before);
    }
    Ok(())
}
