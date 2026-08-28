import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  G17_CARGO_EXECVEAT_STATUS_AUTHORITY,
  G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX,
  G17_CARGO_EXECVEAT_STATUS_NONCLAIMS,
  G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES,
  G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES,
  G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
  G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS,
  G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
  verifyG17CargoExecveatStatusProtocol,
} from "../src/qualification/cargo-execveat-status-protocol-contract.mjs";
import { canonicalJson } from "../src/routing/features.mjs";

const CONTRACT_ERROR = /G1\.7 Cargo execveat status protocol/u;

function readyFrame(overrides = {}) {
  return {
    schema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
    type: "READY",
    stage: "execveat",
    errno: null,
    reservedExitCode: null,
    ...overrides,
  };
}

function errorFrame(stage = "preflight", errno = 22, overrides = {}) {
  return {
    schema: G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
    type: "ERROR",
    stage,
    errno,
    reservedExitCode: G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS[stage],
    ...overrides,
  };
}

function bytes(...frames) {
  return Buffer.from(
    frames.map((frame) => `${canonicalJson(frame)}\n`).join(""),
    "utf8",
  );
}

function observation(overrides = {}) {
  return {
    statusDeadlineMilliseconds: G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS,
    statusTimedOut: false,
    eofObserved: true,
    eofCount: 1,
    eofAfterFinalFrame: true,
    readError: null,
    writerCountAtLaunch: 1,
    writerDuplicationObserved: false,
    ...overrides,
  };
}

function input(statusBytes = bytes(readyFrame()), observationOverrides = {}) {
  return {
    bytes: statusBytes,
    observation: observation(observationOverrides),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertNullPrototypeRecords(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const child of value) assertNullPrototypeRecords(child, seen);
    return;
  }
  assert.equal(Object.getPrototypeOf(value), null);
  for (const child of Object.values(value)) {
    assertNullPrototypeRecords(child, seen);
  }
}

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

test("READY then unambiguous EOF is the sole accepted success sequence", () => {
  const raw = bytes(readyFrame());
  const projection = verifyG17CargoExecveatStatusProtocol(input(raw));

  assert.equal(
    G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
    "oxigraph.g1.7-cargo-execveat-status/v1",
  );
  assert.equal(
    G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA,
    "oxigraph.g1.7-cargo-execveat-status-projection/v1",
  );
  assert.equal(G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES, 4_096);
  assert.equal(G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES, 2);
  assert.equal(G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS, 2_000);
  assert.equal(G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX, 4_095);
  assert.equal(projection.schema, G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA);
  assert.equal(
    projection.protocolSchema,
    G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA,
  );
  assert.equal(projection.status, "READY_EOF_REPLAYED");
  assert.equal(projection.sequence, "READY->EOF");
  assert.equal(projection.outcome, "READY");
  assert.equal(projection.frameCount, 1);
  assert.equal(projection.byteLength, raw.length);
  assert.equal(projection.rawSha256, sha256(raw));
  assert.equal(projection.stage, "execveat");
  assert.equal(projection.errno, null);
  assert.equal(projection.reservedExitCode, null);
  assert.deepEqual({ ...projection.frames[0] }, readyFrame());
});

test("every exact pre-READY stage accepts ERROR then EOF with its reserved exit", () => {
  assert.deepEqual(G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES, [
    "preflight",
    "cargo-fd",
    "status-fd",
    "status-cloexec",
    "ready-write",
  ]);
  assert.deepEqual(
    { ...G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS },
    {
      preflight: 240,
      "cargo-fd": 241,
      "status-fd": 242,
      "status-cloexec": 243,
      "ready-write": 244,
      execveat: 245,
    },
  );

  for (const [index, stage] of G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES.entries()) {
    const frame = errorFrame(stage, index + 1);
    const projection = verifyG17CargoExecveatStatusProtocol(
      input(bytes(frame)),
    );
    assert.equal(projection.status, "PRE_EXEC_ERROR_EOF_REPLAYED");
    assert.equal(projection.sequence, "ERROR->EOF");
    assert.equal(projection.outcome, "ERROR");
    assert.equal(projection.stage, stage);
    assert.equal(projection.errno, index + 1);
    assert.equal(
      projection.reservedExitCode,
      G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS[stage],
    );
  }
});

test("READY then ERROR(execveat) then EOF is the sole post-READY failure", () => {
  const projection = verifyG17CargoExecveatStatusProtocol(
    input(bytes(readyFrame(), errorFrame("execveat", 13))),
  );

  assert.equal(projection.status, "EXECVEAT_ERROR_EOF_REPLAYED");
  assert.equal(projection.sequence, "READY->ERROR(execveat)->EOF");
  assert.equal(projection.outcome, "ERROR");
  assert.equal(projection.frameCount, 2);
  assert.equal(projection.stage, "execveat");
  assert.equal(projection.errno, 13);
  assert.equal(
    projection.reservedExitCode,
    G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS.execveat,
  );
});

test("all other complete frame sequences fail closed", () => {
  const rejected = [
    bytes(errorFrame("execveat", 9)),
    bytes(readyFrame(), readyFrame()),
    bytes(errorFrame("preflight", 22), readyFrame()),
    bytes(readyFrame(), errorFrame("cargo-fd", 9)),
    bytes(errorFrame("preflight", 22), errorFrame("execveat", 9)),
    bytes(readyFrame(), errorFrame("execveat", 9), errorFrame("execveat", 9)),
  ];
  for (const value of rejected) {
    assert.throws(
      () => verifyG17CargoExecveatStatusProtocol(input(value)),
      CONTRACT_ERROR,
    );
  }
});

test("frame schema, fields, type, stage, errno, and reserved exit are exact", () => {
  const mutations = [
    readyFrame({ schema: "oxigraph.g1.7-cargo-execveat-status/v2" }),
    readyFrame({ type: "ready" }),
    readyFrame({ stage: "status-cloexec" }),
    readyFrame({ errno: 0 }),
    readyFrame({ reservedExitCode: 245 }),
    { ...readyFrame(), authority: true },
    errorFrame("not-a-stage", 1, { reservedExitCode: 240 }),
    errorFrame("preflight", null),
    errorFrame("preflight", 0),
    errorFrame("preflight", -0),
    errorFrame("preflight", 4_096),
    errorFrame("preflight", 1.5),
    errorFrame("preflight", 22, { reservedExitCode: 241 }),
  ];
  for (const frame of mutations) {
    assert.throws(
      () => verifyG17CargoExecveatStatusProtocol(input(bytes(frame))),
      CONTRACT_ERROR,
    );
  }
});

test("malformed, duplicate, partial, noncanonical, extra, and oversized bytes fail", () => {
  const canonicalReady = bytes(readyFrame());
  const duplicateMember = Buffer.from(
    `{"errno":null,"errno":null,"reservedExitCode":null,"schema":"${G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA}","stage":"execveat","type":"READY"}\n`,
    "utf8",
  );
  const noncanonical = Buffer.from(
    `${JSON.stringify(readyFrame())}\n`,
    "utf8",
  );
  const rejected = [
    Buffer.alloc(0),
    Buffer.from([0xc3, 0x28]),
    Buffer.from("{\n", "utf8"),
    Buffer.from("\n", "utf8"),
    canonicalReady.subarray(0, canonicalReady.length - 1),
    Buffer.from(canonicalReady.toString("utf8").replace("\n", "\r\n")),
    Buffer.concat([canonicalReady, Buffer.from("\0")]),
    Buffer.concat([canonicalReady, Buffer.from("extra\n")]),
    duplicateMember,
    noncanonical,
    Buffer.alloc(G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES + 1, 0x20),
  ];
  for (const value of rejected) {
    assert.throws(
      () => verifyG17CargoExecveatStatusProtocol(input(value)),
      CONTRACT_ERROR,
    );
  }
});

test("timeout, read failure, ambiguous EOF, and writer duplication fail closed", () => {
  const mutations = [
    { statusDeadlineMilliseconds: 1_999 },
    { statusDeadlineMilliseconds: 2_001 },
    { statusTimedOut: true },
    { statusTimedOut: null },
    { eofObserved: false },
    { eofObserved: null },
    { eofCount: 0 },
    { eofCount: 2 },
    { eofAfterFinalFrame: false },
    { readError: "EIO" },
    { writerCountAtLaunch: 0 },
    { writerCountAtLaunch: 2 },
    { writerDuplicationObserved: true },
  ];
  for (const mutation of mutations) {
    assert.throws(
      () =>
        verifyG17CargoExecveatStatusProtocol(
          input(bytes(readyFrame()), mutation),
        ),
      CONTRACT_ERROR,
    );
  }
});

test("input and observation require exact enumerable own data", () => {
  const raw = bytes(readyFrame());
  const nullObservation = Object.assign(Object.create(null), observation());
  const nullInput = Object.assign(Object.create(null), {
    bytes: raw,
    observation: nullObservation,
  });
  assert.equal(
    verifyG17CargoExecveatStatusProtocol(nullInput).status,
    "READY_EOF_REPLAYED",
  );

  const inputs = [
    null,
    [],
    { bytes: raw },
    { bytes: raw, observation: observation(), authority: true },
    Object.assign(Object.create({ authority: true }), input(raw)),
    new Proxy(input(raw), {}),
    { bytes: raw, observation: new Proxy(observation(), {}) },
    { bytes: raw, observation: { ...observation(), authority: true } },
    {
      bytes: raw,
      observation: Object.assign(
        Object.create({ authority: true }),
        observation(),
      ),
    },
  ];
  const symbolic = input(raw);
  symbolic[Symbol("authority")] = true;
  inputs.push(symbolic);
  const observationSymbol = observation();
  observationSymbol[Symbol("authority")] = true;
  inputs.push({ bytes: raw, observation: observationSymbol });

  let accessed = false;
  const accessor = { observation: observation() };
  Object.defineProperty(accessor, "bytes", {
    enumerable: true,
    get() {
      accessed = true;
      throw new Error("must not run");
    },
  });
  inputs.push(accessor);
  let observationAccessed = false;
  const observationAccessor = observation();
  Object.defineProperty(observationAccessor, "eofObserved", {
    enumerable: true,
    get() {
      observationAccessed = true;
      throw new Error("must not run");
    },
  });
  inputs.push({ bytes: raw, observation: observationAccessor });
  const nonenumerable = input(raw);
  Object.defineProperty(nonenumerable, "bytes", {
    value: raw,
    enumerable: false,
  });
  inputs.push(nonenumerable);

  for (const value of inputs) {
    assert.throws(
      () => verifyG17CargoExecveatStatusProtocol(value),
      CONTRACT_ERROR,
    );
  }
  assert.equal(accessed, false);
  assert.equal(observationAccessed, false);
});

test("status byte input uses intrinsic exact-Buffer length and copying", () => {
  const raw = bytes(readyFrame());
  const proxy = new Proxy(raw, {});
  const foreignPrototype = Buffer.from(raw);
  Object.setPrototypeOf(foreignPrototype, Uint8Array.prototype);
  const ownLength = Buffer.from(raw);
  let lengthRead = false;
  Object.defineProperty(ownLength, "length", {
    configurable: true,
    get() {
      lengthRead = true;
      return 1;
    },
  });

  for (const value of [new Uint8Array(raw), proxy, foreignPrototype, ownLength]) {
    assert.throws(
      () => verifyG17CargoExecveatStatusProtocol(input(value)),
      CONTRACT_ERROR,
    );
  }
  assert.equal(lengthRead, false);
});

test("projection records are null-prototype, deeply frozen, and authority-free", () => {
  const projection = verifyG17CargoExecveatStatusProtocol(
    input(bytes(readyFrame())),
  );

  assertNullPrototypeRecords(projection);
  assertDeepFrozen(projection);
  assert.deepEqual(projection.authority, G17_CARGO_EXECVEAT_STATUS_AUTHORITY);
  assert.deepEqual(projection.nonclaims, G17_CARGO_EXECVEAT_STATUS_NONCLAIMS);
  assert.equal(Object.values(projection.authority).length, 13);
  assert.equal(Object.values(projection.nonclaims).length, 13);
  assert.equal(
    Object.values(projection.authority).every((value) => value === false),
    true,
  );
  assert.equal(
    Object.values(projection.nonclaims).every((value) => value === false),
    true,
  );
  assert.equal(projection.physicalLaunchEligible, false);
  assert.equal(projection.binding, null);
  assert.equal(projection.finalDecisionEligible, false);
  assert.throws(() => {
    projection.authority.launchExecutionAuthority = true;
  }, TypeError);
  assert.throws(() => {
    projection.frames[0].type = "ERROR";
  }, TypeError);
});
