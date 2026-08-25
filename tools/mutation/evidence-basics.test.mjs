import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  linkSync,
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
  createExclusiveDirectoryInside,
  ensureDirectoryInside,
  executableProvenance,
  parseCargoMutantsVersion,
  readStableFileBytes,
  snapshotProtectedInputs,
  validateOutcomes,
  writeJsonAtomic,
} from "./evidence.mjs";
import { runProcess } from "./process.mjs";
import { syncDirectory } from "./publication.mjs";

const version = "99.88.77";
const cargoPath = "/test/cargo";
const repoRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
);

function cargoArgv(phase) {
  return phase === "Build"
    ? [
        cargoPath,
        "test",
        "--no-run",
        "--verbose",
        "--package=oxdatalog@0.1.0-dev",
        "--all-features",
      ]
    : [
        cargoPath,
        "test",
        "--verbose",
        "--package=oxdatalog@0.1.0-dev",
        "--all-features",
        "--all-targets",
      ];
}

function phase(phaseName, status) {
  return {
    phase: phaseName,
    duration: 0.5,
    process_status: status,
    argv: cargoArgv(phaseName),
  };
}

function mutant(line) {
  const file = "lib/oxdatalog/src/engine.rs";
  return {
    name: `${file}:${line}:1: replace value with false`,
    package: "oxdatalog",
    file,
    function: null,
    span: {
      start: { line, column: 1 },
      end: { line, column: 5 },
    },
    replacement: "false",
    genre: "BinaryOperator",
  };
}

function nativeEvidence() {
  const caught = mutant(10);
  return {
    outcomes: {
      outcomes: [
        {
          scenario: "Baseline",
          summary: "Success",
          log_path: "log/baseline.log",
          diff_path: null,
          phase_results: [
            phase("Build", "Success"),
            phase("Test", "Success"),
          ],
        },
        {
          scenario: { Mutant: caught },
          summary: "CaughtMutant",
          log_path: "log/caught.log",
          diff_path: "diff/caught.diff",
          phase_results: [
            phase("Build", "Success"),
            phase("Test", { Failure: 101 }),
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
      cargo_mutants_version: version,
    },
    inventory: [{ diff: "--- old\n+++ new\n", ...caught }],
  };
}

function validate(value, inventory) {
  return validateOutcomes(value, version, inventory, { cargoPath });
}

function temporaryDirectory() {
  return realpathSync(mkdtempSync(join(tmpdir(), "mutation-basics-test-")));
}

test("native outcome schema accepts a complete matching inventory", () => {
  const native = nativeEvidence();
  const result = validate(native.outcomes, native.inventory);
  assert.equal(result.generated, 1);
  assert.equal(result.caught, 1);
  assert.equal(result.baselinePassed, true);
});

test("runtime provenance binds the executable, path, hash, and version", () => {
  const provenance = executableProvenance("node", ["--version"]);
  assert.equal(provenance.program, "node");
  assert.match(provenance.executableSha256, /^[0-9a-f]{64}$/);
  assert.match(provenance.version, /^v\d+/);
  assert.equal(realpathSync(provenance.path), provenance.path);
});

test("cargo-mutants version parsing preserves the observed release", () => {
  assert.equal(
    parseCargoMutantsVersion("cargo-mutants 99.88.77\n"),
    "99.88.77",
  );
  assert.equal(parseCargoMutantsVersion("cargo-mutants unknown version\n"), null);
});

test("cargo-mutants acquisition floats while receipts freeze runtime provenance", () => {
  const workflow = readFileSync(
    join(repoRoot, ".github", "workflows", "tests.yml"),
    "utf8",
  );
  const runner = readFileSync(
    join(repoRoot, "tools", "mutation", "oxdatalog.mjs"),
    "utf8",
  );
  const installs = `${workflow}\n${runner}`.match(
    /cargo install[^\n]*cargo-mutants[^\n]*/g,
  );
  assert.ok(installs?.length >= 2);
  assert.equal(
    installs.every(
      (command) =>
        command.includes("cargo install --locked cargo-mutants") &&
        !command.includes("--version"),
    ),
    true,
  );
});

test("directory durability is an explicit safe no-op on Windows", () => {
  const root = temporaryDirectory();
  try {
    assert.equal(syncDirectory(root, { platform: "win32" }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("native outcome schema rejects version, phase, inventory, and count fraud", async (t) => {
  await t.test("wrong version", () => {
    const native = nativeEvidence();
    native.outcomes.cargo_mutants_version = "99.0.0";
    assert.throws(() => validate(native.outcomes, native.inventory), /invalid complete/);
  });
  await t.test("phase-less outcome", () => {
    const native = nativeEvidence();
    native.outcomes.outcomes[1].phase_results = [];
    assert.throws(() => validate(native.outcomes, native.inventory), /no phase/);
  });
  await t.test("inconsistent phase status", () => {
    const native = nativeEvidence();
    native.outcomes.outcomes[1].phase_results[1].process_status = "Success";
    assert.throws(() => validate(native.outcomes, native.inventory), /inconsistent/);
  });
  await t.test("inventory mismatch", () => {
    const native = nativeEvidence();
    native.inventory[0].replacement = "true";
    assert.throws(() => validate(native.outcomes, native.inventory), /do not match/);
  });
  await t.test("aggregate mismatch", () => {
    const native = nativeEvidence();
    native.outcomes.total_mutants = 2;
    assert.throws(() => validate(native.outcomes, native.inventory), /cardinality/);
  });
});

test("output containment rejects symlink components and symlink receipts", () => {
  const root = temporaryDirectory();
  const outside = temporaryDirectory();
  try {
    symlinkSync(outside, join(root, "escape"));
    assert.throws(
      () => ensureDirectoryInside(root, join(root, "escape", "child")),
      /symlink component/,
    );
    mkdirSync(join(root, "safe"));
    const outsideReceipt = join(outside, "receipt.json");
    writeFileSync(outsideReceipt, "outside\n");
    symlinkSync(outsideReceipt, join(root, "safe", "receipt.json"));
    assert.throws(
      () =>
        writeJsonAtomic(
          join(root, "safe", "receipt.json"),
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

test("stable reads reject parent symlinks and hard-linked evidence", (context) => {
  if (process.platform === "win32") {
    context.skip("symlink creation requires platform-specific privileges");
    return;
  }
  const root = temporaryDirectory();
  const outside = temporaryDirectory();
  try {
    writeFileSync(join(outside, "evidence.json"), "{}\n");
    symlinkSync(outside, join(root, "redirect"));
    assert.throws(
      () => readStableFileBytes(root, join(root, "redirect", "evidence.json")),
      /symlink component/,
    );
    mkdirSync(join(root, "safe"));
    writeFileSync(join(root, "safe", "evidence.json"), "{}\n");
    linkSync(
      join(root, "safe", "evidence.json"),
      join(root, "safe", "second-link.json"),
    );
    assert.throws(
      () => readStableFileBytes(root, join(root, "safe", "evidence.json")),
      /not one regular file/,
    );
    const fifo = join(root, "safe", "evidence.fifo");
    execFileSync("mkfifo", [fifo]);
    assert.throws(
      () => readStableFileBytes(root, fifo),
      /not one regular file/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("exclusive native directories reject reuse after durable parent creation", () => {
  const root = temporaryDirectory();
  try {
    const path = join(root, "target", "mutation", "native", "run-id");
    assert.equal(createExclusiveDirectoryInside(root, path), path);
    assert.throws(
      () => createExclusiveDirectoryInside(root, path),
      /refusing to reuse exclusive directory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("protected snapshots expose added and changed files", () => {
  const root = temporaryDirectory();
  try {
    mkdirSync(join(root, "inputs"));
    writeFileSync(join(root, "inputs", "a.txt"), "before\n");
    const before = snapshotProtectedInputs(root, ["inputs"]);
    writeFileSync(join(root, "inputs", "a.txt"), "after\n");
    writeFileSync(join(root, "inputs", "b.txt"), "added\n");
    const after = snapshotProtectedInputs(root, ["inputs"]);
    assert.notEqual(before.contentHash, after.contentHash);
    assert.deepEqual(changedInputs(before, after), [
      "inputs/a.txt",
      "inputs/b.txt",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outer timeout terminates the subprocess tree and records bounded time", async () => {
  const root = temporaryDirectory();
  try {
    const result = await runProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      {
        capture: true,
        cwd: root,
        timeoutMs: 50,
        forceKillAfterMs: 50,
      },
    );
    assert.equal(result.timedOut, true);
    assert.notEqual(result.status, 0);
    assert.match(result.startedAt, /^\d{4}-/);
    assert.match(result.endedAt, /^\d{4}-/);
    assert(Number.isSafeInteger(result.durationMs));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
