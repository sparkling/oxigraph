use super::{CatalogError, ManagerLimits};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

pub(super) fn exists(path: &Path) -> Result<bool, CatalogError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

#[cfg(target_os = "linux")]
use std::os::{
    fd::AsRawFd,
    unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
};

pub(super) struct Root {
    pub path: PathBuf,
    #[cfg(target_os = "linux")]
    device: u64,
    _lock: File,
}

#[cfg(target_os = "linux")]
fn owner() -> u32 {
    // SAFETY: geteuid has no arguments and no memory preconditions.
    #[expect(unsafe_code)]
    unsafe {
        libc::geteuid()
    }
}

impl Root {
    #[cfg(not(target_os = "linux"))]
    pub fn open(_path: &Path) -> Result<Self, CatalogError> {
        Err(CatalogError::Unsupported)
    }

    #[cfg(target_os = "linux")]
    pub fn open(path: &Path) -> Result<Self, CatalogError> {
        if !path.is_absolute() || fs::canonicalize(path)? != path {
            return Err(CatalogError::UnsafePath);
        }
        // Ancestors must not let another uid replace the private root itself.
        // Sticky shared directories (e.g. /tmp) protect our owned child entry.
        for ancestor in path.ancestors().skip(1) {
            let meta = fs::symlink_metadata(ancestor)?;
            if !meta.is_dir()
                || ![0, owner()].contains(&meta.uid())
                || (meta.mode() & 0o022 != 0 && meta.mode() & 0o1000 == 0)
            {
                return Err(CatalogError::UnsafePath);
            }
        }
        let meta = fs::symlink_metadata(path)?;
        if !meta.is_dir() || meta.uid() != owner() || meta.mode() & 0o777 != 0o700 {
            return Err(CatalogError::UnsafePath);
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .mode(0o600)
            .open(path.join("manager.lock"))?;
        let lock_meta = lock.metadata()?;
        if !lock_meta.is_file()
            || lock_meta.nlink() != 1
            || lock_meta.uid() != owner()
            || lock_meta.mode() & 0o777 != 0o600
            || lock_meta.dev() != meta.dev()
        {
            return Err(CatalogError::UnsafePath);
        }
        // SAFETY: the live File owns this descriptor throughout flock and lock lifetime.
        #[expect(unsafe_code)]
        let code = unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
        if code != 0 {
            return Err(CatalogError::Locked);
        }
        let root = Self {
            path: path.to_owned(),
            device: meta.dev(),
            _lock: lock,
        };
        for name in ["staging", "repos"] {
            let child = path.join(name);
            if !child.try_exists()? {
                fs::DirBuilder::new().mode(0o700).create(&child)?;
                File::open(path)?.sync_all()?;
            }
            root.directory(&child)?;
        }
        Ok(root)
    }

    #[cfg(target_os = "linux")]
    pub fn directory(&self, path: &Path) -> Result<(u64, u64), CatalogError> {
        let meta = fs::symlink_metadata(path)?;
        if !meta.is_dir()
            || meta.uid() != owner()
            || meta.dev() != self.device
            || meta.mode() & 0o777 != 0o700
        {
            return Err(CatalogError::UnsafePath);
        }
        Ok((meta.dev(), meta.ino()))
    }

    #[cfg(not(target_os = "linux"))]
    pub fn directory(&self, _path: &Path) -> Result<(u64, u64), CatalogError> {
        Err(CatalogError::Unsupported)
    }

    #[cfg(target_os = "linux")]
    fn regular(&self, path: &Path) -> Result<File, CatalogError> {
        self.regular_if_present(path, false)?
            .ok_or(CatalogError::Io)
    }

    #[cfg(target_os = "linux")]
    fn regular_if_present(&self, path: &Path, live: bool) -> Result<Option<File>, CatalogError> {
        let file = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK)
            .open(path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let meta = file.metadata()?;
        if live && meta.nlink() == 0 {
            return Ok(None);
        }
        if !meta.is_file()
            || meta.nlink() != 1
            || meta.uid() != owner()
            || meta.dev() != self.device
            || meta.mode() & 0o022 != 0
        {
            return Err(CatalogError::UnsafePath);
        }
        Ok(Some(file))
    }

    #[cfg(not(target_os = "linux"))]
    fn regular(&self, _path: &Path) -> Result<File, CatalogError> {
        Err(CatalogError::Unsupported)
    }

    #[cfg(not(target_os = "linux"))]
    fn regular_if_present(&self, _path: &Path, _live: bool) -> Result<Option<File>, CatalogError> {
        Err(CatalogError::Unsupported)
    }

    pub fn read_catalog(&self, max: usize) -> Result<Option<Vec<u8>>, CatalogError> {
        let path = self.path.join("catalog");
        if fs::symlink_metadata(&path).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound) {
            return Ok(None);
        }
        let file = self.regular(&path)?;
        if file.metadata()?.len() > max as u64 {
            return Err(CatalogError::Limit);
        }
        let mut bytes = Vec::new();
        file.take(max as u64 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > max {
            return Err(CatalogError::Limit);
        }
        Ok(Some(bytes))
    }

    /// Retained temp files are evidence, never silently deleted on recovery.
    pub fn allow_initial_catalog(&self, scanned: &[PathBuf]) -> Result<(), CatalogError> {
        for path in scanned {
            if ["manager.lock", "repos", "staging"]
                .iter()
                .any(|name| self.path.join(name) == *path)
            {
                continue;
            }
            let initial = path.parent() == Some(self.path.as_path())
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .and_then(|name| name.strip_prefix("catalog-initial-"))
                    .and_then(|name| name.strip_suffix(".pending"))
                    .is_some_and(super::codec::uuid_valid);
            if !initial {
                return Err(CatalogError::MissingCatalog);
            }
            // Only initial-write debris in an otherwise empty root is recoverable.
            // Partial bytes are retained, not interpreted as catalog authority.
            self.regular(path)?;
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    pub fn write_catalog(
        &self,
        bytes: &[u8],
        initial: bool,
        point: &dyn Fn(super::FaultPoint) -> Result<(), CatalogError>,
    ) -> Result<(), CatalogError> {
        let temp = self.path.join(format!(
            "catalog-{}{}.pending",
            if initial { "initial-" } else { "" },
            super::new_uuid()
        ));
        point(super::FaultPoint::BeforeCatalogWrite)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(&temp)?;
        file.write_all(bytes)?;
        point(super::FaultPoint::BeforeCatalogSync)?;
        file.sync_all()?;
        point(super::FaultPoint::BeforeCatalogRename)?;
        fs::rename(temp, self.path.join("catalog"))?;
        point(super::FaultPoint::BeforeCatalogDirectorySync)?;
        File::open(&self.path)?.sync_all()?;
        point(super::FaultPoint::AfterCatalogSync)
    }

    #[cfg(not(target_os = "linux"))]
    pub fn write_catalog(
        &self,
        _bytes: &[u8],
        _initial: bool,
        _point: &dyn Fn(super::FaultPoint) -> Result<(), CatalogError>,
    ) -> Result<(), CatalogError> {
        Err(CatalogError::Unsupported)
    }

    pub fn scan(&self, limits: ManagerLimits) -> Result<Vec<PathBuf>, CatalogError> {
        let mut names = Vec::new();
        for path in [
            &self.path,
            &self.path.join("staging"),
            &self.path.join("repos"),
        ] {
            self.directory(path)?;
            for item in fs::read_dir(path)? {
                if names.len() >= limits.scan_entries {
                    return Err(CatalogError::Limit);
                }
                names.push(item?.path());
            }
        }
        names.sort();
        Ok(names)
    }

    pub fn reserve_scan(
        &self,
        limits: ManagerLimits,
        additional: usize,
    ) -> Result<(), CatalogError> {
        if self
            .scan(limits)?
            .len()
            .checked_add(additional)
            .is_none_or(|count| count > limits.scan_entries)
        {
            return Err(CatalogError::Limit);
        }
        Ok(())
    }

    pub fn guard_store(&self, path: &Path, max: usize) -> Result<(u64, u64), CatalogError> {
        self.guard_files(path, max, false)
    }

    pub fn guard_open_store(&self, path: &Path, max: usize) -> Result<(u64, u64), CatalogError> {
        self.guard_files(path, max, true)
    }

    fn guard_files(&self, path: &Path, max: usize, live: bool) -> Result<(u64, u64), CatalogError> {
        let identity = self.directory(path)?;
        for (count, item) in fs::read_dir(path)?.enumerate() {
            if count >= max {
                return Err(CatalogError::Limit);
            }
            let path = item?.path();
            if live {
                // Native compaction may remove an enumerated SST before open.
                // Count it toward the bound; only ENOENT is safe to ignore here.
                self.regular_if_present(&path, true)?;
            } else {
                self.regular(&path)?;
            }
        }
        Ok(identity)
    }

    #[cfg(target_os = "linux")]
    pub fn create_staging(&self, uuid: &str) -> Result<PathBuf, CatalogError> {
        let path = self.path.join("staging").join(uuid);
        fs::DirBuilder::new().mode(0o700).create(&path)?;
        File::open(self.path.join("staging"))?.sync_all()?;
        Ok(path)
    }

    #[cfg(not(target_os = "linux"))]
    pub fn create_staging(&self, _uuid: &str) -> Result<PathBuf, CatalogError> {
        Err(CatalogError::Unsupported)
    }

    pub fn publish(&self, uuid: &str) -> Result<(), CatalogError> {
        let staging = self.path.join("staging").join(uuid);
        let target = self.path.join("repos").join(uuid);
        self.directory(&staging)?;
        if exists(&target)? {
            return Err(CatalogError::UnsafePath);
        }
        fs::rename(staging, target)?;
        File::open(self.path.join("repos"))?.sync_all()?;
        File::open(self.path.join("staging"))?.sync_all()?;
        Ok(())
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};

    #[test]
    fn live_scan_allows_absence_but_not_unsafe_existing_entries() {
        let dir = tempfile::tempdir().unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let root = Root::open(dir.path()).unwrap();
        let missing = dir.path().join("missing.sst");
        assert!(root.regular_if_present(&missing, true).unwrap().is_none());
        assert!(matches!(root.regular(&missing), Err(CatalogError::Io)));
        let file = dir.path().join("data.sst");
        fs::write(&file, b"data").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(root.regular_if_present(&file, true).unwrap().is_some());
        let link = dir.path().join("link.sst");
        symlink(&file, &link).unwrap();
        assert!(root.regular_if_present(&link, true).is_err());
        fs::hard_link(&file, dir.path().join("hard.sst")).unwrap();
        assert!(matches!(
            root.regular_if_present(&file, true),
            Err(CatalogError::UnsafePath)
        ));
    }
}
