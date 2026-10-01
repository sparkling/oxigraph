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

    def test_canonical_target_without_delivery_and_lane_targets_discovered(self):
        repo = self.repo / "standalone"
        expected = {repo / "target/debug/incremental",
                    repo / "target/release/incremental",
                    repo / "target-lanes/worker-a/debug/incremental"}
        for cache in expected:
            cache.mkdir(parents=True)
        # Custom qualification targets and source-looking directories stay excluded.
        (repo / "target/c3-witness/debug/incremental").mkdir(parents=True)
        (repo / "source/debug/incremental").mkdir(parents=True)
        self.assertEqual(set(cleanup.discover(repo)), expected)

    def test_candidate_default_target_discovered(self):
        nested = self.repo / "target/engineering-delivery/candidates/source-a/target/debug/incremental"
        nested.mkdir(parents=True)
        self.assertEqual(set(cleanup.discover(self.repo)), {self.cache, nested})

    def test_canonical_and_lane_symlinks_refused(self):
        repo = self.repo / "standalone"
        repo.mkdir()
        (repo / "target").symlink_to(self.profile.parent, target_is_directory=True)
        with self.assertRaises(ValueError):
            cleanup.discover(repo)
        (repo / "target").unlink()
        lanes = repo / "target-lanes"
        lanes.mkdir()
        (lanes / "escape").symlink_to(self.profile.parent, target_is_directory=True)
        with self.assertRaises(ValueError):
            cleanup.discover(repo)

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


class ArchivedObjectTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.profile = self.repo / "target/engineering-delivery/candidates/source-a/target/engineering-delivery/builds/lane/debug"
        self.out = self.profile / "build/oxrocksdb-sys-0123456789abcdef/out"
        self.out.mkdir(parents=True)
        self.lock = self.profile / ".cargo-lock"
        self.lock.touch()
        (self.out.parent / "output").write_text("".join(
            f"cargo:rustc-link-lib=static={name}\n" for name in ("rocksdb", "oxrocksdb_api", "lz4")))
        (self.out.parent / "root-output").write_text(str(self.out))
        # Long names exercise the GNU archive name table used by cc object names.
        self.objects = {"librocksdb.a": ["0123456789abcdef-long_table_builder.o", "a.o"],
                        "liboxrocksdb_api.a": ["api.o"], "liblz4.a": ["lz4.o"]}
        for archive, names in self.objects.items():
            for index, name in enumerate(names):
                (self.out / name).write_bytes(name.encode() * (index + 3))
            self.archive(archive, names)
        for name in ("bindings.rs", "flag_check", "flag_check.cpp"):
            (self.out / name).write_text("keep")
        self.age(1)

    def archive(self, archive, names, flags="crs"):
        (self.out / archive).unlink(missing_ok=True)
        subprocess.run(["ar", flags, archive, *names], cwd=self.out, check=True)

    def paths(self):
        return [self.out / name for names in self.objects.values() for name in names]

    def age(self, when):
        for path in [*self.out.iterdir(), *self.out.parent.iterdir()]:
            os.utime(path, (when, when))

    def clean(self, apply=True):
        return cleanup.clean_one(self.profile / "incremental", 3600, apply, objects=True)

    def assert_retained(self, status=None):
        if status:
            self.assertEqual(self.clean()["objects"], 0)
        self.assertTrue(all(path.exists() for path in self.paths()))

    def test_identical_objects_removed_and_rest_preserved(self):
        kept = {path: path.stat().st_ino for path in [self.lock, *self.out.iterdir(), *self.out.parent.iterdir()]
                if path.suffix != ".o"}
        self.assertEqual(self.clean(False)["status"], "eligible")
        self.assert_retained()
        result = self.clean()
        self.assertEqual((result["status"], result["objects"]), ("cleaned", 4))
        self.assertFalse(any(path.exists() for path in self.paths()))
        self.assertEqual({path: path.stat().st_ino for path in kept}, kept)
        self.assertEqual(cleanup.discover(self.repo, True), [self.profile / "incremental"])

    def test_same_size_different_bytes_retained(self):
        path = self.out / "a.o"
        path.write_bytes(bytes(reversed(path.read_bytes())))
        self.age(1)
        self.assert_retained("content-differs")

    def test_truncated_archive_retained(self):
        archive = self.out / "librocksdb.a"
        os.truncate(archive, archive.stat().st_size - 4)
        self.age(1)
        self.assert_retained("content-differs")

    def test_thin_duplicate_and_ambiguous_archives_refused(self):
        for build in (lambda: self.archive("liblz4.a", ["lz4.o"], "crsT"),
                      lambda: subprocess.run(["ar", "q", "liblz4.a", "lz4.o"], cwd=self.out, check=True),
                      lambda: self.archive("liblz4.a", ["lz4.o", "a.o"])):
            self.setUp()
            build()
            self.age(1)
            with self.assertRaises(ValueError):
                self.clean()
            self.assert_retained()

    def test_unsupported_producer_and_contract_retained(self):
        other = self.profile / "build/ring-0123456789abcdef"
        self.out.parent.rename(other)
        self.assertEqual(self.clean()["status"], "cleaned")
        self.assertTrue((other / "out/a.o").exists())
        self.assertEqual(cleanup.archived_objects(other / "out", 3600, time.time(), None)[1],
                         "unsupported-producer")
        output = lambda: self.out.parent / "output"
        for change in (lambda: (self.out / "extra.dat").write_text("unknown"),
                       lambda: output().write_text("cargo:rustc-link-lib=static=rocksdb\n"),
                       lambda: output().write_text(output().read_text() + f"cargo:rustc-link-arg={self.out}/a.o\n"),
                       lambda: (self.out.parent / "root-output").write_text("/elsewhere")):
            self.setUp()
            change()
            self.age(1)
            self.assert_retained("unsupported-contract")

    def test_unarchived_incomplete_busy_and_recent_retained(self):
        (self.out / "extra.o").write_bytes(b"not archived")
        self.age(1)
        self.assert_retained("unarchived")
        self.setUp()
        (self.out.parent / "output").unlink()
        self.assert_retained("incomplete-build-script")
        self.setUp()
        os.utime(self.out / "bindings.rs")
        self.assert_retained("recent")
        self.setUp()
        with self.lock.open("r+") as handle:
            fcntl.flock(handle, fcntl.LOCK_SH)
            self.assertEqual(self.clean()["status"], "busy")
        self.assert_retained()

    def test_links_and_mount_crossings_refused(self):
        os.link(self.out / "a.o", self.repo / "retained.o")
        with self.assertRaises(ValueError):
            self.clean()
        (self.repo / "retained.o").unlink()
        (self.out / "a.o").unlink()
        (self.out / "a.o").symlink_to(self.out / "api.o")
        with self.assertRaises(ValueError):
            self.clean()
        self.setUp()
        mounts = {"/": "1", str(self.repo): "2", str(self.out / "a.o"): "3"}
        with patch.object(cleanup, "mount_table", return_value=mounts):
            with self.assertRaises(ValueError):
                cleanup.clean_one(self.profile / "incremental", 3600, True, expected_mount="2", objects=True)
        self.assert_retained()
        elsewhere = self.repo / "elsewhere"
        self.out.rename(elsewhere)
        self.out.symlink_to(elsewhere)
        with self.assertRaises(ValueError):
            self.clean()
        self.assertTrue((elsewhere / "librocksdb.a").exists())

    def test_minimum_age_floor_enforced(self):
        with self.assertRaises(ValueError):
            cleanup.clean_one(self.profile / "incremental", 60, True, objects=True)
        self.assert_retained()

if __name__ == "__main__":
    unittest.main()
