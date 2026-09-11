use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

type Result<T = ()> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

fn supported() -> bool {
    option_env!("OXIGRAPH_ROCKSDB_BUILD_KIND") == Some("vendored")
}

fn fixture(version: u64, destination: &Path) -> Result {
    fs::create_dir(destination)?;
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

fn inventory(root: &Path) -> Result<BTreeMap<PathBuf, [u8; 32]>> {
    fn visit(root: &Path, directory: &Path, output: &mut BTreeMap<PathBuf, [u8; 32]>) -> Result {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let path = entry.path();
            let relative = path.strip_prefix(root)?.to_owned();
            if entry.file_type()?.is_dir() {
                output.insert(relative, Sha256::digest(b"directory").into());
                visit(root, &path, output)?;
            } else {
                output.insert(relative, Sha256::digest(fs::read(path)?).into());
            }
        }
        Ok(())
    }

    let mut output = BTreeMap::new();
    visit(root, root, &mut output)?;
    Ok(output)
}

fn setup(version: u64) -> Result<(tempfile::TempDir, PathBuf, PathBuf, PathBuf, UpgradeOptions)> {
    let root = tempfile::tempdir()?;
    let source = root.path().join("source");
    let backup = root.path().join("backup");
    let workspace = root.path().join("upgrade");
    fixture(version, &source)?;
    let options = UpgradeOptions::default();
    Store::backup_legacy(&source, &backup, &options.recovery.transform.backup)?;
    Ok((root, source, backup, workspace, options))
}

fn inspect_unchanged(
    source: &Path,
    backup: &Path,
    workspace: &Path,
    options: &UpgradeOptions,
) -> Result<UpgradeWorkspaceInspection> {
    let source_before = inventory(source)?;
    let backup_before = inventory(backup)?;
    let workspace_before = inventory(workspace)?;
    let result = Store::inspect_upgrade(source, backup, workspace, options)?;
    assert_eq!(inventory(source)?, source_before);
    assert_eq!(inventory(backup)?, backup_before);
    assert_eq!(inventory(workspace)?, workspace_before);
    assert!(!result.active());
    assert!(!result.upgrade_authorized());
    Ok(result)
}

fn append_running(workspace: &Path, options: &UpgradeOptions) -> Result {
    let preflight = Preflight::decode(&fs::read(workspace.join(PREFLIGHT_FILE))?)?;
    let progress = decode_progress(&fs::read(workspace.join(PROGRESS_FILE))?)?;
    assert_eq!(progress.len(), 1);
    let initial = &progress[0];
    let journal = recovery_journal(workspace, options, Instant::now())?;
    let running = Progress {
        kind: RUNNING,
        preflight: preflight.fingerprint(),
        recovery_journal_len: initial.recovery_journal_len,
        recovery_journal_sha256: initial.recovery_journal_sha256,
        previous: initial.fingerprint(),
    };
    assert_eq!(initial.recovery_journal_len, journal.len() as u64);
    append_progress(workspace, &running, false)?;
    sync_directory(workspace)?;
    Ok(())
}

#[test]
fn committed_outer_states_are_verified_without_writes() -> Result {
    if !supported() {
        return Ok(());
    }

    let (_root, source, backup, workspace, options) = setup(0)?;
    Store::start_upgrade(&source, &backup, &workspace, &options)?;
    let initial = inspect_unchanged(&source, &backup, &workspace, &options)?;
    assert_eq!(initial.state(), UpgradeWorkspaceState::Initial);
    assert!(!initial.recovery().ok_or("missing recovery")?.completed());
    assert!(initial.receipt_fingerprint().is_none());

    let (_root, source, backup, workspace, options) = setup(0)?;
    Store::start_upgrade(&source, &backup, &workspace, &options)?;
    append_running(&workspace, &options)?;
    let running = inspect_unchanged(&source, &backup, &workspace, &options)?;
    assert_eq!(running.state(), UpgradeWorkspaceState::Running);
    assert!(!running.recovery().ok_or("missing recovery")?.completed());

    for phase in 0_u8..=5 {
        let (_root, source, backup, workspace, options) = setup(0)?;
        Store::start_upgrade(&source, &backup, &workspace, &options)?;
        let result = resume_upgrade_inner(&source, &backup, &workspace, &options, |current| {
            if current == phase {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        });
        assert!(result.is_err());
        let inspected = inspect_unchanged(&source, &backup, &workspace, &options)?;
        let expected = match phase {
            0 | 1 => UpgradeWorkspaceState::Running,
            2 => UpgradeWorkspaceState::CompleteUnsealed,
            3 => UpgradeWorkspaceState::ReceiptPending,
            4 | 5 => UpgradeWorkspaceState::Sealed,
            _ => unreachable!(),
        };
        assert_eq!(inspected.state(), expected);
        if expected == UpgradeWorkspaceState::Sealed {
            assert!(inspected.sealed_receipt().is_some());
            assert!(inspected.recovery().is_none());
        } else {
            assert!(inspected.recovery().is_some());
            assert!(inspected.sealed_receipt().is_none());
        }
        assert_eq!(
            inspected.receipt_fingerprint().is_some(),
            matches!(
                expected,
                UpgradeWorkspaceState::ReceiptPending | UpgradeWorkspaceState::Sealed
            )
        );
    }
    Ok(())
}

#[test]
fn uncommitted_torn_and_tampered_states_fail_without_writes() -> Result {
    if !supported() {
        return Ok(());
    }

    for phase in 0_u8..=1 {
        let (_root, source, backup, workspace, options) = setup(0)?;
        let result = start_upgrade_inner(&source, &backup, &workspace, &options, |current| {
            if current == phase {
                Err(BackupError::Cancelled)
            } else {
                Ok(())
            }
        });
        assert!(matches!(result, Err(BackupError::Cancelled)));
        let before = inventory(&workspace)?;
        assert!(Store::inspect_upgrade(&source, &backup, &workspace, &options).is_err());
        assert_eq!(inventory(&workspace)?, before);
    }

    let (_root, source, backup, workspace, options) = setup(0)?;
    let result = start_upgrade_inner(&source, &backup, &workspace, &options, |phase| {
        if phase == 2 {
            Err(BackupError::Cancelled)
        } else {
            Ok(())
        }
    });
    assert!(matches!(result, Err(BackupError::Cancelled)));
    assert_eq!(
        inspect_unchanged(&source, &backup, &workspace, &options)?.state(),
        UpgradeWorkspaceState::Initial
    );

    let (_root, source, backup, workspace, options) = setup(0)?;
    Store::start_upgrade(&source, &backup, &workspace, &options)?;
    let progress = workspace.join(PROGRESS_FILE);
    let mut bytes = fs::read(&progress)?;
    bytes.pop();
    fs::write(&progress, bytes)?;
    let before = inventory(&workspace)?;
    assert!(Store::inspect_upgrade(&source, &backup, &workspace, &options).is_err());
    assert_eq!(inventory(&workspace)?, before);

    let (_root, source, backup, workspace, options) = setup(0)?;
    Store::start_upgrade(&source, &backup, &workspace, &options)?;
    let result = resume_upgrade_inner(&source, &backup, &workspace, &options, |phase| {
        if phase == 3 {
            Err(BackupError::Cancelled)
        } else {
            Ok(())
        }
    });
    assert!(matches!(result, Err(BackupError::Cancelled)));
    let pending = workspace.join(RECEIPT_PENDING);
    let mut bytes = fs::read(&pending)?;
    let last = bytes.last_mut().ok_or("empty pending receipt")?;
    *last ^= 1;
    fs::write(&pending, bytes)?;
    let before = inventory(&workspace)?;
    assert!(Store::inspect_upgrade(&source, &backup, &workspace, &options).is_err());
    assert_eq!(inventory(&workspace)?, before);

    let (_root, source, backup, workspace, options) = setup(0)?;
    Store::start_upgrade(&source, &backup, &workspace, &options)?;
    let journal = workspace
        .join(RECOVERY_DIRECTORY)
        .join(UpgradeRecovery::journal_name());
    let mut bytes = fs::read(&journal)?;
    let last = bytes.last_mut().ok_or("empty recovery journal")?;
    *last ^= 1;
    fs::write(&journal, bytes)?;
    let before = inventory(&workspace)?;
    assert!(Store::inspect_upgrade(&source, &backup, &workspace, &options).is_err());
    assert_eq!(inventory(&workspace)?, before);
    Ok(())
}

#[test]
fn cancelled_inspection_preserves_every_input() -> Result {
    if !supported() {
        return Ok(());
    }
    let (_root, source, backup, workspace, mut options) = setup(0)?;
    Store::start_upgrade(&source, &backup, &workspace, &options)?;
    let source_before = inventory(&source)?;
    let backup_before = inventory(&backup)?;
    let workspace_before = inventory(&workspace)?;
    options.recovery.transform.backup.control.cancel();
    assert!(matches!(
        Store::inspect_upgrade(&source, &backup, &workspace, &options),
        Err(BackupError::Cancelled)
    ));
    assert_eq!(inventory(&source)?, source_before);
    assert_eq!(inventory(&backup)?, backup_before);
    assert_eq!(inventory(&workspace)?, workspace_before);
    Ok(())
}

#[cfg(feature = "rdf-12")]
#[test]
fn rdf12_initial_workspace_is_inspected_without_writes() -> Result {
    if !supported() {
        return Ok(());
    }
    let (_root, source, backup, workspace, options) = setup(1)?;
    Store::start_upgrade(&source, &backup, &workspace, &options)?;
    let inspected = inspect_unchanged(&source, &backup, &workspace, &options)?;
    assert_eq!(inspected.state(), UpgradeWorkspaceState::Initial);
    assert!(inspected.rdf12());
    Ok(())
}
