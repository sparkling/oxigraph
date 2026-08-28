import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// Pure replay for the physical owner that will implement the frozen
// linux-x86_64-cgroup-v2-non-tmpfs-serialized environment. This module does
// not acquire a lease, inspect a mount, create a cgroup, launch a process, or
// clean a directory. It only replays exact bytes emitted by that future owner.

export const G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA =
  "oxigraph.g1.7-non-tmpfs-containment-evidence/v1";
export const G17_NON_TMPFS_CONTAINMENT_PROJECTION_SCHEMA =
  "oxigraph.g1.7-non-tmpfs-containment-replay/v1";
export const G17_NON_TMPFS_CONTAINMENT_ARTIFACT_NAME =
  "non-tmpfs-containment.json";
export const G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS =
  "linux-x86_64-cgroup-v2-non-tmpfs-serialized";
export const G17_NON_TMPFS_CONTAINMENT_MAX_BYTES = 8 * 1024 * 1024;
export const G17_NON_TMPFS_CONTAINMENT_GLOBAL_LOCK_LOCATOR = Object.freeze({
  schema: "oxigraph.g1.7-global-harness-lock-locator/v1",
  rootPath: "/var/lib/oxigraph-engineering-harness/locks",
  component: "g1.7-phase-a.lock",
  resolver: "openat2-resolve-beneath-no-symlinks/v1",
});
export const G17_NON_TMPFS_EXPECTED_BINDINGS_PROVENANCE =
  "CALLER_SUPPLIED_UNSEALED_NONAUTHORITATIVE";

const LEASE_SCHEMA = "oxigraph.g1.7-harness-session-lease/v1";
const LEASE_ID_SCHEMA = "oxigraph.g1.7-harness-session-lease-id/v1";
const LEASE_ACQUISITION_SCHEMA =
  "oxigraph.g1.7-harness-session-lease-acquisition/v1";
const LEASE_CONTENDER_SCHEMA =
  "oxigraph.g1.7-harness-session-lease-contender/v1";
const LEASE_CONTENDER_ID_SCHEMA =
  "oxigraph.g1.7-harness-session-lease-contender-id/v1";
const GLOBAL_LOCK_LOCATOR_SCHEMA =
  "oxigraph.g1.7-global-harness-lock-locator/v1";
const GLOBAL_LOCK_ANCESTRY_SCHEMA =
  "oxigraph.g1.7-held-global-harness-lock-ancestry/v1";
const ANCESTRY_SCHEMA = "oxigraph.g1.7-held-directory-ancestry/v1";
const CGROUP_PATH_SCHEMA = "oxigraph.g1.7-containment-cgroup-path/v1";
const QUIESCENCE_SCHEMA = "oxigraph.g1.7-containment-quiescence/v1";
const CLEANUP_SCHEMA = "oxigraph.g1.7-containment-cleanup/v1";
const CLEANUP_INVENTORY_SCHEMA =
  "oxigraph.g1.7-containment-cleanup-inventory/v1";
const CLEANUP_STATE_GENERATION_SCHEMA =
  "oxigraph.g1.7-containment-state-generation/v1";
const HELD_SOURCE = "openat2-held-fd-fstat-fstatfs-statx-mnt-id/v1";
const ANCESTRY_RESOLVER = "openat2-resolve-beneath-no-symlinks/v1";
const ABSENCE_PROBE = "openat2-resolve-beneath-no-symlinks/v1";
const LEASE_MECHANISM = "flock-lock-ex-nb/v1";
const LEASE_SCOPE = "engineering-harness-g1.7";
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const MAX_RAW_MOUNTINFO_BYTES = 1024 * 1024;
const MAX_RAW_CGROUP_BYTES = 65_536;
const MAX_CLEANUP_INVENTORY_BYTES = 1024 * 1024;
const MAX_CLEANUP_INVENTORY_ENTRIES = 4_096;
const MAX_MOUNTINFO_ROWS = 4_096;
const MAX_MOUNTINFO_ROW_BYTES = 65_536;
const MAX_SNAPSHOT_NODES = 100_000;
const MAX_SNAPSHOT_DEPTH = 64;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_STRING_BYTES = 2 * 1024 * 1024;
const MAX_SINGLE_STRING_BYTES = 1024 * 1024;
const MAX_DECIMAL_DIGITS = 32;
const MAX_MOUNT_NUMBER_DIGITS = 20;
const MAX_DEVICE_COMPONENT = 0xffff_ffffn;
const MAX_PID = 4_194_304n;
const TMPFS_MAGIC = 0x0102_1994n;
const RAMFS_MAGIC = 0x8584_58f6n;
const CGROUP2_MAGIC = 0x6367_7270n;
const utf8 = new TextDecoder("utf-8", { fatal: true });

const OBSERVATION_PHASES = Object.freeze([
  "controller-before",
  "worker-before",
  "worker-after",
  "controller-after",
]);
const LEASE_PHASES = Object.freeze([
  "acquired",
  "controller-before",
  "worker-before",
  "worker-after",
  "controller-after",
  "quiesced",
  "cleanup-complete",
  "released",
]);
const AUTHORITY = Object.freeze({
  controlExecution: false,
  qualificationExecution: false,
  promotion: false,
  publication: false,
  routerQuality: false,
  providerExecution: false,
});
const NONCLAIMS = Object.freeze({
  dedicatedHost: false,
  dedicatedCpuset: false,
  hardVolumeQuota: false,
  localPhysicalDisk: false,
  hostWideExclusivity: false,
  sameUidTamperResistance: false,
  crashDurability: false,
  powerLossDurability: false,
  filesystemFlushDurability: false,
  maliciousHostOrKernelResistance: false,
  independentlyReviewedExpectedBindings: false,
  sealedExpectedBindings: false,
});

export const G17_NON_TMPFS_CONTAINMENT_LIMITS = Object.freeze({
  maxArtifactBytes: G17_NON_TMPFS_CONTAINMENT_MAX_BYTES,
  maxMountinfoBytes: MAX_RAW_MOUNTINFO_BYTES,
  maxMountinfoRows: MAX_MOUNTINFO_ROWS,
  maxMountinfoRowBytes: MAX_MOUNTINFO_ROW_BYTES,
  maxCgroupFileBytes: MAX_RAW_CGROUP_BYTES,
  maxCleanupInventoryBytes: MAX_CLEANUP_INVENTORY_BYTES,
  maxCleanupInventoryEntries: MAX_CLEANUP_INVENTORY_ENTRIES,
  maxSnapshotNodes: MAX_SNAPSHOT_NODES,
  maxSnapshotDepth: MAX_SNAPSHOT_DEPTH,
  maxArrayLength: MAX_ARRAY_LENGTH,
  maxStringBytes: MAX_STRING_BYTES,
  maxSingleStringBytes: MAX_SINGLE_STRING_BYTES,
});

function fail(message) {
  throw new Error(`G1.7 non-tmpfs containment contract: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function snapshotData(
  value,
  label,
  ancestors = new WeakSet(),
  budget = { nodes: 0, stringBytes: 0 },
  depth = 0,
) {
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) {
    fail(`${label} exceeds its structural replay budget`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    const bytes = Buffer.byteLength(value, "utf8");
    budget.stringBytes += bytes;
    if (
      bytes > MAX_SINGLE_STRING_BYTES ||
      budget.stringBytes > MAX_STRING_BYTES
    ) {
      fail(`${label} exceeds its string replay budget`);
    }
    return value;
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
    fail(`${label} must contain ordinary JSON objects and arrays`);
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) {
      fail(`${label} contains symbol fields`);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if ("get" in descriptor || "set" in descriptor) {
        fail(`${label}.${key} contains an accessor`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_ARRAY_LENGTH
      ) {
        fail(`${label} array length is outside its replay budget`);
      }
      const expected = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ].sort();
      if (!isDeepStrictEqual([...keys].sort(), expected)) {
        fail(`${label} arrays must be dense and field-free`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          ancestors,
          budget,
          depth + 1,
        ),
      );
    }
    const result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) fail(`${label}.${key} is not enumerable`);
      Object.defineProperty(result, key, {
        value: snapshotData(
          descriptor.value,
          `${label}.${key}`,
          ancestors,
          budget,
          depth + 1,
        ),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical data contains a non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
    .join(",")}}`;
}

function canonicalJson(value) {
  return canonicalValue(value);
}

function canonicalSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function validateSelfHash(value, label) {
  digest(value.contentHash, `${label} contentHash`);
  const { contentHash, ...unsigned } = value;
  if (contentHash !== canonicalSha256(unsigned)) {
    fail(`${label} contentHash does not verify`);
  }
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
  ) {
    fail(`${label} fields are not exact`);
  }
}

function exactOptionEnvelope(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be an ordinary object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort())
  ) {
    fail(`${label} fields are not exact`);
  }
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if ("get" in descriptor || "set" in descriptor || !descriptor.enumerable) {
      fail(`${label}.${key} must be an enumerable data field`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function decimal(value, label, minimum = 0n, maximum = null) {
  if (
    typeof value !== "string" ||
    value.length > MAX_DECIMAL_DIGITS ||
    !DECIMAL.test(value)
  ) {
    fail(`${label} is not a bounded canonical decimal`);
  }
  const result = BigInt(value);
  if (result < minimum || (maximum !== null && result > maximum)) {
    fail(`${label} is outside its allowed range`);
  }
  return result;
}

function workerPid(value, label) {
  return decimal(value, label, 1n, MAX_PID);
}

function timestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(`${label} is not a canonical UTC timestamp`);
  }
  return milliseconds;
}

function byteRecord(value, label, maximumBytes, allowEmpty = false) {
  exactKeys(value, ["bytes", "sha256", "base64"], label);
  if (
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < (allowEmpty ? 0 : 1) ||
    value.bytes > maximumBytes ||
    !CANONICAL_BASE64.test(value.base64 ?? "")
  ) {
    fail(`${label} byte record is malformed`);
  }
  const bytes = Buffer.from(value.base64, "base64");
  if (
    bytes.length !== value.bytes ||
    bytes.toString("base64") !== value.base64 ||
    sha256(bytes) !== value.sha256
  ) {
    fail(`${label} byte identity does not verify`);
  }
  return bytes;
}

function rawText(value, label, maximumBytes, allowEmpty = false) {
  const bytes = byteRecord(value, label, maximumBytes, allowEmpty);
  try {
    return utf8.decode(bytes);
  } catch (error) {
    fail(`${label} is not UTF-8: ${error.message}`);
  }
}

function validateLimits(value, label) {
  exactKeys(
    value,
    [
      "memoryMaxBytes",
      "memorySwapMaxBytes",
      "pidsMax",
      "cpuQuotaMicros",
      "cpuPeriodMicros",
      "maxStateBytes",
      "maxStateEntries",
      "maxStateDepth",
      "totalWallMs",
    ],
    label,
  );
  for (const key of [
    "memoryMaxBytes",
    "memorySwapMaxBytes",
    "pidsMax",
    "cpuPeriodMicros",
    "maxStateBytes",
    "maxStateEntries",
    "maxStateDepth",
    "totalWallMs",
  ]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      fail(`${label} ${key} is invalid`);
    }
  }
  if (
    value.memoryMaxBytes < 16 * 1024 * 1024 ||
    value.memoryMaxBytes > 68_719_476_736 ||
    value.memorySwapMaxBytes > value.memoryMaxBytes ||
    value.pidsMax < 1 ||
    value.pidsMax > 4_096 ||
    !(
      value.cpuQuotaMicros === null ||
      (Number.isSafeInteger(value.cpuQuotaMicros) &&
        value.cpuQuotaMicros >= 1_000 &&
        value.cpuQuotaMicros <= 1_000_000)
    ) ||
    value.cpuPeriodMicros < 1_000 ||
    value.cpuPeriodMicros > 1_000_000 ||
    value.maxStateBytes < 1 ||
    value.maxStateBytes > 137_438_953_472 ||
    value.maxStateEntries < 1 ||
    value.maxStateEntries > 500_000 ||
    value.maxStateDepth < 1 ||
    value.maxStateDepth > 128 ||
    value.totalWallMs < 1_000 ||
    value.totalWallMs > 7_200_000
  ) {
    fail(`${label} is outside the frozen containment ceilings`);
  }
  return value;
}

function processIdentity(value, label) {
  exactKeys(value, ["pid", "generation"], label);
  workerPid(value.pid, `${label} pid`);
  if (!SAFE_ID.test(value.generation ?? "")) {
    fail(`${label} generation is unsafe`);
  }
  return value;
}

function canonicalAbsolutePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 2 ||
    value.length > 4_096 ||
    !value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.includes("\\") ||
    !/^\/[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/u.test(value) ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    fail(`${label} is not a canonical absolute path`);
  }
  return value;
}

function validateGlobalLockLocator(value, label) {
  exactKeys(value, ["schema", "rootPath", "component", "resolver"], label);
  if (
    value.schema !== GLOBAL_LOCK_LOCATOR_SCHEMA ||
    value.resolver !== ANCESTRY_RESOLVER ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(value.component ?? "") ||
    value.component === "." ||
    value.component === ".."
  ) {
    fail(`${label} generation drifted`);
  }
  canonicalAbsolutePath(value.rootPath, `${label} rootPath`);
  if (!isDeepStrictEqual(value, G17_NON_TMPFS_CONTAINMENT_GLOBAL_LOCK_LOCATOR)) {
    fail(`${label} differs from the frozen global lock locator`);
  }
  return value;
}

function assertDistinctProcessIdentities(identities, label) {
  if (
    new Set(identities.map(({ pid }) => pid)).size !== identities.length ||
    new Set(identities.map(({ generation }) => generation)).size !== identities.length
  ) {
    fail(`${label} are not pairwise distinct`);
  }
}

function deriveCgroupPath({
  runId,
  ownerInputSha256,
  controllerPid,
  controllerGeneration,
  workerPid: expectedWorkerPid,
  workerGeneration,
}) {
  if (!SAFE_ID.test(runId ?? "")) fail("cgroup path run id is unsafe");
  digest(ownerInputSha256, "cgroup path owner input");
  workerPid(controllerPid, "cgroup path controller pid");
  workerPid(expectedWorkerPid, "cgroup path worker pid");
  if (
    !SAFE_ID.test(controllerGeneration ?? "") ||
    !SAFE_ID.test(workerGeneration ?? "")
  ) {
    fail("cgroup path controller or worker generation is unsafe");
  }
  const suffix = canonicalSha256({
    schema: CGROUP_PATH_SCHEMA,
    runId,
    ownerInputSha256,
    controllerPid,
    controllerGeneration,
    workerPid: expectedWorkerPid,
    workerGeneration,
  });
  return `/${LEASE_SCOPE}/${runId}-${suffix}`;
}

export function deriveG17NonTmpfsContainmentCgroupPath(options) {
  try {
    const value = exactOptionEnvelope(
      options,
      [
        "runId",
        "ownerInputSha256",
        "controllerPid",
        "controllerGeneration",
        "workerPid",
        "workerGeneration",
      ],
      "containment cgroup path options",
    );
    return deriveCgroupPath(value);
  } catch (error) {
    if (error?.message?.startsWith("G1.7 non-tmpfs containment contract:")) {
      throw error;
    }
    fail(error?.message ?? String(error));
  }
}

function validateExpected(value) {
  exactKeys(
    value,
    [
      "runId",
      "ownerInputSha256",
      "platformManifestSha256",
      "controllerClosureSha256",
      "workspaceProjectionSha256",
      "ownerUid",
      "ownerGid",
      "globalLockLocator",
      "controllerPid",
      "controllerGeneration",
      "holderPid",
      "holderGeneration",
      "workerPid",
      "workerGeneration",
      "limits",
    ],
    "expected containment binding",
  );
  if (!SAFE_ID.test(value.runId ?? "")) fail("expected run id is unsafe");
  for (const key of [
    "ownerInputSha256",
    "platformManifestSha256",
    "controllerClosureSha256",
    "workspaceProjectionSha256",
  ]) {
    digest(value[key], `expected ${key}`);
  }
  decimal(value.ownerUid, "expected owner uid");
  decimal(value.ownerGid, "expected owner gid");
  validateGlobalLockLocator(
    value.globalLockLocator,
    "expected global lock locator",
  );
  const processes = [
    processIdentity(
      { pid: value.controllerPid, generation: value.controllerGeneration },
      "expected controller",
    ),
    processIdentity(
      { pid: value.holderPid, generation: value.holderGeneration },
      "expected holder",
    ),
    processIdentity(
      { pid: value.workerPid, generation: value.workerGeneration },
      "expected worker",
    ),
  ];
  assertDistinctProcessIdentities(processes, "expected process identities");
  validateLimits(value.limits, "expected containment limits");
  return value;
}

function validateIdentity(value, label, expectedKind) {
  exactKeys(
    value,
    ["kind", "device", "inode", "uid", "gid", "mode", "links", "mountId"],
    label,
  );
  if (value.kind !== expectedKind) fail(`${label} kind is invalid`);
  decimal(value.device, `${label} device`, 1n);
  decimal(value.inode, `${label} inode`, 1n);
  decimal(value.uid, `${label} uid`);
  decimal(value.gid, `${label} gid`);
  decimal(value.mode, `${label} mode`, 0n, 0o7777n);
  decimal(value.links, `${label} links`, 1n);
  decimal(value.mountId, `${label} mount id`, 1n);
  return value;
}

function globalLockAncestryEvidence(root, lock, locator) {
  return {
    schema: GLOBAL_LOCK_ANCESTRY_SCHEMA,
    source: HELD_SOURCE,
    resolver: ANCESTRY_RESOLVER,
    rootPath: locator.rootPath,
    rootIdentity: root,
    component: locator.component,
    lockIdentity: lock,
    result: "SAME_OBJECT",
  };
}

function validateGlobalLockAncestry(value, locator, lock, expected, label) {
  exactKeys(
    value,
    [
      "schema",
      "source",
      "resolver",
      "rootPath",
      "rootIdentity",
      "component",
      "lockIdentity",
      "result",
    ],
    label,
  );
  const root = validateIdentity(value.rootIdentity, `${label} root`, "directory");
  const heldLock = validateIdentity(value.lockIdentity, `${label} lock`, "regular");
  if (
    root.uid !== expected.ownerUid ||
    root.gid !== expected.ownerGid ||
    root.mode !== "448" ||
    heldLock.uid !== expected.ownerUid ||
    heldLock.gid !== expected.ownerGid ||
    heldLock.mode !== "384" ||
    heldLock.links !== "1" ||
    root.device !== heldLock.device ||
    root.mountId !== heldLock.mountId ||
    root.inode === heldLock.inode ||
    !isDeepStrictEqual(heldLock, lock) ||
    !isDeepStrictEqual(value, globalLockAncestryEvidence(root, lock, locator))
  ) {
    fail(`${label} does not replay the reviewed held root-to-lock object`);
  }
  return { root, lock: heldLock };
}

function persistentIdentity(value) {
  return {
    kind: value.kind,
    device: value.device,
    inode: value.inode,
    mode: value.mode,
    links: value.links,
  };
}

function validateStatfs(value, label, state) {
  exactKeys(
    value,
    [
      "type",
      "blockSize",
      "blocks",
      "blocksFree",
      "blocksAvailable",
      "files",
      "filesFree",
    ],
    label,
  );
  const result = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      decimal(item, `${label} ${key}`),
    ]),
  );
  if (
    result.type < 1n ||
    result.blockSize < 1n ||
    result.blocksFree > result.blocks ||
    result.blocksAvailable > result.blocksFree ||
    result.filesFree > result.files ||
    (state && result.blocks < 1n)
  ) {
    fail(`${label} is contradictory`);
  }
  if (state && [TMPFS_MAGIC, RAMFS_MAGIC].includes(result.type)) {
    fail(`${label} is tmpfs or ramfs`);
  }
  if (!state && result.type !== CGROUP2_MAGIC) {
    fail(`${label} is not cgroup v2`);
  }
  return result;
}

function decodeMountField(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail(`${label} is malformed`);
  }
  const decoded = value.replace(/\\(040|011|012|134)/gu, (_, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8)));
  if (decoded.includes("\\") || decoded.includes("\0")) {
    fail(`${label} contains an unsupported mountinfo escape`);
  }
  return decoded;
}

function absoluteMountPath(value, label) {
  const decoded = decodeMountField(value, label);
  if (
    !decoded.startsWith("/") ||
    decoded.includes("//") ||
    (decoded.length > 1 && decoded.endsWith("/")) ||
    decoded.split("/").some((part) => part === "." || part === "..")
  ) {
    fail(`${label} is not a canonical absolute mount path`);
  }
  return decoded;
}

function mountOptionList(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.includes(" ") ||
    value.includes("\\")
  ) {
    fail(`${label} is malformed`);
  }
  const options = value.split(",");
  if (
    options.some(
      (option) =>
        !/^[A-Za-z0-9][A-Za-z0-9._=:+/-]{0,255}$/u.test(option),
    ) ||
    new Set(options).size !== options.length
  ) {
    fail(`${label} is malformed or duplicated`);
  }
  return options;
}

function encodedDevice(value, label) {
  const match = new RegExp(
    `^(0|[1-9][0-9]{0,${MAX_MOUNT_NUMBER_DIGITS - 1}}):(0|[1-9][0-9]{0,${MAX_MOUNT_NUMBER_DIGITS - 1}})$`,
    "u",
  ).exec(value ?? "");
  if (match === null) fail(`${label} device is malformed`);
  const major = BigInt(match[1]);
  const minor = BigInt(match[2]);
  if (major > MAX_DEVICE_COMPONENT || minor > MAX_DEVICE_COMPONENT) {
    fail(`${label} device component is outside its range`);
  }
  return (
    ((major & 0xfffn) << 8n) |
    (minor & 0xffn) |
    ((major & ~0xfffn) << 32n) |
    ((minor & ~0xffn) << 12n)
  ).toString();
}

function normalizedMount(text, mountId, label) {
  if (!text.endsWith("\n")) fail(`${label} mountinfo lacks its final LF`);
  const rows = text.slice(0, -1).split("\n");
  if (
    rows.length < 1 ||
    rows.length > MAX_MOUNTINFO_ROWS ||
    rows.some(
      (row) =>
        row.length < 1 || Buffer.byteLength(row, "utf8") > MAX_MOUNTINFO_ROW_BYTES,
    )
  ) {
    fail(`${label} mountinfo row inventory is not bounded`);
  }
  const matches = rows.filter((row) => row.split(" ")[0] === mountId);
  if (matches.length !== 1) fail(`${label} mount id is not unique`);
  const fields = matches[0].split(" ");
  const separators = fields.flatMap((field, index) =>
    field === "-" ? [index] : []);
  const separator = separators[0];
  if (
    fields.some((field) => field.length === 0) ||
    separators.length !== 1 ||
    separator < 6 ||
    fields.length !== separator + 4 ||
    !new RegExp(`^[1-9][0-9]{0,${MAX_MOUNT_NUMBER_DIGITS - 1}}$`, "u").test(
      fields[0] ?? "",
    ) ||
    !new RegExp(`^(?:0|[1-9][0-9]{0,${MAX_MOUNT_NUMBER_DIGITS - 1}})$`, "u").test(
      fields[1] ?? "",
    )
  ) {
    fail(`${label} mountinfo row is malformed`);
  }
  const options = mountOptionList(fields[5], `${label} mount options`);
  const readOnly = options.includes("ro");
  const readWrite = options.includes("rw");
  if (readOnly === readWrite) fail(`${label} mount access is ambiguous`);
  const optionalFields = fields.slice(6, separator);
  const optionalNames = optionalFields.map((field) => field.split(":", 1)[0]);
  if (
    optionalFields.some(
      (field) =>
        !/^(?:shared:[1-9][0-9]{0,19}|master:[1-9][0-9]{0,19}|propagate_from:[1-9][0-9]{0,19}|unbindable)$/u.test(
          field,
        ),
    ) ||
    new Set(optionalNames).size !== optionalNames.length
  ) {
    fail(`${label} optional mount fields are malformed`);
  }
  const filesystem = fields[separator + 1];
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u.test(filesystem ?? "")) {
    fail(`${label} filesystem name is malformed`);
  }
  return {
    mountId: fields[0],
    parentMountId: fields[1],
    device: encodedDevice(fields[2], label),
    root: absoluteMountPath(fields[3], `${label} root`),
    mountPoint: absoluteMountPath(fields[4], `${label} mount point`),
    access: readOnly ? "ro" : "rw",
    filesystem,
    source: decodeMountField(fields[separator + 2], `${label} source`),
    superOptions: mountOptionList(
      fields[separator + 3],
      `${label} super options`,
    ).join(","),
    optionalFields,
  };
}

function validateClaimedMount(value, mountinfoText, label) {
  exactKeys(
    value,
    [
      "mountId",
      "parentMountId",
      "device",
      "root",
      "mountPoint",
      "access",
      "filesystem",
      "source",
      "superOptions",
      "optionalFields",
    ],
    label,
  );
  const replayed = normalizedMount(mountinfoText, value.mountId, label);
  if (!isDeepStrictEqual(value, replayed)) {
    fail(`${label} differs from raw mountinfo`);
  }
  return value;
}

function parseUnsignedText(text, label) {
  if (
    text.length > MAX_DECIMAL_DIGITS + 1 ||
    !/^(?:0|[1-9][0-9]*)\n$/u.test(text)
  ) {
    fail(`${label} is not one canonical unsigned line`);
  }
  return BigInt(text.slice(0, -1));
}

function parsePidLines(text, label, allowEmpty) {
  if (text === "" && allowEmpty) return [];
  if (!/^(?:[1-9][0-9]*\n)+$/u.test(text)) {
    fail(`${label} is not a canonical PID list`);
  }
  const rawValues = text.trimEnd().split("\n");
  const values = rawValues.map((value) => Number(value));
  if (
    rawValues.some((value) => value.length > 7) ||
    values.some(
      (value) =>
        !Number.isSafeInteger(value) || value < 1 || value > Number(MAX_PID),
    ) ||
    new Set(values).size !== values.length
  ) {
    fail(`${label} contains invalid or duplicate PIDs`);
  }
  return values;
}

function parseCgroupEvents(text, label) {
  if (!text.endsWith("\n")) fail(`${label} lacks its final LF`);
  const result = new Map();
  for (const row of text.trimEnd().split("\n")) {
    const match = new RegExp(
      `^([a-z][a-z0-9_.-]{0,63}) (0|[1-9][0-9]{0,${MAX_DECIMAL_DIGITS - 1}})$`,
      "u",
    ).exec(row);
    if (match === null || result.has(match[1])) fail(`${label} is malformed`);
    result.set(match[1], BigInt(match[2]));
  }
  return result;
}

function safeCgroupPath(value, label) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 4_096 ||
    value.includes("//") ||
    value === "/" ||
    value.includes("\0") ||
    value.split("/").some((part) => part === "." || part === "..") ||
    !/^\/[A-Za-z0-9_.@:/-]*$/u.test(value)
  ) {
    fail(`${label} is unsafe`);
  }
  return value;
}

function validateCgroup(value, mountinfoText, expected, phase, label) {
  const limits = expected.limits;
  exactKeys(
    value,
    [
      "relativePath",
      "directory",
      "mount",
      "statfs",
      "membership",
      "controllers",
      "cgroupType",
      "memoryMax",
      "memorySwapMax",
      "pidsMax",
      "cpuMax",
      "pidsCurrent",
      "procs",
      "events",
      "worker",
    ],
    label,
  );
  const relativePath = safeCgroupPath(value.relativePath, `${label} path`);
  const expectedPath = deriveCgroupPath(expected);
  exactKeys(value.worker, ["pid", "generation"], `${label} worker`);
  const expectedWorkerPid = workerPid(expected.workerPid, `${label} expected worker pid`);
  if (
    relativePath !== expectedPath ||
    value.worker.pid !== expected.workerPid ||
    value.worker.generation !== expected.workerGeneration
  ) {
    fail(`${label} path or worker generation differs from the expected run`);
  }
  const directory = validateIdentity(value.directory, `${label} directory`, "directory");
  const mount = validateClaimedMount(value.mount, mountinfoText, `${label} mount`);
  const statfs = validateStatfs(value.statfs, `${label} statfs`, false);
  const workerPhase = phase.startsWith("worker-");
  if (
    directory.mountId !== mount.mountId ||
    directory.device !== mount.device ||
    mount.filesystem !== "cgroup2" ||
    (workerPhase &&
      (mount.root !== relativePath ||
        mount.mountPoint !== "/control/cgroup2" ||
        mount.access !== "ro")) ||
    (!workerPhase &&
      (mount.root !== "/" ||
        mount.mountPoint !== "/sys/fs/cgroup" ||
        mount.access !== "rw"))
  ) {
    fail(`${label} held directory or exact cgroup-v2 mount differs`);
  }
  const after = phase === "controller-after";
  const membership = rawText(
    value.membership,
    `${label} membership`,
    MAX_RAW_CGROUP_BYTES,
    after,
  );
  if (membership !== (after ? "" : `0::${relativePath}\n`)) {
    fail(`${label} membership does not bind the held cgroup`);
  }
  const controllers = rawText(
    value.controllers,
    `${label} controllers`,
    MAX_RAW_CGROUP_BYTES,
  );
  if (!/^(?:[a-z][a-z0-9_.-]*)(?: [a-z][a-z0-9_.-]*)*\n$/u.test(controllers)) {
    fail(`${label} controllers are malformed`);
  }
  const controllerNames = controllers.trim().split(" ");
  const controllerSet = new Set(controllerNames);
  if (controllerSet.size !== controllerNames.length) {
    fail(`${label} controllers are duplicated`);
  }
  if (["cpu", "memory", "pids"].some((name) => !controllerSet.has(name))) {
    fail(`${label} required controllers are unavailable`);
  }
  if (rawText(value.cgroupType, `${label} type`, MAX_RAW_CGROUP_BYTES) !== "domain\n") {
    fail(`${label} is not a domain cgroup`);
  }
  const exactLimit = (record, expected, name) => {
    const observed = rawText(record, `${label} ${name}`, MAX_RAW_CGROUP_BYTES);
    if (observed !== expected) fail(`${label} ${name} bytes drifted`);
  };
  exactLimit(value.memoryMax, `${limits.memoryMaxBytes}\n`, "memory.max");
  exactLimit(value.memorySwapMax, `${limits.memorySwapMaxBytes}\n`, "memory.swap.max");
  exactLimit(value.pidsMax, `${limits.pidsMax}\n`, "pids.max");
  exactLimit(
    value.cpuMax,
    `${limits.cpuQuotaMicros === null ? "max" : limits.cpuQuotaMicros} ${limits.cpuPeriodMicros}\n`,
    "cpu.max",
  );
  const current = parseUnsignedText(
    rawText(value.pidsCurrent, `${label} pids.current`, MAX_RAW_CGROUP_BYTES),
    `${label} pids.current`,
  );
  const procs = parsePidLines(
    rawText(value.procs, `${label} cgroup.procs`, MAX_RAW_CGROUP_BYTES, after),
    `${label} cgroup.procs`,
    after,
  );
  const events = parseCgroupEvents(
    rawText(value.events, `${label} cgroup.events`, MAX_RAW_CGROUP_BYTES),
    `${label} cgroup.events`,
  );
  if (after) {
    if (current !== 0n || procs.length !== 0 || events.get("populated") !== 0n) {
      fail(`${label} is not quiescent`);
    }
  } else if (
    current < 1n ||
    current > BigInt(limits.pidsMax) ||
    procs.length < 1 ||
    BigInt(procs.length) > current ||
    !procs.includes(Number(expectedWorkerPid)) ||
    events.get("populated") !== 1n
  ) {
    fail(`${label} does not prove a live bounded cgroup`);
  }
  return { directory, mount, statfs, relativePath, current, procs };
}

function ancestryEvidence(root, run, state, expected) {
  return {
    schema: ANCESTRY_SCHEMA,
    resolver: ANCESTRY_RESOLVER,
    edges: [
      {
        parent: "root",
        child: "run",
        component: expected.runId,
        parentIdentity: root,
        childIdentity: run,
        result: "SAME_OBJECT",
      },
      {
        parent: "run",
        child: "state",
        component: "state",
        parentIdentity: run,
        childIdentity: state,
        result: "SAME_OBJECT",
      },
    ],
  };
}

function validateHeld(value, expected, controller, label) {
  exactKeys(
    value,
    ["source", "root", "run", "state", "cgroup", "ancestry"],
    label,
  );
  if (value.source !== HELD_SOURCE) fail(`${label} evidence source drifted`);
  if (controller) {
    if (value.root === null || value.run === null) {
      fail(`${label} lacks the controller root/run chain`);
    }
  } else if (value.root !== null || value.run !== null) {
    fail(`${label} worker may not claim the controller root/run chain`);
  }
  const root = value.root === null
    ? null
    : validateIdentity(value.root, `${label} root`, "directory");
  const run = value.run === null
    ? null
    : validateIdentity(value.run, `${label} run`, "directory");
  const state = validateIdentity(value.state, `${label} state`, "directory");
  const cgroup = validateIdentity(value.cgroup, `${label} cgroup`, "directory");
  if (controller) {
    const chain = [root, run, state];
    if (
      chain.some(
        (item) =>
          item.uid !== expected.ownerUid ||
          item.gid !== expected.ownerGid ||
          item.mode !== "448",
      ) ||
      new Set(chain.map(({ inode }) => inode)).size !== chain.length ||
      chain.some(
        (item) =>
          item.device !== root.device || item.mountId !== root.mountId,
      )
    ) {
      fail(`${label} root/run/state owner or identity chain drifted`);
    }
    if (
      !isDeepStrictEqual(
        value.ancestry,
        ancestryEvidence(root, run, state, expected),
      )
    ) {
      fail(`${label} root/run/state ancestry evidence drifted`);
    }
  } else if (
    state.uid !== "0" ||
    state.gid !== "0" ||
    state.mode !== "448"
  ) {
    fail(`${label} worker state is not namespace-root owner-only`);
  } else if (value.ancestry !== null) {
    fail(`${label} worker may not claim controller ancestry evidence`);
  }
  return { root, run, state, cgroup };
}

function validateObservation(value, expected, phase) {
  const label = `${phase} observation`;
  exactKeys(
    value,
    [
      "phase",
      "observedAt",
      "leaseId",
      "mountinfo",
      "held",
      "stateStatfs",
      "stateMount",
      "cgroup",
    ],
    label,
  );
  if (value.phase !== phase) fail(`${label} phase drifted`);
  const observedAt = timestamp(value.observedAt, `${label} timestamp`);
  digest(value.leaseId, `${label} lease id`);
  const mountinfoText = rawText(
    value.mountinfo,
    `${label} mountinfo`,
    MAX_RAW_MOUNTINFO_BYTES,
  );
  const controller = phase.startsWith("controller-");
  const held = validateHeld(value.held, expected, controller, `${label} held objects`);
  const stateStatfs = validateStatfs(
    value.stateStatfs,
    `${label} state statfs`,
    true,
  );
  const stateMount = validateClaimedMount(
    value.stateMount,
    mountinfoText,
    `${label} state mount`,
  );
  if (
    held.state.mountId !== stateMount.mountId ||
    held.state.device !== stateMount.device ||
    ["tmpfs", "ramfs"].includes(stateMount.filesystem) ||
    stateMount.access !== "rw" ||
    (!controller && stateMount.mountPoint !== "/state")
  ) {
    fail(`${label} state mount is not the held writable non-tmpfs state`);
  }
  const cgroup = validateCgroup(
    value.cgroup,
    mountinfoText,
    expected,
    phase,
    `${label} cgroup`,
  );
  if (!isDeepStrictEqual(held.cgroup, cgroup.directory)) {
    fail(`${label} held cgroup differs from its controller evidence`);
  }
  return { observedAt, held, stateStatfs, stateMount, cgroup };
}

function validateLease(value, expected, controllerBefore) {
  exactKeys(
    value,
    [
      "schema",
      "mechanism",
      "scope",
      "leaseId",
      "controller",
      "holder",
      "lockLocator",
      "lockAncestry",
      "lockObject",
      "acquiredAt",
      "acquisition",
      "contender",
      "observations",
      "releasedAt",
    ],
    "containment lease",
  );
  if (
    value.schema !== LEASE_SCHEMA ||
    value.mechanism !== LEASE_MECHANISM ||
    value.scope !== LEASE_SCOPE
  ) {
    fail("containment lease generation drifted");
  }
  const lock = validateIdentity(value.lockObject, "containment lease lock", "regular");
  const lockLocator = validateGlobalLockLocator(
    value.lockLocator,
    "containment lease global lock locator",
  );
  if (!isDeepStrictEqual(lockLocator, expected.globalLockLocator)) {
    fail("containment lease global lock locator drifted from its trusted binding");
  }
  const lockAncestry = validateGlobalLockAncestry(
    value.lockAncestry,
    lockLocator,
    lock,
    expected,
    "containment lease global lock ancestry",
  );
  if (
    lock.uid !== expected.ownerUid ||
    lock.gid !== expected.ownerGid ||
    lock.mode !== "384" ||
    lock.links !== "1" ||
    lock.device !== controllerBefore.held.root.device ||
    lock.mountId !== controllerBefore.held.root.mountId
  ) {
    fail("containment lease lock is not the exact held owner lock");
  }
  if (!isDeepStrictEqual(lockAncestry.root, controllerBefore.held.root)) {
    fail("containment lease global lock root differs from the held controller root");
  }
  const acquiredAt = timestamp(value.acquiredAt, "containment lease acquiredAt");
  const releasedAt = timestamp(value.releasedAt, "containment lease releasedAt");
  const expectedController = processIdentity(
    {
      pid: expected.controllerPid,
      generation: expected.controllerGeneration,
    },
    "expected controller",
  );
  const expectedHolder = processIdentity(
    { pid: expected.holderPid, generation: expected.holderGeneration },
    "expected holder",
  );
  const controller = processIdentity(
    value.controller,
    "containment lease controller",
  );
  const holder = processIdentity(value.holder, "containment lease holder");
  if (
    !isDeepStrictEqual(controller, expectedController) ||
    !isDeepStrictEqual(holder, expectedHolder)
  ) {
    fail("containment lease controller or holder drifted from its trusted binding");
  }
  const expectedLeaseId = canonicalSha256({
    schema: LEASE_ID_SCHEMA,
    runId: expected.runId,
    controller,
    holder,
    lockLocator,
    lockAncestry: value.lockAncestry,
    lockObject: lock,
    acquiredAt: value.acquiredAt,
  });
  if (value.leaseId !== expectedLeaseId) fail("containment lease id drifted");
  exactKeys(
    value.acquisition,
    [
      "schema",
      "operation",
      "flags",
      "result",
      "errno",
      "observedAt",
      "controller",
      "holder",
      "lockLocator",
      "lockAncestry",
      "lockObject",
    ],
    "containment lease acquisition",
  );
  const acquisitionController = processIdentity(
    value.acquisition.controller,
    "containment lease acquisition controller",
  );
  const acquisitionHolder = processIdentity(
    value.acquisition.holder,
    "containment lease acquisition holder",
  );
  if (
    value.acquisition.schema !== LEASE_ACQUISITION_SCHEMA ||
    value.acquisition.operation !== "flock" ||
    !isDeepStrictEqual(value.acquisition.flags, ["LOCK_EX", "LOCK_NB"]) ||
    value.acquisition.result !== "ACQUIRED" ||
    value.acquisition.errno !== null ||
    timestamp(
      value.acquisition.observedAt,
      "containment lease acquisition observedAt",
    ) !== acquiredAt ||
    !isDeepStrictEqual(acquisitionController, controller) ||
    !isDeepStrictEqual(acquisitionHolder, holder) ||
    !isDeepStrictEqual(value.acquisition.lockLocator, lockLocator) ||
    !isDeepStrictEqual(value.acquisition.lockAncestry, value.lockAncestry) ||
    !isDeepStrictEqual(value.acquisition.lockObject, lock)
  ) {
    fail("containment lease acquisition evidence drifted");
  }
  exactKeys(
    value.contender,
    [
      "schema",
      "operation",
      "flags",
      "result",
      "errno",
      "observedAt",
      "pid",
      "generation",
      "lockLocator",
      "lockAncestry",
      "lockObject",
    ],
    "containment lease contender",
  );
  workerPid(value.contender.pid, "containment lease contender pid");
  const contenderAt = timestamp(
    value.contender.observedAt,
    "containment lease contender observedAt",
  );
  const contenderGeneration = canonicalSha256({
    schema: LEASE_CONTENDER_ID_SCHEMA,
    runId: expected.runId,
    leaseId: value.leaseId,
    pid: value.contender.pid,
  });
  const worker = processIdentity(
    { pid: expected.workerPid, generation: expected.workerGeneration },
    "expected worker",
  );
  const contender = processIdentity(
    { pid: value.contender.pid, generation: value.contender.generation },
    "containment lease contender",
  );
  assertDistinctProcessIdentities(
    [controller, holder, worker, contender],
    "controller, holder, worker, and contender process identities",
  );
  if (
    value.contender.schema !== LEASE_CONTENDER_SCHEMA ||
    value.contender.operation !== "flock" ||
    !isDeepStrictEqual(value.contender.flags, ["LOCK_EX", "LOCK_NB"]) ||
    value.contender.result !== "BLOCKED" ||
    value.contender.errno !== "EWOULDBLOCK" ||
    value.contender.generation !== contenderGeneration ||
    !isDeepStrictEqual(value.contender.lockLocator, lockLocator) ||
    !isDeepStrictEqual(value.contender.lockAncestry, value.lockAncestry) ||
    !isDeepStrictEqual(value.contender.lockObject, lock)
  ) {
    fail("containment lease contender evidence drifted");
  }
  if (
    !Array.isArray(value.observations) ||
    value.observations.length !== LEASE_PHASES.length
  ) {
    fail("containment lease observation inventory is not exact");
  }
  let prior = -Infinity;
  const observations = new Map();
  for (const [index, observation] of value.observations.entries()) {
    exactKeys(
      observation,
      ["phase", "at", "held", "lockObject"],
      `lease observation ${index}`,
    );
    const phase = LEASE_PHASES[index];
    const at = timestamp(observation.at, `lease observation ${phase}`);
    if (
      observation.phase !== phase ||
      observation.held !== (phase !== "released") ||
      !isDeepStrictEqual(observation.lockObject, lock) ||
      at <= prior
    ) {
      fail(`lease observation ${phase} is contradictory`);
    }
    observations.set(phase, at);
    prior = at;
  }
  if (
    observations.get("acquired") !== acquiredAt ||
    observations.get("released") !== releasedAt ||
    !(acquiredAt < contenderAt && contenderAt < observations.get("controller-before"))
  ) {
    fail("containment lease endpoints drifted");
  }
  return {
    lock,
    acquiredAt,
    releasedAt,
    contenderAt,
    contenderGeneration,
    observations,
  };
}

function validateQuiescence(value, limits) {
  exactKeys(
    value,
    [
      "schema",
      "status",
      "observedAt",
      "workerExitDisposition",
      "workerExitCode",
      "workerSignal",
      "cgroupPopulated",
      "pidsCurrent",
      "processesRemaining",
    ],
    "containment quiescence",
  );
  const observedAt = timestamp(value.observedAt, "containment quiescence observedAt");
  if (
    value.schema !== QUIESCENCE_SCHEMA ||
    value.status !== "QUIESCENT" ||
    value.workerExitDisposition !== "completed" ||
    value.workerExitCode !== 0 ||
    value.workerSignal !== null ||
    value.cgroupPopulated !== false ||
    value.pidsCurrent !== 0 ||
    value.processesRemaining !== 0 ||
    value.pidsCurrent > limits.pidsMax
  ) {
    fail("containment quiescence is incomplete");
  }
  return observedAt;
}

function cleanupStateGeneration(runId, state) {
  return canonicalSha256({
    schema: CLEANUP_STATE_GENERATION_SCHEMA,
    runId,
    identity: state,
  });
}

function safeInventoryPath(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096 ||
    value.startsWith("/") ||
    value.includes("//") ||
    value.includes("\\") ||
    !/^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/u.test(value) ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    fail(`${label} is not a safe relative inventory path`);
  }
  return value;
}

function validateCleanupInventory(
  record,
  limits,
  expected,
  state,
  quiescedAt,
  cleanupCompletedAt,
) {
  const text = rawText(
    record,
    "containment cleanup raw inventory",
    MAX_CLEANUP_INVENTORY_BYTES,
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`containment cleanup inventory is invalid JSON: ${error.message}`);
  }
  const value = snapshotData(parsed, "containment cleanup inventory");
  if (!Buffer.from(text, "utf8").equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail("containment cleanup inventory is not canonical JSON plus one LF");
  }
  exactKeys(
    value,
    [
      "schema",
      "runId",
      "stateGeneration",
      "capturedAt",
      "entries",
      "entryCount",
      "totalBytes",
      "maxDepthObserved",
      "contentHash",
    ],
    "containment cleanup inventory",
  );
  const capturedAt = timestamp(
    value.capturedAt,
    "containment cleanup inventory capturedAt",
  );
  if (
    value.schema !== CLEANUP_INVENTORY_SCHEMA ||
    value.runId !== expected.runId ||
    value.stateGeneration !== cleanupStateGeneration(expected.runId, state) ||
    !(quiescedAt < capturedAt && capturedAt < cleanupCompletedAt) ||
    !Array.isArray(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > MAX_CLEANUP_INVENTORY_ENTRIES ||
    value.entries.length > limits.maxStateEntries
  ) {
    fail("containment cleanup inventory identity, ordering, or cardinality drifted");
  }
  let totalBytes = 0;
  let maxDepthObserved = 0;
  let previousPath = null;
  for (const [index, entry] of value.entries.entries()) {
    exactKeys(entry, ["path", "kind", "bytes", "sha256"], `cleanup entry ${index}`);
    const path = safeInventoryPath(entry.path, `cleanup entry ${index} path`);
    if (previousPath !== null && previousPath >= path) {
      fail("containment cleanup inventory is not strictly path-sorted");
    }
    previousPath = path;
    if (!new Set(["directory", "file", "symlink"]).has(entry.kind)) {
      fail(`cleanup entry ${index} kind is unsupported`);
    }
    if (
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      entry.bytes > limits.maxStateBytes
    ) {
      fail(`cleanup entry ${index} bytes are outside the state ceiling`);
    }
    digest(entry.sha256, `cleanup entry ${index} sha256`);
    totalBytes += entry.bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxStateBytes) {
      fail("containment cleanup inventory exceeds the state byte ceiling");
    }
    maxDepthObserved = Math.max(maxDepthObserved, path.split("/").length);
  }
  if (
    value.entryCount !== value.entries.length ||
    value.totalBytes !== totalBytes ||
    value.maxDepthObserved !== maxDepthObserved ||
    maxDepthObserved > limits.maxStateDepth
  ) {
    fail("containment cleanup inventory derived totals drifted");
  }
  validateSelfHash(value, "containment cleanup inventory");
  return {
    rawSha256: sha256(Buffer.from(text, "utf8")),
    entryCount: value.entryCount,
    totalBytes,
    maxDepthObserved,
    contentHash: value.contentHash,
    capturedAt,
  };
}

function validateUnlinkedIdentity(value, label) {
  exactKeys(
    value,
    ["kind", "device", "inode", "uid", "gid", "mode", "links", "mountId"],
    label,
  );
  if (value.kind !== "directory" || value.links !== "0") {
    fail(`${label} is not an unlinked held directory`);
  }
  decimal(value.device, `${label} device`, 1n);
  decimal(value.inode, `${label} inode`, 1n);
  decimal(value.uid, `${label} uid`);
  decimal(value.gid, `${label} gid`);
  decimal(value.mode, `${label} mode`, 0n, 0o7777n);
  decimal(value.links, `${label} links`, 0n, 0n);
  decimal(value.mountId, `${label} mount id`, 1n);
  return value;
}

function identityWithoutLinks(value) {
  const { links: ignored, ...identity } = value;
  return identity;
}

function validateAbsenceProbe(
  value,
  label,
  expectedLocation,
  beforeIdentity,
) {
  exactKeys(
    value,
    ["operation", ...Object.keys(expectedLocation), "result", "errno", "heldIdentity"],
    label,
  );
  const heldIdentity = validateUnlinkedIdentity(value.heldIdentity, `${label} held identity`);
  if (
    value.operation !== ABSENCE_PROBE ||
    value.result !== "ABSENT" ||
    value.errno !== "ENOENT" ||
    !Object.entries(expectedLocation).every(
      ([key, expectedValue]) => isDeepStrictEqual(value[key], expectedValue),
    ) ||
    !isDeepStrictEqual(
      identityWithoutLinks(heldIdentity),
      identityWithoutLinks(beforeIdentity),
    )
  ) {
    fail(`${label} does not bind exact pathname absence and held-object unlink`);
  }
}

function validateCleanup(
  value,
  limits,
  expected,
  controllerAfter,
  quiescedAt,
) {
  exactKeys(
    value,
    [
      "schema",
      "status",
      "completedAt",
      "inventory",
      "limits",
      "postCleanup",
      "errors",
    ],
    "containment cleanup",
  );
  const completedAt = timestamp(value.completedAt, "containment cleanup completedAt");
  exactKeys(
    value.limits,
    [
      "maxStateBytes",
      "maxStateEntries",
      "maxStateDepth",
      "maxInventoryBytes",
      "maxInventoryEntries",
    ],
    "containment cleanup limits",
  );
  exactKeys(
    value.postCleanup,
    ["observedAt", "state", "cgroup"],
    "containment post-cleanup observations",
  );
  if (
    value.schema !== CLEANUP_SCHEMA ||
    value.status !== "COMPLETE" ||
    value.limits.maxStateBytes !== limits.maxStateBytes ||
    value.limits.maxStateEntries !== limits.maxStateEntries ||
    value.limits.maxStateDepth !== limits.maxStateDepth ||
    value.limits.maxInventoryBytes !== MAX_CLEANUP_INVENTORY_BYTES ||
    value.limits.maxInventoryEntries !==
      Math.min(MAX_CLEANUP_INVENTORY_ENTRIES, limits.maxStateEntries) ||
    timestamp(
      value.postCleanup.observedAt,
      "containment post-cleanup observedAt",
    ) !== completedAt ||
    !Array.isArray(value.errors) ||
    value.errors.length !== 0
  ) {
    fail("containment cleanup is not exact and complete");
  }
  const inventory = validateCleanupInventory(
    value.inventory,
    limits,
    expected,
    controllerAfter.held.state,
    quiescedAt,
    completedAt,
  );
  const cgroupParts = deriveCgroupPath(expected).split("/").filter(Boolean);
  const cgroupComponent = cgroupParts.at(-1);
  const cgroupParentPath = `/${cgroupParts.slice(0, -1).join("/")}`;
  validateAbsenceProbe(
    value.postCleanup.state,
    "containment state cleanup probe",
    { parentIdentity: controllerAfter.held.run, component: "state" },
    controllerAfter.held.state,
  );
  validateAbsenceProbe(
    value.postCleanup.cgroup,
    "containment cgroup cleanup probe",
    {
      mount: controllerAfter.cgroup.mount,
      parentPath: cgroupParentPath,
      component: cgroupComponent,
    },
    controllerAfter.held.cgroup,
  );
  return { completedAt, inventory };
}

function validateEvidence(value, bytes, expected) {
  exactKeys(
    value,
    [
      "schema",
      "status",
      "runId",
      "environmentClass",
      "bindings",
      "bindingsProvenance",
      "owner",
      "limits",
      "startedAt",
      "completedAt",
      "lease",
      "observations",
      "quiescence",
      "cleanup",
      "nonclaims",
      "authority",
      "contentHash",
    ],
    "containment evidence",
  );
  if (
    value.schema !== G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA ||
    value.status !== "PASS" ||
    value.runId !== expected.runId ||
    value.environmentClass !== G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS
  ) {
    fail("containment evidence identity drifted");
  }
  exactKeys(
    value.bindings,
    [
      "ownerInputSha256",
      "platformManifestSha256",
      "controllerClosureSha256",
      "workspaceProjectionSha256",
    ],
    "containment evidence bindings",
  );
  for (const key of Object.keys(value.bindings)) {
    digest(value.bindings[key], `containment binding ${key}`);
    if (value.bindings[key] !== expected[key]) {
      fail(`containment binding ${key} drifted`);
    }
  }
  if (
    value.bindingsProvenance !== G17_NON_TMPFS_EXPECTED_BINDINGS_PROVENANCE
  ) {
    fail("containment expected bindings provenance was overstated");
  }
  exactKeys(value.owner, ["uid", "gid"], "containment owner");
  if (
    value.owner.uid !== expected.ownerUid ||
    value.owner.gid !== expected.ownerGid
  ) {
    fail("containment owner identity drifted");
  }
  validateLimits(value.limits, "containment evidence limits");
  if (!isDeepStrictEqual(value.limits, expected.limits)) {
    fail("containment evidence limits drifted");
  }
  const startedAt = timestamp(value.startedAt, "containment startedAt");
  const completedAt = timestamp(value.completedAt, "containment completedAt");
  if (startedAt >= completedAt) fail("containment timestamps are not ordered");
  exactKeys(
    value.observations,
    OBSERVATION_PHASES,
    "containment observation set",
  );
  const observations = Object.fromEntries(
    OBSERVATION_PHASES.map((phase) => [
      phase,
      validateObservation(value.observations[phase], expected, phase),
    ]),
  );
  const times = OBSERVATION_PHASES.map((phase) => observations[phase].observedAt);
  if (times.some((time, index) => index > 0 && time <= times[index - 1])) {
    fail("containment observations are not strictly ordered");
  }
  if (
    startedAt !== observations["controller-before"].observedAt ||
    completedAt !== observations["worker-after"].observedAt
  ) {
    fail("containment start/completion do not bind the observation sequence");
  }
  const lease = validateLease(value.lease, expected, observations["controller-before"]);
  for (const phase of OBSERVATION_PHASES) {
    if (
      value.observations[phase].leaseId !== value.lease.leaseId ||
      lease.observations.get(phase) !== observations[phase].observedAt
    ) {
      fail(`containment ${phase} observation is outside the held lease`);
    }
  }
  const quiescedAt = validateQuiescence(value.quiescence, expected.limits);
  const cleanup = validateCleanup(
    value.cleanup,
    expected.limits,
    expected,
    observations["controller-after"],
    quiescedAt,
  );
  const cleanupAt = cleanup.completedAt;
  if (
    lease.releasedAt - lease.acquiredAt > expected.limits.totalWallMs ||
    lease.observations.get("quiesced") !== quiescedAt ||
    lease.observations.get("cleanup-complete") !== cleanupAt ||
    !(observations["controller-after"].observedAt < quiescedAt &&
      quiescedAt < cleanupAt && cleanupAt < lease.releasedAt)
  ) {
    fail("containment lease duration or quiescence/cleanup coverage drifted");
  }
  const controllerBefore = observations["controller-before"];
  const workerBefore = observations["worker-before"];
  const workerAfter = observations["worker-after"];
  const controllerAfter = observations["controller-after"];
  for (const name of ["root", "run", "state", "cgroup"]) {
    if (
      !isDeepStrictEqual(
        controllerBefore.held[name],
        controllerAfter.held[name],
      )
    ) {
      fail(`controller held ${name} identity changed across the session`);
    }
  }
  for (const name of ["state", "cgroup"]) {
    if (!isDeepStrictEqual(workerBefore.held[name], workerAfter.held[name])) {
      fail(`worker held ${name} identity changed across the session`);
    }
  }
  if (
    !isDeepStrictEqual(controllerBefore.stateMount, controllerAfter.stateMount) ||
    !isDeepStrictEqual(
      controllerBefore.cgroup.mount,
      controllerAfter.cgroup.mount,
    ) ||
    !isDeepStrictEqual(workerBefore.stateMount, workerAfter.stateMount) ||
    !isDeepStrictEqual(workerBefore.cgroup.mount, workerAfter.cgroup.mount)
  ) {
    fail("held mount rows changed within a controller or worker namespace");
  }
  for (const worker of [workerBefore, workerAfter]) {
    if (
      !isDeepStrictEqual(
        persistentIdentity(controllerBefore.held.state),
        persistentIdentity(worker.held.state),
      ) ||
      !isDeepStrictEqual(
        persistentIdentity(controllerBefore.held.cgroup),
        persistentIdentity(worker.held.cgroup),
      )
    ) {
      fail("worker held state or cgroup differs from the controller object");
    }
  }
  const filesystem = controllerBefore.stateMount.filesystem;
  const stateDevice = controllerBefore.held.state.device;
  const stateType = controllerBefore.stateStatfs.type;
  const cgroupPath = controllerBefore.cgroup.relativePath;
  for (const phase of OBSERVATION_PHASES) {
    const observation = observations[phase];
    if (
      observation.stateMount.filesystem !== filesystem ||
      observation.held.state.device !== stateDevice ||
      observation.stateStatfs.type !== stateType ||
      observation.cgroup.relativePath !== cgroupPath
    ) {
      fail("mount, device, statfs, or cgroup generation changed across observations");
    }
  }
  if (!isDeepStrictEqual(value.nonclaims, NONCLAIMS)) {
    fail("containment nonclaims were broadened");
  }
  if (!isDeepStrictEqual(value.authority, AUTHORITY)) {
    fail("containment evidence carries authority");
  }
  digest(value.contentHash, "containment contentHash");
  const { contentHash, ...unsigned } = value;
  if (contentHash !== canonicalSha256(unsigned)) {
    fail("containment contentHash does not verify");
  }
  return deepFreeze({
    schema: G17_NON_TMPFS_CONTAINMENT_PROJECTION_SCHEMA,
    status: "CONTAINMENT_EVIDENCE_REPLAYED",
    outcome: "EVIDENCE_REPLAYED",
    runId: value.runId,
    environmentClass: value.environmentClass,
    bindings: snapshotData(value.bindings, "replayed containment bindings"),
    bindingsProvenance: G17_NON_TMPFS_EXPECTED_BINDINGS_PROVENANCE,
    limits: snapshotData(value.limits, "replayed containment limits"),
    artifact: {
      name: G17_NON_TMPFS_CONTAINMENT_ARTIFACT_NAME,
      bytes: bytes.length,
      sha256: sha256(bytes),
      contentHash,
    },
    lease: {
      status: "LEASE_EVIDENCE_REPLAYED",
      leaseId: value.lease.leaseId,
      mechanism: LEASE_MECHANISM,
      scope: LEASE_SCOPE,
      globalLockLocator: snapshotData(
        expected.globalLockLocator,
        "replayed global lock locator",
      ),
      controller: {
        pid: expected.controllerPid,
        generation: expected.controllerGeneration,
      },
      holder: {
        pid: expected.holderPid,
        generation: expected.holderGeneration,
      },
      globalLockAncestry: "ROOT_TO_LOCK_EVIDENCE_REPLAYED",
      acquisition: "ACQUIRED_EVIDENCE_REPLAYED",
      contender: "EWOULDBLOCK_EVIDENCE_REPLAYED",
      contenderGeneration: lease.contenderGeneration,
      heldThroughCleanup: "EVIDENCE_REPLAYED",
      fullSessionWallMsEvidence: lease.releasedAt - lease.acquiredAt,
    },
    containment: {
      heldFdRootRunStateChain: "EVIDENCE_REPLAYED",
      controllerWorkerFourPhaseEvidence: "EVIDENCE_REPLAYED",
      nonTmpfs: "EVIDENCE_REPLAYED",
      filesystem,
      filesystemType: stateType.toString(),
      stateDevice,
      cgroupV2: "EVIDENCE_REPLAYED",
      cgroupPath,
      worker: {
        pid: expected.workerPid,
        generation: expected.workerGeneration,
      },
      exactCgroupLimitBytes: "EVIDENCE_REPLAYED",
      harnessSessionExclusive:
        "GLOBAL_LOCK_LOCATION_ANCESTRY_AND_EWOULDBLOCK_EVIDENCE_REPLAYED",
      finalQuiescence: "EVIDENCE_REPLAYED",
      cleanup: {
        status: "EVIDENCE_REPLAYED",
        inventoryRawSha256: cleanup.inventory.rawSha256,
        inventoryContentHash: cleanup.inventory.contentHash,
        inventoryEntries: cleanup.inventory.entryCount,
        inventoryBytes: cleanup.inventory.totalBytes,
        maxDepthObserved: cleanup.inventory.maxDepthObserved,
        postCleanupAbsenceAndUnlink: "EVIDENCE_REPLAYED",
      },
    },
    finalDecisionEligible: false,
    binding: null,
    nonclaims: { ...NONCLAIMS },
    authority: { ...AUTHORITY },
  });
}

function decodeEvidence(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 2 ||
    bytes.length > G17_NON_TMPFS_CONTAINMENT_MAX_BYTES
  ) {
    fail("containment artifact is not a bounded Buffer");
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    fail(`containment artifact is invalid JSON: ${error.message}`);
  }
  const snapshot = snapshotData(value, "containment artifact");
  if (!bytes.equals(Buffer.from(`${canonicalJson(snapshot)}\n`, "utf8"))) {
    fail("containment artifact is not canonical JSON plus one LF");
  }
  return snapshot;
}

function copyEvidenceBytes(value) {
  if (
    !Buffer.isBuffer(value) ||
    value.length < 2 ||
    value.length > G17_NON_TMPFS_CONTAINMENT_MAX_BYTES
  ) {
    fail("containment artifact is not a bounded Buffer");
  }
  return Buffer.from(value);
}

export function replayG17NonTmpfsContainment(options) {
  try {
    const snapshot = exactOptionEnvelope(
      options,
      ["bytes", "expected"],
      "containment replay options",
    );
    const bytes = copyEvidenceBytes(snapshot.bytes);
    const expected = validateExpected(
      snapshotData(snapshot.expected, "expected containment binding"),
    );
    return validateEvidence(decodeEvidence(bytes), bytes, expected);
  } catch (error) {
    if (error?.message?.startsWith("G1.7 non-tmpfs containment contract:")) {
      throw error;
    }
    fail(error?.message ?? String(error));
  }
}

export function createG17NonTmpfsContainmentArtifactForTesting(options) {
  try {
    const { evidence, expected } = exactOptionEnvelope(
      options,
      ["evidence", "expected"],
      "containment test artifact options",
    );
    const expectedSnapshot = validateExpected(
      snapshotData(expected, "expected containment binding"),
    );
    const unsigned = snapshotData(evidence, "containment test evidence");
    exactKeys(
      unsigned,
      [
        "schema",
        "status",
        "runId",
        "environmentClass",
        "bindings",
        "bindingsProvenance",
        "owner",
        "limits",
        "startedAt",
        "completedAt",
        "lease",
        "observations",
        "quiescence",
        "cleanup",
        "nonclaims",
        "authority",
      ],
      "containment test evidence",
    );
    const value = { ...unsigned, contentHash: canonicalSha256(unsigned) };
    const stored = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    const projection = replayG17NonTmpfsContainment({
      bytes: stored,
      expected: expectedSnapshot,
    });
    return Object.freeze({
      get bytes() {
        return Buffer.from(stored);
      },
      projection,
    });
  } catch (error) {
    if (error?.message?.startsWith("G1.7 non-tmpfs containment contract:")) {
      throw error;
    }
    fail(error?.message ?? String(error));
  }
}
