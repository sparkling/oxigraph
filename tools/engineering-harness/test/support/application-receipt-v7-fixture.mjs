import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ReceiptLog } from "@metaharness/harness";

import {
  disposeCandidateV2,
  reconstructCandidateV2,
} from "../../src/candidate/reconstruct-v2.mjs";
import { createGitHome, runGitBytes } from "../../src/candidate/git.mjs";
import { loadTreeV2, readBlobByOid } from "../../src/candidate/tree-v2.mjs";
import { assembleCandidatePatchV2 } from "../../src/policy/paths-v2.mjs";
import {
  parseTaskContractBytesV2,
  verifyTaskContractRepositoryV2,
} from "../../src/contract-v2.mjs";
import { repositoryRoot } from "../../src/paths.mjs";
import {
  createApplicationReceiptV7,
  serializeApplicationReceiptV7,
} from "../../src/receipts/application.mjs";
import {
  canonicalSha256,
  routingEmbedding,
} from "../../src/routing/features.mjs";
import {
  assertSealedTaskV2WorkerContext,
  createTaskV2Context,
} from "../../src/runtime/task-context-v2.mjs";
import { harnessCreateExactV2Profile } from "../../src/task-profile.mjs";

const evaluatorCommit = "997ad287fe089c8d791e0b733caae6240602de8f";
const referenceCommit = "dfd6d92d986306632bac795e41cf488de8422010";
const contractPath = join(
  repositoryRoot,
  "tools",
  "engineering-harness",
  "tasks",
  "v2",
  "harness-create-exact-v2",
  "contract.json",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
  const verification = log.verify();
  if (verification.ok !== true) {
    throw new Error("v7 fixture upstream receipt log is invalid");
  }
  return log.entries();
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
    id: `fixture-route-${workerRole}`,
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
  executionId,
  provider,
  role,
  model,
  taskV2,
  workerContext,
  modificationPatch = null,
  creations = [],
  patch = null,
  candidateProjection = null,
}) {
  const requestSchema = "oxigraph.engineering-native-worker-request/v2";
  const summary = `deterministic worker-v2 ${role} fixture`;
  const providerOutputV2 = {
    summary,
    patch: modificationPatch,
    creations,
    findings: [],
    verdict: "ACCEPT",
  };
  const taskJson = JSON.stringify({
    schemaVersion: 2,
    role,
    directive: `execute exact ${id}`,
    context: workerContext,
    roleInput: { invocationId: id },
  });
  const taskSha256 = sha256(taskJson);
  const requestSha256 = sha256(
    Buffer.concat([
      Buffer.from(`${requestSchema}\0`, "ascii"),
      Buffer.from(taskV2.contractSha256, "ascii"),
      Buffer.from(taskSha256, "ascii"),
      Buffer.from(`${provider}\0${model}\0${role}`, "utf8"),
    ]),
  );
  return {
    id,
    routingId: route.id,
    sequence,
    executionId,
    taskJson,
    request: {
      schema: requestSchema,
      requestSha256,
    },
    result: {
      provider,
      model,
      role,
      status: "ACCEPT",
      output: {
        summary,
        patch,
        findings: [],
        verdict: "ACCEPT",
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
        durationMs: 1,
        stdoutSha256: sha256(`${id}:stdout`),
        stderrSha256: sha256(`${id}:stderr`),
        terminationErrorCount: 0,
        processErrorCount: 0,
      },
      invocation: {
        executableAttestation: {
          provider,
          transport: "inherited-readonly-fd-v1",
          childFd: 3,
          sha256: sha256(`${provider}-fixture-executable`),
          size: 1024,
          mode: 0o755,
          uid: 1000,
          gid: 1000,
        },
        argsNormalization: "execution-root-token-v1",
        argsSha256: sha256(`${id}:args`),
        environmentSha256: sha256(`${id}:environment`),
        workerSchemaVersion: 2,
        timeoutMs: 120_000,
        maxOutputBytes: 262_144,
        contractSha256: taskV2.contractSha256,
        contextTaskSha256: taskV2.taskContext.taskSha256,
        requestSha256,
        taskSha256,
        promptSha256: sha256(`${id}:prompt`),
        outputSchemaSha256: sha256(`${provider}:worker-v2-output-schema`),
        outputSchemaTransport:
          provider === "codex" ? "inherited-readonly-fd-v1" : "argv-utf8-v1",
        outputSchemaChildFd: provider === "codex" ? 4 : null,
        providerOutputSha256: sha256(JSON.stringify(providerOutputV2)),
        modificationPatchSha256:
          modificationPatch === null ? null : sha256(modificationPatch),
        creationsSha256: sha256(JSON.stringify(creations)),
        finalPatchSha256: patch === null ? null : sha256(patch),
      },
    },
  };
}

function verifierCommand(name, expectedPassed) {
  return {
    name,
    logicalArgv: ["cargo", name],
    sandboxArgv: ["--unshare-net", "--", "cargo", name],
    network: "isolated",
    workspace: "read-only",
    exitCode: 0,
    signal: null,
    disposition: "completed",
    durationMs: 1,
    stdoutSha256: sha256(`fixture-${name}-stdout`),
    stderrSha256: sha256(`fixture-${name}-stderr`),
    stdoutTail:
      expectedPassed === undefined
        ? ""
        : `test result: ok. ${expectedPassed} passed; 0 failed;`,
    stderrTail: "",
  };
}

function receiptFromEvidence({
  parsed,
  repository,
  taskContext,
  candidate,
  patch,
  workerEvidence,
  workerContext,
}) {
  const profile = harnessCreateExactV2Profile;
  const run = {
    id: "exact-v7-replay-fixture",
    taskId: profile.id,
    taskClass: profile.taskClass,
    startedAt: "2026-09-02T10:00:00.000Z",
    completedAt: "2026-09-02T10:00:01.000Z",
  };
  const control = {
    harnessSha256: sha256("exact-v7-replay-fixture-harness"),
    providerModels: Object.fromEntries(
      parsed.contract.routing.providers.map(({ provider, model }) => [
        provider,
        model,
      ]),
    ),
  };
  const success = {};
  for (const name of parsed.contract.verificationSequence.slice(2)) {
    success[`${name}Passed`] = parsed.contract.success[`${name}Passed`];
  }
  const contract = {
    sha256: parsed.contractSha256,
    baseline: {
      commit: parsed.contract.baseline.commit,
      tree: parsed.contract.baseline.tree,
    },
    evaluator: {
      commit: parsed.contract.evaluator.commit,
      tree: parsed.contract.evaluator.tree,
      patchSha256: parsed.contract.evaluator.patchSha256,
    },
    success,
  };
  const taskV2 = {
    id: profile.id,
    slug: profile.slug,
    contractSchemaVersion: 2,
    executionGate: profile.executionGate,
    registrationMode: profile.registrationMode,
    productAuthority: false,
    contractSha256: parsed.contractSha256,
    canonicalContractSha256: parsed.canonicalContractSha256,
    verificationSequence: parsed.contract.verificationSequence,
    taskContext,
    repository,
    candidate,
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
      id: `fixture-invocation-${role}`,
      route: routing[index],
      sequence: index + 1,
      executionId: "fixture-candidate-execution",
      provider,
      role,
      model: control.providerModels[provider],
      taskV2,
      workerContext,
      ...(role === "implementation"
        ? {
            modificationPatch: workerEvidence.modificationPatch,
            creations: workerEvidence.creations,
            patch,
            candidateProjection: workerEvidence.candidateProjection,
          }
        : {}),
    });
  });
  const reviewInvocation = invocation({
    id: "fixture-invocation-review",
    route: reviewRoute,
    sequence: nativeInvocations.length + 1,
    executionId: "fixture-review-execution",
    provider: "claude",
    role: "review",
    model: control.providerModels.claude,
    taskV2,
    workerContext,
  });
  const candidateIdentity = {
    commit: candidate.commit,
    tree: candidate.tree,
    protectedManifest: candidate.manifests.protected,
  };
  const commands = parsed.contract.verificationSequence.map((name) =>
    verifierCommand(name, parsed.contract.success[`${name}Passed`]),
  );
  const attempt = {
    id: "fixture-attempt-1",
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
      "fixture-upstream-attempt",
      roles.map((role) => ({
        role,
        provider: providersByRole[role],
        model: control.providerModels[providersByRole[role]],
      })),
    ),
    patch,
    patchSha256: candidate.patchSha256,
    candidate: candidateIdentity,
    verifier: {
      verdict: "ACCEPT",
      stage: "complete",
      commands,
      artifacts: [
        {
          name: "exact-v7-replay-result.json",
          sha256: sha256("exact-v7-replay-result"),
          bytes: 1,
        },
      ],
      durationMs: 1,
      candidateTree: candidate.tree,
      protectedManifest: candidate.manifests.protected,
    },
    repairCycle: 0,
    disposition: "ACCEPT",
  };
  const review = {
    id: "fixture-review-1",
    attemptId: attempt.id,
    provider: "claude",
    model: control.providerModels.claude,
    invocationId: reviewInvocation.id,
    upstreamReceipts: upstream("fixture-upstream-review", [
      {
        role: "review",
        provider: "claude",
        model: control.providerModels.claude,
      },
    ]),
    candidateSha256: candidate.patchSha256,
    outputSha256: reviewInvocation.result.invocation.providerOutputSha256,
    disposition: "ACCEPT",
  };
  return createApplicationReceiptV7({
    run,
    control,
    contract,
    taskV2,
    routing,
    nativeInvocations: [...nativeInvocations, reviewInvocation],
    attempts: [attempt],
    reviews: [review],
    candidateRejections: [],
    selectedCandidate: {
      attemptId: attempt.id,
      patchSha256: candidate.patchSha256,
      commit: candidate.commit,
      tree: candidate.tree,
    },
    final: {
      verdict: "ACCEPT",
      reason: "exact dormant v7 replay fixture",
    },
    events: [
      ...routing.map(({ id }) => ({ kind: "routing", id })),
      ...nativeInvocations.map(({ id }) => ({
        kind: "native-invocation",
        id,
      })),
      { kind: "attempt", id: attempt.id },
      { kind: "native-invocation", id: reviewInvocation.id },
      { kind: "review", id: review.id },
      { kind: "selected-candidate", id: attempt.id },
      { kind: "final", id: run.id },
    ],
  });
}

export async function createExactApplicationReceiptV7Fixture() {
  const contractBytes = await readFile(contractPath);
  const parsed = parseTaskContractBytesV2(contractBytes);
  const temporaryRoot = await mkdtemp(
    join(tmpdir(), "oxigraph-v7-receipt-fixture-"),
  );
  let candidate;
  try {
    const home = await createGitHome(temporaryRoot);
    const repository = await verifyTaskContractRepositoryV2(parsed.contract, {
      repoRoot: repositoryRoot,
      home,
    });
    const evaluatorTree = await loadTreeV2({
      workspace: repositoryRoot,
      home,
      tree: parsed.contract.evaluator.tree,
    });
    const context = await createTaskV2Context({
      contractBytes,
      evaluatorTree,
      readBlobByOid: ({ oid, maxOutputBytes }) =>
        readBlobByOid({
          workspace: repositoryRoot,
          home,
          oid,
          maxOutputBytes,
        }),
    });
    const sealed = assertSealedTaskV2WorkerContext({
      context,
      contractBytes,
    });
    const presentPaths = parsed.contract.scope.mutableExact.filter(
      (path) => !parsed.contract.scope.createExact.includes(path),
    );
    const modificationPatchBytes = await runGitBytes({
      args: [
        "diff",
        "--binary",
        "--full-index",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        evaluatorCommit,
        referenceCommit,
        "--",
        ...presentPaths,
      ],
      cwd: repositoryRoot,
      home,
      maxOutputBytes: parsed.contract.ceilings.maxPatchBytes,
    });
    const creations = [];
    for (const path of parsed.contract.scope.createExact) {
      const content = await runGitBytes({
        args: ["show", `${referenceCommit}:${path}`],
        cwd: repositoryRoot,
        home,
        maxOutputBytes: parsed.contract.ceilings.maxPatchBytes,
      });
      creations.push({ path, content: content.toString("utf8") });
    }
    const modificationPatch = modificationPatchBytes.toString("utf8");
    const assembled = assembleCandidatePatchV2(
      parsed.contract,
      modificationPatch,
      creations,
    );
    const patch = assembled.patch;
    candidate = await reconstructCandidateV2({
      repositoryRoot,
      contractBytes,
      patch,
    });
    const receipt = receiptFromEvidence({
      parsed,
      repository,
      taskContext: {
        schemaVersion: context.schemaVersion,
        taskSha256: sealed.taskSha256,
        sourceSnapshotSha256: context.sourceSnapshot.sha256,
        creationInstructionsSha256: context.bindings.creationInstructionsSha256,
      },
      candidate,
      patch,
      workerEvidence: {
        modificationPatch,
        creations,
        candidateProjection: assembled.projection,
      },
      workerContext: context,
    });
    return Object.freeze({
      receipt,
      serialized: serializeApplicationReceiptV7(receipt),
      contractBytes: Buffer.from(contractBytes),
      repositoryRoot,
    });
  } finally {
    try {
      if (candidate !== undefined) await disposeCandidateV2(candidate);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}
