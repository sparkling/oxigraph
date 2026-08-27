import { createHash } from "node:crypto";

export const ROUTING_EMBEDDING_DIMENSION = 16;

function canonicalValue(value, ancestors) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("routing features require finite JSON numbers");
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    throw new Error("routing features require plain JSON values");
  }
  if (ancestors.has(value)) {
    throw new Error("routing features may not contain cycles");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index))
      ) {
        throw new Error(
          "routing features require dense JSON arrays without extra properties",
        );
      }
      return `[${value.map((item) => canonicalValue(item, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("routing features require plain JSON objects");
    }
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJson(value) {
  return canonicalValue(value, new WeakSet());
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function featureIdentity(task) {
  if (task === null || typeof task !== "object" || Array.isArray(task)) {
    throw new Error("routing task features must be an object");
  }
  const required = [
    "taskId",
    "taskClass",
    "role",
    "contractSha256",
    "evaluatorSha256",
    "harnessSha256",
  ];
  const identity = {};
  for (const key of required) {
    if (typeof task[key] !== "string" || task[key].length === 0) {
      throw new Error(`routing task feature ${key} must be a non-empty string`);
    }
    identity[key] = task[key];
  }
  return identity;
}

/**
 * A fixed-size, deterministic fallback embedding for the frozen task identity.
 * Every coordinate is in (0, 1], so no task can collapse to the zero vector.
 */
export function routingEmbedding(task) {
  const bytes = createHash("sha256")
    .update(canonicalJson(featureIdentity(task)))
    .digest();
  return Object.freeze(
    Array.from(
      bytes.subarray(0, ROUTING_EMBEDDING_DIMENSION),
      (byte) => (byte + 1) / 256,
    ),
  );
}
