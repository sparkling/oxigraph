import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertCleanQualificationWorktree,
  cleanupMutationEnvironment,
  createMutationEnvironment,
  DEFAULT_OUTER_TIMEOUT_MS,
} from "./runtime-policy.mjs";

function temporaryDirectory() {
  return realpathSync(mkdtempSync(join(tmpdir(), "mutation-runtime-policy-")));
}

function initializeRepository(root) {
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Mutation Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "mutation@example.invalid"], {
    cwd: root,
  });
  writeFileSync(join(root, ".gitignore"), "ignored-product.rs\n");
  writeFileSync(join(root, "tracked.txt"), "tracked\n");
  execFileSync("git", ["add", ".gitignore", "tracked.txt"], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
}

test("qualification defaults cover the historical full-run envelope", () => {
  assert.equal(DEFAULT_OUTER_TIMEOUT_MS, 5_400_000);
});

test("qualification requires a clean Git worktree", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    assert.doesNotThrow(() => assertCleanQualificationWorktree(root));
    writeFileSync(join(root, "untracked.txt"), "dirty\n");
    assert.throws(
      () => assertCleanQualificationWorktree(root),
      /clean disposable worktree.*untracked\.txt/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("qualification rejects hidden index flags and ignored product files", () => {
  const root = temporaryDirectory();
  try {
    initializeRepository(root);
    execFileSync("git", ["update-index", "--skip-worktree", "tracked.txt"], {
      cwd: root,
    });
    assert.throws(
      () => assertCleanQualificationWorktree(root),
      /skip-worktree.*tracked\.txt/,
    );
    execFileSync("git", ["update-index", "--no-skip-worktree", "tracked.txt"], {
      cwd: root,
    });
    execFileSync(
      "git",
      ["update-index", "--assume-unchanged", "tracked.txt"],
      { cwd: root },
    );
    assert.throws(
      () => assertCleanQualificationWorktree(root),
      /assume-unchanged.*tracked\.txt/,
    );
    execFileSync(
      "git",
      ["update-index", "--no-assume-unchanged", "tracked.txt"],
      { cwd: root },
    );
    const ignored = join(root, "ignored-product.rs");
    writeFileSync(ignored, "ignored but executable product input\n");
    assert.throws(
      () => assertCleanQualificationWorktree(root),
      /ignored untracked paths.*ignored-product\.rs/,
    );
    assert.equal(existsSync(ignored), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cargo-mutants receives a run-scoped temporary directory under target", () => {
  const root = temporaryDirectory();
  const outside = temporaryDirectory();
  const runId = "00000000-0000-4000-8000-000000000000";
  try {
    const environment = createMutationEnvironment(root, runId, {
      baseEnvironment: { PATH: "/test/bin" },
    });
    const expected = realpathSync(
      join(root, "target", "cargo-mutants-tmp", runId),
    );
    assert.equal(environment.PATH, "/test/bin");
    assert.equal(environment.TMPDIR, expected);
    assert.equal(environment.TMP, expected);
    assert.equal(environment.TEMP, expected);
    assert.throws(
      () =>
        createMutationEnvironment(root, runId, {
          baseEnvironment: {},
        }),
      /refusing to reuse exclusive directory/,
    );
    cleanupMutationEnvironment(root, environment);
    assert.equal(existsSync(expected), false);
    assert.throws(
      () =>
        cleanupMutationEnvironment(root, {
          TMPDIR: outside,
          TMP: outside,
          TEMP: outside,
        }),
      /mutation temporary directory binding is invalid/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
