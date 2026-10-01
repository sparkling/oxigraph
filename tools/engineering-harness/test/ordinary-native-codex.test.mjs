import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runOrdinaryNativeRequest, runOrdinaryClaudeRequest } from "../src/native/ordinary-host.mjs";
import { repository } from "../src/delivery.mjs";
import { ordinaryRustEnvironment, scrubbedChildEnvironment } from "../../child-environment.mjs";

const secret = "PRIVATE_prompt_reasoning_tool_error";
function setup(t, code, role = "review", files = [], repositoryReceipts = false) {
  const parent = repositoryReceipts ? join(repository, "target/engineering-delivery") : tmpdir();
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, "ordinary-codex-"));
  t.after(() => {
    if (existsSync(join(directory, "start.json"))) rmSync(JSON.parse(readFileSync(join(directory, "start.json"))).executionRoot, { recursive: true, force: true });
    rmSync(directory, { recursive: true, force: true });
  });
  const executable = join(directory, "fake-codex.mjs");
  writeFileSync(executable, `#!${process.execPath}\nimport fs from 'node:fs';
    const argv=process.argv.slice(2),emit=event=>process.stdout.write(JSON.stringify(event)+'\\n');
    fs.writeFileSync('actual.json',JSON.stringify({argv,apiKeyPresent:!!process.env.OPENROUTER_API_KEY,
      profiles:Object.fromEntries(Object.entries(process.env).filter(([name])=>name.startsWith('CARGO_PROFILE_')))}));
    process.stdin.resume();
    emit({type:'thread.started',thread_id:'fixture-codex-worker'});
    ${code}\n`, { mode: 0o700 });
  const request = { schema: 1, runId: randomUUID(), requestId: 1, taskId: "task-sol61-fixture",
    specSha256: "spec", sourceSha256: "source", action: "native-worker",
    payload: { route: { transport: "native-subscription", role, model: "gpt-6.1-sol", effort: "high" }, files } };
  const requestPath = join(directory, "request.json");
  writeFileSync(requestPath, JSON.stringify(request));
  const records = [];
  return { directory, records, read: name => {
    const root = name === "actual.json" ? JSON.parse(readFileSync(join(directory, "start.json"))).executionRoot : directory;
    return JSON.parse(readFileSync(join(root, name), "utf8"));
  },
    args: { request, requestPath, directory, prompt: secret, driverUrl: new URL(import.meta.url),
      resolveExecutable: provider => ({ provider, path: executable, sha256: createHash("sha256").update(readFileSync(executable)).digest("hex") }),
      streamLimits: { warnMs: 150, cancelMs: 400, termGraceMs: 50, drainMs: 1000, progressMs: 50 },
      observation: value => records.push(value) } };
}
const complete = (output = { summary: "checked", verdict: "ACCEPT", findings: [], changes: [] }) => `
  emit({type:'item.completed',item:{id:'thinking',type:'reasoning',text:'${secret}'}});
  fs.writeFileSync(argv[argv.indexOf('--output-last-message')+1],${JSON.stringify(JSON.stringify(output))});
  emit({type:'turn.completed',usage:{output_tokens:1}});`;

test("ordinary Codex bridge reuses canonical invocation and validates actual thread/output identity", async t => {
  const fixture = setup(t, complete());
  const result = await runOrdinaryNativeRequest(fixture.args);
  assert.equal(result.status, "completed");
  assert.equal(result.response.result.client, "codex");
  assert.equal(result.response.result.workerId, "fixture-codex-worker");
  assert.equal(result.response.result.model, "gpt-6.1-sol");
  assert.equal(result.response.result.effort, "high");
  const actual = fixture.read("actual.json"), start = fixture.read("start.json");
  assert.deepEqual(actual.argv, start.argv);
  assert.equal(actual.argv[actual.argv.indexOf("--config") + 1], 'model_reasoning_effort="high"');
  assert.ok(actual.argv[actual.argv.indexOf("--output-schema") + 1].endsWith("ordinary-worker-output.schema.json"));
  assert.equal(actual.apiKeyPresent, false);
  assert.deepEqual(actual.profiles, ordinaryRustEnvironment({}));
  for (const [name, value] of Object.entries(ordinaryRustEnvironment({}))) {
    assert.ok(actual.argv.includes(`shell_environment_policy.set.${name}=${JSON.stringify(value)}`));
  }
  assert.equal(start.client, "codex");
  assert.equal(result.terminal.custodyReleased, true);
  assert.equal(result.terminal.activityCount, 1);
  assert.ok(!JSON.stringify(fixture.records).includes(secret));
  assert.ok(!readFileSync(join(fixture.directory, "progress.jsonl"), "utf8").includes(secret));
  assert.ok(!readFileSync(join(fixture.directory, "terminal.json"), "utf8").includes(secret));
  assert.equal(runOrdinaryClaudeRequest, runOrdinaryNativeRequest);
});

test("ordinary Rust defaults follow sanitization without changing frozen child environment", () => {
  const frozen = scrubbedChildEnvironment({}, { PATH: "/bin", CARGO_PROFILE_DEV_DEBUG: "2",
    CARGO_PROFILE_RELEASE_DEBUG: "2", CARGO_INCREMENTAL: "1", RUSTFLAGS: "untrusted" });
  assert.deepEqual(frozen, { PATH: "/bin" });
  assert.deepEqual(ordinaryRustEnvironment(frozen), { PATH: "/bin", CARGO_PROFILE_DEV_DEBUG: "1",
    CARGO_PROFILE_TEST_DEBUG: "1", CARGO_PROFILE_DEV_INCREMENTAL: "false", CARGO_PROFILE_TEST_INCREMENTAL: "false" });
  assert.equal(ordinaryRustEnvironment({ CARGO_INCREMENTAL: "0" }).CARGO_INCREMENTAL, "0");
});

test("repository bridge receipts retain Codex private temporary execution-root policy", async t => {
  const fixture = setup(t, complete(), "review", [], true);
  const result = await runOrdinaryNativeRequest(fixture.args);
  assert.equal(result.status, "completed");
  assert.ok(fixture.directory.startsWith(join(repository, "target/engineering-delivery")));
  assert.ok(fixture.read("start.json").executionRoot.startsWith(join(tmpdir(), "oxigraph-ordinary-codex-")));
  assert.notEqual(fixture.read("start.json").executionRoot, fixture.directory);
});

test("Codex ordinary implementation accepts scoped contents, rejects planner mutation", async t => {
  const output = { summary: "scoped proposal", verdict: "ACCEPT", findings: [], changes: [{ path: "src/file.mjs", content: "export const ready=true;" }] };
  const author = setup(t, complete(output), "implement", [{ path: "src/file.mjs" }]);
  assert.deepEqual((await runOrdinaryNativeRequest(author.args)).response.result.changes, output.changes);
  const plan = setup(t, complete(output), "plan", [{ path: "src/file.mjs" }]);
  await assert.rejects(runOrdinaryNativeRequest(plan.args), /must not propose source changes/);
  assert.equal(existsSync(join(plan.directory, "response.json")), false);
});

test("Codex native unavailable preserves exact error without silent Claude fallback", async t => {
  const fixture = setup(t, `emit({type:'turn.failed',error:{message:'requested model gpt-6.1-sol unavailable ${secret}'}});process.exitCode=1;`);
  const result = await runOrdinaryNativeRequest(fixture.args);
  assert.equal(result.status, "unavailable");
  assert.equal(result.response.result.client, "codex");
  assert.equal(result.response.result.error, `requested model gpt-6.1-sol unavailable ${secret}`);
  assert.ok(!JSON.stringify(fixture.records).includes(secret));
});

test("Codex missing output, duplicate terminal and signal exit cannot become accepted response", async t => {
  const missing = setup(t, "emit({type:'turn.completed'});");
  await assert.rejects(runOrdinaryNativeRequest(missing.args), { code: "ENOENT" });
  for (const code of [complete() + "emit({type:'turn.completed'});", complete() + "process.kill(process.pid,'SIGTERM');"]) {
    const fixture = setup(t, code);
    const result = await runOrdinaryNativeRequest(fixture.args);
    assert.equal(result.status, "failed");
    assert.equal(existsSync(join(fixture.directory, "response.json")), false);
    assert.equal(result.terminal.custodyReleased, true);
  }
});

test("Codex heartbeat and repeated identical content cannot hide inactivity stall", async t => {
  const fixture = setup(t, `setInterval(()=>emit({type:'item.updated',item:{id:'same',type:'reasoning',text:'${secret}'}}),20);`);
  const result = await runOrdinaryNativeRequest(fixture.args);
  assert.equal(result.status, "failed");
  assert.equal(result.failure.classification, "stalled");
  assert.equal(result.terminal.activityCount, 1);
  assert.equal(result.terminal.custodyReleased, true);
});
