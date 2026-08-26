import assert from "node:assert/strict";
import test from "node:test";

import {
  createG17Receipt,
  g17ReceiptBytes,
  verifyG17Receipt,
} from "../src/qualification/receipt.mjs";

function draft() {
  return {
    run: {
      id: "run-00000001",
      startedAt: "2026-08-26T18:00:00.000Z",
      finishedAt: "2026-08-26T18:00:01.000Z",
    },
    contract: {
      id: "g1.7-compatibility-performance-qualification",
      sha256: "1".repeat(64),
      suiteHash: "2".repeat(64),
      referenceDecision: "UNSELECTED",
      budgetDecision: "ABSENT",
      noiseDecision: "ABSENT",
    },
    identity: {
      schema: "oxigraph.g1.7-qualification-identity/v1",
      subjectCommit: "3".repeat(40),
      subjectTree: "4".repeat(40),
      harnessSha256: "5".repeat(64),
      evaluatorCommit: "6".repeat(40),
      evaluatorBlobSha256: "7".repeat(64),
    },
    evidence: {
      semantic: {
        status: "MISSING",
        sha256: null,
        reasons: ["independent-verification-absent"],
        projection: null,
      },
      compatibility: {
        status: "MISSING",
        sha256: null,
        reasons: ["agentic-receipt-absent"],
        projection: null,
      },
    },
    benchmark: {
      status: "NOT_RUN",
      sampleCount: 0,
      samplesSha256: null,
      summarySha256: null,
      budgetBreaches: [],
    },
    final: {
      verdict: "INCONCLUSIVE",
      reasons: [
        "reference-unselected",
        "performance-budget-absent",
        "noise-budget-absent",
        "semantic-missing",
        "compatibility-missing",
        "benchmark-not-run",
      ],
    },
    artifacts: [
      {
        name: "contract.json",
        bytes: 4096,
        sha256: "8".repeat(64),
      },
      {
        name: "observations.json",
        bytes: 1024,
        sha256: "9".repeat(64),
      },
    ],
  };
}

test("G1.7 receipt is canonical, hash-bound, and permanently non-authoritative", () => {
  const receipt = createG17Receipt(draft());
  assert.deepEqual(receipt.authority, {
    localOnly: true,
    promotionAuthority: false,
    routerQualityAuthority: false,
    publicationAuthority: false,
  });
  for (const key of ["contentHash", "executionHash", "receiptSha256"]) {
    assert.match(receipt[key], /^[0-9a-f]{64}$/u);
  }
  const bytes = g17ReceiptBytes(receipt);
  assert.equal(bytes.at(-1), 0x0a);
  assert.deepEqual(verifyG17Receipt(bytes), {
    ok: true,
    receipt,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    receiptSha256: receipt.receiptSha256,
  });
});

test("G1.7 receipt verifier rejects authority, identity, artifact, and hash tampering", () => {
  const pristine = createG17Receipt(draft());
  for (const mutate of [
    (receipt) => {
      receipt.authority.promotionAuthority = true;
    },
    (receipt) => {
      receipt.identity.subjectCommit = "a".repeat(40);
    },
    (receipt) => {
      receipt.artifacts[0].name = "../contract.json";
    },
    (receipt) => {
      receipt.artifacts.reverse();
    },
    (receipt) => {
      receipt.final.verdict = "ACCEPT";
    },
    (receipt) => {
      receipt.receiptSha256 = "f".repeat(64);
    },
  ]) {
    const candidate = structuredClone(pristine);
    mutate(candidate);
    assert.throws(() => verifyG17Receipt(candidate), /G1\.7 qualification receipt/u);
  }
});

test("G1.7 receipt creation rejects verdict and evidence inconsistencies", () => {
  const invalid = draft();
  invalid.final.verdict = "ACCEPT";
  assert.throws(() => createG17Receipt(invalid), /classification does not match/u);

  const duplicate = draft();
  duplicate.artifacts[1].name = duplicate.artifacts[0].name;
  assert.throws(() => createG17Receipt(duplicate), /artifact inventory/u);
});

test("G1.7 receipt creation rejects vacuous PASS evidence and benchmark claims", () => {
  const invalid = draft();
  invalid.contract.referenceDecision = "SELECTED";
  invalid.contract.budgetDecision = "APPROVED";
  invalid.contract.noiseDecision = "APPROVED";
  invalid.evidence.semantic = {
    status: "PASS",
    sha256: null,
    reasons: [],
    projection: null,
  };
  invalid.evidence.compatibility = {
    status: "PASS",
    sha256: null,
    reasons: [],
    projection: null,
  };
  invalid.benchmark = {
    status: "PASS",
    sampleCount: 0,
    samplesSha256: null,
    summarySha256: null,
    budgetBreaches: [],
  };
  invalid.final = { verdict: "ACCEPT", reasons: [] };
  assert.throws(
    () => createG17Receipt(invalid),
    /PASS evidence requires a hash-bound projection|executed benchmark/u,
  );
});
