import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "acorn";

const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-manager-protocol-v1.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SOURCE_REPOSITORY_PATH =
  "tools/engineering-harness/src/candidate/containment-guardian-manager-protocol-v1.mjs";
const EVALUATOR_REPOSITORY_PATH =
  "tools/engineering-harness/test/candidate-containment-guardian-manager-protocol-v1.test.mjs";
const AUTHORING_BASE = "ff0e858bdd14ba992102ad8cc773d069e4924184";
const AUTHORING_BASE_TREE = "61b72a66202c177c511b98cbceaf0307cfe6ddd2";

const ADR_URL = new URL(
  "../../../docs/adr/0037-durable-containment-statefs-and-manager-protocol.md",
  import.meta.url,
);
const STATEFS_EVALUATOR_URL = new URL(
  "./candidate-containment-guardian-statefs-v1.test.mjs",
  import.meta.url,
);
const EXACT_V2_URL = new URL(
  "../src/candidate/containment-exact-v2.mjs",
  import.meta.url,
);
const STATEFS_URL = new URL(
  "../src/candidate/containment-guardian-statefs-v1.mjs",
  import.meta.url,
);
const JOURNAL_URL = new URL(
  "../src/candidate/containment-guardian-journal-v2.mjs",
  import.meta.url,
);
const LIFETIME_URL = new URL(
  "../src/candidate/containment-guardian-lifetime-v1.mjs",
  import.meta.url,
);
const RECOVERY_URL = new URL(
  "../src/candidate/containment-guardian-recovery-v1.mjs",
  import.meta.url,
);
const CONTROL_URL = new URL(
  "../src/candidate/containment-guardian-control-v1.mjs",
  import.meta.url,
);
const OWNER_FIXTURE_URL = new URL(
  "./candidate-containment-guardian-recovery-v1.fixture.mjs",
  import.meta.url,
);

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
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
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
      `${label} array`,
    );
    assert.deepEqual(
      Object.keys(value),
      value.map((_, index) => String(index)),
      `${label} dense`,
    );
    for (const [index, child] of value.entries()) {
      assertNullFrozenTree(child, `${label}[${index}]`, seen);
    }
    return;
  }
  assert.equal(Object.getPrototypeOf(value), null, `${label} null prototype`);
  for (const [key, child] of Object.entries(value)) {
    assertNullFrozenTree(child, `${label}.${key}`, seen);
  }
}

function assertExactFields(value, expected, label) {
  assert.deepEqual(Object.keys(value), expected, `${label} field order`);
}

function expectCode(call, code) {
  assert.throws(call, (error) => {
    assert.equal(error?.message, code);
    return true;
  });
}

function expectPrecedence(call, earlierCode, laterCode, label) {
  let caught = null;
  try {
    call();
  } catch (error) {
    caught = error;
  }
  assert.notEqual(caught, null, `${label} throws`);
  assert.equal(caught?.message, earlierCode, `${label} earlier code wins`);
  if (laterCode !== null) {
    assert.notEqual(caught?.message, laterCode, `${label} later code loses`);
  }
  return caught.message;
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

const TOP_LEVEL_FIELDS = fields(`
  schema version predecessors importInventory schemas limits inputKinds epochFields
  stateFields inputArgumentFields inputFields transitionFields handoffPlanFields
  recoveryRequestArtifactFields transitionRuleFields crashPrefixRuleFields statuses
  writerKinds actorKinds guardianActions statefsOutcomes transitionTable crashPrefixTable
  errorPrecedence orderingRules authority physicalFacts nonclaims
`);
const EPOCH_FIELDS = fields(`
  schema byteLength managerActorEpochSha256 consumed authority physicalFacts nonclaims
`);
const STATE_FIELDS = fields(`
  schema requirementsSha256 sequence nextStatefsRequestSequence inventoryRequestCount
  inventorySetSha256 inventoryComplete activeDirectoryHandleCount
  activeDirectoryHandlesSha256 previousStateSha256 stateSha256 managerActorEpochSha256
  status writerKind actorKind targetSha256 requiredDurableRecordType permittedStatefsOperation
  permittedGuardianAction requiredOutcomeRecordType statefsPlanSha256 statefsRequestSha256
  guardianStartupSha256 recoveryRequestFrameRawSha256 lastGuardianWireSequence
  lastGuardianWireFrameRawSha256 unresolvedEffect retryPermitted terminal authority
  physicalFacts nonclaims
`);
const INPUT_ARGUMENT_FIELDS = fields(`
  kind statefsPlan statefsReceipt guardianStartupProjection guardianControlState
  guardianRecoveryRequestFrameBytes guardianRequestEofObserved guardianStatusFrameBytes
`);
const INPUT_FIELDS = fields(`
  schema kind boundStateSha256 statefsRequestSha256 statefsReceiptSha256 statefsPlanSha256
  ownerContextSha256 lifetimeReplaySha256 guardianStartupSha256
  guardianControlStateSha256 guardianRecoveryRequestFrameRawSha256
  guardianRequestEofObserved guardianStatusFrameRawSha256 inputSha256 authority
  physicalFacts nonclaims
`);
const TRANSITION_FIELDS = fields(`
  schema previousStateSha256 inputSha256 state statefsPlan statefsRequest
  guardianHandoffPlan guardianRecoveryRequestArtifact guardianStatusArtifact transitionSha256
  authority physicalFacts nonclaims
`);
const HANDOFF_PLAN_FIELDS = fields(`
  schema mode action managerActorEpochSha256 lifetimeEpochSha256 targetSha256
  recoveryActorEpochSha256 descriptorRoles recoverySelection recoverySelectionSha256
  planSha256 authority physicalFacts nonclaims
`);
const RECOVERY_REQUEST_ARTIFACT_FIELDS = fields(`
  bytes controlInput schema guardianHandoffPlanSha256 startupSha256 controlStateSha256
  recoverySelectionSha256 recoveryRequestFrameRawSha256 artifactSha256 authority
  physicalFacts nonclaims
`);
const RECOVERY_SELECTION_FIELDS = fields(`
  schema targetSha256 recoveryRequirementsSha256 recoveryPlanSha256 recoveryReplaySha256
  lifecycleInventorySha256 attemptSha256 planStatus requiredActorKind actorKind
  recoveryActorEpochSha256 attemptDirectoryName lifetimeAnchorProjectionSha256
  lifetimeAttemptAnchorRawSha256 disposition quarantineReason sourceLocation
  decisionSourceLocation requiredDestinationLocation stateCount state0 state1 state2 state3
  state4 state5 state6 state7 state8 state9 state10 state11 state12 state13 state14 state15
  state16 state17 state18
`);
const TRANSITION_RULE_FIELDS = fields(`
  id currentStatusOrOperation inputPredicate result
`);
const CRASH_PREFIX_RULE_FIELDS = fields(`
  id lastCompletePrefix requiredResponse
`);

const PREDECESSORS = pairs(
  [
    "statefsV1RequirementsSha256",
    "9b401032c2b0331174f74895181e906106bb86a32204b818b30686d9a47c0a42",
  ],
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
    "./containment-guardian-statefs-v1.mjs",
    array(
      "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS",
      "assertCandidateContainmentGuardianStatefsPlanV1",
      "assertCandidateContainmentGuardianStatefsReceiptV1",
    ),
  ),
  array(
    "./containment-guardian-control-v1.mjs",
    array(
      "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS",
      "createCandidateContainmentGuardianRecoveryRequestInputV1",
      "verifyCandidateContainmentGuardianStatusFrameV1",
    ),
  ),
);

const SCHEMAS = pairs(
  [
    "requirements",
    "oxigraph.candidate-containment-guardian-manager-protocol-requirements/v1",
  ],
  [
    "managerActorEpoch",
    "oxigraph.candidate-containment-guardian-manager-actor-epoch/v1",
  ],
  [
    "input",
    "oxigraph.candidate-containment-guardian-manager-protocol-input/v1",
  ],
  [
    "state",
    "oxigraph.candidate-containment-guardian-manager-protocol-state/v1",
  ],
  [
    "transition",
    "oxigraph.candidate-containment-guardian-manager-protocol-transition/v1",
  ],
  [
    "guardianHandoffPlan",
    "oxigraph.candidate-containment-guardian-manager-handoff-plan/v1",
  ],
  [
    "guardianRecoveryRequestArtifact",
    "oxigraph.candidate-containment-guardian-manager-recovery-request-artifact/v1",
  ],
);

const LIMITS = pairs(
  ["managerActorEpochBytes", 32],
  ["transitionSequenceMaximum", 2_999_999],
  ["statefsRequestSequenceMaximum", 999_999],
  ["inventoryRequestsMaximum", 250_000],
  ["guardianStatusFrameBytes", 8192],
  ["guardianRecoveryRequestFrameBytes", 32_768],
  ["guardianWireSequenceMaximum", 5],
);
const INPUT_KINDS = array(
  "STATEFS_PLAN",
  "STATEFS_RECEIPT",
  "RECOVERY_REQUEST_OBSERVED",
  "GUARDIAN_STATUS_FRAME",
);
const STATUSES = array(
  "LOCK_REQUIRED",
  "LOCK_CONTENDED",
  "INVENTORY_REQUIRED",
  "INVENTORY_BLOCKED",
  "REPLAY_REQUIRED",
  "STATEFS_OPERATION_REQUIRED",
  "GUARDIAN_HANDOFF_REQUIRED",
  "WAITING_FOR_GUARDIAN",
  "EFFECT_UNCERTAIN",
  "TERMINAL",
);
const WRITER_KINDS = array(
  "SERVICE_MANAGER",
  "LIVE_BIRTH_GUARDIAN",
  "RECOVERY_ONLY_GUARDIAN",
);
const ACTOR_KINDS = array("LIVE_BIRTH_GUARDIAN", "RECOVERY_ONLY_GUARDIAN");
const GUARDIAN_ACTIONS = array(
  "NORMAL_CONTROL_HANDOFF",
  "RECOVERY_CONTROL_HANDOFF",
  "WAIT_STATUS",
);
const STATEFS_OUTCOMES = array(
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
const ERROR_PRECEDENCE = array(
  "MANAGER_BOUNDS",
  "MANAGER_SHAPE",
  "MANAGER_EPOCH",
  "MANAGER_PREDECESSOR",
  "MANAGER_BINDING",
  "MANAGER_WRITER",
  "MANAGER_TRANSITION",
);
const ORDERING_RULES = array(
  "manager-brand-before-executor/v1",
  "exact-next-request-sequence/v1",
  "inventory-depth-first/v1",
  "intent-before-statefs/v1",
  "statefs-before-outcome/v1",
  "guardian-writer-separation/v1",
  "transition-one-shot-dispatch/v1",
  "crash-prefix-no-retry/v1",
  "terminal-consumes-state/v1",
);

function literalPaddedCells(widths, values) {
  assert.equal(values.length, widths.length);
  return array(
    ...values.map((value, index) => {
      assert.equal(value.endsWith(" "), false);
      assert.equal(value.length <= widths[index], true);
      return value.padEnd(widths[index], " ");
    }),
  );
}

const TRANSITION_IDS = array(
  "T01",
  "T02",
  "T03",
  "T04",
  "T05",
  "T06",
  "T07",
  "T08",
  "T09",
  "T10",
  "T11",
  "T12",
  "T13",
  "T14",
  "T15",
  "T16",
  "T17",
  "T18",
  "T19",
  "T20",
  "T21",
  "T22",
  "T23",
  "T24",
  "T25",
);

const TRANSITION_CELL_TEXT = array(
  literalPaddedCells(
    [92, 222, 223],
    [
      "`LOCK_REQUIRED`",
      "request-bearing `STATEFS_PLAN`; next sequence; `RQ.operation=LOCK_EX_NB`; `PL.inventorySet=null`; owner context all null",
      "`S(STATEFS_OPERATION_REQUIRED,SM,N,N,N,LOCK_EX_NB,N,N,PL.planSha256,RQ.requestSha256,F,F,F)` and transition exposes `PL`/`RQ`",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/LOCK_EX_NB`",
      "`STATEFS_RECEIPT`; `RC.request` is retained; `RC.outcome=LOCK_HELD`; exact root observation and empty revision-zero token",
      "`S(INVENTORY_REQUIRED,SM,N,N,N,INVENTORY,N,N,N,N,F,F,F)` and installs that token/digest plus the singleton root handle/count",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/LOCK_EX_NB`",
      "`STATEFS_RECEIPT`; retained request; `RC.outcome=LOCK_CONTENDED`; no successor token",
      "`S(LOCK_CONTENDED,N,N,N,N,N,N,N,N,N,F,F,T)`",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`INVENTORY_REQUIRED`",
      "request-bearing `STATEFS_PLAN`; next sequence; exact retained token; `RQ.operation=INVENTORY`",
      "`S(STATEFS_OPERATION_REQUIRED,SM,N,N,N,INVENTORY,N,N,PL.planSha256,RQ.requestSha256,F,F,F)` and transition exposes `PL`/`RQ`",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`INVENTORY_REQUIRED`",
      "request-bearing `STATEFS_PLAN`; next sequence; exact retained token; `RQ.operation=RELEASE_DIRECTORY` and context identifies the exact nonroot DFS top",
      "`S(STATEFS_OPERATION_REQUIRED,SM,N,N,N,RELEASE_DIRECTORY,N,N,PL.planSha256,RQ.requestSha256,F,F,F)` and transition exposes `PL`/`RQ`",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/INVENTORY` with `inventoryComplete=false`",
      "`STATEFS_RECEIPT`; retained request; `RC.outcome=INVENTORY_OBSERVED`; inventory/token exact and safe; traversal work remains",
      "`S(INVENTORY_REQUIRED,SM,N,N,N,INVENTORY,N,N,N,N,F,F,F)` with updated count/map/token and complete false",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/INVENTORY` with `inventoryComplete=false`",
      "same, traversal work empty except retained root",
      "`S(REPLAY_REQUIRED,SM,N,N,N,N,N,N,N,N,F,F,F)` with updated count/map/token and complete true",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/INVENTORY`",
      "`STATEFS_RECEIPT`; `RC.retryDisposition=NO_RETRY`, `RC.outcome=REJECTED`, and null successor for unsafe, aliased, residue, over-bound, or drifted inventory; every binding/token defect throws before a row",
      "`S(INVENTORY_BLOCKED,N,N,N,N,N,N,N,N,N,F,F,T)`",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/RELEASE_DIRECTORY` with `inventoryComplete=false`",
      "retained exact complete receipt/same-map successor; pending DFS work remains",
      "`S(INVENTORY_REQUIRED,SM,N,N,N,INVENTORY,N,N,N,N,F,F,F)` with popped handle/successor token",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/RELEASE_DIRECTORY` with `inventoryComplete=false`",
      "same, no pending work and only root remains",
      "`S(REPLAY_REQUIRED,SM,N,N,N,N,N,N,N,N,F,F,F)` with popped handle, complete true",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`REPLAY_REQUIRED`",
      "request-bearing `STATEFS_PLAN`; next sequence; exact current token; statefs owner context uniquely selects any inventory/release/mutation/persistence request",
      "`S(STATEFS_OPERATION_REQUIRED,RQ.writerKind,RQ.actorKind,RQ.targetSha256,RQ.requiredDurableRecordType,RQ.operation,N,RQ.requiredOutcomeRecordType,PL.planSha256,RQ.requestSha256,F,F,F)` and transition exposes `PL`/`RQ`",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/INVENTORY` or `/RELEASE_DIRECTORY` with `inventoryComplete=true`",
      "retained exact complete receipt and exact successor token for mutation-pass open/release",
      "`S(REPLAY_REQUIRED,SM,N,N,N,N,N,N,N,N,F,F,F)` with updated map/token/handle stack and complete true",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`REPLAY_REQUIRED`",
      "context-only `STATEFS_PLAN`; exact owner context; `managerDisposition=GUARDIAN_HANDOFF`",
      "`S(GUARDIAN_HANDOFF_REQUIRED,SM,PL.actorKind,PL.targetSha256,N,N,PL.guardianAction,N,PL.planSha256,N,F,F,F)` plus exact plan/context handoff",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`REPLAY_REQUIRED`",
      "context-only `STATEFS_PLAN`; exact owner context; `managerDisposition=WAIT_GUARDIAN`",
      "`S(WAITING_FOR_GUARDIAN,N,PL.actorKind,PL.targetSha256,N,N,WAIT_STATUS,N,PL.planSha256,N,F,F,F)`",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`REPLAY_REQUIRED`",
      "context-only `STATEFS_PLAN`; exact owner context; `managerDisposition=RECOVERY_REPLAN`",
      "`S(INVENTORY_REQUIRED,SM,N,PL.targetSha256,N,INVENTORY,N,N,PL.planSha256,N,F,F,F)` with count zero, complete false, retained token, singleton-root DFS reset",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`REPLAY_REQUIRED`",
      "context-only `STATEFS_PLAN`; exact owner context; `managerDisposition=TERMINAL`",
      "`S(TERMINAL,N,N,PL.targetSha256,N,N,N,N,PL.planSha256,N,F,F,T)`",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED` for a mutating/persistence request",
      "retained exact `STATEFS_RECEIPT`; complete outcome, or observation-only `ALREADY_PRESENT_EXACT`, `DIRECTORY_ALREADY_PRESENT_EXACT`, `DESTINATION_ALREADY_PRESENT_EXACT`, or `TEMP_ALREADY_ABSENT`; exact successor token/delta",
      "`S(REPLAY_REQUIRED,RC.writerKind,RC.actorKind,RC.targetSha256,N,N,N,N,N,N,F,F,F)` with successor token/map; a required outcome record is selected only by a later plan",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "any non-lock, non-release `STATEFS_OPERATION_REQUIRED`",
      "retained exact receipt; unchanged-map successor; `RC.outcome=FAILED_DEFINITE_NO_EFFECT`; `RC.retryDisposition=REPLAN_AFTER_FRESH_INVENTORY`",
      "`S(INVENTORY_REQUIRED,SM,N,RC.targetSha256,N,INVENTORY,N,N,N,N,F,T,F)` with successor token, count zero, complete false, and singleton-root DFS reset pending",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "any `STATEFS_OPERATION_REQUIRED`",
      "retained exact receipt; mutation-not-fully-synced or effect-uncertain; successor null",
      "`S(EFFECT_UNCERTAIN,N,N,RC.targetSha256,N,N,N,N,N,N,T,F,T)`; a release request retires/pops the exact top handle already removed by the adapter",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`STATEFS_OPERATION_REQUIRED/LOCK_EX_NB` or any non-inventory operation",
      "retained exact non-success receipt not matched above; `RC.retryDisposition=NO_RETRY`; `RC.outcome=FAILED_DEFINITE_NO_EFFECT` or `REJECTED`; successor null",
      "`S(TERMINAL,N,N,RC.targetSha256,N,N,N,N,N,N,F,F,T)`; a release request retires/pops the exact top handle after the adapter's mandatory teardown",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`GUARDIAN_HANDOFF_REQUIRED` with recovery plan and no bound request",
      "`RECOVERY_REQUEST_OBSERVED`; exact ADR-0036 recovery startup/initial control state matching the plan's mode, requirements, and recovery actor epoch; sequence-zero request bytes and EOF observation",
      "`S(GUARDIAN_HANDOFF_REQUIRED,N,current.actorKind,current.targetSha256,N,N,RECOVERY_CONTROL_HANDOFF,N,current.statefsPlanSha256,N,F,F,F)` and exposes the recovery-request artifact, retaining sequence 0/request digest/startup",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`GUARDIAN_HANDOFF_REQUIRED` with normal plan",
      "`GUARDIAN_STATUS_FRAME`; exact `NORMAL_READY`, sequence 0, zero predecessor, matching plan startup/epoch",
      "`S(WAITING_FOR_GUARDIAN,N,current.actorKind,current.targetSha256,N,N,WAIT_STATUS,N,current.statefsPlanSha256,N,F,F,F)` and exposes verified artifact/normal wire prefix",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`GUARDIAN_HANDOFF_REQUIRED` with recovery plan and bound request",
      "`GUARDIAN_STATUS_FRAME`; exact `RECOVERY_REQUEST_ACCEPTED`, sequence 1, predecessor/request field equal retained request digest, matching plan",
      "`S(WAITING_FOR_GUARDIAN,N,current.actorKind,current.targetSha256,N,N,WAIT_STATUS,N,current.statefsPlanSha256,N,F,F,F)` and exposes verified artifact/recovery wire prefix",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`WAITING_FOR_GUARDIAN`",
      "`GUARDIAN_STATUS_FRAME`; exact next nonterminal `ADMISSION_ACCEPTED`, `CANCEL_REQUIRED`, or `RECOVERY_REQUIRED` in ADR-0036 scenario",
      "`S(WAITING_FOR_GUARDIAN,N,current.actorKind,current.targetSha256,N,N,WAIT_STATUS,N,current.statefsPlanSha256,N,F,F,F)` and exposes artifact/advances wire prefix",
    ],
  ),
  literalPaddedCells(
    [92, 222, 223],
    [
      "`WAITING_FOR_GUARDIAN`",
      "`GUARDIAN_STATUS_FRAME`; exact next `CONTROL_TERMINAL` in ADR-0036 scenario",
      "`S(REPLAY_REQUIRED,SM,N,current.targetSha256,N,N,N,N,N,N,F,F,F)` and exposes final artifact, then resets guardian-chain fields",
    ],
  ),
);

const TRANSITION_TABLE = array(
  ...TRANSITION_IDS.map((id, index) =>
    record(
      ["id", id],
      ["currentStatusOrOperation", TRANSITION_CELL_TEXT[index][0]],
      ["inputPredicate", TRANSITION_CELL_TEXT[index][1]],
      ["result", TRANSITION_CELL_TEXT[index][2]],
    ),
  ),
);

const CRASH_PREFIX_IDS = array(
  "C01",
  "C02",
  "C03",
  "C04",
  "C05",
  "C06",
  "C07",
  "C08",
  "C09",
  "C10",
  "C11",
  "C12",
  "C13",
  "C14",
  "C15",
);
const CRASH_PREFIX_CELL_TEXT = array(
  literalPaddedCells(
    [70, 215],
    [
      "before intent",
      "perform no physical mutation; recompute from complete replay",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "intent durable, no request/result",
      "inventory, then plan the one still-admitted operation",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "request issued, no complete result",
      "inventory; accept only exact proved completion or definite no effect, otherwise `EFFECT_UNCERTAIN`",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "temporary created/written/read back/file-synced but final absent",
      "preserve residue, do not recast as empty; block or select separately authorized cleanup",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "final installed but parent sync or reobservation absent",
      "no retry; `EFFECT_UNCERTAIN` even if the current name is present",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "directory created but child/parent sync absent",
      "no retry; inventory and unresolved-effect handling",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "generation moved but either parent sync/reobservation absent",
      "no second move; only `MOVE_SYNC_REOBSERVE` is permitted when complete fresh inventory, exact identity, and the durable move decision match; a surviving same-process unresolved receipt is optional additional evidence",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "complete physical receipt, outcome record absent",
      "append only the matching outcome record with the original writer/actor",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "manager dies while guardian retains the shared lock",
      "replacement manager does not reacquire, write, signal, wait, close, or adopt; it waits for exact guardian/lock resolution",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "manager and guardian are gone and lock is reacquired",
      "require ADR-0035 replacement evidence, complete lifetime/recovery replay, cgroup observations from ADR-0038, and fresh statefs inventory before selecting anything",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "guardian dies before launch proof",
      "only exact same-manager definite-no-child or replacement partial-launch resolution may advance",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "live-birth guardian dies after adoption",
      "service manager may write a result only after ADR-0035's exact terminal resolution or proved reboot; it never impersonates the guardian",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "recovery guardian dies after launch intent",
      "require its exact pidfd/exec/membership prefix plus terminal resolution or proved reboot before manager-written result",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "recovery-only anchor never launches before record-1 temporary creation",
      "manager may select anchored-empty only from exact `ABSENT` or `PRESENT_EMPTY`; any residue blocks",
    ],
  ),
  literalPaddedCells(
    [70, 215],
    [
      "state 18",
      "no recovery actor; exact active-to-closed no-replace move or `MOVE_SYNC_REOBSERVE`, then branded close receipt",
    ],
  ),
);
const CRASH_PREFIX_TABLE = array(
  ...CRASH_PREFIX_IDS.map((id, index) =>
    record(
      ["id", id],
      ["lastCompletePrefix", CRASH_PREFIX_CELL_TEXT[index][0]],
      ["requiredResponse", CRASH_PREFIX_CELL_TEXT[index][1]],
    ),
  ),
);

const EXPECTED_REQUIREMENTS = record(
  [
    "schema",
    "oxigraph.candidate-containment-guardian-manager-protocol-requirements/v1",
  ],
  ["version", 1],
  ["predecessors", PREDECESSORS],
  ["importInventory", IMPORT_INVENTORY],
  ["schemas", SCHEMAS],
  ["limits", LIMITS],
  ["inputKinds", INPUT_KINDS],
  ["epochFields", EPOCH_FIELDS],
  ["stateFields", STATE_FIELDS],
  ["inputArgumentFields", INPUT_ARGUMENT_FIELDS],
  ["inputFields", INPUT_FIELDS],
  ["transitionFields", TRANSITION_FIELDS],
  ["handoffPlanFields", HANDOFF_PLAN_FIELDS],
  ["recoveryRequestArtifactFields", RECOVERY_REQUEST_ARTIFACT_FIELDS],
  ["transitionRuleFields", TRANSITION_RULE_FIELDS],
  ["crashPrefixRuleFields", CRASH_PREFIX_RULE_FIELDS],
  ["statuses", STATUSES],
  ["writerKinds", WRITER_KINDS],
  ["actorKinds", ACTOR_KINDS],
  ["guardianActions", GUARDIAN_ACTIONS],
  ["statefsOutcomes", STATEFS_OUTCOMES],
  ["transitionTable", TRANSITION_TABLE],
  ["crashPrefixTable", CRASH_PREFIX_TABLE],
  ["errorPrecedence", ERROR_PRECEDENCE],
  ["orderingRules", ORDERING_RULES],
  ["authority", AUTHORITY],
  ["physicalFacts", PHYSICAL_FACTS],
  ["nonclaims", NONCLAIMS],
);

const EXPECTED_REQUIREMENTS_SHA256 =
  "a6e98c1956c0a4a37a4b8a5ca46e56b0e9e66bf76928cd1669e43e4db1a68d02";
const EXPECTED_EXPORTS = array(
  "CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS",
  "CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256",
  "assertCandidateContainmentGuardianManagerProtocolTransitionV1",
  "createCandidateContainmentGuardianManagerActorEpochV1",
  "createCandidateContainmentGuardianManagerProtocolInputV1",
  "initializeCandidateContainmentGuardianManagerProtocolV1",
  "reduceCandidateContainmentGuardianManagerProtocolV1",
);
const EXPECTED_FUNCTION_ARITIES = pairs(
  ["createCandidateContainmentGuardianManagerActorEpochV1", 1],
  ["createCandidateContainmentGuardianManagerProtocolInputV1", 2],
  ["initializeCandidateContainmentGuardianManagerProtocolV1", 1],
  ["reduceCandidateContainmentGuardianManagerProtocolV1", 2],
  ["assertCandidateContainmentGuardianManagerProtocolTransitionV1", 1],
);

const ZERO_DIGEST = "0".repeat(64);
const LISTED_STATUS_KIND_PAIRS = new Set([
  "LOCK_REQUIRED\0STATEFS_PLAN",
  "INVENTORY_REQUIRED\0STATEFS_PLAN",
  "REPLAY_REQUIRED\0STATEFS_PLAN",
  "STATEFS_OPERATION_REQUIRED\0STATEFS_RECEIPT",
  "GUARDIAN_HANDOFF_REQUIRED\0RECOVERY_REQUEST_OBSERVED",
  "GUARDIAN_HANDOFF_REQUIRED\0GUARDIAN_STATUS_FRAME",
  "WAITING_FOR_GUARDIAN\0GUARDIAN_STATUS_FRAME",
]);
const STATUS_INPUT_PRODUCT = array(
  ...STATUSES.flatMap((status) =>
    INPUT_KINDS.map((kind) =>
      record(
        ["status", status],
        ["kind", kind],
        ["listed", LISTED_STATUS_KIND_PAIRS.has(`${status}\0${kind}`)],
        [
          "defaultResult",
          LISTED_STATUS_KIND_PAIRS.has(`${status}\0${kind}`)
            ? "PREDICATE_REQUIRED"
            : "MANAGER_TRANSITION",
        ],
      ),
    ),
  ),
);

const POSITIVE_TRANSITION_CASES = array(
  record(
    ["id", "T01"],
    ["status", "LOCK_REQUIRED"],
    ["kind", "STATEFS_PLAN"],
    ["predicate", "LOCK_EX_NB"],
  ),
  record(
    ["id", "T02"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "LOCK_HELD"],
  ),
  record(
    ["id", "T03"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "LOCK_CONTENDED"],
  ),
  record(
    ["id", "T04"],
    ["status", "INVENTORY_REQUIRED"],
    ["kind", "STATEFS_PLAN"],
    ["predicate", "RQ.operation=INVENTORY"],
  ),
  record(
    ["id", "T05"],
    ["status", "INVENTORY_REQUIRED"],
    ["kind", "STATEFS_PLAN"],
    ["predicate", "RQ.operation=RELEASE_DIRECTORY"],
  ),
  record(
    ["id", "T06"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "traversal work remains"],
  ),
  record(
    ["id", "T07"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "traversal work empty except retained root"],
  ),
  record(
    ["id", "T08"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "RC.outcome=REJECTED"],
  ),
  record(
    ["id", "T09"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "pending DFS work remains"],
  ),
  record(
    ["id", "T10"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "no pending work and only root remains"],
  ),
  record(
    ["id", "T11"],
    ["status", "REPLAY_REQUIRED"],
    ["kind", "STATEFS_PLAN"],
    ["predicate", "request-bearing"],
  ),
  record(
    ["id", "T12"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "inventoryComplete=true"],
  ),
  record(
    ["id", "T13"],
    ["status", "REPLAY_REQUIRED"],
    ["kind", "STATEFS_PLAN"],
    ["predicate", "managerDisposition=GUARDIAN_HANDOFF"],
  ),
  record(
    ["id", "T14"],
    ["status", "REPLAY_REQUIRED"],
    ["kind", "STATEFS_PLAN"],
    ["predicate", "managerDisposition=WAIT_GUARDIAN"],
  ),
  record(
    ["id", "T15"],
    ["status", "REPLAY_REQUIRED"],
    ["kind", "STATEFS_PLAN"],
    ["predicate", "managerDisposition=RECOVERY_REPLAN"],
  ),
  record(
    ["id", "T16"],
    ["status", "REPLAY_REQUIRED"],
    ["kind", "STATEFS_PLAN"],
    ["predicate", "managerDisposition=TERMINAL"],
  ),
  record(
    ["id", "T17"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "complete outcome"],
  ),
  record(
    ["id", "T18"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "REPLAN_AFTER_FRESH_INVENTORY"],
  ),
  record(
    ["id", "T19"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "effect-uncertain"],
  ),
  record(
    ["id", "T20"],
    ["status", "STATEFS_OPERATION_REQUIRED"],
    ["kind", "STATEFS_RECEIPT"],
    ["predicate", "non-success receipt not matched above"],
  ),
  record(
    ["id", "T21"],
    ["status", "GUARDIAN_HANDOFF_REQUIRED"],
    ["kind", "RECOVERY_REQUEST_OBSERVED"],
    ["predicate", "sequence-zero request bytes"],
  ),
  record(
    ["id", "T22"],
    ["status", "GUARDIAN_HANDOFF_REQUIRED"],
    ["kind", "GUARDIAN_STATUS_FRAME"],
    ["predicate", "NORMAL_READY"],
  ),
  record(
    ["id", "T23"],
    ["status", "GUARDIAN_HANDOFF_REQUIRED"],
    ["kind", "GUARDIAN_STATUS_FRAME"],
    ["predicate", "RECOVERY_REQUEST_ACCEPTED"],
  ),
  record(
    ["id", "T24"],
    ["status", "WAITING_FOR_GUARDIAN"],
    ["kind", "GUARDIAN_STATUS_FRAME"],
    ["predicate", "ADMISSION_ACCEPTED"],
  ),
  record(
    ["id", "T25"],
    ["status", "WAITING_FOR_GUARDIAN"],
    ["kind", "GUARDIAN_STATUS_FRAME"],
    ["predicate", "CONTROL_TERMINAL"],
  ),
);

const TRANSITION_NEAR_MISSES = array(
  record(
    ["id", "T01"],
    ["mutation", "request-sequence-not-next"],
    ["classification", "EARLIER_ERROR"],
    ["result", "MANAGER_BINDING"],
  ),
  record(
    ["id", "T02"],
    ["mutation", "receipt-outcome-lock-contended"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T03"],
  ),
  record(
    ["id", "T03"],
    ["mutation", "receipt-outcome-lock-held"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T02"],
  ),
  record(
    ["id", "T04"],
    ["mutation", "request-operation-release-directory"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T05"],
  ),
  record(
    ["id", "T05"],
    ["mutation", "request-operation-inventory"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T04"],
  ),
  record(
    ["id", "T06"],
    ["mutation", "dfs-work-empty"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T07"],
  ),
  record(
    ["id", "T07"],
    ["mutation", "dfs-work-remains"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T06"],
  ),
  record(
    ["id", "T08"],
    ["mutation", "receipt-has-successor-token"],
    ["classification", "EARLIER_ERROR"],
    ["result", "MANAGER_PREDECESSOR"],
  ),
  record(
    ["id", "T09"],
    ["mutation", "dfs-work-empty-after-pop"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T10"],
  ),
  record(
    ["id", "T10"],
    ["mutation", "dfs-work-remains-after-pop"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T09"],
  ),
  record(
    ["id", "T11"],
    ["mutation", "context-only-plan"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T13"],
  ),
  record(
    ["id", "T12"],
    ["mutation", "inventory-complete-false"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T06"],
  ),
  record(
    ["id", "T13"],
    ["mutation", "disposition-wait-guardian"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T14"],
  ),
  record(
    ["id", "T14"],
    ["mutation", "disposition-recovery-replan"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T15"],
  ),
  record(
    ["id", "T15"],
    ["mutation", "disposition-terminal"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T16"],
  ),
  record(
    ["id", "T16"],
    ["mutation", "disposition-guardian-handoff"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T13"],
  ),
  record(
    ["id", "T17"],
    ["mutation", "receipt-failed-definite"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T18"],
  ),
  record(
    ["id", "T18"],
    ["mutation", "retry-no-retry"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T20"],
  ),
  record(
    ["id", "T19"],
    ["mutation", "receipt-has-successor-token"],
    ["classification", "EARLIER_ERROR"],
    ["result", "MANAGER_PREDECESSOR"],
  ),
  record(
    ["id", "T20"],
    ["mutation", "retry-replan-after-fresh-inventory"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T18"],
  ),
  record(
    ["id", "T21"],
    ["mutation", "request-eof-false"],
    ["classification", "EARLIER_ERROR"],
    ["result", "MANAGER_PREDECESSOR"],
  ),
  record(
    ["id", "T22"],
    ["mutation", "first-status-not-normal-ready"],
    ["classification", "EARLIER_ERROR"],
    ["result", "MANAGER_BINDING"],
  ),
  record(
    ["id", "T23"],
    ["mutation", "request-digest-predecessor-mismatch"],
    ["classification", "EARLIER_ERROR"],
    ["result", "MANAGER_BINDING"],
  ),
  record(
    ["id", "T24"],
    ["mutation", "wire-sequence-not-next"],
    ["classification", "EARLIER_ERROR"],
    ["result", "MANAGER_BINDING"],
  ),
  record(
    ["id", "T25"],
    ["mutation", "nonterminal-status"],
    ["classification", "VALID_ALTERNATE"],
    ["result", "T24"],
  ),
);

const CRASH_PREFIX_RUNTIME_COVERAGE = pairs(
  ["C01", "REPLAY_RECOMPUTE"],
  ["C02", "T15"],
  ["C03", "T18_OR_T19"],
  ["C04", "T08_OR_T19"],
  ["C05", "T19"],
  ["C06", "T18_OR_T19"],
  ["C07", "T11_MOVE_SYNC_REOBSERVE"],
  ["C08", "T11_OUTCOME_RECORD"],
  ["C09", "OWNER_RUNTIME_ONLY"],
  ["C10", "OWNER_RUNTIME_ONLY"],
  ["C11", "OWNER_RUNTIME_ONLY"],
  ["C12", "OWNER_RUNTIME_ONLY"],
  ["C13", "OWNER_RUNTIME_ONLY"],
  ["C14", "T15_AFTER_ANCHORED_EMPTY_PREDECESSOR"],
  ["C15", "T11_T17_STATE_18_MOVE_SYNC_REOBSERVE"],
);

const [statefs, journal, lifetime, recovery, control, ownerFixtures] =
  await Promise.all([
    import(STATEFS_URL.href),
    import(JOURNAL_URL.href),
    import(LIFETIME_URL.href),
    import(RECOVERY_URL.href),
    import(CONTROL_URL.href),
    import(OWNER_FIXTURE_URL.href),
  ]);

function exactMissingCandidateError(error) {
  const expectedMessage = `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`;
  if (
    error === null ||
    typeof error !== "object" ||
    error.code !== "ERR_MODULE_NOT_FOUND" ||
    error.message !== expectedMessage
  ) {
    return false;
  }
  if (error.url !== undefined) return error.url === SOURCE_URL.href;
  return true;
}

async function assertArtifactPin(
  url,
  { byteLength, lineFeeds, sha256, gitBlob },
) {
  const bytes = await readFile(url);
  assert.equal(bytes.length, byteLength, fileURLToPath(url));
  assert.equal(
    bytes.reduce((count, byte) => count + Number(byte === 0x0a), 0),
    lineFeeds,
    `${fileURLToPath(url)} LF count`,
  );
  assert.equal(bytes.includes(0x0d), false, `${fileURLToPath(url)} no CR`);
  assert.equal(bytes.at(-1), 0x0a, `${fileURLToPath(url)} final LF`);
  assert.equal(byteSha256(bytes), sha256, `${fileURLToPath(url)} SHA-256`);
  assert.equal(gitBlobSha1(bytes), gitBlob, `${fileURLToPath(url)} Git blob`);
}

function git(...args) {
  const result = spawnSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    shell: false,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function parsePinnedAdrTable(source, header, widths) {
  const headerIndex = source.indexOf(header);
  assert.notEqual(headerIndex, -1, header);
  const tableStart = source.lastIndexOf("\n", headerIndex) + 1;
  const tableEnd = source.indexOf("\n\n", headerIndex);
  assert.notEqual(tableEnd, -1, `${header} terminator`);
  const lines = source.slice(tableStart, tableEnd).split("\n");
  assert.equal(lines.length >= 3, true);
  return array(
    ...lines.slice(2).map((line) => {
      assert.equal(line.startsWith("| "), true);
      assert.equal(line.endsWith(" |"), true);
      const cells = line.split("|").slice(1, -1);
      assert.equal(cells.length, widths.length);
      return array(
        ...cells.map((cell, index) => {
          assert.equal(cell.startsWith(" "), true);
          assert.equal(cell.endsWith(" "), true);
          const exact = cell.slice(1, -1);
          assert.equal(exact.length, widths[index]);
          return exact;
        }),
      );
    }),
  );
}

function reconstructPreS7V5ManagerEvaluatorSource(source) {
  const countExact = (value, needle) => {
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = value.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactly = (value, before, after, label) => {
    assert.equal(countExact(value, before), 1, label);
    return value.replace(before, after);
  };
  const removeRangeExactly = (value, start, end, label) => {
    assert.equal(countExact(value, start), 1, `${label} start`);
    assert.equal(countExact(value, end), 1, `${label} end`);
    const startIndex = value.indexOf(start);
    const endIndex = value.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${value.slice(0, startIndex)}${value.slice(endIndex)}`;
  };

  let reconstructed = removeRangeExactly(
    source,
    "\n\nfunction reconstructPreS7V5ManagerEvaluatorSource(source) {\n",
    "\n\nfunction reconstructPreS7V4ManagerEvaluatorSource(source) {\n",
    "S7 V5 manager inverse helper",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "  await assertArtifactPin(ADR_URL, {",
      "    byteLength: 221438,",
      "    lineFeeds: 3713,",
      '    sha256: "bd3e1f703e25c255d30b0e171c5c8b7bd958e1ce2d6bbe08a2b3a8ee6f1dd377",',
      '    gitBlob: "d3b32ea45c3d44913c8931024b53404e511f5bec",',
    ].join("\n"),
    [
      "  await assertArtifactPin(ADR_URL, {",
      "    byteLength: 221438,",
      "    lineFeeds: 3713,",
      '    sha256: "4836b92bbbb87af2cb1e51b6ca24d436c82c92f03032e9fbcaf1b093d3922fd0",',
      '    gitBlob: "5b876789f86d8bb394bc1d4dc51b972c17850e80",',
    ].join("\n"),
    "S7 V5 manager ADR pin inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "  await assertArtifactPin(STATEFS_EVALUATOR_URL, {",
      "    byteLength: 401433,",
      "    lineFeeds: 11709,",
      '    sha256: "1a9e3e102139a1462454146d57de57439fa845b360790c5dfaf945fd717f5d1b",',
      '    gitBlob: "dcba8881b2ccc625befd26e998d0292ac00c5f97",',
    ].join("\n"),
    [
      "  await assertArtifactPin(STATEFS_EVALUATOR_URL, {",
      "    byteLength: 396556,",
      "    lineFeeds: 11574,",
      '    sha256: "860fc5de84cabb913ab7835d04c5e1cbe17cbe8792615ce38d741fc7692bcea1",',
      '    gitBlob: "d8f14f567d10c5e2a5176343540cef65c93d38ff",',
    ].join("\n"),
    "S7 V5 manager StateFS evaluator pin inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "function reconstructPreS7V4ManagerEvaluatorSource(source) {",
      "  source = reconstructPreS7V5ManagerEvaluatorSource(source);",
      "  const countExact = (value, needle) => {",
    ].join("\n"),
    [
      "function reconstructPreS7V4ManagerEvaluatorSource(source) {",
      "  const countExact = (value, needle) => {",
    ].join("\n"),
    "S7 V5 manager older inverse forwarding",
  );
  reconstructed = removeRangeExactly(
    reconstructed,
    [
      "\n  const v5Source =",
      "    reconstructPreS7V5ManagerEvaluatorSource(currentSource);",
    ].join("\n"),
    [
      "\n  const reconstructedSource =",
      "    reconstructPreS7V4ManagerEvaluatorSource(currentSource);",
    ].join("\n"),
    "S7 V5 manager direct inverse proof",
  );
  return reconstructed;
}

function reconstructPreS7V4ManagerEvaluatorSource(source) {
  source = reconstructPreS7V5ManagerEvaluatorSource(source);
  const countExact = (value, needle) => {
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = value.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactly = (value, before, after, label) => {
    assert.equal(countExact(value, before), 1, label);
    return value.replace(before, after);
  };
  const removeRangeExactly = (value, start, end, label) => {
    assert.equal(countExact(value, start), 1, `${label} start`);
    assert.equal(countExact(value, end), 1, `${label} end`);
    const startIndex = value.indexOf(start);
    const endIndex = value.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${value.slice(0, startIndex)}${value.slice(endIndex)}`;
  };

  let reconstructed = removeRangeExactly(
    source,
    "\n\nfunction reconstructPreS7V4ManagerEvaluatorSource(source) {\n",
    "\n\nfunction reconstructPreS7ManagerEvaluatorSource(source) {\n",
    "S7 V4 manager inverse helper",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "  await assertArtifactPin(ADR_URL, {",
      "    byteLength: 221438,",
      "    lineFeeds: 3713,",
      '    sha256: "4836b92bbbb87af2cb1e51b6ca24d436c82c92f03032e9fbcaf1b093d3922fd0",',
      '    gitBlob: "5b876789f86d8bb394bc1d4dc51b972c17850e80",',
    ].join("\n"),
    [
      "  await assertArtifactPin(ADR_URL, {",
      "    byteLength: 221172,",
      "    lineFeeds: 3709,",
      '    sha256: "1e132ff0b6779fbaeb98da50485fd877686d7e2a7222134dc69e107dce166800",',
      '    gitBlob: "426ea53752ad09533d85f27231f4f251cc99c0fa",',
    ].join("\n"),
    "S7 V4 manager ADR pin inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "  await assertArtifactPin(STATEFS_EVALUATOR_URL, {",
      "    byteLength: 396556,",
      "    lineFeeds: 11574,",
      '    sha256: "860fc5de84cabb913ab7835d04c5e1cbe17cbe8792615ce38d741fc7692bcea1",',
      '    gitBlob: "d8f14f567d10c5e2a5176343540cef65c93d38ff",',
    ].join("\n"),
    [
      "  await assertArtifactPin(STATEFS_EVALUATOR_URL, {",
      "    byteLength: 391542,",
      "    lineFeeds: 11439,",
      '    sha256: "9205a95e78138a2f8e3b1630e5fa830c6aa862496b54404423ab53ea6ab33ead",',
      '    gitBlob: "2f8222fb0db1f9c49ccfcb5b470d4f02592229ad",',
    ].join("\n"),
    "S7 V4 manager StateFS evaluator pin inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "function reconstructPreS7ManagerEvaluatorSource(source) {",
      "  source = reconstructPreS7V4ManagerEvaluatorSource(source);",
      "  const countExact = (value, needle) => {",
    ].join("\n"),
    [
      "function reconstructPreS7ManagerEvaluatorSource(source) {",
      "  const countExact = (value, needle) => {",
    ].join("\n"),
    "S7 V4 manager older inverse forwarding",
  );
  return removeRangeExactly(
    reconstructed,
    '\n\ntest("S7 V4 stale-task correction inversely reconstructs the exact S7 V3 manager evaluator", async () => {\n',
    '\n\ntest("S7 ADR evidence re-pin inversely reconstructs the exact pre-closure manager evaluator", async () => {\n',
    "S7 V4 manager inverse proof",
  );
}

function reconstructPreS7ManagerEvaluatorSource(source) {
  source = reconstructPreS7V4ManagerEvaluatorSource(source);
  const countExact = (value, needle) => {
    assert.notEqual(needle.length, 0);
    let count = 0;
    let offset = 0;
    while (true) {
      const index = value.indexOf(needle, offset);
      if (index === -1) return count;
      count += 1;
      offset = index + needle.length;
    }
  };
  const replaceExactly = (value, before, after, label) => {
    assert.equal(countExact(value, before), 1, label);
    return value.replace(before, after);
  };
  const removeRangeExactly = (value, start, end, label) => {
    assert.equal(countExact(value, start), 1, `${label} start`);
    assert.equal(countExact(value, end), 1, `${label} end`);
    const startIndex = value.indexOf(start);
    const endIndex = value.indexOf(end, startIndex + start.length);
    assert.equal(endIndex > startIndex, true, `${label} order`);
    return `${value.slice(0, startIndex)}${value.slice(endIndex)}`;
  };

  let reconstructed = removeRangeExactly(
    source,
    "\n\nfunction reconstructPreS7ManagerEvaluatorSource(source) {\n",
    '\n\ntest("first creation pins the exact base tree and proves both manager paths absent", async () => {\n',
    "S7 manager inverse helper",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "  await assertArtifactPin(ADR_URL, {",
      "    byteLength: 221172,",
      "    lineFeeds: 3709,",
      '    sha256: "1e132ff0b6779fbaeb98da50485fd877686d7e2a7222134dc69e107dce166800",',
      '    gitBlob: "426ea53752ad09533d85f27231f4f251cc99c0fa",',
    ].join("\n"),
    [
      "  await assertArtifactPin(ADR_URL, {",
      "    byteLength: 216688,",
      "    lineFeeds: 3638,",
      '    sha256: "6af1f5a4ff8357f83266d303d258fcde56ff6e581f91e01ca03e530b9173e4ce",',
      '    gitBlob: "49b0467887646ee05126a593d28e78bebff6f78f",',
    ].join("\n"),
    "S7 manager ADR pin inverse",
  );
  reconstructed = replaceExactly(
    reconstructed,
    [
      "  await assertArtifactPin(STATEFS_EVALUATOR_URL, {",
      "    byteLength: 391542,",
      "    lineFeeds: 11439,",
      '    sha256: "9205a95e78138a2f8e3b1630e5fa830c6aa862496b54404423ab53ea6ab33ead",',
      '    gitBlob: "2f8222fb0db1f9c49ccfcb5b470d4f02592229ad",',
    ].join("\n"),
    [
      "  await assertArtifactPin(STATEFS_EVALUATOR_URL, {",
      "    byteLength: 386695,",
      "    lineFeeds: 11305,",
      '    sha256: "7b79d1ab3c28289a2db9a262552c44c3e866e087b408e37d1898365d27b91651",',
      '    gitBlob: "fc45c3975f6c4901bd89ba362a0816b51efb61be",',
    ].join("\n"),
    "S7 manager StateFS evaluator pin inverse",
  );
  return removeRangeExactly(
    reconstructed,
    '\n\ntest("S7 ADR evidence re-pin inversely reconstructs the exact pre-closure manager evaluator", async () => {\n',
    '\n\ntest("literal manager requirements oracle is ordered, recursively frozen, and internally closed", () => {\n',
    "S7 manager inverse proof",
  );
}

test("first creation pins the exact base tree and proves both manager paths absent", async () => {
  assert.equal(
    git("rev-parse", `${AUTHORING_BASE}^{tree}`).trim(),
    AUTHORING_BASE_TREE,
  );
  for (const path of [SOURCE_REPOSITORY_PATH, EVALUATOR_REPOSITORY_PATH]) {
    assert.equal(
      git("ls-tree", "-r", "--name-only", AUTHORING_BASE_TREE, "--", path),
      "",
      path,
    );
  }
});

test("pins the amended ADR, public StateFS evaluator, exact helper, and predecessor requirements", async () => {
  await assertArtifactPin(ADR_URL, {
    byteLength: 221438,
    lineFeeds: 3713,
    sha256: "bd3e1f703e25c255d30b0e171c5c8b7bd958e1ce2d6bbe08a2b3a8ee6f1dd377",
    gitBlob: "d3b32ea45c3d44913c8931024b53404e511f5bec",
  });
  await assertArtifactPin(STATEFS_EVALUATOR_URL, {
    byteLength: 401433,
    lineFeeds: 11709,
    sha256: "1a9e3e102139a1462454146d57de57439fa845b360790c5dfaf945fd717f5d1b",
    gitBlob: "dcba8881b2ccc625befd26e998d0292ac00c5f97",
  });
  assert.equal(
    gitBlobSha1(await readFile(EXACT_V2_URL)),
    "8e59aae2ec200652ffa848c9d1a8ab31a2280c29",
  );
  assert.equal(
    semanticSha256(
      statefs.CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS,
    ),
    PREDECESSORS[0][1],
  );
  assert.equal(
    journal.CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V2,
    PREDECESSORS[2][1],
  );
  assert.equal(
    lifetime.CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1,
    PREDECESSORS[3][1],
  );
  assert.equal(
    recovery.CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
    PREDECESSORS[4][1],
  );
  assert.equal(
    semanticSha256(
      control.CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS,
    ),
    PREDECESSORS[5][1],
  );
});

test("S7 V4 stale-task correction inversely reconstructs the exact S7 V3 manager evaluator", async () => {
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const v5Source =
    reconstructPreS7V5ManagerEvaluatorSource(currentSource);
  const v5Bytes = Buffer.from(v5Source, "utf8");
  assert.equal(v5Bytes.length, 280616);
  assert.equal(v5Source.split("\n").length - 1, 8809);
  assert.equal(
    byteSha256(v5Bytes),
    "c295973a7af70e5ab58411313bc243236cd4ce6ac0fc32af02922f60222a162e",
  );
  assert.equal(
    gitBlobSha1(v5Bytes),
    "118c3083353e6e2f1a49d3dd049212a0e785e2c0",
  );
  assert.equal([...v5Source.matchAll(/(?:^|\n)test\(/gu)].length, 16);
  assert.equal(
    [...v5Source.matchAll(/(?:^|\n)candidateTest\(/gu)].length,
    28,
  );
  const reconstructedSource =
    reconstructPreS7V4ManagerEvaluatorSource(currentSource);
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 276171);
  assert.equal(reconstructedSource.split("\n").length - 1, 8693);
  assert.equal(
    byteSha256(reconstructedBytes),
    "4bae8ec1b858f1813d410b625642031c0f00abfc552b542c371a497518dfef7c",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "6e445228de06f6e78b1701e4ff261452d3dd7bf7",
  );
  assert.equal(
    [...reconstructedSource.matchAll(/(?:^|\n)test\(/gu)].length,
    15,
  );
  assert.equal(
    [...reconstructedSource.matchAll(/(?:^|\n)candidateTest\(/gu)].length,
    28,
  );
});

test("S7 ADR evidence re-pin inversely reconstructs the exact pre-closure manager evaluator", async () => {
  const currentBytes = await readFile(EVALUATOR_PATH);
  const currentSource = currentBytes.toString("utf8");
  assert.equal(Buffer.from(currentSource, "utf8").equals(currentBytes), true);
  const reconstructedSource = reconstructPreS7ManagerEvaluatorSource(currentSource);
  const reconstructedBytes = Buffer.from(reconstructedSource, "utf8");
  assert.equal(reconstructedBytes.length, 272226);
  assert.equal(reconstructedSource.split("\n").length - 1, 8592);
  assert.equal(
    byteSha256(reconstructedBytes),
    "9e5acee6695f6ce63acbb29040504794b38b530421e9e60298653187fc9f7620",
  );
  assert.equal(
    gitBlobSha1(reconstructedBytes),
    "6936436f74cdd11cc512eff4055ca24bb5e130a5",
  );
  assert.equal(
    [...reconstructedSource.matchAll(/(?:^|\n)test\(/gu)].length,
    14,
  );
  assert.equal(
    [...reconstructedSource.matchAll(/(?:^|\n)candidateTest\(/gu)].length,
    28,
  );
});

test("literal manager requirements oracle is ordered, recursively frozen, and internally closed", () => {
  const exactCounts = new Map([
    [TOP_LEVEL_FIELDS, 28],
    [PREDECESSORS, 6],
    [IMPORT_INVENTORY, 3],
    [SCHEMAS, 7],
    [LIMITS, 7],
    [EPOCH_FIELDS, 7],
    [STATE_FIELDS, 32],
    [INPUT_ARGUMENT_FIELDS, 8],
    [INPUT_FIELDS, 17],
    [TRANSITION_FIELDS, 13],
    [HANDOFF_PLAN_FIELDS, 14],
    [RECOVERY_REQUEST_ARTIFACT_FIELDS, 12],
    [TRANSITION_RULE_FIELDS, 4],
    [CRASH_PREFIX_RULE_FIELDS, 3],
    [INPUT_KINDS, 4],
    [STATUSES, 10],
    [WRITER_KINDS, 3],
    [ACTOR_KINDS, 2],
    [GUARDIAN_ACTIONS, 3],
    [STATEFS_OUTCOMES, 17],
    [ERROR_PRECEDENCE, 7],
    [ORDERING_RULES, 9],
    [NONCLAIMS, 20],
    [TRANSITION_TABLE, 25],
    [CRASH_PREFIX_TABLE, 15],
  ]);
  for (const [value, count] of exactCounts) assert.equal(value.length, count);
  assertExactFields(EXPECTED_REQUIREMENTS, TOP_LEVEL_FIELDS, "requirements");
  assert.deepEqual(
    IMPORT_INVENTORY.map(([, names]) => names.length),
    [14, 3, 3],
  );
  assert.equal(IMPORT_INVENTORY.flatMap(([, names]) => names).length, 20);
  assert.equal(
    IMPORT_INVENTORY.flatMap(([, names]) => names).includes(
      "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256",
    ),
    false,
  );
  assert.equal(
    semanticSha256(EXPECTED_REQUIREMENTS),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assertNullFrozenTree(EXPECTED_REQUIREMENTS, "requirements");
  assert.deepEqual(Object.values(AUTHORITY), Array(10).fill(false));
  assert.deepEqual(Object.values(PHYSICAL_FACTS), Array(12).fill(null));
});

test("T01-T25 and C01-C15 preserve exact pinned Markdown cell bytes and padding", async () => {
  const adr = await readFile(ADR_URL, "utf8");
  const transitionCells = parsePinnedAdrTable(
    adr,
    "| Current status / retained operation",
    [92, 222, 223],
  );
  const crashCells = parsePinnedAdrTable(
    adr,
    "| Last complete durable/observed prefix",
    [70, 215],
  );
  assert.deepEqual(transitionCells, TRANSITION_CELL_TEXT);
  assert.deepEqual(crashCells, CRASH_PREFIX_CELL_TEXT);
  const transitionReviewerBytes = Buffer.from(
    JSON.stringify(
      transitionCells.map((cells, index) => [TRANSITION_IDS[index], ...cells]),
    ),
    "utf8",
  );
  const crashReviewerBytes = Buffer.from(
    JSON.stringify(
      crashCells.map((cells, index) => [CRASH_PREFIX_IDS[index], ...cells]),
    ),
    "utf8",
  );
  assert.equal(transitionReviewerBytes.length, 13_851);
  assert.equal(
    byteSha256(transitionReviewerBytes),
    "d55a3bfc0a9637851fd44b558cc756d68eca986f4bce065d4e1f62e85608b167",
  );
  assert.equal(crashReviewerBytes.length, 4_486);
  assert.equal(
    byteSha256(crashReviewerBytes),
    "897270abb73cf53ea74e92f5a60ec1ad4cb5ce806f8fd2c96fd78183edbc5056",
  );
  assert.deepEqual(
    TRANSITION_TABLE.map(({ id }) => id),
    TRANSITION_IDS,
  );
  assert.deepEqual(
    CRASH_PREFIX_TABLE.map(({ id }) => id),
    CRASH_PREFIX_IDS,
  );
  for (const row of TRANSITION_TABLE) {
    assertExactFields(row, TRANSITION_RULE_FIELDS, row.id);
  }
  for (const row of CRASH_PREFIX_TABLE) {
    assertExactFields(row, CRASH_PREFIX_RULE_FIELDS, row.id);
  }
});

test("the ten-status by four-input product is total and defaults every unlisted pair", () => {
  assert.equal(STATUS_INPUT_PRODUCT.length, 40);
  assert.equal(STATUS_INPUT_PRODUCT.filter(({ listed }) => listed).length, 7);
  assert.equal(STATUS_INPUT_PRODUCT.filter(({ listed }) => !listed).length, 33);
  assert.deepEqual(
    STATUS_INPUT_PRODUCT.filter(({ listed }) => !listed).map(
      ({ defaultResult }) => defaultResult,
    ),
    Array(33).fill("MANAGER_TRANSITION"),
  );
  for (const status of [
    "LOCK_CONTENDED",
    "INVENTORY_BLOCKED",
    "EFFECT_UNCERTAIN",
    "TERMINAL",
  ]) {
    assert.deepEqual(
      STATUS_INPUT_PRODUCT.filter((entry) => entry.status === status).map(
        ({ defaultResult }) => defaultResult,
      ),
      Array(4).fill("MANAGER_TRANSITION"),
    );
  }
});

test("the finite transition oracle covers every positive row and classifies every adjacent predicate change", () => {
  assert.deepEqual(
    POSITIVE_TRANSITION_CASES.map(({ id }) => id),
    TRANSITION_IDS,
  );
  assert.deepEqual(
    TRANSITION_NEAR_MISSES.map(({ id }) => id),
    TRANSITION_IDS,
  );
  assert.equal(
    new Set(
      POSITIVE_TRANSITION_CASES.map(({ status, kind }) => `${status}\0${kind}`),
    ).size,
    7,
  );
  for (const witness of POSITIVE_TRANSITION_CASES) {
    assert.equal(
      LISTED_STATUS_KIND_PAIRS.has(`${witness.status}\0${witness.kind}`),
      true,
    );
    const row = TRANSITION_TABLE[Number(witness.id.slice(1)) - 1];
    assert.equal(row.id, witness.id);
    assert.equal(
      `${row.currentStatusOrOperation}\n${row.inputPredicate}\n${row.result}`.includes(
        witness.predicate,
      ),
      true,
      `${witness.id} ${witness.predicate}`,
    );
  }
  assert.equal(
    new Set(
      TRANSITION_NEAR_MISSES.map(({ id, mutation }) => `${id}\0${mutation}`),
    ).size,
    25,
  );
  assert.deepEqual(
    TRANSITION_NEAR_MISSES.filter(
      ({ classification }) => classification === "VALID_ALTERNATE",
    ).map(({ id, result }) => `${id}->${result}`),
    [
      "T02->T03",
      "T03->T02",
      "T04->T05",
      "T05->T04",
      "T06->T07",
      "T07->T06",
      "T09->T10",
      "T10->T09",
      "T11->T13",
      "T12->T06",
      "T13->T14",
      "T14->T15",
      "T15->T16",
      "T16->T13",
      "T17->T18",
      "T18->T20",
      "T20->T18",
      "T25->T24",
    ],
  );
  assert.deepEqual(
    TRANSITION_NEAR_MISSES.filter(
      ({ classification }) => classification === "EARLIER_ERROR",
    ).map(({ id, result }) => `${id}->${result}`),
    [
      "T01->MANAGER_BINDING",
      "T08->MANAGER_PREDECESSOR",
      "T19->MANAGER_PREDECESSOR",
      "T21->MANAGER_PREDECESSOR",
      "T22->MANAGER_BINDING",
      "T23->MANAGER_BINDING",
      "T24->MANAGER_BINDING",
    ],
  );
});

test("crash-prefix coverage distinguishes representable manager inputs from owner-runtime observations", () => {
  assert.deepEqual(
    CRASH_PREFIX_RUNTIME_COVERAGE.map(([id]) => id),
    CRASH_PREFIX_IDS,
  );
  assert.deepEqual(
    CRASH_PREFIX_RUNTIME_COVERAGE.filter(
      ([, witness]) => witness === "OWNER_RUNTIME_ONLY",
    ).map(([id]) => id),
    ["C09", "C10", "C11", "C12", "C13"],
  );
  assert.equal(INPUT_KINDS.includes("CRASH"), false);
  assert.equal(
    CRASH_PREFIX_RUNTIME_COVERAGE.filter(([, witness]) =>
      witness.startsWith("T"),
    ).length,
    9,
  );
});

test("literal rows freeze writer separation, state 18, anchored-empty, handles, wire prefixes, and terminal retry", () => {
  const transitionText = TRANSITION_TABLE.flatMap((row) =>
    Object.values(row),
  ).join("\n");
  const crashText = CRASH_PREFIX_TABLE.flatMap((row) =>
    Object.values(row),
  ).join("\n");
  for (const token of [
    "RECOVERY_CONTROL_HANDOFF",
    "NORMAL_READY",
    "RECOVERY_REQUEST_ACCEPTED",
    "CONTROL_TERMINAL",
    "EFFECT_UNCERTAIN",
    "REPLAN_AFTER_FRESH_INVENTORY",
  ]) {
    assert.equal(transitionText.includes(token), true, token);
  }
  assert.deepEqual(WRITER_KINDS, [
    "SERVICE_MANAGER",
    "LIVE_BIRTH_GUARDIAN",
    "RECOVERY_ONLY_GUARDIAN",
  ]);
  assert.deepEqual(ACTOR_KINDS, [
    "LIVE_BIRTH_GUARDIAN",
    "RECOVERY_ONLY_GUARDIAN",
  ]);
  assert.equal(crashText.includes("state 18"), true);
  assert.equal(crashText.includes("no recovery actor"), true);
  assert.equal(crashText.includes("anchored-empty"), true);
  assert.equal(crashText.includes("`ABSENT` or `PRESENT_EMPTY`"), true);
  assert.equal(crashText.includes("no second move"), true);
  assert.equal(crashText.includes("does not reacquire"), true);
  assert.equal(NONCLAIMS.includes("post-acquisition-lock-continuity"), true);
  assert.deepEqual(ORDERING_RULES.slice(-3), [
    "transition-one-shot-dispatch/v1",
    "crash-prefix-no-retry/v1",
    "terminal-consumes-state/v1",
  ]);
});

test("missing-module attribution accepts only the exact manager source failure", () => {
  const exact = {
    code: "ERR_MODULE_NOT_FOUND",
    url: SOURCE_URL.href,
    message: `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`,
  };
  assert.equal(exactMissingCandidateError(exact), true);
  assert.equal(exactMissingCandidateError({ ...exact, code: "ENOENT" }), false);
  assert.equal(
    exactMissingCandidateError({ ...exact, url: `${exact.url}.other` }),
    false,
  );
  assert.equal(
    exactMissingCandidateError({ ...exact, message: `${exact.message}.other` }),
    false,
  );
  const { url: _url, ...nodeTwentyShape } = exact;
  assert.equal(exactMissingCandidateError(nodeTwentyShape), true);
  assert.equal(
    exactMissingCandidateError({
      ...nodeTwentyShape,
      message: `${nodeTwentyShape.message}.other`,
    }),
    false,
  );
});

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

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function assertManagerSourceContract(source) {
  assert.equal(typeof source, "string");
  auditCandidateSource(source);
  for (const name of EXPECTED_EXPORTS) {
    assert.match(
      source,
      new RegExp(`\\bexport\\s+(?:const|function)\\s+${name}\\b`, "u"),
      name,
    );
  }
  for (const name of [
    "assertCandidateContainmentGuardianStatefsPlanV1",
    "assertCandidateContainmentGuardianStatefsReceiptV1",
    "createCandidateContainmentGuardianRecoveryRequestInputV1",
    "verifyCandidateContainmentGuardianStatusFrameV1",
  ]) {
    assert.equal(
      countMatches(source, new RegExp(`\\b${name}\\s*\\(`, "gu")) >= 1,
      true,
      `${name} call`,
    );
  }
  assert.equal(
    countMatches(source, /\bnew\s+WeakMap\s*\(/gu) >= 4,
    true,
    "private same-origin WeakMaps",
  );
  for (const code of ERROR_PRECEDENCE) {
    assert.equal(source.includes(JSON.stringify(code)), true, code);
  }
  for (const forbidden of [
    "containment-guardian-journal-v2.mjs",
    "containment-guardian-lifetime-v1.mjs",
    "containment-guardian-recovery-v1.mjs",
    "containment-guardian-statefs-syscalls",
    "planCandidateContainmentGuardianStatefsOperationV1",
    "assertCandidateContainmentGuardianStatefsRequestV1",
    "verifyCandidateContainmentGuardianStatefsResultV1",
    "node:fs",
    "node:child_process",
    "node:net",
    "node:http",
    "node:https",
    "node:worker_threads",
    "OpenRouter",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.doesNotMatch(
    source,
    /\b(?:process\s*\.|fetch\s*\(|new\s+WebSocket\s*\(|setTimeout\s*\(|setInterval\s*\(|Date\.now\s*\(|Math\.random\s*\()/u,
  );
}

function sourceContractFixture() {
  const imports = IMPORT_INVENTORY.map(
    ([specifier, names]) =>
      `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`,
  ).join("\n");
  const exports = EXPECTED_EXPORTS.map((name, index) =>
    index < 2 ? `export const ${name} = null;` : `export function ${name}() {}`,
  ).join("\n");
  const calls = [
    "assertCandidateContainmentGuardianStatefsPlanV1(value);",
    "assertCandidateContainmentGuardianStatefsReceiptV1(value);",
    "createCandidateContainmentGuardianRecoveryRequestInputV1(value);",
    "verifyCandidateContainmentGuardianStatusFrameV1(value);",
  ].join("\n");
  return [
    imports,
    "const one = new WeakMap();",
    "const two = new WeakMap();",
    "const three = new WeakMap();",
    "const four = new WeakMap();",
    ...ERROR_PRECEDENCE.map(
      (code) => `const error_${code} = ${JSON.stringify(code)};`,
    ),
    exports,
    "function consume(value) {",
    calls,
    "}",
  ].join("\n");
}

function exactMissingCandidateSourceReadError(error) {
  return (
    error !== null &&
    typeof error === "object" &&
    error.code === "ENOENT" &&
    error.syscall === "open" &&
    error.path === SOURCE_PATH
  );
}

function auditCandidateSourceBytes(bytes) {
  assert.equal(Buffer.isBuffer(bytes), true, "candidate source is a Buffer");
  const retainedBytes = Buffer.from(bytes);
  const source = retainedBytes.toString("utf8");
  assert.equal(
    Buffer.from(source, "utf8").equals(retainedBytes),
    true,
    "candidate source is exact UTF-8",
  );
  assert.equal(retainedBytes.includes(0x0d), false, "candidate source has no CR");
  assert.equal(retainedBytes.at(-1), 0x0a, "candidate source has final LF");
  assertManagerSourceContract(source);
  return Object.freeze({
    present: true,
    bytes: retainedBytes,
    source,
    sha256: byteSha256(retainedBytes),
  });
}

async function loadAuditedCandidate({
  readSource,
  importSource,
  onAudit = () => {},
  events = [],
}) {
  let audit;
  try {
    const bytes = await readSource();
    events.push("SOURCE_READ");
    audit = auditCandidateSourceBytes(bytes);
    events.push("SOURCE_AUDITED");
  } catch (error) {
    if (!exactMissingCandidateSourceReadError(error)) throw error;
    audit = Object.freeze({
      present: false,
      bytes: null,
      source: null,
      sha256: null,
    });
    events.push("SOURCE_ABSENT");
  }
  onAudit(audit);
  events.push("IMPORT_ATTEMPT");
  const namespace = await importSource();
  events.push("IMPORT_COMPLETE");
  return namespace;
}

test("source oracle rejects import, predecessor, ambient-effect, export, call, and brand mutants", () => {
  const valid = sourceContractFixture();
  assert.doesNotThrow(() => assertManagerSourceContract(valid));
  for (const mutation of [
    valid.replace("sha256, ", ""),
    valid.replace(
      "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS, ",
      "CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256, ",
    ),
    valid.replace("import { sha256, ", "import unexpectedDefault, { sha256, "),
    valid.replace(
      "import { sha256, ",
      'import * as unexpectedNamespace from "./containment-exact-v2.mjs";\nimport { sha256, ',
    ),
    `import "./containment-exact-v2.mjs";\n${valid}`,
    `${valid}\nimport {} from "./containment-guardian-recovery-v1.mjs";`,
    `${valid}\nimport("./other.mjs");`,
    `${valid}\nexport default null;`,
    valid.replace("const four = new WeakMap();", "const four = null;"),
    valid.replace(
      "assertCandidateContainmentGuardianStatefsPlanV1(value);",
      "void value;",
    ),
    `${valid}\nprocess.cwd();`,
    `${valid}\nglobalThis.managerProtocolEscape = true;`,
    valid.replace(
      "function consume(value) {",
      "function consume(value) { globalThis.managerProtocolEscape = true;",
    ),
  ]) {
    assert.throws(() => assertManagerSourceContract(mutation));
  }
});

test("closed source audit is a mandatory pre-import gate for hostile top-level effects", async () => {
  const validBytes = Buffer.from(`${sourceContractFixture()}\n`, "utf8");
  const validEvents = [];
  const sentinel = Object.freeze({ sentinel: true });
  let validImports = 0;
  let validAudit = null;
  const loaded = await loadAuditedCandidate({
    readSource: async () => Buffer.from(validBytes),
    importSource: async () => {
      validImports += 1;
      return sentinel;
    },
    onAudit: (audit) => {
      validAudit = audit;
    },
    events: validEvents,
  });
  assert.equal(loaded, sentinel);
  assert.equal(validImports, 1);
  assert.equal(validAudit.present, true);
  assert.equal(validAudit.bytes.equals(validBytes), true);
  assert.equal(validAudit.source, validBytes.toString("utf8"));
  assert.equal(validAudit.sha256, byteSha256(validBytes));
  assert.deepEqual(validEvents, [
    "SOURCE_READ",
    "SOURCE_AUDITED",
    "IMPORT_ATTEMPT",
    "IMPORT_COMPLETE",
  ]);

  const hostileBytes = Buffer.from(
    `${sourceContractFixture()}\nglobalThis.managerProtocolEscape = true;\n`,
    "utf8",
  );
  const hostileEvents = [];
  let hostileImports = 0;
  await assert.rejects(
    loadAuditedCandidate({
      readSource: async () => hostileBytes,
      importSource: async () => {
        hostileImports += 1;
        return sentinel;
      },
      events: hostileEvents,
    }),
  );
  assert.equal(hostileImports, 0, "hostile source never reaches import");
  assert.deepEqual(hostileEvents, ["SOURCE_READ"]);
});

let manager = null;
let managerImportError = null;
let managerImportAttempts = 0;
let managerSourceAudit = null;
const managerLoadEvents = [];
try {
  manager = await loadAuditedCandidate({
    readSource: () => readFile(SOURCE_URL),
    importSource: async () => {
      managerImportAttempts += 1;
      return import(SOURCE_URL.href);
    },
    onAudit: (audit) => {
      managerSourceAudit = audit;
    },
    events: managerLoadEvents,
  });
} catch (error) {
  if (!exactMissingCandidateError(error)) throw error;
  managerLoadEvents.push("IMPORT_MISSING");
  managerImportError = error;
}

function candidateTest(name, body) {
  test(
    name,
    { skip: manager === null ? "candidate manager source absent" : false },
    body,
  );
}

test("the live candidate load records audit completion before its sole import", () => {
  assert.equal(managerImportAttempts, 1);
  assert.notEqual(managerSourceAudit, null);
  if (manager === null) {
    assert.equal(managerSourceAudit.present, false);
    assert.deepEqual(managerLoadEvents, [
      "SOURCE_ABSENT",
      "IMPORT_ATTEMPT",
      "IMPORT_MISSING",
    ]);
  } else {
    assert.equal(managerSourceAudit.present, true);
    assert.deepEqual(managerLoadEvents, [
      "SOURCE_READ",
      "SOURCE_AUDITED",
      "IMPORT_ATTEMPT",
      "IMPORT_COMPLETE",
    ]);
  }
});

test("recovery replan and recovery-only handoff witnesses retain exact predecessor brands", () => {
  const makeOwner = (label) => {
    const root = heldStateRootObservation();
    const journalStack = ownerFixtures.createJournalStack(label, 5);
    const owner = createAdoptedOwner({
      label,
      root,
      managerActorEpochSha256: digest(`${label}:manager-actor`),
      journalStack,
    });
    return { owner, journalStack };
  };
  const replanFixture = makeOwner("independent-recovery-replan");
  const replan = buildRecoveryReplanTuple(
    replanFixture.owner,
    replanFixture.journalStack,
  );
  assert.equal(replan.recoveryPlan.status, "RECOVERY_ANCHOR_REQUIRED");
  assert.equal(replan.recoveryPlan.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");

  const handoffFixture = makeOwner("independent-recovery-handoff");
  const handoff = buildRecoveryHandoffTuple(
    handoffFixture.owner,
    handoffFixture.journalStack,
  );
  assert.equal(handoff.recoveryPlan.status, "RECOVERY_PLAN_READY");
  assert.equal(
    handoff.recoveryPlan.requiredActorKind,
    "RECOVERY_ONLY_GUARDIAN",
  );
  assert.equal(
    handoff.recoveryAttempt.recoveryActorEpochSha256,
    handoff.recoveryActorEpochSha256,
  );

  const anchoredFixture = makeOwner("independent-anchored-empty-replan");
  const anchored = buildAnchoredEmptyReplanTuple(
    anchoredFixture.owner,
    anchoredFixture.journalStack,
  );
  assert.equal(
    anchored.recoveryReplay.status,
    "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED",
  );
  assert.equal(
    anchored.anchoredEmptyAttempt.reportedAttemptDirectoryState,
    "ABSENT",
  );
  assert.equal(anchored.recoveryPlan.status, "RECOVERY_ANCHOR_REQUIRED");

  const state18Root = heldStateRootObservation();
  const state18Journal = ownerFixtures.createJournalStack(
    "independent-state18-close",
    18,
  );
  const state18Owner = createAdoptedOwner({
    label: "independent-state18-close",
    root: state18Root,
    managerActorEpochSha256: digest("independent-state18-close:manager-actor"),
    journalStack: state18Journal,
  });
  const state18 = buildState18CloseTuple(state18Owner, state18Journal);
  assert.equal(state18.recoveryPlan.status, "CLOSE_MOVE_REQUIRED");
  assert.equal(state18.recoveryPlan.requiredActorKind, null);
});

candidateTest(
  "source imports only the exact twenty-name manager surface and has no ambient effect",
  () => {
    assert.equal(managerSourceAudit.present, true);
    assert.equal(
      Buffer.from(managerSourceAudit.source, "utf8").equals(
        managerSourceAudit.bytes,
      ),
      true,
    );
    assert.equal(managerSourceAudit.bytes.includes(0x0d), false);
    assert.equal(managerSourceAudit.bytes.at(-1), 0x0a);
    assert.equal(
      managerSourceAudit.sha256,
      byteSha256(managerSourceAudit.bytes),
    );
    assertManagerSourceContract(managerSourceAudit.source);
  },
);

candidateTest("exports exactly the seven frozen manager identities", () => {
  assert.deepEqual(Object.keys(manager).sort(), [...EXPECTED_EXPORTS].sort());
  assert.equal(Object.hasOwn(manager, "default"), false);
  assert.equal(Object.getPrototypeOf(manager), null);
  assert.equal(Object.isExtensible(manager), false);
  for (const [name, arity] of EXPECTED_FUNCTION_ARITIES) {
    assert.equal(typeof manager[name], "function", name);
    assert.equal(manager[name].name, name);
    assert.equal(manager[name].length, arity);
  }
});

candidateTest(
  "exports the exact literal requirements value and its independently frozen digest",
  () => {
    assert.deepEqual(
      manager.CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS,
      EXPECTED_REQUIREMENTS,
    );
    assert.equal(
      manager.CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256,
      EXPECTED_REQUIREMENTS_SHA256,
    );
    assert.equal(
      semanticSha256(
        manager.CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS,
      ),
      EXPECTED_REQUIREMENTS_SHA256,
    );
    assertNullFrozenTree(
      manager.CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS,
      "candidate requirements",
    );
  },
);

const STATEFS_PLANNER_INPUT_FIELDS = fields(`
  kind managerActorEpochSha256 requestSequence inventorySetSha256 stateRootObservation
  currentInventorySet unresolvedReceipt generationManifest normalJournalBundles
  lifetimeReplayArguments recoveryTarget recoveryInventory recoveryReplay recoveryPlan
  recoveryAttempt recoveryRecord artifactBytes inventoryDirectoryRole directoryRoleA
  directoryRoleB nameA nameB expectedOutcome
`);
const STATEFS_NATIVE_OBSERVATION_FIELDS = fields(`
  kind role name deviceMajor deviceMinor inode mountId byteLength linkCount mode ownerUid
  ownerGid statxMask filesystemMagic contentOffset contentLength
`);
const STATEFS_EXECUTOR_RESULT_FIELDS = fields(`
  schema abiVersion requestSha256 operation status effectClass lastCompletedStep failedStep
  errno completedStepCount bytesConsumed observations outputBytes returnedDirectoryFd
`);

function assertClaims(value, label) {
  assert.deepEqual(value.authority, AUTHORITY, `${label}.authority`);
  assert.deepEqual(
    value.physicalFacts,
    PHYSICAL_FACTS,
    `${label}.physicalFacts`,
  );
  assert.deepEqual(value.nonclaims, NONCLAIMS, `${label}.nonclaims`);
}

function schemaLiteral(name) {
  const entry = SCHEMAS.find(([key]) => key === name);
  assert.notEqual(entry, undefined, `known schema ${name}`);
  return entry[1];
}

function digestFields(value, fieldNames) {
  return semanticSha256(
    record(...fieldNames.map((field) => [field, value[field]])),
  );
}

const MANAGER_INPUT_WITNESSES = new WeakMap();
const EXPECTED_ACTIVE_DIRECTORY_HANDLES = new WeakMap();
const EXPECTED_GUARDIAN_HANDOFF_PLANS = new WeakMap();

function assertManagerInputProjection(input, state, argument, label) {
  assertExactFields(input, INPUT_FIELDS, `${label} input`);
  assertNullFrozenTree(input, `${label} input`);
  assertExactFields(argument, INPUT_ARGUMENT_FIELDS, `${label} input argument`);
  const expected = {
    schema: schemaLiteral("input"),
    kind: argument.kind,
    boundStateSha256: state.stateSha256,
    statefsRequestSha256: null,
    statefsReceiptSha256: null,
    statefsPlanSha256: null,
    ownerContextSha256: null,
    lifetimeReplaySha256: null,
    guardianStartupSha256: null,
    guardianControlStateSha256: null,
    guardianRecoveryRequestFrameRawSha256: null,
    guardianRequestEofObserved: null,
    guardianStatusFrameRawSha256: null,
  };
  if (argument.kind === "STATEFS_PLAN") {
    const plan = argument.statefsPlan;
    assert.notEqual(plan, null, `${label} plan`);
    expected.statefsRequestSha256 =
      plan.request === null ? null : plan.request.requestSha256;
    expected.statefsPlanSha256 = plan.planSha256;
    expected.ownerContextSha256 = plan.ownerContext.ownerContextSha256;
    expected.lifetimeReplaySha256 =
      plan.ownerContext.lifetimeReplay === null
        ? null
        : semanticSha256(plan.ownerContext.lifetimeReplay);
  } else if (argument.kind === "STATEFS_RECEIPT") {
    const receipt = argument.statefsReceipt;
    assert.notEqual(receipt, null, `${label} receipt`);
    assert.equal(receipt.request.requestSha256, receipt.requestSha256);
    expected.statefsRequestSha256 = receipt.requestSha256;
    expected.statefsReceiptSha256 = receipt.receiptSha256;
  } else if (argument.kind === "RECOVERY_REQUEST_OBSERVED") {
    expected.guardianStartupSha256 =
      argument.guardianStartupProjection.startupReportSha256;
    expected.guardianControlStateSha256 =
      argument.guardianControlState.stateSha256;
    expected.guardianRecoveryRequestFrameRawSha256 = byteSha256(
      argument.guardianRecoveryRequestFrameBytes,
    );
    expected.guardianRequestEofObserved = true;
  } else if (argument.kind === "GUARDIAN_STATUS_FRAME") {
    expected.guardianStartupSha256 =
      argument.guardianStartupProjection.startupReportSha256;
    expected.guardianStatusFrameRawSha256 = byteSha256(
      argument.guardianStatusFrameBytes,
    );
  } else {
    assert.fail(`${label} unknown input kind`);
  }
  for (const field of INPUT_FIELDS.slice(0, INPUT_FIELDS.indexOf("inputSha256"))) {
    assert.equal(input[field], expected[field], `${label} input.${field}`);
  }
  assert.equal(
    input.inputSha256,
    digestFields(
      input,
      INPUT_FIELDS.slice(0, INPUT_FIELDS.indexOf("inputSha256")),
    ),
  );
  assertClaims(input, `${label} input`);
  MANAGER_INPUT_WITNESSES.set(
    input,
    Object.freeze({
      state,
      argument,
      plan: argument.statefsPlan,
      receipt: argument.statefsReceipt,
      startup: argument.guardianStartupProjection,
      controlState: argument.guardianControlState,
      recoveryRequestFrameBytes:
        argument.guardianRecoveryRequestFrameBytes === null
          ? null
          : Buffer.from(argument.guardianRecoveryRequestFrameBytes),
      statusFrameBytes:
        argument.guardianStatusFrameBytes === null
          ? null
          : Buffer.from(argument.guardianStatusFrameBytes),
    }),
  );
  return input;
}

function expectedRecoverySelection(statefsPlan, label) {
  const context = statefsPlan.ownerContext;
  for (const field of [
    "lifetimeReplay",
    "recoveryTarget",
    "recoveryInventory",
    "recoveryReplay",
    "recoveryPlan",
    "recoveryAttempt",
    "lifetimeAnchorProjection",
    "lifetimeAttemptAnchorRawSha256",
  ]) {
    assert.notEqual(context[field], null, `${label} ownerContext.${field}`);
  }
  const values = {
    schema: "oxigraph.candidate-containment-guardian-recovery-selection/v1",
    targetSha256: context.recoveryTarget.targetSha256,
    recoveryRequirementsSha256: PREDECESSORS[4][1],
    recoveryPlanSha256: semanticSha256(context.recoveryPlan),
    recoveryReplaySha256: semanticSha256(context.recoveryReplay),
    lifecycleInventorySha256: context.recoveryInventory.inventorySha256,
    attemptSha256: context.recoveryAttempt.attemptSha256,
    planStatus: context.recoveryPlan.status,
    requiredActorKind: context.recoveryPlan.requiredActorKind,
    actorKind: context.recoveryAttempt.actorKind,
    recoveryActorEpochSha256:
      context.recoveryAttempt.recoveryActorEpochSha256,
    attemptDirectoryName: context.recoveryAttempt.attemptDirectoryName,
    lifetimeAnchorProjectionSha256: semanticSha256(
      context.lifetimeAnchorProjection,
    ),
    lifetimeAttemptAnchorRawSha256:
      context.lifetimeAttemptAnchorRawSha256,
    disposition: context.recoveryPlan.disposition,
    quarantineReason: context.recoveryPlan.quarantineReason,
    sourceLocation: context.recoveryPlan.sourceLocation,
    decisionSourceLocation: context.recoveryPlan.decisionSourceLocation,
    requiredDestinationLocation:
      context.recoveryPlan.requiredDestinationLocation,
    stateCount: context.recoveryPlan.states.length,
  };
  assert.equal(context.recoveryPlan.requirementsSha256, PREDECESSORS[4][1]);
  for (let index = 0; index <= 18; index += 1) {
    values[`state${index}`] =
      index < context.recoveryPlan.states.length
        ? semanticSha256(context.recoveryPlan.states[index])
        : null;
  }
  return record(
    ...RECOVERY_SELECTION_FIELDS.map((field) => [field, values[field]]),
  );
}

function assertGuardianHandoffPlan(handoffPlan, statefsPlan, label) {
  assertExactFields(
    handoffPlan,
    HANDOFF_PLAN_FIELDS,
    `${label} handoff plan`,
  );
  assertNullFrozenTree(handoffPlan, `${label} handoff plan`);
  assert.equal(handoffPlan.schema, schemaLiteral("guardianHandoffPlan"));
  assert.equal(
    handoffPlan.managerActorEpochSha256,
    statefsPlan.managerActorEpochSha256,
    `${label} handoff manager epoch`,
  );
  assert.equal(
    handoffPlan.lifetimeEpochSha256,
    statefsPlan.ownerContext.lifetimeReplay.latestLifetimeEpochSha256,
    `${label} handoff lifetime epoch`,
  );
  assert.equal(
    handoffPlan.targetSha256,
    statefsPlan.targetSha256,
    `${label} handoff target`,
  );
  assert.equal(
    handoffPlan.action,
    statefsPlan.guardianAction,
    `${label} handoff action`,
  );
  if (handoffPlan.mode === "NORMAL") {
    assert.equal(statefsPlan.actorKind, "LIVE_BIRTH_GUARDIAN");
    assert.equal(handoffPlan.action, "NORMAL_CONTROL_HANDOFF");
    assert.equal(handoffPlan.targetSha256, null);
    assert.equal(handoffPlan.recoveryActorEpochSha256, null);
    assert.deepEqual(handoffPlan.descriptorRoles, [
      "controllerChannel",
      "statusWrite",
      "diagnosticsWrite",
      "stateRoot",
      "delegatedRoot",
      "guardianLifetimeCgroup",
      "epochRead",
      "supervisorExecutable",
    ]);
    assert.equal(handoffPlan.recoverySelection, null);
    assert.equal(handoffPlan.recoverySelectionSha256, null);
  } else {
    assert.equal(handoffPlan.mode, "RECOVERY_ONLY");
    assert.equal(statefsPlan.actorKind, "RECOVERY_ONLY_GUARDIAN");
    assert.equal(handoffPlan.action, "RECOVERY_CONTROL_HANDOFF");
    assert.equal(
      handoffPlan.recoveryActorEpochSha256,
      statefsPlan.ownerContext.recoveryAttempt.recoveryActorEpochSha256,
    );
    assert.deepEqual(handoffPlan.descriptorRoles, [
      "recoveryRequestRead",
      "statusWrite",
      "diagnosticsWrite",
      "stateRoot",
      "delegatedRoot",
      "recoveryActorLifetimeCgroup",
      "epochRead",
    ]);
    const selection = expectedRecoverySelection(statefsPlan, label);
    assertExactFields(
      handoffPlan.recoverySelection,
      RECOVERY_SELECTION_FIELDS,
      `${label} recovery selection`,
    );
    assert.deepEqual(handoffPlan.recoverySelection, selection);
    assert.equal(
      handoffPlan.recoverySelectionSha256,
      semanticSha256(selection),
    );
  }
  assert.equal(
    handoffPlan.planSha256,
    digestFields(
      handoffPlan,
      HANDOFF_PLAN_FIELDS.slice(0, HANDOFF_PLAN_FIELDS.indexOf("planSha256")),
    ),
  );
  assertClaims(handoffPlan, `${label} handoff plan`);
}

function assertRecoveryRequestArtifact(artifact, expected, label) {
  assertExactFields(
    artifact,
    RECOVERY_REQUEST_ARTIFACT_FIELDS,
    `${label} recovery artifact`,
  );
  assertNullFrozenTree(artifact, `${label} recovery artifact`);
  assert.equal(
    artifact.schema,
    schemaLiteral("guardianRecoveryRequestArtifact"),
  );
  assert.notEqual(expected.handoffPlan, null, `${label} retained handoff plan`);
  assert.equal(expected.handoffPlan.mode, "RECOVERY_ONLY");
  assert.equal(expected.startup.mode, "RECOVERY_ONLY");
  assert.equal(expected.startup.requirementsSha256, CONTROL_REQUIREMENTS_SHA256);
  assert.equal(
    expected.startup.epochSha256,
    expected.handoffPlan.recoveryActorEpochSha256,
  );
  assert.equal(expected.controlState.mode, "RECOVERY_ONLY");
  assert.equal(expected.controlState.phase, "WAITING_RECOVERY_REQUEST");
  assert.equal(
    expected.controlState.requirementsSha256,
    CONTROL_REQUIREMENTS_SHA256,
  );
  assert.equal(
    expected.controlState.startupSha256,
    expected.startup.startupReportSha256,
  );
  assert.equal(expected.controlState.epochSha256, expected.startup.epochSha256);
  assert.equal(expected.controlState.lastWireFrameSha256, ZERO_DIGEST);
  assert.equal(expected.controlState.nextWireSequence, 0);
  assert.equal(expected.controlState.aggregateWireBytes, 0);
  assert.equal(expected.controlState.admissionCount, 0);
  assert.equal(expected.controlState.eventCount, 0);
  assert.deepEqual(
    expected.frameBytes,
    recoveryRequestFrameBytes(
      { controlState: expected.controlState },
      expected.handoffPlan,
    ),
    `${label} independently constructed recovery frame`,
  );
  assert.equal(
    artifact.guardianHandoffPlanSha256,
    expected.handoffPlan.planSha256,
  );
  assert.equal(
    artifact.startupSha256,
    expected.startup.startupReportSha256,
  );
  assert.equal(artifact.controlStateSha256, expected.controlState.stateSha256);
  assert.equal(
    artifact.recoverySelectionSha256,
    expected.handoffPlan.recoverySelectionSha256,
  );
  assert.equal(
    artifact.recoveryRequestFrameRawSha256,
    byteSha256(expected.frameBytes),
  );
  assert.equal(
    artifact.artifactSha256,
    semanticSha256(
      record(
        ["schema", artifact.schema],
        [
          "guardianHandoffPlanSha256",
          expected.handoffPlan.planSha256,
        ],
        ["startupSha256", expected.startup.startupReportSha256],
        ["controlStateSha256", expected.controlState.stateSha256],
        [
          "recoverySelectionSha256",
          expected.handoffPlan.recoverySelectionSha256,
        ],
        [
          "recoveryRequestFrameRawSha256",
          byteSha256(expected.frameBytes),
        ],
      ),
    ),
  );
  assertClaims(artifact, `${label} recovery artifact`);

  const first = artifact.bytes;
  const second = artifact.bytes;
  assert.equal(Buffer.isBuffer(first), true);
  assert.equal(Buffer.isBuffer(second), true);
  assert.notEqual(first, second, `${label} copy-on-read identity`);
  assert.deepEqual(first, second, `${label} copy-on-read bytes`);
  assert.deepEqual(first, expected.frameBytes, `${label} observed frame bytes`);
  assert.equal(first.length > 0, true);
  assert.equal(artifact.controlInput.kind, "RECOVERY_REQUEST");
  assert.equal(
    artifact.controlInput.boundStateSha256,
    expected.controlState.stateSha256,
  );
  assert.equal(artifact.controlInput.frameByteLength, expected.frameBytes.length);
  assert.equal(
    artifact.controlInput.frameSha256,
    byteSha256(expected.frameBytes),
  );
  assert.equal(artifact.controlInput.auxiliaryByteLength, null);
  assert.equal(artifact.controlInput.auxiliarySha256, null);
  first[0] ^= 0xff;
  assert.deepEqual(
    artifact.bytes,
    second,
    `${label} caller mutation cannot alter retained bytes`,
  );
}

function epochBytes(label) {
  const bytes = Buffer.alloc(32);
  const seed = Buffer.from(label, "utf8");
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (seed[index % seed.length] + index + 1) & 0xff;
  }
  if (bytes.every((byte) => byte === 0)) bytes[0] = 1;
  return bytes;
}

function managerInputArgument(overrides = {}) {
  const values = {
    kind: "STATEFS_PLAN",
    statefsPlan: null,
    statefsReceipt: null,
    guardianStartupProjection: null,
    guardianControlState: null,
    guardianRecoveryRequestFrameBytes: null,
    guardianRequestEofObserved: null,
    guardianStatusFrameBytes: null,
    ...overrides,
  };
  return record(...INPUT_ARGUMENT_FIELDS.map((key) => [key, values[key]]));
}

function heldStateRootObservation() {
  const prefix = record(
    [
      "schema",
      "oxigraph.candidate-containment-guardian-statefs-held-directory-observation/v1",
    ],
    ["role", "STATE_ROOT"],
    ["accessMode", "O_RDONLY"],
    ["closeOnExec", false],
    ["fileType", "DIRECTORY"],
    ["ownerUid", 1000],
    ["ownerGid", 1000],
    ["mode", "0700"],
    ["linkCount", "2"],
    ["deviceMajor", "8"],
    ["deviceMinor", "1"],
    ["inode", "100"],
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

function statefsPlannerInput({ managerActorEpochSha256, requestSequence }) {
  const values = {
    kind: "LOCK_EX_NB",
    managerActorEpochSha256,
    requestSequence,
    inventorySetSha256: null,
    stateRootObservation: heldStateRootObservation(),
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
  };
  return record(
    ...STATEFS_PLANNER_INPUT_FIELDS.map((key) => [key, values[key]]),
  );
}

function nativeRootObservation() {
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
    statxMask: 0x17ff,
    filesystemMagic: "61267",
    contentOffset: 0,
    contentLength: 0,
  };
  return record(
    ...STATEFS_NATIVE_OBSERVATION_FIELDS.map((key) => [key, values[key]]),
  );
}

function lockExecutorResult(request, { contended = false } = {}) {
  const values = {
    schema:
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: contended ? "SYSCALL_FAILED" : "COMPLETE",
    effectClass: contended ? "DEFINITE_NO_EFFECT" : "COMPLETE",
    lastCompletedStep: contended ? "FD_A_VALIDATED" : "LOCK_ACQUIRED",
    failedStep: contended ? "LOCK_ACQUIRED" : "NONE",
    errno: contended ? 11 : 0,
    completedStepCount: contended ? 2 : 3,
    bytesConsumed: 0,
    observations: array(nativeRootObservation()),
    outputBytes: null,
    returnedDirectoryFd: -1,
  };
  return record(
    ...STATEFS_EXECUTOR_RESULT_FIELDS.map((key) => [key, values[key]]),
  );
}

function stateDigest(state) {
  return semanticSha256(
    record(
      ...STATE_FIELDS.filter((key) => key !== "stateSha256").map((key) => [
        key,
        state[key],
      ]),
    ),
  );
}

function transitionDigest(transition) {
  return semanticSha256(
    record(
      ["schema", transition.schema],
      ["previousStateSha256", transition.previousStateSha256],
      ["inputSha256", transition.inputSha256],
      ["stateSha256", transition.state.stateSha256],
      [
        "statefsPlanSha256",
        transition.statefsPlan === null
          ? null
          : transition.statefsPlan.planSha256,
      ],
      [
        "statefsRequestSha256",
        transition.statefsRequest === null
          ? null
          : transition.statefsRequest.requestSha256,
      ],
      [
        "guardianHandoffPlanSha256",
        transition.guardianHandoffPlan === null
          ? null
          : transition.guardianHandoffPlan.planSha256,
      ],
      [
        "guardianRecoveryRequestArtifactSha256",
        transition.guardianRecoveryRequestArtifact === null
          ? null
          : transition.guardianRecoveryRequestArtifact.artifactSha256,
      ],
      [
        "guardianStatusArtifactRawSha256",
        transition.guardianStatusArtifact === null
          ? null
          : transition.guardianStatusArtifact.rawSha256,
      ],
    ),
  );
}

function assertStateAndTransitionShape(transition, label) {
  assertExactFields(transition, TRANSITION_FIELDS, `${label} transition`);
  assertExactFields(transition.state, STATE_FIELDS, `${label} state`);
  assertNullFrozenTree(transition, `${label} transition`);
  assert.equal(transition.schema, schemaLiteral("transition"));
  assert.equal(transition.state.schema, schemaLiteral("state"));
  assert.equal(transition.state.stateSha256, stateDigest(transition.state));
  assert.equal(transition.transitionSha256, transitionDigest(transition));
  assertClaims(transition, `${label} transition`);
  assertClaims(transition.state, `${label} state`);
}

function assertActiveDirectoryHandles(state, expectedHandles, label) {
  assert.equal(expectedHandles.length <= 5, true, `${label} handle bound`);
  assert.equal(
    new Set(expectedHandles).size,
    expectedHandles.length,
    `${label} handles unique`,
  );
  assert.equal(
    state.activeDirectoryHandleCount,
    expectedHandles.length,
    `${label} handle count`,
  );
  const expectedSha256 =
    expectedHandles.length === 0
      ? null
      : semanticSha256(array(...expectedHandles));
  assert.equal(
    state.activeDirectoryHandlesSha256,
    expectedSha256,
    `${label} ordered root-to-leaf handle digest`,
  );
  if (expectedHandles.length === 1) {
    assert.match(
      state.activeDirectoryHandlesSha256,
      /^[0-9a-f]{64}$/u,
      `${label} singleton root digest is non-null`,
    );
  }
}

function activeDirectoryHandlesAfter(previousState, witness, transition, label) {
  const previous = EXPECTED_ACTIVE_DIRECTORY_HANDLES.get(previousState);
  assert.notEqual(previous, undefined, `${label} predecessor handle stack`);
  let expected = [...previous];
  if (witness.argument.kind === "STATEFS_RECEIPT") {
    const receipt = witness.receipt;
    const request = receipt.request;
    if (request.operation === "LOCK_EX_NB") {
      expected =
        receipt.outcome === "LOCK_HELD"
          ? [request.directoryHandleSha256A]
          : [];
    } else if (
      request.operation === "INVENTORY" &&
      request.inventoryKind === "DIRECTORY" &&
      request.inventoryDirectoryRole !== "STATE_ROOT" &&
      receipt.outcome === "INVENTORY_OBSERVED"
    ) {
      assert.equal(receipt.inventories.length, 1);
      expected.push(receipt.inventories[0].directoryHandleSha256);
    } else if (
      request.operation === "MKDIR_SYNC" &&
      receipt.outcome === "DIRECTORY_CREATED"
    ) {
      assert.equal(receipt.inventories.length, 2);
      expected.push(receipt.inventories[1].directoryHandleSha256);
    } else if (
      request.operation === "RELEASE_DIRECTORY" &&
      receipt.outcome === "DIRECTORY_RELEASED"
    ) {
      assert.equal(expected.length > 1, true, `${label} releasable child`);
      assert.equal(
        expected.at(-1),
        request.directoryHandleSha256A,
        `${label} release exact DFS top`,
      );
      expected.pop();
    }
  }
  if (
    transition.state.status === "LOCK_CONTENDED" ||
    expected.length === 0
  ) {
    expected = [];
  } else if (
    transition.state.terminal ||
    (transition.state.status === "INVENTORY_REQUIRED" &&
      transition.state.inventoryRequestCount === 0)
  ) {
    expected = [expected[0]];
  }
  return Object.freeze(expected);
}

function assertInitialStateAndTransition(transition, epoch, label) {
  assertStateAndTransitionShape(transition, label);
  assert.equal(transition.previousStateSha256, ZERO_DIGEST);
  assert.equal(transition.inputSha256, null);
  assert.equal(transition.state.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(transition.state.sequence, 0);
  assert.equal(transition.state.nextStatefsRequestSequence, 0);
  assert.equal(transition.state.previousStateSha256, ZERO_DIGEST);
  assert.equal(
    transition.state.managerActorEpochSha256,
    epoch.managerActorEpochSha256,
  );
  for (const field of [
    "statefsPlan",
    "statefsRequest",
    "guardianHandoffPlan",
    "guardianRecoveryRequestArtifact",
    "guardianStatusArtifact",
  ]) {
    assert.equal(transition[field], null, `${label}.${field}`);
  }
  assertActiveDirectoryHandles(transition.state, [], label);
  EXPECTED_ACTIVE_DIRECTORY_HANDLES.set(transition.state, Object.freeze([]));
  EXPECTED_GUARDIAN_HANDOFF_PLANS.set(transition.state, null);
}

function assertReducedStateAndTransition(
  transition,
  previousState,
  input,
  label,
) {
  assertStateAndTransitionShape(transition, label);
  const witness = MANAGER_INPUT_WITNESSES.get(input);
  assert.notEqual(witness, undefined, `${label} input witness`);
  assert.equal(witness.state, previousState, `${label} bound predecessor`);
  assert.equal(previousState.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(transition.previousStateSha256, previousState.stateSha256);
  assert.equal(transition.state.previousStateSha256, previousState.stateSha256);
  assert.equal(transition.inputSha256, input.inputSha256);
  assert.equal(transition.state.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(transition.state.sequence, previousState.sequence + 1);
  assert.equal(
    transition.state.managerActorEpochSha256,
    previousState.managerActorEpochSha256,
  );

  const acceptsRequest =
    witness.argument.kind === "STATEFS_PLAN" && witness.plan.request !== null;
  const expectedNextRequestSequence = acceptsRequest
    ? previousState.nextStatefsRequestSequence === 999_999
      ? null
      : previousState.nextStatefsRequestSequence + 1
    : previousState.nextStatefsRequestSequence;
  assert.equal(
    transition.state.nextStatefsRequestSequence,
    expectedNextRequestSequence,
    `${label} exact next StateFS request sequence`,
  );
  if (witness.argument.kind === "STATEFS_PLAN") {
    assert.equal(transition.statefsPlan, witness.plan);
    assert.equal(transition.statefsRequest, witness.plan.request);
    assert.equal(
      witness.plan.managerActorEpochSha256,
      previousState.managerActorEpochSha256,
    );
    assert.equal(
      witness.plan.requestSequence,
      previousState.nextStatefsRequestSequence,
    );
    if (witness.plan.request !== null) {
      assert.equal(
        witness.plan.request.managerActorEpochSha256,
        previousState.managerActorEpochSha256,
      );
      assert.equal(
        witness.plan.request.requestSequence,
        previousState.nextStatefsRequestSequence,
      );
      assert.equal(
        witness.plan.request.requestSha256,
        input.statefsRequestSha256,
      );
    }
  } else {
    assert.equal(transition.statefsPlan, null);
    assert.equal(transition.statefsRequest, null);
  }
  if (witness.argument.kind === "STATEFS_RECEIPT") {
    assert.equal(
      previousState.statefsRequestSha256,
      witness.receipt.requestSha256,
      `${label} retained receipt request`,
    );
    assert.equal(
      witness.receipt.request.managerActorEpochSha256,
      previousState.managerActorEpochSha256,
    );
  }

  const previousHandoffPlan =
    EXPECTED_GUARDIAN_HANDOFF_PLANS.get(previousState) ?? null;
  let nextHandoffPlan = previousHandoffPlan;
  const expectsHandoffPlan =
    witness.argument.kind === "STATEFS_PLAN" &&
    transition.state.status === "GUARDIAN_HANDOFF_REQUIRED";
  if (expectsHandoffPlan) {
    assert.notEqual(transition.guardianHandoffPlan, null);
    assertGuardianHandoffPlan(
      transition.guardianHandoffPlan,
      witness.plan,
      label,
    );
    nextHandoffPlan = transition.guardianHandoffPlan;
  } else {
    assert.equal(transition.guardianHandoffPlan, null);
  }
  if (
    transition.state.status !== "GUARDIAN_HANDOFF_REQUIRED" &&
    transition.state.status !== "WAITING_FOR_GUARDIAN"
  ) {
    nextHandoffPlan = null;
  }

  if (witness.argument.kind === "RECOVERY_REQUEST_OBSERVED") {
    assert.notEqual(transition.guardianRecoveryRequestArtifact, null);
    assertRecoveryRequestArtifact(
      transition.guardianRecoveryRequestArtifact,
      {
        handoffPlan: previousHandoffPlan,
        startup: witness.startup,
        controlState: witness.controlState,
        frameBytes: witness.recoveryRequestFrameBytes,
      },
      label,
    );
  } else {
    assert.equal(transition.guardianRecoveryRequestArtifact, null);
  }
  if (witness.argument.kind === "GUARDIAN_STATUS_FRAME") {
    const artifact = transition.guardianStatusArtifact;
    assert.notEqual(artifact, null);
    assert.equal(artifact.byteLength, witness.statusFrameBytes.length);
    assert.equal(artifact.rawSha256, byteSha256(witness.statusFrameBytes));
    assert.deepEqual(artifact.bytes, witness.statusFrameBytes);
  } else {
    assert.equal(transition.guardianStatusArtifact, null);
  }

  const expectedHandles = activeDirectoryHandlesAfter(
    previousState,
    witness,
    transition,
    label,
  );
  assertActiveDirectoryHandles(transition.state, expectedHandles, label);
  EXPECTED_ACTIVE_DIRECTORY_HANDLES.set(transition.state, expectedHandles);
  EXPECTED_GUARDIAN_HANDOFF_PLANS.set(transition.state, nextHandoffPlan);
}

function reduceManager(previousState, input, label) {
  const transition =
    manager.reduceCandidateContainmentGuardianManagerProtocolV1(
      previousState,
      input,
    );
  assertReducedStateAndTransition(transition, previousState, input, label);
  return transition;
}

function initializeManager(label) {
  const bytes = epochBytes(label);
  const expectedDigest = byteSha256(bytes);
  const projection =
    manager.createCandidateContainmentGuardianManagerActorEpochV1(bytes);
  assertExactFields(projection, EPOCH_FIELDS, `${label} epoch`);
  assertNullFrozenTree(projection, `${label} epoch`);
  assert.equal(projection.byteLength, 32);
  assert.equal(projection.schema, schemaLiteral("managerActorEpoch"));
  assert.equal(projection.managerActorEpochSha256, expectedDigest);
  assert.equal(projection.consumed, false);
  assertClaims(projection, `${label} epoch`);
  const transition =
    manager.initializeCandidateContainmentGuardianManagerProtocolV1(projection);
  assertInitialStateAndTransition(transition, projection, `${label} initial`);
  return { bytes, projection, transition, state: transition.state };
}

function makeLockPlan(module, state) {
  return module.planCandidateContainmentGuardianStatefsOperationV1(
    statefsPlannerInput({
      managerActorEpochSha256: state.managerActorEpochSha256,
      requestSequence: state.nextStatefsRequestSequence,
    }),
  );
}

function makeManagerPlanInput(state, plan) {
  const argument = managerInputArgument({
    kind: "STATEFS_PLAN",
    statefsPlan: plan,
  });
  return assertManagerInputProjection(
    manager.createCandidateContainmentGuardianManagerProtocolInputV1(
      state,
      argument,
    ),
    state,
    argument,
    "statefs plan",
  );
}

function makeManagerReceiptInput(state, receipt) {
  const argument = managerInputArgument({
    kind: "STATEFS_RECEIPT",
    statefsReceipt: receipt,
  });
  return assertManagerInputProjection(
    manager.createCandidateContainmentGuardianManagerProtocolInputV1(
      state,
      argument,
    ),
    state,
    argument,
    "statefs receipt",
  );
}

function dispatchStatefsRequest(plan, executorResult) {
  assert.equal(
    statefs.assertCandidateContainmentGuardianStatefsRequestV1(plan.request),
    true,
  );
  return statefs.verifyCandidateContainmentGuardianStatefsResultV1({
    request: plan.request,
    executorResult,
  });
}

candidateTest(
  "actor epoch is exact, copied, private-branded, nonzero, and single-use",
  () => {
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerActorEpochV1(
          Buffer.alloc(31, 1),
        ),
      "MANAGER_BOUNDS",
    );
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerActorEpochV1(
          new Uint8Array(32),
        ),
      "MANAGER_SHAPE",
    );
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerActorEpochV1(
          Buffer.alloc(32),
        ),
      "MANAGER_EPOCH",
    );
    if (typeof SharedArrayBuffer === "function") {
      expectCode(
        () =>
          manager.createCandidateContainmentGuardianManagerActorEpochV1(
            Buffer.from(new SharedArrayBuffer(32)),
          ),
        "MANAGER_SHAPE",
      );
    }
    let proxyReads = 0;
    const proxy = new Proxy(Buffer.alloc(32, 1), {
      get() {
        proxyReads += 1;
        throw new Error("EPOCH_PROXY_READ");
      },
      getPrototypeOf() {
        proxyReads += 1;
        throw new Error("EPOCH_PROXY_PROTOTYPE");
      },
    });
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerActorEpochV1(proxy),
      "MANAGER_SHAPE",
    );
    assert.equal(proxyReads, 0);

    const bytes = epochBytes("copy-and-single-use");
    const expectedDigest = byteSha256(bytes);
    const epoch =
      manager.createCandidateContainmentGuardianManagerActorEpochV1(bytes);
    bytes.fill(0);
    assert.equal(epoch.managerActorEpochSha256, expectedDigest);
    assert.equal(epoch.consumed, false);
    assertExactFields(epoch, EPOCH_FIELDS, "epoch");
    assertNullFrozenTree(epoch, "epoch");
    assert.equal(epoch.schema, schemaLiteral("managerActorEpoch"));
    assertClaims(epoch, "epoch");
    const clone = record(...Object.entries(epoch));
    expectCode(
      () =>
        manager.initializeCandidateContainmentGuardianManagerProtocolV1(clone),
      "MANAGER_EPOCH",
    );
    const transition =
      manager.initializeCandidateContainmentGuardianManagerProtocolV1(epoch);
    assert.equal(
      epoch.consumed,
      false,
      "public projection remains descriptive",
    );
    expectCode(
      () =>
        manager.initializeCandidateContainmentGuardianManagerProtocolV1(epoch),
      "MANAGER_EPOCH",
    );
    assertInitialStateAndTransition(transition, epoch, "epoch initialization");
  },
);

candidateTest(
  "initialization freezes the exact zero-sequence service-manager state and one-shot transition",
  () => {
    const { transition, state } = initializeManager("initial-state");
    assert.equal(transition.previousStateSha256, ZERO_DIGEST);
    assert.equal(transition.inputSha256, null);
    for (const key of [
      "statefsPlan",
      "statefsRequest",
      "guardianHandoffPlan",
      "guardianRecoveryRequestArtifact",
      "guardianStatusArtifact",
    ]) {
      assert.equal(transition[key], null, key);
    }
    assert.deepEqual(
      {
        sequence: state.sequence,
        nextStatefsRequestSequence: state.nextStatefsRequestSequence,
        inventoryRequestCount: state.inventoryRequestCount,
        inventorySetSha256: state.inventorySetSha256,
        inventoryComplete: state.inventoryComplete,
        activeDirectoryHandleCount: state.activeDirectoryHandleCount,
        activeDirectoryHandlesSha256: state.activeDirectoryHandlesSha256,
        previousStateSha256: state.previousStateSha256,
        status: state.status,
        writerKind: state.writerKind,
        actorKind: state.actorKind,
        unresolvedEffect: state.unresolvedEffect,
        retryPermitted: state.retryPermitted,
        terminal: state.terminal,
      },
      {
        sequence: 0,
        nextStatefsRequestSequence: 0,
        inventoryRequestCount: 0,
        inventorySetSha256: null,
        inventoryComplete: false,
        activeDirectoryHandleCount: 0,
        activeDirectoryHandlesSha256: null,
        previousStateSha256: ZERO_DIGEST,
        status: "LOCK_REQUIRED",
        writerKind: "SERVICE_MANAGER",
        actorKind: null,
        unresolvedEffect: false,
        retryPermitted: false,
        terminal: false,
      },
    );
    for (const key of [
      "targetSha256",
      "requiredDurableRecordType",
      "permittedStatefsOperation",
      "permittedGuardianAction",
      "requiredOutcomeRecordType",
      "statefsPlanSha256",
      "statefsRequestSha256",
      "guardianStartupSha256",
      "recoveryRequestFrameRawSha256",
      "lastGuardianWireSequence",
      "lastGuardianWireFrameRawSha256",
    ]) {
      assert.equal(state[key], null, key);
    }

    let propertyAccesses = 0;
    const foreignProxy = new Proxy(transition, {
      get() {
        propertyAccesses += 1;
        throw new Error("TRANSITION_PROPERTY_READ");
      },
      ownKeys() {
        propertyAccesses += 1;
        throw new Error("TRANSITION_KEYS_READ");
      },
      getOwnPropertyDescriptor() {
        propertyAccesses += 1;
        throw new Error("TRANSITION_DESCRIPTOR_READ");
      },
    });
    expectCode(
      () =>
        manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
          foreignProxy,
        ),
      "MANAGER_BINDING",
    );
    assert.equal(propertyAccesses, 0);
    assert.equal(
      manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
        transition,
      ),
      true,
    );
    expectCode(
      () =>
        manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
          transition,
        ),
      "MANAGER_BINDING",
    );
  },
);

candidateTest(
  "state branding precedes input reflection and one predecessor admits only one fork",
  () => {
    const { transition: initialTransition, state } = initializeManager(
      "state-input-ordering",
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      initialTransition,
    );
    let reads = 0;
    const poisonousInput = new Proxy(Object.create(null), {
      get() {
        reads += 1;
        throw new Error("INPUT_GET");
      },
      ownKeys() {
        reads += 1;
        throw new Error("INPUT_KEYS");
      },
      getOwnPropertyDescriptor() {
        reads += 1;
        throw new Error("INPUT_DESCRIPTOR");
      },
    });
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerProtocolInputV1(
          record(...Object.entries(state)),
          poisonousInput,
        ),
      "MANAGER_BINDING",
    );
    assert.equal(reads, 0);
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerProtocolInputV1(
          state,
          record(...Object.entries(managerInputArgument()), ["extra", null]),
        ),
      "MANAGER_SHAPE",
    );

    const wrongSequencePlan =
      statefs.planCandidateContainmentGuardianStatefsOperationV1(
        statefsPlannerInput({
          managerActorEpochSha256: state.managerActorEpochSha256,
          requestSequence: state.nextStatefsRequestSequence + 1,
        }),
      );
    expectCode(() => {
      const wrongSequenceInput = makeManagerPlanInput(state, wrongSequencePlan);
      manager.reduceCandidateContainmentGuardianManagerProtocolV1(
        state,
        wrongSequenceInput,
      );
    }, "MANAGER_BINDING");
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsPlanV1(
        wrongSequencePlan,
      ),
      wrongSequencePlan.ownerContext,
      "manager rejects the wrong sequence before consuming the StateFS plan",
    );

    const planA = makeLockPlan(statefs, state);
    const planB = makeLockPlan(statefs, state);
    const inputA = makeManagerPlanInput(state, planA);
    const inputB = makeManagerPlanInput(state, planB);
    const accepted = reduceManager(state, inputA, "single accepted fork");
    assert.equal(accepted.state.status, "STATEFS_OPERATION_REQUIRED");
    expectCode(
      () =>
        manager.reduceCandidateContainmentGuardianManagerProtocolV1(
          state,
          inputB,
        ),
      "MANAGER_BINDING",
    );
    assert.equal(
      manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
        accepted,
      ),
      true,
    );
  },
);

candidateTest(
  "same-origin StateFS lock plan, nested request, input, state, receipt, and transition are one-shot at their owners",
  () => {
    const { transition: initialTransition, state } =
      initializeManager("same-origin-lock");
    assert.equal(
      manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
        initialTransition,
      ),
      true,
    );
    const plan = makeLockPlan(statefs, state);
    const input = makeManagerPlanInput(state, plan);
    assertExactFields(input, INPUT_FIELDS, "lock plan input");
    assertNullFrozenTree(input, "lock plan input");
    assert.equal(input.kind, "STATEFS_PLAN");
    assert.equal(input.boundStateSha256, state.stateSha256);
    assert.equal(input.statefsPlanSha256, plan.planSha256);
    assert.equal(input.statefsRequestSha256, plan.request.requestSha256);
    assert.equal(
      input.ownerContextSha256,
      plan.ownerContext.ownerContextSha256,
    );
    assert.equal(input.lifetimeReplaySha256, null);
    assertClaims(input, "lock plan input");
    expectCode(
      () => statefs.assertCandidateContainmentGuardianStatefsPlanV1(plan),
      "STATEFS_BINDING",
    );

    const stateClone = record(...Object.entries(state));
    expectCode(
      () =>
        manager.reduceCandidateContainmentGuardianManagerProtocolV1(
          stateClone,
          input,
        ),
      "MANAGER_BINDING",
    );
    const operationTransition = reduceManager(state, input, "lock operation");
    assert.equal(operationTransition.statefsPlan, plan);
    assert.equal(operationTransition.statefsRequest, plan.request);
    assert.equal(
      operationTransition.state.status,
      "STATEFS_OPERATION_REQUIRED",
    );
    assert.equal(
      operationTransition.state.permittedStatefsOperation,
      "LOCK_EX_NB",
    );
    assert.equal(operationTransition.state.sequence, 1);
    assert.equal(operationTransition.state.nextStatefsRequestSequence, 1);
    expectCode(
      () =>
        manager.reduceCandidateContainmentGuardianManagerProtocolV1(
          state,
          input,
        ),
      "MANAGER_BINDING",
    );

    assert.equal(
      manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
        operationTransition,
      ),
      true,
    );
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsRequestV1(plan.request),
      true,
      "manager transition assertion leaves the nested request PLANNED",
    );
    expectCode(
      () =>
        statefs.assertCandidateContainmentGuardianStatefsRequestV1(
          plan.request,
        ),
      "STATEFS_BINDING",
    );
    const receipt = statefs.verifyCandidateContainmentGuardianStatefsResultV1({
      request: plan.request,
      executorResult: lockExecutorResult(plan.request),
    });
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsReceiptV1(receipt),
      true,
    );
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsReceiptV1(receipt),
      true,
      "StateFS receipt assertion remains repeatable",
    );
    const receiptInput = makeManagerReceiptInput(
      operationTransition.state,
      receipt,
    );
    const inventoryTransition = reduceManager(
      operationTransition.state,
      receiptInput,
      "lock receipt",
    );
    assert.equal(inventoryTransition.state.status, "INVENTORY_REQUIRED");
    assert.equal(inventoryTransition.state.sequence, 2);
    assert.equal(inventoryTransition.state.nextStatefsRequestSequence, 1);
    assert.equal(inventoryTransition.state.inventoryRequestCount, 0);
    assert.equal(inventoryTransition.state.inventoryComplete, false);
    assert.equal(inventoryTransition.state.activeDirectoryHandleCount, 1);
    assert.match(
      inventoryTransition.state.activeDirectoryHandlesSha256,
      /^[0-9a-f]{64}$/u,
    );
    assert.equal(
      inventoryTransition.state.inventorySetSha256,
      receipt.inventorySet.inventorySetSha256,
    );
    assert.equal(inventoryTransition.statefsPlan, null);
    assert.equal(inventoryTransition.statefsRequest, null);
    expectCode(
      () =>
        manager.reduceCandidateContainmentGuardianManagerProtocolV1(
          operationTransition.state,
          receiptInput,
        ),
      "MANAGER_BINDING",
    );
    expectCode(
      () => makeManagerReceiptInput(operationTransition.state, receipt),
      "MANAGER_BINDING",
    );
  },
);

candidateTest(
  "same-origin equal digests cannot substitute private states, epochs, tokens, or retained requests",
  () => {
    const stateA = initializeManager("same-digest-alternate-state");
    const stateB = initializeManager("same-digest-alternate-state");
    assert.notEqual(stateA.state, stateB.state);
    assert.deepEqual(stateA.state, stateB.state);
    assert.equal(stateA.state.stateSha256, stateB.state.stateSha256);
    assert.equal(
      stateA.state.managerActorEpochSha256,
      stateB.state.managerActorEpochSha256,
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      stateA.transition,
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      stateB.transition,
    );
    const stateAPlan = makeLockPlan(statefs, stateA.state);
    const stateAInput = makeManagerPlanInput(stateA.state, stateAPlan);
    assert.equal(stateAInput.boundStateSha256, stateB.state.stateSha256);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expectCode(
        () =>
          manager.reduceCandidateContainmentGuardianManagerProtocolV1(
            stateB.state,
            stateAInput,
          ),
        "MANAGER_BINDING",
      );
    }
    const stateAAccepted = reduceManager(
      stateA.state,
      stateAInput,
      "same-digest exact state identity",
    );
    assert.equal(stateAAccepted.state.status, "STATEFS_OPERATION_REQUIRED");

    const wrongEpoch = initializeManager("wrong-manager-epoch-plan");
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      wrongEpoch.transition,
    );
    const wrongEpochPlan =
      statefs.planCandidateContainmentGuardianStatefsOperationV1(
        statefsPlannerInput({
          managerActorEpochSha256: digest(
            "wrong-manager-epoch-plan:alternate-epoch",
          ),
          requestSequence: wrongEpoch.state.nextStatefsRequestSequence,
        }),
      );
    expectCode(
      () => makeManagerPlanInput(wrongEpoch.state, wrongEpochPlan),
      "MANAGER_BINDING",
    );
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsPlanV1(wrongEpochPlan),
      wrongEpochPlan.ownerContext,
      "wrong manager epoch rejection leaves the exact StateFS plan available",
    );
    const rightEpochPlan = makeLockPlan(statefs, wrongEpoch.state);
    const rightEpochTransition = acceptPlan(
      wrongEpoch.state,
      rightEpochPlan,
      "right manager epoch remains usable",
    );
    assert.equal(
      rightEpochTransition.state.status,
      "STATEFS_OPERATION_REQUIRED",
    );

    const receiptFixture = initializeManager("alternate-request-receipt");
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      receiptFixture.transition,
    );
    const retainedPlan = makeLockPlan(statefs, receiptFixture.state);
    const alternatePlan = makeLockPlan(statefs, receiptFixture.state);
    assert.notEqual(retainedPlan, alternatePlan);
    assert.notEqual(retainedPlan.request, alternatePlan.request);
    assert.deepEqual(retainedPlan, alternatePlan);
    assert.equal(
      retainedPlan.request.requestSha256,
      alternatePlan.request.requestSha256,
    );
    const operation = acceptPlan(
      receiptFixture.state,
      retainedPlan,
      "retained request identity",
    );
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsPlanV1(alternatePlan),
      alternatePlan.ownerContext,
    );
    const retainedReceipt = dispatchStatefsRequest(
      retainedPlan,
      lockExecutorResult(retainedPlan.request),
    );
    const alternateReceipt = dispatchStatefsRequest(
      alternatePlan,
      lockExecutorResult(alternatePlan.request),
    );
    assert.notEqual(retainedReceipt, alternateReceipt);
    assert.notEqual(retainedReceipt.request, alternateReceipt.request);
    assert.deepEqual(retainedReceipt, alternateReceipt);
    assert.equal(retainedReceipt.receiptSha256, alternateReceipt.receiptSha256);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expectCode(
        () => makeManagerReceiptInput(operation.state, alternateReceipt),
        "MANAGER_BINDING",
      );
    }
    const inventory = acceptReceipt(
      operation.state,
      retainedReceipt,
      "exact retained request receipt",
    );

    const retainedToken = retainedReceipt.inventorySet;
    const alternateToken = alternateReceipt.inventorySet;
    assert.notEqual(retainedToken, alternateToken);
    assert.deepEqual(retainedToken, alternateToken);
    assert.equal(
      retainedToken.inventorySetSha256,
      alternateToken.inventorySetSha256,
    );
    const alternateTokenPlan = statefsInventoryPlan({
      state: inventory.state,
      token: alternateToken,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    expectCode(
      () => makeManagerPlanInput(inventory.state, alternateTokenPlan),
      "MANAGER_BINDING",
    );
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsPlanV1(
        alternateTokenPlan,
      ),
      alternateTokenPlan.ownerContext,
      "alternate-token rejection leaves the exact StateFS plan available",
    );
    const retainedTokenPlan = statefsInventoryPlan({
      state: inventory.state,
      token: retainedToken,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    assert.notEqual(alternateTokenPlan, retainedTokenPlan);
    assert.deepEqual(alternateTokenPlan, retainedTokenPlan);
    assert.equal(
      alternateTokenPlan.planSha256,
      retainedTokenPlan.planSha256,
    );
    const retainedTokenTransition = acceptPlan(
      inventory.state,
      retainedTokenPlan,
      "exact retained token identity",
    );
    assert.equal(
      retainedTokenTransition.state.status,
      "STATEFS_OPERATION_REQUIRED",
    );
  },
);

candidateTest(
  "behavioral adjacent invalidities enforce all seven manager errors in exact precedence",
  async () => {
    const observed = [];
    observed.push(
      expectPrecedence(
        () =>
          manager.createCandidateContainmentGuardianManagerActorEpochV1(
            new Uint8Array(31),
          ),
        "MANAGER_BOUNDS",
        "MANAGER_SHAPE",
        "BOUNDS before SHAPE",
      ),
    );
    observed.push(
      expectPrecedence(
        () =>
          manager.createCandidateContainmentGuardianManagerActorEpochV1(
            new Uint8Array(32),
          ),
        "MANAGER_SHAPE",
        "MANAGER_EPOCH",
        "SHAPE before all-zero EPOCH",
      ),
    );
    observed.push(
      expectPrecedence(
        () =>
          manager.createCandidateContainmentGuardianManagerActorEpochV1(
            Buffer.alloc(32),
          ),
        "MANAGER_EPOCH",
        null,
        "EPOCH on the epoch-constructor surface",
      ),
    );

    const predecessorFixture = initializeManager("precedence-predecessor");
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      predecessorFixture.transition,
    );
    const foreignStatefs = await import(
      `${STATEFS_URL.href}?manager-precedence-predecessor=1`
    );
    const foreignWrongSequencePlan =
      foreignStatefs.planCandidateContainmentGuardianStatefsOperationV1(
        statefsPlannerInput({
          managerActorEpochSha256:
            predecessorFixture.state.managerActorEpochSha256,
          requestSequence:
            predecessorFixture.state.nextStatefsRequestSequence + 1,
        }),
      );
    observed.push(
      expectPrecedence(
        () =>
          makeManagerPlanInput(
            predecessorFixture.state,
            foreignWrongSequencePlan,
          ),
        "MANAGER_PREDECESSOR",
        "MANAGER_BINDING",
        "PREDECESSOR before wrong-sequence BINDING",
      ),
    );
    assert.equal(
      foreignStatefs.assertCandidateContainmentGuardianStatefsPlanV1(
        foreignWrongSequencePlan,
      ),
      foreignWrongSequencePlan.ownerContext,
      "precedence rejection does not consume the foreign plan",
    );
    const coherentPredecessorPlan = makeLockPlan(
      statefs,
      predecessorFixture.state,
    );
    const coherentPredecessorTransition = acceptPlan(
      predecessorFixture.state,
      coherentPredecessorPlan,
      "precedence coherent predecessor remains usable",
    );
    assert.equal(
      coherentPredecessorTransition.state.status,
      "STATEFS_OPERATION_REQUIRED",
    );
    const unlistedPlan = makeLockPlan(
      statefs,
      coherentPredecessorTransition.state,
    );
    const unlistedInput = makeManagerPlanInput(
      coherentPredecessorTransition.state,
      unlistedPlan,
    );

    const disjointEpochPredecessorBoundary = record(
      ["earlierCode", "MANAGER_EPOCH"],
      [
        "earlierEntrypoint",
        "createCandidateContainmentGuardianManagerActorEpochV1",
      ],
      ["laterCode", "MANAGER_PREDECESSOR"],
      [
        "laterEntrypoint",
        "createCandidateContainmentGuardianManagerProtocolInputV1",
      ],
      ["sharedPublicEntrypoint", null],
    );
    assert.equal(
      disjointEpochPredecessorBoundary.sharedPublicEntrypoint,
      null,
      "EPOCH/PREDECESSOR have no coherently co-invalid public call",
    );
    assert.equal(
      ERROR_PRECEDENCE.indexOf(
        disjointEpochPredecessorBoundary.laterCode,
      ),
      ERROR_PRECEDENCE.indexOf(
        disjointEpochPredecessorBoundary.earlierCode,
      ) + 1,
    );

    let { owner, state, token } = inventoryLifetimeOwner(
      "precedence-writer",
      createNormalHandoffOwner,
    );
    expectCode(
      () => statefsAutoPlan({ state, token, owner }),
      "STATEFS_BINDING",
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "precedence-writer",
    }));
    const handoffPlan = statefsAutoPlan({ state, token, owner });
    const handoff = acceptPlan(
      state,
      handoffPlan,
      "precedence normal handoff",
    );
    assert.equal(handoff.state.status, "GUARDIAN_HANDOFF_REQUIRED");
    const prefix = createNormalControlPrefix(owner);
    const readyInput = makeManagerStatusInput(
      handoff.state,
      prefix.startup,
      prefix.ready,
    );
    const waiting = reduceManager(
      handoff.state,
      readyInput,
      "precedence waiting state",
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      waiting,
    );
    assert.equal(waiting.state.status, "WAITING_FOR_GUARDIAN");
    assert.equal(waiting.state.writerKind, null);

    const writerPlan = statefsInventoryPlan({
      state: waiting.state,
      token,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    assert.equal(writerPlan.request.writerKind, "SERVICE_MANAGER");
    const writerInput = makeManagerPlanInput(waiting.state, writerPlan);
    observed.push(
      expectPrecedence(
        () =>
          manager.reduceCandidateContainmentGuardianManagerProtocolV1(
            record(...Object.entries(waiting.state)),
            writerInput,
          ),
        "MANAGER_BINDING",
        "MANAGER_WRITER",
        "BINDING before writer validation",
      ),
    );
    observed.push(
      expectPrecedence(
        () =>
          manager.reduceCandidateContainmentGuardianManagerProtocolV1(
            waiting.state,
            writerInput,
          ),
        "MANAGER_WRITER",
        "MANAGER_TRANSITION",
        "WRITER before otherwise-unlisted TRANSITION",
      ),
    );
    expectPrecedence(
      () =>
        manager.reduceCandidateContainmentGuardianManagerProtocolV1(
          waiting.state,
          writerInput,
        ),
      "MANAGER_WRITER",
      "MANAGER_TRANSITION",
      "WRITER rejection is non-consuming",
    );

    observed.push(
      expectPrecedence(
        () =>
          manager.reduceCandidateContainmentGuardianManagerProtocolV1(
            coherentPredecessorTransition.state,
            unlistedInput,
          ),
        "MANAGER_TRANSITION",
        null,
        "TRANSITION default with no earlier invalidity",
      ),
    );
    expectCode(
      () =>
        manager.reduceCandidateContainmentGuardianManagerProtocolV1(
          coherentPredecessorTransition.state,
          unlistedInput,
        ),
      "MANAGER_TRANSITION",
    );

    const cancelled = reduceNormalControlCancel(prefix.controlState);
    const validInput = makeManagerStatusInput(
      waiting.state,
      prefix.startup,
      cancelled.statusFrame0,
    );
    const validTransition = reduceManager(
      waiting.state,
      validInput,
      "precedence rejects leave coherent state and input authority",
    );
    assert.equal(validTransition.state.status, "WAITING_FOR_GUARDIAN");
    assert.deepEqual(observed, ERROR_PRECEDENCE);
  },
);

candidateTest(
  "lock contention is terminal, tokenless, nonretrying, and has no successor transition",
  () => {
    const { transition: initialTransition, state } =
      initializeManager("lock-contention");
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      initialTransition,
    );
    const plan = makeLockPlan(statefs, state);
    const planInput = makeManagerPlanInput(state, plan);
    const operationTransition = reduceManager(
      state,
      planInput,
      "contended lock plan",
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      operationTransition,
    );
    const receipt = dispatchStatefsRequest(
      plan,
      lockExecutorResult(plan.request, { contended: true }),
    );
    assert.equal(receipt.outcome, "LOCK_CONTENDED");
    assert.equal(receipt.retryDisposition, "NO_RETRY");
    const receiptInput = makeManagerReceiptInput(
      operationTransition.state,
      receipt,
    );
    const terminalTransition = reduceManager(
      operationTransition.state,
      receiptInput,
      "lock contention",
    );
    assert.equal(terminalTransition.state.status, "LOCK_CONTENDED");
    assert.equal(terminalTransition.state.writerKind, null);
    assert.equal(terminalTransition.state.actorKind, null);
    assert.equal(terminalTransition.state.inventorySetSha256, null);
    assert.equal(terminalTransition.state.activeDirectoryHandleCount, 0);
    assert.equal(terminalTransition.state.activeDirectoryHandlesSha256, null);
    assert.equal(terminalTransition.state.unresolvedEffect, false);
    assert.equal(terminalTransition.state.retryPermitted, false);
    assert.equal(terminalTransition.state.terminal, true);
    assert.equal(terminalTransition.statefsPlan, null);
    assert.equal(terminalTransition.statefsRequest, null);
    assert.equal(
      manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
        terminalTransition,
      ),
      true,
    );
  },
);

candidateTest(
  "foreign StateFS brands and foreign manager WeakMaps reject without consuming coherent originals",
  async () => {
    const { state } = initializeManager("foreign-statefs-brand");
    const foreignStatefs = await import(
      `${STATEFS_URL.href}?manager-protocol-foreign-statefs=1`
    );
    const foreignPlan = makeLockPlan(foreignStatefs, state);
    expectCode(
      () => makeManagerPlanInput(state, foreignPlan),
      "MANAGER_PREDECESSOR",
    );
    assert.equal(
      foreignStatefs.assertCandidateContainmentGuardianStatefsPlanV1(
        foreignPlan,
      ),
      foreignPlan.ownerContext,
      "foreign owner keeps its fresh plan",
    );
    const localPlan = makeLockPlan(statefs, state);
    const localInput = makeManagerPlanInput(state, localPlan);
    const localTransition = reduceManager(
      state,
      localInput,
      "local StateFS brand",
    );
    assert.equal(localTransition.state.status, "STATEFS_OPERATION_REQUIRED");

    const otherManager = await import(
      `${SOURCE_URL.href}?manager-protocol-foreign-manager=1`
    );
    const otherEpochBytes = epochBytes("foreign-manager-epoch");
    const otherEpoch =
      otherManager.createCandidateContainmentGuardianManagerActorEpochV1(
        otherEpochBytes,
      );
    expectCode(
      () =>
        manager.initializeCandidateContainmentGuardianManagerProtocolV1(
          otherEpoch,
        ),
      "MANAGER_EPOCH",
    );
    const otherInitial =
      otherManager.initializeCandidateContainmentGuardianManagerProtocolV1(
        otherEpoch,
      );
    let reads = 0;
    const proxy = new Proxy(otherInitial, {
      get() {
        reads += 1;
        throw new Error("FOREIGN_TRANSITION_READ");
      },
      ownKeys() {
        reads += 1;
        throw new Error("FOREIGN_TRANSITION_KEYS");
      },
      getOwnPropertyDescriptor() {
        reads += 1;
        throw new Error("FOREIGN_TRANSITION_DESCRIPTOR");
      },
    });
    expectCode(
      () =>
        manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
          proxy,
        ),
      "MANAGER_BINDING",
    );
    assert.equal(reads, 0);
    assert.equal(
      otherManager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
        otherInitial,
      ),
      true,
    );
  },
);

const ROOT_CHILDREN = array(
  array("lifetimes", "LIFETIMES", "101"),
  array("staging", "STAGING", "102"),
  array("active", "ACTIVE", "103"),
  array("closed", "CLOSED", "104"),
  array("recovered", "RECOVERED", "105"),
  array("quarantined", "QUARANTINED", "106"),
);

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
    statxMask: 0x17ff,
    filesystemMagic: "61267",
    contentOffset: 0,
    contentLength: 0,
    ...overrides,
  };
  return record(
    ...STATEFS_NATIVE_OBSERVATION_FIELDS.map((key) => [key, values[key]]),
  );
}

function statefsInventoryPlan({ state, token, role, parentRole, name = null }) {
  const values = {
    kind: "INVENTORY",
    managerActorEpochSha256: state.managerActorEpochSha256,
    requestSequence: state.nextStatefsRequestSequence,
    inventorySetSha256: token.inventorySetSha256,
    stateRootObservation: null,
    currentInventorySet: token,
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
    inventoryDirectoryRole: role,
    directoryRoleA: parentRole,
    directoryRoleB: null,
    nameA: name,
    nameB: null,
    expectedOutcome: "INVENTORY_OBSERVED",
  };
  return statefs.planCandidateContainmentGuardianStatefsOperationV1(
    record(...STATEFS_PLANNER_INPUT_FIELDS.map((key) => [key, values[key]])),
  );
}

function statefsReleasePlan({ state, token, role }) {
  const values = {
    kind: "RELEASE_DIRECTORY",
    managerActorEpochSha256: state.managerActorEpochSha256,
    requestSequence: state.nextStatefsRequestSequence,
    inventorySetSha256: token.inventorySetSha256,
    stateRootObservation: null,
    currentInventorySet: token,
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
    directoryRoleA: role,
    directoryRoleB: null,
    nameA: null,
    nameB: null,
    expectedOutcome: "DIRECTORY_RELEASED",
  };
  return statefs.planCandidateContainmentGuardianStatefsOperationV1(
    record(...STATEFS_PLANNER_INPUT_FIELDS.map((key) => [key, values[key]])),
  );
}

function directoryInventoryResult(
  request,
  { role, inode, entries = [], returnedDirectoryFd = -1 },
) {
  const nested = request.nameA !== null;
  const observations = array(
    nativeObservation({ role, inode }),
    ...entries.map((entry) =>
      Array.isArray(entry)
        ? nativeObservation({ role: "NONE", name: entry[0], inode: entry[2] })
        : nativeObservation({ ...entry, role: "NONE" }),
    ),
  );
  const values = {
    schema:
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: "COMPLETE",
    effectClass: "COMPLETE",
    lastCompletedStep: nested
      ? "DIRECTORY_HANDLE_TRANSFERRED"
      : "INVENTORY_DESCRIPTOR_CLOSED",
    failedStep: "NONE",
    errno: 0,
    completedStepCount: 5,
    bytesConsumed: 0,
    observations,
    outputBytes: null,
    returnedDirectoryFd,
  };
  return record(
    ...STATEFS_EXECUTOR_RESULT_FIELDS.map((key) => [key, values[key]]),
  );
}

function releaseResult(request) {
  const values = {
    schema:
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: "COMPLETE",
    effectClass: "COMPLETE",
    lastCompletedStep: "DIRECTORY_RELEASED",
    failedStep: "NONE",
    errno: 0,
    completedStepCount: 3,
    bytesConsumed: 0,
    observations: array(),
    outputBytes: null,
    returnedDirectoryFd: -1,
  };
  return record(
    ...STATEFS_EXECUTOR_RESULT_FIELDS.map((key) => [key, values[key]]),
  );
}

function acceptPlan(state, plan, label) {
  const input = makeManagerPlanInput(state, plan);
  const transition = reduceManager(state, input, label);
  assert.equal(transition.statefsPlan, plan);
  assert.equal(transition.statefsRequest, plan.request);
  assert.equal(
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      transition,
    ),
    true,
  );
  return transition;
}

function acceptReceipt(state, receipt, label) {
  const input = makeManagerReceiptInput(state, receipt);
  const transition = reduceManager(state, input, label);
  assert.equal(
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      transition,
    ),
    true,
  );
  return transition;
}

function enterInventory(label) {
  const initial = initializeManager(label);
  manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
    initial.transition,
  );
  const plan = makeLockPlan(statefs, initial.state);
  const operation = acceptPlan(initial.state, plan, `${label} lock plan`);
  const receipt = dispatchStatefsRequest(
    plan,
    lockExecutorResult(plan.request),
  );
  const inventory = acceptReceipt(
    operation.state,
    receipt,
    `${label} lock receipt`,
  );
  assert.equal(inventory.state.status, "INVENTORY_REQUIRED");
  return { state: inventory.state, token: receipt.inventorySet };
}

function lifetimeArtifact(value) {
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
              ["records", array(...records.map(lifetimeArtifact))],
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

function createLifetimeOwner({
  label,
  root,
  managerActorEpochSha256,
  journalStack = null,
}) {
  const ownedLifetimeEpochBytes =
    journalStack === null ? epochBytes(`${label}:lifetime-epoch`) : null;
  const zeroReplay = lifetime.replayCandidateContainmentGuardianLifetimeV1({
    segments: [],
    expectedStateRootIdentitySha256: root.identitySha256,
    expectedLatestLifetimeEpochSha256: null,
    expectedLatestRecordSequence: null,
    expectedLatestRecordRawSha256: null,
  });
  const identity =
    lifetime.createCandidateContainmentGuardianLifetimeIdentityV1({
      lifetimeKind: "NORMAL",
      stateRootIdentitySha256: root.identitySha256,
      managerActorEpochSha256,
      bootIdSha256:
        journalStack?.bootIdSha256 ?? digest(`${label}:boot-identity`),
      delegatedRootIdentitySha256:
        journalStack?.delegatedRootIdentitySha256 ??
        digest(`${label}:delegated-root-identity`),
      lifetimeEpochSha256:
        journalStack?.birthGuardianEpochSha256 ??
        byteSha256(ownedLifetimeEpochBytes),
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
    lifetimeEpochBytes: ownedLifetimeEpochBytes,
    records: [],
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
    const created = lifetime.createCandidateContainmentGuardianLifetimeRecordV1(
      {
        previousLifetimeReplay: owner.replay,
        lifetimeIdentity: identity,
        writerKind,
        writerActorEpochSha256,
        targetSha256,
        recordType,
        operationBytes: Buffer.from(`${canonicalJson(operation)}\n`, "utf8"),
        evidenceBytes: Buffer.from(`${canonicalJson(evidence)}\n`, "utf8"),
      },
    );
    owner.records.push(created);
    owner.replay = lifetime.replayCandidateContainmentGuardianLifetimeV1({
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

function createNormalHandoffOwner({ label, root, managerActorEpochSha256 }) {
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

function createAdoptedOwner({
  label,
  root,
  managerActorEpochSha256,
  journalStack,
}) {
  const owner = createLifetimeOwner({
    label,
    root,
    managerActorEpochSha256,
    journalStack,
  });
  owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
  owner.append("LIFETIME_CGROUP_CREATE_INTENT_DURABLE");
  const contextPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.lifetimeContext],
    ["lifetimeIdentitySha256", owner.identity.identitySha256],
    ["stateRootIdentitySha256", root.identitySha256],
    ["bootIdSha256", journalStack.bootIdSha256],
    ["delegatedRootIdentitySha256", journalStack.delegatedRootIdentitySha256],
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
  owner.append("GUARDIAN_PIDFD_OBSERVED");
  owner.append("GUARDIAN_EXEC_OBSERVED");
  owner.append("GUARDIAN_MEMBERSHIP_OBSERVED");
  owner.append("GUARDIAN_INITIALIZATION_ADOPTED", {
    writerKind: "LIVE_BIRTH_GUARDIAN",
    writerActorEpochSha256: owner.identity.lifetimeEpochSha256,
  });
  return owner;
}

function createTerminalOwner(options) {
  const owner = createAdoptedOwner(options);
  owner.append("GUARDIAN_TERMINATION_OBSERVED");
  owner.append("GUARDIAN_REAPED_OBSERVED");
  owner.append("LIFETIME_REMOVAL_INTENT_DURABLE");
  owner.append("LIFETIME_PATH_ABSENT_OBSERVED");
  owner.append("LIFETIME_CLOSED_DURABLE");
  assert.equal(owner.replay.status, "COMPLETE_LIFETIME_CHAIN_REPLAYED");
  return owner;
}

function journalArtifactList(journalStack) {
  return array(
    ...journalStack.normalJournalBundles.map((value) =>
      lifetimeArtifact(value),
    ),
  );
}

function installRecoveryTargetForOwner(owner, journalStack) {
  const { target: independentlyDerivedTarget, projection } =
    ownerFixtures.independentlyDeriveRecoveryTargetFromFixtureArtifacts(
      journalStack,
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
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: owner.replay,
      generationIdentitySha256: journalStack.generationIdentity.identitySha256,
    });
  const recoveryTarget = recovery.createCandidateContainmentRecoveryTargetV1({
    generationManifest: lifetimeArtifact(journalStack.generationManifest),
    normalJournalBundles: journalArtifactList(journalStack),
    lifetimeTargetSelection,
  });
  assert.equal(
    canonicalJson(recoveryTarget),
    canonicalJson(independentlyDerivedTarget),
  );
  const expectedExternalHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  const recoveryReplay = recovery.replayCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    entries: array(),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
    currentLifetimeAnchorPredecessorExternalHead: null,
    normalCloseDurabilityReceipt: null,
  });
  return { recoveryTarget, expectedExternalHead, recoveryReplay };
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

function recoveryInventory(journalStack, location = "active") {
  return recovery.createCandidateContainmentRecoveryInventoryObservationV1({
    generationIdentitySha256: journalStack.generationIdentity.identitySha256,
    stagingPresent: location === "staging",
    activePresent: location === "active",
    closedPresent: location === "closed",
    recoveredPresent: location === "recovered",
    quarantinedPresent: location === "quarantined",
    unsafeEntriesPresent: false,
  });
}

function refreshRecoveryTarget(owner, journalStack, recoveryTarget) {
  const lifetimeTargetSelection =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryTargetV1({
      lifetimeReplay: owner.replay,
      generationIdentitySha256: journalStack.generationIdentity.identitySha256,
    });
  return recovery.verifyCandidateContainmentRecoveryTargetV1({
    target: recoveryTarget,
    generationManifest: lifetimeArtifact(journalStack.generationManifest),
    normalJournalBundles: journalArtifactList(journalStack),
    lifetimeTargetSelection,
  });
}

function replayRecoveryTarget(
  owner,
  target,
  anchorSelection = null,
  predecessorExternalHead = null,
) {
  const expectedExternalHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: target.targetSha256,
    });
  return recovery.replayCandidateContainmentRecoveryV1({
    target,
    entries: array(),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection:
      anchorSelection?.lifetimeAnchorProjection ?? null,
    currentLifetimeAttemptAnchorRawSha256:
      anchorSelection?.lifetimeAttemptAnchorRawSha256 ?? null,
    currentLifetimeAnchorPredecessorExternalHead: predecessorExternalHead,
    normalCloseDurabilityReceipt: null,
  });
}

function buildRecoveryReplanTuple(owner, journalStack) {
  const installed = installRecoveryTargetForOwner(owner, journalStack);
  owner.append("GUARDIAN_TERMINATION_OBSERVED");
  owner.append("GUARDIAN_REAPED_OBSERVED");
  const recoveryTarget = refreshRecoveryTarget(
    owner,
    journalStack,
    installed.recoveryTarget,
  );
  const replay = replayRecoveryTarget(owner, recoveryTarget);
  const inventory = recoveryInventory(journalStack);
  const plan = recovery.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory,
      replay,
      proposedActorKind: "RECOVERY_ONLY_GUARDIAN",
    }),
  );
  assert.equal(plan.status, "RECOVERY_ANCHOR_REQUIRED");
  owner.inventoryJournalStack = journalStack;
  return {
    recoveryTarget,
    recoveryInventory: inventory,
    recoveryReplay: replay,
    recoveryPlan: plan,
  };
}

function buildRecoveryHandoffTuple(owner, journalStack) {
  const installed = installRecoveryTargetForOwner(owner, journalStack);
  owner.append("GUARDIAN_TERMINATION_OBSERVED");
  owner.append("GUARDIAN_REAPED_OBSERVED");
  let recoveryTarget = refreshRecoveryTarget(
    owner,
    journalStack,
    installed.recoveryTarget,
  );
  let replay = replayRecoveryTarget(owner, recoveryTarget);
  const inventory = recoveryInventory(journalStack);
  const phaseOne = recovery.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory,
      replay,
      proposedActorKind: "RECOVERY_ONLY_GUARDIAN",
    }),
  );
  assert.equal(phaseOne.status, "RECOVERY_ANCHOR_REQUIRED");
  const recoveryActorEpochBytes = epochBytes(
    `${owner.label}:recovery-only-actor`,
  );
  const recoveryActorEpochSha256 = byteSha256(recoveryActorEpochBytes);
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
    ["previousRecoveryActorEpochSha256", null],
    ["previousAttemptDirectoryName", null],
    ["previousRecoveryRecordSequence", null],
    ["previousRecoveryRecordRawSha256", ownerFixtures.ZERO_SHA256],
  );
  const predecessorExternalHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  const anchorEventPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.anchorEvent],
    ["predecessorExternalHead", predecessorExternalHead],
    ["anchorProjection", anchorProjection],
  );
  const anchorEvent = record(...Object.entries(anchorEventPrefix), [
    "eventSha256",
    semanticSha256(anchorEventPrefix),
  ]);
  owner.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
    targetSha256: recoveryTarget.targetSha256,
    evidence: anchorEvent,
  });
  recoveryTarget = refreshRecoveryTarget(owner, journalStack, recoveryTarget);
  const anchorSelection =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
      recoveryActorEpochSha256,
    });
  const currentExternalHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  replay = replayRecoveryTarget(
    owner,
    recoveryTarget,
    anchorSelection,
    currentExternalHead,
  );
  owner.append("RECOVERY_GUARDIAN_LAUNCH_INTENT_DURABLE", {
    targetSha256: recoveryTarget.targetSha256,
  });
  recoveryTarget = refreshRecoveryTarget(owner, journalStack, recoveryTarget);
  const retainedAnchor =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
      recoveryActorEpochSha256,
    });
  const retainedHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  replay = replayRecoveryTarget(
    owner,
    recoveryTarget,
    retainedAnchor,
    retainedHead,
  );
  const plan = recovery.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory,
      replay,
      proposedActorKind: null,
      anchorSelection: retainedAnchor,
    }),
  );
  assert.equal(plan.status, "RECOVERY_PLAN_READY");
  const attempt = recovery.createCandidateContainmentRecoveryAttemptV1({
    target: recoveryTarget,
    lifecycleInventoryObservation: inventory,
    previousRecoveryReplay: replay,
    plan,
    lifetimeAnchorProjection: retainedAnchor.lifetimeAnchorProjection,
    lifetimeAttemptAnchorRawSha256:
      retainedAnchor.lifetimeAttemptAnchorRawSha256,
  });
  owner.inventoryJournalStack = journalStack;
  owner.inventoryRecoveryAttempt = attempt;
  return {
    recoveryTarget,
    recoveryInventory: inventory,
    recoveryReplay: replay,
    recoveryPlan: plan,
    recoveryAttempt: attempt,
    recoveryActorEpochBytes,
    recoveryActorEpochSha256,
  };
}

function buildAnchoredEmptyReplanTuple(owner, journalStack) {
  const installed = installRecoveryTargetForOwner(owner, journalStack);
  owner.append("GUARDIAN_TERMINATION_OBSERVED");
  owner.append("GUARDIAN_REAPED_OBSERVED");
  let recoveryTarget = refreshRecoveryTarget(
    owner,
    journalStack,
    installed.recoveryTarget,
  );
  let recoveryReplay = replayRecoveryTarget(owner, recoveryTarget);
  const inventory = recoveryInventory(journalStack);
  const phaseOne = recovery.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory,
      replay: recoveryReplay,
      proposedActorKind: "RECOVERY_ONLY_GUARDIAN",
    }),
  );
  assert.equal(phaseOne.status, "RECOVERY_ANCHOR_REQUIRED");
  assert.equal(phaseOne.requiredActorKind, "RECOVERY_ONLY_GUARDIAN");

  const recoveryActorEpochSha256 = digest(
    `${owner.label}:anchored-empty-actor`,
  );
  const predecessorExternalHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
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
      predecessorExternalHead.recoveryActorEpochSha256,
    ],
    [
      "previousAttemptDirectoryName",
      predecessorExternalHead.attemptDirectoryName,
    ],
    [
      "previousRecoveryRecordSequence",
      predecessorExternalHead.latestRecoveryRecordSequence,
    ],
    [
      "previousRecoveryRecordRawSha256",
      predecessorExternalHead.latestRecoveryRecordRawSha256,
    ],
  );
  const anchorEventPrefix = record(
    ["schema", ownerFixtures.FIXTURE_SCHEMAS.anchorEvent],
    ["predecessorExternalHead", predecessorExternalHead],
    ["anchorProjection", anchorProjection],
  );
  const anchorEvent = record(...Object.entries(anchorEventPrefix), [
    "eventSha256",
    semanticSha256(anchorEventPrefix),
  ]);
  owner.append("RECOVERY_ATTEMPT_ANCHOR_DURABLE", {
    writerKind: "SERVICE_MANAGER",
    writerActorEpochSha256: owner.managerActorEpochSha256,
    targetSha256: recoveryTarget.targetSha256,
    evidence: anchorEvent,
  });
  recoveryTarget = refreshRecoveryTarget(owner, journalStack, recoveryTarget);
  const anchorSelection =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
      recoveryActorEpochSha256,
    });
  const currentExternalHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  recoveryReplay = replayRecoveryTarget(
    owner,
    recoveryTarget,
    anchorSelection,
    currentExternalHead,
  );
  const phaseTwo = recovery.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory,
      replay: recoveryReplay,
      proposedActorKind: null,
      anchorSelection,
    }),
  );
  assert.equal(phaseTwo.status, "RECOVERY_PLAN_READY");

  const anchoredEmptyAttempt =
    recovery.createCandidateContainmentRecoveryAnchoredEmptyAttemptV1({
      target: recoveryTarget,
      previousRecoveryReplay: recoveryReplay,
      lifetimeAnchorProjection: anchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        anchorSelection.lifetimeAttemptAnchorRawSha256,
      reportedAttemptDirectoryState: "ABSENT",
    });
  const anchoredHead = ownerFixtures.recoveryExternalHead({
    targetSha256: recoveryTarget.targetSha256,
    result: "ANCHORED_EMPTY_ATTEMPT",
    recoveryActorEpochSha256,
    attemptDirectoryName: recoveryActorEpochSha256,
    lifetimeAttemptAnchorRawSha256:
      anchorSelection.lifetimeAttemptAnchorRawSha256,
    latestRecoveryRecordSequence: null,
    latestRecoveryRecordRawSha256: ownerFixtures.ZERO_SHA256,
  });
  owner.append("RECOVERY_ATTEMPT_RESULT_DURABLE", {
    writerKind: "SERVICE_MANAGER",
    writerActorEpochSha256: owner.managerActorEpochSha256,
    targetSha256: recoveryTarget.targetSha256,
    evidence: anchoredHead,
  });
  recoveryTarget = refreshRecoveryTarget(owner, journalStack, recoveryTarget);
  const historicalAnchorSelection =
    lifetime.selectCandidateContainmentGuardianLifetimeRecoveryAttemptAnchorV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
      recoveryActorEpochSha256,
    });
  const expectedExternalHead =
    lifetime.selectCandidateContainmentGuardianLifetimeExternalHeadV1({
      lifetimeReplay: owner.replay,
      targetSha256: recoveryTarget.targetSha256,
    });
  recoveryReplay = recovery.replayCandidateContainmentRecoveryV1({
    target: recoveryTarget,
    entries: array({
      kind: "ANCHORED_EMPTY_ATTEMPT",
      lifetimeAnchorProjection:
        historicalAnchorSelection.lifetimeAnchorProjection,
      lifetimeAttemptAnchorRawSha256:
        historicalAnchorSelection.lifetimeAttemptAnchorRawSha256,
      anchoredEmptyAttempt,
      records: array(),
    }),
    expectedStateRootIdentitySha256: owner.root.identitySha256,
    expectedExternalHead,
    currentLifetimeAnchorProjection: null,
    currentLifetimeAttemptAnchorRawSha256: null,
    currentLifetimeAnchorPredecessorExternalHead: null,
    normalCloseDurabilityReceipt: null,
  });
  assert.equal(recoveryReplay.status, "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED");
  const recoveryPlan = recovery.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: recoveryTarget,
      inventory,
      replay: recoveryReplay,
      proposedActorKind: "RECOVERY_ONLY_GUARDIAN",
    }),
  );
  assert.equal(recoveryPlan.status, "RECOVERY_ANCHOR_REQUIRED");
  owner.inventoryJournalStack = journalStack;
  return {
    recoveryTarget,
    recoveryInventory: inventory,
    recoveryReplay,
    recoveryPlan,
    anchoredEmptyAttempt,
  };
}

function buildState18CloseTuple(owner, journalStack) {
  const installed = installRecoveryTargetForOwner(owner, journalStack);
  const inventory = recoveryInventory(journalStack, "closed");
  const plan = recovery.planCandidateContainmentRecoveryV1(
    recoveryPlannerInput({
      owner,
      target: installed.recoveryTarget,
      inventory,
      replay: installed.recoveryReplay,
      proposedActorKind: null,
    }),
  );
  assert.equal(plan.status, "CLOSE_MOVE_REQUIRED");
  assert.equal(plan.requiredActorKind, null);
  assert.equal(journalStack.normalJournalBundles.length, 18);
  assert.equal(
    journalStack.normalJournalBundles.at(-1).recordType,
    "CLOSED_DURABLE",
  );
  assert.equal(plan.sourceLocation, "closed");
  assert.equal(plan.requiredDestinationLocation, "closed");
  owner.inventoryJournalStack = journalStack;
  owner.inventoryGenerationParentRole = "CLOSED";
  return {
    recoveryTarget: installed.recoveryTarget,
    recoveryInventory: inventory,
    recoveryReplay: installed.recoveryReplay,
    recoveryPlan: plan,
  };
}

function statefsRegularInventoryPlan({ state, token, role, name }) {
  const values = {
    kind: "INVENTORY",
    managerActorEpochSha256: state.managerActorEpochSha256,
    requestSequence: state.nextStatefsRequestSequence,
    inventorySetSha256: token.inventorySetSha256,
    stateRootObservation: null,
    currentInventorySet: token,
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
    directoryRoleA: role,
    directoryRoleB: null,
    nameA: name,
    nameB: null,
    expectedOutcome: "INVENTORY_OBSERVED",
  };
  return statefs.planCandidateContainmentGuardianStatefsOperationV1(
    record(...STATEFS_PLANNER_INPUT_FIELDS.map((key) => [key, values[key]])),
  );
}

function regularInventoryResult(request, { role, name, bytes = null, inode }) {
  const absent = bytes === null;
  const values = {
    schema:
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: "COMPLETE",
    effectClass: "COMPLETE",
    lastCompletedStep: absent
      ? "ENTRY_REOBSERVED"
      : "INVENTORY_DESCRIPTOR_CLOSED",
    failedStep: "NONE",
    errno: 0,
    completedStepCount: absent ? 3 : 5,
    bytesConsumed: absent ? 0 : bytes.length,
    observations: array(
      nativeObservation({
        kind: absent ? "ABSENT" : "REGULAR",
        role,
        name,
        deviceMajor: absent ? "0" : "8",
        deviceMinor: absent ? "0" : "1",
        inode: absent ? "0" : inode,
        mountId: absent ? "0" : "42",
        byteLength: absent ? "0" : String(bytes.length),
        linkCount: absent ? "0" : "1",
        mode: absent ? 0 : 0o100_600,
        ownerUid: absent ? 0 : 1000,
        ownerGid: absent ? 0 : 1000,
        statxMask: absent ? 0 : 0x17ff,
        filesystemMagic: absent ? "0" : "61267",
        contentLength: absent ? 0 : bytes.length,
      }),
    ),
    outputBytes: absent ? Buffer.alloc(0) : Buffer.from(bytes),
    returnedDirectoryFd: -1,
  };
  return record(
    ...STATEFS_EXECUTOR_RESULT_FIELDS.map((key) => [key, values[key]]),
  );
}

function persistResult(request, { role, name, inode }) {
  const values = {
    schema:
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: "COMPLETE",
    effectClass: "COMPLETE",
    lastCompletedStep: "FINAL_READ_DESCRIPTOR_CLOSED",
    failedStep: "NONE",
    errno: 0,
    completedStepCount: 15,
    bytesConsumed: request.inputByteLength,
    observations: array(
      nativeObservation({
        kind: "REGULAR",
        role,
        name,
        inode,
        byteLength: String(request.inputByteLength),
        linkCount: "1",
        mode: 0o100_600,
        contentLength: 0,
      }),
    ),
    outputBytes: null,
    returnedDirectoryFd: -1,
  };
  return record(
    ...STATEFS_EXECUTOR_RESULT_FIELDS.map((key) => [key, values[key]]),
  );
}

function persistFailureResult(request, overrides) {
  const values = {
    schema:
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: "FAULT_INJECTED",
    effectClass: "DEFINITE_NO_EFFECT",
    lastCompletedStep: "FD_A_VALIDATED",
    failedStep: "TEMP_CREATED",
    errno: 5,
    completedStepCount: 2,
    bytesConsumed: 0,
    observations: array(),
    outputBytes: null,
    returnedDirectoryFd: -1,
    ...overrides,
  };
  return record(
    ...STATEFS_EXECUTOR_RESULT_FIELDS.map((key) => [key, values[key]]),
  );
}

function moveSyncResult(request) {
  const observations = array(
    nativeObservation({
      kind: "ABSENT",
      role: "ACTIVE",
      name: request.nameA,
      deviceMajor: "0",
      deviceMinor: "0",
      inode: "0",
      mountId: "0",
      byteLength: "0",
      linkCount: "0",
      mode: 0,
      ownerUid: 0,
      ownerGid: 0,
      statxMask: 0,
      filesystemMagic: "0",
    }),
    nativeObservation({
      kind: "DIRECTORY",
      role: "CLOSED",
      name: request.nameB,
      inode: "500",
    }),
  );
  const values = {
    schema:
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: "COMPLETE",
    effectClass: "COMPLETE",
    lastCompletedStep: "DESTINATION_REOBSERVED",
    failedStep: "NONE",
    errno: 0,
    completedStepCount: 9,
    bytesConsumed: 0,
    observations,
    outputBytes: null,
    returnedDirectoryFd: -1,
  };
  return record(
    ...STATEFS_EXECUTOR_RESULT_FIELDS.map((key) => [key, values[key]]),
  );
}

const CONTROL_REQUIREMENTS_SHA256 = PREDECESSORS[5][1];
const NORMAL_CONTROL_DESCRIPTOR_SPECS = array(
  record(
    ["fd", 0],
    ["role", "controllerChannel"],
    ["kind", "unix-seqpacket"],
    ["accessMode", "O_RDWR"],
    ["direction", "BIDIRECTIONAL"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", "AF_UNIX"],
    ["socketType", "SOCK_SEQPACKET"],
    ["connected", true],
    ["lockHeld", null],
  ),
  record(
    ["fd", 1],
    ["role", "statusWrite"],
    ["kind", "pipe"],
    ["accessMode", "O_WRONLY"],
    ["direction", "GUARDIAN_TO_MANAGER"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 2],
    ["role", "diagnosticsWrite"],
    ["kind", "pipe"],
    ["accessMode", "O_WRONLY"],
    ["direction", "GUARDIAN_TO_MANAGER"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 3],
    ["role", "stateRoot"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", true],
  ),
  record(
    ["fd", 4],
    ["role", "delegatedRoot"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 5],
    ["role", "guardianLifetimeCgroup"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 6],
    ["role", "epochRead"],
    ["kind", "pipe"],
    ["accessMode", "O_RDONLY"],
    ["direction", "MANAGER_TO_GUARDIAN"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 7],
    ["role", "supervisorExecutable"],
    ["kind", "regular"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE"],
    ["currentOffset", 0],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
);
const RECOVERY_CONTROL_DESCRIPTOR_SPECS = array(
  record(
    ["fd", 0],
    ["role", "recoveryRequestRead"],
    ["kind", "pipe"],
    ["accessMode", "O_RDONLY"],
    ["direction", "MANAGER_TO_GUARDIAN"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 1],
    ["role", "statusWrite"],
    ["kind", "pipe"],
    ["accessMode", "O_WRONLY"],
    ["direction", "GUARDIAN_TO_MANAGER"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 2],
    ["role", "diagnosticsWrite"],
    ["kind", "pipe"],
    ["accessMode", "O_WRONLY"],
    ["direction", "GUARDIAN_TO_MANAGER"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 3],
    ["role", "stateRoot"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", true],
  ),
  record(
    ["fd", 4],
    ["role", "delegatedRoot"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 5],
    ["role", "recoveryActorLifetimeCgroup"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  record(
    ["fd", 6],
    ["role", "epochRead"],
    ["kind", "pipe"],
    ["accessMode", "O_RDONLY"],
    ["direction", "MANAGER_TO_GUARDIAN"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ),
  null,
);

function canonicalJsonLine(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function createNormalControlPrefix(owner) {
  assert.notEqual(owner.lifetimeEpochBytes, null);
  const epochDigest = byteSha256(owner.lifetimeEpochBytes);
  assert.equal(epochDigest, owner.identity.lifetimeEpochSha256);
  const scope = record(
    [
      "schema",
      "oxigraph.candidate-containment-guardian-ofd-observation-scope/v1",
    ],
    ["requirementsSha256", CONTROL_REQUIREMENTS_SHA256],
    ["mode", "NORMAL"],
    ["epochSha256", epochDigest],
  );
  const scopeSha256 = semanticSha256(scope);
  const descriptors = NORMAL_CONTROL_DESCRIPTOR_SPECS.map((spec) => {
    const observation = record(
      ["schema", "oxigraph.candidate-containment-guardian-ofd-observation/v1"],
      ["scopeSha256", scopeSha256],
      ["equivalenceClass", spec.fd],
    );
    return record(
      ["fd", spec.fd],
      ["role", spec.role],
      ["kind", spec.kind],
      ["accessMode", spec.accessMode],
      ["closeOnExec", false],
      ["direction", spec.direction],
      ["statusFlags", spec.statusFlags],
      ["openFileDescriptionClass", spec.fd],
      ["openFileDescriptionIdentitySha256", semanticSha256(observation)],
      ["byteLength", null],
      ["contentSha256", null],
      ["launchFileIdentitySha256", null],
      ["currentOffset", spec.currentOffset],
      ["socketFamily", spec.socketFamily],
      ["socketType", spec.socketType],
      ["connected", spec.connected],
      ["lockHeld", spec.lockHeld],
    );
  });
  const report = record(
    ["schema", "oxigraph.candidate-containment-guardian-startup-report/v1"],
    ["mode", "NORMAL"],
    ["requirementsSha256", CONTROL_REQUIREMENTS_SHA256],
    ["expectedEpochSha256", epochDigest],
    ["openFileDescriptionObservationScopeSha256", scopeSha256],
    ["descriptorCount", 8],
    ...descriptors.map((descriptor, index) => [`fd${index}`, descriptor]),
  );
  const reportBytes = canonicalJsonLine(report);
  const epochBytes = Buffer.from(owner.lifetimeEpochBytes);
  const startup = control.createCandidateContainmentGuardianStartupV1(
    reportBytes,
    epochBytes,
    true,
  );
  reportBytes.fill(0);
  epochBytes.fill(0);
  const initial =
    control.initializeCandidateContainmentGuardianControlV1(startup);
  assert.equal(initial.statusFrameCount, 1);
  assert.equal(initial.statusFrame0.state, "NORMAL_READY");
  return { startup, controlState: initial.state, ready: initial.statusFrame0 };
}

function createRecoveryControlPrefix(tuple) {
  const epochDigest = byteSha256(tuple.recoveryActorEpochBytes);
  assert.equal(epochDigest, tuple.recoveryActorEpochSha256);
  const scope = record(
    [
      "schema",
      "oxigraph.candidate-containment-guardian-ofd-observation-scope/v1",
    ],
    ["requirementsSha256", CONTROL_REQUIREMENTS_SHA256],
    ["mode", "RECOVERY_ONLY"],
    ["epochSha256", epochDigest],
  );
  const scopeSha256 = semanticSha256(scope);
  const descriptors = RECOVERY_CONTROL_DESCRIPTOR_SPECS.map((spec) => {
    if (spec === null) return null;
    const observation = record(
      ["schema", "oxigraph.candidate-containment-guardian-ofd-observation/v1"],
      ["scopeSha256", scopeSha256],
      ["equivalenceClass", spec.fd],
    );
    return record(
      ["fd", spec.fd],
      ["role", spec.role],
      ["kind", spec.kind],
      ["accessMode", spec.accessMode],
      ["closeOnExec", false],
      ["direction", spec.direction],
      ["statusFlags", spec.statusFlags],
      ["openFileDescriptionClass", spec.fd],
      ["openFileDescriptionIdentitySha256", semanticSha256(observation)],
      ["byteLength", null],
      ["contentSha256", null],
      ["launchFileIdentitySha256", null],
      ["currentOffset", spec.currentOffset],
      ["socketFamily", spec.socketFamily],
      ["socketType", spec.socketType],
      ["connected", spec.connected],
      ["lockHeld", spec.lockHeld],
    );
  });
  const report = record(
    ["schema", "oxigraph.candidate-containment-guardian-startup-report/v1"],
    ["mode", "RECOVERY_ONLY"],
    ["requirementsSha256", CONTROL_REQUIREMENTS_SHA256],
    ["expectedEpochSha256", epochDigest],
    ["openFileDescriptionObservationScopeSha256", scopeSha256],
    ["descriptorCount", 7],
    ...descriptors.map((descriptor, index) => [`fd${index}`, descriptor]),
  );
  const reportBytes = canonicalJsonLine(report);
  const epochBytes = Buffer.from(tuple.recoveryActorEpochBytes);
  const startup = control.createCandidateContainmentGuardianStartupV1(
    reportBytes,
    epochBytes,
    true,
  );
  reportBytes.fill(0);
  epochBytes.fill(0);
  const initial =
    control.initializeCandidateContainmentGuardianControlV1(startup);
  assert.equal(initial.statusFrameCount, 0);
  return { startup, controlState: initial.state };
}

function recoveryRequestFrameBytes(prefix, handoffPlan) {
  const frame = record(
    ["schema", "oxigraph.candidate-containment-guardian-control-frame/v1"],
    ["action", "RECOVERY_REQUEST"],
    ["mode", "RECOVERY_ONLY"],
    ["sequence", prefix.controlState.nextWireSequence],
    ["previousFrameSha256", prefix.controlState.lastWireFrameSha256],
    ["requirementsSha256", prefix.controlState.requirementsSha256],
    ["startupSha256", prefix.controlState.startupSha256],
    ["epochSha256", prefix.controlState.epochSha256],
    ["recoverySelectionSha256", handoffPlan.recoverySelectionSha256],
    ["recoverySelection", handoffPlan.recoverySelection],
  );
  return canonicalJsonLine(frame);
}

function makeManagerStatusInput(state, startup, statusArtifact) {
  const callerBytes = statusArtifact.bytes;
  const argument = managerInputArgument({
    kind: "GUARDIAN_STATUS_FRAME",
    guardianStartupProjection: startup,
    guardianStatusFrameBytes: callerBytes,
  });
  const input = assertManagerInputProjection(
    manager.createCandidateContainmentGuardianManagerProtocolInputV1(
      state,
      argument,
    ),
    state,
    argument,
    "guardian status",
  );
  if (callerBytes.length > 0) callerBytes[0] ^= 0xff;
  return input;
}

function reduceNormalControlCancel(controlState) {
  const frame = record(
    ["schema", "oxigraph.candidate-containment-guardian-control-frame/v1"],
    ["action", "CANCEL"],
    ["mode", "NORMAL"],
    ["sequence", controlState.nextWireSequence],
    ["previousFrameSha256", controlState.lastWireFrameSha256],
    ["requirementsSha256", controlState.requirementsSha256],
    ["startupSha256", controlState.startupSha256],
    ["epochSha256", controlState.epochSha256],
    ["admissionFrameSha256", controlState.admissionFrameSha256],
  );
  const frameBytes = canonicalJsonLine(frame);
  const input = control.createCandidateContainmentGuardianCancelInputV1(
    controlState,
    frameBytes,
    false,
    false,
    0,
  );
  frameBytes.fill(0);
  const transition = control.reduceCandidateContainmentGuardianControlV1(
    controlState,
    input,
  );
  assert.equal(transition.statusFrameCount, 2);
  assert.equal(transition.statusFrame0.state, "CANCEL_REQUIRED");
  assert.equal(transition.statusFrame1.state, "CONTROL_TERMINAL");
  return transition;
}

function statefsAutoPlan({
  state,
  token,
  owner,
  recordCount = owner.records.length,
  artifactBytes = null,
  generationManifest = null,
  normalJournalBundles = null,
  recoveryTarget = null,
  recoveryInventory = null,
  recoveryReplay = null,
  recoveryPlan = null,
  recoveryAttempt = null,
  recoveryRecord = null,
}) {
  const values = {
    kind: "AUTO",
    managerActorEpochSha256: state.managerActorEpochSha256,
    requestSequence: state.nextStatefsRequestSequence,
    inventorySetSha256: token.inventorySetSha256,
    stateRootObservation: null,
    currentInventorySet: token,
    unresolvedReceipt: null,
    generationManifest,
    normalJournalBundles,
    lifetimeReplayArguments: lifetimeReplayArguments(owner, recordCount),
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
  };
  return statefs.planCandidateContainmentGuardianStatefsOperationV1(
    record(...STATEFS_PLANNER_INPUT_FIELDS.map((key) => [key, values[key]])),
  );
}

function acceptDirectoryInventory({
  state,
  token,
  role,
  parentRole,
  name = null,
  inode,
  entries = array(),
  returnedDirectoryFd = -1,
  label,
}) {
  const plan = statefsInventoryPlan({
    state,
    token,
    role,
    parentRole,
    name,
  });
  const operation = acceptPlan(state, plan, `${label} plan`);
  const receipt = dispatchStatefsRequest(
    plan,
    directoryInventoryResult(plan.request, {
      role,
      inode,
      entries,
      returnedDirectoryFd,
    }),
  );
  const accepted = acceptReceipt(operation.state, receipt, `${label} receipt`);
  return { state: accepted.state, token: receipt.inventorySet, plan, receipt };
}

function acceptRegularInventory({
  state,
  token,
  role,
  name,
  bytes,
  inode,
  label,
}) {
  const plan = statefsRegularInventoryPlan({ state, token, role, name });
  const operation = acceptPlan(state, plan, `${label} plan`);
  const receipt = dispatchStatefsRequest(
    plan,
    regularInventoryResult(plan.request, { role, name, bytes, inode }),
  );
  const accepted = acceptReceipt(operation.state, receipt, `${label} receipt`);
  return { state: accepted.state, token: receipt.inventorySet };
}

function acceptDirectoryRelease({ state, token, role, label }) {
  const plan = statefsReleasePlan({ state, token, role });
  const operation = acceptPlan(state, plan, `${label} plan`);
  const receipt = dispatchStatefsRequest(plan, releaseResult(plan.request));
  const accepted = acceptReceipt(operation.state, receipt, `${label} receipt`);
  return { state: accepted.state, token: receipt.inventorySet, plan, receipt };
}

function inventoryGenerationTree({
  state,
  token,
  owner,
  parentRole,
  parentName,
  parentInode,
  label,
}) {
  const journalStack = owner.inventoryJournalStack;
  const generationName = journalStack.generationIdentity.identitySha256;
  ({ state, token } = acceptDirectoryInventory({
    state,
    token,
    role: parentRole,
    parentRole: "STATE_ROOT",
    name: parentName,
    inode: parentInode,
    entries: array(array(generationName, "GENERATION", "500")),
    returnedDirectoryFd: 70,
    label: `${label} ${parentName}`,
  }));
  ({ state, token } = acceptDirectoryInventory({
    state,
    token,
    role: "GENERATION",
    parentRole,
    name: generationName,
    inode: "500",
    entries: array(
      record(
        ["kind", "REGULAR"],
        ["name", "generation.jsonl"],
        ["inode", "503"],
        ["byteLength", String(journalStack.generationManifest.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      ),
      array("normal", "NORMAL_JOURNAL", "501"),
      array("recovery", "RECOVERY_JOURNAL", "502"),
    ),
    returnedDirectoryFd: 71,
    label: `${label} generation`,
  }));
  ({ state, token } = acceptRegularInventory({
    state,
    token,
    role: "GENERATION",
    name: "generation.jsonl",
    bytes: journalStack.generationManifest.bytes,
    inode: "503",
    label: `${label} generation manifest`,
  }));
  const normalEntries = array(
    ...journalStack.normalJournalBundles.map((bundle, index) =>
      record(
        ["kind", "REGULAR"],
        ["name", bundle.name],
        ["inode", String(600 + index)],
        ["byteLength", String(bundle.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      ),
    ),
  );
  ({ state, token } = acceptDirectoryInventory({
    state,
    token,
    role: "NORMAL_JOURNAL",
    parentRole: "GENERATION",
    name: "normal",
    inode: "501",
    entries: normalEntries,
    returnedDirectoryFd: 72,
    label: `${label} normal journal`,
  }));
  for (const [index, bundle] of journalStack.normalJournalBundles.entries()) {
    ({ state, token } = acceptRegularInventory({
      state,
      token,
      role: "NORMAL_JOURNAL",
      name: bundle.name,
      bytes: bundle.bytes,
      inode: String(600 + index),
      label: `${label} normal record ${bundle.name}`,
    }));
  }
  ({ state, token } = acceptDirectoryRelease({
    state,
    token,
    role: "NORMAL_JOURNAL",
    label: `${label} normal release`,
  }));
  const recoveryEntries =
    owner.inventoryRecoveryAttempt === undefined
      ? array()
      : array(
          array(
            owner.inventoryRecoveryAttempt.attemptDirectoryName,
            "RECOVERY_ATTEMPT",
            "504",
          ),
        );
  ({ state, token } = acceptDirectoryInventory({
    state,
    token,
    role: "RECOVERY_JOURNAL",
    parentRole: "GENERATION",
    name: "recovery",
    inode: "502",
    entries: recoveryEntries,
    returnedDirectoryFd: 73,
    label: `${label} recovery journal`,
  }));
  if (owner.inventoryRecoveryAttempt !== undefined) {
    ({ state, token } = acceptDirectoryInventory({
      state,
      token,
      role: "RECOVERY_ATTEMPT",
      parentRole: "RECOVERY_JOURNAL",
      name: owner.inventoryRecoveryAttempt.attemptDirectoryName,
      inode: "504",
      returnedDirectoryFd: 74,
      label: `${label} recovery attempt`,
    }));
    ({ state, token } = acceptDirectoryRelease({
      state,
      token,
      role: "RECOVERY_ATTEMPT",
      label: `${label} recovery attempt release`,
    }));
  }
  for (const role of ["RECOVERY_JOURNAL", "GENERATION", parentRole]) {
    ({ state, token } = acceptDirectoryRelease({
      state,
      token,
      role,
      label: `${label} ${role.toLowerCase()} release`,
    }));
  }
  return { state, token };
}

function inventoryLifetimeOwner(label, createOwner) {
  let { state, token } = enterInventory(label);
  const root = heldStateRootObservation();
  const owner = createOwner({
    label,
    root,
    managerActorEpochSha256: state.managerActorEpochSha256,
  });
  ({ state, token } = acceptDirectoryInventory({
    state,
    token,
    role: "STATE_ROOT",
    parentRole: "STATE_ROOT",
    inode: "100",
    entries: ROOT_CHILDREN,
    label: `${label} root`,
  }));
  ({ state, token } = acceptDirectoryInventory({
    state,
    token,
    role: "LIFETIMES",
    parentRole: "STATE_ROOT",
    name: "lifetimes",
    inode: "101",
    entries: array(
      array(owner.identity.identitySha256, "LIFETIME_SEGMENT", "201"),
    ),
    returnedDirectoryFd: 51,
    label: `${label} lifetimes`,
  }));
  const visibleRecords = owner.records.slice(
    0,
    owner.inventoryRecordCount ?? owner.records.length,
  );
  const recordEntries = array(
    ...visibleRecords.map((entry, index) =>
      record(
        ["kind", "REGULAR"],
        ["name", entry.name],
        ["inode", String(300 + index)],
        ["byteLength", String(entry.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      ),
    ),
  );
  ({ state, token } = acceptDirectoryInventory({
    state,
    token,
    role: "LIFETIME_SEGMENT",
    parentRole: "LIFETIMES",
    name: owner.identity.identitySha256,
    inode: "201",
    entries: recordEntries,
    returnedDirectoryFd: 52,
    label: `${label} segment`,
  }));
  for (const [index, entry] of visibleRecords.entries()) {
    ({ state, token } = acceptRegularInventory({
      state,
      token,
      role: "LIFETIME_SEGMENT",
      name: entry.name,
      bytes: entry.bytes,
      inode: String(300 + index),
      label: `${label} record ${entry.name}`,
    }));
  }
  ({ state, token } = acceptDirectoryRelease({
    state,
    token,
    role: "LIFETIME_SEGMENT",
    label: `${label} segment release`,
  }));
  ({ state, token } = acceptDirectoryRelease({
    state,
    token,
    role: "LIFETIMES",
    label: `${label} lifetimes release`,
  }));
  for (const [index, [name, role, inode]] of ROOT_CHILDREN.slice(1).entries()) {
    if (
      role === (owner.inventoryGenerationParentRole ?? "ACTIVE") &&
      owner.inventoryJournalStack !== undefined
    ) {
      ({ state, token } = inventoryGenerationTree({
        state,
        token,
        owner,
        parentRole: role,
        parentName: name,
        parentInode: inode,
        label,
      }));
      continue;
    }
    ({ state, token } = acceptDirectoryInventory({
      state,
      token,
      role,
      parentRole: "STATE_ROOT",
      name,
      inode,
      returnedDirectoryFd: 60 + index,
      label: `${label} ${name}`,
    }));
    ({ state, token } = acceptDirectoryRelease({
      state,
      token,
      role,
      label: `${label} ${name} release`,
    }));
  }
  assert.equal(state.status, "REPLAY_REQUIRED");
  assert.equal(state.inventoryComplete, true);
  assert.equal(state.activeDirectoryHandleCount, 1);
  return { owner, state, token };
}

function lifetimeSegmentDirectoryEntries(owner) {
  const visibleRecords = owner.records.slice(
    0,
    owner.inventoryRecordCount ?? owner.records.length,
  );
  return array(
    ...visibleRecords.map((entry, index) =>
      record(
        ["kind", "REGULAR"],
        ["name", entry.name],
        ["inode", String(300 + index)],
        ["byteLength", String(entry.bytes.length)],
        ["linkCount", "1"],
        ["mode", 0o100_600],
      ),
    ),
  );
}

function reopenLifetimeSegment({ state, token, owner, label }) {
  expectCode(
    () =>
      statefsInventoryPlan({
        state,
        token,
        role: "LIFETIME_SEGMENT",
        parentRole: "LIFETIMES",
        name: owner.identity.identitySha256,
      }),
    "STATEFS_BINDING",
  );

  const rootOnlyToken = token;
  const rootOnlyState = state;
  let reopened = acceptDirectoryInventory({
    state,
    token,
    role: "LIFETIMES",
    parentRole: "STATE_ROOT",
    name: "lifetimes",
    inode: "101",
    entries: array(
      array(owner.identity.identitySha256, "LIFETIME_SEGMENT", "201"),
    ),
    returnedDirectoryFd: 151,
    label: `${label} reopen lifetimes`,
  });
  assert.equal(reopened.plan.inventorySet, rootOnlyToken);
  assert.equal(reopened.plan.request.inventorySet, rootOnlyToken);
  assert.equal(
    reopened.plan.request.requestSequence,
    rootOnlyState.nextStatefsRequestSequence,
  );
  expectCode(
    () =>
      statefs.assertCandidateContainmentGuardianStatefsPlanV1(reopened.plan),
    "STATEFS_BINDING",
  );
  assert.equal(reopened.state.status, "REPLAY_REQUIRED");
  assert.equal(reopened.state.inventoryComplete, true);
  assert.equal(reopened.state.activeDirectoryHandleCount, 2);
  expectCode(
    () =>
      statefsInventoryPlan({
        state: reopened.state,
        token: rootOnlyToken,
        role: "LIFETIME_SEGMENT",
        parentRole: "LIFETIMES",
        name: owner.identity.identitySha256,
      }),
    "STATEFS_BINDING",
  );

  ({ state, token } = reopened);
  const lifetimesToken = token;
  const lifetimesState = state;
  reopened = acceptDirectoryInventory({
    state,
    token,
    role: "LIFETIME_SEGMENT",
    parentRole: "LIFETIMES",
    name: owner.identity.identitySha256,
    inode: "201",
    entries: lifetimeSegmentDirectoryEntries(owner),
    returnedDirectoryFd: 152,
    label: `${label} reopen lifetime segment`,
  });
  assert.equal(reopened.plan.inventorySet, lifetimesToken);
  assert.equal(reopened.plan.request.inventorySet, lifetimesToken);
  assert.equal(
    reopened.plan.request.requestSequence,
    lifetimesState.nextStatefsRequestSequence,
  );
  expectCode(
    () =>
      statefs.assertCandidateContainmentGuardianStatefsPlanV1(reopened.plan),
    "STATEFS_BINDING",
  );
  expectCode(
    () =>
      statefsReleasePlan({
        state: reopened.state,
        token: lifetimesToken,
        role: "LIFETIME_SEGMENT",
      }),
    "STATEFS_BINDING",
  );
  assert.equal(reopened.state.status, "REPLAY_REQUIRED");
  assert.equal(reopened.state.inventoryComplete, true);
  assert.equal(reopened.state.activeDirectoryHandleCount, 3);
  return { state: reopened.state, token: reopened.token };
}

function closeLifetimeSegment({ state, token, label }) {
  let closed = acceptDirectoryRelease({
    state,
    token,
    role: "LIFETIME_SEGMENT",
    label: `${label} close lifetime segment`,
  });
  assert.equal(closed.state.status, "REPLAY_REQUIRED");
  assert.equal(closed.state.inventoryComplete, true);
  assert.equal(closed.state.activeDirectoryHandleCount, 2);
  expectCode(
    () => statefs.assertCandidateContainmentGuardianStatefsPlanV1(closed.plan),
    "STATEFS_BINDING",
  );
  expectCode(
    () =>
      statefsReleasePlan({
        state: closed.state,
        token,
        role: "LIFETIMES",
      }),
    "STATEFS_BINDING",
  );
  ({ state, token } = closed);
  closed = acceptDirectoryRelease({
    state,
    token,
    role: "LIFETIMES",
    label: `${label} close lifetimes`,
  });
  assert.equal(closed.state.status, "REPLAY_REQUIRED");
  assert.equal(closed.state.inventoryComplete, true);
  assert.equal(closed.state.activeDirectoryHandleCount, 1);
  expectCode(
    () => statefs.assertCandidateContainmentGuardianStatefsPlanV1(closed.plan),
    "STATEFS_BINDING",
  );
  expectCode(
    () =>
      statefsReleasePlan({
        state: closed.state,
        token: closed.token,
        role: "LIFETIMES",
      }),
    "STATEFS_BINDING",
  );
  return { state: closed.state, token: closed.token };
}

function reopenState18MoveParents({ state, token, owner, label }) {
  const generationName =
    owner.inventoryJournalStack.generationIdentity.identitySha256;
  let reopened = acceptDirectoryInventory({
    state,
    token,
    role: "ACTIVE",
    parentRole: "STATE_ROOT",
    name: "active",
    inode: "103",
    returnedDirectoryFd: 153,
    label: `${label} reopen active`,
  });
  assert.equal(reopened.state.activeDirectoryHandleCount, 2);
  ({ state, token } = reopened);
  reopened = acceptDirectoryInventory({
    state,
    token,
    role: "CLOSED",
    parentRole: "STATE_ROOT",
    name: "closed",
    inode: "104",
    entries: array(array(generationName, "GENERATION", "500")),
    returnedDirectoryFd: 154,
    label: `${label} reopen closed`,
  });
  assert.equal(reopened.state.status, "REPLAY_REQUIRED");
  assert.equal(reopened.state.inventoryComplete, true);
  assert.equal(reopened.state.activeDirectoryHandleCount, 3);
  return { state: reopened.state, token: reopened.token };
}

function closeState18MoveParents({ state, token, label }) {
  let closed = acceptDirectoryRelease({
    state,
    token,
    role: "CLOSED",
    label: `${label} close closed`,
  });
  assert.equal(closed.state.activeDirectoryHandleCount, 2);
  ({ state, token } = closed);
  closed = acceptDirectoryRelease({
    state,
    token,
    role: "ACTIVE",
    label: `${label} close active`,
  });
  assert.equal(closed.state.status, "REPLAY_REQUIRED");
  assert.equal(closed.state.inventoryComplete, true);
  assert.equal(closed.state.activeDirectoryHandleCount, 1);
  return { state: closed.state, token: closed.token };
}

function preparePersistOperation(label) {
  let pendingRecord = null;
  const createPendingOwner = (options) => {
    const owner = createLifetimeOwner(options);
    pendingRecord = owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
    owner.inventoryRecordCount = 0;
    return owner;
  };
  let { owner, state, token } = inventoryLifetimeOwner(
    label,
    createPendingOwner,
  );
  ({ state, token } = reopenLifetimeSegment({
    state,
    token,
    owner,
    label,
  }));
  const inventoryPlan = statefsRegularInventoryPlan({
    state,
    token,
    role: "LIFETIME_SEGMENT",
    name: pendingRecord.name,
  });
  const inventoryOperation = acceptPlan(
    state,
    inventoryPlan,
    `${label} T11 absent plan`,
  );
  const inventoryReceipt = dispatchStatefsRequest(
    inventoryPlan,
    regularInventoryResult(inventoryPlan.request, {
      role: "LIFETIME_SEGMENT",
      name: pendingRecord.name,
      inode: "0",
    }),
  );
  const replay = acceptReceipt(
    inventoryOperation.state,
    inventoryReceipt,
    `${label} T12 absent receipt`,
  );
  state = replay.state;
  token = inventoryReceipt.inventorySet;
  const plan = statefsAutoPlan({
    state,
    token,
    owner,
    recordCount: 0,
    artifactBytes: pendingRecord.bytes,
  });
  assert.equal(plan.request.operation, "PERSIST_NOREPLACE");
  const operation = acceptPlan(state, plan, `${label} T11 persist plan`);
  return { owner, pendingRecord, state: operation.state, token, plan };
}

candidateTest(
  "StateFS rejects a non-top release without consuming the token before an exact top release",
  () => {
    let { state, token } = enterInventory("release-stack-binding");
    ({ state, token } = acceptDirectoryInventory({
      state,
      token,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
      inode: "100",
      entries: ROOT_CHILDREN,
      label: "release-stack-binding root",
    }));
    const segmentName = digest("release-stack-binding segment");
    ({ state, token } = acceptDirectoryInventory({
      state,
      token,
      role: "LIFETIMES",
      parentRole: "STATE_ROOT",
      name: "lifetimes",
      inode: "101",
      entries: array(array(segmentName, "LIFETIME_SEGMENT", "201")),
      returnedDirectoryFd: 51,
      label: "release-stack-binding lifetimes",
    }));
    ({ state, token } = acceptDirectoryInventory({
      state,
      token,
      role: "LIFETIME_SEGMENT",
      parentRole: "LIFETIMES",
      name: segmentName,
      inode: "201",
      returnedDirectoryFd: 52,
      label: "release-stack-binding segment",
    }));
    assert.equal(state.activeDirectoryHandleCount, 3);

    expectCode(
      () =>
        statefsReleasePlan({
          state,
          token,
          role: "LIFETIMES",
        }),
      "STATEFS_BINDING",
    );

    const topPlan = statefsReleasePlan({
      state,
      token,
      role: "LIFETIME_SEGMENT",
    });
    const topOperation = acceptPlan(
      state,
      topPlan,
      "release-stack-binding exact top after rejected non-top release",
    );
    assert.equal(
      topOperation.state.permittedStatefsOperation,
      "RELEASE_DIRECTORY",
    );
    assert.equal(topOperation.state.activeDirectoryHandleCount, 3);
  },
);

candidateTest(
  "T04-T06 and T09-T10 traverse six directories depth-first with exact handle push/pop",
  () => {
    let { state, token } = enterInventory("complete-traversal");
    const rootPlan = statefsInventoryPlan({
      state,
      token,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    const rootOperation = acceptPlan(state, rootPlan, "T04 root plan");
    const rootReceipt = dispatchStatefsRequest(
      rootPlan,
      directoryInventoryResult(rootPlan.request, {
        role: "STATE_ROOT",
        inode: "100",
        entries: ROOT_CHILDREN,
      }),
    );
    const rootAccepted = acceptReceipt(
      rootOperation.state,
      rootReceipt,
      "T06 root receipt",
    );
    state = rootAccepted.state;
    token = rootReceipt.inventorySet;
    assert.equal(state.status, "INVENTORY_REQUIRED");
    assert.equal(state.inventoryRequestCount, 1);
    assert.equal(state.activeDirectoryHandleCount, 1);
    assert.equal(state.inventoryComplete, false);

    for (const [index, [name, role, inode]] of ROOT_CHILDREN.entries()) {
      const childPlan = statefsInventoryPlan({
        state,
        token,
        role,
        parentRole: "STATE_ROOT",
        name,
      });
      const childOperation = acceptPlan(state, childPlan, `T04 child ${name}`);
      const childReceipt = dispatchStatefsRequest(
        childPlan,
        directoryInventoryResult(childPlan.request, {
          role,
          inode,
          returnedDirectoryFd: 50 + index,
        }),
      );
      const childAccepted = acceptReceipt(
        childOperation.state,
        childReceipt,
        `T06 child ${name}`,
      );
      state = childAccepted.state;
      token = childReceipt.inventorySet;
      assert.equal(state.status, "INVENTORY_REQUIRED");
      assert.equal(state.activeDirectoryHandleCount, 2);
      assert.equal(state.inventoryRequestCount, index + 2);

      const releasePlan = statefsReleasePlan({ state, token, role });
      const releaseOperation = acceptPlan(
        state,
        releasePlan,
        `T05 release ${name}`,
      );
      const releaseReceipt = dispatchStatefsRequest(
        releasePlan,
        releaseResult(releasePlan.request),
      );
      const released = acceptReceipt(
        releaseOperation.state,
        releaseReceipt,
        index === ROOT_CHILDREN.length - 1
          ? "T10 final release"
          : "T09 release",
      );
      state = released.state;
      token = releaseReceipt.inventorySet;
      assert.equal(state.activeDirectoryHandleCount, 1);
      assert.equal(state.inventoryRequestCount, index + 2);
      assert.equal(
        state.status,
        index === ROOT_CHILDREN.length - 1
          ? "REPLAY_REQUIRED"
          : "INVENTORY_REQUIRED",
      );
    }
    assert.equal(state.sequence, 28);
    assert.equal(state.nextStatefsRequestSequence, 14);
    assert.equal(state.inventoryRequestCount, 7);
    assert.equal(state.inventoryComplete, true);
    assert.equal(state.inventorySetSha256, token.inventorySetSha256);
  },
);

candidateTest(
  "StateFS rejects an empty STATE_ROOT before manager consumption, then a valid six-root operation advances",
  () => {
    const invalid = enterInventory("empty-root-rejected");
    const invalidPlan = statefsInventoryPlan({
      state: invalid.state,
      token: invalid.token,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    const rejectedReceipt = dispatchStatefsRequest(
      invalidPlan,
      directoryInventoryResult(invalidPlan.request, {
        role: "STATE_ROOT",
        inode: "100",
        entries: array(),
      }),
    );
    assert.equal(rejectedReceipt.outcome, "REJECTED");
    assert.equal(rejectedReceipt.retryDisposition, "NO_RETRY");
    assert.equal(rejectedReceipt.inventorySetSha256, null);
    assert.equal(rejectedReceipt.inventorySet, null);
    assert.equal(
      statefs.assertCandidateContainmentGuardianStatefsPlanV1(invalidPlan),
      invalidPlan.ownerContext,
      "StateFS rejection never crosses or consumes the manager plan boundary",
    );

    const valid = enterInventory("valid-root-after-empty-rejection");
    const traversal = acceptDirectoryInventory({
      state: valid.state,
      token: valid.token,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
      inode: "100",
      entries: ROOT_CHILDREN,
      label: "valid six-root inventory",
    });
    assert.equal(traversal.state.status, "INVENTORY_REQUIRED");
    assert.equal(traversal.state.inventoryRequestCount, 1);
    assert.equal(traversal.state.inventoryComplete, false);
    assert.equal(traversal.state.activeDirectoryHandleCount, 1);
    assert.equal(
      traversal.state.inventorySetSha256,
      traversal.token.inventorySetSha256,
    );
  },
);

candidateTest(
  "T08 unsafe inventory is terminal INVENTORY_BLOCKED and clears the private token",
  () => {
    let { state, token } = enterInventory("unsafe-root-inventory");
    const plan = statefsInventoryPlan({
      state,
      token,
      role: "STATE_ROOT",
      parentRole: "STATE_ROOT",
    });
    const operation = acceptPlan(state, plan, "unsafe inventory plan");
    const result = directoryInventoryResult(plan.request, {
      role: "STATE_ROOT",
      inode: "100",
      entries: array(array("unexpected", "NONE", "901")),
    });
    const receipt = dispatchStatefsRequest(plan, result);
    assert.equal(receipt.outcome, "REJECTED");
    assert.equal(receipt.retryDisposition, "NO_RETRY");
    assert.equal(receipt.inventorySet, null);
    const forgedSuccessorReceipt = record(
      ...Object.entries(receipt),
      ["inventorySetSha256", token.inventorySetSha256],
      ["inventorySet", token],
    );
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerProtocolInputV1(
          operation.state,
          managerInputArgument({
            kind: "STATEFS_RECEIPT",
            statefsReceipt: forgedSuccessorReceipt,
          }),
        ),
      "MANAGER_PREDECESSOR",
    );
    const blocked = acceptReceipt(
      operation.state,
      receipt,
      "T08 blocked inventory",
    );
    state = blocked.state;
    assert.equal(state.status, "INVENTORY_BLOCKED");
    assert.equal(state.inventorySetSha256, null);
    assert.equal(state.inventoryComplete, false);
    assert.equal(state.activeDirectoryHandleCount, 1);
    assert.equal(state.unresolvedEffect, false);
    assert.equal(state.retryPermitted, false);
    assert.equal(state.terminal, true);
  },
);

candidateTest(
  "T11-T12-T17 reobserve an absent final before one exact service-manager persistence",
  () => {
    let pendingRecord = null;
    const createPendingOwner = (options) => {
      const owner = createLifetimeOwner(options);
      pendingRecord = owner.append("NORMAL_LIFETIME_EPOCH_CONSUMED");
      owner.inventoryRecordCount = 0;
      return owner;
    };
    let { owner, state, token } = inventoryLifetimeOwner(
      "persist-first-record",
      createPendingOwner,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "persist-first-record",
    }));
    assert.notEqual(pendingRecord, null);
    const inventoryPlan = statefsRegularInventoryPlan({
      state,
      token,
      role: "LIFETIME_SEGMENT",
      name: pendingRecord.name,
    });
    assert.equal(inventoryPlan.managerDisposition, "STATEFS_REQUEST");
    assert.equal(inventoryPlan.request.operation, "INVENTORY");
    assert.equal(inventoryPlan.request.inventoryKind, "REGULAR_FILE");
    assert.equal(inventoryPlan.request.nameA, pendingRecord.name);
    let operation = acceptPlan(state, inventoryPlan, "T11 missing record plan");
    let receipt = dispatchStatefsRequest(
      inventoryPlan,
      regularInventoryResult(inventoryPlan.request, {
        role: "LIFETIME_SEGMENT",
        name: pendingRecord.name,
        inode: "0",
      }),
    );
    let replay = acceptReceipt(
      operation.state,
      receipt,
      "T12 absent record receipt",
    );
    state = replay.state;
    token = receipt.inventorySet;
    assert.equal(state.status, "REPLAY_REQUIRED");
    assert.equal(state.inventoryComplete, true);

    const callerBytes = Buffer.from(pendingRecord.bytes);
    const persistPlan = statefsAutoPlan({
      state,
      token,
      owner,
      recordCount: 0,
      artifactBytes: callerBytes,
    });
    callerBytes.fill(0);
    assert.equal(persistPlan.managerDisposition, "STATEFS_REQUEST");
    assert.equal(persistPlan.request.operation, "PERSIST_NOREPLACE");
    assert.equal(persistPlan.request.writerKind, "SERVICE_MANAGER");
    assert.equal(persistPlan.request.actorKind, null);
    assert.deepEqual(persistPlan.request.bytes, pendingRecord.bytes);
    operation = acceptPlan(state, persistPlan, "T11 persist plan");
    receipt = dispatchStatefsRequest(
      persistPlan,
      persistResult(persistPlan.request, {
        role: "LIFETIME_SEGMENT",
        name: pendingRecord.name,
        inode: "301",
      }),
    );
    assert.equal(receipt.outcome, "PERSISTED");
    replay = acceptReceipt(operation.state, receipt, "T17 persisted receipt");
    state = replay.state;
    assert.equal(state.status, "REPLAY_REQUIRED");
    assert.equal(state.writerKind, "SERVICE_MANAGER");
    assert.equal(state.actorKind, null);
    assert.equal(state.inventoryComplete, true);
    assert.equal(state.retryPermitted, false);
    assert.equal(state.unresolvedEffect, false);
    assert.equal(state.terminal, false);
    assert.equal(
      state.inventorySetSha256,
      receipt.inventorySet.inventorySetSha256,
    );
    ({ state, token } = closeLifetimeSegment({
      state,
      token: receipt.inventorySet,
      label: "persist-first-record",
    }));
    assert.equal(state.activeDirectoryHandleCount, 1);
    assert.equal(state.inventorySetSha256, token.inventorySetSha256);
  },
);

candidateTest(
  "T18 definite-no-effect persistence permits only fresh inventory replan",
  () => {
    const { pendingRecord, state, plan } = preparePersistOperation(
      "persist-definite-no-effect",
    );
    const receipt = dispatchStatefsRequest(
      plan,
      persistFailureResult(plan.request, {}),
    );
    assert.equal(receipt.outcome, "FAILED_DEFINITE_NO_EFFECT");
    assert.equal(receipt.retryDisposition, "REPLAN_AFTER_FRESH_INVENTORY");
    assert.notEqual(receipt.inventorySet, null);
    const replan = acceptReceipt(state, receipt, "T18 fresh inventory replan");
    assert.equal(replan.state.status, "INVENTORY_REQUIRED");
    assert.equal(replan.state.writerKind, "SERVICE_MANAGER");
    assert.equal(replan.state.actorKind, null);
    assert.equal(replan.state.targetSha256, pendingRecord.targetSha256);
    assert.equal(replan.state.permittedStatefsOperation, "INVENTORY");
    assert.equal(replan.state.inventoryRequestCount, 0);
    assert.equal(replan.state.inventoryComplete, false);
    assert.equal(replan.state.activeDirectoryHandleCount, 1);
    assert.equal(replan.state.unresolvedEffect, false);
    assert.equal(replan.state.retryPermitted, true);
    assert.equal(replan.state.terminal, false);
  },
);

candidateTest(
  "T19 partially observed persistence is terminal EFFECT_UNCERTAIN without successor authority",
  () => {
    const { pendingRecord, state, plan } = preparePersistOperation(
      "persist-effect-uncertain",
    );
    const receipt = dispatchStatefsRequest(
      plan,
      persistFailureResult(plan.request, {
        effectClass: "MUTATION_OBSERVED_NOT_FULLY_SYNCED",
        lastCompletedStep: "TEMP_CREATED",
        failedStep: "NONE",
        completedStepCount: 3,
      }),
    );
    assert.equal(receipt.outcome, "FAILED_MUTATION_NOT_FULLY_SYNCED");
    assert.equal(receipt.retryDisposition, "NO_RETRY");
    assert.equal(receipt.inventorySet, null);
    const forgedSuccessorReceipt = record(
      ...Object.entries(receipt),
      ["inventorySetSha256", plan.inventorySet.inventorySetSha256],
      ["inventorySet", plan.inventorySet],
    );
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerProtocolInputV1(
          state,
          managerInputArgument({
            kind: "STATEFS_RECEIPT",
            statefsReceipt: forgedSuccessorReceipt,
          }),
        ),
      "MANAGER_PREDECESSOR",
    );
    const uncertain = acceptReceipt(state, receipt, "T19 uncertain receipt");
    assert.equal(uncertain.state.status, "EFFECT_UNCERTAIN");
    assert.equal(uncertain.state.targetSha256, pendingRecord.targetSha256);
    assert.equal(uncertain.state.inventorySetSha256, null);
    assert.equal(uncertain.state.inventoryComplete, false);
    assert.equal(uncertain.state.activeDirectoryHandleCount, 1);
    assert.equal(uncertain.state.unresolvedEffect, true);
    assert.equal(uncertain.state.retryPermitted, false);
    assert.equal(uncertain.state.terminal, true);
  },
);

candidateTest(
  "T20 a rejected non-inventory request terminates without retry or successor authority",
  () => {
    const { pendingRecord, state, plan } =
      preparePersistOperation("persist-rejected");
    const receipt = dispatchStatefsRequest(
      plan,
      persistFailureResult(plan.request, {
        status: "LIMIT_EXCEEDED",
        effectClass: "NO_EFFECT",
        lastCompletedStep: "NONE",
        failedStep: "REQUEST_VALIDATED",
        errno: 0,
        completedStepCount: 0,
      }),
    );
    assert.equal(receipt.outcome, "REJECTED");
    assert.equal(receipt.retryDisposition, "NO_RETRY");
    assert.equal(receipt.inventorySet, null);
    const terminal = acceptReceipt(state, receipt, "T20 rejected receipt");
    assert.equal(terminal.state.status, "TERMINAL");
    assert.equal(terminal.state.targetSha256, pendingRecord.targetSha256);
    assert.equal(terminal.state.inventorySetSha256, null);
    assert.equal(terminal.state.inventoryComplete, false);
    assert.equal(terminal.state.activeDirectoryHandleCount, 1);
    assert.equal(terminal.state.unresolvedEffect, false);
    assert.equal(terminal.state.retryPermitted, false);
    assert.equal(terminal.state.terminal, true);
  },
);

candidateTest(
  "T13 normal handoff copies only the selected service-manager/live-birth boundary",
  () => {
    let { owner, state, token } = inventoryLifetimeOwner(
      "normal-handoff",
      createNormalHandoffOwner,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "normal-handoff",
    }));
    const plan = statefsAutoPlan({ state, token, owner });
    assert.equal(plan.planKind, "CONTEXT_ONLY");
    assert.equal(plan.managerDisposition, "GUARDIAN_HANDOFF");
    assert.equal(plan.writerKind, "SERVICE_MANAGER");
    assert.equal(plan.actorKind, "LIVE_BIRTH_GUARDIAN");
    assert.equal(plan.guardianAction, "NORMAL_CONTROL_HANDOFF");
    const handoff = acceptPlan(state, plan, "T13 normal handoff");
    assert.equal(handoff.state.status, "GUARDIAN_HANDOFF_REQUIRED");
    assert.equal(handoff.state.writerKind, "SERVICE_MANAGER");
    assert.equal(handoff.state.actorKind, "LIVE_BIRTH_GUARDIAN");
    assert.equal(
      handoff.state.permittedGuardianAction,
      "NORMAL_CONTROL_HANDOFF",
    );
    assert.equal(handoff.state.inventorySetSha256, token.inventorySetSha256);
    assert.equal(handoff.state.inventoryComplete, true);
    assert.notEqual(handoff.guardianHandoffPlan, null);
    assertExactFields(
      handoff.guardianHandoffPlan,
      HANDOFF_PLAN_FIELDS,
      "normal guardian handoff plan",
    );
    assert.equal(handoff.guardianHandoffPlan.mode, "NORMAL");
    assert.equal(
      handoff.guardianHandoffPlan.lifetimeEpochSha256,
      owner.identity.lifetimeEpochSha256,
    );
    assert.equal(handoff.guardianHandoffPlan.targetSha256, null);
    assert.equal(handoff.guardianHandoffPlan.recoveryActorEpochSha256, null);
    assert.deepEqual(handoff.guardianHandoffPlan.descriptorRoles, [
      "controllerChannel",
      "statusWrite",
      "diagnosticsWrite",
      "stateRoot",
      "delegatedRoot",
      "guardianLifetimeCgroup",
      "epochRead",
      "supervisorExecutable",
    ]);
    assert.equal(handoff.guardianHandoffPlan.recoverySelection, null);
    assert.equal(handoff.guardianHandoffPlan.recoverySelectionSha256, null);
    assertClaims(handoff.guardianHandoffPlan, "normal guardian handoff plan");
  },
);

candidateTest(
  "T22-T24-T25 bind the exact normal guardian wire prefix and reset it only at terminal",
  () => {
    let { owner, state, token } = inventoryLifetimeOwner(
      "normal-wire-prefix",
      createNormalHandoffOwner,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "normal-wire-prefix",
    }));
    const plan = statefsAutoPlan({ state, token, owner });
    const handoff = acceptPlan(state, plan, "T13 normal wire handoff");
    const outOfScenarioPrefix = createNormalControlPrefix(owner);
    const outOfScenarioCancel = reduceNormalControlCancel(
      outOfScenarioPrefix.controlState,
    );
    expectCode(() => {
      const input = makeManagerStatusInput(
        handoff.state,
        outOfScenarioPrefix.startup,
        outOfScenarioCancel.statusFrame0,
      );
      manager.reduceCandidateContainmentGuardianManagerProtocolV1(
        handoff.state,
        input,
      );
    }, "MANAGER_BINDING");
    const prefix = createNormalControlPrefix(owner);
    const readyInput = makeManagerStatusInput(
      handoff.state,
      prefix.startup,
      prefix.ready,
    );
    let transition = reduceManager(
      handoff.state,
      readyInput,
      "T22 NORMAL_READY",
    );
    assert.equal(transition.state.status, "WAITING_FOR_GUARDIAN");
    assert.equal(transition.state.writerKind, null);
    assert.equal(transition.state.actorKind, "LIVE_BIRTH_GUARDIAN");
    assert.equal(transition.state.permittedGuardianAction, "WAIT_STATUS");
    assert.equal(
      transition.state.guardianStartupSha256,
      prefix.startup.startupReportSha256,
    );
    assert.equal(transition.state.recoveryRequestFrameRawSha256, null);
    assert.equal(transition.state.lastGuardianWireSequence, 0);
    assert.equal(
      transition.state.lastGuardianWireFrameRawSha256,
      prefix.ready.rawSha256,
    );
    assert.notEqual(transition.guardianStatusArtifact, null);
    assert.equal(
      transition.guardianStatusArtifact.rawSha256,
      prefix.ready.rawSha256,
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      transition,
    );

    const cancelled = reduceNormalControlCancel(prefix.controlState);
    expectCode(() => {
      const wrongHeadInput = makeManagerStatusInput(
        transition.state,
        prefix.startup,
        cancelled.statusFrame1,
      );
      manager.reduceCandidateContainmentGuardianManagerProtocolV1(
        transition.state,
        wrongHeadInput,
      );
    }, "MANAGER_BINDING");
    let predecessorState = transition.state;
    let input = makeManagerStatusInput(
      predecessorState,
      prefix.startup,
      cancelled.statusFrame0,
    );
    transition = reduceManager(
      predecessorState,
      input,
      "T24 CANCEL_REQUIRED",
    );
    assert.equal(transition.state.status, "WAITING_FOR_GUARDIAN");
    assert.equal(transition.state.lastGuardianWireSequence, 2);
    assert.equal(
      transition.state.lastGuardianWireFrameRawSha256,
      cancelled.statusFrame0.rawSha256,
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      transition,
    );

    predecessorState = transition.state;
    input = makeManagerStatusInput(
      predecessorState,
      prefix.startup,
      cancelled.statusFrame1,
    );
    transition = reduceManager(
      predecessorState,
      input,
      "T25 CONTROL_TERMINAL",
    );
    assert.equal(transition.state.status, "REPLAY_REQUIRED");
    assert.equal(transition.state.writerKind, "SERVICE_MANAGER");
    assert.equal(transition.state.actorKind, null);
    assert.equal(transition.state.permittedGuardianAction, null);
    assert.equal(transition.state.inventorySetSha256, token.inventorySetSha256);
    assert.equal(transition.state.inventoryComplete, true);
    for (const key of [
      "guardianStartupSha256",
      "recoveryRequestFrameRawSha256",
      "lastGuardianWireSequence",
      "lastGuardianWireFrameRawSha256",
    ]) {
      assert.equal(transition.state[key], null, key);
    }
    assert.equal(
      transition.guardianStatusArtifact.rawSha256,
      cancelled.statusFrame1.rawSha256,
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      transition,
    );
    const closed = closeLifetimeSegment({
      state: transition.state,
      token,
      label: "normal-wire-prefix",
    });
    assert.equal(closed.state.activeDirectoryHandleCount, 1);
  },
);

candidateTest(
  "T14 adopted live-birth actor waits without granting service-manager writer authority",
  () => {
    const buildAdopted = (options) =>
      createAdoptedOwner({
        ...options,
        journalStack: ownerFixtures.createJournalStack(options.label, 0),
      });
    let { owner, state, token } = inventoryLifetimeOwner(
      "wait-live-birth",
      buildAdopted,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "wait-live-birth",
    }));
    const plan = statefsAutoPlan({ state, token, owner });
    assert.equal(plan.managerDisposition, "WAIT_GUARDIAN");
    assert.equal(plan.writerKind, null);
    assert.equal(plan.actorKind, "LIVE_BIRTH_GUARDIAN");
    assert.equal(plan.guardianAction, "WAIT_STATUS");
    const waiting = acceptPlan(state, plan, "T14 wait guardian");
    assert.equal(waiting.state.status, "WAITING_FOR_GUARDIAN");
    assert.equal(waiting.state.writerKind, null);
    assert.equal(waiting.state.actorKind, "LIVE_BIRTH_GUARDIAN");
    assert.equal(waiting.state.permittedGuardianAction, "WAIT_STATUS");
    assert.equal(waiting.guardianHandoffPlan, null);
    assert.equal(waiting.state.inventorySetSha256, token.inventorySetSha256);
    assert.equal(waiting.state.inventoryComplete, true);
  },
);

candidateTest(
  "unlisted but coherently constructible status/input pairs fail at MANAGER_TRANSITION without consuming input",
  () => {
    const lock = initializeManager("unlisted-operation-plan");
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      lock.transition,
    );
    const firstPlan = makeLockPlan(statefs, lock.state);
    const operation = acceptPlan(
      lock.state,
      firstPlan,
      "unlisted operation retained request",
    );
    const nextPlan = makeLockPlan(statefs, operation.state);
    const operationInput = makeManagerPlanInput(operation.state, nextPlan);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expectCode(
        () =>
          manager.reduceCandidateContainmentGuardianManagerProtocolV1(
            operation.state,
            operationInput,
          ),
        "MANAGER_TRANSITION",
      );
    }

    const buildAdopted = (options) =>
      createAdoptedOwner({
        ...options,
        journalStack: ownerFixtures.createJournalStack(options.label, 0),
      });
    let { owner, state, token } = inventoryLifetimeOwner(
      "unlisted-waiting-plan",
      buildAdopted,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "unlisted-waiting-plan",
    }));
    const waitPlan = statefsAutoPlan({ state, token, owner });
    const waiting = acceptPlan(state, waitPlan, "unlisted waiting state");
    assert.equal(waiting.state.status, "WAITING_FOR_GUARDIAN");
    const freshContextPlan = statefsAutoPlan({
      state: waiting.state,
      token,
      owner,
    });
    assert.equal(freshContextPlan.request, null);
    const waitingInput = makeManagerPlanInput(waiting.state, freshContextPlan);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expectCode(
        () =>
          manager.reduceCandidateContainmentGuardianManagerProtocolV1(
            waiting.state,
            waitingInput,
          ),
        "MANAGER_TRANSITION",
      );
    }
  },
);

candidateTest(
  "T15 exact terminal actor evidence resets recovery planning to fresh root inventory",
  () => {
    let journalStack = null;
    let tuple = null;
    const buildReplanOwner = (options) => {
      journalStack = ownerFixtures.createJournalStack(options.label, 5);
      const owner = createAdoptedOwner({ ...options, journalStack });
      tuple = buildRecoveryReplanTuple(owner, journalStack);
      return owner;
    };
    let { owner, state, token } = inventoryLifetimeOwner(
      "recovery-replan",
      buildReplanOwner,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "recovery-replan",
    }));
    const plan = statefsAutoPlan({
      state,
      token,
      owner,
      generationManifest: lifetimeArtifact(journalStack.generationManifest),
      normalJournalBundles: journalArtifactList(journalStack),
      recoveryTarget: tuple.recoveryTarget,
      recoveryInventory: tuple.recoveryInventory,
      recoveryReplay: tuple.recoveryReplay,
      recoveryPlan: tuple.recoveryPlan,
    });
    assert.equal(plan.managerDisposition, "RECOVERY_REPLAN");
    assert.equal(plan.writerKind, "SERVICE_MANAGER");
    assert.equal(plan.actorKind, null);
    assert.equal(plan.targetSha256, tuple.recoveryTarget.targetSha256);
    const replan = acceptPlan(state, plan, "T15 recovery replan");
    assert.equal(replan.state.status, "INVENTORY_REQUIRED");
    assert.equal(replan.state.writerKind, "SERVICE_MANAGER");
    assert.equal(replan.state.actorKind, null);
    assert.equal(replan.state.targetSha256, tuple.recoveryTarget.targetSha256);
    assert.equal(replan.state.permittedStatefsOperation, "INVENTORY");
    assert.equal(replan.state.inventoryRequestCount, 0);
    assert.equal(replan.state.inventoryComplete, false);
    assert.equal(replan.state.activeDirectoryHandleCount, 1);
    assert.equal(replan.state.inventorySetSha256, token.inventorySetSha256);
    assert.equal(replan.state.retryPermitted, false);
    assert.equal(replan.state.terminal, false);
  },
);

candidateTest(
  "C14 exact ABSENT anchored-empty predecessor selects only a T15 StateFS recovery replan",
  () => {
    let journalStack = null;
    let tuple = null;
    const buildAnchoredEmptyOwner = (options) => {
      journalStack = ownerFixtures.createJournalStack(options.label, 5);
      const owner = createAdoptedOwner({ ...options, journalStack });
      tuple = buildAnchoredEmptyReplanTuple(owner, journalStack);
      return owner;
    };
    let { owner, state, token } = inventoryLifetimeOwner(
      "anchored-empty-replan",
      buildAnchoredEmptyOwner,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "anchored-empty-replan",
    }));
    assert.equal(
      tuple.recoveryReplay.status,
      "VALID_ANCHORED_EMPTY_ATTEMPT_REPLAYED",
    );
    assert.equal(
      tuple.anchoredEmptyAttempt.reportedAttemptDirectoryState,
      "ABSENT",
    );
    assert.equal(tuple.recoveryPlan.status, "RECOVERY_ANCHOR_REQUIRED");
    const plan = statefsAutoPlan({
      state,
      token,
      owner,
      generationManifest: lifetimeArtifact(journalStack.generationManifest),
      normalJournalBundles: journalArtifactList(journalStack),
      recoveryTarget: tuple.recoveryTarget,
      recoveryInventory: tuple.recoveryInventory,
      recoveryReplay: tuple.recoveryReplay,
      recoveryPlan: tuple.recoveryPlan,
    });
    assert.equal(plan.planKind, "CONTEXT_ONLY");
    assert.equal(plan.request, null);
    assert.equal(plan.operation, null);
    assert.equal(plan.managerDisposition, "RECOVERY_REPLAN");
    assert.equal(plan.writerKind, "SERVICE_MANAGER");
    assert.equal(plan.actorKind, null);
    for (const key of [
      "recoveryTarget",
      "recoveryInventory",
      "recoveryReplay",
      "recoveryPlan",
    ]) {
      assert.equal(plan.ownerContext[key], tuple[key], `ownerContext.${key}`);
    }
    const replan = acceptPlan(
      state,
      plan,
      "T15 anchored-empty recovery replan",
    );
    assert.equal(replan.state.status, "INVENTORY_REQUIRED");
    assert.equal(replan.state.inventorySetSha256, token.inventorySetSha256);
    assert.equal(replan.state.inventoryRequestCount, 0);
    assert.equal(replan.state.inventoryComplete, false);
    assert.equal(replan.state.activeDirectoryHandleCount, 1);
    assert.equal(replan.state.permittedStatefsOperation, "INVENTORY");
    assert.equal(replan.state.retryPermitted, false);
    assert.equal(replan.state.terminal, false);
    expectCode(
      () => statefs.assertCandidateContainmentGuardianStatefsPlanV1(plan),
      "STATEFS_BINDING",
    );
  },
);

candidateTest(
  "C15 state-18 destination-only inventory permits one MOVE_SYNC_REOBSERVE and consumes its branded receipt",
  () => {
    let journalStack = null;
    let tuple = null;
    const buildState18Owner = (options) => {
      journalStack = ownerFixtures.createJournalStack(options.label, 18);
      const owner = createAdoptedOwner({ ...options, journalStack });
      tuple = buildState18CloseTuple(owner, journalStack);
      return owner;
    };
    let { owner, state, token } = inventoryLifetimeOwner(
      "state18-move-sync-reobserve",
      buildState18Owner,
    );
    ({ state, token } = reopenState18MoveParents({
      state,
      token,
      owner,
      label: "state18-move-sync-reobserve",
    }));
    const plan = statefsAutoPlan({
      state,
      token,
      owner,
      generationManifest: lifetimeArtifact(journalStack.generationManifest),
      normalJournalBundles: journalArtifactList(journalStack),
      recoveryTarget: tuple.recoveryTarget,
      recoveryInventory: tuple.recoveryInventory,
      recoveryReplay: tuple.recoveryReplay,
      recoveryPlan: tuple.recoveryPlan,
    });
    assert.equal(plan.request.operation, "MOVE_SYNC_REOBSERVE");
    for (const key of [
      "recoveryTarget",
      "recoveryInventory",
      "recoveryReplay",
      "recoveryPlan",
    ]) {
      assert.equal(plan.ownerContext[key], tuple[key], `ownerContext.${key}`);
    }
    assert.equal(plan.request.executionDisposition, "EXECUTE");
    assert.equal(plan.request.writerKind, "SERVICE_MANAGER");
    assert.equal(plan.request.actorKind, "LIVE_BIRTH_GUARDIAN");
    assert.equal(plan.request.requiredDurableRecordType, "CLOSED_DURABLE");
    assert.equal(
      plan.request.requiredOutcomeRecordType,
      "NORMAL_CLOSE_RECEIPT_DURABLE",
    );
    assert.equal(plan.request.expectedOutcome, "MOVE_SYNC_COMPLETED");
    const operation = acceptPlan(state, plan, "T11 state18 move-sync plan");
    assert.equal(
      operation.state.permittedStatefsOperation,
      "MOVE_SYNC_REOBSERVE",
    );
    const receipt = dispatchStatefsRequest(plan, moveSyncResult(plan.request));
    assert.equal(receipt.outcome, "MOVE_SYNC_COMPLETED");
    assert.equal(receipt.retryDisposition, "NO_RETRY");
    assert.notEqual(receipt.inventorySet, null);
    const replay = acceptReceipt(
      operation.state,
      receipt,
      "T17 state18 move-sync receipt",
    );
    assert.equal(replay.state.status, "REPLAY_REQUIRED");
    assert.equal(replay.state.writerKind, "SERVICE_MANAGER");
    assert.equal(replay.state.actorKind, "LIVE_BIRTH_GUARDIAN");
    assert.equal(replay.state.inventoryComplete, true);
    assert.equal(
      replay.state.inventorySetSha256,
      receipt.inventorySet.inventorySetSha256,
    );
    expectCode(
      () => makeManagerReceiptInput(operation.state, receipt),
      "MANAGER_BINDING",
    );
    const closed = closeState18MoveParents({
      state: replay.state,
      token: receipt.inventorySet,
      label: "state18-move-sync-reobserve",
    });
    assert.equal(closed.state.activeDirectoryHandleCount, 1);
  },
);

candidateTest(
  "T21-T23 bind the recovery request before accepting its exact guardian status",
  () => {
    let journalStack = null;
    let tuple = null;
    const buildRecoveryOwner = (options) => {
      journalStack = ownerFixtures.createJournalStack(options.label, 5);
      const owner = createAdoptedOwner({ ...options, journalStack });
      tuple = buildRecoveryHandoffTuple(owner, journalStack);
      return owner;
    };
    let { owner, state, token } = inventoryLifetimeOwner(
      "recovery-wire-prefix",
      buildRecoveryOwner,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "recovery-wire-prefix",
    }));
    const plan = statefsAutoPlan({
      state,
      token,
      owner,
      generationManifest: lifetimeArtifact(journalStack.generationManifest),
      normalJournalBundles: journalArtifactList(journalStack),
      recoveryTarget: tuple.recoveryTarget,
      recoveryInventory: tuple.recoveryInventory,
      recoveryReplay: tuple.recoveryReplay,
      recoveryPlan: tuple.recoveryPlan,
      recoveryAttempt: tuple.recoveryAttempt,
    });
    assert.equal(plan.managerDisposition, "GUARDIAN_HANDOFF");
    assert.equal(plan.writerKind, "SERVICE_MANAGER");
    assert.equal(plan.actorKind, "RECOVERY_ONLY_GUARDIAN");
    assert.equal(plan.guardianAction, "RECOVERY_CONTROL_HANDOFF");
    let transition = acceptPlan(state, plan, "T13 recovery handoff");
    const handoffPlan = transition.guardianHandoffPlan;
    assert.equal(handoffPlan.mode, "RECOVERY_ONLY");
    assert.equal(handoffPlan.action, "RECOVERY_CONTROL_HANDOFF");
    assert.equal(
      handoffPlan.recoveryActorEpochSha256,
      tuple.recoveryActorEpochSha256,
    );
    assert.notEqual(handoffPlan.recoverySelection, null);
    assert.equal(
      handoffPlan.recoverySelectionSha256,
      semanticSha256(handoffPlan.recoverySelection),
    );
    assert.deepEqual(handoffPlan.descriptorRoles, [
      "recoveryRequestRead",
      "statusWrite",
      "diagnosticsWrite",
      "stateRoot",
      "delegatedRoot",
      "recoveryActorLifetimeCgroup",
      "epochRead",
    ]);

    const prefix = createRecoveryControlPrefix(tuple);
    const requestBytes = recoveryRequestFrameBytes(prefix, handoffPlan);
    const retainedRequestBytes = Buffer.from(requestBytes);
    const recoveryRequestState = transition.state;
    expectCode(
      () =>
        manager.createCandidateContainmentGuardianManagerProtocolInputV1(
          recoveryRequestState,
          managerInputArgument({
            kind: "RECOVERY_REQUEST_OBSERVED",
            guardianStartupProjection: prefix.startup,
            guardianControlState: prefix.controlState,
            guardianRecoveryRequestFrameBytes: Buffer.from(requestBytes),
            guardianRequestEofObserved: false,
          }),
        ),
      "MANAGER_PREDECESSOR",
    );
    const observedArgument = managerInputArgument({
      kind: "RECOVERY_REQUEST_OBSERVED",
      guardianStartupProjection: prefix.startup,
      guardianControlState: prefix.controlState,
      guardianRecoveryRequestFrameBytes: requestBytes,
      guardianRequestEofObserved: true,
    });
    const observedInput = assertManagerInputProjection(
      manager.createCandidateContainmentGuardianManagerProtocolInputV1(
        recoveryRequestState,
        observedArgument,
      ),
      recoveryRequestState,
      observedArgument,
      "recovery request observed",
    );
    requestBytes.fill(0);
    transition = reduceManager(
      recoveryRequestState,
      observedInput,
      "T21 recovery request",
    );
    assert.equal(transition.state.status, "GUARDIAN_HANDOFF_REQUIRED");
    assert.equal(transition.state.writerKind, null);
    assert.equal(transition.state.actorKind, "RECOVERY_ONLY_GUARDIAN");
    assert.equal(
      transition.state.permittedGuardianAction,
      "RECOVERY_CONTROL_HANDOFF",
    );
    assert.equal(
      transition.state.guardianStartupSha256,
      prefix.startup.startupReportSha256,
    );
    assert.equal(
      transition.state.recoveryRequestFrameRawSha256,
      byteSha256(retainedRequestBytes),
    );
    assert.equal(transition.state.lastGuardianWireSequence, 0);
    assert.equal(
      transition.state.lastGuardianWireFrameRawSha256,
      byteSha256(retainedRequestBytes),
    );
    assert.notEqual(transition.guardianRecoveryRequestArtifact, null);
    assertExactFields(
      transition.guardianRecoveryRequestArtifact,
      RECOVERY_REQUEST_ARTIFACT_FIELDS,
      "recovery request artifact",
    );
    assert.deepEqual(
      transition.guardianRecoveryRequestArtifact.bytes,
      retainedRequestBytes,
    );
    const controlInput =
      transition.guardianRecoveryRequestArtifact.controlInput;
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      transition,
    );

    const wrongRequestDigest = digest(
      "recovery-wire-prefix:wrong-request-predecessor",
    );
    const wrongRequestStatusBytes = canonicalJsonLine(
      record(
        ["schema", "oxigraph.candidate-containment-guardian-control-frame/v1"],
        ["action", "STATUS"],
        ["mode", "RECOVERY_ONLY"],
        ["sequence", 1],
        ["previousFrameSha256", wrongRequestDigest],
        ["requirementsSha256", CONTROL_REQUIREMENTS_SHA256],
        ["startupSha256", prefix.startup.startupReportSha256],
        ["epochSha256", prefix.startup.epochSha256],
        ["state", "RECOVERY_REQUEST_ACCEPTED"],
        ["admissionFrameSha256", null],
        ["recoveryRequestFrameSha256", wrongRequestDigest],
        ["terminalReason", null],
      ),
    );
    expectCode(() => {
      const wrongRequestStatusInput =
        manager.createCandidateContainmentGuardianManagerProtocolInputV1(
          transition.state,
          managerInputArgument({
            kind: "GUARDIAN_STATUS_FRAME",
            guardianStartupProjection: prefix.startup,
            guardianStatusFrameBytes: wrongRequestStatusBytes,
          }),
        );
      manager.reduceCandidateContainmentGuardianManagerProtocolV1(
        transition.state,
        wrongRequestStatusInput,
      );
    }, "MANAGER_BINDING");

    const accepted = control.reduceCandidateContainmentGuardianControlV1(
      prefix.controlState,
      controlInput,
    );
    assert.equal(accepted.statusFrameCount, 1);
    assert.equal(accepted.statusFrame0.state, "RECOVERY_REQUEST_ACCEPTED");
    const acceptedInput = makeManagerStatusInput(
      transition.state,
      prefix.startup,
      accepted.statusFrame0,
    );
    const recoveryAcceptedState = transition.state;
    transition = reduceManager(
      recoveryAcceptedState,
      acceptedInput,
      "T23 recovery accepted",
    );
    assert.equal(transition.state.status, "WAITING_FOR_GUARDIAN");
    assert.equal(transition.state.writerKind, null);
    assert.equal(transition.state.actorKind, "RECOVERY_ONLY_GUARDIAN");
    assert.equal(transition.state.permittedGuardianAction, "WAIT_STATUS");
    assert.equal(
      transition.state.recoveryRequestFrameRawSha256,
      byteSha256(retainedRequestBytes),
    );
    assert.equal(transition.state.lastGuardianWireSequence, 1);
    assert.equal(
      transition.state.lastGuardianWireFrameRawSha256,
      accepted.statusFrame0.rawSha256,
    );
    assert.equal(
      transition.guardianStatusArtifact.rawSha256,
      accepted.statusFrame0.rawSha256,
    );
    manager.assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      transition,
    );
  },
);

candidateTest(
  "T16 complete lifetime tail is terminal, nonretrying, and retires private inventory authority",
  () => {
    const buildTerminal = (options) =>
      createTerminalOwner({
        ...options,
        journalStack: ownerFixtures.createJournalStack(options.label, 0),
      });
    let { owner, state, token } = inventoryLifetimeOwner(
      "terminal-tail",
      buildTerminal,
    );
    ({ state, token } = reopenLifetimeSegment({
      state,
      token,
      owner,
      label: "terminal-tail",
    }));
    const plan = statefsAutoPlan({ state, token, owner });
    assert.equal(plan.managerDisposition, "TERMINAL");
    const terminal = acceptPlan(state, plan, "T16 terminal plan");
    assert.equal(terminal.state.status, "TERMINAL");
    assert.equal(terminal.state.writerKind, null);
    assert.equal(terminal.state.actorKind, null);
    assert.equal(terminal.state.inventorySetSha256, null);
    assert.equal(terminal.state.inventoryComplete, false);
    assert.equal(terminal.state.activeDirectoryHandleCount, 1);
    assert.equal(terminal.state.unresolvedEffect, false);
    assert.equal(terminal.state.retryPermitted, false);
    assert.equal(terminal.state.terminal, true);
    for (const key of [
      "guardianStartupSha256",
      "recoveryRequestFrameRawSha256",
      "lastGuardianWireSequence",
      "lastGuardianWireFrameRawSha256",
    ]) {
      assert.equal(terminal.state[key], null, key);
    }
  },
);

test("source-absent RED is the exact attributable candidate manager module failure", () => {
  assert.equal(managerImportAttempts, 1);
  if (managerImportError !== null) throw managerImportError;
  assert.notEqual(manager, null);
});
