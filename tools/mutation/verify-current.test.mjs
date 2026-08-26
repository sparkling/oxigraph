import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedCurrentQualification } from "./verify-current.mjs";

function binding(runId = "00000000-0000-4000-8000-000000000000") {
  const hash = "a".repeat(64);
  return {
    valid: true,
    error: null,
    path: `target/mutation/oxdatalog/runs/${runId}/receipt.json`,
    sha256: hash,
    schemaVersion: 3,
    runId,
    contentHash: hash,
    executionHash: hash,
    inputContentHash: hash,
    publicationContentHash: hash,
    nativeOutcomesSha256: hash,
    configSha256: hash,
    counts: {
      generated: 1,
      caught: 1,
      missed: 0,
      timeout: 0,
      unviable: 0,
      viable: 1,
    },
    mutationScorePercent: 100,
  };
}

test("fresh-process verifier accepts only the expected current run", () => {
  const expectedRunId = "00000000-0000-4000-8000-000000000000";
  assert.deepEqual(
    assertExpectedCurrentQualification(binding(expectedRunId), expectedRunId),
    binding(expectedRunId),
  );
  assert.throws(
    () =>
      assertExpectedCurrentQualification(
        binding("00000000-0000-4000-8000-000000000001"),
        expectedRunId,
      ),
    /does not identify the expected run/,
  );
  assert.throws(
    () =>
      assertExpectedCurrentQualification(
        { valid: false, error: "stale source" },
        expectedRunId,
      ),
    /stale source/,
  );
});
