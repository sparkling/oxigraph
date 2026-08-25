import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { ReceiptLog } from "@metaharness/harness";
import {
  ROUTING_EMBEDDING_DIMENSION,
  canonicalJson,
  canonicalSha256,
  routingEmbedding,
} from "../routing/features.mjs";
import {
  directApplicationBinding,
  normalizeQualityOutcome,
} from "../routing/history.mjs";
import { validateNativeFailureCode } from "../policy/native-failures.mjs";

export const APPLICATION_RECEIPT_SCHEMA =
  "oxigraph.engineering-application-receipt/v2";
const LEGACY_APPLICATION_RECEIPT_SCHEMA =
  "oxigraph.engineering-application-receipt/v1";

const CHAIN_ALGORITHM = "sha256-canonical-json-chain/v1";
const UPSTREAM_FORMAT = "@metaharness/harness.ReceiptLog/v1";
const GENESIS = "0".repeat(64);
const DIGEST = /^[0-9a-f]{64}$/;
const GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_RECEIPT_BYTES = 64 * 1024 * 1024;
const NATIVE_PROVIDERS = Object.freeze(["codex", "claude"]);
const WORKER_ROLES = new Set([
  "architecture",
  "critique",
  "implementation",
  "review",
  "repair",
]);
const FINAL_VERDICTS = new Set(["ACCEPT", "REJECT", "INCONCLUSIVE"]);
const REQUIRED_ACCEPT_COMMANDS = Object.freeze([
  "format",
  "build",
  "public",
  "independent",
  "regression",
]);

const DRAFT_KEYS = new Set([
  "run",
  "control",
  "contract",
  "routing",
  "nativeInvocations",
  "attempts",
  "reviews",
  "selectedCandidate",
  "final",
  "events",
]);
const RECEIPT_KEYS = new Set([
  "schema",
  ...DRAFT_KEYS,
  "chain",
  "receiptSha256",
]);

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      descriptors[key]?.enumerable !== true ||
      !("value" in descriptors[key])
    ) {
      throw new Error(`${label} must contain only enumerable data properties`);
    }
  }
  return value;
}

function exactKeys(value, keys, label) {
  plainObject(value, label);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new Error(`${label} has unknown field: ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing field: ${key}`);
  }
}

function string(value, label, max = 1024) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    value.includes("\u0000")
  ) {
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

function gitObject(value, label) {
  if (typeof value !== "string" || !GIT_OBJECT.test(value)) {
    throw new Error(`${label} must be a lowercase Git object id`);
  }
  return value;
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in ${min}..${max}`);
  }
  return value;
}

function finite(value, label, { min = 0, max = Number.MAX_VALUE } = {}) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number in [${min}, ${max}]`);
  }
  return value;
}

function probability(value, label) {
  return finite(value, label, { min: 0, max: 1 });
}

function nullableString(value, label, max = 256) {
  return value === null ? null : string(value, label, max);
}

function boundedText(value, label, max = 4096) {
  if (typeof value !== "string" || value.length > max || value.includes("\u0000")) {
    throw new Error(`${label} must be a string of at most ${max} characters`);
  }
  return value;
}

function verdict(value, label) {
  if (!FINAL_VERDICTS.has(value)) {
    throw new Error(`${label} must be ACCEPT, REJECT, or INCONCLUSIVE`);
  }
  return value;
}

function nativeProvider(value, label) {
  const provider = string(value, label, 32);
  if (!NATIVE_PROVIDERS.includes(provider)) {
    throw new Error(`${label} must be a native provider`);
  }
  return provider;
}

function model(value, label) {
  const normalized = string(value, label, 256);
  if (/openrouter/i.test(normalized)) {
    throw new Error(`${label} may not route through OpenRouter`);
  }
  return normalized;
}

function role(value, label) {
  const normalized = string(value, label, 64);
  if (!WORKER_ROLES.has(normalized)) {
    throw new Error(`${label} is not a supported worker role`);
  }
  return normalized;
}

function timestamp(value, label) {
  const normalized = string(value, label, 64);
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new Error(`${label} must be a canonical UTC ISO-8601 timestamp`);
  }
  return normalized;
}

function stringArray(value, label, { min = 0, max = 1024 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain ${min}..${max} strings`);
  }
  return Object.freeze(
    value.map((item, index) => string(item, `${label}[${index}]`, 16_384)),
  );
}

function argumentArray(value, label, { min = 0, max = 1024 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new Error(`${label} must contain ${min}..${max} strings`);
  }
  return Object.freeze(
    value.map((item, index) =>
      boundedText(item, `${label}[${index}]`, 16_384),
    ),
  );
}

function uniqueStrings(value, label, options) {
  const normalized = stringArray(value, label, options);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} contains duplicates`);
  }
  return normalized;
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalClone(value, label) {
  let encoded;
  try {
    encoded = canonicalJson(value);
  } catch (error) {
    throw new Error(`${label} is not canonical JSON: ${error.message}`);
  }
  if (encoded === undefined) throw new Error(`${label} is not a JSON value`);
  return JSON.parse(encoded);
}

function normalizeRun(value) {
  exactKeys(
    value,
    new Set(["id", "taskId", "taskClass", "startedAt", "completedAt"]),
    "application run",
  );
  const startedAt = timestamp(value.startedAt, "run.startedAt");
  const completedAt = timestamp(value.completedAt, "run.completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error("run.completedAt may not precede run.startedAt");
  }
  return Object.freeze({
    id: string(value.id, "run.id"),
    taskId: string(value.taskId, "run.taskId"),
    taskClass: string(value.taskClass, "run.taskClass"),
    startedAt,
    completedAt,
  });
}

function normalizeControl(value) {
  exactKeys(
    value,
    new Set(["harnessSha256", "providerModels"]),
    "application control binding",
  );
  exactKeys(
    value.providerModels,
    new Set(NATIVE_PROVIDERS),
    "application provider-model map",
  );
  const providerModels = {};
  for (const provider of NATIVE_PROVIDERS) {
    providerModels[provider] = model(
      value.providerModels[provider],
      `control.providerModels.${provider}`,
    );
  }
  return Object.freeze({
    harnessSha256: digest(value.harnessSha256, "control.harnessSha256"),
    providerModels: Object.freeze(providerModels),
  });
}

function normalizeBaseline(value) {
  exactKeys(value, new Set(["commit", "tree"]), "contract baseline");
  return Object.freeze({
    commit: gitObject(value.commit, "contract.baseline.commit"),
    tree: gitObject(value.tree, "contract.baseline.tree"),
  });
}

function normalizeEvaluator(value) {
  exactKeys(
    value,
    new Set(["commit", "tree", "patchSha256"]),
    "contract evaluator",
  );
  return Object.freeze({
    commit: gitObject(value.commit, "contract.evaluator.commit"),
    tree: gitObject(value.tree, "contract.evaluator.tree"),
    patchSha256: digest(
      value.patchSha256,
      "contract.evaluator.patchSha256",
    ),
  });
}

function normalizeContract(value) {
  exactKeys(
    value,
    new Set(["sha256", "baseline", "evaluator", "success"]),
    "application contract binding",
  );
  exactKeys(
    value.success,
    new Set(["publicPassed", "independentPassed", "regressionPassed"]),
    "contract success counts",
  );
  return Object.freeze({
    sha256: digest(value.sha256, "contract.sha256"),
    baseline: normalizeBaseline(value.baseline),
    evaluator: normalizeEvaluator(value.evaluator),
    success: Object.freeze({
      publicPassed: integer(
        value.success.publicPassed,
        "contract.success.publicPassed",
        { min: 1 },
      ),
      independentPassed: integer(
        value.success.independentPassed,
        "contract.success.independentPassed",
        { min: 1 },
      ),
      regressionPassed: integer(
        value.success.regressionPassed,
        "contract.success.regressionPassed",
        { min: 1 },
      ),
    }),
  });
}

function normalizeReliabilityBin(value, label) {
  exactKeys(
    value,
    new Set(["lo", "hi", "count", "meanPredicted", "meanRealized", "gap"]),
    label,
  );
  return Object.freeze({
    lo: probability(value.lo, `${label}.lo`),
    hi: probability(value.hi, `${label}.hi`),
    count: integer(value.count, `${label}.count`),
    meanPredicted: probability(value.meanPredicted, `${label}.meanPredicted`),
    meanRealized: probability(value.meanRealized, `${label}.meanRealized`),
    gap: finite(value.gap, `${label}.gap`, { min: -1, max: 1 }),
  });
}

function normalizeCalibrationReport(value, label) {
  exactKeys(
    value,
    new Set(["samples", "brier", "ece", "bins", "worstBin"]),
    label,
  );
  if (!Array.isArray(value.bins) || value.bins.length === 0 || value.bins.length > 100) {
    throw new Error(`${label}.bins must be a non-empty bounded array`);
  }
  const bins = Object.freeze(
    value.bins.map((bin, index) =>
      normalizeReliabilityBin(bin, `${label}.bins[${index}]`),
    ),
  );
  const worstBin =
    value.worstBin === null
      ? null
      : normalizeReliabilityBin(value.worstBin, `${label}.worstBin`);
  return Object.freeze({
    samples: integer(value.samples, `${label}.samples`),
    brier: probability(value.brier, `${label}.brier`),
    ece: probability(value.ece, `${label}.ece`),
    bins,
    worstBin,
  });
}

function normalizeCalibration(value, label) {
  exactKeys(
    value,
    new Set(["status", "minimumSamples", "pairedSamples", "reports"]),
    label,
  );
  const status = string(value.status, `${label}.status`, 64);
  if (!new Set(["READY", "INSUFFICIENT_SAMPLES"]).has(status)) {
    throw new Error(`${label}.status is unsupported`);
  }
  let reports = null;
  if (value.reports !== null) {
    exactKeys(value.reports, new Set(NATIVE_PROVIDERS), `${label}.reports`);
    reports = {};
    for (const provider of NATIVE_PROVIDERS) {
      reports[provider] = normalizeCalibrationReport(
        value.reports[provider],
        `${label}.reports.${provider}`,
      );
    }
    reports = Object.freeze(reports);
  }
  if ((status === "READY") !== (reports !== null)) {
    throw new Error(`${label} status and reports disagree`);
  }
  return Object.freeze({
    status,
    minimumSamples: integer(value.minimumSamples, `${label}.minimumSamples`, {
      min: 1,
    }),
    pairedSamples: integer(value.pairedSamples, `${label}.pairedSamples`),
    reports,
  });
}

function normalizeEmbedding(value, label) {
  if (!Array.isArray(value) || value.length !== ROUTING_EMBEDDING_DIMENSION) {
    throw new Error(
      `${label} must contain ${ROUTING_EMBEDDING_DIMENSION} coordinates`,
    );
  }
  return Object.freeze(
    value.map((coordinate, index) =>
      finite(coordinate, `${label}[${index}]`, {
        min: Number.MIN_VALUE,
        max: 1,
      }),
    ),
  );
}

function routingFingerprint(control, contract) {
  return canonicalSha256({
    contractSha256: contract.sha256,
    evaluatorSha256: contract.evaluator.patchSha256,
    harnessSha256: control.harnessSha256,
    models: control.providerModels,
  });
}

function normalizeRoutingContext(value, run, control, contract, workerRole, label) {
  exactKeys(
    value,
    new Set([
      "taskId",
      "taskClass",
      "role",
      "contractSha256",
      "evaluatorSha256",
      "harnessSha256",
      "models",
    ]),
    label,
  );
  exactKeys(value.models, new Set(NATIVE_PROVIDERS), `${label}.models`);
  const models = {};
  for (const provider of NATIVE_PROVIDERS) {
    models[provider] = model(value.models[provider], `${label}.models.${provider}`);
    if (models[provider] !== control.providerModels[provider]) {
      throw new Error(`${label} changes the frozen ${provider} model`);
    }
  }
  const normalized = Object.freeze({
    taskId: string(value.taskId, `${label}.taskId`),
    taskClass: string(value.taskClass, `${label}.taskClass`),
    role: role(value.role, `${label}.role`),
    contractSha256: digest(value.contractSha256, `${label}.contractSha256`),
    evaluatorSha256: digest(value.evaluatorSha256, `${label}.evaluatorSha256`),
    harnessSha256: digest(value.harnessSha256, `${label}.harnessSha256`),
    models: Object.freeze(models),
  });
  if (
    normalized.taskClass !== run.taskClass ||
    normalized.role !== workerRole ||
    normalized.contractSha256 !== contract.sha256 ||
    normalized.evaluatorSha256 !== contract.evaluator.patchSha256 ||
    normalized.harnessSha256 !== control.harnessSha256
  ) {
    throw new Error(`${label} does not bind the frozen application control context`);
  }
  return normalized;
}

function assertRoutingBinding(decision, context, control, contract, label) {
  const expectedEmbedding = routingEmbedding(context);
  if (canonicalJson(decision.embedding) !== canonicalJson(expectedEmbedding)) {
    throw new Error(`${label} embedding does not bind the frozen task and control inputs`);
  }
  if (decision.fingerprintSha256 !== routingFingerprint(control, contract)) {
    throw new Error(
      `${label} fingerprint does not bind contract, evaluator, harness, and models`,
    );
  }
}

function normalizeRoutingDecision(value, context, control, contract, label) {
  plainObject(value, label);
  const mode = string(value.mode, `${label}.mode`, 32);
  let normalized;
  if (mode === "paired") {
    exactKeys(
      value,
      new Set([
        "mode",
        "reason",
        "providers",
        "models",
        "embedding",
        "pairedSamples",
        "admittedSincePair",
        "calibration",
        "fingerprintSha256",
      ]),
      label,
    );
    const providers = uniqueStrings(value.providers, `${label}.providers`, {
      min: NATIVE_PROVIDERS.length,
      max: NATIVE_PROVIDERS.length,
    });
    if (canonicalJson(providers) !== canonicalJson(NATIVE_PROVIDERS)) {
      throw new Error(`${label}.providers must use the frozen native-provider order`);
    }
    exactKeys(value.models, new Set(NATIVE_PROVIDERS), `${label}.models`);
    const models = {};
    for (const provider of NATIVE_PROVIDERS) {
      models[provider] = model(value.models[provider], `${label}.models.${provider}`);
      if (models[provider] !== control.providerModels[provider]) {
        throw new Error(`${label} changes the frozen ${provider} model`);
      }
    }
    normalized = Object.freeze({
      mode,
      reason: string(value.reason, `${label}.reason`, 64),
      providers,
      models: Object.freeze(models),
      embedding: normalizeEmbedding(value.embedding, `${label}.embedding`),
      pairedSamples: integer(value.pairedSamples, `${label}.pairedSamples`),
      admittedSincePair: integer(
        value.admittedSincePair,
        `${label}.admittedSincePair`,
      ),
      calibration: normalizeCalibration(value.calibration, `${label}.calibration`),
      fingerprintSha256: digest(
        value.fingerprintSha256,
        `${label}.fingerprintSha256`,
      ),
    });
  } else if (mode === "routed") {
    exactKeys(
      value,
      new Set([
        "mode",
        "reason",
        "provider",
        "model",
        "predictedQuality",
        "metBar",
        "embedding",
        "providerOrder",
        "pairedSamples",
        "admittedSincePair",
        "calibration",
        "fingerprintSha256",
        "engine",
      ]),
      label,
    );
    const provider = nativeProvider(value.provider, `${label}.provider`);
    const selectedModel = model(value.model, `${label}.model`);
    if (selectedModel !== control.providerModels[provider]) {
      throw new Error(`${label}.model does not match the frozen provider-model map`);
    }
    const providerOrder = uniqueStrings(
      value.providerOrder,
      `${label}.providerOrder`,
      { min: NATIVE_PROVIDERS.length, max: NATIVE_PROVIDERS.length },
    );
    if (canonicalJson(providerOrder) !== canonicalJson(NATIVE_PROVIDERS)) {
      throw new Error(`${label}.providerOrder is not the frozen provider order`);
    }
    if (typeof value.metBar !== "boolean") {
      throw new Error(`${label}.metBar must be boolean`);
    }
    if (value.engine !== "@metaharness/router.Router") {
      throw new Error(`${label}.engine must name the real upstream Router`);
    }
    normalized = Object.freeze({
      mode,
      reason: string(value.reason, `${label}.reason`, 64),
      provider,
      model: selectedModel,
      predictedQuality: probability(
        value.predictedQuality,
        `${label}.predictedQuality`,
      ),
      metBar: value.metBar,
      embedding: normalizeEmbedding(value.embedding, `${label}.embedding`),
      providerOrder,
      pairedSamples: integer(value.pairedSamples, `${label}.pairedSamples`),
      admittedSincePair: integer(
        value.admittedSincePair,
        `${label}.admittedSincePair`,
      ),
      calibration: normalizeCalibration(value.calibration, `${label}.calibration`),
      fingerprintSha256: digest(
        value.fingerprintSha256,
        `${label}.fingerprintSha256`,
      ),
      engine: value.engine,
    });
  } else {
    throw new Error(`${label}.mode must be paired or routed`);
  }
  assertRoutingBinding(normalized, context, control, contract, label);
  return normalized;
}

function normalizeRouting(
  value,
  run,
  control,
  contract,
  { sealed = false } = {},
) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new Error("routing must be a non-empty bounded array");
  }
  const ids = new Set();
  return Object.freeze(
    value.map((item, index) => {
      const label = `routing[${index}]`;
      exactKeys(
        item,
        sealed
          ? new Set(["id", "role", "context", "decision", "decisionSha256"])
          : new Set(["id", "role", "context", "decision"]),
        label,
      );
      const id = string(item.id, `${label}.id`);
      if (ids.has(id)) throw new Error(`routing contains duplicate id: ${id}`);
      ids.add(id);
      const workerRole = role(item.role, `${label}.role`);
      const context = normalizeRoutingContext(
        item.context,
        run,
        control,
        contract,
        workerRole,
        `${label}.context`,
      );
      const decision = normalizeRoutingDecision(
        item.decision,
        context,
        control,
        contract,
        `${label}.decision`,
      );
      const decisionSha256 = canonicalSha256(decision);
      if (sealed && item.decisionSha256 !== decisionSha256) {
        throw new Error(`${label}.decisionSha256 does not bind the exact decision`);
      }
      return Object.freeze({
        id,
        role: workerRole,
        context,
        decision,
        decisionSha256,
      });
    }),
  );
}

function normalizeAttestation(value, provider, executable, label) {
  exactKeys(
    value,
    new Set([
      "provider",
      "discoveredPath",
      "path",
      "sha256",
      "size",
      "mode",
      "uid",
      "gid",
    ]),
    label,
  );
  const attestedProvider = nativeProvider(value.provider, `${label}.provider`);
  const discoveredPath = string(
    value.discoveredPath,
    `${label}.discoveredPath`,
    4096,
  );
  const path = string(value.path, `${label}.path`, 4096);
  if (
    attestedProvider !== provider ||
    path !== executable ||
    !isAbsolute(discoveredPath) ||
    !isAbsolute(path)
  ) {
    throw new Error(`${label} does not bind the exact native executable`);
  }
  return Object.freeze({
    provider: attestedProvider,
    discoveredPath,
    path,
    sha256: digest(value.sha256, `${label}.sha256`),
    size: integer(value.size, `${label}.size`, { min: 1 }),
    mode: integer(value.mode, `${label}.mode`, { max: 0o777 }),
    uid: integer(value.uid, `${label}.uid`),
    gid: integer(value.gid, `${label}.gid`),
  });
}

function normalizeProcessOutcome(value, label) {
  exactKeys(
    value,
    new Set([
      "disposition",
      "exitCode",
      "signal",
      "durationMs",
      "stdoutSha256",
      "stderrSha256",
      "terminationErrors",
    ]),
    label,
  );
  const exitCode =
    value.exitCode === null
      ? null
      : integer(value.exitCode, `${label}.exitCode`, { max: 255 });
  if (!Array.isArray(value.terminationErrors) || value.terminationErrors.length > 32) {
    throw new Error(`${label}.terminationErrors must be a bounded array`);
  }
  const terminationErrors = Object.freeze(
    value.terminationErrors.map((item, index) => {
      const errorLabel = `${label}.terminationErrors[${index}]`;
      exactKeys(item, new Set(["signal", "error"]), errorLabel);
      return Object.freeze({
        signal: string(item.signal, `${errorLabel}.signal`, 64),
        error: string(item.error, `${errorLabel}.error`, 1024),
      });
    }),
  );
  return Object.freeze({
    disposition: string(value.disposition, `${label}.disposition`, 64),
    exitCode,
    signal: nullableString(value.signal, `${label}.signal`, 64),
    durationMs: integer(value.durationMs, `${label}.durationMs`),
    stdoutSha256: digest(value.stdoutSha256, `${label}.stdoutSha256`),
    stderrSha256: digest(value.stderrSha256, `${label}.stderrSha256`),
    terminationErrors,
  });
}

function successfulProcess(outcome) {
  return (
    outcome.disposition === "completed" &&
    outcome.exitCode === 0 &&
    outcome.signal === null
  );
}

function normalizeNativeInvocations(
  value,
  control,
  { requireDiagnostics = false } = {},
) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2048) {
    throw new Error("nativeInvocations must be a non-empty bounded array");
  }
  const ids = new Set();
  return Object.freeze(
    value.map((item, index) => {
      const label = `nativeInvocations[${index}]`;
      plainObject(item, label);
      const failed = item.status === "ERROR";
      const hasExecutionId = Object.hasOwn(item, "executionId");
      const hasFailureCode = Object.hasOwn(item, "failureCode");
      const hasFailureDetail = Object.hasOwn(item, "failureDetailSha256");
      if (hasFailureCode !== hasFailureDetail) {
        throw new Error(`${label} must bind both native failure fields together`);
      }
      if (hasFailureCode && (!hasExecutionId || failed)) {
        throw new Error(`${label} native failure classification has an invalid shape`);
      }
      if (requireDiagnostics && !hasExecutionId) {
        throw new Error(`${label} must bind its native execution id`);
      }
      if (
        requireDiagnostics &&
        item.status === "INCONCLUSIVE" &&
        !hasFailureCode
      ) {
        throw new Error(`${label} must classify its inconclusive native failure`);
      }
      const keys = failed
        ? new Set([
            "id",
            "routingId",
            "sequence",
            "provider",
            "model",
            "role",
            "status",
            "executable",
            "args",
            "executableAttestation",
            "taskSha256",
            "promptSha256",
            "process",
            "outputSha256",
            "patchSha256",
            "error",
            "errorSha256",
          ])
        : new Set([
            "id",
            "routingId",
            "sequence",
            "provider",
            "model",
            "role",
            "status",
            "executable",
            "args",
            "executableAttestation",
            "taskSha256",
            "promptSha256",
            "process",
            "outputSha256",
            "patchSha256",
          ]);
      if (hasExecutionId) keys.add("executionId");
      if (hasFailureCode) {
        keys.add("failureCode");
        keys.add("failureDetailSha256");
      }
      exactKeys(
        item,
        keys,
        label,
      );
      const id = string(item.id, `${label}.id`);
      if (ids.has(id)) throw new Error(`duplicate native invocation id: ${id}`);
      ids.add(id);
      const provider = nativeProvider(item.provider, `${label}.provider`);
      const selectedModel = model(item.model, `${label}.model`);
      if (selectedModel !== control.providerModels[provider]) {
        throw new Error(`${label}.model does not match the provider-model map`);
      }
      const sequence = integer(item.sequence, `${label}.sequence`, { min: 1 });
      if (sequence !== index + 1) {
        throw new Error(`${label}.sequence must preserve the complete pool evidence order`);
      }
      const common = {
        id,
        routingId: string(item.routingId, `${label}.routingId`),
        sequence,
        provider,
        role: role(item.role, `${label}.role`),
        model: selectedModel,
        ...(hasExecutionId
          ? { executionId: string(item.executionId, `${label}.executionId`, 512) }
          : {}),
      };
      if (failed) {
        if (
          item.executable !== null ||
          !Array.isArray(item.args) ||
          item.args.length !== 0 ||
          item.executableAttestation !== null ||
          item.taskSha256 !== null ||
          item.promptSha256 !== null ||
          item.process !== null ||
          item.outputSha256 !== null ||
          item.patchSha256 !== null
        ) {
          throw new Error(`${label} ERROR evidence must retain the pool's null failure shape`);
        }
        return Object.freeze({
          ...common,
          status: "ERROR",
          executable: null,
          args: Object.freeze([]),
          executableAttestation: null,
          taskSha256: null,
          promptSha256: null,
          process: null,
          outputSha256: null,
          patchSha256: null,
          error: string(item.error, `${label}.error`, 512),
          errorSha256: digest(item.errorSha256, `${label}.errorSha256`),
        });
      }
      const status = verdict(item.status, `${label}.status`);
      if (status !== "INCONCLUSIVE" && hasFailureCode) {
        throw new Error(`${label} classifies a native failure without INCONCLUSIVE status`);
      }
      const executable = string(item.executable, `${label}.executable`, 4096);
      if (!isAbsolute(executable) || /openrouter/i.test(executable)) {
        throw new Error(`${label}.executable must be an absolute native path`);
      }
      // Empty argv elements are semantically meaningful. Claude's native
      // tool-free boundary is expressed as the literal pair `--tools`, `""`.
      const args = argumentArray(item.args, `${label}.args`, { min: 1, max: 512 });
      if (args.some((argument) => /openrouter/i.test(argument))) {
        throw new Error(`${label}.args may not route through OpenRouter`);
      }
      if (!args.includes(selectedModel)) {
        throw new Error(`${label}.args do not bind the selected model`);
      }
      const process = normalizeProcessOutcome(item.process, `${label}.process`);
      if (status !== "INCONCLUSIVE" && !successfulProcess(process)) {
        throw new Error(`${label} claims ${status} without a successful process`);
      }
      const outputSha256 =
        item.outputSha256 === null
          ? null
          : digest(item.outputSha256, `${label}.outputSha256`);
      const patchSha256 =
        item.patchSha256 === null
          ? null
          : digest(item.patchSha256, `${label}.patchSha256`);
      if (status !== "INCONCLUSIVE" && outputSha256 === null) {
        throw new Error(`${label} completed worker evidence must bind its output`);
      }
      if (
        ["implementation", "repair"].includes(common.role) &&
        status === "ACCEPT" &&
        patchSha256 === null
      ) {
        throw new Error(`${label} accepted patch-producing role lacks patchSha256`);
      }
      return Object.freeze({
        ...common,
        status,
        executable,
        args,
        executableAttestation: normalizeAttestation(
          item.executableAttestation,
          provider,
          executable,
          `${label}.executableAttestation`,
        ),
        taskSha256: digest(item.taskSha256, `${label}.taskSha256`),
        promptSha256: digest(item.promptSha256, `${label}.promptSha256`),
        process,
        outputSha256,
        patchSha256,
        ...(hasFailureCode
          ? {
              failureCode: validateNativeFailureCode(
                item.failureCode,
                `${label}.failureCode`,
              ),
              failureDetailSha256: digest(
                item.failureDetailSha256,
                `${label}.failureDetailSha256`,
              ),
            }
          : {}),
      });
    }),
  );
}

function normalizeUpstreamReceipt(value, index, label) {
  const itemLabel = `${label}.receipts[${index}]`;
  exactKeys(
    value,
    new Set([
      "runId",
      "step",
      "inputHash",
      "outputHash",
      "agent",
      "model",
      "costUsd",
      "latencyMs",
      "verdict",
      "prevHash",
      "thisHash",
    ]),
    itemLabel,
  );
  const upstreamVerdict = string(value.verdict, `${itemLabel}.verdict`, 16);
  if (!new Set(["pass", "fail", "gated"]).has(upstreamVerdict)) {
    throw new Error(`${itemLabel}.verdict is unsupported`);
  }
  const agent = string(value.agent, `${itemLabel}.agent`);
  const upstreamModel = model(value.model, `${itemLabel}.model`);
  if (/openrouter/i.test(agent)) {
    throw new Error(`${itemLabel}.agent may not route through OpenRouter`);
  }
  return Object.freeze({
    runId: string(value.runId, `${itemLabel}.runId`),
    step: string(value.step, `${itemLabel}.step`),
    inputHash: digest(value.inputHash, `${itemLabel}.inputHash`),
    outputHash: digest(value.outputHash, `${itemLabel}.outputHash`),
    agent,
    model: upstreamModel,
    costUsd: finite(value.costUsd, `${itemLabel}.costUsd`),
    latencyMs: finite(value.latencyMs, `${itemLabel}.latencyMs`),
    verdict: upstreamVerdict,
    prevHash: digest(value.prevHash, `${itemLabel}.prevHash`),
    thisHash: digest(value.thisHash, `${itemLabel}.thisHash`),
  });
}

function strictUpstreamEntries(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4096) {
    throw new Error(`${label}.receipts must be a non-empty bounded array`);
  }
  return Object.freeze(
    value.map((receipt, index) => normalizeUpstreamReceipt(receipt, index, label)),
  );
}

function upstreamDraftEntries(value, label) {
  if (Array.isArray(value)) return strictUpstreamEntries(value, label);
  if (typeof value === "string") {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${label} is malformed upstream ReceiptLog JSON`);
    }
    exactKeys(parsed, new Set(["receipts"]), label);
    if (canonicalJson(parsed) !== value) {
      throw new Error(`${label} upstream ReceiptLog bytes are not canonical`);
    }
    return strictUpstreamEntries(parsed.receipts, label);
  }
  if (value instanceof ReceiptLog) {
    const verification = value.verify();
    if (!verification.ok) {
      throw new Error(`${label} upstream ReceiptLog is invalid`);
    }
    return strictUpstreamEntries(value.entries(), label);
  }
  throw new Error(`${label} must be ReceiptLog entries, export bytes, or a ReceiptLog`);
}

function sealUpstreamReceipts(value, label) {
  const receipts = upstreamDraftEntries(value, label);
  let log;
  try {
    log = ReceiptLog.fromJSON({ receipts: receipts.map((entry) => ({ ...entry })) });
  } catch (error) {
    throw new Error(`${label} failed upstream ReceiptLog verification: ${error.message}`);
  }
  const serialized = log.export();
  return Object.freeze({
    format: UPSTREAM_FORMAT,
    entryCount: log.length,
    tailHash: log.entries().at(-1)?.thisHash ?? GENESIS,
    serialized,
    serializedSha256: sha256Bytes(serialized),
  });
}

function normalizeSealedUpstreamReceipts(value, label) {
  exactKeys(
    value,
    new Set([
      "format",
      "entryCount",
      "tailHash",
      "serialized",
      "serializedSha256",
    ]),
    label,
  );
  if (value.format !== UPSTREAM_FORMAT) {
    throw new Error(`${label}.format does not identify the real ReceiptLog`);
  }
  const serialized = string(value.serialized, `${label}.serialized`, MAX_RECEIPT_BYTES);
  if (sha256Bytes(serialized) !== value.serializedSha256) {
    throw new Error(`${label}.serializedSha256 does not bind the complete bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(`${label}.serialized is malformed JSON`);
  }
  exactKeys(parsed, new Set(["receipts"]), `${label}.serialized root`);
  const receipts = strictUpstreamEntries(parsed.receipts, `${label}.serialized`);
  let log;
  try {
    log = ReceiptLog.import(serialized);
  } catch (error) {
    throw new Error(`${label} failed upstream ReceiptLog verification: ${error.message}`);
  }
  if (log.export() !== serialized || canonicalJson(parsed) !== serialized) {
    throw new Error(`${label}.serialized is not the exact canonical ReceiptLog export`);
  }
  if (value.entryCount !== log.length || value.entryCount !== receipts.length) {
    throw new Error(`${label}.entryCount does not bind the exact receipt count`);
  }
  const tailHash = log.entries().at(-1)?.thisHash ?? GENESIS;
  if (value.tailHash !== tailHash) {
    throw new Error(`${label}.tailHash does not bind the exact chain tail`);
  }
  return Object.freeze({
    format: value.format,
    entryCount: integer(value.entryCount, `${label}.entryCount`, { min: 1 }),
    tailHash: digest(value.tailHash, `${label}.tailHash`),
    serialized,
    serializedSha256: digest(
      value.serializedSha256,
      `${label}.serializedSha256`,
    ),
  });
}

function normalizeCommand(value, index, label) {
  const commandLabel = `${label}.commands[${index}]`;
  exactKeys(
    value,
    new Set([
      "name",
      "logicalArgv",
      "sandboxArgv",
      "network",
      "workspace",
      "exitCode",
      "signal",
      "disposition",
      "durationMs",
      "stdoutSha256",
      "stderrSha256",
      "stdoutTail",
      "stderrTail",
    ]),
    commandLabel,
  );
  const name = string(value.name, `${commandLabel}.name`, 64);
  if (!REQUIRED_ACCEPT_COMMANDS.includes(name)) {
    throw new Error(`${commandLabel}.name is not a frozen verifier command`);
  }
  const logicalArgv = stringArray(
    value.logicalArgv,
    `${commandLabel}.logicalArgv`,
    { min: 2, max: 256 },
  );
  const sandboxArgv = stringArray(
    value.sandboxArgv,
    `${commandLabel}.sandboxArgv`,
    { min: 2, max: 1024 },
  );
  if (logicalArgv[0] !== "cargo" || sandboxArgv.some((item) => /openrouter/i.test(item))) {
    throw new Error(`${commandLabel} is not a literal native Cargo invocation`);
  }
  if (value.network !== "isolated") {
    throw new Error(`${commandLabel}.network must be isolated`);
  }
  if (value.workspace !== "read-only") {
    throw new Error(`${commandLabel}.workspace must be read-only`);
  }
  return Object.freeze({
    name,
    logicalArgv,
    sandboxArgv,
    network: value.network,
    workspace: value.workspace,
    exitCode:
      value.exitCode === null
        ? null
        : integer(value.exitCode, `${commandLabel}.exitCode`, { max: 255 }),
    signal: nullableString(value.signal, `${commandLabel}.signal`, 64),
    disposition: string(value.disposition, `${commandLabel}.disposition`, 64),
    durationMs: integer(value.durationMs, `${commandLabel}.durationMs`),
    stdoutSha256: digest(value.stdoutSha256, `${commandLabel}.stdoutSha256`),
    stderrSha256: digest(value.stderrSha256, `${commandLabel}.stderrSha256`),
    stdoutTail: boundedText(value.stdoutTail, `${commandLabel}.stdoutTail`),
    stderrTail: boundedText(value.stderrTail, `${commandLabel}.stderrTail`),
  });
}

function normalizeArtifact(value, index, label) {
  const artifactLabel = `${label}.artifacts[${index}]`;
  exactKeys(value, new Set(["name", "sha256", "bytes"]), artifactLabel);
  return Object.freeze({
    name: string(value.name, `${artifactLabel}.name`, 4096),
    sha256: digest(value.sha256, `${artifactLabel}.sha256`),
    bytes: integer(value.bytes, `${artifactLabel}.bytes`, { min: 1 }),
  });
}

function normalizeProtectedManifest(value, label) {
  if (value === null) return null;
  exactKeys(value, new Set(["entries", "sha256"]), label);
  return Object.freeze({
    entries: integer(value.entries, `${label}.entries`, { min: 1 }),
    sha256: digest(value.sha256, `${label}.sha256`),
  });
}

function commandSucceeded(command) {
  return (
    command.disposition === "completed" &&
    command.exitCode === 0 &&
    command.signal === null
  );
}

function commandPassedCount(command, expectedPassed) {
  return (
    commandSucceeded(command) &&
    `${command.stdoutTail}\n${command.stderrTail}`.includes(
      `test result: ok. ${expectedPassed} passed; 0 failed;`,
    )
  );
}

function verifierQuality(verifier, contract) {
  if (!new Set(["ACCEPT", "REJECT"]).has(verifier.verdict)) return null;
  const expectedCount = {
    format: 1,
    build: 2,
    evaluation: 5,
    complete: 5,
  }[verifier.stage];
  if (
    expectedCount === undefined ||
    verifier.commands.length !== expectedCount ||
    verifier.artifacts.length === 0 ||
    verifier.commands.some(
      (command) =>
        command.disposition !== "completed" ||
        command.signal !== null ||
        command.exitCode === null,
    )
  ) {
    return null;
  }
  const [format, build] = verifier.commands;
  if (verifier.stage === "format") {
    return verifier.verdict === "REJECT" && format.exitCode !== 0 ? 0 : null;
  }
  if (format.exitCode !== 0) return null;
  if (verifier.stage === "build") {
    return verifier.verdict === "REJECT" && build.exitCode !== 0 ? 0 : null;
  }
  if (
    build.exitCode !== 0 ||
    verifier.candidateTree === null ||
    verifier.protectedManifest === null
  ) {
    return null;
  }
  const evaluatorsPassed = ["public", "independent", "regression"].every(
    (name) =>
      commandPassedCount(
        verifier.commands.find((command) => command.name === name),
        contract.success[`${name}Passed`],
      ),
  );
  if (verifier.verdict === "ACCEPT") {
    return verifier.stage === "complete" && evaluatorsPassed ? 1 : null;
  }
  return verifier.stage === "evaluation" && !evaluatorsPassed ? 0 : null;
}

function normalizeVerifier(value, contract, label) {
  exactKeys(
    value,
    new Set([
      "verdict",
      "stage",
      "commands",
      "artifacts",
      "durationMs",
      "candidateTree",
      "protectedManifest",
    ]),
    label,
  );
  if (!Array.isArray(value.commands) || value.commands.length === 0) {
    throw new Error(`${label}.commands must record every executed verifier command`);
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length > 4096) {
    throw new Error(`${label}.artifacts must be a bounded array`);
  }
  const commands = Object.freeze(
    value.commands.map((command, index) => normalizeCommand(command, index, label)),
  );
  const commandNames = commands.map(({ name }) => name);
  if (new Set(commandNames).size !== commandNames.length) {
    throw new Error(`${label}.commands contains duplicate command names`);
  }
  const expectedPrefix = REQUIRED_ACCEPT_COMMANDS.slice(0, commandNames.length);
  if (canonicalJson(commandNames) !== canonicalJson(expectedPrefix)) {
    throw new Error(`${label}.commands are not in the frozen execution order`);
  }
  const artifacts = Object.freeze(
    value.artifacts.map((artifact, index) => normalizeArtifact(artifact, index, label)),
  );
  if (new Set(artifacts.map(({ name }) => name)).size !== artifacts.length) {
    throw new Error(`${label}.artifacts contains duplicate names`);
  }
  const verifierVerdict = verdict(value.verdict, `${label}.verdict`);
  const candidateTree =
    value.candidateTree === null
      ? null
      : gitObject(value.candidateTree, `${label}.candidateTree`);
  const protectedManifest = normalizeProtectedManifest(
    value.protectedManifest,
    `${label}.protectedManifest`,
  );
  if (
    verifierVerdict === "ACCEPT" &&
    (value.stage !== "complete" ||
      canonicalJson(commandNames) !== canonicalJson(REQUIRED_ACCEPT_COMMANDS) ||
      !commands.every(commandSucceeded) ||
      !["public", "independent", "regression"].every((name) =>
        commandPassedCount(
          commands.find((command) => command.name === name),
          contract.success[`${name}Passed`],
        ),
      ) ||
      artifacts.length === 0 ||
      candidateTree === null ||
      protectedManifest === null)
  ) {
    throw new Error(`${label} claims ACCEPT without full successful verification`);
  }
  return Object.freeze({
    verdict: verifierVerdict,
    stage: string(value.stage, `${label}.stage`, 64),
    commands,
    artifacts,
    durationMs: integer(value.durationMs, `${label}.durationMs`),
    candidateTree,
    protectedManifest,
  });
}

function normalizeCandidateIdentity(value, label) {
  exactKeys(value, new Set(["commit", "tree", "protectedManifest"]), label);
  return Object.freeze({
    commit: gitObject(value.commit, `${label}.commit`),
    tree: gitObject(value.tree, `${label}.tree`),
    protectedManifest: normalizeProtectedManifest(
      value.protectedManifest,
      `${label}.protectedManifest`,
    ),
  });
}

function normalizeRoleBindings(value, roles, control, label) {
  exactKeys(value.providersByRole, new Set(roles), `${label}.providersByRole`);
  exactKeys(value.modelsByRole, new Set(roles), `${label}.modelsByRole`);
  const providersByRole = {};
  const modelsByRole = {};
  for (const workerRole of roles) {
    const provider = nativeProvider(
      value.providersByRole[workerRole],
      `${label}.providersByRole.${workerRole}`,
    );
    const selectedModel = model(
      value.modelsByRole[workerRole],
      `${label}.modelsByRole.${workerRole}`,
    );
    if (selectedModel !== control.providerModels[provider]) {
      throw new Error(`${label}.${workerRole} changes the frozen provider model`);
    }
    providersByRole[workerRole] = provider;
    modelsByRole[workerRole] = selectedModel;
  }
  return Object.freeze({
    providersByRole: Object.freeze(providersByRole),
    modelsByRole: Object.freeze(modelsByRole),
  });
}

function normalizeAttempts(value, control, contract, { sealed = false } = {}) {
  if (!Array.isArray(value) || value.length > 1024) {
    throw new Error("attempts must be a bounded array");
  }
  const ids = new Set();
  return Object.freeze(
    value.map((item, index) => {
      const label = `attempts[${index}]`;
      exactKeys(
        item,
        new Set([
          "id",
          "parentAttemptId",
          "roles",
          "providersByRole",
          "modelsByRole",
          "invocationIds",
          "upstreamReceipts",
          "patch",
          "patchSha256",
          "candidate",
          "verifier",
          "repairCycle",
          "disposition",
        ]),
        label,
      );
      const id = string(item.id, `${label}.id`);
      if (ids.has(id)) throw new Error(`duplicate candidate attempt id: ${id}`);
      ids.add(id);
      const roles = uniqueStrings(item.roles, `${label}.roles`, { min: 1, max: 5 });
      const normalizedRoles = Object.freeze(
        roles.map((workerRole, roleIndex) =>
          role(workerRole, `${label}.roles[${roleIndex}]`),
        ),
      );
      const roleBindings = normalizeRoleBindings(
        item,
        normalizedRoles,
        control,
        label,
      );
      const patch = string(item.patch, `${label}.patch`, 8 * 1024 * 1024);
      const patchSha256 = digest(item.patchSha256, `${label}.patchSha256`);
      if (sha256Bytes(patch) !== patchSha256) {
        throw new Error(`${label}.patchSha256 does not bind the admitted patch bytes`);
      }
      const candidate = normalizeCandidateIdentity(item.candidate, `${label}.candidate`);
      if (candidate.protectedManifest === null) {
        throw new Error(`${label}.candidate must bind the protected manifest`);
      }
      const verifier = normalizeVerifier(
        item.verifier,
        contract,
        `${label}.verifier`,
      );
      if (verifier.candidateTree !== null && verifier.candidateTree !== candidate.tree) {
        throw new Error(`${label}.verifier does not bind the candidate tree`);
      }
      if (
        verifier.protectedManifest !== null &&
        canonicalJson(verifier.protectedManifest) !==
          canonicalJson(candidate.protectedManifest)
      ) {
        throw new Error(`${label}.verifier does not bind the candidate protected manifest`);
      }
      const disposition = verdict(item.disposition, `${label}.disposition`);
      if (disposition !== verifier.verdict) {
        throw new Error(`${label}.disposition disagrees with its verifier`);
      }
      return Object.freeze({
        id,
        parentAttemptId:
          item.parentAttemptId === null
            ? null
            : string(item.parentAttemptId, `${label}.parentAttemptId`),
        roles: normalizedRoles,
        ...roleBindings,
        invocationIds: uniqueStrings(
          item.invocationIds,
          `${label}.invocationIds`,
          { min: 1, max: 32 },
        ),
        upstreamReceipts: sealed
          ? normalizeSealedUpstreamReceipts(
              item.upstreamReceipts,
              `${label}.upstreamReceipts`,
            )
          : sealUpstreamReceipts(item.upstreamReceipts, `${label}.upstreamReceipts`),
        patch,
        patchSha256,
        candidate,
        verifier,
        repairCycle: integer(item.repairCycle, `${label}.repairCycle`, { max: 100 }),
        disposition,
      });
    }),
  );
}

function normalizeReviews(value, { sealed = false } = {}) {
  if (!Array.isArray(value) || value.length > 2048) {
    throw new Error("reviews must be a bounded array");
  }
  const ids = new Set();
  return Object.freeze(
    value.map((item, index) => {
      const label = `reviews[${index}]`;
      exactKeys(
        item,
        new Set([
          "id",
          "attemptId",
          "provider",
          "model",
          "invocationId",
          "upstreamReceipts",
          "candidateSha256",
          "outputSha256",
          "disposition",
        ]),
        label,
      );
      const id = string(item.id, `${label}.id`);
      if (ids.has(id)) throw new Error(`duplicate review id: ${id}`);
      ids.add(id);
      return Object.freeze({
        id,
        attemptId: string(item.attemptId, `${label}.attemptId`),
        provider: nativeProvider(item.provider, `${label}.provider`),
        model: model(item.model, `${label}.model`),
        invocationId: string(item.invocationId, `${label}.invocationId`),
        upstreamReceipts: sealed
          ? normalizeSealedUpstreamReceipts(
              item.upstreamReceipts,
              `${label}.upstreamReceipts`,
            )
          : sealUpstreamReceipts(item.upstreamReceipts, `${label}.upstreamReceipts`),
        candidateSha256: digest(
          item.candidateSha256,
          `${label}.candidateSha256`,
        ),
        outputSha256: digest(item.outputSha256, `${label}.outputSha256`),
        disposition: verdict(item.disposition, `${label}.disposition`),
      });
    }),
  );
}

function normalizeSelectedCandidate(value) {
  if (value === null) return null;
  exactKeys(
    value,
    new Set(["attemptId", "patchSha256", "commit", "tree"]),
    "selectedCandidate",
  );
  return Object.freeze({
    attemptId: string(value.attemptId, "selectedCandidate.attemptId"),
    patchSha256: digest(value.patchSha256, "selectedCandidate.patchSha256"),
    commit: gitObject(value.commit, "selectedCandidate.commit"),
    tree: gitObject(value.tree, "selectedCandidate.tree"),
  });
}

function normalizeFinal(value) {
  exactKeys(value, new Set(["verdict", "reason"]), "final disposition");
  return Object.freeze({
    verdict: verdict(value.verdict, "final.verdict"),
    reason: string(value.reason, "final.reason", 4096),
  });
}

const EVENT_KINDS = new Set([
  "routing",
  "native-invocation",
  "attempt",
  "review",
  "selected-candidate",
  "final",
]);

function eventRecords({ run, routing, nativeInvocations, attempts, reviews, selectedCandidate, final }) {
  const records = new Map();
  const put = (kind, id, value) => {
    const key = `${kind}\u0000${id}`;
    if (records.has(key)) throw new Error(`duplicate event record: ${kind}/${id}`);
    records.set(key, value);
  };
  for (const item of routing) put("routing", item.id, item);
  for (const item of nativeInvocations) put("native-invocation", item.id, item);
  for (const item of attempts) put("attempt", item.id, item);
  for (const item of reviews) put("review", item.id, item);
  put(
    "selected-candidate",
    selectedCandidate?.attemptId ?? "none",
    selectedCandidate,
  );
  put("final", run.id, final);
  return records;
}

function eventBody({ sequence, previousSha256, bindingSha256, kind, id, recordSha256 }) {
  return {
    sequence,
    previousSha256,
    bindingSha256,
    kind,
    id,
    recordSha256,
  };
}

function buildEvents(value, state, bindingSha256) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8192) {
    throw new Error("events must be a non-empty bounded array");
  }
  const records = eventRecords(state);
  if (value.length !== records.size) {
    throw new Error("events must contain every application record exactly once");
  }
  const seen = new Set();
  const entries = [];
  let previousSha256 = GENESIS;
  for (let index = 0; index < value.length; index += 1) {
    const label = `events[${index}]`;
    exactKeys(value[index], new Set(["kind", "id"]), label);
    const kind = string(value[index].kind, `${label}.kind`, 64);
    if (!EVENT_KINDS.has(kind)) throw new Error(`${label}.kind is unsupported`);
    const id = string(value[index].id, `${label}.id`);
    const key = `${kind}\u0000${id}`;
    if (seen.has(key)) throw new Error(`events duplicates ${kind}/${id}`);
    seen.add(key);
    if (!records.has(key)) throw new Error(`events references unknown ${kind}/${id}`);
    const body = eventBody({
      sequence: index + 1,
      previousSha256,
      bindingSha256,
      kind,
      id,
      recordSha256: canonicalSha256(records.get(key)),
    });
    const entrySha256 = canonicalSha256(body);
    entries.push(Object.freeze({ ...body, entrySha256 }));
    previousSha256 = entrySha256;
  }
  if (seen.size !== records.size) {
    throw new Error("events omits an application record");
  }
  return Object.freeze(entries);
}

function normalizeSealedEvents(value, state, bindingSha256) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8192) {
    throw new Error("events must be a non-empty bounded array");
  }
  const records = eventRecords(state);
  if (value.length !== records.size) {
    throw new Error("events must bind the exact application record count");
  }
  const seen = new Set();
  const entries = [];
  let previousSha256 = GENESIS;
  for (let index = 0; index < value.length; index += 1) {
    const label = `events[${index}]`;
    exactKeys(
      value[index],
      new Set([
        "sequence",
        "previousSha256",
        "bindingSha256",
        "kind",
        "id",
        "recordSha256",
        "entrySha256",
      ]),
      label,
    );
    const kind = string(value[index].kind, `${label}.kind`, 64);
    if (!EVENT_KINDS.has(kind)) throw new Error(`${label}.kind is unsupported`);
    const id = string(value[index].id, `${label}.id`);
    const key = `${kind}\u0000${id}`;
    if (seen.has(key)) throw new Error(`events duplicates ${kind}/${id}`);
    seen.add(key);
    if (!records.has(key)) throw new Error(`events references unknown ${kind}/${id}`);
    const expected = eventBody({
      sequence: index + 1,
      previousSha256,
      bindingSha256,
      kind,
      id,
      recordSha256: canonicalSha256(records.get(key)),
    });
    const entrySha256 = canonicalSha256(expected);
    if (
      value[index].sequence !== expected.sequence ||
      value[index].previousSha256 !== expected.previousSha256 ||
      value[index].bindingSha256 !== expected.bindingSha256 ||
      value[index].recordSha256 !== expected.recordSha256 ||
      value[index].entrySha256 !== entrySha256
    ) {
      throw new Error(`${label} failed hash-chain replay`);
    }
    entries.push(Object.freeze({ ...expected, entrySha256 }));
    previousSha256 = entrySha256;
  }
  if (seen.size !== records.size) throw new Error("events omits an application record");
  return Object.freeze(entries);
}

function upstreamEntries(wrapper) {
  return JSON.parse(wrapper.serialized).receipts;
}

function assertUpstreamBinding(
  wrapper,
  providersByRole,
  modelsByRole,
  roles,
  label,
) {
  const receipts = upstreamEntries(wrapper);
  if (receipts.length !== roles.length) {
    throw new Error(`${label} does not bind one upstream receipt per declared role`);
  }
  const observedRoles = [];
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    const matchedRole = roles.find((workerRole) => receipt.step.endsWith(`:${workerRole}`));
    if (matchedRole === undefined) {
      throw new Error(`${label}.receipts[${index}] does not bind a declared role`);
    }
    const provider = providersByRole[matchedRole];
    const selectedModel = modelsByRole[matchedRole];
    if (receipt.agent !== `${provider}:${matchedRole}` || receipt.model !== selectedModel) {
      throw new Error(`${label}.receipts[${index}] is not native ${provider}/${selectedModel}`);
    }
    observedRoles.push(matchedRole);
    if (receipt.verdict !== "pass") {
      throw new Error(`${label} contains a non-passing structural upstream receipt`);
    }
  }
  if (
    new Set(observedRoles).size !== roles.length ||
    canonicalJson([...observedRoles].sort()) !== canonicalJson([...roles].sort())
  ) {
    throw new Error(`${label} does not bind every declared role exactly once`);
  }
}

function assertRoutingSelection(routeRecord, invocation, label) {
  if (routeRecord.role !== invocation.role) {
    throw new Error(`${label} role does not match its routing decision`);
  }
  const { decision } = routeRecord;
  if (decision.mode === "routed") {
    if (
      decision.provider !== invocation.provider ||
      decision.model !== invocation.model
    ) {
      throw new Error(`${label} does not match the routed provider/model`);
    }
  } else if (
    !decision.providers.includes(invocation.provider) ||
    decision.models[invocation.provider] !== invocation.model
  ) {
    throw new Error(`${label} does not match the paired provider/model map`);
  }
}

function eventIndex(events, kind, id) {
  return events.findIndex((entry) => entry.kind === kind && entry.id === id);
}

function assertSemanticInvariants(state) {
  const {
    run,
    control,
    routing,
    nativeInvocations,
    attempts,
    reviews,
    selectedCandidate,
    final,
    events,
  } = state;
  const routes = new Map(routing.map((item) => [item.id, item]));
  const invocations = new Map(nativeInvocations.map((item) => [item.id, item]));
  const attemptsById = new Map(attempts.map((item) => [item.id, item]));
  const referencedInvocations = new Set();
  const repairOutcomeIdentities = new Set();
  const executionBound = nativeInvocations.every((item) =>
    Object.hasOwn(item, "executionId"),
  );

  for (const invocation of nativeInvocations) {
    const routeRecord = routes.get(invocation.routingId);
    if (routeRecord === undefined) {
      throw new Error(`${invocation.id} references an unknown routing decision`);
    }
    assertRoutingSelection(routeRecord, invocation, invocation.id);
    if (eventIndex(events, "routing", routeRecord.id) >= eventIndex(events, "native-invocation", invocation.id)) {
      throw new Error(`${invocation.id} occurs before its routing decision`);
    }
  }

  for (const attempt of attempts) {
    if (attempt.roles.includes("review")) {
      throw new Error(`${attempt.id} may not use the review role`);
    }
    if (attempt.repairCycle === 0) {
      if (
        attempt.parentAttemptId !== null ||
        canonicalJson(attempt.roles) !==
          canonicalJson(["architecture", "critique", "implementation"])
      ) {
        throw new Error(
          `${attempt.id} initial attempt must bind the complete candidate role pipeline`,
        );
      }
    } else {
      if (
        attempt.parentAttemptId === null ||
        canonicalJson(attempt.roles) !== canonicalJson(["repair"])
      ) {
        throw new Error(`${attempt.id} repair attempt must name one parent and only repair`);
      }
      const parent = attemptsById.get(attempt.parentAttemptId);
      if (
        parent === undefined ||
        parent.repairCycle >= attempt.repairCycle ||
        eventIndex(events, "attempt", parent.id) >= eventIndex(events, "attempt", attempt.id)
      ) {
        throw new Error(`${attempt.id} does not follow a prior repair parent`);
      }
    }
    if (attempt.invocationIds.length !== attempt.roles.length) {
      throw new Error(`${attempt.id} must bind one native invocation per role`);
    }
    const observedRoles = [];
    const observedExecutions = new Set();
    for (const invocationId of attempt.invocationIds) {
      const invocation = invocations.get(invocationId);
      if (
        invocation === undefined ||
        invocation.provider !== attempt.providersByRole[invocation.role] ||
        invocation.model !== attempt.modelsByRole[invocation.role] ||
        invocation.role === "review"
      ) {
        throw new Error(`${attempt.id} has a mismatched native invocation`);
      }
      if (referencedInvocations.has(invocationId)) {
        throw new Error(`native invocation ${invocationId} is referenced more than once`);
      }
      referencedInvocations.add(invocationId);
      observedRoles.push(invocation.role);
      if (executionBound) observedExecutions.add(invocation.executionId);
      const routeRecord = routes.get(invocation.routingId);
      const expectedTaskId =
        invocation.role === "repair"
          ? `${run.id}:repair:${attempt.parentAttemptId}:${attempt.repairCycle}`
          : run.taskId;
      if (routeRecord.context.taskId !== expectedTaskId) {
        throw new Error(
          `${attempt.id} ${invocation.role} route does not bind its exact task id`,
        );
      }
      if (
        invocation.status === "ERROR" ||
        invocation.status === "INCONCLUSIVE" ||
        !successfulProcess(invocation.process)
      ) {
        throw new Error(`${attempt.id} includes preparation or inconclusive evidence`);
      }
      if (eventIndex(events, "native-invocation", invocationId) >= eventIndex(events, "attempt", attempt.id)) {
        throw new Error(`${attempt.id} occurs before native invocation ${invocationId}`);
      }
    }
    if (
      new Set(observedRoles).size !== attempt.roles.length ||
      canonicalJson([...observedRoles].sort()) !== canonicalJson([...attempt.roles].sort())
    ) {
      throw new Error(`${attempt.id} invocation roles do not match its declared roles`);
    }
    if (executionBound && observedExecutions.size !== 1) {
      throw new Error(`${attempt.id} combines native evidence from different executions`);
    }
    assertUpstreamBinding(
      attempt.upstreamReceipts,
      attempt.providersByRole,
      attempt.modelsByRole,
      attempt.roles,
      `${attempt.id}.upstreamReceipts`,
    );
    const patchRole = attempt.repairCycle === 0 ? "implementation" : "repair";
    const patchInvocation = attempt.invocationIds
      .map((invocationId) => invocations.get(invocationId))
      .find((invocation) => invocation.role === patchRole);
    if (patchInvocation?.patchSha256 !== attempt.patchSha256) {
      throw new Error(`${attempt.id} admitted patch differs from native ${patchRole} output`);
    }
    if (patchRole === "repair") {
      const routeRecord = routes.get(patchInvocation.routingId);
      const identity = `${routeRecord.context.taskId}\u0000repair\u0000${patchInvocation.provider}`;
      if (repairOutcomeIdentities.has(identity)) {
        throw new Error("repair routing task ids must be unique per provider and cycle");
      }
      repairOutcomeIdentities.add(identity);
    }
  }

  for (const review of reviews) {
    const attempt = attemptsById.get(review.attemptId);
    const invocation = invocations.get(review.invocationId);
    if (attempt === undefined) throw new Error(`${review.id} references an unknown attempt`);
    if (
      invocation === undefined ||
      invocation.role !== "review" ||
      invocation.provider !== review.provider ||
      invocation.model !== review.model ||
      invocation.outputSha256 !== review.outputSha256 ||
      invocation.status !== review.disposition ||
      !successfulProcess(invocation.process)
    ) {
      throw new Error(`${review.id} does not bind its exact native review invocation`);
    }
    if (routes.get(invocation.routingId).context.taskId !== run.taskId) {
      throw new Error(`${review.id} review route does not bind the application task id`);
    }
    if (review.model !== control.providerModels[review.provider]) {
      throw new Error(`${review.id} changes the frozen provider model`);
    }
    if (review.candidateSha256 !== attempt.patchSha256) {
      throw new Error(`${review.id} does not bind its candidate patch`);
    }
    if (referencedInvocations.has(review.invocationId)) {
      throw new Error(`native invocation ${review.invocationId} is referenced more than once`);
    }
    referencedInvocations.add(review.invocationId);
    if (
      eventIndex(events, "attempt", attempt.id) >= eventIndex(events, "review", review.id) ||
      eventIndex(events, "native-invocation", invocation.id) >= eventIndex(events, "review", review.id)
    ) {
      throw new Error(`${review.id} occurs before its attempt or invocation`);
    }
    assertUpstreamBinding(
      review.upstreamReceipts,
      { review: review.provider },
      { review: review.model },
      ["review"],
      `${review.id}.upstreamReceipts`,
    );
  }

  // Unreferenced evidence is retained deliberately: a native worker may finish
  // before trusted reconstruction fails, which is not a Router quality sample.
  const selectionIndex = eventIndex(
    events,
    "selected-candidate",
    selectedCandidate?.attemptId ?? "none",
  );
  const finalIndex = eventIndex(events, "final", run.id);
  if (selectionIndex !== events.length - 2 || finalIndex !== events.length - 1) {
    throw new Error("candidate selection and final verdict must close the event chain");
  }

  let selectedAttempt;
  if (selectedCandidate !== null) {
    selectedAttempt = attemptsById.get(selectedCandidate.attemptId);
    if (
      selectedAttempt === undefined ||
      selectedCandidate.patchSha256 !== selectedAttempt.patchSha256 ||
      selectedCandidate.commit !== selectedAttempt.candidate.commit ||
      selectedCandidate.tree !== selectedAttempt.candidate.tree
    ) {
      throw new Error("selectedCandidate does not bind an exact candidate attempt");
    }
  }

  if (final.verdict === "ACCEPT") {
    if (
      selectedAttempt === undefined ||
      selectedAttempt.disposition !== "ACCEPT" ||
      selectedAttempt.verifier.verdict !== "ACCEPT"
    ) {
      throw new Error("final ACCEPT requires an ACCEPTed, fully verified candidate");
    }
    const acceptedReviews = reviews.filter(
      (review) =>
        review.attemptId === selectedAttempt.id &&
        review.candidateSha256 === selectedAttempt.patchSha256 &&
        review.disposition === "ACCEPT" &&
        review.provider !==
          selectedAttempt.providersByRole[
            selectedAttempt.repairCycle === 0 ? "implementation" : "repair"
          ] &&
        successfulProcess(invocations.get(review.invocationId).process),
    );
    if (acceptedReviews.length === 0) {
      throw new Error("final ACCEPT requires successful independent cross-vendor review");
    }
  }
}

function chainMetadata(bindingSha256, events) {
  return Object.freeze({
    algorithm: CHAIN_ALGORITHM,
    bindingSha256,
    entryCount: events.length,
    tailSha256: events.at(-1)?.entrySha256 ?? GENESIS,
    eventsSha256: canonicalSha256(events),
  });
}

function normalizeChain(value, bindingSha256, events) {
  exactKeys(
    value,
    new Set([
      "algorithm",
      "bindingSha256",
      "entryCount",
      "tailSha256",
      "eventsSha256",
    ]),
    "application chain metadata",
  );
  const expected = chainMetadata(bindingSha256, events);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("application chain metadata does not bind count, tail, and entries");
  }
  return expected;
}

function receiptBody(state, schema = APPLICATION_RECEIPT_SCHEMA) {
  return {
    schema,
    run: state.run,
    control: state.control,
    contract: state.contract,
    routing: state.routing,
    nativeInvocations: state.nativeInvocations,
    attempts: state.attempts,
    reviews: state.reviews,
    selectedCandidate: state.selectedCandidate,
    final: state.final,
    events: state.events,
    chain: state.chain,
  };
}

function receiptControlBinding(run, control, contract) {
  return { run, control, contract };
}

function normalizeReceipt(value) {
  exactKeys(value, RECEIPT_KEYS, "application receipt");
  if (
    value.schema !== APPLICATION_RECEIPT_SCHEMA &&
    value.schema !== LEGACY_APPLICATION_RECEIPT_SCHEMA
  ) {
    throw new Error(`unsupported application receipt schema: ${value.schema}`);
  }
  const schema = value.schema;
  const run = normalizeRun(value.run);
  const control = normalizeControl(value.control);
  const contract = normalizeContract(value.contract);
  const routing = normalizeRouting(value.routing, run, control, contract, {
    sealed: true,
  });
  const nativeInvocations = normalizeNativeInvocations(
    value.nativeInvocations,
    control,
    { requireDiagnostics: schema === APPLICATION_RECEIPT_SCHEMA },
  );
  const attempts = normalizeAttempts(value.attempts, control, contract, {
    sealed: true,
  });
  const reviews = normalizeReviews(value.reviews, { sealed: true });
  const selectedCandidate = normalizeSelectedCandidate(value.selectedCandidate);
  const final = normalizeFinal(value.final);
  const bindingSha256 = canonicalSha256(
    receiptControlBinding(run, control, contract),
  );
  const partial = {
    run,
    control,
    contract,
    routing,
    nativeInvocations,
    attempts,
    reviews,
    selectedCandidate,
    final,
  };
  const events = normalizeSealedEvents(value.events, partial, bindingSha256);
  const state = { ...partial, events };
  assertSemanticInvariants(state);
  const chain = normalizeChain(value.chain, bindingSha256, events);
  const body = receiptBody({ ...state, chain }, schema);
  const receiptSha256 = canonicalSha256(body);
  if (value.receiptSha256 !== receiptSha256) {
    throw new Error("receiptSha256 does not bind the complete application receipt");
  }
  return deepFreeze({ ...body, receiptSha256 });
}

function parseCanonicalReceipt(serialized) {
  if (typeof serialized !== "string") {
    throw new Error("application receipt replay requires serialized JSON bytes");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    throw new Error(`application receipt exceeds ${MAX_RECEIPT_BYTES} bytes`);
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`application receipt is malformed JSON: ${error.message}`);
  }
  if (canonicalJson(parsed) !== serialized) {
    throw new Error("application receipt is not the exact canonical serialization");
  }
  return parsed;
}

/**
 * Seal a complete application-run draft without reading or writing the filesystem.
 * The draft is strict; the returned receipt adds chain metadata and a receipt hash.
 */
export function createApplicationReceipt(draft) {
  exactKeys(draft, DRAFT_KEYS, "application receipt draft");
  const run = normalizeRun(draft.run);
  const control = normalizeControl(draft.control);
  const contract = normalizeContract(draft.contract);
  const routing = normalizeRouting(draft.routing, run, control, contract);
  const nativeInvocations = normalizeNativeInvocations(
    draft.nativeInvocations,
    control,
    { requireDiagnostics: true },
  );
  const attempts = normalizeAttempts(draft.attempts, control, contract);
  const reviews = normalizeReviews(draft.reviews);
  const selectedCandidate = normalizeSelectedCandidate(draft.selectedCandidate);
  const final = normalizeFinal(draft.final);
  const bindingSha256 = canonicalSha256(
    receiptControlBinding(run, control, contract),
  );
  const partial = {
    run,
    control,
    contract,
    routing,
    nativeInvocations,
    attempts,
    reviews,
    selectedCandidate,
    final,
  };
  const events = buildEvents(draft.events, partial, bindingSha256);
  const state = { ...partial, events };
  assertSemanticInvariants(state);
  const chain = chainMetadata(bindingSha256, events);
  const body = receiptBody({ ...state, chain });
  const receipt = deepFreeze({
    ...body,
    receiptSha256: canonicalSha256(body),
  });
  const serialized = canonicalJson(receipt);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    throw new Error(`application receipt exceeds ${MAX_RECEIPT_BYTES} bytes`);
  }
  return receipt;
}

/** Deterministically serialize an already-valid application receipt. */
export function serializeApplicationReceipt(receipt) {
  const normalized = normalizeReceipt(receipt);
  const serialized = canonicalJson(normalized);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RECEIPT_BYTES) {
    throw new Error(`application receipt exceeds ${MAX_RECEIPT_BYTES} bytes`);
  }
  return serialized;
}

/**
 * Pure, owner-independent verification. No capability, process state, or path
 * ownership is consulted; success returns the normalized frozen receipt.
 */
export function verifyApplicationReceipt(value) {
  try {
    const parsed = typeof value === "string" ? parseCanonicalReceipt(value) : value;
    const receipt = normalizeReceipt(parsed);
    return Object.freeze({
      ok: true,
      receipt,
      receiptSha256: receipt.receiptSha256,
      entryCount: receipt.chain.entryCount,
      tailSha256: receipt.chain.tailSha256,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Parse canonical bytes, replay every inner and outer hash link, and fail closed. */
export function replayApplicationReceipt(serialized) {
  return normalizeReceipt(parseCanonicalReceipt(serialized));
}

function qualityTarget(receipt, routeRecord, invocation, candidateSha256, quality, repairCycles) {
  const { context, decision } = routeRecord;
  const target = {
    taskId: context.taskId,
    taskClass: context.taskClass,
    role: context.role,
    provider: invocation.provider,
    model: invocation.model,
    models: receipt.control.providerModels,
    candidateSha256,
    evaluatorSha256: receipt.contract.evaluator.patchSha256,
    contractSha256: receipt.contract.sha256,
    harnessSha256: receipt.control.harnessSha256,
    disposition: "verified",
    quality,
    mode: decision.mode,
    pairId:
      decision.mode === "paired" ? `${context.taskId}:${context.role}` : null,
    repairCycles,
  };
  if (decision.mode === "routed") {
    target.predictedQuality = decision.predictedQuality;
  }
  return normalizeQualityOutcome(target);
}

function receiptQualityTargets(receipt) {
  const routes = new Map(receipt.routing.map((item) => [item.id, item]));
  const invocations = new Map(
    receipt.nativeInvocations.map((item) => [item.id, item]),
  );
  const attempts = new Map(receipt.attempts.map((item) => [item.id, item]));
  const targets = [];
  for (const attempt of receipt.attempts) {
    const quality = verifierQuality(attempt.verifier, receipt.contract);
    if (quality === null) continue;
    const admittedRoles =
      attempt.repairCycle === 0
        ? ["architecture", "critique", "implementation"]
        : ["repair"];
    for (const workerRole of admittedRoles) {
      const invocation = attempt.invocationIds
        .map((id) => invocations.get(id))
        .find((item) => item.role === workerRole);
      if (
        invocation === undefined ||
        invocation.status === "ERROR" ||
        invocation.status === "INCONCLUSIVE" ||
        !successfulProcess(invocation.process)
      ) {
        continue;
      }
      targets.push(
        Object.freeze({
          recordId: `attempt:${attempt.id}:${workerRole}`,
          kind: "attempt",
          attemptId: attempt.id,
          reviewId: null,
          outcome: qualityTarget(
            receipt,
            routes.get(invocation.routingId),
            invocation,
            attempt.patchSha256,
            quality,
            attempt.repairCycle,
          ),
        }),
      );
    }
  }
  for (const review of receipt.reviews) {
    if (!new Set(["ACCEPT", "REJECT"]).has(review.disposition)) continue;
    const invocation = invocations.get(review.invocationId);
    const attempt = attempts.get(review.attemptId);
    if (
      invocation === undefined ||
      attempt === undefined ||
      invocation.status === "ERROR" ||
      invocation.status === "INCONCLUSIVE" ||
      !successfulProcess(invocation.process)
    ) {
      continue;
    }
    targets.push(
      Object.freeze({
        recordId: `review:${review.id}`,
        kind: "review",
        attemptId: attempt.id,
        reviewId: review.id,
        outcome: qualityTarget(
          receipt,
          routes.get(invocation.routingId),
          invocation,
          attempt.patchSha256,
          review.disposition === "ACCEPT" ? 1 : 0,
          attempt.repairCycle,
        ),
      }),
    );
  }
  return Object.freeze(targets);
}

/**
 * Verify a receipt, then enumerate every exact Router quality outcome it may
 * authorize. Preparation failures, dependency suppression, infrastructure
 * failures, and inconclusive evidence are deliberately absent.
 */
export function applicationReceiptQualityOutcomes(value) {
  const verification = verifyApplicationReceipt(value);
  if (!verification.ok) {
    throw new Error(`invalid application receipt: ${verification.reason}`);
  }
  return receiptQualityTargets(verification.receipt);
}

/**
 * Authorize an exact Router outcome for any fully evaluated candidate/repair
 * attempt or structurally completed review, including losing evidence.
 */
export function verifyApplicationReceiptOutcome(value, outcome) {
  let normalizedOutcome;
  try {
    normalizedOutcome = normalizeQualityOutcome(outcome);
  } catch (error) {
    return Object.freeze({
      verified: false,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  const verification = verifyApplicationReceipt(value);
  if (!verification.ok) {
    return Object.freeze({ verified: false, reason: verification.reason });
  }
  const matches = receiptQualityTargets(verification.receipt).filter(
    (target) => canonicalJson(target.outcome) === canonicalJson(normalizedOutcome),
  );
  if (matches.length === 0) {
    return Object.freeze({
      verified: false,
      reason: "quality outcome is not bound to completed application evidence",
    });
  }
  const records = Object.freeze(
    matches.map(({ recordId, kind, attemptId, reviewId }) =>
      Object.freeze({ recordId, kind, attemptId, reviewId }),
    ),
  );
  const match = records[0];
  const binding = directApplicationBinding(normalizedOutcome);
  return Object.freeze({
    verified: true,
    binding,
    bindingSha256: canonicalSha256(binding),
    receiptSha256: verification.receipt.receiptSha256,
    kind: match.kind,
    attemptId: match.attemptId,
    reviewId: match.reviewId,
    recordId: matches.length === 1 ? match.recordId : null,
    records,
  });
}
