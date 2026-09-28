import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runOrdinaryBatch } from "../src/ordinary-pool.mjs";
import { repository, sourceObservation } from "../src/delivery.mjs";
import { verifyJsonReference } from "../src/workflow.mjs";

test("upstream pool runs two isolated workflows with real checks and candidate-only edits", async () => {
  const before = sourceObservation();
  const paths = ["tools/engineering-harness/README.md", "tools/engineering-harness/src/workflow-host.mjs"];
  const canonical = paths.map((path) => readFileSync(join(repository, path), "utf8"));
  let entered = 0, release;
  const bothAuthors = new Promise((resolve) => { release = resolve; });
  const roots = [];
  const entries = paths.map((path, index) => ({
    id: `isolated-${index}`, resources: [],
    options: { coordinationUnavailable: "Test fixture has no project MCP", ownerReviewHold: true },
    spec: { schema: 1, taskId: `task-pool-isolated-${index}`, scope: "harness",
      goal: "Exercise candidate-only source isolation with a deterministic host fixture",
      completionCheck: "Real policy tests pass and separate fixture reviewer accepts candidate",
      paths: [path], checks: [{ completionCheck: "Ordinary workflow policy tests pass",
        argv: ["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/workflow-policy.test.mjs"] }],
    },
    host: async (request) => {
      const { action, payload, ...identity } = request;
      let result;
      if (action === "native-worker") {
        const review = payload.route.role === "review";
        if (!review) {
          entered++;
          if (entered === 2) release();
          await bothAuthors;
        }
        const marker = path.endsWith(".md") ? "\n<!-- isolated workflow fixture -->\n" : "\n// isolated workflow fixture\n";
        result = { client: "deterministic-test-fixture", workerId: `${index}-${review ? "review" : "author"}`,
          model: payload.route.model, effort: payload.route.effort, status: "completed",
          verdict: "ACCEPT", summary: "Fixture response, not a live model call", findings: [],
          changes: review ? [] : [{ path, content: payload.files[0].content + marker }] };
      } else if (action === "root-apply") {
        assert.notEqual(payload.root, repository);
        roots.push(payload.root);
        for (const change of payload.changes) writeFileSync(join(payload.root, change.path), change.content);
        result = { writer: "root", applied: true, root: payload.root };
      } else throw new Error(`Unexpected test host action: ${action}`);
      return { ...identity, result };
    },
  }));
  const batch = await runOrdinaryBatch(entries, { maxConcurrency: 2 });
  assert.equal(batch.peakConcurrency, 2);
  assert.equal(new Set(roots).size, 2);
  for (const [index, entry] of batch.results.entries()) {
    assert.equal(entry.status, "fulfilled", entry.error);
    const result = entry.value;
    assert.equal(result.integration, "pending-owner-acceptance");
    assert.equal(result.mcpReadback, false);
    assert.equal(result.ownerReviewHold, true);
    assert.equal(result.status, "ready-for-owner-review");
    assert.ok(result.checks.every((check) => check.status === "command-passed" && check.passedTests > 0));
    for (const reference of [...result.checkReferences, ...result.eventReferences]) {
      assert.equal(verifyJsonReference(reference, undefined, result.candidateRoot), true);
    }
    assert.notEqual(readFileSync(join(result.candidateRoot, paths[index]), "utf8"), canonical[index]);
    assert.equal(readFileSync(join(result.candidateRoot, paths[1 - index]), "utf8"), canonical[1 - index]);
  }
  assert.deepEqual(paths.map((path) => readFileSync(join(repository, path), "utf8")), canonical);
  assert.deepEqual(sourceObservation(), before);
});
