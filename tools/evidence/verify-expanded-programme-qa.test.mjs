import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
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
  observeProtectedRufloSnapshot,
  publishExpandedProgrammeReceipt,
  readProtectedRufloSnapshot,
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
  unexecutedQuickCommands,
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
    executableSha256: "d".repeat(64),
    sandbox: {
      executableSha256: "e".repeat(64),
      network: "isolated",
      processTree: "pid-namespace",
      workspace: "read-only",
      target: "ephemeral",
    },
    expected: command.expectedNodeTests
      ? { plan: command.expectedNodeTests, tests: command.expectedNodeTests, suites: 0, pass: command.expectedNodeTests, fail: 0, cancelled: 0, skipped: 0, todo: 0, summaryBlockCount: 1, terminal: true, conserved: true, durationPresent: true }
      : { exitCode: 0, signal: null },
    observed: command.expectedNodeTests
      ? { plan: command.expectedNodeTests, tests: command.expectedNodeTests, suites: 0, pass: command.expectedNodeTests, fail: 0, cancelled: 0, skipped: 0, todo: 0, summaryBlockCount: 1, terminal: true, conserved: true, durationPresent: true }
      : { exitCode: 0, signal: null },
    disposition: "PASS",
    failureClass: null,
  }));
}

function protectedSnapshot(store = taskStore()) {
  const maps = memoryMaps(store);
  return {
    schema: "oxigraph.expanded-programme-ruflo-snapshot/v1",
    producer: {
      transport: "native-ruflo-mcp",
      taskInterfaces: ["task_list", "task_status"],
      memoryInterface: "memory_export",
    },
    tasks: Object.values(store.tasks)
      .map((task) => ({
        taskId: task.taskId,
        description: task.description,
        tags: [...task.tags].sort(),
      }))
      .sort((left, right) => left.taskId < right.taskId ? -1 : left.taskId > right.taskId ? 1 : 0),
    memoryExport: {
      schema: "ruflo-memory-export/v1",
      namespace: policy.ruflo.namespace,
      count: policy.ruflo.memoryKeys.length,
      entries: policy.ruflo.memoryKeys.map((key) => ({
        key,
        namespace: policy.ruflo.namespace,
        value: JSON.stringify(maps[key]),
      })),
    },
  };
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

test("should distinguish observations and reject unprotected Ruflo snapshots", (t) => {
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

  const root = mkdtempSync(join(tmpdir(), "oxigraph-programme-ruflo-snapshot-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshotPath = join(root, "snapshot.json");
  writeFileSync(snapshotPath, canonicalJsonBytes(protectedSnapshot()));
  assert.throws(
    () => readProtectedRufloSnapshot(repoRoot, snapshotPath),
    /must be read-only/,
  );
  chmodSync(snapshotPath, 0o444);
  const protectedInput = readProtectedRufloSnapshot(repoRoot, snapshotPath);
  assert.equal(
    observeProtectedRufloSnapshot({ policy, ...protectedInput }).disposition,
    "MATCH",
  );
  const snapshotLink = join(root, "snapshot-link.json");
  symlinkSync(snapshotPath, snapshotLink);
  assert.throws(
    () => readProtectedRufloSnapshot(repoRoot, snapshotLink),
    /symlink/,
  );
  const realDirectory = join(root, "real-snapshot-directory");
  mkdirSync(realDirectory);
  const nestedSnapshot = join(realDirectory, "snapshot.json");
  writeFileSync(nestedSnapshot, canonicalJsonBytes(protectedSnapshot()), {
    mode: 0o444,
  });
  const linkedDirectory = join(root, "linked-snapshot-directory");
  symlinkSync(realDirectory, linkedDirectory, "dir");
  assert.throws(
    () => readProtectedRufloSnapshot(
      repoRoot,
      join(linkedDirectory, "snapshot.json"),
    ),
    /path component must not be a symlink/,
  );

  const insidePath = join(repoRoot, "target", "untrusted-ruflo-snapshot.json");
  mkdirSync(dirname(insidePath), { recursive: true });
  writeFileSync(insidePath, canonicalJsonBytes(protectedSnapshot()), { mode: 0o444 });
  t.after(() => rmSync(insidePath, { force: true }));
  assert.throws(
    () => readProtectedRufloSnapshot(repoRoot, insidePath),
    /outside the candidate repository/,
  );
});

test("should ignore untracked porcelain rows and apply fail-closed verdict exits", async () => {
  const tap = [
    "TAP version 13",
    "ok 1 - fixture",
    "1..1",
    "# tests 1",
    "# suites 0",
    "# pass 1",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
    "# duration_ms 1",
    "",
  ].join("\n");
  const command = await runBoundedQuickCommand(repoRoot, {
    id: "fixture",
    program: process.execPath,
    args: ["-e", `process.stdout.write(${JSON.stringify(tap)})`],
    expectedNodeTests: 1,
    timeoutMs: 10_000,
  });
  const unavailableCommand = await runBoundedQuickCommand(repoRoot, {
    id: "missing-dependency",
    program: process.execPath,
    args: [
      "-e",
      "process.stderr.write('Error [ERR_MODULE_NOT_FOUND]: Cannot find package'); process.exit(1)",
    ],
    expectedNodeTests: 1,
    timeoutMs: 10_000,
  });
  const spoofedCommand = await runBoundedQuickCommand(repoRoot, {
    id: "duplicate-summary",
    program: process.execPath,
    args: ["-e", `process.stdout.write(${JSON.stringify(`${tap}${tap}`)})`],
    expectedNodeTests: 1,
    timeoutMs: 10_000,
  });
  const stoppedCommands = await runBoundedQuickCommands(repoRoot, {
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
      untrackedOnly: trackedCleanFromPorcelain("?? candidate-controlled.json\n"),
      tracked: trackedCleanFromPorcelain(" M docs/adr/README.md\n"),
      pass: classifyQaVerdict({ sourceOk: true, commandsDisposition: "PASS", rufloDisposition: "MATCH" }),
      unavailable: classifyQaVerdict({ sourceOk: true, commandsDisposition: "PASS", rufloDisposition: "UNAVAILABLE" }),
      mismatch: classifyQaVerdict({ sourceOk: true, commandsDisposition: "PASS", rufloDisposition: "MISMATCH" }),
      fail: classifyQaVerdict({ sourceOk: false, commandsDisposition: "PASS", rufloDisposition: "MATCH" }),
      redCommand: classifyQaVerdict({ sourceOk: true, commandsDisposition: "FAIL", rufloDisposition: "UNAVAILABLE" }),
      command: command.disposition,
      unavailableCommand: [
        unavailableCommand.disposition,
        unavailableCommand.failureClass,
      ],
      spoofedCommand: spoofedCommand.disposition,
      stoppedCommands: stoppedCommands.map((item) => [
        item.disposition,
        item.failureClass,
      ]),
    },
    {
      untrackedOnly: false,
      tracked: false,
      pass: { verdict: "PASS", exitCode: 0 },
      unavailable: { verdict: "PASS", exitCode: 0 },
      mismatch: { verdict: "PASS", exitCode: 0 },
      fail: { verdict: "FAIL", exitCode: 1 },
      redCommand: { verdict: "FAIL", exitCode: 1 },
      command: "PASS",
      unavailableCommand: ["INCONCLUSIVE", "DEPENDENCY_UNAVAILABLE"],
      spoofedCommand: "FAIL",
      stoppedCommands: [
        ["INCONCLUSIVE", "DEPENDENCY_UNAVAILABLE"],
        ["INCONCLUSIVE", "NOT_RUN_AFTER_FAILURE"],
      ],
    },
  );
});

test("should isolate quick-command network and terminate escaped descendants", async (t) => {
  const network = await runBoundedQuickCommand(repoRoot, {
    id: "network-isolation",
    program: process.execPath,
    args: [
      "-e",
      "const fs=require('node:fs');const routes=fs.readFileSync('/proc/net/route','utf8').trim().split(/\\n/).slice(1).filter(Boolean);let readOnly=false;try{fs.writeFileSync('README.md','tamper')}catch{readOnly=true}fs.writeFileSync('target/scratch-proof','ephemeral');process.exit(routes.length===0&&readOnly?0:9)",
    ],
    timeoutMs: 10_000,
  });
  assert.equal(network.disposition, "PASS");
  assert.equal(network.sandbox.network, "isolated");
  assert.equal(network.sandbox.processTree, "pid-namespace");
  assert.equal(network.sandbox.workspace, "read-only");
  assert.equal(network.sandbox.target, "ephemeral");

  const coldRoot = mkdtempSync(join(tmpdir(), "oxigraph-programme-cold-sandbox-"));
  t.after(() => rmSync(coldRoot, { recursive: true, force: true }));
  const initialized = spawnSync("/usr/bin/git", ["init", "--quiet"], {
    cwd: coldRoot,
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  writeFileSync(join(coldRoot, "README.md"), "fixture\n");
  for (const args of [
    ["add", "README.md"],
    [
      "-c",
      "user.name=QA",
      "-c",
      "user.email=qa@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ],
  ]) {
    const result = spawnSync("/usr/bin/git", args, {
      cwd: coldRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const directory of [
    ".agentic-qe",
    ".claude",
    ".claude-flow",
    ".swarm",
    "var",
  ]) {
    mkdirSync(join(coldRoot, directory));
    writeFileSync(join(coldRoot, directory, "private-state"), "protected\n");
  }
  for (const file of [
    ".env",
    ".htpasswd",
    ".npmrc",
    "agentdb.rvf",
    "agentdb.rvf.idmap.json",
    "agentdb.rvf.lock",
    "ignored-local-state",
    "ruvector.db",
  ]) {
    writeFileSync(join(coldRoot, file), "protected\n");
  }
  const protectedPaths = [
    ".agentic-qe/private-state",
    ".claude/private-state",
    ".claude-flow/private-state",
    ".env",
    ".htpasswd",
    ".npmrc",
    ".swarm/private-state",
    "agentdb.rvf",
    "agentdb.rvf.idmap.json",
    "agentdb.rvf.lock",
    "ignored-local-state",
    "ruvector.db",
    "var/private-state",
  ];
  const cold = await runBoundedQuickCommand(coldRoot, {
    id: "cold-target",
    program: process.execPath,
    args: [
      "-e",
      `const fs=require('node:fs');let readOnly=false;try{fs.writeFileSync('new-top-level','tamper')}catch{readOnly=true}const protectedPaths=${JSON.stringify(protectedPaths)};const hidden=protectedPaths.every(path=>!fs.existsSync(path));const tracked=fs.readFileSync('README.md','utf8')==='fixture\\n';fs.writeFileSync('target/proof','ephemeral');process.exit(readOnly&&hidden&&tracked?0:9)`,
    ],
    timeoutMs: 10_000,
  });
  assert.equal(cold.disposition, "PASS");
  assert.equal(existsSync(join(coldRoot, "target")), false);
  assert.equal(existsSync(join(coldRoot, "new-top-level")), false);

  const token = `oxigraph-programme-descendant-${randomUUID()}`;
  const escaped = await runBoundedQuickCommand(repoRoot, {
    id: "escaped-descendant",
    program: process.execPath,
    args: [
      "-e",
      `const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)',${JSON.stringify(token)}],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000)`,
    ],
    timeoutMs: 250,
  });
  assert.deepEqual(
    [escaped.disposition, escaped.failureClass],
    ["INCONCLUSIVE", "TIMEOUT"],
  );
  const processes = spawnSync("/usr/bin/ps", ["-eo", "args"], {
    encoding: "utf8",
  });
  assert.equal(processes.status, 0, processes.stderr);
  assert.equal(processes.stdout.includes(token), false);
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

test("should reject receipt subject score hash and authority tampering", async (t) => {
  const value = receipt();
  const options = {
    policy,
    receiptSha256: "e".repeat(64),
    expectedRufloObservation: value.rufloObservation,
  };
  assert.equal(verifyReceiptEnvelope(value, options).ok, true);

  const variants = [
    (candidate) => { candidate.subject.commit = "f".repeat(40); },
    (candidate) => { candidate.score.total = 99; },
    (candidate) => { candidate.subject.inputs.sha256 = "0".repeat(64); },
    (candidate) => { candidate.subject.implementation.files.pop(); },
    (candidate) => { candidate.authority.semanticQualification = true; },
    (candidate) => { candidate.promotionAuthority = true; },
    (candidate) => { candidate.subject.releaseAuthority = true; },
    (candidate) => { candidate.commands[0] = { id: candidate.commands[0].id, argv: candidate.commands[0].argv, disposition: "PASS" }; },
    (candidate) => { candidate.commands[0].sandbox.network = "inherited"; },
    (candidate) => { candidate.assertions.find((assertion) => assertion.id === "tooling.bounded-contracts").evidence.commands = 999; },
  ];
  assert.deepEqual(
    variants.map((mutate) => {
      const candidate = structuredClone(value);
      mutate(candidate);
      return verifyReceiptEnvelope(candidate, options).ok;
    }),
    [false, false, false, false, false, false, false, false, false, false],
  );

  const failedSource = sourceResult();
  failedSource.ok = false;
  const failedAssertion = failedSource.assertions.find(
    (assertion) => assertion.id === "adr.corpus",
  );
  failedAssertion.status = "FAIL";
  failedAssertion.diagnostics = ["adversarial fixture"];
  const failedReceipt = buildExpandedProgrammeReceipt({
    policy,
    source: failedSource,
    commands: unexecutedQuickCommands(
      policy,
      "NOT_RUN_AFTER_SOURCE_FAILURE",
    ),
    rufloObservation: passingRuflo(),
    implementation: createRepositoryManifest(
      repoRoot,
      expandedProgrammeImplementationPaths,
    ),
  });
  assert.deepEqual(
    {
      envelope: verifyReceiptEnvelope(failedReceipt, {
        policy,
        receiptSha256: "e".repeat(64),
        expectedRufloObservation: failedReceipt.rufloObservation,
      }).ok,
      verdict: failedReceipt.verdict,
    },
    { envelope: true, verdict: "FAIL" },
  );

  const root = mkdtempSync(join(tmpdir(), "oxigraph-programme-verifier-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = sourceResult();
  const implementation = createRepositoryManifest(
    repoRoot,
    expandedProgrammeImplementationPaths,
  );
  cpSync(repoRoot, root, {
    recursive: true,
    filter(sourcePath) {
      const relativePath = sourcePath.slice(repoRoot.length).replace(/^\//u, "");
      return !/^(?:\.git|target|\.claude-flow|\.swarm)(?:\/|$)/u.test(relativePath);
    },
  });
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
    commands: passingCommands().map((command, index) => index === 0
      ? { ...command, observed: null, disposition: "INCONCLUSIVE", failureClass: "DEPENDENCY_UNAVAILABLE" }
      : command),
    rufloObservation: passingRuflo(),
    implementation,
  });
  const publication = publishExpandedProgrammeReceipt(root, bound);
  const verification = await verifyExpandedProgrammeReceipt(root, publication.path, {
    expectedRufloObservation: bound.rufloObservation,
  });
  assert.equal(
    verification.ok,
    true,
    verification.errors.join("; "),
  );
  const forgedSourceEvidence = structuredClone(bound);
  forgedSourceEvidence.assertions.find(
    (assertion) => assertion.id === "adr.corpus",
  ).evidence.adrCount = 999;
  const forgedPublication = publishExpandedProgrammeReceipt(root, forgedSourceEvidence);
  const forgedVerification = await verifyExpandedProgrammeReceipt(
    root,
    forgedPublication.path,
    { expectedRufloObservation: bound.rufloObservation },
  );
  assert.equal(forgedVerification.ok, false);
  assert.match(
    forgedVerification.errors.join("; "),
    /source assertions do not match/,
  );
});
