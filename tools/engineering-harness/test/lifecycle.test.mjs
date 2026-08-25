import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateProviderPlans,
  candidateSha256,
  chooseVerifiedCandidate,
  qualityOutcome,
  reviewProviderPlan,
  routeRoles,
  upstreamRoleOutputs,
} from "../src/runtime/lifecycle.mjs";

const paired = Object.freeze({ mode: "paired", providers: ["codex", "claude"] });
const routed = (provider) =>
  Object.freeze({ mode: "routed", provider, predictedQuality: 0.75 });

test("candidate routing uses two homogeneous cold-start pipelines", async () => {
  const calls = [];
  const router = {
    async route(context) {
      calls.push(context.role);
      return paired;
    },
  };
  const decisions = await routeRoles(router, { taskId: "g1.2" });
  assert.deepEqual(calls, ["architecture", "critique", "implementation"]);
  assert.deepEqual(
    candidateProviderPlans(decisions).map(({ providersByRole }) => providersByRole),
    [
      { architecture: "codex", critique: "codex", implementation: "codex" },
      { architecture: "claude", critique: "claude", implementation: "claude" },
    ],
  );
});

test("routed candidate roles may select a mixed native pipeline but never mixed calibration state", () => {
  const routedPlans = candidateProviderPlans({
    architecture: routed("codex"),
    critique: routed("claude"),
    implementation: routed("codex"),
  });
  assert.deepEqual(routedPlans[0].providersByRole, {
    architecture: "codex",
    critique: "claude",
    implementation: "codex",
  });
  assert.throws(
    () =>
      candidateProviderPlans({
        architecture: paired,
        critique: routed("claude"),
        implementation: paired,
      }),
    /diverged/,
  );
});

test("upstream outputs and sealed candidate identity fail closed", () => {
  const output = (role) => ({ summary: role, patch: null, findings: [], verdict: "ACCEPT" });
  const run = {
    success: true,
    steps: ["architecture", "critique", "implementation"].map((role) => ({
      step: { kind: role },
      verdict: { pass: true },
      output: { output: output(role) },
    })),
  };
  assert.deepEqual(
    Object.keys(upstreamRoleOutputs(run, ["architecture", "critique", "implementation"])),
    ["architecture", "critique", "implementation"],
  );
  const digest = candidateSha256({
    candidateTree: "a".repeat(40),
    candidatePatchSha256: "b".repeat(64),
    protectedManifest: { entries: 1, sha256: "c".repeat(64) },
  });
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.throws(() => candidateSha256({ candidateTree: "bad" }), /not sealed/);
});

test("candidate choice and review retain deterministic native and cross-vendor rules", () => {
  const attempts = [
    {
      verifier: { verdict: "ACCEPT" },
      candidateSha256: "a".repeat(64),
      repairCycles: 0,
      measuredCostUsd: 0,
      providersByRole: { implementation: "claude" },
    },
    {
      verifier: { verdict: "ACCEPT" },
      candidateSha256: "b".repeat(64),
      repairCycles: 0,
      measuredCostUsd: 0,
      providersByRole: { implementation: "codex" },
    },
    {
      verifier: { verdict: "ACCEPT" },
      candidateSha256: "c".repeat(64),
      repairCycles: 1,
      measuredCostUsd: 0,
      candidateProvider: "codex",
      providersByRole: { implementation: "claude", repair: "codex" },
    },
  ];
  assert.equal(chooseVerifiedCandidate(attempts).candidateSha256, "b".repeat(64));
  assert.deepEqual(reviewProviderPlan(routed("codex"), "codex"), {
    providers: ["codex", "claude"],
    forcedCrossVendor: true,
  });
  assert.deepEqual(reviewProviderPlan(routed("claude"), "codex"), {
    providers: ["claude"],
    forcedCrossVendor: false,
  });
});

test("quality outcome binds exact application identity and pair semantics", () => {
  const outcome = qualityOutcome({
    taskId: "run-1",
    taskClass: "transaction-concurrency",
    role: "implementation",
    provider: "codex",
    candidateSha256: "a".repeat(64),
    contractSha256: "b".repeat(64),
    evaluatorSha256: "c".repeat(64),
    harnessSha256: "d".repeat(64),
    models: { codex: "codex-model", claude: "claude-model" },
    decision: paired,
    quality: 1,
  });
  assert.equal(outcome.pairId, "run-1:implementation");
  assert.equal(outcome.model, "codex-model");
  assert.equal(Object.hasOwn(outcome, "predictedQuality"), false);
});
