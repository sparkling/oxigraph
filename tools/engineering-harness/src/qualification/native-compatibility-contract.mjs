import { createHash } from "node:crypto";
import { basename, isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  parseCargoTestIds,
  parseCargoTestSummaries,
} from "../../../agentic-qe/native-test-contract.mjs";
import { canonicalJson } from "../routing/features.mjs";

export const G17_NATIVE_COMPATIBILITY_ARTIFACT_NAME =
  "native-compatibility-owner.json";
export const G17_NATIVE_COMPATIBILITY_OWNER_SCHEMA =
  "oxigraph.g1.7-native-compatibility-owner/v1";
export const G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA =
  "oxigraph.g1.7-native-compatibility-projection/v1";

const REPLAY_BOUNDARY =
  "sealed-bounded-raw-output-owner-replay-no-cargo-reexecution";
const WORKSPACE_POLICY = "exclusive-temporary-home-and-target-v1";
const CARGO_CACHE_POLICY = "sanitized-symlinked-registry-lock-checksum-v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_RUN_ID = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const MAX_OWNER_BYTES = 16 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(`G1.7 native compatibility owner: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function safeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function nonemptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
  return value;
}

function stringArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    fail(`${label} must be a string array`);
  }
  return value;
}

function uniqueTool(identity, program) {
  const matches = (identity?.toolchain ?? []).filter(
    (tool) => tool?.program === program,
  );
  if (matches.length !== 1) {
    fail(`sealed identity has no unique ${program} tool`);
  }
  const tool = matches[0];
  exactKeys(
    tool,
    [
      "program",
      "invokedPath",
      "path",
      "executableSha256",
      "toolchainPath",
      "toolchainExecutableSha256",
      "versionStdout",
    ],
    `${program} identity`,
  );
  for (const key of ["invokedPath", "path", "toolchainPath", "versionStdout"]) {
    nonemptyString(tool[key], `${program} identity ${key}`);
  }
  for (const key of ["executableSha256", "toolchainExecutableSha256"]) {
    if (!DIGEST.test(tool[key] ?? "")) {
      fail(`${program} identity ${key} is invalid`);
    }
  }
  return {
    program,
    invokedPath: tool.invokedPath,
    path: tool.path,
    executableSha256: tool.executableSha256,
    toolchainPath: tool.toolchainPath,
    toolchainExecutableSha256: tool.toolchainExecutableSha256,
    versionStdout: tool.versionStdout,
  };
}

function uniqueToolchain(identity) {
  return {
    cargo: uniqueTool(identity, "cargo"),
    rustc: uniqueTool(identity, "rustc"),
  };
}

function toolProjection(tool) {
  return Object.freeze({
    executableSha256: tool.executableSha256,
    toolchainExecutableSha256: tool.toolchainExecutableSha256,
    versionSha256: sha256(Buffer.from(tool.versionStdout, "utf8")),
  });
}

function identityProjection(identity) {
  if (
    identity?.schema !== "oxigraph.g1.7-qualified-subject-identity/v2" ||
    !DIGEST.test(identity.identitySha256 ?? "") ||
    !GIT_OBJECT.test(identity.subject?.commit ?? "") ||
    !GIT_OBJECT.test(identity.subject?.tree ?? "") ||
    identity.subject?.trackedClean !== true ||
    !GIT_OBJECT.test(identity.cargoLock?.blob ?? "") ||
    !DIGEST.test(identity.cargoLock?.sha256 ?? "")
  ) {
    fail("sealed identity projection is invalid");
  }
  return {
    identitySha256: identity.identitySha256,
    subjectCommit: identity.subject.commit,
    subjectTree: identity.subject.tree,
    cargoLockBlob: identity.cargoLock.blob,
    cargoLockSha256: identity.cargoLock.sha256,
  };
}

export function g17NativeInventoryArgv(reviewedArgv) {
  stringArray(reviewedArgv, "reviewed Cargo argv");
  if (reviewedArgv[0] !== "cargo") fail("reviewed native program is not Cargo");
  const separator = reviewedArgv.indexOf("--");
  const cargoArgv =
    separator < 0 ? reviewedArgv : reviewedArgv.slice(0, separator);
  return [...cargoArgv, "--", "--list", "--format", "terse"];
}

export function g17NativeExecutionArgv(reviewedArgv, targetDirectory) {
  stringArray(reviewedArgv, "reviewed Cargo argv");
  if (
    reviewedArgv[0] !== "cargo" ||
    reviewedArgv[1] !== "test" ||
    typeof targetDirectory !== "string" ||
    !isAbsolute(targetDirectory)
  ) {
    fail("native execution target contract is invalid");
  }
  return [
    reviewedArgv[0],
    reviewedArgv[1],
    "--target-dir",
    targetDirectory,
    ...reviewedArgv.slice(2),
  ];
}

function workspaceProjection(workspace, runId) {
  exactKeys(
    workspace,
    [
      "policy",
      "root",
      "homeDirectory",
      "targetDirectory",
      "cargoCachePolicy",
      "cargoCachePackageCount",
      "cargoCacheSha256",
    ],
    "workspace",
  );
  for (const key of ["root", "homeDirectory", "targetDirectory"]) {
    nonemptyString(workspace[key], `workspace ${key}`);
    if (!isAbsolute(workspace[key])) fail(`workspace ${key} is not absolute`);
  }
  if (
    workspace.policy !== WORKSPACE_POLICY ||
    workspace.cargoCachePolicy !== CARGO_CACHE_POLICY ||
    safeInteger(
      workspace.cargoCachePackageCount,
      "workspace Cargo cache package count",
    ) < 1 ||
    !DIGEST.test(workspace.cargoCacheSha256 ?? "") ||
    workspace.homeDirectory !== join(workspace.root, "home") ||
    workspace.targetDirectory !== join(workspace.root, "target") ||
    !basename(workspace.root).startsWith(`oxigraph-g17-${runId}-`)
  ) {
    fail("workspace does not satisfy the exclusive temporary policy");
  }
  return {
    policy: workspace.policy,
    root: workspace.root,
    homeDirectory: workspace.homeDirectory,
    targetDirectory: workspace.targetDirectory,
    cargoCachePolicy: workspace.cargoCachePolicy,
    cargoCachePackageCount: workspace.cargoCachePackageCount,
    cargoCacheSha256: workspace.cargoCacheSha256,
  };
}

function strictBase64(value, label) {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    fail(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value)
    fail(`${label} is not canonical base64`);
  return bytes;
}

function streamRecord(bytes, summary, label) {
  if (!Buffer.isBuffer(bytes)) fail(`${label} bytes are missing`);
  if (
    summary === null ||
    typeof summary !== "object" ||
    summary.bytes !== bytes.length ||
    summary.sha256 !== sha256(bytes)
  ) {
    fail(`${label} differs from its complete-stream digest`);
  }
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  };
}

function processRecord(observation, lane, expectedArgv, cargo, label) {
  plainObject(observation, `${label} observation`);
  const result = plainObject(observation.result, `${label} result`);
  if (
    observation.program !== cargo.toolchainPath ||
    !isDeepStrictEqual(observation.args, expectedArgv)
  ) {
    fail(`${label} command differs from the sealed tool and contract`);
  }
  const captured = plainObject(
    result.capturedOutput,
    `${label} captured output`,
  );
  if (captured.limitBytes !== lane.maxOutputBytes) {
    fail(`${label} capture ceiling differs from the contract`);
  }
  const output = plainObject(result.output, `${label} output digest`);
  const stdout = streamRecord(
    captured.stdout,
    { bytes: output.stdoutBytes, sha256: output.stdoutSha256 },
    `${label} stdout`,
  );
  const stderr = streamRecord(
    captured.stderr,
    { bytes: output.stderrBytes, sha256: output.stderrSha256 },
    `${label} stderr`,
  );
  if (stdout.bytes + stderr.bytes > lane.maxOutputBytes) {
    fail(`${label} output exceeds the contract ceiling`);
  }
  return {
    program: observation.program,
    argv: [...observation.args],
    exitCode: result.code ?? null,
    signal: result.signal ?? null,
    spawnFailed: result.spawnError !== null,
    timedOut: result.timedOut,
    outputLimitExceeded: result.outputLimitExceeded,
    scanLimitExceeded: result.scanLimitExceeded,
    timeoutMs: result.timeoutMs,
    durationMs: result.durationMs,
    stdout,
    stderr,
  };
}

function decodedStream(value, label) {
  exactKeys(value, ["bytes", "sha256", "base64"], label);
  safeInteger(value.bytes, `${label} bytes`);
  if (!DIGEST.test(value.sha256 ?? "")) fail(`${label} digest is invalid`);
  const bytes = strictBase64(value.base64, `${label} base64`);
  if (bytes.length !== value.bytes || sha256(bytes) !== value.sha256) {
    fail(`${label} bytes differ from their binding`);
  }
  try {
    return { bytes, text: utf8.decode(bytes) };
  } catch (error) {
    fail(`${label} is not UTF-8: ${error.message}`);
  }
}

function validateProcess(value, lane, expectedArgv, cargo, label) {
  exactKeys(
    value,
    [
      "program",
      "argv",
      "exitCode",
      "signal",
      "spawnFailed",
      "timedOut",
      "outputLimitExceeded",
      "scanLimitExceeded",
      "timeoutMs",
      "durationMs",
      "stdout",
      "stderr",
    ],
    label,
  );
  if (
    value.program !== cargo.toolchainPath ||
    !isDeepStrictEqual(value.argv, expectedArgv) ||
    value.exitCode !== 0 ||
    value.signal !== null ||
    value.spawnFailed !== false ||
    value.timedOut !== false ||
    value.outputLimitExceeded !== false ||
    value.scanLimitExceeded !== false ||
    value.timeoutMs !== lane.timeoutMs
  ) {
    fail(`${label} did not complete under the frozen command contract`);
  }
  const durationMs = safeInteger(value.durationMs, `${label} duration`);
  if (durationMs > lane.timeoutMs) {
    fail(`${label} duration exceeds the frozen timeout`);
  }
  const stdout = decodedStream(value.stdout, `${label} stdout`);
  const stderr = decodedStream(value.stderr, `${label} stderr`);
  if (stdout.bytes.length + stderr.bytes.length > lane.maxOutputBytes) {
    fail(`${label} output exceeds the contract ceiling`);
  }
  return { stdout, stderr };
}

export function replayG17NativeLaneOutputContract({
  lane,
  inventoryStdout,
  inventoryStderr,
  executionStdout,
  executionStderr,
}) {
  try {
    plainObject(lane, "reviewed native lane");
    for (const [value, label] of [
      [inventoryStdout, "inventory stdout"],
      [inventoryStderr, "inventory stderr"],
      [executionStdout, "execution stdout"],
      [executionStderr, "execution stderr"],
    ]) {
      if (typeof value !== "string") fail(`${label} is not UTF-8 text`);
    }
    if (
      typeof lane.id !== "string" ||
      !Array.isArray(lane.expectedTestIds) ||
      !Number.isSafeInteger(lane.expectedPassedTests) ||
      lane.expectedPassedTests < 0
    ) {
      fail("reviewed native lane semantics are malformed");
    }
    const inventoriedTestIds = [
      ...parseCargoTestIds(inventoryStdout),
      ...parseCargoTestIds(inventoryStderr),
    ].sort();
    if (!isDeepStrictEqual(inventoriedTestIds, lane.expectedTestIds)) {
      fail(`${lane.id} inventory differs from the reviewed test IDs`);
    }
    const summaries = [
      ...parseCargoTestSummaries(executionStdout),
      ...parseCargoTestSummaries(executionStderr),
    ];
    if (
      summaries.length !== 1 ||
      summaries[0].status !== "ok" ||
      summaries[0].passed !== lane.expectedPassedTests ||
      summaries[0].failed !== 0 ||
      summaries[0].ignored !== 0 ||
      summaries[0].measured !== 0 ||
      summaries[0].filteredOut !== 0
    ) {
      fail(`${lane.id} execution summary differs from the contract`);
    }
    return Object.freeze({
      inventoriedTestIds: Object.freeze(inventoriedTestIds),
      observedPassedTests: summaries[0].passed,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native compatibility owner:"))
      throw error;
    fail(error.message);
  }
}

function ownerFromObservations({
  runId,
  contract,
  identity,
  workspace,
  observations,
}) {
  if (!SAFE_RUN_ID.test(runId ?? "")) fail("run id is unsafe");
  if (!Array.isArray(observations))
    fail("native observations must be an array");
  const toolchain = uniqueToolchain(identity);
  const { cargo } = toolchain;
  const sealedWorkspace = workspaceProjection(workspace, runId);
  const reviewedLanes = contract?.compatibility?.native;
  if (
    !Array.isArray(reviewedLanes) ||
    observations.length !== reviewedLanes.length
  ) {
    fail("native observation inventory differs from the contract");
  }
  const lanes = reviewedLanes.map((lane, index) => {
    const observation = observations[index];
    if (observation?.id !== lane.id) fail("native observation order drifted");
    return {
      id: lane.id,
      reviewedArgv: [...lane.argv],
      expectedTestIds: [...lane.expectedTestIds],
      expectedPassedTests: lane.expectedPassedTests,
      maxOutputBytes: lane.maxOutputBytes,
      timeoutMs: lane.timeoutMs,
      inventory: processRecord(
        observation.inventory,
        lane,
        g17NativeInventoryArgv(
          g17NativeExecutionArgv(lane.argv, sealedWorkspace.targetDirectory),
        ).slice(1),
        cargo,
        `${lane.id} inventory`,
      ),
      execution: processRecord(
        observation.execution,
        lane,
        g17NativeExecutionArgv(
          lane.argv,
          sealedWorkspace.targetDirectory,
        ).slice(1),
        cargo,
        `${lane.id} execution`,
      ),
    };
  });
  return {
    schema: G17_NATIVE_COMPATIBILITY_OWNER_SCHEMA,
    replayBoundary: REPLAY_BOUNDARY,
    runId,
    identity: identityProjection(identity),
    toolchain,
    workspace: sealedWorkspace,
    lanes,
  };
}

function parseCanonicalOwner(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 1 ||
    bytes.length > MAX_OWNER_BYTES
  ) {
    fail("artifact is not a bounded Buffer");
  }
  let owner;
  try {
    owner = JSON.parse(bytes);
  } catch (error) {
    fail(`artifact is invalid JSON: ${error.message}`);
  }
  const expected = Buffer.from(`${canonicalJson(owner)}\n`, "utf8");
  if (!bytes.equals(expected)) fail("artifact is not canonical JSON");
  return owner;
}

function verifyOwner({ runId, contract, identity, owner, bytes }) {
  exactKeys(
    owner,
    [
      "schema",
      "replayBoundary",
      "runId",
      "identity",
      "toolchain",
      "workspace",
      "lanes",
    ],
    "artifact",
  );
  if (
    owner.schema !== G17_NATIVE_COMPATIBILITY_OWNER_SCHEMA ||
    owner.replayBoundary !== REPLAY_BOUNDARY ||
    owner.runId !== runId
  ) {
    fail("artifact identity drifted");
  }
  const expectedIdentity = identityProjection(identity);
  exactKeys(
    owner.identity,
    [
      "identitySha256",
      "subjectCommit",
      "subjectTree",
      "cargoLockBlob",
      "cargoLockSha256",
    ],
    "artifact identity",
  );
  if (!isDeepStrictEqual(owner.identity, expectedIdentity)) {
    fail("artifact subject differs from the sealed identity");
  }
  const toolchain = uniqueToolchain(identity);
  if (!isDeepStrictEqual(owner.toolchain, toolchain)) {
    fail("artifact toolchain differs from the sealed identity");
  }
  const { cargo } = toolchain;
  const workspace = workspaceProjection(owner.workspace, runId);
  const reviewedLanes = contract?.compatibility?.native;
  if (
    !Array.isArray(reviewedLanes) ||
    !Array.isArray(owner.lanes) ||
    owner.lanes.length !== reviewedLanes.length
  ) {
    fail("artifact lane inventory differs from the contract");
  }
  let totalPassedTests = 0;
  const lanes = owner.lanes.map((laneEvidence, index) => {
    const lane = reviewedLanes[index];
    exactKeys(
      laneEvidence,
      [
        "id",
        "reviewedArgv",
        "expectedTestIds",
        "expectedPassedTests",
        "maxOutputBytes",
        "timeoutMs",
        "inventory",
        "execution",
      ],
      `lane ${index}`,
    );
    if (
      laneEvidence.id !== lane.id ||
      !isDeepStrictEqual(laneEvidence.reviewedArgv, lane.argv) ||
      !isDeepStrictEqual(laneEvidence.expectedTestIds, lane.expectedTestIds) ||
      laneEvidence.expectedPassedTests !== lane.expectedPassedTests ||
      laneEvidence.maxOutputBytes !== lane.maxOutputBytes ||
      laneEvidence.timeoutMs !== lane.timeoutMs
    ) {
      fail(`lane ${index} differs from the contract`);
    }
    const inventory = validateProcess(
      laneEvidence.inventory,
      lane,
      g17NativeInventoryArgv(
        g17NativeExecutionArgv(lane.argv, workspace.targetDirectory),
      ).slice(1),
      cargo,
      `${lane.id} inventory`,
    );
    const execution = validateProcess(
      laneEvidence.execution,
      lane,
      g17NativeExecutionArgv(lane.argv, workspace.targetDirectory).slice(1),
      cargo,
      `${lane.id} execution`,
    );
    const replay = replayG17NativeLaneOutputContract({
      lane,
      inventoryStdout: inventory.stdout.text,
      inventoryStderr: inventory.stderr.text,
      executionStdout: execution.stdout.text,
      executionStderr: execution.stderr.text,
    });
    totalPassedTests += replay.observedPassedTests;
    return {
      id: lane.id,
      status: "PASS",
      argv: [...lane.argv],
      expectedPassedTests: lane.expectedPassedTests,
      observedPassedTests: replay.observedPassedTests,
      inventoriedTests: replay.inventoriedTestIds.length,
      inventoriedTestIds: replay.inventoriedTestIds,
      exitCode: laneEvidence.execution.exitCode,
      signal: laneEvidence.execution.signal,
      spawnFailed: laneEvidence.execution.spawnFailed,
      timedOut: laneEvidence.execution.timedOut,
      outputLimitExceeded: laneEvidence.execution.outputLimitExceeded,
      scanLimitExceeded: laneEvidence.execution.scanLimitExceeded,
      durationMs: laneEvidence.execution.durationMs,
      inventoryDurationMs: laneEvidence.inventory.durationMs,
      output: {
        stdoutBytes: laneEvidence.execution.stdout.bytes,
        stderrBytes: laneEvidence.execution.stderr.bytes,
        stdoutSha256: laneEvidence.execution.stdout.sha256,
        stderrSha256: laneEvidence.execution.stderr.sha256,
      },
      inventoryOutput: {
        stdoutBytes: laneEvidence.inventory.stdout.bytes,
        stderrBytes: laneEvidence.inventory.stderr.bytes,
        stdoutSha256: laneEvidence.inventory.stdout.sha256,
        stderrSha256: laneEvidence.inventory.stderr.sha256,
      },
      inventoryScanLimitExceeded: laneEvidence.inventory.scanLimitExceeded,
    };
  });
  return Object.freeze({
    schema: G17_NATIVE_COMPATIBILITY_PROJECTION_SCHEMA,
    status: "PASS",
    replayBoundary: REPLAY_BOUNDARY,
    subjectIdentitySha256: identity.identitySha256,
    ownerArtifact: Object.freeze({
      name: G17_NATIVE_COMPATIBILITY_ARTIFACT_NAME,
      bytes: bytes.length,
      sha256: sha256(bytes),
    }),
    toolchain: Object.freeze({
      cargo: toolProjection(toolchain.cargo),
      rustc: toolProjection(toolchain.rustc),
    }),
    workspace: Object.freeze({
      policy: workspace.policy,
      cargoCachePolicy: workspace.cargoCachePolicy,
      cargoCachePackageCount: workspace.cargoCachePackageCount,
      cargoCacheSha256: workspace.cargoCacheSha256,
      sha256: sha256(Buffer.from(canonicalJson(workspace), "utf8")),
    }),
    lanes: Object.freeze(lanes.map(Object.freeze)),
    totalPassedTests,
  });
}

export function createG17NativeCompatibilityEvidence(options) {
  try {
    const owner = ownerFromObservations(options);
    const bytes = Buffer.from(`${canonicalJson(owner)}\n`, "utf8");
    const projection = verifyOwner({ ...options, owner, bytes });
    return Object.freeze({
      artifact: Object.freeze({
        name: G17_NATIVE_COMPATIBILITY_ARTIFACT_NAME,
        bytes,
        sha256: sha256(bytes),
      }),
      projection,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 native compatibility owner:"))
      throw error;
    fail(error.message);
  }
}

export function verifyG17NativeCompatibilityEvidence({
  runId,
  contract,
  identity,
  bytes,
}) {
  try {
    const owner = parseCanonicalOwner(bytes);
    return verifyOwner({ runId, contract, identity, owner, bytes });
  } catch (error) {
    if (error.message.startsWith("G1.7 native compatibility owner:"))
      throw error;
    fail(error.message);
  }
}
