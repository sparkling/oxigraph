import { isDeepStrictEqual } from "node:util";

import { bench } from "@metaharness/darwin";

const DIGEST = /^[0-9a-f]{64}$/u;
const SAMPLE_SCHEMA = "oxigraph.g1.7-qualification-sample/v1";
const SAMPLE_KEYS = Object.freeze([
  "schema",
  "caseId",
  "phase",
  "block",
  "slot",
  "repetition",
  "seed",
  "implementation",
  "elapsedNs",
  "operations",
  "bytes",
  "readerObservations",
  "executableSha256",
]);

function fail(message) {
  throw new Error(`G1.7 benchmark: ${message}`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive integer`);
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.floor((sorted[middle - 1] + sorted[middle]) / 2);
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
    medianAbsoluteDeviationNs: median(elapsed.map((value) => Math.abs(value - center))),
  });
}

export function verifyG17BenchmarkSuite(contract) {
  const suite = contract?.benchmark?.suite;
  if (!suite || !Array.isArray(suite.tasks)) fail("Darwin benchmark suite is missing");
  const verification = bench.verifySuite(suite);
  if (!verification.ok || verification.actual !== bench.hashTasks(suite.tasks)) {
    fail("Darwin benchmark suite hash does not verify");
  }
  return Object.freeze(verification);
}

function validateRow(row, expected, task, executableDigests) {
  if (
    row === null ||
    typeof row !== "object" ||
    Array.isArray(row) ||
    !isDeepStrictEqual(Object.keys(row), SAMPLE_KEYS)
  ) {
    fail("sample fields are not exact or ordered");
  }
  for (const key of [
    "schema",
    "caseId",
    "phase",
    "block",
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
  if (row.operations !== expectedOperations) fail("sample operation count drifted");
  if (task.concurrentReaders !== (row.readerObservations > 0)) {
    fail("sample concurrent-reader observation drifted");
  }
  if (!DIGEST.test(row.executableSha256)) fail("sample executable digest is malformed");
  const prior = executableDigests.get(row.implementation);
  if (prior !== undefined && prior !== row.executableSha256) {
    fail("implementation executable digest changed within the run");
  }
  executableDigests.set(row.implementation, row.executableSha256);
}

export function summarizeG17Samples(samples, contract) {
  try {
    verifyG17BenchmarkSuite(contract);
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
      !Number.isSafeInteger(statisticsContract?.bootstrapSamples) ||
      statisticsContract.bootstrapSamples < 1 ||
      !Number.isSafeInteger(statisticsContract?.bootstrapSeed)
    ) {
      fail("protocol or statistics are invalid");
    }

    const expected = [];
    for (const [caseIndex, task] of contract.benchmark.suite.tasks.entries()) {
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
              schema: SAMPLE_SCHEMA,
              caseId: task.id,
              phase,
              block,
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
    if (samples.length !== expected.length) fail("sample inventory length drifted");
    const executableDigests = new Map();
    for (const [index, row] of samples.entries()) {
      validateRow(row, expected[index], expected[index].task, executableDigests);
    }
    if (executableDigests.size !== 2) fail("both implementation executables are required");

    const cases = contract.benchmark.suite.tasks.map((task) => {
      const measured = samples.filter(
        (row) => row.caseId === task.id && row.phase === "measured",
      );
      const subjectRows = measured.filter(({ implementation }) => implementation === "subject");
      const referenceRows = measured.filter(
        ({ implementation }) => implementation === "reference",
      );
      const expectedPerImplementation = 2 * protocol.measuredBlocks;
      if (
        subjectRows.length !== expectedPerImplementation ||
        referenceRows.length !== expectedPerImplementation
      ) {
        fail(`measured sample inventory drifted for ${task.id}`);
      }
      const referenceScores = referenceRows.map(({ elapsedNs }) => -elapsedNs);
      const subjectScores = subjectRows.map(({ elapsedNs }) => -elapsedNs);
      return Object.freeze({
        caseId: task.id,
        subject: statistics(subjectRows),
        reference: statistics(referenceRows),
        bootstrap: Object.freeze(
          bench.bootstrapDelta(referenceScores, subjectScores, {
            samples: statisticsContract.bootstrapSamples,
            seed: statisticsContract.bootstrapSeed,
            minDelta: 0,
          }),
        ),
      });
    });
    return Object.freeze({
      owner: "@metaharness/darwin",
      suiteHash: contract.benchmark.suite.taskHash,
      sampleCount: samples.length,
      executableDigests: Object.freeze(Object.fromEntries(executableDigests)),
      cases: Object.freeze(cases),
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 benchmark:")) throw error;
    fail(error.message);
  }
}
