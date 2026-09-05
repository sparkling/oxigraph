import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "acorn";

const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-statefs-v1.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const MISSING_CANDIDATE_MESSAGE = `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`;

const array = (...values) => Object.freeze(values);
const record = (...entries) => {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return Object.freeze(value);
};
const fields = (value) => array(...value.trim().split(/\s+/u));
const pairs = (...values) =>
  array(...values.map(([key, value]) => array(key, value)));

function byteSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function canonicalJson(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true);
    assert.equal(Object.is(value, -0), false);
    return JSON.stringify(value);
  }
  assert.equal(typeof value, "object");
  assert.equal(ancestors.has(value), false);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((child) => canonicalJson(child, ancestors)).join(",")}]`;
    }
    assert.equal(
      Object.getPrototypeOf(value) === null ||
        Object.getPrototypeOf(value) === Object.prototype,
      true,
    );
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function semanticSha256(value) {
  return byteSha256(Buffer.from(canonicalJson(value), "utf8"));
}

function digest(label) {
  return byteSha256(Buffer.from(label, "utf8"));
}

const AUTHORITY = record(
  ["filesystemExecution", false],
  ["processExecution", false],
  ["cgroupMutation", false],
  ["runtimeRegistration", false],
  ["productExecution", false],
  ["g17Execution", false],
  ["qualification", false],
  ["readiness", false],
  ["promotion", false],
  ["publication", false],
);

const PHYSICAL_FACTS = record(
  ["stateRootOrigin", null],
  ["stateRootHeld", null],
  ["stateRootLocked", null],
  ["filesystemClassified", null],
  ["inventoryObserved", null],
  ["artifactPersisted", null],
  ["directoryCreated", null],
  ["generationMoved", null],
  ["temporaryRemoved", null],
  ["managerAlive", null],
  ["guardianAlive", null],
  ["actorContinuity", null],
);

const NONCLAIMS = array(
  "state-root-provenance",
  "service-manager-identity",
  "epoch-randomness",
  "historical-durability",
  "power-loss-durability",
  "remote-filesystem",
  "same-uid-tamper-resistance",
  "process-liveness",
  "cgroup-state",
  "descriptor-origin",
  "post-acquisition-lock-continuity",
  "pidfd-or-wait-authority",
  "application-output",
  "COMMIT",
  "semantic-qualification",
  "product-progress",
  "runtime-registration",
  "production-readiness",
  "promotion",
  "publication",
);

const PREDECESSORS = pairs(
  ["containmentExactV2GitBlob", "8e59aae2ec200652ffa848c9d1a8ab31a2280c29"],
  [
    "journalV2RequirementsSha256",
    "95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26",
  ],
  [
    "lifetimeV1RequirementsSha256",
    "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773",
  ],
  [
    "recoveryV1RequirementsSha256",
    "180ad61eba6cbc82d7828c881494dff23a030bdda953d98b8ea42fc88e145874",
  ],
  [
    "guardianControlV1RequirementsSha256",
    "4306a64a108dd3537f5e6a6683f6615d59cab6e12d2c91ffbfb116a7439e9131",
  ],
);

const IMPORT_INVENTORY = array(
  array(
    "./containment-exact-v2.mjs",
    array(
      "sha256",
      "nullRecord",
      "deepFreeze",
      "frozenCopyOnReadBytes",
      "exactRecord",
      "exactDenseArray",
      "boundedInteger",
      "exactBoolean",
      "exactDigest",
      "exactDecimal",
      "exactUnicodeString",
      "copyBoundedBuffer",
      "decodeCanonicalJsonLine",
      "canonicalJsonBytes",
    ),
  ),
  array(
    "./containment-guardian-journal-v2.mjs",
    array(
      "CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2",
      "verifyCandidateContainmentGuardianGenerationManifestV2",
      "verifyCandidateContainmentGuardianJournalBundleV2",
      "replayCandidateContainmentGuardianJournalV2",
    ),
  ),
  array(
    "./containment-guardian-lifetime-v1.mjs",
    array(
      "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1",
      "replayCandidateContainmentGuardianLifetimeV1",
      "selectCandidateContainmentGuardianLifetimeRecoveryTargetV1",
      "selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1",
      "selectCandidateContainmentGuardianLifetimeExternalHeadV1",
      "selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1",
      "assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1",
      "assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1",
      "assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1",
      "assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1",
      "assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1",
    ),
  ),
  array(
    "./containment-guardian-recovery-v1.mjs",
    array(
      "CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1",
      "verifyCandidateContainmentRecoveryTargetV1",
      "verifyCandidateContainmentRecoveryInventoryObservationV1",
      "replayCandidateContainmentRecoveryV1",
      "selectCandidateContainmentRecoveryOwnerAssociationV1",
      "verifyCandidateContainmentRecoveryAttemptV1",
      "verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1",
      "verifyCandidateContainmentRecoveryRecordV1",
    ),
  ),
);

const SCHEMAS = pairs(
  [
    "requirements",
    "oxigraph.candidate-containment-guardian-statefs-requirements/v1",
  ],
  [
    "heldDirectoryObservation",
    "oxigraph.candidate-containment-guardian-statefs-held-directory-observation/v1",
  ],
  [
    "inventoryObservation",
    "oxigraph.candidate-containment-guardian-statefs-inventory-observation/v1",
  ],
  [
    "inventorySet",
    "oxigraph.candidate-containment-guardian-statefs-inventory-set/v1",
  ],
  [
    "directoryHandlePreimage",
    "oxigraph.candidate-containment-guardian-statefs-directory-handle-preimage/v1",
  ],
  [
    "ownerContext",
    "oxigraph.candidate-containment-guardian-statefs-owner-context/v1",
  ],
  ["plan", "oxigraph.candidate-containment-guardian-statefs-plan/v1"],
  ["request", "oxigraph.candidate-containment-guardian-statefs-request/v1"],
  [
    "executorResult",
    "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
  ],
  ["receipt", "oxigraph.candidate-containment-guardian-statefs-receipt/v1"],
  [
    "privateFilesystemReport",
    "oxigraph.candidate-containment-guardian-statefs-private-filesystem-report/v1",
  ],
);

const LIMITS = pairs(
  ["managerActorEpochBytes", 32],
  ["descriptorCount", 2],
  ["heldDirectoryDescriptorCount", 5],
  ["totalStatefsDescriptorCount", 8],
  ["requestSequenceMaximum", 999_999],
  ["componentNameBytes", 255],
  ["immutableArtifactBytes", 98_304],
  ["regularFileObservationBytes", 98_304],
  ["directoryEntryCount", 256],
  ["aggregateLifecycleEntryCount", 1_536],
  ["inventoryScopeCount", 221_959],
  ["observationCount", 257],
  ["completedOperationStepCount", 15],
  ["operationStepNumericMaximum", 34],
  ["canonicalRequestBytes", 262_144],
  ["canonicalInventoryOrReceiptBytes", 1_048_576],
  ["consecutiveEintrReadWriteRetries", 8],
  ["inventoryRequestsPerTraversal", 250_000],
);

const DIRECTORY_ROLES = array(
  "STATE_ROOT",
  "LIFETIMES",
  "LIFETIME_SEGMENT",
  "STAGING",
  "ACTIVE",
  "CLOSED",
  "RECOVERED",
  "QUARANTINED",
  "GENERATION",
  "NORMAL_JOURNAL",
  "RECOVERY_JOURNAL",
  "RECOVERY_ATTEMPT",
);
const ROOT_DIRECTORY_NAMES = array(
  "lifetimes",
  "staging",
  "active",
  "closed",
  "recovered",
  "quarantined",
);
const NAME_GRAMMARS = pairs(
  ["digestDirectory", "^[0-9a-f]{64}$"],
  ["finalRecord", "^[0-9]{16}-[0-9a-f]{64}\\.jsonl$"],
  ["generationManifest", "^generation\\.jsonl$"],
  [
    "fixedDirectory",
    "^(lifetimes|staging|active|closed|recovered|quarantined|normal|recovery)$",
  ],
  [
    "temporaryFile",
    "^\\.(generation\\.jsonl|[0-9]{16}-[0-9a-f]{64}\\.jsonl)\\.tmp-[0-9a-f]{64}$",
  ],
);

const PLANNER_KINDS = array(
  "LOCK_EX_NB",
  "INVENTORY",
  "RELEASE_DIRECTORY",
  "AUTO",
);
const OPERATIONS = array(
  "LOCK_EX_NB",
  "INVENTORY",
  "PERSIST_NOREPLACE",
  "MKDIR_SYNC",
  "MOVE_NOREPLACE_SYNC",
  "MOVE_SYNC_REOBSERVE",
  "TEMP_CLEANUP",
  "RELEASE_DIRECTORY",
);
const INVENTORY_KINDS = array("NONE", "DIRECTORY", "REGULAR_FILE");

const HELD_DIRECTORY_OBSERVATION_FIELDS = fields(`
  schema role accessMode closeOnExec fileType ownerUid ownerGid mode linkCount
  deviceMajor deviceMinor inode mountId filesystemMagic identitySha256 authority
  physicalFacts nonclaims
`);
const INVENTORY_ENTRY_FIELDS = fields(`
  name kind mode ownerUid ownerGid linkCount byteLength deviceMajor deviceMinor inode
  mountId filesystemMagic contentByteLength contentRawSha256
`);
const INVENTORY_OBSERVATION_FIELDS = fields(`
  schema requestSha256 directory directoryHandleSha256 inventoryKind requestedName
  entryCount entries contentBytes inventorySha256 authority physicalFacts nonclaims
`);
const INVENTORY_SET_FIELDS = fields(`
  schema requirementsSha256 managerActorEpochSha256 revision previousInventorySetSha256
  producingRequestSequence producingRequestSha256 scopeCount inventorySetSha256 authority
  physicalFacts nonclaims
`);
const DIRECTORY_HANDLE_PREIMAGE_FIELDS = fields(`
  schema managerActorEpochSha256 role identitySha256 parentDirectoryHandleSha256 name
`);
const PLANNER_INPUT_FIELDS = fields(`
  kind managerActorEpochSha256 requestSequence inventorySetSha256 stateRootObservation
  currentInventorySet unresolvedReceipt generationManifest normalJournalBundles
  lifetimeReplayArguments recoveryTarget recoveryInventory recoveryReplay recoveryPlan
  recoveryAttempt recoveryRecord artifactBytes inventoryDirectoryRole directoryRoleA
  directoryRoleB nameA nameB expectedOutcome
`);
const OWNER_CONTEXT_FIELDS = fields(`
  schema lifetimeReplay recoveryTarget recoveryInventory recoveryReplay recoveryPlan
  recoveryAttempt recoveryRecord lifetimeAnchorProjection lifetimeAttemptAnchorRawSha256
  generationManifest normalJournalBundles ownerContextSha256 authority physicalFacts nonclaims
`);
const PLAN_FIELDS = fields(`
  request ownerContext inventorySet schema requirementsSha256 managerActorEpochSha256
  requestSequence inventorySetSha256 planKind managerDisposition operation writerKind
  actorKind targetSha256 requiredDurableRecordType requiredOutcomeRecordType guardianAction
  requestSha256 ownerContextSha256 planSha256 authority physicalFacts nonclaims
`);
const REQUEST_FIELDS = fields(`
  bytes inventorySet schema requirementsSha256 managerActorEpochSha256 requestSequence
  inventorySetSha256 requestSha256 operation executionDisposition writerKind actorKind
  targetSha256 requiredDurableRecordType requiredOutcomeRecordType inventoryKind
  inventoryDirectoryRole directoryRoleA directoryIdentitySha256A directoryHandleSha256A
  directoryRoleB directoryIdentitySha256B directoryHandleSha256B nameA nameB inputByteLength
  inputRawSha256 temporaryIdentitySha256 authorizationRawSha256 unresolvedReceiptSha256
  expectedOutcome authority physicalFacts nonclaims
`);
const NATIVE_OBSERVATION_FIELDS = fields(`
  kind role name deviceMajor deviceMinor inode mountId byteLength linkCount mode ownerUid
  ownerGid statxMask filesystemMagic contentOffset contentLength
`);
const EXECUTOR_RESULT_FIELDS = fields(`
  schema abiVersion requestSha256 operation status effectClass lastCompletedStep failedStep
  errno completedStepCount bytesConsumed observations outputBytes returnedDirectoryFd
`);
const RECEIPT_FIELDS = fields(`
  request previousInventorySet inventorySet schema requirementsSha256 requestSha256 operation
  executionDisposition writerKind actorKind targetSha256 requiredDurableRecordType
  requiredOutcomeRecordType previousInventorySetSha256 inventorySetSha256 status effectClass
  lastCompletedStep failedStep errno completedStepCount bytesConsumed outcome retryDisposition
  inventories receiptSha256 authority physicalFacts nonclaims
`);
const PRIVATE_FILESYSTEM_REPORT_FIELDS = fields(`
  schema requirementsSha256 platform architecture byteOrder kernelRelease effectiveUid
  effectiveGid stateRootName runNonceSha256 stateRootDeviceMajor stateRootDeviceMinor
  stateRootInode stateRootMountId filesystemMagic mountPointByteLength mountPointRawSha256
  mountOptions cleanupAttempted cleanupCompleted cleanupErrno reportSha256 authority
  physicalFacts nonclaims
`);

const OPERATION_STEPS = pairs(
  ["NONE", 0],
  ["REQUEST_VALIDATED", 1],
  ["FD_A_VALIDATED", 2],
  ["FD_B_VALIDATED", 3],
  ["LOCK_ACQUIRED", 4],
  ["INTERNAL_DESCRIPTOR_OPENED", 5],
  ["DIRECTORY_ENUMERATED", 6],
  ["ENTRY_REOBSERVED", 7],
  ["TEMP_CREATED", 8],
  ["TEMP_WRITTEN", 9],
  ["TEMP_READ_BACK", 10],
  ["TEMP_FILE_SYNCED", 11],
  ["FINAL_INSTALLED", 12],
  ["CHILD_DIRECTORY_CREATED", 13],
  ["CHILD_DIRECTORY_SYNCED", 14],
  ["SOURCE_REOBSERVED", 15],
  ["GENERATION_MOVED", 16],
  ["SOURCE_PARENT_SYNCED", 17],
  ["DESTINATION_PARENT_SYNCED", 18],
  ["TEMP_UNLINKED", 19],
  ["PARENT_SYNCED", 20],
  ["DESTINATION_REOBSERVED", 21],
  ["SOURCE_ABSENCE_REOBSERVED", 22],
  ["TEMP_ABSENCE_REOBSERVED", 23],
  ["INVENTORY_DESCRIPTOR_CLOSED", 24],
  ["TEMP_READ_DESCRIPTOR_OPENED", 25],
  ["TEMP_READ_DESCRIPTOR_CLOSED", 26],
  ["TEMP_WRITE_DESCRIPTOR_CLOSED", 27],
  ["FINAL_READ_DESCRIPTOR_OPENED", 28],
  ["FINAL_READ_DESCRIPTOR_CLOSED", 29],
  ["CHILD_DESCRIPTOR_CLOSED", 30],
  ["PRE_SYNC_DESTINATION_REOBSERVED", 31],
  ["DIRECTORY_HANDLE_TRANSFERRED", 32],
  ["CREATED_METADATA_VALIDATED", 33],
  ["DIRECTORY_RELEASED", 34],
);

const OPERATION_STEP_SEQUENCES = pairs(
  ["LOCK_EX_NB", array(1, 2, 4)],
  ["INVENTORY/DIRECTORY/ROOT", array(1, 2, 5, 6, 24)],
  ["INVENTORY/DIRECTORY/CHILD", array(1, 2, 5, 6, 32)],
  ["INVENTORY/REGULAR_FILE/PRESENT", array(1, 2, 5, 7, 24)],
  ["INVENTORY/REGULAR_FILE/ABSENT", array(1, 2, 7)],
  [
    "PERSIST_NOREPLACE",
    array(1, 2, 8, 33, 9, 25, 10, 26, 11, 27, 12, 20, 28, 21, 29),
  ],
  ["MKDIR_SYNC", array(1, 2, 13, 33, 5, 14, 30, 20, 21)],
  ["MOVE_NOREPLACE_SYNC", array(1, 2, 3, 15, 16, 17, 18, 22, 21)],
  ["MOVE_SYNC_REOBSERVE", array(1, 2, 3, 15, 31, 17, 18, 22, 21)],
  ["TEMP_CLEANUP", array(1, 2, 15, 19, 20, 23)],
  ["RELEASE_DIRECTORY", array(1, 2, 34)],
);

const EXECUTOR_RESULT_STATUSES = array(
  "COMPLETE",
  "REJECTED",
  "SYSCALL_FAILED",
  "LIMIT_EXCEEDED",
  "FAULT_INJECTED",
  "VERIFICATION_FAILED",
);
const RECEIPT_STATUSES = array(...EXECUTOR_RESULT_STATUSES, "OBSERVATION_ONLY");
const EFFECT_CLASSES = array(
  "NO_EFFECT",
  "DEFINITE_NO_EFFECT",
  "COMPLETE",
  "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
  "EFFECT_UNCERTAIN",
);
const OUTCOMES = array(
  "LOCK_HELD",
  "LOCK_CONTENDED",
  "INVENTORY_OBSERVED",
  "ALREADY_PRESENT_EXACT",
  "PERSISTED",
  "DIRECTORY_ALREADY_PRESENT_EXACT",
  "DIRECTORY_CREATED",
  "DESTINATION_ALREADY_PRESENT_EXACT",
  "MOVED",
  "MOVE_SYNC_COMPLETED",
  "TEMP_ALREADY_ABSENT",
  "TEMP_REMOVED",
  "DIRECTORY_RELEASED",
  "FAILED_DEFINITE_NO_EFFECT",
  "FAILED_MUTATION_NOT_FULLY_SYNCED",
  "FAILED_EFFECT_UNCERTAIN",
  "REJECTED",
);
const RETRY_DISPOSITIONS = array("NO_RETRY", "REPLAN_AFTER_FRESH_INVENTORY");
const ERROR_PRECEDENCE = array(
  "STATEFS_BOUNDS",
  "STATEFS_SHAPE",
  "STATEFS_GRAMMAR",
  "STATEFS_PREDECESSOR",
  "STATEFS_BINDING",
  "STATEFS_REQUEST",
  "STATEFS_RESULT",
  "STATEFS_TRANSITION",
);
const FD_RULES = array(
  "held-dirfd-relative-only/v1",
  "exact-role-identity/v1",
  "same-mount/v1",
  "no-alias/v1",
  "readonly-directory/v1",
  "cloexec-by-role/v1",
  "reject-at-fdcwd-opath-root-path/v1",
);
const METADATA_RULES = array(
  "expected-owner-uid-gid/v1",
  "private-mode/v1",
  "regular-link-count-one/v1",
  "directory-link-count-minimum-two/v1",
  "no-follow/v1",
  "no-repeated-inode/v1",
  "raw-name-bytes-01-7f/v1",
  "ascii-byte-order/v1",
  "statx-required-mask-0x17ff/v1",
);
const SYSCALL_RULES = array(
  "linux-amd64-direct-allowlist/v1",
  "one-shot-mutation/v1",
  "eintr-read-write-only/v1",
  "errno-immediate/v1",
  "close-no-retry/v1",
  "zero-before-syscall/v1",
  "validated-observation-prefix-only/v1",
  "live-cleanup-close-upgrades-effect/v1",
);
const ORDERING_RULES = array(
  "intent-before-effect/v1",
  "write-readback-file-sync-rename-parent-sync/v1",
  "move-source-sync-destination-sync-reobserve/v1",
  "outcome-last/v1",
  "ambiguous-effect-no-retry/v1",
  "fresh-inventory-replan/v1",
);

const PRIVATE_FILESYSTEM_PROFILE = pairs(
  ["platform", "linux"],
  ["architecture", "x86_64"],
  ["byteOrder", "little-endian"],
  ["filesystemMagic", array("0x0000ef53", "0x58465342")],
  ["rootMode", "0700"],
  ["regularMode", "0600"],
  ["ownerSource", "manager-held-root-observation"],
  ["mountInfoSource", "/proc/self/mountinfo"],
  ["requiredMountOptions", array("rw")],
  ["forbiddenMountOptions", array("ro")],
  ["singleMount", true],
  ["remote", false],
  ["overlay", false],
  ["fuse", false],
  ["symlinkRoot", false],
  ["maximumHeldDirectoryDescriptors", 5],
  ["childNonceBytes", 32],
  ["runnerInputFields", array("scratchParent", "runNonceBytes")],
  ["childNamePrefix", ".oxigraph-statefs-v1-"],
  ["childNameGrammar", "^\\.oxigraph-statefs-v1-[0-9a-f]{64}$"],
  ["childNameBytes", 85],
  [
    "setupRules",
    array(
      "copy-nonce-before-path/v1",
      "open-parent-nofollow/v1",
      "mkdirat-once-no-replacement/v1",
      "open-child-nofollow/v1",
      "exact-owner-mode-mount-identity/v1",
      "longest-mountinfo-match/v1",
    ),
  ],
  [
    "recordRules",
    array(
      "minimal-decimal-identities/v1",
      "raw-ascii-kernel-release/v1",
      "sorted-unique-decoded-mount-options/v1",
      "digest-mount-point-bytes/v1",
      "report-valid-after-child-crosscheck/v1",
      "no-partial-report/v1",
      "report-after-cleanup/v1",
    ),
  ],
  [
    "cleanupRules",
    array(
      "close-all-continue-record-first/v1",
      "no-delete-after-close-error/v1",
      "child-rooted-nofollow-depth-first/v1",
      "remove-child-last/v1",
      "stop-path-mutation-on-first-error/v1",
      "close-cleanup-fds-after-error/v1",
      "close-parent-on-every-exit/v1",
      "no-other-path/v1",
      "cleanup-failure-preserves-test-failure/v1",
    ),
  ],
  [
    "errors",
    array(
      "PRIVATE_FS_PROFILE_BOUNDS",
      "PRIVATE_FS_PROFILE_SHAPE",
      "PRIVATE_FS_PROFILE_PATH",
      "PRIVATE_FS_PROFILE_MOUNT",
      "PRIVATE_FS_PROFILE_CLEANUP",
    ),
  ],
  [
    "reportLimits",
    pairs(
      ["kernelReleaseBytes", 256],
      ["mountPointBytes", 4_096],
      ["mountOptionCount", 256],
      ["mountOptionBytes", 255],
    ),
  ],
);

const REQUIREMENTS_GOLDEN = record(
  ["schema", "oxigraph.candidate-containment-guardian-statefs-requirements/v1"],
  ["version", 1],
  ["predecessors", PREDECESSORS],
  ["importInventory", IMPORT_INVENTORY],
  ["schemas", SCHEMAS],
  ["limits", LIMITS],
  ["directoryRoles", DIRECTORY_ROLES],
  ["rootDirectoryNames", ROOT_DIRECTORY_NAMES],
  ["nameGrammars", NAME_GRAMMARS],
  ["plannerKinds", PLANNER_KINDS],
  ["operations", OPERATIONS],
  ["inventoryKinds", INVENTORY_KINDS],
  ["heldDirectoryObservationFields", HELD_DIRECTORY_OBSERVATION_FIELDS],
  ["inventoryEntryFields", INVENTORY_ENTRY_FIELDS],
  ["inventoryObservationFields", INVENTORY_OBSERVATION_FIELDS],
  ["inventorySetFields", INVENTORY_SET_FIELDS],
  ["directoryHandlePreimageFields", DIRECTORY_HANDLE_PREIMAGE_FIELDS],
  ["plannerInputFields", PLANNER_INPUT_FIELDS],
  ["ownerContextFields", OWNER_CONTEXT_FIELDS],
  ["planFields", PLAN_FIELDS],
  ["requestFields", REQUEST_FIELDS],
  ["nativeObservationFields", NATIVE_OBSERVATION_FIELDS],
  ["executorResultFields", EXECUTOR_RESULT_FIELDS],
  ["receiptFields", RECEIPT_FIELDS],
  ["operationSteps", OPERATION_STEPS],
  ["operationStepSequences", OPERATION_STEP_SEQUENCES],
  ["executorResultStatuses", EXECUTOR_RESULT_STATUSES],
  ["receiptStatuses", RECEIPT_STATUSES],
  ["effectClasses", EFFECT_CLASSES],
  ["outcomes", OUTCOMES],
  ["retryDispositions", RETRY_DISPOSITIONS],
  ["errorPrecedence", ERROR_PRECEDENCE],
  ["fdRules", FD_RULES],
  ["metadataRules", METADATA_RULES],
  ["syscallRules", SYSCALL_RULES],
  ["orderingRules", ORDERING_RULES],
  ["privateFilesystemReportFields", PRIVATE_FILESYSTEM_REPORT_FIELDS],
  ["privateFilesystemProfile", PRIVATE_FILESYSTEM_PROFILE],
  ["authority", AUTHORITY],
  ["physicalFacts", PHYSICAL_FACTS],
  ["nonclaims", NONCLAIMS],
);

const EXPECTED_REQUIREMENTS_SHA256 =
  "9b401032c2b0331174f74895181e906106bb86a32204b818b30686d9a47c0a42";

const EXPECTED_EXPORTS = array(
  "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS",
  "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256",
  "planCandidateContainmentGuardianStatefsOperationV1",
  "assertCandidateContainmentGuardianStatefsPlanV1",
  "assertCandidateContainmentGuardianStatefsRequestV1",
  "verifyCandidateContainmentGuardianStatefsResultV1",
  "assertCandidateContainmentGuardianStatefsReceiptV1",
);

const PREDECESSOR_SOURCE_PINS = array(
  record(
    ["name", "containment-exact-v2.mjs"],
    ["bytes", 12_687],
    [
      "sha256",
      "194fb41e523b334206e91b2dfda8894f5e661a3d034b7330e3e6bd549e4c744e",
    ],
    ["gitBlob", "8e59aae2ec200652ffa848c9d1a8ab31a2280c29"],
  ),
  record(
    ["name", "containment-guardian-journal-v2.mjs"],
    ["bytes", 33_843],
    [
      "sha256",
      "0fd3751914828519300cdcb3d327824ce78c5b95e5a9acd7211a376b548f0075",
    ],
    ["gitBlob", "33fc436b2519d8678bb9c47520cdd2d0826e4c0d"],
  ),
  record(
    ["name", "containment-guardian-lifetime-v1.mjs"],
    ["bytes", 132_708],
    [
      "sha256",
      "f454ee962615e887c294f4aabade6a640ac1881fd3662842b75a3be8afb8f3e5",
    ],
    ["gitBlob", "4365fb17fd9951fbb911dbc10d0f8ab9c90e7b78"],
  ),
  record(
    ["name", "containment-guardian-recovery-v1.mjs"],
    ["bytes", 146_571],
    [
      "sha256",
      "d9c9fa9acf10def4160cf81211659bbefc9c0f7a985a2860fcbbfdb42f991da0",
    ],
    ["gitBlob", "7cd6960820c4645b51be7156d44ec0a8c99a9a5f"],
  ),
  record(
    ["name", "containment-guardian-control-v1.mjs"],
    ["bytes", 81_670],
    [
      "sha256",
      "05a0af1ab91764a735836efdb8632e8e4f5113360f0b9c9ee9f95f580401ff5a",
    ],
    ["gitBlob", "3853ba078030d25b1c599c6b270d88521a65d35f"],
  ),
);

const CONTRACT_BYTE_PINS = array(
  record(
    ["name", "ADR-0037"],
    [
      "url",
      new URL(
        "../../../docs/adr/0037-durable-containment-statefs-and-manager-protocol.md",
        import.meta.url,
      ),
    ],
    ["bytes", 221_438],
    [
      "sha256",
      "bd3e1f703e25c255d30b0e171c5c8b7bd958e1ce2d6bbe08a2b3a8ee6f1dd377",
    ],
    ["gitBlob", "d3b32ea45c3d44913c8931024b53404e511f5bec"],
  ),
  record(
    ["name", "recovery evaluator fixture"],
    [
      "url",
      new URL(
        "./candidate-containment-guardian-recovery-v1.fixture.mjs",
        import.meta.url,
      ),
    ],
    ["bytes", 35_557],
    [
      "sha256",
      "d956a9952d479617ee672470ca7a390225cbeb681b916ba3ce8255470c748076",
    ],
    ["gitBlob", "2867cc6575a27b30d5138365bfce9da888bb79bf"],
  ),
  record(
    ["name", "engineering package manifest"],
    ["url", new URL("../package.json", import.meta.url)],
    ["bytes", 2_790],
    [
      "sha256",
      "6cbf5ba32081cc3ff540d3500fb34f5e63c15dde1edadc909500fc9fbf4c45a8",
    ],
    ["gitBlob", "b480befac6ce8ba3fd9fa74dbf3963df58048926"],
  ),
  record(
    ["name", "engineering package lock"],
    ["url", new URL("../package-lock.json", import.meta.url)],
    ["bytes", 24_963],
    [
      "sha256",
      "5076addd19b823b7669d20321dac066ddb269587b688675ac4c02d5c2b38612d",
    ],
    ["gitBlob", "e9d18035fca73a79e538f7b64454b89ef486ead7"],
  ),
);

const STATEFS_S7_V5_MATRIX_COUNT_CORRECTION_IDENTITY = (() => {
  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactlyAllowingExisting = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    const priorAfterCount = countExact(source, after);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(
      countExact(replaced, after),
      priorAfterCount + 1,
      `${label} inverse`,
    );
    return replaced;
  };
  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start count`);
    assert.equal(countExact(source, end), 1, `${label} end count`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  let source = currentEvaluatorBytes.toString("utf8");
  assert.equal(Buffer.from(source, "utf8").equals(currentEvaluatorBytes), true);
  source = removeRangeExactly(
    source,
    "\n\nconst STATEFS_S7_V5_MATRIX_COUNT_CORRECTION_IDENTITY = (() => {\n",
    "\n\nconst STATEFS_S7_V4_TASK_DEPENDENCY_CORRECTION_IDENTITY = (() => {\n",
    "S7 V5 identity block",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `    ["bytes", 221_438],
    [
      "sha256",
      "bd3e1f703e25c255d30b0e171c5c8b7bd958e1ce2d6bbe08a2b3a8ee6f1dd377",
    ],
    ["gitBlob", "d3b32ea45c3d44913c8931024b53404e511f5bec"],`,
    `    ["bytes", 221_438],
    [
      "sha256",
      "4836b92bbbb87af2cb1e51b6ca24d436c82c92f03032e9fbcaf1b093d3922fd0",
    ],
    ["gitBlob", "5b876789f86d8bb394bc1d4dc51b972c17850e80"],`,
    "S7 V5 ADR pin inverse",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `  const currentEvaluatorBytes = Buffer.from(
    STATEFS_S7_V5_MATRIX_COUNT_CORRECTION_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );`,
    "  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);",
    "S7 V4 inverse input restoration",
  );
  source = removeRangeExactly(
    source,
    "\n  const v5Receipt =\n",
    [
      "\n  const receipt =",
      "    STATEFS_S7_V4_TASK_DEPENDENCY_CORRECTION_IDENTITY.assertInverseReceipt(",
    ].join("\n"),
    "S7 V5 direct inverse proof",
  );
  const predecessorBytes = Buffer.from(source, "utf8");
  assert.equal(predecessorBytes.length, 396_556);
  assert.equal(countExact(source, "\n"), 11_574);
  assert.equal(
    byteSha256(predecessorBytes),
    "860fc5de84cabb913ab7835d04c5e1cbe17cbe8792615ce38d741fc7692bcea1",
  );
  assert.equal(
    gitBlobSha1(predecessorBytes),
    "d8f14f567d10c5e2a5176343540cef65c93d38ff",
  );
  assert.equal(countExact(source, "\ntest("), 32);

  const inverseReceipt = Object.freeze({});
  const inverseReceiptBrands = new WeakSet([inverseReceipt]);
  const inverseReceiptMetadata = new WeakMap([
    [
      inverseReceipt,
      Object.freeze({
        schema:
          "oxigraph.test.candidate-containment-guardian-statefs-v1-s7-v5-matrix-count-correction-inverse-receipt/v1",
        predecessorBytes: predecessorBytes.length,
        predecessorLines: countExact(source, "\n"),
        predecessorSha256: byteSha256(predecessorBytes),
        predecessorGitBlob: gitBlobSha1(predecessorBytes),
        predecessorTestCount: 32,
      }),
    ],
  ]);
  return Object.freeze({
    predecessorEvaluatorSource: source,
    inverseReceipt,
    assertInverseReceipt(receipt) {
      assert.equal(inverseReceiptBrands.has(receipt), true);
      return inverseReceiptMetadata.get(receipt);
    },
  });
})();

const STATEFS_S7_V4_TASK_DEPENDENCY_CORRECTION_IDENTITY = (() => {
  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactlyAllowingExisting = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    const priorAfterCount = countExact(source, after);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(
      countExact(replaced, after),
      priorAfterCount + 1,
      `${label} inverse`,
    );
    return replaced;
  };
  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start count`);
    assert.equal(countExact(source, end), 1, `${label} end count`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const currentEvaluatorBytes = Buffer.from(
    STATEFS_S7_V5_MATRIX_COUNT_CORRECTION_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  let source = currentEvaluatorBytes.toString("utf8");
  assert.equal(Buffer.from(source, "utf8").equals(currentEvaluatorBytes), true);
  source = removeRangeExactly(
    source,
    "\n\nconst STATEFS_S7_V4_TASK_DEPENDENCY_CORRECTION_IDENTITY = (() => {\n",
    "\n\nconst STATEFS_S7_ADR_CLOSURE_IDENTITY = (() => {\n",
    "S7 V4 identity block",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `    ["bytes", 221_438],
    [
      "sha256",
      "4836b92bbbb87af2cb1e51b6ca24d436c82c92f03032e9fbcaf1b093d3922fd0",
    ],
    ["gitBlob", "5b876789f86d8bb394bc1d4dc51b972c17850e80"],`,
    `    ["bytes", 221_172],
    [
      "sha256",
      "1e132ff0b6779fbaeb98da50485fd877686d7e2a7222134dc69e107dce166800",
    ],
    ["gitBlob", "426ea53752ad09533d85f27231f4f251cc99c0fa"],`,
    "S7 V4 ADR pin inverse",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `  const currentEvaluatorBytes = Buffer.from(
    STATEFS_S7_V4_TASK_DEPENDENCY_CORRECTION_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );`,
    "  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);",
    "S7 V3 inverse input restoration",
  );
  source = removeRangeExactly(
    source,
    '\n\ntest("S7 V4 stale-task correction inversely reconstructs the exact S7 V3 evaluator", () => {\n',
    '\n\ntest("S7 ADR evidence re-pin inversely reconstructs the exact pre-closure evaluator", () => {\n',
    "S7 V4 inverse proof",
  );
  const predecessorBytes = Buffer.from(source, "utf8");
  assert.equal(predecessorBytes.length, 391_542);
  assert.equal(countExact(source, "\n"), 11_439);
  assert.equal(
    byteSha256(predecessorBytes),
    "9205a95e78138a2f8e3b1630e5fa830c6aa862496b54404423ab53ea6ab33ead",
  );
  assert.equal(
    gitBlobSha1(predecessorBytes),
    "2f8222fb0db1f9c49ccfcb5b470d4f02592229ad",
  );
  assert.equal(countExact(source, "\ntest("), 31);

  const inverseReceipt = Object.freeze({});
  const inverseReceiptBrands = new WeakSet([inverseReceipt]);
  const inverseReceiptMetadata = new WeakMap([
    [
      inverseReceipt,
      Object.freeze({
        schema:
          "oxigraph.test.candidate-containment-guardian-statefs-v1-s7-v4-task-dependency-correction-inverse-receipt/v1",
        predecessorBytes: predecessorBytes.length,
        predecessorLines: countExact(source, "\n"),
        predecessorSha256: byteSha256(predecessorBytes),
        predecessorGitBlob: gitBlobSha1(predecessorBytes),
        predecessorTestCount: 31,
      }),
    ],
  ]);
  return Object.freeze({
    predecessorEvaluatorSource: source,
    inverseReceipt,
    assertInverseReceipt(receipt) {
      assert.equal(inverseReceiptBrands.has(receipt), true);
      return inverseReceiptMetadata.get(receipt);
    },
  });
})();

const STATEFS_S7_ADR_CLOSURE_IDENTITY = (() => {
  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactlyAllowingExisting = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    const priorAfterCount = countExact(source, after);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(
      countExact(replaced, after),
      priorAfterCount + 1,
      `${label} inverse`,
    );
    return replaced;
  };
  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start count`);
    assert.equal(countExact(source, end), 1, `${label} end count`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const currentEvaluatorBytes = Buffer.from(
    STATEFS_S7_V4_TASK_DEPENDENCY_CORRECTION_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  let source = currentEvaluatorBytes.toString("utf8");
  assert.equal(Buffer.from(source, "utf8").equals(currentEvaluatorBytes), true);
  source = removeRangeExactly(
    source,
    "\n\nconst STATEFS_S7_ADR_CLOSURE_IDENTITY = (() => {\n",
    "\n\nconst STATEFS_R14B_P1_ADR_REPIN_IDENTITY = (() => {\n",
    "S7 identity block",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `    ["bytes", 221_172],
    [
      "sha256",
      "1e132ff0b6779fbaeb98da50485fd877686d7e2a7222134dc69e107dce166800",
    ],
    ["gitBlob", "426ea53752ad09533d85f27231f4f251cc99c0fa"],`,
    `    ["bytes", 216_688],
    [
      "sha256",
      "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",
    ],
    ["gitBlob", "49b0467887646ee05126a593d28e78bebff6f78f"],`,
    "S7 ADR pin inverse",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `  const currentEvaluatorBytes = Buffer.from(
    STATEFS_S7_ADR_CLOSURE_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );`,
    "  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);",
    "R14B inverse input restoration",
  );
  source = removeRangeExactly(
    source,
    '\n\ntest("S7 ADR evidence re-pin inversely reconstructs the exact pre-closure evaluator", () => {\n',
    '\n\ntest("R14B P1 ADR re-pin inversely reconstructs the exact R13B3 evaluator", () => {\n',
    "S7 inverse proof",
  );
  const predecessorBytes = Buffer.from(source, "utf8");
  assert.equal(predecessorBytes.length, 386_695);
  assert.equal(countExact(source, "\n"), 11_305);
  assert.equal(
    byteSha256(predecessorBytes),
    "7b79d1ab3c28289a2db9a262552c44c3e866e087b408e37d1898365d27b91651",
  );
  assert.equal(
    gitBlobSha1(predecessorBytes),
    "fc45c3975f6c4901bd89ba362a0816b51efb61be",
  );
  assert.equal(countExact(source, "\ntest("), 30);

  const inverseReceipt = Object.freeze({});
  const inverseReceiptBrands = new WeakSet([inverseReceipt]);
  const inverseReceiptMetadata = new WeakMap([
    [
      inverseReceipt,
      Object.freeze({
        schema:
          "oxigraph.test.candidate-containment-guardian-statefs-v1-s7-adr-closure-inverse-receipt/v1",
        predecessorBytes: predecessorBytes.length,
        predecessorLines: countExact(source, "\n"),
        predecessorSha256: byteSha256(predecessorBytes),
        predecessorGitBlob: gitBlobSha1(predecessorBytes),
        predecessorTestCount: 30,
      }),
    ],
  ]);
  return Object.freeze({
    predecessorEvaluatorSource: source,
    inverseReceipt,
    assertInverseReceipt(receipt) {
      assert.equal(inverseReceiptBrands.has(receipt), true);
      return inverseReceiptMetadata.get(receipt);
    },
  });
})();

const STATEFS_R14B_P1_ADR_REPIN_IDENTITY = (() => {
  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactlyAllowingExisting = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    const priorAfterCount = countExact(source, after);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(
      countExact(replaced, after),
      priorAfterCount + 1,
      `${label} inverse`,
    );
    return replaced;
  };
  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start count`);
    assert.equal(countExact(source, end), 1, `${label} end count`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const currentEvaluatorBytes = Buffer.from(
    STATEFS_S7_ADR_CLOSURE_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  let source = currentEvaluatorBytes.toString("utf8");
  assert.equal(Buffer.from(source, "utf8").equals(currentEvaluatorBytes), true);
  source = removeRangeExactly(
    source,
    "\n\nconst STATEFS_R14B_P1_ADR_REPIN_IDENTITY = (() => {\n",
    "\n\nconst STATEFS_R13B3_SYSCALL_LIVENESS_RED_IDENTITY = (() => {\n",
    "R14B P1 identity block",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `    ["bytes", 216_688],
    [
      "sha256",
      "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",
    ],
    ["gitBlob", "49b0467887646ee05126a593d28e78bebff6f78f"],`,
    `    ["bytes", 216_620],
    [
      "sha256",
      "b560e535f89ef2cd87ff4845a1f4296e23bcbc2eb47d7021f7c0ab424820449d",
    ],
    ["gitBlob", "284231e5441ee45b8fdd8f7cef0b0434edf49743"],`,
    "R14B P1 ADR pin inverse",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `  const currentEvaluatorBytes = Buffer.from(
    STATEFS_R14B_P1_ADR_REPIN_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );`,
    "  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);",
    "R13B3 inverse input restoration",
  );
  source = removeRangeExactly(
    source,
    '\n\ntest("R14B P1 ADR re-pin inversely reconstructs the exact R13B3 evaluator", () => {\n',
    '\n\ntest(\n  "R13B3 syscall liveness RED inversely reconstructs the exact R13B2 evaluator",\n',
    "R14B P1 inverse proof",
  );
  const predecessorBytes = Buffer.from(source, "utf8");
  assert.equal(predecessorBytes.length, 381_815);
  assert.equal(countExact(source, "\n"), 11_171);
  assert.equal(
    byteSha256(predecessorBytes),
    "8362816b1008daa63500f0a506c1e19a2be79fffff441b97db6d3c7b8698c382",
  );
  assert.equal(
    gitBlobSha1(predecessorBytes),
    "ef1d5692a651aa75467049dc64040b69ebc73e97",
  );
  assert.equal(countExact(source, "\ntest("), 29);

  const inverseReceipt = Object.freeze({});
  const inverseReceiptBrands = new WeakSet([inverseReceipt]);
  const inverseReceiptMetadata = new WeakMap([
    [
      inverseReceipt,
      Object.freeze({
        schema:
          "oxigraph.test.candidate-containment-guardian-statefs-v1-r14b-p1-adr-repin-inverse-receipt/v1",
        predecessorBytes: predecessorBytes.length,
        predecessorLines: countExact(source, "\n"),
        predecessorSha256: byteSha256(predecessorBytes),
        predecessorGitBlob: gitBlobSha1(predecessorBytes),
        predecessorTestCount: 29,
      }),
    ],
  ]);
  return Object.freeze({
    predecessorEvaluatorSource: source,
    inverseReceipt,
    assertInverseReceipt(receipt) {
      assert.equal(inverseReceiptBrands.has(receipt), true);
      return inverseReceiptMetadata.get(receipt);
    },
  });
})();

const STATEFS_R13B3_SYSCALL_LIVENESS_RED_IDENTITY = (() => {
  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactlyAllowingExisting = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    const priorAfterCount = countExact(source, after);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(
      countExact(replaced, after),
      priorAfterCount + 1,
      `${label} inverse`,
    );
    return replaced;
  };
  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start count`);
    assert.equal(countExact(source, end), 1, `${label} end count`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const currentEvaluatorBytes = Buffer.from(
    STATEFS_R14B_P1_ADR_REPIN_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  let source = currentEvaluatorBytes.toString("utf8");
  assert.equal(Buffer.from(source, "utf8").equals(currentEvaluatorBytes), true);
  source = removeRangeExactly(
    source,
    "\n\nconst STATEFS_R13B3_SYSCALL_LIVENESS_RED_IDENTITY = (() => {\n",
    "\n\nconst STATEFS_R13B2_LIVENESS_RED_CORRECTION_IDENTITY = (() => {\n",
    "R13B3 identity block",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `  const currentEvaluatorBytes = Buffer.from(
    STATEFS_R13B3_SYSCALL_LIVENESS_RED_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );`,
    "  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);",
    "R13B2 inverse input redirection",
  );
  source = removeRangeExactly(
    source,
    "\n\n    const freshDirectorySyscallFailurePlan = async (label, variant) => {\n",
    '\n\n    const impossibleRegular = await freshRegularPlan(\n      "r13-impossible-live-regular-initial",\n    );\n',
    "R13B3 syscall liveness cases",
  );
  source = removeRangeExactly(
    source,
    '\n\ntest(\n  "R13B3 syscall liveness RED inversely reconstructs the exact R13B2 evaluator",\n',
    '\n\ntest(\n  "R13B2 liveness RED correction inversely reconstructs the exact R13B evaluator",\n',
    "R13B3 inverse proof",
  );
  const predecessorBytes = Buffer.from(source, "utf8");
  assert.equal(predecessorBytes.length, 371_224);
  assert.equal(countExact(source, "\n"), 10_875);
  assert.equal(
    byteSha256(predecessorBytes),
    "e0da6dc758789bd8bc27b75a2a2e5942afcfffd2d5166d65e5fc9756b8b7e19f",
  );
  assert.equal(
    gitBlobSha1(predecessorBytes),
    "81ac0866b800efd18679afd53e7e6fd03c4c3b4c",
  );
  assert.equal(countExact(source, "\ntest("), 28);

  const inverseReceipt = Object.freeze({});
  const inverseReceiptBrands = new WeakSet([inverseReceipt]);
  const inverseReceiptMetadata = new WeakMap([
    [
      inverseReceipt,
      Object.freeze({
        schema:
          "oxigraph.test.candidate-containment-guardian-statefs-v1-r13b3-syscall-liveness-red-inverse-receipt/v1",
        predecessorBytes: predecessorBytes.length,
        predecessorLines: countExact(source, "\n"),
        predecessorSha256: byteSha256(predecessorBytes),
        predecessorGitBlob: gitBlobSha1(predecessorBytes),
        predecessorTestCount: 28,
      }),
    ],
  ]);
  return Object.freeze({
    predecessorEvaluatorSource: source,
    inverseReceipt,
    assertInverseReceipt(receipt) {
      assert.equal(inverseReceiptBrands.has(receipt), true);
      return inverseReceiptMetadata.get(receipt);
    },
  });
})();

const STATEFS_R13B2_LIVENESS_RED_CORRECTION_IDENTITY = (() => {
  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactly = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    assert.equal(countExact(source, after), 0, `${label} inverse precondition`);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(countExact(replaced, after), 1, `${label} inverse`);
    return replaced;
  };
  const replaceExactlyAllowingExisting = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    const priorAfterCount = countExact(source, after);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(
      countExact(replaced, after),
      priorAfterCount + 1,
      `${label} inverse`,
    );
    return replaced;
  };
  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start count`);
    assert.equal(countExact(source, end), 1, `${label} end count`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const currentEvaluatorBytes = Buffer.from(
    STATEFS_R13B3_SYSCALL_LIVENESS_RED_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  let source = currentEvaluatorBytes.toString("utf8");
  assert.equal(Buffer.from(source, "utf8").equals(currentEvaluatorBytes), true);
  source = removeRangeExactly(
    source,
    "\n\nconst STATEFS_R13B2_LIVENESS_RED_CORRECTION_IDENTITY = (() => {\n",
    "\n\nconst STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY = (() => {\n",
    "R13B2 identity block",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `  const currentEvaluatorBytes = Buffer.from(
    STATEFS_R13B2_LIVENESS_RED_CORRECTION_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );`,
    "  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);",
    "R13 inverse input redirection",
  );
  source = replaceExactly(
    source,
    `      currentRequirementsCanonicalBytes: Buffer.byteLength(
        STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsCanonical,
        "utf8",
      ),
      currentRequirementsSha256:
        STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsSha256,`,
    `      currentRequirementsCanonicalBytes: Buffer.byteLength(
        canonicalJson(REQUIREMENTS_GOLDEN),
        "utf8",
      ),
      currentRequirementsSha256: EXPECTED_REQUIREMENTS_SHA256,`,
    "R13B2 refreeze receipt expectation inverse",
  );
  source = replaceExactly(
    source,
    `  if (
    receipt.operation === "INVENTORY" &&
    result.status === "COMPLETE"
  ) {`,
    `  if (
    receipt.operation === "INVENTORY" &&
    (receipt.status === "COMPLETE" || receipt.status === "REJECTED")
  ) {`,
    "R13B2 native inventory status oracle inverse",
  );
  source = replaceExactly(
    source,
    `    const assertPrefix = (
      receipt,
      { lastCompletedStep, failedStep, completedStepCount, bytesConsumed = 0 },
    ) => {
      assert.equal(receipt.lastCompletedStep, lastCompletedStep);
      assert.equal(receipt.failedStep, failedStep);
      assert.equal(receipt.errno, 0);
      assert.equal(receipt.completedStepCount, completedStepCount);
      assert.equal(receipt.bytesConsumed, bytesConsumed);
    };`,
    `    const assertPrefix = (
      receipt,
      { lastCompletedStep, failedStep, completedStepCount },
    ) => {
      assert.equal(receipt.lastCompletedStep, lastCompletedStep);
      assert.equal(receipt.failedStep, failedStep);
      assert.equal(receipt.errno, 0);
      assert.equal(receipt.completedStepCount, completedStepCount);
      assert.equal(receipt.bytesConsumed, 0);
    };`,
    "R13B2 bytes-consumed assertion inverse",
  );
  source = replaceExactly(
    source,
    `    const freshRegularPlan = async (label) => {
      const module = await freshStatefs(label);
      const segmentName = digest(\`\${label}:segment\`);
      const tree = await rootAndLifecycleToken(module, {
        label,
        lifecycleEntries: array(
          array(segmentName, "LIFETIME_SEGMENT", "201"),
        ),
      });
      const segment = completeDirectoryInventory(module, {
        label,
        sequence: 3,
        token: tree.token,
        role: "LIFETIME_SEGMENT",
        parentRole: "LIFETIMES",
        name: segmentName,
        targetInode: "201",
        entries: array(),
        returnedDirectoryFd: 66,
      });
      const name = \`0000000000000000-\${digest(\`\${label}:entry\`)}.jsonl\`;
      const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
        inventoryInput({
          label,
          sequence: 4,
          token: segment.receipt.inventorySet,
          inventoryDirectoryRole: null,
          directoryRoleA: "LIFETIME_SEGMENT",
          nameA: name,
        }),
      );`,
    `    const freshRegularPlan = async (label) => {
      const module = await freshStatefs(label);
      const tree = await rootAndLifecycleToken(module, { label });
      const name = \`0000000000000000-\${digest(\`\${label}:entry\`)}.jsonl\`;
      const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
        inventoryInput({
          label,
          sequence: 3,
          token: tree.token,
          inventoryDirectoryRole: null,
          directoryRoleA: "LIFETIMES",
          nameA: name,
        }),
      );`,
    "R13B2 regular-plan fixture inverse",
  );
  source = removeRangeExactly(
    source,
    "\n\n    const crossBoundaryInvalidMasks = invalidMasks.filter(([label]) =>\n",
    '\n\n    const extraModule = await freshStatefs("r13-mask-extra");\n',
    "R13B2 cross-boundary mask killers",
  );
  source = replaceExactly(
    source,
    `        nativeObservation({
          statxMask: (requiredMask | 0x8000_0000) >>> 0,
        }),`,
    "        nativeObservation({ statxMask: requiredMask | 0x8000_0000 }),",
    "R13B2 unsigned extra-mask fixture inverse",
  );
  source = removeRangeExactly(
    source,
    '\n\n    const impossibleRegular = await freshRegularPlan(\n      "r13-impossible-live-regular-initial",\n    );\n',
    '\n\n    for (const [suffix, effectClass] of [\n      ["closed", "NO_EFFECT"],\n',
    "R13B2 regular impossible-live control",
  );
  source = removeRangeExactly(
    source,
    '\n\n    const impossibleMkdir = await freshMkdirPlan(\n      "r13-impossible-live-mkdir-created-metadata",\n    );\n',
    '\n\n    for (const [suffix, effectClass] of [\n      ["cleanup-closed", "MUTATION_OBSERVED_NOT_FULLY_SYNCED"],\n',
    "R13B2 mkdir impossible-live control",
  );
  source = replaceExactly(
    source,
    '            role: unrelated.plan.request.directoryRoleA,',
    '            role: "LIFETIMES",',
    "R13B2 unrelated regular role inverse",
  );
  source = replaceExactly(
    source,
    `    assertPrefix(unrelatedReceipt, {
      lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
      failedStep: "ENTRY_REOBSERVED",
      completedStepCount: 3,
      bytesConsumed: unrelatedBytes.length,
    });`,
    `    assertPrefix(unrelatedReceipt, {
      lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
      failedStep: "ENTRY_REOBSERVED",
      completedStepCount: 3,
    });`,
    "R13B2 unrelated bytes-consumed expectation inverse",
  );
  source = removeRangeExactly(
    source,
    '\n\n    const uncertainRegular = await freshRegularPlan(\n      "r13-unrelated-verification-cleanup-close-failed",\n    );\n',
    "\n  },\n);\n\ntest(\n  \"R13B2 liveness RED correction inversely reconstructs the exact R13B evaluator\",\n",
    "R13B2 definite-to-uncertain live-cleanup pair",
  );
  source = removeRangeExactly(
    source,
    '\n\ntest(\n  "R13B2 liveness RED correction inversely reconstructs the exact R13B evaluator",\n',
    '\n\ntest("source-absent RED is the exact attributable candidate module failure", () => {\n',
    "R13B2 inverse proof",
  );
  const predecessorBytes = Buffer.from(source, "utf8");
  assert.equal(predecessorBytes.length, 355_185);
  assert.equal(countExact(source, "\n"), 10_424);
  assert.equal(
    byteSha256(predecessorBytes),
    "11a59f00404d4fd9cc6683c46d2e35563c3582bbe24e8c2f8a67a65ed9b9e9a1",
  );
  assert.equal(
    gitBlobSha1(predecessorBytes),
    "2d59c8c56c3455103bdf4970fd749034dae9bf4e",
  );
  assert.equal(countExact(source, "\ntest("), 27);

  const inverseReceipt = Object.freeze({});
  const inverseReceiptBrands = new WeakSet([inverseReceipt]);
  const inverseReceiptMetadata = new WeakMap([
    [
      inverseReceipt,
      Object.freeze({
        schema:
          "oxigraph.test.candidate-containment-guardian-statefs-v1-r13b2-liveness-red-inverse-receipt/v1",
        predecessorBytes: predecessorBytes.length,
        predecessorLines: countExact(source, "\n"),
        predecessorSha256: byteSha256(predecessorBytes),
        predecessorGitBlob: gitBlobSha1(predecessorBytes),
        predecessorTestCount: 27,
      }),
    ],
  ]);
  return Object.freeze({
    predecessorEvaluatorSource: source,
    inverseReceipt,
    assertInverseReceipt(receipt) {
      assert.equal(inverseReceiptBrands.has(receipt), true);
      return inverseReceiptMetadata.get(receipt);
    },
  });
})();

const STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY = (() => {
  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactly = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    assert.equal(countExact(source, after), 0, `${label} inverse precondition`);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(countExact(replaced, after), 1, `${label} inverse`);
    return replaced;
  };
  const replaceExactlyAllowingExisting = (source, before, after, label) => {
    assert.equal(countExact(source, before), 1, `${label} count`);
    const priorAfterCount = countExact(source, after);
    const replaced = source.replace(before, after);
    assert.equal(countExact(replaced, before), 0, `${label} removal`);
    assert.equal(
      countExact(replaced, after),
      priorAfterCount + 1,
      `${label} inverse`,
    );
    return replaced;
  };
  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start count`);
    assert.equal(countExact(source, end), 1, `${label} end count`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const currentEvaluatorBytes = Buffer.from(
    STATEFS_R13B2_LIVENESS_RED_CORRECTION_IDENTITY.predecessorEvaluatorSource,
    "utf8",
  );
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  let source = currentEvaluatorBytes.toString("utf8");
  assert.equal(Buffer.from(source, "utf8").equals(currentEvaluatorBytes), true);
  source = removeRangeExactly(
    source,
    "\n\nconst STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY = (() => {\n",
    "\n\nconst STATEFS_NULL_CONTEXT_CORRECTION_IDENTITY = (() => {\n",
    "R13 identity block",
  );
  source = removeRangeExactly(
    source,
    '\n\ntest(\n  "R13 statx-mask correction inversely reconstructs the exact pre-R13 evaluator",\n',
    '\n\ntest("source-absent RED is the exact attributable candidate module failure", () => {\n',
    "R13 proof and behavior tests",
  );
  source = replaceExactly(
    source,
    `const NATIVE_OBSERVATION_FIELDS = fields(\`
  kind role name deviceMajor deviceMinor inode mountId byteLength linkCount mode ownerUid
  ownerGid statxMask filesystemMagic contentOffset contentLength
\`);`,
    `const NATIVE_OBSERVATION_FIELDS = fields(\`
  kind role name deviceMajor deviceMinor inode mountId byteLength linkCount mode ownerUid
  ownerGid filesystemMagic contentOffset contentLength
\`);`,
    "native observation field inverse",
  );
  source = replaceExactly(
    source,
    `const METADATA_RULES = array(
  "expected-owner-uid-gid/v1",
  "private-mode/v1",
  "regular-link-count-one/v1",
  "directory-link-count-minimum-two/v1",
  "no-follow/v1",
  "no-repeated-inode/v1",
  "raw-name-bytes-01-7f/v1",
  "ascii-byte-order/v1",
  "statx-required-mask-0x17ff/v1",
);`,
    `const METADATA_RULES = array(
  "expected-owner-uid-gid/v1",
  "private-mode/v1",
  "regular-link-count-one/v1",
  "directory-link-count-minimum-two/v1",
  "no-follow/v1",
  "no-repeated-inode/v1",
  "ascii-byte-order/v1",
);`,
    "metadata rules inverse",
  );
  source = replaceExactly(
    source,
    `const SYSCALL_RULES = array(
  "linux-amd64-direct-allowlist/v1",
  "one-shot-mutation/v1",
  "eintr-read-write-only/v1",
  "errno-immediate/v1",
  "close-no-retry/v1",
  "zero-before-syscall/v1",
  "validated-observation-prefix-only/v1",
  "live-cleanup-close-upgrades-effect/v1",
);`,
    `const SYSCALL_RULES = array(
  "linux-amd64-direct-allowlist/v1",
  "one-shot-mutation/v1",
  "eintr-read-write-only/v1",
  "errno-immediate/v1",
  "close-no-retry/v1",
  "zero-before-syscall/v1",
);`,
    "syscall rules inverse",
  );
  source = replaceExactly(
    source,
    `const EXPECTED_REQUIREMENTS_SHA256 =
  "9b401032c2b0331174f74895181e906106bb86a32204b818b30686d9a47c0a42";`,
    `const EXPECTED_REQUIREMENTS_SHA256 =
  "9edea8e3e4a7e4e9679b338635ec9d9768ac159fde531ba6e4966498c8d025d1";`,
    "requirements digest inverse",
  );
  source = replaceExactly(
    source,
    `    ["bytes", 216_620],
    [
      "sha256",
      "b560e535f89ef2cd87ff4845a1f4296e23bcbc2eb47d7021f7c0ab424820449d",
    ],
    ["gitBlob", "284231e5441ee45b8fdd8f7cef0b0434edf49743"],`,
    `    ["bytes", 204_827],
    [
      "sha256",
      "d41b0a9d88a972dcb836a9753890e76804fea53a2ae6105ba4eb503a19b36f57",
    ],
    ["gitBlob", "d3b0bfebdf336036e6d723ce0ee7ce85d26a4231"],`,
    "ADR-0037 pin inverse",
  );
  source = replaceExactly(
    source,
    `    ownerGid: 1000,
    statxMask: overrides.kind === "ABSENT" ? 0 : 0x17ff,
    filesystemMagic: "61267",`,
    `    ownerGid: 1000,
    filesystemMagic: "61267",`,
    "native observation fixture inverse",
  );
  source = replaceExactly(
    source,
    `const SOURCE_PRESENT_TEST_OPTIONS = Object.freeze({ skip: statefs === null });
const CANDIDATE_TEST_OPTIONS = Object.freeze({
  skip:
    statefs === null
      ? "candidate source absent"
      : statefs.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256 ===
          EXPECTED_REQUIREMENTS_SHA256
        ? false
        : "R13 candidate contract correction pending",
});`,
    "const CANDIDATE_TEST_OPTIONS = Object.freeze({ skip: statefs === null });",
    "candidate RED gate inverse",
  );
  source = replaceExactly(
    source,
    `test(
  "candidate has exactly seven exports and the independent requirements value",
  SOURCE_PRESENT_TEST_OPTIONS,`,
    `test(
  "candidate has exactly seven exports and the independent requirements value",
  CANDIDATE_TEST_OPTIONS,`,
    "candidate contract test option inverse",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `  const currentEvaluatorBytes = Buffer.from(
    STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13EvaluatorSource,
    "utf8",
  );`,
    "  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);",
    "prior inverse input restoration",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `    const currentBytes = Buffer.from(
      STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13EvaluatorSource,
      "utf8",
    );`,
    "    const currentBytes = readFileSync(EVALUATOR_PATH);",
    "R11A proof input restoration",
  );
  source = replaceExactly(
    source,
    `  const currentRequirementsCanonical =
    STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsCanonical;
  const currentRequirementsFixture = freezeJsonTree(
    JSON.parse(currentRequirementsCanonical),
  );`,
    "  const currentRequirementsCanonical = canonicalJson(REQUIREMENTS_GOLDEN);",
    "prior requirements fixture inverse",
  );
  source = replaceExactlyAllowingExisting(
    source,
    `    semanticSha256(currentRequirementsFixture),
    STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsSha256,`,
    `    semanticSha256(REQUIREMENTS_GOLDEN),
    EXPECTED_REQUIREMENTS_SHA256,`,
    "prior requirements assertion inverse",
  );
  source = replaceExactly(
    source,
    "    nonPrimitiveReferences(currentRequirementsFixture);",
    "    nonPrimitiveReferences(REQUIREMENTS_GOLDEN);",
    "prior requirements references inverse",
  );
  source = replaceExactly(
    source,
    "      currentRequirementsSha256: semanticSha256(currentRequirementsFixture),",
    "      currentRequirementsSha256: semanticSha256(REQUIREMENTS_GOLDEN),",
    "prior requirements receipt inverse",
  );
  source = replaceExactlyAllowingExisting(
    source,
    "      STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsSha256,",
    "      EXPECTED_REQUIREMENTS_SHA256,",
    "prior source requirements digest inverse",
  );
  const preR13EvaluatorBytes = Buffer.from(source, "utf8");
  assert.equal(preR13EvaluatorBytes.length, 324_808);
  assert.equal(countExact(source, "\n"), 9_548);
  assert.equal(
    byteSha256(preR13EvaluatorBytes),
    "0170540e8cd68d233b2e6c01df6cbeca3a9be44dabc59570b09c4b9d48a08c8c",
  );
  assert.equal(
    gitBlobSha1(preR13EvaluatorBytes),
    "6d808b107ed9bda6b2195c035e6a3ad2a6066c9d",
  );
  assert.equal(countExact(source, "\ntest("), 25);

  const preR13Requirements = JSON.parse(canonicalJson(REQUIREMENTS_GOLDEN));
  preR13Requirements.nativeObservationFields.splice(12, 1);
  preR13Requirements.metadataRules.splice(6, 1);
  preR13Requirements.metadataRules.pop();
  preR13Requirements.syscallRules.splice(-2, 2);
  const preR13RequirementsCanonical = canonicalJson(preR13Requirements);
  const preR13RequirementsSha256 = byteSha256(
    Buffer.from(preR13RequirementsCanonical, "utf8"),
  );
  assert.equal(
    preR13RequirementsSha256,
    "9edea8e3e4a7e4e9679b338635ec9d9768ac159fde531ba6e4966498c8d025d1",
  );

  const inverseReceipt = Object.freeze({});
  const inverseReceiptBrands = new WeakSet([inverseReceipt]);
  const inverseReceiptMetadata = new WeakMap([
    [
      inverseReceipt,
      Object.freeze({
        schema:
          "oxigraph.test.candidate-containment-guardian-statefs-v1-r13-statx-mask-inverse-receipt/v1",
        preR13EvaluatorBytes: preR13EvaluatorBytes.length,
        preR13EvaluatorLines: countExact(source, "\n"),
        preR13EvaluatorSha256: byteSha256(preR13EvaluatorBytes),
        preR13EvaluatorGitBlob: gitBlobSha1(preR13EvaluatorBytes),
        preR13EvaluatorTestCount: 25,
      }),
    ],
  ]);
  return Object.freeze({
    preR13EvaluatorSource: source,
    preR13RequirementsCanonical,
    preR13RequirementsSha256,
    inverseReceipt,
    assertInverseReceipt(receipt) {
      assert.equal(inverseReceiptBrands.has(receipt), true);
      return inverseReceiptMetadata.get(receipt);
    },
  });
})();

const STATEFS_NULL_CONTEXT_CORRECTION_IDENTITY = (() => {
  const SELECTED_R5_EVALUATOR_BYTES = 300_770;
  const SELECTED_R5_EVALUATOR_LINES = 8_899;
  const SELECTED_R5_EVALUATOR_SHA256 =
    "1c9b2baae1c7f91e5872056b050f2ab5fe2cf1e7f0b020e63d4a0066ff804302";
  const SELECTED_R5_EVALUATOR_GIT_BLOB =
    "075426aa69ee708ab0b667bb5eaeca1478d17f06";

  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };

  const replaceExactly = (source, before, after, expectedCount, label) => {
    assert.equal(countExact(source, before), expectedCount, label);
    return source.split(before).join(after);
  };

  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start`);
    assert.equal(countExact(source, end), 1, `${label} end`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const currentEvaluatorBytes = Buffer.from(
    STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13EvaluatorSource,
    "utf8",
  );
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  let currentEvaluatorSource = currentEvaluatorBytes.toString("utf8");
  assert.equal(
    Buffer.from(currentEvaluatorSource, "utf8").equals(currentEvaluatorBytes),
    true,
  );
  const r11aCompatibilityStart = [
    "\n  const r11a",
    "CompatibilityStart = [\n",
  ].join("");
  const r11aCompatibilityEnd = [
    "\n  let selectedR5EvaluatorSource = remove",
    "RangeExactly(\n",
  ].join("");
  const r11aProofStart = [
    "\n\ntest(\n  \"R11A persistence observation correction separates ",
    "scratch extents from regular inventory content and inversely reconstructs exact S2 evaluator\",\n",
  ].join("");
  const r11aProofEnd = [
    "\n\ntest(\"source-absent RED is the exact attributable candidate module ",
    "failure\", () => {\n",
  ].join("");
  currentEvaluatorSource = removeRangeExactly(
    currentEvaluatorSource,
    r11aCompatibilityStart,
    r11aCompatibilityEnd,
    "R11A compatibility removal",
  );
  currentEvaluatorSource = removeRangeExactly(
    currentEvaluatorSource,
    r11aProofStart,
    r11aProofEnd,
    "R11A proof removal",
  );
  currentEvaluatorSource = replaceExactly(
    currentEvaluatorSource,
    '  let currentEvaluatorSource = currentEvaluatorBytes.toString("utf8");',
    '  const currentEvaluatorSource = currentEvaluatorBytes.toString("utf8");',
    1,
    "R11A compatibility binding inverse",
  );
  currentEvaluatorSource = replaceExactly(
    currentEvaluatorSource,
    [
      "          byteLength: String(lifetimeRecord.bytes.length),\n",
      '          linkCount: "1",\n',
      "          mode: 0o100_600,\n",
      "          contentLength: 0,",
    ].join(""),
    [
      "          byteLength: String(lifetimeRecord.bytes.length),\n",
      '          linkCount: "1",\n',
      "          mode: 0o100_600,\n",
      "          contentLength: lifetimeRecord.bytes.length,",
    ].join(""),
    1,
    "R11A lifetime persistence extent inverse",
  );
  currentEvaluatorSource = replaceExactly(
    currentEvaluatorSource,
    [
      "          byteLength: String(recoveryRecord.bytes.length),\n",
      '          linkCount: "1",\n',
      "          mode: 0o100_600,\n",
      "          contentLength: 0,",
    ].join(""),
    [
      "          byteLength: String(recoveryRecord.bytes.length),\n",
      '          linkCount: "1",\n',
      "          mode: 0o100_600,\n",
      "          contentLength: recoveryRecord.bytes.length,",
    ].join(""),
    1,
    "R11A recovery persistence extent inverse",
  );
  const reconstructedS2EvaluatorBytes = Buffer.from(
    currentEvaluatorSource,
    "utf8",
  );
  assert.equal(reconstructedS2EvaluatorBytes.length, 312_547);
  assert.equal(countExact(currentEvaluatorSource, "\n"), 9_199);
  assert.equal(
    byteSha256(reconstructedS2EvaluatorBytes),
    "dd23977051b54fbd8b6090d84f779de366a53b570149b8395b3bc8cd33d2253e",
  );
  assert.equal(
    gitBlobSha1(reconstructedS2EvaluatorBytes),
    "2e5d483b1097283f7b699a7de518a9126f80ca7a",
  );
  assert.equal(countExact(currentEvaluatorSource, "\ntest("), 24);
  let selectedR5EvaluatorSource = removeRangeExactly(
    currentEvaluatorSource,
    "\n\nconst STATEFS_NULL_CONTEXT_CORRECTION_IDENTITY = (() => {\n",
    "\n\nconst STATEFS_REFREEZE_IDENTITY = (() => {\n",
    "null-context correction identity removal",
  );
  selectedR5EvaluatorSource = removeRangeExactly(
    selectedR5EvaluatorSource,
    "\n    const recoveryOwnerAssociation = selectRecoveryOwnerAssociation({\n",
    "\n    const recoveryPlanInput = {\n",
    "recovery owner-association proof and null-context branch removal",
  );
  selectedR5EvaluatorSource = removeRangeExactly(
    selectedR5EvaluatorSource,
    "\n  assert.equal(replan.recoveryPlan.recoveryContext, null);\n",
    '\n\n  const recordLabel = "recovery-record-owner-self-check";',
    "anchor-required fixture proof removal",
  );
  selectedR5EvaluatorSource = replaceExactly(
    selectedR5EvaluatorSource,
    `  const currentEvaluatorBytes = Buffer.from(
    STATEFS_NULL_CONTEXT_CORRECTION_IDENTITY.selectedR5EvaluatorSource,
    "utf8",
  );`,
    "  const currentEvaluatorBytes = readFileSync(EVALUATOR_PATH);",
    1,
    "selected R5 source-input restoration",
  );
  const selectedR5EvaluatorBytes = Buffer.from(
    selectedR5EvaluatorSource,
    "utf8",
  );
  assert.equal(selectedR5EvaluatorBytes.length, SELECTED_R5_EVALUATOR_BYTES);
  assert.equal(
    countExact(selectedR5EvaluatorSource, "\n"),
    SELECTED_R5_EVALUATOR_LINES,
  );
  assert.equal(
    byteSha256(selectedR5EvaluatorBytes),
    SELECTED_R5_EVALUATOR_SHA256,
  );
  assert.equal(
    gitBlobSha1(selectedR5EvaluatorBytes),
    SELECTED_R5_EVALUATOR_GIT_BLOB,
  );
  assert.equal(countExact(selectedR5EvaluatorSource, "\ntest("), 24);

  const inverseReceiptBrands = new WeakSet();
  const inverseReceiptMetadata = new WeakMap();
  const inverseReceipt = Object.freeze({});
  inverseReceiptBrands.add(inverseReceipt);
  inverseReceiptMetadata.set(
    inverseReceipt,
    Object.freeze({
      schema:
        "oxigraph.test.candidate-containment-guardian-statefs-v1-null-context-correction-inverse-receipt/v1",
      correctionIdentityBlockRemovals: 1,
      recoveryOwnerAssociationAndNullContextBlockRemovals: 1,
      anchorRequiredFixtureProofRemovals: 1,
      selectedR5SourceInputRestorations: 1,
      currentEvaluatorBytes: currentEvaluatorBytes.length,
      currentEvaluatorSha256: byteSha256(currentEvaluatorBytes),
      currentEvaluatorGitBlob: gitBlobSha1(currentEvaluatorBytes),
      selectedR5Commit: "024eed9233b74d4f8b7e90504ce7c1f80106d1dc",
      selectedR5IntegrationCommit: "881482a6c78b4281128f8cf2dfcdf0e315c519cb",
      selectedR5EvaluatorBytes: selectedR5EvaluatorBytes.length,
      selectedR5EvaluatorLines: countExact(selectedR5EvaluatorSource, "\n"),
      selectedR5EvaluatorSha256: byteSha256(selectedR5EvaluatorBytes),
      selectedR5EvaluatorGitBlob: gitBlobSha1(selectedR5EvaluatorBytes),
      selectedR5EvaluatorTestCount: 24,
    }),
  );

  return Object.freeze({
    selectedR5EvaluatorSource,
    inverseReceipt,
    assertInverseReceipt(receipt) {
      assert.equal(inverseReceiptBrands.has(receipt), true);
      return inverseReceiptMetadata.get(receipt);
    },
  });
})();

const STATEFS_REFREEZE_IDENTITY = (() => {
  const HISTORICAL_S1_REQUIREMENTS_SHA256 =
    "bc1da9d13e0483bb3fb6571cdce7c37af8abf1ebfa21dbe679a34f2b6c8889a0";
  const HISTORICAL_RECOVERY_REQUIREMENTS_SHA256 =
    "278031a43b331036e6c849f796d480e7fe680219d07bdb5b30185668a9337c5a";
  const HISTORICAL_GUARDIAN_REQUIREMENTS_SHA256 =
    "7348640cbf1128447cea9af280e4c5eec4fbcdb5405055fa883a0c81cb462fe8";
  const CURRENT_RECOVERY_REQUIREMENTS_SHA256 =
    "180ad61eba6cbc82d7828c881494dff23a030bdda953d98b8ea42fc88e145874";
  const CURRENT_GUARDIAN_REQUIREMENTS_SHA256 =
    "4306a64a108dd3537f5e6a6683f6615d59cab6e12d2c91ffbfb116a7439e9131";
  const HISTORICAL_S1_EVALUATOR_BYTES = 277_516;
  const HISTORICAL_S1_EVALUATOR_LINES = 8_274;
  const HISTORICAL_S1_EVALUATOR_SHA256 =
    "7fb5aacb768078a96fda70d16d71d8846fa1e84a5141b6c5842d9e0a5066c78b";
  const HISTORICAL_S1_EVALUATOR_GIT_BLOB =
    "58fcc8de666eb4c1d34878842bf179e2c6aa4dab";
  const selectorName = "selectCandidateContainmentRecoveryOwnerAssociationV1";

  const countExact = (source, needle) => {
    assert.equal(typeof source, "string");
    assert.equal(typeof needle, "string");
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = source.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };

  const replaceExactly = (source, before, after, expectedCount, label) => {
    assert.equal(countExact(source, before), expectedCount, label);
    return source.split(before).join(after);
  };

  const removeRangeExactly = (source, start, end, label) => {
    assert.equal(countExact(source, start), 1, `${label} start`);
    assert.equal(countExact(source, end), 1, `${label} end`);
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
  };

  const freezeJsonTree = (value) => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return array(...value.map((child) => freezeJsonTree(child)));
    }
    return record(
      ...Object.entries(value).map(([key, child]) => [
        key,
        freezeJsonTree(child),
      ]),
    );
  };

  const nonPrimitiveReferences = (value, references = new Set()) => {
    if (value === null || typeof value !== "object" || references.has(value)) {
      return references;
    }
    references.add(value);
    for (const child of Object.values(value)) {
      nonPrimitiveReferences(child, references);
    }
    return references;
  };

  const requirementsReceiptBrands = new WeakSet();
  const requirementsReceiptMetadata = new WeakMap();
  const currentRequirementsCanonical =
    STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsCanonical;
  const currentRequirementsFixture = freezeJsonTree(
    JSON.parse(currentRequirementsCanonical),
  );
  assert.equal(
    countExact(
      currentRequirementsCanonical,
      CURRENT_RECOVERY_REQUIREMENTS_SHA256,
    ),
    1,
    "current recovery requirements identity count",
  );
  let historicalRequirementsCanonical = replaceExactly(
    currentRequirementsCanonical,
    CURRENT_RECOVERY_REQUIREMENTS_SHA256,
    HISTORICAL_RECOVERY_REQUIREMENTS_SHA256,
    1,
    "recovery requirements inverse count",
  );
  historicalRequirementsCanonical = replaceExactly(
    historicalRequirementsCanonical,
    CURRENT_GUARDIAN_REQUIREMENTS_SHA256,
    HISTORICAL_GUARDIAN_REQUIREMENTS_SHA256,
    1,
    "guardian requirements inverse count",
  );
  historicalRequirementsCanonical = replaceExactly(
    historicalRequirementsCanonical,
    `,${JSON.stringify(selectorName)}`,
    "",
    1,
    "selector import inventory inverse count",
  );
  const historicalRequirementsFixture = freezeJsonTree(
    JSON.parse(historicalRequirementsCanonical),
  );
  assert.equal(
    canonicalJson(historicalRequirementsFixture),
    historicalRequirementsCanonical,
  );
  assert.equal(
    semanticSha256(currentRequirementsFixture),
    STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsSha256,
  );
  assert.equal(
    semanticSha256(historicalRequirementsFixture),
    HISTORICAL_S1_REQUIREMENTS_SHA256,
  );
  const currentRequirementReferences =
    nonPrimitiveReferences(currentRequirementsFixture);
  const historicalRequirementReferences = nonPrimitiveReferences(
    historicalRequirementsFixture,
  );
  assert.equal(
    [...historicalRequirementReferences].some((value) =>
      currentRequirementReferences.has(value),
    ),
    false,
  );
  const requirementsInverseReceipt = Object.freeze({});
  requirementsReceiptBrands.add(requirementsInverseReceipt);
  requirementsReceiptMetadata.set(
    requirementsInverseReceipt,
    Object.freeze({
      schema:
        "oxigraph.test.candidate-containment-guardian-statefs-v1-requirements-inverse-receipt/v1",
      recoveryRequirementsDigestReversals: 1,
      guardianRequirementsDigestReversals: 1,
      selectorImportNameRemovals: 1,
      currentRequirementsCanonicalBytes: Buffer.byteLength(
        currentRequirementsCanonical,
        "utf8",
      ),
      currentRequirementsSha256: semanticSha256(currentRequirementsFixture),
      historicalRequirementsCanonicalBytes: Buffer.byteLength(
        historicalRequirementsCanonical,
        "utf8",
      ),
      historicalRequirementsSha256: semanticSha256(
        historicalRequirementsFixture,
      ),
      sharedNonPrimitiveReferenceCount: 0,
    }),
  );

  const sourceReceiptBrands = new WeakSet();
  const sourceReceiptMetadata = new WeakMap();
  const currentEvaluatorBytes = Buffer.from(
    STATEFS_NULL_CONTEXT_CORRECTION_IDENTITY.selectedR5EvaluatorSource,
    "utf8",
  );
  assert.equal(Buffer.isBuffer(currentEvaluatorBytes), true);
  const currentEvaluatorSource = currentEvaluatorBytes.toString("utf8");
  assert.equal(
    Buffer.from(currentEvaluatorSource, "utf8").equals(currentEvaluatorBytes),
    true,
  );
  let historicalEvaluatorSource = removeRangeExactly(
    currentEvaluatorSource,
    "\n\nconst STATEFS_REFREEZE_IDENTITY = (() => {\n",
    "\n\nconst OPERATION_GOLDENS = array(",
    "refreeze identity block removal",
  );
  historicalEvaluatorSource = removeRangeExactly(
    historicalEvaluatorSource,
    "\nconst {\n  selectCandidateContainmentRecoveryOwnerAssociationV1:\n    selectRecoveryOwnerAssociation,\n} = recoveryOwner;",
    "\n\nfunction assertExactOwnFieldOrder(",
    "recovery selector actual-import binding removal",
  );
  historicalEvaluatorSource = removeRangeExactly(
    historicalEvaluatorSource,
    '\n\ntest(\n  "recovery owner association preserves exact anchors and rejects before StateFS token reservation",',
    '\n\ntest("source-absent RED is the exact attributable candidate module failure",',
    "novel recovery owner-association test removal",
  );
  historicalEvaluatorSource = replaceExactly(
    historicalEvaluatorSource,
    `      ${JSON.stringify(selectorName)},\n`,
    "",
    1,
    "source selector import inventory reversal",
  );
  const literalReversals = [
    [
      CURRENT_RECOVERY_REQUIREMENTS_SHA256,
      HISTORICAL_RECOVERY_REQUIREMENTS_SHA256,
      1,
      "source recovery requirements digest reversal",
    ],
    [
      CURRENT_GUARDIAN_REQUIREMENTS_SHA256,
      HISTORICAL_GUARDIAN_REQUIREMENTS_SHA256,
      1,
      "source guardian requirements digest reversal",
    ],
    [
      STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsSha256,
      HISTORICAL_S1_REQUIREMENTS_SHA256,
      1,
      "source StateFS requirements digest reversal",
    ],
    [
      '    ["bytes", 146_571],',
      '    ["bytes", 143_143],',
      1,
      "recovery source byte reversal",
    ],
    [
      "d9c9fa9acf10def4160cf81211659bbefc9c0f7a985a2860fcbbfdb42f991da0",
      "e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d",
      1,
      "recovery source digest reversal",
    ],
    [
      "7cd6960820c4645b51be7156d44ec0a8c99a9a5f",
      "befb7cc0cd1627465d19ada510b9be1466c43b6e",
      1,
      "recovery source blob reversal",
    ],
    [
      "05a0af1ab91764a735836efdb8632e8e4f5113360f0b9c9ee9f95f580401ff5a",
      "3b3af0e393ed2141a1623be324b20369231742f66bfd0f745b0307575fdc9718",
      1,
      "guardian source digest reversal",
    ],
    [
      "3853ba078030d25b1c599c6b270d88521a65d35f",
      "74a9ff5346210dd38027ac6ac89edf02050d081f",
      1,
      "guardian source blob reversal",
    ],
    [
      '    ["bytes", 204_827],',
      '    ["bytes", 202_635],',
      1,
      "ADR-0037 byte reversal",
    ],
    [
      "d41b0a9d88a972dcb836a9753890e76804fea53a2ae6105ba4eb503a19b36f57",
      "35a9d8990a67f4a9c332d6a32d47314d19ea73c474610efab240a2cf80b7f97d",
      1,
      "ADR-0037 digest reversal",
    ],
    [
      "d3b0bfebdf336036e6d723ce0ee7ce85d26a4231",
      "313a4152005534fc5325ef7d0ac16ff249aae492",
      1,
      "ADR-0037 blob reversal",
    ],
  ];
  for (const [before, after, count, label] of literalReversals) {
    historicalEvaluatorSource = replaceExactly(
      historicalEvaluatorSource,
      before,
      after,
      count,
      label,
    );
  }
  const historicalEvaluatorBytes = Buffer.from(
    historicalEvaluatorSource,
    "utf8",
  );
  assert.equal(historicalEvaluatorBytes.length, HISTORICAL_S1_EVALUATOR_BYTES);
  assert.equal(
    countExact(historicalEvaluatorSource, "\n"),
    HISTORICAL_S1_EVALUATOR_LINES,
  );
  assert.equal(
    byteSha256(historicalEvaluatorBytes),
    HISTORICAL_S1_EVALUATOR_SHA256,
  );
  assert.equal(
    gitBlobSha1(historicalEvaluatorBytes),
    HISTORICAL_S1_EVALUATOR_GIT_BLOB,
  );
  assert.equal(countExact(historicalEvaluatorSource, "\ntest("), 23);
  const sourceInverseReceipt = Object.freeze({});
  sourceReceiptBrands.add(sourceInverseReceipt);
  sourceReceiptMetadata.set(
    sourceInverseReceipt,
    Object.freeze({
      schema:
        "oxigraph.test.candidate-containment-guardian-statefs-v1-source-inverse-receipt/v1",
      identityBlockRemovals: 1,
      selectorActualImportBindingRemovals: 1,
      selectorImportInventoryRemovals: 1,
      novelTestRemovals: 1,
      literalReversalCount: literalReversals.length,
      currentEvaluatorBytes: currentEvaluatorBytes.length,
      currentEvaluatorSha256: byteSha256(currentEvaluatorBytes),
      currentEvaluatorGitBlob: gitBlobSha1(currentEvaluatorBytes),
      historicalEvaluatorBytes: historicalEvaluatorBytes.length,
      historicalEvaluatorLines: countExact(historicalEvaluatorSource, "\n"),
      historicalEvaluatorSha256: byteSha256(historicalEvaluatorBytes),
      historicalEvaluatorGitBlob: gitBlobSha1(historicalEvaluatorBytes),
      historicalEvaluatorTestCount: 23,
      historicalCandidateSourceAbsent: true,
    }),
  );

  return Object.freeze({
    historicalRequirementsFixture,
    requirementsInverseReceipt,
    sourceInverseReceipt,
    assertRequirementsInverseReceipt(receipt) {
      assert.equal(requirementsReceiptBrands.has(receipt), true);
      return requirementsReceiptMetadata.get(receipt);
    },
    assertSourceInverseReceipt(receipt) {
      assert.equal(sourceReceiptBrands.has(receipt), true);
      return sourceReceiptMetadata.get(receipt);
    },
  });
})();

const OPERATION_GOLDENS = array(
  record(
    ["operation", "LOCK_EX_NB"],
    ["sequence", array(1, 2, 4)],
    ["completeOutcome", "LOCK_HELD"],
    ["completeInventories", 0],
    ["retryAfterDefiniteNoEffect", false],
  ),
  record(
    ["operation", "INVENTORY"],
    ["sequence", array(1, 2, 5, 6, 24)],
    ["completeOutcome", "INVENTORY_OBSERVED"],
    ["completeInventories", 1],
    ["retryAfterDefiniteNoEffect", true],
  ),
  record(
    ["operation", "PERSIST_NOREPLACE"],
    ["sequence", array(1, 2, 8, 33, 9, 25, 10, 26, 11, 27, 12, 20, 28, 21, 29)],
    ["completeOutcome", "PERSISTED"],
    ["completeInventories", 2],
    ["retryAfterDefiniteNoEffect", true],
  ),
  record(
    ["operation", "MKDIR_SYNC"],
    ["sequence", array(1, 2, 13, 33, 5, 14, 30, 20, 21)],
    ["completeOutcome", "DIRECTORY_CREATED"],
    ["completeInventories", 2],
    ["retryAfterDefiniteNoEffect", true],
  ),
  record(
    ["operation", "MOVE_NOREPLACE_SYNC"],
    ["sequence", array(1, 2, 3, 15, 16, 17, 18, 22, 21)],
    ["completeOutcome", "MOVED"],
    ["completeInventories", 2],
    ["retryAfterDefiniteNoEffect", true],
  ),
  record(
    ["operation", "MOVE_SYNC_REOBSERVE"],
    ["sequence", array(1, 2, 3, 15, 31, 17, 18, 22, 21)],
    ["completeOutcome", "MOVE_SYNC_COMPLETED"],
    ["completeInventories", 2],
    ["retryAfterDefiniteNoEffect", false],
  ),
  record(
    ["operation", "TEMP_CLEANUP"],
    ["sequence", array(1, 2, 15, 19, 20, 23)],
    ["completeOutcome", "TEMP_REMOVED"],
    ["completeInventories", 2],
    ["retryAfterDefiniteNoEffect", true],
  ),
  record(
    ["operation", "RELEASE_DIRECTORY"],
    ["sequence", array(1, 2, 34)],
    ["completeOutcome", "DIRECTORY_RELEASED"],
    ["completeInventories", 0],
    ["retryAfterDefiniteNoEffect", false],
  ),
);

const DIGEST_PROJECTION_FIELDS = record(
  [
    "inventory",
    fields(`schema requestSha256 directory directoryHandleSha256 inventoryKind requestedName
      entryCount entries contentByteLength contentRawSha256`),
  ],
  [
    "ownerContext",
    fields(`schema lifetimeReplaySha256 recoveryTargetSha256 recoveryInventorySha256
      recoveryReplaySha256 recoveryPlanSha256 recoveryAttemptSha256 recoveryRecordRawSha256
      lifetimeAnchorProjectionSha256 lifetimeAttemptAnchorRawSha256 generationManifestRawSha256
      normalJournalBundleRawSha256s`),
  ],
  [
    "receipt",
    fields(`schema requirementsSha256 requestSha256 operation executionDisposition writerKind
      actorKind targetSha256 requiredDurableRecordType requiredOutcomeRecordType
      previousInventorySetSha256 inventorySetSha256 status effectClass lastCompletedStep failedStep
      errno completedStepCount bytesConsumed outcome retryDisposition inventories`),
  ],
);

assert.equal(
  semanticSha256(REQUIREMENTS_GOLDEN),
  EXPECTED_REQUIREMENTS_SHA256,
  "independent statefs requirements golden",
);

for (const pin of PREDECESSOR_SOURCE_PINS) {
  const sourceUrl = new URL(`../src/candidate/${pin.name}`, import.meta.url);
  const bytes = readFileSync(sourceUrl);
  assert.equal(bytes.length, pin.bytes, `${pin.name} byte length`);
  assert.equal(byteSha256(bytes), pin.sha256, `${pin.name} raw SHA-256`);
  assert.equal(gitBlobSha1(bytes), pin.gitBlob, `${pin.name} Git blob`);
}
for (const pin of CONTRACT_BYTE_PINS) {
  const bytes = readFileSync(pin.url);
  assert.equal(bytes.length, pin.bytes, `${pin.name} byte length`);
  assert.equal(byteSha256(bytes), pin.sha256, `${pin.name} raw SHA-256`);
  assert.equal(gitBlobSha1(bytes), pin.gitBlob, `${pin.name} Git blob`);
}

function collectBoundNames(pattern, names) {
  if (pattern.type === "Identifier") {
    names.add(pattern.name);
    return;
  }
  if (pattern.type === "RestElement") {
    collectBoundNames(pattern.argument, names);
    return;
  }
  if (pattern.type === "AssignmentPattern") {
    collectBoundNames(pattern.left, names);
    return;
  }
  if (pattern.type === "ArrayPattern") {
    for (const element of pattern.elements) {
      if (element !== null) collectBoundNames(element, names);
    }
    return;
  }
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      collectBoundNames(
        property.type === "RestElement" ? property.argument : property.value,
        names,
      );
    }
  }
}

function declaredNames(declaration) {
  const names = new Set();
  if (
    declaration.type === "FunctionDeclaration" ||
    declaration.type === "ClassDeclaration"
  ) {
    if (declaration.id !== null) names.add(declaration.id.name);
    return names;
  }
  assert.equal(declaration.type, "VariableDeclaration");
  for (const declarator of declaration.declarations) {
    collectBoundNames(declarator.id, names);
  }
  return names;
}

function walkAst(node, visit) {
  if (node === null || typeof node !== "object") return;
  visit(node);
  for (const [key, child] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(child)) {
      for (const element of child) walkAst(element, visit);
    } else {
      walkAst(child, visit);
    }
  }
}

function lexicalScope(parent = null) {
  return {
    parent,
    bindings: new Set(),
    bindingKinds: new Map(),
    ownedMutableBindings: new Set(),
  };
}

function scopeHas(scope, name) {
  for (let current = scope; current !== null; current = current.parent) {
    if (current.bindings.has(name)) return true;
  }
  return false;
}

function scopeBindingKind(scope, name) {
  for (let current = scope; current !== null; current = current.parent) {
    if (current.bindings.has(name)) {
      return current.bindingKinds.get(name) ?? "local";
    }
  }
  return null;
}

function scopeOwnsMutable(scope, name) {
  for (let current = scope; current !== null; current = current.parent) {
    if (current.bindings.has(name)) {
      return current.ownedMutableBindings.has(name);
    }
  }
  return false;
}

function isFreshMutableInitializer(node, scope) {
  if (node.type === "ArrayExpression") {
    return node.elements.every(
      (element) =>
        element === null ||
        (element.type !== "SpreadElement" &&
          isOwnedMutableGraphExpression(element, scope)),
    );
  }
  if (node.type === "ObjectExpression") {
    return node.properties.every(
      (property) =>
        property.type === "Property" &&
        property.kind === "init" &&
        !property.computed &&
        isOwnedMutableGraphExpression(property.value, scope),
    );
  }
  if (
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "ClassExpression"
  ) {
    return true;
  }
  if (
    node.type === "NewExpression" &&
    node.callee.type === "Identifier" &&
    SAFE_MEMORY_CONSTRUCTORS.has(node.callee.name) &&
    !scopeHas(scope, node.callee.name)
  ) {
    return true;
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    scopeBindingKind(scope, node.callee.name) === "import" &&
    new Set([
      "canonicalJsonBytes",
      "copyBoundedBuffer",
      "decodeCanonicalJsonLine",
    ]).has(node.callee.name) &&
    node.arguments.every((argument) => argument.type !== "SpreadElement")
  ) {
    return true;
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    scopeBindingKind(scope, node.callee.name) === "import" &&
    new Set(["exactDenseArray", "exactRecord", "nullRecord"]).has(
      node.callee.name,
    ) &&
    node.arguments.every(
      (argument) =>
        argument.type !== "SpreadElement" &&
        isOwnedMutableGraphExpression(argument, scope),
    )
  ) {
    return true;
  }
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.object.type === "Identifier" &&
    node.callee.object.name === "Object" &&
    !scopeHas(scope, "Object") &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "create" &&
    node.arguments.length === 1 &&
    node.arguments[0].type === "Literal" &&
    node.arguments[0].value === null
  );
}

function isOwnedMutableGraphExpression(node, scope) {
  if (node.type === "Literal") return true;
  if (node.type === "Identifier") return scopeOwnsMutable(scope, node.name);
  return isFreshMutableInitializer(node, scope);
}

function isFreshShallowContainer(node, scope) {
  return (
    node.type === "ArrayExpression" ||
    node.type === "ObjectExpression" ||
    isFreshMutableInitializer(node, scope)
  );
}

function isProvenLocalMemberReceiver(node, scope) {
  if (node.type === "Identifier") {
    return scopeOwnsMutable(scope, node.name);
  }
  if (node.type === "Literal") return true;
  return isFreshMutableInitializer(node, scope);
}

function bindPattern(scope, pattern, kind = "local") {
  const names = new Set();
  collectBoundNames(pattern, names);
  for (const name of names) {
    scope.bindings.add(name);
    scope.bindingKinds.set(name, kind);
  }
}

function declaredNode(statement) {
  return statement.type === "ExportNamedDeclaration"
    ? statement.declaration
    : statement;
}

function predeclareStatements(statements, scope) {
  for (const statement of statements) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers) {
        scope.bindings.add(specifier.local.name);
        scope.bindingKinds.set(specifier.local.name, "import");
      }
      continue;
    }
    const declaration = declaredNode(statement);
    if (
      declaration?.type === "FunctionDeclaration" ||
      declaration?.type === "ClassDeclaration" ||
      declaration?.type === "VariableDeclaration"
    ) {
      for (const name of declaredNames(declaration)) {
        scope.bindings.add(name);
        scope.bindingKinds.set(
          name,
          declaration.type === "FunctionDeclaration" ||
            (declaration.type === "VariableDeclaration" &&
              declaration.declarations.some(
                (declarator) =>
                  declarator.id.type === "Identifier" &&
                  declarator.id.name === name &&
                  (declarator.init?.type === "FunctionExpression" ||
                    declarator.init?.type === "ArrowFunctionExpression"),
              ))
            ? "function"
            : "local",
        );
      }
    }
  }
}

const SAFE_INTRINSIC_MEMBERS = new Map([
  [
    "Object",
    new Set([
      "create",
      "entries",
      "freeze",
      "fromEntries",
      "hasOwn",
      "is",
      "isExtensible",
      "isFrozen",
      "keys",
      "values",
    ]),
  ],
  ["Array", new Set(["isArray"])],
  ["ArrayBuffer", new Set(["isView"])],
  [
    "Number",
    new Set(["isFinite", "isInteger", "isNaN", "isSafeInteger", "parseInt"]),
  ],
  ["String", new Set(["fromCharCode", "fromCodePoint", "raw"])],
  ["JSON", new Set(["parse", "stringify"])],
  ["Math", new Set(["abs", "ceil", "floor", "max", "min", "sign", "trunc"])],
]);
const SAFE_DIRECT_INTRINSICS = new Set([
  "BigInt",
  "Boolean",
  "Number",
  "RegExp",
  "String",
  "parseInt",
]);
const SAFE_MEMORY_CONSTRUCTORS = new Set([
  "Array",
  "ArrayBuffer",
  "BigInt64Array",
  "BigUint64Array",
  "DataView",
  "Error",
  "Float32Array",
  "Float64Array",
  "Int8Array",
  "Int16Array",
  "Int32Array",
  "Map",
  "RangeError",
  "RegExp",
  "Set",
  "TypeError",
  "Uint8Array",
  "Uint8ClampedArray",
  "Uint16Array",
  "Uint32Array",
  "WeakMap",
  "WeakSet",
]);
const MUTATING_LOCAL_METHODS = new Set([
  "add",
  "clear",
  "copyWithin",
  "delete",
  "fill",
  "pop",
  "push",
  "reverse",
  "set",
  "shift",
  "sort",
  "splice",
  "unshift",
]);
const PURE_VALUE_METHODS = new Set([
  "at",
  "charAt",
  "charCodeAt",
  "codePointAt",
  "endsWith",
  "entries",
  "equals",
  "every",
  "exec",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "get",
  "has",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "match",
  "padEnd",
  "padStart",
  "reduce",
  "reduceRight",
  "replace",
  "replaceAll",
  "slice",
  "some",
  "split",
  "startsWith",
  "substring",
  "test",
  "toLowerCase",
  "toString",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
  "values",
]);
const CALLBACK_VALUE_METHODS = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "replace",
  "replaceAll",
  "some",
  "sort",
]);
function assertSafeFreeIdentifier(node, parent, childKey) {
  const { name } = node;
  if (new Set(["Infinity", "NaN", "undefined"]).has(name)) return;
  if (
    parent?.type === "MemberExpression" &&
    childKey === "object" &&
    !parent.computed &&
    SAFE_INTRINSIC_MEMBERS.get(name)?.has(parent.property.name)
  ) {
    return;
  }
  if (
    parent?.type === "CallExpression" &&
    childKey === "callee" &&
    SAFE_DIRECT_INTRINSICS.has(name)
  ) {
    return;
  }
  if (
    parent?.type === "NewExpression" &&
    childKey === "callee" &&
    SAFE_MEMORY_CONSTRUCTORS.has(name)
  ) {
    return;
  }
  if (
    parent?.type === "BinaryExpression" &&
    parent.operator === "instanceof" &&
    childKey === "right" &&
    SAFE_MEMORY_CONSTRUCTORS.has(name)
  ) {
    return;
  }
  assert.fail(`unbound or effect-bearing global identifier: ${name}`);
}

function auditLexicalFreeIdentifiers(program) {
  function visitPatternExpressions(pattern, scope) {
    if (pattern.type === "AssignmentPattern") {
      visit(pattern.right, scope, pattern, "right");
      visitPatternExpressions(pattern.left, scope);
      return;
    }
    if (pattern.type === "RestElement") {
      visitPatternExpressions(pattern.argument, scope);
      return;
    }
    if (pattern.type === "ArrayPattern") {
      for (const element of pattern.elements) {
        if (element !== null) visitPatternExpressions(element, scope);
      }
      return;
    }
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        if (property.type === "RestElement") {
          visitPatternExpressions(property.argument, scope);
        } else {
          if (property.computed) visit(property.key, scope, property, "key");
          visitPatternExpressions(property.value, scope);
        }
      }
    }
  }

  function visitAssignmentTarget(target, scope, parent, childKey) {
    if (target.type === "Identifier") {
      visit(target, scope, parent, childKey);
      return;
    }
    if (target.type === "MemberExpression") {
      assert.equal(
        target.object.type,
        "Identifier",
        "mutation receiver must be a direct locally owned binding",
      );
      assert.equal(
        scopeOwnsMutable(scope, target.object.name),
        true,
        `mutation receiver is not locally owned: ${target.object.name}`,
      );
      visit(target, scope, parent, childKey);
      return;
    }
    if (target.type === "RestElement") {
      visitAssignmentTarget(target.argument, scope, target, "argument");
      return;
    }
    if (target.type === "AssignmentPattern") {
      visitAssignmentTarget(target.left, scope, target, "left");
      visit(target.right, scope, target, "right");
      return;
    }
    if (target.type === "ArrayPattern") {
      for (const element of target.elements) {
        if (element !== null) {
          visitAssignmentTarget(element, scope, target, "elements");
        }
      }
      return;
    }
    if (target.type === "ObjectPattern") {
      for (const property of target.properties) {
        if (property.type === "RestElement") {
          visitAssignmentTarget(property.argument, scope, property, "argument");
        } else {
          if (property.computed) visit(property.key, scope, property, "key");
          visitAssignmentTarget(property.value, scope, property, "value");
        }
      }
      return;
    }
    assert.fail(`unsupported assignment target: ${target.type}`);
  }

  function visitFunction(node, outerScope) {
    const scope = lexicalScope(outerScope);
    if (node.id !== null) {
      scope.bindings.add(node.id.name);
      scope.bindingKinds.set(node.id.name, "function");
    }
    for (const parameter of node.params) {
      bindPattern(scope, parameter, "parameter");
    }
    for (const parameter of node.params) {
      visitPatternExpressions(parameter, scope);
    }
    if (node.body.type === "BlockStatement") {
      visitBlock(node.body, scope, false);
    } else {
      visit(node.body, scope, node, "body");
    }
  }

  function visitBlock(node, parentScope, createChild = true) {
    const scope = createChild ? lexicalScope(parentScope) : parentScope;
    predeclareStatements(node.body, scope);
    for (const statement of node.body) visit(statement, scope, node, "body");
  }

  function visitChildren(node, scope, omitted = new Set()) {
    for (const [key, child] of Object.entries(node)) {
      if (
        omitted.has(key) ||
        key === "loc" ||
        key === "start" ||
        key === "end"
      ) {
        continue;
      }
      if (Array.isArray(child)) {
        for (const element of child) {
          if (element?.type !== undefined) visit(element, scope, node, key);
        }
      } else if (child?.type !== undefined) {
        visit(child, scope, node, key);
      }
    }
  }

  function visit(node, scope, parent = null, childKey = null) {
    switch (node.type) {
      case "Identifier":
        if (!scopeHas(scope, node.name)) {
          assertSafeFreeIdentifier(node, parent, childKey);
        }
        return;
      case "Literal":
      case "TemplateElement":
      case "PrivateIdentifier":
      case "EmptyStatement":
      case "DebuggerStatement":
        return;
      case "Program":
        predeclareStatements(node.body, scope);
        for (const statement of node.body)
          visit(statement, scope, node, "body");
        return;
      case "ImportDeclaration":
        return;
      case "ExportNamedDeclaration":
        if (node.declaration !== null) {
          visit(node.declaration, scope, node, "declaration");
        } else {
          for (const specifier of node.specifiers) {
            assert.equal(
              scopeHas(scope, specifier.local.name),
              true,
              `export references unbound name: ${specifier.local.name}`,
            );
          }
        }
        return;
      case "VariableDeclaration":
        for (const declarator of node.declarations) {
          bindPattern(scope, declarator.id);
          visitPatternExpressions(declarator.id, scope);
          if (declarator.init !== null) {
            visit(declarator.init, scope, declarator, "init");
            if (
              declarator.id.type === "Identifier" &&
              isFreshMutableInitializer(declarator.init, scope)
            ) {
              scope.ownedMutableBindings.add(declarator.id.name);
            }
            if (
              declarator.id.type === "Identifier" &&
              (declarator.init.type === "FunctionExpression" ||
                declarator.init.type === "ArrowFunctionExpression")
            ) {
              scope.bindingKinds.set(declarator.id.name, "function");
            }
          }
        }
        return;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        visitFunction(node, scope);
        return;
      case "BlockStatement":
        visitBlock(node, scope);
        return;
      case "MemberExpression":
        visit(node.object, scope, node, "object");
        if (node.computed) visit(node.property, scope, node, "property");
        return;
      case "CallExpression": {
        assert.equal(node.optional, false, "optional call is forbidden");
        if (node.callee.type === "Identifier") {
          const bindingKind = scopeBindingKind(scope, node.callee.name);
          assert.equal(
            bindingKind === "import" ||
              bindingKind === "function" ||
              (bindingKind === null &&
                SAFE_DIRECT_INTRINSICS.has(node.callee.name)),
            true,
            `indirect or caller-provided callable is forbidden: ${node.callee.name}`,
          );
        } else if (node.callee.type === "MemberExpression") {
          const method = node.callee.computed
            ? staticString(node.callee.property)
            : node.callee.property.name;
          assert.notEqual(method, null, "dynamic method call is forbidden");
          const freeIntrinsicMember =
            node.callee.object.type === "Identifier" &&
            !scopeHas(scope, node.callee.object.name) &&
            SAFE_INTRINSIC_MEMBERS.get(node.callee.object.name)?.has(method);
          if (MUTATING_LOCAL_METHODS.has(method)) {
            assert.equal(
              node.callee.object.type,
              "Identifier",
              `mutating ${method} receiver must be directly locally owned`,
            );
            assert.equal(
              scopeOwnsMutable(scope, node.callee.object.name),
              true,
              `mutating ${method} receiver is not locally owned`,
            );
          } else {
            assert.equal(
              freeIntrinsicMember || PURE_VALUE_METHODS.has(method),
              true,
              `unproved or effect-bearing method call is forbidden: ${method}`,
            );
            if (!freeIntrinsicMember) {
              assert.equal(
                isProvenLocalMemberReceiver(node.callee.object, scope),
                true,
                `${method} receiver is not a proven local value`,
              );
            }
          }
          if (CALLBACK_VALUE_METHODS.has(method)) {
            const callbackIndex =
              method === "replace" || method === "replaceAll" ? 1 : 0;
            if (node.arguments.length > callbackIndex) {
              const callback = node.arguments[callbackIndex];
              const literalReplacement =
                callbackIndex === 1 &&
                callback.type === "Literal" &&
                typeof callback.value === "string";
              assert.equal(
                literalReplacement ||
                  callback.type === "FunctionExpression" ||
                  callback.type === "ArrowFunctionExpression" ||
                  (callback.type === "Identifier" &&
                    scopeBindingKind(scope, callback.name) === "function"),
                true,
                `${method} callback must be a literal replacement or locally audited function`,
              );
            }
          }
          if (
            node.callee.object.type === "Identifier" &&
            node.callee.object.name === "Object" &&
            !scopeHas(scope, "Object") &&
            method === "freeze"
          ) {
            assert.equal(node.arguments.length, 1);
            assert.equal(node.arguments[0].type === "SpreadElement", false);
            assert.equal(
              (node.arguments[0].type === "Identifier" &&
                scopeOwnsMutable(scope, node.arguments[0].name)) ||
                isFreshShallowContainer(node.arguments[0], scope),
              true,
              "Object.freeze argument must be locally owned or freshly allocated",
            );
          }
        } else {
          assert.fail("dynamic callable expression is forbidden");
        }
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "deepFreeze" &&
          scopeBindingKind(scope, "deepFreeze") === "import"
        ) {
          assert.equal(node.arguments.length, 1);
          assert.equal(node.arguments[0].type === "SpreadElement", false);
          assert.equal(
            isFreshMutableInitializer(node.arguments[0], scope),
            true,
            "deepFreeze argument graph must be freshly allocated at this call",
          );
        }
        visitChildren(node, scope);
        return;
      }
      case "NewExpression":
        assert.equal(
          node.callee.type === "Identifier" &&
            scopeBindingKind(scope, node.callee.name) === null &&
            SAFE_MEMORY_CONSTRUCTORS.has(node.callee.name),
          true,
          "constructor must be an unshadowed inert intrinsic",
        );
        visitChildren(node, scope);
        return;
      case "TaggedTemplateExpression":
        assert.fail("tagged template call is forbidden");
      case "Property":
        if (node.computed) visit(node.key, scope, node, "key");
        if (node.shorthand) visit(node.key, scope, node, "value");
        else visit(node.value, scope, node, "value");
        return;
      case "PropertyDefinition":
        if (node.computed) visit(node.key, scope, node, "key");
        if (node.value !== null) visit(node.value, scope, node, "value");
        return;
      case "MethodDefinition":
        if (node.computed) visit(node.key, scope, node, "key");
        visit(node.value, scope, node, "value");
        return;
      case "ClassDeclaration":
      case "ClassExpression": {
        if (node.superClass !== null) {
          visit(node.superClass, scope, node, "superClass");
        }
        const classScope = lexicalScope(scope);
        if (node.id !== null) {
          classScope.bindings.add(node.id.name);
          classScope.bindingKinds.set(node.id.name, "local");
        }
        visit(node.body, classScope, node, "body");
        return;
      }
      case "ClassBody":
        for (const element of node.body) visit(element, scope, node, "body");
        return;
      case "CatchClause": {
        const catchScope = lexicalScope(scope);
        if (node.param !== null) {
          bindPattern(catchScope, node.param, "parameter");
          visitPatternExpressions(node.param, catchScope);
        }
        visitBlock(node.body, catchScope, false);
        return;
      }
      case "ForStatement": {
        const loopScope = lexicalScope(scope);
        if (node.init?.type === "VariableDeclaration") {
          for (const declarator of node.init.declarations) {
            bindPattern(loopScope, declarator.id);
          }
        }
        if (node.init !== null) visit(node.init, loopScope, node, "init");
        if (node.test !== null) visit(node.test, loopScope, node, "test");
        if (node.update !== null) visit(node.update, loopScope, node, "update");
        visit(node.body, loopScope, node, "body");
        return;
      }
      case "ForInStatement":
      case "ForOfStatement": {
        const loopScope = lexicalScope(scope);
        if (node.left.type === "VariableDeclaration") {
          for (const declarator of node.left.declarations) {
            bindPattern(loopScope, declarator.id);
          }
          visit(node.left, loopScope, node, "left");
        } else {
          visitAssignmentTarget(node.left, loopScope, node, "left");
        }
        visit(node.right, loopScope, node, "right");
        visit(node.body, loopScope, node, "body");
        return;
      }
      case "SwitchStatement": {
        visit(node.discriminant, scope, node, "discriminant");
        const switchScope = lexicalScope(scope);
        for (const switchCase of node.cases) {
          predeclareStatements(switchCase.consequent, switchScope);
        }
        for (const switchCase of node.cases) {
          if (switchCase.test !== null) {
            visit(switchCase.test, switchScope, switchCase, "test");
          }
          for (const consequent of switchCase.consequent) {
            visit(consequent, switchScope, switchCase, "consequent");
          }
        }
        return;
      }
      case "AssignmentExpression":
        visitAssignmentTarget(node.left, scope, node, "left");
        visit(node.right, scope, node, "right");
        return;
      case "UpdateExpression":
        visitAssignmentTarget(node.argument, scope, node, "argument");
        return;
      case "UnaryExpression":
        if (node.operator === "delete") {
          visitAssignmentTarget(node.argument, scope, node, "argument");
        } else {
          visit(node.argument, scope, node, "argument");
        }
        return;
      case "LabeledStatement":
        visit(node.body, scope, node, "body");
        return;
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "MetaProperty":
        return;
      default:
        visitChildren(node, scope);
    }
  }

  visit(program, lexicalScope());
}

function staticString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "BinaryExpression" && node.operator === "+") {
    const left = staticString(node.left);
    const right = staticString(node.right);
    return left === null || right === null ? null : left + right;
  }
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function assertPureTopLevelInitializer(
  node,
  directCallNames,
  ownedNames,
  topLevelBoundNames,
) {
  if (node === null) return;
  switch (node.type) {
    case "Literal":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return;
    case "Identifier":
      assert.equal(
        ownedNames.has(node.name),
        true,
        `top-level initializer references unowned value: ${node.name}`,
      );
      return;
    case "ParenthesizedExpression":
      assertPureTopLevelInitializer(
        node.expression,
        directCallNames,
        ownedNames,
        topLevelBoundNames,
      );
      return;
    case "ArrayExpression":
      for (const element of node.elements) {
        if (element === null) continue;
        assert.notEqual(
          element.type,
          "SpreadElement",
          "top-level initializer spread is forbidden",
        );
        assertPureTopLevelInitializer(
          element,
          directCallNames,
          ownedNames,
          topLevelBoundNames,
        );
      }
      return;
    case "ObjectExpression":
      for (const property of node.properties) {
        assert.equal(
          property.type,
          "Property",
          "top-level initializer spread is forbidden",
        );
        assert.equal(
          property.kind,
          "init",
          "top-level initializer accessor is forbidden",
        );
        assert.equal(
          property.method,
          false,
          "top-level initializer method is forbidden",
        );
        assertPureTopLevelInitializer(
          property.value,
          directCallNames,
          ownedNames,
          topLevelBoundNames,
        );
      }
      return;
    case "UnaryExpression":
      assert.notEqual(
        node.operator,
        "delete",
        "top-level initializer delete is forbidden",
      );
      assertPureTopLevelInitializer(
        node.argument,
        directCallNames,
        ownedNames,
        topLevelBoundNames,
      );
      return;
    case "BinaryExpression":
    case "LogicalExpression":
      assertPureTopLevelInitializer(
        node.left,
        directCallNames,
        ownedNames,
        topLevelBoundNames,
      );
      assertPureTopLevelInitializer(
        node.right,
        directCallNames,
        ownedNames,
        topLevelBoundNames,
      );
      return;
    case "ConditionalExpression":
      assertPureTopLevelInitializer(
        node.test,
        directCallNames,
        ownedNames,
        topLevelBoundNames,
      );
      assertPureTopLevelInitializer(
        node.consequent,
        directCallNames,
        ownedNames,
        topLevelBoundNames,
      );
      assertPureTopLevelInitializer(
        node.alternate,
        directCallNames,
        ownedNames,
        topLevelBoundNames,
      );
      return;
    case "TemplateLiteral":
      for (const expression of node.expressions) {
        assertPureTopLevelInitializer(
          expression,
          directCallNames,
          ownedNames,
          topLevelBoundNames,
        );
      }
      return;
    case "MemberExpression":
      assertPureTopLevelInitializer(
        node.object,
        directCallNames,
        ownedNames,
        topLevelBoundNames,
      );
      if (node.computed) {
        assertPureTopLevelInitializer(
          node.property,
          directCallNames,
          ownedNames,
          topLevelBoundNames,
        );
      }
      return;
    case "CallExpression":
      assert.equal(
        node.optional,
        false,
        "optional top-level initializer call is forbidden",
      );
      assert.equal(
        node.callee.type,
        "Identifier",
        "only a proven direct function may run in a top-level initializer",
      );
      assert.equal(
        directCallNames.has(node.callee.name),
        true,
        `unproved top-level initializer call: ${node.callee.name}`,
      );
      for (const argument of node.arguments) {
        assert.notEqual(
          argument.type,
          "SpreadElement",
          "top-level initializer argument spread is forbidden",
        );
        assertPureTopLevelInitializer(
          argument,
          directCallNames,
          ownedNames,
          topLevelBoundNames,
        );
      }
      return;
    case "NewExpression":
      assert.equal(
        node.callee.type,
        "Identifier",
        "dynamic top-level constructor is forbidden",
      );
      assert.equal(
        new Set(["Map", "Set", "WeakMap", "WeakSet"]).has(node.callee.name),
        true,
        `unproved top-level constructor: ${node.callee.name}`,
      );
      assert.equal(
        topLevelBoundNames.has(node.callee.name),
        false,
        `top-level intrinsic constructor is shadowed: ${node.callee.name}`,
      );
      assert.deepEqual(
        node.arguments,
        [],
        "private map/set constructor takes no input",
      );
      return;
    default:
      assert.fail(`forbidden top-level initializer form: ${node.type}`);
  }
}

function auditCandidateSource(sourceText) {
  const program = parse(sourceText, {
    ecmaVersion: 2022,
    sourceType: "module",
    allowAwaitOutsideFunction: false,
    allowHashBang: false,
    allowReturnOutsideFunction: false,
    preserveParens: true,
  });
  const actualImports = [];
  const actualExports = new Set();
  const directCallNames = new Set(IMPORT_INVENTORY[0][1]);
  const topLevelBoundNames = new Set();
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      assert.equal(statement.importKind ?? "value", "value");
      assert.equal(statement.assertions?.length ?? 0, 0);
      assert.equal(statement.attributes?.length ?? 0, 0);
      const importedNames = [];
      for (const specifier of statement.specifiers) {
        assert.equal(specifier.type, "ImportSpecifier");
        assert.equal(specifier.importKind ?? "value", "value");
        assert.equal(specifier.imported.type, "Identifier");
        assert.equal(specifier.local.name, specifier.imported.name);
        importedNames.push(specifier.imported.name);
        topLevelBoundNames.add(specifier.local.name);
      }
      actualImports.push(
        array(statement.source.value, array(...importedNames)),
      );
      continue;
    }
    assert.notEqual(statement.type, "ExportDefaultDeclaration");
    assert.notEqual(statement.type, "ExportAllDeclaration");
    if (statement.type === "ExportNamedDeclaration") {
      assert.equal(statement.source, null);
      if (statement.declaration !== null) {
        for (const name of declaredNames(statement.declaration)) {
          actualExports.add(name);
        }
      }
      for (const specifier of statement.specifiers) {
        assert.equal(specifier.type, "ExportSpecifier");
        actualExports.add(specifier.exported.name);
      }
    }
    const boundDeclaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (
      boundDeclaration?.type === "FunctionDeclaration" ||
      boundDeclaration?.type === "ClassDeclaration" ||
      boundDeclaration?.type === "VariableDeclaration"
    ) {
      for (const name of declaredNames(boundDeclaration)) {
        topLevelBoundNames.add(name);
      }
    }
  }
  assert.deepEqual(actualImports, IMPORT_INVENTORY);
  assert.deepEqual([...actualExports].sort(), [...EXPECTED_EXPORTS].sort());
  auditLexicalFreeIdentifiers(program);

  const forbiddenIdentifiers = new Set([
    "process",
    "global",
    "globalThis",
    "require",
    "module",
    "console",
    "Deno",
    "Bun",
    "fetch",
    "WebSocket",
    "Worker",
    "SharedWorker",
    "EventSource",
    "XMLHttpRequest",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "queueMicrotask",
    "performance",
    "navigator",
    "location",
    "WebAssembly",
    "eval",
    "Function",
    "Reflect",
  ]);
  const forbiddenPropertyNames = new Set([
    "constructor",
    "__proto__",
    "prototype",
    "caller",
    "callee",
    "getOwnPropertyDescriptor",
    "getOwnPropertyDescriptors",
    "getOwnPropertyNames",
    "getOwnPropertySymbols",
    "getPrototypeOf",
    "setPrototypeOf",
    "defineProperty",
    "defineProperties",
  ]);
  const permittedTopLevelTypes = new Set([
    "ImportDeclaration",
    "VariableDeclaration",
    "FunctionDeclaration",
    "ExportNamedDeclaration",
    "EmptyStatement",
  ]);
  const ownedNames = new Set();
  for (const statement of program.body) {
    assert.equal(
      permittedTopLevelTypes.has(statement.type),
      true,
      `forbidden top-level evaluation form: ${statement.type}`,
    );
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type === "ClassDeclaration") {
      assert.fail("top-level class evaluation is forbidden");
    }
    if (declaration?.type === "VariableDeclaration") {
      assert.equal(declaration.kind, "const", "top-level state must be const");
      for (const declarator of declaration.declarations) {
        assert.equal(
          declarator.id.type,
          "Identifier",
          "top-level const binding must be a plain identifier",
        );
        assert.notEqual(
          declarator.init,
          null,
          "top-level const requires initializer",
        );
        assertPureTopLevelInitializer(
          declarator.init,
          directCallNames,
          ownedNames,
          topLevelBoundNames,
        );
        ownedNames.add(declarator.id.name);
      }
    }
  }
  walkAst(program, (node) => {
    assert.notEqual(
      node.type,
      "ImportExpression",
      "dynamic import is forbidden",
    );
    assert.notEqual(node.type, "ThisExpression", "ambient this is forbidden");
    assert.notEqual(node.type, "WithStatement", "with is forbidden");
    if (
      node.type === "Literal" &&
      typeof node.value === "string" &&
      (node.value.startsWith("node:") ||
        node.value.startsWith("file:") ||
        node.value.startsWith("http:") ||
        node.value.startsWith("https:") ||
        forbiddenIdentifiers.has(node.value) ||
        forbiddenPropertyNames.has(node.value))
    ) {
      assert.fail(`authority-bearing literal is forbidden: ${node.value}`);
    }
    if (node.type === "Identifier" && forbiddenIdentifiers.has(node.name)) {
      assert.fail(`ambient authority identifier is forbidden: ${node.name}`);
    }
    if (node.type === "MemberExpression") {
      const propertyName = node.computed
        ? staticString(node.property)
        : node.property.name;
      if (
        node.computed &&
        propertyName === null &&
        !(
          node.property.type === "Literal" &&
          Number.isSafeInteger(node.property.value) &&
          node.property.value >= 0
        )
      ) {
        assert.fail("dynamic computed property access is forbidden");
      }
      if (forbiddenPropertyNames.has(propertyName)) {
        assert.fail(`prototype escape property is forbidden: ${propertyName}`);
      }
    }
    if (
      node.type === "Property" ||
      node.type === "PropertyDefinition" ||
      node.type === "MethodDefinition"
    ) {
      const propertyName = node.computed
        ? staticString(node.key)
        : node.key.type === "Identifier"
          ? node.key.name
          : String(node.key.value);
      if (node.computed && propertyName === null) {
        assert.fail("dynamic computed property definition is forbidden");
      }
      if (forbiddenPropertyNames.has(propertyName)) {
        assert.fail(`prototype escape property is forbidden: ${propertyName}`);
      }
    }
    assert.notEqual(
      node.type,
      "StaticBlock",
      "class static block is forbidden",
    );
    if (node.type === "PropertyDefinition" && node.static) {
      assert.fail("static class field is forbidden");
    }
    if (
      node.type === "MetaProperty" &&
      node.meta.name === "import" &&
      node.property.name === "meta"
    ) {
      assert.fail("import.meta is forbidden in candidate statefs");
    }
  });
}

function auditAuthorityNegativeControl(sourceText) {
  const program = parse(sourceText, {
    ecmaVersion: 2022,
    sourceType: "module",
    allowAwaitOutsideFunction: false,
    allowHashBang: false,
    allowReturnOutsideFunction: false,
    preserveParens: true,
  });
  const wrapper = [
    ...IMPORT_INVENTORY.map(
      ([specifier, names]) =>
        `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`,
    ),
    ...EXPECTED_EXPORTS.map((name) =>
      name.startsWith("CANDIDATE_")
        ? `export const ${name} = null;`
        : `export function ${name}() {}`,
    ),
    sourceText,
  ].join("\n");
  assert.notEqual(program, null);
  auditCandidateSource(wrapper);
}

function assertExactMissingCandidate(error) {
  assert.equal(error?.code, "ERR_MODULE_NOT_FOUND");
  if (error?.url !== undefined) {
    assert.equal(typeof error.url, "string");
    assert.equal(error.url, SOURCE_URL.href);
  } else {
    assert.equal(error?.message, MISSING_CANDIDATE_MESSAGE);
  }
  return error;
}

let candidateSourceBytes = null;
let candidateImportError = null;
let statefs = null;
try {
  candidateSourceBytes = readFileSync(SOURCE_URL);
} catch (readError) {
  if (readError?.code !== "ENOENT") throw readError;
  try {
    statefs = await import(SOURCE_URL.href);
  } catch (importError) {
    candidateImportError = importError;
  }
}

if (candidateSourceBytes !== null) {
  assert.equal(Buffer.isBuffer(candidateSourceBytes), true);
  const candidateSourceText = candidateSourceBytes.toString("utf8");
  assert.equal(
    Buffer.from(candidateSourceText, "utf8").equals(candidateSourceBytes),
    true,
    "candidate source must be exact UTF-8",
  );
  auditCandidateSource(candidateSourceText);
  statefs = await import(SOURCE_URL.href);
}

let lifetimeOwner = null;
let journalOwner = null;
let recoveryOwner = null;
let ownerFixtures = null;
[lifetimeOwner, journalOwner, recoveryOwner, ownerFixtures] = await Promise.all(
  [
    import("../src/candidate/containment-guardian-lifetime-v1.mjs"),
    import("../src/candidate/containment-guardian-journal-v2.mjs"),
    import("../src/candidate/containment-guardian-recovery-v1.mjs"),
    import("./candidate-containment-guardian-recovery-v1.fixture.mjs"),
  ],
);
const {
  selectCandidateContainmentRecoveryOwnerAssociationV1:
    selectRecoveryOwnerAssociation,
} = recoveryOwner;

function assertExactOwnFieldOrder(
  value,
  expected,
  label,
  copyOnReadFields = array(),
) {
  assert.equal(value !== null && typeof value === "object", true, label);
  assert.deepEqual(Reflect.ownKeys(value), [...expected], label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of expected) {
    assert.equal(
      descriptors[key].enumerable,
      true,
      `${label}.${key} enumerable`,
    );
    if (copyOnReadFields.includes(key) && value[key] !== null) {
      assert.equal(
        typeof descriptors[key].get,
        "function",
        `${label}.${key} getter`,
      );
      assert.equal(
        descriptors[key].set,
        undefined,
        `${label}.${key} no setter`,
      );
      assert.equal(
        "value" in descriptors[key],
        false,
        `${label}.${key} not data`,
      );
      const first = value[key];
      const second = value[key];
      assert.equal(Buffer.isBuffer(first), true, `${label}.${key} Buffer`);
      assert.notEqual(first, second, `${label}.${key} copy on read`);
      assert.deepEqual(first, second, `${label}.${key} stable bytes`);
    } else {
      assert.equal("value" in descriptors[key], true, `${label}.${key} data`);
      assert.equal(
        descriptors[key].get,
        undefined,
        `${label}.${key} no getter`,
      );
      assert.equal(
        descriptors[key].set,
        undefined,
        `${label}.${key} no setter`,
      );
    }
  }
}

function assertNullFrozenTree(value, label, seen = new Set()) {
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)) {
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${label} frozen`);
  if (Array.isArray(value)) {
    assert.equal(
      Object.getPrototypeOf(value),
      Array.prototype,
      `${label} array prototype`,
    );
    assert.deepEqual(
      Object.keys(value),
      value.map((_, index) => String(index)),
    );
    for (let index = 0; index < value.length; index += 1) {
      assertNullFrozenTree(value[index], `${label}[${index}]`, seen);
    }
    return;
  }
  assert.equal(Object.getPrototypeOf(value), null, `${label} null prototype`);
  for (const [key, child] of Object.entries(value)) {
    assertNullFrozenTree(child, `${label}.${key}`, seen);
  }
}

function expectCode(call, code) {
  assert.throws(call, (error) => {
    assert.equal(error?.message, code);
    return true;
  });
}

function heldDirectoryObservation({
  role = "STATE_ROOT",
  closeOnExec = false,
  inode = "100",
} = {}) {
  const prefix = record(
    ["schema", SCHEMAS[1][1]],
    ["role", role],
    ["accessMode", "O_RDONLY"],
    ["closeOnExec", closeOnExec],
    ["fileType", "DIRECTORY"],
    ["ownerUid", 1000],
    ["ownerGid", 1000],
    ["mode", "0700"],
    ["linkCount", "2"],
    ["deviceMajor", "8"],
    ["deviceMinor", "1"],
    ["inode", inode],
    ["mountId", "42"],
    ["filesystemMagic", "61267"],
  );
  return record(
    ...Object.entries(prefix),
    ["identitySha256", semanticSha256(prefix)],
    ["authority", AUTHORITY],
    ["physicalFacts", PHYSICAL_FACTS],
    ["nonclaims", NONCLAIMS],
  );
}

function plannerInput(overrides = {}) {
  const values = {
    kind: "LOCK_EX_NB",
    managerActorEpochSha256: digest("manager-actor-epoch"),
    requestSequence: 0,
    inventorySetSha256: null,
    stateRootObservation: heldDirectoryObservation(),
    currentInventorySet: null,
    unresolvedReceipt: null,
    generationManifest: null,
    normalJournalBundles: null,
    lifetimeReplayArguments: null,
    recoveryTarget: null,
    recoveryInventory: null,
    recoveryReplay: null,
    recoveryPlan: null,
    recoveryAttempt: null,
    recoveryRecord: null,
    artifactBytes: null,
    inventoryDirectoryRole: null,
    directoryRoleA: null,
    directoryRoleB: null,
    nameA: null,
    nameB: null,
    expectedOutcome: "LOCK_HELD",
    ...overrides,
  };
  return record(...PLANNER_INPUT_FIELDS.map((key) => [key, values[key]]));
}

function nativeObservation(overrides = {}) {
  const values = {
    kind: "DIRECTORY",
    role: "STATE_ROOT",
    name: null,
    deviceMajor: "8",
    deviceMinor: "1",
    inode: "100",
    mountId: "42",
    byteLength: "4096",
    linkCount: "2",
    mode: 0o40_700,
    ownerUid: 1000,
    ownerGid: 1000,
    statxMask: overrides.kind === "ABSENT" ? 0 : 0x17ff,
    filesystemMagic: "61267",
    contentOffset: 0,
    contentLength: 0,
    ...overrides,
  };
  return record(...NATIVE_OBSERVATION_FIELDS.map((key) => [key, values[key]]));
}

function executorResult(request, overrides = {}) {
  const values = {
    schema: SCHEMAS[8][1],
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: "COMPLETE",
    effectClass: "COMPLETE",
    lastCompletedStep: "LOCK_ACQUIRED",
    failedStep: "NONE",
    errno: 0,
    completedStepCount: 3,
    bytesConsumed: 0,
    observations: array(nativeObservation()),
    outputBytes: null,
    returnedDirectoryFd: -1,
    ...overrides,
  };
  return record(...EXECUTOR_RESULT_FIELDS.map((key) => [key, values[key]]));
}

async function freshStatefs(label) {
  return import(
    `${SOURCE_URL.href}?statefs-v1-evaluator=${encodeURIComponent(label)}`
  );
}

const TOKEN_EXPECTATIONS = new WeakMap();

function scopeKey(projection) {
  return [
    projection.directoryHandleSha256,
    projection.inventoryKind,
    projection.requestedName ?? "<null>",
  ].join("\0");
}

function scopeProjection(inventory) {
  return record(
    ["directoryHandleSha256", inventory.directoryHandleSha256],
    ["directoryIdentitySha256", inventory.directory.identitySha256],
    ["inventoryKind", inventory.inventoryKind],
    ["requestedName", inventory.requestedName],
    ["inventorySha256", inventory.inventorySha256],
  );
}

function compareAscii(left, right) {
  return Buffer.compare(
    Buffer.from(left, "ascii"),
    Buffer.from(right, "ascii"),
  );
}

function sortedScopeProjection(scopes) {
  return array(
    ...[...scopes.values()]
      .sort((left, right) => {
        const path = compareAscii(left.path.join("/"), right.path.join("/"));
        if (path !== 0) return path;
        const kind = compareAscii(
          left.projection.inventoryKind,
          right.projection.inventoryKind,
        );
        if (kind !== 0) return kind;
        if (left.projection.requestedName === null) {
          return right.projection.requestedName === null ? 0 : -1;
        }
        if (right.projection.requestedName === null) return 1;
        return compareAscii(
          left.projection.requestedName,
          right.projection.requestedName,
        );
      })
      .map((entry) => entry.projection),
  );
}

function directoryPathForHandle(scopes, handle) {
  for (const entry of scopes.values()) {
    if (
      entry.projection.directoryHandleSha256 === handle &&
      entry.projection.inventoryKind === "DIRECTORY"
    ) {
      return entry.path;
    }
  }
  assert.fail(`evaluator has no path for directory handle ${handle}`);
}

function exactScope(scopes, handle, inventoryKind, requestedName) {
  const entry = scopes.get(
    [handle, inventoryKind, requestedName ?? "<null>"].join("\0"),
  );
  assert.notEqual(
    entry,
    undefined,
    `evaluator has no ${inventoryKind}/${requestedName ?? "null"} scope for ${handle}`,
  );
  return entry;
}

function exactDirectoryBinding(token, role) {
  const metadata = TOKEN_EXPECTATIONS.get(token);
  assert.notEqual(
    metadata,
    undefined,
    "directory binding token is evaluator-known",
  );
  const matches = [...metadata.scopes.values()].filter(
    (entry) =>
      entry.projection.inventoryKind === "DIRECTORY" &&
      entry.inventory.directory.role === role,
  );
  assert.equal(matches.length, 1, `one ${role} directory binding`);
  return {
    role,
    identitySha256: matches[0].inventory.directory.identitySha256,
    handleSha256: matches[0].inventory.directoryHandleSha256,
    inventory: matches[0].inventory,
  };
}

function expectedObservationOnlyInventories(request, previousMeta) {
  assert.notEqual(previousMeta, null);
  const scopes = previousMeta.scopes;
  switch (request.operation) {
    case "PERSIST_NOREPLACE":
      return array(
        exactScope(scopes, request.directoryHandleSha256A, "DIRECTORY", null)
          .inventory,
        exactScope(
          scopes,
          request.directoryHandleSha256A,
          "REGULAR_FILE",
          request.nameB,
        ).inventory,
      );
    case "MKDIR_SYNC":
      return array(
        exactScope(scopes, request.directoryHandleSha256A, "DIRECTORY", null)
          .inventory,
      );
    case "MOVE_NOREPLACE_SYNC":
      return array(
        exactScope(scopes, request.directoryHandleSha256A, "DIRECTORY", null)
          .inventory,
        exactScope(scopes, request.directoryHandleSha256B, "DIRECTORY", null)
          .inventory,
      );
    case "TEMP_CLEANUP":
      return array(
        exactScope(
          scopes,
          request.directoryHandleSha256A,
          "REGULAR_FILE",
          request.nameA,
        ).inventory,
      );
    default:
      assert.fail(`unexpected observation-only operation ${request.operation}`);
  }
}

function permissionString(nativeMode) {
  return (nativeMode & 0o777).toString(8).padStart(4, "0");
}

function expectedHeldDirectory(native, closeOnExec) {
  const prefix = record(
    ["schema", SCHEMAS[1][1]],
    ["role", native.role],
    ["accessMode", "O_RDONLY"],
    ["closeOnExec", closeOnExec],
    ["fileType", "DIRECTORY"],
    ["ownerUid", native.ownerUid],
    ["ownerGid", native.ownerGid],
    ["mode", permissionString(native.mode)],
    ["linkCount", native.linkCount],
    ["deviceMajor", native.deviceMajor],
    ["deviceMinor", native.deviceMinor],
    ["inode", native.inode],
    ["mountId", native.mountId],
    ["filesystemMagic", native.filesystemMagic],
  );
  return record(
    ...Object.entries(prefix),
    ["identitySha256", semanticSha256(prefix)],
    ["authority", AUTHORITY],
    ["physicalFacts", PHYSICAL_FACTS],
    ["nonclaims", NONCLAIMS],
  );
}

function expectedEntry(native, contentBytes = null) {
  return record(
    ["name", native.name],
    ["kind", native.kind],
    ["mode", permissionString(native.mode)],
    ["ownerUid", native.ownerUid],
    ["ownerGid", native.ownerGid],
    ["linkCount", native.linkCount],
    ["byteLength", native.byteLength],
    ["deviceMajor", native.deviceMajor],
    ["deviceMinor", native.deviceMinor],
    ["inode", native.inode],
    ["mountId", native.mountId],
    ["filesystemMagic", native.filesystemMagic],
    ["contentByteLength", contentBytes === null ? null : contentBytes.length],
    [
      "contentRawSha256",
      contentBytes === null ? null : byteSha256(contentBytes),
    ],
  );
}

function expectedInventory({
  request,
  directory,
  directoryHandleSha256: handle,
  inventoryKind,
  requestedName,
  entries,
  contentBytes = null,
}) {
  const prefix = record(
    ["schema", SCHEMAS[2][1]],
    ["requestSha256", request.requestSha256],
    ["directory", directory],
    ["directoryHandleSha256", handle],
    ["inventoryKind", inventoryKind],
    ["requestedName", requestedName],
    ["entryCount", entries.length],
    ["entries", entries],
    ["contentBytes", contentBytes],
  );
  const projection = record(
    ["schema", prefix.schema],
    ["requestSha256", prefix.requestSha256],
    ["directory", prefix.directory],
    ["directoryHandleSha256", prefix.directoryHandleSha256],
    ["inventoryKind", prefix.inventoryKind],
    ["requestedName", prefix.requestedName],
    ["entryCount", prefix.entryCount],
    ["entries", prefix.entries],
    ["contentByteLength", contentBytes === null ? null : contentBytes.length],
    [
      "contentRawSha256",
      contentBytes === null ? null : byteSha256(contentBytes),
    ],
  );
  return record(
    ...Object.entries(prefix),
    ["inventorySha256", semanticSha256(projection)],
    ["authority", AUTHORITY],
    ["physicalFacts", PHYSICAL_FACTS],
    ["nonclaims", NONCLAIMS],
  );
}

function sortedEntries(entries) {
  return array(
    ...entries.sort((left, right) => compareAscii(left.name, right.name)),
  );
}

function replacedEntrySet(inventory, removedNames, insertedEntries) {
  const removed = new Set(removedNames);
  return sortedEntries([
    ...inventory.entries.filter((entry) => !removed.has(entry.name)),
    ...insertedEntries,
  ]);
}

function expectedDirectoryInventoryFromResult(request, result) {
  const target = result.observations[0];
  const directory = expectedHeldDirectory(
    target,
    request.inventoryDirectoryRole !== "STATE_ROOT",
  );
  const handle =
    request.inventoryDirectoryRole === "STATE_ROOT"
      ? request.directoryHandleSha256A
      : directoryHandleSha256({
          managerActorEpochSha256: request.managerActorEpochSha256,
          role: request.inventoryDirectoryRole,
          identitySha256: directory.identitySha256,
          parentDirectoryHandleSha256: request.directoryHandleSha256A,
          name: request.nameA,
        });
  const entries = sortedEntries(
    result.observations.slice(1).map((native) => expectedEntry(native)),
  );
  return expectedInventory({
    request,
    directory,
    directoryHandleSha256: handle,
    inventoryKind: "DIRECTORY",
    requestedName: null,
    entries,
  });
}

function expectedRegularInventoryFromResult(request, result, previousMeta) {
  const parent = exactScope(
    previousMeta.scopes,
    request.directoryHandleSha256A,
    "DIRECTORY",
    null,
  ).inventory;
  const native = result.observations[0];
  const absent = native.kind === "ABSENT";
  const contentBytes = absent ? null : Buffer.from(result.outputBytes);
  return expectedInventory({
    request,
    directory: parent.directory,
    directoryHandleSha256: request.directoryHandleSha256A,
    inventoryKind: "REGULAR_FILE",
    requestedName: request.nameA,
    entries: absent ? array() : array(expectedEntry(native, contentBytes)),
    contentBytes,
  });
}

function expectedMutationInventories(request, result, previousMeta) {
  const scopes = previousMeta.scopes;
  const parentA = exactScope(
    scopes,
    request.directoryHandleSha256A,
    "DIRECTORY",
    null,
  ).inventory;
  if (request.operation === "PERSIST_NOREPLACE") {
    const native = result.observations[0];
    const contentBytes = Buffer.from(request.bytes);
    const directoryEntry = expectedEntry(native);
    const fileEntry = expectedEntry(native, contentBytes);
    return array(
      expectedInventory({
        request,
        directory: parentA.directory,
        directoryHandleSha256: parentA.directoryHandleSha256,
        inventoryKind: "DIRECTORY",
        requestedName: null,
        entries: replacedEntrySet(
          parentA,
          array(request.nameB),
          array(directoryEntry),
        ),
      }),
      expectedInventory({
        request,
        directory: parentA.directory,
        directoryHandleSha256: parentA.directoryHandleSha256,
        inventoryKind: "REGULAR_FILE",
        requestedName: request.nameB,
        entries: array(fileEntry),
        contentBytes,
      }),
    );
  }
  if (request.operation === "MKDIR_SYNC") {
    const native = result.observations[0];
    const child = expectedHeldDirectory(native, true);
    const childHandle = directoryHandleSha256({
      managerActorEpochSha256: request.managerActorEpochSha256,
      role: native.role,
      identitySha256: child.identitySha256,
      parentDirectoryHandleSha256: parentA.directoryHandleSha256,
      name: request.nameA,
    });
    return array(
      expectedInventory({
        request,
        directory: parentA.directory,
        directoryHandleSha256: parentA.directoryHandleSha256,
        inventoryKind: "DIRECTORY",
        requestedName: null,
        entries: replacedEntrySet(
          parentA,
          array(request.nameA),
          array(expectedEntry(native)),
        ),
      }),
      expectedInventory({
        request,
        directory: child,
        directoryHandleSha256: childHandle,
        inventoryKind: "DIRECTORY",
        requestedName: null,
        entries: array(),
      }),
    );
  }
  if (
    request.operation === "MOVE_NOREPLACE_SYNC" ||
    request.operation === "MOVE_SYNC_REOBSERVE"
  ) {
    const parentB = exactScope(
      scopes,
      request.directoryHandleSha256B,
      "DIRECTORY",
      null,
    ).inventory;
    return array(
      expectedInventory({
        request,
        directory: parentA.directory,
        directoryHandleSha256: parentA.directoryHandleSha256,
        inventoryKind: "DIRECTORY",
        requestedName: null,
        entries: replacedEntrySet(parentA, array(request.nameA), array()),
      }),
      expectedInventory({
        request,
        directory: parentB.directory,
        directoryHandleSha256: parentB.directoryHandleSha256,
        inventoryKind: "DIRECTORY",
        requestedName: null,
        entries: replacedEntrySet(
          parentB,
          array(request.nameB),
          array(expectedEntry(result.observations[1])),
        ),
      }),
    );
  }
  if (request.operation === "TEMP_CLEANUP") {
    return array(
      expectedInventory({
        request,
        directory: parentA.directory,
        directoryHandleSha256: parentA.directoryHandleSha256,
        inventoryKind: "DIRECTORY",
        requestedName: null,
        entries: replacedEntrySet(parentA, array(request.nameA), array()),
      }),
      expectedInventory({
        request,
        directory: parentA.directory,
        directoryHandleSha256: parentA.directoryHandleSha256,
        inventoryKind: "REGULAR_FILE",
        requestedName: request.nameA,
        entries: array(),
      }),
    );
  }
  assert.fail(`no evaluator mutation transform for ${request.operation}`);
}

function assertExactReceiptInventories(receipt, result, previousMeta) {
  if (receipt.status === "OBSERVATION_ONLY") {
    const expected = expectedObservationOnlyInventories(
      receipt.request,
      previousMeta,
    );
    assert.equal(receipt.inventories.length, expected.length);
    for (const [index, inventory] of expected.entries()) {
      assert.equal(
        receipt.inventories[index],
        inventory,
        `observation-only inventory ${index} preserves exact private brand`,
      );
    }
    return;
  }
  if (
    receipt.operation === "INVENTORY" &&
    result.status === "COMPLETE"
  ) {
    const expected =
      receipt.request.inventoryKind === "DIRECTORY"
        ? expectedDirectoryInventoryFromResult(receipt.request, result)
        : expectedRegularInventoryFromResult(
            receipt.request,
            result,
            previousMeta,
          );
    assert.deepEqual(receipt.inventories, array(expected));
    return;
  }
  if (
    receipt.status === "COMPLETE" &&
    [
      "PERSIST_NOREPLACE",
      "MKDIR_SYNC",
      "MOVE_NOREPLACE_SYNC",
      "MOVE_SYNC_REOBSERVE",
      "TEMP_CLEANUP",
    ].includes(receipt.operation)
  ) {
    assert.deepEqual(
      receipt.inventories,
      expectedMutationInventories(receipt.request, result, previousMeta),
    );
    return;
  }
  assert.deepEqual(receipt.inventories, array());
}

function inventoryPath(receipt, inventory, index, scopes) {
  const request = receipt.request;
  if (request.operation === "INVENTORY") {
    if (inventory.inventoryKind === "REGULAR_FILE") {
      return directoryPathForHandle(scopes, inventory.directoryHandleSha256);
    }
    if (request.inventoryDirectoryRole === "STATE_ROOT") return array();
    const parent = directoryPathForHandle(
      scopes,
      request.directoryHandleSha256A,
    );
    return array(...parent, request.nameA);
  }
  if (request.operation === "MKDIR_SYNC" && index === 1) {
    return array(
      ...directoryPathForHandle(scopes, request.directoryHandleSha256A),
      request.nameA,
    );
  }
  const handle =
    index === 1 && request.directoryHandleSha256B !== null
      ? request.directoryHandleSha256B
      : request.directoryHandleSha256A;
  return directoryPathForHandle(scopes, handle);
}

function assertAndRememberSuccessor(receipt, result) {
  const previous = receipt.previousInventorySet;
  const previousMeta =
    previous === null ? null : TOKEN_EXPECTATIONS.get(previous);
  if (previous !== null) {
    assert.notEqual(
      previousMeta,
      undefined,
      "predecessor token is evaluator-known",
    );
  }
  assertExactReceiptInventories(receipt, result, previousMeta);
  if (receipt.inventorySet === null) {
    assert.equal(receipt.inventorySetSha256, null);
    return;
  }
  let scopes = new Map(previousMeta?.scopes ?? []);
  if (receipt.outcome === "LOCK_HELD") scopes = new Map();
  const unchanged =
    receipt.status === "OBSERVATION_ONLY" ||
    receipt.operation === "RELEASE_DIRECTORY" ||
    receipt.retryDisposition === "REPLAN_AFTER_FRESH_INVENTORY";
  if (!unchanged && receipt.inventories.length > 0) {
    if (
      receipt.operation === "INVENTORY" &&
      receipt.request.inventoryDirectoryRole === "STATE_ROOT"
    ) {
      scopes = new Map();
    }
    if (
      (receipt.operation === "MOVE_NOREPLACE_SYNC" ||
        receipt.operation === "MOVE_SYNC_REOBSERVE") &&
      receipt.status === "COMPLETE"
    ) {
      const sourcePath = array(
        ...directoryPathForHandle(
          scopes,
          receipt.request.directoryHandleSha256A,
        ),
        receipt.request.nameA,
      );
      for (const [key, entry] of scopes) {
        if (
          entry.path.length >= sourcePath.length &&
          sourcePath.every(
            (component, index) => entry.path[index] === component,
          )
        ) {
          scopes.delete(key);
        }
      }
    }
    for (const [index, inventory] of receipt.inventories.entries()) {
      const projection = scopeProjection(inventory);
      const path = inventoryPath(receipt, inventory, index, scopes);
      scopes.set(scopeKey(projection), { projection, path, inventory });
    }
  }
  const projection = sortedScopeProjection(scopes);
  const token = receipt.inventorySet;
  assert.equal(token.inventorySetSha256, semanticSha256(projection));
  assert.equal(receipt.inventorySetSha256, token.inventorySetSha256);
  assert.equal(token.scopeCount, scopes.size);
  assert.equal(token.revision, previous === null ? 0 : previous.revision + 1);
  assert.equal(
    token.previousInventorySetSha256,
    previous === null ? null : previous.inventorySetSha256,
  );
  assert.equal(token.producingRequestSequence, receipt.request.requestSequence);
  assert.equal(token.producingRequestSha256, receipt.requestSha256);
  TOKEN_EXPECTATIONS.set(token, { scopes, projection });
}

function assertExactClaims(value, label) {
  assert.deepEqual(value.authority, AUTHORITY, `${label}.authority`);
  assert.deepEqual(
    value.physicalFacts,
    PHYSICAL_FACTS,
    `${label}.physicalFacts`,
  );
  assert.deepEqual(value.nonclaims, NONCLAIMS, `${label}.nonclaims`);
}

function assertExactInventoryShape(inventory, label) {
  assertExactOwnFieldOrder(
    inventory,
    INVENTORY_OBSERVATION_FIELDS,
    label,
    array("contentBytes"),
  );
  assertNullFrozenTree(inventory, label);
  assert.equal(inventory.schema, SCHEMAS[2][1], `${label}.schema`);
  assertExactOwnFieldOrder(
    inventory.directory,
    HELD_DIRECTORY_OBSERVATION_FIELDS,
    `${label}.directory`,
  );
  for (const [index, entry] of inventory.entries.entries()) {
    assertExactOwnFieldOrder(
      entry,
      INVENTORY_ENTRY_FIELDS,
      `${label}.entries[${index}]`,
    );
  }
  assertExactClaims(inventory, label);
}

function dispatchPlan(module, plan, result) {
  const ownerContext =
    module.assertCandidateContainmentGuardianStatefsPlanV1(plan);
  assert.equal(ownerContext, plan.ownerContext);
  assertExactOwnFieldOrder(plan, PLAN_FIELDS, "statefs plan");
  assertNullFrozenTree(plan, "statefs plan");
  assertExactOwnFieldOrder(ownerContext, OWNER_CONTEXT_FIELDS, "owner context");
  assertNullFrozenTree(ownerContext, "owner context");
  assert.equal(plan.schema, SCHEMAS[6][1]);
  assert.equal(ownerContext.schema, SCHEMAS[5][1]);
  assert.equal(plan.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(plan.ownerContextSha256, ownerContext.ownerContextSha256);
  assert.equal(plan.planKind, "REQUEST");
  assert.equal(plan.managerDisposition, "STATEFS_REQUEST");
  assert.notEqual(plan.request, null);
  assert.equal(plan.requestSequence, plan.request.requestSequence);
  assert.equal(plan.operation, plan.request.operation);
  assert.equal(plan.writerKind, plan.request.writerKind);
  assert.equal(plan.actorKind, plan.request.actorKind);
  assert.equal(plan.targetSha256, plan.request.targetSha256);
  assert.equal(
    plan.requiredDurableRecordType,
    plan.request.requiredDurableRecordType,
  );
  assert.equal(
    plan.requiredOutcomeRecordType,
    plan.request.requiredOutcomeRecordType,
  );
  assert.equal(plan.requestSha256, plan.request.requestSha256);
  assert.equal(plan.inventorySet, plan.request.inventorySet);
  assert.equal(plan.inventorySetSha256, plan.request.inventorySetSha256);
  assertExactClaims(plan, "statefs plan");
  assertExactClaims(ownerContext, "owner context");
  assertExactOwnFieldOrder(
    plan.request,
    REQUEST_FIELDS,
    "statefs request",
    array("bytes"),
  );
  assertNullFrozenTree(plan.request, "statefs request");
  assert.equal(plan.request.schema, SCHEMAS[7][1]);
  assert.equal(plan.request.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  assertExactClaims(plan.request, "statefs request");
  assert.equal(
    module.assertCandidateContainmentGuardianStatefsRequestV1(plan.request),
    true,
  );
  const receipt = module.verifyCandidateContainmentGuardianStatefsResultV1({
    request: plan.request,
    executorResult: result,
  });
  assertExactOwnFieldOrder(receipt, RECEIPT_FIELDS, "statefs receipt");
  assertNullFrozenTree(receipt, "statefs receipt");
  assert.equal(receipt.request, plan.request);
  assert.equal(receipt.previousInventorySet, plan.request.inventorySet);
  assert.equal(receipt.schema, SCHEMAS[9][1]);
  assert.equal(receipt.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  for (const key of [
    "requestSha256",
    "operation",
    "executionDisposition",
    "writerKind",
    "actorKind",
    "targetSha256",
    "requiredDurableRecordType",
    "requiredOutcomeRecordType",
    "inventorySetSha256",
  ]) {
    const requestKey =
      key === "inventorySetSha256" ? "inventorySetSha256" : key;
    assert.equal(
      key === "inventorySetSha256"
        ? receipt.previousInventorySetSha256
        : receipt[key],
      plan.request[requestKey],
      `receipt copies request ${key}`,
    );
  }
  assertExactClaims(receipt, "statefs receipt");
  if (receipt.inventorySet !== null) {
    assertExactOwnFieldOrder(
      receipt.inventorySet,
      INVENTORY_SET_FIELDS,
      "successor inventory token",
    );
    assertNullFrozenTree(receipt.inventorySet, "successor inventory token");
    assert.equal(receipt.inventorySet.schema, SCHEMAS[3][1]);
    assert.equal(
      receipt.inventorySet.requirementsSha256,
      EXPECTED_REQUIREMENTS_SHA256,
    );
    assertExactClaims(receipt.inventorySet, "successor inventory token");
  }
  for (const [index, inventory] of receipt.inventories.entries()) {
    assertExactInventoryShape(inventory, `receipt.inventories[${index}]`);
  }
  assertAndRememberSuccessor(receipt, result);
  assertExactDigests(plan, receipt);
  return receipt;
}

function planLock(
  module,
  { label, root = heldDirectoryObservation(), sequence = 0 },
) {
  return module.planCandidateContainmentGuardianStatefsOperationV1(
    plannerInput({
      managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
      requestSequence: sequence,
      stateRootObservation: root,
    }),
  );
}

function completeLock(module, options) {
  const plan = planLock(module, options);
  return {
    plan,
    receipt: dispatchPlan(module, plan, executorResult(plan.request)),
  };
}

const ROOT_CHILDREN = array(
  array("lifetimes", "LIFETIMES", "101"),
  array("staging", "STAGING", "102"),
  array("active", "ACTIVE", "103"),
  array("closed", "CLOSED", "104"),
  array("recovered", "RECOVERED", "105"),
  array("quarantined", "QUARANTINED", "106"),
);

function directoryNativeObservations({
  targetRole,
  targetInode,
  entries = [],
}) {
  return array(
    nativeObservation({ role: targetRole, inode: targetInode }),
    ...entries.map((entry) =>
      Array.isArray(entry)
        ? nativeObservation({ name: entry[0], role: "NONE", inode: entry[2] })
        : nativeObservation({ ...entry, role: "NONE" }),
    ),
  );
}

function inventoryInput({
  label,
  sequence,
  token,
  inventoryDirectoryRole,
  directoryRoleA,
  nameA = null,
}) {
  return plannerInput({
    kind: "INVENTORY",
    managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
    requestSequence: sequence,
    inventorySetSha256: token.inventorySetSha256,
    stateRootObservation: null,
    currentInventorySet: token,
    inventoryDirectoryRole,
    directoryRoleA,
    nameA,
    expectedOutcome: "INVENTORY_OBSERVED",
  });
}

function planDirectoryInventory(
  module,
  { label, sequence, token, role, parentRole, name = null },
) {
  return module.planCandidateContainmentGuardianStatefsOperationV1(
    inventoryInput({
      label,
      sequence,
      token,
      inventoryDirectoryRole: role,
      directoryRoleA: parentRole,
      nameA: name,
    }),
  );
}

function completeDirectoryInventory(
  module,
  {
    label,
    sequence,
    token,
    role,
    parentRole,
    name = null,
    targetInode,
    entries = [],
    returnedDirectoryFd = -1,
  },
) {
  const plan = planDirectoryInventory(module, {
    label,
    sequence,
    token,
    role,
    parentRole,
    name,
  });
  const steps = name === null ? array(1, 2, 5, 6, 24) : array(1, 2, 5, 6, 32);
  const result = executorResult(plan.request, {
    lastCompletedStep:
      name === null
        ? "INVENTORY_DESCRIPTOR_CLOSED"
        : "DIRECTORY_HANDLE_TRANSFERRED",
    completedStepCount: steps.length,
    observations: directoryNativeObservations({
      targetRole: role,
      targetInode,
      entries,
    }),
    returnedDirectoryFd,
  });
  return { plan, receipt: dispatchPlan(module, plan, result), result };
}

function completeRegularInventory(
  module,
  { label, sequence, token, role, name, bytes = null, inode = "200" },
) {
  const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
    inventoryInput({
      label,
      sequence,
      token,
      inventoryDirectoryRole: null,
      directoryRoleA: role,
      nameA: name,
    }),
  );
  const absent = bytes === null;
  const observations = absent
    ? array(
        nativeObservation({
          kind: "ABSENT",
          role,
          name,
          deviceMajor: "0",
          deviceMinor: "0",
          inode: "0",
          mountId: "0",
          byteLength: "0",
          linkCount: "0",
          mode: 0,
          ownerUid: 0,
          ownerGid: 0,
          filesystemMagic: "0",
        }),
      )
    : array(
        nativeObservation({
          kind: "REGULAR",
          role,
          name,
          inode,
          byteLength: String(bytes.length),
          linkCount: "1",
          mode: 0o100_600,
          contentLength: bytes.length,
        }),
      );
  const result = executorResult(plan.request, {
    lastCompletedStep: absent
      ? "ENTRY_REOBSERVED"
      : "INVENTORY_DESCRIPTOR_CLOSED",
    completedStepCount: absent ? 3 : 5,
    bytesConsumed: absent ? 0 : bytes.length,
    observations,
    outputBytes: absent ? Buffer.alloc(0) : Buffer.from(bytes),
  });
  return { plan, receipt: dispatchPlan(module, plan, result), result };
}

function canonicalInventoryProjection(inventory) {
  return record(
    ["schema", inventory.schema],
    ["requestSha256", inventory.requestSha256],
    ["directory", inventory.directory],
    ["directoryHandleSha256", inventory.directoryHandleSha256],
    ["inventoryKind", inventory.inventoryKind],
    ["requestedName", inventory.requestedName],
    ["entryCount", inventory.entryCount],
    ["entries", inventory.entries],
    ["contentByteLength", inventory.contentBytes?.length ?? null],
    [
      "contentRawSha256",
      inventory.contentBytes === null
        ? null
        : byteSha256(inventory.contentBytes),
    ],
  );
}

function directoryHandleSha256({
  managerActorEpochSha256,
  role,
  identitySha256,
  parentDirectoryHandleSha256,
  name,
}) {
  return semanticSha256(
    record(
      ["schema", SCHEMAS[4][1]],
      ["managerActorEpochSha256", managerActorEpochSha256],
      ["role", role],
      ["identitySha256", identitySha256],
      ["parentDirectoryHandleSha256", parentDirectoryHandleSha256],
      ["name", name],
    ),
  );
}

function canonicalRequestProjection(request) {
  return record(
    ...REQUEST_FIELDS.filter(
      (key) =>
        key !== "bytes" && key !== "inventorySet" && key !== "requestSha256",
    ).map((key) => [key, request[key]]),
  );
}

function canonicalPlanProjection(plan) {
  return record(
    ...PLAN_FIELDS.filter(
      (key) =>
        key !== "request" &&
        key !== "ownerContext" &&
        key !== "inventorySet" &&
        key !== "planSha256",
    ).map((key) => [key, plan[key]]),
  );
}

function canonicalReceiptProjection(receipt) {
  return record(
    ...DIGEST_PROJECTION_FIELDS.receipt.map((key) => [
      key,
      key === "inventories"
        ? array(
            ...receipt.inventories.map(
              (inventory) => inventory.inventorySha256,
            ),
          )
        : receipt[key],
    ]),
  );
}

function ownerDigest(value, preferredFields) {
  if (value === null) return null;
  for (const field of preferredFields) {
    if (
      typeof value[field] === "string" &&
      /^[0-9a-f]{64}$/u.test(value[field])
    ) {
      return value[field];
    }
  }
  return semanticSha256(value);
}

function canonicalOwnerContextProjection(context) {
  return record(
    ["schema", context.schema],
    ["lifetimeReplaySha256", ownerDigest(context.lifetimeReplay, [])],
    [
      "recoveryTargetSha256",
      ownerDigest(context.recoveryTarget, ["targetSha256"]),
    ],
    [
      "recoveryInventorySha256",
      ownerDigest(context.recoveryInventory, ["inventorySha256"]),
    ],
    [
      "recoveryReplaySha256",
      ownerDigest(context.recoveryReplay, ["replaySha256"]),
    ],
    ["recoveryPlanSha256", ownerDigest(context.recoveryPlan, ["planSha256"])],
    [
      "recoveryAttemptSha256",
      ownerDigest(context.recoveryAttempt, ["attemptSha256"]),
    ],
    [
      "recoveryRecordRawSha256",
      context.recoveryRecord === null ? null : context.recoveryRecord.rawSha256,
    ],
    [
      "lifetimeAnchorProjectionSha256",
      ownerDigest(context.lifetimeAnchorProjection, ["projectionSha256"]),
    ],
    ["lifetimeAttemptAnchorRawSha256", context.lifetimeAttemptAnchorRawSha256],
    [
      "generationManifestRawSha256",
      context.generationManifest === null
        ? null
        : byteSha256(context.generationManifest.bytes),
    ],
    [
      "normalJournalBundleRawSha256s",
      context.normalJournalBundles === null
        ? array()
        : array(
            ...context.normalJournalBundles.map((bundle) =>
              byteSha256(bundle.bytes),
            ),
          ),
    ],
  );
}

function ownerContextGolden(overrides = {}) {
  const values = {
    lifetimeReplay: null,
    recoveryTarget: null,
    recoveryInventory: null,
    recoveryReplay: null,
    recoveryPlan: null,
    recoveryAttempt: null,
    recoveryRecord: null,
    lifetimeAnchorProjection: null,
    lifetimeAttemptAnchorRawSha256: null,
    generationManifest: null,
    normalJournalBundles: null,
    ...overrides,
  };
  const context = record(
    ["schema", SCHEMAS[5][1]],
    ["lifetimeReplay", values.lifetimeReplay],
    ["recoveryTarget", values.recoveryTarget],
    ["recoveryInventory", values.recoveryInventory],
    ["recoveryReplay", values.recoveryReplay],
    ["recoveryPlan", values.recoveryPlan],
    ["recoveryAttempt", values.recoveryAttempt],
    ["recoveryRecord", values.recoveryRecord],
    ["lifetimeAnchorProjection", values.lifetimeAnchorProjection],
    ["lifetimeAttemptAnchorRawSha256", values.lifetimeAttemptAnchorRawSha256],
    ["generationManifest", values.generationManifest],
    ["normalJournalBundles", values.normalJournalBundles],
    ["ownerContextSha256", null],
    ["authority", AUTHORITY],
    ["physicalFacts", PHYSICAL_FACTS],
    ["nonclaims", NONCLAIMS],
  );
  const ownerContextSha256 = semanticSha256(
    canonicalOwnerContextProjection(context),
  );
  return { values, ownerContextSha256 };
}

function assertOwnerContextCapabilities(actual, golden) {
  assert.equal(actual.schema, SCHEMAS[5][1]);
  for (const key of OWNER_CONTEXT_FIELDS.filter(
    (field) =>
      ![
        "schema",
        "normalJournalBundles",
        "ownerContextSha256",
        "authority",
        "physicalFacts",
        "nonclaims",
      ].includes(field),
  )) {
    assert.deepEqual(actual[key], golden.values[key], `ownerContext.${key}`);
  }
  if (golden.values.normalJournalBundles === null) {
    assert.equal(actual.normalJournalBundles, null);
  } else {
    assert.equal(Array.isArray(actual.normalJournalBundles), true);
    assert.equal(
      actual.normalJournalBundles.length,
      golden.values.normalJournalBundles.length,
    );
    for (
      let index = 0;
      index < actual.normalJournalBundles.length;
      index += 1
    ) {
      assert.deepEqual(
        actual.normalJournalBundles[index],
        golden.values.normalJournalBundles[index],
        `ownerContext.normalJournalBundles[${index}]`,
      );
    }
  }

  if (actual.generationManifest !== null) {
    const verifiedManifest =
      journalOwner.verifyCandidateContainmentGuardianGenerationManifestV2(
        artifact(actual.generationManifest),
      );
    assert.deepEqual(actual.generationManifest, verifiedManifest);
    const verifiedBundles = actual.normalJournalBundles.map((bundle) =>
      journalOwner.verifyCandidateContainmentGuardianJournalBundleV2(
        artifact(bundle),
      ),
    );
    for (let index = 0; index < verifiedBundles.length; index += 1) {
      assert.deepEqual(
        actual.normalJournalBundles[index],
        verifiedBundles[index],
      );
    }
    if (verifiedBundles.length > 0) {
      const identity = verifiedManifest.generationIdentity;
      const latest = verifiedBundles.at(-1);
      const journalReplay =
        journalOwner.replayCandidateContainmentGuardianJournalV2({
          bundles: actual.normalJournalBundles.map(artifact),
          expectedGenerationIdentitySha256: identity.identitySha256,
          expectedBirthGuardianEpochSha256: identity.birthGuardianEpochSha256,
          expectedLatestBundleRawSha256: latest.rawSha256,
          reportedCurrentBootIdSha256: null,
        });
      assert.equal(journalReplay.latestBundleRawSha256, latest.rawSha256);
      assert.deepEqual(journalReplay.generationIdentity, identity);
    }

    if (actual.lifetimeReplay.targetCount > 0) {
      const generationIdentitySha256 =
        verifiedManifest.generationIdentity.identitySha256;
      const selection =
        lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1(
          {
            lifetimeReplay: actual.lifetimeReplay,
            generationIdentitySha256,
          },
        );
      const target = selection.recoveryTargetProjection;
      assert.equal(target.generationIdentitySha256, generationIdentitySha256);
      assert.equal(
        lifetimeOwner.assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1(
          {
            selection,
            generationIdentitySha256: target.generationIdentitySha256,
            targetSha256: target.targetSha256,
            targetBootIdSha256: target.targetBootIdSha256,
            targetDelegatedRootIdentitySha256:
              target.targetDelegatedRootIdentitySha256,
            targetLifetimeEpochSha256: target.targetLifetimeEpochSha256,
          },
        ),
        true,
      );
      const replayClone = record(...Object.entries(actual.lifetimeReplay));
      assert.throws(() =>
        lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1(
          {
            lifetimeReplay: replayClone,
            generationIdentitySha256,
          },
        ),
      );
    }
  }

  if (actual.recoveryTarget !== null) {
    assert.notEqual(actual.recoveryInventory, null);
    assert.notEqual(actual.recoveryReplay, null);
    assert.notEqual(actual.recoveryPlan, null);
    const generationIdentitySha256 =
      actual.generationManifest.generationIdentity.identitySha256;
    const targetSelection =
      lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
        lifetimeReplay: actual.lifetimeReplay,
        generationIdentitySha256,
      });
    const verifiedTarget =
      recoveryOwner.verifyCandidateContainmentRecoveryTargetV1({
        target: actual.recoveryTarget,
        generationManifest: artifact(actual.generationManifest),
        normalJournalBundles: actual.normalJournalBundles.map(artifact),
        lifetimeTargetSelection: targetSelection,
      });
    assert.deepEqual(verifiedTarget, actual.recoveryTarget);
    const verifiedInventory =
      recoveryOwner.verifyCandidateContainmentRecoveryInventoryObservationV1({
        observation: actual.recoveryInventory,
        expectedGenerationIdentitySha256: generationIdentitySha256,
      });
    assert.deepEqual(verifiedInventory, actual.recoveryInventory);
    const normalCloseDurabilityReceipt =
      actual.recoveryPlan.status === "CLOSED_LOCATION_OBSERVED"
        ? lifetimeOwner.selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1(
            {
              lifetimeReplay: actual.lifetimeReplay,
              targetSha256: actual.recoveryTarget.targetSha256,
            },
          )
        : null;
    const recoveryContext = golden.values.recoveryPlan.recoveryContext;
    const recoveryOwnerAssociation = selectRecoveryOwnerAssociation({
      target: actual.recoveryTarget,
      lifecycleInventoryObservation: actual.recoveryInventory,
      previousRecoveryReplay: actual.recoveryReplay,
      plan: actual.recoveryPlan,
      attempt: actual.recoveryAttempt,
    });
    if (recoveryOwnerAssociation === null) {
      assert.equal(actual.lifetimeAnchorProjection, null);
      assert.equal(actual.lifetimeAttemptAnchorRawSha256, null);
    } else {
      assert.equal(
        recoveryOwnerAssociation.lifetimeAnchorProjection,
        actual.lifetimeAnchorProjection,
      );
      assert.equal(
        recoveryOwnerAssociation.lifetimeAttemptAnchorRawSha256,
        actual.lifetimeAttemptAnchorRawSha256,
      );
    }
    const unbrandedPlan = record(...Object.entries(actual.recoveryPlan));
    assert.deepEqual(unbrandedPlan, actual.recoveryPlan);
    assert.notEqual(unbrandedPlan, actual.recoveryPlan);
    assert.throws(
      () =>
        selectRecoveryOwnerAssociation({
          target: actual.recoveryTarget,
          lifecycleInventoryObservation: actual.recoveryInventory,
          previousRecoveryReplay: actual.recoveryReplay,
          plan: unbrandedPlan,
          attempt: actual.recoveryAttempt,
        }),
      TypeError,
    );
    if (recoveryContext === null) {
      assert.equal(actual.recoveryPlan.recoveryContext, null);
      assert.equal(
        array(
          "RECOVERY_ANCHOR_REQUIRED",
          "CLOSE_MOVE_REQUIRED",
          "CLOSED_LOCATION_OBSERVED",
          "RECOVERY_TERMINAL",
          "UNSAFE_FILESYSTEM_INVENTORY_BLOCKED",
          "INCONSISTENT_GENERATION_STATE_BLOCKED",
          "RECOVERY_ATTEMPT_LIMIT_REACHED",
          "STATE_ROOT_IDENTITY_REJECTED",
          "STATE_FILESYSTEM_INTERFACE_REJECTED",
          "RECOVERY_LIFETIME_IDENTITY_REJECTED",
        ).includes(actual.recoveryPlan.status),
        true,
      );
      assert.notEqual(actual.recoveryPlan.status, "RECOVERY_PLAN_READY");
      assert.equal(actual.recoveryPlan.disposition, null);
      assert.equal(actual.recoveryPlan.quarantineReason, null);
      assert.deepEqual(actual.recoveryPlan.nextPermittedRecordTypes, []);
      assert.deepEqual(actual.recoveryPlan.states, []);
      assert.equal(actual.recoveryPlan.recordCount, 0);
      if (actual.recoveryPlan.status === "RECOVERY_ANCHOR_REQUIRED") {
        assert.equal(
          array("LIVE_BIRTH_GUARDIAN", "RECOVERY_ONLY_GUARDIAN").includes(
            actual.recoveryPlan.requiredActorKind,
          ),
          true,
        );
        assert.equal(actual.recoveryPlan.currentLifetimeAnchorMatched, false);
        assert.equal(actual.recoveryPlan.terminal, false);
        assert.equal(actual.recoveryAttempt, null);
        assert.equal(actual.recoveryRecord, null);
        assert.equal(actual.lifetimeAnchorProjection, null);
        assert.equal(actual.lifetimeAttemptAnchorRawSha256, null);
      } else {
        assert.equal(actual.recoveryPlan.requiredActorKind, null);
        if (
          actual.recoveryPlan.status === "CLOSE_MOVE_REQUIRED" ||
          actual.recoveryPlan.status === "CLOSED_LOCATION_OBSERVED"
        ) {
          assert.equal(actual.recoveryPlan.currentLifetimeAnchorMatched, null);
          assert.equal(
            actual.recoveryPlan.requiredDestinationLocation,
            "closed",
          );
          assert.equal(
            actual.recoveryPlan.terminal,
            actual.recoveryPlan.status === "CLOSED_LOCATION_OBSERVED",
          );
        } else if (actual.recoveryPlan.status === "RECOVERY_TERMINAL") {
          assert.equal(actual.recoveryPlan.currentLifetimeAnchorMatched, null);
          assert.equal(actual.recoveryPlan.terminal, true);
          assert.equal(
            array("recovered", "quarantined").includes(
              actual.recoveryPlan.sourceLocation,
            ),
            true,
          );
          assert.equal(
            actual.recoveryPlan.requiredDestinationLocation,
            actual.recoveryPlan.sourceLocation,
          );
        } else {
          assert.equal(actual.recoveryPlan.terminal, false);
        }
      }
      return;
    }
    assert.notEqual(recoveryOwnerAssociation, null);
    assert.equal(actual.recoveryPlan.status, "RECOVERY_PLAN_READY");
    const recoveryPlanInput = {
      target: actual.recoveryTarget,
      lifecycleInventoryObservation: actual.recoveryInventory,
      previousRecoveryReplay: actual.recoveryReplay,
      normalCloseDurabilityReceipt,
      expectedStateRootIdentitySha256:
        actual.lifetimeReplay.stateRootIdentitySha256,
      expectedCurrentBootIdSha256: actual.recoveryTarget.bootIdSha256,
      expectedDelegatedRootIdentitySha256:
        actual.recoveryTarget.generationIdentity.delegatedRootIdentitySha256,
      expectedLifetimeCgroupIdentitySha256:
        recoveryContext.reportedLifetimeCgroupIdentitySha256,
      proposedActorKind: null,
      reportedCurrentBootIdSha256: recoveryContext.reportedCurrentBootIdSha256,
      reportedStateRootIdentitySha256:
        recoveryContext.reportedStateRootIdentitySha256,
      reportedDelegatedRootIdentitySha256:
        recoveryContext.reportedDelegatedRootIdentitySha256,
      reportedLifetimeCgroupIdentitySha256:
        recoveryContext.reportedLifetimeCgroupIdentitySha256,
      reportedCommandDescriptorHeld:
        recoveryContext.reportedCommandDescriptorHeld,
      reportedStatusDescriptorHeld:
        recoveryContext.reportedStatusDescriptorHeld,
      reportedSupervisorPidfdHeld: recoveryContext.reportedSupervisorPidfdHeld,
      reportedDirectChildWaitAuthority:
        recoveryContext.reportedDirectChildWaitAuthority,
      reportedCgroupInventorySafe: recoveryContext.reportedCgroupInventorySafe,
      reportedControlCgroupPresent:
        recoveryContext.reportedControlCgroupPresent,
      reportedJobCgroupPresent: recoveryContext.reportedJobCgroupPresent,
      reportedStateFilesystemInterfaceAvailable:
        recoveryContext.reportedStateFilesystemInterfaceAvailable,
      reportedRecoveryInterfaceAvailable:
        recoveryContext.reportedRecoveryInterfaceAvailable,
      currentLifetimeAnchorProjection: actual.lifetimeAnchorProjection,
      currentLifetimeAttemptAnchorRawSha256:
        actual.lifetimeAttemptAnchorRawSha256,
    };
    assert.deepEqual(
      recoveryOwner.planCandidateContainmentRecoveryV1(recoveryPlanInput),
      actual.recoveryPlan,
    );
    assert.throws(() =>
      recoveryOwner.planCandidateContainmentRecoveryV1({
        ...recoveryPlanInput,
        previousRecoveryReplay: record(
          ...Object.entries(actual.recoveryReplay),
        ),
      }),
    );
  }

  if (actual.recoveryAttempt !== null) {
    assert.notEqual(actual.recoveryTarget, null);
    assert.notEqual(actual.recoveryInventory, null);
    assert.notEqual(actual.recoveryReplay, null);
    assert.notEqual(actual.recoveryPlan, null);
    assert.notEqual(actual.lifetimeAnchorProjection, null);
    assert.notEqual(actual.lifetimeAttemptAnchorRawSha256, null);
    assert.equal(
      lifetimeOwner.assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
        {
          lifetimeAnchorProjection: actual.lifetimeAnchorProjection,
          lifetimeAttemptAnchorRawSha256: actual.lifetimeAttemptAnchorRawSha256,
          targetSha256: actual.recoveryTarget.targetSha256,
          recoveryActorEpochSha256:
            actual.recoveryAttempt.recoveryActorEpochSha256,
        },
      ),
      true,
    );
    const verifiedAttempt =
      recoveryOwner.verifyCandidateContainmentRecoveryAttemptV1({
        attempt: actual.recoveryAttempt,
        target: actual.recoveryTarget,
        lifecycleInventoryObservation: actual.recoveryInventory,
        previousRecoveryReplay: actual.recoveryReplay,
        plan: actual.recoveryPlan,
        lifetimeAnchorProjection: actual.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256: actual.lifetimeAttemptAnchorRawSha256,
      });
    assert.deepEqual(verifiedAttempt, actual.recoveryAttempt);
    assert.throws(() =>
      recoveryOwner.verifyCandidateContainmentRecoveryAttemptV1({
        attempt: actual.recoveryAttempt,
        target: actual.recoveryTarget,
        lifecycleInventoryObservation: actual.recoveryInventory,
        previousRecoveryReplay: actual.recoveryReplay,
        plan: record(...Object.entries(actual.recoveryPlan)),
        lifetimeAnchorProjection: actual.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256: actual.lifetimeAttemptAnchorRawSha256,
      }),
    );
    assert.throws(() =>
      lifetimeOwner.assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
        {
          lifetimeAnchorProjection: record(
            ...Object.entries(actual.lifetimeAnchorProjection),
          ),
          lifetimeAttemptAnchorRawSha256: actual.lifetimeAttemptAnchorRawSha256,
          targetSha256: actual.recoveryTarget.targetSha256,
          recoveryActorEpochSha256:
            actual.recoveryAttempt.recoveryActorEpochSha256,
        },
      ),
    );
  }

  if (actual.recoveryRecord !== null) {
    assert.notEqual(actual.recoveryAttempt, null);
    const verifiedRecord =
      recoveryOwner.verifyCandidateContainmentRecoveryRecordV1(
        artifact(actual.recoveryRecord),
      );
    assert.deepEqual(verifiedRecord, actual.recoveryRecord);
    assert.deepEqual(verifiedRecord.attempt, actual.recoveryAttempt);
    const changedBytes = Buffer.from(actual.recoveryRecord.bytes);
    changedBytes[changedBytes.length - 2] ^= 1;
    assert.throws(() =>
      recoveryOwner.verifyCandidateContainmentRecoveryRecordV1({
        name: actual.recoveryRecord.name,
        bytes: changedBytes,
      }),
    );
  }
}

function requestGolden(spec) {
  const token = spec.token ?? null;
  const bytes = spec.bytes === undefined ? null : Buffer.from(spec.bytes);
  const inputRawSha256 = bytes === null ? null : byteSha256(bytes);
  const executionDisposition = spec.executionDisposition ?? "EXECUTE";
  let temporaryIdentitySha256 = spec.temporaryIdentitySha256 ?? null;
  let nameA = spec.nameA ?? null;
  if (
    spec.operation === "PERSIST_NOREPLACE" &&
    executionDisposition === "EXECUTE"
  ) {
    temporaryIdentitySha256 = semanticSha256(
      record(
        ["managerActorEpochSha256", spec.managerActorEpochSha256],
        ["authorizationRawSha256", spec.authorizationRawSha256],
        ["operation", spec.operation],
        ["nameB", spec.nameB],
        ["inputRawSha256", inputRawSha256],
      ),
    );
    nameA = `.${spec.nameB}.tmp-${temporaryIdentitySha256}`;
  }
  const values = {
    bytes,
    inventorySet: token,
    schema: SCHEMAS[7][1],
    requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
    managerActorEpochSha256: spec.managerActorEpochSha256,
    requestSequence: spec.requestSequence,
    inventorySetSha256: token?.inventorySetSha256 ?? null,
    requestSha256: null,
    operation: spec.operation,
    executionDisposition,
    writerKind: spec.writerKind ?? null,
    actorKind: spec.actorKind ?? null,
    targetSha256: spec.targetSha256 ?? null,
    requiredDurableRecordType: spec.requiredDurableRecordType ?? null,
    requiredOutcomeRecordType: spec.requiredOutcomeRecordType ?? null,
    inventoryKind: spec.inventoryKind ?? "NONE",
    inventoryDirectoryRole: spec.inventoryDirectoryRole ?? null,
    directoryRoleA: spec.directoryRoleA ?? null,
    directoryIdentitySha256A: spec.directoryIdentitySha256A ?? null,
    directoryHandleSha256A: spec.directoryHandleSha256A ?? null,
    directoryRoleB: spec.directoryRoleB ?? null,
    directoryIdentitySha256B: spec.directoryIdentitySha256B ?? null,
    directoryHandleSha256B: spec.directoryHandleSha256B ?? null,
    nameA,
    nameB: spec.nameB ?? null,
    inputByteLength: bytes?.length ?? 0,
    inputRawSha256,
    temporaryIdentitySha256,
    authorizationRawSha256: spec.authorizationRawSha256 ?? null,
    unresolvedReceiptSha256: spec.unresolvedReceiptSha256 ?? null,
    expectedOutcome: spec.expectedOutcome,
    authority: AUTHORITY,
    physicalFacts: PHYSICAL_FACTS,
    nonclaims: NONCLAIMS,
  };
  const projection = record(
    ...REQUEST_FIELDS.filter(
      (key) =>
        key !== "bytes" && key !== "inventorySet" && key !== "requestSha256",
    ).map((key) => [key, values[key]]),
  );
  values.requestSha256 = semanticSha256(projection);
  return record(...REQUEST_FIELDS.map((key) => [key, values[key]]));
}

function assertFullRequestPlanGolden(plan, spec) {
  const expectedRequest = requestGolden(spec.request);
  assert.equal(plan.request.inventorySet, expectedRequest.inventorySet);
  assert.deepEqual(plan.request.bytes, expectedRequest.bytes);
  for (const key of REQUEST_FIELDS.filter(
    (field) => field !== "bytes" && field !== "inventorySet",
  )) {
    assert.deepEqual(plan.request[key], expectedRequest[key], `request.${key}`);
  }
  const contextGolden = ownerContextGolden(spec.ownerContext);
  assertOwnerContextCapabilities(plan.ownerContext, contextGolden);
  assert.equal(
    plan.ownerContext.ownerContextSha256,
    contextGolden.ownerContextSha256,
  );
  const planValues = {
    schema: SCHEMAS[6][1],
    requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
    managerActorEpochSha256: expectedRequest.managerActorEpochSha256,
    requestSequence: expectedRequest.requestSequence,
    inventorySetSha256: expectedRequest.inventorySetSha256,
    planKind: "REQUEST",
    managerDisposition: "STATEFS_REQUEST",
    operation: expectedRequest.operation,
    writerKind: expectedRequest.writerKind,
    actorKind: expectedRequest.actorKind,
    targetSha256: expectedRequest.targetSha256,
    requiredDurableRecordType: expectedRequest.requiredDurableRecordType,
    requiredOutcomeRecordType: expectedRequest.requiredOutcomeRecordType,
    guardianAction: null,
    requestSha256: expectedRequest.requestSha256,
    ownerContextSha256: contextGolden.ownerContextSha256,
    planSha256: null,
    authority: AUTHORITY,
    physicalFacts: PHYSICAL_FACTS,
    nonclaims: NONCLAIMS,
  };
  const projection = record(
    ...PLAN_FIELDS.filter(
      (key) =>
        key !== "request" &&
        key !== "ownerContext" &&
        key !== "inventorySet" &&
        key !== "planSha256",
    ).map((key) => [key, planValues[key]]),
  );
  planValues.planSha256 = semanticSha256(projection);
  assert.equal(plan.inventorySet, expectedRequest.inventorySet);
  for (const key of PLAN_FIELDS.filter(
    (field) => !["request", "ownerContext", "inventorySet"].includes(field),
  )) {
    assert.deepEqual(plan[key], planValues[key], `plan.${key}`);
  }
  return expectedRequest;
}

function assertFullContextPlanGolden(plan, spec) {
  const contextGolden = ownerContextGolden(spec.ownerContext);
  assertExactOwnFieldOrder(plan, PLAN_FIELDS, "context-only statefs plan");
  assertNullFrozenTree(plan, "context-only statefs plan");
  assertExactOwnFieldOrder(
    plan.ownerContext,
    OWNER_CONTEXT_FIELDS,
    "context-only owner context",
  );
  assertNullFrozenTree(plan.ownerContext, "context-only owner context");
  assertExactClaims(plan, "context-only statefs plan");
  assertExactClaims(plan.ownerContext, "context-only owner context");
  assert.equal(plan.request, null);
  assert.equal(plan.inventorySet, spec.token);
  assertOwnerContextCapabilities(plan.ownerContext, contextGolden);
  const values = {
    schema: SCHEMAS[6][1],
    requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
    managerActorEpochSha256: spec.managerActorEpochSha256,
    requestSequence: spec.requestSequence,
    inventorySetSha256: spec.token.inventorySetSha256,
    planKind: "CONTEXT_ONLY",
    managerDisposition: spec.managerDisposition,
    operation: null,
    writerKind: spec.writerKind ?? null,
    actorKind: spec.actorKind ?? null,
    targetSha256: spec.targetSha256 ?? null,
    requiredDurableRecordType: spec.requiredDurableRecordType ?? null,
    requiredOutcomeRecordType: spec.requiredOutcomeRecordType ?? null,
    guardianAction: spec.guardianAction ?? null,
    requestSha256: null,
    ownerContextSha256: contextGolden.ownerContextSha256,
    planSha256: null,
    authority: AUTHORITY,
    physicalFacts: PHYSICAL_FACTS,
    nonclaims: NONCLAIMS,
  };
  values.planSha256 = semanticSha256(
    record(
      ...PLAN_FIELDS.filter(
        (key) =>
          key !== "request" &&
          key !== "ownerContext" &&
          key !== "inventorySet" &&
          key !== "planSha256",
      ).map((key) => [key, values[key]]),
    ),
  );
  for (const key of PLAN_FIELDS.filter(
    (field) => !["request", "ownerContext", "inventorySet"].includes(field),
  )) {
    assert.deepEqual(plan[key], values[key], `context plan.${key}`);
  }
}

function assertAndConsumeContextPlan(module, plan, spec) {
  assertFullContextPlanGolden(plan, spec);
  assert.equal(
    plan.ownerContext.ownerContextSha256,
    semanticSha256(canonicalOwnerContextProjection(plan.ownerContext)),
  );
  assert.equal(plan.planSha256, semanticSha256(canonicalPlanProjection(plan)));
  expectCode(
    () => module.assertCandidateContainmentGuardianStatefsPlanV1({ ...plan }),
    "STATEFS_BINDING",
  );
  const context = module.assertCandidateContainmentGuardianStatefsPlanV1(plan);
  assert.equal(context, plan.ownerContext);
  expectCode(
    () => module.assertCandidateContainmentGuardianStatefsPlanV1(plan),
    "STATEFS_BINDING",
  );
  return context;
}

function assertFullReceiptGolden(receipt, result, expectedRequest, outcome) {
  const observationOnly = result === null;
  const expected = {
    schema: SCHEMAS[9][1],
    requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
    requestSha256: expectedRequest.requestSha256,
    operation: expectedRequest.operation,
    executionDisposition: expectedRequest.executionDisposition,
    writerKind: expectedRequest.writerKind,
    actorKind: expectedRequest.actorKind,
    targetSha256: expectedRequest.targetSha256,
    requiredDurableRecordType: expectedRequest.requiredDurableRecordType,
    requiredOutcomeRecordType: expectedRequest.requiredOutcomeRecordType,
    previousInventorySetSha256: expectedRequest.inventorySetSha256,
    inventorySetSha256:
      receipt.inventorySet === null
        ? null
        : semanticSha256(
            TOKEN_EXPECTATIONS.get(receipt.inventorySet).projection,
          ),
    status:
      outcome.status ?? (observationOnly ? "OBSERVATION_ONLY" : result.status),
    effectClass:
      outcome.effectClass ??
      (observationOnly ? "DEFINITE_NO_EFFECT" : result.effectClass),
    lastCompletedStep: observationOnly ? "NONE" : result.lastCompletedStep,
    failedStep: observationOnly ? "NONE" : result.failedStep,
    errno: observationOnly ? 0 : result.errno,
    completedStepCount: observationOnly ? 0 : result.completedStepCount,
    bytesConsumed: observationOnly ? 0 : result.bytesConsumed,
    outcome: outcome.outcome,
    retryDisposition: outcome.retryDisposition,
    inventories: receipt.inventories.map(
      (inventory) => inventory.inventorySha256,
    ),
  };
  const projection = record(
    ...DIGEST_PROJECTION_FIELDS.receipt.map((key) => [key, expected[key]]),
  );
  for (const key of DIGEST_PROJECTION_FIELDS.receipt) {
    if (key !== "inventories") {
      assert.deepEqual(receipt[key], expected[key], `receipt.${key}`);
    }
  }
  assert.equal(receipt.receiptSha256, semanticSha256(projection));
}

function assertExactDigests(plan, receipt) {
  assert.equal(
    plan.ownerContext.ownerContextSha256,
    semanticSha256(canonicalOwnerContextProjection(plan.ownerContext)),
  );
  assert.equal(
    plan.request.requestSha256,
    semanticSha256(canonicalRequestProjection(plan.request)),
  );
  assert.equal(plan.planSha256, semanticSha256(canonicalPlanProjection(plan)));
  assert.equal(
    receipt.receiptSha256,
    semanticSha256(canonicalReceiptProjection(receipt)),
  );
  for (const inventory of receipt.inventories) {
    assert.equal(
      inventory.inventorySha256,
      semanticSha256(canonicalInventoryProjection(inventory)),
    );
  }
}

function artifact(value) {
  return record(["name", value.name], ["bytes", value.bytes]);
}

function lifetimeReplayArguments(owner, recordCount = owner.records.length) {
  const records = owner.records.slice(0, recordCount);
  const latest = records.at(-1) ?? null;
  return record(
    [
      "segments",
      recordCount === 0
        ? array()
        : array(
            record(
              ["lifetimeIdentity", owner.identity],
              ["records", array(...records.map(artifact))],
            ),
          ),
    ],
    ["expectedStateRootIdentitySha256", owner.root.identitySha256],
    [
      "expectedLatestLifetimeEpochSha256",
      latest === null ? null : owner.identity.lifetimeEpochSha256,
    ],
    ["expectedLatestRecordSequence", latest?.sequence ?? null],
    ["expectedLatestRecordRawSha256", latest?.rawSha256 ?? null],
  );
}

function replayLifetimeIndependently(argumentsValue) {
  return lifetimeOwner.replayCandidateContainmentGuardianLifetimeV1({
    segments: argumentsValue.segments.map((segment) => ({
      lifetimeIdentity: segment.lifetimeIdentity,
      records: segment.records.map((entry) => ({
        name: entry.name,
        bytes: entry.bytes,
      })),
    })),
    expectedStateRootIdentitySha256:
      argumentsValue.expectedStateRootIdentitySha256,
    expectedLatestLifetimeEpochSha256:
      argumentsValue.expectedLatestLifetimeEpochSha256,
    expectedLatestRecordSequence: argumentsValue.expectedLatestRecordSequence,
    expectedLatestRecordRawSha256: argumentsValue.expectedLatestRecordRawSha256,
  });
}

function createLifetimeOwner({
  label,
  root,
  managerActorEpochSha256,
  journal = null,
}) {
  const zeroReplay = lifetimeOwner.replayCandidateContainmentGuardianLifetimeV1(
    {
      segments: [],
      expectedStateRootIdentitySha256: root.identitySha256,
      expectedLatestLifetimeEpochSha256: null,
      expectedLatestRecordSequence: null,
      expectedLatestRecordRawSha256: null,
    },
  );
  const identity =
    lifetimeOwner.createCandidateContainmentGuardianLifetimeIdentityV1({
      lifetimeKind: "NORMAL",
      stateRootIdentitySha256: root.identitySha256,
      managerActorEpochSha256,
      bootIdSha256: journal?.bootIdSha256 ?? digest(`${label}:boot`),
      delegatedRootIdentitySha256:
        journal?.delegatedRootIdentitySha256 ??
        digest(`${label}:delegated-root`),
      lifetimeEpochSha256:
        journal?.birthGuardianEpochSha256 ?? digest(`${label}:lifetime-epoch`),
      limitsSha256: digest(`${label}:lifetime-limits`),
      guardianExecutableIdentitySha256: digest(`${label}:guardian-executable`),
      guardianControlRequirementsSha256: digest(
        `${label}:guardian-control-requirements`,
      ),
      previousLifetimeReplay: zeroReplay,
    });
  const owner = {
    label,
    root,
    managerActorEpochSha256,
    identity,
    records: [],
    zeroReplay,
    replay: zeroReplay,
  };
  owner.append = (
    recordType,
    {
      writerKind = "SERVICE_MANAGER",
      writerActorEpochSha256 = managerActorEpochSha256,
      targetSha256 = null,
      operation = ownerFixtures.opaque(`${label}:${recordType}:operation`),
      evidence = ownerFixtures.opaque(`${label}:${recordType}:evidence`),
    } = {},
  ) => {
    const created =
      lifetimeOwner.createCandidateContainmentGuardianLifetimeRecordV1({
        previousLifetimeReplay: owner.replay,
        lifetimeIdentity: identity,
        writerKind,
        writerActorEpochSha256,
        targetSha256,
        recordType,
        operationBytes: Buffer.from(`${canonicalJson(operation)}\n`, "utf8"),
        evidenceBytes: Buffer.from(`${canonicalJson(evidence)}\n`, "utf8"),
      });
    owner.records.push(created);
    owner.replay = lifetimeOwner.replayCandidateContainmentGuardianLifetimeV1({
      segments: [
        {
          lifetimeIdentity: identity,
          records: owner.records.map((entry) => ({
            name: entry.name,
            bytes: entry.bytes,
          })),
        },
      ],
      expectedStateRootIdentitySha256: root.identitySha256,
      expectedLatestLifetimeEpochSha256: identity.lifetimeEpochSha256,
      expectedLatestRecordSequence: created.sequence,
      expectedLatestRecordRawSha256: created.rawSha256,
    });
    return created;
  };
  return owner;
}

function createAdoptedLifetimeOwner({
  label,
  root,
  managerActorEpochSha256,
  journal,
}) {
  const owner = createLifetimeOwner({
    label,
    root,
    managerActorEpochSha256,
    journal,
  });
  owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
  owner.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
  const contextPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.lifetimeContext],
    ["lifetimeIdentitySha256", owner.identity.identitySha256],
    ["stateRootIdentitySha256", root.identitySha256],
    ["bootIdSha256", journal.bootIdSha256],
    ["delegatedRootIdentitySha256", journal.delegatedRootIdentitySha256],
    ["lifetimeCgroupIdentitySha256", digest(`${label}:lifetime-cgroup`)],
  );
  const context = record(...Object.entries(contextPrefix), [
    "contextSha256",
    semanticSha256(contextPrefix),
  ]);
  owner.lifetimeContext = context;
  owner.append("LIFETIME_CGROUP_CONFIGURED_OBSERVED", { evidence: context });
  owner.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
  owner.append("GUARDIAN_PIDFD_OBSERVED");
  owner.append("GUARDIAN_EXEC_OBSERVED");
  owner.append("GUARDIAN_MEMBERSHIP_OBSERVED");
  owner.append("GUARDIAN_INITIALIZATION_ADOPTED", {
    writerKind: "LIVE_BIRTH_GUARDIAN",
    writerActorEpochSha256: owner.identity.lifetimeEpochSha256,
  });
  return owner;
}

function createNormalHandoffLifetimeOwner({
  label,
  root,
  managerActorEpochSha256,
}) {
  const owner = createLifetimeOwner({
    label,
    root,
    managerActorEpochSha256,
  });
  owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
  owner.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
  const contextPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.lifetimeContext],
    ["lifetimeIdentitySha256", owner.identity.identitySha256],
    ["stateRootIdentitySha256", root.identitySha256],
    ["bootIdSha256", owner.identity.bootIdSha256],
    ["delegatedRootIdentitySha256", owner.identity.delegatedRootIdentitySha256],
    ["lifetimeCgroupIdentitySha256", digest(`${label}:lifetime-cgroup`)],
  );
  owner.lifetimeContext = record(...Object.entries(contextPrefix), [
    "contextSha256",
    semanticSha256(contextPrefix),
  ]);
  owner.append("LIFETIME_CGROUP_CONFIGURED_OBSERVED", {
    evidence: owner.lifetimeContext,
  });
  owner.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
  return owner;
}

function createTerminalLifetimeOwner({
  label,
  root,
  managerActorEpochSha256,
  journal,
}) {
  const owner = createAdoptedLifetimeOwner({
    label,
    root,
    managerActorEpochSha256,
    journal,
  });
  owner.append("GUARDIAN_TERMINATION_OBSERVED");
  owner.append("GUARDIAN_REAPED_OBSERVED");
  owner.append("LIFETIME_REMOVAL_INTENT_DURABLE");
  owner.append("LIFETIME_PATH_ABSENT_OBSERVED");
  owner.append("LIFETIME_CLOSED_DURABLE");
  assert.equal(owner.replay.status, "COMPLETE_LIFETIME_CHAIN_REPLAYED");
  return owner;
}

function installRecoveryTargetForOwner(owner, journal) {
  const { target: independentlyDerivedTarget, projection } =
    ownerFixtures.independentlyDeriveRecoveryTargetFromFixtureArtifacts(
      journal,
    );
  const inventoryPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.targetGenesisInventory],
    ["targetSha256", projection.targetSha256],
    ["reportedRecoveryDirectoryPresent", true],
    ["reportedRecoveryDirectoryEntryCount", 0],
    ["reportedExistingLifetimeTargetHead", false],
  );
  const targetGenesisInventory = record(...Object.entries(inventoryPrefix), [
    "inventorySha256",
    semanticSha256(inventoryPrefix),
  ]);
  const eventPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.targetGenesisEvent],
    ["recoveryTargetProjection", projection],
    ["targetGenesisInventory", targetGenesisInventory],
    ["provedRebootTransitions", array()],
  );
  const event = record(...Object.entries(eventPrefix), [
    "eventSha256",
    semanticSha256(eventPrefix),
  ]);
  const genesisHead = ownerFixtures.recoveryExternalHead({
    targetSha256: projection.targetSha256,
    result: "NO_RECOVERY_ATTEMPT",
    recoveryActorEpochSha256: null,
    attemptDirectoryName: null,
    lifetimeAttemptAnchorRawSha256: null,
    latestRecoveryRecordSequence: null,
    latestRecoveryRecordRawSha256: ownerFixtures.ZERO_SHA256,
  });
  owner.append("GENERATION_RECOVERY_HEAD_DURABLE", {
    writerKind: "LIVE_BIRTH_GUARDIAN",
    writerActorEpochSha256: owner.identity.lifetimeEpochSha256,
    targetSha256: projection.targetSha256,
    operation: event,
    evidence: genesisHead,
  });
  const lifetimeTargetSelection =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: owner.replay,
      generationIdentitySha256: journal.generationIdentity.identitySha256,
    });
  const recoveryTarget =
    recoveryOwner.createCandidateContainmentRecoveryTargetV1({
      generationManifest: artifact(journal.generationManifest),
      normalJournalBundles: journalArtifactList(journal),
      lifetimeTargetSelection,
    });
  assert.equal(
    canonicalJson(recoveryTarget),
    canonicalJson(independentlyDerivedTarget),
  );
  const expectedExternalHead =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  const recoveryReplay = recoveryOwner.replayCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    entries: array(),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
    currentLifetimeAnchorPredecessorExternalHead: null,
    normalCloseDurabilityReceipt: null,
  });
  return {
    projection,
    genesisHead,
    lifetimeTargetSelection,
    recoveryTarget,
    expectedExternalHead,
    recoveryReplay,
  };
}

function recoveryPlannerInput({
  owner,
  target,
  inventory,
  replay,
  proposedActorKind,
  anchorSelection = null,
}) {
  const context = owner.lifetimeContext;
  return {
    target,
    lifecycleInventoryObservation: inventory,
    previousRecoveryReplay: replay,
    normalCloseDurabilityReceipt: null,
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedCurrentBootIdSha256: context.bootIdSha256,
    expectedDelegatedRootIdentitySha256: context.delegatedRootIdentitySha256,
    expectedLifetimeCgroupIdentitySha256: context.lifetimeCgroupIdentitySha256,
    proposedActorKind,
    reportedCurrentBootIdSha256: context.bootIdSha256,
    reportedStateRootIdentitySha256: owner.root.identitySha256,
    reportedDelegatedRootIdentitySha256: context.delegatedRootIdentitySha256,
    reportedLifetimeCgroupIdentitySha256: context.lifetimeCgroupIdentitySha256,
    reportedCommandDescriptorHeld: false,
    reportedStatusDescriptorHeld: false,
    reportedSupervisorPidfdHeld: false,
    reportedDirectChildWaitAuthority: false,
    reportedCgroupInventorySafe: true,
    reportedControlCgroupPresent: false,
    reportedJobCgroupPresent: false,
    reportedStateFilesystemInterfaceAvailable: true,
    reportedRecoveryInterfaceAvailable: true,
    currentLifetimeAnchorProjection:
      anchorSelection?.lifetimeAnchorProjection ?? null,
    currentLifetimeAttemptAnchorRawSha256:
      anchorSelection?.lifetimeAttemptAnchorRawSha256 ?? null,
  };
}

function buildRecoveryReplanTuple(
  owner,
  journal,
  { location = "active" } = {},
) {
  const installed = installRecoveryTargetForOwner(owner, journal);
  owner.append("GUARDIAN_TERMINATION_OBSERVED");
  owner.append("GUARDIAN_REAPED_OBSERVED");
  const lifetimeTargetSelection =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: owner.replay,
      generationIdentitySha256: journal.generationIdentity.identitySha256,
    });
  const recoveryTarget =
    recoveryOwner.verifyCandidateContainmentRecoveryTargetV1({
      target: installed.recoveryTarget,
      generationManifest: artifact(journal.generationManifest),
      normalJournalBundles: journalArtifactList(journal),
      lifetimeTargetSelection,
    });
  const expectedExternalHead =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  const recoveryReplay = recoveryOwner.replayCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    entries: array(),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
    currentLifetimeAnchorPredecessorExternalHead: null,
    normalCloseDurabilityReceipt: null,
  });
  const recoveryInventory =
    recoveryOwner.createCandidateContainmentRecoveryInventoryObservationV1({
      generationIdentitySha256: journal.generationIdentity.identitySha256,
      stagingPresent: location === "staging",
      activePresent: location === "active",
      closedPresent: location === "closed",
      recoveredPresent: location === "recovered",
      quarantinedPresent: location === "quarantined",
      unsafeEntriesPresent: false,
    });
  const recoveryPlan = recoveryOwner.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory: recoveryInventory,
      replay: recoveryReplay,
      proposedActorKind: "RECOVERY_ONLY_GUARDIAN",
    }),
  );
  assert.equal(recoveryPlan.status, "RECOVERY_ANCHOR_REQUIRED");
  assert.equal(recoveryPlan.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");
  return {
    ...installed,
    lifetimeTargetSelection,
    recoveryTarget,
    recoveryInventory,
    recoveryReplay,
    recoveryPlan,
  };
}

function buildRecoveryOnlyAttemptTuple(
  owner,
  journal,
  { location = "active", launchState = "NONE" } = {},
) {
  assert.equal(new Set(["NONE", "INTENT", "ADOPTED"]).has(launchState), true);
  const installed = installRecoveryTargetForOwner(owner, journal);
  owner.append("GUARDIAN_TERMINATION_OBSERVED");
  owner.append("GUARDIAN_REAPED_OBSERVED");
  let lifetimeTargetSelection =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: owner.replay,
      generationIdentitySha256: journal.generationIdentity.identitySha256,
    });
  let recoveryTarget = recoveryOwner.verifyCandidateContainmentRecoveryTargetV1(
    {
      target: installed.recoveryTarget,
      generationManifest: artifact(journal.generationManifest),
      normalJournalBundles: journalArtifactList(journal),
      lifetimeTargetSelection,
    },
  );
  let expectedExternalHead =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  let recoveryReplay = recoveryOwner.replayCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    entries: array(),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
    currentLifetimeAnchorPredecessorExternalHead: null,
    normalCloseDurabilityReceipt: null,
  });
  const recoveryInventory =
    recoveryOwner.createCandidateContainmentRecoveryInventoryObservationV1({
      generationIdentitySha256: journal.generationIdentity.identitySha256,
      stagingPresent: location === "staging",
      activePresent: location === "active",
      closedPresent: location === "closed",
      recoveredPresent: location === "recovered",
      quarantinedPresent: location === "quarantined",
      unsafeEntriesPresent: false,
    });
  const phaseOne = recoveryOwner.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory: recoveryInventory,
      replay: recoveryReplay,
      proposedActorKind: "RECOVERY_ONLY_GUARDIAN",
    }),
  );
  assert.equal(phaseOne.status, "RECOVERY_ANCHOR_REQUIRED");
  assert.equal(phaseOne.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");
  const recoveryActorEpochSha256 = digest(`${owner.label}:recovery-only-actor`);
  const anchorProjection = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.anchorProjection],
    ["targetSha256", recoveryTarget.targetSha256],
    ["actorKind", "RECOVERY_ONLY_GUARDIAN"],
    ["recoveryActorEpochSha256", recoveryActorEpochSha256],
    ["attemptDirectoryName", recoveryActorEpochSha256],
    ["expectedStateRootIdentitySha256", owner.root.identitySha256],
    ["expectedCurrentBootIdSha256", owner.lifetimeContext.bootIdSha256],
    [
      "expectedDelegatedRootIdentitySha256",
      owner.lifetimeContext.delegatedRootIdentitySha256,
    ],
    [
      "expectedLifetimeCgroupIdentitySha256",
      owner.lifetimeContext.lifetimeCgroupIdentitySha256,
    ],
    [
      "previousRecoveryActorEpochSha256",
      expectedExternalHead.recoveryActorEpochSha256,
    ],
    ["previousAttemptDirectoryName", expectedExternalHead.attemptDirectoryName],
    [
      "previousRecoveryRecordSequence",
      expectedExternalHead.latestRecoveryRecordSequence,
    ],
    [
      "previousRecoveryRecordRawSha256",
      expectedExternalHead.latestRecoveryRecordRawSha256,
    ],
  );
  const anchorEventPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.anchorEvent],
    ["predecessorExternalHead", expectedExternalHead],
    ["anchorProjection", anchorProjection],
  );
  const anchorEvent = record(...Object.entries(anchorEventPrefix), [
    "eventSha256",
    semanticSha256(anchorEventPrefix),
  ]);
  const anchorRecord = owner.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
    targetSha256: recoveryTarget.targetSha256,
    evidence: anchorEvent,
  });
  lifetimeTargetSelection =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: owner.replay,
      generationIdentitySha256: journal.generationIdentity.identitySha256,
    });
  recoveryTarget = recoveryOwner.verifyCandidateContainmentRecoveryTargetV1({
    target: recoveryTarget,
    generationManifest: artifact(journal.generationManifest),
    normalJournalBundles: journalArtifactList(journal),
    lifetimeTargetSelection,
  });
  let anchorSelection =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1(
      {
        lifetimeReplay: owner.replay,
        targetSha256: recoveryTarget.targetSha256,
        recoveryActorEpochSha256,
      },
    );
  expectedExternalHead =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  recoveryReplay = recoveryOwner.replayCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    entries: array(),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection: anchorSelection.lifetimeAnchorProjection,
    currentLifetimeAttemptAnchorRawSha256:
      anchorSelection.lifetimeAttemptAnchorRawSha256,
    currentLifetimeAnchorPredecessorExternalHead: expectedExternalHead,
    normalCloseDurabilityReceipt: null,
  });
  if (launchState !== "NONE") {
    owner.append("RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE", {
      targetSha256: recoveryTarget.targetSha256,
    });
    if (launchState === "ADOPTED") {
      owner.append("RECOVERY_GUARDIAN_PIDFD_OBSERVED", {
        targetSha256: recoveryTarget.targetSha256,
      });
      owner.append("RECOVERY_GUARDIAN_EXEC_OBSERVED", {
        targetSha256: recoveryTarget.targetSha256,
      });
      owner.append("RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED", {
        targetSha256: recoveryTarget.targetSha256,
      });
    }
    lifetimeTargetSelection =
      lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
        lifetimeReplay: owner.replay,
        generationIdentitySha256: journal.generationIdentity.identitySha256,
      });
    recoveryTarget = recoveryOwner.verifyCandidateContainmentRecoveryTargetV1({
      target: recoveryTarget,
      generationManifest: artifact(journal.generationManifest),
      normalJournalBundles: journalArtifactList(journal),
      lifetimeTargetSelection,
    });
    anchorSelection =
      lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1(
        {
          lifetimeReplay: owner.replay,
          targetSha256: recoveryTarget.targetSha256,
          recoveryActorEpochSha256,
        },
      );
    expectedExternalHead =
      lifetimeOwner.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
        lifetimeReplay: owner.replay,
        targetSha256: recoveryTarget.targetSha256,
      });
    recoveryReplay = recoveryOwner.replayCandidateContainmentRecoveryV1({
      target: recoveryTarget,
      entries: array(),
      expectedStateRootIdentitySha256: owner.root.identitySha256,
      expectedExternalHead,
      currentLifetimeAnchorProjection: anchorSelection.lifetimeAnchorProjection,
      currentLifetimeAttemptAnchorRawSha256:
        anchorSelection.lifetimeAttemptAnchorRawSha256,
      currentLifetimeAnchorPredecessorExternalHead: expectedExternalHead,
      normalCloseDurabilityReceipt: null,
    });
  }
  const recoveryPlan = recoveryOwner.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory: recoveryInventory,
      replay: recoveryReplay,
      proposedActorKind: null,
      anchorSelection,
    }),
  );
  assert.equal(recoveryPlan.status, "RECOVERY_PLAN_READY");
  assert.equal(recoveryPlan.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");
  const recoveryAttempt =
    recoveryOwner.createCandidateContainmentRecoveryAttemptV1({
      target: recoveryTarget,
      lifecycleInventoryObservation: recoveryInventory,
      previousRecoveryReplay: recoveryReplay,
      plan: recoveryPlan,
      lifetimeAnchorProjection: anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        anchorSelection.lifetimeAttemptAnchorRawSha256,
    });
  return {
    ...installed,
    lifetimeTargetSelection,
    recoveryTarget,
    recoveryInventory,
    recoveryReplay,
    recoveryPlan,
    phaseOne,
    anchorRecord,
    anchorSelection,
    recoveryActorEpochSha256,
    recoveryAttempt,
    launchState,
  };
}

function createFirstRecoveryRecord(tuple, label) {
  return recoveryOwner.createCandidateContainmentRecoveryRecordV1({
    target: tuple.recoveryTarget,
    lifecycleInventoryObservation: tuple.recoveryInventory,
    previousRecoveryReplay: tuple.recoveryReplay,
    plan: tuple.recoveryPlan,
    lifetimeAnchorProjection: tuple.anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      tuple.anchorSelection.lifetimeAttemptAnchorRawSha256,
    attempt: tuple.recoveryAttempt,
    previousRecord: null,
    operationBytes: ownerFixtures.jsonLine(
      ownerFixtures.opaque(`${label}:recovery-record-operation`),
    ),
    evidenceBytes: ownerFixtures.jsonLine(tuple.recoveryInventory),
  });
}

function buildCloseDecisionTuple(
  owner,
  journal,
  location,
  { normalCloseDurable = false } = {},
) {
  const { target: independentlyDerivedTarget, projection } =
    ownerFixtures.independentlyDeriveRecoveryTargetFromFixtureArtifacts(
      journal,
    );
  const inventoryPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.targetGenesisInventory],
    ["targetSha256", projection.targetSha256],
    ["reportedRecoveryDirectoryPresent", true],
    ["reportedRecoveryDirectoryEntryCount", 0],
    ["reportedExistingLifetimeTargetHead", false],
  );
  const targetGenesisInventory = record(...Object.entries(inventoryPrefix), [
    "inventorySha256",
    semanticSha256(inventoryPrefix),
  ]);
  const eventPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.targetGenesisEvent],
    ["recoveryTargetProjection", projection],
    ["targetGenesisInventory", targetGenesisInventory],
    ["provedRebootTransitions", array()],
  );
  const event = record(...Object.entries(eventPrefix), [
    "eventSha256",
    semanticSha256(eventPrefix),
  ]);
  const genesisHead = ownerFixtures.recoveryExternalHead({
    targetSha256: projection.targetSha256,
    result: "NO_RECOVERY_ATTEMPT",
    recoveryActorEpochSha256: null,
    attemptDirectoryName: null,
    lifetimeAttemptAnchorRawSha256: null,
    latestRecoveryRecordSequence: null,
    latestRecoveryRecordRawSha256: ownerFixtures.ZERO_SHA256,
  });
  owner.append("GENERATION_RECOVERY_HEAD_DURABLE", {
    writerKind: "LIVE_BIRTH_GUARDIAN",
    writerActorEpochSha256: owner.identity.lifetimeEpochSha256,
    targetSha256: projection.targetSha256,
    operation: event,
    evidence: genesisHead,
  });
  let lifetimeTargetSelection =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: owner.replay,
      generationIdentitySha256: journal.generationIdentity.identitySha256,
    });
  let recoveryTarget = recoveryOwner.createCandidateContainmentRecoveryTargetV1(
    {
      generationManifest: artifact(journal.generationManifest),
      normalJournalBundles: journalArtifactList(journal),
      lifetimeTargetSelection,
    },
  );
  assert.equal(
    canonicalJson(recoveryTarget),
    canonicalJson(independentlyDerivedTarget),
  );
  let expectedExternalHead =
    lifetimeOwner.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  let normalCloseDurabilityReceipt = null;
  let recoveryReplay = recoveryOwner.replayCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    entries: array(),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
    currentLifetimeAnchorPredecessorExternalHead: null,
    normalCloseDurabilityReceipt,
  });

  if (normalCloseDurable) {
    const receipt = record(
      ["schema", ownerFixtures.FIXTURE_SCHEMAS.normalCloseReceipt],
      ["targetSha256", projection.targetSha256],
      ["sourceLocation", "active"],
      ["destinationLocation", "closed"],
      ["activeParentSynced", true],
      ["closedParentSynced", true],
      ["closedLocationReobserved", true],
    );
    owner.append("NORMAL_CLOSE_RECEIPT_DURABLE", {
      targetSha256: projection.targetSha256,
      evidence: receipt,
    });
    lifetimeTargetSelection =
      lifetimeOwner.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
        lifetimeReplay: owner.replay,
        generationIdentitySha256: journal.generationIdentity.identitySha256,
      });
    recoveryTarget = recoveryOwner.verifyCandidateContainmentRecoveryTargetV1({
      target: recoveryTarget,
      generationManifest: artifact(journal.generationManifest),
      normalJournalBundles: journalArtifactList(journal),
      lifetimeTargetSelection,
    });
    expectedExternalHead =
      lifetimeOwner.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
        lifetimeReplay: owner.replay,
        targetSha256: recoveryTarget.targetSha256,
      });
    normalCloseDurabilityReceipt =
      lifetimeOwner.selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1(
        {
          lifetimeReplay: owner.replay,
          targetSha256: recoveryTarget.targetSha256,
        },
      );
    recoveryReplay = recoveryOwner.replayCandidateContainmentRecoveryV1({
      target: recoveryTarget,
      entries: array(),
      expectedStateRootIdentitySha256: owner.root.identitySha256,
      expectedExternalHead,
      currentLifetimeAnchorProjection: null,
      currentLifetimeAttemptAnchorRawSha256: null,
      currentLifetimeAnchorPredecessorExternalHead: null,
      normalCloseDurabilityReceipt,
    });
  }

  const recoveryInventory =
    recoveryOwner.createCandidateContainmentRecoveryInventoryObservationV1({
      generationIdentitySha256: journal.generationIdentity.identitySha256,
      stagingPresent: location === "staging",
      activePresent: location === "active",
      closedPresent: location === "closed",
      recoveredPresent: location === "recovered",
      quarantinedPresent: location === "quarantined",
      unsafeEntriesPresent: false,
    });
  const context = owner.lifetimeContext;
  const recoveryPlan = recoveryOwner.planCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    lifecycleInventoryObservation: recoveryInventory,
    previousRecoveryReplay: recoveryReplay,
    normalCloseDurabilityReceipt,
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedCurrentBootIdSha256: context.bootIdSha256,
    expectedDelegatedRootIdentitySha256: context.delegatedRootIdentitySha256,
    expectedLifetimeCgroupIdentitySha256: context.lifetimeCgroupIdentitySha256,
    proposedActorKind: null,
    reportedCurrentBootIdSha256: context.bootIdSha256,
    reportedStateRootIdentitySha256: owner.root.identitySha256,
    reportedDelegatedRootIdentitySha256: context.delegatedRootIdentitySha256,
    reportedLifetimeCgroupIdentitySha256: context.lifetimeCgroupIdentitySha256,
    reportedCommandDescriptorHeld: false,
    reportedStatusDescriptorHeld: false,
    reportedSupervisorPidfdHeld: false,
    reportedDirectChildWaitAuthority: false,
    reportedCgroupInventorySafe: true,
    reportedControlCgroupPresent: false,
    reportedJobCgroupPresent: false,
    reportedStateFilesystemInterfaceAvailable: true,
    reportedRecoveryInterfaceAvailable: true,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
  });
  assert.equal(
    recoveryPlan.status,
    normalCloseDurable ? "CLOSED_LOCATION_OBSERVED" : "CLOSE_MOVE_REQUIRED",
  );
  return {
    projection,
    lifetimeTargetSelection,
    recoveryTarget,
    recoveryInventory,
    recoveryReplay,
    recoveryPlan,
    normalCloseDurabilityReceipt,
  };
}

function journalArtifactList(
  journal,
  count = journal.normalJournalBundles.length,
) {
  return array(...journal.normalJournalBundles.slice(0, count).map(artifact));
}

async function lifecycleParentToken(
  module,
  { label, role, entries, startSequence = 0 },
) {
  const root = heldDirectoryObservation();
  const lock = completeLock(module, { label, root, sequence: startSequence });
  const rootInventory = completeDirectoryInventory(module, {
    label,
    sequence: startSequence + 1,
    token: lock.receipt.inventorySet,
    role: "STATE_ROOT",
    parentRole: "STATE_ROOT",
    targetInode: "100",
    entries: ROOT_CHILDREN,
  });
  const rootChild = ROOT_CHILDREN.find((entry) => entry[1] === role);
  const lifecycle = completeDirectoryInventory(module, {
    label,
    sequence: startSequence + 2,
    token: rootInventory.receipt.inventorySet,
    role,
    parentRole: "STATE_ROOT",
    name: rootChild[0],
    targetInode: rootChild[2],
    entries,
    returnedDirectoryFd: startSequence + 60,
  });
  return {
    root,
    lock,
    rootInventory,
    lifecycle,
    token: lifecycle.receipt.inventorySet,
  };
}

async function normalJournalToken(
  module,
  { label, journal, bundleCount, extraEntries = [] },
) {
  const generationName = journal.generationIdentity.identitySha256;
  const active = await lifecycleParentToken(module, {
    label,
    role: "ACTIVE",
    entries: array(array(generationName, "GENERATION", "500")),
  });
  const generation = completeDirectoryInventory(module, {
    label,
    sequence: 3,
    token: active.token,
    role: "GENERATION",
    parentRole: "ACTIVE",
    name: generationName,
    targetInode: "500",
    entries: array(
      record(
        ["kind", "REGULAR"],
        ["role", "GENERATION"],
        ["name", "generation.jsonl"],
        ["inode", "503"],
        ["byteLength", String(journal.generationManifest.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      ),
      array("normal", "NORMAL_JOURNAL", "501"),
      array("recovery", "RECOVERY_JOURNAL", "502"),
    ),
    returnedDirectoryFd: 63,
  });
  const finalEntries = journal.normalJournalBundles
    .slice(0, bundleCount)
    .map((bundle, index) =>
      record(
        ["kind", "REGULAR"],
        ["role", "NORMAL_JOURNAL"],
        ["name", bundle.name],
        ["inode", String(600 + index)],
        ["byteLength", String(bundle.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      ),
    );
  const orderedEntries = [...finalEntries, ...extraEntries].sort(
    (left, right) =>
      Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
  );
  const normal = completeDirectoryInventory(module, {
    label,
    sequence: 4,
    token: generation.receipt.inventorySet,
    role: "NORMAL_JOURNAL",
    parentRole: "GENERATION",
    name: "normal",
    targetInode: "501",
    entries: array(...orderedEntries),
    returnedDirectoryFd: 64,
  });
  return {
    root: active.root,
    active,
    generation,
    normal,
    token: normal.receipt.inventorySet,
  };
}

async function recoveryAttemptRecordToken(
  module,
  { label, journal, recoveryAttempt, recoveryRecord },
) {
  const generationName = journal.generationIdentity.identitySha256;
  const active = await lifecycleParentToken(module, {
    label,
    role: "ACTIVE",
    entries: array(array(generationName, "GENERATION", "500")),
  });
  const generation = completeDirectoryInventory(module, {
    label,
    sequence: 3,
    token: active.token,
    role: "GENERATION",
    parentRole: "ACTIVE",
    name: generationName,
    targetInode: "500",
    entries: array(
      record(
        ["kind", "REGULAR"],
        ["role", "GENERATION"],
        ["name", "generation.jsonl"],
        ["inode", "503"],
        ["byteLength", String(journal.generationManifest.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      ),
      array("normal", "NORMAL_JOURNAL", "501"),
      array("recovery", "RECOVERY_JOURNAL", "502"),
    ),
    returnedDirectoryFd: 63,
  });
  const recoveryJournal = completeDirectoryInventory(module, {
    label,
    sequence: 4,
    token: generation.receipt.inventorySet,
    role: "RECOVERY_JOURNAL",
    parentRole: "GENERATION",
    name: "recovery",
    targetInode: "502",
    entries: array(
      array(recoveryAttempt.attemptDirectoryName, "RECOVERY_ATTEMPT", "504"),
    ),
    returnedDirectoryFd: 64,
  });
  const attemptDirectory = completeDirectoryInventory(module, {
    label,
    sequence: 5,
    token: recoveryJournal.receipt.inventorySet,
    role: "RECOVERY_ATTEMPT",
    parentRole: "RECOVERY_JOURNAL",
    name: recoveryAttempt.attemptDirectoryName,
    targetInode: "504",
    entries: array(),
    returnedDirectoryFd: 65,
  });
  const absentRecord = completeRegularInventory(module, {
    label,
    sequence: 6,
    token: attemptDirectory.receipt.inventorySet,
    role: "RECOVERY_ATTEMPT",
    name: recoveryRecord.name,
  });
  return {
    root: active.root,
    active,
    generation,
    recoveryJournal,
    attemptDirectory,
    absentRecord,
    token: absentRecord.receipt.inventorySet,
    sequence: 7,
  };
}

function autoInput({
  label,
  managerActorEpochSha256,
  sequence,
  token,
  lifetimeReplayArguments: replayArguments,
  generationManifest = null,
  normalJournalBundles = null,
  recoveryTarget = null,
  recoveryInventory = null,
  recoveryReplay = null,
  recoveryPlan = null,
  recoveryAttempt = null,
  recoveryRecord = null,
  artifactBytes = null,
  unresolvedReceipt = null,
}) {
  return plannerInput({
    kind: "AUTO",
    managerActorEpochSha256:
      managerActorEpochSha256 ?? digest(`${label}:manager-actor-epoch`),
    requestSequence: sequence,
    inventorySetSha256: token.inventorySetSha256,
    stateRootObservation: null,
    currentInventorySet: token,
    unresolvedReceipt,
    generationManifest,
    normalJournalBundles,
    lifetimeReplayArguments: replayArguments,
    recoveryTarget,
    recoveryInventory,
    recoveryReplay,
    recoveryPlan,
    recoveryAttempt,
    recoveryRecord,
    artifactBytes,
    inventoryDirectoryRole: null,
    directoryRoleA: null,
    directoryRoleB: null,
    nameA: null,
    nameB: null,
    expectedOutcome: null,
  });
}

function completeMutationResult(request, overrides = {}) {
  const sequence = OPERATION_STEP_SEQUENCES.find(
    ([operation]) => operation === request.operation,
  )[1];
  return executorResult(request, {
    status: "COMPLETE",
    effectClass: "COMPLETE",
    lastCompletedStep: OPERATION_STEPS.find(
      ([, value]) => value === sequence.at(-1),
    )[0],
    failedStep: "NONE",
    completedStepCount: sequence.length,
    bytesConsumed:
      request.operation === "PERSIST_NOREPLACE" ? request.inputByteLength : 0,
    observations: array(),
    outputBytes: null,
    returnedDirectoryFd: -1,
    ...overrides,
  });
}

async function rootAndLifecycleToken(module, { label, lifecycleEntries = [] }) {
  const root = heldDirectoryObservation();
  const lock = completeLock(module, { label, root });
  const rootInventory = completeDirectoryInventory(module, {
    label,
    sequence: 1,
    token: lock.receipt.inventorySet,
    role: "STATE_ROOT",
    parentRole: "STATE_ROOT",
    targetInode: "100",
    entries: ROOT_CHILDREN,
  });
  const lifetimes = completeDirectoryInventory(module, {
    label,
    sequence: 2,
    token: rootInventory.receipt.inventorySet,
    role: "LIFETIMES",
    parentRole: "STATE_ROOT",
    name: "lifetimes",
    targetInode: "101",
    entries: lifecycleEntries,
    returnedDirectoryFd: 57,
  });
  return {
    root,
    lock,
    rootInventory,
    lifetimes,
    token: lifetimes.receipt.inventorySet,
  };
}

async function observedLifetimeOwnerToken(module, { label, owner }) {
  const tree = await rootAndLifecycleToken(module, {
    label,
    lifecycleEntries: array(
      array(owner.identity.identitySha256, "LIFETIME_SEGMENT", "201"),
    ),
  });
  const recordEntries = owner.records.map((lifetimeRecord, index) =>
    record(
      ["kind", "REGULAR"],
      ["role", "NONE"],
      ["name", lifetimeRecord.name],
      ["inode", String(300 + index)],
      ["byteLength", String(lifetimeRecord.bytes.length)],
      ["linkCount", "1"],
      ["mode", 0o100_600],
    ),
  );
  const segment = completeDirectoryInventory(module, {
    label,
    sequence: 3,
    token: tree.token,
    role: "LIFETIME_SEGMENT",
    parentRole: "LIFETIMES",
    name: owner.identity.identitySha256,
    targetInode: "201",
    entries: array(...recordEntries),
    returnedDirectoryFd: 65,
  });
  let token = segment.receipt.inventorySet;
  let sequence = 4;
  for (const [index, lifetimeRecord] of owner.records.entries()) {
    const observed = completeRegularInventory(module, {
      label,
      sequence,
      token,
      role: "LIFETIME_SEGMENT",
      name: lifetimeRecord.name,
      bytes: lifetimeRecord.bytes,
      inode: String(300 + index),
    });
    token = observed.receipt.inventorySet;
    sequence += 1;
  }
  return { ...tree, segment, token, sequence };
}

const SOURCE_PRESENT_TEST_OPTIONS = Object.freeze({ skip: statefs === null });
const CANDIDATE_TEST_OPTIONS = Object.freeze({
  skip:
    statefs === null
      ? "candidate source absent"
      : statefs.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256 ===
          EXPECTED_REQUIREMENTS_SHA256
        ? false
        : "R13 candidate contract correction pending",
});

test("independent requirements golden is literal, ordered, and authority-null", () => {
  assert.equal(
    semanticSha256(REQUIREMENTS_GOLDEN),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assertExactOwnFieldOrder(
    REQUIREMENTS_GOLDEN,
    fields(`schema version predecessors importInventory schemas limits directoryRoles
      rootDirectoryNames nameGrammars plannerKinds operations inventoryKinds
      heldDirectoryObservationFields inventoryEntryFields inventoryObservationFields
      inventorySetFields directoryHandlePreimageFields plannerInputFields ownerContextFields
      planFields requestFields nativeObservationFields executorResultFields receiptFields
      operationSteps operationStepSequences executorResultStatuses receiptStatuses
      effectClasses outcomes retryDispositions errorPrecedence fdRules metadataRules
      syscallRules orderingRules privateFilesystemReportFields privateFilesystemProfile
      authority physicalFacts nonclaims`),
    "requirements golden",
  );
  assertNullFrozenTree(REQUIREMENTS_GOLDEN, "requirements golden");
  assert.equal(
    Object.values(AUTHORITY).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(PHYSICAL_FACTS).every((value) => value === null),
    true,
  );
});

test("all eight operations and every inventory variant have one exact dense sequence", () => {
  assert.deepEqual(
    OPERATION_GOLDENS.map((golden) => golden.operation),
    OPERATIONS,
  );
  assert.deepEqual(
    OPERATION_GOLDENS.map((golden) => golden.sequence),
    array(
      OPERATION_STEP_SEQUENCES[0][1],
      OPERATION_STEP_SEQUENCES[1][1],
      OPERATION_STEP_SEQUENCES[5][1],
      OPERATION_STEP_SEQUENCES[6][1],
      OPERATION_STEP_SEQUENCES[7][1],
      OPERATION_STEP_SEQUENCES[8][1],
      OPERATION_STEP_SEQUENCES[9][1],
      OPERATION_STEP_SEQUENCES[10][1],
    ),
  );
  assert.deepEqual(
    OPERATION_STEP_SEQUENCES.slice(1, 5).map(([kind]) => kind),
    array(
      "INVENTORY/DIRECTORY/ROOT",
      "INVENTORY/DIRECTORY/CHILD",
      "INVENTORY/REGULAR_FILE/PRESENT",
      "INVENTORY/REGULAR_FILE/ABSENT",
    ),
  );
});

test("digest projections omit capability and claim fields exactly", () => {
  assert.deepEqual(
    DIGEST_PROJECTION_FIELDS.inventory,
    INVENTORY_OBSERVATION_FIELDS.slice(0, 8).concat(
      array("contentByteLength", "contentRawSha256"),
    ),
  );
  assert.equal(DIGEST_PROJECTION_FIELDS.receipt.includes("request"), false);
  assert.equal(
    DIGEST_PROJECTION_FIELDS.receipt.includes("previousInventorySet"),
    false,
  );
  assert.equal(
    DIGEST_PROJECTION_FIELDS.receipt.includes("inventorySet"),
    false,
  );
  for (const claim of ["authority", "physicalFacts", "nonclaims"]) {
    assert.equal(DIGEST_PROJECTION_FIELDS.inventory.includes(claim), false);
    assert.equal(DIGEST_PROJECTION_FIELDS.ownerContext.includes(claim), false);
    assert.equal(DIGEST_PROJECTION_FIELDS.receipt.includes(claim), false);
  }
});

test("missing-source attribution rejects wrong code, URL, and Node-20 fallback text", () => {
  assert.throws(() => assertExactMissingCandidate(null));
  assert.throws(() =>
    assertExactMissingCandidate({
      code: "ENOENT",
      url: SOURCE_URL.href,
      message: MISSING_CANDIDATE_MESSAGE,
    }),
  );
  assert.throws(() =>
    assertExactMissingCandidate({
      code: "ERR_MODULE_NOT_FOUND",
      url: "file:///wrong/candidate.mjs",
      message: MISSING_CANDIDATE_MESSAGE,
    }),
  );
  assert.throws(() =>
    assertExactMissingCandidate({
      code: "ERR_MODULE_NOT_FOUND",
      url: null,
      message: MISSING_CANDIDATE_MESSAGE,
    }),
  );
  assert.throws(() =>
    assertExactMissingCandidate({
      code: "ERR_MODULE_NOT_FOUND",
      message: "Cannot find package 'not-the-statefs-candidate'",
    }),
  );
  assert.equal(
    assertExactMissingCandidate({
      code: "ERR_MODULE_NOT_FOUND",
      url: SOURCE_URL.href,
      message: "message is non-authoritative when the exact URL exists",
    }).url,
    SOURCE_URL.href,
  );
  assert.equal(
    assertExactMissingCandidate({
      code: "ERR_MODULE_NOT_FOUND",
      message: MISSING_CANDIDATE_MESSAGE,
    }).message,
    MISSING_CANDIDATE_MESSAGE,
  );
});

test("closed source audit rejects ambient, computed, constructor, dynamic-import, and top-level effect escapes", () => {
  for (const hostile of [
    "globalThis.process.cwd();",
    'globalThis["pro" + "cess"].cwd();',
    'Object["con" + "structor"]("return process")();',
    "({}).constructor.constructor('return process')();",
    'const k = ["con", "structor"].join(""); function hidden() { return [][k][k]("return " + "pro" + "cess")(); }',
    'function hidden() { const { constructor: Fn } = Object; const p = Fn("return pro" + "cess")(); return p.getBuiltinModule("node" + ":" + "fs"); }',
    "const poisoned = (Object.freeze = () => null);",
    "const invoked = (() => null)();",
    "function poison() { return Object.assign(Object, { freeze: () => null }); } const invokedPoison = poison();",
    "const poisonedMath = deepFreeze(Math);",
    "function Map() { Math.poison = 1; } const shadowedMap = new Map();",
    "function hidden() { const bytes = new Uint8Array(1); crypto.getRandomValues(bytes); }",
    'function hidden() { new BroadcastChannel("x").postMessage("y"); }',
    "function hidden(value) { switch (value) { case 0: let crypto; break; default: break; } const bytes = new Uint8Array(1); crypto.getRandomValues(bytes); }",
    "function hidden() { Object.freeze = () => null; }",
    "function hidden() { sha256.poison = 1; }",
    "function hidden() { const alias = sha256; alias.poison = 1; }",
    "const box = { imported: sha256 }; function hidden() { box.imported.poison = 1; }",
    "function hidden() { Object.freeze(sha256); }",
    "function hidden() { deepFreeze(CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1); }",
    "function hidden() { const values = []; values.push(sha256); deepFreeze(values); }",
    'function hidden() { deepFreeze(nullRecord([["x", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1]])); }',
    'function hidden(input) { input.writeFileSync("/tmp/statefs-purity", "x"); }',
    "function hidden(input) { function local(value) { return value; } return input.map(local); }",
    "function hidden(input) { const alias = input; return alias.get(); }",
    "function hidden(input) { const holder = { input }; function local(value) { return value; } return holder.input.map(local); }",
    "function hidden(callback) { callback(); }",
    "function hidden(callback) { return [1].map(callback); }",
    'function hidden(callback) { return "x".replace("x", callback); }',
    "function hidden() { return process.env; }",
    "function hidden() { return import('node:fs'); }",
    "const process = { cwd() {} };",
    "await Promise.resolve();",
  ]) {
    assert.throws(
      () => auditAuthorityNegativeControl(hostile),
      undefined,
      hostile,
    );
  }
  assert.doesNotThrow(() =>
    auditAuthorityNegativeControl(
      "function pureLocal(value) { return Object.freeze([value]); }",
    ),
  );
  assert.doesNotThrow(() =>
    auditAuthorityNegativeControl("const safe = deepFreeze([]);"),
  );
  assert.doesNotThrow(() =>
    auditAuthorityNegativeControl(
      "const privateMap = new WeakMap(); const privateSet = new WeakSet();",
    ),
  );
  assert.doesNotThrow(() =>
    auditAuthorityNegativeControl(
      "function pureLocalMutation() { const entries = []; entries[0] = 1; return entries; }",
    ),
  );
  assert.doesNotThrow(() =>
    auditAuthorityNegativeControl(
      "function privateBrandMutation(value) { const map = new WeakMap(); const set = new WeakSet(); map.set(value, true); set.add(value); return map.has(value) && set.has(value); }",
    ),
  );
  assert.doesNotThrow(() =>
    auditAuthorityNegativeControl(
      "function privateRecordMutation() { const value = Object.create(null); value.safe = true; return value; }",
    ),
  );
});

test("recovery-only owner fixture composes the exact same-origin anchor, plan, and attempt", () => {
  for (const launchState of ["NONE", "INTENT", "ADOPTED"]) {
    const label = `recovery-only-owner-self-check-${launchState}`;
    const root = heldDirectoryObservation();
    const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
    const journal = ownerFixtures.createJournalStack(label, 5);
    const owner = createAdoptedLifetimeOwner({
      label,
      root,
      managerActorEpochSha256,
      journal,
    });
    const tuple = buildRecoveryOnlyAttemptTuple(owner, journal, {
      launchState,
    });
    assert.equal(tuple.phaseOne.status, "RECOVERY_ANCHOR_REQUIRED");
    assert.equal(tuple.recoveryPlan.status, "RECOVERY_PLAN_READY");
    assert.equal(
      tuple.recoveryPlan.requiredActorKind,
      "RECOVERY_ONLY_GUARDIAN",
    );
    assert.equal(tuple.recoveryAttempt.actorKind, "RECOVERY_ONLY_GUARDIAN");
    assert.equal(
      lifetimeOwner.assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
        {
          lifetimeAnchorProjection:
            tuple.anchorSelection.lifetimeAnchorProjection,
          lifetimeAttemptAnchorRawSha256:
            tuple.anchorSelection.lifetimeAttemptAnchorRawSha256,
          targetSha256: tuple.recoveryTarget.targetSha256,
          recoveryActorEpochSha256: tuple.recoveryActorEpochSha256,
        },
      ),
      true,
    );
    const verifiedAttempt =
      recoveryOwner.verifyCandidateContainmentRecoveryAttemptV1({
        attempt: tuple.recoveryAttempt,
        target: tuple.recoveryTarget,
        lifecycleInventoryObservation: tuple.recoveryInventory,
        previousRecoveryReplay: tuple.recoveryReplay,
        plan: tuple.recoveryPlan,
        lifetimeAnchorProjection:
          tuple.anchorSelection.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          tuple.anchorSelection.lifetimeAttemptAnchorRawSha256,
      });
    assert.deepEqual(verifiedAttempt, tuple.recoveryAttempt);
  }
});

test("owner fixtures expose valid normal handoff, recovery replan, recovery record, and terminal prefixes", () => {
  const root = heldDirectoryObservation();

  const normalLabel = "normal-handoff-owner-self-check";
  const normal = createNormalHandoffLifetimeOwner({
    label: normalLabel,
    root,
    managerActorEpochSha256: digest(`${normalLabel}:manager-actor-epoch`),
  });
  assert.equal(normal.replay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
  assert.equal(
    normal.records.at(-1).recordType,
    "GUARDIAN_LAUNCH_INTENT_DURABLE",
  );

  const replanLabel = "recovery-replan-owner-self-check";
  const replanJournal = ownerFixtures.createJournalStack(replanLabel, 5);
  const replanOwner = createAdoptedLifetimeOwner({
    label: replanLabel,
    root,
    managerActorEpochSha256: digest(`${replanLabel}:manager-actor-epoch`),
    journal: replanJournal,
  });
  const replan = buildRecoveryReplanTuple(replanOwner, replanJournal);
  assert.equal(replan.recoveryPlan.status, "RECOVERY_ANCHOR_REQUIRED");
  assert.equal(replan.recoveryPlan.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");
  assert.equal(replan.recoveryPlan.recoveryContext, null);
  assert.equal(replan.recoveryPlan.currentLifetimeAnchorMatched, false);
  assert.equal(replan.recoveryPlan.disposition, null);
  assert.deepEqual(replan.recoveryPlan.nextPermittedRecordTypes, []);
  assert.deepEqual(replan.recoveryPlan.states, []);
  assert.equal(replan.recoveryPlan.recordCount, 0);
  assert.equal(replan.recoveryPlan.terminal, false);
  assert.equal(
    selectRecoveryOwnerAssociation({
      target: replan.recoveryTarget,
      lifecycleInventoryObservation: replan.recoveryInventory,
      previousRecoveryReplay: replan.recoveryReplay,
      plan: replan.recoveryPlan,
      attempt: null,
    }),
    null,
  );
  const unbrandedReplan = record(...Object.entries(replan.recoveryPlan));
  assert.deepEqual(unbrandedReplan, replan.recoveryPlan);
  assert.notEqual(unbrandedReplan, replan.recoveryPlan);
  assert.throws(
    () =>
      selectRecoveryOwnerAssociation({
        target: replan.recoveryTarget,
        lifecycleInventoryObservation: replan.recoveryInventory,
        previousRecoveryReplay: replan.recoveryReplay,
        plan: unbrandedReplan,
        attempt: null,
      }),
    TypeError,
  );
  const correctionReceipt =
    STATEFS_NULL_CONTEXT_CORRECTION_IDENTITY.assertInverseReceipt(
      STATEFS_NULL_CONTEXT_CORRECTION_IDENTITY.inverseReceipt,
    );
  assert.equal(
    correctionReceipt.schema,
    "oxigraph.test.candidate-containment-guardian-statefs-v1-null-context-correction-inverse-receipt/v1",
  );
  assert.equal(correctionReceipt.correctionIdentityBlockRemovals, 1);
  assert.equal(
    correctionReceipt.recoveryOwnerAssociationAndNullContextBlockRemovals,
    1,
  );
  assert.equal(correctionReceipt.anchorRequiredFixtureProofRemovals, 1);
  assert.equal(correctionReceipt.selectedR5SourceInputRestorations, 1);
  assert.equal(
    correctionReceipt.selectedR5Commit,
    "024eed9233b74d4f8b7e90504ce7c1f80106d1dc",
  );
  assert.equal(
    correctionReceipt.selectedR5IntegrationCommit,
    "881482a6c78b4281128f8cf2dfcdf0e315c519cb",
  );
  assert.equal(correctionReceipt.selectedR5EvaluatorBytes, 300_770);
  assert.equal(correctionReceipt.selectedR5EvaluatorLines, 8_899);
  assert.equal(
    correctionReceipt.selectedR5EvaluatorSha256,
    "1c9b2baae1c7f91e5872056b050f2ab5fe2cf1e7f0b020e63d4a0066ff804302",
  );
  assert.equal(
    correctionReceipt.selectedR5EvaluatorGitBlob,
    "075426aa69ee708ab0b667bb5eaeca1478d17f06",
  );
  assert.equal(correctionReceipt.selectedR5EvaluatorTestCount, 24);

  const recordLabel = "recovery-record-owner-self-check";
  const recordJournal = ownerFixtures.createJournalStack(recordLabel, 5);
  const recordOwner = createAdoptedLifetimeOwner({
    label: recordLabel,
    root,
    managerActorEpochSha256: digest(`${recordLabel}:manager-actor-epoch`),
    journal: recordJournal,
  });
  const recordTuple = buildRecoveryOnlyAttemptTuple(
    recordOwner,
    recordJournal,
    {
      launchState: "ADOPTED",
    },
  );
  const recoveryRecord = createFirstRecoveryRecord(recordTuple, recordLabel);
  assert.equal(recoveryRecord.recordType, "RECOVERY_ATTEMPT_DURABLE");
  assert.equal(
    recoveryRecord.targetSha256,
    recordTuple.recoveryTarget.targetSha256,
  );
  assert.deepEqual(
    recoveryOwner.verifyCandidateContainmentRecoveryRecordV1(
      artifact(recoveryRecord),
    ),
    recoveryRecord,
  );

  const terminalLabel = "terminal-owner-self-check";
  const terminalJournal = ownerFixtures.createJournalStack(terminalLabel, 0);
  const terminal = createTerminalLifetimeOwner({
    label: terminalLabel,
    root,
    managerActorEpochSha256: digest(`${terminalLabel}:manager-actor-epoch`),
    journal: terminalJournal,
  });
  assert.equal(terminal.replay.status, "COMPLETE_LIFETIME_CHAIN_REPLAYED");
  assert.equal(terminal.records.at(-1).recordType, "LIFETIME_CLOSED_DURABLE");
});

test(
  "candidate has exactly seven exports and the independent requirements value",
  SOURCE_PRESENT_TEST_OPTIONS,
  () => {
    assert.deepEqual(Object.keys(statefs).sort(), [...EXPECTED_EXPORTS].sort());
    assert.deepEqual(
      statefs.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS,
      REQUIREMENTS_GOLDEN,
    );
    assert.equal(
      statefs.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256,
      EXPECTED_REQUIREMENTS_SHA256,
    );
    assertNullFrozenTree(
      statefs.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS,
      "candidate requirements",
    );
  },
);

test(
  "lock planning binds a frozen request and consumes plan, request, and result once",
  CANDIDATE_TEST_OPTIONS,
  () => {
    const root = heldDirectoryObservation();
    const managerActorEpochSha256 = digest("manager-actor-epoch");
    const plan = statefs.planCandidateContainmentGuardianStatefsOperationV1(
      plannerInput({ managerActorEpochSha256, stateRootObservation: root }),
    );
    const expectedRequest = assertFullRequestPlanGolden(plan, {
      ownerContext: {},
      request: {
        managerActorEpochSha256,
        requestSequence: 0,
        operation: "LOCK_EX_NB",
        writerKind: "SERVICE_MANAGER",
        directoryRoleA: "STATE_ROOT",
        directoryIdentitySha256A: root.identitySha256,
        directoryHandleSha256A: directoryHandleSha256({
          managerActorEpochSha256,
          role: "STATE_ROOT",
          identitySha256: root.identitySha256,
          parentDirectoryHandleSha256: null,
          name: null,
        }),
        expectedOutcome: "LOCK_HELD",
      },
    });
    assertExactOwnFieldOrder(plan, PLAN_FIELDS, "lock plan");
    assertNullFrozenTree(plan, "lock plan");
    assert.equal(plan.planKind, "REQUEST");
    assert.equal(plan.managerDisposition, "STATEFS_REQUEST");
    assert.equal(plan.operation, "LOCK_EX_NB");
    assert.equal(plan.requestSha256, plan.request.requestSha256);
    assert.equal(plan.inventorySet, null);
    assert.equal(plan.inventorySetSha256, null);

    expectCode(
      () =>
        statefs.assertCandidateContainmentGuardianStatefsPlanV1({ ...plan }),
      "STATEFS_BINDING",
    );
    const ownerContext =
      statefs.assertCandidateContainmentGuardianStatefsPlanV1(plan);
    assert.equal(ownerContext, plan.ownerContext);
    assertExactOwnFieldOrder(
      ownerContext,
      OWNER_CONTEXT_FIELDS,
      "owner context",
    );
    expectCode(
      () => statefs.assertCandidateContainmentGuardianStatefsPlanV1(plan),
      "STATEFS_BINDING",
    );

    const request = plan.request;
    assertExactOwnFieldOrder(request, REQUEST_FIELDS, "lock request");
    assert.equal(request.operation, "LOCK_EX_NB");
    assert.equal(request.executionDisposition, "EXECUTE");
    assert.equal(request.inventoryKind, "NONE");
    assert.equal(request.directoryRoleA, "STATE_ROOT");
    assert.equal(request.directoryRoleB, null);
    assert.equal(request.expectedOutcome, "LOCK_HELD");
    expectCode(
      () =>
        statefs.assertCandidateContainmentGuardianStatefsRequestV1({
          ...request,
        }),
      "STATEFS_BINDING",
    );
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsRequestV1(request),
      true,
    );
    expectCode(
      () => statefs.assertCandidateContainmentGuardianStatefsRequestV1(request),
      "STATEFS_BINDING",
    );

    const result = executorResult(request);
    const receipt = statefs.verifyCandidateContainmentGuardianStatefsResultV1({
      request,
      executorResult: result,
    });
    assertExactOwnFieldOrder(receipt, RECEIPT_FIELDS, "lock receipt");
    assertNullFrozenTree(receipt, "lock receipt");
    assert.equal(receipt.request, request);
    assert.equal(receipt.previousInventorySet, null);
    assert.equal(receipt.previousInventorySetSha256, null);
    assert.equal(receipt.status, "COMPLETE");
    assert.equal(receipt.effectClass, "COMPLETE");
    assert.equal(receipt.outcome, "LOCK_HELD");
    assert.equal(receipt.retryDisposition, "NO_RETRY");
    assert.deepEqual(receipt.inventories, []);
    assert.equal(receipt.inventorySet.revision, 0);
    assert.equal(receipt.inventorySet.scopeCount, 0);
    assert.equal(
      receipt.inventorySet.inventorySetSha256,
      semanticSha256(array()),
    );
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsReceiptV1(receipt),
      true,
    );
    expectCode(
      () =>
        statefs.verifyCandidateContainmentGuardianStatefsResultV1({
          request,
          executorResult: executorResult(request),
        }),
      "STATEFS_BINDING",
    );
    expectCode(
      () =>
        statefs.assertCandidateContainmentGuardianStatefsReceiptV1({
          ...receipt,
        }),
      "STATEFS_BINDING",
    );
    assertExactDigests(plan, receipt);
    TOKEN_EXPECTATIONS.set(receipt.inventorySet, {
      scopes: new Map(),
      projection: array(),
    });
    assertFullReceiptGolden(receipt, result, expectedRequest, {
      outcome: "LOCK_HELD",
      retryDisposition: "NO_RETRY",
    });
  },
);

test(
  "root, nested-directory, regular-file, and release requests advance exact branded inventory tokens",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const module = await freshStatefs("inventory-release");
    const label = "inventory-release";
    const root = heldDirectoryObservation();
    const lock = completeLock(module, { label, root });
    const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
    const inventoryOwner = createLifetimeOwner({
      label,
      root,
      managerActorEpochSha256,
    });
    const inventoryRecord = inventoryOwner.append(
      "NORMAL_LIFETIME_EPOCH_CONSUMED",
    );
    assert.equal(
      lock.receipt.inventorySet.inventorySetSha256,
      semanticSha256(array()),
    );

    const rootInventory = completeDirectoryInventory(module, {
      label,
      sequence: 1,
      token: lock.receipt.inventorySet,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
      targetInode: "100",
      entries: ROOT_CHILDREN,
    });
    assert.equal(rootInventory.plan.request.operation, "INVENTORY");
    assert.equal(rootInventory.plan.request.inventoryKind, "DIRECTORY");
    assert.equal(rootInventory.receipt.outcome, "INVENTORY_OBSERVED");
    assert.equal(rootInventory.receipt.inventories.length, 1);
    const rootObservation = rootInventory.receipt.inventories[0];
    assert.equal(rootObservation.directory, root);
    assert.deepEqual(
      rootObservation.entries.map((entry) => entry.name),
      array(
        "active",
        "closed",
        "lifetimes",
        "quarantined",
        "recovered",
        "staging",
      ),
    );
    assert.equal(rootObservation.entryCount, 6);
    assert.equal(rootObservation.inventoryKind, "DIRECTORY");
    const rootHandleSha256 = directoryHandleSha256({
      managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
      role: "STATE_ROOT",
      identitySha256: root.identitySha256,
      parentDirectoryHandleSha256: null,
      name: null,
    });
    assert.equal(
      rootInventory.plan.request.directoryHandleSha256A,
      rootHandleSha256,
    );
    assert.equal(rootObservation.directoryHandleSha256, rootHandleSha256);
    const rootRequestGolden = assertFullRequestPlanGolden(rootInventory.plan, {
      ownerContext: {},
      request: {
        token: lock.receipt.inventorySet,
        managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
        requestSequence: 1,
        operation: "INVENTORY",
        writerKind: "SERVICE_MANAGER",
        inventoryKind: "DIRECTORY",
        inventoryDirectoryRole: "STATE_ROOT",
        directoryRoleA: "STATE_ROOT",
        directoryIdentitySha256A: root.identitySha256,
        directoryHandleSha256A: rootHandleSha256,
        expectedOutcome: "INVENTORY_OBSERVED",
      },
    });
    assertFullReceiptGolden(
      rootInventory.receipt,
      rootInventory.result,
      rootRequestGolden,
      { outcome: "INVENTORY_OBSERVED", retryDisposition: "NO_RETRY" },
    );
    assertExactDigests(rootInventory.plan, rootInventory.receipt);

    const lifetimes = completeDirectoryInventory(module, {
      label,
      sequence: 2,
      token: rootInventory.receipt.inventorySet,
      role: "LIFETIMES",
      parentRole: "STATE_ROOT",
      name: "lifetimes",
      targetInode: "101",
      entries: array(
        array(
          inventoryOwner.identity.identitySha256,
          "LIFETIME_SEGMENT",
          "201",
        ),
      ),
      returnedDirectoryFd: 57,
    });
    assert.equal(lifetimes.receipt.inventories[0].directory.role, "LIFETIMES");
    assert.equal(lifetimes.receipt.inventories[0].directory.closeOnExec, true);
    assert.equal(lifetimes.receipt.inventorySet.revision, 2);
    assert.equal(
      lifetimes.receipt.inventories[0].directoryHandleSha256,
      directoryHandleSha256({
        managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
        role: "LIFETIMES",
        identitySha256:
          lifetimes.receipt.inventories[0].directory.identitySha256,
        parentDirectoryHandleSha256: rootHandleSha256,
        name: "lifetimes",
      }),
    );
    const lifetimesHandle = directoryHandleSha256({
      managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
      role: "LIFETIMES",
      identitySha256: lifetimes.receipt.inventories[0].directory.identitySha256,
      parentDirectoryHandleSha256: rootHandleSha256,
      name: "lifetimes",
    });
    const lifetimesRequestGolden = assertFullRequestPlanGolden(lifetimes.plan, {
      ownerContext: {},
      request: {
        token: rootInventory.receipt.inventorySet,
        managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
        requestSequence: 2,
        operation: "INVENTORY",
        writerKind: "SERVICE_MANAGER",
        inventoryKind: "DIRECTORY",
        inventoryDirectoryRole: "LIFETIMES",
        directoryRoleA: "STATE_ROOT",
        directoryIdentitySha256A: root.identitySha256,
        directoryHandleSha256A: rootHandleSha256,
        nameA: "lifetimes",
        expectedOutcome: "INVENTORY_OBSERVED",
      },
    });
    assertFullReceiptGolden(
      lifetimes.receipt,
      lifetimes.result,
      lifetimesRequestGolden,
      { outcome: "INVENTORY_OBSERVED", retryDisposition: "NO_RETRY" },
    );
    assertExactDigests(lifetimes.plan, lifetimes.receipt);

    const segment = completeDirectoryInventory(module, {
      label,
      sequence: 3,
      token: lifetimes.receipt.inventorySet,
      role: "LIFETIME_SEGMENT",
      parentRole: "LIFETIMES",
      name: inventoryOwner.identity.identitySha256,
      targetInode: "201",
      entries: array(
        record(
          ["kind", "REGULAR"],
          ["role", "NONE"],
          ["name", inventoryRecord.name],
          ["inode", "301"],
          ["byteLength", String(inventoryRecord.bytes.length)],
          ["linkCount", "1"],
          ["mode", 0o100_600],
        ),
      ),
      returnedDirectoryFd: 58,
    });
    const segmentHandle = segment.receipt.inventories[0].directoryHandleSha256;
    const segmentRequestGolden = assertFullRequestPlanGolden(segment.plan, {
      ownerContext: {},
      request: {
        token: lifetimes.receipt.inventorySet,
        managerActorEpochSha256,
        requestSequence: 3,
        operation: "INVENTORY",
        writerKind: "SERVICE_MANAGER",
        inventoryKind: "DIRECTORY",
        inventoryDirectoryRole: "LIFETIME_SEGMENT",
        directoryRoleA: "LIFETIMES",
        directoryIdentitySha256A:
          lifetimes.receipt.inventories[0].directory.identitySha256,
        directoryHandleSha256A: lifetimesHandle,
        nameA: inventoryOwner.identity.identitySha256,
        expectedOutcome: "INVENTORY_OBSERVED",
      },
    });
    assertFullReceiptGolden(
      segment.receipt,
      segment.result,
      segmentRequestGolden,
      { outcome: "INVENTORY_OBSERVED", retryDisposition: "NO_RETRY" },
    );

    const present = completeRegularInventory(module, {
      label,
      sequence: 4,
      token: segment.receipt.inventorySet,
      role: "LIFETIME_SEGMENT",
      name: inventoryRecord.name,
      bytes: inventoryRecord.bytes,
      inode: "301",
    });
    assert.equal(present.receipt.inventories[0].inventoryKind, "REGULAR_FILE");
    assert.equal(present.receipt.inventories[0].entryCount, 1);
    assert.deepEqual(
      present.receipt.inventories[0].contentBytes,
      inventoryRecord.bytes,
    );
    const presentRequestGolden = assertFullRequestPlanGolden(present.plan, {
      ownerContext: {},
      request: {
        token: segment.receipt.inventorySet,
        managerActorEpochSha256,
        requestSequence: 4,
        operation: "INVENTORY",
        writerKind: "SERVICE_MANAGER",
        inventoryKind: "REGULAR_FILE",
        directoryRoleA: "LIFETIME_SEGMENT",
        directoryIdentitySha256A:
          segment.receipt.inventories[0].directory.identitySha256,
        directoryHandleSha256A: segmentHandle,
        nameA: inventoryRecord.name,
        expectedOutcome: "INVENTORY_OBSERVED",
      },
    });
    assertFullReceiptGolden(
      present.receipt,
      present.result,
      presentRequestGolden,
      {
        outcome: "INVENTORY_OBSERVED",
        retryDisposition: "NO_RETRY",
      },
    );
    assertExactDigests(present.plan, present.receipt);

    const releasePlan =
      module.planCandidateContainmentGuardianStatefsOperationV1(
        plannerInput({
          kind: "RELEASE_DIRECTORY",
          managerActorEpochSha256,
          requestSequence: 5,
          inventorySetSha256: present.receipt.inventorySet.inventorySetSha256,
          stateRootObservation: null,
          currentInventorySet: present.receipt.inventorySet,
          directoryRoleA: "LIFETIME_SEGMENT",
          expectedOutcome: "DIRECTORY_RELEASED",
        }),
      );
    const releaseResult = executorResult(releasePlan.request, {
      status: "COMPLETE",
      effectClass: "COMPLETE",
      lastCompletedStep: "DIRECTORY_RELEASED",
      failedStep: "NONE",
      completedStepCount: 3,
      observations: array(),
    });
    const releaseReceipt = dispatchPlan(module, releasePlan, releaseResult);
    const releaseRequestGolden = assertFullRequestPlanGolden(releasePlan, {
      ownerContext: {},
      request: {
        token: present.receipt.inventorySet,
        managerActorEpochSha256,
        requestSequence: 5,
        operation: "RELEASE_DIRECTORY",
        writerKind: "SERVICE_MANAGER",
        directoryRoleA: "LIFETIME_SEGMENT",
        directoryIdentitySha256A:
          segment.receipt.inventories[0].directory.identitySha256,
        directoryHandleSha256A: segmentHandle,
        expectedOutcome: "DIRECTORY_RELEASED",
      },
    });
    assertFullReceiptGolden(
      releaseReceipt,
      releaseResult,
      releaseRequestGolden,
      { outcome: "DIRECTORY_RELEASED", retryDisposition: "NO_RETRY" },
    );
    assert.equal(releasePlan.request.operation, "RELEASE_DIRECTORY");
    assert.equal(releaseReceipt.outcome, "DIRECTORY_RELEASED");
    assert.equal(releaseReceipt.retryDisposition, "NO_RETRY");
    assert.deepEqual(releaseReceipt.inventories, []);
    assert.equal(
      releaseReceipt.inventorySet.inventorySetSha256,
      present.receipt.inventorySet.inventorySetSha256,
    );
    assertExactDigests(releasePlan, releaseReceipt);
  },
);

test(
  "same-origin lifetime evidence deterministically selects MKDIR, PERSIST, and the two matching observation-only outcomes",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const label = "lifetime-mkdir-persist";
    const module = await freshStatefs(label);
    const tree = await rootAndLifecycleToken(module, { label });
    const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
    const owner = createLifetimeOwner({
      label,
      root: tree.root,
      managerActorEpochSha256,
    });
    const beforeReplay = lifetimeReplayArguments(owner, 0);
    const lifetimeRecord = owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");

    const mkdirPlan = module.planCandidateContainmentGuardianStatefsOperationV1(
      autoInput({
        label,
        managerActorEpochSha256,
        sequence: 3,
        token: tree.token,
        lifetimeReplayArguments: beforeReplay,
        artifactBytes: lifetimeRecord.bytes,
      }),
    );
    const lifetimesBinding = exactDirectoryBinding(tree.token, "LIFETIMES");
    const mkdirRequestGolden = assertFullRequestPlanGolden(mkdirPlan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(beforeReplay),
      },
      request: {
        token: tree.token,
        managerActorEpochSha256,
        requestSequence: 3,
        operation: "MKDIR_SYNC",
        writerKind: lifetimeRecord.writerKind,
        actorKind: null,
        targetSha256: lifetimeRecord.targetSha256,
        requiredDurableRecordType: null,
        requiredOutcomeRecordType: lifetimeRecord.recordType,
        directoryRoleA: "LIFETIMES",
        directoryIdentitySha256A: lifetimesBinding.identitySha256,
        directoryHandleSha256A: lifetimesBinding.handleSha256,
        nameA: owner.identity.identitySha256,
        authorizationRawSha256: lifetimeRecord.previousRecordRawSha256,
        expectedOutcome: "DIRECTORY_CREATED",
      },
    });
    assert.equal(mkdirPlan.request.operation, "MKDIR_SYNC");
    assert.equal(mkdirPlan.request.directoryRoleA, "LIFETIMES");
    assert.equal(mkdirPlan.request.nameA, owner.identity.identitySha256);
    assert.equal(mkdirPlan.request.expectedOutcome, "DIRECTORY_CREATED");
    const mkdirResult = completeMutationResult(mkdirPlan.request, {
      observations: array(
        nativeObservation({
          kind: "DIRECTORY",
          role: "LIFETIME_SEGMENT",
          name: owner.identity.identitySha256,
          inode: "201",
        }),
      ),
    });
    const mkdirReceipt = dispatchPlan(module, mkdirPlan, mkdirResult);
    assert.equal(mkdirReceipt.outcome, "DIRECTORY_CREATED");
    assert.equal(mkdirReceipt.inventories.length, 2);
    assert.equal(mkdirReceipt.retryDisposition, "NO_RETRY");
    assertFullReceiptGolden(mkdirReceipt, mkdirResult, mkdirRequestGolden, {
      outcome: "DIRECTORY_CREATED",
      retryDisposition: "NO_RETRY",
    });
    assertExactDigests(mkdirPlan, mkdirReceipt);

    const mkdirDefiniteModule = await freshStatefs(`${label}-mkdir-definite`);
    const mkdirDefiniteTree = await rootAndLifecycleToken(mkdirDefiniteModule, {
      label,
    });
    const mkdirDefinitePlan =
      mkdirDefiniteModule.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label,
          managerActorEpochSha256,
          sequence: 3,
          token: mkdirDefiniteTree.token,
          lifetimeReplayArguments: beforeReplay,
          artifactBytes: lifetimeRecord.bytes,
        }),
      );
    assert.equal(mkdirDefinitePlan.request.operation, "MKDIR_SYNC");
    const mkdirDefiniteResult = completeMutationResult(
      mkdirDefinitePlan.request,
      {
        status: "FAULT_INJECTED",
        effectClass: "DEFINITE_NO_EFFECT",
        lastCompletedStep: "FD_A_VALIDATED",
        failedStep: "CHILD_DIRECTORY_CREATED",
        errno: 5,
        completedStepCount: 2,
        observations: array(),
      },
    );
    const mkdirDefiniteReceipt = dispatchPlan(
      mkdirDefiniteModule,
      mkdirDefinitePlan,
      mkdirDefiniteResult,
    );
    assert.equal(mkdirDefiniteReceipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.equal(
      mkdirDefiniteReceipt.retryDisposition,
      "REPLAN_AFTER_FRESH_INVENTORY",
    );
    assert.notEqual(mkdirDefiniteReceipt.inventorySet, null);
    assertExactDigests(mkdirDefinitePlan, mkdirDefiniteReceipt);

    const absentRecord = completeRegularInventory(module, {
      label,
      sequence: 4,
      token: mkdirReceipt.inventorySet,
      role: "LIFETIME_SEGMENT",
      name: lifetimeRecord.name,
    });
    const absentSegmentBinding = exactDirectoryBinding(
      mkdirReceipt.inventorySet,
      "LIFETIME_SEGMENT",
    );
    const absentRecordRequestGolden = assertFullRequestPlanGolden(
      absentRecord.plan,
      {
        ownerContext: {},
        request: {
          token: mkdirReceipt.inventorySet,
          managerActorEpochSha256,
          requestSequence: 4,
          operation: "INVENTORY",
          writerKind: "SERVICE_MANAGER",
          inventoryKind: "REGULAR_FILE",
          directoryRoleA: "LIFETIME_SEGMENT",
          directoryIdentitySha256A: absentSegmentBinding.identitySha256,
          directoryHandleSha256A: absentSegmentBinding.handleSha256,
          nameA: lifetimeRecord.name,
          expectedOutcome: "INVENTORY_OBSERVED",
        },
      },
    );
    assertFullReceiptGolden(
      absentRecord.receipt,
      absentRecord.result,
      absentRecordRequestGolden,
      { outcome: "INVENTORY_OBSERVED", retryDisposition: "NO_RETRY" },
    );
    const persistCallerBytes = Buffer.from(lifetimeRecord.bytes);
    const persistPlan =
      module.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label,
          managerActorEpochSha256,
          sequence: 5,
          token: absentRecord.receipt.inventorySet,
          lifetimeReplayArguments: beforeReplay,
          artifactBytes: persistCallerBytes,
        }),
      );
    persistCallerBytes.fill(0);
    assert.deepEqual(persistPlan.request.bytes, lifetimeRecord.bytes);
    const segmentBinding = exactDirectoryBinding(
      absentRecord.receipt.inventorySet,
      "LIFETIME_SEGMENT",
    );
    const persistRequestGolden = assertFullRequestPlanGolden(persistPlan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(beforeReplay),
      },
      request: {
        token: absentRecord.receipt.inventorySet,
        managerActorEpochSha256,
        requestSequence: 5,
        operation: "PERSIST_NOREPLACE",
        writerKind: lifetimeRecord.writerKind,
        actorKind: null,
        targetSha256: lifetimeRecord.targetSha256,
        requiredDurableRecordType: null,
        requiredOutcomeRecordType: null,
        directoryRoleA: "LIFETIME_SEGMENT",
        directoryIdentitySha256A: segmentBinding.identitySha256,
        directoryHandleSha256A: segmentBinding.handleSha256,
        nameB: lifetimeRecord.name,
        bytes: lifetimeRecord.bytes,
        authorizationRawSha256: lifetimeRecord.previousRecordRawSha256,
        expectedOutcome: "PERSISTED",
      },
    });
    assert.equal(persistPlan.request.operation, "PERSIST_NOREPLACE");
    assert.equal(persistPlan.request.directoryRoleA, "LIFETIME_SEGMENT");
    assert.equal(persistPlan.request.nameB, lifetimeRecord.name);
    assert.match(
      persistPlan.request.nameA,
      /^\.(?:generation\.jsonl|[0-9]{16}-[0-9a-f]{64}\.jsonl)\.tmp-[0-9a-f]{64}$/u,
    );
    assert.deepEqual(persistPlan.request.bytes, lifetimeRecord.bytes);
    assert.equal(
      persistPlan.request.inputRawSha256,
      byteSha256(lifetimeRecord.bytes),
    );
    const persistResult = completeMutationResult(persistPlan.request, {
      observations: array(
        nativeObservation({
          kind: "REGULAR",
          role: "LIFETIME_SEGMENT",
          name: lifetimeRecord.name,
          inode: "301",
          byteLength: String(lifetimeRecord.bytes.length),
          linkCount: "1",
          mode: 0o100_600,
          contentLength: 0,
        }),
      ),
    });
    const persistReceipt = dispatchPlan(module, persistPlan, persistResult);
    assert.equal(persistReceipt.outcome, "PERSISTED");
    assert.equal(persistReceipt.inventories.length, 2);
    assert.equal(persistReceipt.retryDisposition, "NO_RETRY");
    assertFullReceiptGolden(
      persistReceipt,
      persistResult,
      persistRequestGolden,
      {
        outcome: "PERSISTED",
        retryDisposition: "NO_RETRY",
      },
    );
    assertExactDigests(persistPlan, persistReceipt);

    const copiedBytes = persistPlan.request.bytes;
    copiedBytes.fill(0);
    assert.deepEqual(persistPlan.request.bytes, lifetimeRecord.bytes);
    const inventoryBytes = persistReceipt.inventories[1].contentBytes;
    inventoryBytes.fill(0);
    assert.deepEqual(
      persistReceipt.inventories[1].contentBytes,
      lifetimeRecord.bytes,
    );

    const alreadyPlan =
      module.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label,
          managerActorEpochSha256,
          sequence: 6,
          token: persistReceipt.inventorySet,
          lifetimeReplayArguments: lifetimeReplayArguments(owner, 1),
          artifactBytes: lifetimeRecord.bytes,
        }),
      );
    const alreadyReplayArguments = lifetimeReplayArguments(owner, 1);
    const alreadyRequestGolden = assertFullRequestPlanGolden(alreadyPlan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(alreadyReplayArguments),
      },
      request: {
        token: persistReceipt.inventorySet,
        managerActorEpochSha256,
        requestSequence: 6,
        operation: "PERSIST_NOREPLACE",
        executionDisposition: "OBSERVATION_ONLY",
        writerKind: lifetimeRecord.writerKind,
        actorKind: null,
        targetSha256: lifetimeRecord.targetSha256,
        requiredDurableRecordType: null,
        requiredOutcomeRecordType: null,
        directoryRoleA: "LIFETIME_SEGMENT",
        directoryIdentitySha256A: segmentBinding.identitySha256,
        directoryHandleSha256A: segmentBinding.handleSha256,
        nameB: lifetimeRecord.name,
        bytes: lifetimeRecord.bytes,
        authorizationRawSha256: lifetimeRecord.previousRecordRawSha256,
        expectedOutcome: "ALREADY_PRESENT_EXACT",
      },
    });
    assert.equal(alreadyPlan.request.operation, "PERSIST_NOREPLACE");
    assert.equal(alreadyPlan.request.executionDisposition, "OBSERVATION_ONLY");
    assert.equal(alreadyPlan.request.expectedOutcome, "ALREADY_PRESENT_EXACT");
    const alreadyReceipt = dispatchPlan(module, alreadyPlan, null);
    assert.equal(alreadyReceipt.status, "OBSERVATION_ONLY");
    assert.equal(alreadyReceipt.effectClass, "DEFINITE_NO_EFFECT");
    assert.equal(alreadyReceipt.outcome, "ALREADY_PRESENT_EXACT");
    assert.equal(alreadyReceipt.retryDisposition, "NO_RETRY");
    assert.notEqual(alreadyReceipt.inventorySet, null);
    assertFullReceiptGolden(alreadyReceipt, null, alreadyRequestGolden, {
      outcome: "ALREADY_PRESENT_EXACT",
      retryDisposition: "NO_RETRY",
    });
    assertExactDigests(alreadyPlan, alreadyReceipt);

    const presentLabel = "lifetime-directory-already";
    const presentModule = await freshStatefs(presentLabel);
    const presentRoot = heldDirectoryObservation();
    const presentManager = digest(`${presentLabel}:manager-actor-epoch`);
    const presentOwner = createLifetimeOwner({
      label: presentLabel,
      root: presentRoot,
      managerActorEpochSha256: presentManager,
    });
    const presentRecord = presentOwner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
    const presentTree = await rootAndLifecycleToken(presentModule, {
      label: presentLabel,
      lifecycleEntries: array(
        array(presentOwner.identity.identitySha256, "LIFETIME_SEGMENT", "201"),
      ),
    });
    assert.equal(presentTree.root.identitySha256, presentRoot.identitySha256);
    const directoryAlreadyPlan =
      presentModule.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label: presentLabel,
          managerActorEpochSha256: presentManager,
          sequence: 3,
          token: presentTree.token,
          lifetimeReplayArguments: lifetimeReplayArguments(presentOwner, 0),
          artifactBytes: presentRecord.bytes,
        }),
      );
    const presentLifetimesBinding = exactDirectoryBinding(
      presentTree.token,
      "LIFETIMES",
    );
    const directoryAlreadyRequestGolden = assertFullRequestPlanGolden(
      directoryAlreadyPlan,
      {
        ownerContext: {
          lifetimeReplay: replayLifetimeIndependently(
            lifetimeReplayArguments(presentOwner, 0),
          ),
        },
        request: {
          token: presentTree.token,
          managerActorEpochSha256: presentManager,
          requestSequence: 3,
          operation: "MKDIR_SYNC",
          executionDisposition: "OBSERVATION_ONLY",
          writerKind: presentRecord.writerKind,
          actorKind: null,
          targetSha256: presentRecord.targetSha256,
          requiredDurableRecordType: null,
          requiredOutcomeRecordType: presentRecord.recordType,
          directoryRoleA: "LIFETIMES",
          directoryIdentitySha256A: presentLifetimesBinding.identitySha256,
          directoryHandleSha256A: presentLifetimesBinding.handleSha256,
          nameA: presentOwner.identity.identitySha256,
          authorizationRawSha256: presentRecord.previousRecordRawSha256,
          expectedOutcome: "DIRECTORY_ALREADY_PRESENT_EXACT",
        },
      },
    );
    assert.equal(directoryAlreadyPlan.request.operation, "MKDIR_SYNC");
    assert.equal(
      directoryAlreadyPlan.request.executionDisposition,
      "OBSERVATION_ONLY",
    );
    assert.equal(
      directoryAlreadyPlan.request.expectedOutcome,
      "DIRECTORY_ALREADY_PRESENT_EXACT",
    );
    const directoryAlreadyReceipt = dispatchPlan(
      presentModule,
      directoryAlreadyPlan,
      null,
    );
    assert.equal(
      directoryAlreadyReceipt.outcome,
      "DIRECTORY_ALREADY_PRESENT_EXACT",
    );
    assert.equal(directoryAlreadyReceipt.retryDisposition, "NO_RETRY");
    assertFullReceiptGolden(
      directoryAlreadyReceipt,
      null,
      directoryAlreadyRequestGolden,
      {
        outcome: "DIRECTORY_ALREADY_PRESENT_EXACT",
        retryDisposition: "NO_RETRY",
      },
    );
    assertExactDigests(directoryAlreadyPlan, directoryAlreadyReceipt);
  },
);

test(
  "a fully inventoried adopted lifetime yields a one-shot CONTEXT_ONLY WAIT plan without reserving its token",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const label = "context-only-wait";
    const module = await freshStatefs(label);
    const root = heldDirectoryObservation();
    const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
    const journal = ownerFixtures.createJournalStack(label, 0);
    const owner = createAdoptedLifetimeOwner({
      label,
      root,
      managerActorEpochSha256,
      journal,
    });
    const tree = await rootAndLifecycleToken(module, {
      label,
      lifecycleEntries: array(
        array(owner.identity.identitySha256, "LIFETIME_SEGMENT", "201"),
      ),
    });
    const recordEntries = owner.records.map((lifetimeRecord, index) =>
      record(
        ["kind", "REGULAR"],
        ["role", "NONE"],
        ["name", lifetimeRecord.name],
        ["inode", String(300 + index)],
        ["byteLength", String(lifetimeRecord.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      ),
    );
    const segment = completeDirectoryInventory(module, {
      label,
      sequence: 3,
      token: tree.token,
      role: "LIFETIME_SEGMENT",
      parentRole: "LIFETIMES",
      name: owner.identity.identitySha256,
      targetInode: "201",
      entries: array(...recordEntries),
      returnedDirectoryFd: 65,
    });
    let token = segment.receipt.inventorySet;
    let sequence = 4;
    for (const [index, lifetimeRecord] of owner.records.entries()) {
      const observed = completeRegularInventory(module, {
        label,
        sequence,
        token,
        role: "LIFETIME_SEGMENT",
        name: lifetimeRecord.name,
        bytes: lifetimeRecord.bytes,
        inode: String(300 + index),
      });
      token = observed.receipt.inventorySet;
      sequence += 1;
    }
    const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
      autoInput({
        label,
        managerActorEpochSha256,
        sequence,
        token,
        lifetimeReplayArguments: lifetimeReplayArguments(owner),
      }),
    );
    assertFullContextPlanGolden(plan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(
          lifetimeReplayArguments(owner),
        ),
      },
      token,
      managerActorEpochSha256,
      requestSequence: sequence,
      managerDisposition: "WAIT_GUARDIAN",
      actorKind: "LIVE_BIRTH_GUARDIAN",
      guardianAction: "WAIT_STATUS",
    });
    assert.equal(plan.planKind, "CONTEXT_ONLY");
    assert.equal(plan.managerDisposition, "WAIT_GUARDIAN");
    assert.equal(plan.request, null);
    assert.equal(plan.operation, null);
    assert.equal(plan.requestSha256, null);
    assert.equal(plan.inventorySet, token);
    assert.equal(plan.inventorySetSha256, token.inventorySetSha256);
    assert.equal(
      plan.ownerContext.ownerContextSha256,
      semanticSha256(canonicalOwnerContextProjection(plan.ownerContext)),
    );
    assert.equal(
      plan.planSha256,
      semanticSha256(canonicalPlanProjection(plan)),
    );
    const context =
      module.assertCandidateContainmentGuardianStatefsPlanV1(plan);
    assert.equal(context, plan.ownerContext);
    expectCode(
      () => module.assertCandidateContainmentGuardianStatefsPlanV1(plan),
      "STATEFS_BINDING",
    );
    const stillUsable = planDirectoryInventory(module, {
      label,
      sequence,
      token,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    assert.equal(stillUsable.request.operation, "INVENTORY");
  },
);

test(
  "same-origin owners select exact normal/recovery handoff, recovery replan, and terminal CONTEXT_ONLY plans",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const normalLabel = "context-normal-handoff";
    const normalModule = await freshStatefs(normalLabel);
    const normalRoot = heldDirectoryObservation();
    const normalManager = digest(`${normalLabel}:manager-actor-epoch`);
    const normalOwner = createNormalHandoffLifetimeOwner({
      label: normalLabel,
      root: normalRoot,
      managerActorEpochSha256: normalManager,
    });
    const normalTree = await observedLifetimeOwnerToken(normalModule, {
      label: normalLabel,
      owner: normalOwner,
    });
    const normalReplayArguments = lifetimeReplayArguments(normalOwner);
    const normalPlan =
      normalModule.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label: normalLabel,
          managerActorEpochSha256: normalManager,
          sequence: normalTree.sequence,
          token: normalTree.token,
          lifetimeReplayArguments: normalReplayArguments,
        }),
      );
    assertAndConsumeContextPlan(normalModule, normalPlan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(normalReplayArguments),
      },
      token: normalTree.token,
      managerActorEpochSha256: normalManager,
      requestSequence: normalTree.sequence,
      managerDisposition: "GUARDIAN_HANDOFF",
      writerKind: "SERVICE_MANAGER",
      actorKind: "LIVE_BIRTH_GUARDIAN",
      guardianAction: "NORMAL_CONTROL_HANDOFF",
    });

    const recoveryLabel = "context-recovery-handoff";
    const recoveryModule = await freshStatefs(recoveryLabel);
    const recoveryRoot = heldDirectoryObservation();
    const recoveryManager = digest(`${recoveryLabel}:manager-actor-epoch`);
    const recoveryJournal = ownerFixtures.createJournalStack(recoveryLabel, 5);
    const recoveryOwnerValue = createAdoptedLifetimeOwner({
      label: recoveryLabel,
      root: recoveryRoot,
      managerActorEpochSha256: recoveryManager,
      journal: recoveryJournal,
    });
    const recoveryTuple = buildRecoveryOnlyAttemptTuple(
      recoveryOwnerValue,
      recoveryJournal,
      { launchState: "INTENT" },
    );
    const recoveryTree = await observedLifetimeOwnerToken(recoveryModule, {
      label: recoveryLabel,
      owner: recoveryOwnerValue,
    });
    const recoveryReplayArguments = lifetimeReplayArguments(recoveryOwnerValue);
    const recoveryPlan =
      recoveryModule.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label: recoveryLabel,
          managerActorEpochSha256: recoveryManager,
          sequence: recoveryTree.sequence,
          token: recoveryTree.token,
          lifetimeReplayArguments: recoveryReplayArguments,
          generationManifest: artifact(recoveryJournal.generationManifest),
          normalJournalBundles: journalArtifactList(recoveryJournal),
          recoveryTarget: recoveryTuple.recoveryTarget,
          recoveryInventory: recoveryTuple.recoveryInventory,
          recoveryReplay: recoveryTuple.recoveryReplay,
          recoveryPlan: recoveryTuple.recoveryPlan,
          recoveryAttempt: recoveryTuple.recoveryAttempt,
        }),
      );
    assertAndConsumeContextPlan(recoveryModule, recoveryPlan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(recoveryReplayArguments),
        recoveryTarget: recoveryTuple.recoveryTarget,
        recoveryInventory: recoveryTuple.recoveryInventory,
        recoveryReplay: recoveryTuple.recoveryReplay,
        recoveryPlan: recoveryTuple.recoveryPlan,
        recoveryAttempt: recoveryTuple.recoveryAttempt,
        lifetimeAnchorProjection:
          recoveryTuple.anchorSelection.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          recoveryTuple.anchorSelection.lifetimeAttemptAnchorRawSha256,
        generationManifest: recoveryJournal.generationManifest,
        normalJournalBundles: array(...recoveryJournal.normalJournalBundles),
      },
      token: recoveryTree.token,
      managerActorEpochSha256: recoveryManager,
      requestSequence: recoveryTree.sequence,
      managerDisposition: "GUARDIAN_HANDOFF",
      writerKind: "SERVICE_MANAGER",
      actorKind: "RECOVERY_ONLY_GUARDIAN",
      targetSha256: recoveryTuple.recoveryTarget.targetSha256,
      guardianAction: "RECOVERY_CONTROL_HANDOFF",
    });

    const replanLabel = "context-recovery-replan";
    const replanModule = await freshStatefs(replanLabel);
    const replanRoot = heldDirectoryObservation();
    const replanManager = digest(`${replanLabel}:manager-actor-epoch`);
    const replanJournal = ownerFixtures.createJournalStack(replanLabel, 5);
    const replanOwner = createAdoptedLifetimeOwner({
      label: replanLabel,
      root: replanRoot,
      managerActorEpochSha256: replanManager,
      journal: replanJournal,
    });
    const replanTuple = buildRecoveryReplanTuple(replanOwner, replanJournal);
    const replanTree = await observedLifetimeOwnerToken(replanModule, {
      label: replanLabel,
      owner: replanOwner,
    });
    const replanReplayArguments = lifetimeReplayArguments(replanOwner);
    const replanPlan =
      replanModule.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label: replanLabel,
          managerActorEpochSha256: replanManager,
          sequence: replanTree.sequence,
          token: replanTree.token,
          lifetimeReplayArguments: replanReplayArguments,
          generationManifest: artifact(replanJournal.generationManifest),
          normalJournalBundles: journalArtifactList(replanJournal),
          recoveryTarget: replanTuple.recoveryTarget,
          recoveryInventory: replanTuple.recoveryInventory,
          recoveryReplay: replanTuple.recoveryReplay,
          recoveryPlan: replanTuple.recoveryPlan,
        }),
      );
    assertAndConsumeContextPlan(replanModule, replanPlan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(replanReplayArguments),
        recoveryTarget: replanTuple.recoveryTarget,
        recoveryInventory: replanTuple.recoveryInventory,
        recoveryReplay: replanTuple.recoveryReplay,
        recoveryPlan: replanTuple.recoveryPlan,
        generationManifest: replanJournal.generationManifest,
        normalJournalBundles: array(...replanJournal.normalJournalBundles),
      },
      token: replanTree.token,
      managerActorEpochSha256: replanManager,
      requestSequence: replanTree.sequence,
      managerDisposition: "RECOVERY_REPLAN",
      writerKind: "SERVICE_MANAGER",
      targetSha256: replanTuple.recoveryTarget.targetSha256,
    });

    const terminalLabel = "context-terminal";
    const terminalModule = await freshStatefs(terminalLabel);
    const terminalRoot = heldDirectoryObservation();
    const terminalManager = digest(`${terminalLabel}:manager-actor-epoch`);
    const terminalJournal = ownerFixtures.createJournalStack(terminalLabel, 0);
    const terminalOwner = createTerminalLifetimeOwner({
      label: terminalLabel,
      root: terminalRoot,
      managerActorEpochSha256: terminalManager,
      journal: terminalJournal,
    });
    const terminalTree = await observedLifetimeOwnerToken(terminalModule, {
      label: terminalLabel,
      owner: terminalOwner,
    });
    const terminalReplayArguments = lifetimeReplayArguments(terminalOwner);
    const terminalPlan =
      terminalModule.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label: terminalLabel,
          managerActorEpochSha256: terminalManager,
          sequence: terminalTree.sequence,
          token: terminalTree.token,
          lifetimeReplayArguments: terminalReplayArguments,
        }),
      );
    assertAndConsumeContextPlan(terminalModule, terminalPlan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(terminalReplayArguments),
      },
      token: terminalTree.token,
      managerActorEpochSha256: terminalManager,
      requestSequence: terminalTree.sequence,
      managerDisposition: "TERMINAL",
    });
  },
);

test(
  "a same-origin recovery-only attempt selects and persists its first exact recovery record",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const label = "recovery-record-persist";
    const module = await freshStatefs(label);
    const root = heldDirectoryObservation();
    const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
    const journal = ownerFixtures.createJournalStack(label, 5);
    const owner = createAdoptedLifetimeOwner({
      label,
      root,
      managerActorEpochSha256,
      journal,
    });
    const tuple = buildRecoveryOnlyAttemptTuple(owner, journal, {
      launchState: "ADOPTED",
    });
    const recoveryRecord = createFirstRecoveryRecord(tuple, label);
    const tree = await recoveryAttemptRecordToken(module, {
      label,
      journal,
      recoveryAttempt: tuple.recoveryAttempt,
      recoveryRecord,
    });
    const replayArguments = lifetimeReplayArguments(owner);
    const corruptedRecordBytes = Buffer.from(recoveryRecord.bytes);
    corruptedRecordBytes[corruptedRecordBytes.length - 2] ^= 1;
    const corruptedRecoveryRecord = record(
      ...Reflect.ownKeys(recoveryRecord).map((key) => [
        key,
        key === "bytes" ? corruptedRecordBytes : recoveryRecord[key],
      ]),
    );
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1(
          autoInput({
            label,
            managerActorEpochSha256,
            sequence: tree.sequence,
            token: tree.token,
            lifetimeReplayArguments: replayArguments,
            generationManifest: artifact(journal.generationManifest),
            normalJournalBundles: journalArtifactList(journal),
            recoveryTarget: tuple.recoveryTarget,
            recoveryInventory: tuple.recoveryInventory,
            recoveryReplay: tuple.recoveryReplay,
            recoveryPlan: tuple.recoveryPlan,
            recoveryAttempt: tuple.recoveryAttempt,
            recoveryRecord: corruptedRecoveryRecord,
            artifactBytes: corruptedRecordBytes,
          }),
        ),
      "STATEFS_PREDECESSOR",
    );
    const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
      autoInput({
        label,
        managerActorEpochSha256,
        sequence: tree.sequence,
        token: tree.token,
        lifetimeReplayArguments: replayArguments,
        generationManifest: artifact(journal.generationManifest),
        normalJournalBundles: journalArtifactList(journal),
        recoveryTarget: tuple.recoveryTarget,
        recoveryInventory: tuple.recoveryInventory,
        recoveryReplay: tuple.recoveryReplay,
        recoveryPlan: tuple.recoveryPlan,
        recoveryAttempt: tuple.recoveryAttempt,
        recoveryRecord,
        artifactBytes: recoveryRecord.bytes,
      }),
    );
    const parent = exactDirectoryBinding(tree.token, "RECOVERY_ATTEMPT");
    const request = assertFullRequestPlanGolden(plan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(replayArguments),
        recoveryTarget: tuple.recoveryTarget,
        recoveryInventory: tuple.recoveryInventory,
        recoveryReplay: tuple.recoveryReplay,
        recoveryPlan: tuple.recoveryPlan,
        recoveryAttempt: tuple.recoveryAttempt,
        recoveryRecord,
        lifetimeAnchorProjection:
          tuple.anchorSelection.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          tuple.anchorSelection.lifetimeAttemptAnchorRawSha256,
        generationManifest: journal.generationManifest,
        normalJournalBundles: array(...journal.normalJournalBundles),
      },
      request: {
        token: tree.token,
        managerActorEpochSha256,
        requestSequence: tree.sequence,
        operation: "PERSIST_NOREPLACE",
        writerKind: tuple.recoveryAttempt.actorKind,
        actorKind: tuple.recoveryAttempt.actorKind,
        targetSha256: tuple.recoveryTarget.targetSha256,
        requiredDurableRecordType: recoveryRecord.priorState,
        requiredOutcomeRecordType: null,
        directoryRoleA: "RECOVERY_ATTEMPT",
        directoryIdentitySha256A: parent.identitySha256,
        directoryHandleSha256A: parent.handleSha256,
        nameB: recoveryRecord.name,
        bytes: recoveryRecord.bytes,
        authorizationRawSha256: recoveryRecord.previousRecordRawSha256,
        expectedOutcome: "PERSISTED",
      },
    });
    const result = completeMutationResult(plan.request, {
      observations: array(
        nativeObservation({
          kind: "REGULAR",
          role: "RECOVERY_ATTEMPT",
          name: recoveryRecord.name,
          inode: "700",
          byteLength: String(recoveryRecord.bytes.length),
          linkCount: "1",
          mode: 0o100_600,
          contentLength: 0,
        }),
      ),
    });
    const receipt = dispatchPlan(module, plan, result);
    assertFullReceiptGolden(receipt, result, request, {
      outcome: "PERSISTED",
      retryDisposition: "NO_RETRY",
    });
    assert.equal(receipt.outcome, "PERSISTED");
    assert.equal(receipt.retryDisposition, "NO_RETRY");
    assertExactDigests(plan, receipt);
  },
);

test(
  "same-origin adopted journal evidence selects MOVE, sync-only recovery, and destination-already without laundering rename",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    async function moveScenario({
      label,
      bundleCount,
      sourcePresent,
      destinationPresent,
      inventorySourceDescendant = false,
      normalCloseDurable = false,
    }) {
      const module = await freshStatefs(label);
      const journal = ownerFixtures.createJournalStack(label, 18);
      const generationName = journal.generationIdentity.identitySha256;
      const active = await lifecycleParentToken(module, {
        label,
        role: "ACTIVE",
        entries: sourcePresent
          ? array(array(generationName, "GENERATION", "500"))
          : array(),
      });
      let sourceDescendant = null;
      let token = active.token;
      let sequence = 3;
      if (inventorySourceDescendant) {
        sourceDescendant = completeDirectoryInventory(module, {
          label,
          sequence,
          token,
          role: "GENERATION",
          parentRole: "ACTIVE",
          name: generationName,
          targetInode: "500",
          entries: array(
            record(
              ["kind", "REGULAR"],
              ["role", "GENERATION"],
              ["name", "generation.jsonl"],
              ["inode", "503"],
              ["byteLength", String(journal.generationManifest.bytes.length)],
              ["linkCount", "1"],
              ["mode", 0o100_600],
            ),
            array("normal", "NORMAL_JOURNAL", "501"),
            array("recovery", "RECOVERY_JOURNAL", "502"),
          ),
          returnedDirectoryFd: 63,
        });
        token = sourceDescendant.receipt.inventorySet;
        sequence += 1;
      }
      const closed = completeDirectoryInventory(module, {
        label,
        sequence,
        token,
        role: "CLOSED",
        parentRole: "STATE_ROOT",
        name: "closed",
        targetInode: "104",
        entries: destinationPresent
          ? array(array(generationName, "GENERATION", "500"))
          : array(),
        returnedDirectoryFd: 64,
      });
      sequence += 1;
      const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
      const owner = createAdoptedLifetimeOwner({
        label,
        root: active.root,
        managerActorEpochSha256,
        journal,
      });
      const closeDecision = buildCloseDecisionTuple(
        owner,
        journal,
        sourcePresent ? "active" : "closed",
        { normalCloseDurable },
      );
      const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label,
          managerActorEpochSha256,
          sequence,
          token: closed.receipt.inventorySet,
          lifetimeReplayArguments: lifetimeReplayArguments(owner),
          generationManifest: artifact(journal.generationManifest),
          normalJournalBundles: journalArtifactList(journal, bundleCount),
          recoveryTarget: closeDecision.recoveryTarget,
          recoveryInventory: closeDecision.recoveryInventory,
          recoveryReplay: closeDecision.recoveryReplay,
          recoveryPlan: closeDecision.recoveryPlan,
        }),
      );
      return {
        module,
        journal,
        generationName,
        owner,
        closeDecision,
        sourceDescendant,
        requestSequence: sequence,
        plan,
      };
    }

    const move = await moveScenario({
      label: "move-noreplace",
      bundleCount: 18,
      sourcePresent: true,
      destinationPresent: false,
      inventorySourceDescendant: true,
    });
    assert.notEqual(move.sourceDescendant, null);
    const sourceDescendantHandle =
      move.sourceDescendant.receipt.inventories[0].directoryHandleSha256;
    assert.notEqual(
      exactScope(
        TOKEN_EXPECTATIONS.get(move.plan.inventorySet).scopes,
        sourceDescendantHandle,
        "DIRECTORY",
        null,
      ),
      null,
    );
    assert.equal(move.plan.request.operation, "MOVE_NOREPLACE_SYNC");
    assert.equal(move.plan.request.directoryRoleA, "ACTIVE");
    assert.equal(move.plan.request.directoryRoleB, "CLOSED");
    assert.equal(move.plan.request.nameA, move.generationName);
    assert.equal(move.plan.request.nameB, move.generationName);
    const moveActive = exactDirectoryBinding(move.plan.inventorySet, "ACTIVE");
    const moveClosed = exactDirectoryBinding(move.plan.inventorySet, "CLOSED");
    const moveRequestGolden = assertFullRequestPlanGolden(move.plan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(
          lifetimeReplayArguments(move.owner),
        ),
        generationManifest: move.journal.generationManifest,
        normalJournalBundles: array(...move.journal.normalJournalBundles),
        recoveryTarget: move.closeDecision.recoveryTarget,
        recoveryInventory: move.closeDecision.recoveryInventory,
        recoveryReplay: move.closeDecision.recoveryReplay,
        recoveryPlan: move.closeDecision.recoveryPlan,
      },
      request: {
        token: move.plan.inventorySet,
        managerActorEpochSha256: digest("move-noreplace:manager-actor-epoch"),
        requestSequence: move.requestSequence,
        operation: "MOVE_NOREPLACE_SYNC",
        writerKind: "SERVICE_MANAGER",
        actorKind: "LIVE_BIRTH_GUARDIAN",
        targetSha256: move.closeDecision.recoveryTarget.targetSha256,
        requiredDurableRecordType: "CLOSED_DURABLE",
        requiredOutcomeRecordType: "NORMAL_CLOSE_RECEIPT_DURABLE",
        directoryRoleA: "ACTIVE",
        directoryIdentitySha256A: moveActive.identitySha256,
        directoryHandleSha256A: moveActive.handleSha256,
        directoryRoleB: "CLOSED",
        directoryIdentitySha256B: moveClosed.identitySha256,
        directoryHandleSha256B: moveClosed.handleSha256,
        nameA: move.generationName,
        nameB: move.generationName,
        authorizationRawSha256: move.journal.normalJournalBundles[17].rawSha256,
        expectedOutcome: "MOVED",
      },
    });
    const movedResult = completeMutationResult(move.plan.request, {
      observations: array(
        nativeObservation({
          kind: "ABSENT",
          role: "ACTIVE",
          name: move.generationName,
          deviceMajor: "0",
          deviceMinor: "0",
          inode: "0",
          mountId: "0",
          byteLength: "0",
          linkCount: "0",
          mode: 0,
          ownerUid: 0,
          ownerGid: 0,
          filesystemMagic: "0",
        }),
        nativeObservation({
          kind: "DIRECTORY",
          role: "CLOSED",
          name: move.generationName,
          inode: "500",
        }),
      ),
    });
    const movedReceipt = dispatchPlan(move.module, move.plan, movedResult);
    assert.equal(movedReceipt.outcome, "MOVED");
    assert.equal(movedReceipt.inventories.length, 2);
    assert.equal(movedReceipt.retryDisposition, "NO_RETRY");
    assertFullReceiptGolden(movedReceipt, movedResult, moveRequestGolden, {
      outcome: "MOVED",
      retryDisposition: "NO_RETRY",
    });
    assert.equal(
      [
        ...TOKEN_EXPECTATIONS.get(movedReceipt.inventorySet).scopes.values(),
      ].some(
        (entry) =>
          entry.projection.directoryHandleSha256 === sourceDescendantHandle,
      ),
      false,
      "move successor deletes every stale source-descendant scope",
    );
    assertExactDigests(move.plan, movedReceipt);

    const moveDefinite = await moveScenario({
      label: "move-definite-no-effect",
      bundleCount: 18,
      sourcePresent: true,
      destinationPresent: false,
    });
    const moveDefiniteResult = completeMutationResult(
      moveDefinite.plan.request,
      {
        status: "FAULT_INJECTED",
        effectClass: "DEFINITE_NO_EFFECT",
        lastCompletedStep: "SOURCE_REOBSERVED",
        failedStep: "GENERATION_MOVED",
        errno: 5,
        completedStepCount: 4,
        observations: array(),
      },
    );
    const moveDefiniteReceipt = dispatchPlan(
      moveDefinite.module,
      moveDefinite.plan,
      moveDefiniteResult,
    );
    assert.equal(moveDefiniteReceipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.equal(
      moveDefiniteReceipt.retryDisposition,
      "REPLAN_AFTER_FRESH_INVENTORY",
    );
    assert.notEqual(moveDefiniteReceipt.inventorySet, null);
    assertExactDigests(moveDefinite.plan, moveDefiniteReceipt);

    const sync = await moveScenario({
      label: "move-sync-only",
      bundleCount: 18,
      sourcePresent: false,
      destinationPresent: true,
    });
    assert.equal(sync.plan.request.operation, "MOVE_SYNC_REOBSERVE");
    const syncActive = exactDirectoryBinding(sync.plan.inventorySet, "ACTIVE");
    const syncClosed = exactDirectoryBinding(sync.plan.inventorySet, "CLOSED");
    const syncRequestGolden = assertFullRequestPlanGolden(sync.plan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(
          lifetimeReplayArguments(sync.owner),
        ),
        generationManifest: sync.journal.generationManifest,
        normalJournalBundles: array(...sync.journal.normalJournalBundles),
        recoveryTarget: sync.closeDecision.recoveryTarget,
        recoveryInventory: sync.closeDecision.recoveryInventory,
        recoveryReplay: sync.closeDecision.recoveryReplay,
        recoveryPlan: sync.closeDecision.recoveryPlan,
      },
      request: {
        token: sync.plan.inventorySet,
        managerActorEpochSha256: digest("move-sync-only:manager-actor-epoch"),
        requestSequence: sync.requestSequence,
        operation: "MOVE_SYNC_REOBSERVE",
        writerKind: "SERVICE_MANAGER",
        actorKind: "LIVE_BIRTH_GUARDIAN",
        targetSha256: sync.closeDecision.recoveryTarget.targetSha256,
        requiredDurableRecordType: "CLOSED_DURABLE",
        requiredOutcomeRecordType: "NORMAL_CLOSE_RECEIPT_DURABLE",
        directoryRoleA: "ACTIVE",
        directoryIdentitySha256A: syncActive.identitySha256,
        directoryHandleSha256A: syncActive.handleSha256,
        directoryRoleB: "CLOSED",
        directoryIdentitySha256B: syncClosed.identitySha256,
        directoryHandleSha256B: syncClosed.handleSha256,
        nameA: sync.generationName,
        nameB: sync.generationName,
        authorizationRawSha256: sync.journal.normalJournalBundles[17].rawSha256,
        expectedOutcome: "MOVE_SYNC_COMPLETED",
      },
    });
    const syncResult = completeMutationResult(sync.plan.request, {
      observations: array(
        nativeObservation({
          kind: "ABSENT",
          role: "ACTIVE",
          name: sync.generationName,
          deviceMajor: "0",
          deviceMinor: "0",
          inode: "0",
          mountId: "0",
          byteLength: "0",
          linkCount: "0",
          mode: 0,
          ownerUid: 0,
          ownerGid: 0,
          filesystemMagic: "0",
        }),
        nativeObservation({
          kind: "DIRECTORY",
          role: "CLOSED",
          name: sync.generationName,
          inode: "500",
        }),
      ),
    });
    const syncReceipt = dispatchPlan(sync.module, sync.plan, syncResult);
    assert.equal(syncReceipt.outcome, "MOVE_SYNC_COMPLETED");
    assert.equal(syncReceipt.retryDisposition, "NO_RETRY");
    assertFullReceiptGolden(syncReceipt, syncResult, syncRequestGolden, {
      outcome: "MOVE_SYNC_COMPLETED",
      retryDisposition: "NO_RETRY",
    });
    assertExactDigests(sync.plan, syncReceipt);

    const syncUncertain = await moveScenario({
      label: "move-sync-uncertain",
      bundleCount: 18,
      sourcePresent: false,
      destinationPresent: true,
    });
    const syncUncertainResult = completeMutationResult(
      syncUncertain.plan.request,
      {
        status: "FAULT_INJECTED",
        effectClass: "EFFECT_UNCERTAIN",
        lastCompletedStep: "NONE",
        failedStep: "REQUEST_VALIDATED",
        errno: 5,
        completedStepCount: 0,
        observations: array(),
      },
    );
    const syncUncertainReceipt = dispatchPlan(
      syncUncertain.module,
      syncUncertain.plan,
      syncUncertainResult,
    );
    assert.equal(syncUncertainReceipt.outcome, "FAILED_EFFECT_UNCERTAIN");
    assert.equal(syncUncertainReceipt.retryDisposition, "NO_RETRY");
    assert.equal(syncUncertainReceipt.inventorySet, null);
    assertExactDigests(syncUncertain.plan, syncUncertainReceipt);

    const already = await moveScenario({
      label: "destination-already",
      bundleCount: 18,
      sourcePresent: false,
      destinationPresent: true,
      normalCloseDurable: true,
    });
    assert.notEqual(already.closeDecision.normalCloseDurabilityReceipt, null);
    assert.equal(already.plan.request.operation, "MOVE_NOREPLACE_SYNC");
    assert.equal(already.plan.request.executionDisposition, "OBSERVATION_ONLY");
    assert.equal(
      already.plan.request.expectedOutcome,
      "DESTINATION_ALREADY_PRESENT_EXACT",
    );
    const alreadyActive = exactDirectoryBinding(
      already.plan.inventorySet,
      "ACTIVE",
    );
    const alreadyClosed = exactDirectoryBinding(
      already.plan.inventorySet,
      "CLOSED",
    );
    const destinationAlreadyRequestGolden = assertFullRequestPlanGolden(
      already.plan,
      {
        ownerContext: {
          lifetimeReplay: replayLifetimeIndependently(
            lifetimeReplayArguments(already.owner),
          ),
          generationManifest: already.journal.generationManifest,
          normalJournalBundles: array(...already.journal.normalJournalBundles),
          recoveryTarget: already.closeDecision.recoveryTarget,
          recoveryInventory: already.closeDecision.recoveryInventory,
          recoveryReplay: already.closeDecision.recoveryReplay,
          recoveryPlan: already.closeDecision.recoveryPlan,
        },
        request: {
          token: already.plan.inventorySet,
          managerActorEpochSha256: digest(
            "destination-already:manager-actor-epoch",
          ),
          requestSequence: already.requestSequence,
          operation: "MOVE_NOREPLACE_SYNC",
          executionDisposition: "OBSERVATION_ONLY",
          writerKind: "SERVICE_MANAGER",
          actorKind: "LIVE_BIRTH_GUARDIAN",
          targetSha256: already.closeDecision.recoveryTarget.targetSha256,
          requiredDurableRecordType: "CLOSED_DURABLE",
          requiredOutcomeRecordType: "NORMAL_CLOSE_RECEIPT_DURABLE",
          directoryRoleA: "ACTIVE",
          directoryIdentitySha256A: alreadyActive.identitySha256,
          directoryHandleSha256A: alreadyActive.handleSha256,
          directoryRoleB: "CLOSED",
          directoryIdentitySha256B: alreadyClosed.identitySha256,
          directoryHandleSha256B: alreadyClosed.handleSha256,
          nameA: already.generationName,
          nameB: already.generationName,
          authorizationRawSha256:
            already.journal.normalJournalBundles[17].rawSha256,
          expectedOutcome: "DESTINATION_ALREADY_PRESENT_EXACT",
        },
      },
    );
    const alreadyReceipt = dispatchPlan(already.module, already.plan, null);
    assert.equal(alreadyReceipt.outcome, "DESTINATION_ALREADY_PRESENT_EXACT");
    assert.equal(alreadyReceipt.retryDisposition, "NO_RETRY");
    assertFullReceiptGolden(
      alreadyReceipt,
      null,
      destinationAlreadyRequestGolden,
      {
        outcome: "DESTINATION_ALREADY_PRESENT_EXACT",
        retryDisposition: "NO_RETRY",
      },
    );
    assertExactDigests(already.plan, alreadyReceipt);
  },
);

test(
  "durable journal ownership selects TEMP_CLEANUP and TEMP_ALREADY_ABSENT from the exact deterministic temporary",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const label = "temporary-cleanup";
    const module = await freshStatefs(`${label}-issued`);
    const journal = ownerFixtures.createJournalStack(label, 18);
    const tree = await normalJournalToken(module, {
      label,
      journal,
      bundleCount: 17,
    });
    const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
    const owner = createAdoptedLifetimeOwner({
      label,
      root: tree.root,
      managerActorEpochSha256,
      journal,
    });
    const finalBundle = journal.normalJournalBundles[17];
    const absent = completeRegularInventory(module, {
      label,
      sequence: 5,
      token: tree.token,
      role: "NORMAL_JOURNAL",
      name: finalBundle.name,
    });
    const persistPlan =
      module.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label,
          managerActorEpochSha256,
          sequence: 6,
          token: absent.receipt.inventorySet,
          lifetimeReplayArguments: lifetimeReplayArguments(owner),
          generationManifest: artifact(journal.generationManifest),
          normalJournalBundles: journalArtifactList(journal, 17),
          artifactBytes: finalBundle.bytes,
        }),
      );
    const journalParent = exactDirectoryBinding(
      absent.receipt.inventorySet,
      "NORMAL_JOURNAL",
    );
    const issuedPersistRequestGolden = assertFullRequestPlanGolden(
      persistPlan,
      {
        ownerContext: {
          lifetimeReplay: replayLifetimeIndependently(
            lifetimeReplayArguments(owner),
          ),
          generationManifest: journal.generationManifest,
          normalJournalBundles: array(
            ...journal.normalJournalBundles.slice(0, 17),
          ),
        },
        request: {
          token: absent.receipt.inventorySet,
          managerActorEpochSha256,
          requestSequence: 6,
          operation: "PERSIST_NOREPLACE",
          writerKind: "LIVE_BIRTH_GUARDIAN",
          actorKind: "LIVE_BIRTH_GUARDIAN",
          targetSha256: journal.generationIdentity.identitySha256,
          requiredDurableRecordType:
            journal.normalJournalBundles[16].recordType,
          requiredOutcomeRecordType: null,
          directoryRoleA: "NORMAL_JOURNAL",
          directoryIdentitySha256A: journalParent.identitySha256,
          directoryHandleSha256A: journalParent.handleSha256,
          nameB: finalBundle.name,
          bytes: finalBundle.bytes,
          authorizationRawSha256: journal.normalJournalBundles[16].rawSha256,
          expectedOutcome: "PERSISTED",
        },
      },
    );
    assert.equal(persistPlan.request.operation, "PERSIST_NOREPLACE");
    const temporaryName = persistPlan.request.nameA;
    assert.match(
      temporaryName,
      /^\.(?:generation\.jsonl|[0-9]{16}-[0-9a-f]{64}\.jsonl)\.tmp-[0-9a-f]{64}$/u,
    );
    const residueResult = completeMutationResult(persistPlan.request, {
      status: "FAULT_INJECTED",
      effectClass: "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
      lastCompletedStep: "TEMP_CREATED",
      failedStep: "NONE",
      errno: 5,
      completedStepCount: 3,
      bytesConsumed: 0,
      observations: array(),
    });
    const residueReceipt = dispatchPlan(module, persistPlan, residueResult);
    assert.equal(residueReceipt.outcome, "FAILED_MUTATION_NOT_FULLY_SYNCED");
    assert.equal(residueReceipt.retryDisposition, "NO_RETRY");
    assert.equal(residueReceipt.inventorySet, null);
    assert.equal(residueReceipt.inventorySetSha256, null);
    assertFullReceiptGolden(
      residueReceipt,
      residueResult,
      issuedPersistRequestGolden,
      {
        outcome: "FAILED_MUTATION_NOT_FULLY_SYNCED",
        retryDisposition: "NO_RETRY",
      },
    );
    assertExactDigests(persistPlan, residueReceipt);

    const definiteModule = await freshStatefs(`${label}-persist-definite`);
    const definiteTree = await normalJournalToken(definiteModule, {
      label,
      journal,
      bundleCount: 17,
    });
    const definiteAbsent = completeRegularInventory(definiteModule, {
      label,
      sequence: 5,
      token: definiteTree.token,
      role: "NORMAL_JOURNAL",
      name: finalBundle.name,
    });
    const definitePlan =
      definiteModule.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label,
          managerActorEpochSha256,
          sequence: 6,
          token: definiteAbsent.receipt.inventorySet,
          lifetimeReplayArguments: lifetimeReplayArguments(owner),
          generationManifest: artifact(journal.generationManifest),
          normalJournalBundles: journalArtifactList(journal, 17),
          artifactBytes: finalBundle.bytes,
        }),
      );
    assert.equal(definitePlan.request.operation, "PERSIST_NOREPLACE");
    const definiteResult = completeMutationResult(definitePlan.request, {
      status: "FAULT_INJECTED",
      effectClass: "DEFINITE_NO_EFFECT",
      lastCompletedStep: "FD_A_VALIDATED",
      failedStep: "TEMP_CREATED",
      errno: 5,
      completedStepCount: 2,
      bytesConsumed: 0,
      observations: array(),
    });
    const definiteReceipt = dispatchPlan(
      definiteModule,
      definitePlan,
      definiteResult,
    );
    assert.equal(definiteReceipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.equal(
      definiteReceipt.retryDisposition,
      "REPLAN_AFTER_FRESH_INVENTORY",
    );
    assert.notEqual(definiteReceipt.inventorySet, null);
    assertExactDigests(definitePlan, definiteReceipt);

    async function cleanupScenario({ scenarioLabel, temporaryPresent }) {
      const cleanupModule = await freshStatefs(scenarioLabel);
      const temporaryEntry = record(
        ["kind", "REGULAR"],
        ["role", "NORMAL_JOURNAL"],
        ["name", temporaryName],
        ["inode", "799"],
        ["byteLength", String(finalBundle.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      );
      const cleanupTree = await normalJournalToken(cleanupModule, {
        label,
        journal,
        bundleCount: 18,
        extraEntries: temporaryPresent ? array(temporaryEntry) : array(),
      });
      const temporaryInventory = completeRegularInventory(cleanupModule, {
        label,
        sequence: 5,
        token: cleanupTree.token,
        role: "NORMAL_JOURNAL",
        name: temporaryName,
        bytes: temporaryPresent ? finalBundle.bytes : null,
        inode: "799",
      });
      const plan =
        cleanupModule.planCandidateContainmentGuardianStatefsOperationV1(
          autoInput({
            label,
            managerActorEpochSha256,
            sequence: 6,
            token: temporaryInventory.receipt.inventorySet,
            lifetimeReplayArguments: lifetimeReplayArguments(owner),
            generationManifest: artifact(journal.generationManifest),
            normalJournalBundles: journalArtifactList(journal, 18),
          }),
        );
      return {
        cleanupModule,
        token: temporaryInventory.receipt.inventorySet,
        plan,
      };
    }

    const cleanup = await cleanupScenario({
      scenarioLabel: `${label}-present`,
      temporaryPresent: true,
    });
    assert.equal(cleanup.plan.request.operation, "TEMP_CLEANUP");
    assert.equal(cleanup.plan.request.nameA, temporaryName);
    assert.equal(cleanup.plan.request.expectedOutcome, "TEMP_REMOVED");
    const cleanupParent = exactDirectoryBinding(
      cleanup.token,
      "NORMAL_JOURNAL",
    );
    const cleanupRequestGolden = assertFullRequestPlanGolden(cleanup.plan, {
      ownerContext: {
        lifetimeReplay: replayLifetimeIndependently(
          lifetimeReplayArguments(owner),
        ),
        generationManifest: journal.generationManifest,
        normalJournalBundles: array(...journal.normalJournalBundles),
      },
      request: {
        token: cleanup.token,
        managerActorEpochSha256,
        requestSequence: 6,
        operation: "TEMP_CLEANUP",
        writerKind: "LIVE_BIRTH_GUARDIAN",
        actorKind: "LIVE_BIRTH_GUARDIAN",
        targetSha256: journal.generationIdentity.identitySha256,
        requiredDurableRecordType: "CLOSED_DURABLE",
        requiredOutcomeRecordType: null,
        directoryRoleA: "NORMAL_JOURNAL",
        directoryIdentitySha256A: cleanupParent.identitySha256,
        directoryHandleSha256A: cleanupParent.handleSha256,
        nameA: temporaryName,
        authorizationRawSha256: finalBundle.rawSha256,
        expectedOutcome: "TEMP_REMOVED",
      },
    });
    const cleanupResult = completeMutationResult(cleanup.plan.request, {
      observations: array(
        nativeObservation({
          kind: "ABSENT",
          role: "NORMAL_JOURNAL",
          name: temporaryName,
          deviceMajor: "0",
          deviceMinor: "0",
          inode: "0",
          mountId: "0",
          byteLength: "0",
          linkCount: "0",
          mode: 0,
          ownerUid: 0,
          ownerGid: 0,
          filesystemMagic: "0",
        }),
      ),
    });
    const cleanupReceipt = dispatchPlan(
      cleanup.cleanupModule,
      cleanup.plan,
      cleanupResult,
    );
    assert.equal(cleanupReceipt.outcome, "TEMP_REMOVED");
    assert.equal(cleanupReceipt.inventories.length, 2);
    assert.equal(cleanupReceipt.retryDisposition, "NO_RETRY");
    assertFullReceiptGolden(
      cleanupReceipt,
      cleanupResult,
      cleanupRequestGolden,
      {
        outcome: "TEMP_REMOVED",
        retryDisposition: "NO_RETRY",
      },
    );
    assertExactDigests(cleanup.plan, cleanupReceipt);

    const cleanupDefinite = await cleanupScenario({
      scenarioLabel: `${label}-cleanup-definite`,
      temporaryPresent: true,
    });
    const cleanupDefiniteResult = completeMutationResult(
      cleanupDefinite.plan.request,
      {
        status: "FAULT_INJECTED",
        effectClass: "DEFINITE_NO_EFFECT",
        lastCompletedStep: "SOURCE_REOBSERVED",
        failedStep: "TEMP_UNLINKED",
        errno: 5,
        completedStepCount: 3,
        observations: array(),
      },
    );
    const cleanupDefiniteReceipt = dispatchPlan(
      cleanupDefinite.cleanupModule,
      cleanupDefinite.plan,
      cleanupDefiniteResult,
    );
    assert.equal(cleanupDefiniteReceipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.equal(
      cleanupDefiniteReceipt.retryDisposition,
      "REPLAN_AFTER_FRESH_INVENTORY",
    );
    assert.notEqual(cleanupDefiniteReceipt.inventorySet, null);
    assertExactDigests(cleanupDefinite.plan, cleanupDefiniteReceipt);

    const absentCleanup = await cleanupScenario({
      scenarioLabel: `${label}-absent`,
      temporaryPresent: false,
    });
    assert.equal(absentCleanup.plan.request.operation, "TEMP_CLEANUP");
    assert.equal(
      absentCleanup.plan.request.executionDisposition,
      "OBSERVATION_ONLY",
    );
    assert.equal(
      absentCleanup.plan.request.expectedOutcome,
      "TEMP_ALREADY_ABSENT",
    );
    const absentCleanupParent = exactDirectoryBinding(
      absentCleanup.token,
      "NORMAL_JOURNAL",
    );
    const absentCleanupRequestGolden = assertFullRequestPlanGolden(
      absentCleanup.plan,
      {
        ownerContext: {
          lifetimeReplay: replayLifetimeIndependently(
            lifetimeReplayArguments(owner),
          ),
          generationManifest: journal.generationManifest,
          normalJournalBundles: array(...journal.normalJournalBundles),
        },
        request: {
          token: absentCleanup.token,
          managerActorEpochSha256,
          requestSequence: 6,
          operation: "TEMP_CLEANUP",
          executionDisposition: "OBSERVATION_ONLY",
          writerKind: "LIVE_BIRTH_GUARDIAN",
          actorKind: "LIVE_BIRTH_GUARDIAN",
          targetSha256: journal.generationIdentity.identitySha256,
          requiredDurableRecordType: "CLOSED_DURABLE",
          requiredOutcomeRecordType: null,
          directoryRoleA: "NORMAL_JOURNAL",
          directoryIdentitySha256A: absentCleanupParent.identitySha256,
          directoryHandleSha256A: absentCleanupParent.handleSha256,
          nameA: temporaryName,
          authorizationRawSha256: finalBundle.rawSha256,
          expectedOutcome: "TEMP_ALREADY_ABSENT",
        },
      },
    );
    const absentReceipt = dispatchPlan(
      absentCleanup.cleanupModule,
      absentCleanup.plan,
      null,
    );
    assert.equal(absentReceipt.status, "OBSERVATION_ONLY");
    assert.equal(absentReceipt.outcome, "TEMP_ALREADY_ABSENT");
    assert.equal(absentReceipt.retryDisposition, "NO_RETRY");
    assertFullReceiptGolden(absentReceipt, null, absentCleanupRequestGolden, {
      outcome: "TEMP_ALREADY_ABSENT",
      retryDisposition: "NO_RETRY",
    });
    assertExactDigests(absentCleanup.plan, absentReceipt);
  },
);

test(
  "retry, semantic inventory rejection, LIMIT, mutation residue, and uncertain effects have exact successor rules",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const definiteModule = await freshStatefs("retry-definite");
    const label = "retry-definite";
    const lock = completeLock(definiteModule, { label });
    const plan = planDirectoryInventory(definiteModule, {
      label,
      sequence: 1,
      token: lock.receipt.inventorySet,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    const fault = executorResult(plan.request, {
      status: "FAULT_INJECTED",
      effectClass: "DEFINITE_NO_EFFECT",
      lastCompletedStep: "NONE",
      failedStep: "REQUEST_VALIDATED",
      errno: 5,
      completedStepCount: 0,
      observations: array(),
    });
    const root = heldDirectoryObservation();
    const retryRequestGolden = assertFullRequestPlanGolden(plan, {
      ownerContext: {},
      request: {
        token: lock.receipt.inventorySet,
        managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
        requestSequence: 1,
        operation: "INVENTORY",
        writerKind: "SERVICE_MANAGER",
        inventoryKind: "DIRECTORY",
        inventoryDirectoryRole: "STATE_ROOT",
        directoryRoleA: "STATE_ROOT",
        directoryIdentitySha256A: root.identitySha256,
        directoryHandleSha256A: directoryHandleSha256({
          managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
          role: "STATE_ROOT",
          identitySha256: root.identitySha256,
          parentDirectoryHandleSha256: null,
          name: null,
        }),
        expectedOutcome: "INVENTORY_OBSERVED",
      },
    });
    const retryReceipt = dispatchPlan(definiteModule, plan, fault);
    assert.equal(retryReceipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.equal(retryReceipt.retryDisposition, "REPLAN_AFTER_FRESH_INVENTORY");
    assert.notEqual(retryReceipt.inventorySet, null);
    assert.equal(
      retryReceipt.inventorySet.inventorySetSha256,
      lock.receipt.inventorySet.inventorySetSha256,
    );
    assertFullReceiptGolden(retryReceipt, fault, retryRequestGolden, {
      outcome: "FAILED_DEFINITE_NO_EFFECT",
      retryDisposition: "REPLAN_AFTER_FRESH_INVENTORY",
    });
    assertExactDigests(plan, retryReceipt);

    const unsafeModule = await freshStatefs("unsafe-inventory");
    const unsafeLock = completeLock(unsafeModule, {
      label: "unsafe-inventory",
    });
    const unsafePlan = planDirectoryInventory(unsafeModule, {
      label: "unsafe-inventory",
      sequence: 1,
      token: unsafeLock.receipt.inventorySet,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    const unsafeResult = executorResult(unsafePlan.request, {
      lastCompletedStep: "INVENTORY_DESCRIPTOR_CLOSED",
      completedStepCount: 5,
      observations: directoryNativeObservations({
        targetRole: "STATE_ROOT",
        targetInode: "100",
        entries: [],
      }),
    });
    const unsafeRoot = heldDirectoryObservation();
    const unsafeRequestGolden = assertFullRequestPlanGolden(unsafePlan, {
      ownerContext: {},
      request: {
        token: unsafeLock.receipt.inventorySet,
        managerActorEpochSha256: digest("unsafe-inventory:manager-actor-epoch"),
        requestSequence: 1,
        operation: "INVENTORY",
        writerKind: "SERVICE_MANAGER",
        inventoryKind: "DIRECTORY",
        inventoryDirectoryRole: "STATE_ROOT",
        directoryRoleA: "STATE_ROOT",
        directoryIdentitySha256A: unsafeRoot.identitySha256,
        directoryHandleSha256A: directoryHandleSha256({
          managerActorEpochSha256: digest(
            "unsafe-inventory:manager-actor-epoch",
          ),
          role: "STATE_ROOT",
          identitySha256: unsafeRoot.identitySha256,
          parentDirectoryHandleSha256: null,
          name: null,
        }),
        expectedOutcome: "INVENTORY_OBSERVED",
      },
    });
    const unsafeReceipt = dispatchPlan(unsafeModule, unsafePlan, unsafeResult);
    assert.equal(unsafeReceipt.status, "REJECTED");
    assert.equal(unsafeReceipt.effectClass, "DEFINITE_NO_EFFECT");
    assert.equal(unsafeReceipt.outcome, "REJECTED");
    assert.equal(unsafeReceipt.retryDisposition, "NO_RETRY");
    assert.equal(unsafeReceipt.inventories.length, 1);
    assert.equal(unsafeReceipt.inventorySet, null);
    assert.equal(unsafeReceipt.inventorySetSha256, null);
    assertFullReceiptGolden(unsafeReceipt, unsafeResult, unsafeRequestGolden, {
      status: "REJECTED",
      effectClass: "DEFINITE_NO_EFFECT",
      outcome: "REJECTED",
      retryDisposition: "NO_RETRY",
    });
    assertExactDigests(unsafePlan, unsafeReceipt);

    const limitModule = await freshStatefs("native-limit");
    const limitLock = completeLock(limitModule, { label: "native-limit" });
    const limitPlan = planDirectoryInventory(limitModule, {
      label: "native-limit",
      sequence: 1,
      token: limitLock.receipt.inventorySet,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    const limitResult = executorResult(limitPlan.request, {
      status: "LIMIT_EXCEEDED",
      effectClass: "NO_EFFECT",
      lastCompletedStep: "NONE",
      failedStep: "REQUEST_VALIDATED",
      completedStepCount: 0,
      observations: array(),
    });
    const limitRoot = heldDirectoryObservation();
    const limitRequestGolden = assertFullRequestPlanGolden(limitPlan, {
      ownerContext: {},
      request: {
        token: limitLock.receipt.inventorySet,
        managerActorEpochSha256: digest("native-limit:manager-actor-epoch"),
        requestSequence: 1,
        operation: "INVENTORY",
        writerKind: "SERVICE_MANAGER",
        inventoryKind: "DIRECTORY",
        inventoryDirectoryRole: "STATE_ROOT",
        directoryRoleA: "STATE_ROOT",
        directoryIdentitySha256A: limitRoot.identitySha256,
        directoryHandleSha256A: directoryHandleSha256({
          managerActorEpochSha256: digest("native-limit:manager-actor-epoch"),
          role: "STATE_ROOT",
          identitySha256: limitRoot.identitySha256,
          parentDirectoryHandleSha256: null,
          name: null,
        }),
        expectedOutcome: "INVENTORY_OBSERVED",
      },
    });
    const limitReceipt = dispatchPlan(limitModule, limitPlan, limitResult);
    assert.equal(limitReceipt.status, "LIMIT_EXCEEDED");
    assert.equal(limitReceipt.effectClass, "NO_EFFECT");
    assert.equal(limitReceipt.outcome, "REJECTED");
    assert.equal(limitReceipt.retryDisposition, "NO_RETRY");
    assert.deepEqual(limitReceipt.inventories, []);
    assert.equal(limitReceipt.inventorySet, null);
    assertFullReceiptGolden(limitReceipt, limitResult, limitRequestGolden, {
      outcome: "REJECTED",
      retryDisposition: "NO_RETRY",
    });
    assertExactDigests(limitPlan, limitReceipt);

    for (const branch of [
      array(
        "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
        "FAILED_MUTATION_NOT_FULLY_SYNCED",
        "TEMP_CREATED",
      ),
      array("EFFECT_UNCERTAIN", "FAILED_EFFECT_UNCERTAIN", "PARENT_SYNCED"),
    ]) {
      const branchModule = await freshStatefs(`terminal-${branch[0]}`);
      const branchLock = completeLock(branchModule, {
        label: `terminal-${branch[0]}`,
      });
      const branchPlan = planDirectoryInventory(branchModule, {
        label: `terminal-${branch[0]}`,
        sequence: 1,
        token: branchLock.receipt.inventorySet,
        role: "STATE_ROOT",
        parentRole: "STATE_ROOT",
      });
      const impossibleForInventory = executorResult(branchPlan.request, {
        status: "FAULT_INJECTED",
        effectClass: branch[0],
        lastCompletedStep: branch[2],
        failedStep: "NONE",
        errno: 5,
        completedStepCount: 1,
        observations: array(),
      });
      expectCode(
        () => dispatchPlan(branchModule, branchPlan, impossibleForInventory),
        "STATEFS_RESULT",
      );
    }
  },
);

test(
  "lock contention and release definite-no-effect are terminal while the same effect retries eligible operations",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const lockModule = await freshStatefs("lock-contended");
    const lockPlan = planLock(lockModule, { label: "lock-contended" });
    const contended = executorResult(lockPlan.request, {
      status: "SYSCALL_FAILED",
      effectClass: "DEFINITE_NO_EFFECT",
      lastCompletedStep: "FD_A_VALIDATED",
      failedStep: "LOCK_ACQUIRED",
      errno: 11,
      completedStepCount: 2,
      observations: array(nativeObservation()),
    });
    const lockRoot = heldDirectoryObservation();
    const lockRequestGolden = assertFullRequestPlanGolden(lockPlan, {
      ownerContext: {},
      request: {
        managerActorEpochSha256: digest("lock-contended:manager-actor-epoch"),
        requestSequence: 0,
        operation: "LOCK_EX_NB",
        writerKind: "SERVICE_MANAGER",
        directoryRoleA: "STATE_ROOT",
        directoryIdentitySha256A: lockRoot.identitySha256,
        directoryHandleSha256A: directoryHandleSha256({
          managerActorEpochSha256: digest("lock-contended:manager-actor-epoch"),
          role: "STATE_ROOT",
          identitySha256: lockRoot.identitySha256,
          parentDirectoryHandleSha256: null,
          name: null,
        }),
        expectedOutcome: "LOCK_HELD",
      },
    });
    const lockReceipt = dispatchPlan(lockModule, lockPlan, contended);
    assert.equal(lockReceipt.outcome, "LOCK_CONTENDED");
    assert.equal(lockReceipt.retryDisposition, "NO_RETRY");
    assert.equal(lockReceipt.inventorySet, null);
    assert.equal(lockReceipt.inventorySetSha256, null);
    assertFullReceiptGolden(lockReceipt, contended, lockRequestGolden, {
      outcome: "LOCK_CONTENDED",
      retryDisposition: "NO_RETRY",
    });
    assertExactDigests(lockPlan, lockReceipt);

    const label = "release-definite";
    const releaseModule = await freshStatefs(label);
    const tree = await rootAndLifecycleToken(releaseModule, { label });
    const releasePlan =
      releaseModule.planCandidateContainmentGuardianStatefsOperationV1(
        plannerInput({
          kind: "RELEASE_DIRECTORY",
          managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
          requestSequence: 3,
          inventorySetSha256: tree.token.inventorySetSha256,
          stateRootObservation: null,
          currentInventorySet: tree.token,
          inventoryDirectoryRole: null,
          directoryRoleA: "LIFETIMES",
          expectedOutcome: "DIRECTORY_RELEASED",
        }),
      );
    const releaseFailure = completeMutationResult(releasePlan.request, {
      status: "FAULT_INJECTED",
      effectClass: "DEFINITE_NO_EFFECT",
      lastCompletedStep: "FD_A_VALIDATED",
      failedStep: "DIRECTORY_RELEASED",
      errno: 5,
      completedStepCount: 2,
      observations: array(),
    });
    const releaseBinding = exactDirectoryBinding(tree.token, "LIFETIMES");
    const releaseRequestGolden = assertFullRequestPlanGolden(releasePlan, {
      ownerContext: {},
      request: {
        token: tree.token,
        managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
        requestSequence: 3,
        operation: "RELEASE_DIRECTORY",
        writerKind: "SERVICE_MANAGER",
        directoryRoleA: "LIFETIMES",
        directoryIdentitySha256A: releaseBinding.identitySha256,
        directoryHandleSha256A: releaseBinding.handleSha256,
        expectedOutcome: "DIRECTORY_RELEASED",
      },
    });
    const releaseReceipt = dispatchPlan(
      releaseModule,
      releasePlan,
      releaseFailure,
    );
    assert.equal(releaseReceipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.equal(releaseReceipt.retryDisposition, "NO_RETRY");
    assert.equal(releaseReceipt.inventorySet, null);
    assert.equal(releaseReceipt.inventorySetSha256, null);
    assertFullReceiptGolden(
      releaseReceipt,
      releaseFailure,
      releaseRequestGolden,
      {
        outcome: "FAILED_DEFINITE_NO_EFFECT",
        retryDisposition: "NO_RETRY",
      },
    );
    assertExactDigests(releasePlan, releaseReceipt);
  },
);

test(
  "request dispatch is required before result verification and failed verification does not dispatch",
  CANDIDATE_TEST_OPTIONS,
  () => {
    const plan = statefs.planCandidateContainmentGuardianStatefsOperationV1(
      plannerInput({ requestSequence: 1 }),
    );
    statefs.assertCandidateContainmentGuardianStatefsPlanV1(plan);
    expectCode(
      () =>
        statefs.verifyCandidateContainmentGuardianStatefsResultV1({
          request: plan.request,
          executorResult: executorResult(plan.request),
        }),
      "STATEFS_BINDING",
    );
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsRequestV1(plan.request),
      true,
    );
    const malformed = { ...executorResult(plan.request) };
    malformed.operation = "INVENTORY";
    expectCode(
      () =>
        statefs.verifyCandidateContainmentGuardianStatefsResultV1({
          request: plan.request,
          executorResult: malformed,
        }),
      "STATEFS_RESULT",
    );
    expectCode(
      () =>
        statefs.verifyCandidateContainmentGuardianStatefsResultV1({
          request: plan.request,
          executorResult: executorResult(plan.request),
        }),
      "STATEFS_BINDING",
    );
  },
);

test(
  "request brand is consumed before any hostile result access and token reservation is atomic",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const module = await freshStatefs("first-access");
    const label = "first-access";
    const unasserted = planLock(module, { label, sequence: 0 });
    module.assertCandidateContainmentGuardianStatefsPlanV1(unasserted);
    let unassertedTraps = 0;
    const hostileBeforeDispatch = new Proxy(Object.create(null), {
      get() {
        unassertedTraps += 1;
        throw new Error("unasserted executor result was touched");
      },
      getOwnPropertyDescriptor() {
        unassertedTraps += 1;
        throw new Error("unasserted executor result was inspected");
      },
      ownKeys() {
        unassertedTraps += 1;
        throw new Error("unasserted executor result was enumerated");
      },
    });
    expectCode(
      () =>
        module.verifyCandidateContainmentGuardianStatefsResultV1({
          request: unasserted.request,
          executorResult: hostileBeforeDispatch,
        }),
      "STATEFS_BINDING",
    );
    assert.equal(unassertedTraps, 0);

    assert.equal(
      module.assertCandidateContainmentGuardianStatefsRequestV1(
        unasserted.request,
      ),
      true,
    );
    let dispatchedTraps = 0;
    const hostileAfterDispatch = new Proxy(Object.create(null), {
      get() {
        dispatchedTraps += 1;
        throw new Error("dispatched executor result trap");
      },
      getOwnPropertyDescriptor() {
        dispatchedTraps += 1;
        throw new Error("dispatched executor result descriptor trap");
      },
      ownKeys() {
        dispatchedTraps += 1;
        throw new Error("dispatched executor result ownKeys trap");
      },
    });
    assert.throws(() =>
      module.verifyCandidateContainmentGuardianStatefsResultV1({
        request: unasserted.request,
        executorResult: hostileAfterDispatch,
      }),
    );
    assert.equal(
      dispatchedTraps,
      0,
      "exactRecord may reject a Proxy without invoking its traps",
    );
    expectCode(
      () =>
        module.verifyCandidateContainmentGuardianStatefsResultV1({
          request: unasserted.request,
          executorResult: executorResult(unasserted.request),
        }),
      "STATEFS_BINDING",
    );

    const lock = completeLock(module, { label, sequence: 1 });
    const token = lock.receipt.inventorySet;
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1(
          inventoryInput({
            label,
            sequence: 1_000_000,
            token,
            inventoryDirectoryRole: "STATE_ROOT",
            directoryRoleA: "STATE_ROOT",
          }),
        ),
      "STATEFS_BOUNDS",
    );
    const reserved = planDirectoryInventory(module, {
      label,
      sequence: 2,
      token,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    expectCode(
      () =>
        planDirectoryInventory(module, {
          label,
          sequence: 2,
          token,
          role: "STATE_ROOT",
          parentRole: "STATE_ROOT",
        }),
      "STATEFS_BINDING",
    );
    expectCode(
      () =>
        planDirectoryInventory(module, {
          label,
          sequence: 2,
          token: { ...token },
          role: "STATE_ROOT",
          parentRole: "STATE_ROOT",
        }),
      "STATEFS_BINDING",
    );
    module.assertCandidateContainmentGuardianStatefsPlanV1(reserved);
    module.assertCandidateContainmentGuardianStatefsRequestV1(reserved.request);
    const receipt = module.verifyCandidateContainmentGuardianStatefsResultV1({
      request: reserved.request,
      executorResult: executorResult(reserved.request, {
        status: "FAULT_INJECTED",
        effectClass: "DEFINITE_NO_EFFECT",
        lastCompletedStep: "NONE",
        failedStep: "REQUEST_VALIDATED",
        errno: 5,
        completedStepCount: 0,
        observations: array(),
      }),
    });
    assert.equal(receipt.retryDisposition, "REPLAN_AFTER_FRESH_INVENTORY");
  },
);

test(
  "plan and request brands do not cross separately evaluated module instances",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const other = await import(
      `${SOURCE_URL.href}?statefs-v1-origin=independent-evaluator`
    );
    const foreignPlan =
      other.planCandidateContainmentGuardianStatefsOperationV1(
        plannerInput({ requestSequence: 2 }),
      );
    expectCode(
      () =>
        statefs.assertCandidateContainmentGuardianStatefsPlanV1(foreignPlan),
      "STATEFS_BINDING",
    );
    expectCode(
      () =>
        statefs.assertCandidateContainmentGuardianStatefsRequestV1(
          foreignPlan.request,
        ),
      "STATEFS_BINDING",
    );
  },
);

test(
  "adjacent conflicting invalidities freeze the complete cross-surface error precedence",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const label = "error-precedence";
    const module = await freshStatefs(label);
    const foreignModule = await freshStatefs(`${label}-foreign`);
    const localLock = completeLock(module, { label });
    const foreignLock = completeLock(foreignModule, { label });
    const localToken = localLock.receipt.inventorySet;
    const foreignToken = foreignLock.receipt.inventorySet;
    const validRootInventory = inventoryInput({
      label,
      sequence: 1,
      token: localToken,
      inventoryDirectoryRole: "STATE_ROOT",
      directoryRoleA: "STATE_ROOT",
    });
    const foreignRootInventory = inventoryInput({
      label,
      sequence: 1,
      token: foreignToken,
      inventoryDirectoryRole: "STATE_ROOT",
      directoryRoleA: "STATE_ROOT",
    });
    const invalidManifest = record(
      ["name", "generation.jsonl"],
      ["bytes", Buffer.from("{}\n", "utf8")],
    );
    const emptyLifetimeReplayArguments = record(
      ["segments", array()],
      [
        "expectedStateRootIdentitySha256",
        heldDirectoryObservation().identitySha256,
      ],
      ["expectedLatestLifetimeEpochSha256", null],
      ["expectedLatestRecordSequence", null],
      ["expectedLatestRecordRawSha256", null],
    );

    // Planner surface: RESULT is irrelevant, so REQUEST compares directly to
    // TRANSITION after every earlier adjacent pair has been forced to conflict.
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1({
          ...plannerInput({ requestSequence: 1_000_000 }),
          extra: null,
        }),
      "STATEFS_BOUNDS",
    );
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1({
          ...plannerInput({ managerActorEpochSha256: "A".repeat(64) }),
          extra: null,
        }),
      "STATEFS_SHAPE",
    );
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1(
          plannerInput({
            kind: "AUTO",
            managerActorEpochSha256: "A".repeat(64),
            requestSequence: 1,
            inventorySetSha256: localToken.inventorySetSha256,
            stateRootObservation: null,
            currentInventorySet: localToken,
            generationManifest: invalidManifest,
            lifetimeReplayArguments: emptyLifetimeReplayArguments,
            expectedOutcome: null,
          }),
        ),
      "STATEFS_GRAMMAR",
    );
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1(
          plannerInput({
            kind: "AUTO",
            managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
            requestSequence: 1,
            inventorySetSha256: foreignToken.inventorySetSha256,
            stateRootObservation: null,
            currentInventorySet: foreignToken,
            generationManifest: invalidManifest,
            lifetimeReplayArguments: emptyLifetimeReplayArguments,
            expectedOutcome: null,
          }),
        ),
      "STATEFS_PREDECESSOR",
    );
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1(
          record(
            ...PLANNER_INPUT_FIELDS.map((key) => [
              key,
              key === "artifactBytes"
                ? Buffer.from("forbidden inventory artifact", "utf8")
                : foreignRootInventory[key],
            ]),
          ),
        ),
      "STATEFS_BINDING",
    );
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1(
          plannerInput({
            kind: "AUTO",
            managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
            requestSequence: 1,
            inventorySetSha256: localToken.inventorySetSha256,
            stateRootObservation: null,
            currentInventorySet: localToken,
            expectedOutcome: "LOCK_HELD",
          }),
        ),
      "STATEFS_REQUEST",
    );
    expectCode(
      () =>
        module.planCandidateContainmentGuardianStatefsOperationV1(
          plannerInput({
            kind: "AUTO",
            managerActorEpochSha256: digest(`${label}:manager-actor-epoch`),
            requestSequence: 1,
            inventorySetSha256: localToken.inventorySetSha256,
            stateRootObservation: null,
            currentInventorySet: localToken,
            expectedOutcome: null,
          }),
        ),
      "STATEFS_TRANSITION",
    );

    // Verifier surface: PREDECESSOR/REQUEST/TRANSITION are already fixed by the
    // branded request, so BINDING precedes RESULT and RESULT is the last relevant
    // category. A result failure still consumes the exact dispatched request.
    const resultPlan =
      module.planCandidateContainmentGuardianStatefsOperationV1(
        validRootInventory,
      );
    module.assertCandidateContainmentGuardianStatefsPlanV1(resultPlan);
    const impossibleResult = {
      ...executorResult(resultPlan.request),
      operation: "PERSIST_NOREPLACE",
    };
    expectCode(
      () =>
        module.verifyCandidateContainmentGuardianStatefsResultV1({
          request: { ...resultPlan.request },
          executorResult: impossibleResult,
        }),
      "STATEFS_BINDING",
    );
    assert.equal(
      module.assertCandidateContainmentGuardianStatefsRequestV1(
        resultPlan.request,
      ),
      true,
    );
    expectCode(
      () =>
        module.verifyCandidateContainmentGuardianStatefsResultV1({
          request: resultPlan.request,
          executorResult: impossibleResult,
        }),
      "STATEFS_RESULT",
    );
    expectCode(
      () =>
        module.verifyCandidateContainmentGuardianStatefsResultV1({
          request: resultPlan.request,
          executorResult: executorResult(resultPlan.request),
        }),
      "STATEFS_BINDING",
    );
  },
);

test(
  "recovery owner association preserves exact anchors and rejects before StateFS token reservation",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const requirementsReceipt =
      STATEFS_REFREEZE_IDENTITY.assertRequirementsInverseReceipt(
        STATEFS_REFREEZE_IDENTITY.requirementsInverseReceipt,
      );
    assert.deepEqual(requirementsReceipt, {
      schema:
        "oxigraph.test.candidate-containment-guardian-statefs-v1-requirements-inverse-receipt/v1",
      recoveryRequirementsDigestReversals: 1,
      guardianRequirementsDigestReversals: 1,
      selectorImportNameRemovals: 1,
      currentRequirementsCanonicalBytes: Buffer.byteLength(
        STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsCanonical,
        "utf8",
      ),
      currentRequirementsSha256:
        STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13RequirementsSha256,
      historicalRequirementsCanonicalBytes: Buffer.byteLength(
        canonicalJson(STATEFS_REFREEZE_IDENTITY.historicalRequirementsFixture),
        "utf8",
      ),
      historicalRequirementsSha256:
        "bc1da9d13e0483bb3fb6571cdce7c37af8abf1ebfa21dbe679a34f2b6c8889a0",
      sharedNonPrimitiveReferenceCount: 0,
    });
    const sourceReceipt = STATEFS_REFREEZE_IDENTITY.assertSourceInverseReceipt(
      STATEFS_REFREEZE_IDENTITY.sourceInverseReceipt,
    );
    assert.equal(sourceReceipt.identityBlockRemovals, 1);
    assert.equal(sourceReceipt.selectorActualImportBindingRemovals, 1);
    assert.equal(sourceReceipt.selectorImportInventoryRemovals, 1);
    assert.equal(sourceReceipt.novelTestRemovals, 1);
    assert.equal(sourceReceipt.literalReversalCount, 11);
    assert.equal(sourceReceipt.historicalEvaluatorBytes, 277_516);
    assert.equal(sourceReceipt.historicalEvaluatorLines, 8_274);
    assert.equal(
      sourceReceipt.historicalEvaluatorSha256,
      "7fb5aacb768078a96fda70d16d71d8846fa1e84a5141b6c5842d9e0a5066c78b",
    );
    assert.equal(
      sourceReceipt.historicalEvaluatorGitBlob,
      "58fcc8de666eb4c1d34878842bf179e2c6aa4dab",
    );
    assert.equal(sourceReceipt.historicalEvaluatorTestCount, 23);
    assert.equal(sourceReceipt.historicalCandidateSourceAbsent, true);

    const replanLabel = "recovery-owner-association-replan";
    const replanModule = await freshStatefs(replanLabel);
    const replanRoot = heldDirectoryObservation();
    const replanManager = digest(`${replanLabel}:manager-actor-epoch`);
    const replanJournal = ownerFixtures.createJournalStack(replanLabel, 5);
    const replanOwner = createAdoptedLifetimeOwner({
      label: replanLabel,
      root: replanRoot,
      managerActorEpochSha256: replanManager,
      journal: replanJournal,
    });
    const replanTuple = buildRecoveryReplanTuple(replanOwner, replanJournal);
    const replanTree = await observedLifetimeOwnerToken(replanModule, {
      label: replanLabel,
      owner: replanOwner,
    });
    const replanReplayArguments = lifetimeReplayArguments(replanOwner);
    const unbrandedReplan = record(...Object.entries(replanTuple.recoveryPlan));
    assert.deepEqual(unbrandedReplan, replanTuple.recoveryPlan);
    assert.notEqual(unbrandedReplan, replanTuple.recoveryPlan);
    assert.throws(
      () =>
        selectRecoveryOwnerAssociation({
          target: replanTuple.recoveryTarget,
          lifecycleInventoryObservation: replanTuple.recoveryInventory,
          previousRecoveryReplay: replanTuple.recoveryReplay,
          plan: unbrandedReplan,
          attempt: null,
        }),
      TypeError,
    );
    const replanInput = (recoveryPlan) =>
      autoInput({
        label: replanLabel,
        managerActorEpochSha256: replanManager,
        sequence: replanTree.sequence,
        token: replanTree.token,
        lifetimeReplayArguments: replanReplayArguments,
        generationManifest: artifact(replanJournal.generationManifest),
        normalJournalBundles: journalArtifactList(replanJournal),
        recoveryTarget: replanTuple.recoveryTarget,
        recoveryInventory: replanTuple.recoveryInventory,
        recoveryReplay: replanTuple.recoveryReplay,
        recoveryPlan,
      });
    expectCode(
      () =>
        replanModule.planCandidateContainmentGuardianStatefsOperationV1(
          replanInput(unbrandedReplan),
        ),
      "STATEFS_PREDECESSOR",
    );
    assert.equal(
      selectRecoveryOwnerAssociation({
        target: replanTuple.recoveryTarget,
        lifecycleInventoryObservation: replanTuple.recoveryInventory,
        previousRecoveryReplay: replanTuple.recoveryReplay,
        plan: replanTuple.recoveryPlan,
        attempt: null,
      }),
      null,
    );
    const exactReplan =
      replanModule.planCandidateContainmentGuardianStatefsOperationV1(
        replanInput(replanTuple.recoveryPlan),
      );
    assert.equal(exactReplan.planKind, "CONTEXT_ONLY");
    assert.equal(exactReplan.managerDisposition, "RECOVERY_REPLAN");
    assert.equal(exactReplan.request, null);
    assert.equal(exactReplan.inventorySet, replanTree.token);
    assert.equal(exactReplan.ownerContext.lifetimeAnchorProjection, null);
    assert.equal(exactReplan.ownerContext.lifetimeAttemptAnchorRawSha256, null);

    const requestLabel = "recovery-owner-association-request";
    const requestModule = await freshStatefs(requestLabel);
    const requestRoot = heldDirectoryObservation();
    const requestManager = digest(`${requestLabel}:manager-actor-epoch`);
    const requestJournal = ownerFixtures.createJournalStack(requestLabel, 5);
    const requestOwner = createAdoptedLifetimeOwner({
      label: requestLabel,
      root: requestRoot,
      managerActorEpochSha256: requestManager,
      journal: requestJournal,
    });
    const requestTuple = buildRecoveryOnlyAttemptTuple(
      requestOwner,
      requestJournal,
      { launchState: "ADOPTED" },
    );
    const rebuiltAttempt =
      recoveryOwner.verifyCandidateContainmentRecoveryAttemptV1({
        attempt: requestTuple.recoveryAttempt,
        target: requestTuple.recoveryTarget,
        lifecycleInventoryObservation: requestTuple.recoveryInventory,
        previousRecoveryReplay: requestTuple.recoveryReplay,
        plan: requestTuple.recoveryPlan,
        lifetimeAnchorProjection:
          requestTuple.anchorSelection.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          requestTuple.anchorSelection.lifetimeAttemptAnchorRawSha256,
      });
    assert.notEqual(rebuiltAttempt, requestTuple.recoveryAttempt);
    assert.deepEqual(rebuiltAttempt, requestTuple.recoveryAttempt);
    const exactAssociation = selectRecoveryOwnerAssociation({
      target: requestTuple.recoveryTarget,
      lifecycleInventoryObservation: requestTuple.recoveryInventory,
      previousRecoveryReplay: requestTuple.recoveryReplay,
      plan: requestTuple.recoveryPlan,
      attempt: rebuiltAttempt,
    });
    assertExactOwnFieldOrder(
      exactAssociation,
      array("lifetimeAnchorProjection", "lifetimeAttemptAnchorRawSha256"),
      "recovery owner association",
    );
    assertNullFrozenTree(exactAssociation, "recovery owner association");
    assert.equal(
      exactAssociation.lifetimeAnchorProjection,
      requestTuple.anchorSelection.lifetimeAnchorProjection,
    );
    assert.equal(
      exactAssociation.lifetimeAttemptAnchorRawSha256,
      requestTuple.anchorSelection.lifetimeAttemptAnchorRawSha256,
    );
    const equalAnchorReconstruction = record(
      ...Object.entries(exactAssociation.lifetimeAnchorProjection),
    );
    assert.deepEqual(
      equalAnchorReconstruction,
      exactAssociation.lifetimeAnchorProjection,
    );
    assert.notEqual(
      equalAnchorReconstruction,
      exactAssociation.lifetimeAnchorProjection,
    );
    assert.throws(
      () =>
        lifetimeOwner.assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
          {
            lifetimeAnchorProjection: equalAnchorReconstruction,
            lifetimeAttemptAnchorRawSha256:
              exactAssociation.lifetimeAttemptAnchorRawSha256,
            targetSha256: requestTuple.recoveryTarget.targetSha256,
            recoveryActorEpochSha256: rebuiltAttempt.recoveryActorEpochSha256,
          },
        ),
      TypeError,
    );
    const equalReplayReconstruction = record(
      ...Object.entries(requestTuple.recoveryReplay),
    );
    assert.deepEqual(equalReplayReconstruction, requestTuple.recoveryReplay);
    assert.throws(
      () =>
        selectRecoveryOwnerAssociation({
          target: requestTuple.recoveryTarget,
          lifecycleInventoryObservation: requestTuple.recoveryInventory,
          previousRecoveryReplay: equalReplayReconstruction,
          plan: requestTuple.recoveryPlan,
          attempt: rebuiltAttempt,
        }),
      TypeError,
    );
    const rebuiltRecord =
      recoveryOwner.createCandidateContainmentRecoveryRecordV1({
        target: requestTuple.recoveryTarget,
        lifecycleInventoryObservation: requestTuple.recoveryInventory,
        previousRecoveryReplay: requestTuple.recoveryReplay,
        plan: requestTuple.recoveryPlan,
        lifetimeAnchorProjection: exactAssociation.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          exactAssociation.lifetimeAttemptAnchorRawSha256,
        attempt: rebuiltAttempt,
        previousRecord: null,
        operationBytes: ownerFixtures.jsonLine(
          ownerFixtures.opaque(`${requestLabel}:recovery-record-operation`),
        ),
        evidenceBytes: ownerFixtures.jsonLine(requestTuple.recoveryInventory),
      });
    const requestTree = await recoveryAttemptRecordToken(requestModule, {
      label: requestLabel,
      journal: requestJournal,
      recoveryAttempt: rebuiltAttempt,
      recoveryRecord: rebuiltRecord,
    });
    const requestReplayArguments = lifetimeReplayArguments(requestOwner);
    const unbrandedRequestPlan = record(
      ...Object.entries(requestTuple.recoveryPlan),
    );
    assert.throws(
      () =>
        selectRecoveryOwnerAssociation({
          target: requestTuple.recoveryTarget,
          lifecycleInventoryObservation: requestTuple.recoveryInventory,
          previousRecoveryReplay: requestTuple.recoveryReplay,
          plan: unbrandedRequestPlan,
          attempt: rebuiltAttempt,
        }),
      TypeError,
    );
    const requestInput = (recoveryPlan) =>
      autoInput({
        label: requestLabel,
        managerActorEpochSha256: requestManager,
        sequence: requestTree.sequence,
        token: requestTree.token,
        lifetimeReplayArguments: requestReplayArguments,
        generationManifest: artifact(requestJournal.generationManifest),
        normalJournalBundles: journalArtifactList(requestJournal),
        recoveryTarget: requestTuple.recoveryTarget,
        recoveryInventory: requestTuple.recoveryInventory,
        recoveryReplay: requestTuple.recoveryReplay,
        recoveryPlan,
        recoveryAttempt: rebuiltAttempt,
        recoveryRecord: rebuiltRecord,
        artifactBytes: rebuiltRecord.bytes,
      });
    expectCode(
      () =>
        requestModule.planCandidateContainmentGuardianStatefsOperationV1(
          requestInput(unbrandedRequestPlan),
        ),
      "STATEFS_PREDECESSOR",
    );
    const requestPlan =
      requestModule.planCandidateContainmentGuardianStatefsOperationV1(
        requestInput(requestTuple.recoveryPlan),
      );
    assert.equal(requestPlan.planKind, "REQUEST");
    assert.equal(requestPlan.request.operation, "PERSIST_NOREPLACE");
    assert.equal(requestPlan.inventorySet, requestTree.token);
    assert.equal(
      requestPlan.ownerContext.lifetimeAnchorProjection,
      exactAssociation.lifetimeAnchorProjection,
    );
    assert.equal(
      requestPlan.ownerContext.lifetimeAttemptAnchorRawSha256,
      exactAssociation.lifetimeAttemptAnchorRawSha256,
    );
    expectCode(
      () =>
        requestModule.planCandidateContainmentGuardianStatefsOperationV1(
          requestInput(requestTuple.recoveryPlan),
        ),
      "STATEFS_BINDING",
    );
  },
);

test(
  "R11A persistence observation correction separates scratch extents from regular inventory content and inversely reconstructs exact S2 evaluator",
  () => {
    const countExact = (source, needle) => {
      assert.equal(typeof source, "string");
      assert.equal(typeof needle, "string");
      assert.notEqual(needle.length, 0);
      let count = 0;
      let offset = 0;
      while (true) {
        const index = source.indexOf(needle, offset);
        if (index === -1) return count;
        count += 1;
        offset = index + needle.length;
      }
    };
    const exactRange = (source, start, end, label) => {
      assert.equal(countExact(source, start), 1, `${label} start count`);
      assert.equal(countExact(source, end), 1, `${label} end count`);
      const startIndex = source.indexOf(start);
      const endIndex = source.indexOf(end, startIndex + start.length);
      assert.equal(endIndex > startIndex, true, `${label} order`);
      return { startIndex, endIndex, value: source.slice(startIndex, endIndex) };
    };
    const replaceInExactRange = (
      source,
      start,
      end,
      before,
      after,
      label,
    ) => {
      const range = exactRange(source, start, end, label);
      assert.equal(
        countExact(range.value, before),
        1,
        `${label} replacement count`,
      );
      assert.equal(
        countExact(range.value, after),
        0,
        `${label} inverse precondition`,
      );
      const replaced = range.value.replace(before, after);
      assert.equal(countExact(replaced, before), 0, `${label} removal count`);
      assert.equal(countExact(replaced, after), 1, `${label} inverse count`);
      return `${source.slice(0, range.startIndex)}${replaced}${source.slice(range.endIndex)}`;
    };
    const removeRangeExactly = (source, start, end, label) => {
      const range = exactRange(source, start, end, label);
      return `${source.slice(0, range.startIndex)}${source.slice(range.endIndex)}`;
    };
    const assertObservationExtentContract = ({
      operation,
      inputByteLength,
      bytesConsumed,
      observation,
      outputBytes,
    }) => {
      assert.equal(inputByteLength > 0, true);
      assert.equal(bytesConsumed, inputByteLength);
      assert.equal(observation.byteLength, String(inputByteLength));
      assert.equal(observation.contentOffset, 0);
      if (operation === "PERSIST_NOREPLACE") {
        assert.equal(observation.contentLength, 0);
        assert.equal(outputBytes, null);
        return;
      }
      assert.equal(operation, "INVENTORY/REGULAR_FILE/PRESENT");
      assert.equal(observation.contentLength, inputByteLength);
      assert.equal(Buffer.isBuffer(outputBytes), true);
      assert.equal(outputBytes.length, inputByteLength);
    };

    const input = Buffer.from('{"persist":"scratch-not-result"}\n', "utf8");
    const persistFixture = {
      operation: "PERSIST_NOREPLACE",
      inputByteLength: input.length,
      bytesConsumed: input.length,
      observation: {
        byteLength: String(input.length),
        contentOffset: 0,
        contentLength: 0,
      },
      outputBytes: null,
    };
    const regularInventoryFixture = {
      operation: "INVENTORY/REGULAR_FILE/PRESENT",
      inputByteLength: input.length,
      bytesConsumed: input.length,
      observation: {
        byteLength: String(input.length),
        contentOffset: 0,
        contentLength: input.length,
      },
      outputBytes: Buffer.from(input),
    };
    assertObservationExtentContract(persistFixture);
    assertObservationExtentContract(regularInventoryFixture);
    assert.throws(() =>
      assertObservationExtentContract({
        ...persistFixture,
        observation: {
          ...persistFixture.observation,
          contentLength: input.length,
        },
      }),
    );
    assert.throws(() =>
      assertObservationExtentContract({
        ...persistFixture,
        outputBytes: Buffer.from(input),
      }),
    );
    assert.throws(() =>
      assertObservationExtentContract({
        ...persistFixture,
        bytesConsumed: 0,
      }),
    );
    assert.throws(() =>
      assertObservationExtentContract({
        ...regularInventoryFixture,
        observation: {
          ...regularInventoryFixture.observation,
          contentLength: 0,
        },
      }),
    );
    assert.throws(() =>
      assertObservationExtentContract({
        ...regularInventoryFixture,
        outputBytes: null,
      }),
    );

    const proofStart = [
      "\n\ntest(\n  \"R11A persistence observation correction separates ",
      "scratch extents from regular inventory content and inversely reconstructs exact S2 evaluator\",\n",
    ].join("");
    const proofEnd = [
      "\n\ntest(\"source-absent RED is the exact attributable candidate module ",
      "failure\", () => {\n",
    ].join("");
    const compatibilityStart = [
      "\n  const r11a",
      "CompatibilityStart = [\n",
    ].join("");
    const compatibilityEnd = [
      "\n  let selectedR5EvaluatorSource = remove",
      "RangeExactly(\n",
    ].join("");
    const nullIdentityStart = [
      "\n\nconst STATEFS_NULL_CONTEXT_CORRECTION_",
      "IDENTITY = (() => {\n",
    ].join("");
    const nullIdentityEnd = [
      "\n\nconst STATEFS_REFREEZE_",
      "IDENTITY = (() => {\n",
    ].join("");
    const lifetimeStart = [
      "\n\ntest(\n  \"same-origin lifetime evidence deterministically selects ",
      "MKDIR, PERSIST, and the two matching observation-only outcomes\",\n",
    ].join("");
    const lifetimeEnd = [
      "\n\ntest(\n  \"a fully inventoried adopted lifetime yields a one-shot ",
      "CONTEXT_ONLY WAIT plan without reserving its token\",\n",
    ].join("");
    const recoveryStart = [
      "\n\ntest(\n  \"a same-origin recovery-only attempt selects and persists ",
      "its first exact recovery record\",\n",
    ].join("");
    const recoveryEnd = [
      "\n\ntest(\n  \"same-origin adopted journal evidence selects MOVE, ",
      "sync-only recovery, and destination-already without laundering rename\",\n",
    ].join("");
    const regularStart = "\n\nfunction completeRegularInventory(\n";
    const regularEnd = "\n\nfunction canonicalInventoryProjection(";
    const correctedExtent = "          contentLength: 0,";
    const lifetimeHistoricalExtent =
      "          contentLength: lifetimeRecord.bytes.length,";
    const recoveryHistoricalExtent =
      "          contentLength: recoveryRecord.bytes.length,";
    const regularInventoryExtent = "          contentLength: bytes.length,";
    const regularInventoryOutput =
      "    outputBytes: absent ? Buffer.alloc(0) : Buffer.from(bytes),";

    const currentBytes = Buffer.from(
      STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.preR13EvaluatorSource,
      "utf8",
    );
    assert.equal(Buffer.isBuffer(currentBytes), true);
    const currentSource = currentBytes.toString("utf8");
    assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
    assert.equal(countExact(currentSource, "\ntest("), 25);
    for (const [start, end, historicalExtent, label] of [
      [lifetimeStart, lifetimeEnd, lifetimeHistoricalExtent, "lifetime persist"],
      [recoveryStart, recoveryEnd, recoveryHistoricalExtent, "recovery persist"],
    ]) {
      const range = exactRange(currentSource, start, end, label).value;
      assert.equal(countExact(range, correctedExtent), 1, `${label} zero extent`);
      assert.equal(
        countExact(range, historicalExtent),
        0,
        `${label} stale nonzero extent`,
      );
    }
    const regularRange = exactRange(
      currentSource,
      regularStart,
      regularEnd,
      "regular inventory fixture",
    ).value;
    assert.equal(countExact(regularRange, regularInventoryExtent), 1);
    assert.equal(countExact(regularRange, regularInventoryOutput), 1);
    assert.equal(countExact(regularRange, correctedExtent), 0);

    let reconstructedSource = removeRangeExactly(
      currentSource,
      proofStart,
      proofEnd,
      "R11A proof removal",
    );
    reconstructedSource = removeRangeExactly(
      reconstructedSource,
      compatibilityStart,
      compatibilityEnd,
      "R11A compatibility removal",
    );
    reconstructedSource = replaceInExactRange(
      reconstructedSource,
      nullIdentityStart,
      nullIdentityEnd,
      '  let currentEvaluatorSource = currentEvaluatorBytes.toString("utf8");',
      '  const currentEvaluatorSource = currentEvaluatorBytes.toString("utf8");',
      "R11A compatibility binding inverse",
    );
    reconstructedSource = replaceInExactRange(
      reconstructedSource,
      lifetimeStart,
      lifetimeEnd,
      correctedExtent,
      lifetimeHistoricalExtent,
      "lifetime persist inverse",
    );
    reconstructedSource = replaceInExactRange(
      reconstructedSource,
      recoveryStart,
      recoveryEnd,
      correctedExtent,
      recoveryHistoricalExtent,
      "recovery persist inverse",
    );
    const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
    assert.equal(reconstructedBytes.length, 312_547);
    assert.equal(countExact(reconstructedSource, "\n"), 9_199);
    assert.equal(
      byteSha256(reconstructedBytes),
      "dd23977051b54fbd8b6090d84f779de366a53b570149b8395b3bc8cd33d2253e",
    );
    assert.equal(
      gitBlobSha1(reconstructedBytes),
      "2e5d483b1097283f7b699a7de518a9126f80ca7a",
    );
    assert.equal(countExact(reconstructedSource, "\ntest("), 24);
  },
);

test(
  "R13 statx-mask correction inversely reconstructs the exact pre-R13 evaluator",
  () => {
    const receipt =
      STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.assertInverseReceipt(
        STATEFS_R13_STATX_MASK_CONTRACT_IDENTITY.inverseReceipt,
      );
    assert.deepEqual(NATIVE_OBSERVATION_FIELDS, [
      "kind",
      "role",
      "name",
      "deviceMajor",
      "deviceMinor",
      "inode",
      "mountId",
      "byteLength",
      "linkCount",
      "mode",
      "ownerUid",
      "ownerGid",
      "statxMask",
      "filesystemMagic",
      "contentOffset",
      "contentLength",
    ]);
    assert.equal(semanticSha256(REQUIREMENTS_GOLDEN), EXPECTED_REQUIREMENTS_SHA256);
    assert.equal(receipt.preR13EvaluatorBytes, 324_808);
    assert.equal(receipt.preR13EvaluatorLines, 9_548);
    assert.equal(
      receipt.preR13EvaluatorSha256,
      "0170540e8cd68d233b2e6c01df6cbeca3a9be44dabc59570b09c4b9d48a08c8c",
    );
    assert.equal(
      receipt.preR13EvaluatorGitBlob,
      "6d808b107ed9bda6b2195c035e6a3ad2a6066c9d",
    );
    assert.equal(receipt.preR13EvaluatorTestCount, 25);
    assert.deepEqual(METADATA_RULES.slice(-3), [
      "raw-name-bytes-01-7f/v1",
      "ascii-byte-order/v1",
      "statx-required-mask-0x17ff/v1",
    ]);
    assert.deepEqual(SYSCALL_RULES.slice(-2), [
      "validated-observation-prefix-only/v1",
      "live-cleanup-close-upgrades-effect/v1",
    ]);
  },
);

test(
  "R13 statx availability, raw names, observation prefixes, and cleanup liveness are fail closed",
  CANDIDATE_TEST_OPTIONS,
  async () => {
    const requiredMask = 0x17ff;
    const dispatchForVerification = (module, plan) => {
      module.assertCandidateContainmentGuardianStatefsPlanV1(plan);
      module.assertCandidateContainmentGuardianStatefsRequestV1(plan.request);
    };
    const expectResultFailure = (module, plan, result) => {
      dispatchForVerification(module, plan);
      expectCode(
        () =>
          module.verifyCandidateContainmentGuardianStatefsResultV1({
            request: plan.request,
            executorResult: result,
          }),
        "STATEFS_RESULT",
      );
      expectCode(
        () =>
          module.verifyCandidateContainmentGuardianStatefsResultV1({
            request: plan.request,
            executorResult: result,
          }),
        "STATEFS_BINDING",
      );
    };
    const assertTerminal = (receipt, { status, effectClass, outcome }) => {
      assert.equal(receipt.status, status);
      assert.equal(receipt.effectClass, effectClass);
      assert.equal(receipt.outcome, outcome);
      assert.equal(receipt.retryDisposition, "NO_RETRY");
      assert.deepEqual(receipt.inventories, []);
      assert.equal(receipt.inventorySet, null);
      assert.equal(receipt.inventorySetSha256, null);
    };
    const assertPrefix = (
      receipt,
      { lastCompletedStep, failedStep, completedStepCount, bytesConsumed = 0 },
    ) => {
      assert.equal(receipt.lastCompletedStep, lastCompletedStep);
      assert.equal(receipt.failedStep, failedStep);
      assert.equal(receipt.errno, 0);
      assert.equal(receipt.completedStepCount, completedStepCount);
      assert.equal(receipt.bytesConsumed, bytesConsumed);
    };
    const assertUncertain = (receipt, status) => {
      assertTerminal(receipt, {
        status,
        effectClass: "EFFECT_UNCERTAIN",
        outcome: "FAILED_EFFECT_UNCERTAIN",
      });
    };
    const freshRootInventoryPlan = async (label) => {
      const module = await freshStatefs(label);
      const lock = completeLock(module, { label });
      const plan = planDirectoryInventory(module, {
        label,
        sequence: 1,
        token: lock.receipt.inventorySet,
        role: "STATE_ROOT",
        parentRole: "STATE_ROOT",
      });
      return { module, plan };
    };
    const freshRegularPlan = async (label) => {
      const module = await freshStatefs(label);
      const segmentName = digest(`${label}:segment`);
      const tree = await rootAndLifecycleToken(module, {
        label,
        lifecycleEntries: array(
          array(segmentName, "LIFETIME_SEGMENT", "201"),
        ),
      });
      const segment = completeDirectoryInventory(module, {
        label,
        sequence: 3,
        token: tree.token,
        role: "LIFETIME_SEGMENT",
        parentRole: "LIFETIMES",
        name: segmentName,
        targetInode: "201",
        entries: array(),
        returnedDirectoryFd: 66,
      });
      const name = `0000000000000000-${digest(`${label}:entry`)}.jsonl`;
      const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
        inventoryInput({
          label,
          sequence: 4,
          token: segment.receipt.inventorySet,
          inventoryDirectoryRole: null,
          directoryRoleA: "LIFETIME_SEGMENT",
          nameA: name,
        }),
      );
      return { module, plan, name };
    };
    const absentObservation = (role, name, statxMask = 0) =>
      nativeObservation({
        kind: "ABSENT",
        role,
        name,
        deviceMajor: "0",
        deviceMinor: "0",
        inode: "0",
        mountId: "0",
        byteLength: "0",
        linkCount: "0",
        mode: 0,
        ownerUid: 0,
        ownerGid: 0,
        statxMask,
        filesystemMagic: "0",
      });
    const completeAbsentResult = (request, name, statxMask = 0) =>
      executorResult(request, {
        lastCompletedStep: "ENTRY_REOBSERVED",
        completedStepCount: 3,
        observations: array(
          absentObservation(request.directoryRoleA, name, statxMask),
        ),
        outputBytes: Buffer.alloc(0),
      });
    const freshMkdirPlan = async (label) => {
      const module = await freshStatefs(label);
      const tree = await rootAndLifecycleToken(module, { label });
      const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
      const owner = createLifetimeOwner({
        label,
        root: tree.root,
        managerActorEpochSha256,
      });
      const beforeReplay = lifetimeReplayArguments(owner, 0);
      const lifetimeRecord = owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
      const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label,
          managerActorEpochSha256,
          sequence: 3,
          token: tree.token,
          lifetimeReplayArguments: beforeReplay,
          artifactBytes: lifetimeRecord.bytes,
        }),
      );
      assert.equal(plan.request.operation, "MKDIR_SYNC");
      return { module, plan };
    };
    const freshMovePlan = async (label) => {
      const module = await freshStatefs(label);
      const journal = ownerFixtures.createJournalStack(label, 18);
      const generationName = journal.generationIdentity.identitySha256;
      const active = await lifecycleParentToken(module, {
        label,
        role: "ACTIVE",
        entries: array(array(generationName, "GENERATION", "500")),
      });
      const closed = completeDirectoryInventory(module, {
        label,
        sequence: 3,
        token: active.token,
        role: "CLOSED",
        parentRole: "STATE_ROOT",
        name: "closed",
        targetInode: "104",
        entries: array(),
        returnedDirectoryFd: 64,
      });
      const managerActorEpochSha256 = digest(`${label}:manager-actor-epoch`);
      const owner = createAdoptedLifetimeOwner({
        label,
        root: active.root,
        managerActorEpochSha256,
        journal,
      });
      const closeDecision = buildCloseDecisionTuple(owner, journal, "active");
      const plan = module.planCandidateContainmentGuardianStatefsOperationV1(
        autoInput({
          label,
          managerActorEpochSha256,
          sequence: 4,
          token: closed.receipt.inventorySet,
          lifetimeReplayArguments: lifetimeReplayArguments(owner),
          generationManifest: artifact(journal.generationManifest),
          normalJournalBundles: journalArtifactList(journal),
          recoveryTarget: closeDecision.recoveryTarget,
          recoveryInventory: closeDecision.recoveryInventory,
          recoveryReplay: closeDecision.recoveryReplay,
          recoveryPlan: closeDecision.recoveryPlan,
        }),
      );
      assert.equal(plan.request.operation, "MOVE_NOREPLACE_SYNC");
      return { module, plan, generationName };
    };

    const invalidMasks = [
      ["missing", (observation) => {
        const copy = { ...observation };
        delete copy.statxMask;
        return copy;
      }],
      ["negative", (observation) => ({ ...observation, statxMask: -1 })],
      ["fractional", (observation) => ({ ...observation, statxMask: 1.5 })],
      ["string", (observation) => ({ ...observation, statxMask: "6143" })],
      [
        "overflow",
        (observation) => ({ ...observation, statxMask: 0x1_0000_0000 }),
      ],
      [
        "basic-stats-cleared",
        (observation) => ({
          ...observation,
          statxMask: requiredMask & ~0x07ff,
        }),
      ],
      [
        "mount-id-cleared",
        (observation) => ({
          ...observation,
          statxMask: requiredMask & ~0x1000,
        }),
      ],
    ];
    for (const [label, mutate] of invalidMasks) {
      const module = await freshStatefs(`r13-mask-${label}`);
      const plan = planLock(module, { label: `r13-mask-${label}` });
      expectResultFailure(
        module,
        plan,
        executorResult(plan.request, {
          observations: array(mutate(nativeObservation())),
        }),
      );
    }

    const crossBoundaryInvalidMasks = invalidMasks.filter(([label]) =>
      ["missing", "string", "mount-id-cleared"].includes(label),
    );
    assert.deepEqual(
      crossBoundaryInvalidMasks.map(([label]) => label),
      ["missing", "string", "mount-id-cleared"],
    );
    for (const [label, mutate] of crossBoundaryInvalidMasks) {
      const directory = await freshRootInventoryPlan(
        `r13-directory-entry-mask-${label}`,
      );
      expectResultFailure(
        directory.module,
        directory.plan,
        executorResult(directory.plan.request, {
          lastCompletedStep: "INVENTORY_DESCRIPTOR_CLOSED",
          completedStepCount: 5,
          observations: array(
            nativeObservation({ role: "STATE_ROOT", inode: "100" }),
            mutate(
              nativeObservation({
                kind: "DIRECTORY",
                role: "NONE",
                name: "lifetimes",
                inode: "701",
              }),
            ),
          ),
        }),
      );

      const regular = await freshRegularPlan(`r13-regular-mask-${label}`);
      const regularBytes = Buffer.from("x", "utf8");
      expectResultFailure(
        regular.module,
        regular.plan,
        executorResult(regular.plan.request, {
          lastCompletedStep: "INVENTORY_DESCRIPTOR_CLOSED",
          completedStepCount: 5,
          bytesConsumed: regularBytes.length,
          observations: array(
            mutate(
              nativeObservation({
                kind: "REGULAR",
                role: "LIFETIME_SEGMENT",
                name: regular.name,
                inode: "801",
                byteLength: String(regularBytes.length),
                linkCount: "1",
                mode: 0o100_600,
                contentLength: regularBytes.length,
              }),
            ),
          ),
          outputBytes: regularBytes,
        }),
      );

      const mkdir = await freshMkdirPlan(`r13-mkdir-mask-${label}`);
      expectResultFailure(
        mkdir.module,
        mkdir.plan,
        completeMutationResult(mkdir.plan.request, {
          observations: array(
            mutate(
              nativeObservation({
                kind: "DIRECTORY",
                role: "LIFETIME_SEGMENT",
                name: mkdir.plan.request.nameA,
                inode: "202",
              }),
            ),
          ),
        }),
      );
    }

    const extraModule = await freshStatefs("r13-mask-extra");
    const extraPlan = planLock(extraModule, { label: "r13-mask-extra" });
    const extraResult = executorResult(extraPlan.request, {
      observations: array(
        nativeObservation({
          statxMask: (requiredMask | 0x8000_0000) >>> 0,
        }),
      ),
    });
    const extraReceipt = dispatchPlan(extraModule, extraPlan, extraResult);
    assert.equal(extraReceipt.outcome, "LOCK_HELD");
    assert.equal(Object.hasOwn(extraReceipt, "statxMask"), false);

    const absent = await freshRegularPlan("r13-mask-absent-zero");
    const absentResult = completeAbsentResult(
      absent.plan.request,
      absent.name,
    );
    const absentReceipt = dispatchPlan(absent.module, absent.plan, absentResult);
    assert.equal(absentResult.observations[0].statxMask, 0);
    assert.equal(absentReceipt.outcome, "INVENTORY_OBSERVED");
    assert.equal(absentReceipt.inventories[0].entryCount, 0);
    assert.equal(Object.hasOwn(absentReceipt.inventories[0], "statxMask"), false);
    assert.equal(
      Object.hasOwn(absentReceipt.inventories[0].directory, "statxMask"),
      false,
    );

    const nonzeroAbsent = await freshRegularPlan("r13-mask-absent-nonzero");
    expectResultFailure(
      nonzeroAbsent.module,
      nonzeroAbsent.plan,
      completeAbsentResult(
        nonzeroAbsent.plan.request,
        nonzeroAbsent.name,
        1,
      ),
    );

    const raw = await freshRootInventoryPlan("r13-raw-name-controls");
    const rawNames = array("\x01", "\x1f", "\x7f");
    const rawResult = executorResult(raw.plan.request, {
      lastCompletedStep: "INVENTORY_DESCRIPTOR_CLOSED",
      completedStepCount: 5,
      observations: directoryNativeObservations({
        targetRole: "STATE_ROOT",
        targetInode: "100",
        entries: rawNames.map((name, index) =>
          nativeObservation({
            kind: "DIRECTORY",
            role: "NONE",
            name,
            inode: String(700 + index),
          }),
        ),
      }),
    });
    assert.equal(rawResult.status, "COMPLETE");
    assert.equal(rawResult.effectClass, "COMPLETE");
    assert.equal(rawResult.observations.length, 4);
    assert.equal(
      rawResult.observations.every(
        (observation) =>
          (observation.statxMask & requiredMask) === requiredMask,
      ),
      true,
    );
    const rawReceipt = dispatchPlan(raw.module, raw.plan, rawResult);
    assert.equal(rawReceipt.status, "REJECTED");
    assert.equal(rawReceipt.effectClass, "DEFINITE_NO_EFFECT");
    assert.equal(rawReceipt.outcome, "REJECTED");
    assert.equal(rawReceipt.retryDisposition, "NO_RETRY");
    assert.deepEqual(
      rawReceipt.inventories[0].entries.map((entry) => entry.name),
      rawNames,
    );
    assert.equal(
      rawReceipt.inventories[0].entries.some((entry) =>
        Object.hasOwn(entry, "statxMask"),
      ),
      false,
    );
    assert.equal(
      Object.hasOwn(rawReceipt.inventories[0].directory, "statxMask"),
      false,
    );
    assert.equal(rawReceipt.inventorySet, null);
    assert.equal(rawReceipt.inventorySetSha256, null);

    const targetMask = await freshRootInventoryPlan("r13-target-mask");
    const targetMaskResult = executorResult(targetMask.plan.request, {
      status: "REJECTED",
      effectClass: "NO_EFFECT",
      lastCompletedStep: "FD_A_VALIDATED",
      failedStep: "INTERNAL_DESCRIPTOR_OPENED",
      completedStepCount: 2,
      observations: array(),
    });
    const targetMaskReceipt = dispatchPlan(
      targetMask.module,
      targetMask.plan,
      targetMaskResult,
    );
    assert.equal(targetMaskResult.observations.length, 0);
    assertTerminal(targetMaskReceipt, {
      status: "REJECTED",
      effectClass: "NO_EFFECT",
      outcome: "REJECTED",
    });
    assertPrefix(targetMaskReceipt, {
      lastCompletedStep: "FD_A_VALIDATED",
      failedStep: "INTERNAL_DESCRIPTOR_OPENED",
      completedStepCount: 2,
    });

    const possibleLive = await freshRootInventoryPlan("r13-possible-live");
    const possibleLiveResult = executorResult(possibleLive.plan.request, {
      status: "REJECTED",
      effectClass: "EFFECT_UNCERTAIN",
      lastCompletedStep: "FD_A_VALIDATED",
      failedStep: "INTERNAL_DESCRIPTOR_OPENED",
      completedStepCount: 2,
      observations: array(),
    });
    const possibleLiveReceipt = dispatchPlan(
      possibleLive.module,
      possibleLive.plan,
      possibleLiveResult,
    );
    assert.equal(possibleLiveResult.observations.length, 0);
    assertUncertain(possibleLiveReceipt, "REJECTED");
    assertPrefix(possibleLiveReceipt, {
      lastCompletedStep: "FD_A_VALIDATED",
      failedStep: "INTERNAL_DESCRIPTOR_OPENED",
      completedStepCount: 2,
    });

    const freshDirectorySyscallFailurePlan = async (label, variant) => {
      if (variant === "ROOT") return freshRootInventoryPlan(label);
      assert.equal(variant, "CHILD");
      const module = await freshStatefs(label);
      const lock = completeLock(module, { label });
      const root = completeDirectoryInventory(module, {
        label,
        sequence: 1,
        token: lock.receipt.inventorySet,
        role: "STATE_ROOT",
        parentRole: "STATE_ROOT",
        targetInode: "100",
        entries: ROOT_CHILDREN,
      });
      const plan = planDirectoryInventory(module, {
        label,
        sequence: 2,
        token: root.receipt.inventorySet,
        role: "LIFETIMES",
        parentRole: "STATE_ROOT",
        name: "lifetimes",
      });
      return { module, plan };
    };
    const assertSyscallPrefix = (
      receipt,
      { lastCompletedStep, failedStep, completedStepCount, errno },
    ) => {
      assert.equal(receipt.lastCompletedStep, lastCompletedStep);
      assert.equal(receipt.failedStep, failedStep);
      assert.equal(receipt.errno, errno);
      assert.notEqual(receipt.errno, 0);
      assert.equal(receipt.completedStepCount, completedStepCount);
      assert.equal(receipt.bytesConsumed, 0);
    };

    for (const [variant, expectedRole] of [
      ["ROOT", "STATE_ROOT"],
      ["CHILD", "LIFETIMES"],
    ]) {
      for (const [suffix, effectClass] of [
        ["cleanup-closed", "DEFINITE_NO_EFFECT"],
        ["cleanup-close-failed", "EFFECT_UNCERTAIN"],
      ]) {
        const directory = await freshDirectorySyscallFailurePlan(
          `r13b3-directory-${variant.toLowerCase()}-${suffix}`,
          variant,
        );
        assert.equal(
          directory.plan.request.inventoryDirectoryRole,
          expectedRole,
        );
        const directoryResult = executorResult(directory.plan.request, {
          status: "SYSCALL_FAILED",
          effectClass,
          lastCompletedStep: "FD_A_VALIDATED",
          failedStep: "INTERNAL_DESCRIPTOR_OPENED",
          errno: 5,
          completedStepCount: 2,
          observations: array(),
        });
        const directoryReceipt = dispatchPlan(
          directory.module,
          directory.plan,
          directoryResult,
        );
        assert.deepEqual(directoryResult.observations, array());
        if (effectClass === "EFFECT_UNCERTAIN") {
          assertUncertain(directoryReceipt, "SYSCALL_FAILED");
        } else {
          assert.equal(directoryReceipt.status, "SYSCALL_FAILED");
          assert.equal(
            directoryReceipt.effectClass,
            "DEFINITE_NO_EFFECT",
          );
          assert.equal(
            directoryReceipt.outcome,
            "FAILED_DEFINITE_NO_EFFECT",
          );
          assert.equal(
            directoryReceipt.retryDisposition,
            "REPLAN_AFTER_FRESH_INVENTORY",
          );
          assert.deepEqual(directoryReceipt.inventories, []);
          assert.notEqual(directoryReceipt.inventorySet, null);
          assert.notEqual(directoryReceipt.inventorySetSha256, null);
        }
        assertSyscallPrefix(directoryReceipt, {
          lastCompletedStep: "FD_A_VALIDATED",
          failedStep: "INTERNAL_DESCRIPTOR_OPENED",
          completedStepCount: 2,
          errno: 5,
        });
      }
    }

    for (const [suffix, effectClass] of [
      ["cleanup-closed", "MUTATION_OBSERVED_NOT_FULLY_SYNCED"],
      ["cleanup-close-failed", "EFFECT_UNCERTAIN"],
    ]) {
      const mkdir = await freshMkdirPlan(`r13b3-mkdir-syscall-${suffix}`);
      const mkdirResult = completeMutationResult(mkdir.plan.request, {
        status: "SYSCALL_FAILED",
        effectClass,
        lastCompletedStep: "CREATED_METADATA_VALIDATED",
        failedStep: "INTERNAL_DESCRIPTOR_OPENED",
        errno: 5,
        completedStepCount: 4,
        observations: array(),
      });
      const mkdirReceipt = dispatchPlan(
        mkdir.module,
        mkdir.plan,
        mkdirResult,
      );
      assert.deepEqual(mkdirResult.observations, array());
      if (effectClass === "EFFECT_UNCERTAIN") {
        assertUncertain(mkdirReceipt, "SYSCALL_FAILED");
      } else {
        assertTerminal(mkdirReceipt, {
          status: "SYSCALL_FAILED",
          effectClass: "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
          outcome: "FAILED_MUTATION_NOT_FULLY_SYNCED",
        });
      }
      assertSyscallPrefix(mkdirReceipt, {
        lastCompletedStep: "CREATED_METADATA_VALIDATED",
        failedStep: "INTERNAL_DESCRIPTOR_OPENED",
        completedStepCount: 4,
        errno: 5,
      });
    }

    const impossibleSyscallRegular = await freshRegularPlan(
      "r13b3-impossible-live-syscall-regular-initial",
    );
    expectResultFailure(
      impossibleSyscallRegular.module,
      impossibleSyscallRegular.plan,
      executorResult(impossibleSyscallRegular.plan.request, {
        status: "SYSCALL_FAILED",
        effectClass: "EFFECT_UNCERTAIN",
        lastCompletedStep: "FD_A_VALIDATED",
        failedStep: "INTERNAL_DESCRIPTOR_OPENED",
        errno: 5,
        completedStepCount: 2,
        observations: array(),
        outputBytes: Buffer.alloc(0),
      }),
    );

    const impossibleSyscallMkdir = await freshMkdirPlan(
      "r13b3-impossible-live-syscall-mkdir-created-metadata",
    );
    expectResultFailure(
      impossibleSyscallMkdir.module,
      impossibleSyscallMkdir.plan,
      completeMutationResult(impossibleSyscallMkdir.plan.request, {
        status: "SYSCALL_FAILED",
        effectClass: "EFFECT_UNCERTAIN",
        lastCompletedStep: "CHILD_DIRECTORY_CREATED",
        failedStep: "CREATED_METADATA_VALIDATED",
        errno: 5,
        completedStepCount: 3,
        observations: array(),
      }),
    );

    const impossibleRegular = await freshRegularPlan(
      "r13-impossible-live-regular-initial",
    );
    expectResultFailure(
      impossibleRegular.module,
      impossibleRegular.plan,
      executorResult(impossibleRegular.plan.request, {
        status: "REJECTED",
        effectClass: "EFFECT_UNCERTAIN",
        lastCompletedStep: "FD_A_VALIDATED",
        failedStep: "INTERNAL_DESCRIPTOR_OPENED",
        completedStepCount: 2,
        observations: array(),
        outputBytes: Buffer.alloc(0),
      }),
    );

    for (const [suffix, effectClass] of [
      ["closed", "NO_EFFECT"],
      ["cleanup-close-failed", "EFFECT_UNCERTAIN"],
    ]) {
      const unrepresentable = await freshRootInventoryPlan(
        `r13-unrepresentable-${suffix}`,
      );
      const unrepresentableResult = executorResult(
        unrepresentable.plan.request,
        {
          status: "REJECTED",
          effectClass,
          lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
          failedStep: "DIRECTORY_ENUMERATED",
          completedStepCount: 3,
          observations: array(
            nativeObservation({ role: "STATE_ROOT", inode: "100" }),
          ),
        },
      );
      const receipt = dispatchPlan(
        unrepresentable.module,
        unrepresentable.plan,
        unrepresentableResult,
      );
      assert.equal(unrepresentableResult.observations.length, 1);
      if (effectClass === "EFFECT_UNCERTAIN") {
        assertUncertain(receipt, "REJECTED");
      } else {
        assertTerminal(receipt, {
          status: "REJECTED",
          effectClass: "NO_EFFECT",
          outcome: "REJECTED",
        });
      }
      assertPrefix(receipt, {
        lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
        failedStep: "DIRECTORY_ENUMERATED",
        completedStepCount: 3,
      });
    }

    const impossibleLiveModule = await freshStatefs("r13-impossible-live");
    const impossibleLivePlan = planLock(impossibleLiveModule, {
      label: "r13-impossible-live",
    });
    expectResultFailure(
      impossibleLiveModule,
      impossibleLivePlan,
      executorResult(impossibleLivePlan.request, {
        status: "REJECTED",
        effectClass: "EFFECT_UNCERTAIN",
        lastCompletedStep: "REQUEST_VALIDATED",
        failedStep: "FD_A_VALIDATED",
        completedStepCount: 1,
        observations: array(),
      }),
    );

    const impossibleMkdir = await freshMkdirPlan(
      "r13-impossible-live-mkdir-created-metadata",
    );
    expectResultFailure(
      impossibleMkdir.module,
      impossibleMkdir.plan,
      completeMutationResult(impossibleMkdir.plan.request, {
        status: "VERIFICATION_FAILED",
        effectClass: "EFFECT_UNCERTAIN",
        lastCompletedStep: "CHILD_DIRECTORY_CREATED",
        failedStep: "CREATED_METADATA_VALIDATED",
        completedStepCount: 3,
        observations: array(),
      }),
    );

    for (const [suffix, effectClass] of [
      ["cleanup-closed", "MUTATION_OBSERVED_NOT_FULLY_SYNCED"],
      ["cleanup-close-failed", "EFFECT_UNCERTAIN"],
    ]) {
      const mkdir = await freshMkdirPlan(`r13-post-mutation-${suffix}`);
      const mkdirResult = completeMutationResult(mkdir.plan.request, {
        status: "VERIFICATION_FAILED",
        effectClass,
        lastCompletedStep: "CREATED_METADATA_VALIDATED",
        failedStep: "INTERNAL_DESCRIPTOR_OPENED",
        completedStepCount: 4,
        observations: array(),
      });
      const receipt = dispatchPlan(
        mkdir.module,
        mkdir.plan,
        mkdirResult,
      );
      assert.equal(mkdirResult.observations.length, 0);
      if (effectClass === "EFFECT_UNCERTAIN") {
        assertUncertain(receipt, "VERIFICATION_FAILED");
      } else {
        assertTerminal(receipt, {
          status: "VERIFICATION_FAILED",
          effectClass: "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
          outcome: "FAILED_MUTATION_NOT_FULLY_SYNCED",
        });
      }
      assertPrefix(receipt, {
        lastCompletedStep: "CREATED_METADATA_VALIDATED",
        failedStep: "INTERNAL_DESCRIPTOR_OPENED",
        completedStepCount: 4,
      });
    }

    const move = await freshMovePlan("r13-prior-canonical-slot");
    const moveResult = completeMutationResult(move.plan.request, {
      status: "VERIFICATION_FAILED",
      effectClass: "EFFECT_UNCERTAIN",
      lastCompletedStep: "SOURCE_ABSENCE_REOBSERVED",
      failedStep: "DESTINATION_REOBSERVED",
      completedStepCount: 8,
      observations: array(
        absentObservation("ACTIVE", move.generationName),
      ),
    });
    const moveReceipt = dispatchPlan(
      move.module,
      move.plan,
      moveResult,
    );
    assert.equal(moveResult.observations.length, 1);
    assert.equal(moveResult.observations[0].kind, "ABSENT");
    assert.equal(moveResult.observations[0].statxMask, 0);
    assertUncertain(moveReceipt, "VERIFICATION_FAILED");
    assertPrefix(moveReceipt, {
      lastCompletedStep: "SOURCE_ABSENCE_REOBSERVED",
      failedStep: "DESTINATION_REOBSERVED",
      completedStepCount: 8,
    });

    const unrelated = await freshRegularPlan("r13-unrelated-verification");
    const unrelatedBytes = Buffer.from("x", "utf8");
    const unrelatedReceipt = dispatchPlan(
      unrelated.module,
      unrelated.plan,
      executorResult(unrelated.plan.request, {
        status: "VERIFICATION_FAILED",
        effectClass: "DEFINITE_NO_EFFECT",
        lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
        failedStep: "ENTRY_REOBSERVED",
        completedStepCount: 3,
        bytesConsumed: unrelatedBytes.length,
        observations: array(
          nativeObservation({
            kind: "REGULAR",
            role: unrelated.plan.request.directoryRoleA,
            name: unrelated.name,
            inode: "800",
            byteLength: "2",
            linkCount: "1",
            mode: 0o100_600,
            contentLength: unrelatedBytes.length,
          }),
        ),
        outputBytes: unrelatedBytes,
      }),
    );
    assert.equal(unrelatedReceipt.status, "VERIFICATION_FAILED");
    assert.equal(unrelatedReceipt.effectClass, "DEFINITE_NO_EFFECT");
    assert.equal(unrelatedReceipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.equal(
      unrelatedReceipt.retryDisposition,
      "REPLAN_AFTER_FRESH_INVENTORY",
    );
    assert.deepEqual(unrelatedReceipt.inventories, []);
    assert.notEqual(unrelatedReceipt.inventorySet, null);
    assert.notEqual(unrelatedReceipt.inventorySetSha256, null);
    assertPrefix(unrelatedReceipt, {
      lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
      failedStep: "ENTRY_REOBSERVED",
      completedStepCount: 3,
      bytesConsumed: unrelatedBytes.length,
    });

    const uncertainRegular = await freshRegularPlan(
      "r13-unrelated-verification-cleanup-close-failed",
    );
    const uncertainBytes = Buffer.from("x", "utf8");
    const uncertainReceipt = dispatchPlan(
      uncertainRegular.module,
      uncertainRegular.plan,
      executorResult(uncertainRegular.plan.request, {
        status: "VERIFICATION_FAILED",
        effectClass: "EFFECT_UNCERTAIN",
        lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
        failedStep: "ENTRY_REOBSERVED",
        completedStepCount: 3,
        bytesConsumed: uncertainBytes.length,
        observations: array(
          nativeObservation({
            kind: "REGULAR",
            role: "LIFETIME_SEGMENT",
            name: uncertainRegular.name,
            inode: "802",
            byteLength: "2",
            linkCount: "1",
            mode: 0o100_600,
            contentLength: uncertainBytes.length,
          }),
        ),
        outputBytes: uncertainBytes,
      }),
    );
    assertUncertain(uncertainReceipt, "VERIFICATION_FAILED");
    assertPrefix(uncertainReceipt, {
      lastCompletedStep: "INTERNAL_DESCRIPTOR_OPENED",
      failedStep: "ENTRY_REOBSERVED",
      completedStepCount: 3,
      bytesConsumed: uncertainBytes.length,
    });
  },
);

test("S7 V4 stale-task correction inversely reconstructs the exact S7 V3 evaluator", () => {
  const v5Receipt =
    STATEFS_S7_V5_MATRIX_COUNT_CORRECTION_IDENTITY.assertInverseReceipt(
      STATEFS_S7_V5_MATRIX_COUNT_CORRECTION_IDENTITY.inverseReceipt,
    );
  assert.deepEqual(v5Receipt, {
    schema:
      "oxigraph.test.candidate-containment-guardian-statefs-v1-s7-v5-matrix-count-correction-inverse-receipt/v1",
    predecessorBytes: 396_556,
    predecessorLines: 11_574,
    predecessorSha256:
      "860fc5de84cabb913ab7835d04c5e1cbe17cbe8792615ce38d741fc7692bcea1",
    predecessorGitBlob: "d8f14f567d10c5e2a5176343540cef65c93d38ff",
    predecessorTestCount: 32,
  });
  const receipt =
    STATEFS_S7_V4_TASK_DEPENDENCY_CORRECTION_IDENTITY.assertInverseReceipt(
      STATEFS_S7_V4_TASK_DEPENDENCY_CORRECTION_IDENTITY.inverseReceipt,
    );
  assert.deepEqual(receipt, {
    schema:
      "oxigraph.test.candidate-containment-guardian-statefs-v1-s7-v4-task-dependency-correction-inverse-receipt/v1",
    predecessorBytes: 391_542,
    predecessorLines: 11_439,
    predecessorSha256:
      "9205a95e78138a2f8e3b1630e5fa830c6aa862496b54404423ab53ea6ab33ead",
    predecessorGitBlob: "2f8222fb0db1f9c49ccfcb5b470d4f02592229ad",
    predecessorTestCount: 31,
  });
});

test("S7 ADR evidence re-pin inversely reconstructs the exact pre-closure evaluator", () => {
  const receipt = STATEFS_S7_ADR_CLOSURE_IDENTITY.assertInverseReceipt(
    STATEFS_S7_ADR_CLOSURE_IDENTITY.inverseReceipt,
  );
  assert.deepEqual(receipt, {
    schema:
      "oxigraph.test.candidate-containment-guardian-statefs-v1-s7-adr-closure-inverse-receipt/v1",
    predecessorBytes: 386_695,
    predecessorLines: 11_305,
    predecessorSha256:
      "7b79d1ab3c28289a2db9a262552c44c3e866e087b408e37d1898365d27b91651",
    predecessorGitBlob: "fc45c3975f6c4901bd89ba362a0816b51efb61be",
    predecessorTestCount: 30,
  });
});

test("R14B P1 ADR re-pin inversely reconstructs the exact R13B3 evaluator", () => {
  const receipt = STATEFS_R14B_P1_ADR_REPIN_IDENTITY.assertInverseReceipt(
    STATEFS_R14B_P1_ADR_REPIN_IDENTITY.inverseReceipt,
  );
  assert.deepEqual(receipt, {
    schema:
      "oxigraph.test.candidate-containment-guardian-statefs-v1-r14b-p1-adr-repin-inverse-receipt/v1",
    predecessorBytes: 381_815,
    predecessorLines: 11_171,
    predecessorSha256:
      "8362816b1008daa63500f0a506c1e19a2be79fffff441b97db6d3c7b8698c382",
    predecessorGitBlob: "ef1d5692a651aa75467049dc64040b69ebc73e97",
    predecessorTestCount: 29,
  });
});

test(
  "R13B3 syscall liveness RED inversely reconstructs the exact R13B2 evaluator",
  () => {
    const receipt =
      STATEFS_R13B3_SYSCALL_LIVENESS_RED_IDENTITY.assertInverseReceipt(
        STATEFS_R13B3_SYSCALL_LIVENESS_RED_IDENTITY.inverseReceipt,
      );
    assert.deepEqual(receipt, {
      schema:
        "oxigraph.test.candidate-containment-guardian-statefs-v1-r13b3-syscall-liveness-red-inverse-receipt/v1",
      predecessorBytes: 371_224,
      predecessorLines: 10_875,
      predecessorSha256:
        "e0da6dc758789bd8bc27b75a2a2e5942afcfffd2d5166d65e5fc9756b8b7e19f",
      predecessorGitBlob: "81ac0866b800efd18679afd53e7e6fd03c4c3b4c",
      predecessorTestCount: 28,
    });
  },
);

test(
  "R13B2 liveness RED correction inversely reconstructs the exact R13B evaluator",
  () => {
    const receipt =
      STATEFS_R13B2_LIVENESS_RED_CORRECTION_IDENTITY.assertInverseReceipt(
        STATEFS_R13B2_LIVENESS_RED_CORRECTION_IDENTITY.inverseReceipt,
      );
    assert.deepEqual(receipt, {
      schema:
        "oxigraph.test.candidate-containment-guardian-statefs-v1-r13b2-liveness-red-inverse-receipt/v1",
      predecessorBytes: 355_185,
      predecessorLines: 10_424,
      predecessorSha256:
        "11a59f00404d4fd9cc6683c46d2e35563c3582bbe24e8c2f8a67a65ed9b9e9a1",
      predecessorGitBlob: "2d59c8c56c3455103bdf4970fd749034dae9bf4e",
      predecessorTestCount: 27,
    });
  },
);

test("source-absent RED is the exact attributable candidate module failure", () => {
  if (candidateImportError !== null) {
    throw assertExactMissingCandidate(candidateImportError);
  }
  assert.notEqual(statefs, null);
});
