import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS,
  verifyG17BenchmarkBuildProcessEvidence,
} from "./benchmark-build-process-evidence-contract.mjs";
import {
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "./benchmark-execution-plan.mjs";
import {
  G17_BENCHMARK_BUILD_PLAN,
  G17_BENCHMARK_OWNER_CONTROL_PROTOCOL_SHA256,
  verifyG17BenchmarkBuildOwner,
  verifyG17BenchmarkWorkspaceOwner,
} from "./benchmark-owner-contract.mjs";
import {
  verifyG17NativeIsolationPolicyArtifact,
  verifyG17NativePlatformBundle,
} from "./native-platform-contract.mjs";
import { g17NativeSessionEnvironment } from "./native-session-contract.mjs";

// This pure boundary replays exact bytes plus separately trusted identities.
// Held-fd, read-only, isolation, and process facts remain capture claims until a
// physical owner establishes them. No result from this module is a final
// decision or authority to execute, qualify, promote, publish, or route.

export const G17_BENCHMARK_PRODUCT_OWNER_SCHEMA =
  "oxigraph.g1.7-benchmark-product-owner/v3";
export const G17_BENCHMARK_PRODUCT_OWNER_PROJECTION_SCHEMA =
  "oxigraph.g1.7-benchmark-product-owner-projection/v3";
export const G17_PRODUCT_SOURCE_PROJECTION_SCHEMA =
  "oxigraph.g1.7-product-source-projection/v1";

const AUTHORIZATION_SCHEMA = "oxigraph.g1.7-control-authorization/v3";
const SOURCE_OBJECT_CLOSURE_SCHEMA =
  "oxigraph.g1.7-product-source-object-closure/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const GIT_OID = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const WORKSPACE_GENERATION = /^g17-workspace-[0-9a-f]{64}$/u;
const TARGET_GENERATION = /^g17-target-[0-9a-f]{64}$/u;
const PRODUCT_ROLE = /^(?:negativeControl|performanceReference|noiseControl)$/u;
const MAX_OWNER_BYTES = 4 * 1024 * 1024;
const MAX_AUTHORIZATION_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_PROJECTION_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 67_108_864;
const MAX_AGGREGATE_BYTES = 268_435_456;
const MAX_FILES = 128;
const MAX_DEPTH = 64;
const MAX_NODES = 100_000;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_PROPERTIES = 4_097;
const MAX_STRING_BYTES = 16 * 1024 * 1024;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 4_096;
const MAX_SOURCE_ENTRIES = 200_000;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_PATCH_BYTES = 8 * 1024 * 1024;
const MAX_CARGO_LOCK_BYTES = 16 * 1024 * 1024;

export const G17_BENCHMARK_PRODUCT_BUILD_PLAN = deepFreeze(
  G17_BENCHMARK_BUILD_PLAN.map(({ buildId, productRole }) => ({
    buildId,
    productRole,
  })),
);

export const G17_BENCHMARK_PRODUCT_OWNER_AUTHORITY = deepFreeze({
  buildExecutionAuthority: false,
  launchExecutionAuthority: false,
  controlExecutionAuthority: false,
  qualificationExecutionAuthority: false,
  receiptAuthority: false,
  promotionAuthority: false,
  publicationAuthority: false,
  routerQualityAuthority: false,
  providerExecutionAuthority: false,
});

export const G17_BENCHMARK_PRODUCT_OWNER_NONCLAIMS = deepFreeze({
  ...G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS,
});

function fail(message) {
  throw new Error(`G1.7 benchmark product owner contract: ${message}`);
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
  budget = { nodes: 0, strings: 0, bytes: 0, files: 0 },
) {
  if (
    value !== null &&
    typeof value === "object" &&
    types.isProxy(value)
  ) {
    fail(`${label} contains a Proxy`);
  }
  if (depth > MAX_DEPTH) fail(`${label} exceeds the depth limit`);
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) fail(`${label} exceeds the node limit`);
  if (Buffer.isBuffer(value)) {
    budget.files += 1;
    budget.bytes += value.length;
    if (
      value.length > MAX_FILE_BYTES ||
      budget.files > MAX_FILES ||
      budget.bytes > MAX_AGGREGATE_BYTES
    ) {
      fail(`${label} exceeds the frozen physical evidence budget`);
    }
    return Buffer.from(value);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.strings += bytes;
    if (
      bytes > MAX_SINGLE_STRING_BYTES ||
      budget.strings > MAX_STRING_BYTES
    ) {
      fail(`${label} exceeds the string budget`);
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
      const descriptor = Object.getOwnPropertyDescriptor(value, "length");
      length = descriptor?.value;
      if (
        descriptor === undefined ||
        "get" in descriptor ||
        "set" in descriptor ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_ARRAY_LENGTH
      ) {
        fail(`${label} array length is invalid`);
      }
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length > MAX_PROPERTIES) {
      fail(`${label} exceeds the property limit`);
    }
    if (keys.some((key) => typeof key !== "string")) {
      fail(`${label} contains symbol fields`);
    }
    for (const key of keys) {
      const keyBytes = Buffer.byteLength(key, "utf8");
      budget.strings += keyBytes;
      if (
        keyBytes > MAX_SINGLE_STRING_BYTES ||
        budget.strings > MAX_STRING_BYTES
      ) {
        fail(`${label} exceeds the key budget`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) fail(`${label}.${key} disappeared`);
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
      return Array.from({ length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (descriptor === undefined || "get" in descriptor) {
          fail(`${label}[${index}] changed during snapshot`);
        }
        return snapshotInput(
          descriptor.value,
          `${label}[${index}]`,
          ancestors,
          depth + 1,
          budget,
        );
      });
    }
    const output = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        "get" in descriptor ||
        "set" in descriptor
      ) {
        fail(`${label}.${key} changed during snapshot`);
      }
      if (!descriptor.enumerable) fail(`${label}.${key} is not enumerable`);
      Object.defineProperty(output, key, {
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function gitOid(value, label) {
  if (!GIT_OID.test(value ?? "")) fail(`${label} is not a Git object ID`);
  return value;
}

function decimal(value, label) {
  if (!DECIMAL.test(value ?? "")) fail(`${label} is not a decimal identity`);
  return value;
}

function safeId(value, label) {
  if (!SAFE_ID.test(value ?? "")) fail(`${label} is not a safe identifier`);
  return value;
}

function safeInteger(value, maximum, label, { positive = false } = {}) {
  if (
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0) ||
    value > maximum ||
    Object.is(value, -0)
  ) {
    fail(`${label} is outside its integer bound`);
  }
  return value;
}

function relativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES ||
    posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value === ".." ||
    value.startsWith("../") ||
    value.includes("\0")
  ) {
    fail(`${label} is not a safe relative path`);
  }
  return value;
}

function boundedBytes(value, maximum, label, { allowEmpty = true } = {}) {
  if (!Buffer.isBuffer(value)) fail(`${label} must be a Buffer`);
  const bytes = Buffer.from(value);
  if ((!allowEmpty && bytes.length === 0) || bytes.length > maximum) {
    fail(`${label} is outside its byte bound`);
  }
  return bytes;
}

function decodeCanonicalDocument(bytesValue, maximumBytes, label) {
  const bytes = boundedBytes(bytesValue, maximumBytes, label, {
    allowEmpty: false,
  });
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`${label} is not UTF-8: ${error.message}`);
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(`${label} must be one LF-terminated canonical JSON value`);
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
  return { bytes, value, rawSha256: sha256(bytes) };
}

function validateSelfHash(value, label) {
  digest(value.contentHash, `${label} contentHash`);
  const { contentHash, ...unsigned } = value;
  if (contentHash !== canonicalSha256(unsigned)) {
    fail(`${label} self-hash does not verify`);
  }
}

function binding(value, label) {
  exactKeys(value, ["rawSha256", "contentHash"], label);
  return {
    rawSha256: digest(value.rawSha256, `${label} rawSha256`),
    contentHash: digest(value.contentHash, `${label} contentHash`),
  };
}

function validateAuthorization(bytesValue, expectedBinding) {
  const decoded = decodeCanonicalDocument(
    bytesValue,
    MAX_AUTHORIZATION_BYTES,
    "control authorization",
  );
  const value = decoded.value;
  exactKeys(
    value,
    ["schema", "id", "status", "protocol", "approval", "contentHash"],
    "control authorization",
  );
  exactKeys(
    value.approval,
    ["status", "approvedBy", "approvedAt"],
    "control authorization approval",
  );
  if (
    value.schema !== AUTHORIZATION_SCHEMA ||
    value.id !== "control-authorization" ||
    value.status !== "CONTROL_AUTHORIZED" ||
    value.approval.status !== "APPROVED" ||
    typeof value.approval.approvedBy !== "string" ||
    value.approval.approvedBy.trim().length === 0
  ) {
    fail("authorization bytes do not contain the approved v3 shape");
  }
  const approvedAt = Date.parse(value.approval.approvedAt);
  if (
    !Number.isFinite(approvedAt) ||
    new Date(approvedAt).toISOString() !== value.approval.approvedAt
  ) {
    fail("control authorization approval timestamp is not canonical UTC");
  }
  validateSelfHash(value, "control authorization");
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
  const actualBinding = {
    rawSha256: decoded.rawSha256,
    contentHash: value.contentHash,
  };
  if (
    canonicalSha256(value.protocol) !==
      G17_BENCHMARK_OWNER_CONTROL_PROTOCOL_SHA256 ||
    !isDeepStrictEqual(actualBinding, expectedBinding)
  ) {
    fail("control authorization differs from the separately trusted identity");
  }
  return deepFreeze({ value, bytes: decoded.bytes, binding: actualBinding });
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

function decodeOwner(bytesValue) {
  const decoded = decodeCanonicalDocument(
    bytesValue,
    MAX_OWNER_BYTES,
    "product owner",
  );
  if (decoded.value.schema !== G17_BENCHMARK_PRODUCT_OWNER_SCHEMA) {
    fail("product owner schema drifted");
  }
  validateSelfHash(decoded.value, "product owner");
  return decoded;
}

function validateGitlink(entry, index, required) {
  exactKeys(
    entry,
    required
      ? ["path", "commit", "tree", "entryCount", "manifestSha256"]
      : ["path", "commit"],
    `source gitlink ${index}`,
  );
  relativePath(entry.path, `source gitlink ${index} path`);
  gitOid(entry.commit, `source gitlink ${index} commit`);
  if (required) {
    gitOid(entry.tree, `source gitlink ${index} tree`);
    safeInteger(
      entry.entryCount,
      MAX_SOURCE_ENTRIES,
      `source gitlink ${index} entries`,
      { positive: true },
    );
    digest(entry.manifestSha256, `source gitlink ${index} manifest`);
  }
}

function sourceParentIdentity(value, label) {
  exactKeys(
    value,
    ["device", "inode", "uid", "gid", "filesystemType"],
    label,
  );
  for (const field of ["device", "inode", "uid", "gid", "filesystemType"]) {
    decimal(value[field], `${label} ${field}`);
  }
  return value;
}

function sourceChildIdentity(value, leafName, parent, label) {
  exactKeys(
    value,
    [
      "leafName",
      "device",
      "inode",
      "uid",
      "gid",
      "filesystemType",
      "parentDevice",
      "parentInode",
    ],
    label,
  );
  if (value.leafName !== leafName) fail(`${label} leafName drifted`);
  for (const field of [
    "device",
    "inode",
    "uid",
    "gid",
    "filesystemType",
    "parentDevice",
    "parentInode",
  ]) {
    decimal(value[field], `${label} ${field}`);
  }
  if (
    value.parentDevice !== parent.device ||
    value.parentInode !== parent.inode ||
    value.filesystemType !== parent.filesystemType ||
    value.device !== parent.device ||
    value.uid !== parent.uid ||
    value.gid !== parent.gid
  ) {
    fail(`${label} ancestry differs from parentRoot`);
  }
  return value;
}

function validateSourceProjection(
  bytesValue,
  expected,
  authorization,
  authorizationBinding,
) {
  const decoded = decodeCanonicalDocument(
    bytesValue,
    MAX_SOURCE_PROJECTION_BYTES,
    `source projection ${expected.buildId}`,
  );
  const value = decoded.value;
  exactKeys(
    value,
    [
      "schema",
      "controlRunId",
      "authorization",
      "buildId",
      "productRole",
      "product",
      "evaluator",
      "workspace",
      "source",
      "authority",
      "contentHash",
    ],
    `source projection ${expected.buildId}`,
  );
  if (value.schema !== G17_PRODUCT_SOURCE_PROJECTION_SCHEMA) {
    fail(`source projection ${expected.buildId} schema drifted`);
  }
  validateSelfHash(value, `source projection ${expected.buildId}`);
  const actualBinding = {
    rawSha256: decoded.rawSha256,
    contentHash: value.contentHash,
  };
  if (
    !isDeepStrictEqual(actualBinding, {
      rawSha256: expected.rawSha256,
      contentHash: expected.contentHash,
    }) ||
    value.controlRunId !== expected.controlRunId ||
    value.buildId !== expected.buildId ||
    value.productRole !== expected.productRole ||
    !isDeepStrictEqual(
      binding(value.authorization, "source authorization"),
      authorizationBinding,
    ) ||
    !isDeepStrictEqual(
      value.product,
      authorization.protocol.products[expected.productRole],
    ) ||
    !isDeepStrictEqual(
      value.evaluator,
      expectedEvaluator(authorization, expected.productRole),
    )
  ) {
    fail(`source projection ${expected.buildId} identity drifted`);
  }

  exactKeys(
    value.workspace,
    [
      "generation",
      "targetGeneration",
      "isolated",
      "targetIsolated",
      "sourceReadOnlyAtBuildStart",
      "targetEmptyAtBuildStart",
      "parentRoot",
      "sourceChild",
      "targetChild",
    ],
    `source workspace ${expected.buildId}`,
  );
  const parentRoot = sourceParentIdentity(
    value.workspace.parentRoot,
    `source workspace parentRoot ${expected.buildId}`,
  );
  const sourceChild = sourceChildIdentity(
    value.workspace.sourceChild,
    "source",
    parentRoot,
    `source workspace sourceChild ${expected.buildId}`,
  );
  const targetChild = sourceChildIdentity(
    value.workspace.targetChild,
    "target",
    parentRoot,
    `source workspace targetChild ${expected.buildId}`,
  );
  if (
    value.workspace.generation !== expected.workspaceGeneration ||
    value.workspace.targetGeneration !== expected.targetGeneration ||
    value.workspace.isolated !== true ||
    value.workspace.targetIsolated !== true ||
    value.workspace.sourceReadOnlyAtBuildStart !== true ||
    value.workspace.targetEmptyAtBuildStart !== true ||
    !WORKSPACE_GENERATION.test(value.workspace.generation ?? "") ||
    !TARGET_GENERATION.test(value.workspace.targetGeneration ?? "") ||
    sourceChild.inode === parentRoot.inode ||
    targetChild.inode === parentRoot.inode ||
    sourceChild.inode === targetChild.inode
  ) {
    fail(`source workspace ${expected.buildId} capture claims drifted`);
  }

  exactKeys(
    value.source,
    [
      "productCommit",
      "productTree",
      "effectiveTree",
      "cargoLock",
      "evaluatorPatch",
      "requiredGitlinks",
      "excludedGitlinks",
      "symlinks",
      "objectClosureSha256",
      "entryCount",
      "totalBytes",
      "manifestSha256",
    ],
    `source evidence ${expected.buildId}`,
  );
  exactKeys(
    value.source.cargoLock,
    ["blob", "bytes", "sha256"],
    `source Cargo.lock ${expected.buildId}`,
  );
  exactKeys(
    value.source.evaluatorPatch,
    ["bytes", "sha256"],
    `source evaluator patch ${expected.buildId}`,
  );
  const product = authorization.protocol.products[expected.productRole];
  const evaluator = authorization.protocol.evaluatorOverlay;
  if (
    value.source.productCommit !== product.commit ||
    value.source.productTree !== product.tree ||
    value.source.effectiveTree !==
      evaluator.roleCompositions[expected.productRole].effectiveTree ||
    value.source.cargoLock.blob !== product.cargoLockBlob ||
    value.source.cargoLock.sha256 !== product.cargoLockSha256 ||
    value.source.evaluatorPatch.sha256 !== evaluator.patchSha256
  ) {
    fail(`source evidence ${expected.buildId} differs from authorization`);
  }
  gitOid(value.source.productCommit, `source ${expected.buildId} product commit`);
  gitOid(value.source.productTree, `source ${expected.buildId} product tree`);
  gitOid(value.source.effectiveTree, `source ${expected.buildId} effective tree`);
  gitOid(value.source.cargoLock.blob, `source ${expected.buildId} Cargo.lock blob`);
  safeInteger(
    value.source.cargoLock.bytes,
    MAX_CARGO_LOCK_BYTES,
    `source ${expected.buildId} Cargo.lock bytes`,
    { positive: true },
  );
  digest(value.source.cargoLock.sha256, `source ${expected.buildId} Cargo.lock`);
  safeInteger(
    value.source.evaluatorPatch.bytes,
    MAX_PATCH_BYTES,
    `source ${expected.buildId} evaluator patch bytes`,
    { positive: true },
  );
  digest(
    value.source.evaluatorPatch.sha256,
    `source ${expected.buildId} evaluator patch`,
  );
  for (const [name, entries] of [
    ["requiredGitlinks", value.source.requiredGitlinks],
    ["excludedGitlinks", value.source.excludedGitlinks],
    ["symlinks", value.source.symlinks],
  ]) {
    if (!Array.isArray(entries)) {
      fail(`source ${expected.buildId} ${name} is not an array`);
    }
  }
  value.source.requiredGitlinks.forEach((entry, index) =>
    validateGitlink(entry, index, true),
  );
  value.source.excludedGitlinks.forEach((entry, index) =>
    validateGitlink(entry, index, false),
  );
  value.source.symlinks.forEach((entry, index) => {
    exactKeys(entry, ["path", "target", "gitBlob"], `source symlink ${index}`);
    relativePath(entry.path, `source symlink ${index} path`);
    if (
      typeof entry.target !== "string" ||
      Buffer.byteLength(entry.target, "utf8") > MAX_PATH_BYTES
    ) {
      fail(`source symlink ${index} target is invalid`);
    }
    gitOid(entry.gitBlob, `source symlink ${index} gitBlob`);
  });
  digest(value.source.objectClosureSha256, `source ${expected.buildId} closure`);
  const expectedClosureSha256 = canonicalSha256({
    schema: SOURCE_OBJECT_CLOSURE_SCHEMA,
    product: value.product,
    evaluator: value.evaluator,
    effectiveTree: value.source.effectiveTree,
    requiredGitlinks: value.source.requiredGitlinks,
    excludedGitlinks: value.source.excludedGitlinks,
    symlinks: value.source.symlinks,
  });
  safeInteger(
    value.source.entryCount,
    MAX_SOURCE_ENTRIES,
    `source ${expected.buildId} entryCount`,
    { positive: true },
  );
  safeInteger(
    value.source.totalBytes,
    MAX_SOURCE_BYTES,
    `source ${expected.buildId} totalBytes`,
    { positive: true },
  );
  digest(value.source.manifestSha256, `source ${expected.buildId} manifest`);
  if (
    value.source.objectClosureSha256 !== expectedClosureSha256 ||
    !isDeepStrictEqual(value.authority, {
      build: false,
      launch: false,
      control: false,
      qualification: false,
      promotion: false,
      publication: false,
      provider: false,
      routerQuality: false,
    })
  ) {
    fail(`source projection ${expected.buildId} closure or authority drifted`);
  }
  return deepFreeze({
    rawSha256: decoded.rawSha256,
    contentHash: value.contentHash,
    workspaceGeneration: value.workspace.generation,
    targetGeneration: value.workspace.targetGeneration,
    parentRoot,
    sourceChild,
    targetChild,
    effectiveTree: value.source.effectiveTree,
    manifestSha256: value.source.manifestSha256,
  });
}

function replayPlatform(platformArtifacts, toolchainArtifacts, expected) {
  exactKeys(
    platformArtifacts,
    ["platformBytes", "sourcePlanBytes", "controllerBytes", "isolationPolicyBytes"],
    "platform artifact inventory",
  );
  exactKeys(
    toolchainArtifacts,
    ["cargoExecutableBytes", "rustcExecutableBytes"],
    "toolchain artifact inventory",
  );
  const bundle = verifyG17NativePlatformBundle({
    platformBytes: platformArtifacts.platformBytes,
    sourcePlanBytes: platformArtifacts.sourcePlanBytes,
    controllerBytes: platformArtifacts.controllerBytes,
  });
  const isolationPolicy = verifyG17NativeIsolationPolicyArtifact(
    platformArtifacts.isolationPolicyBytes,
  );
  const cargoBytes = boundedBytes(
    toolchainArtifacts.cargoExecutableBytes,
    MAX_FILE_BYTES,
    "Cargo executable",
    { allowEmpty: false },
  );
  const rustcBytes = boundedBytes(
    toolchainArtifacts.rustcExecutableBytes,
    MAX_FILE_BYTES,
    "rustc executable",
    { allowEmpty: false },
  );
  const { platform, sourcePlanProjectionSha256, controller } = bundle;
  const environment = g17NativeSessionEnvironment(platform, 4);
  const logicalTool = (role) => ({
    logicalPath: `/${role.root}/${role.resolvedPath}`,
    sha256: role.sha256,
  });
  const projection = {
    closure: {
      rawSha256: sha256(platformArtifacts.platformBytes),
      manifestSha256: platform.manifestSha256,
      platformRootSha256: platform.platformRootSha256,
      toolchainRootSha256: platform.toolchainRootSha256,
    },
    sourcePlan: {
      rawSha256: sha256(platformArtifacts.sourcePlanBytes),
      projectionSha256: sourcePlanProjectionSha256,
    },
    controller: {
      rawSha256: sha256(platformArtifacts.controllerBytes),
      contentSha256: controller.sha256,
    },
    isolationPolicy: {
      rawSha256: sha256(platformArtifacts.isolationPolicyBytes),
      contentSha256: isolationPolicy.sha256,
    },
    toolchain: {
      rootSha256: platform.toolchainRootSha256,
      cargo: logicalTool(platform.roles.cargo),
      rustc: logicalTool(platform.roles.rustc),
    },
  };
  const actualExpectation = {
    platformRawSha256: projection.closure.rawSha256,
    sourcePlanRawSha256: projection.sourcePlan.rawSha256,
    controllerRawSha256: projection.controller.rawSha256,
    isolationPolicyRawSha256: projection.isolationPolicy.rawSha256,
    platformRootSha256: projection.closure.platformRootSha256,
    toolchainRootSha256: projection.closure.toolchainRootSha256,
    cargoExecutableSha256: sha256(cargoBytes),
    rustcExecutableSha256: sha256(rustcBytes),
  };
  if (
    !isDeepStrictEqual(actualExpectation, expected) ||
    projection.toolchain.cargo.sha256 !== actualExpectation.cargoExecutableSha256 ||
    projection.toolchain.rustc.sha256 !== actualExpectation.rustcExecutableSha256 ||
    !isDeepStrictEqual(environment, G17_BENCHMARK_BUILD_ENVIRONMENT) ||
    canonicalSha256(environment) !== G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256
  ) {
    fail("platform, toolchain, or shared environment recipe drifted");
  }
  return deepFreeze({ projection, cargoBytes, rustcBytes, environment });
}

function validateExpected(value) {
  exactKeys(
    value,
    ["authorization", "executionPlanSha256", "controlRunId", "platform", "builds"],
    "product owner expectation",
  );
  const authorization = binding(value.authorization, "expected authorization");
  digest(value.executionPlanSha256, "expected execution plan");
  safeId(value.controlRunId, "expected controlRunId");
  exactKeys(
    value.platform,
    [
      "platformRawSha256",
      "sourcePlanRawSha256",
      "controllerRawSha256",
      "isolationPolicyRawSha256",
      "platformRootSha256",
      "toolchainRootSha256",
      "cargoExecutableSha256",
      "rustcExecutableSha256",
    ],
    "expected platform",
  );
  for (const [field, digestValue] of Object.entries(value.platform)) {
    digest(digestValue, `expected platform ${field}`);
  }
  if (
    value.executionPlanSha256 !== G17_BENCHMARK_EXECUTION_PLAN_SHA256 ||
    !Array.isArray(value.builds) ||
    value.builds.length !== G17_BENCHMARK_PRODUCT_BUILD_PLAN.length
  ) {
    fail("expected plan or build cardinality drifted");
  }
  const builds = value.builds.map((build, index) => {
    exactKeys(
      build,
      ["buildId", "productRole", "sourceProjection", "processEvidence", "executable"],
      `expected build ${index}`,
    );
    const plan = G17_BENCHMARK_PRODUCT_BUILD_PLAN[index];
    if (
      build.buildId !== plan.buildId ||
      build.productRole !== plan.productRole ||
      !PRODUCT_ROLE.test(build.productRole)
    ) {
      fail(`expected build ${index} order or role drifted`);
    }
    exactKeys(
      build.sourceProjection,
      [
        "rawSha256",
        "contentHash",
        "buildId",
        "productRole",
        "controlRunId",
        "workspaceGeneration",
        "targetGeneration",
      ],
      `expected source projection ${index}`,
    );
    digest(build.sourceProjection.rawSha256, `expected source ${index} raw`);
    digest(build.sourceProjection.contentHash, `expected source ${index} content`);
    safeId(
      build.sourceProjection.workspaceGeneration,
      `expected source ${index} workspace generation`,
    );
    safeId(
      build.sourceProjection.targetGeneration,
      `expected source ${index} target generation`,
    );
    if (
      build.sourceProjection.buildId !== build.buildId ||
      build.sourceProjection.productRole !== build.productRole ||
      build.sourceProjection.controlRunId !== value.controlRunId
    ) {
      fail(`expected source projection ${index} identity drifted`);
    }
    const processEvidence = binding(
      build.processEvidence,
      `expected process evidence ${index}`,
    );
    exactKeys(
      build.executable,
      ["logicalPath", "bytes", "sha256"],
      `expected executable ${index}`,
    );
    if (
      typeof build.executable.logicalPath !== "string" ||
      !/^\/state\/target\/release\/deps\/transactional_write-[a-zA-Z0-9._-]+$/u.test(
        build.executable.logicalPath,
      )
    ) {
      fail(`expected executable ${index} logical path drifted`);
    }
    safeInteger(
      build.executable.bytes,
      MAX_FILE_BYTES,
      `expected executable ${index} bytes`,
      { positive: true },
    );
    digest(build.executable.sha256, `expected executable ${index} sha256`);
    return { ...build, processEvidence };
  });
  return { ...value, authorization, builds };
}

function replayBuild({
  ownerBuild,
  artifact,
  expectedBuild,
  plan,
  index,
  authorization,
  controlRunId,
  platform,
}) {
  exactKeys(
    ownerBuild,
    ["buildId", "productRole", "sourceProjection", "processEvidence", "executable"],
    `product build ${index}`,
  );
  exactKeys(
    artifact,
    [
      "buildId",
      "productRole",
      "sourceProjectionBytes",
      "workspaceOwnerBytes",
      "buildOwnerBytes",
      "buildStdoutBytes",
      "buildStderrBytes",
      "processEvidenceBytes",
      "executableBytes",
    ],
    `product build artifact ${index}`,
  );
  if (
    ownerBuild.buildId !== plan.buildId ||
    ownerBuild.productRole !== plan.productRole ||
    artifact.buildId !== plan.buildId ||
    artifact.productRole !== plan.productRole
  ) {
    fail(`product build ${index} order or role drifted`);
  }
  const source = validateSourceProjection(
    artifact.sourceProjectionBytes,
    expectedBuild.sourceProjection,
    authorization.value,
    authorization.binding,
  );
  const evaluator = expectedEvaluator(authorization.value, plan.productRole);
  const workspaceOwner = verifyG17BenchmarkWorkspaceOwner({
    bytes: artifact.workspaceOwnerBytes,
    expected: {
      controlRunId,
      authorization: authorization.binding,
      buildId: plan.buildId,
      productRole: plan.productRole,
      product: authorization.value.protocol.products[plan.productRole],
      evaluator,
    },
  });
  const buildOwner = verifyG17BenchmarkBuildOwner({
    bytes: artifact.buildOwnerBytes,
    stdoutBytes: artifact.buildStdoutBytes,
    stderrBytes: artifact.buildStderrBytes,
    expected: {
      controlRunId,
      authorization: authorization.binding,
      buildId: plan.buildId,
      productRole: plan.productRole,
      workspaceOwner,
    },
  });
  if (
    workspaceOwner.workspace.generation !== source.workspaceGeneration ||
    workspaceOwner.workspace.targetGeneration !== source.targetGeneration ||
    buildOwner.executable.logicalPath !== expectedBuild.executable.logicalPath ||
    buildOwner.executable.sha256 !== expectedBuild.executable.sha256
  ) {
    fail(`product build ${index} logical owner differs from trusted evidence`);
  }
  const process = verifyG17BenchmarkBuildProcessEvidence({
    bytes: artifact.processEvidenceBytes,
    expected: {
      authorization: authorization.binding,
      evidence: expectedBuild.processEvidence,
      executionPlanSha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
      controlRunId,
      buildId: plan.buildId,
      productRole: plan.productRole,
      source: {
        rawSha256: source.rawSha256,
        contentHash: source.contentHash,
        workspaceGeneration: source.workspaceGeneration,
        targetGeneration: source.targetGeneration,
        parentRoot: source.parentRoot,
        sourceChild: source.sourceChild,
        targetChild: source.targetChild,
      },
      logicalOwners: {
        workspaceOwnerRawSha256: workspaceOwner.rawSha256,
        buildOwnerRawSha256: buildOwner.rawSha256,
      },
      platform: {
        platformRootSha256: platform.projection.closure.platformRootSha256,
        toolchainRootSha256: platform.projection.closure.toolchainRootSha256,
        cargo: platform.projection.toolchain.cargo,
        rustc: platform.projection.toolchain.rustc,
      },
      executable: expectedBuild.executable,
      ordinal: index + 1,
    },
    cargoExecutableBytes: platform.cargoBytes,
    rustcExecutableBytes: platform.rustcBytes,
    stdoutBytes: artifact.buildStdoutBytes,
    stderrBytes: artifact.buildStderrBytes,
    executableBytes: artifact.executableBytes,
  });
  const expectedOwnerBuild = {
    buildId: plan.buildId,
    productRole: plan.productRole,
    sourceProjection: {
      rawSha256: source.rawSha256,
      contentHash: source.contentHash,
    },
    processEvidence: {
      rawSha256: process.rawSha256,
      contentHash: process.contentHash,
    },
    executable: expectedBuild.executable,
  };
  if (
    !isDeepStrictEqual(processEvidenceIdentity(process), expectedBuild.processEvidence) ||
    !isDeepStrictEqual(ownerBuild, expectedOwnerBuild) ||
    process.executable.sha256 !== expectedBuild.executable.sha256 ||
    process.executable.bytes !== expectedBuild.executable.bytes
  ) {
    fail(`product build ${index} differs from separately trusted identities`);
  }
  return { source, workspaceOwner, buildOwner, process };
}

function processEvidenceIdentity(process) {
  return {
    rawSha256: process.rawSha256,
    contentHash: process.contentHash,
  };
}

function inventoryProjection({
  owner,
  authorization,
  platformArtifacts,
  toolchainArtifacts,
  artifacts,
}) {
  return {
    owner: { rawSha256: owner.rawSha256, contentHash: owner.value.contentHash },
    authorization: authorization.binding,
    executionPlanSha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
    platform: {
      platformRawSha256: sha256(platformArtifacts.platformBytes),
      sourcePlanRawSha256: sha256(platformArtifacts.sourcePlanBytes),
      controllerRawSha256: sha256(platformArtifacts.controllerBytes),
      isolationPolicyRawSha256: sha256(platformArtifacts.isolationPolicyBytes),
      cargoExecutableSha256: sha256(toolchainArtifacts.cargoExecutableBytes),
      rustcExecutableSha256: sha256(toolchainArtifacts.rustcExecutableBytes),
    },
    builds: artifacts.builds.map((build) => ({
      buildId: build.buildId,
      sourceProjectionRawSha256: sha256(build.sourceProjectionBytes),
      workspaceOwnerRawSha256: sha256(build.workspaceOwnerBytes),
      buildOwnerRawSha256: sha256(build.buildOwnerBytes),
      stdoutSha256: sha256(build.buildStdoutBytes),
      stderrSha256: sha256(build.buildStderrBytes),
      processEvidenceRawSha256: sha256(build.processEvidenceBytes),
      executableSha256: sha256(build.executableBytes),
    })),
  };
}

export function verifyG17BenchmarkProductOwner(input) {
  try {
    const context = snapshotInput(input, "product owner verification input");
    exactKeys(
      context,
      [
        "bytes",
        "authorizationBytes",
        "platformArtifacts",
        "toolchainArtifacts",
        "artifacts",
        "expected",
      ],
      "product owner verification input",
    );
    exactKeys(context.artifacts, ["builds"], "product build inventory");
    if (
      !Array.isArray(context.artifacts.builds) ||
      context.artifacts.builds.length !== G17_BENCHMARK_PRODUCT_BUILD_PLAN.length
    ) {
      fail("product build inventory does not contain the exact four-build plan");
    }
    const expected = validateExpected(context.expected);
    const owner = decodeOwner(context.bytes);
    const authorization = validateAuthorization(
      context.authorizationBytes,
      expected.authorization,
    );
    if (expected.controlRunId !== owner.value.controlRunId) {
      fail("product owner control run differs from trusted expectation");
    }
    const platform = replayPlatform(
      context.platformArtifacts,
      context.toolchainArtifacts,
      expected.platform,
    );
    exactKeys(
      owner.value,
      [
        "schema",
        "controlRunId",
        "authorization",
        "executionPlan",
        "platform",
        "builds",
        "nonclaims",
        "authority",
        "binding",
        "finalDecisionEligible",
        "contentHash",
      ],
      "product owner",
    );
    if (
      !isDeepStrictEqual(
        binding(owner.value.authorization, "product owner authorization"),
        authorization.binding,
      ) ||
      !isDeepStrictEqual(owner.value.executionPlan, {
        schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
        sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
        environmentRecipe: {
          schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
          sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
        },
      }) ||
      !isDeepStrictEqual(owner.value.platform, platform.projection) ||
      !isDeepStrictEqual(
        owner.value.nonclaims,
        G17_BENCHMARK_PRODUCT_OWNER_NONCLAIMS,
      ) ||
      !isDeepStrictEqual(
        owner.value.authority,
        G17_BENCHMARK_PRODUCT_OWNER_AUTHORITY,
      ) ||
      owner.value.binding !== null ||
      owner.value.finalDecisionEligible !== false ||
      !Array.isArray(owner.value.builds) ||
      owner.value.builds.length !== G17_BENCHMARK_PRODUCT_BUILD_PLAN.length
    ) {
      fail("product owner authorization, plan, platform, or authority drifted");
    }
    const builds = G17_BENCHMARK_PRODUCT_BUILD_PLAN.map((plan, index) =>
      replayBuild({
        ownerBuild: owner.value.builds[index],
        artifact: context.artifacts.builds[index],
        expectedBuild: expected.builds[index],
        plan,
        index,
        authorization,
        controlRunId: expected.controlRunId,
        platform,
      }),
    );
    const generations = builds.flatMap(({ source, process }) => [
      source.workspaceGeneration,
      source.targetGeneration,
      process.processGeneration,
    ]);
    if (new Set(generations).size !== generations.length) {
      fail("build source, target, and process generation claims are not distinct");
    }
    const inventory = inventoryProjection({
      owner,
      authorization,
      platformArtifacts: context.platformArtifacts,
      toolchainArtifacts: context.toolchainArtifacts,
      artifacts: context.artifacts,
    });
    const rawBytes =
      owner.bytes.length +
      authorization.bytes.length +
      Object.values(context.platformArtifacts).reduce(
        (total, bytes) => total + bytes.length,
        0,
      ) +
      Object.values(context.toolchainArtifacts).reduce(
        (total, bytes) => total + bytes.length,
        0,
      ) +
      context.artifacts.builds.reduce(
        (total, build) =>
          total +
          Object.entries(build)
            .filter(([name]) => name.endsWith("Bytes"))
            .reduce((sum, [, bytes]) => sum + bytes.length, 0),
        0,
      );
    const fileCount =
      2 +
      Object.keys(context.platformArtifacts).length +
      Object.keys(context.toolchainArtifacts).length +
      context.artifacts.builds.length * 7;
    if (rawBytes > MAX_AGGREGATE_BYTES || fileCount > MAX_FILES) {
      fail("product evidence exceeds the frozen envelope budget");
    }
    return deepFreeze({
      schema: G17_BENCHMARK_PRODUCT_OWNER_PROJECTION_SCHEMA,
      status: "BUILD_EVIDENCE_AND_CAPTURE_CLAIMS_REPLAYED",
      finalDecisionEligible: false,
      binding: null,
      controlRunId: expected.controlRunId,
      owner: inventory.owner,
      authorization: authorization.binding,
      executionPlan: {
        schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
        sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
        environmentRecipe: {
          schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
          sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
        },
      },
      platform: {
        closureRawSha256: platform.projection.closure.rawSha256,
        platformRootSha256: platform.projection.closure.platformRootSha256,
        toolchainRootSha256: platform.projection.closure.toolchainRootSha256,
      },
      builds: builds.map(({ source, workspaceOwner, buildOwner, process }) => ({
        buildId: process.buildId,
        productRole: process.productRole,
        sourceProjection: {
          rawSha256: source.rawSha256,
          contentHash: source.contentHash,
          effectiveTree: source.effectiveTree,
          manifestSha256: source.manifestSha256,
          parentRoot: source.parentRoot,
          sourceChild: source.sourceChild,
          targetChild: source.targetChild,
        },
        workspaceGeneration: source.workspaceGeneration,
        targetGeneration: source.targetGeneration,
        processGeneration: process.processGeneration,
        workspaceOwnerRawSha256: workspaceOwner.rawSha256,
        buildOwnerRawSha256: buildOwner.rawSha256,
        processEvidence: processEvidenceIdentity(process),
        executable: process.executable,
      })),
      inventory: {
        fileCount,
        bytes: rawBytes,
        sha256: canonicalSha256(inventory),
      },
      nonclaims: G17_BENCHMARK_PRODUCT_OWNER_NONCLAIMS,
      authority: G17_BENCHMARK_PRODUCT_OWNER_AUTHORITY,
    });
  } catch (error) {
    if (
      error?.message?.startsWith("G1.7 benchmark product owner contract:")
    ) {
      throw error;
    }
    fail(`dependency replay failed: ${error?.message ?? String(error)}`);
  }
}
