import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  applicationReceiptQualityOutcomes,
  verifyApplicationReceipt,
} from "../src/receipts/application.mjs";
import { canonicalSha256, routingEmbedding } from "../src/routing/features.mjs";
import { QualityFirstRouter } from "../src/routing/quality-router.mjs";
import { NativeWorkerPool } from "../src/runtime/native-pool.mjs";
import { createG12ProgrammeForTesting } from "../src/runtime/g12-programme.mjs";
import { g12Profile } from "../src/task-profile.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const oid = (value) => createHash("sha1").update(value).digest("hex");

function contract() {
  return {
    id: "g1.2-rocksdb-serialized-writers",
    objective: "Close the two frozen concurrent history anomalies with one minimal product patch.",
    routing: {
      providers: [
        { provider: "codex", transport: "native", model: "gpt-5.6-sol" },
        { provider: "claude", transport: "native", model: "opus" },
      ],
    },
    baseline: { commit: oid("baseline"), tree: oid("baseline-tree") },
    evaluator: {
      commit: oid("evaluator"),
      tree: oid("evaluator-tree"),
      patchSha256: sha256("evaluator-patch"),
    },
    success: { publicPassed: 2, independentPassed: 3, regressionPassed: 2 },
    ceilings: {
      maxTotalVerifierWallMs: 60_000,
      maxWorkerOutputBytes: 262_144,
      maxRepairCycles: 1,
    },
  };
}

function frozenPreflight() {
  return Object.freeze({
    contract: contract(),
    contractSha256: sha256("contract"),
    control: Object.freeze({ harnessSha256: sha256("harness") }),
    sourceSnapshot: Object.freeze({ sealed: true }),
  });
}

function command(name, passed, exitCode = 0, disposition = "completed") {
  const expected = { public: 2, independent: 3, regression: 2 }[name];
  return Object.freeze({
    name,
    logicalArgv: Object.freeze(["cargo", name]),
    sandboxArgv: Object.freeze(["--unshare-net", "--", "cargo", name]),
    network: "isolated",
    workspace: "read-only",
    exitCode,
    signal: disposition === "completed" ? null : "SIGKILL",
    disposition,
    durationMs: 1,
    stdoutSha256: sha256(`${name}:stdout:${passed}`),
    stderrSha256: sha256(`${name}:stderr:${passed}`),
    stdoutTail:
      expected === undefined || !passed
        ? ""
        : `test result: ok. ${expected} passed; 0 failed;`,
    stderrTail: passed ? "" : `${name} rejected`,
  });
}

function verifier(candidate, verdict = "ACCEPT", { infrastructure = false } = {}) {
  const accepted = verdict === "ACCEPT";
  const commands = accepted
    ? ["format", "build", "public", "independent", "regression"].map((name) =>
        command(name, true),
      )
    : infrastructure
      ? [command("format", false, null, "timed-out")]
      : [command("format", false, 1)];
  return Object.freeze({
    verdict,
    stage: accepted ? "complete" : "format",
    commands: Object.freeze(commands),
    artifacts: Object.freeze([
      Object.freeze({
        name: "verifier-session-result.json",
        sha256: sha256(`${candidate.candidateTree}:result`),
        bytes: 100,
      }),
    ]),
    durationMs: 5,
    candidateTree: candidate.candidateTree,
    protectedManifest: candidate.protectedManifest,
  });
}

function workerRunner({
  calls,
  reviewVerdict = "ACCEPT",
  claudeArchitectureReject = false,
  codexCritiqueReject = false,
  implementationOutputRejected = false,
}) {
  return async ({ provider, role, model, task }) => {
    calls.push({ provider, role, task: structuredClone(task) });
    if (implementationOutputRejected && role === "implementation") {
      return Object.freeze({
        provider,
        role,
        model,
        status: "INCONCLUSIVE",
        failure: Object.freeze({
          code: "patch-policy-invalid",
          detailSha256: sha256(`${provider}:invalid-patch`),
          retryable: false,
        }),
        invocation: Object.freeze({
          executable: `/usr/bin/${provider}`,
          args: Object.freeze(["--model", model]),
          attestation: Object.freeze({
            provider,
            discoveredPath: `/usr/bin/${provider}`,
            path: `/usr/bin/${provider}`,
            sha256: sha256(`${provider}:bin`),
            size: 1024,
            mode: 0o755,
            uid: 1000,
            gid: 1000,
          }),
          taskSha256: sha256(JSON.stringify(task)),
          promptSha256: sha256(`${provider}:${role}:prompt`),
        }),
        outcome: Object.freeze({
          disposition: "completed",
          exitCode: 0,
          signal: null,
          durationMs: 1,
          stdout: `${provider}:${role}:rejected-output`,
          stderr: "",
          terminationErrors: Object.freeze([]),
        }),
      });
    }
    const patch = ["implementation", "repair"].includes(role)
      ? `patch:${role}:${provider}`
      : null;
    const output = Object.freeze({
      summary: `${provider} ${role}`,
      patch,
      findings: Object.freeze([]),
      verdict:
        role === "review"
          ? reviewVerdict
          : claudeArchitectureReject && provider === "claude" && role === "architecture"
            ? "REJECT"
            : codexCritiqueReject && provider === "codex" && role === "critique"
              ? "REJECT"
            : "ACCEPT",
    });
    return Object.freeze({
      provider,
      role,
      model,
      status: output.verdict,
      output,
      invocation: Object.freeze({
        executable: `/usr/bin/${provider}`,
        args: Object.freeze(["--model", model]),
        attestation: Object.freeze({
          provider,
          discoveredPath: `/usr/bin/${provider}`,
          path: `/usr/bin/${provider}`,
          sha256: sha256(`${provider}:bin`),
          size: 1024,
          mode: 0o755,
          uid: 1000,
          gid: 1000,
        }),
        taskSha256: sha256(JSON.stringify(task)),
        promptSha256: sha256(`${provider}:${role}:prompt`),
      }),
      outcome: Object.freeze({
        disposition: "completed",
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdout: `${provider}:${role}:stdout`,
        stderr: "",
        terminationErrors: Object.freeze([]),
      }),
    });
  };
}

function pairedRouter() {
  return {
    async reload() {
      return Object.freeze([]);
    },
    snapshot() {
      return Object.freeze([]);
    },
  };
}

function routedDecision(context, provider) {
  const bin = Object.freeze({
    lo: 0,
    hi: 1,
    count: 5,
    meanPredicted: 0.8,
    meanRealized: 0.8,
    gap: 0,
  });
  const report = Object.freeze({
    samples: 5,
    brier: 0.1,
    ece: 0.1,
    bins: Object.freeze([bin]),
    worstBin: bin,
  });
  return Object.freeze({
    mode: "routed",
    reason: "quality-first",
    provider,
    model: context.models[provider],
    predictedQuality: 0.8,
    metBar: true,
    embedding: routingEmbedding(context),
    providerOrder: Object.freeze(["codex", "claude"]),
    pairedSamples: 5,
    admittedSincePair: 1,
    calibration: Object.freeze({
      status: "READY",
      minimumSamples: 5,
      pairedSamples: 5,
      reports: Object.freeze({ codex: report, claude: report }),
    }),
    fingerprintSha256: canonicalSha256({
      contractSha256: context.contractSha256,
      evaluatorSha256: context.evaluatorSha256,
      harnessSha256: context.harnessSha256,
      models: context.models,
    }),
    engine: "@metaharness/router.Router",
  });
}

function throwInjectedFailure(operationFailures, operation, patch) {
  const failure = operationFailures[operation]?.get(patch);
  if (failure !== undefined) throw failure;
}

function fixture({
  routedProvider = null,
  verification = "mixed",
  reviewVerdict = "ACCEPT",
  claudeArchitectureReject = false,
  codexCritiqueReject = false,
  implementationOutputRejected = false,
  operationFailures = {},
} = {}) {
  const preflight = frozenPreflight();
  const calls = [];
  const disposed = [];
  const finalized = [];
  const preflightCalls = [];
  const pool = new NativeWorkerPool({
    contract: preflight.contract,
    workerRunner: workerRunner({
      calls,
      reviewVerdict,
      claudeArchitectureReject,
      codexCritiqueReject,
      implementationOutputRejected,
    }),
  });
  const run = createG12ProgrammeForTesting({
    preflight: async (input) => {
      preflightCalls.push(input);
      return preflight;
    },
    history: async () => pairedRouter(),
    router:
      routedProvider === null
        ? (history) => new QualityFirstRouter({ history })
        : () => ({ route: async (context) => routedDecision(context, routedProvider) }),
    pool: () => pool,
    taskContext: async (input) => {
      if (
        input.priorOutputs !== undefined &&
        Object.values(input.priorOutputs).some(({ verdict }) => verdict !== "ACCEPT")
      ) {
        throw new Error("test task context rejected a non-ACCEPT prior");
      }
      return structuredClone(input);
    },
    reconstruct: async ({ patch }) => {
      throwInjectedFailure(operationFailures, "reconstruct", patch);
      return Object.freeze({
        patch,
        kind: "candidate",
        candidateCommit: oid(`${patch}:commit`),
        candidateTree: oid(`${patch}:tree`),
        candidatePatchSha256: sha256(patch),
        protectedManifest: Object.freeze({ entries: 12, sha256: sha256("protected") }),
      });
    },
    materializeSubmodules: async ({ candidate }) => {
      throwInjectedFailure(
        operationFailures,
        "materializeSubmodules",
        candidate.patch,
      );
      return Object.freeze([]);
    },
    verify: async ({ candidate }) => {
      throwInjectedFailure(operationFailures, "verify", candidate.patch);
      const provider = candidate.patch.endsWith(":claude") ? "claude" : "codex";
      if (verification === "all-accept" || candidate.patch.startsWith("patch:repair")) {
        return verifier(candidate, "ACCEPT");
      }
      if (verification === "repair") return verifier(candidate, "REJECT");
      if (verification === "infrastructure") {
        return verifier(candidate, "INCONCLUSIVE", { infrastructure: true });
      }
      return verifier(candidate, provider === "codex" ? "ACCEPT" : "REJECT");
    },
    dispose: async (candidate) => {
      disposed.push(candidate.candidateTree);
      throwInjectedFailure(operationFailures, "dispose", candidate.patch);
    },
    finalize: async ({ receipt, receiptBytes }) => {
      const verificationResult = verifyApplicationReceipt(receiptBytes);
      assert.equal(verificationResult.ok, true);
      assert.equal(verificationResult.receiptSha256, receipt.receiptSha256);
      const targets = applicationReceiptQualityOutcomes(receiptBytes);
      finalized.push({ receipt, receiptBytes, targets });
      return Object.freeze({
        receiptPath: "/private/test-receipt.json",
        admission: Object.freeze({ outcomeCount: targets.length }),
      });
    },
  });
  return { run, calls, disposed, finalized, pool, preflightCalls };
}

function clock() {
  const values = [
    new Date("2026-08-25T10:00:00.000Z"),
    new Date("2026-08-25T10:00:01.000Z"),
  ];
  return () => values.shift();
}

function rejectionDetailSha256(error) {
  return canonicalSha256({
    name: error.name.slice(0, 128),
    code: typeof error.code === "string" ? error.code.slice(0, 128) : null,
    message: error.message.slice(0, 512),
  });
}

function assertExactRejection(
  receipt,
  rejection,
  { candidateId, patch, phase, failureCode, error },
) {
  assert.equal(rejection.candidateId, candidateId);
  assert.equal(rejection.patchSha256, sha256(patch));
  assert.equal(rejection.phase, phase);
  assert.equal(rejection.failureCode, failureCode);
  assert.equal(rejection.failureDetailSha256, rejectionDetailSha256(error));
  const invocation = receipt.nativeInvocations.find(
    ({ id }) => id === rejection.invocationId,
  );
  assert.equal(invocation.executionId, candidateId);
  assert.ok(["implementation", "repair"].includes(invocation.role));
  assert.equal(invocation.status, "ACCEPT");
  assert.equal(invocation.process.disposition, "completed");
  assert.equal(invocation.process.exitCode, 0);
  assert.equal(invocation.process.signal, null);
  assert.equal(invocation.patchSha256, rejection.patchSha256);
  const invocationEvent = receipt.events.find(
    ({ kind, id }) => kind === "native-invocation" && id === invocation.id,
  );
  const rejectionEvent = receipt.events.find(
    ({ kind, id }) => kind === "candidate-rejection" && id === rejection.id,
  );
  assert.ok(invocationEvent.sequence < rejectionEvent.sequence);
  return invocation;
}

test("cold paired programme preserves both pipelines and accepts cross-vendor review", async () => {
  const { run, calls, disposed, finalized, pool, preflightCalls } = fixture();
  const result = await run({
    taskId: g12Profile.id,
    runId: "paired-happy",
    clock: clock(),
  });
  assert.equal(result.final.verdict, "ACCEPT");
  assert.match(result.selectedPatch, /implementation:codex$/u);
  assert.equal(result.admittedOutcomes, 8);
  assert.equal(disposed.length, 2);
  assert.deepEqual(
    calls.filter(({ role }) => role === "implementation").map(({ provider }) => provider).sort(),
    ["claude", "codex"],
  );
  assert.deepEqual(
    calls.filter(({ role }) => role === "review").map(({ provider }) => provider).sort(),
    ["claude", "codex"],
  );
  const receipt = finalized[0].receipt;
  assert.equal(receipt.attempts.length, 2);
  assert.equal(receipt.reviews.length, 2);
  assert.deepEqual(
    receipt.nativeInvocations.map(({ sequence }) => sequence),
    Array.from({ length: pool.evidence().length }, (_, index) => index + 1),
  );
  assert.equal(receipt.events.at(-2).kind, "selected-candidate");
  assert.equal(receipt.events.at(-1).kind, "final");
  assert.equal(preflightCalls.length, 1);
  assert.equal(preflightCalls[0].taskId, g12Profile.id);
});

test("paired reconstruction failures remain separate, hash-bound, and raw-free", async () => {
  const codexError = new Error("private-codex-reconstruction-secret");
  codexError.code = "E_CODEX_PRIVATE";
  const claudeError = new Error("private-claude-reconstruction-secret");
  claudeError.code = "E_CLAUDE_PRIVATE";
  const operationFailures = {
    reconstruct: new Map([
      ["patch:implementation:codex", codexError],
      ["patch:implementation:claude", claudeError],
    ]),
  };
  const { run, finalized, disposed } = fixture({
    verification: "all-accept",
    operationFailures,
  });
  const result = await run({ runId: "paired-reconstruction-failures", clock: clock() });
  assert.equal(result.final.verdict, "INCONCLUSIVE");
  assert.equal(result.admittedOutcomes, 0);
  assert.equal(disposed.length, 0);
  const { receipt, receiptBytes, targets } = finalized[0];
  assert.equal(receipt.attempts.length, 0);
  assert.equal(receipt.candidateRejections.length, 2);
  assert.deepEqual(targets, []);
  const expected = [
    {
      candidateId: "paired-reconstruction-failures:candidate:1",
      patch: "patch:implementation:codex",
      error: codexError,
    },
    {
      candidateId: "paired-reconstruction-failures:candidate:2",
      patch: "patch:implementation:claude",
      error: claudeError,
    },
  ];
  for (let index = 0; index < expected.length; index += 1) {
    assertExactRejection(receipt, receipt.candidateRejections[index], {
      ...expected[index],
      phase: "reconstruction",
      failureCode: "candidate-reconstruction-failed",
    });
  }
  for (const raw of [
    "patch:implementation:codex",
    "patch:implementation:claude",
    codexError.message,
    claudeError.message,
    "codex:implementation:stdout",
    "claude:implementation:stdout",
  ]) {
    assert.equal(receiptBytes.includes(raw), false, raw);
  }
  for (const { patch, error } of expected) {
    assert.equal(receiptBytes.includes(sha256(patch)), true);
    assert.equal(receiptBytes.includes(rejectionDetailSha256(error)), true);
  }
});

test("one reconstruction failure does not suppress a separately accepted lane", async () => {
  const failure = new Error("private-claude-reconstruction-failure");
  const { run, finalized } = fixture({
    verification: "all-accept",
    operationFailures: {
      reconstruct: new Map([["patch:implementation:claude", failure]]),
    },
  });
  const result = await run({ runId: "mixed-reconstruction", clock: clock() });
  assert.equal(result.final.verdict, "ACCEPT");
  assert.match(result.selectedPatch, /implementation:codex$/u);
  assert.equal(result.admittedOutcomes, 5);
  const { receipt, targets } = finalized[0];
  assert.equal(receipt.attempts.length, 1);
  assert.equal(receipt.candidateRejections.length, 1);
  assertExactRejection(receipt, receipt.candidateRejections[0], {
    candidateId: "mixed-reconstruction:candidate:2",
    patch: "patch:implementation:claude",
    phase: "reconstruction",
    failureCode: "candidate-reconstruction-failed",
    error: failure,
  });
  assert.equal(
    targets.some(
      ({ outcome }) => outcome.candidateSha256 === sha256("patch:implementation:claude"),
    ),
    false,
  );
});

test("frozen submodule failure is a distinct non-trainable applicability rejection", async () => {
  const failure = new Error("private-submodule-materialization-failure");
  const { run, finalized, disposed } = fixture({
    verification: "all-accept",
    operationFailures: {
      materializeSubmodules: new Map([
        ["patch:implementation:claude", failure],
      ]),
    },
  });
  const result = await run({ runId: "submodule-applicability", clock: clock() });
  assert.equal(result.final.verdict, "ACCEPT");
  assert.equal(disposed.length, 2);
  const { receipt, targets } = finalized[0];
  assert.equal(receipt.attempts.length, 1);
  assertExactRejection(receipt, receipt.candidateRejections[0], {
    candidateId: "submodule-applicability:candidate:2",
    patch: "patch:implementation:claude",
    phase: "applicability",
    failureCode: "frozen-submodules-failed",
    error: failure,
  });
  assert.equal(
    targets.some(
      ({ outcome }) => outcome.candidateSha256 === sha256("patch:implementation:claude"),
    ),
    false,
  );
});

test("thrown verifier failure remains INCONCLUSIVE and cannot trigger repair quality", async () => {
  const failure = new Error("private-verifier-runtime-failure");
  const { run, calls, finalized, disposed } = fixture({
    routedProvider: "codex",
    verification: "all-accept",
    operationFailures: {
      verify: new Map([["patch:implementation:codex", failure]]),
    },
  });
  const result = await run({ runId: "verifier-applicability", clock: clock() });
  assert.equal(result.final.verdict, "INCONCLUSIVE");
  assert.equal(result.admittedOutcomes, 0);
  assert.equal(calls.some(({ role }) => role === "repair"), false);
  assert.equal(disposed.length, 1);
  const { receipt, targets } = finalized[0];
  assert.equal(receipt.attempts.length, 0);
  assert.deepEqual(targets, []);
  assertExactRejection(receipt, receipt.candidateRejections[0], {
    candidateId: "verifier-applicability:candidate:1",
    patch: "patch:implementation:codex",
    phase: "applicability",
    failureCode: "candidate-verifier-failed",
    error: failure,
  });
});

test("repair reconstruction failure binds the repair invocation without quality", async () => {
  const failure = new Error("private-codex-repair-reconstruction-failure");
  const { run, finalized } = fixture({
    verification: "repair",
    operationFailures: {
      reconstruct: new Map([["patch:repair:codex", failure]]),
    },
  });
  const result = await run({ runId: "repair-reconstruction", clock: clock() });
  assert.equal(result.final.verdict, "ACCEPT");
  assert.match(result.selectedPatch, /repair:claude$/u);
  const { receipt, targets } = finalized[0];
  assert.equal(receipt.attempts.length, 3);
  assert.equal(receipt.candidateRejections.length, 1);
  const invocation = assertExactRejection(receipt, receipt.candidateRejections[0], {
    candidateId: "repair-reconstruction:repair:1:codex",
    patch: "patch:repair:codex",
    phase: "reconstruction",
    failureCode: "candidate-reconstruction-failed",
    error: failure,
  });
  assert.equal(invocation.role, "repair");
  assert.equal(
    targets.some(
      ({ outcome }) => outcome.candidateSha256 === sha256("patch:repair:codex"),
    ),
    false,
  );
});

test("candidate disposal failure aborts receipt minting", async () => {
  const failure = new Error("private-disposal-failure");
  const { run, finalized, disposed } = fixture({
    verification: "all-accept",
    operationFailures: {
      dispose: new Map([["patch:implementation:claude", failure]]),
    },
  });
  await assert.rejects(
    run({ runId: "disposal-failure", clock: clock() }),
    /candidate disposal failed/u,
  );
  assert.equal(disposed.length, 2);
  assert.equal(finalized.length, 0);
});

test("programme rejects path injection and unknown ids before preflight", async () => {
  const { run, preflightCalls } = fixture();
  await assert.rejects(
    run({ contractPath: "/tmp/copied-contract.json" }),
    /contractPath selection is forbidden/u,
  );
  await assert.rejects(
    run({ taskId: "g9.9-unregistered" }),
    /unsupported engineering task/u,
  );
  assert.equal(preflightCalls.length, 0);
});

test("programme rejects preflight evidence for a different registered task", async () => {
  const { run, preflightCalls, calls } = fixture();
  await assert.rejects(
    run({
      taskId: "g1.3-transaction-capabilities",
      runId: "mismatched-task",
      clock: clock(),
    }),
    /preflight contract does not match the selected engineering task/u,
  );
  assert.equal(preflightCalls.length, 1);
  assert.equal(preflightCalls[0].taskId, "g1.3-transaction-capabilities");
  assert.equal(calls.length, 0);
});

test("same-producer routed review remains receipt-valid and INCONCLUSIVE", async () => {
  const { run, calls, finalized } = fixture({
    routedProvider: "codex",
    verification: "all-accept",
  });
  const result = await run({ runId: "routed-self-review", clock: clock() });
  assert.equal(result.final.verdict, "INCONCLUSIVE");
  assert.equal(result.admittedOutcomes, 4);
  assert.deepEqual(
    calls.filter(({ role }) => role === "review").map(({ provider }) => provider),
    ["codex"],
  );
  assert.equal(finalized[0].receipt.reviews.length, 1);
  assert.equal(verifyApplicationReceipt(finalized[0].receipt).ok, true);
});

test("rejected terminal reviews retain bounded diagnostics in the v6 receipt", async () => {
  const { run, finalized } = fixture({
    reviewVerdict: "REJECT",
    verification: "all-accept",
  });
  const result = await run({ runId: "rejected-review", clock: clock() });
  assert.equal(result.final.verdict, "REJECT");
  const receipt = finalized[0].receipt;
  assert.equal(receipt.schema, "oxigraph.engineering-application-receipt/v6");
  for (const review of receipt.reviews) {
    const invocation = receipt.nativeInvocations.find(
      ({ id }) => id === review.invocationId,
    );
    assert.deepEqual(invocation.reviewDiagnostic, {
      summary: `${review.provider} review`,
      findings: [],
    });
  }
  assert.equal(verifyApplicationReceipt(receipt).ok, true);
});

test("infrastructure outcome is neither repaired nor admitted as quality", async () => {
  const { run, calls, finalized } = fixture({ verification: "infrastructure" });
  const result = await run({ runId: "infrastructure-reject", clock: clock() });
  assert.equal(result.final.verdict, "INCONCLUSIVE");
  assert.equal(result.admittedOutcomes, 0);
  assert.equal(calls.some(({ role }) => role === "repair"), false);
  assert.equal(finalized[0].receipt.attempts.length, 2);
});

test("product rejection runs one exact paired repair cycle before review", async () => {
  const { run, calls, finalized } = fixture({ verification: "repair" });
  const result = await run({ runId: "product-repair", clock: clock() });
  assert.equal(result.final.verdict, "ACCEPT");
  assert.match(result.selectedPatch, /repair:codex$/u);
  assert.equal(calls.filter(({ role }) => role === "repair").length, 2);
  const receipt = finalized[0].receipt;
  assert.equal(receipt.attempts.length, 4);
  const repairs = receipt.attempts.filter(({ repairCycle }) => repairCycle === 1);
  assert.equal(repairs.length, 2);
  assert.ok(repairs.every(({ parentAttemptId }) => parentAttemptId === receipt.attempts[0].id));
  assert.ok(
    calls
      .filter(({ role }) => role === "repair")
      .every(({ task }) => task.currentCandidate.patch === receipt.attempts[0].patch),
  );
});

test("a declined paired lane retains failures without suppressing the valid lane", async () => {
  const { run, finalized } = fixture({ claudeArchitectureReject: true });
  const result = await run({ runId: "partial-paired", clock: clock() });
  assert.equal(result.final.verdict, "ACCEPT");
  assert.equal(result.admittedOutcomes, 5);
  const receipt = finalized[0].receipt;
  assert.equal(receipt.attempts.length, 1);
  assert.ok(
    receipt.nativeInvocations.some(
      ({ provider, role, status }) =>
        provider === "claude" && role === "critique" && status === "ERROR",
    ),
  );
});

test("a rejected critique is retained and stops only its candidate lane", async () => {
  const { run, calls, finalized } = fixture({
    codexCritiqueReject: true,
    verification: "all-accept",
  });
  const result = await run({ runId: "rejected-critique", clock: clock() });
  assert.equal(result.final.verdict, "ACCEPT");
  const receipt = finalized[0].receipt;
  const rejected = receipt.nativeInvocations.find(
    ({ provider, role, status }) =>
      provider === "codex" && role === "critique" && status === "REJECT",
  );
  assert.deepEqual(rejected.critiqueDiagnostic, {
    summary: "codex critique",
    findings: [],
  });
  assert.ok(
    receipt.nativeInvocations.some(
      ({ provider, role, status }) =>
        provider === "codex" && role === "implementation" && status === "ERROR",
    ),
  );
  assert.equal(
    calls.some(({ provider, role }) => provider === "codex" && role === "implementation"),
    false,
  );
});

test("exit-zero output rejection is classified once per lane without host retry", async () => {
  const { run, calls, finalized } = fixture({
    implementationOutputRejected: true,
  });
  const result = await run({ runId: "output-rejected", clock: clock() });
  assert.equal(result.final.verdict, "INCONCLUSIVE");
  assert.equal(result.selectedCandidate, null);
  assert.equal(result.admittedOutcomes, 0);
  assert.equal(calls.filter(({ role }) => role === "implementation").length, 2);
  assert.ok(
    result.issues.every((issue) =>
      issue.includes("implementation:worker-output-rejected"),
    ),
  );
  const receipt = finalized[0].receipt;
  const rejected = receipt.nativeInvocations.filter(
    ({ role }) => role === "implementation",
  );
  assert.equal(rejected.length, 2);
  assert.ok(rejected.every(({ failureCode }) => failureCode === "patch-policy-invalid"));
  assert.ok(rejected.every(({ executionId }) => /candidate:/u.test(executionId)));
});
