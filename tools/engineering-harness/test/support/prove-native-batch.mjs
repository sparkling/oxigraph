// Explicit opt-in live harness proof. Never starts application or cloud work.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, realpathSync, lstatSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { repository, sourceObservation } from "../../src/delivery.mjs";
import { nativeChildEnvironment } from "../../src/native/environment.mjs";
import { resolveNativeExecutable } from "../../src/native/executable.mjs";
import { workerOutput } from "../../src/workflow-output.mjs";

if (process.argv[2] !== "--run") throw new Error("Live native execution requires explicit --run");
const before = sourceObservation();
const directory = mkdtempSync(join(repository, "target/engineering-delivery/native-batch-proof-"));
const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const tasks = [
  ["pool-observer", "tools/engineering-harness/test/ordinary-pool.test.mjs",
    "Append a focused regression proving nonfunction onSettled (e.g. true) rejects with /onSettled must be a callback/ BEFORE any executor callback. Use existing pair helper. Preserve every existing test."],
  ["route-binding", "tools/engineering-harness/test/workflow-policy.test.mjs",
    "Append a focused regression proving a native implementation result with mismatched model is rejected with /Native route\\/result mismatch/ BEFORE root-apply and checks. Use existing setup, spec, updateNativeResults helpers and counters. Change result.model to a distinct string only during implement role. Preserve every existing test."],
];
const spec = { schema: 1, maxConcurrency: 2, entries: tasks.map(([id, path, goal]) => ({
  id, resources: [], spec: { schema: 1, taskId: `task-native-batch-${id}`, scope: "harness",
    goal, completionCheck: "Useful added regression and all existing file tests pass; independent fresh review accepts exact change.",
    paths: [path], checks: [{ completionCheck: "Changed test file passes", argv: ["node", "--test", "--test-reporter=tap", path] }] },
})) };
save("spec.json", spec); save("initial-source.json", before);
save("runtime.json", { schema: 1, memoryDirectory: relative(repository, join(directory, "native-outcomes")) });
const executable = resolveNativeExecutable("claude");
const schema = { type: "object", additionalProperties: false, required: ["summary", "verdict", "findings", "changes"], properties: {
  summary: { type: "string" }, verdict: { enum: ["ACCEPT", "REJECT", "INCONCLUSIVE"] },
  findings: { type: "array", items: { type: "string" } }, changes: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["path", "content"],
    properties: { path: { type: "string" }, content: { type: "string" } },
  } },
} };
const calls = [], pending = new Set(), active = new Set();
let failed, final, priorCpu;
const capacity = () => {
  const fields = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const current = { total: fields.reduce((a, b) => a + b, 0), idle: fields[3] + fields[4] };
  const sample = { type: "capacity", at: Date.now(), load: readFileSync("/proc/loadavg", "utf8").trim(),
    ...(priorCpu ? { intervalIdlePercent: 100 * (current.idle - priorCpu.idle) / (current.total - priorCpu.total) } : {}),
    psi: Object.fromEntries(["cpu", "memory", "io"].map(name => [name, readFileSync(`/proc/pressure/${name}`, "utf8").trim()])) };
  priorCpu = current; save(`capacity-${sample.at}.json`, sample); console.log(JSON.stringify(sample));
};
capacity(); const timer = setInterval(capacity, 30000);
const child = spawn(process.execPath, ["tools/engineering-harness/bin/oxigraph-delivery.mjs", "batch", "--spec", join(directory, "spec.json"),
  "--runtime-config", join(directory, "runtime.json"), "--coordination-unavailable", "No Oxigraph-scoped structured MCP connection in this execution host", "--owner-review-hold", "true"],
{ cwd: repository, stdio: ["pipe", "pipe", "pipe"] });
console.log(JSON.stringify({ directory, batchPid: child.pid, model: "cc/claude-sonnet-5-5[1m]", effort: "high" }));
child.stderr.on("data", bytes => process.stderr.write(bytes));
const respond = async request => {
  const { action, payload, ...identity } = request;
  let result;
  if (action === "native-worker") {
    assert.equal(payload.route.transport, "native-subscription");
    assert.ok(["cc/claude-sonnet-5-5[1m]", "cc/claude-opus-5-5[1m]"].includes(payload.route.model));
    assert.equal(payload.route.effort, "high");
    const key = `${request.runId}-${request.requestId}`;
    const args = ["--print", "--safe-mode", "--no-session-persistence", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--model", payload.route.model, "--effort", payload.route.effort, "--permission-mode", "dontAsk", "--tools", "",
      "--output-format", "json", "--json-schema", JSON.stringify(schema), "--no-chrome", "--disable-slash-commands"];
    const call = { key, taskId: request.taskId, role: payload.route.role, model: payload.route.model, effort: payload.route.effort,
      started: Date.now(), promptSha256: sha(payload.prompt), executableSha256: executable.sha256 };
    const native = spawn(executable.path, args, { cwd: directory, env: nativeChildEnvironment("claude"), stdio: ["pipe", "pipe", "pipe"] });
    active.add(native); call.pid = native.pid; calls.push(call);
    console.log(JSON.stringify({ type: "native-start", ...call }));
    let stdout = "", stderr = "";
    native.stdout.on("data", bytes => { stdout += bytes; });
    native.stderr.on("data", bytes => { stderr += bytes; });
    native.stdin.end(payload.prompt);
    const code = await new Promise((yes, no) => { native.on("error", no); native.on("close", yes); });
    active.delete(native); Object.assign(call, { ended: Date.now(), code });
    save(`${key}-native.json`, { ...call, stdout, stderr });
    const envelope = code === 0 ? JSON.parse(stdout) : null;
    if (code !== 0 || envelope.is_error) {
      result = { status: "unavailable", client: "claude-code", model: payload.route.model, effort: payload.route.effort,
        error: envelope?.result ?? (stderr || `exit=${code}`) };
    } else {
      const output = envelope.structured_output ?? JSON.parse(envelope.result);
      result = workerOutput({ ...output, status: "completed", client: "claude-code", workerId: envelope.session_id,
        model: payload.route.model, effort: payload.route.effort }, payload.route, payload.files.map(file => file.path));
      call.workerId = result.workerId; call.verdict = result.verdict;
    }
    console.log(JSON.stringify({ type: "native-end", ...call }));
  } else {
    assert.equal(action, "root-apply");
    assert.ok(payload.root.startsWith(join(repository, "target/engineering-delivery/candidates/source-")));
    assert.equal(realpathSync(payload.root), payload.root);
    const task = spec.entries.find(entry => entry.spec.taskId === request.taskId).spec;
    for (const change of payload.changes) {
      assert.ok(task.paths.includes(change.path));
      const target = resolve(payload.root, change.path);
      assert.equal(realpathSync(dirname(target)), dirname(target));
      assert.ok(lstatSync(target).isFile());
      assert.equal(readFileSync(target, "utf8"), payload.beforeFiles.find(file => file.path === change.path).content);
      writeFileSync(target, change.content);
    }
    result = { writer: "root", applied: true, root: payload.root };
  }
  const response = { ...identity, result };
  save(`${request.runId}-${request.requestId}-reply.json`, response);
  child.stdin.write(JSON.stringify(response) + "\n");
};
const lines = createInterface({ input: child.stdout });
const stop = () => { child.kill("SIGTERM"); for (const native of active) native.kill("SIGTERM"); };
const fail = error => { failed ??= error; stop(); child.stdin.end(); };
lines.on("line", line => {
  try {
  const message = JSON.parse(line); console.log(line);
  if (message.type !== "host-request") { if (message.type !== "lane-settled") final = message; return; }
  const request = JSON.parse(readFileSync(message.path, "utf8"));
  const job = respond(request).catch(fail).finally(() => pending.delete(job));
  pending.add(job);
  } catch (error) { fail(error); }
});
process.on("SIGTERM", stop); process.on("SIGINT", stop);
const code = await new Promise((yes, no) => { child.on("error", no); child.on("close", yes); });
await Promise.allSettled([...pending]); clearInterval(timer); capacity(); lines.close();
const authors = calls.filter(call => call.role === "implement");
const overlapMs = authors.length >= 2 ? Math.max(0, Math.min(...authors.map(call => call.ended)) - Math.max(...authors.map(call => call.started))) : 0;
save("proof.json", { code, calls, overlapMs, final, canonicalSourceUnchanged: JSON.stringify(before) === JSON.stringify(sourceObservation()),
  acceptedSourceHandoff: false, failure: failed?.message ?? null });
console.log(JSON.stringify({ directory, code, overlapMs, acceptedSourceHandoff: false }));
if (failed) throw failed;
assert.equal(code, 0); assert.ok(overlapMs > 0); assert.equal(final.status, "ready-for-owner-review");
assert.deepEqual(sourceObservation(), before);
