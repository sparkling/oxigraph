import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createOrdinaryWorkspace } from "../src/ordinary-workspace.mjs";
import { repository, runDelivery, sourceObservation } from "../src/delivery.mjs";
import { runWorkflow } from "../src/workflow.mjs";
import { ordinaryWorkflowSpec, setupOrdinaryWorkflowFixture } from "./support/ordinary-workflow-fixture.mjs";

test("non-Git candidates isolate source and execute real supported checks with private evidence", async () => {
  const before = sourceObservation();
  const first = createOrdinaryWorkspace(), second = createOrdinaryWorkspace();
  const path = "tools/engineering-harness/README.md";
  const original = readFileSync(join(repository, path), "utf8");
  const outside = first.outside([path]);
  const secondBefore = second.observe();
  assert.notEqual(first.root, second.root);
  assert.equal(existsSync(join(first.root, ".git")), false);
  assert.deepEqual(first.base, before);
  writeFileSync(join(first.root, path), `${original}\nCandidate-only test change.\n`);
  assert.equal(readFileSync(join(repository, path), "utf8"), original);
  assert.equal(readFileSync(join(second.root, path), "utf8"), original);
  assert.deepEqual(first.outside([path]), outside);
  assert.deepEqual(second.observe(), secondBefore);
  assert.notEqual(first.observe().sourceSha256, second.observe().sourceSha256);
  const command = { taskId: "task-candidate-context-test", completionCheck: "ordinary workflow policy tests pass",
    argv: ["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/workflow-policy.test.mjs"], quiet: true };
  const [a, b] = await Promise.all([first.execute(command), second.execute(command)]);
  assert.equal(a.status, "command-passed");
  assert.equal(b.status, "command-passed");
  assert.equal(a.source.root, first.root);
  assert.equal(b.source.root, second.root);
  assert.ok(a.directory.startsWith(`${first.root}/target/`));
  assert.ok(b.directory.startsWith(`${second.root}/target/`));
  assert.deepEqual(sourceObservation(), before);
  writeFileSync(join(first.root, "tools/engineering-harness/src/workflow-host.mjs"), "outside mutation\n");
  assert.notDeepEqual(first.outside([path]), outside);
});

test("ordinary execution rejects arbitrary external workspace contexts before spawning", async () => {
  await assert.rejects(runDelivery({}, { root: "/tmp", observe: () => ({}) }), /isolated candidate workspace/);
});

test("candidate application must acknowledge its exact root", async () => {
  for (const reported of [undefined, "/different-candidate"]) {
    const fixture = setupOrdinaryWorkflowFixture();
    await assert.rejects(runWorkflow(ordinaryWorkflowSpec, async (request) => {
      const response = await fixture.host(request);
      if (request.action === "root-apply") response.result.root = reported;
      return response;
    }, { ...fixture.io, root: "/expected-candidate" }), /different candidate workspace/);
  }
  const fixture = setupOrdinaryWorkflowFixture();
  const result = await runWorkflow(ordinaryWorkflowSpec, async (request) => {
    const response = await fixture.host(request);
    if (request.action === "root-apply") {
      assert.equal(request.payload.root, "/expected-candidate");
      response.result.root = request.payload.root;
    }
    return response;
  }, { ...fixture.io, root: "/expected-candidate" });
  assert.equal(result.status, "ready-for-owner-review");
});
