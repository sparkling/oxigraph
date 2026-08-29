import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2,
  createCandidateContainmentLaunchArgvV2,
  createCandidateContainmentLaunchCapsuleV2,
  createCandidateContainmentLaunchEnvironmentV2,
  verifyCandidateContainmentLaunchCapsuleV2,
} from "../src/candidate/containment-launch-capsule-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SCHEMA_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3,
  createCandidateContainmentLaunchCapsuleV3,
  verifyCandidateContainmentLaunchCapsuleV3,
} from "../src/candidate/containment-launch-capsule-v3.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { sandboxSessionV2ContainmentReadiness } from "../src/candidate/sandbox-session-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";

const CONTRACT_ERROR = /candidate containment launch capsule v3/u;
const requestSha256 = "4".repeat(64);
const generationSha256 = "5".repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function input() {
  const argv = createCandidateContainmentLaunchArgvV2({
    argv: ["/usr/bin/bwrap", "--clearenv", "--", "/usr/bin/node"],
  });
  const environment = createCandidateContainmentLaunchEnvironmentV2({
    environment: { LANG: "C.UTF-8", PATH: "/usr/bin:/bin" },
  });
  const files = CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2.map(
    (spec, index) => {
      const bytes =
        spec.role === "childExecutable"
          ? Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])
          : spec.role === "launchArgv"
            ? argv.bytes
            : spec.role === "launchEnvironment"
              ? environment.bytes
              : spec.role === "childResult"
                ? Buffer.alloc(0)
                : Buffer.from(`${spec.role}\n`, "utf8");
      return {
        role: spec.role,
        supervisorFd: spec.supervisorFd,
        childFd: spec.childFd,
        destination: spec.destination,
        accessMode: spec.accessMode,
        permissions: spec.permissions,
        byteLength: bytes.length,
        sha256: sha256(bytes),
        initialOffset: 0,
        closeOnExec: true,
        contentBytes: bytes,
        identity: {
          device: "2049",
          inode: String(30_000 + index),
          links: "1",
          type: "regular",
          permissions: spec.permissions,
          owner: "1000",
          group: "1000",
          size: String(bytes.length),
          modifiedNs: String(1_700_000_003_000_000_000n + BigInt(index)),
          changedNs: String(1_700_000_004_000_000_000n + BigInt(index)),
        },
      };
    },
  );
  return {
    requestSha256,
    generationSha256,
    argvBytes: argv.bytes,
    environmentBytes: environment.bytes,
    files,
    resultMaximumBytes: 256 * 1024 * 1024,
  };
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("successor capsule preserves the retained manifest while binding the exec-outcome plan", () => {
  const legacy = createCandidateContainmentLaunchCapsuleV2(input());
  const successor = createCandidateContainmentLaunchCapsuleV3(input());
  const legacyProjection = verifyCandidateContainmentLaunchCapsuleV2(
    legacy.bytes,
  );
  const projection = verifyCandidateContainmentLaunchCapsuleV3(successor.bytes);

  assert.equal(
    legacyProjection.protocolSchema,
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2,
  );
  assert.equal(
    projection.protocolSchema,
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3,
  );
  assert.equal(projection.requestSha256, legacyProjection.requestSha256);
  assert.equal(projection.generationSha256, legacyProjection.generationSha256);
  assert.deepEqual(projection.argv, legacyProjection.argv);
  assert.deepEqual(projection.environment, legacyProjection.environment);
  assert.deepEqual(projection.files, legacyProjection.files);
  assert.equal(
    projection.resultMaximumBytes,
    legacyProjection.resultMaximumBytes,
  );
  assert.equal(
    projection.requirementsSha256,
    CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
  );
  assert.equal(
    projection.remapPlanSha256,
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3,
  );
  assert.notEqual(
    projection.remapPlanSha256,
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2,
  );
  assert.equal(projection.binding, null);
  assert.equal(projection.physicalEligibility, false);
  assert.equal(projection.runtimeClosureEligibility, false);
  assert.equal(
    projection.projectionSha256,
    canonicalSha256(
      Object.fromEntries(
        Object.entries(projection).filter(
          ([key]) => key !== "projectionSha256",
        ),
      ),
    ),
  );
  const copy = successor.bytes;
  copy.fill(0);
  assert.equal(successor.artifact.sha256, sha256(successor.bytes));
  assertDeepFrozen(projection);
});

test("successor remap allocates an exact CLOEXEC exec-outcome pipe before pidfd", () => {
  const plan = CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_V3;
  assert.deepEqual(plan.dynamicAllocationOrder, [
    "executableScratch:18",
    "childStdout:19,20",
    "childStderr:21,22",
    "execOutcome:23,24",
    "clone3ChildPidfdInParent:25",
  ]);
  assert.deepEqual(plan.parentDynamicDescriptorsAfterClone, [19, 21, 23, 25]);
  assert.deepEqual(plan.supervisorDynamicClosesAfterClone, [18, 20, 22, 24]);
  assert.equal(plan.execOutcomePipe.readFd, 23);
  assert.equal(plan.execOutcomePipe.writeFd, 24);
  assert.equal(plan.execOutcomePipe.operation, "pipe2-O_CLOEXEC");
  assert.equal(
    plan.execOutcomePipe.eofWithoutRecordClassification,
    "unknown-without-ptrace-exec",
  );
  assert.equal(plan.execOutcomePipe.failureRecord.bytes, 16);
  assert.equal(plan.execOutcomePipe.failureRecord.magicHex, "4f584558");
  assert.equal(plan.execOutcomePipe.failureRecord.reservedHex, "0000");
  assert.equal(
    plan.execOutcomePipe.failureRecord.errnoEncoding,
    "uint32-little-endian",
  );
  assert.equal(plan.execOutcomePipe.failureRecord.errnoMinimum, 1);
  assert.equal(plan.execOutcomePipe.failureRecord.errnoMaximum, 4095);
  assert.equal(plan.execOutcomePipe.failureRecord.trailerHex, "00000000");
  assert.deepEqual(
    { ...plan.execOutcomePipe.failureRecord.phases },
    {
      childTraceRequest: 5,
      childStopRequest: 6,
      childRemap: 7,
      childClose: 8,
      execveat: 9,
    },
  );
  assert.equal(plan.parentPidfd.fd, 25);
  assert.deepEqual(
    { ...plan.parentExecOutcomeClosePaths },
    {
      execProved: "after-ptrace-event-image-match-and-zero-byte-eof",
      execFailed: "after-one-exact-record-and-eof",
      ambiguous: "after-whole-cgroup-cancel-direct-child-reap-and-read-to-eof",
    },
  );
  assert.equal(plan.childExecOutcomeWriteCloseOnExec, true);
  assert.equal(plan.precloneFailureChannel, "supervisor-status");
  assert.deepEqual(
    plan.childDescriptorsImmediatelyBeforeExec,
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 24],
  );
  assert.deepEqual(
    plan.childDescriptorsAfterExec,
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
  assert.equal(plan.execOutcomeEofAloneProvesExecTransition, false);
  assert.equal(plan.execTransitionProof.positiveEvent, "PTRACE_EVENT_EXEC");
  assert.equal(
    plan.execTransitionProof.childStopBeforeRemap,
    "kill-getpid-SIGSTOP",
  );
  assert.equal(
    plan.execTransitionProof.childSetupFailureChannel,
    "exact-exec-outcome-record",
  );
  assert.deepEqual(plan.execTransitionProof.parentOptions, [
    "PTRACE_O_TRACEEXEC",
    "PTRACE_O_EXITKILL",
  ]);
  assert.equal(plan.execTransitionProof.childHeldStoppedUntilVerified, true);
  assert.deepEqual(plan.execTransitionProof.parentTraceFailurePoints, [
    "initial-stop-wait",
    "set-options",
    "resume",
    "exec-event-wait",
    "image-identity-readback",
    "outcome-pipe-read",
    "detach",
  ]);
  assert.equal(
    plan.execTransitionProof.parentTraceFailureAction,
    "cancel-whole-cgroup-reap-direct-child-and-report-launch-failed",
  );
  assert.equal(plan.cloneFilesShared, false);
  assert.deepEqual(plan.cloneFlagsExcluded, [
    "CLONE_FILES",
    "CLONE_VM",
    "CLONE_VFORK",
  ]);
  assert.deepEqual(
    plan.precloneRollback.at(-1).closeDescriptors,
    [18, 19, 20, 21, 22, 23, 24],
  );
  assert.deepEqual(
    plan.clone3FailureRollback.closeDescriptors,
    [18, 19, 20, 21, 22, 23, 24],
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3.mechanicsImplemented,
    false,
  );
});

test("successor replay rejects schema, requirements, remap, manifest, and canonical-byte tampering", () => {
  const created = createCandidateContainmentLaunchCapsuleV3(input());
  const parsed = JSON.parse(created.bytes);
  const mutations = [
    (value) => {
      value.schema = CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2;
    },
    (value) => {
      value.requirementsSha256 = "f".repeat(64);
    },
    (value) => {
      value.remapPlanSha256 = CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2;
    },
    (value) => {
      value.files[0].identity.inode = value.files[1].identity.inode;
    },
    (value) => {
      value.argv.argv[0] = "/tmp/substituted";
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(parsed);
    mutate(value);
    assert.throws(
      () =>
        verifyCandidateContainmentLaunchCapsuleV3(
          Buffer.from(`${canonicalJson(value)}\n`, "utf8"),
        ),
      /candidate containment launch capsule/u,
    );
  }
  for (const bytes of [
    Buffer.alloc(0),
    created.bytes.subarray(0, created.bytes.length - 1),
    Buffer.concat([created.bytes, created.bytes]),
    Buffer.from(created.bytes.toString("utf8").replace("\n", "\r\n")),
  ]) {
    assert.throws(
      () => verifyCandidateContainmentLaunchCapsuleV3(bytes),
      CONTRACT_ERROR,
    );
  }
});

test("successor authority remains false and serialized exec evidence remains a nonclaim", () => {
  assert.equal(
    Object.values(CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_AUTHORITY_V3).every(
      (value) => value === false,
    ),
    true,
  );
  assert.equal(
    Object.values(CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V3).every(
      (value) => value === false,
    ),
    true,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V3.manifestProvesExecOutcomePipe,
    false,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V3.manifestProvesExecTransition,
    false,
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_NONCLAIMS_V3.manifestProvesChildStillLiveAtExecEof,
    false,
  );
});

test("additive successor leaves frozen protocols, production readiness, and registries unchanged", () => {
  assert.equal(
    CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SCHEMA_V2,
    "oxigraph.candidate-containment-supervisor-fd-map/v2",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SCHEMA_V3,
    "oxigraph.candidate-containment-supervisor-fd-map/v3",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2,
    "oxigraph.candidate-containment-launch-capsule/v1",
  );
  assert.deepEqual(candidateContainmentOwnerV2Readiness(), {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.strictEqual(
    sandboxSessionV2ContainmentReadiness(),
    candidateContainmentOwnerV2Readiness(),
  );
  assert.equal(engineeringTaskIds.length, 9);
  assert.equal(commandIds().length, 33);
  assert.equal(
    commandIds().some((id) => id.includes("g2.2")),
    false,
  );
});
