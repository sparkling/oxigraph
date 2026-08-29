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
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_IDENTITY_SCHEMA_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1,
  createCandidateContainmentGuardianGenerationIdentityV1,
  replayCandidateContainmentGuardianJournalV1,
  verifyCandidateContainmentGuardianJournalRecordV1,
} from "./containment-guardian-journal-v1.mjs";
import { canonicalSha256 } from "../routing/features.mjs";

export const CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_SCHEMA_V2 =
  "oxigraph.candidate-containment-guardian-generation-manifest/v2";
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_SCHEMA_V2 =
  "oxigraph.candidate-containment-guardian-journal-bundle/v2";
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REPLAY_SCHEMA_V2 =
  "oxigraph.candidate-containment-guardian-journal-bundle-replay/v2";
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SCHEMA_V2 =
  "oxigraph.candidate-containment-guardian-journal-bundle-requirements/v2";

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_BUNDLES_V2 = 18;
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V2 = 16;
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V2 =
  "0".repeat(64);
export const CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_MAX_BYTES_V2 =
  16 * 1024;
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PROJECTION_MAX_BYTES_V2 =
  16 * 1024;
export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_MAX_BYTES_V2 =
  96 * 1024;

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V2 = deepFreeze(
  nullRecord([
    ["mayPersistGenerationManifest", false],
    ["mayPersistJournalBundle", false],
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

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_NONCLAIMS_V2 = deepFreeze(
  nullRecord([
    ["serializedReplayProvesFreshness", false],
    ["serializedReplayProvesFreshRandomness", false],
    ["serializedReplayProvesArtifactOrigin", false],
    ["serializedReplayProvesExclusiveStateRootLock", false],
    ["serializedReplayProvesCompleteFilesystemInventory", false],
    ["serializedReplayProvesStateFilesystemMetadata", false],
    ["serializedReplayProvesFilesystemDurability", false],
    ["serializedReplayProvesGuardianExecution", false],
    ["serializedReplayProvesGuardianLiveness", false],
    ["serializedReplayProvesGuardianParentage", false],
    ["serializedActorDigestProvesProcessContinuity", false],
    ["reportedBootDigestComparisonProvesBootIdentity", false],
    ["serializedReplayProvesDelegatedRootIdentity", false],
    ["serializedReplayProvesSupervisorExecution", false],
    ["serializedReplayProvesDirectChildReap", false],
    ["serializedReplayProvesSupervisorExitStatus", false],
    ["serializedReplayProvesCgroupConfiguration", false],
    ["serializedReplayProvesCgroupCleanup", false],
    ["serializedReplayProvesApplicationResult", false],
    ["serializedReplayProvesRuntimeClosure", false],
    ["serializedReplayGrantsRecoveryMutationAuthority", false],
    ["completeBundleChainProvesOperationalRecoveryClearance", false],
    ["embeddedOperationArtifactProvesEffect", false],
    ["embeddedEvidenceArtifactProvesObservation", false],
    ["embeddedJournalRecordProvesTrustedOrigin", false],
    ["canonicalBase64ProvesPersistence", false],
    ["suppliedAnchorsProveTrustedOrigin", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PHYSICAL_FACTS_V2 =
  deepFreeze(
    nullRecord([
      ["generationManifestPersisted", null],
      ["journalBundlePersisted", null],
      ["journalFilesystemDurability", null],
      ["filesystemInventoryValidated", null],
      ["physicalRecoveryRequired", null],
      ["operationEffectObserved", null],
      ["evidenceObservationEstablished", null],
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

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2 =
  deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SCHEMA_V2],
      [
        "generationIdentitySchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_IDENTITY_SCHEMA_V1,
      ],
      [
        "generationManifestSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_SCHEMA_V2,
      ],
      ["bundleSchema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_SCHEMA_V2],
      ["replaySchema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REPLAY_SCHEMA_V2],
      [
        "journalV1RequirementsSha256",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1,
      ],
      ["generationManifestFilename", "generation.jsonl"],
      ["bundleFilename", "<16-digit-sequence>-<bundle-raw-sha256>.jsonl"],
      ["embeddedBytesEncoding", "rfc4648-canonical-padded-base64"],
      ["rawHashAlgorithm", "sha256-canonical-jsonl-with-final-lf/v1"],
      ["semanticHashAlgorithm", "sha256-canonical-json-without-final-lf/v1"],
      ["sequenceStartsAt", 1],
      [
        "sequenceWidth",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V2,
      ],
      ["maximumBundles", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_BUNDLES_V2],
      [
        "maximumGenerationManifestBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_MAX_BYTES_V2,
      ],
      [
        "maximumInnerJournalRecordBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1,
      ],
      [
        "maximumOperationOrEvidenceBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PROJECTION_MAX_BYTES_V2,
      ],
      [
        "maximumBundleBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_MAX_BYTES_V2,
      ],
      [
        "genesisRawSha256",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V2,
      ],
      ["states", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_STATES_V1],
      ["operationAndEvidencePayloadShape", "opaque-bounded-canonical-json"],
      ["operationAndEvidenceSemanticsInterpreted", false],
      ["innerJournalV1IndependentlyVerified", true],
      ["innerAndBundlePredecessorsAdvanceTogether", true],
      ["standaloneBundleHashChainValidated", false],
      ["reportedBootDigestComparisonProvesBootIdentity", false],
      ["incompletePrefixStatus", "VALID_BUNDLE_PREFIX_REPLAYED"],
      ["closedPrefixStatus", "COMPLETE_BUNDLE_CHAIN_REPLAYED"],
      ["completeChainProvesPhysicalRecoveryClearance", false],
      ["filesystemMechanicsImplemented", false],
      ["filesystemInventoryValidationImplemented", false],
      ["recoveryMutationImplemented", false],
      ["guardianImplemented", false],
      ["supervisorExecutionProven", false],
      ["applicationReceiptPermitted", false],
      ["runtimeRegistrationPermitted", false],
      ["qualificationPermitted", false],
      ["promotionPermitted", false],
      ["publicationPermitted", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V2 =
  canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2);

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

const IDENTITY_FIELDS = Object.freeze([
  "schema",
  ...IDENTITY_INPUT_FIELDS,
  "controlGenerationSha256",
  "jobGenerationSha256",
  "guardianCgroupName",
  "controlCgroupName",
  "jobCgroupName",
  "identitySha256",
]);

const MANIFEST_FIELDS = Object.freeze([
  "schema",
  "generationIdentity",
  "generationIdentitySha256",
  "birthGuardianEpochSha256",
  "bootIdSha256",
  "admissionGenerationSha256",
  "controlGenerationSha256",
  "jobGenerationSha256",
  "guardianCgroupName",
  "controlCgroupName",
  "jobCgroupName",
  "journalV1RequirementsSha256",
]);
const MANIFEST_CREATE_FIELDS = Object.freeze(["generationIdentity"]);
const ARTIFACT_REFERENCE_FIELDS = Object.freeze(["name", "bytes"]);
const ARTIFACT_DESCRIPTOR_FIELDS = Object.freeze([
  "rawSha256",
  "semanticSha256",
  "bytesBase64",
]);
const INNER_ARTIFACT_DESCRIPTOR_FIELDS = Object.freeze([
  "name",
  ...ARTIFACT_DESCRIPTOR_FIELDS,
]);
const BUNDLE_FIELDS = Object.freeze([
  "schema",
  "sequence",
  "recordType",
  "priorState",
  "nextState",
  "previousBundleRawSha256",
  "generationIdentitySha256",
  "birthGuardianEpochSha256",
  "actorGuardianEpochSha256",
  "bootIdSha256",
  "admissionGenerationSha256",
  "controlGenerationSha256",
  "jobGenerationSha256",
  "innerJournalRecord",
  "operationArtifact",
  "evidenceArtifact",
]);
const BUNDLE_CREATE_FIELDS = Object.freeze([
  "journalRecord",
  "operationBytes",
  "evidenceBytes",
  "previousBundle",
]);
const REPLAY_FIELDS = Object.freeze([
  "bundles",
  "expectedGenerationIdentitySha256",
  "expectedBirthGuardianEpochSha256",
  "expectedLatestBundleRawSha256",
  "reportedCurrentBootIdSha256",
]);
const BUNDLE_FILENAME = /^([0-9]{16})-([0-9a-f]{64})\.jsonl$/u;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const bundleArtifacts = new WeakSet();

function fail(message) {
  throw new Error(`candidate containment guardian journal v2: ${message}`);
}

function exactSequence(value, label) {
  if (typeof value !== "string" || !/^[0-9]{16}$/u.test(value)) {
    fail(`${label} is not a fixed-width sequence`);
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_BUNDLES_V2 ||
    String(parsed).padStart(
      CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V2,
      "0",
    ) !== value
  ) {
    fail(`${label} is outside the exact bundle range`);
  }
  return parsed;
}

function sequenceText(value) {
  return String(value).padStart(
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_SEQUENCE_WIDTH_V2,
    "0",
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
  const input = exactRecord(
    nullRecord(IDENTITY_INPUT_FIELDS.map((field) => [field, record[field]])),
    IDENTITY_INPUT_FIELDS,
    `${label} input projection`,
    fail,
  );
  const expected =
    createCandidateContainmentGuardianGenerationIdentityV1(input);
  for (const field of IDENTITY_FIELDS) {
    if (record[field] !== expected[field]) fail(`${label}.${field} changed`);
  }
  return expected;
}

function canonicalManifest(generationIdentity) {
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_SCHEMA_V2],
      ["generationIdentity", generationIdentity],
      ["generationIdentitySha256", generationIdentity.identitySha256],
      ["birthGuardianEpochSha256", generationIdentity.birthGuardianEpochSha256],
      ["bootIdSha256", generationIdentity.bootIdSha256],
      [
        "admissionGenerationSha256",
        generationIdentity.admissionGenerationSha256,
      ],
      ["controlGenerationSha256", generationIdentity.controlGenerationSha256],
      ["jobGenerationSha256", generationIdentity.jobGenerationSha256],
      ["guardianCgroupName", generationIdentity.guardianCgroupName],
      ["controlCgroupName", generationIdentity.controlCgroupName],
      ["jobCgroupName", generationIdentity.jobCgroupName],
      [
        "journalV1RequirementsSha256",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1,
      ],
    ]),
  );
}

function manifestArtifact(bytes, value) {
  return frozenCopyOnReadBytes(bytes, [
    ["name", "generation.jsonl"],
    ["rawSha256", sha256(bytes)],
    ["semanticSha256", canonicalSha256(value)],
    ...MANIFEST_FIELDS.map((field) => [field, value[field]]),
  ]);
}

export function createCandidateContainmentGuardianGenerationManifestV2(input) {
  const createInput = exactRecord(
    input,
    MANIFEST_CREATE_FIELDS,
    "generation manifest input",
    fail,
  );
  const generationIdentity = normalizeGenerationIdentity(
    createInput.generationIdentity,
    "generation manifest input.generationIdentity",
  );
  const value = canonicalManifest(generationIdentity);
  const bytes = canonicalJsonLine(value);
  if (
    bytes.length >
    CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_MAX_BYTES_V2
  ) {
    fail("generation manifest bytes exceed the exact bound");
  }
  return manifestArtifact(bytes, value);
}

export function verifyCandidateContainmentGuardianGenerationManifestV2(input) {
  const reference = exactRecord(
    input,
    ARTIFACT_REFERENCE_FIELDS,
    "generation manifest reference",
    fail,
  );
  if (reference.name !== "generation.jsonl") {
    fail("generation manifest name changed");
  }
  const decoded = decodeCanonicalJsonLine(
    reference.bytes,
    "generation manifest bytes",
    CANDIDATE_CONTAINMENT_GUARDIAN_GENERATION_MANIFEST_MAX_BYTES_V2,
    fail,
  );
  const record = exactRecord(
    decoded.value,
    MANIFEST_FIELDS,
    "generation manifest",
    fail,
  );
  const generationIdentity = normalizeGenerationIdentity(
    record.generationIdentity,
    "generation manifest.generationIdentity",
  );
  const expected = canonicalManifest(generationIdentity);
  for (const field of MANIFEST_FIELDS.filter(
    (candidate) => candidate !== "generationIdentity",
  )) {
    if (record[field] !== expected[field]) {
      fail(`generation manifest.${field} changed`);
    }
  }
  return manifestArtifact(decoded.bytes, expected);
}

function decodeCanonicalBase64(value, label, maximumBytes) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4 * Math.ceil(maximumBytes / 3) ||
    !CANONICAL_BASE64.test(value)
  ) {
    fail(`${label} is not bounded canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail(`${label} is not canonical base64`);
  }
  return bytes;
}

function artifactDescriptor(bytes, value) {
  return deepFreeze(
    nullRecord([
      ["rawSha256", sha256(bytes)],
      ["semanticSha256", canonicalSha256(value)],
      ["bytesBase64", bytes.toString("base64")],
    ]),
  );
}

function normalizedOpaqueArtifactFromBytes(bytesValue, label) {
  const decoded = decodeCanonicalJsonLine(
    bytesValue,
    `${label} bytes`,
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PROJECTION_MAX_BYTES_V2,
    fail,
  );
  const descriptor = artifactDescriptor(decoded.bytes, decoded.value);
  return {
    descriptor,
    artifact: frozenCopyOnReadBytes(decoded.bytes, [
      ...ARTIFACT_DESCRIPTOR_FIELDS.map((field) => [field, descriptor[field]]),
    ]),
  };
}

function normalizeOpaqueArtifactDescriptor(value, label) {
  const descriptor = exactRecord(
    value,
    ARTIFACT_DESCRIPTOR_FIELDS,
    label,
    fail,
  );
  exactDigest(descriptor.rawSha256, `${label}.rawSha256`, fail);
  exactDigest(descriptor.semanticSha256, `${label}.semanticSha256`, fail);
  const bytes = decodeCanonicalBase64(
    descriptor.bytesBase64,
    `${label}.bytesBase64`,
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PROJECTION_MAX_BYTES_V2,
  );
  const decoded = decodeCanonicalJsonLine(
    bytes,
    `${label} decoded bytes`,
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PROJECTION_MAX_BYTES_V2,
    fail,
  );
  if (sha256(decoded.bytes) !== descriptor.rawSha256) {
    fail(`${label}.rawSha256 changed`);
  }
  if (canonicalSha256(decoded.value) !== descriptor.semanticSha256) {
    fail(`${label}.semanticSha256 changed`);
  }
  return {
    descriptor: deepFreeze(
      nullRecord(
        ARTIFACT_DESCRIPTOR_FIELDS.map((field) => [field, descriptor[field]]),
      ),
    ),
    artifact: frozenCopyOnReadBytes(decoded.bytes, [
      ...ARTIFACT_DESCRIPTOR_FIELDS.map((field) => [field, descriptor[field]]),
    ]),
  };
}

function innerDescriptorFromRecord(record) {
  const bytes = record.bytes;
  const decoded = decodeCanonicalJsonLine(
    bytes,
    "inner journal record bytes",
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1,
    fail,
  );
  return deepFreeze(
    nullRecord([
      ["name", record.name],
      ["rawSha256", record.rawSha256],
      ["semanticSha256", canonicalSha256(decoded.value)],
      ["bytesBase64", bytes.toString("base64")],
    ]),
  );
}

function verifyInnerJournalRecord(reference, label) {
  try {
    return verifyCandidateContainmentGuardianJournalRecordV1(reference);
  } catch {
    fail(`${label} does not independently verify as journal v1`);
  }
}

function normalizeInnerArtifactDescriptor(value, label) {
  const descriptor = exactRecord(
    value,
    INNER_ARTIFACT_DESCRIPTOR_FIELDS,
    label,
    fail,
  );
  if (typeof descriptor.name !== "string") fail(`${label}.name is not text`);
  exactDigest(descriptor.rawSha256, `${label}.rawSha256`, fail);
  exactDigest(descriptor.semanticSha256, `${label}.semanticSha256`, fail);
  const bytes = decodeCanonicalBase64(
    descriptor.bytesBase64,
    `${label}.bytesBase64`,
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1,
  );
  const decoded = decodeCanonicalJsonLine(
    bytes,
    `${label} decoded bytes`,
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_RECORD_BYTES_V1,
    fail,
  );
  if (sha256(decoded.bytes) !== descriptor.rawSha256) {
    fail(`${label}.rawSha256 changed`);
  }
  if (canonicalSha256(decoded.value) !== descriptor.semanticSha256) {
    fail(`${label}.semanticSha256 changed`);
  }
  const record = verifyInnerJournalRecord(
    { name: descriptor.name, bytes: decoded.bytes },
    label,
  );
  if (record.rawSha256 !== descriptor.rawSha256) {
    fail(`${label} does not bind the verified v1 record`);
  }
  const normalizedDescriptor = deepFreeze(
    nullRecord(
      INNER_ARTIFACT_DESCRIPTOR_FIELDS.map((field) => [
        field,
        descriptor[field],
      ]),
    ),
  );
  return {
    descriptor: normalizedDescriptor,
    record,
    artifact: frozenCopyOnReadBytes(decoded.bytes, [
      ["name", descriptor.name],
      ...ARTIFACT_DESCRIPTOR_FIELDS.map((field) => [field, descriptor[field]]),
    ]),
  };
}

function bundleArtifact(
  name,
  bytes,
  value,
  innerJournalRecord,
  operationArtifact,
  evidenceArtifact,
) {
  const artifact = frozenCopyOnReadBytes(bytes, [
    ["name", name],
    ["rawSha256", sha256(bytes)],
    ["semanticSha256", canonicalSha256(value)],
    ...BUNDLE_FIELDS.slice(0, -3).map((field) => [field, value[field]]),
    ["innerJournalRecord", innerJournalRecord],
    ["operationArtifact", operationArtifact],
    ["evidenceArtifact", evidenceArtifact],
    ["bundleHashChainValidated", false],
    ["innerJournalHashChainValidated", false],
    ["embeddedArtifactBindingsValidated", true],
  ]);
  bundleArtifacts.add(artifact);
  return artifact;
}

function normalizeBundleReference(value, label) {
  if (
    value !== null &&
    typeof value === "object" &&
    bundleArtifacts.has(value)
  ) {
    return value;
  }
  const reference = exactRecord(value, ARTIFACT_REFERENCE_FIELDS, label, fail);
  return verifyCandidateContainmentGuardianJournalBundleV2(reference);
}

function assertRepeatedIdentity(value, record, label) {
  const identity = record.generationIdentity;
  const expected = {
    generationIdentitySha256: identity.identitySha256,
    birthGuardianEpochSha256: identity.birthGuardianEpochSha256,
    actorGuardianEpochSha256: record.actorGuardianEpochSha256,
    bootIdSha256: identity.bootIdSha256,
    admissionGenerationSha256: identity.admissionGenerationSha256,
    controlGenerationSha256: identity.controlGenerationSha256,
    jobGenerationSha256: identity.jobGenerationSha256,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    exactDigest(value[field], `${label}.${field}`, fail);
    if (value[field] !== expectedValue) fail(`${label}.${field} changed`);
  }
}

export function verifyCandidateContainmentGuardianJournalBundleV2(input) {
  const reference = exactRecord(
    input,
    ARTIFACT_REFERENCE_FIELDS,
    "journal bundle reference",
    fail,
  );
  if (typeof reference.name !== "string")
    fail("journal bundle name is not text");
  const match = BUNDLE_FILENAME.exec(reference.name);
  if (match === null) fail("journal bundle name is not exact");
  const nameSequence = match[1];
  const nameRawSha256 = match[2];
  const nameSequenceNumber = exactSequence(
    nameSequence,
    "journal bundle name sequence",
  );
  const decoded = decodeCanonicalJsonLine(
    reference.bytes,
    "journal bundle bytes",
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_MAX_BYTES_V2,
    fail,
  );
  const rawSha256 = sha256(decoded.bytes);
  if (rawSha256 !== nameRawSha256) fail("journal bundle filename hash changed");
  const value = exactRecord(
    decoded.value,
    BUNDLE_FIELDS,
    "journal bundle",
    fail,
  );
  if (
    value.schema !== CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_SCHEMA_V2
  ) {
    fail("journal bundle.schema changed");
  }
  const sequenceNumber = exactSequence(
    value.sequence,
    "journal bundle.sequence",
  );
  if (sequenceNumber !== nameSequenceNumber) {
    fail("journal bundle sequence does not match its filename");
  }
  exactDigest(
    value.previousBundleRawSha256,
    "journal bundle.previousBundleRawSha256",
    fail,
  );
  if (
    sequenceNumber === 1 &&
    value.previousBundleRawSha256 !==
      CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V2
  ) {
    fail("journal bundle genesis changed");
  }

  const inner = normalizeInnerArtifactDescriptor(
    value.innerJournalRecord,
    "journal bundle.innerJournalRecord",
  );
  const operation = normalizeOpaqueArtifactDescriptor(
    value.operationArtifact,
    "journal bundle.operationArtifact",
  );
  const evidence = normalizeOpaqueArtifactDescriptor(
    value.evidenceArtifact,
    "journal bundle.evidenceArtifact",
  );
  if (inner.record.sequence !== value.sequence) {
    fail("journal bundle inner sequence changed");
  }
  for (const field of ["recordType", "priorState", "nextState"]) {
    if (value[field] !== inner.record[field]) {
      fail(`journal bundle.${field} changed`);
    }
  }
  assertRepeatedIdentity(value, inner.record, "journal bundle");
  if (
    operation.descriptor.semanticSha256 !==
    inner.record.operation.reportedProjectionSha256
  ) {
    fail("journal bundle operation semantic digest changed");
  }
  if (
    evidence.descriptor.semanticSha256 !==
    inner.record.evidence.reportedProjectionSha256
  ) {
    fail("journal bundle evidence semantic digest changed");
  }
  const normalizedValue = deepFreeze(
    nullRecord([
      ...BUNDLE_FIELDS.slice(0, -3).map((field) => [field, value[field]]),
      ["innerJournalRecord", inner.descriptor],
      ["operationArtifact", operation.descriptor],
      ["evidenceArtifact", evidence.descriptor],
    ]),
  );
  return bundleArtifact(
    reference.name,
    decoded.bytes,
    normalizedValue,
    inner.artifact,
    operation.artifact,
    evidence.artifact,
  );
}

export function createCandidateContainmentGuardianJournalBundleV2(input) {
  const createInput = exactRecord(
    input,
    BUNDLE_CREATE_FIELDS,
    "journal bundle input",
    fail,
  );
  const journalReference = exactRecord(
    createInput.journalRecord,
    ARTIFACT_REFERENCE_FIELDS,
    "journal bundle input.journalRecord",
    fail,
  );
  const journalRecord = verifyInnerJournalRecord(
    journalReference,
    "journal bundle input.journalRecord",
  );
  const operation = normalizedOpaqueArtifactFromBytes(
    createInput.operationBytes,
    "journal bundle input.operation",
  );
  const evidence = normalizedOpaqueArtifactFromBytes(
    createInput.evidenceBytes,
    "journal bundle input.evidence",
  );
  if (
    operation.descriptor.semanticSha256 !==
    journalRecord.operation.reportedProjectionSha256
  ) {
    fail("journal bundle input operation semantic digest changed");
  }
  if (
    evidence.descriptor.semanticSha256 !==
    journalRecord.evidence.reportedProjectionSha256
  ) {
    fail("journal bundle input evidence semantic digest changed");
  }

  const sequenceNumber = exactSequence(
    journalRecord.sequence,
    "journal bundle input journal sequence",
  );
  let previousBundleRawSha256 =
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V2;
  if (createInput.previousBundle === null) {
    if (sequenceNumber !== 1) {
      fail("journal bundle input has no v2 predecessor");
    }
  } else {
    const previous = normalizeBundleReference(
      createInput.previousBundle,
      "journal bundle input.previousBundle",
    );
    const previousSequenceNumber = exactSequence(
      previous.sequence,
      "journal bundle input.previousBundle.sequence",
    );
    if (sequenceNumber !== previousSequenceNumber + 1) {
      fail("journal bundle input does not follow the exact transition graph");
    }
    if (
      journalRecord.generationIdentity.identitySha256 !==
      previous.generationIdentitySha256
    ) {
      fail("journal bundle input generation identity changed");
    }
    if (
      journalRecord.previousRecordRawSha256 !==
      previous.innerJournalRecord.rawSha256
    ) {
      fail("journal bundle input inner and v2 predecessors diverged");
    }
    previousBundleRawSha256 = previous.rawSha256;
  }

  const innerDescriptor = innerDescriptorFromRecord(journalRecord);
  const identity = journalRecord.generationIdentity;
  const value = deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_SCHEMA_V2],
      ["sequence", journalRecord.sequence],
      ["recordType", journalRecord.recordType],
      ["priorState", journalRecord.priorState],
      ["nextState", journalRecord.nextState],
      ["previousBundleRawSha256", previousBundleRawSha256],
      ["generationIdentitySha256", identity.identitySha256],
      ["birthGuardianEpochSha256", identity.birthGuardianEpochSha256],
      ["actorGuardianEpochSha256", journalRecord.actorGuardianEpochSha256],
      ["bootIdSha256", identity.bootIdSha256],
      ["admissionGenerationSha256", identity.admissionGenerationSha256],
      ["controlGenerationSha256", identity.controlGenerationSha256],
      ["jobGenerationSha256", identity.jobGenerationSha256],
      ["innerJournalRecord", innerDescriptor],
      ["operationArtifact", operation.descriptor],
      ["evidenceArtifact", evidence.descriptor],
    ]),
  );
  const bytes = canonicalJsonLine(value);
  if (
    bytes.length > CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_BUNDLE_MAX_BYTES_V2
  ) {
    fail("journal bundle bytes exceed the exact bound");
  }
  const rawSha256 = sha256(bytes);
  const name = `${journalRecord.sequence}-${rawSha256}.jsonl`;
  return bundleArtifact(
    name,
    bytes,
    value,
    frozenCopyOnReadBytes(journalRecord.bytes, [
      ["name", innerDescriptor.name],
      ...ARTIFACT_DESCRIPTOR_FIELDS.map((field) => [
        field,
        innerDescriptor[field],
      ]),
    ]),
    operation.artifact,
    evidence.artifact,
  );
}

export function replayCandidateContainmentGuardianJournalV2(input) {
  const replayInput = exactRecord(input, REPLAY_FIELDS, "replay input", fail);
  const bundleReferences = exactDenseArray(
    replayInput.bundles,
    "replay input.bundles",
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_BUNDLES_V2,
    fail,
  );
  if (bundleReferences.length === 0) fail("replay input has no durable bundle");
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
  const expectedLatestBundleRawSha256 =
    replayInput.expectedLatestBundleRawSha256 === null
      ? null
      : exactDigest(
          replayInput.expectedLatestBundleRawSha256,
          "replay input.expectedLatestBundleRawSha256",
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
  const bundles = bundleReferences.map((reference, index) =>
    normalizeBundleReference(reference, `replay input.bundles[${index}]`),
  );
  for (let left = 0; left < bundles.length; left += 1) {
    for (let right = left + 1; right < bundles.length; right += 1) {
      if (bundles[left].name === bundles[right].name) {
        fail("replay input has a duplicate filename");
      }
      if (bundles[left].sequence === bundles[right].sequence) {
        fail("replay input has multiple successors for one sequence");
      }
      if (bundles[left].rawSha256 === bundles[right].rawSha256) {
        fail("replay input has a duplicate raw bundle hash");
      }
    }
  }
  bundles.sort((left, right) => left.sequence.localeCompare(right.sequence));
  if (
    bundles[0].generationIdentitySha256 !== expectedGenerationIdentitySha256
  ) {
    fail("replay input generation identity anchor changed");
  }
  if (
    bundles[0].birthGuardianEpochSha256 !== expectedBirthGuardianEpochSha256
  ) {
    fail("replay input birth guardian epoch anchor changed");
  }

  let previousBundleRawSha256 =
    CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_GENESIS_RAW_SHA256_V2;
  for (const [index, bundle] of bundles.entries()) {
    if (bundle.sequence !== sequenceText(index + 1)) {
      fail("replay input has a sequence gap");
    }
    if (bundle.previousBundleRawSha256 !== previousBundleRawSha256) {
      fail("replay input raw bundle hash chain changed");
    }
    if (bundle.generationIdentitySha256 !== expectedGenerationIdentitySha256) {
      fail("replay input generation identity drifted");
    }
    if (bundle.birthGuardianEpochSha256 !== expectedBirthGuardianEpochSha256) {
      fail("replay input birth guardian epoch drifted");
    }
    previousBundleRawSha256 = bundle.rawSha256;
  }
  const latestBundleRawSha256 = bundles.at(-1).rawSha256;
  if (
    expectedLatestBundleRawSha256 !== null &&
    latestBundleRawSha256 !== expectedLatestBundleRawSha256
  ) {
    fail("replay input latest raw bundle anchor changed");
  }

  const innerReplay = replayCandidateContainmentGuardianJournalV1({
    records: bundles.map((bundle) => ({
      name: bundle.innerJournalRecord.name,
      bytes: bundle.innerJournalRecord.bytes,
    })),
    expectedGenerationIdentitySha256,
    expectedBirthGuardianEpochSha256,
    expectedLatestRecordRawSha256: bundles.at(-1).innerJournalRecord.rawSha256,
    reportedCurrentBootIdSha256,
  });
  if (innerReplay.recordCount !== bundles.length) {
    fail("replay input inner and v2 chain lengths changed");
  }
  const chainComplete =
    bundles.length === CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_MAX_BUNDLES_V2;
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REPLAY_SCHEMA_V2],
      [
        "requirementsSha256",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V2,
      ],
      [
        "status",
        chainComplete
          ? "COMPLETE_BUNDLE_CHAIN_REPLAYED"
          : "VALID_BUNDLE_PREFIX_REPLAYED",
      ],
      ["bundleCount", bundles.length],
      ["chainComplete", chainComplete],
      ["bundleHashChainValidated", true],
      ["innerJournalHashChainValidated", true],
      ["embeddedArtifactBindingsValidated", true],
      ["reportedLatestState", innerReplay.reportedLatestState],
      ["reportedNextExpectedState", innerReplay.reportedNextExpectedState],
      ["latestBundleRawSha256", latestBundleRawSha256],
      ["latestInnerRecordRawSha256", innerReplay.latestRecordRawSha256],
      ["bundleAppendRequired", !chainComplete],
      ["generationIdentityAnchorMatched", true],
      ["birthGuardianEpochAnchorMatched", true],
      [
        "latestBundleRawAnchorMatched",
        expectedLatestBundleRawSha256 === null ? null : true,
      ],
      [
        "suppliedBootDigestRelationship",
        innerReplay.suppliedBootDigestRelationship,
      ],
      ["generationIdentity", innerReplay.generationIdentity],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_AUTHORITY_V2],
      ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_NONCLAIMS_V2],
      [
        "physicalFacts",
        CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_PHYSICAL_FACTS_V2,
      ],
    ]),
  );
}
