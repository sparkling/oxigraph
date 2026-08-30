import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FIXTURE_SCHEMAS,
  RecoveryLifetimeFixture,
  ZERO_SHA256,
  artifact,
  canonicalJson,
  digest,
  forkJournalBundleChain,
  independentlyDeriveRecoveryTargetFromFixtureArtifacts,
  jsonLine,
  opaque,
  plain,
  probeExactRecordNoSortContractV1,
  recoveryExternalHead,
  semanticSha256,
  sha256,
} from "./candidate-containment-guardian-recovery-v1.fixture.mjs";

const RECOVERY_SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-recovery-v1.mjs",
  import.meta.url,
);
const RECOVERY_SOURCE_PATH = fileURLToPath(RECOVERY_SOURCE_URL);

const SCHEMAS = Object.freeze({
  target: "oxigraph.candidate-containment-recovery-target/v1",
  inventory: "oxigraph.candidate-containment-recovery-inventory-observation/v1",
  attempt: "oxigraph.candidate-containment-recovery-attempt/v1",
  anchoredEmpty:
    "oxigraph.candidate-containment-recovery-anchored-empty-attempt/v1",
  lifetimeTarget:
    "oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1",
  lifetimeAnchor:
    "oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1",
  normalClose:
    "oxigraph.candidate-containment-lifetime-normal-close-receipt-projection/v1",
  plan: "oxigraph.candidate-containment-recovery-plan/v1",
  record: "oxigraph.candidate-containment-recovery-record/v1",
  replay: "oxigraph.candidate-containment-recovery-replay/v1",
  externalHead: "oxigraph.candidate-containment-recovery-external-head/v1",
  requirements: "oxigraph.candidate-containment-recovery-requirements/v1",
  manifest: "oxigraph.candidate-containment-guardian-generation-manifest/v2",
  bundle: "oxigraph.candidate-containment-guardian-journal-bundle/v2",
});

const VALUE_EXPORTS = Object.freeze([
  "CANDIDATE_CONTAINMENT_RECOVERY_TARGET_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_INVENTORY_OBSERVATION_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_ANCHORED_EMPTY_ATTEMPT_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_PLAN_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_RECORD_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SCHEMA_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_SEQUENCE_STARTS_AT_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_SEQUENCE_WIDTH_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_MAX_ATTEMPTS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_PER_ATTEMPT_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_ACROSS_ATTEMPTS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_MAX_CONTROL_VALUE_BYTES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_MAX_OPERATION_OR_EVIDENCE_BYTES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_MAX_AGGREGATE_RECORD_BYTES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_GENESIS_RAW_SHA256_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_ENTRY_KINDS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_RESULTS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_DIRECTORY_STATES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SOURCE_LOCATIONS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_STATUSES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITION_SELECTION_PRECEDENCE_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_UNRESOLVED_EFFECT_INTENT_STATES_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1",
  "CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1",
]);

const FUNCTION_EXPORTS = Object.freeze([
  "deriveCandidateContainmentRecoveryTargetProjectionV1",
  "createCandidateContainmentRecoveryTargetV1",
  "verifyCandidateContainmentRecoveryTargetV1",
  "createCandidateContainmentRecoveryInventoryObservationV1",
  "verifyCandidateContainmentRecoveryInventoryObservationV1",
  "planCandidateContainmentRecoveryV1",
  "createCandidateContainmentRecoveryAttemptV1",
  "verifyCandidateContainmentRecoveryAttemptV1",
  "createCandidateContainmentRecoveryAnchoredEmptyAttemptV1",
  "verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1",
  "createCandidateContainmentRecoveryRecordV1",
  "verifyCandidateContainmentRecoveryRecordV1",
  "replayCandidateContainmentRecoveryV1",
]);

const ACTOR_KINDS = Object.freeze([
  "LIVE_BIRTH_GUARDIAN",
  "RECOVERY_ONLY_GUARDIAN",
]);
const ENTRY_KINDS = Object.freeze([
  "ANCHORED_EMPTY_ATTEMPT",
  "FINALIZED_ATTEMPT",
]);
const EXTERNAL_HEAD_RESULTS = Object.freeze([
  "NO_RECOVERY_ATTEMPT",
  "ANCHORED_EMPTY_ATTEMPT",
  "FINALIZED_ATTEMPT_PREFIX",
  "RECOVERED",
  "QUARANTINED",
]);
const ATTEMPT_DIRECTORY_STATES = Object.freeze(["ABSENT", "PRESENT_EMPTY"]);
const SOURCE_LOCATIONS = Object.freeze([
  "staging",
  "active",
  "closed",
  "recovered",
  "quarantined",
]);
const ATTEMPT_SOURCE_LOCATIONS = Object.freeze([
  "staging",
  "active",
  "recovered",
  "quarantined",
]);
const DISPOSITIONS = Object.freeze([
  "GENESIS_ABORT",
  "SAME_BOOT_RECONCILE",
  "REBOOT_INTERRUPTION",
  "QUARANTINE",
  "RECOVERED_DECISION_RESUME",
  "QUARANTINE_DECISION_RESUME",
]);
const QUARANTINE_REASONS = Object.freeze([
  "UNKNOWN_BOOT_ID",
  "DELEGATED_ROOT_IDENTITY_UNKNOWN_OR_DRIFTED",
  "UNSAFE_CGROUP_INVENTORY",
  "INCONSISTENT_GENERATION_STATE",
  "UNSUPPORTED_RECOVERY_INTERFACE",
  "RECOVERY_EFFECT_UNCERTAIN",
]);
const RECORD_STATES = Object.freeze([
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
const PLAN_STATUSES = Object.freeze([
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
const REPLAY_STATUSES = Object.freeze([
  "NO_RECOVERY_ATTEMPT",
  "VALID_RECOVERY_PREFIX_REPLAYED",
  "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED",
  "COMPLETE_RECOVERED_REPLAYED",
  "COMPLETE_QUARANTINED_REPLAYED",
]);
const DISPOSITION_PRECEDENCE = Object.freeze([
  "PRE_ACTOR_REJECTION",
  "STATE_FILESYSTEM_INTERFACE_REJECTION",
  "NORMAL_STATE_18",
  "RECOVERY_LOCATION_TERMINAL",
  "ATTEMPT_LIMIT",
  "INHERITED_RECOVERED_DECISION",
  "INHERITED_QUARANTINE_DECISION",
  "FRESH_DISPOSITION",
]);
const UNRESOLVED_EFFECT_INTENTS = Object.freeze([
  "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
  "CONTROL_KILL_INTENT_DURABLE",
  "JOB_FIRST_KILL_INTENT_DURABLE",
  "JOB_SECOND_KILL_INTENT_DURABLE",
  "SUPERVISOR_REAP_INTENT_DURABLE",
  "CGROUP_REMOVAL_INTENT_DURABLE",
]);

const AUTHORITY_KEYS = Object.freeze([
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
const NONCLAIM_KEYS = Object.freeze([
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
const NULL_PHYSICAL_FACT_KEYS = Object.freeze([
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

const EXPECTED_AUTHORITY = Object.freeze(
  Object.fromEntries(AUTHORITY_KEYS.map((key) => [key, false])),
);
const EXPECTED_NONCLAIMS = Object.freeze(
  Object.fromEntries(NONCLAIM_KEYS.map((key) => [key, false])),
);
const EXPECTED_PHYSICAL_FACTS = Object.freeze({
  ...Object.fromEntries(NULL_PHYSICAL_FACT_KEYS.map((key) => [key, null])),
  physicalEligibility: false,
  finalDecisionEligibility: false,
  productionContainment: false,
});

const RULES = Object.freeze({
  normalHeadCgroupPresenceMatrix:
    "null:00;1:00;2:00|10|01|11;3-14:11;15:00|10|01|11;16-18:00",
  normalDescriptorMatrix:
    "null|1-3:0000;4:command-any,status-any,unreaped-pidfd-wait-00|11,reaped-pidfd-wait-00|10;5-12:command-any,status-any,unreaped-pidfd-wait-11,reaped-pidfd-wait-00|10;13-16:command-any,status-any,pidfd-wait-00|10;17-18:0000;recovery-only:0000/v1",
  targetHeadRule: "all-four-null-genesis-or-all-four-verified-v2-head/v1",
  targetProjectionRule:
    "derive-unbranded-from-reverified-manifest-and-complete-journal;create-or-verify-target-requires-exact-complete-tail-lifetime-selector-pair;all-projection-fields-match/v1",
  targetUniquenessRule:
    "lifetime-replay-enforces-one-target-per-generation-identity-and-no-target-sha-reuse-across-identities/v1",
  boundarySetAssertionRule:
    "target-required;historical-anchor-carriers-dense-ledger-order-and-brand-nested-projection-plus-raw;optional-current-carrier-head-close;same-originating-replay-instance;current-anchor-predecessor-equals-external-head;byte-equal-cross-replay-rejects/v1",
  firstAttemptPredecessorRule:
    "null-actor-null-directory-null-sequence-zero-raw/v1",
  emptyAttemptHeadRule:
    "nonnull-actor-nonnull-directory-null-sequence-zero-raw/v1",
  decisionInheritance:
    "first-terminal-decision-is-transitive-and-irreversible/v1",
  decisionSourceRule:
    "fresh-plan:decision-source-equals-singleton-staging-or-active;first-durable-decision-freezes-source;resume-current-location-is-exactly-decision-source-or-matching-destination;destination-only-syncs-and-reobserves-decision-source-parent-plus-destination/v1",
  actorLineageRule:
    "live-birth-only-on-target-boot-before-any-recovery-only-or-reboot;proved-boot-boundary-always-recovery-only;recovery-only-never-live-birth/v1",
  descriptorLineageRule:
    "consecutive-live-birth-held-booleans-only-true-to-false;command-close-clears-command;reap-clears-wait;recovery-only-or-reboot-clears-all/v1",
  bootLifetimeTransitionRule:
    "same-boot-repeats-current-identities;each-proved-reboot-consumes-distinct-recovery-lifetime;later-entries-repeat-that-boots-identities/v1",
  bootIdentityRelationshipRule:
    "same-boot-effect-branch:report-equals-current-and-target;proved-reboot-or-required-resume:report-equals-current;quarantine-or-quarantine-resume:exact-adverse-relation-validated/v1",
  delegatedRootIdentityRelationshipRule:
    "same-boot-effect-branch:report-and-current-equal-target;proved-reboot-or-required-resume:report-equals-current;quarantine-or-quarantine-resume:exact-null-mismatch-or-current-relation-validated/v1",
  pidfdObservationRule:
    "reap-proven-from-normal-state13plus-or-recovery-reaped;held-and-not-reap-proven:readable-and-wait-required;held-and-reap-proven:hup-and-no-wait;not-held:none;held-no-wait-without-reap-proof:inconsistent/v1",
  recoveryPrefixCgroupPresenceRule:
    "before-removal-intent:normal-matrix-no-reappearance;after-removal-intent:present-to-absent-only;after-paths-absent:00/v1",
  selectedInterfaceRule:
    "recovery-interface-means-selected-nonfilesystem-descriptor-pidfd-wait-or-delegated-cgroup-interface;filesystem-only-resume-may-report-false/v1",
  stateFilesystemGateRule:
    "false-before-state18-terminal-anchor-or-ready:no-new-anchor-or-actor-launch-or-attempt-record-quarantine-close-or-generation-move;supplied-durable-anchor-preserved;after-restore-exact-pre-temp-absent-or-empty-finalizes-anchored-empty;temp-or-other-residue-remains-unsafe/v1",
  twoPhaseAnchorRule:
    "phase1-anchor-required-with-no-context;durable-lifetime-prelaunch-anchor;phase2-reobserve-and-match-before-ready;anchor-without-record1-finalizes-anchored-empty-only-from-exact-residue-free-absent-or-empty-pre-temp-observation;temp-or-other-residue-blocks-or-quarantines;actor-never-reused/v1",
  state18CloseReceiptRule:
    "active-or-unreceipted-closed:close-move-required;receipt-branded-exact-target-dual-parent-sync-and-reobserve:closed-location-observed/v1",
  generationMoveOrderingRule:
    "decision-or-adoption-durable;rename-noreplace-from-immutable-decision-source-or-destination-only;sync-decision-source-and-destination-parents;reobserve-decision-source-absence-and-destination-identity;location-record-durable/v1",
  operationAndEvidencePayloadShape: "opaque-bounded-canonical-json",
  dispositionRelationshipMatrix:
    "GENESIS_ABORT=source:staging|active,decision-source:source,head:null,boot:target,cgroup:00;SAME_BOOT_RECONCILE=source:active,decision-source:source,head:1-17,boot:target,root:target-and-current,cgroup:normal-matrix;REBOOT_INTERRUPTION=source-head-pairs:[(staging,null),(active,null),(active,1-17)],decision-source:source,boot:different-proved,actor:recovery-only,cgroup:00,descriptors:0000;QUARANTINE=source:staging|active,target-and-predecessor:valid,decision-source:source,state-root-and-lifetime:exact,inherited:none,predicate:first-true;RECOVERED_DECISION_RESUME=inherited:recovered,terminal-location:false,decision-source:ancestor,current-source:decision-source|recovered,cgroup:00;QUARANTINE_DECISION_RESUME=inherited:quarantined,terminal-location:false,decision-source:ancestor,current-source:decision-source|quarantined,delegated-effects:none/v1",
  quarantinePredicateRule:
    "boot-null-or-applicable-current-mismatch>delegated-null-or-applicable-current-mismatch-or-same-boot-target-drift>unsafe-cgroup-inventory>disposition-presence-or-descriptor-mismatch>selected-nonfilesystem-interface-unavailable>prior-effect-uncertain/v1",
  lifecycleInventoryBlockRule:
    "malformed-or-corrupt:reject-before-plan;zero-or-multiple-or-unsafe-entry:unsafe-filesystem-inventory-blocked;one-safe-source-required-before-durable-quarantine/v1",
});

const EXPECTED_REQUIREMENTS = Object.freeze({
  schema: SCHEMAS.requirements,
  targetSchema: SCHEMAS.target,
  inventoryObservationSchema: SCHEMAS.inventory,
  lifetimeTargetProjectionSchema: SCHEMAS.lifetimeTarget,
  lifetimeAnchorProjectionSchema: SCHEMAS.lifetimeAnchor,
  normalCloseReceiptProjectionSchema: SCHEMAS.normalClose,
  attemptSchema: SCHEMAS.attempt,
  anchoredEmptyAttemptSchema: SCHEMAS.anchoredEmpty,
  planSchema: SCHEMAS.plan,
  recordSchema: SCHEMAS.record,
  replayEntryKinds: ENTRY_KINDS,
  replaySchema: SCHEMAS.replay,
  externalHeadSchema: SCHEMAS.externalHead,
  externalHeadResults: EXTERNAL_HEAD_RESULTS,
  generationManifestSchema: SCHEMAS.manifest,
  journalBundleSchema: SCHEMAS.bundle,
  journalV1RequirementsSha256:
    "e76b54712178631c51eb90a8c46ce0bae29b9a0d66b25ada937566d65cf91bb4",
  journalV2RequirementsSha256:
    "95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26",
  lifetimeV1RequirementsSha256:
    "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773",
  lifetimeBoundaryBrandProtocol:
    "complete-tail-matched-lifetime-replay-weakmap-pair-brand/v1",
  authoritySha256:
    "78686a3bbe489195cc38f1c310bace5a9c072a61ce5aee60e55f11b4e6933375",
  nonclaimsSha256:
    "61d5c451f7899f231fbc5f591f31533db2eac303a200dd4950f198d859ad82e3",
  physicalFactsSha256:
    "6e726852d68ab2e45ba36db8f97ae37a8fcd9495897934b48efeb10b89ed89a9",
  recordFilename: "<16-digit-sequence>-<record-raw-sha256>.jsonl",
  embeddedBytesEncoding: "rfc4648-canonical-padded-base64",
  rawHashAlgorithm: "sha256-canonical-jsonl-with-final-lf/v1",
  semanticHashAlgorithm: "sha256-canonical-json-without-final-lf/v1",
  bindingHashAlgorithm: "sha256-canonical-binding-json-without-final-lf/v1",
  sequenceStartsAt: 1,
  sequenceWidth: 16,
  maximumAttempts: 4,
  maximumRecordsPerAttempt: 24,
  maximumRecordsAcrossAttempts: 96,
  maximumControlValueBytes: 16384,
  maximumOperationOrEvidenceBytes: 16384,
  maximumRecordBytes: 65536,
  maximumAggregateRecordBytes: 6291456,
  genesisRawSha256: ZERO_SHA256,
  actorKinds: ACTOR_KINDS,
  attemptDirectoryStates: ATTEMPT_DIRECTORY_STATES,
  sourceLocations: SOURCE_LOCATIONS,
  attemptSourceLocations: ATTEMPT_SOURCE_LOCATIONS,
  dispositions: DISPOSITIONS,
  quarantineReasons: QUARANTINE_REASONS,
  recordStates: RECORD_STATES,
  planStatuses: PLAN_STATUSES,
  replayStatuses: REPLAY_STATUSES,
  normalHeadCgroupPresenceMatrix: RULES.normalHeadCgroupPresenceMatrix,
  normalDescriptorMatrix: RULES.normalDescriptorMatrix,
  targetHeadRule: RULES.targetHeadRule,
  targetProjectionRule: RULES.targetProjectionRule,
  targetUniquenessRule: RULES.targetUniquenessRule,
  boundarySetAssertionRule: RULES.boundarySetAssertionRule,
  firstAttemptPredecessorRule: RULES.firstAttemptPredecessorRule,
  emptyAttemptHeadRule: RULES.emptyAttemptHeadRule,
  lifetimeTargetBrandRequired: true,
  lifetimeAnchorRequiredPerAttempt: true,
  twoPhaseRecoveryPlanning: true,
  externalHeadBrandRequired: true,
  normalCloseReceiptBrandRequired: true,
  externalTailHeadOptional: true,
  externalTailHeadRequiredForPlanHandoff: true,
  decisionInheritance: RULES.decisionInheritance,
  decisionSourceRule: RULES.decisionSourceRule,
  dispositionSelectionPrecedence: DISPOSITION_PRECEDENCE,
  dispositionRelationshipMatrix: RULES.dispositionRelationshipMatrix,
  quarantineReasonPrecedence: QUARANTINE_REASONS,
  quarantinePredicateRule: RULES.quarantinePredicateRule,
  lifecycleInventoryBlockRule: RULES.lifecycleInventoryBlockRule,
  actorLineageRule: RULES.actorLineageRule,
  descriptorLineageRule: RULES.descriptorLineageRule,
  bootLifetimeTransitionRule: RULES.bootLifetimeTransitionRule,
  bootIdentityRelationshipRule: RULES.bootIdentityRelationshipRule,
  delegatedRootIdentityRelationshipRule:
    RULES.delegatedRootIdentityRelationshipRule,
  unresolvedEffectIntentStates: UNRESOLVED_EFFECT_INTENTS,
  pidfdObservationRule: RULES.pidfdObservationRule,
  recoveryPrefixCgroupPresenceRule: RULES.recoveryPrefixCgroupPresenceRule,
  selectedInterfaceRule: RULES.selectedInterfaceRule,
  stateFilesystemGateRule: RULES.stateFilesystemGateRule,
  twoPhaseAnchorRule: RULES.twoPhaseAnchorRule,
  state18CloseReceiptRule: RULES.state18CloseReceiptRule,
  generationMoveOrderingRule: RULES.generationMoveOrderingRule,
  operationAndEvidencePayloadShape: RULES.operationAndEvidencePayloadShape,
  operationAndEvidenceSemanticsInterpreted: false,
  standaloneRecordHashChainValidated: false,
  tailDeletionExcludedByInternalReplay: false,
  suppliedAnchorOriginProven: false,
  filesystemMechanicsImplemented: false,
  filesystemInventoryValidationImplemented: false,
  pureLifetimeContractIntegrated: true,
  lifetimeLedgerFilesystemMechanicsImplemented: false,
  recoveryMutationImplemented: false,
  guardianImplemented: false,
  supervisorExecutionProven: false,
  applicationReceiptPermitted: false,
  runtimeRegistrationPermitted: false,
  qualificationPermitted: false,
  promotionPermitted: false,
  publicationPermitted: false,
});

const EXPECTED_REQUIREMENTS_SHA256 =
  "278031a43b331036e6c849f796d480e7fe680219d07bdb5b30185668a9337c5a";
const EXPECTED_REQUIREMENTS_ENCODED_LITERALS = Object.freeze([
  Buffer.from(EXPECTED_REQUIREMENTS_SHA256, "utf8").toString("base64"),
  Buffer.from(EXPECTED_REQUIREMENTS_SHA256, "utf8").toString("base64url"),
]);

const TARGET_KEYS = Object.freeze([
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
const INVENTORY_KEYS = Object.freeze([
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
const PLAN_KEYS = Object.freeze([
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
const ATTEMPT_KEYS = Object.freeze([
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
const ANCHORED_EMPTY_KEYS = Object.freeze([
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
const RECORD_WRAPPER_KEYS = Object.freeze([
  "bytes",
  "name",
  "rawSha256",
  "semanticSha256",
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
  "standaloneRecordHashChainValidated",
  "planValidated",
  "embeddedArtifactBindingsValidated",
]);
const REPLAY_KEYS = Object.freeze([
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

const PLAN_STATES = Object.freeze({
  GENESIS_ABORT: Object.freeze([
    "RECOVERY_ATTEMPT_DURABLE",
    "GENESIS_ABORT_RECOVERY_REQUIRED",
    "CGROUP_PATHS_ABSENT_OBSERVED",
    "RECOVERED_TOMBSTONE_DURABLE",
    "RECOVERED_LOCATION_OBSERVED",
  ]),
  SAME_BOOT_RECONCILE_MAXIMUM: Object.freeze([
    "RECOVERY_ATTEMPT_DURABLE",
    "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
    "COMMAND_DESCRIPTOR_CLOSED_OBSERVED",
    "CONTROL_KILL_INTENT_DURABLE",
    "CONTROL_KILL_WRITE_COMPLETED",
    "JOB_FIRST_KILL_INTENT_DURABLE",
    "JOB_FIRST_KILL_WRITE_COMPLETED",
    "CONTROL_QUIESCENT_OBSERVED",
    "JOB_SECOND_KILL_INTENT_DURABLE",
    "JOB_SECOND_KILL_WRITE_COMPLETED",
    "JOB_QUIESCENT_OBSERVED",
    "STATUS_EOF_OBSERVED",
    "SUPERVISOR_PIDFD_READABLE_OBSERVED",
    "SUPERVISOR_REAP_INTENT_DURABLE",
    "SUPERVISOR_REAPED_OBSERVED",
    "CGROUP_REMOVAL_INTENT_DURABLE",
    "CGROUP_PATHS_ABSENT_OBSERVED",
    "RECOVERED_TOMBSTONE_DURABLE",
    "RECOVERED_LOCATION_OBSERVED",
  ]),
  REBOOT_INTERRUPTION: Object.freeze([
    "RECOVERY_ATTEMPT_DURABLE",
    "REBOOT_INTERRUPTION_OBSERVED",
    "CGROUP_PATHS_ABSENT_OBSERVED",
    "RECOVERED_TOMBSTONE_DURABLE",
    "RECOVERED_LOCATION_OBSERVED",
  ]),
  QUARANTINE: Object.freeze([
    "RECOVERY_ATTEMPT_DURABLE",
    "QUARANTINE_INTENT_DURABLE",
    "QUARANTINED_LOCATION_OBSERVED",
  ]),
  RECOVERED_DECISION_RESUME: Object.freeze([
    "RECOVERY_ATTEMPT_DURABLE",
    "RECOVERED_TOMBSTONE_ADOPTED",
    "RECOVERED_LOCATION_OBSERVED",
  ]),
  QUARANTINE_DECISION_RESUME: Object.freeze([
    "RECOVERY_ATTEMPT_DURABLE",
    "QUARANTINE_INTENT_ADOPTED",
    "QUARANTINED_LOCATION_OBSERVED",
  ]),
});

function assertNullPrototypeFrozen(value) {
  const visit = (current, recordWrapperRoot = false) => {
    if (
      current === null ||
      typeof current !== "object" ||
      ArrayBuffer.isView(current)
    ) {
      return;
    }
    assert.equal(Object.isFrozen(current), true);
    const ownKeys = Reflect.ownKeys(current);
    assert.equal(
      ownKeys.some((key) => typeof key === "symbol"),
      false,
    );
    if (Array.isArray(current)) {
      assert.deepEqual(
        Object.keys(current),
        current.map((_, index) => String(index)),
      );
      assert.deepEqual(ownKeys, [...Object.keys(current), "length"]);
      for (const key of Object.keys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        assert.equal(Object.hasOwn(descriptor, "value"), true);
        assert.equal(descriptor.enumerable, true);
        assert.equal(descriptor.configurable, false);
        assert.equal(descriptor.writable, false);
        visit(descriptor.value, false);
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(
        current,
        "length",
      );
      assert.equal(lengthDescriptor.enumerable, false);
      assert.equal(lengthDescriptor.configurable, false);
      assert.equal(lengthDescriptor.writable, false);
      return;
    }
    assert.equal(Object.getPrototypeOf(current), null);
    assert.deepEqual(ownKeys, Object.keys(current));
    for (const key of Object.keys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      assert.equal(descriptor.enumerable, true);
      assert.equal(descriptor.configurable, false);
      if (recordWrapperRoot && key === "bytes") {
        assert.equal(Object.hasOwn(descriptor, "value"), false);
        assert.equal(typeof descriptor.get, "function");
        assert.equal(descriptor.set, undefined);
        const bytes = descriptor.get.call(current);
        assert.equal(Buffer.isBuffer(bytes), true);
      } else {
        assert.equal(Object.hasOwn(descriptor, "value"), true);
        assert.equal(descriptor.writable, false);
        visit(descriptor.value, false);
      }
    }
  };
  visit(
    value,
    value?.schema === SCHEMAS.record &&
      Reflect.ownKeys(value).includes("bytes"),
  );
}

function assertBoundarySummary(value) {
  assert.deepEqual(plain(value.authority), EXPECTED_AUTHORITY);
  assert.deepEqual(plain(value.nonclaims), EXPECTED_NONCLAIMS);
  assert.deepEqual(plain(value.physicalFacts), EXPECTED_PHYSICAL_FACTS);
  assertNullPrototypeFrozen(value);
}

function assertExactPlanResult(plan, expectedFields) {
  const semanticKeys = PLAN_KEYS.slice(0, -3);
  assert.deepEqual(Object.keys(expectedFields), semanticKeys);
  assert.deepEqual(plain(plan), {
    ...expectedFields,
    authority: EXPECTED_AUTHORITY,
    nonclaims: EXPECTED_NONCLAIMS,
    physicalFacts: EXPECTED_PHYSICAL_FACTS,
  });
  assertBoundarySummary(plan);
}

function assertExactReplayResult(replay, expectedFields) {
  const semanticKeys = REPLAY_KEYS.slice(0, -3);
  assert.deepEqual(Object.keys(expectedFields), semanticKeys);
  assert.deepEqual(plain(replay), {
    ...expectedFields,
    authority: EXPECTED_AUTHORITY,
    nonclaims: EXPECTED_NONCLAIMS,
    physicalFacts: EXPECTED_PHYSICAL_FACTS,
  });
  assertBoundarySummary(replay);
}

function expectedReplayFields(targetSha256, overrides = {}) {
  return Object.assign(
    {
      schema: SCHEMAS.replay,
      requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
      status: "NO_RECOVERY_ATTEMPT",
      targetSha256,
      attemptCount: 0,
      finalizedAttemptCount: 0,
      anchoredEmptyAttemptCount: 0,
      recordCount: 0,
      latestRecoveryActorEpochSha256: null,
      latestAttemptDirectoryName: null,
      latestRecoveryRecordSequence: null,
      latestRecoveryRecordRawSha256: ZERO_SHA256,
      latestAttemptState: null,
      latestFinalizedRecoveryState: null,
      derivedPriorEffectOutcomeCertain: true,
      latestExpectedCurrentBootIdSha256: null,
      latestExpectedDelegatedRootIdentitySha256: null,
      latestExpectedLifetimeCgroupIdentitySha256: null,
      liveBirthActorStillPermitted: true,
      commandDescriptorMayRemainHeld: false,
      statusDescriptorMayRemainHeld: false,
      supervisorPidfdMayRemainHeld: false,
      directChildWaitAuthorityMayRemain: false,
      nextRequiredState: null,
      inheritedTerminalDecision: null,
      decisionSourceLocation: null,
      internalHashChainValidated: true,
      targetBindingsMatched: true,
      lifetimeAnchorBindingsMatched: null,
      lifecycleInventoryBindingsMatched: null,
      recordPlanBindingsMatched: null,
      externalTailHeadMatched: true,
      tailCompletenessExternallyAnchored: true,
      stateRootIdentityAnchorMatched: null,
      bootIdentityRelationshipsValidated: null,
      delegatedRootIdentityRelationshipsValidated: null,
      lifetimeCgroupIdentityAnchorsMatched: null,
      tailDeletionExcludedByInternalReplay: false,
      suppliedAnchorOriginProven: false,
      chainTerminal: false,
    },
    overrides,
  );
}

function expectedPlanFields(
  targetSha256,
  lifecycleInventorySha256,
  overrides = {},
) {
  return Object.assign(
    {
      schema: SCHEMAS.plan,
      requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
      status: "INCONSISTENT_GENERATION_STATE_BLOCKED",
      targetSha256,
      requiredActorKind: null,
      normalTailExternallyAnchored: true,
      recoveryTailExternallyAnchored: true,
      currentLifetimeAnchorMatched: false,
      disposition: null,
      quarantineReason: null,
      sourceLocation: null,
      decisionSourceLocation: null,
      requiredDestinationLocation: null,
      lifecycleInventorySha256,
      recoveryContext: null,
      inheritedTerminalDecision: null,
      latestAttemptState: null,
      latestFinalizedRecoveryState: null,
      nextPermittedRecordTypes: [],
      terminal: false,
      states: [],
      recordCount: 0,
    },
    overrides,
  );
}

function expectedRecoveryContext(actorKind, input) {
  return {
    actorKind,
    reportedCurrentBootIdSha256: input.reportedCurrentBootIdSha256,
    reportedStateRootIdentitySha256: input.reportedStateRootIdentitySha256,
    reportedDelegatedRootIdentitySha256:
      input.reportedDelegatedRootIdentitySha256,
    reportedLifetimeCgroupIdentitySha256:
      input.reportedLifetimeCgroupIdentitySha256,
    reportedCommandDescriptorHeld: input.reportedCommandDescriptorHeld,
    reportedStatusDescriptorHeld: input.reportedStatusDescriptorHeld,
    reportedSupervisorPidfdHeld: input.reportedSupervisorPidfdHeld,
    reportedDirectChildWaitAuthority: input.reportedDirectChildWaitAuthority,
    reportedCgroupInventorySafe: input.reportedCgroupInventorySafe,
    reportedControlCgroupPresent: input.reportedControlCgroupPresent,
    reportedJobCgroupPresent: input.reportedJobCgroupPresent,
    reportedStateFilesystemInterfaceAvailable:
      input.reportedStateFilesystemInterfaceAvailable,
    reportedRecoveryInterfaceAvailable:
      input.reportedRecoveryInterfaceAvailable,
    derivedPriorEffectOutcomeCertain:
      input.previousRecoveryReplay.derivedPriorEffectOutcomeCertain,
  };
}

function assertContractReject(callback) {
  assert.throws(callback);
}

function inventoryInput(generationIdentitySha256, location = "staging") {
  return {
    generationIdentitySha256,
    stagingPresent: location === "staging",
    activePresent: location === "active",
    closedPresent: location === "closed",
    recoveredPresent: location === "recovered",
    quarantinedPresent: location === "quarantined",
    unsafeEntriesPresent: false,
  };
}

function createInventory(fixture, location = "staging") {
  return recovery.createCandidateContainmentRecoveryInventoryObservationV1(
    inventoryInput(fixture.journal.generationIdentity.identitySha256, location),
  );
}

function replayInput(
  fixture,
  target,
  {
    entries = [],
    expectedExternalHead,
    currentAnchorSelection = null,
    currentAnchorPredecessorExternalHead = null,
    normalCloseDurabilityReceipt = null,
  },
) {
  return {
    target,
    entries,
    expectedStateRootIdentitySha256: fixture.stateRootIdentitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection:
      currentAnchorSelection?.lifetimeAnchorProjection ?? null,
    currentLifetimeAttemptAnchorRawSha256:
      currentAnchorSelection?.lifetimeAttemptAnchorRawSha256 ?? null,
    currentLifetimeAnchorPredecessorExternalHead:
      currentAnchorPredecessorExternalHead,
    normalCloseDurabilityReceipt,
  };
}

function planInput(
  fixture,
  target,
  inventory,
  previousRecoveryReplay,
  { phase = 1, anchorSelection = null, overrides = {} } = {},
) {
  const {
    requiredActorKind = fixture.lifetimeIdentity.lifetimeKind === "NORMAL"
      ? "LIVE_BIRTH_GUARDIAN"
      : "RECOVERY_ONLY_GUARDIAN",
    ...reportedOverrides
  } = overrides;
  return {
    target,
    lifecycleInventoryObservation: inventory,
    previousRecoveryReplay,
    normalCloseDurabilityReceipt: null,
    expectedStateRootIdentitySha256: fixture.stateRootIdentitySha256,
    expectedCurrentBootIdSha256: fixture.lifetimeContext.bootIdSha256,
    expectedDelegatedRootIdentitySha256:
      fixture.lifetimeContext.delegatedRootIdentitySha256,
    expectedLifetimeCgroupIdentitySha256:
      fixture.lifetimeContext.lifetimeCgroupIdentitySha256,
    proposedActorKind: phase === 1 ? requiredActorKind : null,
    reportedCurrentBootIdSha256: fixture.lifetimeContext.bootIdSha256,
    reportedStateRootIdentitySha256: fixture.stateRootIdentitySha256,
    reportedDelegatedRootIdentitySha256:
      fixture.lifetimeContext.delegatedRootIdentitySha256,
    reportedLifetimeCgroupIdentitySha256:
      fixture.lifetimeContext.lifetimeCgroupIdentitySha256,
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
      phase === 2 ? anchorSelection.lifetimeAnchorProjection : null,
    currentLifetimeAttemptAnchorRawSha256:
      phase === 2 ? anchorSelection.lifetimeAttemptAnchorRawSha256 : null,
    ...reportedOverrides,
  };
}

function buildGenesis(label, options = {}) {
  const fixture = new RecoveryLifetimeFixture(label, options);
  const target = fixture.installRecoveryTarget(recovery);
  const inventory = createInventory(fixture, options.location ?? "staging");
  const expectedExternalHead = fixture.headSelection();
  const zeroReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(fixture, target, { entries: [], expectedExternalHead }),
  );
  return {
    fixture,
    target,
    inventory,
    expectedExternalHead,
    zeroReplay,
    history: [],
  };
}

function brandedHistoryEntry(fixture, item) {
  const selection = fixture.anchorSelection(item.anchor);
  if (item.kind === "ANCHORED_EMPTY_ATTEMPT") {
    return {
      kind: item.kind,
      lifetimeAnchorProjection: selection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256: selection.lifetimeAttemptAnchorRawSha256,
      anchoredEmptyAttempt: item.anchoredEmptyAttempt,
      records: [],
    };
  }
  return {
    kind: "FINALIZED_ATTEMPT",
    lifetimeAnchorProjection: selection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256: selection.lifetimeAttemptAnchorRawSha256,
    attempt: item.attempt,
    records: item.records.map(artifact),
  };
}

function replayDurableHistory(
  context,
  { expectedExternalHead = context.fixture.headSelection() } = {},
) {
  const target = context.fixture.refreshTarget(recovery);
  const replay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, target, {
      entries: context.history.map((item) =>
        brandedHistoryEntry(context.fixture, item),
      ),
      expectedExternalHead,
    }),
  );
  return { ...context, target, zeroReplay: replay };
}

function addReadyAnchor(context, planOverrides = {}) {
  const { fixture, inventory } = context;
  const phaseOne = recovery.planCandidateContainmentRecoveryV1(
    planInput(fixture, context.target, inventory, context.zeroReplay, {
      overrides: planOverrides,
    }),
  );
  fixture.addAnchor(phaseOne.requiredActorKind);
  const anchor = fixture.currentAnchor;
  const target = fixture.refreshTarget(recovery);
  const anchorSelection = fixture.anchorSelection();
  const predecessorHead = fixture.headSelection();
  const replay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(fixture, target, {
      entries: context.history.map((item) =>
        brandedHistoryEntry(fixture, item),
      ),
      expectedExternalHead: predecessorHead,
      currentAnchorSelection: anchorSelection,
      currentAnchorPredecessorExternalHead: predecessorHead,
    }),
  );
  const plan = recovery.planCandidateContainmentRecoveryV1(
    planInput(fixture, target, inventory, replay, {
      phase: 2,
      anchorSelection,
      overrides: planOverrides,
    }),
  );
  return {
    ...context,
    target,
    anchor,
    phaseOne,
    anchorSelection,
    predecessorHead,
    replay,
    plan,
  };
}

function createAttempt(context) {
  const attempt = recovery.createCandidateContainmentRecoveryAttemptV1({
    target: context.target,
    lifecycleInventoryObservation: context.inventory,
    previousRecoveryReplay: context.replay,
    plan: context.plan,
    lifetimeAnchorProjection: context.anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      context.anchorSelection.lifetimeAttemptAnchorRawSha256,
  });
  return { ...context, attempt };
}

function createPlanRecords(context, count = context.plan.states.length) {
  if (
    context.anchor.actorKind === "RECOVERY_ONLY_GUARDIAN" &&
    !context.anchor.launched
  ) {
    context.fixture.appendRecoveryLaunchLineage(context.anchor);
  }
  const records = [];
  let previousRecord = null;
  for (const [index, state] of context.plan.states.slice(0, count).entries()) {
    const operationBytes = jsonLine(
      opaque(`${context.fixture.label}:${state}:operation`),
    );
    const evidenceBytes =
      index === 0
        ? jsonLine(plain(context.inventory))
        : jsonLine(opaque(`${context.fixture.label}:${state}:evidence`));
    const record = recovery.createCandidateContainmentRecoveryRecordV1({
      target: context.target,
      lifecycleInventoryObservation: context.inventory,
      previousRecoveryReplay: context.replay,
      plan: context.plan,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: context.attempt,
      previousRecord,
      operationBytes,
      evidenceBytes,
    });
    records.push(record);
    previousRecord = record;
  }
  return { ...context, records };
}

function assertExactRecordLineage(context) {
  assert.equal(context.records.length, context.plan.states.length);
  for (const [index, record] of context.records.entries()) {
    const expectedType = context.plan.states[index];
    assert.equal(record.recordType, expectedType);
    assert.equal(record.nextState, expectedType);
    assert.equal(record.priorState, context.plan.states[index - 1] ?? null);
    assert.equal(record.sequence, String(index + 1).padStart(16, "0"));
    assert.equal(
      record.previousRecordRawSha256,
      context.records[index - 1]?.rawSha256 ?? ZERO_SHA256,
    );
    assert.equal(record.targetSha256, context.target.targetSha256);
    assert.deepEqual(plain(record.attempt), plain(context.attempt));
  }
}

function replayCurrentAttemptPrefix(context, count) {
  const records = context.records.slice(0, count);
  const target = context.fixture.refreshTarget(recovery);
  const anchorSelection = context.fixture.anchorSelection(context.anchor);
  const predecessorHead = context.fixture.headSelection();
  return recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, target, {
      entries: [entryFrom({ ...context, target, records }, anchorSelection)],
      expectedExternalHead: null,
      currentAnchorSelection: anchorSelection,
      currentAnchorPredecessorExternalHead: predecessorHead,
    }),
  );
}

function entryFrom(context, anchorSelection = context.anchorSelection) {
  return {
    kind: "FINALIZED_ATTEMPT",
    lifetimeAnchorProjection: anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      anchorSelection.lifetimeAttemptAnchorRawSha256,
    attempt: context.attempt,
    records: context.records.map(artifact),
  };
}

function publishFinalizedAttempt(context, result) {
  const last = context.records.at(-1);
  if (
    context.anchor.actorKind === "RECOVERY_ONLY_GUARDIAN" &&
    !context.anchor.launched
  ) {
    context.fixture.appendRecoveryLaunchLineage(context.anchor);
  }
  const head = recoveryExternalHead({
    targetSha256: context.target.targetSha256,
    result,
    recoveryActorEpochSha256: context.attempt.recoveryActorEpochSha256,
    attemptDirectoryName: context.attempt.attemptDirectoryName,
    lifetimeAttemptAnchorRawSha256:
      context.attempt.lifetimeAttemptAnchorRawSha256,
    latestRecoveryRecordSequence: last.sequence,
    latestRecoveryRecordRawSha256: last.rawSha256,
  });
  context.fixture.appendResult(head);
  return replayDurableHistory({
    ...context,
    history: [
      ...context.history,
      {
        kind: "FINALIZED_ATTEMPT",
        anchor: context.anchor,
        attempt: context.attempt,
        records: context.records,
      },
    ],
  });
}

function publishAnchoredEmptyAttempt(context, reportedAttemptDirectoryState) {
  const anchoredEmptyAttempt =
    recovery.createCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
      target: context.target,
      previousRecoveryReplay: context.replay,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      reportedAttemptDirectoryState,
    });
  const head = recoveryExternalHead({
    targetSha256: context.target.targetSha256,
    result: "ANCHORED_EMPTY_ATTEMPT",
    recoveryActorEpochSha256: context.anchor.recoveryActorEpochSha256,
    attemptDirectoryName: context.anchor.attemptDirectoryName,
    lifetimeAttemptAnchorRawSha256:
      context.anchorSelection.lifetimeAttemptAnchorRawSha256,
    latestRecoveryRecordSequence: null,
    latestRecoveryRecordRawSha256: ZERO_SHA256,
  });
  context.fixture.appendResult(head, {
    managerWriter: context.anchor.actorKind === "RECOVERY_ONLY_GUARDIAN",
  });
  return replayDurableHistory({
    ...context,
    anchoredEmptyAttempt,
    history: [
      ...context.history,
      {
        kind: "ANCHORED_EMPTY_ATTEMPT",
        anchor: context.anchor,
        anchoredEmptyAttempt,
      },
    ],
  });
}

function recordDescriptor(kind, recordContext, bytes) {
  const artifactSchema = `oxigraph.candidate-containment-recovery-${kind}/${recordContext.recordType
    .toLowerCase()
    .replaceAll("_", "-")}/v1`;
  const rawSha256 = sha256(bytes);
  const semantic = semanticSha256(JSON.parse(bytes.toString("utf8")));
  const binding = {
    schema: `oxigraph.candidate-containment-recovery-${kind}-binding/v1`,
    kind,
    artifactSchema,
    sequence: recordContext.sequence,
    recordType: recordContext.recordType,
    priorState: recordContext.priorState,
    targetSha256: recordContext.targetSha256,
    attemptSha256: recordContext.attempt.attemptSha256,
    recoveryActorEpochSha256: recordContext.attempt.recoveryActorEpochSha256,
    previousRecordRawSha256: recordContext.previousRecordRawSha256,
    rawSha256,
    semanticSha256: semantic,
  };
  return {
    schema: artifactSchema,
    rawSha256,
    semanticSha256: semantic,
    bytesBase64: Buffer.from(bytes).toString("base64"),
    bindingSha256: semanticSha256(binding),
  };
}

function renamedRecoveryRecord(value) {
  const bytes = jsonLine(value);
  return {
    name: `${value.sequence}-${sha256(bytes)}.jsonl`,
    bytes,
  };
}

function createVerifiedChainValidSurplusRecord(context, previousRecord) {
  const sequence = String(Number(previousRecord.sequence) + 1).padStart(
    16,
    "0",
  );
  const recordType = previousRecord.recordType;
  const recordContext = {
    sequence,
    recordType,
    priorState: recordType,
    previousRecordRawSha256: previousRecord.rawSha256,
    targetSha256: context.target.targetSha256,
    attempt: context.attempt,
  };
  const operationBytes = Buffer.from(
    previousRecord.operation.bytesBase64,
    "base64",
  );
  const evidenceBytes = Buffer.from(
    previousRecord.evidence.bytesBase64,
    "base64",
  );
  const value = {
    schema: SCHEMAS.record,
    sequence,
    recordType,
    priorState: recordType,
    nextState: recordType,
    previousRecordRawSha256: previousRecord.rawSha256,
    targetSha256: context.target.targetSha256,
    attempt: plain(context.attempt),
    operation: recordDescriptor("operation", recordContext, operationBytes),
    evidence: recordDescriptor("evidence", recordContext, evidenceBytes),
  };
  const serialized = renamedRecoveryRecord(value);
  const verified =
    recovery.verifyCandidateContainmentRecoveryRecordV1(serialized);
  assert.equal(verified.name, serialized.name);
  assert.equal(verified.sequence, sequence);
  assert.equal(verified.recordType, recordType);
  assert.equal(verified.priorState, recordType);
  assert.equal(verified.nextState, recordType);
  assert.equal(verified.previousRecordRawSha256, previousRecord.rawSha256);
  assert.equal(verified.rawSha256, sha256(serialized.bytes));
  assert.equal(verified.semanticSha256, semanticSha256(value));
  assert.equal(verified.standaloneRecordHashChainValidated, false);
  assert.equal(verified.planValidated, false);
  assert.equal(verified.embeddedArtifactBindingsValidated, true);
  assert.equal(serialized.bytes.length <= 65_536, true);
  assertNullPrototypeFrozen(verified);
  return verified;
}

function mutatedJsonlArtifact(input, mutate, name = input.name) {
  const value = JSON.parse(input.bytes.toString("utf8"));
  mutate(value);
  return { name, bytes: jsonLine(value) };
}

function canonicalPayloadWithExactBytes(size) {
  const fixedBytes = Buffer.byteLength('{"data":""}\n', "utf8");
  assert.equal(size >= fixedBytes, true);
  const bytes = jsonLine({ data: "x".repeat(size - fixedBytes) });
  assert.equal(bytes.length, size);
  return bytes;
}

function changedContractField(value, key, label) {
  const copy = structuredClone(plain(value));
  const current = copy[key];
  if (current === null) {
    copy[key] = digest(`${label}:${key}:non-null`);
  } else if (typeof current === "boolean") {
    copy[key] = !current;
  } else if (typeof current === "number") {
    copy[key] = current + 1;
  } else if (typeof current === "string") {
    copy[key] = /^[0-9a-f]{64}$/u.test(current)
      ? `${current[0] === "0" ? "1" : "0"}${current.slice(1)}`
      : `${current}:evaluator-mutation`;
  } else if (Array.isArray(current)) {
    copy[key] = [...current, "EVALUATOR_SURPLUS"];
  } else {
    copy[key] = { ...plain(current), evaluatorUnexpectedField: true };
  }
  return copy;
}

function exactStructuralMutations(value, keys, label) {
  const canonical = plain(value);
  return [
    ...keys.map((key) => {
      const copy = structuredClone(canonical);
      delete copy[key];
      return { kind: `remove:${key}`, value: copy };
    }),
    {
      kind: "add:evaluatorUnexpectedField",
      value: { ...structuredClone(canonical), evaluatorUnexpectedField: true },
    },
    ...keys.map((key) => ({
      kind: `mutate:${key}`,
      value: changedContractField(canonical, key, label),
    })),
  ];
}

function assertVerifierNormalizesUnbrandedClone({
  label,
  value,
  keys,
  verify,
  downstream,
}) {
  const clone = structuredClone(plain(value));
  const normalized = verify(clone);
  assert.notEqual(normalized, value);
  assert.notEqual(normalized, clone);
  assert.deepEqual(plain(normalized), plain(value));
  assertNullPrototypeFrozen(normalized);
  assertContractReject(() => downstream(clone));
  downstream(normalized);
  for (const mutation of exactStructuralMutations(value, keys, label)) {
    assertContractReject(
      () => verify(mutation.value),
      `${label} verifier admitted ${mutation.kind}`,
    );
  }
  return normalized;
}

function refreshExternallyAnchoredReplay(context) {
  const target = context.fixture.refreshTarget(recovery);
  const expectedExternalHead = context.fixture.headSelection();
  const zeroReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, target, {
      entries: context.history.map((item) =>
        brandedHistoryEntry(context.fixture, item),
      ),
      expectedExternalHead,
    }),
  );
  return { ...context, target, expectedExternalHead, zeroReplay };
}

function assertAdmittedPlanCreatesAndReplaysEveryPrefix(context) {
  const complete = createPlanRecords(createAttempt(context));
  assertExactRecordLineage(complete);
  for (let count = 1; count <= complete.records.length; count++) {
    const replay = replayCurrentAttemptPrefix(complete, count);
    assert.equal(replay.recordCount, count);
    assert.equal(replay.latestAttemptState, complete.plan.states[count - 1]);
    assert.equal(replay.recordPlanBindingsMatched, true);
    assertBoundarySummary(replay);
  }
  return complete;
}

function buildPriorEffectUncertainPrefix(label, decisionSourceLocation) {
  const maximumFacts = {
    reportedCommandDescriptorHeld: true,
    reportedStatusDescriptorHeld: true,
    reportedSupervisorPidfdHeld: true,
    reportedDirectChildWaitAuthority: true,
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  };
  let context = addReadyAnchor(
    buildGenesis(`${label}-unresolved-effect`, {
      bundleCount: 5,
      location: "active",
    }),
    maximumFacts,
  );
  const intentRecordCount =
    context.plan.states.indexOf("COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE") + 1;
  assert.equal(intentRecordCount > 1, true);
  context = createPlanRecords(createAttempt(context), intentRecordCount);
  assert.equal(
    context.records.at(-1).recordType,
    "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
  );
  context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
  assert.equal(context.zeroReplay.inheritedTerminalDecision, null);
  assert.equal(context.zeroReplay.decisionSourceLocation, null);
  assert.equal(context.zeroReplay.derivedPriorEffectOutcomeCertain, false);
  assertBoundarySummary(context.zeroReplay);

  context.fixture.appendNormalTermination();
  context = replayDurableHistory(context);
  assert.equal(context.zeroReplay.derivedPriorEffectOutcomeCertain, false);
  context = {
    ...context,
    inventory: createInventory(context.fixture, decisionSourceLocation),
  };
  context = addReadyAnchor(context, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  });
  assert.equal(context.plan.disposition, "QUARANTINE");
  assert.equal(context.plan.quarantineReason, "RECOVERY_EFFECT_UNCERTAIN");
  assert.equal(context.replay.derivedPriorEffectOutcomeCertain, false);
  return context;
}

function buildInheritedDecisionPrefix(
  label,
  { decision, origin, rebootDepth = 0, priorEffectOutcomeUncertain = false },
) {
  assert.equal(
    priorEffectOutcomeUncertain === false || decision === "QUARANTINED",
    true,
  );
  const specification =
    decision === "RECOVERED"
      ? {
          initialOverrides: {},
          prefixCount: 4,
          durableState: "RECOVERED_TOMBSTONE_DURABLE",
        }
      : {
          initialOverrides: { reportedCurrentBootIdSha256: null },
          prefixCount: 2,
          durableState: "QUARANTINE_INTENT_DURABLE",
        };
  let context = priorEffectOutcomeUncertain
    ? buildPriorEffectUncertainPrefix(label, origin)
    : addReadyAnchor(
        buildGenesis(label, { location: origin }),
        specification.initialOverrides,
      );
  context = createPlanRecords(
    createAttempt(context),
    specification.prefixCount,
  );
  context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
  assert.equal(context.zeroReplay.inheritedTerminalDecision, decision);
  assert.equal(
    context.zeroReplay.latestAttemptState,
    specification.durableState,
  );
  assert.equal(
    context.zeroReplay.latestFinalizedRecoveryState,
    specification.durableState,
  );
  assert.equal(
    context.zeroReplay.derivedPriorEffectOutcomeCertain,
    !priorEffectOutcomeUncertain,
  );
  assertBoundarySummary(context.zeroReplay);
  if (rebootDepth > 0) {
    for (let index = 0; index < rebootDepth; index++) {
      context.fixture.startRebootRecovery();
    }
    context = refreshExternallyAnchoredReplay(context);
  } else {
    context.fixture.appendNormalTermination();
    context = replayDurableHistory(context);
  }
  assert.equal(
    context.zeroReplay.derivedPriorEffectOutcomeCertain,
    !priorEffectOutcomeUncertain,
  );
  assertBoundarySummary(context.zeroReplay);
  return { ...context, durableState: specification.durableState };
}

function assertExactReadyPlan(
  context,
  input,
  {
    plan = context.plan,
    inventory = context.inventory,
    actorKind,
    disposition,
    quarantineReason = null,
    sourceLocation,
    decisionSourceLocation,
    destinationLocation,
    states,
    inheritedTerminalDecision = null,
    latestAttemptState = null,
    latestFinalizedRecoveryState = null,
  },
) {
  assertExactPlanResult(
    plan,
    expectedPlanFields(context.target.targetSha256, inventory.inventorySha256, {
      status: "RECOVERY_PLAN_READY",
      requiredActorKind: actorKind,
      currentLifetimeAnchorMatched: true,
      disposition,
      quarantineReason,
      sourceLocation,
      decisionSourceLocation,
      requiredDestinationLocation: destinationLocation,
      recoveryContext: expectedRecoveryContext(actorKind, input),
      inheritedTerminalDecision,
      latestAttemptState,
      latestFinalizedRecoveryState,
      nextPermittedRecordTypes: ["RECOVERY_ATTEMPT_DURABLE"],
      states: [...states],
      recordCount: states.length,
    }),
  );
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1({
      ...input,
      evaluatorUnexpectedField: true,
    }),
  );
}

function lexModuleSource(source) {
  const tokens = [];
  let index = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  const push = (type, value, start, end) => {
    tokens.push({
      type,
      value,
      start,
      end,
      braceDepth,
      parenDepth,
      bracketDepth,
    });
  };
  const identifierStart = (character) =>
    character !== undefined && /[$_\p{ID_Start}]/u.test(character);
  const identifierPart = (character) =>
    character !== undefined &&
    /[$_\u200c\u200d\p{ID_Continue}]/u.test(character);
  const codePointAt = (position) => {
    if (position >= source.length) return null;
    const value = String.fromCodePoint(source.codePointAt(position));
    return { value, end: position + value.length };
  };
  const unicodeEscapeAt = (position) => {
    if (source[position] !== "\\" || source[position + 1] !== "u") return null;
    let cursor = position + 2;
    let hexadecimal;
    if (source[cursor] === "{") {
      const close = source.indexOf("}", cursor + 1);
      if (close === -1) throw new SyntaxError("unterminated Unicode escape");
      hexadecimal = source.slice(cursor + 1, close);
      if (!/^[0-9A-Fa-f]{1,6}$/u.test(hexadecimal))
        throw new SyntaxError("malformed Unicode escape");
      cursor = close + 1;
    } else {
      hexadecimal = source.slice(cursor, cursor + 4);
      if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal))
        throw new SyntaxError("malformed Unicode escape");
      cursor += 4;
    }
    const codePoint = Number.parseInt(hexadecimal, 16);
    if (codePoint > 0x10ffff)
      throw new SyntaxError("Unicode escape is outside scalar range");
    return { value: String.fromCodePoint(codePoint), end: cursor };
  };
  const escapedValue = () => {
    if (index >= source.length)
      throw new SyntaxError("unterminated evaluator escape");
    const next = source[index++];
    const simple = {
      0: "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      '"': '"',
      "'": "'",
      "`": "`",
      $: "$",
    };
    if (Object.hasOwn(simple, next)) return simple[next];
    if (next === "\n") return "";
    if (next === "\r") {
      if (source[index] === "\n") index++;
      return "";
    }
    if (next === "x") {
      const hexadecimal = source.slice(index, index + 2);
      if (!/^[0-9A-Fa-f]{2}$/u.test(hexadecimal))
        throw new SyntaxError("malformed hexadecimal escape");
      index += 2;
      return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    }
    if (next === "u") {
      index -= 2;
      const decoded = unicodeEscapeAt(index);
      index = decoded.end;
      return decoded.value;
    }
    return next;
  };
  const regexCanStartAfter = () => {
    const previous = tokens.at(-1);
    if (previous === undefined) return true;
    if (previous.type === "identifier") {
      if (
        previous.value === "of" &&
        isForOfSeparator(tokens, tokens.length - 1)
      ) {
        return true;
      }
      return new Set([
        "await",
        "case",
        "delete",
        "do",
        "else",
        "in",
        "instanceof",
        "return",
        "throw",
        "typeof",
        "void",
        "yield",
      ]).has(previous.value);
    }
    return new Set([
      "(",
      "[",
      "{",
      ",",
      ":",
      ";",
      "=",
      "!",
      "?",
      "+",
      "-",
      "*",
      "%",
      "&",
      "|",
      "^",
      "~",
      "<",
      ">",
    ]).has(previous.value);
  };

  const scanQuotedString = (quote) => {
    const start = index++;
    let value = "";
    while (index < source.length) {
      const character = source[index++];
      if (character === quote) {
        push("string", value, start, index);
        return;
      }
      if (character === "\n" || character === "\r") {
        throw new SyntaxError("unterminated evaluator string literal");
      }
      if (character === "\\") {
        value += escapedValue();
      } else {
        value += character;
      }
    }
    throw new SyntaxError("unterminated evaluator string literal");
  };

  const scanIdentifier = () => {
    const start = index;
    let value = "";
    let first = true;
    while (index < source.length) {
      const escaped = unicodeEscapeAt(index);
      const decoded = escaped ?? codePointAt(index);
      if (decoded === null) break;
      const permitted = first
        ? identifierStart(decoded.value)
        : identifierPart(decoded.value);
      if (!permitted) break;
      value += decoded.value;
      index = decoded.end;
      first = false;
    }
    if (first) throw new SyntaxError("malformed evaluator identifier");
    push("identifier", value, start, index);
  };

  const scanRegex = () => {
    const start = index;
    index++;
    let inClass = false;
    while (index < source.length) {
      const character = source[index++];
      if (character === "\\") {
        index++;
      } else if (character === "[") {
        inClass = true;
      } else if (character === "]") {
        inClass = false;
      } else if (character === "/" && !inClass) {
        while (identifierPart(source[index] ?? "")) index++;
        push("regex", source.slice(start, index), start, index);
        return;
      } else if (character === "\n" || character === "\r") {
        throw new SyntaxError("unterminated evaluator regular expression");
      }
    }
    throw new SyntaxError("unterminated evaluator regular expression");
  };

  const scanCode = (templateExpressionDepth = null) => {
    while (index < source.length) {
      const character = source[index];
      if (/\s/u.test(character)) {
        index++;
        continue;
      }
      if (character === "/" && source[index + 1] === "/") {
        index += 2;
        while (index < source.length && !/[\r\n]/u.test(source[index])) index++;
        continue;
      }
      if (character === "/" && source[index + 1] === "*") {
        index += 2;
        const end = source.indexOf("*/", index);
        if (end === -1) throw new SyntaxError("unterminated evaluator comment");
        index = end + 2;
        continue;
      }
      if (character === '"' || character === "'") {
        scanQuotedString(character);
        continue;
      }
      if (character === "`") {
        const start = index++;
        let value = "";
        let closed = false;
        while (index < source.length) {
          const templateCharacter = source[index++];
          if (templateCharacter === "\\") {
            value += escapedValue();
          } else if (templateCharacter === "`") {
            push("template", value, start, index);
            closed = true;
            break;
          } else if (templateCharacter === "$" && source[index] === "{") {
            push("template", value, start, index - 1);
            value = "";
            index++;
            braceDepth++;
            scanCode(braceDepth);
          } else {
            value += templateCharacter;
          }
        }
        if (!closed) throw new SyntaxError("unterminated evaluator template");
        continue;
      }
      if (
        (character === "+" || character === "-") &&
        source[index + 1] === character
      ) {
        const start = index;
        index += 2;
        push("punctuator", character + character, start, index);
        continue;
      }
      if (character === "/" && regexCanStartAfter()) {
        scanRegex();
        continue;
      }
      const firstCodePoint = codePointAt(index);
      const escapedIdentifier = unicodeEscapeAt(index);
      if (
        (firstCodePoint !== null && identifierStart(firstCodePoint.value)) ||
        (escapedIdentifier !== null && identifierStart(escapedIdentifier.value))
      ) {
        scanIdentifier();
        continue;
      }
      if (/[0-9]/u.test(character)) {
        const start = index++;
        while (/[A-Za-z0-9_.]/u.test(source[index] ?? "")) index++;
        push("number", source.slice(start, index), start, index);
        continue;
      }
      const start = index++;
      if (character === "{") {
        push("punctuator", character, start, index);
        braceDepth++;
      } else if (character === "}") {
        braceDepth--;
        push("punctuator", character, start, index);
        if (
          templateExpressionDepth !== null &&
          braceDepth < templateExpressionDepth
        ) {
          return;
        }
      } else if (character === "(") {
        push("punctuator", character, start, index);
        parenDepth++;
      } else if (character === ")") {
        parenDepth--;
        push("punctuator", character, start, index);
      } else if (character === "[") {
        push("punctuator", character, start, index);
        bracketDepth++;
      } else if (character === "]") {
        bracketDepth--;
        push("punctuator", character, start, index);
      } else {
        push("punctuator", character, start, index);
      }
    }
  };

  scanCode();
  return tokens;
}

function parseStaticImports(source) {
  const tokens = lexModuleSource(source);
  const declarations = [];
  const reexports = [];
  const dynamicImports = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type !== "identifier" || token.value !== "import") continue;
    const next = tokens[index + 1];
    if (next?.value === "(") {
      dynamicImports.push(token);
      continue;
    }
    if (next?.value === ".") continue;
    if (
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      continue;
    }
    if (next?.type === "string") {
      declarations.push({
        specifier: next.value,
        sideEffect: true,
        defaultBinding: null,
        namespaceBinding: null,
        namedBindings: [],
      });
      continue;
    }
    let fromIndex = index + 1;
    while (
      fromIndex < tokens.length &&
      !(
        tokens[fromIndex].type === "identifier" &&
        tokens[fromIndex].value === "from" &&
        tokens[fromIndex].braceDepth === 0 &&
        tokens[fromIndex].parenDepth === 0 &&
        tokens[fromIndex].bracketDepth === 0
      )
    ) {
      fromIndex++;
    }
    const specifierToken = tokens[fromIndex + 1];
    if (specifierToken?.type !== "string") {
      throw new SyntaxError("evaluator could not resolve static import source");
    }
    const clause = tokens.slice(index + 1, fromIndex);
    const openIndex = clause.findIndex((part) => part.value === "{");
    const starIndex = clause.findIndex((part) => part.value === "*");
    let defaultBinding = null;
    let namespaceBinding = null;
    const namedBindings = [];
    if (clause[0]?.type === "identifier" && clause[0].value !== "{") {
      defaultBinding = clause[0].value;
    }
    if (starIndex !== -1) {
      const asToken = clause[starIndex + 1];
      const localToken = clause[starIndex + 2];
      if (asToken?.value !== "as" || localToken?.type !== "identifier") {
        throw new SyntaxError("malformed evaluator namespace import");
      }
      namespaceBinding = localToken.value;
    }
    if (openIndex !== -1) {
      const closeIndex = clause.findIndex(
        (part, candidateIndex) =>
          candidateIndex > openIndex && part.value === "}",
      );
      if (closeIndex === -1) {
        throw new SyntaxError("malformed evaluator named import");
      }
      let cursor = openIndex + 1;
      while (cursor < closeIndex) {
        if (clause[cursor].value === ",") {
          cursor++;
          continue;
        }
        const imported = clause[cursor++];
        if (imported?.type !== "identifier") {
          throw new SyntaxError("malformed evaluator imported binding");
        }
        let local = imported.value;
        if (clause[cursor]?.value === "as") {
          cursor++;
          const localToken = clause[cursor++];
          if (localToken?.type !== "identifier") {
            throw new SyntaxError("malformed evaluator local binding");
          }
          local = localToken.value;
        }
        namedBindings.push({ imported: imported.value, local });
      }
    }
    declarations.push({
      specifier: specifierToken.value,
      sideEffect: false,
      defaultBinding,
      namespaceBinding,
      namedBindings,
    });
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      token.type !== "identifier" ||
      token.value !== "export" ||
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      continue;
    }
    if (!["{", "*"].includes(tokens[index + 1]?.value)) continue;
    let fromIndex = index + 1;
    while (fromIndex < tokens.length) {
      const candidate = tokens[fromIndex];
      if (
        candidate.type === "identifier" &&
        candidate.value === "from" &&
        candidate.braceDepth === 0 &&
        candidate.parenDepth === 0 &&
        candidate.bracketDepth === 0
      ) {
        break;
      }
      if (
        candidate.value === ";" &&
        candidate.braceDepth === 0 &&
        candidate.parenDepth === 0 &&
        candidate.bracketDepth === 0
      ) {
        break;
      }
      fromIndex++;
    }
    if (tokens[fromIndex]?.value !== "from") continue;
    const specifier = tokens[fromIndex + 1];
    if (specifier?.type !== "string")
      throw new SyntaxError("evaluator could not resolve re-export source");
    reexports.push({
      specifier: specifier.value,
      star: tokens
        .slice(index + 1, fromIndex)
        .some((part) => part.value === "*"),
    });
  }
  return { tokens, declarations, reexports, dynamicImports };
}

const NON_MEMBER_BASE_IDENTIFIERS = Object.freeze([
  "await",
  "case",
  "catch",
  "class",
  "const",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "return",
  "switch",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

function isForOfSeparator(tokens, tokenIndex) {
  const token = tokens[tokenIndex];
  if (token?.type !== "identifier" || token.value !== "of") return false;
  const headerDepth = token.parenDepth;
  if (headerDepth < 1) return false;
  let openingIndex = -1;
  for (let index = tokenIndex - 1; index >= 0; index--) {
    const candidate = tokens[index];
    if (candidate.value === "(" && candidate.parenDepth === headerDepth - 1) {
      openingIndex = index;
      break;
    }
  }
  if (openingIndex === -1) return false;
  const opening = tokens[openingIndex];
  if (
    token.braceDepth !== opening.braceDepth ||
    token.bracketDepth !== opening.bracketDepth
  ) {
    return false;
  }
  const beforeOpening = tokens[openingIndex - 1];
  const opensForHeader =
    beforeOpening?.value === "for" ||
    (beforeOpening?.value === "await" &&
      tokens[openingIndex - 2]?.value === "for");
  if (!opensForHeader) return false;
  const atHeaderTopLevel = (candidate) =>
    candidate.parenDepth === headerDepth &&
    candidate.braceDepth === opening.braceDepth &&
    candidate.bracketDepth === opening.bracketDepth;
  const priorHeaderTokens = tokens.slice(openingIndex + 1, tokenIndex);
  if (
    priorHeaderTokens.some(
      (candidate) =>
        atHeaderTopLevel(candidate) &&
        (candidate.value === ";" ||
          (candidate.type === "identifier" && candidate.value === "in")),
    )
  ) {
    return false;
  }

  const isBalancedBindingPattern = (binding) => {
    if (!["[", "{"].includes(binding[0]?.value)) return false;
    const closingFor = { "(": ")", "[": "]", "{": "}" };
    const stack = [];
    for (const [index, candidate] of binding.entries()) {
      if (Object.hasOwn(closingFor, candidate.value)) {
        stack.push(closingFor[candidate.value]);
      } else if ([")", "]", "}"].includes(candidate.value)) {
        if (stack.pop() !== candidate.value) return false;
        if (stack.length === 0 && index !== binding.length - 1) return false;
      }
    }
    return stack.length === 0;
  };
  const isIdentifierReference = (candidate) =>
    candidate?.type === "identifier" &&
    !NON_MEMBER_BASE_IDENTIFIERS.includes(candidate.value);
  const isStaticAssignmentTarget = (left) => {
    if (!isIdentifierReference(left[0])) return false;
    let cursor = 1;
    while (cursor < left.length) {
      if (
        left[cursor]?.value === "." &&
        left[cursor + 1]?.type === "identifier"
      ) {
        cursor += 2;
        continue;
      }
      if (
        left[cursor]?.value === "[" &&
        left[cursor + 1]?.type === "number" &&
        /^(?:0|[1-9][0-9]*)$/u.test(left[cursor + 1].value) &&
        left[cursor + 2]?.value === "]"
      ) {
        cursor += 3;
        continue;
      }
      return false;
    }
    return true;
  };
  const hasAllowedLeftSlice = (candidateIndex) => {
    const left = tokens.slice(openingIndex + 1, candidateIndex);
    if (["const", "let", "var"].includes(left[0]?.value)) {
      const binding = left.slice(1);
      return (
        (binding.length === 1 && isIdentifierReference(binding[0])) ||
        isBalancedBindingPattern(binding)
      );
    }
    return isStaticAssignmentTarget(left);
  };
  const earlierSeparator = priorHeaderTokens.some(
    (candidate, offset) =>
      candidate.type === "identifier" &&
      candidate.value === "of" &&
      atHeaderTopLevel(candidate) &&
      hasAllowedLeftSlice(openingIndex + 1 + offset),
  );
  return !earlierSeparator && hasAllowedLeftSlice(tokenIndex);
}

function isForInSeparator(tokens, tokenIndex) {
  const token = tokens[tokenIndex];
  if (token?.type !== "identifier" || token.value !== "in") return false;
  const headerDepth = token.parenDepth;
  if (headerDepth < 1) return false;
  let openingIndex = -1;
  for (let index = tokenIndex - 1; index >= 0; index -= 1) {
    const candidate = tokens[index];
    if (candidate.value === "(" && candidate.parenDepth === headerDepth - 1) {
      openingIndex = index;
      break;
    }
  }
  if (openingIndex === -1 || tokens[openingIndex - 1]?.value !== "for") {
    return false;
  }
  const opening = tokens[openingIndex];
  if (
    token.braceDepth !== opening.braceDepth ||
    token.bracketDepth !== opening.bracketDepth
  ) {
    return false;
  }
  const atHeaderTopLevel = (candidate) =>
    candidate.parenDepth === headerDepth &&
    candidate.braceDepth === opening.braceDepth &&
    candidate.bracketDepth === opening.bracketDepth;
  const prior = tokens.slice(openingIndex + 1, tokenIndex);
  if (
    prior.some(
      (candidate) => atHeaderTopLevel(candidate) && candidate.value === ";",
    )
  ) {
    return false;
  }
  const left = prior;
  if (["const", "let", "var"].includes(left[0]?.value)) {
    return left.length === 2 && left[1]?.type === "identifier";
  }
  if (left[0]?.type !== "identifier") return false;
  let cursor = 1;
  while (cursor < left.length) {
    if (
      left[cursor]?.value === "." &&
      left[cursor + 1]?.type === "identifier"
    ) {
      cursor += 2;
      continue;
    }
    if (
      left[cursor]?.value === "[" &&
      left[cursor + 1]?.type === "number" &&
      /^(?:0|[1-9][0-9]*)$/u.test(left[cursor + 1].value) &&
      left[cursor + 2]?.value === "]"
    ) {
      cursor += 3;
      continue;
    }
    return false;
  }
  return true;
}

function tokenCanEndMemberBase(tokens, tokenIndex) {
  const token = tokens[tokenIndex];
  if (token === undefined) return false;
  if (token.type === "identifier" && isForOfSeparator(tokens, tokenIndex)) {
    return false;
  }
  if (
    token.type === "identifier" &&
    !NON_MEMBER_BASE_IDENTIFIERS.includes(token.value)
  ) {
    return true;
  }
  if (["number", "string", "template", "regex"].includes(token.type)) {
    return true;
  }
  return [")", "]", "}"].includes(token.value);
}

function matchingSquareBracket(tokens, openingIndex) {
  let depth = 0;
  for (let index = openingIndex; index < tokens.length; index++) {
    if (tokens[index].value === "[") depth++;
    if (tokens[index].value === "]") depth--;
    if (depth === 0) return index;
  }
  throw new SyntaxError("unterminated evaluator computed key");
}

function assertComputedMembersAreStaticIndexes(tokens) {
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].value !== "[") continue;
    const previous = tokens[index - 1];
    const optionalMember =
      previous?.value === "." &&
      tokens[index - 2]?.value === "?" &&
      tokenCanEndMemberBase(tokens, index - 3);
    const directMember = tokenCanEndMemberBase(tokens, index - 1);
    const closingIndex = matchingSquareBracket(tokens, index);
    const following = tokens[closingIndex + 1];
    const computedObjectKey =
      tokens[index].braceDepth > 0 &&
      ["{", ","].includes(previous?.value) &&
      [":", "(", "="].includes(following?.value);
    if (!optionalMember && !directMember && !computedObjectKey) continue;
    const keyTokens = tokens.slice(index + 1, closingIndex);
    const exactStaticIndex =
      keyTokens.length === 1 &&
      keyTokens[0].type === "number" &&
      /^(?:0|[1-9][0-9]*)$/u.test(keyTokens[0].value);
    assert.equal(exactStaticIndex, true);
    index = closingIndex;
  }
}

const EXACT_RAW_HELPER_BINDINGS = Object.freeze([
  "decodeCanonicalJsonLine",
  "exactBufferByteLength",
  "exactRecord",
  "frozenCopyOnReadBytes",
  "sha256",
]);
const RAW_BYTES_CONSUMER_BINDINGS = Object.freeze([
  "decodeCanonicalJsonLine",
  "exactBufferByteLength",
  "frozenCopyOnReadBytes",
  "sha256",
]);
const RECOVERY_ALLOWED_PURE_IMPORT_SPECIFIERS = Object.freeze([
  "../routing/features.mjs",
  "./containment-exact-v2.mjs",
  "./containment-guardian-journal-v2.mjs",
]);
const RECOVERY_LIFETIME_IMPORT_SPECIFIER =
  "./containment-guardian-lifetime-v1.mjs";
const RECOVERY_LIFETIME_IMPORT_BINDINGS = Object.freeze([
  "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1",
  "assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1",
  "assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1",
  "assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1",
  "assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1",
  "assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1",
]);
const RECOVERY_REQUIRED_EXACT_V2_IMPORT_BINDINGS = Object.freeze([
  "decodeCanonicalJsonLine",
  "exactBufferByteLength",
  "exactRecord",
  "sha256",
]);
const RECOVERY_VALID_IMPORT_PREAMBLE = `import {
  CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1,
  assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1,
  assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1,
  assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1,
  assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1,
  assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1,
} from "./containment-guardian-lifetime-v1.mjs";
import {
  decodeCanonicalJsonLine,
  exactBufferByteLength,
  exactRecord,
  frozenCopyOnReadBytes,
  sha256,
} from "./containment-exact-v2.mjs";`;

function staticImportTokenRanges(tokens) {
  const ranges = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.type !== "identifier" ||
      token.value !== "import" ||
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0 ||
      tokens[index + 1]?.value === "("
    ) {
      continue;
    }
    let end = index + 1;
    if (tokens[end]?.type !== "string") {
      while (
        end < tokens.length &&
        !(
          tokens[end].type === "identifier" &&
          tokens[end].value === "from" &&
          tokens[end].braceDepth === 0 &&
          tokens[end].parenDepth === 0 &&
          tokens[end].bracketDepth === 0
        )
      ) {
        end += 1;
      }
      end += 1;
    }
    if (tokens[end]?.type !== "string") {
      throw new SyntaxError("evaluator could not bound static import");
    }
    ranges.push({ start: index, end, specifier: tokens[end].value });
    index = end;
  }
  return ranges;
}

function matchingRoundBracket(tokens, openingIndex) {
  let depth = 0;
  for (let index = openingIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === "(") depth += 1;
    if (tokens[index].value === ")") depth -= 1;
    if (depth === 0) return index;
  }
  throw new SyntaxError("unterminated evaluator call");
}

function assertExactRawHelperBindingsAndCalls(parsed) {
  const { tokens } = parsed;
  const protectedBindings = new Set(EXACT_RAW_HELPER_BINDINGS);
  const protectedStrings = new Set(EXACT_RAW_HELPER_BINDINGS);
  const usedBindings = new Set(
    tokens
      .filter(
        (token) =>
          token.type === "identifier" && protectedBindings.has(token.value),
      )
      .map((token) => token.value),
  );
  for (const token of tokens) {
    if (token.type === "string" && protectedStrings.has(token.value)) {
      assert.fail("exact raw helpers may not be reached by quoted property");
    }
  }
  if (usedBindings.size === 0) return;

  const exactSpecifier = "./containment-exact-v2.mjs";
  const exactDeclarations = parsed.declarations.filter(
    (declaration) => declaration.specifier === exactSpecifier,
  );
  assert.equal(exactDeclarations.length, 1);
  const exactDeclaration = exactDeclarations[0];
  assert.equal(exactDeclaration.sideEffect, false);
  assert.equal(exactDeclaration.defaultBinding, null);
  assert.equal(exactDeclaration.namespaceBinding, null);
  for (const binding of usedBindings) {
    assert.equal(
      exactDeclaration.namedBindings.filter(
        (candidate) =>
          candidate.imported === binding && candidate.local === binding,
      ).length,
      1,
    );
  }

  const exactImportRanges = staticImportTokenRanges(tokens).filter(
    (range) => range.specifier === exactSpecifier,
  );
  assert.equal(exactImportRanges.length, 1);
  const insideExactImport = (tokenIndex) =>
    exactImportRanges.some(
      (range) => tokenIndex >= range.start && tokenIndex <= range.end,
    );
  for (const [index, token] of tokens.entries()) {
    if (
      token.type !== "identifier" ||
      !protectedBindings.has(token.value) ||
      insideExactImport(index)
    ) {
      continue;
    }
    assert.equal(tokens[index + 1]?.value, "(");
    assert.equal(
      [".", "?", "new", "function", "class", "get", "set"].includes(
        tokens[index - 1]?.value,
      ),
      false,
    );
    const closingIndex = matchingRoundBracket(tokens, index + 1);
    assert.notEqual(tokens[closingIndex + 1]?.value, "{");
  }
}

function assertRawRecordBytesUseExclusiveExactHelpers(parsed) {
  const { tokens } = parsed;
  const helpers = new Set(RAW_BYTES_CONSUMER_BINDINGS);
  const exactRecordKeyLiteral = (index) =>
    tokens[index - 7]?.value === "exactRecord" &&
    tokens[index - 6]?.value === "(" &&
    tokens[index - 5]?.type === "identifier" &&
    tokens[index - 4]?.value === "," &&
    tokens[index - 3]?.value === "[" &&
    tokens[index - 2]?.type === "string" &&
    tokens[index - 2]?.value === "name" &&
    tokens[index - 1]?.value === "," &&
    tokens[index + 1]?.value === "]";
  for (const [index, token] of tokens.entries()) {
    if (token.value !== "bytes") continue;
    if (token.type === "string") {
      assert.equal(exactRecordKeyLiteral(index), true);
      continue;
    }
    assert.equal(token.type, "identifier");
    if (tokens[index - 1]?.value === ".") {
      const helper = tokens[index - 4];
      assert.equal(tokens[index - 3]?.value, "(");
      assert.equal(tokens[index - 2]?.type, "identifier");
      assert.equal(helpers.has(helper?.value), true);
      assert.equal(
        helper.value === "sha256"
          ? tokens[index + 1]?.value === ")"
          : tokens[index + 1]?.value === ",",
        true,
      );
      continue;
    }
    assert.fail("raw bytes may not be bound, aliased, or assigned");
  }
}

function assertRecoveryStaticImportContract(parsed) {
  const allowedPureSpecifiers = new Set(
    RECOVERY_ALLOWED_PURE_IMPORT_SPECIFIERS,
  );
  const declarations = parsed.declarations;
  assert.equal(
    new Set(declarations.map((entry) => entry.specifier)).size,
    declarations.length,
  );
  for (const declaration of declarations) {
    assert.equal(
      declaration.specifier === RECOVERY_LIFETIME_IMPORT_SPECIFIER ||
        allowedPureSpecifiers.has(declaration.specifier),
      true,
    );
    assert.equal(declaration.sideEffect, false);
    assert.equal(declaration.defaultBinding, null);
    assert.equal(declaration.namespaceBinding, null);
    assert.equal(declaration.namedBindings.length > 0, true);
    assert.equal(
      new Set(
        declaration.namedBindings.map(
          (binding) => `${binding.imported}\u0000${binding.local}`,
        ),
      ).size,
      declaration.namedBindings.length,
    );
  }

  const lifetimeDeclarations = declarations.filter(
    (entry) => entry.specifier === RECOVERY_LIFETIME_IMPORT_SPECIFIER,
  );
  assert.equal(lifetimeDeclarations.length, 1);
  const lifetimeBindings = lifetimeDeclarations[0].namedBindings;
  assert.deepEqual(
    lifetimeBindings.map((binding) => binding.imported).sort(),
    [...RECOVERY_LIFETIME_IMPORT_BINDINGS].sort(),
  );
  assert.equal(
    lifetimeBindings.every((binding) => binding.imported === binding.local),
    true,
  );

  const exactDeclarations = declarations.filter(
    (entry) => entry.specifier === "./containment-exact-v2.mjs",
  );
  assert.equal(exactDeclarations.length, 1);
  const exactBindings = exactDeclarations[0].namedBindings;
  for (const requiredBinding of RECOVERY_REQUIRED_EXACT_V2_IMPORT_BINDINGS) {
    assert.equal(
      exactBindings.filter(
        (binding) =>
          binding.imported === requiredBinding &&
          binding.local === requiredBinding,
      ).length,
      1,
    );
  }

  return Object.freeze({
    importSpecifiers: Object.freeze(
      declarations.map((entry) => entry.specifier),
    ),
    lifetimeBindings: Object.freeze(
      lifetimeBindings.map((binding) => binding.imported),
    ),
    exactV2Bindings: Object.freeze(
      exactBindings.map((binding) => binding.imported),
    ),
  });
}

const FORBIDDEN_SOURCE_IDENTIFIERS = Object.freeze([
  "require",
  "createRequire",
  "getBuiltinModule",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "getOwnPropertyNames",
  "getOwnPropertySymbols",
  "getPrototypeOf",
  "setPrototypeOf",
  "fs",
  "net",
  "tls",
  "http",
  "https",
  "dns",
  "dgram",
  "hasOwnProperty",
  "in",
  "prototype",
  "createHash",
  "createHmac",
  "webcrypto",
  "subtle",
  "constructor",
  "construct",
  "__proto__",
]);

const FORBIDDEN_FREE_AMBIENT_IDENTIFIERS = Object.freeze([
  "process",
  "global",
  "globalThis",
  "console",
  "fetch",
  "WebSocket",
  "XMLHttpRequest",
  "EventSource",
  "Worker",
  "SharedWorker",
  "MessageChannel",
  "BroadcastChannel",
  "navigator",
  "Deno",
  "Bun",
  "eval",
  "Function",
  "AsyncFunction",
  "GeneratorFunction",
  "AsyncGeneratorFunction",
  "Proxy",
  "WebAssembly",
  "Buffer",
  "TextDecoder",
  "TextEncoder",
  "Uint8Array",
  "DataView",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "atob",
  "btoa",
  "crypto",
  "structuredClone",
  "JSON",
  "Date",
  "performance",
  "setImmediate",
  "queueMicrotask",
  "setTimeout",
  "setInterval",
]);

const FORBIDDEN_SOURCE_STRINGS = Object.freeze([
  ...FORBIDDEN_SOURCE_IDENTIFIERS,
  ...FORBIDDEN_FREE_AMBIENT_IDENTIFIERS,
  ...EXPECTED_REQUIREMENTS_ENCODED_LITERALS,
  "construct",
  "prototype",
  "node:fs",
  "node:fs/promises",
  "node:net",
  "node:tls",
  "node:http",
  "node:https",
  "node:dns",
  "node:dgram",
  "node:child_process",
  "node:worker_threads",
  "cgroup.kill",
  "/proc/",
]);

function decodedCompileTimeStrings(tokens) {
  const values = [];
  for (const [index, token] of tokens.entries()) {
    if (token.type !== "string" && token.type !== "template") continue;
    values.push(token.value);
    let combined = token.value;
    let cursor = index;
    while (
      tokens[cursor + 1]?.value === "+" &&
      ["string", "template"].includes(tokens[cursor + 2]?.type)
    ) {
      combined += tokens[cursor + 2].value;
      values.push(combined);
      cursor += 2;
    }
  }
  return values;
}

function assertNoFreeAmbientEffects(parsed) {
  const { tokens } = parsed;
  const forbidden = new Set(FORBIDDEN_FREE_AMBIENT_IDENTIFIERS);
  for (const [index, token] of tokens.entries()) {
    if (token.type !== "identifier") continue;
    if (forbidden.has(token.value)) {
      assert.fail(`forbidden ambient spelling rejected: ${token.value}`);
    }
    if (
      token.value === "Math" &&
      tokens[index + 1]?.value === "." &&
      tokens[index + 2]?.value === "random"
    ) {
      assert.fail("free ambient nondeterminism rejected: Math.random");
    }
  }
}

// This fail-closed gate admits only the evaluator's bounded lexical subset
// before module evaluation. It is deliberately not a general proof of
// JavaScript non-interference, operating-system sandboxing, or the absence of
// every future ambient-authority spelling.
function assertRecoverySourceWithinBoundedLexicalSubset(parsed) {
  assert.equal(parsed.dynamicImports.length, 0);
  assert.equal(parsed.reexports.length, 0);
  assert.equal(
    parsed.tokens.some(
      (token, index) =>
        token.value === "import" && parsed.tokens[index + 1]?.value === ".",
    ),
    false,
  );
  assertComputedMembersAreStaticIndexes(parsed.tokens);
  assertExactRawHelperBindingsAndCalls(parsed);
  assertRawRecordBytesUseExclusiveExactHelpers(parsed);
  const imports = assertRecoveryStaticImportContract(parsed);
  assertNoFreeAmbientEffects(parsed);
  assert.equal(
    parsed.tokens.some(
      (token, index) =>
        token.value === "." &&
        parsed.tokens[index + 1]?.value === "." &&
        parsed.tokens[index + 2]?.value === ".",
    ),
    false,
  );
  assert.equal(
    parsed.tokens.some((token) => ["++", "--"].includes(token.value)),
    false,
  );
  const identifiers = new Set(
    parsed.tokens
      .filter((token) => token.type === "identifier")
      .map((token) => token.value),
  );
  const forbiddenIdentifiers = new Set(FORBIDDEN_SOURCE_IDENTIFIERS);
  for (const [index, token] of parsed.tokens.entries()) {
    if (token.type !== "identifier" || !forbiddenIdentifiers.has(token.value)) {
      continue;
    }
    assert.equal(
      token.value === "in" && isForInSeparator(parsed.tokens, index),
      true,
    );
  }

  for (const [index, token] of parsed.tokens.entries()) {
    if (token.type !== "identifier" || token.value !== "Reflect") continue;
    assert.equal(parsed.tokens[index + 1]?.value, ".");
    assert.equal(parsed.tokens[index + 2]?.value, "ownKeys");
    assert.equal(parsed.tokens[index + 3]?.value, "(");
  }

  for (const [index, token] of parsed.tokens.entries()) {
    const previous = parsed.tokens[index - 1];
    const receiver = parsed.tokens[index - 2];
    if (previous?.value !== ".") continue;
    assert.equal(["sort", "toSorted"].includes(token.value), false);
    if (receiver?.value === "Object") {
      assert.equal(
        [
          "assign",
          "defineProperties",
          "defineProperty",
          "entries",
          "freeze",
          "fromEntries",
          "hasOwn",
          "isExtensible",
          "isFrozen",
          "isSealed",
          "keys",
          "preventExtensions",
          "seal",
          "values",
        ].includes(token.value),
        false,
      );
    }
  }

  const strings = decodedCompileTimeStrings(parsed.tokens);
  for (const forbidden of FORBIDDEN_SOURCE_STRINGS) {
    assert.equal(
      strings.some(
        (value) =>
          value === forbidden ||
          value.includes(`node:${forbidden}`) ||
          (forbidden.startsWith("/") && value.includes(forbidden)),
      ),
      false,
    );
  }
  assert.equal(
    parsed.declarations.some(
      (entry) =>
        entry.specifier.includes("journal-v1") ||
        /(?:^|[/.:_-])(?:fs|net|tls|http|https|dns|dgram|child_process|worker_threads)(?:$|[/.:_-])/u.test(
          entry.specifier,
        ),
    ),
    false,
  );
  return { identifiers, strings, imports };
}

function assertPreexecutionPolicyNegativeControls() {
  const disallowedImports = [
    `${RECOVERY_VALID_IMPORT_PREAMBLE}\nimport { deterministicHelper } from "./unratified-pure-helper.mjs";`,
    `${RECOVERY_VALID_IMPORT_PREAMBLE}\nimport { createContext } from "node:vm";`,
    `${RECOVERY_VALID_IMPORT_PREAMBLE}\nimport { platform } from "node:os";`,
    `${RECOVERY_VALID_IMPORT_PREAMBLE}\nimport "../routing/features.mjs";`,
    `${RECOVERY_VALID_IMPORT_PREAMBLE}\nimport defaultHelper from "../routing/features.mjs";`,
    `${RECOVERY_VALID_IMPORT_PREAMBLE}\nimport * as helperNamespace from "../routing/features.mjs";`,
    RECOVERY_VALID_IMPORT_PREAMBLE.replace(
      "assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1,",
      "assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1 as aliasedTargetAssertion,",
    ),
    RECOVERY_VALID_IMPORT_PREAMBLE.replace(
      "exactBufferByteLength,",
      "exactBufferByteLength as aliasedExactBufferByteLength,",
    ),
  ];
  const directAmbientEffects = [
    'console.log("effect");',
    "setImmediate(callback);",
    "queueMicrotask(callback);",
    "setTimeout(callback, 0);",
    "setInterval(callback, 1);",
    'fetch("https://example.invalid/");',
    'new WebSocket("wss://example.invalid/");',
    'new Worker("worker.mjs");',
    "new MessageChannel();",
    'new BroadcastChannel("channel");',
    'process.getBuiltinModule("node:fs");',
    "globalThis.process;",
    'eval("void 0");',
    'Function("return 0")();',
    "Date.now();",
    "performance.now();",
    "crypto.getRandomValues(output);",
    "Math.random();",
    'const holder = function console() {}; console.log("ambient");',
    'const Holder = class console {}; console.log("ambient");',
    'console.log("before"); const holder = function console() {};',
    'console.log("before"); const Holder = class console {};',
    '{ const holder = function console() {}; console.log("nested"); }',
    '{ const Holder = class console {}; console.log("nested"); }',
    "const console = deterministicLogger; console.log(localValue);",
    "function schedule(setTimeout) { return setTimeout(callback, 0); }",
    "const schedule = (queueMicrotask) => queueMicrotask(callback);",
    "const Math = deterministicMath; Math.random();",
  ];
  let evaluationAttempts = 0;
  for (const source of [
    ...disallowedImports,
    ...directAmbientEffects.map(
      (body) => `${RECOVERY_VALID_IMPORT_PREAMBLE}\n${body}`,
    ),
  ]) {
    assert.throws(() => {
      assertRecoverySourceWithinBoundedLexicalSubset(
        parseStaticImports(source),
      );
      evaluationAttempts += 1;
    });
  }
  assert.equal(evaluationAttempts, 0);

  for (const body of [
    "const logger = deterministicLogger; logger.log(localValue);",
    "function scheduleTask(timer) { return timer(callback, 0); }",
    "const scheduleTask = (enqueue) => enqueue(callback);",
    "const deterministicMath = mathProvider; deterministicMath.sample();",
    "function helper() { return helper; } helper();",
    "class Helper { static value() { return localValue; } } Helper.value();",
  ]) {
    assert.doesNotThrow(() =>
      assertRecoverySourceWithinBoundedLexicalSubset(
        parseStaticImports(`${RECOVERY_VALID_IMPORT_PREAMBLE}\n${body}`),
      ),
    );
  }
  return Object.freeze({
    rejectedImportCount: disallowedImports.length,
    rejectedAmbientEffectCount: directAmbientEffects.length,
    evaluationAttempts,
  });
}

const RECOVERY_PREEXECUTION_POLICY_CONTROLS =
  assertPreexecutionPolicyNegativeControls();

let RECOVERY_SOURCE_TEXT;
try {
  RECOVERY_SOURCE_TEXT = readFileSync(RECOVERY_SOURCE_PATH, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  // Preserve the evaluator's canonical source-absent RED while ensuring that a
  // present module is always inspected before it can be evaluated.
  await import(RECOVERY_SOURCE_URL.href);
  throw error;
}
const RECOVERY_PREEXECUTION_AUDIT =
  assertRecoverySourceWithinBoundedLexicalSubset(
    parseStaticImports(RECOVERY_SOURCE_TEXT),
  );
const recovery = await import(RECOVERY_SOURCE_URL.href);

test("exports exactly the 53-name recovery-v1 public contract", () => {
  assert.equal(VALUE_EXPORTS.length, 40);
  assert.equal(FUNCTION_EXPORTS.length, 13);
  assert.deepEqual(
    Object.keys(recovery).sort(),
    [...VALUE_EXPORTS, ...FUNCTION_EXPORTS].sort(),
  );
  for (const name of FUNCTION_EXPORTS)
    assert.equal(typeof recovery[name], "function");
});

test("freezes the exact schemas, bounds, and ordered vocabularies", () => {
  const schemaValues = VALUE_EXPORTS.slice(0, 12).map((name) => recovery[name]);
  assert.deepEqual(schemaValues, Object.values(SCHEMAS).slice(0, 12));
  assert.deepEqual(
    VALUE_EXPORTS.slice(12, 22).map((name) => recovery[name]),
    [1, 16, 4, 24, 96, 16384, 16384, 65536, 6291456, ZERO_SHA256],
  );
  const vocabularies = [
    ["CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1", ACTOR_KINDS],
    ["CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_ENTRY_KINDS_V1", ENTRY_KINDS],
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_RESULTS_V1",
      EXTERNAL_HEAD_RESULTS,
    ],
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_DIRECTORY_STATES_V1",
      ATTEMPT_DIRECTORY_STATES,
    ],
    ["CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1", SOURCE_LOCATIONS],
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_ATTEMPT_SOURCE_LOCATIONS_V1",
      ATTEMPT_SOURCE_LOCATIONS,
    ],
    ["CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1", DISPOSITIONS],
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1",
      QUARANTINE_REASONS,
    ],
    ["CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1", RECORD_STATES],
    ["CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1", PLAN_STATUSES],
    ["CANDIDATE_CONTAINMENT_RECOVERY_REPLAY_STATUSES_V1", REPLAY_STATUSES],
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITION_SELECTION_PRECEDENCE_V1",
      DISPOSITION_PRECEDENCE,
    ],
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_UNRESOLVED_EFFECT_INTENT_STATES_V1",
      UNRESOLVED_EFFECT_INTENTS,
    ],
  ];
  for (const [name, expected] of vocabularies) {
    assert.deepEqual(recovery[name], expected);
    assert.equal(Object.isFrozen(recovery[name]), true);
  }
});

test("owns the exact 99-field requirements projection and derives its independently golden digest", () => {
  assert.equal(Object.keys(EXPECTED_REQUIREMENTS).length, 99);
  assert.equal(
    semanticSha256(EXPECTED_AUTHORITY),
    EXPECTED_REQUIREMENTS.authoritySha256,
  );
  assert.equal(
    semanticSha256(EXPECTED_NONCLAIMS),
    EXPECTED_REQUIREMENTS.nonclaimsSha256,
  );
  assert.equal(
    semanticSha256(EXPECTED_PHYSICAL_FACTS),
    EXPECTED_REQUIREMENTS.physicalFactsSha256,
  );
  assert.equal(
    semanticSha256(EXPECTED_REQUIREMENTS),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.deepEqual(
    Object.keys(recovery.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1),
    Object.keys(EXPECTED_REQUIREMENTS),
  );
  assert.deepEqual(
    plain(recovery.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1),
    plain(EXPECTED_REQUIREMENTS),
  );
  assert.equal(
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.equal(
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
    semanticSha256(
      plain(recovery.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1),
    ),
  );
  assert.equal(
    RECOVERY_PREEXECUTION_AUDIT.strings.includes(EXPECTED_REQUIREMENTS_SHA256),
    false,
  );
  assert.equal(
    RECOVERY_PREEXECUTION_AUDIT.strings
      .filter((value) => /^[0-9a-f]+$/u.test(value))
      .join("")
      .includes(EXPECTED_REQUIREMENTS_SHA256),
    false,
  );
  assert.equal(
    RECOVERY_SOURCE_TEXT.includes(EXPECTED_REQUIREMENTS_SHA256),
    false,
  );
  assertNullPrototypeFrozen(
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1,
  );
});

test("rejects a substituted lifetime requirements digest during module initialization", () => {
  const child = String.raw`
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const recoveryPath = process.argv[1];
const recoveryUrl = pathToFileURL(recoveryPath);
const source = readFileSync(recoveryPath, "utf8");
const lifetimeNames = [
  "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1",
  "assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1",
  "assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1",
  "assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1",
  "assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1",
  "assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1",
];
const allowed = new Set([
  "../routing/features.mjs",
  "./containment-exact-v2.mjs",
  "./containment-guardian-journal-v2.mjs",
]);
async function evaluateWithLifetimeDigest(lifetimeDigest) {
  const context = vm.createContext({
    Buffer,
    TextDecoder,
    TextEncoder,
    URL,
    console,
    structuredClone,
  });
  const root = new vm.SourceTextModule(source, {
    context,
    identifier: recoveryUrl.href,
  });
  await root.link(async (specifier) => {
    if (specifier === "./containment-guardian-lifetime-v1.mjs") {
      return new vm.SyntheticModule(
        lifetimeNames,
        function initializeLifetimeSubstitute() {
          for (const name of lifetimeNames) {
            this.setExport(
              name,
              name === lifetimeNames[0]
                ? lifetimeDigest
                : () => {
                    throw new Error(
                      "lifetime assertion ran during recovery module initialization",
                    );
                  },
            );
          }
        },
        { context, identifier: "evaluator:lifetime-digest-substitute" },
      );
    }
    if (!allowed.has(specifier)) throw new Error("unexpected recovery import");
    const namespace = await import(new URL(specifier, recoveryUrl).href);
    const names = Object.keys(namespace);
    return new vm.SyntheticModule(
      names,
      function initializePureDependency() {
        for (const name of names) this.setExport(name, namespace[name]);
      },
      { context, identifier: new URL(specifier, recoveryUrl).href },
    );
  });
  try {
    await root.evaluate();
    return { initialized: true, error: null };
  } catch (error) {
    return { initialized: false, error };
  }
}
const baseline = await evaluateWithLifetimeDigest(
  "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773",
);
if (!baseline.initialized) throw baseline.error;
const mismatch = await evaluateWithLifetimeDigest("f".repeat(64));
if (mismatch.initialized)
  throw new Error("mismatched lifetime digest initialized");
console.log("lifetime-digest-substitution-rejected");
`;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--input-type=module",
      "-e",
      child,
      RECOVERY_SOURCE_PATH,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /lifetime-digest-substitution-rejected/u);
});

test("derives the recovery requirements digest through the imported canonical hash seam", () => {
  assert.equal(
    Buffer.from(
      "Mjc4MDMxYTQzYjMzMTAzNmU2Yzg0OWY3OTZkNDgwZTdmZTY4MDIxOWQwN2JkYjViMzAxODU2NjhhOTMzN2M1YQ==",
      "base64",
    ).toString("utf8"),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  const expectedRequirementsBase64 = Buffer.from(
    canonicalJson(EXPECTED_REQUIREMENTS),
    "utf8",
  ).toString("base64");
  const child = String.raw`
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const recoveryPath = process.argv[1];
const expectedRequirementsBytes = Buffer.from(process.argv[2], "base64");
const expectedRequirementsText = expectedRequirementsBytes.toString("utf8");
const recoveryUrl = pathToFileURL(recoveryPath);
const source = readFileSync(recoveryPath, "utf8");
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
      .join(",") +
    "}"
  );
};
const lifetimeNames = [
  "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1",
  "assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1",
  "assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1",
  "assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1",
  "assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1",
  "assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1",
];
const allowed = new Set([
  "../routing/features.mjs",
  "./containment-exact-v2.mjs",
  "./containment-guardian-journal-v2.mjs",
]);
async function evaluateWithSentinel(sentinelDigest) {
  let requirementsHashCalls = 0;
  const context = vm.createContext({
    Buffer,
    TextDecoder,
    TextEncoder,
    URL,
    console,
    structuredClone,
  });
  const root = new vm.SourceTextModule(source, {
    context,
    identifier: recoveryUrl.href,
  });
  await root.link(async (specifier) => {
    if (specifier === "./containment-guardian-lifetime-v1.mjs") {
      return new vm.SyntheticModule(
        lifetimeNames,
        function initializeLifetimeSubstitute() {
          for (const name of lifetimeNames) {
            this.setExport(
              name,
              name === lifetimeNames[0]
                ? "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773"
                : () => {
                    throw new Error(
                      "lifetime assertion ran during recovery module initialization",
                    );
                  },
            );
          }
        },
        { context, identifier: "evaluator:lifetime-hash-seam" },
      );
    }
    if (!allowed.has(specifier)) throw new Error("unexpected recovery import");
    const namespace = await import(new URL(specifier, recoveryUrl).href);
    const names = Object.keys(namespace);
    return new vm.SyntheticModule(
      names,
      function initializePureDependency() {
        for (const name of names) {
          if (
            specifier === "./containment-exact-v2.mjs" &&
            name === "sha256"
          ) {
            this.setExport(name, (bytes) => {
              const exactBytes = Buffer.from(bytes);
              if (exactBytes.equals(expectedRequirementsBytes)) {
                requirementsHashCalls++;
                return sentinelDigest;
              }
              return namespace.sha256(bytes);
            });
          } else {
            this.setExport(name, namespace[name]);
          }
        }
      },
      { context, identifier: new URL(specifier, recoveryUrl).href },
    );
  });
  await root.evaluate();
  const exportedRequirements =
    root.namespace.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_V1;
  if (canonicalJson(exportedRequirements) !== expectedRequirementsText)
    throw new Error("exported requirements projection changed");
  return {
    requirementsHashCalls,
    exportedDigest:
      root.namespace.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
  };
}
const sentinelDigests = [
  randomBytes(32).toString("hex"),
  randomBytes(32).toString("hex"),
];
if (new Set(sentinelDigests).size !== 2)
  throw new Error("hash sentinels unexpectedly collided");
for (const sentinelDigest of sentinelDigests) {
  const result = await evaluateWithSentinel(sentinelDigest);
  if (result.requirementsHashCalls !== 1)
    throw new Error("exact requirements projection did not hash exactly once");
  if (result.exportedDigest !== sentinelDigest)
    throw new Error("requirements digest did not follow substituted sha256");
}
console.log("recovery-requirements-digest-followed-hash-seam");
`;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--input-type=module",
      "-e",
      child,
      RECOVERY_SOURCE_PATH,
      expectedRequirementsBase64,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    /recovery-requirements-digest-followed-hash-seam/u,
  );
});

test("ratifies exactRecord as the captured-intrinsics no-sort record-reference preflight", () => {
  const result = probeExactRecordNoSortContractV1();
  assert.deepEqual(plain(result), {
    acceptedPermutationCount: 2,
    normalizedKeyOrders: [
      ["name", "bytes"],
      ["name", "bytes"],
    ],
    normalizedPrototypesAreNull: true,
    normalizedValuesRetainIdentity: true,
    proxyRejected: true,
    proxyTrapHits: 0,
    accessorRejected: true,
    getterHits: 0,
    duplicateExpectedRejected: true,
    dynamicIntrinsicHits: 0,
  });
});

test("preflights an exact record reference without traps then rejects oversized canonical bytes before decode, hash, sort, or clone", () => {
  const controlMarker = randomBytes(16).toString("hex");
  const control = createPlanRecords(
    createAttempt(
      addReadyAnchor(buildGenesis(`raw-bound-control-${controlMarker}`)),
    ),
    1,
  ).records[0];
  const controlArtifact = artifact(control);
  const child = String.raw`
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const recoveryPath = process.argv[1];
const controlName = process.argv[2];
const controlBytes = Buffer.from(process.argv[3], "base64");
const recoveryUrl = pathToFileURL(recoveryPath);
const source = readFileSync(recoveryPath, "utf8");
const lifetimeNames = [
  "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1",
  "assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1",
  "assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1",
  "assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1",
  "assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1",
  "assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1",
];
const allowed = new Set([
  "../routing/features.mjs",
  "./containment-exact-v2.mjs",
  "./containment-guardian-journal-v2.mjs",
]);
let probeKind = null;
let smallCarrier = null;
let oversizedCarrier = null;
let oversizedBytes = null;
const smallExpectedBytes = Buffer.from(controlBytes);
const bufferCompare = Buffer.compare.bind(Buffer);
const eventLog = [];
let localInspectionHits = 0;
let exactRecordCalls = 0;
let exactRecordObserver = null;
let smallLengthHits = 0;
let smallSha256Hits = 0;
let smallDecodeHits = 0;
let smallCopyHits = 0;
let smallPreflightHits = 0;
let oversizedLengthHits = 0;
let oversizedSha256Hits = 0;
let oversizedDecodeHits = 0;
let oversizedCopyHits = 0;
let oversizedPreflightHits = 0;
let otherExactRecordHits = 0;
let rawLengthAccepted = false;
const context = vm.createContext(Object.create(null));
for (const unavailable of ["Buffer", "TextDecoder", "TextEncoder"]) {
  if (vm.runInContext("typeof " + unavailable, context) !== "undefined")
    throw new Error(unavailable + " unexpectedly exists in recovery VM");
}

context.__evaluatorProbeActive = () => probeKind !== null;
context.__evaluatorInspection = (label) => {
  localInspectionHits++;
  eventLog.push("local:" + label);
};
const installInspectionHooks = function installInspectionHooks() {
      const probeActive = globalThis.__evaluatorProbeActive;
      const inspection = globalThis.__evaluatorInspection;
      delete globalThis.__evaluatorProbeActive;
      delete globalThis.__evaluatorInspection;
      if (typeof globalThis.structuredClone !== "function") {
        Object.defineProperty(globalThis, "structuredClone", {
          configurable: true,
          enumerable: false,
          writable: true,
          value(value) {
            return value;
          },
        });
      }
      if (typeof Array.prototype.toSorted !== "function") {
        Object.defineProperty(Array.prototype, "toSorted", {
          configurable: true,
          enumerable: false,
          writable: true,
          value() {
            return this.slice();
          },
        });
      }
      for (const [owner, key, label] of [
        [JSON, "parse", "JSON.parse"],
        [Object, "assign", "Object.assign"],
        [Object, "entries", "Object.entries"],
        [Object, "keys", "Object.keys"],
        [Object, "values", "Object.values"],
        [Reflect, "get", "Reflect.get"],
        [Reflect, "ownKeys", "Reflect.ownKeys"],
        [Array.prototype, "sort", "Array.prototype.sort"],
        [Array.prototype, "toSorted", "Array.prototype.toSorted"],
        [globalThis, "structuredClone", "structuredClone"],
      ]) {
        const original = owner[key];
        if (typeof original !== "function") continue;
        Object.defineProperty(owner, key, {
          configurable: true,
          enumerable: false,
          writable: false,
          value(...args) {
            if (probeActive()) {
              inspection(label);
              throw new Error("VM-local inspection preceded the raw guard");
            }
            return Reflect.apply(original, this, args);
          },
        });
      }
};
vm.runInContext("(" + installInspectionHooks.toString() + ")()", context);
const inspectionSelfTests = [
  ['JSON.parse("{}")', "local:JSON.parse"],
  ["Object.assign({}, {})", "local:Object.assign"],
  ["Object.entries({})", "local:Object.entries"],
  ["Object.keys({})", "local:Object.keys"],
  ["Object.values({})", "local:Object.values"],
  ["Reflect.get({}, 'x')", "local:Reflect.get"],
  ["Reflect.ownKeys({})", "local:Reflect.ownKeys"],
  ["[].sort()", "local:Array.prototype.sort"],
  ["typeof [].toSorted === 'function' ? [].toSorted() : Array.prototype.toSorted.call([])", "local:Array.prototype.toSorted"],
  ["structuredClone({})", "local:structuredClone"],
];
for (const [expression, expectedEvent] of inspectionSelfTests) {
  probeKind = "instrumentation-self-test";
  try {
    vm.runInContext("try { " + expression + " } catch {}", context);
  } finally {
    probeKind = null;
  }
  if (eventLog.length !== 1 || eventLog[0] !== expectedEvent)
    throw new Error(expectedEvent + " instrumentation is not live");
  eventLog.length = 0;
}
if (localInspectionHits !== inspectionSelfTests.length)
  throw new Error("VM-local inspection hit accounting changed");
localInspectionHits = 0;
const root = new vm.SourceTextModule(source, {
  context,
  identifier: recoveryUrl.href,
});
await root.link(async (specifier) => {
  if (specifier === "./containment-guardian-lifetime-v1.mjs") {
    return new vm.SyntheticModule(
      lifetimeNames,
      function initializeLifetimeSubstitute() {
        for (const name of lifetimeNames) {
          this.setExport(
            name,
            name === lifetimeNames[0]
              ? "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773"
              : () => {
                  throw new Error(
                    "lifetime assertion ran in standalone record verification",
                  );
                },
          );
        }
      },
      { context, identifier: "evaluator:lifetime-oversize-seam" },
    );
  }
  if (!allowed.has(specifier)) throw new Error("unexpected recovery import");
  const namespace = await import(new URL(specifier, recoveryUrl).href);
  const names = Object.keys(namespace);
  return new vm.SyntheticModule(
    names,
    function initializePureDependency() {
      for (const name of names) {
        if (
          specifier === "./containment-exact-v2.mjs" &&
          name === "exactBufferByteLength"
        ) {
          this.setExport(name, (...args) => {
            const isSmall =
              probeKind === "small" &&
              Buffer.isBuffer(args[0]) &&
              bufferCompare(args[0], smallExpectedBytes) === 0;
            const isOversized =
              probeKind === "oversized" && args[0] === oversizedBytes;
            if (isSmall || isOversized) {
              eventLog.push("intrinsic-length-start");
              if (args[2]?.maximumBytes !== 65_536)
                throw new Error("raw length guard did not use the exact maximum");
              if (isSmall) smallLengthHits++;
              if (isOversized) oversizedLengthHits++;
            }
            try {
              const result = namespace[name](...args);
              if (isSmall || isOversized) {
                eventLog.push("intrinsic-length-accepted");
                rawLengthAccepted = true;
              }
              return result;
            } catch (error) {
              if (isSmall || isOversized)
                eventLog.push("intrinsic-length-rejected");
              throw error;
            }
          });
        } else if (
          specifier === "./containment-exact-v2.mjs" &&
          name === "exactRecord"
        ) {
          exactRecordObserver = (...args) => {
            if (probeKind === null) return namespace[name](...args);
            exactRecordCalls++;
            const isSmall =
              probeKind === "small" && args[0] === smallCarrier;
            const isOversized =
              probeKind === "oversized" && args[0] === oversizedCarrier;
            const isCarrierPreflight = isSmall || isOversized;
            if (isSmall) smallPreflightHits++;
            if (isOversized) oversizedPreflightHits++;
            if (!isCarrierPreflight) otherExactRecordHits++;
            eventLog.push(
              isCarrierPreflight
                ? "record-preflight-start"
                : "exact-record-other-start",
            );
            if (isCarrierPreflight) {
              if (
                !Array.isArray(args[1]) ||
                args[1].length !== 2 ||
                args[1][0] !== "name" ||
                args[1][1] !== "bytes"
              ) {
                throw new Error("record preflight did not request exact name+bytes");
              }
            }
            try {
              const normalized = namespace[name](...args);
              eventLog.push(
                isCarrierPreflight
                  ? "record-preflight-accepted"
                  : "exact-record-other-accepted",
              );
              return normalized;
            } catch (error) {
              eventLog.push(
                isCarrierPreflight
                  ? "record-preflight-rejected"
                  : "exact-record-other-rejected",
              );
              throw error;
            }
          };
          this.setExport(name, exactRecordObserver);
        } else if (
          specifier === "./containment-exact-v2.mjs" &&
          name === "sha256"
        ) {
          this.setExport(name, (...args) => {
            if (
              probeKind === "small" &&
              Buffer.isBuffer(args[0]) &&
              bufferCompare(args[0], smallExpectedBytes) === 0
            ) {
              smallSha256Hits++;
              eventLog.push("sha256");
            }
            if (probeKind === "oversized") {
              oversizedSha256Hits++;
              eventLog.push("sha256");
            }
            return namespace[name](...args);
          });
        } else if (
          specifier === "./containment-exact-v2.mjs" &&
          name === "decodeCanonicalJsonLine"
        ) {
          this.setExport(name, (...args) => {
            if (
              probeKind === "small" &&
              Buffer.isBuffer(args[0]) &&
              bufferCompare(args[0], smallExpectedBytes) === 0
            ) {
              smallDecodeHits++;
              eventLog.push("decode");
            }
            if (probeKind === "oversized") {
              oversizedDecodeHits++;
              eventLog.push("decode");
            }
            return namespace[name](...args);
          });
        } else if (
          specifier === "./containment-exact-v2.mjs" &&
          name === "frozenCopyOnReadBytes"
        ) {
          this.setExport(name, (...args) => {
            if (
              probeKind === "small" &&
              Buffer.isBuffer(args[0]) &&
              bufferCompare(args[0], smallExpectedBytes) === 0
            ) {
              smallCopyHits++;
              eventLog.push("copy");
            }
            if (probeKind === "oversized") {
              oversizedCopyHits++;
              eventLog.push("copy");
            }
            return namespace[name](...args);
          });
        } else if (typeof namespace[name] === "function") {
          this.setExport(name, (...args) => {
            if (probeKind !== null && !rawLengthAccepted) {
              localInspectionHits++;
              eventLog.push("imported-helper:" + name);
              throw new Error(
                "unexpected imported helper inspected the raw carrier",
              );
            }
            return namespace[name](...args);
          });
        } else {
          this.setExport(name, namespace[name]);
        }
      }
    },
    { context, identifier: new URL(specifier, recoveryUrl).href },
  );
});
await root.evaluate();

const instrumentBuffer = (bytes) => {
  for (const key of [
    "toString",
    "values",
    "entries",
    "keys",
    "at",
    "slice",
    "subarray",
    "readUInt8",
    "includes",
    "indexOf",
    "compare",
    "copy",
    "equals",
    "forEach",
    "map",
    "reduce",
    "join",
    "toJSON",
    "valueOf",
  ]) {
    Object.defineProperty(bytes, key, {
      configurable: true,
      enumerable: false,
      writable: false,
      value() {
        localInspectionHits++;
        eventLog.push("buffer:" + key);
        throw new Error("Buffer instance method inspected raw bytes");
      },
    });
  }
  Object.defineProperty(bytes, Symbol.iterator, {
    configurable: true,
    enumerable: false,
    writable: false,
    value() {
      localInspectionHits++;
      eventLog.push("buffer:iterator");
      throw new Error("Buffer iterator inspected raw bytes");
    },
  });
  Object.defineProperty(bytes, Symbol.toPrimitive, {
    configurable: true,
    enumerable: false,
    writable: false,
    value() {
      localInspectionHits++;
      eventLog.push("buffer:toPrimitive");
      throw new Error("Buffer coercion inspected raw bytes");
    },
  });
};
const makeCarrier = (name, bytes) => {
  const carrier = vm.runInContext("Object.create(null)", context);
  Object.defineProperties(carrier, {
    name: {
      configurable: true,
      enumerable: true,
      writable: true,
      value: name,
    },
    bytes: {
      configurable: true,
      enumerable: true,
      writable: true,
      value: bytes,
    },
  });
  return carrier;
};

const instrumentationSelfTest = Buffer.from("self-test", "utf8");
instrumentBuffer(instrumentationSelfTest);
const bufferMethodLabels = [
  "toString",
  "values",
  "entries",
  "keys",
  "at",
  "slice",
  "subarray",
  "readUInt8",
  "includes",
  "indexOf",
  "compare",
  "copy",
  "equals",
  "forEach",
  "map",
  "reduce",
  "join",
  "toJSON",
  "valueOf",
];
for (const key of bufferMethodLabels) {
  try {
    instrumentationSelfTest[key]();
  } catch {}
}
try {
  instrumentationSelfTest[Symbol.iterator]();
} catch {}
try {
  instrumentationSelfTest[Symbol.toPrimitive]();
} catch {}
if (
  localInspectionHits !== bufferMethodLabels.length + 2 ||
  eventLog.join(",") !==
    [
      ...bufferMethodLabels.map((key) => "buffer:" + key),
      "buffer:iterator",
      "buffer:toPrimitive",
    ].join(",")
)
  throw new Error("Buffer inspection instrumentation is not live");
localInspectionHits = 0;
eventLog.length = 0;

if (typeof exactRecordObserver !== "function")
  throw new Error("exactRecord observer was not linked");
const observerCarrier = makeCarrier(
  "0000000000000001-" + "0".repeat(64) + ".jsonl",
  Buffer.from("{}\n", "utf8"),
);
probeKind = "observer-self-test";
try {
  exactRecordObserver(
    observerCarrier,
    ["name", "bytes"],
    "record reference",
    (message) => {
      throw new TypeError(message);
    },
  );
} finally {
  probeKind = null;
}
if (
  exactRecordCalls !== 1 ||
  otherExactRecordHits !== 1 ||
  eventLog.join(",") !==
    "exact-record-other-start,exact-record-other-accepted"
) {
  throw new Error("exactRecord all-call instrumentation is not live");
}
exactRecordCalls = 0;
otherExactRecordHits = 0;
eventLog.length = 0;

smallCarrier = makeCarrier(controlName, controlBytes);
instrumentBuffer(controlBytes);
rawLengthAccepted = false;
probeKind = "small";
let smallVerified;
try {
  smallVerified =
    root.namespace.verifyCandidateContainmentRecoveryRecordV1(smallCarrier);
} finally {
  probeKind = null;
}
if (smallVerified.rawSha256 !== createHash("sha256").update(smallExpectedBytes).digest("hex"))
  throw new Error("small canonical control did not verify exactly");
if (
  smallLengthHits < 1 ||
  smallDecodeHits < 1 ||
  smallSha256Hits < 1 ||
  smallCopyHits < 1
)
  throw new Error("small canonical control did not exercise all exact helpers");
if (smallPreflightHits !== 1)
  throw new Error("small canonical control did not exercise one exact preflight");
if (localInspectionHits !== 0)
  throw new Error("small canonical control used a VM-local byte path");
const smallRequiredPrefix = [
  "record-preflight-start",
  "record-preflight-accepted",
  "intrinsic-length-start",
  "intrinsic-length-accepted",
];
if (
  eventLog.slice(0, smallRequiredPrefix.length).join(",") !==
  smallRequiredPrefix.join(",")
) {
  throw new Error("small raw-bound event prefix changed: " + eventLog.join(","));
}
const smallLengthStart = eventLog.indexOf("intrinsic-length-start");
for (const laterEvent of [
  "decode",
  "sha256",
  "copy",
  "exact-record-other-start",
]) {
  const laterIndex = eventLog.indexOf(laterEvent);
  if (laterIndex !== -1 && laterIndex < smallLengthStart)
    throw new Error(laterEvent + " preceded the intrinsic raw length guard");
}

const oversizedValue = {
  attempt: null,
  evidence: null,
  nextState: null,
  operation: null,
  previousRecordRawSha256: "0".repeat(64),
  priorState: null,
  recordType: "RECOVERY_ATTEMPT_DURABLE",
  schema: "",
  sequence: "0000000000000001",
  targetSha256: "0".repeat(64),
};
const emptyLine = JSON.stringify(oversizedValue) + "\n";
oversizedValue.schema = "x".repeat(65_537 - Buffer.byteLength(emptyLine));
const oversizedText = JSON.stringify(oversizedValue) + "\n";
oversizedBytes = Buffer.from(oversizedText, "utf8");
if (oversizedBytes.length !== 65_537)
  throw new Error("oversized canonical carrier is not exactly 65,537 bytes");
if (Object.keys(oversizedValue).length !== 10)
  throw new Error("oversized canonical carrier does not have ten fields");
if (
  Object.keys(oversizedValue).join(",") !==
  Object.keys(oversizedValue).toSorted().join(",")
)
  throw new Error("oversized carrier keys are not in canonical order");
if (JSON.stringify(JSON.parse(oversizedText)) + "\n" !== oversizedText)
  throw new Error("oversized carrier is not ordinary canonical JSONL");
const oversizedName =
  "0000000000000001-" +
  createHash("sha256").update(oversizedBytes).digest("hex") +
  ".jsonl";
oversizedCarrier = makeCarrier(oversizedName, oversizedBytes);
instrumentBuffer(oversizedBytes);
eventLog.length = 0;
localInspectionHits = 0;
exactRecordCalls = 0;
otherExactRecordHits = 0;
rawLengthAccepted = false;
let rejected = false;
probeKind = "oversized";
try {
  root.namespace.verifyCandidateContainmentRecoveryRecordV1(oversizedCarrier);
} catch {
  rejected = true;
} finally {
  probeKind = null;
}
if (!rejected) throw new Error("oversized standalone record was accepted");
if (oversizedLengthHits !== 1)
  throw new Error("oversized standalone record did not hit one raw length guard");
if (oversizedSha256Hits !== 0)
  throw new Error("oversized standalone record reached imported sha256");
if (oversizedDecodeHits !== 0)
  throw new Error("oversized standalone record reached canonical decoder");
if (oversizedCopyHits !== 0)
  throw new Error("oversized standalone record reached byte copying");
if (oversizedPreflightHits !== 1)
  throw new Error("oversized standalone record missed its exact preflight");
if (exactRecordCalls !== 1)
  throw new Error("oversized standalone record ran unexpected exactRecord work");
if (otherExactRecordHits !== 0)
  throw new Error("oversized standalone record reached later exactRecord work");
if (localInspectionHits !== 0)
  throw new Error("oversized standalone record used a VM-local byte path");
if (
  eventLog.join(",") !==
  "record-preflight-start,record-preflight-accepted,intrinsic-length-start,intrinsic-length-rejected"
)
  throw new Error("oversized raw-bound event order changed: " + eventLog.join(","));

const proxyState = { hits: 0 };
const proxyCarrier = new Proxy(
  makeCarrier(oversizedName, oversizedBytes),
  {
    defineProperty() {
      proxyState.hits++;
      throw new Error("proxy defineProperty trap ran");
    },
    deleteProperty() {
      proxyState.hits++;
      throw new Error("proxy deleteProperty trap ran");
    },
    get() {
      proxyState.hits++;
      throw new Error("proxy get trap ran");
    },
    getOwnPropertyDescriptor() {
      proxyState.hits++;
      throw new Error("proxy descriptor trap ran");
    },
    getPrototypeOf() {
      proxyState.hits++;
      throw new Error("proxy prototype trap ran");
    },
    has() {
      proxyState.hits++;
      throw new Error("proxy has trap ran");
    },
    isExtensible() {
      proxyState.hits++;
      throw new Error("proxy isExtensible trap ran");
    },
    ownKeys() {
      proxyState.hits++;
      throw new Error("proxy ownKeys trap ran");
    },
    preventExtensions() {
      proxyState.hits++;
      throw new Error("proxy preventExtensions trap ran");
    },
    set() {
      proxyState.hits++;
      throw new Error("proxy set trap ran");
    },
    setPrototypeOf() {
      proxyState.hits++;
      throw new Error("proxy setPrototypeOf trap ran");
    },
  },
);
let proxyRejected = false;
try {
  root.namespace.verifyCandidateContainmentRecoveryRecordV1(proxyCarrier);
} catch {
  proxyRejected = true;
}
if (!proxyRejected || proxyState.hits !== 0)
  throw new Error("hostile record-reference Proxy was inspected");

const accessorState = { hits: 0 };
const accessorCarrier = vm.runInContext("Object.create(null)", context);
Object.defineProperties(accessorCarrier, {
  name: {
    configurable: true,
    enumerable: true,
    get() {
      accessorState.hits++;
      throw new Error("record-reference name getter ran");
    },
  },
  bytes: {
    configurable: true,
    enumerable: true,
    get() {
      accessorState.hits++;
      throw new Error("record-reference bytes getter ran");
    },
  },
});
let accessorRejected = false;
try {
  root.namespace.verifyCandidateContainmentRecoveryRecordV1(accessorCarrier);
} catch {
  accessorRejected = true;
}
if (!accessorRejected || accessorState.hits !== 0)
  throw new Error("hostile record-reference accessor was invoked");

console.log("oversized-canonical-record-rejected-after-trap-free-preflight");
`;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--input-type=module",
      "-e",
      child,
      RECOVERY_SOURCE_PATH,
      controlArtifact.name,
      controlArtifact.bytes.toString("base64"),
    ],
    { encoding: "utf8" },
  );
  // Node 20 may emit only its ExperimentalWarning for vm modules on stderr.
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    /oversized-canonical-record-rejected-after-trap-free-preflight/u,
  );
});

test("keeps recovery authority, nonclaims, and physical facts exact and null", () => {
  assert.deepEqual(
    Object.keys(recovery.CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1),
    AUTHORITY_KEYS,
  );
  assert.deepEqual(
    plain(recovery.CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1),
    EXPECTED_AUTHORITY,
  );
  assert.deepEqual(
    Object.keys(recovery.CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1),
    NONCLAIM_KEYS,
  );
  assert.deepEqual(
    plain(recovery.CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1),
    EXPECTED_NONCLAIMS,
  );
  assert.deepEqual(
    Object.keys(recovery.CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1),
    [
      ...NULL_PHYSICAL_FACT_KEYS,
      "physicalEligibility",
      "finalDecisionEligibility",
      "productionContainment",
    ],
  );
  assert.deepEqual(
    plain(recovery.CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1),
    EXPECTED_PHYSICAL_FACTS,
  );
  for (const value of [
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_AUTHORITY_V1,
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_NONCLAIMS_V1,
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_PHYSICAL_FACTS_V1,
  ])
    assertNullPrototypeFrozen(value);
});

test("derives and verifies a canonical target from real journal-v2 and branded lifetime-v1 artifacts", () => {
  const fixture = new RecoveryLifetimeFixture("target", { bundleCount: 3 });
  const evaluatorDerived =
    independentlyDeriveRecoveryTargetFromFixtureArtifacts(fixture.journal);
  const projection =
    recovery.deriveCandidateContainmentRecoveryTargetProjectionV1({
      generationManifest: artifact(fixture.journal.generationManifest),
      normalJournalBundles: fixture.journal.normalJournalBundles.map(artifact),
    });
  assert.deepEqual(Object.keys(projection), [
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
  assert.equal(projection.schema, SCHEMAS.lifetimeTarget);
  assert.equal(
    projection.latestNormalState,
    "CGROUPS_CONFIGURED_EMPTY_OBSERVED",
  );
  assert.deepEqual(plain(projection), evaluatorDerived.projection);
  assert.equal(
    evaluatorDerived.target.targetSha256,
    semanticSha256(
      Object.fromEntries(
        TARGET_KEYS.slice(0, -1).map((key) => [
          key,
          plain(evaluatorDerived.target[key]),
        ]),
      ),
    ),
  );
  assert.equal(
    evaluatorDerived.projection.projectionSha256,
    semanticSha256(
      Object.fromEntries(
        Object.keys(evaluatorDerived.projection)
          .slice(0, -1)
          .map((key) => [key, plain(evaluatorDerived.projection[key])]),
      ),
    ),
  );
  assertNullPrototypeFrozen(projection);
  const target = fixture.installRecoveryTarget(recovery);
  assert.deepEqual(Object.keys(target), TARGET_KEYS);
  assert.equal(target.schema, SCHEMAS.target);
  assert.equal(
    target.generationManifestRawSha256,
    fixture.journal.generationManifest.rawSha256,
  );
  assert.equal(
    target.targetSha256,
    semanticSha256(
      Object.fromEntries(
        TARGET_KEYS.slice(0, -1).map((key) => [key, plain(target[key])]),
      ),
    ),
  );
  assertNullPrototypeFrozen(target);
  const verified = fixture.refreshTarget(recovery);
  assert.deepEqual(plain(verified), plain(target));
  assertNullPrototypeFrozen(verified);
});

test("re-verifies the complete journal-v2 chain and rejects target omission, fork, substitution, drift, and foreign brands", () => {
  const fixture = new RecoveryLifetimeFixture("target-adversarial", {
    bundleCount: 5,
  });
  const target = fixture.installRecoveryTarget(recovery);
  const manifest = artifact(fixture.journal.generationManifest);
  const bundles = fixture.journal.normalJournalBundles.map(artifact);
  const selection = fixture.targetSelection();
  const derive = (normalJournalBundles, generationManifest = manifest) =>
    recovery.deriveCandidateContainmentRecoveryTargetProjectionV1({
      generationManifest,
      normalJournalBundles,
    });
  const verify = (
    normalJournalBundles,
    generationManifest = manifest,
    lifetimeTargetSelection = selection,
  ) =>
    recovery.verifyCandidateContainmentRecoveryTargetV1({
      target,
      generationManifest,
      normalJournalBundles,
      lifetimeTargetSelection,
    });

  const omittedTail = bundles.slice(0, -1);
  const omittedMiddle = bundles.toSpliced(2, 1);
  const reordered = bundles.toSpliced(1, 2, bundles[2], bundles[1]);
  const duplicated = bundles.toSpliced(2, 1, bundles[1]);
  const corruptedBytes = Buffer.from(bundles[3].bytes);
  corruptedBytes[Math.floor(corruptedBytes.length / 2)] ^= 1;
  const corrupted = bundles.with(3, {
    name: bundles[3].name,
    bytes: corruptedBytes,
  });
  const forked = forkJournalBundleChain(
    fixture.journal,
    2,
    "alternate-valid-tail",
  ).map(artifact);
  const foreign = new RecoveryLifetimeFixture("target-foreign", {
    bundleCount: 5,
  });
  const substituted = foreign.journal.normalJournalBundles.map(artifact);
  const driftedManifest = mutatedJsonlArtifact(
    manifest,
    (value) => {
      value.generationIdentity.bootIdSha256 = digest(
        "target-adversarial:drifted-manifest-boot",
      );
    },
    "generation.jsonl",
  );

  for (const chain of [
    omittedTail,
    omittedMiddle,
    reordered,
    duplicated,
    corrupted,
    forked,
    substituted,
  ]) {
    assertContractReject(() => verify(chain));
  }
  for (const chain of [omittedMiddle, reordered, duplicated, corrupted]) {
    assertContractReject(() => derive(chain));
  }
  assertContractReject(() => derive(bundles, driftedManifest));
  assertContractReject(() => verify(bundles, driftedManifest));
  const fullProjection = derive(bundles);
  assert.notDeepEqual(plain(derive(omittedTail)), plain(fullProjection));
  assert.notDeepEqual(plain(derive(forked)), plain(fullProjection));

  assertContractReject(() => verify(bundles, manifest, plain(selection)));
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryTargetV1({
      generationManifest: manifest,
      normalJournalBundles: bundles,
      lifetimeTargetSelection: plain(selection),
    }),
  );

  const byteEqualFixture = new RecoveryLifetimeFixture("target-adversarial", {
    bundleCount: 5,
  });
  byteEqualFixture.installRecoveryTarget(recovery);
  const byteEqualSelection = byteEqualFixture.targetSelection();
  assert.deepEqual(plain(byteEqualSelection), plain(selection));
  assert.notEqual(byteEqualSelection, selection);
  assertContractReject(() => verify(bundles, manifest, byteEqualSelection));
});

test("target verifier reconstructs an exact unbranded clone and exhaustively rejects field drift", () => {
  const context = buildGenesis("target-structural-verifier", {
    bundleCount: 3,
  });
  const generationManifest = artifact(
    context.fixture.journal.generationManifest,
  );
  const normalJournalBundles =
    context.fixture.journal.normalJournalBundles.map(artifact);
  const lifetimeTargetSelection = context.fixture.targetSelection();
  assertVerifierNormalizesUnbrandedClone({
    label: "target",
    value: context.target,
    keys: TARGET_KEYS,
    verify: (target) =>
      recovery.verifyCandidateContainmentRecoveryTargetV1({
        target,
        generationManifest,
        normalJournalBundles,
        lifetimeTargetSelection,
      }),
    downstream: (target) =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, target, {
          entries: [],
          expectedExternalHead: context.fixture.headSelection(),
        }),
      ),
  });
});

test("creates and verifies the canonical bounded lifecycle inventory", () => {
  const fixture = new RecoveryLifetimeFixture("inventory");
  const input = inventoryInput(
    fixture.journal.generationIdentity.identitySha256,
    "active",
  );
  const observation =
    recovery.createCandidateContainmentRecoveryInventoryObservationV1(input);
  assert.deepEqual(Object.keys(observation), INVENTORY_KEYS);
  assert.deepEqual(plain(observation), {
    schema: SCHEMAS.inventory,
    ...input,
    inventorySha256: semanticSha256({ schema: SCHEMAS.inventory, ...input }),
  });
  assertNullPrototypeFrozen(observation);
  assert.deepEqual(
    plain(
      recovery.verifyCandidateContainmentRecoveryInventoryObservationV1({
        observation,
        expectedGenerationIdentitySha256: input.generationIdentitySha256,
      }),
    ),
    plain(observation),
  );
  assertContractReject(() =>
    recovery.verifyCandidateContainmentRecoveryInventoryObservationV1({
      observation,
      expectedGenerationIdentitySha256: digest("wrong-generation"),
    }),
  );
});

test("inventory verifier reconstructs an exact unbranded clone and exhaustively rejects field drift", () => {
  const context = buildGenesis("inventory-structural-verifier", {
    location: "active",
  });
  assertVerifierNormalizesUnbrandedClone({
    label: "inventory",
    value: context.inventory,
    keys: INVENTORY_KEYS,
    verify: (observation) =>
      recovery.verifyCandidateContainmentRecoveryInventoryObservationV1({
        observation,
        expectedGenerationIdentitySha256:
          context.fixture.journal.generationIdentity.identitySha256,
      }),
    downstream: (lifecycleInventoryObservation) =>
      recovery.planCandidateContainmentRecoveryV1(
        planInput(
          context.fixture,
          context.target,
          lifecycleInventoryObservation,
          context.zeroReplay,
        ),
      ),
  });
});

test("returns the exact externally anchored zero-entry replay", () => {
  const context = buildGenesis("zero-replay");
  assert.deepEqual(Object.keys(context.zeroReplay), REPLAY_KEYS);
  assert.equal(context.zeroReplay.status, "NO_RECOVERY_ATTEMPT");
  assert.equal(context.zeroReplay.targetSha256, context.target.targetSha256);
  assert.equal(context.zeroReplay.attemptCount, 0);
  assert.equal(context.zeroReplay.recordCount, 0);
  assert.equal(context.zeroReplay.latestRecoveryRecordRawSha256, ZERO_SHA256);
  assert.equal(context.zeroReplay.internalHashChainValidated, true);
  assert.equal(context.zeroReplay.targetBindingsMatched, true);
  assert.equal(context.zeroReplay.lifetimeAnchorBindingsMatched, null);
  assert.equal(context.zeroReplay.externalTailHeadMatched, true);
  assert.equal(context.zeroReplay.tailCompletenessExternallyAnchored, true);
  assert.equal(context.zeroReplay.stateRootIdentityAnchorMatched, null);
  assert.equal(context.zeroReplay.chainTerminal, false);
  assertBoundarySummary(context.zeroReplay);
});

test("enforces phase one anchor-required then phase two ready with one retained boundary set", () => {
  const context = addReadyAnchor(buildGenesis("two-phase"));
  assert.deepEqual(Object.keys(context.phaseOne), PLAN_KEYS);
  assert.equal(context.phaseOne.status, "RECOVERY_ANCHOR_REQUIRED");
  assert.equal(context.phaseOne.requiredActorKind, "LIVE_BIRTH_GUARDIAN");
  assert.equal(context.phaseOne.currentLifetimeAnchorMatched, false);
  assert.deepEqual(context.phaseOne.states, []);
  assert.equal(context.phaseOne.recordCount, 0);
  assertBoundarySummary(context.phaseOne);
  assert.deepEqual(Object.keys(context.plan), PLAN_KEYS);
  assert.equal(context.plan.status, "RECOVERY_PLAN_READY");
  assert.equal(context.plan.currentLifetimeAnchorMatched, true);
  assert.equal(context.plan.disposition, "GENESIS_ABORT");
  assert.deepEqual(context.plan.states, PLAN_STATES.GENESIS_ABORT);
  assert.deepEqual(context.plan.nextPermittedRecordTypes, [
    "RECOVERY_ATTEMPT_DURABLE",
  ]);
  assert.equal(context.plan.recordCount, 5);
  assertBoundarySummary(context.plan);
});

test("creates and re-verifies the exact canonical first attempt", () => {
  const context = createAttempt(addReadyAnchor(buildGenesis("attempt")));
  assert.deepEqual(Object.keys(context.attempt), ATTEMPT_KEYS);
  assert.equal(context.attempt.schema, SCHEMAS.attempt);
  assert.equal(context.attempt.targetSha256, context.target.targetSha256);
  assert.equal(context.attempt.actorKind, "LIVE_BIRTH_GUARDIAN");
  assert.equal(context.attempt.previousRecoveryActorEpochSha256, null);
  assert.equal(context.attempt.previousAttemptDirectoryName, null);
  assert.equal(context.attempt.previousRecoveryRecordSequence, null);
  assert.equal(context.attempt.previousRecoveryRecordRawSha256, ZERO_SHA256);
  assert.equal(
    context.attempt.attemptSha256,
    semanticSha256(
      Object.fromEntries(
        ATTEMPT_KEYS.slice(0, -1).map((key) => [
          key,
          plain(context.attempt[key]),
        ]),
      ),
    ),
  );
  assertNullPrototypeFrozen(context.attempt);
  const verified = recovery.verifyCandidateContainmentRecoveryAttemptV1({
    attempt: context.attempt,
    target: context.target,
    lifecycleInventoryObservation: context.inventory,
    previousRecoveryReplay: context.replay,
    plan: context.plan,
    lifetimeAnchorProjection: context.anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      context.anchorSelection.lifetimeAttemptAnchorRawSha256,
  });
  assert.deepEqual(plain(verified), plain(context.attempt));
});

test("attempt verifier reconstructs an exact unbranded clone and exhaustively rejects field drift", () => {
  const context = createAttempt(
    addReadyAnchor(buildGenesis("attempt-structural-verifier")),
  );
  const verificationContext = {
    target: context.target,
    lifecycleInventoryObservation: context.inventory,
    previousRecoveryReplay: context.replay,
    plan: context.plan,
    lifetimeAnchorProjection: context.anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      context.anchorSelection.lifetimeAttemptAnchorRawSha256,
  };
  assertVerifierNormalizesUnbrandedClone({
    label: "attempt",
    value: context.attempt,
    keys: ATTEMPT_KEYS,
    verify: (attempt) =>
      recovery.verifyCandidateContainmentRecoveryAttemptV1({
        attempt,
        ...verificationContext,
      }),
    downstream: (attempt) =>
      recovery.createCandidateContainmentRecoveryRecordV1({
        ...verificationContext,
        attempt,
        previousRecord: null,
        operationBytes: jsonLine(opaque("attempt-verifier:operation")),
        evidenceBytes: jsonLine(plain(context.inventory)),
      }),
  });
});

test("creates canonical copy-on-read recovery records and never upgrades standalone claims", () => {
  const context = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("record"))),
    1,
  );
  const record = context.records[0];
  const operationBytes = jsonLine(
    opaque("record:RECOVERY_ATTEMPT_DURABLE:operation"),
  );
  const evidenceBytes = jsonLine(plain(context.inventory));
  const recordContext = {
    sequence: "0000000000000001",
    recordType: "RECOVERY_ATTEMPT_DURABLE",
    priorState: null,
    previousRecordRawSha256: ZERO_SHA256,
    targetSha256: context.target.targetSha256,
    attempt: context.attempt,
  };
  const operation = recordDescriptor(
    "operation",
    recordContext,
    operationBytes,
  );
  const evidence = recordDescriptor("evidence", recordContext, evidenceBytes);
  const value = {
    schema: SCHEMAS.record,
    sequence: recordContext.sequence,
    recordType: recordContext.recordType,
    priorState: null,
    nextState: recordContext.recordType,
    previousRecordRawSha256: ZERO_SHA256,
    targetSha256: context.target.targetSha256,
    attempt: plain(context.attempt),
    operation,
    evidence,
  };
  assert.deepEqual(Object.keys(record), RECORD_WRAPPER_KEYS);
  assert.deepEqual(record.bytes, jsonLine(value));
  assert.equal(record.rawSha256, sha256(jsonLine(value)));
  assert.equal(record.semanticSha256, semanticSha256(value));
  assert.equal(record.standaloneRecordHashChainValidated, false);
  assert.equal(record.planValidated, false);
  assert.equal(record.embeddedArtifactBindingsValidated, true);
  const descriptor = Object.getOwnPropertyDescriptor(record, "bytes");
  assert.equal(descriptor.enumerable, true);
  assert.equal(typeof descriptor.get, "function");
  const first = record.bytes;
  const second = record.bytes;
  assert.notEqual(first, second);
  first.fill(0);
  assert.deepEqual(record.bytes, second);
  assertNullPrototypeFrozen(record);
  const verified = recovery.verifyCandidateContainmentRecoveryRecordV1(
    artifact(record),
  );
  assert.deepEqual(verified.bytes, second);
  assert.notEqual(verified.bytes, verified.bytes);
  assert.equal(verified.standaloneRecordHashChainValidated, false);
  assert.equal(verified.planValidated, false);
  assertNullPrototypeFrozen(verified);
});

test("binds record one to the exact lifecycle inventory and re-verifies serialized predecessors", () => {
  const context = createAttempt(
    addReadyAnchor(buildGenesis("record-predecessor-verifier")),
  );
  const create = (previousRecord, operationBytes, evidenceBytes) =>
    recovery.createCandidateContainmentRecoveryRecordV1({
      target: context.target,
      lifecycleInventoryObservation: context.inventory,
      previousRecoveryReplay: context.replay,
      plan: context.plan,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: context.attempt,
      previousRecord,
      operationBytes,
      evidenceBytes,
    });
  const first = create(
    null,
    jsonLine(opaque("record-predecessor:first-operation")),
    jsonLine(plain(context.inventory)),
  );
  assert.equal(first.sequence, "0000000000000001");
  const wrongInventory =
    recovery.createCandidateContainmentRecoveryInventoryObservationV1(
      inventoryInput(
        context.fixture.journal.generationIdentity.identitySha256,
        "active",
      ),
    );
  assert.notEqual(
    wrongInventory.inventorySha256,
    context.inventory.inventorySha256,
  );
  assertContractReject(() =>
    create(
      null,
      jsonLine(opaque("record-predecessor:wrong-inventory-operation")),
      jsonLine(plain(wrongInventory)),
    ),
  );

  const serializedPrevious = artifact(first);
  const second = create(
    serializedPrevious,
    jsonLine(opaque("record-predecessor:second-operation")),
    jsonLine(opaque("record-predecessor:second-evidence")),
  );
  assert.equal(second.sequence, "0000000000000002");
  assert.equal(second.previousRecordRawSha256, first.rawSha256);
  for (const wrongPreviousRecord of [
    {
      name: `${serializedPrevious.name}.wrong`,
      bytes: serializedPrevious.bytes,
    },
    {
      name: serializedPrevious.name,
      bytes: Buffer.concat([serializedPrevious.bytes, Buffer.from("\n")]),
    },
  ]) {
    assertContractReject(() =>
      create(
        wrongPreviousRecord,
        jsonLine(opaque("record-predecessor:rejected-operation")),
        jsonLine(opaque("record-predecessor:rejected-evidence")),
      ),
    );
  }
});

test("replays a structural record prefix under the current anchor without inflating provenance", () => {
  const context = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("prefix"))),
    1,
  );
  const replay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, context.target, {
      entries: [entryFrom(context)],
      expectedExternalHead: null,
      currentAnchorSelection: context.anchorSelection,
      currentAnchorPredecessorExternalHead: context.predecessorHead,
    }),
  );
  assert.equal(replay.status, "VALID_RECOVERY_PREFIX_REPLAYED");
  assert.equal(replay.attemptCount, 1);
  assert.equal(replay.recordCount, 1);
  assert.equal(replay.latestAttemptState, "RECOVERY_ATTEMPT_DURABLE");
  assert.equal(replay.nextRequiredState, "GENESIS_ABORT_RECOVERY_REQUIRED");
  assert.equal(replay.externalTailHeadMatched, null);
  assert.equal(replay.tailCompletenessExternallyAnchored, false);
  assert.equal(replay.tailDeletionExcludedByInternalReplay, false);
  assert.equal(replay.suppliedAnchorOriginProven, false);
  assertBoundarySummary(replay);
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: [entryFrom(context)],
        expectedExternalHead: context.predecessorHead,
        currentAnchorSelection: context.anchorSelection,
        currentAnchorPredecessorExternalHead: context.predecessorHead,
      }),
    ),
  );
});

test("replays a complete recovered plan against the exact later lifetime result head", () => {
  let context = createAttempt(
    addReadyAnchor(buildGenesis("complete-recovered")),
  );
  context = createPlanRecords(context);
  const last = context.records.at(-1);
  const head = recoveryExternalHead({
    targetSha256: context.target.targetSha256,
    result: "RECOVERED",
    recoveryActorEpochSha256: context.attempt.recoveryActorEpochSha256,
    attemptDirectoryName: context.attempt.attemptDirectoryName,
    lifetimeAttemptAnchorRawSha256:
      context.attempt.lifetimeAttemptAnchorRawSha256,
    latestRecoveryRecordSequence: last.sequence,
    latestRecoveryRecordRawSha256: last.rawSha256,
  });
  context.fixture.appendResult(head);
  const target = context.fixture.refreshTarget(recovery);
  const anchorSelection = context.fixture.anchorSelection();
  const expectedExternalHead = context.fixture.headSelection();
  const replay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, target, {
      entries: [entryFrom(context, anchorSelection)],
      expectedExternalHead,
    }),
  );
  assert.equal(replay.status, "COMPLETE_RECOVERED_REPLAYED");
  assert.equal(replay.latestAttemptState, "RECOVERED_LOCATION_OBSERVED");
  assert.equal(replay.inheritedTerminalDecision, "RECOVERED");
  assert.equal(replay.externalTailHeadMatched, true);
  assert.equal(replay.chainTerminal, true);
  assertBoundarySummary(replay);
});

test("replays the exact quarantine plan and complete quarantined terminal status", () => {
  let context = addReadyAnchor(buildGenesis("complete-quarantined"), {
    reportedCurrentBootIdSha256: null,
  });
  assert.equal(context.plan.status, "RECOVERY_PLAN_READY");
  assert.equal(context.plan.disposition, "QUARANTINE");
  assert.equal(context.plan.quarantineReason, "UNKNOWN_BOOT_ID");
  assert.deepEqual(context.plan.states, PLAN_STATES.QUARANTINE);
  context = createPlanRecords(createAttempt(context));
  const last = context.records.at(-1);
  const head = recoveryExternalHead({
    targetSha256: context.target.targetSha256,
    result: "QUARANTINED",
    recoveryActorEpochSha256: context.attempt.recoveryActorEpochSha256,
    attemptDirectoryName: context.attempt.attemptDirectoryName,
    lifetimeAttemptAnchorRawSha256:
      context.attempt.lifetimeAttemptAnchorRawSha256,
    latestRecoveryRecordSequence: last.sequence,
    latestRecoveryRecordRawSha256: last.rawSha256,
  });
  context.fixture.appendResult(head);
  const target = context.fixture.refreshTarget(recovery);
  const anchorSelection = context.fixture.anchorSelection();
  const replay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, target, {
      entries: [entryFrom(context, anchorSelection)],
      expectedExternalHead: context.fixture.headSelection(),
    }),
  );
  assert.equal(replay.status, "COMPLETE_QUARANTINED_REPLAYED");
  assert.equal(replay.latestAttemptState, "QUARANTINED_LOCATION_OBSERVED");
  assert.equal(replay.inheritedTerminalDecision, "QUARANTINED");
  assert.equal(replay.chainTerminal, true);
  assertBoundarySummary(replay);
});

test("matches exact whole replay results for zero, prefix, empty, recovered, and quarantined statuses", () => {
  const zero = buildGenesis("whole-replay-zero");
  assertExactReplayResult(
    zero.zeroReplay,
    expectedReplayFields(zero.target.targetSha256),
  );

  const prefix = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("whole-replay-prefix"))),
    1,
  );
  const prefixReplay = replayCurrentAttemptPrefix(prefix, 1);
  assertExactReplayResult(
    prefixReplay,
    expectedReplayFields(prefix.target.targetSha256, {
      status: "VALID_RECOVERY_PREFIX_REPLAYED",
      attemptCount: 1,
      finalizedAttemptCount: 1,
      recordCount: 1,
      latestRecoveryActorEpochSha256: prefix.attempt.recoveryActorEpochSha256,
      latestAttemptDirectoryName: prefix.attempt.attemptDirectoryName,
      latestRecoveryRecordSequence: prefix.records[0].sequence,
      latestRecoveryRecordRawSha256: prefix.records[0].rawSha256,
      latestAttemptState: "RECOVERY_ATTEMPT_DURABLE",
      latestFinalizedRecoveryState: "RECOVERY_ATTEMPT_DURABLE",
      latestExpectedCurrentBootIdSha256:
        prefix.anchor.projection.expectedCurrentBootIdSha256,
      latestExpectedDelegatedRootIdentitySha256:
        prefix.anchor.projection.expectedDelegatedRootIdentitySha256,
      latestExpectedLifetimeCgroupIdentitySha256:
        prefix.anchor.projection.expectedLifetimeCgroupIdentitySha256,
      nextRequiredState: "GENESIS_ABORT_RECOVERY_REQUIRED",
      lifetimeAnchorBindingsMatched: true,
      lifecycleInventoryBindingsMatched: true,
      recordPlanBindingsMatched: true,
      externalTailHeadMatched: null,
      tailCompletenessExternallyAnchored: false,
      stateRootIdentityAnchorMatched: true,
      bootIdentityRelationshipsValidated: true,
      delegatedRootIdentityRelationshipsValidated: true,
      lifetimeCgroupIdentityAnchorsMatched: true,
    }),
  );

  const empty = publishAnchoredEmptyAttempt(
    addReadyAnchor(buildGenesis("whole-replay-empty")),
    "PRESENT_EMPTY",
  );
  assertExactReplayResult(
    empty.zeroReplay,
    expectedReplayFields(empty.target.targetSha256, {
      status: "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED",
      attemptCount: 1,
      anchoredEmptyAttemptCount: 1,
      latestRecoveryActorEpochSha256:
        empty.anchoredEmptyAttempt.recoveryActorEpochSha256,
      latestAttemptDirectoryName:
        empty.anchoredEmptyAttempt.attemptDirectoryName,
      latestExpectedCurrentBootIdSha256:
        empty.anchor.projection.expectedCurrentBootIdSha256,
      latestExpectedDelegatedRootIdentitySha256:
        empty.anchor.projection.expectedDelegatedRootIdentitySha256,
      latestExpectedLifetimeCgroupIdentitySha256:
        empty.anchor.projection.expectedLifetimeCgroupIdentitySha256,
      lifetimeAnchorBindingsMatched: true,
      externalTailHeadMatched: true,
      tailCompletenessExternallyAnchored: true,
      stateRootIdentityAnchorMatched: true,
      bootIdentityRelationshipsValidated: true,
      delegatedRootIdentityRelationshipsValidated: true,
      lifetimeCgroupIdentityAnchorsMatched: true,
    }),
  );

  let recovered = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("whole-replay-recovered"))),
  );
  recovered = publishFinalizedAttempt(recovered, "RECOVERED");
  const recoveredLast = recovered.records.at(-1);
  assertExactReplayResult(
    recovered.zeroReplay,
    expectedReplayFields(recovered.target.targetSha256, {
      status: "COMPLETE_RECOVERED_REPLAYED",
      attemptCount: 1,
      finalizedAttemptCount: 1,
      recordCount: recovered.records.length,
      latestRecoveryActorEpochSha256:
        recovered.attempt.recoveryActorEpochSha256,
      latestAttemptDirectoryName: recovered.attempt.attemptDirectoryName,
      latestRecoveryRecordSequence: recoveredLast.sequence,
      latestRecoveryRecordRawSha256: recoveredLast.rawSha256,
      latestAttemptState: "RECOVERED_LOCATION_OBSERVED",
      latestFinalizedRecoveryState: "RECOVERED_LOCATION_OBSERVED",
      latestExpectedCurrentBootIdSha256:
        recovered.anchor.projection.expectedCurrentBootIdSha256,
      latestExpectedDelegatedRootIdentitySha256:
        recovered.anchor.projection.expectedDelegatedRootIdentitySha256,
      latestExpectedLifetimeCgroupIdentitySha256:
        recovered.anchor.projection.expectedLifetimeCgroupIdentitySha256,
      inheritedTerminalDecision: "RECOVERED",
      decisionSourceLocation: "staging",
      lifetimeAnchorBindingsMatched: true,
      lifecycleInventoryBindingsMatched: true,
      recordPlanBindingsMatched: true,
      stateRootIdentityAnchorMatched: true,
      bootIdentityRelationshipsValidated: true,
      delegatedRootIdentityRelationshipsValidated: true,
      lifetimeCgroupIdentityAnchorsMatched: true,
      chainTerminal: true,
    }),
  );

  let quarantined = createPlanRecords(
    createAttempt(
      addReadyAnchor(buildGenesis("whole-replay-quarantined"), {
        reportedCurrentBootIdSha256: null,
      }),
    ),
  );
  quarantined = publishFinalizedAttempt(quarantined, "QUARANTINED");
  const quarantinedLast = quarantined.records.at(-1);
  assert.equal(quarantined.zeroReplay.derivedPriorEffectOutcomeCertain, true);
  assertExactReplayResult(
    quarantined.zeroReplay,
    expectedReplayFields(quarantined.target.targetSha256, {
      status: "COMPLETE_QUARANTINED_REPLAYED",
      attemptCount: 1,
      finalizedAttemptCount: 1,
      recordCount: quarantined.records.length,
      latestRecoveryActorEpochSha256:
        quarantined.attempt.recoveryActorEpochSha256,
      latestAttemptDirectoryName: quarantined.attempt.attemptDirectoryName,
      latestRecoveryRecordSequence: quarantinedLast.sequence,
      latestRecoveryRecordRawSha256: quarantinedLast.rawSha256,
      latestAttemptState: "QUARANTINED_LOCATION_OBSERVED",
      latestFinalizedRecoveryState: "QUARANTINED_LOCATION_OBSERVED",
      latestExpectedCurrentBootIdSha256:
        quarantined.anchor.projection.expectedCurrentBootIdSha256,
      latestExpectedDelegatedRootIdentitySha256:
        quarantined.anchor.projection.expectedDelegatedRootIdentitySha256,
      latestExpectedLifetimeCgroupIdentitySha256:
        quarantined.anchor.projection.expectedLifetimeCgroupIdentitySha256,
      inheritedTerminalDecision: "QUARANTINED",
      decisionSourceLocation: "staging",
      lifetimeAnchorBindingsMatched: true,
      lifecycleInventoryBindingsMatched: true,
      recordPlanBindingsMatched: true,
      stateRootIdentityAnchorMatched: true,
      bootIdentityRelationshipsValidated: true,
      delegatedRootIdentityRelationshipsValidated: true,
      lifetimeCgroupIdentityAnchorsMatched: true,
      chainTerminal: true,
    }),
  );
});

test("derives the exact 19-state same-boot maximum from a real normal state-5 head", () => {
  const context = addReadyAnchor(
    buildGenesis("same-boot", { bundleCount: 5, location: "active" }),
    {
      reportedCommandDescriptorHeld: true,
      reportedStatusDescriptorHeld: true,
      reportedSupervisorPidfdHeld: true,
      reportedDirectChildWaitAuthority: true,
      reportedControlCgroupPresent: true,
      reportedJobCgroupPresent: true,
    },
  );
  assert.equal(context.target.latestNormalState, "SUPERVISOR_EXEC_OBSERVED");
  assert.equal(context.plan.status, "RECOVERY_PLAN_READY");
  assert.equal(context.plan.disposition, "SAME_BOOT_RECONCILE");
  assert.deepEqual(
    context.plan.states,
    PLAN_STATES.SAME_BOOT_RECONCILE_MAXIMUM,
  );
  assert.equal(context.plan.recordCount, 19);
  assertBoundarySummary(context.plan);
});

test("executes every legal record state and reducer edge across exact plan alternatives and crash prefixes", () => {
  const genesis = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("all-records-genesis"))),
  );
  const maximum = createPlanRecords(
    createAttempt(
      addReadyAnchor(
        buildGenesis("all-records-maximum", {
          bundleCount: 5,
          location: "active",
        }),
        {
          reportedCommandDescriptorHeld: true,
          reportedStatusDescriptorHeld: true,
          reportedSupervisorPidfdHeld: true,
          reportedDirectChildWaitAuthority: true,
          reportedControlCgroupPresent: true,
          reportedJobCgroupPresent: true,
        },
      ),
    ),
  );
  const absentAndHup = createPlanRecords(
    createAttempt(
      addReadyAnchor(
        buildGenesis("all-records-absent-hup", {
          bundleCount: 15,
          location: "active",
        }),
        {
          reportedSupervisorPidfdHeld: true,
          reportedControlCgroupPresent: false,
          reportedJobCgroupPresent: false,
        },
      ),
    ),
  );
  assert.equal(
    absentAndHup.plan.states.includes("CONTROL_PATH_ABSENT_OBSERVED"),
    true,
  );
  assert.equal(
    absentAndHup.plan.states.includes("JOB_PATH_ABSENT_OBSERVED"),
    true,
  );
  assert.equal(
    absentAndHup.plan.states.includes("SUPERVISOR_PIDFD_HUP_OBSERVED"),
    true,
  );

  let rebootBase = buildGenesis("all-records-reboot", {
    location: "active",
  });
  rebootBase.fixture.startRebootRecovery();
  const rebootTarget = rebootBase.fixture.refreshTarget(recovery);
  const rebootHead = rebootBase.fixture.headSelection();
  const rebootReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(rebootBase.fixture, rebootTarget, {
      entries: [],
      expectedExternalHead: rebootHead,
    }),
  );
  const reboot = createPlanRecords(
    createAttempt(
      addReadyAnchor({
        ...rebootBase,
        target: rebootTarget,
        expectedExternalHead: rebootHead,
        zeroReplay: rebootReplay,
      }),
    ),
  );
  const quarantine = createPlanRecords(
    createAttempt(
      addReadyAnchor(buildGenesis("all-records-quarantine"), {
        reportedCurrentBootIdSha256: null,
      }),
    ),
  );

  const createResume = (label, firstOverrides, firstPrefixCount, result) => {
    let context = addReadyAnchor(
      buildGenesis(label, { location: "staging" }),
      firstOverrides,
    );
    context = createPlanRecords(createAttempt(context), firstPrefixCount);
    context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
    assert.equal(context.zeroReplay.inheritedTerminalDecision, result);
    context.fixture.appendNormalTermination();
    context = replayDurableHistory(context);
    context = addReadyAnchor(context, {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      ...firstOverrides,
    });
    return createPlanRecords(createAttempt(context));
  };
  const recoveredResume = createResume(
    "all-records-recovered-resume",
    {},
    4,
    "RECOVERED",
  );
  const quarantineResume = createResume(
    "all-records-quarantine-resume",
    { reportedCurrentBootIdSha256: null },
    2,
    "QUARANTINED",
  );

  const contexts = [
    genesis,
    maximum,
    absentAndHup,
    reboot,
    quarantine,
    recoveredResume,
    quarantineResume,
  ];
  const exercisedStates = new Set();
  for (const context of contexts) {
    assertExactRecordLineage(context);
    for (const [index, expectedState] of context.plan.states.entries()) {
      exercisedStates.add(expectedState);
      const replay = replayCurrentAttemptPrefix(context, index + 1);
      assert.equal(replay.recordCount, index + 1);
      assert.equal(replay.latestAttemptState, expectedState);
      assert.equal(replay.internalHashChainValidated, true);
      assert.equal(replay.recordPlanBindingsMatched, true);
      assertBoundarySummary(replay);
    }
  }
  assert.deepEqual([...exercisedStates].sort(), [...RECORD_STATES].sort());

  for (const unresolved of UNRESOLVED_EFFECT_INTENTS) {
    const index = maximum.plan.states.indexOf(unresolved);
    assert.notEqual(index, -1);
    const replay = replayCurrentAttemptPrefix(maximum, index + 1);
    assert.equal(replay.latestAttemptState, unresolved);
    assert.equal(replay.derivedPriorEffectOutcomeCertain, false);
    assert.equal(replay.chainTerminal, false);
  }

  const maximumEntry = entryFrom(maximum);
  for (const records of [
    maximumEntry.records.toSpliced(5, 1),
    maximumEntry.records.toSpliced(
      5,
      2,
      maximumEntry.records[6],
      maximumEntry.records[5],
    ),
    [...maximumEntry.records, maximumEntry.records.at(-1)],
  ]) {
    assertContractReject(() =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(maximum.fixture, maximum.target, {
          entries: [{ ...maximumEntry, records }],
          expectedExternalHead: null,
          currentAnchorSelection: maximum.anchorSelection,
          currentAnchorPredecessorExternalHead: maximum.predecessorHead,
        }),
      ),
    );
  }
});

test("rejects dense hash-rebound semantic surplus only during plan replay for every finite plan family", () => {
  const genesis = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("surplus-genesis"))),
  );
  const maximum = createPlanRecords(
    createAttempt(
      addReadyAnchor(
        buildGenesis("surplus-same-boot-maximum", {
          bundleCount: 5,
          location: "active",
        }),
        {
          reportedCommandDescriptorHeld: true,
          reportedStatusDescriptorHeld: true,
          reportedSupervisorPidfdHeld: true,
          reportedDirectChildWaitAuthority: true,
          reportedControlCgroupPresent: true,
          reportedJobCgroupPresent: true,
        },
      ),
    ),
  );
  let rebootBase = buildGenesis("surplus-reboot", { location: "active" });
  rebootBase.fixture.startRebootRecovery();
  rebootBase = refreshExternallyAnchoredReplay(rebootBase);
  const reboot = createPlanRecords(
    createAttempt(
      addReadyAnchor(rebootBase, {
        requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      }),
    ),
  );
  const quarantine = createPlanRecords(
    createAttempt(
      addReadyAnchor(buildGenesis("surplus-quarantine"), {
        reportedCurrentBootIdSha256: null,
      }),
    ),
  );
  const createResume = (label, decision) => {
    const firstOverrides =
      decision === "RECOVERED" ? {} : { reportedCurrentBootIdSha256: null };
    const prefixCount = decision === "RECOVERED" ? 4 : 2;
    let context = addReadyAnchor(
      buildGenesis(label, { location: "staging" }),
      firstOverrides,
    );
    context = createPlanRecords(createAttempt(context), prefixCount);
    context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
    context.fixture.appendNormalTermination();
    context = replayDurableHistory(context);
    context = addReadyAnchor(context, {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      ...firstOverrides,
    });
    return createPlanRecords(createAttempt(context));
  };
  const recoveredResume = createResume("surplus-recovered-resume", "RECOVERED");
  const quarantineResume = createResume(
    "surplus-quarantine-resume",
    "QUARANTINED",
  );

  const contexts = [
    genesis,
    maximum,
    reboot,
    quarantine,
    recoveredResume,
    quarantineResume,
  ];
  assert.deepEqual(
    contexts.map((context) => context.plan.disposition),
    [
      "GENESIS_ABORT",
      "SAME_BOOT_RECONCILE",
      "REBOOT_INTERRUPTION",
      "QUARANTINE",
      "RECOVERED_DECISION_RESUME",
      "QUARANTINE_DECISION_RESUME",
    ],
  );

  for (const context of contexts) {
    assertExactRecordLineage(context);
    const replayTarget = context.fixture.refreshTarget(recovery);
    const replayAnchorSelection = context.fixture.anchorSelection(
      context.anchor,
    );
    const replayPredecessorHead = context.fixture.headSelection();
    const surplusCount = context === maximum ? 5 : 1;
    const records = [...context.records];
    let predecessor = records.at(-1);
    for (let index = 0; index < surplusCount; index++) {
      const surplus = createVerifiedChainValidSurplusRecord(
        context,
        predecessor,
      );
      records.push(surplus);
      predecessor = surplus;
      assert.equal(
        records.reduce((sum, record) => sum + record.bytes.length, 0) <=
          6_291_456,
        true,
      );
      assert.equal(records.length <= 24, true);
      const entry = {
        ...entryFrom(context, replayAnchorSelection),
        records: records.map(artifact),
      };
      assertContractReject(() =>
        recovery.replayCandidateContainmentRecoveryV1(
          replayInput(context.fixture, replayTarget, {
            entries: [entry],
            expectedExternalHead: null,
            currentAnchorSelection: replayAnchorSelection,
            currentAnchorPredecessorExternalHead: replayPredecessorHead,
          }),
        ),
      );
    }
    if (context === maximum) {
      assert.deepEqual(
        records.slice(19).map((record) => record.sequence),
        [
          "0000000000000020",
          "0000000000000021",
          "0000000000000022",
          "0000000000000023",
          "0000000000000024",
        ],
      );
    }
  }
});

test("derives exact descriptor ceilings and applies monotone live, reap, empty, and reboot transitions", () => {
  const zeroCeilings = [
    [0, [false, false, false, false]],
    [3, [false, false, false, false]],
    [4, [true, true, true, true]],
    [12, [true, true, true, true]],
    [13, [true, true, true, false]],
    [16, [true, true, true, false]],
    [17, [false, false, false, false]],
    [18, [false, false, false, false]],
  ];
  for (const [bundleCount, expected] of zeroCeilings) {
    const context = buildGenesis(`ceilings-zero-${bundleCount}`, {
      bundleCount,
      location: "active",
    });
    assert.deepEqual(
      [
        context.zeroReplay.commandDescriptorMayRemainHeld,
        context.zeroReplay.statusDescriptorMayRemainHeld,
        context.zeroReplay.supervisorPidfdMayRemainHeld,
        context.zeroReplay.directChildWaitAuthorityMayRemain,
      ],
      expected,
    );
  }

  const live = createPlanRecords(
    createAttempt(
      addReadyAnchor(
        buildGenesis("ceilings-live", {
          bundleCount: 5,
          location: "active",
        }),
        {
          reportedCommandDescriptorHeld: true,
          reportedStatusDescriptorHeld: true,
          reportedSupervisorPidfdHeld: true,
          reportedDirectChildWaitAuthority: true,
          reportedControlCgroupPresent: true,
          reportedJobCgroupPresent: true,
        },
      ),
    ),
  );
  const afterManifest = replayCurrentAttemptPrefix(live, 1);
  assert.deepEqual(
    [
      afterManifest.commandDescriptorMayRemainHeld,
      afterManifest.statusDescriptorMayRemainHeld,
      afterManifest.supervisorPidfdMayRemainHeld,
      afterManifest.directChildWaitAuthorityMayRemain,
    ],
    [true, true, true, true],
  );
  const commandClosedIndex =
    live.plan.states.indexOf("COMMAND_DESCRIPTOR_CLOSED_OBSERVED") + 1;
  const afterCommandClosed = replayCurrentAttemptPrefix(
    live,
    commandClosedIndex,
  );
  assert.equal(afterCommandClosed.commandDescriptorMayRemainHeld, false);
  assert.equal(afterCommandClosed.statusDescriptorMayRemainHeld, true);
  const reapedIndex =
    live.plan.states.indexOf("SUPERVISOR_REAPED_OBSERVED") + 1;
  const afterReap = replayCurrentAttemptPrefix(live, reapedIndex);
  assert.equal(afterReap.commandDescriptorMayRemainHeld, false);
  assert.equal(afterReap.statusDescriptorMayRemainHeld, false);
  assert.equal(afterReap.supervisorPidfdMayRemainHeld, true);
  assert.equal(afterReap.directChildWaitAuthorityMayRemain, false);

  let emptyLive = addReadyAnchor(
    buildGenesis("ceilings-empty-live", {
      bundleCount: 5,
      location: "active",
    }),
    {
      reportedCommandDescriptorHeld: true,
      reportedStatusDescriptorHeld: true,
      reportedSupervisorPidfdHeld: true,
      reportedDirectChildWaitAuthority: true,
      reportedControlCgroupPresent: true,
      reportedJobCgroupPresent: true,
    },
  );
  emptyLive = publishAnchoredEmptyAttempt(emptyLive, "ABSENT");
  assert.deepEqual(
    [
      emptyLive.zeroReplay.commandDescriptorMayRemainHeld,
      emptyLive.zeroReplay.statusDescriptorMayRemainHeld,
      emptyLive.zeroReplay.supervisorPidfdMayRemainHeld,
      emptyLive.zeroReplay.directChildWaitAuthorityMayRemain,
    ],
    [true, true, true, true],
  );

  let reboot = buildGenesis("ceilings-reboot", { location: "active" });
  reboot.fixture.startRebootRecovery();
  const rebootTarget = reboot.fixture.refreshTarget(recovery);
  const rebootHead = reboot.fixture.headSelection();
  const rebootReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(reboot.fixture, rebootTarget, {
      entries: [],
      expectedExternalHead: rebootHead,
    }),
  );
  reboot = addReadyAnchor({
    ...reboot,
    target: rebootTarget,
    expectedExternalHead: rebootHead,
    zeroReplay: rebootReplay,
  });
  reboot = publishAnchoredEmptyAttempt(reboot, "PRESENT_EMPTY");
  assert.equal(reboot.zeroReplay.liveBirthActorStillPermitted, false);
  assert.deepEqual(
    [
      reboot.zeroReplay.commandDescriptorMayRemainHeld,
      reboot.zeroReplay.statusDescriptorMayRemainHeld,
      reboot.zeroReplay.supervisorPidfdMayRemainHeld,
      reboot.zeroReplay.directChildWaitAuthorityMayRemain,
    ],
    [false, false, false, false],
  );
});

test("derives every same-boot normal-head plan and all state-2/state-15 cgroup presence alternatives", () => {
  const expectedStates = (facts, reapProven) => {
    const states = ["RECOVERY_ATTEMPT_DURABLE"];
    if (facts.command) {
      states.push(
        "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
        "COMMAND_DESCRIPTOR_CLOSED_OBSERVED",
      );
    }
    if (facts.control) {
      states.push(
        "CONTROL_KILL_INTENT_DURABLE",
        "CONTROL_KILL_WRITE_COMPLETED",
      );
    } else {
      states.push("CONTROL_PATH_ABSENT_OBSERVED");
    }
    if (facts.job) {
      states.push(
        "JOB_FIRST_KILL_INTENT_DURABLE",
        "JOB_FIRST_KILL_WRITE_COMPLETED",
      );
    } else {
      states.push("JOB_PATH_ABSENT_OBSERVED");
    }
    if (facts.control) states.push("CONTROL_QUIESCENT_OBSERVED");
    if (facts.job) {
      states.push(
        "JOB_SECOND_KILL_INTENT_DURABLE",
        "JOB_SECOND_KILL_WRITE_COMPLETED",
        "JOB_QUIESCENT_OBSERVED",
      );
    }
    if (facts.status) states.push("STATUS_EOF_OBSERVED");
    if (facts.pidfd) {
      states.push(
        reapProven
          ? "SUPERVISOR_PIDFD_HUP_OBSERVED"
          : "SUPERVISOR_PIDFD_READABLE_OBSERVED",
      );
    }
    if (!reapProven && facts.wait) {
      states.push(
        "SUPERVISOR_REAP_INTENT_DURABLE",
        "SUPERVISOR_REAPED_OBSERVED",
      );
    }
    if (facts.control || facts.job)
      states.push("CGROUP_REMOVAL_INTENT_DURABLE");
    states.push(
      "CGROUP_PATHS_ABSENT_OBSERVED",
      "RECOVERED_TOMBSTONE_DURABLE",
      "RECOVERED_LOCATION_OBSERVED",
    );
    return states;
  };

  const run = (bundleCount, presence, variant = "primary") => {
    const reapProven = bundleCount >= 13;
    const facts = {
      command: bundleCount >= 4 && bundleCount <= 16 && bundleCount % 2 === 0,
      status: bundleCount >= 4 && bundleCount <= 16 && bundleCount % 3 === 0,
      pidfd: (bundleCount >= 5 && bundleCount <= 12) || bundleCount === 13,
      wait: bundleCount >= 5 && bundleCount <= 12,
      control: presence[0] === "1",
      job: presence[1] === "1",
    };
    const context = addReadyAnchor(
      buildGenesis(`same-boot-state-${bundleCount}-${presence}-${variant}`, {
        bundleCount,
        location: "active",
      }),
      {
        reportedCommandDescriptorHeld: facts.command,
        reportedStatusDescriptorHeld: facts.status,
        reportedSupervisorPidfdHeld: facts.pidfd,
        reportedDirectChildWaitAuthority: facts.wait,
        reportedControlCgroupPresent: facts.control,
        reportedJobCgroupPresent: facts.job,
      },
    );
    assert.equal(context.plan.status, "RECOVERY_PLAN_READY");
    assert.equal(context.plan.disposition, "SAME_BOOT_RECONCILE");
    assert.deepEqual(context.plan.states, expectedStates(facts, reapProven));
    assert.equal(context.plan.recordCount, context.plan.states.length);
    return context;
  };

  for (let bundleCount = 1; bundleCount <= 17; bundleCount++) {
    const presence =
      bundleCount <= 2 || bundleCount >= 15
        ? "00"
        : bundleCount === 16 || bundleCount === 17
          ? "00"
          : "11";
    run(bundleCount, presence);
  }
  for (const state of [2, 15]) {
    for (const presence of ["00", "10", "01", "11"])
      run(state, presence, "presence-matrix");
  }
});

test("preserves every unresolved effect intent across a successor and selects the exact uncertainty quarantine", () => {
  for (const unresolvedState of UNRESOLVED_EFFECT_INTENTS) {
    let context = addReadyAnchor(
      buildGenesis(`unresolved-${unresolvedState}`, {
        bundleCount: 5,
        location: "active",
      }),
      {
        reportedCommandDescriptorHeld: true,
        reportedStatusDescriptorHeld: true,
        reportedSupervisorPidfdHeld: true,
        reportedDirectChildWaitAuthority: true,
        reportedControlCgroupPresent: true,
        reportedJobCgroupPresent: true,
      },
    );
    const prefixCount = context.plan.states.indexOf(unresolvedState) + 1;
    assert.equal(prefixCount > 0, true);
    context = createPlanRecords(createAttempt(context), prefixCount);
    context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
    assert.equal(context.zeroReplay.latestAttemptState, unresolvedState);
    assert.equal(context.zeroReplay.derivedPriorEffectOutcomeCertain, false);
    context.fixture.appendNormalTermination();
    context = replayDurableHistory(context);
    context = addReadyAnchor(context, {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      reportedControlCgroupPresent: true,
      reportedJobCgroupPresent: true,
    });
    assert.equal(context.plan.disposition, "QUARANTINE");
    assert.equal(context.plan.quarantineReason, "RECOVERY_EFFECT_UNCERTAIN");
    assert.deepEqual(context.plan.states, PLAN_STATES.QUARANTINE);
    assert.equal(
      context.plan.recoveryContext.derivedPriorEffectOutcomeCertain,
      false,
    );
    assertBoundarySummary(context.plan);
  }
});

test("derives and completes reboot recovery with a real recovery-only launch lineage", () => {
  let context = buildGenesis("reboot", { location: "active" });
  context.fixture.startRebootRecovery();
  const target = context.fixture.refreshTarget(recovery);
  const expectedExternalHead = context.fixture.headSelection();
  const zeroReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, target, {
      entries: [],
      expectedExternalHead,
    }),
  );
  context = addReadyAnchor({
    ...context,
    target,
    expectedExternalHead,
    zeroReplay,
  });
  assert.equal(context.phaseOne.status, "RECOVERY_ANCHOR_REQUIRED");
  assert.equal(context.phaseOne.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");
  assert.equal(context.plan.status, "RECOVERY_PLAN_READY");
  assert.equal(context.plan.disposition, "REBOOT_INTERRUPTION");
  assert.deepEqual(context.plan.states, PLAN_STATES.REBOOT_INTERRUPTION);
  context = createPlanRecords(createAttempt(context));
  const complete = publishFinalizedAttempt(context, "RECOVERED");
  assert.equal(context.anchor.launched, true);
  assert.equal(complete.zeroReplay.status, "COMPLETE_RECOVERED_REPLAYED");
  assert.equal(complete.zeroReplay.liveBirthActorStillPermitted, false);
  assert.equal(
    complete.zeroReplay.latestExpectedCurrentBootIdSha256,
    context.fixture.lifetimeContext.bootIdSha256,
  );
  assertBoundarySummary(complete.zeroReplay);
});

test("handles normal state-18 only through branded close-move and closed receipt statuses", () => {
  const context = buildGenesis("normal-close", {
    bundleCount: 18,
    location: "active",
  });
  const closeRequired = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      context.fixture,
      context.target,
      context.inventory,
      context.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assert.equal(closeRequired.status, "CLOSE_MOVE_REQUIRED");
  assert.equal(closeRequired.requiredActorKind, null);
  assert.equal(closeRequired.requiredDestinationLocation, "closed");
  assert.deepEqual(closeRequired.states, []);
  assertBoundarySummary(closeRequired);

  context.fixture.appendNormalClose();
  const target = context.fixture.refreshTarget(recovery);
  const externalHead = context.fixture.headSelection();
  const closeReceipt = context.fixture.closeSelection();
  const closedInventory = createInventory(context.fixture, "closed");
  const closedReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, target, {
      entries: [],
      expectedExternalHead: externalHead,
      normalCloseDurabilityReceipt: closeReceipt,
    }),
  );
  const closed = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(context.fixture, target, closedInventory, closedReplay, {
      overrides: { normalCloseDurabilityReceipt: closeReceipt },
    }),
    proposedActorKind: null,
    normalCloseDurabilityReceipt: closeReceipt,
  });
  assert.equal(closed.status, "CLOSED_LOCATION_OBSERVED");
  assert.equal(closed.terminal, true);
  assert.equal(closed.requiredDestinationLocation, "closed");
  assertBoundarySummary(closed);
});

test("supports the exact anchored-empty descriptor and replay status", () => {
  const context = addReadyAnchor(buildGenesis("anchored-empty"));
  const anchored =
    recovery.createCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
      target: context.target,
      previousRecoveryReplay: context.replay,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      reportedAttemptDirectoryState: "PRESENT_EMPTY",
    });
  assert.deepEqual(Object.keys(anchored), ANCHORED_EMPTY_KEYS);
  assert.equal(anchored.latestRecoveryRecordSequence, null);
  assert.equal(anchored.latestRecoveryRecordRawSha256, ZERO_SHA256);
  assertNullPrototypeFrozen(anchored);
  assert.deepEqual(
    plain(
      recovery.verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
        anchoredEmptyAttempt: anchored,
        target: context.target,
        previousRecoveryReplay: context.replay,
        lifetimeAnchorProjection:
          context.anchorSelection.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      }),
    ),
    plain(anchored),
  );
  const replay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, context.target, {
      entries: [
        {
          kind: "ANCHORED_EMPTY_ATTEMPT",
          lifetimeAnchorProjection:
            context.anchorSelection.lifetimeAnchorProjection,
          lifetimeAttemptAnchorRawSha256:
            context.anchorSelection.lifetimeAttemptAnchorRawSha256,
          anchoredEmptyAttempt: anchored,
          records: [],
        },
      ],
      expectedExternalHead: null,
      currentAnchorSelection: context.anchorSelection,
      currentAnchorPredecessorExternalHead: context.predecessorHead,
    }),
  );
  assert.equal(replay.status, "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED");
  assert.equal(replay.anchoredEmptyAttemptCount, 1);
  assert.equal(replay.latestAttemptState, null);
  assert.equal(replay.nextRequiredState, null);
  assertBoundarySummary(replay);
});

test("anchored-empty verifier reconstructs an exact unbranded clone and exhaustively rejects field drift", () => {
  const context = addReadyAnchor(
    buildGenesis("anchored-empty-structural-verifier"),
  );
  const anchoredEmptyAttempt =
    recovery.createCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
      target: context.target,
      previousRecoveryReplay: context.replay,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      reportedAttemptDirectoryState: "ABSENT",
    });
  const verificationContext = {
    target: context.target,
    previousRecoveryReplay: context.replay,
    lifetimeAnchorProjection: context.anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      context.anchorSelection.lifetimeAttemptAnchorRawSha256,
  };
  assertVerifierNormalizesUnbrandedClone({
    label: "anchored-empty",
    value: anchoredEmptyAttempt,
    keys: ANCHORED_EMPTY_KEYS,
    verify: (candidate) =>
      recovery.verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
        anchoredEmptyAttempt: candidate,
        ...verificationContext,
      }),
    downstream: (candidate) =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [
            {
              kind: "ANCHORED_EMPTY_ATTEMPT",
              lifetimeAnchorProjection:
                context.anchorSelection.lifetimeAnchorProjection,
              lifetimeAttemptAnchorRawSha256:
                context.anchorSelection.lifetimeAttemptAnchorRawSha256,
              anchoredEmptyAttempt: candidate,
              records: [],
            },
          ],
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
  });
});

test("replays four real anchored-empty attempts with exact successor heads then enforces the attempt limit", () => {
  let context = buildGenesis("four-empty", { location: "active" });
  for (let index = 0; index < 4; index++) {
    context = addReadyAnchor(context);
    context = publishAnchoredEmptyAttempt(
      context,
      index % 2 === 0 ? "ABSENT" : "PRESENT_EMPTY",
    );
    const latest = context.history.at(-1).anchoredEmptyAttempt;
    assert.equal(
      latest.reportedAttemptDirectoryState,
      index % 2 === 0 ? "ABSENT" : "PRESENT_EMPTY",
    );
    assert.equal(
      context.zeroReplay.status,
      "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED",
    );
    assert.equal(context.zeroReplay.attemptCount, index + 1);
    assert.equal(context.zeroReplay.anchoredEmptyAttemptCount, index + 1);
    if (index > 0) {
      const previous = context.history.at(-2).anchoredEmptyAttempt;
      assert.equal(
        latest.previousRecoveryActorEpochSha256,
        previous.recoveryActorEpochSha256,
      );
      assert.equal(
        latest.previousAttemptDirectoryName,
        previous.attemptDirectoryName,
      );
      assert.equal(latest.previousRecoveryRecordSequence, null);
      assert.equal(latest.previousRecoveryRecordRawSha256, ZERO_SHA256);
    }
    assertBoundarySummary(context.zeroReplay);
  }
  const limit = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      context.fixture,
      context.target,
      context.inventory,
      context.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assert.equal(limit.status, "RECOVERY_ATTEMPT_LIMIT_REACHED");
  assert.equal(limit.requiredActorKind, null);
  assert.equal(limit.disposition, null);
  assert.deepEqual(limit.states, []);
  assert.equal(limit.recordCount, 0);
  assertBoundarySummary(limit);
});

test("rejects anchored-empty residue labels, verifier field drift, predecessor reordering, and actor reuse", () => {
  let context = addReadyAnchor(
    buildGenesis("empty-adversarial", { location: "active" }),
  );
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
      target: context.target,
      previousRecoveryReplay: context.replay,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      reportedAttemptDirectoryState: "TEMP_RESIDUE",
    }),
  );
  const firstContext = context;
  context = publishAnchoredEmptyAttempt(context, "ABSENT");
  const first = context.history[0].anchoredEmptyAttempt;
  for (const [field, value] of [
    ["targetSha256", digest("empty:wrong-target")],
    ["recoveryActorEpochSha256", digest("empty:wrong-actor")],
    ["attemptDirectoryName", digest("empty:wrong-directory")],
    ["lifetimeAttemptAnchorRawSha256", digest("empty:wrong-anchor")],
    ["previousRecoveryActorEpochSha256", digest("empty:wrong-previous-actor")],
    ["previousRecoveryRecordSequence", "0000000000000001"],
    ["previousRecoveryRecordRawSha256", digest("empty:wrong-head")],
    ["reportedAttemptDirectoryState", "TEMP_RESIDUE"],
    ["latestRecoveryRecordSequence", "0000000000000001"],
    ["latestRecoveryRecordRawSha256", digest("empty:nonzero-head")],
  ]) {
    assertContractReject(() =>
      recovery.verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
        anchoredEmptyAttempt: { ...plain(first), [field]: value },
        target: firstContext.target,
        previousRecoveryReplay: firstContext.replay,
        lifetimeAnchorProjection:
          firstContext.anchorSelection.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          firstContext.anchorSelection.lifetimeAttemptAnchorRawSha256,
      }),
    );
  }

  context = addReadyAnchor(context);
  const secondContext = context;
  context = publishAnchoredEmptyAttempt(context, "PRESENT_EMPTY");
  const entries = context.history.map((item) =>
    brandedHistoryEntry(context.fixture, item),
  );
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: entries.toReversed(),
        expectedExternalHead: context.fixture.headSelection(),
      }),
    ),
  );
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: [entries[0], entries[0]],
        expectedExternalHead: context.fixture.headSelection(),
      }),
    ),
  );
  const reused = {
    ...plain(context.history[1].anchoredEmptyAttempt),
    recoveryActorEpochSha256: first.recoveryActorEpochSha256,
    attemptDirectoryName: first.attemptDirectoryName,
  };
  assertContractReject(() =>
    recovery.verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
      anchoredEmptyAttempt: reused,
      target: secondContext.target,
      previousRecoveryReplay: secondContext.replay,
      lifetimeAnchorProjection:
        secondContext.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        secondContext.anchorSelection.lifetimeAttemptAnchorRawSha256,
    }),
  );
});

test("inherits and completes recovered and quarantine decisions in real successor attempts", () => {
  const cases = [
    {
      label: "resume-recovered",
      firstOverrides: {},
      prefixCount: 4,
      firstDisposition: "GENESIS_ABORT",
      inherited: "RECOVERED",
      resumeDisposition: "RECOVERED_DECISION_RESUME",
      resumeStates: PLAN_STATES.RECOVERED_DECISION_RESUME,
      finalResult: "RECOVERED",
      finalStatus: "COMPLETE_RECOVERED_REPLAYED",
      finalLocation: "recovered",
    },
    {
      label: "resume-quarantine",
      firstOverrides: { reportedCurrentBootIdSha256: null },
      prefixCount: 2,
      firstDisposition: "QUARANTINE",
      inherited: "QUARANTINED",
      resumeDisposition: "QUARANTINE_DECISION_RESUME",
      resumeStates: PLAN_STATES.QUARANTINE_DECISION_RESUME,
      finalResult: "QUARANTINED",
      finalStatus: "COMPLETE_QUARANTINED_REPLAYED",
      finalLocation: "quarantined",
    },
  ];
  for (const specification of cases) {
    let context = addReadyAnchor(
      buildGenesis(specification.label, { location: "staging" }),
      specification.firstOverrides,
    );
    assert.equal(context.plan.disposition, specification.firstDisposition);
    context = createPlanRecords(
      createAttempt(context),
      specification.prefixCount,
    );
    context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
    assert.equal(
      context.zeroReplay.inheritedTerminalDecision,
      specification.inherited,
    );
    assert.equal(context.zeroReplay.chainTerminal, false);

    context.fixture.appendNormalTermination();
    context = replayDurableHistory(context);
    context = addReadyAnchor(context, {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      ...specification.firstOverrides,
    });
    assert.equal(context.phaseOne.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");
    assert.equal(context.plan.disposition, specification.resumeDisposition);
    assert.equal(context.plan.quarantineReason, null);
    assert.deepEqual(context.plan.states, specification.resumeStates);
    context = createPlanRecords(createAttempt(context));
    context = publishFinalizedAttempt(context, specification.finalResult);
    assert.equal(context.zeroReplay.status, specification.finalStatus);
    assert.equal(context.zeroReplay.chainTerminal, true);
    assert.equal(
      context.zeroReplay.inheritedTerminalDecision,
      specification.inherited,
    );

    const terminalInventory = createInventory(
      context.fixture,
      specification.finalLocation,
    );
    const terminalPlan = recovery.planCandidateContainmentRecoveryV1({
      ...planInput(
        context.fixture,
        context.target,
        terminalInventory,
        context.zeroReplay,
      ),
      proposedActorKind: null,
    });
    assert.equal(terminalPlan.status, "RECOVERY_TERMINAL");
    assert.equal(terminalPlan.terminal, true);
    assert.equal(terminalPlan.disposition, null);
    assert.deepEqual(terminalPlan.states, []);
    assertBoundarySummary(terminalPlan);

    assertContractReject(() =>
      recovery.createCandidateContainmentRecoveryAttemptV1({
        target: context.target,
        lifecycleInventoryObservation: terminalInventory,
        previousRecoveryReplay: context.zeroReplay,
        plan: terminalPlan,
        lifetimeAnchorProjection: null,
        lifetimeAttemptAnchorRawSha256: null,
      }),
    );
    const duplicatedTerminalEntry = brandedHistoryEntry(
      context.fixture,
      context.history.at(-1),
    );
    assertContractReject(() =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [
            ...context.history.map((item) =>
              brandedHistoryEntry(context.fixture, item),
            ),
            duplicatedTerminalEntry,
          ],
          expectedExternalHead: context.fixture.headSelection(),
        }),
      ),
    );
  }
});

test("replays a mixed anchored-empty then finalized lineage without erasing predecessor or attempt counts", () => {
  let context = addReadyAnchor(buildGenesis("mixed-empty-finalized"));
  context = publishAnchoredEmptyAttempt(context, "ABSENT");
  context = addReadyAnchor(context);
  context = createPlanRecords(createAttempt(context));
  context = publishFinalizedAttempt(context, "RECOVERED");
  assert.equal(context.zeroReplay.status, "COMPLETE_RECOVERED_REPLAYED");
  assert.equal(context.zeroReplay.attemptCount, 2);
  assert.equal(context.zeroReplay.anchoredEmptyAttemptCount, 1);
  assert.equal(context.zeroReplay.finalizedAttemptCount, 1);
  assert.equal(context.zeroReplay.recordCount, context.records.length);
  assert.equal(
    context.attempt.previousRecoveryActorEpochSha256,
    context.history[0].anchoredEmptyAttempt.recoveryActorEpochSha256,
  );
  assert.equal(context.attempt.previousRecoveryRecordSequence, null);
  assert.equal(context.attempt.previousRecoveryRecordRawSha256, ZERO_SHA256);
  assertBoundarySummary(context.zeroReplay);
});

test("freezes all six finite plan state families and their bounded maximum", () => {
  assert.deepEqual(PLAN_STATES.GENESIS_ABORT, [
    "RECOVERY_ATTEMPT_DURABLE",
    "GENESIS_ABORT_RECOVERY_REQUIRED",
    "CGROUP_PATHS_ABSENT_OBSERVED",
    "RECOVERED_TOMBSTONE_DURABLE",
    "RECOVERED_LOCATION_OBSERVED",
  ]);
  assert.equal(PLAN_STATES.SAME_BOOT_RECONCILE_MAXIMUM.length, 19);
  assert.deepEqual(PLAN_STATES.REBOOT_INTERRUPTION, [
    "RECOVERY_ATTEMPT_DURABLE",
    "REBOOT_INTERRUPTION_OBSERVED",
    "CGROUP_PATHS_ABSENT_OBSERVED",
    "RECOVERED_TOMBSTONE_DURABLE",
    "RECOVERED_LOCATION_OBSERVED",
  ]);
  assert.deepEqual(PLAN_STATES.QUARANTINE, [
    "RECOVERY_ATTEMPT_DURABLE",
    "QUARANTINE_INTENT_DURABLE",
    "QUARANTINED_LOCATION_OBSERVED",
  ]);
  assert.deepEqual(PLAN_STATES.RECOVERED_DECISION_RESUME, [
    "RECOVERY_ATTEMPT_DURABLE",
    "RECOVERED_TOMBSTONE_ADOPTED",
    "RECOVERED_LOCATION_OBSERVED",
  ]);
  assert.deepEqual(PLAN_STATES.QUARANTINE_DECISION_RESUME, [
    "RECOVERY_ATTEMPT_DURABLE",
    "QUARANTINE_INTENT_ADOPTED",
    "QUARANTINED_LOCATION_OBSERVED",
  ]);
  for (const states of Object.values(PLAN_STATES)) {
    assert.equal(Object.isFrozen(states), true);
    assert.equal(states.length <= 19, true);
    assert.equal(
      states.every((state) => RECORD_STATES.includes(state)),
      true,
    );
  }
});

test("returns authority-null pre-actor blocked statuses without constructing an attempt", () => {
  const context = buildGenesis("blocked");
  const unsafe =
    recovery.createCandidateContainmentRecoveryInventoryObservationV1({
      ...inventoryInput(
        context.fixture.journal.generationIdentity.identitySha256,
        "staging",
      ),
      unsafeEntriesPresent: true,
    });
  const cases = [
    [
      "UNSAFE_FILESYSTEM_INVENTORY_BLOCKED",
      { lifecycleInventoryObservation: unsafe },
    ],
    [
      "STATE_ROOT_IDENTITY_REJECTED",
      { reportedStateRootIdentitySha256: digest("wrong-root") },
    ],
    [
      "STATE_FILESYSTEM_INTERFACE_REJECTED",
      { reportedStateFilesystemInterfaceAvailable: false },
    ],
    [
      "RECOVERY_LIFETIME_IDENTITY_REJECTED",
      { reportedLifetimeCgroupIdentitySha256: digest("wrong-lifetime") },
    ],
  ];
  for (const [status, overrides] of cases) {
    const input = planInput(
      context.fixture,
      context.target,
      context.inventory,
      context.zeroReplay,
    );
    Object.assign(input, overrides);
    const plan = recovery.planCandidateContainmentRecoveryV1(input);
    assert.equal(plan.status, status);
    assert.equal(plan.requiredActorKind, null);
    assert.equal(plan.disposition, null);
    assert.deepEqual(plan.states, []);
    assert.equal(plan.recordCount, 0);
    assertBoundarySummary(plan);
    assertContractReject(() =>
      recovery.createCandidateContainmentRecoveryAttemptV1({
        target: context.target,
        lifecycleInventoryObservation:
          overrides.lifecycleInventoryObservation ?? context.inventory,
        previousRecoveryReplay: context.zeroReplay,
        plan,
        lifetimeAnchorProjection: null,
        lifetimeAttemptAnchorRawSha256: null,
      }),
    );
  }
});

test("matches exact whole plan results for every ready, handoff, terminal, limit, and blocked status", () => {
  const ready = addReadyAnchor(buildGenesis("whole-plan-ready"));
  const readyInput = planInput(
    ready.fixture,
    ready.target,
    ready.inventory,
    ready.replay,
    { phase: 2, anchorSelection: ready.anchorSelection },
  );
  assertExactPlanResult(
    ready.phaseOne,
    expectedPlanFields(
      ready.target.targetSha256,
      ready.inventory.inventorySha256,
      {
        status: "RECOVERY_ANCHOR_REQUIRED",
        requiredActorKind: "LIVE_BIRTH_GUARDIAN",
      },
    ),
  );
  assertExactPlanResult(
    ready.plan,
    expectedPlanFields(
      ready.target.targetSha256,
      ready.inventory.inventorySha256,
      {
        status: "RECOVERY_PLAN_READY",
        requiredActorKind: "LIVE_BIRTH_GUARDIAN",
        currentLifetimeAnchorMatched: true,
        disposition: "GENESIS_ABORT",
        sourceLocation: "staging",
        decisionSourceLocation: "staging",
        requiredDestinationLocation: "recovered",
        recoveryContext: expectedRecoveryContext(
          "LIVE_BIRTH_GUARDIAN",
          readyInput,
        ),
        nextPermittedRecordTypes: ["RECOVERY_ATTEMPT_DURABLE"],
        states: [...PLAN_STATES.GENESIS_ABORT],
        recordCount: PLAN_STATES.GENESIS_ABORT.length,
      },
    ),
  );

  const blockedBase = buildGenesis("whole-plan-blocked");
  const unsafeInventory =
    recovery.createCandidateContainmentRecoveryInventoryObservationV1({
      ...inventoryInput(
        blockedBase.fixture.journal.generationIdentity.identitySha256,
      ),
      unsafeEntriesPresent: true,
    });
  const blockedCases = [
    {
      status: "UNSAFE_FILESYSTEM_INVENTORY_BLOCKED",
      inventory: unsafeInventory,
      overrides: {},
    },
    {
      status: "STATE_ROOT_IDENTITY_REJECTED",
      inventory: blockedBase.inventory,
      overrides: {
        reportedStateRootIdentitySha256: digest("whole-plan:wrong-root"),
      },
    },
    {
      status: "RECOVERY_LIFETIME_IDENTITY_REJECTED",
      inventory: blockedBase.inventory,
      overrides: {
        reportedLifetimeCgroupIdentitySha256: digest(
          "whole-plan:wrong-lifetime",
        ),
      },
    },
    {
      status: "STATE_FILESYSTEM_INTERFACE_REJECTED",
      inventory: blockedBase.inventory,
      overrides: { reportedStateFilesystemInterfaceAvailable: false },
    },
  ];
  for (const specification of blockedCases) {
    const input = planInput(
      blockedBase.fixture,
      blockedBase.target,
      specification.inventory,
      blockedBase.zeroReplay,
    );
    Object.assign(input, specification.overrides);
    const plan = recovery.planCandidateContainmentRecoveryV1(input);
    assertExactPlanResult(
      plan,
      expectedPlanFields(
        blockedBase.target.targetSha256,
        specification.inventory.inventorySha256,
        { status: specification.status },
      ),
    );
  }

  const inconsistentInventory = createInventory(
    blockedBase.fixture,
    "recovered",
  );
  const inconsistent = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      blockedBase.fixture,
      blockedBase.target,
      inconsistentInventory,
      blockedBase.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assertExactPlanResult(
    inconsistent,
    expectedPlanFields(
      blockedBase.target.targetSha256,
      inconsistentInventory.inventorySha256,
    ),
  );

  const closeContext = buildGenesis("whole-plan-close", {
    bundleCount: 18,
    location: "active",
  });
  const closeRequired = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      closeContext.fixture,
      closeContext.target,
      closeContext.inventory,
      closeContext.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assertExactPlanResult(
    closeRequired,
    expectedPlanFields(
      closeContext.target.targetSha256,
      closeContext.inventory.inventorySha256,
      {
        status: "CLOSE_MOVE_REQUIRED",
        currentLifetimeAnchorMatched: null,
        sourceLocation: "active",
        requiredDestinationLocation: "closed",
      },
    ),
  );
  closeContext.fixture.appendNormalClose();
  const closedTarget = closeContext.fixture.refreshTarget(recovery);
  const closeReceipt = closeContext.fixture.closeSelection();
  const closedInventory = createInventory(closeContext.fixture, "closed");
  const closedReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(closeContext.fixture, closedTarget, {
      entries: [],
      expectedExternalHead: closeContext.fixture.headSelection(),
      normalCloseDurabilityReceipt: closeReceipt,
    }),
  );
  const closed = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      closeContext.fixture,
      closedTarget,
      closedInventory,
      closedReplay,
    ),
    proposedActorKind: null,
    normalCloseDurabilityReceipt: closeReceipt,
  });
  assertExactPlanResult(
    closed,
    expectedPlanFields(
      closedTarget.targetSha256,
      closedInventory.inventorySha256,
      {
        status: "CLOSED_LOCATION_OBSERVED",
        currentLifetimeAnchorMatched: null,
        sourceLocation: "closed",
        requiredDestinationLocation: "closed",
        terminal: true,
      },
    ),
  );

  let terminalContext = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("whole-plan-terminal"))),
  );
  terminalContext = publishFinalizedAttempt(terminalContext, "RECOVERED");
  const terminalInventory = createInventory(
    terminalContext.fixture,
    "recovered",
  );
  const terminal = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      terminalContext.fixture,
      terminalContext.target,
      terminalInventory,
      terminalContext.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assertExactPlanResult(
    terminal,
    expectedPlanFields(
      terminalContext.target.targetSha256,
      terminalInventory.inventorySha256,
      {
        status: "RECOVERY_TERMINAL",
        currentLifetimeAnchorMatched: null,
        sourceLocation: "recovered",
        decisionSourceLocation: "staging",
        requiredDestinationLocation: "recovered",
        inheritedTerminalDecision: "RECOVERED",
        latestAttemptState: "RECOVERED_LOCATION_OBSERVED",
        latestFinalizedRecoveryState: "RECOVERED_LOCATION_OBSERVED",
        terminal: true,
      },
    ),
  );

  let limited = buildGenesis("whole-plan-limit");
  for (const directoryState of [
    "ABSENT",
    "PRESENT_EMPTY",
    "ABSENT",
    "PRESENT_EMPTY",
  ]) {
    limited = addReadyAnchor(limited);
    limited = publishAnchoredEmptyAttempt(limited, directoryState);
  }
  const limit = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      limited.fixture,
      limited.target,
      limited.inventory,
      limited.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assertExactPlanResult(
    limit,
    expectedPlanFields(
      limited.target.targetSha256,
      limited.inventory.inventorySha256,
      { status: "RECOVERY_ATTEMPT_LIMIT_REACHED" },
    ),
  );
});

test("applies pre-actor, filesystem, state-18, terminal, limit, inherited-decision, and fresh precedence in order", () => {
  const context = buildGenesis("precedence", { location: "active" });
  const unsafe =
    recovery.createCandidateContainmentRecoveryInventoryObservationV1({
      ...inventoryInput(
        context.fixture.journal.generationIdentity.identitySha256,
        "active",
      ),
      unsafeEntriesPresent: true,
    });
  const unsafeBeforeFilesystem = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(context.fixture, context.target, unsafe, context.zeroReplay),
    proposedActorKind: null,
    reportedStateFilesystemInterfaceAvailable: false,
  });
  assert.equal(
    unsafeBeforeFilesystem.status,
    "UNSAFE_FILESYSTEM_INVENTORY_BLOCKED",
  );

  const rootBeforeFilesystem = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      context.fixture,
      context.target,
      context.inventory,
      context.zeroReplay,
    ),
    proposedActorKind: null,
    reportedStateRootIdentitySha256: digest("precedence:wrong-root"),
    reportedStateFilesystemInterfaceAvailable: false,
  });
  assert.equal(rootBeforeFilesystem.status, "STATE_ROOT_IDENTITY_REJECTED");

  const filesystemBeforeFreshQuarantine =
    recovery.planCandidateContainmentRecoveryV1({
      ...planInput(
        context.fixture,
        context.target,
        context.inventory,
        context.zeroReplay,
      ),
      proposedActorKind: null,
      reportedStateFilesystemInterfaceAvailable: false,
      reportedCurrentBootIdSha256: null,
    });
  assert.equal(
    filesystemBeforeFreshQuarantine.status,
    "STATE_FILESYSTEM_INTERFACE_REJECTED",
  );

  const recoveredWithoutDecision = createInventory(
    context.fixture,
    "recovered",
  );
  const inconsistent = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      context.fixture,
      context.target,
      recoveredWithoutDecision,
      context.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assert.equal(inconsistent.status, "INCONSISTENT_GENERATION_STATE_BLOCKED");
  for (const plan of [
    unsafeBeforeFilesystem,
    rootBeforeFilesystem,
    filesystemBeforeFreshQuarantine,
    inconsistent,
  ]) {
    assert.equal(plan.disposition, null);
    assert.equal(plan.requiredActorKind, null);
    assert.deepEqual(plan.states, []);
    assertBoundarySummary(plan);
  }
});

test("resolves executable terminal-limit-inheritance-fresh and earlier-gate precedence collisions pairwise", () => {
  const state18 = buildGenesis("precedence-state18-terminal", {
    bundleCount: 18,
    location: "active",
  });
  let foreignTerminal = createPlanRecords(
    createAttempt(
      addReadyAnchor(
        buildGenesis("precedence-state18-terminal", {
          location: "staging",
        }),
      ),
    ),
  );
  foreignTerminal = publishFinalizedAttempt(foreignTerminal, "RECOVERED");
  assert.equal(
    state18.fixture.journal.generationIdentity.identitySha256,
    foreignTerminal.fixture.journal.generationIdentity.identitySha256,
  );
  assert.notEqual(
    state18.target.targetSha256,
    foreignTerminal.target.targetSha256,
  );
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1({
      ...planInput(
        state18.fixture,
        state18.target,
        createInventory(state18.fixture, "recovered"),
        foreignTerminal.zeroReplay,
      ),
      proposedActorKind: null,
    }),
  );

  let terminalAtLimit = buildGenesis("precedence-terminal-limit", {
    location: "staging",
  });
  for (const emptyState of ["ABSENT", "PRESENT_EMPTY", "ABSENT"]) {
    terminalAtLimit = addReadyAnchor(terminalAtLimit);
    terminalAtLimit = publishAnchoredEmptyAttempt(terminalAtLimit, emptyState);
  }
  terminalAtLimit = addReadyAnchor(terminalAtLimit);
  terminalAtLimit = createPlanRecords(createAttempt(terminalAtLimit));
  terminalAtLimit = publishFinalizedAttempt(terminalAtLimit, "RECOVERED");
  assert.equal(terminalAtLimit.zeroReplay.attemptCount, 4);
  assert.equal(terminalAtLimit.zeroReplay.chainTerminal, true);
  const recoveredInventory = createInventory(
    terminalAtLimit.fixture,
    "recovered",
  );
  const terminalWinsLimit = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      terminalAtLimit.fixture,
      terminalAtLimit.target,
      recoveredInventory,
      terminalAtLimit.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assert.equal(terminalWinsLimit.status, "RECOVERY_TERMINAL");
  assert.equal(terminalWinsLimit.terminal, true);

  const filesystemWinsTerminal = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      terminalAtLimit.fixture,
      terminalAtLimit.target,
      recoveredInventory,
      terminalAtLimit.zeroReplay,
    ),
    proposedActorKind: null,
    reportedStateFilesystemInterfaceAvailable: false,
  });
  assert.equal(
    filesystemWinsTerminal.status,
    "STATE_FILESYSTEM_INTERFACE_REJECTED",
  );

  const buildInheritedRecovered = (label) => {
    let context = addReadyAnchor(buildGenesis(label, { location: "staging" }));
    context = createPlanRecords(createAttempt(context), 4);
    context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
    assert.equal(context.zeroReplay.inheritedTerminalDecision, "RECOVERED");
    context.fixture.appendNormalTermination();
    return replayDurableHistory(context);
  };

  let inheritedAtLimit = buildInheritedRecovered("precedence-limit-inherited");
  for (const emptyState of ["ABSENT", "PRESENT_EMPTY", "ABSENT"]) {
    inheritedAtLimit = addReadyAnchor(inheritedAtLimit, {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
    });
    inheritedAtLimit = publishAnchoredEmptyAttempt(
      inheritedAtLimit,
      emptyState,
    );
  }
  assert.equal(inheritedAtLimit.zeroReplay.attemptCount, 4);
  assert.equal(
    inheritedAtLimit.zeroReplay.inheritedTerminalDecision,
    "RECOVERED",
  );
  const limitWinsInherited = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      inheritedAtLimit.fixture,
      inheritedAtLimit.target,
      inheritedAtLimit.inventory,
      inheritedAtLimit.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assert.equal(limitWinsInherited.status, "RECOVERY_ATTEMPT_LIMIT_REACHED");
  assert.equal(limitWinsInherited.inheritedTerminalDecision, "RECOVERED");

  const inheritedAgainstFresh = addReadyAnchor(
    buildInheritedRecovered("precedence-inherited-fresh"),
    {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      reportedRecoveryInterfaceAvailable: false,
    },
  );
  assert.equal(
    inheritedAgainstFresh.plan.disposition,
    "RECOVERED_DECISION_RESUME",
  );
  assert.equal(inheritedAgainstFresh.plan.quarantineReason, null);
  assert.equal(
    inheritedAgainstFresh.plan.recoveryContext
      .reportedRecoveryInterfaceAvailable,
    false,
  );

  const freshAgainstSameAdverse = addReadyAnchor(
    buildGenesis("precedence-fresh-adverse"),
    { reportedRecoveryInterfaceAvailable: false },
  );
  assert.equal(freshAgainstSameAdverse.plan.disposition, "QUARANTINE");
  assert.equal(
    freshAgainstSameAdverse.plan.quarantineReason,
    "UNSUPPORTED_RECOVERY_INTERFACE",
  );
  for (const plan of [
    terminalWinsLimit,
    filesystemWinsTerminal,
    limitWinsInherited,
    inheritedAgainstFresh.plan,
    freshAgainstSameAdverse.plan,
  ]) {
    assertBoundarySummary(plan);
  }
});

test("rejects lookalikes, cross-replay brands, and mixed current-anchor provenance", () => {
  const a = addReadyAnchor(buildGenesis("brand-a"));
  const lookalikeTarget = plain(a.target);
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(a.fixture, lookalikeTarget, a.inventory, a.replay, {
        phase: 2,
        anchorSelection: a.anchorSelection,
      }),
    ),
  );
  const structuralReplay = plain(a.replay);
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(a.fixture, a.target, a.inventory, structuralReplay, {
        phase: 2,
        anchorSelection: a.anchorSelection,
      }),
    ),
  );
  const replayAgain = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(a.fixture, a.target, {
      entries: [],
      expectedExternalHead: a.predecessorHead,
      currentAnchorSelection: a.anchorSelection,
      currentAnchorPredecessorExternalHead: a.predecessorHead,
    }),
  );
  assert.notEqual(replayAgain, a.replay);
  const b = addReadyAnchor(buildGenesis("brand-b"));
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(a.fixture, a.target, {
        entries: [],
        expectedExternalHead: a.predecessorHead,
        currentAnchorSelection: b.anchorSelection,
        currentAnchorPredecessorExternalHead: a.predecessorHead,
      }),
    ),
  );
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(a.fixture, a.target, {
        entries: [],
        expectedExternalHead: { ...plain(a.predecessorHead) },
        currentAnchorSelection: a.anchorSelection,
        currentAnchorPredecessorExternalHead: a.predecessorHead,
      }),
    ),
  );
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(a.fixture, a.target, {
        entries: [],
        expectedExternalHead: a.predecessorHead,
        currentAnchorSelection: a.anchorSelection,
        currentAnchorPredecessorExternalHead: { ...plain(a.predecessorHead) },
      }),
    ),
  );
});

test("rejects byte-equal separately branded boundaries, partial anchor triples, close mixing, and planning phase drift", () => {
  const contextA = addReadyAnchor(buildGenesis("byte-equal-brand"));
  const targetA = contextA.target;
  const anchorA = contextA.anchorSelection;
  const headA = contextA.predecessorHead;
  const replayA = contextA.replay;

  contextA.fixture.replayLifetime();
  const targetB = contextA.fixture.refreshTarget(recovery);
  const anchorB = contextA.fixture.anchorSelection();
  const headB = contextA.fixture.headSelection();
  assert.deepEqual(plain(targetA), plain(targetB));
  assert.deepEqual(plain(anchorA), plain(anchorB));
  assert.deepEqual(plain(headA), plain(headB));
  assert.notEqual(targetA, targetB);
  assert.notEqual(
    anchorA.lifetimeAnchorProjection,
    anchorB.lifetimeAnchorProjection,
  );
  assert.notEqual(headA, headB);

  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(contextA.fixture, targetA, {
        entries: [],
        expectedExternalHead: headB,
        currentAnchorSelection: anchorB,
        currentAnchorPredecessorExternalHead: headB,
      }),
    ),
  );
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(contextA.fixture, targetB, {
        entries: [],
        expectedExternalHead: headA,
        currentAnchorSelection: anchorA,
        currentAnchorPredecessorExternalHead: headA,
      }),
    ),
  );

  const exact = replayInput(contextA.fixture, targetB, {
    entries: [],
    expectedExternalHead: headB,
    currentAnchorSelection: anchorB,
    currentAnchorPredecessorExternalHead: headB,
  });
  for (const partial of [
    { currentLifetimeAnchorProjection: null },
    { currentLifetimeAttemptAnchorRawSha256: null },
    { currentLifetimeAnchorPredecessorExternalHead: null },
  ]) {
    assertContractReject(() =>
      recovery.replayCandidateContainmentRecoveryV1({ ...exact, ...partial }),
    );
  }
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1({
      ...exact,
      currentLifetimeAnchorPredecessorExternalHead: {
        ...plain(headB),
      },
    }),
  );

  const closeContext = buildGenesis("brand-close", {
    bundleCount: 18,
    location: "active",
  });
  closeContext.fixture.appendNormalClose();
  closeContext.fixture.refreshTarget(recovery);
  const closeReceipt = closeContext.fixture.closeSelection();
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1({
      ...exact,
      normalCloseDurabilityReceipt: closeReceipt,
    }),
  );

  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1({
      ...planInput(contextA.fixture, targetA, contextA.inventory, replayA),
      proposedActorKind: null,
    }),
  );
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1({
      ...planInput(contextA.fixture, targetA, contextA.inventory, replayA),
      proposedActorKind: "RECOVERY_ONLY_GUARDIAN",
    }),
  );
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1({
      ...planInput(
        contextA.fixture,
        targetB,
        contextA.inventory,
        recovery.replayCandidateContainmentRecoveryV1(exact),
        { phase: 2, anchorSelection: anchorB },
      ),
      proposedActorKind: "LIVE_BIRTH_GUARDIAN",
    }),
  );

  const structural = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(contextA.fixture, targetB, {
      entries: [],
      expectedExternalHead: null,
    }),
  );
  assert.equal(structural.externalTailHeadMatched, null);
  assert.equal(structural.tailCompletenessExternallyAnchored, false);
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(contextA.fixture, targetB, contextA.inventory, structural),
    ),
  );
});

test("rejects downstream inventory, plan, attempt, and anchored-empty lookalikes plus fresh wrong actor kinds", () => {
  const normal = buildGenesis("downstream-brand-normal");
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(
        normal.fixture,
        normal.target,
        plain(normal.inventory),
        normal.zeroReplay,
      ),
    ),
  );
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(
        normal.fixture,
        normal.target,
        normal.inventory,
        normal.zeroReplay,
        {
          overrides: { requiredActorKind: "RECOVERY_ONLY_GUARDIAN" },
        },
      ),
    ),
  );

  const ready = addReadyAnchor(normal);
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryAttemptV1({
      target: ready.target,
      lifecycleInventoryObservation: ready.inventory,
      previousRecoveryReplay: ready.replay,
      plan: plain(ready.plan),
      lifetimeAnchorProjection: ready.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        ready.anchorSelection.lifetimeAttemptAnchorRawSha256,
    }),
  );
  const attempted = createAttempt(ready);
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryRecordV1({
      target: attempted.target,
      lifecycleInventoryObservation: attempted.inventory,
      previousRecoveryReplay: attempted.replay,
      plan: attempted.plan,
      lifetimeAnchorProjection:
        attempted.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        attempted.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: plain(attempted.attempt),
      previousRecord: null,
      operationBytes: jsonLine(opaque("downstream-attempt:operation")),
      evidenceBytes: jsonLine(plain(attempted.inventory)),
    }),
  );

  const emptyContext = addReadyAnchor(buildGenesis("downstream-brand-empty"));
  const publishedEmpty = publishAnchoredEmptyAttempt(emptyContext, "ABSENT");
  const brandedEmptyEntry = brandedHistoryEntry(
    publishedEmpty.fixture,
    publishedEmpty.history[0],
  );
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(publishedEmpty.fixture, publishedEmpty.target, {
        entries: [
          {
            ...brandedEmptyEntry,
            anchoredEmptyAttempt: plain(publishedEmpty.anchoredEmptyAttempt),
          },
        ],
        expectedExternalHead: publishedEmpty.fixture.headSelection(),
      }),
    ),
  );

  const reboot = buildGenesis("downstream-brand-reboot", {
    location: "active",
  });
  reboot.fixture.startRebootRecovery();
  const rebootTarget = reboot.fixture.refreshTarget(recovery);
  const rebootHead = reboot.fixture.headSelection();
  const rebootReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(reboot.fixture, rebootTarget, {
      entries: [],
      expectedExternalHead: rebootHead,
    }),
  );
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(reboot.fixture, rebootTarget, reboot.inventory, rebootReplay, {
        overrides: { requiredActorKind: "LIVE_BIRTH_GUARDIAN" },
      }),
    ),
  );
});

test("blocks zero, multiple, and unsafe lifecycle inventories and enforces exact cgroup nullability", () => {
  const base = buildGenesis("inventory-semantic-matrix", {
    bundleCount: 5,
    location: "active",
  });
  const inventoryCases = [
    {
      label: "zero",
      fields: {
        stagingPresent: false,
        activePresent: false,
        closedPresent: false,
        recoveredPresent: false,
        quarantinedPresent: false,
        unsafeEntriesPresent: false,
      },
    },
    {
      label: "multiple",
      fields: {
        stagingPresent: true,
        activePresent: true,
        closedPresent: false,
        recoveredPresent: false,
        quarantinedPresent: false,
        unsafeEntriesPresent: false,
      },
    },
    {
      label: "unsafe-entry",
      fields: {
        stagingPresent: false,
        activePresent: true,
        closedPresent: false,
        recoveredPresent: false,
        quarantinedPresent: false,
        unsafeEntriesPresent: true,
      },
    },
  ];
  for (const specification of inventoryCases) {
    const observation =
      recovery.createCandidateContainmentRecoveryInventoryObservationV1({
        generationIdentitySha256:
          base.fixture.journal.generationIdentity.identitySha256,
        ...specification.fields,
      });
    const plan = recovery.planCandidateContainmentRecoveryV1({
      ...planInput(base.fixture, base.target, observation, base.zeroReplay),
      proposedActorKind: null,
    });
    assert.equal(
      plan.status,
      "UNSAFE_FILESYSTEM_INVENTORY_BLOCKED",
      specification.label,
    );
    assert.equal(plan.lifecycleInventorySha256, observation.inventorySha256);
    assert.equal(plan.disposition, null);
    assert.deepEqual(plan.states, []);
    assertBoundarySummary(plan);
  }

  const anchored = addReadyAnchor(base, {
    reportedCommandDescriptorHeld: true,
    reportedStatusDescriptorHeld: true,
    reportedSupervisorPidfdHeld: true,
    reportedDirectChildWaitAuthority: true,
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  });
  const phaseTwo = (overrides) =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(
        anchored.fixture,
        anchored.target,
        anchored.inventory,
        anchored.replay,
        {
          phase: 2,
          anchorSelection: anchored.anchorSelection,
          overrides: {
            reportedCommandDescriptorHeld: true,
            reportedStatusDescriptorHeld: true,
            reportedSupervisorPidfdHeld: true,
            reportedDirectChildWaitAuthority: true,
            reportedControlCgroupPresent: true,
            reportedJobCgroupPresent: true,
            ...overrides,
          },
        },
      ),
    );
  const unsafeCgroups = phaseTwo({
    reportedCgroupInventorySafe: false,
    reportedControlCgroupPresent: null,
    reportedJobCgroupPresent: null,
  });
  assert.equal(unsafeCgroups.status, "RECOVERY_PLAN_READY");
  assert.equal(unsafeCgroups.disposition, "QUARANTINE");
  assert.equal(unsafeCgroups.quarantineReason, "UNSAFE_CGROUP_INVENTORY");
  assertBoundarySummary(unsafeCgroups);
  for (const mixed of [
    [null, false],
    [true, null],
  ]) {
    assertContractReject(() =>
      phaseTwo({
        reportedCgroupInventorySafe: false,
        reportedControlCgroupPresent: mixed[0],
        reportedJobCgroupPresent: mixed[1],
      }),
    );
  }
});

test("preserves a durable phase-two anchor across filesystem rejection and restores absent or empty finalization", () => {
  for (const reportedAttemptDirectoryState of ["ABSENT", "PRESENT_EMPTY"]) {
    const context = addReadyAnchor(
      buildGenesis(`filesystem-restored-${reportedAttemptDirectoryState}`),
    );
    const rejected = recovery.planCandidateContainmentRecoveryV1(
      planInput(
        context.fixture,
        context.target,
        context.inventory,
        context.replay,
        {
          phase: 2,
          anchorSelection: context.anchorSelection,
          overrides: {
            reportedStateFilesystemInterfaceAvailable: false,
          },
        },
      ),
    );
    assert.equal(rejected.status, "STATE_FILESYSTEM_INTERFACE_REJECTED");
    assert.equal(rejected.currentLifetimeAnchorMatched, true);
    assert.equal(rejected.requiredActorKind, null);
    assert.deepEqual(rejected.states, []);
    assertBoundarySummary(rejected);

    const restored = recovery.planCandidateContainmentRecoveryV1(
      planInput(
        context.fixture,
        context.target,
        context.inventory,
        context.replay,
        {
          phase: 2,
          anchorSelection: context.anchorSelection,
        },
      ),
    );
    assert.equal(restored.status, "RECOVERY_PLAN_READY");
    assert.equal(restored.currentLifetimeAnchorMatched, true);
    const anchoredEmptyAttempt =
      recovery.createCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
        target: context.target,
        previousRecoveryReplay: context.replay,
        lifetimeAnchorProjection:
          context.anchorSelection.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          context.anchorSelection.lifetimeAttemptAnchorRawSha256,
        reportedAttemptDirectoryState,
      });
    assert.equal(
      anchoredEmptyAttempt.reportedAttemptDirectoryState,
      reportedAttemptDirectoryState,
    );
    assertNullPrototypeFrozen(anchoredEmptyAttempt);
  }
});

test("selects all six quarantine reasons and every pair by the ratified first-match precedence", () => {
  const maximumFacts = {
    reportedCommandDescriptorHeld: true,
    reportedStatusDescriptorHeld: true,
    reportedSupervisorPidfdHeld: true,
    reportedDirectChildWaitAuthority: true,
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  };
  const base = addReadyAnchor(
    buildGenesis("quarantine-reason-matrix", {
      bundleCount: 5,
      location: "active",
    }),
    maximumFacts,
  );
  let uncertain = addReadyAnchor(
    buildGenesis("quarantine-reason-uncertain", {
      bundleCount: 5,
      location: "active",
    }),
    maximumFacts,
  );
  const intentIndex =
    uncertain.plan.states.indexOf("COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE") +
    1;
  uncertain = createPlanRecords(createAttempt(uncertain), intentIndex);
  uncertain = publishFinalizedAttempt(uncertain, "FINALIZED_ATTEMPT_PREFIX");
  uncertain.fixture.appendNormalTermination();
  uncertain = replayDurableHistory(uncertain);
  uncertain = addReadyAnchor(uncertain, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  });
  assert.equal(uncertain.replay.derivedPriorEffectOutcomeCertain, false);

  const reasons = [
    {
      name: "UNKNOWN_BOOT_ID",
      overrides: { reportedCurrentBootIdSha256: null },
    },
    {
      name: "DELEGATED_ROOT_IDENTITY_UNKNOWN_OR_DRIFTED",
      overrides: { reportedDelegatedRootIdentitySha256: null },
    },
    {
      name: "UNSAFE_CGROUP_INVENTORY",
      overrides: {
        reportedCgroupInventorySafe: false,
        reportedControlCgroupPresent: null,
        reportedJobCgroupPresent: null,
      },
    },
    {
      name: "INCONSISTENT_GENERATION_STATE",
      overrides: {
        reportedSupervisorPidfdHeld: false,
        reportedDirectChildWaitAuthority: true,
      },
    },
    {
      name: "UNSUPPORTED_RECOVERY_INTERFACE",
      overrides: { reportedRecoveryInterfaceAvailable: false },
    },
    {
      name: "RECOVERY_EFFECT_UNCERTAIN",
      overrides: {},
    },
  ];
  const planFor = (context, overrides) =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(
        context.fixture,
        context.target,
        context.inventory,
        context.replay,
        {
          phase: 2,
          anchorSelection: context.anchorSelection,
          overrides: {
            ...(context === base
              ? maximumFacts
              : {
                  reportedControlCgroupPresent: true,
                  reportedJobCgroupPresent: true,
                }),
            ...overrides,
          },
        },
      ),
    );
  for (const [index, reason] of reasons.entries()) {
    const context = index === reasons.length - 1 ? uncertain : base;
    const plan = planFor(context, reason.overrides);
    assert.equal(plan.disposition, "QUARANTINE", reason.name);
    assert.equal(plan.quarantineReason, reason.name, reason.name);
    assert.deepEqual(plan.states, PLAN_STATES.QUARANTINE);
    assertBoundarySummary(plan);
  }
  for (let first = 0; first < reasons.length; first++) {
    for (let second = first + 1; second < reasons.length; second++) {
      const context = second === reasons.length - 1 ? uncertain : base;
      const overrides = {
        ...reasons[first].overrides,
        ...reasons[second].overrides,
      };
      if (first === 2 || second === 2) {
        overrides.reportedCgroupInventorySafe = false;
        overrides.reportedControlCgroupPresent = null;
        overrides.reportedJobCgroupPresent = null;
      }
      const plan = planFor(context, overrides);
      assert.equal(
        plan.quarantineReason,
        reasons[first].name,
        `${reasons[first].name} before ${reasons[second].name}`,
      );
      assertBoundarySummary(plan);
    }
  }
});

test("admits every legal descriptor tuple for normal states zero through seventeen and rejects nearest neighbors", () => {
  const pairs = (left, right) => left.flatMap((a) => right.map((b) => [a, b]));
  const descriptorTuples = (normalState) => {
    if (normalState <= 3 || normalState === 17)
      return [[false, false, false, false]];
    const commandStatus = pairs([false, true], [false, true]);
    if (normalState === 4) {
      return commandStatus.flatMap(([command, status]) => [
        [command, status, false, false],
        [command, status, true, true],
      ]);
    }
    if (normalState <= 12) {
      return commandStatus.map(([command, status]) => [
        command,
        status,
        true,
        true,
      ]);
    }
    return commandStatus.flatMap(([command, status]) => [
      [command, status, false, false],
      [command, status, true, false],
    ]);
  };
  const presenceTuples = (normalState) => {
    if (normalState === 2 || normalState === 15)
      return ["00", "10", "01", "11"];
    if (normalState >= 3 && normalState <= 14) return ["11"];
    return ["00"];
  };
  const expectedStates = (normalState, descriptor, presence) => {
    if (normalState === 0) return PLAN_STATES.GENESIS_ABORT;
    const [command, status, pidfd, wait] = descriptor;
    const control = presence[0] === "1";
    const job = presence[1] === "1";
    const reapProven = normalState >= 13;
    const states = ["RECOVERY_ATTEMPT_DURABLE"];
    if (command)
      states.push(
        "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
        "COMMAND_DESCRIPTOR_CLOSED_OBSERVED",
      );
    states.push(
      ...(control
        ? ["CONTROL_KILL_INTENT_DURABLE", "CONTROL_KILL_WRITE_COMPLETED"]
        : ["CONTROL_PATH_ABSENT_OBSERVED"]),
      ...(job
        ? ["JOB_FIRST_KILL_INTENT_DURABLE", "JOB_FIRST_KILL_WRITE_COMPLETED"]
        : ["JOB_PATH_ABSENT_OBSERVED"]),
    );
    if (control) states.push("CONTROL_QUIESCENT_OBSERVED");
    if (job)
      states.push(
        "JOB_SECOND_KILL_INTENT_DURABLE",
        "JOB_SECOND_KILL_WRITE_COMPLETED",
        "JOB_QUIESCENT_OBSERVED",
      );
    if (status) states.push("STATUS_EOF_OBSERVED");
    if (pidfd)
      states.push(
        reapProven
          ? "SUPERVISOR_PIDFD_HUP_OBSERVED"
          : "SUPERVISOR_PIDFD_READABLE_OBSERVED",
      );
    if (wait && !reapProven)
      states.push(
        "SUPERVISOR_REAP_INTENT_DURABLE",
        "SUPERVISOR_REAPED_OBSERVED",
      );
    if (control || job) states.push("CGROUP_REMOVAL_INTENT_DURABLE");
    states.push(
      "CGROUP_PATHS_ABSENT_OBSERVED",
      "RECOVERED_TOMBSTONE_DURABLE",
      "RECOVERED_LOCATION_OBSERVED",
    );
    return states;
  };
  const facts = (descriptor, presence) => ({
    reportedCommandDescriptorHeld: descriptor[0],
    reportedStatusDescriptorHeld: descriptor[1],
    reportedSupervisorPidfdHeld: descriptor[2],
    reportedDirectChildWaitAuthority: descriptor[3],
    reportedControlCgroupPresent: presence[0] === "1",
    reportedJobCgroupPresent: presence[1] === "1",
  });

  let admittedLiveShapes = 0;
  let admittedRecoveryOnlyShapes = 0;
  const admittedLiveByState = [];
  const admittedRecoveryOnlyByState = [];
  for (let normalState = 0; normalState <= 17; normalState++) {
    let liveForState = 0;
    let recoveryOnlyForState = 0;
    for (const presence of presenceTuples(normalState)) {
      for (const descriptor of descriptorTuples(normalState)) {
        const label = `descriptor-live-${normalState}-${presence}-${descriptor
          .map(Number)
          .join("")}`;
        const context = addReadyAnchor(
          buildGenesis(label, {
            bundleCount: normalState,
            location: "active",
          }),
          facts(descriptor, presence),
        );
        assert.equal(context.plan.status, "RECOVERY_PLAN_READY", label);
        assert.equal(
          context.plan.disposition,
          normalState === 0 ? "GENESIS_ABORT" : "SAME_BOOT_RECONCILE",
          label,
        );
        assert.deepEqual(
          context.plan.states,
          expectedStates(normalState, descriptor, presence),
          label,
        );
        assertAdmittedPlanCreatesAndReplaysEveryPrefix(context);
        admittedLiveShapes++;
        liveForState++;
      }
    }

    for (const recoveryPresence of presenceTuples(normalState)) {
      let replacement = buildGenesis(
        `descriptor-recovery-${normalState}-${recoveryPresence}`,
        {
          bundleCount: normalState,
          location: "active",
        },
      );
      replacement.fixture.appendNormalTermination();
      replacement = refreshExternallyAnchoredReplay(replacement);
      replacement = addReadyAnchor(replacement, {
        requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
        ...facts([false, false, false, false], recoveryPresence),
      });
      assert.equal(
        replacement.phaseOne.requiredActorKind,
        "RECOVERY_ONLY_GUARDIAN",
      );
      assert.equal(replacement.plan.status, "RECOVERY_PLAN_READY");
      assert.deepEqual(
        replacement.plan.states,
        expectedStates(
          normalState,
          [false, false, false, false],
          recoveryPresence,
        ),
      );
      assertAdmittedPlanCreatesAndReplaysEveryPrefix(replacement);
      admittedRecoveryOnlyShapes++;
      recoveryOnlyForState++;
    }

    const validPresence = presenceTuples(normalState)[0];
    const invalidDescriptor =
      normalState <= 3 || normalState === 17
        ? [true, false, false, false]
        : normalState === 4
          ? [false, false, true, false]
          : normalState <= 12
            ? [false, false, false, false]
            : [false, false, false, true];
    const invalidDescriptorPlan = addReadyAnchor(
      buildGenesis(`descriptor-invalid-${normalState}`, {
        bundleCount: normalState,
        location: "active",
      }),
      facts(invalidDescriptor, validPresence),
    ).plan;
    assert.equal(invalidDescriptorPlan.disposition, "QUARANTINE");
    assert.equal(
      invalidDescriptorPlan.quarantineReason,
      "INCONSISTENT_GENERATION_STATE",
    );
    assertBoundarySummary(invalidDescriptorPlan);

    if (![2, 15].includes(normalState)) {
      const invalidPresence =
        normalState >= 3 && normalState <= 14 ? "01" : "10";
      const invalidPresencePlan = addReadyAnchor(
        buildGenesis(`presence-invalid-${normalState}`, {
          bundleCount: normalState,
          location: "active",
        }),
        facts(descriptorTuples(normalState)[0], invalidPresence),
      ).plan;
      assert.equal(invalidPresencePlan.disposition, "QUARANTINE");
      assert.equal(
        invalidPresencePlan.quarantineReason,
        "INCONSISTENT_GENERATION_STATE",
      );
      assertBoundarySummary(invalidPresencePlan);
    }
    admittedLiveByState.push(liveForState);
    admittedRecoveryOnlyByState.push(recoveryOnlyForState);
  }
  assert.deepEqual(
    admittedLiveByState,
    [1, 1, 4, 1, 8, 4, 4, 4, 4, 4, 4, 4, 4, 8, 8, 32, 8, 1],
  );
  assert.deepEqual(
    admittedRecoveryOnlyByState,
    [1, 1, 4, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4, 1, 1],
  );
  assert.equal(admittedLiveShapes, 104);
  assert.equal(admittedRecoveryOnlyShapes, 24);
});

test("covers state eighteen active and destination-only closed planning with exact receipt gating", () => {
  const active = buildGenesis("state18-complete-matrix-active", {
    bundleCount: 18,
    location: "active",
  });
  const activeWithoutReceipt = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      active.fixture,
      active.target,
      active.inventory,
      active.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assert.equal(activeWithoutReceipt.status, "CLOSE_MOVE_REQUIRED");
  assert.equal(activeWithoutReceipt.sourceLocation, "active");
  assert.equal(activeWithoutReceipt.requiredDestinationLocation, "closed");
  assertBoundarySummary(activeWithoutReceipt);

  const closed = buildGenesis("state18-complete-matrix-closed", {
    bundleCount: 18,
    location: "closed",
  });
  const closedWithoutReceipt = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      closed.fixture,
      closed.target,
      closed.inventory,
      closed.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assert.equal(closedWithoutReceipt.status, "CLOSE_MOVE_REQUIRED");
  assert.equal(closedWithoutReceipt.sourceLocation, "closed");
  assert.equal(closedWithoutReceipt.requiredDestinationLocation, "closed");
  assert.equal(closedWithoutReceipt.terminal, false);
  assertBoundarySummary(closedWithoutReceipt);

  closed.fixture.appendNormalClose();
  const target = closed.fixture.refreshTarget(recovery);
  const expectedExternalHead = closed.fixture.headSelection();
  const receipt = closed.fixture.closeSelection();
  const receiptedReplay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(closed.fixture, target, {
      entries: [],
      expectedExternalHead,
      normalCloseDurabilityReceipt: receipt,
    }),
  );
  const closedInventory = createInventory(closed.fixture, "closed");
  const closedWithReceipt = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(closed.fixture, target, closedInventory, receiptedReplay, {
      overrides: { normalCloseDurabilityReceipt: receipt },
    }),
    proposedActorKind: null,
    normalCloseDurabilityReceipt: receipt,
  });
  assert.equal(closedWithReceipt.status, "CLOSED_LOCATION_OBSERVED");
  assert.equal(closedWithReceipt.sourceLocation, "closed");
  assert.equal(closedWithReceipt.requiredDestinationLocation, "closed");
  assert.equal(closedWithReceipt.terminal, true);
  assertBoundarySummary(closedWithReceipt);

  const activeCollision = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      closed.fixture,
      target,
      createInventory(closed.fixture, "active"),
      receiptedReplay,
      { overrides: { normalCloseDurabilityReceipt: receipt } },
    ),
    proposedActorKind: null,
    normalCloseDurabilityReceipt: receipt,
  });
  assert.equal(activeCollision.status, "INCONSISTENT_GENERATION_STATE_BLOCKED");
  assertBoundarySummary(activeCollision);
});

test("preserves inherited decisions through an empty successor and enforces source or destination-only resume", () => {
  const cases = [
    {
      label: "decision-empty-recovered",
      firstOverrides: {},
      prefixCount: 4,
      inherited: "RECOVERED",
      disposition: "RECOVERED_DECISION_RESUME",
      states: PLAN_STATES.RECOVERED_DECISION_RESUME,
      destination: "recovered",
      wrongLocations: ["active", "quarantined"],
    },
    {
      label: "decision-empty-quarantined",
      firstOverrides: { reportedCurrentBootIdSha256: null },
      prefixCount: 2,
      inherited: "QUARANTINED",
      disposition: "QUARANTINE_DECISION_RESUME",
      states: PLAN_STATES.QUARANTINE_DECISION_RESUME,
      destination: "quarantined",
      wrongLocations: ["active", "recovered"],
    },
  ];
  for (const specification of cases) {
    let context = addReadyAnchor(
      buildGenesis(specification.label, { location: "staging" }),
      specification.firstOverrides,
    );
    context = createPlanRecords(
      createAttempt(context),
      specification.prefixCount,
    );
    context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
    assert.equal(
      context.zeroReplay.inheritedTerminalDecision,
      specification.inherited,
    );
    context.fixture.appendNormalTermination();
    context = replayDurableHistory(context);
    context = addReadyAnchor(context, {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      ...specification.firstOverrides,
    });
    context = publishAnchoredEmptyAttempt(context, "ABSENT");
    assert.equal(
      context.zeroReplay.inheritedTerminalDecision,
      specification.inherited,
    );
    assert.equal(context.zeroReplay.decisionSourceLocation, "staging");
    context = addReadyAnchor(context, {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      ...specification.firstOverrides,
    });

    const destinationInventory = createInventory(
      context.fixture,
      specification.destination,
    );
    const destinationPlan = recovery.planCandidateContainmentRecoveryV1(
      planInput(
        context.fixture,
        context.target,
        destinationInventory,
        context.replay,
        {
          phase: 2,
          anchorSelection: context.anchorSelection,
          overrides: specification.firstOverrides,
        },
      ),
    );
    assert.equal(destinationPlan.status, "RECOVERY_PLAN_READY");
    assert.equal(destinationPlan.disposition, specification.disposition);
    assert.equal(destinationPlan.sourceLocation, specification.destination);
    assert.equal(destinationPlan.decisionSourceLocation, "staging");
    assert.equal(
      destinationPlan.requiredDestinationLocation,
      specification.destination,
    );
    assert.deepEqual(destinationPlan.states, specification.states);
    assertAdmittedPlanCreatesAndReplaysEveryPrefix({
      ...context,
      inventory: destinationInventory,
      plan: destinationPlan,
    });

    for (const location of specification.wrongLocations) {
      const wrongPlan = recovery.planCandidateContainmentRecoveryV1(
        planInput(
          context.fixture,
          context.target,
          createInventory(context.fixture, location),
          context.replay,
          {
            phase: 2,
            anchorSelection: context.anchorSelection,
            overrides: specification.firstOverrides,
          },
        ),
      );
      assert.equal(
        wrongPlan.status,
        "INCONSISTENT_GENERATION_STATE_BLOCKED",
        `${specification.inherited}:${location}`,
      );
      assertBoundarySummary(wrongPlan);
    }
  }
});

test("admits each inherited decision only at its immutable origin or matching destination", () => {
  const decisions = [
    {
      decision: "RECOVERED",
      disposition: "RECOVERED_DECISION_RESUME",
      destination: "recovered",
      states: PLAN_STATES.RECOVERED_DECISION_RESUME,
    },
    {
      decision: "QUARANTINED",
      disposition: "QUARANTINE_DECISION_RESUME",
      destination: "quarantined",
      states: PLAN_STATES.QUARANTINE_DECISION_RESUME,
    },
  ];
  const locations = ["staging", "active", "closed", "recovered", "quarantined"];
  for (const specification of decisions) {
    for (const origin of ["staging", "active"]) {
      for (const currentLocation of [origin, specification.destination]) {
        const label = `resume-matrix-${specification.decision}-${origin}-${currentLocation}`;
        let context = buildInheritedDecisionPrefix(label, {
          decision: specification.decision,
          origin,
        });
        context = {
          ...context,
          inventory: createInventory(context.fixture, currentLocation),
        };
        const overrides = {
          requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
        };
        context = addReadyAnchor(context, overrides);
        const input = planInput(
          context.fixture,
          context.target,
          context.inventory,
          context.replay,
          { phase: 2, anchorSelection: context.anchorSelection, overrides },
        );
        assertExactReadyPlan(context, input, {
          actorKind: "RECOVERY_ONLY_GUARDIAN",
          disposition: specification.disposition,
          sourceLocation: currentLocation,
          decisionSourceLocation: origin,
          destinationLocation: specification.destination,
          states: specification.states,
          inheritedTerminalDecision: specification.decision,
          latestAttemptState: context.durableState,
          latestFinalizedRecoveryState: context.durableState,
        });
        assertAdmittedPlanCreatesAndReplaysEveryPrefix(context);
      }

      for (const currentLocation of locations.filter(
        (location) =>
          location !== origin && location !== specification.destination,
      )) {
        const label = `resume-matrix-blocked-${specification.decision}-${origin}-${currentLocation}`;
        let context = buildInheritedDecisionPrefix(label, {
          decision: specification.decision,
          origin,
        });
        const inventory = createInventory(context.fixture, currentLocation);
        const input = planInput(
          context.fixture,
          context.target,
          inventory,
          context.zeroReplay,
          {
            overrides: {
              requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
            },
          },
        );
        const plan = recovery.planCandidateContainmentRecoveryV1(input);
        assertExactPlanResult(
          plan,
          expectedPlanFields(
            context.target.targetSha256,
            inventory.inventorySha256,
          ),
        );
      }
    }
  }
});

test("inherits both durable decisions across a proved boot instead of selecting fresh reboot recovery", () => {
  for (const decision of ["RECOVERED", "QUARANTINED"]) {
    for (const origin of ["staging", "active"]) {
      const specification =
        decision === "RECOVERED"
          ? {
              disposition: "RECOVERED_DECISION_RESUME",
              destination: "recovered",
              states: PLAN_STATES.RECOVERED_DECISION_RESUME,
            }
          : {
              disposition: "QUARANTINE_DECISION_RESUME",
              destination: "quarantined",
              states: PLAN_STATES.QUARANTINE_DECISION_RESUME,
            };
      let context = buildInheritedDecisionPrefix(
        `resume-after-reboot-${decision}-${origin}`,
        { decision, origin, rebootDepth: 1 },
      );
      assert.notEqual(
        context.target.bootIdSha256,
        context.fixture.lifetimeContext.bootIdSha256,
      );
      context = {
        ...context,
        inventory: createInventory(context.fixture, origin),
      };
      const overrides = {
        requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
      };
      context = addReadyAnchor(context, overrides);
      const input = planInput(
        context.fixture,
        context.target,
        context.inventory,
        context.replay,
        { phase: 2, anchorSelection: context.anchorSelection, overrides },
      );
      assert.equal(context.plan.disposition, specification.disposition);
      assert.notEqual(context.plan.disposition, "REBOOT_INTERRUPTION");
      assert.equal(
        context.plan.recoveryContext.reportedCurrentBootIdSha256,
        context.fixture.lifetimeContext.bootIdSha256,
      );
      assert.equal(
        context.plan.recoveryContext.reportedDelegatedRootIdentitySha256,
        context.fixture.lifetimeContext.delegatedRootIdentitySha256,
      );
      assertExactReadyPlan(context, input, {
        actorKind: "RECOVERY_ONLY_GUARDIAN",
        disposition: specification.disposition,
        sourceLocation: origin,
        decisionSourceLocation: origin,
        destinationLocation: specification.destination,
        states: specification.states,
        inheritedTerminalDecision: decision,
        latestAttemptState: context.durableState,
        latestFinalizedRecoveryState: context.durableState,
      });

      if (decision === "RECOVERED") {
        for (const [label, adverse, expectedStatus] of [
          [
            "null-current-boot",
            { reportedCurrentBootIdSha256: null },
            "INCONSISTENT_GENERATION_STATE_BLOCKED",
          ],
          [
            "wrong-delegated-root",
            {
              reportedDelegatedRootIdentitySha256: digest(
                `resume-after-reboot:${origin}:wrong-delegated-root`,
              ),
            },
            "INCONSISTENT_GENERATION_STATE_BLOCKED",
          ],
          [
            "unsafe-cgroups",
            {
              reportedCgroupInventorySafe: false,
              reportedControlCgroupPresent: null,
              reportedJobCgroupPresent: null,
            },
            "INCONSISTENT_GENERATION_STATE_BLOCKED",
          ],
          [
            "wrong-lifetime",
            {
              reportedLifetimeCgroupIdentitySha256: digest(
                `resume-after-reboot:${origin}:wrong-lifetime`,
              ),
            },
            "RECOVERY_LIFETIME_IDENTITY_REJECTED",
          ],
        ]) {
          const rejected = recovery.planCandidateContainmentRecoveryV1(
            planInput(
              context.fixture,
              context.target,
              context.inventory,
              context.replay,
              {
                phase: 2,
                anchorSelection: context.anchorSelection,
                overrides: { ...overrides, ...adverse },
              },
            ),
          );
          assert.equal(rejected.status, expectedStatus, label);
          assertBoundarySummary(rejected);
        }
      } else {
        const retainedOverrides = {
          ...overrides,
          reportedCurrentBootIdSha256: null,
          reportedDelegatedRootIdentitySha256: digest(
            `resume-after-reboot:${origin}:retained-delegated-mismatch`,
          ),
          reportedCgroupInventorySafe: false,
          reportedControlCgroupPresent: null,
          reportedJobCgroupPresent: null,
          reportedRecoveryInterfaceAvailable: false,
        };
        const retainedInput = planInput(
          context.fixture,
          context.target,
          context.inventory,
          context.replay,
          {
            phase: 2,
            anchorSelection: context.anchorSelection,
            overrides: retainedOverrides,
          },
        );
        const retained =
          recovery.planCandidateContainmentRecoveryV1(retainedInput);
        assertExactReadyPlan(context, retainedInput, {
          plan: retained,
          actorKind: "RECOVERY_ONLY_GUARDIAN",
          disposition: specification.disposition,
          sourceLocation: origin,
          decisionSourceLocation: origin,
          destinationLocation: specification.destination,
          states: specification.states,
          inheritedTerminalDecision: decision,
          latestAttemptState: context.durableState,
          latestFinalizedRecoveryState: context.durableState,
        });
      }
      assertAdmittedPlanCreatesAndReplaysEveryPrefix(context);
    }
  }
});

test("covers every inherited decision, immutable origin, and location after a proved reboot", () => {
  const locations = ["staging", "active", "closed", "recovered", "quarantined"];
  const decisions = [
    {
      decision: "RECOVERED",
      disposition: "RECOVERED_DECISION_RESUME",
      destination: "recovered",
      states: PLAN_STATES.RECOVERED_DECISION_RESUME,
    },
    {
      decision: "QUARANTINED",
      disposition: "QUARANTINE_DECISION_RESUME",
      destination: "quarantined",
      states: PLAN_STATES.QUARANTINE_DECISION_RESUME,
    },
  ];
  const buildCell = (label, specification, origin, currentLocation) => {
    const inherited = buildInheritedDecisionPrefix(label, {
      decision: specification.decision,
      origin,
      rebootDepth: 1,
    });
    assert.notEqual(
      inherited.target.bootIdSha256,
      inherited.fixture.lifetimeContext.bootIdSha256,
    );
    const lifetimeTarget = inherited.fixture.latestLifetimeReplay.targets.find(
      (candidate) => candidate.targetSha256 === inherited.target.targetSha256,
    );
    assert.equal(lifetimeTarget.bootTransitionCount, 1);
    assert.equal(
      lifetimeTarget.currentBootIdSha256,
      inherited.fixture.lifetimeContext.bootIdSha256,
    );
    assert.equal(
      lifetimeTarget.currentDelegatedRootIdentitySha256,
      inherited.fixture.lifetimeContext.delegatedRootIdentitySha256,
    );
    assert.equal(
      lifetimeTarget.currentLifetimeCgroupIdentitySha256,
      inherited.fixture.lifetimeContext.lifetimeCgroupIdentitySha256,
    );
    return {
      ...inherited,
      inventory: createInventory(inherited.fixture, currentLocation),
    };
  };
  const assertReadyCell = (
    initial,
    specification,
    origin,
    currentLocation,
    overrides,
  ) => {
    const context = addReadyAnchor(initial, overrides);
    const input = planInput(
      context.fixture,
      context.target,
      context.inventory,
      context.replay,
      { phase: 2, anchorSelection: context.anchorSelection, overrides },
    );
    assert.equal(input.proposedActorKind, null);
    assert.equal(context.anchor.actorKind, "RECOVERY_ONLY_GUARDIAN");
    assert.equal(context.plan.disposition, specification.disposition);
    assert.notEqual(context.plan.disposition, "REBOOT_INTERRUPTION");
    assert.equal(
      context.plan.recoveryContext.reportedStateRootIdentitySha256,
      context.fixture.stateRootIdentitySha256,
    );
    assert.equal(
      context.plan.recoveryContext.reportedLifetimeCgroupIdentitySha256,
      context.fixture.lifetimeContext.lifetimeCgroupIdentitySha256,
    );
    assertExactReadyPlan(context, input, {
      actorKind: "RECOVERY_ONLY_GUARDIAN",
      disposition: specification.disposition,
      sourceLocation: currentLocation,
      decisionSourceLocation: origin,
      destinationLocation: specification.destination,
      states: specification.states,
      inheritedTerminalDecision: specification.decision,
      latestAttemptState: context.durableState,
      latestFinalizedRecoveryState: context.durableState,
    });
    assertAdmittedPlanCreatesAndReplaysEveryPrefix(context);
  };

  for (const specification of decisions) {
    for (const origin of ["staging", "active"]) {
      for (const currentLocation of locations) {
        const label = `proved-reboot-matrix-${specification.decision}-${origin}-${currentLocation}`;
        const allowed = [origin, specification.destination].includes(
          currentLocation,
        );
        const context = buildCell(
          label,
          specification,
          origin,
          currentLocation,
        );
        if (!allowed) {
          const blockedInput = planInput(
            context.fixture,
            context.target,
            context.inventory,
            context.zeroReplay,
            {
              overrides: {
                requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
              },
            },
          );
          assert.equal(
            blockedInput.proposedActorKind,
            "RECOVERY_ONLY_GUARDIAN",
          );
          const blocked =
            recovery.planCandidateContainmentRecoveryV1(blockedInput);
          assertExactPlanResult(
            blocked,
            expectedPlanFields(
              context.target.targetSha256,
              context.inventory.inventorySha256,
            ),
          );
          continue;
        }

        const exactOverrides = {
          requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
        };
        assertReadyCell(
          context,
          specification,
          origin,
          currentLocation,
          exactOverrides,
        );

        if (specification.decision === "QUARANTINED") {
          const retainedContext = buildCell(
            `${label}-retained-adverse`,
            specification,
            origin,
            currentLocation,
          );
          const retainedOverrides = {
            ...exactOverrides,
            reportedCurrentBootIdSha256: null,
            reportedDelegatedRootIdentitySha256: digest(
              `${label}:retained-delegated-mismatch`,
            ),
            reportedCgroupInventorySafe: false,
            reportedControlCgroupPresent: null,
            reportedJobCgroupPresent: null,
            reportedRecoveryInterfaceAvailable: false,
          };
          assertReadyCell(
            retainedContext,
            specification,
            origin,
            currentLocation,
            retainedOverrides,
          );
        }
      }
    }
  }
});

test("isolates every ratified post-reboot inherited-decision relationship at both allowed locations", () => {
  const specifications = [
    {
      decision: "RECOVERED",
      disposition: "RECOVERED_DECISION_RESUME",
      destination: "recovered",
      states: PLAN_STATES.RECOVERED_DECISION_RESUME,
    },
    {
      decision: "QUARANTINED",
      disposition: "QUARANTINE_DECISION_RESUME",
      destination: "quarantined",
      states: PLAN_STATES.QUARANTINE_DECISION_RESUME,
    },
  ];
  const exactActor = {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
  };
  const prepare = (
    label,
    specification,
    origin,
    currentLocation,
    { priorEffectOutcomeUncertain = false } = {},
  ) => {
    let context = buildInheritedDecisionPrefix(label, {
      decision: specification.decision,
      origin,
      rebootDepth: 1,
      priorEffectOutcomeUncertain,
    });
    context = {
      ...context,
      inventory: createInventory(context.fixture, currentLocation),
    };
    context = addReadyAnchor(context, exactActor);
    const lifetimeTarget = context.fixture.latestLifetimeReplay.targets.find(
      (candidate) => candidate.targetSha256 === context.target.targetSha256,
    );
    assert.equal(lifetimeTarget.bootTransitionCount, 1, label);
    assert.equal(
      lifetimeTarget.currentBootIdSha256,
      context.fixture.lifetimeContext.bootIdSha256,
      label,
    );
    assert.equal(
      context.replay.derivedPriorEffectOutcomeCertain,
      !priorEffectOutcomeUncertain,
      label,
    );
    assertBoundarySummary(context.replay);
    return context;
  };
  const exactReady = (
    label,
    specification,
    origin,
    currentLocation,
    overrides = {},
    ancestry = {},
  ) => {
    const context = prepare(
      label,
      specification,
      origin,
      currentLocation,
      ancestry,
    );
    const input = planInput(
      context.fixture,
      context.target,
      context.inventory,
      context.replay,
      {
        phase: 2,
        anchorSelection: context.anchorSelection,
        overrides: { ...exactActor, ...overrides },
      },
    );
    const plan = recovery.planCandidateContainmentRecoveryV1(input);
    assertExactReadyPlan(context, input, {
      plan,
      actorKind: "RECOVERY_ONLY_GUARDIAN",
      disposition: specification.disposition,
      sourceLocation: currentLocation,
      decisionSourceLocation: origin,
      destinationLocation: specification.destination,
      states: specification.states,
      inheritedTerminalDecision: specification.decision,
      latestAttemptState: context.durableState,
      latestFinalizedRecoveryState: context.durableState,
    });
    assertAdmittedPlanCreatesAndReplaysEveryPrefix({ ...context, plan });
  };
  const exactBlocked = (
    label,
    specification,
    origin,
    currentLocation,
    overrides,
    expectedStatus,
    inventoryLocation = currentLocation,
    ancestry = {},
  ) => {
    const context = prepare(
      label,
      specification,
      origin,
      currentLocation,
      ancestry,
    );
    const inventory =
      inventoryLocation === currentLocation
        ? context.inventory
        : createInventory(context.fixture, inventoryLocation);
    const input = planInput(
      context.fixture,
      context.target,
      inventory,
      context.replay,
      {
        phase: 2,
        anchorSelection: context.anchorSelection,
        overrides: { ...exactActor, ...overrides },
      },
    );
    const plan = recovery.planCandidateContainmentRecoveryV1(input);
    assertExactPlanResult(
      plan,
      expectedPlanFields(
        context.target.targetSha256,
        inventory.inventorySha256,
        {
          status: expectedStatus,
          currentLifetimeAnchorMatched: true,
          decisionSourceLocation: origin,
          inheritedTerminalDecision: specification.decision,
          latestAttemptState: context.durableState,
          latestFinalizedRecoveryState: context.durableState,
        },
      ),
    );
  };

  for (const specification of specifications) {
    for (const origin of ["staging", "active"]) {
      for (const currentLocation of [origin, specification.destination]) {
        const stem = `proved-reboot-isolated-${specification.decision}-${origin}-${currentLocation}`;
        exactReady(`${stem}-baseline`, specification, origin, currentLocation);
        exactBlocked(
          `${stem}-wrong-state-root`,
          specification,
          origin,
          currentLocation,
          {
            reportedStateRootIdentitySha256: digest(`${stem}:wrong-state-root`),
          },
          "STATE_ROOT_IDENTITY_REJECTED",
        );
        exactBlocked(
          `${stem}-wrong-lifetime`,
          specification,
          origin,
          currentLocation,
          {
            reportedLifetimeCgroupIdentitySha256: digest(
              `${stem}:wrong-lifetime`,
            ),
          },
          "RECOVERY_LIFETIME_IDENTITY_REJECTED",
        );

        const wrongLocation = origin === "staging" ? "active" : "staging";
        exactBlocked(
          `${stem}-wrong-location`,
          specification,
          origin,
          currentLocation,
          {},
          "INCONSISTENT_GENERATION_STATE_BLOCKED",
          wrongLocation,
        );
        exactBlocked(
          `${stem}-wrong-location-and-root`,
          specification,
          origin,
          currentLocation,
          {
            reportedStateRootIdentitySha256: digest(
              `${stem}:wrong-location-and-root`,
            ),
          },
          "STATE_ROOT_IDENTITY_REJECTED",
          wrongLocation,
        );
        exactBlocked(
          `${stem}-wrong-location-and-lifetime`,
          specification,
          origin,
          currentLocation,
          {
            reportedLifetimeCgroupIdentitySha256: digest(
              `${stem}:wrong-location-and-lifetime`,
            ),
          },
          "RECOVERY_LIFETIME_IDENTITY_REJECTED",
          wrongLocation,
        );

        if (specification.decision === "RECOVERED") {
          for (const [label, overrides] of [
            ["null-current-boot", { reportedCurrentBootIdSha256: null }],
            [
              "wrong-current-boot",
              {
                reportedCurrentBootIdSha256: digest(
                  `${stem}:wrong-current-boot`,
                ),
              },
            ],
            [
              "null-delegated-root",
              { reportedDelegatedRootIdentitySha256: null },
            ],
            [
              "wrong-delegated-root",
              {
                reportedDelegatedRootIdentitySha256: digest(
                  `${stem}:wrong-delegated-root`,
                ),
              },
            ],
            [
              "unsafe-cgroups",
              {
                reportedCgroupInventorySafe: false,
                reportedControlCgroupPresent: null,
                reportedJobCgroupPresent: null,
              },
            ],
            ["control-present", { reportedControlCgroupPresent: true }],
            ["job-present", { reportedJobCgroupPresent: true }],
            [
              "both-cgroups-present",
              {
                reportedControlCgroupPresent: true,
                reportedJobCgroupPresent: true,
              },
            ],
          ]) {
            exactBlocked(
              `${stem}-${label}`,
              specification,
              origin,
              currentLocation,
              overrides,
              "INCONSISTENT_GENERATION_STATE_BLOCKED",
            );
          }
          exactReady(
            `${stem}-interface-unavailable`,
            specification,
            origin,
            currentLocation,
            { reportedRecoveryInterfaceAvailable: false },
          );
        } else {
          exactReady(
            `${stem}-prior-effect-uncertain`,
            specification,
            origin,
            currentLocation,
            {},
            { priorEffectOutcomeUncertain: true },
          );
          for (const [label, overrides] of [
            ["retained-null-boot", { reportedCurrentBootIdSha256: null }],
            [
              "retained-wrong-boot",
              {
                reportedCurrentBootIdSha256: digest(
                  `${stem}:retained-wrong-boot`,
                ),
              },
            ],
            [
              "retained-null-delegated-root",
              { reportedDelegatedRootIdentitySha256: null },
            ],
            [
              "retained-wrong-delegated-root",
              {
                reportedDelegatedRootIdentitySha256: digest(
                  `${stem}:retained-wrong-delegated-root`,
                ),
              },
            ],
            [
              "retained-unsafe-cgroups",
              {
                reportedCgroupInventorySafe: false,
                reportedControlCgroupPresent: null,
                reportedJobCgroupPresent: null,
              },
            ],
            [
              "retained-interface-unavailable",
              { reportedRecoveryInterfaceAvailable: false },
            ],
            [
              "retained-combined-adverse",
              {
                reportedCurrentBootIdSha256: null,
                reportedDelegatedRootIdentitySha256: digest(
                  `${stem}:retained-combined-delegated`,
                ),
                reportedCgroupInventorySafe: false,
                reportedControlCgroupPresent: null,
                reportedJobCgroupPresent: null,
                reportedRecoveryInterfaceAvailable: false,
              },
            ],
          ]) {
            exactReady(
              `${stem}-${label}`,
              specification,
              origin,
              currentLocation,
              overrides,
            );
          }
        }
      }
    }
  }
});

test("accepts cumulative proved-reboot depths one through four and rejects stale adjacency or a fifth", () => {
  for (let depth = 1; depth <= 4; depth++) {
    let context = buildGenesis(`cumulative-reboot-depth-${depth}`, {
      bundleCount: 5,
      location: "active",
    });
    const historicalTarget = context.target;
    const transitions = [];
    const staleTransitionTargets = [historicalTarget];
    for (let index = 0; index < depth; index++) {
      transitions.push(context.fixture.startRebootRecovery());
      if (index + 1 < depth) {
        staleTransitionTargets.push(context.fixture.refreshTarget(recovery));
      }
    }
    for (const [index, current] of transitions.entries()) {
      assert.equal(
        current.transition.previousBootIdSha256,
        index === 0
          ? historicalTarget.bootIdSha256
          : transitions[index - 1].identity.bootIdSha256,
      );
      assert.equal(
        current.transition.currentBootIdSha256,
        current.identity.bootIdSha256,
      );
      assert.equal(
        current.transition.currentDelegatedRootIdentitySha256,
        current.identity.delegatedRootIdentitySha256,
      );
      assert.equal(
        current.transition.currentLifetimeCgroupIdentitySha256,
        current.context.lifetimeCgroupIdentitySha256,
      );
    }
    const lifetimeTarget = context.fixture.latestLifetimeReplay.targets.find(
      (candidate) => candidate.targetSha256 === historicalTarget.targetSha256,
    );
    assert.equal(lifetimeTarget.bootTransitionCount, depth);
    assert.equal(
      lifetimeTarget.currentBootIdSha256,
      context.fixture.lifetimeContext.bootIdSha256,
    );
    assert.equal(
      lifetimeTarget.currentDelegatedRootIdentitySha256,
      context.fixture.lifetimeContext.delegatedRootIdentitySha256,
    );
    assert.equal(
      lifetimeTarget.currentLifetimeCgroupIdentitySha256,
      context.fixture.lifetimeContext.lifetimeCgroupIdentitySha256,
    );

    context = refreshExternallyAnchoredReplay(context);
    context = {
      ...context,
      inventory: createInventory(context.fixture, "active"),
    };
    context = addReadyAnchor(context, {
      requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
    });
    const input = planInput(
      context.fixture,
      context.target,
      context.inventory,
      context.replay,
      { phase: 2, anchorSelection: context.anchorSelection },
    );
    assertExactReadyPlan(context, input, {
      actorKind: "RECOVERY_ONLY_GUARDIAN",
      disposition: "REBOOT_INTERRUPTION",
      sourceLocation: "active",
      decisionSourceLocation: "active",
      destinationLocation: "recovered",
      states: PLAN_STATES.REBOOT_INTERRUPTION,
    });
    for (const staleTransitionTarget of staleTransitionTargets) {
      assertContractReject(() =>
        recovery.planCandidateContainmentRecoveryV1(
          planInput(
            context.fixture,
            staleTransitionTarget,
            context.inventory,
            context.replay,
            { phase: 2, anchorSelection: context.anchorSelection },
          ),
        ),
      );
    }

    for (const [label, adverse, expectedStatus, expectedReason] of [
      [
        "stale-reported-boot",
        {
          reportedCurrentBootIdSha256:
            transitions.at(-1).transition.previousBootIdSha256,
        },
        "RECOVERY_PLAN_READY",
        "UNKNOWN_BOOT_ID",
      ],
      [
        "stale-reported-delegated-root",
        {
          reportedDelegatedRootIdentitySha256:
            transitions.at(-1).transition.previousDelegatedRootIdentitySha256,
        },
        "RECOVERY_PLAN_READY",
        "DELEGATED_ROOT_IDENTITY_UNKNOWN_OR_DRIFTED",
      ],
      [
        "stale-reported-lifetime",
        {
          reportedLifetimeCgroupIdentitySha256:
            transitions.at(-1).transition.previousLifetimeCgroupIdentitySha256,
        },
        "RECOVERY_LIFETIME_IDENTITY_REJECTED",
        null,
      ],
    ]) {
      const rejected = recovery.planCandidateContainmentRecoveryV1(
        planInput(
          context.fixture,
          context.target,
          context.inventory,
          context.replay,
          {
            phase: 2,
            anchorSelection: context.anchorSelection,
            overrides: adverse,
          },
        ),
      );
      assert.equal(rejected.status, expectedStatus, `${depth}:${label}`);
      assert.equal(
        rejected.quarantineReason,
        expectedReason,
        `${depth}:${label}`,
      );
      if (expectedReason !== null) {
        assert.equal(rejected.disposition, "QUARANTINE", `${depth}:${label}`);
      }
      assertBoundarySummary(rejected);
    }
    assertAdmittedPlanCreatesAndReplaysEveryPrefix(context);
  }

  const overflow = buildGenesis("cumulative-reboot-depth-overflow", {
    location: "active",
  });
  for (let index = 0; index < 4; index++) {
    overflow.fixture.startRebootRecovery();
  }
  assert.equal(
    overflow.fixture.latestLifetimeReplay.targets[0].bootTransitionCount,
    4,
  );
  assertContractReject(() => overflow.fixture.startRebootRecovery());
});

test("keeps normal state eighteen on close flow across a proved boot boundary", () => {
  const depthZero = buildGenesis("state18-reboot-depth-zero", {
    bundleCount: 18,
    location: "active",
  });
  const depthZeroPlan = recovery.planCandidateContainmentRecoveryV1({
    ...planInput(
      depthZero.fixture,
      depthZero.target,
      depthZero.inventory,
      depthZero.zeroReplay,
    ),
    proposedActorKind: null,
  });
  assert.equal(depthZeroPlan.status, "CLOSE_MOVE_REQUIRED");

  let context = buildGenesis("state18-reboot-depth-one", {
    bundleCount: 18,
    location: "active",
  });
  context.fixture.startRebootRecovery();
  context = refreshExternallyAnchoredReplay(context);
  const activeInventory = createInventory(context.fixture, "active");
  const activeInput = planInput(
    context.fixture,
    context.target,
    activeInventory,
    context.zeroReplay,
    { overrides: { requiredActorKind: null } },
  );
  const active = recovery.planCandidateContainmentRecoveryV1(activeInput);
  assertExactPlanResult(
    active,
    expectedPlanFields(
      context.target.targetSha256,
      activeInventory.inventorySha256,
      {
        status: "CLOSE_MOVE_REQUIRED",
        currentLifetimeAnchorMatched: null,
        sourceLocation: "active",
        requiredDestinationLocation: "closed",
      },
    ),
  );
  assert.notEqual(active.disposition, "REBOOT_INTERRUPTION");

  for (const location of ["staging", "recovered", "quarantined"]) {
    const inventory = createInventory(context.fixture, location);
    const blocked = recovery.planCandidateContainmentRecoveryV1(
      planInput(
        context.fixture,
        context.target,
        inventory,
        context.zeroReplay,
        { overrides: { requiredActorKind: null } },
      ),
    );
    assertExactPlanResult(
      blocked,
      expectedPlanFields(
        context.target.targetSha256,
        inventory.inventorySha256,
      ),
    );
  }

  const closedInventory = createInventory(context.fixture, "closed");
  const closedWithoutReceipt = recovery.planCandidateContainmentRecoveryV1(
    planInput(
      context.fixture,
      context.target,
      closedInventory,
      context.zeroReplay,
      { overrides: { requiredActorKind: null } },
    ),
  );
  assertExactPlanResult(
    closedWithoutReceipt,
    expectedPlanFields(
      context.target.targetSha256,
      closedInventory.inventorySha256,
      {
        status: "CLOSE_MOVE_REQUIRED",
        currentLifetimeAnchorMatched: null,
        sourceLocation: "closed",
        requiredDestinationLocation: "closed",
      },
    ),
  );

  context.fixture.appendNormalClose();
  const target = context.fixture.refreshTarget(recovery);
  const expectedExternalHead = context.fixture.headSelection();
  const normalCloseDurabilityReceipt = context.fixture.closeSelection();
  const replay = recovery.replayCandidateContainmentRecoveryV1(
    replayInput(context.fixture, target, {
      entries: [],
      expectedExternalHead,
      normalCloseDurabilityReceipt,
    }),
  );
  const receiptedInput = {
    ...planInput(context.fixture, target, closedInventory, replay, {
      overrides: { requiredActorKind: null },
    }),
    normalCloseDurabilityReceipt,
  };
  const receipted = recovery.planCandidateContainmentRecoveryV1(receiptedInput);
  assertExactPlanResult(
    receipted,
    expectedPlanFields(target.targetSha256, closedInventory.inventorySha256, {
      status: "CLOSED_LOCATION_OBSERVED",
      currentLifetimeAnchorMatched: null,
      sourceLocation: "closed",
      requiredDestinationLocation: "closed",
      terminal: true,
    }),
  );
});

test("binds a recovery-only plan to the second of two reboot transitions without identity reuse", () => {
  let context = buildGenesis("two-reboot-lineage", {
    bundleCount: 5,
    location: "active",
  });
  const first = context.fixture.startRebootRecovery();
  const second = context.fixture.startRebootRecovery();
  assert.notEqual(first.identity.bootIdSha256, second.identity.bootIdSha256);
  assert.notEqual(
    first.identity.lifetimeEpochSha256,
    second.identity.lifetimeEpochSha256,
  );
  assert.notEqual(
    first.context.lifetimeCgroupIdentitySha256,
    second.context.lifetimeCgroupIdentitySha256,
  );
  context = refreshExternallyAnchoredReplay(context);
  context = addReadyAnchor(context, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
  });
  assert.equal(context.phaseOne.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");
  assert.equal(context.plan.disposition, "REBOOT_INTERRUPTION");
  assert.equal(
    context.plan.recoveryContext.reportedCurrentBootIdSha256,
    second.identity.bootIdSha256,
  );
  assert.equal(
    context.plan.recoveryContext.reportedLifetimeCgroupIdentitySha256,
    second.context.lifetimeCgroupIdentitySha256,
  );
  const complete = assertAdmittedPlanCreatesAndReplaysEveryPrefix(context);
  assert.equal(
    complete.records[0].attempt.reportedCurrentBootIdSha256,
    second.identity.bootIdSha256,
  );
  for (const repeatedIdentity of [
    {
      ...plain(complete.attempt),
      reportedCurrentBootIdSha256: first.identity.bootIdSha256,
    },
    {
      ...plain(complete.attempt),
      reportedLifetimeCgroupIdentitySha256:
        first.context.lifetimeCgroupIdentitySha256,
    },
  ]) {
    repeatedIdentity.attemptSha256 = semanticSha256(
      Object.fromEntries(
        ATTEMPT_KEYS.slice(0, -1).map((key) => [
          key,
          plain(repeatedIdentity[key]),
        ]),
      ),
    );
    assertContractReject(() =>
      recovery.verifyCandidateContainmentRecoveryAttemptV1({
        attempt: repeatedIdentity,
        target: complete.target,
        lifecycleInventoryObservation: complete.inventory,
        previousRecoveryReplay: complete.replay,
        plan: complete.plan,
        lifetimeAnchorProjection:
          complete.anchorSelection.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          complete.anchorSelection.lifetimeAttemptAnchorRawSha256,
      }),
    );
  }
});

test("makes recovery-only lineage sticky and rejects lifetime-anchor or actor identity reuse", () => {
  let context = buildGenesis("recovery-only-stickiness", {
    location: "active",
  });
  context.fixture.appendNormalTermination();
  context = refreshExternallyAnchoredReplay(context);
  context = addReadyAnchor(context, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
  });
  const firstAnchor = context.anchor;
  const firstSelection = context.anchorSelection;
  context = publishAnchoredEmptyAttempt(context, "PRESENT_EMPTY");
  const firstEmpty = context.history.at(-1).anchoredEmptyAttempt;
  assert.equal(context.zeroReplay.liveBirthActorStillPermitted, false);
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(
        context.fixture,
        context.target,
        context.inventory,
        context.zeroReplay,
        { overrides: { requiredActorKind: "LIVE_BIRTH_GUARDIAN" } },
      ),
    ),
  );

  const second = addReadyAnchor(context, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
  });
  assert.notEqual(
    second.anchor.recoveryActorEpochSha256,
    firstAnchor.recoveryActorEpochSha256,
  );
  assertContractReject(() =>
    recovery.verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
      anchoredEmptyAttempt: plain(firstEmpty),
      target: second.target,
      previousRecoveryReplay: second.replay,
      lifetimeAnchorProjection: second.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        second.anchorSelection.lifetimeAttemptAnchorRawSha256,
    }),
  );
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryAttemptV1({
      target: second.target,
      lifecycleInventoryObservation: second.inventory,
      previousRecoveryReplay: second.replay,
      plan: second.plan,
      lifetimeAnchorProjection: firstSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        firstSelection.lifetimeAttemptAnchorRawSha256,
    }),
  );
  const attempt = createAttempt(second);
  assert.equal(
    attempt.attempt.previousRecoveryActorEpochSha256,
    firstAnchor.recoveryActorEpochSha256,
  );
});

test("enforces descriptor and cgroup absence monotonicity across successor attempts", () => {
  const initialFacts = {
    reportedCommandDescriptorHeld: false,
    reportedStatusDescriptorHeld: false,
    reportedSupervisorPidfdHeld: true,
    reportedDirectChildWaitAuthority: true,
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  };
  let descriptor = addReadyAnchor(
    buildGenesis("descriptor-monotonic-successor", {
      bundleCount: 5,
      location: "active",
    }),
    initialFacts,
  );
  descriptor = createPlanRecords(createAttempt(descriptor), 1);
  descriptor = publishFinalizedAttempt(descriptor, "FINALIZED_ATTEMPT_PREFIX");
  descriptor = addReadyAnchor(descriptor, initialFacts);
  const falseToTrue = recovery.planCandidateContainmentRecoveryV1(
    planInput(
      descriptor.fixture,
      descriptor.target,
      descriptor.inventory,
      descriptor.replay,
      {
        phase: 2,
        anchorSelection: descriptor.anchorSelection,
        overrides: {
          ...initialFacts,
          reportedCommandDescriptorHeld: true,
        },
      },
    ),
  );
  assert.equal(falseToTrue.disposition, "QUARANTINE");
  assert.equal(falseToTrue.quarantineReason, "INCONSISTENT_GENERATION_STATE");
  assertBoundarySummary(falseToTrue);

  const maximumFacts = {
    reportedCommandDescriptorHeld: true,
    reportedStatusDescriptorHeld: true,
    reportedSupervisorPidfdHeld: true,
    reportedDirectChildWaitAuthority: true,
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  };
  let cgroups = addReadyAnchor(
    buildGenesis("cgroup-monotonic-successor", {
      bundleCount: 5,
      location: "active",
    }),
    maximumFacts,
  );
  const pathsAbsentCount =
    cgroups.plan.states.indexOf("CGROUP_PATHS_ABSENT_OBSERVED") + 1;
  cgroups = createPlanRecords(createAttempt(cgroups), pathsAbsentCount);
  cgroups = publishFinalizedAttempt(cgroups, "FINALIZED_ATTEMPT_PREFIX");
  cgroups = addReadyAnchor(cgroups, {
    reportedControlCgroupPresent: false,
    reportedJobCgroupPresent: false,
  });
  assert.equal(cgroups.plan.status, "RECOVERY_PLAN_READY");
  const reappeared = recovery.planCandidateContainmentRecoveryV1(
    planInput(
      cgroups.fixture,
      cgroups.target,
      cgroups.inventory,
      cgroups.replay,
      {
        phase: 2,
        anchorSelection: cgroups.anchorSelection,
        overrides: {
          reportedControlCgroupPresent: true,
          reportedJobCgroupPresent: false,
        },
      },
    ),
  );
  assert.equal(reappeared.disposition, "QUARANTINE");
  assert.equal(reappeared.quarantineReason, "INCONSISTENT_GENERATION_STATE");
  assertBoundarySummary(reappeared);
});

test("covers remaining recovery-only, identity, state-18, resume, and reboot rows with exact whole ready plans", () => {
  const maximumFacts = {
    reportedCommandDescriptorHeld: true,
    reportedStatusDescriptorHeld: true,
    reportedSupervisorPidfdHeld: true,
    reportedDirectChildWaitAuthority: true,
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  };
  const assertWholeReady = (
    context,
    input,
    {
      actorKind,
      disposition,
      quarantineReason = null,
      sourceLocation,
      decisionSourceLocation,
      destinationLocation,
      states,
      inheritedTerminalDecision = null,
      latestAttemptState = null,
      latestFinalizedRecoveryState = null,
    },
  ) => {
    assertExactPlanResult(
      context.plan,
      expectedPlanFields(
        context.target.targetSha256,
        context.inventory.inventorySha256,
        {
          status: "RECOVERY_PLAN_READY",
          requiredActorKind: actorKind,
          currentLifetimeAnchorMatched: true,
          disposition,
          quarantineReason,
          sourceLocation,
          decisionSourceLocation,
          requiredDestinationLocation: destinationLocation,
          recoveryContext: expectedRecoveryContext(actorKind, input),
          inheritedTerminalDecision,
          latestAttemptState,
          latestFinalizedRecoveryState,
          nextPermittedRecordTypes: ["RECOVERY_ATTEMPT_DURABLE"],
          states: [...states],
          recordCount: states.length,
        },
      ),
    );
    assertContractReject(() =>
      recovery.planCandidateContainmentRecoveryV1({
        ...input,
        evaluatorUnexpectedField: true,
      }),
    );
  };

  const sameBoot = addReadyAnchor(
    buildGenesis("remaining-whole-same-boot", {
      bundleCount: 5,
      location: "active",
    }),
    maximumFacts,
  );
  const sameBootInput = planInput(
    sameBoot.fixture,
    sameBoot.target,
    sameBoot.inventory,
    sameBoot.replay,
    {
      phase: 2,
      anchorSelection: sameBoot.anchorSelection,
      overrides: maximumFacts,
    },
  );
  assertWholeReady(sameBoot, sameBootInput, {
    actorKind: "LIVE_BIRTH_GUARDIAN",
    disposition: "SAME_BOOT_RECONCILE",
    sourceLocation: "active",
    decisionSourceLocation: "active",
    destinationLocation: "recovered",
    states: PLAN_STATES.SAME_BOOT_RECONCILE_MAXIMUM,
  });

  let recoveryOnly = buildGenesis("remaining-recovery-only-descriptors", {
    bundleCount: 5,
    location: "active",
  });
  recoveryOnly.fixture.appendNormalTermination();
  recoveryOnly = refreshExternallyAnchoredReplay(recoveryOnly);
  recoveryOnly = addReadyAnchor(recoveryOnly, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  });
  assert.equal(recoveryOnly.plan.disposition, "SAME_BOOT_RECONCILE");
  for (const heldField of [
    "reportedCommandDescriptorHeld",
    "reportedStatusDescriptorHeld",
    "reportedSupervisorPidfdHeld",
    "reportedDirectChildWaitAuthority",
  ]) {
    const invalid = recovery.planCandidateContainmentRecoveryV1(
      planInput(
        recoveryOnly.fixture,
        recoveryOnly.target,
        recoveryOnly.inventory,
        recoveryOnly.replay,
        {
          phase: 2,
          anchorSelection: recoveryOnly.anchorSelection,
          overrides: {
            reportedControlCgroupPresent: true,
            reportedJobCgroupPresent: true,
            [heldField]: true,
          },
        },
      ),
    );
    assert.equal(invalid.disposition, "QUARANTINE", heldField);
    assert.equal(
      invalid.quarantineReason,
      "INCONSISTENT_GENERATION_STATE",
      heldField,
    );
    assertBoundarySummary(invalid);
  }

  let exactQuarantine = null;
  for (const mismatch of [
    {
      label: "non-null-boot",
      field: "reportedCurrentBootIdSha256",
      value: digest("remaining:wrong-current-boot"),
      reason: "UNKNOWN_BOOT_ID",
    },
    {
      label: "non-null-delegated-root",
      field: "reportedDelegatedRootIdentitySha256",
      value: digest("remaining:wrong-delegated-root"),
      reason: "DELEGATED_ROOT_IDENTITY_UNKNOWN_OR_DRIFTED",
    },
  ]) {
    const context = addReadyAnchor(
      buildGenesis(`remaining-${mismatch.label}`, { location: "active" }),
      { [mismatch.field]: mismatch.value },
    );
    assert.equal(context.plan.disposition, "QUARANTINE");
    assert.equal(context.plan.quarantineReason, mismatch.reason);
    assertBoundarySummary(context.plan);
    if (mismatch.label === "non-null-boot") exactQuarantine = context;
  }
  const exactQuarantineInput = planInput(
    exactQuarantine.fixture,
    exactQuarantine.target,
    exactQuarantine.inventory,
    exactQuarantine.replay,
    {
      phase: 2,
      anchorSelection: exactQuarantine.anchorSelection,
      overrides: {
        reportedCurrentBootIdSha256: digest("remaining:wrong-current-boot"),
      },
    },
  );
  assertWholeReady(exactQuarantine, exactQuarantineInput, {
    actorKind: "LIVE_BIRTH_GUARDIAN",
    disposition: "QUARANTINE",
    quarantineReason: "UNKNOWN_BOOT_ID",
    sourceLocation: "active",
    decisionSourceLocation: "active",
    destinationLocation: "quarantined",
    states: PLAN_STATES.QUARANTINE,
  });

  for (const location of ["staging", "recovered", "quarantined"]) {
    const stateEighteen = buildGenesis(
      `remaining-state18-invalid-${location}`,
      { bundleCount: 18, location },
    );
    const plan = recovery.planCandidateContainmentRecoveryV1({
      ...planInput(
        stateEighteen.fixture,
        stateEighteen.target,
        stateEighteen.inventory,
        stateEighteen.zeroReplay,
      ),
      proposedActorKind: null,
    });
    assert.equal(
      plan.status,
      "INCONSISTENT_GENERATION_STATE_BLOCKED",
      location,
    );
    assert.equal(plan.disposition, null, location);
    assertBoundarySummary(plan);
  }

  let recoveredResume = addReadyAnchor(
    buildGenesis("remaining-recovered-resume", { location: "staging" }),
  );
  recoveredResume = createPlanRecords(createAttempt(recoveredResume), 4);
  recoveredResume = publishFinalizedAttempt(
    recoveredResume,
    "FINALIZED_ATTEMPT_PREFIX",
  );
  recoveredResume.fixture.appendNormalTermination();
  recoveredResume = replayDurableHistory(recoveredResume);
  recoveredResume = addReadyAnchor(recoveredResume, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
  });
  const recoveredResumeInput = planInput(
    recoveredResume.fixture,
    recoveredResume.target,
    recoveredResume.inventory,
    recoveredResume.replay,
    {
      phase: 2,
      anchorSelection: recoveredResume.anchorSelection,
    },
  );
  assertWholeReady(recoveredResume, recoveredResumeInput, {
    actorKind: "RECOVERY_ONLY_GUARDIAN",
    disposition: "RECOVERED_DECISION_RESUME",
    sourceLocation: "staging",
    decisionSourceLocation: "staging",
    destinationLocation: "recovered",
    states: PLAN_STATES.RECOVERED_DECISION_RESUME,
    inheritedTerminalDecision: "RECOVERED",
    latestAttemptState: "RECOVERED_TOMBSTONE_DURABLE",
    latestFinalizedRecoveryState: "RECOVERED_TOMBSTONE_DURABLE",
  });
  assert.equal(recoveredResume.replay.derivedPriorEffectOutcomeCertain, true);
  for (const [label, overrides] of [
    [
      "unsafe",
      {
        reportedCgroupInventorySafe: false,
        reportedControlCgroupPresent: null,
        reportedJobCgroupPresent: null,
      },
    ],
    [
      "control-present",
      {
        reportedControlCgroupPresent: true,
        reportedJobCgroupPresent: false,
      },
    ],
    [
      "job-present",
      {
        reportedControlCgroupPresent: false,
        reportedJobCgroupPresent: true,
      },
    ],
  ]) {
    const rejected = recovery.planCandidateContainmentRecoveryV1(
      planInput(
        recoveredResume.fixture,
        recoveredResume.target,
        recoveredResume.inventory,
        recoveredResume.replay,
        {
          phase: 2,
          anchorSelection: recoveredResume.anchorSelection,
          overrides,
        },
      ),
    );
    assert.equal(
      rejected.status,
      "INCONSISTENT_GENERATION_STATE_BLOCKED",
      label,
    );
    assertBoundarySummary(rejected);
  }
  // Certainty is replay-derived and has no planner input field. A valid
  // inherited-recovered replay therefore cannot be made uncertain by the
  // caller; the only representable hostile case is an unbranded replay
  // lookalike, which must reject before disposition selection.
  const uncertainRecoveredReplay = {
    ...plain(recoveredResume.replay),
    derivedPriorEffectOutcomeCertain: false,
  };
  assertContractReject(() =>
    recovery.planCandidateContainmentRecoveryV1(
      planInput(
        recoveredResume.fixture,
        recoveredResume.target,
        recoveredResume.inventory,
        uncertainRecoveredReplay,
        {
          phase: 2,
          anchorSelection: recoveredResume.anchorSelection,
        },
      ),
    ),
  );

  let quarantineResume = addReadyAnchor(
    buildGenesis("remaining-quarantine-resume", {
      bundleCount: 5,
      location: "active",
    }),
    maximumFacts,
  );
  const unresolvedCount =
    quarantineResume.plan.states.indexOf(
      "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
    ) + 1;
  quarantineResume = createPlanRecords(
    createAttempt(quarantineResume),
    unresolvedCount,
  );
  quarantineResume = publishFinalizedAttempt(
    quarantineResume,
    "FINALIZED_ATTEMPT_PREFIX",
  );
  quarantineResume.fixture.appendNormalTermination();
  quarantineResume = replayDurableHistory(quarantineResume);
  quarantineResume = addReadyAnchor(quarantineResume, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
    reportedControlCgroupPresent: true,
    reportedJobCgroupPresent: true,
  });
  assert.equal(quarantineResume.plan.disposition, "QUARANTINE");
  assert.equal(
    quarantineResume.plan.quarantineReason,
    "RECOVERY_EFFECT_UNCERTAIN",
  );
  quarantineResume = createPlanRecords(createAttempt(quarantineResume), 2);
  quarantineResume = publishFinalizedAttempt(
    quarantineResume,
    "FINALIZED_ATTEMPT_PREFIX",
  );
  quarantineResume.fixture.appendRecoveryTermination();
  quarantineResume = replayDurableHistory(quarantineResume);
  quarantineResume = addReadyAnchor(quarantineResume, {
    requiredActorKind: "RECOVERY_ONLY_GUARDIAN",
    reportedCgroupInventorySafe: false,
    reportedControlCgroupPresent: null,
    reportedJobCgroupPresent: null,
    reportedRecoveryInterfaceAvailable: false,
  });
  assert.equal(quarantineResume.replay.derivedPriorEffectOutcomeCertain, false);
  const quarantineResumeInput = planInput(
    quarantineResume.fixture,
    quarantineResume.target,
    quarantineResume.inventory,
    quarantineResume.replay,
    {
      phase: 2,
      anchorSelection: quarantineResume.anchorSelection,
      overrides: {
        reportedCgroupInventorySafe: false,
        reportedControlCgroupPresent: null,
        reportedJobCgroupPresent: null,
        reportedRecoveryInterfaceAvailable: false,
      },
    },
  );
  assertWholeReady(quarantineResume, quarantineResumeInput, {
    actorKind: "RECOVERY_ONLY_GUARDIAN",
    disposition: "QUARANTINE_DECISION_RESUME",
    sourceLocation: "active",
    decisionSourceLocation: "active",
    destinationLocation: "quarantined",
    states: PLAN_STATES.QUARANTINE_DECISION_RESUME,
    inheritedTerminalDecision: "QUARANTINED",
    latestAttemptState: "QUARANTINE_INTENT_DURABLE",
    latestFinalizedRecoveryState: "QUARANTINE_INTENT_DURABLE",
  });

  let exactReboot = null;
  for (const specification of [
    { location: "staging", bundleCount: 0 },
    ...Array.from({ length: 18 }, (_, bundleCount) => ({
      location: "active",
      bundleCount,
    })),
  ]) {
    let context = buildGenesis(
      `remaining-reboot-${specification.location}-${specification.bundleCount}`,
      specification,
    );
    context.fixture.startRebootRecovery();
    context = refreshExternallyAnchoredReplay(context);
    context = addReadyAnchor(context);
    assert.equal(context.plan.disposition, "REBOOT_INTERRUPTION");
    assert.deepEqual(context.plan.states, PLAN_STATES.REBOOT_INTERRUPTION);
    if (specification.location === "staging") {
      exactReboot = context;
    } else {
      assertAdmittedPlanCreatesAndReplaysEveryPrefix(context);
    }
  }
  const exactRebootInput = planInput(
    exactReboot.fixture,
    exactReboot.target,
    exactReboot.inventory,
    exactReboot.replay,
    { phase: 2, anchorSelection: exactReboot.anchorSelection },
  );
  assertWholeReady(exactReboot, exactRebootInput, {
    actorKind: "RECOVERY_ONLY_GUARDIAN",
    disposition: "REBOOT_INTERRUPTION",
    sourceLocation: "staging",
    decisionSourceLocation: "staging",
    destinationLocation: "recovered",
    states: PLAN_STATES.REBOOT_INTERRUPTION,
  });
  assertAdmittedPlanCreatesAndReplaysEveryPrefix(exactReboot);

  let invalidRebootHead = buildGenesis("remaining-reboot-staging-head", {
    location: "staging",
    bundleCount: 1,
  });
  invalidRebootHead.fixture.startRebootRecovery();
  invalidRebootHead = refreshExternallyAnchoredReplay(invalidRebootHead);
  invalidRebootHead = addReadyAnchor(invalidRebootHead);
  assert.equal(invalidRebootHead.plan.disposition, "QUARANTINE");
  assert.equal(
    invalidRebootHead.plan.quarantineReason,
    "INCONSISTENT_GENERATION_STATE",
  );

  let rebootNeighbors = buildGenesis("remaining-reboot-neighbors", {
    location: "active",
    bundleCount: 5,
  });
  rebootNeighbors.fixture.startRebootRecovery();
  rebootNeighbors = refreshExternallyAnchoredReplay(rebootNeighbors);
  rebootNeighbors = addReadyAnchor(rebootNeighbors);
  for (const overrides of [
    { reportedCommandDescriptorHeld: true },
    { reportedStatusDescriptorHeld: true },
    { reportedSupervisorPidfdHeld: true },
    { reportedDirectChildWaitAuthority: true },
    {
      reportedControlCgroupPresent: true,
      reportedJobCgroupPresent: false,
    },
    {
      reportedControlCgroupPresent: false,
      reportedJobCgroupPresent: true,
    },
    {
      reportedControlCgroupPresent: true,
      reportedJobCgroupPresent: true,
    },
  ]) {
    const plan = recovery.planCandidateContainmentRecoveryV1(
      planInput(
        rebootNeighbors.fixture,
        rebootNeighbors.target,
        rebootNeighbors.inventory,
        rebootNeighbors.replay,
        {
          phase: 2,
          anchorSelection: rebootNeighbors.anchorSelection,
          overrides,
        },
      ),
    );
    assert.equal(plan.disposition, "QUARANTINE");
    assert.equal(plan.quarantineReason, "INCONSISTENT_GENERATION_STATE");
    assertBoundarySummary(plan);
  }

  assertAdmittedPlanCreatesAndReplaysEveryPrefix(recoveredResume);
  assertAdmittedPlanCreatesAndReplaysEveryPrefix(quarantineResume);
});

test("rejects branded lifetime heads whose result, record head, actor, or directory disagrees with replay", () => {
  let context = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("branded-head-semantic-splice"))),
    1,
  );
  context = publishFinalizedAttempt(context, "FINALIZED_ATTEMPT_PREFIX");
  const correctHead = context.fixture.headSelection();
  const correct = plain(correctHead);

  const makeVariant = ({
    result = correct.result,
    sequence = correct.latestRecoveryRecordSequence,
    rawSha256 = correct.latestRecoveryRecordRawSha256,
    secondActor = false,
  } = {}) => {
    const fixture = new RecoveryLifetimeFixture("branded-head-semantic-splice");
    const target = fixture.installRecoveryTarget(recovery);
    const firstAnchor = fixture.addAnchor("LIVE_BIRTH_GUARDIAN");
    const firstHead = recoveryExternalHead({
      targetSha256: target.targetSha256,
      result: "FINALIZED_ATTEMPT_PREFIX",
      recoveryActorEpochSha256: firstAnchor.recoveryActorEpochSha256,
      attemptDirectoryName: firstAnchor.attemptDirectoryName,
      lifetimeAttemptAnchorRawSha256: firstAnchor.record.rawSha256,
      latestRecoveryRecordSequence: correct.latestRecoveryRecordSequence,
      latestRecoveryRecordRawSha256: correct.latestRecoveryRecordRawSha256,
    });
    if (secondActor) {
      fixture.appendResult(firstHead);
      const anchor = fixture.addAnchor("LIVE_BIRTH_GUARDIAN");
      fixture.appendResult(
        recoveryExternalHead({
          targetSha256: target.targetSha256,
          result,
          recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
          attemptDirectoryName: anchor.attemptDirectoryName,
          lifetimeAttemptAnchorRawSha256: anchor.record.rawSha256,
          latestRecoveryRecordSequence: sequence,
          latestRecoveryRecordRawSha256: rawSha256,
        }),
      );
    } else {
      fixture.appendResult(
        recoveryExternalHead({
          targetSha256: target.targetSha256,
          result,
          recoveryActorEpochSha256: firstAnchor.recoveryActorEpochSha256,
          attemptDirectoryName: firstAnchor.attemptDirectoryName,
          lifetimeAttemptAnchorRawSha256: firstAnchor.record.rawSha256,
          latestRecoveryRecordSequence: sequence,
          latestRecoveryRecordRawSha256: rawSha256,
        }),
      );
    }
    return fixture.headSelection();
  };
  const variants = [
    ["result", makeVariant({ result: "RECOVERED" })],
    ["sequence", makeVariant({ sequence: "0000000000000002" })],
    ["raw", makeVariant({ rawSha256: digest("branded-head:wrong-raw") })],
    ["actor-directory", makeVariant({ secondActor: true })],
  ];
  assert.notEqual(plain(variants[0][1]).result, correct.result);
  assert.notEqual(
    plain(variants[1][1]).latestRecoveryRecordSequence,
    correct.latestRecoveryRecordSequence,
  );
  assert.notEqual(
    plain(variants[2][1]).latestRecoveryRecordRawSha256,
    correct.latestRecoveryRecordRawSha256,
  );
  assert.notEqual(
    plain(variants[3][1]).recoveryActorEpochSha256,
    correct.recoveryActorEpochSha256,
  );
  assert.notEqual(
    plain(variants[3][1]).attemptDirectoryName,
    correct.attemptDirectoryName,
  );
  for (const [label, expectedExternalHead] of variants) {
    assertNullPrototypeFrozen(expectedExternalHead);
    assertContractReject(
      () =>
        recovery.replayCandidateContainmentRecoveryV1(
          replayInput(context.fixture, context.target, {
            entries: context.history.map((item) =>
              brandedHistoryEntry(context.fixture, item),
            ),
            expectedExternalHead,
          }),
        ),
      label,
    );
  }
});

test("rejects cross-target, cross-attempt, descriptor, and predecessor splices after outer re-canonicalization", () => {
  const left = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("splice-left"))),
    2,
  );
  const right = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("splice-right"))),
    2,
  );
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(left.fixture, left.target, {
        entries: [
          {
            ...entryFrom(left),
            records: [artifact(right.records[0])],
          },
        ],
        expectedExternalHead: null,
        currentAnchorSelection: left.anchorSelection,
        currentAnchorPredecessorExternalHead: left.predecessorHead,
      }),
    ),
  );

  let firstAttempt = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("splice-same-target"))),
    1,
  );
  firstAttempt = publishFinalizedAttempt(
    firstAttempt,
    "FINALIZED_ATTEMPT_PREFIX",
  );
  const secondAttempt = createPlanRecords(
    createAttempt(addReadyAnchor(firstAttempt)),
    1,
  );
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(secondAttempt.fixture, secondAttempt.target, {
        entries: [
          brandedHistoryEntry(secondAttempt.fixture, firstAttempt.history[0]),
          {
            ...entryFrom(secondAttempt),
            records: [artifact(firstAttempt.records[0])],
          },
        ],
        expectedExternalHead: null,
        currentAnchorSelection: secondAttempt.anchorSelection,
        currentAnchorPredecessorExternalHead: secondAttempt.predecessorHead,
      }),
    ),
  );

  const leftValue = JSON.parse(left.records[0].bytes.toString("utf8"));
  const rightValue = JSON.parse(right.records[0].bytes.toString("utf8"));
  for (const descriptorName of ["operation", "evidence"]) {
    const spliced = structuredClone(leftValue);
    spliced[descriptorName] = rightValue[descriptorName];
    assertContractReject(() =>
      recovery.verifyCandidateContainmentRecoveryRecordV1(
        renamedRecoveryRecord(spliced),
      ),
    );
  }

  const secondValue = JSON.parse(left.records[1].bytes.toString("utf8"));
  const foreignPredecessorRawSha256 = right.records[0].rawSha256;
  secondValue.previousRecordRawSha256 = foreignPredecessorRawSha256;
  const reboundContext = {
    sequence: secondValue.sequence,
    recordType: secondValue.recordType,
    priorState: secondValue.priorState,
    previousRecordRawSha256: foreignPredecessorRawSha256,
    targetSha256: secondValue.targetSha256,
    attempt: secondValue.attempt,
  };
  for (const kind of ["operation", "evidence"]) {
    const payloadBytes = Buffer.from(secondValue[kind].bytesBase64, "base64");
    secondValue[kind] = recordDescriptor(kind, reboundContext, payloadBytes);
  }
  const rebound = renamedRecoveryRecord(secondValue);
  const standalone =
    recovery.verifyCandidateContainmentRecoveryRecordV1(rebound);
  assert.equal(standalone.previousRecordRawSha256, foreignPredecessorRawSha256);
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(left.fixture, left.target, {
        entries: [
          {
            ...entryFrom(left),
            records: [artifact(left.records[0]), rebound],
          },
        ],
        expectedExternalHead: null,
        currentAnchorSelection: left.anchorSelection,
        currentAnchorPredecessorExternalHead: left.predecessorHead,
      }),
    ),
  );
});

test("rejects fully rebound legal record-state substitutions that violate the selected plan edge", () => {
  const context = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("rebound-plan-edge"))),
    2,
  );
  const rebindState = (record, { recordType, priorState }) => {
    const value = JSON.parse(record.bytes.toString("utf8"));
    value.recordType = recordType;
    value.priorState = priorState;
    value.nextState = recordType;
    const bindingContext = {
      sequence: value.sequence,
      recordType,
      priorState,
      previousRecordRawSha256: value.previousRecordRawSha256,
      targetSha256: value.targetSha256,
      attempt: value.attempt,
    };
    for (const kind of ["operation", "evidence"]) {
      value[kind] = recordDescriptor(
        kind,
        bindingContext,
        Buffer.from(value[kind].bytesBase64, "base64"),
      );
    }
    return renamedRecoveryRecord(value);
  };

  const wrongFirst = rebindState(context.records[0], {
    recordType: "QUARANTINE_INTENT_DURABLE",
    priorState: null,
  });
  const verifiedWrongFirst =
    recovery.verifyCandidateContainmentRecoveryRecordV1(wrongFirst);
  assert.equal(verifiedWrongFirst.recordType, "QUARANTINE_INTENT_DURABLE");
  assert.equal(verifiedWrongFirst.embeddedArtifactBindingsValidated, true);
  assert.equal(verifiedWrongFirst.planValidated, false);
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: [{ ...entryFrom(context), records: [wrongFirst] }],
        expectedExternalHead: null,
        currentAnchorSelection: context.anchorSelection,
        currentAnchorPredecessorExternalHead: context.predecessorHead,
      }),
    ),
  );

  const wrongSecond = rebindState(context.records[1], {
    recordType: "REBOOT_INTERRUPTION_OBSERVED",
    priorState: "RECOVERY_ATTEMPT_DURABLE",
  });
  const verifiedWrongSecond =
    recovery.verifyCandidateContainmentRecoveryRecordV1(wrongSecond);
  assert.equal(verifiedWrongSecond.recordType, "REBOOT_INTERRUPTION_OBSERVED");
  assert.equal(verifiedWrongSecond.embeddedArtifactBindingsValidated, true);
  assert.equal(verifiedWrongSecond.planValidated, false);
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: [
          {
            ...entryFrom(context),
            records: [artifact(context.records[0]), wrongSecond],
          },
        ],
        expectedExternalHead: null,
        currentAnchorSelection: context.anchorSelection,
        currentAnchorPredecessorExternalHead: context.predecessorHead,
      }),
    ),
  );
});

test("rejects ordinary noncanonical outer and embedded JSONL plus one-record poisoned byte views", () => {
  const context = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("canonical-byte-adversarial"))),
    1,
  );
  const record = context.records[0];
  const value = JSON.parse(record.bytes.toString("utf8"));
  const noncanonicalOuterBytes = [
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    Buffer.from(
      `${JSON.stringify(Object.fromEntries(Object.entries(value).toReversed()))}\n`,
      "utf8",
    ),
    Buffer.from(` ${JSON.stringify(value)}\n`, "utf8"),
  ];
  for (const bytes of noncanonicalOuterBytes) {
    assertContractReject(() =>
      recovery.verifyCandidateContainmentRecoveryRecordV1({
        name: `${value.sequence}-${sha256(bytes)}.jsonl`,
        bytes,
      }),
    );
  }

  const recordContext = {
    sequence: value.sequence,
    recordType: value.recordType,
    priorState: value.priorState,
    previousRecordRawSha256: value.previousRecordRawSha256,
    targetSha256: value.targetSha256,
    attempt: value.attempt,
  };
  const noncanonicalPayloadBytes = Buffer.from(
    '{"schema":"oxigraph.test.candidate-containment-recovery-payload/v1", "detailSha256":"' +
      digest("noncanonical-inner") +
      '","label":"noncanonical-inner"}\n',
    "utf8",
  );
  for (const kind of ["operation", "evidence"]) {
    const mutated = structuredClone(value);
    mutated[kind] = recordDescriptor(
      kind,
      recordContext,
      noncanonicalPayloadBytes,
    );
    assertContractReject(() =>
      recovery.verifyCandidateContainmentRecoveryRecordV1(
        renamedRecoveryRecord(mutated),
      ),
    );
  }

  const invokeReplay = (bytes) =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: [
          {
            ...entryFrom(context),
            records: [{ name: record.name, bytes }],
          },
        ],
        expectedExternalHead: null,
        currentAnchorSelection: context.anchorSelection,
        currentAnchorPredecessorExternalHead: context.predecessorHead,
      }),
    );
  for (const [label, invoke] of [
    [
      "verify",
      (bytes) =>
        recovery.verifyCandidateContainmentRecoveryRecordV1({
          name: record.name,
          bytes,
        }),
    ],
    ["replay", invokeReplay],
  ]) {
    const lengthSentinel = new Error(`${label}: own length accessor ran`);
    let lengthAccessed = false;
    const inaccessibleLength = Buffer.from(record.bytes);
    Object.defineProperty(inaccessibleLength, "length", {
      configurable: true,
      get() {
        lengthAccessed = true;
        throw lengthSentinel;
      },
    });
    assert.throws(
      () => invoke(inaccessibleLength),
      (error) => error !== lengthSentinel,
    );
    assert.equal(lengthAccessed, false);

    const proxySentinel = new Error(`${label}: Buffer Proxy trap ran`);
    let proxyAccessed = false;
    const proxied = new Proxy(Buffer.from(record.bytes), {
      get() {
        proxyAccessed = true;
        throw proxySentinel;
      },
      getOwnPropertyDescriptor() {
        proxyAccessed = true;
        throw proxySentinel;
      },
      getPrototypeOf() {
        proxyAccessed = true;
        throw proxySentinel;
      },
      ownKeys() {
        proxyAccessed = true;
        throw proxySentinel;
      },
    });
    assert.throws(
      () => invoke(proxied),
      (error) => error !== proxySentinel,
    );
    assert.equal(proxyAccessed, false);
  }
});

test("makes the aggregate limit discriminator explicit at the product of independent count and record caps", () => {
  const maximumRecords =
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORDS_ACROSS_ATTEMPTS_V1;
  const maximumRecordBytes =
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_MAX_RECORD_BYTES_V1;
  const maximumAggregateBytes =
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_MAX_AGGREGATE_RECORD_BYTES_V1;
  assert.equal(maximumRecords, 96);
  assert.equal(maximumRecordBytes, 65_536);
  assert.equal(maximumAggregateBytes, maximumRecords * maximumRecordBytes);
  assert.equal(
    maximumAggregateBytes + 1 > maximumRecords * maximumRecordBytes,
    true,
  );
});

test("rejects hostile shapes, noncanonical bytes, and structural maxima without claiming intrinsic aggregate decode order", () => {
  const context = createPlanRecords(
    createAttempt(addReadyAnchor(buildGenesis("hostile"))),
    1,
  );
  const record = context.records[0];
  assertContractReject(() =>
    recovery.verifyCandidateContainmentRecoveryRecordV1({
      name: record.name,
      bytes: Buffer.concat([record.bytes, Buffer.from("\n")]),
    }),
  );
  assertContractReject(() =>
    recovery.verifyCandidateContainmentRecoveryRecordV1({
      name: record.name,
      bytes: Buffer.from(
        record.bytes.toString("utf8").replace("\n", "\r\n"),
        "utf8",
      ),
    }),
  );
  assertContractReject(() =>
    recovery.verifyCandidateContainmentRecoveryRecordV1({
      name: record.name.toUpperCase(),
      bytes: record.bytes,
    }),
  );
  const canonicalText = record.bytes.toString("utf8");
  const duplicateKeyBytes = Buffer.from(
    `{"schema":"duplicate-evaluator-key",${canonicalText.slice(1)}`,
    "utf8",
  );
  const invalidUtf8Bytes = Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d, 0x0a]);
  const bomBytes = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    record.bytes,
  ]);
  const extraKeyValue = JSON.parse(canonicalText);
  extraKeyValue.unexpectedEvaluatorKey = null;
  const extraKeyBytes = jsonLine(extraKeyValue);
  for (const bytes of [
    duplicateKeyBytes,
    invalidUtf8Bytes,
    bomBytes,
    extraKeyBytes,
  ]) {
    assertContractReject(() =>
      recovery.verifyCandidateContainmentRecoveryRecordV1({
        name: `0000000000000001-${sha256(bytes)}.jsonl`,
        bytes,
      }),
    );
  }
  const sparseEntries = new Array(2);
  sparseEntries[1] = entryFrom(context);
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: sparseEntries,
        expectedExternalHead: null,
        currentAnchorSelection: context.anchorSelection,
        currentAnchorPredecessorExternalHead: context.predecessorHead,
      }),
    ),
  );
  const attemptRecordAccessorSentinel = new Error(
    "record element accessor ran before the 25-record attempt rejection",
  );
  let attemptRecordAccessorRan = false;
  const twentyFiveAccessorRecords = Array.from({ length: 25 }, () =>
    artifact(record),
  );
  Object.defineProperty(twentyFiveAccessorRecords, 0, {
    enumerable: true,
    configurable: true,
    get() {
      attemptRecordAccessorRan = true;
      throw attemptRecordAccessorSentinel;
    },
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [
            { ...entryFrom(context), records: twentyFiveAccessorRecords },
          ],
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== attemptRecordAccessorSentinel,
  );
  assert.equal(attemptRecordAccessorRan, false);

  const attemptRecordProxySentinel = new Error(
    "record element proxy ran before the 25-record attempt rejection",
  );
  let attemptRecordProxyRan = false;
  const twentyFiveProxyRecords = Array.from({ length: 25 }, () =>
    artifact(record),
  );
  twentyFiveProxyRecords[0] = new Proxy(artifact(record), {
    get() {
      attemptRecordProxyRan = true;
      throw attemptRecordProxySentinel;
    },
    getOwnPropertyDescriptor() {
      attemptRecordProxyRan = true;
      throw attemptRecordProxySentinel;
    },
    getPrototypeOf() {
      attemptRecordProxyRan = true;
      throw attemptRecordProxySentinel;
    },
    ownKeys() {
      attemptRecordProxyRan = true;
      throw attemptRecordProxySentinel;
    },
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [{ ...entryFrom(context), records: twentyFiveProxyRecords }],
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== attemptRecordProxySentinel,
  );
  assert.equal(attemptRecordProxyRan, false);
  const fiveEntries = Array.from({ length: 5 }, () => entryFrom(context));
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: fiveEntries,
        expectedExternalHead: null,
        currentAnchorSelection: context.anchorSelection,
        currentAnchorPredecessorExternalHead: context.predecessorHead,
      }),
    ),
  );
  const twentyFiveRecords = Array.from({ length: 25 }, () => artifact(record));
  assertContractReject(() =>
    recovery.replayCandidateContainmentRecoveryV1(
      replayInput(context.fixture, context.target, {
        entries: [{ ...entryFrom(context), records: twentyFiveRecords }],
        expectedExternalHead: null,
        currentAnchorSelection: context.anchorSelection,
        currentAnchorPredecessorExternalHead: context.predecessorHead,
      }),
    ),
  );

  const entrySentinel = new Error(
    "entry element was accessed before count rejection",
  );
  let entryElementHits = 0;
  const fiveExplosiveEntries = Array.from({ length: 5 }, () =>
    entryFrom(context),
  );
  Object.defineProperty(fiveExplosiveEntries, 0, {
    enumerable: true,
    configurable: true,
    get() {
      entryElementHits += 1;
      throw entrySentinel;
    },
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: fiveExplosiveEntries,
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== entrySentinel,
  );
  assert.equal(entryElementHits, 0);
  const proxyEntrySentinel = new Error(
    "proxy entry trap ran before count rejection",
  );
  let proxyEntryTrapHits = 0;
  Object.defineProperty(fiveExplosiveEntries, 0, {
    enumerable: true,
    configurable: true,
    value: new Proxy(entryFrom(context), {
      get() {
        proxyEntryTrapHits += 1;
        throw proxyEntrySentinel;
      },
      getOwnPropertyDescriptor() {
        proxyEntryTrapHits += 1;
        throw proxyEntrySentinel;
      },
      ownKeys() {
        proxyEntryTrapHits += 1;
        throw proxyEntrySentinel;
      },
      getPrototypeOf() {
        proxyEntryTrapHits += 1;
        throw proxyEntrySentinel;
      },
    }),
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: fiveExplosiveEntries,
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== proxyEntrySentinel,
  );
  assert.equal(proxyEntryTrapHits, 0);

  const bundleSentinel = new Error(
    "bundle element was accessed before count rejection",
  );
  let bundleElementHits = 0;
  const nineteenBundles = Array.from({ length: 19 }, () =>
    artifact(context.fixture.journal.generationManifest),
  );
  Object.defineProperty(nineteenBundles, 0, {
    enumerable: true,
    configurable: true,
    get() {
      bundleElementHits += 1;
      throw bundleSentinel;
    },
  });
  assert.throws(
    () =>
      recovery.deriveCandidateContainmentRecoveryTargetProjectionV1({
        generationManifest: artifact(
          context.fixture.journal.generationManifest,
        ),
        normalJournalBundles: nineteenBundles,
      }),
    (error) => error !== bundleSentinel,
  );
  assert.equal(bundleElementHits, 0);
  const proxyBundleSentinel = new Error(
    "bundle proxy trap ran before bundle-count rejection",
  );
  let proxyBundleTrapHits = 0;
  Object.defineProperty(nineteenBundles, 0, {
    enumerable: true,
    configurable: true,
    value: new Proxy(artifact(context.fixture.journal.generationManifest), {
      get() {
        proxyBundleTrapHits += 1;
        throw proxyBundleSentinel;
      },
      getOwnPropertyDescriptor() {
        proxyBundleTrapHits += 1;
        throw proxyBundleSentinel;
      },
      ownKeys() {
        proxyBundleTrapHits += 1;
        throw proxyBundleSentinel;
      },
      getPrototypeOf() {
        proxyBundleTrapHits += 1;
        throw proxyBundleSentinel;
      },
    }),
  });
  assert.throws(
    () =>
      recovery.deriveCandidateContainmentRecoveryTargetProjectionV1({
        generationManifest: artifact(
          context.fixture.journal.generationManifest,
        ),
        normalJournalBundles: nineteenBundles,
      }),
    (error) => error !== proxyBundleSentinel,
  );
  assert.equal(proxyBundleTrapHits, 0);

  const recordCountSentinel = new Error(
    "record reference was parsed before the 97-record count rejection",
  );
  let recordCountElementHits = 0;
  const recordArrays = [24, 24, 24, 25].map((count) =>
    Array.from({ length: count }, () => artifact(record)),
  );
  Object.defineProperty(recordArrays[0], 0, {
    enumerable: true,
    configurable: true,
    get() {
      recordCountElementHits += 1;
      throw recordCountSentinel;
    },
  });
  const ninetySevenRecords = recordArrays.map((records) => ({
    ...entryFrom(context),
    records,
  }));
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: ninetySevenRecords,
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== recordCountSentinel,
  );
  assert.equal(recordCountElementHits, 0);
  const proxyRecordSentinel = new Error(
    "proxy record trap ran before aggregate count rejection",
  );
  let proxyRecordTrapHits = 0;
  Object.defineProperty(recordArrays[0], 0, {
    enumerable: true,
    configurable: true,
    value: new Proxy(artifact(record), {
      get() {
        proxyRecordTrapHits += 1;
        throw proxyRecordSentinel;
      },
      getOwnPropertyDescriptor() {
        proxyRecordTrapHits += 1;
        throw proxyRecordSentinel;
      },
      ownKeys() {
        proxyRecordTrapHits += 1;
        throw proxyRecordSentinel;
      },
      getPrototypeOf() {
        proxyRecordTrapHits += 1;
        throw proxyRecordSentinel;
      },
    }),
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: ninetySevenRecords,
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== proxyRecordSentinel,
  );
  assert.equal(proxyRecordTrapHits, 0);

  // The ratified aggregate cap is exactly 96 * 65,536, so aggregate +1 is
  // necessarily also a per-record violation. Without a ratified injectable
  // decoder/hash seam, overriding toString proves only that this direct method
  // was not used; it does not claim rejection preceded intrinsic decode/hash.
  const aggregateAndRecordLimitReferences = Array.from(
    { length: 96 },
    (_, index) => {
      const bytes = Buffer.alloc(index === 0 ? 65537 : 65536, 0x20);
      return {
        name: `${String((index % 24) + 1).padStart(16, "0")}-${sha256(bytes)}.jsonl`,
        bytes,
      };
    },
  );
  assert.equal(
    aggregateAndRecordLimitReferences.reduce(
      (total, reference) => total + reference.bytes.length,
      0,
    ),
    6_291_457,
  );
  const combinedLimitDirectMethodSentinel = new Error(
    "combined aggregate/per-record path called an overridable toString",
  );
  let combinedLimitDirectMethodRan = false;
  Object.defineProperty(
    aggregateAndRecordLimitReferences[0].bytes,
    "toString",
    {
      configurable: true,
      value() {
        combinedLimitDirectMethodRan = true;
        throw combinedLimitDirectMethodSentinel;
      },
    },
  );
  const aggregateEntries = [0, 1, 2, 3].map((entryIndex) => ({
    ...entryFrom(context),
    records: aggregateAndRecordLimitReferences.slice(
      entryIndex * 24,
      (entryIndex + 1) * 24,
    ),
  }));
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: aggregateEntries,
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== combinedLimitDirectMethodSentinel,
  );
  assert.equal(combinedLimitDirectMethodRan, false);

  const bufferLengthSentinel = new Error(
    "record Buffer length was read before record-count rejection",
  );
  let bufferLengthAccessorHits = 0;
  const inaccessibleLengthBuffer = Buffer.from(record.bytes);
  Object.defineProperty(inaccessibleLengthBuffer, "length", {
    get() {
      bufferLengthAccessorHits += 1;
      throw bufferLengthSentinel;
    },
  });
  const lengthSentinelEntries = recordArrays.map((records, entryIndex) => ({
    ...entryFrom(context),
    records:
      entryIndex === 0
        ? records.with(0, {
            name: record.name,
            bytes: inaccessibleLengthBuffer,
          })
        : records,
  }));
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: lengthSentinelEntries,
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== bufferLengthSentinel,
  );
  assert.equal(bufferLengthAccessorHits, 0);

  const oversizedRecordBytes = Buffer.alloc(65537, 0x20);
  const parseSentinel = new Error(
    "oversized raw record was converted before length rejection",
  );
  let oversizedDirectMethodHits = 0;
  Object.defineProperty(oversizedRecordBytes, "toString", {
    configurable: true,
    value() {
      oversizedDirectMethodHits += 1;
      throw parseSentinel;
    },
  });
  assert.throws(
    () =>
      recovery.verifyCandidateContainmentRecoveryRecordV1({
        name: `0000000000000001-${sha256(oversizedRecordBytes)}.jsonl`,
        bytes: oversizedRecordBytes,
      }),
    (error) => error !== parseSentinel,
  );
  assert.equal(oversizedDirectMethodHits, 0);

  const recordValue = JSON.parse(record.bytes.toString("utf8"));
  for (const bytesBase64 of [
    `${recordValue.operation.bytesBase64} `,
    `${recordValue.operation.bytesBase64}=`,
    recordValue.operation.bytesBase64.endsWith("=")
      ? recordValue.operation.bytesBase64.replace(/=+$/u, "")
      : recordValue.operation.bytesBase64.slice(0, -1),
  ]) {
    const mutated = structuredClone(recordValue);
    mutated.operation.bytesBase64 = bytesBase64;
    assertContractReject(() =>
      recovery.verifyCandidateContainmentRecoveryRecordV1(
        renamedRecoveryRecord(mutated),
      ),
    );
  }

  const maximumOperationBytes = canonicalPayloadWithExactBytes(16384);
  const maximumOperationRecord =
    recovery.createCandidateContainmentRecoveryRecordV1({
      target: context.target,
      lifecycleInventoryObservation: context.inventory,
      previousRecoveryReplay: context.replay,
      plan: context.plan,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: context.attempt,
      previousRecord: null,
      operationBytes: maximumOperationBytes,
      evidenceBytes: jsonLine(plain(context.inventory)),
    });
  assert.equal(
    Buffer.from(maximumOperationRecord.operation.bytesBase64, "base64").length,
    16384,
  );
  const maximumEvidenceBytes = canonicalPayloadWithExactBytes(16384);
  const maximumEvidenceRecord =
    recovery.createCandidateContainmentRecoveryRecordV1({
      target: context.target,
      lifecycleInventoryObservation: context.inventory,
      previousRecoveryReplay: context.replay,
      plan: context.plan,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: context.attempt,
      previousRecord: record,
      operationBytes: jsonLine(opaque("hostile:second-operation")),
      evidenceBytes: maximumEvidenceBytes,
    });
  assert.equal(
    Buffer.from(maximumEvidenceRecord.evidence.bytesBase64, "base64").length,
    16384,
  );

  const oversizedPayload = canonicalPayloadWithExactBytes(16385);
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryRecordV1({
      target: context.target,
      lifecycleInventoryObservation: context.inventory,
      previousRecoveryReplay: context.replay,
      plan: context.plan,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: context.attempt,
      previousRecord: null,
      operationBytes: oversizedPayload,
      evidenceBytes: jsonLine(plain(context.inventory)),
    }),
  );
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryRecordV1({
      target: context.target,
      lifecycleInventoryObservation: context.inventory,
      previousRecoveryReplay: context.replay,
      plan: context.plan,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: context.attempt,
      previousRecord: record,
      operationBytes: jsonLine(opaque("hostile:oversized-evidence-operation")),
      evidenceBytes: oversizedPayload,
    }),
  );

  const controlOversize = structuredClone(recordValue);
  controlOversize.attempt.recoveryActorEpochSha256 = "a".repeat(16385);
  assertContractReject(() =>
    recovery.verifyCandidateContainmentRecoveryRecordV1(
      renamedRecoveryRecord(controlOversize),
    ),
  );

  const proxyReferenceSentinel = new Error("record-reference proxy trap ran");
  let proxyReferenceTrapHits = 0;
  const proxiedReference = new Proxy(artifact(record), {
    get() {
      proxyReferenceTrapHits += 1;
      throw proxyReferenceSentinel;
    },
    getOwnPropertyDescriptor() {
      proxyReferenceTrapHits += 1;
      throw proxyReferenceSentinel;
    },
    ownKeys() {
      proxyReferenceTrapHits += 1;
      throw proxyReferenceSentinel;
    },
    getPrototypeOf() {
      proxyReferenceTrapHits += 1;
      throw proxyReferenceSentinel;
    },
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [{ ...entryFrom(context), records: [proxiedReference] }],
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== proxyReferenceSentinel,
  );
  assert.equal(proxyReferenceTrapHits, 0);
  const proxyEntryShapeSentinel = new Error("replay-entry proxy trap ran");
  let proxyEntryShapeTrapHits = 0;
  const proxiedEntry = new Proxy(entryFrom(context), {
    get() {
      proxyEntryShapeTrapHits += 1;
      throw proxyEntryShapeSentinel;
    },
    getOwnPropertyDescriptor() {
      proxyEntryShapeTrapHits += 1;
      throw proxyEntryShapeSentinel;
    },
    ownKeys() {
      proxyEntryShapeTrapHits += 1;
      throw proxyEntryShapeSentinel;
    },
    getPrototypeOf() {
      proxyEntryShapeTrapHits += 1;
      throw proxyEntryShapeSentinel;
    },
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [proxiedEntry],
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== proxyEntryShapeSentinel,
  );
  assert.equal(proxyEntryShapeTrapHits, 0);
  const entryAccessorSentinel = new Error("replay entry accessor executed");
  let entryAccessorHits = 0;
  const accessorEntry = { ...entryFrom(context) };
  Object.defineProperty(accessorEntry, "kind", {
    enumerable: true,
    configurable: true,
    get() {
      entryAccessorHits += 1;
      throw entryAccessorSentinel;
    },
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [accessorEntry],
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== entryAccessorSentinel,
  );
  assert.equal(entryAccessorHits, 0);
  const referenceSentinel = new Error("record reference accessor executed");
  let referenceAccessorHits = 0;
  const accessorReference = Object.create(null);
  Object.defineProperties(accessorReference, {
    name: {
      enumerable: true,
      get() {
        referenceAccessorHits += 1;
        throw referenceSentinel;
      },
    },
    bytes: { enumerable: true, value: record.bytes },
  });
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [{ ...entryFrom(context), records: [accessorReference] }],
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== referenceSentinel,
  );
  assert.equal(referenceAccessorHits, 0);

  const sharedOperation = Buffer.from(new SharedArrayBuffer(128));
  sharedOperation.fill(0x20);
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryRecordV1({
      target: context.target,
      lifecycleInventoryObservation: context.inventory,
      previousRecoveryReplay: context.replay,
      plan: context.plan,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: context.attempt,
      previousRecord: null,
      operationBytes: sharedOperation,
      evidenceBytes: jsonLine(plain(context.inventory)),
    }),
  );
  const poisonSentinel = new Error("poisoned buffer property was evaluated");
  const poisonedOperation = jsonLine(opaque("hostile:poisoned-buffer"));
  Object.defineProperty(poisonedOperation, "poison", {
    enumerable: true,
    configurable: true,
    get() {
      throw poisonSentinel;
    },
  });
  let poisonedOutcome = null;
  try {
    poisonedOutcome = recovery.createCandidateContainmentRecoveryRecordV1({
      target: context.target,
      lifecycleInventoryObservation: context.inventory,
      previousRecoveryReplay: context.replay,
      plan: context.plan,
      lifetimeAnchorProjection:
        context.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        context.anchorSelection.lifetimeAttemptAnchorRawSha256,
      attempt: context.attempt,
      previousRecord: null,
      operationBytes: poisonedOperation,
      evidenceBytes: jsonLine(plain(context.inventory)),
    });
  } catch (error) {
    assert.notEqual(error, poisonSentinel);
  }
  if (poisonedOutcome !== null) {
    assert.deepEqual(
      Buffer.from(poisonedOutcome.operation.bytesBase64, "base64"),
      Buffer.from(poisonedOperation),
    );
  }
});

test("rejects nested entries, records, and journal-bundle collection Proxies without invoking traps", () => {
  const context = createPlanRecords(
    createAttempt(
      addReadyAnchor(
        buildGenesis("nested-collection-proxies", { bundleCount: 1 }),
      ),
    ),
    1,
  );
  const proxiedCollection = (label, values) => {
    const sentinel = new Error(`${label} collection Proxy trap ran`);
    const state = { trapped: false };
    const proxy = new Proxy(values, {
      get() {
        state.trapped = true;
        throw sentinel;
      },
      getOwnPropertyDescriptor() {
        state.trapped = true;
        throw sentinel;
      },
      getPrototypeOf() {
        state.trapped = true;
        throw sentinel;
      },
      ownKeys() {
        state.trapped = true;
        throw sentinel;
      },
    });
    return { proxy, sentinel, state };
  };

  const bundleCollection = proxiedCollection(
    "normalJournalBundles",
    context.fixture.journal.normalJournalBundles.map(artifact),
  );
  assert.throws(
    () =>
      recovery.deriveCandidateContainmentRecoveryTargetProjectionV1({
        generationManifest: artifact(
          context.fixture.journal.generationManifest,
        ),
        normalJournalBundles: bundleCollection.proxy,
      }),
    (error) => error !== bundleCollection.sentinel,
  );
  assert.equal(bundleCollection.state.trapped, false);

  const entryCollection = proxiedCollection("entries", [entryFrom(context)]);
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: entryCollection.proxy,
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== entryCollection.sentinel,
  );
  assert.equal(entryCollection.state.trapped, false);

  const recordCollection = proxiedCollection("records", [
    artifact(context.records[0]),
  ]);
  assert.throws(
    () =>
      recovery.replayCandidateContainmentRecoveryV1(
        replayInput(context.fixture, context.target, {
          entries: [{ ...entryFrom(context), records: recordCollection.proxy }],
          expectedExternalHead: null,
          currentAnchorSelection: context.anchorSelection,
          currentAnchorPredecessorExternalHead: context.predecessorHead,
        }),
      ),
    (error) => error !== recordCollection.sentinel,
  );
  assert.equal(recordCollection.state.trapped, false);
});

test("rejects mutation, aliases, and accessor or proxy inputs while preserving outputs", () => {
  const context = buildGenesis("defensive-copy");
  const input = inventoryInput(
    context.fixture.journal.generationIdentity.identitySha256,
    "active",
  );
  const observation =
    recovery.createCandidateContainmentRecoveryInventoryObservationV1(input);
  input.activePresent = false;
  input.stagingPresent = true;
  assert.equal(observation.activePresent, true);
  assert.equal(observation.stagingPresent, false);
  const inventoryAccessorSentinel = new Error(
    "inventory accessor was invoked during shape rejection",
  );
  let inventoryAccessorHits = 0;
  const accessor = {};
  Object.defineProperty(accessor, "generationIdentitySha256", {
    enumerable: true,
    get() {
      inventoryAccessorHits += 1;
      throw inventoryAccessorSentinel;
    },
  });
  assert.throws(
    () =>
      recovery.createCandidateContainmentRecoveryInventoryObservationV1(
        accessor,
      ),
    (error) => error !== inventoryAccessorSentinel,
  );
  assert.equal(inventoryAccessorHits, 0);
  const inventoryProxySentinel = new Error(
    "inventory proxy trap was invoked during shape rejection",
  );
  let inventoryProxyTrapHits = 0;
  const proxiedInventory = new Proxy(
    inventoryInput(context.fixture.journal.generationIdentity.identitySha256),
    {
      get() {
        inventoryProxyTrapHits += 1;
        throw inventoryProxySentinel;
      },
      getOwnPropertyDescriptor() {
        inventoryProxyTrapHits += 1;
        throw inventoryProxySentinel;
      },
      ownKeys() {
        inventoryProxyTrapHits += 1;
        throw inventoryProxySentinel;
      },
      getPrototypeOf() {
        inventoryProxyTrapHits += 1;
        throw inventoryProxySentinel;
      },
    },
  );
  assert.throws(
    () =>
      recovery.createCandidateContainmentRecoveryInventoryObservationV1(
        proxiedInventory,
      ),
    (error) => error !== inventoryProxySentinel,
  );
  assert.equal(inventoryProxyTrapHits, 0);
  assertContractReject(() =>
    recovery.createCandidateContainmentRecoveryInventoryObservationV1(
      Object.assign(
        Object.create({ inherited: true }),
        inventoryInput(
          context.fixture.journal.generationIdentity.identitySha256,
        ),
      ),
    ),
  );

  const recordContext = createAttempt(
    addReadyAnchor(buildGenesis("defensive-buffer")),
  );
  const operationBytes = jsonLine(opaque("defensive-buffer:operation"));
  const evidenceBytes = jsonLine(plain(recordContext.inventory));
  const operationSnapshot = Buffer.from(operationBytes);
  const evidenceSnapshot = Buffer.from(evidenceBytes);
  const copiedRecord = recovery.createCandidateContainmentRecoveryRecordV1({
    target: recordContext.target,
    lifecycleInventoryObservation: recordContext.inventory,
    previousRecoveryReplay: recordContext.replay,
    plan: recordContext.plan,
    lifetimeAnchorProjection:
      recordContext.anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      recordContext.anchorSelection.lifetimeAttemptAnchorRawSha256,
    attempt: recordContext.attempt,
    previousRecord: null,
    operationBytes,
    evidenceBytes,
  });
  operationBytes.fill(0);
  evidenceBytes.fill(0);
  assert.deepEqual(
    Buffer.from(copiedRecord.operation.bytesBase64, "base64"),
    operationSnapshot,
  );
  assert.deepEqual(
    Buffer.from(copiedRecord.evidence.bytesBase64, "base64"),
    evidenceSnapshot,
  );
  const firstRead = copiedRecord.bytes;
  const secondRead = copiedRecord.bytes;
  firstRead.fill(0);
  assert.notEqual(firstRead, secondRead);
  assert.deepEqual(copiedRecord.bytes, secondRead);
});

test("rejects top-level Proxy and accessor arguments across all thirteen public APIs without invoking hostile code", () => {
  const base = buildGenesis("all-api-hostile");
  const ready = addReadyAnchor(base);
  const attempted = createAttempt(ready);
  const recorded = createPlanRecords(attempted, 1);
  const empty = addReadyAnchor(buildGenesis("all-api-hostile-empty"));
  const anchoredEmpty =
    recovery.createCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
      target: empty.target,
      previousRecoveryReplay: empty.replay,
      lifetimeAnchorProjection: empty.anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        empty.anchorSelection.lifetimeAttemptAnchorRawSha256,
      reportedAttemptDirectoryState: "ABSENT",
    });
  const targetArguments = {
    generationManifest: artifact(base.fixture.journal.generationManifest),
    normalJournalBundles:
      base.fixture.journal.normalJournalBundles.map(artifact),
  };
  const attemptArguments = {
    target: ready.target,
    lifecycleInventoryObservation: ready.inventory,
    previousRecoveryReplay: ready.replay,
    plan: ready.plan,
    lifetimeAnchorProjection: ready.anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      ready.anchorSelection.lifetimeAttemptAnchorRawSha256,
  };
  const anchoredArguments = {
    target: empty.target,
    previousRecoveryReplay: empty.replay,
    lifetimeAnchorProjection: empty.anchorSelection.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      empty.anchorSelection.lifetimeAttemptAnchorRawSha256,
  };
  const recordArguments = {
    ...attemptArguments,
    attempt: attempted.attempt,
    previousRecord: null,
    operationBytes: jsonLine(opaque("all-api-hostile:operation")),
    evidenceBytes: jsonLine(plain(ready.inventory)),
  };
  const calls = [
    [
      "derive-target",
      targetArguments,
      (input) =>
        recovery.deriveCandidateContainmentRecoveryTargetProjectionV1(input),
    ],
    [
      "create-target",
      {
        ...targetArguments,
        lifetimeTargetSelection: base.fixture.targetSelection(),
      },
      (input) => recovery.createCandidateContainmentRecoveryTargetV1(input),
    ],
    [
      "verify-target",
      {
        target: base.target,
        ...targetArguments,
        lifetimeTargetSelection: base.fixture.targetSelection(),
      },
      (input) => recovery.verifyCandidateContainmentRecoveryTargetV1(input),
    ],
    [
      "create-inventory",
      inventoryInput(base.fixture.journal.generationIdentity.identitySha256),
      (input) =>
        recovery.createCandidateContainmentRecoveryInventoryObservationV1(
          input,
        ),
    ],
    [
      "verify-inventory",
      {
        observation: base.inventory,
        expectedGenerationIdentitySha256:
          base.fixture.journal.generationIdentity.identitySha256,
      },
      (input) =>
        recovery.verifyCandidateContainmentRecoveryInventoryObservationV1(
          input,
        ),
    ],
    [
      "plan",
      planInput(ready.fixture, ready.target, ready.inventory, ready.replay, {
        phase: 2,
        anchorSelection: ready.anchorSelection,
      }),
      (input) => recovery.planCandidateContainmentRecoveryV1(input),
    ],
    [
      "create-attempt",
      attemptArguments,
      (input) => recovery.createCandidateContainmentRecoveryAttemptV1(input),
    ],
    [
      "verify-attempt",
      { attempt: attempted.attempt, ...attemptArguments },
      (input) => recovery.verifyCandidateContainmentRecoveryAttemptV1(input),
    ],
    [
      "create-anchored-empty",
      { ...anchoredArguments, reportedAttemptDirectoryState: "ABSENT" },
      (input) =>
        recovery.createCandidateContainmentRecoveryAnchoredEmptyAttemptV1(
          input,
        ),
    ],
    [
      "verify-anchored-empty",
      { anchoredEmptyAttempt: anchoredEmpty, ...anchoredArguments },
      (input) =>
        recovery.verifyCandidateContainmentRecoveryAnchoredEmptyAttemptV1(
          input,
        ),
    ],
    [
      "create-record",
      recordArguments,
      (input) => recovery.createCandidateContainmentRecoveryRecordV1(input),
    ],
    [
      "verify-record",
      artifact(recorded.records[0]),
      (input) => recovery.verifyCandidateContainmentRecoveryRecordV1(input),
    ],
    [
      "replay",
      replayInput(recorded.fixture, recorded.target, {
        entries: [entryFrom(recorded)],
        expectedExternalHead: null,
        currentAnchorSelection: recorded.anchorSelection,
        currentAnchorPredecessorExternalHead: recorded.predecessorHead,
      }),
      (input) => recovery.replayCandidateContainmentRecoveryV1(input),
    ],
  ];

  for (const [label, input, invoke] of calls) {
    const sentinel = new Error(`${label} Proxy trap executed`);
    let proxyTrapHits = 0;
    const proxied = new Proxy(input, {
      defineProperty() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      deleteProperty() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      get() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      getOwnPropertyDescriptor() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      ownKeys() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      getPrototypeOf() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      has() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      isExtensible() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      preventExtensions() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      set() {
        proxyTrapHits += 1;
        throw sentinel;
      },
      setPrototypeOf() {
        proxyTrapHits += 1;
        throw sentinel;
      },
    });
    assert.throws(
      () => invoke(proxied),
      (error) => error !== sentinel,
    );
    assert.equal(proxyTrapHits, 0, label);

    const accessorSentinel = new Error(`${label} accessor executed`);
    let accessorHits = 0;
    const accessor = { ...input };
    const firstKey = Object.keys(accessor)[0];
    Object.defineProperty(accessor, firstKey, {
      enumerable: true,
      configurable: true,
      get() {
        accessorHits += 1;
        throw accessorSentinel;
      },
    });
    assert.throws(
      () => invoke(accessor),
      (error) => error !== accessorSentinel,
    );
    assert.equal(accessorHits, 0, label);
  }
});

test("lexically distinguishes every static import form from inert comment and literal bait", () => {
  const source = [
    '// import { commentBait } from "node:fs";',
    '/* import "node:net"; */',
    "const text = \"import fake from 'node:http'\";",
    "const pattern = /import\\s+alsoFake/u;",
    'const template = `literal import fake from "node:tls" ${import("node:child_process")}`;',
    'import "./side-effect.mjs";',
    'import defaultBinding from "./default.mjs";',
    'import * as namespaceBinding from "./namespace.mjs";',
    'import defaultAndNamed, { alpha, beta as localBeta } from "./mixed.mjs";',
    'export { alpha as exportedAlpha } from "./re-export.mjs";',
    'export * from "\\x2e/re-export-star.mjs";',
    'export * as namespaceExport from "\\u002e/re-export-namespace.mjs";',
    'export { "default" as stringNamed } from "./re-export-string.mjs";',
  ].join("\n");
  const parsed = parseStaticImports(source);
  assert.deepEqual(parsed.declarations, [
    {
      specifier: "./side-effect.mjs",
      sideEffect: true,
      defaultBinding: null,
      namespaceBinding: null,
      namedBindings: [],
    },
    {
      specifier: "./default.mjs",
      sideEffect: false,
      defaultBinding: "defaultBinding",
      namespaceBinding: null,
      namedBindings: [],
    },
    {
      specifier: "./namespace.mjs",
      sideEffect: false,
      defaultBinding: null,
      namespaceBinding: "namespaceBinding",
      namedBindings: [],
    },
    {
      specifier: "./mixed.mjs",
      sideEffect: false,
      defaultBinding: "defaultAndNamed",
      namespaceBinding: null,
      namedBindings: [
        { imported: "alpha", local: "alpha" },
        { imported: "beta", local: "localBeta" },
      ],
    },
  ]);
  assert.deepEqual(parsed.reexports, [
    { specifier: "./re-export.mjs", star: false },
    { specifier: "./re-export-star.mjs", star: true },
    { specifier: "./re-export-namespace.mjs", star: true },
    { specifier: "./re-export-string.mjs", star: false },
  ]);
  assert.equal(parsed.dynamicImports.length, 1);
  assert.equal(
    parsed.tokens.some(
      (token) => token.type === "identifier" && token.value === "commentBait",
    ),
    false,
  );
});

test("classifies contextual identifiers, for-of separators, and regex literals before computed-member gating", () => {
  const accepts = (source) =>
    assertRecoverySourceWithinBoundedLexicalSubset(
      parseStaticImports(`${RECOVERY_VALID_IMPORT_PREAMBLE}\n${source}`),
    );
  for (const identifier of ["as", "from", "of"]) {
    assert.doesNotThrow(() =>
      accepts(
        `const ${identifier} = [{ value: 1 }]; const selected = ${identifier}[0].value;`,
      ),
    );
    assert.throws(() =>
      accepts(
        `const ${identifier} = { value: 1 }; const key = "value"; const selected = ${identifier}[key];`,
      ),
    );
  }
  for (const source of [
    "const values = [1, 2]; const [first] = values;",
    "for (const item of [1, 2]) { void item; }",
    "const of = [1, 2]; for (const item of of) { void item; }",
    "for (const of of [1, 2]) { void of; }",
    "let item; const values = [1, 2]; for (item of values) { void item; }",
    "let of; const values = [1, 2]; for (of of values) { void of; }",
    "const values = [[1]]; for (const [item] of values) { void item; }",
    "const values = [{ item: 1 }]; for (const { item } of values) { void item; }",
    "const values = [1]; const targets = [null]; for (targets[0] of values) { void targets; }",
    "const values = [1]; const target = { item: null }; for (target.item of values) { void target; }",
    "const of = { item: 1 }; for (const item in of) { void item; }",
    "for (const of in { item: 1 }) { void of; }",
    "for await (const item of [Promise.resolve(1)]) { void item; }",
    "for await (const of of [Promise.resolve(1)]) { void of; }",
    "const flags = [true]; if (flags[0]) { void 0; }",
    "const flags = [false]; while (flags[0]) { break; }",
    "const values = [1]; for (let index = 0; index < values[0]; index += 1) { break; }",
    "const match = /x/u[0];",
    "const target = [[1]]; const first = [target[0]][0];",
    "const target = [[1]]; const first = [[target[0]]][0][0];",
  ]) {
    assert.doesNotThrow(() => accepts(source), source);
  }
  assert.throws(() =>
    accepts('const key = "source"; const selected = /x/u[key];'),
  );
  assert.throws(() =>
    accepts("const key = 0; for (const item of of[key]) { void item; }"),
  );
  for (const source of [
    "const key = 0; for (const item in of[key]) { void item; }",
    "const key = 0; for (value instanceof of[key];; ) { void value; }",
    "const key = 0; for (typeof of[key];; ) { void 0; }",
    "const key = 0; for (void of[key];; ) { void 0; }",
    "const key = 0; for (delete of[key];; ) { void 0; }",
    "const key = 0; for (await of[key];; ) { void 0; }",
    "const key = 0; for (yield of[key];; ) { void 0; }",
    "const key = 0; const target = [1]; const selected = [target[key]];",
    "const key = 0; const target = [1]; const selected = [[target[key]]][0];",
    "const key = 0; const target = [1]; for (const item of [target[key]]) { void item; }",
    "const key = 0; const target = [1]; for await (const item of [target[key]]) { void item; }",
  ]) {
    assert.throws(() => accepts(source), undefined, source);
  }

  const postfixIncrement = lexModuleSource(
    'let counter = 0; counter++ / process.getBuiltinModule("node:fs") / 1;',
  );
  const postfixDecrement = lexModuleSource(
    'let counter = 1; counter-- / process.getBuiltinModule("node:fs") / 1;',
  );
  assert.equal(
    postfixIncrement.some(
      (token) => token.type === "punctuator" && token.value === "++",
    ),
    true,
  );
  assert.equal(
    postfixDecrement.some(
      (token) => token.type === "punctuator" && token.value === "--",
    ),
    true,
  );
  for (const tokens of [postfixIncrement, postfixDecrement]) {
    assert.equal(
      tokens.some(
        (token) => token.type === "identifier" && token.value === "process",
      ),
      true,
    );
  }
  assert.throws(() =>
    accepts(
      'let counter = 0; counter++ / process.getBuiltinModule("node:fs") / 1;',
    ),
  );
  assert.throws(() =>
    accepts(
      'let counter = 1; counter-- / process.getBuiltinModule("node:fs") / 1;',
    ),
  );
  assert.throws(() => accepts("let counter = 0; counter++;"));
  assert.throws(() => accepts("let counter = 1; counter--;"));
});

test("binds every raw bytes access to the actual unshadowed exact helper imports", () => {
  const inspect = (source) =>
    assertRecoverySourceWithinBoundedLexicalSubset(parseStaticImports(source));
  const exactImports = RECOVERY_VALID_IMPORT_PREAMBLE;
  const source = (body) => `${exactImports}\n${body}`;
  assert.doesNotThrow(() =>
    inspect(
      source(`function verify(carrier, limits, fail) {
        const reference = exactRecord(carrier, ["name", "bytes"], "record", fail);
        exactBufferByteLength(reference.bytes, "record bytes", limits, fail);
        const decoded = decodeCanonicalJsonLine(reference.bytes, "record bytes", 65536, fail);
        exactRecord(decoded.value, expectedRecordKeys, "record", fail);
        sha256(reference.bytes);
        return frozenCopyOnReadBytes(reference.bytes, []);
      }`),
    ),
  );

  const rejected = [
    "const { bytes: raw } = carrier;",
    'const { "bytes": raw } = carrier;',
    "function alias(bytes) { return bytes; }",
    "const alias = (bytes) => bytes;",
    "const alias = ({ bytes }) => bytes;",
    "const alias = (...bytes) => bytes;",
    "let bytes; bytes = carrier;",
    "callback((bytes) => bytes);",
    'function verify(carrier, exactBufferByteLength) { return exactBufferByteLength(carrier.bytes, "record", limits, fail); }',
    "function verify(carrier) { return helpers.sha256(carrier.bytes); }",
    'function verify(carrier) { return helpers["sha256"](carrier.bytes); }',
    "function verify(carrier) { const clone = { ...carrier }; return sha256(clone.bytes); }",
    "function verify(carrier) { const clone = Object.assign({}, carrier); return sha256(clone.bytes); }",
    "function verify(carrier) { Object.defineProperty(carrier, 'x', { value: 1 }); return sha256(carrier.bytes); }",
    "function verify(carrier) { Object.keys(carrier); return sha256(carrier.bytes); }",
    "function verify(carrier) { Object.hasOwn(carrier, 'name'); return sha256(carrier.bytes); }",
    "function verify(carrier) { Object.freeze(carrier); return sha256(carrier.bytes); }",
    "function verify(carrier) { const clone = structuredClone(carrier); return sha256(clone.bytes); }",
    "function verify(carrier) { const wrapped = new Proxy(carrier, {}); return sha256(wrapped.bytes); }",
    "function verify(carrier) { return carrier.bytes[0]; }",
    "function verify(carrier) { const raw = carrier.bytes; return raw[0]; }",
    'function verify(carrier) { const decoded = decodeCanonicalJsonLine(carrier.bytes, "record", 65536, fail); const raw = decoded.bytes; return raw[0]; }',
    "function verify(carrier) { return new sha256(carrier.bytes); }",
    "function verify(carrier) { return sha256?.(carrier.bytes); }",
    "const helper = { sha256(carrier) { return carrier; } };",
    "function verify(carrier) { return sha256([carrier.bytes][0]); }",
    "function verify(carrier) { return sha256(carrier.bytes.toSorted()); }",
  ];
  for (const body of rejected) {
    assert.throws(() => inspect(source(body)), undefined, body);
  }
});

test("decodes and rejects re-export, Unicode, hexadecimal, computed, and constructor authority bypasses", () => {
  assert.doesNotThrow(() =>
    assertRecoverySourceWithinBoundedLexicalSubset(
      parseStaticImports(
        `${RECOVERY_VALID_IMPORT_PREAMBLE}\nconst values = [1, 2]; const first = values[0]; const [left] = values;`,
      ),
    ),
  );
  assert.doesNotThrow(() =>
    assertRecoverySourceWithinBoundedLexicalSubset(
      parseStaticImports(
        `${RECOVERY_VALID_IMPORT_PREAMBLE}\nconst length = exactBufferByteLength(carrier.bytes, "record", limits, fail); const decoded = decodeCanonicalJsonLine(carrier.bytes, "record", 65536, fail); const hash = sha256(carrier.bytes);`,
      ),
    ),
  );
  const bypasses = [
    'export * from "node:fs";',
    'export { readFile } from "\\x6eode:fs";',
    'export { "readFile" as reader } from "\\u006eode:fs";',
    "const escaped = globalTh\\u0069s;",
    "const escapedProcess = proce\\u0073s;",
    'const computed = globalThis["pr" + "\\x6fcess"];',
    'const encoded = ({})["con" + "str\\u0075ctor"]["constructor"]("return process")();',
    'const factory = (async () => {})["constructor"]("return globalThis")();',
    'const dynamic = import("\\x6eode:fs");',
    'const builtin = process["getBuiltin" + "Module"]("node:fs");',
    'const parsed = JSON.parse("{}");',
    "const copied = structuredClone({ value: 1 });",
    "const decoded = new TextDecoder().decode(payload);",
    'const digestValue = createHash("sha256").update(payload).digest("hex");',
    "const first = carrier.bytes[0];",
    "const alias = carrier.bytes;",
    "const { bytes } = carrier;",
    "const ordered = Object.values(carrier).sort();",
    `const key = ["con", "structor"].join("");
const maker = ({})[key][key];
const host = maker(["return pro", "cess"].join(""))();
const get = ["getBuilt", "inModule"].join("");
const io = host[get](["no", "de", ":", "f", "s"].join(""));`,
    `const key = ["con", "structor"].join("");
const proto = Object.getPrototypeOf(() => {});
const maker = Object.getOwnPropertyDescriptor(proto, key).value;
const host = maker(["return pro", "cess"].join(""))();`,
    `const key = ["con", "structor"].join("");
const maker = [[({})[key][key]]][0][0];
const host = maker(["return pro", "cess"].join(""))();
const get = ["getBuilt", "inModule"].join("");
const io = [[host[get](["no", "de", ":", "f", "s"].join(""))]][0][0];`,
    `export const CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1 = Buffer.from("${EXPECTED_REQUIREMENTS_ENCODED_LITERALS[0]}", "base64").toString("utf8");`,
    `export const CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1 = Buffer.from("${EXPECTED_REQUIREMENTS_ENCODED_LITERALS[1]}", "base64url").toString("utf8");`,
    `const authority = Reflect.apply(
      Reflect.get(Reflect.get([], ["jo", "in"].join("")), ["con", "structor"].join("")),
      null,
      [["return globalThis[", JSON.stringify(["pro", "cess"].join("")), "]", ".", ["get", "Builtin", "Module"].join(""), "(", JSON.stringify(["node", ":", "fs"].join("")), ")"].join("")]
    )();`,
  ];
  for (const source of bypasses) {
    assert.throws(() =>
      assertRecoverySourceWithinBoundedLexicalSubset(
        parseStaticImports(`${RECOVERY_VALID_IMPORT_PREAMBLE}\n${source}`),
      ),
    );
  }
  const decoded = parseStaticImports(
    `${RECOVERY_VALID_IMPORT_PREAMBLE}\nimport { readFile as localRead } from "\\x6eode\\u003afs";`,
  );
  assert.equal(decoded.declarations.at(-1).specifier, "node:fs");
  assert.throws(() => assertRecoverySourceWithinBoundedLexicalSubset(decoded));
});

test("inspects before evaluation and requires the exact raw-byte helpers within the allowed pure subset", () => {
  const parsed = parseStaticImports(RECOVERY_SOURCE_TEXT);
  const {
    identifiers: identifierTokens,
    strings: stringTokens,
    imports,
  } = assertRecoverySourceWithinBoundedLexicalSubset(parsed);
  assert.deepEqual(
    [...identifierTokens].sort(),
    [...RECOVERY_PREEXECUTION_AUDIT.identifiers].sort(),
  );
  assert.deepEqual(stringTokens, RECOVERY_PREEXECUTION_AUDIT.strings);
  assert.deepEqual(imports, RECOVERY_PREEXECUTION_AUDIT.imports);
  assert.deepEqual(RECOVERY_PREEXECUTION_POLICY_CONTROLS, {
    rejectedImportCount: 8,
    rejectedAmbientEffectCount: 28,
    evaluationAttempts: 0,
  });
  const allowedPureHelpers = new Set(RECOVERY_ALLOWED_PURE_IMPORT_SPECIFIERS);
  const lifetimeSpecifier = RECOVERY_LIFETIME_IMPORT_SPECIFIER;
  assert.equal(
    parsed.declarations.filter((entry) => entry.specifier === lifetimeSpecifier)
      .length,
    1,
  );
  assert.equal(
    new Set(parsed.declarations.map((entry) => entry.specifier)).size,
    parsed.declarations.length,
  );
  for (const declaration of parsed.declarations) {
    assert.equal(
      declaration.specifier === lifetimeSpecifier ||
        allowedPureHelpers.has(declaration.specifier),
      true,
    );
    assert.equal(declaration.sideEffect, false);
    assert.equal(declaration.defaultBinding, null);
    assert.equal(declaration.namespaceBinding, null);
    assert.equal(declaration.namedBindings.length > 0, true);
  }
  const exactLifetimeBindings = RECOVERY_LIFETIME_IMPORT_BINDINGS;
  const lifetimeDeclaration = parsed.declarations.find(
    (entry) => entry.specifier === lifetimeSpecifier,
  );
  assert.deepEqual(
    lifetimeDeclaration.namedBindings.map((binding) => binding.imported).sort(),
    exactLifetimeBindings.toSorted(),
  );
  assert.equal(
    lifetimeDeclaration.namedBindings.every(
      (binding) => binding.imported === binding.local,
    ),
    true,
  );
  const exactHelperDeclaration = parsed.declarations.find(
    (entry) => entry.specifier === "./containment-exact-v2.mjs",
  );
  assert.notEqual(exactHelperDeclaration, undefined);
  assert.deepEqual(
    exactHelperDeclaration.namedBindings
      .filter(
        (binding) =>
          binding.imported === "decodeCanonicalJsonLine" ||
          binding.imported === "exactBufferByteLength" ||
          binding.imported === "exactRecord" ||
          binding.imported === "sha256",
      )
      .toSorted((left, right) => left.imported.localeCompare(right.imported)),
    [
      {
        imported: "decodeCanonicalJsonLine",
        local: "decodeCanonicalJsonLine",
      },
      {
        imported: "exactBufferByteLength",
        local: "exactBufferByteLength",
      },
      { imported: "exactRecord", local: "exactRecord" },
      { imported: "sha256", local: "sha256" },
    ],
  );
  for (const requiredLifetimeBinding of exactLifetimeBindings) {
    assert.equal(
      parsed.tokens.filter(
        (token) =>
          token.type === "identifier" &&
          token.value === requiredLifetimeBinding,
      ).length >= 2,
      true,
    );
  }
  assert.equal(
    parsed.tokens.some(
      (token) =>
        token.type === "string" &&
        token.value ===
          "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773",
    ),
    true,
  );
  for (const forbiddenIdentifier of [
    "registerRuntime",
    "qualify",
    "promote",
    "publish",
  ]) {
    assert.equal(identifierTokens.has(forbiddenIdentifier), false);
  }
  for (const forbiddenFragment of [
    "containment-guardian-recovery-v2",
    "cgroup.kill",
    "/proc/",
    "node:fs",
    "node:fs/promises",
    "node:net",
    "node:tls",
    "node:http",
    "node:https",
    "node:dns",
    "node:dgram",
    "node:child_process",
    "node:worker_threads",
  ]) {
    assert.equal(
      stringTokens.some((value) => value.includes(forbiddenFragment)),
      false,
    );
  }
  for (const forbiddenExactString of [
    "require",
    "createRequire",
    "getBuiltinModule",
    "process",
    "fetch",
    "WebSocket",
    "XMLHttpRequest",
  ]) {
    assert.equal(stringTokens.includes(forbiddenExactString), false);
  }
});
