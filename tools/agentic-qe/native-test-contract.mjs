const cargoTestSummary =
  /^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out; finished in (?:\d+(?:\.\d+)?|\.\d+)s$/u;

export function parseCargoTestSummaries(output) {
  const summaries = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = cargoTestSummary.exec(line);
    if (match === null) continue;
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
  return output
    .split(/\r?\n/u)
    .map((line) => /^(\S(?:.*\S)?): test$/u.exec(line)?.[1])
    .filter((name) => name !== undefined)
    .sort();
}

export function validateCargoTestIds(id, ids, policy) {
  if (ids.length !== policy.expectedPassedTests) {
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
