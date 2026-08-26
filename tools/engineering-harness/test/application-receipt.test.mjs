import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ReceiptLog } from "@metaharness/harness";
import {
  applicationReceiptQualityOutcomes,
  createApplicationReceipt,
  replayApplicationReceipt,
  serializeApplicationReceipt,
  verifyApplicationReceipt,
  verifyApplicationReceiptOutcome,
} from "../src/receipts/application.mjs";
import {
  canonicalJson,
  canonicalSha256,
  routingEmbedding,
} from "../src/routing/features.mjs";
import { directApplicationBinding } from "../src/routing/history.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const oid = (value) => createHash("sha1").update(value).digest("hex");

function upstream(runId, assignments, verdict = "pass") {
  const log = new ReceiptLog();
  for (const { role: workerRole, provider, model } of assignments) {
    log.append({
      runId,
      step:
        workerRole === "review"
          ? "oxigraph-review:review"
          : `oxigraph-candidate:${workerRole}`,
      input: { workerRole, frozen: true },
      output: { workerRole, candidate: "sealed" },
      agent: `${provider}:${workerRole}`,
      model,
      costUsd: 0,
      latencyMs: 1,
      verdict,
    });
  }
  assert.deepEqual(log.verify(), { ok: true });
  return structuredClone(log.entries());
}

function routingContext(taskId, run, control, contract, workerRole) {
  return {
    taskId,
    taskClass: run.taskClass,
    role: workerRole,
    contractSha256: contract.sha256,
    evaluatorSha256: contract.evaluator.patchSha256,
    harnessSha256: control.harnessSha256,
    models: structuredClone(control.providerModels),
  };
}

function pairedDecision(context, control, contract) {
  return {
    mode: "paired",
    reason: "cold-start",
    providers: ["codex", "claude"],
    models: structuredClone(control.providerModels),
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
  };
}

function routedDecision(context, control, contract, provider) {
  const bin = {
    lo: 0,
    hi: 1,
    count: 5,
    meanPredicted: 0.8,
    meanRealized: 0.8,
    gap: 0,
  };
  const report = {
    samples: 5,
    brier: 0.1,
    ece: 0.1,
    bins: [bin],
    worstBin: bin,
  };
  return {
    mode: "routed",
    reason: "quality-first",
    provider,
    model: control.providerModels[provider],
    predictedQuality: 0.8,
    metBar: true,
    embedding: [...routingEmbedding(context)],
    providerOrder: ["codex", "claude"],
    pairedSamples: 5,
    admittedSincePair: 1,
    calibration: {
      status: "READY",
      minimumSamples: 5,
      pairedSamples: 5,
      reports: { codex: report, claude: report },
    },
    fingerprintSha256: canonicalSha256({
      contractSha256: contract.sha256,
      evaluatorSha256: contract.evaluator.patchSha256,
      harnessSha256: control.harnessSha256,
      models: control.providerModels,
    }),
    engine: "@metaharness/router.Router",
  };
}

function invocation(
  id,
  routingId,
  sequence,
  provider,
  workerRole,
  selectedModel,
  { status = "ACCEPT", patch = null, executionId = null } = {},
) {
  const executable = `/usr/bin/${provider}`;
  return {
    id,
    routingId,
    sequence,
    executionId:
      executionId ??
      (workerRole === "review"
        ? "review-execution"
        : workerRole === "repair"
          ? `${id}-execution`
          : "candidate-execution"),
    provider,
    role: workerRole,
    model: selectedModel,
    status,
    executable,
    args: ["--model", selectedModel],
    executableAttestation: {
      provider,
      discoveredPath: executable,
      path: executable,
      sha256: sha(`${provider}-executable`),
      size: 1024,
      mode: 0o755,
      uid: 0,
      gid: 0,
    },
    taskSha256: sha(`${id}-task`),
    promptSha256: sha(`${id}-prompt`),
    process: {
      disposition: "completed",
      exitCode: 0,
      signal: null,
      durationMs: 1,
      stdoutSha256: sha(`${id}-stdout`),
      stderrSha256: sha(`${id}-stderr`),
      terminationErrors: [],
    },
    outputSha256: sha(`${id}-output`),
    patchSha256: patch === null ? null : sha(patch),
  };
}

function command(name) {
  const logicalArgv =
    name === "format"
      ? ["cargo", "fmt", "--check"]
      : name === "build"
        ? ["cargo", "test", "--no-run"]
        : ["cargo", "test", "--test", name];
  return {
    name,
    logicalArgv,
    sandboxArgv: ["--unshare-net", "--", ...logicalArgv],
    network: "isolated",
    workspace: "read-only",
    exitCode: 0,
    signal: null,
    disposition: "completed",
    durationMs: 2,
    stdoutSha256: sha(`${name}-stdout`),
    stderrSha256: sha(`${name}-stderr`),
    stdoutTail: [
      "public",
      "service",
      "compatibility",
      "independent",
      "regression",
    ].includes(name)
      ? "test result: ok. 1 passed; 0 failed;"
      : "",
    stderrTail: "",
  };
}

function draft() {
  const run = {
    id: "application-run-1",
    taskId: "G1.2",
    taskClass: "transaction-concurrency",
    startedAt: "2026-08-25T10:00:00.000Z",
    completedAt: "2026-08-25T10:01:00.000Z",
  };
  const control = {
    harnessSha256: sha("harness-v1"),
    providerModels: {
      codex: "gpt-5.6-sol",
      claude: "claude-sonnet-5",
    },
  };
  const contract = {
    sha256: sha("contract-v1"),
    baseline: { commit: oid("baseline-commit"), tree: oid("baseline-tree") },
    evaluator: {
      commit: oid("evaluator-commit"),
      tree: oid("evaluator-tree"),
      patchSha256: sha("evaluator-patch"),
    },
    success: {
      publicPassed: 1,
      independentPassed: 1,
      regressionPassed: 1,
    },
  };
  const routeRoles = ["architecture", "critique", "implementation", "review"];
  const routing = routeRoles.map((workerRole) => {
    const context = routingContext(run.taskId, run, control, contract, workerRole);
    return {
      id: `route-${workerRole}`,
      role: workerRole,
      context,
      decision: pairedDecision(context, control, contract),
    };
  });
  const patch = [
    "diff --git a/lib.rs b/lib.rs",
    "--- a/lib.rs",
    "+++ b/lib.rs",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const nativeInvocations = [
    invocation("invoke-architecture", "route-architecture", 1, "codex", "architecture", control.providerModels.codex),
    invocation("invoke-critique", "route-critique", 2, "claude", "critique", control.providerModels.claude),
    invocation("invoke-implementation", "route-implementation", 3, "codex", "implementation", control.providerModels.codex, { patch }),
    invocation("invoke-review", "route-review", 4, "claude", "review", control.providerModels.claude),
  ];
  const patchSha256 = sha(patch);
  const protectedManifest = { entries: 12, sha256: sha("protected-manifest") };
  const candidate = {
    commit: oid("candidate-commit"),
    tree: oid("candidate-tree"),
    protectedManifest,
  };
  const attempts = [
    {
      id: "attempt-1",
      parentAttemptId: null,
      roles: ["architecture", "critique", "implementation"],
      providersByRole: {
        architecture: "codex",
        critique: "claude",
        implementation: "codex",
      },
      modelsByRole: {
        architecture: control.providerModels.codex,
        critique: control.providerModels.claude,
        implementation: control.providerModels.codex,
      },
      invocationIds: [
        "invoke-architecture",
        "invoke-critique",
        "invoke-implementation",
      ],
      upstreamReceipts: upstream(
        "candidate-upstream-1",
        [
          { role: "architecture", provider: "codex", model: control.providerModels.codex },
          { role: "critique", provider: "claude", model: control.providerModels.claude },
          { role: "implementation", provider: "codex", model: control.providerModels.codex },
        ],
      ),
      patch,
      patchSha256,
      candidate,
      verifier: {
        verdict: "ACCEPT",
        stage: "complete",
        commands: ["format", "build", "public", "independent", "regression"].map(command),
        artifacts: [
          { name: "concurrent_histories-deadbeef", sha256: sha("artifact"), bytes: 8192 },
        ],
        durationMs: 10,
        candidateTree: candidate.tree,
        protectedManifest,
      },
      repairCycle: 0,
      disposition: "ACCEPT",
    },
  ];
  const reviews = [
    {
      id: "review-1",
      attemptId: "attempt-1",
      provider: "claude",
      model: control.providerModels.claude,
      invocationId: "invoke-review",
      upstreamReceipts: upstream(
        "review-upstream-1",
        [
          { role: "review", provider: "claude", model: control.providerModels.claude },
        ],
      ),
      candidateSha256: patchSha256,
      outputSha256: nativeInvocations[3].outputSha256,
      disposition: "ACCEPT",
    },
  ];
  const selectedCandidate = {
    attemptId: "attempt-1",
    patchSha256,
    commit: candidate.commit,
    tree: candidate.tree,
  };
  const final = { verdict: "ACCEPT", reason: "all frozen application gates passed" };
  const events = [
    { kind: "routing", id: "route-architecture" },
    { kind: "native-invocation", id: "invoke-architecture" },
    { kind: "routing", id: "route-critique" },
    { kind: "native-invocation", id: "invoke-critique" },
    { kind: "routing", id: "route-implementation" },
    { kind: "native-invocation", id: "invoke-implementation" },
    { kind: "attempt", id: "attempt-1" },
    { kind: "routing", id: "route-review" },
    { kind: "native-invocation", id: "invoke-review" },
    { kind: "review", id: "review-1" },
    { kind: "selected-candidate", id: "attempt-1" },
    { kind: "final", id: run.id },
  ];
  return {
    run,
    control,
    contract,
    routing,
    nativeInvocations,
    attempts,
    reviews,
    candidateRejections: [],
    selectedCandidate,
    final,
    events,
  };
}

function reconstructionRejectionDraft() {
  const value = draft();
  const invocation = value.nativeInvocations[2];
  const rejection = {
    id: "candidate-rejection-1",
    candidateId: invocation.executionId,
    invocationId: invocation.id,
    patchSha256: invocation.patchSha256,
    phase: "reconstruction",
    failureCode: "candidate-reconstruction-failed",
    failureDetailSha256: sha("bounded canonical reconstruction failure"),
  };
  value.routing = value.routing.slice(0, 3);
  value.nativeInvocations = value.nativeInvocations.slice(0, 3);
  value.attempts = [];
  value.reviews = [];
  value.candidateRejections = [rejection];
  value.selectedCandidate = null;
  value.final = {
    verdict: "INCONCLUSIVE",
    reason: "no application-verifiable candidate was produced",
  };
  value.events = [
    { kind: "routing", id: "route-architecture" },
    { kind: "native-invocation", id: "invoke-architecture" },
    { kind: "routing", id: "route-critique" },
    { kind: "native-invocation", id: "invoke-critique" },
    { kind: "routing", id: "route-implementation" },
    { kind: "native-invocation", id: "invoke-implementation" },
    { kind: "candidate-rejection", id: rejection.id },
    { kind: "selected-candidate", id: "none" },
    { kind: "final", id: value.run.id },
  ];
  return value;
}

function rejectedReviewDraft({
  summary = "The candidate violates the effective-capability boundary.",
  findings = ["The advertised SERVICE claim exceeds the effective handler."],
} = {}) {
  const value = draft();
  const output = {
    summary,
    patch: null,
    findings,
    verdict: "REJECT",
  };
  const invocation = value.nativeInvocations[3];
  invocation.status = "REJECT";
  invocation.outputSha256 = sha(JSON.stringify(output));
  invocation.reviewDiagnostic = { summary, findings };
  value.reviews[0].outputSha256 = invocation.outputSha256;
  value.reviews[0].disposition = "REJECT";
  value.final = { verdict: "REJECT", reason: "independent review rejected" };
  return value;
}

function sevenStageDraft({ compatibilityOutputPassed = 1 } = {}) {
  const value = draft();
  value.contract.success.servicePassed = 17;
  value.contract.success.compatibilityPassed = 1;
  const service = command("service");
  service.stdoutTail = "test result: ok. 17 passed; 0 failed;";
  const compatibility = command("compatibility");
  compatibility.stdoutTail =
    `test result: ok. ${compatibilityOutputPassed} passed; 0 failed;`;
  value.attempts[0].verifier.commands.splice(
    3,
    0,
    service,
    compatibility,
  );
  return value;
}

function recordFor(receipt, event) {
  const collection = {
    routing: receipt.routing,
    "native-invocation": receipt.nativeInvocations,
    attempt: receipt.attempts,
    review: receipt.reviews,
    "candidate-rejection": receipt.candidateRejections,
  }[event.kind];
  if (collection) return collection.find(({ id }) => id === event.id);
  if (event.kind === "selected-candidate") return receipt.selectedCandidate;
  if (event.kind === "final") return receipt.final;
  throw new Error(`unknown event ${event.kind}`);
}

function relabelLegacyReceipt(receipt, schema) {
  receipt.schema = schema;
  delete receipt.candidateRejections;
  receipt.events = receipt.events.filter(
    ({ kind }) => kind !== "candidate-rejection",
  );
  return receipt;
}

function resealTamperedReceipt(receipt) {
  let previousSha256 = "0".repeat(64);
  for (let index = 0; index < receipt.events.length; index += 1) {
    const event = receipt.events[index];
    const body = {
      sequence: index + 1,
      previousSha256,
      bindingSha256: event.bindingSha256,
      kind: event.kind,
      id: event.id,
      recordSha256: canonicalSha256(recordFor(receipt, event)),
    };
    receipt.events[index] = { ...body, entrySha256: canonicalSha256(body) };
    previousSha256 = receipt.events[index].entrySha256;
  }
  receipt.chain.entryCount = receipt.events.length;
  receipt.chain.tailSha256 = previousSha256;
  receipt.chain.eventsSha256 = canonicalSha256(receipt.events);
  const { receiptSha256: _old, ...body } = receipt;
  receipt.receiptSha256 = canonicalSha256(body);
  return receipt;
}

function qualityOutcomeFor(
  receipt,
  { attemptId = "attempt-1", reviewId = null, role = null, quality },
) {
  const attempt = receipt.attempts.find(({ id }) => id === attemptId);
  const review = receipt.reviews.find(({ id }) => id === reviewId);
  const workerRole =
    review === undefined
      ? role ?? (attempt.repairCycle === 0 ? "implementation" : "repair")
      : "review";
  const invocationId = review?.invocationId ?? attempt.invocationIds.find((id) =>
    receipt.nativeInvocations.find((item) => item.id === id)?.role === workerRole,
  );
  const invocation = receipt.nativeInvocations.find(({ id }) => id === invocationId);
  const route = receipt.routing.find(({ id }) => id === invocation.routingId);
  const outcome = {
    taskId: route.context.taskId,
    taskClass: route.context.taskClass,
    role: workerRole,
    provider: invocation.provider,
    model: invocation.model,
    models: structuredClone(receipt.control.providerModels),
    candidateSha256: attempt.patchSha256,
    evaluatorSha256: receipt.contract.evaluator.patchSha256,
    contractSha256: receipt.contract.sha256,
    harnessSha256: receipt.control.harnessSha256,
    disposition: "verified",
    quality,
    mode: route.decision.mode,
    pairId:
      route.decision.mode === "paired"
        ? `${route.context.taskId}:${workerRole}`
        : null,
    repairCycles: attempt.repairCycle,
  };
  if (route.decision.mode === "routed") {
    outcome.predictedQuality = route.decision.predictedQuality;
  }
  return outcome;
}

function rejectionOutcomeFor(receipt, quality) {
  const rejection = receipt.candidateRejections[0];
  const invocation = receipt.nativeInvocations.find(
    ({ id }) => id === rejection.invocationId,
  );
  const route = receipt.routing.find(({ id }) => id === invocation.routingId);
  return {
    taskId: route.context.taskId,
    taskClass: route.context.taskClass,
    role: invocation.role,
    provider: invocation.provider,
    model: invocation.model,
    models: structuredClone(receipt.control.providerModels),
    candidateSha256: rejection.patchSha256,
    evaluatorSha256: receipt.contract.evaluator.patchSha256,
    contractSha256: receipt.contract.sha256,
    harnessSha256: receipt.control.harnessSha256,
    disposition: "verified",
    quality,
    mode: route.decision.mode,
    pairId: `${route.context.taskId}:${invocation.role}`,
    repairCycles: 0,
  };
}

function addRejectedRepair(
  value,
  {
    id = "attempt-2",
    parentAttemptId = "attempt-1",
    repairCycle = 1,
    provider = "claude",
  } = {},
) {
  const workerRole = "repair";
  const routeId = `route-${id}`;
  const invocationId = `invoke-${id}`;
  const taskId = `${value.run.id}:repair:${parentAttemptId}:${repairCycle}`;
  const context = routingContext(
    taskId,
    value.run,
    value.control,
    value.contract,
    workerRole,
  );
  value.routing.push({
    id: routeId,
    role: workerRole,
    context,
    decision: pairedDecision(context, value.control, value.contract),
  });
  const patch = [
    `diff --git a/${id}.rs b/${id}.rs`,
    `--- a/${id}.rs`,
    `+++ b/${id}.rs`,
    "@@ -1 +1 @@",
    "-old",
    "+repair",
    "",
  ].join("\n");
  const selectedModel = value.control.providerModels[provider];
  value.nativeInvocations.push(
    invocation(
      invocationId,
      routeId,
      value.nativeInvocations.length + 1,
      provider,
      workerRole,
      selectedModel,
      { patch },
    ),
  );
  const commands = ["format", "build", "public", "independent", "regression"].map(command);
  commands.at(-1).exitCode = 1;
  const protectedManifest = {
    entries: 12,
    sha256: sha(`${id}-protected-manifest`),
  };
  value.attempts.push({
    id,
    parentAttemptId,
    roles: [workerRole],
    providersByRole: { [workerRole]: provider },
    modelsByRole: { [workerRole]: selectedModel },
    invocationIds: [invocationId],
    upstreamReceipts: upstream(`${id}-upstream`, [
      { role: workerRole, provider, model: selectedModel },
    ]),
    patch,
    patchSha256: sha(patch),
    candidate: {
      commit: oid(`${id}-commit`),
      tree: oid(`${id}-tree`),
      protectedManifest,
    },
    verifier: {
      verdict: "REJECT",
      stage: "evaluation",
      commands,
      artifacts: [
        { name: `${id}-artifact`, sha256: sha(`${id}-artifact`), bytes: 4096 },
      ],
      durationMs: 11,
      candidateTree: oid(`${id}-tree`),
      protectedManifest,
    },
    repairCycle,
    disposition: "REJECT",
  });
  const selectionIndex = value.events.findIndex(
    ({ kind }) => kind === "selected-candidate",
  );
  value.events.splice(
    selectionIndex,
    0,
    { kind: "routing", id: routeId },
    { kind: "native-invocation", id: invocationId },
    { kind: "attempt", id },
  );
  return value;
}

test("application receipt has an exact deterministic round trip and quality binding", () => {
  const value = draft();
  value.nativeInvocations[3].args.push("--tools", "");
  const left = createApplicationReceipt(value);
  const rightValue = draft();
  rightValue.nativeInvocations[3].args.push("--tools", "");
  const right = createApplicationReceipt(rightValue);
  const serialized = serializeApplicationReceipt(left);
  assert.equal(serialized.match(/"schema":/g)?.length, 1);
  assert.equal(serialized, serializeApplicationReceipt(right));
  assert.equal(serializeApplicationReceipt(replayApplicationReceipt(serialized)), serialized);
  const verified = verifyApplicationReceipt(serialized);
  assert.equal(verified.ok, true);
  assert.equal(verified.entryCount, 12);
  assert.equal(Object.isFrozen(verified.receipt), true);
  assert.deepEqual(left.attempts[0].providersByRole, {
    architecture: "codex",
    critique: "claude",
    implementation: "codex",
  });
  assert.equal(left.attempts[0].verifier.commands[0].workspace, "read-only");
  assert.deepEqual(left.nativeInvocations[3].args.slice(-2), ["--tools", ""]);
  assert.equal(
    left.attempts[0].verifier.commands[2].stdoutTail,
    "test result: ok. 1 passed; 0 failed;",
  );

  const enumerated = applicationReceiptQualityOutcomes(serialized);
  assert.equal(Object.isFrozen(enumerated), true);
  assert.deepEqual(
    enumerated.map(({ recordId }) => recordId),
    [
      "attempt:attempt-1:architecture",
      "attempt:attempt-1:critique",
      "attempt:attempt-1:implementation",
      "review:review-1",
    ],
  );

  for (const workerRole of ["architecture", "critique", "implementation"]) {
    const outcome = qualityOutcomeFor(left, { role: workerRole, quality: 1 });
    const binding = verifyApplicationReceiptOutcome(
      serialized,
      outcome,
    );
    assert.equal(binding.verified, true, workerRole);
    assert.deepEqual(binding.binding, directApplicationBinding(outcome));
    assert.equal(binding.bindingSha256, canonicalSha256(binding.binding));
    assert.equal(binding.attemptId, "attempt-1");
    assert.equal(binding.reviewId, null);
  }
  const reviewBinding = verifyApplicationReceiptOutcome(
    serialized,
    qualityOutcomeFor(left, { reviewId: "review-1", quality: 1 }),
  );
  assert.equal(reviewBinding.verified, true);
  assert.equal(reviewBinding.reviewId, "review-1");
});

test("v6 receipts seal candidate-specific reconstruction rejection evidence without quality", () => {
  const left = createApplicationReceipt(reconstructionRejectionDraft());
  const right = createApplicationReceipt(reconstructionRejectionDraft());
  assert.equal(left.schema, "oxigraph.engineering-application-receipt/v6");
  assert.deepEqual(left.candidateRejections, [
    {
      id: "candidate-rejection-1",
      candidateId: "candidate-execution",
      invocationId: "invoke-implementation",
      patchSha256: sha([
        "diff --git a/lib.rs b/lib.rs",
        "--- a/lib.rs",
        "+++ b/lib.rs",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "",
      ].join("\n")),
      phase: "reconstruction",
      failureCode: "candidate-reconstruction-failed",
      failureDetailSha256: sha("bounded canonical reconstruction failure"),
    },
  ]);
  assert.equal(serializeApplicationReceipt(left), serializeApplicationReceipt(right));
  assert.equal(verifyApplicationReceipt(left).ok, true);
  assert.deepEqual(applicationReceiptQualityOutcomes(left), []);
  assert.equal(
    left.events.find(({ kind }) => kind === "candidate-rejection").id,
    "candidate-rejection-1",
  );
});

test("candidate rejection schema is exact, bounded, and pair-classified", () => {
  for (const field of ["error", "message", "stdout", "stderr", "path", "candidateTree"]) {
    const value = reconstructionRejectionDraft();
    value.candidateRejections[0][field] = `private-${field}`;
    assert.throws(
      () => createApplicationReceipt(value),
      new RegExp(`unknown field: ${field}`, "u"),
    );
  }

  for (const [phase, failureCode] of [
    ["reconstruction", "frozen-submodules-failed"],
    ["applicability", "candidate-reconstruction-failed"],
    ["cleanup", "candidate-disposal-failed"],
  ]) {
    const value = reconstructionRejectionDraft();
    value.candidateRejections[0].phase = phase;
    value.candidateRejections[0].failureCode = failureCode;
    assert.throws(
      () => createApplicationReceipt(value),
      /unsupported phase\/failureCode pair/u,
    );
  }

  const missing = reconstructionRejectionDraft();
  delete missing.candidateRejections[0].candidateId;
  assert.throws(
    () => createApplicationReceipt(missing),
    /missing field: candidateId/u,
  );

  const malformed = reconstructionRejectionDraft();
  malformed.candidateRejections[0].failureDetailSha256 = "not-a-digest";
  assert.throws(
    () => createApplicationReceipt(malformed),
    /lowercase SHA-256 digest/u,
  );

  const oversized = reconstructionRejectionDraft();
  oversized.candidateRejections = Array.from({ length: 2049 }, (_, index) => ({
    ...oversized.candidateRejections[0],
    id: `candidate-rejection-${index}`,
  }));
  assert.throws(
    () => createApplicationReceipt(oversized),
    /candidateRejections must be a bounded array/u,
  );
});

test("candidate rejections bind exactly one successful patch-producing invocation", () => {
  const original = serializeApplicationReceipt(
    createApplicationReceipt(reconstructionRejectionDraft()),
  );
  for (const [mutate, reason] of [
    [
      (receipt) => {
        receipt.candidateRejections[0].candidateId = "different-candidate";
      },
      /exact candidate, invocation, and patch/u,
    ],
    [
      (receipt) => {
        receipt.candidateRejections[0].invocationId = "unknown-invocation";
      },
      /successful patch-producing invocation/u,
    ],
    [
      (receipt) => {
        receipt.candidateRejections[0].patchSha256 = sha("different-patch");
      },
      /exact candidate, invocation, and patch/u,
    ],
    [
      (receipt) => {
        receipt.candidateRejections[0].invocationId = "invoke-architecture";
      },
      /successful patch-producing invocation/u,
    ],
    [
      (receipt) => {
        receipt.nativeInvocations[2].status = "REJECT";
      },
      /successful patch-producing invocation/u,
    ],
  ]) {
    const receipt = JSON.parse(original);
    mutate(receipt);
    resealTamperedReceipt(receipt);
    const result = verifyApplicationReceipt(receipt);
    assert.equal(result.ok, false);
    assert.match(result.reason, reason);
  }

  const duplicate = reconstructionRejectionDraft();
  duplicate.candidateRejections.push({
    ...duplicate.candidateRejections[0],
    id: "candidate-rejection-2",
    phase: "applicability",
    failureCode: "candidate-verifier-failed",
  });
  duplicate.events.splice(-2, 0, {
    kind: "candidate-rejection",
    id: "candidate-rejection-2",
  });
  assert.throws(
    () => createApplicationReceipt(duplicate),
    /duplicates a rejection for native invocation/u,
  );

  const admitted = draft();
  admitted.candidateRejections = [
    {
      ...reconstructionRejectionDraft().candidateRejections[0],
      id: "candidate-rejection-admitted",
    },
  ];
  admitted.events.splice(-2, 0, {
    kind: "candidate-rejection",
    id: "candidate-rejection-admitted",
  });
  assert.throws(
    () => createApplicationReceipt(admitted),
    /already admitted by an attempt or review/u,
  );
});

test("v6 accounts for every successful patch invocation and orders rejection events", () => {
  const missing = reconstructionRejectionDraft();
  missing.candidateRejections = [];
  missing.events = missing.events.filter(
    ({ kind }) => kind !== "candidate-rejection",
  );
  assert.throws(
    () => createApplicationReceipt(missing),
    /successful patch-producing invocation invoke-implementation is not accounted/u,
  );

  const original = JSON.parse(
    serializeApplicationReceipt(
      createApplicationReceipt(reconstructionRejectionDraft()),
    ),
  );
  const invocationIndex = original.events.findIndex(
    ({ kind, id }) =>
      kind === "native-invocation" && id === "invoke-implementation",
  );
  const rejectionIndex = original.events.findIndex(
    ({ kind }) => kind === "candidate-rejection",
  );
  [original.events[invocationIndex], original.events[rejectionIndex]] = [
    original.events[rejectionIndex],
    original.events[invocationIndex],
  ];
  resealTamperedReceipt(original);
  const reordered = verifyApplicationReceipt(original);
  assert.equal(reordered.ok, false);
  assert.match(reordered.reason, /occurs before its native invocation/u);

  const afterSelection = JSON.parse(
    serializeApplicationReceipt(
      createApplicationReceipt(reconstructionRejectionDraft()),
    ),
  );
  const rejection = afterSelection.events.splice(
    afterSelection.events.findIndex(({ kind }) => kind === "candidate-rejection"),
    1,
  )[0];
  afterSelection.events.splice(-1, 0, rejection);
  resealTamperedReceipt(afterSelection);
  const late = verifyApplicationReceipt(afterSelection);
  assert.equal(late.ok, false);
  assert.match(late.reason, /selection and final verdict must close/u);
});

test("parallel rejection lanes remain distinct even for identical patch bytes", () => {
  const value = reconstructionRejectionDraft();
  const patch = [
    "diff --git a/lib.rs b/lib.rs",
    "--- a/lib.rs",
    "+++ b/lib.rs",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "",
  ].join("\n");
  const secondInvocation = invocation(
    "invoke-implementation-2",
    "route-implementation",
    4,
    "claude",
    "implementation",
    value.control.providerModels.claude,
    { patch, executionId: "candidate-execution-2" },
  );
  const secondRejection = {
    ...value.candidateRejections[0],
    id: "candidate-rejection-2",
    candidateId: secondInvocation.executionId,
    invocationId: secondInvocation.id,
    failureDetailSha256: sha("second bounded rejection detail"),
  };
  value.nativeInvocations.push(secondInvocation);
  value.candidateRejections.push(secondRejection);
  value.events.splice(
    -2,
    0,
    { kind: "native-invocation", id: secondInvocation.id },
    { kind: "candidate-rejection", id: secondRejection.id },
  );
  const receipt = createApplicationReceipt(value);
  assert.equal(receipt.candidateRejections.length, 2);
  assert.equal(
    new Set(receipt.candidateRejections.map(({ patchSha256 }) => patchSha256)).size,
    1,
  );
  assert.equal(
    new Set(receipt.candidateRejections.map(({ invocationId }) => invocationId)).size,
    2,
  );
  assert.equal(
    new Set(receipt.candidateRejections.map(({ candidateId }) => candidateId)).size,
    2,
  );

  const omitted = JSON.parse(serializeApplicationReceipt(receipt));
  omitted.candidateRejections.pop();
  omitted.events = omitted.events.filter(
    ({ kind, id }) => kind !== "candidate-rejection" || id !== secondRejection.id,
  );
  resealTamperedReceipt(omitted);
  const omittedResult = verifyApplicationReceipt(omitted);
  assert.equal(omittedResult.ok, false);
  assert.match(omittedResult.reason, /is not accounted/u);
});

test("candidate rejection evidence never authorizes Router quality", () => {
  const rejectionOnly = createApplicationReceipt(reconstructionRejectionDraft());
  for (const quality of [0, 1]) {
    assert.equal(
      verifyApplicationReceiptOutcome(
        rejectionOnly,
        rejectionOutcomeFor(rejectionOnly, quality),
      ).verified,
      false,
    );
  }

  const mixed = draft();
  const rejectedPatch = "diff --git a/rejected.rs b/rejected.rs\n--- a/rejected.rs\n+++ b/rejected.rs\n";
  const rejectedInvocation = invocation(
    "invoke-rejected-implementation",
    "route-implementation",
    5,
    "claude",
    "implementation",
    mixed.control.providerModels.claude,
    { patch: rejectedPatch, executionId: "rejected-candidate-execution" },
  );
  const rejection = {
    id: "candidate-rejection-mixed",
    candidateId: rejectedInvocation.executionId,
    invocationId: rejectedInvocation.id,
    patchSha256: rejectedInvocation.patchSha256,
    phase: "reconstruction",
    failureCode: "candidate-reconstruction-failed",
    failureDetailSha256: sha("mixed rejection detail"),
  };
  mixed.nativeInvocations.push(rejectedInvocation);
  mixed.candidateRejections.push(rejection);
  mixed.events.splice(
    -2,
    0,
    { kind: "native-invocation", id: rejectedInvocation.id },
    { kind: "candidate-rejection", id: rejection.id },
  );
  const mixedReceipt = createApplicationReceipt(mixed);
  const outcomes = applicationReceiptQualityOutcomes(mixedReceipt);
  assert.equal(outcomes.length, 4);
  assert.equal(
    outcomes.some(
      ({ outcome }) => outcome.candidateSha256 === rejectedInvocation.patchSha256,
    ),
    false,
  );
});

test("legacy v1 through v5 receipts replay byte-for-byte without v6 fields", () => {
  const current = createApplicationReceipt(draft());
  // Frozen from committed pre-v6 control HEAD 8a6abd6e using this historical
  // draft and the then-current v1-v5 replay paths.
  const frozenLegacyFixtures = new Map([
    [
      "oxigraph.engineering-application-receipt/v1",
      ["0b7d3695e374a007d4ea93bb0d2b536cec1bc9ac3c2426b276a51f897193b94c", 21001],
    ],
    [
      "oxigraph.engineering-application-receipt/v2",
      ["a6f2854f2f9aa706ed982ffae1c4dde72e464f307fc8bda6f01b658ff7ee5309", 21142],
    ],
    [
      "oxigraph.engineering-application-receipt/v3",
      ["f647421dbdb2d99e03c03029a072061b8906229d89b98007423450bf01e6c550", 21142],
    ],
    [
      "oxigraph.engineering-application-receipt/v4",
      ["847a2509d2e348a721678a484b285e8a40e69d5e1df97f757ea02c58dbb17eab", 21142],
    ],
    [
      "oxigraph.engineering-application-receipt/v5",
      ["b3fb59d79311a4a9714d3a5ace8425c506106cf2d4b0e4f4b6930fe9e3206c49", 21142],
    ],
  ]);
  for (const schema of [
    "oxigraph.engineering-application-receipt/v1",
    "oxigraph.engineering-application-receipt/v2",
    "oxigraph.engineering-application-receipt/v3",
    "oxigraph.engineering-application-receipt/v4",
    "oxigraph.engineering-application-receipt/v5",
  ]) {
    const legacy = relabelLegacyReceipt(
      JSON.parse(serializeApplicationReceipt(current)),
      schema,
    );
    if (schema.endsWith("/v1")) {
      for (const invocation of legacy.nativeInvocations) {
        delete invocation.executionId;
        delete invocation.failureCode;
        delete invocation.failureDetailSha256;
      }
    }
    resealTamperedReceipt(legacy);
    const bytes = canonicalJson(legacy);
    const [expectedSha256, expectedBytes] = frozenLegacyFixtures.get(schema);
    assert.equal(sha(bytes), expectedSha256, schema);
    assert.equal(Buffer.byteLength(bytes, "utf8"), expectedBytes, schema);
    const replayed = replayApplicationReceipt(bytes);
    assert.equal(serializeApplicationReceipt(replayed), bytes, schema);
    assert.equal(verifyApplicationReceipt(bytes).ok, true, schema);
    assert.equal(Object.hasOwn(replayed, "candidateRejections"), false, schema);
  }
});

test("application receipts admit an optional frozen service evaluator without invalidating five-stage receipts", () => {
  const value = draft();
  value.contract.success.servicePassed = 17;
  const service = command("service");
  service.logicalArgv = [
    "cargo",
    "test",
    "--locked",
    "-p",
    "oxigraph-cli",
    "--bin",
    "oxigraph",
    "service_description::tests::",
  ];
  service.sandboxArgv = ["--unshare-net", "--", ...service.logicalArgv];
  service.stdoutTail = "test result: ok. 17 passed; 0 failed;";
  value.attempts[0].verifier.commands.splice(3, 0, service);

  const receipt = createApplicationReceipt(value);
  assert.equal(receipt.schema, "oxigraph.engineering-application-receipt/v6");
  assert.deepEqual(
    receipt.attempts[0].verifier.commands.map(({ name }) => name),
    ["format", "build", "public", "service", "independent", "regression"],
  );
  assert.equal(applicationReceiptQualityOutcomes(receipt).length, 4);
  assert.equal(verifyApplicationReceipt(receipt).ok, true);

  const historicalV4 = JSON.parse(serializeApplicationReceipt(receipt));
  relabelLegacyReceipt(
    historicalV4,
    "oxigraph.engineering-application-receipt/v4",
  );
  resealTamperedReceipt(historicalV4);
  const historicalBytes = serializeApplicationReceipt(historicalV4);
  assert.equal(verifyApplicationReceipt(historicalBytes).ok, true);
  assert.equal(
    serializeApplicationReceipt(replayApplicationReceipt(historicalBytes)),
    historicalBytes,
  );

  assert.equal(verifyApplicationReceipt(createApplicationReceipt(draft())).ok, true);
});

test("v6 and legacy v5 receipts bind the seven-stage compatibility gate and reject vacuous success", () => {
  const receipt = createApplicationReceipt(sevenStageDraft());
  assert.equal(receipt.schema, "oxigraph.engineering-application-receipt/v6");
  assert.deepEqual(
    receipt.attempts[0].verifier.commands.map(({ name }) => name),
    [
      "format",
      "build",
      "public",
      "service",
      "compatibility",
      "independent",
      "regression",
    ],
  );
  assert.equal(receipt.contract.success.compatibilityPassed, 1);
  assert.equal(verifyApplicationReceipt(receipt).ok, true);

  const historicalV5 = JSON.parse(serializeApplicationReceipt(receipt));
  relabelLegacyReceipt(
    historicalV5,
    "oxigraph.engineering-application-receipt/v5",
  );
  resealTamperedReceipt(historicalV5);
  assert.equal(verifyApplicationReceipt(historicalV5).ok, true);

  assert.throws(
    () => createApplicationReceipt(sevenStageDraft({ compatibilityOutputPassed: 0 })),
    /ACCEPT without full successful verification/u,
  );

  const mislabelledV4 = JSON.parse(serializeApplicationReceipt(receipt));
  relabelLegacyReceipt(
    mislabelledV4,
    "oxigraph.engineering-application-receipt/v4",
  );
  resealTamperedReceipt(mislabelledV4);
  const legacyResult = verifyApplicationReceipt(mislabelledV4);
  assert.equal(legacyResult.ok, false);
  assert.match(legacyResult.reason, /unknown field: compatibilityPassed/u);
});

test("legacy v1 receipts remain replayable but preserve their reduced evidence shape", () => {
  const legacy = JSON.parse(
    serializeApplicationReceipt(createApplicationReceipt(draft())),
  );
  relabelLegacyReceipt(legacy, "oxigraph.engineering-application-receipt/v1");
  for (const invocation of legacy.nativeInvocations) {
    delete invocation.executionId;
    delete invocation.failureCode;
    delete invocation.failureDetailSha256;
  }
  resealTamperedReceipt(legacy);
  const verified = verifyApplicationReceipt(legacy);
  assert.equal(verified.ok, true);
  assert.equal(verified.receipt.schema, legacy.schema);
  assert.equal(
    replayApplicationReceipt(serializeApplicationReceipt(legacy)).schema,
    legacy.schema,
  );
  assert.ok(
    verified.receipt.nativeInvocations.every(
      (invocation) => !Object.hasOwn(invocation, "executionId"),
    ),
  );
});

test("v6 through v3 receipts retain hash-bound rejected critique diagnostics while v2 remains replayable", () => {
  const summary = "The architecture is not safe to implement.";
  const findings = ["The capability boundary is underspecified."];
  const rejectedOutput = {
    summary,
    patch: null,
    findings,
    verdict: "REJECT",
  };
  const value = draft();
  const critique = value.nativeInvocations[1];
  critique.status = "REJECT";
  critique.outputSha256 = sha(JSON.stringify(rejectedOutput));
  critique.critiqueDiagnostic = { summary, findings };
  value.nativeInvocations = value.nativeInvocations.slice(0, 2);
  value.attempts = [];
  value.reviews = [];
  value.selectedCandidate = null;
  value.final = {
    verdict: "INCONCLUSIVE",
    reason: "the critique rejected the architecture before implementation",
  };
  value.events = [
    { kind: "routing", id: "route-architecture" },
    { kind: "native-invocation", id: "invoke-architecture" },
    { kind: "routing", id: "route-critique" },
    { kind: "native-invocation", id: "invoke-critique" },
    { kind: "routing", id: "route-implementation" },
    { kind: "routing", id: "route-review" },
    { kind: "selected-candidate", id: "none" },
    { kind: "final", id: value.run.id },
  ];

  const receipt = createApplicationReceipt(value);
  assert.equal(receipt.schema, "oxigraph.engineering-application-receipt/v6");
  assert.deepEqual(receipt.nativeInvocations[1].critiqueDiagnostic, {
    summary,
    findings,
  });
  assert.equal(Object.isFrozen(receipt.nativeInvocations[1].critiqueDiagnostic), true);

  const legacyV4 = JSON.parse(serializeApplicationReceipt(receipt));
  relabelLegacyReceipt(legacyV4, "oxigraph.engineering-application-receipt/v4");
  resealTamperedReceipt(legacyV4);
  assert.equal(verifyApplicationReceipt(legacyV4).ok, true);
  const invalidLegacyV4 = structuredClone(legacyV4);
  delete invalidLegacyV4.nativeInvocations[1].critiqueDiagnostic;
  resealTamperedReceipt(invalidLegacyV4);
  assert.equal(verifyApplicationReceipt(invalidLegacyV4).ok, false);

  const missing = structuredClone(value);
  delete missing.nativeInvocations[1].critiqueDiagnostic;
  assert.throws(
    () => createApplicationReceipt(missing),
    /must retain its rejected critique diagnostic/,
  );

  const oversized = structuredClone(value);
  oversized.nativeInvocations[1].critiqueDiagnostic.summary = "x".repeat(4097);
  assert.throws(
    () => createApplicationReceipt(oversized),
    /summary must be a string of at most 4096 characters/,
  );

  const tampered = JSON.parse(serializeApplicationReceipt(receipt));
  tampered.nativeInvocations[1].critiqueDiagnostic.findings[0] =
    "A different finding.";
  resealTamperedReceipt(tampered);
  const tamperedResult = verifyApplicationReceipt(tampered);
  assert.equal(tamperedResult.ok, false);
  assert.match(tamperedResult.reason, /output hash|critique diagnostic/i);

  const legacyV3 = JSON.parse(serializeApplicationReceipt(receipt));
  relabelLegacyReceipt(legacyV3, "oxigraph.engineering-application-receipt/v3");
  resealTamperedReceipt(legacyV3);
  const legacyV3Result = verifyApplicationReceipt(legacyV3);
  assert.equal(legacyV3Result.ok, true);
  assert.equal(legacyV3Result.receipt.schema, legacyV3.schema);
  assert.deepEqual(
    legacyV3Result.receipt.nativeInvocations[1].critiqueDiagnostic,
    { summary, findings },
  );

  const invalidLegacyV3 = structuredClone(legacyV3);
  delete invalidLegacyV3.nativeInvocations[1].critiqueDiagnostic;
  resealTamperedReceipt(invalidLegacyV3);
  assert.equal(verifyApplicationReceipt(invalidLegacyV3).ok, false);

  const legacyV2 = JSON.parse(serializeApplicationReceipt(receipt));
  relabelLegacyReceipt(legacyV2, "oxigraph.engineering-application-receipt/v2");
  delete legacyV2.nativeInvocations[1].critiqueDiagnostic;
  resealTamperedReceipt(legacyV2);
  const legacyResult = verifyApplicationReceipt(legacyV2);
  assert.equal(legacyResult.ok, true);
  assert.equal(legacyResult.receipt.schema, legacyV2.schema);
  assert.equal(
    replayApplicationReceipt(serializeApplicationReceipt(legacyV2)).schema,
    legacyV2.schema,
  );
});

test("v6 through v4 receipts retain only hash-bound rejected review diagnostics", () => {
  const value = rejectedReviewDraft();
  const receipt = createApplicationReceipt(value);
  const review = receipt.nativeInvocations[3];
  assert.deepEqual(review.reviewDiagnostic, value.nativeInvocations[3].reviewDiagnostic);
  assert.equal(Object.isFrozen(review.reviewDiagnostic), true);
  assert.deepEqual(
    replayApplicationReceipt(serializeApplicationReceipt(receipt)).nativeInvocations[3]
      .reviewDiagnostic,
    review.reviewDiagnostic,
  );

  const legacyV4 = JSON.parse(serializeApplicationReceipt(receipt));
  relabelLegacyReceipt(legacyV4, "oxigraph.engineering-application-receipt/v4");
  resealTamperedReceipt(legacyV4);
  assert.equal(verifyApplicationReceipt(legacyV4).ok, true);
  const invalidLegacyV4 = structuredClone(legacyV4);
  delete invalidLegacyV4.nativeInvocations[3].reviewDiagnostic;
  resealTamperedReceipt(invalidLegacyV4);
  assert.equal(verifyApplicationReceipt(invalidLegacyV4).ok, false);

  const missing = structuredClone(value);
  delete missing.nativeInvocations[3].reviewDiagnostic;
  assert.throws(
    () => createApplicationReceipt(missing),
    /must retain its rejected review diagnostic/u,
  );

  for (const diagnostic of [
    { summary: "x".repeat(4097), findings: [] },
    { summary: "bounded", findings: ["x".repeat(2049)] },
  ]) {
    const oversized = rejectedReviewDraft(diagnostic);
    assert.throws(
      () => createApplicationReceipt(oversized),
      /at most 4096 characters|at most 2048 characters/u,
    );
  }

  const accepted = draft();
  const acceptedReceipt = createApplicationReceipt(accepted);
  assert.equal(
    Object.hasOwn(acceptedReceipt.nativeInvocations[3], "reviewDiagnostic"),
    false,
  );
  accepted.nativeInvocations[3].reviewDiagnostic = {
    summary: "must not be retained",
    findings: [],
  };
  assert.throws(
    () => createApplicationReceipt(accepted),
    /may not retain a review diagnostic/u,
  );

  const tampered = JSON.parse(serializeApplicationReceipt(receipt));
  tampered.nativeInvocations[3].reviewDiagnostic.findings[0] = "Different finding.";
  resealTamperedReceipt(tampered);
  const tamperedResult = verifyApplicationReceipt(tampered);
  assert.equal(tamperedResult.ok, false);
  assert.match(tamperedResult.reason, /output hash|review diagnostic/iu);

  for (const field of ["stdout", "prompt", "secret", "path"]) {
    const hostile = rejectedReviewDraft();
    hostile.nativeInvocations[3].reviewDiagnostic[field] = `private-${field}`;
    assert.throws(
      () => createApplicationReceipt(hostile),
      new RegExp(`unknown field: ${field}`, "u"),
    );
  }

  const legacyV3WithDiagnostic = JSON.parse(serializeApplicationReceipt(receipt));
  relabelLegacyReceipt(
    legacyV3WithDiagnostic,
    "oxigraph.engineering-application-receipt/v3",
  );
  resealTamperedReceipt(legacyV3WithDiagnostic);
  assert.equal(verifyApplicationReceipt(legacyV3WithDiagnostic).ok, true);

  const tamperedLegacyV3 = structuredClone(legacyV3WithDiagnostic);
  tamperedLegacyV3.nativeInvocations[3].reviewDiagnostic.summary =
    "A different review summary.";
  resealTamperedReceipt(tamperedLegacyV3);
  const tamperedLegacyV3Result = verifyApplicationReceipt(tamperedLegacyV3);
  assert.equal(tamperedLegacyV3Result.ok, false);
  assert.match(tamperedLegacyV3Result.reason, /output hash|review diagnostic/iu);

  const historicalV3 = structuredClone(legacyV3WithDiagnostic);
  delete historicalV3.nativeInvocations[3].reviewDiagnostic;
  resealTamperedReceipt(historicalV3);
  const historicalV3Result = verifyApplicationReceipt(historicalV3);
  assert.equal(historicalV3Result.ok, true);
  assert.equal(historicalV3Result.receipt.schema, historicalV3.schema);
  assert.equal(
    Object.hasOwn(historicalV3Result.receipt.nativeInvocations[3], "reviewDiagnostic"),
    false,
  );
  assert.equal(
    replayApplicationReceipt(serializeApplicationReceipt(historicalV3)).schema,
    historicalV3.schema,
  );

  const legacyV2 = structuredClone(historicalV3);
  relabelLegacyReceipt(legacyV2, "oxigraph.engineering-application-receipt/v2");
  resealTamperedReceipt(legacyV2);
  const legacyV2Result = verifyApplicationReceipt(legacyV2);
  assert.equal(legacyV2Result.ok, true);
  assert.equal(legacyV2Result.receipt.schema, legacyV2.schema);
});

test("single-field tampering and unknown fields fail closed", () => {
  const tampered = JSON.parse(serializeApplicationReceipt(createApplicationReceipt(draft())));
  tampered.attempts[0].verifier.commands[2].exitCode = 1;
  const result = verifyApplicationReceipt(tampered);
  assert.equal(result.ok, false);
  assert.match(result.reason, /ACCEPT|hash|bind/i);
  assert.throws(
    () => applicationReceiptQualityOutcomes(tampered),
    /invalid application receipt/,
  );

  const patchTamper = JSON.parse(
    serializeApplicationReceipt(createApplicationReceipt(draft())),
  );
  patchTamper.attempts[0].patch += "# hidden change\n";
  resealTamperedReceipt(patchTamper);
  const patchResult = verifyApplicationReceipt(patchTamper);
  assert.equal(patchResult.ok, false);
  assert.match(patchResult.reason, /admitted patch bytes/);

  const unknown = draft();
  unknown.control.transport = "native";
  assert.throws(() => createApplicationReceipt(unknown), /unknown field: transport/);

  const missingExecution = draft();
  delete missingExecution.nativeInvocations[0].executionId;
  assert.throws(
    () => createApplicationReceipt(missingExecution),
    /bind its native execution id/,
  );

  const mixedExecutions = draft();
  mixedExecutions.nativeInvocations[1].executionId = "different-candidate-lane";
  assert.throws(
    () => createApplicationReceipt(mixedExecutions),
    /different executions/,
  );
});

test("outer receipt rejects a valid-prefix upstream ReceiptLog attack even after resealing", () => {
  const receipt = JSON.parse(serializeApplicationReceipt(createApplicationReceipt(draft())));
  const wrapper = receipt.attempts[0].upstreamReceipts;
  const parsed = JSON.parse(wrapper.serialized);
  parsed.receipts.pop();
  const prefix = ReceiptLog.fromJSON(parsed);
  assert.deepEqual(prefix.verify(), { ok: true }, "the upstream prefix alone is valid");
  wrapper.serialized = prefix.export();
  wrapper.serializedSha256 = sha(wrapper.serialized);
  wrapper.entryCount = prefix.length;
  wrapper.tailHash = prefix.entries().at(-1).thisHash;
  resealTamperedReceipt(receipt);

  const result = verifyApplicationReceipt(receipt);
  assert.equal(result.ok, false);
  assert.match(result.reason, /one upstream receipt per declared role|exact receipt count/i);

  const applicationPrefix = JSON.parse(
    serializeApplicationReceipt(createApplicationReceipt(draft())),
  );
  applicationPrefix.events.pop();
  resealTamperedReceipt(applicationPrefix);
  const applicationResult = verifyApplicationReceipt(applicationPrefix);
  assert.equal(applicationResult.ok, false);
  assert.match(applicationResult.reason, /exact application record count/);
});

test("reordered entries fail even when an attacker recomputes every public hash", () => {
  const receipt = JSON.parse(serializeApplicationReceipt(createApplicationReceipt(draft())));
  const attemptIndex = receipt.events.findIndex(({ kind }) => kind === "attempt");
  const invocationIndex = receipt.events.findIndex(
    ({ kind, id }) => kind === "native-invocation" && id === "invoke-implementation",
  );
  [receipt.events[attemptIndex], receipt.events[invocationIndex]] = [
    receipt.events[invocationIndex],
    receipt.events[attemptIndex],
  ];
  resealTamperedReceipt(receipt);
  const result = verifyApplicationReceipt(receipt);
  assert.equal(result.ok, false);
  assert.match(result.reason, /occurs before native invocation/);
});

test("ACCEPT is impossible without complete verification and independent review", () => {
  const incomplete = draft();
  incomplete.attempts[0].verifier.commands.pop();
  assert.throws(
    () => createApplicationReceipt(incomplete),
    /ACCEPT without full successful verification/,
  );

  const selfApproved = draft();
  selfApproved.reviews[0].provider = "codex";
  selfApproved.reviews[0].model = selfApproved.control.providerModels.codex;
  selfApproved.nativeInvocations[3].provider = "codex";
  selfApproved.nativeInvocations[3].model = selfApproved.control.providerModels.codex;
  selfApproved.nativeInvocations[3].executable = "/usr/bin/codex";
  selfApproved.nativeInvocations[3].args = ["--model", selfApproved.control.providerModels.codex];
  selfApproved.nativeInvocations[3].executableAttestation = {
    provider: "codex",
    discoveredPath: "/usr/bin/codex",
    path: "/usr/bin/codex",
    sha256: sha("codex-executable"),
    size: 1024,
    mode: 0o755,
    uid: 0,
    gid: 0,
  };
  selfApproved.reviews[0].upstreamReceipts = upstream(
    "review-upstream-1",
    [
      {
        role: "review",
        provider: "codex",
        model: selfApproved.control.providerModels.codex,
      },
    ],
  );
  assert.throws(
    () => createApplicationReceipt(selfApproved),
    /independent cross-vendor review/,
  );
});

test("routed decisions bind probability, complete context, and contract fingerprint", () => {
  const value = draft();
  for (const route of value.routing) {
    const selected = value.nativeInvocations.find(
      ({ routingId }) => routingId === route.id,
    );
    route.decision = routedDecision(
      route.context,
      value.control,
      value.contract,
      selected.provider,
    );
  }
  const receipt = createApplicationReceipt(value);
  const outcomes = applicationReceiptQualityOutcomes(receipt);
  assert.equal(outcomes.length, 4);
  assert.equal(outcomes.every(({ outcome }) => outcome.mode === "routed"), true);
  assert.equal(
    outcomes.every(({ outcome }) => outcome.predictedQuality === 0.8),
    true,
  );
  assert.equal(
    verifyApplicationReceiptOutcome(
      receipt,
      qualityOutcomeFor(receipt, { role: "implementation", quality: 1 }),
    ).verified,
    true,
  );

  const wrongContract = draft();
  const route = wrongContract.routing[0];
  route.decision.fingerprintSha256 = canonicalSha256({
    evaluatorSha256: wrongContract.contract.evaluator.patchSha256,
    harnessSha256: wrongContract.control.harnessSha256,
    models: wrongContract.control.providerModels,
  });
  assert.throws(
    () => createApplicationReceipt(wrongContract),
    /fingerprint does not bind contract, evaluator, harness, and models/,
  );
});

test("winning and losing attempts authorize every role with exact binary quality", () => {
  const value = addRejectedRepair(draft());
  const receipt = createApplicationReceipt(value);
  const outcomes = applicationReceiptQualityOutcomes(receipt);
  assert.deepEqual(
    outcomes.map(({ recordId, outcome }) => [recordId, outcome.quality]),
    [
      ["attempt:attempt-1:architecture", 1],
      ["attempt:attempt-1:critique", 1],
      ["attempt:attempt-1:implementation", 1],
      ["attempt:attempt-2:repair", 0],
      ["review:review-1", 1],
    ],
  );
  const repairOutcome = qualityOutcomeFor(receipt, {
    attemptId: "attempt-2",
    role: "repair",
    quality: 0,
  });
  const repairBinding = verifyApplicationReceiptOutcome(receipt, repairOutcome);
  assert.equal(repairBinding.verified, true);
  assert.equal(repairBinding.recordId, "attempt:attempt-2:repair");
  assert.equal(
    receipt.routing.find(({ id }) => id === "route-attempt-2").context.taskId,
    "application-run-1:repair:attempt-1:1",
  );
  assert.equal(
    verifyApplicationReceiptOutcome(receipt, {
      ...repairOutcome,
      quality: 1,
    }).verified,
    false,
  );

  const duplicate = addRejectedRepair(addRejectedRepair(draft()), {
    id: "attempt-3",
    parentAttemptId: "attempt-1",
    repairCycle: 1,
    provider: "claude",
  });
  assert.throws(
    () => createApplicationReceipt(duplicate),
    /repair routing task ids must be unique per provider and cycle/,
  );
});

test("a completed rejected review authorizes quality zero", () => {
  const value = rejectedReviewDraft();
  const receipt = createApplicationReceipt(value);
  const rejectedReview = qualityOutcomeFor(receipt, {
    reviewId: "review-1",
    quality: 0,
  });
  assert.equal(
    verifyApplicationReceiptOutcome(receipt, rejectedReview).verified,
    true,
  );
  assert.equal(
    verifyApplicationReceiptOutcome(receipt, {
      ...rejectedReview,
      quality: 1,
    }).verified,
    false,
  );
});

test("direct early product rejection is trainable but infrastructure failure is not", () => {
  const productFailure = draft();
  const productVerifier = productFailure.attempts[0].verifier;
  productVerifier.verdict = "REJECT";
  productVerifier.stage = "format";
  productVerifier.commands = productVerifier.commands.slice(0, 1);
  productVerifier.commands[0].exitCode = 1;
  productVerifier.candidateTree = null;
  productVerifier.protectedManifest = null;
  productFailure.attempts[0].disposition = "REJECT";
  productFailure.final = { verdict: "REJECT", reason: "format rejected" };
  const rejected = createApplicationReceipt(productFailure);
  assert.deepEqual(
    applicationReceiptQualityOutcomes(rejected)
      .filter(({ kind }) => kind === "attempt")
      .map(({ outcome }) => [outcome.role, outcome.quality]),
    [
      ["architecture", 0],
      ["critique", 0],
      ["implementation", 0],
    ],
  );

  const infrastructureFailure = draft();
  const infrastructureVerifier = infrastructureFailure.attempts[0].verifier;
  infrastructureVerifier.verdict = "REJECT";
  infrastructureVerifier.stage = "format";
  infrastructureVerifier.commands = infrastructureVerifier.commands.slice(0, 1);
  infrastructureVerifier.commands[0].disposition = "timed-out";
  infrastructureVerifier.commands[0].exitCode = null;
  infrastructureVerifier.candidateTree = null;
  infrastructureVerifier.protectedManifest = null;
  infrastructureFailure.attempts[0].disposition = "REJECT";
  infrastructureFailure.final = {
    verdict: "INCONCLUSIVE",
    reason: "verifier infrastructure timed out",
  };
  const inconclusive = createApplicationReceipt(infrastructureFailure);
  assert.equal(
    applicationReceiptQualityOutcomes(inconclusive).some(
      ({ kind }) => kind === "attempt",
    ),
    false,
  );
});

test("partial DAG failure retains unused routes and every unreferenced evidence shape", () => {
  for (const status of ["ACCEPT", "REJECT", "INCONCLUSIVE", "ERROR"]) {
    const value = draft();
    const evidence = value.nativeInvocations[0];
    if (status === "INCONCLUSIVE") {
      evidence.status = status;
      evidence.process.disposition = "timeout";
      evidence.process.exitCode = null;
      evidence.process.signal = "SIGKILL";
      evidence.outputSha256 = null;
      evidence.failureCode = "process-incomplete";
      evidence.failureDetailSha256 = sha("incomplete architecture process");
    } else if (status === "ERROR") {
      value.nativeInvocations[0] = {
        id: evidence.id,
        routingId: evidence.routingId,
        sequence: evidence.sequence,
        executionId: evidence.executionId,
        provider: evidence.provider,
        model: evidence.model,
        role: evidence.role,
        status,
        executable: null,
        args: [],
        executableAttestation: null,
        taskSha256: null,
        promptSha256: null,
        process: null,
        outputSha256: null,
        patchSha256: null,
        error: "sealed task preparation failed",
        errorSha256: sha("sealed task preparation failed"),
      };
    } else {
      evidence.status = status;
    }
    value.nativeInvocations = [value.nativeInvocations[0]];
    value.attempts = [];
    value.reviews = [];
    value.selectedCandidate = null;
    value.final = {
      verdict: "INCONCLUSIVE",
      reason: "architecture output could not be reconstructed",
    };
    value.events = [
      { kind: "routing", id: "route-architecture" },
      { kind: "native-invocation", id: "invoke-architecture" },
      { kind: "routing", id: "route-critique" },
      { kind: "routing", id: "route-implementation" },
      { kind: "routing", id: "route-review" },
      { kind: "selected-candidate", id: "none" },
      { kind: "final", id: value.run.id },
    ];
    const receipt = createApplicationReceipt(value);
    assert.equal(verifyApplicationReceipt(receipt).ok, true, status);
    assert.deepEqual(applicationReceiptQualityOutcomes(receipt), [], status);
    if (status === "INCONCLUSIVE") {
      const tampered = JSON.parse(serializeApplicationReceipt(receipt));
      tampered.nativeInvocations[0].failureCode = "worker-json-invalid";
      assert.equal(verifyApplicationReceipt(tampered).ok, false);
    }
  }
});
