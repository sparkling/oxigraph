import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  G17_NON_TMPFS_CONTAINMENT_GLOBAL_LOCK_LOCATOR,
  deriveG17NonTmpfsContainmentCgroupPath,
} from "../../src/qualification/non-tmpfs-containment-contract.mjs";
import {
  canonicalJson,
  canonicalSha256,
} from "../../src/routing/features.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const currentAuthorizationUrl = new URL(
  "../../qualification/g1.7/decisions/control-authorization.json",
  import.meta.url,
);

export function g17ContainmentOwnerExpected(overrides = {}) {
  return {
    runId: "g17-containment-owner-fixture",
    ownerInputSha256: "1".repeat(64),
    platformManifestSha256: "2".repeat(64),
    controllerClosureSha256: "3".repeat(64),
    workspaceProjectionSha256: "4".repeat(64),
    ownerUid: "1000",
    ownerGid: "1000",
    globalLockLocator: structuredClone(
      G17_NON_TMPFS_CONTAINMENT_GLOBAL_LOCK_LOCATOR,
    ),
    controllerPid: "4240",
    controllerGeneration: "controller-generation-1",
    holderPid: "4241",
    holderGeneration: "holder-generation-1",
    workerPid: "4242",
    workerGeneration: "worker-generation-1",
    limits: {
      memoryMaxBytes: 1_073_741_824,
      memorySwapMaxBytes: 0,
      pidsMax: 512,
      cpuQuotaMicros: null,
      cpuPeriodMicros: 100_000,
      maxStateBytes: 536_870_912,
      maxStateEntries: 100_000,
      maxStateDepth: 64,
      totalWallMs: 600_000,
    },
    ...overrides,
  };
}

export function g17ApprovedControlAuthorizationFixture() {
  const authorization = JSON.parse(
    readFileSync(currentAuthorizationUrl, "utf8"),
  );
  authorization.status = "CONTROL_AUTHORIZED";
  authorization.approval = {
    status: "APPROVED",
    approvedBy: "containment-owner-test-reviewer",
    approvedAt: "2026-08-28T00:00:00.000Z",
  };
  const { contentHash: ignored, ...unsigned } = authorization;
  authorization.contentHash = canonicalSha256(unsigned);
  const bytes = Buffer.from(`${canonicalJson(authorization)}\n`, "utf8");
  return {
    authorizationBytes: bytes,
    controlStartedAt: "2026-08-28T11:59:59.000Z",
  };
}

export function g17ProposedControlAuthorizationFixture() {
  return {
    authorizationBytes: readFileSync(currentAuthorizationUrl),
    controlStartedAt: "2026-08-28T11:59:59.000Z",
  };
}

export function createG17ContainmentOwnerClock({ releaseOffsetMs = 7_000 } = {}) {
  const origin = Date.UTC(2026, 7, 28, 12, 0, 0);
  const offsets = [
    0,
    500,
    1_000,
    2_000,
    3_000,
    4_000,
    5_000,
    5_500,
    6_000,
    releaseOffsetMs,
  ];
  let index = 0;
  return () => {
    if (index >= offsets.length) throw new Error("fixture clock exhausted");
    const value = new Date(origin + offsets[index]);
    index += 1;
    return value;
  };
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

function stateStatfs() {
  return {
    type: "61267",
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
    superOptions: "rw",
    optionalFields: [],
  };
}

function observationFacts(expected, phase, cgroupPath) {
  const worker = phase.startsWith("worker-");
  const after = phase === "controller-after";
  const stateMountId = worker ? "300" : "100";
  const cgroupMountId = worker ? "400" : "200";
  const controllerMountinfo = [
    "100 1 8:1 / / rw,relatime - ext4 /dev/sda1 rw",
    "200 1 0:28 / /sys/fs/cgroup rw,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw",
    "",
  ].join("\n");
  const workerMountinfo = [
    "300 1 8:1 /harness/session/state /state rw,relatime - ext4 /dev/sda1 rw",
    `400 1 0:28 ${cgroupPath} /control/cgroup2 ro,nosuid,nodev,noexec,relatime - cgroup2 cgroup rw`,
    "",
  ].join("\n");
  const root = worker
    ? null
    : identity({ device: "2049", inode: "10", links: "3", mountId: "100" });
  const run = worker
    ? null
    : identity({ device: "2049", inode: "11", links: "3", mountId: "100" });
  const state = identity({
    device: "2049",
    inode: "12",
    uid: worker ? "0" : expected.ownerUid,
    gid: worker ? "0" : expected.ownerGid,
    links: "5",
    mountId: stateMountId,
  });
  const heldCgroup = identity({
    device: "28",
    inode: "20",
    uid: worker ? "0" : expected.ownerUid,
    gid: worker ? "0" : expected.ownerGid,
    mode: "493",
    links: "2",
    mountId: cgroupMountId,
  });
  return {
    mountinfo: Buffer.from(worker ? workerMountinfo : controllerMountinfo, "utf8"),
    held: { root, run, state, cgroup: heldCgroup },
    stateStatfs: stateStatfs(),
    stateMount: mount({
      mountId: stateMountId,
      device: "2049",
      root: worker ? "/harness/session/state" : "/",
      mountPoint: worker ? "/state" : "/",
      access: "rw",
      filesystem: "ext4",
      source: "/dev/sda1",
    }),
    cgroup: {
      relativePath: cgroupPath,
      directory: structuredClone(heldCgroup),
      mount: mount({
        mountId: cgroupMountId,
        device: "28",
        root: worker ? cgroupPath : "/",
        mountPoint: worker ? "/control/cgroup2" : "/sys/fs/cgroup",
        access: worker ? "ro" : "rw",
        filesystem: "cgroup2",
        source: "cgroup",
      }),
      statfs: cgroupStatfs(),
      membership: Buffer.from(after ? "" : `0::${cgroupPath}\n`, "utf8"),
      controllers: Buffer.from(
        "cpuset cpu io memory hugetlb pids rdma misc dmem\n",
        "utf8",
      ),
      cgroupType: Buffer.from("domain\n", "utf8"),
      memoryMax: Buffer.from(`${expected.limits.memoryMaxBytes}\n`, "utf8"),
      memorySwapMax: Buffer.from(
        `${expected.limits.memorySwapMaxBytes}\n`,
        "utf8",
      ),
      pidsMax: Buffer.from(`${expected.limits.pidsMax}\n`, "utf8"),
      cpuMax: Buffer.from(
        `${expected.limits.cpuQuotaMicros ?? "max"} ${expected.limits.cpuPeriodMicros}\n`,
        "utf8",
      ),
      pidsCurrent: Buffer.from(after ? "0\n" : "1\n", "utf8"),
      procs: Buffer.from(after ? "" : `${expected.workerPid}\n`, "utf8"),
      events: Buffer.from(
        after ? "populated 0\nfrozen 0\n" : "populated 1\nfrozen 0\n",
        "utf8",
      ),
      worker: {
        pid: expected.workerPid,
        generation: expected.workerGeneration,
      },
    },
  };
}

function unlinked(value) {
  return { ...structuredClone(value), links: "0" };
}

export function createG17ContainmentFakeMechanics({
  expected = g17ContainmentOwnerExpected(),
  failAt,
  hangAt,
  abortController,
} = {}) {
  const log = [];
  const cgroupPath = deriveG17NonTmpfsContainmentCgroupPath({
    runId: expected.runId,
    ownerInputSha256: expected.ownerInputSha256,
    controllerPid: expected.controllerPid,
    controllerGeneration: expected.controllerGeneration,
    workerPid: expected.workerPid,
    workerGeneration: expected.workerGeneration,
  });
  const controllerAfter = observationFacts(expected, "controller-after", cgroupPath);
  const session = { id: "fake-containment-session" };
  const record = (name) => {
    log.push(name);
    if (failAt === name) throw new Error(`synthetic ${name} failure`);
  };
  const mechanics = {
    async openSession(input) {
      record("openSession");
      assertSessionInput(input, expected, cgroupPath, false);
      return session;
    },
    async acquireLease({ session: actual }) {
      record("acquireLease");
      assertSession(actual, session);
      return {
        controller: {
          pid: expected.controllerPid,
          generation: expected.controllerGeneration,
        },
        holder: {
          pid: expected.holderPid,
          generation: expected.holderGeneration,
        },
        lockLocator: structuredClone(expected.globalLockLocator),
        rootIdentity: identity({
          device: "2049",
          inode: "10",
          uid: expected.ownerUid,
          gid: expected.ownerGid,
          links: "3",
          mountId: "100",
        }),
        lockObject: identity({
          kind: "regular",
          device: "2049",
          inode: "9",
          uid: expected.ownerUid,
          gid: expected.ownerGid,
          mode: "384",
          links: "1",
          mountId: "100",
        }),
      };
    },
    async probeLeaseContender({ session: actual }) {
      record("probeLeaseContender");
      assertSession(actual, session);
      return {
        pid: "4243",
        errno: "EWOULDBLOCK",
        lockLocator: structuredClone(expected.globalLockLocator),
        rootIdentity: identity({
          device: "2049",
          inode: "10",
          uid: expected.ownerUid,
          gid: expected.ownerGid,
          links: "3",
          mountId: "100",
        }),
        lockObject: identity({
          kind: "regular",
          device: "2049",
          inode: "9",
          uid: expected.ownerUid,
          gid: expected.ownerGid,
          mode: "384",
          links: "1",
          mountId: "100",
        }),
      };
    },
    async prepareSession(input) {
      record("prepareSession");
      assertSessionInput(input, expected, cgroupPath, true);
    },
    async configureCgroup(input) {
      record("configureCgroup");
      assertSessionInput(input, expected, cgroupPath, true);
    },
    async observeController({ session: actual, phase }) {
      record(`observeController:${phase}`);
      assertSession(actual, session);
      return observationFacts(expected, phase, cgroupPath);
    },
    async runWorker({
      session: actual,
      expected: actualExpected,
      cgroupPath: actualPath,
      signal,
      observeBefore,
      observeAfter,
    }) {
      record("runWorker");
      assertSession(actual, session);
      if (actualExpected.runId !== expected.runId || actualPath !== cgroupPath) {
        throw new Error("fake worker binding drifted");
      }
      if (hangAt === "runWorker") {
        return new Promise((_, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      }
      if (abortController !== undefined) {
        abortController.abort(new Error("synthetic worker cancellation"));
        throw abortController.signal.reason;
      }
      log.push("worker:before");
      await observeBefore(observationFacts(expected, "worker-before", cgroupPath));
      log.push("worker:after");
      await observeAfter(observationFacts(expected, "worker-after", cgroupPath));
      return { disposition: "completed", exitCode: 0, signal: null };
    },
    async quiesce({ session: actual, signal }) {
      record("quiesce");
      assertSession(actual, session);
      assertCleanupSignal(signal, abortController);
      return { cgroupPopulated: false, pidsCurrent: 0, processesRemaining: 0 };
    },
    async inventoryState({ session: actual }) {
      record("inventoryState");
      assertSession(actual, session);
      return [
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
      ];
    },
    async cleanupState({ session: actual, signal }) {
      record("cleanupState");
      assertSession(actual, session);
      assertCleanupSignal(signal, abortController);
    },
    async cleanupCgroup({ session: actual, signal }) {
      record("cleanupCgroup");
      assertSession(actual, session);
      assertCleanupSignal(signal, abortController);
    },
    async observePostCleanup({ session: actual, signal }) {
      record("observePostCleanup");
      assertSession(actual, session);
      assertCleanupSignal(signal, abortController);
      return {
        state: {
          result: "ABSENT",
          errno: "ENOENT",
          heldIdentity: unlinked(controllerAfter.held.state),
        },
        cgroup: {
          result: "ABSENT",
          errno: "ENOENT",
          heldIdentity: unlinked(controllerAfter.held.cgroup),
        },
      };
    },
    async releaseLease({ session: actual, signal }) {
      record("releaseLease");
      assertSession(actual, session);
      assertCleanupSignal(signal, abortController);
    },
    async cancelWorker({ session: actual, signal }) {
      record("cancelWorker");
      assertSession(actual, session);
      assertCleanupSignal(signal, abortController);
    },
    async closeSession({ session: actual, signal }) {
      record("closeSession");
      assertSession(actual, session);
      assertCleanupSignal(signal, abortController);
    },
  };
  return { mechanics, log, cgroupPath };
}

function assertSession(actual, expected) {
  if (actual !== expected) throw new Error("fake session identity drifted");
}

function assertCleanupSignal(signal, abortController) {
  if (abortController?.signal.aborted && signal !== undefined) {
    throw new Error("cleanup inherited an aborted execution signal");
  }
}

function assertSessionInput(input, expected, cgroupPath, prepared) {
  if (
    input.expected.runId !== expected.runId ||
    input.cgroupPath !== cgroupPath ||
    (prepared && input.session?.id !== "fake-containment-session")
  ) {
    throw new Error("fake containment input drifted");
  }
}
