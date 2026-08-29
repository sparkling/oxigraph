import { canonicalSha256 } from "../routing/features.mjs";
import {
  CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2,
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V2,
  verifyCandidateContainmentLaunchCapsuleV2,
} from "./containment-launch-capsule-v2.mjs";
import {
  boundedInteger,
  canonicalJsonLine,
  decodeCanonicalJsonLine,
  deepFreeze,
  exactBoolean,
  exactDenseArray,
  exactDigest,
  exactRecord,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";

// This is a pure, unregistered transcript reducer. Serialized START/READY/
// COMMIT/CANCEL bytes remain honest-null evidence and cannot mint a native
// guardian, supervisor, containment, or sandbox brand.

export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-interactive-start/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_PROJECTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-interactive-start-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-control/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_PROJECTION_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-control-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_STATUS_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-interactive-status/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_REPLAY_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-interactive-replay/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SCHEMA_V2 =
  "oxigraph.candidate-containment-supervisor-control-requirements/v1";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_START_MAX_BYTES_V2 = 4_096;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_FRAME_MAX_BYTES_V2 = 1_024;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_STATUS_FRAME_MAX_BYTES_V2 = 4_096;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_MAX_EVENTS_V2 = 5;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_DIAGNOSTICS_MAX_BYTES_V2 = 65_536;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_ACQUISITION_TIMEOUT_MS_V2 = 2_000;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_DECISION_TIMEOUT_MS_V2 = 2_000;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_TERMINAL_TIMEOUT_MS_V2 = 2_000;

const cancelReasons = new Set([
  "caller-abort",
  "decision-timeout",
  "guardian-shutdown",
]);
const emptySha256 = sha256(Buffer.alloc(0));

function fail(message) {
  throw new Error(`candidate containment supervisor control: ${message}`);
}

export const CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_V2 =
  deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SCHEMA_V2,
      ],
      [
        "startSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_SCHEMA_V2,
      ],
      ["controlSchema", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_SCHEMA_V2],
      [
        "statusSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_STATUS_SCHEMA_V2,
      ],
      ["launchCapsuleSchema", CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_SCHEMA_V2],
      [
        "launchRequirementsSha256",
        CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V2,
      ],
      [
        "fileDescriptorMapSha256",
        CANDIDATE_CONTAINMENT_INTERACTIVE_FD_MAP_SHA256_V2,
      ],
      ["remapPlanSha256", CANDIDATE_CONTAINMENT_LAUNCH_REMAP_PLAN_SHA256_V2],
      [
        "startMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_START_MAX_BYTES_V2,
      ],
      [
        "controlFrameMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_FRAME_MAX_BYTES_V2,
      ],
      [
        "statusFrameMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_STATUS_FRAME_MAX_BYTES_V2,
      ],
      [
        "maximumReplayEvents",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_MAX_EVENTS_V2,
      ],
      [
        "diagnosticsMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_DIAGNOSTICS_MAX_BYTES_V2,
      ],
      [
        "acquisitionTimeoutMilliseconds",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_ACQUISITION_TIMEOUT_MS_V2,
      ],
      [
        "decisionTimeoutMilliseconds",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_DECISION_TIMEOUT_MS_V2,
      ],
      [
        "terminalTimeoutMilliseconds",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_TERMINAL_TIMEOUT_MS_V2,
      ],
      [
        "acceptedReplayStates",
        Object.freeze([
          Object.freeze(["START", "READY", "COMMIT", "CLONE_COMMIT_STARTED"]),
          Object.freeze(["START", "READY", "CANCEL", "CANCELLED_BEFORE_CLONE"]),
          Object.freeze([
            "START",
            "READY",
            "COMMIT",
            "CLONE_COMMIT_STARTED",
            "CANCEL",
          ]),
        ]),
      ],
      ["soleStatusWriterRequired", true],
      ["oneCommitPoint", true],
      ["precommitCleanupOwner", "guardian"],
      ["supervisorMayRemoveSessionCgroup", false],
      ["guardianCleanupEvidenceRequiredForPhysicalEligibility", true],
      ["mechanicsImplemented", false],
      ["guardianImplemented", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SHA256_V2 =
  canonicalSha256(CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_V2);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_AUTHORITY_V2 = deepFreeze(
  nullRecord([
    ["nativeObservationAuthority", false],
    ["guardianAuthority", false],
    ["supervisorAuthority", false],
    ["descriptorAuthority", false],
    ["containmentExecutionAuthority", false],
    ["sandboxReportAuthority", false],
    ["applicationReceiptAuthority", false],
    ["qualificationAuthority", false],
    ["finalDecisionAuthority", false],
    ["promotionAuthority", false],
    ["publicationAuthority", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_NONCLAIMS_V2 = deepFreeze(
  nullRecord([
    ["serializedStartProvesLaunchCapsuleAvailability", false],
    ["serializedReplayProvesFreshness", false],
    ["serializedReplayProvesNativeOrigin", false],
    ["serializedReplayProvesObservationOrder", false],
    ["serializedReplayProvesSoleWriterOwnership", false],
    ["serializedReplayProvesDescriptorIdentity", false],
    ["serializedReplayProvesCgroupIdentity", false],
    ["serializedReplayProvesLimitReadback", false],
    ["serializedReplayProvesClone3", false],
    ["serializedReplayProvesCommitPoint", false],
    ["serializedReplayProvesCleanup", false],
    ["serializedReplayProvesCrashRecovery", false],
    ["serializedReplayProvesRuntimeClosure", false],
    ["serializedReplayProvesPhysicalContainment", false],
  ]),
);

function artifact(name, bytes) {
  return deepFreeze(
    nullRecord([
      ["name", name],
      ["bytes", bytes.length],
      ["sha256", sha256(bytes)],
    ]),
  );
}

function snapshotLimits(value, label) {
  const limits = exactRecord(
    value,
    ["memoryMaxBytes", "memorySwapMaxBytes", "tasksMax", "wallMs"],
    label,
    fail,
  );
  return deepFreeze(
    nullRecord([
      [
        "memoryMaxBytes",
        boundedInteger(
          limits.memoryMaxBytes,
          `${label} memoryMaxBytes`,
          256 * 1024 * 1024,
          64 * 1024 * 1024 * 1024,
          fail,
        ),
      ],
      [
        "memorySwapMaxBytes",
        boundedInteger(
          limits.memorySwapMaxBytes,
          `${label} memorySwapMaxBytes`,
          0,
          0,
          fail,
        ),
      ],
      [
        "tasksMax",
        boundedInteger(limits.tasksMax, `${label} tasksMax`, 512, 512, fail),
      ],
      [
        "wallMs",
        boundedInteger(
          limits.wallMs,
          `${label} wallMs`,
          1_000,
          7_200_000,
          fail,
        ),
      ],
    ]),
  );
}

function ownerRequestSha256(requestSha256, limits) {
  return sha256(
    Buffer.from(
      JSON.stringify({
        schema: "oxigraph.candidate-containment-owner-request/v1",
        requestSha256,
        limits: {
          memoryMaxBytes: limits.memoryMaxBytes,
          memorySwapMaxBytes: limits.memorySwapMaxBytes,
          tasksMax: limits.tasksMax,
          wallMs: limits.wallMs,
        },
      }),
      "utf8",
    ),
  );
}

function snapshotStartInput(value) {
  const input = exactRecord(
    value,
    [
      "requestSha256",
      "generationSha256",
      "guardianNonceSha256",
      "launchCapsuleBytes",
      "limits",
    ],
    "start input",
    fail,
  );
  const request = exactDigest(
    input.requestSha256,
    "start request digest",
    fail,
  );
  const generation = exactDigest(
    input.generationSha256,
    "start generation digest",
    fail,
  );
  const nonce = exactDigest(
    input.guardianNonceSha256,
    "start guardian nonce digest",
    fail,
  );
  const limits = snapshotLimits(input.limits, "start limits");
  const launchCapsule = verifyCandidateContainmentLaunchCapsuleV2(
    input.launchCapsuleBytes,
  );
  if (
    launchCapsule.requestSha256 !== request ||
    launchCapsule.generationSha256 !== generation
  ) {
    fail("start launch capsule identity changed");
  }
  return deepFreeze(
    nullRecord([
      ["requestSha256", request],
      ["ownerRequestSha256", ownerRequestSha256(request, limits)],
      ["generationSha256", generation],
      ["guardianNonceSha256", nonce],
      ["launchCapsule", launchCapsule],
      ["limits", limits],
    ]),
  );
}

function startBody(input) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_SCHEMA_V2],
    ["sequence", 0],
    ["action", "START"],
    ["requestSha256", input.requestSha256],
    ["ownerRequestSha256", input.ownerRequestSha256],
    ["generationSha256", input.generationSha256],
    ["guardianNonceSha256", input.guardianNonceSha256],
    ["launchCapsuleRawSha256", input.launchCapsule.rawSha256],
    ["launchCapsuleProjectionSha256", input.launchCapsule.projectionSha256],
    [
      "controlRequirementsSha256",
      CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SHA256_V2,
    ],
    ["limits", input.limits],
  ]);
}

function startProjection(body, bytes, launchCapsule) {
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_PROJECTION_SCHEMA_V2,
      ],
      ["protocolSchema", body.schema],
      ["byteLength", bytes.length],
      ["rawSha256", sha256(bytes)],
      ["sequence", 0],
      ["action", "START"],
      ["requestSha256", body.requestSha256],
      ["ownerRequestSha256", body.ownerRequestSha256],
      ["generationSha256", body.generationSha256],
      ["guardianNonceSha256", body.guardianNonceSha256],
      ["launchCapsule", launchCapsule],
      ["controlRequirementsSha256", body.controlRequirementsSha256],
      ["limits", body.limits],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_AUTHORITY_V2],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_NONCLAIMS_V2],
    ]),
  );
}

export function createCandidateContainmentSupervisorInteractiveStartV2(value) {
  const input = snapshotStartInput(value);
  const body = startBody(input);
  const bytes = canonicalJsonLine(body);
  if (bytes.length > CANDIDATE_CONTAINMENT_SUPERVISOR_START_MAX_BYTES_V2) {
    fail("start frame exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact("candidate-containment-supervisor-start-v1.json", bytes),
    ],
  ]);
}

export function verifyCandidateContainmentSupervisorInteractiveStartV2(value) {
  const input = exactRecord(
    value,
    ["startBytes", "launchCapsuleBytes"],
    "start replay input",
    fail,
  );
  const decoded = decodeCanonicalJsonLine(
    input.startBytes,
    "start bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_START_MAX_BYTES_V2,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "sequence",
      "action",
      "requestSha256",
      "ownerRequestSha256",
      "generationSha256",
      "guardianNonceSha256",
      "launchCapsuleRawSha256",
      "launchCapsuleProjectionSha256",
      "controlRequirementsSha256",
      "limits",
    ],
    "start body",
    fail,
  );
  const limits = snapshotLimits(body.limits, "start limits");
  const request = exactDigest(body.requestSha256, "start request digest", fail);
  const generation = exactDigest(
    body.generationSha256,
    "start generation digest",
    fail,
  );
  const guardianNonce = exactDigest(
    body.guardianNonceSha256,
    "start guardian nonce digest",
    fail,
  );
  const launchCapsule = verifyCandidateContainmentLaunchCapsuleV2(
    input.launchCapsuleBytes,
  );
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_SCHEMA_V2 ||
    body.sequence !== 0 ||
    body.action !== "START" ||
    body.ownerRequestSha256 !== ownerRequestSha256(request, limits) ||
    body.controlRequirementsSha256 !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SHA256_V2 ||
    launchCapsule.requestSha256 !== request ||
    launchCapsule.generationSha256 !== generation ||
    body.launchCapsuleRawSha256 !== launchCapsule.rawSha256 ||
    body.launchCapsuleProjectionSha256 !== launchCapsule.projectionSha256
  ) {
    fail("start frame schema or owner binding changed");
  }
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_PROJECTION_SCHEMA_V2,
      ],
      ["protocolSchema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["sequence", 0],
      ["action", "START"],
      ["requestSha256", request],
      ["ownerRequestSha256", body.ownerRequestSha256],
      ["generationSha256", generation],
      ["guardianNonceSha256", guardianNonce],
      ["launchCapsule", launchCapsule],
      ["controlRequirementsSha256", body.controlRequirementsSha256],
      ["limits", limits],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_AUTHORITY_V2],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_NONCLAIMS_V2],
    ]),
  );
}

function snapshotControlInput(value) {
  const input = exactRecord(
    value,
    ["startBytes", "launchCapsuleBytes", "action", "reason", "afterCommit"],
    "control input",
    fail,
  );
  const start = verifyCandidateContainmentSupervisorInteractiveStartV2({
    startBytes: input.startBytes,
    launchCapsuleBytes: input.launchCapsuleBytes,
  });
  if (typeof input.afterCommit !== "boolean") {
    fail("control afterCommit is not exact boolean");
  }
  if (
    input.action === "COMMIT" &&
    input.reason === null &&
    input.afterCommit === false
  ) {
    return { start, action: "COMMIT", reason: null, sequence: 1 };
  }
  if (
    input.action === "CANCEL" &&
    typeof input.reason === "string" &&
    cancelReasons.has(input.reason)
  ) {
    return {
      start,
      action: "CANCEL",
      reason: input.reason,
      sequence: input.afterCommit ? 2 : 1,
    };
  }
  fail("control decision is invalid");
}

function controlBody(input) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_SCHEMA_V2],
    ["sequence", input.sequence],
    ["action", input.action],
    ["reason", input.reason],
    ["startRawSha256", input.start.rawSha256],
    ["ownerRequestSha256", input.start.ownerRequestSha256],
    ["generationSha256", input.start.generationSha256],
    ["guardianNonceSha256", input.start.guardianNonceSha256],
    [
      "controlRequirementsSha256",
      CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SHA256_V2,
    ],
  ]);
}

function controlProjection(body, bytes) {
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_PROJECTION_SCHEMA_V2],
      ["protocolSchema", body.schema],
      ["byteLength", bytes.length],
      ["rawSha256", sha256(bytes)],
      ["sequence", body.sequence],
      ["action", body.action],
      ["reason", body.reason],
      ["startRawSha256", body.startRawSha256],
      ["ownerRequestSha256", body.ownerRequestSha256],
      ["generationSha256", body.generationSha256],
      ["guardianNonceSha256", body.guardianNonceSha256],
      ["controlRequirementsSha256", body.controlRequirementsSha256],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_AUTHORITY_V2],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_NONCLAIMS_V2],
    ]),
  );
}

export function createCandidateContainmentSupervisorControlFrameV2(value) {
  const input = snapshotControlInput(value);
  const body = controlBody(input);
  const bytes = canonicalJsonLine(body);
  if (
    bytes.length > CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_FRAME_MAX_BYTES_V2
  ) {
    fail("control frame exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact(
        `candidate-containment-supervisor-${input.action.toLowerCase()}-v1.json`,
        bytes,
      ),
    ],
  ]);
}

export function verifyCandidateContainmentSupervisorControlFrameV2(value) {
  const input = exactRecord(
    value,
    ["startBytes", "launchCapsuleBytes", "controlBytes"],
    "control replay input",
    fail,
  );
  const start = verifyCandidateContainmentSupervisorInteractiveStartV2({
    startBytes: input.startBytes,
    launchCapsuleBytes: input.launchCapsuleBytes,
  });
  const decoded = decodeCanonicalJsonLine(
    input.controlBytes,
    "control bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_FRAME_MAX_BYTES_V2,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "sequence",
      "action",
      "reason",
      "startRawSha256",
      "ownerRequestSha256",
      "generationSha256",
      "guardianNonceSha256",
      "controlRequirementsSha256",
    ],
    "control body",
    fail,
  );
  const validDecision =
    (body.action === "COMMIT" && body.sequence === 1 && body.reason === null) ||
    (body.action === "CANCEL" &&
      [1, 2].includes(body.sequence) &&
      typeof body.reason === "string" &&
      cancelReasons.has(body.reason));
  if (
    body.schema !== CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_SCHEMA_V2 ||
    !validDecision ||
    body.startRawSha256 !== start.rawSha256 ||
    body.ownerRequestSha256 !== start.ownerRequestSha256 ||
    body.generationSha256 !== start.generationSha256 ||
    body.guardianNonceSha256 !== start.guardianNonceSha256 ||
    body.controlRequirementsSha256 !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SHA256_V2
  ) {
    fail("control frame identity or decision changed");
  }
  return controlProjection(body, decoded.bytes);
}

function statusCommon(
  body,
  start,
  expectedState,
  expectedSequence,
  expectedDecisionRawSha256,
) {
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_STATUS_SCHEMA_V2 ||
    body.state !== expectedState ||
    body.sequence !== expectedSequence ||
    body.startRawSha256 !== start.rawSha256 ||
    body.ownerRequestSha256 !== start.ownerRequestSha256 ||
    body.generationSha256 !== start.generationSha256 ||
    body.guardianNonceSha256 !== start.guardianNonceSha256 ||
    body.decisionRawSha256 !== expectedDecisionRawSha256
  ) {
    fail(`status ${expectedState} identity changed`);
  }
}

function validateReadyEvidence(value, start) {
  const evidence = exactRecord(
    value,
    [
      "requestValidated",
      "launchCapsuleValidated",
      "soleStatusWriter",
      "sessionCgroupFd",
      "sessionCgroupRole",
      "filesystem",
      "type",
      "initialProcs",
      "memoryMax",
      "memorySwapMax",
      "pidsMax",
    ],
    "READY evidence",
    fail,
  );
  if (
    evidence.requestValidated !== true ||
    evidence.launchCapsuleValidated !== true ||
    evidence.soleStatusWriter !== true ||
    evidence.sessionCgroupFd !== 3 ||
    evidence.sessionCgroupRole !== "sessionCgroup" ||
    evidence.filesystem !== "cgroup2" ||
    evidence.type !== "domain\n" ||
    evidence.initialProcs !== "" ||
    evidence.memoryMax !== `${start.limits.memoryMaxBytes}\n` ||
    evidence.memorySwapMax !== "0\n" ||
    evidence.pidsMax !== `${start.limits.tasksMax}\n`
  ) {
    fail("READY evidence changed");
  }
  return deepFreeze(evidence);
}

function validateCloneEvidence(value, start) {
  const evidence = exactRecord(
    value,
    [
      "syscall",
      "cloneArgsSize",
      "flags",
      "exitSignal",
      "executableScratchCreated",
      "executableScratchMinimumFd",
      "pidfd",
      "pidfdRole",
      "remapPlanSha256",
    ],
    "CLONE_COMMIT_STARTED evidence",
    fail,
  );
  const flags = exactDenseArray(evidence.flags, "clone flags", 2, fail);
  if (
    evidence.syscall !== "clone3" ||
    evidence.cloneArgsSize !== 88 ||
    flags.length !== 2 ||
    flags[0] !== "CLONE_INTO_CGROUP" ||
    flags[1] !== "CLONE_PIDFD" ||
    evidence.exitSignal !== "SIGCHLD" ||
    evidence.executableScratchCreated !== true ||
    evidence.executableScratchMinimumFd !== 18 ||
    evidence.pidfd !== 23 ||
    evidence.pidfdRole !== "childPidfd" ||
    evidence.remapPlanSha256 !== start.launchCapsule.remapPlanSha256
  ) {
    fail("CLONE_COMMIT_STARTED evidence changed");
  }
  return deepFreeze(
    nullRecord([
      ["syscall", "clone3"],
      ["cloneArgsSize", 88],
      ["flags", flags],
      ["exitSignal", "SIGCHLD"],
      ["executableScratchCreated", true],
      ["executableScratchMinimumFd", 18],
      ["pidfd", 23],
      ["pidfdRole", "childPidfd"],
      ["remapPlanSha256", evidence.remapPlanSha256],
    ]),
  );
}

function validatePrecommitCancelEvidence(value) {
  const evidence = exactRecord(
    value,
    [
      "cloneCommitStarted",
      "childCreated",
      "sessionCgroupFdClosed",
      "pidfdCreated",
      "cleanupOwner",
      "cleanupOutcomeReportedBySupervisor",
    ],
    "CANCELLED_BEFORE_CLONE evidence",
    fail,
  );
  if (
    evidence.cloneCommitStarted !== false ||
    evidence.childCreated !== false ||
    evidence.sessionCgroupFdClosed !== true ||
    evidence.pidfdCreated !== false ||
    evidence.cleanupOwner !== "guardian" ||
    evidence.cleanupOutcomeReportedBySupervisor !== null
  ) {
    fail("CANCELLED_BEFORE_CLONE evidence changed");
  }
  return deepFreeze(evidence);
}

function verifyStatusFrame(
  bytesValue,
  start,
  expectedState,
  expectedDecisionRawSha256,
) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    `${expectedState} status bytes`,
    CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_STATUS_FRAME_MAX_BYTES_V2,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "sequence",
      "state",
      "startRawSha256",
      "ownerRequestSha256",
      "generationSha256",
      "guardianNonceSha256",
      "decisionRawSha256",
      "evidence",
    ],
    `${expectedState} status body`,
    fail,
  );
  const sequence = expectedState === "READY" ? 0 : 1;
  if (expectedDecisionRawSha256 !== null) {
    exactDigest(
      expectedDecisionRawSha256,
      `${expectedState} expected decision digest`,
      fail,
    );
  }
  statusCommon(body, start, expectedState, sequence, expectedDecisionRawSha256);
  const evidence =
    expectedState === "READY"
      ? validateReadyEvidence(body.evidence, start)
      : expectedState === "CLONE_COMMIT_STARTED"
        ? validateCloneEvidence(body.evidence, start)
        : validatePrecommitCancelEvidence(body.evidence);
  return deepFreeze(
    nullRecord([
      ["schema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["sequence", sequence],
      ["state", expectedState],
      ["startRawSha256", body.startRawSha256],
      ["ownerRequestSha256", body.ownerRequestSha256],
      ["generationSha256", body.generationSha256],
      ["guardianNonceSha256", body.guardianNonceSha256],
      ["decisionRawSha256", body.decisionRawSha256],
      ["evidence", evidence],
    ]),
  );
}

function snapshotObservation(value, terminal) {
  const observation = exactRecord(
    value,
    [
      "commandEofObserved",
      "statusEofObserved",
      "statusEofCount",
      "eofAfterFinalStatus",
      "writerCountAtLaunch",
      "writerDuplicationObserved",
      "commandWriteError",
      "statusReadError",
      "diagnosticsBytes",
      "diagnosticsSha256",
      "supervisorExitCode",
      "supervisorSignal",
      "supervisorReaped",
    ],
    "interactive observation",
    fail,
  );
  const diagnosticsBytes = boundedInteger(
    observation.diagnosticsBytes,
    "diagnostics bytes",
    0,
    CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_DIAGNOSTICS_MAX_BYTES_V2,
    fail,
  );
  const diagnosticsSha256 = exactDigest(
    observation.diagnosticsSha256,
    "diagnostics digest",
    fail,
  );
  if (
    diagnosticsBytes !== 0 ||
    diagnosticsSha256 !== emptySha256 ||
    observation.writerCountAtLaunch !== 1 ||
    observation.writerDuplicationObserved !== false ||
    observation.commandWriteError !== null ||
    observation.statusReadError !== null ||
    observation.supervisorSignal !== null
  ) {
    fail("interactive observation writer or diagnostics changed");
  }
  if (terminal) {
    if (
      observation.commandEofObserved !== true ||
      observation.statusEofObserved !== true ||
      observation.statusEofCount !== 1 ||
      observation.eofAfterFinalStatus !== true ||
      observation.supervisorExitCode !== 124 ||
      observation.supervisorReaped !== true
    ) {
      fail("precommit cancellation observation is ambiguous");
    }
  } else if (
    observation.commandEofObserved !== false ||
    observation.statusEofObserved !== false ||
    observation.statusEofCount !== 0 ||
    observation.eofAfterFinalStatus !== false ||
    observation.supervisorExitCode !== null ||
    observation.supervisorReaped !== false
  ) {
    fail("open interactive observation is ambiguous");
  }
  return deepFreeze(
    nullRecord([
      ["commandEofObserved", observation.commandEofObserved],
      ["statusEofObserved", observation.statusEofObserved],
      ["statusEofCount", observation.statusEofCount],
      ["eofAfterFinalStatus", observation.eofAfterFinalStatus],
      ["writerCountAtLaunch", 1],
      ["writerDuplicationObserved", false],
      ["commandWriteError", null],
      ["statusReadError", null],
      ["diagnosticsBytes", diagnosticsBytes],
      ["diagnosticsSha256", diagnosticsSha256],
      ["supervisorExitCode", observation.supervisorExitCode],
      ["supervisorSignal", null],
      ["supervisorReaped", observation.supervisorReaped],
    ]),
  );
}

function snapshotEvent(value, index) {
  const event = exactRecord(
    value,
    ["direction", "bytes"],
    `interactive event ${index}`,
    fail,
  );
  if (
    !["guardian-to-supervisor", "supervisor-to-guardian"].includes(
      event.direction,
    )
  ) {
    fail(`interactive event ${index} direction changed`);
  }
  return event;
}

export function verifyCandidateContainmentSupervisorInteractiveReplayV2(value) {
  const input = exactRecord(
    value,
    ["events", "launchCapsuleBytes", "observation"],
    "interactive replay input",
    fail,
  );
  const rawEvents = exactDenseArray(
    input.events,
    "interactive events",
    CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_MAX_EVENTS_V2,
    fail,
  );
  if (![4, 5].includes(rawEvents.length)) {
    fail("interactive event inventory changed");
  }
  const events = rawEvents.map(snapshotEvent);
  const directions = events.map(({ direction }) => direction);
  const expectedFour = [
    "guardian-to-supervisor",
    "supervisor-to-guardian",
    "guardian-to-supervisor",
    "supervisor-to-guardian",
  ];
  const expectedFive = [...expectedFour, "guardian-to-supervisor"];
  const expectedDirections = events.length === 4 ? expectedFour : expectedFive;
  if (
    directions.some(
      (direction, index) => direction !== expectedDirections[index],
    )
  ) {
    fail("interactive event direction order changed");
  }

  const start = verifyCandidateContainmentSupervisorInteractiveStartV2({
    startBytes: events[0].bytes,
    launchCapsuleBytes: input.launchCapsuleBytes,
  });
  const ready = verifyStatusFrame(events[1].bytes, start, "READY", null);
  const control = verifyCandidateContainmentSupervisorControlFrameV2({
    startBytes: events[0].bytes,
    launchCapsuleBytes: input.launchCapsuleBytes,
    controlBytes: events[2].bytes,
  });
  let fourth;
  let fifth;
  let status;
  let states;
  let terminal = false;
  let commitPointCrossed = false;
  let cancelRequested = false;
  let reportedCleanupSafe = null;

  if (control.action === "COMMIT" && control.sequence === 1) {
    fourth = verifyStatusFrame(
      events[3].bytes,
      start,
      "CLONE_COMMIT_STARTED",
      control.rawSha256,
    );
    commitPointCrossed = true;
    if (events.length === 4) {
      status = "COMMIT_ACKNOWLEDGED_REPLAYED";
      states = ["START", "READY", "COMMIT", "CLONE_COMMIT_STARTED"];
    } else {
      fifth = verifyCandidateContainmentSupervisorControlFrameV2({
        startBytes: events[0].bytes,
        launchCapsuleBytes: input.launchCapsuleBytes,
        controlBytes: events[4].bytes,
      });
      if (fifth.action !== "CANCEL" || fifth.sequence !== 2) {
        fail("postcommit decision changed");
      }
      cancelRequested = true;
      status = "POSTCOMMIT_CANCEL_REQUESTED_REPLAYED";
      states = ["START", "READY", "COMMIT", "CLONE_COMMIT_STARTED", "CANCEL"];
    }
  } else if (
    control.action === "CANCEL" &&
    control.sequence === 1 &&
    events.length === 4
  ) {
    fourth = verifyStatusFrame(
      events[3].bytes,
      start,
      "CANCELLED_BEFORE_CLONE",
      control.rawSha256,
    );
    terminal = true;
    cancelRequested = true;
    status = "PRECOMMIT_CANCELLED_REPLAYED";
    states = ["START", "READY", "CANCEL", "CANCELLED_BEFORE_CLONE"];
  } else {
    fail("interactive decision sequence changed");
  }

  const observation = snapshotObservation(input.observation, terminal);
  const replayedEvents = Object.freeze(
    [start, ready, control, fourth, fifth]
      .filter((event) => event !== undefined)
      .map((event, index) =>
        deepFreeze(
          nullRecord([
            ["direction", directions[index]],
            ["frame", event],
          ]),
        ),
      ),
  );
  const unsigned = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_REPLAY_SCHEMA_V2],
    ["status", status],
    ["states", Object.freeze(states)],
    ["events", replayedEvents],
    ["observation", observation],
    ["reportedCommitPointCrossed", commitPointCrossed],
    ["commitPointCrossed", null],
    ["reportedCancelRequested", cancelRequested],
    ["cancelRequested", null],
    ["reportedCleanupSafe", reportedCleanupSafe],
    ["cleanupSafe", null],
    ["transcriptTerminal", terminal],
    ["terminal", null],
    ["binding", null],
    ["physicalEligibility", false],
    ["finalDecisionEligible", false],
    ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_AUTHORITY_V2],
    ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_NONCLAIMS_V2],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}
