import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeCandidatePatch,
  validateCandidatePatch,
} from "../src/policy/paths.mjs";

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

test("patch canonicalization repairs only mechanical hunk syntax", () => {
  const path = "lib/oxigraph/src/storage/rocksdb_wrapper.rs";
  const raw = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -10,99 +10,1 @@ function",
    " first",
    "",
    "-old",
    "+new",
    " last",
    "",
  ].join("\r\n");
  const canonical = canonicalizeCandidatePatch(raw);
  assert.match(canonical, /@@ -10,4 \+10,4 @@ function\n first\n \n-old\n\+new\n last\n$/);
  assert.deepEqual(validateCandidatePatch(canonical, contract), [path]);
  assert.equal(canonicalizeCandidatePatch(canonical), canonical);
});

test("patch canonicalization rejects ambiguous content and binary line endings", () => {
  const path = "lib/oxigraph/src/storage/rocksdb_wrapper.rs";
  const prefix =
    `diff --git a/${path} b/${path}\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n` +
    "@@ -1 +1 @@\n";
  assert.throws(
    () => canonicalizeCandidatePatch(`${prefix}unmarked\n`),
    /non-empty unmarked/,
  );
  assert.throws(
    () => canonicalizeCandidatePatch(`${prefix}-old\r+new\n`),
    /bare carriage returns/,
  );
  assert.throws(
    () => canonicalizeCandidatePatch(`${prefix}-old\n+new\0\n`),
    /NUL/,
  );
  assert.throws(
    () => canonicalizeCandidatePatch(`\`\`\`diff\n${prefix}-old\n+new\n\`\`\`\n`),
    /non-empty unmarked/,
  );
  assert.throws(
    () => canonicalizeCandidatePatch(`${prefix}\n-old\n+new\n`),
    /leading or trailing blank/,
  );
  assert.throws(
    () => canonicalizeCandidatePatch(`${prefix}-old\n+new\n\n`),
    /leading or trailing blank/,
  );
  assert.throws(
    () =>
      canonicalizeCandidatePatch(
        `${prefix}-old\n+new\n\n@@ -3 +3 @@\n-old-again\n+new-again\n`,
      ),
    /leading or trailing blank/,
  );
  assert.throws(
    () =>
      canonicalizeCandidatePatch(
        `${prefix}-old\n+new\n\n` +
          `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n` +
          "@@ -3 +3 @@\n-old-again\n+new-again\n",
      ),
    /leading or trailing blank/,
  );
  assert.throws(
    () => canonicalizeCandidatePatch(`${prefix}\\ No newline at end of file\n`),
    /no-newline marker is misplaced/,
  );
  assert.throws(
    () =>
      canonicalizeCandidatePatch(
        `${prefix}-old\n\\ No newline at end of file\n` +
          "\\ No newline at end of file\n+new\n",
      ),
    /no-newline marker is misplaced/,
  );
  assert.throws(
    () => canonicalizeCandidatePatch(`${prefix}-old\n+new\n@@ -12345678901 +2 @@\n-a\n+b\n`),
    /numeric bound/,
  );
  const noNewline =
    `${prefix}-old\n\\ No newline at end of file\n` +
    "+new\n\\ No newline at end of file\n";
  assert.equal(canonicalizeCandidatePatch(noNewline), noNewline);
  assert.deepEqual(validateCandidatePatch(noNewline, contract), [path]);
});

test("canonical patch identity has one terminal LF and exact hunk counts", () => {
  const path = "lib/oxigraph/src/storage/rocksdb_wrapper.rs";
  const raw =
    `diff --git a/${path} b/${path}\n` +
    `--- a/${path}\n` +
    `+++ b/${path}\n` +
    "@@ -01,90 +01,80 @@\n-old\n+new\n" +
    "@@ -3,9 +3,9 @@\n context\n-old-again\n+new-again";
  const canonical = canonicalizeCandidatePatch(raw);
  assert.equal(
    canonical,
    `diff --git a/${path} b/${path}\n` +
      `--- a/${path}\n` +
      `+++ b/${path}\n` +
      "@@ -1 +1 @@\n-old\n+new\n" +
      "@@ -3,2 +3,2 @@\n context\n-old-again\n+new-again\n",
  );
  assert.equal(canonicalizeCandidatePatch(canonical), canonical);
  assert.throws(
    () => validateCandidatePatch(canonical.slice(0, -1), contract),
    /canonical form/,
  );
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
    /canonical form|unbound|does not match/,
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
