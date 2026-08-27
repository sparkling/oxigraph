import { isDeepStrictEqual } from "node:util";

import {
  G17_DARWIN_STATISTICS,
  G17_DARWIN_RUNTIME_MODULES,
  G17_QUALIFICATION_SAMPLE_SCHEMA,
  loadG17DarwinFunctions,
  verifyG17DarwinRuntime,
} from "./benchmark-contract.mjs";
import { validateG17DecisionSetBinding } from "./decision-contract.mjs";

const {
  hashTasks: darwinHashTasks,
  verifySuite: darwinVerifySuite,
  pairedBootstrapDelta,
} = await loadG17DarwinFunctions();

const DIGEST = /^[0-9a-f]{64}$/u;
const SAMPLE_KEYS = Object.freeze([
  "schema",
  "caseId",
  "phase",
  "block",
  "pair",
  "slot",
  "repetition",
  "seed",
  "implementation",
  "elapsedNs",
  "operations",
  "bytes",
  "readerObservations",
  "executableSha256",
  "rawSampleSha256",
]);
const SORTED_SAMPLE_KEYS = Object.freeze([...SAMPLE_KEYS].sort());

function fail(message) {
  throw new Error(`G1.7 benchmark: ${message}`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive integer`);
  }
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left + Math.floor((right - left) / 2);
}

function nearestRankP95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function statistics(rows) {
  const elapsed = rows.map(({ elapsedNs }) => elapsedNs);
  const center = median(elapsed);
  return Object.freeze({
    count: rows.length,
    medianElapsedNs: center,
    p95ElapsedNs: nearestRankP95(elapsed),
    medianAbsoluteDeviationNs: median(
      elapsed.map((value) => Math.abs(value - center)),
    ),
  });
}

function roundDecimal(value, decimals) {
  const factor = 10 ** decimals;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}

function noisePass(arm, maximumMadBasisPoints) {
  return (
    BigInt(arm.medianAbsoluteDeviationNs) * 10_000n <=
    BigInt(arm.medianElapsedNs) * BigInt(maximumMadBasisPoints)
  );
}

export function verifyG17BenchmarkSuite(contract) {
  verifyG17DarwinRuntime();
  const suite = contract?.benchmark?.suite;
  if (!suite || !Array.isArray(suite.tasks)) {
    fail("Darwin benchmark suite is missing");
  }
  const verification = darwinVerifySuite(suite);
  if (
    !verification.ok ||
    verification.actual !== darwinHashTasks(suite.tasks)
  ) {
    fail("Darwin benchmark suite hash does not verify");
  }
  return Object.freeze(verification);
}

function validateRow(row, expected, task, executableDigests) {
  if (
    row === null ||
    typeof row !== "object" ||
    Array.isArray(row) ||
    !isDeepStrictEqual(Object.keys(row).sort(), SORTED_SAMPLE_KEYS)
  ) {
    fail("sample field set is not exact");
  }
  for (const key of [
    "schema",
    "caseId",
    "phase",
    "block",
    "pair",
    "slot",
    "repetition",
    "seed",
    "implementation",
  ]) {
    if (row[key] !== expected[key]) fail(`sample ${key} drifted`);
  }
  positiveInteger(row.elapsedNs, "elapsedNs");
  positiveInteger(row.operations, "operations");
  positiveInteger(row.bytes, "bytes");
  nonnegativeInteger(row.readerObservations, "readerObservations");
  const expectedOperations = task.operations * task.writers;
  if (row.operations !== expectedOperations) {
    fail("sample operation count drifted");
  }
  if (task.concurrentReaders !== row.readerObservations > 0) {
    fail("sample concurrent-reader observation drifted");
  }
  if (!DIGEST.test(row.executableSha256)) {
    fail("sample executable digest is malformed");
  }
  if (!DIGEST.test(row.rawSampleSha256)) {
    fail("raw sample digest is malformed");
  }
  const prior = executableDigests.get(row.implementation);
  if (prior !== undefined && prior !== row.executableSha256) {
    fail("implementation executable digest changed within the run");
  }
  executableDigests.set(row.implementation, row.executableSha256);
}

function decisionCaseMap(decision, tasks, field, label) {
  if (!Array.isArray(decision?.cases)) fail(`${label} cases are missing`);
  const expectedIds = tasks.map(({ id }) => id);
  const observedIds = decision.cases.map(({ id }) => id);
  if (!isDeepStrictEqual(observedIds, expectedIds)) {
    fail(`${label} case order drifted`);
  }
  const result = new Map();
  for (const entry of decision.cases) {
    positiveInteger(entry[field], `${label} ${entry.id} ${field}`);
    result.set(entry.id, entry[field]);
  }
  return result;
}

function pairedRows(rows, task, expectedPairs) {
  const pairs = new Map();
  for (const row of rows) {
    const key = `${row.block}:${row.pair}:${row.seed}`;
    let pair = pairs.get(key);
    if (pair === undefined) {
      pair = {
        block: row.block,
        pair: row.pair,
        seed: row.seed,
        subject: null,
        reference: null,
      };
      pairs.set(key, pair);
    }
    if (pair[row.implementation] !== null) {
      fail(`duplicate ${row.implementation} row in a pair for ${task.id}`);
    }
    pair[row.implementation] = row;
  }
  const ordered = [...pairs.values()].sort(
    (left, right) => left.block - right.block || left.pair - right.pair,
  );
  if (
    ordered.length !== expectedPairs ||
    ordered.some(
      ({ subject, reference }) => subject === null || reference === null,
    )
  ) {
    fail(`paired sample inventory drifted for ${task.id}`);
  }
  for (const { subject, reference } of ordered) {
    if (
      subject.caseId !== reference.caseId ||
      subject.seed !== reference.seed ||
      subject.operations !== reference.operations ||
      subject.bytes !== reference.bytes
    ) {
      fail(`paired sample attributes drifted for ${task.id}`);
    }
  }
  return ordered;
}

function pairedNonInferiority({
  pairs,
  maximumSlowdownBasisPoints,
  bootstrap,
  seed,
  noisy,
}) {
  const margin = Math.log1p(maximumSlowdownBasisPoints / 10_000);
  const margins = pairs.map(({ subject, reference }) =>
    roundDecimal(
      Math.log(reference.elapsedNs) - Math.log(subject.elapsedNs) + margin,
      bootstrap.scorePrecisionDecimals,
    ),
  );
  const result = Object.freeze(
    pairedBootstrapDelta(new Array(pairs.length).fill(0), margins, {
      samples: bootstrap.samples,
      seed,
      minDelta: bootstrap.minDelta,
    }),
  );
  const passed = result.promote === true && result.lower95 > 0;
  return Object.freeze({
    status: noisy ? "INCONCLUSIVE" : passed ? "PASS" : "FAIL",
    maximumSlowdownBasisPoints,
    pairedSamples: pairs.length,
    margins: Object.freeze(margins),
    bootstrap: result,
  });
}

export function summarizeG17Samples(
  samples,
  contract,
  decisions,
  { startedAt } = {},
) {
  try {
    const darwin = verifyG17DarwinRuntime();
    verifyG17BenchmarkSuite(contract);
    const decisionSet = validateG17DecisionSetBinding({
      contract,
      decisions,
      startedAt,
    });
    if (!Array.isArray(samples)) fail("samples must be an array");
    const protocol = contract?.benchmark?.protocol;
    const statisticsContract = contract?.benchmark?.statistics;
    const schedules = protocol?.schedules;
    if (
      !isDeepStrictEqual(schedules, [
        ["subject", "reference", "reference", "subject"],
        ["reference", "subject", "subject", "reference"],
      ]) ||
      !Number.isSafeInteger(protocol?.warmupBlocks) ||
      protocol.warmupBlocks < 0 ||
      !Number.isSafeInteger(protocol?.measuredBlocks) ||
      protocol.measuredBlocks < 1 ||
      protocol.seedDerivation !==
        "base-plus-case100000-plus-globalblock2-plus-pair" ||
      !Number.isSafeInteger(protocol.seed) ||
      protocol.seed < 0 ||
      protocol.qualificationSampleSchema !== G17_QUALIFICATION_SAMPLE_SCHEMA ||
      statisticsContract?.bootstrapApi !== "security.bootstrapDelta" ||
      statisticsContract?.packageVersion !== G17_DARWIN_STATISTICS.version ||
      statisticsContract?.packageIntegrity !==
        G17_DARWIN_STATISTICS.packageIntegrity ||
      statisticsContract?.statisticsModuleSha256 !==
        G17_DARWIN_STATISTICS.statisticsModuleSha256 ||
      !isDeepStrictEqual(
        statisticsContract?.runtimeModuleSha256,
        G17_DARWIN_RUNTIME_MODULES,
      ) ||
      statisticsContract?.bootstrapSeedDerivation !== "base-plus-case-index" ||
      statisticsContract?.bootstrapSamples !== G17_DARWIN_STATISTICS.samples ||
      statisticsContract?.bootstrapSeed !== G17_DARWIN_STATISTICS.baseSeed ||
      statisticsContract?.bootstrapScorePrecisionDecimals !==
        G17_DARWIN_STATISTICS.scorePrecisionDecimals
    ) {
      fail("protocol or statistics are invalid");
    }

    const tasks = contract.benchmark.suite.tasks;
    const performanceCases = decisionCaseMap(
      decisionSet.performance,
      tasks,
      "maximumSlowdownBasisPoints",
      "performance budget",
    );
    const noiseCases = decisionCaseMap(
      decisionSet.noise,
      tasks,
      "maximumMadBasisPoints",
      "noise budget",
    );
    const bootstrap = decisionSet.performance.bootstrap;
    if (
      bootstrap?.api !== "security.bootstrapDelta" ||
      bootstrap.samples !== statisticsContract.bootstrapSamples ||
      bootstrap.baseSeed !== statisticsContract.bootstrapSeed ||
      bootstrap.caseSeedDerivation !== "base-plus-case-index" ||
      bootstrap.minDelta !== 0 ||
      bootstrap.scorePrecisionDecimals !== 12 ||
      bootstrap.decision !== "lower95-strictly-positive"
    ) {
      fail("performance decision does not bind the paired Darwin statistic");
    }

    const expected = [];
    for (const [caseIndex, task] of tasks.entries()) {
      for (const [phase, blocks] of [
        ["warmup", protocol.warmupBlocks],
        ["measured", protocol.measuredBlocks],
      ]) {
        for (let block = 0; block < blocks; block += 1) {
          const globalBlock =
            (phase === "measured" ? protocol.warmupBlocks : 0) + block;
          const schedule = schedules[globalBlock % schedules.length];
          for (const [slot, implementation] of schedule.entries()) {
            expected.push({
              task,
              schema: G17_QUALIFICATION_SAMPLE_SCHEMA,
              caseId: task.id,
              phase,
              block,
              pair: Math.floor(slot / 2),
              slot,
              repetition: globalBlock * schedule.length + slot,
              seed:
                protocol.seed +
                caseIndex * 100_000 +
                globalBlock * 2 +
                Math.floor(slot / 2),
              implementation,
            });
          }
        }
      }
    }
    if (samples.length !== expected.length) {
      fail("sample inventory length drifted");
    }
    const executableDigests = new Map();
    for (const [index, row] of samples.entries()) {
      validateRow(
        row,
        expected[index],
        expected[index].task,
        executableDigests,
      );
    }
    if (executableDigests.size !== 2) {
      fail("both implementation executables are required");
    }

    const expectedPairs = protocol.measuredBlocks * 2;
    if (expectedPairs !== 10) {
      fail("v4 requires exactly ten measured pairs per case");
    }
    const cases = tasks.map((task, caseIndex) => {
      const measured = samples.filter(
        (row) => row.caseId === task.id && row.phase === "measured",
      );
      const subjectRows = measured.filter(
        ({ implementation }) => implementation === "subject",
      );
      const referenceRows = measured.filter(
        ({ implementation }) => implementation === "reference",
      );
      if (
        subjectRows.length !== expectedPairs ||
        referenceRows.length !== expectedPairs
      ) {
        fail(`measured sample inventory drifted for ${task.id}`);
      }
      const subject = statistics(subjectRows);
      const reference = statistics(referenceRows);
      const maximumMadBasisPoints = noiseCases.get(task.id);
      const subjectNoisePass = noisePass(subject, maximumMadBasisPoints);
      const referenceNoisePass = noisePass(reference, maximumMadBasisPoints);
      const noisy = !subjectNoisePass || !referenceNoisePass;
      const noise = Object.freeze({
        status: noisy ? "NOISY" : "PASS",
        maximumMadBasisPoints,
        subjectPass: subjectNoisePass,
        referencePass: referenceNoisePass,
      });
      const pairs = pairedRows(measured, task, expectedPairs);
      const nonInferiority = pairedNonInferiority({
        pairs,
        maximumSlowdownBasisPoints: performanceCases.get(task.id),
        bootstrap,
        seed: bootstrap.baseSeed + caseIndex,
        noisy,
      });
      return Object.freeze({
        caseId: task.id,
        subject,
        reference,
        noise,
        nonInferiority,
      });
    });

    const diagnosticBudgetBreaches = cases
      .filter(({ nonInferiority }) => nonInferiority.status === "FAIL")
      .map(({ caseId }) => caseId);
    const noisyCases = cases
      .filter(({ noise }) => noise.status === "NOISY")
      .map(({ caseId }) => caseId);
    const statisticalStatus =
      diagnosticBudgetBreaches.length > 0
        ? "FAIL"
        : noisyCases.length > 0
          ? "NOISY"
          : "PASS";
    const status = decisionSet.approved ? statisticalStatus : "INCONCLUSIVE";
    const budgetBreaches = decisionSet.approved ? diagnosticBudgetBreaches : [];
    return Object.freeze({
      owner: "@metaharness/darwin",
      statisticsApi: "security.bootstrapDelta",
      darwin,
      suiteHash: contract.benchmark.suite.taskHash,
      decisionSetSha256: decisionSet.decisionSetSha256,
      authority: decisionSet.authority,
      sampleCount: samples.length,
      measuredSampleCount: tasks.length * protocol.measuredBlocks * 4,
      executableDigests: Object.freeze(Object.fromEntries(executableDigests)),
      status,
      statisticalStatus,
      budgetBreaches: Object.freeze(budgetBreaches),
      diagnosticBudgetBreaches: Object.freeze(diagnosticBudgetBreaches),
      noisyCases: Object.freeze(noisyCases),
      cases: Object.freeze(cases),
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 benchmark:")) throw error;
    fail(error.message);
  }
}
