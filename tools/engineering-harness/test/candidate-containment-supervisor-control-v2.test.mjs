import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2,
  createCandidateContainmentLaunchArgvV2,
  createCandidateContainmentLaunchCapsuleV2,
  createCandidateContainmentLaunchEnvironmentV2,
} from "../src/candidate/containment-launch-capsule-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_AUTHORITY_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_FRAME_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_NONCLAIMS_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_REPLAY_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_STATUS_SCHEMA_V2,
  createCandidateContainmentSupervisorControlFrameV2,
  createCandidateContainmentSupervisorInteractiveStartV2,
  verifyCandidateContainmentSupervisorControlFrameV2,
  verifyCandidateContainmentSupervisorInteractiveReplayV2,
  verifyCandidateContainmentSupervisorInteractiveStartV2,
} from "../src/candidate/containment-supervisor-control-v2.mjs";
import { candidateContainmentOwnerV2Readiness } from "../src/candidate/containment-owner-v2.mjs";
import { sandboxSessionV2ContainmentReadiness } from "../src/candidate/sandbox-session-v2.mjs";
import { commandIds } from "../src/command-registry.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import { engineeringTaskIds } from "../src/task-profile.mjs";

const CONTRACT_ERROR = /candidate containment supervisor control/u;
const requestSha256 = "1".repeat(64);
const generationSha256 = "2".repeat(64);
const guardianNonceSha256 = "3".repeat(64);
const limits = Object.freeze({
  memoryMaxBytes: 8_589_934_592,
  memorySwapMaxBytes: 0,
  tasksMax: 512,
  wallMs: 2_700_000,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function launchCapsule({
  request = requestSha256,
  generation = generationSha256,
} = {}) {
  const argv = createCandidateContainmentLaunchArgvV2({
    argv: ["/usr/bin/bwrap", "--clearenv", "--", "/usr/bin/node"],
  });
  const environment = createCandidateContainmentLaunchEnvironmentV2({
    environment: { LANG: "C.UTF-8", PATH: "/usr/bin:/bin" },
  });
  const files = CANDIDATE_CONTAINMENT_LAUNCH_FILE_SPECS_V2.map(
    (spec, index) => {
      const bytes =
        spec.role === "childExecutable"
          ? Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x01, 0x01, 0x00])
          : spec.role === "launchArgv"
            ? argv.bytes
            : spec.role === "launchEnvironment"
              ? environment.bytes
              : spec.role === "childResult"
                ? Buffer.alloc(0)
                : Buffer.from(`${spec.role}\n`, "utf8");
      return {
        role: spec.role,
        supervisorFd: spec.supervisorFd,
        childFd: spec.childFd,
        destination: spec.destination,
        accessMode: spec.accessMode,
        permissions: spec.permissions,
        byteLength: bytes.length,
        sha256: sha256(bytes),
        initialOffset: 0,
        closeOnExec: true,
        contentBytes: bytes,
        identity: {
          device: "2049",
          inode: String(20_000 + index),
          links: "1",
          type: "regular",
          permissions: spec.permissions,
          owner: "1000",
          group: "1000",
          size: String(bytes.length),
          modifiedNs: String(1_700_000_001_000_000_000n + BigInt(index)),
          changedNs: String(1_700_000_002_000_000_000n + BigInt(index)),
        },
      };
    },
  );
  return createCandidateContainmentLaunchCapsuleV2({
    requestSha256: request,
    generationSha256: generation,
    argvBytes: argv.bytes,
    environmentBytes: environment.bytes,
    files,
    resultMaximumBytes: 256 * 1024 * 1024,
  });
}

function startArtifact() {
  const capsule = launchCapsule();
  const start = createCandidateContainmentSupervisorInteractiveStartV2({
    requestSha256,
    generationSha256,
    guardianNonceSha256,
    launchCapsuleBytes: capsule.bytes,
    limits: { ...limits },
  });
  return {
    bytes: start.bytes,
    artifact: start.artifact,
    launchCapsuleBytes: capsule.bytes,
  };
}

function ownerRequestSha256() {
  return sha256(
    Buffer.from(
      JSON.stringify({
        schema: "oxigraph.candidate-containment-owner-request/v1",
        requestSha256,
        limits,
      }),
      "utf8",
    ),
  );
}

function event(direction, bytes) {
  return { direction, bytes };
}

function statusFrame(start, state, decisionBytes = null) {
  const projection = verifyCandidateContainmentSupervisorInteractiveStartV2({
    startBytes: start.bytes,
    launchCapsuleBytes: start.launchCapsuleBytes,
  });
  const common = {
    schema: CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_STATUS_SCHEMA_V2,
    sequence: state === "READY" ? 0 : 1,
    state,
    startRawSha256: projection.rawSha256,
    ownerRequestSha256: projection.ownerRequestSha256,
    generationSha256: projection.generationSha256,
    guardianNonceSha256: projection.guardianNonceSha256,
    decisionRawSha256: decisionBytes === null ? null : sha256(decisionBytes),
  };
  let evidence;
  if (state === "READY") {
    evidence = {
      requestValidated: true,
      launchCapsuleValidated: true,
      soleStatusWriter: true,
      sessionCgroupFd: 3,
      sessionCgroupRole: "sessionCgroup",
      filesystem: "cgroup2",
      type: "domain\n",
      initialProcs: "",
      memoryMax: `${limits.memoryMaxBytes}\n`,
      memorySwapMax: "0\n",
      pidsMax: `${limits.tasksMax}\n`,
    };
  } else if (state === "CLONE_COMMIT_STARTED") {
    evidence = {
      syscall: "clone3",
      cloneArgsSize: 88,
      flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
      exitSignal: "SIGCHLD",
      executableScratchCreated: true,
      executableScratchMinimumFd: 18,
      pidfd: 23,
      pidfdRole: "childPidfd",
      remapPlanSha256: projection.launchCapsule.remapPlanSha256,
    };
  } else {
    evidence = {
      cloneCommitStarted: false,
      childCreated: false,
      sessionCgroupFdClosed: true,
      pidfdCreated: false,
      cleanupOwner: "guardian",
      cleanupOutcomeReportedBySupervisor: null,
    };
  }
  return Buffer.from(`${canonicalJson({ ...common, evidence })}\n`, "utf8");
}

function controlFrame(start, action, afterCommit = false, reason = null) {
  return createCandidateContainmentSupervisorControlFrameV2({
    startBytes: start.bytes,
    launchCapsuleBytes: start.launchCapsuleBytes,
    action,
    reason,
    afterCommit,
  });
}

function commitEvents(start = startArtifact()) {
  const commit = controlFrame(start, "COMMIT");
  return [
    event("guardian-to-supervisor", start.bytes),
    event("supervisor-to-guardian", statusFrame(start, "READY")),
    event("guardian-to-supervisor", commit.bytes),
    event(
      "supervisor-to-guardian",
      statusFrame(start, "CLONE_COMMIT_STARTED", commit.bytes),
    ),
  ];
}

function precommitCancelEvents(start = startArtifact()) {
  const cancel = controlFrame(start, "CANCEL", false, "caller-abort");
  return [
    event("guardian-to-supervisor", start.bytes),
    event("supervisor-to-guardian", statusFrame(start, "READY")),
    event("guardian-to-supervisor", cancel.bytes),
    event(
      "supervisor-to-guardian",
      statusFrame(start, "CANCELLED_BEFORE_CLONE", cancel.bytes),
    ),
  ];
}

function postcommitCancelEvents(start = startArtifact()) {
  const cancel = controlFrame(start, "CANCEL", true, "caller-abort");
  return [
    ...commitEvents(start),
    event("guardian-to-supervisor", cancel.bytes),
  ];
}

function observation(kind, overrides = {}) {
  const terminal = kind === "precommit-cancel";
  return {
    commandEofObserved: terminal,
    statusEofObserved: terminal,
    statusEofCount: terminal ? 1 : 0,
    eofAfterFinalStatus: terminal,
    writerCountAtLaunch: 1,
    writerDuplicationObserved: false,
    commandWriteError: null,
    statusReadError: null,
    diagnosticsBytes: 0,
    diagnosticsSha256: sha256(Buffer.alloc(0)),
    supervisorExitCode: terminal ? 124 : null,
    supervisorSignal: null,
    supervisorReaped: terminal,
    ...overrides,
  };
}

function replay(
  events,
  kind,
  observationOverrides = {},
  capsuleBytes = launchCapsule().bytes,
) {
  return verifyCandidateContainmentSupervisorInteractiveReplayV2({
    events,
    launchCapsuleBytes: capsuleBytes,
    observation: observation(kind, observationOverrides),
  });
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (
    value === null ||
    typeof value !== "object" ||
    ArrayBuffer.isView(value) ||
    seen.has(value)
  ) {
    return;
  }
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("interactive START and COMMIT/CANCEL frames are canonical and bind capsule, owner, generation, nonce, and requirements", () => {
  const start = startArtifact();
  const projection = verifyCandidateContainmentSupervisorInteractiveStartV2({
    startBytes: start.bytes,
    launchCapsuleBytes: start.launchCapsuleBytes,
  });
  assert.equal(
    projection.protocolSchema,
    CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_START_SCHEMA_V2,
  );
  assert.equal(projection.action, "START");
  assert.equal(projection.sequence, 0);
  assert.equal(projection.requestSha256, requestSha256);
  assert.equal(projection.ownerRequestSha256, ownerRequestSha256());
  assert.equal(projection.generationSha256, generationSha256);
  assert.equal(projection.guardianNonceSha256, guardianNonceSha256);
  assert.equal(
    projection.controlRequirementsSha256,
    CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_SHA256_V2,
  );
  assert.equal(projection.launchCapsule.requestSha256, requestSha256);
  assert.equal(projection.launchCapsule.generationSha256, generationSha256);
  assert.equal(projection.binding, null);
  assert.equal(projection.physicalEligibility, false);
  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_V2.precommitCleanupOwner,
    "guardian",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_REQUIREMENTS_V2.supervisorMayRemoveSessionCgroup,
    false,
  );

  for (const [action, afterCommit, reason, sequence] of [
    ["COMMIT", false, null, 1],
    ["CANCEL", false, "caller-abort", 1],
    ["CANCEL", true, "decision-timeout", 2],
  ]) {
    const created = controlFrame(start, action, afterCommit, reason);
    const control = verifyCandidateContainmentSupervisorControlFrameV2({
      startBytes: start.bytes,
      launchCapsuleBytes: start.launchCapsuleBytes,
      controlBytes: created.bytes,
    });
    assert.equal(
      control.protocolSchema,
      CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_SCHEMA_V2,
    );
    assert.equal(control.action, action);
    assert.equal(control.sequence, sequence);
    assert.equal(control.reason, reason);
    assert.equal(control.startRawSha256, projection.rawSha256);
    assert.equal(
      created.bytes.length <=
        CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_FRAME_MAX_BYTES_V2,
      true,
    );
    const copy = created.bytes;
    copy.fill(0);
    assert.equal(created.artifact.sha256, sha256(created.bytes));
  }
  assertDeepFrozen(projection);
});

test("interactive replay independently re-executes the exact commit, precommit cancel, and postcommit cancel reducers", () => {
  const committed = replay(commitEvents(), "open");
  assert.equal(
    committed.schema,
    CANDIDATE_CONTAINMENT_SUPERVISOR_INTERACTIVE_REPLAY_SCHEMA_V2,
  );
  assert.equal(committed.status, "COMMIT_ACKNOWLEDGED_REPLAYED");
  assert.deepEqual(committed.states, [
    "START",
    "READY",
    "COMMIT",
    "CLONE_COMMIT_STARTED",
  ]);
  assert.equal(committed.reportedCommitPointCrossed, true);
  assert.equal(committed.commitPointCrossed, null);
  assert.equal(committed.reportedCancelRequested, false);
  assert.equal(committed.cancelRequested, null);
  assert.equal(committed.transcriptTerminal, false);
  assert.equal(committed.terminal, null);
  assert.equal(committed.cleanupSafe, null);

  const precommit = replay(precommitCancelEvents(), "precommit-cancel");
  assert.equal(precommit.status, "PRECOMMIT_CANCELLED_REPLAYED");
  assert.equal(precommit.reportedCommitPointCrossed, false);
  assert.equal(precommit.commitPointCrossed, null);
  assert.equal(precommit.reportedCancelRequested, true);
  assert.equal(precommit.cancelRequested, null);
  assert.equal(precommit.reportedCleanupSafe, null);
  assert.equal(precommit.cleanupSafe, null);
  assert.equal(precommit.transcriptTerminal, true);
  assert.equal(precommit.terminal, null);
  assert.deepEqual(
    { ...precommit.events[3].frame.evidence },
    {
      cloneCommitStarted: false,
      childCreated: false,
      sessionCgroupFdClosed: true,
      pidfdCreated: false,
      cleanupOwner: "guardian",
      cleanupOutcomeReportedBySupervisor: null,
    },
  );

  const postcommit = replay(postcommitCancelEvents(), "open");
  assert.equal(postcommit.status, "POSTCOMMIT_CANCEL_REQUESTED_REPLAYED");
  assert.equal(postcommit.reportedCommitPointCrossed, true);
  assert.equal(postcommit.commitPointCrossed, null);
  assert.equal(postcommit.reportedCancelRequested, true);
  assert.equal(postcommit.cancelRequested, null);
  assert.equal(postcommit.transcriptTerminal, false);
  assert.equal(postcommit.terminal, null);
  assert.equal(postcommit.cleanupSafe, null);

  for (const projection of [committed, precommit, postcommit]) {
    assert.equal(projection.binding, null);
    assert.equal(projection.physicalEligibility, false);
    assert.equal(projection.finalDecisionEligible, false);
    assert.equal(
      projection.projectionSha256,
      canonicalSha256(
        Object.fromEntries(
          Object.entries(projection).filter(
            ([key]) => key !== "projectionSha256",
          ),
        ),
      ),
    );
    assertDeepFrozen(projection);
  }
});

test("interactive replay authority and nonclaims stay false for every serialized branch", () => {
  assert.equal(
    Object.values(CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_AUTHORITY_V2).every(
      (value) => value === false,
    ),
    true,
  );
  assert.equal(
    Object.values(CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_NONCLAIMS_V2).every(
      (value) => value === false,
    ),
    true,
  );
  const projection = replay(commitEvents(), "open");
  assert.strictEqual(
    projection.authority,
    CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_AUTHORITY_V2,
  );
  assert.strictEqual(
    projection.nonclaims,
    CANDIDATE_CONTAINMENT_SUPERVISOR_CONTROL_NONCLAIMS_V2,
  );
});

test("interactive frames reject forged shapes, invalid decisions, stale bindings, accessors, proxies, and noncanonical bytes", () => {
  const start = startArtifact();
  for (const value of [
    null,
    [],
    new Proxy(
      {
        requestSha256,
        generationSha256,
        guardianNonceSha256,
        launchCapsuleBytes: launchCapsule().bytes,
        limits: { ...limits },
      },
      {},
    ),
    {
      requestSha256,
      generationSha256,
      guardianNonceSha256,
      launchCapsuleBytes: launchCapsule().bytes,
      limits: { ...limits },
      authority: true,
    },
    {
      requestSha256,
      generationSha256: "F".repeat(64),
      guardianNonceSha256,
      launchCapsuleBytes: launchCapsule().bytes,
      limits: { ...limits },
    },
    {
      requestSha256,
      generationSha256,
      guardianNonceSha256,
      launchCapsuleBytes: launchCapsule().bytes,
      limits: { ...limits, tasksMax: 513 },
    },
  ]) {
    assert.throws(
      () => createCandidateContainmentSupervisorInteractiveStartV2(value),
      CONTRACT_ERROR,
    );
  }

  for (const value of [
    {
      startBytes: start.bytes,
      launchCapsuleBytes: start.launchCapsuleBytes,
      action: "START",
      reason: null,
      afterCommit: false,
    },
    {
      startBytes: start.bytes,
      launchCapsuleBytes: start.launchCapsuleBytes,
      action: "COMMIT",
      reason: "caller-abort",
      afterCommit: false,
    },
    {
      startBytes: start.bytes,
      launchCapsuleBytes: start.launchCapsuleBytes,
      action: "COMMIT",
      reason: null,
      afterCommit: true,
    },
    {
      startBytes: start.bytes,
      launchCapsuleBytes: start.launchCapsuleBytes,
      action: "CANCEL",
      reason: null,
      afterCommit: false,
    },
    {
      startBytes: start.bytes,
      launchCapsuleBytes: start.launchCapsuleBytes,
      action: "CANCEL",
      reason: "unknown",
      afterCommit: false,
    },
    {
      startBytes: start.bytes,
      launchCapsuleBytes: start.launchCapsuleBytes,
      action: "CANCEL",
      reason: "caller-abort",
      afterCommit: "yes",
    },
  ]) {
    assert.throws(
      () => createCandidateContainmentSupervisorControlFrameV2(value),
      CONTRACT_ERROR,
    );
  }

  const commit = controlFrame(start, "COMMIT").bytes;
  const parsed = JSON.parse(commit);
  parsed.generationSha256 = "f".repeat(64);
  const rejected = [
    Buffer.alloc(0),
    commit.subarray(0, commit.length - 1),
    Buffer.from(commit.toString("utf8").replace("\n", "\r\n"), "utf8"),
    Buffer.concat([commit, commit]),
    Buffer.from(`${canonicalJson(parsed)}\n`, "utf8"),
  ];
  for (const bytes of rejected) {
    assert.throws(
      () =>
        verifyCandidateContainmentSupervisorControlFrameV2({
          startBytes: start.bytes,
          launchCapsuleBytes: start.launchCapsuleBytes,
          controlBytes: bytes,
        }),
      CONTRACT_ERROR,
    );
  }

  const forgedStartBody = JSON.parse(start.bytes);
  forgedStartBody.launchCapsuleRawSha256 = "f".repeat(64);
  forgedStartBody.launchCapsuleProjectionSha256 = "e".repeat(64);
  const forgedStartBytes = Buffer.from(
    `${canonicalJson(forgedStartBody)}\n`,
    "utf8",
  );
  assert.throws(
    () =>
      verifyCandidateContainmentSupervisorInteractiveStartV2({
        startBytes: forgedStartBytes,
        launchCapsuleBytes: start.launchCapsuleBytes,
      }),
    CONTRACT_ERROR,
  );
  assert.throws(
    () =>
      verifyCandidateContainmentSupervisorInteractiveStartV2({
        startBytes: start.bytes,
        launchCapsuleBytes: launchCapsule({
          generation: "4".repeat(64),
        }).bytes,
      }),
    CONTRACT_ERROR,
  );
});

test("interactive reducer rejects missing, duplicate, reordered, direction-swapped, tampered, and terminally ambiguous events", () => {
  const base = commitEvents();
  const mutations = [
    base.slice(0, -1),
    [...base, base.at(-1)],
    [base[0], base[2], base[1], base[3]],
    base.map((entry, index) =>
      index === 1 ? { ...entry, direction: "guardian-to-supervisor" } : entry,
    ),
  ];
  for (const events of mutations) {
    assert.throws(() => replay(events, "open"), CONTRACT_ERROR);
  }

  const tampered = commitEvents();
  const ready = JSON.parse(tampered[1].bytes);
  ready.evidence.initialProcs = "4242\n";
  tampered[1] = event(
    "supervisor-to-guardian",
    Buffer.from(`${canonicalJson(ready)}\n`, "utf8"),
  );
  assert.throws(() => replay(tampered, "open"), CONTRACT_ERROR);

  const staleDecision = commitEvents();
  const cloneStarted = JSON.parse(staleDecision[3].bytes);
  cloneStarted.decisionRawSha256 = "f".repeat(64);
  staleDecision[3] = event(
    "supervisor-to-guardian",
    Buffer.from(`${canonicalJson(cloneStarted)}\n`, "utf8"),
  );
  assert.throws(() => replay(staleDecision, "open"), CONTRACT_ERROR);

  const readyWithDecision = commitEvents();
  const readyDecision = JSON.parse(readyWithDecision[1].bytes);
  readyDecision.decisionRawSha256 = "f".repeat(64);
  readyWithDecision[1] = event(
    "supervisor-to-guardian",
    Buffer.from(`${canonicalJson(readyDecision)}\n`, "utf8"),
  );
  assert.throws(() => replay(readyWithDecision, "open"), CONTRACT_ERROR);

  assert.throws(
    () =>
      replay(
        commitEvents(),
        "open",
        {},
        launchCapsule({ generation: "4".repeat(64) }).bytes,
      ),
    CONTRACT_ERROR,
  );

  for (const overrides of [
    { statusEofObserved: true },
    { statusEofCount: 1 },
    { writerCountAtLaunch: 2 },
    { writerDuplicationObserved: true },
    { commandWriteError: "EPIPE" },
    { statusReadError: "EIO" },
    { diagnosticsBytes: 1 },
    { diagnosticsBytes: 1, diagnosticsSha256: "f".repeat(64) },
    { supervisorExitCode: 0 },
    { supervisorSignal: "SIGKILL" },
    { supervisorReaped: true },
  ]) {
    assert.throws(
      () => replay(commitEvents(), "open", overrides),
      CONTRACT_ERROR,
    );
  }

  for (const overrides of [
    { commandEofObserved: false },
    { statusEofObserved: false },
    { statusEofCount: 0 },
    { eofAfterFinalStatus: false },
    { supervisorExitCode: 0 },
    { supervisorExitCode: null },
    { supervisorReaped: false },
  ]) {
    assert.throws(
      () => replay(precommitCancelEvents(), "precommit-cancel", overrides),
      CONTRACT_ERROR,
    );
  }
});

test("interactive additive slice does not alter production readiness or registry activation", () => {
  const readiness = candidateContainmentOwnerV2Readiness();
  assert.deepEqual(readiness, {
    status: "unavailable",
    reason: "native-adapter-unavailable",
  });
  assert.strictEqual(sandboxSessionV2ContainmentReadiness(), readiness);
  assert.equal(engineeringTaskIds.length, 9);
  assert.equal(commandIds().length, 33);
  assert.equal(
    commandIds().some((id) => id.includes("g2.2")),
    false,
  );
});
