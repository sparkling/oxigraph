import os
from pathlib import Path
import re
import subprocess
import tempfile
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[2]


class CargoStorageProfileTest(unittest.TestCase):
    def test_effective_dev_and_test_profiles(self):
        manifest = (ROOT / "Cargo.toml").read_text()
        profiles = tomllib.loads(manifest)["profile"]
        self.assertEqual(profiles["dev"]["debug"], 1)
        self.assertIs(profiles["dev"]["incremental"], False)
        self.assertEqual(profiles["dev"]["package"]["oxrocksdb-sys"]["debug"], 0)
        self.assertEqual(profiles["release"]["panic"], "abort")
        self.assertIs(profiles["release"]["lto"], True)
        self.assertEqual(profiles["release"]["codegen-units"], 1)
        env = {key: value for key, value in os.environ.items()
               if not key.startswith("CARGO_PROFILE_")
               and key not in {"CARGO_INCREMENTAL", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS"}}
        with tempfile.TemporaryDirectory(prefix="cargo-storage-profile-") as directory:
            fixture = Path(directory)
            dependency = fixture / "oxrocksdb-sys"
            dependency.mkdir()
            (fixture / "Cargo.toml").write_text(
                '[package]\nname="storage-profile-proof"\nversion="0.1.0"\nedition="2021"\n'
                '[lib]\npath="lib.rs"\n[workspace]\nmembers=["oxrocksdb-sys"]\n'
                '[dependencies]\noxrocksdb-sys={path="oxrocksdb-sys"}\n'
                + manifest[manifest.index("[profile."):])
            (fixture / "lib.rs").write_text(
                'pub fn value() -> u8 { oxrocksdb_sys::value() }\n'
                '#[test] fn profile_retains_assertions() { '
                'assert!(cfg!(debug_assertions)); assert_eq!(value(), 1); }\n')
            (dependency / "Cargo.toml").write_text(
                '[package]\nname="oxrocksdb-sys"\nversion="0.1.0"\nedition="2021"\n'
                '[lib]\npath="lib.rs"\n')
            (dependency / "lib.rs").write_text('pub fn value() -> u8 { 1 }\n')
            (dependency / "build.rs").write_text(
                'fn main() { println!("cargo:warning=STORAGE_PROFILE_DEBUG={}", '
                'std::env::var("DEBUG").unwrap()); }\n')
            for command in ("build", "test"):
                with self.subTest(command=command):
                    result = subprocess.run(
                        ["cargo", command, "--offline", "-vv", "--target-dir",
                         str(fixture / f"target-{command}")], cwd=fixture, env=env,
                        capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    invocations = [line for line in result.stderr.splitlines()
                                   if "--crate-name storage_profile_proof" in line
                                   and re.search(r"(?:^|[ /])rustc(?:\.exe)? ", line)]
                    self.assertTrue(invocations, result.stderr)
                    self.assertTrue(all("-C debuginfo=1" in line for line in invocations))
                    self.assertTrue(all("-C incremental=" not in line for line in invocations))
                    self.assertIn("STORAGE_PROFILE_DEBUG=false", result.stderr)
