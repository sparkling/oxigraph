import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_V3_SCHEMA,
  G17_BENCHMARK_BUILD_PROCESS_PROJECTION_V3_SCHEMA,
  G17_BENCHMARK_BUILD_PROCESS_V3_AUTHORITY,
  G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS,
  G17_BENCHMARK_BUILD_PROCESS_V3_NONCLAIMS,
  verifyG17BenchmarkBuildProcessEvidenceV3,
} from "../src/qualification/benchmark-build-process-evidence-v3-contract.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY,
  G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA,
} from "../src/qualification/benchmark-execution-request-contract.mjs";
import { parseG17Elf64 } from "../src/qualification/native-elf.mjs";
import {
  G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_PROJECTION_SCHEMA,
} from "../src/qualification/non-tmpfs-containment-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const CONTRACT_ERROR = /G1\.7 benchmark build process evidence v3/u;
const PACKAGE_ID = "path+file:///workspace/source/lib/oxigraph#0.6.0-dev";
const MANIFEST_PATH = "/workspace/source/lib/oxigraph/Cargo.toml";
const SOURCE_PATH =
  "/workspace/source/lib/oxigraph/benches/transactional_write.rs";
const EXECUTABLE_PATH =
  "/state/target/release/deps/transactional_write-v3-fixture";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function seal(value) {
  const { contentHash: ignored, ...unsigned } = structuredClone(value);
  return { ...unsigned, contentHash: canonicalSha256(unsigned) };
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function minimalElf(suffix = 0x61) {
  const bytes = Buffer.alloc(121);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  bytes.writeUInt16LE(2, 16);
  bytes.writeUInt16LE(62, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeBigUInt64LE(0x40_0000n, 24);
  bytes.writeBigUInt64LE(64n, 32);
  bytes.writeUInt16LE(64, 52);
  bytes.writeUInt16LE(56, 54);
  bytes.writeUInt16LE(1, 56);
  bytes.writeUInt32LE(1, 64);
  bytes.writeUInt32LE(5, 68);
  bytes.writeBigUInt64LE(0n, 72);
  bytes.writeBigUInt64LE(0x40_0000n, 80);
  bytes.writeBigUInt64LE(0x40_0000n, 88);
  bytes.writeBigUInt64LE(120n, 96);
  bytes.writeBigUInt64LE(120n, 104);
  bytes.writeBigUInt64LE(4_096n, 112);
  bytes[120] = suffix;
  return bytes;
}

function identity(device, inode, size, mode = 0o040700) {
  return {
    device,
    inode,
    uid: "1000",
    gid: "1000",
    mode,
    nlink: (mode & 0o170000) === 0o040000 ? 2 : 1,
    size,
  };
}

function heldTargetRoot() {
  const observed = identity("10", "100", 4_096);
  return {
    logicalPath: "/state/target",
    heldFd: true,
    inheritedFd: 5,
    before: structuredClone(observed),
    after: structuredClone(observed),
    filesystemType: "61267",
  };
}

function heldAncestor(logicalPath, leafName, inode, parentInode) {
  const observed = identity("10", inode, 4_096);
  return {
    logicalPath,
    leafName,
    heldFd: true,
    parentDevice: "10",
    parentInode,
    before: structuredClone(observed),
    after: structuredClone(observed),
    filesystemType: "61267",
  };
}

function heldExecutable(bytes) {
  const observed = identity("10", "103", bytes.length, 0o100555);
  return {
    logicalPath: EXECUTABLE_PATH,
    leafName: "transactional_write-v3-fixture",
    heldFd: true,
    parentDevice: "10",
    parentInode: "102",
    before: structuredClone(observed),
    after: structuredClone(observed),
    bytes: bytes.length,
    sha256: sha256(bytes),
    elfSha256: canonicalSha256(parseG17Elf64(bytes)),
  };
}

function cargoRecords() {
  return [
    { reason: "compiler-message", package_id: PACKAGE_ID, message: {} },
    {
      reason: "compiler-artifact",
      package_id: PACKAGE_ID,
      manifest_path: MANIFEST_PATH,
      target: {
        kind: ["bench"],
        crate_types: ["bin"],
        name: "transactional_write",
        src_path: SOURCE_PATH,
        edition: "2024",
        doc: false,
        doctest: false,
        test: true,
      },
      profile: {
        opt_level: "3",
        debuginfo: 0,
        debug_assertions: false,
        overflow_checks: false,
        test: true,
      },
      features: [],
      filenames: [EXECUTABLE_PATH],
      executable: EXECUTABLE_PATH,
      fresh: false,
    },
    { reason: "build-finished", success: true },
  ];
}

function jsonl(records) {
  return Buffer.from(
    `${records.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );
}

function fixture() {
  const stdoutBytes = jsonl(cargoRecords());
  const stderrBytes = Buffer.alloc(0);
  const cgroupProcsBytes = Buffer.alloc(0);
  const cgroupEventsBytes = Buffer.from("populated 0\nfrozen 0\n", "utf8");
  const cgroupPidsCurrentBytes = Buffer.from("0\n", "utf8");
  const executableBytes = minimalElf();
  const controlRunId = "process-v3-fixture";
  const buildId = "negative-control";
  const productRole = "negativeControl";
  const processGeneration = `g17-process-${digest("process-v3-generation")}`;
  const ordinal = 1;
  const targetGeneration = `g17-target-${digest("target-v3-generation")}`;
  const executionRequestBinding = {
    schema: G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA,
    rawSha256: digest("execution-request-raw"),
    contentHash: digest("execution-request-content"),
  };
  const containmentBinding = {
    schema: G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA,
    rawSha256: digest("containment-raw"),
    contentHash: digest("containment-content"),
    ownerInputSha256: executionRequestBinding.rawSha256,
  };
  const expectedBase = {
    executionRequest: {
      ...executionRequestBinding,
      controlRunId,
      buildId,
      productRole,
      processGeneration,
      ordinal,
      targetGeneration,
      launchCompatibilityStatus:
        G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY.status,
      physicalLaunchEligible: false,
      binding: null,
      finalDecisionEligible: false,
    },
    containment: {
      schema: G17_NON_TMPFS_CONTAINMENT_PROJECTION_SCHEMA,
      evidenceSchema: containmentBinding.schema,
      rawSha256: containmentBinding.rawSha256,
      contentHash: containmentBinding.contentHash,
      ownerInputSha256: containmentBinding.ownerInputSha256,
      runId: controlRunId,
      workerGeneration: processGeneration,
      status: "CONTAINMENT_EVIDENCE_REPLAYED",
      binding: null,
      finalDecisionEligible: false,
    },
    controlRunId,
    buildId,
    productRole,
    processGeneration,
    ordinal,
    targetGeneration,
    targetRoot: {
      device: "10",
      inode: "100",
      uid: "1000",
      gid: "1000",
      filesystemType: "61267",
    },
    cargoArtifact: {
      packageId: PACKAGE_ID,
      manifestPath: MANIFEST_PATH,
      sourcePath: SOURCE_PATH,
    },
    executableLogicalPath: EXECUTABLE_PATH,
  };
  const targetExecutable = heldExecutable(executableBytes);
  const preliminary = seal({
    schema: G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_V3_SCHEMA,
    bindings: {
      executionRequest: structuredClone(executionRequestBinding),
      containment: structuredClone(containmentBinding),
    },
    identity: {
      controlRunId: expectedBase.controlRunId,
      buildId: expectedBase.buildId,
      productRole: expectedBase.productRole,
      processGeneration: expectedBase.processGeneration,
      ordinal: expectedBase.ordinal,
      targetGeneration: expectedBase.targetGeneration,
    },
    process: {
      generation: expectedBase.processGeneration,
      ordinal: expectedBase.ordinal,
      limits: structuredClone(G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS),
      disposition: "completed",
      firstTerminalReason: "completed",
      syntheticTestOnly: false,
      spawned: true,
      noChild: false,
      exitObserved: true,
      exitCode: 0,
      signal: null,
      closeObserved: true,
      closeCode: 0,
      closeSignal: null,
      stdoutEof: true,
      stderrEof: true,
      statusAgreement: true,
      reaped: true,
      directChildCleanupSafe: true,
      captureComplete: true,
      outputTruncated: false,
      durationMs: 1_234,
      terminationErrors: [],
      processErrors: [],
    },
    streams: {
      stdout: { bytes: stdoutBytes.length, sha256: sha256(stdoutBytes) },
      stderr: { bytes: stderrBytes.length, sha256: sha256(stderrBytes) },
    },
    cargo: {
      lineCount: 3,
      matchingCompilerArtifactLine: 2,
      finalBuildFinishedLine: 3,
    },
    completion: {
      sequence: [
        { ordinal: 1, observation: "direct-child-reaped" },
        { ordinal: 2, observation: "cgroup-quiescent" },
        { ordinal: 3, observation: "target-elf-held" },
      ],
      cgroup: {
        version: 2,
        processCount: 0,
        populated: false,
        pidsCurrent: 0,
        procs: {
          bytes: cgroupProcsBytes.length,
          sha256: sha256(cgroupProcsBytes),
        },
        events: {
          bytes: cgroupEventsBytes.length,
          sha256: sha256(cgroupEventsBytes),
        },
        pidsCurrentRaw: {
          bytes: cgroupPidsCurrentBytes.length,
          sha256: sha256(cgroupPidsCurrentBytes),
        },
      },
    },
    target: {
      generation: expectedBase.targetGeneration,
      root: heldTargetRoot(),
      ancestors: [
        heldAncestor("/state/target/release", "release", "101", "100"),
        heldAncestor("/state/target/release/deps", "deps", "102", "101"),
      ],
      executable: targetExecutable,
    },
    nonclaims: structuredClone(G17_BENCHMARK_BUILD_PROCESS_V3_NONCLAIMS),
    authority: structuredClone(G17_BENCHMARK_BUILD_PROCESS_V3_AUTHORITY),
    binding: false,
    finalDecisionEligible: false,
  });
  const value = structuredClone(preliminary);
  const input = {
    bytes: Buffer.alloc(0),
    expected: { ...expectedBase, evidence: null },
    stdoutBytes,
    stderrBytes,
    cgroupProcsBytes,
    cgroupEventsBytes,
    cgroupPidsCurrentBytes,
    executableBytes,
  };
  reseal({ value, input });
  return { value, input };
}

function reseal(item, { trust = true } = {}) {
  item.value = seal(item.value);
  item.input.bytes = canonicalBytes(item.value);
  if (trust) {
    item.input.expected.evidence = {
      rawSha256: sha256(item.input.bytes),
      contentHash: item.value.contentHash,
    };
  }
}

function bindStdout(item, records) {
  item.input.stdoutBytes = jsonl(records);
  item.value.streams.stdout = {
    bytes: item.input.stdoutBytes.length,
    sha256: sha256(item.input.stdoutBytes),
  };
}

test("v3 replays exact raw native observations without physical eligibility", () => {
  const item = fixture();
  const projection = verifyG17BenchmarkBuildProcessEvidenceV3(item.input);
  assert.equal(
    projection.schema,
    G17_BENCHMARK_BUILD_PROCESS_PROJECTION_V3_SCHEMA,
  );
  assert.equal(projection.status, "SUCCESSOR_PRIVATE_ISSUER_REQUIRED");
  assert.equal(projection.replayStatus, "PROCESS_EVIDENCE_V3_REPLAYED");
  assert.equal(projection.physicalOriginProven, false);
  assert.equal(projection.binding, false);
  assert.equal(projection.finalDecisionEligible, false);
  assert.equal(projection.process.firstTerminalReason, "completed");
  assert.equal(projection.process.syntheticTestOnly, false);
  assert.equal(projection.process.exitObserved, true);
  assert.equal(projection.process.closeObserved, true);
  assert.equal(projection.process.stdoutEof, true);
  assert.equal(projection.process.stderrEof, true);
  assert.equal(projection.process.statusAgreement, true);
  assert.equal(projection.process.reaped, true);
  assert.equal(projection.process.captureComplete, true);
  assert.equal(projection.completion.cgroup.pidsCurrent, 0);
  assert.equal(
    projection.dependencyProjections.executionRequest.launchCompatibilityStatus,
    "SUCCESSOR_ISOLATION_POLICY_REQUIRED",
  );
  assert.equal(projection.nonclaims.requestBoundCargoLaunchProvenance, false);
  assert.deepEqual(
    projection.authority,
    G17_BENCHMARK_BUILD_PROCESS_V3_AUTHORITY,
  );
  assert.deepEqual(
    projection.nonclaims,
    G17_BENCHMARK_BUILD_PROCESS_V3_NONCLAIMS,
  );
  assert.deepEqual(projection.streams.stdout, item.input.stdoutBytes);
  assert.deepEqual(projection.streams.stderr, item.input.stderrBytes);
  const escaped = projection.streams.stdout;
  escaped.fill(0);
  assert.deepEqual(projection.streams.stdout, item.input.stdoutBytes);
  assert.equal(Object.isFrozen(projection), true);
});

test("v3 binds the execution request into the containment owner input", () => {
  for (const mutate of [
    (item) => {
      item.value.bindings.executionRequest.rawSha256 = digest("other request");
    },
    (item) => {
      item.value.bindings.containment.contentHash = digest("other containment");
    },
    (item) => {
      item.value.bindings.containment.ownerInputSha256 = digest(
        "unbound owner input",
      );
    },
  ]) {
    const item = fixture();
    mutate(item);
    reseal(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
    );
  }
});

test("v3 exposes and requires every distinct successful terminal truth", () => {
  const mutations = [
    ["firstTerminalReason", "timeout"],
    ["syntheticTestOnly", true],
    ["spawned", false],
    ["noChild", true],
    ["exitObserved", false],
    ["exitCode", 1],
    ["closeObserved", false],
    ["closeCode", 1],
    ["stdoutEof", false],
    ["stderrEof", false],
    ["statusAgreement", false],
    ["reaped", false],
    ["directChildCleanupSafe", false],
    ["captureComplete", false],
    ["outputTruncated", true],
  ];
  for (const [field, replacement] of mutations) {
    const item = validFixture();
    item.value.process[field] = replacement;
    reseal(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
      field,
    );
  }
});

test("v3 pins all operational ceilings, including one shared stream ceiling", () => {
  const item = validFixture();
  item.value.process.limits.sharedOutputBytes += 1;
  reseal(item);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
    CONTRACT_ERROR,
  );
  assert.deepEqual(G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS, {
    timeoutMs: 300_000,
    sharedOutputBytes: 67_108_864,
    terminationGraceMs: 250,
    reapDeadlineMs: 2_000,
    aggregateArgvUtf8Bytes: 1_048_576,
  });
});

test("v3 requires exact process and target generation grammars", () => {
  for (const field of ["processGeneration", "targetGeneration"]) {
    const item = validFixture();
    item.input.expected[field] = `${field}-generic-safe-id`;
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
      field,
    );
  }

  const numericRun = validFixture();
  numericRun.input.expected.controlRunId = 1;
  numericRun.input.expected.executionRequest.controlRunId = 1;
  numericRun.input.expected.containment.runId = 1;
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(numericRun.input),
    CONTRACT_ERROR,
  );

  const numericIdentity = validFixture();
  numericIdentity.input.expected.targetRoot.device = 10;
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(numericIdentity.input),
    CONTRACT_ERROR,
  );

  const zeroIdentity = validFixture();
  zeroIdentity.input.expected.targetRoot.inode = "0";
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(zeroIdentity.input),
    CONTRACT_ERROR,
  );
});

test("v3 binds separately trusted request and containment replay projections", () => {
  for (const mutate of [
    (item) => {
      item.input.expected.executionRequest.physicalLaunchEligible = true;
    },
    (item) => {
      item.input.expected.executionRequest.launchCompatibilityStatus = "READY";
    },
    (item) => {
      item.input.expected.containment.status = "PHYSICAL";
    },
    (item) => {
      item.input.expected.containment.finalDecisionEligible = true;
    },
    (item) => {
      item.input.expected.executionRequest.controlRunId = "different-run";
    },
    (item) => {
      item.input.expected.executionRequest.buildId = "noise-control-a";
    },
    (item) => {
      item.input.expected.executionRequest.productRole = "noiseControl";
    },
    (item) => {
      item.input.expected.executionRequest.processGeneration = `g17-process-${digest("different-process")}`;
    },
    (item) => {
      item.input.expected.executionRequest.ordinal = 2;
    },
    (item) => {
      item.input.expected.executionRequest.targetGeneration = `g17-target-${digest("different-target")}`;
    },
    (item) => {
      item.input.expected.containment.runId = "different-run";
    },
    (item) => {
      item.input.expected.containment.workerGeneration = `g17-process-${digest("different-worker")}`;
    },
  ]) {
    const item = validFixture();
    mutate(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
    );
  }
});

test("v3 parses strict Cargo JSONL and rejects ambiguous or non-final success", () => {
  for (const records of [
    (() => {
      const rows = cargoRecords();
      rows.splice(2, 0, structuredClone(rows[1]));
      return rows;
    })(),
    (() => {
      const rows = cargoRecords();
      rows.at(-1).success = false;
      return rows;
    })(),
    (() => {
      const rows = cargoRecords();
      rows[1].fresh = true;
      return rows;
    })(),
    (() => {
      const rows = cargoRecords();
      delete rows[1].profile;
      return rows;
    })(),
    (() => {
      const rows = cargoRecords();
      rows[1].profile.test = false;
      return rows;
    })(),
    [...cargoRecords(), { reason: "compiler-message", package_id: PACKAGE_ID }],
    [...cargoRecords(), { reason: "build-finished", success: true }],
  ]) {
    const item = validFixture();
    bindStdout(item, records);
    reseal(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
    );
  }
});

test("v3 rejects duplicate JSON members and competing target-path claims", () => {
  const duplicate = validFixture();
  const rows = cargoRecords();
  duplicate.input.stdoutBytes = Buffer.from(
    `${JSON.stringify(rows[0])}\n${JSON.stringify(rows[1])}\n{"reason":"build-finished","success":false,"success":true}\n`,
    "utf8",
  );
  duplicate.value.streams.stdout = {
    bytes: duplicate.input.stdoutBytes.length,
    sha256: sha256(duplicate.input.stdoutBytes),
  };
  reseal(duplicate);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(duplicate.input),
    CONTRACT_ERROR,
  );

  const competing = validFixture();
  const competingRows = cargoRecords();
  const alternate = structuredClone(competingRows[1]);
  alternate.package_id =
    "path+file:///workspace/source/other#other-benchmark@0.1.0";
  alternate.manifest_path = "/workspace/source/other/Cargo.toml";
  alternate.target.name = "other_benchmark";
  alternate.target.src_path = "/workspace/source/other/benches/other.rs";
  competingRows.splice(2, 0, alternate);
  bindStdout(competing, competingRows);
  competing.value.cargo = {
    lineCount: 4,
    matchingCompilerArtifactLine: 2,
    finalBuildFinishedLine: 4,
  };
  reseal(competing);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(competing.input),
    CONTRACT_ERROR,
  );
});

test("v3 rejects malformed Cargo JSONL and a non-matching target artifact", () => {
  const malformed = validFixture();
  malformed.input.stdoutBytes = Buffer.from("{not-json}\n", "utf8");
  malformed.value.streams.stdout = {
    bytes: malformed.input.stdoutBytes.length,
    sha256: sha256(malformed.input.stdoutBytes),
  };
  reseal(malformed);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(malformed.input),
    CONTRACT_ERROR,
  );

  const wrongTarget = validFixture();
  const records = cargoRecords();
  records[1].target.name = "other_benchmark";
  bindStdout(wrongTarget, records);
  reseal(wrongTarget);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(wrongTarget.input),
    CONTRACT_ERROR,
  );
});

test("v3 rejects raw stream replacement independently of canonical evidence", () => {
  for (const field of ["stdoutBytes", "stderrBytes"]) {
    const item = validFixture();
    item.input[field] = Buffer.from("replacement", "utf8");
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
    );
  }
});

test("v3 requires declared reap/quiescence/held-ELF rows without proving their timing", () => {
  const reordered = validFixture();
  reordered.value.completion.sequence.reverse();
  reseal(reordered);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(reordered.input),
    CONTRACT_ERROR,
  );

  const populated = validFixture();
  populated.input.cgroupEventsBytes = Buffer.from(
    "populated 1\nfrozen 0\n",
    "utf8",
  );
  populated.value.completion.cgroup.events = {
    bytes: populated.input.cgroupEventsBytes.length,
    sha256: sha256(populated.input.cgroupEventsBytes),
  };
  reseal(populated);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(populated.input),
    CONTRACT_ERROR,
  );

  const processPresent = validFixture();
  processPresent.input.cgroupProcsBytes = Buffer.from("123\n", "utf8");
  processPresent.value.completion.cgroup.procs = {
    bytes: processPresent.input.cgroupProcsBytes.length,
    sha256: sha256(processPresent.input.cgroupProcsBytes),
  };
  reseal(processPresent);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(processPresent.input),
    CONTRACT_ERROR,
  );

  const pidsPresent = validFixture();
  pidsPresent.input.cgroupPidsCurrentBytes = Buffer.from("1\n", "utf8");
  pidsPresent.value.completion.cgroup.pidsCurrentRaw = {
    bytes: pidsPresent.input.cgroupPidsCurrentBytes.length,
    sha256: sha256(pidsPresent.input.cgroupPidsCurrentBytes),
  };
  reseal(pidsPresent);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(pidsPresent.input),
    CONTRACT_ERROR,
  );
});

test("v3 rejects unstable, unheld, replaced, or non-ELF target output", () => {
  for (const mutate of [
    (item) => {
      item.value.target.executable.heldFd = false;
    },
    (item) => {
      item.value.target.executable.after.inode = "999";
    },
    (item) => {
      item.value.target.ancestors[1].parentInode = "999";
    },
    (item) => {
      item.input.executableBytes.fill(0);
      item.value.target.executable.sha256 = sha256(item.input.executableBytes);
    },
  ]) {
    const item = validFixture();
    mutate(item);
    reseal(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
    );
  }

  for (const mutateBytes of [
    (bytes) => bytes.writeUInt16LE(1, 16),
    (bytes) => bytes.writeUInt16LE(4, 16),
    (bytes) => bytes.writeUInt32LE(0, 20),
    (bytes) => bytes.writeBigUInt64LE(0n, 24),
    (bytes) => bytes.writeUInt16LE(63, 52),
    (bytes) => bytes.writeUInt32LE(0, 64),
    (bytes) => bytes.writeUInt32LE(4, 68),
  ]) {
    const item = validFixture();
    mutateBytes(item.input.executableBytes);
    item.value.target.executable.sha256 = sha256(item.input.executableBytes);
    item.value.target.executable.elfSha256 = canonicalSha256(
      parseG17Elf64(item.input.executableBytes),
    );
    reseal(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
    );
  }
});

test("v3 rejects every serialized authority, binding, and eligibility upgrade", () => {
  assert.deepEqual(G17_BENCHMARK_BUILD_PROCESS_V3_AUTHORITY, {
    nativeProcessExecution: false,
    nativeObservationIssuance: false,
    containmentExecution: false,
    buildExecution: false,
    launchExecution: false,
    controlExecution: false,
    qualificationExecution: false,
    receipt: false,
    promotion: false,
    publication: false,
    routerQuality: false,
    providerExecution: false,
  });
  assert.deepEqual(G17_BENCHMARK_BUILD_PROCESS_V3_NONCLAIMS, {
    serializedReplayProvesNativeOrigin: false,
    serializedReplayProvesObservationOrder: false,
    heldCargoExecutableBeforeAfterIdentityAndSha256Observed: false,
    attestedExecveatLauncherIdentityAndSha256Observed: false,
    cloexecExecStatusPipeReplacementProofObserved: false,
    requestBoundCargoLaunchProvenance: false,
    privateCoLocatedIssuerImplemented: false,
    privateCapabilityPresent: false,
    physicalEligibility: false,
  });
  for (const mutate of [
    ...Object.keys(G17_BENCHMARK_BUILD_PROCESS_V3_AUTHORITY).map(
      (key) => (item) => {
        item.value.authority[key] = true;
      },
    ),
    ...Object.keys(G17_BENCHMARK_BUILD_PROCESS_V3_NONCLAIMS).map(
      (key) => (item) => {
        item.value.nonclaims[key] = true;
      },
    ),
    (item) => {
      item.value.binding = true;
    },
    (item) => {
      item.value.finalDecisionEligible = true;
    },
  ]) {
    const item = validFixture();
    mutate(item);
    reseal(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
    );
  }
});

test("v3 rejects non-canonical framing, unknown fields, and self-hash drift", () => {
  const extraLf = validFixture();
  extraLf.input.bytes = Buffer.concat([extraLf.input.bytes, Buffer.from("\n")]);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(extraLf.input),
    CONTRACT_ERROR,
  );

  const unknown = validFixture();
  unknown.value.unreviewed = false;
  reseal(unknown);
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(unknown.input),
    CONTRACT_ERROR,
  );

  const selfHash = validFixture();
  selfHash.value.contentHash = digest("wrong self hash");
  selfHash.input.bytes = canonicalBytes(selfHash.value);
  selfHash.input.expected.evidence.rawSha256 = sha256(selfHash.input.bytes);
  selfHash.input.expected.evidence.contentHash = selfHash.value.contentHash;
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(selfHash.input),
    CONTRACT_ERROR,
  );
});

test("v3 rejects malformed or contradictory raw cgroup evidence", () => {
  for (const events of [
    "populated 0\npopulated 0\n",
    "populated 00\n",
    "populated 0\r\n",
  ]) {
    const item = validFixture();
    item.input.cgroupEventsBytes = Buffer.from(events, "utf8");
    item.value.completion.cgroup.events = {
      bytes: item.input.cgroupEventsBytes.length,
      sha256: sha256(item.input.cgroupEventsBytes),
    };
    reseal(item);
    assert.throws(
      () => verifyG17BenchmarkBuildProcessEvidenceV3(item.input),
      CONTRACT_ERROR,
    );
  }
});

test("v3 defensively captures input and rejects accessor or Proxy envelopes", () => {
  const accessor = validFixture();
  Object.defineProperty(accessor.input, "stdoutBytes", {
    enumerable: true,
    get() {
      return Buffer.alloc(0);
    },
  });
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(accessor.input),
    CONTRACT_ERROR,
  );

  const nonEnumerable = validFixture();
  Object.defineProperty(nonEnumerable.input, "stderrBytes", {
    value: nonEnumerable.input.stderrBytes,
    enumerable: false,
  });
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(nonEnumerable.input),
    CONTRACT_ERROR,
  );

  const proxied = validFixture();
  proxied.input.expected = new Proxy(proxied.input.expected, {});
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(proxied.input),
    CONTRACT_ERROR,
  );

  const proxiedBuffer = validFixture();
  proxiedBuffer.input.stdoutBytes = new Proxy(
    proxiedBuffer.input.stdoutBytes,
    {},
  );
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(proxiedBuffer.input),
    CONTRACT_ERROR,
  );

  const lengthAccessor = validFixture();
  let lengthReads = 0;
  Object.defineProperty(lengthAccessor.input.stdoutBytes, "length", {
    configurable: true,
    get() {
      lengthReads += 1;
      return 1;
    },
  });
  assert.throws(
    () => verifyG17BenchmarkBuildProcessEvidenceV3(lengthAccessor.input),
    CONTRACT_ERROR,
  );
  assert.equal(lengthReads, 0);
});

test("v3 accepts bounded null-prototype records from co-located contract code", () => {
  const item = validFixture();
  item.input = Object.assign(Object.create(null), item.input);
  item.input.expected = Object.assign(Object.create(null), item.input.expected);
  item.input.expected.executionRequest = Object.assign(
    Object.create(null),
    item.input.expected.executionRequest,
  );
  const projection = verifyG17BenchmarkBuildProcessEvidenceV3(item.input);
  assert.equal(projection.status, "SUCCESSOR_PRIVATE_ISSUER_REQUIRED");
});

function validFixture() {
  return fixture();
}
