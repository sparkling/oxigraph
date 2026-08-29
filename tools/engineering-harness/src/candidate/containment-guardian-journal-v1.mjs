import {
  canonicalJsonLine,
  decodeCanonicalJsonLine,
  deepFreeze,
  exactDenseArray,
  exactDigest,
  exactRecord,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";
import { canonicalSha256 } from "../routing/features.mjs";

export const CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_IDENTITY_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-generation-identity/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_RECORD_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-journal-record/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-journal-requirements/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REPLAY_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-journal-replay/v1";

const GENERATION_DERIVATION_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-generation-derivation/v1";
const EVIDENCE_SCHEMA_PREFIX_V1 =
  "oxigraph.candidate-containment-guardian-journal-evidence";
const OPERATION_SCHEMA_PREFIX_V1 =
  "oxigraph.candidate-containment-guardian-journal-operation";
const EVIDENCE_BINDING_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-journal-evidence-binding/v1";
const OPERATION_BINDING_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-journal-operation-binding/v1";

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORDS_V1 = 18;
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1 =
  16 * 1024;
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V1 = 16;
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V1 =
  "0".repeat(64);

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1 = Object.freeze([
  "ADMISSION_INTENT_DURABLE",
  "CGROUP_EFFECT_INTENT_DURABLE",
  "CGROUPS_CONFIGURED_EMPTY_OBSERVED",
  "SUPERVISOR_LAUNCH_INTENT_DURABLE",
  "SUPERVISOR_EXEC_OBSERVED",
  "LAUNCHER_DESCRIPTOR_CLOSURE_OBSERVED",
  "PREFLIGHT_READY_OBSERVED",
  "DECISION_CANCEL_DURABLE",
  "CANCEL_WRITE_COMPLETED",
  "CANCELLED_WITHOUT_CLONE_OBSERVED",
  "SUPERVISOR_DONE_OBSERVED",
  "STATUS_EOF_OBSERVED",
  "SUPERVISOR_REAPED_OBSERVED",
  "CLEANUP_INTENT_DURABLE",
  "CGROUPS_QUIESCENT_OBSERVED",
  "CGROUPS_REMOVED_OBSERVED",
  "GUARDIAN_DESCRIPTORS_CLOSED_OBSERVED",
  "CLOSED_DURABLE",
]);

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_EVIDENCE_SCHEMAS_V1 =
  deepFreeze(
    nullRecord(
      CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1.map((state) => [
        state,
        `${EVIDENCE_SCHEMA_PREFIX_V1}/${state.toLowerCase().replaceAll("_", "-")}/v1`,
      ]),
    ),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_OPERATION_SCHEMAS_V1 =
  deepFreeze(
    nullRecord(
      CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1.map((state) => [
        state,
        `${OPERATION_SCHEMA_PREFIX_V1}/${state.toLowerCase().replaceAll("_", "-")}/v1`,
      ]),
    ),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V1 = deepFreeze(
  nullRecord([
    ["mayMutateStateFilesystem", false],
    ["mayMutateDelegatedCgroup", false],
    ["maySignalPersistedPid", false],
    ["mayReapSupervisor", false],
    ["mayWriteSupervisorCommand", false],
    ["mayAcceptApplicationResult", false],
    ["mayIssueApplicationReceipt", false],
    ["mayRegisterRuntime", false],
    ["mayQualify", false],
    ["mayPromote", false],
    ["mayPublish", false],
    ["productionContainment", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_NONCLAIMS_V1 = deepFreeze(
  nullRecord([
    ["serializedReplayProvesFreshness", false],
    ["serializedReplayProvesFreshRandomness", false],
    ["serializedReplayProvesRecordOrigin", false],
    ["serializedReplayProvesExclusiveStateRootLock", false],
    ["serializedReplayProvesCompleteFilesystemInventory", false],
    ["serializedReplayProvesStateFilesystemMetadata", false],
    ["serializedReplayProvesFilesystemDurability", false],
    ["serializedReplayProvesGuardianExecution", false],
    ["serializedReplayProvesGuardianLiveness", false],
    ["serializedReplayProvesGuardianParentage", false],
    ["serializedActorDigestProvesProcessContinuity", false],
    ["serializedReplayProvesDelegatedRootIdentity", false],
    ["serializedReplayProvesSupervisorExecution", false],
    ["serializedReplayProvesDirectChildReap", false],
    ["serializedReplayProvesSupervisorExitStatus", false],
    ["serializedReplayProvesCgroupConfiguration", false],
    ["serializedReplayProvesCgroupCleanup", false],
    ["serializedReplayProvesApplicationResult", false],
    ["serializedReplayProvesRuntimeClosure", false],
    ["serializedReplayGrantsRecoveryMutationAuthority", false],
    ["completeRecordChainProvesOperationalRecoveryClearance", false],
    ["reportedOperationProjectionProvesEffect", false],
    ["reportedEvidenceProjectionProvesObservation", false],
    ["suppliedAnchorsProveTrustedOrigin", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PHYSICAL_FACTS_V1 =
  deepFreeze(
    nullRecord([
      ["journalFilesystemDurability", null],
      ["filesystemInventoryValidated", null],
      ["physicalRecoveryRequired", null],
      ["guardianExecuted", null],
      ["supervisorExecuted", null],
      ["supervisorReaped", null],
      ["supervisorExitStatus", null],
      ["applicationResult", null],
      ["cleanupSafe", null],
      ["delegatedCgroupsConfigured", null],
      ["delegatedCgroupsQuiescent", null],
      ["delegatedCgroupsRemoved", null],
      ["binding", null],
      ["physicalEligibility", false],
      ["finalDecisionEligibility", false],
      ["productionContainment", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V1 =
  deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SCHEMA_V1],
      [
        "generationIdentitySchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_IDENTITY_SCHEMA_V1,
      ],
      ["recordSchema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_RECORD_SCHEMA_V1],
      ["replaySchema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REPLAY_SCHEMA_V1],
      ["projectionHashAlgorithm", "sha256-canonical-json/v1"],
      ["rawHashAlgorithm", "sha256-canonical-jsonl-with-final-lf/v1"],
      ["operationBindingSchema", OPERATION_BINDING_SCHEMA_V1],
      ["evidenceBindingSchema", EVIDENCE_BINDING_SCHEMA_V1],
      ["recordFilename", "<16-digit-sequence>-<raw-sha256>.jsonl"],
      ["sequenceStartsAt", 1],
      [
        "sequenceWidth",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V1,
      ],
      ["maximumRecords", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORDS_V1],
      [
        "maximumRecordBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1,
      ],
      [
        "genesisRawSha256",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V1,
      ],
      ["states", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1],
      [
        "stateEvidenceSchemas",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_EVIDENCE_SCHEMAS_V1,
      ],
      [
        "stateOperationSchemas",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_OPERATION_SCHEMAS_V1,
      ],
      ["serializedNormalActorMustEqualBirthEpoch", true],
      ["serializedActorEqualityProvesProcessContinuity", false],
      ["inventoryOrder", "fixed-width-sequence-from-filename"],
      ["evidenceSemantics", "reported-state-bound-projection-digest-only"],
      ["operationSemantics", "reported-state-bound-projection-digest-only"],
      ["generationIdentityAnchorRequired", true],
      ["birthGuardianEpochAnchorRequired", true],
      ["latestRawRecordAnchorOptional", true],
      ["suppliedAnchorMatchingProvesOrigin", false],
      ["standaloneRecordHashChainValidated", false],
      ["reportedBootDigestComparisonProvesBootIdentity", false],
      ["incompletePrefixStatus", "VALID_RECORD_PREFIX_REPLAYED"],
      ["closedPrefixStatus", "COMPLETE_RECORD_CHAIN_REPLAYED"],
      ["completeChainProvesPhysicalRecoveryClearance", false],
      ["filesystemMechanicsImplemented", false],
      ["filesystemInventoryValidationImplemented", false],
      ["recoveryMutationImplemented", false],
      ["guardianImplemented", false],
      ["supervisorExecutionProven", false],
      ["payloadActionPermitted", false],
      ["applicationReceiptPermitted", false],
      ["runtimeRegistrationPermitted", false],
      ["qualificationPermitted", false],
      ["promotionPermitted", false],
      ["publicationPermitted", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1 =
  canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V1);

const IDENTITY_INPUT_FIELDS = Object.freeze([
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

const IDENTITY_BASE_FIELDS = Object.freeze([
  "schema",
  ...IDENTITY_INPUT_FIELDS,
  "controlGenerationSha256",
  "jobGenerationSha256",
  "guardianCgroupName",
  "controlCgroupName",
  "jobCgroupName",
]);

const IDENTITY_FIELDS = Object.freeze([
  ...IDENTITY_BASE_FIELDS,
  "identitySha256",
]);

const RECORD_FIELDS = Object.freeze([
  "schema",
  "sequence",
  "recordType",
  "priorState",
  "nextState",
  "previousRecordRawSha256",
  "generationIdentity",
  "actorGuardianEpochSha256",
  "operation",
  "evidence",
]);

const PROJECTION_BINDING_FIELDS = Object.freeze([
  "schema",
  "reportedProjectionSha256",
  "bindingSha256",
]);
const RECORD_REFERENCE_FIELDS = Object.freeze(["name", "bytes"]);
const CREATE_RECORD_FIELDS = Object.freeze([
  "generationIdentity",
  "state",
  "actorGuardianEpochSha256",
  "operationProjectionSha256",
  "evidenceProjectionSha256",
  "previousRecord",
]);
const REPLAY_FIELDS = Object.freeze([
  "records",
  "expectedGenerationIdentitySha256",
  "expectedBirthGuardianEpochSha256",
  "expectedLatestRecordRawSha256",
  "reportedCurrentBootIdSha256",
]);
const RECORD_FILENAME = /^([0-9]{16})-([0-9a-f]{64})\.jsonl$/u;
const journalArtifacts = new WeakSet();

function fail(message) {
  throw new Error(`candidate containment guardian journal v1: ${message}`);
}

function stateIndex(value, label) {
  if (typeof value !== "string") fail(`${label} is not an exact state`);
  const index = CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1.indexOf(value);
  if (index === -1) fail(`${label} is not an exact state`);
  return index;
}

function exactSequence(value, label) {
  if (typeof value !== "string" || !/^[0-9]{16}$/u.test(value)) {
    fail(`${label} is not a fixed-width sequence`);
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORDS_V1 ||
    String(parsed).padStart(
      CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V1,
      "0",
    ) !== value
  ) {
    fail(`${label} is outside the exact journal range`);
  }
  return parsed;
}

function sequenceText(value) {
  return String(value).padStart(
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V1,
    "0",
  );
}

function deriveGeneration(role, input) {
  return canonicalSha256(
    nullRecord([
      ["schema", GENERATION_DERIVATION_SCHEMA_V1],
      ["role", role],
      ["birthGuardianEpochSha256", input.birthGuardianEpochSha256],
      ["admissionGenerationSha256", input.admissionGenerationSha256],
    ]),
  );
}

function canonicalIdentity(input) {
  const controlGenerationSha256 = deriveGeneration("control", input);
  const jobGenerationSha256 = deriveGeneration("job", input);
  const base = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_IDENTITY_SCHEMA_V1],
    ...IDENTITY_INPUT_FIELDS.map((field) => [field, input[field]]),
    ["controlGenerationSha256", controlGenerationSha256],
    ["jobGenerationSha256", jobGenerationSha256],
    ["guardianCgroupName", `guardian-${input.birthGuardianEpochSha256}`],
    ["controlCgroupName", `ctl-${controlGenerationSha256}`],
    ["jobCgroupName", `job-${jobGenerationSha256}`],
  ]);
  return deepFreeze(
    nullRecord([
      ...IDENTITY_BASE_FIELDS.map((field) => [field, base[field]]),
      ["identitySha256", canonicalSha256(base)],
    ]),
  );
}

function normalizeGenerationIdentity(value, label) {
  const record = exactRecord(value, IDENTITY_FIELDS, label, fail);
  if (
    record.schema !==
    CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_IDENTITY_SCHEMA_V1
  ) {
    fail(`${label}.schema changed`);
  }
  for (const field of IDENTITY_INPUT_FIELDS) {
    exactDigest(record[field], `${label}.${field}`, fail);
  }
  exactDigest(
    record.controlGenerationSha256,
    `${label}.controlGenerationSha256`,
    fail,
  );
  exactDigest(record.jobGenerationSha256, `${label}.jobGenerationSha256`, fail);
  exactDigest(record.identitySha256, `${label}.identitySha256`, fail);
  const expected = canonicalIdentity(record);
  for (const field of IDENTITY_FIELDS) {
    if (record[field] !== expected[field]) fail(`${label}.${field} changed`);
  }
  return expected;
}

export function createCandidateContainmentGuardianGenerationIdentityV1(input) {
  const record = exactRecord(
    input,
    IDENTITY_INPUT_FIELDS,
    "generation identity input",
    fail,
  );
  for (const field of IDENTITY_INPUT_FIELDS) {
    exactDigest(record[field], `generation identity input.${field}`, fail);
  }
  return canonicalIdentity(record);
}

function projectionBindingSha256({
  kind,
  projectionSchema,
  sequence,
  state,
  generationIdentitySha256,
  actorGuardianEpochSha256,
  previousRecordRawSha256,
  reportedProjectionSha256,
}) {
  const schema =
    kind === "operation"
      ? OPERATION_BINDING_SCHEMA_V1
      : EVIDENCE_BINDING_SCHEMA_V1;
  return canonicalSha256(
    nullRecord([
      ["schema", schema],
      ["projectionSchema", projectionSchema],
      ["sequence", sequence],
      ["state", state],
      ["generationIdentitySha256", generationIdentitySha256],
      ["actorGuardianEpochSha256", actorGuardianEpochSha256],
      ["previousRecordRawSha256", previousRecordRawSha256],
      ["reportedProjectionSha256", reportedProjectionSha256],
    ]),
  );
}

function artifactFromRecord(name, bytes, record, rawSha256) {
  const artifact = frozenCopyOnReadBytes(bytes, [
    ["name", name],
    ["rawSha256", rawSha256],
    ["sequence", record.sequence],
    ["recordType", record.recordType],
    ["priorState", record.priorState],
    ["nextState", record.nextState],
    ["previousRecordRawSha256", record.previousRecordRawSha256],
    ["generationIdentity", record.generationIdentity],
    ["actorGuardianEpochSha256", record.actorGuardianEpochSha256],
    ["operation", record.operation],
    ["evidence", record.evidence],
    ["hashChainValidated", false],
  ]);
  journalArtifacts.add(artifact);
  return artifact;
}

function normalizeRecordReference(value, label) {
  if (
    value !== null &&
    typeof value === "object" &&
    journalArtifacts.has(value)
  ) {
    return value;
  }
  const reference = exactRecord(value, RECORD_REFERENCE_FIELDS, label, fail);
  return verifyCandidateContainmentGuardianJournalRecordV1(reference);
}

function normalizeProjectionBinding(
  value,
  {
    kind,
    state,
    sequence,
    generationIdentitySha256,
    actorGuardianEpochSha256,
    previousRecordRawSha256,
    label,
  },
) {
  const record = exactRecord(value, PROJECTION_BINDING_FIELDS, label, fail);
  const schemas =
    kind === "operation"
      ? CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_OPERATION_SCHEMAS_V1
      : CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_EVIDENCE_SCHEMAS_V1;
  if (record.schema !== schemas[state]) fail(`${label}.schema changed`);
  const reportedProjectionSha256 = exactDigest(
    record.reportedProjectionSha256,
    `${label}.reportedProjectionSha256`,
    fail,
  );
  const bindingSha256 = exactDigest(
    record.bindingSha256,
    `${label}.bindingSha256`,
    fail,
  );
  const expectedBindingSha256 = projectionBindingSha256({
    kind,
    projectionSchema: record.schema,
    sequence,
    state,
    generationIdentitySha256,
    actorGuardianEpochSha256,
    previousRecordRawSha256,
    reportedProjectionSha256,
  });
  if (bindingSha256 !== expectedBindingSha256) {
    fail(`${label}.bindingSha256 changed`);
  }
  return deepFreeze(
    nullRecord([
      ["schema", record.schema],
      ["reportedProjectionSha256", reportedProjectionSha256],
      ["bindingSha256", bindingSha256],
    ]),
  );
}

export function verifyCandidateContainmentGuardianJournalRecordV1(input) {
  const reference = exactRecord(
    input,
    RECORD_REFERENCE_FIELDS,
    "journal record reference",
    fail,
  );
  if (typeof reference.name !== "string")
    fail("journal record name is not text");
  const match = RECORD_FILENAME.exec(reference.name);
  if (match === null) fail("journal record name is not exact");
  const nameSequence = match[1];
  const nameRawSha256 = match[2];
  const nameSequenceNumber = exactSequence(
    nameSequence,
    "journal record name sequence",
  );
  const decoded = decodeCanonicalJsonLine(
    reference.bytes,
    "journal record bytes",
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1,
    fail,
  );
  const rawSha256 = sha256(decoded.bytes);
  if (rawSha256 !== nameRawSha256) fail("journal record filename hash changed");

  const record = exactRecord(
    decoded.value,
    RECORD_FIELDS,
    "journal record",
    fail,
  );
  if (
    record.schema !== CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_RECORD_SCHEMA_V1
  ) {
    fail("journal record.schema changed");
  }
  const sequenceNumber = exactSequence(
    record.sequence,
    "journal record.sequence",
  );
  if (sequenceNumber !== nameSequenceNumber) {
    fail("journal record sequence does not match its filename");
  }
  const nextStateIndex = stateIndex(
    record.nextState,
    "journal record.nextState",
  );
  if (record.recordType !== record.nextState) {
    fail("journal record.recordType changed");
  }
  if (sequenceNumber !== nextStateIndex + 1) {
    fail("journal record state does not match its sequence");
  }
  const expectedPriorState =
    nextStateIndex === 0
      ? null
      : CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[nextStateIndex - 1];
  if (record.priorState !== expectedPriorState) {
    fail("journal record.priorState changed");
  }
  exactDigest(
    record.previousRecordRawSha256,
    "journal record.previousRecordRawSha256",
    fail,
  );
  if (
    sequenceNumber === 1 &&
    record.previousRecordRawSha256 !==
      CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V1
  ) {
    fail("journal record genesis changed");
  }

  const generationIdentity = normalizeGenerationIdentity(
    record.generationIdentity,
    "journal record.generationIdentity",
  );
  const actorGuardianEpochSha256 = exactDigest(
    record.actorGuardianEpochSha256,
    "journal record.actorGuardianEpochSha256",
    fail,
  );
  if (
    actorGuardianEpochSha256 !== generationIdentity.birthGuardianEpochSha256
  ) {
    fail("journal record actor is not the birth guardian");
  }
  const projectionContext = {
    state: record.nextState,
    sequence: record.sequence,
    generationIdentitySha256: generationIdentity.identitySha256,
    actorGuardianEpochSha256,
    previousRecordRawSha256: record.previousRecordRawSha256,
  };
  const operation = normalizeProjectionBinding(record.operation, {
    ...projectionContext,
    kind: "operation",
    label: "journal record.operation",
  });
  const evidence = normalizeProjectionBinding(record.evidence, {
    ...projectionContext,
    kind: "evidence",
    label: "journal record.evidence",
  });
  const normalizedRecord = deepFreeze(
    nullRecord([
      ["schema", record.schema],
      ["sequence", record.sequence],
      ["recordType", record.recordType],
      ["priorState", record.priorState],
      ["nextState", record.nextState],
      ["previousRecordRawSha256", record.previousRecordRawSha256],
      ["generationIdentity", generationIdentity],
      ["actorGuardianEpochSha256", actorGuardianEpochSha256],
      ["operation", operation],
      ["evidence", evidence],
    ]),
  );
  return artifactFromRecord(
    reference.name,
    decoded.bytes,
    normalizedRecord,
    rawSha256,
  );
}

export function createCandidateContainmentGuardianJournalRecordV1(input) {
  const record = exactRecord(input, CREATE_RECORD_FIELDS, "record input", fail);
  const generationIdentity = normalizeGenerationIdentity(
    record.generationIdentity,
    "record input.generationIdentity",
  );
  const actorGuardianEpochSha256 = exactDigest(
    record.actorGuardianEpochSha256,
    "record input.actorGuardianEpochSha256",
    fail,
  );
  if (
    actorGuardianEpochSha256 !== generationIdentity.birthGuardianEpochSha256
  ) {
    fail("record input actor is not the birth guardian");
  }
  const operationProjectionSha256 = exactDigest(
    record.operationProjectionSha256,
    "record input.operationProjectionSha256",
    fail,
  );
  const evidenceProjectionSha256 = exactDigest(
    record.evidenceProjectionSha256,
    "record input.evidenceProjectionSha256",
    fail,
  );
  const requestedStateIndex = stateIndex(record.state, "record input.state");

  let previous = null;
  let expectedStateIndex = 0;
  let previousRecordRawSha256 =
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V1;
  if (record.previousRecord !== null) {
    previous = normalizeRecordReference(
      record.previousRecord,
      "record input.previousRecord",
    );
    const previousStateIndex = stateIndex(
      previous.nextState,
      "record input.previousRecord.nextState",
    );
    expectedStateIndex = previousStateIndex + 1;
    if (
      expectedStateIndex >=
      CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1.length
    ) {
      fail("record input cannot append after closure");
    }
    if (
      previous.generationIdentity.identitySha256 !==
      generationIdentity.identitySha256
    ) {
      fail("record input generation identity changed");
    }
    previousRecordRawSha256 = previous.rawSha256;
  }
  if (requestedStateIndex !== expectedStateIndex) {
    fail("record input does not follow the exact transition graph");
  }

  const sequence = sequenceText(expectedStateIndex + 1);
  const priorState = previous?.nextState ?? null;
  const nextState =
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[expectedStateIndex];
  const projectionContext = {
    sequence,
    state: nextState,
    generationIdentitySha256: generationIdentity.identitySha256,
    actorGuardianEpochSha256,
    previousRecordRawSha256,
  };
  const operationSchema =
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_OPERATION_SCHEMAS_V1[nextState];
  const operation = deepFreeze(
    nullRecord([
      ["schema", operationSchema],
      ["reportedProjectionSha256", operationProjectionSha256],
      [
        "bindingSha256",
        projectionBindingSha256({
          ...projectionContext,
          kind: "operation",
          projectionSchema: operationSchema,
          reportedProjectionSha256: operationProjectionSha256,
        }),
      ],
    ]),
  );
  const evidenceSchema =
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_EVIDENCE_SCHEMAS_V1[nextState];
  const evidence = deepFreeze(
    nullRecord([
      ["schema", evidenceSchema],
      ["reportedProjectionSha256", evidenceProjectionSha256],
      [
        "bindingSha256",
        projectionBindingSha256({
          ...projectionContext,
          kind: "evidence",
          projectionSchema: evidenceSchema,
          reportedProjectionSha256: evidenceProjectionSha256,
        }),
      ],
    ]),
  );
  const value = deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_RECORD_SCHEMA_V1],
      ["sequence", sequence],
      ["recordType", nextState],
      ["priorState", priorState],
      ["nextState", nextState],
      ["previousRecordRawSha256", previousRecordRawSha256],
      ["generationIdentity", generationIdentity],
      ["actorGuardianEpochSha256", actorGuardianEpochSha256],
      ["operation", operation],
      ["evidence", evidence],
    ]),
  );
  const bytes = canonicalJsonLine(value);
  if (
    bytes.length > CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1
  ) {
    fail("record bytes exceed the exact bound");
  }
  const rawSha256 = sha256(bytes);
  const name = `${sequence}-${rawSha256}.jsonl`;
  return artifactFromRecord(name, bytes, value, rawSha256);
}

export function replayCandidateContainmentGuardianJournalV1(input) {
  const replayInput = exactRecord(input, REPLAY_FIELDS, "replay input", fail);
  const recordReferences = exactDenseArray(
    replayInput.records,
    "replay input.records",
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORDS_V1,
    fail,
  );
  if (recordReferences.length === 0) fail("replay input has no durable record");
  const expectedGenerationIdentitySha256 = exactDigest(
    replayInput.expectedGenerationIdentitySha256,
    "replay input.expectedGenerationIdentitySha256",
    fail,
  );
  const expectedBirthGuardianEpochSha256 = exactDigest(
    replayInput.expectedBirthGuardianEpochSha256,
    "replay input.expectedBirthGuardianEpochSha256",
    fail,
  );
  const expectedLatestRecordRawSha256 =
    replayInput.expectedLatestRecordRawSha256 === null
      ? null
      : exactDigest(
          replayInput.expectedLatestRecordRawSha256,
          "replay input.expectedLatestRecordRawSha256",
          fail,
        );
  const reportedCurrentBootIdSha256 =
    replayInput.reportedCurrentBootIdSha256 === null
      ? null
      : exactDigest(
          replayInput.reportedCurrentBootIdSha256,
          "replay input.reportedCurrentBootIdSha256",
          fail,
        );
  const records = recordReferences.map((reference, index) =>
    normalizeRecordReference(reference, `replay input.records[${index}]`),
  );
  for (let left = 0; left < records.length; left += 1) {
    for (let right = left + 1; right < records.length; right += 1) {
      if (records[left].name === records[right].name) {
        fail("replay input has a duplicate filename");
      }
      if (records[left].sequence === records[right].sequence) {
        fail("replay input has multiple successors for one sequence");
      }
      if (records[left].rawSha256 === records[right].rawSha256) {
        fail("replay input has a duplicate raw record hash");
      }
    }
  }
  records.sort((left, right) => left.sequence.localeCompare(right.sequence));

  const generationIdentity = records[0].generationIdentity;
  if (generationIdentity.identitySha256 !== expectedGenerationIdentitySha256) {
    fail("replay input generation identity anchor changed");
  }
  if (
    generationIdentity.birthGuardianEpochSha256 !==
    expectedBirthGuardianEpochSha256
  ) {
    fail("replay input birth guardian epoch anchor changed");
  }
  let previousRawSha256 =
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V1;
  for (const [index, record] of records.entries()) {
    if (record.sequence !== sequenceText(index + 1)) {
      fail("replay input has a sequence gap");
    }
    if (record.previousRecordRawSha256 !== previousRawSha256) {
      fail("replay input raw hash chain changed");
    }
    if (
      record.generationIdentity.identitySha256 !==
      generationIdentity.identitySha256
    ) {
      fail("replay input generation identity drifted");
    }
    previousRawSha256 = record.rawSha256;
  }
  const latestRecordRawSha256 = records.at(-1).rawSha256;
  if (
    expectedLatestRecordRawSha256 !== null &&
    latestRecordRawSha256 !== expectedLatestRecordRawSha256
  ) {
    fail("replay input latest raw record anchor changed");
  }

  const recordCount = records.length;
  const chainComplete =
    recordCount === CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORDS_V1;
  const reportedLatestState = records.at(-1).nextState;
  const reportedNextExpectedState = chainComplete
    ? null
    : CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1[recordCount];
  const suppliedBootDigestRelationship =
    reportedCurrentBootIdSha256 === null
      ? "unknown"
      : reportedCurrentBootIdSha256 === generationIdentity.bootIdSha256
        ? "same-boot"
        : "different-boot";
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REPLAY_SCHEMA_V1],
      [
        "requirementsSha256",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1,
      ],
      [
        "status",
        chainComplete
          ? "COMPLETE_RECORD_CHAIN_REPLAYED"
          : "VALID_RECORD_PREFIX_REPLAYED",
      ],
      ["recordCount", recordCount],
      ["chainComplete", chainComplete],
      ["hashChainValidated", true],
      ["reportedLatestState", reportedLatestState],
      ["reportedNextExpectedState", reportedNextExpectedState],
      ["latestRecordRawSha256", latestRecordRawSha256],
      ["recordAppendRequired", !chainComplete],
      ["physicalRecoveryRequired", null],
      ["filesystemInventoryValidated", null],
      ["journalDurabilityObserved", null],
      ["generationIdentityAnchorMatched", true],
      ["birthGuardianEpochAnchorMatched", true],
      [
        "latestRawRecordAnchorMatched",
        expectedLatestRecordRawSha256 === null ? null : true,
      ],
      ["suppliedBootDigestRelationship", suppliedBootDigestRelationship],
      ["generationIdentity", generationIdentity],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V1],
      ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_NONCLAIMS_V1],
      [
        "physicalFacts",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PHYSICAL_FACTS_V1,
      ],
    ]),
  );
}
