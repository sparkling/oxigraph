import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkerOutput } from "../src/policy/authority.mjs";

test("only implementation and repair workers may return bounded patches", () => {
  const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n";
  assert.equal(
    validateWorkerOutput(
      { summary: "candidate", patch, findings: [], verdict: "ACCEPT" },
      "implementation",
    ).patch,
    patch,
  );
  assert.throws(
    () =>
      validateWorkerOutput(
        { summary: "review", patch, findings: [], verdict: "REJECT" },
        "review",
      ),
    /may not propose/,
  );
  assert.throws(
    () =>
      validateWorkerOutput(
        { summary: "repair", patch: null, findings: [], verdict: "INCONCLUSIVE" },
        "repair",
      ),
    /must return/,
  );
});
