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
test("routine role models use Opus on gateway-qualified native Claude", () => {
  for (const [role, model, effort] of [
    ["implement", "cc/claude-opus-5", "xhigh"], ["documentation", "cc/claude-opus-5", "low"],
    ["review", "cc/claude-opus-5", "high"], ["difficult", "cc/claude-opus-5", "xhigh"],
    ["decision", "cc/claude-opus-5", "max"],
  ]) {
    const route = routeDelivery({ role, taskId, completionCheck });
    assert.equal(route.model, model);
    assert.equal(route.effort, effort);
    assert.deepEqual(route.nativeDispatch, { provider: "claude", model, effort });
    assert.equal(route.selection, "role-policy");
    assert.equal(route.status, "planned-not-dispatched");
    assert.equal(route.ownerConversationChanged, false);
  }
});
test("no gpt/Codex model and no unqualified alias can route on any model-bearing role", () => {
  for (const role of ["implement", "documentation", "review", "difficult", "decision"]) {
    for (const model of [
      "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-6-astra", "cc/gpt-6-astra",
      "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5", "claude-haiku-4-5",
      "cc/claude-haiku-4-5", "cc/claude-fable-5-1", "opus", "fable", "sonnet", "cc/",
    ]) {
      assert.throws(() => routeDelivery({ role, taskId, completionCheck, model, effort: "high",
        reason: "routes must stay on the verified 9router Claude IDs" }), `${role}/${model}`);
      assert.throws(() => routeDelivery({ role, taskId, completionCheck, model, effort: "max",
        reason: "owner escalation", selection: "owner" }), `${role}/${model}/max`);
    }
  }
});
test("supported gateway efforts are low..max, Ultra is rejected, explicit Max needs owner selection", () => {
  for (const model of ["cc/claude-opus-5", "cc/claude-sonnet-5"]) {
    for (const effort of ["low", "medium", "high", "xhigh"]) {
      const route = routeDelivery({ role: "implement", taskId, completionCheck, model, effort,
        reason: "bounded native Claude implementation" });
      assert.deepEqual(route.nativeDispatch, { provider: "claude", model, effort });
    }
    assert.equal(routeDelivery({ role: "review", taskId, completionCheck, model, effort: "max",
      reason: "owner selected this bounded review", selection: "owner" }).effort, "max");
    assert.throws(() => routeDelivery({ role: "review", taskId, completionCheck, model, effort: "max", reason: "unselected max" }), model);
    assert.throws(() => routeDelivery({ role: "review", taskId, completionCheck, model, effort: "ultra", reason: "owner", selection: "owner" }), model);
  }
});
test("builds and tests do not invoke a model; overrides require exact selection and reason", () => {
  for (const role of ["build", "test"]) {
    assert.equal(routeDelivery({ role, taskId, completionCheck }).nativeDispatch, null);
    assert.throws(() => routeDelivery({ role, taskId, completionCheck, model: "cc/claude-opus-5", effort: "max", reason: "owner", selection: "owner" }));
  }
  assert.equal(routeDelivery({ role: "decision", taskId, completionCheck }).selection, "role-policy");
  assert.throws(() => routeDelivery({ role: "review", taskId, completionCheck, model: "cc/claude-opus-5", effort: "max" }));
  assert.throws(() => routeDelivery({ role: "review", taskId, completionCheck, model: "cc/claude-opus-5", effort: "max", reason: "just because" }));
  assert.throws(() => routeDelivery({ role: "decision", taskId, completionCheck, model: "cc/claude-opus-5", effort: "max", reason: "decision escalation" }));
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
  assert.equal(admitCommand([
    "cargo", "test", "--locked", "-p", "oxigraph", "--lib", "--features", "rdf-12",
    "storage::rocksdb::format_inspection_tests::rdf_12_writer_retained_history_is_reported_unsupported_by_no_default_cli",
    "-j", "12", "--", "--ignored", "--exact",
  ]).kind, "cargo-test");
  assert.equal(admitCommand(["cargo", "build", "--locked", "--release", "-p", "oxigraph-cli"]).kind, "build");
  assert.equal(admitCommand(["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/delivery.test.mjs"]).kind, "node-test");
  assert.equal(admitCommand(["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/workflow-policy.test.mjs"]).kind, "node-test");
  assert.equal(admitCommand(["node", "--test", "--test-reporter=tap", "tools/evidence/verify-programme.test.mjs"]).kind, "node-test");
  assert.equal(admitCommand(["node", "--test", "--test-reporter=tap", "tools/evidence/receipt-evidence.test.mjs", "tools/evidence/adr-prereview.test.mjs", "tools/shacl-tests/hidden-entries.test.mjs"]).kind, "node-test");
  for (const argv of [
    ["cargo", "test"], ["cargo", "publish", "--locked"], ["cargo", "test", "--locked", "--config", "x=y"],
    ["cargo", "test", "--locked", "--", "--list"], ["cargo", "test", "--locked", "--", "--unknown"],
    ["cargo", "test", "--locked", "--ignored"], ["cargo", "test", "--locked", "--manifest-path", "elsewhere/Cargo.toml"],
    ["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/g17-qualification-cli.test.mjs"],
    ["node", "--test", "--test-reporter=tap", "tools/engineering-harness/test/support/ordinary-workflow-fixture.mjs"],
    ["node", "--eval", "process.exit(0)"], ["npm", "test"], ["sh", "-c", "true"], ["ruflo", "status"],
    ["cargo", "test", "--locked\n"],
  ]) assert.throws(() => admitCommand(argv), JSON.stringify(argv));
});
test("SHACL evidence checks admit only exact literal Node entry points", () => {
  for (const path of [
    "tools/shacl-tests/run.mjs",
    "tools/shacl-tests/clause-audit.mjs",
    "tools/shacl-tests/jena-compact.mjs",
  ]) {
    const command = admitCommand(["node", path]);
    assert.deepEqual(command, { program: process.execPath, args: [path], kind: "evidence-check" });
  }
  assert.deepEqual(
    admitCommand(["node", "tools/evidence/verify-programme.mjs", "--source-only"]),
    { program: process.execPath, args: ["tools/evidence/verify-programme.mjs", "--source-only"], kind: "evidence-check" },
  );
  for (const argv of [
    ["node", "tools/shacl-tests/run.mjs", "--extra"],
    ["node", "/tmp/run.mjs"],
    ["node", "tools/shacl-tests/arbitrary.mjs"],
    ["node", "tools/shacl-tests/run-copy.mjs"],
    ["node", "tools/shacl-tests/../shacl-tests/run.mjs"],
    ["node", "tools/shacl-tests/inventory.mjs"],
    ["node", "tools/evidence/verify-programme.mjs"],
    ["node", "tools/evidence/verify-programme.mjs", "--full"],
    ["node", "tools/evidence/verify-programme.mjs", "--root"],
    ["node", "tools/evidence/verify-programme.mjs", "--source-only", "--extra"],
  ]) assert.throws(() => admitCommand(argv), JSON.stringify(argv));
});
test("evidence checks retain generic process-success evaluation", () => {
  const result = evaluateResult({ kind: "evidence-check" }, {
    code: 0, signal: null, spawnError: null, timedOut: false,
    cleanupUnconfirmed: false, outputLimitExceeded: false, scanLimitExceeded: false,
  });
  assert.equal(result.passed, true);
  assert.equal(Object.hasOwn(result, "testSafeguard"), false);
  assert.equal(Object.hasOwn(result, "observedPassedTests"), false);
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
  assert.deepEqual(route.nativeDispatch, { provider: "claude", model: "cc/claude-opus-5", effort: "xhigh" });
  assert.throws(() => execFileSync(process.execPath, [cli, "run", "--task", taskId, "--", "cargo", "publish", "--locked"], { stdio: "pipe" }));
});

test("reviewed format commands are exact check-only invocations", () => {
  assert.equal(admitCommand(["cargo", "fmt", "--all", "--", "--check"]).kind, "format");
  assert.equal(admitCommand(["cargo", "fmt", "-p", "oxrdf", "--", "--check"]).kind, "format");
  assert.equal(admitCommand(["cargo", "fmt", "--package", "oxigraph-cli", "--", "--check"]).kind, "format");
  for (const argv of [
    ["cargo", "fmt", "--all"], ["cargo", "fmt", "--all", "--", "--check", "--verbose"],
    ["cargo", "fmt", "-p", "oxrdf"], ["cargo", "fmt", "--all", "-p", "oxrdf", "--", "--check"],
    ["cargo", "fmt", "--manifest-path", "elsewhere/Cargo.toml", "--", "--check"],
  ]) assert.throws(() => admitCommand(argv), JSON.stringify(argv));
});

test("only listed exact one-minute libFuzzer commands are admitted", () => {
  const targets = [
    "nquads", "trig", "n3", "rdf_xml", "jsonld", "sparql_query",
    "sparql_update", "sparql_query_eval", "sparql_update_eval",
    "sparql_results_json", "sparql_results_tsv", "sparql_results_xml",
  ];
  for (const target of targets) {
    assert.equal(admitCommand(["cargo", "fuzz", "run", target, "--sanitizer", "none", "--", "-max_total_time=60"]).kind, "cargo-fuzz");
  }
  for (const argv of [
    ["cargo", "fuzz", "run", "unknown", "--sanitizer", "none", "--", "-max_total_time=60"],
    ["cargo", "fuzz", "run", "nquads", "--sanitizer", "address", "--", "-max_total_time=60"],
    ["cargo", "fuzz", "run", "nquads", "--sanitizer", "none", "--", "-max_total_time=30"],
    ["cargo", "fuzz", "run", "nquads", "--sanitizer", "none", "--", "-max_total_time=60", "-runs=1"],
  ]) assert.throws(() => admitCommand(argv), JSON.stringify(argv));
});

test("fuzz success requires positive terminal libFuzzer execution evidence", () => {
  const base = {
    code: 0, signal: null, spawnError: null, timedOut: false, cleanupUnconfirmed: false,
    outputLimitExceeded: false, scanLimitExceeded: false, stdoutTail: "",
  };
  const good = evaluateResult({ kind: "cargo-fuzz" }, {
    ...base,
    stderrTail: "INFO: Running with entropic power schedule (0xFF, 100).\n#12 DONE cov: 7 ft: 9 corp: 1/1b lim: 4 exec/s: 12 rss: 20Mb\nDone 12 runs in 60 second(s)\n",
  });
  assert.equal(good.passed, true);
  assert.equal(good.fuzzSafeguard.executedUnits, 12);
  const terminal = "#8113101 DONE cov: 7 ft: 9 corp: 1/1b lim: 4 exec/s: 12 rss: 20Mb\nDone 8113101 runs in 61 second(s)\n";
  const long = evaluateResult({ kind: "cargo-fuzz" }, {
    ...base, stderrTail: `x${"x".repeat(65535)}\n${terminal}`,
  }, {
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(`INFO: Running with entropic power schedule (0xFF, 100).\n${"x".repeat(70000)}\n${terminal}`),
  });
  assert.equal(long.passed, true);
  assert.equal(long.fuzzSafeguard.executedUnits, 8113101);
  assert.equal(Object.hasOwn(long, "capturedOutput"), false);
  for (const stderrTail of [
    "", "Done 0 runs in 60 second(s)\n", "Done 12 runs in 60 second(s)\n",
    "INFO: Running with entropic power schedule\nDone 12 runs in 60 second(s)\ntrailing",
  ]) {
    assert.equal(evaluateResult({ kind: "cargo-fuzz" }, { ...base, stderrTail }).passed, false);
  }
});
