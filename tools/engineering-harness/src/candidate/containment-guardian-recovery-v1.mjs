import { canonicalJson } from "../routing/features.mjs";
import {
  canonicalJsonBytes,
  canonicalJsonLine,
  decodeCanonicalBase64,
  decodeCanonicalJsonLine,
  deepFreeze,
  encodeCanonicalBase64,
  exactBufferByteLength,
  exactDenseArray,
  exactDigest,
  exactRecord,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";
import {
  replayCandidateContainmentGuardianJournalV2,
  verifyCandidateContainmentGuardianGenerationManifestV2,
} from "./containment-guardian-journal-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1,
  assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1,
  assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1,
  assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1,
  assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1,
  assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1,
} from "./containment-guardian-lifetime-v1.mjs";

export const CANDIDATE_CONTAINMENT_RECOVERY_TARGET_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-target/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_INVENTORY_OBSERVATION_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-inventory-observation/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-attempt/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_ANCHORED_EMPTY_ATTEMPT_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-anchored-empty-attempt/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1";
export const CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1 =
  "oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1";
export const CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1 =
  "oxigraph.candidate-containment-lifetime-normal-close-receipt-projection/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_PLAN_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-plan/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_RECORD_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-record/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-replay/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-external-head/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-requirements/v1";

export const CANDIDATE_CONTAINMENT_RECOVERY_SEQUENCE_STARTS_AT_V1 = 1;
export const CANDIDATE_CONTAINMENT_RECOVERY_SEQUENCE_WIDTH_V1 = 16;
export const CANDIDATE_CONTAINMENT_RECOVERY_MAX_ATTEMPTS_V1 = 4;
export const CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_PER_ATTEMPT_V1 = 24;
export const CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_ACROSS_ATTEMPTS_V1 = 96;
export const CANDIDATE_CONTAINMENT_RECOVERY_MAX_CONTROL_VALUE_BYTES_V1 = 16384;
export const CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1 = 16384;
export const CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1 = 65536;
export const CANDIDATE_CONTAINMENT_RECOVERY_MAX_AGGREGATE_RECORD_BYTES_V1 = 6291456;
export const CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1 = "0".repeat(
  64,
);

export const CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1 = deepFreeze([
  "LIVE_BIRTH_GUARDIAN",
  "RECOVERY_ONLY_GUARDIAN",
]);
export const CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_ENTRY_KINDS_V1 = deepFreeze([
  "ANCHORED_EMPTY_ATTEMPT",
  "FINALIZED_ATTEMPT",
]);
export const CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_RESULTS_V1 =
  deepFreeze([
    "NO_RECOVERY_ATTEMPT",
    "ANCHORED_EMPTY_ATTEMPT",
    "FINALIZED_ATTEMPT_PREFIX",
    "RECOVERED",
    "QUARANTINED",
  ]);
export const CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_DIRECTORY_STATES_V1 =
  deepFreeze(["ABSENT", "PRESENT_EMPTY"]);
export const CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1 = deepFreeze([
  "staging",
  "active",
  "closed",
  "recovered",
  "quarantined",
]);
export const CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SOURCE_LOCATIONS_V1 =
  deepFreeze(["staging", "active", "recovered", "quarantined"]);
export const CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1 = deepFreeze([
  "GENESIS_ABORT",
  "SAME_BOOT_RECONCILE",
  "REBOOT_INTERRUPTION",
  "QUARANTINE",
  "RECOVERED_DECISION_RESUME",
  "QUARANTINE_DECISION_RESUME",
]);
export const CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1 = deepFreeze([
  "UNKNOWN_BOOT_ID",
  "DELEGATED_ROOT_IDENTITY_UNKNOWN_OR_DRIFTED",
  "UNSAFE_CGROUP_INVENTORY",
  "INCONSISTENT_GENERATION_STATE",
  "UNSUPPORTED_RECOVERY_INTERFACE",
  "RECOVERY_EFFECT_UNCERTAIN",
]);
export const CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1 = deepFreeze([
  "RECOVERY_ATTEMPT_DURABLE",
  "GENESIS_ABORT_RECOVERY_REQUIRED",
  "REBOOT_INTERRUPTION_OBSERVED",
  "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
  "COMMAND_DESCRIPTOR_CLOSED_OBSERVED",
  "CONTROL_PATH_ABSENT_OBSERVED",
  "CONTROL_KILL_INTENT_DURABLE",
  "CONTROL_KILL_WRITE_COMPLETED",
  "JOB_PATH_ABSENT_OBSERVED",
  "JOB_FIRST_KILL_INTENT_DURABLE",
  "JOB_FIRST_KILL_WRITE_COMPLETED",
  "CONTROL_QUIESCENT_OBSERVED",
  "JOB_SECOND_KILL_INTENT_DURABLE",
  "JOB_SECOND_KILL_WRITE_COMPLETED",
  "JOB_QUIESCENT_OBSERVED",
  "STATUS_EOF_OBSERVED",
  "SUPERVISOR_PIDFD_READABLE_OBSERVED",
  "SUPERVISOR_PIDFD_HUP_OBSERVED",
  "SUPERVISOR_REAP_INTENT_DURABLE",
  "SUPERVISOR_REAPED_OBSERVED",
  "CGROUP_REMOVAL_INTENT_DURABLE",
  "CGROUP_PATHS_ABSENT_OBSERVED",
  "RECOVERED_TOMBSTONE_DURABLE",
  "RECOVERED_TOMBSTONE_ADOPTED",
  "RECOVERED_LOCATION_OBSERVED",
  "QUARANTINE_INTENT_DURABLE",
  "QUARANTINE_INTENT_ADOPTED",
  "QUARANTINED_LOCATION_OBSERVED",
]);
export const CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1 = deepFreeze([
  "RECOVERY_PLAN_READY",
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
]);
export const CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_STATUSES_V1 = deepFreeze([
  "NO_RECOVERY_ATTEMPT",
  "VALID_RECOVERY_PREFIX_REPLAYED",
  "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED",
  "COMPLETE_RECOVERED_REPLAYED",
  "COMPLETE_QUARANTINED_REPLAYED",
]);
export const CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITION_SELECTION_PRECEDENCE_V1 =
  deepFreeze([
    "PRE_ACTOR_REJECTION",
    "STATE_FILESYSTEM_INTERFACE_REJECTION",
    "NORMAL_STATE_18",
    "RECOVERY_LOCATION_TERMINAL",
    "ATTEMPT_LIMIT",
    "INHERITED_RECOVERED_DECISION",
    "INHERITED_QUARANTINE_DECISION",
    "FRESH_DISPOSITION",
  ]);
export const CANDIDATE_CONTAINMENT_RECOVERY_UNRESOLVED_EFFECT_INTENT_STATES_V1 =
  deepFreeze([
    "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
    "CONTROL_KILL_INTENT_DURABLE",
    "JOB_FIRST_KILL_INTENT_DURABLE",
    "JOB_SECOND_KILL_INTENT_DURABLE",
    "SUPERVISOR_REAP_INTENT_DURABLE",
    "CGROUP_REMOVAL_INTENT_DURABLE",
  ]);

function fail(message) {
  throw new TypeError(message);
}

function falseRecord(keys) {
  const entries = [];
  for (const key of keys) entries.push([key, false]);
  return deepFreeze(nullRecord(entries));
}

function nullFactRecord(keys) {
  const entries = [];
  for (const key of keys) entries.push([key, null]);
  entries.push(["physicalEligibility", false]);
  entries.push(["finalDecisionEligibility", false]);
  entries.push(["productionContainment", false]);
  return deepFreeze(nullRecord(entries));
}

const AUTHORITY_KEYS = deepFreeze([
  "mayPersistLifetimeAnchor",
  "mayConsumeRecoveryActorEpoch",
  "mayAppendLifetimeLedger",
  "mayCreateAttemptDirectory",
  "mayPersistRecoveryRecord",
  "mayBlockAdmission",
  "mayMutateStateFilesystem",
  "mayMoveGeneration",
  "mayQuarantineGeneration",
  "mayMutateDelegatedCgroup",
  "mayWriteCgroupKill",
  "mayRemoveCgroupPath",
  "maySignalPersistedPid",
  "mayCloseUnheldDescriptor",
  "mayCloseCommandDescriptor",
  "mayReadStatusDescriptor",
  "mayUseSupervisorPidfd",
  "mayReapSupervisor",
  "mayWriteSupervisorCommand",
  "mayExecuteRecoveryPlan",
  "mayAcceptApplicationResult",
  "mayIssueApplicationReceipt",
  "mayRegisterRuntime",
  "mayQualify",
  "mayPromote",
  "mayPublish",
  "productionContainment",
]);
const NONCLAIM_KEYS = deepFreeze([
  "serializedTargetProvesManifestOrigin",
  "serializedAttemptProvesActorOrigin",
  "serializedReplayProvesFreshness",
  "serializedReplayProvesFreshRandomness",
  "serializedReplayProvesExclusiveStateRootLock",
  "serializedReplayProvesCompleteFilesystemInventory",
  "serializedReplayProvesStateFilesystemMetadata",
  "serializedReplayProvesFilesystemDurability",
  "serializedReplayProvesLifetimeAnchorOrigin",
  "serializedReplayProvesLifetimeAnchorDurability",
  "serializedReplayProvesGuardianExecution",
  "serializedReplayProvesGuardianLiveness",
  "serializedReplayProvesGuardianParentage",
  "serializedActorDigestProvesProcessContinuity",
  "reportedBootDigestComparisonProvesBootIdentity",
  "serializedReplayProvesStateRootIdentity",
  "serializedReplayProvesDelegatedRootIdentity",
  "serializedReplayProvesLifetimeCgroupIdentity",
  "serializedReplayProvesSupervisorExecution",
  "serializedReplayProvesDescriptorOwnership",
  "serializedReplayProvesPidfdOwnership",
  "serializedReplayProvesDirectChildReap",
  "serializedReplayProvesSupervisorExitStatus",
  "serializedReplayProvesCgroupKillEffect",
  "serializedReplayProvesCgroupQuiescence",
  "serializedReplayProvesCgroupRemoval",
  "serializedReplayProvesDescriptorClosure",
  "serializedReplayProvesGenerationMove",
  "serializedReplayProvesGenerationLocation",
  "serializedReplayProvesApplicationResult",
  "serializedReplayGrantsRecoveryMutationAuthority",
  "completeRecoveryReplayProvesOperationalRecoveryClearance",
  "operationArtifactProvesEffect",
  "evidenceArtifactProvesObservation",
  "embeddedRecoveryRecordProvesTrustedOrigin",
  "canonicalBase64ProvesPersistence",
  "suppliedAnchorOriginProven",
  "suppliedLifecycleInventoryProvesCompleteness",
  "tailDeletionExcludedByInternalReplay",
  "plannerBlockedStatusEnforcesAdmissionBlock",
]);
const NULL_PHYSICAL_FACT_KEYS = deepFreeze([
  "stateRootIdentityObserved",
  "stateFilesystemInterfaceAvailable",
  "generationManifestPersisted",
  "normalJournalFilesystemDurability",
  "lifetimeAnchorPersisted",
  "attemptDirectoryPersisted",
  "recoveryRecordFilesystemDurability",
  "filesystemInventoryValidated",
  "generationSourceLocationObserved",
  "guardianExecuted",
  "currentBootIdentityObserved",
  "delegatedRootIdentityObserved",
  "lifetimeCgroupIdentityObserved",
  "recoveryActorLive",
  "commandDescriptorHeld",
  "commandDescriptorClosed",
  "statusDescriptorHeld",
  "statusEofObserved",
  "supervisorPidfdHeld",
  "supervisorPidfdReadable",
  "supervisorPidfdHup",
  "directChildWaitAuthority",
  "supervisorReaped",
  "supervisorExitStatus",
  "controlCgroupPresent",
  "jobCgroupPresent",
  "controlKillWriteCompleted",
  "jobFirstKillWriteCompleted",
  "jobSecondKillWriteCompleted",
  "controlQuiescent",
  "jobQuiescent",
  "cgroupPathsAbsent",
  "recoveredTombstonePersisted",
  "quarantineIntentPersisted",
  "generationMoved",
  "recoveredLocationObserved",
  "quarantinedLocationObserved",
  "applicationResult",
  "physicalRecoveryRequired",
  "cleanupSafe",
  "binding",
]);

export const CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1 =
  falseRecord(AUTHORITY_KEYS);
export const CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1 =
  falseRecord(NONCLAIM_KEYS);
export const CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1 = nullFactRecord(
  NULL_PHYSICAL_FACT_KEYS,
);

const RULES = deepFreeze(
  nullRecord([
    [
      "normalHeadCgroupPresenceMatrix",
      "null:00;1:00;2:00|10|01|11;3-14:11;15:00|10|01|11;16-18:00",
    ],
    [
      "normalDescriptorMatrix",
      "null|1-3:0000;4:command-any,status-any,unreaped-pidfd-wait-00|11,reaped-pidfd-wait-00|10;5-12:command-any,status-any,unreaped-pidfd-wait-11,reaped-pidfd-wait-00|10;13-16:command-any,status-any,pidfd-wait-00|10;17-18:0000;recovery-only:0000/v1",
    ],
    ["targetHeadRule", "all-four-null-genesis-or-all-four-verified-v2-head/v1"],
    [
      "targetProjectionRule",
      "derive-unbranded-from-reverified-manifest-and-complete-journal;create-or-verify-target-requires-exact-complete-tail-lifetime-selector-pair;all-projection-fields-match/v1",
    ],
    [
      "targetUniquenessRule",
      "lifetime-replay-enforces-one-target-per-generation-identity-and-no-target-sha-reuse-across-identities/v1",
    ],
    [
      "boundarySetAssertionRule",
      "target-required;historical-anchor-carriers-dense-ledger-order-and-brand-nested-projection-plus-raw;optional-current-carrier-head-close;same-originating-replay-instance;current-anchor-predecessor-equals-external-head;byte-equal-cross-replay-rejects/v1",
    ],
    [
      "firstAttemptPredecessorRule",
      "null-actor-null-directory-null-sequence-zero-raw/v1",
    ],
    [
      "emptyAttemptHeadRule",
      "nonnull-actor-nonnull-directory-null-sequence-zero-raw/v1",
    ],
    [
      "decisionInheritance",
      "first-terminal-decision-is-transitive-and-irreversible/v1",
    ],
    [
      "decisionSourceRule",
      "fresh-plan:decision-source-equals-singleton-staging-or-active;first-durable-decision-freezes-source;resume-current-location-is-exactly-decision-source-or-matching-destination;destination-only-syncs-and-reobserves-decision-source-parent-plus-destination/v1",
    ],
    [
      "actorLineageRule",
      "live-birth-only-on-target-boot-before-any-recovery-only-or-reboot;proved-boot-boundary-always-recovery-only;recovery-only-never-live-birth/v1",
    ],
    [
      "descriptorLineageRule",
      "consecutive-live-birth-held-booleans-only-true-to-false;command-close-clears-command;reap-clears-wait;recovery-only-or-reboot-clears-all/v1",
    ],
    [
      "bootLifetimeTransitionRule",
      "same-boot-repeats-current-identities;each-proved-reboot-consumes-distinct-recovery-lifetime;later-entries-repeat-that-boots-identities/v1",
    ],
    [
      "bootIdentityRelationshipRule",
      "same-boot-effect-branch:report-equals-current-and-target;proved-reboot-or-required-resume:report-equals-current;quarantine-or-quarantine-resume:exact-adverse-relation-validated/v1",
    ],
    [
      "delegatedRootIdentityRelationshipRule",
      "same-boot-effect-branch:report-and-current-equal-target;proved-reboot-or-required-resume:report-equals-current;quarantine-or-quarantine-resume:exact-null-mismatch-or-current-relation-validated/v1",
    ],
    [
      "pidfdObservationRule",
      "reap-proven-from-normal-state13plus-or-recovery-reaped;held-and-not-reap-proven:readable-and-wait-required;held-and-reap-proven:hup-and-no-wait;not-held:none;held-no-wait-without-reap-proof:inconsistent/v1",
    ],
    [
      "recoveryPrefixCgroupPresenceRule",
      "before-removal-intent:normal-matrix-no-reappearance;after-removal-intent:present-to-absent-only;after-paths-absent:00/v1",
    ],
    [
      "selectedInterfaceRule",
      "recovery-interface-means-selected-nonfilesystem-descriptor-pidfd-wait-or-delegated-cgroup-interface;filesystem-only-resume-may-report-false/v1",
    ],
    [
      "stateFilesystemGateRule",
      "false-before-state18-terminal-anchor-or-ready:no-new-anchor-or-actor-launch-or-attempt-record-quarantine-close-or-generation-move;supplied-durable-anchor-preserved;after-restore-exact-pre-temp-absent-or-empty-finalizes-anchored-empty;temp-or-other-residue-remains-unsafe/v1",
    ],
    [
      "twoPhaseAnchorRule",
      "phase1-anchor-required-with-no-context;durable-lifetime-prelaunch-anchor;phase2-reobserve-and-match-before-ready;anchor-without-record1-finalizes-anchored-empty-only-from-exact-residue-free-absent-or-empty-pre-temp-observation;temp-or-other-residue-blocks-or-quarantines;actor-never-reused/v1",
    ],
    [
      "state18CloseReceiptRule",
      "active-or-unreceipted-closed:close-move-required;receipt-branded-exact-target-dual-parent-sync-and-reobserve:closed-location-observed/v1",
    ],
    [
      "generationMoveOrderingRule",
      "decision-or-adoption-durable;rename-noreplace-from-immutable-decision-source-or-destination-only;sync-decision-source-and-destination-parents;reobserve-decision-source-absence-and-destination-identity;location-record-durable/v1",
    ],
    ["operationAndEvidencePayloadShape", "opaque-bounded-canonical-json"],
    [
      "dispositionRelationshipMatrix",
      "GENESIS_ABORT=source:staging|active,decision-source:source,head:null,boot:target,cgroup:00;SAME_BOOT_RECONCILE=source:active,decision-source:source,head:1-17,boot:target,root:target-and-current,cgroup:normal-matrix;REBOOT_INTERRUPTION=source-head-pairs:[(staging,null),(active,null),(active,1-17)],decision-source:source,boot:different-proved,actor:recovery-only,cgroup:00,descriptors:0000;QUARANTINE=source:staging|active,target-and-predecessor:valid,decision-source:source,state-root-and-lifetime:exact,inherited:none,predicate:first-true;RECOVERED_DECISION_RESUME=inherited:recovered,terminal-location:false,decision-source:ancestor,current-source:decision-source|recovered,cgroup:00;QUARANTINE_DECISION_RESUME=inherited:quarantined,terminal-location:false,decision-source:ancestor,current-source:decision-source|quarantined,delegated-effects:none/v1",
    ],
    [
      "quarantinePredicateRule",
      "boot-null-or-applicable-current-mismatch>delegated-null-or-applicable-current-mismatch-or-same-boot-target-drift>unsafe-cgroup-inventory>disposition-presence-or-descriptor-mismatch>selected-nonfilesystem-interface-unavailable>prior-effect-uncertain/v1",
    ],
    [
      "lifecycleInventoryBlockRule",
      "malformed-or-corrupt:reject-before-plan;zero-or-multiple-or-unsafe-entry:unsafe-filesystem-inventory-blocked;one-safe-source-required-before-durable-quarantine/v1",
    ],
  ]),
);

if (
  CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1 !==
  "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773"
) {
  fail("lifetime requirements digest changed");
}

export const CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1 = deepFreeze(
  nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SCHEMA_V1],
    ["targetSchema", CANDIDATE_CONTAINMENT_RECOVERY_TARGET_SCHEMA_V1],
    [
      "inventoryObservationSchema",
      CANDIDATE_CONTAINMENT_RECOVERY_INVENTORY_OBSERVATION_SCHEMA_V1,
    ],
    [
      "lifetimeTargetProjectionSchema",
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1,
    ],
    [
      "lifetimeAnchorProjectionSchema",
      CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1,
    ],
    [
      "normalCloseReceiptProjectionSchema",
      CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1,
    ],
    ["attemptSchema", CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SCHEMA_V1],
    [
      "anchoredEmptyAttemptSchema",
      CANDIDATE_CONTAINMENT_RECOVERY_ANCHORED_EMPTY_ATTEMPT_SCHEMA_V1,
    ],
    ["planSchema", CANDIDATE_CONTAINMENT_RECOVERY_PLAN_SCHEMA_V1],
    ["recordSchema", CANDIDATE_CONTAINMENT_RECOVERY_RECORD_SCHEMA_V1],
    ["replayEntryKinds", CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_ENTRY_KINDS_V1],
    ["replaySchema", CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_SCHEMA_V1],
    [
      "externalHeadSchema",
      CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1,
    ],
    [
      "externalHeadResults",
      CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_RESULTS_V1,
    ],
    [
      "generationManifestSchema",
      "oxigraph.candidate-containment-guardian-generation-manifest/v2",
    ],
    [
      "journalBundleSchema",
      "oxigraph.candidate-containment-guardian-journal-bundle/v2",
    ],
    [
      "journalV1RequirementsSha256",
      "e76b54712178631c51eb90a8c46ce0bae29b9a0d66b25ada937566d65cf91bb4",
    ],
    [
      "journalV2RequirementsSha256",
      "95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26",
    ],
    [
      "lifetimeV1RequirementsSha256",
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1,
    ],
    [
      "lifetimeBoundaryBrandProtocol",
      "complete-tail-matched-lifetime-replay-weakmap-pair-brand/v1",
    ],
    [
      "authoritySha256",
      sha256(canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1)),
    ],
    [
      "nonclaimsSha256",
      sha256(canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1)),
    ],
    [
      "physicalFactsSha256",
      sha256(
        canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1),
      ),
    ],
    ["recordFilename", "<16-digit-sequence>-<record-raw-sha256>.jsonl"],
    ["embeddedBytesEncoding", "rfc4648-canonical-padded-base64"],
    ["rawHashAlgorithm", "sha256-canonical-jsonl-with-final-lf/v1"],
    ["semanticHashAlgorithm", "sha256-canonical-json-without-final-lf/v1"],
    [
      "bindingHashAlgorithm",
      "sha256-canonical-binding-json-without-final-lf/v1",
    ],
    ["sequenceStartsAt", CANDIDATE_CONTAINMENT_RECOVERY_SEQUENCE_STARTS_AT_V1],
    ["sequenceWidth", CANDIDATE_CONTAINMENT_RECOVERY_SEQUENCE_WIDTH_V1],
    ["maximumAttempts", CANDIDATE_CONTAINMENT_RECOVERY_MAX_ATTEMPTS_V1],
    [
      "maximumRecordsPerAttempt",
      CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_PER_ATTEMPT_V1,
    ],
    [
      "maximumRecordsAcrossAttempts",
      CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_ACROSS_ATTEMPTS_V1,
    ],
    [
      "maximumControlValueBytes",
      CANDIDATE_CONTAINMENT_RECOVERY_MAX_CONTROL_VALUE_BYTES_V1,
    ],
    [
      "maximumOperationOrEvidenceBytes",
      CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
    ],
    ["maximumRecordBytes", CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1],
    [
      "maximumAggregateRecordBytes",
      CANDIDATE_CONTAINMENT_RECOVERY_MAX_AGGREGATE_RECORD_BYTES_V1,
    ],
    ["genesisRawSha256", CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1],
    ["actorKinds", CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1],
    [
      "attemptDirectoryStates",
      CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_DIRECTORY_STATES_V1,
    ],
    ["sourceLocations", CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1],
    [
      "attemptSourceLocations",
      CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SOURCE_LOCATIONS_V1,
    ],
    ["dispositions", CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1],
    ["quarantineReasons", CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1],
    ["recordStates", CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1],
    ["planStatuses", CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1],
    ["replayStatuses", CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_STATUSES_V1],
    ["normalHeadCgroupPresenceMatrix", RULES.normalHeadCgroupPresenceMatrix],
    ["normalDescriptorMatrix", RULES.normalDescriptorMatrix],
    ["targetHeadRule", RULES.targetHeadRule],
    ["targetProjectionRule", RULES.targetProjectionRule],
    ["targetUniquenessRule", RULES.targetUniquenessRule],
    ["boundarySetAssertionRule", RULES.boundarySetAssertionRule],
    ["firstAttemptPredecessorRule", RULES.firstAttemptPredecessorRule],
    ["emptyAttemptHeadRule", RULES.emptyAttemptHeadRule],
    ["lifetimeTargetBrandRequired", true],
    ["lifetimeAnchorRequiredPerAttempt", true],
    ["twoPhaseRecoveryPlanning", true],
    ["externalHeadBrandRequired", true],
    ["normalCloseReceiptBrandRequired", true],
    ["externalTailHeadOptional", true],
    ["externalTailHeadRequiredForPlanHandoff", true],
    ["decisionInheritance", RULES.decisionInheritance],
    ["decisionSourceRule", RULES.decisionSourceRule],
    [
      "dispositionSelectionPrecedence",
      CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITION_SELECTION_PRECEDENCE_V1,
    ],
    ["dispositionRelationshipMatrix", RULES.dispositionRelationshipMatrix],
    [
      "quarantineReasonPrecedence",
      CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1,
    ],
    ["quarantinePredicateRule", RULES.quarantinePredicateRule],
    ["lifecycleInventoryBlockRule", RULES.lifecycleInventoryBlockRule],
    ["actorLineageRule", RULES.actorLineageRule],
    ["descriptorLineageRule", RULES.descriptorLineageRule],
    ["bootLifetimeTransitionRule", RULES.bootLifetimeTransitionRule],
    ["bootIdentityRelationshipRule", RULES.bootIdentityRelationshipRule],
    [
      "delegatedRootIdentityRelationshipRule",
      RULES.delegatedRootIdentityRelationshipRule,
    ],
    [
      "unresolvedEffectIntentStates",
      CANDIDATE_CONTAINMENT_RECOVERY_UNRESOLVED_EFFECT_INTENT_STATES_V1,
    ],
    ["pidfdObservationRule", RULES.pidfdObservationRule],
    [
      "recoveryPrefixCgroupPresenceRule",
      RULES.recoveryPrefixCgroupPresenceRule,
    ],
    ["selectedInterfaceRule", RULES.selectedInterfaceRule],
    ["stateFilesystemGateRule", RULES.stateFilesystemGateRule],
    ["twoPhaseAnchorRule", RULES.twoPhaseAnchorRule],
    ["state18CloseReceiptRule", RULES.state18CloseReceiptRule],
    ["generationMoveOrderingRule", RULES.generationMoveOrderingRule],
    [
      "operationAndEvidencePayloadShape",
      RULES.operationAndEvidencePayloadShape,
    ],
    ["operationAndEvidenceSemanticsInterpreted", false],
    ["standaloneRecordHashChainValidated", false],
    ["tailDeletionExcludedByInternalReplay", false],
    ["suppliedAnchorOriginProven", false],
    ["filesystemMechanicsImplemented", false],
    ["filesystemInventoryValidationImplemented", false],
    ["pureLifetimeContractIntegrated", true],
    ["lifetimeLedgerFilesystemMechanicsImplemented", false],
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

export const CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1 = sha256(
  canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1),
);

const TARGET_FIELDS = deepFreeze([
  "schema",
  "generationManifestRawSha256",
  "generationIdentity",
  "generationIdentitySha256",
  "birthGuardianEpochSha256",
  "bootIdSha256",
  "admissionGenerationSha256",
  "controlGenerationSha256",
  "jobGenerationSha256",
  "latestBundleSequence",
  "latestBundleRawSha256",
  "latestInnerRecordRawSha256",
  "latestNormalState",
  "targetSha256",
]);
const TARGET_PROJECTION_FIELDS = deepFreeze([
  "schema",
  "generationIdentitySha256",
  "generationManifestRawSha256",
  "targetSha256",
  "targetBootIdSha256",
  "targetDelegatedRootIdentitySha256",
  "targetLifetimeEpochSha256",
  "latestBundleSequence",
  "latestBundleRawSha256",
  "latestInnerRecordRawSha256",
  "latestNormalState",
  "projectionSha256",
]);
const INVENTORY_FIELDS = deepFreeze([
  "schema",
  "generationIdentitySha256",
  "stagingPresent",
  "activePresent",
  "closedPresent",
  "recoveredPresent",
  "quarantinedPresent",
  "unsafeEntriesPresent",
  "inventorySha256",
]);
const TARGET_DERIVE_INPUT_FIELDS = deepFreeze([
  "generationManifest",
  "normalJournalBundles",
]);
const TARGET_CREATE_INPUT_FIELDS = deepFreeze([
  "generationManifest",
  "normalJournalBundles",
  "lifetimeTargetSelection",
]);
const TARGET_VERIFY_INPUT_FIELDS = deepFreeze([
  "target",
  "generationManifest",
  "normalJournalBundles",
  "lifetimeTargetSelection",
]);
const INVENTORY_CREATE_INPUT_FIELDS = deepFreeze([
  "generationIdentitySha256",
  "stagingPresent",
  "activePresent",
  "closedPresent",
  "recoveredPresent",
  "quarantinedPresent",
  "unsafeEntriesPresent",
]);
const INVENTORY_VERIFY_INPUT_FIELDS = deepFreeze([
  "observation",
  "expectedGenerationIdentitySha256",
]);

const targetBrands = new WeakMap();
const inventoryBrands = new WeakMap();
const targetRefreshPermitted = new WeakSet();
const targetPendingActorKinds = new WeakMap();
const targetLastReplayAnchorKinds = new WeakMap();

function exactNullableDigest(value, label) {
  if (value === null) return null;
  return exactDigest(value, label, fail);
}

function exactBool(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be boolean`);
  return value;
}

function exactText(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail(`${label} must be nonempty NUL-free text`);
  }
  return value;
}

function exactChoice(value, choices, label) {
  if (!choices.includes(value)) fail(`${label} changed`);
  return value;
}

function semanticDigest(value) {
  return sha256(canonicalJsonBytes(value));
}

function immutableRecord(entries) {
  return deepFreeze(nullRecord(entries));
}

function deriveTargetArtifacts(generationManifest, normalJournalBundles) {
  const bundles = exactDenseArray(
    normalJournalBundles,
    "recovery target normal journal bundles",
    18,
    fail,
  );
  const manifest =
    verifyCandidateContainmentGuardianGenerationManifestV2(generationManifest);
  let suppliedSequence = 1;
  for (const bundleReference of bundles) {
    const exactReference = exactRecord(
      bundleReference,
      ["name", "bytes"],
      "recovery target journal bundle reference",
      fail,
    );
    if (
      !exactReference.name.startsWith(
        `${String(suppliedSequence).padStart(16, "0")}-`,
      )
    ) {
      fail("recovery target journal bundle order changed");
    }
    suppliedSequence += 1;
  }
  let latestBundleSequence = null;
  let latestBundleRawSha256 = null;
  let latestInnerRecordRawSha256 = null;
  let latestNormalState = null;
  if (bundles.length > 0) {
    const replay = replayCandidateContainmentGuardianJournalV2({
      bundles,
      expectedGenerationIdentitySha256: manifest.generationIdentitySha256,
      expectedBirthGuardianEpochSha256: manifest.birthGuardianEpochSha256,
      expectedLatestBundleRawSha256: null,
      reportedCurrentBootIdSha256: manifest.bootIdSha256,
    });
    latestBundleSequence = String(replay.bundleCount).padStart(16, "0");
    latestBundleRawSha256 = replay.latestBundleRawSha256;
    latestInnerRecordRawSha256 = replay.latestInnerRecordRawSha256;
    latestNormalState = replay.reportedLatestState;
  }
  const targetPrefix = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_TARGET_SCHEMA_V1],
    ["generationManifestRawSha256", manifest.rawSha256],
    ["generationIdentity", manifest.generationIdentity],
    ["generationIdentitySha256", manifest.generationIdentitySha256],
    ["birthGuardianEpochSha256", manifest.birthGuardianEpochSha256],
    ["bootIdSha256", manifest.bootIdSha256],
    ["admissionGenerationSha256", manifest.admissionGenerationSha256],
    ["controlGenerationSha256", manifest.controlGenerationSha256],
    ["jobGenerationSha256", manifest.jobGenerationSha256],
    ["latestBundleSequence", latestBundleSequence],
    ["latestBundleRawSha256", latestBundleRawSha256],
    ["latestInnerRecordRawSha256", latestInnerRecordRawSha256],
    ["latestNormalState", latestNormalState],
  ]);
  const target = immutableRecord([
    ["schema", targetPrefix.schema],
    ["generationManifestRawSha256", targetPrefix.generationManifestRawSha256],
    ["generationIdentity", targetPrefix.generationIdentity],
    ["generationIdentitySha256", targetPrefix.generationIdentitySha256],
    ["birthGuardianEpochSha256", targetPrefix.birthGuardianEpochSha256],
    ["bootIdSha256", targetPrefix.bootIdSha256],
    ["admissionGenerationSha256", targetPrefix.admissionGenerationSha256],
    ["controlGenerationSha256", targetPrefix.controlGenerationSha256],
    ["jobGenerationSha256", targetPrefix.jobGenerationSha256],
    ["latestBundleSequence", targetPrefix.latestBundleSequence],
    ["latestBundleRawSha256", targetPrefix.latestBundleRawSha256],
    ["latestInnerRecordRawSha256", targetPrefix.latestInnerRecordRawSha256],
    ["latestNormalState", targetPrefix.latestNormalState],
    ["targetSha256", semanticDigest(targetPrefix)],
  ]);
  const projectionPrefix = nullRecord([
    [
      "schema",
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1,
    ],
    ["generationIdentitySha256", target.generationIdentitySha256],
    ["generationManifestRawSha256", target.generationManifestRawSha256],
    ["targetSha256", target.targetSha256],
    ["targetBootIdSha256", target.bootIdSha256],
    [
      "targetDelegatedRootIdentitySha256",
      target.generationIdentity.delegatedRootIdentitySha256,
    ],
    ["targetLifetimeEpochSha256", target.birthGuardianEpochSha256],
    ["latestBundleSequence", target.latestBundleSequence],
    ["latestBundleRawSha256", target.latestBundleRawSha256],
    ["latestInnerRecordRawSha256", target.latestInnerRecordRawSha256],
    ["latestNormalState", target.latestNormalState],
  ]);
  const projection = immutableRecord([
    ["schema", projectionPrefix.schema],
    ["generationIdentitySha256", projectionPrefix.generationIdentitySha256],
    [
      "generationManifestRawSha256",
      projectionPrefix.generationManifestRawSha256,
    ],
    ["targetSha256", projectionPrefix.targetSha256],
    ["targetBootIdSha256", projectionPrefix.targetBootIdSha256],
    [
      "targetDelegatedRootIdentitySha256",
      projectionPrefix.targetDelegatedRootIdentitySha256,
    ],
    ["targetLifetimeEpochSha256", projectionPrefix.targetLifetimeEpochSha256],
    ["latestBundleSequence", projectionPrefix.latestBundleSequence],
    ["latestBundleRawSha256", projectionPrefix.latestBundleRawSha256],
    ["latestInnerRecordRawSha256", projectionPrefix.latestInnerRecordRawSha256],
    ["latestNormalState", projectionPrefix.latestNormalState],
    ["projectionSha256", semanticDigest(projectionPrefix)],
  ]);
  return immutableRecord([
    ["target", target],
    ["projection", projection],
  ]);
}

function targetFromArtifacts(
  generationManifest,
  normalJournalBundles,
  lifetimeTargetSelection,
) {
  const derived = deriveTargetArtifacts(
    generationManifest,
    normalJournalBundles,
  );
  assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1({
    selection: lifetimeTargetSelection,
    generationIdentitySha256: derived.target.generationIdentitySha256,
    targetSha256: derived.target.targetSha256,
    targetBootIdSha256: derived.target.bootIdSha256,
    targetDelegatedRootIdentitySha256:
      derived.target.generationIdentity.delegatedRootIdentitySha256,
    targetLifetimeEpochSha256: derived.target.birthGuardianEpochSha256,
  });
  const selection = exactRecord(
    lifetimeTargetSelection,
    ["recoveryTargetProjection", "lifetimeTargetRecordRawSha256"],
    "lifetime target selection",
    fail,
  );
  exactDigest(
    selection.lifetimeTargetRecordRawSha256,
    "lifetime target selection record hash",
    fail,
  );
  const projection = exactRecord(
    selection.recoveryTargetProjection,
    TARGET_PROJECTION_FIELDS,
    "lifetime recovery target projection",
    fail,
  );
  if (canonicalJson(projection) !== canonicalJson(derived.projection)) {
    fail("lifetime recovery target projection changed");
  }
  const target = derived.target;
  targetBrands.set(
    target,
    immutableRecord([
      ["selection", lifetimeTargetSelection],
      ["liveBirthActorStillPermitted", true],
    ]),
  );
  return target;
}

export function deriveCandidateContainmentRecoveryTargetProjectionV1(input) {
  const record = exactRecord(
    input,
    TARGET_DERIVE_INPUT_FIELDS,
    "recovery target projection input",
    fail,
  );
  return deriveTargetArtifacts(
    record.generationManifest,
    record.normalJournalBundles,
  ).projection;
}

export function createCandidateContainmentRecoveryTargetV1(input) {
  const record = exactRecord(
    input,
    TARGET_CREATE_INPUT_FIELDS,
    "recovery target input",
    fail,
  );
  return targetFromArtifacts(
    record.generationManifest,
    record.normalJournalBundles,
    record.lifetimeTargetSelection,
  );
}

function normalizeTarget(value, label) {
  const record = exactRecord(value, TARGET_FIELDS, label, fail);
  const generationIdentity = record.generationIdentity;
  exactDigest(
    record.generationManifestRawSha256,
    `${label} manifest hash`,
    fail,
  );
  exactDigest(
    record.generationIdentitySha256,
    `${label} generation hash`,
    fail,
  );
  exactDigest(record.birthGuardianEpochSha256, `${label} birth epoch`, fail);
  exactDigest(record.bootIdSha256, `${label} boot`, fail);
  exactDigest(record.admissionGenerationSha256, `${label} admission`, fail);
  exactDigest(record.controlGenerationSha256, `${label} control`, fail);
  exactDigest(record.jobGenerationSha256, `${label} job`, fail);
  if (
    record.schema !== CANDIDATE_CONTAINMENT_RECOVERY_TARGET_SCHEMA_V1 ||
    record.targetSha256 !==
      semanticDigest(
        nullRecord([
          ["schema", record.schema],
          ["generationManifestRawSha256", record.generationManifestRawSha256],
          ["generationIdentity", generationIdentity],
          ["generationIdentitySha256", record.generationIdentitySha256],
          ["birthGuardianEpochSha256", record.birthGuardianEpochSha256],
          ["bootIdSha256", record.bootIdSha256],
          ["admissionGenerationSha256", record.admissionGenerationSha256],
          ["controlGenerationSha256", record.controlGenerationSha256],
          ["jobGenerationSha256", record.jobGenerationSha256],
          ["latestBundleSequence", record.latestBundleSequence],
          ["latestBundleRawSha256", record.latestBundleRawSha256],
          ["latestInnerRecordRawSha256", record.latestInnerRecordRawSha256],
          ["latestNormalState", record.latestNormalState],
        ]),
      )
  ) {
    fail(`${label} canonical digest changed`);
  }
  exactDigest(record.targetSha256, `${label} target hash`, fail);
  exactNullableDigest(record.latestBundleRawSha256, `${label} bundle hash`);
  exactNullableDigest(
    record.latestInnerRecordRawSha256,
    `${label} record hash`,
  );
  return immutableRecord([
    ["schema", record.schema],
    ["generationManifestRawSha256", record.generationManifestRawSha256],
    ["generationIdentity", record.generationIdentity],
    ["generationIdentitySha256", record.generationIdentitySha256],
    ["birthGuardianEpochSha256", record.birthGuardianEpochSha256],
    ["bootIdSha256", record.bootIdSha256],
    ["admissionGenerationSha256", record.admissionGenerationSha256],
    ["controlGenerationSha256", record.controlGenerationSha256],
    ["jobGenerationSha256", record.jobGenerationSha256],
    ["latestBundleSequence", record.latestBundleSequence],
    ["latestBundleRawSha256", record.latestBundleRawSha256],
    ["latestInnerRecordRawSha256", record.latestInnerRecordRawSha256],
    ["latestNormalState", record.latestNormalState],
    ["targetSha256", record.targetSha256],
  ]);
}

export function verifyCandidateContainmentRecoveryTargetV1(input) {
  const record = exactRecord(
    input,
    TARGET_VERIFY_INPUT_FIELDS,
    "recovery target verification input",
    fail,
  );
  const supplied = normalizeTarget(record.target, "recovery target");
  const existingAssociation = targetBrands.get(record.target);
  let sameLifetimeReplay = false;
  if (existingAssociation) {
    const previousSelection = exactRecord(
      existingAssociation.selection,
      ["recoveryTargetProjection", "lifetimeTargetRecordRawSha256"],
      "previous lifetime target selection",
      fail,
    );
    const currentSelection = exactRecord(
      record.lifetimeTargetSelection,
      ["recoveryTargetProjection", "lifetimeTargetRecordRawSha256"],
      "current lifetime target selection",
      fail,
    );
    sameLifetimeReplay =
      previousSelection.recoveryTargetProjection ===
        currentSelection.recoveryTargetProjection &&
      previousSelection.lifetimeTargetRecordRawSha256 ===
        currentSelection.lifetimeTargetRecordRawSha256;
  }
  if (
    existingAssociation &&
    !sameLifetimeReplay &&
    !targetRefreshPermitted.has(record.target)
  ) {
    fail("recovery target selection replay origin changed");
  }
  const rebuilt = targetFromArtifacts(
    record.generationManifest,
    record.normalJournalBundles,
    record.lifetimeTargetSelection,
  );
  if (canonicalJson(supplied) !== canonicalJson(rebuilt)) {
    fail("recovery target differs from verified artifacts");
  }
  const pendingActorKind =
    existingAssociation === undefined
      ? undefined
      : targetPendingActorKinds.get(record.target);
  const lastReplayAnchorKind =
    existingAssociation === undefined
      ? undefined
      : targetLastReplayAnchorKinds.get(record.target);
  const liveBirthActorStillPermitted =
    existingAssociation === undefined
      ? true
      : sameLifetimeReplay
        ? existingAssociation.liveBirthActorStillPermitted
        : pendingActorKind !== undefined
          ? pendingActorKind === "LIVE_BIRTH_GUARDIAN"
          : lastReplayAnchorKind !== undefined && lastReplayAnchorKind !== null
            ? existingAssociation.liveBirthActorStillPermitted &&
              lastReplayAnchorKind === "LIVE_BIRTH_GUARDIAN"
            : false;
  targetBrands.set(
    rebuilt,
    immutableRecord([
      ["selection", record.lifetimeTargetSelection],
      ["liveBirthActorStillPermitted", liveBirthActorStillPermitted],
    ]),
  );
  if (pendingActorKind !== undefined) {
    targetPendingActorKinds.set(rebuilt, pendingActorKind);
  }
  if (targetRefreshPermitted.has(record.target)) {
    targetRefreshPermitted.add(rebuilt);
  }
  return rebuilt;
}

function inventoryValue(inputRecord) {
  const prefix = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_INVENTORY_OBSERVATION_SCHEMA_V1],
    [
      "generationIdentitySha256",
      exactDigest(
        inputRecord.generationIdentitySha256,
        "inventory generation identity",
        fail,
      ),
    ],
    [
      "stagingPresent",
      exactBool(inputRecord.stagingPresent, "inventory staging"),
    ],
    ["activePresent", exactBool(inputRecord.activePresent, "inventory active")],
    ["closedPresent", exactBool(inputRecord.closedPresent, "inventory closed")],
    [
      "recoveredPresent",
      exactBool(inputRecord.recoveredPresent, "inventory recovered"),
    ],
    [
      "quarantinedPresent",
      exactBool(inputRecord.quarantinedPresent, "inventory quarantined"),
    ],
    [
      "unsafeEntriesPresent",
      exactBool(inputRecord.unsafeEntriesPresent, "inventory unsafe entries"),
    ],
  ]);
  return immutableRecord([
    ["schema", prefix.schema],
    ["generationIdentitySha256", prefix.generationIdentitySha256],
    ["stagingPresent", prefix.stagingPresent],
    ["activePresent", prefix.activePresent],
    ["closedPresent", prefix.closedPresent],
    ["recoveredPresent", prefix.recoveredPresent],
    ["quarantinedPresent", prefix.quarantinedPresent],
    ["unsafeEntriesPresent", prefix.unsafeEntriesPresent],
    ["inventorySha256", semanticDigest(prefix)],
  ]);
}

export function createCandidateContainmentRecoveryInventoryObservationV1(
  input,
) {
  const record = exactRecord(
    input,
    INVENTORY_CREATE_INPUT_FIELDS,
    "recovery inventory input",
    fail,
  );
  const inventory = inventoryValue(record);
  inventoryBrands.set(inventory, true);
  return inventory;
}

export function verifyCandidateContainmentRecoveryInventoryObservationV1(
  input,
) {
  const record = exactRecord(
    input,
    INVENTORY_VERIFY_INPUT_FIELDS,
    "recovery inventory verification input",
    fail,
  );
  const supplied = exactRecord(
    record.observation,
    INVENTORY_FIELDS,
    "recovery inventory observation",
    fail,
  );
  const rebuilt = inventoryValue(supplied);
  const expected = exactDigest(
    record.expectedGenerationIdentitySha256,
    "expected inventory generation identity",
    fail,
  );
  if (
    rebuilt.generationIdentitySha256 !== expected ||
    rebuilt.inventorySha256 !== supplied.inventorySha256 ||
    canonicalJson(rebuilt) !== canonicalJson(supplied)
  ) {
    fail("recovery inventory verification changed");
  }
  inventoryBrands.set(rebuilt, true);
  return rebuilt;
}

const REPLAY_INPUT_FIELDS = deepFreeze([
  "target",
  "entries",
  "expectedStateRootIdentitySha256",
  "expectedExternalHead",
  "currentLifetimeAnchorProjection",
  "currentLifetimeAttemptAnchorRawSha256",
  "currentLifetimeAnchorPredecessorExternalHead",
  "normalCloseDurabilityReceipt",
]);
const REPLAY_FIELDS = deepFreeze([
  "schema",
  "requirementsSha256",
  "status",
  "targetSha256",
  "attemptCount",
  "finalizedAttemptCount",
  "anchoredEmptyAttemptCount",
  "recordCount",
  "latestRecoveryActorEpochSha256",
  "latestAttemptDirectoryName",
  "latestRecoveryRecordSequence",
  "latestRecoveryRecordRawSha256",
  "latestAttemptState",
  "latestFinalizedRecoveryState",
  "derivedPriorEffectOutcomeCertain",
  "latestExpectedCurrentBootIdSha256",
  "latestExpectedDelegatedRootIdentitySha256",
  "latestExpectedLifetimeCgroupIdentitySha256",
  "liveBirthActorStillPermitted",
  "commandDescriptorMayRemainHeld",
  "statusDescriptorMayRemainHeld",
  "supervisorPidfdMayRemainHeld",
  "directChildWaitAuthorityMayRemain",
  "nextRequiredState",
  "inheritedTerminalDecision",
  "decisionSourceLocation",
  "internalHashChainValidated",
  "targetBindingsMatched",
  "lifetimeAnchorBindingsMatched",
  "lifecycleInventoryBindingsMatched",
  "recordPlanBindingsMatched",
  "externalTailHeadMatched",
  "tailCompletenessExternallyAnchored",
  "stateRootIdentityAnchorMatched",
  "bootIdentityRelationshipsValidated",
  "delegatedRootIdentityRelationshipsValidated",
  "lifetimeCgroupIdentityAnchorsMatched",
  "tailDeletionExcludedByInternalReplay",
  "suppliedAnchorOriginProven",
  "chainTerminal",
  "authority",
  "nonclaims",
  "physicalFacts",
]);
const EXTERNAL_HEAD_FIELDS = deepFreeze([
  "schema",
  "targetSha256",
  "result",
  "recoveryActorEpochSha256",
  "attemptDirectoryName",
  "lifetimeAttemptAnchorRawSha256",
  "latestRecoveryRecordSequence",
  "latestRecoveryRecordRawSha256",
  "externalHeadSha256",
]);
const LIFETIME_ANCHOR_FIELDS = deepFreeze([
  "schema",
  "targetSha256",
  "actorKind",
  "recoveryActorEpochSha256",
  "attemptDirectoryName",
  "expectedStateRootIdentitySha256",
  "expectedCurrentBootIdSha256",
  "expectedDelegatedRootIdentitySha256",
  "expectedLifetimeCgroupIdentitySha256",
  "previousRecoveryActorEpochSha256",
  "previousAttemptDirectoryName",
  "previousRecoveryRecordSequence",
  "previousRecoveryRecordRawSha256",
]);
const NORMAL_CLOSE_SELECTION_FIELDS = deepFreeze([
  "normalCloseReceiptProjection",
  "normalCloseReceiptRecordRawSha256",
]);
const NORMAL_CLOSE_PROJECTION_FIELDS = deepFreeze([
  "schema",
  "targetSha256",
  "sourceLocation",
  "destinationLocation",
  "activeParentSynced",
  "closedParentSynced",
  "closedLocationReobserved",
]);
const replayBrands = new WeakMap();

function normalizeExternalHead(value, label) {
  const record = exactRecord(value, EXTERNAL_HEAD_FIELDS, label, fail);
  if (
    record.schema !== CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1
  ) {
    fail(`${label} schema changed`);
  }
  exactDigest(record.targetSha256, `${label} target`, fail);
  exactChoice(
    record.result,
    CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_RESULTS_V1,
    `${label} result`,
  );
  exactNullableDigest(record.recoveryActorEpochSha256, `${label} actor`);
  if (
    record.attemptDirectoryName !== null &&
    typeof record.attemptDirectoryName !== "string"
  ) {
    fail(`${label} directory changed`);
  }
  exactNullableDigest(
    record.lifetimeAttemptAnchorRawSha256,
    `${label} lifetime anchor`,
  );
  if (
    record.latestRecoveryRecordSequence !== null &&
    !/^[0-9]{16}$/u.test(record.latestRecoveryRecordSequence)
  ) {
    fail(`${label} sequence changed`);
  }
  exactDigest(record.latestRecoveryRecordRawSha256, `${label} raw head`, fail);
  const prefix = nullRecord([
    ["schema", record.schema],
    ["targetSha256", record.targetSha256],
    ["result", record.result],
    ["recoveryActorEpochSha256", record.recoveryActorEpochSha256],
    ["attemptDirectoryName", record.attemptDirectoryName],
    ["lifetimeAttemptAnchorRawSha256", record.lifetimeAttemptAnchorRawSha256],
    ["latestRecoveryRecordSequence", record.latestRecoveryRecordSequence],
    ["latestRecoveryRecordRawSha256", record.latestRecoveryRecordRawSha256],
  ]);
  if (record.externalHeadSha256 !== semanticDigest(prefix)) {
    fail(`${label} digest changed`);
  }
  exactDigest(record.externalHeadSha256, `${label} digest`, fail);
  if (record.result === "NO_RECOVERY_ATTEMPT") {
    if (
      record.recoveryActorEpochSha256 !== null ||
      record.attemptDirectoryName !== null ||
      record.lifetimeAttemptAnchorRawSha256 !== null ||
      record.latestRecoveryRecordSequence !== null ||
      record.latestRecoveryRecordRawSha256 !==
        CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1
    ) {
      fail(`${label} no-attempt head changed`);
    }
  } else if (record.result === "ANCHORED_EMPTY_ATTEMPT") {
    if (
      record.recoveryActorEpochSha256 === null ||
      record.attemptDirectoryName === null ||
      record.lifetimeAttemptAnchorRawSha256 === null ||
      record.latestRecoveryRecordSequence !== null ||
      record.latestRecoveryRecordRawSha256 !==
        CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1
    ) {
      fail(`${label} anchored-empty head changed`);
    }
  } else if (
    record.recoveryActorEpochSha256 === null ||
    record.attemptDirectoryName === null ||
    record.lifetimeAttemptAnchorRawSha256 === null ||
    record.latestRecoveryRecordSequence === null
  ) {
    fail(`${label} finalized head changed`);
  }
  return immutableRecord([
    ["schema", record.schema],
    ["targetSha256", record.targetSha256],
    ["result", record.result],
    ["recoveryActorEpochSha256", record.recoveryActorEpochSha256],
    ["attemptDirectoryName", record.attemptDirectoryName],
    ["lifetimeAttemptAnchorRawSha256", record.lifetimeAttemptAnchorRawSha256],
    ["latestRecoveryRecordSequence", record.latestRecoveryRecordSequence],
    ["latestRecoveryRecordRawSha256", record.latestRecoveryRecordRawSha256],
    ["externalHeadSha256", record.externalHeadSha256],
  ]);
}

function replayResult(entries) {
  return deepFreeze(nullRecord(entries));
}

function normalStateNumber(target) {
  return target.latestBundleSequence === null
    ? 0
    : Number(target.latestBundleSequence);
}

function normalDescriptorCeilings(target) {
  const state = normalStateNumber(target);
  if (state >= 4 && state <= 12) return deepFreeze([true, true, true, true]);
  if (state >= 13 && state <= 16) return deepFreeze([true, true, true, false]);
  return deepFreeze([false, false, false, false]);
}

function zeroReplayResult(target, expectedExternalHead, currentAnchor) {
  const ceilings = normalDescriptorCeilings(target);
  const targetAssociation = targetBrands.get(target);
  return replayResult([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_SCHEMA_V1],
    [
      "requirementsSha256",
      CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
    ],
    ["status", "NO_RECOVERY_ATTEMPT"],
    ["targetSha256", target.targetSha256],
    ["attemptCount", 0],
    ["finalizedAttemptCount", 0],
    ["anchoredEmptyAttemptCount", 0],
    ["recordCount", 0],
    ["latestRecoveryActorEpochSha256", null],
    ["latestAttemptDirectoryName", null],
    ["latestRecoveryRecordSequence", null],
    [
      "latestRecoveryRecordRawSha256",
      CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1,
    ],
    ["latestAttemptState", null],
    ["latestFinalizedRecoveryState", null],
    ["derivedPriorEffectOutcomeCertain", true],
    [
      "latestExpectedCurrentBootIdSha256",
      currentAnchor === null ? null : currentAnchor.expectedCurrentBootIdSha256,
    ],
    [
      "latestExpectedDelegatedRootIdentitySha256",
      currentAnchor === null
        ? null
        : currentAnchor.expectedDelegatedRootIdentitySha256,
    ],
    [
      "latestExpectedLifetimeCgroupIdentitySha256",
      currentAnchor === null
        ? null
        : currentAnchor.expectedLifetimeCgroupIdentitySha256,
    ],
    [
      "liveBirthActorStillPermitted",
      currentAnchor === null
        ? targetAssociation === undefined
          ? true
          : targetAssociation.liveBirthActorStillPermitted
        : currentAnchor.actorKind === "LIVE_BIRTH_GUARDIAN" &&
          currentAnchor.expectedCurrentBootIdSha256 === target.bootIdSha256,
    ],
    ["commandDescriptorMayRemainHeld", ceilings.at(0)],
    ["statusDescriptorMayRemainHeld", ceilings.at(1)],
    ["supervisorPidfdMayRemainHeld", ceilings.at(2)],
    ["directChildWaitAuthorityMayRemain", ceilings.at(3)],
    ["nextRequiredState", null],
    ["inheritedTerminalDecision", null],
    ["decisionSourceLocation", null],
    ["internalHashChainValidated", true],
    ["targetBindingsMatched", true],
    ["lifetimeAnchorBindingsMatched", currentAnchor === null ? null : true],
    ["lifecycleInventoryBindingsMatched", null],
    ["recordPlanBindingsMatched", null],
    ["externalTailHeadMatched", expectedExternalHead === null ? null : true],
    ["tailCompletenessExternallyAnchored", expectedExternalHead !== null],
    ["stateRootIdentityAnchorMatched", currentAnchor === null ? null : true],
    [
      "bootIdentityRelationshipsValidated",
      currentAnchor === null ? null : true,
    ],
    [
      "delegatedRootIdentityRelationshipsValidated",
      currentAnchor === null ? null : true,
    ],
    [
      "lifetimeCgroupIdentityAnchorsMatched",
      currentAnchor === null ? null : true,
    ],
    ["tailDeletionExcludedByInternalReplay", false],
    ["suppliedAnchorOriginProven", false],
    ["chainTerminal", false],
    ["authority", CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1],
    ["nonclaims", CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1],
    ["physicalFacts", CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1],
  ]);
}

export function replayCandidateContainmentRecoveryV1(input) {
  const record = exactRecord(
    input,
    REPLAY_INPUT_FIELDS,
    "recovery replay input",
    fail,
  );
  const targetAssociation = targetBrands.get(record.target);
  if (!targetAssociation) fail("recovery replay target is not branded");
  const entries = exactDenseArray(
    record.entries,
    "recovery replay entries",
    CANDIDATE_CONTAINMENT_RECOVERY_MAX_ATTEMPTS_V1,
    fail,
  );
  exactDigest(
    record.expectedStateRootIdentitySha256,
    "recovery replay state-root identity",
    fail,
  );
  const currentNull = record.currentLifetimeAnchorProjection === null;
  if (
    currentNull !== (record.currentLifetimeAttemptAnchorRawSha256 === null) ||
    currentNull !==
      (record.currentLifetimeAnchorPredecessorExternalHead === null)
  ) {
    fail("recovery replay current anchor triple is partial");
  }
  let normalCloseDurabilityReceipt = null;
  if (record.normalCloseDurabilityReceipt !== null) {
    if (!currentNull)
      fail("recovery replay close receipt conflicts with anchor");
    const selection = exactRecord(
      record.normalCloseDurabilityReceipt,
      NORMAL_CLOSE_SELECTION_FIELDS,
      "recovery replay normal-close selection",
      fail,
    );
    const projection = exactRecord(
      selection.normalCloseReceiptProjection,
      NORMAL_CLOSE_PROJECTION_FIELDS,
      "recovery replay normal-close projection",
      fail,
    );
    if (
      projection.schema !==
        CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1 ||
      projection.targetSha256 !== record.target.targetSha256 ||
      projection.sourceLocation !== "active" ||
      projection.destinationLocation !== "closed" ||
      projection.activeParentSynced !== true ||
      projection.closedParentSynced !== true ||
      projection.closedLocationReobserved !== true
    ) {
      fail("recovery replay normal-close projection changed");
    }
    exactDigest(
      selection.normalCloseReceiptRecordRawSha256,
      "recovery replay normal-close record hash",
      fail,
    );
    assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1({
      normalCloseDurabilityReceipt: record.normalCloseDurabilityReceipt,
      targetSha256: record.target.targetSha256,
    });
    normalCloseDurabilityReceipt = record.normalCloseDurabilityReceipt;
  }
  const summary =
    entries.length === 0
      ? null
      : normalizeReplayEntries(
          entries,
          record.target,
          record.expectedStateRootIdentitySha256,
        );
  let expectedExternalHead = null;
  if (record.expectedExternalHead !== null) {
    expectedExternalHead = normalizeExternalHead(
      record.expectedExternalHead,
      "recovery replay expected external head",
    );
    if (expectedExternalHead.targetSha256 !== record.target.targetSha256) {
      fail("recovery replay external-head target changed");
    }
    assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1({
      externalHead: record.expectedExternalHead,
      targetSha256: record.target.targetSha256,
    });
  }
  let currentAnchor = null;
  let currentCarrier = null;
  let currentEntryIncluded = false;
  if (!currentNull) {
    currentAnchor = exactRecord(
      record.currentLifetimeAnchorProjection,
      LIFETIME_ANCHOR_FIELDS,
      "recovery replay current lifetime anchor",
      fail,
    );
    if (
      currentAnchor.schema !==
        CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1 ||
      currentAnchor.targetSha256 !== record.target.targetSha256
    ) {
      fail("recovery replay current lifetime anchor target changed");
    }
    exactDigest(
      record.currentLifetimeAttemptAnchorRawSha256,
      "recovery replay current lifetime anchor raw hash",
      fail,
    );
    assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1({
      lifetimeAnchorProjection: record.currentLifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        record.currentLifetimeAttemptAnchorRawSha256,
      targetSha256: record.target.targetSha256,
      recoveryActorEpochSha256: currentAnchor.recoveryActorEpochSha256,
    });
    const predecessor = normalizeExternalHead(
      record.currentLifetimeAnchorPredecessorExternalHead,
      "recovery replay current anchor predecessor",
    );
    if (
      predecessor.targetSha256 !== record.target.targetSha256 ||
      currentAnchor.previousRecoveryActorEpochSha256 !==
        predecessor.recoveryActorEpochSha256 ||
      currentAnchor.previousAttemptDirectoryName !==
        predecessor.attemptDirectoryName ||
      currentAnchor.previousRecoveryRecordSequence !==
        predecessor.latestRecoveryRecordSequence ||
      currentAnchor.previousRecoveryRecordRawSha256 !==
        predecessor.latestRecoveryRecordRawSha256
    ) {
      fail("recovery replay current anchor predecessor changed");
    }
    if (
      record.expectedExternalHead !== null &&
      record.expectedExternalHead !==
        record.currentLifetimeAnchorPredecessorExternalHead
    ) {
      fail("recovery replay current anchor head identity changed");
    }
    currentCarrier = immutableRecord([
      ["lifetimeAnchorProjection", record.currentLifetimeAnchorProjection],
      [
        "lifetimeAttemptAnchorRawSha256",
        record.currentLifetimeAttemptAnchorRawSha256,
      ],
    ]);
    if (
      summary !== null &&
      summary.latestRecoveryActorEpochSha256 ===
        currentAnchor.recoveryActorEpochSha256
    ) {
      currentEntryIncluded = true;
      if (
        summary.latestAnchorRawSha256 !==
          record.currentLifetimeAttemptAnchorRawSha256 ||
        canonicalJson(summary.latestAnchor) !== canonicalJson(currentAnchor)
      ) {
        fail("recovery replay current anchor is not the latest entry anchor");
      }
    }
  }
  if (summary === null) {
    if (
      expectedExternalHead !== null &&
      expectedExternalHead.result !== "NO_RECOVERY_ATTEMPT"
    ) {
      fail("recovery replay zero-entry external head changed");
    }
  } else if (expectedExternalHead !== null) {
    const derivedResult =
      summary.latestAttemptState === "RECOVERED_LOCATION_OBSERVED"
        ? "RECOVERED"
        : summary.latestAttemptState === "QUARANTINED_LOCATION_OBSERVED"
          ? "QUARANTINED"
          : summary.latestAttemptState === null
            ? "ANCHORED_EMPTY_ATTEMPT"
            : "FINALIZED_ATTEMPT_PREFIX";
    if (
      expectedExternalHead.result !== derivedResult ||
      expectedExternalHead.recoveryActorEpochSha256 !==
        summary.latestRecoveryActorEpochSha256 ||
      expectedExternalHead.attemptDirectoryName !==
        summary.latestAttemptDirectoryName ||
      expectedExternalHead.lifetimeAttemptAnchorRawSha256 !==
        summary.latestAnchorRawSha256 ||
      expectedExternalHead.latestRecoveryRecordSequence !==
        summary.latestRecoveryRecordSequence ||
      expectedExternalHead.latestRecoveryRecordRawSha256 !==
        summary.latestRecoveryRecordRawSha256
    ) {
      fail("recovery replay external-head value changed");
    }
  }
  const historicalCarriers =
    summary === null
      ? deepFreeze([])
      : currentNull || !currentEntryIncluded
        ? summary.carriers
        : deepFreeze(summary.carriers.slice(0, -1));
  const boundaryExternalHead = currentNull
    ? record.expectedExternalHead
    : record.currentLifetimeAnchorPredecessorExternalHead;
  const emptyStructuralBoundary =
    summary === null &&
    currentNull &&
    record.expectedExternalHead === null &&
    normalCloseDurabilityReceipt === null;
  if (
    !emptyStructuralBoundary &&
    (summary === null || summary.implicitCarrierCount === 0 || currentNull)
  ) {
    assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetAssociation.selection,
      historicalLifetimeAnchorSelections: historicalCarriers,
      currentLifetimeAnchorSelection: currentCarrier,
      externalHead: boundaryExternalHead,
      normalCloseDurabilityReceipt,
    });
  }
  const result =
    summary === null
      ? zeroReplayResult(record.target, expectedExternalHead, currentAnchor)
      : replaySummaryResult(
          record.target,
          summary,
          expectedExternalHead,
          !currentNull,
        );
  replayBrands.set(
    result,
    immutableRecord([
      ["target", record.target],
      ["targetSelection", targetAssociation.selection],
      ["entries", entries],
      ["summary", summary],
      [
        "expectedStateRootIdentitySha256",
        record.expectedStateRootIdentitySha256,
      ],
      ["expectedExternalHead", record.expectedExternalHead],
      [
        "currentLifetimeAnchorProjection",
        record.currentLifetimeAnchorProjection,
      ],
      [
        "currentLifetimeAttemptAnchorRawSha256",
        record.currentLifetimeAttemptAnchorRawSha256,
      ],
      [
        "currentLifetimeAnchorPredecessorExternalHead",
        record.currentLifetimeAnchorPredecessorExternalHead,
      ],
      ["currentAnchor", currentAnchor],
      ["normalCloseDurabilityReceipt", normalCloseDurabilityReceipt],
    ]),
  );
  targetRefreshPermitted.add(record.target);
  targetLastReplayAnchorKinds.set(
    record.target,
    currentAnchor === null ? null : currentAnchor.actorKind,
  );
  if (currentAnchor !== null) targetPendingActorKinds.delete(record.target);
  return result;
}

const PLAN_INPUT_FIELDS = deepFreeze([
  "target",
  "lifecycleInventoryObservation",
  "previousRecoveryReplay",
  "normalCloseDurabilityReceipt",
  "expectedStateRootIdentitySha256",
  "expectedCurrentBootIdSha256",
  "expectedDelegatedRootIdentitySha256",
  "expectedLifetimeCgroupIdentitySha256",
  "proposedActorKind",
  "reportedCurrentBootIdSha256",
  "reportedStateRootIdentitySha256",
  "reportedDelegatedRootIdentitySha256",
  "reportedLifetimeCgroupIdentitySha256",
  "reportedCommandDescriptorHeld",
  "reportedStatusDescriptorHeld",
  "reportedSupervisorPidfdHeld",
  "reportedDirectChildWaitAuthority",
  "reportedCgroupInventorySafe",
  "reportedControlCgroupPresent",
  "reportedJobCgroupPresent",
  "reportedStateFilesystemInterfaceAvailable",
  "reportedRecoveryInterfaceAvailable",
  "currentLifetimeAnchorProjection",
  "currentLifetimeAttemptAnchorRawSha256",
]);
const PLAN_FIELDS = deepFreeze([
  "schema",
  "requirementsSha256",
  "status",
  "targetSha256",
  "requiredActorKind",
  "normalTailExternallyAnchored",
  "recoveryTailExternallyAnchored",
  "currentLifetimeAnchorMatched",
  "disposition",
  "quarantineReason",
  "sourceLocation",
  "decisionSourceLocation",
  "requiredDestinationLocation",
  "lifecycleInventorySha256",
  "recoveryContext",
  "inheritedTerminalDecision",
  "latestAttemptState",
  "latestFinalizedRecoveryState",
  "nextPermittedRecordTypes",
  "terminal",
  "states",
  "recordCount",
  "authority",
  "nonclaims",
  "physicalFacts",
]);
const RECOVERY_CONTEXT_FIELDS = deepFreeze([
  "actorKind",
  "reportedCurrentBootIdSha256",
  "reportedStateRootIdentitySha256",
  "reportedDelegatedRootIdentitySha256",
  "reportedLifetimeCgroupIdentitySha256",
  "reportedCommandDescriptorHeld",
  "reportedStatusDescriptorHeld",
  "reportedSupervisorPidfdHeld",
  "reportedDirectChildWaitAuthority",
  "reportedCgroupInventorySafe",
  "reportedControlCgroupPresent",
  "reportedJobCgroupPresent",
  "reportedStateFilesystemInterfaceAvailable",
  "reportedRecoveryInterfaceAvailable",
  "derivedPriorEffectOutcomeCertain",
]);
const GENESIS_STATES = deepFreeze([
  "RECOVERY_ATTEMPT_DURABLE",
  "GENESIS_ABORT_RECOVERY_REQUIRED",
  "CGROUP_PATHS_ABSENT_OBSERVED",
  "RECOVERED_TOMBSTONE_DURABLE",
  "RECOVERED_LOCATION_OBSERVED",
]);
const REBOOT_STATES = deepFreeze([
  "RECOVERY_ATTEMPT_DURABLE",
  "REBOOT_INTERRUPTION_OBSERVED",
  "CGROUP_PATHS_ABSENT_OBSERVED",
  "RECOVERED_TOMBSTONE_DURABLE",
  "RECOVERED_LOCATION_OBSERVED",
]);
const QUARANTINE_STATES = deepFreeze([
  "RECOVERY_ATTEMPT_DURABLE",
  "QUARANTINE_INTENT_DURABLE",
  "QUARANTINED_LOCATION_OBSERVED",
]);
const RECOVERED_RESUME_STATES = deepFreeze([
  "RECOVERY_ATTEMPT_DURABLE",
  "RECOVERED_TOMBSTONE_ADOPTED",
  "RECOVERED_LOCATION_OBSERVED",
]);
const QUARANTINE_RESUME_STATES = deepFreeze([
  "RECOVERY_ATTEMPT_DURABLE",
  "QUARANTINE_INTENT_ADOPTED",
  "QUARANTINED_LOCATION_OBSERVED",
]);
const planBrands = new WeakMap();

function inventorySource(inventory) {
  let count = 0;
  let source = null;
  if (inventory.stagingPresent) {
    count += 1;
    source = "staging";
  }
  if (inventory.activePresent) {
    count += 1;
    source = "active";
  }
  if (inventory.closedPresent) {
    count += 1;
    source = "closed";
  }
  if (inventory.recoveredPresent) {
    count += 1;
    source = "recovered";
  }
  if (inventory.quarantinedPresent) {
    count += 1;
    source = "quarantined";
  }
  return immutableRecord([
    ["count", count],
    ["source", source],
  ]);
}

function recoveryContext(actorKind, inputRecord, replay) {
  return immutableRecord([
    ["actorKind", actorKind],
    ["reportedCurrentBootIdSha256", inputRecord.reportedCurrentBootIdSha256],
    [
      "reportedStateRootIdentitySha256",
      inputRecord.reportedStateRootIdentitySha256,
    ],
    [
      "reportedDelegatedRootIdentitySha256",
      inputRecord.reportedDelegatedRootIdentitySha256,
    ],
    [
      "reportedLifetimeCgroupIdentitySha256",
      inputRecord.reportedLifetimeCgroupIdentitySha256,
    ],
    [
      "reportedCommandDescriptorHeld",
      inputRecord.reportedCommandDescriptorHeld,
    ],
    ["reportedStatusDescriptorHeld", inputRecord.reportedStatusDescriptorHeld],
    ["reportedSupervisorPidfdHeld", inputRecord.reportedSupervisorPidfdHeld],
    [
      "reportedDirectChildWaitAuthority",
      inputRecord.reportedDirectChildWaitAuthority,
    ],
    ["reportedCgroupInventorySafe", inputRecord.reportedCgroupInventorySafe],
    ["reportedControlCgroupPresent", inputRecord.reportedControlCgroupPresent],
    ["reportedJobCgroupPresent", inputRecord.reportedJobCgroupPresent],
    [
      "reportedStateFilesystemInterfaceAvailable",
      inputRecord.reportedStateFilesystemInterfaceAvailable,
    ],
    [
      "reportedRecoveryInterfaceAvailable",
      inputRecord.reportedRecoveryInterfaceAvailable,
    ],
    [
      "derivedPriorEffectOutcomeCertain",
      replay.derivedPriorEffectOutcomeCertain,
    ],
  ]);
}

function planResult(fields) {
  return immutableRecord([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_PLAN_SCHEMA_V1],
    [
      "requirementsSha256",
      CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
    ],
    ["status", fields.status],
    ["targetSha256", fields.targetSha256],
    ["requiredActorKind", fields.requiredActorKind],
    ["normalTailExternallyAnchored", fields.normalTailExternallyAnchored],
    ["recoveryTailExternallyAnchored", fields.recoveryTailExternallyAnchored],
    ["currentLifetimeAnchorMatched", fields.currentLifetimeAnchorMatched],
    ["disposition", fields.disposition],
    ["quarantineReason", fields.quarantineReason],
    ["sourceLocation", fields.sourceLocation],
    ["decisionSourceLocation", fields.decisionSourceLocation],
    ["requiredDestinationLocation", fields.requiredDestinationLocation],
    ["lifecycleInventorySha256", fields.lifecycleInventorySha256],
    ["recoveryContext", fields.recoveryContext],
    ["inheritedTerminalDecision", fields.inheritedTerminalDecision],
    ["latestAttemptState", fields.latestAttemptState],
    ["latestFinalizedRecoveryState", fields.latestFinalizedRecoveryState],
    ["nextPermittedRecordTypes", fields.nextPermittedRecordTypes],
    ["terminal", fields.terminal],
    ["states", fields.states],
    ["recordCount", fields.recordCount],
    ["authority", CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1],
    ["nonclaims", CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1],
    ["physicalFacts", CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1],
  ]);
}

function basePlanFields(target, inventory, replay, status) {
  return nullRecord([
    ["status", status],
    ["targetSha256", target.targetSha256],
    ["requiredActorKind", null],
    ["normalTailExternallyAnchored", true],
    ["recoveryTailExternallyAnchored", replay.externalTailHeadMatched === true],
    ["currentLifetimeAnchorMatched", false],
    ["disposition", null],
    ["quarantineReason", null],
    ["sourceLocation", null],
    ["decisionSourceLocation", replay.decisionSourceLocation],
    ["requiredDestinationLocation", null],
    ["lifecycleInventorySha256", inventory.inventorySha256],
    ["recoveryContext", null],
    ["inheritedTerminalDecision", replay.inheritedTerminalDecision],
    ["latestAttemptState", replay.latestAttemptState],
    ["latestFinalizedRecoveryState", replay.latestFinalizedRecoveryState],
    ["nextPermittedRecordTypes", deepFreeze([])],
    ["terminal", false],
    ["states", deepFreeze([])],
    ["recordCount", 0],
  ]);
}

function exactPlanBooleans(record) {
  exactBool(
    record.reportedCommandDescriptorHeld,
    "reported command descriptor",
  );
  exactBool(record.reportedStatusDescriptorHeld, "reported status descriptor");
  exactBool(record.reportedSupervisorPidfdHeld, "reported pidfd");
  exactBool(record.reportedDirectChildWaitAuthority, "reported wait authority");
  exactBool(record.reportedCgroupInventorySafe, "reported cgroup safety");
  const nullCgroupInventory =
    record.reportedControlCgroupPresent === null &&
    record.reportedJobCgroupPresent === null;
  if (!nullCgroupInventory) {
    exactBool(record.reportedControlCgroupPresent, "reported control cgroup");
    exactBool(record.reportedJobCgroupPresent, "reported job cgroup");
  }
  if (nullCgroupInventory && record.reportedCgroupInventorySafe) {
    fail("safe cgroup inventory requires exact presence booleans");
  }
  exactBool(
    record.reportedStateFilesystemInterfaceAvailable,
    "reported state filesystem interface",
  );
  exactBool(
    record.reportedRecoveryInterfaceAvailable,
    "reported recovery interface",
  );
}

function readyDisposition(target, source, record, replay) {
  if (replay.inheritedTerminalDecision === "RECOVERED") {
    if (
      (source !== replay.decisionSourceLocation && source !== "recovered") ||
      record.reportedCurrentBootIdSha256 !==
        record.expectedCurrentBootIdSha256 ||
      record.reportedDelegatedRootIdentitySha256 !==
        record.expectedDelegatedRootIdentitySha256 ||
      !record.reportedCgroupInventorySafe ||
      record.reportedControlCgroupPresent !== false ||
      record.reportedJobCgroupPresent !== false
    ) {
      return null;
    }
    return immutableRecord([
      ["disposition", "RECOVERED_DECISION_RESUME"],
      ["quarantineReason", null],
      ["states", RECOVERED_RESUME_STATES],
      ["destination", "recovered"],
      ["decisionSource", replay.decisionSourceLocation],
    ]);
  }
  if (replay.inheritedTerminalDecision === "QUARANTINED") {
    if (source !== replay.decisionSourceLocation && source !== "quarantined") {
      return null;
    }
    return immutableRecord([
      ["disposition", "QUARANTINE_DECISION_RESUME"],
      ["quarantineReason", null],
      ["states", QUARANTINE_RESUME_STATES],
      ["destination", "quarantined"],
      ["decisionSource", replay.decisionSourceLocation],
    ]);
  }
  if (source !== "staging" && source !== "active") return null;
  const descriptorReappeared =
    replay.attemptCount > 0 &&
    ((record.reportedCommandDescriptorHeld &&
      !replay.commandDescriptorMayRemainHeld) ||
      (record.reportedStatusDescriptorHeld &&
        !replay.statusDescriptorMayRemainHeld) ||
      (record.reportedSupervisorPidfdHeld &&
        !replay.supervisorPidfdMayRemainHeld) ||
      (record.reportedDirectChildWaitAuthority &&
        !replay.directChildWaitAuthorityMayRemain));
  const cgroupPathReappeared =
    [
      "CGROUP_PATHS_ABSENT_OBSERVED",
      "RECOVERED_TOMBSTONE_DURABLE",
      "RECOVERED_TOMBSTONE_ADOPTED",
      "RECOVERED_LOCATION_OBSERVED",
    ].includes(replay.latestAttemptState) &&
    (record.reportedControlCgroupPresent || record.reportedJobCgroupPresent);
  let reason = null;
  if (
    record.reportedCurrentBootIdSha256 === null ||
    record.reportedCurrentBootIdSha256 !== record.expectedCurrentBootIdSha256
  ) {
    reason = "UNKNOWN_BOOT_ID";
  } else if (
    record.reportedDelegatedRootIdentitySha256 === null ||
    record.reportedDelegatedRootIdentitySha256 !==
      record.expectedDelegatedRootIdentitySha256
  ) {
    reason = "DELEGATED_ROOT_IDENTITY_UNKNOWN_OR_DRIFTED";
  } else if (!record.reportedCgroupInventorySafe) {
    reason = "UNSAFE_CGROUP_INVENTORY";
  } else if (
    descriptorReappeared ||
    cgroupPathReappeared ||
    (record.expectedCurrentBootIdSha256 === target.bootIdSha256 &&
      !normalFactsAdmissible(
        target,
        record,
        !replay.liveBirthActorStillPermitted,
      )) ||
    (record.expectedCurrentBootIdSha256 !== target.bootIdSha256 &&
      (record.reportedCommandDescriptorHeld ||
        record.reportedStatusDescriptorHeld ||
        record.reportedSupervisorPidfdHeld ||
        record.reportedDirectChildWaitAuthority ||
        record.reportedControlCgroupPresent ||
        record.reportedJobCgroupPresent))
  ) {
    reason = "INCONSISTENT_GENERATION_STATE";
  } else if (!record.reportedRecoveryInterfaceAvailable) {
    reason = "UNSUPPORTED_RECOVERY_INTERFACE";
  } else if (!replay.derivedPriorEffectOutcomeCertain) {
    reason = "RECOVERY_EFFECT_UNCERTAIN";
  }
  if (reason !== null) {
    return immutableRecord([
      ["disposition", "QUARANTINE"],
      ["quarantineReason", reason],
      ["states", QUARANTINE_STATES],
      ["destination", "quarantined"],
      ["decisionSource", source],
    ]);
  }
  if (normalStateNumber(target) > 0 && source !== "active") {
    return immutableRecord([
      ["disposition", "QUARANTINE"],
      ["quarantineReason", "INCONSISTENT_GENERATION_STATE"],
      ["states", QUARANTINE_STATES],
      ["destination", "quarantined"],
      ["decisionSource", source],
    ]);
  }
  if (record.expectedCurrentBootIdSha256 !== target.bootIdSha256) {
    return immutableRecord([
      ["disposition", "REBOOT_INTERRUPTION"],
      ["quarantineReason", null],
      ["states", REBOOT_STATES],
      ["destination", "recovered"],
      ["decisionSource", source],
    ]);
  }
  return immutableRecord([
    [
      "disposition",
      target.latestNormalState === null
        ? "GENESIS_ABORT"
        : "SAME_BOOT_RECONCILE",
    ],
    ["quarantineReason", null],
    [
      "states",
      target.latestNormalState === null
        ? GENESIS_STATES
        : sameBootStates(target, record),
    ],
    ["destination", "recovered"],
    ["decisionSource", source],
  ]);
}

function normalFactsAdmissible(target, record, recoveryOnly) {
  const state = normalStateNumber(target);
  const command = record.reportedCommandDescriptorHeld;
  const status = record.reportedStatusDescriptorHeld;
  const pidfd = record.reportedSupervisorPidfdHeld;
  const wait = record.reportedDirectChildWaitAuthority;
  const control = record.reportedControlCgroupPresent;
  const job = record.reportedJobCgroupPresent;
  let descriptorValid = false;
  if (recoveryOnly || state <= 3 || state >= 17) {
    descriptorValid = !command && !status && !pidfd && !wait;
  } else if (state === 4) {
    descriptorValid = pidfd === wait;
  } else if (state <= 12) {
    descriptorValid = pidfd && wait;
  } else {
    descriptorValid = !wait;
  }
  let cgroupValid = false;
  if (state <= 1 || state >= 16) {
    cgroupValid = !control && !job;
  } else if (state === 2 || state === 15) {
    cgroupValid = true;
  } else {
    cgroupValid = control && job;
  }
  return descriptorValid && cgroupValid;
}

function sameBootStates(target, record) {
  const states = ["RECOVERY_ATTEMPT_DURABLE"];
  const state = normalStateNumber(target);
  const reapProven = state >= 13;
  if (record.reportedCommandDescriptorHeld) {
    states.push(
      "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
      "COMMAND_DESCRIPTOR_CLOSED_OBSERVED",
    );
  }
  if (record.reportedControlCgroupPresent) {
    states.push("CONTROL_KILL_INTENT_DURABLE", "CONTROL_KILL_WRITE_COMPLETED");
  } else {
    states.push("CONTROL_PATH_ABSENT_OBSERVED");
  }
  if (record.reportedJobCgroupPresent) {
    states.push(
      "JOB_FIRST_KILL_INTENT_DURABLE",
      "JOB_FIRST_KILL_WRITE_COMPLETED",
    );
  } else {
    states.push("JOB_PATH_ABSENT_OBSERVED");
  }
  if (record.reportedControlCgroupPresent) {
    states.push("CONTROL_QUIESCENT_OBSERVED");
  }
  if (record.reportedJobCgroupPresent) {
    states.push(
      "JOB_SECOND_KILL_INTENT_DURABLE",
      "JOB_SECOND_KILL_WRITE_COMPLETED",
      "JOB_QUIESCENT_OBSERVED",
    );
  }
  if (record.reportedStatusDescriptorHeld) states.push("STATUS_EOF_OBSERVED");
  if (record.reportedSupervisorPidfdHeld) {
    states.push(
      reapProven
        ? "SUPERVISOR_PIDFD_HUP_OBSERVED"
        : "SUPERVISOR_PIDFD_READABLE_OBSERVED",
    );
  }
  if (!reapProven && record.reportedDirectChildWaitAuthority) {
    states.push("SUPERVISOR_REAP_INTENT_DURABLE", "SUPERVISOR_REAPED_OBSERVED");
  }
  if (record.reportedControlCgroupPresent || record.reportedJobCgroupPresent) {
    states.push("CGROUP_REMOVAL_INTENT_DURABLE");
  }
  states.push(
    "CGROUP_PATHS_ABSENT_OBSERVED",
    "RECOVERED_TOMBSTONE_DURABLE",
    "RECOVERED_LOCATION_OBSERVED",
  );
  return deepFreeze(states);
}

export function planCandidateContainmentRecoveryV1(input) {
  const record = exactRecord(
    input,
    PLAN_INPUT_FIELDS,
    "recovery plan input",
    fail,
  );
  const targetAssociation = targetBrands.get(record.target);
  const inventoryAssociation = inventoryBrands.get(
    record.lifecycleInventoryObservation,
  );
  const replayAssociation = replayBrands.get(record.previousRecoveryReplay);
  if (!targetAssociation || !inventoryAssociation || !replayAssociation) {
    fail("recovery plan input is not branded");
  }
  if (replayAssociation.target !== record.target) {
    fail("recovery plan target and replay origin changed");
  }
  if (record.previousRecoveryReplay.externalTailHeadMatched !== true) {
    fail("recovery plan tail is not externally anchored");
  }
  if (
    record.lifecycleInventoryObservation.generationIdentitySha256 !==
    record.target.generationIdentitySha256
  ) {
    fail("recovery plan inventory target changed");
  }
  exactPlanBooleans(record);
  for (const value of [
    record.expectedStateRootIdentitySha256,
    record.expectedCurrentBootIdSha256,
    record.expectedDelegatedRootIdentitySha256,
    record.expectedLifetimeCgroupIdentitySha256,
    record.reportedStateRootIdentitySha256,
  ]) {
    exactDigest(value, "recovery plan identity", fail);
  }
  exactNullableDigest(record.reportedCurrentBootIdSha256, "reported boot");
  exactNullableDigest(
    record.reportedDelegatedRootIdentitySha256,
    "reported delegated root",
  );
  exactNullableDigest(
    record.reportedLifetimeCgroupIdentitySha256,
    "reported lifetime cgroup",
  );
  if (
    record.normalCloseDurabilityReceipt !==
    replayAssociation.normalCloseDurabilityReceipt
  ) {
    fail("recovery plan close receipt origin changed");
  }
  const sourceResult = inventorySource(record.lifecycleInventoryObservation);
  const base = basePlanFields(
    record.target,
    record.lifecycleInventoryObservation,
    record.previousRecoveryReplay,
    "INCONSISTENT_GENERATION_STATE_BLOCKED",
  );
  const hasCurrentAnchor = replayAssociation.currentAnchor !== null;
  if (
    hasCurrentAnchor !== (record.currentLifetimeAnchorProjection !== null) ||
    hasCurrentAnchor !== (record.currentLifetimeAttemptAnchorRawSha256 !== null)
  ) {
    fail("recovery plan current anchor phase changed");
  }
  if (
    hasCurrentAnchor &&
    (record.currentLifetimeAnchorProjection !==
      replayAssociation.currentLifetimeAnchorProjection ||
      record.currentLifetimeAttemptAnchorRawSha256 !==
        replayAssociation.currentLifetimeAttemptAnchorRawSha256)
  ) {
    fail("recovery plan current anchor origin changed");
  }
  base.currentLifetimeAnchorMatched = hasCurrentAnchor;
  if (
    record.lifecycleInventoryObservation.unsafeEntriesPresent ||
    sourceResult.count !== 1
  ) {
    base.status = "UNSAFE_FILESYSTEM_INVENTORY_BLOCKED";
    const blocked = planResult(base);
    planBrands.set(blocked, immutableRecord([["ready", false]]));
    return blocked;
  }
  if (
    record.reportedStateRootIdentitySha256 !==
      record.expectedStateRootIdentitySha256 ||
    record.expectedStateRootIdentitySha256 !==
      replayAssociation.expectedStateRootIdentitySha256
  ) {
    base.status = "STATE_ROOT_IDENTITY_REJECTED";
    const blocked = planResult(base);
    planBrands.set(blocked, immutableRecord([["ready", false]]));
    return blocked;
  }
  if (
    record.reportedLifetimeCgroupIdentitySha256 !==
    record.expectedLifetimeCgroupIdentitySha256
  ) {
    base.status = "RECOVERY_LIFETIME_IDENTITY_REJECTED";
    const blocked = planResult(base);
    planBrands.set(blocked, immutableRecord([["ready", false]]));
    return blocked;
  }
  if (!record.reportedStateFilesystemInterfaceAvailable) {
    base.status = "STATE_FILESYSTEM_INTERFACE_REJECTED";
    base.currentLifetimeAnchorMatched = hasCurrentAnchor;
    const blocked = planResult(base);
    planBrands.set(blocked, immutableRecord([["ready", false]]));
    return blocked;
  }
  if (normalStateNumber(record.target) === 18) {
    if (
      record.proposedActorKind !== null ||
      record.currentLifetimeAnchorProjection !== null ||
      record.currentLifetimeAttemptAnchorRawSha256 !== null
    ) {
      fail("normal state eighteen cannot create a recovery actor");
    }
    if (
      replayAssociation.normalCloseDurabilityReceipt !== null &&
      sourceResult.source === "closed"
    ) {
      base.currentLifetimeAnchorMatched = null;
      base.status = "CLOSED_LOCATION_OBSERVED";
      base.sourceLocation = "closed";
      base.requiredDestinationLocation = "closed";
      base.terminal = true;
    } else if (
      replayAssociation.normalCloseDurabilityReceipt === null &&
      (sourceResult.source === "active" || sourceResult.source === "closed")
    ) {
      base.currentLifetimeAnchorMatched = null;
      base.status = "CLOSE_MOVE_REQUIRED";
      base.sourceLocation = sourceResult.source;
      base.requiredDestinationLocation = "closed";
    }
    const closePlan = planResult(base);
    planBrands.set(closePlan, immutableRecord([["ready", false]]));
    return closePlan;
  }
  if (record.previousRecoveryReplay.chainTerminal) {
    if (
      record.proposedActorKind !== null ||
      record.currentLifetimeAnchorProjection !== null ||
      record.currentLifetimeAttemptAnchorRawSha256 !== null
    ) {
      fail("terminal recovery cannot create another actor");
    }
    const terminalLocation =
      record.previousRecoveryReplay.inheritedTerminalDecision === "RECOVERED"
        ? "recovered"
        : record.previousRecoveryReplay.inheritedTerminalDecision ===
            "QUARANTINED"
          ? "quarantined"
          : null;
    if (terminalLocation !== null && sourceResult.source === terminalLocation) {
      base.status = "RECOVERY_TERMINAL";
      base.currentLifetimeAnchorMatched = null;
      base.sourceLocation = terminalLocation;
      base.requiredDestinationLocation = terminalLocation;
      base.terminal = true;
    }
    const terminalPlan = planResult(base);
    planBrands.set(terminalPlan, immutableRecord([["ready", false]]));
    return terminalPlan;
  }
  if (
    record.previousRecoveryReplay.attemptCount >=
    CANDIDATE_CONTAINMENT_RECOVERY_MAX_ATTEMPTS_V1
  ) {
    if (
      record.proposedActorKind !== null ||
      record.currentLifetimeAnchorProjection !== null ||
      record.currentLifetimeAttemptAnchorRawSha256 !== null
    ) {
      fail("attempt-limited recovery cannot create another actor");
    }
    base.status = "RECOVERY_ATTEMPT_LIMIT_REACHED";
    const limitedPlan = planResult(base);
    planBrands.set(limitedPlan, immutableRecord([["ready", false]]));
    return limitedPlan;
  }
  const selected = readyDisposition(
    record.target,
    sourceResult.source,
    record,
    record.previousRecoveryReplay,
  );
  if (selected === null) {
    const inheritedDestination =
      record.previousRecoveryReplay.inheritedTerminalDecision === "RECOVERED"
        ? "recovered"
        : record.previousRecoveryReplay.inheritedTerminalDecision ===
            "QUARANTINED"
          ? "quarantined"
          : null;
    if (
      !hasCurrentAnchor &&
      inheritedDestination !== null &&
      sourceResult.source !==
        record.previousRecoveryReplay.decisionSourceLocation &&
      sourceResult.source !== inheritedDestination
    ) {
      base.decisionSourceLocation = null;
      base.inheritedTerminalDecision = null;
      base.latestAttemptState = null;
      base.latestFinalizedRecoveryState = null;
    }
    const inconsistentPlan = planResult(base);
    planBrands.set(inconsistentPlan, immutableRecord([["ready", false]]));
    return inconsistentPlan;
  }
  const requiredActorKind = hasCurrentAnchor
    ? replayAssociation.currentAnchor.actorKind
    : record.expectedCurrentBootIdSha256 === record.target.bootIdSha256 &&
        record.previousRecoveryReplay.liveBirthActorStillPermitted
      ? "LIVE_BIRTH_GUARDIAN"
      : "RECOVERY_ONLY_GUARDIAN";
  if (!hasCurrentAnchor) {
    if (
      record.proposedActorKind !== requiredActorKind ||
      !CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1.includes(
        record.proposedActorKind,
      )
    ) {
      fail("recovery plan phase-one actor changed");
    }
    base.status = "RECOVERY_ANCHOR_REQUIRED";
    base.requiredActorKind = requiredActorKind;
    const anchorRequired = planResult(base);
    planBrands.set(anchorRequired, immutableRecord([["ready", false]]));
    targetPendingActorKinds.set(record.target, requiredActorKind);
    return anchorRequired;
  }
  if (record.proposedActorKind !== null) {
    fail("recovery plan phase-two actor must be null");
  }
  const anchor = replayAssociation.currentAnchor;
  if (
    anchor.actorKind !== requiredActorKind ||
    anchor.expectedStateRootIdentitySha256 !==
      record.expectedStateRootIdentitySha256 ||
    anchor.expectedCurrentBootIdSha256 !== record.expectedCurrentBootIdSha256 ||
    anchor.expectedDelegatedRootIdentitySha256 !==
      record.expectedDelegatedRootIdentitySha256 ||
    anchor.expectedLifetimeCgroupIdentitySha256 !==
      record.expectedLifetimeCgroupIdentitySha256
  ) {
    fail("recovery plan phase-two anchor context changed");
  }
  base.status = "RECOVERY_PLAN_READY";
  base.requiredActorKind = requiredActorKind;
  base.currentLifetimeAnchorMatched = true;
  base.disposition = selected.disposition;
  base.quarantineReason = selected.quarantineReason;
  base.sourceLocation = sourceResult.source;
  base.decisionSourceLocation = selected.decisionSource;
  base.requiredDestinationLocation = selected.destination;
  base.recoveryContext = recoveryContext(
    requiredActorKind,
    record,
    record.previousRecoveryReplay,
  );
  base.nextPermittedRecordTypes = deepFreeze(["RECOVERY_ATTEMPT_DURABLE"]);
  base.states = selected.states;
  base.recordCount = selected.states.length;
  const plan = planResult(base);
  planBrands.set(
    plan,
    immutableRecord([
      ["ready", true],
      ["target", record.target],
      ["inventory", record.lifecycleInventoryObservation],
      ["replay", record.previousRecoveryReplay],
      ["anchor", anchor],
      ["lifetimeAnchorProjection", record.currentLifetimeAnchorProjection],
      [
        "lifetimeAttemptAnchorRawSha256",
        record.currentLifetimeAttemptAnchorRawSha256,
      ],
    ]),
  );
  return plan;
}

const ATTEMPT_INPUT_FIELDS = deepFreeze([
  "target",
  "lifecycleInventoryObservation",
  "previousRecoveryReplay",
  "plan",
  "lifetimeAnchorProjection",
  "lifetimeAttemptAnchorRawSha256",
]);
const ATTEMPT_VERIFY_INPUT_FIELDS = deepFreeze([
  "attempt",
  "target",
  "lifecycleInventoryObservation",
  "previousRecoveryReplay",
  "plan",
  "lifetimeAnchorProjection",
  "lifetimeAttemptAnchorRawSha256",
]);
const ATTEMPT_FIELDS = deepFreeze([
  "schema",
  "targetSha256",
  "actorKind",
  "recoveryActorEpochSha256",
  "attemptDirectoryName",
  "lifetimeAttemptAnchorRawSha256",
  "previousRecoveryActorEpochSha256",
  "previousAttemptDirectoryName",
  "previousRecoveryRecordSequence",
  "previousRecoveryRecordRawSha256",
  "reportedCurrentBootIdSha256",
  "reportedStateRootIdentitySha256",
  "reportedDelegatedRootIdentitySha256",
  "reportedLifetimeCgroupIdentitySha256",
  "disposition",
  "reportedSourceLocation",
  "decisionSourceLocation",
  "reportedLifecycleInventorySha256",
  "reportedCommandDescriptorHeld",
  "reportedStatusDescriptorHeld",
  "reportedSupervisorPidfdHeld",
  "reportedDirectChildWaitAuthority",
  "reportedCgroupInventorySafe",
  "reportedControlCgroupPresent",
  "reportedJobCgroupPresent",
  "reportedStateFilesystemInterfaceAvailable",
  "reportedRecoveryInterfaceAvailable",
  "derivedPriorEffectOutcomeCertain",
  "quarantineReason",
  "attemptSha256",
]);
const attemptBrands = new WeakMap();

function attemptPrefixFromContext(context) {
  const planAssociation = planBrands.get(context.plan);
  if (!planAssociation || !planAssociation.ready) {
    fail("recovery attempt plan is not a branded ready plan");
  }
  if (
    planAssociation.target !== context.target ||
    planAssociation.inventory !== context.lifecycleInventoryObservation ||
    planAssociation.replay !== context.previousRecoveryReplay ||
    planAssociation.lifetimeAnchorProjection !==
      context.lifetimeAnchorProjection ||
    planAssociation.lifetimeAttemptAnchorRawSha256 !==
      context.lifetimeAttemptAnchorRawSha256
  ) {
    fail("recovery attempt context origin changed");
  }
  if (
    !targetBrands.has(context.target) ||
    !inventoryBrands.has(context.lifecycleInventoryObservation) ||
    !replayBrands.has(context.previousRecoveryReplay)
  ) {
    fail("recovery attempt context is not branded");
  }
  const anchor = planAssociation.anchor;
  assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1({
    lifetimeAnchorProjection: context.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256: context.lifetimeAttemptAnchorRawSha256,
    targetSha256: context.target.targetSha256,
    recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
  });
  const recovery = context.plan.recoveryContext;
  return nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SCHEMA_V1],
    ["targetSha256", context.target.targetSha256],
    ["actorKind", anchor.actorKind],
    ["recoveryActorEpochSha256", anchor.recoveryActorEpochSha256],
    ["attemptDirectoryName", anchor.attemptDirectoryName],
    ["lifetimeAttemptAnchorRawSha256", context.lifetimeAttemptAnchorRawSha256],
    [
      "previousRecoveryActorEpochSha256",
      context.previousRecoveryReplay.latestRecoveryActorEpochSha256,
    ],
    [
      "previousAttemptDirectoryName",
      context.previousRecoveryReplay.latestAttemptDirectoryName,
    ],
    [
      "previousRecoveryRecordSequence",
      context.previousRecoveryReplay.latestRecoveryRecordSequence,
    ],
    [
      "previousRecoveryRecordRawSha256",
      context.previousRecoveryReplay.latestRecoveryRecordRawSha256,
    ],
    ["reportedCurrentBootIdSha256", recovery.reportedCurrentBootIdSha256],
    [
      "reportedStateRootIdentitySha256",
      recovery.reportedStateRootIdentitySha256,
    ],
    [
      "reportedDelegatedRootIdentitySha256",
      recovery.reportedDelegatedRootIdentitySha256,
    ],
    [
      "reportedLifetimeCgroupIdentitySha256",
      recovery.reportedLifetimeCgroupIdentitySha256,
    ],
    ["disposition", context.plan.disposition],
    ["reportedSourceLocation", context.plan.sourceLocation],
    ["decisionSourceLocation", context.plan.decisionSourceLocation],
    [
      "reportedLifecycleInventorySha256",
      context.lifecycleInventoryObservation.inventorySha256,
    ],
    ["reportedCommandDescriptorHeld", recovery.reportedCommandDescriptorHeld],
    ["reportedStatusDescriptorHeld", recovery.reportedStatusDescriptorHeld],
    ["reportedSupervisorPidfdHeld", recovery.reportedSupervisorPidfdHeld],
    [
      "reportedDirectChildWaitAuthority",
      recovery.reportedDirectChildWaitAuthority,
    ],
    ["reportedCgroupInventorySafe", recovery.reportedCgroupInventorySafe],
    ["reportedControlCgroupPresent", recovery.reportedControlCgroupPresent],
    ["reportedJobCgroupPresent", recovery.reportedJobCgroupPresent],
    [
      "reportedStateFilesystemInterfaceAvailable",
      recovery.reportedStateFilesystemInterfaceAvailable,
    ],
    [
      "reportedRecoveryInterfaceAvailable",
      recovery.reportedRecoveryInterfaceAvailable,
    ],
    [
      "derivedPriorEffectOutcomeCertain",
      recovery.derivedPriorEffectOutcomeCertain,
    ],
    ["quarantineReason", context.plan.quarantineReason],
  ]);
}

function canonicalAttempt(context) {
  const prefix = attemptPrefixFromContext(context);
  const attempt = immutableRecord([
    ["schema", prefix.schema],
    ["targetSha256", prefix.targetSha256],
    ["actorKind", prefix.actorKind],
    ["recoveryActorEpochSha256", prefix.recoveryActorEpochSha256],
    ["attemptDirectoryName", prefix.attemptDirectoryName],
    ["lifetimeAttemptAnchorRawSha256", prefix.lifetimeAttemptAnchorRawSha256],
    [
      "previousRecoveryActorEpochSha256",
      prefix.previousRecoveryActorEpochSha256,
    ],
    ["previousAttemptDirectoryName", prefix.previousAttemptDirectoryName],
    ["previousRecoveryRecordSequence", prefix.previousRecoveryRecordSequence],
    ["previousRecoveryRecordRawSha256", prefix.previousRecoveryRecordRawSha256],
    ["reportedCurrentBootIdSha256", prefix.reportedCurrentBootIdSha256],
    ["reportedStateRootIdentitySha256", prefix.reportedStateRootIdentitySha256],
    [
      "reportedDelegatedRootIdentitySha256",
      prefix.reportedDelegatedRootIdentitySha256,
    ],
    [
      "reportedLifetimeCgroupIdentitySha256",
      prefix.reportedLifetimeCgroupIdentitySha256,
    ],
    ["disposition", prefix.disposition],
    ["reportedSourceLocation", prefix.reportedSourceLocation],
    ["decisionSourceLocation", prefix.decisionSourceLocation],
    [
      "reportedLifecycleInventorySha256",
      prefix.reportedLifecycleInventorySha256,
    ],
    ["reportedCommandDescriptorHeld", prefix.reportedCommandDescriptorHeld],
    ["reportedStatusDescriptorHeld", prefix.reportedStatusDescriptorHeld],
    ["reportedSupervisorPidfdHeld", prefix.reportedSupervisorPidfdHeld],
    [
      "reportedDirectChildWaitAuthority",
      prefix.reportedDirectChildWaitAuthority,
    ],
    ["reportedCgroupInventorySafe", prefix.reportedCgroupInventorySafe],
    ["reportedControlCgroupPresent", prefix.reportedControlCgroupPresent],
    ["reportedJobCgroupPresent", prefix.reportedJobCgroupPresent],
    [
      "reportedStateFilesystemInterfaceAvailable",
      prefix.reportedStateFilesystemInterfaceAvailable,
    ],
    [
      "reportedRecoveryInterfaceAvailable",
      prefix.reportedRecoveryInterfaceAvailable,
    ],
    [
      "derivedPriorEffectOutcomeCertain",
      prefix.derivedPriorEffectOutcomeCertain,
    ],
    ["quarantineReason", prefix.quarantineReason],
    ["attemptSha256", semanticDigest(prefix)],
  ]);
  attemptBrands.set(attempt, context);
  return attempt;
}

export function createCandidateContainmentRecoveryAttemptV1(input) {
  const record = exactRecord(
    input,
    ATTEMPT_INPUT_FIELDS,
    "recovery attempt input",
    fail,
  );
  return canonicalAttempt(record);
}

function normalizeAttempt(value, label) {
  const record = exactRecord(value, ATTEMPT_FIELDS, label, fail);
  const prefix = nullRecord([
    ["schema", record.schema],
    ["targetSha256", record.targetSha256],
    ["actorKind", record.actorKind],
    ["recoveryActorEpochSha256", record.recoveryActorEpochSha256],
    ["attemptDirectoryName", record.attemptDirectoryName],
    ["lifetimeAttemptAnchorRawSha256", record.lifetimeAttemptAnchorRawSha256],
    [
      "previousRecoveryActorEpochSha256",
      record.previousRecoveryActorEpochSha256,
    ],
    ["previousAttemptDirectoryName", record.previousAttemptDirectoryName],
    ["previousRecoveryRecordSequence", record.previousRecoveryRecordSequence],
    ["previousRecoveryRecordRawSha256", record.previousRecoveryRecordRawSha256],
    ["reportedCurrentBootIdSha256", record.reportedCurrentBootIdSha256],
    ["reportedStateRootIdentitySha256", record.reportedStateRootIdentitySha256],
    [
      "reportedDelegatedRootIdentitySha256",
      record.reportedDelegatedRootIdentitySha256,
    ],
    [
      "reportedLifetimeCgroupIdentitySha256",
      record.reportedLifetimeCgroupIdentitySha256,
    ],
    ["disposition", record.disposition],
    ["reportedSourceLocation", record.reportedSourceLocation],
    ["decisionSourceLocation", record.decisionSourceLocation],
    [
      "reportedLifecycleInventorySha256",
      record.reportedLifecycleInventorySha256,
    ],
    ["reportedCommandDescriptorHeld", record.reportedCommandDescriptorHeld],
    ["reportedStatusDescriptorHeld", record.reportedStatusDescriptorHeld],
    ["reportedSupervisorPidfdHeld", record.reportedSupervisorPidfdHeld],
    [
      "reportedDirectChildWaitAuthority",
      record.reportedDirectChildWaitAuthority,
    ],
    ["reportedCgroupInventorySafe", record.reportedCgroupInventorySafe],
    ["reportedControlCgroupPresent", record.reportedControlCgroupPresent],
    ["reportedJobCgroupPresent", record.reportedJobCgroupPresent],
    [
      "reportedStateFilesystemInterfaceAvailable",
      record.reportedStateFilesystemInterfaceAvailable,
    ],
    [
      "reportedRecoveryInterfaceAvailable",
      record.reportedRecoveryInterfaceAvailable,
    ],
    [
      "derivedPriorEffectOutcomeCertain",
      record.derivedPriorEffectOutcomeCertain,
    ],
    ["quarantineReason", record.quarantineReason],
  ]);
  if (
    record.schema !== CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SCHEMA_V1 ||
    record.attemptSha256 !== semanticDigest(prefix)
  ) {
    fail(`${label} canonical digest changed`);
  }
  return immutableRecord([
    ["schema", record.schema],
    ["targetSha256", record.targetSha256],
    ["actorKind", record.actorKind],
    ["recoveryActorEpochSha256", record.recoveryActorEpochSha256],
    ["attemptDirectoryName", record.attemptDirectoryName],
    ["lifetimeAttemptAnchorRawSha256", record.lifetimeAttemptAnchorRawSha256],
    [
      "previousRecoveryActorEpochSha256",
      record.previousRecoveryActorEpochSha256,
    ],
    ["previousAttemptDirectoryName", record.previousAttemptDirectoryName],
    ["previousRecoveryRecordSequence", record.previousRecoveryRecordSequence],
    ["previousRecoveryRecordRawSha256", record.previousRecoveryRecordRawSha256],
    ["reportedCurrentBootIdSha256", record.reportedCurrentBootIdSha256],
    ["reportedStateRootIdentitySha256", record.reportedStateRootIdentitySha256],
    [
      "reportedDelegatedRootIdentitySha256",
      record.reportedDelegatedRootIdentitySha256,
    ],
    [
      "reportedLifetimeCgroupIdentitySha256",
      record.reportedLifetimeCgroupIdentitySha256,
    ],
    ["disposition", record.disposition],
    ["reportedSourceLocation", record.reportedSourceLocation],
    ["decisionSourceLocation", record.decisionSourceLocation],
    [
      "reportedLifecycleInventorySha256",
      record.reportedLifecycleInventorySha256,
    ],
    ["reportedCommandDescriptorHeld", record.reportedCommandDescriptorHeld],
    ["reportedStatusDescriptorHeld", record.reportedStatusDescriptorHeld],
    ["reportedSupervisorPidfdHeld", record.reportedSupervisorPidfdHeld],
    [
      "reportedDirectChildWaitAuthority",
      record.reportedDirectChildWaitAuthority,
    ],
    ["reportedCgroupInventorySafe", record.reportedCgroupInventorySafe],
    ["reportedControlCgroupPresent", record.reportedControlCgroupPresent],
    ["reportedJobCgroupPresent", record.reportedJobCgroupPresent],
    [
      "reportedStateFilesystemInterfaceAvailable",
      record.reportedStateFilesystemInterfaceAvailable,
    ],
    [
      "reportedRecoveryInterfaceAvailable",
      record.reportedRecoveryInterfaceAvailable,
    ],
    [
      "derivedPriorEffectOutcomeCertain",
      record.derivedPriorEffectOutcomeCertain,
    ],
    ["quarantineReason", record.quarantineReason],
    ["attemptSha256", record.attemptSha256],
  ]);
}

export function verifyCandidateContainmentRecoveryAttemptV1(input) {
  const record = exactRecord(
    input,
    ATTEMPT_VERIFY_INPUT_FIELDS,
    "recovery attempt verification input",
    fail,
  );
  const supplied = normalizeAttempt(record.attempt, "recovery attempt");
  const context = nullRecord([
    ["target", record.target],
    ["lifecycleInventoryObservation", record.lifecycleInventoryObservation],
    ["previousRecoveryReplay", record.previousRecoveryReplay],
    ["plan", record.plan],
    ["lifetimeAnchorProjection", record.lifetimeAnchorProjection],
    ["lifetimeAttemptAnchorRawSha256", record.lifetimeAttemptAnchorRawSha256],
  ]);
  const rebuilt = canonicalAttempt(context);
  if (canonicalJson(supplied) !== canonicalJson(rebuilt)) {
    fail("recovery attempt differs from verified context");
  }
  return rebuilt;
}

const RECORD_CREATE_INPUT_FIELDS = deepFreeze([
  "target",
  "lifecycleInventoryObservation",
  "previousRecoveryReplay",
  "plan",
  "lifetimeAnchorProjection",
  "lifetimeAttemptAnchorRawSha256",
  "attempt",
  "previousRecord",
  "operationBytes",
  "evidenceBytes",
]);
const RECORD_VALUE_FIELDS = deepFreeze([
  "schema",
  "sequence",
  "recordType",
  "priorState",
  "nextState",
  "previousRecordRawSha256",
  "targetSha256",
  "attempt",
  "operation",
  "evidence",
]);
const ARTIFACT_DESCRIPTOR_FIELDS = deepFreeze([
  "schema",
  "rawSha256",
  "semanticSha256",
  "bytesBase64",
  "bindingSha256",
]);
const recordBrands = new WeakMap();

function sequenceText(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 24) {
    fail("recovery record sequence changed");
  }
  return String(value).padStart(16, "0");
}

function descriptorSchema(kind, recordType) {
  return `oxigraph.candidate-containment-recovery-${kind}/${recordType
    .toLowerCase()
    .replaceAll("_", "-")}/v1`;
}

function artifactDescriptor(kind, context, payload) {
  const decoded = decodeCanonicalJsonLine(
    payload,
    `recovery record ${kind}`,
    CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
    fail,
  );
  const artifactSchema = descriptorSchema(kind, context.recordType);
  const rawSha256 = sha256(payload);
  const semanticSha256 = semanticDigest(decoded.value);
  const binding = nullRecord([
    ["schema", `oxigraph.candidate-containment-recovery-${kind}-binding/v1`],
    ["kind", kind],
    ["artifactSchema", artifactSchema],
    ["sequence", context.sequence],
    ["recordType", context.recordType],
    ["priorState", context.priorState],
    ["targetSha256", context.targetSha256],
    ["attemptSha256", context.attempt.attemptSha256],
    ["recoveryActorEpochSha256", context.attempt.recoveryActorEpochSha256],
    ["previousRecordRawSha256", context.previousRecordRawSha256],
    ["rawSha256", rawSha256],
    ["semanticSha256", semanticSha256],
  ]);
  return immutableRecord([
    ["schema", artifactSchema],
    ["rawSha256", rawSha256],
    ["semanticSha256", semanticSha256],
    [
      "bytesBase64",
      encodeCanonicalBase64(
        payload,
        `recovery record ${kind}`,
        CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
        fail,
      ),
    ],
    ["bindingSha256", semanticDigest(binding)],
  ]);
}

function recordWrapper(name, payload, value, planValidated) {
  const wrapper = frozenCopyOnReadBytes(payload, [
    ["name", name],
    ["rawSha256", sha256(payload)],
    ["semanticSha256", semanticDigest(value)],
    ["schema", value.schema],
    ["sequence", value.sequence],
    ["recordType", value.recordType],
    ["priorState", value.priorState],
    ["nextState", value.nextState],
    ["previousRecordRawSha256", value.previousRecordRawSha256],
    ["targetSha256", value.targetSha256],
    ["attempt", value.attempt],
    ["operation", value.operation],
    ["evidence", value.evidence],
    ["standaloneRecordHashChainValidated", false],
    ["planValidated", planValidated],
    ["embeddedArtifactBindingsValidated", true],
  ]);
  return wrapper;
}

function recordWrapperFromDecoded(name, decoded, value, planValidated) {
  return frozenCopyOnReadBytes(decoded.bytes, [
    ["name", name],
    ["rawSha256", sha256(decoded.bytes)],
    ["semanticSha256", semanticDigest(value)],
    ["schema", value.schema],
    ["sequence", value.sequence],
    ["recordType", value.recordType],
    ["priorState", value.priorState],
    ["nextState", value.nextState],
    ["previousRecordRawSha256", value.previousRecordRawSha256],
    ["targetSha256", value.targetSha256],
    ["attempt", value.attempt],
    ["operation", value.operation],
    ["evidence", value.evidence],
    ["standaloneRecordHashChainValidated", false],
    ["planValidated", planValidated],
    ["embeddedArtifactBindingsValidated", true],
  ]);
}

function verifiedPreviousRecord(value) {
  if (value === null) return null;
  const association = recordBrands.get(value);
  if (association) return value;
  return verifyCandidateContainmentRecoveryRecordV1(value);
}

export function createCandidateContainmentRecoveryRecordV1(input) {
  const record = exactRecord(
    input,
    RECORD_CREATE_INPUT_FIELDS,
    "recovery record input",
    fail,
  );
  const attemptAssociation = attemptBrands.get(record.attempt);
  const planAssociation = planBrands.get(record.plan);
  if (!attemptAssociation || !planAssociation || !planAssociation.ready) {
    fail("recovery record context is not branded");
  }
  if (
    attemptAssociation.target !== record.target ||
    attemptAssociation.lifecycleInventoryObservation !==
      record.lifecycleInventoryObservation ||
    attemptAssociation.previousRecoveryReplay !==
      record.previousRecoveryReplay ||
    attemptAssociation.plan !== record.plan ||
    attemptAssociation.lifetimeAnchorProjection !==
      record.lifetimeAnchorProjection ||
    attemptAssociation.lifetimeAttemptAnchorRawSha256 !==
      record.lifetimeAttemptAnchorRawSha256
  ) {
    fail("recovery record context origin changed");
  }
  const previous = verifiedPreviousRecord(record.previousRecord);
  let position = 0;
  let priorState = null;
  let previousRawSha256 = CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1;
  if (previous !== null) {
    if (
      previous.targetSha256 !== record.target.targetSha256 ||
      previous.attempt.attemptSha256 !== record.attempt.attemptSha256
    ) {
      fail("recovery record predecessor context changed");
    }
    position = Number(previous.sequence);
    priorState = previous.nextState;
    previousRawSha256 = previous.rawSha256;
  }
  const recordType = record.plan.states.at(position);
  if (recordType === undefined) fail("recovery record exceeds selected plan");
  const sequence = sequenceText(position + 1);
  if (
    previous !== null &&
    (previous.sequence !== sequenceText(position) ||
      previous.recordType !== record.plan.states.at(position - 1))
  ) {
    fail("recovery record predecessor is not dense");
  }
  const context = immutableRecord([
    ["sequence", sequence],
    ["recordType", recordType],
    ["priorState", priorState],
    ["previousRecordRawSha256", previousRawSha256],
    ["targetSha256", record.target.targetSha256],
    ["attempt", record.attempt],
  ]);
  const operation = artifactDescriptor(
    "operation",
    context,
    record.operationBytes,
  );
  const evidence = artifactDescriptor(
    "evidence",
    context,
    record.evidenceBytes,
  );
  if (
    position === 0 &&
    canonicalJson(
      decodeCanonicalJsonLine(
        record.evidenceBytes,
        "recovery record one evidence",
        CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
        fail,
      ).value,
    ) !== canonicalJson(record.lifecycleInventoryObservation)
  ) {
    fail("recovery record one lifecycle inventory evidence changed");
  }
  const value = immutableRecord([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_RECORD_SCHEMA_V1],
    ["sequence", sequence],
    ["recordType", recordType],
    ["priorState", priorState],
    ["nextState", recordType],
    ["previousRecordRawSha256", previousRawSha256],
    ["targetSha256", record.target.targetSha256],
    ["attempt", record.attempt],
    ["operation", operation],
    ["evidence", evidence],
  ]);
  const payload = canonicalJsonLine(value);
  exactBufferByteLength(
    payload,
    "recovery record canonical payload",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1,
    },
    fail,
  );
  const rawSha256 = sha256(payload);
  const name = `${sequence}-${rawSha256}.jsonl`;
  const wrapper = recordWrapper(name, payload, value, false);
  recordBrands.set(
    wrapper,
    immutableRecord([
      ["target", record.target],
      ["plan", record.plan],
      ["attempt", record.attempt],
    ]),
  );
  return wrapper;
}

function normalizeArtifactDescriptor(value, kind, context) {
  const record = exactRecord(
    value,
    ARTIFACT_DESCRIPTOR_FIELDS,
    `recovery record ${kind} descriptor`,
    fail,
  );
  const artifactSchema = descriptorSchema(kind, context.recordType);
  if (record.schema !== artifactSchema) {
    fail(`recovery record ${kind} schema changed`);
  }
  const payload = decodeCanonicalBase64(
    record.bytesBase64,
    `recovery record ${kind} embedded payload`,
    CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
    fail,
  );
  const decoded = decodeCanonicalJsonLine(
    payload,
    `recovery record ${kind} embedded payload`,
    CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
    fail,
  );
  const rawSha256 = sha256(payload);
  const semanticSha256 = semanticDigest(decoded.value);
  const binding = nullRecord([
    ["schema", `oxigraph.candidate-containment-recovery-${kind}-binding/v1`],
    ["kind", kind],
    ["artifactSchema", artifactSchema],
    ["sequence", context.sequence],
    ["recordType", context.recordType],
    ["priorState", context.priorState],
    ["targetSha256", context.targetSha256],
    ["attemptSha256", context.attempt.attemptSha256],
    ["recoveryActorEpochSha256", context.attempt.recoveryActorEpochSha256],
    ["previousRecordRawSha256", context.previousRecordRawSha256],
    ["rawSha256", rawSha256],
    ["semanticSha256", semanticSha256],
  ]);
  if (
    record.rawSha256 !== rawSha256 ||
    record.semanticSha256 !== semanticSha256 ||
    record.bindingSha256 !== semanticDigest(binding)
  ) {
    fail(`recovery record ${kind} descriptor binding changed`);
  }
  return immutableRecord([
    ["schema", record.schema],
    ["rawSha256", record.rawSha256],
    ["semanticSha256", record.semanticSha256],
    ["bytesBase64", record.bytesBase64],
    ["bindingSha256", record.bindingSha256],
  ]);
}

export function verifyCandidateContainmentRecoveryRecordV1(input) {
  const reference = exactRecord(
    input,
    ["name", "bytes"],
    "recovery record reference",
    fail,
  );
  exactBufferByteLength(
    reference.bytes,
    "recovery record reference bytes",
    {
      minimumBytes: 2,
      maximumBytes: CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1,
    },
    fail,
  );
  const decoded = decodeCanonicalJsonLine(
    reference.bytes,
    "recovery record bytes",
    CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1,
    fail,
  );
  const rawSha256 = sha256(reference.bytes);
  const value = exactRecord(
    decoded.value,
    RECORD_VALUE_FIELDS,
    "recovery record",
    fail,
  );
  if (
    value.schema !== CANDIDATE_CONTAINMENT_RECOVERY_RECORD_SCHEMA_V1 ||
    !/^[0-9]{16}$/u.test(value.sequence) ||
    Number(value.sequence) < 1 ||
    Number(value.sequence) >
      CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_PER_ATTEMPT_V1 ||
    !CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.includes(
      value.recordType,
    ) ||
    (value.priorState !== null &&
      !CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.includes(
        value.priorState,
      )) ||
    !CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.includes(value.nextState)
  ) {
    fail("recovery record grammar changed");
  }
  exactDigest(
    value.previousRecordRawSha256,
    "recovery record predecessor",
    fail,
  );
  exactDigest(value.targetSha256, "recovery record target", fail);
  const attempt = normalizeAttempt(value.attempt, "recovery record attempt");
  if (attempt.targetSha256 !== value.targetSha256) {
    fail("recovery record attempt target changed");
  }
  const context = immutableRecord([
    ["sequence", value.sequence],
    ["recordType", value.recordType],
    ["priorState", value.priorState],
    ["previousRecordRawSha256", value.previousRecordRawSha256],
    ["targetSha256", value.targetSha256],
    ["attempt", attempt],
  ]);
  const operation = normalizeArtifactDescriptor(
    value.operation,
    "operation",
    context,
  );
  const evidence = normalizeArtifactDescriptor(
    value.evidence,
    "evidence",
    context,
  );
  const normalizedValue = immutableRecord([
    ["schema", value.schema],
    ["sequence", value.sequence],
    ["recordType", value.recordType],
    ["priorState", value.priorState],
    ["nextState", value.nextState],
    ["previousRecordRawSha256", value.previousRecordRawSha256],
    ["targetSha256", value.targetSha256],
    ["attempt", attempt],
    ["operation", operation],
    ["evidence", evidence],
  ]);
  if (
    reference.name !== `${value.sequence}-${rawSha256}.jsonl` ||
    canonicalJson(normalizedValue) !== canonicalJson(value)
  ) {
    fail("recovery record filename or canonical value changed");
  }
  const wrapper = recordWrapperFromDecoded(
    reference.name,
    decoded,
    normalizedValue,
    false,
  );
  recordBrands.set(wrapper, immutableRecord([["standalone", true]]));
  return wrapper;
}

const ANCHORED_EMPTY_CREATE_INPUT_FIELDS = deepFreeze([
  "target",
  "previousRecoveryReplay",
  "lifetimeAnchorProjection",
  "lifetimeAttemptAnchorRawSha256",
  "reportedAttemptDirectoryState",
]);
const ANCHORED_EMPTY_VERIFY_INPUT_FIELDS = deepFreeze([
  "anchoredEmptyAttempt",
  "target",
  "previousRecoveryReplay",
  "lifetimeAnchorProjection",
  "lifetimeAttemptAnchorRawSha256",
]);
const ANCHORED_EMPTY_FIELDS = deepFreeze([
  "schema",
  "targetSha256",
  "actorKind",
  "recoveryActorEpochSha256",
  "attemptDirectoryName",
  "lifetimeAttemptAnchorRawSha256",
  "previousRecoveryActorEpochSha256",
  "previousAttemptDirectoryName",
  "previousRecoveryRecordSequence",
  "previousRecoveryRecordRawSha256",
  "reportedAttemptDirectoryState",
  "latestRecoveryRecordSequence",
  "latestRecoveryRecordRawSha256",
]);
const anchoredEmptyBrands = new WeakMap();

function anchoredEmptyFromContext(context, reportedState) {
  const targetAssociation = targetBrands.get(context.target);
  const replayAssociation = replayBrands.get(context.previousRecoveryReplay);
  if (!targetAssociation || !replayAssociation) {
    fail("anchored-empty context is not branded");
  }
  if (
    replayAssociation.target !== context.target ||
    replayAssociation.currentAnchor === null ||
    replayAssociation.currentLifetimeAnchorProjection !==
      context.lifetimeAnchorProjection ||
    replayAssociation.currentLifetimeAttemptAnchorRawSha256 !==
      context.lifetimeAttemptAnchorRawSha256 ||
    (context.previousRecoveryReplay.latestRecoveryRecordSequence !== null &&
      context.previousRecoveryReplay.latestRecoveryActorEpochSha256 ===
        replayAssociation.currentAnchor.recoveryActorEpochSha256)
  ) {
    fail("anchored-empty current anchor context changed");
  }
  exactChoice(
    reportedState,
    CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_DIRECTORY_STATES_V1,
    "anchored-empty directory state",
  );
  const anchor = replayAssociation.currentAnchor;
  assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1({
    lifetimeAnchorProjection: context.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256: context.lifetimeAttemptAnchorRawSha256,
    targetSha256: context.target.targetSha256,
    recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
  });
  const value = immutableRecord([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_ANCHORED_EMPTY_ATTEMPT_SCHEMA_V1],
    ["targetSha256", context.target.targetSha256],
    ["actorKind", anchor.actorKind],
    ["recoveryActorEpochSha256", anchor.recoveryActorEpochSha256],
    ["attemptDirectoryName", anchor.attemptDirectoryName],
    ["lifetimeAttemptAnchorRawSha256", context.lifetimeAttemptAnchorRawSha256],
    [
      "previousRecoveryActorEpochSha256",
      context.previousRecoveryReplay.latestRecoveryActorEpochSha256,
    ],
    [
      "previousAttemptDirectoryName",
      context.previousRecoveryReplay.latestAttemptDirectoryName,
    ],
    [
      "previousRecoveryRecordSequence",
      context.previousRecoveryReplay.latestRecoveryRecordSequence,
    ],
    [
      "previousRecoveryRecordRawSha256",
      context.previousRecoveryReplay.latestRecoveryRecordRawSha256,
    ],
    ["reportedAttemptDirectoryState", reportedState],
    ["latestRecoveryRecordSequence", null],
    [
      "latestRecoveryRecordRawSha256",
      CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1,
    ],
  ]);
  anchoredEmptyBrands.set(value, context);
  return value;
}

export function createCandidateContainmentRecoveryAnchoredEmptyAttemptV1(
  input,
) {
  const record = exactRecord(
    input,
    ANCHORED_EMPTY_CREATE_INPUT_FIELDS,
    "anchored-empty input",
    fail,
  );
  return anchoredEmptyFromContext(record, record.reportedAttemptDirectoryState);
}

function normalizeAnchoredEmpty(value, label) {
  const record = exactRecord(value, ANCHORED_EMPTY_FIELDS, label, fail);
  if (
    record.schema !==
      CANDIDATE_CONTAINMENT_RECOVERY_ANCHORED_EMPTY_ATTEMPT_SCHEMA_V1 ||
    record.latestRecoveryRecordSequence !== null ||
    record.latestRecoveryRecordRawSha256 !==
      CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1
  ) {
    fail(`${label} grammar changed`);
  }
  exactDigest(record.targetSha256, `${label} target`, fail);
  exactChoice(
    record.actorKind,
    CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1,
    `${label} actor kind`,
  );
  exactDigest(record.recoveryActorEpochSha256, `${label} actor`, fail);
  exactText(record.attemptDirectoryName, `${label} directory`);
  exactDigest(
    record.lifetimeAttemptAnchorRawSha256,
    `${label} lifetime anchor`,
    fail,
  );
  exactNullableDigest(
    record.previousRecoveryActorEpochSha256,
    `${label} previous actor`,
  );
  if (
    record.previousAttemptDirectoryName !== null &&
    typeof record.previousAttemptDirectoryName !== "string"
  ) {
    fail(`${label} previous directory changed`);
  }
  if (
    record.previousRecoveryRecordSequence !== null &&
    !/^[0-9]{16}$/u.test(record.previousRecoveryRecordSequence)
  ) {
    fail(`${label} previous sequence changed`);
  }
  exactDigest(
    record.previousRecoveryRecordRawSha256,
    `${label} previous raw head`,
    fail,
  );
  exactChoice(
    record.reportedAttemptDirectoryState,
    CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_DIRECTORY_STATES_V1,
    `${label} directory state`,
  );
  return immutableRecord([
    ["schema", record.schema],
    ["targetSha256", record.targetSha256],
    ["actorKind", record.actorKind],
    ["recoveryActorEpochSha256", record.recoveryActorEpochSha256],
    ["attemptDirectoryName", record.attemptDirectoryName],
    ["lifetimeAttemptAnchorRawSha256", record.lifetimeAttemptAnchorRawSha256],
    [
      "previousRecoveryActorEpochSha256",
      record.previousRecoveryActorEpochSha256,
    ],
    ["previousAttemptDirectoryName", record.previousAttemptDirectoryName],
    ["previousRecoveryRecordSequence", record.previousRecoveryRecordSequence],
    ["previousRecoveryRecordRawSha256", record.previousRecoveryRecordRawSha256],
    ["reportedAttemptDirectoryState", record.reportedAttemptDirectoryState],
    ["latestRecoveryRecordSequence", null],
    [
      "latestRecoveryRecordRawSha256",
      CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1,
    ],
  ]);
}

export function verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1(
  input,
) {
  const record = exactRecord(
    input,
    ANCHORED_EMPTY_VERIFY_INPUT_FIELDS,
    "anchored-empty verification input",
    fail,
  );
  const supplied = normalizeAnchoredEmpty(
    record.anchoredEmptyAttempt,
    "anchored-empty attempt",
  );
  const context = nullRecord([
    ["target", record.target],
    ["previousRecoveryReplay", record.previousRecoveryReplay],
    ["lifetimeAnchorProjection", record.lifetimeAnchorProjection],
    ["lifetimeAttemptAnchorRawSha256", record.lifetimeAttemptAnchorRawSha256],
  ]);
  const rebuilt = anchoredEmptyFromContext(
    context,
    supplied.reportedAttemptDirectoryState,
  );
  if (canonicalJson(supplied) !== canonicalJson(rebuilt)) {
    fail("anchored-empty attempt differs from verified context");
  }
  return rebuilt;
}

const FINALIZED_ENTRY_FIELDS = deepFreeze([
  "kind",
  "lifetimeAnchorProjection",
  "lifetimeAttemptAnchorRawSha256",
  "attempt",
  "records",
]);
const EMPTY_ENTRY_FIELDS = deepFreeze([
  "kind",
  "lifetimeAnchorProjection",
  "lifetimeAttemptAnchorRawSha256",
  "anchoredEmptyAttempt",
  "records",
]);

function statesForAttempt(attempt, target) {
  if (attempt.disposition === "GENESIS_ABORT") return GENESIS_STATES;
  if (attempt.disposition === "REBOOT_INTERRUPTION") return REBOOT_STATES;
  if (attempt.disposition === "QUARANTINE") return QUARANTINE_STATES;
  if (attempt.disposition === "RECOVERED_DECISION_RESUME") {
    return RECOVERED_RESUME_STATES;
  }
  if (attempt.disposition === "QUARANTINE_DECISION_RESUME") {
    return QUARANTINE_RESUME_STATES;
  }
  if (attempt.disposition === "SAME_BOOT_RECONCILE") {
    return sameBootStates(target, attempt);
  }
  fail("recovery attempt disposition changed");
}

function sameAttempt(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function anchorCarrier(projection, rawSha256) {
  return immutableRecord([
    ["lifetimeAnchorProjection", projection],
    ["lifetimeAttemptAnchorRawSha256", rawSha256],
  ]);
}

function assertAnchorMatchesEntry(
  anchor,
  rawSha256,
  target,
  expectedStateRoot,
) {
  if (
    anchor.schema !==
      CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1 ||
    anchor.targetSha256 !== target.targetSha256 ||
    anchor.expectedStateRootIdentitySha256 !== expectedStateRoot
  ) {
    fail("recovery entry lifetime anchor changed");
  }
  exactChoice(
    anchor.actorKind,
    CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1,
    "recovery entry actor kind",
  );
  exactDigest(anchor.recoveryActorEpochSha256, "recovery entry actor", fail);
  exactText(anchor.attemptDirectoryName, "recovery entry directory");
  exactDigest(rawSha256, "recovery entry lifetime anchor raw hash", fail);
  assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1({
    lifetimeAnchorProjection: anchor,
    lifetimeAttemptAnchorRawSha256: rawSha256,
    targetSha256: target.targetSha256,
    recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
  });
}

function replayEntryShapes(entries) {
  const shapes = [];
  let recordCount = 0;
  for (const entry of entries) {
    let header = null;
    try {
      const finalized = exactRecord(
        entry,
        FINALIZED_ENTRY_FIELDS,
        "recovery replay finalized entry",
        fail,
      );
      if (finalized.kind === "FINALIZED_ATTEMPT") header = finalized;
    } catch {
      header = null;
    }
    if (header === null) {
      const anchoredEmpty = exactRecord(
        entry,
        EMPTY_ENTRY_FIELDS,
        "recovery replay anchored-empty entry",
        fail,
      );
      if (anchoredEmpty.kind !== "ANCHORED_EMPTY_ATTEMPT") {
        fail("recovery replay entry kind changed");
      }
      header = anchoredEmpty;
    }
    const records = exactDenseArray(
      header.records,
      "recovery replay entry records",
      CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_PER_ATTEMPT_V1,
      fail,
    );
    recordCount += records.length;
    if (
      recordCount >
      CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_ACROSS_ATTEMPTS_V1
    ) {
      fail("recovery replay record count exceeds the exact bound");
    }
    shapes.push(
      nullRecord([
        ["entry", header],
        ["records", records],
      ]),
    );
  }
  return nullRecord([
    ["shapes", shapes],
    ["recordCount", recordCount],
  ]);
}

function normalizeReplayEntries(entries, target, expectedStateRoot) {
  const preflight = replayEntryShapes(entries);
  const normalizedEntries = [];
  const carriers = [];
  const implicitCarriers = [];
  const actors = [];
  const directories = [];
  let previousActor = null;
  let previousDirectory = null;
  let previousSequence = null;
  let previousRaw = CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1;
  let finalizedCount = 0;
  let emptyCount = 0;
  let latestAttemptState = null;
  let latestFinalizedState = null;
  let certainty = true;
  let inheritedDecision = null;
  let decisionSource = null;
  let latestAnchor = null;
  let latestRawAnchor = null;
  let commandHeld = false;
  let statusHeld = false;
  let pidfdHeld = false;
  let waitHeld = false;
  let latestAttempt = null;
  let aggregateBytes = 0;
  for (const shape of preflight.shapes) {
    const entry = shape.entry;
    const anchor = exactRecord(
      entry.lifetimeAnchorProjection,
      LIFETIME_ANCHOR_FIELDS,
      "recovery replay entry lifetime anchor",
      fail,
    );
    assertAnchorMatchesEntry(
      entry.lifetimeAnchorProjection,
      entry.lifetimeAttemptAnchorRawSha256,
      target,
      expectedStateRoot,
    );
    if (normalizedEntries.length === 0) {
      previousActor = anchor.previousRecoveryActorEpochSha256;
      previousDirectory = anchor.previousAttemptDirectoryName;
      previousSequence = anchor.previousRecoveryRecordSequence;
      previousRaw = anchor.previousRecoveryRecordRawSha256;
      let priorReplay = null;
      if (entry.kind === "FINALIZED_ATTEMPT") {
        const association = attemptBrands.get(entry.attempt);
        if (association) priorReplay = association.previousRecoveryReplay;
      } else {
        const association = anchoredEmptyBrands.get(entry.anchoredEmptyAttempt);
        if (association) priorReplay = association.previousRecoveryReplay;
      }
      if (priorReplay !== null) {
        const priorAssociation = replayBrands.get(priorReplay);
        if (priorAssociation?.summary !== null) {
          for (const carrier of priorAssociation.summary.carriers) {
            implicitCarriers.push(carrier);
          }
        }
        certainty = priorReplay.derivedPriorEffectOutcomeCertain;
        inheritedDecision = priorReplay.inheritedTerminalDecision;
        decisionSource = priorReplay.decisionSourceLocation;
        latestFinalizedState = priorReplay.latestFinalizedRecoveryState;
      }
    }
    if (
      actors.includes(anchor.recoveryActorEpochSha256) ||
      directories.includes(anchor.attemptDirectoryName) ||
      anchor.previousRecoveryActorEpochSha256 !== previousActor ||
      anchor.previousAttemptDirectoryName !== previousDirectory ||
      anchor.previousRecoveryRecordSequence !== previousSequence ||
      anchor.previousRecoveryRecordRawSha256 !== previousRaw
    ) {
      fail("recovery replay anchor lineage changed");
    }
    actors.push(anchor.recoveryActorEpochSha256);
    directories.push(anchor.attemptDirectoryName);
    latestAnchor = anchor;
    latestRawAnchor = entry.lifetimeAttemptAnchorRawSha256;
    carriers.push(
      anchorCarrier(
        entry.lifetimeAnchorProjection,
        entry.lifetimeAttemptAnchorRawSha256,
      ),
    );
    if (entry.kind === "ANCHORED_EMPTY_ATTEMPT") {
      if (shape.records.length !== 0) {
        fail("anchored-empty replay entry has records");
      }
      if (!anchoredEmptyBrands.has(entry.anchoredEmptyAttempt)) {
        fail("anchored-empty replay entry is not branded");
      }
      const empty = normalizeAnchoredEmpty(
        entry.anchoredEmptyAttempt,
        "recovery replay anchored-empty attempt",
      );
      if (
        empty.targetSha256 !== target.targetSha256 ||
        empty.actorKind !== anchor.actorKind ||
        empty.recoveryActorEpochSha256 !== anchor.recoveryActorEpochSha256 ||
        empty.attemptDirectoryName !== anchor.attemptDirectoryName ||
        empty.lifetimeAttemptAnchorRawSha256 !==
          entry.lifetimeAttemptAnchorRawSha256 ||
        empty.previousRecoveryActorEpochSha256 !== previousActor ||
        empty.previousAttemptDirectoryName !== previousDirectory ||
        empty.previousRecoveryRecordSequence !== previousSequence ||
        empty.previousRecoveryRecordRawSha256 !== previousRaw
      ) {
        fail("anchored-empty replay binding changed");
      }
      emptyCount += 1;
      previousActor = empty.recoveryActorEpochSha256;
      previousDirectory = empty.attemptDirectoryName;
      previousSequence = null;
      previousRaw = CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1;
      latestAttemptState = null;
      if (
        anchor.actorKind === "LIVE_BIRTH_GUARDIAN" &&
        anchor.expectedCurrentBootIdSha256 === target.bootIdSha256
      ) {
        const ceilings = normalDescriptorCeilings(target);
        commandHeld = ceilings.at(0);
        statusHeld = ceilings.at(1);
        pidfdHeld = ceilings.at(2);
        waitHeld = ceilings.at(3);
      } else {
        commandHeld = false;
        statusHeld = false;
        pidfdHeld = false;
        waitHeld = false;
      }
      normalizedEntries.push(
        immutableRecord([
          ["kind", entry.kind],
          ["anchor", anchor],
          ["anchorRawSha256", entry.lifetimeAttemptAnchorRawSha256],
          ["empty", empty],
          ["records", shape.records],
        ]),
      );
      continue;
    }
    if (shape.records.length === 0) {
      fail("finalized replay entry has no recovery record");
    }
    if (!attemptBrands.has(entry.attempt)) {
      fail("recovery replay attempt is not branded");
    }
    if (
      attemptBrands.get(entry.attempt).target.targetSha256 !==
      target.targetSha256
    ) {
      fail("recovery replay attempt target origin changed");
    }
    const attempt = normalizeAttempt(entry.attempt, "recovery replay attempt");
    if (
      attempt.targetSha256 !== target.targetSha256 ||
      attempt.actorKind !== anchor.actorKind ||
      attempt.recoveryActorEpochSha256 !== anchor.recoveryActorEpochSha256 ||
      attempt.attemptDirectoryName !== anchor.attemptDirectoryName ||
      attempt.lifetimeAttemptAnchorRawSha256 !==
        entry.lifetimeAttemptAnchorRawSha256 ||
      attempt.previousRecoveryActorEpochSha256 !== previousActor ||
      attempt.previousAttemptDirectoryName !== previousDirectory ||
      attempt.previousRecoveryRecordSequence !== previousSequence ||
      attempt.previousRecoveryRecordRawSha256 !== previousRaw
    ) {
      fail("recovery replay attempt lineage changed");
    }
    const states = statesForAttempt(attempt, target);
    let localPreviousRaw = CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1;
    let localPrior = null;
    let localPosition = 0;
    const normalizedRecords = [];
    for (const reference of shape.records) {
      const rawReference = exactRecord(
        reference,
        ["name", "bytes"],
        "recovery replay record reference",
        fail,
      );
      aggregateBytes += exactBufferByteLength(
        rawReference.bytes,
        "recovery replay record bytes",
        {
          minimumBytes: 2,
          maximumBytes: CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1,
        },
        fail,
      );
      if (
        aggregateBytes >
        CANDIDATE_CONTAINMENT_RECOVERY_MAX_AGGREGATE_RECORD_BYTES_V1
      ) {
        fail("recovery replay aggregate bytes exceed the exact bound");
      }
      const normalized = verifyCandidateContainmentRecoveryRecordV1(reference);
      const expectedState = states.at(localPosition);
      if (
        expectedState === undefined ||
        normalized.sequence !== sequenceText(localPosition + 1) ||
        normalized.recordType !== expectedState ||
        normalized.priorState !== localPrior ||
        normalized.nextState !== expectedState ||
        normalized.previousRecordRawSha256 !== localPreviousRaw ||
        normalized.targetSha256 !== target.targetSha256 ||
        !sameAttempt(normalized.attempt, attempt)
      ) {
        fail("recovery replay record plan lineage changed");
      }
      normalizedRecords.push(normalized);
      localPreviousRaw = normalized.rawSha256;
      localPrior = normalized.nextState;
      localPosition += 1;
    }
    finalizedCount += 1;
    latestAttempt = attempt;
    latestAttemptState = localPrior;
    latestFinalizedState = localPrior;
    previousActor = attempt.recoveryActorEpochSha256;
    previousDirectory = attempt.attemptDirectoryName;
    previousSequence = sequenceText(localPosition);
    previousRaw = localPreviousRaw;
    commandHeld = attempt.reportedCommandDescriptorHeld;
    statusHeld = attempt.reportedStatusDescriptorHeld;
    pidfdHeld = attempt.reportedSupervisorPidfdHeld;
    waitHeld = attempt.reportedDirectChildWaitAuthority;
    if (
      states
        .slice(0, localPosition)
        .includes("COMMAND_DESCRIPTOR_CLOSED_OBSERVED")
    ) {
      commandHeld = false;
    }
    if (states.slice(0, localPosition).includes("STATUS_EOF_OBSERVED")) {
      statusHeld = false;
    }
    if (states.slice(0, localPosition).includes("SUPERVISOR_REAPED_OBSERVED")) {
      waitHeld = false;
    }
    if (
      CANDIDATE_CONTAINMENT_RECOVERY_UNRESOLVED_EFFECT_INTENT_STATES_V1.includes(
        latestAttemptState,
      )
    ) {
      certainty = false;
    }
    if (
      latestAttemptState === "RECOVERED_TOMBSTONE_DURABLE" ||
      latestAttemptState === "RECOVERED_TOMBSTONE_ADOPTED" ||
      latestAttemptState === "RECOVERED_LOCATION_OBSERVED"
    ) {
      inheritedDecision = "RECOVERED";
      decisionSource = attempt.decisionSourceLocation;
    }
    if (
      latestAttemptState === "QUARANTINE_INTENT_DURABLE" ||
      latestAttemptState === "QUARANTINE_INTENT_ADOPTED" ||
      latestAttemptState === "QUARANTINED_LOCATION_OBSERVED"
    ) {
      inheritedDecision = "QUARANTINED";
      decisionSource = attempt.decisionSourceLocation;
    }
    normalizedEntries.push(
      immutableRecord([
        ["kind", entry.kind],
        ["anchor", anchor],
        ["anchorRawSha256", entry.lifetimeAttemptAnchorRawSha256],
        ["attempt", attempt],
        ["records", deepFreeze(normalizedRecords)],
        ["states", states],
      ]),
    );
  }
  return immutableRecord([
    ["entries", deepFreeze(normalizedEntries)],
    ["carriers", deepFreeze(implicitCarriers.concat(carriers))],
    ["implicitCarrierCount", implicitCarriers.length],
    ["attemptCount", preflight.shapes.length],
    ["finalizedAttemptCount", finalizedCount],
    ["anchoredEmptyAttemptCount", emptyCount],
    ["recordCount", preflight.recordCount],
    ["latestRecoveryActorEpochSha256", previousActor],
    ["latestAttemptDirectoryName", previousDirectory],
    ["latestRecoveryRecordSequence", previousSequence],
    ["latestRecoveryRecordRawSha256", previousRaw],
    ["latestAttemptState", latestAttemptState],
    ["latestFinalizedRecoveryState", latestFinalizedState],
    ["derivedPriorEffectOutcomeCertain", certainty],
    ["inheritedTerminalDecision", inheritedDecision],
    ["decisionSourceLocation", decisionSource],
    ["latestAnchor", latestAnchor],
    ["latestAnchorRawSha256", latestRawAnchor],
    ["latestAttempt", latestAttempt],
    ["commandDescriptorMayRemainHeld", commandHeld],
    ["statusDescriptorMayRemainHeld", statusHeld],
    ["supervisorPidfdMayRemainHeld", pidfdHeld],
    ["directChildWaitAuthorityMayRemain", waitHeld],
  ]);
}

function replaySummaryResult(target, summary, expectedHead, hasCurrentAnchor) {
  const targetAssociation = targetBrands.get(target);
  const latestState = summary.latestAttemptState;
  const status =
    latestState === "RECOVERED_LOCATION_OBSERVED"
      ? "COMPLETE_RECOVERED_REPLAYED"
      : latestState === "QUARANTINED_LOCATION_OBSERVED"
        ? "COMPLETE_QUARANTINED_REPLAYED"
        : summary.anchoredEmptyAttemptCount > 0 &&
            summary.finalizedAttemptCount +
              summary.anchoredEmptyAttemptCount ===
              summary.attemptCount &&
            latestState === null
          ? "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED"
          : "VALID_RECOVERY_PREFIX_REPLAYED";
  let nextRequiredState = null;
  if (summary.latestAttempt !== null && latestState !== null) {
    const states = statesForAttempt(summary.latestAttempt, target);
    nextRequiredState = states.at(Number(summary.latestRecoveryRecordSequence));
    if (nextRequiredState === undefined) nextRequiredState = null;
  }
  const terminal =
    status === "COMPLETE_RECOVERED_REPLAYED" ||
    status === "COMPLETE_QUARANTINED_REPLAYED";
  return replayResult([
    ["schema", CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_SCHEMA_V1],
    [
      "requirementsSha256",
      CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
    ],
    ["status", status],
    ["targetSha256", target.targetSha256],
    ["attemptCount", summary.attemptCount],
    ["finalizedAttemptCount", summary.finalizedAttemptCount],
    ["anchoredEmptyAttemptCount", summary.anchoredEmptyAttemptCount],
    ["recordCount", summary.recordCount],
    ["latestRecoveryActorEpochSha256", summary.latestRecoveryActorEpochSha256],
    ["latestAttemptDirectoryName", summary.latestAttemptDirectoryName],
    ["latestRecoveryRecordSequence", summary.latestRecoveryRecordSequence],
    ["latestRecoveryRecordRawSha256", summary.latestRecoveryRecordRawSha256],
    ["latestAttemptState", latestState],
    ["latestFinalizedRecoveryState", summary.latestFinalizedRecoveryState],
    [
      "derivedPriorEffectOutcomeCertain",
      summary.derivedPriorEffectOutcomeCertain,
    ],
    [
      "latestExpectedCurrentBootIdSha256",
      summary.latestAnchor.expectedCurrentBootIdSha256,
    ],
    [
      "latestExpectedDelegatedRootIdentitySha256",
      summary.latestAnchor.expectedDelegatedRootIdentitySha256,
    ],
    [
      "latestExpectedLifetimeCgroupIdentitySha256",
      summary.latestAnchor.expectedLifetimeCgroupIdentitySha256,
    ],
    [
      "liveBirthActorStillPermitted",
      summary.latestAnchor.actorKind === "LIVE_BIRTH_GUARDIAN" &&
        summary.latestAnchor.expectedCurrentBootIdSha256 ===
          target.bootIdSha256 &&
        targetAssociation.liveBirthActorStillPermitted,
    ],
    ["commandDescriptorMayRemainHeld", summary.commandDescriptorMayRemainHeld],
    ["statusDescriptorMayRemainHeld", summary.statusDescriptorMayRemainHeld],
    ["supervisorPidfdMayRemainHeld", summary.supervisorPidfdMayRemainHeld],
    [
      "directChildWaitAuthorityMayRemain",
      summary.directChildWaitAuthorityMayRemain,
    ],
    ["nextRequiredState", nextRequiredState],
    ["inheritedTerminalDecision", summary.inheritedTerminalDecision],
    ["decisionSourceLocation", summary.decisionSourceLocation],
    ["internalHashChainValidated", true],
    ["targetBindingsMatched", true],
    ["lifetimeAnchorBindingsMatched", true],
    [
      "lifecycleInventoryBindingsMatched",
      summary.finalizedAttemptCount > 0 ? true : null,
    ],
    [
      "recordPlanBindingsMatched",
      summary.finalizedAttemptCount > 0 ? true : null,
    ],
    ["externalTailHeadMatched", expectedHead === null ? null : true],
    ["tailCompletenessExternallyAnchored", expectedHead !== null],
    ["stateRootIdentityAnchorMatched", true],
    ["bootIdentityRelationshipsValidated", true],
    ["delegatedRootIdentityRelationshipsValidated", true],
    ["lifetimeCgroupIdentityAnchorsMatched", true],
    ["tailDeletionExcludedByInternalReplay", false],
    ["suppliedAnchorOriginProven", false],
    ["chainTerminal", terminal],
    ["authority", CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1],
    ["nonclaims", CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1],
    ["physicalFacts", CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1],
  ]);
}
