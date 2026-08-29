import {
  canonicalJsonLine,
  decodeCanonicalJsonLine,
  deepFreeze,
  exactBufferByteLength,
  exactDenseArray,
  exactDigest,
  exactRecord,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";
import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";

export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_IDENTITY_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-identity/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_CONTEXT_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-context/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-record/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-replay/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-requirements/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-projection/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_CHAIN_EVENT_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-chain-event/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PARTIAL_LAUNCH_RESOLUTION_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-partial-launch-resolution-projection/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_LAUNCH_FAILURE_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-no-child-launch-failure-projection/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_INVENTORY_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-target-genesis-inventory-projection/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_EVENT_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-target-genesis-event/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_EVENT_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-lifetime-recovery-attempt-anchor-event/v1";
export const CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1 =
  "oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1";
export const CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1 =
  "oxigraph.candidate-containment-lifetime-normal-close-receipt-projection/v1";
export const CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1 =
  "oxigraph.candidate-containment-recovery-external-head/v1";

export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_SEQUENCE_WIDTH_V1 = 16;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEGMENTS_V1 = 5;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_PER_SEGMENT_V1 = 256;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_ACROSS_SEGMENTS_V1 = 1280;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_CONTROL_VALUE_BYTES_V1 = 16384;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_OPERATION_OR_EVIDENCE_BYTES_V1 = 16384;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORD_BYTES_V1 = 65536;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_AGGREGATE_RECORD_BYTES_V1 = 83886080;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECOVERY_ATTEMPTS_PER_TARGET_V1 = 4;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_BOOT_TRANSITIONS_PER_TARGET_V1 = 4;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_TARGETS_V1 = 6;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_GLOBAL_RECORDS_V1 = 25;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_PER_TARGET_V1 = 37;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_V1 = 247;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MIN_CLOSURE_RESERVE_V1 = 3;
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1 =
  "0".repeat(64);

export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_KINDS_V1 = Object.freeze([
  "NORMAL",
  "REBOOT_RECOVERY",
]);
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_WRITER_KINDS_V1 =
  Object.freeze([
    "SERVICE_MANAGER",
    "LIVE_BIRTH_GUARDIAN",
    "RECOVERY_ONLY_GUARDIAN",
  ]);
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_TYPES_V1 =
  Object.freeze([
    "NORMAL_LIFETIME_EPOCH_CONSUMED",
    "REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED",
    "LIFETIME_CGROUP_CREATE_INTENT_DURABLE",
    "LIFETIME_CGROUP_CONFIGURED_OBSERVED",
    "GUARDIAN_LAUNCH_INTENT_DURABLE",
    "GUARDIAN_NOT_CREATED_OBSERVED",
    "GUARDIAN_PIDFD_OBSERVED",
    "GUARDIAN_EXEC_OBSERVED",
    "GUARDIAN_MEMBERSHIP_OBSERVED",
    "GUARDIAN_INITIALIZATION_ADOPTED",
    "GENERATION_RECOVERY_HEAD_DURABLE",
    "TARGET_REBOOT_TRANSITION_OBSERVED",
    "RECOVERY_ATTEMPT_ANCHOR_DURABLE",
    "RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE",
    "RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED",
    "RECOVERY_GUARDIAN_PIDFD_OBSERVED",
    "RECOVERY_GUARDIAN_EXEC_OBSERVED",
    "RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED",
    "RECOVERY_ATTEMPT_RESULT_DURABLE",
    "RECOVERY_GUARDIAN_TERMINATION_OBSERVED",
    "RECOVERY_GUARDIAN_REAPED_OBSERVED",
    "RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED",
    "NORMAL_CLOSE_RECEIPT_DURABLE",
    "GUARDIAN_TERMINATION_OBSERVED",
    "GUARDIAN_REAPED_OBSERVED",
    "GUARDIAN_PARENTAGE_LOST_OBSERVED",
    "LIFETIME_REMOVAL_INTENT_DURABLE",
    "LIFETIME_PATH_ABSENT_OBSERVED",
    "LIFETIME_CLOSED_DURABLE",
  ]);
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_STATUSES_V1 =
  Object.freeze([
    "NO_LIFETIME_RECORD",
    "VALID_LIFETIME_PREFIX_REPLAYED",
    "VALID_LIFETIME_CHAIN_REPLAYED",
    "COMPLETE_LIFETIME_CHAIN_REPLAYED",
  ]);
export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_ERRNO_NAMES_V1 =
  Object.freeze([
    "EACCES",
    "EAGAIN",
    "EBUSY",
    "EINVAL",
    "ENOMEM",
    "ENOSYS",
    "EOPNOTSUPP",
    "EPERM",
  ]);

function relationshipRow(recordType, writerRule, targetRule, predecessorRule) {
  return deepFreeze(
    nullRecord([
      ["recordType", recordType],
      ["writerRule", writerRule],
      ["targetRule", targetRule],
      ["predecessorRule", predecessorRule],
    ]),
  );
}

const RECORD_TYPE_RELATIONSHIP_MATRIX_V1 = deepFreeze([
  relationshipRow(
    "NORMAL_LIFETIME_EPOCH_CONSUMED",
    "service manager; epoch = manager actor",
    "null",
    "sequence 1 of the sole NORMAL genesis segment; zero prior replay and all-zero record head",
  ),
  relationshipRow(
    "REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED",
    "service manager; epoch = manager actor",
    "null",
    "sequence 1 of a REBOOT_RECOVERY segment; previous complete-tail-matched nonclosed segment tuple equals the identity predecessor; that predecessor replay contains neither removal intent nor pathname absence; boot and lifetime epoch both differ",
  ),
  relationshipRow(
    "LIFETIME_CGROUP_CREATE_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "segment epoch-consumed is the previous segment-wide event",
  ),
  relationshipRow(
    "LIFETIME_CGROUP_CONFIGURED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "cgroup-create intent; evidence is the exact configured context",
  ),
  relationshipRow(
    "GUARDIAN_LAUNCH_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "configured NORMAL context; no normal guardian launch event exists",
  ),
  relationshipRow(
    "GUARDIAN_NOT_CREATED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian launch intent; exact same-manager definite-no-child launch-failure evidence; no pidfd/child/termination event exists",
  ),
  relationshipRow(
    "GUARDIAN_PIDFD_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian launch intent",
  ),
  relationshipRow(
    "GUARDIAN_EXEC_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian pidfd observation",
  ),
  relationshipRow(
    "GUARDIAN_MEMBERSHIP_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian exec observation",
  ),
  relationshipRow(
    "GUARDIAN_INITIALIZATION_ADOPTED",
    "live-birth guardian; epoch = normal lifetime epoch",
    "null",
    "normal guardian membership observation",
  ),
  relationshipRow(
    "GENERATION_RECOVERY_HEAD_DURABLE",
    "live-birth guardian with normal lifetime epoch after its exact initialization-adopted prefix, or service manager with manager epoch after normal-guardian terminal resolution or in a configured proved-reboot segment",
    "non-null",
    "target and generation identity absent from replay; target count below six and complete append reserve available; operation is the exact target-genesis event, whose reboot-transition chain is empty except for service-manager genesis after one or more proved-reboot segments; evidence is its sole genesis NO_RECOVERY_ATTEMPT head",
  ),
  relationshipRow(
    "TARGET_REBOOT_TRANSITION_OBSERVED",
    "service manager; epoch = manager actor",
    "non-null existing target",
    "current reboot segment is configured; operation is the exact one-through-four transition-chain event covering every segment since the target's latest context; target has no transition ending at this segment; latest external head remains unchanged",
  ),
  relationshipRow(
    "RECOVERY_ATTEMPT_ANCHOR_DURABLE",
    "initialized live-birth guardian with epoch = anchor actor and no not-created/termination/reboot supersession, or service manager with epoch = manager actor for a recovery-only anchor",
    "non-null existing target",
    "configured context; complete reboot-transition catch-up exists iff boot changed; no unresolved anchor; target nonterminal; attempt count below four; complete append reserve exists for the whole attempt/result/actor-resolution suffix; evidence is the exact anchor event",
  ),
  relationshipRow(
    "RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "anchor target",
    "current anchor is recovery-only and has no launch event",
  ),
  relationshipRow(
    "RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery launch intent; exact same-manager definite-no-child launch-failure evidence; no pidfd/child/termination event exists",
  ),
  relationshipRow(
    "RECOVERY_GUARDIAN_PIDFD_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery launch intent",
  ),
  relationshipRow(
    "RECOVERY_GUARDIAN_EXEC_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery guardian pidfd observation",
  ),
  relationshipRow(
    "RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery guardian exec observation",
  ),
  relationshipRow(
    "RECOVERY_ATTEMPT_RESULT_DURABLE",
    "matching initialized live-birth actor before termination/reboot; matching recovery-only actor only after its exact launch-intent/pidfd/exec/membership prefix and before not-created/termination/reboot; service manager for a recovery-only anchor after exact never-launched pre-temp ABSENT/PRESENT_EMPTY observation or recovery-guardian not-created; or service manager for either actor kind only after that actor's same-boot terminal resolution or configured target reboot supersession",
    "anchor target",
    "exact current anchor; result binds that anchor and recovery head; residue-free never-launched/not-created result is anchored-empty; launched result is structurally observed from the exact recovery ledger; temp/other residue rejects; a live-birth empty directory never grants the manager a direct pre-resolution result branch; after reboot, complete target catch-up and exact directory/ledger observation replace unobtainable old-boot process evidence without claiming reap or exit status",
  ),
  relationshipRow(
    "RECOVERY_GUARDIAN_TERMINATION_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "any durable recovery launch-intent prefix; may follow its honest launch prefix or result; replacement-manager use additionally requires reported lock reacquisition plus exact lifetime-cgroup empty/identity evidence; occurs once",
  ),
  relationshipRow(
    "RECOVERY_GUARDIAN_REAPED_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "termination observed and this manager retains exclusive direct-child wait authority",
  ),
  relationshipRow(
    "RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "termination observed after manager replacement; direct-child wait authority is absent and no reap/exit-status claim is made",
  ),
  relationshipRow(
    "NORMAL_CLOSE_RECEIPT_DURABLE",
    "service manager; epoch = manager actor",
    "non-null existing target",
    "target has its unique genesis head, zero attempts, no recovery terminal, and zero through four exact replay-derived transitions ending in the current configured context; evidence is the exact close-receipt projection replay will brand",
  ),
  relationshipRow(
    "GUARDIAN_TERMINATION_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "any durable normal launch-intent prefix has terminated, independently of target terminality; replacement-manager use additionally requires reported lock reacquisition plus exact lifetime-cgroup empty/identity evidence",
  ),
  relationshipRow(
    "GUARDIAN_REAPED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian termination observed and this manager retains exclusive direct-child wait authority",
  ),
  relationshipRow(
    "GUARDIAN_PARENTAGE_LOST_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian termination observed after manager replacement; no reap/exit-status claim",
  ),
  relationshipRow(
    "LIFETIME_REMOVAL_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "every target is terminal; no anchor/result relationship is open; the current-segment normal guardian is not-created, reaped, parentage-lost, or absent because reboot superseded the prior actor; and every current-segment recovery launch is not-created or termination followed by reap or parentage-lost",
  ),
  relationshipRow(
    "LIFETIME_PATH_ABSENT_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "lifetime removal intent",
  ),
  relationshipRow(
    "LIFETIME_CLOSED_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "lifetime pathname absence observation; no successor in this segment",
  ),
]);

const RECORD_TYPE_RELATIONSHIP_MATRIX_SHA256 = canonicalSha256(
  RECORD_TYPE_RELATIONSHIP_MATRIX_V1,
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_AUTHORITY_V1 = deepFreeze(
  nullRecord([
    ["mayPersistLifetimeRecord", false],
    ["mayConsumeLifetimeEpoch", false],
    ["mayCreateLifetimeCgroup", false],
    ["mayRemoveLifetimeCgroup", false],
    ["mayLaunchGuardian", false],
    ["mayReapGuardian", false],
    ["mayPersistRecoveryTarget", false],
    ["mayPersistRecoveryAnchor", false],
    ["mayPersistRecoveryHead", false],
    ["mayPersistNormalCloseReceipt", false],
    ["mayMutateStateFilesystem", false],
    ["mayMutateDelegatedCgroup", false],
    ["mayExecuteRecoveryPlan", false],
    ["mayRegisterRuntime", false],
    ["mayQualify", false],
    ["mayPromote", false],
    ["mayPublish", false],
    ["productionContainment", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NONCLAIMS_V1 = deepFreeze(
  nullRecord([
    ["serializedReplayProvesArtifactOrigin", false],
    ["serializedReplayProvesFilesystemDurability", false],
    ["serializedReplayProvesExclusiveStateRootLock", false],
    ["serializedReplayProvesBootIdentity", false],
    ["serializedReplayProvesDelegatedRootIdentity", false],
    ["serializedReplayProvesLifetimeCgroupIdentity", false],
    ["serializedReplayProvesFreshEpoch", false],
    ["serializedReplayProvesGuardianExecution", false],
    ["serializedReplayProvesGuardianParentage", false],
    ["serializedReplayProvesGuardianReap", false],
    ["parentageLostObservationProvesReap", false],
    ["serializedReplayProvesRecoveryTargetOrigin", false],
    ["serializedReplayProvesRecoveryHeadOrigin", false],
    ["serializedReplayProvesNormalCloseMechanics", false],
    ["selectedBoundaryProvesPhysicalFact", false],
    ["tailDeletionExcludedWithoutExpectedHead", false],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PHYSICAL_FACTS_V1 =
  deepFreeze(
    nullRecord([
      ["stateRootIdentityObserved", null],
      ["stateFilesystemInterfaceAvailable", null],
      ["lifetimeEpochConsumed", null],
      ["lifetimeRecordPersisted", null],
      ["lifetimeRecordFilesystemDurability", null],
      ["lifetimeCgroupConfigured", null],
      ["lifetimeCgroupPathAbsent", null],
      ["guardianExecuted", null],
      ["guardianReaped", null],
      ["guardianParentageLost", null],
      ["recoveryTargetPersisted", null],
      ["recoveryAnchorPersisted", null],
      ["recoveryHeadPersisted", null],
      ["normalCloseReceiptPersisted", null],
      ["bootTransitionObserved", null],
      ["physicalEligibility", false],
      ["productionContainment", false],
    ]),
  );

const RULES = Object.freeze({
  guardianControlRequirementsBindingRule:
    "non-null-exact-sha-bound-identically-across-segments/v1",
  recordGrammarRule:
    "segment-genesis-then-intent-before-observation;reboot-successor-requires-complete-tail-matched-nonclosed-predecessor-without-removal-intent-or-path-absence;removal-intent-then-path-absence-then-close-in-same-segment-with-no-successor;launch-intent-then-definite-not-created-or-honest-launch-prefix;unique-generation-target-genesis-by-live-normal-or-service-manager-after-normal-resolution-or-bounded-proved-reboot-catchup;actor-written-target-head-or-live-anchor-requires-normal-adoption;anchor-before-optional-launch;actor-written-result-requires-live-adoption-or-recovery-launch-through-membership-and-no-resolution-or-supersession;manager-direct-pretemp-empty-or-not-created-result-only-for-recovery-only-anchor;manager-live-birth-result-only-after-normal-resolution-or-reboot-supersession;manager-launched-recovery-result-only-after-recovery-resolution-or-reboot-supersession;result-may-precede-terminal-resolution;successor-anchor-requires-result-and-iff-launch-intent-not-created-or-same-boot-termination-then-reap-or-parentage-lost-or-target-reboot-supersession;abandoned-prelaunch-anchor-becomes-anchored-empty-only-after-restored-exact-absent-or-empty-pre-temp-observation;same-boot-partial-launch-terminal-resolution-requires-reported-lock-reacquisition-and-lifetime-cgroup-empty-identity;proved-reboot-supersession-forbids-old-boot-process-records-and-permits-exact-directory-derived-result;normal-termination-may-precede-target-terminal;recovery-only-after-live-requires-normal-resolution-or-target-reboot-supersession;normal-resolution-is-not-created-or-same-boot-termination-then-reap-or-parentage-lost;all-targets-terminal-and-no-open-anchor-result-or-current-recovery-launch-and-current-normal-guardian-resolved-or-reboot-superseded-then-removal-intent-then-path-absent-then-closed;target-terminal-rejects-new-attempt-but-permits-required-actor-resolution-reboot-catchup-and-lifetime-closure;lifetime-terminal-rejects-successor/v1",
  actorWriterHandoffRule:
    "live-target-anchor-result-requires-initialization-adopted-and-no-not-created-termination-or-reboot;recovery-actor-result-requires-anchor-launch-intent-pidfd-exec-membership-and-no-not-created-termination-or-reboot;manager-direct-never-launched-pretemp-empty-or-not-created-result-only-for-recovery-only-anchor;manager-live-birth-result-only-after-normal-terminal-resolution-or-target-reboot-supersession;manager-launched-recovery-result-only-after-recovery-terminal-resolution-or-target-reboot-supersession/v1",
  replayStatusRule:
    "zero-records:no-lifetime-record;apply-exact-reboot-supersession-only-to-crossed-old-segment-cgroup-create-launch-and-actor-resolution;nonclosed-any-remaining-open-nonsuperseded-intent-partial-launch-anchor-without-result-termination-without-reap-or-parentage-lost-result-publishing-recovery-actor-without-resolution-or-removal-without-path-absence:valid-lifetime-prefix-replayed;nonclosed-all-started-relationships-stable-or-exactly-reboot-superseded:valid-lifetime-chain-replayed;lifetime-closed:complete-lifetime-chain-replayed/v1",
  perBootTransitionRule:
    "same-boot-repeat-context;proved-reboot-new-segment-and-one-transition-projection-per-target-counted-through-direct-or-catchup-event;recovery-only-after-reboot-or-recovery-only;old-boot-process-records-forbidden/v1",
  rebootTransitionCatchupRule:
    "dense-one-through-four;first-previous-equals-target-context-and-segment-head;adjacent-items-equal-every-intervening-segment-identity-optional-configured-context-and-head;final-current-equals-record-configured-context;prior-count-plus-length-at-most-four;no-old-segment-append/v1",
  rebootSupersessionRule:
    "complete-catchup-to-configured-newest-segment;every-crossed-boot-and-epoch-differs;every-crossed-previous-lifetime-control-job-absent;no-old-boot-termination-reap-parentage-or-exit-claim;service-manager-may-bind-exact-directory-derived-result-and-recovery-only-successor/v1",
  configuredContextRule:
    "identity-state-root-boot-delegated-equal;non-null-reported-lifetime-cgroup;digest-covers-prefix/v1",
  targetGenesisInventoryRule:
    "recovery-directory-present;entry-count-zero;existing-lifetime-target-head-false/v1",
  targetGenesisEventRule:
    "projection-and-inventory-target-equal;normal-live-or-resolved-manager-has-empty-transition-array;reboot-service-manager-has-complete-dense-catchup-array;genesis-head-is-no-recovery-attempt/v1",
  recoveryTargetProjectionRule:
    "generation-manifest-target-boot-delegated-root-lifetime-epoch-and-four-normal-head-fields-equal-reverified-target-and-normal-context-or-catchup-origin;digest-covers-prefix/v1",
  recoveryTargetUniquenessRule:
    "exactly-one-target-per-generation-identity-across-all-segments;target-sha-not-reused-across-generation-identities/v1",
  targetSelectorPairRule:
    "complete-tail-replay-selects-generation-unique-projection-and-genesis-record-raw-weakmap-pair/v1",
  boundarySetAssertionRule:
    "target-required;historical-anchor-carriers-dense-ledger-order-and-brand-nested-projection-plus-raw;optional-current-carrier-head-close;same-originating-replay-instance;current-anchor-predecessor-equals-external-head;byte-equal-cross-replay-rejects/v1",
  targetRebootTransitionRule:
    "every-item-boot-and-lifetime-epoch-differ;configured-flags-control-nullability;state-root-stable;prior-lifetime-control-job-absent;target-and-external-head-stable;complete-chain-supersedes-old-target-actor-without-process-claim;permits-exact-directory-derived-result/v1",
  partialLaunchResolutionRule:
    "same-boot-replacement-only;lock-reacquired;prior-manager-absent;lifetime-cgroup-identity-equal-and-empty;no-reap-or-exit-status-claim/v1",
  anchorPairRule:
    "weakmap-projection-to-originating-replay-and-record-raw;actor-directory-fresh;predecessor-equals-latest-external-head/v1",
  externalHeadProgressionRule:
    "genesis-no-attempt;one-result-per-anchor;result-before-successor;terminal-rejects-new-attempt-but-permits-required-actor-resolution-reboot-catchup-and-lifetime-closure/v1",
  normalCloseReceiptRule:
    "target-genesis;zero-attempts;zero-through-four-exact-replay-derived-transitions-ending-current-context;active-to-closed;both-parent-syncs-and-closed-reobservation-true/v1",
  appendReserveRule:
    "before-create-classify-candidate-global-or-target;prospective-consumed-equals-already-consumed-plus-candidate;apply-candidate-transition-then-count-suffix-strictly-after-candidate;normal-genesis-starts-eight-with-seven-remaining;begun-normal-or-reboot-setup-counts-only-remainder-after-candidate;three-for-each-not-yet-begun-of-four-permitted-reboots;remaining-to-two-normal-actor-resolution;remaining-to-three-close;prospective-global-plus-post-candidate-suffix-at-most-25;target-genesis-starts-thirty-seven-with-thirty-six-remaining;anchor-starts-eight-with-seven-remaining;eight-for-each-not-yet-anchored-of-four-permitted-attempts;one-catchup-per-remaining-transition;terminal-result-already-inside-attempt-eight;one-record-normal-close-is-mutually-exclusive-maximum-not-additive;prospective-target-plus-post-candidate-suffix-at-most-37;target-count-at-most-six;prospective-aggregate-plus-post-candidate-global-and-every-admitted-target-suffix-at-most247;target-genesis-adds-new-bucket;unadmitted-targets-contribute-zero;global25-plus-six-times-target37-equals247-less-than-segment256;reject-before-canonical-bytes/v1",
});

export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1 =
  deepFreeze(
    nullRecord([
      [
        "schema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SCHEMA_V1,
      ],
      [
        "identitySchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_IDENTITY_SCHEMA_V1,
      ],
      [
        "contextSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_CONTEXT_SCHEMA_V1,
      ],
      [
        "recordSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_SCHEMA_V1,
      ],
      [
        "replaySchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_SCHEMA_V1,
      ],
      [
        "rebootTransitionSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_SCHEMA_V1,
      ],
      [
        "rebootTransitionChainEventSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_CHAIN_EVENT_SCHEMA_V1,
      ],
      [
        "partialLaunchResolutionSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PARTIAL_LAUNCH_RESOLUTION_SCHEMA_V1,
      ],
      [
        "noChildLaunchFailureSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_LAUNCH_FAILURE_SCHEMA_V1,
      ],
      [
        "targetGenesisInventorySchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_INVENTORY_SCHEMA_V1,
      ],
      [
        "recoveryTargetProjectionSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1,
      ],
      [
        "targetGenesisEventSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_EVENT_SCHEMA_V1,
      ],
      [
        "anchorEventSchema",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_EVENT_SCHEMA_V1,
      ],
      [
        "anchorProjectionSchema",
        CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1,
      ],
      [
        "normalCloseReceiptProjectionSchema",
        CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1,
      ],
      [
        "externalHeadSchema",
        CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1,
      ],
      [
        "journalV2RequirementsSha256",
        "95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26",
      ],
      [
        "guardianControlRequirementsBindingRule",
        RULES.guardianControlRequirementsBindingRule,
      ],
      [
        "authoritySha256",
        canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_AUTHORITY_V1),
      ],
      [
        "nonclaimsSha256",
        canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NONCLAIMS_V1),
      ],
      [
        "physicalFactsSha256",
        canonicalSha256(
          CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PHYSICAL_FACTS_V1,
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
      [
        "operationArtifactSchemaPattern",
        "oxigraph.candidate-containment-guardian-lifetime-operation/<lower-kebab-record-type>/v1",
      ],
      [
        "evidenceArtifactSchemaPattern",
        "oxigraph.candidate-containment-guardian-lifetime-evidence/<lower-kebab-record-type>/v1",
      ],
      [
        "operationBindingSchema",
        "oxigraph.candidate-containment-guardian-lifetime-operation-binding/v1",
      ],
      [
        "evidenceBindingSchema",
        "oxigraph.candidate-containment-guardian-lifetime-evidence-binding/v1",
      ],
      ["operationAndEvidencePayloadShape", "opaque-bounded-canonical-json"],
      ["sequenceStartsAt", 1],
      [
        "sequenceWidth",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_SEQUENCE_WIDTH_V1,
      ],
      [
        "maximumLifetimeSegments",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEGMENTS_V1,
      ],
      [
        "maximumRecordsPerSegment",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_PER_SEGMENT_V1,
      ],
      [
        "maximumRecordsAcrossSegments",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_ACROSS_SEGMENTS_V1,
      ],
      [
        "maximumControlValueBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_CONTROL_VALUE_BYTES_V1,
      ],
      [
        "maximumOperationOrEvidenceBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
      ],
      [
        "maximumRecordBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORD_BYTES_V1,
      ],
      [
        "maximumAggregateRecordBytes",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_AGGREGATE_RECORD_BYTES_V1,
      ],
      [
        "maximumRecoveryAttemptsPerTarget",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECOVERY_ATTEMPTS_PER_TARGET_V1,
      ],
      [
        "maximumBootTransitionsPerTarget",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_BOOT_TRANSITIONS_PER_TARGET_V1,
      ],
      [
        "maximumTargetsPerLifetime",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_TARGETS_V1,
      ],
      [
        "maximumSemanticGlobalRecords",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_GLOBAL_RECORDS_V1,
      ],
      [
        "maximumSemanticRecordsPerTarget",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_PER_TARGET_V1,
      ],
      [
        "maximumSemanticRecordsAcrossLifetime",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_V1,
      ],
      [
        "minimumLifetimeClosureReserve",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MIN_CLOSURE_RESERVE_V1,
      ],
      [
        "genesisRawSha256",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1,
      ],
      ["lifetimeKinds", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_KINDS_V1],
      ["writerKinds", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_WRITER_KINDS_V1],
      ["recordTypes", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_TYPES_V1],
      [
        "replayStatuses",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_STATUSES_V1,
      ],
      [
        "noChildErrnoNames",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_ERRNO_NAMES_V1,
      ],
      [
        "lifetimeBoundaryBrandProtocol",
        "complete-tail-matched-lifetime-replay-weakmap-pair-brand/v1",
      ],
      [
        "recordTypeRelationshipMatrixSha256",
        RECORD_TYPE_RELATIONSHIP_MATRIX_SHA256,
      ],
      ["structuralTailOptional", true],
      ["completeTailRequiredForBoundarySelection", true],
      ["completeTailRequiredForRecordCreation", true],
      ["recordGrammarRule", RULES.recordGrammarRule],
      ["actorWriterHandoffRule", RULES.actorWriterHandoffRule],
      ["replayStatusRule", RULES.replayStatusRule],
      ["perBootTransitionRule", RULES.perBootTransitionRule],
      ["rebootTransitionCatchupRule", RULES.rebootTransitionCatchupRule],
      ["rebootSupersessionRule", RULES.rebootSupersessionRule],
      ["configuredContextRule", RULES.configuredContextRule],
      ["targetGenesisInventoryRule", RULES.targetGenesisInventoryRule],
      ["targetGenesisEventRule", RULES.targetGenesisEventRule],
      ["recoveryTargetProjectionRule", RULES.recoveryTargetProjectionRule],
      ["recoveryTargetUniquenessRule", RULES.recoveryTargetUniquenessRule],
      ["targetSelectorPairRule", RULES.targetSelectorPairRule],
      ["boundarySetAssertionRule", RULES.boundarySetAssertionRule],
      ["targetRebootTransitionRule", RULES.targetRebootTransitionRule],
      ["partialLaunchResolutionRule", RULES.partialLaunchResolutionRule],
      ["anchorPairRule", RULES.anchorPairRule],
      ["externalHeadProgressionRule", RULES.externalHeadProgressionRule],
      ["normalCloseReceiptRule", RULES.normalCloseReceiptRule],
      ["appendReserveRule", RULES.appendReserveRule],
      ["filesystemMechanicsImplemented", false],
      ["cgroupMechanicsImplemented", false],
      ["guardianExecutionProven", false],
      ["boundaryOriginProven", false],
      ["runtimeRegistrationPermitted", false],
      ["qualificationPermitted", false],
      ["promotionPermitted", false],
      ["publicationPermitted", false],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1 =
  canonicalSha256(CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1);

const IDENTITY_INPUT_FIELDS = Object.freeze([
  "lifetimeKind",
  "stateRootIdentitySha256",
  "managerActorEpochSha256",
  "bootIdSha256",
  "delegatedRootIdentitySha256",
  "lifetimeEpochSha256",
  "limitsSha256",
  "guardianExecutableIdentitySha256",
  "guardianControlRequirementsSha256",
  "previousLifetimeReplay",
]);
const IDENTITY_BASE_FIELDS = Object.freeze([
  "schema",
  "lifetimeKind",
  "stateRootIdentitySha256",
  "managerActorEpochSha256",
  "bootIdSha256",
  "delegatedRootIdentitySha256",
  "lifetimeEpochSha256",
  "lifetimeCgroupName",
  "limitsSha256",
  "guardianExecutableIdentitySha256",
  "guardianControlRequirementsSha256",
  "previousLifetimeEpochSha256",
  "previousLifetimeRecordSequence",
  "previousLifetimeRecordRawSha256",
]);
const IDENTITY_FIELDS = Object.freeze([
  ...IDENTITY_BASE_FIELDS,
  "identitySha256",
]);
const RECORD_FIELDS = Object.freeze([
  "schema",
  "sequence",
  "recordType",
  "previousRecordRawSha256",
  "lifetimeIdentity",
  "writerKind",
  "writerActorEpochSha256",
  "targetSha256",
  "operation",
  "evidence",
]);
const DESCRIPTOR_FIELDS = Object.freeze([
  "schema",
  "rawSha256",
  "semanticSha256",
  "bytesBase64",
  "bindingSha256",
]);
const RECORD_REFERENCE_FIELDS = Object.freeze(["name", "bytes"]);
const SEGMENT_FIELDS = Object.freeze(["lifetimeIdentity", "records"]);
const REPLAY_INPUT_FIELDS = Object.freeze([
  "segments",
  "expectedStateRootIdentitySha256",
  "expectedLatestLifetimeEpochSha256",
  "expectedLatestRecordSequence",
  "expectedLatestRecordRawSha256",
]);
const CREATE_RECORD_FIELDS = Object.freeze([
  "previousLifetimeReplay",
  "lifetimeIdentity",
  "writerKind",
  "writerActorEpochSha256",
  "targetSha256",
  "recordType",
  "operationBytes",
  "evidenceBytes",
]);
const RECORD_FILENAME = /^([0-9]{16})-([0-9a-f]{64})\.jsonl$/u;
const SEQUENCE = /^[0-9]{16}$/u;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const recordArtifacts = new WeakSet();
const replayBrands = new WeakMap();
const targetSelectionBrands = new WeakMap();
const anchorProjectionBrands = new WeakMap();
const externalHeadBrands = new WeakMap();
const closeSelectionBrands = new WeakMap();
const CANDIDATE_RAW_SHA256_PREVIEW = Symbol(
  "candidate containment guardian lifetime raw SHA-256 preview",
);

function fail(message) {
  throw new Error(`candidate containment guardian lifetime v1: ${message}`);
}

function brandFail(message) {
  throw new TypeError(`candidate containment guardian lifetime v1: ${message}`);
}

function decodeLifetimeJsonLine(bytes, label, maximumBytes) {
  const decoded = decodeCanonicalJsonLine(bytes, label, maximumBytes, fail);
  if (
    decoded.bytes.length >= 3 &&
    decoded.bytes[0] === 0xef &&
    decoded.bytes[1] === 0xbb &&
    decoded.bytes[2] === 0xbf
  ) {
    fail(`${label} begins with a UTF-8 BOM`);
  }
  return decoded;
}

function exactOneOf(value, values, label) {
  if (typeof value !== "string" || !values.includes(value)) {
    fail(`${label} changed`);
  }
  return value;
}

function exactSequence(
  value,
  label,
  maximum = CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_PER_SEGMENT_V1,
) {
  if (!SEQUENCE.test(value)) fail(`${label} is not fixed-width sequence`);
  const number = Number(value);
  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > maximum ||
    String(number).padStart(16, "0") !== value
  ) {
    fail(`${label} is outside its exact range`);
  }
  return number;
}

function sequenceText(value) {
  return String(value).padStart(16, "0");
}

function sameValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalIdentity(fields) {
  const base = nullRecord([
    ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_IDENTITY_SCHEMA_V1],
    ...IDENTITY_BASE_FIELDS.slice(1).map((field) => [field, fields[field]]),
  ]);
  return deepFreeze(
    nullRecord([
      ...IDENTITY_BASE_FIELDS.map((field) => [field, base[field]]),
      ["identitySha256", canonicalSha256(base)],
    ]),
  );
}

function normalizeIdentity(value, label) {
  const record = exactRecord(value, IDENTITY_FIELDS, label, fail);
  if (
    record.schema !== CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_IDENTITY_SCHEMA_V1
  )
    fail(`${label}.schema changed`);
  exactOneOf(
    record.lifetimeKind,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_KINDS_V1,
    `${label}.lifetimeKind`,
  );
  for (const field of [
    "stateRootIdentitySha256",
    "managerActorEpochSha256",
    "bootIdSha256",
    "delegatedRootIdentitySha256",
    "lifetimeEpochSha256",
    "limitsSha256",
    "guardianExecutableIdentitySha256",
    "guardianControlRequirementsSha256",
    "previousLifetimeRecordRawSha256",
    "identitySha256",
  ])
    exactDigest(record[field], `${label}.${field}`, fail);
  if (record.previousLifetimeEpochSha256 !== null)
    exactDigest(
      record.previousLifetimeEpochSha256,
      `${label}.previousLifetimeEpochSha256`,
      fail,
    );
  if (record.previousLifetimeRecordSequence !== null)
    exactSequence(
      record.previousLifetimeRecordSequence,
      `${label}.previousLifetimeRecordSequence`,
    );
  if (record.lifetimeCgroupName !== `guardian-${record.lifetimeEpochSha256}`)
    fail(`${label}.lifetimeCgroupName changed`);
  if (record.lifetimeKind === "NORMAL") {
    if (
      record.previousLifetimeEpochSha256 !== null ||
      record.previousLifetimeRecordSequence !== null ||
      record.previousLifetimeRecordRawSha256 !==
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
    )
      fail(`${label} normal predecessor changed`);
  } else if (
    record.previousLifetimeEpochSha256 === null ||
    record.previousLifetimeRecordSequence === null ||
    record.previousLifetimeRecordRawSha256 ===
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
  ) {
    fail(`${label} reboot predecessor is partial`);
  }
  const normalized = canonicalIdentity(record);
  if (normalized.identitySha256 !== record.identitySha256)
    fail(`${label}.identitySha256 changed`);
  return normalized;
}

function descriptorSchema(kind, recordType) {
  return `oxigraph.candidate-containment-guardian-lifetime-${kind}/${recordType.toLowerCase().replaceAll("_", "-")}/v1`;
}

function bindingSha256(kind, context, descriptor) {
  return canonicalSha256(
    nullRecord([
      [
        "schema",
        `oxigraph.candidate-containment-guardian-lifetime-${kind}-binding/v1`,
      ],
      ["kind", kind],
      ["artifactSchema", descriptor.schema],
      ["sequence", context.sequence],
      ["recordType", context.recordType],
      ["lifetimeIdentitySha256", context.lifetimeIdentity.identitySha256],
      ["writerKind", context.writerKind],
      ["writerActorEpochSha256", context.writerActorEpochSha256],
      ["targetSha256", context.targetSha256],
      ["rawSha256", descriptor.rawSha256],
      ["semanticSha256", descriptor.semanticSha256],
    ]),
  );
}

function descriptorFromBytes(kind, context, bytes, value) {
  const descriptor = nullRecord([
    ["schema", descriptorSchema(kind, context.recordType)],
    ["rawSha256", sha256(bytes)],
    ["semanticSha256", canonicalSha256(value)],
    ["bytesBase64", bytes.toString("base64")],
  ]);
  return deepFreeze(
    nullRecord([
      ...DESCRIPTOR_FIELDS.slice(0, -1).map((field) => [
        field,
        descriptor[field],
      ]),
      ["bindingSha256", bindingSha256(kind, context, descriptor)],
    ]),
  );
}

function normalizeDescriptor(value, kind, context, label) {
  const record = exactRecord(value, DESCRIPTOR_FIELDS, label, fail);
  if (record.schema !== descriptorSchema(kind, context.recordType))
    fail(`${label}.schema changed`);
  exactDigest(record.rawSha256, `${label}.rawSha256`, fail);
  exactDigest(record.semanticSha256, `${label}.semanticSha256`, fail);
  exactDigest(record.bindingSha256, `${label}.bindingSha256`, fail);
  if (
    typeof record.bytesBase64 !== "string" ||
    !BASE64.test(record.bytesBase64)
  )
    fail(`${label}.bytesBase64 is not canonical padded base64`);
  let bytes;
  try {
    bytes = Buffer.from(record.bytesBase64, "base64");
  } catch {
    fail(`${label}.bytesBase64 cannot be decoded`);
  }
  if (bytes.toString("base64") !== record.bytesBase64)
    fail(`${label}.bytesBase64 changed`);
  const decoded = decodeLifetimeJsonLine(
    bytes,
    `${label} bytes`,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
  );
  if (
    sha256(decoded.bytes) !== record.rawSha256 ||
    canonicalSha256(decoded.value) !== record.semanticSha256
  )
    fail(`${label} digest changed`);
  const normalized = descriptorFromBytes(
    kind,
    context,
    decoded.bytes,
    decoded.value,
  );
  if (normalized.bindingSha256 !== record.bindingSha256)
    fail(`${label}.bindingSha256 changed`);
  return { descriptor: normalized, value: decoded.value, bytes: decoded.bytes };
}

function artifactFromRecord(name, bytes, value, rawSha256, semanticSha256) {
  const artifact = frozenCopyOnReadBytes(bytes, [
    ["name", name],
    ["rawSha256", rawSha256],
    ["semanticSha256", semanticSha256],
    ["schema", value.schema],
    ["sequence", value.sequence],
    ["recordType", value.recordType],
    ["previousRecordRawSha256", value.previousRecordRawSha256],
    ["lifetimeIdentity", value.lifetimeIdentity],
    ["writerKind", value.writerKind],
    ["writerActorEpochSha256", value.writerActorEpochSha256],
    ["targetSha256", value.targetSha256],
    ["operation", value.operation],
    ["evidence", value.evidence],
    ["standaloneRecordHashChainValidated", false],
    ["recordGrammarValidated", false],
    ["embeddedArtifactBindingsValidated", true],
  ]);
  recordArtifacts.add(artifact);
  return artifact;
}

function normalizeRecordReference(value, label) {
  if (value !== null && typeof value === "object" && recordArtifacts.has(value))
    return value;
  return verifyCandidateContainmentGuardianLifetimeRecordV1(
    exactRecord(value, RECORD_REFERENCE_FIELDS, label, fail),
  );
}

export function verifyCandidateContainmentGuardianLifetimeRecordV1(input) {
  const reference = exactRecord(
    input,
    RECORD_REFERENCE_FIELDS,
    "record reference",
    fail,
  );
  if (typeof reference.name !== "string") fail("record name is not text");
  const match = RECORD_FILENAME.exec(reference.name);
  if (match === null) fail("record name is not exact");
  const nameSequence = exactSequence(match[1], "record name sequence");
  const decoded = decodeLifetimeJsonLine(
    reference.bytes,
    "record bytes",
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORD_BYTES_V1,
  );
  const rawSha256 = sha256(decoded.bytes);
  if (rawSha256 !== match[2]) fail("record filename hash changed");
  const record = exactRecord(decoded.value, RECORD_FIELDS, "record", fail);
  if (
    record.schema !== CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_SCHEMA_V1
  )
    fail("record.schema changed");
  const sequenceNumber = exactSequence(record.sequence, "record.sequence");
  if (sequenceNumber !== nameSequence)
    fail("record sequence does not match filename");
  exactOneOf(
    record.recordType,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_TYPES_V1,
    "record.recordType",
  );
  exactDigest(
    record.previousRecordRawSha256,
    "record.previousRecordRawSha256",
    fail,
  );
  if (
    sequenceNumber === 1 &&
    record.previousRecordRawSha256 !==
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
  )
    fail("record genesis changed");
  const lifetimeIdentity = normalizeIdentity(
    record.lifetimeIdentity,
    "record.lifetimeIdentity",
  );
  exactOneOf(
    record.writerKind,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_WRITER_KINDS_V1,
    "record.writerKind",
  );
  exactDigest(
    record.writerActorEpochSha256,
    "record.writerActorEpochSha256",
    fail,
  );
  const targetSha256 =
    record.targetSha256 === null
      ? null
      : exactDigest(record.targetSha256, "record.targetSha256", fail);
  const context = {
    sequence: record.sequence,
    recordType: record.recordType,
    lifetimeIdentity,
    writerKind: record.writerKind,
    writerActorEpochSha256: record.writerActorEpochSha256,
    targetSha256,
  };
  const operation = normalizeDescriptor(
    record.operation,
    "operation",
    context,
    "record.operation",
  );
  const evidence = normalizeDescriptor(
    record.evidence,
    "evidence",
    context,
    "record.evidence",
  );
  const normalized = deepFreeze(
    nullRecord([
      ["schema", record.schema],
      ["sequence", record.sequence],
      ["recordType", record.recordType],
      ["previousRecordRawSha256", record.previousRecordRawSha256],
      ["lifetimeIdentity", lifetimeIdentity],
      ["writerKind", record.writerKind],
      ["writerActorEpochSha256", record.writerActorEpochSha256],
      ["targetSha256", targetSha256],
      ["operation", operation.descriptor],
      ["evidence", evidence.descriptor],
    ]),
  );
  const semanticSha256 = canonicalSha256(normalized);
  return artifactFromRecord(
    reference.name,
    decoded.bytes,
    normalized,
    rawSha256,
    semanticSha256,
  );
}

function decodedArtifactValue(record, kind) {
  const bytes = Buffer.from(record[kind].bytesBase64, "base64");
  return JSON.parse(bytes.toString("utf8"));
}

const CONTEXT_FIELDS = Object.freeze([
  "schema",
  "lifetimeIdentitySha256",
  "stateRootIdentitySha256",
  "bootIdSha256",
  "delegatedRootIdentitySha256",
  "lifetimeCgroupIdentitySha256",
  "contextSha256",
]);
const NO_CHILD_FIELDS = Object.freeze([
  "schema",
  "lifetimeIdentitySha256",
  "targetSha256",
  "launchRecordRawSha256",
  "syscall",
  "resultClass",
  "errnoName",
  "reportedChildCreated",
  "reportedPidfdReturned",
  "projectionSha256",
]);
const PARTIAL_LAUNCH_FIELDS = Object.freeze([
  "schema",
  "lifetimeIdentitySha256",
  "targetSha256",
  "launchRecordRawSha256",
  "reportedStateRootLockReacquired",
  "reportedPriorManagerAbsent",
  "reportedLifetimeCgroupIdentitySha256",
  "reportedLifetimeCgroupEmpty",
  "projectionSha256",
]);
const TARGET_PROJECTION_FIELDS = Object.freeze([
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
const TARGET_INVENTORY_FIELDS = Object.freeze([
  "schema",
  "targetSha256",
  "reportedRecoveryDirectoryPresent",
  "reportedRecoveryDirectoryEntryCount",
  "reportedExistingLifetimeTargetHead",
  "inventorySha256",
]);
const TARGET_EVENT_FIELDS = Object.freeze([
  "schema",
  "recoveryTargetProjection",
  "targetGenesisInventory",
  "provedRebootTransitions",
  "eventSha256",
]);
const TRANSITION_FIELDS = Object.freeze([
  "schema",
  "targetSha256",
  "previousBootIdSha256",
  "previousDelegatedRootIdentitySha256",
  "previousSegmentConfigured",
  "previousLifetimeCgroupIdentitySha256",
  "previousLifetimeEpochSha256",
  "previousLifetimeRecordRawSha256",
  "currentBootIdSha256",
  "currentDelegatedRootIdentitySha256",
  "currentSegmentConfigured",
  "currentLifetimeCgroupIdentitySha256",
  "currentLifetimeEpochSha256",
  "reportedPreviousLifetimeCgroupAbsent",
  "reportedControlCgroupAbsent",
  "reportedJobCgroupAbsent",
  "transitionSha256",
]);
const TRANSITION_EVENT_FIELDS = Object.freeze([
  "schema",
  "targetSha256",
  "transitions",
  "eventSha256",
]);
const ANCHOR_PROJECTION_FIELDS = Object.freeze([
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
const ANCHOR_EVENT_FIELDS = Object.freeze([
  "schema",
  "predecessorExternalHead",
  "anchorProjection",
  "eventSha256",
]);
const EXTERNAL_HEAD_FIELDS = Object.freeze([
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
const CLOSE_RECEIPT_FIELDS = Object.freeze([
  "schema",
  "targetSha256",
  "sourceLocation",
  "destinationLocation",
  "activeParentSynced",
  "closedParentSynced",
  "closedLocationReobserved",
]);

function exactLiteral(value, expected, label) {
  if (value !== expected) fail(`${label} changed`);
  return value;
}

function normalizedDigestRecord(record, fields, digestField) {
  const prefix = nullRecord(
    fields
      .filter((field) => field !== digestField)
      .map((field) => [field, record[field]]),
  );
  if (record[digestField] !== canonicalSha256(prefix)) {
    fail(`${digestField} changed`);
  }
  return deepFreeze(nullRecord(fields.map((field) => [field, record[field]])));
}

function normalizeContext(value, identity, label) {
  const record = exactRecord(value, CONTEXT_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_CONTEXT_SCHEMA_V1,
    `${label}.schema`,
  );
  for (const field of CONTEXT_FIELDS.slice(1)) {
    exactDigest(record[field], `${label}.${field}`, fail);
  }
  for (const [field, expected] of [
    ["lifetimeIdentitySha256", identity.identitySha256],
    ["stateRootIdentitySha256", identity.stateRootIdentitySha256],
    ["bootIdSha256", identity.bootIdSha256],
    ["delegatedRootIdentitySha256", identity.delegatedRootIdentitySha256],
  ]) {
    if (record[field] !== expected) fail(`${label}.${field} changed`);
  }
  return normalizedDigestRecord(record, CONTEXT_FIELDS, "contextSha256");
}

function normalizeNoChild(value, { identity, targetSha256, launchRaw }, label) {
  const record = exactRecord(value, NO_CHILD_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_LAUNCH_FAILURE_SCHEMA_V1,
    `${label}.schema`,
  );
  exactDigest(
    record.lifetimeIdentitySha256,
    `${label}.lifetimeIdentitySha256`,
    fail,
  );
  exactDigest(
    record.launchRecordRawSha256,
    `${label}.launchRecordRawSha256`,
    fail,
  );
  exactDigest(record.projectionSha256, `${label}.projectionSha256`, fail);
  if (record.targetSha256 !== null)
    exactDigest(record.targetSha256, `${label}.targetSha256`, fail);
  if (
    record.lifetimeIdentitySha256 !== identity.identitySha256 ||
    record.targetSha256 !== targetSha256 ||
    record.launchRecordRawSha256 !== launchRaw
  )
    fail(`${label} launch binding changed`);
  exactLiteral(record.syscall, "clone3", `${label}.syscall`);
  exactLiteral(record.resultClass, "DEFINITE_NO_CHILD", `${label}.resultClass`);
  exactOneOf(
    record.errnoName,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_ERRNO_NAMES_V1,
    `${label}.errnoName`,
  );
  exactLiteral(
    record.reportedChildCreated,
    false,
    `${label}.reportedChildCreated`,
  );
  exactLiteral(
    record.reportedPidfdReturned,
    false,
    `${label}.reportedPidfdReturned`,
  );
  return normalizedDigestRecord(record, NO_CHILD_FIELDS, "projectionSha256");
}

function normalizePartialLaunch(
  value,
  { identity, targetSha256, launchRaw, context },
  label,
) {
  const record = exactRecord(value, PARTIAL_LAUNCH_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PARTIAL_LAUNCH_RESOLUTION_SCHEMA_V1,
    `${label}.schema`,
  );
  for (const field of [
    "lifetimeIdentitySha256",
    "launchRecordRawSha256",
    "reportedLifetimeCgroupIdentitySha256",
    "projectionSha256",
  ])
    exactDigest(record[field], `${label}.${field}`, fail);
  if (record.targetSha256 !== null)
    exactDigest(record.targetSha256, `${label}.targetSha256`, fail);
  if (
    record.lifetimeIdentitySha256 !== identity.identitySha256 ||
    record.targetSha256 !== targetSha256 ||
    record.launchRecordRawSha256 !== launchRaw ||
    record.reportedLifetimeCgroupIdentitySha256 !==
      context.lifetimeCgroupIdentitySha256
  )
    fail(`${label} launch binding changed`);
  for (const field of [
    "reportedStateRootLockReacquired",
    "reportedPriorManagerAbsent",
    "reportedLifetimeCgroupEmpty",
  ])
    exactLiteral(record[field], true, `${label}.${field}`);
  return normalizedDigestRecord(
    record,
    PARTIAL_LAUNCH_FIELDS,
    "projectionSha256",
  );
}

function normalizeExternalHead(value, label) {
  const record = exactRecord(value, EXTERNAL_HEAD_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1,
    `${label}.schema`,
  );
  exactDigest(record.targetSha256, `${label}.targetSha256`, fail);
  exactOneOf(
    record.result,
    [
      "NO_RECOVERY_ATTEMPT",
      "ANCHORED_EMPTY_ATTEMPT",
      "FINALIZED_ATTEMPT_PREFIX",
      "RECOVERED",
      "QUARANTINED",
    ],
    `${label}.result`,
  );
  for (const field of [
    "recoveryActorEpochSha256",
    "attemptDirectoryName",
    "lifetimeAttemptAnchorRawSha256",
  ]) {
    if (record[field] !== null)
      exactDigest(record[field], `${label}.${field}`, fail);
  }
  if (record.latestRecoveryRecordSequence !== null) {
    exactSequence(
      record.latestRecoveryRecordSequence,
      `${label}.latestRecoveryRecordSequence`,
      24,
    );
  }
  exactDigest(
    record.latestRecoveryRecordRawSha256,
    `${label}.latestRecoveryRecordRawSha256`,
    fail,
  );
  exactDigest(record.externalHeadSha256, `${label}.externalHeadSha256`, fail);
  const noAttempt = record.result === "NO_RECOVERY_ATTEMPT";
  const empty = record.result === "ANCHORED_EMPTY_ATTEMPT";
  if (noAttempt) {
    if (
      record.recoveryActorEpochSha256 !== null ||
      record.attemptDirectoryName !== null ||
      record.lifetimeAttemptAnchorRawSha256 !== null ||
      record.latestRecoveryRecordSequence !== null ||
      record.latestRecoveryRecordRawSha256 !==
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
    )
      fail(`${label} no-attempt tuple changed`);
  } else {
    if (
      record.recoveryActorEpochSha256 === null ||
      record.attemptDirectoryName === null ||
      record.lifetimeAttemptAnchorRawSha256 === null ||
      record.attemptDirectoryName !== record.recoveryActorEpochSha256
    )
      fail(`${label} attempt tuple changed`);
    if (empty) {
      if (
        record.latestRecoveryRecordSequence !== null ||
        record.latestRecoveryRecordRawSha256 !==
          CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
      )
        fail(`${label} anchored-empty tuple changed`);
    } else if (
      record.latestRecoveryRecordSequence === null ||
      record.latestRecoveryRecordRawSha256 ===
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
    )
      fail(`${label} finalized tuple changed`);
  }
  return normalizedDigestRecord(
    record,
    EXTERNAL_HEAD_FIELDS,
    "externalHeadSha256",
  );
}

function normalizeTransition(value, label) {
  const record = exactRecord(value, TRANSITION_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_SCHEMA_V1,
    `${label}.schema`,
  );
  for (const field of [
    "targetSha256",
    "previousBootIdSha256",
    "previousDelegatedRootIdentitySha256",
    "previousLifetimeEpochSha256",
    "previousLifetimeRecordRawSha256",
    "currentBootIdSha256",
    "currentDelegatedRootIdentitySha256",
    "currentLifetimeEpochSha256",
    "transitionSha256",
  ])
    exactDigest(record[field], `${label}.${field}`, fail);
  for (const [flag, identityField] of [
    ["previousSegmentConfigured", "previousLifetimeCgroupIdentitySha256"],
    ["currentSegmentConfigured", "currentLifetimeCgroupIdentitySha256"],
  ]) {
    if (typeof record[flag] !== "boolean") fail(`${label}.${flag} changed`);
    if (record[flag])
      exactDigest(record[identityField], `${label}.${identityField}`, fail);
    else exactLiteral(record[identityField], null, `${label}.${identityField}`);
  }
  for (const field of [
    "reportedPreviousLifetimeCgroupAbsent",
    "reportedControlCgroupAbsent",
    "reportedJobCgroupAbsent",
  ])
    exactLiteral(record[field], true, `${label}.${field}`);
  if (
    record.previousBootIdSha256 === record.currentBootIdSha256 ||
    record.previousLifetimeEpochSha256 === record.currentLifetimeEpochSha256
  )
    fail(`${label} does not cross a fresh boot and lifetime`);
  return normalizedDigestRecord(record, TRANSITION_FIELDS, "transitionSha256");
}

function normalizeTargetProjection(value, label) {
  const record = exactRecord(value, TARGET_PROJECTION_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1,
    `${label}.schema`,
  );
  for (const field of [
    "generationIdentitySha256",
    "generationManifestRawSha256",
    "targetSha256",
    "targetBootIdSha256",
    "targetDelegatedRootIdentitySha256",
    "targetLifetimeEpochSha256",
    "projectionSha256",
  ])
    exactDigest(record[field], `${label}.${field}`, fail);
  const headFields = [
    "latestBundleSequence",
    "latestBundleRawSha256",
    "latestInnerRecordRawSha256",
    "latestNormalState",
  ];
  const allNull = headFields.every((field) => record[field] === null);
  const allPresent = headFields.every((field) => record[field] !== null);
  if (!allNull && !allPresent) fail(`${label} normal head tuple is partial`);
  if (allPresent) {
    exactSequence(
      record.latestBundleSequence,
      `${label}.latestBundleSequence`,
      18,
    );
    exactDigest(
      record.latestBundleRawSha256,
      `${label}.latestBundleRawSha256`,
      fail,
    );
    exactDigest(
      record.latestInnerRecordRawSha256,
      `${label}.latestInnerRecordRawSha256`,
      fail,
    );
    if (
      typeof record.latestNormalState !== "string" ||
      record.latestNormalState.length === 0
    )
      fail(`${label}.latestNormalState changed`);
  }
  return normalizedDigestRecord(
    record,
    TARGET_PROJECTION_FIELDS,
    "projectionSha256",
  );
}

function normalizeTargetInventory(value, targetSha256, label) {
  const record = exactRecord(value, TARGET_INVENTORY_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_INVENTORY_SCHEMA_V1,
    `${label}.schema`,
  );
  exactDigest(record.targetSha256, `${label}.targetSha256`, fail);
  exactDigest(record.inventorySha256, `${label}.inventorySha256`, fail);
  exactLiteral(record.targetSha256, targetSha256, `${label}.targetSha256`);
  exactLiteral(
    record.reportedRecoveryDirectoryPresent,
    true,
    `${label}.reportedRecoveryDirectoryPresent`,
  );
  exactLiteral(
    record.reportedRecoveryDirectoryEntryCount,
    0,
    `${label}.reportedRecoveryDirectoryEntryCount`,
  );
  exactLiteral(
    record.reportedExistingLifetimeTargetHead,
    false,
    `${label}.reportedExistingLifetimeTargetHead`,
  );
  return normalizedDigestRecord(
    record,
    TARGET_INVENTORY_FIELDS,
    "inventorySha256",
  );
}

function normalizeTransitionEvent(value, label, { minimum = 1 } = {}) {
  const record = exactRecord(value, TRANSITION_EVENT_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_CHAIN_EVENT_SCHEMA_V1,
    `${label}.schema`,
  );
  exactDigest(record.targetSha256, `${label}.targetSha256`, fail);
  exactDigest(record.eventSha256, `${label}.eventSha256`, fail);
  const entries = exactDenseArray(
    record.transitions,
    `${label}.transitions`,
    4,
    fail,
  );
  if (entries.length < minimum) fail(`${label}.transitions is empty`);
  const transitions = Object.freeze(
    entries.map((entry, index) =>
      normalizeTransition(entry, `${label}.transitions[${index}]`),
    ),
  );
  const normalized = nullRecord([
    ["schema", record.schema],
    ["targetSha256", record.targetSha256],
    ["transitions", transitions],
  ]);
  if (record.eventSha256 !== canonicalSha256(normalized))
    fail(`${label}.eventSha256 changed`);
  return deepFreeze(
    nullRecord([
      ...TRANSITION_EVENT_FIELDS.slice(0, -1).map((field) => [
        field,
        normalized[field],
      ]),
      ["eventSha256", record.eventSha256],
    ]),
  );
}

function normalizeTargetEvent(value, label) {
  const record = exactRecord(value, TARGET_EVENT_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_EVENT_SCHEMA_V1,
    `${label}.schema`,
  );
  exactDigest(record.eventSha256, `${label}.eventSha256`, fail);
  const projection = normalizeTargetProjection(
    record.recoveryTargetProjection,
    `${label}.recoveryTargetProjection`,
  );
  const inventory = normalizeTargetInventory(
    record.targetGenesisInventory,
    projection.targetSha256,
    `${label}.targetGenesisInventory`,
  );
  const entries = exactDenseArray(
    record.provedRebootTransitions,
    `${label}.provedRebootTransitions`,
    4,
    fail,
  );
  const transitions = Object.freeze(
    entries.map((entry, index) =>
      normalizeTransition(entry, `${label}.provedRebootTransitions[${index}]`),
    ),
  );
  const normalized = nullRecord([
    ["schema", record.schema],
    ["recoveryTargetProjection", projection],
    ["targetGenesisInventory", inventory],
    ["provedRebootTransitions", transitions],
  ]);
  if (record.eventSha256 !== canonicalSha256(normalized))
    fail(`${label}.eventSha256 changed`);
  return deepFreeze(
    nullRecord([
      ...TARGET_EVENT_FIELDS.slice(0, -1).map((field) => [
        field,
        normalized[field],
      ]),
      ["eventSha256", record.eventSha256],
    ]),
  );
}

function normalizeAnchorProjection(value, label) {
  const record = exactRecord(value, ANCHOR_PROJECTION_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1,
    `${label}.schema`,
  );
  exactOneOf(
    record.actorKind,
    ["LIVE_BIRTH_GUARDIAN", "RECOVERY_ONLY_GUARDIAN"],
    `${label}.actorKind`,
  );
  for (const field of [
    "targetSha256",
    "recoveryActorEpochSha256",
    "attemptDirectoryName",
    "expectedStateRootIdentitySha256",
    "expectedCurrentBootIdSha256",
    "expectedDelegatedRootIdentitySha256",
    "expectedLifetimeCgroupIdentitySha256",
    "previousRecoveryRecordRawSha256",
  ])
    exactDigest(record[field], `${label}.${field}`, fail);
  if (record.attemptDirectoryName !== record.recoveryActorEpochSha256)
    fail(`${label}.attemptDirectoryName changed`);
  const predecessorNullable = [
    "previousRecoveryActorEpochSha256",
    "previousAttemptDirectoryName",
    "previousRecoveryRecordSequence",
  ];
  for (const field of predecessorNullable.slice(0, 2))
    if (record[field] !== null)
      exactDigest(record[field], `${label}.${field}`, fail);
  if (record.previousRecoveryRecordSequence !== null)
    exactSequence(
      record.previousRecoveryRecordSequence,
      `${label}.previousRecoveryRecordSequence`,
      24,
    );
  const actorDirectoryBothNull =
    record.previousRecoveryActorEpochSha256 === null &&
    record.previousAttemptDirectoryName === null;
  const actorDirectoryBothPresent =
    record.previousRecoveryActorEpochSha256 !== null &&
    record.previousAttemptDirectoryName !== null;
  if (!actorDirectoryBothNull && !actorDirectoryBothPresent)
    fail(`${label} predecessor actor tuple is partial`);
  if (
    actorDirectoryBothPresent &&
    record.previousRecoveryActorEpochSha256 !==
      record.previousAttemptDirectoryName
  )
    fail(`${label} predecessor directory changed`);
  if (
    actorDirectoryBothNull &&
    (record.previousRecoveryRecordSequence !== null ||
      record.previousRecoveryRecordRawSha256 !==
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1)
  )
    fail(`${label} genesis predecessor changed`);
  if (
    record.previousRecoveryRecordSequence === null &&
    record.previousRecoveryRecordRawSha256 !==
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
  )
    fail(`${label} empty predecessor changed`);
  if (
    record.previousRecoveryRecordSequence !== null &&
    record.previousRecoveryRecordRawSha256 ===
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1
  )
    fail(`${label} nonempty predecessor changed`);
  return deepFreeze(
    nullRecord(ANCHOR_PROJECTION_FIELDS.map((field) => [field, record[field]])),
  );
}

function normalizeAnchorEvent(value, label) {
  const record = exactRecord(value, ANCHOR_EVENT_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_EVENT_SCHEMA_V1,
    `${label}.schema`,
  );
  exactDigest(record.eventSha256, `${label}.eventSha256`, fail);
  const predecessor = normalizeExternalHead(
    record.predecessorExternalHead,
    `${label}.predecessorExternalHead`,
  );
  const projection = normalizeAnchorProjection(
    record.anchorProjection,
    `${label}.anchorProjection`,
  );
  const normalized = nullRecord([
    ["schema", record.schema],
    ["predecessorExternalHead", predecessor],
    ["anchorProjection", projection],
  ]);
  if (record.eventSha256 !== canonicalSha256(normalized))
    fail(`${label}.eventSha256 changed`);
  return deepFreeze(
    nullRecord([
      ...ANCHOR_EVENT_FIELDS.slice(0, -1).map((field) => [
        field,
        normalized[field],
      ]),
      ["eventSha256", record.eventSha256],
    ]),
  );
}

function normalizeCloseReceipt(value, targetSha256, label) {
  const record = exactRecord(value, CLOSE_RECEIPT_FIELDS, label, fail);
  exactLiteral(
    record.schema,
    CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1,
    `${label}.schema`,
  );
  exactDigest(record.targetSha256, `${label}.targetSha256`, fail);
  exactLiteral(record.targetSha256, targetSha256, `${label}.targetSha256`);
  exactLiteral(record.sourceLocation, "active", `${label}.sourceLocation`);
  exactLiteral(
    record.destinationLocation,
    "closed",
    `${label}.destinationLocation`,
  );
  for (const field of [
    "activeParentSynced",
    "closedParentSynced",
    "closedLocationReobserved",
  ])
    exactLiteral(record[field], true, `${label}.${field}`);
  return deepFreeze(
    nullRecord(CLOSE_RECEIPT_FIELDS.map((field) => [field, record[field]])),
  );
}

function createState() {
  return {
    segments: [],
    targets: new Map(),
    generations: new Map(),
    usedActors: new Set(),
    usedDirectories: new Set(),
    usedAnchorRawSha256: new Set(),
    globalCount: 0,
    recordCount: 0,
  };
}

function cloneState(source) {
  const state = createState();
  state.globalCount = source.globalCount;
  state.recordCount = source.recordCount;
  state.usedActors = new Set(source.usedActors);
  state.usedDirectories = new Set(source.usedDirectories);
  state.usedAnchorRawSha256 = new Set(source.usedAnchorRawSha256);
  state.segments = source.segments.map((segment) => ({
    ...segment,
    records: [...segment.records],
    guardian: { ...segment.guardian },
  }));
  for (const [digest, original] of source.targets) {
    const target = {
      ...original,
      attempts: original.attempts.map((attempt) => ({ ...attempt })),
    };
    state.targets.set(digest, target);
    state.generations.set(target.projection.generationIdentitySha256, target);
  }
  return state;
}

function newSegment(identity) {
  return {
    identity,
    index: -1,
    records: [],
    epoch: false,
    createIntent: false,
    context: null,
    guardian: {
      launchRaw: null,
      notCreated: false,
      pidfd: false,
      exec: false,
      membership: false,
      adopted: false,
      termination: false,
      resolution: null,
    },
    removalIntent: false,
    pathAbsent: false,
    closed: false,
  };
}

function currentSegment(state) {
  return state.segments.at(-1);
}

function currentAttempt(target) {
  return target.attempts.at(-1) ?? null;
}

function requireManager(record, segment) {
  if (
    record.writerKind !== "SERVICE_MANAGER" ||
    record.writerActorEpochSha256 !== segment.identity.managerActorEpochSha256
  )
    fail(`${record.recordType} writer is not the service manager`);
}

function requireTarget(record, required) {
  if ((record.targetSha256 !== null) !== required) {
    fail(`${record.recordType} target nullability changed`);
  }
}

function segmentTailRaw(segment) {
  return segment.records.at(-1)?.rawSha256 ?? null;
}

function knownActorEpoch(state, digest) {
  if (state.usedActors.has(digest)) return true;
  for (const segment of state.segments) {
    if (
      segment.identity.managerActorEpochSha256 === digest ||
      segment.identity.lifetimeEpochSha256 === digest
    )
      return true;
  }
  for (const target of state.targets.values()) {
    if (target.projection.targetLifetimeEpochSha256 === digest) return true;
  }
  return false;
}

function validateIdentityActorEpochBoundary(identity, state) {
  if (
    identity.lifetimeKind === "NORMAL" &&
    identity.managerActorEpochSha256 === identity.lifetimeEpochSha256
  )
    fail("normal manager and lifetime epochs are not distinct");
  if (
    identity.lifetimeKind === "REBOOT_RECOVERY" &&
    knownActorEpoch(state, identity.lifetimeEpochSha256)
  )
    fail("successor lifetime epoch reused an actor or epoch");
  return identity;
}

function validateSuccessorIdentity(identity, state) {
  const previous = currentSegment(state);
  if (previous === undefined || previous.records.length === 0) {
    fail("reboot identity has no predecessor record");
  }
  if (previous.removalIntent || previous.pathAbsent || previous.closed) {
    fail("reboot identity follows lifetime removal");
  }
  if (identity.lifetimeKind !== "REBOOT_RECOVERY") {
    fail("successor identity is not reboot recovery");
  }
  for (const field of [
    "stateRootIdentitySha256",
    "managerActorEpochSha256",
    "limitsSha256",
    "guardianExecutableIdentitySha256",
    "guardianControlRequirementsSha256",
  ]) {
    if (identity[field] !== previous.identity[field]) {
      fail(`successor identity.${field} changed`);
    }
  }
  if (identity.bootIdSha256 === previous.identity.bootIdSha256)
    fail("successor identity did not change boot");
  if (
    identity.previousLifetimeEpochSha256 !==
      previous.identity.lifetimeEpochSha256 ||
    identity.previousLifetimeRecordSequence !==
      previous.records.at(-1).sequence ||
    identity.previousLifetimeRecordRawSha256 !== segmentTailRaw(previous)
  )
    fail("successor identity predecessor changed");
}

function addSegment(state, identity) {
  if (
    state.segments.length >=
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEGMENTS_V1
  ) {
    fail("lifetime segment ceiling exceeded");
  }
  if (state.segments.length === 0) {
    if (identity.lifetimeKind !== "NORMAL")
      fail("first identity is not normal");
  } else validateSuccessorIdentity(identity, state);
  validateIdentityActorEpochBoundary(identity, state);
  const segment = newSegment(identity);
  segment.index = state.segments.length;
  state.segments.push(segment);
  return segment;
}

function validateTransitionChain(
  state,
  targetSha256,
  transitions,
  startIndex,
  endIndex,
  label,
) {
  if (
    !Number.isSafeInteger(startIndex) ||
    startIndex < 0 ||
    endIndex <= startIndex ||
    transitions.length !== endIndex - startIndex
  )
    fail(`${label} does not cover every intervening segment`);
  for (const [offset, transition] of transitions.entries()) {
    const previous = state.segments[startIndex + offset];
    const current = state.segments[startIndex + offset + 1];
    const expected = {
      targetSha256,
      previousBootIdSha256: previous.identity.bootIdSha256,
      previousDelegatedRootIdentitySha256:
        previous.identity.delegatedRootIdentitySha256,
      previousSegmentConfigured: previous.context !== null,
      previousLifetimeCgroupIdentitySha256:
        previous.context?.lifetimeCgroupIdentitySha256 ?? null,
      previousLifetimeEpochSha256: previous.identity.lifetimeEpochSha256,
      previousLifetimeRecordRawSha256: segmentTailRaw(previous),
      currentBootIdSha256: current.identity.bootIdSha256,
      currentDelegatedRootIdentitySha256:
        current.identity.delegatedRootIdentitySha256,
      currentSegmentConfigured: current.context !== null,
      currentLifetimeCgroupIdentitySha256:
        current.context?.lifetimeCgroupIdentitySha256 ?? null,
      currentLifetimeEpochSha256: current.identity.lifetimeEpochSha256,
    };
    for (const [field, value] of Object.entries(expected)) {
      if (transition[field] !== value)
        fail(`${label}[${offset}].${field} changed`);
    }
  }
  if (!state.segments[endIndex].context)
    fail(`${label} does not end configured`);
}

function locateTransitionOrigin(state, transitions, label) {
  if (transitions.length === 0) return currentSegment(state).index;
  const first = transitions[0];
  const index = state.segments.findIndex(
    (segment) =>
      segment.identity.bootIdSha256 === first.previousBootIdSha256 &&
      segment.identity.lifetimeEpochSha256 ===
        first.previousLifetimeEpochSha256,
  );
  if (index === -1) fail(`${label} origin is unknown`);
  return index;
}

function normalResolved(state) {
  const normal = state.segments[0];
  return Boolean(normal?.guardian.notCreated || normal?.guardian.resolution);
}

function segmentSuperseded(state, segmentIndex) {
  for (
    let index = segmentIndex + 1;
    index < state.segments.length;
    index += 1
  ) {
    if (state.segments[index].context !== null) return true;
  }
  return false;
}

function normalSuperseded(state) {
  return state.segments.length > 1 && segmentSuperseded(state, 0);
}

function targetSuperseded(target, attempt) {
  return target.currentSegmentIndex > attempt.segmentIndex;
}

function openAttemptAllowsSuccessor(target) {
  const attempt = currentAttempt(target);
  if (attempt === null) return true;
  if (!attempt.result) return false;
  if (!attempt.launchRaw || attempt.notCreated || attempt.resolution)
    return true;
  return targetSuperseded(target, attempt);
}

function guardianProcessPhaseClosed(guardian) {
  return Boolean(guardian.termination || guardian.resolution);
}

function recoveryEarlyProcessPhaseClosed(attempt) {
  return Boolean(
    attempt.notCreated ||
    attempt.termination ||
    attempt.resolution ||
    attempt.result,
  );
}

function lifetimeRemovalEligible(state, segment) {
  for (const target of state.targets.values()) {
    if (!target.terminal || !openAttemptAllowsSuccessor(target)) return false;
  }
  return Boolean(
    segment.guardian.notCreated ||
    segment.guardian.resolution ||
    normalSuperseded(state),
  );
}

function normalizeGenesisTarget(
  state,
  segment,
  record,
  operationValue,
  evidenceValue,
) {
  const event = normalizeTargetEvent(operationValue, "target genesis event");
  const projection = event.recoveryTargetProjection;
  const head = normalizeExternalHead(
    evidenceValue,
    "target genesis external head",
  );
  if (
    record.targetSha256 !== projection.targetSha256 ||
    head.targetSha256 !== projection.targetSha256 ||
    head.result !== "NO_RECOVERY_ATTEMPT"
  )
    fail("target genesis values disagree");
  if (
    state.targets.has(projection.targetSha256) ||
    state.generations.has(projection.generationIdentitySha256)
  )
    fail("target or generation identity was reused");
  if (
    state.targets.size >= CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_TARGETS_V1
  ) {
    fail("target ceiling exceeded");
  }
  if (!segment.context) fail("target genesis has no configured context");
  const transitions = event.provedRebootTransitions;
  let originIndex = segment.index;
  if (segment.identity.lifetimeKind === "NORMAL") {
    if (transitions.length !== 0)
      fail("normal target genesis contains reboot transitions");
  } else {
    if (transitions.length === 0)
      fail("reboot target genesis omitted transitions");
    originIndex = locateTransitionOrigin(
      state,
      transitions,
      "target genesis transitions",
    );
    if (
      originIndex !== 0 ||
      state.segments[0].identity.lifetimeKind !== "NORMAL" ||
      state.segments[0].context === null
    )
      fail("reboot target genesis does not start at configured normal context");
    validateTransitionChain(
      state,
      projection.targetSha256,
      transitions,
      0,
      segment.index,
      "target genesis transitions",
    );
  }
  const origin = state.segments[originIndex].identity;
  for (const [field, expected] of [
    ["targetBootIdSha256", origin.bootIdSha256],
    ["targetDelegatedRootIdentitySha256", origin.delegatedRootIdentitySha256],
    ["targetLifetimeEpochSha256", origin.lifetimeEpochSha256],
  ])
    if (projection[field] !== expected)
      fail(`target projection.${field} changed`);
  const target = {
    projection,
    genesisRawSha256: record.rawSha256,
    currentSegmentIndex: segment.index,
    currentContext: segment.context,
    transitionCount: transitions.length,
    recordCount: 1,
    attempts: [],
    head,
    terminal: false,
    normalCloseReceipt: null,
    normalCloseReceiptRawSha256: null,
  };
  state.targets.set(projection.targetSha256, target);
  state.generations.set(projection.generationIdentitySha256, target);
  return target;
}

function applyTransition(state, segment, target, operationValue) {
  if (!segment.context || segment.identity.lifetimeKind !== "REBOOT_RECOVERY") {
    fail("target transition is not in a configured reboot segment");
  }
  if (target.currentSegmentIndex === segment.index)
    fail("target transition duplicated current segment");
  const event = normalizeTransitionEvent(
    operationValue,
    "target reboot transition event",
  );
  if (event.targetSha256 !== target.projection.targetSha256)
    fail("target transition target changed");
  if (
    target.transitionCount + event.transitions.length >
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_BOOT_TRANSITIONS_PER_TARGET_V1
  )
    fail("target transition ceiling exceeded");
  validateTransitionChain(
    state,
    target.projection.targetSha256,
    event.transitions,
    target.currentSegmentIndex,
    segment.index,
    "target reboot transitions",
  );
  target.transitionCount += event.transitions.length;
  target.currentSegmentIndex = segment.index;
  target.currentContext = segment.context;
}

function applyAnchor(state, segment, target, record, evidenceValue) {
  if (!segment.context || target.currentSegmentIndex !== segment.index)
    fail("anchor target has not caught up to current context");
  if (
    target.terminal ||
    target.attempts.length >=
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECOVERY_ATTEMPTS_PER_TARGET_V1 ||
    !openAttemptAllowsSuccessor(target)
  )
    fail("anchor cannot succeed current target state");
  const event = normalizeAnchorEvent(evidenceValue, "anchor event");
  const projection = event.anchorProjection;
  if (
    projection.targetSha256 !== target.projection.targetSha256 ||
    !sameValue(event.predecessorExternalHead, target.head)
  )
    fail("anchor predecessor changed");
  for (const [field, expected] of [
    [
      "expectedStateRootIdentitySha256",
      segment.identity.stateRootIdentitySha256,
    ],
    ["expectedCurrentBootIdSha256", segment.context.bootIdSha256],
    [
      "expectedDelegatedRootIdentitySha256",
      segment.context.delegatedRootIdentitySha256,
    ],
    [
      "expectedLifetimeCgroupIdentitySha256",
      segment.context.lifetimeCgroupIdentitySha256,
    ],
    ["previousRecoveryActorEpochSha256", target.head.recoveryActorEpochSha256],
    ["previousAttemptDirectoryName", target.head.attemptDirectoryName],
    [
      "previousRecoveryRecordSequence",
      target.head.latestRecoveryRecordSequence,
    ],
    [
      "previousRecoveryRecordRawSha256",
      target.head.latestRecoveryRecordRawSha256,
    ],
  ])
    if (projection[field] !== expected)
      fail(`anchor projection.${field} changed`);
  if (
    knownActorEpoch(state, projection.recoveryActorEpochSha256) ||
    state.usedDirectories.has(projection.attemptDirectoryName) ||
    state.usedAnchorRawSha256.has(record.rawSha256)
  )
    fail("anchor actor, directory, or raw record was reused");
  if (projection.actorKind === "LIVE_BIRTH_GUARDIAN") {
    const normal = state.segments[0];
    if (
      record.writerKind !== "LIVE_BIRTH_GUARDIAN" ||
      record.writerActorEpochSha256 !== projection.recoveryActorEpochSha256 ||
      !normal.guardian.adopted ||
      normal.guardian.termination ||
      normal.guardian.notCreated ||
      segment.index !== 0
    )
      fail("live-birth anchor writer is ineligible");
  } else {
    requireManager(record, segment);
    if (!normalResolved(state) && target.currentSegmentIndex === 0)
      fail("recovery-only anchor precedes normal resolution");
  }
  const attempt = {
    projection,
    anchorRawSha256: record.rawSha256,
    predecessorHead: target.head,
    segmentIndex: segment.index,
    launchRaw: null,
    notCreated: false,
    pidfd: false,
    exec: false,
    membership: false,
    result: null,
    termination: false,
    resolution: null,
  };
  target.attempts.push(attempt);
  state.usedActors.add(projection.recoveryActorEpochSha256);
  state.usedDirectories.add(projection.attemptDirectoryName);
  state.usedAnchorRawSha256.add(record.rawSha256);
}

function applyResult(state, segment, target, record, evidenceValue) {
  const attempt = currentAttempt(target);
  if (!attempt || attempt.result || target.terminal)
    fail("result has no open anchor");
  if (target.currentSegmentIndex !== segment.index) {
    fail("result target has not caught up to the current segment");
  }
  const head = normalizeExternalHead(evidenceValue, "recovery result head");
  if (
    head.targetSha256 !== target.projection.targetSha256 ||
    head.recoveryActorEpochSha256 !==
      attempt.projection.recoveryActorEpochSha256 ||
    head.attemptDirectoryName !== attempt.projection.attemptDirectoryName ||
    head.lifetimeAttemptAnchorRawSha256 !== attempt.anchorRawSha256 ||
    head.result === "NO_RECOVERY_ATTEMPT"
  )
    fail("recovery result head changed");
  const superseded = targetSuperseded(target, attempt);
  if (record.writerKind === "LIVE_BIRTH_GUARDIAN") {
    const normal = state.segments[0];
    if (
      attempt.projection.actorKind !== "LIVE_BIRTH_GUARDIAN" ||
      record.writerActorEpochSha256 !==
        attempt.projection.recoveryActorEpochSha256 ||
      !normal.guardian.adopted ||
      normal.guardian.termination ||
      superseded
    )
      fail("live-birth result writer is ineligible");
  } else if (record.writerKind === "RECOVERY_ONLY_GUARDIAN") {
    if (
      attempt.projection.actorKind !== "RECOVERY_ONLY_GUARDIAN" ||
      record.writerActorEpochSha256 !==
        attempt.projection.recoveryActorEpochSha256 ||
      !attempt.launchRaw ||
      !attempt.pidfd ||
      !attempt.exec ||
      !attempt.membership ||
      attempt.notCreated ||
      attempt.termination ||
      superseded
    )
      fail("recovery-only result writer is ineligible");
  } else {
    requireManager(record, segment);
    if (
      attempt.projection.actorKind === "RECOVERY_ONLY_GUARDIAN" &&
      (!attempt.launchRaw || attempt.notCreated)
    ) {
      if (head.result !== "ANCHORED_EMPTY_ATTEMPT")
        fail("manager direct result is not anchored empty");
    } else if (attempt.projection.actorKind === "LIVE_BIRTH_GUARDIAN") {
      if (!normalResolved(state) && !superseded)
        fail("manager live-birth result precedes actor resolution");
    } else if (!attempt.resolution && !superseded) {
      fail("manager recovery result precedes actor resolution");
    }
  }
  attempt.result = head;
  target.head = head;
  target.terminal =
    head.result === "RECOVERED" || head.result === "QUARANTINED";
}

function attemptRemaining(target, attempt) {
  if (!attempt) return 0;
  if (targetSuperseded(target, attempt)) return attempt.result ? 0 : 1;
  if (attempt.projection.actorKind === "LIVE_BIRTH_GUARDIAN")
    return attempt.result ? 0 : 7;
  if (!attempt.launchRaw) return attempt.result ? 0 : 7;
  if (attempt.notCreated) return attempt.result ? 0 : 1;
  let remaining = 0;
  if (!attempt.pidfd) remaining += 1;
  if (!attempt.exec) remaining += 1;
  if (!attempt.membership) remaining += 1;
  if (!attempt.result) remaining += 1;
  if (!attempt.termination) remaining += 2;
  else if (!attempt.resolution) remaining += 1;
  return remaining;
}

function normalSetupRemaining(segment) {
  if (!segment || segment.identity.lifetimeKind !== "NORMAL") {
    if (!segment?.epoch) return 3;
    if (!segment.createIntent) return 2;
    if (!segment.context) return 1;
    return 0;
  }
  if (!segment.epoch) return 8;
  if (!segment.createIntent) return 7;
  if (!segment.context) return 6;
  const guardian = segment.guardian;
  if (!guardian.launchRaw) return 5;
  if (guardian.notCreated || guardian.adopted) return 0;
  if (!guardian.pidfd) return 4;
  if (!guardian.exec) return 3;
  if (!guardian.membership) return 2;
  return 1;
}

function normalResolutionRemaining(state) {
  const normal = state.segments[0];
  if (
    !normal ||
    state.segments.length > 1 ||
    normal.guardian.notCreated ||
    normal.guardian.resolution
  )
    return 0;
  if (normal.guardian.termination) return 1;
  return 2;
}

function closeRemaining(segment) {
  if (segment.closed) return 0;
  if (segment.pathAbsent) return 1;
  if (segment.removalIntent) return 2;
  return 3;
}

function globalPotential(state) {
  const segment = currentSegment(state);
  const rebootCount = Math.max(0, state.segments.length - 1);
  const futureReboots =
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_BOOT_TRANSITIONS_PER_TARGET_V1 -
    rebootCount;
  return (
    state.globalCount +
    normalSetupRemaining(segment) +
    normalResolutionRemaining(state) +
    futureReboots * 3 +
    closeRemaining(segment)
  );
}

function targetPotential(target) {
  const attempt = currentAttempt(target);
  const futureAttempts = target.terminal
    ? 0
    : (CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECOVERY_ATTEMPTS_PER_TARGET_V1 -
        target.attempts.length) *
      8;
  const futureTransitions =
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_BOOT_TRANSITIONS_PER_TARGET_V1 -
    target.transitionCount;
  return (
    target.recordCount +
    attemptRemaining(target, attempt) +
    futureAttempts +
    futureTransitions
  );
}

function checkCapacity(state) {
  if (
    state.globalCount >
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_GLOBAL_RECORDS_V1 ||
    state.recordCount >
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_V1 ||
    state.targets.size > CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_TARGETS_V1
  )
    fail("semantic lifetime ceiling exceeded");
  const global = globalPotential(state);
  if (
    global >
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_GLOBAL_RECORDS_V1
  )
    fail("global closure reserve exhausted");
  let aggregate = global;
  for (const target of state.targets.values()) {
    const potential = targetPotential(target);
    if (
      target.recordCount >
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_PER_TARGET_V1 ||
      potential >
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_PER_TARGET_V1
    )
      fail("target closure reserve exhausted");
    aggregate += potential;
  }
  if (
    aggregate > CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_V1
  )
    fail("aggregate closure reserve exhausted");
}

function applyRecord(state, record, { capacity = true } = {}) {
  const segment = currentSegment(state);
  if (!segment || segment.closed) fail("record has no open segment");
  const expectedSequence = sequenceText(segment.records.length + 1);
  const expectedPrevious =
    segment.records.at(-1)?.rawSha256 ??
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1;
  if (
    record.sequence !== expectedSequence ||
    record.previousRecordRawSha256 !== expectedPrevious ||
    !sameValue(record.lifetimeIdentity, segment.identity)
  )
    fail("record chain or lifetime identity changed");
  if (segment.removalIntent) {
    const requiredSuffixRecord = segment.pathAbsent
      ? "LIFETIME_CLOSED_DURABLE"
      : "LIFETIME_PATH_ABSENT_OBSERVED";
    if (record.recordType !== requiredSuffixRecord)
      fail("lifetime removal suffix is not exact");
  }
  const operationValue = decodedArtifactValue(record, "operation");
  const evidenceValue = decodedArtifactValue(record, "evidence");
  const target =
    record.targetSha256 === null
      ? null
      : state.targets.get(record.targetSha256);
  const guardian = segment.guardian;
  switch (record.recordType) {
    case "NORMAL_LIFETIME_EPOCH_CONSUMED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        segment.index !== 0 ||
        segment.identity.lifetimeKind !== "NORMAL" ||
        segment.records.length !== 0
      )
        fail("normal epoch is not the genesis record");
      segment.epoch = true;
      break;
    case "REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        segment.index === 0 ||
        segment.identity.lifetimeKind !== "REBOOT_RECOVERY" ||
        segment.records.length !== 0
      )
        fail("reboot epoch is not a successor genesis record");
      segment.epoch = true;
      break;
    case "LIFETIME_CGROUP_CREATE_INTENT_DURABLE":
      requireTarget(record, false);
      requireManager(record, segment);
      if (!segment.epoch || segment.createIntent || segment.context)
        fail("lifetime create intent is out of order");
      segment.createIntent = true;
      break;
    case "LIFETIME_CGROUP_CONFIGURED_OBSERVED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (!segment.createIntent || segment.context)
        fail("configured observation is out of order");
      segment.context = normalizeContext(
        evidenceValue,
        segment.identity,
        "configured context",
      );
      break;
    case "GUARDIAN_LAUNCH_INTENT_DURABLE":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        segment.identity.lifetimeKind !== "NORMAL" ||
        !segment.context ||
        guardian.launchRaw
      )
        fail("normal launch intent is out of order");
      guardian.launchRaw = record.rawSha256;
      break;
    case "GUARDIAN_NOT_CREATED_OBSERVED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        !guardian.launchRaw ||
        guardian.pidfd ||
        guardian.notCreated ||
        guardianProcessPhaseClosed(guardian)
      )
        fail("normal no-child observation is out of order");
      normalizeNoChild(
        evidenceValue,
        {
          identity: segment.identity,
          targetSha256: null,
          launchRaw: guardian.launchRaw,
        },
        "normal no-child evidence",
      );
      guardian.notCreated = true;
      break;
    case "GUARDIAN_PIDFD_OBSERVED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        !guardian.launchRaw ||
        guardian.notCreated ||
        guardian.pidfd ||
        guardianProcessPhaseClosed(guardian)
      )
        fail("normal pidfd observation is out of order");
      guardian.pidfd = true;
      break;
    case "GUARDIAN_EXEC_OBSERVED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        !guardian.pidfd ||
        guardian.exec ||
        guardianProcessPhaseClosed(guardian)
      )
        fail("normal exec observation is out of order");
      guardian.exec = true;
      break;
    case "GUARDIAN_MEMBERSHIP_OBSERVED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        !guardian.exec ||
        guardian.membership ||
        guardianProcessPhaseClosed(guardian)
      )
        fail("normal membership observation is out of order");
      guardian.membership = true;
      break;
    case "GUARDIAN_INITIALIZATION_ADOPTED":
      requireTarget(record, false);
      if (
        record.writerKind !== "LIVE_BIRTH_GUARDIAN" ||
        record.writerActorEpochSha256 !==
          segment.identity.lifetimeEpochSha256 ||
        !guardian.membership ||
        guardian.adopted ||
        guardianProcessPhaseClosed(guardian)
      )
        fail("normal adoption writer or order changed");
      guardian.adopted = true;
      break;
    case "GENERATION_RECOVERY_HEAD_DURABLE": {
      requireTarget(record, true);
      if (record.writerKind === "LIVE_BIRTH_GUARDIAN") {
        const normal = state.segments[0];
        if (
          segment.index !== 0 ||
          record.writerActorEpochSha256 !==
            normal.identity.lifetimeEpochSha256 ||
          !normal.guardian.adopted ||
          normal.guardian.termination
        )
          fail("live target writer is ineligible");
      } else {
        requireManager(record, segment);
        if (
          segment.identity.lifetimeKind === "NORMAL" &&
          !normalResolved(state)
        )
          fail("manager target writer precedes normal resolution");
        if (!segment.context)
          fail("manager target writer has no configured context");
      }
      normalizeGenesisTarget(
        state,
        segment,
        record,
        operationValue,
        evidenceValue,
      );
      break;
    }
    case "TARGET_REBOOT_TRANSITION_OBSERVED":
      requireTarget(record, true);
      requireManager(record, segment);
      if (!target) fail("target transition references an unknown target");
      applyTransition(state, segment, target, operationValue);
      break;
    case "RECOVERY_ATTEMPT_ANCHOR_DURABLE":
      requireTarget(record, true);
      if (!target) fail("anchor references an unknown target");
      applyAnchor(state, segment, target, record, evidenceValue);
      break;
    case "RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE": {
      requireTarget(record, true);
      requireManager(record, segment);
      const attempt = target && currentAttempt(target);
      if (
        !attempt ||
        attempt.projection.actorKind !== "RECOVERY_ONLY_GUARDIAN" ||
        attempt.segmentIndex !== segment.index ||
        attempt.launchRaw ||
        recoveryEarlyProcessPhaseClosed(attempt) ||
        targetSuperseded(target, attempt)
      )
        fail("recovery launch intent is out of order");
      attempt.launchRaw = record.rawSha256;
      break;
    }
    case "RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED": {
      requireTarget(record, true);
      requireManager(record, segment);
      const attempt = target && currentAttempt(target);
      if (
        !attempt ||
        attempt.segmentIndex !== segment.index ||
        !attempt.launchRaw ||
        attempt.pidfd ||
        recoveryEarlyProcessPhaseClosed(attempt) ||
        targetSuperseded(target, attempt)
      )
        fail("recovery no-child observation is out of order");
      normalizeNoChild(
        evidenceValue,
        {
          identity: segment.identity,
          targetSha256: target.projection.targetSha256,
          launchRaw: attempt.launchRaw,
        },
        "recovery no-child evidence",
      );
      attempt.notCreated = true;
      break;
    }
    case "RECOVERY_GUARDIAN_PIDFD_OBSERVED": {
      requireTarget(record, true);
      requireManager(record, segment);
      const attempt = target && currentAttempt(target);
      if (
        !attempt ||
        attempt.segmentIndex !== segment.index ||
        !attempt.launchRaw ||
        attempt.pidfd ||
        recoveryEarlyProcessPhaseClosed(attempt) ||
        targetSuperseded(target, attempt)
      )
        fail("recovery pidfd observation is out of order");
      attempt.pidfd = true;
      break;
    }
    case "RECOVERY_GUARDIAN_EXEC_OBSERVED": {
      requireTarget(record, true);
      requireManager(record, segment);
      const attempt = target && currentAttempt(target);
      if (
        !attempt ||
        attempt.segmentIndex !== segment.index ||
        !attempt.pidfd ||
        attempt.exec ||
        recoveryEarlyProcessPhaseClosed(attempt) ||
        targetSuperseded(target, attempt)
      )
        fail("recovery exec observation is out of order");
      attempt.exec = true;
      break;
    }
    case "RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED": {
      requireTarget(record, true);
      requireManager(record, segment);
      const attempt = target && currentAttempt(target);
      if (
        !attempt ||
        attempt.segmentIndex !== segment.index ||
        !attempt.exec ||
        attempt.membership ||
        recoveryEarlyProcessPhaseClosed(attempt) ||
        targetSuperseded(target, attempt)
      )
        fail("recovery membership observation is out of order");
      attempt.membership = true;
      break;
    }
    case "RECOVERY_ATTEMPT_RESULT_DURABLE":
      requireTarget(record, true);
      if (!target) fail("result references an unknown target");
      applyResult(state, segment, target, record, evidenceValue);
      break;
    case "RECOVERY_GUARDIAN_TERMINATION_OBSERVED": {
      requireTarget(record, true);
      requireManager(record, segment);
      const attempt = target && currentAttempt(target);
      if (
        !attempt ||
        attempt.segmentIndex !== segment.index ||
        !attempt.launchRaw ||
        attempt.notCreated ||
        attempt.termination ||
        targetSuperseded(target, attempt)
      )
        fail("recovery termination observation is out of order");
      if (!attempt.membership)
        normalizePartialLaunch(
          evidenceValue,
          {
            identity: segment.identity,
            targetSha256: target.projection.targetSha256,
            launchRaw: attempt.launchRaw,
            context: segment.context,
          },
          "recovery partial-launch resolution",
        );
      attempt.termination = true;
      break;
    }
    case "RECOVERY_GUARDIAN_REAPED_OBSERVED":
    case "RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED": {
      requireTarget(record, true);
      requireManager(record, segment);
      const attempt = target && currentAttempt(target);
      if (
        !attempt ||
        attempt.segmentIndex !== segment.index ||
        !attempt.termination ||
        attempt.resolution ||
        targetSuperseded(target, attempt)
      )
        fail("recovery actor resolution is out of order");
      attempt.resolution = record.recordType;
      break;
    }
    case "NORMAL_CLOSE_RECEIPT_DURABLE":
      requireTarget(record, true);
      requireManager(record, segment);
      if (
        !target ||
        target.terminal ||
        target.attempts.length !== 0 ||
        target.currentSegmentIndex !== segment.index ||
        !segment.context
      )
        fail("normal close receipt is ineligible");
      target.normalCloseReceipt = normalizeCloseReceipt(
        evidenceValue,
        target.projection.targetSha256,
        "normal close receipt",
      );
      target.normalCloseReceiptRawSha256 = record.rawSha256;
      target.terminal = true;
      break;
    case "GUARDIAN_TERMINATION_OBSERVED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        !guardian.launchRaw ||
        guardian.notCreated ||
        guardian.termination ||
        normalSuperseded(state)
      )
        fail("normal termination observation is out of order");
      if (!guardian.adopted)
        normalizePartialLaunch(
          evidenceValue,
          {
            identity: segment.identity,
            targetSha256: null,
            launchRaw: guardian.launchRaw,
            context: segment.context,
          },
          "normal partial-launch resolution",
        );
      guardian.termination = true;
      break;
    case "GUARDIAN_REAPED_OBSERVED":
    case "GUARDIAN_PARENTAGE_LOST_OBSERVED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        !guardian.termination ||
        guardian.resolution ||
        normalSuperseded(state)
      )
        fail("normal actor resolution is out of order");
      guardian.resolution = record.recordType;
      break;
    case "LIFETIME_REMOVAL_INTENT_DURABLE":
      requireTarget(record, false);
      requireManager(record, segment);
      if (segment.removalIntent || !lifetimeRemovalEligible(state, segment))
        fail("lifetime removal is ineligible");
      segment.removalIntent = true;
      break;
    case "LIFETIME_PATH_ABSENT_OBSERVED":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        !segment.removalIntent ||
        segment.pathAbsent ||
        !lifetimeRemovalEligible(state, segment)
      )
        fail("lifetime path absence is out of order");
      segment.pathAbsent = true;
      break;
    case "LIFETIME_CLOSED_DURABLE":
      requireTarget(record, false);
      requireManager(record, segment);
      if (
        !segment.removalIntent ||
        !segment.pathAbsent ||
        segment.closed ||
        !lifetimeRemovalEligible(state, segment)
      )
        fail("lifetime closure is out of order");
      segment.closed = true;
      break;
    default:
      fail("unknown record type");
  }
  segment.records.push(record);
  state.recordCount += 1;
  if (record.targetSha256 === null) state.globalCount += 1;
  else {
    const appliedTarget = state.targets.get(record.targetSha256);
    if (record.recordType !== "GENERATION_RECOVERY_HEAD_DURABLE")
      appliedTarget.recordCount += 1;
  }
  if (capacity) checkCapacity(state);
}

function requireReplayBrand(value, label) {
  if (value === null || typeof value !== "object")
    fail(`${label} is not a replay`);
  const metadata = replayBrands.get(value);
  if (!metadata) fail(`${label} is not an originating replay`);
  return metadata;
}

function identityFromInput(input, metadata) {
  const state = metadata.state;
  const previous = currentSegment(state);
  if (input.lifetimeKind === "NORMAL") {
    if (state.segments.length !== 0)
      fail("normal identity has a predecessor lifetime");
    return validateIdentityActorEpochBoundary(
      canonicalIdentity({
        ...input,
        schema: CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_IDENTITY_SCHEMA_V1,
        lifetimeCgroupName: `guardian-${input.lifetimeEpochSha256}`,
        previousLifetimeEpochSha256: null,
        previousLifetimeRecordSequence: null,
        previousLifetimeRecordRawSha256:
          CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1,
      }),
      state,
    );
  }
  if (
    input.lifetimeKind !== "REBOOT_RECOVERY" ||
    state.segments.length === 0 ||
    !metadata.completeTail ||
    previous.removalIntent ||
    previous.pathAbsent ||
    previous.closed ||
    state.segments.length >=
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEGMENTS_V1
  )
    fail("reboot identity predecessor is ineligible");
  for (const field of [
    "stateRootIdentitySha256",
    "managerActorEpochSha256",
    "limitsSha256",
    "guardianExecutableIdentitySha256",
    "guardianControlRequirementsSha256",
  ])
    if (input[field] !== previous.identity[field])
      fail(`reboot identity input.${field} changed`);
  if (input.bootIdSha256 === previous.identity.bootIdSha256)
    fail("reboot identity reused boot");
  return validateIdentityActorEpochBoundary(
    canonicalIdentity({
      ...input,
      schema: CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_IDENTITY_SCHEMA_V1,
      lifetimeCgroupName: `guardian-${input.lifetimeEpochSha256}`,
      previousLifetimeEpochSha256: previous.identity.lifetimeEpochSha256,
      previousLifetimeRecordSequence: previous.records.at(-1).sequence,
      previousLifetimeRecordRawSha256: previous.records.at(-1).rawSha256,
    }),
    state,
  );
}

export function createCandidateContainmentGuardianLifetimeIdentityV1(input) {
  const record = exactRecord(
    input,
    IDENTITY_INPUT_FIELDS,
    "identity input",
    fail,
  );
  exactOneOf(
    record.lifetimeKind,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_KINDS_V1,
    "identity input.lifetimeKind",
  );
  for (const field of [
    "stateRootIdentitySha256",
    "managerActorEpochSha256",
    "bootIdSha256",
    "delegatedRootIdentitySha256",
    "lifetimeEpochSha256",
    "limitsSha256",
    "guardianExecutableIdentitySha256",
    "guardianControlRequirementsSha256",
  ])
    exactDigest(record[field], `identity input.${field}`, fail);
  const metadata = requireReplayBrand(
    record.previousLifetimeReplay,
    "identity input.previousLifetimeReplay",
  );
  return identityFromInput(record, metadata);
}

export function verifyCandidateContainmentGuardianLifetimeIdentityV1(input) {
  const record = exactRecord(
    input,
    ["identity", "previousLifetimeReplay"],
    "identity verification input",
    fail,
  );
  const identity = normalizeIdentity(
    record.identity,
    "identity verification input.identity",
  );
  const metadata = requireReplayBrand(
    record.previousLifetimeReplay,
    "identity verification input.previousLifetimeReplay",
  );
  const expected = identityFromInput(
    {
      lifetimeKind: identity.lifetimeKind,
      stateRootIdentitySha256: identity.stateRootIdentitySha256,
      managerActorEpochSha256: identity.managerActorEpochSha256,
      bootIdSha256: identity.bootIdSha256,
      delegatedRootIdentitySha256: identity.delegatedRootIdentitySha256,
      lifetimeEpochSha256: identity.lifetimeEpochSha256,
      limitsSha256: identity.limitsSha256,
      guardianExecutableIdentitySha256:
        identity.guardianExecutableIdentitySha256,
      guardianControlRequirementsSha256:
        identity.guardianControlRequirementsSha256,
    },
    metadata,
  );
  if (!sameValue(identity, expected)) fail("verified identity changed");
  return identity;
}

function prepareCandidateState(source, lifetimeIdentity) {
  const state = cloneState(source);
  let segment = currentSegment(state);
  if (
    !segment ||
    segment.identity.identitySha256 !== lifetimeIdentity.identitySha256
  ) {
    segment = addSegment(state, lifetimeIdentity);
  } else if (!sameValue(segment.identity, lifetimeIdentity)) {
    fail("record input lifetime identity aliases current segment");
  }
  return { state, segment };
}

function reducerRecordFromValue(value, rawSha256) {
  const record = nullRecord(
    RECORD_FIELDS.map((field) => [field, value[field]]),
  );
  record.rawSha256 = rawSha256;
  return record;
}

export function createCandidateContainmentGuardianLifetimeRecordV1(input) {
  const record = exactRecord(input, CREATE_RECORD_FIELDS, "record input", fail);
  const metadata = requireReplayBrand(
    record.previousLifetimeReplay,
    "record input.previousLifetimeReplay",
  );
  if (metadata.state.recordCount > 0 && !metadata.completeTail)
    fail("record input replay tail is structural");
  const lifetimeIdentity = normalizeIdentity(
    record.lifetimeIdentity,
    "record input.lifetimeIdentity",
  );
  exactOneOf(
    record.writerKind,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_WRITER_KINDS_V1,
    "record input.writerKind",
  );
  exactDigest(
    record.writerActorEpochSha256,
    "record input.writerActorEpochSha256",
    fail,
  );
  const targetSha256 =
    record.targetSha256 === null
      ? null
      : exactDigest(record.targetSha256, "record input.targetSha256", fail);
  exactOneOf(
    record.recordType,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_TYPES_V1,
    "record input.recordType",
  );
  const operation = decodeLifetimeJsonLine(
    record.operationBytes,
    "record input.operationBytes",
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
  );
  const evidence = decodeLifetimeJsonLine(
    record.evidenceBytes,
    "record input.evidenceBytes",
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_OPERATION_OR_EVIDENCE_BYTES_V1,
  );
  const preview = prepareCandidateState(metadata.state, lifetimeIdentity);
  const segment = preview.segment;
  const sequence = sequenceText(segment.records.length + 1);
  const previousRecordRawSha256 =
    segment.records.at(-1)?.rawSha256 ??
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1;
  const context = {
    sequence,
    recordType: record.recordType,
    lifetimeIdentity,
    writerKind: record.writerKind,
    writerActorEpochSha256: record.writerActorEpochSha256,
    targetSha256,
  };
  const operationDescriptor = descriptorFromBytes(
    "operation",
    context,
    operation.bytes,
    operation.value,
  );
  const evidenceDescriptor = descriptorFromBytes(
    "evidence",
    context,
    evidence.bytes,
    evidence.value,
  );
  const value = deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_SCHEMA_V1],
      ["sequence", sequence],
      ["recordType", record.recordType],
      ["previousRecordRawSha256", previousRecordRawSha256],
      ["lifetimeIdentity", lifetimeIdentity],
      ["writerKind", record.writerKind],
      ["writerActorEpochSha256", record.writerActorEpochSha256],
      ["targetSha256", targetSha256],
      ["operation", operationDescriptor],
      ["evidence", evidenceDescriptor],
    ]),
  );
  applyRecord(
    preview.state,
    reducerRecordFromValue(value, CANDIDATE_RAW_SHA256_PREVIEW),
  );
  const bytes = canonicalJsonLine(value);
  if (
    bytes.length > CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORD_BYTES_V1
  )
    fail("record bytes exceed bound");
  const rawSha256 = sha256(bytes);
  const semanticSha256 = canonicalSha256(value);
  const name = `${sequence}-${rawSha256}.jsonl`;
  const actual = prepareCandidateState(metadata.state, lifetimeIdentity);
  applyRecord(actual.state, reducerRecordFromValue(value, rawSha256), {
    capacity: false,
  });
  return artifactFromRecord(name, bytes, value, rawSha256, semanticSha256);
}

function preflightReplaySegments(value) {
  const entries = exactDenseArray(
    value,
    "replay input.segments",
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEGMENTS_V1,
    fail,
  );
  const segments = new Array(entries.length);
  let recordCount = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const segment = exactRecord(
      entries[index],
      SEGMENT_FIELDS,
      `replay input.segments[${index}]`,
      fail,
    );
    const records = exactDenseArray(
      segment.records,
      `replay input.segments[${index}].records`,
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_PER_SEGMENT_V1,
      fail,
    );
    if (records.length === 0) fail("replay segment has no record");
    recordCount += records.length;
    segments[index] = { lifetimeIdentity: segment.lifetimeIdentity, records };
  }
  if (
    recordCount >
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_ACROSS_SEGMENTS_V1 ||
    recordCount >
      CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_V1
  )
    fail("replay record count exceeds structural or semantic bound");
  let aggregateBytes = 0;
  for (
    let segmentIndex = 0;
    segmentIndex < segments.length;
    segmentIndex += 1
  ) {
    const segment = segments[segmentIndex];
    const references = new Array(segment.records.length);
    for (
      let recordIndex = 0;
      recordIndex < segment.records.length;
      recordIndex += 1
    ) {
      const reference = exactRecord(
        segment.records[recordIndex],
        RECORD_REFERENCE_FIELDS,
        `replay record reference ${segmentIndex}:${recordIndex}`,
        fail,
      );
      if (typeof reference.name !== "string")
        fail("replay record reference name is not text");
      const length = exactBufferByteLength(
        reference.bytes,
        `replay record reference ${segmentIndex}:${recordIndex}.bytes`,
        {
          maximumBytes:
            CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORD_BYTES_V1,
        },
        fail,
      );
      aggregateBytes += length;
      if (
        aggregateBytes >
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_AGGREGATE_RECORD_BYTES_V1
      )
        fail("replay aggregate bytes exceed bound");
      references[recordIndex] = reference;
    }
    segment.records = Object.freeze(references);
  }
  return Object.freeze(segments);
}

function hasOpenPrefix(state) {
  const latest = currentSegment(state);
  if (!latest) return false;
  if (latest.removalIntent && !latest.pathAbsent) return true;
  for (const segment of state.segments) {
    if (segmentSuperseded(state, segment.index)) continue;
    if (segment.createIntent && !segment.context) return true;
    const guardian = segment.guardian;
    if (
      guardian.launchRaw &&
      !guardian.notCreated &&
      !guardian.adopted &&
      !guardian.resolution
    )
      return true;
    if (guardian.termination && !guardian.resolution) return true;
  }
  for (const target of state.targets.values()) {
    if (latest.context && target.currentSegmentIndex !== latest.index)
      return true;
    const attempt = currentAttempt(target);
    if (!attempt) continue;
    if (!attempt.result) return true;
    if (
      attempt.launchRaw &&
      !attempt.notCreated &&
      !attempt.resolution &&
      !targetSuperseded(target, attempt)
    )
      return true;
  }
  return false;
}

function targetSummary(target) {
  const attempts = Object.freeze(
    target.attempts.map((attempt) =>
      deepFreeze(
        nullRecord([
          [
            "recoveryActorEpochSha256",
            attempt.projection.recoveryActorEpochSha256,
          ],
          ["lifetimeAnchorProjection", attempt.projection],
          ["lifetimeAttemptAnchorRawSha256", attempt.anchorRawSha256],
        ]),
      ),
    ),
  );
  return deepFreeze(
    nullRecord([
      ["generationIdentitySha256", target.projection.generationIdentitySha256],
      ["targetSha256", target.projection.targetSha256],
      ["recoveryTargetProjection", target.projection],
      ["lifetimeTargetRecordRawSha256", target.genesisRawSha256],
      ["currentBootIdSha256", target.currentContext.bootIdSha256],
      [
        "currentDelegatedRootIdentitySha256",
        target.currentContext.delegatedRootIdentitySha256,
      ],
      [
        "currentLifetimeCgroupIdentitySha256",
        target.currentContext.lifetimeCgroupIdentitySha256,
      ],
      ["bootTransitionCount", target.transitionCount],
      ["attemptCount", target.attempts.length],
      ["latestExternalHead", target.head],
      ["attemptAnchors", attempts],
      ["normalCloseReceipt", target.normalCloseReceipt],
      ["normalCloseReceiptRecordRawSha256", target.normalCloseReceiptRawSha256],
    ]),
  );
}

export function replayCandidateContainmentGuardianLifetimeV1(input) {
  const record = exactRecord(input, REPLAY_INPUT_FIELDS, "replay input", fail);
  const expectedStateRootIdentitySha256 = exactDigest(
    record.expectedStateRootIdentitySha256,
    "replay input.expectedStateRootIdentitySha256",
    fail,
  );
  const expectedTuple = [
    record.expectedLatestLifetimeEpochSha256,
    record.expectedLatestRecordSequence,
    record.expectedLatestRecordRawSha256,
  ];
  const allNull = expectedTuple.every((value) => value === null);
  const allPresent = expectedTuple.every((value) => value !== null);
  if (!allNull && !allPresent) fail("replay expected tail tuple is partial");
  if (allPresent) {
    exactDigest(
      record.expectedLatestLifetimeEpochSha256,
      "replay input.expectedLatestLifetimeEpochSha256",
      fail,
    );
    exactSequence(
      record.expectedLatestRecordSequence,
      "replay input.expectedLatestRecordSequence",
    );
    exactDigest(
      record.expectedLatestRecordRawSha256,
      "replay input.expectedLatestRecordRawSha256",
      fail,
    );
  }
  const segmentInputs = preflightReplaySegments(record.segments);
  const state = createState();
  for (const [segmentIndex, inputSegment] of segmentInputs.entries()) {
    const identity = normalizeIdentity(
      inputSegment.lifetimeIdentity,
      `replay segment ${segmentIndex} identity`,
    );
    if (identity.stateRootIdentitySha256 !== expectedStateRootIdentitySha256)
      fail("replay state-root identity changed");
    addSegment(state, identity);
    for (const [recordIndex, reference] of inputSegment.records.entries()) {
      const artifact = normalizeRecordReference(
        reference,
        `replay segment ${segmentIndex} record ${recordIndex}`,
      );
      applyRecord(state, artifact);
    }
  }
  const latest = currentSegment(state);
  if (latest === undefined && !allNull)
    fail("zero replay has a non-null expected tail");
  if (latest !== undefined && allPresent) {
    const tail = latest.records.at(-1);
    if (
      record.expectedLatestLifetimeEpochSha256 !==
        latest.identity.lifetimeEpochSha256 ||
      record.expectedLatestRecordSequence !== tail.sequence ||
      record.expectedLatestRecordRawSha256 !== tail.rawSha256
    )
      fail("replay expected tail changed");
  }
  const targets = Object.freeze([...state.targets.values()].map(targetSummary));
  const status =
    state.recordCount === 0
      ? "NO_LIFETIME_RECORD"
      : latest.closed
        ? "COMPLETE_LIFETIME_CHAIN_REPLAYED"
        : hasOpenPrefix(state)
          ? "VALID_LIFETIME_PREFIX_REPLAYED"
          : "VALID_LIFETIME_CHAIN_REPLAYED";
  const replay = deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_SCHEMA_V1],
      [
        "requirementsSha256",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1,
      ],
      ["status", status],
      ["stateRootIdentitySha256", expectedStateRootIdentitySha256],
      ["segmentCount", state.segments.length],
      ["recordCount", state.recordCount],
      [
        "latestLifetimeEpochSha256",
        latest?.identity.lifetimeEpochSha256 ?? null,
      ],
      [
        "latestLifetimeRecordSequence",
        latest?.records.at(-1)?.sequence ?? null,
      ],
      [
        "latestLifetimeRecordRawSha256",
        latest?.records.at(-1)?.rawSha256 ?? null,
      ],
      ["targetCount", state.targets.size],
      ["targets", targets],
      ["internalHashChainsValidated", true],
      ["lifetimeSuccessorBindingsMatched", true],
      ["stateRootIdentityAnchorMatched", true],
      ["expectedTailMatched", latest === undefined ? false : allPresent],
      [
        "tailCompletenessExternallyAnchored",
        latest === undefined ? false : allPresent,
      ],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_AUTHORITY_V1],
      ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NONCLAIMS_V1],
      [
        "physicalFacts",
        CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PHYSICAL_FACTS_V1,
      ],
    ]),
  );
  const metadata = {
    state,
    completeTail: latest === undefined ? false : allPresent,
    targetSummaries: new Map(
      targets.map((summary) => [summary.targetSha256, summary]),
    ),
  };
  replayBrands.set(replay, metadata);
  return replay;
}

function selectableReplay(input, fields, label) {
  const record = exactRecord(input, fields, label, fail);
  const metadata = requireReplayBrand(
    record.lifetimeReplay,
    `${label}.lifetimeReplay`,
  );
  if (!metadata.completeTail) fail(`${label} requires a complete-tail replay`);
  return { record, metadata };
}

export function selectCandidateContainmentGuardianLifetimeRecoveryTargetV1(
  input,
) {
  const { record, metadata } = selectableReplay(
    input,
    ["lifetimeReplay", "generationIdentitySha256"],
    "target selector input",
  );
  exactDigest(
    record.generationIdentitySha256,
    "target selector input.generationIdentitySha256",
    fail,
  );
  const target = metadata.state.generations.get(
    record.generationIdentitySha256,
  );
  if (!target) fail("target selector has no unique generation");
  const selection = deepFreeze(
    nullRecord([
      ["recoveryTargetProjection", target.projection],
      ["lifetimeTargetRecordRawSha256", target.genesisRawSha256],
    ]),
  );
  targetSelectionBrands.set(selection, { metadata, target });
  return selection;
}

export function selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1(
  input,
) {
  const { record, metadata } = selectableReplay(
    input,
    ["lifetimeReplay", "targetSha256", "recoveryActorEpochSha256"],
    "anchor selector input",
  );
  exactDigest(record.targetSha256, "anchor selector input.targetSha256", fail);
  exactDigest(
    record.recoveryActorEpochSha256,
    "anchor selector input.recoveryActorEpochSha256",
    fail,
  );
  const target = metadata.state.targets.get(record.targetSha256);
  const index =
    target?.attempts.findIndex(
      (attempt) =>
        attempt.projection.recoveryActorEpochSha256 ===
        record.recoveryActorEpochSha256,
    ) ?? -1;
  if (!target || index < 0) fail("anchor selector has no unique actor");
  const attempt = target.attempts[index];
  const selection = deepFreeze(
    nullRecord([
      ["lifetimeAnchorProjection", attempt.projection],
      ["lifetimeAttemptAnchorRawSha256", attempt.anchorRawSha256],
    ]),
  );
  anchorProjectionBrands.set(attempt.projection, {
    metadata,
    target,
    attempt,
    index,
  });
  return selection;
}

export function selectCandidateContainmentGuardianLifetimeExternalHeadV1(
  input,
) {
  const { record, metadata } = selectableReplay(
    input,
    ["lifetimeReplay", "targetSha256"],
    "external-head selector input",
  );
  exactDigest(
    record.targetSha256,
    "external-head selector input.targetSha256",
    fail,
  );
  const target = metadata.state.targets.get(record.targetSha256);
  if (!target) fail("external-head selector has no target");
  externalHeadBrands.set(target.head, { metadata, target });
  return target.head;
}

export function selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1(
  input,
) {
  const { record, metadata } = selectableReplay(
    input,
    ["lifetimeReplay", "targetSha256"],
    "normal-close selector input",
  );
  exactDigest(
    record.targetSha256,
    "normal-close selector input.targetSha256",
    fail,
  );
  const target = metadata.state.targets.get(record.targetSha256);
  if (!target?.normalCloseReceipt) fail("normal-close selector has no receipt");
  const selection = deepFreeze(
    nullRecord([
      ["normalCloseReceiptProjection", target.normalCloseReceipt],
      ["normalCloseReceiptRecordRawSha256", target.normalCloseReceiptRawSha256],
    ]),
  );
  closeSelectionBrands.set(selection, { metadata, target });
  return selection;
}

function exactBrandRecord(value, fields, label) {
  return exactRecord(value, fields, label, brandFail);
}

function exactBrandDigest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
    brandFail(`${label} changed`);
  return value;
}

export function assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1(
  input,
) {
  const record = exactBrandRecord(
    input,
    [
      "selection",
      "generationIdentitySha256",
      "targetSha256",
      "targetBootIdSha256",
      "targetDelegatedRootIdentitySha256",
      "targetLifetimeEpochSha256",
    ],
    "target assertion input",
  );
  for (const field of [
    "generationIdentitySha256",
    "targetSha256",
    "targetBootIdSha256",
    "targetDelegatedRootIdentitySha256",
    "targetLifetimeEpochSha256",
  ])
    exactBrandDigest(record[field], `target assertion input.${field}`);
  const association = targetSelectionBrands.get(record.selection);
  if (!association) brandFail("target selection is not branded");
  const projection = association.target.projection;
  for (const [field, expected] of [
    ["generationIdentitySha256", projection.generationIdentitySha256],
    ["targetSha256", projection.targetSha256],
    ["targetBootIdSha256", projection.targetBootIdSha256],
    [
      "targetDelegatedRootIdentitySha256",
      projection.targetDelegatedRootIdentitySha256,
    ],
    ["targetLifetimeEpochSha256", projection.targetLifetimeEpochSha256],
  ])
    if (record[field] !== expected)
      brandFail(`target assertion ${field} mismatch`);
  return true;
}

export function assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
  input,
) {
  const record = exactBrandRecord(
    input,
    [
      "lifetimeAnchorProjection",
      "lifetimeAttemptAnchorRawSha256",
      "targetSha256",
      "recoveryActorEpochSha256",
    ],
    "anchor assertion input",
  );
  for (const field of [
    "lifetimeAttemptAnchorRawSha256",
    "targetSha256",
    "recoveryActorEpochSha256",
  ])
    exactBrandDigest(record[field], `anchor assertion input.${field}`);
  const association = anchorProjectionBrands.get(
    record.lifetimeAnchorProjection,
  );
  if (
    !association ||
    record.lifetimeAttemptAnchorRawSha256 !==
      association.attempt.anchorRawSha256 ||
    record.targetSha256 !== association.target.projection.targetSha256 ||
    record.recoveryActorEpochSha256 !==
      association.attempt.projection.recoveryActorEpochSha256
  )
    brandFail("anchor assertion association mismatch");
  return true;
}

export function assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1(
  input,
) {
  const record = exactBrandRecord(
    input,
    ["externalHead", "targetSha256"],
    "external-head assertion input",
  );
  exactBrandDigest(
    record.targetSha256,
    "external-head assertion input.targetSha256",
  );
  const association = externalHeadBrands.get(record.externalHead);
  if (
    !association ||
    record.targetSha256 !== association.target.projection.targetSha256
  )
    brandFail("external-head assertion association mismatch");
  return true;
}

export function assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1(
  input,
) {
  const record = exactBrandRecord(
    input,
    ["normalCloseDurabilityReceipt", "targetSha256"],
    "normal-close assertion input",
  );
  exactBrandDigest(
    record.targetSha256,
    "normal-close assertion input.targetSha256",
  );
  const association = closeSelectionBrands.get(
    record.normalCloseDurabilityReceipt,
  );
  if (
    !association ||
    record.targetSha256 !== association.target.projection.targetSha256
  )
    brandFail("normal-close assertion association mismatch");
  return true;
}

function anchorCarrierAssociation(value, label) {
  const carrier = exactBrandRecord(
    value,
    ["lifetimeAnchorProjection", "lifetimeAttemptAnchorRawSha256"],
    label,
  );
  exactBrandDigest(
    carrier.lifetimeAttemptAnchorRawSha256,
    `${label}.lifetimeAttemptAnchorRawSha256`,
  );
  const association = anchorProjectionBrands.get(
    carrier.lifetimeAnchorProjection,
  );
  if (
    !association ||
    carrier.lifetimeAttemptAnchorRawSha256 !==
      association.attempt.anchorRawSha256
  )
    brandFail(`${label} association mismatch`);
  return association;
}

export function assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1(
  input,
) {
  const record = exactBrandRecord(
    input,
    [
      "recoveryTargetSelection",
      "historicalLifetimeAnchorSelections",
      "currentLifetimeAnchorSelection",
      "externalHead",
      "normalCloseDurabilityReceipt",
    ],
    "boundary-set assertion input",
  );
  const targetAssociation = targetSelectionBrands.get(
    record.recoveryTargetSelection,
  );
  if (!targetAssociation) brandFail("boundary target selection is not branded");
  const historical = exactDenseArray(
    record.historicalLifetimeAnchorSelections,
    "boundary historical anchors",
    4,
    brandFail,
  );
  const target = targetAssociation.target;
  const attempts = target.attempts;
  const expectedCurrent =
    attempts.length > 0 && !attempts.at(-1).result ? attempts.at(-1) : null;
  const expectedHistorical = expectedCurrent ? attempts.slice(0, -1) : attempts;
  if (historical.length !== expectedHistorical.length)
    brandFail("boundary historical anchor count changed");
  for (const [index, carrier] of historical.entries()) {
    const association = anchorCarrierAssociation(
      carrier,
      `boundary historical anchor ${index}`,
    );
    if (
      association.metadata !== targetAssociation.metadata ||
      association.target !== target ||
      association.attempt !== expectedHistorical[index]
    )
      brandFail("boundary historical anchor origin or order changed");
  }
  if (expectedCurrent === null) {
    if (record.currentLifetimeAnchorSelection !== null)
      brandFail("boundary current anchor is unexpected");
  } else {
    if (record.currentLifetimeAnchorSelection === null)
      brandFail("boundary current anchor is missing");
    const association = anchorCarrierAssociation(
      record.currentLifetimeAnchorSelection,
      "boundary current anchor",
    );
    if (
      association.metadata !== targetAssociation.metadata ||
      association.target !== target ||
      association.attempt !== expectedCurrent
    )
      brandFail("boundary current anchor origin changed");
  }
  if (record.externalHead !== null) {
    const association = externalHeadBrands.get(record.externalHead);
    if (
      !association ||
      association.metadata !== targetAssociation.metadata ||
      association.target !== target ||
      !sameValue(record.externalHead, target.head)
    )
      brandFail("boundary external head origin changed");
  }
  if (
    expectedCurrent &&
    (record.externalHead === null ||
      !sameValue(record.externalHead, expectedCurrent.predecessorHead))
  ) {
    brandFail("boundary current anchor predecessor changed");
  }
  if (record.normalCloseDurabilityReceipt !== null) {
    const association = closeSelectionBrands.get(
      record.normalCloseDurabilityReceipt,
    );
    if (
      !association ||
      association.metadata !== targetAssociation.metadata ||
      association.target !== target ||
      !target.normalCloseReceipt
    )
      brandFail("boundary normal-close receipt origin changed");
  } else if (target.normalCloseReceipt)
    brandFail("boundary normal-close receipt is missing");
  return true;
}
