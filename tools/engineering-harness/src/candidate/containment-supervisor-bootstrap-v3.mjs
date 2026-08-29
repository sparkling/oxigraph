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

// Additive cancel-only bootstrap protocol for a future native supervisor. The
// capsule is an in-band bounded frame, so READY can report validation of bytes
// actually available to the supervisor. COMMIT is deliberately impossible in
// this version; no clone, child, cgroup cleanup, or physical authority exists.

export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-start/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_PROJECTION_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-start-replay/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-capsule/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_PROJECTION_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-capsule-replay/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-control/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_PROJECTION_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-control-replay/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-status/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REPLAY_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-replay/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-bootstrap-requirements/v2";
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_RETAINED_FILE_DESCRIPTOR_INVENTORY_SCHEMA_V3 =
  "oxigraph.candidate-containment-supervisor-expected-retained-file-descriptor-inventory/v1";

export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_MAX_BYTES_V3 = 4_096;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_FRAME_MAX_BYTES_V3 =
  128 * 1024;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_MAX_BYTES_V3 = 2_048;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_MAX_BYTES_V3 = 4_096;
export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_DIAGNOSTICS_MAX_BYTES_V3 = 65_536;

const cancelReasons = new Set([
  "caller-abort",
  "decision-timeout",
  "guardian-shutdown",
]);
const emptySha256 = sha256(Buffer.alloc(0));

function fail(message) {
  throw new Error(`candidate containment supervisor bootstrap v3: ${message}`);
}

export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3 =
  deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SCHEMA_V3,
      ],
      [
        "startSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_SCHEMA_V3,
      ],
      [
        "capsuleFrameSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_SCHEMA_V3,
      ],
      [
        "controlSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_SCHEMA_V3,
      ],
      [
        "statusSchema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_SCHEMA_V3,
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
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_MAX_BYTES_V3,
      ],
      [
        "capsuleFrameMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_FRAME_MAX_BYTES_V3,
      ],
      [
        "capsuleRawMaximumBytes",
        CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
      ],
      [
        "controlMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_MAX_BYTES_V3,
      ],
      [
        "statusMaximumBytes",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_MAX_BYTES_V3,
      ],
      [
        "eventOrder",
        Object.freeze([
          "START",
          "CAPSULE",
          "READY",
          "CANCEL",
          "CANCELLED_BEFORE_CLONE",
          "SUPERVISOR_DONE",
        ]),
      ],
      ["capsuleTransport", "base64-canonical-jsonl-on-command-fd-0"],
      ["readyAfterCapsuleAndRetainedFileDescriptorValidation", true],
      [
        "readyRetainedFileDescriptorScope",
        "launch-capsule-file-descriptors-4-through-17-only",
      ],
      ["readyMayClaimWholeDescriptorInventoryExact", false],
      [
        "futurePhysicalReadyRequiresGuardianBoundControlDescriptorIdentities",
        true,
      ],
      [
        "futurePhysicalReadyRequiresSupervisorControlDescriptorReobservation",
        true,
      ],
      ["futurePhysicalReadyRequiresExactOpenSetAndNonalias", true],
      ["commitAccepted", false],
      ["clonePermitted", false],
      ["supervisorStatusFdMustBeOnlyMatchingWriterInOwnDescriptorTable", true],
      [
        "futurePhysicalReadyRequiresGuardianLauncherStatusWriterCopiesClosed",
        true,
      ],
      ["futurePhysicalReadyRequiresExactStatusPipeIdentity", true],
      ["precommitCleanupOwner", "guardian"],
      ["supervisorMayRemoveSessionCgroup", false],
      ["supervisorDoneMayReportOwnStatusFdClosure", false],
      ["mechanicsImplemented", false],
      ["guardianImplemented", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SHA256_V3 =
  canonicalSha256(CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_V3);

export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_AUTHORITY_V3 =
  deepFreeze(
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

export const CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_NONCLAIMS_V3 =
  deepFreeze(
    nullRecord([
      ["serializedReplayProvesCapsuleTransfer", false],
      ["serializedReplayProvesFreshness", false],
      ["serializedReplayProvesSupervisorOrigin", false],
      ["serializedReplayProvesSupervisorCapsuleValidation", false],
      ["serializedReplayProvesDescriptorIdentity", false],
      ["serializedReplayProvesSoleWriterOwnership", false],
      ["serializedReplayProvesCgroupIdentity", false],
      ["serializedReplayProvesLimitReadback", false],
      ["serializedReplayProvesObservationOrder", false],
      ["serializedReplayProvesStatusFdClosure", false],
      ["serializedReplayProvesGuardianCleanup", false],
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

function parseStart(bytesValue) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "start bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_MAX_BYTES_V3,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "commandSequence",
      "action",
      "requestSha256",
      "ownerRequestSha256",
      "generationSha256",
      "guardianEpochSha256",
      "guardianNonceSha256",
      "launchCapsuleRawSha256",
      "launchCapsuleProjectionSha256",
      "bootstrapRequirementsSha256",
      "limits",
    ],
    "start body",
    fail,
  );
  const limits = snapshotLimits(body.limits, "start limits");
  const requestSha256 = exactDigest(
    body.requestSha256,
    "start request digest",
    fail,
  );
  const generationSha256 = exactDigest(
    body.generationSha256,
    "start generation digest",
    fail,
  );
  const guardianEpochSha256 = exactDigest(
    body.guardianEpochSha256,
    "start guardian epoch digest",
    fail,
  );
  const guardianNonceSha256 = exactDigest(
    body.guardianNonceSha256,
    "start guardian nonce digest",
    fail,
  );
  const launchCapsuleRawSha256 = exactDigest(
    body.launchCapsuleRawSha256,
    "start capsule raw digest",
    fail,
  );
  const launchCapsuleProjectionSha256 = exactDigest(
    body.launchCapsuleProjectionSha256,
    "start capsule projection digest",
    fail,
  );
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_SCHEMA_V3 ||
    body.commandSequence !== 0 ||
    body.action !== "START" ||
    body.ownerRequestSha256 !== ownerRequestSha256(requestSha256, limits) ||
    body.bootstrapRequirementsSha256 !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SHA256_V3
  ) {
    fail("start schema or owner binding changed");
  }
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_PROJECTION_SCHEMA_V3,
      ],
      ["protocolSchema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["commandSequence", 0],
      ["action", "START"],
      ["requestSha256", requestSha256],
      ["ownerRequestSha256", body.ownerRequestSha256],
      ["generationSha256", generationSha256],
      ["guardianEpochSha256", guardianEpochSha256],
      ["guardianNonceSha256", guardianNonceSha256],
      ["launchCapsuleRawSha256", launchCapsuleRawSha256],
      ["launchCapsuleProjectionSha256", launchCapsuleProjectionSha256],
      ["bootstrapRequirementsSha256", body.bootstrapRequirementsSha256],
      ["limits", limits],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_AUTHORITY_V3],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_NONCLAIMS_V3],
    ]),
  );
}

export function createCandidateContainmentSupervisorBootstrapStartV3(value) {
  const input = exactRecord(
    value,
    [
      "requestSha256",
      "generationSha256",
      "guardianEpochSha256",
      "guardianNonceSha256",
      "launchCapsuleBytes",
      "limits",
    ],
    "start input",
    fail,
  );
  const capsule = verifyCandidateContainmentLaunchCapsuleV3(
    input.launchCapsuleBytes,
  );
  const requestSha256 = exactDigest(
    input.requestSha256,
    "start request digest",
    fail,
  );
  const generationSha256 = exactDigest(
    input.generationSha256,
    "start generation digest",
    fail,
  );
  const guardianEpochSha256 = exactDigest(
    input.guardianEpochSha256,
    "start guardian epoch digest",
    fail,
  );
  const guardianNonceSha256 = exactDigest(
    input.guardianNonceSha256,
    "start guardian nonce digest",
    fail,
  );
  const limits = snapshotLimits(input.limits, "start limits");
  if (
    capsule.requestSha256 !== requestSha256 ||
    capsule.generationSha256 !== generationSha256
  ) {
    fail("start capsule identity changed");
  }
  const body = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_SCHEMA_V3],
    ["commandSequence", 0],
    ["action", "START"],
    ["requestSha256", requestSha256],
    ["ownerRequestSha256", ownerRequestSha256(requestSha256, limits)],
    ["generationSha256", generationSha256],
    ["guardianEpochSha256", guardianEpochSha256],
    ["guardianNonceSha256", guardianNonceSha256],
    ["launchCapsuleRawSha256", capsule.rawSha256],
    ["launchCapsuleProjectionSha256", capsule.projectionSha256],
    [
      "bootstrapRequirementsSha256",
      CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REQUIREMENTS_SHA256_V3,
    ],
    ["limits", limits],
  ]);
  const bytes = canonicalJsonLine(body);
  if (
    bytes.length > CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_START_MAX_BYTES_V3
  ) {
    fail("start exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact("candidate-containment-bootstrap-start-v2.json", bytes),
    ],
  ]);
}

export function verifyCandidateContainmentSupervisorBootstrapStartV3(
  bytesValue,
) {
  return parseStart(bytesValue);
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

function capsuleBody(start, capsule) {
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_SCHEMA_V3],
    ["commandSequence", 1],
    ["action", "CAPSULE"],
    ["startRawSha256", start.rawSha256],
    ["ownerRequestSha256", start.ownerRequestSha256],
    ["generationSha256", start.generationSha256],
    ["guardianEpochSha256", start.guardianEpochSha256],
    ["guardianNonceSha256", start.guardianNonceSha256],
    ["launchCapsuleBase64", capsule.bytes.toString("base64")],
    ["launchCapsuleRawSha256", capsule.projection.rawSha256],
    ["launchCapsuleProjectionSha256", capsule.projection.projectionSha256],
    ["bootstrapRequirementsSha256", start.bootstrapRequirementsSha256],
  ]);
}

function snapshotCapsule(startBytes, capsuleBytes) {
  const start = parseStart(startBytes);
  const capsule = verifyCandidateContainmentLaunchCapsuleV3(capsuleBytes);
  if (
    capsule.requestSha256 !== start.requestSha256 ||
    capsule.generationSha256 !== start.generationSha256 ||
    capsule.rawSha256 !== start.launchCapsuleRawSha256 ||
    capsule.projectionSha256 !== start.launchCapsuleProjectionSha256
  ) {
    fail("capsule does not match START");
  }
  return { start, capsule };
}

export function createCandidateContainmentSupervisorBootstrapCapsuleFrameV3(
  value,
) {
  const input = exactRecord(
    value,
    ["startBytes", "launchCapsuleBytes"],
    "capsule frame input",
    fail,
  );
  const retained = copyBoundedBuffer(
    input.launchCapsuleBytes,
    "capsule frame launch capsule bytes",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    },
    fail,
  );
  const { start, capsule } = snapshotCapsule(input.startBytes, retained);
  const bytes = canonicalJsonLine(
    capsuleBody(start, { bytes: retained, projection: capsule }),
  );
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_FRAME_MAX_BYTES_V3
  ) {
    fail("capsule frame exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact("candidate-containment-bootstrap-capsule-v2.json", bytes),
    ],
  ]);
}

export function verifyCandidateContainmentSupervisorBootstrapCapsuleFrameV3(
  value,
) {
  const input = exactRecord(
    value,
    ["startBytes", "capsuleFrameBytes"],
    "capsule frame replay input",
    fail,
  );
  const start = parseStart(input.startBytes);
  const decoded = decodeCanonicalJsonLine(
    input.capsuleFrameBytes,
    "capsule frame bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_FRAME_MAX_BYTES_V3,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "commandSequence",
      "action",
      "startRawSha256",
      "ownerRequestSha256",
      "generationSha256",
      "guardianEpochSha256",
      "guardianNonceSha256",
      "launchCapsuleBase64",
      "launchCapsuleRawSha256",
      "launchCapsuleProjectionSha256",
      "bootstrapRequirementsSha256",
    ],
    "capsule frame body",
    fail,
  );
  const capsuleBytes = strictBase64(
    body.launchCapsuleBase64,
    "capsule payload",
  );
  const capsule = verifyCandidateContainmentLaunchCapsuleV3(capsuleBytes);
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_SCHEMA_V3 ||
    body.commandSequence !== 1 ||
    body.action !== "CAPSULE" ||
    body.startRawSha256 !== start.rawSha256 ||
    body.ownerRequestSha256 !== start.ownerRequestSha256 ||
    body.generationSha256 !== start.generationSha256 ||
    body.guardianEpochSha256 !== start.guardianEpochSha256 ||
    body.guardianNonceSha256 !== start.guardianNonceSha256 ||
    body.launchCapsuleRawSha256 !== start.launchCapsuleRawSha256 ||
    body.launchCapsuleProjectionSha256 !==
      start.launchCapsuleProjectionSha256 ||
    body.bootstrapRequirementsSha256 !== start.bootstrapRequirementsSha256 ||
    capsule.rawSha256 !== body.launchCapsuleRawSha256 ||
    capsule.projectionSha256 !== body.launchCapsuleProjectionSha256 ||
    capsule.requestSha256 !== start.requestSha256 ||
    capsule.generationSha256 !== start.generationSha256
  ) {
    fail("capsule frame identity changed");
  }
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CAPSULE_PROJECTION_SCHEMA_V3,
      ],
      ["protocolSchema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["commandSequence", 1],
      ["action", "CAPSULE"],
      ["startRawSha256", body.startRawSha256],
      ["ownerRequestSha256", body.ownerRequestSha256],
      ["generationSha256", body.generationSha256],
      ["guardianEpochSha256", body.guardianEpochSha256],
      ["guardianNonceSha256", body.guardianNonceSha256],
      ["launchCapsuleRawSha256", body.launchCapsuleRawSha256],
      ["launchCapsuleProjectionSha256", body.launchCapsuleProjectionSha256],
      ["launchCapsule", capsule],
      ["bootstrapRequirementsSha256", body.bootstrapRequirementsSha256],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_AUTHORITY_V3],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_NONCLAIMS_V3],
    ]),
  );
}

// This digest intentionally covers only the retained launch files on FDs 4-17.
// A physical READY successor must separately bind and reobserve live identities,
// directions, flags, exact-open-set membership, and non-aliasing for FDs 0-3.
function expectedRetainedFileDescriptorInventory(capsule) {
  const value = nullRecord([
    [
      "schema",
      CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_RETAINED_FILE_DESCRIPTOR_INVENTORY_SCHEMA_V3,
    ],
    ["scope", "launch-capsule-file-descriptors-4-through-17-only"],
    ["fileDescriptorMapSha256", capsule.fileDescriptorMapSha256],
    ["remapPlanSha256", capsule.remapPlanSha256],
    [
      "files",
      capsule.files.map((file) =>
        nullRecord([
          ["role", file.role],
          ["supervisorFd", file.supervisorFd],
          ["childFd", file.childFd],
          ["accessMode", file.accessMode],
          ["permissions", file.permissions],
          ["byteLength", file.byteLength],
          ["sha256", file.sha256],
          ["identity", file.identity],
        ]),
      ),
    ],
  ]);
  return canonicalSha256(value);
}

export function candidateContainmentSupervisorBootstrapExpectedRetainedFileDescriptorInventorySha256V3(
  launchCapsuleBytes,
) {
  const retained = copyBoundedBuffer(
    launchCapsuleBytes,
    "descriptor inventory launch capsule bytes",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_LAUNCH_CAPSULE_MAX_BYTES_V2,
    },
    fail,
  );
  return expectedRetainedFileDescriptorInventory(
    verifyCandidateContainmentLaunchCapsuleV3(retained),
  );
}

function verifyReady(bytesValue, start, capsuleFrame) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "READY status bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_MAX_BYTES_V3,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "statusSequence",
      "state",
      "startRawSha256",
      "capsuleFrameRawSha256",
      "ownerRequestSha256",
      "generationSha256",
      "guardianEpochSha256",
      "guardianNonceSha256",
      "bootstrapRequirementsSha256",
      "decisionRawSha256",
      "evidence",
    ],
    "READY status body",
    fail,
  );
  const evidence = exactRecord(
    body.evidence,
    [
      "requestValidated",
      "capsuleFrameValidated",
      "launchCapsuleValidated",
      "reportedRetainedFileDescriptorInventorySha256",
      "reportedRetainedFileDescriptorsExact",
      "supervisorStatusFdOnlyMatchingWriterInOwnDescriptorTable",
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
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_SCHEMA_V3 ||
    body.statusSequence !== 0 ||
    body.state !== "READY" ||
    body.startRawSha256 !== start.rawSha256 ||
    body.capsuleFrameRawSha256 !== capsuleFrame.rawSha256 ||
    body.ownerRequestSha256 !== start.ownerRequestSha256 ||
    body.generationSha256 !== start.generationSha256 ||
    body.guardianEpochSha256 !== start.guardianEpochSha256 ||
    body.guardianNonceSha256 !== start.guardianNonceSha256 ||
    body.bootstrapRequirementsSha256 !== start.bootstrapRequirementsSha256 ||
    body.decisionRawSha256 !== null ||
    evidence.requestValidated !== true ||
    evidence.capsuleFrameValidated !== true ||
    evidence.launchCapsuleValidated !== true ||
    evidence.reportedRetainedFileDescriptorInventorySha256 !==
      expectedRetainedFileDescriptorInventory(capsuleFrame.launchCapsule) ||
    evidence.reportedRetainedFileDescriptorsExact !== true ||
    evidence.supervisorStatusFdOnlyMatchingWriterInOwnDescriptorTable !==
      true ||
    evidence.sessionCgroupFd !== 3 ||
    evidence.sessionCgroupRole !== "sessionCgroup" ||
    evidence.filesystem !== "cgroup2" ||
    evidence.type !== "domain\n" ||
    evidence.initialProcs !== "" ||
    evidence.memoryMax !== `${start.limits.memoryMaxBytes}\n` ||
    evidence.memorySwapMax !== "0\n" ||
    evidence.pidsMax !== `${start.limits.tasksMax}\n`
  ) {
    fail("READY status or reported evidence changed");
  }
  return deepFreeze(
    nullRecord([
      ["schema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["statusSequence", 0],
      ["state", "READY"],
      ["startRawSha256", body.startRawSha256],
      ["capsuleFrameRawSha256", body.capsuleFrameRawSha256],
      ["decisionRawSha256", null],
      ["bootstrapRequirementsSha256", body.bootstrapRequirementsSha256],
      ["evidence", deepFreeze(evidence)],
    ]),
  );
}

export function createCandidateContainmentSupervisorBootstrapCancelV3(value) {
  const input = exactRecord(
    value,
    ["startBytes", "capsuleFrameBytes", "readyBytes", "reason"],
    "cancel input",
    fail,
  );
  const start = parseStart(input.startBytes);
  const capsuleFrame =
    verifyCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
      startBytes: input.startBytes,
      capsuleFrameBytes: input.capsuleFrameBytes,
    });
  const ready = verifyReady(input.readyBytes, start, capsuleFrame);
  if (typeof input.reason !== "string" || !cancelReasons.has(input.reason)) {
    fail("cancel reason changed");
  }
  const body = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_SCHEMA_V3],
    ["commandSequence", 2],
    ["action", "CANCEL"],
    ["reason", input.reason],
    ["startRawSha256", start.rawSha256],
    ["capsuleFrameRawSha256", capsuleFrame.rawSha256],
    ["readyRawSha256", ready.rawSha256],
    ["ownerRequestSha256", start.ownerRequestSha256],
    ["generationSha256", start.generationSha256],
    ["guardianEpochSha256", start.guardianEpochSha256],
    ["guardianNonceSha256", start.guardianNonceSha256],
    ["bootstrapRequirementsSha256", start.bootstrapRequirementsSha256],
  ]);
  const bytes = canonicalJsonLine(body);
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_MAX_BYTES_V3
  ) {
    fail("cancel exceeds its byte ceiling");
  }
  return frozenCopyOnReadBytes(bytes, [
    [
      "artifact",
      artifact("candidate-containment-bootstrap-cancel-v2.json", bytes),
    ],
  ]);
}

function verifyCancel(bytesValue, start, capsuleFrame, ready) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    "CANCEL control bytes",
    CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_MAX_BYTES_V3,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "commandSequence",
      "action",
      "reason",
      "startRawSha256",
      "capsuleFrameRawSha256",
      "readyRawSha256",
      "ownerRequestSha256",
      "generationSha256",
      "guardianEpochSha256",
      "guardianNonceSha256",
      "bootstrapRequirementsSha256",
    ],
    "CANCEL body",
    fail,
  );
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_SCHEMA_V3 ||
    body.commandSequence !== 2 ||
    body.action !== "CANCEL" ||
    typeof body.reason !== "string" ||
    !cancelReasons.has(body.reason) ||
    body.startRawSha256 !== start.rawSha256 ||
    body.capsuleFrameRawSha256 !== capsuleFrame.rawSha256 ||
    body.readyRawSha256 !== ready.rawSha256 ||
    body.ownerRequestSha256 !== start.ownerRequestSha256 ||
    body.generationSha256 !== start.generationSha256 ||
    body.guardianEpochSha256 !== start.guardianEpochSha256 ||
    body.guardianNonceSha256 !== start.guardianNonceSha256 ||
    body.bootstrapRequirementsSha256 !== start.bootstrapRequirementsSha256
  ) {
    fail("CANCEL identity changed");
  }
  return deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_CONTROL_PROJECTION_SCHEMA_V3,
      ],
      ["protocolSchema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["commandSequence", 2],
      ["action", "CANCEL"],
      ["reason", body.reason],
      ["startRawSha256", body.startRawSha256],
      ["capsuleFrameRawSha256", body.capsuleFrameRawSha256],
      ["readyRawSha256", body.readyRawSha256],
      ["binding", null],
      ["physicalEligibility", false],
      ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_AUTHORITY_V3],
      ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_NONCLAIMS_V3],
    ]),
  );
}

function verifyTerminalStatus(
  bytesValue,
  state,
  sequence,
  context,
  previousRawSha256,
) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    `${state} status bytes`,
    CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_MAX_BYTES_V3,
    fail,
  );
  const body = exactRecord(
    decoded.value,
    [
      "schema",
      "statusSequence",
      "state",
      "startRawSha256",
      "capsuleFrameRawSha256",
      "decisionRawSha256",
      "previousStatusRawSha256",
      "ownerRequestSha256",
      "generationSha256",
      "guardianEpochSha256",
      "guardianNonceSha256",
      "bootstrapRequirementsSha256",
      "evidence",
    ],
    `${state} status body`,
    fail,
  );
  if (
    body.schema !==
      CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_STATUS_SCHEMA_V3 ||
    body.statusSequence !== sequence ||
    body.state !== state ||
    body.startRawSha256 !== context.start.rawSha256 ||
    body.capsuleFrameRawSha256 !== context.capsuleFrame.rawSha256 ||
    body.decisionRawSha256 !== context.cancel.rawSha256 ||
    body.previousStatusRawSha256 !== previousRawSha256 ||
    body.ownerRequestSha256 !== context.start.ownerRequestSha256 ||
    body.generationSha256 !== context.start.generationSha256 ||
    body.guardianEpochSha256 !== context.start.guardianEpochSha256 ||
    body.guardianNonceSha256 !== context.start.guardianNonceSha256 ||
    body.bootstrapRequirementsSha256 !==
      context.start.bootstrapRequirementsSha256
  ) {
    fail(`${state} identity changed`);
  }
  const keys =
    state === "CANCELLED_BEFORE_CLONE"
      ? [
          "cloneCommitStarted",
          "childCreated",
          "sessionCgroupFdClosed",
          "pidfdCreated",
          "cleanupOwner",
          "guardianCleanupRequired",
          "guardianCleanupObservedBySupervisor",
        ]
      : [
          "childCreated",
          "sessionCgroupFdClosed",
          "statusFrameIsFinal",
          "statusWriteClosureObservedBySupervisor",
          "guardianCleanupObservedBySupervisor",
        ];
  const evidence = exactRecord(body.evidence, keys, `${state} evidence`, fail);
  const valid =
    state === "CANCELLED_BEFORE_CLONE"
      ? evidence.cloneCommitStarted === false &&
        evidence.childCreated === false &&
        evidence.sessionCgroupFdClosed === true &&
        evidence.pidfdCreated === false &&
        evidence.cleanupOwner === "guardian" &&
        evidence.guardianCleanupRequired === true &&
        evidence.guardianCleanupObservedBySupervisor === null
      : evidence.childCreated === false &&
        evidence.sessionCgroupFdClosed === true &&
        evidence.statusFrameIsFinal === true &&
        evidence.statusWriteClosureObservedBySupervisor === null &&
        evidence.guardianCleanupObservedBySupervisor === null;
  if (!valid) fail(`${state} reported evidence changed`);
  return deepFreeze(
    nullRecord([
      ["schema", body.schema],
      ["byteLength", decoded.bytes.length],
      ["rawSha256", sha256(decoded.bytes)],
      ["statusSequence", sequence],
      ["state", state],
      ["startRawSha256", body.startRawSha256],
      ["capsuleFrameRawSha256", body.capsuleFrameRawSha256],
      ["decisionRawSha256", body.decisionRawSha256],
      ["previousStatusRawSha256", body.previousStatusRawSha256],
      ["bootstrapRequirementsSha256", body.bootstrapRequirementsSha256],
      ["evidence", deepFreeze(evidence)],
    ]),
  );
}

function snapshotObservation(value) {
  const observation = exactRecord(
    value,
    [
      "commandEofObserved",
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
    "bootstrap observation",
    fail,
  );
  const diagnosticsBytes = boundedInteger(
    observation.diagnosticsBytes,
    "bootstrap observation diagnosticsBytes",
    0,
    0,
    fail,
  );
  if (
    observation.commandEofObserved !== true ||
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
    fail("bootstrap observation changed");
  }
  return deepFreeze(observation);
}

function snapshotEvent(value, index) {
  return exactRecord(
    value,
    ["direction", "bytes"],
    `bootstrap event ${index}`,
    fail,
  );
}

export function verifyCandidateContainmentSupervisorBootstrapReplayV3(value) {
  const input = exactRecord(
    value,
    ["events", "observation"],
    "bootstrap replay input",
    fail,
  );
  const exactEvents = exactDenseArray(
    input.events,
    "bootstrap events",
    6,
    fail,
  );
  if (exactEvents.length !== 6) {
    fail("bootstrap event inventory changed");
  }
  const events = exactEvents.map(snapshotEvent);
  const directions = [
    "guardian-to-supervisor",
    "guardian-to-supervisor",
    "supervisor-to-guardian",
    "guardian-to-supervisor",
    "supervisor-to-guardian",
    "supervisor-to-guardian",
  ];
  if (events.some((event, index) => event.direction !== directions[index])) {
    fail("bootstrap event direction or order changed");
  }
  const start = parseStart(events[0].bytes);
  const capsuleFrame =
    verifyCandidateContainmentSupervisorBootstrapCapsuleFrameV3({
      startBytes: events[0].bytes,
      capsuleFrameBytes: events[1].bytes,
    });
  const ready = verifyReady(events[2].bytes, start, capsuleFrame);
  const cancel = verifyCancel(events[3].bytes, start, capsuleFrame, ready);
  const context = { start, capsuleFrame, ready, cancel };
  const cancelled = verifyTerminalStatus(
    events[4].bytes,
    "CANCELLED_BEFORE_CLONE",
    1,
    context,
    ready.rawSha256,
  );
  const done = verifyTerminalStatus(
    events[5].bytes,
    "SUPERVISOR_DONE",
    2,
    context,
    cancelled.rawSha256,
  );
  const observation = snapshotObservation(input.observation);
  const unsigned = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_REPLAY_SCHEMA_V3],
    ["status", "PRECOMMIT_BOOTSTRAP_CANCEL_REPLAYED"],
    [
      "states",
      Object.freeze([
        "START",
        "CAPSULE",
        "READY",
        "CANCEL",
        "CANCELLED_BEFORE_CLONE",
        "SUPERVISOR_DONE",
      ]),
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
    ["reportedSupervisorCapsuleValidated", true],
    ["supervisorCapsuleValidated", null],
    ["reportedRetainedFileDescriptorsExact", true],
    ["retainedFileDescriptorsExact", null],
    ["reportedSupervisorStatusFdOnlyMatchingWriterInOwnDescriptorTable", true],
    ["supervisorStatusFdOnlyMatchingWriterInOwnDescriptorTable", null],
    ["guardianLauncherStatusWriterCopiesClosed", null],
    ["soleStatusWriter", null],
    ["reportedChildCreated", false],
    ["childCreated", null],
    ["reportedSupervisorDone", true],
    ["supervisorDone", null],
    ["guardianCleanupRequired", true],
    ["guardianCleanupObserved", null],
    ["cleanupSafe", null],
    ["binding", null],
    ["physicalEligibility", false],
    ["finalDecisionEligible", false],
    ["authority", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_AUTHORITY_V3],
    ["nonclaims", CANDIDATE_CONTAINMENT_SUPERVISOR_BOOTSTRAP_NONCLAIMS_V3],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(unsigned),
      ["projectionSha256", canonicalSha256(unsigned)],
    ]),
  );
}
