import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  open,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  canonicalJson,
  canonicalSha256,
  routingEmbedding,
} from "./features.mjs";

export const NATIVE_PROVIDERS = Object.freeze(["codex", "claude"]);
export const ROUTER_HISTORY_SCHEMA = 1;

const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
const DIGEST = /^[0-9a-f]{64}$/;
const WORKER_ROLES = new Set([
  "architecture",
  "critique",
  "implementation",
  "review",
  "repair",
]);
const EXCLUDED_DISPOSITIONS = new Set([
  "preparation-failed",
  "cancelled",
  "inconclusive",
]);
const OUTCOME_KEYS = new Set([
  "taskId",
  "taskClass",
  "role",
  "provider",
  "model",
  "models",
  "candidateSha256",
  "evaluatorSha256",
  "contractSha256",
  "harnessSha256",
  "disposition",
  "quality",
  "mode",
  "pairId",
  "predictedQuality",
  "repairCycles",
]);

// Capabilities are opaque object identities. There is no exported constructor,
// symbol, serial form, or brand value that another module can reproduce.
const admissionCapabilities = new WeakMap();

function string(value, label, max = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function probability(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be in [0, 1]`);
  }
  return value;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} has unknown field: ${key}`);
  }
}

export function normalizeQualityOutcome(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("router history outcome must be an object");
  }
  exactKeys(value, OUTCOME_KEYS, "router history outcome");
  const disposition = string(value.disposition, "outcome disposition", 64);
  if (EXCLUDED_DISPOSITIONS.has(disposition)) {
    throw new Error(`router history excludes ${disposition} outcomes`);
  }
  if (disposition !== "verified") {
    throw new Error(`unsupported router history disposition: ${disposition}`);
  }
  const provider = string(value.provider, "outcome provider", 32);
  if (!NATIVE_PROVIDERS.includes(provider)) {
    throw new Error(`router history requires a native provider, got ${provider}`);
  }
  const role = string(value.role, "outcome role", 64);
  if (!WORKER_ROLES.has(role)) {
    throw new Error(`unsupported router history role: ${role}`);
  }
  const model = string(value.model, "outcome model", 256);
  if (/openrouter/i.test(model)) throw new Error("OpenRouter routing is prohibited");
  if (
    value.models === null ||
    typeof value.models !== "object" ||
    Array.isArray(value.models) ||
    Object.keys(value.models).length !== NATIVE_PROVIDERS.length
  ) {
    throw new Error("router history outcome must bind both native provider models");
  }
  const models = {};
  for (const nativeProvider of NATIVE_PROVIDERS) {
    const nativeModel = string(
      value.models[nativeProvider],
      `outcome ${nativeProvider} model`,
      256,
    );
    if (/openrouter/i.test(nativeModel)) throw new Error("OpenRouter routing is prohibited");
    models[nativeProvider] = nativeModel;
  }
  if (model !== models[provider]) {
    throw new Error("outcome model does not match its frozen provider model map");
  }
  const mode = string(value.mode, "outcome mode", 32);
  if (mode !== "paired" && mode !== "routed") {
    throw new Error(`unsupported router history mode: ${mode}`);
  }
  const pairId = value.pairId ?? null;
  if (mode === "paired") string(pairId, "paired outcome pairId");
  if (mode === "routed" && pairId !== null) {
    throw new Error("routed outcomes may not claim a pairId");
  }
  const repairCycles = value.repairCycles ?? 0;
  if (!Number.isInteger(repairCycles) || repairCycles < 0 || repairCycles > 100) {
    throw new Error("outcome repairCycles must be an integer in 0..100");
  }
  const normalized = {
    taskId: string(value.taskId, "outcome taskId"),
    taskClass: string(value.taskClass, "outcome taskClass"),
    role,
    provider,
    model,
    models: Object.freeze(models),
    candidateSha256: digest(value.candidateSha256, "outcome candidateSha256"),
    evaluatorSha256: digest(value.evaluatorSha256, "outcome evaluatorSha256"),
    contractSha256: digest(value.contractSha256, "outcome contractSha256"),
    harnessSha256: digest(value.harnessSha256, "outcome harnessSha256"),
    disposition,
    quality: probability(value.quality, "outcome quality"),
    mode,
    pairId,
    repairCycles,
  };
  if (value.predictedQuality !== undefined) {
    normalized.predictedQuality = probability(
      value.predictedQuality,
      "outcome predictedQuality",
    );
  }
  return Object.freeze(normalized);
}

export function directApplicationBinding(outcome) {
  const normalized = normalizeQualityOutcome(outcome);
  return Object.freeze({
    schema: 1,
    candidateSha256: normalized.candidateSha256,
    evaluatorSha256: normalized.evaluatorSha256,
    contractSha256: normalized.contractSha256,
    harnessSha256: normalized.harnessSha256,
    role: normalized.role,
    model: normalized.model,
    outcome: normalized,
  });
}

export function createDirectApplicationAdmissionAuthority({
  verifyDirectApplication,
}) {
  if (typeof verifyDirectApplication !== "function") {
    throw new Error("a direct application verifier is required");
  }
  return Object.freeze({
    async verifyAndMint(outcome, verifierReceipt) {
      const normalized = normalizeQualityOutcome(outcome);
      const binding = directApplicationBinding(normalized);
      const bindingSha256 = canonicalSha256(binding);
      const verification = await verifyDirectApplication(
        Object.freeze({ binding, bindingSha256, verifierReceipt }),
      );
      if (
        verification?.verified !== true ||
        verification.bindingSha256 !== bindingSha256
      ) {
        throw new Error("direct application verifier did not bind the exact outcome");
      }
      const capability = Object.freeze(Object.create(null));
      admissionCapabilities.set(capability, {
        outcomeSha256: canonicalSha256(normalized),
        state: "minted",
      });
      return capability;
    },
  });
}

function claimCapability(capability, outcome) {
  const state =
    capability !== null && typeof capability === "object"
      ? admissionCapabilities.get(capability)
      : undefined;
  if (
    state?.state !== "minted" ||
    state.outcomeSha256 !== canonicalSha256(outcome)
  ) {
    throw new Error("router history admission requires an exact verifier capability");
  }
  state.state = "pending";
  return state;
}

function releaseCapability(state, succeeded, capability) {
  if (succeeded) admissionCapabilities.delete(capability);
  else state.state = "minted";
}

function frozenEntry(value) {
  return Object.freeze({
    ...value,
    embedding: Object.freeze([...value.embedding]),
    outcome: Object.freeze({
      ...value.outcome,
      models: Object.freeze({ ...value.outcome.models }),
    }),
  });
}

function envelopePayload(sequence, previousSha256, outcome) {
  return {
    schema: ROUTER_HISTORY_SCHEMA,
    sequence,
    previousSha256,
    outcome,
    embedding: routingEmbedding(outcome),
  };
}

function validateEnvelope(value, expectedSequence, previousSha256) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`router history line ${expectedSequence} must be an object`);
  }
  const keys = new Set([
    "schema",
    "sequence",
    "previousSha256",
    "outcome",
    "embedding",
    "entrySha256",
  ]);
  exactKeys(value, keys, `router history line ${expectedSequence}`);
  const outcome = normalizeQualityOutcome(value.outcome);
  const payload = envelopePayload(expectedSequence, previousSha256, outcome);
  if (
    value.schema !== ROUTER_HISTORY_SCHEMA ||
    value.sequence !== expectedSequence ||
    value.previousSha256 !== previousSha256 ||
    canonicalJson(value.embedding) !== canonicalJson(payload.embedding) ||
    value.entrySha256 !== canonicalSha256(payload)
  ) {
    throw new Error(`router history line ${expectedSequence} failed binding validation`);
  }
  return frozenEntry({ ...payload, entrySha256: value.entrySha256 });
}

function validateCrossEntryInvariants(entries) {
  const identities = new Set();
  const pairs = new Map();
  for (const entry of entries) {
    const outcome = entry.outcome;
    const identity = `${outcome.taskId}\u0000${outcome.role}\u0000${outcome.provider}`;
    if (identities.has(identity)) {
      throw new Error(
        `router history duplicates ${outcome.taskId}/${outcome.role}/${outcome.provider}`,
      );
    }
    identities.add(identity);
    if (outcome.mode !== "paired") continue;
    const prior = pairs.get(outcome.pairId);
    const pairIdentity = canonicalJson({
      taskId: outcome.taskId,
      taskClass: outcome.taskClass,
      role: outcome.role,
      evaluatorSha256: outcome.evaluatorSha256,
      contractSha256: outcome.contractSha256,
      harnessSha256: outcome.harnessSha256,
      models: outcome.models,
    });
    if (prior !== undefined && prior !== pairIdentity) {
      throw new Error(`router history pair ${outcome.pairId} has mismatched bindings`);
    }
    pairs.set(outcome.pairId, pairIdentity);
  }
}

function parseHistory(bytes) {
  if (bytes.length > MAX_HISTORY_BYTES) {
    throw new Error(`router history exceeds ${MAX_HISTORY_BYTES} bytes`);
  }
  const text = bytes.toString("utf8");
  if (text.length === 0) return Object.freeze([]);
  if (!text.endsWith("\n")) throw new Error("router history has a truncated final line");
  const lines = text.slice(0, -1).split("\n");
  const entries = [];
  let previousSha256 = null;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].length === 0) {
      throw new Error(`router history line ${index + 1} is empty`);
    }
    let value;
    try {
      value = JSON.parse(lines[index]);
    } catch (error) {
      throw new Error(`router history line ${index + 1} is invalid JSON: ${error.message}`);
    }
    const entry = validateEnvelope(value, index + 1, previousSha256);
    entries.push(entry);
    previousSha256 = entry.entrySha256;
  }
  validateCrossEntryInvariants(entries);
  return Object.freeze(entries);
}

function validateHistoryFile(path) {
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if (error.code === "ENOENT") return Object.freeze([]);
    throw error;
  }
  try {
    const metadata = fstatSync(descriptor);
    const uid = typeof process.getuid === "function" ? process.getuid() : metadata.uid;
    if (
      !metadata.isFile() ||
      metadata.uid !== uid ||
      (metadata.mode & 0o077) !== 0
    ) {
      throw new Error("router history must be a private owner-only regular file");
    }
    if (metadata.size > MAX_HISTORY_BYTES) {
      throw new Error(`router history exceeds ${MAX_HISTORY_BYTES} bytes`);
    }
    return parseHistory(readFileSync(descriptor));
  } finally {
    closeSync(descriptor);
  }
}

function historyText(entries) {
  return entries.map((entry) => canonicalJson(entry)).join("\n") + "\n";
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicReplace(path, entries, isIgnoredRuntimePath) {
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  if ((await isIgnoredRuntimePath(temporary)) !== true) {
    throw new Error("router history temporary file is not in an ignored runtime path");
  }
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(historyText(entries), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncDirectory(parent);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

async function canonicalRuntimePath(path, isIgnoredRuntimePath) {
  if (typeof path !== "string" || !isAbsolute(path) || path.includes("\u0000")) {
    throw new Error("router history path must be an absolute path");
  }
  if (typeof isIgnoredRuntimePath !== "function") {
    throw new Error("router history requires an ignored-runtime-path policy");
  }
  const parent = realpathSync(dirname(resolve(path)));
  const parentStat = statSync(parent);
  const uid = typeof process.getuid === "function" ? process.getuid() : parentStat.uid;
  if (
    !parentStat.isDirectory() ||
    parentStat.uid !== uid ||
    (parentStat.mode & 0o022) !== 0
  ) {
    throw new Error("router history parent must be an owner-controlled directory");
  }
  const canonical = join(parent, basename(path));
  for (const generated of [canonical, `${canonical}.lock`]) {
    if ((await isIgnoredRuntimePath(generated)) !== true) {
      throw new Error("router history path is not an ignored runtime path");
    }
  }
  return canonical;
}

export class RouterHistory {
  #path;
  #entries;
  #isIgnoredRuntimePath;

  constructor(path, entries, isIgnoredRuntimePath) {
    this.#path = path;
    this.#entries = entries;
    this.#isIgnoredRuntimePath = isIgnoredRuntimePath;
  }

  static async open({ path, isIgnoredRuntimePath }) {
    const canonical = await canonicalRuntimePath(path, isIgnoredRuntimePath);
    return new RouterHistory(
      canonical,
      validateHistoryFile(canonical),
      isIgnoredRuntimePath,
    );
  }

  get path() {
    return this.#path;
  }

  snapshot() {
    return this.#entries;
  }

  async reload() {
    this.#entries = validateHistoryFile(this.#path);
    return this.#entries;
  }

  async append(outcome, capability) {
    const normalized = normalizeQualityOutcome(outcome);
    const capabilityState = claimCapability(capability, normalized);
    const lockPath = `${this.#path}.lock`;
    let lock;
    let succeeded = false;
    let cleanupError;
    try {
      lock = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      await lock.sync();
      const current = validateHistoryFile(this.#path);
      const sequence = current.length + 1;
      const previousSha256 = current.at(-1)?.entrySha256 ?? null;
      const payload = envelopePayload(sequence, previousSha256, normalized);
      const entry = frozenEntry({
        ...payload,
        entrySha256: canonicalSha256(payload),
      });
      const next = Object.freeze([...current, entry]);
      validateCrossEntryInvariants(next);
      await atomicReplace(this.#path, next, this.#isIgnoredRuntimePath);
      this.#entries = next;
      succeeded = true;
      return entry;
    } finally {
      try {
        await lock?.close();
        if (lock !== undefined) await unlink(lockPath);
      } catch (error) {
        cleanupError = error;
      }
      releaseCapability(capabilityState, succeeded, capability);
      if (cleanupError !== undefined) {
        throw new Error(`router history lock cleanup failed: ${cleanupError.message}`);
      }
    }
  }
}
