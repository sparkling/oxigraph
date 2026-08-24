import assert from "node:assert/strict";
import test from "node:test";
import { validateCandidatePatch } from "../src/policy/paths.mjs";

const contract = Object.freeze({
  evaluatorPath: "lib/oxigraph/tests/transaction_concurrency.rs",
  mutablePaths: ["lib/oxigraph/src/storage", "lib/oxigraph/src/store.rs"],
  blockedPaths: ["lib/oxigraph/src/storage/oracle.rs"],
  ceilings: { maxPatchBytes: 4096 },
});

function patch(path) {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new\n`;
}

test("path policy admits only exact task-owned product paths", () => {
  assert.deepEqual(
    validateCandidatePatch(patch("lib/oxigraph/src/storage/rocksdb_wrapper.rs"), contract),
    ["lib/oxigraph/src/storage/rocksdb_wrapper.rs"],
  );
  for (const path of [
    "docs/adr/0018-transaction-guarantees-and-conflict-model.md",
    "lib/oxigraph/tests/transaction_concurrency.rs",
    "lib/oxigraph/src/storage/oracle.rs",
    "Cargo.toml",
    "../outside.rs",
  ]) {
    assert.throws(() => validateCandidatePatch(patch(path), contract));
  }
});

test("path policy rejects rename, mode, symlink, and oversized patches", () => {
  assert.throws(
    () => validateCandidatePatch("diff --git a/a b/b\nrename from a\nrename to b\n", contract),
    /rename/,
  );
  assert.throws(
    () =>
      validateCandidatePatch(
        "diff --git a/lib/oxigraph/src/store.rs b/lib/oxigraph/src/store.rs\nnew file mode 120000\n",
        contract,
      ),
    /symlinks|modes/,
  );
  assert.throws(
    () => validateCandidatePatch(patch("lib/oxigraph/src/store.rs") + "x".repeat(5000), contract),
    /exceeds/,
  );
  assert.throws(
    () =>
      validateCandidatePatch(
        `${patch("lib/oxigraph/src/store.rs")}--- a/docs/adr/0018-transaction-guarantees-and-conflict-model.md\n+++ b/docs/adr/0018-transaction-guarantees-and-conflict-model.md\n@@ -1 +1 @@\n-old\n+new\n`,
        contract,
      ),
    /unbound|does not match/,
  );
  assert.throws(
    () =>
      validateCandidatePatch(
        "diff --git a/lib/oxigraph/src/store.rs b/lib/oxigraph/src/store.rs\nGIT binary patch\nliteral 1\nA\n",
        contract,
      ),
    /binary/,
  );
  assert.throws(
    () =>
      validateCandidatePatch(
        "diff --git a/lib/oxigraph/src/store.rs b/lib/oxigraph/src/store.rs\nindex 1234567..89abcde 120000\n--- a/lib/oxigraph/src/store.rs\n+++ b/lib/oxigraph/src/store.rs\n@@ -1 +1 @@\n-old\n+new\n",
        contract,
      ),
    /symlinks|submodules/,
  );
  assert.throws(
    () =>
      validateCandidatePatch(
        "diff --git a/lib/oxigraph/src/store.rs b/lib/oxigraph/src/store.rs\n--- a/lib/oxigraph/src/store.rs\n+++ b/lib/oxigraph/src/store.rs\n",
        contract,
      ),
    /incomplete/,
  );
  assert.throws(
    () => validateCandidatePatch(patch("cargo.toml"), contract),
    /protected/,
  );
});
