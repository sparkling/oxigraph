import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  loadCurrentG17ControlExecutionAuthorization,
  validateG17ControlExecutionAuthorizationForTesting,
} from "./control-authorization-gate.mjs";
import {
  G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS,
  G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_GLOBAL_LOCK_LOCATOR,
  G17_NON_TMPFS_CONTAINMENT_LIMITS,
  G17_NON_TMPFS_EXPECTED_BINDINGS_PROVENANCE,
  deriveG17NonTmpfsContainmentCgroupPath,
  replayG17NonTmpfsContainment,
} from "./non-tmpfs-containment-contract.mjs";

export const G17_NON_TMPFS_CONTAINMENT_OWNER_CAPABILITY_SCHEMA =
  "oxigraph.g1.7-non-tmpfs-containment-owner-capability/v1";

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
const LEASE_MECHANISM = "flock-lock-ex-nb/v1";
const LEASE_SCOPE = "engineering-harness-g1.7";
const HELD_SOURCE = "openat2-held-fd-fstat-fstatfs-statx-mnt-id/v1";
const ANCESTRY_SCHEMA = "oxigraph.g1.7-held-directory-ancestry/v1";
const ANCESTRY_RESOLVER = "openat2-resolve-beneath-no-symlinks/v1";
const QUIESCENCE_SCHEMA = "oxigraph.g1.7-containment-quiescence/v1";
const CLEANUP_SCHEMA = "oxigraph.g1.7-containment-cleanup/v1";
const CLEANUP_INVENTORY_SCHEMA =
  "oxigraph.g1.7-containment-cleanup-inventory/v1";
const CLEANUP_STATE_GENERATION_SCHEMA =
  "oxigraph.g1.7-containment-state-generation/v1";
const ABSENCE_PROBE = "openat2-resolve-beneath-no-symlinks/v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const MAX_PID = 4_194_304n;
const MAX_SNAPSHOT_NODES = 100_000;
const MAX_SNAPSHOT_DEPTH = 64;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_OBJECT_PROPERTIES = 4_097;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const MAX_STRING_BYTES = 16 * 1024 * 1024;
const liveCapabilities = new WeakMap();

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

// The capability owns lifecycle authority; the mechanics object is the narrow
// syscall/process adapter. A production adapter must make openSession pin only
// the expected globalLockLocator root and lock, acquireLease must return the
// separately bound controller/holder identities plus held root/lock facts, and
// probeLeaseContender must independently reopen that exact root-to-lock chain.
// prepareSession must create run, state, and cgroup objects while the lease is
// held, and cleanup must use the reviewed openat2/unlinkat path before
// observePostCleanup probes both names. All pre-cleanup calls must honor the
// supplied AbortSignal. Failed openSession calls must clean partial acquisition.
const MECHANICS_METHODS = Object.freeze([
  "openSession",
  "acquireLease",
  "probeLeaseContender",
  "prepareSession",
  "configureCgroup",
  "observeController",
  "runWorker",
  "quiesce",
  "inventoryState",
  "cleanupState",
  "cleanupCgroup",
  "observePostCleanup",
  "releaseLease",
  "cancelWorker",
  "closeSession",
]);

export class G17NonTmpfsContainmentOwnerFault extends Error {
  constructor(phase, reason, cause, cleanupErrors = []) {
    super(`G1.7 non-tmpfs containment owner ${phase}: ${reason}`, { cause });
    this.name = "G17NonTmpfsContainmentOwnerFault";
    this.phase = phase;
    this.reason = reason;
    this.cleanupErrors = Object.freeze(
      cleanupErrors.map((error) => error?.message ?? String(error)),
    );
  }
}

function fault(phase, reason, cause, cleanupErrors) {
  throw new G17NonTmpfsContainmentOwnerFault(
    phase,
    reason,
    cause,
    cleanupErrors,
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fault("encode", "canonical value is not finite");
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

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
  ) {
    fault("preflight", `${label} fields are not exact`);
  }
}

function dataEnvelope(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fault("preflight", `${label} must be an ordinary object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort())
  ) {
    fault("preflight", `${label} fields are not exact`);
  }
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if ("get" in descriptor || "set" in descriptor || !descriptor.enumerable) {
      fault("preflight", `${label}.${key} must be an enumerable data field`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotData(
  value,
  label,
  ancestors = new WeakSet(),
  budget = { nodes: 0, buffers: 0, strings: 0 },
  depth = 0,
) {
  budget.nodes += 1;
  if (budget.nodes > MAX_SNAPSHOT_NODES || depth > MAX_SNAPSHOT_DEPTH) {
    fault("preflight", `${label} exceeds its structural budget`);
  }
  if (Buffer.isBuffer(value)) {
    budget.buffers += value.length;
    if (budget.buffers > MAX_BUFFER_BYTES) {
      fault("preflight", `${label} exceeds its Buffer budget`);
    }
    return Buffer.from(value);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fault("preflight", `${label} is not finite`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    budget.strings += Buffer.byteLength(value, "utf8");
    if (budget.strings > MAX_STRING_BYTES) {
      fault("preflight", `${label} exceeds its string budget`);
    }
    return value;
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    fault("preflight", `${label} contains unsupported data`);
  }
  if (ancestors.has(value)) fault("preflight", `${label} contains a cycle`);
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) {
    fault("preflight", `${label} contains a foreign prototype`);
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length > MAX_OBJECT_PROPERTIES ||
      keys.some((key) => typeof key !== "string")
    ) {
      fault("preflight", `${label} exceeds its property budget or contains symbols`);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      budget.strings += Buffer.byteLength(key, "utf8");
      if (budget.strings > MAX_STRING_BYTES) {
        fault("preflight", `${label} exceeds its key budget`);
      }
      if ("get" in descriptor || "set" in descriptor) {
        fault("preflight", `${label}.${key} contains an accessor`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_ARRAY_LENGTH
      ) {
        fault("preflight", `${label} is not a bounded dense array`);
      }
      const expected = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ].sort();
      if (!isDeepStrictEqual([...keys].sort(), expected)) {
        fault("preflight", `${label} is not a bounded dense array`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          ancestors,
          budget,
          depth + 1,
        ));
    }
    const result = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) fault("preflight", `${label}.${key} is hidden`);
      result[key] = snapshotData(
        descriptor.value,
        `${label}.${key}`,
        ancestors,
        budget,
        depth + 1,
      );
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fault("preflight", `${label} is not a digest`);
  return value;
}

function decimal(value, label, minimum = 0n, maximum = null) {
  if (typeof value !== "string" || value.length > 32 || !DECIMAL.test(value)) {
    fault("preflight", `${label} is not a bounded canonical decimal`);
  }
  const result = BigInt(value);
  if (result < minimum || (maximum !== null && result > maximum)) {
    fault("preflight", `${label} is outside its range`);
  }
  return result;
}

function validateIdentity(value, label, kind) {
  exactKeys(
    value,
    ["kind", "device", "inode", "uid", "gid", "mode", "links", "mountId"],
    label,
  );
  if (value.kind !== kind) fault("capture", `${label} kind is invalid`);
  decimal(value.device, `${label} device`, 1n);
  decimal(value.inode, `${label} inode`, 1n);
  decimal(value.uid, `${label} uid`);
  decimal(value.gid, `${label} gid`);
  decimal(value.mode, `${label} mode`, 0n, 0o7777n);
  decimal(value.links, `${label} links`, 1n);
  decimal(value.mountId, `${label} mount id`, 1n);
  return value;
}

function validateProcessIdentity(value, label, phase = "capture") {
  exactKeys(value, ["pid", "generation"], label);
  decimal(value.pid, `${label} pid`, 1n, MAX_PID);
  if (!SAFE_ID.test(value.generation ?? "")) {
    fault(phase, `${label} generation is unsafe`);
  }
  return value;
}

function validateGlobalLockLocator(value, label, phase = "capture") {
  exactKeys(value, ["schema", "rootPath", "component", "resolver"], label);
  if (
    value.schema !== GLOBAL_LOCK_LOCATOR_SCHEMA ||
    value.resolver !== ANCESTRY_RESOLVER ||
    typeof value.rootPath !== "string" ||
    value.rootPath.length < 2 ||
    value.rootPath.length > 4_096 ||
    !value.rootPath.startsWith("/") ||
    value.rootPath.endsWith("/") ||
    value.rootPath.includes("//") ||
    value.rootPath.includes("\\") ||
    !/^\/[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/u.test(value.rootPath) ||
    /[\u0000-\u001f\u007f]/u.test(value.rootPath) ||
    value.rootPath.split("/").some((part) => part === "." || part === "..") ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(value.component ?? "") ||
    value.component === "." ||
    value.component === ".." ||
    !isDeepStrictEqual(
      value,
      G17_NON_TMPFS_CONTAINMENT_GLOBAL_LOCK_LOCATOR,
    )
  ) {
    fault(phase, `${label} is not the canonical reviewed locator`);
  }
  return value;
}

function assertDistinctProcessIdentities(identities, label, phase = "lease") {
  if (
    new Set(identities.map(({ pid }) => pid)).size !== identities.length ||
    new Set(identities.map(({ generation }) => generation)).size !== identities.length
  ) {
    fault(phase, `${label} are not pairwise distinct`);
  }
}

function globalLockAncestry(root, lock, locator) {
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

function validateExpected(input) {
  const value = snapshotData(input, "expected containment binding");
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
  if (!SAFE_ID.test(value.runId ?? "")) fault("preflight", "run id is unsafe");
  for (const key of [
    "ownerInputSha256",
    "platformManifestSha256",
    "controllerClosureSha256",
    "workspaceProjectionSha256",
  ]) digest(value[key], key);
  decimal(value.ownerUid, "owner uid");
  decimal(value.ownerGid, "owner gid");
  validateGlobalLockLocator(
    value.globalLockLocator,
    "global lock locator",
    "preflight",
  );
  const processes = [
    validateProcessIdentity(
      { pid: value.controllerPid, generation: value.controllerGeneration },
      "controller identity",
      "preflight",
    ),
    validateProcessIdentity(
      { pid: value.holderPid, generation: value.holderGeneration },
      "holder identity",
      "preflight",
    ),
    validateProcessIdentity(
      { pid: value.workerPid, generation: value.workerGeneration },
      "worker identity",
      "preflight",
    ),
  ];
  assertDistinctProcessIdentities(
    processes,
    "expected process identities",
    "preflight",
  );
  exactKeys(
    value.limits,
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
    "expected containment limits",
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
    if (!Number.isSafeInteger(value.limits[key]) || value.limits[key] < 0) {
      fault("preflight", `containment limit ${key} is invalid`);
    }
  }
  if (
    value.limits.memoryMaxBytes < 16 * 1024 * 1024 ||
    value.limits.memoryMaxBytes > 68_719_476_736 ||
    value.limits.memorySwapMaxBytes > value.limits.memoryMaxBytes ||
    value.limits.pidsMax < 1 ||
    value.limits.pidsMax > 4_096 ||
    !(
      value.limits.cpuQuotaMicros === null ||
      (Number.isSafeInteger(value.limits.cpuQuotaMicros) &&
        value.limits.cpuQuotaMicros >= 1_000 &&
        value.limits.cpuQuotaMicros <= 1_000_000)
    ) ||
    value.limits.cpuPeriodMicros < 1_000 ||
    value.limits.cpuPeriodMicros > 1_000_000 ||
    value.limits.maxStateBytes > 137_438_953_472 ||
    value.limits.maxStateEntries > 500_000 ||
    value.limits.maxStateDepth > 128 ||
    value.limits.totalWallMs < 1_000 ||
    value.limits.totalWallMs > 7_200_000 ||
    value.limits.maxStateBytes < 1 ||
    value.limits.maxStateEntries < 1 ||
    value.limits.maxStateDepth < 1
  ) {
    fault("preflight", "containment limits are invalid");
  }
  deriveG17NonTmpfsContainmentCgroupPath({
    runId: value.runId,
    ownerInputSha256: value.ownerInputSha256,
    controllerPid: value.controllerPid,
    controllerGeneration: value.controllerGeneration,
    workerPid: value.workerPid,
    workerGeneration: value.workerGeneration,
  });
  return value;
}

function validateMechanics(input) {
  const value = dataEnvelope(input, MECHANICS_METHODS, "containment mechanics");
  for (const name of MECHANICS_METHODS) {
    if (typeof value[name] !== "function") {
      fault("preflight", `containment mechanics ${name} is unavailable`);
    }
  }
  return Object.freeze(value);
}

function validateSignal(signal) {
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    fault("preflight", "containment cancellation signal is invalid");
  }
  return signal;
}

function instant(clock, label) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    fault("execute", `${label} clock instant is invalid`);
  }
  return Object.freeze({ text: value.toISOString(), milliseconds: value.getTime() });
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    if (signal.reason instanceof G17NonTmpfsContainmentOwnerFault) {
      throw signal.reason;
    }
    const reason = signal.reason instanceof Error
      ? signal.reason
      : new Error("containment owner was cancelled");
    fault("cancel", "containment owner was cancelled", reason);
  }
}

function issueCapability({ expected, mechanics, signal, clock, authorization }) {
  const capability = Object.freeze({
    schema: G17_NON_TMPFS_CONTAINMENT_OWNER_CAPABILITY_SCHEMA,
  });
  liveCapabilities.set(capability, {
    phase: "ready",
    expected: validateExpected(expected),
    mechanics: validateMechanics(mechanics),
    signal: validateSignal(signal),
    clock,
    authorization,
  });
  return capability;
}

export async function createG17NonTmpfsContainmentProductionCapability(input) {
  const envelope = dataEnvelope(
    input,
    ["expected", "mechanics", "signal"],
    "production containment capability input",
  );
  const startedAt = new Date().toISOString();
  const authorization = await loadCurrentG17ControlExecutionAuthorization({
    controlStartedAt: startedAt,
  });
  return issueCapability({
    expected: envelope.expected,
    mechanics: envelope.mechanics,
    signal: envelope.signal,
    clock: () => new Date(),
    authorization,
  });
}

/** Test-only synthetic approval and mechanics injection. */
export async function createG17NonTmpfsContainmentCapabilityForTesting(input) {
  const envelope = dataEnvelope(
    input,
    [
      "authorizationBytes",
      "controlStartedAt",
      "expected",
      "mechanics",
      "clock",
      "signal",
    ],
    "test containment capability input",
  );
  if (typeof envelope.clock !== "function") {
    fault("preflight", "test containment clock is unavailable");
  }
  const authorization = validateG17ControlExecutionAuthorizationForTesting({
    authorizationBytes: envelope.authorizationBytes,
    controlStartedAt: envelope.controlStartedAt,
  });
  return issueCapability({
    expected: envelope.expected,
    mechanics: envelope.mechanics,
    signal: envelope.signal,
    clock: envelope.clock,
    authorization,
  });
}

function rawRecord(value, maximumBytes, label, allowEmpty = false) {
  if (
    !Buffer.isBuffer(value) ||
    value.length > maximumBytes ||
    (!allowEmpty && value.length === 0)
  ) {
    fault("capture", `${label} is not a bounded Buffer`);
  }
  const bytes = Buffer.from(value);
  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  };
}

function normalizeObservationFacts(input, phase) {
  const value = snapshotData(input, `${phase} facts`);
  exactKeys(
    value,
    ["mountinfo", "held", "stateStatfs", "stateMount", "cgroup"],
    `${phase} facts`,
  );
  exactKeys(value.held, ["root", "run", "state", "cgroup"], `${phase} held facts`);
  exactKeys(
    value.cgroup,
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
    `${phase} cgroup facts`,
  );
  return value;
}

function ancestry(root, run, state, expected) {
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

function buildObservation(factsInput, phase, observedAt, leaseId, expected) {
  const facts = normalizeObservationFacts(factsInput, phase);
  const controller = phase.startsWith("controller-");
  const after = phase === "controller-after";
  return {
    phase,
    observedAt,
    leaseId,
    mountinfo: rawRecord(
      facts.mountinfo,
      G17_NON_TMPFS_CONTAINMENT_LIMITS.maxMountinfoBytes,
      `${phase} mountinfo`,
    ),
    held: {
      source: HELD_SOURCE,
      root: facts.held.root,
      run: facts.held.run,
      state: facts.held.state,
      cgroup: facts.held.cgroup,
      ancestry: controller
        ? ancestry(
            facts.held.root,
            facts.held.run,
            facts.held.state,
            expected,
          )
        : null,
    },
    stateStatfs: facts.stateStatfs,
    stateMount: facts.stateMount,
    cgroup: {
      relativePath: facts.cgroup.relativePath,
      directory: facts.cgroup.directory,
      mount: facts.cgroup.mount,
      statfs: facts.cgroup.statfs,
      membership: rawRecord(
        facts.cgroup.membership,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} membership`,
        after,
      ),
      controllers: rawRecord(
        facts.cgroup.controllers,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} controllers`,
      ),
      cgroupType: rawRecord(
        facts.cgroup.cgroupType,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} cgroup.type`,
      ),
      memoryMax: rawRecord(
        facts.cgroup.memoryMax,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} memory.max`,
      ),
      memorySwapMax: rawRecord(
        facts.cgroup.memorySwapMax,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} memory.swap.max`,
      ),
      pidsMax: rawRecord(
        facts.cgroup.pidsMax,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} pids.max`,
      ),
      cpuMax: rawRecord(
        facts.cgroup.cpuMax,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} cpu.max`,
      ),
      pidsCurrent: rawRecord(
        facts.cgroup.pidsCurrent,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} pids.current`,
      ),
      procs: rawRecord(
        facts.cgroup.procs,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} cgroup.procs`,
        after,
      ),
      events: rawRecord(
        facts.cgroup.events,
        G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCgroupFileBytes,
        `${phase} cgroup.events`,
      ),
      worker: facts.cgroup.worker,
    },
  };
}

function leaseObservation(phase, at, held, lockObject) {
  return { phase, at, held, lockObject: snapshotData(lockObject, `${phase} lock`) };
}

function inventoryBytes(entriesInput, capturedAt, expected, stateIdentity) {
  if (!Array.isArray(entriesInput)) {
    fault("cleanup", "cleanup inventory is not an array");
  }
  const entries = snapshotData(entriesInput, "cleanup inventory entries")
    .map((entry, index) => {
      exactKeys(entry, ["path", "kind", "bytes", "sha256"], `inventory entry ${index}`);
      return entry;
    })
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (
    entries.length < 1 ||
    entries.length > G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCleanupInventoryEntries ||
    entries.length > expected.limits.maxStateEntries
  ) {
    fault("cleanup", "cleanup inventory entry count is outside its ceiling");
  }
  let totalBytes = 0;
  let maxDepthObserved = 0;
  for (const entry of entries) {
    if (
      typeof entry.path !== "string" ||
      entry.path.length < 1 ||
      entry.path.length > 4_096 ||
      entry.path.startsWith("/") ||
      entry.path.includes("//") ||
      entry.path.includes("\\") ||
      !/^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/u.test(entry.path) ||
      entry.path.split("/").some((part) => part === "." || part === "..") ||
      !new Set(["directory", "file", "symlink"]).has(entry.kind) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0
    ) {
      fault("cleanup", "cleanup inventory bytes are invalid");
    }
    digest(entry.sha256, "cleanup inventory entry sha256");
    totalBytes += entry.bytes;
    if (!Number.isSafeInteger(totalBytes)) {
      fault("cleanup", "cleanup inventory byte total is not safe");
    }
    maxDepthObserved = Math.max(maxDepthObserved, entry.path.split("/").length);
  }
  if (new Set(entries.map(({ path }) => path)).size !== entries.length) {
    fault("cleanup", "cleanup inventory paths are duplicated");
  }
  if (
    totalBytes > expected.limits.maxStateBytes ||
    maxDepthObserved > expected.limits.maxStateDepth
  ) {
    fault("cleanup", "cleanup inventory exceeds the state ceiling");
  }
  const unsigned = {
    schema: CLEANUP_INVENTORY_SCHEMA,
    runId: expected.runId,
    stateGeneration: canonicalSha256({
      schema: CLEANUP_STATE_GENERATION_SCHEMA,
      runId: expected.runId,
      identity: stateIdentity,
    }),
    capturedAt,
    entries,
    entryCount: entries.length,
    totalBytes,
    maxDepthObserved,
  };
  const value = { ...unsigned, contentHash: canonicalSha256(unsigned) };
  return rawRecord(
    Buffer.from(`${canonicalJson(value)}\n`, "utf8"),
    G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCleanupInventoryBytes,
    "cleanup inventory",
  );
}

function normalizeWorkerExit(value) {
  const result = snapshotData(value, "worker exit");
  exactKeys(result, ["disposition", "exitCode", "signal"], "worker exit");
  if (
    result.disposition !== "completed" ||
    result.exitCode !== 0 ||
    result.signal !== null
  ) {
    fault("worker", "contained worker did not complete successfully");
  }
  return result;
}

function normalizeQuiescence(value) {
  const result = snapshotData(value, "containment quiescence");
  exactKeys(
    result,
    ["cgroupPopulated", "pidsCurrent", "processesRemaining"],
    "containment quiescence",
  );
  if (
    result.cgroupPopulated !== false ||
    result.pidsCurrent !== 0 ||
    result.processesRemaining !== 0
  ) {
    fault("quiesce", "contained worker descendants remain live");
  }
  return result;
}

function normalizePostCleanup(value) {
  const result = snapshotData(value, "post-cleanup observations");
  exactKeys(result, ["state", "cgroup"], "post-cleanup observations");
  for (const name of ["state", "cgroup"]) {
    exactKeys(
      result[name],
      ["result", "errno", "heldIdentity"],
      `post-cleanup ${name}`,
    );
  }
  return result;
}

function encodeEvidence(evidence, expected) {
  const unsigned = snapshotData(evidence, "containment owner evidence");
  const value = { ...unsigned, contentHash: canonicalSha256(unsigned) };
  const stored = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  const projection = replayG17NonTmpfsContainment({ bytes: stored, expected });
  return Object.freeze({
    get bytes() {
      return Buffer.from(stored);
    },
    projection,
  });
}

async function attemptCleanup(state, action, errors) {
  try {
    await action();
  } catch (error) {
    errors.push(error);
  }
}

async function failureCleanup(state) {
  const errors = [];
  const { mechanics, signal } = state;
  if (state.session !== undefined && state.workerStarted && !state.workerFinished) {
    await attemptCleanup(
      state,
      () => mechanics.cancelWorker({ session: state.session, signal: undefined }),
      errors,
    );
  }
  if (
    state.session !== undefined &&
    state.preparationAttempted &&
    !state.quiesced
  ) {
    await attemptCleanup(
      state,
      () => mechanics.quiesce({ session: state.session, signal: undefined }),
      errors,
    );
  }
  if (
    state.session !== undefined &&
    state.preparationAttempted &&
    !state.stateCleanupAttempted
  ) {
    state.stateCleanupAttempted = true;
    await attemptCleanup(
      state,
      () => mechanics.cleanupState({ session: state.session, signal: undefined }),
      errors,
    );
  }
  if (
    state.session !== undefined &&
    state.preparationAttempted &&
    !state.cgroupCleanupAttempted
  ) {
    state.cgroupCleanupAttempted = true;
    await attemptCleanup(
      state,
      () => mechanics.cleanupCgroup({ session: state.session, signal: undefined }),
      errors,
    );
  }
  if (state.session !== undefined && state.leaseAcquired && !state.releaseAttempted) {
    state.releaseAttempted = true;
    await attemptCleanup(
      state,
      () => mechanics.releaseLease({ session: state.session, signal: undefined }),
      errors,
    );
  }
  if (state.session !== undefined && !state.closeAttempted) {
    state.closeAttempted = true;
    await attemptCleanup(
      state,
      () => mechanics.closeSession({ session: state.session, signal: undefined }),
      errors,
    );
  }
  return errors;
}

function withinWall(acquiredAt, observedAt, maximumMs) {
  if (observedAt.milliseconds - acquiredAt.milliseconds > maximumMs) {
    fault("timeout", "full containment session exceeded totalWallMs");
  }
}

async function executeOwner(capability, captured) {
  const { expected, mechanics, signal, clock } = captured;
  const cgroupPath = deriveG17NonTmpfsContainmentCgroupPath({
    runId: expected.runId,
    ownerInputSha256: expected.ownerInputSha256,
    controllerPid: expected.controllerPid,
    controllerGeneration: expected.controllerGeneration,
    workerPid: expected.workerPid,
    workerGeneration: expected.workerGeneration,
  });
  const state = {
    mechanics,
    signal,
    session: undefined,
    leaseAcquired: false,
    preparationAttempted: false,
    workerStarted: false,
    workerFinished: false,
    quiesced: false,
    stateCleanupAttempted: false,
    cgroupCleanupAttempted: false,
    releaseAttempted: false,
    closeAttempted: false,
    deadlineTimer: undefined,
  };
  let primary;
  let operationSignal = signal;
  try {
    throwIfAborted(signal);
    state.session = await mechanics.openSession({ expected, cgroupPath, signal });
    throwIfAborted(signal);
    const acquisitionResult = await mechanics.acquireLease({
      session: state.session,
      signal,
    });
    state.leaseAcquired = true;
    const acquisition = snapshotData(
      acquisitionResult,
      "lease acquisition",
    );
    exactKeys(
      acquisition,
      ["controller", "holder", "lockLocator", "rootIdentity", "lockObject"],
      "lease acquisition",
    );
    const acquisitionController = validateProcessIdentity(
      acquisition.controller,
      "lease acquisition controller",
    );
    const acquisitionHolder = validateProcessIdentity(
      acquisition.holder,
      "lease acquisition holder",
    );
    const expectedController = {
      pid: expected.controllerPid,
      generation: expected.controllerGeneration,
    };
    const expectedHolder = {
      pid: expected.holderPid,
      generation: expected.holderGeneration,
    };
    const expectedWorker = {
      pid: expected.workerPid,
      generation: expected.workerGeneration,
    };
    validateGlobalLockLocator(
      acquisition.lockLocator,
      "lease lock locator",
      "lease",
    );
    validateIdentity(acquisition.rootIdentity, "lease lock root", "directory");
    validateIdentity(acquisition.lockObject, "lease lock", "regular");
    if (
      !isDeepStrictEqual(acquisitionController, expectedController) ||
      !isDeepStrictEqual(acquisitionHolder, expectedHolder) ||
      !isDeepStrictEqual(acquisition.lockLocator, expected.globalLockLocator) ||
      acquisition.rootIdentity.uid !== expected.ownerUid ||
      acquisition.rootIdentity.gid !== expected.ownerGid ||
      acquisition.rootIdentity.mode !== "448" ||
      acquisition.lockObject.uid !== expected.ownerUid ||
      acquisition.lockObject.gid !== expected.ownerGid ||
      acquisition.lockObject.mode !== "384" ||
      acquisition.lockObject.links !== "1" ||
      acquisition.rootIdentity.device !== acquisition.lockObject.device ||
      acquisition.rootIdentity.mountId !== acquisition.lockObject.mountId ||
      acquisition.rootIdentity.inode === acquisition.lockObject.inode
    ) {
      fault("lease", "lease lock identity or reviewed global ancestry drifted");
    }
    const acquisitionLockAncestry = globalLockAncestry(
      acquisition.rootIdentity,
      acquisition.lockObject,
      acquisition.lockLocator,
    );
    const acquiredAt = instant(clock, "lease acquisition");
    const deadline = new AbortController();
    state.deadlineTimer = setTimeout(() => {
      deadline.abort(
        new G17NonTmpfsContainmentOwnerFault(
          "timeout",
          "full containment session exceeded totalWallMs",
        ),
      );
    }, expected.limits.totalWallMs);
    operationSignal = signal === undefined
      ? deadline.signal
      : AbortSignal.any([signal, deadline.signal]);
    const leaseId = canonicalSha256({
      schema: LEASE_ID_SCHEMA,
      runId: expected.runId,
      controller: acquisitionController,
      holder: acquisitionHolder,
      lockLocator: acquisition.lockLocator,
      lockAncestry: acquisitionLockAncestry,
      lockObject: acquisition.lockObject,
      acquiredAt: acquiredAt.text,
    });

    const contender = snapshotData(
      await mechanics.probeLeaseContender({
        session: state.session,
        signal: operationSignal,
      }),
      "lease contender",
    );
    exactKeys(
      contender,
      ["pid", "errno", "lockLocator", "rootIdentity", "lockObject"],
      "lease contender",
    );
    const contenderAt = instant(clock, "lease contender");
    withinWall(acquiredAt, contenderAt, expected.limits.totalWallMs);
    decimal(contender.pid, "lease contender pid", 1n, MAX_PID);
    validateGlobalLockLocator(
      contender.lockLocator,
      "contender lock locator",
      "lease",
    );
    validateIdentity(contender.rootIdentity, "contender lock root", "directory");
    validateIdentity(contender.lockObject, "contender lock", "regular");
    const contenderLockAncestry = globalLockAncestry(
      contender.rootIdentity,
      contender.lockObject,
      contender.lockLocator,
    );
    if (
      contender.errno !== "EWOULDBLOCK" ||
      !isDeepStrictEqual(contender.lockLocator, acquisition.lockLocator) ||
      !isDeepStrictEqual(contenderLockAncestry, acquisitionLockAncestry) ||
      !isDeepStrictEqual(contender.lockObject, acquisition.lockObject)
    ) {
      fault("lease", "exclusive flock contender evidence is contradictory");
    }
    const contenderGeneration = canonicalSha256({
      schema: LEASE_CONTENDER_ID_SCHEMA,
      runId: expected.runId,
      leaseId,
      pid: contender.pid,
    });
    const contenderIdentity = {
      pid: contender.pid,
      generation: contenderGeneration,
    };
    assertDistinctProcessIdentities(
      [expectedController, expectedHolder, expectedWorker, contenderIdentity],
      "controller, holder, worker, and contender process identities",
    );

    state.preparationAttempted = true;
    await mechanics.prepareSession({
      session: state.session,
      expected,
      cgroupPath,
      signal: operationSignal,
    });
    await mechanics.configureCgroup({
      session: state.session,
      expected,
      cgroupPath,
      signal: operationSignal,
    });
    throwIfAborted(operationSignal);

    const controllerBeforeAt = instant(clock, "controller-before");
    const controllerBefore = buildObservation(
      await mechanics.observeController({
        session: state.session,
        phase: "controller-before",
        signal: operationSignal,
      }),
      "controller-before",
      controllerBeforeAt.text,
      leaseId,
      expected,
    );
    if (
      controllerBefore.held.root === null ||
      !isDeepStrictEqual(acquisition.rootIdentity, controllerBefore.held.root) ||
      acquisition.lockObject.device !== controllerBefore.held.root.device ||
      acquisition.lockObject.mountId !== controllerBefore.held.root.mountId
    ) {
      fault("lease", "lease lock escaped the held owner root filesystem");
    }
    withinWall(acquiredAt, controllerBeforeAt, expected.limits.totalWallMs);

    let workerBefore;
    let workerAfter;
    let workerBeforeAt;
    let workerAfterAt;
    state.workerStarted = true;
    const workerOutcome = await mechanics.runWorker({
      session: state.session,
      expected,
      cgroupPath,
      signal: operationSignal,
      observeBefore: async (facts) => {
        if (workerBefore !== undefined || workerAfter !== undefined) {
          fault("worker", "worker-before observation was duplicated or reordered");
        }
        workerBeforeAt = instant(clock, "worker-before");
        workerBefore = buildObservation(
          facts,
          "worker-before",
          workerBeforeAt.text,
          leaseId,
          expected,
        );
        withinWall(acquiredAt, workerBeforeAt, expected.limits.totalWallMs);
      },
      observeAfter: async (facts) => {
        if (workerBefore === undefined || workerAfter !== undefined) {
          fault("worker", "worker-after observation was missing or reordered");
        }
        workerAfterAt = instant(clock, "worker-after");
        workerAfter = buildObservation(
          facts,
          "worker-after",
          workerAfterAt.text,
          leaseId,
          expected,
        );
        withinWall(acquiredAt, workerAfterAt, expected.limits.totalWallMs);
      },
    });
    state.workerFinished = true;
    const workerExit = normalizeWorkerExit(workerOutcome);
    if (workerBefore === undefined || workerAfter === undefined) {
      fault("worker", "worker did not emit the exact two observations");
    }

    const controllerAfterAt = instant(clock, "controller-after");
    const controllerAfter = buildObservation(
      await mechanics.observeController({
        session: state.session,
        phase: "controller-after",
        signal: operationSignal,
      }),
      "controller-after",
      controllerAfterAt.text,
      leaseId,
      expected,
    );
    withinWall(acquiredAt, controllerAfterAt, expected.limits.totalWallMs);

    const quiescenceFacts = normalizeQuiescence(
      await mechanics.quiesce({
        session: state.session,
        signal: operationSignal,
      }),
    );
    state.quiesced = true;
    const quiescedAt = instant(clock, "quiescence");
    withinWall(acquiredAt, quiescedAt, expected.limits.totalWallMs);
    throwIfAborted(operationSignal);

    const inventoryEntries = await mechanics.inventoryState({
      session: state.session,
      expected,
      signal: operationSignal,
    });
    const inventoryCapturedAt = instant(clock, "cleanup inventory");
    withinWall(acquiredAt, inventoryCapturedAt, expected.limits.totalWallMs);
    const inventory = inventoryBytes(
      inventoryEntries,
      inventoryCapturedAt.text,
      expected,
      controllerAfter.held.state,
    );

    state.stateCleanupAttempted = true;
    await mechanics.cleanupState({ session: state.session, signal: undefined });
    state.cgroupCleanupAttempted = true;
    await mechanics.cleanupCgroup({ session: state.session, signal: undefined });
    const postCleanup = normalizePostCleanup(
      await mechanics.observePostCleanup({
        session: state.session,
        signal: undefined,
      }),
    );
    const cleanupAt = instant(clock, "cleanup completion");
    withinWall(acquiredAt, cleanupAt, expected.limits.totalWallMs);
    throwIfAborted(operationSignal);

    state.releaseAttempted = true;
    await mechanics.releaseLease({ session: state.session, signal: undefined });
    const releasedAt = instant(clock, "lease release");
    withinWall(acquiredAt, releasedAt, expected.limits.totalWallMs);
    throwIfAborted(operationSignal);
    clearTimeout(state.deadlineTimer);
    state.deadlineTimer = undefined;

    state.closeAttempted = true;
    await mechanics.closeSession({ session: state.session, signal: undefined });

    const lockObject = acquisition.lockObject;
    return encodeEvidence({
      schema: G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA,
      status: "PASS",
      runId: expected.runId,
      environmentClass: G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS,
      bindings: {
        ownerInputSha256: expected.ownerInputSha256,
        platformManifestSha256: expected.platformManifestSha256,
        controllerClosureSha256: expected.controllerClosureSha256,
        workspaceProjectionSha256: expected.workspaceProjectionSha256,
      },
      bindingsProvenance: G17_NON_TMPFS_EXPECTED_BINDINGS_PROVENANCE,
      owner: { uid: expected.ownerUid, gid: expected.ownerGid },
      limits: expected.limits,
      startedAt: controllerBeforeAt.text,
      completedAt: workerAfterAt.text,
      lease: {
        schema: LEASE_SCHEMA,
        mechanism: LEASE_MECHANISM,
        scope: LEASE_SCOPE,
        leaseId,
        controller: acquisitionController,
        holder: acquisitionHolder,
        lockLocator: acquisition.lockLocator,
        lockAncestry: acquisitionLockAncestry,
        lockObject,
        acquiredAt: acquiredAt.text,
        acquisition: {
          schema: LEASE_ACQUISITION_SCHEMA,
          operation: "flock",
          flags: ["LOCK_EX", "LOCK_NB"],
          result: "ACQUIRED",
          errno: null,
          observedAt: acquiredAt.text,
          controller: acquisitionController,
          holder: acquisitionHolder,
          lockLocator: acquisition.lockLocator,
          lockAncestry: acquisitionLockAncestry,
          lockObject,
        },
        contender: {
          schema: LEASE_CONTENDER_SCHEMA,
          operation: "flock",
          flags: ["LOCK_EX", "LOCK_NB"],
          result: "BLOCKED",
          errno: contender.errno,
          observedAt: contenderAt.text,
          pid: contender.pid,
          generation: contenderGeneration,
          lockLocator: contender.lockLocator,
          lockAncestry: contenderLockAncestry,
          lockObject: contender.lockObject,
        },
        observations: [
          leaseObservation("acquired", acquiredAt.text, true, lockObject),
          leaseObservation("controller-before", controllerBeforeAt.text, true, lockObject),
          leaseObservation("worker-before", workerBeforeAt.text, true, lockObject),
          leaseObservation("worker-after", workerAfterAt.text, true, lockObject),
          leaseObservation("controller-after", controllerAfterAt.text, true, lockObject),
          leaseObservation("quiesced", quiescedAt.text, true, lockObject),
          leaseObservation("cleanup-complete", cleanupAt.text, true, lockObject),
          leaseObservation("released", releasedAt.text, false, lockObject),
        ],
        releasedAt: releasedAt.text,
      },
      observations: {
        "controller-before": controllerBefore,
        "worker-before": workerBefore,
        "worker-after": workerAfter,
        "controller-after": controllerAfter,
      },
      quiescence: {
        schema: QUIESCENCE_SCHEMA,
        status: "QUIESCENT",
        observedAt: quiescedAt.text,
        workerExitDisposition: workerExit.disposition,
        workerExitCode: workerExit.exitCode,
        workerSignal: workerExit.signal,
        ...quiescenceFacts,
      },
      cleanup: {
        schema: CLEANUP_SCHEMA,
        status: "COMPLETE",
        completedAt: cleanupAt.text,
        inventory,
        limits: {
          maxStateBytes: expected.limits.maxStateBytes,
          maxStateEntries: expected.limits.maxStateEntries,
          maxStateDepth: expected.limits.maxStateDepth,
          maxInventoryBytes:
            G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCleanupInventoryBytes,
          maxInventoryEntries: Math.min(
            G17_NON_TMPFS_CONTAINMENT_LIMITS.maxCleanupInventoryEntries,
            expected.limits.maxStateEntries,
          ),
        },
        postCleanup: {
          observedAt: cleanupAt.text,
          state: {
            operation: ABSENCE_PROBE,
            parentIdentity: controllerAfter.held.run,
            component: "state",
            result: postCleanup.state.result,
            errno: postCleanup.state.errno,
            heldIdentity: postCleanup.state.heldIdentity,
          },
          cgroup: {
            operation: ABSENCE_PROBE,
            mount: controllerAfter.cgroup.mount,
            parentPath: cgroupPath.slice(0, cgroupPath.lastIndexOf("/")),
            component: cgroupPath.slice(cgroupPath.lastIndexOf("/") + 1),
            result: postCleanup.cgroup.result,
            errno: postCleanup.cgroup.errno,
            heldIdentity: postCleanup.cgroup.heldIdentity,
          },
        },
        errors: [],
      },
      nonclaims: { ...NONCLAIMS },
      authority: { ...AUTHORITY },
    }, expected);
  } catch (error) {
    if (
      operationSignal?.aborted &&
      operationSignal.reason instanceof G17NonTmpfsContainmentOwnerFault
    ) {
      primary = operationSignal.reason;
    } else if (signal?.aborted) {
      primary = new G17NonTmpfsContainmentOwnerFault(
        "cancel",
        "containment owner was cancelled",
        signal.reason instanceof Error ? signal.reason : error,
      );
    } else {
      primary = error;
    }
    const cleanupErrors = await failureCleanup(state);
    if (primary instanceof G17NonTmpfsContainmentOwnerFault) {
      throw new G17NonTmpfsContainmentOwnerFault(
        primary.phase,
        primary.reason,
        primary.cause ?? primary,
        [
          ...primary.cleanupErrors.map((message) => new Error(message)),
          ...cleanupErrors,
        ],
      );
    }
    fault("execute", primary?.message ?? String(primary), primary, cleanupErrors);
  } finally {
    clearTimeout(state.deadlineTimer);
    captured.phase = primary === undefined ? "consumed" : "failed";
    liveCapabilities.delete(capability);
  }
}

export async function runG17NonTmpfsContainmentOwner(capability) {
  const captured = capability !== null && typeof capability === "object"
    ? liveCapabilities.get(capability)
    : undefined;
  if (captured?.phase !== "ready") {
    fault("preflight", "containment owner capability is not live");
  }
  captured.phase = "running";
  return executeOwner(capability, captured);
}
