import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ROUTING_EMBEDDING_DIMENSION,
  canonicalSha256,
  routingEmbedding,
} from "../src/routing/features.mjs";
import {
  RouterHistory,
  createDirectApplicationAdmissionAuthority,
} from "../src/routing/history.mjs";
import {
  MINIMUM_PAIRED_SAMPLES,
  QualityFirstRouter,
} from "../src/routing/quality-router.mjs";

const digest = (value) => canonicalSha256({ value });
const frozen = Object.freeze({
  role: "implementation",
  taskClass: "transaction-concurrency",
  evaluatorSha256: digest("evaluator-v1"),
  contractSha256: digest("contract-v1"),
  harnessSha256: digest("harness-v1"),
});
const models = Object.freeze({
  codex: "gpt-5.6-sol",
  claude: "claude-sonnet-5",
});

function outcome({
  taskId,
  provider,
  quality,
  mode = "paired",
  pairId = mode === "paired" ? taskId : null,
  evaluatorSha256 = frozen.evaluatorSha256,
  harnessSha256 = frozen.harnessSha256,
  modelSet = models,
  model = modelSet[provider],
  disposition = "verified",
}) {
  return {
    taskId,
    taskClass: frozen.taskClass,
    role: frozen.role,
    provider,
    model,
    models: modelSet,
    candidateSha256: digest(`${taskId}/${provider}/candidate`),
    evaluatorSha256,
    contractSha256: frozen.contractSha256,
    harnessSha256,
    disposition,
    quality,
    mode,
    pairId,
    repairCycles: 0,
  };
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "oxigraph-router-history-"));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "history.jsonl");
  const ignored = async (candidate) => candidate.startsWith(`${directory}/`);
  const history = await RouterHistory.open({ path, isIgnoredRuntimePath: ignored });
  const authority = createDirectApplicationAdmissionAuthority({
    verifyDirectApplication: async ({ bindingSha256 }) => ({
      verified: true,
      bindingSha256,
    }),
  });
  return { directory, path, ignored, history, authority };
}

async function admit(history, authority, value) {
  const capability = await authority.verifyAndMint(value, { direct: true });
  return history.append(value, capability);
}

async function admitBatch(history, authority, values) {
  const capabilities = await Promise.all(
    values.map((value) => authority.verifyAndMint(value, { direct: true })),
  );
  return history.appendBatch(values, capabilities);
}

async function admitPair(history, authority, index, qualities = [0.8, 0.8], drift = {}) {
  const taskId = `pair-${index}`;
  await admit(
    history,
    authority,
    outcome({ taskId, provider: "codex", quality: qualities[0], ...drift }),
  );
  await admit(
    history,
    authority,
    outcome({ taskId, provider: "claude", quality: qualities[1], ...drift }),
  );
}

function context(overrides = {}) {
  return {
    taskId: "next-task",
    taskClass: frozen.taskClass,
    role: frozen.role,
    contractSha256: frozen.contractSha256,
    evaluatorSha256: frozen.evaluatorSha256,
    harnessSha256: frozen.harnessSha256,
    models,
    ...overrides,
  };
}

test("routing features are canonical, fixed-size, deterministic, and nonzero", () => {
  const left = routingEmbedding(context());
  const right = routingEmbedding({
    models,
    role: frozen.role,
    taskId: "next-task",
    taskClass: frozen.taskClass,
    harnessSha256: frozen.harnessSha256,
    evaluatorSha256: frozen.evaluatorSha256,
    contractSha256: frozen.contractSha256,
  });
  assert.equal(left.length, ROUTING_EMBEDDING_DIMENSION);
  assert.deepEqual(left, right);
  assert.ok(left.every((coordinate) => coordinate > 0 && coordinate <= 1));
});

test("history admits only exact, single-use direct-verifier capabilities", async (t) => {
  const { directory, path, history, authority } = await fixture(t);
  await assert.rejects(
    RouterHistory.open({ path: join(directory, "denied.jsonl"), isIgnoredRuntimePath: () => false }),
    /not an ignored runtime path/,
  );
  const verified = outcome({ taskId: "one", provider: "codex", quality: 0.9 });
  await assert.rejects(history.append(verified, Object.freeze({})), /capability/);

  const capability = await authority.verifyAndMint(verified, { direct: true });
  await assert.rejects(
    history.append({ ...verified, quality: 0.1 }, capability),
    /exact verifier capability/,
  );
  await history.append(verified, capability);
  await assert.rejects(history.append(verified, capability), /capability/);
  assert.equal((await readFile(path, "utf8")).split("\n").filter(Boolean).length, 1);

  for (const disposition of ["preparation-failed", "cancelled", "inconclusive"]) {
    await assert.rejects(
      authority.verifyAndMint(
        outcome({
          taskId: disposition,
          provider: "claude",
          quality: 0,
          disposition,
        }),
        {},
      ),
      new RegExp(`excludes ${disposition}`),
    );
  }

  const rejectingAuthority = createDirectApplicationAdmissionAuthority({
    verifyDirectApplication: async () => ({
      verified: true,
      bindingSha256: digest("wrong binding"),
    }),
  });
  await assert.rejects(
    rejectingAuthority.verifyAndMint(
      outcome({ taskId: "wrong-binding", provider: "claude", quality: 0.5 }),
      {},
    ),
    /did not bind the exact outcome/,
  );
});

test("history reload validates its complete hash chain and fails closed", async (t) => {
  const { path, ignored, history, authority } = await fixture(t);
  await admit(
    history,
    authority,
    outcome({ taskId: "one", provider: "codex", quality: 0.9 }),
  );
  const reopened = await RouterHistory.open({ path, isIgnoredRuntimePath: ignored });
  assert.equal(reopened.snapshot().length, 1);

  const line = JSON.parse((await readFile(path, "utf8")).trim());
  line.outcome.quality = 0.1;
  await writeFile(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  await assert.rejects(
    RouterHistory.open({ path, isIgnoredRuntimePath: ignored }),
    /binding validation/,
  );
});

test("one task may admit independently verified outcomes for different roles", async (t) => {
  const { history, authority } = await fixture(t);
  const implementation = outcome({
    taskId: "shared-task",
    provider: "codex",
    quality: 0.8,
    mode: "routed",
    pairId: null,
  });
  const review = {
    ...implementation,
    role: "review",
    candidateSha256: digest("shared-task/review/candidate"),
  };
  await admit(history, authority, implementation);
  await admit(history, authority, review);
  assert.equal(history.snapshot().length, 2);
  await assert.rejects(
    admit(history, authority, { ...review, quality: 0.7 }),
    /conflicts with shared-task\/review\/codex/,
  );
});

test("receipt outcomes append atomically and exact replay is idempotent", async (t) => {
  const { path, history, authority } = await fixture(t);
  const values = [
    outcome({ taskId: "atomic-pair", provider: "codex", quality: 0.3 }),
    outcome({ taskId: "atomic-pair", provider: "claude", quality: 0.9 }),
  ];
  const firstCapability = await authority.verifyAndMint(values[0], { direct: true });
  await assert.rejects(
    history.appendBatch(values, [firstCapability, Object.freeze({})]),
    /capability/,
  );
  assert.equal(history.snapshot().length, 0);
  await history.append(values[0], firstCapability);
  assert.equal(history.snapshot().length, 1, "failed batch released its valid capability");

  const secondCapability = await authority.verifyAndMint(values[1], { direct: true });
  await history.append(values[1], secondCapability);
  const beforeReplay = await readFile(path, "utf8");
  const replayed = await admitBatch(history, authority, values);
  assert.equal(replayed.length, 2);
  assert.equal(await readFile(path, "utf8"), beforeReplay);

  const secondPair = [
    outcome({ taskId: "second-atomic-pair", provider: "codex", quality: 0.4 }),
    outcome({ taskId: "second-atomic-pair", provider: "claude", quality: 0.8 }),
  ];
  const appended = await admitBatch(history, authority, secondPair);
  assert.equal(appended.length, 2);
  assert.equal(history.snapshot().length, 4);

  const conflicting = { ...values[1], quality: 0.1 };
  const conflictCapability = await authority.verifyAndMint(conflicting, {
    direct: true,
  });
  await assert.rejects(
    history.appendBatch([conflicting], [conflictCapability]),
    /conflicts with atomic-pair\/implementation\/claude/,
  );
});

test("a dead controller lock is recovered but malformed locks fail closed", async (t) => {
  const { path, history, authority } = await fixture(t);
  const lockPath = `${path}.lock`;
  await writeFile(
    lockPath,
    `${JSON.stringify({
      schema: 1,
      pid: 99_999_999,
      processStartTime: "0",
      createdAt: "2026-08-25T00:00:00.000Z",
    })}\n`,
    { mode: 0o600 },
  );
  await admit(
    history,
    authority,
    outcome({ taskId: "after-stale-lock", provider: "codex", quality: 0.8 }),
  );
  assert.equal(history.snapshot().length, 1);

  await writeFile(lockPath, "not-json\n", { mode: 0o600 });
  await assert.rejects(
    admit(
      history,
      authority,
      outcome({ taskId: "malformed-lock", provider: "claude", quality: 0 }),
    ),
    /lock is malformed/,
  );
});

test("five complete native pairs gate the real quality router and calibration", async (t) => {
  const { history, authority } = await fixture(t);
  const router = new QualityFirstRouter({ history });
  for (let index = 0; index < MINIMUM_PAIRED_SAMPLES - 1; index += 1) {
    await admitPair(history, authority, index, [0.2, 0.9]);
  }
  await admit(
    history,
    authority,
    outcome({ taskId: "incomplete", provider: "codex", quality: 1 }),
  );
  const cold = await router.route(context());
  assert.equal(cold.mode, "paired");
  assert.equal(cold.reason, "cold-start");
  assert.equal(cold.calibration.status, "INSUFFICIENT_SAMPLES");
  assert.equal(cold.calibration.reports, null);

  await admit(
    history,
    authority,
    outcome({ taskId: "incomplete", provider: "claude", quality: 0.9 }),
  );
  const routed = await router.route(context());
  assert.equal(routed.mode, "routed");
  assert.equal(routed.engine, "@metaharness/router.Router");
  assert.equal(routed.provider, "claude");
  assert.equal(routed.calibration.status, "READY");
  assert.equal(routed.calibration.reports.codex.samples, 5);
  assert.equal(routed.calibration.reports.claude.samples, 5);
});

test("quality ties use frozen provider order and never a price", async (t) => {
  const { history, authority } = await fixture(t);
  for (let index = 0; index < MINIMUM_PAIRED_SAMPLES; index += 1) {
    await admitPair(history, authority, index, [0.75, 0.75]);
  }
  const routed = await new QualityFirstRouter({ history }).route(context());
  assert.equal(routed.provider, "codex");
  assert.deepEqual(routed.providerOrder, ["codex", "claude"]);
  assert.ok(!("costPerMTok" in routed));
  await assert.rejects(
    new QualityFirstRouter({ history }).route(
      context({ models: { codex: "openrouter/model", claude: models.claude } }),
    ),
    /OpenRouter/,
  );
});

test("the fifth admitted task reopens pairing and drift reopens cold start", async (t) => {
  const { history, authority } = await fixture(t);
  for (let index = 0; index < MINIMUM_PAIRED_SAMPLES; index += 1) {
    await admitPair(history, authority, index, [0.9, 0.2]);
  }
  const router = new QualityFirstRouter({ history });
  for (let index = 0; index < 4; index += 1) {
    const taskId = `routed-${index}`;
    await admit(
      history,
      authority,
      outcome({
        taskId,
        provider: "codex",
        quality: 0.9,
        mode: "routed",
        pairId: null,
      }),
    );
  }
  const periodic = await router.route(context());
  assert.equal(periodic.mode, "paired");
  assert.equal(periodic.reason, "periodic-calibration");
  assert.equal(periodic.admittedSincePair, 4);

  for (const changed of [
    { contractSha256: digest("contract-v2") },
    { evaluatorSha256: digest("evaluator-v2") },
    { harnessSha256: digest("harness-v2") },
    { models: { ...models, codex: "gpt-5.6-sol-new" } },
  ]) {
    const drifted = await router.route(context(changed));
    assert.equal(drifted.mode, "paired");
    assert.equal(drifted.reason, "drift");
    assert.equal(drifted.pairedSamples, 0);
  }

  const changedModels = Object.freeze({
    ...models,
    codex: "gpt-5.6-sol-new",
  });
  for (let index = 0; index < MINIMUM_PAIRED_SAMPLES; index += 1) {
    await admitPair(
      history,
      authority,
      `new-model-${index}`,
      [0.1, 0.95],
      { modelSet: changedModels },
    );
  }
  const recovered = await router.route(context({ models: changedModels }));
  assert.equal(recovered.mode, "routed");
  assert.equal(recovered.provider, "claude");
  assert.equal(recovered.pairedSamples, MINIMUM_PAIRED_SAMPLES);
});
