import { canonicalJson } from "../routing/features.mjs";
import {
  deepFreeze,
  exactDenseArray,
  exactRecord,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1 } from "./containment-guardian-journal-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V2 } from "./containment-guardian-journal-v2.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1 } from "./containment-guardian-lifetime-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1 } from "./containment-guardian-native-adapter-v1.mjs";
import {
  CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1,
  CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1,
  CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
} from "./containment-guardian-recovery-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256 } from "./containment-guardian-statefs-v1.mjs";

// S2 remains a pure, authority-null execution transcript boundary. It neither
// opens nor mutates a cgroup, process, descriptor, or StateFS path. Isolated
// fixtures may model those effects and submit the resulting exact transcript;
// acceptance is not evidence that any physical effect occurred.

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-recovery-executor/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTION_SCHEMA_V1 =
  "oxigraph.candidate-containment-guardian-recovery-execution/v1";
export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MAX_STEPS_V1 = 64;

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MODES_V1 =
  deepFreeze(["CONTROLLER_LOSS_CANCEL_ONLY", "RECOVERY_ONLY"]);
export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_PARENTAGE_V1 =
  deepFreeze(["LIVE_DIRECT_CHILD", "LOST", "AMBIGUOUS", "NOT_RECONSTRUCTED"]);
const RECOVERY_ONLY_FORBIDDEN_SUPERVISOR_STATES = deepFreeze([
  "COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE",
  "COMMAND_DESCRIPTOR_CLOSED_OBSERVED",
  "STATUS_EOF_OBSERVED",
  "SUPERVISOR_PIDFD_READABLE_OBSERVED",
  "SUPERVISOR_PIDFD_HUP_OBSERVED",
  "SUPERVISOR_REAP_INTENT_DURABLE",
  "SUPERVISOR_REAPED_OBSERVED",
]);

function falseRecord(keys) {
  return deepFreeze(nullRecord(keys.map((key) => [key, false])));
}

function nullPhysicalRecord(keys) {
  return deepFreeze(nullRecord(keys.map((key) => [key, null])));
}

const AUTHORITY_FIELDS = deepFreeze([
  "filesystemExecution",
  "cgroupMutation",
  "descriptorMutation",
  "processExecution",
  "pidSignalling",
  "parentageReconstruction",
  "serviceManagerAuthority",
  "guardianAuthority",
  "recoveryAuthority",
  "runtimeRegistration",
  "g17Execution",
  "g22Execution",
  "qualification",
  "readiness",
  "promotion",
  "publication",
  "deployment",
  "productionContainment",
]);
const PHYSICAL_FACT_FIELDS = deepFreeze([
  "delegatedCgroup",
  "controllerLoss",
  "stableGuardian",
  "durableIntent",
  "cgroupMutation",
  "cgroupQuiescence",
  "cgroupRemoval",
  "statusEof",
  "descriptorClosure",
  "freshRecoveryActor",
  "sameBootIdentity",
  "rebootIdentity",
  "pidfdReadability",
  "pidfdHup",
  "waitidReap",
  "generationMove",
  "filesystemDurability",
  "powerLossDurability",
]);
const READINESS_FIELDS = deepFreeze(["status", "reason"]);
const STEP_FIELDS = deepFreeze([
  "sequence",
  "kind",
  "operation",
  "target",
  "intentSequence",
  "evidenceClass",
]);

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_AUTHORITY_V1 =
  falseRecord(AUTHORITY_FIELDS);

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_PHYSICAL_FACTS_V1 =
  nullPhysicalRecord(PHYSICAL_FACT_FIELDS);

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_READINESS_V1 =
  deepFreeze(
    nullRecord([
      ["status", "unavailable"],
      ["reason", "native-adapter-unavailable"],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_BINDINGS_V1 =
  deepFreeze(
    nullRecord([
      ["journalV1RequirementsSha256", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V1],
      ["journalV2RequirementsSha256", CANDIDATE_CONTAINMENT_GUARDIAN_JOURNAL_REQUIREMENTS_SHA256_V2],
      ["lifetimeV1RequirementsSha256", CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1],
      ["recoveryV1RequirementsSha256", CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1],
      ["statefsV1RequirementsSha256", CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256],
      ["nativeS1RequirementsSha256", CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_NONCLAIMS_V1 =
  deepFreeze([
    "synthetic-transcript-proves-no-physical-effect",
    "durable-model-proves-no-filesystem-or-power-loss-durability",
    "serialized-controller-loss-proves-no-live-controller-loss",
    "serialized-recovery-actor-proves-no-process-freshness",
    "serialized-quiescence-proves-no-delegated-cgroup-state",
    "serialized-eof-proves-no-descriptor-state",
    "serialized-pidfd-events-prove-no-pidfd-ownership-or-reap",
    "parentage-lost-or-ambiguous-is-not-reconstructed-parentage",
    "generation-move-model-proves-no-statefs-effect",
    "no-pid-signalling",
    "no-runtime-registration",
    "no-G1.7-or-G2.2-execution",
    "no-qualification-promotion-publication-deployment-or-production-readiness",
  ]);

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_V1 =
  deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_SCHEMA_V1],
      ["bindings", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_BINDINGS_V1],
      ["modes", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MODES_V1],
      ["maximumSteps", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MAX_STEPS_V1],
      ["effectRule", "exact-prior-durable-intent-reference"],
      ["controllerLossRule", "stable-live-birth-guardian-cancel-only"],
      ["recoveryActorRule", "fresh-recovery-only-guardian"],
      ["recoveryOnlySupervisorFactRule", "command-status-pidfd-direct-wait-and-reap-false"],
      ["liveDirectChildCloseRule", "status-eof-then-exclusive-pidfd-reap-then-cleanup-then-descriptor-close-then-closed-durable"],
      ["recoveryParentageRule", "lost-ambiguous-or-not-reconstructed-never-pid-signalled"],
      ["moveRule", "durable-decision-then-no-replace-move-two-parent-syncs-and-location-observation"],
      ["nestedInputRule", "recursive-exact-own-data-before-canonicalization"],
      ["evidenceClass", "synthetic-isolated-transcript"],
      ["binding", null],
      ["adapterRegistered", false],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_AUTHORITY_V1],
      ["physicalFacts", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_PHYSICAL_FACTS_V1],
      ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_NONCLAIMS_V1],
      ["readiness", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_READINESS_V1],
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1 =
  sha256(Buffer.from(canonicalJson(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_V1), "utf8"));

function fail(message) {
  throw new TypeError(`candidate containment guardian recovery executor v1: ${message}`);
}

function exactText(value, allowed, label) {
  if (typeof value !== "string" || !allowed.includes(value)) fail(`${label} rejected`);
  return value;
}

function nullableText(value, allowed, label) {
  if (value === null) return null;
  return exactText(value, allowed, label);
}

function exactStates(value) {
  const states = exactDenseArray(
    value,
    "recovery states",
    CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MAX_STEPS_V1,
    fail,
  );
  const output = [];
  for (const state of states) {
    if (!CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.includes(state)) {
      fail("recovery state rejected");
    }
    if (output.includes(state)) fail("duplicate recovery state rejected");
    output.push(state);
  }
  return deepFreeze(output);
}

function step(sequence, kind, operation, target, intentSequence) {
  return deepFreeze(
    nullRecord([
      ["sequence", sequence],
      ["kind", kind],
      ["operation", operation],
      ["target", target],
      ["intentSequence", intentSequence],
      ["evidenceClass", kind === "INTENT_DURABLE" ? "synthetic-durable-model" : "synthetic-isolated"],
    ]),
  );
}

function createStepBuilder() {
  const steps = [];
  let sequence = 1;
  const observe = (operation, target = null) => {
    steps.push(step(sequence, "OBSERVATION", operation, target, null));
    sequence += 1;
  };
  const effect = (intent, operation, target = null) => {
    const intentSequence = sequence;
    steps.push(step(sequence, "INTENT_DURABLE", intent, target, null));
    sequence += 1;
    steps.push(step(sequence, "EFFECT", operation, target, intentSequence));
    sequence += 1;
  };
  const effectAfter = (intentSequence, operation, target = null) => {
    steps.push(step(sequence, "EFFECT", operation, target, intentSequence));
    sequence += 1;
  };
  const durable = (operation, target = null) => {
    const intentSequence = sequence;
    steps.push(step(sequence, "INTENT_DURABLE", operation, target, null));
    sequence += 1;
    return intentSequence;
  };
  const record = (operation, target = null) => {
    steps.push(step(sequence, "DURABLE_STATE", operation, target, null));
    sequence += 1;
  };
  return { steps, observe, effect, effectAfter, durable, record };
}

function appendMove(builder, decision, destination, sourceLocation) {
  const intentSequence = builder.durable(decision, destination);
  builder.effectAfter(intentSequence, "MOVE_GENERATION_NO_REPLACE", destination);
  builder.effectAfter(intentSequence, "SYNC_SOURCE_PARENT", `${sourceLocation}-parent`);
  builder.effectAfter(intentSequence, "SYNC_DESTINATION_PARENT", `${destination}-parent`);
  builder.observe(
    destination === "recovered" ? "RECOVERED_LOCATION_OBSERVED" : "QUARANTINED_LOCATION_OBSERVED",
    destination,
  );
}

function liveControllerLossSteps() {
  const builder = createStepBuilder();
  const cgroupIntent = builder.durable("CGROUP_EFFECT_INTENT_DURABLE", "ctl-and-job");
  builder.effectAfter(cgroupIntent, "CREATE_CGROUP", "ctl");
  builder.effectAfter(cgroupIntent, "CREATE_CGROUP", "job");
  builder.effectAfter(cgroupIntent, "CONFIGURE_CGROUP", "ctl");
  builder.effectAfter(cgroupIntent, "CONFIGURE_CGROUP", "job");
  builder.observe("CGROUPS_CONFIGURED_EMPTY_OBSERVED", "ctl-and-job");
  builder.observe("CONTROLLER_COMMAND_EOF_OBSERVED", "controller-command");
  const cancelIntent = builder.durable("DECISION_CANCEL_DURABLE", "supervisor-command");
  builder.effectAfter(cancelIntent, "WRITE_CANCEL_COMMAND", "supervisor-command");
  builder.observe("CANCEL_WRITE_COMPLETED", "supervisor-command");
  builder.observe("SUPERVISOR_DONE_OBSERVED", "supervisor-status");
  builder.observe("STATUS_EOF_OBSERVED", "supervisor-status");
  builder.effectAfter(cancelIntent, "WAITID_P_PIDFD_EXCLUSIVE", "supervisor-pidfd");
  builder.observe("SUPERVISOR_REAPED_OBSERVED", "supervisor-pidfd");
  const cleanupIntent = builder.durable("CLEANUP_INTENT_DURABLE", "guardian-owned");
  builder.effectAfter(cleanupIntent, "WRITE_CGROUP_KILL", "ctl");
  builder.observe("CGROUP_QUIESCENT_OBSERVED", "ctl");
  builder.effectAfter(cleanupIntent, "WRITE_CGROUP_KILL", "job");
  builder.observe("CGROUP_QUIESCENT_OBSERVED", "job");
  builder.observe("CGROUPS_QUIESCENT_OBSERVED", "ctl-and-job");
  builder.effectAfter(cleanupIntent, "REMOVE_CGROUP", "job");
  builder.observe("CGROUP_PATH_ABSENT_OBSERVED", "job");
  builder.effectAfter(cleanupIntent, "REMOVE_CGROUP", "ctl");
  builder.observe("CGROUP_PATH_ABSENT_OBSERVED", "ctl");
  builder.observe("CGROUPS_REMOVED_OBSERVED", "ctl-and-job");
  builder.effectAfter(cleanupIntent, "CLOSE_DESCRIPTOR", "supervisor-command");
  builder.effectAfter(cleanupIntent, "CLOSE_DESCRIPTOR", "supervisor-status");
  builder.effectAfter(cleanupIntent, "CLOSE_DESCRIPTOR", "supervisor-pidfd");
  builder.observe("GUARDIAN_DESCRIPTORS_CLOSED_OBSERVED", "guardian-owned");
  builder.record("CLOSED_DURABLE", "generation");
  return deepFreeze(builder.steps);
}

function sameBootSteps(states) {
  const builder = createStepBuilder();
  let index = 0;
  const take = (expected) => {
    if (states[index] !== expected) fail(`same-boot recovery expected ${expected}`);
    index += 1;
  };
  take("RECOVERY_ATTEMPT_DURABLE");
  builder.durable("RECOVERY_ATTEMPT_DURABLE", "attempt");
  const controlPresent = states[index] === "CONTROL_KILL_INTENT_DURABLE";
  if (controlPresent) {
    take("CONTROL_KILL_INTENT_DURABLE");
    take("CONTROL_KILL_WRITE_COMPLETED");
    builder.effect("CONTROL_KILL_INTENT_DURABLE", "WRITE_CGROUP_KILL", "ctl");
    builder.observe("CONTROL_KILL_WRITE_COMPLETED", "ctl");
  } else {
    take("CONTROL_PATH_ABSENT_OBSERVED");
    builder.observe("CONTROL_PATH_ABSENT_OBSERVED", "ctl");
  }
  const jobPresent = states[index] === "JOB_FIRST_KILL_INTENT_DURABLE";
  if (jobPresent) {
    take("JOB_FIRST_KILL_INTENT_DURABLE");
    take("JOB_FIRST_KILL_WRITE_COMPLETED");
    builder.effect("JOB_FIRST_KILL_INTENT_DURABLE", "WRITE_CGROUP_KILL", "job");
    builder.observe("JOB_FIRST_KILL_WRITE_COMPLETED", "job");
  } else {
    take("JOB_PATH_ABSENT_OBSERVED");
    builder.observe("JOB_PATH_ABSENT_OBSERVED", "job");
  }
  if (controlPresent) {
    take("CONTROL_QUIESCENT_OBSERVED");
    builder.observe("CONTROL_QUIESCENT_OBSERVED", "ctl");
  }
  if (jobPresent) {
    take("JOB_SECOND_KILL_INTENT_DURABLE");
    take("JOB_SECOND_KILL_WRITE_COMPLETED");
    take("JOB_QUIESCENT_OBSERVED");
    builder.effect("JOB_SECOND_KILL_INTENT_DURABLE", "WRITE_CGROUP_KILL", "job");
    builder.observe("JOB_SECOND_KILL_WRITE_COMPLETED", "job");
    builder.observe("JOB_QUIESCENT_OBSERVED", "job");
  }
  if (controlPresent || jobPresent) {
    take("CGROUP_REMOVAL_INTENT_DURABLE");
    const removalIntent = builder.durable("CGROUP_REMOVAL_INTENT_DURABLE", "ctl-and-job");
    if (jobPresent) builder.effectAfter(removalIntent, "REMOVE_CGROUP", "job");
    if (controlPresent) builder.effectAfter(removalIntent, "REMOVE_CGROUP", "ctl");
  }
  take("CGROUP_PATHS_ABSENT_OBSERVED");
  builder.observe("CGROUP_PATHS_ABSENT_OBSERVED", "ctl-and-job");
  take("RECOVERED_TOMBSTONE_DURABLE");
  take("RECOVERED_LOCATION_OBSERVED");
  appendMove(builder, "RECOVERED_TOMBSTONE_DURABLE", "recovered", "active");
  if (index !== states.length) fail("same-boot recovery has trailing states");
  return deepFreeze(builder.steps);
}

function anchoredEmptySteps(disposition, sourceLocation) {
  const builder = createStepBuilder();
  builder.durable("RECOVERY_ATTEMPT_DURABLE", "attempt");
  builder.observe(
    disposition === "GENESIS_ABORT"
      ? "GENESIS_ABORT_RECOVERY_REQUIRED"
      : "REBOOT_INTERRUPTION_OBSERVED",
    "generation",
  );
  builder.observe("CGROUP_PATHS_ABSENT_OBSERVED", "ctl-and-job");
  appendMove(builder, "RECOVERED_TOMBSTONE_DURABLE", "recovered", sourceLocation);
  return deepFreeze(builder.steps);
}

function terminalSteps(disposition, sourceLocation, decisionSourceLocation) {
  const builder = createStepBuilder();
  builder.durable("RECOVERY_ATTEMPT_DURABLE", "attempt");
  if (disposition === "QUARANTINE") {
    appendMove(builder, "QUARANTINE_INTENT_DURABLE", "quarantined", sourceLocation);
  } else if (disposition === "RECOVERED_DECISION_RESUME") {
    const intent = builder.durable("RECOVERED_TOMBSTONE_ADOPTED", decisionSourceLocation);
    if (sourceLocation !== "recovered") {
      builder.effectAfter(intent, "MOVE_GENERATION_NO_REPLACE", "recovered");
      builder.effectAfter(intent, "SYNC_SOURCE_PARENT", `${decisionSourceLocation}-parent`);
      builder.effectAfter(intent, "SYNC_DESTINATION_PARENT", "recovered-parent");
    }
    builder.observe("RECOVERED_LOCATION_OBSERVED", "recovered");
  } else {
    const intent = builder.durable("QUARANTINE_INTENT_ADOPTED", decisionSourceLocation);
    if (sourceLocation !== "quarantined") {
      builder.effectAfter(intent, "MOVE_GENERATION_NO_REPLACE", "quarantined");
      builder.effectAfter(intent, "SYNC_SOURCE_PARENT", `${decisionSourceLocation}-parent`);
      builder.effectAfter(intent, "SYNC_DESTINATION_PARENT", "quarantined-parent");
    }
    builder.observe("QUARANTINED_LOCATION_OBSERVED", "quarantined");
  }
  return deepFreeze(builder.steps);
}

function statesFromSteps(steps) {
  const states = [];
  for (const item of steps) {
    if (CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.includes(item.operation)) {
      states.push(item.operation);
    }
  }
  return deepFreeze(states);
}

function expectedRecoverySteps(
  disposition,
  recoveryStates,
  sourceLocation,
  decisionSourceLocation,
) {
  if (disposition === "SAME_BOOT_RECONCILE") return sameBootSteps(recoveryStates);
  if (disposition === "GENESIS_ABORT" || disposition === "REBOOT_INTERRUPTION") {
    return anchoredEmptySteps(disposition, sourceLocation);
  }
  return terminalSteps(disposition, sourceLocation, decisionSourceLocation);
}

function equalCanonical(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function verifyExactDerivedRecord(input, expected, fields, label) {
  const value = exactRecord(input, fields, label, fail);
  for (const field of fields) {
    if (value[field] !== expected[field]) fail(`${label}.${field} changed`);
  }
  return expected;
}

function verifyExactDerivedSteps(input, expected) {
  const items = exactDenseArray(
    input,
    "plan steps",
    CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MAX_STEPS_V1,
    fail,
  );
  if (items.length !== expected.length) fail("plan step count changed");
  for (let index = 0; index < items.length; index += 1) {
    verifyExactDerivedRecord(items[index], expected[index], STEP_FIELDS, `plan steps[${index}]`);
  }
  return expected;
}

export function createCandidateContainmentGuardianRecoveryExecutorPlanV1(input) {
  const value = exactRecord(
    input,
    ["mode", "disposition", "actorKind", "parentage", "sourceLocation", "decisionSourceLocation", "recoveryStates"],
    "plan input",
    fail,
  );
  const mode = exactText(value.mode, CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MODES_V1, "mode");
  const parentage = exactText(value.parentage, CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_PARENTAGE_V1, "parentage");
  let disposition;
  let actorKind;
  let sourceLocation;
  let decisionSourceLocation;
  let recoveryStates;
  let steps;
  if (mode === "CONTROLLER_LOSS_CANCEL_ONLY") {
    disposition = nullableText(value.disposition, [], "disposition");
    if (disposition !== null) fail("live disposition must be null");
    actorKind = exactText(value.actorKind, ["LIVE_BIRTH_GUARDIAN"], "actor kind");
    if (parentage !== "LIVE_DIRECT_CHILD") fail("live guardian parentage rejected");
    sourceLocation = exactText(value.sourceLocation, ["active"], "source location");
    if (value.decisionSourceLocation !== null) fail("live decision source must be null");
    decisionSourceLocation = null;
    recoveryStates = exactStates(value.recoveryStates);
    if (recoveryStates.length !== 0) fail("live recovery states must be empty");
    steps = liveControllerLossSteps();
  } else {
    disposition = exactText(value.disposition, CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1, "disposition");
    actorKind = exactText(value.actorKind, ["RECOVERY_ONLY_GUARDIAN"], "actor kind");
    if (parentage === "LIVE_DIRECT_CHILD") fail("recovery parentage cannot be reconstructed");
    sourceLocation = exactText(value.sourceLocation, ["staging", "active", "recovered", "quarantined"], "source location");
    decisionSourceLocation = exactText(value.decisionSourceLocation, ["staging", "active"], "decision source location");
    recoveryStates = exactStates(value.recoveryStates);
    if (recoveryStates.some((state) => RECOVERY_ONLY_FORBIDDEN_SUPERVISOR_STATES.includes(state))) {
      fail("recovery-only actor cannot inherit old-supervisor facts");
    }
    steps = expectedRecoverySteps(
      disposition,
      recoveryStates,
      sourceLocation,
      decisionSourceLocation,
    );
    const expectedStates = statesFromSteps(steps);
    if (!equalCanonical(recoveryStates, expectedStates)) fail("recovery state sequence disagrees with exact plan");
    const allowedSources =
      disposition === "GENESIS_ABORT" || disposition === "REBOOT_INTERRUPTION"
        ? ["staging", "active"]
        : disposition === "SAME_BOOT_RECONCILE"
          ? ["active"]
          : disposition === "RECOVERED_DECISION_RESUME"
            ? [decisionSourceLocation, "recovered"]
            : disposition === "QUARANTINE_DECISION_RESUME"
              ? [decisionSourceLocation, "quarantined"]
              : ["staging", "active"];
    if (!allowedSources.includes(sourceLocation)) fail("recovery source location disagrees with disposition");
    if (
      !["RECOVERED_DECISION_RESUME", "QUARANTINE_DECISION_RESUME"].includes(disposition) &&
      decisionSourceLocation !== sourceLocation
    ) fail("fresh recovery decision source changed");
  }
  if (steps.length > CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MAX_STEPS_V1) fail("step limit exceeded");
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_SCHEMA_V1],
      ["requirementsSha256", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1],
      ["mode", mode],
      ["disposition", disposition],
      ["actorKind", actorKind],
      ["parentage", parentage],
      ["sourceLocation", sourceLocation],
      ["decisionSourceLocation", decisionSourceLocation],
      ["recoveryStates", recoveryStates],
      ["steps", steps],
      ["binding", null],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_AUTHORITY_V1],
      ["physicalFacts", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_PHYSICAL_FACTS_V1],
      ["readiness", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_READINESS_V1],
    ]),
  );
}

const PLAN_FIELDS = deepFreeze([
  "schema",
  "requirementsSha256",
  "mode",
  "disposition",
  "actorKind",
  "parentage",
  "sourceLocation",
  "decisionSourceLocation",
  "recoveryStates",
  "steps",
  "binding",
  "authority",
  "physicalFacts",
  "readiness",
]);

export function verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(input) {
  const value = exactRecord(input, PLAN_FIELDS, "plan", fail);
  const expected = createCandidateContainmentGuardianRecoveryExecutorPlanV1({
    mode: value.mode,
    disposition: value.disposition,
    actorKind: value.actorKind,
    parentage: value.parentage,
    sourceLocation: value.sourceLocation,
    decisionSourceLocation: value.decisionSourceLocation,
    recoveryStates: value.recoveryStates,
  });
  for (const field of [
    "schema",
    "requirementsSha256",
    "mode",
    "disposition",
    "actorKind",
    "parentage",
    "sourceLocation",
    "decisionSourceLocation",
    "binding",
  ]) {
    if (value[field] !== expected[field]) fail(`plan.${field} changed`);
  }
  verifyExactDerivedSteps(value.steps, expected.steps);
  verifyExactDerivedRecord(value.authority, expected.authority, AUTHORITY_FIELDS, "plan authority");
  verifyExactDerivedRecord(value.physicalFacts, expected.physicalFacts, PHYSICAL_FACT_FIELDS, "plan physical facts");
  verifyExactDerivedRecord(value.readiness, expected.readiness, READINESS_FIELDS, "plan readiness");
  return expected;
}

function normalizeTrace(trace, plan) {
  const items = exactDenseArray(trace, "trace", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_MAX_STEPS_V1, fail);
  if (items.length !== plan.steps.length) fail("trace must cover every exact plan step once");
  const output = [];
  const durable = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const value = exactRecord(items[index], ["sequence", "kind", "operation", "target", "intentSequence", "outcome"], `trace[${index}]`, fail);
    const expected = plan.steps[index];
    if (
      value.sequence !== expected.sequence ||
      value.kind !== expected.kind ||
      value.operation !== expected.operation ||
      value.target !== expected.target ||
      value.intentSequence !== expected.intentSequence
    ) fail(`trace[${index}] disagrees with plan`);
    const expectedOutcome =
      expected.kind === "INTENT_DURABLE" || expected.kind === "DURABLE_STATE"
        ? "DURABLE_MODEL_RECORDED"
        : expected.kind === "EFFECT"
          ? "SYNTHETIC_EFFECT_COMPLETED"
          : "SYNTHETIC_OBSERVATION_MATCHED";
    if (value.outcome !== expectedOutcome) fail(`trace[${index}] outcome rejected`);
    if (expected.kind === "INTENT_DURABLE") durable.add(expected.sequence);
    if (expected.kind === "EFFECT" && !durable.has(expected.intentSequence)) {
      fail(`trace[${index}] effect lacks prior durable intent`);
    }
    output.push(
      deepFreeze(
        nullRecord([
          ["sequence", value.sequence],
          ["kind", value.kind],
          ["operation", value.operation],
          ["target", value.target],
          ["intentSequence", value.intentSequence],
          ["outcome", value.outcome],
        ]),
      ),
    );
  }
  return deepFreeze(output);
}

export function createCandidateContainmentGuardianRecoveryExecutionV1(input) {
  const value = exactRecord(input, ["plan", "trace"], "execution input", fail);
  const plan = verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(value.plan);
  const trace = normalizeTrace(value.trace, plan);
  return deepFreeze(
    nullRecord([
      ["schema", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTION_SCHEMA_V1],
      ["requirementsSha256", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1],
      ["plan", plan],
      ["trace", trace],
      ["status", "SYNTHETIC_TRANSCRIPT_ACCEPTED"],
      ["binding", null],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_AUTHORITY_V1],
      ["physicalFacts", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_PHYSICAL_FACTS_V1],
      ["readiness", CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_READINESS_V1],
    ]),
  );
}

export function verifyCandidateContainmentGuardianRecoveryExecutionV1(input) {
  const value = exactRecord(
    input,
    ["schema", "requirementsSha256", "plan", "trace", "status", "binding", "authority", "physicalFacts", "readiness"],
    "execution",
    fail,
  );
  const expected = createCandidateContainmentGuardianRecoveryExecutionV1({
    plan: value.plan,
    trace: value.trace,
  });
  for (const field of ["schema", "requirementsSha256", "status", "binding"]) {
    if (value[field] !== expected[field]) fail(`execution.${field} changed`);
  }
  verifyExactDerivedRecord(value.authority, expected.authority, AUTHORITY_FIELDS, "execution authority");
  verifyExactDerivedRecord(value.physicalFacts, expected.physicalFacts, PHYSICAL_FACT_FIELDS, "execution physical facts");
  verifyExactDerivedRecord(value.readiness, expected.readiness, READINESS_FIELDS, "execution readiness");
  return expected;
}
