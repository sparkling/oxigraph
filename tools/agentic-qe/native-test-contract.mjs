import {
  assertBoundedObservationCount,
  boundedTestOutputLines,
  lastNonemptyBoundedTestOutputLine,
} from "./bounded-lines.mjs";

export const MAX_CARGO_TEST_IDS = 16_384;
export const MAX_CARGO_TEST_ID_BYTES = 4_096;
export const MAX_CARGO_TEST_ID_TOTAL_BYTES = 4 * 1024 * 1024;
export const MAX_CARGO_SUMMARIES = 4_096;
export { lastNonemptyBoundedTestOutputLine };

const cargoTestSummary =
  /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out; finished in (?:\d+(?:\.\d+)?|\.\d+)s$/u;

export function parseCargoTestSummaries(output) {
  const summaries = [];
  for (const line of boundedTestOutputLines(output)) {
    const match = cargoTestSummary.exec(line);
    if (match === null) continue;
    assertBoundedObservationCount(
      summaries.length + 1,
      MAX_CARGO_SUMMARIES,
      "Cargo summaries",
    );
    summaries.push({
      status: match[1],
      passed: Number.parseInt(match[2], 10),
      failed: Number.parseInt(match[3], 10),
      ignored: Number.parseInt(match[4], 10),
      measured: Number.parseInt(match[5], 10),
      filteredOut: Number.parseInt(match[6], 10),
    });
  }
  return summaries;
}

export function countCargoPassedTests(output) {
  return parseCargoTestSummaries(output).reduce(
    (passed, summary) => passed + summary.passed,
    0,
  );
}

export function parseCargoTestIds(output) {
  const ids = [];
  let totalBytes = 0;
  for (const line of boundedTestOutputLines(output)) {
    const id = /^(\S(?:.*\S)?): test$/u.exec(line)?.[1];
    if (id === undefined) continue;
    const bytes = Buffer.byteLength(id, "utf8");
    totalBytes += bytes;
    if (
      bytes > MAX_CARGO_TEST_ID_BYTES ||
      totalBytes > MAX_CARGO_TEST_ID_TOTAL_BYTES
    ) {
      assertBoundedObservationCount(1, 0, "Cargo test ID bytes");
    }
    assertBoundedObservationCount(
      ids.length + 1,
      MAX_CARGO_TEST_IDS,
      "Cargo test IDs",
    );
    ids.push(id);
  }
  return ids.sort();
}

export function normalizeCargoTestObservation(summaries, terminal, source) {
  const canonical = summaries.map((summary) => ({
    stream: summary.stream,
    status: summary.status,
    passed: summary.passed,
    failed: summary.failed,
    ignored: summary.ignored,
    measured: summary.measured,
    filteredOut: summary.filteredOut,
  }));
  const totals = {
    passed: 0,
    failed: 0,
    ignored: 0,
    measured: 0,
    filteredOut: 0,
  };
  let countsSafe = true;
  for (const summary of canonical) {
    for (const field of Object.keys(totals)) {
      if (!Number.isSafeInteger(summary[field]) || summary[field] < 0) {
        countsSafe = false;
        continue;
      }
      const total = totals[field] + summary[field];
      if (!Number.isSafeInteger(total)) countsSafe = false;
      else totals[field] = total;
    }
  }
  const outcomeCount =
    totals.passed + totals.failed + totals.ignored + totals.measured;
  if (!Number.isSafeInteger(outcomeCount)) countsSafe = false;
  return {
    source,
    summaries: canonical,
    summaryCount: canonical.length,
    terminal,
    countsSafe,
    allSuccessful:
      canonical.length > 0 &&
      canonical.every(
        (summary) => summary.status === "ok" && summary.failed === 0,
      ),
    allOnStdout: canonical.every((summary) => summary.stream === "stdout"),
    outcomeCount: countsSafe ? outcomeCount : null,
    totals,
  };
}

export function validateCargoTestIds(id, ids, policy) {
  if (
    !Array.isArray(ids) ||
    ids.some((testId) => typeof testId !== "string" || testId.length === 0) ||
    new Set(ids).size !== ids.length ||
    ids.length !== policy.expectedPassedTests
  ) {
    const error = new Error(
      `${id}: Cargo selected ${ids.length} tests; expected ${policy.expectedPassedTests}`,
    );
    error.code = "CARGO_TEST_INVENTORY_MISMATCH";
    throw error;
  }
  if (policy.expectedTestIds !== undefined) {
    const expected = [...policy.expectedTestIds].sort();
    if (JSON.stringify(ids) !== JSON.stringify(expected)) {
      const error = new Error(
        `${id}: selected Cargo test IDs differ from the reviewed inventory`,
      );
      error.code = "CARGO_TEST_INVENTORY_MISMATCH";
      throw error;
    }
  }
  if (policy.requiredTestIds !== undefined) {
    const selected = new Set(ids);
    const missing = policy.requiredTestIds.filter(
      (testId) => !selected.has(testId),
    );
    if (missing.length > 0) {
      const error = new Error(
        `${id}: selected Cargo tests omit required sentinels: ${missing.join(", ")}`,
      );
      error.code = "CARGO_TEST_INVENTORY_MISMATCH";
      throw error;
    }
  }
}
