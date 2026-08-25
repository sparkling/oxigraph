import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildExpandedProgrammeReceipt,
  canonicalJsonBytes,
  classifyQaVerdict,
  collectProgrammeModel,
  createRepositoryManifest,
  expandedProgrammeImplementationPaths,
  loadExpandedProgrammePolicy,
  normalizeTaskStore,
  observeRufloState,
  publishExpandedProgrammeReceipt,
  trackedCleanFromPorcelain,
  validateProgrammeModel,
} from "./expanded-programme-qa.mjs";
import {
  verifyExpandedProgrammeReceipt,
  verifyReceiptEnvelope,
} from "./verify-expanded-programme-qa.mjs";
import {
  runBoundedQuickCommand,
  runBoundedQuickCommands,
} from "./run-expanded-programme-qa.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const policy = loadExpandedProgrammePolicy(repoRoot);
const subject = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  trackedClean: true,
};

function taskStore({ mutate = null } = {}) {
  const tasks = {};
  for (const id of [
    ...Object.keys(policy.tasks),
    ...Object.keys(policy.rollups),
  ]) {
    const taskId = `task-${id.replaceAll(".", "-")}`;
    tasks[taskId] = {
      taskId,
      description: `[${id}] mutable description`,
      status: "pending",
      progress: 0,
      tags: [`plan:${id}`],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }
  tasks["task-harness-registry"] = {
    taskId: "task-harness-registry",
    description: "[HARNESS-REGISTRY] mutable description",
    status: "pending",
    progress: 0,
    tags: ["harness:static-registry"],
  };
  if (mutate) mutate(tasks);
  return { version: 1, tasks };
}

function memoryMaps(store = taskStore()) {
  const taskIds = Object.fromEntries(
    Object.values(store.tasks).map((task) => {
      const planTag = task.tags.find((tag) => tag.startsWith("plan:"));
      const id = planTag?.slice(5) ?? "HARNESS-REGISTRY";
      return [id, task.taskId];
    }),
  );
  return {
    "linked-data-store-g0-g3-2026-08-24": { taskIds: {} },
    "linked-data-store-g0-g4-2026-08-25-v2": {
      taskIds,
      dependencies: {
        ...Object.fromEntries(
          Object.entries(policy.tasks).map(([id, task]) => [id, task.dependencies]),
        ),
        "HARNESS-REGISTRY": policy.controls["HARNESS-REGISTRY"].dependencies,
      },
    },
  };
}

function sourceResult() {
  const model = collectProgrammeModel(repoRoot, policy);
  model.subject = subject;
  return { ...validateProgrammeModel(model, policy), model };
}

function passingCommands() {
  return policy.quickCommands.map((command) => ({
    id: command.id,
    argv: [command.program, ...command.args],
    expected: command.expectedNodeTests
      ? { tests: command.expectedNodeTests, pass: command.expectedNodeTests, fail: 0 }
      : { exitCode: 0, signal: null },
    observed: command.expectedNodeTests
      ? { tests: command.expectedNodeTests, pass: command.expectedNodeTests, fail: 0 }
      : { exitCode: 0, signal: null },
    disposition: "PASS",
    failureClass: null,
  }));
}

function passingRuflo() {
  return observeRufloState({
    policy,
    taskStore: taskStore(),
    memoryMaps: memoryMaps(),
    runtime: { version: "test", executableSha256: "c".repeat(64) },
  });
}

function receipt() {
  const source = sourceResult();
  return buildExpandedProgrammeReceipt({
    policy,
    source,
    commands: passingCommands(),
    rufloObservation: passingRuflo(),
    implementation: createRepositoryManifest(
      repoRoot,
      expandedProgrammeImplementationPaths,
    ),
  });
}

test("should normalize task mappings without volatile status or timestamp fields", () => {
  const before = normalizeTaskStore(taskStore(), policy);
  const after = normalizeTaskStore(
    taskStore({
      mutate(tasks) {
        for (const task of Object.values(tasks)) {
          task.status = "completed";
          task.progress = 100;
          task.completedAt = "2026-12-31T23:59:59.999Z";
        }
      },
    }),
    policy,
  );

  assert.deepEqual(
    { hash: before.sha256, records: before.records },
    { hash: after.sha256, records: after.records },
  );
});

test("should distinguish matching unavailable and mismatched Ruflo observations", () => {
  const matching = passingRuflo();
  const unavailable = observeRufloState({ policy, taskStore: null, memoryMaps: null });
  const injected = taskStore({
    mutate(tasks) {
      tasks.injected = {
        taskId: "injected",
        description: "[G4.9] injected",
        tags: ["plan:G4.9"],
      };
    },
  });
  const mismatched = observeRufloState({
    policy,
    taskStore: injected,
    memoryMaps: memoryMaps(injected),
  });

  assert.deepEqual(
    [matching.disposition, unavailable.disposition, mismatched.disposition],
    ["MATCH", "UNAVAILABLE", "MISMATCH"],
  );
});

test("should ignore untracked porcelain rows and apply fail-closed verdict exits", () => {
  const tap = [
    "TAP version 13",
    "ok 1 - fixture",
    "1..1",
    "# tests 1",
    "# pass 1",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    "",
  ].join("\n");
  const command = runBoundedQuickCommand(repoRoot, {
    id: "fixture",
    program: process.execPath,
    args: ["-e", `process.stdout.write(${JSON.stringify(tap)})`],
    expectedNodeTests: 1,
    timeoutMs: 10_000,
  });
  const unavailableCommand = runBoundedQuickCommand(repoRoot, {
    id: "missing-dependency",
    program: process.execPath,
    args: [
      "-e",
      "process.stderr.write('Error [ERR_MODULE_NOT_FOUND]: Cannot find package'); process.exit(1)",
    ],
    expectedNodeTests: 1,
    timeoutMs: 10_000,
  });
  const stoppedCommands = runBoundedQuickCommands(repoRoot, {
    quickCommands: [
      {
        id: "missing-dependency",
        program: process.execPath,
        args: [
          "-e",
          "process.stderr.write('Error [ERR_MODULE_NOT_FOUND]'); process.exit(1)",
        ],
        expectedNodeTests: 1,
        timeoutMs: 10_000,
      },
      {
        id: "must-not-run",
        program: process.execPath,
        args: ["-e", "process.exit(99)"],
        timeoutMs: 10_000,
      },
    ],
  });
  assert.deepEqual(
    {
      untrackedOnly: trackedCleanFromPorcelain("?? target/runtime.json\n"),
      tracked: trackedCleanFromPorcelain(" M docs/adr/README.md\n"),
      pass: classifyQaVerdict({ sourceOk: true, commandsDisposition: "PASS", rufloDisposition: "MATCH" }),
      unavailable: classifyQaVerdict({ sourceOk: true, commandsDisposition: "PASS", rufloDisposition: "UNAVAILABLE" }),
      fail: classifyQaVerdict({ sourceOk: false, commandsDisposition: "PASS", rufloDisposition: "MATCH" }),
      redCommand: classifyQaVerdict({ sourceOk: true, commandsDisposition: "FAIL", rufloDisposition: "UNAVAILABLE" }),
      command: command.disposition,
      unavailableCommand: [
        unavailableCommand.disposition,
        unavailableCommand.failureClass,
      ],
      stoppedCommands: stoppedCommands.map((item) => [
        item.disposition,
        item.failureClass,
      ]),
    },
    {
      untrackedOnly: true,
      tracked: false,
      pass: { verdict: "PASS", exitCode: 0 },
      unavailable: { verdict: "INCONCLUSIVE", exitCode: 2 },
      fail: { verdict: "FAIL", exitCode: 1 },
      redCommand: { verdict: "FAIL", exitCode: 1 },
      command: "PASS",
      unavailableCommand: ["INCONCLUSIVE", "DEPENDENCY_UNAVAILABLE"],
      stoppedCommands: [
        ["INCONCLUSIVE", "DEPENDENCY_UNAVAILABLE"],
        ["INCONCLUSIVE", "NOT_RUN_AFTER_FAILURE"],
      ],
    },
  );
});

test("should publish byte-deterministic immutable receipts idempotently", (t) => {
  const root = mkdtempSync(join(tmpdir(), "oxigraph-programme-receipt-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const value = receipt();

  const first = publishExpandedProgrammeReceipt(root, value);
  const second = publishExpandedProgrammeReceipt(root, structuredClone(value));

  assert.deepEqual(
    {
      path: first.path,
      sha256: first.sha256,
      bytes: readFileSync(first.path),
      idempotent: second.idempotent,
    },
    {
      path: second.path,
      sha256: second.sha256,
      bytes: canonicalJsonBytes(value),
      idempotent: true,
    },
  );
});

test("should reject receipt subject score hash and authority tampering", (t) => {
  const value = receipt();
  const options = { policy, receiptSha256: "e".repeat(64) };
  assert.equal(verifyReceiptEnvelope(value, options).ok, true);

  const variants = [
    (candidate) => { candidate.subject.commit = "f".repeat(40); },
    (candidate) => { candidate.score.total = 99; },
    (candidate) => { candidate.subject.inputs.sha256 = "0".repeat(64); },
    (candidate) => { candidate.subject.implementation.files.pop(); },
    (candidate) => { candidate.authority.semanticQualification = true; },
  ];
  assert.deepEqual(
    variants.map((mutate) => {
      const candidate = structuredClone(value);
      mutate(candidate);
      return verifyReceiptEnvelope(candidate, options).ok;
    }),
    [false, false, false, false, false],
  );

  const root = mkdtempSync(join(tmpdir(), "oxigraph-programme-verifier-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = sourceResult();
  const implementation = createRepositoryManifest(
    repoRoot,
    expandedProgrammeImplementationPaths,
  );
  for (const file of [
    ...source.model.inputManifest.files,
    ...implementation.files,
  ]) {
    const destination = join(root, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repoRoot, file.path), destination);
  }
  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
    ["-c", "user.name=QA", "-c", "user.email=qa@example.invalid", "commit", "--quiet", "-m", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  source.model.subject = {
    commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
    tree: spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).stdout.trim(),
    trackedClean: true,
  };
  Object.assign(source, validateProgrammeModel(source.model, policy));
  const bound = buildExpandedProgrammeReceipt({
    policy,
    source,
    commands: passingCommands(),
    rufloObservation: passingRuflo(),
    implementation,
  });
  const publication = publishExpandedProgrammeReceipt(root, bound);
  const verification = verifyExpandedProgrammeReceipt(root, publication.path);
  assert.equal(
    verification.ok,
    true,
    verification.errors.join("; "),
  );
});
