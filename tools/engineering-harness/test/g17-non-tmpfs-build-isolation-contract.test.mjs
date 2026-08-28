import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import {
  G17_NON_TMPFS_BUILD_CLOSE_REAP_TIMEOUT_MS,
  G17_NON_TMPFS_BUILD_ISOLATION_AUTHORITY,
  G17_NON_TMPFS_BUILD_ISOLATION_ENVIRONMENT_CLASS,
  G17_NON_TMPFS_BUILD_ISOLATION_NONCLAIMS,
  G17_NON_TMPFS_BUILD_ISOLATION_POLICY_ARTIFACT_NAME,
  G17_NON_TMPFS_BUILD_ISOLATION_POLICY_MAX_BYTES,
  G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA,
  G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
  G17_NON_TMPFS_BUILD_TERM_GRACE_MS,
  createG17NonTmpfsBuildIsolationPolicyArtifact,
  verifyG17NonTmpfsBuildIsolationPolicyArtifact,
} from "../src/qualification/non-tmpfs-build-isolation-contract.mjs";
import { G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS } from "../src/qualification/non-tmpfs-containment-contract.mjs";
import {
  G17_NATIVE_ISOLATION_POLICY_SCHEMA,
  createG17NativeIsolationPolicyArtifact,
} from "../src/qualification/native-platform-contract.mjs";

const CONTRACT_ERROR = /G1\.7 non-tmpfs build isolation contract/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function decode(bytes) {
  return JSON.parse(bytes.toString("utf8"));
}

function reseal(policy) {
  const { sha256: _oldSha256, ...unsigned } = policy;
  policy.sha256 = canonicalSha256(unsigned);
  return Buffer.from(`${canonicalJson(policy)}\n`, "utf8");
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("non-tmpfs build isolation policy freezes the exact dormant owner boundary", () => {
  const created = createG17NonTmpfsBuildIsolationPolicyArtifact();
  const { policy, artifact } = created;

  assert.equal(
    G17_NON_TMPFS_BUILD_ISOLATION_POLICY_SCHEMA,
    "oxigraph.g1.7-non-tmpfs-build-isolation-policy/v1",
  );
  assert.equal(
    G17_NON_TMPFS_BUILD_ISOLATION_ENVIRONMENT_CLASS,
    G17_NON_TMPFS_CONTAINMENT_ENVIRONMENT_CLASS,
  );
  assert.equal(
    artifact.name,
    G17_NON_TMPFS_BUILD_ISOLATION_POLICY_ARTIFACT_NAME,
  );
  assert.equal(artifact.sha256, sha256(artifact.bytes));
  assert.deepEqual(
    verifyG17NonTmpfsBuildIsolationPolicyArtifact(artifact.bytes),
    policy,
  );
  assert.equal(Object.isFrozen(created), true);
  assert.equal(Object.isFrozen(artifact), true);
  assertDeepFrozen(policy);

  assert.deepEqual(policy.environment, {
    class: "linux-x86_64-cgroup-v2-non-tmpfs-serialized",
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
  });
  assert.equal(policy.workspace.source.heldDescriptorRequired, true);
  assert.equal(policy.workspace.source.readOnlyRequired, true);
  assert.equal(policy.workspace.source.nonTmpfsRequired, true);
  assert.equal(policy.workspace.target.heldDescriptorRequired, true);
  assert.equal(policy.workspace.target.emptyAtBuildStartRequired, true);
  assert.equal(policy.workspace.target.nonTmpfsRequired, true);

  assert.deepEqual(
    policy.process.stdio.inheritedFileDescriptors,
    [
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
    ],
  );
  assert.equal(
    policy.process.stdio.combinedMaximumBytes,
    G17_NON_TMPFS_BUILD_RAW_STREAM_MAX_BYTES,
  );
  assert.equal(policy.process.stdio.stdout.representation, "raw-bytes");
  assert.equal(policy.process.stdio.stderr.representation, "raw-bytes");
  assert.deepEqual(policy.process.termination, {
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
  });
  assert.equal(policy.process.closeAndReap.directChildCloseRequired, true);
  assert.equal(policy.process.closeAndReap.directChildReapRequired, true);
  assert.equal(
    policy.process.closeAndReap.callerSuppliedReapProofAccepted,
    false,
  );
  assert.deepEqual(policy.containment.quiescenceObservations, {
    cgroupEventsPopulated: "0",
    pidsCurrent: "0",
    cgroupProcs: "empty",
    processesRemaining: 0,
  });
  assert.equal(policy.finalDecisionEligible, false);
  assert.equal(policy.binding, null);
  assert.deepEqual(policy.authority, G17_NON_TMPFS_BUILD_ISOLATION_AUTHORITY);
  assert.deepEqual(policy.nonclaims, G17_NON_TMPFS_BUILD_ISOLATION_NONCLAIMS);
  assert.equal(Object.values(policy.authority).every((value) => value === false), true);
  assert.equal(Object.values(policy.nonclaims).every((value) => value === false), true);

  const first = artifact.bytes;
  first.fill(0);
  assert.notDeepEqual(first, artifact.bytes, "artifact bytes must be defensive copies");
});

test("non-tmpfs policy stays distinct from the historical native tmpfs v4 policy", () => {
  const nonTmpfs = createG17NonTmpfsBuildIsolationPolicyArtifact().policy;
  const native = createG17NativeIsolationPolicyArtifact().policy;

  assert.equal(
    G17_NATIVE_ISOLATION_POLICY_SCHEMA,
    "oxigraph.g1.7-linux-native-isolation-policy/v4",
  );
  assert.equal(native.mountPolicy.stateSingleQuotaTmpfs, true);
  assert.equal(nonTmpfs.environment.tmpfsState, false);
  assert.notEqual(native.schema, nonTmpfs.schema);
});

test("canonical verifier rejects every drifted isolation, ownership, and reap invariant", () => {
  const mutations = [
    ["schema", (value) => { value.schema = `${value.schema}-drift`; }],
    ["environment class", (value) => { value.environment.class = "other"; }],
    ["serialization", (value) => {
      value.environment.serialization.maximumConcurrentBuilds = 2;
    }],
    ["tmpfs", (value) => { value.environment.tmpfsState = true; }],
    ["source access", (value) => {
      value.workspace.source.readOnlyRequired = false;
    }],
    ["source identity", (value) => {
      value.workspace.source.sameObjectBeforeAndAfterRequired = false;
    }],
    ["target emptiness", (value) => {
      value.workspace.target.emptyAtBuildStartRequired = false;
    }],
    ["target ancestry", (value) => {
      value.workspace.target.heldWorkspaceParentRequired = false;
    }],
    ["fd value", (value) => {
      value.process.stdio.inheritedFileDescriptors[1].childFd = 6;
    }],
    ["fd order", (value) => {
      value.process.stdio.inheritedFileDescriptors.reverse();
    }],
    ["extra fd", (value) => {
      value.process.stdio.inheritedFileDescriptors.push({
        childFd: 6,
        parentRole: "extra",
        logicalPath: "/proc/self/fd/6",
        access: "held-directory-reference",
      });
    }],
    ["text output", (value) => {
      value.process.stdio.stdout.representation = "utf8-text";
    }],
    ["output ceiling", (value) => {
      value.process.stdio.combinedMaximumBytes -= 1;
    }],
    ["truncation", (value) => {
      value.process.stdio.truncationMayNotSatisfySuccess = false;
    }],
    ["TERM", (value) => {
      value.process.termination.firstSignal = "SIGKILL";
    }],
    ["grace", (value) => {
      value.process.termination.graceMilliseconds += 1;
    }],
    ["KILL", (value) => {
      value.process.termination.finalSignal = "SIGTERM";
    }],
    ["descendant cgroup kill", (value) => {
      value.process.termination.descendantEscalation.mechanism =
        "process-group-kill";
    }],
    ["recursive descendant kill", (value) => {
      value.process.termination.descendantEscalation
        .recursiveAcrossChangedProcessGroupsAndSessions = false;
    }],
    ["close", (value) => {
      value.process.closeAndReap.directChildCloseRequired = false;
    }],
    ["reap", (value) => {
      value.process.closeAndReap.directChildReapRequired = false;
    }],
    ["caller proof", (value) => {
      value.process.closeAndReap.callerSuppliedReapProofAccepted = true;
    }],
    ["cgroup mechanism", (value) => {
      value.containment.mechanism = "process-group-only";
    }],
    ["cgroup populated", (value) => {
      value.containment.quiescenceObservations.cgroupEventsPopulated = "1";
    }],
    ["cgroup pids", (value) => {
      value.containment.quiescenceObservations.pidsCurrent = "1";
    }],
    ["cgroup procs", (value) => {
      value.containment.quiescenceObservations.cgroupProcs = "nonempty";
    }],
    ["remaining processes", (value) => {
      value.containment.quiescenceObservations.processesRemaining = 1;
    }],
    ["authority", (value) => {
      value.authority.buildExecutionAuthority = true;
    }],
    ["nonclaim", (value) => {
      value.nonclaims.directChildPidfdWaitidAttested = true;
    }],
    ["decision", (value) => { value.finalDecisionEligible = true; }],
    ["binding", (value) => { value.binding = {}; }],
    ["extra field", (value) => { value.unreviewed = true; }],
  ];

  for (const [label, mutate] of mutations) {
    const value = structuredClone(
      createG17NonTmpfsBuildIsolationPolicyArtifact().policy,
    );
    mutate(value);
    assert.throws(
      () => verifyG17NonTmpfsBuildIsolationPolicyArtifact(reseal(value)),
      CONTRACT_ERROR,
      label,
    );
  }
});

test("canonical verifier rejects malformed, non-canonical, and oversized inputs", () => {
  const { policy, artifact } =
    createG17NonTmpfsBuildIsolationPolicyArtifact();
  const canonicalBytes = artifact.bytes;

  for (const [label, bytes] of [
    ["non-buffer", new Uint8Array(canonicalBytes)],
    ["empty", Buffer.alloc(0)],
    ["invalid JSON", Buffer.from("{\n", "utf8")],
    ["missing LF", canonicalBytes.subarray(0, canonicalBytes.length - 1)],
    ["extra LF", Buffer.concat([canonicalBytes, Buffer.from("\n")])],
    ["pretty JSON", Buffer.from(`${JSON.stringify(policy, null, 2)}\n`, "utf8")],
    ["unordered JSON", Buffer.from(`${JSON.stringify(policy)}\n`, "utf8")],
    [
      "oversized",
      Buffer.alloc(G17_NON_TMPFS_BUILD_ISOLATION_POLICY_MAX_BYTES + 1, 0x20),
    ],
  ]) {
    assert.throws(
      () => verifyG17NonTmpfsBuildIsolationPolicyArtifact(bytes),
      CONTRACT_ERROR,
      label,
    );
  }
});
