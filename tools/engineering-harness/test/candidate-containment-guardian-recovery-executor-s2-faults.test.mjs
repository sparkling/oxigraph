import assert from "node:assert/strict";
import test from "node:test";

import {
  createCandidateContainmentGuardianRecoveryExecutionV1,
  createCandidateContainmentGuardianRecoveryExecutorPlanV1,
  verifyCandidateContainmentGuardianRecoveryExecutionV1,
  verifyCandidateContainmentGuardianRecoveryExecutorPlanV1,
} from "../src/candidate/containment-guardian-recovery-executor-v1.mjs";
import { runIsolatedGuardianRecoveryExecutorFixtureS2 } from "./support/candidate-containment-guardian-recovery-executor-s2-fixture.mjs";

const SAME_BOOT_STATES = [
  "RECOVERY_ATTEMPT_DURABLE", "CONTROL_KILL_INTENT_DURABLE",
  "CONTROL_KILL_WRITE_COMPLETED", "JOB_FIRST_KILL_INTENT_DURABLE",
  "JOB_FIRST_KILL_WRITE_COMPLETED", "CONTROL_QUIESCENT_OBSERVED",
  "JOB_SECOND_KILL_INTENT_DURABLE", "JOB_SECOND_KILL_WRITE_COMPLETED",
  "JOB_QUIESCENT_OBSERVED",
  "CGROUP_REMOVAL_INTENT_DURABLE", "CGROUP_PATHS_ABSENT_OBSERVED",
  "RECOVERED_TOMBSTONE_DURABLE", "RECOVERED_LOCATION_OBSERVED",
];

function liveInput() {
  return {
    mode: "CONTROLLER_LOSS_CANCEL_ONLY", disposition: null,
    actorKind: "LIVE_BIRTH_GUARDIAN", parentage: "LIVE_DIRECT_CHILD",
    sourceLocation: "active", decisionSourceLocation: null, recoveryStates: [],
  };
}

function recoveryInput() {
  return {
    mode: "RECOVERY_ONLY", disposition: "SAME_BOOT_RECONCILE",
    actorKind: "RECOVERY_ONLY_GUARDIAN", parentage: "LOST",
    sourceLocation: "active", decisionSourceLocation: "active",
    recoveryStates: SAME_BOOT_STATES,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("plan input rejects aliases, PIDs, stale guardians, and reconstructed recovery parentage", () => {
  for (const bad of [
    { ...liveInput(), pid: 41 },
    { ...liveInput(), controllerLost: true },
    { ...liveInput(), actorKind: "RECOVERY_ONLY_GUARDIAN" },
    { ...recoveryInput(), actorKind: "LIVE_BIRTH_GUARDIAN" },
    { ...recoveryInput(), parentage: "LIVE_DIRECT_CHILD" },
    { ...recoveryInput(), parentPid: 1 },
  ]) assert.throws(() => createCandidateContainmentGuardianRecoveryExecutorPlanV1(bad));
});

test("recovery-only actor rejects inherited command, status, pidfd, direct-wait, and reap facts", () => {
  for (const inheritedField of [
    "reportedCommandDescriptorHeld",
    "reportedStatusDescriptorHeld",
    "reportedSupervisorPidfdHeld",
    "reportedDirectChildWaitAuthority",
    "reportedSupervisorReaped",
  ]) {
    assert.throws(() => createCandidateContainmentGuardianRecoveryExecutorPlanV1({
      ...recoveryInput(),
      [inheritedField]: true,
    }));
  }
  const stateInsertions = [
    ["COMMAND_DESCRIPTOR_CLOSE_INTENT_DURABLE", "COMMAND_DESCRIPTOR_CLOSED_OBSERVED"],
    ["STATUS_EOF_OBSERVED"],
    ["SUPERVISOR_PIDFD_READABLE_OBSERVED"],
    ["SUPERVISOR_PIDFD_HUP_OBSERVED"],
    ["SUPERVISOR_REAP_INTENT_DURABLE", "SUPERVISOR_REAPED_OBSERVED"],
  ];
  for (const insertion of stateInsertions) {
    const recoveryStates = [...SAME_BOOT_STATES];
    recoveryStates.splice(recoveryStates.indexOf("CGROUP_REMOVAL_INTENT_DURABLE"), 0, ...insertion);
    assert.throws(() => createCandidateContainmentGuardianRecoveryExecutorPlanV1({
      ...recoveryInput(), recoveryStates,
    }));
  }
});

test("recovery state sequence fails closed on omission, insertion, reorder, and duplicate", () => {
  const variants = [
    SAME_BOOT_STATES.slice(1),
    [...SAME_BOOT_STATES, "CONTROL_PATH_ABSENT_OBSERVED"],
    [SAME_BOOT_STATES[1], SAME_BOOT_STATES[0], ...SAME_BOOT_STATES.slice(2)],
    [...SAME_BOOT_STATES, SAME_BOOT_STATES[0]],
  ];
  for (const recoveryStates of variants) {
    assert.throws(() => createCandidateContainmentGuardianRecoveryExecutorPlanV1({ ...recoveryInput(), recoveryStates }));
  }
});

test("65-item recovery-state and trace inputs hit the bounds gate before element processing", () => {
  let recoveryElementGetterHits = 0;
  const recoveryStates = Array(65).fill("RECOVERY_ATTEMPT_DURABLE");
  Object.defineProperty(recoveryStates, "0", {
    configurable: true,
    enumerable: true,
    get() {
      recoveryElementGetterHits += 1;
      throw new Error("recovery element processed");
    },
  });
  assert.throws(
    () => createCandidateContainmentGuardianRecoveryExecutorPlanV1({
      ...recoveryInput(), recoveryStates,
    }),
    /recovery states length is outside its exact bound/u,
  );
  assert.equal(recoveryElementGetterHits, 0);

  const plan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(liveInput());
  let traceElementGetterHits = 0;
  const trace = Array(65).fill(null);
  Object.defineProperty(trace, "0", {
    configurable: true,
    enumerable: true,
    get() {
      traceElementGetterHits += 1;
      throw new Error("trace element processed");
    },
  });
  assert.throws(
    () => createCandidateContainmentGuardianRecoveryExecutionV1({ plan, trace }),
    /trace length is outside its exact bound/u,
  );
  assert.equal(traceElementGetterHits, 0);
});

test("pathname substitution, PID signalling, intent drift, and trace overrun are rejected", () => {
  const plan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(recoveryInput());
  const faults = [];
  const path = clone(plan);
  path.steps.find((step) => step.operation === "WRITE_CGROUP_KILL").target = "../job";
  faults.push(path);
  const pid = clone(createCandidateContainmentGuardianRecoveryExecutorPlanV1(liveInput()));
  pid.steps.find((step) => step.operation === "WAITID_P_PIDFD_EXCLUSIVE").operation = "SIGNAL_PID";
  faults.push(pid);
  const intent = clone(plan);
  intent.steps.find((step) => step.kind === "EFFECT").intentSequence = 999;
  faults.push(intent);
  const order = clone(plan);
  [order.steps[3], order.steps[4]] = [order.steps[4], order.steps[3]];
  faults.push(order);
  const extra = clone(plan);
  extra.steps.push(clone(extra.steps.at(-1)));
  faults.push(extra);
  for (const fault of faults) assert.throws(() => verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(fault));
});

test("recovery quiescence, removal, and both parent syncs are mandatory", () => {
  const plan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(recoveryInput());
  for (const operation of [
    "CONTROL_QUIESCENT_OBSERVED", "JOB_QUIESCENT_OBSERVED",
    "CGROUP_PATHS_ABSENT_OBSERVED", "SYNC_SOURCE_PARENT",
    "SYNC_DESTINATION_PARENT", "RECOVERED_LOCATION_OBSERVED",
  ]) {
    const fault = clone(plan);
    const index = fault.steps.findIndex((step) => step.operation === operation);
    fault.steps.splice(index, 1);
    assert.throws(() => verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(fault), operation);
  }
});

test("live cancellation rejects every status/reap/cleanup/closure/CLOSED order inversion", () => {
  const plan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(liveInput());
  const operations = [
    "STATUS_EOF_OBSERVED", "WAITID_P_PIDFD_EXCLUSIVE", "SUPERVISOR_REAPED_OBSERVED",
    "CLEANUP_INTENT_DURABLE", "CGROUPS_QUIESCENT_OBSERVED",
    "CGROUPS_REMOVED_OBSERVED", "GUARDIAN_DESCRIPTORS_CLOSED_OBSERVED",
    "CLOSED_DURABLE",
  ];
  for (let index = 0; index < operations.length - 1; index += 1) {
    const fault = clone(plan);
    const left = fault.steps.findIndex((step) => step.operation === operations[index]);
    const right = fault.steps.findIndex((step) => step.operation === operations[index + 1]);
    [fault.steps[left], fault.steps[right]] = [fault.steps[right], fault.steps[left]];
    assert.throws(() => verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(fault));
  }
  for (const operation of operations) {
    const fault = clone(plan);
    fault.steps.splice(fault.steps.findIndex((step) => step.operation === operation), 1);
    assert.throws(() => verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(fault));
  }
});

test("wrong move destination and decision-adoption confusion are rejected", () => {
  const plan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(recoveryInput());
  const destination = clone(plan);
  destination.steps.find((step) => step.operation === "MOVE_GENERATION_NO_REPLACE").target = "closed";
  assert.throws(() => verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(destination));
  assert.throws(() => createCandidateContainmentGuardianRecoveryExecutorPlanV1({
    mode: "RECOVERY_ONLY", disposition: "RECOVERED_DECISION_RESUME",
    actorKind: "RECOVERY_ONLY_GUARDIAN", parentage: "AMBIGUOUS",
    sourceLocation: "quarantined", decisionSourceLocation: "staging",
    recoveryStates: ["RECOVERY_ATTEMPT_DURABLE", "RECOVERED_TOMBSTONE_ADOPTED", "RECOVERED_LOCATION_OBSERVED"],
  }));
});

test("execution rejects missing, unlisted, reordered, or false-positive events", () => {
  const plan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(liveInput());
  const { execution } = runIsolatedGuardianRecoveryExecutorFixtureS2(plan);
  const traces = [];
  const missing = clone(execution.trace);
  missing.pop();
  traces.push(missing);
  const unlisted = clone(execution.trace);
  unlisted.push({ ...unlisted.at(-1), sequence: 999, operation: "UNLISTED" });
  traces.push(unlisted);
  const reordered = clone(execution.trace);
  [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
  traces.push(reordered);
  const falsePositive = clone(execution.trace);
  falsePositive.find((event) => event.kind === "EFFECT").outcome = "PHYSICAL_EFFECT_PROVEN";
  traces.push(falsePositive);
  for (const trace of traces) assert.throws(() => createCandidateContainmentGuardianRecoveryExecutionV1({ plan, trace }));
});

test("execution envelope cannot upgrade authority, physical facts, readiness, or binding", () => {
  const plan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(liveInput());
  const { execution } = runIsolatedGuardianRecoveryExecutorFixtureS2(plan);
  for (const mutate of [
    (value) => { value.authority.cgroupMutation = true; },
    (value) => { value.physicalFacts.controllerLoss = true; },
    (value) => { value.readiness.status = "ready"; },
    (value) => { value.binding = "runtime"; },
  ]) {
    const fault = clone(execution);
    mutate(fault);
    assert.throws(() => verifyCandidateContainmentGuardianRecoveryExecutionV1(fault));
  }
});

test("plan and embedded execution plan reject nested getters without invoking them", () => {
  const validPlan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(liveInput());
  const { execution: validExecution } = runIsolatedGuardianRecoveryExecutorFixtureS2(validPlan);
  const cases = [
    ["step", (value) => value.steps[0], "operation"],
    ["authority", (value) => value.authority, "cgroupMutation"],
    ["physical facts", (value) => value.physicalFacts, "controllerLoss"],
    ["readiness", (value) => value.readiness, "status"],
  ];
  for (const [label, select, field] of cases) {
    const plan = clone(validPlan);
    const record = select(plan);
    const expected = record[field];
    let getterHits = 0;
    Object.defineProperty(record, field, {
      configurable: true,
      enumerable: true,
      get() {
        getterHits += 1;
        return expected;
      },
    });
    assert.throws(
      () => verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(plan),
      undefined,
      label,
    );
    assert.equal(getterHits, 0, label);
  }

  const execution = clone(validExecution);
  const expected = execution.plan.steps[0].operation;
  let embeddedGetterHits = 0;
  Object.defineProperty(execution.plan.steps[0], "operation", {
    configurable: true,
    enumerable: true,
    get() {
      embeddedGetterHits += 1;
      return expected;
    },
  });
  assert.throws(() => verifyCandidateContainmentGuardianRecoveryExecutionV1(execution));
  assert.equal(embeddedGetterHits, 0);
});

test("plan and embedded execution plan reject nested proxies without observing traps", () => {
  const validPlan = createCandidateContainmentGuardianRecoveryExecutorPlanV1(liveInput());
  const { execution: validExecution } = runIsolatedGuardianRecoveryExecutorFixtureS2(validPlan);
  const trapNames = ["get", "ownKeys", "getOwnPropertyDescriptor", "getPrototypeOf"];
  const wrap = (target, trapHits) => new Proxy(target, Object.fromEntries(
    trapNames.map((name) => [name, (...args) => {
      trapHits.count += 1;
      return Reflect[name](...args);
    }]),
  ));
  const cases = [
    ["step", (value, proxy) => { value.steps[0] = proxy; }, validPlan.steps[0]],
    ["authority", (value, proxy) => { value.authority = proxy; }, validPlan.authority],
    ["physical facts", (value, proxy) => { value.physicalFacts = proxy; }, validPlan.physicalFacts],
    ["readiness", (value, proxy) => { value.readiness = proxy; }, validPlan.readiness],
  ];
  for (const [label, install, target] of cases) {
    const plan = clone(validPlan);
    const trapHits = { count: 0 };
    install(plan, wrap(clone(target), trapHits));
    assert.throws(
      () => verifyCandidateContainmentGuardianRecoveryExecutorPlanV1(plan),
      undefined,
      label,
    );
    assert.equal(trapHits.count, 0, label);
  }

  const execution = clone(validExecution);
  const embeddedTrapHits = { count: 0 };
  execution.plan.steps[0] = wrap(clone(validPlan.steps[0]), embeddedTrapHits);
  assert.throws(() => verifyCandidateContainmentGuardianRecoveryExecutionV1(execution));
  assert.equal(embeddedTrapHits.count, 0);
});
