import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CANDIDATE_CONTAINMENT_SUPERVISOR_AUTHORITY_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_NONCLAIMS_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_PROJECTION_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_BYTES_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_FRAMES_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_PROJECTION_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2,
  CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_TIMEOUT_MS_V2,
  createCandidateContainmentSupervisorRequestV2,
  verifyCandidateContainmentSupervisorRequestV2,
  verifyCandidateContainmentSupervisorStatusV2,
} from "../src/candidate/containment-protocol-v2.mjs";
import { isCandidateContainmentV2TestTrace } from "../src/candidate/containment-owner-v2.mjs";
import { isTrustedSandboxSessionV2Report } from "../src/candidate/sandbox-session-v2.mjs";
import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";

const CONTRACT_ERROR = /candidate containment supervisor protocol/u;
const requestSha256 = "1".repeat(64);
const generationSha256 = "2".repeat(64);
const launchArgvSha256 = "3".repeat(64);
const launchEnvironmentSha256 = "4".repeat(64);
const childStdinSha256 = "5".repeat(64);
const payloadClosureSha256 = "6".repeat(64);
const eventsRawSha256 = "7".repeat(64);
const limits = Object.freeze({
  memoryMaxBytes: 8_589_934_592,
  memorySwapMaxBytes: 0,
  tasksMax: 512,
  wallMs: 2_700_000,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function requestInput(overrides = {}) {
  return {
    requestSha256,
    generationSha256,
    launchArgvSha256,
    launchArgvCount: 12,
    launchArgvBytes: 384,
    launchEnvironmentSha256,
    launchEnvironmentCount: 8,
    launchEnvironmentBytes: 256,
    childStdinSha256,
    childStdinBytes: 4_096,
    payloadClosureSha256,
    limits: { ...limits },
    ...overrides,
  };
}

function createdRequest() {
  return createCandidateContainmentSupervisorRequestV2(requestInput());
}

function acquiredEvidence() {
  return {
    generationSha256,
    filesystem: "cgroup2",
    descriptorHeld: true,
    accessMode: "O_RDONLY|O_DIRECTORY|O_CLOEXEC",
    type: "domain",
    initialProcsEmpty: true,
    memoryMax: `${limits.memoryMaxBytes}\n`,
    memorySwapMax: "0\n",
    pidsMax: `${limits.tasksMax}\n`,
  };
}

function cloneCommitEvidence() {
  return {
    syscall: "clone3",
    cloneArgsSize: 88,
    flags: ["CLONE_INTO_CGROUP", "CLONE_PIDFD"],
    exitSignal: "SIGCHLD",
  };
}

function spawnedEvidence() {
  return {
    cgroupFdHeld: true,
    pidfdHeld: true,
    initialPlacement: true,
    fallbackUsed: false,
  };
}

function pidfdReadyEvidence() {
  return {
    mechanism: "pidfd-poll",
    bounded: true,
    pidfdReadable: true,
  };
}

function cancellingEvidence(reason) {
  return {
    reason,
    mechanism: "cgroup.kill",
    cgroupKillWritten: true,
  };
}

function reapedEvidence() {
  return {
    syscall: "waitid",
    idType: "P_PIDFD",
    options: ["WEXITED"],
    result: "REAPED",
    siCode: "CLD_EXITED",
    exitCode: 0,
    signal: null,
    coreDumped: false,
  };
}

function quiescentEvidence() {
  return {
    cgroupProcsBytes: 0,
    cgroupProcsSha256: sha256(Buffer.alloc(0)),
    cgroupEventsBytes: 23,
    cgroupEventsSha256: eventsRawSha256,
    pidsCurrentBytes: 2,
    pidsCurrentSha256: sha256(Buffer.from("0\n", "utf8")),
    cgroupProcsEmpty: true,
    cgroupPopulated: false,
    pidsCurrent: 0,
    eventsRawSha256,
  };
}

function removedEvidence() {
  return {
    cgroupRemoved: true,
    postCleanupOpen: "ENOENT",
    postCleanupStat: "ENOENT",
  };
}

function descriptorsClosedEvidence() {
  return {
    cgroupFdClosed: true,
    pidfdClosed: true,
  };
}

function closedEvidence() {
  return { cleanupSafe: true };
}

const evidenceByState = Object.freeze({
  ACQUIRED_EMPTY_CONFIGURED: acquiredEvidence,
  CLONE_COMMIT_STARTED: cloneCommitEvidence,
  SPAWN_COMMITTED: spawnedEvidence,
  PIDFD_READY: pidfdReadyEvidence,
  DIRECT_CHILD_REAPED: reapedEvidence,
  CGROUP_QUIESCENT: quiescentEvidence,
  CGROUP_REMOVED: removedEvidence,
  DESCRIPTORS_CLOSED: descriptorsClosedEvidence,
  CLOSED: closedEvidence,
});

const naturalStates = Object.freeze([
  "ACQUIRED_EMPTY_CONFIGURED",
  "CLONE_COMMIT_STARTED",
  "SPAWN_COMMITTED",
  "PIDFD_READY",
  "DIRECT_CHILD_REAPED",
  "CGROUP_QUIESCENT",
  "CGROUP_REMOVED",
  "DESCRIPTORS_CLOSED",
  "CLOSED",
]);
const waitCancellationStates = Object.freeze([
  "ACQUIRED_EMPTY_CONFIGURED",
  "CLONE_COMMIT_STARTED",
  "SPAWN_COMMITTED",
  "CANCELLING",
  "DIRECT_CHILD_REAPED",
  "CGROUP_QUIESCENT",
  "CGROUP_REMOVED",
  "DESCRIPTORS_CLOSED",
  "CLOSED",
]);
const descendantCancellationStates = Object.freeze([
  "ACQUIRED_EMPTY_CONFIGURED",
  "CLONE_COMMIT_STARTED",
  "SPAWN_COMMITTED",
  "PIDFD_READY",
  "DIRECT_CHILD_REAPED",
  "CANCELLING",
  "CGROUP_QUIESCENT",
  "CGROUP_REMOVED",
  "DESCRIPTORS_CLOSED",
  "CLOSED",
]);

function statusFrames(states, request = createdRequest()) {
  const requestProjection = verifyCandidateContainmentSupervisorRequestV2(
    request.bytes,
  );
  return states.map((state, sequence) => {
    const evidence =
      state === "CANCELLING"
        ? cancellingEvidence(
            states[sequence - 1] === "DIRECT_CHILD_REAPED"
              ? "descendants-present"
              : "wait-failed",
          )
        : evidenceByState[state]();
    return {
      schema: CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2,
      sequence,
      state,
      requestRawSha256: requestProjection.rawSha256,
      ownerRequestSha256: requestProjection.ownerRequestSha256,
      generationSha256: requestProjection.generationSha256,
      evidence,
    };
  });
}

function statusBytes(states, request = createdRequest()) {
  return Buffer.from(
    statusFrames(states, request)
      .map((frame) => `${canonicalJson(frame)}\n`)
      .join(""),
    "utf8",
  );
}

function observation(overrides = {}) {
  return {
    statusDeadlineMilliseconds:
      CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_TIMEOUT_MS_V2,
    statusTimedOut: false,
    eofObserved: true,
    eofCount: 1,
    eofAfterFinalFrame: true,
    readError: null,
    writerCountAtLaunch: 1,
    writerDuplicationObserved: false,
    supervisorExitCode: 0,
    supervisorSignal: null,
    supervisorReaped: true,
    ...overrides,
  };
}

function statusInput(
  states = naturalStates,
  observationOverrides = {},
  request = createdRequest(),
) {
  return {
    requestBytes: request.bytes,
    statusBytes: statusBytes(states, request),
    observation: observation(observationOverrides),
  };
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

function assertNullPrototypeRecords(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
    assert.equal(Object.getPrototypeOf(value), null);
  }
  for (const child of Object.values(value)) {
    assertNullPrototypeRecords(child, seen);
  }
}

test("candidate containment request freezes exact canonical owner, generation, launch, payload, and limit bytes", () => {
  const created = createdRequest();
  const expected = {
    schema: CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2,
    requestSha256,
    ownerRequestSha256: ownerRequestSha256(),
    generationSha256,
    requirementsSha256: CANDIDATE_CONTAINMENT_SUPERVISOR_REQUIREMENTS_SHA256_V2,
    fileDescriptorMapSha256: CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
    launchArgvSha256,
    launchArgvCount: 12,
    launchArgvBytes: 384,
    launchEnvironmentSha256,
    launchEnvironmentCount: 8,
    launchEnvironmentBytes: 256,
    childStdinSha256,
    childStdinBytes: 4_096,
    payloadClosureSha256,
    limits: { ...limits },
  };
  const expectedBytes = Buffer.from(`${canonicalJson(expected)}\n`, "utf8");

  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_SCHEMA_V2,
    "oxigraph.candidate-containment-supervisor-request/v1",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_PROJECTION_SCHEMA_V2,
    "oxigraph.candidate-containment-supervisor-request-replay/v1",
  );
  assert.equal(CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2, 4_096);
  assert.deepEqual(created.bytes, expectedBytes);
  assert.equal(created.artifact.name, "candidate-containment-request-v1.json");
  assert.equal(created.artifact.bytes, expectedBytes.length);
  assert.equal(created.artifact.sha256, sha256(expectedBytes));

  const callerCopy = created.bytes;
  callerCopy.fill(0);
  assert.deepEqual(created.bytes, expectedBytes);
  assert.equal(created.artifact.sha256, sha256(created.bytes));

  const projection = verifyCandidateContainmentSupervisorRequestV2(
    created.bytes,
  );
  assert.equal(
    projection.schema,
    CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_PROJECTION_SCHEMA_V2,
  );
  assert.equal(projection.protocolSchema, expected.schema);
  assert.equal(projection.rawSha256, sha256(expectedBytes));
  assert.equal(projection.ownerRequestSha256, ownerRequestSha256());
  assert.equal(projection.launchArgvSha256, launchArgvSha256);
  assert.equal(projection.launchEnvironmentSha256, launchEnvironmentSha256);
  assert.equal(projection.childStdinSha256, childStdinSha256);
  assert.equal(projection.payloadClosureSha256, payloadClosureSha256);
  assert.equal(
    projection.fileDescriptorMapSha256,
    CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
  );
  assert.equal(projection.binding, null);
  assert.equal(projection.physicalEligibility, false);
  assertDeepFrozen(projection);
  assertNullPrototypeRecords(projection);
});

test("candidate containment request and FD map are exact, bounded, and authority-free", () => {
  assert.deepEqual(
    { ...CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_V2 },
    {
      commandStream: 0,
      status: 1,
      diagnostics: 2,
      delegatedCgroup: 3,
      childLaunchExecutable: 4,
      childStdin: 5,
      supervisorSelf: 6,
      payloadSandboxWorker: 7,
      payloadProcess: 8,
      payloadBuildCommand: 9,
      payloadEvidenceLimits: 10,
      payloadSessionLimits: 11,
      payloadTaskFailures: 12,
      payloadRoutingFeatures: 13,
      payloadSeccompLauncher: 14,
    },
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_SHA256_V2,
    canonicalSha256(CANDIDATE_CONTAINMENT_SUPERVISOR_FD_MAP_V2),
  );
  assert.equal(
    Object.values(CANDIDATE_CONTAINMENT_SUPERVISOR_AUTHORITY_V2).every(
      (value) => value === false,
    ),
    true,
  );
  assert.equal(
    Object.values(CANDIDATE_CONTAINMENT_SUPERVISOR_NONCLAIMS_V2).every(
      (value) => value === false,
    ),
    true,
  );
});

test("candidate containment request rejects forged shapes, limits, owner digests, and noncanonical bytes", () => {
  const invalidInputs = [
    null,
    [],
    { ...requestInput(), authority: true },
    new Proxy(requestInput(), {}),
    requestInput({ requestSha256: "A".repeat(64) }),
    requestInput({ generationSha256: "2".repeat(63) }),
    requestInput({ launchArgvSha256: "3".repeat(65) }),
    requestInput({ launchArgvCount: 4_097 }),
    requestInput({ launchArgvBytes: 1_048_577 }),
    requestInput({ launchEnvironmentSha256: "4".repeat(63) }),
    requestInput({ launchEnvironmentCount: 4_097 }),
    requestInput({ launchEnvironmentBytes: 1_048_577 }),
    requestInput({ childStdinSha256: "5".repeat(63) }),
    requestInput({ childStdinBytes: 4_194_305 }),
    requestInput({ payloadClosureSha256: "6".repeat(63) }),
    requestInput({ limits: { ...limits, memorySwapMaxBytes: 1 } }),
    requestInput({ limits: { ...limits, tasksMax: 513 } }),
    requestInput({ limits: { ...limits, wallMs: -0 } }),
  ];
  for (const value of invalidInputs) {
    assert.throws(
      () => createCandidateContainmentSupervisorRequestV2(value),
      CONTRACT_ERROR,
    );
  }

  let accessed = false;
  const accessor = requestInput();
  Object.defineProperty(accessor, "requestSha256", {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error("must not access");
    },
  });
  assert.throws(
    () => createCandidateContainmentSupervisorRequestV2(accessor),
    CONTRACT_ERROR,
  );
  assert.equal(accessed, false);

  const valid = createdRequest().bytes;
  const parsed = JSON.parse(valid.toString("utf8"));
  parsed.ownerRequestSha256 = "f".repeat(64);
  const duplicate = Buffer.from(
    valid
      .toString("utf8")
      .replace(
        `"requestSha256":"${requestSha256}"`,
        `"requestSha256":"${requestSha256}","requestSha256":"${requestSha256}"`,
      ),
    "utf8",
  );
  const rejected = [
    Buffer.alloc(0),
    Buffer.from([0xc3, 0x28]),
    valid.subarray(0, valid.length - 1),
    Buffer.from(valid.toString("utf8").replace("\n", "\r\n"), "utf8"),
    Buffer.concat([valid, Buffer.from("\0")]),
    Buffer.concat([valid, valid]),
    Buffer.from(
      `${JSON.stringify(
        Object.fromEntries(Object.entries(JSON.parse(valid)).reverse()),
      )}\n`,
      "utf8",
    ),
    Buffer.from(`${canonicalJson(parsed)}\n`, "utf8"),
    duplicate,
    Buffer.alloc(CANDIDATE_CONTAINMENT_SUPERVISOR_REQUEST_MAX_BYTES_V2 + 1),
  ];
  for (const [index, value] of rejected.entries()) {
    assert.throws(
      () => verifyCandidateContainmentSupervisorRequestV2(value),
      CONTRACT_ERROR,
      `rejected request bytes ${index}`,
    );
  }
});

test("candidate containment status replays the exact natural CLOSED lifecycle as a redacted honest-null proof", () => {
  const input = statusInput();
  const projection = verifyCandidateContainmentSupervisorStatusV2(input);

  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2,
    "oxigraph.candidate-containment-supervisor-status/v1",
  );
  assert.equal(
    CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_PROJECTION_SCHEMA_V2,
    "oxigraph.candidate-containment-supervisor-status-replay/v1",
  );
  assert.equal(CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_BYTES_V2, 65_536);
  assert.equal(CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_FRAMES_V2, 10);
  assert.equal(CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_TIMEOUT_MS_V2, 2_000);
  assert.equal(
    projection.schema,
    CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_PROJECTION_SCHEMA_V2,
  );
  assert.equal(projection.status, "CLOSED_EOF_REPLAYED");
  assert.equal(projection.cleanupSafe, true);
  assert.equal(projection.binding, null);
  assert.equal(projection.physicalEligibility, false);
  assert.equal(projection.frameCount, naturalStates.length);
  assert.equal(projection.byteLength, input.statusBytes.length);
  assert.equal(projection.rawSha256, sha256(input.statusBytes));
  assert.deepEqual(projection.states, naturalStates);
  assert.equal(projection.request.rawSha256, sha256(input.requestBytes));
  assert.equal(projection.terminal.eventsRawSha256, eventsRawSha256);
  assert.equal(projection.terminal.cgroupRemoved, true);
  assert.equal(projection.terminal.directChildReaped, true);
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
  assert.equal(isCandidateContainmentV2TestTrace(projection), false);
  assert.equal(isTrustedSandboxSessionV2Report(projection), false);
  assert.equal(JSON.stringify(projection).includes("cgroupName"), false);
  assert.equal(JSON.stringify(projection).includes("hostPath"), false);
  assertDeepFrozen(projection);
  assertNullPrototypeRecords(projection);
});

test("candidate containment status accepts only the three exact cleanup-safe CLOSED branches", () => {
  for (const states of [
    naturalStates,
    waitCancellationStates,
    descendantCancellationStates,
  ]) {
    const projection = verifyCandidateContainmentSupervisorStatusV2(
      statusInput(states),
    );
    assert.deepEqual(projection.states, states);
    assert.equal(
      projection.terminal.cgroupKillWritten,
      states.includes("CANCELLING"),
    );
  }

  const rejected = [
    [],
    naturalStates.slice(0, -1),
    naturalStates.slice(1),
    [
      naturalStates[0],
      naturalStates[2],
      naturalStates[1],
      ...naturalStates.slice(3),
    ],
    [...naturalStates, "CLOSED"],
    [naturalStates[0], "CANCELLING", ...naturalStates.slice(1)],
    [...naturalStates.slice(0, 4), "CANCELLING", "CLOSED"],
    [naturalStates[0], naturalStates[1], "FAILED_RETAINED"],
    [naturalStates[0], naturalStates[1], "ERROR"],
  ];
  for (const states of rejected) {
    const request = createdRequest();
    let bytes;
    if (states.every((state) => evidenceByState[state] !== undefined)) {
      bytes = statusBytes(states, request);
    } else {
      const frames = statusFrames(
        states.filter((state) => evidenceByState[state] !== undefined),
        request,
      );
      frames.push({
        schema: CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_SCHEMA_V2,
        sequence: frames.length,
        state: states.at(-1),
        requestRawSha256: sha256(request.bytes),
        ownerRequestSha256: ownerRequestSha256(),
        generationSha256,
        evidence: { cleanupSafe: false },
      });
      bytes = Buffer.from(
        frames.map((frame) => `${canonicalJson(frame)}\n`).join(""),
        "utf8",
      );
    }
    assert.throws(
      () =>
        verifyCandidateContainmentSupervisorStatusV2({
          requestBytes: request.bytes,
          statusBytes: bytes,
          observation: observation(),
        }),
      CONTRACT_ERROR,
    );
  }
});

test("candidate containment status rejects identity, sequence, and per-state evidence tampering", () => {
  const mutations = [
    (frames) => {
      frames[0].sequence = 1;
    },
    (frames) => {
      frames[1].requestRawSha256 = "a".repeat(64);
    },
    (frames) => {
      frames[2].generationSha256 = "b".repeat(64);
    },
    (frames) => {
      frames[0].evidence.initialProcsEmpty = false;
    },
    (frames) => {
      frames[0].evidence.memoryMax = `${limits.memoryMaxBytes}`;
    },
    (frames) => {
      frames[1].evidence.flags.reverse();
    },
    (frames) => {
      frames[4].evidence.idType = "P_PID";
    },
    (frames) => {
      frames[5].evidence.cgroupPopulated = true;
    },
    (frames) => {
      frames[6].evidence.postCleanupOpen = "OK";
    },
    (frames) => {
      frames[8].authority = true;
    },
  ];
  for (const mutate of mutations) {
    const request = createdRequest();
    const frames = statusFrames(naturalStates, request);
    mutate(frames);
    const bytes = Buffer.from(
      frames.map((frame) => `${canonicalJson(frame)}\n`).join(""),
      "utf8",
    );
    assert.throws(
      () =>
        verifyCandidateContainmentSupervisorStatusV2({
          requestBytes: request.bytes,
          statusBytes: bytes,
          observation: observation(),
        }),
      CONTRACT_ERROR,
    );
  }
});

test("candidate containment status rejects timeout, EOF, writer, read, exit, and reap ambiguity", () => {
  const mutations = [
    { statusDeadlineMilliseconds: 1_999 },
    { statusDeadlineMilliseconds: 2_001 },
    { statusTimedOut: true },
    { eofObserved: false },
    { eofCount: 0 },
    { eofCount: 2 },
    { eofAfterFinalFrame: false },
    { readError: "EIO" },
    { writerCountAtLaunch: 0 },
    { writerCountAtLaunch: 2 },
    { writerDuplicationObserved: true },
    { supervisorExitCode: 1 },
    { supervisorExitCode: null },
    { supervisorSignal: "SIGKILL" },
    { supervisorReaped: false },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () =>
        verifyCandidateContainmentSupervisorStatusV2(
          statusInput(naturalStates, mutation),
        ),
      CONTRACT_ERROR,
    );
  }
});

test("candidate containment status rejects malformed, duplicate, partial, noncanonical, extra, and oversized bytes", () => {
  const input = statusInput();
  const firstLineEnd = input.statusBytes.indexOf(0x0a);
  const firstLine = input.statusBytes.subarray(0, firstLineEnd + 1);
  const duplicate = Buffer.from(
    input.statusBytes
      .toString("utf8")
      .replace(`"sequence":0`, `"sequence":0,"sequence":0`),
    "utf8",
  );
  const parsedFrames = input.statusBytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  const rejected = [
    Buffer.alloc(0),
    Buffer.from([0xc3, 0x28]),
    input.statusBytes.subarray(0, input.statusBytes.length - 1),
    Buffer.from(input.statusBytes.toString("utf8").replace("\n", "\r\n")),
    Buffer.concat([input.statusBytes, Buffer.from("\0")]),
    Buffer.concat([input.statusBytes, firstLine]),
    duplicate,
    Buffer.from(
      parsedFrames
        .map(
          (frame) =>
            `${JSON.stringify(
              Object.fromEntries(Object.entries(frame).reverse()),
            )}\n`,
        )
        .join(""),
      "utf8",
    ),
    Buffer.alloc(CANDIDATE_CONTAINMENT_SUPERVISOR_STATUS_MAX_BYTES_V2 + 1),
  ];
  for (const [index, bytes] of rejected.entries()) {
    assert.throws(
      () =>
        verifyCandidateContainmentSupervisorStatusV2({
          ...input,
          statusBytes: bytes,
        }),
      CONTRACT_ERROR,
      `rejected status bytes ${index}`,
    );
  }
});

test("candidate containment status input and observation require exact own-data records without accessors", () => {
  const input = statusInput();
  const accepted = Object.assign(Object.create(null), {
    requestBytes: input.requestBytes,
    statusBytes: input.statusBytes,
    observation: Object.assign(Object.create(null), input.observation),
  });
  assert.equal(
    verifyCandidateContainmentSupervisorStatusV2(accepted).cleanupSafe,
    true,
  );

  for (const value of [
    null,
    [],
    { ...input, authority: true },
    new Proxy(input, {}),
    { ...input, observation: { ...input.observation, authority: true } },
    { ...input, observation: new Proxy(input.observation, {}) },
  ]) {
    assert.throws(
      () => verifyCandidateContainmentSupervisorStatusV2(value),
      CONTRACT_ERROR,
    );
  }

  let accessed = false;
  const accessor = {
    requestBytes: input.requestBytes,
    observation: input.observation,
  };
  Object.defineProperty(accessor, "statusBytes", {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error("must not access");
    },
  });
  assert.throws(
    () => verifyCandidateContainmentSupervisorStatusV2(accessor),
    CONTRACT_ERROR,
  );
  assert.equal(accessed, false);
});
