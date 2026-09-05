import assert from "node:assert/strict";
import test from "node:test";

import {
  ASTRA_MODEL,
  ASTRA_REASONING_EFFORTS,
  ASTRA_ROUTING_POLICY,
  astraWorkerPromptGuidance,
  selectAstraReasoningEffort,
  validateAstraReasoningEffort,
} from "../src/policy/astra-routing.mjs";

test("Astra routing exposes the five native effort levels and deterministic work classes", () => {
  assert.equal(ASTRA_MODEL, "gpt-6-astra");
  assert.equal(ASTRA_ROUTING_POLICY, "oxigraph.astra-routing/v1");
  assert.deepEqual(ASTRA_REASONING_EFFORTS, [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.deepEqual(
    Object.fromEntries(
      ["triage", "bounded-change", "consequential-change", "hard-tail"].map(
        (workClass) => [workClass, selectAstraReasoningEffort({ workClass }).effort],
      ),
    ),
    {
      triage: "low",
      "bounded-change": "medium",
      "consequential-change": "high",
      "hard-tail": "xhigh",
    },
  );
});

test("max effort is a bounded escalation after unresolved xhigh evidence", () => {
  assert.equal(
    selectAstraReasoningEffort({
      workClass: "max-escalation",
      priorEffort: "xhigh",
      discriminatingEvaluator: true,
    }).effort,
    "max",
  );
  for (const input of [
    { workClass: "max-escalation", priorEffort: "high", discriminatingEvaluator: true },
    { workClass: "max-escalation", priorEffort: "xhigh", discriminatingEvaluator: false },
    { workClass: "unknown" },
  ]) {
    assert.throws(() => selectAstraReasoningEffort(input), /requires|unsupported/u);
  }
});

test("Astra selections require an explicit supported effort while legacy models remain unchanged", () => {
  for (const effort of ASTRA_REASONING_EFFORTS) {
    assert.equal(validateAstraReasoningEffort(ASTRA_MODEL, effort), effort);
  }
  assert.equal(validateAstraReasoningEffort("gpt-5.6-sol", null), null);
  assert.throws(
    () => validateAstraReasoningEffort(ASTRA_MODEL, null),
    /explicit reasoning effort/u,
  );
  for (const effort of ["none", "minimal", "extreme", ""] ) {
    assert.throws(
      () => validateAstraReasoningEffort(ASTRA_MODEL, effort),
      /must be low, medium, high, xhigh, or max/u,
    );
  }
  assert.throws(
    () => validateAstraReasoningEffort("gpt-5.6-sol", "high"),
    /requires gpt-6-astra/u,
  );
});

test("Astra worker guidance is additive and leaves legacy prompts unchanged", () => {
  assert.deepEqual(astraWorkerPromptGuidance("gpt-5.6-sol"), []);
  const guidance = astraWorkerPromptGuidance(ASTRA_MODEL);
  assert.equal(guidance.length, 3);
  assert.match(guidance.join("\n"), /continue without asking questions/u);
  assert.match(guidance.join("\n"), /structured response concise/u);
});
