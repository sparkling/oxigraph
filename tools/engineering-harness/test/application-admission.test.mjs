import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { ReceiptLog } from "@metaharness/harness";

import {
  createApplicationReceipt,
  serializeApplicationReceipt,
  verifyApplicationReceipt,
} from "../src/receipts/application.mjs";
import { canonicalSha256, routingEmbedding } from "../src/routing/features.mjs";
import { RouterHistory } from "../src/routing/history.mjs";
import {
  admitApplicationReceipt,
  verifyPinnedApplicationReceipt,
} from "../src/runtime/application-admission.mjs";
import {
  isIgnoredRuntimePath,
  runtimePath,
} from "../src/runtime/storage.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const gitObject = (value) => createHash("sha1").update(value).digest("hex");

function preflight() {
  const models = { codex: "gpt-5.6-sol", claude: "opus" };
  const contract = {
    routing: {
      providers: [
        { provider: "codex", model: models.codex, transport: "native" },
        { provider: "claude", model: models.claude, transport: "native" },
      ],
    },
    baseline: { commit: gitObject("baseline"), tree: gitObject("baseline-tree") },
    evaluator: {
      commit: gitObject("evaluator"),
      tree: gitObject("evaluator-tree"),
      patchSha256: sha256("evaluator-patch"),
    },
    success: { publicPassed: 2, independentPassed: 3, regressionPassed: 2 },
  };
  return {
    contract,
    contractSha256: sha256("contract"),
    control: {
      harnessSha256: sha256("harness"),
      nativeHosts: [
        {
          provider: "codex",
          available: true,
          interfaceValid: true,
          executablePath: "/usr/bin/codex",
          executableSha256: sha256("codex-bin"),
        },
        {
          provider: "claude",
          available: true,
          interfaceValid: true,
          executablePath: "/usr/bin/claude",
          executableSha256: sha256("claude-bin"),
        },
      ],
    },
  };
}

function routeRecord(workerRole, run, control, contract) {
  const context = {
    taskId: run.taskId,
    taskClass: run.taskClass,
    role: workerRole,
    contractSha256: contract.sha256,
    evaluatorSha256: contract.evaluator.patchSha256,
    harnessSha256: control.harnessSha256,
    models: { ...control.providerModels },
  };
  return {
    id: `route-${workerRole}`,
    role: workerRole,
    context,
    decision: {
      mode: "paired",
      reason: "cold-start",
      providers: ["codex", "claude"],
      models: { ...control.providerModels },
      embedding: [...routingEmbedding(context)],
      pairedSamples: 0,
      admittedSincePair: 0,
      calibration: {
        status: "INSUFFICIENT_SAMPLES",
        minimumSamples: 5,
        pairedSamples: 0,
        reports: null,
      },
      fingerprintSha256: canonicalSha256({
        contractSha256: contract.sha256,
        evaluatorSha256: contract.evaluator.patchSha256,
        harnessSha256: control.harnessSha256,
        models: control.providerModels,
      }),
    },
  };
}

function invocation({ id, route, sequence, provider, role, model, host, patch }) {
  return {
    id,
    routingId: route.id,
    sequence,
    executionId: "admission-candidate-execution",
    provider,
    model,
    role,
    status: "ACCEPT",
    executable: host.executablePath,
    args: ["--model", model],
    executableAttestation: {
      provider,
      discoveredPath: host.executablePath,
      path: host.executablePath,
      sha256: host.executableSha256,
      size: 1024,
      mode: 0o755,
      uid: 1000,
      gid: 1000,
    },
    taskSha256: sha256(`${id}:task`),
    promptSha256: sha256(`${id}:prompt`),
    process: {
      disposition: "completed",
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdoutSha256: sha256(`${id}:stdout`),
      stderrSha256: sha256(`${id}:stderr`),
      terminationErrors: [],
    },
    outputSha256: sha256(`${id}:output`),
    patchSha256: patch === null ? null : sha256(patch),
  };
}

function upstream(runId, bindings) {
  const log = new ReceiptLog();
  for (const { role, provider, model } of bindings) {
    log.append({
      runId,
      step: `oxigraph-candidate:${role}`,
      input: { role },
      output: { role },
      agent: `${provider}:${role}`,
      model,
      costUsd: 0,
      latencyMs: 1,
      verdict: "pass",
    });
  }
  assert.deepEqual(log.verify(), { ok: true });
  return log.entries();
}

function rejectedReceipt(frozen) {
  const run = {
    id: "admission-run",
    taskId: "g1.2:admission-run",
    taskClass: "transaction-concurrency",
    startedAt: "2026-08-25T10:00:00.000Z",
    completedAt: "2026-08-25T10:00:01.000Z",
  };
  const control = {
    harnessSha256: frozen.control.harnessSha256,
    providerModels: Object.fromEntries(
      frozen.contract.routing.providers.map(({ provider, model }) => [provider, model]),
    ),
  };
  const contract = {
    sha256: frozen.contractSha256,
    baseline: { ...frozen.contract.baseline },
    evaluator: { ...frozen.contract.evaluator },
    success: { ...frozen.contract.success },
  };
  const roles = ["architecture", "critique", "implementation"];
  const providersByRole = {
    architecture: "codex",
    critique: "claude",
    implementation: "codex",
  };
  const routes = roles.map((role) => routeRecord(role, run, control, contract));
  const patch = "diff --git a/lib.rs b/lib.rs\n--- a/lib.rs\n+++ b/lib.rs\n@@ -1 +1 @@\n-old\n+new\n";
  const invocations = roles.map((role, index) => {
    const provider = providersByRole[role];
    return invocation({
      id: `invoke-${role}`,
      route: routes[index],
      sequence: index + 1,
      provider,
      role,
      model: control.providerModels[provider],
      host: frozen.control.nativeHosts.find((item) => item.provider === provider),
      patch: role === "implementation" ? patch : null,
    });
  });
  const protectedManifest = { entries: 12, sha256: sha256("protected") };
  const candidate = {
    commit: gitObject("candidate"),
    tree: gitObject("candidate-tree"),
    protectedManifest,
  };
  const attempt = {
    id: "attempt-1",
    parentAttemptId: null,
    roles,
    providersByRole,
    modelsByRole: Object.fromEntries(
      roles.map((role) => [role, control.providerModels[providersByRole[role]]]),
    ),
    invocationIds: invocations.map(({ id }) => id),
    upstreamReceipts: upstream(
      "upstream-attempt",
      roles.map((role) => ({
        role,
        provider: providersByRole[role],
        model: control.providerModels[providersByRole[role]],
      })),
    ),
    patch,
    patchSha256: sha256(patch),
    candidate,
    verifier: {
      verdict: "REJECT",
      stage: "format",
      commands: [
        {
          name: "format",
          logicalArgv: ["cargo", "fmt", "--all", "--", "--check"],
          sandboxArgv: ["--unshare-net", "--", "cargo", "fmt"],
          network: "isolated",
          workspace: "read-only",
          exitCode: 1,
          signal: null,
          disposition: "completed",
          durationMs: 1,
          stdoutSha256: sha256("format-stdout"),
          stderrSha256: sha256("format-stderr"),
          stdoutTail: "",
          stderrTail: "format rejected",
        },
      ],
      artifacts: [{ name: "verifier-session-result.json", sha256: sha256("result"), bytes: 10 }],
      durationMs: 1,
      candidateTree: candidate.tree,
      protectedManifest,
    },
    repairCycle: 0,
    disposition: "REJECT",
  };
  return createApplicationReceipt({
    run,
    control,
    contract,
    routing: routes,
    nativeInvocations: invocations,
    attempts: [attempt],
    reviews: [],
    selectedCandidate: null,
    final: { verdict: "REJECT", reason: "candidate failed the frozen verifier" },
    events: [
      ...routes.map(({ id }) => ({ kind: "routing", id })),
      ...invocations.map(({ id }) => ({ kind: "native-invocation", id })),
      { kind: "attempt", id: attempt.id },
      { kind: "selected-candidate", id: "none" },
      { kind: "final", id: run.id },
    ],
  });
}

function legacyReceipt(current, schema) {
  const receipt = structuredClone(current);
  receipt.schema = schema;
  if (schema === "oxigraph.engineering-application-receipt/v1") {
    for (const invocation of receipt.nativeInvocations) {
      delete invocation.executionId;
    }
  }
  const collections = {
    routing: receipt.routing,
    "native-invocation": receipt.nativeInvocations,
    attempt: receipt.attempts,
    review: receipt.reviews,
  };
  let previousSha256 = "0".repeat(64);
  for (let index = 0; index < receipt.events.length; index += 1) {
    const event = receipt.events[index];
    const record = collections[event.kind]?.find(({ id }) => id === event.id) ??
      (event.kind === "selected-candidate" ? receipt.selectedCandidate : receipt.final);
    const body = {
      sequence: index + 1,
      previousSha256,
      bindingSha256: event.bindingSha256,
      kind: event.kind,
      id: event.id,
      recordSha256: canonicalSha256(record),
    };
    receipt.events[index] = {
      ...body,
      entrySha256: canonicalSha256(body),
    };
    previousSha256 = receipt.events[index].entrySha256;
  }
  receipt.chain.entryCount = receipt.events.length;
  receipt.chain.tailSha256 = previousSha256;
  receipt.chain.eventsSha256 = canonicalSha256(receipt.events);
  const { receiptSha256: _discarded, ...body } = receipt;
  receipt.receiptSha256 = canonicalSha256(body);
  return receipt;
}

test("pinned application admission is atomic and exact replay is idempotent", async (t) => {
  const frozen = preflight();
  const bytes = serializeApplicationReceipt(rejectedReceipt(frozen));
  const path = await runtimePath(`admission-history-${process.pid}-${Date.now()}.jsonl`);
  t.after(() => rm(path, { force: true }));
  const history = await RouterHistory.open({ path, isIgnoredRuntimePath });

  const first = await admitApplicationReceipt({ receiptBytes: bytes, preflight: frozen, history });
  assert.equal(first.outcomeCount, 3);
  assert.equal(history.snapshot().length, 3);
  const replayed = await admitApplicationReceipt({ receiptBytes: bytes, preflight: frozen, history });
  assert.equal(replayed.outcomeCount, 3);
  assert.equal(history.snapshot().length, 3);
  assert.deepEqual(
    replayed.entries.map(({ sequence }) => sequence),
    [1, 2, 3],
  );
});

test("pinned verification rejects stale controls and executable swaps", () => {
  const frozen = preflight();
  const bytes = serializeApplicationReceipt(rejectedReceipt(frozen));
  assert.equal(verifyPinnedApplicationReceipt(bytes, frozen).ok, true);

  const stale = structuredClone(frozen);
  stale.control.harnessSha256 = sha256("stale-harness");
  assert.throws(
    () => verifyPinnedApplicationReceipt(bytes, stale),
    /current preflight control plane/,
  );

  const swapped = structuredClone(frozen);
  swapped.control.nativeHosts[0].executableSha256 = sha256("swapped-codex");
  assert.throws(
    () => verifyPinnedApplicationReceipt(bytes, swapped),
    /changes the current codex executable identity/,
  );
});

test("valid legacy receipts are replay-only and cannot mint current Router quality", () => {
  const frozen = preflight();
  for (const schema of [
    "oxigraph.engineering-application-receipt/v1",
    "oxigraph.engineering-application-receipt/v2",
    "oxigraph.engineering-application-receipt/v3",
    "oxigraph.engineering-application-receipt/v4",
  ]) {
    const legacy = legacyReceipt(rejectedReceipt(frozen), schema);
    assert.equal(verifyApplicationReceipt(legacy).ok, true, schema);
    assert.throws(
      () => verifyPinnedApplicationReceipt(legacy, frozen),
      /replay-only/,
    );
  }
});
