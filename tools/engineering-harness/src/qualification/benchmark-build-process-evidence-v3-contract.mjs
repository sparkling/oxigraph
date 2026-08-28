import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY,
  G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA,
} from "./benchmark-execution-request-contract.mjs";
import { parseG17Elf64 } from "./native-elf.mjs";
import {
  G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_PROJECTION_SCHEMA,
} from "./non-tmpfs-containment-contract.mjs";

// This is deliberately a replay contract. It validates that a serialized
// artifact is internally consistent with the exact successful native process,
// cgroup, Cargo, and held-file observations supplied beside it. Bytes cannot
// prove who captured those observations or in what physical lifecycle they
// occurred. A later private, co-located owner must add that unforgeable origin.
// The `expected` dependency descriptors are outputs a caller already trusts;
// this module checks their exact authority-free projection states and binds
// their byte identities, but does not manufacture that external trust.

export const G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_V3_SCHEMA =
  "oxigraph.g1.7-benchmark-build-process-evidence/v3";
export const G17_BENCHMARK_BUILD_PROCESS_PROJECTION_V3_SCHEMA =
  "oxigraph.g1.7-benchmark-build-process-projection/v3";

export const G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS = deepFreeze({
  timeoutMs: 300_000,
  sharedOutputBytes: 64 * 1024 * 1024,
  terminationGraceMs: 250,
  reapDeadlineMs: 2_000,
  aggregateArgvUtf8Bytes: 1024 * 1024,
});

export const G17_BENCHMARK_BUILD_PROCESS_V3_AUTHORITY = deepFreeze({
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

export const G17_BENCHMARK_BUILD_PROCESS_V3_NONCLAIMS = deepFreeze({
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

const DIGEST = /^[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const PROCESS_GENERATION = /^g17-process-[0-9a-f]{64}$/u;
const TARGET_GENERATION = /^g17-target-[0-9a-f]{64}$/u;
const PRODUCT_ROLE = /^(?:negativeControl|performanceReference|noiseControl)$/u;
const EXECUTABLE_PATH =
  /^\/state\/target\/release\/deps\/transactional_write-[a-zA-Z0-9._-]+$/u;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_CGROUP_BYTES = 64 * 1024;
const MAX_EXECUTABLE_BYTES = 64 * 1024 * 1024;
const MAX_CARGO_LINES = 4_096;
const MAX_CARGO_LINE_BYTES = 1024 * 1024;
const MAX_CARGO_NODES = 100_000;
const MAX_CARGO_STRING_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 48;
const MAX_NODES = 16_384;
const MAX_ARRAY_LENGTH = 8_192;
const MAX_PROPERTIES = 8_193;
const MAX_STRING_BYTES = 8 * 1024 * 1024;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 4_096;
const MAX_POSIX_MODE = 0o177777;
const decoder = new TextDecoder("utf-8", { fatal: true });
const bufferPrototype = Buffer.prototype;
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;

function fail(message) {
  throw new Error(`G1.7 benchmark build process evidence v3: ${message}`);
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

function snapshotPlain(
  value,
  label,
  ancestors = new WeakSet(),
  depth = 0,
  budget = { nodes: 0, stringBytes: 0 },
) {
  if (value !== null && typeof value === "object" && types.isProxy(value)) {
    fail(`${label} contains a Proxy`);
  }
  if (depth > MAX_DEPTH) fail(`${label} exceeds the depth limit`);
  budget.nodes += 1;
  if (budget.nodes > (budget.nodeLimit ?? MAX_NODES)) {
    fail(`${label} exceeds the node limit`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.stringBytes += bytes;
    if (
      bytes > MAX_SINGLE_STRING_BYTES ||
      budget.stringBytes > (budget.stringLimit ?? MAX_STRING_BYTES)
    ) {
      fail(`${label} exceeds the string budget`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer
  ) {
    fail(`${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) fail(`${label} contains a cycle`);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== (array ? Array.prototype : Object.prototype) &&
    !(array === false && prototype === null)
  ) {
    fail(`${label} must contain only ordinary objects and arrays`);
  }
  ancestors.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_PROPERTIES)
      fail(`${label} exceeds the property limit`);
    if (keys.some((key) => typeof key !== "string")) {
      fail(`${label} contains symbol fields`);
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        "get" in descriptor ||
        "set" in descriptor
      ) {
        fail(`${label}.${key} must be an own data property`);
      }
      const bytes = Buffer.byteLength(key, "utf8");
      budget.stringBytes += bytes;
      if (
        bytes > MAX_SINGLE_STRING_BYTES ||
        budget.stringBytes > (budget.stringLimit ?? MAX_STRING_BYTES)
      ) {
        fail(`${label} exceeds the key budget`);
      }
    }
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_ARRAY_LENGTH
      ) {
        fail(`${label} array length is invalid`);
      }
      const expected = new Set([
        "length",
        ...Array.from({ length }, (_, index) => String(index)),
      ]);
      if (
        keys.length !== expected.size ||
        keys.some((key) => !expected.has(key))
      ) {
        fail(`${label} arrays must be dense and field-free`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotPlain(
          Object.getOwnPropertyDescriptor(value, String(index)).value,
          `${label}[${index}]`,
          ancestors,
          depth + 1,
          budget,
        ),
      );
    }
    const output = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable) fail(`${label}.${key} is not enumerable`);
      Object.defineProperty(output, key, {
        value: snapshotPlain(
          descriptor.value,
          `${label}.${key}`,
          ancestors,
          depth + 1,
          budget,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function exactOwnInput(value) {
  if (value === null || typeof value !== "object" || types.isProxy(value)) {
    fail("verification input must be a plain own-data record");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail("verification input must be a plain own-data record");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const expected = [
    "bytes",
    "expected",
    "stdoutBytes",
    "stderrBytes",
    "cgroupProcsBytes",
    "cgroupEventsBytes",
    "cgroupPidsCurrentBytes",
    "executableBytes",
  ];
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort()) ||
    keys.some(
      (key) =>
        !("value" in descriptors[key]) || descriptors[key].enumerable !== true,
    )
  ) {
    fail("verification input fields are not exact own data properties");
  }
  return {
    bytes: boundedBuffer(
      descriptors.bytes.value,
      MAX_EVIDENCE_BYTES,
      "evidence bytes",
      false,
    ),
    expected: snapshotPlain(
      descriptors.expected.value,
      "process evidence expectation",
    ),
    stdoutBytes: boundedBuffer(
      descriptors.stdoutBytes.value,
      G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS.sharedOutputBytes,
      "stdout bytes",
    ),
    stderrBytes: boundedBuffer(
      descriptors.stderrBytes.value,
      G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS.sharedOutputBytes,
      "stderr bytes",
    ),
    cgroupProcsBytes: boundedBuffer(
      descriptors.cgroupProcsBytes.value,
      MAX_CGROUP_BYTES,
      "cgroup.procs bytes",
    ),
    cgroupEventsBytes: boundedBuffer(
      descriptors.cgroupEventsBytes.value,
      MAX_CGROUP_BYTES,
      "cgroup.events bytes",
      false,
    ),
    cgroupPidsCurrentBytes: boundedBuffer(
      descriptors.cgroupPidsCurrentBytes.value,
      MAX_CGROUP_BYTES,
      "pids.current bytes",
      false,
    ),
    executableBytes: boundedBuffer(
      descriptors.executableBytes.value,
      MAX_EXECUTABLE_BYTES,
      "executable bytes",
      false,
    ),
  };
}

function boundedBuffer(value, maximum, label, allowEmpty = true) {
  if (
    !Buffer.isBuffer(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== bufferPrototype ||
    Object.getOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(`${label} must be an exact non-Proxy Buffer`);
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch (error) {
    fail(`${label} length cannot be read intrinsically: ${error.message}`);
  }
  if (
    !Number.isSafeInteger(length) ||
    length > maximum ||
    (!allowEmpty && length === 0)
  ) {
    fail(`${label} is outside its byte bound`);
  }
  try {
    const copied = bufferAllocUnsafe(length);
    typedArraySet.call(copied, value);
    return copied;
  } catch (error) {
    fail(`${label} cannot be copied intrinsically: ${error.message}`);
  }
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
  ) {
    fail(`${label} fields are not exact`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function safeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    fail(`${label} is not a safe identifier`);
  }
  return value;
}

function safeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum ||
    Object.is(value, -0)
  ) {
    fail(`${label} is not a bounded integer`);
  }
  return value;
}

function positiveInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  safeInteger(value, label, maximum);
  if (value === 0) fail(`${label} must be positive`);
  return value;
}

function decimal(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || value.length > 32 || !DECIMAL.test(value)) {
    fail(`${label} is not a bounded canonical decimal identity`);
  }
  if (positive && BigInt(value) < 1n) fail(`${label} must be positive`);
  return value;
}

function logicalPath(value, label) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES ||
    !posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value.includes("\0")
  ) {
    fail(`${label} is not a normalized absolute logical path`);
  }
  return value;
}

function text(value, label, maximum = MAX_PATH_BYTES) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > maximum
  ) {
    fail(`${label} is not a bounded non-empty string`);
  }
  return value;
}

function binding(value, label) {
  exactKeys(value, ["rawSha256", "contentHash"], label);
  return {
    rawSha256: digest(value.rawSha256, `${label} rawSha256`),
    contentHash: digest(value.contentHash, `${label} contentHash`),
  };
}

function executionRequestBinding(value, label) {
  exactKeys(value, ["schema", "rawSha256", "contentHash"], label);
  if (value.schema !== G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA) {
    fail(`${label} schema drifted`);
  }
  return {
    schema: value.schema,
    rawSha256: digest(value.rawSha256, `${label} rawSha256`),
    contentHash: digest(value.contentHash, `${label} contentHash`),
  };
}

function containmentBinding(value, label) {
  exactKeys(
    value,
    ["schema", "rawSha256", "contentHash", "ownerInputSha256"],
    label,
  );
  if (value.schema !== G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA) {
    fail(`${label} schema drifted`);
  }
  return {
    schema: value.schema,
    rawSha256: digest(value.rawSha256, `${label} rawSha256`),
    contentHash: digest(value.contentHash, `${label} contentHash`),
    ownerInputSha256: digest(
      value.ownerInputSha256,
      `${label} ownerInputSha256`,
    ),
  };
}

function expectedExecutionRequestProjection(value) {
  exactKeys(
    value,
    [
      "schema",
      "rawSha256",
      "contentHash",
      "controlRunId",
      "buildId",
      "productRole",
      "processGeneration",
      "ordinal",
      "targetGeneration",
      "launchCompatibilityStatus",
      "physicalLaunchEligible",
      "binding",
      "finalDecisionEligible",
    ],
    "expected execution request projection",
  );
  const identity = executionRequestBinding(
    {
      schema: value.schema,
      rawSha256: value.rawSha256,
      contentHash: value.contentHash,
    },
    "expected execution request identity",
  );
  safeId(value.controlRunId, "expected request controlRunId");
  safeId(value.buildId, "expected request buildId");
  if (!PRODUCT_ROLE.test(value.productRole ?? "")) {
    fail("expected request productRole is not reviewed");
  }
  if (!PROCESS_GENERATION.test(value.processGeneration ?? "")) {
    fail("expected request process generation is not exact");
  }
  positiveInteger(value.ordinal, "expected request process ordinal", 4);
  if (!TARGET_GENERATION.test(value.targetGeneration ?? "")) {
    fail("expected request target generation is not exact");
  }
  if (
    value.launchCompatibilityStatus !==
      G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY.status ||
    value.physicalLaunchEligible !== false ||
    value.binding !== null ||
    value.finalDecisionEligible !== false
  ) {
    fail(
      "expected execution request projection overclaims current launch compatibility",
    );
  }
  return { ...value, identity };
}

function expectedContainmentProjection(value) {
  exactKeys(
    value,
    [
      "schema",
      "evidenceSchema",
      "rawSha256",
      "contentHash",
      "ownerInputSha256",
      "runId",
      "workerGeneration",
      "status",
      "binding",
      "finalDecisionEligible",
    ],
    "expected containment projection",
  );
  if (
    value.schema !== G17_NON_TMPFS_CONTAINMENT_PROJECTION_SCHEMA ||
    value.status !== "CONTAINMENT_EVIDENCE_REPLAYED" ||
    value.binding !== null ||
    value.finalDecisionEligible !== false
  ) {
    fail(
      "expected containment projection is not the exact authority-free replay",
    );
  }
  safeId(value.runId, "expected containment runId");
  if (!PROCESS_GENERATION.test(value.workerGeneration ?? "")) {
    fail("expected containment worker generation is not exact");
  }
  const identity = containmentBinding(
    {
      schema: value.evidenceSchema,
      rawSha256: value.rawSha256,
      contentHash: value.contentHash,
      ownerInputSha256: value.ownerInputSha256,
    },
    "expected containment evidence identity",
  );
  return { ...value, identity };
}

function decodeCanonical(bytes) {
  let value;
  let decoded;
  try {
    decoded = decoder.decode(bytes);
  } catch (error) {
    fail(`evidence is not UTF-8: ${error.message}`);
  }
  if (!decoded.endsWith("\n") || decoded.slice(0, -1).includes("\n")) {
    fail("evidence must be one LF-terminated canonical JSON value");
  }
  try {
    value = JSON.parse(decoded);
  } catch (error) {
    fail(`evidence is invalid JSON: ${error.message}`);
  }
  value = snapshotPlain(value, "process evidence document");
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail("evidence is not canonical JSON");
  }
  return { value, rawSha256: sha256(bytes) };
}

function validateExpected(value) {
  exactKeys(
    value,
    [
      "evidence",
      "executionRequest",
      "containment",
      "controlRunId",
      "buildId",
      "productRole",
      "processGeneration",
      "ordinal",
      "targetGeneration",
      "targetRoot",
      "cargoArtifact",
      "executableLogicalPath",
    ],
    "process evidence expectation",
  );
  const evidence = binding(value.evidence, "expected evidence");
  const executionRequest = expectedExecutionRequestProjection(
    value.executionRequest,
  );
  const containment = expectedContainmentProjection(value.containment);
  if (
    containment.identity.ownerInputSha256 !==
    executionRequest.identity.rawSha256
  ) {
    fail(
      "expected containment does not consume the exact execution request bytes",
    );
  }
  safeId(value.controlRunId, "expected controlRunId");
  safeId(value.buildId, "expected buildId");
  if (!PRODUCT_ROLE.test(value.productRole ?? "")) {
    fail("expected productRole is not reviewed");
  }
  if (!PROCESS_GENERATION.test(value.processGeneration ?? "")) {
    fail("expected process generation is not exact");
  }
  positiveInteger(value.ordinal, "expected process ordinal", 4);
  if (!TARGET_GENERATION.test(value.targetGeneration ?? "")) {
    fail("expected target generation is not exact");
  }
  if (
    executionRequest.controlRunId !== value.controlRunId ||
    executionRequest.buildId !== value.buildId ||
    executionRequest.productRole !== value.productRole ||
    executionRequest.processGeneration !== value.processGeneration ||
    executionRequest.ordinal !== value.ordinal ||
    executionRequest.targetGeneration !== value.targetGeneration ||
    containment.runId !== value.controlRunId ||
    containment.workerGeneration !== value.processGeneration
  ) {
    fail("trusted dependency projections do not match the process identity");
  }
  const targetRoot = directoryProjection(
    value.targetRoot,
    "expected target root",
  );
  exactKeys(
    value.cargoArtifact,
    ["packageId", "manifestPath", "sourcePath"],
    "expected Cargo artifact",
  );
  const cargoArtifact = {
    packageId: text(value.cargoArtifact.packageId, "expected Cargo package id"),
    manifestPath: logicalPath(
      value.cargoArtifact.manifestPath,
      "expected Cargo manifest path",
    ),
    sourcePath: logicalPath(
      value.cargoArtifact.sourcePath,
      "expected Cargo target source path",
    ),
  };
  if (
    !cargoArtifact.manifestPath.startsWith("/workspace/source/") ||
    !cargoArtifact.sourcePath.startsWith("/workspace/source/")
  ) {
    fail("expected Cargo artifact is outside the held source projection");
  }
  logicalPath(value.executableLogicalPath, "expected executable path");
  if (!EXECUTABLE_PATH.test(value.executableLogicalPath)) {
    fail("expected executable is outside the frozen target output path");
  }
  return {
    ...value,
    evidence,
    executionRequest,
    containment,
    targetRoot,
    cargoArtifact,
  };
}

function directoryProjection(value, label) {
  exactKeys(value, ["device", "inode", "uid", "gid", "filesystemType"], label);
  decimal(value.device, `${label} device`, { positive: true });
  decimal(value.inode, `${label} inode`, { positive: true });
  decimal(value.uid, `${label} uid`);
  decimal(value.gid, `${label} gid`);
  decimal(value.filesystemType, `${label} filesystemType`, { positive: true });
  return value;
}

function fileIdentity(value, label, kind) {
  exactKeys(
    value,
    ["device", "inode", "uid", "gid", "mode", "nlink", "size"],
    label,
  );
  decimal(value.device, `${label} device`, { positive: true });
  decimal(value.inode, `${label} inode`, { positive: true });
  decimal(value.uid, `${label} uid`);
  decimal(value.gid, `${label} gid`);
  positiveInteger(value.mode, `${label} mode`, MAX_POSIX_MODE);
  positiveInteger(value.nlink, `${label} nlink`);
  safeInteger(value.size, `${label} size`, MAX_EXECUTABLE_BYTES);
  const type = value.mode & 0o170000;
  if (
    (kind === "directory" && type !== 0o040000) ||
    (kind === "file" && type !== 0o100000)
  ) {
    fail(`${label} is not a ${kind}`);
  }
  if (kind === "file" && (value.mode & 0o111) === 0) {
    fail(`${label} is not executable`);
  }
  return value;
}

function heldTargetRoot(value, expected) {
  exactKeys(
    value,
    [
      "logicalPath",
      "heldFd",
      "inheritedFd",
      "before",
      "after",
      "filesystemType",
    ],
    "held target root",
  );
  const before = fileIdentity(
    value.before,
    "held target root before",
    "directory",
  );
  const after = fileIdentity(
    value.after,
    "held target root after",
    "directory",
  );
  decimal(value.filesystemType, "held target root filesystemType", {
    positive: true,
  });
  const observed = {
    device: before.device,
    inode: before.inode,
    uid: before.uid,
    gid: before.gid,
    filesystemType: value.filesystemType,
  };
  if (
    value.logicalPath !== "/state/target" ||
    value.heldFd !== true ||
    value.inheritedFd !== 5 ||
    !isDeepStrictEqual(before, after) ||
    !isDeepStrictEqual(observed, expected)
  ) {
    fail("held target root does not bind the expected target generation");
  }
  return value;
}

function heldTargetAncestors(value, root) {
  const expected = [
    { logicalPath: "/state/target/release", leafName: "release" },
    { logicalPath: "/state/target/release/deps", leafName: "deps" },
  ];
  if (!Array.isArray(value) || value.length !== expected.length) {
    fail("held executable ancestor inventory is not exact");
  }
  let parent = root;
  const identities = new Set([`${root.before.device}:${root.before.inode}`]);
  for (const [index, row] of value.entries()) {
    const label = `held executable ancestor ${index}`;
    exactKeys(
      row,
      [
        "logicalPath",
        "leafName",
        "heldFd",
        "parentDevice",
        "parentInode",
        "before",
        "after",
        "filesystemType",
      ],
      label,
    );
    const before = fileIdentity(row.before, `${label} before`, "directory");
    const after = fileIdentity(row.after, `${label} after`, "directory");
    decimal(row.parentDevice, `${label} parentDevice`, { positive: true });
    decimal(row.parentInode, `${label} parentInode`, { positive: true });
    decimal(row.filesystemType, `${label} filesystemType`, { positive: true });
    const identity = `${before.device}:${before.inode}`;
    if (
      row.logicalPath !== expected[index].logicalPath ||
      row.leafName !== expected[index].leafName ||
      row.heldFd !== true ||
      row.parentDevice !== parent.before.device ||
      row.parentInode !== parent.before.inode ||
      before.device !== root.before.device ||
      before.uid !== root.before.uid ||
      before.gid !== root.before.gid ||
      row.filesystemType !== root.filesystemType ||
      !isDeepStrictEqual(before, after) ||
      identities.has(identity)
    ) {
      fail(`${label} does not bind the held target ancestry`);
    }
    identities.add(identity);
    parent = row;
  }
  return { parent, identities };
}

function heldExecutable(value, bytes, expectedPath, parent, identities) {
  exactKeys(
    value,
    [
      "logicalPath",
      "leafName",
      "heldFd",
      "parentDevice",
      "parentInode",
      "before",
      "after",
      "bytes",
      "sha256",
      "elfSha256",
    ],
    "held executable",
  );
  const before = fileIdentity(value.before, "held executable before", "file");
  const after = fileIdentity(value.after, "held executable after", "file");
  logicalPath(value.logicalPath, "held executable logicalPath");
  text(value.leafName, "held executable leafName", 255);
  decimal(value.parentDevice, "held executable parentDevice", {
    positive: true,
  });
  decimal(value.parentInode, "held executable parentInode", {
    positive: true,
  });
  positiveInteger(value.bytes, "held executable bytes", MAX_EXECUTABLE_BYTES);
  digest(value.sha256, "held executable sha256");
  digest(value.elfSha256, "held executable ELF sha256");
  const identity = `${before.device}:${before.inode}`;
  const elf = parseG17Elf64(bytes);
  let elfType = null;
  let elfVersion = null;
  let elfHeaderBytes = null;
  let loadSegments = 0;
  let executableEntrySegments = 0;
  if (elf !== null) {
    elfType = bytes.readUInt16LE(16);
    elfVersion = bytes.readUInt32LE(20);
    const entry = bytes.readBigUInt64LE(24);
    const programHeaderOffset = Number(bytes.readBigUInt64LE(32));
    elfHeaderBytes = bytes.readUInt16LE(52);
    const programHeaderEntryBytes = bytes.readUInt16LE(54);
    const programHeaderCount = bytes.readUInt16LE(56);
    for (let index = 0; index < programHeaderCount; index += 1) {
      const offset = programHeaderOffset + index * programHeaderEntryBytes;
      if (bytes.readUInt32LE(offset) === 1) {
        loadSegments += 1;
        const flags = bytes.readUInt32LE(offset + 4);
        const virtualAddress = bytes.readBigUInt64LE(offset + 16);
        const memoryBytes = bytes.readBigUInt64LE(offset + 40);
        if (
          (flags & 1) === 1 &&
          entry >= virtualAddress &&
          entry < virtualAddress + memoryBytes
        ) {
          executableEntrySegments += 1;
        }
      }
    }
  }
  if (
    value.logicalPath !== expectedPath ||
    value.leafName !== posix.basename(expectedPath) ||
    value.heldFd !== true ||
    value.parentDevice !== parent.before.device ||
    value.parentInode !== parent.before.inode ||
    before.device !== parent.before.device ||
    before.uid !== parent.before.uid ||
    before.gid !== parent.before.gid ||
    before.nlink !== 1 ||
    !isDeepStrictEqual(before, after) ||
    before.size !== bytes.length ||
    value.bytes !== bytes.length ||
    value.sha256 !== sha256(bytes) ||
    elf === null ||
    (elfType !== 2 && elfType !== 3) ||
    elfVersion !== 1 ||
    elfHeaderBytes !== 64 ||
    loadSegments < 1 ||
    executableEntrySegments !== 1 ||
    value.elfSha256 !== canonicalSha256(elf) ||
    identities.has(identity)
  ) {
    fail("held executable is not one stable target-bound x86-64 ELF");
  }
  return { value, elf };
}

function stream(record, bytes, label) {
  exactKeys(record, ["bytes", "sha256"], label);
  safeInteger(
    record.bytes,
    `${label} bytes`,
    G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS.sharedOutputBytes,
  );
  digest(record.sha256, `${label} sha256`);
  if (record.bytes !== bytes.length || record.sha256 !== sha256(bytes)) {
    fail(`${label} does not bind its exact raw Buffer`);
  }
  return record;
}

function validateProcess(value, expected) {
  exactKeys(
    value,
    [
      "generation",
      "ordinal",
      "limits",
      "disposition",
      "firstTerminalReason",
      "syntheticTestOnly",
      "spawned",
      "noChild",
      "exitObserved",
      "exitCode",
      "signal",
      "closeObserved",
      "closeCode",
      "closeSignal",
      "stdoutEof",
      "stderrEof",
      "statusAgreement",
      "reaped",
      "directChildCleanupSafe",
      "captureComplete",
      "outputTruncated",
      "durationMs",
      "terminationErrors",
      "processErrors",
    ],
    "native process observation",
  );
  exactKeys(
    value.limits,
    Object.keys(G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS),
    "native process limits",
  );
  if (!PROCESS_GENERATION.test(value.generation ?? "")) {
    fail("native process generation is not exact");
  }
  positiveInteger(value.ordinal, "native process ordinal", 4);
  safeInteger(
    value.durationMs,
    "native process durationMs",
    G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS.timeoutMs +
      G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS.terminationGraceMs +
      G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS.reapDeadlineMs,
  );
  if (
    value.generation !== expected.processGeneration ||
    value.ordinal !== expected.ordinal ||
    !isDeepStrictEqual(value.limits, G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS) ||
    value.disposition !== "completed" ||
    value.firstTerminalReason !== "completed" ||
    value.syntheticTestOnly !== false ||
    value.spawned !== true ||
    value.noChild !== false ||
    value.exitObserved !== true ||
    value.exitCode !== 0 ||
    value.signal !== null ||
    value.closeObserved !== true ||
    value.closeCode !== 0 ||
    value.closeSignal !== null ||
    value.stdoutEof !== true ||
    value.stderrEof !== true ||
    value.statusAgreement !== true ||
    value.reaped !== true ||
    value.directChildCleanupSafe !== true ||
    value.captureComplete !== true ||
    value.outputTruncated !== false ||
    !Array.isArray(value.terminationErrors) ||
    value.terminationErrors.length !== 0 ||
    !Array.isArray(value.processErrors) ||
    value.processErrors.length !== 0
  ) {
    fail(
      "native process observation is not one exact successful complete capture",
    );
  }
  return value;
}

function rejectDuplicateJsonMembers(source, label) {
  let index = 0;
  let nodes = 0;

  const failJson = (reason) => fail(`${label} ${reason}`);
  const whitespace = () => {
    while (
      source[index] === " " ||
      source[index] === "\t" ||
      source[index] === "\r" ||
      source[index] === "\n"
    ) {
      index += 1;
    }
  };
  const stringToken = () => {
    if (source[index] !== '"') failJson("has a non-string object member");
    const start = index;
    index += 1;
    while (index < source.length) {
      const character = source[index];
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(source.slice(start, index));
        } catch (error) {
          failJson(`has an invalid string token: ${error.message}`);
        }
      }
      if (character === "\\") {
        index += 1;
        const escape = source[index];
        if (escape === "u") {
          const digits = source.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(digits)) {
            failJson("has an invalid Unicode escape");
          }
          index += 5;
          continue;
        }
        if (!['"', "\\", "/", "b", "f", "n", "r", "t"].includes(escape)) {
          failJson("has an invalid string escape");
        }
        index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        failJson("has an unescaped control character");
      }
      index += 1;
    }
    failJson("has an unterminated string");
  };

  const value = (depth) => {
    if (depth > MAX_DEPTH) failJson("exceeds the JSON depth limit");
    nodes += 1;
    if (nodes > MAX_NODES) failJson("exceeds the JSON node limit");
    whitespace();
    if (source[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      while (index < source.length) {
        const key = stringToken();
        if (keys.has(key)) {
          failJson(`duplicates object member ${JSON.stringify(key)}`);
        }
        keys.add(key);
        if (keys.size > MAX_PROPERTIES) {
          failJson("exceeds the object-member limit");
        }
        whitespace();
        if (source[index] !== ":") failJson("has an object member without ':'");
        index += 1;
        value(depth + 1);
        whitespace();
        if (source[index] === "}") {
          index += 1;
          return;
        }
        if (source[index] !== ",") failJson("has an unterminated object");
        index += 1;
        whitespace();
      }
      failJson("has an unterminated object");
    }
    if (source[index] === "[") {
      index += 1;
      whitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      let length = 0;
      while (index < source.length) {
        length += 1;
        if (length > MAX_ARRAY_LENGTH) failJson("exceeds the array limit");
        value(depth + 1);
        whitespace();
        if (source[index] === "]") {
          index += 1;
          return;
        }
        if (source[index] !== ",") failJson("has an unterminated array");
        index += 1;
      }
      failJson("has an unterminated array");
    }
    if (source[index] === '"') {
      stringToken();
      return;
    }
    const start = index;
    while (
      index < source.length &&
      ![",", "]", "}", " ", "\t", "\r", "\n"].includes(source[index])
    ) {
      index += 1;
    }
    if (index === start) failJson("has an invalid JSON value");
    try {
      const primitive = JSON.parse(source.slice(start, index));
      if (primitive !== null && typeof primitive === "object") {
        failJson("has an invalid primitive value");
      }
    } catch (error) {
      failJson(`has an invalid primitive value: ${error.message}`);
    }
  };

  value(0);
  whitespace();
  if (index !== source.length) failJson("has trailing JSON data");
}

function decodeCargoJsonl(bytes, expected) {
  let decoded;
  try {
    decoded = decoder.decode(bytes);
  } catch (error) {
    fail(`Cargo stdout is not UTF-8: ${error.message}`);
  }
  if (
    !decoded.endsWith("\n") ||
    decoded.includes("\r") ||
    decoded.includes("\0")
  ) {
    fail("Cargo stdout is not strict LF-terminated JSONL");
  }
  const lines = decoded.slice(0, -1).split("\n");
  if (
    lines.length < 2 ||
    lines.length > MAX_CARGO_LINES ||
    lines.some(
      (line) =>
        line.length === 0 ||
        Buffer.byteLength(line, "utf8") > MAX_CARGO_LINE_BYTES,
    )
  ) {
    fail("Cargo JSONL line inventory is outside its fixed bounds");
  }
  const cargoBudget = {
    nodes: 0,
    stringBytes: 0,
    nodeLimit: MAX_CARGO_NODES,
    stringLimit: MAX_CARGO_STRING_BYTES,
  };
  const records = lines.map((line, index) => {
    rejectDuplicateJsonMembers(line, `Cargo JSONL line ${index + 1}`);
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(`Cargo JSONL line ${index + 1} is invalid JSON: ${error.message}`);
    }
    if (
      record === null ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      typeof record.reason !== "string"
    ) {
      fail(`Cargo JSONL line ${index + 1} is not a reasoned object`);
    }
    return snapshotPlain(
      record,
      `Cargo JSONL line ${index + 1}`,
      new WeakSet(),
      0,
      cargoBudget,
    );
  });
  const matching = [];
  for (const [index, record] of records.entries()) {
    if (record.reason !== "compiler-artifact") continue;
    if (
      record.package_id === expected.cargoArtifact.packageId &&
      record.manifest_path === expected.cargoArtifact.manifestPath &&
      record.target?.name === "transactional_write"
    ) {
      matching.push({ index, record });
    }
  }
  if (matching.length !== 1) {
    fail("Cargo JSONL does not contain exactly one matching compiler-artifact");
  }
  const selectedPathClaims = records
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        record.reason === "compiler-artifact" &&
        (record.executable === expected.executableLogicalPath ||
          (Array.isArray(record.filenames) &&
            record.filenames.includes(expected.executableLogicalPath))),
    );
  if (
    selectedPathClaims.length !== 1 ||
    selectedPathClaims[0].index !== matching[0].index
  ) {
    fail("Cargo JSONL target executable attribution is ambiguous");
  }
  const artifact = matching[0].record;
  if (
    !isDeepStrictEqual(artifact.target.kind, ["bench"]) ||
    !isDeepStrictEqual(artifact.target.crate_types, ["bin"]) ||
    artifact.target.src_path !== expected.cargoArtifact.sourcePath ||
    artifact.target.test !== true ||
    artifact.profile?.test !== true ||
    artifact.fresh !== false ||
    !Array.isArray(artifact.filenames) ||
    artifact.filenames.length !== 1 ||
    artifact.filenames[0] !== expected.executableLogicalPath ||
    artifact.executable !== expected.executableLogicalPath
  ) {
    fail(
      "matching Cargo compiler-artifact does not identify the exact benchmark ELF",
    );
  }
  const finished = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.reason === "build-finished");
  if (
    finished.length !== 1 ||
    finished[0].index !== records.length - 1 ||
    finished[0].record.success !== true ||
    !isDeepStrictEqual(Object.keys(finished[0].record).sort(), [
      "reason",
      "success",
    ])
  ) {
    fail(
      "Cargo JSONL does not end with exactly one build-finished success:true",
    );
  }
  return {
    lineCount: records.length,
    matchingCompilerArtifactLine: matching[0].index + 1,
    finalBuildFinishedLine: finished[0].index + 1,
  };
}

function rawRecord(value, bytes, label) {
  exactKeys(value, ["bytes", "sha256"], label);
  safeInteger(value.bytes, `${label} bytes`, MAX_CGROUP_BYTES);
  digest(value.sha256, `${label} sha256`);
  if (value.bytes !== bytes.length || value.sha256 !== sha256(bytes)) {
    fail(`${label} does not bind its raw bytes`);
  }
}

function validateCgroup(value, procsBytes, eventsBytes, pidsCurrentBytes) {
  exactKeys(
    value,
    [
      "version",
      "processCount",
      "populated",
      "pidsCurrent",
      "procs",
      "events",
      "pidsCurrentRaw",
    ],
    "cgroup quiescence observation",
  );
  rawRecord(value.procs, procsBytes, "cgroup.procs observation");
  rawRecord(value.events, eventsBytes, "cgroup.events observation");
  rawRecord(value.pidsCurrentRaw, pidsCurrentBytes, "pids.current observation");
  if (
    value.version !== 2 ||
    value.processCount !== 0 ||
    value.populated !== false ||
    value.pidsCurrent !== 0 ||
    procsBytes.length !== 0
  ) {
    fail("cgroup is not exactly quiescent");
  }
  let decoded;
  try {
    decoded = decoder.decode(eventsBytes);
  } catch (error) {
    fail(`cgroup.events is not UTF-8: ${error.message}`);
  }
  if (
    !decoded.endsWith("\n") ||
    decoded.includes("\r") ||
    decoded.includes("\0")
  ) {
    fail("cgroup.events is not strict LF-terminated text");
  }
  const rows = decoded.slice(0, -1).split("\n");
  const parsed = new Map();
  for (const [index, row] of rows.entries()) {
    const match = /^([a-z][a-z0-9_]*) (0|[1-9][0-9]*)$/u.exec(row);
    if (match === null || parsed.has(match[1])) {
      fail(`cgroup.events row ${index + 1} is invalid or duplicated`);
    }
    parsed.set(match[1], match[2]);
  }
  if (parsed.get("populated") !== "0") {
    fail("cgroup.events does not report populated 0");
  }
  let pidsCurrent;
  try {
    pidsCurrent = decoder.decode(pidsCurrentBytes);
  } catch (error) {
    fail(`pids.current is not UTF-8: ${error.message}`);
  }
  if (pidsCurrent !== "0\n") {
    fail("pids.current does not report exact zero");
  }
  return value;
}

function validateCompletion(value, procsBytes, eventsBytes, pidsCurrentBytes) {
  exactKeys(value, ["sequence", "cgroup"], "post-process completion evidence");
  const expectedSequence = [
    { ordinal: 1, observation: "direct-child-reaped" },
    { ordinal: 2, observation: "cgroup-quiescent" },
    { ordinal: 3, observation: "target-elf-held" },
  ];
  if (!isDeepStrictEqual(value.sequence, expectedSequence)) {
    fail("required serialized lifecycle sequence labels drifted");
  }
  return validateCgroup(
    value.cgroup,
    procsBytes,
    eventsBytes,
    pidsCurrentBytes,
  );
}

function rawStreams(stdoutBytes, stderrBytes) {
  const stdout = Buffer.from(stdoutBytes);
  const stderr = Buffer.from(stderrBytes);
  return Object.freeze({
    get stdout() {
      return Buffer.from(stdout);
    },
    get stderr() {
      return Buffer.from(stderr);
    },
  });
}

export function verifyG17BenchmarkBuildProcessEvidenceV3(input) {
  try {
    const captured = exactOwnInput(input);
    const expected = validateExpected(captured.expected);
    const decoded = decodeCanonical(captured.bytes);
    const value = decoded.value;
    exactKeys(
      value,
      [
        "schema",
        "bindings",
        "identity",
        "process",
        "streams",
        "cargo",
        "completion",
        "target",
        "nonclaims",
        "authority",
        "binding",
        "finalDecisionEligible",
        "contentHash",
      ],
      "process evidence v3",
    );
    if (value.schema !== G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_V3_SCHEMA) {
      fail("schema drifted");
    }
    digest(value.contentHash, "evidence contentHash");
    const { contentHash, ...unsigned } = value;
    if (contentHash !== canonicalSha256(unsigned)) {
      fail("evidence contentHash does not verify");
    }
    if (
      decoded.rawSha256 !== expected.evidence.rawSha256 ||
      contentHash !== expected.evidence.contentHash
    ) {
      fail("evidence differs from its separately trusted identity");
    }

    exactKeys(
      value.bindings,
      ["executionRequest", "containment"],
      "evidence bindings",
    );
    const request = executionRequestBinding(
      value.bindings.executionRequest,
      "execution request binding",
    );
    const containment = containmentBinding(
      value.bindings.containment,
      "containment binding",
    );
    if (
      !isDeepStrictEqual(request, expected.executionRequest.identity) ||
      !isDeepStrictEqual(containment, expected.containment.identity) ||
      containment.ownerInputSha256 !== request.rawSha256
    ) {
      fail("execution request or containment hash DAG drifted");
    }

    exactKeys(
      value.identity,
      [
        "controlRunId",
        "buildId",
        "productRole",
        "processGeneration",
        "ordinal",
        "targetGeneration",
      ],
      "process identity",
    );
    if (
      !isDeepStrictEqual(value.identity, {
        controlRunId: expected.controlRunId,
        buildId: expected.buildId,
        productRole: expected.productRole,
        processGeneration: expected.processGeneration,
        ordinal: expected.ordinal,
        targetGeneration: expected.targetGeneration,
      })
    ) {
      fail("process identity drifted");
    }

    const process = validateProcess(value.process, expected);
    exactKeys(value.streams, ["stdout", "stderr"], "raw stream bindings");
    stream(value.streams.stdout, captured.stdoutBytes, "stdout stream");
    stream(value.streams.stderr, captured.stderrBytes, "stderr stream");
    if (
      captured.stdoutBytes.length + captured.stderrBytes.length >
      G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS.sharedOutputBytes
    ) {
      fail("stdout and stderr exceed the shared 64 MiB capture ceiling");
    }

    const cargo = decodeCargoJsonl(captured.stdoutBytes, expected);
    exactKeys(
      value.cargo,
      ["lineCount", "matchingCompilerArtifactLine", "finalBuildFinishedLine"],
      "Cargo JSONL summary",
    );
    if (!isDeepStrictEqual(value.cargo, cargo)) {
      fail("Cargo JSONL summary differs from the raw stdout Buffer");
    }

    // This validation deliberately precedes executable parsing. The serialized
    // prerequisite rows must describe direct-child reap and an empty cgroup
    // before this replay contract will consider the held target ELF. Their
    // temporal provenance remains an explicit nonclaim.
    const cgroup = validateCompletion(
      value.completion,
      captured.cgroupProcsBytes,
      captured.cgroupEventsBytes,
      captured.cgroupPidsCurrentBytes,
    );
    if (
      !process.reaped ||
      cgroup.processCount !== 0 ||
      cgroup.populated !== false
    ) {
      fail(
        "serialized target ELF prerequisites do not encode complete quiescence",
      );
    }

    exactKeys(
      value.target,
      ["generation", "root", "ancestors", "executable"],
      "target evidence",
    );
    if (value.target.generation !== expected.targetGeneration) {
      fail("target evidence generation drifted");
    }
    const root = heldTargetRoot(value.target.root, expected.targetRoot);
    const ancestry = heldTargetAncestors(value.target.ancestors, root);
    const executable = heldExecutable(
      value.target.executable,
      captured.executableBytes,
      expected.executableLogicalPath,
      ancestry.parent,
      ancestry.identities,
    );

    if (
      !isDeepStrictEqual(
        value.nonclaims,
        G17_BENCHMARK_BUILD_PROCESS_V3_NONCLAIMS,
      ) ||
      !isDeepStrictEqual(
        value.authority,
        G17_BENCHMARK_BUILD_PROCESS_V3_AUTHORITY,
      ) ||
      value.binding !== false ||
      value.finalDecisionEligible !== false
    ) {
      fail(
        "serialized replay overclaims origin, binding, eligibility, or authority",
      );
    }

    return deepFreeze({
      schema: G17_BENCHMARK_BUILD_PROCESS_PROJECTION_V3_SCHEMA,
      status: "SUCCESSOR_PRIVATE_ISSUER_REQUIRED",
      replayStatus: "PROCESS_EVIDENCE_V3_REPLAYED",
      physicalOriginProven: false,
      binding: false,
      finalDecisionEligible: false,
      rawSha256: decoded.rawSha256,
      contentHash,
      bindings: { executionRequest: request, containment },
      dependencyProjections: {
        executionRequest: {
          schema: expected.executionRequest.schema,
          launchCompatibilityStatus:
            expected.executionRequest.launchCompatibilityStatus,
          physicalLaunchEligible: false,
          finalDecisionEligible: false,
        },
        containment: {
          schema: expected.containment.schema,
          status: expected.containment.status,
          finalDecisionEligible: false,
        },
      },
      identity: value.identity,
      process: {
        disposition: process.disposition,
        firstTerminalReason: process.firstTerminalReason,
        syntheticTestOnly: process.syntheticTestOnly,
        spawned: process.spawned,
        noChild: process.noChild,
        exitObserved: process.exitObserved,
        exitCode: process.exitCode,
        signal: process.signal,
        closeObserved: process.closeObserved,
        closeCode: process.closeCode,
        closeSignal: process.closeSignal,
        stdoutEof: process.stdoutEof,
        stderrEof: process.stderrEof,
        statusAgreement: process.statusAgreement,
        reaped: process.reaped,
        directChildCleanupSafe: process.directChildCleanupSafe,
        captureComplete: process.captureComplete,
        outputTruncated: process.outputTruncated,
        durationMs: process.durationMs,
        limits: G17_BENCHMARK_BUILD_PROCESS_V3_LIMITS,
      },
      streams: rawStreams(captured.stdoutBytes, captured.stderrBytes),
      cargo,
      completion: {
        declaredRequiredSequence: value.completion.sequence,
        cgroup: {
          version: cgroup.version,
          processCount: cgroup.processCount,
          populated: cgroup.populated,
          pidsCurrent: cgroup.pidsCurrent,
          procsSha256: cgroup.procs.sha256,
          eventsSha256: cgroup.events.sha256,
          pidsCurrentSha256: cgroup.pidsCurrentRaw.sha256,
        },
      },
      executable: {
        logicalPath: executable.value.logicalPath,
        bytes: executable.value.bytes,
        sha256: executable.value.sha256,
        elfSha256: executable.value.elfSha256,
      },
      nonclaims: G17_BENCHMARK_BUILD_PROCESS_V3_NONCLAIMS,
      authority: G17_BENCHMARK_BUILD_PROCESS_V3_AUTHORITY,
    });
  } catch (error) {
    if (
      error?.message?.startsWith("G1.7 benchmark build process evidence v3:")
    ) {
      throw error;
    }
    fail(`dependency replay failed: ${error?.message ?? String(error)}`);
  }
}
