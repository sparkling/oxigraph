import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2,
  createCandidateContainmentLaunchArgvV2,
  createCandidateContainmentLaunchEnvironmentV2,
} from "../src/candidate/containment-launch-capsule-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
  createCandidateContainmentLaunchCapsuleV3,
} from "../src/candidate/containment-launch-capsule-v3.mjs";
import * as journal from "../src/candidate/containment-guardian-journal-v1.mjs";
import * as bootstrap from "../src/candidate/containment-supervisor-bootstrap-v3.mjs";
import * as preflight from "../src/candidate/containment-supervisor-preflight-v4.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { sandboxSessionV2ContainmentReadiness } from "../src/candidate/sandbox-session-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";

const CONTRACT_ERROR = /candidate containment supervisor preflight v4/u;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function jsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function launchCapsule(variant = "baseline") {
  const requestSha256 = digest("request");
  const generationSha256 = digest("admission-generation");
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
          inode: String(70_000 + index),
          links: "1",
          type: "regular",
          permissions: spec.permissions,
          owner: "1000",
          group: "1000",
          size: String(bytes.length),
          modifiedNs: String(1_700_000_015_000_000_000n + BigInt(index)),
          changedNs: String(1_700_000_016_000_000_000n + BigInt(index)),
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

function createDecisionJournalRecords(
  identity,
  decisionProjectionSha256,
  readyProjectionSha256,
) {
  let previousRecord = null;
  const records = [];
  for (const [
    index,
    state,
  ] of journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1.entries()) {
    if (state === "CANCEL_WRITE_COMPLETED") break;
    previousRecord = journal.createCandidateContainmentGuardianJournalRecordV1({
      generationIdentity: identity,
      state,
      actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
      operationProjectionSha256:
        state === "DECISION_CANCEL_DURABLE"
          ? decisionProjectionSha256
          : digest(`preflight-operation:${index + 1}`),
      evidenceProjectionSha256:
        state === "PREFLIGHT_READY_OBSERVED" ||
        state === "DECISION_CANCEL_DURABLE"
          ? readyProjectionSha256
          : digest(`preflight-evidence:${index + 1}`),
      previousRecord,
    });
    records.push(previousRecord);
  }
  return records;
}

function artifacts(variant = "baseline") {
  const capsuleArtifact = launchCapsule(variant);
  const launchCapsuleBytes = capsuleArtifact.bytes;
  const verifiedCapsule = JSON.parse(launchCapsuleBytes.toString("utf8"));
  const identity =
    journal.createCandidateContainmentGuardianGenerationIdentityV1({
      requestSha256: verifiedCapsule.requestSha256,
      ownerRequestSha256: digest("owner-request"),
      limitsSha256: digest("limits"),
      delegatedRootIdentitySha256: digest("delegated-root"),
      launchCapsuleRawSha256: sha256(launchCapsuleBytes),
      launchCapsuleProjectionSha256:
        // The production constructor independently verifies this exact digest.
        preflight.candidateContainmentSupervisorPreflightLaunchCapsuleProjectionSha256V4(
          launchCapsuleBytes,
        ),
      bootstrapRequirementsSha256:
        bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SHA256_V3,
      launchRequirementsSha256:
        CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
      supervisorExecutableIdentitySha256: digest("preflight-v4-executable"),
      birthGuardianEpochSha256: digest("birth-guardian-epoch"),
      bootIdSha256: digest("boot-id"),
      admissionGenerationSha256: verifiedCapsule.generationSha256,
      launchNonceSha256: digest("launch-nonce"),
    });
  const supervisorLaunchIntentRecordRawSha256 = digest(
    "supervisor-launch-intent-record-raw",
  );
  const startArtifact =
    preflight.createCandidateContainmentSupervisorPreflightStartV4({
      generationIdentity: identity,
      actorGuardianEpochSha256: identity.birthGuardianEpochSha256,
      supervisorLaunchIntentRecordRawSha256,
      launchCapsuleBytes,
    });
  const startBytes = startArtifact.bytes;
  const start =
    preflight.verifyCandidateContainmentSupervisorPreflightStartV4(startBytes);
  const capsuleFrameArtifact =
    preflight.createCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes,
      launchCapsuleBytes,
    });
  const capsuleFrameBytes = capsuleFrameArtifact.bytes;
  const capsuleFrame =
    preflight.verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes,
      capsuleFrameBytes,
    });
  const readyArtifact =
    preflight.createCandidateContainmentSupervisorPreflightReadyV4({
      startBytes,
      capsuleFrameBytes,
    });
  const readyBytes = readyArtifact.bytes;
  const ready = preflight.verifyCandidateContainmentSupervisorPreflightReadyV4({
    startBytes,
    capsuleFrameBytes,
    readyBytes,
  });
  const cancelDecision =
    preflight.createCandidateContainmentSupervisorPreflightCancelDecisionV4({
      startBytes,
      capsuleFrameBytes,
      readyBytes,
      reason: "caller-abort",
    });
  const decisionJournalRecords = createDecisionJournalRecords(
    identity,
    cancelDecision.projectionSha256,
    ready.projectionSha256,
  );
  const decisionJournalArtifact = decisionJournalRecords.at(-1);
  const decisionJournalRecord = {
    name: decisionJournalArtifact.name,
    bytes: decisionJournalArtifact.bytes,
  };
  const decisionJournalRecordRawSha256 = decisionJournalArtifact.rawSha256;
  const cancelArtifact =
    preflight.createCandidateContainmentSupervisorPreflightCancelV4({
      startBytes,
      capsuleFrameBytes,
      readyBytes,
      cancelDecision,
      decisionJournalRecord,
    });
  const cancelBytes = cancelArtifact.bytes;
  const cancelledArtifact =
    preflight.createCandidateContainmentSupervisorPreflightCancelledV4({
      startBytes,
      capsuleFrameBytes,
      readyBytes,
      cancelBytes,
      decisionJournalRecord,
    });
  const cancelledBytes = cancelledArtifact.bytes;
  const doneArtifact =
    preflight.createCandidateContainmentSupervisorPreflightDoneV4({
      startBytes,
      capsuleFrameBytes,
      readyBytes,
      cancelBytes,
      cancelledBytes,
      decisionJournalRecord,
    });
  const doneBytes = doneArtifact.bytes;
  return {
    identity,
    launchCapsuleBytes,
    startArtifact,
    capsuleFrameArtifact,
    readyArtifact,
    cancelArtifact,
    cancelledArtifact,
    doneArtifact,
    supervisorLaunchIntentRecordRawSha256,
    ready,
    cancelDecision,
    decisionJournalRecords,
    decisionJournalRecord,
    decisionJournalRecordRawSha256,
    startBytes,
    start,
    capsuleFrameBytes,
    capsuleFrame,
    readyBytes,
    cancelBytes,
    cancelledBytes,
    doneBytes,
  };
}

function event(direction, bytes) {
  return { direction, bytes };
}

function events(value) {
  return [
    event("guardian-to-supervisor", value.startBytes),
    event("guardian-to-supervisor", value.capsuleFrameBytes),
    event("supervisor-to-guardian", value.readyBytes),
    event("guardian-to-supervisor", value.cancelBytes),
    event("supervisor-to-guardian", value.cancelledBytes),
    event("supervisor-to-guardian", value.doneBytes),
  ];
}

function observation(overrides = {}) {
  return {
    commandEofObserved: true,
    commandEofAfterCancel: true,
    trailingCommandBytes: 0,
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

function replayInput(
  value,
  allEvents = events(value),
  observed = observation(),
) {
  return {
    events: allEvents,
    observation: observed,
    expectedGenerationIdentitySha256: value.identity.identitySha256,
    expectedBirthGuardianEpochSha256: value.identity.birthGuardianEpochSha256,
    expectedSupervisorLaunchIntentRecordRawSha256:
      value.supervisorLaunchIntentRecordRawSha256,
    expectedCancelDecisionProjectionSha256:
      value.cancelDecision.projectionSha256,
    expectedDecisionJournalRecordRawSha256:
      value.decisionJournalRecordRawSha256,
    decisionJournalRecord: value.decisionJournalRecord,
  };
}

function replay(value, allEvents = events(value), observed = observation()) {
  return preflight.verifyCandidateContainmentSupervisorPreflightReplayV4(
    replayInput(value, allEvents, observed),
  );
}

function mutateFrame(bytes, mutate) {
  const value = JSON.parse(bytes.toString("utf8"));
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

function assertCanonicalEqual(actual, expected, label) {
  assert.equal(canonicalJson(actual), canonicalJson(expected), label);
}

test("preflight v4 is a distinct additive family and neither verifier accepts bootstrap v3", () => {
  const value = artifacts();
  const schemas = new Map([
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-start/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_PROJECTION_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-start-replay/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-capsule/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_PROJECTION_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-capsule-replay/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-control/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_PROJECTION_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-control-replay/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-status/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REPLAY_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-replay/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-requirements/v1",
    ],
    [
      "CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CANCEL_DECISION_SCHEMA_V4",
      "oxigraph.candidate-containment-supervisor-preflight-cancel-decision/v1",
    ],
  ]);
  for (const [name, expected] of schemas) {
    assert.equal(preflight[name], expected, name);
  }
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4,
    canonicalSha256(
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_V4,
    ),
  );
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4,
    "47e429123d0a74dbbd6d8d82f4b5d0c62d565674868f5424df0e2f46b717dbc4",
  );
  assert.deepEqual(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_V4
      .eventOrder,
    [
      "START",
      "CAPSULE",
      "PREFLIGHT_READY",
      "CANCEL",
      "CANCELLED_WITHOUT_CLONE",
      "SUPERVISOR_DONE",
    ],
  );
  assert.notEqual(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_SCHEMA_V4,
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_SCHEMA_V3,
  );
  assert.throws(
    () =>
      bootstrap.verifyCandidateContainmentSupervisorBootstrapStartV3(
        value.startBytes,
      ),
    /candidate containment supervisor bootstrap v3/u,
  );
  const legacyStart =
    bootstrap.createCandidateContainmentSupervisorBootstrapStartV3({
      requestSha256: value.identity.requestSha256,
      generationSha256: value.identity.admissionGenerationSha256,
      guardianEpochSha256: value.identity.birthGuardianEpochSha256,
      guardianNonceSha256: value.identity.launchNonceSha256,
      launchCapsuleBytes: value.launchCapsuleBytes,
      limits: {
        memoryMaxBytes: 8_589_934_592,
        memorySwapMaxBytes: 0,
        tasksMax: 512,
        wallMs: 2_700_000,
      },
    });
  assert.throws(
    () =>
      preflight.verifyCandidateContainmentSupervisorPreflightStartV4(
        legacyStart.bytes,
      ),
    CONTRACT_ERROR,
  );
  assert.equal(
    Object.keys(preflight).some((key) => key.toLowerCase().includes("commit")),
    false,
  );
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_V4
      .commitAccepted,
    false,
  );
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_V4
      .clonePermitted,
    false,
  );
  const requirements =
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_V4;
  assert.equal(requirements.successExitCode, 124);
  assert.equal(requirements.malformedOrUnsupportedExitCode, 125);
  assert.equal(requirements.descriptorOrIoFailureExitCode, 126);
  assert.equal(requirements.commandEofRequiredAfterCancel, true);
  assert.equal(requirements.trailingCommandBytesPermitted, false);
  assert.equal(requirements.statusEofRequiredAfterFinalStatus, true);
  assert.equal(requirements.descriptorsClosedBeforeReadyFrom, 18);
  assert.equal(requirements.supervisorDescriptorRangeStart, 0);
  assert.equal(requirements.supervisorDescriptorRangeEnd, 17);
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_MAX_BYTES_V4,
    8 * 1024,
  );
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_FRAME_MAX_BYTES_V4,
    128 * 1024,
  );
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_MAX_BYTES_V4,
    4 * 1024,
  );
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
    8 * 1024,
  );
  assert.equal(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_DIAGNOSTICS_MAX_BYTES_V4,
    16,
  );
  assert.equal(
    requirements.generationIdentityBootstrapRequirementRole,
    "historical-predecessor-anchor-only",
  );
  assert.equal(requirements.bootstrapReadyReinterpretationPermitted, false);
  assert.equal(requirements.nativeMechanicsRequiredForExecutableEvidence, true);
  assert.equal(
    requirements.journalRecordRequiredForCancelDecisionBinding,
    true,
  );
  assert.equal(
    Object.keys(requirements).some((key) => key.endsWith("Implemented")),
    false,
  );
  assertCanonicalEqual(
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_IMPLEMENTATION_CHECKPOINT_V4,
    {
      schema:
        "oxigraph.candidate-containment-supervisor-preflight-implementation-checkpoint/v1",
      pureProtocolImplemented: true,
      nativeSupervisorSourceImplemented: true,
      nativeAttestationImplemented: true,
      nativeExecutionFixtureImplemented: false,
      filesystemGuardianImplemented: false,
      bootstrapRequirementsAnchorSemantics:
        "opaque-historical-identity-component-not-authority",
      nativeObservation: null,
      binding: null,
      physicalEligibility: false,
      authority:
        preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
    },
  );
});

test("START and CAPSULE bind the exact guardian generation and launch requirements", () => {
  const value = artifacts();
  assert.equal(value.start.action, "START");
  assert.equal(value.start.commandSequence, 0);
  assert.equal(
    value.start.generationIdentitySha256,
    value.identity.identitySha256,
  );
  assert.deepEqual(value.start.generationIdentity, value.identity);
  assert.equal(
    value.identity.bootstrapRequirementsSha256,
    bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SHA256_V3,
  );
  assert.equal(value.start.requestSha256, value.identity.requestSha256);
  assert.equal(
    value.start.ownerRequestSha256,
    value.identity.ownerRequestSha256,
  );
  assert.equal(
    value.start.admissionGenerationSha256,
    value.identity.admissionGenerationSha256,
  );
  assert.equal(
    value.start.birthGuardianEpochSha256,
    value.identity.birthGuardianEpochSha256,
  );
  assert.equal(
    value.start.actorGuardianEpochSha256,
    value.identity.birthGuardianEpochSha256,
  );
  assert.equal(value.start.launchNonceSha256, value.identity.launchNonceSha256);
  assert.equal(
    value.start.supervisorLaunchIntentRecordRawSha256,
    value.supervisorLaunchIntentRecordRawSha256,
  );
  assert.equal(
    value.start.intendedSupervisorExecutableIdentitySha256,
    value.identity.supervisorExecutableIdentitySha256,
  );
  assert.equal(
    value.start.launchCapsuleByteLength,
    value.launchCapsuleBytes.length,
  );
  assert.equal(
    value.start.launchCapsuleRawSha256,
    sha256(value.launchCapsuleBytes),
  );
  assert.equal(
    value.start.launchRequirementsSha256,
    CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
  );
  assert.equal(
    value.start.fileDescriptorMapSha256,
    CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3,
  );
  assert.equal(
    value.start.remapPlanSha256,
    CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3,
  );
  assert.equal(value.capsuleFrame.action, "CAPSULE");
  assert.equal(value.capsuleFrame.startRawSha256, value.start.rawSha256);
  assert.deepEqual(
    Buffer.from(
      JSON.parse(value.capsuleFrameBytes.toString("utf8")).launchCapsuleBase64,
      "base64",
    ),
    value.launchCapsuleBytes,
  );
  assertDeepFrozen(value.start);
  assertDeepFrozen(value.capsuleFrame);
});

test("exact six-frame cancel replay validates hashes but grants no physical authority", () => {
  const value = artifacts();
  const projection = replay(value);
  assert.equal(
    projection.schema,
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REPLAY_SCHEMA_V4,
  );
  assert.equal(projection.status, "PREFLIGHT_CANCEL_REPLAYED");
  assert.deepEqual(projection.states, [
    "START",
    "CAPSULE",
    "PREFLIGHT_READY",
    "CANCEL",
    "CANCELLED_WITHOUT_CLONE",
    "SUPERVISOR_DONE",
  ]);
  assert.equal(projection.capsuleReplayValidated, true);
  assert.equal(projection.reportedPreflightReady, true);
  assert.equal(projection.preflightReadyObservedFromNativeSupervisor, null);
  assert.equal(
    projection.decisionJournalRecordRawSha256,
    value.decisionJournalRecordRawSha256,
  );
  assert.equal(projection.decisionDurability, null);
  assert.equal(projection.childCreated, null);
  assert.equal(projection.supervisorExecuted, null);
  assert.equal(projection.supervisorReaped, null);
  assert.equal(projection.cleanupSafe, null);
  assertCanonicalEqual(
    projection.physicalFacts,
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
  );
  assert.equal(projection.binding, null);
  assert.equal(projection.physicalEligibility, false);
  assert.equal(projection.finalDecisionEligible, false);
  assert.equal(
    Object.values(projection.authority).every((item) => item === false),
    true,
  );
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

test("PREFLIGHT_READY reports only bounded structural observations", () => {
  const value = artifacts();
  const ready = JSON.parse(value.readyBytes.toString("utf8"));
  assert.equal(ready.state, "PREFLIGHT_READY");
  assert.equal(ready.decisionRawSha256, null);
  for (const field of [
    "canonicalStartAccepted",
    "canonicalCapsuleEnvelopeAccepted",
    "canonicalBase64Accepted",
    "decodedCapsuleByteLengthMatched",
    "decodedCapsuleRawSha256Matched",
    "launchCapsuleHeaderBindingsMatched",
    "descriptorsZeroThroughSeventeenStructurallyChecked",
    "descriptorsEighteenAndAboveClosedBeforeReady",
    "descriptorAccessModesMatched",
    "descriptorKindsMatched",
    "descriptorNonaliasInSupervisorTable",
    "statusWriterUniqueInSupervisorTable",
  ]) {
    assert.equal(ready.evidence[field], true, field);
  }
  for (const field of [
    "semanticLaunchCapsuleValidation",
    "launchCapsuleProjectionValidation",
    "retainedFileContentIdentity",
    "executedSupervisorBoundToFd6",
    "guardianLauncherStatusWriterCopiesClosed",
    "delegatedRootIdentity",
    "cgroupFilesystem",
    "cgroupConfiguration",
    "cgroupLimits",
    "cgroupEmptiness",
    "decisionDurability",
    "directChildPidfdWaitidReap",
    "cleanupOutcome",
  ]) {
    assert.equal(ready.evidence[field], null, field);
  }
  assert.equal(ready.evidence.cleanupSafe, null);
  assert.equal(ready.evidence.binding, null);
  assert.equal(ready.evidence.physicalEligibility, false);
  assert.equal(ready.evidence.finalDecisionEligibility, false);
  assertCanonicalEqual(
    ready.physicalFacts,
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
  );
  assertCanonicalEqual(
    ready.authority,
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
  );
  assertCanonicalEqual(
    ready.nonclaims,
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4,
  );
  assert.equal(
    Object.values(ready.authority).every((item) => item === false),
    true,
  );
  assert.equal(value.ready.evidence, undefined);
  assertCanonicalEqual(value.ready.reportedEvidence, ready.evidence);
  assert.equal(value.ready.nativeObservation, null);
  assertCanonicalEqual(
    value.ready.physicalFacts,
    preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
  );
  assert.equal(value.ready.binding, null);
  assert.equal(value.ready.physicalEligibility, false);
  assert.equal(
    Object.values(value.ready.authority).every((item) => item === false),
    true,
  );
  assert.match(value.ready.projectionSha256, /^[0-9a-f]{64}$/u);
  for (const bytes of [value.cancelledBytes, value.doneBytes]) {
    const terminal = JSON.parse(bytes.toString("utf8"));
    assertCanonicalEqual(
      terminal.physicalFacts,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
    );
    assert.equal(
      Object.values(terminal.authority).every((item) => item === false),
      true,
    );
    assertCanonicalEqual(
      terminal.nonclaims,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4,
    );
  }
});

test("cancel decision projection breaks the journal cycle and binds the exact durable record", () => {
  const value = artifacts();
  const unsignedDecision = Object.fromEntries(
    Object.entries(value.cancelDecision).filter(
      ([key]) => key !== "projectionSha256",
    ),
  );
  assert.equal(
    value.cancelDecision.projectionSha256,
    canonicalSha256(unsignedDecision),
  );
  assert.equal(value.cancelDecision.action, "CANCEL");
  assert.equal(value.cancelDecision.reason, "caller-abort");
  assert.equal(
    value.cancelDecision.preflightReadyRawSha256,
    value.ready.rawSha256,
  );
  const record = journal.verifyCandidateContainmentGuardianJournalRecordV1(
    value.decisionJournalRecord,
  );
  assert.equal(record.recordType, "DECISION_CANCEL_DURABLE");
  assert.equal(record.priorState, "PREFLIGHT_READY_OBSERVED");
  assert.equal(record.nextState, "DECISION_CANCEL_DURABLE");
  assert.equal(
    record.generationIdentity.identitySha256,
    value.identity.identitySha256,
  );
  assert.equal(
    record.operation.reportedProjectionSha256,
    value.cancelDecision.projectionSha256,
  );
  assert.equal(
    record.evidence.reportedProjectionSha256,
    value.ready.projectionSha256,
  );
  const cancelBody = JSON.parse(value.cancelBytes.toString("utf8"));
  assertCanonicalEqual(cancelBody.cancelDecision, value.cancelDecision);
  assert.equal(
    cancelBody.cancelDecisionProjectionSha256,
    value.cancelDecision.projectionSha256,
  );
  assert.equal(cancelBody.decisionJournalRecordRawSha256, record.rawSha256);

  const base = {
    startBytes: value.startBytes,
    capsuleFrameBytes: value.capsuleFrameBytes,
    readyBytes: value.readyBytes,
    cancelDecision: value.cancelDecision,
  };
  const wrongGenerationIdentity =
    journal.createCandidateContainmentGuardianGenerationIdentityV1({
      requestSha256: value.identity.requestSha256,
      ownerRequestSha256: value.identity.ownerRequestSha256,
      limitsSha256: value.identity.limitsSha256,
      delegatedRootIdentitySha256: value.identity.delegatedRootIdentitySha256,
      launchCapsuleRawSha256: value.identity.launchCapsuleRawSha256,
      launchCapsuleProjectionSha256:
        value.identity.launchCapsuleProjectionSha256,
      bootstrapRequirementsSha256: value.identity.bootstrapRequirementsSha256,
      launchRequirementsSha256: value.identity.launchRequirementsSha256,
      supervisorExecutableIdentitySha256:
        value.identity.supervisorExecutableIdentitySha256,
      birthGuardianEpochSha256: value.identity.birthGuardianEpochSha256,
      bootIdSha256: digest("wrong-journal-generation-boot-id"),
      admissionGenerationSha256: value.identity.admissionGenerationSha256,
      launchNonceSha256: value.identity.launchNonceSha256,
    });
  for (const decisionJournalArtifact of [
    value.decisionJournalRecords.at(-2),
    createDecisionJournalRecords(
      value.identity,
      digest("wrong-cancel-decision"),
      value.ready.projectionSha256,
    ).at(-1),
    createDecisionJournalRecords(
      value.identity,
      value.cancelDecision.projectionSha256,
      digest("wrong-ready-projection"),
    ).at(-1),
    createDecisionJournalRecords(
      wrongGenerationIdentity,
      value.cancelDecision.projectionSha256,
      value.ready.projectionSha256,
    ).at(-1),
  ]) {
    assert.throws(
      () =>
        preflight.createCandidateContainmentSupervisorPreflightCancelV4({
          ...base,
          decisionJournalRecord: {
            name: decisionJournalArtifact.name,
            bytes: decisionJournalArtifact.bytes,
          },
        }),
      CONTRACT_ERROR,
    );
  }

  const resealedDecision = structuredClone(value.cancelDecision);
  resealedDecision.reason = "decision-timeout";
  resealedDecision.projectionSha256 = canonicalSha256(
    Object.fromEntries(
      Object.entries(resealedDecision).filter(
        ([key]) => key !== "projectionSha256",
      ),
    ),
  );
  assert.throws(
    () =>
      preflight.createCandidateContainmentSupervisorPreflightCancelV4({
        ...base,
        cancelDecision: resealedDecision,
        decisionJournalRecord: value.decisionJournalRecord,
      }),
    CONTRACT_ERROR,
  );
});

test("every wire frame rejects duplicate keys, ambiguous base64, invalid bytes, truncation, and overflow", () => {
  const value = artifacts();
  const ordered = events(value);
  const duplicateKey = Buffer.from(
    value.startBytes
      .toString("utf8")
      .replace('"action":"START"', '"action":"START","action":"START"'),
    "utf8",
  );
  const missingField = mutateFrame(value.startBytes, (body) => {
    delete body.launchNonceSha256;
  });
  const extraField = mutateFrame(value.startBytes, (body) => {
    body.unexpected = null;
  });
  for (const bytes of [
    duplicateKey,
    missingField,
    extraField,
    Buffer.from([0xff, 0x0a]),
    Buffer.from('{"action":"START\u0000"}\n', "utf8"),
  ]) {
    assert.throws(
      () => replay(value, replaceEventBytes(ordered, 0, bytes)),
      CONTRACT_ERROR,
    );
  }

  // `Zh==` passes the base64 alphabet/shape regex but has non-zero padding
  // bits; a strict decoder must reject it because it re-encodes as `Zg==`.
  const nonzeroPaddingBits = mutateFrame(value.capsuleFrameBytes, (body) => {
    body.launchCapsuleBase64 = "Zh==";
  });
  assert.throws(
    () => replay(value, replaceEventBytes(ordered, 1, nonzeroPaddingBits)),
    CONTRACT_ERROR,
  );

  for (const [index, bytes] of ordered.map((item, itemIndex) => [
    itemIndex,
    item.bytes.subarray(0, item.bytes.length - 1),
  ])) {
    assert.throws(
      () => replay(value, replaceEventBytes(ordered, index, bytes)),
      CONTRACT_ERROR,
      `truncated event ${index}`,
    );
  }

  for (const [index, maximum] of [
    [
      0,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_MAX_BYTES_V4,
    ],
    [
      1,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_FRAME_MAX_BYTES_V4,
    ],
    [
      2,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
    ],
    [
      3,
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_MAX_BYTES_V4,
    ],
  ]) {
    assert.throws(
      () =>
        replay(
          value,
          replaceEventBytes(ordered, index, Buffer.alloc(maximum + 1, 0x20)),
        ),
      CONTRACT_ERROR,
      `oversized event ${index}`,
    );
  }
});

test("transition order, direction, decision bindings, terminal hash chain, and nonclaims are exact", () => {
  const value = artifacts();
  const ordered = events(value);
  const wrongDirection = structuredClone(ordered);
  wrongDirection[2].direction = "guardian-to-supervisor";
  for (const changedEvents of [
    ordered.slice(0, 5),
    [...ordered, ordered.at(-1)],
    [ordered[0], ordered[1], ordered[2], ordered[3], ordered[3], ordered[5]],
    wrongDirection,
  ]) {
    assert.throws(() => replay(value, changedEvents), CONTRACT_ERROR);
  }

  for (const mutate of [
    (body) => {
      body.commandSequence = 1;
    },
    (body) => {
      body.reason = "guardian-shutdown";
    },
    (body) => {
      body.preflightReadyRawSha256 = "1".repeat(64);
    },
    (body) => {
      body.cancelDecisionProjectionSha256 = "2".repeat(64);
    },
    (body) => {
      body.decisionJournalRecordRawSha256 = "3".repeat(64);
    },
  ]) {
    assert.throws(
      () =>
        replay(
          value,
          replaceEventBytes(ordered, 3, mutateFrame(value.cancelBytes, mutate)),
        ),
      CONTRACT_ERROR,
    );
  }

  const terminalCases = [
    [4, value.cancelledBytes],
    [5, value.doneBytes],
  ];
  for (const [index, bytes] of terminalCases) {
    for (const mutate of [
      (body) => {
        body.statusSequence += 1;
      },
      (body) => {
        body.state = "READY";
      },
      (body) => {
        body.previousStatusRawSha256 = "4".repeat(64);
      },
      (body) => {
        body.decisionRawSha256 = "5".repeat(64);
      },
      (body) => {
        body.decisionJournalRecordRawSha256 = "6".repeat(64);
      },
      (body) => {
        body.authority.nativeObservationAuthority = true;
      },
      (body) => {
        body.physicalFacts.supervisorExecuted = true;
      },
      (body) => {
        body.evidence.childCreated = true;
      },
    ]) {
      assert.throws(
        () =>
          replay(
            value,
            replaceEventBytes(ordered, index, mutateFrame(bytes, mutate)),
          ),
        CONTRACT_ERROR,
        `terminal event ${index}`,
      );
    }
  }

  for (const mutate of [
    (body) => {
      body.schema =
        bootstrap.CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_SCHEMA_V3;
    },
    (body) => {
      body.state = "READY";
    },
    (body) => {
      body.authority.nativeObservationAuthority = true;
    },
    (body) => {
      body.physicalFacts.decisionDurability = true;
    },
    (body) => {
      body.evidence.semanticLaunchCapsuleValidation = true;
    },
  ]) {
    assert.throws(
      () =>
        replay(
          value,
          replaceEventBytes(ordered, 2, mutateFrame(value.readyBytes, mutate)),
        ),
      CONTRACT_ERROR,
    );
  }
});

test("replay rejects substitution, malformed framing, reordered events, stale hashes, COMMIT, and incomplete terminal observation", () => {
  const value = artifacts();
  const ordered = events(value);
  const substituted = launchCapsule("substituted");
  assert.throws(
    () =>
      preflight.createCandidateContainmentSupervisorPreflightCapsuleFrameV4({
        startBytes: value.startBytes,
        launchCapsuleBytes: substituted.bytes,
      }),
    CONTRACT_ERROR,
  );

  const noncanonicalBase64 = mutateFrame(value.capsuleFrameBytes, (body) => {
    body.launchCapsuleBase64 = "AAAA====";
  });
  assert.throws(
    () => replay(value, replaceEventBytes(ordered, 1, noncanonicalBase64)),
    CONTRACT_ERROR,
  );

  const staleReady = mutateFrame(value.readyBytes, (body) => {
    body.startRawSha256 = "a".repeat(64);
  });
  assert.throws(
    () => replay(value, replaceEventBytes(ordered, 2, staleReady)),
    CONTRACT_ERROR,
  );

  const forgedIdentity = mutateFrame(value.startBytes, (body) => {
    body.generationIdentity.controlGenerationSha256 = "b".repeat(64);
  });
  assert.throws(
    () => replay(value, replaceEventBytes(ordered, 0, forgedIdentity)),
    CONTRACT_ERROR,
  );

  const commit = mutateFrame(value.cancelBytes, (body) => {
    body.action = "COMMIT";
  });
  assert.throws(
    () => replay(value, replaceEventBytes(ordered, 3, commit)),
    CONTRACT_ERROR,
  );

  const reordered = [...ordered];
  [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
  assert.throws(() => replay(value, reordered), CONTRACT_ERROR);

  for (const bytes of [
    value.startBytes.subarray(0, value.startBytes.length - 1),
    Buffer.concat([value.startBytes, value.startBytes]),
    Buffer.from(value.startBytes.toString("utf8").replace("\n", "\r\n")),
  ]) {
    assert.throws(
      () => replay(value, replaceEventBytes(ordered, 0, bytes)),
      CONTRACT_ERROR,
    );
  }

  for (const observed of [
    observation({ commandEofObserved: false }),
    observation({ commandEofAfterCancel: false }),
    observation({ trailingCommandBytes: 1 }),
    observation({ statusEofObserved: false }),
    observation({ statusEofCount: 0 }),
    observation({ statusEofCount: 2 }),
    observation({ eofAfterFinalStatus: false }),
    observation({ commandWriteError: "EPIPE" }),
    observation({ statusReadError: "EIO" }),
    observation({ diagnosticsBytes: 1 }),
    observation({ diagnosticsSha256: digest("not-empty-diagnostics") }),
    observation({ supervisorExitCode: 0 }),
    observation({ supervisorExitCode: 125 }),
    observation({ supervisorExitCode: 126 }),
    observation({ supervisorSignal: "SIGKILL" }),
    observation({ supervisorReaped: false }),
  ]) {
    assert.throws(() => replay(value, ordered, observed), CONTRACT_ERROR);
  }

  for (const field of [
    "expectedGenerationIdentitySha256",
    "expectedBirthGuardianEpochSha256",
    "expectedSupervisorLaunchIntentRecordRawSha256",
    "expectedCancelDecisionProjectionSha256",
    "expectedDecisionJournalRecordRawSha256",
  ]) {
    const anchored = {
      events: ordered,
      observation: observation(),
      expectedGenerationIdentitySha256: value.identity.identitySha256,
      expectedBirthGuardianEpochSha256: value.identity.birthGuardianEpochSha256,
      expectedSupervisorLaunchIntentRecordRawSha256:
        value.supervisorLaunchIntentRecordRawSha256,
      expectedCancelDecisionProjectionSha256:
        value.cancelDecision.projectionSha256,
      expectedDecisionJournalRecordRawSha256:
        value.decisionJournalRecordRawSha256,
      decisionJournalRecord: value.decisionJournalRecord,
    };
    anchored[field] = "c".repeat(64);
    assert.throws(
      () =>
        preflight.verifyCandidateContainmentSupervisorPreflightReplayV4(
          anchored,
        ),
      CONTRACT_ERROR,
      field,
    );
  }
});

test("exact input shapes, external anchors, and copy-on-read bytes resist mutable or exotic callers", () => {
  const value = artifacts();
  const ordered = events(value);
  assert.throws(() => replay(value, new Proxy(ordered, {})), CONTRACT_ERROR);
  const sparse = [...ordered];
  delete sparse[2];
  assert.throws(() => replay(value, sparse), CONTRACT_ERROR);
  const foreign = [...ordered];
  Object.setPrototypeOf(foreign, null);
  assert.throws(() => replay(value, foreign), CONTRACT_ERROR);
  const accessorEvents = structuredClone(ordered);
  Object.defineProperty(accessorEvents[0], "bytes", {
    configurable: true,
    enumerable: true,
    get: () => value.startBytes,
  });
  assert.throws(() => replay(value, accessorEvents), CONTRACT_ERROR);

  const symbolInput = replayInput(value);
  symbolInput[Symbol("unexpected")] = true;
  assert.throws(
    () =>
      preflight.verifyCandidateContainmentSupervisorPreflightReplayV4(
        symbolInput,
      ),
    CONTRACT_ERROR,
  );
  const accessorObservation = observation();
  Object.defineProperty(accessorObservation, "supervisorExitCode", {
    configurable: true,
    enumerable: true,
    get: () => 124,
  });
  assert.throws(
    () => replay(value, ordered, accessorObservation),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      preflight.createCandidateContainmentSupervisorPreflightStartV4({
        generationIdentity: new Proxy(value.identity, {}),
        actorGuardianEpochSha256: value.identity.birthGuardianEpochSha256,
        supervisorLaunchIntentRecordRawSha256:
          value.supervisorLaunchIntentRecordRawSha256,
        launchCapsuleBytes: value.launchCapsuleBytes,
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      preflight.verifyCandidateContainmentSupervisorPreflightStartV4(
        new Proxy(value.startBytes, {}),
      ),
    CONTRACT_ERROR,
  );

  for (const artifact of [
    value.startArtifact,
    value.capsuleFrameArtifact,
    value.readyArtifact,
    value.cancelArtifact,
    value.cancelledArtifact,
    value.doneArtifact,
  ]) {
    const retained = artifact.bytes;
    const mutated = artifact.bytes;
    mutated.fill(0);
    assert.deepEqual(artifact.bytes, retained);
    assert.notDeepEqual(mutated, retained);
  }
  const mutableCapsule = Buffer.from(value.launchCapsuleBytes);
  const retainedFrame =
    preflight.createCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: value.startBytes,
      launchCapsuleBytes: mutableCapsule,
    });
  mutableCapsule.fill(0);
  assert.doesNotThrow(() =>
    preflight.verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: value.startBytes,
      capsuleFrameBytes: retainedFrame.bytes,
    }),
  );

  const foreignTranscript = artifacts("foreign-transcript");
  const foreignInput = replayInput(foreignTranscript);
  foreignInput.expectedGenerationIdentitySha256 = value.identity.identitySha256;
  assert.throws(
    () =>
      preflight.verifyCandidateContainmentSupervisorPreflightReplayV4(
        foreignInput,
      ),
    CONTRACT_ERROR,
  );

  const changedJournalBytes = Buffer.from(value.decisionJournalRecord.bytes);
  changedJournalBytes[0] ^= 1;
  const changedJournal = replayInput(value);
  changedJournal.decisionJournalRecord = {
    name: value.decisionJournalRecord.name,
    bytes: changedJournalBytes,
  };
  assert.throws(
    () =>
      preflight.verifyCandidateContainmentSupervisorPreflightReplayV4(
        changedJournal,
      ),
    CONTRACT_ERROR,
  );
});

test("authority, production readiness, registries, and predecessor source identities stay frozen", () => {
  assert.deepEqual(
    Object.keys(
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
    ),
    [
      "nativeObservationAuthority",
      "guardianAuthority",
      "supervisorAuthority",
      "descriptorAuthority",
      "filesystemDurabilityAuthority",
      "reapAuthority",
      "containmentExecutionAuthority",
      "sandboxReportAuthority",
      "applicationResultAuthority",
      "applicationReceiptAuthority",
      "runtimeRegistrationAuthority",
      "qualificationAuthority",
      "finalDecisionAuthority",
      "promotionAuthority",
      "publicationAuthority",
      "productionContainment",
    ],
  );
  assert.deepEqual(
    Object.keys(
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
    ),
    [
      "semanticLaunchCapsuleValidation",
      "launchCapsuleProjectionValidation",
      "retainedFileContentIdentity",
      "executedSupervisorBoundToFd6",
      "guardianLauncherStatusWriterCopiesClosed",
      "delegatedRootIdentity",
      "cgroupFilesystem",
      "cgroupConfiguration",
      "cgroupLimits",
      "cgroupEmptiness",
      "decisionDurability",
      "directChildPidfdWaitidReap",
      "cleanupOutcome",
      "supervisorExecuted",
      "supervisorReaped",
      "supervisorExitStatus",
      "childCreated",
      "cleanupSafe",
      "binding",
      "physicalEligibility",
      "finalDecisionEligibility",
      "productionContainment",
    ],
  );
  assert.deepEqual(
    Object.keys(
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4,
    ),
    [
      "serializedReplayProvesFreshness",
      "serializedReplayProvesFrameOrigin",
      "serializedReplayProvesNativeSupervisorExecution",
      "serializedReplayProvesSemanticCapsuleValidation",
      "serializedReplayProvesCapsuleProjectionValidation",
      "serializedReplayProvesRetainedFileContentIdentity",
      "serializedReplayProvesExecutedSupervisorFdBinding",
      "serializedReplayProvesInheritedDescriptorExactness",
      "serializedReplayProvesGlobalSoleWriterOwnership",
      "serializedReplayProvesGuardianLauncherWriterClosure",
      "serializedReplayProvesDelegatedRootIdentity",
      "serializedReplayProvesCgroupFilesystem",
      "serializedReplayProvesCgroupConfiguration",
      "serializedReplayProvesDecisionDurability",
      "serializedReplayProvesDirectChildReap",
      "serializedReplayProvesCleanup",
      "serializedReplayProvesPhysicalContainment",
      "suppliedObservationProvesNativeOrigin",
      "historicalBootstrapRequirementAuthorizesV3Ready",
      "historicalBootstrapRequirementReinterpretsV3Ready",
    ],
  );
  assert.equal(
    Object.values(
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
    ).every((item) => item === false),
    true,
  );
  assert.equal(
    Object.values(
      preflight.CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4,
    ).every((item) => item === false),
    true,
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

  const sources = new Map([
    [
      "../src/candidate/containment-supervisor-v2.c",
      "756b6d730e78d72b9ce5c984f89ef6b9431f0376501f0c8e872c1f2601277e57",
    ],
    [
      "../src/candidate/containment-supervisor-attestation-v2.mjs",
      "851ca5be7f534a60523b5696d21f8302726e4a8772dfd7b53a506562649673dd",
    ],
    [
      "../src/candidate/containment-supervisor-bootstrap-v3.mjs",
      "f045a0830067f9e41d6532663754938d1cdeece4f088b732dac054ba9fe3efa5",
    ],
    [
      "../src/candidate/containment-supervisor-control-v2.mjs",
      "92cfae3b2e6b8e2ee196d7c5a21c760ae5d35d4f5335263a5ffc816fc2a80842",
    ],
    [
      "../src/candidate/containment-owner-v2.mjs",
      "ab6c185c51c14d91ae508b45152bad4f5c65712840626c518ba2ed084bded7e2",
    ],
    [
      "../src/candidate/sandbox-session-v2.mjs",
      "c0b6a282e7d6ba3605c2016e472c45826738edc9143d0d388238ac95fe07ab01",
    ],
  ]);
  for (const [relativePath, expected] of sources) {
    assert.equal(
      sha256(
        readFileSync(fileURLToPath(new URL(relativePath, import.meta.url))),
      ),
      expected,
      relativePath,
    );
  }
});
