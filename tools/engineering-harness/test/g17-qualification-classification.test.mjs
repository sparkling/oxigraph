import assert from "node:assert/strict";
import test from "node:test";

import { classifyG17Qualification } from "../src/qualification/classification.mjs";

function passing(overrides = {}) {
  return {
    semantic: { status: "PASS" },
    compatibility: { status: "PASS" },
    benchmark: { status: "PASS", budgetBreaches: [] },
    referenceDecision: { status: "SELECTED" },
    budgetDecision: { status: "APPROVED" },
    noiseDecision: { status: "APPROVED" },
    ...overrides,
  };
}

test("G1.7 accepts only selected, approved, passing evidence", () => {
  assert.deepEqual(classifyG17Qualification(passing()), {
    verdict: "ACCEPT",
    reasons: [],
  });
});

test("semantic, compatibility, or benchmark failure rejects", () => {
  for (const key of ["semantic", "compatibility", "benchmark"]) {
    const input = passing({
      [key]:
        key === "benchmark"
          ? { status: "FAIL", budgetBreaches: [] }
          : { status: "FAIL" },
      referenceDecision: { status: "PROPOSED" },
      budgetDecision: { status: "PROPOSED" },
      noiseDecision: { status: "PROPOSED" },
    });
    const result = classifyG17Qualification(input);
    assert.equal(result.verdict, "REJECT");
    assert.ok(result.reasons.includes(`${key}-failed`));
  }
});

test("a quiet performance breach is ordered and rejects", () => {
  assert.deepEqual(
    classifyG17Qualification(
      passing({
        benchmark: {
          status: "FAIL",
          budgetBreaches: ["writers-16-rocksdb"],
        },
      }),
    ),
    {
      verdict: "REJECT",
      reasons: [
        "benchmark-failed",
        "performance-budget-breached:writers-16-rocksdb",
      ],
    },
  );
});

test("proposed decisions and noise remain inconclusive", () => {
  const proposed = classifyG17Qualification(
    passing({
      benchmark: { status: "NOISY", budgetBreaches: [] },
      referenceDecision: { status: "PROPOSED" },
      budgetDecision: { status: "PROPOSED" },
      noiseDecision: { status: "PROPOSED" },
    }),
  );
  assert.deepEqual(proposed, {
    verdict: "INCONCLUSIVE",
    reasons: [
      "reference-proposed",
      "performance-budget-proposed",
      "noise-budget-proposed",
      "benchmark-noisy",
    ],
  });
});

test("diagnostic-only benchmark output remains explicitly inconclusive", () => {
  assert.deepEqual(
    classifyG17Qualification(
      passing({
        benchmark: { status: "INCONCLUSIVE", budgetBreaches: [] },
        referenceDecision: { status: "PROPOSED" },
        budgetDecision: { status: "PROPOSED" },
        noiseDecision: { status: "PROPOSED" },
      }),
    ),
    {
      verdict: "INCONCLUSIVE",
      reasons: [
        "reference-proposed",
        "performance-budget-proposed",
        "noise-budget-proposed",
        "benchmark-inconclusive",
      ],
    },
  );
});

test("unselected, absent, stale, and missing states remain inconclusive", () => {
  for (const [overrides, reason] of [
    [{ referenceDecision: { status: "UNSELECTED" } }, "reference-unselected"],
    [{ budgetDecision: { status: "ABSENT" } }, "performance-budget-absent"],
    [{ noiseDecision: { status: "ABSENT" } }, "noise-budget-absent"],
    [{ semantic: { status: "STALE" } }, "semantic-stale"],
    [{ compatibility: { status: "MISSING" } }, "compatibility-missing"],
  ]) {
    const result = classifyG17Qualification(passing(overrides));
    assert.equal(result.verdict, "INCONCLUSIVE");
    assert.ok(result.reasons.includes(reason));
  }
});

test("unknown, duplicate, unsorted, and status-incompatible breaches fail closed", () => {
  assert.throws(
    () => classifyG17Qualification(passing({ semantic: { status: "MAYBE" } })),
    /semantic status/u,
  );
  assert.throws(
    () => classifyG17Qualification(passing({ benchmark: { status: "PASS" } })),
    /budgetBreaches/u,
  );
  for (const budgetBreaches of [
    ["unknown-case"],
    ["on-store-memory", "on-store-memory"],
    ["writers-1-rocksdb", "on-store-memory"],
  ]) {
    assert.throws(
      () =>
        classifyG17Qualification(
          passing({ benchmark: { status: "FAIL", budgetBreaches } }),
        ),
      /known, unique, and in suite order/u,
    );
  }
  for (const status of [
    "PASS",
    "NOISY",
    "MISSING",
    "STALE",
    "NOT_RUN",
    "INCONCLUSIVE",
  ]) {
    assert.throws(
      () =>
        classifyG17Qualification(
          passing({
            benchmark: {
              status,
              budgetBreaches: ["writers-16-rocksdb"],
            },
          }),
        ),
      new RegExp(`${status} benchmark cannot report`, "u"),
    );
  }
});

test("legacy classification preserves arbitrary ordered breach replay", () => {
  assert.deepEqual(
    classifyG17Qualification(
      passing({
        benchmark: {
          status: "NOISY",
          budgetBreaches: ["legacy-z", "legacy-z", "legacy-a"],
        },
      }),
      { currentV4: false },
    ),
    {
      verdict: "REJECT",
      reasons: [
        "performance-budget-breached:legacy-z",
        "performance-budget-breached:legacy-z",
        "performance-budget-breached:legacy-a",
      ],
    },
  );
});
