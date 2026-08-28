import assert from "node:assert/strict";
import test from "node:test";

import { canonicalSha256 } from "../src/routing/features.mjs";
import {
  G17_CURRENT_CONTRACT_SHA256,
  G17_LEGACY_V3_CONTRACT_SHA256,
} from "../src/qualification/contract.mjs";
import {
  G17_COMPATIBILITY_EVIDENCE_SCHEMA,
  G17_LEGACY_COMPATIBILITY_EVIDENCE_SCHEMAS,
  G17_SEMANTIC_EVIDENCE_SCHEMA,
} from "../src/qualification/evidence-contract.mjs";
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

function passEvidence(schema) {
  const projection = { schema, status: "PASS" };
  return {
    status: "PASS",
    sha256: canonicalSha256(projection),
    reasons: [],
    projection,
  };
}

function acceptingDraft() {
  const value = draft();
  value.contract.sha256 = G17_CURRENT_CONTRACT_SHA256;
  value.contract.referenceDecision = "SELECTED";
  value.contract.budgetDecision = "APPROVED";
  value.contract.noiseDecision = "APPROVED";
  value.evidence.semantic = passEvidence(G17_SEMANTIC_EVIDENCE_SCHEMA);
  value.evidence.compatibility = passEvidence(
    G17_COMPATIBILITY_EVIDENCE_SCHEMA,
  );
  value.benchmark = {
    status: "PASS",
    sampleCount: 1,
    samplesSha256: "a".repeat(64),
    summarySha256: "b".repeat(64),
    budgetBreaches: [],
  };
  value.final = { verdict: "ACCEPT", reasons: [] };
  return value;
}

function resealReceipt(receipt) {
  const value = structuredClone(receipt);
  value.contentHash = canonicalSha256({
    schema: value.schema,
    contract: value.contract,
    identity: value.identity,
    evidence: value.evidence,
    benchmark: value.benchmark,
    authority: value.authority,
    final: value.final,
    artifacts: value.artifacts,
  });
  value.executionHash = canonicalSha256({
    contentHash: value.contentHash,
    run: value.run,
  });
  value.receiptSha256 = canonicalSha256({
    schema: value.schema,
    run: value.run,
    contract: value.contract,
    identity: value.identity,
    evidence: value.evidence,
    benchmark: value.benchmark,
    authority: value.authority,
    final: value.final,
    artifacts: value.artifacts,
    contentHash: value.contentHash,
    executionHash: value.executionHash,
  });
  return value;
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
    structurallyValid: true,
    verificationStatus: "STRUCTURALLY_VALID",
    qualificationEligible: false,
    evidenceSchemaState: {
      semantic: "NOT_APPLICABLE",
      compatibility: "NOT_APPLICABLE",
    },
    receipt,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    receiptSha256: receipt.receiptSha256,
  });
});

test("structural verification marks current PASS evidence as unreplayed", () => {
  const receipt = createG17Receipt(acceptingDraft());
  const verification = verifyG17Receipt(g17ReceiptBytes(receipt));
  assert.equal(verification.ok, true);
  assert.equal(verification.structurallyValid, true);
  assert.equal(verification.verificationStatus, "STRUCTURALLY_VALID");
  assert.equal(verification.qualificationEligible, false);
  assert.deepEqual(verification.evidenceSchemaState, {
    semantic: "CURRENT_SCHEMA_UNREPLAYED",
    compatibility: "CURRENT_SCHEMA_UNREPLAYED",
  });
  assert.equal("evidenceAssurance" in verification, false);
});

test("structural verification keeps v3 contract PASS replay-only", () => {
  const legacy = acceptingDraft();
  legacy.contract.sha256 = G17_LEGACY_V3_CONTRACT_SHA256;
  const receipt = createG17Receipt(legacy);
  const verification = verifyG17Receipt(g17ReceiptBytes(receipt));
  assert.equal(verification.ok, false);
  assert.equal(verification.verificationStatus, "LEGACY_REPLAY_ONLY");
  assert.equal(verification.qualificationEligible, false);
  assert.deepEqual(verification.evidenceSchemaState, {
    semantic: "CURRENT_SCHEMA_UNREPLAYED",
    compatibility: "CURRENT_SCHEMA_UNREPLAYED",
  });
});

test("structural verification preserves explicit v2 compatibility PASS as legacy replay-only", () => {
  const receipt = structuredClone(createG17Receipt(acceptingDraft()));
  receipt.evidence.compatibility.projection.schema =
    G17_LEGACY_COMPATIBILITY_EVIDENCE_SCHEMAS[0];
  receipt.evidence.compatibility.sha256 = canonicalSha256(
    receipt.evidence.compatibility.projection,
  );
  const legacy = resealReceipt(receipt);
  const verification = verifyG17Receipt(g17ReceiptBytes(legacy));
  assert.equal(verification.structurallyValid, true);
  assert.equal(verification.ok, false);
  assert.equal(verification.verificationStatus, "LEGACY_REPLAY_ONLY");
  assert.equal(verification.qualificationEligible, false);
  assert.deepEqual(verification.evidenceSchemaState, {
    semantic: "CURRENT_SCHEMA_UNREPLAYED",
    compatibility: "LEGACY_REPLAY_ONLY",
  });
});

test("G1.7 receipt creation requires each PASS projection's current schema", () => {
  assert.doesNotThrow(() => createG17Receipt(acceptingDraft()));

  for (const lane of ["semantic", "compatibility"]) {
    const absent = acceptingDraft();
    delete absent.evidence[lane].projection.schema;
    absent.evidence[lane].sha256 = canonicalSha256(
      absent.evidence[lane].projection,
    );
    assert.throws(
      () => createG17Receipt(absent),
      /PASS evidence requires its current projection schema/u,
    );

    for (const schema of [
      lane === "semantic"
        ? G17_COMPATIBILITY_EVIDENCE_SCHEMA
        : G17_SEMANTIC_EVIDENCE_SCHEMA,
      "oxigraph.g1.7-unknown-evidence/v99",
    ]) {
      const unsupported = acceptingDraft();
      unsupported.evidence[lane].projection.schema = schema;
      unsupported.evidence[lane].sha256 = canonicalSha256(
        unsupported.evidence[lane].projection,
      );
      assert.throws(
        () => createG17Receipt(unsupported),
        /evidence projection schema is unsupported/u,
      );
    }
  }
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
    assert.throws(
      () => verifyG17Receipt(candidate),
      /G1\.7 qualification receipt/u,
    );
  }
});

test("G1.7 receipt creation rejects verdict and evidence inconsistencies", () => {
  const invalid = draft();
  invalid.final.verdict = "ACCEPT";
  assert.throws(
    () => createG17Receipt(invalid),
    /classification does not match/u,
  );

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

test("G1.7 receipt preserves proposed decision status without authority", () => {
  const proposed = draft();
  proposed.contract.sha256 = G17_CURRENT_CONTRACT_SHA256;
  proposed.contract.referenceDecision = "PROPOSED";
  proposed.contract.budgetDecision = "PROPOSED";
  proposed.contract.noiseDecision = "PROPOSED";
  proposed.final = {
    verdict: "INCONCLUSIVE",
    reasons: [
      "reference-proposed",
      "performance-budget-proposed",
      "noise-budget-proposed",
      "semantic-missing",
      "compatibility-missing",
      "benchmark-not-run",
    ],
  };
  const receipt = createG17Receipt(proposed);
  assert.equal(verifyG17Receipt(g17ReceiptBytes(receipt)).ok, true);
  assert.equal(receipt.authority.promotionAuthority, false);

  const legacy = structuredClone(proposed);
  legacy.contract.sha256 = G17_LEGACY_V3_CONTRACT_SHA256;
  assert.throws(
    () => createG17Receipt(legacy),
    /reference decision is invalid/u,
  );
});

test("current G1.7 receipt permits budget breaches only on strict FAIL", () => {
  for (const benchmarkStatus of [
    "NOT_RUN",
    "MISSING",
    "INCONCLUSIVE",
    "NOISY",
  ]) {
    const invalid = draft();
    invalid.contract.sha256 = G17_CURRENT_CONTRACT_SHA256;
    invalid.benchmark.status = benchmarkStatus;
    invalid.benchmark.budgetBreaches = ["on-store-memory"];
    if (benchmarkStatus === "NOISY") {
      invalid.benchmark.sampleCount = 1;
      invalid.benchmark.samplesSha256 = "a".repeat(64);
      invalid.benchmark.summarySha256 = "b".repeat(64);
    }
    assert.throws(
      () => createG17Receipt(invalid),
      /only a failing benchmark may contain budget breaches/u,
    );
  }
});

test("legacy receipt replays NOISY breaches and unknown duplicate FAIL breaches", () => {
  for (const [status, budgetBreaches, reasons] of [
    ["NOISY", ["legacy-noise"], ["performance-budget-breached:legacy-noise"]],
    [
      "FAIL",
      ["legacy-z", "legacy-z", "legacy-a"],
      [
        "benchmark-failed",
        "performance-budget-breached:legacy-z",
        "performance-budget-breached:legacy-z",
        "performance-budget-breached:legacy-a",
      ],
    ],
  ]) {
    const legacy = acceptingDraft();
    legacy.contract.sha256 = G17_LEGACY_V3_CONTRACT_SHA256;
    legacy.benchmark = {
      status,
      sampleCount: 1,
      samplesSha256: "a".repeat(64),
      summarySha256: "b".repeat(64),
      budgetBreaches,
    };
    legacy.final = { verdict: "REJECT", reasons };
    const receipt = createG17Receipt(legacy);
    const verified = verifyG17Receipt(g17ReceiptBytes(receipt));
    assert.equal(verified.ok, false);
    assert.equal(verified.verificationStatus, "LEGACY_REPLAY_ONLY");
  }
});
