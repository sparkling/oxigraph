import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiDefaults, createOrdinaryApi, renderOrdinaryPrompt, withOrdinaryApi } from "../src/ordinary-api.mjs";
import { digest, runWorkflow } from "../src/workflow.mjs";
import { ordinaryWorkflowSpec, setupOrdinaryWorkflowFixture } from "./support/ordinary-workflow-fixture.mjs";

const apiPin = { model: "deepseek/deepseek-v4.1-flash", effort: "high", reason: "explicit API transport fixture" };
const spec = { ...ordinaryWorkflowSpec, implement: apiPin, review: apiPin };
const setup = () => setupOrdinaryWorkflowFixture({ spec });

const request = (task = "task-a", role = "implement") => ({ schema: 1, runId: "run", requestId: 1,
  taskId: task, specSha256: task, sourceSha256: "a".repeat(64), action: "native-worker",
  payload: { route: { role, model: apiDefaults.model, effort: "high", transport: "openrouter-api" },
    goal: "fix source", completionCheck: "passes", files: [{ path: "a.mjs", content: "before" }],
    feedback: { authorRationale: "never pass this to review" }, initialFiles: [], checks: [] } });
const result = { summary: "done", verdict: "ACCEPT", findings: [], changes: [] };
const completion = (content = JSON.stringify(result), id = "provider-1") => new Response(JSON.stringify({
  id, model: apiDefaults.model, usage: { cost: 0.01 }, choices: [{ finish_reason: "stop", message: { content } }],
}), { status: 200 });
const setupApi = (fetchImpl, options = {}) => {
  const directory = mkdtempSync(join(tmpdir(), "ordinary-api-"));
  return { directory, api: createOrdinaryApi({ directory, fetchImpl, apiKey: () => "test-secret", ...options }) };
};

test("API uses bounded current defaults, captures real cost and refuses request replay", async () => {
  let calls = 0;
  const { api, directory } = setupApi(async (url, options) => {
    calls++;
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, 131072);
    assert.deepEqual(body.reasoning, { effort: "high", exclude: true });
    assert.deepEqual(body.provider, { max_price: { prompt: 0.5, completion: 2 }, require_parameters: true });
    return completion();
  });
  const out = await api(request());
  assert.equal(out.evidence.actualUsd, 0.01);
  assert.equal(out.result.workerId, "provider-1");
  assert.ok(out.evidence.maximumUsd <= 1);
  assert.equal(apiDefaults.maxTotalUsd, null);
  await assert.rejects(api(request()), /request-replay-refused/);
  assert.equal(calls, 1);
  assert.ok(!readdirSync(directory).some((p) => readFileSync(join(directory, p), "utf8").includes("test-secret")));
});

test("pre-dispatch bounds and cancellation invoke no transport", async () => {
  const fetchImpl = () => { throw new Error("must not dispatch"); };
  const { api } = setupApi(fetchImpl);
  const oversized = request(); oversized.payload.files[0].content = "x".repeat(2000000);
  await assert.rejects(api(oversized), /request-cost-bound/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(setupApi(fetchImpl, { signal: controller.signal }).api(request()), /cancelled-before-dispatch/);
});

test("live requests overlap through independent adapters sharing one ledger", async () => {
  let release, calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async () => { const id = ++calls; if (id === 1) await pending; return completion(undefined, `provider-${id}`); };
  const { api, directory } = setupApi(fetchImpl);
  const first = api(request("task-a"));
  const second = createOrdinaryApi({ directory, fetchImpl, apiKey: () => "test-secret" })(request("task-b"));
  try {
    assert.equal((await second).evidence.actualUsd, 0.01);
    assert.equal(calls, 2);
  } finally { release(); await first; }
});

test("abandoned or corrupt reservations block new request IDs without transport", async () => {
  for (const content of ["{", JSON.stringify({ status: "reserved", owner: { pid: process.pid, witness: "stale" } }),
    JSON.stringify({ status: "reserved", owner: { pid: process.ppid, witness: "reused-pid" } })]) {
    let calls = 0;
    const { api, directory } = setupApi(async () => { calls++; return completion(); });
    writeFileSync(join(directory, `request-${"a".repeat(64)}.json`), content);
    await assert.rejects(api({ ...request("unrelated"), requestId: 5, runId: "new-run" }), /completion-unknown/);
    assert.equal(calls, 0);
  }
});

test("live cross-process owner permits concurrency, killed owner preserves unknown charge", { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "ordinary-api-owner-"));
  const module = new URL("../src/ordinary-api.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", `
    import { createOrdinaryApi } from ${JSON.stringify(module)};
    setInterval(() => {}, 1000);
    await createOrdinaryApi({ directory: ${JSON.stringify(directory)}, apiKey: () => 'test',
      fetchImpl: async () => { process.stdout.write('dispatched\\n'); return new Promise(() => {}); }
    })(${JSON.stringify(request())});
  `], { env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
  const closed = once(child, "close");
  try {
    const [chunk] = await once(child.stdout, "data");
    assert.match(chunk.toString(), /dispatched/);
    let calls = 0;
    const api = createOrdinaryApi({ directory, apiKey: () => "test",
      fetchImpl: async () => { calls++; return completion(); } });
    assert.equal((await api(request("task-b"))).evidence.actualUsd, 0.01);
    child.kill("SIGKILL"); await closed;
    await assert.rejects(api(request("task-c")), /completion-unknown/);
    assert.equal(calls, 1);
  } finally { child.kill("SIGKILL"); await closed; }
});

test("completed invalid output retains cost and holds task A but leaves task B eligible", async () => {
  let calls = 0;
  const { api } = setupApi(async () => ++calls === 1 ? completion("not JSON") : completion());
  await assert.rejects(api(request()), (error) => error.code === "completed-invalid-output" && error.evidence.actualUsd === 0.01);
  await assert.rejects(api(request()), /task-output-held/);
  assert.equal((await api(request("task-b"))).evidence.actualUsd, 0.01);
  assert.equal(calls, 2);
});

test("malformed or escaping API changes use shared validator and capable repair", async () => {
  const state = setup(); const nativeRoutes = []; let calls = 0;
  const { api } = setupApi(async () => {
    calls++;
    return completion(JSON.stringify({ ...result, changes: calls === 1 ? [{ path: "../escape", content: "bad" }] : [] }), `provider-${calls}`);
  });
  const host = async (r) => { if (r.action === "native-worker") nativeRoutes.push(r.payload.route.model); return state.host(r); };
  const out = await runWorkflow(spec, withOrdinaryApi(host, api), state.io);
  assert.equal(out.status, "ready-for-owner-review");
  assert.deepEqual(nativeRoutes, ["cc/claude-opus-5-5[1m]"]);
  assert.equal(out.review.apiEvidence.actualUsd, 0.01);
});

test("only explicit nonexecuted HTTP402 is credit fallback evidence", async () => {
  const { api } = setupApi(async () => new Response(JSON.stringify({ error: { code: 402 } }), { status: 402 }));
  await assert.rejects(api(request()), (error) => error.code === "confirmed-credit-rejection" && error.evidence.actualUsd === 0);
  const auth = setupApi(async () => new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 }));
  await assert.rejects(auth.api(request()), (error) => error.code === "authentication-rejected" && error.evidence.actualUsd === 0);
  assert.ok(!readdirSync(auth.directory).some((p) => p.startsWith("hold-") || p === "unknown-charge.json"));
  await assert.rejects(auth.api({ ...request(), requestId: 2 }), /authentication-rejected/);
  for (const [status, body] of [[402, { error: { code: 402 }, id: "executed" }]]) {
    const candidate = setupApi(async () => new Response(JSON.stringify(body), { status }));
    await assert.rejects(candidate.api(request()), /completion-unknown/);
    await assert.rejects(candidate.api(request("unrelated")), /completion-unknown/);
  }
});

test("charged non-2xx completion retains known accounting without credit fallback or global hold", async () => {
  for (const status of [402, 503]) {
    let calls = 0;
    const { api, directory } = setupApi(async () => ++calls === 1
      ? new Response(JSON.stringify({ id: "charged-error", usage: { cost: 0.01 }, error: { code: status } }), { status })
      : completion());
    const state = setup(); let nativeCalls = 0;
    const host = async (r) => { if (r.action === "native-worker") nativeCalls++; return state.host(r); };
    await assert.rejects(runWorkflow(spec, withOrdinaryApi(host, api), state.io),
      (error) => error.code === "completed-http-error" && error.evidence.actualUsd === 0.01
        && error.evidence.providerRequestId === "charged-error" && error.evidence.httpStatus === status);
    assert.equal(nativeCalls, 0);
    await assert.rejects(api({ ...request(spec.taskId), specSha256: digest(spec) }), /completed-http-error/);
    assert.equal(calls, 1);
    assert.equal((await api(request("unrelated"))).evidence.actualUsd, 0.01);
    assert.ok(!readdirSync(directory).includes("unknown-charge.json"));
  }
});

test("pinned dated snapshot is admitted and model mismatch retains known accounting", async () => {
  for (const [model, accepted] of [["deepseek/deepseek-v4.1-flash-20260910", true], ["deepseek/deepseek-v4.1-flash-other", false]]) {
    const candidate = setupApi(async () => new Response(JSON.stringify({ id: "known-completion", model,
      usage: { cost: 0.02 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] })));
    if (accepted) assert.equal((await candidate.api(request())).evidence.resolvedModel, model);
    else await assert.rejects(candidate.api(request()), (error) => error.code === "completed-model-mismatch" && error.evidence.actualUsd === 0.02);
  }
});

test("fresh review renderer excludes author feedback and retains current source/checks", () => {
  const value = renderOrdinaryPrompt(request("task", "review"));
  assert.ok(!value.includes("authorRationale"));
  assert.equal(JSON.parse(value).files[0].content, "before");
  assert.deepEqual(JSON.parse(value).checks, []);
});

test("every role receives the verdict/findings contract enforced by output validation", () => {
  for (const role of ["plan", "implement", "review"]) {
    const prompt = JSON.parse(renderOrdinaryPrompt(request("task", role)));
    assert.match(prompt.instructions, /ACCEPT requires findings=\[\]/);
    assert.match(prompt.instructions, /REJECT requires actionable findings/);
  }
});

test("real production callback seam routes API author and fresh review through existing workflow", async () => {
  const state = setup(); let calls = 0;
  const { api } = setupApi(async (_url, options) => {
    const prompt = JSON.parse(JSON.parse(options.body).messages[0].content);
    calls++;
    return completion(JSON.stringify({ ...result, changes: prompt.mode === "implementation"
      ? [{ path: spec.paths[0], content: "actual-proposal" }] : [] }), `provider-${calls}`);
  });
  const out = await runWorkflow(spec, withOrdinaryApi(state.host, api), state.io);
  assert.equal(out.status, "ready-for-owner-review");
  assert.equal(out.review.workerId, "provider-2");
  assert.deepEqual(out.implementationWorkerIds, ["provider-1"]);
  assert.equal(calls, 2);
});

test("confirmed credit fallback uses lighter independent native sessions, not Opus", async () => {
  const state = setup(); const models = [];
  const { api } = setupApi(async () => new Response(JSON.stringify({ error: { code: 402 } }), { status: 402 }));
  const host = async (r) => { if (r.action === "native-worker") models.push(r.payload.route.model); return state.host(r); };
  const out = await runWorkflow(spec, withOrdinaryApi(host, api), state.io);
  assert.equal(out.status, "ready-for-owner-review");
  assert.deepEqual(models, ["cc/claude-sonnet-5[1m]", "cc/claude-sonnet-5[1m]"]);
  assert.equal(out.review.failedApi.code, "confirmed-credit-rejection");
  assert.equal(out.review.failedApi.evidence.actualUsd, 0);
});
