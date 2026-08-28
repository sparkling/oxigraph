import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const G17_CONTROL_AUTHORIZATION_SCHEMA =
  "oxigraph.g1.7-control-authorization/v3";
export const G17_CURRENT_CONTROL_AUTHORIZATION_IDENTITY = Object.freeze({
  schema: G17_CONTROL_AUTHORIZATION_SCHEMA,
  id: "control-authorization",
  status: "CONTROL_AUTH_PROPOSED",
  bytes: 11_426,
  rawSha256: "31b8fce50d503f50656c5390cfe8d35913babeec54fc67906b20e66e7d713767",
  contentHash:
    "d61434741577787729dde9c23725523b855fca208e5b891de2a73e8abe0c0bb2",
  protocolSha256:
    "4f5978b873873094196d5d5998565b0acb0bf883beac1466b2fa91343b96c0f2",
});

const CURRENT_DECISION_URL = new URL(
  "../../qualification/g1.7/decisions/control-authorization.json",
  import.meta.url,
);
const MAX_DECISION_BYTES = 128 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 50_000;
const MAX_ARRAY_LENGTH = 4_096;
const MAX_OBJECT_PROPERTIES = 4_096;
const MAX_STRING_BYTES = MAX_DECISION_BYTES;
const DIGEST = /^[0-9a-f]{64}$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true });

function fail(message) {
  throw new Error(`G1.7 control authorization gate: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical value is not finite");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
    .join(",")}}`;
}

function canonicalJson(value) {
  return canonicalValue(value);
}

function canonicalSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())
  ) {
    fail(`${label} fields are not exact`);
  }
}

function dataEnvelope(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be an ordinary object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== "string") ||
    !isDeepStrictEqual([...keys].sort(), [...expected].sort())
  ) {
    fail(`${label} fields are not exact`);
  }
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if ("get" in descriptor || "set" in descriptor || !descriptor.enumerable) {
      fail(`${label}.${key} must be an enumerable data field`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function snapshotJson(
  value,
  label,
  budget = { nodes: 0, strings: 0 },
  depth = 0,
) {
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES || depth > MAX_DEPTH) {
    fail(`${label} exceeds its structural budget`);
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    budget.strings += Buffer.byteLength(value, "utf8");
    if (budget.strings > MAX_STRING_BYTES) {
      fail(`${label} exceeds its string budget`);
    }
    return value;
  }
  if (typeof value !== "object") fail(`${label} contains non-JSON data`);
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) {
      fail(`${label} exceeds its array budget`);
    }
    return value.map((child, index) =>
      snapshotJson(child, `${label}[${index}]`, budget, depth + 1));
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_OBJECT_PROPERTIES) {
    fail(`${label} exceeds its object-property budget`);
  }
  const result = {};
  for (const key of keys) {
    budget.strings += Buffer.byteLength(key, "utf8");
    if (budget.strings > MAX_STRING_BYTES) {
      fail(`${label} exceeds its key budget`);
    }
    result[key] = snapshotJson(value[key], `${label}.${key}`, budget, depth + 1);
  }
  return result;
}

function timestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(`${label} is not a canonical UTC timestamp`);
  }
  return milliseconds;
}

function validateApproval(value, authorized) {
  exactKeys(value, ["status", "approvedBy", "approvedAt"], "approval");
  if (authorized) {
    if (
      value.status !== "APPROVED" ||
      typeof value.approvedBy !== "string" ||
      value.approvedBy.length < 1 ||
      value.approvedBy.length > 256 ||
      value.approvedBy !== value.approvedBy.trim() ||
      /[\u0000-\u001f\u007f]/u.test(value.approvedBy)
    ) {
      fail("authorized decision lacks one canonical named approver");
    }
    timestamp(value.approvedAt, "approval approvedAt");
  } else if (
    value.status !== "UNAPPROVED" ||
    value.approvedBy !== null ||
    value.approvedAt !== null
  ) {
    fail("proposed decision carries approval authority");
  }
}

function copyDecisionBytes(value) {
  if (
    !Buffer.isBuffer(value) ||
    value.length < 2 ||
    value.length > MAX_DECISION_BYTES
  ) {
    fail("decision is not a bounded Buffer");
  }
  return Buffer.from(value);
}

export function replayG17ControlAuthorizationDecision(options) {
  const envelope = dataEnvelope(
    options,
    ["bytes"],
    "authorization replay options",
  );
  const bytes = copyDecisionBytes(envelope.bytes);
  let text;
  try {
    text = utf8.decode(bytes);
  } catch (error) {
    fail(`decision is not UTF-8: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`decision is invalid JSON: ${error.message}`);
  }
  const authorization = snapshotJson(parsed, "control authorization");
  if (text !== `${canonicalJson(authorization)}\n`) {
    fail("decision is not canonical JSON plus one LF");
  }
  exactKeys(
    authorization,
    ["schema", "id", "status", "protocol", "approval", "contentHash"],
    "control authorization",
  );
  if (
    authorization.schema !== G17_CONTROL_AUTHORIZATION_SCHEMA ||
    authorization.id !== "control-authorization" ||
    !new Set(["CONTROL_AUTH_PROPOSED", "CONTROL_AUTHORIZED"]).has(
      authorization.status,
    ) ||
    canonicalSha256(authorization.protocol) !==
      G17_CURRENT_CONTROL_AUTHORIZATION_IDENTITY.protocolSha256
  ) {
    fail("decision identity or frozen protocol drifted");
  }
  validateApproval(
    authorization.approval,
    authorization.status === "CONTROL_AUTHORIZED",
  );
  if (!DIGEST.test(authorization.contentHash ?? "")) {
    fail("decision contentHash is not a SHA-256 digest");
  }
  const { contentHash, ...unsigned } = authorization;
  if (canonicalSha256(unsigned) !== contentHash) {
    fail("decision contentHash does not verify");
  }
  return deepFreeze({
    authorization,
    bytes: bytes.length,
    rawSha256: sha256(bytes),
    contentHash,
  });
}

function requireAuthorized(replayed, controlStartedAt) {
  if (replayed.authorization.status !== "CONTROL_AUTHORIZED") {
    fail("proposed control authorization cannot start controls");
  }
  const approvedAt = timestamp(
    replayed.authorization.approval.approvedAt,
    "control authorization approvedAt",
  );
  const startedAt = timestamp(controlStartedAt, "control startedAt");
  if (!(approvedAt < startedAt)) {
    fail("control authorization must be approved before control start");
  }
  return deepFreeze({
    phase: "CONTROL_AUTHORIZED",
    authorization: replayed.authorization,
    authorizationRawSha256: replayed.rawSha256,
    controlStartedAt,
    controlExecutionAuthorized: true,
    qualificationExecutionAuthorized: false,
  });
}

/** Test-only synthetic approval gate; production never accepts caller bytes. */
export function validateG17ControlExecutionAuthorizationForTesting(options) {
  const envelope = dataEnvelope(
    options,
    ["authorizationBytes", "controlStartedAt"],
    "test authorization gate options",
  );
  return requireAuthorized(
    replayG17ControlAuthorizationDecision({ bytes: envelope.authorizationBytes }),
    envelope.controlStartedAt,
  );
}

export async function loadCurrentG17ControlExecutionAuthorization(options) {
  const envelope = dataEnvelope(
    options,
    ["controlStartedAt"],
    "production authorization gate options",
  );
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(CURRENT_DECISION_URL);
  const replayed = replayG17ControlAuthorizationDecision({ bytes });
  const current = G17_CURRENT_CONTROL_AUTHORIZATION_IDENTITY;
  if (
    replayed.authorization.schema !== current.schema ||
    replayed.authorization.id !== current.id ||
    replayed.authorization.status !== current.status ||
    replayed.bytes !== current.bytes ||
    replayed.rawSha256 !== current.rawSha256 ||
    replayed.contentHash !== current.contentHash
  ) {
    fail("current decision artifact identity drifted");
  }
  return requireAuthorized(replayed, envelope.controlStartedAt);
}
