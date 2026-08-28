import { createHash } from "node:crypto";
import { posix } from "node:path";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_BUILD_ARGV,
  G17_BENCHMARK_BUILD_ENVIRONMENT,
  G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256,
  G17_BENCHMARK_BUILD_LAUNCHER,
  G17_BENCHMARK_BUILD_PROGRAM,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
  G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
  G17_BENCHMARK_EXECUTION_PLAN,
  G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
  G17_BENCHMARK_EXECUTION_PLAN_SHA256,
} from "./benchmark-execution-plan.mjs";
import { parseG17Elf64 } from "./native-elf.mjs";

export const G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_SCHEMA =
  "oxigraph.g1.7-benchmark-build-process-evidence/v2";
export const G17_BENCHMARK_BUILD_PROCESS_PROJECTION_SCHEMA =
  "oxigraph.g1.7-benchmark-build-process-projection/v2";

const DIGEST = /^[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const PRODUCT_ROLE = /^(?:negativeControl|performanceReference|noiseControl)$/u;
const EXECUTABLE_PATH =
  /^\/state\/target\/release\/deps\/transactional_write-[a-zA-Z0-9._-]+$/u;
const EXECUTABLE_ANCESTORS = Object.freeze([
  Object.freeze({ logicalPath: "/state/target/release", leafName: "release" }),
  Object.freeze({ logicalPath: "/state/target/release/deps", leafName: "deps" }),
]);
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 67_108_864;
const MAX_AGGREGATE_BYTES = 268_435_456;
const MAX_FILES = 16;
const MAX_DEPTH = 64;
const MAX_NODES = 16_384;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_PROPERTIES = 4_097;
const MAX_STRING_BYTES = 4 * 1024 * 1024;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const MAX_PATH_BYTES = 4_096;
const MAX_POSIX_MODE = 0o177777;
const SOURCE_MOUNT_OPTIONS = Object.freeze([
  "bind",
  "nodev",
  "noexec",
  "nosuid",
  "ro",
]);
const TARGET_MOUNT_OPTIONS = Object.freeze([
  "bind",
  "nodev",
  "nosuid",
  "rw",
]);

export const G17_BENCHMARK_BUILD_PROCESS_AUTHORITY = deepFreeze({
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

export const G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS = deepFreeze({
  cargoProcessExecutableIdentityIndependentlyObserved: false,
  heldCargoExecutionViaExecveatVerified: false,
  cargoConfigAndVendorContentsIndependentlyVerified: false,
  homeAndTemporaryContentsIndependentlyVerified: false,
  privateDirectoryCreationIndependentlyVerified: false,
  privateDirectoryProvenanceIndependentlyVerified: false,
  privateDirectoryOwnershipIndependentlyVerified: false,
  privateDirectoryPermissionsIndependentlyVerified: false,
  privateDirectoryAncestryIndependentlyVerified: false,
  cargoSelectedRequestedRustcIndependentlyVerified: false,
  directRustcChildExecutionObserved: false,
  directRustcChildRawEvidenceReplayed: false,
});

function fail(message) {
  throw new Error(`G1.7 benchmark build process evidence: ${message}`);
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

function snapshot(
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
      fail(`${label} exceeds the raw evidence budget`);
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
        return snapshot(
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
        value: snapshot(
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
  if (!SAFE_ID.test(value ?? "")) fail(`${label} is not a safe identifier`);
  return value;
}

function safeInteger(
  value,
  label,
  { positive = false, maximum = Number.MAX_SAFE_INTEGER } = {},
) {
  if (
    !Number.isSafeInteger(value) ||
    value < (positive ? 1 : 0) ||
    value > maximum ||
    Object.is(value, -0)
  ) {
    fail(`${label} is not a bounded integer`);
  }
  return value;
}

function decimal(value, label) {
  if (!DECIMAL.test(value ?? "")) fail(`${label} is not a decimal identity`);
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

function boundedBytes(value, maximum, label, { allowEmpty = true } = {}) {
  if (!Buffer.isBuffer(value)) fail(`${label} must be a Buffer`);
  const bytes = Buffer.from(value);
  if ((!allowEmpty && bytes.length === 0) || bytes.length > maximum) {
    fail(`${label} is outside its byte bound`);
  }
  return bytes;
}

function decodeCanonical(bytesValue) {
  const bytes = boundedBytes(
    bytesValue,
    MAX_EVIDENCE_BYTES,
    "process evidence",
    { allowEmpty: false },
  );
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail(`process evidence is not UTF-8: ${error.message}`);
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail("process evidence must be one LF-terminated canonical JSON value");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`process evidence is invalid JSON: ${error.message}`);
  }
  const value = snapshot(parsed, "process evidence document");
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail("process evidence is not canonical JSON");
  }
  return { bytes, value, rawSha256: sha256(bytes) };
}

function binding(value, label) {
  exactKeys(value, ["rawSha256", "contentHash"], label);
  return {
    rawSha256: digest(value.rawSha256, `${label} rawSha256`),
    contentHash: digest(value.contentHash, `${label} contentHash`),
  };
}

function fileIdentity(value, label, kind) {
  exactKeys(
    value,
    ["device", "inode", "uid", "gid", "mode", "nlink", "size"],
    label,
  );
  for (const field of ["device", "inode", "uid", "gid"]) {
    decimal(value[field], `${label} ${field}`);
  }
  safeInteger(value.mode, `${label} mode`, {
    positive: true,
    maximum: MAX_POSIX_MODE,
  });
  safeInteger(value.nlink, `${label} nlink`, { positive: true });
  safeInteger(value.size, `${label} size`);
  const type = value.mode & 0o170000;
  if (
    (kind === "file" && type !== 0o100000) ||
    (kind === "directory" && type !== 0o040000)
  ) {
    fail(`${label} is not a ${kind}`);
  }
  if (kind === "file" && (value.mode & 0o111) === 0) {
    fail(`${label} is not executable`);
  }
  return value;
}

function stableHeldIdentity(before, after, label, { full = false } = {}) {
  const fields = full
    ? ["device", "inode", "uid", "gid", "mode", "nlink", "size"]
    : ["device", "inode", "uid", "gid", "mode"];
  if (fields.some((field) => before[field] !== after[field])) {
    fail(`${label} identity changed while held`);
  }
}

function projectionDirectoryIdentity(value, label) {
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

function projectionChildIdentity(value, leafName, label) {
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
  return value;
}

function observedDirectoryIdentity(value, label) {
  return {
    device: decimal(value.before.device, `${label} device`),
    inode: decimal(value.before.inode, `${label} inode`),
    uid: decimal(value.before.uid, `${label} uid`),
    gid: decimal(value.before.gid, `${label} gid`),
    filesystemType: decimal(value.filesystemType, `${label} filesystemType`),
  };
}

function heldWorkspaceParent(value, expected, label) {
  exactKeys(
    value,
    ["heldFd", "inheritedFd", "before", "after", "filesystemType"],
    label,
  );
  const before = fileIdentity(value.before, `${label} before`, "directory");
  const after = fileIdentity(value.after, `${label} after`, "directory");
  stableHeldIdentity(before, after, label, { full: true });
  if (
    value.heldFd !== true ||
    value.inheritedFd !== 3 ||
    before.mode !== 0o040700 ||
    after.mode !== 0o040700 ||
    before.nlink < 2 ||
    after.nlink < 2 ||
    !isDeepStrictEqual(observedDirectoryIdentity(value, label), expected)
  ) {
    fail(`${label} does not bind the source workspace parent`);
  }
  return value;
}

function heldWorkspaceChild(value, expected, inheritedFd, label) {
  exactKeys(
    value,
    [
      "leafName",
      "heldFd",
      "inheritedFd",
      "parentDevice",
      "parentInode",
      "before",
      "after",
      "filesystemType",
    ],
    label,
  );
  const before = fileIdentity(value.before, `${label} before`, "directory");
  const after = fileIdentity(value.after, `${label} after`, "directory");
  stableHeldIdentity(before, after, label, {
    full: expected.leafName === "source",
  });
  const observed = {
    leafName: value.leafName,
    ...observedDirectoryIdentity(value, label),
    parentDevice: decimal(value.parentDevice, `${label} parentDevice`),
    parentInode: decimal(value.parentInode, `${label} parentInode`),
  };
  const expectedMode = expected.leafName === "source" ? 0o040555 : 0o040700;
  if (
    value.heldFd !== true ||
    value.inheritedFd !== inheritedFd ||
    before.mode !== expectedMode ||
    after.mode !== expectedMode ||
    before.nlink < 2 ||
    after.nlink < 2 ||
    !isDeepStrictEqual(observed, expected)
  ) {
    fail(`${label} does not bind its exact source projection child`);
  }
  return value;
}

function heldLogicalDirectory(value, expectedPath, label, { stable = false } = {}) {
  exactKeys(
    value,
    ["logicalPath", "heldFd", "before", "after", "filesystemType", "private"],
    label,
  );
  const before = fileIdentity(value.before, `${label} before`, "directory");
  const after = fileIdentity(value.after, `${label} after`, "directory");
  stableHeldIdentity(before, after, label, { full: stable });
  logicalPath(value.logicalPath, `${label} logicalPath`);
  decimal(value.filesystemType, `${label} filesystemType`);
  if (
    value.logicalPath !== expectedPath ||
    value.heldFd !== true ||
    value.private !== true
  ) {
    fail(`${label} is not the exact claimed-private held directory`);
  }
  // `private` is replayed capture data, not an independent proof of how the
  // directory was created or of its provenance, owner, mode, or ancestry.
  // The exported exact nonclaims keep those physical-owner obligations open.
  return value;
}

function heldToolchainRoot(value, label) {
  exactKeys(
    value,
    ["logicalPath", "heldFd", "before", "after", "filesystemType"],
    label,
  );
  const before = fileIdentity(value.before, `${label} before`, "directory");
  const after = fileIdentity(value.after, `${label} after`, "directory");
  stableHeldIdentity(before, after, label, { full: true });
  decimal(value.filesystemType, `${label} filesystemType`);
  if (value.logicalPath !== "/toolchain" || value.heldFd !== true) {
    fail(`${label} is not the held immutable toolchain root`);
  }
  return value;
}

function heldToolchainBin(value, root, label) {
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
      "filesystemType",
    ],
    label,
  );
  const before = fileIdentity(value.before, `${label} before`, "directory");
  const after = fileIdentity(value.after, `${label} after`, "directory");
  stableHeldIdentity(before, after, label, { full: true });
  decimal(value.filesystemType, `${label} filesystemType`);
  if (
    value.logicalPath !== "/toolchain/bin" ||
    value.leafName !== "bin" ||
    value.heldFd !== true ||
    value.parentDevice !== root.before.device ||
    value.parentInode !== root.before.inode ||
    before.device !== root.before.device ||
    before.uid !== root.before.uid ||
    before.gid !== root.before.gid ||
    value.filesystemType !== root.filesystemType ||
    before.nlink < 2
  ) {
    fail(`${label} is not descended from the held toolchain root`);
  }
  return value;
}

function heldExecutableAncestors(
  value,
  targetRoot,
  occupiedIdentities,
  label,
) {
  if (
    !Array.isArray(value) ||
    value.length !== EXECUTABLE_ANCESTORS.length
  ) {
    fail(`${label} does not contain the exact output-directory chain`);
  }
  let parent = targetRoot;
  const identities = new Set(occupiedIdentities);
  if (
    !identities.has(
      `${targetRoot.before.device}:${targetRoot.before.inode}`,
    )
  ) {
    fail(`${label} is missing its held target root identity`);
  }
  for (const [index, expected] of EXECUTABLE_ANCESTORS.entries()) {
    const row = value[index];
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
      `${label} ${index}`,
    );
    const before = fileIdentity(
      row.before,
      `${label} ${index} before`,
      "directory",
    );
    const after = fileIdentity(
      row.after,
      `${label} ${index} after`,
      "directory",
    );
    stableHeldIdentity(before, after, `${label} ${index}`, { full: true });
    logicalPath(row.logicalPath, `${label} ${index} logicalPath`);
    decimal(row.parentDevice, `${label} ${index} parentDevice`);
    decimal(row.parentInode, `${label} ${index} parentInode`);
    decimal(row.filesystemType, `${label} ${index} filesystemType`);
    const identity = `${before.device}:${before.inode}`;
    if (
      row.logicalPath !== expected.logicalPath ||
      row.leafName !== expected.leafName ||
      row.heldFd !== true ||
      row.parentDevice !== parent.before.device ||
      row.parentInode !== parent.before.inode ||
      before.device !== targetRoot.before.device ||
      before.uid !== targetRoot.before.uid ||
      before.gid !== targetRoot.before.gid ||
      row.filesystemType !== targetRoot.filesystemType ||
      before.nlink < 2 ||
      identities.has(identity)
    ) {
      fail(`${label} ${index} is not an exact held target descendant`);
    }
    identities.add(identity);
    parent = row;
  }
  return { parent, identities };
}

function heldFile(value, rawBytes, expected, label, parent) {
  exactKeys(
    value,
    [
      "logicalPath",
      "parentDevice",
      "parentInode",
      "heldFd",
      "before",
      "after",
      "bytes",
      "sha256",
    ],
    label,
  );
  const bytes = boundedBytes(rawBytes, MAX_FILE_BYTES, `${label} raw bytes`, {
    allowEmpty: false,
  });
  logicalPath(value.logicalPath, `${label} logicalPath`);
  decimal(value.parentDevice, `${label} parentDevice`);
  decimal(value.parentInode, `${label} parentInode`);
  const before = fileIdentity(value.before, `${label} before`, "file");
  const after = fileIdentity(value.after, `${label} after`, "file");
  safeInteger(value.bytes, `${label} bytes`, { positive: true });
  digest(value.sha256, `${label} sha256`);
  if (
    value.heldFd !== true ||
    !isDeepStrictEqual(before, after) ||
    value.logicalPath !== expected.logicalPath ||
    value.bytes !== bytes.length ||
    before.size !== bytes.length ||
    value.sha256 !== sha256(bytes) ||
    value.sha256 !== expected.sha256 ||
    (parent !== undefined &&
      (value.parentDevice !== parent.before.device ||
        value.parentInode !== parent.before.inode ||
        before.device !== parent.before.device ||
        before.uid !== parent.before.uid ||
        before.gid !== parent.before.gid))
  ) {
    fail(`${label} does not bind its exact held-file bytes and ancestry`);
  }
  return { value, bytes };
}

function stream(value, rawBytes, label) {
  exactKeys(value, ["bytes", "sha256"], label);
  const bytes = boundedBytes(rawBytes, MAX_FILE_BYTES, `${label} raw bytes`);
  safeInteger(value.bytes, `${label} bytes`);
  digest(value.sha256, `${label} sha256`);
  if (value.bytes !== bytes.length || value.sha256 !== sha256(bytes)) {
    fail(`${label} does not bind its exact raw bytes`);
  }
  return bytes;
}

function validateExpected(value) {
  exactKeys(
    value,
    [
      "authorization",
      "evidence",
      "executionPlanSha256",
      "controlRunId",
      "buildId",
      "productRole",
      "source",
      "logicalOwners",
      "platform",
      "executable",
      "ordinal",
    ],
    "process evidence expectation",
  );
  const authorization = binding(value.authorization, "expected authorization");
  const evidence = binding(value.evidence, "expected process evidence");
  digest(value.executionPlanSha256, "expected execution plan");
  safeId(value.controlRunId, "expected controlRunId");
  safeId(value.buildId, "expected buildId");
  if (!PRODUCT_ROLE.test(value.productRole ?? "")) {
    fail("expected productRole is not reviewed");
  }
  exactKeys(
    value.source,
    [
      "rawSha256",
      "contentHash",
      "workspaceGeneration",
      "targetGeneration",
      "parentRoot",
      "sourceChild",
      "targetChild",
    ],
    "expected source",
  );
  const source = {
    rawSha256: digest(value.source.rawSha256, "expected source rawSha256"),
    contentHash: digest(value.source.contentHash, "expected source contentHash"),
    workspaceGeneration: safeId(
      value.source.workspaceGeneration,
      "expected workspace generation",
    ),
    targetGeneration: safeId(
      value.source.targetGeneration,
      "expected target generation",
    ),
    parentRoot: projectionDirectoryIdentity(
      value.source.parentRoot,
      "expected source parentRoot",
    ),
    sourceChild: projectionChildIdentity(
      value.source.sourceChild,
      "source",
      "expected source child",
    ),
    targetChild: projectionChildIdentity(
      value.source.targetChild,
      "target",
      "expected target child",
    ),
  };
  for (const child of [source.sourceChild, source.targetChild]) {
    if (
      child.parentDevice !== source.parentRoot.device ||
      child.parentInode !== source.parentRoot.inode ||
      child.filesystemType !== source.parentRoot.filesystemType ||
      child.device !== source.parentRoot.device ||
      child.uid !== source.parentRoot.uid ||
      child.gid !== source.parentRoot.gid
    ) {
      fail("expected source child ancestry differs from parentRoot");
    }
  }
  if (
    source.sourceChild.inode === source.parentRoot.inode ||
    source.targetChild.inode === source.parentRoot.inode ||
    source.sourceChild.inode === source.targetChild.inode
  ) {
    fail("expected source and target children alias");
  }
  exactKeys(
    value.logicalOwners,
    ["workspaceOwnerRawSha256", "buildOwnerRawSha256"],
    "expected logical owners",
  );
  for (const [field, digestValue] of Object.entries(value.logicalOwners)) {
    digest(digestValue, `expected logical owners ${field}`);
  }
  exactKeys(
    value.platform,
    ["platformRootSha256", "toolchainRootSha256", "cargo", "rustc"],
    "expected platform",
  );
  digest(value.platform.platformRootSha256, "expected platform root");
  digest(value.platform.toolchainRootSha256, "expected toolchain root");
  for (const tool of ["cargo", "rustc"]) {
    exactKeys(
      value.platform[tool],
      ["logicalPath", "sha256"],
      `expected ${tool}`,
    );
    logicalPath(value.platform[tool].logicalPath, `expected ${tool} path`);
    digest(value.platform[tool].sha256, `expected ${tool} sha256`);
  }
  exactKeys(
    value.executable,
    ["logicalPath", "bytes", "sha256"],
    "expected executable",
  );
  logicalPath(value.executable.logicalPath, "expected executable logicalPath");
  if (!EXECUTABLE_PATH.test(value.executable.logicalPath)) {
    fail("expected executable is outside the frozen target output path");
  }
  safeInteger(value.executable.bytes, "expected executable bytes", {
    positive: true,
  });
  digest(value.executable.sha256, "expected executable sha256");
  safeInteger(value.ordinal, "expected process ordinal", { positive: true });
  return { ...value, authorization, evidence, source };
}

function validateMounts(value, source) {
  if (!Array.isArray(value) || value.length !== 2) {
    fail("process workspace mount inventory is not exact");
  }
  const expected = [
    {
      child: "sourceChild",
      mountPoint: G17_BENCHMARK_EXECUTION_PLAN.build.workingDirectory,
      filesystemType: source.sourceChild.filesystemType,
      mountOptions: SOURCE_MOUNT_OPTIONS,
      readOnly: true,
    },
    {
      child: "targetChild",
      mountPoint: G17_BENCHMARK_EXECUTION_PLAN.build.targetDirectory,
      filesystemType: source.targetChild.filesystemType,
      mountOptions: TARGET_MOUNT_OPTIONS,
      readOnly: false,
    },
  ];
  value.forEach((row, index) => {
    exactKeys(
      row,
      ["child", "mountPoint", "filesystemType", "mountOptions", "readOnly"],
      `process workspace mount ${index}`,
    );
    logicalPath(row.mountPoint, `process workspace mount ${index} point`);
    decimal(row.filesystemType, `process workspace mount ${index} filesystem`);
    if (!isDeepStrictEqual(row, expected[index])) {
      fail(`process workspace mount ${index} drifted`);
    }
  });
  return value;
}

function directoryKey(value) {
  return `${value.before.device}:${value.before.inode}`;
}

export function verifyG17BenchmarkBuildProcessEvidence(input) {
  try {
    const captured = snapshot(input, "process evidence verification input");
    exactKeys(
      captured,
      [
        "bytes",
        "expected",
        "cargoExecutableBytes",
        "rustcExecutableBytes",
        "stdoutBytes",
        "stderrBytes",
        "executableBytes",
      ],
      "process evidence verification input",
    );
    const {
      bytes,
      expected: expectedInput,
      cargoExecutableBytes,
      rustcExecutableBytes,
      stdoutBytes,
      stderrBytes,
      executableBytes,
    } = captured;
    const expected = validateExpected(expectedInput);
    if (expected.executionPlanSha256 !== G17_BENCHMARK_EXECUTION_PLAN_SHA256) {
      fail("expected execution plan is not the reviewed plan");
    }
    const decoded = decodeCanonical(bytes);
    const value = decoded.value;
    exactKeys(
      value,
      [
        "schema",
        "controlRunId",
        "authorization",
        "executionPlan",
        "buildId",
        "productRole",
        "source",
        "platform",
        "workspace",
        "process",
        "logicalOwners",
        "result",
        "nonclaims",
        "authority",
        "binding",
        "finalDecisionEligible",
        "contentHash",
      ],
      "process evidence",
    );
    if (value.schema !== G17_BENCHMARK_BUILD_PROCESS_EVIDENCE_SCHEMA) {
      fail("process evidence schema drifted");
    }
    digest(value.contentHash, "process evidence contentHash");
    const { contentHash, ...unsigned } = value;
    if (contentHash !== canonicalSha256(unsigned)) {
      fail("process evidence self-hash does not verify");
    }
    if (
      !isDeepStrictEqual(
        { rawSha256: decoded.rawSha256, contentHash: value.contentHash },
        expected.evidence,
      )
    ) {
      fail("process evidence differs from its separately trusted identity");
    }
    exactKeys(
      value.executionPlan,
      ["schema", "sha256", "environmentRecipe"],
      "process execution plan binding",
    );
    exactKeys(
      value.executionPlan.environmentRecipe,
      ["schema", "sha256"],
      "process environment recipe binding",
    );
    const sourceBinding = binding(value.source, "process source binding");
    exactKeys(
      value.platform,
      ["platformRootSha256", "toolchainRootSha256"],
      "process platform binding",
    );
    digest(value.platform.platformRootSha256, "process platform root");
    digest(value.platform.toolchainRootSha256, "process toolchain root");
    if (
      value.controlRunId !== expected.controlRunId ||
      value.buildId !== expected.buildId ||
      value.productRole !== expected.productRole ||
      !isDeepStrictEqual(
        binding(value.authorization, "process authorization"),
        expected.authorization,
      ) ||
      !isDeepStrictEqual(value.executionPlan, {
        schema: G17_BENCHMARK_EXECUTION_PLAN_SCHEMA,
        sha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
        environmentRecipe: {
          schema: G17_BENCHMARK_ENVIRONMENT_RECIPE_SCHEMA,
          sha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
        },
      }) ||
      !isDeepStrictEqual(sourceBinding, {
        rawSha256: expected.source.rawSha256,
        contentHash: expected.source.contentHash,
      }) ||
      !isDeepStrictEqual(value.platform, {
        platformRootSha256: expected.platform.platformRootSha256,
        toolchainRootSha256: expected.platform.toolchainRootSha256,
      })
    ) {
      fail("process identity, authorization, plan, or source binding drifted");
    }

    exactKeys(
      value.workspace,
      [
        "generation",
        "targetGeneration",
        "parentRoot",
        "sourceChild",
        "targetChild",
        "mounts",
        "targetEmptyAtStart",
        "privateDirectories",
      ],
      "process workspace",
    );
    if (
      value.workspace.generation !== expected.source.workspaceGeneration ||
      value.workspace.targetGeneration !== expected.source.targetGeneration
    ) {
      fail("process workspace generation drifted");
    }
    const parentRoot = heldWorkspaceParent(
      value.workspace.parentRoot,
      expected.source.parentRoot,
      "held source workspace parentRoot",
    );
    const sourceChild = heldWorkspaceChild(
      value.workspace.sourceChild,
      expected.source.sourceChild,
      4,
      "held source workspace sourceChild",
    );
    const targetChild = heldWorkspaceChild(
      value.workspace.targetChild,
      expected.source.targetChild,
      5,
      "held source workspace targetChild",
    );
    validateMounts(value.workspace.mounts, expected.source);
    exactKeys(
      value.workspace.targetEmptyAtStart,
      ["observed", "entryCount"],
      "target-empty-at-start evidence",
    );
    if (
      value.workspace.targetEmptyAtStart.observed !== true ||
      value.workspace.targetEmptyAtStart.entryCount !== 0
    ) {
      fail("target was not captured empty at build start");
    }
    exactKeys(
      value.workspace.privateDirectories,
      ["cargoHome", "home", "temporary"],
      "private directory inventory",
    );
    const cargoHome = heldLogicalDirectory(
      value.workspace.privateDirectories.cargoHome,
      G17_BENCHMARK_EXECUTION_PLAN.build.privateDirectories.cargoHome,
      "private Cargo home",
    );
    const home = heldLogicalDirectory(
      value.workspace.privateDirectories.home,
      G17_BENCHMARK_EXECUTION_PLAN.build.privateDirectories.home,
      "private home",
    );
    const temporary = heldLogicalDirectory(
      value.workspace.privateDirectories.temporary,
      G17_BENCHMARK_EXECUTION_PLAN.build.privateDirectories.temporary,
      "private temporary directory",
    );
    const workspaceDirectoryKeys = [
      parentRoot,
      sourceChild,
      targetChild,
      cargoHome,
      home,
      temporary,
    ].map(directoryKey);
    if (new Set(workspaceDirectoryKeys).size !== workspaceDirectoryKeys.length) {
      fail("workspace and private held directories alias");
    }

    exactKeys(
      value.process,
      [
        "generation",
        "ordinal",
        "serialized",
        "isolationClass",
        "network",
        "program",
        "argv",
        "environment",
        "environmentSha256",
        "cwd",
        "targetDirectory",
        "toolchain",
      ],
      "build process",
    );
    safeId(value.process.generation, "build process generation");
    exactKeys(
      value.process.toolchain,
      ["contentSha256", "root", "bin", "cargo", "rustc"],
      "build process toolchain",
    );
    const toolchainRoot = heldToolchainRoot(
      value.process.toolchain.root,
      "held toolchain root",
    );
    const toolchainBin = heldToolchainBin(
      value.process.toolchain.bin,
      toolchainRoot,
      "held toolchain bin",
    );
    const allDirectoryKeys = [
      ...workspaceDirectoryKeys,
      directoryKey(toolchainRoot),
      directoryKey(toolchainBin),
    ];
    if (new Set(allDirectoryKeys).size !== allDirectoryKeys.length) {
      fail("workspace, private, and toolchain held directories alias");
    }
    const cargo = heldFile(
      value.process.toolchain.cargo,
      cargoExecutableBytes,
      expected.platform.cargo,
      "held Cargo executable",
      toolchainBin,
    );
    const rustc = heldFile(
      value.process.toolchain.rustc,
      rustcExecutableBytes,
      expected.platform.rustc,
      "held rustc executable",
      toolchainBin,
    );
    const heldObjectIdentityKeys = [
      ...allDirectoryKeys,
      `${cargo.value.before.device}:${cargo.value.before.inode}`,
      `${rustc.value.before.device}:${rustc.value.before.inode}`,
    ];
    if (
      new Set(heldObjectIdentityKeys).size !== heldObjectIdentityKeys.length
    ) {
      fail("workspace, private, toolchain, and held-tool identities alias");
    }
    exactKeys(
      value.process.environment,
      Object.keys(G17_BENCHMARK_BUILD_ENVIRONMENT),
      "build process environment",
    );
    if (
      value.process.ordinal !== expected.ordinal ||
      value.process.serialized !== true ||
      value.process.isolationClass !==
        "linux-x86_64-cgroup-v2-non-tmpfs-serialized" ||
      value.process.network !== "isolated" ||
      value.process.program !== G17_BENCHMARK_BUILD_PROGRAM ||
      value.process.program !== cargo.value.logicalPath ||
      !isDeepStrictEqual(value.process.argv, G17_BENCHMARK_BUILD_ARGV) ||
      !isDeepStrictEqual(
        value.process.environment,
        G17_BENCHMARK_BUILD_ENVIRONMENT,
      ) ||
      value.process.environmentSha256 !==
        G17_BENCHMARK_BUILD_ENVIRONMENT_SHA256 ||
      value.process.environmentSha256 !==
        canonicalSha256(value.process.environment) ||
      value.process.environment.RUSTC !== rustc.value.logicalPath ||
      value.process.cwd !== G17_BENCHMARK_EXECUTION_PLAN.build.workingDirectory ||
      value.process.targetDirectory !==
        G17_BENCHMARK_EXECUTION_PLAN.build.targetDirectory ||
      value.process.toolchain.contentSha256 !==
        expected.platform.toolchainRootSha256 ||
      cargo.value.logicalPath !== G17_BENCHMARK_BUILD_LAUNCHER.cargoLogicalPath ||
      rustc.value.logicalPath !== G17_BENCHMARK_BUILD_LAUNCHER.rustcLogicalPath
    ) {
      fail("build program, environment, toolchain, or isolation drifted");
    }

    exactKeys(
      value.logicalOwners,
      ["workspaceOwnerRawSha256", "buildOwnerRawSha256"],
      "process logical owners",
    );
    if (!isDeepStrictEqual(value.logicalOwners, expected.logicalOwners)) {
      fail("process logical-owner binding drifted");
    }
    exactKeys(
      value.result,
      [
        "exitCode",
        "signal",
        "timedOut",
        "stdout",
        "stderr",
        "executableAncestors",
        "executable",
      ],
      "process result",
    );
    const stdout = stream(value.result.stdout, stdoutBytes, "process stdout");
    const stderr = stream(value.result.stderr, stderrBytes, "process stderr");
    const executableAncestry = heldExecutableAncestors(
      value.result.executableAncestors,
      targetChild,
      heldObjectIdentityKeys,
      "held benchmark executable ancestry",
    );
    const executable = heldFile(
      value.result.executable,
      executableBytes,
      expected.executable,
      "held benchmark executable",
      executableAncestry.parent,
    );
    const elf = parseG17Elf64(executable.bytes);
    const executableIdentity =
      `${executable.value.before.device}:${executable.value.before.inode}`;
    if (
      value.result.exitCode !== 0 ||
      value.result.signal !== null ||
      value.result.timedOut !== false ||
      expected.executable.bytes !== executable.bytes.length ||
      executable.value.before.device !== targetChild.before.device ||
      executable.value.before.uid !== executableAncestry.parent.before.uid ||
      executable.value.before.gid !== executableAncestry.parent.before.gid ||
      executable.value.before.nlink !== 1 ||
      executableAncestry.identities.has(executableIdentity) ||
      elf === null
    ) {
      fail("build process result is not one successful target-bound ELF build");
    }
    if (
      !isDeepStrictEqual(value.nonclaims, G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS) ||
      !isDeepStrictEqual(value.authority, G17_BENCHMARK_BUILD_PROCESS_AUTHORITY) ||
      value.binding !== null ||
      value.finalDecisionEligible !== false
    ) {
      fail("process evidence overclaims verification, authority, or binding");
    }
    return deepFreeze({
      schema: G17_BENCHMARK_BUILD_PROCESS_PROJECTION_SCHEMA,
      status: "CARGO_INVOCATION_ENVIRONMENT_AND_CAPTURE_CLAIMS_REPLAYED",
      finalDecisionEligible: false,
      binding: null,
      controlRunId: value.controlRunId,
      buildId: value.buildId,
      productRole: value.productRole,
      rawSha256: decoded.rawSha256,
      contentHash: value.contentHash,
      executionPlanSha256: G17_BENCHMARK_EXECUTION_PLAN_SHA256,
      environmentRecipeSha256: G17_BENCHMARK_ENVIRONMENT_RECIPE_SHA256,
      source: sourceBinding,
      workspace: {
        generation: value.workspace.generation,
        targetGeneration: value.workspace.targetGeneration,
        parentRoot: expected.source.parentRoot,
        sourceChild: expected.source.sourceChild,
        targetChild: expected.source.targetChild,
        mounts: value.workspace.mounts,
        targetEmptyAtStart: value.workspace.targetEmptyAtStart,
        privateDirectories: Object.fromEntries(
          Object.entries(value.workspace.privateDirectories).map(
            ([name, directory]) => [
              name,
              {
                logicalPath: directory.logicalPath,
                device: directory.before.device,
                inode: directory.before.inode,
                filesystemType: directory.filesystemType,
              },
            ],
          ),
        ),
      },
      processGeneration: value.process.generation,
      program: value.process.program,
      environmentSha256: value.process.environmentSha256,
      logicalOwners: value.logicalOwners,
      streams: {
        stdout: { bytes: stdout.length, sha256: sha256(stdout) },
        stderr: { bytes: stderr.length, sha256: sha256(stderr) },
      },
      toolchain: {
        platformRootSha256: expected.platform.platformRootSha256,
        toolchainRootSha256: expected.platform.toolchainRootSha256,
        cargoSha256: sha256(cargo.bytes),
        rustcSha256: sha256(rustc.bytes),
        rustcRequest: value.process.environment.RUSTC,
      },
      executable: {
        logicalPath: executable.value.logicalPath,
        bytes: executable.bytes.length,
        sha256: sha256(executable.bytes),
        elfSha256: canonicalSha256(elf),
      },
      nonclaims: G17_BENCHMARK_BUILD_PROCESS_NONCLAIMS,
      authority: G17_BENCHMARK_BUILD_PROCESS_AUTHORITY,
    });
  } catch (error) {
    if (
      error?.message?.startsWith("G1.7 benchmark build process evidence:")
    ) {
      throw error;
    }
    fail(`dependency replay failed: ${error?.message ?? String(error)}`);
  }
}
