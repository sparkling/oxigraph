import { Router, calibrationReport } from "@metaharness/router";
import { canonicalSha256, routingEmbedding } from "./features.mjs";
import { NATIVE_PROVIDERS } from "./history.mjs";

export const MINIMUM_PAIRED_SAMPLES = 5;
export const REPAIR_PAIR_INTERVAL = 5;
export const QUALITY_FIRST_PROVIDER_ORDER = NATIVE_PROVIDERS;

const WORKER_ROLES = new Set([
  "architecture",
  "critique",
  "implementation",
  "review",
  "repair",
]);

function string(value, label, max = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function normalizeContext(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("routing context must be an object");
  }
  const models = value.models;
  if (models === null || typeof models !== "object" || Array.isArray(models)) {
    throw new Error("routing context must bind native provider models");
  }
  const normalizedModels = {};
  for (const provider of QUALITY_FIRST_PROVIDER_ORDER) {
    const model = string(models[provider], `${provider} model`, 256);
    if (/openrouter/i.test(model)) throw new Error("OpenRouter routing is prohibited");
    normalizedModels[provider] = model;
  }
  if (Object.keys(models).some((provider) => !NATIVE_PROVIDERS.includes(provider))) {
    throw new Error("routing context contains a non-native provider");
  }
  const role = string(value.role, "routing role", 64);
  if (!WORKER_ROLES.has(role)) throw new Error(`unsupported routing role: ${role}`);
  return Object.freeze({
    taskId: string(value.taskId, "routing taskId"),
    taskClass: string(value.taskClass, "routing taskClass"),
    role,
    contractSha256: digest(value.contractSha256, "routing contractSha256"),
    evaluatorSha256: digest(value.evaluatorSha256, "routing evaluatorSha256"),
    harnessSha256: digest(value.harnessSha256, "routing harnessSha256"),
    models: Object.freeze(normalizedModels),
  });
}

function fingerprint(context) {
  return canonicalSha256({
    evaluatorSha256: context.evaluatorSha256,
    harnessSha256: context.harnessSha256,
    models: context.models,
  });
}

function classOutcomes(entries, context) {
  return entries.filter(
    ({ outcome }) =>
      outcome.role === context.role && outcome.taskClass === context.taskClass,
  );
}

function currentFingerprint(entry, context) {
  const { outcome } = entry;
  return (
    outcome.evaluatorSha256 === context.evaluatorSha256 &&
    outcome.harnessSha256 === context.harnessSha256 &&
    QUALITY_FIRST_PROVIDER_ORDER.every(
      (provider) => outcome.models[provider] === context.models[provider],
    )
  );
}

function pairedOutcomes(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (entry.outcome.mode !== "paired") continue;
    const group = groups.get(entry.outcome.pairId) ?? [];
    group.push(entry);
    groups.set(entry.outcome.pairId, group);
  }
  const complete = [];
  const incomplete = [];
  for (const [pairId, group] of groups) {
    const providers = new Set(group.map(({ outcome }) => outcome.provider));
    if (
      group.length === NATIVE_PROVIDERS.length &&
      providers.size === NATIVE_PROVIDERS.length &&
      NATIVE_PROVIDERS.every((provider) => providers.has(provider))
    ) {
      complete.push(Object.freeze({ pairId, entries: Object.freeze(group) }));
    } else {
      incomplete.push(Object.freeze({ pairId, entries: Object.freeze(group) }));
    }
  }
  complete.sort((left, right) =>
    Math.max(...left.entries.map(({ sequence }) => sequence)) -
    Math.max(...right.entries.map(({ sequence }) => sequence)),
  );
  return Object.freeze({
    complete: Object.freeze(complete),
    incomplete: Object.freeze(incomplete),
  });
}

function candidateExamples(entries, provider) {
  return entries
    .filter(({ outcome }) => outcome.provider === provider)
    .map(({ embedding, outcome }) => ({ embedding, quality: outcome.quality }));
}

function qualityOnlyRouter(entries) {
  return new Router({
    // Router uses cost only when a qualityBar is supplied. Leaving it unset makes
    // this strictly highest-predicted-quality routing; equal sentinel prices make
    // the non-cost policy explicit in the frozen candidate data as well.
    candidates: QUALITY_FIRST_PROVIDER_ORDER.map((provider) => ({
      id: provider,
      costPerMTok: 1,
      examples: candidateExamples(entries, provider),
    })),
    k: 5,
  });
}

function frozenCalibrationReport(pairs) {
  const report = calibrationReport(pairs);
  const bins = Object.freeze(
    report.bins.map((bin) => Object.freeze({ ...bin })),
  );
  const worstBin =
    report.worstBin === null
      ? null
      : bins.find(
          (bin) =>
            bin.lo === report.worstBin.lo &&
            bin.hi === report.worstBin.hi &&
            bin.count === report.worstBin.count,
        ) ?? Object.freeze({ ...report.worstBin });
  return Object.freeze({ ...report, bins, worstBin });
}

function calibration(pairs) {
  if (pairs.length < MINIMUM_PAIRED_SAMPLES) {
    return Object.freeze({
      status: "INSUFFICIENT_SAMPLES",
      minimumSamples: MINIMUM_PAIRED_SAMPLES,
      pairedSamples: pairs.length,
      reports: null,
    });
  }
  const reports = {};
  for (const provider of QUALITY_FIRST_PROVIDER_ORDER) {
    const providerEntries = pairs.map((pair) =>
      pair.entries.find(({ outcome }) => outcome.provider === provider),
    );
    const calibrationPairs = providerEntries.map((heldOut, heldOutIndex) => {
      const examples = providerEntries
        .filter((_, index) => index !== heldOutIndex)
        .map(({ embedding, outcome }) => ({
          embedding,
          quality: outcome.quality,
        }));
      const router = new Router({
        candidates: [{ id: provider, costPerMTok: 1, examples }],
        k: Math.min(5, examples.length),
      });
      return {
        predicted: router.route(heldOut.embedding).predictedQuality,
        realized: heldOut.outcome.quality,
      };
    });
    reports[provider] = frozenCalibrationReport(calibrationPairs);
  }
  return Object.freeze({
    status: "READY",
    minimumSamples: MINIMUM_PAIRED_SAMPLES,
    pairedSamples: pairs.length,
    reports: Object.freeze(reports),
  });
}

function pairedDecision(context, embedding, reason, pairs, audit, admittedSincePair) {
  return Object.freeze({
    mode: "paired",
    reason,
    providers: QUALITY_FIRST_PROVIDER_ORDER,
    models: context.models,
    embedding,
    pairedSamples: pairs.length,
    admittedSincePair,
    calibration: audit,
    fingerprintSha256: fingerprint(context),
  });
}

export class QualityFirstRouter {
  #history;

  constructor({ history }) {
    if (
      history === null ||
      typeof history !== "object" ||
      typeof history.reload !== "function" ||
      typeof history.snapshot !== "function"
    ) {
      throw new Error("QualityFirstRouter requires a validated RouterHistory");
    }
    this.#history = history;
  }

  async route(value) {
    const context = normalizeContext(value);
    const embedding = routingEmbedding(context);
    const entries = await this.#history.reload();
    const classEntries = classOutcomes(entries, context);
    const allClassPairs = pairedOutcomes(classEntries).complete;
    const currentEntries = classEntries.filter((entry) =>
      currentFingerprint(entry, context),
    );
    const currentPairState = pairedOutcomes(currentEntries);
    const pairs = currentPairState.complete;
    const audit = calibration(pairs);

    if (pairs.length < MINIMUM_PAIRED_SAMPLES) {
      const reason = allClassPairs.length > pairs.length ? "drift" : "cold-start";
      return pairedDecision(context, embedding, reason, pairs, audit, 0);
    }
    if (currentPairState.incomplete.length > 0) {
      return pairedDecision(
        context,
        embedding,
        "incomplete-pair",
        pairs,
        audit,
        0,
      );
    }

    const lastPairSequence = Math.max(
      ...pairs.at(-1).entries.map(({ sequence }) => sequence),
    );
    const admittedSincePair = new Set(
      currentEntries
        .filter(({ sequence }) => sequence > lastPairSequence)
        .map(({ outcome }) => outcome.taskId),
    ).size;
    // The route decision is made before the current task can be admitted. Pair
    // the fifth task by opening paired mode once four admitted tasks are present.
    if (admittedSincePair >= REPAIR_PAIR_INTERVAL - 1) {
      return pairedDecision(
        context,
        embedding,
        "periodic-calibration",
        pairs,
        audit,
        admittedSincePair,
      );
    }

    const routed = qualityOnlyRouter(currentEntries).route(embedding);
    return Object.freeze({
      mode: "routed",
      reason: "quality-first",
      provider: routed.id,
      model: context.models[routed.id],
      predictedQuality: routed.predictedQuality,
      metBar: routed.metBar,
      embedding,
      providerOrder: QUALITY_FIRST_PROVIDER_ORDER,
      pairedSamples: pairs.length,
      admittedSincePair,
      calibration: audit,
      fingerprintSha256: fingerprint(context),
      engine: "@metaharness/router.Router",
    });
  }
}
