import { G17_BENCHMARK_CASE_IDS } from "./benchmark-contract.mjs";

const EVIDENCE_STATES = new Set([
  "PASS",
  "FAIL",
  "MISSING",
  "STALE",
  "NOISY",
  "NOT_RUN",
  "INCONCLUSIVE",
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

export function classifyG17Qualification(
  {
    semantic,
    compatibility,
    benchmark,
    referenceDecision,
    budgetDecision,
    noiseDecision,
  },
  { currentV4 = true } = {},
) {
  const semanticStatus = status(semantic, "semantic");
  const compatibilityStatus = status(compatibility, "compatibility");
  const benchmarkStatus = status(benchmark, "benchmark");
  const referenceStatus = decision(
    referenceDecision,
    "reference",
    currentV4
      ? ["SELECTED", "UNSELECTED", "PROPOSED"]
      : ["SELECTED", "UNSELECTED"],
  );
  const budgetDecisionStates = currentV4
    ? ["APPROVED", "ABSENT", "PROPOSED"]
    : ["APPROVED", "ABSENT"];
  const budgetStatus = decision(
    budgetDecision,
    "performance budget",
    budgetDecisionStates,
  );
  const noiseStatus = decision(
    noiseDecision,
    "noise budget",
    budgetDecisionStates,
  );
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
  const observedIndexes = currentV4
    ? benchmark.budgetBreaches.map((caseId) =>
        G17_BENCHMARK_CASE_IDS.indexOf(caseId),
      )
    : [];
  if (
    currentV4 &&
    (observedIndexes.some((index) => index < 0) ||
      new Set(benchmark.budgetBreaches).size !==
        benchmark.budgetBreaches.length ||
      observedIndexes.some(
        (index, position) =>
          position > 0 && index <= observedIndexes[position - 1],
      ))
  ) {
    throw new Error(
      "benchmark budgetBreaches must be known, unique, and in suite order",
    );
  }
  if (
    (currentV4 ? benchmarkStatus !== "FAIL" : benchmarkStatus === "PASS") &&
    benchmark.budgetBreaches.length > 0
  ) {
    throw new Error(
      `${benchmarkStatus} benchmark cannot report performance budget breaches`,
    );
  }

  const rejectionReasons = [];
  if (semanticStatus === "FAIL") rejectionReasons.push("semantic-failed");
  if (compatibilityStatus === "FAIL")
    rejectionReasons.push("compatibility-failed");
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
  if (referenceStatus !== "SELECTED") {
    inconclusiveReasons.push(
      referenceStatus === "PROPOSED"
        ? "reference-proposed"
        : "reference-unselected",
    );
  }
  if (budgetStatus !== "APPROVED") {
    inconclusiveReasons.push(
      budgetStatus === "PROPOSED"
        ? "performance-budget-proposed"
        : "performance-budget-absent",
    );
  }
  if (noiseStatus !== "APPROVED") {
    inconclusiveReasons.push(
      noiseStatus === "PROPOSED"
        ? "noise-budget-proposed"
        : "noise-budget-absent",
    );
  }
  for (const [label, observed] of [
    ["semantic", semanticStatus],
    ["compatibility", compatibilityStatus],
    ["benchmark", benchmarkStatus],
  ]) {
    if (observed !== "PASS")
      inconclusiveReasons.push(reasonFor(label, observed));
  }
  if (inconclusiveReasons.length > 0) {
    return Object.freeze({
      verdict: "INCONCLUSIVE",
      reasons: inconclusiveReasons,
    });
  }
  return Object.freeze({ verdict: "ACCEPT", reasons: [] });
}
