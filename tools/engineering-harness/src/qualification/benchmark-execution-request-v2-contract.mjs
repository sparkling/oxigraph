import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "./benchmark-execution-plan.mjs";
import {
  G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_LIMITS,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
  createG17NonTmpfsBuildIsolationV2PolicyArtifact,
} from "./non-tmpfs-build-isolation-v2-contract.mjs";

// This is an authority-free serializer and verifier for a future co-located
// physical issuer. It performs no I/O, starts no helper or process, applies no
// containment, retries nothing, and cannot observe execveat. Structural policy
// compatibility is deliberately not physical launch eligibility or evidence.

export const G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA =
  "oxigraph.g1.7-benchmark-execution-request/v2";
export const G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA =
  "oxigraph.g1.7-benchmark-execution-request-projection/v2";
export const G17_BENCHMARK_EXECUTION_REQUEST_V2_ARTIFACT_NAME =
  "benchmark-execution-request-v2.json";
export const G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES = 2 * 1024 * 1024;
export const G17_BENCHMARK_EXECUTION_REQUEST_V2_CARGO_LAUNCH_MECHANISM =
  "execveat-held-fd-empty-path/v1";

// ADR-160's bounded-loop rule is applied here as a finite termination
// vocabulary: every failure terminates once with one typed code. There is no
// implicit retry, fallback launch path, or open-ended recovery state.
export const G17_BENCHMARK_EXECUTION_REQUEST_V2_ERROR_CODES = Object.freeze([
  "INPUT_SHAPE_INVALID",
  "LIMIT_EXCEEDED",
  "IDENTITY_INVALID",
  "POLICY_BINDING_DRIFT",
  "COMMAND_CONTRACT_DRIFT",
  "COMPATIBILITY_DRIFT",
  "CANONICAL_ARTIFACT_INVALID",
  "CONTENT_HASH_MISMATCH",
  "AUTHORITY_OVERCLAIM",
  "EXPECTED_INPUT_MISMATCH",
  "DEPENDENCY_UNCERTAIN",
]);

const ERROR_CODE_SET = new Set(G17_BENCHMARK_EXECUTION_REQUEST_V2_ERROR_CODES);

export class G17BenchmarkExecutionRequestV2ContractError extends Error {
  constructor(code, phase, message, options = undefined) {
    if (!ERROR_CODE_SET.has(code)) {
      throw new TypeError("unknown G1.7 request-v2 contract error code");
    }
    super(
      `G1.7 benchmark execution request v2 contract: [${code}] ${phase}: ${message}`,
      options,
    );
    this.name = "G17BenchmarkExecutionRequestV2ContractError";
    this.code = code;
    this.phase = phase;
  }
}

const CONTROL_AUTHORIZATION_SCHEMA = "oxigraph.g1.7-control-authorization/v3";
const SOURCE_PROJECTION_SCHEMA = "oxigraph.g1.7-product-source-projection/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const WORKSPACE_GENERATION = /^g17-workspace-[0-9a-f]{64}$/u;
const TARGET_GENERATION = /^g17-target-[0-9a-f]{64}$/u;
const OWNER_GENERATION = /^g17-owner-[0-9a-f]{64}$/u;
const PROCESS_GENERATION = /^g17-process-[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const PRODUCT_ROLE = /^(?:negativeControl|performanceReference|noiseControl)$/u;
const MAX_DEPTH = 64;
const MAX_NODES = 32_768;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_PROPERTIES = 4_097;
const MAX_STRING_BYTES = G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const MAX_POSIX_MODE = 0o177777;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectKeys = Object.keys;
const objectEntries = Object.entries;
const reflectOwnKeys = Reflect.ownKeys;
const bufferPrototype = Buffer.prototype;
const bufferIsBuffer = Buffer.isBuffer.bind(Buffer);
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferByteLength = Buffer.byteLength.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const bufferEquals = Buffer.prototype.equals;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(code, phase, message, cause = undefined) {
  throw new G17BenchmarkExecutionRequestV2ContractError(
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
    if (error instanceof G17BenchmarkExecutionRequestV2ContractError) {
      throw error;
    }
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
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
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
    typeof value !== "object" ||
    value === null ||
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
        fail(shapeCode, phase, `${label}.${key} is not an own data property`);
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
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ];
      if (!isDeepStrictEqual([...keys].sort(), expectedKeys.sort())) {
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

function decimal(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || value.length > 32 || !DECIMAL.test(value)) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} is not a bounded canonical decimal`,
    );
  }
  const number = BigInt(value);
  if (positive ? number < 1n : number < 0n) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} is outside its range`,
    );
  }
  return value;
}

function safeInteger(
  value,
  label,
  { positive = false, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < (positive ? 1 : 0) ||
    value > maximum
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} is outside its integer range`,
    );
  }
  return value;
}

function validateAuthorization(value) {
  exactKeys(
    value,
    ["schema", "rawSha256", "contentHash"],
    "authorization binding",
  );
  if (value.schema !== CONTROL_AUTHORIZATION_SCHEMA) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "authorization schema drifted",
    );
  }
  digest(value.rawSha256, "authorization rawSha256");
  digest(value.contentHash, "authorization contentHash");
}

function validateSource(value) {
  exactKeys(
    value,
    [
      "rawSha256",
      "contentHash",
      "controlRunId",
      "buildId",
      "productRole",
      "workspaceGeneration",
      "targetGeneration",
    ],
    "source binding",
  );
  digest(value.rawSha256, "source rawSha256");
  digest(value.contentHash, "source contentHash");
  safeId(value.controlRunId, "source controlRunId");
  safeId(value.buildId, "source buildId");
  if (!PRODUCT_ROLE.test(value.productRole ?? "")) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "source productRole is not reviewed",
    );
  }
  if (!WORKSPACE_GENERATION.test(value.workspaceGeneration ?? "")) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "workspace generation is not canonical",
    );
  }
  if (!TARGET_GENERATION.test(value.targetGeneration ?? "")) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "target generation is not canonical",
    );
  }
}

function validateFileIdentity(value, label) {
  exactKeys(
    value,
    ["device", "inode", "uid", "gid", "mode", "nlink", "size"],
    label,
  );
  decimal(value.device, `${label} device`, { positive: true });
  decimal(value.inode, `${label} inode`, { positive: true });
  decimal(value.uid, `${label} uid`);
  decimal(value.gid, `${label} gid`);
  safeInteger(value.mode, `${label} mode`, {
    positive: true,
    maximum: MAX_POSIX_MODE,
  });
  safeInteger(value.nlink, `${label} nlink`, { positive: true });
  safeInteger(value.size, `${label} size`, { positive: true });
  if ((value.mode & 0o170000) !== 0o100000 || (value.mode & 0o111) === 0) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} is not an executable regular file`,
    );
  }
}

function validatePlatformTool(value, label, logicalPath) {
  exactKeys(value, ["logicalPath", "sha256", "identity"], label);
  if (value.logicalPath !== logicalPath) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      `${label} logical path drifted`,
    );
  }
  digest(value.sha256, `${label} sha256`);
  validateFileIdentity(value.identity, `${label} identity`);
  return value;
}

function validatePlatform(value) {
  exactKeys(
    value,
    ["platformRootSha256", "toolchainRootSha256", "cargo", "rustc"],
    "platform binding",
  );
  digest(value.platformRootSha256, "platform root sha256");
  digest(value.toolchainRootSha256, "toolchain root sha256");
  const cargo = validatePlatformTool(
    value.cargo,
    "Cargo platform identity",
    G17_BENCHMARK_EXECUTION_PLAN.build.launcher.cargoLogicalPath,
  );
  const rustc = validatePlatformTool(
    value.rustc,
    "rustc platform identity",
    G17_BENCHMARK_EXECUTION_PLAN.build.launcher.rustcLogicalPath,
  );
  if (
    `${cargo.identity.device}:${cargo.identity.inode}` ===
      `${rustc.identity.device}:${rustc.identity.inode}` ||
    cargo.sha256 === rustc.sha256
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "Cargo and rustc platform identities alias",
    );
  }
}

function validateOwnership(value) {
  exactKeys(
    value,
    ["ownerGeneration", "processGeneration", "ordinal"],
    "request ownership",
  );
  if (!OWNER_GENERATION.test(value.ownerGeneration ?? "")) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "owner generation is not canonical",
    );
  }
  if (!PROCESS_GENERATION.test(value.processGeneration ?? "")) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "process generation is not canonical",
    );
  }
  safeInteger(value.ordinal, "process ordinal", {
    positive: true,
    maximum: G17_BENCHMARK_BUILD_PLAN.length,
  });
}

function validateInput(input) {
  const value = snapshotOwnData(input, "execution request v2 input");
  exactKeys(
    value,
    [
      "controlRunId",
      "buildId",
      "productRole",
      "authorization",
      "source",
      "platform",
      "ownership",
    ],
    "execution request v2 input",
  );
  safeId(value.controlRunId, "controlRunId");
  safeId(value.buildId, "buildId");
  if (!PRODUCT_ROLE.test(value.productRole ?? "")) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "productRole is not reviewed",
    );
  }
  validateAuthorization(value.authorization);
  validateSource(value.source);
  validatePlatform(value.platform);
  validateOwnership(value.ownership);
  const expectedBuild = G17_BENCHMARK_BUILD_PLAN[value.ownership.ordinal - 1];
  if (
    value.buildId !== expectedBuild?.buildId ||
    value.productRole !== expectedBuild?.productRole ||
    value.source.controlRunId !== value.controlRunId ||
    value.source.buildId !== value.buildId ||
    value.source.productRole !== value.productRole
  ) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "source or build identity does not match the request and frozen ordinal",
    );
  }
  return value;
}

function cloneConstant(value, label) {
  return snapshotOwnData(value, label, "DEPENDENCY_UNCERTAIN");
}

const policyBundle = boundary("policy-v2-initialization", () =>
  createG17NonTmpfsBuildIsolationV2PolicyArtifact(),
);
const policy = policyBundle.policy;

boundary("policy-v2-binding", () => {
  if (
    policy.schema !== G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA ||
    policy.fileDescriptors.sha256 !== undefined ||
    canonicalSha256(policy.fileDescriptors) !==
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256 ||
    policy.statusProtocol.requirementsSha256 !==
      G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256 ||
    policy.helper.attestation.bindingRequirements.fileDescriptorMapSha256 !==
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256 ||
    policy.helper.attestation.bindingRequirements
      .statusProtocolRequirementsSha256 !==
      G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256 ||
    policy.cargoTransition.mechanism !==
      G17_BENCHMARK_EXECUTION_REQUEST_V2_CARGO_LAUNCH_MECHANISM
  ) {
    fail(
      "DEPENDENCY_UNCERTAIN",
      "policy-v2-binding",
      "policy v2 exports are not internally self-consistent",
    );
  }
});

export const G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS = deepFreeze(
  cloneConstant(
    G17_NON_TMPFS_BUILD_ISOLATION_V2_LIMITS,
    "frozen request v2 limits",
  ),
);

export const G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY = deepFreeze(
  nullRecord([
    ["buildExecutionAuthority", false],
    ["launchExecutionAuthority", false],
    ["controlExecutionAuthority", false],
    ["qualificationExecutionAuthority", false],
    ["receiptAuthority", false],
    ["promotionAuthority", false],
    ["publicationAuthority", false],
    ["routerQualityAuthority", false],
    ["providerExecutionAuthority", false],
    ["helperExecutionAuthority", false],
    ["cargoExecutionAuthority", false],
    ["containmentExecutionAuthority", false],
    ["physicalIssuanceAuthority", false],
  ]),
);

export const G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS = deepFreeze(
  nullRecord([
    ["physicalOwnerIssued", false],
    ["privatePhysicalIssuerImplemented", false],
    ["nativeHelperImplemented", false],
    ["helperAttestationObserved", false],
    ["helperInitialLaunchObserved", false],
    ["helperDescriptorMapObserved", false],
    ["helperCloexecTransitionObserved", false],
    ["helperStatusProtocolObserved", false],
    ["cargoExecveatObserved", false],
    ["cargoExecutionObserved", false],
    ["rustcExecutionObserved", false],
    ["containmentV2Implemented", false],
    ["nativeContainmentAdapterImplemented", false],
    ["containmentApplied", false],
    ["clone3CgroupPlacementObserved", false],
    ["directChildPidfdWaitidAttested", false],
    ["cgroupQuiescenceObserved", false],
    ["serializedRequestProvesPhysicalLaunch", false],
    ["controlAuthorizationApproved", false],
  ]),
);

export const G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING = deepFreeze(
  nullRecord([
    ["schema", G17_NON_TMPFS_BUILD_ISOLATION_V2_POLICY_SCHEMA],
    ["rawSha256", policyBundle.artifact.sha256],
    ["contentHash", policy.sha256],
    ["status", policy.status],
    ["requirementMode", policy.requirementMode],
    [
      "fileDescriptorsSha256",
      G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256,
    ],
    [
      "statusProtocol",
      deepFreeze(
        nullRecord([
          ["schema", policy.statusProtocol.schema],
          [
            "requirementsSha256",
            G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
          ],
        ]),
      ),
    ],
    ["requiredContainmentSchema", policy.containment.requiredSuccessorSchema],
  ]),
);

export const G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY =
  deepFreeze(
    nullRecord([
      ["status", "POLICY_V2_BOUND_PRIVATE_ISSUER_REQUIRED"],
      ["compatibilityScope", "STRUCTURAL_POLICY_ONLY"],
      ["boundIsolationPolicySchema", policy.schema],
      ["currentPolicyCompatible", true],
      ["structurallyLaunchable", true],
      ["physicalLaunchEligible", false],
      ["privatePhysicalIssuerRequired", true],
      ["helperAttestationRequired", true],
      ["nativeContainmentAdapterRequired", true],
      ["requiredContainmentSchema", policy.containment.requiredSuccessorSchema],
      ["launchBeforePrivateIssuerForbidden", true],
    ]),
  );

const EXECUTION_PLAN_BINDING = deepFreeze(
  nullRecord([
    ["schema", G17_BENCHMARK_EXECUTION_PLAN_SCHEMA],
    ["sha256", G17_BENCHMARK_EXECUTION_PLAN_SHA256],
    [
      "environmentRecipe",
      deepFreeze(
        nullRecord([
          ["schema", G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA],
          ["sha256", G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256],
        ]),
      ),
    ],
  ]),
);

function aggregateArgvUtf8Bytes(argv0, argv) {
  return [argv0, ...argv].reduce(
    (sum, argument) => sum + bufferByteLength(argument, "utf8"),
    0,
  );
}

function commandContract() {
  const argv = cloneConstant(G17_BENCHMARK_BUILD_ARGV, "frozen build argv");
  const argv0 = G17_BENCHMARK_BUILD_PROGRAM;
  const aggregateBytes = aggregateArgvUtf8Bytes(argv0, argv);
  const argc = argv.length + 1;
  if (
    argc > G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS.argcMaximum ||
    aggregateBytes >
      G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS.aggregateArgvUtf8MaximumBytes
  ) {
    fail(
      "LIMIT_EXCEEDED",
      "command-construction",
      "frozen command exceeds the policy-v2 argc or argv byte ceiling",
    );
  }
  return deepFreeze(
    nullRecord([
      [
        "launcher",
        nullRecord([
          ["implementation", policy.helper.implementation],
          ["sourceLogicalName", policy.helper.sourceLogicalName],
          ["executableLogicalName", policy.helper.executableLogicalName],
          ["attestationSchema", policy.helper.attestation.schema],
          [
            "initialLaunch",
            cloneConstant(
              policy.helper.initialLaunch,
              "policy helper initial launch",
            ),
          ],
        ]),
      ],
      [
        "cargoTransition",
        nullRecord([
          ["availability", "STRUCTURALLY_LAUNCHABLE_REQUIREMENTS_ONLY"],
          ...objectEntries(
            cloneConstant(policy.cargoTransition, "policy Cargo transition"),
          ),
          ["execStatusPipeWriterDescriptor", policy.statusProtocol.writerFd],
          ["execStatusPipeReaderRole", policy.statusProtocol.readerRole],
        ]),
      ],
      [
        "descriptorContract",
        nullRecord([
          ["sha256", G17_NON_TMPFS_BUILD_ISOLATION_V2_FILE_DESCRIPTORS_SHA256],
          [
            "imageMaps",
            cloneConstant(
              policy.fileDescriptors.imageMaps,
              "policy descriptor image maps",
            ),
          ],
        ]),
      ],
      [
        "statusProtocol",
        nullRecord([
          ["schema", policy.statusProtocol.schema],
          [
            "requirementsSha256",
            G17_NON_TMPFS_BUILD_ISOLATION_V2_STATUS_PROTOCOL_REQUIREMENTS_SHA256,
          ],
          ["writerFd", policy.statusProtocol.writerFd],
          ["readerRole", policy.statusProtocol.readerRole],
          ["maximumBytes", policy.statusProtocol.maximumBytes],
          ["maximumFrames", policy.statusProtocol.maximumFrames],
          ["timeoutMilliseconds", policy.statusProtocol.timeoutMilliseconds],
        ]),
      ],
      ["program", G17_BENCHMARK_BUILD_PROGRAM],
      ["argv0", argv0],
      ["argv", argv],
      ["argc", argc],
      ["aggregateArgvUtf8Bytes", aggregateBytes],
      [
        "environment",
        cloneConstant(
          G17_BENCHMARK_BUILD_ENVIRONMENT,
          "frozen build environment",
        ),
      ],
      ["environmentSha256", G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256],
      ["cwd", G17_BENCHMARK_EXECUTION_PLAN.build.workingDirectory],
      ["targetDirectory", G17_BENCHMARK_EXECUTION_PLAN.build.targetDirectory],
    ]),
  );
}

export const G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND = commandContract();

function buildRequest(input) {
  const value = validateInput(input);
  const unsigned = nullRecord([
    ["schema", G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA],
    ["controlRunId", value.controlRunId],
    ["buildId", value.buildId],
    ["productRole", value.productRole],
    ["authorization", value.authorization],
    [
      "executionPlan",
      cloneConstant(EXECUTION_PLAN_BINDING, "execution plan binding"),
    ],
    [
      "isolationPolicy",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
        "policy v2 binding",
      ),
    ],
    [
      "source",
      nullRecord([
        ["schema", SOURCE_PROJECTION_SCHEMA],
        ...objectEntries(value.source),
      ]),
    ],
    ["platform", value.platform],
    ["ownership", value.ownership],
    [
      "launchCompatibility",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY,
        "launch compatibility",
      ),
    ],
    [
      "command",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND,
        "command contract",
      ),
    ],
    [
      "limits",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS,
        "request limits",
      ),
    ],
    [
      "nonclaims",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
        "request nonclaims",
      ),
    ],
    [
      "authority",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
        "request authority",
      ),
    ],
    ["binding", null],
    ["finalDecisionEligible", false],
  ]);
  return deepFreeze(
    nullRecord([
      ...objectEntries(unsigned),
      ["contentHash", canonicalSha256(unsigned)],
    ]),
  );
}

function canonicalRequestBytes(request) {
  let bytes;
  try {
    bytes = bufferFrom(`${canonicalJson(request)}\n`, "utf8");
  } catch (error) {
    fail(
      "DEPENDENCY_UNCERTAIN",
      "canonical-encoding",
      "request cannot be encoded canonically",
      error,
    );
  }
  if (
    bytes.length < 2 ||
    bytes.length > G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES
  ) {
    fail(
      "LIMIT_EXCEEDED",
      "canonical-encoding",
      "request artifact exceeds its byte ceiling",
    );
  }
  return bytes;
}

function intrinsicBufferCopy(value) {
  const length = typedArrayLengthGetter.call(value);
  const copied = bufferAllocUnsafe(length);
  typedArraySet.call(copied, value);
  return copied;
}

function artifactEnvelope(bytes) {
  const stored = intrinsicBufferCopy(bytes);
  const artifact = Object.create(null);
  Object.defineProperties(artifact, {
    name: {
      value: G17_BENCHMARK_EXECUTION_REQUEST_V2_ARTIFACT_NAME,
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
  return Object.freeze(artifact);
}

function identityFor(request, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA],
      ["rawSha256", sha256(bytes)],
      ["contentHash", request.contentHash],
    ]),
  );
}

function projectionFor(request, identity) {
  return deepFreeze(
    nullRecord([
      ["schema", G17_BENCHMARK_EXECUTION_REQUEST_V2_PROJECTION_SCHEMA],
      ["requestSchema", identity.schema],
      ["rawSha256", identity.rawSha256],
      ["contentHash", identity.contentHash],
      ["controlRunId", request.controlRunId],
      ["buildId", request.buildId],
      ["productRole", request.productRole],
      ["processGeneration", request.ownership.processGeneration],
      ["ordinal", request.ownership.ordinal],
      ["targetGeneration", request.source.targetGeneration],
      [
        "isolationPolicy",
        cloneConstant(request.isolationPolicy, "projection policy binding"),
      ],
      ["status", request.launchCompatibility.status],
      ["compatibilityScope", request.launchCompatibility.compatibilityScope],
      ["currentPolicyCompatible", true],
      ["structurallyLaunchable", true],
      ["physicalLaunchEligible", false],
      ["binding", null],
      ["finalDecisionEligible", false],
      ["nonclaims", cloneConstant(request.nonclaims, "projection nonclaims")],
      ["authority", cloneConstant(request.authority, "projection authority")],
    ]),
  );
}

export function createG17BenchmarkExecutionRequestV2Artifact(input) {
  return boundary("request-creation", () => {
    const request = buildRequest(input);
    const bytes = canonicalRequestBytes(request);
    const identity = identityFor(request, bytes);
    return Object.freeze(
      nullRecord([
        ["request", request],
        ["identity", identity],
        ["projection", projectionFor(request, identity)],
        ["artifact", artifactEnvelope(bytes)],
      ]),
    );
  });
}

function copyBoundedBuffer(
  value,
  maximum,
  label,
  { allowEmpty = true, boundCode = "CANONICAL_ARTIFACT_INVALID" } = {},
) {
  const phase = "artifact-buffer-validation";
  let prototype;
  try {
    prototype =
      value !== null && typeof value === "object"
        ? objectGetPrototypeOf(value)
        : undefined;
  } catch (error) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} prototype cannot be inspected`,
      error,
    );
  }
  if (
    !bufferIsBuffer(value) ||
    types.isProxy(value) ||
    prototype !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} must be an exact non-Proxy Buffer`,
    );
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch (error) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} length cannot be read intrinsically`,
      error,
    );
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
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      `${label} cannot be copied intrinsically`,
      error,
    );
  }
}

function verificationInput(input) {
  const phase = "verification-envelope";
  if (input !== null && typeof input === "object" && types.isProxy(input)) {
    fail("INPUT_SHAPE_INVALID", phase, "verification input contains a Proxy");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      "verification input must be a plain own-data record",
    );
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(input);
    descriptors = objectGetOwnPropertyDescriptors(input);
  } catch (error) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      "verification input cannot be inspected",
      error,
    );
  }
  if (prototype !== objectPrototype && prototype !== null) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      "verification input contains a foreign prototype",
    );
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), ["bytes", "expected"])
  ) {
    fail(
      "INPUT_SHAPE_INVALID",
      phase,
      "verification input fields are not exact",
    );
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
      fail(
        "INPUT_SHAPE_INVALID",
        phase,
        `verification input ${key} is not enumerable own data`,
      );
    }
  }
  return nullRecord([
    [
      "bytes",
      copyBoundedBuffer(
        descriptors.bytes.value,
        G17_BENCHMARK_EXECUTION_REQUEST_V2_MAX_BYTES,
        "request v2 artifact",
        { allowEmpty: false },
      ),
    ],
    ["expected", descriptors.expected.value],
  ]);
}

function decodeCanonicalRequest(bytes) {
  const phase = "canonical-decoding";
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "request artifact is not UTF-8",
      error,
    );
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "request artifact must be one LF-terminated JSON value",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "request artifact is invalid JSON",
      error,
    );
  }
  const request = snapshotOwnData(
    parsed,
    "execution request v2 document",
    "CANONICAL_ARTIFACT_INVALID",
  );
  let expectedBytes;
  try {
    expectedBytes = canonicalRequestBytes(request);
  } catch (error) {
    if (
      error instanceof G17BenchmarkExecutionRequestV2ContractError &&
      error.code === "LIMIT_EXCEEDED"
    ) {
      fail("CANONICAL_ARTIFACT_INVALID", phase, error.message, error);
    }
    throw error;
  }
  if (!bufferEquals.call(bytes, expectedBytes)) {
    fail(
      "CANONICAL_ARTIFACT_INVALID",
      phase,
      "request artifact is not canonical JSON plus one LF",
    );
  }
  return request;
}

function sourceInputFromRequest(request) {
  exactKeys(
    request.source,
    [
      "schema",
      "rawSha256",
      "contentHash",
      "controlRunId",
      "buildId",
      "productRole",
      "workspaceGeneration",
      "targetGeneration",
    ],
    "request source projection",
  );
  if (request.source.schema !== SOURCE_PROJECTION_SCHEMA) {
    fail(
      "IDENTITY_INVALID",
      "identity-validation",
      "source projection schema drifted",
    );
  }
  return nullRecord(
    objectEntries(request.source).filter(([key]) => key !== "schema"),
  );
}

function validateSealedRequest(request) {
  exactKeys(
    request,
    [
      "schema",
      "controlRunId",
      "buildId",
      "productRole",
      "authorization",
      "executionPlan",
      "isolationPolicy",
      "source",
      "platform",
      "ownership",
      "launchCompatibility",
      "command",
      "limits",
      "nonclaims",
      "authority",
      "binding",
      "finalDecisionEligible",
      "contentHash",
    ],
    "execution request v2 document",
  );
  if (request.schema !== G17_BENCHMARK_EXECUTION_REQUEST_V2_SCHEMA) {
    fail("IDENTITY_INVALID", "identity-validation", "request schema drifted");
  }
  digest(request.contentHash, "request contentHash", "CONTENT_HASH_MISMATCH");
  const unsignedEntries = objectEntries(request).filter(
    ([key]) => key !== "contentHash",
  );
  const unsigned = nullRecord(unsignedEntries);
  if (request.contentHash !== canonicalSha256(unsigned)) {
    fail(
      "CONTENT_HASH_MISMATCH",
      "content-hash-validation",
      "request contentHash does not verify",
    );
  }
  if (
    !isDeepStrictEqual(
      request.isolationPolicy,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_POLICY_BINDING,
    )
  ) {
    fail(
      "POLICY_BINDING_DRIFT",
      "policy-binding-validation",
      "request policy-v2 binding drifted",
    );
  }
  if (
    !isDeepStrictEqual(
      request.launchCompatibility,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_LAUNCH_COMPATIBILITY,
    )
  ) {
    fail(
      "COMPATIBILITY_DRIFT",
      "compatibility-validation",
      "request launch compatibility drifted",
    );
  }
  if (
    !isDeepStrictEqual(
      request.authority,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_AUTHORITY,
    ) ||
    !isDeepStrictEqual(
      request.nonclaims,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_NONCLAIMS,
    ) ||
    request.binding !== null ||
    request.finalDecisionEligible !== false
  ) {
    fail(
      "AUTHORITY_OVERCLAIM",
      "authority-validation",
      "request overclaims authority, observations, binding, or eligibility",
    );
  }
  if (
    !isDeepStrictEqual(request.executionPlan, EXECUTION_PLAN_BINDING) ||
    !isDeepStrictEqual(
      request.command,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_COMMAND,
    )
  ) {
    fail(
      "COMMAND_CONTRACT_DRIFT",
      "command-validation",
      "request command or execution plan drifted",
    );
  }
  if (
    !isDeepStrictEqual(
      request.limits,
      G17_BENCHMARK_EXECUTION_REQUEST_V2_LIMITS,
    )
  ) {
    fail(
      "LIMIT_EXCEEDED",
      "limit-validation",
      "request limits differ from policy-v2 bounds",
    );
  }
  validateInput(
    nullRecord([
      ["controlRunId", request.controlRunId],
      ["buildId", request.buildId],
      ["productRole", request.productRole],
      ["authorization", request.authorization],
      ["source", sourceInputFromRequest(request)],
      ["platform", request.platform],
      ["ownership", request.ownership],
    ]),
  );
}

export function verifyG17BenchmarkExecutionRequestV2Artifact(input) {
  return boundary("request-verification", () => {
    const envelope = verificationInput(input);
    const expected = buildRequest(envelope.expected);
    const request = decodeCanonicalRequest(envelope.bytes);
    validateSealedRequest(request);
    if (!bufferEquals.call(envelope.bytes, canonicalRequestBytes(expected))) {
      fail(
        "EXPECTED_INPUT_MISMATCH",
        "expected-input-validation",
        "request differs from its separately trusted pre-execution inputs",
      );
    }
    deepFreeze(request);
    const identity = identityFor(request, envelope.bytes);
    return Object.freeze(
      nullRecord([
        ["request", request],
        ["identity", identity],
        ["projection", projectionFor(request, identity)],
      ]),
    );
  });
}
