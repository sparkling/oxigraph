import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import test from "node:test";
import { ReceiptLog } from "@metaharness/harness";

import {
  createApplicationReceipt,
  createApplicationReceiptV7,
  serializeApplicationReceipt,
  serializeApplicationReceiptV7,
  verifyApplicationReceipt,
  verifyApplicationReceiptV7,
} from "../src/receipts/application.mjs";
import { canonicalSha256, routingEmbedding } from "../src/routing/features.mjs";
import { RouterHistory } from "../src/routing/history.mjs";
import {
  admitApplicationReceipt,
  verifyPinnedApplicationReceipt,
} from "../src/runtime/application-admission.mjs";
import { isIgnoredRuntimePath, runtimePath } from "../src/runtime/storage.mjs";
import { harnessCreateExactV2Profile } from "../src/task-profile.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const gitObject = (value) => createHash("sha1").update(value).digest("hex");
const gitBlobObject = (content) => {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "ascii"))
    .update(bytes)
    .digest("hex");
};
const workerV2RequestSchema = "oxigraph.engineering-native-worker-request/v2";
const admissionWorkerContext = Object.freeze({
  fixture: "v7-admission-worker-context",
});

function workerV2Envelope(
  item,
  taskV2,
  {
    modificationPatch = null,
    creations = [],
    finalPatch = null,
    candidateProjection = null,
  } = {},
) {
  const summary = `worker-v2 ${item.role} admission fixture`;
  const providerOutputV2 = {
    summary,
    patch: modificationPatch,
    creations,
    findings: [],
    verdict: item.status,
  };
  const taskJson = JSON.stringify({
    schemaVersion: 2,
    role: item.role,
    directive: `execute exact ${item.id}`,
    context: admissionWorkerContext,
    roleInput: { invocationId: item.id },
  });
  const taskSha256 = sha256(taskJson);
  const requestSha256 = sha256(
    Buffer.concat([
      Buffer.from(`${workerV2RequestSchema}\0`, "ascii"),
      Buffer.from(taskV2.contractSha256, "ascii"),
      Buffer.from(taskSha256, "ascii"),
      Buffer.from(`${item.provider}\0${item.model}\0${item.role}`, "utf8"),
    ]),
  );
  return {
    id: item.id,
    routingId: item.routingId,
    sequence: item.sequence,
    executionId: item.executionId,
    taskJson,
    request: { schema: workerV2RequestSchema, requestSha256 },
    result: {
      provider: item.provider,
      model: item.model,
      role: item.role,
      status: item.status,
      output: {
        summary,
        patch: finalPatch,
        findings: [],
        verdict: item.status,
      },
      providerOutputV2,
      candidateProjection,
      outcome: {
        disposition: "completed",
        firstTerminalReason: "completed",
        spawned: true,
        noChild: false,
        exitCode: 0,
        signal: null,
        closeCode: 0,
        closeSignal: null,
        statusAgreement: true,
        reaped: true,
        directChildCleanupSafe: true,
        processGroupQuiescent: true,
        exitObserved: true,
        closeObserved: true,
        stdoutEof: true,
        stderrEof: true,
        stdinComplete: true,
        captureComplete: true,
        outputTruncated: false,
        durationMs: item.process.durationMs,
        stdoutSha256: item.process.stdoutSha256,
        stderrSha256: item.process.stderrSha256,
        terminationErrorCount: 0,
        processErrorCount: 0,
      },
      invocation: {
        executableAttestation: {
          provider: item.provider,
          transport: "inherited-readonly-fd-v1",
          childFd: 3,
          sha256: item.executableAttestation.sha256,
          size: item.executableAttestation.size,
          mode: item.executableAttestation.mode,
          uid: item.executableAttestation.uid,
          gid: item.executableAttestation.gid,
        },
        argsNormalization: "execution-root-token-v1",
        argsSha256: sha256(`${item.id}:args`),
        environmentSha256: sha256(`${item.id}:environment`),
        workerSchemaVersion: 2,
        timeoutMs: 120_000,
        maxOutputBytes: 262_144,
        contractSha256: taskV2.contractSha256,
        contextTaskSha256: taskV2.taskContext.taskSha256,
        requestSha256,
        taskSha256,
        promptSha256: item.promptSha256,
        outputSchemaSha256: sha256(`${item.provider}:worker-v2-output-schema`),
        outputSchemaTransport:
          item.provider === "codex"
            ? "inherited-readonly-fd-v1"
            : "argv-utf8-v1",
        outputSchemaChildFd: item.provider === "codex" ? 4 : null,
        providerOutputSha256: sha256(JSON.stringify(providerOutputV2)),
        modificationPatchSha256:
          modificationPatch === null ? null : sha256(modificationPatch),
        creationsSha256: sha256(JSON.stringify(creations)),
        finalPatchSha256: finalPatch === null ? null : sha256(finalPatch),
      },
    },
  };
}

function preflight() {
  const models = { codex: "gpt-5.6-sol", claude: "opus" };
  const contract = {
    routing: {
      providers: [
        { provider: "codex", model: models.codex, transport: "native" },
        { provider: "claude", model: models.claude, transport: "native" },
      ],
    },
    baseline: {
      commit: gitObject("baseline"),
      tree: gitObject("baseline-tree"),
    },
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

function invocation({
  id,
  route,
  sequence,
  provider,
  role,
  model,
  host,
  patch,
}) {
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
      frozen.contract.routing.providers.map(({ provider, model }) => [
        provider,
        model,
      ]),
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
  const patch =
    "diff --git a/lib.rs b/lib.rs\n--- a/lib.rs\n+++ b/lib.rs\n@@ -1 +1 @@\n-old\n+new\n";
  const invocations = roles.map((role, index) => {
    const provider = providersByRole[role];
    return invocation({
      id: `invoke-${role}`,
      route: routes[index],
      sequence: index + 1,
      provider,
      role,
      model: control.providerModels[provider],
      host: frozen.control.nativeHosts.find(
        (item) => item.provider === provider,
      ),
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
      roles.map((role) => [
        role,
        control.providerModels[providersByRole[role]],
      ]),
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
      artifacts: [
        {
          name: "verifier-session-result.json",
          sha256: sha256("result"),
          bytes: 10,
        },
      ],
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
    candidateRejections: [],
    selectedCandidate: null,
    final: {
      verdict: "REJECT",
      reason: "candidate failed the frozen verifier",
    },
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
  delete receipt.candidateRejections;
  receipt.events = receipt.events.filter(
    ({ kind }) => kind !== "candidate-rejection",
  );
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
    const record =
      collections[event.kind]?.find(({ id }) => id === event.id) ??
      (event.kind === "selected-candidate"
        ? receipt.selectedCandidate
        : receipt.final);
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

function dormantV7Receipt() {
  const profile = harnessCreateExactV2Profile;
  const baseline = {
    commit: gitObject("v7-baseline"),
    tree: gitObject("v7-baseline-tree"),
  };
  const evaluator = {
    commit: gitObject("v7-evaluator"),
    tree: gitObject("v7-evaluator-tree"),
    patchSha256: sha256("v7-evaluator-patch"),
  };
  const patch = "diff --git a/created.rs b/created.rs\nnew file mode 100644\n";
  const candidate = {
    commit: gitObject("v7-candidate"),
    tree: gitObject("v7-candidate-tree"),
    protectedManifest: { entries: 9, sha256: sha256("v7-protected") },
  };
  const frozen = preflight();
  const control = {
    harnessSha256: frozen.control.harnessSha256,
    providerModels: { codex: "gpt-5.6-sol", claude: "opus" },
  };
  const contract = {
    sha256: profile.contractRawSha256,
    baseline,
    evaluator,
    success: { publicPassed: 3 },
  };
  const run = {
    id: "dormant-v7-admission-run",
    taskId: profile.id,
    taskClass: profile.taskClass,
    startedAt: "2026-09-02T10:00:00.000Z",
    completedAt: "2026-09-02T10:00:01.000Z",
  };
  const roles = ["architecture", "critique", "implementation"];
  const providersByRole = {
    architecture: "codex",
    critique: "claude",
    implementation: "codex",
  };
  const routing = roles.map((role) =>
    routeRecord(role, run, control, contract),
  );
  const reviewRoute = routeRecord("review", run, control, contract);
  routing.push(reviewRoute);
  const nativeInvocations = roles.map((role, index) => {
    const provider = providersByRole[role];
    return invocation({
      id: `v7-invocation-${role}`,
      route: routing[index],
      sequence: index + 1,
      provider,
      role,
      model: control.providerModels[provider],
      host: frozen.control.nativeHosts.find(
        (item) => item.provider === provider,
      ),
      patch: role === "implementation" ? patch : null,
    });
  });
  const reviewInvocation = invocation({
    id: "v7-invocation-review",
    route: reviewRoute,
    sequence: nativeInvocations.length + 1,
    provider: "claude",
    role: "review",
    model: control.providerModels.claude,
    host: frozen.control.nativeHosts.find((item) => item.provider === "claude"),
    patch: null,
  });
  const commands = ["format", "build", "public"].map((name) => ({
    name,
    logicalArgv: ["cargo", name],
    sandboxArgv: ["--unshare-net", "--", "cargo", name],
    network: "isolated",
    workspace: "read-only",
    exitCode: 0,
    signal: null,
    disposition: "completed",
    durationMs: 1,
    stdoutSha256: sha256(`v7-${name}-stdout`),
    stderrSha256: sha256(`v7-${name}-stderr`),
    stdoutTail: name === "public" ? "test result: ok. 3 passed; 0 failed;" : "",
    stderrTail: "",
  }));
  const attempt = {
    id: "v7-attempt-1",
    parentAttemptId: null,
    roles,
    providersByRole,
    modelsByRole: Object.fromEntries(
      roles.map((role) => [
        role,
        control.providerModels[providersByRole[role]],
      ]),
    ),
    invocationIds: nativeInvocations.map(({ id }) => id),
    upstreamReceipts: upstream(
      "v7-upstream-attempt",
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
      verdict: "ACCEPT",
      stage: "complete",
      commands,
      artifacts: [
        { name: "v7-result.json", sha256: sha256("v7-result"), bytes: 1 },
      ],
      durationMs: 1,
      candidateTree: candidate.tree,
      protectedManifest: candidate.protectedManifest,
    },
    repairCycle: 0,
    disposition: "ACCEPT",
  };
  const createdPath = "lib/oxigraph/tests/v7_created.rs";
  const presentPath = "lib/oxigraph/tests/v7_present.rs";
  const createdContent = 'pub const V7_CREATED: &str = "exact";\n';
  const createdBlob = {
    path: createdPath,
    mode: "100644",
    type: "blob",
    objectId: gitBlobObject(createdContent),
    contentSha256: sha256(createdContent),
  };
  const candidateProjection = {
    paths: [createdPath, presentPath],
    pathStatuses: [
      { path: createdPath, status: "A" },
      { path: presentPath, status: "M" },
    ],
    createdBlobs: [createdBlob],
    changedLines: 2,
  };
  const taskV2 = {
    id: profile.id,
    slug: profile.slug,
    contractSchemaVersion: 2,
    executionGate: profile.executionGate,
    registrationMode: profile.registrationMode,
    productAuthority: false,
    contractSha256: profile.contractRawSha256,
    canonicalContractSha256: sha256("v7-canonical-contract"),
    verificationSequence: ["format", "build", "public"],
    taskContext: {
      schemaVersion: 2,
      taskSha256: sha256(JSON.stringify(admissionWorkerContext)),
      sourceSnapshotSha256: sha256("v7-source-snapshot"),
      creationInstructionsSha256: sha256("v7-creation-instructions"),
    },
    repository: {
      schema: "oxigraph.engineering-task-contract-repository/v2",
      objectFormat: "sha1",
      baseline,
      evaluator: {
        commit: evaluator.commit,
        tree: evaluator.tree,
        parent: baseline.commit,
        path: "lib/oxigraph/tests/v7_evaluator.rs",
        changeStatus: "A",
        blob: gitObject("v7-evaluator-blob"),
      },
      mutableBaselines: [
        { path: createdPath, state: "absent" },
        {
          path: presentPath,
          state: "present",
          objectId: gitObject("v7-present"),
        },
      ],
      baselineManifest: {
        entries: 10,
        fullSha256: sha256("v7-baseline-full"),
        protectedEntries: 9,
        protectedSha256: sha256("v7-baseline-protected"),
      },
      evaluatorManifest: {
        entries: 10,
        fullSha256: sha256("v7-evaluator-full"),
        protectedEntries: 9,
        protectedSha256: candidate.protectedManifest.sha256,
      },
    },
    candidate: {
      schemaVersion: 2,
      contractSha256: profile.contractRawSha256,
      evaluatorPatchSha256: evaluator.patchSha256,
      patchSha256: attempt.patchSha256,
      commit: candidate.commit,
      tree: candidate.tree,
      pathStatuses: [
        { path: createdPath, status: "A" },
        { path: presentPath, status: "M" },
      ],
      createdBlobs: [createdBlob],
      manifests: {
        full: { entries: 11, sha256: sha256("v7-candidate-full") },
        protected: candidate.protectedManifest,
      },
    },
  };
  const workerInvocations = nativeInvocations.map((item) =>
    workerV2Envelope(
      item,
      taskV2,
      item.role === "implementation"
        ? {
            modificationPatch: patch,
            creations: [{ path: createdPath, content: createdContent }],
            finalPatch: patch,
            candidateProjection,
          }
        : {},
    ),
  );
  const workerReviewInvocation = workerV2Envelope(reviewInvocation, taskV2);
  const review = {
    id: "v7-review-1",
    attemptId: attempt.id,
    provider: "claude",
    model: control.providerModels.claude,
    invocationId: reviewInvocation.id,
    upstreamReceipts: upstream("v7-upstream-review", [
      {
        role: "review",
        provider: "claude",
        model: control.providerModels.claude,
      },
    ]),
    candidateSha256: attempt.patchSha256,
    outputSha256: workerReviewInvocation.result.invocation.providerOutputSha256,
    disposition: "ACCEPT",
  };
  return createApplicationReceiptV7({
    run,
    control,
    contract,
    taskV2,
    routing,
    nativeInvocations: [...workerInvocations, workerReviewInvocation],
    attempts: [attempt],
    reviews: [review],
    candidateRejections: [],
    selectedCandidate: {
      attemptId: attempt.id,
      patchSha256: attempt.patchSha256,
      commit: candidate.commit,
      tree: candidate.tree,
    },
    final: { verdict: "ACCEPT", reason: "dormant exact v2 evidence" },
    events: [
      ...routing.map(({ id }) => ({ kind: "routing", id })),
      ...workerInvocations.map(({ id }) => ({
        kind: "native-invocation",
        id,
      })),
      { kind: "attempt", id: attempt.id },
      { kind: "native-invocation", id: workerReviewInvocation.id },
      { kind: "review", id: review.id },
      { kind: "selected-candidate", id: attempt.id },
      { kind: "final", id: run.id },
    ],
  });
}

test("pinned application admission is atomic and exact replay is idempotent", async (t) => {
  const frozen = preflight();
  const current = rejectedReceipt(frozen);
  assert.equal(current.schema, "oxigraph.engineering-application-receipt/v6");
  const bytes = serializeApplicationReceipt(current);
  const path = await runtimePath(
    `admission-history-${process.pid}-${Date.now()}.jsonl`,
  );
  t.after(() => rm(path, { force: true }));
  const history = await RouterHistory.open({ path, isIgnoredRuntimePath });

  const first = await admitApplicationReceipt({
    receiptBytes: bytes,
    preflight: frozen,
    history,
  });
  assert.equal(first.outcomeCount, 3);
  assert.equal(history.snapshot().length, 3);
  const replayed = await admitApplicationReceipt({
    receiptBytes: bytes,
    preflight: frozen,
    history,
  });
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
    "oxigraph.engineering-application-receipt/v5",
  ]) {
    const legacy = legacyReceipt(rejectedReceipt(frozen), schema);
    assert.equal(verifyApplicationReceipt(legacy).ok, true, schema);
    assert.throws(
      () => verifyPinnedApplicationReceipt(legacy, frozen),
      /replay-only/,
    );
  }
});

test("legacy replay is rejected before RouterHistory mutation", async () => {
  const frozen = preflight();
  let historyCalls = 0;
  const history = {
    appendBatch: async () => {
      historyCalls += 1;
      return [];
    },
    reload: async () => {
      historyCalls += 1;
      return [];
    },
  };
  for (const schema of [
    "oxigraph.engineering-application-receipt/v1",
    "oxigraph.engineering-application-receipt/v2",
    "oxigraph.engineering-application-receipt/v3",
    "oxigraph.engineering-application-receipt/v4",
    "oxigraph.engineering-application-receipt/v5",
  ]) {
    const legacy = legacyReceipt(rejectedReceipt(frozen), schema);
    const bytes = serializeApplicationReceipt(legacy);
    await assert.rejects(
      admitApplicationReceipt({
        receiptBytes: bytes,
        preflight: frozen,
        history,
      }),
      /replay-only/u,
    );
  }
  assert.equal(historyCalls, 0);
});

test("dormant v7 evidence cannot reach generic admission, hosts, or RouterHistory", async () => {
  const receipt = dormantV7Receipt();
  const bytes = serializeApplicationReceiptV7(receipt);
  assert.equal(verifyApplicationReceiptV7(bytes).ok, true);
  assert.equal(verifyApplicationReceipt(bytes).ok, false);

  let preflightTraps = 0;
  const hostilePreflight = new Proxy(
    {},
    {
      get() {
        preflightTraps += 1;
        throw new Error(
          "generic admission inspected dormant preflight authority",
        );
      },
    },
  );
  let historyCalls = 0;
  const history = {
    appendBatch: async () => {
      historyCalls += 1;
      return [];
    },
    reload: async () => {
      historyCalls += 1;
      return [];
    },
  };

  assert.throws(
    () => verifyPinnedApplicationReceipt(bytes, hostilePreflight),
    /invalid application receipt: unsupported application receipt schema/u,
  );
  await assert.rejects(
    admitApplicationReceipt({
      receiptBytes: bytes,
      preflight: hostilePreflight,
      history,
    }),
    /invalid application receipt: unsupported application receipt schema/u,
  );
  assert.equal(preflightTraps, 0);
  assert.equal(historyCalls, 0);
});
