import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import test from "node:test";
import { makeSigner } from "@metaharness/flywheel";
import { canonicalSha256 } from "../src/routing/features.mjs";
import { repository, routeDelivery } from "../src/delivery.mjs";
import { runWorkflow } from "../src/workflow.mjs";
import { ordinaryMemory } from "../src/ordinary-memory.mjs";
import { createOrdinaryRuntime, ordinaryRuntimeBinding } from "../src/ordinary-runtime.mjs";
import { seedOrdinaryPolicy, produceOrdinaryPolicy, activateOrdinaryPolicy, readOrdinaryPolicy, rollbackOrdinaryPolicy, ordinaryPromotionRule } from "../src/ordinary-policy.mjs";
import { ordinaryPolicyEvaluator } from "../src/ordinary-policy-evaluator.mjs";
import { ordinaryWorkflowSpec, setupOrdinaryWorkflowFixture } from "./support/ordinary-workflow-fixture.mjs";

const nativeSpec = (id = "native") => ({ ...ordinaryWorkflowSpec, taskId: `task-${id}`,
  implement: { model: "cc/claude-opus-5-5[1m]", effort: "high", reason: "Fixture pinned native route" },
  review: { model: "cc/claude-opus-5-5[1m]", effort: "high", reason: "Fixture independent native reviewer" },
});
const configFor = (directory) => ({ schema: 1, memoryDirectory: `target/engineering-delivery/fixtures/${basename(directory)}` });

test("unpinned ordinary planning, author and fresh review use Sonnet 5.5 and retain native learning", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-sonnet-")), config = configFor(directory);
  const fixture = setupOrdinaryWorkflowFixture(), routes = [], workers = [];
  try {
    const result = await runWorkflow(ordinaryWorkflowSpec, async (request) => {
      const response = await fixture.host(request);
      if (request.action === "native-worker") {
        routes.push(request.payload.route); workers.push(response.result.workerId);
      }
      return response;
    }, { ...fixture.io, runtime: createOrdinaryRuntime(config) });
    assert.deepEqual(routes.map(({ role, model, effort, transport }) => [role, model, effort, transport]),
      ["plan", "implement", "review"].map(role => [role, "cc/claude-sonnet-5-5[1m]", "high", "native-subscription"]));
    assert.notEqual(workers[1], workers[2]);
    assert.equal(result.learning.recorded, true);
    assert.equal(JSON.parse(readFileSync(result.learning.path, "utf8")).transport, "native-only");
  } finally { rmSync(join(repository, config.memoryDirectory), { recursive: true, force: true }); rmSync(directory, { recursive: true }); }
});

test("ordinary native driver plans, consumes policy/memory and records only checked native outcomes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-runtime-"));
  const config = configFor(directory), spec = nativeSpec();
  const fixture = setupOrdinaryWorkflowFixture({ spec });
  const contexts = [], roles = [];
  const host = async (request) => {
    if (request.action === "native-worker") {
      roles.push(request.payload.route.role); contexts.push(request.payload.runtimeContext);
      if (request.payload.route.role === "implement") assert.equal(request.payload.plan, "fixture result");
      if (request.payload.route.role === "review") assert.equal(request.payload.plan, undefined);
    }
    return fixture.host(request);
  };
  try {
    const result = await runWorkflow(spec, host, { ...fixture.io, runtime: createOrdinaryRuntime(config) });
    assert.deepEqual(roles, ["plan", "implement", "review"]);
    assert.ok(contexts.every((context) => context.policyDigest === canonicalSha256(seedOrdinaryPolicy)));
    assert.equal(result.learning.recorded, true);
    const record = JSON.parse(readFileSync(result.learning.path, "utf8"));
    assert.equal(record.transport, "native-only");
    assert.equal(record.observations[0].controlled, false);
    assert.equal(record.observations[0].quality, 1);
    const next = setupOrdinaryWorkflowFixture({ spec });
    const fresh = createOrdinaryRuntime(config).forWorkflow(spec, next.io.files());
    assert.equal(fresh.context("implement").nativeMemory.observations, 1);
    fresh.notePacket({ sourceSha256: "b".repeat(64), payload: { prompt: "credit fallback", route: { role: "implement" } } });
    const credit = fresh.selectCreditFallback(routeDelivery({ role: "implement", taskId: spec.taskId,
      completionCheck: spec.completionCheck, model: "cc/claude-sonnet-5-5[1m]", effort: "medium", reason: "confirmed-credit-rejection" }));
    assert.equal(credit.model, "cc/claude-sonnet-5-5[1m]");
    assert.equal(credit.effort, "medium");
    const newPolicy = { ...seedOrdinaryPolicy, planner: "Different policy must not share learned ranking." };
    assert.equal(createOrdinaryRuntime(config, { policy: newPolicy }).forWorkflow(spec, next.io.files())
      .context("implement").nativeMemory.observations, 0);
    for (const check of spec.checks) for (const path of check.argv.filter((arg) => arg.endsWith(".mjs"))) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), "// Different isolated evaluator bytes\n");
    }
    assert.notEqual(ordinaryRuntimeBinding(spec, next.io.files(), directory).evaluatorSha256,
      ordinaryRuntimeBinding(spec, next.io.files()).evaluatorSha256);
    const apiPin = { model: "deepseek/deepseek-v4.1-flash", effort: "high", reason: "explicit API fixture" };
    const hybridSpec = { ...ordinaryWorkflowSpec, implement: apiPin, review: apiPin };
    const hybrid = setupOrdinaryWorkflowFixture({ spec: hybridSpec });
    const skipped = await runWorkflow(hybridSpec, hybrid.host, { ...hybrid.io, runtime: createOrdinaryRuntime(config) });
    assert.deepEqual(skipped.learning, { recorded: false, reason: "hybrid-excluded" });
  } finally { rmSync(join(repository, config.memoryDirectory), { recursive: true, force: true }); rmSync(directory, { recursive: true }); }
});

test("upstream native Router ranks only actual controlled equal-packet evidence, never ordinary rows or other roles", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-native-memory-"));
  const binding = "a".repeat(64);
  const candidates = ["cc/claude-sonnet-5[1m]", "gpt-5.6-sol"].map((model) => routeDelivery({
    role: "implement", taskId: "task-memory", completionCheck: "checks pass", model, effort: "medium", reason: "confirmed-credit-rejection",
  }));
  const packet = { prompt: "fixed actual packet", sourceDigest: "b".repeat(64), policyDigest: "c".repeat(64), role: "implement" };
  try {
    const store = ordinaryMemory(directory, binding);
    for (let index = 0; index < 5; index++) {
      store.record(`ordinary-${index}`, candidates.map((route) => ({ inputDigest: canonicalSha256({ ...packet, index }),
        model: route.model, effort: route.effort, role: "implement", quality: route.model.startsWith("gpt-") ? 1 : 0,
        evidenceDigest: "d".repeat(64) })));
    }
    assert.equal(ordinaryMemory(directory, binding).select(candidates[0], candidates, canonicalSha256(packet)).model, candidates[0].model);
    for (let index = 0; index < 5; index++) {
      await store.compare(`controlled-${index}`, { ...packet, prompt: `${packet.prompt}-${index}` }, candidates,
        async (actual, route) => ({ inputDigest: canonicalSha256(actual), model: route.model, effort: route.effort,
          quality: route.model.startsWith("gpt-") ? 1 : 0, evidenceDigest: canonicalSha256({ actual, checked: true }) }));
    }
    const learned = ordinaryMemory(directory, binding);
    assert.equal(learned.select(candidates[0], candidates, canonicalSha256(packet)).model, "gpt-5.6-sol");
    assert.equal(learned.select(candidates[0], candidates, canonicalSha256(packet), "repair").model, candidates[0].model);
    assert.equal(ordinaryMemory(directory, "f".repeat(64)).summary().observations, 0);
    assert.equal(store.record("hybrid", [], { hybrid: true }).recorded, false);
    await assert.rejects(store.compare("bad", packet, candidates, async () => ({ inputDigest: "0".repeat(64) })), /binding mismatch/);
  } finally { rmSync(directory, { recursive: true }); }
});

test("real Flywheel producer evaluates ordinary workflows, replays signed evidence and changes next workflow policy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "oxigraph-policy-"));
  const config = configFor(directory), signer = makeSigner();
  const specs = Array.from({ length: 10 }, (_, index) => nativeSpec(`policy-${index}`));
  const fixtures = [];
  const bindings = { tasks: Object.fromEntries(specs.map((spec) => [spec.taskId,
    ordinaryRuntimeBinding(spec, setupOrdinaryWorkflowFixture({ spec }).io.files())])) };
  const evaluator = ordinaryPolicyEvaluator({ definitions: specs, runtimeConfig: config, hostForTask: async () => null,
    verifyReference: (reference, expected) => fixtures.some((fixture) => fixture.io.verifyReference(reference, expected)),
    execute: async (spec, _host, options) => {
      const bad = options.runtime.policyDigest === canonicalSha256(seedOrdinaryPolicy) && /[05]$/.test(spec.taskId);
      const fixture = setupOrdinaryWorkflowFixture({ spec, failChecks: bad, stalled: bad }); fixtures.push(fixture);
      return runWorkflow(spec, fixture.host, { ...options, ...fixture.io, execute: async (check) => {
        const run = await fixture.io.execute(check);
        run.result.observedNodeTestSummary = { pass: bad ? 0 : 1, fail: bad ? 1 : 0 };
        return run;
      } });
    },
  });
  try {
    const envelope = await produceOrdinaryPolicy({ rootPolicy: seedOrdinaryPolicy, bindings, signer, evaluator,
      proposer: async () => "Fixture policy: inspect acceptance before making scoped edits.",
      selection: { id: "selection", items: specs.slice(0, 5).map((spec) => spec.taskId) },
      sealed: { id: "sealed", items: specs.slice(5).map((spec) => spec.taskId) }, dataSource: "SYNTHETIC" });
    assert.equal(envelope.payload.bundle.data_source, "SYNTHETIC");
    assert.equal(envelope.payload.promoted, true);
    const trust = { directory: join(directory, "activation"), trustedPublicKey: signer.publicKey(), bindings,
      dataSource: "SYNTHETIC", rootPolicy: seedOrdinaryPolicy };
    assert.throws(() => activateOrdinaryPolicy({ ...trust, dataSource: "OBSERVED" }, envelope, canonicalSha256(seedOrdinaryPolicy)), /Untrusted/);
    const activated = activateOrdinaryPolicy(trust, envelope, canonicalSha256(seedOrdinaryPolicy));
    assert.equal(activated.digest, canonicalSha256(envelope.payload.policy));
    assert.equal(readOrdinaryPolicy(trust).policy.planner, envelope.payload.policy.planner);
    const runtime = createOrdinaryRuntime({ ...config, policyActivation: trust });
    const fixture = setupOrdinaryWorkflowFixture({ spec: specs[0] });
    let actualPlanner;
    const result = await runWorkflow(specs[0], async (request) => {
      if (request.payload?.route?.role === "plan") actualPlanner = request.payload.runtimeContext.policy.planner;
      return fixture.host(request);
    }, { ...fixture.io, runtime });
    assert.equal(actualPlanner, envelope.payload.policy.planner);
    assert.equal(result.policyDigest, activated.digest);
    assert.throws(() => runtime.forWorkflow(specs[0], [{ path: "different", content: "changed" }]), /binding drifted/);
    const unrelatedSpec = nativeSpec("unrelated"), unrelated = setupOrdinaryWorkflowFixture({ spec: unrelatedSpec });
    let unrelatedPlanner;
    const unrelatedResult = await runWorkflow(unrelatedSpec, async (request) => {
      if (request.payload?.route?.role === "plan") unrelatedPlanner = request.payload.runtimeContext.policy.planner;
      return unrelated.host(request);
    }, { ...unrelated.io, runtime });
    assert.equal(unrelatedPlanner, seedOrdinaryPolicy.planner);
    assert.equal(unrelatedResult.policyDigest, canonicalSha256(seedOrdinaryPolicy));
    assert.equal(unrelatedResult.policyApplicability, "nonapplicable-task");
    const envelopePath = join(trust.directory, `envelope-${activated.digest}.json`);
    const originalEnvelope = readFileSync(envelopePath, "utf8");
    try {
      const tampered = JSON.parse(originalEnvelope); tampered.payload.policy.planner = "Tampered active policy must never silently fall back.";
      writeFileSync(envelopePath, JSON.stringify(tampered));
      assert.throws(() => createOrdinaryRuntime({ ...config, policyActivation: trust })
        .forWorkflow(unrelatedSpec, unrelated.io.files()), /Untrusted/);
    } finally { writeFileSync(envelopePath, originalEnvelope); }
    const changed = structuredClone(envelope.payload); changed.policy.planner = "Unevaluated forged policy bytes.";
    assert.throws(() => activateOrdinaryPolicy({ ...trust, directory: join(directory, "forged") }, signer.sign(changed), changed.parent), /evaluator|evaluations/);
    const other = makeSigner();
    assert.throws(() => activateOrdinaryPolicy({ ...trust, directory: join(directory, "untrusted") }, other.sign(envelope.payload), envelope.payload.parent), /Untrusted/);
    assert.throws(() => activateOrdinaryPolicy(trust, envelope, envelope.payload.parent), /CAS mismatch/);
    const reused = structuredClone(envelope.payload);
    reused.replay = reused.evaluations.find((item) => canonicalSha256(item.policy) === activated.digest &&
      canonicalSha256(item.suite.items) === canonicalSha256(reused.suites.sealed));
    assert.throws(() => activateOrdinaryPolicy({ ...trust, directory: join(directory, "reused") }, signer.sign(reused), reused.parent), /clean sealed task replay/);
    assert.equal(ordinaryPromotionRule({ baseline: { primary: 0, noopRate: 0, regressed: false },
      candidate: { primary: 1, noopRate: 0, regressed: false }, anchor: { baseline: NaN, candidate: 1 } }).promote, false);
    assert.throws(() => rollbackOrdinaryPolicy(trust, envelope.payload.parent), /rollback CAS/);
    assert.equal(rollbackOrdinaryPolicy(trust, activated.digest).digest, envelope.payload.parent);
    assert.equal(readOrdinaryPolicy(trust).digest, envelope.payload.parent);
  } finally { rmSync(join(repository, config.memoryDirectory), { recursive: true, force: true }); rmSync(directory, { recursive: true }); }
});
