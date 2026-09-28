import assert from "node:assert/strict";
import test from "node:test";
import { runOrdinaryBatch } from "../src/ordinary-pool.mjs";
import { runWorkflow } from "../src/workflow.mjs";
import { ordinaryWorkflowSpec, setupOrdinaryWorkflowFixture } from "./support/ordinary-workflow-fixture.mjs";

const specFor = (id, scope = "harness") => ({ ...ordinaryWorkflowSpec, taskId: `task-${id}`, scope,
  paths: [scope === "product" ? `lib/oxigraph/src/${id}.rs` : id === "first"
    ? "tools/engineering-harness/README.md" : "tools/engineering-harness/src/workflow-host.mjs"],
});
const controlled = (spec, control, status = "in_progress") => {
  const fixture = setupOrdinaryWorkflowFixture({ spec, hold: false });
  const host = async (request) => {
    const response = await fixture.host(request);
    if (request.action === "mcp-read") {
      response.result.control = typeof control === "function" ? control() : control;
      response.result.task.status = status;
    }
    return response;
  };
  return { ...fixture, host };
};

test("connected ready lists admit two distinct scoped workflows through actual upstream pool", async () => {
  for (const scope of ["harness", "product"]) {
    const specs = [specFor("first", scope), specFor("second", scope)];
    const field = scope === "harness" ? "readyHarnessTaskIds" : "readyDeliveryTaskIds";
    const control = { [field]: specs.map((spec) => spec.taskId), ownerReviewHold: { active: false } };
    let entered = 0, release;
    const both = new Promise((resolve) => { release = resolve; });
    const entries = specs.map((spec, index) => {
      const fixture = controlled(spec, control);
      return { id: `${scope}-${index}`, spec, options: fixture.io, host: async (request) => {
        if (request.action === "native-worker" && request.payload.route.role === "implement") {
          if (++entered === 2) release();
          await both;
        }
        return fixture.host(request);
      } };
    });
    const result = await runOrdinaryBatch(entries, { maxConcurrency: 2 }, runWorkflow);
    assert.equal(entered, 2);
    assert.ok(result.results.every((item) => item.status === "fulfilled"), JSON.stringify(result.results));
    assert.ok(result.results.every((item) => item.value.mcpReadback === true));
    assert.equal(result.integration, "pending-owner-acceptance");
  }
});

test("legacy IDs still authorize when ready list is absent; explicit lists supersede legacy", async () => {
  for (const scope of ["harness", "product"]) {
    const spec = specFor("first", scope);
    const legacy = scope === "harness" ? "activeHarnessTaskId" : "activeDeliveryTaskId";
    const ready = scope === "harness" ? "readyHarnessTaskIds" : "readyDeliveryTaskIds";
    const control = { [legacy]: spec.taskId, ownerReviewHold: { active: false } };
    const accepted = controlled(spec, control);
    assert.equal((await runWorkflow(spec, accepted.host, accepted.io)).mcpReadback, true);
    for (const list of [[], ["task-other"]]) {
      const rejected = controlled(spec, { ...control, [ready]: list });
      await assert.rejects(runWorkflow(spec, rejected.host, rejected.io), /does not authorize/);
      assert.deepEqual(rejected.actions, ["mcp-read"]);
    }
  }
});

test("malformed ready lists, unlisted IDs and opposite scopes cannot grant authority", async () => {
  for (const scope of ["harness", "product"]) {
    const spec = specFor("first", scope);
    const ready = scope === "harness" ? "readyHarnessTaskIds" : "readyDeliveryTaskIds";
    const opposite = scope === "harness" ? "readyDeliveryTaskIds" : "readyHarnessTaskIds";
    for (const value of [null, {}, spec.taskId, [spec.taskId, spec.taskId], [17], ["task-bad/id"], ["task-other"]]) {
      const fixture = controlled(spec, { [ready]: value, ownerReviewHold: { active: false } });
      await assert.rejects(runWorkflow(spec, fixture.host, fixture.io), /Invalid owner-authorized|does not authorize/);
      assert.deepEqual(fixture.actions, ["mcp-read"]);
    }
    const otherScope = controlled(spec, { [opposite]: [spec.taskId], ownerReviewHold: { active: false } });
    await assert.rejects(runWorkflow(spec, otherScope.host, otherScope.io), /does not authorize/);
    assert.deepEqual(otherScope.actions, ["mcp-read"]);
  }
});

test("ready membership cannot bypass paused task or product owner hold", async () => {
  for (const scope of ["harness", "product"]) {
    const spec = specFor("first", scope);
    const field = scope === "harness" ? "readyHarnessTaskIds" : "readyDeliveryTaskIds";
    const control = { [field]: [spec.taskId], ownerReviewHold: { active: false } };
    for (const status of ["paused", "pending", "completed"]) {
      const fixture = controlled(spec, control, status);
      await assert.rejects(runWorkflow(spec, fixture.host, fixture.io), /does not authorize/);
      assert.deepEqual(fixture.actions, ["mcp-read"]);
    }
    const held = controlled(spec, { ...control, ownerReviewHold: { active: true } });
    if (scope === "product") {
      await assert.rejects(runWorkflow(spec, held.host, held.io), /Owner review hold/);
      assert.deepEqual(held.actions, ["mcp-read"]);
    } else assert.equal((await runWorkflow(spec, held.host, held.io)).mcpReadback, true);
  }
});

test("fresh live read revokes ready task before root application", async () => {
  const spec = specFor("first");
  const fixture = controlled(spec, () => ({
    activeHarnessTaskId: spec.taskId,
    readyHarnessTaskIds: fixture.counters().implementations === 0 ? [spec.taskId] : [], ownerReviewHold: { active: false },
  }));
  await assert.rejects(runWorkflow(spec, fixture.host, fixture.io), /does not authorize/);
  assert.equal(fixture.counters().implementations, 1);
  assert.ok(!fixture.actions.includes("root-apply"));
  assert.equal(fixture.counters().checks, 0);
});
