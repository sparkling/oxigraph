import { createHash } from "node:crypto";
import { isDeepStrictEqual, types } from "node:util";

import { canonicalJson } from "../routing/features.mjs";

// Pure replay contract for the private status pipe a future attested Cargo
// launcher will own. This module performs no I/O, opens no descriptor, and
// launches no process. In particular, a structurally valid READY -> EOF replay
// is not evidence that execveat occurred: only the future co-located physical
// issuer can bind these bytes to one held Cargo executable and one sole writer.
// Likewise, this framing-only contract checks the stage-to-reserved-exit map
// carried by ERROR, but the future co-located process owner must attest that the
// helper actually terminated with that reserved exit and no signal.

export const G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA =
  "oxigraph.g1.7-cargo-execveat-status/v1";
export const G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA =
  "oxigraph.g1.7-cargo-execveat-status-projection/v1";
export const G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES = 4_096;
export const G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES = 2;
export const G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS = 2_000;
export const G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX = 4_095;

const objectPrototype = Object.prototype;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectOwnKeys = Reflect.ownKeys;
const bufferPrototype = Buffer.prototype;
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer);
const bufferFrom = Buffer.from.bind(Buffer);
const bufferEquals = Buffer.prototype.equals;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "length",
).get;
const typedArraySet = Uint8Array.prototype.set;
const decoder = new TextDecoder("utf-8", { fatal: true });

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

function deepFreeze(value) {
  if (
    value !== null &&
    typeof value === "object" &&
    !ArrayBuffer.isView(value) &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// These values are deliberately outside the normal Cargo success/failure
// convention and below the shell's 256-value boundary. The ERROR frame and
// eventual helper exit must use the same stage-specific value. A future helper
// may not silently collapse distinct pre-exec failures into one exit status.
export const G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS = deepFreeze(
  nullRecord([
    ["preflight", 240],
    ["cargo-fd", 241],
    ["status-fd", 242],
    ["status-cloexec", 243],
    ["ready-write", 244],
    ["execveat", 245],
  ]),
);

export const G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES = deepFreeze([
  "preflight",
  "cargo-fd",
  "status-fd",
  "status-cloexec",
  "ready-write",
]);

export const G17_CARGO_EXECVEAT_STATUS_AUTHORITY = deepFreeze(
  nullRecord([
    ["helperExecutionAuthority", false],
    ["cargoExecutionAuthority", false],
    ["launchExecutionAuthority", false],
    ["nativeObservationAuthority", false],
    ["containmentExecutionAuthority", false],
    ["buildExecutionAuthority", false],
    ["controlExecutionAuthority", false],
    ["qualificationExecutionAuthority", false],
    ["receiptAuthority", false],
    ["promotionAuthority", false],
    ["publicationAuthority", false],
    ["routerQualityAuthority", false],
    ["providerExecutionAuthority", false],
  ]),
);

export const G17_CARGO_EXECVEAT_STATUS_NONCLAIMS = deepFreeze(
  nullRecord([
    ["serializedReplayProvesNativeOrigin", false],
    ["serializedReplayProvesObservationOrder", false],
    ["serializedReplayProvesHelperIdentity", false],
    ["serializedReplayProvesHeldCargoIdentity", false],
    ["serializedReplayProvesSoleWriterOwnership", false],
    ["serializedReplayProvesStatusWriterCloexec", false],
    ["readyEofReplayProvesExecveatSuccess", false],
    ["errorFrameReplayProvesKernelErrno", false],
    ["errorFrameReplayProvesReservedProcessExit", false],
    ["statusReplayBindsExecutionRequest", false],
    ["privateCoLocatedIssuerImplemented", false],
    ["privateCapabilityPresent", false],
    ["physicalEligibility", false],
  ]),
);

function fail(message) {
  throw new Error(`G1.7 Cargo execveat status protocol: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactRecord(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value)
  ) {
    fail(`${label} must be a plain own-data record`);
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(value);
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch (error) {
    fail(`${label} cannot be inspected: ${error.message}`);
  }
  if (prototype !== objectPrototype && prototype !== null) {
    fail(`${label} must have an ordinary or null prototype`);
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort()) ||
    keys.some(
      (key) =>
        !("value" in descriptors[key]) || descriptors[key].enumerable !== true,
    )
  ) {
    fail(`${label} fields must be exact enumerable own data`);
  }
  const output = Object.create(null);
  for (const key of expected) output[key] = descriptors[key].value;
  return output;
}

function boundedBuffer(value, label) {
  if (
    !Buffer.isBuffer(value) ||
    types.isProxy(value) ||
    objectGetPrototypeOf(value) !== bufferPrototype ||
    objectGetOwnPropertyDescriptor(value, "length") !== undefined
  ) {
    fail(`${label} must be an exact non-Proxy Buffer`);
  }
  let length;
  try {
    length = typedArrayLengthGetter.call(value);
  } catch (error) {
    fail(`${label} length cannot be read intrinsically: ${error.message}`);
  }
  if (
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_BYTES
  ) {
    fail(`${label} is outside the 1..4096 byte bound`);
  }
  try {
    const copied = bufferAllocUnsafe(length);
    typedArraySet.call(copied, value);
    return copied;
  } catch (error) {
    fail(`${label} cannot be copied intrinsically: ${error.message}`);
  }
}

function snapshotInput(input) {
  const envelope = exactRecord(input, ["bytes", "observation"], "input");
  const observation = exactRecord(
    envelope.observation,
    [
      "statusDeadlineMilliseconds",
      "statusTimedOut",
      "eofObserved",
      "eofCount",
      "eofAfterFinalFrame",
      "readError",
      "writerCountAtLaunch",
      "writerDuplicationObserved",
    ],
    "status observation",
  );
  return nullRecord([
    ["bytes", boundedBuffer(envelope.bytes, "status bytes")],
    ["observation", observation],
  ]);
}

function validateObservation(value) {
  if (
    value.statusDeadlineMilliseconds !==
      G17_CARGO_EXECVEAT_STATUS_TIMEOUT_MS ||
    value.statusTimedOut !== false
  ) {
    fail("status deadline timed out or drifted");
  }
  if (
    value.eofObserved !== true ||
    value.eofCount !== 1 ||
    value.eofAfterFinalFrame !== true ||
    value.readError !== null
  ) {
    fail("status EOF is absent, partial, duplicated, or ambiguous");
  }
  if (
    value.writerCountAtLaunch !== 1 ||
    value.writerDuplicationObserved !== false
  ) {
    fail("status writer ownership is duplicated or ambiguous");
  }
  return nullRecord([
    ["statusDeadlineMilliseconds", value.statusDeadlineMilliseconds],
    ["statusTimedOut", false],
    ["eofObserved", true],
    ["eofCount", 1],
    ["eofAfterFinalFrame", true],
    ["readError", null],
    ["writerCountAtLaunch", 1],
    ["writerDuplicationObserved", false],
  ]);
}

function validateErrno(value, label) {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 1 ||
    value > G17_CARGO_EXECVEAT_STATUS_ERRNO_MAX
  ) {
    fail(`${label} must be one exact positive Linux errno number`);
  }
  return value;
}

function validateFrame(parsed, index) {
  const frame = exactRecord(
    parsed,
    ["schema", "type", "stage", "errno", "reservedExitCode"],
    `frame ${index + 1}`,
  );
  if (frame.schema !== G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA) {
    fail(`frame ${index + 1} schema drifted`);
  }
  if (frame.type === "READY") {
    if (
      frame.stage !== "execveat" ||
      frame.errno !== null ||
      frame.reservedExitCode !== null
    ) {
      fail("READY must be the exact pre-execveat frame");
    }
  } else if (frame.type === "ERROR") {
    if (
      typeof frame.stage !== "string" ||
      !Object.hasOwn(G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS, frame.stage)
    ) {
      fail(`frame ${index + 1} error stage is not reserved`);
    }
    validateErrno(frame.errno, `frame ${index + 1} errno`);
    if (
      frame.reservedExitCode !==
      G17_CARGO_EXECVEAT_STATUS_RESERVED_EXITS[frame.stage]
    ) {
      fail(`frame ${index + 1} reserved exit does not match its stage`);
    }
  } else {
    fail(`frame ${index + 1} type is not READY or ERROR`);
  }
  return frame;
}

function decodeFrames(bytes) {
  let text;
  try {
    text = decoder.decode(bytes);
  } catch (error) {
    fail(`status bytes are not UTF-8: ${error.message}`);
  }
  if (text.includes("\r") || text.includes("\0")) {
    fail("status bytes must use strict LF framing without NUL data");
  }
  if (!text.endsWith("\n")) {
    fail("status EOF followed a partial or unframed value");
  }
  const lines = text.slice(0, -1).split("\n");
  if (
    lines.length < 1 ||
    lines.length > G17_CARGO_EXECVEAT_STATUS_PROTOCOL_MAX_FRAMES ||
    lines.some((line) => line.length === 0)
  ) {
    fail("status frame inventory is empty, duplicated, or exceeds two frames");
  }
  return lines.map((line, index) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      fail(`frame ${index + 1} is malformed JSON: ${error.message}`);
    }
    const frame = validateFrame(parsed, index);
    const canonical = bufferFrom(`${canonicalJson(frame)}\n`, "utf8");
    const supplied = bufferFrom(`${line}\n`, "utf8");
    if (!bufferEquals.call(supplied, canonical)) {
      fail(
        `frame ${index + 1} is non-canonical, duplicated, or has extra data`,
      );
    }
    return frame;
  });
}

function sequence(frames) {
  if (frames.length === 1 && frames[0].type === "READY") {
    return nullRecord([
      ["status", "READY_EOF_REPLAYED"],
      ["sequence", "READY->EOF"],
      ["outcome", "READY"],
      ["stage", "execveat"],
      ["errno", null],
      ["reservedExitCode", null],
    ]);
  }
  if (
    frames.length === 1 &&
    frames[0].type === "ERROR" &&
    G17_CARGO_EXECVEAT_STATUS_PRE_READY_ERROR_STAGES.includes(frames[0].stage)
  ) {
    return nullRecord([
      ["status", "PRE_EXEC_ERROR_EOF_REPLAYED"],
      ["sequence", "ERROR->EOF"],
      ["outcome", "ERROR"],
      ["stage", frames[0].stage],
      ["errno", frames[0].errno],
      ["reservedExitCode", frames[0].reservedExitCode],
    ]);
  }
  if (
    frames.length === 2 &&
    frames[0].type === "READY" &&
    frames[1].type === "ERROR" &&
    frames[1].stage === "execveat"
  ) {
    return nullRecord([
      ["status", "EXECVEAT_ERROR_EOF_REPLAYED"],
      ["sequence", "READY->ERROR(execveat)->EOF"],
      ["outcome", "ERROR"],
      ["stage", "execveat"],
      ["errno", frames[1].errno],
      ["reservedExitCode", frames[1].reservedExitCode],
    ]);
  }
  fail("status frames do not form an accepted terminal sequence");
}

/**
 * Replays one complete status-pipe observation. The caller-supplied
 * observation fields are assertions only; this pure verifier deliberately
 * returns no physical binding or authority.
 */
export function verifyG17CargoExecveatStatusProtocol(input) {
  const captured = snapshotInput(input);
  const observation = validateObservation(captured.observation);
  const frames = decodeFrames(captured.bytes);
  const terminal = sequence(frames);
  return deepFreeze(
    nullRecord([
      ["schema", G17_CARGO_EXECVEAT_STATUS_PROJECTION_SCHEMA],
      ["protocolSchema", G17_CARGO_EXECVEAT_STATUS_PROTOCOL_SCHEMA],
      ["status", terminal.status],
      ["sequence", terminal.sequence],
      ["outcome", terminal.outcome],
      ["rawSha256", sha256(captured.bytes)],
      ["byteLength", typedArrayLengthGetter.call(captured.bytes)],
      ["frameCount", frames.length],
      ["frames", frames],
      ["observation", observation],
      ["stage", terminal.stage],
      ["errno", terminal.errno],
      ["reservedExitCode", terminal.reservedExitCode],
      ["physicalLaunchEligible", false],
      ["binding", null],
      ["finalDecisionEligible", false],
      ["nonclaims", G17_CARGO_EXECVEAT_STATUS_NONCLAIMS],
      ["authority", G17_CARGO_EXECVEAT_STATUS_AUTHORITY],
    ]),
  );
}
