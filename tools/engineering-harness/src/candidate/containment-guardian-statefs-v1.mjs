import {
  sha256,
  nullRecord,
  deepFreeze,
  frozenCopyOnReadBytes,
  exactRecord,
  exactDenseArray,
  boundedInteger,
  exactBoolean,
  exactDigest,
  exactDecimal,
  exactUnicodeString,
  copyBoundedBuffer,
  decodeCanonicalJsonLine,
  canonicalJsonBytes,
} from "./containment-exact-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2,
  verifyCandidateContainmentGuardianGenerationManifestV2,
  verifyCandidateContainmentGuardianJournalBundleV2,
  replayCandidateContainmentGuardianJournalV2,
} from "./containment-guardian-journal-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1,
  replayCandidateContainmentGuardianLifetimeV1,
  selectCandidateContainmentGuardianLifetimeRecoveryTargetV1,
  selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1,
  selectCandidateContainmentGuardianLifetimeExternalHeadV1,
  selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1,
  assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1,
  assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1,
  assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1,
  assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1,
  assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1,
} from "./containment-guardian-lifetime-v1.mjs";
import {
  CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1,
  verifyCandidateContainmentRecoveryTargetV1,
  verifyCandidateContainmentRecoveryInventoryObservationV1,
  replayCandidateContainmentRecoveryV1,
  selectCandidateContainmentRecoveryOwnerAssociationV1,
  verifyCandidateContainmentRecoveryAttemptV1,
  verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1,
  verifyCandidateContainmentRecoveryRecordV1,
} from "./containment-guardian-recovery-v1.mjs";

const AUTHORITY = nullRecord([
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
]);

const PHYSICAL_FACTS = nullRecord([
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
]);

const NONCLAIMS = [
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
];

const PREDECESSORS = [
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
];

const IMPORT_INVENTORY = [
  [
    "./containment-exact-v2.mjs",
    [
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
    ],
  ],
  [
    "./containment-guardian-journal-v2.mjs",
    [
      "CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2",
      "verifyCandidateContainmentGuardianGenerationManifestV2",
      "verifyCandidateContainmentGuardianJournalBundleV2",
      "replayCandidateContainmentGuardianJournalV2",
    ],
  ],
  [
    "./containment-guardian-lifetime-v1.mjs",
    [
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
    ],
  ],
  [
    "./containment-guardian-recovery-v1.mjs",
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1",
      "verifyCandidateContainmentRecoveryTargetV1",
      "verifyCandidateContainmentRecoveryInventoryObservationV1",
      "replayCandidateContainmentRecoveryV1",
      "selectCandidateContainmentRecoveryOwnerAssociationV1",
      "verifyCandidateContainmentRecoveryAttemptV1",
      "verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1",
      "verifyCandidateContainmentRecoveryRecordV1",
    ],
  ],
];

const SCHEMAS = [
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
];

const LIMITS = [
  ["managerActorEpochBytes", 32],
  ["descriptorCount", 2],
  ["heldDirectoryDescriptorCount", 5],
  ["totalStatefsDescriptorCount", 8],
  ["requestSequenceMaximum", 999999],
  ["componentNameBytes", 255],
  ["immutableArtifactBytes", 98304],
  ["regularFileObservationBytes", 98304],
  ["directoryEntryCount", 256],
  ["aggregateLifecycleEntryCount", 1536],
  ["inventoryScopeCount", 221959],
  ["observationCount", 257],
  ["completedOperationStepCount", 15],
  ["operationStepNumericMaximum", 34],
  ["canonicalRequestBytes", 262144],
  ["canonicalInventoryOrReceiptBytes", 1048576],
  ["consecutiveEintrReadWriteRetries", 8],
  ["inventoryRequestsPerTraversal", 250000],
];

const DIRECTORY_ROLES = [
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
];
const ROOT_DIRECTORY_NAMES = [
  "lifetimes",
  "staging",
  "active",
  "closed",
  "recovered",
  "quarantined",
];
const NAME_GRAMMARS = [
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
];
const PLANNER_KINDS = ["LOCK_EX_NB", "INVENTORY", "RELEASE_DIRECTORY", "AUTO"];
const OPERATIONS = [
  "LOCK_EX_NB",
  "INVENTORY",
  "PERSIST_NOREPLACE",
  "MKDIR_SYNC",
  "MOVE_NOREPLACE_SYNC",
  "MOVE_SYNC_REOBSERVE",
  "TEMP_CLEANUP",
  "RELEASE_DIRECTORY",
];
const INVENTORY_KINDS = ["NONE", "DIRECTORY", "REGULAR_FILE"];

const HELD_DIRECTORY_OBSERVATION_FIELDS = [
  "schema",
  "role",
  "accessMode",
  "closeOnExec",
  "fileType",
  "ownerUid",
  "ownerGid",
  "mode",
  "linkCount",
  "deviceMajor",
  "deviceMinor",
  "inode",
  "mountId",
  "filesystemMagic",
  "identitySha256",
  "authority",
  "physicalFacts",
  "nonclaims",
];
const INVENTORY_ENTRY_FIELDS = [
  "name",
  "kind",
  "mode",
  "ownerUid",
  "ownerGid",
  "linkCount",
  "byteLength",
  "deviceMajor",
  "deviceMinor",
  "inode",
  "mountId",
  "filesystemMagic",
  "contentByteLength",
  "contentRawSha256",
];
const INVENTORY_OBSERVATION_FIELDS = [
  "schema",
  "requestSha256",
  "directory",
  "directoryHandleSha256",
  "inventoryKind",
  "requestedName",
  "entryCount",
  "entries",
  "contentBytes",
  "inventorySha256",
  "authority",
  "physicalFacts",
  "nonclaims",
];
const INVENTORY_SET_FIELDS = [
  "schema",
  "requirementsSha256",
  "managerActorEpochSha256",
  "revision",
  "previousInventorySetSha256",
  "producingRequestSequence",
  "producingRequestSha256",
  "scopeCount",
  "inventorySetSha256",
  "authority",
  "physicalFacts",
  "nonclaims",
];
const DIRECTORY_HANDLE_PREIMAGE_FIELDS = [
  "schema",
  "managerActorEpochSha256",
  "role",
  "identitySha256",
  "parentDirectoryHandleSha256",
  "name",
];
const PLANNER_INPUT_FIELDS = [
  "kind",
  "managerActorEpochSha256",
  "requestSequence",
  "inventorySetSha256",
  "stateRootObservation",
  "currentInventorySet",
  "unresolvedReceipt",
  "generationManifest",
  "normalJournalBundles",
  "lifetimeReplayArguments",
  "recoveryTarget",
  "recoveryInventory",
  "recoveryReplay",
  "recoveryPlan",
  "recoveryAttempt",
  "recoveryRecord",
  "artifactBytes",
  "inventoryDirectoryRole",
  "directoryRoleA",
  "directoryRoleB",
  "nameA",
  "nameB",
  "expectedOutcome",
];
const OWNER_CONTEXT_FIELDS = [
  "schema",
  "lifetimeReplay",
  "recoveryTarget",
  "recoveryInventory",
  "recoveryReplay",
  "recoveryPlan",
  "recoveryAttempt",
  "recoveryRecord",
  "lifetimeAnchorProjection",
  "lifetimeAttemptAnchorRawSha256",
  "generationManifest",
  "normalJournalBundles",
  "ownerContextSha256",
  "authority",
  "physicalFacts",
  "nonclaims",
];
const PLAN_FIELDS = [
  "request",
  "ownerContext",
  "inventorySet",
  "schema",
  "requirementsSha256",
  "managerActorEpochSha256",
  "requestSequence",
  "inventorySetSha256",
  "planKind",
  "managerDisposition",
  "operation",
  "writerKind",
  "actorKind",
  "targetSha256",
  "requiredDurableRecordType",
  "requiredOutcomeRecordType",
  "guardianAction",
  "requestSha256",
  "ownerContextSha256",
  "planSha256",
  "authority",
  "physicalFacts",
  "nonclaims",
];
const REQUEST_FIELDS = [
  "bytes",
  "inventorySet",
  "schema",
  "requirementsSha256",
  "managerActorEpochSha256",
  "requestSequence",
  "inventorySetSha256",
  "requestSha256",
  "operation",
  "executionDisposition",
  "writerKind",
  "actorKind",
  "targetSha256",
  "requiredDurableRecordType",
  "requiredOutcomeRecordType",
  "inventoryKind",
  "inventoryDirectoryRole",
  "directoryRoleA",
  "directoryIdentitySha256A",
  "directoryHandleSha256A",
  "directoryRoleB",
  "directoryIdentitySha256B",
  "directoryHandleSha256B",
  "nameA",
  "nameB",
  "inputByteLength",
  "inputRawSha256",
  "temporaryIdentitySha256",
  "authorizationRawSha256",
  "unresolvedReceiptSha256",
  "expectedOutcome",
  "authority",
  "physicalFacts",
  "nonclaims",
];
const NATIVE_OBSERVATION_FIELDS = [
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
  "filesystemMagic",
  "contentOffset",
  "contentLength",
];
const EXECUTOR_RESULT_FIELDS = [
  "schema",
  "abiVersion",
  "requestSha256",
  "operation",
  "status",
  "effectClass",
  "lastCompletedStep",
  "failedStep",
  "errno",
  "completedStepCount",
  "bytesConsumed",
  "observations",
  "outputBytes",
  "returnedDirectoryFd",
];
const RECEIPT_FIELDS = [
  "request",
  "previousInventorySet",
  "inventorySet",
  "schema",
  "requirementsSha256",
  "requestSha256",
  "operation",
  "executionDisposition",
  "writerKind",
  "actorKind",
  "targetSha256",
  "requiredDurableRecordType",
  "requiredOutcomeRecordType",
  "previousInventorySetSha256",
  "inventorySetSha256",
  "status",
  "effectClass",
  "lastCompletedStep",
  "failedStep",
  "errno",
  "completedStepCount",
  "bytesConsumed",
  "outcome",
  "retryDisposition",
  "inventories",
  "receiptSha256",
  "authority",
  "physicalFacts",
  "nonclaims",
];
const PRIVATE_FILESYSTEM_REPORT_FIELDS = [
  "schema",
  "requirementsSha256",
  "platform",
  "architecture",
  "byteOrder",
  "kernelRelease",
  "effectiveUid",
  "effectiveGid",
  "stateRootName",
  "runNonceSha256",
  "stateRootDeviceMajor",
  "stateRootDeviceMinor",
  "stateRootInode",
  "stateRootMountId",
  "filesystemMagic",
  "mountPointByteLength",
  "mountPointRawSha256",
  "mountOptions",
  "cleanupAttempted",
  "cleanupCompleted",
  "cleanupErrno",
  "reportSha256",
  "authority",
  "physicalFacts",
  "nonclaims",
];

const OPERATION_STEPS = [
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
];
const OPERATION_STEP_SEQUENCES = [
  ["LOCK_EX_NB", [1, 2, 4]],
  ["INVENTORY/DIRECTORY/ROOT", [1, 2, 5, 6, 24]],
  ["INVENTORY/DIRECTORY/CHILD", [1, 2, 5, 6, 32]],
  ["INVENTORY/REGULAR_FILE/PRESENT", [1, 2, 5, 7, 24]],
  ["INVENTORY/REGULAR_FILE/ABSENT", [1, 2, 7]],
  [
    "PERSIST_NOREPLACE",
    [1, 2, 8, 33, 9, 25, 10, 26, 11, 27, 12, 20, 28, 21, 29],
  ],
  ["MKDIR_SYNC", [1, 2, 13, 33, 5, 14, 30, 20, 21]],
  ["MOVE_NOREPLACE_SYNC", [1, 2, 3, 15, 16, 17, 18, 22, 21]],
  ["MOVE_SYNC_REOBSERVE", [1, 2, 3, 15, 31, 17, 18, 22, 21]],
  ["TEMP_CLEANUP", [1, 2, 15, 19, 20, 23]],
  ["RELEASE_DIRECTORY", [1, 2, 34]],
];
const EXECUTOR_RESULT_STATUSES = [
  "COMPLETE",
  "REJECTED",
  "SYSCALL_FAILED",
  "LIMIT_EXCEEDED",
  "FAULT_INJECTED",
  "VERIFICATION_FAILED",
];
const RECEIPT_STATUSES = [
  "COMPLETE",
  "REJECTED",
  "SYSCALL_FAILED",
  "LIMIT_EXCEEDED",
  "FAULT_INJECTED",
  "VERIFICATION_FAILED",
  "OBSERVATION_ONLY",
];
const EFFECT_CLASSES = [
  "NO_EFFECT",
  "DEFINITE_NO_EFFECT",
  "COMPLETE",
  "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
  "EFFECT_UNCERTAIN",
];
const OUTCOMES = [
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
];
const RETRY_DISPOSITIONS = ["NO_RETRY", "REPLAN_AFTER_FRESH_INVENTORY"];
const ERROR_PRECEDENCE = [
  "STATEFS_BOUNDS",
  "STATEFS_SHAPE",
  "STATEFS_GRAMMAR",
  "STATEFS_PREDECESSOR",
  "STATEFS_BINDING",
  "STATEFS_REQUEST",
  "STATEFS_RESULT",
  "STATEFS_TRANSITION",
];
const FD_RULES = [
  "held-dirfd-relative-only/v1",
  "exact-role-identity/v1",
  "same-mount/v1",
  "no-alias/v1",
  "readonly-directory/v1",
  "cloexec-by-role/v1",
  "reject-at-fdcwd-opath-root-path/v1",
];
const METADATA_RULES = [
  "expected-owner-uid-gid/v1",
  "private-mode/v1",
  "regular-link-count-one/v1",
  "directory-link-count-minimum-two/v1",
  "no-follow/v1",
  "no-repeated-inode/v1",
  "ascii-byte-order/v1",
];
const SYSCALL_RULES = [
  "linux-amd64-direct-allowlist/v1",
  "one-shot-mutation/v1",
  "eintr-read-write-only/v1",
  "errno-immediate/v1",
  "close-no-retry/v1",
  "zero-before-syscall/v1",
];
const ORDERING_RULES = [
  "intent-before-effect/v1",
  "write-readback-file-sync-rename-parent-sync/v1",
  "move-source-sync-destination-sync-reobserve/v1",
  "outcome-last/v1",
  "ambiguous-effect-no-retry/v1",
  "fresh-inventory-replan/v1",
];
const PRIVATE_FILESYSTEM_PROFILE = [
  ["platform", "linux"],
  ["architecture", "x86_64"],
  ["byteOrder", "little-endian"],
  ["filesystemMagic", ["0x0000ef53", "0x58465342"]],
  ["rootMode", "0700"],
  ["regularMode", "0600"],
  ["ownerSource", "manager-held-root-observation"],
  ["mountInfoSource", "/proc/self/mountinfo"],
  ["requiredMountOptions", ["rw"]],
  ["forbiddenMountOptions", ["ro"]],
  ["singleMount", true],
  ["remote", false],
  ["overlay", false],
  ["fuse", false],
  ["symlinkRoot", false],
  ["maximumHeldDirectoryDescriptors", 5],
  ["childNonceBytes", 32],
  ["runnerInputFields", ["scratchParent", "runNonceBytes"]],
  ["childNamePrefix", ".oxigraph-statefs-v1-"],
  ["childNameGrammar", "^\\.oxigraph-statefs-v1-[0-9a-f]{64}$"],
  ["childNameBytes", 85],
  [
    "setupRules",
    [
      "copy-nonce-before-path/v1",
      "open-parent-nofollow/v1",
      "mkdirat-once-no-replacement/v1",
      "open-child-nofollow/v1",
      "exact-owner-mode-mount-identity/v1",
      "longest-mountinfo-match/v1",
    ],
  ],
  [
    "recordRules",
    [
      "minimal-decimal-identities/v1",
      "raw-ascii-kernel-release/v1",
      "sorted-unique-decoded-mount-options/v1",
      "digest-mount-point-bytes/v1",
      "report-valid-after-child-crosscheck/v1",
      "no-partial-report/v1",
      "report-after-cleanup/v1",
    ],
  ],
  [
    "cleanupRules",
    [
      "close-all-continue-record-first/v1",
      "no-delete-after-close-error/v1",
      "child-rooted-nofollow-depth-first/v1",
      "remove-child-last/v1",
      "stop-path-mutation-on-first-error/v1",
      "close-cleanup-fds-after-error/v1",
      "close-parent-on-every-exit/v1",
      "no-other-path/v1",
      "cleanup-failure-preserves-test-failure/v1",
    ],
  ],
  [
    "errors",
    [
      "PRIVATE_FS_PROFILE_BOUNDS",
      "PRIVATE_FS_PROFILE_SHAPE",
      "PRIVATE_FS_PROFILE_PATH",
      "PRIVATE_FS_PROFILE_MOUNT",
      "PRIVATE_FS_PROFILE_CLEANUP",
    ],
  ],
  [
    "reportLimits",
    [
      ["kernelReleaseBytes", 256],
      ["mountPointBytes", 4096],
      ["mountOptionCount", 256],
      ["mountOptionBytes", 255],
    ],
  ],
];

export const CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS =
  deepFreeze(
    nullRecord([
      [
        "schema",
        "oxigraph.candidate-containment-guardian-statefs-requirements/v1",
      ],
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
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256 =
  sha256(
    canonicalJsonBytes(CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS),
  );

const PLAN_STATES = new WeakMap();
const REQUEST_STATES = new WeakMap();
const RECEIPT_STATES = new WeakMap();
const TOKEN_STATES = new WeakMap();
const INVENTORY_STATES = new WeakMap();

function failBounds() {
  throw new Error("STATEFS_BOUNDS");
}

function failShape() {
  throw new Error("STATEFS_SHAPE");
}

function failGrammar() {
  throw new Error("STATEFS_GRAMMAR");
}

function failPredecessor() {
  throw new Error("STATEFS_PREDECESSOR");
}

function failBinding() {
  throw new Error("STATEFS_BINDING");
}

function failRequest() {
  throw new Error("STATEFS_REQUEST");
}

function failResult() {
  throw new Error("STATEFS_RESULT");
}

function failTransition() {
  throw new Error("STATEFS_TRANSITION");
}

function semanticDigest(value) {
  return sha256(canonicalJsonBytes(value));
}

function sameValue(left, right) {
  return semanticDigest(left) === semanticDigest(right);
}

function assertPredecessorRequirements() {
  if (
    semanticDigest(CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_V2) !==
      "95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26" ||
    semanticDigest(CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1) !==
      "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773" ||
    semanticDigest(CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1) !==
      "180ad61eba6cbc82d7828c881494dff23a030bdda953d98b8ea42fc88e145874"
  ) {
    failPredecessor();
  }
}

function exactNullableDigest(value) {
  if (value === null) return null;
  return exactDigest(value, "digest", failGrammar);
}

function exactNullableRole(value) {
  if (value === null) return null;
  if (!DIRECTORY_ROLES.includes(value)) failGrammar();
  return value;
}

function componentTextFailure(message) {
  if (message === "component name is outside its UTF-8 byte bound") {
    failBounds();
  }
  if (message === "component name is not text") failShape();
  failGrammar();
}

function plannerArtifactByteFailure(message) {
  if (message === "planner artifact bytes is outside its byte bound") {
    failBounds();
  }
  failShape();
}

function exactNullableName(value) {
  if (value === null) return null;
  const name = exactUnicodeString(
    value,
    "component name",
    { minimumBytes: 1, maximumBytes: 255, nulFree: true },
    componentTextFailure,
  );
  if (
    !/^[\x01-\x7f]+$/u.test(name) ||
    /\//u.test(name) ||
    name === "." ||
    name === ".."
  ) {
    failGrammar();
  }
  return name;
}

function nestedComponentIsExact(parentRole, childRole, name) {
  if (parentRole === "STATE_ROOT") {
    return (
      (childRole === "LIFETIMES" && name === "lifetimes") ||
      (childRole === "STAGING" && name === "staging") ||
      (childRole === "ACTIVE" && name === "active") ||
      (childRole === "CLOSED" && name === "closed") ||
      (childRole === "RECOVERED" && name === "recovered") ||
      (childRole === "QUARANTINED" && name === "quarantined")
    );
  }
  if (parentRole === "LIFETIMES") {
    return childRole === "LIFETIME_SEGMENT" && /^[0-9a-f]{64}$/u.test(name);
  }
  if (
    parentRole === "STAGING" ||
    parentRole === "ACTIVE" ||
    parentRole === "CLOSED" ||
    parentRole === "RECOVERED" ||
    parentRole === "QUARANTINED"
  ) {
    return childRole === "GENERATION" && /^[0-9a-f]{64}$/u.test(name);
  }
  if (parentRole === "GENERATION") {
    return (
      (childRole === "NORMAL_JOURNAL" && name === "normal") ||
      (childRole === "RECOVERY_JOURNAL" && name === "recovery")
    );
  }
  if (parentRole === "RECOVERY_JOURNAL") {
    return childRole === "RECOVERY_ATTEMPT" && /^[0-9a-f]{64}$/u.test(name);
  }
  return false;
}

function regularComponentIsExact(parentRole, name) {
  if (parentRole === "GENERATION") return name === "generation.jsonl";
  if (parentRole === "LIFETIME_SEGMENT" || parentRole === "RECOVERY_ATTEMPT") {
    return /^[0-9]{16}-[0-9a-f]{64}\.jsonl$/u.test(name);
  }
  if (parentRole === "NORMAL_JOURNAL") {
    return (
      /^[0-9]{16}-[0-9a-f]{64}\.jsonl$/u.test(name) ||
      /^\.(?:generation\.jsonl|[0-9]{16}-[0-9a-f]{64}\.jsonl)\.tmp-[0-9a-f]{64}$/u.test(
        name,
      )
    );
  }
  return false;
}

function exactUint64(value, allowZero) {
  const normalized = exactDecimal(value, "uint64", { minimum: 0n }, failBounds);
  const parsed = BigInt(normalized);
  if (parsed > 18446744073709551615n || (!allowZero && parsed === 0n)) {
    failBounds();
  }
  return normalized;
}

function exactUint32(value) {
  return boundedInteger(value, "uint32", 0, 4294967295, failBounds);
}

function permissionString(mode) {
  const permissions = mode & 511;
  if (permissions === 384) return "0600";
  if (permissions === 448) return "0700";
  return "0000";
}

function directoryHandleDigest(
  managerActorEpochSha256,
  role,
  identitySha256,
  parentDirectoryHandleSha256,
  name,
) {
  return semanticDigest(
    nullRecord([
      [
        "schema",
        "oxigraph.candidate-containment-guardian-statefs-directory-handle-preimage/v1",
      ],
      ["managerActorEpochSha256", managerActorEpochSha256],
      ["role", role],
      ["identitySha256", identitySha256],
      ["parentDirectoryHandleSha256", parentDirectoryHandleSha256],
      ["name", name],
    ]),
  );
}

function normalizeNullClaims(
  authorityValue,
  physicalFactsValue,
  nonclaimsValue,
) {
  const authority = exactRecord(
    authorityValue,
    [
      "filesystemExecution",
      "processExecution",
      "cgroupMutation",
      "runtimeRegistration",
      "productExecution",
      "g17Execution",
      "qualification",
      "readiness",
      "promotion",
      "publication",
    ],
    "authority",
    failShape,
  );
  const physicalFacts = exactRecord(
    physicalFactsValue,
    [
      "stateRootOrigin",
      "stateRootHeld",
      "stateRootLocked",
      "filesystemClassified",
      "inventoryObserved",
      "artifactPersisted",
      "directoryCreated",
      "generationMoved",
      "temporaryRemoved",
      "managerAlive",
      "guardianAlive",
      "actorContinuity",
    ],
    "physical facts",
    failShape,
  );
  const nonclaims = exactDenseArray(
    nonclaimsValue,
    "nonclaims",
    NONCLAIMS.length,
    failShape,
  );
  return nullRecord([
    ["authority", authority],
    ["physicalFacts", physicalFacts],
    ["nonclaims", nonclaims],
  ]);
}

function verifyNullClaims(authorityValue, physicalFactsValue, nonclaimsValue) {
  const claims = normalizeNullClaims(
    authorityValue,
    physicalFactsValue,
    nonclaimsValue,
  );
  for (const value of Object.values(claims.authority)) {
    exactBoolean(value, false, "authority value", failGrammar);
  }
  for (const value of Object.values(claims.physicalFacts)) {
    if (value !== null) failGrammar();
  }
  for (const value of claims.nonclaims) {
    if (typeof value !== "string") failGrammar();
  }
  if (semanticDigest(claims.nonclaims) !== semanticDigest(NONCLAIMS)) {
    failGrammar();
  }
}

function heldDirectoryShape(value) {
  const held = exactRecord(
    value,
    HELD_DIRECTORY_OBSERVATION_FIELDS,
    "held directory observation",
    failShape,
  );
  normalizeNullClaims(held.authority, held.physicalFacts, held.nonclaims);
  return held;
}

function verifyHeldDirectoryObservation(value, expectedRole) {
  const held = heldDirectoryShape(value);
  exactUint32(held.ownerUid);
  exactUint32(held.ownerGid);
  exactUint64(held.linkCount, false);
  exactUint64(held.deviceMajor, true);
  exactUint64(held.deviceMinor, true);
  exactUint64(held.inode, false);
  exactUint64(held.mountId, false);
  exactUint64(held.filesystemMagic, true);
  if (
    held.schema !==
      "oxigraph.candidate-containment-guardian-statefs-held-directory-observation/v1" ||
    held.role !== expectedRole ||
    held.accessMode !== "O_RDONLY" ||
    held.fileType !== "DIRECTORY" ||
    held.mode !== "0700" ||
    held.linkCount === "0" ||
    held.linkCount === "1"
  ) {
    failGrammar();
  }
  exactBoolean(
    held.closeOnExec,
    expectedRole !== "STATE_ROOT",
    "close-on-exec",
    failGrammar,
  );
  const prefix = nullRecord([
    ["schema", held.schema],
    ["role", held.role],
    ["accessMode", held.accessMode],
    ["closeOnExec", held.closeOnExec],
    ["fileType", held.fileType],
    ["ownerUid", held.ownerUid],
    ["ownerGid", held.ownerGid],
    ["mode", held.mode],
    ["linkCount", held.linkCount],
    ["deviceMajor", held.deviceMajor],
    ["deviceMinor", held.deviceMinor],
    ["inode", held.inode],
    ["mountId", held.mountId],
    ["filesystemMagic", held.filesystemMagic],
  ]);
  if (
    exactDigest(held.identitySha256, "identity", failGrammar) !==
    semanticDigest(prefix)
  ) {
    failGrammar();
  }
  verifyNullClaims(held.authority, held.physicalFacts, held.nonclaims);
  if (
    !Object.isFrozen(value) ||
    !Object.isFrozen(held.authority) ||
    !Object.isFrozen(held.physicalFacts) ||
    !Object.isFrozen(held.nonclaims)
  ) {
    failShape();
  }
  return value;
}

function scopeKey(handle, inventoryKind, requestedName) {
  return (
    handle +
    "\u0000" +
    inventoryKind +
    "\u0000" +
    (requestedName === null ? "<null>" : requestedName)
  );
}

function scopeProjection(inventory) {
  const projection = nullRecord([]);
  projection.directoryHandleSha256 = inventory.directoryHandleSha256;
  projection.directoryIdentitySha256 = inventory.directory.identitySha256;
  projection.inventoryKind = inventory.inventoryKind;
  projection.requestedName = inventory.requestedName;
  projection.inventorySha256 = inventory.inventorySha256;
  return Object.freeze(projection);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareScopeEntries(left, right) {
  let comparison = compareText(left.pathKey, right.pathKey);
  if (comparison !== 0) return comparison;
  comparison = compareText(
    left.projection.inventoryKind,
    right.projection.inventoryKind,
  );
  if (comparison !== 0) return comparison;
  if (left.projection.requestedName === null) {
    return right.projection.requestedName === null ? 0 : -1;
  }
  if (right.projection.requestedName === null) return 1;
  return compareText(
    left.projection.requestedName,
    right.projection.requestedName,
  );
}

function tokenProjection(scopesValue) {
  const scopes = new Map(scopesValue);
  const sortable = [];
  for (const entry of scopes.values()) sortable.push(entry);
  sortable.sort(compareScopeEntries);
  const projection = [];
  for (const entry of sortable) projection.push(entry.projection);
  return Object.freeze(projection);
}

function mintToken(
  managerActorEpochSha256,
  previousToken,
  request,
  scopesValue,
  rootObservation,
  heldStackValue,
) {
  const scopes = new Map(scopesValue);
  const heldStack = [];
  for (const held of heldStackValue) heldStack.push(held);
  Object.freeze(heldStack);
  if (scopes.size > 221959) failResult();
  const projection = tokenProjection(scopes);
  const previousState =
    previousToken === null ? null : TOKEN_STATES.get(previousToken);
  const revision = previousToken === null ? 0 : previousToken.revision + 1;
  const digest = semanticDigest(projection);
  const tokenValue = nullRecord([]);
  tokenValue.schema =
    "oxigraph.candidate-containment-guardian-statefs-inventory-set/v1";
  tokenValue.requirementsSha256 =
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256;
  tokenValue.managerActorEpochSha256 = managerActorEpochSha256;
  tokenValue.revision = revision;
  tokenValue.previousInventorySetSha256 =
    previousToken === null ? null : previousToken.inventorySetSha256;
  tokenValue.producingRequestSequence = request.requestSequence;
  tokenValue.producingRequestSha256 = request.requestSha256;
  tokenValue.scopeCount = scopes.size;
  tokenValue.inventorySetSha256 = digest;
  tokenValue.authority = AUTHORITY;
  tokenValue.physicalFacts = PHYSICAL_FACTS;
  tokenValue.nonclaims = NONCLAIMS;
  const token = Object.freeze(tokenValue);
  TOKEN_STATES.set(
    token,
    nullRecord([
      ["managerActorEpochSha256", managerActorEpochSha256],
      ["scopes", scopes],
      ["rootObservation", rootObservation],
      ["heldStack", heldStack],
      ["reserved", false],
      ["consumed", false],
      ["previousState", previousState],
    ]),
  );
  return token;
}

function topHeldDirectory(state) {
  let selected = null;
  for (const held of state.heldStack) selected = held;
  if (selected === null) failBinding();
  return selected;
}

function requireToken(token, digest, managerActorEpochSha256, requestSequence) {
  const state = TOKEN_STATES.get(token);
  if (
    state === undefined ||
    state.managerActorEpochSha256 !== managerActorEpochSha256 ||
    token.inventorySetSha256 !== digest ||
    token.producingRequestSequence >= requestSequence ||
    state.reserved ||
    state.consumed
  ) {
    failBinding();
  }
  return state;
}

function findDirectoryScopeByHandle(state, handle) {
  const scopes = new Map(state.scopes);
  const selected = scopes.get(scopeKey(handle, "DIRECTORY", null));
  if (selected === undefined) failBinding();
  return selected;
}

function findRegularScopeByHandle(state, handle, requestedName) {
  const scopes = new Map(state.scopes);
  const selected = scopes.get(scopeKey(handle, "REGULAR_FILE", requestedName));
  if (selected === undefined) failBinding();
  return selected;
}

function heldDirectoryScope(state, role) {
  if (role === "STATE_ROOT") {
    const root = state.rootObservation;
    if (root === null) failBinding();
    const rootHandle = directoryHandleDigest(
      state.managerActorEpochSha256,
      "STATE_ROOT",
      root.identitySha256,
      null,
      null,
    );
    return findDirectoryScopeByHandle(state, rootHandle);
  }
  const top = topHeldDirectory(state);
  if (top.role !== role) failBinding();
  const selected = findDirectoryScopeByHandle(state, top.directoryHandleSha256);
  if (
    selected.inventory.directory.role !== role ||
    selected.inventory.directory.identitySha256 !== top.directoryIdentitySha256
  ) {
    failBinding();
  }
  return selected;
}

function handleIsHeld(state, handle) {
  const root = state.rootObservation;
  if (root !== null) {
    const rootHandle = directoryHandleDigest(
      state.managerActorEpochSha256,
      "STATE_ROOT",
      root.identitySha256,
      null,
      null,
    );
    if (handle === rootHandle) return true;
  }
  for (const held of state.heldStack) {
    if (held.directoryHandleSha256 === handle) return true;
  }
  return false;
}

function findDirectoryScopeByPath(state, pathKey, role) {
  const scopes = new Map(state.scopes);
  let selected = null;
  for (const entry of scopes.values()) {
    if (
      entry.pathKey === pathKey &&
      entry.inventory.inventoryKind === "DIRECTORY" &&
      entry.inventory.directory.role === role
    ) {
      if (selected !== null) failBinding();
      selected = entry;
    }
  }
  if (
    selected === null ||
    !handleIsHeld(state, selected.inventory.directoryHandleSha256)
  ) {
    failBinding();
  }
  return selected;
}

function optionalDirectoryScopeByPath(state, pathKey, role) {
  const scopes = new Map(state.scopes);
  let selected = null;
  for (const entry of scopes.values()) {
    if (
      entry.pathKey === pathKey &&
      entry.inventory.inventoryKind === "DIRECTORY" &&
      entry.inventory.directory.role === role
    ) {
      if (selected !== null) failBinding();
      selected = entry;
    }
  }
  if (
    selected !== null &&
    !handleIsHeld(state, selected.inventory.directoryHandleSha256)
  ) {
    failBinding();
  }
  return selected;
}

function directoryEntry(inventory, name) {
  let found = null;
  for (const entry of inventory.entries) {
    if (entry.name === name) {
      if (found !== null) failTransition();
      found = entry;
    }
  }
  return found;
}

function artifactReference(value, maximumBytes) {
  const artifact = exactRecord(value, ["name", "bytes"], "artifact", failShape);
  const name = exactNullableName(artifact.name);
  if (name === null) failGrammar();
  const bytes = copyBoundedBuffer(
    artifact.bytes,
    "artifact bytes",
    { minimumBytes: 2, maximumBytes },
    failBounds,
  );
  return nullRecord([
    ["name", name],
    ["bytes", bytes],
  ]);
}

function replayLifetime(argumentsValue) {
  const input = exactRecord(
    argumentsValue,
    [
      "segments",
      "expectedStateRootIdentitySha256",
      "expectedLatestLifetimeEpochSha256",
      "expectedLatestRecordSequence",
      "expectedLatestRecordRawSha256",
    ],
    "lifetime replay arguments",
    failShape,
  );
  const segments = exactDenseArray(input.segments, "segments", 5, failBounds);
  const copiedSegments = [];
  let recordCount = 0;
  let aggregateBytes = 0;
  for (const segmentValue of segments) {
    const segment = exactRecord(
      segmentValue,
      ["lifetimeIdentity", "records"],
      "lifetime segment",
      failShape,
    );
    const records = exactDenseArray(
      segment.records,
      "records",
      256,
      failBounds,
    );
    recordCount += records.length;
    if (recordCount > 1280) failBounds();
    const copiedRecords = [];
    for (const recordValue of records) {
      const record = artifactReference(recordValue, 65536);
      aggregateBytes += record.bytes.length;
      if (aggregateBytes > 83886080) failBounds();
      copiedRecords.push(record);
    }
    copiedSegments.push(
      nullRecord([
        ["lifetimeIdentity", segment.lifetimeIdentity],
        ["records", copiedRecords],
      ]),
    );
  }
  try {
    return replayCandidateContainmentGuardianLifetimeV1({
      segments: copiedSegments,
      expectedStateRootIdentitySha256: input.expectedStateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256:
        input.expectedLatestLifetimeEpochSha256,
      expectedLatestRecordSequence: input.expectedLatestRecordSequence,
      expectedLatestRecordRawSha256: input.expectedLatestRecordRawSha256,
    });
  } catch {
    failPredecessor();
  }
}

function lastLifetimeRecord(argumentsValue) {
  let lastSegment = null;
  for (const segment of argumentsValue.segments) lastSegment = segment;
  if (lastSegment === null) return null;
  let lastReference = null;
  for (const reference of lastSegment.records) lastReference = reference;
  if (lastReference === null) return null;
  try {
    return decodeCanonicalJsonLine(
      lastReference.bytes,
      "lifetime record",
      98304,
      failPredecessor,
    ).value;
  } catch {
    failPredecessor();
  }
}

function verifiedGenerationManifest(value) {
  if (value === null) return null;
  const reference = artifactReference(value, 16384);
  try {
    return verifyCandidateContainmentGuardianGenerationManifestV2(reference);
  } catch {
    failPredecessor();
  }
}

function verifiedJournalBundles(value, generationManifest) {
  if (value === null) return null;
  if (generationManifest === null) failPredecessor();
  const references = exactDenseArray(
    value,
    "normal journal bundles",
    18,
    failBounds,
  );
  const verified = [];
  const replayReferences = [];
  let latest = null;
  for (const supplied of references) {
    const reference = artifactReference(supplied, 98304);
    let bundle;
    try {
      bundle = verifyCandidateContainmentGuardianJournalBundleV2(reference);
    } catch {
      failPredecessor();
    }
    verified.push(bundle);
    latest = bundle;
    replayReferences.push(
      nullRecord([
        ["name", bundle.name],
        ["bytes", bundle.bytes],
      ]),
    );
  }
  if (latest !== null) {
    try {
      replayCandidateContainmentGuardianJournalV2(
        nullRecord([
          ["bundles", replayReferences],
          [
            "expectedGenerationIdentitySha256",
            generationManifest.generationIdentity.identitySha256,
          ],
          [
            "expectedBirthGuardianEpochSha256",
            generationManifest.generationIdentity.birthGuardianEpochSha256,
          ],
          ["expectedLatestBundleRawSha256", latest.rawSha256],
          ["reportedCurrentBootIdSha256", null],
        ]),
      );
    } catch {
      failPredecessor();
    }
  }
  return Object.freeze(verified);
}

function targetSelectionFor(lifetimeReplay, generationManifest) {
  try {
    const selection =
      selectCandidateContainmentGuardianLifetimeRecoveryTargetV1(
        nullRecord([
          ["lifetimeReplay", lifetimeReplay],
          [
            "generationIdentitySha256",
            generationManifest.generationIdentity.identitySha256,
          ],
        ]),
      );
    const target = selection.recoveryTargetProjection;
    assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1(
      nullRecord([
        ["selection", selection],
        ["generationIdentitySha256", target.generationIdentitySha256],
        ["targetSha256", target.targetSha256],
        ["targetBootIdSha256", target.targetBootIdSha256],
        [
          "targetDelegatedRootIdentitySha256",
          target.targetDelegatedRootIdentitySha256,
        ],
        ["targetLifetimeEpochSha256", target.targetLifetimeEpochSha256],
      ]),
    );
    return selection;
  } catch {
    failPredecessor();
  }
}

function sameAnchorProjection(left, right) {
  return (
    left.schema === right.schema &&
    left.targetSha256 === right.targetSha256 &&
    left.actorKind === right.actorKind &&
    left.recoveryActorEpochSha256 === right.recoveryActorEpochSha256 &&
    left.attemptDirectoryName === right.attemptDirectoryName &&
    left.expectedStateRootIdentitySha256 ===
      right.expectedStateRootIdentitySha256 &&
    left.expectedCurrentBootIdSha256 === right.expectedCurrentBootIdSha256 &&
    left.expectedDelegatedRootIdentitySha256 ===
      right.expectedDelegatedRootIdentitySha256 &&
    left.expectedLifetimeCgroupIdentitySha256 ===
      right.expectedLifetimeCgroupIdentitySha256 &&
    left.previousRecoveryActorEpochSha256 ===
      right.previousRecoveryActorEpochSha256 &&
    left.previousAttemptDirectoryName === right.previousAttemptDirectoryName &&
    left.previousRecoveryRecordSequence ===
      right.previousRecoveryRecordSequence &&
    left.previousRecoveryRecordRawSha256 ===
      right.previousRecoveryRecordRawSha256
  );
}

function verifiedRecoveryOwners(
  input,
  lifetimeReplay,
  generationManifest,
  normalJournalBundles,
) {
  const recoveryValues = nullRecord([]);
  recoveryValues.recoveryTarget = null;
  recoveryValues.recoveryInventory = null;
  recoveryValues.recoveryReplay = null;
  recoveryValues.recoveryPlan = null;
  recoveryValues.recoveryAttempt = null;
  recoveryValues.recoveryRecord = null;
  recoveryValues.lifetimeAnchorProjection = null;
  recoveryValues.lifetimeAttemptAnchorRawSha256 = null;
  if (input.recoveryTarget === null) {
    if (
      input.recoveryInventory !== null ||
      input.recoveryReplay !== null ||
      input.recoveryPlan !== null ||
      input.recoveryAttempt !== null ||
      input.recoveryRecord !== null
    ) {
      failPredecessor();
    }
    return recoveryValues;
  }
  if (
    generationManifest === null ||
    normalJournalBundles === null ||
    input.recoveryInventory === null ||
    input.recoveryReplay === null ||
    input.recoveryPlan === null
  ) {
    failPredecessor();
  }
  const targetSelection = targetSelectionFor(
    lifetimeReplay,
    generationManifest,
  );
  const manifestReference = nullRecord([]);
  manifestReference.name = generationManifest.name;
  manifestReference.bytes = generationManifest.bytes;
  const bundleReferences = [];
  for (const bundle of normalJournalBundles) {
    const reference = nullRecord([]);
    reference.name = bundle.name;
    reference.bytes = bundle.bytes;
    bundleReferences.push(reference);
  }
  let recoveryOwnerCarrier;
  try {
    verifyCandidateContainmentRecoveryTargetV1(
      nullRecord([
        ["target", input.recoveryTarget],
        ["generationManifest", manifestReference],
        ["normalJournalBundles", bundleReferences],
        ["lifetimeTargetSelection", targetSelection],
      ]),
    );
    verifyCandidateContainmentRecoveryInventoryObservationV1(
      nullRecord([
        ["observation", input.recoveryInventory],
        [
          "expectedGenerationIdentitySha256",
          generationManifest.generationIdentity.identitySha256,
        ],
      ]),
    );
    const externalHead =
      selectCandidateContainmentGuardianLifetimeExternalHeadV1(
        nullRecord([
          ["lifetimeReplay", lifetimeReplay],
          ["targetSha256", input.recoveryTarget.targetSha256],
        ]),
      );
    assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1(
      nullRecord([
        ["externalHead", externalHead],
        ["targetSha256", input.recoveryTarget.targetSha256],
      ]),
    );
    if (input.recoveryPlan.status === "CLOSED_LOCATION_OBSERVED") {
      const closeReceipt =
        selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1(
          nullRecord([
            ["lifetimeReplay", lifetimeReplay],
            ["targetSha256", input.recoveryTarget.targetSha256],
          ]),
        );
      assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1(
        nullRecord([
          ["normalCloseDurabilityReceipt", closeReceipt],
          ["targetSha256", input.recoveryTarget.targetSha256],
        ]),
      );
    }
    recoveryOwnerCarrier = selectCandidateContainmentRecoveryOwnerAssociationV1(
      nullRecord([
        ["target", input.recoveryTarget],
        ["lifecycleInventoryObservation", input.recoveryInventory],
        ["previousRecoveryReplay", input.recoveryReplay],
        ["plan", input.recoveryPlan],
        ["attempt", input.recoveryAttempt],
      ]),
    );
  } catch {
    failPredecessor();
  }
  recoveryValues.recoveryTarget = input.recoveryTarget;
  recoveryValues.recoveryInventory = input.recoveryInventory;
  recoveryValues.recoveryReplay = input.recoveryReplay;
  recoveryValues.recoveryPlan = input.recoveryPlan;
  if (recoveryOwnerCarrier !== null) {
    recoveryValues.lifetimeAnchorProjection =
      recoveryOwnerCarrier.lifetimeAnchorProjection;
    recoveryValues.lifetimeAttemptAnchorRawSha256 =
      recoveryOwnerCarrier.lifetimeAttemptAnchorRawSha256;
  }
  if (input.recoveryAttempt !== null) {
    try {
      if (
        recoveryOwnerCarrier === null ||
        recoveryOwnerCarrier.lifetimeAnchorProjection === null ||
        recoveryOwnerCarrier.lifetimeAttemptAnchorRawSha256 === null
      ) {
        failPredecessor();
      }
      assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
        nullRecord([
          [
            "lifetimeAnchorProjection",
            recoveryOwnerCarrier.lifetimeAnchorProjection,
          ],
          [
            "lifetimeAttemptAnchorRawSha256",
            recoveryOwnerCarrier.lifetimeAttemptAnchorRawSha256,
          ],
          ["targetSha256", input.recoveryTarget.targetSha256],
          [
            "recoveryActorEpochSha256",
            input.recoveryAttempt.recoveryActorEpochSha256,
          ],
        ]),
      );
    } catch {
      failPredecessor();
    }
    recoveryValues.recoveryAttempt = input.recoveryAttempt;
  }
  if (input.recoveryRecord !== null) {
    if (input.recoveryAttempt === null) failPredecessor();
    let verifiedRecord;
    try {
      verifiedRecord = verifyCandidateContainmentRecoveryRecordV1(
        nullRecord([
          ["name", input.recoveryRecord.name],
          ["bytes", input.recoveryRecord.bytes],
        ]),
      );
    } catch {
      failPredecessor();
    }
    if (
      verifiedRecord.attempt.attemptSha256 !==
        input.recoveryAttempt.attemptSha256 ||
      input.artifactBytes === null ||
      sha256(input.artifactBytes) !== verifiedRecord.rawSha256
    ) {
      failPredecessor();
    }
    recoveryValues.recoveryRecord = verifiedRecord;
  }
  return recoveryValues;
}

function autoOwnerValues(input) {
  if (input.lifetimeReplayArguments === null) failPredecessor();
  const values = nullRecord([]);
  values.lifetimeReplay = replayLifetime(input.lifetimeReplayArguments);
  values.generationManifest = verifiedGenerationManifest(
    input.generationManifest,
  );
  values.normalJournalBundles = verifiedJournalBundles(
    input.normalJournalBundles,
    values.generationManifest,
  );
  const recoveryValues = verifiedRecoveryOwners(
    input,
    values.lifetimeReplay,
    values.generationManifest,
    values.normalJournalBundles,
  );
  values.recoveryTarget = recoveryValues.recoveryTarget;
  values.recoveryInventory = recoveryValues.recoveryInventory;
  values.recoveryReplay = recoveryValues.recoveryReplay;
  values.recoveryPlan = recoveryValues.recoveryPlan;
  values.recoveryAttempt = recoveryValues.recoveryAttempt;
  values.recoveryRecord = recoveryValues.recoveryRecord;
  values.lifetimeAnchorProjection = recoveryValues.lifetimeAnchorProjection;
  values.lifetimeAttemptAnchorRawSha256 =
    recoveryValues.lifetimeAttemptAnchorRawSha256;
  return values;
}

function decodedOwnerArtifact(bytes) {
  try {
    return decodeCanonicalJsonLine(
      bytes,
      "statefs owner artifact",
      98304,
      failPredecessor,
    ).value;
  } catch {
    failPredecessor();
  }
}

function artifactSequenceName(value, bytes) {
  let sequenceText;
  if (typeof value.sequence === "string") {
    sequenceText = value.sequence;
  } else if (
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 1 &&
    value.sequence <= 9999999999999999
  ) {
    sequenceText = String(value.sequence);
    while (sequenceText.length < 16) sequenceText = "0" + sequenceText;
  } else {
    failPredecessor();
  }
  if (!/^[0-9]{16}$/u.test(sequenceText)) failPredecessor();
  return sequenceText + "-" + sha256(bytes) + ".jsonl";
}

function verifiedLifetimeArtifact(input, lifetimeReplay) {
  const value = decodedOwnerArtifact(input.artifactBytes);
  if (
    value.schema !==
    "oxigraph.candidate-containment-guardian-lifetime-record/v1"
  ) {
    return null;
  }
  const name = artifactSequenceName(value, input.artifactBytes);
  const rawSha256 = sha256(input.artifactBytes);
  const already = lifetimeReplay.latestLifetimeRecordRawSha256 === rawSha256;
  if (!already) {
    const expectedPrevious =
      lifetimeReplay.latestLifetimeRecordRawSha256 === null
        ? "0000000000000000000000000000000000000000000000000000000000000000"
        : lifetimeReplay.latestLifetimeRecordRawSha256;
    if (value.previousRecordRawSha256 !== expectedPrevious) failPredecessor();
    const segments = [];
    const reference = nullRecord([]);
    reference.name = name;
    reference.bytes = input.artifactBytes;
    const suppliedSegments = input.lifetimeReplayArguments.segments;
    let segmentOrdinal = 0;
    for (const suppliedSegment of suppliedSegments) {
      segmentOrdinal += 1;
      const records = [];
      for (const suppliedRecord of suppliedSegment.records) {
        records.push(artifactReference(suppliedRecord, 65536));
      }
      if (segmentOrdinal === suppliedSegments.length) {
        if (
          suppliedSegment.lifetimeIdentity.identitySha256 !==
          value.lifetimeIdentity.identitySha256
        ) {
          failPredecessor();
        }
        records.push(reference);
      }
      const segment = nullRecord([]);
      segment.lifetimeIdentity = suppliedSegment.lifetimeIdentity;
      segment.records = records;
      segments.push(segment);
    }
    if (segments.length === 0) {
      const segment = nullRecord([]);
      segment.lifetimeIdentity = value.lifetimeIdentity;
      segment.records = [reference];
      segments.push(segment);
    }
    try {
      replayCandidateContainmentGuardianLifetimeV1(
        nullRecord([
          ["segments", segments],
          [
            "expectedStateRootIdentitySha256",
            input.lifetimeReplayArguments.expectedStateRootIdentitySha256,
          ],
          [
            "expectedLatestLifetimeEpochSha256",
            value.lifetimeIdentity.lifetimeEpochSha256,
          ],
          ["expectedLatestRecordSequence", value.sequence],
          ["expectedLatestRecordRawSha256", rawSha256],
        ]),
      );
    } catch {
      failPredecessor();
    }
  }
  return nullRecord([
    ["kind", "LIFETIME_RECORD"],
    ["value", value],
    ["name", name],
    ["bytes", input.artifactBytes],
    ["rawSha256", rawSha256],
    ["already", already],
  ]);
}

function verifiedJournalArtifact(input, ownerValues) {
  if (
    ownerValues.generationManifest === null ||
    ownerValues.normalJournalBundles === null
  ) {
    return null;
  }
  const value = decodedOwnerArtifact(input.artifactBytes);
  if (
    value.schema !== "oxigraph.candidate-containment-guardian-journal-bundle/v2"
  ) {
    return null;
  }
  const name = artifactSequenceName(value, input.artifactBytes);
  const reference = nullRecord([]);
  reference.name = name;
  reference.bytes = input.artifactBytes;
  let verified;
  try {
    verified = verifyCandidateContainmentGuardianJournalBundleV2(reference);
  } catch {
    failPredecessor();
  }
  const replayReferences = [];
  let last = null;
  for (const bundle of ownerValues.normalJournalBundles) {
    const prior = nullRecord([]);
    prior.name = bundle.name;
    prior.bytes = bundle.bytes;
    replayReferences.push(prior);
    last = bundle;
  }
  const already = last !== null && last.rawSha256 === verified.rawSha256;
  if (!already) replayReferences.push(reference);
  try {
    replayCandidateContainmentGuardianJournalV2(
      nullRecord([
        ["bundles", replayReferences],
        [
          "expectedGenerationIdentitySha256",
          ownerValues.generationManifest.generationIdentity.identitySha256,
        ],
        [
          "expectedBirthGuardianEpochSha256",
          ownerValues.generationManifest.generationIdentity
            .birthGuardianEpochSha256,
        ],
        ["expectedLatestBundleRawSha256", verified.rawSha256],
        ["reportedCurrentBootIdSha256", null],
      ]),
    );
  } catch {
    failPredecessor();
  }
  return nullRecord([
    ["kind", "NORMAL_JOURNAL_BUNDLE"],
    ["value", verified],
    ["name", name],
    ["bytes", input.artifactBytes],
    ["rawSha256", verified.rawSha256],
    ["already", already],
  ]);
}

function verifiedAutoArtifact(input, ownerValues) {
  if (input.artifactBytes === null) return null;
  if (ownerValues.recoveryRecord !== null) {
    if (
      ownerValues.recoveryRecord.bytes.length !== input.artifactBytes.length ||
      ownerValues.recoveryRecord.rawSha256 !== sha256(input.artifactBytes)
    ) {
      failPredecessor();
    }
    return nullRecord([
      ["kind", "RECOVERY_RECORD"],
      ["value", ownerValues.recoveryRecord],
      ["name", ownerValues.recoveryRecord.name],
      ["bytes", input.artifactBytes],
      ["rawSha256", ownerValues.recoveryRecord.rawSha256],
      ["already", false],
    ]);
  }
  const lifetime = verifiedLifetimeArtifact(input, ownerValues.lifetimeReplay);
  if (lifetime !== null) return lifetime;
  const journal = verifiedJournalArtifact(input, ownerValues);
  if (journal !== null) return journal;
  failPredecessor();
}

function regularScopeAtPath(state, pathKey, role, requestedName) {
  const directory = findDirectoryScopeByPath(state, pathKey, role);
  return findRegularScopeByHandle(
    state,
    directory.inventory.directoryHandleSha256,
    requestedName,
  );
}

function replayIsFullyInventoried(state, argumentsValue) {
  for (const segment of argumentsValue.segments) {
    const pathKey = "lifetimes/" + segment.lifetimeIdentity.identitySha256;
    findDirectoryScopeByPath(state, pathKey, "LIFETIME_SEGMENT");
    for (const reference of segment.records) {
      const observed = regularScopeAtPath(
        state,
        pathKey,
        "LIFETIME_SEGMENT",
        reference.name,
      ).inventory;
      if (
        observed.entryCount !== 1 ||
        observed.contentBytes === null ||
        observed.contentBytes.length !== reference.bytes.length ||
        sha256(observed.contentBytes) !== sha256(reference.bytes)
      ) {
        failTransition();
      }
    }
  }
}

function autoContextPlan(input, tokenState, ownerValues, tailRecord) {
  replayIsFullyInventoried(tokenState, input.lifetimeReplayArguments);
  const ownerContext = buildOwnerContext(ownerValues);
  let relationship = null;
  if (ownerValues.recoveryPlan !== null) {
    if (ownerValues.recoveryPlan.status === "RECOVERY_ANCHOR_REQUIRED") {
      relationship = contextSpec(
        "RECOVERY_REPLAN",
        "SERVICE_MANAGER",
        null,
        ownerValues.recoveryTarget.targetSha256,
        null,
        null,
        null,
      );
    } else if (
      ownerValues.recoveryPlan.status === "RECOVERY_PLAN_READY" &&
      ownerValues.recoveryAttempt !== null &&
      tailRecord !== null &&
      tailRecord.recordType === "RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE"
    ) {
      relationship = contextSpec(
        "GUARDIAN_HANDOFF",
        "SERVICE_MANAGER",
        ownerValues.recoveryAttempt.actorKind,
        ownerValues.recoveryTarget.targetSha256,
        null,
        null,
        "RECOVERY_CONTROL_HANDOFF",
      );
    }
  } else if (tailRecord !== null) {
    if (tailRecord.recordType === "GUARDIAN_LAUNCH_INTENT_DURABLE") {
      relationship = contextSpec(
        "GUARDIAN_HANDOFF",
        "SERVICE_MANAGER",
        "LIVE_BIRTH_GUARDIAN",
        null,
        null,
        null,
        "NORMAL_CONTROL_HANDOFF",
      );
    } else if (tailRecord.recordType === "GUARDIAN_INITIALIZATION_ADOPTED") {
      relationship = contextSpec(
        "WAIT_GUARDIAN",
        null,
        "LIVE_BIRTH_GUARDIAN",
        null,
        null,
        null,
        "WAIT_STATUS",
      );
    } else if (tailRecord.recordType === "LIFETIME_CLOSED_DURABLE") {
      relationship = contextSpec(
        "TERMINAL",
        null,
        null,
        null,
        null,
        null,
        null,
      );
    }
  }
  if (relationship === null) return null;
  return makePlan(
    input,
    input.currentInventorySet,
    tokenState,
    ownerContext,
    null,
    relationship,
  );
}

function ownerDigest(value, preferredKind) {
  if (value === null) return null;
  if (preferredKind === "target") return value.targetSha256;
  if (preferredKind === "inventory") return value.inventorySha256;
  if (preferredKind === "replay" && value.replaySha256 !== undefined) {
    return value.replaySha256;
  }
  if (preferredKind === "plan" && value.planSha256 !== undefined) {
    return value.planSha256;
  }
  if (preferredKind === "attempt") return value.attemptSha256;
  if (preferredKind === "projection" && value.projectionSha256 !== undefined) {
    return value.projectionSha256;
  }
  return semanticDigest(value);
}

function buildOwnerContext(values) {
  const bundleDigests = [];
  const bundleValues = [];
  if (values.normalJournalBundles !== null) {
    for (const bundle of values.normalJournalBundles) {
      bundleDigests.push(sha256(bundle.bytes));
      bundleValues.push(bundle);
    }
  }
  const projection = nullRecord([
    [
      "schema",
      "oxigraph.candidate-containment-guardian-statefs-owner-context/v1",
    ],
    ["lifetimeReplaySha256", ownerDigest(values.lifetimeReplay, "semantic")],
    ["recoveryTargetSha256", ownerDigest(values.recoveryTarget, "target")],
    [
      "recoveryInventorySha256",
      ownerDigest(values.recoveryInventory, "inventory"),
    ],
    ["recoveryReplaySha256", ownerDigest(values.recoveryReplay, "replay")],
    ["recoveryPlanSha256", ownerDigest(values.recoveryPlan, "plan")],
    ["recoveryAttemptSha256", ownerDigest(values.recoveryAttempt, "attempt")],
    [
      "recoveryRecordRawSha256",
      values.recoveryRecord === null ? null : values.recoveryRecord.rawSha256,
    ],
    [
      "lifetimeAnchorProjectionSha256",
      ownerDigest(values.lifetimeAnchorProjection, "projection"),
    ],
    ["lifetimeAttemptAnchorRawSha256", values.lifetimeAttemptAnchorRawSha256],
    [
      "generationManifestRawSha256",
      values.generationManifest === null
        ? null
        : sha256(values.generationManifest.bytes),
    ],
    ["normalJournalBundleRawSha256s", Object.freeze(bundleDigests)],
  ]);
  const ownerContextSha256 = semanticDigest(projection);
  const bundles =
    values.normalJournalBundles === null ? null : Object.freeze(bundleValues);
  const context = nullRecord([]);
  context.schema =
    "oxigraph.candidate-containment-guardian-statefs-owner-context/v1";
  context.lifetimeReplay = values.lifetimeReplay;
  context.recoveryTarget = values.recoveryTarget;
  context.recoveryInventory = values.recoveryInventory;
  context.recoveryReplay = values.recoveryReplay;
  context.recoveryPlan = values.recoveryPlan;
  context.recoveryAttempt = values.recoveryAttempt;
  context.recoveryRecord = values.recoveryRecord;
  context.lifetimeAnchorProjection = values.lifetimeAnchorProjection;
  context.lifetimeAttemptAnchorRawSha256 =
    values.lifetimeAttemptAnchorRawSha256;
  context.generationManifest = values.generationManifest;
  context.normalJournalBundles = bundles;
  context.ownerContextSha256 = ownerContextSha256;
  context.authority = AUTHORITY;
  context.physicalFacts = PHYSICAL_FACTS;
  context.nonclaims = NONCLAIMS;
  return Object.freeze(context);
}

function emptyOwnerValues() {
  return nullRecord([
    ["lifetimeReplay", null],
    ["recoveryTarget", null],
    ["recoveryInventory", null],
    ["recoveryReplay", null],
    ["recoveryPlan", null],
    ["recoveryAttempt", null],
    ["recoveryRecord", null],
    ["lifetimeAnchorProjection", null],
    ["lifetimeAttemptAnchorRawSha256", null],
    ["generationManifest", null],
    ["normalJournalBundles", null],
  ]);
}

function requestProjection(values) {
  return nullRecord([
    ["schema", values.schema],
    ["requirementsSha256", values.requirementsSha256],
    ["managerActorEpochSha256", values.managerActorEpochSha256],
    ["requestSequence", values.requestSequence],
    ["inventorySetSha256", values.inventorySetSha256],
    ["operation", values.operation],
    ["executionDisposition", values.executionDisposition],
    ["writerKind", values.writerKind],
    ["actorKind", values.actorKind],
    ["targetSha256", values.targetSha256],
    ["requiredDurableRecordType", values.requiredDurableRecordType],
    ["requiredOutcomeRecordType", values.requiredOutcomeRecordType],
    ["inventoryKind", values.inventoryKind],
    ["inventoryDirectoryRole", values.inventoryDirectoryRole],
    ["directoryRoleA", values.directoryRoleA],
    ["directoryIdentitySha256A", values.directoryIdentitySha256A],
    ["directoryHandleSha256A", values.directoryHandleSha256A],
    ["directoryRoleB", values.directoryRoleB],
    ["directoryIdentitySha256B", values.directoryIdentitySha256B],
    ["directoryHandleSha256B", values.directoryHandleSha256B],
    ["nameA", values.nameA],
    ["nameB", values.nameB],
    ["inputByteLength", values.inputByteLength],
    ["inputRawSha256", values.inputRawSha256],
    ["temporaryIdentitySha256", values.temporaryIdentitySha256],
    ["authorizationRawSha256", values.authorizationRawSha256],
    ["unresolvedReceiptSha256", values.unresolvedReceiptSha256],
    ["expectedOutcome", values.expectedOutcome],
    ["authority", AUTHORITY],
    ["physicalFacts", PHYSICAL_FACTS],
    ["nonclaims", NONCLAIMS],
  ]);
}

function makeRequest(spec) {
  const values = nullRecord([]);
  values.bytes = spec.bytes;
  values.inventorySet = spec.inventorySet;
  values.schema = "oxigraph.candidate-containment-guardian-statefs-request/v1";
  values.requirementsSha256 =
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256;
  values.managerActorEpochSha256 = spec.managerActorEpochSha256;
  values.requestSequence = spec.requestSequence;
  values.inventorySetSha256 =
    spec.inventorySet === null ? null : spec.inventorySet.inventorySetSha256;
  values.requestSha256 = null;
  values.operation = spec.operation;
  values.executionDisposition = spec.executionDisposition;
  values.writerKind = spec.writerKind;
  values.actorKind = spec.actorKind;
  values.targetSha256 = spec.targetSha256;
  values.requiredDurableRecordType = spec.requiredDurableRecordType;
  values.requiredOutcomeRecordType = spec.requiredOutcomeRecordType;
  values.inventoryKind = spec.inventoryKind;
  values.inventoryDirectoryRole = spec.inventoryDirectoryRole;
  values.directoryRoleA = spec.directoryRoleA;
  values.directoryIdentitySha256A = spec.directoryIdentitySha256A;
  values.directoryHandleSha256A = spec.directoryHandleSha256A;
  values.directoryRoleB = spec.directoryRoleB;
  values.directoryIdentitySha256B = spec.directoryIdentitySha256B;
  values.directoryHandleSha256B = spec.directoryHandleSha256B;
  values.nameA = spec.nameA;
  values.nameB = spec.nameB;
  values.inputByteLength = spec.bytes === null ? 0 : spec.bytes.length;
  values.inputRawSha256 = spec.bytes === null ? null : sha256(spec.bytes);
  values.temporaryIdentitySha256 = null;
  values.authorizationRawSha256 = spec.authorizationRawSha256;
  values.unresolvedReceiptSha256 = spec.unresolvedReceiptSha256;
  values.expectedOutcome = spec.expectedOutcome;
  if (
    spec.operation === "PERSIST_NOREPLACE" &&
    spec.executionDisposition === "EXECUTE"
  ) {
    values.temporaryIdentitySha256 = semanticDigest(
      nullRecord([
        ["managerActorEpochSha256", spec.managerActorEpochSha256],
        ["authorizationRawSha256", spec.authorizationRawSha256],
        ["operation", spec.operation],
        ["nameB", spec.nameB],
        ["inputRawSha256", values.inputRawSha256],
      ]),
    );
    values.nameA = "." + spec.nameB + ".tmp-" + values.temporaryIdentitySha256;
  }
  values.requestSha256 = semanticDigest(requestProjection(values));
  const requestValue = nullRecord([]);
  requestValue.bytes = null;
  requestValue.inventorySet = values.inventorySet;
  requestValue.schema = values.schema;
  requestValue.requirementsSha256 = values.requirementsSha256;
  requestValue.managerActorEpochSha256 = values.managerActorEpochSha256;
  requestValue.requestSequence = values.requestSequence;
  requestValue.inventorySetSha256 = values.inventorySetSha256;
  requestValue.requestSha256 = values.requestSha256;
  requestValue.operation = values.operation;
  requestValue.executionDisposition = values.executionDisposition;
  requestValue.writerKind = values.writerKind;
  requestValue.actorKind = values.actorKind;
  requestValue.targetSha256 = values.targetSha256;
  requestValue.requiredDurableRecordType = values.requiredDurableRecordType;
  requestValue.requiredOutcomeRecordType = values.requiredOutcomeRecordType;
  requestValue.inventoryKind = values.inventoryKind;
  requestValue.inventoryDirectoryRole = values.inventoryDirectoryRole;
  requestValue.directoryRoleA = values.directoryRoleA;
  requestValue.directoryIdentitySha256A = values.directoryIdentitySha256A;
  requestValue.directoryHandleSha256A = values.directoryHandleSha256A;
  requestValue.directoryRoleB = values.directoryRoleB;
  requestValue.directoryIdentitySha256B = values.directoryIdentitySha256B;
  requestValue.directoryHandleSha256B = values.directoryHandleSha256B;
  requestValue.nameA = values.nameA;
  requestValue.nameB = values.nameB;
  requestValue.inputByteLength = values.inputByteLength;
  requestValue.inputRawSha256 = values.inputRawSha256;
  requestValue.temporaryIdentitySha256 = values.temporaryIdentitySha256;
  requestValue.authorizationRawSha256 = values.authorizationRawSha256;
  requestValue.unresolvedReceiptSha256 = values.unresolvedReceiptSha256;
  requestValue.expectedOutcome = values.expectedOutcome;
  requestValue.authority = AUTHORITY;
  requestValue.physicalFacts = PHYSICAL_FACTS;
  requestValue.nonclaims = NONCLAIMS;
  let request = Object.freeze(requestValue);
  if (values.bytes !== null) {
    const entries = [];
    entries.push(["inventorySet", values.inventorySet]);
    entries.push(["schema", values.schema]);
    entries.push(["requirementsSha256", values.requirementsSha256]);
    entries.push(["managerActorEpochSha256", values.managerActorEpochSha256]);
    entries.push(["requestSequence", values.requestSequence]);
    entries.push(["inventorySetSha256", values.inventorySetSha256]);
    entries.push(["requestSha256", values.requestSha256]);
    entries.push(["operation", values.operation]);
    entries.push(["executionDisposition", values.executionDisposition]);
    entries.push(["writerKind", values.writerKind]);
    entries.push(["actorKind", values.actorKind]);
    entries.push(["targetSha256", values.targetSha256]);
    entries.push([
      "requiredDurableRecordType",
      values.requiredDurableRecordType,
    ]);
    entries.push([
      "requiredOutcomeRecordType",
      values.requiredOutcomeRecordType,
    ]);
    entries.push(["inventoryKind", values.inventoryKind]);
    entries.push(["inventoryDirectoryRole", values.inventoryDirectoryRole]);
    entries.push(["directoryRoleA", values.directoryRoleA]);
    entries.push(["directoryIdentitySha256A", values.directoryIdentitySha256A]);
    entries.push(["directoryHandleSha256A", values.directoryHandleSha256A]);
    entries.push(["directoryRoleB", values.directoryRoleB]);
    entries.push(["directoryIdentitySha256B", values.directoryIdentitySha256B]);
    entries.push(["directoryHandleSha256B", values.directoryHandleSha256B]);
    entries.push(["nameA", values.nameA]);
    entries.push(["nameB", values.nameB]);
    entries.push(["inputByteLength", values.inputByteLength]);
    entries.push(["inputRawSha256", values.inputRawSha256]);
    entries.push(["temporaryIdentitySha256", values.temporaryIdentitySha256]);
    entries.push(["authorizationRawSha256", values.authorizationRawSha256]);
    entries.push(["unresolvedReceiptSha256", values.unresolvedReceiptSha256]);
    entries.push(["expectedOutcome", values.expectedOutcome]);
    entries.push(["authority", AUTHORITY]);
    entries.push(["physicalFacts", PHYSICAL_FACTS]);
    entries.push(["nonclaims", NONCLAIMS]);
    request = frozenCopyOnReadBytes(values.bytes, entries);
  }
  REQUEST_STATES.set(
    request,
    nullRecord([
      ["status", "PLANNED"],
      ["token", spec.inventorySet],
      ["ownerContext", spec.ownerContext],
      ["rootObservation", spec.rootObservation],
    ]),
  );
  return request;
}

function planProjection(values) {
  return nullRecord([
    ["schema", values.schema],
    ["requirementsSha256", values.requirementsSha256],
    ["managerActorEpochSha256", values.managerActorEpochSha256],
    ["requestSequence", values.requestSequence],
    ["inventorySetSha256", values.inventorySetSha256],
    ["planKind", values.planKind],
    ["managerDisposition", values.managerDisposition],
    ["operation", values.operation],
    ["writerKind", values.writerKind],
    ["actorKind", values.actorKind],
    ["targetSha256", values.targetSha256],
    ["requiredDurableRecordType", values.requiredDurableRecordType],
    ["requiredOutcomeRecordType", values.requiredOutcomeRecordType],
    ["guardianAction", values.guardianAction],
    ["requestSha256", values.requestSha256],
    ["ownerContextSha256", values.ownerContextSha256],
    ["authority", AUTHORITY],
    ["physicalFacts", PHYSICAL_FACTS],
    ["nonclaims", NONCLAIMS],
  ]);
}

function makePlan(
  input,
  token,
  tokenState,
  ownerContext,
  requestSpec,
  contextSpec,
) {
  const request = requestSpec === null ? null : makeRequest(requestSpec);
  const values = nullRecord([]);
  values.schema = "oxigraph.candidate-containment-guardian-statefs-plan/v1";
  values.requirementsSha256 =
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256;
  values.managerActorEpochSha256 = input.managerActorEpochSha256;
  values.requestSequence = input.requestSequence;
  values.inventorySetSha256 = token === null ? null : token.inventorySetSha256;
  values.planKind = request === null ? "CONTEXT_ONLY" : "REQUEST";
  values.managerDisposition =
    request === null ? contextSpec.managerDisposition : "STATEFS_REQUEST";
  values.operation = request === null ? null : request.operation;
  values.writerKind =
    request === null ? contextSpec.writerKind : request.writerKind;
  values.actorKind =
    request === null ? contextSpec.actorKind : request.actorKind;
  values.targetSha256 =
    request === null ? contextSpec.targetSha256 : request.targetSha256;
  values.requiredDurableRecordType =
    request === null
      ? contextSpec.requiredDurableRecordType
      : request.requiredDurableRecordType;
  values.requiredOutcomeRecordType =
    request === null
      ? contextSpec.requiredOutcomeRecordType
      : request.requiredOutcomeRecordType;
  values.guardianAction = request === null ? contextSpec.guardianAction : null;
  values.requestSha256 = request === null ? null : request.requestSha256;
  values.ownerContextSha256 = ownerContext.ownerContextSha256;
  values.planSha256 = semanticDigest(planProjection(values));
  const plan = nullRecord([]);
  plan.request = request;
  plan.ownerContext = ownerContext;
  plan.inventorySet = token;
  plan.schema = values.schema;
  plan.requirementsSha256 = values.requirementsSha256;
  plan.managerActorEpochSha256 = values.managerActorEpochSha256;
  plan.requestSequence = values.requestSequence;
  plan.inventorySetSha256 = values.inventorySetSha256;
  plan.planKind = values.planKind;
  plan.managerDisposition = values.managerDisposition;
  plan.operation = values.operation;
  plan.writerKind = values.writerKind;
  plan.actorKind = values.actorKind;
  plan.targetSha256 = values.targetSha256;
  plan.requiredDurableRecordType = values.requiredDurableRecordType;
  plan.requiredOutcomeRecordType = values.requiredOutcomeRecordType;
  plan.guardianAction = values.guardianAction;
  plan.requestSha256 = values.requestSha256;
  plan.ownerContextSha256 = values.ownerContextSha256;
  plan.planSha256 = values.planSha256;
  plan.authority = AUTHORITY;
  plan.physicalFacts = PHYSICAL_FACTS;
  plan.nonclaims = NONCLAIMS;
  Object.freeze(plan);
  PLAN_STATES.set(
    plan,
    nullRecord([
      ["status", "FRESH"],
      ["ownerContext", ownerContext],
      ["request", request],
      ["tokenState", tokenState],
    ]),
  );
  if (request !== null && tokenState !== null) {
    TOKEN_STATES.set(
      token,
      nullRecord([
        ["managerActorEpochSha256", tokenState.managerActorEpochSha256],
        ["scopes", tokenState.scopes],
        ["rootObservation", tokenState.rootObservation],
        ["heldStack", tokenState.heldStack],
        ["reserved", true],
        ["consumed", false],
        ["previousState", tokenState.previousState],
      ]),
    );
  }
  return plan;
}

function requestSpec(details) {
  return nullRecord([
    ["bytes", details.bytes === undefined ? null : details.bytes],
    ["inventorySet", details.inventorySet],
    ["managerActorEpochSha256", details.managerActorEpochSha256],
    ["requestSequence", details.requestSequence],
    ["operation", details.operation],
    [
      "executionDisposition",
      details.executionDisposition === undefined
        ? "EXECUTE"
        : details.executionDisposition,
    ],
    [
      "writerKind",
      details.writerKind === undefined ? null : details.writerKind,
    ],
    ["actorKind", details.actorKind === undefined ? null : details.actorKind],
    [
      "targetSha256",
      details.targetSha256 === undefined ? null : details.targetSha256,
    ],
    [
      "requiredDurableRecordType",
      details.requiredDurableRecordType === undefined
        ? null
        : details.requiredDurableRecordType,
    ],
    [
      "requiredOutcomeRecordType",
      details.requiredOutcomeRecordType === undefined
        ? null
        : details.requiredOutcomeRecordType,
    ],
    [
      "inventoryKind",
      details.inventoryKind === undefined ? "NONE" : details.inventoryKind,
    ],
    [
      "inventoryDirectoryRole",
      details.inventoryDirectoryRole === undefined
        ? null
        : details.inventoryDirectoryRole,
    ],
    [
      "directoryRoleA",
      details.directoryRoleA === undefined ? null : details.directoryRoleA,
    ],
    [
      "directoryIdentitySha256A",
      details.directoryIdentitySha256A === undefined
        ? null
        : details.directoryIdentitySha256A,
    ],
    [
      "directoryHandleSha256A",
      details.directoryHandleSha256A === undefined
        ? null
        : details.directoryHandleSha256A,
    ],
    [
      "directoryRoleB",
      details.directoryRoleB === undefined ? null : details.directoryRoleB,
    ],
    [
      "directoryIdentitySha256B",
      details.directoryIdentitySha256B === undefined
        ? null
        : details.directoryIdentitySha256B,
    ],
    [
      "directoryHandleSha256B",
      details.directoryHandleSha256B === undefined
        ? null
        : details.directoryHandleSha256B,
    ],
    ["nameA", details.nameA === undefined ? null : details.nameA],
    ["nameB", details.nameB === undefined ? null : details.nameB],
    [
      "authorizationRawSha256",
      details.authorizationRawSha256 === undefined
        ? null
        : details.authorizationRawSha256,
    ],
    [
      "unresolvedReceiptSha256",
      details.unresolvedReceiptSha256 === undefined
        ? null
        : details.unresolvedReceiptSha256,
    ],
    ["expectedOutcome", details.expectedOutcome],
    ["tokenState", details.tokenState],
    ["ownerContext", details.ownerContext],
    [
      "rootObservation",
      details.rootObservation === undefined ? null : details.rootObservation,
    ],
  ]);
}

function contextSpec(
  managerDisposition,
  writerKind,
  actorKind,
  targetSha256,
  requiredDurableRecordType,
  requiredOutcomeRecordType,
  guardianAction,
) {
  return nullRecord([
    ["managerDisposition", managerDisposition],
    ["writerKind", writerKind],
    ["actorKind", actorKind],
    ["targetSha256", targetSha256],
    ["requiredDurableRecordType", requiredDurableRecordType],
    ["requiredOutcomeRecordType", requiredOutcomeRecordType],
    ["guardianAction", guardianAction],
  ]);
}

function requireNull(value) {
  if (value !== null) failRequest();
}

function capturePlannerShape(message) {
  throw new Error(message);
}

function validatePlannerEnvelope(inputValue) {
  let input;
  try {
    input = exactRecord(
      inputValue,
      PLANNER_INPUT_FIELDS,
      "statefs planner input",
      capturePlannerShape,
    );
  } catch (error) {
    if (
      error.message !==
      "statefs planner input fields are not exact enumerable own data"
    ) {
      failShape();
    }
    let inspected;
    try {
      const observedKeys = Object.keys(inputValue);
      inspected = exactRecord(
        inputValue,
        observedKeys,
        "statefs planner input",
        capturePlannerShape,
      );
    } catch {
      failShape();
    }
    if (!Object.hasOwn(inspected, "requestSequence")) failShape();
    boundedInteger(
      inspected.requestSequence,
      "request sequence",
      0,
      999999,
      failBounds,
    );
    failShape();
  }
  boundedInteger(
    input.requestSequence,
    "request sequence",
    0,
    999999,
    failBounds,
  );
  if (input.stateRootObservation !== null) {
    heldDirectoryShape(input.stateRootObservation);
  }
  if (input.artifactBytes !== null) {
    copyBoundedBuffer(
      input.artifactBytes,
      "planner artifact bytes",
      { minimumBytes: 0, maximumBytes: 98304 },
      plannerArtifactByteFailure,
    );
  }
  exactNullableName(input.nameA);
  exactNullableName(input.nameB);
  exactDigest(
    input.managerActorEpochSha256,
    "manager actor epoch",
    failGrammar,
  );
  if (!PLANNER_KINDS.includes(input.kind)) failGrammar();
  exactNullableDigest(input.inventorySetSha256);
  exactNullableRole(input.inventoryDirectoryRole);
  exactNullableRole(input.directoryRoleA);
  exactNullableRole(input.directoryRoleB);
  if (
    input.kind === "INVENTORY" &&
    input.nameA !== null &&
    input.directoryRoleA !== null &&
    ((input.inventoryDirectoryRole !== null &&
      !nestedComponentIsExact(
        input.directoryRoleA,
        input.inventoryDirectoryRole,
        input.nameA,
      )) ||
      (input.inventoryDirectoryRole === null &&
        !regularComponentIsExact(input.directoryRoleA, input.nameA)))
  ) {
    failGrammar();
  }
  if (
    input.expectedOutcome !== null &&
    !OUTCOMES.includes(input.expectedOutcome)
  ) {
    failGrammar();
  }
  return input;
}

function explicitFieldsAreNull(input) {
  return (
    input.unresolvedReceipt === null &&
    input.generationManifest === null &&
    input.normalJournalBundles === null &&
    input.lifetimeReplayArguments === null &&
    input.recoveryTarget === null &&
    input.recoveryInventory === null &&
    input.recoveryReplay === null &&
    input.recoveryPlan === null &&
    input.recoveryAttempt === null &&
    input.recoveryRecord === null &&
    input.artifactBytes === null
  );
}

function planLockOperation(input) {
  if (
    input.inventorySetSha256 !== null ||
    input.currentInventorySet !== null ||
    !explicitFieldsAreNull(input) ||
    input.inventoryDirectoryRole !== null ||
    input.directoryRoleA !== null ||
    input.directoryRoleB !== null ||
    input.nameA !== null ||
    input.nameB !== null ||
    input.expectedOutcome !== "LOCK_HELD" ||
    input.stateRootObservation === null
  ) {
    failRequest();
  }
  const root = verifyHeldDirectoryObservation(
    input.stateRootObservation,
    "STATE_ROOT",
  );
  const handle = directoryHandleDigest(
    input.managerActorEpochSha256,
    "STATE_ROOT",
    root.identitySha256,
    null,
    null,
  );
  const ownerContext = buildOwnerContext(emptyOwnerValues());
  const spec = requestSpec(
    nullRecord([
      ["inventorySet", null],
      ["managerActorEpochSha256", input.managerActorEpochSha256],
      ["requestSequence", input.requestSequence],
      ["operation", "LOCK_EX_NB"],
      ["writerKind", "SERVICE_MANAGER"],
      ["directoryRoleA", "STATE_ROOT"],
      ["directoryIdentitySha256A", root.identitySha256],
      ["directoryHandleSha256A", handle],
      ["expectedOutcome", "LOCK_HELD"],
      ["tokenState", null],
      ["ownerContext", ownerContext],
      ["rootObservation", root],
    ]),
  );
  return makePlan(input, null, null, ownerContext, spec, null);
}

function planInventoryOperation(input) {
  const tokenState = requireToken(
    input.currentInventorySet,
    input.inventorySetSha256,
    input.managerActorEpochSha256,
    input.requestSequence,
  );
  if (
    input.stateRootObservation !== null ||
    !explicitFieldsAreNull(input) ||
    input.directoryRoleB !== null ||
    input.nameB !== null ||
    input.expectedOutcome !== "INVENTORY_OBSERVED" ||
    input.currentInventorySet === null
  ) {
    failRequest();
  }
  let directoryRoleA;
  let directoryIdentitySha256A;
  let directoryHandleSha256A;
  let inventoryKind;
  if (input.inventoryDirectoryRole === "STATE_ROOT") {
    if (input.directoryRoleA !== "STATE_ROOT" || input.nameA !== null) {
      failRequest();
    }
    const root = tokenState.rootObservation;
    if (root === null) failBinding();
    directoryRoleA = "STATE_ROOT";
    directoryIdentitySha256A = root.identitySha256;
    directoryHandleSha256A = directoryHandleDigest(
      input.managerActorEpochSha256,
      "STATE_ROOT",
      root.identitySha256,
      null,
      null,
    );
    inventoryKind = "DIRECTORY";
  } else if (input.inventoryDirectoryRole !== null) {
    if (input.directoryRoleA === null || input.nameA === null) failRequest();
    const parent = heldDirectoryScope(tokenState, input.directoryRoleA);
    directoryRoleA = input.directoryRoleA;
    directoryIdentitySha256A = parent.inventory.directory.identitySha256;
    directoryHandleSha256A = parent.inventory.directoryHandleSha256;
    inventoryKind = "DIRECTORY";
  } else {
    if (input.directoryRoleA === null || input.nameA === null) failRequest();
    const parent = heldDirectoryScope(tokenState, input.directoryRoleA);
    directoryRoleA = input.directoryRoleA;
    directoryIdentitySha256A = parent.inventory.directory.identitySha256;
    directoryHandleSha256A = parent.inventory.directoryHandleSha256;
    inventoryKind = "REGULAR_FILE";
  }
  const ownerContext = buildOwnerContext(emptyOwnerValues());
  const spec = requestSpec(
    nullRecord([
      ["inventorySet", input.currentInventorySet],
      ["managerActorEpochSha256", input.managerActorEpochSha256],
      ["requestSequence", input.requestSequence],
      ["operation", "INVENTORY"],
      ["writerKind", "SERVICE_MANAGER"],
      ["inventoryKind", inventoryKind],
      ["inventoryDirectoryRole", input.inventoryDirectoryRole],
      ["directoryRoleA", directoryRoleA],
      ["directoryIdentitySha256A", directoryIdentitySha256A],
      ["directoryHandleSha256A", directoryHandleSha256A],
      ["nameA", input.nameA],
      ["expectedOutcome", "INVENTORY_OBSERVED"],
      ["tokenState", tokenState],
      ["ownerContext", ownerContext],
    ]),
  );
  return makePlan(
    input,
    input.currentInventorySet,
    tokenState,
    ownerContext,
    spec,
    null,
  );
}

function planReleaseOperation(input) {
  const tokenState = requireToken(
    input.currentInventorySet,
    input.inventorySetSha256,
    input.managerActorEpochSha256,
    input.requestSequence,
  );
  if (
    input.stateRootObservation !== null ||
    !explicitFieldsAreNull(input) ||
    input.inventoryDirectoryRole !== null ||
    input.directoryRoleA === null ||
    input.directoryRoleA === "STATE_ROOT" ||
    input.directoryRoleB !== null ||
    input.nameA !== null ||
    input.nameB !== null ||
    input.expectedOutcome !== "DIRECTORY_RELEASED" ||
    input.currentInventorySet === null
  ) {
    failRequest();
  }
  const top = topHeldDirectory(tokenState);
  const directory = findDirectoryScopeByHandle(
    tokenState,
    top.directoryHandleSha256,
  );
  if (
    top.role !== input.directoryRoleA ||
    top.directoryHandleSha256 !== directory.inventory.directoryHandleSha256 ||
    top.directoryIdentitySha256 !== directory.inventory.directory.identitySha256
  ) {
    failBinding();
  }
  const ownerContext = buildOwnerContext(emptyOwnerValues());
  const spec = requestSpec(
    nullRecord([
      ["inventorySet", input.currentInventorySet],
      ["managerActorEpochSha256", input.managerActorEpochSha256],
      ["requestSequence", input.requestSequence],
      ["operation", "RELEASE_DIRECTORY"],
      ["writerKind", "SERVICE_MANAGER"],
      ["directoryRoleA", input.directoryRoleA],
      [
        "directoryIdentitySha256A",
        directory.inventory.directory.identitySha256,
      ],
      ["directoryHandleSha256A", directory.inventory.directoryHandleSha256],
      ["expectedOutcome", "DIRECTORY_RELEASED"],
      ["tokenState", tokenState],
      ["ownerContext", ownerContext],
    ]),
  );
  return makePlan(
    input,
    input.currentInventorySet,
    tokenState,
    ownerContext,
    spec,
    null,
  );
}

function makeAutoRequestPlan(input, tokenState, ownerValues, details) {
  const ownerContext = buildOwnerContext(ownerValues);
  const spec = requestSpec(
    nullRecord([
      ["bytes", details.bytes],
      ["inventorySet", input.currentInventorySet],
      ["managerActorEpochSha256", input.managerActorEpochSha256],
      ["requestSequence", input.requestSequence],
      ["operation", details.operation],
      ["executionDisposition", details.executionDisposition],
      ["writerKind", details.writerKind],
      ["actorKind", details.actorKind],
      ["targetSha256", details.targetSha256],
      ["requiredDurableRecordType", details.requiredDurableRecordType],
      ["requiredOutcomeRecordType", details.requiredOutcomeRecordType],
      ["directoryRoleA", details.directoryRoleA],
      ["directoryIdentitySha256A", details.directoryIdentitySha256A],
      ["directoryHandleSha256A", details.directoryHandleSha256A],
      ["directoryRoleB", details.directoryRoleB],
      ["directoryIdentitySha256B", details.directoryIdentitySha256B],
      ["directoryHandleSha256B", details.directoryHandleSha256B],
      ["nameA", details.nameA],
      ["nameB", details.nameB],
      ["authorizationRawSha256", details.authorizationRawSha256],
      ["expectedOutcome", details.expectedOutcome],
      ["tokenState", tokenState],
      ["ownerContext", ownerContext],
    ]),
  );
  return makePlan(
    input,
    input.currentInventorySet,
    tokenState,
    ownerContext,
    spec,
    null,
  );
}

function exactArtifactInventoryDisposition(scope, artifact) {
  const inventory = scope.inventory;
  if (
    inventory.inventoryKind !== "REGULAR_FILE" ||
    inventory.requestedName !== artifact.name
  ) {
    failTransition();
  }
  if (
    inventory.entryCount === 0 &&
    inventory.entries.length === 0 &&
    inventory.contentBytes === null
  ) {
    return "ABSENT";
  }
  let entry = null;
  for (const candidate of inventory.entries) entry = candidate;
  if (
    inventory.entryCount !== 1 ||
    inventory.entries.length !== 1 ||
    entry === null ||
    entry.name !== artifact.name ||
    entry.kind !== "REGULAR" ||
    inventory.contentBytes === null ||
    inventory.contentBytes.length !== artifact.bytes.length ||
    sha256(inventory.contentBytes) !== artifact.rawSha256 ||
    entry.contentByteLength !== artifact.bytes.length ||
    entry.contentRawSha256 !== artifact.rawSha256
  ) {
    failTransition();
  }
  return "EXACT";
}

function planLifetimeArtifact(input, tokenState, ownerValues, artifact) {
  const identitySha256 = artifact.value.lifetimeIdentity.identitySha256;
  const lifetimes = findDirectoryScopeByPath(
    tokenState,
    "lifetimes",
    "LIFETIMES",
  );
  const parentEntry = directoryEntry(lifetimes.inventory, identitySha256);
  const segment = optionalDirectoryScopeByPath(
    tokenState,
    "lifetimes/" + identitySha256,
    "LIFETIME_SEGMENT",
  );
  if (parentEntry === null) {
    if (segment !== null || artifact.already) failTransition();
    return makeAutoRequestPlan(
      input,
      tokenState,
      ownerValues,
      nullRecord([
        ["operation", "MKDIR_SYNC"],
        ["executionDisposition", "EXECUTE"],
        ["writerKind", artifact.value.writerKind],
        ["actorKind", null],
        ["targetSha256", artifact.value.targetSha256],
        ["requiredDurableRecordType", null],
        ["requiredOutcomeRecordType", artifact.value.recordType],
        ["directoryRoleA", "LIFETIMES"],
        [
          "directoryIdentitySha256A",
          lifetimes.inventory.directory.identitySha256,
        ],
        ["directoryHandleSha256A", lifetimes.inventory.directoryHandleSha256],
        ["nameA", identitySha256],
        ["authorizationRawSha256", artifact.value.previousRecordRawSha256],
        ["expectedOutcome", "DIRECTORY_CREATED"],
      ]),
    );
  }
  if (parentEntry.kind !== "DIRECTORY") failTransition();
  if (segment === null) {
    if (artifact.already) failTransition();
    return makeAutoRequestPlan(
      input,
      tokenState,
      ownerValues,
      nullRecord([
        ["operation", "MKDIR_SYNC"],
        ["executionDisposition", "OBSERVATION_ONLY"],
        ["writerKind", artifact.value.writerKind],
        ["actorKind", null],
        ["targetSha256", artifact.value.targetSha256],
        ["requiredDurableRecordType", null],
        ["requiredOutcomeRecordType", artifact.value.recordType],
        ["directoryRoleA", "LIFETIMES"],
        [
          "directoryIdentitySha256A",
          lifetimes.inventory.directory.identitySha256,
        ],
        ["directoryHandleSha256A", lifetimes.inventory.directoryHandleSha256],
        ["nameA", identitySha256],
        ["authorizationRawSha256", artifact.value.previousRecordRawSha256],
        ["expectedOutcome", "DIRECTORY_ALREADY_PRESENT_EXACT"],
      ]),
    );
  }
  const recordScope = findRegularScopeByHandle(
    tokenState,
    segment.inventory.directoryHandleSha256,
    artifact.name,
  );
  const disposition = exactArtifactInventoryDisposition(recordScope, artifact);
  if (disposition === "ABSENT" && artifact.already) failTransition();
  if (disposition === "EXACT" && !artifact.already) failTransition();
  return makeAutoRequestPlan(
    input,
    tokenState,
    ownerValues,
    nullRecord([
      ["bytes", artifact.bytes],
      ["operation", "PERSIST_NOREPLACE"],
      [
        "executionDisposition",
        disposition === "EXACT" ? "OBSERVATION_ONLY" : "EXECUTE",
      ],
      ["writerKind", artifact.value.writerKind],
      ["actorKind", null],
      ["targetSha256", artifact.value.targetSha256],
      ["requiredDurableRecordType", null],
      ["requiredOutcomeRecordType", null],
      ["directoryRoleA", "LIFETIME_SEGMENT"],
      ["directoryIdentitySha256A", segment.inventory.directory.identitySha256],
      ["directoryHandleSha256A", segment.inventory.directoryHandleSha256],
      ["nameB", artifact.name],
      ["authorizationRawSha256", artifact.value.previousRecordRawSha256],
      [
        "expectedOutcome",
        disposition === "EXACT" ? "ALREADY_PRESENT_EXACT" : "PERSISTED",
      ],
    ]),
  );
}

function planRecoveryArtifact(input, tokenState, ownerValues, artifact) {
  if (
    ownerValues.recoveryTarget === null ||
    ownerValues.recoveryPlan === null ||
    ownerValues.recoveryPlan.status !== "RECOVERY_PLAN_READY" ||
    ownerValues.recoveryAttempt === null ||
    ownerValues.recoveryRecord === null ||
    ownerValues.lifetimeAnchorProjection === null ||
    ownerValues.lifetimeAttemptAnchorRawSha256 === null
  ) {
    failTransition();
  }
  const pathKey =
    "active/" +
    ownerValues.generationManifest.generationIdentity.identitySha256 +
    "/recovery/" +
    ownerValues.recoveryAttempt.attemptDirectoryName;
  const attemptDirectory = findDirectoryScopeByPath(
    tokenState,
    pathKey,
    "RECOVERY_ATTEMPT",
  );
  const recordScope = findRegularScopeByHandle(
    tokenState,
    attemptDirectory.inventory.directoryHandleSha256,
    artifact.name,
  );
  if (exactArtifactInventoryDisposition(recordScope, artifact) !== "ABSENT") {
    failTransition();
  }
  return makeAutoRequestPlan(
    input,
    tokenState,
    ownerValues,
    nullRecord([
      ["bytes", artifact.bytes],
      ["operation", "PERSIST_NOREPLACE"],
      ["executionDisposition", "EXECUTE"],
      ["writerKind", ownerValues.recoveryAttempt.actorKind],
      ["actorKind", ownerValues.recoveryAttempt.actorKind],
      ["targetSha256", ownerValues.recoveryTarget.targetSha256],
      ["requiredDurableRecordType", artifact.value.priorState],
      ["requiredOutcomeRecordType", null],
      ["directoryRoleA", "RECOVERY_ATTEMPT"],
      [
        "directoryIdentitySha256A",
        attemptDirectory.inventory.directory.identitySha256,
      ],
      [
        "directoryHandleSha256A",
        attemptDirectory.inventory.directoryHandleSha256,
      ],
      ["nameB", artifact.name],
      ["authorizationRawSha256", artifact.value.previousRecordRawSha256],
      ["expectedOutcome", "PERSISTED"],
    ]),
  );
}

function deterministicTemporaryName(
  managerActorEpochSha256,
  authorizationRawSha256,
  name,
  bytes,
) {
  const identitySha256 = semanticDigest(
    nullRecord([
      ["managerActorEpochSha256", managerActorEpochSha256],
      ["authorizationRawSha256", authorizationRawSha256],
      ["operation", "PERSIST_NOREPLACE"],
      ["nameB", name],
      ["inputRawSha256", sha256(bytes)],
    ]),
  );
  return "." + name + ".tmp-" + identitySha256;
}

function planJournalArtifact(input, tokenState, ownerValues, artifact) {
  if (
    ownerValues.generationManifest === null ||
    ownerValues.normalJournalBundles === null
  ) {
    failTransition();
  }
  const generationName =
    ownerValues.generationManifest.generationIdentity.identitySha256;
  const normal = findDirectoryScopeByPath(
    tokenState,
    "active/" + generationName + "/normal",
    "NORMAL_JOURNAL",
  );
  const recordScope = findRegularScopeByHandle(
    tokenState,
    normal.inventory.directoryHandleSha256,
    artifact.name,
  );
  const disposition = exactArtifactInventoryDisposition(recordScope, artifact);
  const temporaryName = deterministicTemporaryName(
    input.managerActorEpochSha256,
    artifact.value.previousBundleRawSha256,
    artifact.name,
    artifact.bytes,
  );
  if (
    directoryEntry(normal.inventory, temporaryName) !== null ||
    (disposition === "ABSENT" && artifact.already) ||
    (disposition === "EXACT" && !artifact.already)
  ) {
    failTransition();
  }
  return makeAutoRequestPlan(
    input,
    tokenState,
    ownerValues,
    nullRecord([
      ["bytes", artifact.bytes],
      ["operation", "PERSIST_NOREPLACE"],
      [
        "executionDisposition",
        disposition === "EXACT" ? "OBSERVATION_ONLY" : "EXECUTE",
      ],
      ["writerKind", "LIVE_BIRTH_GUARDIAN"],
      ["actorKind", "LIVE_BIRTH_GUARDIAN"],
      ["targetSha256", generationName],
      ["requiredDurableRecordType", artifact.value.priorState],
      ["requiredOutcomeRecordType", null],
      ["directoryRoleA", "NORMAL_JOURNAL"],
      ["directoryIdentitySha256A", normal.inventory.directory.identitySha256],
      ["directoryHandleSha256A", normal.inventory.directoryHandleSha256],
      ["nameB", artifact.name],
      ["authorizationRawSha256", artifact.value.previousBundleRawSha256],
      [
        "expectedOutcome",
        disposition === "EXACT" ? "ALREADY_PRESENT_EXACT" : "PERSISTED",
      ],
    ]),
  );
}

function exactGenerationDirectoryEntry(entry, name) {
  if (
    entry === null ||
    entry.name !== name ||
    entry.kind !== "DIRECTORY" ||
    entry.mode !== "0700" ||
    entry.linkCount === "0" ||
    entry.linkCount === "1" ||
    entry.contentByteLength !== null ||
    entry.contentRawSha256 !== null
  ) {
    failTransition();
  }
  return entry;
}

function planCloseMove(input, tokenState, ownerValues) {
  if (
    ownerValues.recoveryPlan === null ||
    (ownerValues.recoveryPlan.status !== "CLOSE_MOVE_REQUIRED" &&
      ownerValues.recoveryPlan.status !== "CLOSED_LOCATION_OBSERVED")
  ) {
    return null;
  }
  if (
    ownerValues.recoveryTarget === null ||
    ownerValues.generationManifest === null ||
    ownerValues.normalJournalBundles === null
  ) {
    failTransition();
  }
  let latestBundle = null;
  for (const bundle of ownerValues.normalJournalBundles) latestBundle = bundle;
  if (latestBundle === null || latestBundle.recordType !== "CLOSED_DURABLE") {
    failTransition();
  }
  const generationName =
    ownerValues.generationManifest.generationIdentity.identitySha256;
  const active = findDirectoryScopeByPath(tokenState, "active", "ACTIVE");
  const closed = findDirectoryScopeByPath(tokenState, "closed", "CLOSED");
  const sourceEntry = directoryEntry(active.inventory, generationName);
  const destinationEntry = directoryEntry(closed.inventory, generationName);
  let operation;
  let executionDisposition;
  let expectedOutcome;
  if (
    ownerValues.recoveryPlan.status === "CLOSE_MOVE_REQUIRED" &&
    sourceEntry !== null &&
    destinationEntry === null
  ) {
    exactGenerationDirectoryEntry(sourceEntry, generationName);
    operation = "MOVE_NOREPLACE_SYNC";
    executionDisposition = "EXECUTE";
    expectedOutcome = "MOVED";
  } else if (
    ownerValues.recoveryPlan.status === "CLOSE_MOVE_REQUIRED" &&
    sourceEntry === null &&
    destinationEntry !== null
  ) {
    exactGenerationDirectoryEntry(destinationEntry, generationName);
    operation = "MOVE_SYNC_REOBSERVE";
    executionDisposition = "EXECUTE";
    expectedOutcome = "MOVE_SYNC_COMPLETED";
  } else if (
    ownerValues.recoveryPlan.status === "CLOSED_LOCATION_OBSERVED" &&
    sourceEntry === null &&
    destinationEntry !== null
  ) {
    exactGenerationDirectoryEntry(destinationEntry, generationName);
    operation = "MOVE_NOREPLACE_SYNC";
    executionDisposition = "OBSERVATION_ONLY";
    expectedOutcome = "DESTINATION_ALREADY_PRESENT_EXACT";
  } else {
    failTransition();
  }
  return makeAutoRequestPlan(
    input,
    tokenState,
    ownerValues,
    nullRecord([
      ["operation", operation],
      ["executionDisposition", executionDisposition],
      ["writerKind", "SERVICE_MANAGER"],
      ["actorKind", "LIVE_BIRTH_GUARDIAN"],
      ["targetSha256", ownerValues.recoveryTarget.targetSha256],
      ["requiredDurableRecordType", "CLOSED_DURABLE"],
      ["requiredOutcomeRecordType", "NORMAL_CLOSE_RECEIPT_DURABLE"],
      ["directoryRoleA", "ACTIVE"],
      ["directoryIdentitySha256A", active.inventory.directory.identitySha256],
      ["directoryHandleSha256A", active.inventory.directoryHandleSha256],
      ["directoryRoleB", "CLOSED"],
      ["directoryIdentitySha256B", closed.inventory.directory.identitySha256],
      ["directoryHandleSha256B", closed.inventory.directoryHandleSha256],
      ["nameA", generationName],
      ["nameB", generationName],
      ["authorizationRawSha256", latestBundle.rawSha256],
      ["expectedOutcome", expectedOutcome],
    ]),
  );
}

function sameInventoryEntry(left, right) {
  return (
    left.name === right.name &&
    left.kind === right.kind &&
    left.mode === right.mode &&
    left.ownerUid === right.ownerUid &&
    left.ownerGid === right.ownerGid &&
    left.linkCount === right.linkCount &&
    left.byteLength === right.byteLength &&
    left.deviceMajor === right.deviceMajor &&
    left.deviceMinor === right.deviceMinor &&
    left.inode === right.inode &&
    left.mountId === right.mountId &&
    left.filesystemMagic === right.filesystemMagic
  );
}

function planTemporaryCleanup(input, tokenState, ownerValues) {
  if (
    ownerValues.recoveryPlan !== null ||
    ownerValues.generationManifest === null ||
    ownerValues.normalJournalBundles === null
  ) {
    return null;
  }
  let finalBundle = null;
  for (const bundle of ownerValues.normalJournalBundles) finalBundle = bundle;
  if (finalBundle === null || finalBundle.recordType !== "CLOSED_DURABLE") {
    return null;
  }
  const generationName =
    ownerValues.generationManifest.generationIdentity.identitySha256;
  const normal = findDirectoryScopeByPath(
    tokenState,
    "active/" + generationName + "/normal",
    "NORMAL_JOURNAL",
  );
  const temporaryName = deterministicTemporaryName(
    input.managerActorEpochSha256,
    finalBundle.previousBundleRawSha256,
    finalBundle.name,
    finalBundle.bytes,
  );
  const temporaryScope = findRegularScopeByHandle(
    tokenState,
    normal.inventory.directoryHandleSha256,
    temporaryName,
  );
  const artifact = nullRecord([
    ["name", temporaryName],
    ["bytes", finalBundle.bytes],
    ["rawSha256", finalBundle.rawSha256],
  ]);
  const disposition = exactArtifactInventoryDisposition(
    temporaryScope,
    artifact,
  );
  const parentEntry = directoryEntry(normal.inventory, temporaryName);
  let fileEntry = null;
  for (const entry of temporaryScope.inventory.entries) fileEntry = entry;
  if (
    (disposition === "ABSENT" && parentEntry !== null) ||
    (disposition === "EXACT" &&
      (parentEntry === null ||
        fileEntry === null ||
        !sameInventoryEntry(parentEntry, fileEntry)))
  ) {
    failTransition();
  }
  return makeAutoRequestPlan(
    input,
    tokenState,
    ownerValues,
    nullRecord([
      ["operation", "TEMP_CLEANUP"],
      [
        "executionDisposition",
        disposition === "EXACT" ? "EXECUTE" : "OBSERVATION_ONLY",
      ],
      ["writerKind", "LIVE_BIRTH_GUARDIAN"],
      ["actorKind", "LIVE_BIRTH_GUARDIAN"],
      ["targetSha256", generationName],
      ["requiredDurableRecordType", "CLOSED_DURABLE"],
      ["requiredOutcomeRecordType", null],
      ["directoryRoleA", "NORMAL_JOURNAL"],
      ["directoryIdentitySha256A", normal.inventory.directory.identitySha256],
      ["directoryHandleSha256A", normal.inventory.directoryHandleSha256],
      ["nameA", temporaryName],
      ["authorizationRawSha256", finalBundle.rawSha256],
      [
        "expectedOutcome",
        disposition === "EXACT" ? "TEMP_REMOVED" : "TEMP_ALREADY_ABSENT",
      ],
    ]),
  );
}

function planAutoOperation(input) {
  let ownerValues = null;
  let artifact = null;
  if (
    input.lifetimeReplayArguments !== null ||
    input.generationManifest !== null ||
    input.normalJournalBundles !== null ||
    input.recoveryTarget !== null ||
    input.recoveryInventory !== null ||
    input.recoveryReplay !== null ||
    input.recoveryPlan !== null ||
    input.recoveryAttempt !== null ||
    input.recoveryRecord !== null ||
    input.artifactBytes !== null
  ) {
    ownerValues = autoOwnerValues(input);
    if (input.artifactBytes !== null) {
      artifact = verifiedAutoArtifact(input, ownerValues);
    }
  }
  const tokenState = requireToken(
    input.currentInventorySet,
    input.inventorySetSha256,
    input.managerActorEpochSha256,
    input.requestSequence,
  );
  if (
    input.stateRootObservation !== null ||
    input.currentInventorySet === null ||
    input.inventoryDirectoryRole !== null ||
    input.directoryRoleA !== null ||
    input.directoryRoleB !== null ||
    input.nameA !== null ||
    input.nameB !== null ||
    input.expectedOutcome !== null ||
    input.unresolvedReceipt !== null
  ) {
    failRequest();
  }
  if (ownerValues === null) failTransition();
  const tailRecord = lastLifetimeRecord(input.lifetimeReplayArguments);
  if (artifact !== null) {
    if (artifact.kind === "LIFETIME_RECORD") {
      return planLifetimeArtifact(input, tokenState, ownerValues, artifact);
    }
    if (artifact.kind === "RECOVERY_RECORD") {
      return planRecoveryArtifact(input, tokenState, ownerValues, artifact);
    }
    if (artifact.kind === "NORMAL_JOURNAL_BUNDLE") {
      return planJournalArtifact(input, tokenState, ownerValues, artifact);
    }
  }
  if (input.artifactBytes === null) {
    const movePlan = planCloseMove(input, tokenState, ownerValues);
    if (movePlan !== null) return movePlan;
    const cleanupPlan = planTemporaryCleanup(input, tokenState, ownerValues);
    if (cleanupPlan !== null) return cleanupPlan;
    const contextPlan = autoContextPlan(
      input,
      tokenState,
      ownerValues,
      tailRecord,
    );
    if (contextPlan !== null) return contextPlan;
  }
  failTransition();
}

function normalizeNativeObservation(value) {
  const native = exactRecord(
    value,
    NATIVE_OBSERVATION_FIELDS,
    "native observation",
    failResult,
  );
  if (
    ![
      "ABSENT",
      "REGULAR",
      "DIRECTORY",
      "SYMLINK",
      "FIFO",
      "BLOCK_DEVICE",
      "CHARACTER_DEVICE",
      "SOCKET",
      "OTHER",
    ].includes(native.kind) ||
    (native.role !== "NONE" && !DIRECTORY_ROLES.includes(native.role))
  ) {
    failResult();
  }
  if (native.name !== null) {
    exactUnicodeString(
      native.name,
      "native name",
      { minimumBytes: 1, maximumBytes: 255, nulFree: true },
      failResult,
    );
  }
  try {
    exactUint64(native.deviceMajor, true);
    exactUint64(native.deviceMinor, true);
    exactUint64(native.inode, true);
    exactUint64(native.mountId, true);
    exactUint64(native.byteLength, true);
    exactUint64(native.linkCount, true);
    exactUint64(native.filesystemMagic, true);
    exactUint32(native.mode);
    exactUint32(native.ownerUid);
    exactUint32(native.ownerGid);
    boundedInteger(
      native.contentOffset,
      "content offset",
      0,
      98304,
      failResult,
    );
    boundedInteger(
      native.contentLength,
      "content length",
      0,
      98304,
      failResult,
    );
  } catch {
    failResult();
  }
  return native;
}

function normalizeExecutorResult(request, value) {
  const result = exactRecord(
    value,
    EXECUTOR_RESULT_FIELDS,
    "executor result",
    failResult,
  );
  if (
    result.schema !==
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1" ||
    result.abiVersion !== 1 ||
    result.requestSha256 !== request.requestSha256 ||
    result.operation !== request.operation ||
    !EXECUTOR_RESULT_STATUSES.includes(result.status) ||
    !EFFECT_CLASSES.includes(result.effectClass)
  ) {
    failResult();
  }
  boundedInteger(result.errno, "errno", 0, 4095, failResult);
  boundedInteger(result.completedStepCount, "step count", 0, 15, failResult);
  boundedInteger(result.bytesConsumed, "bytes consumed", 0, 98304, failResult);
  boundedInteger(
    result.returnedDirectoryFd,
    "returned directory fd",
    -1,
    2147483647,
    failResult,
  );
  const observations = exactDenseArray(
    result.observations,
    "executor observations",
    257,
    failResult,
  );
  const normalizedObservations = [];
  for (const observation of observations) {
    normalizedObservations.push(normalizeNativeObservation(observation));
  }
  let outputBytes = null;
  if (result.outputBytes !== null) {
    outputBytes = copyBoundedBuffer(
      result.outputBytes,
      "executor output",
      { minimumBytes: 0, maximumBytes: 98304 },
      failResult,
    );
  }
  const errnoExpected =
    result.status === "SYSCALL_FAILED" || result.status === "FAULT_INJECTED";
  if (
    (errnoExpected && result.errno === 0) ||
    (!errnoExpected && result.errno !== 0)
  ) {
    failResult();
  }
  if (
    request.operation === "INVENTORY" &&
    result.effectClass === "MUTATION_OBSERVED_NOT_FULLY_SYNCED"
  ) {
    failResult();
  }
  const normalized = nullRecord([]);
  normalized.schema = result.schema;
  normalized.abiVersion = result.abiVersion;
  normalized.requestSha256 = result.requestSha256;
  normalized.operation = result.operation;
  normalized.status = result.status;
  normalized.effectClass = result.effectClass;
  normalized.lastCompletedStep = result.lastCompletedStep;
  normalized.failedStep = result.failedStep;
  normalized.errno = result.errno;
  normalized.completedStepCount = result.completedStepCount;
  normalized.bytesConsumed = result.bytesConsumed;
  normalized.observations = Object.freeze(normalizedObservations);
  normalized.outputBytes = outputBytes;
  normalized.returnedDirectoryFd = result.returnedDirectoryFd;
  return Object.freeze(normalized);
}

function heldDirectoryFromNative(native) {
  const prefix = nullRecord([
    [
      "schema",
      "oxigraph.candidate-containment-guardian-statefs-held-directory-observation/v1",
    ],
    ["role", native.role],
    ["accessMode", "O_RDONLY"],
    ["closeOnExec", native.role !== "STATE_ROOT"],
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
  ]);
  const held = nullRecord([]);
  held.schema = prefix.schema;
  held.role = prefix.role;
  held.accessMode = prefix.accessMode;
  held.closeOnExec = prefix.closeOnExec;
  held.fileType = prefix.fileType;
  held.ownerUid = prefix.ownerUid;
  held.ownerGid = prefix.ownerGid;
  held.mode = prefix.mode;
  held.linkCount = prefix.linkCount;
  held.deviceMajor = prefix.deviceMajor;
  held.deviceMinor = prefix.deviceMinor;
  held.inode = prefix.inode;
  held.mountId = prefix.mountId;
  held.filesystemMagic = prefix.filesystemMagic;
  held.identitySha256 = semanticDigest(prefix);
  held.authority = AUTHORITY;
  held.physicalFacts = PHYSICAL_FACTS;
  held.nonclaims = NONCLAIMS;
  return Object.freeze(held);
}

function entryKindIsConsistent(native) {
  const type = native.mode & 61440;
  if (native.kind === "REGULAR") return type === 32768;
  if (native.kind === "DIRECTORY") return type === 16384;
  if (native.kind === "SYMLINK") return type === 40960;
  if (native.kind === "FIFO") return type === 4096;
  if (native.kind === "BLOCK_DEVICE") return type === 24576;
  if (native.kind === "CHARACTER_DEVICE") return type === 8192;
  if (native.kind === "SOCKET") return type === 49152;
  return native.kind === "OTHER";
}

function inventoryEntryFromNative(native, contentBytes) {
  const entry = nullRecord([]);
  entry.name = native.name;
  entry.kind = native.kind;
  entry.mode = permissionString(native.mode);
  entry.ownerUid = native.ownerUid;
  entry.ownerGid = native.ownerGid;
  entry.linkCount = native.linkCount;
  entry.byteLength = native.byteLength;
  entry.deviceMajor = native.deviceMajor;
  entry.deviceMinor = native.deviceMinor;
  entry.inode = native.inode;
  entry.mountId = native.mountId;
  entry.filesystemMagic = native.filesystemMagic;
  entry.contentByteLength = contentBytes === null ? null : contentBytes.length;
  entry.contentRawSha256 = contentBytes === null ? null : sha256(contentBytes);
  return Object.freeze(entry);
}

function compareInventoryEntries(left, right) {
  return compareText(left.name, right.name);
}

function makeInventory(
  request,
  directory,
  directoryHandleSha256,
  inventoryKind,
  requestedName,
  entryValues,
  contentBytesValue,
  pathKey,
) {
  const entries = [];
  for (const entry of entryValues) entries.push(entry);
  entries.sort(compareInventoryEntries);
  Object.freeze(entries);
  const contentBytes =
    contentBytesValue === null
      ? null
      : copyBoundedBuffer(
          contentBytesValue,
          "inventory content",
          { minimumBytes: 0, maximumBytes: 98304 },
          failResult,
        );
  const projection = nullRecord([
    [
      "schema",
      "oxigraph.candidate-containment-guardian-statefs-inventory-observation/v1",
    ],
    ["requestSha256", request.requestSha256],
    ["directory", directory],
    ["directoryHandleSha256", directoryHandleSha256],
    ["inventoryKind", inventoryKind],
    ["requestedName", requestedName],
    ["entryCount", entries.length],
    ["entries", entries],
    ["contentByteLength", contentBytes === null ? null : contentBytes.length],
    ["contentRawSha256", contentBytes === null ? null : sha256(contentBytes)],
  ]);
  const inventorySha256 = semanticDigest(projection);
  let inventory;
  if (contentBytes === null) {
    const value = nullRecord([]);
    value.schema =
      "oxigraph.candidate-containment-guardian-statefs-inventory-observation/v1";
    value.requestSha256 = request.requestSha256;
    value.directory = directory;
    value.directoryHandleSha256 = directoryHandleSha256;
    value.inventoryKind = inventoryKind;
    value.requestedName = requestedName;
    value.entryCount = entries.length;
    value.entries = entries;
    value.contentBytes = null;
    value.inventorySha256 = inventorySha256;
    value.authority = AUTHORITY;
    value.physicalFacts = PHYSICAL_FACTS;
    value.nonclaims = NONCLAIMS;
    inventory = Object.freeze(value);
  } else {
    const retained = copyBoundedBuffer(
      contentBytes,
      "retained inventory content",
      { minimumBytes: 0, maximumBytes: 98304 },
      failResult,
    );
    const descriptors = nullRecord([]);
    descriptors.schema = {
      value:
        "oxigraph.candidate-containment-guardian-statefs-inventory-observation/v1",
      enumerable: true,
    };
    descriptors.requestSha256 = {
      value: request.requestSha256,
      enumerable: true,
    };
    descriptors.directory = { value: directory, enumerable: true };
    descriptors.directoryHandleSha256 = {
      value: directoryHandleSha256,
      enumerable: true,
    };
    descriptors.inventoryKind = { value: inventoryKind, enumerable: true };
    descriptors.requestedName = { value: requestedName, enumerable: true };
    descriptors.entryCount = { value: entries.length, enumerable: true };
    descriptors.entries = { value: entries, enumerable: true };
    descriptors.contentBytes = {
      enumerable: true,
      get() {
        return copyBoundedBuffer(
          retained,
          "inventory content copy",
          { minimumBytes: 0, maximumBytes: 98304 },
          failResult,
        );
      },
    };
    descriptors.inventorySha256 = { value: inventorySha256, enumerable: true };
    descriptors.authority = { value: AUTHORITY, enumerable: true };
    descriptors.physicalFacts = { value: PHYSICAL_FACTS, enumerable: true };
    descriptors.nonclaims = { value: NONCLAIMS, enumerable: true };
    let view = Object.create(null);
    view = Object.create(null, descriptors);
    inventory = Object.freeze(view);
  }
  INVENTORY_STATES.set(inventory, nullRecord([["pathKey", pathKey]]));
  return inventory;
}

function appendPath(parentPath, name) {
  return parentPath === "" ? name : parentPath + "/" + name;
}

function directoryEntryNameIsSafe(role, entry) {
  if (!entryKindIsConsistent(entry)) return false;
  if (entry.kind === "REGULAR") {
    if (entry.mode !== 33152 || entry.linkCount !== "1") return false;
  }
  if (entry.kind === "DIRECTORY") {
    if (
      entry.mode !== 16832 ||
      entry.linkCount === "0" ||
      entry.linkCount === "1"
    ) {
      return false;
    }
  }
  if (role === "STATE_ROOT") {
    return (
      entry.kind === "DIRECTORY" && ROOT_DIRECTORY_NAMES.includes(entry.name)
    );
  }
  if (role === "LIFETIMES") {
    return entry.kind === "DIRECTORY" && /^[0-9a-f]{64}$/u.test(entry.name);
  }
  if (
    ["STAGING", "ACTIVE", "CLOSED", "RECOVERED", "QUARANTINED"].includes(role)
  ) {
    return entry.kind === "DIRECTORY" && /^[0-9a-f]{64}$/u.test(entry.name);
  }
  if (role === "LIFETIME_SEGMENT" || role === "RECOVERY_ATTEMPT") {
    return (
      entry.kind === "REGULAR" &&
      /^[0-9]{16}-[0-9a-f]{64}\.jsonl$/u.test(entry.name)
    );
  }
  if (role === "GENERATION") {
    return (
      (entry.name === "generation.jsonl" && entry.kind === "REGULAR") ||
      ((entry.name === "normal" || entry.name === "recovery") &&
        entry.kind === "DIRECTORY")
    );
  }
  if (role === "NORMAL_JOURNAL") {
    return (
      entry.kind === "REGULAR" &&
      (/^[0-9]{16}-[0-9a-f]{64}\.jsonl$/u.test(entry.name) ||
        /^\.(?:generation\.jsonl|[0-9]{16}-[0-9a-f]{64}\.jsonl)\.tmp-[0-9a-f]{64}$/u.test(
          entry.name,
        ))
    );
  }
  if (role === "RECOVERY_JOURNAL") {
    return entry.kind === "DIRECTORY" && /^[0-9a-f]{64}$/u.test(entry.name);
  }
  return false;
}

function directoryInventoryIsSafe(role, target, entries, expectedDirectory) {
  if (
    target.kind !== "DIRECTORY" ||
    target.role !== role ||
    target.name !== null ||
    target.mode !== 16832 ||
    target.ownerUid !== expectedDirectory.ownerUid ||
    target.ownerGid !== expectedDirectory.ownerGid ||
    target.deviceMajor !== expectedDirectory.deviceMajor ||
    target.deviceMinor !== expectedDirectory.deviceMinor ||
    target.mountId !== expectedDirectory.mountId ||
    target.filesystemMagic !== expectedDirectory.filesystemMagic ||
    target.linkCount === "0" ||
    target.linkCount === "1"
  ) {
    return false;
  }
  const names = new Set();
  const identities = new Set();
  for (const entry of entries) {
    if (
      entry.name === null ||
      names.has(entry.name) ||
      identities.has(
        entry.deviceMajor +
          ":" +
          entry.deviceMinor +
          ":" +
          entry.inode +
          ":" +
          entry.mountId,
      ) ||
      entry.ownerUid !== target.ownerUid ||
      entry.ownerGid !== target.ownerGid ||
      entry.deviceMajor !== target.deviceMajor ||
      entry.deviceMinor !== target.deviceMinor ||
      entry.inode === "0" ||
      entry.mountId !== target.mountId ||
      entry.filesystemMagic !== target.filesystemMagic ||
      !directoryEntryNameIsSafe(role, entry)
    ) {
      return false;
    }
    names.add(entry.name);
    identities.add(
      entry.deviceMajor +
        ":" +
        entry.deviceMinor +
        ":" +
        entry.inode +
        ":" +
        entry.mountId,
    );
  }
  if (role === "STATE_ROOT") {
    if (names.size !== 6) return false;
    for (const name of ROOT_DIRECTORY_NAMES) {
      if (!names.has(name)) return false;
    }
  }
  if (role === "LIFETIMES" && entries.length > 256) return false;
  if (
    (role === "STAGING" ||
      role === "ACTIVE" ||
      role === "CLOSED" ||
      role === "RECOVERED" ||
      role === "QUARANTINED") &&
    entries.length > 256
  ) {
    return false;
  }
  if (role === "LIFETIME_SEGMENT" && entries.length > 256) return false;
  if (role === "GENERATION") {
    if (entries.length !== 3) return false;
    if (
      !names.has("generation.jsonl") ||
      !names.has("normal") ||
      !names.has("recovery")
    ) {
      return false;
    }
  }
  if (role === "NORMAL_JOURNAL") {
    let finals = 0;
    let temporaries = 0;
    for (const entry of entries) {
      if (/^[0-9]{16}-[0-9a-f]{64}\.jsonl$/u.test(entry.name)) finals += 1;
      else temporaries += 1;
    }
    if (finals > 18 || temporaries > 1) return false;
  }
  if (role === "RECOVERY_JOURNAL" && entries.length > 4) return false;
  if (role === "RECOVERY_ATTEMPT" && entries.length > 24) return false;
  return true;
}

function inventoryFromResult(request, result, tokenState, rootObservation) {
  if (request.inventoryKind === "DIRECTORY") {
    if (result.status !== "COMPLETE" || result.effectClass !== "COMPLETE") {
      failResult();
    }
    const observations = result.observations;
    if (
      observations.length < 1 ||
      observations.length > 257 ||
      result.outputBytes !== null
    ) {
      failResult();
    }
    const target = observations[0];
    const entryValues = [];
    const nativeEntries = [];
    let first = true;
    for (const native of observations) {
      if (first) {
        first = false;
      } else {
        if (!directoryEntryObservationIsAbiExact(native)) failResult();
        nativeEntries.push(native);
        entryValues.push(inventoryEntryFromNative(native, null));
      }
    }
    let directory;
    let handle;
    let pathKey;
    if (request.inventoryDirectoryRole === "STATE_ROOT") {
      directory = rootObservation;
      handle = request.directoryHandleSha256A;
      pathKey = "";
      const observedRoot = heldDirectoryFromNative(target);
      if (!sameValue(directory, observedRoot)) failResult();
    } else {
      const parent = findDirectoryScopeByHandle(
        tokenState,
        request.directoryHandleSha256A,
      );
      directory = heldDirectoryFromNative(target);
      handle = directoryHandleDigest(
        request.managerActorEpochSha256,
        request.inventoryDirectoryRole,
        directory.identitySha256,
        request.directoryHandleSha256A,
        request.nameA,
      );
      pathKey = appendPath(parent.pathKey, request.nameA);
      const parentEntry = directoryEntry(parent.inventory, request.nameA);
      if (
        parentEntry === null ||
        parentEntry.kind !== "DIRECTORY" ||
        parentEntry.inode !== directory.inode ||
        parentEntry.deviceMajor !== directory.deviceMajor ||
        parentEntry.deviceMinor !== directory.deviceMinor ||
        parentEntry.mountId !== directory.mountId
      ) {
        failResult();
      }
    }
    const expectedDirectory =
      request.inventoryDirectoryRole === "STATE_ROOT"
        ? rootObservation
        : findDirectoryScopeByHandle(tokenState, request.directoryHandleSha256A)
            .inventory.directory;
    const safe = directoryInventoryIsSafe(
      request.inventoryDirectoryRole,
      target,
      nativeEntries,
      expectedDirectory,
    );
    const inventory = makeInventory(
      request,
      directory,
      handle,
      "DIRECTORY",
      null,
      entryValues,
      null,
      pathKey,
    );
    return nullRecord([
      ["inventory", inventory],
      ["safe", safe],
    ]);
  }
  if (
    request.inventoryKind !== "REGULAR_FILE" ||
    result.status !== "COMPLETE" ||
    result.effectClass !== "COMPLETE" ||
    result.observations.length !== 1
  ) {
    failResult();
  }
  const parent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  const native = result.observations[0];
  const absent = native.kind === "ABSENT";
  let safe = true;
  let content = null;
  const entries = [];
  if (absent) {
    if (
      native.role !== request.directoryRoleA ||
      native.name !== request.nameA ||
      native.deviceMajor !== "0" ||
      native.deviceMinor !== "0" ||
      native.inode !== "0" ||
      native.mountId !== "0" ||
      native.byteLength !== "0" ||
      native.linkCount !== "0" ||
      native.mode !== 0 ||
      native.ownerUid !== 0 ||
      native.ownerGid !== 0 ||
      native.filesystemMagic !== "0" ||
      result.outputBytes === null ||
      result.outputBytes.length !== 0
    ) {
      failResult();
    }
  } else {
    if (
      native.kind !== "REGULAR" ||
      native.role !== request.directoryRoleA ||
      native.name !== request.nameA ||
      result.outputBytes === null ||
      result.outputBytes.length !== native.contentLength ||
      native.contentOffset !== 0
    ) {
      failResult();
    }
    content = result.outputBytes;
    entries.push(inventoryEntryFromNative(native, content));
    safe =
      entryKindIsConsistent(native) &&
      native.mode === 33152 &&
      native.ownerUid === parent.inventory.directory.ownerUid &&
      native.ownerGid === parent.inventory.directory.ownerGid &&
      native.deviceMajor === parent.inventory.directory.deviceMajor &&
      native.deviceMinor === parent.inventory.directory.deviceMinor &&
      native.inode !== "0" &&
      native.linkCount === "1" &&
      native.mountId === parent.inventory.directory.mountId &&
      native.filesystemMagic === parent.inventory.directory.filesystemMagic;
  }
  const inventory = makeInventory(
    request,
    parent.inventory.directory,
    request.directoryHandleSha256A,
    "REGULAR_FILE",
    request.nameA,
    entries,
    content,
    parent.pathKey,
  );
  return nullRecord([
    ["inventory", inventory],
    ["safe", safe],
  ]);
}

function scopesWithInventories(previousState, request, inventories, resetRoot) {
  const scopes = new Map(previousState.scopes);
  if (resetRoot) scopes.clear();
  for (const inventory of inventories) {
    const state = INVENTORY_STATES.get(inventory);
    if (state === undefined) failResult();
    const projection = scopeProjection(inventory);
    scopes.set(
      scopeKey(
        inventory.directoryHandleSha256,
        inventory.inventoryKind,
        inventory.requestedName,
      ),
      nullRecord([
        ["projection", projection],
        ["pathKey", state.pathKey],
        ["inventory", inventory],
      ]),
    );
  }
  return scopes;
}

function replacedInventoryEntries(inventory, removedName, insertedEntry) {
  const entries = [];
  let removedCount = 0;
  for (const entry of inventory.entries) {
    if (entry.name === removedName) {
      removedCount += 1;
    } else {
      entries.push(entry);
    }
  }
  if (removedCount > 1) failResult();
  if (insertedEntry !== null) entries.push(insertedEntry);
  return entries;
}

function nativeIdentityMatchesDirectory(native, directory) {
  return (
    native.ownerUid === directory.ownerUid &&
    native.ownerGid === directory.ownerGid &&
    native.deviceMajor === directory.deviceMajor &&
    native.deviceMinor === directory.deviceMinor &&
    native.mountId === directory.mountId &&
    native.filesystemMagic === directory.filesystemMagic
  );
}

function persistSuccessInventories(request, result, tokenState) {
  const parent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  const native = result.observations[0];
  const bytes = request.bytes;
  if (
    native.kind !== "REGULAR" ||
    native.role !== request.directoryRoleA ||
    native.name !== request.nameB ||
    !entryKindIsConsistent(native) ||
    native.mode !== 33152 ||
    native.linkCount !== "1" ||
    native.inode === "0" ||
    native.byteLength !== String(request.inputByteLength) ||
    native.contentOffset !== 0 ||
    native.contentLength !== request.inputByteLength ||
    bytes.length !== request.inputByteLength ||
    sha256(bytes) !== request.inputRawSha256 ||
    !nativeIdentityMatchesDirectory(native, parent.inventory.directory)
  ) {
    failResult();
  }
  const directoryEntryValue = inventoryEntryFromNative(native, null);
  const fileEntry = inventoryEntryFromNative(native, bytes);
  const parentInventory = makeInventory(
    request,
    parent.inventory.directory,
    parent.inventory.directoryHandleSha256,
    "DIRECTORY",
    null,
    replacedInventoryEntries(
      parent.inventory,
      request.nameB,
      directoryEntryValue,
    ),
    null,
    parent.pathKey,
  );
  const fileInventory = makeInventory(
    request,
    parent.inventory.directory,
    parent.inventory.directoryHandleSha256,
    "REGULAR_FILE",
    request.nameB,
    [fileEntry],
    bytes,
    parent.pathKey,
  );
  return [parentInventory, fileInventory];
}

function mkdirSuccessInventories(request, result, tokenState) {
  const parent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  const native = result.observations[0];
  if (
    native.kind !== "DIRECTORY" ||
    native.name !== request.nameA ||
    !nestedComponentIsExact(request.directoryRoleA, native.role, native.name) ||
    !entryKindIsConsistent(native) ||
    native.mode !== 16832 ||
    native.linkCount === "0" ||
    native.linkCount === "1" ||
    native.inode === "0" ||
    native.contentOffset !== 0 ||
    native.contentLength !== 0 ||
    !nativeIdentityMatchesDirectory(native, parent.inventory.directory) ||
    directoryEntry(parent.inventory, request.nameA) !== null
  ) {
    failResult();
  }
  for (const existing of parent.inventory.entries) {
    if (
      existing.deviceMajor === native.deviceMajor &&
      existing.deviceMinor === native.deviceMinor &&
      existing.inode === native.inode &&
      existing.mountId === native.mountId
    ) {
      failResult();
    }
  }
  const child = heldDirectoryFromNative(native);
  const childHandle = directoryHandleDigest(
    request.managerActorEpochSha256,
    native.role,
    child.identitySha256,
    parent.inventory.directoryHandleSha256,
    request.nameA,
  );
  const parentInventory = makeInventory(
    request,
    parent.inventory.directory,
    parent.inventory.directoryHandleSha256,
    "DIRECTORY",
    null,
    replacedInventoryEntries(
      parent.inventory,
      request.nameA,
      inventoryEntryFromNative(native, null),
    ),
    null,
    parent.pathKey,
  );
  const childInventory = makeInventory(
    request,
    child,
    childHandle,
    "DIRECTORY",
    null,
    [],
    null,
    appendPath(parent.pathKey, request.nameA),
  );
  return [parentInventory, childInventory];
}

function canonicalAbsentObservation(native, role, name) {
  return (
    native.kind === "ABSENT" &&
    native.role === role &&
    native.name === name &&
    native.deviceMajor === "0" &&
    native.deviceMinor === "0" &&
    native.inode === "0" &&
    native.mountId === "0" &&
    native.byteLength === "0" &&
    native.linkCount === "0" &&
    native.mode === 0 &&
    native.ownerUid === 0 &&
    native.ownerGid === 0 &&
    native.filesystemMagic === "0" &&
    native.contentOffset === 0 &&
    native.contentLength === 0
  );
}

function nativeMatchesInventoryEntry(native, entry) {
  return (
    native.name === entry.name &&
    native.kind === entry.kind &&
    permissionString(native.mode) === entry.mode &&
    native.ownerUid === entry.ownerUid &&
    native.ownerGid === entry.ownerGid &&
    native.linkCount === entry.linkCount &&
    native.byteLength === entry.byteLength &&
    native.deviceMajor === entry.deviceMajor &&
    native.deviceMinor === entry.deviceMinor &&
    native.inode === entry.inode &&
    native.mountId === entry.mountId &&
    native.filesystemMagic === entry.filesystemMagic &&
    entry.contentByteLength === null &&
    entry.contentRawSha256 === null
  );
}

function moveSuccessInventories(request, result, tokenState) {
  const sourceParent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  const destinationParent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256B,
  );
  const absent = result.observations[0];
  const destination = result.observations[1];
  const sourceEntry = directoryEntry(sourceParent.inventory, request.nameA);
  const destinationEntry = directoryEntry(
    destinationParent.inventory,
    request.nameB,
  );
  const expectedEntry =
    request.operation === "MOVE_NOREPLACE_SYNC"
      ? sourceEntry
      : destinationEntry;
  if (
    !canonicalAbsentObservation(
      absent,
      request.directoryRoleA,
      request.nameA,
    ) ||
    expectedEntry === null ||
    destination.kind !== "DIRECTORY" ||
    destination.role !== request.directoryRoleB ||
    destination.name !== request.nameB ||
    destination.contentOffset !== 0 ||
    destination.contentLength !== 0 ||
    !entryKindIsConsistent(destination) ||
    !nativeIdentityMatchesDirectory(
      destination,
      destinationParent.inventory.directory,
    ) ||
    !nativeMatchesInventoryEntry(destination, expectedEntry) ||
    (request.operation === "MOVE_NOREPLACE_SYNC" &&
      destinationEntry !== null) ||
    (request.operation === "MOVE_SYNC_REOBSERVE" && sourceEntry !== null)
  ) {
    failResult();
  }
  const sourceInventory = makeInventory(
    request,
    sourceParent.inventory.directory,
    sourceParent.inventory.directoryHandleSha256,
    "DIRECTORY",
    null,
    replacedInventoryEntries(sourceParent.inventory, request.nameA, null),
    null,
    sourceParent.pathKey,
  );
  const destinationInventory = makeInventory(
    request,
    destinationParent.inventory.directory,
    destinationParent.inventory.directoryHandleSha256,
    "DIRECTORY",
    null,
    replacedInventoryEntries(
      destinationParent.inventory,
      request.nameB,
      inventoryEntryFromNative(destination, null),
    ),
    null,
    destinationParent.pathKey,
  );
  return [sourceInventory, destinationInventory];
}

function cleanupSuccessInventories(request, result, tokenState) {
  const parent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  const temporary = findRegularScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
    request.nameA,
  );
  const native = result.observations[0];
  if (
    !canonicalAbsentObservation(
      native,
      request.directoryRoleA,
      request.nameA,
    ) ||
    temporary.inventory.entryCount !== 1 ||
    temporary.inventory.entries.length !== 1 ||
    temporary.inventory.contentBytes === null ||
    directoryEntry(parent.inventory, request.nameA) === null
  ) {
    failResult();
  }
  const parentInventory = makeInventory(
    request,
    parent.inventory.directory,
    parent.inventory.directoryHandleSha256,
    "DIRECTORY",
    null,
    replacedInventoryEntries(parent.inventory, request.nameA, null),
    null,
    parent.pathKey,
  );
  const temporaryInventory = makeInventory(
    request,
    parent.inventory.directory,
    parent.inventory.directoryHandleSha256,
    "REGULAR_FILE",
    request.nameA,
    [],
    null,
    parent.pathKey,
  );
  return [parentInventory, temporaryInventory];
}

function moveScopesWithInventories(tokenState, request, inventories) {
  const scopes = new Map(tokenState.scopes);
  const sourceParent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  const sourcePath = appendPath(sourceParent.pathKey, request.nameA);
  const staleKeys = [];
  for (const pair of scopes.entries()) {
    const key = pair[0];
    const entry = pair[1];
    if (
      entry.pathKey === sourcePath ||
      (entry.pathKey >= sourcePath + "/" && entry.pathKey < sourcePath + "0")
    ) {
      staleKeys.push(key);
    }
  }
  for (const key of staleKeys) scopes.delete(key);
  for (const inventory of inventories) {
    const state = INVENTORY_STATES.get(inventory);
    if (state === undefined) failResult();
    scopes.set(
      scopeKey(
        inventory.directoryHandleSha256,
        inventory.inventoryKind,
        inventory.requestedName,
      ),
      nullRecord([
        ["projection", scopeProjection(inventory)],
        ["pathKey", state.pathKey],
        ["inventory", inventory],
      ]),
    );
  }
  return scopes;
}

function mutationSuccessHeldStack(request, tokenState, inventories) {
  const heldStack = [];
  for (const retained of tokenState.heldStack) heldStack.push(retained);
  if (request.operation === "MKDIR_SYNC") {
    const child = inventories[1];
    const held = nullRecord([]);
    held.role = child.directory.role;
    held.directoryIdentitySha256 = child.directory.identitySha256;
    held.directoryHandleSha256 = child.directoryHandleSha256;
    heldStack.push(Object.freeze(held));
  }
  return heldStack;
}

function receiptProjection(values) {
  return nullRecord([
    ["schema", values.schema],
    ["requirementsSha256", values.requirementsSha256],
    ["requestSha256", values.requestSha256],
    ["operation", values.operation],
    ["executionDisposition", values.executionDisposition],
    ["writerKind", values.writerKind],
    ["actorKind", values.actorKind],
    ["targetSha256", values.targetSha256],
    ["requiredDurableRecordType", values.requiredDurableRecordType],
    ["requiredOutcomeRecordType", values.requiredOutcomeRecordType],
    ["previousInventorySetSha256", values.previousInventorySetSha256],
    ["inventorySetSha256", values.inventorySetSha256],
    ["status", values.status],
    ["effectClass", values.effectClass],
    ["lastCompletedStep", values.lastCompletedStep],
    ["failedStep", values.failedStep],
    ["errno", values.errno],
    ["completedStepCount", values.completedStepCount],
    ["bytesConsumed", values.bytesConsumed],
    ["outcome", values.outcome],
    ["retryDisposition", values.retryDisposition],
    ["inventories", values.inventoryDigests],
  ]);
}

function makeReceipt(
  request,
  result,
  outcome,
  retryDisposition,
  inventoriesValue,
  scopesValue,
  heldStackValue,
) {
  const previousToken = request.inventorySet;
  const previousState =
    previousToken === null ? null : TOKEN_STATES.get(previousToken);
  const inventories = [];
  const inventoryDigests = [];
  for (const inventory of inventoriesValue) {
    inventories.push(inventory);
    inventoryDigests.push(inventory.inventorySha256);
  }
  Object.freeze(inventories);
  Object.freeze(inventoryDigests);
  let inventorySet = null;
  if (scopesValue !== null) {
    const rootObservation =
      previousState === null
        ? REQUEST_STATES.get(request).rootObservation
        : previousState.rootObservation;
    inventorySet = mintToken(
      request.managerActorEpochSha256,
      previousToken,
      request,
      scopesValue,
      rootObservation,
      heldStackValue,
    );
  }
  const values = nullRecord([]);
  values.schema = "oxigraph.candidate-containment-guardian-statefs-receipt/v1";
  values.requirementsSha256 =
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256;
  values.requestSha256 = request.requestSha256;
  values.operation = request.operation;
  values.executionDisposition = request.executionDisposition;
  values.writerKind = request.writerKind;
  values.actorKind = request.actorKind;
  values.targetSha256 = request.targetSha256;
  values.requiredDurableRecordType = request.requiredDurableRecordType;
  values.requiredOutcomeRecordType = request.requiredOutcomeRecordType;
  values.previousInventorySetSha256 = request.inventorySetSha256;
  values.inventorySetSha256 =
    inventorySet === null ? null : inventorySet.inventorySetSha256;
  values.status = result.status;
  values.effectClass = result.effectClass;
  values.lastCompletedStep = result.lastCompletedStep;
  values.failedStep = result.failedStep;
  values.errno = result.errno;
  values.completedStepCount = result.completedStepCount;
  values.bytesConsumed = result.bytesConsumed;
  values.outcome = outcome;
  values.retryDisposition = retryDisposition;
  values.inventoryDigests = inventoryDigests;
  const receiptSha256 = semanticDigest(receiptProjection(values));
  const receipt = nullRecord([]);
  receipt.request = request;
  receipt.previousInventorySet = previousToken;
  receipt.inventorySet = inventorySet;
  receipt.schema = values.schema;
  receipt.requirementsSha256 = values.requirementsSha256;
  receipt.requestSha256 = values.requestSha256;
  receipt.operation = values.operation;
  receipt.executionDisposition = values.executionDisposition;
  receipt.writerKind = values.writerKind;
  receipt.actorKind = values.actorKind;
  receipt.targetSha256 = values.targetSha256;
  receipt.requiredDurableRecordType = values.requiredDurableRecordType;
  receipt.requiredOutcomeRecordType = values.requiredOutcomeRecordType;
  receipt.previousInventorySetSha256 = values.previousInventorySetSha256;
  receipt.inventorySetSha256 = values.inventorySetSha256;
  receipt.status = values.status;
  receipt.effectClass = values.effectClass;
  receipt.lastCompletedStep = values.lastCompletedStep;
  receipt.failedStep = values.failedStep;
  receipt.errno = values.errno;
  receipt.completedStepCount = values.completedStepCount;
  receipt.bytesConsumed = values.bytesConsumed;
  receipt.outcome = values.outcome;
  receipt.retryDisposition = values.retryDisposition;
  receipt.inventories = inventories;
  receipt.receiptSha256 = receiptSha256;
  receipt.authority = AUTHORITY;
  receipt.physicalFacts = PHYSICAL_FACTS;
  receipt.nonclaims = NONCLAIMS;
  Object.freeze(receipt);
  RECEIPT_STATES.set(receipt, true);
  if (previousToken !== null && previousState !== undefined) {
    TOKEN_STATES.set(
      previousToken,
      nullRecord([
        ["managerActorEpochSha256", previousState.managerActorEpochSha256],
        ["scopes", previousState.scopes],
        ["rootObservation", previousState.rootObservation],
        ["heldStack", previousState.heldStack],
        ["reserved", false],
        ["consumed", true],
        ["previousState", previousState.previousState],
      ]),
    );
  }
  return receipt;
}

function syntheticObservationOnlyResult() {
  return Object.freeze(
    nullRecord([
      ["status", "OBSERVATION_ONLY"],
      ["effectClass", "DEFINITE_NO_EFFECT"],
      ["lastCompletedStep", "NONE"],
      ["failedStep", "NONE"],
      ["errno", 0],
      ["completedStepCount", 0],
      ["bytesConsumed", 0],
    ]),
  );
}

function observationOnlyInventories(request, tokenState) {
  const inventories = [];
  if (request.operation === "PERSIST_NOREPLACE") {
    inventories.push(
      findDirectoryScopeByHandle(tokenState, request.directoryHandleSha256A)
        .inventory,
    );
    inventories.push(
      findRegularScopeByHandle(
        tokenState,
        request.directoryHandleSha256A,
        request.nameB,
      ).inventory,
    );
  } else if (request.operation === "MKDIR_SYNC") {
    inventories.push(
      findDirectoryScopeByHandle(tokenState, request.directoryHandleSha256A)
        .inventory,
    );
  } else if (request.operation === "MOVE_NOREPLACE_SYNC") {
    inventories.push(
      findDirectoryScopeByHandle(tokenState, request.directoryHandleSha256A)
        .inventory,
    );
    inventories.push(
      findDirectoryScopeByHandle(tokenState, request.directoryHandleSha256B)
        .inventory,
    );
  } else if (request.operation === "TEMP_CLEANUP") {
    inventories.push(
      findRegularScopeByHandle(
        tokenState,
        request.directoryHandleSha256A,
        request.nameA,
      ).inventory,
    );
  } else {
    failResult();
  }
  return inventories;
}

function operationSequence(name) {
  for (const pair of OPERATION_STEP_SEQUENCES) {
    if (pair[0] === name) return pair[1];
  }
  failResult();
}

function operationStepName(value) {
  for (const pair of OPERATION_STEPS) {
    if (pair[1] === value) return pair[0];
  }
  failResult();
}

function matchDensePrefix(result, sequenceName) {
  const sequence = operationSequence(sequenceName);
  if (result.completedStepCount > sequence.length) return null;
  let ordinal = 0;
  let lastStep = null;
  let nextStep = null;
  for (const step of sequence) {
    if (ordinal === result.completedStepCount - 1) lastStep = step;
    if (ordinal === result.completedStepCount) nextStep = step;
    ordinal += 1;
  }
  const expectedLast =
    result.completedStepCount === 0 ? "NONE" : operationStepName(lastStep);
  if (result.lastCompletedStep !== expectedLast) return null;
  let position;
  let after;
  if (result.failedStep === "NONE") {
    if (result.completedStepCount === 0) return null;
    position = result.completedStepCount - 1;
    after = true;
  } else {
    if (
      result.completedStepCount === sequence.length ||
      result.failedStep !== operationStepName(nextStep)
    ) {
      return null;
    }
    position = result.completedStepCount;
    after = false;
  }
  return nullRecord([
    ["sequenceName", sequenceName],
    ["sequence", sequence],
    ["position", position],
    ["after", after],
  ]);
}

function matchRequestDensePrefix(request, result) {
  if (request.operation !== "INVENTORY") {
    return matchDensePrefix(result, request.operation);
  }
  if (request.inventoryKind === "DIRECTORY") {
    return matchDensePrefix(
      result,
      request.inventoryDirectoryRole === "STATE_ROOT"
        ? "INVENTORY/DIRECTORY/ROOT"
        : "INVENTORY/DIRECTORY/CHILD",
    );
  }
  const present = matchDensePrefix(result, "INVENTORY/REGULAR_FILE/PRESENT");
  if (present !== null) return present;
  return matchDensePrefix(result, "INVENTORY/REGULAR_FILE/ABSENT");
}

function faultEffectClass(sequenceName, position, after) {
  if (
    sequenceName === "INVENTORY/DIRECTORY/ROOT" ||
    sequenceName === "INVENTORY/DIRECTORY/CHILD" ||
    sequenceName === "INVENTORY/REGULAR_FILE/PRESENT" ||
    sequenceName === "INVENTORY/REGULAR_FILE/ABSENT"
  ) {
    return "DEFINITE_NO_EFFECT";
  }
  if (sequenceName === "LOCK_EX_NB") {
    return after && position === 2 ? "EFFECT_UNCERTAIN" : "DEFINITE_NO_EFFECT";
  }
  if (sequenceName === "PERSIST_NOREPLACE") {
    if (!after) {
      return position <= 2
        ? "DEFINITE_NO_EFFECT"
        : "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
    }
    if (position <= 1) return "DEFINITE_NO_EFFECT";
    return position === 14
      ? "EFFECT_UNCERTAIN"
      : "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
  }
  if (sequenceName === "MKDIR_SYNC") {
    if (!after) {
      return position <= 2
        ? "DEFINITE_NO_EFFECT"
        : "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
    }
    if (position <= 1) return "DEFINITE_NO_EFFECT";
    return position === 8
      ? "EFFECT_UNCERTAIN"
      : "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
  }
  if (sequenceName === "MOVE_NOREPLACE_SYNC") {
    if (!after) {
      return position <= 4
        ? "DEFINITE_NO_EFFECT"
        : "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
    }
    if (position <= 3) return "DEFINITE_NO_EFFECT";
    return position === 8
      ? "EFFECT_UNCERTAIN"
      : "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
  }
  if (sequenceName === "MOVE_SYNC_REOBSERVE") {
    return "EFFECT_UNCERTAIN";
  }
  if (sequenceName === "TEMP_CLEANUP") {
    if (!after) {
      return position <= 3
        ? "DEFINITE_NO_EFFECT"
        : "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
    }
    if (position <= 2) return "DEFINITE_NO_EFFECT";
    return position === 5
      ? "EFFECT_UNCERTAIN"
      : "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
  }
  if (sequenceName === "RELEASE_DIRECTORY") {
    return after && position === 2 ? "EFFECT_UNCERTAIN" : "DEFINITE_NO_EFFECT";
  }
  failResult();
}

function boundaryEffectClass(request, failedStep) {
  if (request.operation === "LOCK_EX_NB") return "DEFINITE_NO_EFFECT";
  if (request.operation === "INVENTORY") {
    return failedStep === "INVENTORY_DESCRIPTOR_CLOSED"
      ? "EFFECT_UNCERTAIN"
      : "DEFINITE_NO_EFFECT";
  }
  if (request.operation === "PERSIST_NOREPLACE") {
    if (failedStep === "FD_A_VALIDATED" || failedStep === "TEMP_CREATED") {
      return "DEFINITE_NO_EFFECT";
    }
    if (
      failedStep === "CREATED_METADATA_VALIDATED" ||
      failedStep === "TEMP_WRITTEN" ||
      failedStep === "TEMP_READ_DESCRIPTOR_OPENED" ||
      failedStep === "TEMP_READ_BACK" ||
      failedStep === "TEMP_FILE_SYNCED" ||
      failedStep === "FINAL_INSTALLED"
    ) {
      return "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
    }
    return "EFFECT_UNCERTAIN";
  }
  if (request.operation === "MKDIR_SYNC") {
    if (
      failedStep === "FD_A_VALIDATED" ||
      failedStep === "CHILD_DIRECTORY_CREATED"
    ) {
      return "DEFINITE_NO_EFFECT";
    }
    if (
      failedStep === "CREATED_METADATA_VALIDATED" ||
      failedStep === "INTERNAL_DESCRIPTOR_OPENED" ||
      failedStep === "CHILD_DIRECTORY_SYNCED"
    ) {
      return "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
    }
    return "EFFECT_UNCERTAIN";
  }
  if (request.operation === "MOVE_NOREPLACE_SYNC") {
    if (
      failedStep === "FD_A_VALIDATED" ||
      failedStep === "FD_B_VALIDATED" ||
      failedStep === "SOURCE_REOBSERVED" ||
      failedStep === "GENERATION_MOVED"
    ) {
      return "DEFINITE_NO_EFFECT";
    }
    if (
      failedStep === "SOURCE_PARENT_SYNCED" ||
      failedStep === "DESTINATION_PARENT_SYNCED"
    ) {
      return "MUTATION_OBSERVED_NOT_FULLY_SYNCED";
    }
    return "EFFECT_UNCERTAIN";
  }
  if (request.operation === "MOVE_SYNC_REOBSERVE") {
    return "EFFECT_UNCERTAIN";
  }
  if (request.operation === "TEMP_CLEANUP") {
    if (
      failedStep === "FD_A_VALIDATED" ||
      failedStep === "SOURCE_REOBSERVED" ||
      failedStep === "TEMP_UNLINKED"
    ) {
      return "DEFINITE_NO_EFFECT";
    }
    return "EFFECT_UNCERTAIN";
  }
  if (request.operation === "RELEASE_DIRECTORY") {
    return failedStep === "DIRECTORY_RELEASED"
      ? "EFFECT_UNCERTAIN"
      : "DEFINITE_NO_EFFECT";
  }
  failResult();
}

function rejectedBoundaryLimit(sequenceName) {
  if (
    sequenceName === "INVENTORY/DIRECTORY/ROOT" ||
    sequenceName === "INVENTORY/DIRECTORY/CHILD" ||
    sequenceName === "INVENTORY/REGULAR_FILE/PRESENT"
  ) {
    return 3;
  }
  if (
    sequenceName === "MOVE_NOREPLACE_SYNC" ||
    sequenceName === "MOVE_SYNC_REOBSERVE"
  ) {
    return 4;
  }
  if (sequenceName === "TEMP_CLEANUP") return 3;
  return 2;
}

function completedStep(match, completedStepCount, expectedStep) {
  let ordinal = 0;
  for (const step of match.sequence) {
    if (ordinal < completedStepCount && step === expectedStep) return true;
    ordinal += 1;
  }
  return false;
}

function internalDescriptorIsLive(request, result, match) {
  if (request.operation === "INVENTORY") {
    if (match.sequenceName === "INVENTORY/REGULAR_FILE/ABSENT") return false;
    const finalStep =
      match.sequenceName === "INVENTORY/DIRECTORY/CHILD" ? 32 : 24;
    return (
      completedStep(match, result.completedStepCount, 5) &&
      !completedStep(match, result.completedStepCount, finalStep)
    );
  }
  if (request.operation === "PERSIST_NOREPLACE") {
    const writerLive =
      completedStep(match, result.completedStepCount, 8) &&
      !completedStep(match, result.completedStepCount, 27);
    const temporaryReaderLive =
      completedStep(match, result.completedStepCount, 25) &&
      !completedStep(match, result.completedStepCount, 26);
    const finalReaderLive =
      completedStep(match, result.completedStepCount, 28) &&
      !completedStep(match, result.completedStepCount, 29);
    return writerLive || temporaryReaderLive || finalReaderLive;
  }
  if (request.operation === "MKDIR_SYNC") {
    return (
      completedStep(match, result.completedStepCount, 5) &&
      !completedStep(match, result.completedStepCount, 30)
    );
  }
  return false;
}

function effectClassIsExact(request, result, match, baseEffectClass) {
  if (result.effectClass === baseEffectClass) return true;
  return (
    baseEffectClass !== "EFFECT_UNCERTAIN" &&
    result.effectClass === "EFFECT_UNCERTAIN" &&
    internalDescriptorIsLive(request, result, match)
  );
}

function verificationStepIsExact(request, failedStep, match) {
  if (request.operation === "INVENTORY") {
    return (
      request.inventoryKind === "REGULAR_FILE" &&
      match.sequenceName === "INVENTORY/REGULAR_FILE/PRESENT" &&
      failedStep === "ENTRY_REOBSERVED"
    );
  }
  if (request.operation === "PERSIST_NOREPLACE") {
    return (
      failedStep === "CREATED_METADATA_VALIDATED" ||
      failedStep === "TEMP_WRITTEN" ||
      failedStep === "TEMP_READ_BACK" ||
      failedStep === "DESTINATION_REOBSERVED"
    );
  }
  if (request.operation === "MKDIR_SYNC") {
    return (
      failedStep === "CREATED_METADATA_VALIDATED" ||
      failedStep === "DESTINATION_REOBSERVED"
    );
  }
  if (request.operation === "MOVE_NOREPLACE_SYNC") {
    return (
      failedStep === "SOURCE_ABSENCE_REOBSERVED" ||
      failedStep === "DESTINATION_REOBSERVED"
    );
  }
  if (request.operation === "MOVE_SYNC_REOBSERVE") {
    return (
      failedStep === "SOURCE_REOBSERVED" ||
      failedStep === "PRE_SYNC_DESTINATION_REOBSERVED" ||
      failedStep === "SOURCE_ABSENCE_REOBSERVED" ||
      failedStep === "DESTINATION_REOBSERVED"
    );
  }
  return (
    request.operation === "TEMP_CLEANUP" &&
    failedStep === "TEMP_ABSENCE_REOBSERVED"
  );
}

function limitStatusIsExact(request, result, match) {
  if (
    !match.after &&
    match.position <= 1 &&
    result.effectClass === "NO_EFFECT"
  ) {
    return true;
  }
  let readOnlyLimit = false;
  if (
    match.sequenceName === "INVENTORY/DIRECTORY/ROOT" ||
    match.sequenceName === "INVENTORY/DIRECTORY/CHILD"
  ) {
    readOnlyLimit = match.position === 3;
  } else if (
    match.sequenceName === "INVENTORY/REGULAR_FILE/PRESENT" &&
    match.position === 3
  ) {
    readOnlyLimit = true;
  }
  return (
    readOnlyLimit &&
    effectClassIsExact(request, result, match, "DEFINITE_NO_EFFECT")
  );
}

function verifyNoncompleteStatus(request, result, match) {
  if (result.status === "FAULT_INJECTED") {
    const baseEffectClass = faultEffectClass(
      match.sequenceName,
      match.position,
      match.after,
    );
    if (
      result.errno !== 5 ||
      !effectClassIsExact(request, result, match, baseEffectClass)
    ) {
      failResult();
    }
    return;
  }
  if (result.status === "SYSCALL_FAILED") {
    const baseEffectClass = boundaryEffectClass(request, result.failedStep);
    if (
      match.after ||
      result.failedStep === "REQUEST_VALIDATED" ||
      result.errno === 0 ||
      !effectClassIsExact(request, result, match, baseEffectClass)
    ) {
      failResult();
    }
    return;
  }
  if (result.status === "VERIFICATION_FAILED") {
    const baseEffectClass = boundaryEffectClass(request, result.failedStep);
    if (
      match.after ||
      result.errno !== 0 ||
      !verificationStepIsExact(request, result.failedStep, match) ||
      !effectClassIsExact(request, result, match, baseEffectClass)
    ) {
      failResult();
    }
    return;
  }
  if (result.status === "REJECTED") {
    if (
      match.after ||
      result.errno !== 0 ||
      result.effectClass !== "NO_EFFECT" ||
      match.position >= rejectedBoundaryLimit(match.sequenceName)
    ) {
      failResult();
    }
    return;
  }
  if (result.status === "LIMIT_EXCEEDED") {
    if (result.errno !== 0 || !limitStatusIsExact(request, result, match)) {
      failResult();
    }
    return;
  }
  failResult();
}

function lockObservationIsExact(native, root) {
  return (
    root !== null &&
    native.kind === "DIRECTORY" &&
    native.role === "STATE_ROOT" &&
    native.name === null &&
    entryKindIsConsistent(native) &&
    native.mode === 16832 &&
    native.ownerUid === root.ownerUid &&
    native.ownerGid === root.ownerGid &&
    native.linkCount === root.linkCount &&
    native.deviceMajor === root.deviceMajor &&
    native.deviceMinor === root.deviceMinor &&
    native.inode === root.inode &&
    native.mountId === root.mountId &&
    native.filesystemMagic === root.filesystemMagic &&
    native.contentOffset === 0 &&
    native.contentLength === 0
  );
}

function directoryEntryObservationIsAbiExact(native) {
  return (
    native.role === "NONE" &&
    native.name !== null &&
    native.contentOffset === 0 &&
    native.contentLength === 0
  );
}

function directoryTargetObservationIsExact(
  request,
  native,
  tokenState,
  rootObservation,
) {
  if (request.inventoryDirectoryRole === "STATE_ROOT") {
    return lockObservationIsExact(native, rootObservation);
  }
  if (tokenState === null) return false;
  const parent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  const entry = directoryEntry(parent.inventory, request.nameA);
  return (
    entry !== null &&
    entry.kind === "DIRECTORY" &&
    entry.contentByteLength === null &&
    entry.contentRawSha256 === null &&
    native.kind === "DIRECTORY" &&
    native.role === request.inventoryDirectoryRole &&
    native.name === null &&
    entryKindIsConsistent(native) &&
    permissionString(native.mode) === entry.mode &&
    native.ownerUid === entry.ownerUid &&
    native.ownerGid === entry.ownerGid &&
    native.linkCount === entry.linkCount &&
    native.byteLength === entry.byteLength &&
    native.deviceMajor === entry.deviceMajor &&
    native.deviceMinor === entry.deviceMinor &&
    native.inode === entry.inode &&
    native.mountId === entry.mountId &&
    native.filesystemMagic === entry.filesystemMagic &&
    native.contentOffset === 0 &&
    native.contentLength === 0
  );
}

function directoryTargetObservationIsAbiExact(request, native) {
  return (
    native.kind === "DIRECTORY" &&
    native.role === request.inventoryDirectoryRole &&
    native.name === null &&
    entryKindIsConsistent(native) &&
    native.linkCount !== "0" &&
    native.inode !== "0" &&
    native.mountId !== "0" &&
    native.filesystemMagic !== "0" &&
    native.contentOffset === 0 &&
    native.contentLength === 0
  );
}

function regularRejectedObservationIsExact(request, native, tokenState) {
  if (
    tokenState === null ||
    native.kind === "ABSENT" ||
    native.role !== request.directoryRoleA ||
    native.name !== request.nameA ||
    !entryKindIsConsistent(native) ||
    native.linkCount === "0" ||
    native.inode === "0" ||
    native.mountId === "0" ||
    native.filesystemMagic === "0" ||
    native.contentOffset !== 0 ||
    native.contentLength !== 0
  ) {
    return false;
  }
  const parent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  return !(
    native.kind === "REGULAR" &&
    native.mode === 33152 &&
    native.ownerUid === parent.inventory.directory.ownerUid &&
    native.ownerGid === parent.inventory.directory.ownerGid &&
    native.deviceMajor === parent.inventory.directory.deviceMajor &&
    native.deviceMinor === parent.inventory.directory.deviceMinor &&
    native.linkCount === "1" &&
    native.mountId === parent.inventory.directory.mountId &&
    native.filesystemMagic === parent.inventory.directory.filesystemMagic
  );
}

function persistObservationIsExact(request, native, tokenState) {
  const parent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  return (
    native.kind === "REGULAR" &&
    native.role === request.directoryRoleA &&
    native.name === request.nameB &&
    entryKindIsConsistent(native) &&
    native.mode === 33152 &&
    native.linkCount === "1" &&
    native.inode !== "0" &&
    native.byteLength === String(request.inputByteLength) &&
    native.contentOffset === 0 &&
    native.contentLength === request.inputByteLength &&
    nativeIdentityMatchesDirectory(native, parent.inventory.directory)
  );
}

function mkdirObservationIsExact(request, native, tokenState) {
  const parent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  if (
    native.kind !== "DIRECTORY" ||
    native.name !== request.nameA ||
    !nestedComponentIsExact(request.directoryRoleA, native.role, native.name) ||
    !entryKindIsConsistent(native) ||
    native.mode !== 16832 ||
    native.linkCount === "0" ||
    native.linkCount === "1" ||
    native.inode === "0" ||
    native.contentOffset !== 0 ||
    native.contentLength !== 0 ||
    !nativeIdentityMatchesDirectory(native, parent.inventory.directory) ||
    directoryEntry(parent.inventory, request.nameA) !== null
  ) {
    return false;
  }
  for (const existing of parent.inventory.entries) {
    if (
      existing.deviceMajor === native.deviceMajor &&
      existing.deviceMinor === native.deviceMinor &&
      existing.inode === native.inode &&
      existing.mountId === native.mountId
    ) {
      return false;
    }
  }
  return true;
}

function moveDestinationObservationIsExact(request, native, tokenState) {
  const sourceParent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256A,
  );
  const destinationParent = findDirectoryScopeByHandle(
    tokenState,
    request.directoryHandleSha256B,
  );
  const sourceEntry = directoryEntry(sourceParent.inventory, request.nameA);
  const destinationEntry = directoryEntry(
    destinationParent.inventory,
    request.nameB,
  );
  const expectedEntry =
    request.operation === "MOVE_NOREPLACE_SYNC"
      ? sourceEntry
      : destinationEntry;
  return (
    expectedEntry !== null &&
    native.kind === "DIRECTORY" &&
    native.role === request.directoryRoleB &&
    native.name === request.nameB &&
    native.contentOffset === 0 &&
    native.contentLength === 0 &&
    entryKindIsConsistent(native) &&
    nativeIdentityMatchesDirectory(
      native,
      destinationParent.inventory.directory,
    ) &&
    nativeMatchesInventoryEntry(native, expectedEntry) &&
    (request.operation !== "MOVE_NOREPLACE_SYNC" ||
      destinationEntry === null) &&
    (request.operation !== "MOVE_SYNC_REOBSERVE" || sourceEntry === null)
  );
}

function verifyMutationObservations(request, result, match, tokenState) {
  let expectedCount = 0;
  if (
    request.operation === "PERSIST_NOREPLACE" ||
    request.operation === "MKDIR_SYNC"
  ) {
    if (completedStep(match, result.completedStepCount, 21)) expectedCount = 1;
  } else if (
    request.operation === "MOVE_NOREPLACE_SYNC" ||
    request.operation === "MOVE_SYNC_REOBSERVE"
  ) {
    if (completedStep(match, result.completedStepCount, 22)) expectedCount = 1;
    if (completedStep(match, result.completedStepCount, 21)) expectedCount = 2;
  } else if (
    request.operation === "TEMP_CLEANUP" &&
    completedStep(match, result.completedStepCount, 23)
  ) {
    expectedCount = 1;
  }
  if (result.observations.length !== expectedCount) failResult();
  if (expectedCount === 0) return;
  if (tokenState === null) failResult();
  if (
    request.operation === "PERSIST_NOREPLACE" &&
    !persistObservationIsExact(request, result.observations[0], tokenState)
  ) {
    failResult();
  }
  if (
    request.operation === "MKDIR_SYNC" &&
    !mkdirObservationIsExact(request, result.observations[0], tokenState)
  ) {
    failResult();
  }
  if (
    (request.operation === "MOVE_NOREPLACE_SYNC" ||
      request.operation === "MOVE_SYNC_REOBSERVE") &&
    !canonicalAbsentObservation(
      result.observations[0],
      request.directoryRoleA,
      request.nameA,
    )
  ) {
    failResult();
  }
  if (
    expectedCount === 2 &&
    !moveDestinationObservationIsExact(
      request,
      result.observations[1],
      tokenState,
    )
  ) {
    failResult();
  }
  if (
    request.operation === "TEMP_CLEANUP" &&
    !canonicalAbsentObservation(
      result.observations[0],
      request.directoryRoleA,
      request.nameA,
    )
  ) {
    failResult();
  }
}

function verifyDirectoryInventoryObservations(
  request,
  result,
  match,
  tokenState,
  rootObservation,
) {
  const rejectedTarget =
    result.status === "REJECTED" &&
    result.failedStep === "INTERNAL_DESCRIPTOR_OPENED" &&
    result.completedStepCount === 2;
  const enumerated = completedStep(match, result.completedStepCount, 6);
  if (enumerated) {
    if (result.observations.length < 1 || result.observations.length > 257) {
      failResult();
    }
  } else if (
    (rejectedTarget && result.observations.length !== 1) ||
    (!rejectedTarget && result.observations.length > 1)
  ) {
    failResult();
  }
  if (rejectedTarget) {
    const target = result.observations[0];
    if (
      !directoryTargetObservationIsAbiExact(request, target) ||
      directoryTargetObservationIsExact(
        request,
        target,
        tokenState,
        rootObservation,
      )
    ) {
      failResult();
    }
    return;
  }
  if (
    result.observations.length === 1 &&
    !directoryTargetObservationIsExact(
      request,
      result.observations[0],
      tokenState,
      rootObservation,
    )
  ) {
    failResult();
  }
  if (
    result.observations.length > 1 &&
    !directoryTargetObservationIsExact(
      request,
      result.observations[0],
      tokenState,
      rootObservation,
    )
  ) {
    failResult();
  }
  let first = true;
  for (const native of result.observations) {
    if (first) {
      first = false;
    } else if (!directoryEntryObservationIsAbiExact(native)) {
      failResult();
    }
  }
}

function verifyRegularInventoryObservations(
  request,
  result,
  match,
  tokenState,
) {
  const observed = completedStep(match, result.completedStepCount, 7);
  const rejectedExisting =
    result.status === "REJECTED" &&
    result.failedStep === "INTERNAL_DESCRIPTOR_OPENED" &&
    result.completedStepCount === 2;
  const partialPresent =
    !observed &&
    match.sequenceName === "INVENTORY/REGULAR_FILE/PRESENT" &&
    result.failedStep === "ENTRY_REOBSERVED" &&
    (result.status === "SYSCALL_FAILED" ||
      result.status === "LIMIT_EXCEEDED" ||
      result.status === "VERIFICATION_FAILED") &&
    result.outputBytes !== null;
  if (
    result.observations.length !==
    (observed || partialPresent || rejectedExisting ? 1 : 0)
  ) {
    failResult();
  }
  if (!observed && !partialPresent && !rejectedExisting) return;
  if (result.outputBytes === null) failResult();
  const native = result.observations[0];
  if (rejectedExisting) {
    if (
      result.bytesConsumed !== 0 ||
      result.outputBytes.length !== 0 ||
      !regularRejectedObservationIsExact(request, native, tokenState)
    ) {
      failResult();
    }
    return;
  }
  if (match.sequenceName === "INVENTORY/REGULAR_FILE/ABSENT") {
    if (
      result.bytesConsumed !== 0 ||
      result.outputBytes.length !== 0 ||
      !canonicalAbsentObservation(native, request.directoryRoleA, request.nameA)
    ) {
      failResult();
    }
    return;
  }
  const outputLength = String(result.outputBytes.length);
  const byteLengthTooSmall =
    native.byteLength.length < outputLength.length ||
    (native.byteLength.length === outputLength.length &&
      native.byteLength < outputLength);
  if (
    native.kind !== "REGULAR" ||
    native.role !== request.directoryRoleA ||
    native.name !== request.nameA ||
    native.contentOffset !== 0 ||
    native.contentLength !== result.outputBytes.length ||
    byteLengthTooSmall ||
    (observed && native.byteLength !== outputLength)
  ) {
    failResult();
  }
}

function verifyNoncompletePayload(
  request,
  result,
  match,
  tokenState,
  requestState,
) {
  const regularInventory =
    request.operation === "INVENTORY" &&
    request.inventoryKind === "REGULAR_FILE";
  if (
    (regularInventory && result.outputBytes === null) ||
    (!regularInventory && result.outputBytes !== null)
  ) {
    failResult();
  }
  const returnedChildAfterFault =
    match.sequenceName === "INVENTORY/DIRECTORY/CHILD" &&
    result.status === "FAULT_INJECTED" &&
    match.after &&
    match.position === 4;
  if (returnedChildAfterFault) {
    if (result.returnedDirectoryFd < 0) failResult();
  } else if (result.returnedDirectoryFd !== -1) {
    failResult();
  }
  if (request.operation === "PERSIST_NOREPLACE") {
    if (completedStep(match, result.completedStepCount, 9)) {
      if (result.bytesConsumed !== request.inputByteLength) failResult();
    } else if (
      (result.status === "SYSCALL_FAILED" ||
        result.status === "VERIFICATION_FAILED") &&
      result.failedStep === "TEMP_WRITTEN"
    ) {
      if (result.bytesConsumed >= request.inputByteLength) failResult();
    } else if (result.bytesConsumed !== 0) {
      failResult();
    }
  } else if (regularInventory) {
    if (result.bytesConsumed !== result.outputBytes.length) {
      failResult();
    }
  } else if (result.bytesConsumed !== 0) {
    failResult();
  }
  if (request.operation === "LOCK_EX_NB") {
    const observedRoot = completedStep(match, result.completedStepCount, 2);
    if (result.observations.length !== (observedRoot ? 1 : 0)) failResult();
    if (
      observedRoot &&
      !lockObservationIsExact(
        result.observations[0],
        requestState.rootObservation,
      )
    ) {
      failResult();
    }
    return;
  }
  if (request.operation === "INVENTORY") {
    if (request.inventoryKind === "DIRECTORY") {
      verifyDirectoryInventoryObservations(
        request,
        result,
        match,
        tokenState,
        requestState.rootObservation === null
          ? tokenState.rootObservation
          : requestState.rootObservation,
      );
    } else {
      verifyRegularInventoryObservations(request, result, match, tokenState);
    }
    return;
  }
  if (request.operation === "RELEASE_DIRECTORY") {
    if (result.observations.length !== 0) failResult();
    return;
  }
  verifyMutationObservations(request, result, match, tokenState);
}

function verifyNoncompleteResult(request, result, tokenState, requestState) {
  const match = matchRequestDensePrefix(request, result);
  if (match === null) failResult();
  verifyNoncompleteStatus(request, result, match);
  verifyNoncompletePayload(request, result, match, tokenState, requestState);
}

function verifyCompleteStepShape(request, result) {
  const completeStatus = result.status === "COMPLETE";
  const completeEffect = result.effectClass === "COMPLETE";
  if (completeStatus !== completeEffect) failResult();
  if (!completeStatus) return;
  const match = matchRequestDensePrefix(request, result);
  if (
    match === null ||
    !match.after ||
    match.position !== match.sequence.length - 1 ||
    result.failedStep !== "NONE" ||
    result.errno !== 0
  ) {
    failResult();
  }
  if (request.operation === "LOCK_EX_NB") {
    if (
      result.lastCompletedStep !== "LOCK_ACQUIRED" ||
      result.completedStepCount !== 3 ||
      result.bytesConsumed !== 0 ||
      result.observations.length !== 1 ||
      result.outputBytes !== null ||
      result.returnedDirectoryFd !== -1
    ) {
      failResult();
    }
    return;
  }
  if (request.operation === "INVENTORY") {
    if (request.inventoryKind === "DIRECTORY") {
      const nested = request.inventoryDirectoryRole !== "STATE_ROOT";
      if (
        result.lastCompletedStep !==
          (nested
            ? "DIRECTORY_HANDLE_TRANSFERRED"
            : "INVENTORY_DESCRIPTOR_CLOSED") ||
        result.completedStepCount !== 5 ||
        result.bytesConsumed !== 0 ||
        result.observations.length < 1 ||
        result.observations.length > 257 ||
        result.outputBytes !== null ||
        (nested
          ? result.returnedDirectoryFd < 0
          : result.returnedDirectoryFd !== -1)
      ) {
        failResult();
      }
    } else {
      if (
        result.observations.length !== 1 ||
        result.outputBytes === null ||
        result.returnedDirectoryFd !== -1
      ) {
        failResult();
      }
      const native = result.observations[0];
      if (match.sequenceName === "INVENTORY/REGULAR_FILE/ABSENT") {
        if (
          result.lastCompletedStep !== "ENTRY_REOBSERVED" ||
          result.completedStepCount !== 3 ||
          result.bytesConsumed !== 0 ||
          result.outputBytes.length !== 0 ||
          !canonicalAbsentObservation(
            native,
            request.directoryRoleA,
            request.nameA,
          )
        ) {
          failResult();
        }
      } else if (
        result.lastCompletedStep !== "INVENTORY_DESCRIPTOR_CLOSED" ||
        result.completedStepCount !== 5 ||
        result.bytesConsumed !== result.outputBytes.length ||
        native.kind !== "REGULAR" ||
        native.role !== request.directoryRoleA ||
        native.name !== request.nameA ||
        native.byteLength !== String(result.outputBytes.length) ||
        native.contentOffset !== 0 ||
        native.contentLength !== result.outputBytes.length
      ) {
        failResult();
      }
    }
    return;
  }
  if (request.operation === "RELEASE_DIRECTORY") {
    if (
      result.lastCompletedStep !== "DIRECTORY_RELEASED" ||
      result.completedStepCount !== 3 ||
      result.bytesConsumed !== 0 ||
      result.observations.length !== 0 ||
      result.outputBytes !== null ||
      result.returnedDirectoryFd !== -1
    ) {
      failResult();
    }
    return;
  }
  if (request.operation === "PERSIST_NOREPLACE") {
    if (
      result.lastCompletedStep !== "FINAL_READ_DESCRIPTOR_CLOSED" ||
      result.failedStep !== "NONE" ||
      result.completedStepCount !== 15 ||
      result.bytesConsumed !== request.inputByteLength ||
      result.observations.length !== 1 ||
      result.outputBytes !== null ||
      result.returnedDirectoryFd !== -1
    ) {
      failResult();
    }
    return;
  }
  if (request.operation === "MKDIR_SYNC") {
    if (
      result.lastCompletedStep !== "DESTINATION_REOBSERVED" ||
      result.failedStep !== "NONE" ||
      result.completedStepCount !== 9 ||
      result.bytesConsumed !== 0 ||
      result.observations.length !== 1 ||
      result.outputBytes !== null ||
      result.returnedDirectoryFd !== -1
    ) {
      failResult();
    }
    return;
  }
  if (
    request.operation === "MOVE_NOREPLACE_SYNC" ||
    request.operation === "MOVE_SYNC_REOBSERVE"
  ) {
    if (
      result.lastCompletedStep !== "DESTINATION_REOBSERVED" ||
      result.failedStep !== "NONE" ||
      result.completedStepCount !== 9 ||
      result.bytesConsumed !== 0 ||
      result.observations.length !== 2 ||
      result.outputBytes !== null ||
      result.returnedDirectoryFd !== -1
    ) {
      failResult();
    }
    return;
  }
  if (request.operation === "TEMP_CLEANUP") {
    if (
      result.lastCompletedStep !== "TEMP_ABSENCE_REOBSERVED" ||
      result.failedStep !== "NONE" ||
      result.completedStepCount !== 6 ||
      result.bytesConsumed !== 0 ||
      result.observations.length !== 1 ||
      result.outputBytes !== null ||
      result.returnedDirectoryFd !== -1
    ) {
      failResult();
    }
    return;
  }
  failResult();
}

function consumeDispatchedRequest(request) {
  const requestState = REQUEST_STATES.get(request);
  if (requestState === undefined || requestState.status !== "DISPATCHED") {
    failBinding();
  }
  let tokenState = null;
  if (requestState.token !== null) {
    tokenState = TOKEN_STATES.get(requestState.token);
    if (
      tokenState === undefined ||
      !tokenState.reserved ||
      tokenState.consumed
    ) {
      failBinding();
    }
    TOKEN_STATES.set(
      requestState.token,
      nullRecord([
        ["managerActorEpochSha256", tokenState.managerActorEpochSha256],
        ["scopes", tokenState.scopes],
        ["rootObservation", tokenState.rootObservation],
        ["heldStack", tokenState.heldStack],
        ["reserved", false],
        ["consumed", true],
        ["previousState", tokenState.previousState],
      ]),
    );
  }
  REQUEST_STATES.set(
    request,
    nullRecord([
      ["status", "CONSUMED"],
      ["token", requestState.token],
      ["ownerContext", requestState.ownerContext],
      ["rootObservation", requestState.rootObservation],
    ]),
  );
  return nullRecord([
    ["requestState", requestState],
    ["tokenState", tokenState],
  ]);
}

function copiedHeldStack(tokenState) {
  const heldStack = [];
  if (tokenState !== null) {
    for (const held of tokenState.heldStack) heldStack.push(held);
  }
  return heldStack;
}

function inventorySuccessHeldStack(request, tokenState, inventory) {
  if (request.inventoryDirectoryRole === "STATE_ROOT") {
    return [];
  }
  const heldStack = [];
  for (const retained of tokenState.heldStack) heldStack.push(retained);
  if (request.inventoryKind === "DIRECTORY") {
    const held = nullRecord([]);
    held.role = inventory.directory.role;
    held.directoryIdentitySha256 = inventory.directory.identitySha256;
    held.directoryHandleSha256 = inventory.directoryHandleSha256;
    heldStack.push(Object.freeze(held));
  }
  return heldStack;
}

function releaseSuccessHeldStack(tokenState) {
  const heldStack = [];
  for (const retained of tokenState.heldStack) heldStack.push(retained);
  if (heldStack.length === 0) failBinding();
  heldStack.pop();
  return heldStack;
}

function reclassifiedResult(result, status, effectClass) {
  const value = nullRecord([]);
  value.status = status;
  value.effectClass = effectClass;
  value.lastCompletedStep = result.lastCompletedStep;
  value.failedStep = result.failedStep;
  value.errno = result.errno;
  value.completedStepCount = result.completedStepCount;
  value.bytesConsumed = result.bytesConsumed;
  return Object.freeze(value);
}

function verifyExecutedResult(request, result, tokenState, requestState) {
  verifyCompleteStepShape(request, result);
  if (result.status !== "COMPLETE") {
    verifyNoncompleteResult(request, result, tokenState, requestState);
  }
  if (request.operation === "LOCK_EX_NB") {
    if (result.status === "COMPLETE" && result.effectClass === "COMPLETE") {
      if (
        !lockObservationIsExact(
          result.observations[0],
          requestState.rootObservation,
        )
      ) {
        failResult();
      }
      return makeReceipt(
        request,
        result,
        "LOCK_HELD",
        "NO_RETRY",
        [],
        new Map(),
        [],
      );
    }
    if (
      result.status === "SYSCALL_FAILED" &&
      result.effectClass === "DEFINITE_NO_EFFECT" &&
      result.errno === 11
    ) {
      return makeReceipt(
        request,
        result,
        "LOCK_CONTENDED",
        "NO_RETRY",
        [],
        null,
        [],
      );
    }
    if (result.effectClass === "DEFINITE_NO_EFFECT") {
      return makeReceipt(
        request,
        result,
        "FAILED_DEFINITE_NO_EFFECT",
        "NO_RETRY",
        [],
        null,
        [],
      );
    }
    if (result.effectClass === "EFFECT_UNCERTAIN") {
      return makeReceipt(
        request,
        result,
        "FAILED_EFFECT_UNCERTAIN",
        "NO_RETRY",
        [],
        null,
        [],
      );
    }
    if (
      (result.status === "REJECTED" && result.effectClass === "NO_EFFECT") ||
      (result.status === "LIMIT_EXCEEDED" &&
        (result.effectClass === "NO_EFFECT" ||
          result.effectClass === "DEFINITE_NO_EFFECT"))
    ) {
      return makeReceipt(request, result, "REJECTED", "NO_RETRY", [], null, []);
    }
    failResult();
  }
  if (tokenState === null) failBinding();
  if (request.operation === "INVENTORY") {
    if (result.status === "COMPLETE" && result.effectClass === "COMPLETE") {
      const observed = inventoryFromResult(
        request,
        result,
        tokenState,
        requestState.rootObservation === null
          ? tokenState.rootObservation
          : requestState.rootObservation,
      );
      if (!observed.safe) {
        return makeReceipt(
          request,
          reclassifiedResult(result, "REJECTED", "DEFINITE_NO_EFFECT"),
          "REJECTED",
          "NO_RETRY",
          [observed.inventory],
          null,
          copiedHeldStack(tokenState),
        );
      }
      const inventories = [observed.inventory];
      const scopes = scopesWithInventories(
        tokenState,
        request,
        inventories,
        request.inventoryDirectoryRole === "STATE_ROOT",
      );
      return makeReceipt(
        request,
        result,
        "INVENTORY_OBSERVED",
        "NO_RETRY",
        inventories,
        scopes,
        inventorySuccessHeldStack(request, tokenState, observed.inventory),
      );
    }
    if (
      (result.status === "REJECTED" && result.effectClass === "NO_EFFECT") ||
      (result.status === "LIMIT_EXCEEDED" &&
        (result.effectClass === "NO_EFFECT" ||
          result.effectClass === "DEFINITE_NO_EFFECT"))
    ) {
      return makeReceipt(
        request,
        result,
        "REJECTED",
        "NO_RETRY",
        [],
        null,
        copiedHeldStack(tokenState),
      );
    }
    if (
      (result.status === "SYSCALL_FAILED" ||
        result.status === "FAULT_INJECTED" ||
        result.status === "VERIFICATION_FAILED") &&
      result.effectClass === "DEFINITE_NO_EFFECT"
    ) {
      return makeReceipt(
        request,
        result,
        "FAILED_DEFINITE_NO_EFFECT",
        "REPLAN_AFTER_FRESH_INVENTORY",
        [],
        new Map(tokenState.scopes),
        copiedHeldStack(tokenState),
      );
    }
    if (
      (result.status === "SYSCALL_FAILED" ||
        result.status === "FAULT_INJECTED" ||
        result.status === "VERIFICATION_FAILED" ||
        result.status === "LIMIT_EXCEEDED") &&
      result.effectClass === "EFFECT_UNCERTAIN"
    ) {
      return makeReceipt(
        request,
        result,
        "FAILED_EFFECT_UNCERTAIN",
        "NO_RETRY",
        [],
        null,
        copiedHeldStack(tokenState),
      );
    }
    failResult();
  }
  if (request.operation === "RELEASE_DIRECTORY") {
    if (result.status === "COMPLETE" && result.effectClass === "COMPLETE") {
      return makeReceipt(
        request,
        result,
        "DIRECTORY_RELEASED",
        "NO_RETRY",
        [],
        new Map(tokenState.scopes),
        releaseSuccessHeldStack(tokenState),
      );
    }
    if (
      (result.status === "SYSCALL_FAILED" ||
        result.status === "FAULT_INJECTED" ||
        result.status === "VERIFICATION_FAILED") &&
      result.effectClass === "DEFINITE_NO_EFFECT"
    ) {
      return makeReceipt(
        request,
        result,
        "FAILED_DEFINITE_NO_EFFECT",
        "NO_RETRY",
        [],
        null,
        copiedHeldStack(tokenState),
      );
    }
    if (
      (result.status === "SYSCALL_FAILED" ||
        result.status === "FAULT_INJECTED" ||
        result.status === "VERIFICATION_FAILED") &&
      result.effectClass === "EFFECT_UNCERTAIN"
    ) {
      return makeReceipt(
        request,
        result,
        "FAILED_EFFECT_UNCERTAIN",
        "NO_RETRY",
        [],
        null,
        copiedHeldStack(tokenState),
      );
    }
    if (
      (result.status === "REJECTED" && result.effectClass === "NO_EFFECT") ||
      (result.status === "LIMIT_EXCEEDED" &&
        (result.effectClass === "NO_EFFECT" ||
          result.effectClass === "DEFINITE_NO_EFFECT"))
    ) {
      return makeReceipt(
        request,
        result,
        "REJECTED",
        "NO_RETRY",
        [],
        null,
        copiedHeldStack(tokenState),
      );
    }
    failResult();
  }
  if (
    request.operation === "PERSIST_NOREPLACE" ||
    request.operation === "MKDIR_SYNC" ||
    request.operation === "MOVE_NOREPLACE_SYNC" ||
    request.operation === "MOVE_SYNC_REOBSERVE" ||
    request.operation === "TEMP_CLEANUP"
  ) {
    if (result.status === "COMPLETE" && result.effectClass === "COMPLETE") {
      let inventories;
      if (request.operation === "PERSIST_NOREPLACE") {
        inventories = persistSuccessInventories(request, result, tokenState);
      } else if (request.operation === "MKDIR_SYNC") {
        inventories = mkdirSuccessInventories(request, result, tokenState);
      } else if (request.operation === "TEMP_CLEANUP") {
        inventories = cleanupSuccessInventories(request, result, tokenState);
      } else {
        inventories = moveSuccessInventories(request, result, tokenState);
      }
      const scopes =
        request.operation === "MOVE_NOREPLACE_SYNC" ||
        request.operation === "MOVE_SYNC_REOBSERVE"
          ? moveScopesWithInventories(tokenState, request, inventories)
          : scopesWithInventories(tokenState, request, inventories, false);
      return makeReceipt(
        request,
        result,
        request.expectedOutcome,
        "NO_RETRY",
        inventories,
        scopes,
        mutationSuccessHeldStack(request, tokenState, inventories),
      );
    }
    if (
      (result.status === "SYSCALL_FAILED" ||
        result.status === "FAULT_INJECTED" ||
        result.status === "VERIFICATION_FAILED") &&
      result.effectClass === "DEFINITE_NO_EFFECT"
    ) {
      if (request.operation === "MOVE_SYNC_REOBSERVE") failResult();
      return makeReceipt(
        request,
        result,
        "FAILED_DEFINITE_NO_EFFECT",
        "REPLAN_AFTER_FRESH_INVENTORY",
        [],
        new Map(tokenState.scopes),
        copiedHeldStack(tokenState),
      );
    }
    if (
      (result.status === "SYSCALL_FAILED" ||
        result.status === "FAULT_INJECTED" ||
        result.status === "VERIFICATION_FAILED") &&
      result.effectClass === "MUTATION_OBSERVED_NOT_FULLY_SYNCED"
    ) {
      return makeReceipt(
        request,
        result,
        "FAILED_MUTATION_NOT_FULLY_SYNCED",
        "NO_RETRY",
        [],
        null,
        copiedHeldStack(tokenState),
      );
    }
    if (
      (result.status === "SYSCALL_FAILED" ||
        result.status === "FAULT_INJECTED" ||
        result.status === "VERIFICATION_FAILED") &&
      result.effectClass === "EFFECT_UNCERTAIN"
    ) {
      return makeReceipt(
        request,
        result,
        "FAILED_EFFECT_UNCERTAIN",
        "NO_RETRY",
        [],
        null,
        copiedHeldStack(tokenState),
      );
    }
    if (
      (result.status === "REJECTED" && result.effectClass === "NO_EFFECT") ||
      (result.status === "LIMIT_EXCEEDED" &&
        (result.effectClass === "NO_EFFECT" ||
          result.effectClass === "DEFINITE_NO_EFFECT"))
    ) {
      return makeReceipt(
        request,
        result,
        "REJECTED",
        "NO_RETRY",
        [],
        null,
        copiedHeldStack(tokenState),
      );
    }
    failResult();
  }
  failTransition();
}

export function planCandidateContainmentGuardianStatefsOperationV1(inputValue) {
  const input = validatePlannerEnvelope(inputValue);
  assertPredecessorRequirements();
  if (input.kind === "LOCK_EX_NB") return planLockOperation(input);
  if (input.kind === "INVENTORY") return planInventoryOperation(input);
  if (input.kind === "RELEASE_DIRECTORY") return planReleaseOperation(input);
  return planAutoOperation(input);
}

export function assertCandidateContainmentGuardianStatefsPlanV1(plan) {
  const state = PLAN_STATES.get(plan);
  if (state === undefined || state.status !== "FRESH") failBinding();
  PLAN_STATES.set(
    plan,
    nullRecord([
      ["status", "HANDED_OFF"],
      ["ownerContext", state.ownerContext],
      ["request", state.request],
      ["tokenState", state.tokenState],
    ]),
  );
  return state.ownerContext;
}

export function assertCandidateContainmentGuardianStatefsRequestV1(request) {
  const state = REQUEST_STATES.get(request);
  if (state === undefined || state.status !== "PLANNED") failBinding();
  REQUEST_STATES.set(
    request,
    nullRecord([
      ["status", "DISPATCHED"],
      ["token", state.token],
      ["ownerContext", state.ownerContext],
      ["rootObservation", state.rootObservation],
    ]),
  );
  return true;
}

export function verifyCandidateContainmentGuardianStatefsResultV1(inputValue) {
  const input = exactRecord(
    inputValue,
    ["request", "executorResult"],
    "statefs verifier input",
    failShape,
  );
  const consumed = consumeDispatchedRequest(input.request);
  if (input.request.executionDisposition === "OBSERVATION_ONLY") {
    if (input.executorResult !== null || consumed.tokenState === null) {
      failResult();
    }
    return makeReceipt(
      input.request,
      syntheticObservationOnlyResult(),
      input.request.expectedOutcome,
      "NO_RETRY",
      observationOnlyInventories(input.request, consumed.tokenState),
      new Map(consumed.tokenState.scopes),
      copiedHeldStack(consumed.tokenState),
    );
  }
  if (input.request.executionDisposition !== "EXECUTE") failRequest();
  const result = normalizeExecutorResult(input.request, input.executorResult);
  return verifyExecutedResult(
    input.request,
    result,
    consumed.tokenState,
    consumed.requestState,
  );
}

export function assertCandidateContainmentGuardianStatefsReceiptV1(receipt) {
  if (RECEIPT_STATES.get(receipt) !== true) failBinding();
  return true;
}
