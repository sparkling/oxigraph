import assert from "node:assert/strict";
import test from "node:test";
import { MUTATION_RECEIPT_SCHEMA_VERSION } from "../mutation/evidence.mjs";
import {
  qualificationContentHash,
  trustedRealGateValid,
  validateQualificationReceipt,
  validateVerificationReceipt,
  verificationContentHash,
} from "./evidence.mjs";

const mutationRunId = "00000000-0000-4000-8000-000000000000";
const agenticRunId = "11111111-1111-4111-8111-111111111111";
const fixtureDarwinVersion = "1.2.3";
const options = {
  expectedDarwinVersion: fixtureDarwinVersion,
  requireFull: true,
};

function mutationCounts() {
  return {
    generated: 1,
    caught: 1,
    missed: 0,
    timeout: 0,
    unviable: 0,
    viable: 1,
  };
}

function mutationBinding(inputContentHash) {
  return {
    valid: true,
    error: null,
    path: `target/mutation/oxdatalog/runs/${mutationRunId}/receipt.json`,
    sha256: "1".repeat(64),
    schemaVersion: MUTATION_RECEIPT_SCHEMA_VERSION,
    runId: mutationRunId,
    contentHash: "2".repeat(64),
    executionHash: "3".repeat(64),
    inputContentHash,
    publicationContentHash: "4".repeat(64),
    nativeOutcomesSha256: "5".repeat(64),
    configSha256: "6".repeat(64),
    counts: mutationCounts(),
    mutationScorePercent: 100,
  };
}

function mutationProjection(inputContentHash) {
  const binding = mutationBinding(inputContentHash);
  return {
    receiptSha256: binding.sha256,
    schemaVersion: binding.schemaVersion,
    runId: binding.runId,
    contentHash: binding.contentHash,
    executionHash: binding.executionHash,
    inputContentHash: binding.inputContentHash,
    publicationContentHash: binding.publicationContentHash,
    nativeOutcomesSha256: binding.nativeOutcomesSha256,
    configSha256: binding.configSha256,
    counts: binding.counts,
    mutationScorePercent: binding.mutationScorePercent,
  };
}

function agenticBinding(
  generatedAt = "2026-07-26T00:00:00.500Z",
) {
  const artifactContentHash = "9".repeat(64);
  const root =
    `target/agentic-qe/metaharness-semantic-gate/runs/${agenticRunId}`;
  return {
    path: `${root}/receipt.json`,
    sha256: "a".repeat(64),
    schemaVersion: 4,
    runId: agenticRunId,
    generatedAt,
    contentHash: "b".repeat(64),
    executionHash: "c".repeat(64),
    oraclePath: `${root}/oracle.json`,
    oracleSha256: "d".repeat(64),
    implementationContentHash: "e".repeat(64),
    artifactContentHash,
    archiveContentHash: "f".repeat(64),
    archiveRoot:
      `target/agentic-qe/metaharness-semantic-gate/artifacts/${artifactContentHash}`,
    archiveFileCount: 1,
  };
}

function agenticProjection() {
  const binding = agenticBinding();
  return {
    schemaVersion: binding.schemaVersion,
    runId: binding.runId,
    generatedAt: binding.generatedAt,
    receiptSha256: binding.sha256,
    oracleSha256: binding.oracleSha256,
    contentHash: binding.contentHash,
    executionHash: binding.executionHash,
    implementationContentHash: binding.implementationContentHash,
    artifactContentHash: binding.artifactContentHash,
    archiveContentHash: binding.archiveContentHash,
  };
}

function qualificationReceipt() {
  const hash = "a".repeat(64);
  const receipt = {
    schemaVersion: 2,
    qualification: "oxigraph-policy-only-darwin",
    darwinVersion: fixtureDarwinVersion,
    mode: "synthetic-and-semantic-gate",
    runtime: {
      node: {
        path: "/test/node",
        version: "v1",
        executableSha256: "b".repeat(64),
      },
    },
    startedAt: "2026-07-26T00:00:00.000Z",
    finishedAt: "2026-07-26T00:00:01.000Z",
    policyBoundary: { mutable: [], protectedInputs: [] },
    inputs: {
      before: { contentHash: hash },
      after: { contentHash: hash },
      changedPaths: [],
      protectedInputsStable: true,
      darwin: {
        before: { contentHash: "c".repeat(64) },
        after: { contentHash: "c".repeat(64) },
        stable: true,
      },
      implementationStable: true,
    },
    synthetic: {
      projectionHash: "d".repeat(64),
      replayProjectionHash: "d".repeat(64),
    },
    safety: {
      directoryBlocked: true,
      generatedCodeBlocked: true,
    },
    mutation: mutationBinding(hash),
    realGate: {
      taskId: "task",
      exitCode: 0,
      timedOut: false,
      blockedActions: [],
      durationMs: 1_000,
      stdoutHash: "e".repeat(64),
      stderrHash: "f".repeat(64),
      agenticReceipt: agenticBinding(),
      receiptError: null,
      passed: true,
    },
    gates: {
      solve: true,
      regression: true,
      safety: true,
      cost: true,
      reproducibility: true,
    },
    passed: true,
  };
  receipt.contentHash = qualificationContentHash(receipt);
  return receipt;
}

function withHash(receipt) {
  receipt.contentHash = qualificationContentHash(receipt);
  return receipt;
}

function expectInvalid(receipt, validationOptions = options) {
  assert.throws(
    () => validateQualificationReceipt(receipt, validationOptions),
    /hash or gate contract/,
  );
}

test("qualification receipt closes trace, gate, hash, and time contracts", () => {
  const receipt = qualificationReceipt();
  assert.doesNotThrow(() => validateQualificationReceipt(receipt, options));
  assert.equal(trustedRealGateValid(receipt.realGate), true);

  const invalidRealGates = [
    { ...receipt.realGate, exitCode: 1 },
    { ...receipt.realGate, timedOut: true },
    { ...receipt.realGate, blockedActions: ["network-write"] },
    { ...receipt.realGate, durationMs: 1_200_001 },
    { ...receipt.realGate, stdoutHash: "invalid" },
    { ...receipt.realGate, agenticReceipt: null },
    {
      ...receipt.realGate,
      agenticReceipt: agenticBinding("2026-07-26T00:00:00Z"),
    },
    { ...receipt.realGate, receiptError: "failed" },
    { ...receipt.realGate, passed: false },
    { ...receipt.realGate, unexpected: true },
  ];
  const { durationMs: _durationMs, ...missingDuration } = receipt.realGate;
  invalidRealGates.push(missingDuration);
  for (const realGate of invalidRealGates) {
    assert.equal(trustedRealGateValid(realGate), false);
    expectInvalid(withHash({ ...receipt, realGate }));
  }

  for (const change of [
    { startedAt: "2026-07-25T23:59:59.000Z" },
    { finishedAt: "2026-07-26T00:00:02.000Z" },
    { realGate: { ...receipt.realGate, durationMs: 1_001 } },
  ]) {
    const tampered = { ...receipt, ...change };
    assert.notEqual(qualificationContentHash(tampered), receipt.contentHash);
    expectInvalid(tampered);
  }

  const { safety: _safety, ...missingGate } = receipt.gates;
  for (const gates of [
    missingGate,
    { ...receipt.gates, unexpected: true },
  ]) {
    expectInvalid(withHash({ ...receipt, gates }));
  }

  for (const generatedAt of [
    "2026-07-25T23:59:59.999Z",
    "2026-07-26T00:00:01.001Z",
  ]) {
    const realGate = {
      ...receipt.realGate,
      agenticReceipt: agenticBinding(generatedAt),
    };
    assert.equal(trustedRealGateValid(realGate), true);
    expectInvalid(withHash({ ...receipt, realGate }));
  }
  for (const generatedAt of [receipt.startedAt, receipt.finishedAt]) {
    const realGate = {
      ...receipt.realGate,
      agenticReceipt: agenticBinding(generatedAt),
    };
    assert.doesNotThrow(() =>
      validateQualificationReceipt(withHash({ ...receipt, realGate }), options),
    );
  }

  for (const timestamps of [
    { startedAt: "2026-07-26T00:00:00Z" },
    { finishedAt: "2026-07-25T23:59:59.999Z" },
  ]) {
    expectInvalid(withHash({ ...receipt, ...timestamps }));
  }
  expectInvalid({ ...receipt, contentHash: "1".repeat(64) });
});

test("synthetic qualification remains valid only at its explicit boundary", () => {
  const synthetic = withHash({
    ...qualificationReceipt(),
    mode: "synthetic-only",
    mutation: null,
    realGate: null,
  });
  assert.doesNotThrow(() =>
    validateQualificationReceipt(synthetic, {
      expectedDarwinVersion: fixtureDarwinVersion,
      requireFull: false,
    }),
  );
  assert.throws(
    () => validateQualificationReceipt(synthetic, options),
    /hash or gate contract/,
  );
  for (const change of [
    { mode: "unreviewed-mode" },
    { mutation: qualificationReceipt().mutation },
    { realGate: qualificationReceipt().realGate },
  ]) {
    expectInvalid(withHash({ ...synthetic, ...change }), {
      expectedDarwinVersion: fixtureDarwinVersion,
      requireFull: false,
    });
  }
});

test("verification receipt recomputes the full evidence projection", () => {
  const receipt = qualificationReceipt();
  const verificationOptions = {
    qualification: {
      path: "target/metaharness/qualification.json",
      sha256: "1".repeat(64),
      contentHash: receipt.contentHash,
    },
    protectedContentHash: "a".repeat(64),
    darwinContentHash: "c".repeat(64),
    mutation: mutationProjection("a".repeat(64)),
    agentic: agenticProjection(),
  };
  const verification = {
    schemaVersion: 1,
    verified: true,
    ...verificationOptions,
  };
  verification.contentHash = verificationContentHash(verification);
  assert.doesNotThrow(() =>
    validateVerificationReceipt(verification, verificationOptions),
  );
  assert.throws(
    () =>
      validateVerificationReceipt(
        {
          ...verification,
          agentic: {
            ...verification.agentic,
            archiveContentHash: "0".repeat(64),
          },
        },
        verificationOptions,
      ),
    /evidence bindings/,
  );
});
