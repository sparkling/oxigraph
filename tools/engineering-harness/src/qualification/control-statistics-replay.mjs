import { createHash } from "node:crypto";

import {
  G17_BENCHMARK_CASES,
  G17_CONTROL_SAMPLE_SCHEMA,
  G17_CONTROL_SAMPLE_SET_SCHEMA,
  G17_CONTROL_STATISTICS_CONTRACT,
  G17_CONTROL_STATISTICS_PROJECTION_SCHEMA,
  G17_DARWIN_PAIRED_BOOTSTRAP_BINDING,
} from "./control-statistics-contract.mjs";

const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const SAMPLE_SET_KEYS = Object.freeze([
  "schema",
  "runId",
  "suiteHash",
  "controlId",
  "authorization",
  "rows",
]);
const SAMPLE_KEYS = Object.freeze([
  "schema",
  "controlId",
  "caseId",
  "phase",
  "block",
  "pair",
  "slot",
  "repetition",
  "seed",
  "arm",
  "productRole",
  "buildId",
  "elapsedNs",
  "operations",
  "bytes",
  "readerObservations",
  "executableSha256",
  "rawSampleSha256",
]);

function fail(message) {
  throw new Error(`G1.7 control statistics: ${message}`);
}

function snapshotJsonData(value, label, ancestors = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    fail(`${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) fail(`${label} contains a cycle`);
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    fail(`${label} must contain only ordinary JSON objects and arrays`);
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) {
      fail(`${label} contains symbol fields`);
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      if ("get" in descriptor || "set" in descriptor) {
        fail(`${label} contains accessor fields`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        fail(`${label} array length is invalid`);
      }
      const expected = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ].sort();
      if (
        keys.length !== expected.length ||
        !keys.sort().every((key, index) => key === expected[index])
      ) {
        fail(`${label} arrays must be dense and field-free`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotJsonData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          ancestors,
        ),
      );
    }
    const result = {};
    for (const key of keys) {
      if (!descriptors[key].enumerable)
        fail(`${label}.${key} is not enumerable`);
      Object.defineProperty(result, key, {
        value: snapshotJsonData(
          descriptors[key].value,
          `${label}.${key}`,
          ancestors,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    !actual.every((key, index) => key === wanted[index])
  ) {
    fail(`${label} fields are not exact`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
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
    if (!Number.isFinite(value))
      fail("canonical value contains a non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    fail("canonical value is not acyclic JSON data");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalValue(entry, ancestors)).join(",")}]`;
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1)
    fail(`${label} must be a positive integer`);
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
}

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round6(value) {
  return +(Math.round(value * 1e6) / 1e6).toFixed(6);
}

/**
 * Attributed deterministic replay of @metaharness/darwin@0.9.3
 * dist/security/stats.js security.bootstrapDelta. The source and utility module
 * digests are frozen in G17_DARWIN_PAIRED_BOOTSTRAP_BINDING.
 */
export function replayG17DarwinBootstrapDelta(prevScores, newScores, opts) {
  const samples = opts?.samples ?? 5000;
  const seed = opts?.seed ?? 0;
  const minDelta = opts?.minDelta ?? 0;
  if (prevScores.length === 0 || newScores.length === 0) {
    return {
      meanDelta: 0,
      lower95: 0,
      upper95: 0,
      promote: false,
      samples,
      pValue: 1,
    };
  }
  const rng = makeRng(seed);
  const deltas = new Array(samples);
  let sum = 0;
  let nonPositive = 0;
  const paired = prevScores.length === newScores.length;
  const n = paired ? prevScores.length : 0;
  for (let index = 0; index < samples; index += 1) {
    let delta;
    if (paired) {
      let accumulator = 0;
      for (let pair = 0; pair < n; pair += 1) {
        const sampleIndex = Math.floor(rng() * n);
        accumulator += newScores[sampleIndex] - prevScores[sampleIndex];
      }
      delta = accumulator / n;
    } else {
      const previous = prevScores[Math.floor(rng() * prevScores.length)];
      const next = newScores[Math.floor(rng() * newScores.length)];
      delta = next - previous;
    }
    deltas[index] = delta;
    sum += delta;
    if (delta <= 0) nonPositive += 1;
  }
  deltas.sort((left, right) => left - right);
  const meanDelta = round6(sum / samples);
  const lower95 = round6(deltas[Math.floor(samples * 0.025)]);
  const upper95 = round6(deltas[Math.floor(samples * 0.975)]);
  const promote = meanDelta > minDelta && lower95 > 0;
  const pValue = round6(nonPositive / samples);
  return { meanDelta, lower95, upper95, promote, samples, pValue };
}

function expectedRows(control) {
  const protocol = G17_CONTROL_STATISTICS_CONTRACT.sampleSet;
  const expected = [];
  for (const [caseIndex, task] of G17_BENCHMARK_CASES.entries()) {
    for (const [phase, blocks] of [
      ["warmup", protocol.warmupBlocks],
      ["measured", protocol.measuredBlocks],
    ]) {
      for (let block = 0; block < blocks; block += 1) {
        const globalBlock =
          phase === "measured" ? protocol.warmupBlocks + block : block;
        const schedule =
          protocol.schedules[globalBlock % protocol.schedules.length];
        for (const [slot, arm] of schedule.entries()) {
          const pair = Math.floor(slot / 2);
          expected.push({
            task,
            schema: G17_CONTROL_SAMPLE_SCHEMA,
            controlId: control.id,
            caseId: task.id,
            phase,
            block,
            pair,
            slot,
            repetition: globalBlock * schedule.length + slot,
            seed:
              protocol.executionSeed.base +
              caseIndex * 100_000 +
              globalBlock * 2 +
              pair,
            arm,
            productRole: control[arm].productRole,
            buildId: control[arm].buildId,
          });
        }
      }
    }
  }
  return expected;
}

function validateSampleSetSnapshot(sampleSet, control) {
  exactKeys(sampleSet, SAMPLE_SET_KEYS, `${control.id} sample set`);
  exactKeys(
    sampleSet.authorization,
    ["rawSha256", "contentHash"],
    `${control.id} sample authorization`,
  );
  if (
    sampleSet.schema !== G17_CONTROL_SAMPLE_SET_SCHEMA ||
    !SAFE_ID.test(sampleSet.runId ?? "") ||
    sampleSet.suiteHash !== G17_CONTROL_STATISTICS_CONTRACT.suite.taskHash ||
    sampleSet.controlId !== control.id ||
    !Array.isArray(sampleSet.rows) ||
    !DIGEST.test(sampleSet.authorization.rawSha256 ?? "") ||
    !DIGEST.test(sampleSet.authorization.contentHash ?? "")
  ) {
    fail(`${control.id} sample set identity drifted`);
  }
  const expected = expectedRows(control);
  if (sampleSet.rows.length !== expected.length) {
    fail(`${control.id} sample inventory length drifted`);
  }
  const rawDigests = new Set();
  const executableDigests = new Map();
  for (const [index, row] of sampleSet.rows.entries()) {
    exactKeys(row, SAMPLE_KEYS, `${control.id} sample ${index}`);
    const wanted = expected[index];
    for (const key of [
      "schema",
      "controlId",
      "caseId",
      "phase",
      "block",
      "pair",
      "slot",
      "repetition",
      "seed",
      "arm",
      "productRole",
      "buildId",
    ]) {
      if (row[key] !== wanted[key]) fail(`${control.id} sample ${key} drifted`);
    }
    positiveInteger(row.elapsedNs, "elapsedNs");
    positiveInteger(row.operations, "operations");
    positiveInteger(row.bytes, "bytes");
    nonnegativeInteger(row.readerObservations, "readerObservations");
    if (row.operations !== wanted.task.operations * wanted.task.writers) {
      fail(`${control.id} sample operation count drifted`);
    }
    if (wanted.task.concurrentReaders !== row.readerObservations > 0) {
      fail(`${control.id} sample reader observation drifted`);
    }
    if (
      !DIGEST.test(row.executableSha256) ||
      !DIGEST.test(row.rawSampleSha256)
    ) {
      fail(`${control.id} sample digest is malformed`);
    }
    if (rawDigests.has(row.rawSampleSha256)) {
      fail(`${control.id} sample raw digest is duplicated`);
    }
    rawDigests.add(row.rawSampleSha256);
    const prior = executableDigests.get(row.buildId);
    if (prior !== undefined && prior !== row.executableSha256) {
      fail(`${control.id} build executable changed within the sample set`);
    }
    executableDigests.set(row.buildId, row.executableSha256);
  }
  if (executableDigests.size !== 2)
    fail(`${control.id} requires both build identities`);
  return deepFreeze(sampleSet);
}

export function validateG17ControlSampleSet(value, controlName) {
  const control = G17_CONTROL_STATISTICS_CONTRACT.controls[controlName];
  if (control === undefined) fail("control name is unsupported");
  return validateSampleSetSnapshot(
    snapshotJsonData(value, `${control.id} sample set`),
    control,
  );
}

export function g17ControlSampleSetBytes(value, controlName) {
  const validated = validateG17ControlSampleSet(value, controlName);
  return Buffer.from(`${canonicalJson(validated)}\n`, "utf8");
}

export function g17ControlSampleSetSha256(value, controlName) {
  return sha256(g17ControlSampleSetBytes(value, controlName));
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (
    sorted[middle - 1] + Math.floor((sorted[middle] - sorted[middle - 1]) / 2)
  );
}

function armStatistics(rows) {
  const elapsed = rows.map(({ elapsedNs }) => elapsedNs);
  const center = median(elapsed);
  return Object.freeze({
    count: elapsed.length,
    medianElapsedNs: center,
    medianAbsoluteDeviationNs: median(
      elapsed.map((value) => Math.abs(value - center)),
    ),
  });
}

function noisePass(arm) {
  return (
    BigInt(arm.medianAbsoluteDeviationNs) * 10_000n <=
    BigInt(arm.medianElapsedNs) *
      BigInt(G17_CONTROL_STATISTICS_CONTRACT.statistics.maximumMadBasisPoints)
  );
}

function roundDecimal(value, decimals) {
  const factor = 10 ** decimals;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function measuredPairs(sampleSet, task) {
  const rows = sampleSet.rows.filter(
    ({ caseId, phase }) => caseId === task.id && phase === "measured",
  );
  const pairs = [];
  for (let index = 0; index < rows.length; index += 2) {
    const pairRows = rows.slice(index, index + 2);
    const subject = pairRows.find(({ arm }) => arm === "subject");
    const reference = pairRows.find(({ arm }) => arm === "reference");
    if (
      pairRows.length !== 2 ||
      subject === undefined ||
      reference === undefined ||
      subject.caseId !== reference.caseId ||
      subject.block !== reference.block ||
      subject.pair !== reference.pair ||
      subject.seed !== reference.seed ||
      subject.operations !== reference.operations ||
      subject.bytes !== reference.bytes
    ) {
      fail(
        `${sampleSet.controlId} paired sample attributes drifted for ${task.id}`,
      );
    }
    pairs.push(Object.freeze({ subject, reference }));
  }
  if (
    pairs.length !==
    G17_CONTROL_STATISTICS_CONTRACT.sampleSet.measuredPairsPerCase
  ) {
    fail(`${sampleSet.controlId} measured pair count drifted for ${task.id}`);
  }
  return Object.freeze(pairs);
}

function bootstrapMargins(pairs, basisPoints, reverse, seed) {
  const margin = Math.log1p(basisPoints / 10_000);
  const scores = pairs.map(({ subject, reference }) =>
    roundDecimal(
      (reverse
        ? Math.log(subject.elapsedNs) - Math.log(reference.elapsedNs)
        : Math.log(reference.elapsedNs) - Math.log(subject.elapsedNs)) + margin,
      G17_CONTROL_STATISTICS_CONTRACT.statistics.scorePrecisionDecimals,
    ),
  );
  const result = replayG17DarwinBootstrapDelta(
    new Array(scores.length).fill(0),
    scores,
    {
      samples: G17_DARWIN_PAIRED_BOOTSTRAP_BINDING.samples,
      seed,
      minDelta: G17_DARWIN_PAIRED_BOOTSTRAP_BINDING.minDelta,
    },
  );
  return Object.freeze({
    seed,
    margins: Object.freeze(scores),
    bootstrap: Object.freeze(result),
    strictPass: result.promote === true && result.lower95 > 0,
  });
}

function summarizeCase(sampleSet, task, caseIndex, kind) {
  const pairs = measuredPairs(sampleSet, task);
  const subject = armStatistics(pairs.map(({ subject: row }) => row));
  const reference = armStatistics(pairs.map(({ reference: row }) => row));
  const subjectNoisePass = noisePass(subject);
  const referenceNoisePass = noisePass(reference);
  const quiet = subjectNoisePass && referenceNoisePass;
  const seedBase =
    G17_CONTROL_STATISTICS_CONTRACT.statistics.bootstrapSeed.base;
  if (kind === "negativeControl") {
    const nonInferiority = bootstrapMargins(
      pairs,
      G17_CONTROL_STATISTICS_CONTRACT.controls.negativeControl
        .maximumSlowdownBasisPoints,
      false,
      seedBase + caseIndex,
    );
    return Object.freeze({
      caseId: task.id,
      subject,
      reference,
      noise: Object.freeze({
        status: quiet ? "PASS" : "NOISY",
        subjectPass: subjectNoisePass,
        referencePass: referenceNoisePass,
      }),
      nonInferiority,
      quietBreach: quiet && !nonInferiority.strictPass,
    });
  }
  const sharedSeed = seedBase + caseIndex;
  const aWithinB = bootstrapMargins(
    pairs,
    G17_CONTROL_STATISTICS_CONTRACT.controls.aaNoiseControl
      .equivalenceBasisPoints,
    false,
    sharedSeed,
  );
  const bWithinA = bootstrapMargins(
    pairs,
    G17_CONTROL_STATISTICS_CONTRACT.controls.aaNoiseControl
      .equivalenceBasisPoints,
    true,
    sharedSeed,
  );
  return Object.freeze({
    caseId: task.id,
    subject,
    reference,
    noise: Object.freeze({
      status: quiet ? "PASS" : "NOISY",
      subjectPass: subjectNoisePass,
      referencePass: referenceNoisePass,
    }),
    equivalence: Object.freeze({
      sharedResampleSeed: sharedSeed,
      aWithinB,
      bWithinA,
      strictPass: aWithinB.strictPass && bWithinA.strictPass,
    }),
    quietDirectionFailure:
      quiet && (!aWithinB.strictPass || !bWithinA.strictPass),
  });
}

export function summarizeG17ControlSampleSets(input) {
  const supplied = snapshotJsonData(input, "control sample sets");
  exactKeys(
    supplied,
    ["negativeControl", "aaNoiseControl"],
    "control sample sets",
  );
  const negativeControl = validateSampleSetSnapshot(
    supplied.negativeControl,
    G17_CONTROL_STATISTICS_CONTRACT.controls.negativeControl,
  );
  const aaNoiseControl = validateSampleSetSnapshot(
    supplied.aaNoiseControl,
    G17_CONTROL_STATISTICS_CONTRACT.controls.aaNoiseControl,
  );
  if (
    negativeControl.runId !== aaNoiseControl.runId ||
    negativeControl.authorization.rawSha256 !==
      aaNoiseControl.authorization.rawSha256 ||
    negativeControl.authorization.contentHash !==
      aaNoiseControl.authorization.contentHash
  ) {
    fail("control sample sets do not share one run and authorization binding");
  }
  const negativeCases = G17_BENCHMARK_CASES.map((task, caseIndex) =>
    summarizeCase(negativeControl, task, caseIndex, "negativeControl"),
  );
  const aaCases = G17_BENCHMARK_CASES.map((task, caseIndex) =>
    summarizeCase(aaNoiseControl, task, caseIndex, "aaNoiseControl"),
  );
  const quietNegativeBreaches = negativeCases
    .filter(({ quietBreach }) => quietBreach)
    .map(({ caseId }) => caseId);
  const noisyNegativeCases = negativeCases
    .filter(({ noise }) => noise.status === "NOISY")
    .map(({ caseId }) => caseId);
  const quietAaDirectionFailures = aaCases
    .filter(({ quietDirectionFailure }) => quietDirectionFailure)
    .map(({ caseId }) => caseId);
  const noisyAaCases = aaCases
    .filter(({ noise }) => noise.status === "NOISY")
    .map(({ caseId }) => caseId);
  const negativeStatus =
    quietNegativeBreaches.length > 0
      ? "CONTROL_SEALED_PASS"
      : noisyNegativeCases.length > 0
        ? "CONTROL_SEALED_INCONCLUSIVE"
        : "CONTROL_SEALED_FAIL";
  const aaStatus =
    quietAaDirectionFailures.length > 0
      ? "CONTROL_SEALED_FAIL"
      : noisyAaCases.length > 0
        ? "CONTROL_SEALED_INCONCLUSIVE"
        : "CONTROL_SEALED_PASS";
  const statuses = [negativeStatus, aaStatus];
  const status = statuses.includes("CONTROL_SEALED_FAIL")
    ? "CONTROL_SEALED_FAIL"
    : statuses.includes("CONTROL_SEALED_INCONCLUSIVE")
      ? "CONTROL_SEALED_INCONCLUSIVE"
      : "CONTROL_SEALED_PASS";
  const reason =
    status === "CONTROL_SEALED_PASS"
      ? "NEGATIVE_BREACH_AND_AA_EQUIVALENCE_CONFIRMED"
      : aaStatus === "CONTROL_SEALED_FAIL"
        ? "QUIET_AA_DIRECTION_FAILURE"
        : negativeStatus === "CONTROL_SEALED_FAIL"
          ? "NEGATIVE_CONTROL_DETECTOR_MISSED"
          : "CONTROL_NOISE_INCONCLUSIVE";
  return deepFreeze({
    schema: G17_CONTROL_STATISTICS_PROJECTION_SCHEMA,
    owner: G17_DARWIN_PAIRED_BOOTSTRAP_BINDING.package,
    statisticsApi: G17_DARWIN_PAIRED_BOOTSTRAP_BINDING.api,
    status,
    reason,
    sampleSets: {
      negativeControl: {
        rows: negativeControl.rows.length,
        sha256: sha256(
          Buffer.from(`${canonicalJson(negativeControl)}\n`, "utf8"),
        ),
      },
      aaNoiseControl: {
        rows: aaNoiseControl.rows.length,
        sha256: sha256(
          Buffer.from(`${canonicalJson(aaNoiseControl)}\n`, "utf8"),
        ),
      },
    },
    negativeControl: {
      status: negativeStatus,
      quietBreaches: quietNegativeBreaches,
      noisyCases: noisyNegativeCases,
      cases: negativeCases,
    },
    aaNoiseControl: {
      status: aaStatus,
      quietDirectionFailures: quietAaDirectionFailures,
      noisyCases: noisyAaCases,
      cases: aaCases,
    },
    authority: {
      controlReceipt: false,
      qualificationExecution: false,
      promotion: false,
      publication: false,
    },
  });
}
