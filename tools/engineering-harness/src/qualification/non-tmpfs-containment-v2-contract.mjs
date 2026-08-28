import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA,
  G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA,
  G17BenchmarkExecutionRequestV2ContractError,
  verifyG17BenchmarkExecutionRequestV2Artifact,
} from "./benchmark-execution-request-v2-contract.mjs";
import {
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA,
  G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA,
  G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
  verifyG17CargoExecveatHelperAttestationArtifact,
} from "./cargo-execveat-helper-attestation-contract.mjs";
import { G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS } from "./non-tmpfs-build-isolation-contract.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "./non-tmpfs-build-isolation-v2-contract.mjs";

// Pure serialization and replay for the future containment-v2 owner. This
// module opens no descriptor, performs no syscall, launches no image, waits on
// no pidfd, reads no cgroup, and removes no state. It composes only successful
// outputs from the real request-v2 and helper-attestation verifiers. Their
// policy dependencies fan in; the request-to-helper binding remains explicitly
// absent until a future private co-located issuer supplies physical evidence.

export const G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA =
  "oxigraph.g1.7-non-tmpfs-containment-evidence/v2";
export const G17_NON_TMPFS_CONTAINMENT_V2_PROJECTION_SCHEMA =
  "oxigraph.g1.7-non-tmpfs-containment-replay/v2";
export const G17_NON_TMPFS_CONTAINMENT_V2_ARTIFACT_NAME =
  "non-tmpfs-containment-v2.json";
export const G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES = 2 * 1024 * 1024;

const CGROUP_FILE_MAX_BYTES = 64 * 1024;
const CGROUP_PATH_MAX_BYTES = 4_096;
const CLONE_ARGS_SIZE_BYTES = 88;
const MAX_DEPTH = 64;
const MAX_NODES = 32_768;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_PROPERTIES = 4_097;
const MAX_STRING_BYTES = G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const CGROUP2_MAGIC = 0x6367_7270n;
const CGROUP_PATH_SCHEMA = "oxigraph.g1.7-non-tmpfs-containment-cgroup-path/v2";
const CGROUP_PATH_PREFIX = "/engineering-harness-g1.7";
const CLAIM_SOURCE = "CALLER_SUPPLIED_SERIALIZED_NONAUTHORITATIVE";
const COMPOSITION_STATUS = "PRIVATE_COLOCATED_ISSUER_REQUIRED";
const DIGEST = /^[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const OWNER_GENERATION = /^g17-owner-[0-9a-f]{64}$/u;
const PROCESS_GENERATION = /^g17-process-[0-9a-f]{64}$/u;
const WORKSPACE_GENERATION = /^g17-workspace-[0-9a-f]{64}$/u;
const TARGET_GENERATION = /^g17-target-[0-9a-f]{64}$/u;

export const G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CODES = Object.freeze([
  "INPUT_SHAPE_INVALID",
  "LIMIT_EXCEEDED",
  "IDENTITY_INVALID",
  "POLICY_BINDING_DRIFT",
  "REQUEST_BINDING_DRIFT",
  "HELPER_ATTESTATION_BINDING_DRIFT",
  "MECHANICS_CONTRACT_DRIFT",
  "LIFECYCLE_CONTRADICTION",
  "CANONICAL_ARTIFACT_INVALID",
  "CONTENT_HASH_MISMATCH",
  "AUTHORITY_OVERCLAIM",
  "EXPECTED_INPUT_MISMATCH",
  "DEPENDENCY_UNCERTAIN",
]);

const ERROR_CODE_SET = new Set(G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CODES);

export class G17NonTmpfsContainmentV2ContractError extends Error {
  constructor(code, phase, message, options = undefined) {
    if (!ERROR_CODE_SET.has(code)) {
      throw new TypeError("unknown G1.7 containment-v2 contract error code");
    }
    super(
      `G1.7 non-tmpfs containment v2 contract: [${code}] ${phase}: ${message}`,
      options,
    );
    this.name = "G17NonTmpfsContainmentV2ContractError";
    this.code = code;
    this.phase = phase;
  }
}

const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectKeys = Object.keys;
const objectEntries = Object.entries;
const objectValues = Object.values;
const objectFreeze = Object.freeze;
const objectIsFrozen = Object.isFrozen;
const reflectOwnKeys = Reflect.ownKeys;
const bufferPrototype = Buffer.prototype;
const bufferIsBuffer = Buffer.isBuffer.bind(Buffer);
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const bufferEquals = Buffer.prototype.equals;
const bufferToString = Buffer.prototype.toString;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(code, phase, message, cause = undefined) {
  throw new G17NonTmpfsContainmentV2ContractError(
    code,
    phase,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function boundary(phase, operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof G17NonTmpfsContainmentV2ContractError) throw error;
    fail("DEPENDENCY_UNCERTAIN", phase, error?.message ?? String(error), error);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !objectIsFrozen(value)
  ) {
    objectFreeze(value);
    for (const child of objectValues(value)) deepFreeze(child);
  }
  return value;
}

function snapshotOwnData(
  value,
  label,
  shapeCode = "INPUT_SHAPE_INVALID",
  ancestors = new WeakSet(),
  depth = 0,
  budget = { nodes: 0, strings: 0 },
) {
  const phase = "own-data-snapshot";
  if (value !== null && typeof value === "object" && types.isProxy(value)) {
    fail(shapeCode, phase, `${label} contains a Proxy`);
  }
  if (depth > MAX_DEPTH) {
    fail("LIMIT_EXCEEDED", phase, `${label} exceeds the depth limit`);
  }
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) {
    fail("LIMIT_EXCEEDED", phase, `${label} exceeds the node limit`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = bufferByteLength(value, "utf8");
    budget.strings += bytes;
    if (bytes > MAX_SINGLE_STRING_BYTES || budget.strings > MAX_STRING_BYTES) {
      fail("LIMIT_EXCEEDED", phase, `${label} exceeds the string budget`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(shapeCode, phase, `${label} is not finite`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value)
  ) {
    fail(shapeCode, phase, `${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) {
    fail(shapeCode, phase, `${label} contains a cycle`);
  }
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    fail(shapeCode, phase, `${label} prototype cannot be inspected`, error);
  }
  const array = Array.isArray(value);
  if (
    prototype !== (array ? arrayPrototype : objectPrototype) &&
    !(prototype === null && !array)
  ) {
    fail(shapeCode, phase, `${label} contains a foreign prototype`);
  }
  ancestors.add(value);
  try {
    let descriptors;
    try {
      descriptors = objectGetOwnPropertyDescriptors(value);
    } catch (error) {
      fail(shapeCode, phase, `${label} properties cannot be inspected`, error);
    }
    const keys = reflectOwnKeys(descriptors);
    if (keys.length > MAX_PROPERTIES) {
      fail("LIMIT_EXCEEDED", phase, `${label} exceeds its property budget`);
    }
    if (keys.some((key) => typeof key !== "string")) {
      fail(shapeCode, phase, `${label} contains symbol fields`);
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      budget.strings += bufferByteLength(key, "utf8");
      if (budget.strings > MAX_STRING_BYTES) {
        fail("LIMIT_EXCEEDED", phase, `${label} exceeds the key budget`);
      }
      if (!("value" in descriptor)) {
        fail(shapeCode, phase, `${label}.${key} is not own data`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        fail(shapeCode, phase, `${label} is not a dense array`);
      }
      if (length > MAX_ARRAY_LENGTH) {
        fail("LIMIT_EXCEEDED", phase, `${label} exceeds the array limit`);
      }
      const expected = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ];
      if (!isDeepStrictEqual([...keys].sort(), expected.sort())) {
        fail(shapeCode, phase, `${label} is not a field-free dense array`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotOwnData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          shapeCode,
          ancestors,
          depth + 1,
          budget,
        ),
      );
    }
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) {
        fail(shapeCode, phase, `${label}.${key} is not enumerable`);
      }
      output[key] = snapshotOwnData(
        descriptor.value,
        `${label}.${key}`,
        shapeCode,
        ancestors,
        depth + 1,
        budget,
      );
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

function exactOwnDataEnvelope(
  value,
  expected,
  label,
  code = "INPUT_SHAPE_INVALID",
) {
  const phase = "input-envelope";
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value)
  ) {
    fail(code, phase, `${label} must be a plain record`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(value);
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch (error) {
    fail(code, phase, `${label} cannot be inspected`, error);
  }
  if (prototype !== objectPrototype && prototype !== null) {
    fail(code, phase, `${label} has a foreign prototype`);
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort())
  ) {
    fail(code, phase, `${label} fields are not exact`);
  }
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
      fail(code, phase, `${label}.${key} is not enumerable own data`);
    }
    output[key] = descriptor.value;
  }
  return output;
}

function exactKeys(value, expected, label, code = "IDENTITY_INVALID") {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !isDeepStrictEqual(objectKeys(value).sort(), [...expected].sort())
  ) {
    fail(code, "field-validation", `${label} fields are not exact`);
  }
}

function copyBoundedBuffer(
  value,
  maximum,
  label,
  {
    allowEmpty = true,
    shapeCode = "INPUT_SHAPE_INVALID",
    boundCode = "LIMIT_EXCEEDED",
  } = {},
) {
  const phase = "buffer-validation";
  let prototype;
  try {
    prototype =
      value !== null && typeof value === "object"
        ? objectGetPrototypeOf(value)
        : undefined;
  } catch (error) {
    fail(shapeCode, phase, `${label} prototype cannot be inspected`, error);
  }
  if (
    !bufferIsBuffer(value) ||
    types.isProxy(value) ||
    prototype !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(shapeCode, phase, `${label} must be an exact non-Proxy Buffer`);
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch (error) {
    fail(shapeCode, phase, `${label} length cannot be read`, error);
  }
  if (
    !Number.isSafeInteger(length) ||
    length > maximum ||
    (!allowEmpty && length === 0)
  ) {
    fail(boundCode, phase, `${label} is outside its byte bound`);
  }
  try {
    const copied = bufferAllocUnsafe(length);
    typedArraySet.call(copied, value);
    return copied;
  } catch (error) {
    fail(shapeCode, phase, `${label} cannot be copied intrinsically`, error);
  }
}

function digest(value, label, code = "IDENTITY_INVALID") {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    fail(code, "identity-validation", `${label} is not a SHA-256 digest`);
  }
  return value;
}

function safeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} is not a safe identifier`,
    );
  }
  return value;
}

function generation(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} is not an exact generation`,
    );
  }
  return value;
}

function decimal(value, label, { positive = false, maximum = null } = {}) {
  if (typeof value !== "string" || value.length > 32 || !DECIMAL.test(value)) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} is not a bounded canonical decimal`,
    );
  }
  const number = BigInt(value);
  if (
    (positive && number < 1n) ||
    (!positive && number < 0n) ||
    (maximum !== null && number > maximum)
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} is outside its range`,
    );
  }
  return number;
}

function cloneConstant(value, label) {
  return snapshotOwnData(value, label, "DEPENDENCY_UNCERTAIN");
}

const policyBundle = boundary("policy-v2-initialization", () =>
  createG17NonTmpfsBuildIsolationV2PolicyArtifact(),
);
const policy = policyBundle.policy;
const policyContainment = policy.containment;

boundary("policy-v2-binding", () => {
  if (
    policy.schema !== G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA ||
    policyContainment.requiredSuccessorSchema !==
      G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA ||
    G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING.rawSha256 !==
      policyBundle.artifact.sha256 ||
    G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING.contentHash !==
      policy.sha256 ||
    G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING.requiredContainmentSchema !==
      G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA ||
    policy.supervision.limits.closeReapTimeoutMilliseconds !==
      G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS
  ) {
    fail(
      "POLICY_BINDING_DRIFT",
      "policy-v2-binding",
      "policy, request, and successor containment schemas are inconsistent",
    );
  }
});

export const G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS = deepFreeze(
  nullRecord([
    [
      "policy",
      nullRecord([
        ["schema", policy.schema],
        ["rawSha256", policyBundle.artifact.sha256],
        ["contentHash", policy.sha256],
      ]),
    ],
    ["requiredSuccessorSchema", policyContainment.requiredSuccessorSchema],
    [
      "perBuildCgroupV2SubtreeRequired",
      policyContainment.perBuildCgroupV2SubtreeRequired,
    ],
    [
      "cgroupPathDerivation",
      cloneConstant(
        policyContainment.cgroupPathDerivation,
        "containment path derivation",
      ),
    ],
    [
      "initialPlacement",
      cloneConstant(policyContainment.initialPlacement, "initial placement"),
    ],
    [
      "directChildReap",
      cloneConstant(policyContainment.directChildReap, "direct child reap"),
    ],
    [
      "parentOnlyCgroupDescriptorRequired",
      policyContainment.parentOnlyCgroupDescriptorRequired,
    ],
    ["parentOnlyPidfdRequired", policyContainment.parentOnlyPidfdRequired],
    [
      "quiescenceAfterDirectChildReapRequired",
      policyContainment.quiescenceAfterDirectChildReapRequired,
    ],
    [
      "quiescenceObservations",
      cloneConstant(
        policyContainment.quiescenceObservations,
        "quiescence observations",
      ),
    ],
    [
      "cleanupBeforeQuiescenceForbidden",
      policyContainment.cleanupBeforeQuiescenceForbidden,
    ],
    ["nativeAdapterRequired", policyContainment.nativeAdapterRequired],
    [
      "closeReapTimeoutMilliseconds",
      policy.supervision.limits.closeReapTimeoutMilliseconds,
    ],
    ["cloneArgsSizeBytes", CLONE_ARGS_SIZE_BYTES],
    ["artifactMaximumBytes", G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES],
    ["cgroupFileMaximumBytes", CGROUP_FILE_MAX_BYTES],
    ["cgroupPathMaximumBytes", CGROUP_PATH_MAX_BYTES],
  ]),
);

export const G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256 = canonicalSha256(
  G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS,
);

function falseSuperset(sources, extensions, label) {
  const output = Object.create(null);
  for (const source of sources) {
    for (const [key, value] of objectEntries(source)) {
      if (value !== false) {
        fail(
          "POLICY_BINDING_DRIFT",
          "upstream-false-oracle-binding",
          `${label}.${key} is not false`,
        );
      }
      output[key] = false;
    }
  }
  for (const key of extensions) output[key] = false;
  return deepFreeze(output);
}

export const G17_NON_TMPFS_CONTAINMENT_V2_AUTHORITY = falseSuperset(
  [
    G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY,
  ],
  ["nativeContainmentAdapterAuthority", "cleanupExecutionAuthority"],
  "authority",
);

export const G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS = falseSuperset(
  [
    G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
    G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS,
  ],
  [
    "serializedReplayProvesNativeOrigin",
    "serializedReplayProvesObservationOrder",
    "serializedClone3ClaimProvesSyscall",
    "serializedClone3ClaimProvesInitialCgroupPlacement",
    "serializedCloneArgsProveKernelInput",
    "serializedPidfdClaimProvesKernelPidfd",
    "serializedPidfdPollClaimProvesReadiness",
    "serializedWaitidClaimProvesDirectChildReap",
    "serializedPidfdCloseClaimProvesClose",
    "serializedQuiescenceBytesProveKernelOrigin",
    "serializedCgroupPathProvesHeldDirectory",
    "serializedDescriptorClaimProvesParentOnlyIsolation",
    "serializedHelperImageReachedClaimProvesTransition",
    "serializedRequestAndHelperFanInProvesCoLocatedIssuer",
    "replayProvesNoPostSpawnCgroupMove",
    "replayProvesNoForkFallback",
    "replayProvesNoCloneFallback",
    "replayProvesLifecycleOrder",
    "replayProvesCleanupOrder",
    "cleanupExecuted",
    "physicalOriginProven",
    "physicalEligibility",
  ],
  "nonclaims",
);

export const G17_NON_TMPFS_CONTAINMENT_V2_ERROR_CLASSIFICATION = deepFreeze(
  nullRecord([
    [
      "INPUT_SHAPE_INVALID",
      nullRecord([
        ["origin", "public-envelope"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "LIMIT_EXCEEDED",
      nullRecord([
        ["origin", "bounded-input"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "IDENTITY_INVALID",
      nullRecord([
        ["origin", "identity-validation"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "POLICY_BINDING_DRIFT",
      nullRecord([
        ["origin", "verified-request-policy"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "REQUEST_BINDING_DRIFT",
      nullRecord([
        ["origin", "request-v2-verifier"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "HELPER_ATTESTATION_BINDING_DRIFT",
      nullRecord([
        ["origin", "helper-attestation-verifier"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "MECHANICS_CONTRACT_DRIFT",
      nullRecord([
        ["origin", "serialized-mechanics"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "LIFECYCLE_CONTRADICTION",
      nullRecord([
        ["origin", "serialized-lifecycle"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "CANONICAL_ARTIFACT_INVALID",
      nullRecord([
        ["origin", "canonical-artifact"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "CONTENT_HASH_MISMATCH",
      nullRecord([
        ["origin", "content-hash"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "AUTHORITY_OVERCLAIM",
      nullRecord([
        ["origin", "authority-or-eligibility"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "EXPECTED_INPUT_MISMATCH",
      nullRecord([
        ["origin", "trusted-replay-input"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
    [
      "DEPENDENCY_UNCERTAIN",
      nullRecord([
        ["origin", "internal-dependency"],
        ["terminal", true],
        ["retryAllowed", false],
      ]),
    ],
  ]),
);

function captureRequestVerification(input) {
  const envelope = exactOwnDataEnvelope(
    input,
    ["bytes", "expected"],
    "executionRequestVerification",
  );
  let verified;
  try {
    verified = verifyG17BenchmarkExecutionRequestV2Artifact(envelope);
  } catch (error) {
    if (
      error instanceof G17BenchmarkExecutionRequestV2ContractError &&
      error.code === "POLICY_BINDING_DRIFT"
    ) {
      fail(
        "POLICY_BINDING_DRIFT",
        "request-policy-verification",
        "verified request artifact carries inconsistent policy-v2 binding",
        error,
      );
    }
    fail(
      "REQUEST_BINDING_DRIFT",
      "request-v2-verification",
      "execution request artifact did not pass its native verifier",
      error,
    );
  }
  const value = snapshotOwnData(
    verified,
    "verified execution request",
    "DEPENDENCY_UNCERTAIN",
  );
  exactKeys(
    value,
    ["request", "identity", "projection"],
    "verified execution request",
    "DEPENDENCY_UNCERTAIN",
  );
  exactKeys(
    value.identity,
    ["schema", "rawSha256", "contentHash"],
    "verified request identity",
    "DEPENDENCY_UNCERTAIN",
  );
  const request = value.request;
  const projection = value.projection;
  if (
    value.identity.schema !== G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA ||
    projection.schema !==
      G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA ||
    projection.requestSchema !== G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA ||
    projection.rawSha256 !== value.identity.rawSha256 ||
    projection.contentHash !== value.identity.contentHash ||
    request.contentHash !== value.identity.contentHash ||
    request.controlRunId !== projection.controlRunId ||
    request.buildId !== projection.buildId ||
    request.ownership.processGeneration !== projection.processGeneration ||
    request.source.targetGeneration !== projection.targetGeneration ||
    projection.physicalLaunchEligible !== false ||
    projection.binding !== null ||
    projection.finalDecisionEligible !== false ||
    !isDeepStrictEqual(
      projection.authority,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
    ) ||
    !isDeepStrictEqual(
      projection.nonclaims,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
    )
  ) {
    fail(
      "REQUEST_BINDING_DRIFT",
      "request-v2-projection-validation",
      "request verifier output is not the exact authority-free projection",
    );
  }
  if (
    !isDeepStrictEqual(
      request.isolationPolicy,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
    ) ||
    !isDeepStrictEqual(
      projection.isolationPolicy,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
    )
  ) {
    fail(
      "POLICY_BINDING_DRIFT",
      "request-policy-projection-validation",
      "request verifier output drifted from the exact policy dependency",
    );
  }
  digest(
    value.identity.rawSha256,
    "verified request rawSha256",
    "REQUEST_BINDING_DRIFT",
  );
  digest(
    value.identity.contentHash,
    "verified request contentHash",
    "REQUEST_BINDING_DRIFT",
  );
  safeId(request.controlRunId, "verified request controlRunId");
  safeId(request.buildId, "verified request buildId");
  generation(
    request.ownership.ownerGeneration,
    OWNER_GENERATION,
    "verified owner generation",
  );
  generation(
    request.ownership.processGeneration,
    PROCESS_GENERATION,
    "verified process generation",
  );
  generation(
    request.source.workspaceGeneration,
    WORKSPACE_GENERATION,
    "verified workspace generation",
  );
  generation(
    request.source.targetGeneration,
    TARGET_GENERATION,
    "verified target generation",
  );
  return value;
}

function captureHelperVerification(input) {
  const envelope = exactOwnDataEnvelope(
    input,
    ["bytes", "evidence"],
    "helperAttestationVerification",
  );
  let verified;
  try {
    verified = verifyG17CargoExecveatHelperAttestationArtifact(envelope);
  } catch (error) {
    fail(
      "HELPER_ATTESTATION_BINDING_DRIFT",
      "helper-attestation-verification",
      "helper attestation artifact did not pass its native verifier",
      error,
    );
  }
  const value = snapshotOwnData(
    verified,
    "verified helper attestation",
    "DEPENDENCY_UNCERTAIN",
  );
  exactKeys(
    value,
    [
      "schema",
      "status",
      "identity",
      "requestBinding",
      "physicalLaunchEligible",
      "binding",
      "finalDecisionEligible",
      "nonclaims",
      "authority",
    ],
    "verified helper attestation",
    "DEPENDENCY_UNCERTAIN",
  );
  exactKeys(
    value.identity,
    ["schema", "rawSha256", "contentHash"],
    "verified helper identity",
    "DEPENDENCY_UNCERTAIN",
  );
  if (
    value.schema !== G17_CARGO_EXECVEAT_HELPER_ATTESTATION_PROJECTION_SCHEMA ||
    value.status !== "DORMANT_HELPER_ATTESTATION_REPLAYED" ||
    value.identity.schema !== G17_CARGO_EXECVEAT_HELPER_ATTESTATION_SCHEMA ||
    value.physicalLaunchEligible !== false ||
    value.binding !== null ||
    value.finalDecisionEligible !== false ||
    !isDeepStrictEqual(
      value.requestBinding,
      G17_CARGO_EXECVEAT_HELPER_REQUEST_BINDING_PLACEHOLDER,
    ) ||
    !isDeepStrictEqual(
      value.authority,
      G17_CARGO_EXECVEAT_HELPER_ATTESTATION_AUTHORITY,
    ) ||
    !isDeepStrictEqual(
      value.nonclaims,
      G17_CARGO_EXECVEAT_HELPER_ATTESTATION_NONCLAIMS,
    )
  ) {
    fail(
      "HELPER_ATTESTATION_BINDING_DRIFT",
      "helper-attestation-projection-validation",
      "helper verifier output is not the exact dormant unbound projection",
    );
  }
  digest(
    value.identity.rawSha256,
    "verified helper rawSha256",
    "HELPER_ATTESTATION_BINDING_DRIFT",
  );
  digest(
    value.identity.contentHash,
    "verified helper contentHash",
    "HELPER_ATTESTATION_BINDING_DRIFT",
  );
  return value;
}

function runIdentityFromRequest(requestVerification) {
  const request = requestVerification.request;
  return nullRecord([
    ["controlRunId", request.controlRunId],
    ["buildId", request.buildId],
    ["ownerGeneration", request.ownership.ownerGeneration],
    ["processGeneration", request.ownership.processGeneration],
    ["workspaceGeneration", request.source.workspaceGeneration],
    ["targetGeneration", request.source.targetGeneration],
  ]);
}

function deriveCgroupPath(requestVerification, helperVerification) {
  const request = requestVerification.request;
  const suffix = canonicalSha256(
    nullRecord([
      ["schema", CGROUP_PATH_SCHEMA],
      [
        "isolationPolicyIdentity",
        cloneConstant(
          G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
          "cgroup path policy identity",
        ),
      ],
      [
        "executionRequestIdentity",
        cloneConstant(
          requestVerification.identity,
          "cgroup path request identity",
        ),
      ],
      [
        "helperAttestationIdentity",
        cloneConstant(
          helperVerification.identity,
          "cgroup path helper identity",
        ),
      ],
      ["controlRunId", request.controlRunId],
      ["buildId", request.buildId],
      ["ownerGeneration", request.ownership.ownerGeneration],
      ["processGeneration", request.ownership.processGeneration],
      ["workspaceGeneration", request.source.workspaceGeneration],
      ["targetGeneration", request.source.targetGeneration],
    ]),
  );
  const path = `${CGROUP_PATH_PREFIX}/run-${request.controlRunId}/build-${request.buildId}-${suffix}`;
  if (bufferByteLength(path, "utf8") > CGROUP_PATH_MAX_BYTES) {
    fail(
      "LIMIT_EXCEEDED",
      "cgroup-path-derivation",
      "derived cgroup path exceeds its byte limit",
    );
  }
  return path;
}

export function deriveG17NonTmpfsContainmentV2CgroupPath(input) {
  return boundary("cgroup-path-derivation", () => {
    const value = exactOwnDataEnvelope(
      input,
      ["executionRequestVerification", "helperAttestationVerification"],
      "cgroup path input",
    );
    return deriveCgroupPath(
      captureRequestVerification(value.executionRequestVerification),
      captureHelperVerification(value.helperAttestationVerification),
    );
  });
}

function validateCgroupDirectory(input) {
  const value = snapshotOwnData(input, "cgroup directory descriptor");
  exactKeys(
    value,
    [
      "role",
      "kind",
      "descriptorCapabilities",
      "fixedFd",
      "parentOnly",
      "entersHelperImage",
      "entersCargoImage",
      "identity",
    ],
    "cgroup directory descriptor",
  );
  exactKeys(
    value.identity,
    [
      "device",
      "inode",
      "mode",
      "links",
      "mountId",
      "filesystemType",
      "ownerUid",
      "ownerGid",
    ],
    "cgroup directory identity",
  );
  const mode = decimal(value.identity.mode, "cgroup directory mode", {
    positive: true,
    maximum: 0o177777n,
  });
  decimal(value.identity.device, "cgroup directory device", { positive: true });
  decimal(value.identity.inode, "cgroup directory inode", { positive: true });
  decimal(value.identity.links, "cgroup directory links", { positive: true });
  decimal(value.identity.mountId, "cgroup directory mountId", {
    positive: true,
  });
  const filesystemType = decimal(
    value.identity.filesystemType,
    "cgroup directory filesystemType",
    { positive: true },
  );
  decimal(value.identity.ownerUid, "cgroup directory ownerUid");
  decimal(value.identity.ownerGid, "cgroup directory ownerGid");
  if (
    value.role !== "cgroupDirectory" ||
    value.kind !== "directory" ||
    value.descriptorCapabilities !==
      "held-directory-openat-read-write-children" ||
    value.fixedFd !== null ||
    value.parentOnly !== true ||
    value.entersHelperImage !== false ||
    value.entersCargoImage !== false ||
    (mode & 0o170000n) !== 0o040000n ||
    filesystemType !== CGROUP2_MAGIC
  ) {
    fail(
      "MECHANICS_CONTRACT_DRIFT",
      "cgroup-directory-validation",
      "cgroup descriptor is not the exact parent-only held cgroup-v2 directory",
    );
  }
  return value;
}

function validatePlacement(input) {
  const value = snapshotOwnData(input, "clone3 placement claim");
  exactKeys(
    value,
    [
      "claimSource",
      "syscall",
      "cloneArgsSizeBytes",
      "cloneArgs",
      "result",
      "errno",
      "workerPlacedBeforeUserCodeRunnable",
      "postSpawnCgroupProcsWritten",
      "forkThenMoveFallbackUsed",
      "cloneWithoutIntoCgroupFallbackUsed",
      "serializedHelperImageReachedClaim",
      "pidfd",
    ],
    "clone3 placement claim",
    "MECHANICS_CONTRACT_DRIFT",
  );
  exactKeys(
    value.cloneArgs,
    [
      "flags",
      "pidfdOutput",
      "childTidPointer",
      "parentTidPointer",
      "exitSignal",
      "stackPointer",
      "stackSizeBytes",
      "tlsPointer",
      "setTidPointer",
      "setTidSize",
      "setTidEntries",
      "cgroupDescriptorRole",
    ],
    "clone_args claim",
    "MECHANICS_CONTRACT_DRIFT",
  );
  exactKeys(
    value.cloneArgs.pidfdOutput,
    ["role", "ownership", "storage"],
    "clone_args pidfd output",
    "MECHANICS_CONTRACT_DRIFT",
  );
  exactKeys(
    value.pidfd,
    [
      "role",
      "kind",
      "descriptorCapabilities",
      "fixedFd",
      "parentOnly",
      "entersHelperImage",
      "entersCargoImage",
      "fdCloexec",
    ],
    "pidfd descriptor claim",
    "MECHANICS_CONTRACT_DRIFT",
  );
  const cloneArgs = value.cloneArgs;
  if (
    value.claimSource !== CLAIM_SOURCE ||
    value.syscall !== "clone3" ||
    value.cloneArgsSizeBytes !== CLONE_ARGS_SIZE_BYTES ||
    !isDeepStrictEqual(cloneArgs.flags, ["CLONE_INTO_CGROUP", "CLONE_PIDFD"]) ||
    cloneArgs.pidfdOutput.role !== "directChildPidfd" ||
    cloneArgs.pidfdOutput.ownership !== "parent" ||
    cloneArgs.pidfdOutput.storage !== "caller-provided-output-pointer" ||
    cloneArgs.childTidPointer !== 0 ||
    cloneArgs.parentTidPointer !== 0 ||
    cloneArgs.exitSignal !== "SIGCHLD" ||
    cloneArgs.stackPointer !== 0 ||
    cloneArgs.stackSizeBytes !== 0 ||
    cloneArgs.tlsPointer !== 0 ||
    cloneArgs.setTidPointer !== 0 ||
    cloneArgs.setTidSize !== 0 ||
    !isDeepStrictEqual(cloneArgs.setTidEntries, []) ||
    cloneArgs.cgroupDescriptorRole !== "cgroupDirectory" ||
    value.result !== "SUCCESS" ||
    value.errno !== null ||
    value.workerPlacedBeforeUserCodeRunnable !== true ||
    value.postSpawnCgroupProcsWritten !== false ||
    value.forkThenMoveFallbackUsed !== false ||
    value.cloneWithoutIntoCgroupFallbackUsed !== false ||
    value.serializedHelperImageReachedClaim !== true ||
    value.pidfd.role !== "directChildPidfd" ||
    value.pidfd.kind !== "pidfd" ||
    value.pidfd.descriptorCapabilities !== "poll-signal-waitid" ||
    value.pidfd.fixedFd !== null ||
    value.pidfd.parentOnly !== true ||
    value.pidfd.entersHelperImage !== false ||
    value.pidfd.entersCargoImage !== false ||
    value.pidfd.fdCloexec !== true
  ) {
    fail(
      "MECHANICS_CONTRACT_DRIFT",
      "clone3-placement-validation",
      "placement is not the exact no-fallback clone3 cgroup/pidfd claim",
    );
  }
  return value;
}

function validateSupervision(input) {
  const value = snapshotOwnData(input, "pidfd supervision claim");
  exactKeys(
    value,
    ["claimSource", "pidfdRole", "boundedWait", "poll", "waitid", "close"],
    "pidfd supervision claim",
    "MECHANICS_CONTRACT_DRIFT",
  );
  exactKeys(
    value.boundedWait,
    ["mechanism", "timeoutMilliseconds", "timeoutDisposition"],
    "bounded pidfd wait claim",
    "MECHANICS_CONTRACT_DRIFT",
  );
  exactKeys(
    value.poll,
    [
      "syscall",
      "descriptorRole",
      "events",
      "timeoutMilliseconds",
      "result",
      "revents",
      "errno",
    ],
    "pidfd poll claim",
    "MECHANICS_CONTRACT_DRIFT",
  );
  exactKeys(
    value.waitid,
    [
      "syscall",
      "idType",
      "pidfdRole",
      "options",
      "result",
      "siCode",
      "exitCode",
      "signal",
      "coreDumped",
      "callerSuppliedReapProofAccepted",
    ],
    "waitid claim",
    "MECHANICS_CONTRACT_DRIFT",
  );
  exactKeys(
    value.close,
    ["syscall", "descriptorRole", "result", "errno", "afterWaitid"],
    "pidfd close claim",
    "MECHANICS_CONTRACT_DRIFT",
  );
  if (
    value.claimSource !== CLAIM_SOURCE ||
    value.pidfdRole !== "directChildPidfd" ||
    value.boundedWait.mechanism !== "pidfd-poll-before-waitid" ||
    value.boundedWait.timeoutMilliseconds !==
      G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS ||
    value.boundedWait.timeoutDisposition !==
      "INCONCLUSIVE_RETAIN_HANDLES_NO_CLEANUP" ||
    value.poll.syscall !== "poll" ||
    value.poll.descriptorRole !== "directChildPidfd" ||
    !isDeepStrictEqual(value.poll.events, ["POLLIN"]) ||
    value.poll.timeoutMilliseconds !==
      G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS ||
    value.poll.result !== "READY" ||
    !isDeepStrictEqual(value.poll.revents, ["POLLIN"]) ||
    value.poll.errno !== null ||
    value.waitid.syscall !== "waitid" ||
    value.waitid.idType !== "P_PIDFD" ||
    value.waitid.pidfdRole !== "directChildPidfd" ||
    !isDeepStrictEqual(value.waitid.options, ["WEXITED"]) ||
    value.waitid.result !== "REAPED" ||
    value.waitid.siCode !== "CLD_EXITED" ||
    value.waitid.exitCode !== 0 ||
    value.waitid.signal !== null ||
    value.waitid.coreDumped !== false ||
    value.waitid.callerSuppliedReapProofAccepted !== false ||
    value.close.syscall !== "close" ||
    value.close.descriptorRole !== "directChildPidfd" ||
    value.close.result !== "CLOSED" ||
    value.close.errno !== null ||
    value.close.afterWaitid !== true
  ) {
    fail(
      "MECHANICS_CONTRACT_DRIFT",
      "pidfd-supervision-validation",
      "pidfd poll, waitid, or close claim drifted from the bounded contract",
    );
  }
  return value;
}

function rawRecord(bytes) {
  return nullRecord([
    ["bytes", typedArrayLengthGetter.call(bytes)],
    ["sha256", sha256(bytes)],
    ["base64", bufferToString.call(bytes, "base64")],
  ]);
}

function strictText(bytes, label) {
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(
      "LIFECYCLE_CONTRADICTION",
      "cgroup-terminal-validation",
      `${label} is not UTF-8`,
      error,
    );
  }
  if (!text.endsWith("\n") || text.includes("\r") || text.includes("\0")) {
    fail(
      "LIFECYCLE_CONTRADICTION",
      "cgroup-terminal-validation",
      `${label} is not strict LF-terminated text`,
    );
  }
  return text;
}

function validateCgroupTerminal(procsBytes, eventsBytes, pidsCurrentBytes) {
  if (typedArrayLengthGetter.call(procsBytes) !== 0) {
    fail(
      "LIFECYCLE_CONTRADICTION",
      "cgroup-terminal-validation",
      "cgroup.procs is not empty",
    );
  }
  const eventsText = strictText(eventsBytes, "cgroup.events");
  const rows = eventsText.slice(0, -1).split("\n");
  const parsed = new Map();
  for (const [index, row] of rows.entries()) {
    const match = /^([a-z][a-z0-9_]*) (0|[1-9][0-9]*)$/u.exec(row);
    if (match === null || parsed.has(match[1])) {
      fail(
        "LIFECYCLE_CONTRADICTION",
        "cgroup-terminal-validation",
        `cgroup.events row ${index + 1} is invalid or duplicated`,
      );
    }
    parsed.set(match[1], match[2]);
  }
  if (parsed.get("populated") !== "0") {
    fail(
      "LIFECYCLE_CONTRADICTION",
      "cgroup-terminal-validation",
      "cgroup.events does not report populated 0",
    );
  }
  const pidsCurrentText = strictText(pidsCurrentBytes, "pids.current");
  if (pidsCurrentText !== "0\n") {
    fail(
      "LIFECYCLE_CONTRADICTION",
      "cgroup-terminal-validation",
      "pids.current does not report exact zero",
    );
  }
  return nullRecord([
    ["claimSource", CLAIM_SOURCE],
    [
      "procs",
      nullRecord([
        ["raw", rawRecord(procsBytes)],
        ["value", "empty"],
      ]),
    ],
    [
      "events",
      nullRecord([
        ["raw", rawRecord(eventsBytes)],
        ["populated", "0"],
      ]),
    ],
    [
      "pidsCurrent",
      nullRecord([
        ["raw", rawRecord(pidsCurrentBytes)],
        ["value", "0"],
      ]),
    ],
    ["processesRemaining", 0],
  ]);
}

function captureInput(input) {
  const value = exactOwnDataEnvelope(
    input,
    [
      "executionRequestVerification",
      "helperAttestationVerification",
      "cgroupDirectory",
      "placement",
      "supervision",
      "cgroupProcsBytes",
      "cgroupEventsBytes",
      "cgroupPidsCurrentBytes",
    ],
    "containment-v2 input",
  );
  const captured = nullRecord([
    [
      "executionRequestVerification",
      captureRequestVerification(value.executionRequestVerification),
    ],
    [
      "helperAttestationVerification",
      captureHelperVerification(value.helperAttestationVerification),
    ],
    ["cgroupDirectory", validateCgroupDirectory(value.cgroupDirectory)],
    ["placement", validatePlacement(value.placement)],
    ["supervision", validateSupervision(value.supervision)],
    [
      "cgroupProcsBytes",
      copyBoundedBuffer(
        value.cgroupProcsBytes,
        CGROUP_FILE_MAX_BYTES,
        "cgroup.procs bytes",
      ),
    ],
    [
      "cgroupEventsBytes",
      copyBoundedBuffer(
        value.cgroupEventsBytes,
        CGROUP_FILE_MAX_BYTES,
        "cgroup.events bytes",
        { allowEmpty: false },
      ),
    ],
    [
      "cgroupPidsCurrentBytes",
      copyBoundedBuffer(
        value.cgroupPidsCurrentBytes,
        CGROUP_FILE_MAX_BYTES,
        "pids.current bytes",
        { allowEmpty: false },
      ),
    ],
  ]);
  captured.quiescence = validateCgroupTerminal(
    captured.cgroupProcsBytes,
    captured.cgroupEventsBytes,
    captured.cgroupPidsCurrentBytes,
  );
  captured.cgroupPath = deriveCgroupPath(
    captured.executionRequestVerification,
    captured.helperAttestationVerification,
  );
  return captured;
}

const DECLARED_SEQUENCE = deepFreeze([
  "clone3-initial-cgroup-placement",
  "serialized-helper-image-reached-claim",
  "bounded-pidfd-poll",
  "waitid-pidfd-direct-child-reap",
  "direct-child-pidfd-close",
  "cgroup-v2-quiescence",
  "cleanup-eligible-only-after-physical-quiescence-proof",
]);

function dependencyDag(captured) {
  return nullRecord([
    ["status", COMPOSITION_STATUS],
    ["mode", "POLICY_DEPENDENCY_FAN_IN"],
    [
      "nodes",
      nullRecord([
        [
          "isolationPolicy",
          cloneConstant(
            G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
            "dependency policy node",
          ),
        ],
        [
          "executionRequest",
          cloneConstant(
            captured.executionRequestVerification.identity,
            "dependency request node",
          ),
        ],
        [
          "helperAttestation",
          cloneConstant(
            captured.helperAttestationVerification.identity,
            "dependency helper node",
          ),
        ],
        [
          "containmentRequirements",
          nullRecord([
            ["schema", G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA],
            ["sha256", G17_NON_TMPFS_CONTAINMENT_V2_REQUIREMENTS_SHA256],
          ]),
        ],
      ]),
    ],
    [
      "edges",
      [
        nullRecord([
          ["from", "isolationPolicy"],
          ["to", "executionRequest"],
          ["relation", "VERIFIED_POLICY_DEPENDENCY"],
        ]),
        nullRecord([
          ["from", "isolationPolicy"],
          ["to", "helperAttestation"],
          ["relation", "VERIFIED_POLICY_DEPENDENCY"],
        ]),
        nullRecord([
          ["from", "executionRequest"],
          ["to", "helperAttestation"],
          ["relation", "ABSENT_PRIVATE_COLOCATED_ISSUER_REQUIRED"],
        ]),
      ],
    ],
    [
      "requestHelperBinding",
      nullRecord([
        ["status", COMPOSITION_STATUS],
        ["present", false],
        [
          "placeholder",
          cloneConstant(
            captured.helperAttestationVerification.requestBinding,
            "helper request-binding placeholder",
          ),
        ],
        ["binding", null],
        ["physicalLaunchEligible", false],
        ["finalDecisionEligible", false],
      ]),
    ],
  ]);
}

function buildEvidence(input) {
  const captured = captureInput(input);
  const unsigned = nullRecord([
    ["schema", G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA],
    ["status", COMPOSITION_STATUS],
    ["dependencyDag", dependencyDag(captured)],
    ["identity", runIdentityFromRequest(captured.executionRequestVerification)],
    [
      "cgroup",
      nullRecord([
        ["path", captured.cgroupPath],
        ["directory", captured.cgroupDirectory],
      ]),
    ],
    [
      "lifecycle",
      nullRecord([
        [
          "declaredSequence",
          cloneConstant(DECLARED_SEQUENCE, "declared lifecycle"),
        ],
        ["placement", captured.placement],
        ["supervision", captured.supervision],
      ]),
    ],
    ["quiescence", captured.quiescence],
    [
      "cleanup",
      nullRecord([
        ["status", "NOT_EXECUTED_BY_REPLAY_CONTRACT"],
        ["requiresPhysicalQuiescenceProof", true],
        ["physicalEligibility", false],
      ]),
    ],
    [
      "implementation",
      nullRecord([
        ["nativeContainmentAdapterImplemented", false],
        ["privateCoLocatedIssuerImplemented", false],
        ["physicalMechanicsObserved", false],
        ["physicalLaunchEligible", false],
      ]),
    ],
    ["physicalOriginProven", false],
    ["physicalCleanupEligible", false],
    ["binding", null],
    ["finalDecisionEligible", false],
    ["nonclaims", G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS],
    ["authority", G17_NON_TMPFS_CONTAINMENT_V2_AUTHORITY],
  ]);
  return deepFreeze(
    nullRecord([
      ...objectEntries(unsigned),
      ["contentHash", canonicalSha256(unsigned)],
    ]),
  );
}

function canonicalEvidenceBytes(evidence) {
  let bytes;
  try {
    bytes = bufferFrom(`${canonicalJson(evidence)}\n`, "utf8");
  } catch (error) {
    fail(
      "DEPENDENCY_UNCERTAIN",
      "canonical-encoding",
      "containment-v2 evidence cannot be encoded canonically",
      error,
    );
  }
  if (
    typedArrayLengthGetter.call(bytes) < 2 ||
    typedArrayLengthGetter.call(bytes) > G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES
  ) {
    fail(
      "LIMIT_EXCEEDED",
      "canonical-encoding",
      "containment-v2 artifact exceeds its byte ceiling",
    );
  }
  return bytes;
}

function intrinsicBufferCopy(bytes) {
  const length = typedArrayLengthGetter.call(bytes);
  const copied = bufferAllocUnsafe(length);
  typedArraySet.call(copied, bytes);
  return copied;
}

function artifactEnvelope(bytes) {
  const stored = intrinsicBufferCopy(bytes);
  const artifact = Object.create(null);
  Object.defineProperties(artifact, {
    name: {
      value: G17_NON_TMPFS_CONTAINMENT_V2_ARTIFACT_NAME,
      enumerable: true,
    },
    rawSha256: { value: sha256(stored), enumerable: true },
    bytes: {
      get() {
        return intrinsicBufferCopy(stored);
      },
      enumerable: true,
    },
  });
  return objectFreeze(artifact);
}

function identityFor(evidence, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA],
      ["rawSha256", sha256(bytes)],
      ["contentHash", evidence.contentHash],
    ]),
  );
}

function projectionFor(evidence, identity) {
  return deepFreeze(
    nullRecord([
      ["schema", G17_NON_TMPFS_CONTAINMENT_V2_PROJECTION_SCHEMA],
      ["status", "DORMANT_CONTAINMENT_V2_REPLAYED"],
      ["compositionStatus", COMPOSITION_STATUS],
      ["replayStatus", "SERIALIZED_CLAIMS_REPLAYED"],
      ["identity", identity],
      ["dependencyDag", evidence.dependencyDag],
      ["runIdentity", evidence.identity],
      ["cgroupPath", evidence.cgroup.path],
      [
        "cleanupDisposition",
        "FUTURE_OWNER_MUST_PROVE_QUIESCENCE_BEFORE_CLEANUP",
      ],
      ["physicalOriginProven", false],
      ["physicalCleanupEligible", false],
      ["binding", null],
      ["finalDecisionEligible", false],
      ["nonclaims", G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS],
      ["authority", G17_NON_TMPFS_CONTAINMENT_V2_AUTHORITY],
    ]),
  );
}

export function createG17NonTmpfsContainmentV2Artifact(input) {
  return boundary("containment-v2-creation", () => {
    const evidence = buildEvidence(input);
    const bytes = canonicalEvidenceBytes(evidence);
    const identity = identityFor(evidence, bytes);
    return objectFreeze(
      nullRecord([
        ["evidence", evidence],
        ["identity", identity],
        ["projection", projectionFor(evidence, identity)],
        ["artifact", artifactEnvelope(bytes)],
      ]),
    );
  });
}

function decodeCanonicalEvidence(bytes) {
  const phase = "canonical-decoding";
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "containment-v2 artifact is not UTF-8",
      error,
    );
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "containment-v2 artifact must be one LF-terminated JSON value",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "containment-v2 artifact is invalid JSON",
      error,
    );
  }
  const evidence = snapshotOwnData(
    parsed,
    "containment-v2 document",
    "CANONICAL_ARTIFACT_INVALID",
  );
  let expectedBytes;
  try {
    expectedBytes = canonicalEvidenceBytes(evidence);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "containment-v2 artifact is outside canonical bounds",
      error,
    );
  }
  if (!bufferEquals.call(bytes, expectedBytes)) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "containment-v2 artifact is not canonical JSON plus one LF",
    );
  }
  return evidence;
}

function validateSealedNestedEnvelopes(value) {
  exactKeys(
    value.dependencyDag,
    ["status", "mode", "nodes", "edges", "requestHelperBinding"],
    "containment-v2 dependencyDag",
    "CANONICAL_ARTIFACT_INVALID",
  );
  exactKeys(
    value.dependencyDag.requestHelperBinding,
    [
      "status",
      "present",
      "placeholder",
      "binding",
      "physicalLaunchEligible",
      "finalDecisionEligible",
    ],
    "containment-v2 requestHelperBinding",
    "CANONICAL_ARTIFACT_INVALID",
  );
  exactKeys(
    value.cgroup,
    ["path", "directory"],
    "containment-v2 cgroup",
    "CANONICAL_ARTIFACT_INVALID",
  );
}

function validateSealedEvidence(value, expected) {
  exactKeys(
    value,
    [
      "schema",
      "status",
      "dependencyDag",
      "identity",
      "cgroup",
      "lifecycle",
      "quiescence",
      "cleanup",
      "implementation",
      "physicalOriginProven",
      "physicalCleanupEligible",
      "binding",
      "finalDecisionEligible",
      "nonclaims",
      "authority",
      "contentHash",
    ],
    "containment-v2 document",
    "CANONICAL_ARTIFACT_INVALID",
  );
  validateSealedNestedEnvelopes(value);
  if (
    value.schema !== G17_NON_TMPFS_CONTAINMENT_V2_EVIDENCE_SCHEMA ||
    value.status !== COMPOSITION_STATUS
  ) {
    fail(
      "IDENTITY_INVALID",
      "sealed-identity-validation",
      "containment-v2 schema or composition status drifted",
    );
  }
  digest(
    value.contentHash,
    "containment-v2 contentHash",
    "CONTENT_HASH_MISMATCH",
  );
  const unsigned = nullRecord(
    objectEntries(value).filter(([key]) => key !== "contentHash"),
  );
  if (value.contentHash !== canonicalSha256(unsigned)) {
    fail(
      "CONTENT_HASH_MISMATCH",
      "content-hash-validation",
      "containment-v2 contentHash does not verify",
    );
  }
  if (
    !isDeepStrictEqual(
      value.authority,
      G17_NON_TMPFS_CONTAINMENT_V2_AUTHORITY,
    ) ||
    !isDeepStrictEqual(
      value.nonclaims,
      G17_NON_TMPFS_CONTAINMENT_V2_NONCLAIMS,
    ) ||
    value.physicalOriginProven !== false ||
    value.physicalCleanupEligible !== false ||
    value.binding !== null ||
    value.finalDecisionEligible !== false ||
    !isDeepStrictEqual(value.implementation, expected.implementation) ||
    value.dependencyDag.status !== COMPOSITION_STATUS ||
    value.dependencyDag.requestHelperBinding.present !== false ||
    value.dependencyDag.requestHelperBinding.binding !== null ||
    value.dependencyDag.requestHelperBinding.physicalLaunchEligible !== false ||
    value.dependencyDag.requestHelperBinding.finalDecisionEligible !== false
  ) {
    fail(
      "AUTHORITY_OVERCLAIM",
      "authority-validation",
      "containment-v2 replay overclaims mechanics, binding, authority, or eligibility",
    );
  }
  if (
    !isDeepStrictEqual(value.dependencyDag, expected.dependencyDag) ||
    !isDeepStrictEqual(value.identity, expected.identity) ||
    value.cgroup.path !== expected.cgroup.path
  ) {
    fail(
      "EXPECTED_INPUT_MISMATCH",
      "expected-input-validation",
      "containment-v2 dependencies, identity, or PID-free path differ from verified inputs",
    );
  }
  if (
    !isDeepStrictEqual(value.cgroup, expected.cgroup) ||
    !isDeepStrictEqual(value.lifecycle, expected.lifecycle) ||
    !isDeepStrictEqual(value.quiescence, expected.quiescence) ||
    !isDeepStrictEqual(value.cleanup, expected.cleanup)
  ) {
    fail(
      "MECHANICS_CONTRACT_DRIFT",
      "mechanics-validation",
      "containment-v2 placement, supervision, quiescence, or cleanup drifted",
    );
  }
  if (!isDeepStrictEqual(value, expected)) {
    fail(
      "EXPECTED_INPUT_MISMATCH",
      "expected-input-validation",
      "containment-v2 evidence differs from its verified replay inputs",
    );
  }
}

function verificationInput(input) {
  const value = exactOwnDataEnvelope(
    input,
    ["bytes", "expected"],
    "containment-v2 verification input",
  );
  return nullRecord([
    [
      "bytes",
      copyBoundedBuffer(
        value.bytes,
        G17_NON_TMPFS_CONTAINMENT_V2_MAX_BYTES,
        "containment-v2 artifact bytes",
        {
          allowEmpty: false,
          shapeCode: "CANONICAL_ARTIFACT_INVALID",
          boundCode: "CANONICAL_ARTIFACT_INVALID",
        },
      ),
    ],
    ["expected", value.expected],
  ]);
}

export function verifyG17NonTmpfsContainmentV2Artifact(input) {
  return boundary("containment-v2-verification", () => {
    const envelope = verificationInput(input);
    const expected = buildEvidence(envelope.expected);
    const evidence = decodeCanonicalEvidence(envelope.bytes);
    validateSealedEvidence(evidence, expected);
    deepFreeze(evidence);
    const identity = identityFor(evidence, envelope.bytes);
    return projectionFor(evidence, identity);
  });
}
