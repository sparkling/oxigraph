import assert from "node:assert/strict";
import fs, { existsSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { createOrdinaryWorkspace, isSecretSourcePath, runIsolatedWorkflow } from "../src/ordinary-workspace.mjs";
import { repository, runDelivery, sourceObservation } from "../src/delivery.mjs";
import { runWorkflow } from "../src/workflow.mjs";
import { runOrdinaryBatch } from "../src/ordinary-pool.mjs";
import { ordinaryWorkflowSpec, setupOrdinaryWorkflowFixture } from "./support/ordinary-workflow-fixture.mjs";

test("secret source admission covers env files and env directories without prefix false positives", () => {
  for (const path of [".env", ".env.local", ".env/key", "src/.env/key", "src/.env.local/key"]) {
    assert.equal(isSecretSourcePath(path), true, path);
  }
  for (const path of ["src/environment.mjs", ".environment/key", "src/README.md"]) {
    assert.equal(isSecretSourcePath(path), false, path);
  }
});

test("snapshot preparation failure retains candidate custody through the ordinary pool", async (t) => {
  let calls = 0;
  const copy = t.mock.method(fs, "copyFileSync", () => { throw new Error("fixture snapshot copy failure"); });
  syncBuiltinESMExports();
  try {
    const result = await runOrdinaryBatch([{ id: "preparation", spec: ordinaryWorkflowSpec,
      host: async () => { calls++; }, options: {} }], { maxConcurrency: 1 });
    const failed = result.results[0];
    assert.equal(failed.status, "rejected");
    assert.equal(calls, 0);
    assert.ok(failed.candidateRoot?.startsWith(join(repository, "target/engineering-delivery/candidates/source-")));
    assert.ok(existsSync(failed.candidateRoot));
    const evidence = JSON.parse(readFileSync(join(failed.evidenceDirectory, "preparation-failure.json"), "utf8"));
    assert.equal(evidence.error, "fixture snapshot copy failure");
    assert.equal(evidence.candidateRoot, failed.candidateRoot);
  } finally { copy.mock.restore(); syncBuiltinESMExports(); }
});

test("unwritable preparation evidence preserves original error and allocated root", (t) => {
  const failure = new Error("fixture copy failed");
  const copy = t.mock.method(fs, "copyFileSync", () => { throw failure; });
  const write = t.mock.method(fs, "writeFileSync", () => { throw new Error("fixture evidence unavailable"); });
  syncBuiltinESMExports();
  try {
    assert.throws(createOrdinaryWorkspace, (error) => error === failure && existsSync(error.candidateRoot) &&
      error.evidenceDirectory === error.candidateRoot && error.evidenceWriteError === "fixture evidence unavailable");
  } finally { copy.mock.restore(); write.mock.restore(); syncBuiltinESMExports(); }
});

test("workflow evidence-directory failure retains prepared candidate before any host action", async (t) => {
  const original = fs.mkdtempSync, failure = new Error("fixture workflow directory failed");
  const mkdir = t.mock.method(fs, "mkdtempSync", (prefix, ...args) => {
    if (prefix.endsWith("/workflow-")) throw failure;
    return original(prefix, ...args);
  });
  syncBuiltinESMExports();
  let calls = 0;
  try {
    await assert.rejects(runIsolatedWorkflow(ordinaryWorkflowSpec, async () => { calls++; }), (error) => {
      assert.equal(error, failure);
      assert.ok(existsSync(error.candidateRoot));
      const evidence = JSON.parse(readFileSync(join(error.evidenceDirectory, "preparation-failure.json"), "utf8"));
      assert.equal(evidence.phase, "workflow-preparation");
      return true;
    });
    assert.equal(calls, 0);
  } finally { mkdir.mock.restore(); syncBuiltinESMExports(); }
});

test("workflow failure log cannot mask original host error or candidate custody", async (t) => {
  const original = fs.writeFileSync, failure = new Error("fixture host failed", { cause: new Error("original cause") });
  const write = t.mock.method(fs, "writeFileSync", (path, ...args) => {
    if (typeof path === "string" && path.endsWith("/failure.json")) throw new Error("fixture failure log unavailable");
    return original(path, ...args);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(runIsolatedWorkflow(ordinaryWorkflowSpec, async () => { throw failure; }, {
      coordinationUnavailable: "Local deterministic fixture", ownerReviewHold: true,
    }), (error) => error === failure && error.cause.message === "original cause" && existsSync(error.candidateRoot) &&
      existsSync(error.evidenceDirectory) && error.evidenceWriteError === "fixture failure log unavailable");
  } finally { write.mock.restore(); syncBuiltinESMExports(); }
});

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
