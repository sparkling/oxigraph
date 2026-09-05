import {
  createCandidateContainmentGuardianRecoveryExecutionV1,
} from "../../src/candidate/containment-guardian-recovery-executor-v1.mjs";

function fail(message) {
  throw new Error(`isolated S2 fixture: ${message}`);
}

function outcome(kind) {
  if (kind === "INTENT_DURABLE" || kind === "DURABLE_STATE") return "DURABLE_MODEL_RECORDED";
  if (kind === "EFFECT") return "SYNTHETIC_EFFECT_COMPLETED";
  return "SYNTHETIC_OBSERVATION_MATCHED";
}

export function runIsolatedGuardianRecoveryExecutorFixtureS2(plan) {
  const recovery = plan.mode === "RECOVERY_ONLY";
  const hasStep = (operation, target) => plan.steps.some(
    (step) => step.operation === operation && (target === undefined || step.target === target),
  );
  const ctlPresent = recovery && hasStep("WRITE_CGROUP_KILL", "ctl");
  const jobPresent = recovery && hasStep("WRITE_CGROUP_KILL", "job");
  const state = {
    cgroups: {
      ctl: { exists: ctlPresent, configured: ctlPresent, populated: ctlPresent },
      job: { exists: jobPresent, configured: jobPresent, populated: jobPresent },
    },
    descriptors: {
      "controller-command": !recovery,
      "supervisor-command": !recovery || hasStep("CLOSE_DESCRIPTOR", "supervisor-command"),
      "supervisor-status": !recovery || hasStep("STATUS_EOF_OBSERVED"),
      "supervisor-pidfd": !recovery && hasStep("WAITID_P_PIDFD_EXCLUSIVE"),
    },
    cancelWritten: false,
    statusEof: false,
    reapedByPidfd: false,
    closedDurable: false,
    location: plan.sourceLocation,
    synced: new Set(),
    durable: new Set(),
  };
  const trace = [];
  for (const step of plan.steps) {
    if (step.kind === "INTENT_DURABLE") state.durable.add(step.sequence);
    if (step.kind === "DURABLE_STATE" && step.operation === "CLOSED_DURABLE") {
      if (
        state.cgroups.ctl.exists ||
        state.cgroups.job.exists ||
        Object.values(state.descriptors).some((held) => held)
      ) fail("closed became durable before cleanup and descriptor closure");
      state.closedDurable = true;
    }
    if (step.kind === "EFFECT") {
      if (!state.durable.has(step.intentSequence)) fail("effect preceded its durable intent");
      if (step.operation === "CREATE_CGROUP") {
        if (state.cgroups[step.target].exists) fail("create target already existed");
        state.cgroups[step.target].exists = true;
      } else if (step.operation === "CONFIGURE_CGROUP") {
        if (!state.cgroups[step.target].exists) fail("configure target absent");
        state.cgroups[step.target].configured = true;
        state.cgroups[step.target].populated = false;
      } else if (step.operation === "WRITE_CANCEL_COMMAND") {
        if (!state.descriptors[step.target]) fail("cancel command descriptor closed");
        state.cancelWritten = true;
      } else if (step.operation === "WRITE_CGROUP_KILL") {
        if (!state.cgroups[step.target].exists) fail("kill target absent");
        state.cgroups[step.target].populated = false;
      } else if (step.operation === "CLOSE_DESCRIPTOR") {
        state.descriptors[step.target] = false;
      } else if (step.operation === "WAITID_P_PIDFD_EXCLUSIVE") {
        if (!state.descriptors[step.target]) fail("pidfd unavailable for waitid");
        state.reapedByPidfd = true;
      } else if (step.operation === "REMOVE_CGROUP") {
        if (!state.cgroups[step.target].exists || state.cgroups[step.target].populated) {
          fail("remove target was absent or populated");
        }
        state.cgroups[step.target].exists = false;
      } else if (step.operation === "MOVE_GENERATION_NO_REPLACE") {
        if (state.location === step.target) fail("no-replace destination already occupied");
        state.location = step.target;
      } else if (step.operation === "SYNC_SOURCE_PARENT") {
        state.synced.add("source");
      } else if (step.operation === "SYNC_DESTINATION_PARENT") {
        state.synced.add("destination");
      } else {
        fail(`unlisted effect ${step.operation}`);
      }
    }
    if (step.kind === "OBSERVATION") {
      if (step.operation === "CGROUPS_CONFIGURED_EMPTY_OBSERVED" && (state.cgroups.ctl.populated || state.cgroups.job.populated)) fail("configured cgroups were not empty");
      if (step.operation === "CONTROLLER_COMMAND_EOF_OBSERVED") {
        state.descriptors[step.target] = false;
        state.cgroups.ctl.populated = true;
        state.cgroups.job.populated = true;
      }
      if (step.operation === "STATUS_EOF_OBSERVED") state.statusEof = true;
      if (step.operation === "CGROUP_QUIESCENT_OBSERVED" && state.cgroups[step.target].populated) fail("false quiescence");
      if (step.operation === "CGROUPS_QUIESCENT_OBSERVED" && (state.cgroups.ctl.populated || state.cgroups.job.populated)) fail("false aggregate quiescence");
      if (step.operation === "CGROUP_PATH_ABSENT_OBSERVED" && state.cgroups[step.target].exists) fail("false absence");
      if (step.operation === "CGROUP_PATHS_ABSENT_OBSERVED" && (state.cgroups.ctl.exists || state.cgroups.job.exists)) fail("false aggregate absence");
      if (step.operation === "CGROUPS_REMOVED_OBSERVED" && (state.cgroups.ctl.exists || state.cgroups.job.exists)) fail("false removed observation");
      if (step.operation === "RECOVERED_LOCATION_OBSERVED" && state.location !== "recovered") fail("false recovered location");
      if (step.operation === "QUARANTINED_LOCATION_OBSERVED" && state.location !== "quarantined") fail("false quarantine location");
      if (step.operation === "SUPERVISOR_REAPED_OBSERVED" && !state.reapedByPidfd) fail("false reap observation");
    }
    trace.push({
      sequence: step.sequence,
      kind: step.kind,
      operation: step.operation,
      target: step.target,
      intentSequence: step.intentSequence,
      outcome: outcome(step.kind),
    });
  }
  const execution = createCandidateContainmentGuardianRecoveryExecutionV1({ plan, trace });
  return {
    execution,
    final: Object.freeze({
      ctlExists: state.cgroups.ctl.exists,
      jobExists: state.cgroups.job.exists,
      cancelWritten: state.cancelWritten,
      statusEof: state.statusEof,
      reapedByPidfd: state.reapedByPidfd,
      location: state.location,
      sourceParentSynced: state.synced.has("source"),
      destinationParentSynced: state.synced.has("destination"),
      descriptorsClosed: Object.values(state.descriptors).every((held) => held === false),
      closedDurable: state.closedDurable,
    }),
  };
}
