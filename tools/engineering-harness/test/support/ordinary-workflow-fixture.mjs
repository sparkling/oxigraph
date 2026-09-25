import { createHash } from "node:crypto";
import { join } from "node:path";
import { admitCommand } from "../../src/delivery.mjs";
import { digest } from "../../src/workflow.mjs";

export const ordinaryWorkflowPath = "tools/engineering-harness/src/workflow-host.mjs";
export const ordinaryWorkflowSpec = {
  schema: 1,
  taskId: "task-workflow-test",
  scope: "harness",
  goal: "Implement the declared harness change",
  completionCheck: "Exact source passes independent review and native assertions",
  paths: [ordinaryWorkflowPath],
  checks: [{
    completionCheck: "Focused tests pass",
    argv: ["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/workflow.test.mjs"],
  }],
};

const sha = (value) => createHash("sha256").update(value).digest("hex");

function fixture(options = {}) {
  let content = "before";
  let outside = "unchanged";
  let checks = 0;
  let implementations = 0;
  let reviews = 0;
  const actions = [];
  const feedback = [];
  const evidence = new Map();
  let eventId = 0;
  const observe = () => ({ head: "a".repeat(40), branch: "main", trackedDiffSha256: digest(content), untracked: [] });
  const putEvidence = (evidencePath, value, tampered = false) => {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    evidence.set(evidencePath, { bytes, value });
    return { path: evidencePath, sha256: tampered ? "0".repeat(64) : sha(bytes) };
  };
  const io = {
    observe,
    outside: () => outside,
    files: () => [{ path: ordinaryWorkflowPath, sha256: options.sha ? options.sha(content) : null, content }],
    event: (event) => options.missingEventEvidence ? undefined :
      putEvidence(`/evidence/event-${++eventId}.json`, event, options.tamperedEventEvidence),
    checkReference: (run) => {
      const { directory, ...record } = run;
      return options.missingCheckEvidence ? undefined :
        putEvidence(join(directory, "result.json"), record, options.tamperedCheckEvidence);
    },
    verifyReference: (reference, expected) => {
      const stored = evidence.get(reference?.path);
      return stored !== undefined && sha(stored.bytes) === reference.sha256 &&
        (expected === undefined || digest(stored.value) === digest(expected));
    },
    execute: async (check) => {
      checks++;
      const source = observe();
      const failed = options.failChecks === true || checks <= (options.failChecks ?? 0);
      const run = {
        directory: `/evidence/check-${checks}`,
        taskId: ordinaryWorkflowSpec.taskId,
        source,
        sourceAfter: source,
        sourceStable: true,
        command: admitCommand(check.argv),
        plan: { completionCheck: check.completionCheck },
        status: failed ? "failed" : "command-passed",
        result: { passed: !failed, code: failed ? 1 : 0, durationMs: checks * 10 },
        failure: failed ? "real check failure" : null,
      };
      if (options.checkDrift) content += "drift";
      if (options.staleCheck) run.source = { wrong: true };
      return run;
    },
  };
  const host = async (request) => {
    actions.push(request.action);
    let result;
    if (request.action === "mcp-read") {
      result = { task: { taskId: ordinaryWorkflowSpec.taskId, status: "in_progress" }, control: {
        activeHarnessTaskId: ordinaryWorkflowSpec.taskId,
        activeDeliveryTaskId: ordinaryWorkflowSpec.taskId,
        ownerReviewHold: { active: options.hold ?? true },
      } };
      if (options.missingTask) result.task = null;
    } else if (request.action === "native-worker") {
      const { route } = request.payload;
      const review = route.role === "review";
      if (review) reviews++;
      else {
        implementations++;
        feedback.push(request.payload.feedback);
      }
      result = {
        client: "test-double",
        workerId: review && !options.sameWorker ? `review-${reviews}` : "implementation",
        model: route.model,
        effort: route.effort,
        status: "completed",
        summary: "fixture result",
        verdict: "ACCEPT",
        findings: [],
        changes: [],
      };
      if (!review) result.changes = options.noChanges ? [] : [{
        path: ordinaryWorkflowPath,
        content: options.stalled ? "after" : `after-${implementations}`,
      }];
      if (!review && options.badPath) result.changes[0].path = options.badPath;
      if (review && reviews <= (options.rejectReviews ?? 0)) {
        result.verdict = "REJECT";
        result.findings = ["Fix the exact review finding"];
      }
      if (review && options.reviewWrites) content += "unexpected review edit";
      if (options.unavailable) result = {
        client: "Claude native collaboration",
        model: route.model,
        effort: route.effort,
        status: "unavailable",
        error: "fixture: requested model unavailable",
      };
      if (options.proposalDrift) content += "concurrent edit";
    } else if (request.action === "root-apply") {
      content = request.payload.changes[0].content;
      if (options.outsideWrite) outside = "changed";
      result = { writer: options.wrongWriter ? "worker" : "root", applied: true };
    } else if (request.action === "mcp-handoff") {
      result = { value: options.badReadback ? { stale: true } : request.payload.evidence };
    } else {
      throw new Error(`unexpected fixture action ${request.action}`);
    }
    const { action, payload, ...identity } = request;
    return { ...identity, ...(options.crossTask ? { taskId: "task-other" } : {}), result };
  };
  return { io, host, actions, feedback, counters: () => ({ checks, implementations, reviews }) };
}

export function setupOrdinaryWorkflowFixture(options = {}) {
  return fixture({ sha, ...options });
}

export const updateNativeResults = (fixtureState, update) => async (request) => {
  const response = await fixtureState.host(request);
  if (request.action === "native-worker") update(response.result, request, fixtureState.counters());
  return response;
};
