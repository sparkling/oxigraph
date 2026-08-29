import { canonicalSha256 } from "../routing/features.mjs";
import { CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2 } from "./containment-launch-capsule-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
  verifyCandidateContainmentLaunchCapsuleV3,
} from "./containment-launch-capsule-v3.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_IDENTITY_SCHEMA_V1,
  createCandidateContainmentGuardianGenerationIdentityV1,
  verifyCandidateContainmentGuardianJournalRecordV1,
} from "./containment-guardian-journal-v1.mjs";
import {
  boundedInteger,
  canonicalJsonLine,
  copyBoundedBuffer,
  decodeCanonicalJsonLine,
  deepFreeze,
  exactDenseArray,
  exactDigest,
  exactRecord,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";

// Additive, authority-null protocol for the first executable supervisor
// preflight. This module is deliberately pure: it opens no descriptor, starts
// no process, writes no journal, and performs no containment mechanic. Its
// constructors only make exact test/replay frames; serialized frames never
// prove that a native supervisor produced or observed them.

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-start/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_PROJECTION_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-start-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-capsule/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_PROJECTION_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-capsule-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-control/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_PROJECTION_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-control-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-status/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REPLAY_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-requirements/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CANCEL_DECISION_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-cancel-decision/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_IMPLEMENTATION_CHECKPOINT_SCHEMA_V4 =
  "oxigraph.candidate-containment-supervisor-preflight-implementation-checkpoint/v1";

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_MAX_BYTES_V4 =
  8 * 1024;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_FRAME_MAX_BYTES_V4 =
  128 * 1024;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_MAX_BYTES_V4 =
  4 * 1024;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4 =
  8 * 1024;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_DIAGNOSTICS_MAX_BYTES_V4 = 16;

const emptySha256 = sha256(Buffer.alloc(0));
const cancelReasons = new Set([
  "caller-abort",
  "decision-timeout",
  "guardian-shutdown",
]);

function fail(message) {
  throw new Error(`candidate containment supervisor preflight v4: ${message}`);
}

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4 =
  deepFreeze(
    nullRecord([
      ["nativeObservationAuthority", false],
      ["guardianAuthority", false],
      ["supervisorAuthority", false],
      ["descriptorAuthority", false],
      ["filesystemDurabilityAuthority", false],
      ["reapAuthority", false],
      ["containmentExecutionAuthority", false],
      ["sandboxReportAuthority", false],
      ["applicationResultAuthority", false],
      ["applicationReceiptAuthority", false],
      ["runtimeRegistrationAuthority", false],
      ["qualificationAuthority", false],
      ["finalDecisionAuthority", false],
      ["promotionAuthority", false],
      ["publicationAuthority", false],
      ["productionContainment", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4 =
  deepFreeze(
    nullRecord([
      ["serializedReplayProvesFreshness", false],
      ["serializedReplayProvesFrameOrigin", false],
      ["serializedReplayProvesNativeSupervisorExecution", false],
      ["serializedReplayProvesSemanticCapsuleValidation", false],
      ["serializedReplayProvesCapsuleProjectionValidation", false],
      ["serializedReplayProvesRetainedFileContentIdentity", false],
      ["serializedReplayProvesExecutedSupervisorFdBinding", false],
      ["serializedReplayProvesInheritedDescriptorExactness", false],
      ["serializedReplayProvesGlobalSoleWriterOwnership", false],
      ["serializedReplayProvesGuardianLauncherWriterClosure", false],
      ["serializedReplayProvesDelegatedRootIdentity", false],
      ["serializedReplayProvesCgroupFilesystem", false],
      ["serializedReplayProvesCgroupConfiguration", false],
      ["serializedReplayProvesDecisionDurability", false],
      ["serializedReplayProvesDirectChildReap", false],
      ["serializedReplayProvesCleanup", false],
      ["serializedReplayProvesPhysicalContainment", false],
      ["suppliedObservationProvesNativeOrigin", false],
      ["historicalBootstrapRequirementAuthorizesV3Ready", false],
      ["historicalBootstrapRequirementReinterpretsV3Ready", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4 =
  deepFreeze(
    nullRecord([
      ["semanticLaunchCapsuleValidation", null],
      ["launchCapsuleProjectionValidation", null],
      ["retainedFileContentIdentity", null],
      ["executedSupervisorBoundToFd6", null],
      ["guardianLauncherStatusWriterCopiesClosed", null],
      ["delegatedRootIdentity", null],
      ["cgroupFilesystem", null],
      ["cgroupConfiguration", null],
      ["cgroupLimits", null],
      ["cgroupEmptiness", null],
      ["decisionDurability", null],
      ["directChildPidfdWaitidReap", null],
      ["cleanupOutcome", null],
      ["supervisorExecuted", null],
      ["supervisorReaped", null],
      ["supervisorExitStatus", null],
      ["childCreated", null],
      ["cleanupSafe", null],
      ["binding", null],
      ["physicalEligibility", false],
      ["finalDecisionEligibility", false],
      ["productionContainment", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_V4 =
  deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SCHEMA_V4,
      ],
      [
        "startSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_SCHEMA_V4,
      ],
      [
        "capsuleFrameSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_SCHEMA_V4,
      ],
      [
        "controlSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_SCHEMA_V4,
      ],
      [
        "statusSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_SCHEMA_V4,
      ],
      ["launchCapsuleSchema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V3],
      [
        "launchRequirementsSha256",
        CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
      ],
      [
        "fileDescriptorMapSha256",
        CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3,
      ],
      ["remapPlanSha256", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3],
      [
        "startMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_MAX_BYTES_V4,
      ],
      [
        "capsuleFrameMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_FRAME_MAX_BYTES_V4,
      ],
      [
        "capsuleRawMaximumBytes",
        CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
      ],
      [
        "controlMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_MAX_BYTES_V4,
      ],
      [
        "statusMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
      ],
      [
        "diagnosticsMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_DIAGNOSTICS_MAX_BYTES_V4,
      ],
      [
        "eventOrder",
        Object.freeze([
          "START",
          "CAPSULE",
          "PREFLIGHT_READY",
          "CANCEL",
          "CANCELLED_WITHOUT_CLONE",
          "SUPERVISOR_DONE",
        ]),
      ],
      ["capsuleTransport", "base64-canonical-jsonl-on-command-fd-0"],
      ["commandEofRequiredAfterCancel", true],
      ["trailingCommandBytesPermitted", false],
      ["statusEofRequiredAfterFinalStatus", true],
      ["successExitCode", 124],
      ["malformedOrUnsupportedExitCode", 125],
      ["descriptorOrIoFailureExitCode", 126],
      ["successDiagnosticsBytes", 0],
      ["descriptorsClosedBeforeReadyFrom", 18],
      ["supervisorDescriptorRangeStart", 0],
      ["supervisorDescriptorRangeEnd", 17],
      ["descriptorThreeSemantics", "opaque-read-only-directory-only"],
      [
        "generationIdentityBootstrapRequirementRole",
        "historical-predecessor-anchor-only",
      ],
      ["bootstrapReadyReinterpretationPermitted", false],
      ["retainedFileContentValidationRequired", false],
      ["semanticCapsuleValidationClaimPermitted", false],
      ["inheritedDescriptorExactnessClaimPermitted", false],
      ["globalSoleWriterClaimPermitted", false],
      ["commitAccepted", false],
      ["clonePermitted", false],
      ["candidateExecutionPermitted", false],
      ["journalWritePermitted", false],
      ["cgroupSemanticsPermitted", false],
      ["statusFramesCarryExactAuthority", true],
      ["statusFramesCarryExactPhysicalFacts", true],
      ["nativeMechanicsRequiredForExecutableEvidence", true],
      ["nativeProcessObservationRequiredForNativeOrigin", true],
      ["journalRecordRequiredForCancelDecisionBinding", true],
      ["filesystemJournalRequiredForDurabilityEvidence", true],
      ["guardianRequiredForDurableDecisionEvidence", true],
      ["pureReplayModulePerformsMechanics", false],
      ["applicationReceiptPermitted", false],
      ["runtimeRegistrationPermitted", false],
      ["qualificationPermitted", false],
      ["promotionPermitted", false],
      ["publicationPermitted", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4 =
  canonicalSha256(CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_V4);

// This checkpoint is intentionally not part of the wire requirements digest.
// It may advance additively as reviewed native artifacts arrive; the normative
// wire law above remains frozen.
export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_IMPLEMENTATION_CHECKPOINT_V4 =
  deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_IMPLEMENTATION_CHECKPOINT_SCHEMA_V4,
      ],
      ["pureProtocolImplemented", true],
      ["nativeSupervisorSourceImplemented", true],
      ["nativeAttestationImplemented", true],
      ["nativeExecutionFixtureImplemented", false],
      ["filesystemGuardianImplemented", false],
      [
        "bootstrapRequirementsAnchorSemantics",
        "opaque-historical-identity-component-not-authority",
      ],
      ["nativeObservation", null],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_READY_EVIDENCE_V4 =
  deepFreeze(
    nullRecord([
      ["canonicalStartAccepted", true],
      ["canonicalCapsuleEnvelopeAccepted", true],
      ["canonicalBase64Accepted", true],
      ["decodedCapsuleByteLengthMatched", true],
      ["decodedCapsuleRawSha256Matched", true],
      ["launchCapsuleHeaderBindingsMatched", true],
      ["descriptorsZeroThroughSeventeenStructurallyChecked", true],
      ["descriptorsEighteenAndAboveClosedBeforeReady", true],
      ["descriptorAccessModesMatched", true],
      ["descriptorKindsMatched", true],
      ["descriptorNonaliasInSupervisorTable", true],
      ["statusWriterUniqueInSupervisorTable", true],
      ["semanticLaunchCapsuleValidation", null],
      ["launchCapsuleProjectionValidation", null],
      ["retainedFileContentIdentity", null],
      ["executedSupervisorBoundToFd6", null],
      ["guardianLauncherStatusWriterCopiesClosed", null],
      ["delegatedRootIdentity", null],
      ["cgroupFilesystem", null],
      ["cgroupConfiguration", null],
      ["cgroupLimits", null],
      ["cgroupEmptiness", null],
      ["decisionDurability", null],
      ["directChildPidfdWaitidReap", null],
      ["cleanupOutcome", null],
      ["cleanupSafe", null],
      ["binding", null],
      ["physicalEligibility", false],
      ["finalDecisionEligibility", false],
    ]),
  );

const identityInputFields = Object.freeze([
  "requestSha256",
  "ownerRequestSha256",
  "limitsSha256",
  "delegatedRootIdentitySha256",
  "launchCapsuleRawSha256",
  "launchCapsuleProjectionSha256",
  "bootstrapRequirementsSha256",
  "launchRequirementsSha256",
  "supervisorExecutableIdentitySha256",
  "birthGuardianEpochSha256",
  "bootIdSha256",
  "admissionGenerationSha256",
  "launchNonceSha256",
]);
const identityFields = Object.freeze([
  "schema",
  ...identityInputFields,
  "controlGenerationSha256",
  "jobGenerationSha256",
  "guardianCgroupName",
  "controlCgroupName",
  "jobCgroupName",
  "identitySha256",
]);

function normalizeGenerationIdentity(value, label) {
  const record = exactRecord(value, identityFields, label, fail);
  if (
    record.schema !==
    CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_IDENTITY_SCHEMA_V1
  ) {
    fail(`${label}.schema changed`);
  }
  for (const field of [
    ...identityInputFields,
    "controlGenerationSha256",
    "jobGenerationSha256",
    "identitySha256",
  ]) {
    exactDigest(record[field], `${label}.${field}`, fail);
  }
  const recreated = createCandidateContainmentGuardianGenerationIdentityV1(
    nullRecord(identityInputFields.map((field) => [field, record[field]])),
  );
  for (const field of identityFields) {
    if (record[field] !== recreated[field]) fail(`${label}.${field} changed`);
  }
  return recreated;
}

function artifact(name, bytes) {
  return deepFreeze(
    nullRecord([
      ["name", name],
      ["bytes", bytes.length],
      ["sha256", sha256(bytes)],
    ]),
  );
}

function strictBase64(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length >
      Math.ceil(CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2 / 3) * 4 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    fail(`${label} is not bounded canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail(`${label} is not canonical base64`);
  }
  return bytes;
}

export function candidateContainmentSupervisorPreflightLaunchCapsuleProjectionSha256V4(
  launchCapsuleBytes,
) {
  const retained = copyBoundedBuffer(
    launchCapsuleBytes,
    "launch capsule bytes",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    },
    fail,
  );
  return verifyCandidateContainmentLaunchCapsuleV3(retained).projectionSha256;
}

const startBodyFields = Object.freeze([
  "schema",
  "commandSequence",
  "action",
  "generationIdentity",
  "generationIdentitySha256",
  "requestSha256",
  "ownerRequestSha256",
  "admissionGenerationSha256",
  "birthGuardianEpochSha256",
  "actorGuardianEpochSha256",
  "launchNonceSha256",
  "controlGenerationSha256",
  "jobGenerationSha256",
  "supervisorLaunchIntentRecordRawSha256",
  "intendedSupervisorExecutableIdentitySha256",
  "launchCapsuleByteLength",
  "launchCapsuleRawSha256",
  "launchCapsuleProjectionSha256",
  "launchRequirementsSha256",
  "fileDescriptorMapSha256",
  "remapPlanSha256",
  "preflightRequirementsSha256",
]);

function parseStart(bytesValue) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "START bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_MAX_BYTES_V4,
    fail,
  );
  const body = exactRecord(decoded.value, startBodyFields, "START body", fail);
  const generationIdentity = normalizeGenerationIdentity(
    body.generationIdentity,
    "START.generationIdentity",
  );
  for (const field of startBodyFields.filter((field) =>
    field.endsWith("Sha256"),
  )) {
    exactDigest(body[field], `START.${field}`, fail);
  }
  const launchCapsuleByteLength = boundedInteger(
    body.launchCapsuleByteLength,
    "START.launchCapsuleByteLength",
    2,
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    fail,
  );
  // generationIdentity.bootstrapRequirementsSha256 is intentionally an opaque
  // historical predecessor component. Re-deriving the complete generation
  // identity binds its exact bytes, but neither this parser nor the native
  // successor equates it with a current READY requirement or authority grant.
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_SCHEMA_V4 ||
    body.commandSequence !== 0 ||
    body.action !== "START" ||
    body.generationIdentitySha256 !== generationIdentity.identitySha256 ||
    body.requestSha256 !== generationIdentity.requestSha256 ||
    body.ownerRequestSha256 !== generationIdentity.ownerRequestSha256 ||
    body.admissionGenerationSha256 !==
      generationIdentity.admissionGenerationSha256 ||
    body.birthGuardianEpochSha256 !==
      generationIdentity.birthGuardianEpochSha256 ||
    body.launchNonceSha256 !== generationIdentity.launchNonceSha256 ||
    body.controlGenerationSha256 !==
      generationIdentity.controlGenerationSha256 ||
    body.jobGenerationSha256 !== generationIdentity.jobGenerationSha256 ||
    body.intendedSupervisorExecutableIdentitySha256 !==
      generationIdentity.supervisorExecutableIdentitySha256 ||
    body.launchCapsuleRawSha256 !== generationIdentity.launchCapsuleRawSha256 ||
    body.launchCapsuleProjectionSha256 !==
      generationIdentity.launchCapsuleProjectionSha256 ||
    body.launchRequirementsSha256 !==
      generationIdentity.launchRequirementsSha256 ||
    body.actorGuardianEpochSha256 !== body.birthGuardianEpochSha256 ||
    body.launchRequirementsSha256 !==
      CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3 ||
    body.fileDescriptorMapSha256 !==
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3 ||
    body.remapPlanSha256 !==
      CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3 ||
    body.preflightRequirementsSha256 !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4
  ) {
    fail("START schema, actor, or requirements binding changed");
  }
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_PROJECTION_SCHEMA_V4,
      ],
      ["protocolSchema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["generationIdentity", generationIdentity],
      ...startBodyFields
        .filter((field) => !["schema", "generationIdentity"].includes(field))
        .map((field) => [
          field,
          field === "launchCapsuleByteLength"
            ? launchCapsuleByteLength
            : body[field],
        ]),
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4],
    ]),
  );
}

export function createCandidateContainmentSupervisorPreflightStartV4(value) {
  const input = exactRecord(
    value,
    [
      "generationIdentity",
      "actorGuardianEpochSha256",
      "supervisorLaunchIntentRecordRawSha256",
      "launchCapsuleBytes",
    ],
    "START input",
    fail,
  );
  const identity = normalizeGenerationIdentity(
    input.generationIdentity,
    "START input.generationIdentity",
  );
  const actorGuardianEpochSha256 = exactDigest(
    input.actorGuardianEpochSha256,
    "START input.actorGuardianEpochSha256",
    fail,
  );
  const supervisorLaunchIntentRecordRawSha256 = exactDigest(
    input.supervisorLaunchIntentRecordRawSha256,
    "START input.supervisorLaunchIntentRecordRawSha256",
    fail,
  );
  const launchCapsuleBytes = copyBoundedBuffer(
    input.launchCapsuleBytes,
    "START input.launchCapsuleBytes",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    },
    fail,
  );
  const capsule = verifyCandidateContainmentLaunchCapsuleV3(launchCapsuleBytes);
  if (
    actorGuardianEpochSha256 !== identity.birthGuardianEpochSha256 ||
    capsule.requestSha256 !== identity.requestSha256 ||
    capsule.generationSha256 !== identity.admissionGenerationSha256 ||
    capsule.rawSha256 !== identity.launchCapsuleRawSha256 ||
    capsule.projectionSha256 !== identity.launchCapsuleProjectionSha256 ||
    capsule.requirementsSha256 !== identity.launchRequirementsSha256 ||
    capsule.fileDescriptorMapSha256 !==
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3 ||
    capsule.remapPlanSha256 !==
      CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3
  ) {
    fail("START generation identity does not match the launch capsule");
  }
  const body = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_SCHEMA_V4],
    ["commandSequence", 0],
    ["action", "START"],
    ["generationIdentity", identity],
    ["generationIdentitySha256", identity.identitySha256],
    ["requestSha256", identity.requestSha256],
    ["ownerRequestSha256", identity.ownerRequestSha256],
    ["admissionGenerationSha256", identity.admissionGenerationSha256],
    ["birthGuardianEpochSha256", identity.birthGuardianEpochSha256],
    ["actorGuardianEpochSha256", actorGuardianEpochSha256],
    ["launchNonceSha256", identity.launchNonceSha256],
    ["controlGenerationSha256", identity.controlGenerationSha256],
    ["jobGenerationSha256", identity.jobGenerationSha256],
    [
      "supervisorLaunchIntentRecordRawSha256",
      supervisorLaunchIntentRecordRawSha256,
    ],
    [
      "intendedSupervisorExecutableIdentitySha256",
      identity.supervisorExecutableIdentitySha256,
    ],
    ["launchCapsuleByteLength", launchCapsuleBytes.length],
    ["launchCapsuleRawSha256", capsule.rawSha256],
    ["launchCapsuleProjectionSha256", capsule.projectionSha256],
    [
      "launchRequirementsSha256",
      CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
    ],
    [
      "fileDescriptorMapSha256",
      CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V3,
    ],
    ["remapPlanSha256", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V3],
    [
      "preflightRequirementsSha256",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_SHA256_V4,
    ],
  ]);
  const bytes = canonicalJsonLine(body);
  if (
    bytes.length > CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_START_MAX_BYTES_V4
  ) {
    fail("START exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact(
        "candidate-containment-supervisor-preflight-start-v1.jsonl",
        bytes,
      ),
    ],
  ]);
}

export function verifyCandidateContainmentSupervisorPreflightStartV4(
  bytesValue,
) {
  return parseStart(bytesValue);
}

const capsuleBodyFields = Object.freeze([
  "schema",
  "commandSequence",
  "action",
  "startRawSha256",
  "generationIdentitySha256",
  "requestSha256",
  "ownerRequestSha256",
  "admissionGenerationSha256",
  "birthGuardianEpochSha256",
  "actorGuardianEpochSha256",
  "launchNonceSha256",
  "supervisorLaunchIntentRecordRawSha256",
  "intendedSupervisorExecutableIdentitySha256",
  "launchCapsuleBase64",
  "launchCapsuleByteLength",
  "launchCapsuleRawSha256",
  "launchCapsuleProjectionSha256",
  "launchRequirementsSha256",
  "fileDescriptorMapSha256",
  "remapPlanSha256",
  "preflightRequirementsSha256",
]);

function capsuleBody(start, launchCapsuleBytes, capsule) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_SCHEMA_V4],
    ["commandSequence", 1],
    ["action", "CAPSULE"],
    ["startRawSha256", start.rawSha256],
    ["generationIdentitySha256", start.generationIdentitySha256],
    ["requestSha256", start.requestSha256],
    ["ownerRequestSha256", start.ownerRequestSha256],
    ["admissionGenerationSha256", start.admissionGenerationSha256],
    ["birthGuardianEpochSha256", start.birthGuardianEpochSha256],
    ["actorGuardianEpochSha256", start.actorGuardianEpochSha256],
    ["launchNonceSha256", start.launchNonceSha256],
    [
      "supervisorLaunchIntentRecordRawSha256",
      start.supervisorLaunchIntentRecordRawSha256,
    ],
    [
      "intendedSupervisorExecutableIdentitySha256",
      start.intendedSupervisorExecutableIdentitySha256,
    ],
    ["launchCapsuleBase64", launchCapsuleBytes.toString("base64")],
    ["launchCapsuleByteLength", launchCapsuleBytes.length],
    ["launchCapsuleRawSha256", capsule.rawSha256],
    ["launchCapsuleProjectionSha256", capsule.projectionSha256],
    ["launchRequirementsSha256", start.launchRequirementsSha256],
    ["fileDescriptorMapSha256", start.fileDescriptorMapSha256],
    ["remapPlanSha256", start.remapPlanSha256],
    ["preflightRequirementsSha256", start.preflightRequirementsSha256],
  ]);
}

export function createCandidateContainmentSupervisorPreflightCapsuleFrameV4(
  value,
) {
  const input = exactRecord(
    value,
    ["startBytes", "launchCapsuleBytes"],
    "CAPSULE input",
    fail,
  );
  const start = parseStart(input.startBytes);
  const launchCapsuleBytes = copyBoundedBuffer(
    input.launchCapsuleBytes,
    "CAPSULE input.launchCapsuleBytes",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    },
    fail,
  );
  const capsule = verifyCandidateContainmentLaunchCapsuleV3(launchCapsuleBytes);
  if (
    capsule.requestSha256 !== start.requestSha256 ||
    capsule.generationSha256 !== start.admissionGenerationSha256 ||
    capsule.rawSha256 !== start.launchCapsuleRawSha256 ||
    capsule.projectionSha256 !== start.launchCapsuleProjectionSha256 ||
    launchCapsuleBytes.length !== start.launchCapsuleByteLength
  ) {
    fail("CAPSULE does not match START");
  }
  const bytes = canonicalJsonLine(
    capsuleBody(start, launchCapsuleBytes, capsule),
  );
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_FRAME_MAX_BYTES_V4
  ) {
    fail("CAPSULE exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact(
        "candidate-containment-supervisor-preflight-capsule-v1.jsonl",
        bytes,
      ),
    ],
  ]);
}

export function verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4(
  value,
) {
  const input = exactRecord(
    value,
    ["startBytes", "capsuleFrameBytes"],
    "CAPSULE replay input",
    fail,
  );
  const start = parseStart(input.startBytes);
  const decoded = decodeCanonicalJsonLine(
    input.capsuleFrameBytes,
    "CAPSULE bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_FRAME_MAX_BYTES_V4,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    capsuleBodyFields,
    "CAPSULE body",
    fail,
  );
  const launchCapsuleBytes = strictBase64(
    body.launchCapsuleBase64,
    "CAPSULE payload",
  );
  const capsule = verifyCandidateContainmentLaunchCapsuleV3(launchCapsuleBytes);
  const launchCapsuleByteLength = boundedInteger(
    body.launchCapsuleByteLength,
    "CAPSULE.launchCapsuleByteLength",
    2,
    CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    fail,
  );
  const matches = [
    [body.startRawSha256, start.rawSha256],
    [body.generationIdentitySha256, start.generationIdentitySha256],
    [body.requestSha256, start.requestSha256],
    [body.ownerRequestSha256, start.ownerRequestSha256],
    [body.admissionGenerationSha256, start.admissionGenerationSha256],
    [body.birthGuardianEpochSha256, start.birthGuardianEpochSha256],
    [body.actorGuardianEpochSha256, start.actorGuardianEpochSha256],
    [body.launchNonceSha256, start.launchNonceSha256],
    [
      body.supervisorLaunchIntentRecordRawSha256,
      start.supervisorLaunchIntentRecordRawSha256,
    ],
    [
      body.intendedSupervisorExecutableIdentitySha256,
      start.intendedSupervisorExecutableIdentitySha256,
    ],
    [body.launchCapsuleRawSha256, start.launchCapsuleRawSha256],
    [body.launchCapsuleProjectionSha256, start.launchCapsuleProjectionSha256],
    [body.launchRequirementsSha256, start.launchRequirementsSha256],
    [body.fileDescriptorMapSha256, start.fileDescriptorMapSha256],
    [body.remapPlanSha256, start.remapPlanSha256],
    [body.preflightRequirementsSha256, start.preflightRequirementsSha256],
    [capsule.requestSha256, start.requestSha256],
    [capsule.generationSha256, start.admissionGenerationSha256],
    [capsule.rawSha256, start.launchCapsuleRawSha256],
    [capsule.projectionSha256, start.launchCapsuleProjectionSha256],
  ];
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_SCHEMA_V4 ||
    body.commandSequence !== 1 ||
    body.action !== "CAPSULE" ||
    launchCapsuleByteLength !== launchCapsuleBytes.length ||
    matches.some(([actual, expected]) => actual !== expected)
  ) {
    fail("CAPSULE identity changed");
  }
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CAPSULE_PROJECTION_SCHEMA_V4,
      ],
      ["protocolSchema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["commandSequence", 1],
      ["action", "CAPSULE"],
      ...capsuleBodyFields
        .filter(
          (field) =>
            ![
              "schema",
              "commandSequence",
              "action",
              "launchCapsuleBase64",
            ].includes(field),
        )
        .map((field) => [field, body[field]]),
      ["launchCapsule", capsule],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4],
    ]),
  );
}

const commonStatusFields = Object.freeze([
  "schema",
  "statusSequence",
  "state",
  "startRawSha256",
  "capsuleFrameRawSha256",
  "generationIdentitySha256",
  "requestSha256",
  "ownerRequestSha256",
  "admissionGenerationSha256",
  "birthGuardianEpochSha256",
  "actorGuardianEpochSha256",
  "launchNonceSha256",
  "intendedSupervisorExecutableIdentitySha256",
  "preflightRequirementsSha256",
  "decisionRawSha256",
]);

function statusCommon(start, capsuleFrame, sequence, state, decisionRawSha256) {
  return [
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_SCHEMA_V4],
    ["statusSequence", sequence],
    ["state", state],
    ["startRawSha256", start.rawSha256],
    ["capsuleFrameRawSha256", capsuleFrame.rawSha256],
    ["generationIdentitySha256", start.generationIdentitySha256],
    ["requestSha256", start.requestSha256],
    ["ownerRequestSha256", start.ownerRequestSha256],
    ["admissionGenerationSha256", start.admissionGenerationSha256],
    ["birthGuardianEpochSha256", start.birthGuardianEpochSha256],
    ["actorGuardianEpochSha256", start.actorGuardianEpochSha256],
    ["launchNonceSha256", start.launchNonceSha256],
    [
      "intendedSupervisorExecutableIdentitySha256",
      start.intendedSupervisorExecutableIdentitySha256,
    ],
    ["preflightRequirementsSha256", start.preflightRequirementsSha256],
    ["decisionRawSha256", decisionRawSha256],
  ];
}

function verifyCommonStatus(
  body,
  start,
  capsuleFrame,
  sequence,
  state,
  decisionRawSha256,
) {
  const expected = nullRecord(
    statusCommon(start, capsuleFrame, sequence, state, decisionRawSha256),
  );
  for (const field of commonStatusFields) {
    if (body[field] !== expected[field]) fail(`${state}.${field} changed`);
  }
}

function exactConstantRecord(value, expected, label) {
  const fields = Object.keys(expected);
  const record = exactRecord(value, fields, label, fail);
  for (const field of fields) {
    if (record[field] !== expected[field]) fail(`${label}.${field} changed`);
  }
  return deepFreeze(record);
}

function verifyReady(bytesValue, start, capsuleFrame) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "PREFLIGHT_READY bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      ...commonStatusFields,
      "evidence",
      "physicalFacts",
      "authority",
      "nonclaims",
    ],
    "PREFLIGHT_READY body",
    fail,
  );
  verifyCommonStatus(body, start, capsuleFrame, 0, "PREFLIGHT_READY", null);
  const evidence = exactConstantRecord(
    body.evidence,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_READY_EVIDENCE_V4,
    "PREFLIGHT_READY evidence",
  );
  const physicalFacts = exactConstantRecord(
    body.physicalFacts,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
    "PREFLIGHT_READY physicalFacts",
  );
  const authority = exactConstantRecord(
    body.authority,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
    "PREFLIGHT_READY authority",
  );
  const nonclaims = exactConstantRecord(
    body.nonclaims,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4,
    "PREFLIGHT_READY nonclaims",
  );
  const unsigned = nullRecord([
    ["schema", body.schema],
    ["byteLength", decoded.bytes.length],
    ["rawSha256", sha256(decoded.bytes)],
    ["statusSequence", 0],
    ["state", "PREFLIGHT_READY"],
    ["startRawSha256", body.startRawSha256],
    ["capsuleFrameRawSha256", body.capsuleFrameRawSha256],
    ["decisionRawSha256", null],
    ["preflightRequirementsSha256", body.preflightRequirementsSha256],
    ["reportedEvidence", evidence],
    ["nativeObservation", null],
    ["physicalFacts", physicalFacts],
    ["binding", null],
    ["physicalEligibility", false],
    ["authority", authority],
    ["nonclaims", nonclaims],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}

export function createCandidateContainmentSupervisorPreflightReadyV4(value) {
  const input = exactRecord(
    value,
    ["startBytes", "capsuleFrameBytes"],
    "PREFLIGHT_READY input",
    fail,
  );
  const start = parseStart(input.startBytes);
  const capsuleFrame =
    verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: input.startBytes,
      capsuleFrameBytes: input.capsuleFrameBytes,
    });
  const body = nullRecord([
    ...statusCommon(start, capsuleFrame, 0, "PREFLIGHT_READY", null),
    ["evidence", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_READY_EVIDENCE_V4],
    [
      "physicalFacts",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
    ],
    ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4],
    ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4],
  ]);
  const bytes = canonicalJsonLine(body);
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4
  ) {
    fail("PREFLIGHT_READY exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact(
        "candidate-containment-supervisor-preflight-ready-v1.jsonl",
        bytes,
      ),
    ],
  ]);
}

export function verifyCandidateContainmentSupervisorPreflightReadyV4(value) {
  const input = exactRecord(
    value,
    ["startBytes", "capsuleFrameBytes", "readyBytes"],
    "PREFLIGHT_READY replay input",
    fail,
  );
  const start = parseStart(input.startBytes);
  const capsuleFrame =
    verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: input.startBytes,
      capsuleFrameBytes: input.capsuleFrameBytes,
    });
  return verifyReady(input.readyBytes, start, capsuleFrame);
}

const cancelDecisionFields = Object.freeze([
  "schema",
  "action",
  "reason",
  "startRawSha256",
  "capsuleFrameRawSha256",
  "preflightReadyRawSha256",
  "generationIdentitySha256",
  "requestSha256",
  "ownerRequestSha256",
  "admissionGenerationSha256",
  "birthGuardianEpochSha256",
  "actorGuardianEpochSha256",
  "launchNonceSha256",
  "preflightRequirementsSha256",
  "projectionSha256",
]);

function cancelDecisionUnsigned(start, capsuleFrame, ready, reason) {
  return nullRecord([
    [
      "schema",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CANCEL_DECISION_SCHEMA_V4,
    ],
    ["action", "CANCEL"],
    ["reason", reason],
    ["startRawSha256", start.rawSha256],
    ["capsuleFrameRawSha256", capsuleFrame.rawSha256],
    ["preflightReadyRawSha256", ready.rawSha256],
    ["generationIdentitySha256", start.generationIdentitySha256],
    ["requestSha256", start.requestSha256],
    ["ownerRequestSha256", start.ownerRequestSha256],
    ["admissionGenerationSha256", start.admissionGenerationSha256],
    ["birthGuardianEpochSha256", start.birthGuardianEpochSha256],
    ["actorGuardianEpochSha256", start.actorGuardianEpochSha256],
    ["launchNonceSha256", start.launchNonceSha256],
    ["preflightRequirementsSha256", start.preflightRequirementsSha256],
  ]);
}

function buildCancelDecision(start, capsuleFrame, ready, reason) {
  if (typeof reason !== "string" || !cancelReasons.has(reason)) {
    fail("cancel decision reason changed");
  }
  const unsigned = cancelDecisionUnsigned(start, capsuleFrame, ready, reason);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}

function normalizeCancelDecision(value, start, capsuleFrame, ready, label) {
  const record = exactRecord(value, cancelDecisionFields, label, fail);
  exactDigest(record.projectionSha256, `${label}.projectionSha256`, fail);
  const expected = buildCancelDecision(
    start,
    capsuleFrame,
    ready,
    record.reason,
  );
  for (const field of cancelDecisionFields) {
    if (record[field] !== expected[field]) fail(`${label}.${field} changed`);
  }
  return expected;
}

export function createCandidateContainmentSupervisorPreflightCancelDecisionV4(
  value,
) {
  const input = exactRecord(
    value,
    ["startBytes", "capsuleFrameBytes", "readyBytes", "reason"],
    "cancel decision input",
    fail,
  );
  const start = parseStart(input.startBytes);
  const capsuleFrame =
    verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: input.startBytes,
      capsuleFrameBytes: input.capsuleFrameBytes,
    });
  const ready = verifyReady(input.readyBytes, start, capsuleFrame);
  return buildCancelDecision(start, capsuleFrame, ready, input.reason);
}

function normalizeDecisionJournalRecord(
  value,
  start,
  ready,
  cancelDecision,
  label,
) {
  const reference = exactRecord(value, ["name", "bytes"], label, fail);
  let record;
  try {
    record = verifyCandidateContainmentGuardianJournalRecordV1(reference);
  } catch {
    fail(`${label} is not an exact guardian journal record`);
  }
  if (
    record.sequence !== "0000000000000008" ||
    record.recordType !== "DECISION_CANCEL_DURABLE" ||
    record.priorState !== "PREFLIGHT_READY_OBSERVED" ||
    record.nextState !== "DECISION_CANCEL_DURABLE" ||
    record.generationIdentity.identitySha256 !==
      start.generationIdentitySha256 ||
    record.actorGuardianEpochSha256 !== start.birthGuardianEpochSha256 ||
    record.operation.reportedProjectionSha256 !==
      cancelDecision.projectionSha256 ||
    record.evidence.reportedProjectionSha256 !== ready.projectionSha256
  ) {
    fail(`${label} does not bind the exact durable cancel decision`);
  }
  return record;
}

const controlFields = Object.freeze([
  "schema",
  "commandSequence",
  "action",
  "reason",
  "startRawSha256",
  "capsuleFrameRawSha256",
  "preflightReadyRawSha256",
  "cancelDecision",
  "cancelDecisionProjectionSha256",
  "decisionJournalRecordRawSha256",
  "generationIdentitySha256",
  "requestSha256",
  "ownerRequestSha256",
  "admissionGenerationSha256",
  "birthGuardianEpochSha256",
  "actorGuardianEpochSha256",
  "launchNonceSha256",
  "preflightRequirementsSha256",
]);

export function createCandidateContainmentSupervisorPreflightCancelV4(value) {
  const input = exactRecord(
    value,
    [
      "startBytes",
      "capsuleFrameBytes",
      "readyBytes",
      "cancelDecision",
      "decisionJournalRecord",
    ],
    "CANCEL input",
    fail,
  );
  const start = parseStart(input.startBytes);
  const capsuleFrame =
    verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: input.startBytes,
      capsuleFrameBytes: input.capsuleFrameBytes,
    });
  const ready = verifyReady(input.readyBytes, start, capsuleFrame);
  const cancelDecision = normalizeCancelDecision(
    input.cancelDecision,
    start,
    capsuleFrame,
    ready,
    "CANCEL input.cancelDecision",
  );
  const decisionJournalRecord = normalizeDecisionJournalRecord(
    input.decisionJournalRecord,
    start,
    ready,
    cancelDecision,
    "CANCEL input.decisionJournalRecord",
  );
  const body = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_SCHEMA_V4],
    ["commandSequence", 2],
    ["action", "CANCEL"],
    ["reason", cancelDecision.reason],
    ["startRawSha256", start.rawSha256],
    ["capsuleFrameRawSha256", capsuleFrame.rawSha256],
    ["preflightReadyRawSha256", ready.rawSha256],
    ["cancelDecision", cancelDecision],
    ["cancelDecisionProjectionSha256", cancelDecision.projectionSha256],
    ["decisionJournalRecordRawSha256", decisionJournalRecord.rawSha256],
    ["generationIdentitySha256", start.generationIdentitySha256],
    ["requestSha256", start.requestSha256],
    ["ownerRequestSha256", start.ownerRequestSha256],
    ["admissionGenerationSha256", start.admissionGenerationSha256],
    ["birthGuardianEpochSha256", start.birthGuardianEpochSha256],
    ["actorGuardianEpochSha256", start.actorGuardianEpochSha256],
    ["launchNonceSha256", start.launchNonceSha256],
    ["preflightRequirementsSha256", start.preflightRequirementsSha256],
  ]);
  const bytes = canonicalJsonLine(body);
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_MAX_BYTES_V4
  ) {
    fail("CANCEL exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact(
        "candidate-containment-supervisor-preflight-cancel-v1.jsonl",
        bytes,
      ),
    ],
  ]);
}

function verifyCancel(bytesValue, start, capsuleFrame, ready) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "CANCEL bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_MAX_BYTES_V4,
    fail,
  );
  const body = exactRecord(decoded.value, controlFields, "CANCEL body", fail);
  for (const field of controlFields.filter((field) =>
    field.endsWith("Sha256"),
  )) {
    exactDigest(body[field], `CANCEL.${field}`, fail);
  }
  const cancelDecision = normalizeCancelDecision(
    body.cancelDecision,
    start,
    capsuleFrame,
    ready,
    "CANCEL.cancelDecision",
  );
  const matches = [
    [body.startRawSha256, start.rawSha256],
    [body.capsuleFrameRawSha256, capsuleFrame.rawSha256],
    [body.preflightReadyRawSha256, ready.rawSha256],
    [body.cancelDecisionProjectionSha256, cancelDecision.projectionSha256],
    [body.generationIdentitySha256, start.generationIdentitySha256],
    [body.requestSha256, start.requestSha256],
    [body.ownerRequestSha256, start.ownerRequestSha256],
    [body.admissionGenerationSha256, start.admissionGenerationSha256],
    [body.birthGuardianEpochSha256, start.birthGuardianEpochSha256],
    [body.actorGuardianEpochSha256, start.actorGuardianEpochSha256],
    [body.launchNonceSha256, start.launchNonceSha256],
    [body.preflightRequirementsSha256, start.preflightRequirementsSha256],
  ];
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_SCHEMA_V4 ||
    body.commandSequence !== 2 ||
    body.action !== "CANCEL" ||
    body.reason !== cancelDecision.reason ||
    matches.some(([actual, expected]) => actual !== expected)
  ) {
    fail("CANCEL identity changed");
  }
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_CONTROL_PROJECTION_SCHEMA_V4,
      ],
      ["protocolSchema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["commandSequence", 2],
      ["action", "CANCEL"],
      ["reason", body.reason],
      ["startRawSha256", body.startRawSha256],
      ["capsuleFrameRawSha256", body.capsuleFrameRawSha256],
      ["preflightReadyRawSha256", body.preflightReadyRawSha256],
      ["cancelDecision", cancelDecision],
      ["cancelDecisionProjectionSha256", body.cancelDecisionProjectionSha256],
      ["decisionJournalRecordRawSha256", body.decisionJournalRecordRawSha256],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4],
    ]),
  );
}

const cancelledEvidence = deepFreeze(
  nullRecord([
    ["cloneCommitStarted", false],
    ["childCreated", false],
    ["pidfdCreated", false],
    ["retainedDescriptorsClosed", true],
    ["decisionDurability", null],
    ["guardianCleanupRequired", true],
    ["guardianCleanupObservedBySupervisor", null],
  ]),
);
const doneEvidence = deepFreeze(
  nullRecord([
    ["childCreated", false],
    ["statusFrameIsFinal", true],
    ["statusWriteClosureObservedBySupervisor", null],
    ["guardianCleanupObservedBySupervisor", null],
  ]),
);

const terminalFields = Object.freeze([
  ...commonStatusFields,
  "decisionJournalRecordRawSha256",
  "previousStatusRawSha256",
  "evidence",
  "physicalFacts",
  "authority",
  "nonclaims",
]);

function terminalBody(
  start,
  capsuleFrame,
  cancel,
  state,
  sequence,
  previousStatusRawSha256,
  evidence,
) {
  return nullRecord([
    ...statusCommon(start, capsuleFrame, sequence, state, cancel.rawSha256),
    ["decisionJournalRecordRawSha256", cancel.decisionJournalRecordRawSha256],
    ["previousStatusRawSha256", previousStatusRawSha256],
    ["evidence", evidence],
    [
      "physicalFacts",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
    ],
    ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4],
    ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4],
  ]);
}

function verifyTerminal(
  bytesValue,
  state,
  sequence,
  context,
  previousStatusRawSha256,
  expectedEvidence,
) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    `${state} bytes`,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    terminalFields,
    `${state} body`,
    fail,
  );
  verifyCommonStatus(
    body,
    context.start,
    context.capsuleFrame,
    sequence,
    state,
    context.cancel.rawSha256,
  );
  exactDigest(
    body.decisionJournalRecordRawSha256,
    `${state}.decisionJournalRecordRawSha256`,
    fail,
  );
  exactDigest(
    body.previousStatusRawSha256,
    `${state}.previousStatusRawSha256`,
    fail,
  );
  if (
    body.decisionJournalRecordRawSha256 !==
      context.cancel.decisionJournalRecordRawSha256 ||
    body.previousStatusRawSha256 !== previousStatusRawSha256
  ) {
    fail(`${state} decision or previous-status binding changed`);
  }
  const evidence = exactConstantRecord(
    body.evidence,
    expectedEvidence,
    `${state} evidence`,
  );
  const physicalFacts = exactConstantRecord(
    body.physicalFacts,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
    `${state} physicalFacts`,
  );
  const authority = exactConstantRecord(
    body.authority,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4,
    `${state} authority`,
  );
  const nonclaims = exactConstantRecord(
    body.nonclaims,
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4,
    `${state} nonclaims`,
  );
  const unsigned = nullRecord([
    ["schema", body.schema],
    ["byteLength", decoded.bytes.length],
    ["rawSha256", sha256(decoded.bytes)],
    ["statusSequence", sequence],
    ["state", state],
    ["startRawSha256", body.startRawSha256],
    ["capsuleFrameRawSha256", body.capsuleFrameRawSha256],
    ["decisionRawSha256", body.decisionRawSha256],
    ["decisionJournalRecordRawSha256", body.decisionJournalRecordRawSha256],
    ["previousStatusRawSha256", body.previousStatusRawSha256],
    ["preflightRequirementsSha256", body.preflightRequirementsSha256],
    ["reportedEvidence", evidence],
    ["nativeObservation", null],
    ["physicalFacts", physicalFacts],
    ["binding", null],
    ["physicalEligibility", false],
    ["authority", authority],
    ["nonclaims", nonclaims],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}

function replayContext(value, label) {
  const input = exactRecord(
    value,
    [
      "startBytes",
      "capsuleFrameBytes",
      "readyBytes",
      "cancelBytes",
      "decisionJournalRecord",
    ],
    label,
    fail,
  );
  const start = parseStart(input.startBytes);
  const capsuleFrame =
    verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: input.startBytes,
      capsuleFrameBytes: input.capsuleFrameBytes,
    });
  const ready = verifyReady(input.readyBytes, start, capsuleFrame);
  const cancel = verifyCancel(input.cancelBytes, start, capsuleFrame, ready);
  const decisionJournalRecord = normalizeDecisionJournalRecord(
    input.decisionJournalRecord,
    start,
    ready,
    cancel.cancelDecision,
    `${label}.decisionJournalRecord`,
  );
  if (
    decisionJournalRecord.rawSha256 !== cancel.decisionJournalRecordRawSha256
  ) {
    fail(`${label}.decisionJournalRecord raw binding changed`);
  }
  return { input, start, capsuleFrame, ready, cancel, decisionJournalRecord };
}

export function createCandidateContainmentSupervisorPreflightCancelledV4(
  value,
) {
  const context = replayContext(value, "CANCELLED_WITHOUT_CLONE input");
  const bytes = canonicalJsonLine(
    terminalBody(
      context.start,
      context.capsuleFrame,
      context.cancel,
      "CANCELLED_WITHOUT_CLONE",
      1,
      context.ready.rawSha256,
      cancelledEvidence,
    ),
  );
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4
  ) {
    fail("CANCELLED_WITHOUT_CLONE exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact(
        "candidate-containment-supervisor-preflight-cancelled-v1.jsonl",
        bytes,
      ),
    ],
  ]);
}

export function createCandidateContainmentSupervisorPreflightDoneV4(value) {
  const input = exactRecord(
    value,
    [
      "startBytes",
      "capsuleFrameBytes",
      "readyBytes",
      "cancelBytes",
      "cancelledBytes",
      "decisionJournalRecord",
    ],
    "SUPERVISOR_DONE input",
    fail,
  );
  const context = replayContext(
    nullRecord([
      ["startBytes", input.startBytes],
      ["capsuleFrameBytes", input.capsuleFrameBytes],
      ["readyBytes", input.readyBytes],
      ["cancelBytes", input.cancelBytes],
      ["decisionJournalRecord", input.decisionJournalRecord],
    ]),
    "SUPERVISOR_DONE context",
  );
  const cancelled = verifyTerminal(
    input.cancelledBytes,
    "CANCELLED_WITHOUT_CLONE",
    1,
    context,
    context.ready.rawSha256,
    cancelledEvidence,
  );
  const bytes = canonicalJsonLine(
    terminalBody(
      context.start,
      context.capsuleFrame,
      context.cancel,
      "SUPERVISOR_DONE",
      2,
      cancelled.rawSha256,
      doneEvidence,
    ),
  );
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_STATUS_MAX_BYTES_V4
  ) {
    fail("SUPERVISOR_DONE exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact(
        "candidate-containment-supervisor-preflight-done-v1.jsonl",
        bytes,
      ),
    ],
  ]);
}

function snapshotObservation(value) {
  const observation = exactRecord(
    value,
    [
      "commandEofObserved",
      "commandEofAfterCancel",
      "trailingCommandBytes",
      "statusEofObserved",
      "statusEofCount",
      "eofAfterFinalStatus",
      "commandWriteError",
      "statusReadError",
      "diagnosticsBytes",
      "diagnosticsSha256",
      "supervisorExitCode",
      "supervisorSignal",
      "supervisorReaped",
    ],
    "preflight observation",
    fail,
  );
  const trailingCommandBytes = boundedInteger(
    observation.trailingCommandBytes,
    "preflight observation.trailingCommandBytes",
    0,
    0,
    fail,
  );
  const diagnosticsBytes = boundedInteger(
    observation.diagnosticsBytes,
    "preflight observation.diagnosticsBytes",
    0,
    0,
    fail,
  );
  if (
    observation.commandEofObserved !== true ||
    observation.commandEofAfterCancel !== true ||
    trailingCommandBytes !== 0 ||
    observation.statusEofObserved !== true ||
    observation.statusEofCount !== 1 ||
    observation.eofAfterFinalStatus !== true ||
    observation.commandWriteError !== null ||
    observation.statusReadError !== null ||
    diagnosticsBytes !== 0 ||
    observation.diagnosticsSha256 !== emptySha256 ||
    observation.supervisorExitCode !== 124 ||
    observation.supervisorSignal !== null ||
    observation.supervisorReaped !== true
  ) {
    fail("preflight observation changed");
  }
  return deepFreeze(observation);
}

function snapshotEvent(value, index) {
  return exactRecord(
    value,
    ["direction", "bytes"],
    `preflight event ${index}`,
    fail,
  );
}

export function verifyCandidateContainmentSupervisorPreflightReplayV4(value) {
  const input = exactRecord(
    value,
    [
      "events",
      "observation",
      "expectedGenerationIdentitySha256",
      "expectedBirthGuardianEpochSha256",
      "expectedSupervisorLaunchIntentRecordRawSha256",
      "expectedCancelDecisionProjectionSha256",
      "expectedDecisionJournalRecordRawSha256",
      "decisionJournalRecord",
    ],
    "preflight replay input",
    fail,
  );
  const expectedGenerationIdentitySha256 = exactDigest(
    input.expectedGenerationIdentitySha256,
    "preflight replay expectedGenerationIdentitySha256",
    fail,
  );
  const expectedBirthGuardianEpochSha256 = exactDigest(
    input.expectedBirthGuardianEpochSha256,
    "preflight replay expectedBirthGuardianEpochSha256",
    fail,
  );
  const expectedSupervisorLaunchIntentRecordRawSha256 = exactDigest(
    input.expectedSupervisorLaunchIntentRecordRawSha256,
    "preflight replay expectedSupervisorLaunchIntentRecordRawSha256",
    fail,
  );
  const expectedDecisionJournalRecordRawSha256 = exactDigest(
    input.expectedDecisionJournalRecordRawSha256,
    "preflight replay expectedDecisionJournalRecordRawSha256",
    fail,
  );
  const expectedCancelDecisionProjectionSha256 = exactDigest(
    input.expectedCancelDecisionProjectionSha256,
    "preflight replay expectedCancelDecisionProjectionSha256",
    fail,
  );
  const exactEvents = exactDenseArray(
    input.events,
    "preflight events",
    6,
    fail,
  );
  if (exactEvents.length !== 6) fail("preflight event inventory changed");
  const events = exactEvents.map(snapshotEvent);
  const directions = Object.freeze([
    "guardian-to-supervisor",
    "guardian-to-supervisor",
    "supervisor-to-guardian",
    "guardian-to-supervisor",
    "supervisor-to-guardian",
    "supervisor-to-guardian",
  ]);
  if (events.some((event, index) => event.direction !== directions[index])) {
    fail("preflight event direction or order changed");
  }
  const start = parseStart(events[0].bytes);
  const capsuleFrame =
    verifyCandidateContainmentSupervisorPreflightCapsuleFrameV4({
      startBytes: events[0].bytes,
      capsuleFrameBytes: events[1].bytes,
    });
  const ready = verifyReady(events[2].bytes, start, capsuleFrame);
  const cancel = verifyCancel(events[3].bytes, start, capsuleFrame, ready);
  const decisionJournalRecord = normalizeDecisionJournalRecord(
    input.decisionJournalRecord,
    start,
    ready,
    cancel.cancelDecision,
    "preflight replay decisionJournalRecord",
  );
  if (
    start.generationIdentitySha256 !== expectedGenerationIdentitySha256 ||
    start.birthGuardianEpochSha256 !== expectedBirthGuardianEpochSha256 ||
    start.supervisorLaunchIntentRecordRawSha256 !==
      expectedSupervisorLaunchIntentRecordRawSha256 ||
    cancel.cancelDecisionProjectionSha256 !==
      expectedCancelDecisionProjectionSha256 ||
    cancel.decisionJournalRecordRawSha256 !==
      expectedDecisionJournalRecordRawSha256 ||
    decisionJournalRecord.rawSha256 !== expectedDecisionJournalRecordRawSha256
  ) {
    fail("preflight replay anchor changed");
  }
  const context = { start, capsuleFrame, ready, cancel };
  const cancelled = verifyTerminal(
    events[4].bytes,
    "CANCELLED_WITHOUT_CLONE",
    1,
    context,
    ready.rawSha256,
    cancelledEvidence,
  );
  const done = verifyTerminal(
    events[5].bytes,
    "SUPERVISOR_DONE",
    2,
    context,
    cancelled.rawSha256,
    doneEvidence,
  );
  const observation = snapshotObservation(input.observation);
  const unsigned = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REPLAY_SCHEMA_V4],
    ["status", "PREFLIGHT_CANCEL_REPLAYED"],
    [
      "states",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_REQUIREMENTS_V4.eventOrder,
    ],
    [
      "events",
      Object.freeze(
        [start, capsuleFrame, ready, cancel, cancelled, done].map(
          (frame, index) =>
            deepFreeze(
              nullRecord([
                ["direction", directions[index]],
                ["frame", frame],
              ]),
            ),
        ),
      ),
    ],
    ["reportedObservation", observation],
    ["capsuleReplayValidated", true],
    ["reportedPreflightReady", true],
    ["preflightReadyObservedFromNativeSupervisor", null],
    ["reportedDescriptorsZeroThroughSeventeenStructurallyChecked", true],
    ["descriptorsZeroThroughSeventeenStructurallyChecked", null],
    ["reportedDescriptorsEighteenAndAboveClosedBeforeReady", true],
    ["descriptorsEighteenAndAboveClosedBeforeReady", null],
    ["reportedStatusWriterUniqueInSupervisorTable", true],
    ["statusWriterUniqueInSupervisorTable", null],
    ["cancelDecision", cancel.cancelDecision],
    ["cancelDecisionProjectionSha256", cancel.cancelDecisionProjectionSha256],
    ["decisionJournalRecordRawSha256", cancel.decisionJournalRecordRawSha256],
    ["decisionDurability", null],
    ["reportedChildCreated", false],
    ["childCreated", null],
    ["reportedSupervisorDone", true],
    ["supervisorExecuted", null],
    ["supervisorReaped", null],
    ["cleanupSafe", null],
    [
      "physicalFacts",
      CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_PHYSICAL_FACTS_V4,
    ],
    ["binding", null],
    ["physicalEligibility", false],
    ["finalDecisionEligible", false],
    ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_AUTHORITY_V4],
    ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_PREFLIGHT_NONCLAIMS_V4],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}
