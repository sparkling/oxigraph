import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  G17_NON_TMPFS_CONTAINMENT_ARTIFACT_NAME,
  G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS,
  G17_NON_TMPFS_CONTAINMENT_EVIDENCE_SCHEMA,
  G17_NON_TMPFS_CONTAINMENT_GLOBAL_LOCK_LOCATOR,
  G17_NON_TMPFS_CONTAINMENT_MAX_BYTES,
  G17_NON_TMPFS_CONTAINMENT_PROJECTION_SCHEMA,
  G17_NON_TMPFS_EXPECTED_BINDINGS_PROVENANCE,
  createG17NonTmpfsContainmentArtifactForTesting,
  deriveG17NonTmpfsContainmentCgroupPath,
  replayG17NonTmpfsContainment,
} from "../src/qualification/non-tmpfs-containment-contract.mjs";

const times = Object.freeze(
  Array.from({ length: 8 }, (_, index) =>
    new Date(Date.UTC(2026, 7, 28, 12, 0, index)).toISOString()),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function canonicalSha256(value) {
  return sha256(Buffer.from(canonical(value), "utf8"));
}

function raw(text) {
  const bytes = Buffer.from(text, "utf8");
  return { bytes: bytes.length, sha256: sha256(bytes), base64: bytes.toString("base64") };
}

function decodeRawJson(record) {
  return JSON.parse(Buffer.from(record.base64, "base64"));
}

function resealCleanupInventory(evidence, mutate) {
  const inventory = decodeRawJson(evidence.cleanup.inventory);
  mutate(inventory);
  const { contentHash: _old, ...unsigned } = inventory;
  inventory.contentHash = canonicalSha256(unsigned);
  evidence.cleanup.inventory = raw(`${canonical(inventory)}\n`);
}

function identity({
  kind = "directory",
  device,
  inode,
  uid = "1000",
  gid = "1000",
  mode = "448",
  links = "2",
  mountId,
}) {
  return { kind, device, inode, uid, gid, mode, links, mountId };
}

function stateStatfs(type = "61267") {
  return {
    type,
    blockSize: "4096",
    blocks: "1000000",
    blocksFree: "900000",
    blocksAvailable: "880000",
    files: "1000000",
    filesFree: "900000",
  };
}

function cgroupStatfs() {
  return {
    type: "1667723888",
    blockSize: "4096",
    blocks: "0",
    blocksFree: "0",
    blocksAvailable: "0",
    files: "0",
    filesFree: "0",
  };
}

function mount({
  mountId,
  parentMountId = "1",
  device,
  root,
  mountPoint,
  access,
  filesystem,
  source,
  superOptions = "rw",
}) {
  return {
    mountId,
    parentMountId,
    device,
    root,
    mountPoint,
    access,
    filesystem,
    source,
    superOptions,
    optionalFields: [],
  };
}

const expected = Object.freeze({
  runId: "g17-non-tmpfs-fixture",
  ownerInputSha256: "1".repeat(64),
  platformManifestSha256: "2".repeat(64),
  controllerClosureSha256: "3".repeat(64),
  workspaceProjectionSha256: "4".repeat(64),
  ownerUid: "1000",
  ownerGid: "1000",
  globalLockLocator: G17_NON_TMPFS_CONTAINMENT_GLOBAL_LOCK_LOCATOR,
  controllerPid: "4240",
  controllerGeneration: "controller-generation-1",
  holderPid: "4241",
  holderGeneration: "holder-generation-1",
  workerPid: "4242",
  workerGeneration: "worker-generation-1",
  limits: Object.freeze({
    memoryMaxBytes: 1_073_741_824,
    memorySwapMaxBytes: 0,
    pidsMax: 512,
    cpuQuotaMicros: null,
    cpuPeriodMicros: 100_000,
    maxStateBytes: 536_870_912,
    maxStateEntries: 100_000,
    maxStateDepth: 64,
    totalWallMs: 600_000,
  }),
});

const controllerMountinfo = [
  "100 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw",
  "200 1 0:28 / /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw",
  "",
].join("\n");
const cgroupPath = deriveG17NonTmpfsContainmentCgroupPath({
  runId: expected.runId,
  ownerInputSha256: expected.ownerInputSha256,
  controllerPid: expected.controllerPid,
  controllerGeneration: expected.controllerGeneration,
  workerPid: expected.workerPid,
  workerGeneration: expected.workerGeneration,
});
const workerMountinfo = [
  "300 1 8:1 /harness/session/state /state rw,relatime - ext4 /dev/sda1 rw",
  `400 1 0:28 ${cgroupPath} /control/cgroup2 ro,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw`,
  "",
].join("\n");

function cgroup({ phase, worker }) {
  const after = phase === "controller-after";
  const mountId = worker ? "400" : "200";
  return {
    relativePath: cgroupPath,
    directory: identity({
      device: "28",
      inode: "20",
      uid: worker ? "0" : "1000",
      gid: worker ? "0" : "1000",
      mode: "493",
      links: "2",
      mountId,
    }),
    mount: mount({
      mountId,
      device: "28",
      root: worker ? cgroupPath : "/",
      mountPoint: worker ? "/control/cgroup2" : "/sys/fs/cgroup",
      access: worker ? "ro" : "rw",
      filesystem: "cgroup2",
      source: "cgroup",
    }),
    statfs: cgroupStatfs(),
    membership: raw(after ? "" : `0::${cgroupPath}\n`),
    controllers: raw("cpuset cpu io memory hugetlb pids rdma misc dmem\n"),
    cgroupType: raw("domain\n"),
    memoryMax: raw(`${expected.limits.memoryMaxBytes}\n`),
    memorySwapMax: raw(`${expected.limits.memorySwapMaxBytes}\n`),
    pidsMax: raw(`${expected.limits.pidsMax}\n`),
    cpuMax: raw("max 100000\n"),
    pidsCurrent: raw(after ? "0\n" : "1\n"),
    procs: raw(after ? "" : `${expected.workerPid}\n`),
    events: raw(after ? "populated 0\nfrozen 0\n" : "populated 1\nfrozen 0\n"),
    worker: {
      pid: expected.workerPid,
      generation: expected.workerGeneration,
    },
  };
}

function observation(phase, at, leaseId) {
  const worker = phase.startsWith("worker-");
  const mountId = worker ? "300" : "100";
  const root = worker
    ? null
    : identity({ device: "2049", inode: "10", links: "3", mountId });
  const run = worker
    ? null
    : identity({ device: "2049", inode: "11", links: "3", mountId });
  const state = identity({
    device: "2049",
    inode: "12",
    uid: worker ? "0" : "1000",
    gid: worker ? "0" : "1000",
    links: "5",
    mountId,
  });
  const heldCgroup = identity({
    device: "28",
    inode: "20",
    uid: worker ? "0" : "1000",
    gid: worker ? "0" : "1000",
    mode: "493",
    links: "2",
    mountId: worker ? "400" : "200",
  });
  return {
    phase,
    observedAt: at,
    leaseId,
    mountinfo: raw(worker ? workerMountinfo : controllerMountinfo),
    held: {
      source: "openat2-held-fd-fstat-fstatfs-statx-mnt-id/v1",
      root,
      run,
      state,
      cgroup: heldCgroup,
      ancestry: worker
        ? null
        : {
            schema: "oxigraph.g1.7-held-directory-ancestry/v1",
            resolver: "openat2-resolve-beneath-no-symlinks/v1",
            edges: [
              {
                parent: "root",
                child: "run",
                component: expected.runId,
                parentIdentity: structuredClone(root),
                childIdentity: structuredClone(run),
                result: "SAME_OBJECT",
              },
              {
                parent: "run",
                child: "state",
                component: "state",
                parentIdentity: structuredClone(run),
                childIdentity: structuredClone(state),
                result: "SAME_OBJECT",
              },
            ],
          },
    },
    stateStatfs: stateStatfs(),
    stateMount: mount({
      mountId,
      device: "2049",
      root: worker ? "/harness/session/state" : "/",
      mountPoint: worker ? "/state" : "/",
      access: "rw",
      filesystem: "ext4",
      source: "/dev/sda1",
    }),
    cgroup: cgroup({ phase, worker }),
  };
}

function fixtureEvidence() {
  const controller = {
    pid: expected.controllerPid,
    generation: expected.controllerGeneration,
  };
  const holder = {
    pid: expected.holderPid,
    generation: expected.holderGeneration,
  };
  const lockLocator = structuredClone(expected.globalLockLocator);
  const lockRoot = identity({
    device: "2049",
    inode: "10",
    links: "3",
    mountId: "100",
  });
  const lockObject = identity({
    kind: "regular",
    device: "2049",
    inode: "9",
    mode: "384",
    links: "1",
    mountId: "100",
  });
  const lockAncestry = {
    schema: "oxigraph.g1.7-held-global-harness-lock-ancestry/v1",
    source: "openat2-held-fd-fstat-fstatfs-statx-mnt-id/v1",
    resolver: "openat2-resolve-beneath-no-symlinks/v1",
    rootPath: lockLocator.rootPath,
    rootIdentity: structuredClone(lockRoot),
    component: lockLocator.component,
    lockIdentity: structuredClone(lockObject),
    result: "SAME_OBJECT",
  };
  const leaseId = canonicalSha256({
    schema: "oxigraph.g1.7-harness-session-lease-id/v1",
    runId: expected.runId,
    controller,
    holder,
    lockLocator,
    lockAncestry,
    lockObject,
    acquiredAt: times[0],
  });
  const contenderPid = "4243";
  const contenderAt = new Date(Date.parse(times[0]) + 500).toISOString();
  const contenderGeneration = canonicalSha256({
    schema: "oxigraph.g1.7-harness-session-lease-contender-id/v1",
    runId: expected.runId,
    leaseId,
    pid: contenderPid,
  });
  const observations = {
    "controller-before": observation("controller-before", times[1], leaseId),
    "worker-before": observation("worker-before", times[2], leaseId),
    "worker-after": observation("worker-after", times[3], leaseId),
    "controller-after": observation("controller-after", times[4], leaseId),
  };
  const controllerAfter = observations["controller-after"];
  const inventoryCapturedAt = new Date(Date.parse(times[5]) + 500).toISOString();
  const inventoryUnsigned = {
    schema: "oxigraph.g1.7-containment-cleanup-inventory/v1",
    runId: expected.runId,
    stateGeneration: canonicalSha256({
      schema: "oxigraph.g1.7-containment-state-generation/v1",
      runId: expected.runId,
      identity: controllerAfter.held.state,
    }),
    capturedAt: inventoryCapturedAt,
    entries: [
      {
        path: "data.bin",
        kind: "file",
        bytes: 65_536,
        sha256: sha256(Buffer.from("fixture-state-file", "utf8")),
      },
      {
        path: "nested",
        kind: "directory",
        bytes: 0,
        sha256: sha256(Buffer.alloc(0)),
      },
    ],
    entryCount: 2,
    totalBytes: 65_536,
    maxDepthObserved: 1,
  };
  const inventory = {
    ...inventoryUnsigned,
    contentHash: canonicalSha256(inventoryUnsigned),
  };
  const unlinked = (value) => ({ ...structuredClone(value), links: "0" });
  const cgroupParts = cgroupPath.split("/").filter(Boolean);
  const cgroupParentPath = `/${cgroupParts.slice(0, -1).join("/")}`;
  const cgroupComponent = cgroupParts.at(-1);
  return {
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
    limits: structuredClone(expected.limits),
    startedAt: times[1],
    completedAt: times[3],
    lease: {
      schema: "oxigraph.g1.7-harness-session-lease/v1",
      mechanism: "flock-lock-ex-nb/v1",
      scope: "engineering-harness-g1.7",
      leaseId,
      controller,
      holder,
      lockLocator,
      lockAncestry,
      lockObject,
      acquiredAt: times[0],
      acquisition: {
        schema: "oxigraph.g1.7-harness-session-lease-acquisition/v1",
        operation: "flock",
        flags: ["LOCK_EX", "LOCK_NB"],
        result: "ACQUIRED",
        errno: null,
        observedAt: times[0],
        controller: structuredClone(controller),
        holder: structuredClone(holder),
        lockLocator: structuredClone(lockLocator),
        lockAncestry: structuredClone(lockAncestry),
        lockObject: structuredClone(lockObject),
      },
      contender: {
        schema: "oxigraph.g1.7-harness-session-lease-contender/v1",
        operation: "flock",
        flags: ["LOCK_EX", "LOCK_NB"],
        result: "BLOCKED",
        errno: "EWOULDBLOCK",
        observedAt: contenderAt,
        pid: contenderPid,
        generation: contenderGeneration,
        lockLocator: structuredClone(lockLocator),
        lockAncestry: structuredClone(lockAncestry),
        lockObject: structuredClone(lockObject),
      },
      observations: [
        { phase: "acquired", at: times[0], held: true, lockObject: structuredClone(lockObject) },
        { phase: "controller-before", at: times[1], held: true, lockObject: structuredClone(lockObject) },
        { phase: "worker-before", at: times[2], held: true, lockObject: structuredClone(lockObject) },
        { phase: "worker-after", at: times[3], held: true, lockObject: structuredClone(lockObject) },
        { phase: "controller-after", at: times[4], held: true, lockObject: structuredClone(lockObject) },
        { phase: "quiesced", at: times[5], held: true, lockObject: structuredClone(lockObject) },
        { phase: "cleanup-complete", at: times[6], held: true, lockObject: structuredClone(lockObject) },
        { phase: "released", at: times[7], held: false, lockObject: structuredClone(lockObject) },
      ],
      releasedAt: times[7],
    },
    observations,
    quiescence: {
      schema: "oxigraph.g1.7-containment-quiescence/v1",
      status: "QUIESCENT",
      observedAt: times[5],
      workerExitDisposition: "completed",
      workerExitCode: 0,
      workerSignal: null,
      cgroupPopulated: false,
      pidsCurrent: 0,
      processesRemaining: 0,
    },
    cleanup: {
      schema: "oxigraph.g1.7-containment-cleanup/v1",
      status: "COMPLETE",
      completedAt: times[6],
      inventory: raw(`${canonical(inventory)}\n`),
      limits: {
        maxStateBytes: expected.limits.maxStateBytes,
        maxStateEntries: expected.limits.maxStateEntries,
        maxStateDepth: expected.limits.maxStateDepth,
        maxInventoryBytes: 1024 * 1024,
        maxInventoryEntries: 4_096,
      },
      postCleanup: {
        observedAt: times[6],
        state: {
          operation: "openat2-resolve-beneath-no-symlinks/v1",
          parentIdentity: structuredClone(controllerAfter.held.run),
          component: "state",
          result: "ABSENT",
          errno: "ENOENT",
          heldIdentity: unlinked(controllerAfter.held.state),
        },
        cgroup: {
          operation: "openat2-resolve-beneath-no-symlinks/v1",
          mount: structuredClone(controllerAfter.cgroup.mount),
          parentPath: cgroupParentPath,
          component: cgroupComponent,
          result: "ABSENT",
          errno: "ENOENT",
          heldIdentity: unlinked(controllerAfter.held.cgroup),
        },
      },
      errors: [],
    },
    nonclaims: {
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
    },
    authority: {
      controlExecution: false,
      qualificationExecution: false,
      promotion: false,
      publication: false,
      routerQuality: false,
      providerExecution: false,
    },
  };
}

function build(evidence = fixtureEvidence(), expectedBinding = structuredClone(expected)) {
  return createG17NonTmpfsContainmentArtifactForTesting({
    evidence,
    expected: expectedBinding,
  });
}

function rehash(value) {
  const { contentHash: _old, ...unsigned } = value;
  return { ...unsigned, contentHash: canonicalSha256(unsigned) };
}

function resealLeaseIdentity(evidence) {
  const { lease } = evidence;
  lease.acquisition.controller = structuredClone(lease.controller);
  lease.acquisition.holder = structuredClone(lease.holder);
  lease.acquisition.lockLocator = structuredClone(lease.lockLocator);
  lease.acquisition.lockAncestry = structuredClone(lease.lockAncestry);
  lease.acquisition.lockObject = structuredClone(lease.lockObject);
  lease.contender.lockLocator = structuredClone(lease.lockLocator);
  lease.contender.lockAncestry = structuredClone(lease.lockAncestry);
  lease.contender.lockObject = structuredClone(lease.lockObject);
  for (const observation of lease.observations) {
    observation.lockObject = structuredClone(lease.lockObject);
  }
  lease.leaseId = canonicalSha256({
    schema: "oxigraph.g1.7-harness-session-lease-id/v1",
    runId: expected.runId,
    controller: lease.controller,
    holder: lease.holder,
    lockLocator: lease.lockLocator,
    lockAncestry: lease.lockAncestry,
    lockObject: lease.lockObject,
    acquiredAt: lease.acquiredAt,
  });
  for (const observation of Object.values(evidence.observations)) {
    observation.leaseId = lease.leaseId;
  }
  lease.contender.generation = canonicalSha256({
    schema: "oxigraph.g1.7-harness-session-lease-contender-id/v1",
    runId: expected.runId,
    leaseId: lease.leaseId,
    pid: lease.contender.pid,
  });
}

test("non-tmpfs containment evidence replays exact held, lease, cgroup, and cleanup facts", () => {
  const created = build();
  const suppliedBytes = created.bytes;
  const suppliedSha256 = sha256(suppliedBytes);
  const projection = replayG17NonTmpfsContainment({
    bytes: suppliedBytes,
    expected: structuredClone(expected),
  });
  assert.equal(projection.schema, G17_NON_TMPFS_CONTAINMENT_PROJECTION_SCHEMA);
  assert.equal(projection.status, "CONTAINMENT_EVIDENCE_REPLAYED");
  assert.equal(projection.outcome, "EVIDENCE_REPLAYED");
  assert.equal(
    projection.bindingsProvenance,
    "CALLER_SUPPLIED_UNSEALED_NONAUTHORITATIVE",
  );
  assert.equal(projection.environmentClass, G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS);
  assert.equal(projection.artifact.name, G17_NON_TMPFS_CONTAINMENT_ARTIFACT_NAME);
  assert.equal(projection.artifact.sha256, suppliedSha256);
  assert.equal(projection.containment.filesystem, "ext4");
  assert.equal(projection.containment.filesystemType, "61267");
  assert.equal(projection.containment.stateDevice, "2049");
  assert.equal(projection.containment.cgroupV2, "EVIDENCE_REPLAYED");
  assert.equal(
    projection.containment.exactCgroupLimitBytes,
    "EVIDENCE_REPLAYED",
  );
  assert.equal(projection.lease.heldThroughCleanup, "EVIDENCE_REPLAYED");
  assert.equal(projection.lease.contender, "EWOULDBLOCK_EVIDENCE_REPLAYED");
  assert.equal(projection.lease.controller.pid, expected.controllerPid);
  assert.equal(projection.lease.holder.pid, expected.holderPid);
  assert.deepEqual(
    projection.lease.globalLockLocator,
    expected.globalLockLocator,
  );
  assert.equal(
    projection.containment.harnessSessionExclusive,
    "GLOBAL_LOCK_LOCATION_ANCESTRY_AND_EWOULDBLOCK_EVIDENCE_REPLAYED",
  );
  assert.equal(projection.containment.worker.pid, expected.workerPid);
  assert.equal(
    projection.containment.worker.generation,
    expected.workerGeneration,
  );
  assert.equal(projection.containment.cleanup.inventoryEntries, 2);
  assert.equal(projection.containment.cleanup.inventoryBytes, 65_536);
  assert.equal(projection.lease.fullSessionWallMsEvidence, 7_000);
  assert.equal(projection.finalDecisionEligible, false);
  assert.equal(projection.binding, null);
  assert.deepEqual(new Set(Object.values(projection.authority)), new Set([false]));
  assert.deepEqual(new Set(Object.values(projection.nonclaims)), new Set([false]));
  assert.equal(projection.nonclaims.sealedExpectedBindings, false);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.containment), true);

  suppliedBytes.fill(0);
  assert.equal(projection.artifact.sha256, suppliedSha256);
  assert.equal(sha256(created.bytes), projection.artifact.sha256);
});

test("every observation rejects tmpfs, ramfs, device, mount, or held-object drift", () => {
  for (const phase of [
    "controller-before",
    "worker-before",
    "worker-after",
    "controller-after",
  ]) {
    const tmpfs = fixtureEvidence();
    tmpfs.observations[phase].stateStatfs.type = "16914836";
    assert.throws(() => build(tmpfs), /tmpfs or ramfs/u, phase);
  }

  const device = fixtureEvidence();
  device.observations["worker-after"].held.state.device = "2050";
  assert.throws(
    () => build(device),
    /held directory, device|held state|differs|not the held writable/u,
  );

  const inode = fixtureEvidence();
  inode.observations["worker-before"].held.state.inode = "99";
  assert.throws(
    () => build(inode),
    /worker held state (?:or cgroup differs|identity changed)/u,
  );

  const mountClaim = fixtureEvidence();
  mountClaim.observations["worker-before"].stateMount.source = "/dev/forged";
  assert.throws(() => build(mountClaim), /differs from raw mountinfo/u);

  const chain = fixtureEvidence();
  chain.observations["controller-before"].held.run.mountId = "101";
  assert.throws(() => build(chain), /root\/run\/state owner or identity chain/u);

  const workerMountGeneration = fixtureEvidence();
  workerMountGeneration.observations["worker-after"].held.state.mountId = "301";
  workerMountGeneration.observations["worker-after"].stateMount.mountId = "301";
  workerMountGeneration.observations["worker-after"].mountinfo = raw(
    workerMountinfo.replace(/^300 /mu, "301 "),
  );
  assert.throws(
    () => build(workerMountGeneration),
    /worker held state identity changed|mount rows changed/u,
  );

  const changedHeldCgroupOwner = fixtureEvidence();
  changedHeldCgroupOwner.observations["controller-before"].held.cgroup.uid =
    "1001";
  assert.throws(
    () => build(changedHeldCgroupOwner),
    /held cgroup differs from its controller evidence/u,
  );

  const omittedHeldCgroupMount = fixtureEvidence();
  delete omittedHeldCgroupMount.observations["controller-before"].held.cgroup
    .mountId;
  assert.throws(
    () => build(omittedHeldCgroupMount),
    /held objects cgroup fields are not exact/u,
  );
});

test("raw cgroup-v2 membership, controller, limit, and final-zero bytes fail closed", () => {
  const cases = [
    ["membership", raw("0::/wrong.scope\n"), /membership does not bind/u],
    ["controllers", raw("cpu io pids\n"), /required controllers/u],
    ["cgroupType", raw("threaded\n"), /not a domain cgroup/u],
    ["memoryMax", raw("1073741825\n"), /memory\.max bytes drifted/u],
    ["memorySwapMax", raw("max\n"), /memory\.swap\.max bytes drifted/u],
    ["pidsMax", raw("513\n"), /pids\.max bytes drifted/u],
    ["cpuMax", raw("50000 100000\n"), /cpu\.max bytes drifted/u],
  ];
  for (const [key, record, pattern] of cases) {
    const evidence = fixtureEvidence();
    evidence.observations["worker-before"].cgroup[key] = record;
    assert.throws(() => build(evidence), pattern, key);
  }

  for (const [key, record] of [
    ["pidsCurrent", raw("1\n")],
    ["procs", raw("4242\n")],
    ["events", raw("populated 1\nfrozen 0\n")],
  ]) {
    const evidence = fixtureEvidence();
    evidence.observations["controller-after"].cgroup[key] = record;
    assert.throws(() => build(evidence), /not quiescent/u, key);
  }
});

test("the cgroup generation binds run, controller, and raw worker identities", () => {
  assert.notEqual(
    deriveG17NonTmpfsContainmentCgroupPath({
      runId: "different-run",
      ownerInputSha256: expected.ownerInputSha256,
      controllerPid: expected.controllerPid,
      controllerGeneration: expected.controllerGeneration,
      workerPid: expected.workerPid,
      workerGeneration: expected.workerGeneration,
    }),
    cgroupPath,
  );

  const coherentWrongGeneration = fixtureEvidence();
  const wrongGeneration = "worker-generation-2";
  const wrongPath = deriveG17NonTmpfsContainmentCgroupPath({
    runId: expected.runId,
    ownerInputSha256: expected.ownerInputSha256,
    controllerPid: expected.controllerPid,
    controllerGeneration: expected.controllerGeneration,
    workerPid: expected.workerPid,
    workerGeneration: wrongGeneration,
  });
  for (const [phase, item] of Object.entries(
    coherentWrongGeneration.observations,
  )) {
    const after = phase === "controller-after";
    item.cgroup.relativePath = wrongPath;
    item.cgroup.worker.generation = wrongGeneration;
    item.cgroup.membership = raw(after ? "" : `0::${wrongPath}\n`);
    if (phase.startsWith("worker-")) {
      item.cgroup.mount.root = wrongPath;
      const mountinfo = Buffer.from(item.mountinfo.base64, "base64")
        .toString("utf8")
        .replaceAll(cgroupPath, wrongPath);
      item.mountinfo = raw(mountinfo);
    }
  }
  assert.throws(
    () => build(coherentWrongGeneration),
    /path or worker generation differs from the expected run/u,
  );

  const coherentWrongController = fixtureEvidence();
  const wrongControllerPath = deriveG17NonTmpfsContainmentCgroupPath({
    runId: expected.runId,
    ownerInputSha256: expected.ownerInputSha256,
    controllerPid: "4244",
    controllerGeneration: "controller-generation-2",
    workerPid: expected.workerPid,
    workerGeneration: expected.workerGeneration,
  });
  for (const [phase, item] of Object.entries(
    coherentWrongController.observations,
  )) {
    const after = phase === "controller-after";
    item.cgroup.relativePath = wrongControllerPath;
    item.cgroup.membership = raw(
      after ? "" : `0::${wrongControllerPath}\n`,
    );
    if (phase.startsWith("worker-")) {
      item.cgroup.mount.root = wrongControllerPath;
      const mountinfo = Buffer.from(item.mountinfo.base64, "base64")
        .toString("utf8")
        .replaceAll(cgroupPath, wrongControllerPath);
      item.mountinfo = raw(mountinfo);
    }
  }
  assert.throws(
    () => build(coherentWrongController),
    /path or worker generation differs from the expected run/u,
  );

  const coherentWrongPid = fixtureEvidence();
  for (const [phase, item] of Object.entries(coherentWrongPid.observations)) {
    item.cgroup.worker.pid = "4244";
    item.cgroup.procs = raw(phase === "controller-after" ? "" : "4244\n");
  }
  assert.throws(
    () => build(coherentWrongPid),
    /path or worker generation differs from the expected run/u,
  );

  const missingExpectedPid = fixtureEvidence();
  missingExpectedPid.observations["worker-before"].cgroup.procs = raw("4243\n");
  assert.throws(
    () => build(missingExpectedPid),
    /does not prove a live bounded cgroup/u,
  );
});

test("the exclusive lease must cover every observation, quiescence, and cleanup", () => {
  const releasedEarly = fixtureEvidence();
  releasedEarly.lease.observations[6].held = false;
  assert.throws(() => build(releasedEarly), /lease observation cleanup-complete/u);

  const wrongLease = fixtureEvidence();
  wrongLease.observations["worker-after"].leaseId = "f".repeat(64);
  assert.throws(() => build(wrongLease), /outside the held lease/u);

  const reordered = fixtureEvidence();
  reordered.lease.observations[5].at = times[3];
  assert.throws(() => build(reordered), /lease observation quiesced/u);

  const lockMode = fixtureEvidence();
  lockMode.lease.lockObject.mode = "420";
  assert.throws(
    () => build(lockMode),
    /global lock ancestry|exact held owner lock|lease id/u,
  );

  const notQuiescent = fixtureEvidence();
  notQuiescent.quiescence.processesRemaining = 1;
  assert.throws(() => build(notQuiescent), /quiescence is incomplete/u);

  const cleanupFailed = fixtureEvidence();
  cleanupFailed.cleanup.status = "FAILED";
  assert.throws(() => build(cleanupFailed), /cleanup is not exact and complete/u);
});

test("the full-session wall clock, acquisition, contender, and lock identity fail closed", () => {
  const overWall = fixtureEvidence();
  const lateRelease = new Date(
    Date.parse(overWall.lease.acquiredAt) + overWall.limits.totalWallMs + 1,
  ).toISOString();
  overWall.lease.releasedAt = lateRelease;
  overWall.lease.observations.at(-1).at = lateRelease;
  assert.throws(() => build(overWall), /lease duration/u);

  const acquisition = fixtureEvidence();
  acquisition.lease.acquisition.flags.reverse();
  assert.throws(() => build(acquisition), /lease acquisition evidence drifted/u);

  const contender = fixtureEvidence();
  contender.lease.contender.errno = "EAGAIN";
  assert.throws(() => build(contender), /lease contender evidence drifted/u);

  const sameWorker = fixtureEvidence();
  sameWorker.lease.contender.pid = expected.workerPid;
  sameWorker.lease.contender.generation = canonicalSha256({
    schema: "oxigraph.g1.7-harness-session-lease-contender-id/v1",
    runId: expected.runId,
    leaseId: sameWorker.lease.leaseId,
    pid: expected.workerPid,
  });
  assert.throws(
    () => build(sameWorker),
    /process identities are not pairwise distinct|lease contender evidence drifted/u,
  );

  const changedLock = fixtureEvidence();
  changedLock.lease.observations[4].lockObject.inode = "99";
  assert.throws(
    () => build(changedLock),
    /lease observation controller-after is contradictory/u,
  );
});

test("trusted process and global-lock bindings reject coherent substitutions", () => {
  const holderSubstitution = fixtureEvidence();
  holderSubstitution.lease.holder = {
    pid: "4244",
    generation: "holder-generation-2",
  };
  resealLeaseIdentity(holderSubstitution);
  assert.throws(
    () => build(holderSubstitution),
    /controller or holder drifted from its trusted binding/u,
  );

  const controllerSubstitution = fixtureEvidence();
  controllerSubstitution.lease.controller = {
    pid: "4244",
    generation: "controller-generation-2",
  };
  resealLeaseIdentity(controllerSubstitution);
  assert.throws(
    () => build(controllerSubstitution),
    /controller or holder drifted from its trusted binding/u,
  );

  const privateLock = fixtureEvidence();
  privateLock.lease.lockLocator.rootPath =
    "/var/lib/oxigraph-engineering-harness/private-run";
  privateLock.lease.lockAncestry.rootPath =
    privateLock.lease.lockLocator.rootPath;
  resealLeaseIdentity(privateLock);
  assert.throws(
    () => build(privateLock),
    /frozen global lock locator/u,
  );

  const privateExpected = structuredClone(expected);
  privateExpected.globalLockLocator.rootPath =
    "/var/lib/oxigraph-engineering-harness/private-run";
  assert.throws(
    () => build(privateLock, privateExpected),
    /frozen global lock locator/u,
  );
});

test("explicit ancestry and raw cleanup inventory observations fail closed", () => {
  const ancestry = fixtureEvidence();
  ancestry.observations["controller-before"].held.ancestry.edges[0].component =
    "different-run";
  assert.throws(() => build(ancestry), /ancestry evidence drifted/u);

  const rawIdentity = fixtureEvidence();
  rawIdentity.cleanup.inventory.sha256 = "0".repeat(64);
  assert.throws(() => build(rawIdentity), /byte identity does not verify/u);

  const reordered = fixtureEvidence();
  resealCleanupInventory(reordered, (inventory) => {
    inventory.entries.reverse();
  });
  assert.throws(() => build(reordered), /not strictly path-sorted/u);

  const wrongTotal = fixtureEvidence();
  resealCleanupInventory(wrongTotal, (inventory) => {
    inventory.entries[0].bytes += 1;
  });
  assert.throws(() => build(wrongTotal), /derived totals drifted/u);

  const wrongGeneration = fixtureEvidence();
  resealCleanupInventory(wrongGeneration, (inventory) => {
    inventory.stateGeneration = "f".repeat(64);
  });
  assert.throws(
    () => build(wrongGeneration),
    /inventory identity, ordering, or cardinality drifted/u,
  );

  const staleInventory = fixtureEvidence();
  resealCleanupInventory(staleInventory, (inventory) => {
    inventory.capturedAt = times[5];
  });
  assert.throws(
    () => build(staleInventory),
    /inventory identity, ordering, or cardinality drifted/u,
  );

  const present = fixtureEvidence();
  present.cleanup.postCleanup.state.result = "PRESENT";
  assert.throws(
    () => build(present),
    /does not bind exact pathname absence and held-object unlink/u,
  );

  const stillLinked = fixtureEvidence();
  stillLinked.cleanup.postCleanup.cgroup.heldIdentity.links = "1";
  assert.throws(
    () => build(stillLinked),
    /not an unlinked held directory/u,
  );
});

test("mountinfo grammar and decimal inputs are strictly bounded", () => {
  const writableWorkerControl = fixtureEvidence();
  writableWorkerControl.observations["worker-before"].cgroup.mount.access = "rw";
  writableWorkerControl.observations["worker-before"].mountinfo = raw(
    workerMountinfo.replace(
      "/control/cgroup2 ro,nosuid",
      "/control/cgroup2 rw,nosuid",
    ),
  );
  assert.throws(
    () => build(writableWorkerControl),
    /exact cgroup-v2 mount differs/u,
  );

  const extraSeparator = fixtureEvidence();
  extraSeparator.observations["controller-before"].mountinfo = raw(
    controllerMountinfo.replace(" - ext4", " - - ext4"),
  );
  assert.throws(() => build(extraSeparator), /mountinfo row is malformed/u);

  const duplicateOption = fixtureEvidence();
  duplicateOption.observations["controller-before"].mountinfo = raw(
    controllerMountinfo.replace("rw,relatime - ext4", "rw,rw,relatime - ext4"),
  );
  assert.throws(() => build(duplicateOption), /malformed or duplicated/u);

  const trailingSlash = fixtureEvidence();
  trailingSlash.observations["controller-before"].mountinfo = raw(
    controllerMountinfo.replace("8:1 / / rw", "8:1 /state/ / rw"),
  );
  assert.throws(() => build(trailingSlash), /canonical absolute mount path/u);

  const oversizedDecimal = fixtureEvidence();
  oversizedDecimal.observations["controller-before"].held.state.device =
    "9".repeat(33);
  assert.throws(() => build(oversizedDecimal), /bounded canonical decimal/u);

  const oversizedPid = fixtureEvidence();
  oversizedPid.observations["worker-before"].cgroup.procs = raw("99999999\n");
  assert.throws(() => build(oversizedPid), /invalid or duplicate PIDs/u);
});

test("canonical framing, exact fields, outer hash, and raw byte hashes are independent", () => {
  const created = build();
  const value = JSON.parse(created.bytes);
  assert.notEqual(projectionHashes(created).raw, projectionHashes(created).inner);

  for (const bytes of [
    created.bytes.subarray(0, -1),
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    Buffer.concat([created.bytes, Buffer.from("\n")]),
  ]) {
    assert.throws(
      () => replayG17NonTmpfsContainment({ bytes, expected: structuredClone(expected) }),
      /canonical JSON plus one LF/u,
    );
  }

  const unknown = rehash({ ...value, unexpectedAuthority: true });
  assert.throws(
    () => replayG17NonTmpfsContainment({
      bytes: Buffer.from(`${canonical(unknown)}\n`, "utf8"),
      expected: structuredClone(expected),
    }),
    /fields are not exact/u,
  );

  const wrongInner = { ...value, contentHash: "0".repeat(64) };
  assert.throws(
    () => replayG17NonTmpfsContainment({
      bytes: Buffer.from(`${canonical(wrongInner)}\n`, "utf8"),
      expected: structuredClone(expected),
    }),
    /contentHash does not verify/u,
  );

  const wrongRaw = structuredClone(value);
  wrongRaw.observations["worker-before"].cgroup.memoryMax.sha256 = "0".repeat(64);
  const wrongRawRehashed = rehash(wrongRaw);
  assert.throws(
    () => replayG17NonTmpfsContainment({
      bytes: Buffer.from(`${canonical(wrongRawRehashed)}\n`, "utf8"),
      expected: structuredClone(expected),
    }),
    /byte identity does not verify/u,
  );
});

function projectionHashes(created) {
  return {
    raw: created.projection.artifact.sha256,
    inner: created.projection.artifact.contentHash,
  };
}

test("bindings, ceilings, nonclaims, and authority cannot be broadened by rehashing", () => {
  const created = build();
  for (const mutate of [
    (value) => { value.bindings.ownerInputSha256 = "9".repeat(64); },
    (value) => { value.bindingsProvenance = "SEALED_AND_REVIEWED"; },
    (value) => { value.limits.pidsMax = 513; },
    (value) => { value.nonclaims.dedicatedHost = true; },
    (value) => { value.authority.controlExecution = true; },
    (value) => { value.environmentClass = "linux-x86_64-cgroup-v2-tmpfs-serialized"; },
  ]) {
    const value = JSON.parse(created.bytes);
    mutate(value);
    const tampered = rehash(value);
    assert.throws(
      () => replayG17NonTmpfsContainment({
        bytes: Buffer.from(`${canonical(tampered)}\n`, "utf8"),
        expected: structuredClone(expected),
      }),
      /drifted|broadened|carries authority|overstated/u,
    );
  }
});

test("public envelopes and testing data reject accessors, symbols, cycles, and foreign prototypes", () => {
  const created = build();
  const accessorOptions = { expected: structuredClone(expected) };
  Object.defineProperty(accessorOptions, "bytes", {
    enumerable: true,
    get() {
      throw new Error("must not execute");
    },
  });
  assert.throws(
    () => replayG17NonTmpfsContainment(accessorOptions),
    /must be an enumerable data field/u,
  );

  const symbolOptions = { bytes: created.bytes, expected: structuredClone(expected) };
  symbolOptions[Symbol("authority")] = true;
  assert.throws(() => replayG17NonTmpfsContainment(symbolOptions), /fields are not exact/u);

  const foreign = Object.create(null);
  foreign.bytes = created.bytes;
  foreign.expected = structuredClone(expected);
  assert.throws(() => replayG17NonTmpfsContainment(foreign), /ordinary object/u);

  const cyclic = fixtureEvidence();
  cyclic.cleanup.errors.push(cyclic);
  assert.throws(() => build(cyclic), /contains a cycle/u);

  const nestedAccessor = fixtureEvidence();
  Object.defineProperty(nestedAccessor.owner, "uid", {
    enumerable: true,
    get() {
      throw new Error("must not execute");
    },
  });
  assert.throws(() => build(nestedAccessor), /contains an accessor/u);

  const expectedExtra = structuredClone(expected);
  expectedExtra.claimedRawSha256 = "0".repeat(64);
  assert.throws(() => build(fixtureEvidence(), expectedExtra), /fields are not exact/u);

  assert.throws(
    () => replayG17NonTmpfsContainment({
      bytes: Buffer.alloc(G17_NON_TMPFS_CONTAINMENT_MAX_BYTES + 1),
      expected: structuredClone(expected),
    }),
    /not a bounded Buffer/u,
  );
});

test("pure containment replay has no filesystem, process, or child-process import path", async () => {
  const source = await readFile(
    new URL("../src/qualification/non-tmpfs-containment-contract.mjs", import.meta.url),
    "utf8",
  );
  const imports = Array.from(
    source.matchAll(/^import .* from "([^"]+)";/gmu),
    (match) => match[1],
  );
  assert.deepEqual(imports, ["node:crypto", "node:util"]);
  assert.doesNotMatch(
    source,
    /node:(?:fs|child_process|process|os)|\b(?:spawn|execFile|execSync|openSync|readFileSync|statfsSync)\s*\(/u,
  );
});
