import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2,
  createCandidateContainmentLaunchArgvV2,
  createCandidateContainmentLaunchEnvironmentV2,
} from "../src/candidate/containment-launch-capsule-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3,
  createCandidateContainmentLaunchCapsuleV3,
} from "../src/candidate/containment-launch-capsule-v3.mjs";
import * as bootstrap from "../src/candidate/containment-supervisor-bootstrap-v3.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { sandboxSessionV2ContainmentReadiness } from "../src/candidate/sandbox-session-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";

const CONTRACT_ERROR = /candidate containment supervisor bootstrap v3/u;
const requestSha256 = "6".repeat(64);
const generationSha256 = "7".repeat(64);
const guardianEpochSha256 = "8".repeat(64);
const guardianNonceSha256 = "9".repeat(64);
const limits = Object.freeze({
  memoryMaxBytes: 8_589_934_592,
  memorySwapMaxBytes: 0,
  tasksMax: 512,
  wallMs: 2_700_000,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function launchCapsule(variant = "a") {
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
                : Buffer.from(`${spec.role}:${variant}\n`, "utf8");
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
          inode: String(40_000 + index),
          links: "1",
          type: "regular",
          permissions: spec.permissions,
          owner: "1000",
          group: "1000",
          size: String(bytes.length),
          modifiedNs: String(1_700_000_005_000_000_000n + BigInt(index)),
          changedNs: String(1_700_000_006_000_000_000n + BigInt(index)),
        },
      };
    },
  );
  return createCandidateContainmentLaunchCapsuleV3({
    requestSha256,
    generationSha256,
    argvBytes: argv.bytes,
    environmentBytes: environment.bytes,
    files,
    resultMaximumBytes: 256 * 1024 * 1024,
  });
}

function statusFrame(context, state, previousStatusRawSha256 = null) {
  const common = {
    schema:
      bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_SCHEMA_V3,
    statusSequence:
      state === "READY" ? 0 : state === "CANCELLED_BEFORE_CLONE" ? 1 : 2,
    state,
    startRawSha256: context.start.rawSha256,
    capsuleFrameRawSha256: context.capsuleFrame.rawSha256,
    decisionRawSha256: state === "READY" ? null : sha256(context.cancelBytes),
    ownerRequestSha256: context.start.ownerRequestSha256,
    generationSha256: context.start.generationSha256,
    guardianEpochSha256: context.start.guardianEpochSha256,
    guardianNonceSha256: context.start.guardianNonceSha256,
    bootstrapRequirementsSha256:
      bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SHA256_V3,
  };
  if (state === "READY") {
    return jsonLine({
      ...common,
      evidence: {
        requestValidated: true,
        capsuleFrameValidated: true,
        launchCapsuleValidated: true,
        reportedRetainedFileDescriptorInventorySha256:
          bootstrap.candidateContainmentSupervisorBootstrapExpectedRetainedFileDescriptorInventorySha256V3(
            context.launchCapsuleBytes,
          ),
        reportedRetainedFileDescriptorsExact: true,
        supervisorStatusFdOnlyMatchingWriterInOwnDescriptorTable: true,
        sessionCgroupFd: 3,
        sessionCgroupRole: "sessionCgroup",
        filesystem: "cgroup2",
        type: "domain\n",
        initialProcs: "",
        memoryMax: `${limits.memoryMaxBytes}\n`,
        memorySwapMax: "0\n",
        pidsMax: `${limits.tasksMax}\n`,
      },
    });
  }
  if (state === "CANCELLED_BEFORE_CLONE") {
    return jsonLine({
      ...common,
      previousStatusRawSha256,
      evidence: {
        cloneCommitStarted: false,
        childCreated: false,
        sessionCgroupFdClosed: true,
        pidfdCreated: false,
        cleanupOwner: "guardian",
        guardianCleanupRequired: true,
        guardianCleanupObservedBySupervisor: null,
      },
    });
  }
  return jsonLine({
    ...common,
    previousStatusRawSha256,
    evidence: {
      childCreated: false,
      sessionCgroupFdClosed: true,
      statusFrameIsFinal: true,
      statusWriteClosureObservedBySupervisor: null,
      guardianCleanupObservedBySupervisor: null,
    },
  });
}

function bootstrapArtifacts() {
  const capsuleArtifact = launchCapsule();
  const launchCapsuleBytes = capsuleArtifact.bytes;
  const startArtifact =
    bootstrap.createCandidateContainmentSupervisorBootstrapStartV3({
      requestSha256,
      generationSha256,
      guardianEpochSha256,
      guardianNonceSha256,
      launchCapsuleBytes,
      limits: { ...limits },
    });
  const startBytes = startArtifact.bytes;
  const start =
    bootstrap.verifyCandidateContainmentSupervisorBootstrapStartV3(startBytes);
  const capsuleFrameArtifact =
    bootstrap.createCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
      startBytes,
      launchCapsuleBytes,
    });
  const capsuleFrameBytes = capsuleFrameArtifact.bytes;
  const capsuleFrame =
    bootstrap.verifyCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
      startBytes,
      capsuleFrameBytes,
    });
  const context = {
    start,
    capsuleFrame,
    launchCapsuleBytes,
    cancelBytes: null,
  };
  const readyBytes = statusFrame(context, "READY");
  const cancelArtifact =
    bootstrap.createCandidateContainmentSupervisorBootstrapCancelV3({
      startBytes,
      capsuleFrameBytes,
      readyBytes,
      reason: "caller-abort",
    });
  const cancelBytes = cancelArtifact.bytes;
  context.cancelBytes = cancelBytes;
  const cancelledBytes = statusFrame(
    context,
    "CANCELLED_BEFORE_CLONE",
    sha256(readyBytes),
  );
  const doneBytes = statusFrame(
    context,
    "SUPERVISOR_DONE",
    sha256(cancelledBytes),
  );
  return {
    capsuleArtifact,
    launchCapsuleBytes,
    startArtifact,
    startBytes,
    start,
    capsuleFrameArtifact,
    capsuleFrameBytes,
    capsuleFrame,
    readyBytes,
    cancelArtifact,
    cancelBytes,
    cancelledBytes,
    doneBytes,
  };
}

function event(direction, bytes) {
  return { direction, bytes };
}

function events(artifacts) {
  return [
    event("guardian-to-supervisor", artifacts.startBytes),
    event("guardian-to-supervisor", artifacts.capsuleFrameBytes),
    event("supervisor-to-guardian", artifacts.readyBytes),
    event("guardian-to-supervisor", artifacts.cancelBytes),
    event("supervisor-to-guardian", artifacts.cancelledBytes),
    event("supervisor-to-guardian", artifacts.doneBytes),
  ];
}

function observation(overrides = {}) {
  return {
    commandEofObserved: true,
    statusEofObserved: true,
    statusEofCount: 1,
    eofAfterFinalStatus: true,
    commandWriteError: null,
    statusReadError: null,
    diagnosticsBytes: 0,
    diagnosticsSha256: sha256(Buffer.alloc(0)),
    supervisorExitCode: 124,
    supervisorSignal: null,
    supervisorReaped: true,
    ...overrides,
  };
}

function replay(
  artifacts,
  eventOverrides = events(artifacts),
  observed = observation(),
) {
  return bootstrap.verifyCandidateContainmentSupervisorBootstrapReplayV3({
    events: eventOverrides,
    observation: observed,
  });
}

function mutateFrame(bytes, mutate) {
  const value = JSON.parse(bytes);
  mutate(value);
  return jsonLine(value);
}

function replaceEventBytes(allEvents, index, bytes) {
  return allEvents.map((item, itemIndex) =>
    itemIndex === index ? event(item.direction, bytes) : item,
  );
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

test("START and CAPSULE are canonical in-band frames bound to one generation and requirements digest", () => {
  const artifacts = bootstrapArtifacts();
  assert.equal(
    artifacts.start.protocolSchema,
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_SCHEMA_V3,
  );
  assert.equal(artifacts.start.action, "START");
  assert.equal(artifacts.start.commandSequence, 0);
  assert.equal(artifacts.start.requestSha256, requestSha256);
  assert.equal(artifacts.start.generationSha256, generationSha256);
  assert.equal(artifacts.start.guardianEpochSha256, guardianEpochSha256);
  assert.equal(artifacts.start.guardianNonceSha256, guardianNonceSha256);
  assert.equal(
    artifacts.start.bootstrapRequirementsSha256,
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SHA256_V3,
  );
  assert.equal(
    artifacts.capsuleFrame.protocolSchema,
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_SCHEMA_V3,
  );
  assert.equal(artifacts.capsuleFrame.commandSequence, 1);
  assert.equal(artifacts.capsuleFrame.action, "CAPSULE");
  assert.equal(
    artifacts.capsuleFrame.launchCapsule.protocolSchema,
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3,
  );
  assert.equal(
    artifacts.capsuleFrame.launchCapsule.rawSha256,
    artifacts.start.launchCapsuleRawSha256,
  );
  const capsuleBody = JSON.parse(artifacts.capsuleFrameBytes);
  assert.deepEqual(
    Buffer.from(capsuleBody.launchCapsuleBase64, "base64"),
    artifacts.launchCapsuleBytes,
  );

  const retained = artifacts.launchCapsuleBytes;
  const frame =
    bootstrap.createCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
      startBytes: artifacts.startBytes,
      launchCapsuleBytes: retained,
    });
  retained.fill(0);
  assert.doesNotThrow(() =>
    bootstrap.verifyCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
      startBytes: artifacts.startBytes,
      capsuleFrameBytes: frame.bytes,
    }),
  );
  assertDeepFrozen(artifacts.start);
  assertDeepFrozen(artifacts.capsuleFrame);
});

test("cancel-only replay validates exact ordering while keeping physical facts honestly null", () => {
  const artifacts = bootstrapArtifacts();
  const projection = replay(artifacts);
  assert.equal(
    projection.schema,
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REPLAY_SCHEMA_V3,
  );
  assert.equal(projection.status, "PRECOMMIT_BOOTSTRAP_CANCEL_REPLAYED");
  assert.deepEqual(projection.states, [
    "START",
    "CAPSULE",
    "READY",
    "CANCEL",
    "CANCELLED_BEFORE_CLONE",
    "SUPERVISOR_DONE",
  ]);
  assert.equal(projection.capsuleReplayValidated, true);
  assert.equal(projection.reportedSupervisorCapsuleValidated, true);
  assert.equal(projection.supervisorCapsuleValidated, null);
  assert.equal(projection.reportedRetainedFileDescriptorsExact, true);
  assert.equal(projection.retainedFileDescriptorsExact, null);
  assert.equal(
    projection.reportedSupervisorStatusFdOnlyMatchingWriterInOwnDescriptorTable,
    true,
  );
  assert.equal(
    projection.supervisorStatusFdOnlyMatchingWriterInOwnDescriptorTable,
    null,
  );
  assert.equal(projection.guardianLauncherStatusWriterCopiesClosed, null);
  assert.equal(projection.soleStatusWriter, null);
  assert.equal(projection.reportedChildCreated, false);
  assert.equal(projection.childCreated, null);
  assert.equal(projection.reportedSupervisorDone, true);
  assert.equal(projection.supervisorDone, null);
  assert.equal(projection.guardianCleanupRequired, true);
  assert.equal(projection.guardianCleanupObserved, null);
  assert.equal(projection.cleanupSafe, null);
  assert.equal(projection.binding, null);
  assert.equal(projection.physicalEligibility, false);
  assert.equal(projection.finalDecisionEligible, false);
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
  assertDeepFrozen(projection);
});

test("capsule transfer rejects substitution, noncanonical base64, mutable sharing, and START mismatch", () => {
  const artifacts = bootstrapArtifacts();
  const substituted = launchCapsule("substituted");
  assert.throws(
    () =>
      bootstrap.createCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
        startBytes: artifacts.startBytes,
        launchCapsuleBytes: substituted.bytes,
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      bootstrap.createCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
        startBytes: artifacts.startBytes,
        launchCapsuleBytes: new Proxy(artifacts.launchCapsuleBytes, {}),
      }),
    CONTRACT_ERROR,
  );

  for (const replacement of [
    "AAAA====",
    Buffer.from("{}\n").toString("base64"),
  ]) {
    const mutated = mutateFrame(artifacts.capsuleFrameBytes, (value) => {
      value.launchCapsuleBase64 = replacement;
    });
    assert.throws(() =>
      bootstrap.verifyCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
        startBytes: artifacts.startBytes,
        capsuleFrameBytes: mutated,
      }),
    );
  }

  const changedStart = mutateFrame(artifacts.startBytes, (value) => {
    value.launchCapsuleRawSha256 = "a".repeat(64);
  });
  assert.throws(
    () =>
      bootstrap.verifyCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
        startBytes: changedStart,
        capsuleFrameBytes: artifacts.capsuleFrameBytes,
      }),
    CONTRACT_ERROR,
  );
});

test("replay rejects reordered directions, sparse or exotic event arrays, and noncanonical framing", () => {
  const artifacts = bootstrapArtifacts();
  const ordered = events(artifacts);
  const wrongDirection = structuredClone(ordered);
  wrongDirection[1].direction = "supervisor-to-guardian";
  assert.throws(() => replay(artifacts, wrongDirection), CONTRACT_ERROR);

  const reordered = [...ordered];
  [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
  assert.throws(() => replay(artifacts, reordered), CONTRACT_ERROR);

  const sparse = [...ordered];
  delete sparse[3];
  assert.throws(() => replay(artifacts, sparse), CONTRACT_ERROR);
  assert.throws(
    () => replay(artifacts, new Proxy(ordered, {})),
    CONTRACT_ERROR,
  );
  const foreign = [...ordered];
  Object.setPrototypeOf(foreign, null);
  assert.throws(() => replay(artifacts, foreign), CONTRACT_ERROR);
  const accessor = [...ordered];
  Object.defineProperty(accessor, "2", {
    configurable: true,
    enumerable: true,
    get: () => ordered[2],
  });
  assert.throws(() => replay(artifacts, accessor), CONTRACT_ERROR);

  for (const bytes of [
    Buffer.alloc(0),
    artifacts.startBytes.subarray(0, artifacts.startBytes.length - 1),
    Buffer.concat([artifacts.startBytes, artifacts.startBytes]),
    Buffer.from(artifacts.startBytes.toString("utf8").replace("\n", "\r\n")),
  ]) {
    assert.throws(
      () => replay(artifacts, replaceEventBytes(ordered, 0, bytes)),
      CONTRACT_ERROR,
    );
  }
});

test("requirements and terminal evidence cannot be weakened or inflated by serialized claims", () => {
  const artifacts = bootstrapArtifacts();
  const ordered = events(artifacts);
  const badReady = mutateFrame(artifacts.readyBytes, (value) => {
    value.bootstrapRequirementsSha256 = "b".repeat(64);
  });
  assert.throws(
    () => replay(artifacts, replaceEventBytes(ordered, 2, badReady)),
    CONTRACT_ERROR,
  );

  const badCancelled = mutateFrame(artifacts.cancelledBytes, (value) => {
    value.evidence.guardianCleanupObservedBySupervisor = true;
  });
  assert.throws(
    () => replay(artifacts, replaceEventBytes(ordered, 4, badCancelled)),
    CONTRACT_ERROR,
  );

  const badDone = mutateFrame(artifacts.doneBytes, (value) => {
    value.evidence.statusWriteClosureObservedBySupervisor = true;
  });
  assert.throws(
    () => replay(artifacts, replaceEventBytes(ordered, 5, badDone)),
    CONTRACT_ERROR,
  );

  assert.throws(
    () => replay(artifacts, ordered, observation({ supervisorExitCode: 0 })),
    CONTRACT_ERROR,
  );
  assert.throws(
    () => replay(artifacts, ordered, observation({ diagnosticsBytes: -0 })),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      bootstrap.createCandidateContainmentSupervisorBootstrapCancelV3({
        startBytes: artifacts.startBytes,
        capsuleFrameBytes: artifacts.capsuleFrameBytes,
        readyBytes: artifacts.readyBytes,
        reason: "commit",
      }),
    CONTRACT_ERROR,
  );
});

test("bootstrap successor exposes no COMMIT path or authority and leaves production registries frozen", () => {
  assert.deepEqual(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .eventOrder,
    [
      "START",
      "CAPSULE",
      "READY",
      "CANCEL",
      "CANCELLED_BEFORE_CLONE",
      "SUPERVISOR_DONE",
    ],
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .commitAccepted,
    false,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .clonePermitted,
    false,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .readyRetainedFileDescriptorScope,
    "launch-capsule-file-descriptors-4-through-17-only",
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .readyMayClaimWholeDescriptorInventoryExact,
    false,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .futurePhysicalReadyRequiresGuardianBoundControlDescriptorIdentities,
    true,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .futurePhysicalReadyRequiresSupervisorControlDescriptorReobservation,
    true,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .futurePhysicalReadyRequiresExactOpenSetAndNonalias,
    true,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .supervisorStatusFdMustBeOnlyMatchingWriterInOwnDescriptorTable,
    true,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .futurePhysicalReadyRequiresGuardianLauncherStatusWriterCopiesClosed,
    true,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .futurePhysicalReadyRequiresExactStatusPipeIdentity,
    true,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .mechanicsImplemented,
    false,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3
      .guardianImplemented,
    false,
  );
  assert.equal(
    Object.keys(bootstrap).some((key) => key.toLowerCase().includes("commit")),
    false,
  );
  assert.equal(
    Object.values(
      bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_AUTHORITY_V3,
    ).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(
      bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_NONCLAIMS_V3,
    ).every((value) => value === false),
    true,
  );
  assert.equal(
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_NONCLAIMS_V3
      .serializedReplayProvesFreshness,
    false,
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
