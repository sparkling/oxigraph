import { canonicalSha256 } from "./routing/features.mjs";
import { createOrdinaryRuntime } from "./ordinary-runtime.mjs";
import { runIsolatedWorkflow } from "./ordinary-workspace.mjs";
import { digest, validateWorkflow, verifyJsonReference } from "./workflow.mjs";
import { captureOrdinaryPolicy } from "./ordinary-policy.mjs";

/** Project evaluator uses the normal controller and its checked source/evidence, never a model score. */
export function ordinaryPolicyEvaluator({ definitions, hostForTask, runtimeConfig, workflowOptions = {},
  execute = runIsolatedWorkflow, verifyReference = verifyJsonReference }) {
  const specs = new Map(definitions.map((definition) => {
    const spec = validateWorkflow(definition);
    return [spec.taskId, spec];
  }));
  if (specs.size !== definitions.length) throw new Error("Policy evaluator task IDs must be unique");
  return async (policy, suite) => {
    const captured = captureOrdinaryPolicy(policy), policyDigest = canonicalSha256(captured);
    const receipts = [];
    for (const taskId of suite.items) {
      const spec = specs.get(taskId);
      if (!spec) throw new Error("Policy evaluator suite contains unknown task");
      const runtime = createOrdinaryRuntime(runtimeConfig, { policy: captured, learning: false });
      let result;
      try { result = await execute(spec, await hostForTask(taskId), { ...workflowOptions, runtime }); }
      catch (error) { if (!error.ordinaryEvaluation) throw error; result = error.ordinaryEvaluation; }
      if (result.taskId !== taskId || result.specSha256 !== digest(spec) || result.policyDigest !== policyDigest ||
          !["ready-for-owner-review", "authoring-rejected"].includes(result.status) ||
          !Array.isArray(result.checkReferences) || !result.checkReferences.length ||
          !Array.isArray(result.eventReferences) || !result.eventReferences.length ||
          [...result.checkReferences, ...result.eventReferences].some((reference) =>
            verifyReference(reference, undefined, result.candidateRoot ?? result.source?.root) !== true)) {
        throw new Error("Policy evaluation lacks exact task/policy/check evidence");
      }
      const passed = result.status === "ready-for-owner-review";
      if (passed && (result.review?.verdict !== "ACCEPT" ||
          result.checks.length !== spec.checks.length || result.checks.some((check) => check.status !== "command-passed"))) {
        throw new Error("Policy evaluation lacks complete deterministic and independent acceptance");
      }
      receipts.push({ taskId, runId: result.runId, policyDigest, definitionSha256: canonicalSha256(spec), specSha256: result.specSha256, passed,
        binding: result.runtimeBinding,
        resultDigest: canonicalSha256(result), checks: result.checkReferences, events: result.eventReferences });
    }
    return { policy: captured, suite: structuredClone(suite), receipts,
      score: { primary: receipts.filter((receipt) => receipt.passed).length / receipts.length,
        noopRate: 0, costPerWin: 0, regressed: false } };
  };
}
