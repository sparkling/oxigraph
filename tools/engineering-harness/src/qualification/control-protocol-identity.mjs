import { createHash } from "node:crypto";

export const G17_LEGACY_V5_PROTOCOL_ARTIFACTS = Object.freeze({
  controlAuthorization: Object.freeze({
    schema: "oxigraph.g1.7-control-authorization/v1",
    id: "control-authorization",
    status: "CONTROL_AUTH_PROPOSED",
    rawSha256:
      "b9ee0f7615a885cda10157d1a6fdeebe4dc8175b267e6b25cd2c5bc636603515",
    contentHash:
      "5cb0f48f232784e7b6d0206b5ddbf72c7cd89d78f1924930a85ddba1cdf298b4",
    bytes: 7_140,
  }),
  finalDecisionSet: Object.freeze({
    schema: "oxigraph.g1.7-final-decision-set/v1",
    id: "final-decision-set",
    status: "PROPOSED",
    rawSha256:
      "2fd16b9ef0228fc054efb80a6f338fafeb6a289f1371b20f774e7c6f10ea0bce",
    contentHash:
      "ba49181b0c19ccc065f51510837a035aa64cccb746e089ac13d68a39c1d89898",
    bytes: 5_686,
  }),
});

function fail(message) {
  throw new Error(`G1.7 control protocol identity: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalValue(value, ancestors) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("artifact contains a non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    fail("artifact contains non-JSON data");
  }
  if (ancestors.has(value)) fail("artifact contains a cycle");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        fail("artifact arrays must be dense and field-free");
      }
      return `[${value.map((entry) => canonicalValue(entry, ancestors)).join(",")}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      fail("artifact must contain only ordinary JSON objects");
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalValue(value[key], ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJson(value) {
  return canonicalValue(value, new WeakSet());
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function snapshotInput(input) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    fail("replay input must be an object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 2 ||
    !keys.includes("bytes") ||
    !keys.includes("receiptSha256") ||
    keys.some((key) => typeof key !== "string")
  ) {
    fail("replay input fields are not exact");
  }
  for (const key of keys) {
    if ("get" in descriptors[key] || "set" in descriptors[key]) {
      fail("replay input contains accessor fields");
    }
  }
  const suppliedBytes = descriptors.bytes.value;
  const bytes = Buffer.isBuffer(suppliedBytes)
    ? Buffer.from(suppliedBytes)
    : suppliedBytes;
  const receiptSha256 = descriptors.receiptSha256.value;
  return { bytes, receiptSha256 };
}

export function decodeG17LegacyV5ProtocolArtifact(kind, input) {
  const descriptor = G17_LEGACY_V5_PROTOCOL_ARTIFACTS[kind];
  if (descriptor === undefined) fail("artifact kind is unsupported");
  const { bytes, receiptSha256 } = snapshotInput(input);
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== descriptor.bytes ||
    receiptSha256 !== descriptor.rawSha256 ||
    sha256(bytes) !== descriptor.rawSha256
  ) {
    fail("artifact bytes do not match the reviewed v5 identity");
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    fail(`artifact is invalid JSON: ${error.message}`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail("artifact bytes are not canonical JSON plus one LF");
  }
  const { contentHash, ...unsigned } = value;
  if (
    value.schema !== descriptor.schema ||
    value.id !== descriptor.id ||
    value.status !== descriptor.status ||
    contentHash !== descriptor.contentHash ||
    sha256(Buffer.from(canonicalJson(unsigned), "utf8")) !==
      descriptor.contentHash
  ) {
    fail(
      "artifact metadata or self-hash differs from the reviewed v5 identity",
    );
  }
  return Object.freeze({
    kind,
    generation: "LEGACY_V5",
    value: deepFreeze(value),
    byteLength: descriptor.bytes,
    rawSha256: descriptor.rawSha256,
    contentHash: descriptor.contentHash,
  });
}
