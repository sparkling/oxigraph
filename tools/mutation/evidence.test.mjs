import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MUTATION_RECEIPT_SCHEMA_VERSION,
  mutationReceiptContentHash,
  mutationReceiptBytes,
  mutationReceiptExecutionHash,
  sha256,
  snapshotProtectedInputs,
  validateMutationPublication,
  validateMutationReceipt,
} from "./evidence.mjs";
import {
  createMutationPublication,
  publishMutationPublication,
} from "./publication.mjs";

const version = "99.88.77";
const cargoPath = "/test/cargo";

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

function phase(phaseName, processStatus) {
  return {
    phase: phaseName,
    duration: 0.5,
    process_status: processStatus,
    argv: cargoArgv(phaseName),
  };
}

function mutant(name, line) {
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

function scenario(mutantValue, summary, phaseResults) {
  return {
    scenario: { Mutant: mutantValue },
    summary,
    log_path: `log/mutant-${mutantValue.span.start.line}.log`,
    diff_path: `diff/mutant-${mutantValue.span.start.line}.diff`,
    phase_results: phaseResults,
  };
}

function validNativeEvidence() {
  const caught = mutant("caught", 10);
  const unviable = mutant("unviable", 20);
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
        scenario(caught, "CaughtMutant", [
          phase("Build", "Success"),
          phase("Test", { Failure: 101 }),
        ]),
        scenario(unviable, "Unviable", [
          phase("Build", { Failure: 101 }),
        ]),
      ],
      total_mutants: 2,
      missed: 0,
      caught: 1,
      timeout: 0,
      unviable: 1,
      success: 0,
      start_time: "2026-07-27T00:00:00.000000Z",
      end_time: "2026-07-27T00:01:00.000000Z",
      cargo_mutants_version: version,
    },
    inventory: [
      { diff: "--- caught\n+++ caught\n", ...caught },
      { diff: "--- unviable\n+++ unviable\n", ...unviable },
    ],
  };
}

function temporaryDirectory() {
  return realpathSync(mkdtempSync(join(tmpdir(), "oxdatalog-mutation-test-")));
}

function snapshotForConfig(configBytes) {
  const files = [
    {
      path: "tools/mutation/oxdatalog.toml",
      sha256: sha256(configBytes),
      bytes: configBytes.length,
    },
  ];
  return {
    algorithm: "sha256",
    contentHash: sha256(JSON.stringify(files)),
    fileCount: files.length,
    roots: ["tools/mutation"],
    files,
  };
}

function setupProtectedRepository(root, configBytes) {
  mkdirSync(join(root, "lib"), { recursive: true });
  mkdirSync(join(root, "tools", "mutation"), { recursive: true });
  writeFileSync(join(root, "Cargo.lock"), "lock\n");
  writeFileSync(join(root, "Cargo.toml"), "[workspace]\n");
  writeFileSync(join(root, "lib", "source.rs"), "source\n");
  writeFileSync(join(root, "tools", "mutation", "oxdatalog.toml"), configBytes);
  return snapshotProtectedInputs(root);
}

function runtimeRecords() {
  return ["cargo", "cargo-mutants", "rustc"].map((program) => ({
    program,
    invokedPath: program === "cargo" ? cargoPath : `/test/${program}`,
    path: program === "cargo" ? cargoPath : `/test/${program}`,
    executableSha256: "b".repeat(64),
    version:
      program === "cargo-mutants"
        ? `cargo-mutants ${version}`
        : `${program} test`,
  }));
}

function validReceipt({
  outcomeBytes,
  inventoryBytes,
  configBytes,
  currentSnapshot,
  runId = "00000000-0000-4000-8000-000000000000",
} = {}) {
  const native = validNativeEvidence();
  const outcomes = outcomeBytes ?? Buffer.from(JSON.stringify(native.outcomes));
  const inventory =
    inventoryBytes ?? Buffer.from(JSON.stringify(native.inventory));
  const config = configBytes ?? Buffer.from("[test]\n");
  const snapshot = currentSnapshot ?? snapshotForConfig(config);
  const receipt = {
    schemaVersion: MUTATION_RECEIPT_SCHEMA_VERSION,
    runId,
    profile: "oxdatalog-d2-complete",
    gateClosed: true,
    baselinePassed: true,
    baselineSummary: "Success",
    cargoMutantsVersion: version,
    expectedCargoMutantsVersion: version,
    command: {
      status: 0,
      signal: null,
      timedOut: false,
      outerTimeoutMs: 3_600_000,
      startedAt: "2026-07-26T23:59:59.000Z",
      endedAt: "2026-07-27T00:01:01.000Z",
      durationMs: 62_000,
    },
    runtime: runtimeRecords(),
    startedAt: native.outcomes.start_time,
    endedAt: native.outcomes.end_time,
    protectedInputs: {
      before: snapshot,
      after: snapshot,
      stable: true,
      changedPaths: [],
    },
    counts: {
      generated: 2,
      caught: 1,
      missed: 0,
      timeout: 0,
      unviable: 1,
      viable: 1,
    },
    mutationScorePercent: 100,
    evidence: {
      nativeOutcomes: "target/mutation/oxdatalog/mutants.out/outcomes.json",
      nativeOutcomesSha256: sha256(outcomes),
      nativeInventory: "target/mutation/oxdatalog/mutants.out/mutants.json",
      nativeInventorySha256: sha256(inventory),
      config: "tools/mutation/oxdatalog.toml",
      configSha256: sha256(config),
    },
    publication: createMutationPublication(runId, {
      outcomeBytes: outcomes,
      inventoryBytes: inventory,
      configBytes: config,
    }),
    limitations: ["test fixture"],
  };
  receipt.evidence.nativeOutcomes =
    `target/mutation/oxdatalog/native/${runId}/mutants.out/outcomes.json`;
  receipt.evidence.nativeInventory =
    `target/mutation/oxdatalog/native/${runId}/mutants.out/mutants.json`;
  receipt.contentHash = mutationReceiptContentHash(receipt);
  receipt.executionHash = mutationReceiptExecutionHash(receipt);
  return {
    receipt,
    outcomeBytes: outcomes,
    inventoryBytes: inventory,
    configBytes: config,
    currentSnapshot: snapshot,
  };
}

test("mutation receipt verifier reopens native evidence and rejects tampering", () => {
  const {
    receipt,
    outcomeBytes,
    inventoryBytes,
    configBytes,
    currentSnapshot,
  } = validReceipt();
  const outcomes = JSON.parse(outcomeBytes);
  const inventory = JSON.parse(inventoryBytes);
  const inputs = {
    currentSnapshot,
    outcomes,
    inventory,
    outcomeBytes,
    inventoryBytes,
    configBytes,
    expectedVersion: version,
    expectedRuntime: runtimeRecords(),
  };

  assert.doesNotThrow(() => validateMutationReceipt(receipt, inputs));
  assert.doesNotThrow(() =>
    validateMutationReceipt(receipt, {
      ...inputs,
      expectedVersion: undefined,
    }),
  );
  assert.throws(
    () =>
      validateMutationReceipt(
        {
          ...receipt,
          counts: { ...receipt.counts, caught: 0 },
        },
        inputs,
      ),
    /native evidence contract/,
  );
  assert.throws(
    () =>
      validateMutationReceipt(
        { ...receipt, contentHash: "c".repeat(64) },
        inputs,
    ),
    /native evidence contract/,
  );
  assert.throws(
    () =>
      validateMutationReceipt(
        { ...receipt, executionHash: "d".repeat(64) },
        inputs,
      ),
    /native evidence contract/,
  );
  assert.throws(
    () =>
      validateMutationReceipt(
        {
          ...receipt,
          command: { ...receipt.command, durationMs: 1 },
        },
        inputs,
      ),
    /timestamps are inconsistent/,
  );
  assert.throws(
    () =>
      validateMutationReceipt(receipt, {
        ...inputs,
        expectedRuntime: runtimeRecords().map((record, index) =>
          index === 0 ? { ...record, path: "/different/cargo" } : record,
        ),
      }),
    /provenance differs/,
  );
  assert.throws(
    () =>
      validateMutationReceipt(receipt, {
        ...inputs,
        expectedVersion: undefined,
        expectedRuntime: runtimeRecords().map((record) =>
          record.program === "cargo-mutants"
            ? { ...record, version: "cargo-mutants 88.77.66" }
            : record,
        ),
      }),
    /provenance differs/,
  );
  const inconsistentRuntimeReceipt = structuredClone(receipt);
  inconsistentRuntimeReceipt.runtime[1].version = "cargo-mutants 88.77.66";
  inconsistentRuntimeReceipt.contentHash = mutationReceiptContentHash(
    inconsistentRuntimeReceipt,
  );
  inconsistentRuntimeReceipt.executionHash = mutationReceiptExecutionHash(
    inconsistentRuntimeReceipt,
  );
  assert.throws(
    () =>
      validateMutationReceipt(inconsistentRuntimeReceipt, {
        ...inputs,
        expectedVersion: undefined,
        expectedRuntime: undefined,
      }),
    /provenance version differs from the receipt/,
  );
  const mismatchedConfig = validReceipt({
    configBytes: Buffer.from("[different]\n"),
    currentSnapshot,
  });
  assert.throws(
    () =>
      validateMutationReceipt(mismatchedConfig.receipt, {
        currentSnapshot,
        outcomes: JSON.parse(mismatchedConfig.outcomeBytes),
        inventory: JSON.parse(mismatchedConfig.inventoryBytes),
        outcomeBytes: mismatchedConfig.outcomeBytes,
        inventoryBytes: mismatchedConfig.inventoryBytes,
        configBytes: mismatchedConfig.configBytes,
        expectedVersion: version,
        expectedRuntime: runtimeRecords(),
      }),
    /config differs from current source/,
  );
});

test("immutable publication binds exact receipt, outcomes, config, and run", () => {
  const root = temporaryDirectory();
  try {
    const configBytes = Buffer.from("[test]\n");
    const currentSnapshot = setupProtectedRepository(root, configBytes);
    const {
      receipt,
      outcomeBytes,
      inventoryBytes,
    } = validReceipt({ configBytes, currentSnapshot });
    assert.throws(
      () =>
        publishMutationPublication(receipt, {
          repositoryRoot: root,
          receiptBytes: Buffer.from("{}\n"),
          outcomeBytes,
          inventoryBytes,
          configBytes,
        }),
      /invalid mutation publication/,
    );
    const published = publishMutationPublication(receipt, {
      repositoryRoot: root,
      receiptBytes: mutationReceiptBytes(receipt),
      outcomeBytes,
      inventoryBytes,
      configBytes,
    });
    assert.equal(published.publication.root.endsWith(receipt.runId), true);
    assert.deepEqual(
      readdirSync(join(root, published.publication.root)).sort(),
      ["mutants.json", "outcomes.json", "oxdatalog.toml", "receipt.json"],
    );
    const validated = validateMutationPublication(receipt, {
      repositoryRoot: root,
      currentContentHash: currentSnapshot.contentHash,
      expectedRuntime: runtimeRecords(),
      inventoryLister: () => ({
        inventory: JSON.parse(inventoryBytes),
        before: currentSnapshot,
        after: currentSnapshot,
      }),
    });
    assert.equal(validated.validation.generated, 2);
    assert.equal(validated.receiptBytes.equals(mutationReceiptBytes(receipt)), true);
    const currentInventory = JSON.parse(inventoryBytes);
    currentInventory[0].replacement = "invented-current-drift";
    assert.throws(
      () =>
        validateMutationPublication(receipt, {
          repositoryRoot: root,
          expectedRuntime: runtimeRecords(),
          inventoryLister: () => ({
            inventory: currentInventory,
            before: currentSnapshot,
            after: currentSnapshot,
          }),
        }),
      /does not match current source inventory/,
    );
    assert.throws(
      () =>
        publishMutationPublication(receipt, {
          repositoryRoot: root,
          receiptBytes: mutationReceiptBytes(receipt),
          outcomeBytes,
          inventoryBytes,
          configBytes,
        }),
      /refusing to replace immutable mutation run/,
    );
    const outcomePath = join(
      root,
      receipt.publication.files[0].path,
    );
    writeFileSync(outcomePath, "tampered\n");
    assert.throws(
      () =>
        validateMutationPublication(receipt, {
          repositoryRoot: root,
          currentContentHash: currentSnapshot.contentHash,
          expectedRuntime: runtimeRecords(),
          inventoryLister: () => ({
            inventory: JSON.parse(inventoryBytes),
            before: currentSnapshot,
            after: currentSnapshot,
          }),
        }),
      /bytes changed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("immutable publication rejects forged paths and symlink substitution", (context) => {
  if (process.platform === "win32") {
    context.skip("symlink creation requires platform-specific privileges");
    return;
  }
  const root = temporaryDirectory();
  const outside = temporaryDirectory();
  try {
    const configBytes = Buffer.from("[test]\n");
    const currentSnapshot = setupProtectedRepository(root, configBytes);
    const { receipt, outcomeBytes, inventoryBytes } = validReceipt({
      runId: "00000000-0000-4000-8000-000000000001",
      configBytes,
      currentSnapshot,
    });
    const forged = structuredClone(receipt);
    forged.publication.root = "../escape";
    assert.throws(
      () =>
        publishMutationPublication(forged, {
          repositoryRoot: root,
          receiptBytes: mutationReceiptBytes(forged),
          outcomeBytes,
          inventoryBytes,
          configBytes,
        }),
      /invalid mutation publication/,
    );
    publishMutationPublication(receipt, {
      repositoryRoot: root,
      receiptBytes: mutationReceiptBytes(receipt),
      outcomeBytes,
      inventoryBytes,
      configBytes,
    });
    const configPath = join(root, receipt.publication.files[2].path);
    const externalConfig = join(outside, "oxdatalog.toml");
    writeFileSync(externalConfig, "outside\n");
    unlinkSync(configPath);
    symlinkSync(externalConfig, configPath);
    assert.throws(
      () =>
        validateMutationPublication(receipt, {
          repositoryRoot: root,
          currentContentHash: currentSnapshot.contentHash,
          expectedRuntime: runtimeRecords(),
          inventoryLister: () => ({
            inventory: JSON.parse(inventoryBytes),
            before: currentSnapshot,
            after: currentSnapshot,
          }),
        }),
      /not one regular file/,
    );
    assert.equal(readFileSync(externalConfig, "utf8"), "outside\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
