import assert from "node:assert/strict";
import test from "node:test";
import { checkFeedback, digest, jsonReference, readWorkflowFiles, runWorkflow, validateWorkflow, verifyJsonReference } from "../src/workflow.mjs";
import { relayWorkflowHost, stdioHost } from "../src/workflow-host.mjs";
import { PassThrough, Writable } from "node:stream";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  ordinaryWorkflowPath as path,
  ordinaryWorkflowSpec as spec,
  setupOrdinaryWorkflowFixture as setup,
} from "./support/ordinary-workflow-fixture.mjs";

test("workflow executes native edit, apply, deterministic check, independent review and exact MCP handoff", async () => {
  const f = setup();
  const result = await runWorkflow(spec, f.host, f.io);
  assert.equal(result.status, "ready-for-owner-review");
  assert.equal(result.mcpReadback, true);
  assert.equal(result.qualification, false);
  assert.equal(result.publication, false);
  assert.equal(result.schema, "ordinary-workflow-v2");
  assert.equal(result.review.verdict, "ACCEPT");
  assert.equal(result.checks.length, 1);
  assert.equal(Object.hasOwn(result.checks[0], "result"), false);
  assert.ok(result.eventReferences.length > 0);
  assert.match(result.handoffReference.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('"request"'), false);
  assert.deepEqual(f.counters(), { checks: 1, implementations: 1, reviews: 1 });
  assert.deepEqual(f.actions.filter((action) => action !== "mcp-read"), ["native-worker", "root-apply", "native-worker", "mcp-handoff"]);
});
test("source identity is canonical and does not depend on record key insertion order", () => {
  assert.equal(digest([{ path, sha256: "a", content: "b" }]), digest([{ content: "b", path, sha256: "a" }]));
  assert.notEqual(digest([{ path, sha256: "a", content: "b" }]), digest([{ content: "c", path, sha256: "a" }]));
});
test("failed check reaches repair verbatim, stops later checks/review, and repaired source is checked again", async () => {
  const f = setup({ failChecks: 1 });
  const result = await runWorkflow({ ...spec, checks: [spec.checks[0], spec.checks[0]] }, f.host, f.io);
  assert.equal(result.status, "ready-for-owner-review");
  assert.deepEqual(f.counters(), { checks: 3, implementations: 2, reviews: 1 });
  assert.equal(f.feedback[1].code, 1);
  assert.match(f.feedback[1].resultSha256, /^[a-f0-9]{64}$/);
});
test("independent review findings feed repair and force a fresh check and review", async () => {
  const f = setup({ rejectReviews: 1 });
  await runWorkflow(spec, f.host, f.io);
  assert.deepEqual(f.counters(), { checks: 2, implementations: 2, reviews: 2 });
  assert.deepEqual(f.feedback[1].review.findings, ["Fix the exact review finding"]);
});
test("unchanged failing repairs stop for integrator judgment, not an invocation quota", async () => {
  const f = setup({ failChecks: true, stalled: true });
  await assert.rejects(runWorkflow(spec, f.host, f.io), /Repair stalled/);
  assert.equal(f.counters().reviews, 0);
  assert.ok(!f.actions.includes("mcp-handoff"));
});
test("owner hold prevents product workers and commands, but permits harness-only repair", async () => {
  const f = setup({ hold: true });
  await assert.rejects(runWorkflow({ ...spec, scope: "product", paths: ["lib/oxigraph/src/store.rs"] }, f.host, f.io), /Owner review hold/);
  assert.deepEqual(f.actions, ["mcp-read"]);
  assert.equal(f.counters().checks, 0);
});
test("workflow source preflight fails before any host request or worker", async () => {
  const f = setup();
  f.io.files = () => { throw new Error("preflight source failure"); };
  await assert.rejects(runWorkflow(spec, f.host, f.io), /preflight source failure/);
  assert.deepEqual(f.actions, []);
  assert.equal(f.counters().implementations, 0);
});
test("missing live task, cross-task response and stale native source fail before apply", async () => {
  for (const options of [{ missingTask: true }, { crossTask: true }, { proposalDrift: true }]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io));
    assert.ok(!f.actions.includes("root-apply"));
  }
});
test("protected/out-of-scope patches and non-root application cannot proceed", async () => {
  for (const options of [{ badPath: "AGENTS.md" }, { badPath: ".swarm/state" }, { wrongWriter: true }, { outsideWrite: true }]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io));
    assert.equal(f.counters().checks, 0);
  }
});
test("stale command evidence and source changes during checks/review prevent handoff", async () => {
  for (const options of [{ staleCheck: true }, { checkDrift: true }, { reviewWrites: true }]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io));
    assert.ok(!f.actions.includes("mcp-handoff"));
  }
});
test("reviewer must be distinct, MCP readback must match, and no-op cannot complete", async () => {
  for (const options of [{ sameWorker: true }, { badReadback: true }, { noChanges: true }]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io));
  }
});

test("native unavailability reports exact client/model/error without substitution or repair", async () => {
  const f = setup({ unavailable: true });
  const nativeSpec = { ...spec, implement: { model: "cc/claude-opus-5-5[1m]", effort: "high", reason: "native outage regression" } };
  await assert.rejects(runWorkflow(nativeSpec, f.host, f.io), /Claude native collaboration; model=cc\/claude-opus-5-5\[1m\]; fixture: requested model unavailable/);
  assert.equal(f.counters().implementations, 1);
  assert.equal(f.counters().checks, 0);
});
test("task contracts reject unknown fields, protected paths and product commands in harness scope", () => {
  for (const invalid of [{ ...spec, provider: "other" }, { ...spec, paths: [".claude-flow/state"] },
    { ...spec, paths: ["tools/engineering-harness/src/runtime/upstream.mjs"] },
    { ...spec, paths: ["tools/engineering-harness/src/../src/workflow.mjs"] },
    { ...spec, checks: [{ completionCheck: "invalid", argv: ["cargo", "test", "--locked", "-p", "oxigraph"] }] }]) {
    assert.throws(() => validateWorkflow(invalid));
  }
});
test("worker failure projection keeps raw process text local and bounds spec size", () => {
  const raw = { status: "failed", directory: "/local/run", result: { code: 1, stderrTail: "private output must remain local", output: "x".repeat(100000) } };
  const feedback = checkFeedback(raw);
  assert.equal(feedback.resultSha256, digest(raw));
  assert.equal(JSON.stringify(feedback).includes("private output"), false);
  assert.ok(JSON.stringify(feedback).length < 2048);
  assert.throws(() => validateWorkflow({ ...spec, goal: "x".repeat(32768) }), /structural limit/);
});
test("check feedback uses the native test framework count, not an unrelated zero counter", () => {
  const result = { observedPassedTests: 0, observedNodeTestSummary: { pass: 27, fail: 0 } };
  assert.equal(checkFeedback({ command: { kind: "node-test" }, result }).passedTests, 27);
  assert.equal(checkFeedback({ command: { kind: "cargo-test" }, result }).passedTests, 0);
  assert.equal(checkFeedback({ command: { kind: "node-test" }, result: {} }).passedTests, null);
});
test("host output failure rejects the pending action and removes its stream listeners", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-workflow-test-"));
  const input = new PassThrough();
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(new Error("closed host output")); } });
  // The fixture prevents an unhandled stream error; the bridge must still
  // observe it and reject its own pending request, not wait for its timeout.
  output.on("error", () => {});
  const baseline = output.listenerCount("error");
  const bridge = stdioHost(directory, input, output);
  let timer;
  try {
    const pending = bridge.request({ requestId: 1, action: "mcp-read" });
    await assert.rejects(Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("bridge failed to report stream error")), 250);
    })]), /closed host output/);
  } finally {
    clearTimeout(timer);
    bridge.close();
    input.destroy();
    output.destroy();
    rmSync(directory, { recursive: true });
  }
  assert.equal(output.listenerCount("error"), baseline);
});
test("host input error is contained even when readline forwards it", () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-workflow-input-test-"));
  try {
    execFileSync(process.execPath, ["--input-type=module", "--eval", `
      import assert from 'node:assert/strict';
      import { PassThrough } from 'node:stream';
      import { stdioHost } from './tools/engineering-harness/src/workflow-host.mjs';
      const input = new PassThrough(); const output = new PassThrough();
      const bridge = stdioHost(process.argv[1], input, output);
      const pending = bridge.request({requestId: 1, action: 'mcp-read'});
      input.emit('error', new Error('input disconnected'));
      await assert.rejects(pending, /input disconnected/);
      bridge.close(); input.destroy(); output.destroy();
    `, directory], { timeout: 2000, stdio: "pipe" });
  } finally { rmSync(directory, { recursive: true }); }
});


test("product workflow admits only the reviewed native lock adapter", () => {
  const check = { completionCheck: "valid native check", argv: ["cargo", "test", "--locked", "-p", "oxigraph"] };
  assert.doesNotThrow(() => validateWorkflow({ ...spec, scope: "product", paths: ["oxrocksdb-sys/api/c.cc"], checks: [check] }));
  for (const path of [
    "oxrocksdb-sys/api/c.h", "oxrocksdb-sys/api/other.cc", "oxrocksdb-sys/vendor/rocksdb.cc",
    "oxrocksdb-sys/api/../api/c.cc", "/oxrocksdb-sys/api/c.cc", "lib/../oxrocksdb-sys/api/c.cc",
  ]) assert.throws(() => validateWorkflow({ ...spec, scope: "product", paths: [path], checks: [check] }));
});

test("product workflow admits exact SHACL suite-update paths only", () => {
  const check = { completionCheck: "SHACL evidence command passes", argv: ["node", "tools/shacl-tests/run.mjs"] };
  for (const path of [
    "tools/shacl-tests/inventory.mjs",
    "tools/shacl-tests/clause-audit.mjs",
    "tools/shacl-tests/run.mjs",
    "tools/shacl-tests/jena-compact.mjs",
    "tools/shacl-tests/shacl-requirements.mjs",
    "tools/shacl-tests/clause-reviews.mjs",
    "tools/shacl-tests/README.md",
    "tools/evidence/policy.mjs",
    "tools/evidence/verify-programme.mjs",
    "tools/evidence/verify-programme.test.mjs",
  ]) {
    assert.doesNotThrow(() => validateWorkflow({ ...spec, scope: "product", paths: [path], checks: [check] }));
  }
  for (const path of [
    "tools/shacl-tests/adjacent.mjs",
    "tools/shacl-tests/../shacl-tests/run.mjs",
    "tools/docs/guide.md",
    "docs/adr/0046-shacl-12-editors-draft-realignment.md",
    "lib/oxshacl/tests/fixtures/srl_clause_productions.tsv",
    "lib/oxshacl/tests/fixtures/other.tsv",
  ]) assert.throws(() => validateWorkflow({ ...spec, scope: "product", paths: [path], checks: [check] }));
});

test("mechanical relay refreshes MCP reads, preserves observations, and leaves native actions pending", async () => {
  const mcp = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  const observations = [];
  let taskReads = 0;
  let controlReads = 0;
  let controlStarted = false;
  const request = {
    schema: 1, runId: "run-relay", requestId: 1, taskId: spec.taskId,
    specSha256: "a".repeat(64), sourceSha256: "b".repeat(64), action: "mcp-read",
    payload: { namespace: "programme-controls", key: "control" },
  };
  const serialized = relayWorkflowHost.toString();
  assert.equal(serialized.includes("import "), false);
  const relay = Function(`"use strict"; return (${serialized});`)();
  const callbacks = {
    taskStatus: async function* ({ taskId }) {
      taskReads++;
      yield { type: "observation", taskReads };
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(controlStarted, true);
      return mcp({ taskId, status: "in_progress" });
    },
    memoryRetrieve: async ({ namespace, key }) => {
      controlStarted = true;
      controlReads++;
      return mcp({ namespace, key, found: true, value: { revision: controlReads } });
    },
    observation: async (value) => { observations.push(value); },
  };
  const first = await relay(request, callbacks);
  const second = await relay({ ...request, requestId: 2 }, callbacks);
  assert.equal(first.result.control.revision, 1);
  assert.equal(second.result.control.revision, 2);
  assert.deepEqual([taskReads, controlReads, observations.length], [2, 2, 2]);
  for (const action of ["native-worker", "root-apply"]) {
    const pending = { ...request, action };
    assert.equal(await relayWorkflowHost(pending, callbacks), pending);
  }
});

test("stdio host services injected MCP callbacks without creating a pending native request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-workflow-relay-test-"));
  const input = new PassThrough();
  const output = new PassThrough();
  const mcp = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  const bridge = stdioHost(directory, input, output, {
    taskStatus: async ({ taskId }) => mcp({ taskId, status: "in_progress" }),
    memoryRetrieve: async () => mcp({ found: true, value: { active: true } }),
  });
  try {
    const request = {
      schema: 1, runId: "run-relay", requestId: 1, taskId: spec.taskId,
      specSha256: "a".repeat(64), sourceSha256: "b".repeat(64), action: "mcp-read",
      payload: { namespace: "programme-controls", key: "control" },
    };
    const response = await bridge.request(request);
    assert.equal(response.result.task.taskId, spec.taskId);
    assert.deepEqual(readdirSync(directory), []);
    assert.equal(output.readableLength, 0);
  } finally {
    bridge.close();
    input.destroy();
    output.destroy();
    rmSync(directory, { recursive: true });
  }
});

test("mechanical handoff requires a real strict store and exact fresh readback", async () => {
  const mcp = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  const evidence = { schema: "ordinary-workflow-v2", value: 7 };
  const request = {
    schema: 1, runId: "run-relay", requestId: 3, taskId: spec.taskId,
    specSha256: "a".repeat(64), sourceSha256: "b".repeat(64), action: "mcp-handoff",
    payload: { namespace: "evidence", key: "record", evidence },
  };
  let stored;
  const response = await relayWorkflowHost(request, {
    memoryStore: async (args) => { stored = args; return mcp({ success: true }); },
    memoryRetrieve: async () => mcp({ found: true, value: evidence }),
  });
  assert.deepEqual(response.result.value, evidence);
  assert.equal(stored.upsert, false);
  assert.equal(stored.provenance_type, "tool_result");
  await assert.rejects(relayWorkflowHost(request, {
    memoryStore: async () => mcp({ success: true }),
    memoryRetrieve: async () => mcp({ found: true, value: { forged: true } }),
  }), /readback/);
  await assert.rejects(relayWorkflowHost(request, {
    memoryStore: async () => ({ isError: true, content: [] }),
    memoryRetrieve: async () => mcp({ found: true, value: evidence }),
  }), /memory_store failed/);
  await assert.rejects(relayWorkflowHost(request, {
    memoryStore: async () => mcp({ success: false }),
    memoryRetrieve: async () => mcp({ found: true, value: evidence }),
  }), /store was not confirmed/);
  const legacy = { schema: "ordinary-workflow-v1", historical: true };
  const legacyResponse = await relayWorkflowHost({
    ...request, requestId: 4, payload: { ...request.payload, key: "legacy", evidence: legacy },
  }, {
    memoryStore: async () => mcp({ success: true }),
    memoryRetrieve: async () => mcp({ found: true, value: legacy }),
  });
  assert.deepEqual(legacyResponse.result.value, legacy);
});

test("workflow refuses missing or tampered local evidence references", async () => {
  for (const options of [
    { missingEventEvidence: true }, { tamperedEventEvidence: true },
    { missingCheckEvidence: true }, { tamperedCheckEvidence: true },
  ]) {
    const f = setup(options);
    await assert.rejects(runWorkflow(spec, f.host, f.io), /evidence reference/);
    assert.ok(!f.actions.includes("mcp-handoff"));
  }
});

test("local JSON references are content-bound and fail after tampering", () => {
  const root = mkdtempSync(join(tmpdir(), "oxigraph-workflow-reference-test-"));
  const path = join(root, "event.json");
  try {
    const value = { event: 1 };
    writeFileSync(path, JSON.stringify(value) + "\n");
    const reference = jsonReference(path, value, root);
    assert.equal(verifyJsonReference(reference, value, root), true);
    writeFileSync(path, JSON.stringify({ event: 2 }) + "\n");
    assert.throws(() => verifyJsonReference(reference, value, root), /tampered/);
  } finally { rmSync(root, { recursive: true }); }
});

test("product manifests and nested new files are admitted without weakening parent checks", () => {
  const check = { completionCheck: "valid native check", argv: ["cargo", "test", "--locked", "-p", "oxigraph"] };
  for (const manifest of [
    "Cargo.toml", "Cargo.lock", "cli/Cargo.toml", "testsuite/Cargo.toml",
    "lib/oxrdf/Cargo.toml", "lib/oxrdf/Cargo.lock", "oxrocksdb-sys/Cargo.toml",
  ]) {
    assert.doesNotThrow(() => validateWorkflow({ ...spec, scope: "product", paths: [manifest], checks: [check] }));
  }
  for (const manifest of ["tools/Cargo.toml", "oxrocksdb-sys/vendor/Cargo.toml", "Cargo.toml/child"]) {
    assert.throws(() => validateWorkflow({ ...spec, scope: "product", paths: [manifest], checks: [check] }));
  }
  const root = mkdtempSync(join(tmpdir(), "oxigraph-workflow-parent-test-"));
  try {
    mkdirSync(join(root, "real"));
    writeFileSync(join(root, "real", "present.rs"), "fn present() {}\n");
    assert.equal(readWorkflowFiles(["new/deep/file.rs"], root)[0].content, null);
    assert.match(readWorkflowFiles(["real/present.rs"], root)[0].sha256, /^[a-f0-9]{64}$/);
    symlinkSync(join(root, "real"), join(root, "linked"), "dir");
    assert.throws(() => readWorkflowFiles(["linked/new/file.rs"], root), /parent/);
    assert.throws(() => readWorkflowFiles(["../escape.rs"], root), /Unsafe source path/);
  } finally { rmSync(root, { recursive: true }); }
});
