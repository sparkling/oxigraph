import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { admitCommand, bindBuildArtifact, deliveryStatus, evaluateResult, routeDelivery, runDelivery, sourceObservation } from "../src/delivery.mjs";
import { execute } from "../../agentic-qe/process-runner.mjs";

const taskId = "task-delivery-test";
const completionCheck = "focused native assertions pass";
test("source drift or missing process observation prevents command success", () => {
  const before = { head: "a", trackedDiffSha256: "b", untracked: [{ path: "new.rs", sha256: "c" }] };
  assert.equal(deliveryStatus(before, before, { passed: true }, null).status, "command-passed");
  for (const after of [null, { ...before, head: "changed" }, { ...before, untracked: [] }]) {
    assert.equal(deliveryStatus(before, after, { passed: true }, null).status, "failed");
  }
  assert.equal(deliveryStatus(before, before, null, null).status, "failed");
  assert.equal(deliveryStatus(before, before, { passed: true }, "cannot read artifact").status, "failed");
});
test("routine role models are explicit and do not inherit coordinator Max", () => {
  for (const [role, model, effort] of [
    ["implement", "gpt-5.6-terra", "medium"], ["documentation", "gpt-5.6-luna", "low"],
    ["review", "gpt-5.6-sol", "medium"], ["difficult", "gpt-5.6-sol", "high"],
    ["decision", "gpt-6-astra", "high"],
  ]) {
    const route = routeDelivery({ role, taskId, completionCheck });
    assert.equal(route.model, model);
    assert.equal(route.effort, effort);
    assert.equal(route.nativeDispatch.fork_turns, "none");
    assert.equal(route.status, "planned-not-dispatched");
    assert.equal(route.ownerConversationChanged, false);
  }
});
test("builds and tests do not invoke a model; overrides require exact selection and reason", () => {
  for (const role of ["build", "test"]) {
    assert.equal(routeDelivery({ role, taskId, completionCheck }).nativeDispatch, null);
    assert.throws(() => routeDelivery({ role, taskId, completionCheck, model: "gpt-6-astra", effort: "max", reason: "owner" }));
  }
  for (const effort of ["max", "ultra"]) {
    assert.throws(() => routeDelivery({ role: "review", taskId, completionCheck, model: "gpt-6-astra", effort }));
    assert.throws(() => routeDelivery({ role: "review", taskId, completionCheck, model: "gpt-6-astra", effort, reason: "just because" }));
    assert.equal(routeDelivery({ role: "review", taskId, completionCheck, model: "gpt-6-astra", effort, reason: "owner selected this bounded review", selection: "owner" }).effort, effort);
  }
  assert.throws(() => routeDelivery({ role: "review", taskId, completionCheck, model: "not-a-model", effort: "high", reason: "test" }));
  assert.throws(() => routeDelivery({ role: "unknown", taskId, completionCheck }));
  assert.throws(() => routeDelivery({ role: "review", taskId }));
});
test("a stale artifact without this command's Cargo event cannot be attributed", () => {
  const path = "/checkout/target/release/oxigraph";
  const command = { kind: "build" };
  const event = { reason: "compiler-artifact", executable: path,
    target: { name: "oxigraph" }, package_id: "oxigraph-cli", fresh: true };
  assert.throws(() => bindBuildArtifact(command, "", path));
  assert.throws(() => bindBuildArtifact(command, JSON.stringify({ ...event, executable: "/other" }), path));
  assert.throws(() => bindBuildArtifact(command, [event, event].map(JSON.stringify).join("\n"), path));
  assert.throws(() => bindBuildArtifact({ kind: "cargo-test" }, JSON.stringify(event), path));
  assert.equal(bindBuildArtifact(command, JSON.stringify(event), path).cargoFresh, true);
  assert.equal(bindBuildArtifact(command, JSON.stringify({ ...event, fresh: false }), path).cargoFresh, false);
});
test("runs require a completion check and reject artifact/command mismatches before execution", async () => {
  await assert.rejects(runDelivery({ taskId, argv: ["cargo", "check", "--locked", "-p", "oxrdf"] }), /completion check/);
  for (const argv of [
    ["cargo", "test", "--locked", "-p", "oxigraph"],
    ["cargo", "build", "--locked", "--release", "-p", "oxrdf"],
    ["cargo", "build", "--locked", "-p", "oxigraph-cli"],
  ]) await assert.rejects(runDelivery({ taskId, completionCheck, argv, artifact: "target/release/oxigraph" }), /Artifact must match/);
});
test("literal native commands are admitted; broad or protected entry points are rejected", () => {
  assert.equal(admitCommand(["cargo", "test", "--locked", "-p", "oxigraph", "--test", "store", "-j12"]).kind, "cargo-test");
  assert.equal(admitCommand(["cargo", "build", "--locked", "--release", "-p", "oxigraph-cli"]).kind, "build");
  assert.equal(admitCommand(["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/delivery.test.mjs"]).kind, "node-test");
  for (const argv of [
    ["cargo", "test"], ["cargo", "publish", "--locked"], ["cargo", "test", "--locked", "--config", "x=y"],
    ["cargo", "test", "--locked", "--", "--list"], ["cargo", "test", "--locked", "--manifest-path", "elsewhere/Cargo.toml"],
    ["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/g17-qualification-cli.test.mjs"],
    ["node", "--eval", "process.exit(0)"], ["npm", "test"], ["sh", "-c", "true"], ["ruflo", "status"],
    ["cargo", "test", "--locked\n"],
  ]) assert.throws(() => admitCommand(argv), JSON.stringify(argv));
});
test("source observations require main and bind untracked source as well as HEAD", () => {
  const source = sourceObservation();
  assert.equal(source.branch, "main");
  assert.match(source.head, /^[a-f0-9]{40}$/);
  assert.match(source.trackedDiffSha256, /^[a-f0-9]{64}$/);
  assert.ok(source.untracked.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});
async function fixture(code, options = {}) {
  return execute(process.execPath, ["--eval", code], { quiet: true, announce: false, timeoutMs: 5000, ...options });
}
test("exit zero with no tests is not a passing test run", async () => {
  const result = await fixture("process.stdout.write('finished\\n')");
  assert.equal(evaluateResult({ kind: "cargo-test" }, result).passed, false);
  assert.equal(evaluateResult({ kind: "node-test" }, result).passed, false);
});
test("native failure remains a failed build even if it prints a passing test summary", async () => {
  const result = await fixture("console.log('test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s'); process.exitCode=1");
  assert.equal(evaluateResult({ kind: "cargo-test" }, result).passed, false);
  assert.equal(evaluateResult({ kind: "build" }, result).passed, false);
});
test("terminal successful Cargo output is counted, trailing junk and zero tests fail", async () => {
  const summary = "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s";
  const success = evaluateResult({ kind: "cargo-test" }, await fixture(`console.log(${JSON.stringify(summary)})`));
  assert.equal(success.passed, true);
  assert.equal(success.observedPassedTests, 1);
  const trailing = await fixture(`console.log(${JSON.stringify(summary)}); console.log('not a terminal summary')`);
  assert.equal(evaluateResult({ kind: "cargo-test" }, trailing).passed, false);
  const zero = await fixture(`console.log(${JSON.stringify(summary.replace("1 passed", "0 passed"))})`);
  assert.equal(evaluateResult({ kind: "cargo-test" }, zero).passed, false);
});
test("timeout and output overflow never turn into successful completion", async () => {
  for (const [code, options, reason] of [
    ["setInterval(()=>{},1000)", { timeoutMs: 100, terminationGraceMs: 50 }, "timeout"],
    ["process.stdout.write('x'.repeat(65536)); setInterval(()=>{},1000)", { captureOutputBytes: 1024, terminationGraceMs: 50 }, "output-limit"],
  ]) {
    await assert.rejects(fixture(code, options), (error) => {
      assert.equal(error.code, "PROCESS_CLEANUP_UNCONFIRMED");
      assert.equal(error.processResult.terminationReason, reason);
      assert.equal(evaluateResult({ kind: "build" }, error.processResult).passed, false);
      return true;
    });
  }
});
test("CLI route is inspectable without any model execution; invalid run rejects before spawn", () => {
  const cli = "tools/engineering-harness/bin/oxigraph-delivery.mjs";
  const route = JSON.parse(execFileSync(process.execPath, [cli, "route", "--task", taskId,
    "--role", "implement", "--check", completionCheck], { encoding: "utf8" }));
  assert.equal(route.nativeDispatch.model, "gpt-5.6-terra");
  assert.throws(() => execFileSync(process.execPath, [cli, "run", "--task", taskId, "--", "cargo", "publish", "--locked"], { stdio: "pipe" }));
});
