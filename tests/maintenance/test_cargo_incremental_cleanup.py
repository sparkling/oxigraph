import fcntl
import importlib.util
import os
import subprocess
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("cleanup", Path(__file__).parents[2] /
    "scripts/maintenance/clean-cargo-incremental.py")
cleanup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cleanup)


class CleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.profile = self.repo / "target/engineering-delivery/builds/allocation/debug"
        self.cache = self.profile / "incremental"
        self.cache.mkdir(parents=True)
        (self.cache / "session").mkdir()
        (self.cache / "session/work-products.bin").write_bytes(b"compiler cache")
        self.lock = self.profile / ".cargo-lock"
        self.lock.touch()
        for item in (self.cache, self.cache / "session", self.cache / "session/work-products.bin"):
            os.utime(item, (1, 1))

    def test_dry_run_and_preservation(self):
        for name in ("deps", "build", ".fingerprint"):
            (self.profile / name).mkdir()
            (self.profile / name / "evidence").write_text("keep")
        (self.profile / "binary").write_text("keep")
        lock_inode = self.lock.stat().st_ino
        self.assertEqual(cleanup.clean_one(self.cache, 3600)["status"], "eligible")
        self.assertTrue((self.cache / "session").exists())
        self.assertEqual(cleanup.clean_one(self.cache, 3600, True)["status"], "cleaned")
        self.assertEqual(list(self.cache.iterdir()), [])
        self.assertEqual(self.lock.stat().st_ino, lock_inode)
        for name in ("deps", "build", ".fingerprint"):
            self.assertEqual((self.profile / name / "evidence").read_text(), "keep")
        self.assertEqual((self.profile / "binary").read_text(), "keep")

    def test_cargo_shared_and_exclusive_locks_skip_without_waiting(self):
        for mode in (fcntl.LOCK_SH, fcntl.LOCK_EX):
            with self.lock.open("r+") as handle:
                fcntl.flock(handle, mode)
                start = time.monotonic()
                self.assertEqual(cleanup.clean_one(self.cache, 3600, True)["status"], "busy")
                self.assertLess(time.monotonic() - start, 1)
                self.assertTrue((self.cache / "session").exists())

    def test_recent_cache_retained(self):
        (self.cache / "session/work-products.bin").touch()
        self.assertEqual(cleanup.clean_one(self.cache, 3600, True)["status"], "recent")

    def test_symlink_lock_and_contents_rejected(self):
        self.lock.unlink()
        self.lock.symlink_to(self.profile / "other")
        with self.assertRaises((ValueError, FileNotFoundError)):
            cleanup.clean_one(self.cache, 3600, True)
        self.lock.unlink()
        self.lock.touch()
        (self.cache / "escape").symlink_to(self.repo)
        with self.assertRaises(ValueError):
            cleanup.clean_one(self.cache, 3600, True)
        self.assertTrue((self.cache / "session").exists())

    def test_only_fixed_allocation_levels_discovered(self):
        unrelated = self.repo / "target/engineering-delivery/workflow-abc/incremental"
        unrelated.mkdir(parents=True)
        self.assertEqual(cleanup.discover(self.repo), [self.cache])
        candidate = self.repo / "target/engineering-delivery/candidates/source-abc"
        nested = candidate / "target/engineering-delivery/builds/check/release/incremental"
        nested.mkdir(parents=True)
        self.assertEqual(set(cleanup.discover(self.repo)), {self.cache, nested})

    def test_unknown_database_retained(self):
        (self.cache / "valuable.db").write_bytes(b"preserve")
        with self.assertRaises(ValueError):
            cleanup.clean_one(self.cache, 3600, True)
        self.assertTrue((self.cache / "valuable.db").exists())

    def test_nonfinite_age_rejected(self):
        for age in (float("nan"), float("inf"), -float("inf")):
            with self.assertRaises(ValueError):
                cleanup.clean_one(self.cache, age, True)
        self.assertTrue((self.cache / "session").exists())

    def test_hardlinks_count_allocated_bytes_once(self):
        original = self.cache / "session/work-products.bin"
        size, _ = cleanup.inventory(self.cache)
        os.link(original, self.cache / "session/linked.bin")
        self.assertEqual(cleanup.inventory(self.cache)[0], size)

    def test_other_mount_and_nested_bind_mount_rejected(self):
        mounts = {"/": "1", str(self.repo): "2", str(self.cache): "3"}
        with patch.object(cleanup, "mount_table", return_value=mounts):
            with self.assertRaises(ValueError):
                cleanup.clean_one(self.cache, 3600, True, expected_mount="2")
        mounts = {"/": "1", str(self.repo): "2", str(self.cache / "session"): "3"}
        with patch.object(cleanup, "mount_table", return_value=mounts):
            with self.assertRaises(ValueError):
                cleanup.clean_one(self.cache, 3600, True, expected_mount="2")
        self.assertTrue((self.cache / "session").exists())

    def test_real_cargo_build_lock(self):
        crate = self.repo / "crate"
        crate.mkdir()
        (crate / "Cargo.toml").write_text('[package]\nname="cleanup-lock-proof"\nversion="0.1.0"\nedition="2021"\n[lib]\npath="lib.rs"\n')
        (crate / "lib.rs").write_text("pub fn value() -> u8 { 1 }\n")
        (crate / "build.rs").write_text('fn main() { std::fs::write("running", "yes").unwrap(); std::thread::sleep(std::time::Duration::from_secs(2)); }\n')
        process = subprocess.Popen(["cargo", "check", "--offline", "--manifest-path", str(crate / "Cargo.toml"),
                                    "--target-dir", str(self.profile.parent)], cwd=crate,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 30
            while not (crate / "running").exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((crate / "running").exists(), "Cargo fixture did not enter build script")
            self.assertEqual(cleanup.clean_one(self.cache, 3600, True)["status"], "busy")
            self.assertTrue((self.cache / "session/work-products.bin").exists())
            _, error = process.communicate(timeout=30)
            self.assertEqual(process.returncode, 0, error.decode())
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()


if __name__ == "__main__":
    unittest.main()
