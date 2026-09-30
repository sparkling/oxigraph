// Explicit opt-in live harness proof. Never starts application or cloud work.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, realpathSync, lstatSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { availableParallelism, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { repository, sourceObservation } from "../../src/delivery.mjs";
import { runOrdinaryNativeRequest } from "../../src/native/ordinary-host.mjs";
import { digest, readWorkflowFiles, verifyJsonReference } from "../../src/workflow.mjs";
import { assertNativeBatchProofCustody } from "./native-batch-proof-custody.mjs";

if (process.argv[2] !== "--run") throw new Error("Live native execution requires explicit --run");
const proveAcceptedChild = process.argv[3] === "--accepted-source-child";
if (process.argv.length > (proveAcceptedChild ? 4 : 3)) throw new Error("Unknown proof option");
const before = sourceObservation();
const directory = mkdtempSync(join(repository, "target/engineering-delivery/native-batch-proof-"));
const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const tasks = [
  ["pool-observer", "tools/engineering-harness/test/ordinary-pool.test.mjs",
    "Append a focused regression proving null onSettled rejects with /onSettled must be a callback/ BEFORE any executor callback. Use existing pair helper. Existing true regression remains. Preserve every existing test."],
  ["route-binding", "tools/engineering-harness/test/workflow-policy.test.mjs",
    "Append a focused regression proving a native implementation result with mismatched effort is rejected with /Native route\\/result mismatch/ BEFORE root-apply and checks. Use existing setup, spec, updateNativeResults helpers and counters. Change result.effort to medium only during implement role. Existing model mismatch regression remains. Preserve every existing test."],
];
const spec = { schema: 1, maxConcurrency: 2, entries: tasks.map(([id, path, goal]) => ({
  id, resources: [], spec: { schema: 1, taskId: `task-native-batch-${id}`, scope: "harness",
    goal, completionCheck: "Useful added regression and all existing file tests pass; independent fresh review accepts exact change.",
    paths: [path], checks: [{ completionCheck: "Changed test file passes", argv: ["node", "--test", "--test-reporter=tap", path] }] },
})) };
save("spec.json", spec); save("initial-source.json", before);
save("runtime.json", { schema: 1, memoryDirectory: relative(repository, join(directory, "native-outcomes")) });
const calls = [], pending = new Set();
let failed, final, priorCpu, acceptedSourceChild;
const capacity = () => {
  const fields = readFileSync("/proc/stat", "utf8").split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const current = { total: fields.reduce((a, b) => a + b, 0), idle: fields[3] + fields[4] };
  const sample = { type: "capacity", at: Date.now(), effectiveCpuCount: availableParallelism(),
    vmstat: execFileSync("vmstat", ["1", "2"], { encoding: "utf8" }).trim(),
    load: readFileSync("/proc/loadavg", "utf8").trim(),
    ...(priorCpu ? { intervalIdlePercent: 100 * (current.idle - priorCpu.idle) / (current.total - priorCpu.total) } : {}),
    psi: Object.fromEntries(["cpu", "memory", "io"].map(name => [name, readFileSync(`/proc/pressure/${name}`, "utf8").trim()])) };
  priorCpu = current; save(`capacity-${sample.at}.json`, sample); console.log(JSON.stringify(sample));
};
capacity(); const timer = setInterval(capacity, 30000);
const child = spawn(process.execPath, ["tools/engineering-harness/bin/oxigraph-delivery.mjs", "batch", "--spec", join(directory, "spec.json"),
  "--runtime-config", join(directory, "runtime.json"), "--coordination-unavailable", "No Oxigraph-scoped structured MCP connection in this execution host", "--owner-review-hold", "true"],
{ cwd: repository, stdio: ["pipe", "pipe", "pipe"] });
console.log(JSON.stringify({ directory, batchPid: child.pid, model: "gpt-6.1-sol", effort: "high" }));
child.stderr.on("data", bytes => process.stderr.write(bytes));
const respond = async request => {
  const { action, payload, ...identity } = request;
  let result;
  if (action === "native-worker") {
    const key = `${request.runId}-${request.requestId}`;
    const call = { key, taskId: request.taskId, role: payload.route.role, model: payload.route.model, effort: payload.route.effort,
      started: Date.now(), promptSha256: sha(payload.prompt) };
    calls.push(call);
    const native = await runOrdinaryNativeRequest({ request, requestPath: join(directory, `${key}-request.json`),
      prompt: payload.prompt, directory: join(directory, `${key}-native`), driverUrl: new URL(import.meta.url),
      observation: event => {
        if (event.type === "native-start") Object.assign(call, { pid: event.pid, client: event.client,
          executableSha256: event.executableSha256, executionRoot: event.executionRoot });
        console.log(JSON.stringify(event));
      } });
    Object.assign(call, { ended: Date.now(), code: native.terminal.exitCode,
      custodyReleased: native.terminal.custodyReleased, status: native.status });
    if (!native.response) throw new Error(`Native execution failed: ${native.failure?.classification}; evidence retained`);
    result = native.response.result;
    Object.assign(call, { workerId: result.workerId, verdict: result.verdict });
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
const stop = () => child.kill("SIGTERM");
const fail = error => { failed ??= error; process.emit("SIGTERM"); child.stdin.end(); };
lines.on("line", line => {
  try {
  const message = JSON.parse(line); console.log(line);
  if (message.type !== "host-request") { if (message.type !== "lane-settled") final = message; return; }
  const request = JSON.parse(readFileSync(message.path, "utf8"));
  save(`${request.runId}-${request.requestId}-request.json`, request);
  const job = respond(request).catch(fail).finally(() => pending.delete(job));
  pending.add(job);
  } catch (error) { fail(error); }
});
process.on("SIGTERM", stop); process.on("SIGINT", stop);
const code = await new Promise((yes, no) => { child.on("error", no); child.on("close", yes); });
await Promise.allSettled([...pending]); clearInterval(timer); capacity(); lines.close();
const authors = calls.filter(call => call.role === "implement");
const overlapMs = authors.length >= 2 ? Math.max(0, Math.min(...authors.map(call => call.ended)) - Math.max(...authors.map(call => call.started))) : 0;
if (!failed && code === 0) {
  try { assertNativeBatchProofCustody(final); }
  catch (error) { failed = error; }
}

// Reuse the existing owner-handoff fixture: only its private main receives accepted
// bytes. This is source-consumption proof, not application or canonical acceptance.
if (!failed && code === 0 && final.status === "ready-for-owner-review" && proveAcceptedChild) {
  const childTimer = setInterval(capacity, 30000);
  try {
    assert.deepEqual(sourceObservation(), before);
    assert.ok(calls.every(call => call.custodyReleased));
    const fixture = mkdtempSync(join(tmpdir(), "oxigraph-native-accepted-source-"));
    cpSync(join(repository, "tools"), join(fixture, "tools"), { recursive: true,
      filter: path => !path.split("/").some(part => ["node_modules", "target", ".runtime", ".git"].includes(part)) });
    symlinkSync(realpathSync(join(repository, "tools/engineering-harness/node_modules")),
      join(fixture, "tools/engineering-harness/node_modules"), "dir");
    writeFileSync(join(fixture, ".gitignore"), "target/\nnode_modules/\n");
    const git = (...args) => execFileSync("git", args, { cwd: fixture, encoding: "utf8", stdio: "pipe" }).trim();
    const commit = message => git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
      "-c", "commit.gpgsign=false", "commit", "-m", message);
    git("init", "-b", "main"); git("add", "."); commit("fixture initial source");
    const acceptedFiles = [];
    for (const lane of final.results) {
      const entry = spec.entries.find(entry => entry.id === lane.id);
      assert.ok(entry);
      assert.equal(lane.status, "fulfilled");
      assert.equal(lane.value.integration, "pending-owner-acceptance");
      assert.equal(lane.value.taskId, entry.spec.taskId);
      assert.equal(lane.value.specSha256, digest(entry.spec));
      assert.deepEqual(lane.value.base, before);
      assert.equal(lane.value.source.root, lane.candidateRoot);
      assert.deepEqual(lane.value.source.base, before);
      assert.equal(lane.value.review.verdict, "ACCEPT");
      assert.ok(!lane.value.implementationWorkerIds.includes(lane.value.review.workerId));
      assert.equal(lane.value.checks.length, entry.spec.checks.length);
      assert.ok(lane.value.checks.every(check => check.status === "command-passed" && check.code === 0));
      for (const reference of [...lane.value.eventReferences, ...lane.value.checkReferences]) {
        assert.equal(verifyJsonReference(reference, undefined, lane.candidateRoot), true);
      }
      for (const check of lane.value.checks) {
        const reference = lane.value.checkReferences[check.referenceIndex];
        const record = JSON.parse(readFileSync(reference.path, "utf8"));
        assert.equal(record.taskId, entry.spec.taskId);
        assert.equal(record.result.code, 0);
        assert.equal(record.result.passed, true);
        assert.equal(record.sourceStable, true);
        assert.deepEqual(record.source, lane.value.source);
        assert.deepEqual(record.sourceAfter, lane.value.source);
        assert.equal(check.sourceSha256, digest(record.source));
        assert.deepEqual(check.command, record.command);
        assert.equal(check.resultSha256, digest({ directory: dirname(reference.path), ...record }));
      }
      const events = lane.value.eventReferences.map(reference => JSON.parse(readFileSync(reference.path, "utf8")));
      const review = events.findLast(event => event.request.payload.route?.role === "review");
      assert.equal(review.result.workerId, lane.value.review.workerId);
      assert.equal(review.result.verdict, "ACCEPT");
      assert.equal(review.request.sourceSha256, digest(lane.value.source));
      assert.deepEqual(review.request.payload.files, readWorkflowFiles(entry.spec.paths, lane.candidateRoot));
      const path = entry.spec.paths[0];
      const content = readFileSync(join(lane.candidateRoot, path), "utf8");
      assert.notEqual(content, readFileSync(join(fixture, path), "utf8"));
      writeFileSync(join(fixture, path), content);
      acceptedFiles.push({ path, content, sha256: sha(content) });
    }
    const validation = execFileSync(process.execPath, ["--test", "--test-reporter=tap",
      ...acceptedFiles.map(file => file.path)], { cwd: fixture, encoding: "utf8" });
    git("add", ...acceptedFiles.map(file => file.path)); commit("fixture owner accepts reviewed native source");
    const acceptedHead = git("rev-parse", "HEAD");
    save("fixture-owner-acceptance.json", { scope: "isolated-fixture-only", fixture, acceptedHead,
      files: acceptedFiles.map(({ content, ...file }) => file), validation, validationSha256: sha(validation) });
    const { createOrdinaryWorkspace } = await import(pathToFileURL(join(fixture, "tools/engineering-harness/src/ordinary-workspace.mjs")));
    const { routeDelivery } = await import(pathToFileURL(join(fixture, "tools/engineering-harness/src/delivery.mjs")));
    const snapshot = createOrdinaryWorkspace();
    assert.equal(snapshot.base.head, acceptedHead);
    assert.ok(acceptedFiles.every(file => readFileSync(join(snapshot.root, file.path), "utf8") === file.content));
    const expectedSummary = "OXIGRAPH_ACCEPTED_SOURCE_CHILD_READY";
    const request = { schema: 1, runId: randomUUID(), requestId: 1, taskId: "task-native-accepted-source-child",
      specSha256: digest(spec), sourceSha256: digest(snapshot.observe()), action: "native-worker",
      payload: { route: routeDelivery({ role: "review", taskId: "task-native-accepted-source-child",
        completionCheck: "Dependent worker identifies exact fixture-accepted parent regressions" }),
        files: snapshot.files(acceptedFiles.map(file => file.path)) } };
    const requestPath = join(directory, "accepted-source-child-request.json");
    writeFileSync(requestPath, JSON.stringify(request), { flag: "wx", mode: 0o600 });
    const prompt = `Read exact accepted parent files below. Confirm null onSettled rejects before executor calls and medium-effort implementation result rejects before root application/checks. Return summary ${expectedSummary}, verdict ACCEPT, findings [], changes [] only when both regressions exist. Otherwise return REJECT with findings. This is read-only fixture-source consumption, not product acceptance.\n${JSON.stringify(request.payload.files)}`;
    const observed = snapshot.observe();
    const native = await runOrdinaryNativeRequest({ request, requestPath, prompt,
      directory: join(directory, "accepted-source-child-native"), driverUrl: new URL(import.meta.url) });
    assert.equal(native.status, "completed");
    assert.equal(native.response.result.verdict, "ACCEPT");
    assert.equal(native.response.result.summary, expectedSummary);
    assert.ok(!calls.some(call => call.workerId === native.response.result.workerId));
    assert.equal(native.terminal.custodyReleased, true);
    assert.deepEqual(snapshot.observe(), observed);
    acceptedSourceChild = { scope: "isolated-fixture-only", fixture, acceptedHead, childRoot: snapshot.root,
      sourceSha256: observed.sourceSha256, sourceIdentitySha256: request.sourceSha256, workerId: native.response.result.workerId,
      model: native.response.result.model, effort: native.response.result.effort, pid: native.terminal.pid,
      custodyReleased: true, files: acceptedFiles.map(({ content, ...file }) => file) };
  } catch (error) { failed = error; }
  finally { clearInterval(childTimer); capacity(); }
}
const acceptedSourceHandoff = acceptedSourceChild !== undefined;
save("proof.json", { code, calls, overlapMs, final, canonicalSourceUnchanged: JSON.stringify(before) === JSON.stringify(sourceObservation()),
  acceptedSourceHandoff, acceptedSourceChild, nativeCustodyReleased: calls.every(call => call.custodyReleased), failure: failed?.message ?? null });
console.log(JSON.stringify({ directory, code, overlapMs, acceptedSourceHandoff }));
if (failed) throw failed;
assert.equal(code, 0); assert.ok(overlapMs > 0); assert.equal(final.status, "ready-for-owner-review");
assert.ok(calls.every(call => call.custodyReleased));
assert.deepEqual(sourceObservation(), before);
