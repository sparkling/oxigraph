import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_AUTHORITY_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_BINDINGS_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_PHYSICAL_FACTS_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_READINESS_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1,
  CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_SCHEMA_V1,
  createCandidateContainmentGuardianRecoveryExecutorPlanV1,
  verifyCandidateContainmentGuardianRecoveryExecutionV1,
  verifyCandidateContainmentGuardianRecoveryExecutorPlanV1,
} from "../src/candidate/containment-guardian-recovery-executor-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1 } from "../src/candidate/containment-guardian-lifetime-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1 } from "../src/candidate/containment-guardian-native-adapter-v1.mjs";
import { CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1 } from "../src/candidate/containment-guardian-recovery-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256 } from "../src/candidate/containment-guardian-statefs-v1.mjs";
import { runIsolatedGuardianRecoveryExecutorFixtureS2 } from "./support/candidate-containment-guardian-recovery-executor-s2-fixture.mjs";

const SAME_BOOT_STATES = [
  "RECOVERY_ATTEMPT_DURABLE",
  "CONTROL_KILL_INTENT_DURABLE",
  "CONTROL_KILL_WRITE_COMPLETED",
  "JOB_FIRST_KILL_INTENT_DURABLE",
  "JOB_FIRST_KILL_WRITE_COMPLETED",
  "CONTROL_QUIESCENT_OBSERVED",
  "JOB_SECOND_KILL_INTENT_DURABLE",
  "JOB_SECOND_KILL_WRITE_COMPLETED",
  "JOB_QUIESCENT_OBSERVED",
  "CGROUP_REMOVAL_INTENT_DURABLE",
  "CGROUP_PATHS_ABSENT_OBSERVED",
  "RECOVERED_TOMBSTONE_DURABLE",
  "RECOVERED_LOCATION_OBSERVED",
];

function recoveryPlan(
  disposition,
  sourceLocation,
  recoveryStates,
  parentage = "LOST",
  decisionSourceLocation = sourceLocation,
) {
  return createCandidateContainmentGuardianRecoveryExecutorPlanV1({
    mode: "RECOVERY_ONLY",
    disposition,
    actorKind: "RECOVERY_ONLY_GUARDIAN",
    parentage,
    sourceLocation,
    decisionSourceLocation,
    recoveryStates,
  });
}

test("ADR-0038 S2 freezes predecessor identities and remains authority-null", () => {
  assert.equal(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_SCHEMA_V1, "oxigraph.candidate-containment-guardian-recovery-executor/v1");
  assert.match(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1, /^[0-9a-f]{64}$/);
  assert.equal(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_BINDINGS_V1.lifetimeV1RequirementsSha256, CANDIDATE_CONTAINMENT_GUARDIAN_LIFETIME_REQUIREMENTS_SHA256_V1);
  assert.equal(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_BINDINGS_V1.recoveryV1RequirementsSha256, CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1);
  assert.equal(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_BINDINGS_V1.statefsV1RequirementsSha256, CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256);
  assert.equal(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_BINDINGS_V1.nativeS1RequirementsSha256, CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1);
  assert.ok(Object.values(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_AUTHORITY_V1).every((value) => value === false));
  assert.ok(Object.values(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_PHYSICAL_FACTS_V1).every((value) => value === null));
  assert.equal(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_READINESS_V1.status, "unavailable");
  assert.equal(CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_READINESS_V1.reason, "native-adapter-unavailable");
});

test("stable live guardian models controller-loss cancel and complete ctl/job cleanup", () => {
  const plan = createCandidateContainmentGuardianRecoveryExecutorPlanV1({
    mode: "CONTROLLER_LOSS_CANCEL_ONLY",
    disposition: null,
    actorKind: "LIVE_BIRTH_GUARDIAN",
    parentage: "LIVE_DIRECT_CHILD",
    sourceLocation: "active",
    decisionSourceLocation: null,
    recoveryStates: [],
  });
  assert.equal(verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(plan).requirementsSha256, plan.requirementsSha256);
  const operations = plan.steps.map((step) => `${step.operation}:${step.target}`);
  for (const required of [
    "CREATE_CGROUP:ctl", "CREATE_CGROUP:job", "CONFIGURE_CGROUP:ctl", "CONFIGURE_CGROUP:job",
    "CGROUPS_CONFIGURED_EMPTY_OBSERVED:ctl-and-job",
    "CONTROLLER_COMMAND_EOF_OBSERVED:controller-command", "WRITE_CANCEL_COMMAND:supervisor-command",
    "CANCEL_WRITE_COMPLETED:supervisor-command",
    "SUPERVISOR_DONE_OBSERVED:supervisor-status",
    "WAITID_P_PIDFD_EXCLUSIVE:supervisor-pidfd", "SUPERVISOR_REAPED_OBSERVED:supervisor-pidfd",
    "WRITE_CGROUP_KILL:ctl", "WRITE_CGROUP_KILL:job", "CGROUP_QUIESCENT_OBSERVED:ctl",
    "CGROUP_QUIESCENT_OBSERVED:job", "STATUS_EOF_OBSERVED:supervisor-status",
    "CGROUPS_QUIESCENT_OBSERVED:ctl-and-job", "REMOVE_CGROUP:job", "REMOVE_CGROUP:ctl",
    "CGROUPS_REMOVED_OBSERVED:ctl-and-job", "GUARDIAN_DESCRIPTORS_CLOSED_OBSERVED:guardian-owned",
    "CLOSED_DURABLE:generation",
  ]) assert.ok(operations.includes(required), required);
  assert.equal(plan.steps.filter((step) => step.operation === "CGROUP_EFFECT_INTENT_DURABLE").length, 1);
  assert.equal(plan.steps.filter((step) => step.operation === "CLEANUP_INTENT_DURABLE").length, 1);
  assert.ok(plan.steps.every((step) => !String(step.operation).includes("PID_SIGNAL")));
  const indexOf = (operation) => plan.steps.findIndex((step) => step.operation === operation);
  assert.ok(indexOf("STATUS_EOF_OBSERVED") < indexOf("WAITID_P_PIDFD_EXCLUSIVE"));
  assert.ok(indexOf("WAITID_P_PIDFD_EXCLUSIVE") < indexOf("SUPERVISOR_REAPED_OBSERVED"));
  assert.ok(indexOf("SUPERVISOR_REAPED_OBSERVED") < indexOf("CLEANUP_INTENT_DURABLE"));
  assert.ok(indexOf("CGROUPS_QUIESCENT_OBSERVED") < indexOf("CGROUPS_REMOVED_OBSERVED"));
  assert.ok(indexOf("CGROUPS_REMOVED_OBSERVED") < indexOf("GUARDIAN_DESCRIPTORS_CLOSED_OBSERVED"));
  assert.ok(indexOf("GUARDIAN_DESCRIPTORS_CLOSED_OBSERVED") < indexOf("CLOSED_DURABLE"));
  const { execution, final } = runIsolatedGuardianRecoveryExecutorFixtureS2(plan);
  assert.equal(verifyCandidateContainmentGuardianRecoveryExecutionV1(execution).status, "SYNTHETIC_TRANSCRIPT_ACCEPTED");
  assert.deepEqual(final, {
    ctlExists: false, jobExists: false, cancelWritten: true, statusEof: true,
    reapedByPidfd: true, location: "active", sourceParentSynced: false,
    destinationParentSynced: false, descriptorsClosed: true, closedDurable: true,
  });
});

test("fresh same-boot recovery actor cannot inherit old-supervisor descriptor or wait facts", () => {
  for (const parentage of ["LOST", "AMBIGUOUS", "NOT_RECONSTRUCTED"]) {
    const plan = recoveryPlan("SAME_BOOT_RECONCILE", "active", SAME_BOOT_STATES, parentage);
    assert.equal(plan.actorKind, "RECOVERY_ONLY_GUARDIAN");
    assert.ok(plan.steps.every((step) => !["CLOSE_DESCRIPTOR", "STATUS_EOF_OBSERVED", "SUPERVISOR_PIDFD_READABLE_OBSERVED", "SUPERVISOR_PIDFD_HUP_OBSERVED", "WAITID_P_PIDFD_EXCLUSIVE", "SUPERVISOR_REAPED_OBSERVED"].includes(step.operation)));
    assert.ok(plan.steps.every((step) => !step.operation.includes("SIGNAL_PID")));
    const { execution, final } = runIsolatedGuardianRecoveryExecutorFixtureS2(plan);
    assert.equal(verifyCandidateContainmentGuardianRecoveryExecutionV1(execution).status, "SYNTHETIC_TRANSCRIPT_ACCEPTED");
    assert.equal(final.reapedByPidfd, false);
    assert.equal(final.location, "recovered");
    assert.equal(final.sourceParentSynced, true);
    assert.equal(final.destinationParentSynced, true);
  }
});

test("same-boot recovery preserves exact cgroup presence and absence branches", () => {
  const absent = recoveryPlan("SAME_BOOT_RECONCILE", "active", [
    "RECOVERY_ATTEMPT_DURABLE", "CONTROL_PATH_ABSENT_OBSERVED",
    "JOB_PATH_ABSENT_OBSERVED", "CGROUP_PATHS_ABSENT_OBSERVED",
    "RECOVERED_TOMBSTONE_DURABLE", "RECOVERED_LOCATION_OBSERVED",
  ]);
  const { final } = runIsolatedGuardianRecoveryExecutorFixtureS2(absent);
  assert.equal(final.location, "recovered");
  assert.equal(final.ctlExists, false);
  assert.equal(final.jobExists, false);
  assert.equal(final.statusEof, false);
  assert.equal(final.reapedByPidfd, false);
  assert.equal(final.descriptorsClosed, true);
});

test("anchored-empty genesis and reboot plans move only after a durable tombstone", () => {
  for (const [disposition, observed] of [["GENESIS_ABORT", "GENESIS_ABORT_RECOVERY_REQUIRED"], ["REBOOT_INTERRUPTION", "REBOOT_INTERRUPTION_OBSERVED"]]) {
    const states = ["RECOVERY_ATTEMPT_DURABLE", observed, "CGROUP_PATHS_ABSENT_OBSERVED", "RECOVERED_TOMBSTONE_DURABLE", "RECOVERED_LOCATION_OBSERVED"];
    for (const source of ["staging", "active"]) {
      const plan = recoveryPlan(disposition, source, states);
      const move = plan.steps.find((step) => step.operation === "MOVE_GENERATION_NO_REPLACE");
      const intent = plan.steps.find((step) => step.sequence === move.intentSequence);
      assert.equal(intent.operation, "RECOVERED_TOMBSTONE_DURABLE");
      assert.equal(plan.steps.find((step) => step.operation === "SYNC_SOURCE_PARENT").target, `${source}-parent`);
      const { final } = runIsolatedGuardianRecoveryExecutorFixtureS2(plan);
      assert.equal(final.location, "recovered");
      assert.equal(final.sourceParentSynced, true);
      assert.equal(final.destinationParentSynced, true);
    }
  }
});

test("quarantine and durable-decision resume plans preserve exact location semantics", () => {
  const cases = [
    ["QUARANTINE", "active", ["RECOVERY_ATTEMPT_DURABLE", "QUARANTINE_INTENT_DURABLE", "QUARANTINED_LOCATION_OBSERVED"], "quarantined", true, "active"],
    ["RECOVERED_DECISION_RESUME", "recovered", ["RECOVERY_ATTEMPT_DURABLE", "RECOVERED_TOMBSTONE_ADOPTED", "RECOVERED_LOCATION_OBSERVED"], "recovered", false, "staging"],
    ["RECOVERED_DECISION_RESUME", "staging", ["RECOVERY_ATTEMPT_DURABLE", "RECOVERED_TOMBSTONE_ADOPTED", "RECOVERED_LOCATION_OBSERVED"], "recovered", true, "staging"],
    ["QUARANTINE_DECISION_RESUME", "quarantined", ["RECOVERY_ATTEMPT_DURABLE", "QUARANTINE_INTENT_ADOPTED", "QUARANTINED_LOCATION_OBSERVED"], "quarantined", false, "active"],
    ["QUARANTINE_DECISION_RESUME", "active", ["RECOVERY_ATTEMPT_DURABLE", "QUARANTINE_INTENT_ADOPTED", "QUARANTINED_LOCATION_OBSERVED"], "quarantined", true, "active"],
  ];
  for (const [disposition, source, states, location, moved, decisionSource] of cases) {
    const plan = recoveryPlan(disposition, source, states, "LOST", decisionSource);
    assert.equal(plan.decisionSourceLocation, decisionSource);
    const sourceSync = plan.steps.find((step) => step.operation === "SYNC_SOURCE_PARENT");
    assert.equal(sourceSync?.target ?? null, moved ? `${decisionSource}-parent` : null);
    const { final } = runIsolatedGuardianRecoveryExecutorFixtureS2(plan);
    assert.equal(final.location, location);
    assert.equal(final.sourceParentSynced, moved);
    assert.equal(final.destinationParentSynced, moved);
  }
});

test("every synthetic effect names an earlier durable intent", () => {
  const plans = [
    recoveryPlan("SAME_BOOT_RECONCILE", "active", SAME_BOOT_STATES),
    recoveryPlan("QUARANTINE", "active", ["RECOVERY_ATTEMPT_DURABLE", "QUARANTINE_INTENT_DURABLE", "QUARANTINED_LOCATION_OBSERVED"]),
  ];
  for (const plan of plans) {
    for (const effect of plan.steps.filter((step) => step.kind === "EFFECT")) {
      const intent = plan.steps.find((step) => step.sequence === effect.intentSequence);
      assert.equal(intent.kind, "INTENT_DURABLE");
      assert.ok(intent.sequence < effect.sequence);
    }
  }
});
