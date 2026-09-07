export const ASTRA_MODEL = "gpt-6-astra";

export const ASTRA_REASONING_EFFORTS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

export const ASTRA_ROUTING_POLICY = "oxigraph.astra-routing/v1";

const WORK_CLASS_EFFORT = Object.freeze({
  triage: "low",
  "bounded-change": "medium",
  "consequential-change": "high",
  "hard-tail": "xhigh",
});

export function validateAstraReasoningEffort(model, effort) {
  if (model !== ASTRA_MODEL) {
    if (effort === undefined || effort === null) return null;
    throw new Error("explicit Astra reasoning effort requires gpt-6-astra");
  }
  if (effort === undefined || effort === null) {
    throw new Error("gpt-6-astra requires an explicit reasoning effort");
  }
  if (!ASTRA_REASONING_EFFORTS.includes(effort)) {
    throw new Error("Astra reasoning effort must be low, medium, high, xhigh, max, or ultra");
  }
  return effort;
}

export function selectAstraReasoningEffort({
  workClass = "consequential-change",
  priorEffort = null,
  discriminatingEvaluator = false,
} = {}) {
  if (workClass === "max-escalation") {
    if (priorEffort !== "xhigh" || discriminatingEvaluator !== true) {
      throw new Error(
        "max effort requires an unresolved xhigh attempt and a discriminating evaluator",
      );
    }
    return Object.freeze({
      policy: ASTRA_ROUTING_POLICY,
      model: ASTRA_MODEL,
      effort: "max",
    });
  }
  const effort = WORK_CLASS_EFFORT[workClass];
  if (effort === undefined) {
    throw new Error(`unsupported Astra work class: ${workClass}`);
  }
  return Object.freeze({
    policy: ASTRA_ROUTING_POLICY,
    model: ASTRA_MODEL,
    effort,
  });
}

export function astraWorkerPromptGuidance(model) {
  if (model !== ASTRA_MODEL) return Object.freeze([]);
  return Object.freeze([
    "Use the task contract to resolve routine gaps and continue without asking questions.",
    "Return INCONCLUSIVE only when required evidence or authority is genuinely absent.",
    "Keep the structured response concise and limit validation advice to checks required by the task or justified by a concrete failure.",
  ]);
}
