const EVIDENCE_STATES = new Set([
  "PASS",
  "FAIL",
  "MISSING",
  "STALE",
  "NOISY",
  "NOT_RUN",
]);

function status(value, label) {
  const observed = value?.status;
  if (!EVIDENCE_STATES.has(observed)) {
    throw new Error(`${label} status is invalid`);
  }
  return observed;
}

function decision(value, label, allowed) {
  const observed = value?.status;
  if (!allowed.includes(observed)) {
    throw new Error(`${label} decision is invalid`);
  }
  return observed;
}

function reasonFor(label, observed) {
  return `${label}-${observed.toLowerCase().replace("_", "-")}`;
}

export function classifyG17Qualification({
  semantic,
  compatibility,
  benchmark,
  referenceDecision,
  budgetDecision,
  noiseDecision,
}) {
  const semanticStatus = status(semantic, "semantic");
  const compatibilityStatus = status(compatibility, "compatibility");
  const benchmarkStatus = status(benchmark, "benchmark");
  const referenceStatus = decision(referenceDecision, "reference", [
    "SELECTED",
    "UNSELECTED",
  ]);
  const budgetStatus = decision(budgetDecision, "performance budget", [
    "APPROVED",
    "ABSENT",
  ]);
  const noiseStatus = decision(noiseDecision, "noise budget", [
    "APPROVED",
    "ABSENT",
  ]);
  if (!Array.isArray(benchmark?.budgetBreaches)) {
    throw new Error("benchmark budgetBreaches must be an array");
  }
  if (
    benchmark.budgetBreaches.some(
      (value) => typeof value !== "string" || value.length === 0,
    )
  ) {
    throw new Error("benchmark budgetBreaches must contain non-empty case ids");
  }

  const rejectionReasons = [];
  if (semanticStatus === "FAIL") rejectionReasons.push("semantic-failed");
  if (compatibilityStatus === "FAIL") rejectionReasons.push("compatibility-failed");
  if (benchmarkStatus === "FAIL") rejectionReasons.push("benchmark-failed");
  if (budgetStatus === "APPROVED") {
    rejectionReasons.push(
      ...benchmark.budgetBreaches.map(
        (caseId) => `performance-budget-breached:${caseId}`,
      ),
    );
  }
  if (rejectionReasons.length > 0) {
    return Object.freeze({ verdict: "REJECT", reasons: rejectionReasons });
  }

  const inconclusiveReasons = [];
  if (referenceStatus === "UNSELECTED") {
    inconclusiveReasons.push("reference-unselected");
  }
  if (budgetStatus === "ABSENT") {
    inconclusiveReasons.push("performance-budget-absent");
  }
  if (noiseStatus === "ABSENT") {
    inconclusiveReasons.push("noise-budget-absent");
  }
  for (const [label, observed] of [
    ["semantic", semanticStatus],
    ["compatibility", compatibilityStatus],
    ["benchmark", benchmarkStatus],
  ]) {
    if (observed !== "PASS") inconclusiveReasons.push(reasonFor(label, observed));
  }
  if (inconclusiveReasons.length > 0) {
    return Object.freeze({
      verdict: "INCONCLUSIVE",
      reasons: inconclusiveReasons,
    });
  }
  return Object.freeze({ verdict: "ACCEPT", reasons: [] });
}
