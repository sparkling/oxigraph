import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_LAUNCHER,
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "./benchmark-execution-plan.mjs";
import {
  G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
  G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
  G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
  createG17NonTmpfsBuildIsolationPolicyArtifact,
} from "./non-tmpfs-build-isolation-contract.mjs";

// This authority-free module freezes the bytes that a future co-located
// physical build owner must create before it performs any native effect. It
// performs no I/O, owns no capability, and cannot launch Cargo. In particular,
// naming execveat below is a required launch contract, not a claim that the
// current Node process can perform or attest that syscall.

export const G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA =
  "oxigraph.g1.7-benchmark-execution-request/v1";
export const G17_BENCHMARK_EXECUTION_REQUEST_ARTIFACT_NAME =
  "benchmark-execution-request.json";
export const G17_BENCHMARK_EXECUTION_REQUEST_MAX_BYTES = 2 * 1024 * 1024;
export const G17_BENCHMARK_EXECUTION_REQUEST_CARGO_LAUNCH_MECHANISM =
  "execveat-held-fd-empty-path/v1";
export const G17_BENCHMARK_EXECUTION_REQUEST_ARGV_MAX_BYTES = 1024 * 1024;
export const G17_BENCHMARK_EXECUTION_REQUEST_TIMEOUT_MS = 300_000;
export const G17_BENCHMARK_EXECUTION_REQUEST_SUCCESSOR_ISOLATION_SCHEMA =
  "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v2";

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
const MAX_STRING_BYTES = G17_BENCHMARK_EXECUTION_REQUEST_MAX_BYTES;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const MAX_POSIX_MODE = 0o177777;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const reflectOwnKeys = Reflect.ownKeys;

function fail(message) {
  throw new Error(`G1.7 benchmark execution request contract: ${message}`);
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
  ancestors = new WeakSet(),
  depth = 0,
  budget = { nodes: 0, strings: 0 },
) {
  if (value !== null && typeof value === "object" && types.isProxy(value)) {
    fail(`${label} contains a Proxy`);
  }
  if (depth > MAX_DEPTH) fail(`${label} exceeds the depth limit`);
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) fail(`${label} exceeds the node limit`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.strings += bytes;
    if (bytes > MAX_SINGLE_STRING_BYTES || budget.strings > MAX_STRING_BYTES) {
      fail(`${label} exceeds the string budget`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} is not finite`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    ArrayBuffer.isView(value)
  ) {
    fail(`${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) fail(`${label} contains a cycle`);
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    fail(`${label} prototype cannot be inspected: ${error.message}`);
  }
  const array = Array.isArray(value);
  if (
    prototype !== (array ? arrayPrototype : objectPrototype) &&
    !(prototype === null && !array)
  ) {
    fail(`${label} contains a foreign prototype`);
  }
  ancestors.add(value);
  try {
    let descriptors;
    try {
      descriptors = objectGetOwnPropertyDescriptors(value);
    } catch (error) {
      fail(`${label} properties cannot be inspected: ${error.message}`);
    }
    const keys = reflectOwnKeys(descriptors);
    if (
      keys.length > MAX_PROPERTIES ||
      keys.some((key) => typeof key !== "string")
    ) {
      fail(`${label} exceeds its property budget or contains symbols`);
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      budget.strings += Buffer.byteLength(key, "utf8");
      if (budget.strings > MAX_STRING_BYTES) {
        fail(`${label} exceeds the key budget`);
      }
      if (!("value" in descriptor)) {
        fail(`${label}.${key} is not an own data property`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_ARRAY_LENGTH
      ) {
        fail(`${label} is not a bounded dense array`);
      }
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ];
      if (!isDeepStrictEqual([...keys].sort(), expectedKeys.sort())) {
        fail(`${label} is not a field-free dense array`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotOwnData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          ancestors,
          depth + 1,
          budget,
        ),
      );
    }
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) fail(`${label}.${key} is not enumerable`);
      output[key] = snapshotOwnData(
        descriptor.value,
        `${label}.${key}`,
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

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function safeId(value, label) {
  if (!SAFE_ID.test(value ?? "")) fail(`${label} is not a safe identifier`);
  return value;
}

function decimal(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || value.length > 32 || !DECIMAL.test(value)) {
    fail(`${label} is not a bounded canonical decimal`);
  }
  const number = BigInt(value);
  if (positive ? number < 1n : number < 0n) {
    fail(`${label} is outside its range`);
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
    fail(`${label} is outside its integer range`);
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
    fail("authorization schema drifted");
  }
  digest(value.rawSha256, "authorization rawSha256");
  digest(value.contentHash, "authorization contentHash");
  return value;
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
    fail("source productRole is not reviewed");
  }
  if (!WORKSPACE_GENERATION.test(value.workspaceGeneration ?? "")) {
    fail("workspace generation is not canonical");
  }
  if (!TARGET_GENERATION.test(value.targetGeneration ?? "")) {
    fail("target generation is not canonical");
  }
  return value;
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
    fail(`${label} is not an executable regular file`);
  }
  return value;
}

function validatePlatformTool(value, label, logicalPath) {
  exactKeys(value, ["logicalPath", "sha256", "identity"], label);
  if (value.logicalPath !== logicalPath) fail(`${label} logical path drifted`);
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
    G17_BENCHMARK_BUILD_LAUNCHER.cargoLogicalPath,
  );
  const rustc = validatePlatformTool(
    value.rustc,
    "rustc platform identity",
    G17_BENCHMARK_BUILD_LAUNCHER.rustcLogicalPath,
  );
  if (
    `${cargo.identity.device}:${cargo.identity.inode}` ===
      `${rustc.identity.device}:${rustc.identity.inode}` ||
    cargo.sha256 === rustc.sha256
  ) {
    fail("Cargo and rustc platform identities alias");
  }
  return value;
}

function validateOwnership(value) {
  exactKeys(
    value,
    ["ownerGeneration", "processGeneration", "ordinal"],
    "request ownership",
  );
  if (!OWNER_GENERATION.test(value.ownerGeneration ?? "")) {
    fail("owner generation is not canonical");
  }
  if (!PROCESS_GENERATION.test(value.processGeneration ?? "")) {
    fail("process generation is not canonical");
  }
  safeInteger(value.ordinal, "process ordinal", {
    positive: true,
    maximum: G17_BENCHMARK_BUILD_PLAN.length,
  });
  return value;
}

function validateInput(input) {
  const value = snapshotOwnData(input, "execution request input");
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
    "execution request input",
  );
  safeId(value.controlRunId, "controlRunId");
  safeId(value.buildId, "buildId");
  if (!PRODUCT_ROLE.test(value.productRole ?? "")) {
    fail("productRole is not reviewed");
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
      "source or build identity does not match the request and frozen ordinal",
    );
  }
  return value;
}

const isolation = createG17NonTmpfsBuildIsolationPolicyArtifact();
const requiredFileDescriptorMap =
  isolation.policy.process.stdio.inheritedFileDescriptors;

export const G17_BENCHMARK_EXECUTION_REQUEST_LIMITS = deepFreeze(
  nullRecord([
    ["timeoutMilliseconds", G17_BENCHMARK_EXECUTION_REQUEST_TIMEOUT_MS],
    ["combinedOutputMaximumBytes", G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES],
    ["termGraceMilliseconds", G17_NON_TMPFS_BUILD_TERM_GRACE_MS],
    ["closeReapTimeoutMilliseconds", G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS],
    [
      "aggregateArgvUtf8MaximumBytes",
      G17_BENCHMARK_EXECUTION_REQUEST_ARGV_MAX_BYTES,
    ],
  ]),
);

export const G17_BENCHMARK_EXECUTION_REQUEST_AUTHORITY = deepFreeze(
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
  ]),
);

export const G17_BENCHMARK_EXECUTION_REQUEST_NONCLAIMS = deepFreeze(
  nullRecord([
    ["physicalOwnerIssued", false],
    ["currentNodeExecveatAdapterImplemented", false],
    ["boundIsolationPolicySupportsRequiredLauncherDescriptors", false],
    ["cargoExecutionObserved", false],
    ["rustcExecutionObserved", false],
    ["containmentApplied", false],
    ["directChildReaped", false],
    ["cgroupQuiescenceObserved", false],
  ]),
);

// Policy v1 permits only the Cargo-image inherited descriptors 3/4/5 and
// forbids extras. A real execveat launcher additionally needs a held Cargo fd
// and a close-on-exec status-pipe writer before the image transition. They are
// launcher-private rather than Cargo-image inherited descriptors, but policy
// v1 does not model that distinction. Treating the existing map as sufficient
// would therefore be an authority overclaim. This explicit incompatibility is
// cycle-free: request v1 binds policy v1 and names the capabilities a future
// policy v2 must freeze; it does not attempt to mint or depend on policy v2.
export const G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY = deepFreeze(
  nullRecord([
    ["status", "SUCCESSOR_ISOLATION_POLICY_REQUIRED"],
    ["boundIsolationPolicySchema", G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA],
    [
      "requiredSuccessorPolicySchema",
      G17_BENCHMARK_EXECUTION_REQUEST_SUCCESSOR_ISOLATION_SCHEMA,
    ],
    ["currentPolicyCompatible", false],
    ["physicalLaunchEligible", false],
    ["launchBeforeSuccessorPolicyForbidden", true],
    [
      "requiredCapabilities",
      deepFreeze([
        "launcher-private-held-cargo-fd-cloexec",
        "launcher-private-exec-status-pipe-writer-cloexec",
        "exact-launcher-private-vs-cargo-image-inherited-fd-separation",
      ]),
    ],
  ]),
);

function cloneConstant(value, label) {
  return snapshotOwnData(value, label);
}

function buildRequest(input) {
  const value = validateInput(input);
  const argv = cloneConstant(G17_BENCHMARK_BUILD_ARGV, "frozen build argv");
  // `G17_BENCHMARK_BUILD_ARGV` is the post-argv[0] argument vector used by the
  // existing plan. execveat still requires an explicit argv[0], so the request
  // freezes it separately and counts it in the same aggregate ceiling.
  const argv0 = G17_BENCHMARK_BUILD_PROGRAM;
  const aggregateArgvBytes = [argv0, ...argv].reduce(
    (sum, argument) => sum + Buffer.byteLength(argument, "utf8"),
    0,
  );
  if (
    aggregateArgvBytes >
    G17_BENCHMARK_EXECUTION_REQUEST_LIMITS.aggregateArgvUtf8MaximumBytes
  ) {
    fail("frozen argv exceeds its fixed aggregate byte ceiling");
  }
  const unsigned = nullRecord([
    ["schema", G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA],
    ["controlRunId", value.controlRunId],
    ["buildId", value.buildId],
    ["productRole", value.productRole],
    ["authorization", value.authorization],
    [
      "executionPlan",
      nullRecord([
        ["schema", G17_BENCHMARK_EXECUTION_PLAN_SCHEMA],
        ["sha256", G17_BENCHMARK_EXECUTION_PLAN_SHA256],
        [
          "environmentRecipe",
          nullRecord([
            ["schema", G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA],
            ["sha256", G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256],
          ]),
        ],
      ]),
    ],
    [
      "isolationPolicy",
      nullRecord([
        ["schema", G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA],
        ["rawSha256", isolation.artifact.sha256],
        ["contentHash", isolation.policy.sha256],
      ]),
    ],
    [
      "source",
      nullRecord([
        ["schema", SOURCE_PROJECTION_SCHEMA],
        ...Object.entries(value.source),
      ]),
    ],
    ["platform", value.platform],
    ["ownership", value.ownership],
    [
      "launchCompatibility",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY,
        "frozen launch compatibility",
      ),
    ],
    [
      "command",
      nullRecord([
        ["program", G17_BENCHMARK_BUILD_PROGRAM],
        [
          "programExecution",
          nullRecord([
            [
              "mechanism",
              G17_BENCHMARK_EXECUTION_REQUEST_CARGO_LAUNCH_MECHANISM,
            ],
            ["availability", "UNAVAILABLE_UNDER_BOUND_ISOLATION_POLICY"],
            ["emptyPathRequired", true],
            ["pathnameLaunchForbidden", true],
            ["heldExecutableDescriptor", null],
            ["execStatusPipeWriterDescriptor", null],
          ]),
        ],
        ["argv0", argv0],
        ["argv", argv],
        ["aggregateArgvUtf8Bytes", aggregateArgvBytes],
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
        [
          "inheritedFileDescriptors",
          cloneConstant(
            requiredFileDescriptorMap,
            "frozen inherited file-descriptor map",
          ),
        ],
      ]),
    ],
    [
      "limits",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_LIMITS,
        "frozen execution request limits",
      ),
    ],
    [
      "nonclaims",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_NONCLAIMS,
        "frozen execution request nonclaims",
      ),
    ],
    [
      "authority",
      cloneConstant(
        G17_BENCHMARK_EXECUTION_REQUEST_AUTHORITY,
        "frozen execution request authority",
      ),
    ],
    ["binding", null],
    ["finalDecisionEligible", false],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["contentHash", canonicalSha256(unsigned)],
    ]),
  );
}

function canonicalRequestBytes(request) {
  const bytes = Buffer.from(`${canonicalJson(request)}\n`, "utf8");
  if (
    bytes.length < 2 ||
    bytes.length > G17_BENCHMARK_EXECUTION_REQUEST_MAX_BYTES
  ) {
    fail("request artifact exceeds its byte ceiling");
  }
  return bytes;
}

function artifactEnvelope(bytes) {
  const stored = Buffer.from(bytes);
  const artifact = Object.create(null);
  Object.defineProperties(artifact, {
    name: {
      value: G17_BENCHMARK_EXECUTION_REQUEST_ARTIFACT_NAME,
      enumerable: true,
    },
    rawSha256: { value: sha256(stored), enumerable: true },
    bytes: {
      get() {
        return Buffer.from(stored);
      },
      enumerable: true,
    },
  });
  return Object.freeze(artifact);
}

function identityFor(request, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA],
      ["rawSha256", sha256(bytes)],
      ["contentHash", request.contentHash],
    ]),
  );
}

export function createG17BenchmarkExecutionRequestArtifact(input) {
  const request = buildRequest(input);
  const bytes = canonicalRequestBytes(request);
  return Object.freeze(
    nullRecord([
      ["request", request],
      ["identity", identityFor(request, bytes)],
      ["artifact", artifactEnvelope(bytes)],
    ]),
  );
}

function verificationInput(input) {
  if (input !== null && typeof input === "object" && types.isProxy(input)) {
    fail("verification input contains a Proxy");
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("verification input must be a plain own-data record");
  }
  const prototype = objectGetPrototypeOf(input);
  if (prototype !== objectPrototype && prototype !== null) {
    fail("verification input contains a foreign prototype");
  }
  const descriptors = objectGetOwnPropertyDescriptors(input);
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), ["bytes", "expected"])
  ) {
    fail("verification input fields are not exact");
  }
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) {
      fail(`verification input ${key} is not an enumerable own data field`);
    }
  }
  const bytes = descriptors.bytes.value;
  if (
    !Buffer.isBuffer(bytes) ||
    types.isProxy(bytes) ||
    bytes.length < 2 ||
    bytes.length > G17_BENCHMARK_EXECUTION_REQUEST_MAX_BYTES
  ) {
    fail("request artifact is not a bounded Buffer");
  }
  return {
    bytes: Buffer.from(bytes),
    expected: descriptors.expected.value,
  };
}

function decodeCanonicalRequest(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`request artifact is not UTF-8: ${error.message}`);
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail("request artifact must be one LF-terminated JSON value");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`request artifact is invalid JSON: ${error.message}`);
  }
  const request = snapshotOwnData(parsed, "execution request document");
  if (!bytes.equals(canonicalRequestBytes(request))) {
    fail("request artifact is not canonical JSON plus one LF");
  }
  return request;
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
    "execution request document",
  );
  if (request.schema !== G17_BENCHMARK_EXECUTION_REQUEST_SCHEMA) {
    fail("request schema drifted");
  }
  digest(request.contentHash, "request contentHash");
  const { contentHash, ...ordinaryUnsigned } = request;
  const unsigned = snapshotOwnData(ordinaryUnsigned, "unsigned request");
  if (request.contentHash !== canonicalSha256(unsigned)) {
    fail("request contentHash does not verify");
  }
  if (
    !isDeepStrictEqual(
      request.authority,
      G17_BENCHMARK_EXECUTION_REQUEST_AUTHORITY,
    ) ||
    !isDeepStrictEqual(
      request.nonclaims,
      G17_BENCHMARK_EXECUTION_REQUEST_NONCLAIMS,
    ) ||
    !isDeepStrictEqual(
      request.launchCompatibility,
      G17_BENCHMARK_EXECUTION_REQUEST_LAUNCH_COMPATIBILITY,
    ) ||
    request.launchCompatibility.currentPolicyCompatible !== false ||
    request.launchCompatibility.physicalLaunchEligible !== false ||
    request.binding !== null ||
    request.finalDecisionEligible !== false
  ) {
    fail("request overclaims execution, evidence, binding, or eligibility");
  }
}

export function verifyG17BenchmarkExecutionRequestArtifact(input) {
  const envelope = verificationInput(input);
  const expected = buildRequest(envelope.expected);
  const request = decodeCanonicalRequest(envelope.bytes);
  validateSealedRequest(request);
  if (!envelope.bytes.equals(canonicalRequestBytes(expected))) {
    fail("request differs from its separately trusted pre-execution inputs");
  }
  deepFreeze(request);
  return Object.freeze(
    nullRecord([
      ["request", request],
      ["identity", identityFor(request, envelope.bytes)],
    ]),
  );
}
