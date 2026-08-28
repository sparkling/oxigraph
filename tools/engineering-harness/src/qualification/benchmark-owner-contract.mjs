import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import {
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_CONTROL_PLAN,
  G17_BENCHMARK_LEGACY_BUILD_ARGV,
  G17_BENCHMARK_LEGACY_BUILD_ENVIRONMENT,
  g17BenchmarkControlCoordinates,
  g17BenchmarkLaunchArgv,
} from "./benchmark-execution-plan.mjs";
import {
  G17_CONTROL_SAMPLE_SET_SCHEMA,
  G17_CONTROL_STATISTICS_CONTRACT,
} from "./control-statistics-contract.mjs";
import { g17ControlSampleSetBytes } from "./control-statistics-replay.mjs";

export { G17_BENCHMARK_BUILD_PLAN };

// This module only replays already-captured bytes. It performs no I/O and
// returns no execution, qualification, receipt, publication, or promotion
// authority. A sealed control receipt must batch the expanded launch records
// below so its physical inventory remains within the frozen 128-file ceiling.

export const G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA =
  "oxigraph.g1.7-benchmark-workspace-owner/v1";
export const G17_BENCHMARK_BUILD_OWNER_SCHEMA =
  "oxigraph.g1.7-benchmark-build-owner/v1";
export const G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA =
  "oxigraph.g1.7-benchmark-launch-attestation/v1";
export const G17_BENCHMARK_SESSION_OWNER_SCHEMA =
  "oxigraph.g1.7-benchmark-session-owner/v1";
export const G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA =
  "oxigraph.g1.7-benchmark-owner-bundle-projection/v1";
export const G17_BENCHMARK_OWNER_CONTROL_PROTOCOL_SHA256 =
  "4f5978b873873094196d5d5998565b0acb0bf883beac1466b2fa91343b96c0f2";

const G17_CONTROL_AUTHORIZATION_SCHEMA =
  "oxigraph.g1.7-control-authorization/v3";
const RAW_SAMPLE_SCHEMA = "oxigraph.transactional-write-sample/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const GIT_OID = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const EXECUTABLE_PATH =
  /^\/state\/target\/release\/deps\/transactional_write-[a-zA-Z0-9._-]+$/u;
const MAX_OWNER_BYTES = 4 * 1024 * 1024;
const MAX_BUILD_STREAM_BYTES = 64 * 1024 * 1024;
const MAX_LAUNCH_STDOUT_BYTES = 64 * 1024;
const MAX_SAMPLE_SET_BYTES = 8 * 1024 * 1024;
const MAX_SNAPSHOT_DEPTH = 64;
const MAX_SNAPSHOT_NODES = 100_000;
const MAX_SNAPSHOT_ARRAY_LENGTH = 4_096;
const MAX_SNAPSHOT_PROPERTIES = 4_097;
const MAX_SNAPSHOT_STRING_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOT_SINGLE_STRING_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_FILES = 2_048;
const MAX_SNAPSHOT_BUFFER_BYTES = 256 * 1024 * 1024;
const MAX_CARGO_JSONL_ROWS = 4_096;
const MAX_CARGO_JSONL_ROW_BYTES = 1024 * 1024;
const MAX_CARGO_JSONL_ROW_NODES = 8_192;
const MAX_CARGO_JSONL_ROW_STRING_BYTES = 1024 * 1024;
const MAX_CARGO_JSONL_NODES = 100_000;
const MAX_CARGO_JSONL_STRING_BYTES = 16 * 1024 * 1024;

const OWNER_POLICY = Object.freeze({
  controlReceiptSchema: "oxigraph.g1.7-control-run-receipt/v1",
  workspaceOwnerSchema: G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA,
  buildOwnerSchema: G17_BENCHMARK_BUILD_OWNER_SCHEMA,
  launchAttestationSchema: G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA,
  sessionOwnerSchema: G17_BENCHMARK_SESSION_OWNER_SCHEMA,
  rawBuildReplayRequired: true,
  rawLaunchReplayRequired: true,
  summaryRecomputationRequired: true,
  isolatedWorkspacePerProduct: true,
  isolatedTargetPerProduct: true,
  productSubstitutionForbidden: true,
  controlEnvelope: {
    maxFiles: 128,
    maxFileBytes: 67_108_864,
    maxAggregateBytes: 268_435_456,
    regularFilesOnly: true,
    singleLinkOnly: true,
    ownerOnly: true,
    writeOnce: true,
    receiptLast: true,
  },
});

function fail(message) {
  throw new Error(`G1.7 benchmark owner contract: ${message}`);
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function snapshotInput(
  value,
  label,
  ancestors = new WeakSet(),
  depth = 0,
  budget = {
    nodes: 0,
    stringBytes: 0,
    files: 0,
    bufferBytes: 0,
    nodeLimit: MAX_SNAPSHOT_NODES,
    stringLimit: MAX_SNAPSHOT_STRING_BYTES,
  },
) {
  if (
    value !== null &&
    typeof value === "object" &&
    types.isProxy(value)
  ) {
    fail(`${label} contains a Proxy`);
  }
  if (depth > MAX_SNAPSHOT_DEPTH) {
    fail(`${label} exceeds the snapshot depth limit`);
  }
  budget.nodes += 1;
  if (budget.nodes > budget.nodeLimit) {
    fail(`${label} exceeds the snapshot node limit`);
  }
  if (Buffer.isBuffer(value)) {
    budget.files += 1;
    budget.bufferBytes += value.length;
    if (
      budget.files > MAX_SNAPSHOT_FILES ||
      budget.bufferBytes > MAX_SNAPSHOT_BUFFER_BYTES
    ) {
      fail(`${label} exceeds the snapshot Buffer budget`);
    }
    return Buffer.from(value);
  }
  if (
    value === null ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.stringBytes += bytes;
    if (
      bytes > MAX_SNAPSHOT_SINGLE_STRING_BYTES ||
      budget.stringBytes > budget.stringLimit
    ) {
      fail(`${label} exceeds the snapshot string budget`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    fail(`${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) fail(`${label} contains a cycle`);
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    fail(`${label} must contain only ordinary objects, arrays, and Buffers`);
  }
  ancestors.add(value);
  try {
    let length;
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      length = lengthDescriptor?.value;
      if (
        lengthDescriptor === undefined ||
        "get" in lengthDescriptor ||
        "set" in lengthDescriptor ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_SNAPSHOT_ARRAY_LENGTH
      ) {
        fail(`${label} array length is invalid`);
      }
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_SNAPSHOT_PROPERTIES) {
      fail(`${label} exceeds the snapshot property limit`);
    }
    if (keys.some((key) => typeof key !== "string")) {
      fail(`${label} contains symbol fields`);
    }
    for (const key of keys) {
      const keyBytes = Buffer.byteLength(key, "utf8");
      budget.stringBytes += keyBytes;
      if (
        keyBytes > MAX_SNAPSHOT_SINGLE_STRING_BYTES ||
        budget.stringBytes > budget.stringLimit
      ) {
        fail(`${label} exceeds the snapshot key budget`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) {
        fail(`${label}.${key} disappeared during snapshot`);
      }
      if ("get" in descriptor || "set" in descriptor) {
        fail(`${label} contains accessor fields`);
      }
    }
    if (array) {
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ];
      if (!isDeepStrictEqual([...keys].sort(), expectedKeys.sort())) {
        fail(`${label} arrays must be dense and field-free`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotInput(
          Object.getOwnPropertyDescriptor(value, String(index)).value,
          `${label}[${index}]`,
          ancestors,
          depth + 1,
          budget,
        ),
      );
    }
    const snapshot = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || "get" in descriptor || "set" in descriptor) {
        fail(`${label}.${key} changed during snapshot`);
      }
      if (!descriptor.enumerable) fail(`${label}.${key} is not enumerable`);
      Object.defineProperty(snapshot, key, {
        value: snapshotInput(
          descriptor.value,
          `${label}.${key}`,
          ancestors,
          depth + 1,
          budget,
        ),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return snapshot;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalValue(value, ancestors) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      fail("canonical JSON contains a non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    fail("canonical JSON contains non-JSON data");
  }
  if (ancestors.has(value)) fail("canonical JSON contains a cycle");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        fail("canonical JSON arrays must be dense and field-free");
      }
      return `[${value
        .map((item) => canonicalValue(item, ancestors))
        .join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail("canonical JSON objects must be ordinary objects");
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalValue(value[key], ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJson(value) {
  return canonicalValue(value, new WeakSet());
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function gitOid(value, label) {
  if (!GIT_OID.test(value ?? "")) fail(`${label} is not a Git object ID`);
  return value;
}

function safeId(value, label) {
  if (!SAFE_ID.test(value ?? "")) fail(`${label} is not a safe identifier`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function canonicalTimestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(`${label} is not a canonical UTC timestamp`);
  }
  return value;
}

function boundedBytes(value, maximumBytes, label, { allowEmpty = true } = {}) {
  if (!Buffer.isBuffer(value)) fail(`${label} must be a Buffer`);
  const bytes = Buffer.from(value);
  if ((!allowEmpty && bytes.length === 0) || bytes.length > maximumBytes) {
    fail(`${label} is outside its byte bound`);
  }
  return bytes;
}

function utf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${label} is not valid UTF-8: ${error.message}`);
  }
}

function decodeCanonicalOwner(bytesValue, schema, label) {
  const bytes = boundedBytes(bytesValue, MAX_OWNER_BYTES, label, {
    allowEmpty: false,
  });
  const text = utf8(bytes, label);
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(`${label} must be exactly one LF-terminated canonical JSON value`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  const value = snapshotInput(parsed, label);
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail(`${label} is not canonical JSON`);
  }
  if (value.schema !== schema) fail(`${label} schema drifted`);
  digest(value.contentHash, `${label} contentHash`);
  const { contentHash, ...unsigned } = value;
  if (contentHash !== canonicalSha256(unsigned)) {
    fail(`${label} self-hash does not verify`);
  }
  return { value, rawSha256: sha256(bytes) };
}

function authorizationBinding(value, label = "authorization binding") {
  exactKeys(value, ["rawSha256", "contentHash"], label);
  return {
    rawSha256: digest(value.rawSha256, `${label} rawSha256`),
    contentHash: digest(value.contentHash, `${label} contentHash`),
  };
}

function validateAuthorization({ authorization, authorizationRawSha256 }) {
  const value = snapshotInput(authorization, "control authorization");
  exactKeys(
    value,
    ["schema", "id", "status", "protocol", "approval", "contentHash"],
    "control authorization",
  );
  if (
    value.schema !== G17_CONTROL_AUTHORIZATION_SCHEMA ||
    value.id !== "control-authorization" ||
    value.status !== "CONTROL_AUTHORIZED"
  ) {
    fail("only an approved v3 control authorization can bind owner evidence");
  }
  exactKeys(
    value.approval,
    ["status", "approvedBy", "approvedAt"],
    "control authorization approval",
  );
  if (
    value.approval.status !== "APPROVED" ||
    typeof value.approval.approvedBy !== "string" ||
    value.approval.approvedBy.trim().length === 0
  ) {
    fail("control authorization lacks a named human approval");
  }
  canonicalTimestamp(
    value.approval.approvedAt,
    "control authorization approvedAt",
  );
  digest(value.contentHash, "control authorization contentHash");
  const { contentHash, ...unsigned } = value;
  if (value.contentHash !== canonicalSha256(unsigned)) {
    fail("control authorization self-hash does not verify");
  }
  exactKeys(
    value.protocol,
    [
      "suite",
      "darwin",
      "controlStatistics",
      "products",
      "evaluatorOverlay",
      "execution",
      "thresholds",
      "ownerPolicy",
      "environment",
      "authorizationScope",
    ],
    "control authorization protocol",
  );
  if (
    canonicalSha256(value.protocol) !==
      G17_BENCHMARK_OWNER_CONTROL_PROTOCOL_SHA256 ||
    !isDeepStrictEqual(
      value.protocol.controlStatistics,
      G17_CONTROL_STATISTICS_CONTRACT,
    ) ||
    !isDeepStrictEqual(
      value.protocol.suite,
      G17_CONTROL_STATISTICS_CONTRACT.suite,
    ) ||
    !isDeepStrictEqual(value.protocol.ownerPolicy, OWNER_POLICY)
  ) {
    fail("control statistics, suite, or owner policy drifted");
  }
  const scope = value.protocol.authorizationScope;
  if (
    scope?.negativeControlExecution !== true ||
    scope.aaNoiseControlExecution !== true ||
    scope.subjectQualificationExecution !== false ||
    scope.performanceReferenceQualificationExecution !== false ||
    scope.promotionAuthority !== false ||
    scope.publicationAuthority !== false ||
    scope.routerQualityAuthority !== false ||
    scope.providerExecutionAuthority !== false
  ) {
    fail("control authorization scope drifted or carries forbidden authority");
  }
  const products = value.protocol.products;
  const compositions = value.protocol.evaluatorOverlay?.roleCompositions;
  for (const role of [
    "negativeControl",
    "performanceReference",
    "noiseControl",
    "currentSubject",
  ]) {
    if (products?.[role] === undefined || compositions?.[role] === undefined) {
      fail(`control authorization lacks ${role} identity or composition`);
    }
  }
  const environment = value.protocol.environment;
  if (
    environment?.class !== "linux-x86_64-cgroup-v2-non-tmpfs-serialized" ||
    environment.harnessSessionExclusive !== true ||
    environment.nonTmpfsVolumeRequired !== true ||
    environment.cargoBuildJobs !== 4
  ) {
    fail("control environment contract drifted");
  }
  const rawSha256 = digest(
    authorizationRawSha256,
    "control authorization rawSha256",
  );
  return deepFreeze({
    authorization: value,
    binding: { rawSha256, contentHash: value.contentHash },
  });
}

function expectedEvaluator(authorization, productRole) {
  const overlay = authorization.protocol.evaluatorOverlay;
  return {
    commit: overlay.commit,
    parent: overlay.parent,
    tree: overlay.tree,
    patchSha256: overlay.patchSha256,
    paths: overlay.paths,
    composition: overlay.roleCompositions[productRole],
  };
}

export function verifyG17BenchmarkWorkspaceOwner(input) {
  const request = snapshotInput(input, "workspace owner verification input");
  exactKeys(
    request,
    ["bytes", "expected"],
    "workspace owner verification input",
  );
  const { bytes, expected: context } = request;
  const decoded = decodeCanonicalOwner(
    bytes,
    G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA,
    "workspace owner",
  );
  const owner = decoded.value;
  exactKeys(
    owner,
    [
      "schema",
      "controlRunId",
      "authorization",
      "buildId",
      "productRole",
      "product",
      "evaluator",
      "workspace",
      "contentHash",
    ],
    "workspace owner",
  );
  exactKeys(
    owner.workspace,
    [
      "generation",
      "targetGeneration",
      "effectiveTree",
      "isolated",
      "targetIsolated",
      "sourceReadOnlyAfterBuildStart",
    ],
    "workspace owner workspace",
  );
  const binding = authorizationBinding(owner.authorization);
  if (
    owner.controlRunId !== context.controlRunId ||
    owner.buildId !== context.buildId ||
    owner.productRole !== context.productRole ||
    !isDeepStrictEqual(binding, context.authorization) ||
    !isDeepStrictEqual(owner.product, context.product) ||
    !isDeepStrictEqual(owner.evaluator, context.evaluator) ||
    owner.workspace.effectiveTree !==
      context.evaluator.composition.effectiveTree ||
    owner.workspace.isolated !== true ||
    owner.workspace.targetIsolated !== true ||
    owner.workspace.sourceReadOnlyAfterBuildStart !== true
  ) {
    fail("workspace owner identity, product, evaluator, or isolation drifted");
  }
  safeId(owner.controlRunId, "workspace owner controlRunId");
  safeId(owner.buildId, "workspace owner buildId");
  safeId(owner.workspace.generation, "workspace generation");
  safeId(owner.workspace.targetGeneration, "target generation");
  gitOid(owner.workspace.effectiveTree, "workspace effectiveTree");
  return deepFreeze({
    schema: owner.schema,
    rawSha256: decoded.rawSha256,
    contentHash: owner.contentHash,
    controlRunId: owner.controlRunId,
    buildId: owner.buildId,
    productRole: owner.productRole,
    product: owner.product,
    evaluator: owner.evaluator,
    workspace: owner.workspace,
  });
}

function streamDescriptor(value, bytes, label, maximumBytes) {
  exactKeys(value, ["bytes", "sha256"], `${label} descriptor`);
  const raw = boundedBytes(bytes, maximumBytes, label);
  if (
    value.bytes !== raw.length ||
    value.sha256 !== sha256(raw) ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0
  ) {
    fail(`${label} descriptor does not bind the exact raw bytes`);
  }
  digest(value.sha256, `${label} sha256`);
  return raw;
}

function parseCargoBuildOutput(bytes, executablePath) {
  if (bytes.length === 0 || bytes.at(-1) !== 0x0a) {
    fail("raw Cargo build stdout must end in LF");
  }
  const rows = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    const rowBytes = index - start;
    if (rowBytes < 1 || rowBytes > MAX_CARGO_JSONL_ROW_BYTES) {
      fail("raw Cargo build stdout has an invalid JSONL row size");
    }
    rows.push([start, index]);
    if (rows.length > MAX_CARGO_JSONL_ROWS) {
      fail("raw Cargo build stdout exceeds the JSONL row ceiling");
    }
    start = index + 1;
  }
  if (start !== bytes.length || rows.length < 1) {
    fail("raw Cargo build stdout has an invalid JSONL inventory");
  }
  let aggregateNodes = 0;
  let aggregateStringBytes = 0;
  const messages = rows.map(([rowStart, rowEnd], index) => {
    try {
      const line = utf8(
        bytes.subarray(rowStart, rowEnd),
        `Cargo JSONL line ${index}`,
      );
      const budget = {
        nodes: 0,
        stringBytes: 0,
        files: 0,
        bufferBytes: 0,
        nodeLimit: MAX_CARGO_JSONL_ROW_NODES,
        stringLimit: MAX_CARGO_JSONL_ROW_STRING_BYTES,
      };
      const message = snapshotInput(
        JSON.parse(line),
        `Cargo JSONL line ${index}`,
        new WeakSet(),
        0,
        budget,
      );
      aggregateNodes += budget.nodes;
      aggregateStringBytes += budget.stringBytes;
      if (
        aggregateNodes > MAX_CARGO_JSONL_NODES ||
        aggregateStringBytes > MAX_CARGO_JSONL_STRING_BYTES
      ) {
        fail("raw Cargo build stdout exceeds the aggregate JSONL budget");
      }
      return message;
    } catch (error) {
      if (error.message.startsWith("G1.7 benchmark owner contract:"))
        throw error;
      fail(`Cargo JSONL line ${index} is invalid: ${error.message}`);
    }
  });
  const candidates = messages.filter(
    (message) =>
      message?.reason === "compiler-artifact" &&
      message.target?.name === "transactional_write" &&
      Array.isArray(message.target.kind) &&
      message.target.kind.includes("bench") &&
      message.profile?.test === true &&
      message.executable === executablePath,
  );
  if (candidates.length !== 1) {
    fail(
      "raw Cargo build output does not select exactly one benchmark executable",
    );
  }
  return rows.length;
}

export function verifyG17BenchmarkBuildOwner(input) {
  const request = snapshotInput(input, "build owner verification input");
  exactKeys(
    request,
    ["bytes", "expected", "stdoutBytes", "stderrBytes"],
    "build owner verification input",
  );
  const { bytes, expected: context, stdoutBytes, stderrBytes } = request;
  const decoded = decodeCanonicalOwner(
    bytes,
    G17_BENCHMARK_BUILD_OWNER_SCHEMA,
    "build owner",
  );
  const owner = decoded.value;
  exactKeys(
    owner,
    [
      "schema",
      "controlRunId",
      "authorization",
      "buildId",
      "productRole",
      "workspaceOwner",
      "command",
      "result",
      "executable",
      "contentHash",
    ],
    "build owner",
  );
  exactKeys(owner.command, ["argv", "environment", "ordinal"], "build command");
  exactKeys(
    owner.result,
    ["exitCode", "signal", "timedOut", "stdout", "stderr"],
    "build result",
  );
  exactKeys(owner.executable, ["logicalPath", "sha256"], "build executable");
  exactKeys(
    owner.workspaceOwner,
    ["rawSha256", "contentHash"],
    "build workspace owner binding",
  );
  const binding = authorizationBinding(owner.authorization);
  const expectedWorkspace = context.workspaceOwner;
  if (
    owner.controlRunId !== context.controlRunId ||
    owner.buildId !== context.buildId ||
    owner.productRole !== context.productRole ||
    !isDeepStrictEqual(binding, context.authorization) ||
    owner.workspaceOwner.rawSha256 !== expectedWorkspace.rawSha256 ||
    owner.workspaceOwner.contentHash !== expectedWorkspace.contentHash ||
    !isDeepStrictEqual(owner.command.argv, G17_BENCHMARK_LEGACY_BUILD_ARGV) ||
    !isDeepStrictEqual(
      owner.command.environment,
      G17_BENCHMARK_LEGACY_BUILD_ENVIRONMENT,
    ) ||
    owner.command.ordinal !== 1 ||
    owner.result.exitCode !== 0 ||
    owner.result.signal !== null ||
    owner.result.timedOut !== false
  ) {
    fail("build owner identity, command, workspace, or outcome drifted");
  }
  if (!EXECUTABLE_PATH.test(owner.executable.logicalPath ?? "")) {
    fail("build executable logical path drifted");
  }
  digest(owner.executable.sha256, "build executable sha256");
  const stdout = streamDescriptor(
    owner.result.stdout,
    stdoutBytes,
    "raw Cargo build stdout",
    MAX_BUILD_STREAM_BYTES,
  );
  const stderr = streamDescriptor(
    owner.result.stderr,
    stderrBytes,
    "raw Cargo build stderr",
    MAX_BUILD_STREAM_BYTES,
  );
  const cargoMessageCount = parseCargoBuildOutput(
    stdout,
    owner.executable.logicalPath,
  );
  return deepFreeze({
    schema: owner.schema,
    rawSha256: decoded.rawSha256,
    contentHash: owner.contentHash,
    controlRunId: owner.controlRunId,
    buildId: owner.buildId,
    productRole: owner.productRole,
    workspaceOwner: owner.workspaceOwner,
    command: owner.command,
    result: {
      ...owner.result,
      stdout: { ...owner.result.stdout },
      stderr: { ...owner.result.stderr },
    },
    executable: owner.executable,
    cargoMessageCount,
    rawBytes: stdout.length + stderr.length,
  });
}

function parseRawSample(bytes, expected) {
  const text = utf8(bytes, "raw benchmark stdout");
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail("raw benchmark stdout must be exactly one LF-terminated JSON object");
  }
  let value;
  try {
    value = snapshotInput(JSON.parse(text), "raw benchmark sample");
  } catch (error) {
    if (error.message.startsWith("G1.7 benchmark owner contract:")) throw error;
    fail(`raw benchmark stdout is invalid JSON: ${error.message}`);
  }
  exactKeys(
    value,
    [
      "schema",
      "caseId",
      "seed",
      "operations",
      "bytes",
      "elapsedNs",
      "readerObservations",
    ],
    "raw benchmark sample",
  );
  if (
    value.schema !== RAW_SAMPLE_SCHEMA ||
    value.caseId !== expected.task.id ||
    value.seed !== expected.coordinate.seed ||
    value.operations !== expected.task.operations * expected.task.writers
  ) {
    fail("raw benchmark sample identity or operation count drifted");
  }
  positiveInteger(value.elapsedNs, "raw sample elapsedNs");
  positiveInteger(value.operations, "raw sample operations");
  positiveInteger(value.bytes, "raw sample bytes");
  nonnegativeInteger(value.readerObservations, "raw sample readerObservations");
  if (expected.task.concurrentReaders !== value.readerObservations > 0) {
    fail("raw sample concurrent-reader observation drifted");
  }
  return value;
}

function reviewedLaunchExpectation(context) {
  exactKeys(
    context,
    [
      "controlRunId",
      "authorization",
      "controlId",
      "sequence",
      "buildId",
      "productRole",
      "arm",
      "task",
      "databasePath",
      "coordinate",
      "executable",
    ],
    "launch attestation expectation",
  );
  const control = G17_BENCHMARK_CONTROL_PLAN.find(
    ({ controlId }) => controlId === context.controlId,
  );
  if (control === undefined) {
    fail("launch expectation controlId is outside the reviewed plan");
  }
  const coordinates = g17BenchmarkControlCoordinates(control.controlName);
  if (
    !Number.isSafeInteger(context.sequence) ||
    context.sequence < 0 ||
    context.sequence >= coordinates.length
  ) {
    fail("launch expectation sequence is outside the reviewed plan");
  }
  const reviewed = coordinates[context.sequence];
  const claimedCoordinate = {
    controlId: context.controlId,
    sequence: context.sequence,
    buildId: context.buildId,
    productRole: context.productRole,
    arm: context.arm,
    task: context.task,
    databasePath: context.databasePath,
    coordinate: context.coordinate,
  };
  if (!isDeepStrictEqual(claimedCoordinate, reviewed)) {
    fail("launch expectation coordinate differs from the reviewed plan");
  }
  return { controlName: control.controlName, reviewed };
}

export function verifyG17BenchmarkLaunchAttestation(input) {
  const request = snapshotInput(input, "launch verification input");
  exactKeys(
    request,
    ["bytes", "expected", "stdoutBytes", "stderrBytes"],
    "launch verification input",
  );
  const { bytes, expected: context, stdoutBytes, stderrBytes } = request;
  const { controlName, reviewed } = reviewedLaunchExpectation(context);
  const expected = {
    controlRunId: context.controlRunId,
    authorization: context.authorization,
    executable: context.executable,
    ...reviewed,
  };
  const decoded = decodeCanonicalOwner(
    bytes,
    G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA,
    "launch attestation",
  );
  const owner = decoded.value;
  exactKeys(
    owner,
    [
      "schema",
      "controlRunId",
      "authorization",
      "controlId",
      "sequence",
      "buildId",
      "productRole",
      "arm",
      "coordinate",
      "executable",
      "command",
      "result",
      "contentHash",
    ],
    "launch attestation",
  );
  exactKeys(owner.command, ["argv"], "launch command");
  exactKeys(
    owner.result,
    ["exitCode", "signal", "timedOut", "stdout", "stderr"],
    "launch result",
  );
  exactKeys(owner.executable, ["logicalPath", "sha256"], "launch executable");
  const binding = authorizationBinding(owner.authorization);
  if (
    owner.controlRunId !== expected.controlRunId ||
    owner.controlId !== expected.controlId ||
    owner.sequence !== expected.sequence ||
    owner.buildId !== expected.buildId ||
    owner.productRole !== expected.productRole ||
    owner.arm !== expected.arm ||
    !isDeepStrictEqual(binding, expected.authorization) ||
    !isDeepStrictEqual(owner.coordinate, expected.coordinate) ||
    !isDeepStrictEqual(owner.executable, expected.executable) ||
    !isDeepStrictEqual(
      owner.command.argv,
      g17BenchmarkLaunchArgv(
        expected.executable.logicalPath,
        controlName,
        expected.sequence,
      ),
    ) ||
    owner.result.exitCode !== 0 ||
    owner.result.signal !== null ||
    owner.result.timedOut !== false
  ) {
    fail(
      "launch identity, coordinate, executable, command, or outcome drifted",
    );
  }
  const stdout = streamDescriptor(
    owner.result.stdout,
    stdoutBytes,
    "raw benchmark stdout",
    MAX_LAUNCH_STDOUT_BYTES,
  );
  const stderr = streamDescriptor(
    owner.result.stderr,
    stderrBytes,
    "raw benchmark stderr",
    MAX_LAUNCH_STDOUT_BYTES,
  );
  if (stderr.length !== 0)
    fail("successful benchmark launch stderr is not empty");
  const sample = parseRawSample(stdout, expected);
  const row = {
    schema: G17_CONTROL_STATISTICS_CONTRACT.sampleSet.rowSchema,
    controlId: expected.controlId,
    caseId: expected.coordinate.caseId,
    phase: expected.coordinate.phase,
    block: expected.coordinate.block,
    pair: expected.coordinate.pair,
    slot: expected.coordinate.slot,
    repetition: expected.coordinate.repetition,
    seed: expected.coordinate.seed,
    arm: expected.arm,
    productRole: expected.productRole,
    buildId: expected.buildId,
    elapsedNs: sample.elapsedNs,
    operations: sample.operations,
    bytes: sample.bytes,
    readerObservations: sample.readerObservations,
    executableSha256: expected.executable.sha256,
    rawSampleSha256: sha256(stdout),
  };
  return deepFreeze({
    schema: owner.schema,
    rawSha256: decoded.rawSha256,
    contentHash: owner.contentHash,
    controlRunId: owner.controlRunId,
    controlId: owner.controlId,
    sequence: owner.sequence,
    buildId: owner.buildId,
    productRole: owner.productRole,
    arm: owner.arm,
    executable: owner.executable,
    stdoutSha256: owner.result.stdout.sha256,
    stderrSha256: owner.result.stderr.sha256,
    rawBytes: stdout.length + stderr.length,
    row,
  });
}

function parseCanonicalSampleSet(bytesValue, controlName) {
  const bytes = boundedBytes(
    bytesValue,
    MAX_SAMPLE_SET_BYTES,
    `${controlName} sample set`,
    { allowEmpty: false },
  );
  const text = utf8(bytes, `${controlName} sample set`);
  let value;
  try {
    value = snapshotInput(JSON.parse(text), `${controlName} sample set`);
  } catch (error) {
    if (error.message.startsWith("G1.7 benchmark owner contract:")) throw error;
    fail(`${controlName} sample set is invalid JSON: ${error.message}`);
  }
  const canonical = g17ControlSampleSetBytes(value, controlName);
  if (!bytes.equals(canonical)) fail(`${controlName} sample-set bytes drifted`);
  return { bytes, value, rawSha256: sha256(bytes) };
}

export function verifyG17BenchmarkSessionOwner(input) {
  const request = snapshotInput(input, "session owner verification input");
  exactKeys(
    request,
    ["bytes", "expected", "sampleSetBytes"],
    "session owner verification input",
  );
  const { bytes, expected: context, sampleSetBytes } = request;
  const decoded = decodeCanonicalOwner(
    bytes,
    G17_BENCHMARK_SESSION_OWNER_SCHEMA,
    "session owner",
  );
  const owner = decoded.value;
  exactKeys(
    owner,
    [
      "schema",
      "controlRunId",
      "authorization",
      "controlId",
      "environment",
      "execution",
      "builds",
      "launches",
      "sampleSet",
      "contentHash",
    ],
    "session owner",
  );
  exactKeys(
    owner.execution,
    ["serialized", "adaptiveStopping", "outlierDeletion"],
    "session execution",
  );
  exactKeys(owner.builds, ["subject", "reference"], "session builds");
  exactKeys(owner.sampleSet, ["rawSha256", "rows"], "session sample set");
  const binding = authorizationBinding(owner.authorization);
  const parsedSampleSet = parseCanonicalSampleSet(
    sampleSetBytes,
    context.controlName,
  );
  const expectedLaunches = context.launches.map((launch) => ({
    sequence: launch.sequence,
    attestationRawSha256: launch.rawSha256,
    attestationContentHash: launch.contentHash,
    stdoutSha256: launch.stdoutSha256,
    stderrSha256: launch.stderrSha256,
  }));
  const expectedRows = context.launches.map(({ row }) => row);
  const expectedSampleSet = {
    schema: G17_CONTROL_SAMPLE_SET_SCHEMA,
    runId: context.controlRunId,
    suiteHash: G17_CONTROL_STATISTICS_CONTRACT.suite.taskHash,
    controlId: context.controlId,
    authorization: context.authorization,
    rows: expectedRows,
  };
  const expectedSampleBytes = g17ControlSampleSetBytes(
    expectedSampleSet,
    context.controlName,
  );
  if (
    owner.controlRunId !== context.controlRunId ||
    owner.controlId !== context.controlId ||
    !isDeepStrictEqual(binding, context.authorization) ||
    !isDeepStrictEqual(owner.environment, context.environment) ||
    !isDeepStrictEqual(owner.execution, {
      serialized: true,
      adaptiveStopping: false,
      outlierDeletion: false,
    }) ||
    !isDeepStrictEqual(owner.builds, context.builds) ||
    !isDeepStrictEqual(owner.launches, expectedLaunches) ||
    owner.sampleSet.rawSha256 !== parsedSampleSet.rawSha256 ||
    owner.sampleSet.rows !== expectedRows.length ||
    !parsedSampleSet.bytes.equals(expectedSampleBytes) ||
    !isDeepStrictEqual(parsedSampleSet.value, expectedSampleSet)
  ) {
    fail(
      "session owner environment, build, launch, or sample-set binding drifted",
    );
  }
  return deepFreeze({
    schema: owner.schema,
    rawSha256: decoded.rawSha256,
    contentHash: owner.contentHash,
    controlRunId: owner.controlRunId,
    controlId: owner.controlId,
    controlName: context.controlName,
    environment: owner.environment,
    builds: owner.builds,
    launchCount: owner.launches.length,
    launchAttestationSha256: owner.launches.map(
      ({ attestationRawSha256 }) => attestationRawSha256,
    ),
    sampleSetRawSha256: parsedSampleSet.rawSha256,
    sampleSet: parsedSampleSet.value,
    rawBytes:
      parsedSampleSet.bytes.length +
      context.launches.reduce((total, launch) => total + launch.rawBytes, 0),
  });
}

function exactArtifactRecord(value, expected, label) {
  exactKeys(value, expected, label);
  return value;
}

export function verifyG17BenchmarkOwnerBundle(input) {
  const request = snapshotInput(input, "benchmark owner verification input");
  exactKeys(
    request,
    [
      "authorization",
      "authorizationRawSha256",
      "controlRunId",
      "artifacts",
    ],
    "benchmark owner verification input",
  );
  const {
    authorization,
    authorizationRawSha256,
    controlRunId,
    artifacts,
  } = request;
  const runId = safeId(controlRunId, "controlRunId");
  const authorized = validateAuthorization({
    authorization,
    authorizationRawSha256,
  });
  const inventory = snapshotInput(artifacts, "benchmark owner artifacts");
  exactKeys(inventory, ["builds", "controls"], "benchmark owner artifacts");
  if (
    !Array.isArray(inventory.builds) ||
    inventory.builds.length !== G17_BENCHMARK_BUILD_PLAN.length ||
    !Array.isArray(inventory.controls) ||
    inventory.controls.length !== G17_BENCHMARK_CONTROL_PLAN.length
  ) {
    fail("benchmark owner build or control inventory cardinality drifted");
  }

  const workspaceGenerations = new Set();
  const targetGenerations = new Set();
  const buildOwnerDigests = new Set();
  const builds = inventory.builds.map((entry, index) => {
    exactArtifactRecord(
      entry,
      [
        "buildId",
        "productRole",
        "workspaceOwnerBytes",
        "buildOwnerBytes",
        "buildStdoutBytes",
        "buildStderrBytes",
      ],
      `build artifact ${index}`,
    );
    const plan = G17_BENCHMARK_BUILD_PLAN[index];
    if (
      entry.buildId !== plan.buildId ||
      entry.productRole !== plan.productRole
    ) {
      fail("benchmark owner build plan order or role drifted");
    }
    const workspaceOwner = verifyG17BenchmarkWorkspaceOwner({
      bytes: entry.workspaceOwnerBytes,
      expected: {
        controlRunId: runId,
        authorization: authorized.binding,
        buildId: plan.buildId,
        productRole: plan.productRole,
        product: authorized.authorization.protocol.products[plan.productRole],
        evaluator: expectedEvaluator(
          authorized.authorization,
          plan.productRole,
        ),
      },
    });
    if (
      workspaceGenerations.has(workspaceOwner.workspace.generation) ||
      targetGenerations.has(workspaceOwner.workspace.targetGeneration)
    ) {
      fail("benchmark builds reuse a workspace or target generation");
    }
    workspaceGenerations.add(workspaceOwner.workspace.generation);
    targetGenerations.add(workspaceOwner.workspace.targetGeneration);
    const buildOwner = verifyG17BenchmarkBuildOwner({
      bytes: entry.buildOwnerBytes,
      stdoutBytes: entry.buildStdoutBytes,
      stderrBytes: entry.buildStderrBytes,
      expected: {
        controlRunId: runId,
        authorization: authorized.binding,
        buildId: plan.buildId,
        productRole: plan.productRole,
        workspaceOwner,
      },
    });
    if (buildOwnerDigests.has(buildOwner.rawSha256)) {
      fail("benchmark builds reuse one build-owner identity");
    }
    buildOwnerDigests.add(buildOwner.rawSha256);
    return { workspaceOwner, buildOwner };
  });
  const buildById = new Map(
    builds.map((build) => [build.buildOwner.buildId, build]),
  );

  const controls = inventory.controls.map((entry, index) => {
    exactArtifactRecord(
      entry,
      ["controlName", "sessionOwnerBytes", "sampleSetBytes", "launches"],
      `control artifact ${index}`,
    );
    const plan = G17_BENCHMARK_CONTROL_PLAN[index];
    if (
      entry.controlName !== plan.controlName ||
      !Array.isArray(entry.launches)
    ) {
      fail("benchmark control plan order or launch inventory drifted");
    }
    const coordinates = g17BenchmarkControlCoordinates(plan.controlName);
    if (entry.launches.length !== coordinates.length) {
      fail(`${plan.controlName} launch cardinality drifted`);
    }
    const launches = entry.launches.map((launchEntry, launchIndex) => {
      exactArtifactRecord(
        launchEntry,
        ["attestationBytes", "stdoutBytes", "stderrBytes"],
        `${plan.controlName} launch artifact ${launchIndex}`,
      );
      const coordinate = coordinates[launchIndex];
      const build = buildById.get(coordinate.buildId)?.buildOwner;
      if (build === undefined) fail("launch references an unknown build owner");
      return verifyG17BenchmarkLaunchAttestation({
        bytes: launchEntry.attestationBytes,
        stdoutBytes: launchEntry.stdoutBytes,
        stderrBytes: launchEntry.stderrBytes,
        expected: {
          controlRunId: runId,
          authorization: authorized.binding,
          ...coordinate,
          executable: build.executable,
        },
      });
    });
    const buildsBinding = Object.fromEntries(
      ["subject", "reference"].map((arm) => {
        const build = buildById.get(plan[arm].buildId)?.buildOwner;
        if (build === undefined)
          fail(`${plan.controlName} lacks its ${arm} build`);
        return [
          arm,
          {
            buildId: build.buildId,
            buildOwnerRawSha256: build.rawSha256,
            buildOwnerContentHash: build.contentHash,
          },
        ];
      }),
    );
    return verifyG17BenchmarkSessionOwner({
      bytes: entry.sessionOwnerBytes,
      sampleSetBytes: entry.sampleSetBytes,
      expected: {
        controlRunId: runId,
        authorization: authorized.binding,
        controlName: plan.controlName,
        controlId: plan.controlId,
        environment: authorized.authorization.protocol.environment,
        builds: buildsBinding,
        launches,
      },
    });
  });

  const projection = {
    schema: G17_BENCHMARK_OWNER_BUNDLE_PROJECTION_SCHEMA,
    status: "REPLAYED",
    controlRunId: runId,
    authorization: {
      schema: authorized.authorization.schema,
      ...authorized.binding,
    },
    suiteHash: G17_CONTROL_STATISTICS_CONTRACT.suite.taskHash,
    builds: builds.map(({ workspaceOwner, buildOwner }) => ({
      buildId: buildOwner.buildId,
      productRole: buildOwner.productRole,
      workspaceOwnerRawSha256: workspaceOwner.rawSha256,
      workspaceOwnerContentHash: workspaceOwner.contentHash,
      buildOwnerRawSha256: buildOwner.rawSha256,
      buildOwnerContentHash: buildOwner.contentHash,
      executable: buildOwner.executable,
    })),
    controls: controls.map((session) => ({
      controlName: session.controlName,
      controlId: session.controlId,
      sessionOwnerRawSha256: session.rawSha256,
      sessionOwnerContentHash: session.contentHash,
      sampleSetRawSha256: session.sampleSetRawSha256,
      launchCount: session.launchCount,
    })),
    sampleSets: Object.fromEntries(
      controls.map((session) => [session.controlName, session.sampleSet]),
    ),
    replay: {
      buildCount: builds.length,
      controlCount: controls.length,
      launchCount: controls.reduce(
        (total, session) => total + session.launchCount,
        0,
      ),
      ownerArtifacts: builds.length * 2 + controls.length + 392,
      rawStreams: builds.length * 2 + 392 * 2 + controls.length,
      expandedLaunchRecordsRequireBoundedReceiptBatching: true,
    },
  };
  return deepFreeze(projection);
}
