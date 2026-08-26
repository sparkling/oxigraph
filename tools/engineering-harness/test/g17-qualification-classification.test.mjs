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

test("G1.7 accepts only complete selected, approved, passing evidence", () => {
  assert.deepEqual(classifyG17Qualification(passing()), {
    verdict: "ACCEPT",
    reasons: [],
  });
});

test("semantic or compatibility failure rejects even when approvals are absent", () => {
  for (const key of ["semantic", "compatibility"]) {
    const input = passing({
      [key]: { status: "FAIL" },
      referenceDecision: { status: "UNSELECTED" },
      budgetDecision: { status: "ABSENT" },
      noiseDecision: { status: "ABSENT" },
    });
    const result = classifyG17Qualification(input);
    assert.equal(result.verdict, "REJECT");
    assert.ok(result.reasons.includes(`${key}-failed`));
  }
});

test("an approved-budget breach rejects", () => {
  assert.deepEqual(
    classifyG17Qualification(
      passing({ benchmark: { status: "PASS", budgetBreaches: ["writers-16-rocksdb"] } }),
    ),
    {
      verdict: "REJECT",
      reasons: ["performance-budget-breached:writers-16-rocksdb"],
    },
  );
});

test("unselected reference, absent approvals, stale evidence, and noise are inconclusive", () => {
  for (const [overrides, reason] of [
    [{ referenceDecision: { status: "UNSELECTED" } }, "reference-unselected"],
    [{ budgetDecision: { status: "ABSENT" } }, "performance-budget-absent"],
    [{ noiseDecision: { status: "ABSENT" } }, "noise-budget-absent"],
    [{ semantic: { status: "STALE" } }, "semantic-stale"],
    [{ compatibility: { status: "MISSING" } }, "compatibility-missing"],
    [{ benchmark: { status: "NOISY", budgetBreaches: [] } }, "benchmark-noisy"],
  ]) {
    const result = classifyG17Qualification(passing(overrides));
    assert.equal(result.verdict, "INCONCLUSIVE");
    assert.ok(result.reasons.includes(reason));
  }
});

test("unknown states and malformed breach inventories fail closed", () => {
  assert.throws(
    () => classifyG17Qualification(passing({ semantic: { status: "MAYBE" } })),
    /semantic status/u,
  );
  assert.throws(
    () => classifyG17Qualification(passing({ benchmark: { status: "PASS" } })),
    /budgetBreaches/u,
  );
});
