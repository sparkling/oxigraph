import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as lifetime from "../src/candidate/containment-guardian-lifetime-v1.mjs";

const ZERO_SHA256 = "0".repeat(64);

const SCHEMAS = Object.freeze({
  identity: "oxigraph.candidate-containment-guardian-lifetime-identity/v1",
  context: "oxigraph.candidate-containment-guardian-lifetime-context/v1",
  record: "oxigraph.candidate-containment-guardian-lifetime-record/v1",
  replay: "oxigraph.candidate-containment-guardian-lifetime-replay/v1",
  requirements:
    "oxigraph.candidate-containment-guardian-lifetime-requirements/v1",
  rebootTransition:
    "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-projection/v1",
  rebootTransitionChainEvent:
    "oxigraph.candidate-containment-guardian-lifetime-target-reboot-transition-chain-event/v1",
  partialLaunchResolution:
    "oxigraph.candidate-containment-guardian-lifetime-partial-launch-resolution-projection/v1",
  noChildLaunchFailure:
    "oxigraph.candidate-containment-guardian-lifetime-no-child-launch-failure-projection/v1",
  targetGenesisInventory:
    "oxigraph.candidate-containment-guardian-lifetime-target-genesis-inventory-projection/v1",
  recoveryTargetProjection:
    "oxigraph.candidate-containment-guardian-lifetime-recovery-target-projection/v1",
  targetGenesisEvent:
    "oxigraph.candidate-containment-guardian-lifetime-target-genesis-event/v1",
  anchorEvent:
    "oxigraph.candidate-containment-guardian-lifetime-recovery-attempt-anchor-event/v1",
  anchorProjection:
    "oxigraph.candidate-containment-lifetime-recovery-attempt-anchor-projection/v1",
  normalCloseReceiptProjection:
    "oxigraph.candidate-containment-lifetime-normal-close-receipt-projection/v1",
  externalHead: "oxigraph.candidate-containment-recovery-external-head/v1",
});

const LIFETIME_KINDS = Object.freeze(["NORMAL", "REBOOT_RECOVERY"]);
const WRITER_KINDS = Object.freeze([
  "SERVICE_MANAGER",
  "LIVE_BIRTH_GUARDIAN",
  "RECOVERY_ONLY_GUARDIAN",
]);
const RECORD_TYPES = Object.freeze([
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
const REPLAY_STATUSES = Object.freeze([
  "NO_LIFETIME_RECORD",
  "VALID_LIFETIME_PREFIX_REPLAYED",
  "VALID_LIFETIME_CHAIN_REPLAYED",
  "COMPLETE_LIFETIME_CHAIN_REPLAYED",
]);
const NO_CHILD_ERRNO_NAMES = Object.freeze([
  "EACCES",
  "EAGAIN",
  "EBUSY",
  "EINVAL",
  "ENOMEM",
  "ENOSYS",
  "EOPNOTSUPP",
  "EPERM",
]);

const EXPECTED_AUTHORITY = Object.freeze({
  mayPersistLifetimeRecord: false,
  mayConsumeLifetimeEpoch: false,
  mayCreateLifetimeCgroup: false,
  mayRemoveLifetimeCgroup: false,
  mayLaunchGuardian: false,
  mayReapGuardian: false,
  mayPersistRecoveryTarget: false,
  mayPersistRecoveryAnchor: false,
  mayPersistRecoveryHead: false,
  mayPersistNormalCloseReceipt: false,
  mayMutateStateFilesystem: false,
  mayMutateDelegatedCgroup: false,
  mayExecuteRecoveryPlan: false,
  mayRegisterRuntime: false,
  mayQualify: false,
  mayPromote: false,
  mayPublish: false,
  productionContainment: false,
});

const EXPECTED_NONCLAIMS = Object.freeze({
  serializedReplayProvesArtifactOrigin: false,
  serializedReplayProvesFilesystemDurability: false,
  serializedReplayProvesExclusiveStateRootLock: false,
  serializedReplayProvesBootIdentity: false,
  serializedReplayProvesDelegatedRootIdentity: false,
  serializedReplayProvesLifetimeCgroupIdentity: false,
  serializedReplayProvesFreshEpoch: false,
  serializedReplayProvesGuardianExecution: false,
  serializedReplayProvesGuardianParentage: false,
  serializedReplayProvesGuardianReap: false,
  parentageLostObservationProvesReap: false,
  serializedReplayProvesRecoveryTargetOrigin: false,
  serializedReplayProvesRecoveryHeadOrigin: false,
  serializedReplayProvesNormalCloseMechanics: false,
  selectedBoundaryProvesPhysicalFact: false,
  tailDeletionExcludedWithoutExpectedHead: false,
});

const EXPECTED_PHYSICAL_FACTS = Object.freeze({
  stateRootIdentityObserved: null,
  stateFilesystemInterfaceAvailable: null,
  lifetimeEpochConsumed: null,
  lifetimeRecordPersisted: null,
  lifetimeRecordFilesystemDurability: null,
  lifetimeCgroupConfigured: null,
  lifetimeCgroupPathAbsent: null,
  guardianExecuted: null,
  guardianReaped: null,
  guardianParentageLost: null,
  recoveryTargetPersisted: null,
  recoveryAnchorPersisted: null,
  recoveryHeadPersisted: null,
  normalCloseReceiptPersisted: null,
  bootTransitionObserved: null,
  physicalEligibility: false,
  productionContainment: false,
});

function canonicalJson(value, ancestors = new WeakSet()) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  assert.equal(typeof value, "object");
  assert.equal(ancestors.has(value), false);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      assert.deepEqual(
        Object.keys(value),
        value.map((_, index) => String(index)),
      );
      return `[${value.map((child) => canonicalJson(child, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    assert.equal(prototype === Object.prototype || prototype === null, true);
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function semanticSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function digest(label) {
  return sha256(Buffer.from(label, "utf8"));
}

function jsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, plain(child)]),
    );
  }
  return value;
}

function digestValue(schema, fields, digestField) {
  const value = { schema, ...fields };
  value[digestField] = semanticSha256(value);
  return value;
}

function matrixRow(recordType, writerRule, targetRule, predecessorRule) {
  return { recordType, writerRule, targetRule, predecessorRule };
}

const RELATIONSHIP_MATRIX = Object.freeze([
  matrixRow(
    "NORMAL_LIFETIME_EPOCH_CONSUMED",
    "service manager; epoch = manager actor",
    "null",
    "sequence 1 of the sole NORMAL genesis segment; zero prior replay and all-zero record head",
  ),
  matrixRow(
    "REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED",
    "service manager; epoch = manager actor",
    "null",
    "sequence 1 of a REBOOT_RECOVERY segment; previous complete-tail-matched nonclosed segment tuple equals the identity predecessor; that predecessor replay contains neither removal intent nor pathname absence; boot and lifetime epoch both differ",
  ),
  matrixRow(
    "LIFETIME_CGROUP_CREATE_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "segment epoch-consumed is the previous segment-wide event",
  ),
  matrixRow(
    "LIFETIME_CGROUP_CONFIGURED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "cgroup-create intent; evidence is the exact configured context",
  ),
  matrixRow(
    "GUARDIAN_LAUNCH_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "configured NORMAL context; no normal guardian launch event exists",
  ),
  matrixRow(
    "GUARDIAN_NOT_CREATED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian launch intent; exact same-manager definite-no-child launch-failure evidence; no pidfd/child/termination event exists",
  ),
  matrixRow(
    "GUARDIAN_PIDFD_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian launch intent",
  ),
  matrixRow(
    "GUARDIAN_EXEC_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian pidfd observation",
  ),
  matrixRow(
    "GUARDIAN_MEMBERSHIP_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian exec observation",
  ),
  matrixRow(
    "GUARDIAN_INITIALIZATION_ADOPTED",
    "live-birth guardian; epoch = normal lifetime epoch",
    "null",
    "normal guardian membership observation",
  ),
  matrixRow(
    "GENERATION_RECOVERY_HEAD_DURABLE",
    "live-birth guardian with normal lifetime epoch after its exact initialization-adopted prefix, or service manager with manager epoch after normal-guardian terminal resolution or in a configured proved-reboot segment",
    "non-null",
    "target and generation identity absent from replay; target count below six and complete append reserve available; operation is the exact target-genesis event, whose reboot-transition chain is empty except for service-manager genesis after one or more proved-reboot segments; evidence is its sole genesis NO_RECOVERY_ATTEMPT head",
  ),
  matrixRow(
    "TARGET_REBOOT_TRANSITION_OBSERVED",
    "service manager; epoch = manager actor",
    "non-null existing target",
    "current reboot segment is configured; operation is the exact one-through-four transition-chain event covering every segment since the target's latest context; target has no transition ending at this segment; latest external head remains unchanged",
  ),
  matrixRow(
    "RECOVERY_ATTEMPT_ANCHOR_DURABLE",
    "initialized live-birth guardian with epoch = anchor actor and no not-created/termination/reboot supersession, or service manager with epoch = manager actor for a recovery-only anchor",
    "non-null existing target",
    "configured context; complete reboot-transition catch-up exists iff boot changed; no unresolved anchor; target nonterminal; attempt count below four; complete append reserve exists for the whole attempt/result/actor-resolution suffix; evidence is the exact anchor event",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "anchor target",
    "current anchor is recovery-only and has no launch event",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery launch intent; exact same-manager definite-no-child launch-failure evidence; no pidfd/child/termination event exists",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_PIDFD_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery launch intent",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_EXEC_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery guardian pidfd observation",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "recovery guardian exec observation",
  ),
  matrixRow(
    "RECOVERY_ATTEMPT_RESULT_DURABLE",
    "matching initialized live-birth actor before termination/reboot; matching recovery-only actor only after its exact launch-intent/pidfd/exec/membership prefix and before not-created/termination/reboot; service manager for a recovery-only anchor after exact never-launched pre-temp ABSENT/PRESENT_EMPTY observation or recovery-guardian not-created; or service manager for either actor kind only after that actor's same-boot terminal resolution or configured target reboot supersession",
    "anchor target",
    "exact current anchor; result binds that anchor and recovery head; residue-free never-launched/not-created result is anchored-empty; launched result is structurally observed from the exact recovery ledger; temp/other residue rejects; a live-birth empty directory never grants the manager a direct pre-resolution result branch; after reboot, complete target catch-up and exact directory/ledger observation replace unobtainable old-boot process evidence without claiming reap or exit status",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_TERMINATION_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "any durable recovery launch-intent prefix; may follow its honest launch prefix or result; replacement-manager use additionally requires reported lock reacquisition plus exact lifetime-cgroup empty/identity evidence; occurs once",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_REAPED_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "termination observed and this manager retains exclusive direct-child wait authority",
  ),
  matrixRow(
    "RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED",
    "service manager; epoch = manager actor",
    "anchor target",
    "termination observed after manager replacement; direct-child wait authority is absent and no reap/exit-status claim is made",
  ),
  matrixRow(
    "NORMAL_CLOSE_RECEIPT_DURABLE",
    "service manager; epoch = manager actor",
    "non-null existing target",
    "target has its unique genesis head, zero attempts, no recovery terminal, and zero through four exact replay-derived transitions ending in the current configured context; evidence is the exact close-receipt projection replay will brand",
  ),
  matrixRow(
    "GUARDIAN_TERMINATION_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "any durable normal launch-intent prefix has terminated, independently of target terminality; replacement-manager use additionally requires reported lock reacquisition plus exact lifetime-cgroup empty/identity evidence",
  ),
  matrixRow(
    "GUARDIAN_REAPED_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian termination observed and this manager retains exclusive direct-child wait authority",
  ),
  matrixRow(
    "GUARDIAN_PARENTAGE_LOST_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "normal guardian termination observed after manager replacement; no reap/exit-status claim",
  ),
  matrixRow(
    "LIFETIME_REMOVAL_INTENT_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "every target is terminal; no anchor/result relationship is open; the current-segment normal guardian is not-created, reaped, parentage-lost, or absent because reboot superseded the prior actor; and every current-segment recovery launch is not-created or termination followed by reap or parentage-lost",
  ),
  matrixRow(
    "LIFETIME_PATH_ABSENT_OBSERVED",
    "service manager; epoch = manager actor",
    "null",
    "lifetime removal intent",
  ),
  matrixRow(
    "LIFETIME_CLOSED_DURABLE",
    "service manager; epoch = manager actor",
    "null",
    "lifetime pathname absence observation; no successor in this segment",
  ),
]);

const RECORD_TYPE_RELATIONSHIP_MATRIX_SHA256 =
  semanticSha256(RELATIONSHIP_MATRIX);

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

const EXPECTED_REQUIREMENTS = Object.freeze({
  schema: SCHEMAS.requirements,
  identitySchema: SCHEMAS.identity,
  contextSchema: SCHEMAS.context,
  recordSchema: SCHEMAS.record,
  replaySchema: SCHEMAS.replay,
  rebootTransitionSchema: SCHEMAS.rebootTransition,
  rebootTransitionChainEventSchema: SCHEMAS.rebootTransitionChainEvent,
  partialLaunchResolutionSchema: SCHEMAS.partialLaunchResolution,
  noChildLaunchFailureSchema: SCHEMAS.noChildLaunchFailure,
  targetGenesisInventorySchema: SCHEMAS.targetGenesisInventory,
  recoveryTargetProjectionSchema: SCHEMAS.recoveryTargetProjection,
  targetGenesisEventSchema: SCHEMAS.targetGenesisEvent,
  anchorEventSchema: SCHEMAS.anchorEvent,
  anchorProjectionSchema: SCHEMAS.anchorProjection,
  normalCloseReceiptProjectionSchema: SCHEMAS.normalCloseReceiptProjection,
  externalHeadSchema: SCHEMAS.externalHead,
  journalV2RequirementsSha256:
    "95a4311224d8dfa5f481436e87da4b4d5f56a00d67278e7ed0e931476b584e26",
  guardianControlRequirementsBindingRule:
    RULES.guardianControlRequirementsBindingRule,
  authoritySha256: semanticSha256(EXPECTED_AUTHORITY),
  nonclaimsSha256: semanticSha256(EXPECTED_NONCLAIMS),
  physicalFactsSha256: semanticSha256(EXPECTED_PHYSICAL_FACTS),
  recordFilename: "<16-digit-sequence>-<record-raw-sha256>.jsonl",
  embeddedBytesEncoding: "rfc4648-canonical-padded-base64",
  rawHashAlgorithm: "sha256-canonical-jsonl-with-final-lf/v1",
  semanticHashAlgorithm: "sha256-canonical-json-without-final-lf/v1",
  bindingHashAlgorithm: "sha256-canonical-binding-json-without-final-lf/v1",
  operationArtifactSchemaPattern:
    "oxigraph.candidate-containment-guardian-lifetime-operation/<lower-kebab-record-type>/v1",
  evidenceArtifactSchemaPattern:
    "oxigraph.candidate-containment-guardian-lifetime-evidence/<lower-kebab-record-type>/v1",
  operationBindingSchema:
    "oxigraph.candidate-containment-guardian-lifetime-operation-binding/v1",
  evidenceBindingSchema:
    "oxigraph.candidate-containment-guardian-lifetime-evidence-binding/v1",
  operationAndEvidencePayloadShape: "opaque-bounded-canonical-json",
  sequenceStartsAt: 1,
  sequenceWidth: 16,
  maximumLifetimeSegments: 5,
  maximumRecordsPerSegment: 256,
  maximumRecordsAcrossSegments: 1280,
  maximumControlValueBytes: 16384,
  maximumOperationOrEvidenceBytes: 16384,
  maximumRecordBytes: 65536,
  maximumAggregateRecordBytes: 83886080,
  maximumRecoveryAttemptsPerTarget: 4,
  maximumBootTransitionsPerTarget: 4,
  maximumTargetsPerLifetime: 6,
  maximumSemanticGlobalRecords: 25,
  maximumSemanticRecordsPerTarget: 37,
  maximumSemanticRecordsAcrossLifetime: 247,
  minimumLifetimeClosureReserve: 3,
  genesisRawSha256: ZERO_SHA256,
  lifetimeKinds: LIFETIME_KINDS,
  writerKinds: WRITER_KINDS,
  recordTypes: RECORD_TYPES,
  replayStatuses: REPLAY_STATUSES,
  noChildErrnoNames: NO_CHILD_ERRNO_NAMES,
  lifetimeBoundaryBrandProtocol:
    "complete-tail-matched-lifetime-replay-weakmap-pair-brand/v1",
  recordTypeRelationshipMatrixSha256: RECORD_TYPE_RELATIONSHIP_MATRIX_SHA256,
  structuralTailOptional: true,
  completeTailRequiredForBoundarySelection: true,
  completeTailRequiredForRecordCreation: true,
  recordGrammarRule: RULES.recordGrammarRule,
  actorWriterHandoffRule: RULES.actorWriterHandoffRule,
  replayStatusRule: RULES.replayStatusRule,
  perBootTransitionRule: RULES.perBootTransitionRule,
  rebootTransitionCatchupRule: RULES.rebootTransitionCatchupRule,
  rebootSupersessionRule: RULES.rebootSupersessionRule,
  configuredContextRule: RULES.configuredContextRule,
  targetGenesisInventoryRule: RULES.targetGenesisInventoryRule,
  targetGenesisEventRule: RULES.targetGenesisEventRule,
  recoveryTargetProjectionRule: RULES.recoveryTargetProjectionRule,
  recoveryTargetUniquenessRule: RULES.recoveryTargetUniquenessRule,
  targetSelectorPairRule: RULES.targetSelectorPairRule,
  boundarySetAssertionRule: RULES.boundarySetAssertionRule,
  targetRebootTransitionRule: RULES.targetRebootTransitionRule,
  partialLaunchResolutionRule: RULES.partialLaunchResolutionRule,
  anchorPairRule: RULES.anchorPairRule,
  externalHeadProgressionRule: RULES.externalHeadProgressionRule,
  normalCloseReceiptRule: RULES.normalCloseReceiptRule,
  appendReserveRule: RULES.appendReserveRule,
  filesystemMechanicsImplemented: false,
  cgroupMechanicsImplemented: false,
  guardianExecutionProven: false,
  boundaryOriginProven: false,
  runtimeRegistrationPermitted: false,
  qualificationPermitted: false,
  promotionPermitted: false,
  publicationPermitted: false,
});

// Replaced with the independently computed literal after the complete projection
// above is frozen. Production must compute this value from its own constants.
const EXPECTED_REQUIREMENTS_SHA256 =
  "764975dd915913db4c4e0fc7bee308f8cb830c5f972ac0b97355601e7ff1b773";

const RECORD_WRAPPER_KEYS = Object.freeze([
  "bytes",
  "name",
  "rawSha256",
  "semanticSha256",
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
  "standaloneRecordHashChainValidated",
  "recordGrammarValidated",
  "embeddedArtifactBindingsValidated",
]);

const REPLAY_KEYS = Object.freeze([
  "schema",
  "requirementsSha256",
  "status",
  "stateRootIdentitySha256",
  "segmentCount",
  "recordCount",
  "latestLifetimeEpochSha256",
  "latestLifetimeRecordSequence",
  "latestLifetimeRecordRawSha256",
  "targetCount",
  "targets",
  "internalHashChainsValidated",
  "lifetimeSuccessorBindingsMatched",
  "stateRootIdentityAnchorMatched",
  "expectedTailMatched",
  "tailCompletenessExternallyAnchored",
  "authority",
  "nonclaims",
  "physicalFacts",
]);

const TARGET_SUMMARY_KEYS = Object.freeze([
  "generationIdentitySha256",
  "targetSha256",
  "recoveryTargetProjection",
  "lifetimeTargetRecordRawSha256",
  "currentBootIdSha256",
  "currentDelegatedRootIdentitySha256",
  "currentLifetimeCgroupIdentitySha256",
  "bootTransitionCount",
  "attemptCount",
  "latestExternalHead",
  "attemptAnchors",
  "normalCloseReceipt",
  "normalCloseReceiptRecordRawSha256",
]);

const IDENTITY_KEYS = Object.freeze([
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
  "identitySha256",
]);

const RECORD_VALUE_KEYS = Object.freeze([
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

function assertNullPrototypeFrozen(value) {
  assert.equal(Object.getPrototypeOf(value), null);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    if (
      child !== null &&
      typeof child === "object" &&
      !ArrayBuffer.isView(child)
    ) {
      if (Array.isArray(child)) {
        assert.equal(Object.isFrozen(child), true);
        for (const item of child) {
          if (item !== null && typeof item === "object") {
            assertNullPrototypeFrozen(item);
          }
        }
      } else {
        assertNullPrototypeFrozen(child);
      }
    }
  }
}

function artifact(record) {
  return { name: record.name, bytes: record.bytes };
}

function renamed(sequence, bytes) {
  return {
    name: `${sequence}-${sha256(bytes)}.jsonl`,
    bytes,
  };
}

function expectedDescriptor(kind, context, bytes) {
  const lowerRecordType = context.recordType.toLowerCase().replaceAll("_", "-");
  const artifactSchema = `oxigraph.candidate-containment-guardian-lifetime-${kind}/${lowerRecordType}/v1`;
  const rawSha256 = sha256(bytes);
  const semanticSha256Value = semanticSha256(
    JSON.parse(bytes.toString("utf8")),
  );
  const binding = {
    schema: `oxigraph.candidate-containment-guardian-lifetime-${kind}-binding/v1`,
    kind,
    artifactSchema,
    sequence: context.sequence,
    recordType: context.recordType,
    lifetimeIdentitySha256: context.lifetimeIdentity.identitySha256,
    writerKind: context.writerKind,
    writerActorEpochSha256: context.writerActorEpochSha256,
    targetSha256: context.targetSha256,
    rawSha256,
    semanticSha256: semanticSha256Value,
  };
  return {
    schema: artifactSchema,
    rawSha256,
    semanticSha256: semanticSha256Value,
    bytesBase64: Buffer.from(bytes).toString("base64"),
    bindingSha256: semanticSha256(binding),
  };
}

function assertCanonicalRecord(record, context, operationBytes, evidenceBytes) {
  const operation = expectedDescriptor("operation", context, operationBytes);
  const evidence = expectedDescriptor("evidence", context, evidenceBytes);
  const recordValue = {
    schema: SCHEMAS.record,
    sequence: context.sequence,
    recordType: context.recordType,
    previousRecordRawSha256: context.previousRecordRawSha256,
    lifetimeIdentity: plain(context.lifetimeIdentity),
    writerKind: context.writerKind,
    writerActorEpochSha256: context.writerActorEpochSha256,
    targetSha256: context.targetSha256,
    operation,
    evidence,
  };
  const expectedBytes = jsonLine(recordValue);
  const expectedRawSha256 = sha256(expectedBytes);

  assert.deepEqual(Object.keys(record), RECORD_WRAPPER_KEYS);
  assert.deepEqual(record.bytes, expectedBytes);
  assert.equal(record.name, `${context.sequence}-${expectedRawSha256}.jsonl`);
  assert.equal(record.rawSha256, expectedRawSha256);
  assert.equal(record.semanticSha256, semanticSha256(recordValue));
  assert.equal(record.schema, SCHEMAS.record);
  assert.equal(record.sequence, context.sequence);
  assert.equal(record.recordType, context.recordType);
  assert.equal(record.previousRecordRawSha256, context.previousRecordRawSha256);
  assert.deepEqual(
    plain(record.lifetimeIdentity),
    plain(context.lifetimeIdentity),
  );
  assert.equal(record.writerKind, context.writerKind);
  assert.equal(record.writerActorEpochSha256, context.writerActorEpochSha256);
  assert.equal(record.targetSha256, context.targetSha256);
  assert.deepEqual(plain(record.operation), operation);
  assert.deepEqual(plain(record.evidence), evidence);
  assert.equal(record.standaloneRecordHashChainValidated, false);
  assert.equal(record.recordGrammarValidated, false);
  assert.equal(record.embeddedArtifactBindingsValidated, true);
  assertNullPrototypeFrozen(record);
}

function opaquePayload(label) {
  return {
    schema: "oxigraph.test.containment-guardian-lifetime-payload/v1",
    label,
    detailSha256: digest(`payload:${label}`),
  };
}

function externalHead(fields) {
  return digestValue(SCHEMAS.externalHead, fields, "externalHeadSha256");
}

function embeddedValue(record, kind) {
  return JSON.parse(
    Buffer.from(record[kind].bytesBase64, "base64").toString("utf8"),
  );
}

function partialLaunchResolutionValue(
  fixture,
  { launchRecord, targetSha256 = null },
) {
  const prefix = {
    schema: SCHEMAS.partialLaunchResolution,
    lifetimeIdentitySha256: fixture.currentSegment.identity.identitySha256,
    targetSha256,
    launchRecordRawSha256: launchRecord.rawSha256,
    reportedStateRootLockReacquired: true,
    reportedPriorManagerAbsent: true,
    reportedLifetimeCgroupIdentitySha256:
      fixture.currentSegment.context.lifetimeCgroupIdentitySha256,
    reportedLifetimeCgroupEmpty: true,
  };
  return { ...prefix, projectionSha256: semanticSha256(prefix) };
}

function mutateTargetGenesis(target, mutate) {
  const operation = embeddedValue(target.genesisRecord, "operation");
  const evidence = embeddedValue(target.genesisRecord, "evidence");
  const copy = JSON.parse(JSON.stringify({ operation, evidence }));
  mutate(copy);
  const { recoveryTargetProjection, targetGenesisInventory } = copy.operation;
  const projectionPrefix = { ...recoveryTargetProjection };
  delete projectionPrefix.projectionSha256;
  recoveryTargetProjection.projectionSha256 = semanticSha256(projectionPrefix);
  const inventoryPrefix = { ...targetGenesisInventory };
  delete inventoryPrefix.inventorySha256;
  targetGenesisInventory.inventorySha256 = semanticSha256(inventoryPrefix);
  const eventPrefix = { ...copy.operation };
  delete eventPrefix.eventSha256;
  copy.operation.eventSha256 = semanticSha256(eventPrefix);
  const headPrefix = { ...copy.evidence };
  delete headPrefix.externalHeadSha256;
  copy.evidence.externalHeadSha256 = semanticSha256(headPrefix);
  return copy;
}

function anchorEventValue(target, overrides = {}) {
  const actorEpoch =
    overrides.recoveryActorEpochSha256 ?? digest("manual-anchor-actor");
  const directory = overrides.attemptDirectoryName ?? actorEpoch;
  const previous = overrides.predecessorExternalHead ?? target.head;
  const projection = {
    schema: SCHEMAS.anchorProjection,
    targetSha256: overrides.targetSha256 ?? target.targetSha256,
    actorKind: overrides.actorKind ?? "RECOVERY_ONLY_GUARDIAN",
    recoveryActorEpochSha256: actorEpoch,
    attemptDirectoryName: directory,
    expectedStateRootIdentitySha256:
      overrides.expectedStateRootIdentitySha256 ??
      target.currentAnchor?.projection.expectedStateRootIdentitySha256 ??
      digest("manual-anchor-state-root"),
    expectedCurrentBootIdSha256:
      overrides.expectedCurrentBootIdSha256 ??
      target.currentContext.bootIdSha256,
    expectedDelegatedRootIdentitySha256:
      overrides.expectedDelegatedRootIdentitySha256 ??
      target.currentContext.delegatedRootIdentitySha256,
    expectedLifetimeCgroupIdentitySha256:
      overrides.expectedLifetimeCgroupIdentitySha256 ??
      target.currentContext.lifetimeCgroupIdentitySha256,
    previousRecoveryActorEpochSha256:
      overrides.previousRecoveryActorEpochSha256 ??
      previous.recoveryActorEpochSha256,
    previousAttemptDirectoryName:
      overrides.previousAttemptDirectoryName ?? previous.attemptDirectoryName,
    previousRecoveryRecordSequence:
      overrides.previousRecoveryRecordSequence ??
      previous.latestRecoveryRecordSequence,
    previousRecoveryRecordRawSha256:
      overrides.previousRecoveryRecordRawSha256 ??
      previous.latestRecoveryRecordRawSha256,
  };
  const eventPrefix = {
    schema: SCHEMAS.anchorEvent,
    predecessorExternalHead: previous,
    anchorProjection: projection,
  };
  return { ...eventPrefix, eventSha256: semanticSha256(eventPrefix) };
}

class LifetimeFixture {
  constructor(label = "fixture") {
    this.label = label;
    this.stateRootIdentitySha256 = digest(`${label}:state-root`);
    this.managerActorEpochSha256 = digest(`${label}:manager-actor`);
    this.limitsSha256 = digest(`${label}:limits`);
    this.guardianExecutableIdentitySha256 = digest(
      `${label}:guardian-executable`,
    );
    this.guardianControlRequirementsSha256 = digest(
      `${label}:guardian-control-requirements`,
    );
    this.segments = [];
    this.targets = new Map();
    this.recordTypesSeen = new Set();
    this.actorIndex = 0;
    this.targetIndex = 0;
    this.zeroReplay = lifetime.replayCandidateContainmentGuardianLifetimeV1({
      segments: [],
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256: null,
      expectedLatestRecordSequence: null,
      expectedLatestRecordRawSha256: null,
    });
    this.latestReplay = this.zeroReplay;
  }

  get currentSegment() {
    return this.segments.at(-1);
  }

  replay({ exactTail = true } = {}) {
    const latestRecord = this.currentSegment?.records.at(-1);
    const replay = lifetime.replayCandidateContainmentGuardianLifetimeV1({
      segments: this.segments.map((segment) => ({
        lifetimeIdentity: segment.identity,
        records: segment.records.map(artifact),
      })),
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256: exactTail
        ? this.currentSegment.identity.lifetimeEpochSha256
        : null,
      expectedLatestRecordSequence: exactTail ? latestRecord.sequence : null,
      expectedLatestRecordRawSha256: exactTail ? latestRecord.rawSha256 : null,
    });
    assert.deepEqual(Object.keys(replay), REPLAY_KEYS);
    this.latestReplay = replay;
    return replay;
  }

  startNormal(overrides = {}) {
    assert.equal(this.segments.length, 0);
    const input = {
      lifetimeKind: "NORMAL",
      stateRootIdentitySha256: this.stateRootIdentitySha256,
      managerActorEpochSha256: this.managerActorEpochSha256,
      bootIdSha256: digest(`${this.label}:boot:0`),
      delegatedRootIdentitySha256: digest(`${this.label}:delegated-root:0`),
      lifetimeEpochSha256: digest(`${this.label}:lifetime-epoch:0`),
      limitsSha256: this.limitsSha256,
      guardianExecutableIdentitySha256: this.guardianExecutableIdentitySha256,
      guardianControlRequirementsSha256: this.guardianControlRequirementsSha256,
      previousLifetimeReplay: this.zeroReplay,
      ...overrides,
    };
    const identity =
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(input);
    this.assertIdentity(identity, input, {
      previousLifetimeEpochSha256: null,
      previousLifetimeRecordSequence: null,
      previousLifetimeRecordRawSha256: ZERO_SHA256,
    });
    this.segments.push({
      identity,
      records: [],
      context: null,
      predecessorTail: null,
    });
    return identity;
  }

  startReboot(overrides = {}) {
    const predecessor = this.latestReplay;
    const predecessorSegment = this.currentSegment;
    const predecessorRecord = predecessorSegment.records.at(-1);
    const index = this.segments.length;
    const input = {
      lifetimeKind: "REBOOT_RECOVERY",
      stateRootIdentitySha256: this.stateRootIdentitySha256,
      managerActorEpochSha256: this.managerActorEpochSha256,
      bootIdSha256: digest(`${this.label}:boot:${index}`),
      delegatedRootIdentitySha256: digest(
        `${this.label}:delegated-root:${index}`,
      ),
      lifetimeEpochSha256: digest(`${this.label}:lifetime-epoch:${index}`),
      limitsSha256: this.limitsSha256,
      guardianExecutableIdentitySha256: this.guardianExecutableIdentitySha256,
      guardianControlRequirementsSha256: this.guardianControlRequirementsSha256,
      previousLifetimeReplay: predecessor,
      ...overrides,
    };
    const identity =
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(input);
    this.assertIdentity(identity, input, {
      previousLifetimeEpochSha256:
        predecessorSegment.identity.lifetimeEpochSha256,
      previousLifetimeRecordSequence: predecessorRecord.sequence,
      previousLifetimeRecordRawSha256: predecessorRecord.rawSha256,
    });
    this.segments.push({
      identity,
      records: [],
      context: null,
      predecessorTail: {
        bootIdSha256: predecessorSegment.identity.bootIdSha256,
        delegatedRootIdentitySha256:
          predecessorSegment.identity.delegatedRootIdentitySha256,
        configured: predecessorSegment.context !== null,
        lifetimeCgroupIdentitySha256:
          predecessorSegment.context?.lifetimeCgroupIdentitySha256 ?? null,
        lifetimeEpochSha256: predecessorSegment.identity.lifetimeEpochSha256,
        recordRawSha256: predecessorRecord.rawSha256,
      },
    });
    return identity;
  }

  assertIdentity(identity, input, predecessor) {
    const expectedPrefix = {
      schema: SCHEMAS.identity,
      lifetimeKind: input.lifetimeKind,
      stateRootIdentitySha256: input.stateRootIdentitySha256,
      managerActorEpochSha256: input.managerActorEpochSha256,
      bootIdSha256: input.bootIdSha256,
      delegatedRootIdentitySha256: input.delegatedRootIdentitySha256,
      lifetimeEpochSha256: input.lifetimeEpochSha256,
      lifetimeCgroupName: `guardian-${input.lifetimeEpochSha256}`,
      limitsSha256: input.limitsSha256,
      guardianExecutableIdentitySha256: input.guardianExecutableIdentitySha256,
      guardianControlRequirementsSha256:
        input.guardianControlRequirementsSha256,
      ...predecessor,
    };
    const expected = {
      ...expectedPrefix,
      identitySha256: semanticSha256(expectedPrefix),
    };
    assert.deepEqual(Object.keys(identity), IDENTITY_KEYS);
    assert.deepEqual(plain(identity), expected);
    assertNullPrototypeFrozen(identity);
  }

  append(recordType, options = {}) {
    const segment = this.currentSegment;
    assert.notEqual(segment, undefined);
    const previousRecord = segment.records.at(-1);
    const sequence = String(segment.records.length + 1).padStart(16, "0");
    const writerKind = options.writerKind ?? "SERVICE_MANAGER";
    const writerActorEpochSha256 =
      options.writerActorEpochSha256 ?? this.managerActorEpochSha256;
    const targetSha256 = options.targetSha256 ?? null;
    const operationBytes = jsonLine(
      options.operation ??
        opaquePayload(`${this.label}:${recordType}:operation`),
    );
    const evidenceBytes = jsonLine(
      options.evidence ?? opaquePayload(`${this.label}:${recordType}:evidence`),
    );
    const previousLifetimeReplay =
      segment.records.length === 0 && this.segments.length === 1
        ? this.zeroReplay
        : this.latestReplay;
    const record = lifetime.createCandidateContainmentGuardianLifetimeRecordV1({
      previousLifetimeReplay,
      lifetimeIdentity: segment.identity,
      writerKind,
      writerActorEpochSha256,
      targetSha256,
      recordType,
      operationBytes,
      evidenceBytes,
    });
    const recordContext = {
      sequence,
      recordType,
      previousRecordRawSha256: previousRecord?.rawSha256 ?? ZERO_SHA256,
      lifetimeIdentity: segment.identity,
      writerKind,
      writerActorEpochSha256,
      targetSha256,
    };
    assertCanonicalRecord(record, recordContext, operationBytes, evidenceBytes);
    const verified =
      lifetime.verifyCandidateContainmentGuardianLifetimeRecordV1(
        artifact(record),
      );
    assert.deepEqual(verified.bytes, record.bytes);
    assert.equal(verified.name, record.name);
    assertCanonicalRecord(
      verified,
      recordContext,
      operationBytes,
      evidenceBytes,
    );
    segment.records.push(record);
    this.recordTypesSeen.add(recordType);
    const replay = this.replay();
    return { record, replay };
  }

  appendEpoch() {
    return this.append(
      this.currentSegment.identity.lifetimeKind === "NORMAL"
        ? "NORMAL_LIFETIME_EPOCH_CONSUMED"
        : "REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED",
    );
  }

  appendConfigured() {
    this.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
    return this.appendConfiguredObservation();
  }

  configuredContextValue() {
    const identity = this.currentSegment.identity;
    const contextPrefix = {
      schema: SCHEMAS.context,
      lifetimeIdentitySha256: identity.identitySha256,
      stateRootIdentitySha256: identity.stateRootIdentitySha256,
      bootIdSha256: identity.bootIdSha256,
      delegatedRootIdentitySha256: identity.delegatedRootIdentitySha256,
      lifetimeCgroupIdentitySha256: digest(
        `${this.label}:lifetime-cgroup:${this.segments.length - 1}`,
      ),
    };
    const context = {
      ...contextPrefix,
      contextSha256: semanticSha256(contextPrefix),
    };
    return context;
  }

  appendConfiguredObservation() {
    const context = this.configuredContextValue();
    const result = this.append("LIFETIME_CGROUP_CONFIGURED_OBSERVED", {
      evidence: context,
    });
    this.currentSegment.context = context;
    return result;
  }

  appendNormalAdoption() {
    this.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
    this.append("GUARDIAN_PIDFD_OBSERVED");
    this.append("GUARDIAN_EXEC_OBSERVED");
    this.append("GUARDIAN_MEMBERSHIP_OBSERVED");
    return this.append("GUARDIAN_INITIALIZATION_ADOPTED", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256: this.currentSegment.identity.lifetimeEpochSha256,
    });
  }

  appendNormalNotCreated(errnoName = "EAGAIN") {
    const launch = this.append("GUARDIAN_LAUNCH_INTENT_DURABLE").record;
    const failurePrefix = {
      schema: SCHEMAS.noChildLaunchFailure,
      lifetimeIdentitySha256: this.currentSegment.identity.identitySha256,
      targetSha256: null,
      launchRecordRawSha256: launch.rawSha256,
      syscall: "clone3",
      resultClass: "DEFINITE_NO_CHILD",
      errnoName,
      reportedChildCreated: false,
      reportedPidfdReturned: false,
    };
    return this.append("GUARDIAN_NOT_CREATED_OBSERVED", {
      evidence: {
        ...failurePrefix,
        projectionSha256: semanticSha256(failurePrefix),
      },
    });
  }

  appendNormalTermination({ parentageLost = false } = {}) {
    this.append("GUARDIAN_TERMINATION_OBSERVED");
    return this.append(
      parentageLost
        ? "GUARDIAN_PARENTAGE_LOST_OBSERVED"
        : "GUARDIAN_REAPED_OBSERVED",
    );
  }

  addTarget({ writerKind, transitions = [] } = {}) {
    const index = this.targetIndex++;
    const targetSha256 = digest(`${this.label}:target:${index}`);
    const generationIdentitySha256 = digest(
      `${this.label}:generation:${index}`,
    );
    const origin = transitions[0]
      ? {
          bootIdSha256: transitions[0].previousBootIdSha256,
          delegatedRootIdentitySha256:
            transitions[0].previousDelegatedRootIdentitySha256,
          lifetimeEpochSha256: transitions[0].previousLifetimeEpochSha256,
        }
      : {
          bootIdSha256: this.currentSegment.identity.bootIdSha256,
          delegatedRootIdentitySha256:
            this.currentSegment.identity.delegatedRootIdentitySha256,
          lifetimeEpochSha256: this.currentSegment.identity.lifetimeEpochSha256,
        };
    const projectionPrefix = {
      schema: SCHEMAS.recoveryTargetProjection,
      generationIdentitySha256,
      generationManifestRawSha256: digest(
        `${this.label}:generation-manifest:${index}`,
      ),
      targetSha256,
      targetBootIdSha256: origin.bootIdSha256,
      targetDelegatedRootIdentitySha256: origin.delegatedRootIdentitySha256,
      targetLifetimeEpochSha256: origin.lifetimeEpochSha256,
      latestBundleSequence: null,
      latestBundleRawSha256: null,
      latestInnerRecordRawSha256: null,
      latestNormalState: null,
    };
    const recoveryTargetProjection = {
      ...projectionPrefix,
      projectionSha256: semanticSha256(projectionPrefix),
    };
    const inventoryPrefix = {
      schema: SCHEMAS.targetGenesisInventory,
      targetSha256,
      reportedRecoveryDirectoryPresent: true,
      reportedRecoveryDirectoryEntryCount: 0,
      reportedExistingLifetimeTargetHead: false,
    };
    const targetGenesisInventory = {
      ...inventoryPrefix,
      inventorySha256: semanticSha256(inventoryPrefix),
    };
    const eventPrefix = {
      schema: SCHEMAS.targetGenesisEvent,
      recoveryTargetProjection,
      targetGenesisInventory,
      provedRebootTransitions: transitions,
    };
    const event = {
      ...eventPrefix,
      eventSha256: semanticSha256(eventPrefix),
    };
    const head = externalHead({
      targetSha256,
      result: "NO_RECOVERY_ATTEMPT",
      recoveryActorEpochSha256: null,
      attemptDirectoryName: null,
      lifetimeAttemptAnchorRawSha256: null,
      latestRecoveryRecordSequence: null,
      latestRecoveryRecordRawSha256: ZERO_SHA256,
    });
    const selectedWriterKind =
      writerKind ??
      (this.currentSegment.identity.lifetimeKind === "NORMAL"
        ? "LIVE_BIRTH_GUARDIAN"
        : "SERVICE_MANAGER");
    const result = this.append("GENERATION_RECOVERY_HEAD_DURABLE", {
      writerKind: selectedWriterKind,
      writerActorEpochSha256:
        selectedWriterKind === "LIVE_BIRTH_GUARDIAN"
          ? this.currentSegment.identity.lifetimeEpochSha256
          : this.managerActorEpochSha256,
      targetSha256,
      operation: event,
      evidence: head,
    });
    const target = {
      targetSha256,
      generationIdentitySha256,
      projection: recoveryTargetProjection,
      genesisRecord: result.record,
      head,
      anchors: [],
      currentContext: this.currentSegment.context,
      transitionCount: transitions.length,
      terminal: false,
    };
    this.targets.set(targetSha256, target);
    return target;
  }

  addAnchor(target, actorKind = "RECOVERY_ONLY_GUARDIAN") {
    const actorIndex = this.actorIndex++;
    const recoveryActorEpochSha256 = digest(
      `${this.label}:recovery-actor:${actorIndex}`,
    );
    const previous = target.head;
    const anchorProjection = {
      schema: SCHEMAS.anchorProjection,
      targetSha256: target.targetSha256,
      actorKind,
      recoveryActorEpochSha256,
      attemptDirectoryName: recoveryActorEpochSha256,
      expectedStateRootIdentitySha256: this.stateRootIdentitySha256,
      expectedCurrentBootIdSha256: target.currentContext.bootIdSha256,
      expectedDelegatedRootIdentitySha256:
        target.currentContext.delegatedRootIdentitySha256,
      expectedLifetimeCgroupIdentitySha256:
        target.currentContext.lifetimeCgroupIdentitySha256,
      previousRecoveryActorEpochSha256: previous.recoveryActorEpochSha256,
      previousAttemptDirectoryName: previous.attemptDirectoryName,
      previousRecoveryRecordSequence: previous.latestRecoveryRecordSequence,
      previousRecoveryRecordRawSha256: previous.latestRecoveryRecordRawSha256,
    };
    const eventPrefix = {
      schema: SCHEMAS.anchorEvent,
      predecessorExternalHead: previous,
      anchorProjection,
    };
    const event = {
      ...eventPrefix,
      eventSha256: semanticSha256(eventPrefix),
    };
    const writerKind =
      actorKind === "LIVE_BIRTH_GUARDIAN"
        ? "LIVE_BIRTH_GUARDIAN"
        : "SERVICE_MANAGER";
    const result = this.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
      writerKind,
      writerActorEpochSha256:
        writerKind === "LIVE_BIRTH_GUARDIAN"
          ? recoveryActorEpochSha256
          : this.managerActorEpochSha256,
      targetSha256: target.targetSha256,
      evidence: event,
    });
    const anchor = {
      actorKind,
      recoveryActorEpochSha256,
      attemptDirectoryName: recoveryActorEpochSha256,
      projection: anchorProjection,
      record: result.record,
      result: null,
      launchRecord: null,
    };
    target.anchors.push(anchor);
    target.currentAnchor = anchor;
    return anchor;
  }

  appendRecoveryLaunch(target) {
    const anchor = target.currentAnchor;
    const launch = this.append("RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE", {
      targetSha256: target.targetSha256,
    }).record;
    anchor.launchRecord = launch;
    return launch;
  }

  appendRecoveryNotCreated(target, errnoName = "EAGAIN") {
    const anchor = target.currentAnchor;
    const failurePrefix = {
      schema: SCHEMAS.noChildLaunchFailure,
      lifetimeIdentitySha256: this.currentSegment.identity.identitySha256,
      targetSha256: target.targetSha256,
      launchRecordRawSha256: anchor.launchRecord.rawSha256,
      syscall: "clone3",
      resultClass: "DEFINITE_NO_CHILD",
      errnoName,
      reportedChildCreated: false,
      reportedPidfdReturned: false,
    };
    return this.append("RECOVERY_GUARDIAN_NOT_CREATED_OBSERVED", {
      targetSha256: target.targetSha256,
      evidence: {
        ...failurePrefix,
        projectionSha256: semanticSha256(failurePrefix),
      },
    });
  }

  appendRecoveryMembership(target) {
    this.append("RECOVERY_GUARDIAN_PIDFD_OBSERVED", {
      targetSha256: target.targetSha256,
    });
    this.append("RECOVERY_GUARDIAN_EXEC_OBSERVED", {
      targetSha256: target.targetSha256,
    });
    return this.append("RECOVERY_GUARDIAN_MEMBERSHIP_OBSERVED", {
      targetSha256: target.targetSha256,
    });
  }

  appendResult(
    target,
    {
      result = "FINALIZED_ATTEMPT_PREFIX",
      managerWriter = false,
      anchoredEmpty = false,
    } = {},
  ) {
    const anchor = target.currentAnchor;
    const head = externalHead({
      targetSha256: target.targetSha256,
      result: anchoredEmpty ? "ANCHORED_EMPTY_ATTEMPT" : result,
      recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
      attemptDirectoryName: anchor.attemptDirectoryName,
      lifetimeAttemptAnchorRawSha256: anchor.record.rawSha256,
      latestRecoveryRecordSequence: anchoredEmpty ? null : "0000000000000001",
      latestRecoveryRecordRawSha256: anchoredEmpty
        ? ZERO_SHA256
        : digest(
            `${this.label}:recovery-head:${anchor.recoveryActorEpochSha256}`,
          ),
    });
    const writerKind = managerWriter ? "SERVICE_MANAGER" : anchor.actorKind;
    const resultRecord = this.append("RECOVERY_ATTEMPT_RESULT_DURABLE", {
      writerKind,
      writerActorEpochSha256: managerWriter
        ? this.managerActorEpochSha256
        : anchor.recoveryActorEpochSha256,
      targetSha256: target.targetSha256,
      evidence: head,
    }).record;
    anchor.result = resultRecord;
    target.head = head;
    target.terminal = result === "RECOVERED" || result === "QUARANTINED";
    return resultRecord;
  }

  appendRecoveryTermination(target, { parentageLost = false } = {}) {
    this.append("RECOVERY_GUARDIAN_TERMINATION_OBSERVED", {
      targetSha256: target.targetSha256,
    });
    return this.append(
      parentageLost
        ? "RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED"
        : "RECOVERY_GUARDIAN_REAPED_OBSERVED",
      { targetSha256: target.targetSha256 },
    );
  }

  makeDirectTransition(target) {
    const previous = this.currentSegment.predecessorTail;
    const currentIdentity = this.currentSegment.identity;
    const currentContext = this.currentSegment.context;
    const prefix = {
      schema: SCHEMAS.rebootTransition,
      targetSha256: target.targetSha256,
      previousBootIdSha256: previous.bootIdSha256,
      previousDelegatedRootIdentitySha256: previous.delegatedRootIdentitySha256,
      previousSegmentConfigured: previous.configured,
      previousLifetimeCgroupIdentitySha256:
        previous.lifetimeCgroupIdentitySha256,
      previousLifetimeEpochSha256: previous.lifetimeEpochSha256,
      previousLifetimeRecordRawSha256: previous.recordRawSha256,
      currentBootIdSha256: currentIdentity.bootIdSha256,
      currentDelegatedRootIdentitySha256:
        currentIdentity.delegatedRootIdentitySha256,
      currentSegmentConfigured: true,
      currentLifetimeCgroupIdentitySha256:
        currentContext.lifetimeCgroupIdentitySha256,
      currentLifetimeEpochSha256: currentIdentity.lifetimeEpochSha256,
      reportedPreviousLifetimeCgroupAbsent: true,
      reportedControlCgroupAbsent: true,
      reportedJobCgroupAbsent: true,
    };
    return { ...prefix, transitionSha256: semanticSha256(prefix) };
  }

  appendTransition(target, transitions = [this.makeDirectTransition(target)]) {
    const eventPrefix = {
      schema: SCHEMAS.rebootTransitionChainEvent,
      targetSha256: target.targetSha256,
      transitions,
    };
    const event = {
      ...eventPrefix,
      eventSha256: semanticSha256(eventPrefix),
    };
    const result = this.append("TARGET_REBOOT_TRANSITION_OBSERVED", {
      targetSha256: target.targetSha256,
      operation: event,
    });
    target.currentContext = this.currentSegment.context;
    target.transitionCount += transitions.length;
    return result;
  }

  appendNormalClose(target) {
    const receipt = {
      schema: SCHEMAS.normalCloseReceiptProjection,
      targetSha256: target.targetSha256,
      sourceLocation: "active",
      destinationLocation: "closed",
      activeParentSynced: true,
      closedParentSynced: true,
      closedLocationReobserved: true,
    };
    const result = this.append("NORMAL_CLOSE_RECEIPT_DURABLE", {
      targetSha256: target.targetSha256,
      evidence: receipt,
    });
    target.terminal = true;
    target.normalCloseReceipt = receipt;
    target.normalCloseRecord = result.record;
    return result;
  }

  appendLifetimeClose() {
    this.append("LIFETIME_REMOVAL_INTENT_DURABLE");
    this.append("LIFETIME_PATH_ABSENT_OBSERVED");
    return this.append("LIFETIME_CLOSED_DURABLE");
  }
}

function bootstrapNormal(label, { adopt = true, notCreated = false } = {}) {
  const fixture = new LifetimeFixture(label);
  fixture.startNormal();
  fixture.appendEpoch();
  fixture.appendConfigured();
  if (adopt) fixture.appendNormalAdoption();
  if (notCreated) fixture.appendNormalNotCreated();
  return fixture;
}

function transitionValue({ targetSha256, previous, current }) {
  const prefix = {
    schema: SCHEMAS.rebootTransition,
    targetSha256,
    previousBootIdSha256: previous.bootIdSha256,
    previousDelegatedRootIdentitySha256: previous.delegatedRootIdentitySha256,
    previousSegmentConfigured: previous.configured,
    previousLifetimeCgroupIdentitySha256: previous.lifetimeCgroupIdentitySha256,
    previousLifetimeEpochSha256: previous.lifetimeEpochSha256,
    previousLifetimeRecordRawSha256: previous.recordRawSha256,
    currentBootIdSha256: current.bootIdSha256,
    currentDelegatedRootIdentitySha256: current.delegatedRootIdentitySha256,
    currentSegmentConfigured: current.configured,
    currentLifetimeCgroupIdentitySha256: current.lifetimeCgroupIdentitySha256,
    currentLifetimeEpochSha256: current.lifetimeEpochSha256,
    reportedPreviousLifetimeCgroupAbsent: true,
    reportedControlCgroupAbsent: true,
    reportedJobCgroupAbsent: true,
  };
  return { ...prefix, transitionSha256: semanticSha256(prefix) };
}

function candidateRebootIdentity(fixture, label = "forbidden-reboot") {
  const predecessorSegment = fixture.currentSegment;
  const predecessorRecord = predecessorSegment.records.at(-1);
  const prefix = {
    schema: SCHEMAS.identity,
    lifetimeKind: "REBOOT_RECOVERY",
    stateRootIdentitySha256: fixture.stateRootIdentitySha256,
    managerActorEpochSha256: fixture.managerActorEpochSha256,
    bootIdSha256: digest(`${fixture.label}:${label}:boot`),
    delegatedRootIdentitySha256: digest(
      `${fixture.label}:${label}:delegated-root`,
    ),
    lifetimeEpochSha256: digest(`${fixture.label}:${label}:epoch`),
    lifetimeCgroupName: `guardian-${digest(`${fixture.label}:${label}:epoch`)}`,
    limitsSha256: fixture.limitsSha256,
    guardianExecutableIdentitySha256: fixture.guardianExecutableIdentitySha256,
    guardianControlRequirementsSha256:
      fixture.guardianControlRequirementsSha256,
    previousLifetimeEpochSha256:
      predecessorSegment.identity.lifetimeEpochSha256,
    previousLifetimeRecordSequence: predecessorRecord.sequence,
    previousLifetimeRecordRawSha256: predecessorRecord.rawSha256,
  };
  return { ...prefix, identitySha256: semanticSha256(prefix) };
}

function rebootIdentityInput(fixture, label = "candidate-reboot") {
  return {
    lifetimeKind: "REBOOT_RECOVERY",
    stateRootIdentitySha256: fixture.stateRootIdentitySha256,
    managerActorEpochSha256: fixture.managerActorEpochSha256,
    bootIdSha256: digest(`${fixture.label}:${label}:boot`),
    delegatedRootIdentitySha256: digest(
      `${fixture.label}:${label}:delegated-root`,
    ),
    lifetimeEpochSha256: digest(`${fixture.label}:${label}:epoch`),
    limitsSha256: fixture.limitsSha256,
    guardianExecutableIdentitySha256: fixture.guardianExecutableIdentitySha256,
    guardianControlRequirementsSha256:
      fixture.guardianControlRequirementsSha256,
    previousLifetimeReplay: fixture.latestReplay,
  };
}

function manualRecord({ identity, recordType, managerActorEpochSha256 }) {
  const sequence = "0000000000000001";
  const operationBytes = jsonLine(
    opaquePayload(`manual:${recordType}:operation`),
  );
  const evidenceBytes = jsonLine(
    opaquePayload(`manual:${recordType}:evidence`),
  );
  const context = {
    sequence,
    recordType,
    previousRecordRawSha256: ZERO_SHA256,
    lifetimeIdentity: identity,
    writerKind: "SERVICE_MANAGER",
    writerActorEpochSha256: managerActorEpochSha256,
    targetSha256: null,
  };
  const value = {
    schema: SCHEMAS.record,
    sequence,
    recordType,
    previousRecordRawSha256: ZERO_SHA256,
    lifetimeIdentity: identity,
    writerKind: "SERVICE_MANAGER",
    writerActorEpochSha256: managerActorEpochSha256,
    targetSha256: null,
    operation: expectedDescriptor("operation", context, operationBytes),
    evidence: expectedDescriptor("evidence", context, evidenceBytes),
  };
  const bytes = jsonLine(value);
  return renamed(sequence, bytes);
}

function assertContractReject(callback) {
  // The ADR says only that malformed contract inputs reject; it deliberately
  // does not ratify an exception class or message for those parse/grammar paths.
  assert.throws(callback);
}

function assertBrandTypeError(callback) {
  assert.throws(callback, (error) => error instanceof TypeError);
}

function assertRejectedBeforeSentinel(callback, sentinelState) {
  let thrown = null;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  assert.notEqual(thrown, null, "the oversized input must reject");
  assert.equal(
    sentinelState.accessed,
    false,
    "count/byte rejection must happen before inspecting the sentinel",
  );
  assert.notEqual(thrown, sentinelState.error);
}

function explosiveArtifact(label) {
  const state = {
    accessed: false,
    error: new Error(`unexpected sentinel access: ${label}`),
  };
  const value = {};
  for (const key of ["name", "bytes"]) {
    Object.defineProperty(value, key, {
      enumerable: true,
      get() {
        state.accessed = true;
        throw state.error;
      },
    });
  }
  return { state, value };
}

function exactReplayInput(fixture, overrides = {}) {
  const latestRecord = fixture.currentSegment?.records.at(-1) ?? null;
  return {
    segments: fixture.segments.map((segment) => ({
      lifetimeIdentity: segment.identity,
      records: segment.records.map(artifact),
    })),
    expectedStateRootIdentitySha256: fixture.stateRootIdentitySha256,
    expectedLatestLifetimeEpochSha256:
      fixture.currentSegment?.identity.lifetimeEpochSha256 ?? null,
    expectedLatestRecordSequence: latestRecord?.sequence ?? null,
    expectedLatestRecordRawSha256: latestRecord?.rawSha256 ?? null,
    ...overrides,
  };
}

function segmentTail(segment) {
  return {
    bootIdSha256: segment.identity.bootIdSha256,
    delegatedRootIdentitySha256: segment.identity.delegatedRootIdentitySha256,
    configured: segment.context !== null,
    lifetimeCgroupIdentitySha256:
      segment.context?.lifetimeCgroupIdentitySha256 ?? null,
    lifetimeEpochSha256: segment.identity.lifetimeEpochSha256,
    recordRawSha256: segment.records.at(-1).rawSha256,
  };
}

function canonicalMutation(record, mutate) {
  const value = JSON.parse(record.bytes.toString("utf8"));
  mutate(value);
  const bytes = jsonLine(value);
  return renamed(value.sequence, bytes);
}

function mutatedDigestValue(value, digestField, mutate) {
  const copy = JSON.parse(JSON.stringify(plain(value)));
  delete copy[digestField];
  mutate(copy);
  copy[digestField] = semanticSha256(copy);
  return copy;
}

function replayTwice(fixture) {
  return [
    lifetime.replayCandidateContainmentGuardianLifetimeV1(
      exactReplayInput(fixture),
    ),
    lifetime.replayCandidateContainmentGuardianLifetimeV1(
      exactReplayInput(fixture),
    ),
  ];
}

function freshAnchorCarrier(selection) {
  return Object.freeze(
    Object.assign(Object.create(null), {
      lifetimeAnchorProjection: selection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256: selection.lifetimeAttemptAnchorRawSha256,
    }),
  );
}

function appendFullRecoveryAttempt(
  fixture,
  target,
  { terminal = false, parentageLost = false } = {},
) {
  fixture.addAnchor(target);
  fixture.appendRecoveryLaunch(target);
  fixture.appendRecoveryMembership(target);
  fixture.appendResult(target, {
    result: terminal ? "RECOVERED" : "FINALIZED_ATTEMPT_PREFIX",
  });
  fixture.appendRecoveryTermination(target, { parentageLost });
}

function closeableNoChildLifetime(label) {
  const fixture = new LifetimeFixture(label);
  fixture.startNormal();
  fixture.appendEpoch();
  fixture.appendConfigured();
  fixture.appendNormalNotCreated();
  return fixture;
}

test("freezes the independently owned lifetime schemas, bounds, and requirements", () => {
  const publicFunctions = [
    "createCandidateContainmentGuardianLifetimeIdentityV1",
    "verifyCandidateContainmentGuardianLifetimeIdentityV1",
    "createCandidateContainmentGuardianLifetimeRecordV1",
    "verifyCandidateContainmentGuardianLifetimeRecordV1",
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
  ];
  for (const name of publicFunctions) {
    assert.equal(typeof lifetime[name], "function", name);
  }

  const exportedSchemas = {
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_IDENTITY_SCHEMA_V1:
      SCHEMAS.identity,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_CONTEXT_SCHEMA_V1: SCHEMAS.context,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_SCHEMA_V1: SCHEMAS.record,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_SCHEMA_V1: SCHEMAS.replay,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SCHEMA_V1:
      SCHEMAS.requirements,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_SCHEMA_V1:
      SCHEMAS.rebootTransition,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_REBOOT_TRANSITION_CHAIN_EVENT_SCHEMA_V1:
      SCHEMAS.rebootTransitionChainEvent,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PARTIAL_LAUNCH_RESOLUTION_SCHEMA_V1:
      SCHEMAS.partialLaunchResolution,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_LAUNCH_FAILURE_SCHEMA_V1:
      SCHEMAS.noChildLaunchFailure,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_INVENTORY_SCHEMA_V1:
      SCHEMAS.targetGenesisInventory,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_TARGET_PROJECTION_SCHEMA_V1:
      SCHEMAS.recoveryTargetProjection,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_TARGET_GENESIS_EVENT_SCHEMA_V1:
      SCHEMAS.targetGenesisEvent,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_EVENT_SCHEMA_V1:
      SCHEMAS.anchorEvent,
    CANDIDATE_CONTAINMENT_LIFETIME_RECOVERY_ATTEMPT_ANCHOR_PROJECTION_SCHEMA_V1:
      SCHEMAS.anchorProjection,
    CANDIDATE_CONTAINMENT_LIFETIME_NORMAL_CLOSE_RECEIPT_PROJECTION_SCHEMA_V1:
      SCHEMAS.normalCloseReceiptProjection,
    CANDIDATE_CONTAINMENT_RECOVERY_EXTERNAL_HEAD_SCHEMA_V1:
      SCHEMAS.externalHead,
  };
  for (const [name, expected] of Object.entries(exportedSchemas)) {
    assert.equal(lifetime[name], expected, name);
  }

  const exportedBounds = {
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_SEQUENCE_WIDTH_V1: 16,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEGMENTS_V1: 5,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_PER_SEGMENT_V1: 256,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORDS_ACROSS_SEGMENTS_V1: 1280,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_CONTROL_VALUE_BYTES_V1: 16384,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_OPERATION_OR_EVIDENCE_BYTES_V1: 16384,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECORD_BYTES_V1: 65536,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_AGGREGATE_RECORD_BYTES_V1: 83886080,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_RECOVERY_ATTEMPTS_PER_TARGET_V1: 4,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_BOOT_TRANSITIONS_PER_TARGET_V1: 4,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_TARGETS_V1: 6,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_GLOBAL_RECORDS_V1: 25,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_PER_TARGET_V1: 37,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MAX_SEMANTIC_RECORDS_V1: 247,
    CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_MIN_CLOSURE_RESERVE_V1: 3,
  };
  for (const [name, expected] of Object.entries(exportedBounds)) {
    assert.equal(lifetime[name], expected, name);
  }
  const expectedExportNames = [
    ...Object.keys(exportedSchemas),
    ...Object.keys(exportedBounds),
    ...publicFunctions,
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_KINDS_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_WRITER_KINDS_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_TYPES_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_STATUSES_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_ERRNO_NAMES_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_AUTHORITY_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NONCLAIMS_V1",
    "CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PHYSICAL_FACTS_V1",
  ].sort();
  assert.equal(expectedExportNames.length, 56);
  assert.deepEqual(Object.keys(lifetime).sort(), expectedExportNames);
  assert.equal(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_GENESIS_RAW_SHA256_V1,
    ZERO_SHA256,
  );
  assert.deepEqual(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_KINDS_V1,
    LIFETIME_KINDS,
  );
  assert.deepEqual(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_WRITER_KINDS_V1,
    WRITER_KINDS,
  );
  assert.deepEqual(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_TYPES_V1,
    RECORD_TYPES,
  );
  assert.deepEqual(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_STATUSES_V1,
    REPLAY_STATUSES,
  );
  assert.deepEqual(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_ERRNO_NAMES_V1,
    NO_CHILD_ERRNO_NAMES,
  );
  for (const value of [
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_KINDS_V1,
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_WRITER_KINDS_V1,
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_RECORD_TYPES_V1,
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REPLAY_STATUSES_V1,
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NO_CHILD_ERRNO_NAMES_V1,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.deepEqual(
    RELATIONSHIP_MATRIX.map(({ recordType }) => recordType),
    RECORD_TYPES,
  );

  const requirements =
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_V1;
  assert.deepEqual(
    Object.keys(requirements),
    Object.keys(EXPECTED_REQUIREMENTS),
  );
  assert.deepEqual(plain(requirements), plain(EXPECTED_REQUIREMENTS));
  assert.equal(
    RECORD_TYPE_RELATIONSHIP_MATRIX_SHA256,
    "51433108d1ce01bb1492c01fd18140fe290782f4a54a31f7d2c80f8dae64d8ab",
  );
  assert.equal(
    EXPECTED_REQUIREMENTS.authoritySha256,
    "5b4b7d42eb71357df74c6ec92d4e25d68b9477ca868a34037786d8072534c9c6",
  );
  assert.equal(
    EXPECTED_REQUIREMENTS.nonclaimsSha256,
    "ffdcf5d98706b660edc94c7c4ba81e6fafc18d96c9f8b9e913e1d71c091f4710",
  );
  assert.equal(
    EXPECTED_REQUIREMENTS.physicalFactsSha256,
    "729e54130c0a33a3d3b2833d3bacb310afa2fa0facc42b7752f6571f3c91185c",
  );
  assert.equal(
    semanticSha256(EXPECTED_REQUIREMENTS),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.equal(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1,
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assertNullPrototypeFrozen(requirements);
});

test("keeps replay authority, nonclaims, and physical facts exactly null", () => {
  assert.deepEqual(
    Object.keys(lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_AUTHORITY_V1),
    Object.keys(EXPECTED_AUTHORITY),
  );
  assert.deepEqual(
    plain(lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_AUTHORITY_V1),
    EXPECTED_AUTHORITY,
  );
  assert.deepEqual(
    Object.keys(lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NONCLAIMS_V1),
    Object.keys(EXPECTED_NONCLAIMS),
  );
  assert.deepEqual(
    plain(lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NONCLAIMS_V1),
    EXPECTED_NONCLAIMS,
  );
  assert.deepEqual(
    Object.keys(
      lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PHYSICAL_FACTS_V1,
    ),
    Object.keys(EXPECTED_PHYSICAL_FACTS),
  );
  assert.deepEqual(
    plain(lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PHYSICAL_FACTS_V1),
    EXPECTED_PHYSICAL_FACTS,
  );
  assertNullPrototypeFrozen(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_AUTHORITY_V1,
  );
  assertNullPrototypeFrozen(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_NONCLAIMS_V1,
  );
  assertNullPrototypeFrozen(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_PHYSICAL_FACTS_V1,
  );
});

test("classifies zero, normal setup, launch, and adoption prefixes exactly", () => {
  const fixture = new LifetimeFixture("normal-prefixes");
  assert.deepEqual(Object.keys(fixture.zeroReplay), REPLAY_KEYS);
  assertNullPrototypeFrozen(fixture.zeroReplay);
  assert.equal(fixture.zeroReplay.status, "NO_LIFETIME_RECORD");
  assert.equal(fixture.zeroReplay.segmentCount, 0);
  assert.equal(fixture.zeroReplay.recordCount, 0);
  assert.equal(fixture.zeroReplay.targetCount, 0);
  assert.deepEqual(fixture.zeroReplay.targets, []);
  assert.equal(fixture.zeroReplay.internalHashChainsValidated, true);
  assert.equal(fixture.zeroReplay.lifetimeSuccessorBindingsMatched, true);
  assert.equal(fixture.zeroReplay.stateRootIdentityAnchorMatched, true);
  assert.equal(fixture.zeroReplay.expectedTailMatched, false);
  assert.equal(fixture.zeroReplay.tailCompletenessExternallyAnchored, false);
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: fixture.zeroReplay,
      generationIdentitySha256: digest("missing-generation"),
    }),
  );
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
      lifetimeKind: "REBOOT_RECOVERY",
      stateRootIdentitySha256: fixture.stateRootIdentitySha256,
      managerActorEpochSha256: fixture.managerActorEpochSha256,
      bootIdSha256: digest("zero-reboot:boot"),
      delegatedRootIdentitySha256: digest("zero-reboot:root"),
      lifetimeEpochSha256: digest("zero-reboot:epoch"),
      limitsSha256: fixture.limitsSha256,
      guardianExecutableIdentitySha256:
        fixture.guardianExecutableIdentitySha256,
      guardianControlRequirementsSha256:
        fixture.guardianControlRequirementsSha256,
      previousLifetimeReplay: fixture.zeroReplay,
    }),
  );

  const identity = fixture.startNormal();
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1({
      segments: [{ lifetimeIdentity: identity, records: [] }],
      expectedStateRootIdentitySha256: fixture.stateRootIdentitySha256,
      expectedLatestLifetimeEpochSha256: null,
      expectedLatestRecordSequence: null,
      expectedLatestRecordRawSha256: null,
    }),
  );
  assert.equal(
    fixture.appendEpoch().replay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
  assert.equal(
    fixture.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE").replay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  assert.equal(
    fixture.appendConfiguredObservation().replay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
  assert.equal(
    fixture.append("GUARDIAN_LAUNCH_INTENT_DURABLE").replay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  assert.equal(
    fixture.append("GUARDIAN_PIDFD_OBSERVED").replay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  assert.equal(
    fixture.append("GUARDIAN_EXEC_OBSERVED").replay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  assert.equal(
    fixture.append("GUARDIAN_MEMBERSHIP_OBSERVED").replay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  assert.equal(
    fixture.append("GUARDIAN_INITIALIZATION_ADOPTED", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256:
        fixture.currentSegment.identity.lifetimeEpochSha256,
    }).replay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
});

test("classifies definite no-child and full close lineages without overclaiming", () => {
  const fixture = new LifetimeFixture("no-child-close");
  fixture.startNormal();
  fixture.appendEpoch();
  fixture.appendConfigured();
  assert.equal(
    fixture.appendNormalNotCreated("EPERM").replay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
  assert.equal(
    fixture.append("LIFETIME_REMOVAL_INTENT_DURABLE").replay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  assert.equal(
    fixture.append("LIFETIME_PATH_ABSENT_OBSERVED").replay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
  const closed = fixture.append("LIFETIME_CLOSED_DURABLE").replay;
  assert.equal(closed.status, "COMPLETE_LIFETIME_CHAIN_REPLAYED");
  assert.deepEqual(plain(closed.authority), EXPECTED_AUTHORITY);
  assert.deepEqual(plain(closed.nonclaims), EXPECTED_NONCLAIMS);
  assert.deepEqual(plain(closed.physicalFacts), EXPECTED_PHYSICAL_FACTS);
});

test("keeps live-birth and recovery-only result boundaries distinct", () => {
  const liveFixture = bootstrapNormal("live-result");
  const liveTarget = liveFixture.addTarget();
  assert.equal(
    liveFixture.latestReplay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
  liveFixture.addAnchor(liveTarget, "LIVE_BIRTH_GUARDIAN");
  assert.equal(
    liveFixture.latestReplay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  liveFixture.appendResult(liveTarget, {
    result: "FINALIZED_ATTEMPT_PREFIX",
  });
  assert.equal(
    liveFixture.latestReplay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
  liveFixture.addAnchor(liveTarget, "LIVE_BIRTH_GUARDIAN");
  assert.equal(
    liveFixture.latestReplay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );

  const recoveryFixture = bootstrapNormal("recovery-result");
  const recoveryTarget = recoveryFixture.addTarget();
  recoveryFixture.appendNormalTermination();
  recoveryFixture.addAnchor(recoveryTarget);
  recoveryFixture.appendRecoveryLaunch(recoveryTarget);
  recoveryFixture.appendRecoveryMembership(recoveryTarget);
  recoveryFixture.appendResult(recoveryTarget, { result: "RECOVERED" });
  assert.equal(
    recoveryFixture.latestReplay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  recoveryFixture.append("RECOVERY_GUARDIAN_TERMINATION_OBSERVED", {
    targetSha256: recoveryTarget.targetSha256,
  });
  assert.equal(
    recoveryFixture.latestReplay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  recoveryFixture.append("RECOVERY_GUARDIAN_REAPED_OBSERVED", {
    targetSha256: recoveryTarget.targetSha256,
  });
  assert.equal(
    recoveryFixture.latestReplay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
});

test("enforces actor adoption, launch, result, and manager handoff branches", () => {
  const unadopted = bootstrapNormal("unadopted-writer", { adopt: false });
  assertContractReject(() => unadopted.addTarget());
  assertContractReject(() =>
    unadopted.append("GUARDIAN_INITIALIZATION_ADOPTED", {
      writerKind: "SERVICE_MANAGER",
    }),
  );

  const live = bootstrapNormal("manager-cannot-shortcut-live");
  const liveTarget = live.addTarget();
  live.addAnchor(liveTarget, "LIVE_BIRTH_GUARDIAN");
  assertContractReject(() =>
    live.appendResult(liveTarget, {
      managerWriter: true,
      anchoredEmpty: true,
    }),
  );

  const recovery = bootstrapNormal("actor-membership-gate");
  const target = recovery.addTarget();
  recovery.appendNormalTermination();
  recovery.addAnchor(target);
  recovery.appendRecoveryLaunch(target);
  assertContractReject(() => recovery.appendResult(target));
  recovery.appendRecoveryMembership(target);
  recovery.appendResult(target);
  assert.equal(recovery.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
  recovery.appendRecoveryTermination(target, { parentageLost: true });
  assert.equal(recovery.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");

  const neverLaunched = bootstrapNormal("manager-empty-recovery");
  const emptyTarget = neverLaunched.addTarget();
  neverLaunched.appendNormalTermination();
  neverLaunched.addAnchor(emptyTarget);
  neverLaunched.appendResult(emptyTarget, {
    managerWriter: true,
    anchoredEmpty: true,
  });
  assert.equal(
    neverLaunched.latestReplay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );

  const notCreated = bootstrapNormal("manager-not-created-result");
  const notCreatedTarget = notCreated.addTarget();
  notCreated.appendNormalTermination();
  notCreated.addAnchor(notCreatedTarget);
  notCreated.appendRecoveryLaunch(notCreatedTarget);
  notCreated.appendRecoveryNotCreated(notCreatedTarget, "ENOSYS");
  notCreated.appendResult(notCreatedTarget, {
    managerWriter: true,
    anchoredEmpty: true,
  });
  assert.equal(notCreated.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");

  const postResolution = bootstrapNormal("manager-post-resolution-result");
  const resolvedTarget = postResolution.addTarget();
  postResolution.appendNormalTermination();
  postResolution.addAnchor(resolvedTarget);
  postResolution.appendRecoveryLaunch(resolvedTarget);
  postResolution.appendRecoveryMembership(resolvedTarget);
  postResolution.appendRecoveryTermination(resolvedTarget);
  assert.equal(
    postResolution.latestReplay.status,
    "VALID_LIFETIME_PREFIX_REPLAYED",
  );
  postResolution.appendResult(resolvedTarget, { managerWriter: true });
  assert.equal(
    postResolution.latestReplay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
});

test("enforces live-birth and recovery-only actor exclusivity across resolution", () => {
  const unresolvedLive = bootstrapNormal("unresolved-live-exclusive");
  const unresolvedTarget = unresolvedLive.addTarget();
  assertContractReject(() => unresolvedLive.addAnchor(unresolvedTarget));

  const notCreated = bootstrapNormal("actor-result-after-not-created");
  const notCreatedTarget = notCreated.addTarget();
  notCreated.appendNormalTermination();
  notCreated.addAnchor(notCreatedTarget);
  notCreated.appendRecoveryLaunch(notCreatedTarget);
  notCreated.appendRecoveryNotCreated(notCreatedTarget);
  assertContractReject(() => notCreated.appendResult(notCreatedTarget));
  notCreated.appendResult(notCreatedTarget, {
    managerWriter: true,
    anchoredEmpty: true,
  });
  assertContractReject(() =>
    notCreated.addAnchor(notCreatedTarget, "LIVE_BIRTH_GUARDIAN"),
  );

  const terminated = bootstrapNormal("actor-result-after-terminal");
  const terminatedTarget = terminated.addTarget();
  terminated.appendNormalTermination();
  terminated.addAnchor(terminatedTarget);
  terminated.appendRecoveryLaunch(terminatedTarget);
  terminated.appendRecoveryMembership(terminatedTarget);
  terminated.appendRecoveryTermination(terminatedTarget);
  assertContractReject(() => terminated.appendResult(terminatedTarget));
  terminated.appendResult(terminatedTarget, {
    managerWriter: true,
    result: "RECOVERED",
  });
  assertContractReject(() => terminated.appendResult(terminatedTarget));

  const rebooted = bootstrapNormal("actor-result-after-reboot");
  const rebootedTarget = rebooted.addTarget();
  rebooted.appendNormalTermination();
  rebooted.addAnchor(rebootedTarget);
  rebooted.appendRecoveryLaunch(rebootedTarget);
  rebooted.appendRecoveryMembership(rebootedTarget);
  rebooted.startReboot();
  rebooted.appendEpoch();
  rebooted.appendConfigured();
  rebooted.appendTransition(rebootedTarget);
  assertContractReject(() => rebooted.appendResult(rebootedTarget));
  rebooted.appendResult(rebootedTarget, { managerWriter: true });
  assertContractReject(() =>
    rebooted.addAnchor(rebootedTarget, "LIVE_BIRTH_GUARDIAN"),
  );
});

test("replays dense reboot catch-up and exact old-actor supersession", () => {
  const fixture = bootstrapNormal("dense-reboot-catchup");
  const target = fixture.addTarget();
  fixture.appendNormalTermination();
  fixture.addAnchor(target);
  fixture.appendRecoveryLaunch(target);
  fixture.appendRecoveryMembership(target);
  fixture.appendResult(target);
  assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");

  const normalTail = segmentTail(fixture.currentSegment);
  fixture.startReboot();
  fixture.appendEpoch();
  fixture.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
  assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
  const interruptedRebootTail = segmentTail(fixture.currentSegment);

  fixture.startReboot();
  fixture.appendEpoch();
  fixture.appendConfigured();
  const configuredTail = segmentTail(fixture.currentSegment);
  const skippedIntermediate = transitionValue({
    targetSha256: target.targetSha256,
    previous: normalTail,
    current: configuredTail,
  });
  assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
  assertContractReject(() =>
    fixture.appendTransition(target, [skippedIntermediate]),
  );
  const transitions = [
    transitionValue({
      targetSha256: target.targetSha256,
      previous: normalTail,
      current: interruptedRebootTail,
    }),
    transitionValue({
      targetSha256: target.targetSha256,
      previous: interruptedRebootTail,
      current: configuredTail,
    }),
  ];
  fixture.appendTransition(target, transitions);
  assert.equal(target.transitionCount, 2);
  assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");
  assert.equal(
    fixture.currentSegment.records.some((record) =>
      [
        "RECOVERY_GUARDIAN_TERMINATION_OBSERVED",
        "RECOVERY_GUARDIAN_REAPED_OBSERVED",
        "RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED",
      ].includes(record.recordType),
    ),
    false,
  );
  assertContractReject(() =>
    fixture.append("RECOVERY_GUARDIAN_TERMINATION_OBSERVED", {
      targetSha256: target.targetSha256,
    }),
  );

  const open = bootstrapNormal("reboot-does-not-fill-result");
  const openTarget = open.addTarget();
  open.appendNormalTermination();
  open.addAnchor(openTarget);
  open.startReboot();
  open.appendEpoch();
  open.appendConfigured();
  assert.equal(open.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
  assertContractReject(() =>
    open.appendResult(openTarget, {
      managerWriter: true,
      anchoredEmpty: true,
    }),
  );
  open.appendTransition(openTarget);
  assert.equal(open.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
  open.appendResult(openTarget, {
    managerWriter: true,
    anchoredEmpty: true,
  });
  assert.equal(open.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");
});

test("supersedes only crossed old-boot cgroup, launch, and termination prefixes", () => {
  const cases = {
    cgroupCreate(fixture) {
      fixture.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
    },
    guardianLaunch(fixture) {
      fixture.appendConfigured();
      fixture.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
    },
    guardianTermination(fixture) {
      fixture.appendConfigured();
      fixture.appendNormalAdoption();
      fixture.append("GUARDIAN_TERMINATION_OBSERVED");
    },
  };
  for (const [name, arrangePrefix] of Object.entries(cases)) {
    const fixture = new LifetimeFixture(`global-supersession-${name}`);
    fixture.startNormal();
    fixture.appendEpoch();
    arrangePrefix(fixture);
    assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
    fixture.startReboot();
    fixture.appendEpoch();
    assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
    fixture.appendConfigured();
    assert.equal(fixture.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");
    if (name === "guardianTermination") {
      assertContractReject(() => fixture.append("GUARDIAN_REAPED_OBSERVED"));
    }
  }
});

test("requires exact partial-launch resolution evidence for replacement managers", () => {
  const normal = new LifetimeFixture("normal-partial-launch-resolution");
  normal.startNormal();
  normal.appendEpoch();
  normal.appendConfigured();
  const normalLaunch = normal.append("GUARDIAN_LAUNCH_INTENT_DURABLE").record;
  normal.append("GUARDIAN_PIDFD_OBSERVED");
  const normalResolution = partialLaunchResolutionValue(normal, {
    launchRecord: normalLaunch,
  });
  const normalMutations = [
    mutatedDigestValue(normalResolution, "projectionSha256", (value) => {
      value.reportedStateRootLockReacquired = false;
    }),
    mutatedDigestValue(normalResolution, "projectionSha256", (value) => {
      value.reportedPriorManagerAbsent = false;
    }),
    mutatedDigestValue(normalResolution, "projectionSha256", (value) => {
      value.reportedLifetimeCgroupEmpty = false;
    }),
    mutatedDigestValue(normalResolution, "projectionSha256", (value) => {
      value.reportedLifetimeCgroupIdentitySha256 = digest("wrong-cgroup");
    }),
    mutatedDigestValue(normalResolution, "projectionSha256", (value) => {
      value.launchRecordRawSha256 = digest("wrong-launch");
    }),
    { ...normalResolution, projectionSha256: digest("wrong-projection") },
  ];
  for (const evidence of normalMutations) {
    assertContractReject(() =>
      normal.append("GUARDIAN_TERMINATION_OBSERVED", { evidence }),
    );
  }
  normal.append("GUARDIAN_TERMINATION_OBSERVED", {
    evidence: normalResolution,
  });
  normal.append("GUARDIAN_PARENTAGE_LOST_OBSERVED");
  assert.equal(normal.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");

  const recovery = bootstrapNormal("recovery-partial-launch-resolution");
  const target = recovery.addTarget();
  recovery.appendNormalTermination();
  recovery.addAnchor(target);
  const recoveryLaunch = recovery.appendRecoveryLaunch(target);
  recovery.append("RECOVERY_GUARDIAN_PIDFD_OBSERVED", {
    targetSha256: target.targetSha256,
  });
  const recoveryResolution = partialLaunchResolutionValue(recovery, {
    launchRecord: recoveryLaunch,
    targetSha256: target.targetSha256,
  });
  for (const evidence of [
    mutatedDigestValue(recoveryResolution, "projectionSha256", (value) => {
      value.targetSha256 = null;
    }),
    mutatedDigestValue(recoveryResolution, "projectionSha256", (value) => {
      value.lifetimeIdentitySha256 = digest("wrong-lifetime");
    }),
  ]) {
    assertContractReject(() =>
      recovery.append("RECOVERY_GUARDIAN_TERMINATION_OBSERVED", {
        targetSha256: target.targetSha256,
        evidence,
      }),
    );
  }
  recovery.append("RECOVERY_GUARDIAN_TERMINATION_OBSERVED", {
    targetSha256: target.targetSha256,
    evidence: recoveryResolution,
  });
  recovery.append("RECOVERY_GUARDIAN_PARENTAGE_LOST_OBSERVED", {
    targetSha256: target.targetSha256,
  });
  assert.equal(recovery.latestReplay.status, "VALID_LIFETIME_PREFIX_REPLAYED");
  recovery.appendResult(target, { managerWriter: true });
  assert.equal(recovery.latestReplay.status, "VALID_LIFETIME_CHAIN_REPLAYED");
});

test("forbids reboot successors after removal intent, path absence, and close", () => {
  for (const stage of ["removal", "absence", "closed"]) {
    const fixture = closeableNoChildLifetime(`no-successor-${stage}`);
    fixture.append("LIFETIME_REMOVAL_INTENT_DURABLE");
    if (stage !== "removal") {
      fixture.append("LIFETIME_PATH_ABSENT_OBSERVED");
    }
    if (stage === "closed") fixture.append("LIFETIME_CLOSED_DURABLE");

    assertContractReject(() =>
      lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(
        rebootIdentityInput(fixture, stage),
      ),
    );

    const candidate = candidateRebootIdentity(fixture, stage);
    assertContractReject(() =>
      lifetime.verifyCandidateContainmentGuardianLifetimeIdentityV1({
        identity: candidate,
        previousLifetimeReplay: fixture.latestReplay,
      }),
    );

    const successorEpoch = manualRecord({
      identity: candidate,
      recordType: "REBOOT_RECOVERY_LIFETIME_EPOCH_CONSUMED",
      managerActorEpochSha256: fixture.managerActorEpochSha256,
    });
    const segments = exactReplayInput(fixture).segments.concat({
      lifetimeIdentity: candidate,
      records: [successorEpoch],
    });
    assertContractReject(() =>
      lifetime.replayCandidateContainmentGuardianLifetimeV1({
        segments,
        expectedStateRootIdentitySha256: fixture.stateRootIdentitySha256,
        expectedLatestLifetimeEpochSha256: candidate.lifetimeEpochSha256,
        expectedLatestRecordSequence: "0000000000000001",
        expectedLatestRecordRawSha256: sha256(successorEpoch.bytes),
      }),
    );
  }

  const control = closeableNoChildLifetime("successor-positive-control");
  control.startReboot();
  assert.equal(control.currentSegment.identity.lifetimeKind, "REBOOT_RECOVERY");
  assert.equal(
    control.appendEpoch().replay.status,
    "VALID_LIFETIME_CHAIN_REPLAYED",
  );
});

test("selects exact target, historical anchor, current anchor, and head brands", () => {
  const fixture = bootstrapNormal("selector-boundaries");
  const target = fixture.addTarget();
  const historicalAnchor = fixture.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  fixture.appendResult(target);
  const currentAnchor = fixture.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  const replay = fixture.latestReplay;
  assertNullPrototypeFrozen(replay);
  const targetSummary = replay.targets[0];
  assert.deepEqual(Object.keys(targetSummary), TARGET_SUMMARY_KEYS);
  assertNullPrototypeFrozen(targetSummary);
  assert.deepEqual(
    targetSummary.attemptAnchors.map((anchor) => Object.keys(anchor)),
    [
      [
        "recoveryActorEpochSha256",
        "lifetimeAnchorProjection",
        "lifetimeAttemptAnchorRawSha256",
      ],
      [
        "recoveryActorEpochSha256",
        "lifetimeAnchorProjection",
        "lifetimeAttemptAnchorRawSha256",
      ],
    ],
  );
  for (const attemptAnchor of targetSummary.attemptAnchors) {
    assertNullPrototypeFrozen(attemptAnchor);
  }

  const targetSelection =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: replay,
      generationIdentitySha256: target.generationIdentitySha256,
    });
  assert.deepEqual(Object.keys(targetSelection), [
    "recoveryTargetProjection",
    "lifetimeTargetRecordRawSha256",
  ]);
  assertNullPrototypeFrozen(targetSelection);
  assert.deepEqual(
    plain(targetSelection.recoveryTargetProjection),
    target.projection,
  );
  assert.equal(
    targetSelection.lifetimeTargetRecordRawSha256,
    target.genesisRecord.rawSha256,
  );

  const historicalSelection =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: replay,
      targetSha256: target.targetSha256,
      recoveryActorEpochSha256: historicalAnchor.recoveryActorEpochSha256,
    });
  const currentSelection =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: replay,
      targetSha256: target.targetSha256,
      recoveryActorEpochSha256: currentAnchor.recoveryActorEpochSha256,
    });
  for (const selection of [historicalSelection, currentSelection]) {
    assert.deepEqual(Object.keys(selection), [
      "lifetimeAnchorProjection",
      "lifetimeAttemptAnchorRawSha256",
    ]);
    assertNullPrototypeFrozen(selection);
  }
  const historicalCarrier = freshAnchorCarrier(historicalSelection);
  const currentCarrier = freshAnchorCarrier(currentSelection);
  assertNullPrototypeFrozen(historicalCarrier);
  assertNullPrototypeFrozen(currentCarrier);
  assert.equal(
    historicalSelection.lifetimeAttemptAnchorRawSha256,
    historicalAnchor.record.rawSha256,
  );
  assert.equal(
    currentSelection.lifetimeAttemptAnchorRawSha256,
    currentAnchor.record.rawSha256,
  );

  const selectedHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: replay,
      targetSha256: target.targetSha256,
    });
  assert.deepEqual(plain(selectedHead), target.head);
  assertNullPrototypeFrozen(selectedHead);

  assert.equal(
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1(
      {
        selection: targetSelection,
        generationIdentitySha256: target.generationIdentitySha256,
        targetSha256: target.targetSha256,
        targetBootIdSha256: target.projection.targetBootIdSha256,
        targetDelegatedRootIdentitySha256:
          target.projection.targetDelegatedRootIdentitySha256,
        targetLifetimeEpochSha256: target.projection.targetLifetimeEpochSha256,
      },
    ),
    true,
  );
  assert.equal(
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
      {
        ...currentSelection,
        targetSha256: target.targetSha256,
        recoveryActorEpochSha256: currentAnchor.recoveryActorEpochSha256,
      },
    ),
    true,
  );
  assert.equal(
    lifetime.assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1({
      externalHead: selectedHead,
      targetSha256: target.targetSha256,
    }),
    true,
  );
  assert.equal(
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetSelection,
      historicalLifetimeAnchorSelections: [historicalCarrier],
      currentLifetimeAnchorSelection: currentCarrier,
      externalHead: selectedHead,
      normalCloseDurabilityReceipt: null,
    }),
    true,
  );
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: replay,
      generationIdentitySha256: digest("nonempty-wrong-generation"),
    }),
  );
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: replay,
      targetSha256: target.targetSha256,
      recoveryActorEpochSha256: digest("nonempty-wrong-actor"),
    }),
  );
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: replay,
      targetSha256: digest("nonempty-wrong-head-target"),
    }),
  );
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1({
      lifetimeReplay: replay,
      targetSha256: target.targetSha256,
    }),
  );
});

test("rejects structural replay lookalikes at every branded consumer", () => {
  const bootstrap = new LifetimeFixture("lookalike-bootstrap");
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
      lifetimeKind: "NORMAL",
      stateRootIdentitySha256: bootstrap.stateRootIdentitySha256,
      managerActorEpochSha256: bootstrap.managerActorEpochSha256,
      bootIdSha256: digest("lookalike-normal-boot"),
      delegatedRootIdentitySha256: digest("lookalike-normal-root"),
      lifetimeEpochSha256: digest("lookalike-normal-epoch"),
      limitsSha256: bootstrap.limitsSha256,
      guardianExecutableIdentitySha256:
        bootstrap.guardianExecutableIdentitySha256,
      guardianControlRequirementsSha256:
        bootstrap.guardianControlRequirementsSha256,
      previousLifetimeReplay: plain(bootstrap.zeroReplay),
    }),
  );
  const normalIdentity = bootstrap.startNormal();
  assertContractReject(() =>
    lifetime.verifyCandidateContainmentGuardianLifetimeIdentityV1({
      identity: normalIdentity,
      previousLifetimeReplay: plain(bootstrap.zeroReplay),
    }),
  );

  const fixture = bootstrapNormal("lookalike-nonempty");
  const target = fixture.addTarget();
  const anchor = fixture.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  fixture.appendResult(target);
  const replayLookalike = plain(fixture.latestReplay);
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeRecordV1({
      previousLifetimeReplay: replayLookalike,
      lifetimeIdentity: fixture.currentSegment.identity,
      writerKind: "SERVICE_MANAGER",
      writerActorEpochSha256: fixture.managerActorEpochSha256,
      targetSha256: null,
      recordType: "GUARDIAN_TERMINATION_OBSERVED",
      operationBytes: jsonLine(opaquePayload("lookalike-create-operation")),
      evidenceBytes: jsonLine(opaquePayload("lookalike-create-evidence")),
    }),
  );
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
      ...rebootIdentityInput(fixture, "lookalike-reboot"),
      previousLifetimeReplay: replayLookalike,
    }),
  );
  assertContractReject(() =>
    lifetime.verifyCandidateContainmentGuardianLifetimeIdentityV1({
      identity: candidateRebootIdentity(fixture, "lookalike-reboot-verify"),
      previousLifetimeReplay: replayLookalike,
    }),
  );
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: replayLookalike,
      generationIdentitySha256: target.generationIdentitySha256,
    }),
  );
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: replayLookalike,
      targetSha256: target.targetSha256,
    }),
  );
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: replayLookalike,
      targetSha256: target.targetSha256,
      recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
    }),
  );

  const closeFixture = bootstrapNormal("lookalike-close-selector");
  const closeTarget = closeFixture.addTarget();
  closeFixture.appendNormalClose(closeTarget);
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1({
      lifetimeReplay: plain(closeFixture.latestReplay),
      targetSha256: closeTarget.targetSha256,
    }),
  );
});

test("brands only complete-tail selections from one replay instance", () => {
  const fixture = bootstrapNormal("brand-adversaries");
  const target = fixture.addTarget();
  const anchor = fixture.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  fixture.appendResult(target);
  const successorAnchor = fixture.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  fixture.appendResult(target);
  const structuralReplay = fixture.replay({ exactTail: false });
  assert.equal(structuralReplay.expectedTailMatched, false);
  assert.equal(structuralReplay.tailCompletenessExternallyAnchored, false);
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: structuralReplay,
      generationIdentitySha256: target.generationIdentitySha256,
    }),
  );

  const [replayA, replayB] = replayTwice(fixture);
  const targetA =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: replayA,
      generationIdentitySha256: target.generationIdentitySha256,
    });
  const targetB =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: replayB,
      generationIdentitySha256: target.generationIdentitySha256,
    });
  const anchorA =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: replayA,
      targetSha256: target.targetSha256,
      recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
    });
  const anchorB =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: replayB,
      targetSha256: target.targetSha256,
      recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
    });
  const successorAnchorA =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: replayA,
      targetSha256: target.targetSha256,
      recoveryActorEpochSha256: successorAnchor.recoveryActorEpochSha256,
    });
  const successorAnchorB =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: replayB,
      targetSha256: target.targetSha256,
      recoveryActorEpochSha256: successorAnchor.recoveryActorEpochSha256,
    });
  const headA =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: replayA,
      targetSha256: target.targetSha256,
    });
  const headB =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: replayB,
      targetSha256: target.targetSha256,
    });

  assert.deepEqual(plain(targetA), plain(targetB));
  assert.deepEqual(plain(anchorA), plain(anchorB));
  assert.deepEqual(plain(headA), plain(headB));
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1(
      {
        selection: plain(targetA),
        generationIdentitySha256: target.generationIdentitySha256,
        targetSha256: target.targetSha256,
        targetBootIdSha256: target.projection.targetBootIdSha256,
        targetDelegatedRootIdentitySha256:
          target.projection.targetDelegatedRootIdentitySha256,
        targetLifetimeEpochSha256: target.projection.targetLifetimeEpochSha256,
      },
    ),
  );
  for (const overrides of [
    { generationIdentitySha256: digest("wrong-expected-generation") },
    { targetSha256: digest("wrong-expected-target") },
    { targetBootIdSha256: digest("wrong-expected-boot") },
    {
      targetDelegatedRootIdentitySha256: digest(
        "wrong-expected-delegated-root",
      ),
    },
    { targetLifetimeEpochSha256: digest("wrong-expected-lifetime") },
  ]) {
    assertBrandTypeError(() =>
      lifetime.assertCandidateContainmentGuardianLifetimeRecoveryTargetSelectionV1(
        {
          selection: targetA,
          generationIdentitySha256: target.generationIdentitySha256,
          targetSha256: target.targetSha256,
          targetBootIdSha256: target.projection.targetBootIdSha256,
          targetDelegatedRootIdentitySha256:
            target.projection.targetDelegatedRootIdentitySha256,
          targetLifetimeEpochSha256:
            target.projection.targetLifetimeEpochSha256,
          ...overrides,
        },
      ),
    );
  }
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
      {
        lifetimeAnchorProjection: anchorA.lifetimeAnchorProjection,
        lifetimeAttemptAnchorRawSha256:
          successorAnchorA.lifetimeAttemptAnchorRawSha256,
        targetSha256: target.targetSha256,
        recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
      },
    ),
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
      {
        ...anchorA,
        targetSha256: digest("wrong-branded-anchor-target"),
        recoveryActorEpochSha256: anchor.recoveryActorEpochSha256,
      },
    ),
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorSelectionV1(
      {
        ...anchorA,
        targetSha256: target.targetSha256,
        recoveryActorEpochSha256: digest("wrong-branded-anchor-actor"),
      },
    ),
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1({
      externalHead: plain(headA),
      targetSha256: target.targetSha256,
    }),
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeExternalHeadSelectionV1({
      externalHead: headA,
      targetSha256: digest("wrong-branded-head-target"),
    }),
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetA,
      historicalLifetimeAnchorSelections: [anchorB, successorAnchorB],
      currentLifetimeAnchorSelection: null,
      externalHead: headA,
      normalCloseDurabilityReceipt: null,
    }),
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetB,
      historicalLifetimeAnchorSelections: [anchorB, successorAnchorB],
      currentLifetimeAnchorSelection: null,
      externalHead: headA,
      normalCloseDurabilityReceipt: null,
    }),
  );
  assert.equal(
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetA,
      historicalLifetimeAnchorSelections: [
        freshAnchorCarrier(anchorA),
        freshAnchorCarrier(successorAnchorA),
      ],
      currentLifetimeAnchorSelection: null,
      externalHead: headA,
      normalCloseDurabilityReceipt: null,
    }),
    true,
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetA,
      historicalLifetimeAnchorSelections: [successorAnchorA, anchorA],
      currentLifetimeAnchorSelection: null,
      externalHead: headA,
      normalCloseDurabilityReceipt: null,
    }),
  );
  const sparseHistorical = new Array(2);
  sparseHistorical[0] = anchorA;
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetA,
      historicalLifetimeAnchorSelections: sparseHistorical,
      currentLifetimeAnchorSelection: null,
      externalHead: headA,
      normalCloseDurabilityReceipt: null,
    }),
  );

  const twoTargets = bootstrapNormal("same-replay-target-mixing");
  const selectedTarget = twoTargets.addTarget();
  const otherTarget = twoTargets.addTarget();
  const otherAnchor = twoTargets.addAnchor(otherTarget, "LIVE_BIRTH_GUARDIAN");
  twoTargets.appendResult(otherTarget);
  const twoTargetReplay = twoTargets.latestReplay;
  const selectedTargetBoundary =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: twoTargetReplay,
      generationIdentitySha256: selectedTarget.generationIdentitySha256,
    });
  const otherAnchorBoundary =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: twoTargetReplay,
      targetSha256: otherTarget.targetSha256,
      recoveryActorEpochSha256: otherAnchor.recoveryActorEpochSha256,
    });
  const otherHeadBoundary =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: twoTargetReplay,
      targetSha256: otherTarget.targetSha256,
    });
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: selectedTargetBoundary,
      historicalLifetimeAnchorSelections: [
        freshAnchorCarrier(otherAnchorBoundary),
      ],
      currentLifetimeAnchorSelection: null,
      externalHead: otherHeadBoundary,
      normalCloseDurabilityReceipt: null,
    }),
  );

  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1(
      exactReplayInput(fixture, {
        expectedLatestRecordRawSha256: digest("wrong-tail"),
      }),
    ),
  );
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1(
      exactReplayInput(fixture, {
        expectedLatestRecordSequence: null,
      }),
    ),
  );
});

test("selects and brands the mutually exclusive normal-close receipt", () => {
  const fixture = bootstrapNormal("normal-close-selector");
  const target = fixture.addTarget();
  fixture.appendNormalClose(target);
  const [replay, secondReplay] = replayTwice(fixture);
  const targetSelection =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: replay,
      generationIdentitySha256: target.generationIdentitySha256,
    });
  const selectedHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: replay,
      targetSha256: target.targetSha256,
    });
  const receipt =
    lifetime.selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1({
      lifetimeReplay: replay,
      targetSha256: target.targetSha256,
    });
  const secondReceipt =
    lifetime.selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1({
      lifetimeReplay: secondReplay,
      targetSha256: target.targetSha256,
    });
  assert.deepEqual(Object.keys(receipt), [
    "normalCloseReceiptProjection",
    "normalCloseReceiptRecordRawSha256",
  ]);
  assert.deepEqual(
    plain(receipt.normalCloseReceiptProjection),
    target.normalCloseReceipt,
  );
  assert.equal(
    receipt.normalCloseReceiptRecordRawSha256,
    target.normalCloseRecord.rawSha256,
  );
  assertNullPrototypeFrozen(receipt);
  assert.equal(
    lifetime.assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1(
      {
        normalCloseDurabilityReceipt: receipt,
        targetSha256: target.targetSha256,
      },
    ),
    true,
  );
  assert.equal(
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetSelection,
      historicalLifetimeAnchorSelections: [],
      currentLifetimeAnchorSelection: null,
      externalHead: selectedHead,
      normalCloseDurabilityReceipt: receipt,
    }),
    true,
  );
  assertContractReject(() => fixture.addAnchor(target));

  const wrongTarget = digest("wrong-normal-close-target");
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1(
      {
        normalCloseDurabilityReceipt: receipt,
        targetSha256: wrongTarget,
      },
    ),
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeNormalCloseReceiptSelectionV1(
      {
        normalCloseDurabilityReceipt: plain(receipt),
        targetSha256: target.targetSha256,
      },
    ),
  );
  assertBrandTypeError(() =>
    lifetime.assertCandidateContainmentGuardianLifetimeRecoveryBoundarySetV1({
      recoveryTargetSelection: targetSelection,
      historicalLifetimeAnchorSelections: [],
      currentLifetimeAnchorSelection: null,
      externalHead: selectedHead,
      normalCloseDurabilityReceipt: secondReceipt,
    }),
  );
  assertContractReject(() =>
    lifetime.selectCandidateContainmentGuardianLifetimeNormalCloseReceiptV1({
      lifetimeReplay: replay,
      targetSha256: wrongTarget,
    }),
  );
});

test("exercises all 29 relationship rows across honest branch alternatives", () => {
  const observed = new Set();
  const collect = (fixture) => {
    for (const recordType of fixture.recordTypesSeen) observed.add(recordType);
  };

  const complete = bootstrapNormal("matrix-complete");
  const completeTarget = complete.addTarget();
  complete.appendNormalTermination({ parentageLost: true });
  complete.addAnchor(completeTarget);
  complete.appendRecoveryLaunch(completeTarget);
  complete.appendRecoveryMembership(completeTarget);
  complete.appendResult(completeTarget, { result: "RECOVERED" });
  complete.appendRecoveryTermination(completeTarget, {
    parentageLost: true,
  });
  complete.appendLifetimeClose();
  collect(complete);

  const reboot = bootstrapNormal("matrix-reboot");
  const rebootTarget = reboot.addTarget();
  reboot.appendNormalTermination();
  reboot.startReboot();
  reboot.appendEpoch();
  reboot.appendConfigured();
  reboot.appendTransition(rebootTarget);
  reboot.appendNormalClose(rebootTarget);
  collect(reboot);

  const noChild = new LifetimeFixture("matrix-normal-no-child");
  noChild.startNormal();
  noChild.appendEpoch();
  noChild.appendConfigured();
  noChild.appendNormalNotCreated();
  collect(noChild);

  const recoveryNoChild = bootstrapNormal("matrix-recovery-no-child");
  const recoveryNoChildTarget = recoveryNoChild.addTarget();
  recoveryNoChild.appendNormalTermination();
  recoveryNoChild.addAnchor(recoveryNoChildTarget);
  recoveryNoChild.appendRecoveryLaunch(recoveryNoChildTarget);
  recoveryNoChild.appendRecoveryNotCreated(recoveryNoChildTarget);
  recoveryNoChild.appendResult(recoveryNoChildTarget, {
    managerWriter: true,
    anchoredEmpty: true,
  });
  collect(recoveryNoChild);

  const recoveryReaped = bootstrapNormal("matrix-recovery-reaped");
  const recoveryReapedTarget = recoveryReaped.addTarget();
  recoveryReaped.appendNormalTermination();
  recoveryReaped.addAnchor(recoveryReapedTarget);
  recoveryReaped.appendRecoveryLaunch(recoveryReapedTarget);
  recoveryReaped.appendRecoveryMembership(recoveryReapedTarget);
  recoveryReaped.appendResult(recoveryReapedTarget, { result: "RECOVERED" });
  recoveryReaped.appendRecoveryTermination(recoveryReapedTarget, {
    parentageLost: false,
  });
  collect(recoveryReaped);

  assert.deepEqual(
    RECORD_TYPES.filter((recordType) => observed.has(recordType)),
    RECORD_TYPES,
  );
});

test("admits exactly global 25, target 37, six targets, and aggregate 247", () => {
  const fixture = bootstrapNormal("exact-semantic-budget");
  fixture.appendNormalTermination();
  const targets = Array.from({ length: 6 }, () =>
    fixture.addTarget({ writerKind: "SERVICE_MANAGER" }),
  );

  for (let round = 0; round < 4; round += 1) {
    for (const [index, target] of targets.entries()) {
      appendFullRecoveryAttempt(fixture, target, {
        terminal: round === 3,
        parentageLost: index % 2 === 1,
      });
    }
    fixture.startReboot();
    fixture.appendEpoch();
    fixture.appendConfigured();
    for (const target of targets) fixture.appendTransition(target);
  }

  assert.equal(fixture.segments.length, 5);
  assert.equal(fixture.latestReplay.recordCount, 244);
  assert.equal(fixture.latestReplay.targetCount, 6);
  for (const targetSummary of fixture.latestReplay.targets) {
    assert.equal(targetSummary.attemptCount, 4);
    assert.equal(targetSummary.bootTransitionCount, 4);
  }
  assertContractReject(() => fixture.addAnchor(targets[0]));
  assertContractReject(() => fixture.appendTransition(targets[0]));

  const closed = fixture.appendLifetimeClose().replay;
  assert.equal(closed.recordCount, 247);
  assert.equal(closed.status, "COMPLETE_LIFETIME_CHAIN_REPLAYED");
  const records = fixture.segments.flatMap((segment) => segment.records);
  assert.equal(
    records.filter((record) => record.targetSha256 === null).length,
    25,
  );
  for (const target of targets) {
    assert.equal(
      records.filter((record) => record.targetSha256 === target.targetSha256)
        .length,
      37,
    );
  }

  const surplus = exactReplayInput(fixture);
  const record248 = explosiveArtifact("semantic-record-248");
  surplus.segments[0].records.unshift(record248.value);
  assert.equal(
    surplus.segments.reduce(
      (count, segment) => count + segment.records.length,
      0,
    ),
    248,
  );
  assertRejectedBeforeSentinel(
    () => lifetime.replayCandidateContainmentGuardianLifetimeV1(surplus),
    record248.state,
  );
});

test("rejects target seven and the normal-close branch after any attempt", () => {
  const sixTargets = bootstrapNormal("six-target-limit");
  for (let index = 0; index < 6; index += 1) {
    const target = sixTargets.addTarget();
    sixTargets.appendNormalClose(target);
  }
  assert.equal(sixTargets.latestReplay.targetCount, 6);
  assertContractReject(() => sixTargets.addTarget());

  const attempted = bootstrapNormal("close-is-not-additive");
  const target = attempted.addTarget();
  attempted.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  attempted.appendResult(target);
  assertContractReject(() => attempted.appendNormalClose(target));
});

test("rejects duplicate targets, reused actors, partial predecessors, and wrong heads", () => {
  const fixture = bootstrapNormal("identity-and-target-uniqueness");
  const target = fixture.addTarget();
  const duplicateGenerationTargetSha256 = digest("duplicate-generation-target");
  const duplicateGeneration = mutateTargetGenesis(target, (value) => {
    value.operation.recoveryTargetProjection.targetSha256 =
      duplicateGenerationTargetSha256;
    value.operation.targetGenesisInventory.targetSha256 =
      duplicateGenerationTargetSha256;
    value.evidence.targetSha256 = duplicateGenerationTargetSha256;
  });
  assertContractReject(() =>
    fixture.append("GENERATION_RECOVERY_HEAD_DURABLE", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256:
        fixture.currentSegment.identity.lifetimeEpochSha256,
      targetSha256: duplicateGenerationTargetSha256,
      operation: duplicateGeneration.operation,
      evidence: duplicateGeneration.evidence,
    }),
  );

  const reusedTarget = mutateTargetGenesis(target, (value) => {
    value.operation.recoveryTargetProjection.generationIdentitySha256 = digest(
      "different-generation-same-target",
    );
    value.operation.recoveryTargetProjection.generationManifestRawSha256 =
      digest("different-manifest-same-target");
  });
  assertContractReject(() =>
    fixture.append("GENERATION_RECOVERY_HEAD_DURABLE", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256:
        fixture.currentSegment.identity.lifetimeEpochSha256,
      targetSha256: target.targetSha256,
      operation: reusedTarget.operation,
      evidence: reusedTarget.evidence,
    }),
  );

  const firstAnchor = fixture.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  fixture.appendResult(target);
  for (const reusedAnchorIdentity of [
    {
      recoveryActorEpochSha256: firstAnchor.recoveryActorEpochSha256,
      attemptDirectoryName: firstAnchor.attemptDirectoryName,
    },
    {
      recoveryActorEpochSha256: firstAnchor.recoveryActorEpochSha256,
      attemptDirectoryName: digest("fresh-directory-with-reused-actor"),
    },
    {
      recoveryActorEpochSha256: digest("fresh-actor-with-reused-directory"),
      attemptDirectoryName: firstAnchor.attemptDirectoryName,
    },
  ]) {
    const reusedAnchorEvent = anchorEventValue(target, {
      actorKind: "LIVE_BIRTH_GUARDIAN",
      ...reusedAnchorIdentity,
    });
    assertContractReject(() =>
      fixture.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
        writerKind: "LIVE_BIRTH_GUARDIAN",
        writerActorEpochSha256: reusedAnchorIdentity.recoveryActorEpochSha256,
        targetSha256: target.targetSha256,
        evidence: reusedAnchorEvent,
      }),
    );
  }

  const partialPredecessor = anchorEventValue(target, {
    actorKind: "LIVE_BIRTH_GUARDIAN",
    recoveryActorEpochSha256: digest("partial-predecessor-actor"),
    expectedStateRootIdentitySha256: fixture.stateRootIdentitySha256,
  });
  partialPredecessor.anchorProjection.previousAttemptDirectoryName = null;
  const partialEventPrefix = { ...partialPredecessor };
  delete partialEventPrefix.eventSha256;
  partialPredecessor.eventSha256 = semanticSha256(partialEventPrefix);
  assertContractReject(() =>
    fixture.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256:
        partialPredecessor.anchorProjection.recoveryActorEpochSha256,
      targetSha256: target.targetSha256,
      evidence: partialPredecessor,
    }),
  );

  const wrongPredecessor = anchorEventValue(target, {
    actorKind: "LIVE_BIRTH_GUARDIAN",
    recoveryActorEpochSha256: digest("wrong-predecessor-actor"),
    expectedStateRootIdentitySha256: fixture.stateRootIdentitySha256,
  });
  wrongPredecessor.predecessorExternalHead = embeddedValue(
    target.genesisRecord,
    "evidence",
  );
  const wrongEventPrefix = { ...wrongPredecessor };
  delete wrongEventPrefix.eventSha256;
  wrongPredecessor.eventSha256 = semanticSha256(wrongEventPrefix);
  assertContractReject(() =>
    fixture.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256:
        wrongPredecessor.anchorProjection.recoveryActorEpochSha256,
      targetSha256: target.targetSha256,
      evidence: wrongPredecessor,
    }),
  );

  const secondAnchor = fixture.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  const validHead = externalHead({
    targetSha256: target.targetSha256,
    result: "FINALIZED_ATTEMPT_PREFIX",
    recoveryActorEpochSha256: secondAnchor.recoveryActorEpochSha256,
    attemptDirectoryName: secondAnchor.attemptDirectoryName,
    lifetimeAttemptAnchorRawSha256: secondAnchor.record.rawSha256,
    latestRecoveryRecordSequence: "0000000000000001",
    latestRecoveryRecordRawSha256: digest("uniqueness-result-head"),
  });
  for (const evidence of [
    mutatedDigestValue(validHead, "externalHeadSha256", (value) => {
      value.lifetimeAttemptAnchorRawSha256 = digest("wrong-anchor-head");
    }),
    mutatedDigestValue(validHead, "externalHeadSha256", (value) => {
      value.recoveryActorEpochSha256 = firstAnchor.recoveryActorEpochSha256;
    }),
    mutatedDigestValue(validHead, "externalHeadSha256", (value) => {
      value.targetSha256 = digest("wrong-result-target");
    }),
    mutatedDigestValue(validHead, "externalHeadSha256", (value) => {
      value.latestRecoveryRecordSequence = null;
    }),
  ]) {
    assertContractReject(() =>
      fixture.append("RECOVERY_ATTEMPT_RESULT_DURABLE", {
        writerKind: "LIVE_BIRTH_GUARDIAN",
        writerActorEpochSha256: secondAnchor.recoveryActorEpochSha256,
        targetSha256: target.targetSha256,
        evidence,
      }),
    );
  }
  fixture.appendResult(target);

  const predecessor = closeableNoChildLifetime("partial-identity-predecessor");
  const partialIdentity = candidateRebootIdentity(predecessor);
  partialIdentity.previousLifetimeRecordSequence = null;
  const partialIdentityPrefix = { ...partialIdentity };
  delete partialIdentityPrefix.identitySha256;
  partialIdentity.identitySha256 = semanticSha256(partialIdentityPrefix);
  assertContractReject(() =>
    lifetime.verifyCandidateContainmentGuardianLifetimeIdentityV1({
      identity: partialIdentity,
      previousLifetimeReplay: predecessor.latestReplay,
    }),
  );
});

test("rejects skipped, duplicated, cross-target, and post-terminal grammar", () => {
  const skipped = bootstrapNormal("skipped-launch-stage", { adopt: false });
  assertContractReject(() => skipped.append("GUARDIAN_PIDFD_OBSERVED"));
  skipped.append("GUARDIAN_LAUNCH_INTENT_DURABLE");
  assertContractReject(() => skipped.append("GUARDIAN_EXEC_OBSERVED"));
  assertContractReject(() => skipped.append("LIFETIME_PATH_ABSENT_OBSERVED"));

  const duplicateResolution = bootstrapNormal("duplicate-resolution");
  duplicateResolution.appendNormalTermination();
  assertContractReject(() =>
    duplicateResolution.append("GUARDIAN_PARENTAGE_LOST_OBSERVED"),
  );

  const openAnchor = bootstrapNormal("open-anchor-successor");
  const target = openAnchor.addTarget();
  openAnchor.addAnchor(target, "LIVE_BIRTH_GUARDIAN");
  assertContractReject(() =>
    openAnchor.addAnchor(target, "LIVE_BIRTH_GUARDIAN"),
  );
  assertContractReject(() => openAnchor.appendRecoveryLaunch(target));
  assertContractReject(() =>
    openAnchor.append("GUARDIAN_TERMINATION_OBSERVED", {
      targetSha256: target.targetSha256,
    }),
  );
  assertContractReject(() =>
    openAnchor.append("RECOVERY_ATTEMPT_RESULT_DURABLE", {
      writerKind: "LIVE_BIRTH_GUARDIAN",
      writerActorEpochSha256: target.currentAnchor.recoveryActorEpochSha256,
      targetSha256: null,
      evidence: target.head,
    }),
  );

  const closed = closeableNoChildLifetime("post-close-record");
  closed.appendLifetimeClose();
  assertContractReject(() => closed.append("LIFETIME_CLOSED_DURABLE"));
});

test("validates every reboot-transition edge before advancing a target", () => {
  const fixture = bootstrapNormal("transition-mutations");
  const target = fixture.addTarget();
  fixture.appendNormalTermination();
  fixture.startReboot();
  fixture.appendEpoch();
  fixture.appendConfigured();
  assertContractReject(() => fixture.addAnchor(target));

  const transition = fixture.makeDirectTransition(target);
  const invalidTransitions = [
    mutatedDigestValue(transition, "transitionSha256", (value) => {
      value.reportedControlCgroupAbsent = false;
    }),
    mutatedDigestValue(transition, "transitionSha256", (value) => {
      value.currentBootIdSha256 = value.previousBootIdSha256;
    }),
    mutatedDigestValue(transition, "transitionSha256", (value) => {
      value.currentSegmentConfigured = false;
    }),
    mutatedDigestValue(transition, "transitionSha256", (value) => {
      value.previousLifetimeRecordRawSha256 = digest("wrong-segment-head");
    }),
    mutatedDigestValue(transition, "transitionSha256", (value) => {
      value.targetSha256 = digest("wrong-transition-target");
    }),
  ];
  for (const invalid of invalidTransitions) {
    assertContractReject(() => fixture.appendTransition(target, [invalid]));
  }
  assertContractReject(() =>
    fixture.appendTransition(target, [transition, transition]),
  );
  fixture.appendTransition(target, [transition]);
  assert.equal(target.transitionCount, 1);
  assertContractReject(() => fixture.appendTransition(target));

  const genesis = bootstrapNormal("reboot-genesis-transition");
  genesis.appendNormalTermination();
  const previous = segmentTail(genesis.currentSegment);
  genesis.startReboot();
  genesis.appendEpoch();
  genesis.appendConfigured();
  const targetSha256 = digest(`${genesis.label}:target:0`);
  const embeddedTransition = transitionValue({
    targetSha256,
    previous,
    current: segmentTail(genesis.currentSegment),
  });
  const rebootTarget = genesis.addTarget({
    writerKind: "SERVICE_MANAGER",
    transitions: [embeddedTransition],
  });
  assert.equal(rebootTarget.targetSha256, targetSha256);
  assert.equal(genesis.latestReplay.targets[0].bootTransitionCount, 1);
  assertContractReject(() => genesis.appendTransition(rebootTarget));
});

test("rejects replay tampering, forks, aliases, and unknown artifacts", () => {
  const fixture = bootstrapNormal("replay-tampering");
  const input = exactReplayInput(fixture);
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1({
      ...input,
      expectedStateRootIdentitySha256: digest("wrong-state-root"),
    }),
  );

  const wrongName = exactReplayInput(fixture);
  wrongName.segments[0].records[0] = {
    ...wrongName.segments[0].records[0],
    name: "0000000000000001-" + ZERO_SHA256 + ".jsonl",
  };
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1(wrongName),
  );

  const fork = exactReplayInput(fixture);
  fork.segments[0].records[1] = fork.segments[0].records[0];
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1(fork),
  );

  const swapped = exactReplayInput(fixture);
  [swapped.segments[0].records[1], swapped.segments[0].records[2]] = [
    swapped.segments[0].records[2],
    swapped.segments[0].records[1],
  ];
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1(swapped),
  );

  const identityAlias = exactReplayInput(fixture);
  identityAlias.segments[0] = {
    ...identityAlias.segments[0],
    lifetimeIdentity: {
      ...plain(identityAlias.segments[0].lifetimeIdentity),
      bootIdSha256: digest("aliased-boot"),
    },
  };
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1(identityAlias),
  );

  const unknown = exactReplayInput(fixture);
  unknown.segments[0].records.push({
    name: "unknown-file",
    bytes: Buffer.from("{}\n", "utf8"),
  });
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1(unknown),
  );
});

test("creates and verifies canonical identities and copy-on-read records", () => {
  const fixture = new LifetimeFixture("canonical-values");
  const identity = fixture.startNormal();
  const verifiedIdentity =
    lifetime.verifyCandidateContainmentGuardianLifetimeIdentityV1({
      identity,
      previousLifetimeReplay: fixture.zeroReplay,
    });
  assert.deepEqual(Object.keys(verifiedIdentity), IDENTITY_KEYS);
  assert.deepEqual(plain(verifiedIdentity), plain(identity));
  assertNullPrototypeFrozen(verifiedIdentity);

  const { record } = fixture.appendEpoch();
  const firstRead = record.bytes;
  const firstByte = firstRead[0];
  firstRead.fill(0);
  assert.equal(record.bytes[0], firstByte);
  assert.notEqual(record.bytes[0], 0);
  assertNullPrototypeFrozen(record.lifetimeIdentity);
  assertNullPrototypeFrozen(record.operation);
  assertNullPrototypeFrozen(record.evidence);

  const suppliedBytes = Buffer.from(record.bytes);
  const verified = lifetime.verifyCandidateContainmentGuardianLifetimeRecordV1({
    name: record.name,
    bytes: suppliedBytes,
  });
  suppliedBytes.fill(0);
  assert.equal(verified.rawSha256, record.rawSha256);
  const verifiedRead = verified.bytes;
  verifiedRead.fill(0);
  assert.equal(verified.bytes[0], firstByte);

  const replay = fixture.latestReplay;
  assertNullPrototypeFrozen(replay);
  assert.equal(replay.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(replay.internalHashChainsValidated, true);
  assert.equal(replay.lifetimeSuccessorBindingsMatched, true);
  assert.equal(replay.stateRootIdentityAnchorMatched, true);
  assert.equal(replay.expectedTailMatched, true);
  assert.equal(replay.tailCompletenessExternallyAnchored, true);
  assert.deepEqual(plain(replay.authority), EXPECTED_AUTHORITY);
  assert.deepEqual(plain(replay.nonclaims), EXPECTED_NONCLAIMS);
  assert.deepEqual(plain(replay.physicalFacts), EXPECTED_PHYSICAL_FACTS);
});

test("rejects noncanonical framing, names, fields, hashes, and base64", () => {
  const fixture = new LifetimeFixture("canonical-rejections");
  fixture.startNormal();
  const { record } = fixture.appendEpoch();
  const value = JSON.parse(record.bytes.toString("utf8"));
  const reversedBytes = Buffer.from(
    `${JSON.stringify(Object.fromEntries(Object.entries(value).reverse()))}\n`,
    "utf8",
  );
  const malformed = [
    {
      name: record.name,
      bytes: record.bytes.subarray(0, record.bytes.length - 1),
    },
    renamed(
      record.sequence,
      Buffer.concat([
        record.bytes.subarray(0, record.bytes.length - 1),
        Buffer.from("\r\n"),
      ]),
    ),
    renamed(
      record.sequence,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), record.bytes]),
    ),
    renamed(
      record.sequence,
      Buffer.concat([record.bytes, Buffer.from("\n", "utf8")]),
    ),
    renamed(record.sequence, reversedBytes),
    { name: `0000000000000002-${record.rawSha256}.jsonl`, bytes: record.bytes },
    {
      name: `${record.sequence}-${record.rawSha256.toUpperCase()}.jsonl`,
      bytes: record.bytes,
    },
  ];
  for (const artifactValue of malformed) {
    assertContractReject(() =>
      lifetime.verifyCandidateContainmentGuardianLifetimeRecordV1(
        artifactValue,
      ),
    );
  }

  const canonicalMutations = [
    (candidate) => {
      candidate.extra = false;
    },
    (candidate) => {
      delete candidate.evidence;
    },
    (candidate) => {
      candidate.operation.rawSha256 =
        candidate.operation.rawSha256.toUpperCase();
    },
    (candidate) => {
      candidate.operation.bytesBase64 = `${candidate.operation.bytesBase64}=`;
    },
    (candidate) => {
      candidate.operation.bytesBase64 = ` ${candidate.operation.bytesBase64}`;
    },
    (candidate) => {
      [candidate.operation, candidate.evidence] = [
        candidate.evidence,
        candidate.operation,
      ];
    },
    (candidate) => {
      candidate.operation.bindingSha256 = digest("wrong-binding");
    },
    (candidate) => {
      candidate.previousRecordRawSha256 = digest("wrong-predecessor");
    },
  ];
  for (const mutate of canonicalMutations) {
    assertContractReject(() =>
      lifetime.verifyCandidateContainmentGuardianLifetimeRecordV1(
        canonicalMutation(record, mutate),
      ),
    );
  }
});

test("enforces exact operation, record, segment, and structural count bounds", () => {
  const fixture = new LifetimeFixture("resource-bounds");
  const identity = fixture.startNormal();
  fixture.appendEpoch();
  const baseInput = {
    previousLifetimeReplay: fixture.latestReplay,
    lifetimeIdentity: identity,
    writerKind: "SERVICE_MANAGER",
    writerActorEpochSha256: fixture.managerActorEpochSha256,
    targetSha256: null,
    recordType: "LIFETIME_CGROUP_CREATE_INTENT_DURABLE",
    evidenceBytes: jsonLine(opaquePayload("bounded-evidence")),
  };
  const exactOperation = Buffer.from(
    `${JSON.stringify("x".repeat(16381))}\n`,
    "utf8",
  );
  assert.equal(exactOperation.length, 16384);
  assert.doesNotThrow(() =>
    lifetime.createCandidateContainmentGuardianLifetimeRecordV1({
      ...baseInput,
      operationBytes: exactOperation,
    }),
  );
  const oversizedOperation = Buffer.from(
    `${JSON.stringify("x".repeat(16382))}\n`,
    "utf8",
  );
  assert.equal(oversizedOperation.length, 16385);
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeRecordV1({
      ...baseInput,
      operationBytes: oversizedOperation,
    }),
  );

  const oneSegment = exactReplayInput(fixture).segments[0];
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1({
      ...exactReplayInput(fixture),
      segments: Array.from({ length: 6 }, () => oneSegment),
    }),
  );
  const record257 = explosiveArtifact("structural-record-257");
  const records257 = Array.from({ length: 257 }, () =>
    artifact(fixture.currentSegment.records[0]),
  );
  records257[0] = record257.value;
  assertRejectedBeforeSentinel(
    () =>
      lifetime.replayCandidateContainmentGuardianLifetimeV1({
        ...exactReplayInput(fixture),
        segments: [{ lifetimeIdentity: identity, records: records257 }],
      }),
    record257.state,
  );

  const fiveSegments = closeableNoChildLifetime("structural-aggregate-bounds");
  for (let index = 0; index < 4; index += 1) {
    fiveSegments.startReboot();
    fiveSegments.appendEpoch();
    fiveSegments.appendConfigured();
  }
  const record1281 = explosiveArtifact("structural-record-1281");
  const records1281 = Array.from({ length: 1281 }, () =>
    artifact(fiveSegments.segments[0].records[0]),
  );
  records1281[0] = record1281.value;
  const segmentSizes = [256, 256, 256, 256, 257];
  let offset = 0;
  const segments1281 = fiveSegments.segments.map((segment, index) => {
    const records = records1281.slice(offset, offset + segmentSizes[index]);
    offset += segmentSizes[index];
    return { lifetimeIdentity: segment.identity, records };
  });
  assert.equal(offset, 1281);
  assertRejectedBeforeSentinel(
    () =>
      lifetime.replayCandidateContainmentGuardianLifetimeV1({
        ...exactReplayInput(fiveSegments),
        segments: segments1281,
      }),
    record1281.state,
  );

  assert.equal(1280 * 65536, 83886080);
  assert.equal(1279 * 65536 + 65537, 83886081);
  const byteState = {
    accessed: false,
    error: new Error("aggregate-byte sentinel was parsed"),
  };
  const sharedMaximumBytes = Buffer.alloc(65536, 0x61);
  const maximumPlusOneBytes = Buffer.alloc(65537, 0x61);
  const byteSentinel = {};
  Object.defineProperty(byteSentinel, "name", {
    enumerable: true,
    get() {
      byteState.accessed = true;
      throw byteState.error;
    },
  });
  Object.defineProperty(byteSentinel, "bytes", {
    enumerable: true,
    value: sharedMaximumBytes,
  });
  const aggregateArtifacts = Array.from({ length: 1280 }, () => ({
    name: "unparsed-aggregate-artifact",
    bytes: sharedMaximumBytes,
  }));
  aggregateArtifacts[0] = byteSentinel;
  aggregateArtifacts[1279] = {
    name: "unparsed-aggregate-plus-one",
    bytes: maximumPlusOneBytes,
  };
  offset = 0;
  const aggregateSegments = fiveSegments.segments.map((segment) => {
    const records = aggregateArtifacts.slice(offset, offset + 256);
    offset += 256;
    return { lifetimeIdentity: segment.identity, records };
  });
  assertRejectedBeforeSentinel(
    () =>
      lifetime.replayCandidateContainmentGuardianLifetimeV1({
        ...exactReplayInput(fiveSegments),
        segments: aggregateSegments,
      }),
    byteState,
  );
  assertContractReject(() =>
    lifetime.verifyCandidateContainmentGuardianLifetimeRecordV1({
      name: "0000000000000001-" + ZERO_SHA256 + ".jsonl",
      bytes: Buffer.alloc(65537, 0x61),
    }),
  );
});

test("rejects proxies, accessors, cycles, sparse arrays, and byte aliases", () => {
  const fixture = closeableNoChildLifetime("hostile-shapes");
  const identityInput = rebootIdentityInput(fixture, "hostile");
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(
      new Proxy(identityInput, {}),
    ),
  );

  const accessorInput = { ...identityInput };
  Object.defineProperty(accessorInput, "bootIdSha256", {
    enumerable: true,
    get: () => identityInput.bootIdSha256,
  });
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(
      accessorInput,
    ),
  );

  const foreignPrototype = Object.assign(
    Object.create({ inherited: true }),
    identityInput,
  );
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(
      foreignPrototype,
    ),
  );
  const cyclic = { ...identityInput };
  cyclic.cycle = cyclic;
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(cyclic),
  );
  const withToJson = { ...identityInput, toJSON: () => ({}) };
  assertContractReject(() =>
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1(withToJson),
  );

  const sparseSegments = new Array(1);
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1({
      ...exactReplayInput(fixture),
      segments: sparseSegments,
    }),
  );
  const extraPropertySegments = exactReplayInput(fixture).segments;
  extraPropertySegments.extra = true;
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1({
      ...exactReplayInput(fixture),
      segments: extraPropertySegments,
    }),
  );
  const sparseRecords = new Array(1);
  assertContractReject(() =>
    lifetime.replayCandidateContainmentGuardianLifetimeV1({
      ...exactReplayInput(fixture),
      segments: [
        {
          lifetimeIdentity: fixture.currentSegment.identity,
          records: sparseRecords,
        },
      ],
    }),
  );

  const record = fixture.currentSegment.records[0];
  assertContractReject(() =>
    lifetime.verifyCandidateContainmentGuardianLifetimeRecordV1({
      name: record.name,
      bytes: new Uint8Array(record.bytes),
    }),
  );
  assertContractReject(() =>
    lifetime.verifyCandidateContainmentGuardianLifetimeRecordV1({
      name: record.name,
      bytes: new Proxy(record.bytes, {}),
    }),
  );
});

test("contains no filesystem, cgroup, process, registration, or release authority", () => {
  const source = readFileSync(
    fileURLToPath(
      new URL(
        "../src/candidate/containment-guardian-lifetime-v1.mjs",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const staticImports = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["'];/gu),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["'];/gmu),
  ]
    .map((match) => match[1])
    .sort();
  const approvedPureImports = new Set([
    "../routing/features.mjs",
    "./containment-exact-v2.mjs",
  ]);
  assert.equal(
    staticImports.every((specifier) => approvedPureImports.has(specifier)),
    true,
  );
  assert.equal(
    staticImports.some((specifier) => specifier.includes("recovery-v1")),
    false,
  );
  for (const forbiddenImport of [
    /^node:/u,
    /(?:^|\/)containment-guardian-recovery-v1\.mjs$/u,
    /(?:native|physical|preflight|supervisor|runtime|registration|qualification|promotion|publication)/u,
  ]) {
    assert.equal(
      staticImports.some((specifier) => forbiddenImport.test(specifier)),
      false,
      forbiddenImport.source,
    );
  }
  assert.equal(/\bimport\s*\(/u.test(source), false, "dynamic import");
  for (const forbidden of [
    "node:fs",
    "node:child_process",
    "cgroup.kill",
    "cgroup.procs",
    "pidfd_open",
    "waitid(",
    "process.kill",
    "registerRuntime",
    "qualifyCandidate",
    "promoteCandidate",
    "publishCandidate",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.equal(
    Object.values(EXPECTED_AUTHORITY).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(EXPECTED_NONCLAIMS).every((value) => value === false),
    true,
  );
});
