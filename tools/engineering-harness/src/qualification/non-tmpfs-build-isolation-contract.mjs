import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import { G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS } from "./non-tmpfs-containment-contract.mjs";

// Pure policy replay for the dormant physical G1.7 build owner. This module
// performs no I/O, launches no process, and does not prove that the policy was
// applied. Native platform isolation v4 remains the separate historical tmpfs
// policy; this contract freezes the non-tmpfs build environment instead.

export const G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA =
  "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v1";
export const G17_NON_TMPFS_BUILD_ISOLATION_POLICY_ARTIFACT_NAME =
  "non-tmpfs-build-isolation-policy.json";
export const G17_NON_TMPFS_BUILD_ISOLATION_ENVIRONMENT_CLASS =
  G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS;
export const G17_NON_TMPFS_BUILD_ISOLATION_POLICY_MAX_BYTES = 1024 * 1024;
export const G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES = 64 * 1024 * 1024;
export const G17_NON_TMPFS_BUILD_TERM_GRACE_MS = 250;
export const G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS = 2_000;

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

export const G17_NON_TMPFS_BUILD_ISOLATION_AUTHORITY = deepFreeze({
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

export const G17_NON_TMPFS_BUILD_ISOLATION_NONCLAIMS = deepFreeze({
  policyApplicationObserved: false,
  productionBuildOwnerImplemented: false,
  nativeContainmentAdapterImplemented: false,
  directChildPidfdWaitidAttested: false,
  cgroupQuiescenceProvesDirectChildReap: false,
  hostileSameUidResistance: false,
  maliciousHostOrKernelResistance: false,
  crashDurability: false,
  powerLossDurability: false,
  filesystemFlushDurability: false,
  sealedExpectedBindings: false,
});

const FD_MAP = deepFreeze([
  {
    childFd: 3,
    parentRole: "workspaceRoot",
    logicalPath: "/proc/self/fd/3",
    access: "held-directory-reference",
  },
  {
    childFd: 4,
    parentRole: "source",
    logicalPath: "/proc/self/fd/4",
    access: "held-read-only-directory",
  },
  {
    childFd: 5,
    parentRole: "target",
    logicalPath: "/proc/self/fd/5",
    access: "held-read-write-directory",
  },
]);

const POLICY_BASE = deepFreeze({
  schema: G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA,
  environment: {
    class: G17_NON_TMPFS_BUILD_ISOLATION_ENVIRONMENT_CLASS,
    operatingSystem: "linux",
    architecture: "x86_64",
    cgroupVersion: 2,
    stateStorage: "held-non-tmpfs-filesystem",
    tmpfsState: false,
    ramfsState: false,
    serialization: {
      mode: "global-exclusive-build-lease",
      maximumConcurrentBuilds: 1,
      leaseHeldUntilTerminalReapOrRetention: true,
    },
  },
  workspace: {
    identityObservation:
      "openat2-held-fd-fstat-fstatfs-statx-mnt-id/v1",
    ancestryResolution: "openat2-resolve-beneath-no-symlinks/v1",
    descriptorsHeldUntilTerminalReapOrRetention: true,
    namespace: {
      mechanism: "bind-mount-from-held-descriptor/v1",
      heldParent: {
        childFd: 3,
        role: "workspaceRoot",
        logicalPath: "/proc/self/fd/3",
      },
      mounts: [
        {
          role: "source",
          heldFd: 4,
          heldLogicalPath: "/proc/self/fd/4",
          parentFd: 3,
          parentLeafName: "source",
          beneathHeldParentRequired: true,
          sameObjectAsHeldDescriptorRequired: true,
          destination: "/workspace/source",
          mountOptions: ["bind", "nodev", "noexec", "nosuid", "ro"],
          readOnly: true,
        },
        {
          role: "target",
          heldFd: 5,
          heldLogicalPath: "/proc/self/fd/5",
          parentFd: 3,
          parentLeafName: "target",
          beneathHeldParentRequired: true,
          sameObjectAsHeldDescriptorRequired: true,
          destination: "/state/target",
          mountOptions: ["bind", "nodev", "nosuid", "rw"],
          readOnly: false,
        },
      ],
      exactMountOrderRequired: true,
      alternateSourceOrTargetMappingsForbidden: true,
    },
    source: {
      role: "source",
      heldDescriptorRequired: true,
      readOnlyRequired: true,
      mutationForbidden: true,
      nonTmpfsRequired: true,
      sameObjectBeforeAndAfterRequired: true,
    },
    target: {
      role: "target",
      heldDescriptorRequired: true,
      readWriteRequired: true,
      emptyAtBuildStartRequired: true,
      nonTmpfsRequired: true,
      heldWorkspaceParentRequired: true,
      sameDeviceFilesystemOwnerRequired: true,
      sameObjectBeforeAndAfterRequired: true,
    },
  },
  process: {
    shellForbidden: true,
    detachedProcessGroupRequired: true,
    stdio: {
      stdin: "null-device",
      inheritedFileDescriptors: FD_MAP,
      extraInheritedFileDescriptorsForbidden: true,
      stdout: {
        representation: "raw-bytes",
        maximumBytes: G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
        decodeBeforeDigestForbidden: true,
      },
      stderr: {
        representation: "raw-bytes",
        maximumBytes: G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
        decodeBeforeDigestForbidden: true,
      },
      combinedMaximumBytes: G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
      overflowDisposition: "terminate-fail-no-success-artifact",
      truncationMayNotSatisfySuccess: true,
    },
    termination: {
      target: "detached-process-group",
      firstSignal: "SIGTERM",
      graceMilliseconds: G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
      finalSignal: "SIGKILL",
      descendantEscalation: {
        target: "per-build-cgroup-v2-subtree",
        mechanism: "cgroup.kill",
        signal: "SIGKILL",
        requiredAfterTermGrace: true,
        recursiveAcrossChangedProcessGroupsAndSessions: true,
      },
      closeReapTimeoutMilliseconds:
        G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
      terminationErrorsFailClosed: true,
    },
    closeAndReap: {
      exitOrErrorBeforeCloseRequired: true,
      stdoutEofBeforeCloseRequired: true,
      stderrEofBeforeCloseRequired: true,
      exitAndCloseStatusAgreementRequired: true,
      directChildCloseRequired: true,
      directChildReapRequired: true,
      callerSuppliedReapProofAccepted: false,
      successExitCode: 0,
      successSignal: null,
      unreapedDisposition: "inconclusive-retain-handles-no-cleanup",
    },
  },
  containment: {
    mechanism: "linux-cgroup-v2-per-build-subtree",
    recursiveDescendantScopeRequired: true,
    quiescenceAfterDirectChildCloseRequired: true,
    quiescenceObservations: {
      cgroupEventsPopulated: "0",
      pidsCurrent: "0",
      cgroupProcs: "empty",
      processesRemaining: 0,
    },
    cleanupBeforeQuiescenceForbidden: true,
    cgroupQuiescenceIsNotDirectChildReapProof: true,
  },
  finalDecisionEligible: false,
  binding: null,
  nonclaims: G17_NON_TMPFS_BUILD_ISOLATION_NONCLAIMS,
  authority: G17_NON_TMPFS_BUILD_ISOLATION_AUTHORITY,
});

function fail(message) {
  throw new Error(`G1.7 non-tmpfs build isolation contract: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectedPolicy() {
  return deepFreeze({
    ...POLICY_BASE,
    sha256: canonicalSha256(POLICY_BASE),
  });
}

function canonicalArtifact(value) {
  const stored = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (
    stored.length < 2 ||
    stored.length > G17_NON_TMPFS_BUILD_ISOLATION_POLICY_MAX_BYTES
  ) {
    fail("policy artifact exceeds its byte ceiling");
  }
  return Object.freeze({
    name: G17_NON_TMPFS_BUILD_ISOLATION_POLICY_ARTIFACT_NAME,
    get bytes() {
      return Buffer.from(stored);
    },
    sha256: sha256(stored),
  });
}

function parseCanonical(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 2 ||
    bytes.length > G17_NON_TMPFS_BUILD_ISOLATION_POLICY_MAX_BYTES
  ) {
    fail("policy artifact is not a bounded Buffer");
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    fail(`policy artifact is invalid JSON: ${error.message}`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail("policy artifact is not canonical JSON plus one LF");
  }
  return value;
}

export function createG17NonTmpfsBuildIsolationPolicyArtifact() {
  const policy = expectedPolicy();
  return Object.freeze({
    policy,
    artifact: canonicalArtifact(policy),
  });
}

export function verifyG17NonTmpfsBuildIsolationPolicyArtifact(bytes) {
  try {
    const policy = parseCanonical(bytes);
    if (!isDeepStrictEqual(policy, expectedPolicy())) {
      fail("policy differs from the frozen non-tmpfs build policy");
    }
    return deepFreeze(policy);
  } catch (error) {
    if (
      error?.message?.startsWith(
        "G1.7 non-tmpfs build isolation contract:",
      )
    ) {
      throw error;
    }
    fail(error?.message ?? String(error));
  }
}
