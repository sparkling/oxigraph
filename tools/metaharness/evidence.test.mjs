import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  changedInputs,
  comparePortablePaths,
  darwinLockResolution,
  darwinInstallationSnapshot,
  ensureDirectoryInside,
  protectedInputs,
  sha256,
  snapshotRoots,
  validateDarwinLockPolicy,
  validateMutationQualification,
  writeJsonAtomic,
} from "./evidence.mjs";
import {
  MUTATION_RECEIPT_SCHEMA_VERSION,
  mutationReceiptContentHash,
  mutationReceiptExecutionHash,
  sha256 as mutationSha256,
} from "../mutation/evidence.mjs";
import { createMutationPublication } from "../mutation/publication.mjs";

const toolDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
const repoRoot = realpathSync(resolve(toolDir, "../.."));

function temporaryDirectory() {
  return realpathSync(mkdtempSync(join(tmpdir(), "metaharness-evidence-test-")));
}

const mutationRunId = "00000000-0000-4000-8000-000000000000";
const fixtureCargoMutantsVersion = "99.88.77";

function mutationCounts() {
  return {
    generated: 1,
    caught: 1,
    missed: 0,
    timeout: 0,
    unviable: 0,
    viable: 1,
  };
}

function mutationPhase(name, status) {
  const packageArg = "--package=oxdatalog@0.1.0-dev";
  return {
    phase: name,
    duration: 0.5,
    process_status: status,
    argv:
      name === "Build"
        ? ["/test/cargo", "test", "--no-run", "--verbose", packageArg, "--all-features"]
        : ["/test/cargo", "test", "--verbose", packageArg, "--all-features", "--all-targets"],
  };
}

function mutationFixture() {
  const mutant = {
    name: "lib/oxdatalog/src/engine.rs:10:1: replace value with false",
    package: "oxdatalog",
    file: "lib/oxdatalog/src/engine.rs",
    function: null,
    span: {
      start: { line: 10, column: 1 },
      end: { line: 10, column: 5 },
    },
    replacement: "false",
    genre: "BinaryOperator",
  };
  const outcomes = {
    outcomes: [
      {
        scenario: "Baseline",
        summary: "Success",
        log_path: "log/baseline.log",
        diff_path: null,
        phase_results: [
          mutationPhase("Build", "Success"),
          mutationPhase("Test", "Success"),
        ],
      },
      {
        scenario: { Mutant: mutant },
        summary: "CaughtMutant",
        log_path: "log/mutant-10.log",
        diff_path: "diff/mutant-10.diff",
        phase_results: [
          mutationPhase("Build", "Success"),
          mutationPhase("Test", { Failure: 101 }),
        ],
      },
    ],
    total_mutants: 1,
    missed: 0,
    caught: 1,
    timeout: 0,
    unviable: 0,
    success: 0,
    start_time: "2026-07-27T00:00:00.000000Z",
    end_time: "2026-07-27T00:01:00.000000Z",
    cargo_mutants_version: fixtureCargoMutantsVersion,
  };
  const inventory = [{ diff: "--- before\n+++ after\n", ...mutant }];
  const outcomeBytes = Buffer.from(JSON.stringify(outcomes));
  const inventoryBytes = Buffer.from(JSON.stringify(inventory));
  const configBytes = Buffer.from("[test]\n");
  const files = [{
    path: "tools/mutation/oxdatalog.toml",
    sha256: mutationSha256(configBytes),
    bytes: configBytes.length,
  }];
  const currentSnapshot = {
    algorithm: "sha256",
    contentHash: mutationSha256(JSON.stringify(files)),
    fileCount: 1,
    roots: ["tools/mutation"],
    files,
  };
  const runtime = ["cargo", "cargo-mutants", "rustc"].map((program) => ({
    program,
    invokedPath: program === "cargo" ? "/test/cargo" : `/test/${program}`,
    path: program === "cargo" ? "/test/cargo" : `/test/${program}`,
    executableSha256: "b".repeat(64),
    version:
      program === "cargo-mutants"
        ? `cargo-mutants ${fixtureCargoMutantsVersion}`
        : `${program} test`,
  }));
  const runRoot = `target/mutation/oxdatalog/native/${mutationRunId}/mutants.out`;
  const receipt = {
    schemaVersion: MUTATION_RECEIPT_SCHEMA_VERSION,
    runId: mutationRunId,
    profile: "oxdatalog-d2-complete",
    gateClosed: true,
    baselinePassed: true,
    baselineSummary: "Success",
    cargoMutantsVersion: fixtureCargoMutantsVersion,
    expectedCargoMutantsVersion: fixtureCargoMutantsVersion,
    command: {
      status: 0,
      signal: null,
      timedOut: false,
      outerTimeoutMs: 3_600_000,
      startedAt: "2026-07-26T23:59:59.000Z",
      endedAt: "2026-07-27T00:01:01.000Z",
      durationMs: 62_000,
    },
    runtime,
    startedAt: outcomes.start_time,
    endedAt: outcomes.end_time,
    protectedInputs: {
      before: currentSnapshot,
      after: currentSnapshot,
      stable: true,
      changedPaths: [],
    },
    counts: mutationCounts(),
    mutationScorePercent: 100,
    evidence: {
      nativeOutcomes: `${runRoot}/outcomes.json`,
      nativeOutcomesSha256: mutationSha256(outcomeBytes),
      nativeInventory: `${runRoot}/mutants.json`,
      nativeInventorySha256: mutationSha256(inventoryBytes),
      config: "tools/mutation/oxdatalog.toml",
      configSha256: mutationSha256(configBytes),
    },
    publication: createMutationPublication(mutationRunId, {
      outcomeBytes,
      inventoryBytes,
      configBytes,
    }),
    limitations: ["test fixture"],
  };
  receipt.contentHash = mutationReceiptContentHash(receipt);
  receipt.executionHash = mutationReceiptExecutionHash(receipt);
  return {
    receipt,
    inputs: {
      currentSnapshot,
      outcomes,
      inventory,
      outcomeBytes,
      inventoryBytes,
      configBytes,
      expectedVersion: fixtureCargoMutantsVersion,
      expectedRuntime: runtime,
    },
  };
}

test("qualification protects every gate implementation and workflow surface", () => {
  for (const required of [
    ".github/workflows/tests.yml",
    "README.md",
    "js",
    "lib",
    "tools/agentic-qe",
    "tools/child-environment.mjs",
    "tools/dependency-policy.mjs",
    "tools/evidence",
    "tools/jena-parity",
    "tools/metaharness",
    "tools/mutation",
    "tools/w3c-tests",
  ]) {
    assert.ok(protectedInputs.includes(required), `missing ${required}`);
  }
});

test("latest Darwin policy resolves to an exact integrity-bound local package", () => {
  const fixtureManifest = {
    dependencies: { "@metaharness/darwin": "latest" },
  };
  const fixtureLock = {
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "@metaharness/darwin": "latest" } },
      "node_modules/@metaharness/darwin": {
        version: "1.2.3",
        resolved:
          "https://registry.npmjs.org/@metaharness/darwin/-/darwin-1.2.3.tgz",
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      },
    },
  };
  assert.equal(
    validateDarwinLockPolicy(fixtureManifest, fixtureLock).version,
    "1.2.3",
  );
  assert.throws(() =>
    validateDarwinLockPolicy(
      fixtureManifest,
      {
        ...fixtureLock,
        packages: {
          ...fixtureLock.packages,
          "node_modules/@metaharness/darwin": {
            version: "1.2.3",
            resolved:
              "https://registry.npmjs.org/@metaharness/darwin/-/darwin-1.2.3.tgz",
            integrity: "sha512-not-canonical",
          },
        },
      },
    ),
  );

  const policyRoot = temporaryDirectory();
  try {
    const adapter = join(policyRoot, "adapter");
    mkdirSync(adapter);
    writeFileSync(
      join(adapter, "package.json"),
      `${JSON.stringify(fixtureManifest)}\n`,
    );
    writeFileSync(
      join(adapter, "package-lock.json"),
      `${JSON.stringify(fixtureLock)}\n`,
    );
    writeFileSync(join(adapter, ".npmrc"), "ignore-scripts=true\n");
    assert.match(
      darwinLockResolution(policyRoot, adapter).npmrcSha256,
      /^[0-9a-f]{64}$/,
    );
    writeFileSync(join(adapter, ".npmrc"), "ignore-scripts=false\n");
    assert.throws(
      () => darwinLockResolution(policyRoot, adapter),
      /disable lifecycle scripts/,
    );
    writeFileSync(
      join(adapter, ".npmrc"),
      "ignore-scripts=true\nregistry=https://attacker.invalid\n",
    );
    assert.throws(
      () => darwinLockResolution(policyRoot, adapter),
      /disable lifecycle scripts/,
    );
  } finally {
    rmSync(policyRoot, { recursive: true, force: true });
  }

  const installation = darwinInstallationSnapshot(repoRoot, toolDir);
  const manifest = JSON.parse(
    readFileSync(
      join(toolDir, "node_modules", "@metaharness", "darwin", "package.json"),
    ),
  );
  assert.equal(installation.name, "@metaharness/darwin");
  assert.equal(installation.policy, "latest");
  assert.equal(installation.version, manifest.version);
  assert.match(installation.integrity, /^sha512-/);
  assert.match(installation.lockfileSha256, /^[0-9a-f]{64}$/);
  assert.match(installation.npmrcSha256, /^[0-9a-f]{64}$/);
  assert.match(installation.contentHash, /^[0-9a-f]{64}$/);
  assert.match(installation.entrySha256, /^[0-9a-f]{64}$/);
  assert.ok(installation.fileCount > 0);
});

test("output containment rejects symlink components and symlink receipts", () => {
  const root = temporaryDirectory();
  const outside = temporaryDirectory();
  try {
    symlinkSync(outside, join(root, "escape"));
    assert.throws(
      () => ensureDirectoryInside(root, join(root, "escape", "child")),
      /symbolic link/,
    );

    mkdirSync(join(root, "safe"));
    const outsideReceipt = join(outside, "qualification.json");
    writeFileSync(outsideReceipt, "outside\n");
    symlinkSync(outsideReceipt, join(root, "safe", "qualification.json"));
    assert.throws(
      () =>
        writeJsonAtomic(
          join(root, "safe", "qualification.json"),
          { passed: true },
          root,
        ),
      /non-regular receipt/,
    );
    assert.equal(readFileSync(outsideReceipt, "utf8"), "outside\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("protected snapshots expose changed and added files", () => {
  const root = temporaryDirectory();
  try {
    mkdirSync(join(root, "inputs"));
    writeFileSync(join(root, "inputs", "before.txt"), "before\n");
    const before = snapshotRoots(root, ["inputs"]);
    writeFileSync(join(root, "inputs", "before.txt"), "after\n");
    writeFileSync(join(root, "inputs", "added.txt"), "added\n");
    const after = snapshotRoots(root, ["inputs"]);
    assert.notEqual(before.contentHash, after.contentHash);
    assert.deepEqual(changedInputs(before, after), [
      "inputs/added.txt",
      "inputs/before.txt",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("protected snapshots use locale-independent UTF-16 code-unit ordering", () => {
  const root = temporaryDirectory();
  try {
    mkdirSync(join(root, "inputs"));
    for (const name of [
      "-dash",
      ".dot",
      "0-digit",
      "build.rs",
      "Cargo.toml",
      "_underscore",
      "a-lower",
      "A-upper",
      "z-last",
    ]) {
      writeFileSync(join(root, "inputs", name), `${name}\n`);
    }

    const expected = [
      "inputs/-dash",
      "inputs/.dot",
      "inputs/0-digit",
      "inputs/A-upper",
      "inputs/Cargo.toml",
      "inputs/_underscore",
      "inputs/a-lower",
      "inputs/build.rs",
      "inputs/z-last",
    ];
    const snapshot = snapshotRoots(root, ["inputs"]);
    assert.deepEqual(snapshot.files.map(({ path }) => path), expected);
    assert.equal(snapshot.contentHash, sha256(JSON.stringify(snapshot.files)));
    assert.deepEqual([...expected].sort(comparePortablePaths), expected);
    assert.ok(comparePortablePaths("cli/build.rs", "cli/Cargo.toml") > 0);
    assert.deepEqual(
      ["é", "z", "e\u0301", "a", "_x", "A", "0", ".x", "-x"].sort(
        comparePortablePaths,
      ),
      ["-x", ".x", "0", "A", "_x", "a", "e\u0301", "z", "é"],
    );
    assert.ok(comparePortablePaths("e\u0301", "é") < 0);
    assert.equal(comparePortablePaths("same", "same"), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("protected snapshots reject overlapping roots instead of emitting duplicates", () => {
  const root = temporaryDirectory();
  try {
    mkdirSync(join(root, "inputs"));
    writeFileSync(join(root, "inputs", "file.txt"), "protected\n");
    assert.throws(
      () => snapshotRoots(root, ["inputs", "inputs/file.txt"]),
      /protected input roots overlap/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("protected snapshots sort the emitted portable path across nested and sibling names", () => {
  const root = temporaryDirectory();
  try {
    mkdirSync(join(root, "inputs", "a"), { recursive: true });
    for (const name of ["a-z", "a.b", "a0", "a_b"]) {
      writeFileSync(join(root, "inputs", name), `${name}\n`);
    }
    writeFileSync(join(root, "inputs", "a", "b"), "nested\n");
    assert.deepEqual(
      snapshotRoots(root, ["inputs"]).files.map(({ path }) => path),
      [
        "inputs/a-z",
        "inputs/a.b",
        "inputs/a/b",
        "inputs/a0",
        "inputs/a_b",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("protected snapshots bind safe in-repository file symlinks", () => {
  const root = temporaryDirectory();
  try {
    mkdirSync(join(root, "inputs"));
    writeFileSync(join(root, "inputs", "target.txt"), "before\n");
    symlinkSync("target.txt", join(root, "inputs", "alias.txt"));

    const before = snapshotRoots(root, ["inputs"]);
    const alias = before.files.find((item) => item.path === "inputs/alias.txt");
    assert.deepEqual(
      {
        kind: alias?.kind,
        linkTarget: alias?.linkTarget,
        target: alias?.target,
      },
      {
        kind: "symlink",
        linkTarget: "target.txt",
        target: "inputs/target.txt",
      },
    );

    writeFileSync(join(root, "inputs", "target.txt"), "after\n");
    const after = snapshotRoots(root, ["inputs"]);
    assert.notEqual(before.contentHash, after.contentHash);
    assert.deepEqual(changedInputs(before, after), [
      "inputs/alias.txt",
      "inputs/target.txt",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("protected snapshots reject symlinks that escape the repository", () => {
  const root = temporaryDirectory();
  const outside = temporaryDirectory();
  try {
    writeFileSync(join(outside, "target.txt"), "outside\n");
    mkdirSync(join(root, "inputs"));
    symlinkSync(join(outside, "target.txt"), join(root, "inputs", "escape.txt"));
    assert.throws(
      () => snapshotRoots(root, ["inputs"]),
      /symlink escapes repository/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("protected snapshots skip only explicit generated Python directories", () => {
  const root = temporaryDirectory();
  const outside = temporaryDirectory();
  try {
    mkdirSync(join(root, "inputs", ".venv", "bin"), { recursive: true });
    mkdirSync(join(root, "inputs", "__pycache__"), { recursive: true });
    writeFileSync(join(root, "inputs", "source.txt"), "protected\n");
    writeFileSync(join(root, "inputs", "__pycache__", "source.pyc"), "generated\n");
    writeFileSync(join(outside, "python"), "generated interpreter\n");
    symlinkSync(
      join(outside, "python"),
      join(root, "inputs", ".venv", "bin", "python"),
    );

    const snapshot = snapshotRoots(root, ["inputs"]);
    assert.deepEqual(
      snapshot.files.map((item) => item.path),
      ["inputs/source.txt"],
    );

    symlinkSync(join(outside, "python"), join(root, "inputs", "escape.txt"));
    assert.throws(
      () => snapshotRoots(root, ["inputs"]),
      /symlink escapes repository/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("protected snapshots skip only repository-relative js/pkg generated output", () => {
  const root = temporaryDirectory();
  try {
    mkdirSync(join(root, "js", "pkg"), { recursive: true });
    mkdirSync(join(root, "js", "src"), { recursive: true });
    mkdirSync(join(root, "lib", "pkg"), { recursive: true });
    writeFileSync(join(root, "js", "pkg", "generated.wasm"), "generated\n");
    writeFileSync(join(root, "js", "src", "lib.rs"), "source-before\n");
    writeFileSync(join(root, "lib", "pkg", "protected.wasm"), "protected-before\n");

    const before = snapshotRoots(root, ["js", "lib"]);
    assert.deepEqual(
      before.files.map((item) => item.path),
      ["js/src/lib.rs", "lib/pkg/protected.wasm"],
    );

    writeFileSync(join(root, "js", "pkg", "generated.wasm"), "regenerated\n");
    const afterGeneratedChange = snapshotRoots(root, ["js", "lib"]);
    assert.equal(afterGeneratedChange.contentHash, before.contentHash);

    writeFileSync(join(root, "js", "src", "lib.rs"), "source-after\n");
    writeFileSync(join(root, "lib", "pkg", "protected.wasm"), "protected-after\n");
    const afterProtectedChanges = snapshotRoots(root, ["js", "lib"]);
    assert.deepEqual(changedInputs(before, afterProtectedChanges), [
      "js/src/lib.rs",
      "lib/pkg/protected.wasm",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repository-relative js/pkg symlinks remain subject to safety checks", () => {
  const root = temporaryDirectory();
  const outside = temporaryDirectory();
  try {
    mkdirSync(join(root, "js"));
    writeFileSync(join(outside, "generated.wasm"), "outside\n");
    symlinkSync(outside, join(root, "js", "pkg"));
    assert.throws(
      () => snapshotRoots(root, ["js"]),
      /symlink escapes repository/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("mutation qualification rejects stale inputs and survivors", () => {
  const { receipt, inputs } = mutationFixture();
  assert.doesNotThrow(() => validateMutationQualification(receipt, inputs));
  assert.throws(
    () =>
      validateMutationQualification(
        { ...receipt, counts: { ...receipt.counts, missed: 1 } },
        inputs,
      ),
    /native evidence contract/,
  );
  assert.throws(
    () =>
      validateMutationQualification(receipt, {
        ...inputs,
        currentSnapshot: {
          ...inputs.currentSnapshot,
          contentHash: "c".repeat(64),
        },
      }),
    /current-source contract/,
  );
});
