import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalJson, canonicalSha256 } from "../src/routing/features.mjs";
import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  G17_EVALUATOR_OVERLAY,
  G17_NEGATIVE_CONTROL_SIGNATURE_SCHEMA,
  G17_PRODUCT_IDENTITIES,
  assertG17DecisionApprovalsBefore,
  g17DecisionSetSha256,
  loadG17DecisionSet,
  validateG17NoiseDecision,
  validateG17PerformanceDecision,
  validateG17ReferenceDecision,
} from "../src/qualification/decision-contract.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("G1.7 loads three canonical proposed decisions with distinct product roles", () => {
  const { contract } = loadG17Contract();
  const decisions = loadG17DecisionSet({ contract });
  assert.equal(
    decisions.decisionSetSha256,
    "9a76ace507534b00cb5587e340e89ae24d6a8174b1bc257d532e694185a61efc",
  );
  assert.deepEqual(
    [decisions.reference, decisions.performance, decisions.noise].map(
      ({ status, approval }) => ({ status, approval }),
    ),
    [
      {
        status: "PROPOSED",
        approval: { approvedAt: null, approvedBy: null, status: "UNAPPROVED" },
      },
      {
        status: "PROPOSED",
        approval: { approvedAt: null, approvedBy: null, status: "UNAPPROVED" },
      },
      {
        status: "PROPOSED",
        approval: { approvedAt: null, approvedBy: null, status: "UNAPPROVED" },
      },
    ],
  );
  assert.deepEqual(decisions.reference.products, G17_PRODUCT_IDENTITIES);
  assert.deepEqual(decisions.reference.evaluatorOverlay, G17_EVALUATOR_OVERLAY);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(decisions.reference.products).map(([role, value]) => [
        role,
        value.commit,
      ]),
    ),
    {
      performanceReference: "7eec1f0715e4f28434b2f505e289c9b599991aae",
      noiseControl: "623adae314f3c4093d563900f6376ce78262a9f0",
      negativeControl: "1da47285113eee75c916c34f543e7f7f4e5c747b",
    },
  );
  assert.equal(
    Object.values(decisions.reference.products).some(
      ({ commit }) => commit === G17_EVALUATOR_OVERLAY.commit,
    ),
    false,
  );
  assert.equal(
    decisions.reference.controlPlan.negativeControl.expectedSignature,
    null,
  );
  for (const artifact of Object.values(decisions.artifacts)) {
    assert.equal(Object.hasOwn(artifact, "bytes"), false);
    assert.equal(Number.isSafeInteger(artifact.byteLength), true);
  }
  assert.equal(
    decisions.noise.cases.every(
      ({ maximumMadBasisPoints }) => maximumMadBasisPoints === 500,
    ),
    true,
  );
  assert.throws(
    () =>
      assertG17DecisionApprovalsBefore(decisions, "2026-08-28T00:00:00.000Z"),
    /not approved/u,
  );
});

test("a future exact selected decision is representable and approval time is strict", () => {
  const current = loadG17DecisionSet({ contract: loadG17Contract().contract });
  const reference = structuredClone(current.reference);
  reference.status = "SELECTED";
  reference.controlPlan.negativeControl.expectedSignature = {
    schema: G17_NEGATIVE_CONTROL_SIGNATURE_SCHEMA,
    suiteHash: reference.suiteHash,
    status: "FAIL",
    budgetBreaches: ["on-store-memory"],
    sampleSetSha256: "c".repeat(64),
  };
  reference.approval = {
    status: "APPROVED",
    approvedBy: "qualification-review-board",
    approvedAt: "2026-08-27T12:00:00.000Z",
  };
  const { contentHash: ignoredReferenceHash, ...referenceUnsigned } = reference;
  reference.contentHash = canonicalSha256(referenceUnsigned);

  const performance = structuredClone(current.performance);
  performance.status = "APPROVED";
  performance.approval = structuredClone(reference.approval);
  const { contentHash: ignoredPerformanceHash, ...performanceUnsigned } =
    performance;
  performance.contentHash = canonicalSha256(performanceUnsigned);

  const noise = structuredClone(current.noise);
  noise.status = "APPROVED";
  noise.approval = structuredClone(reference.approval);
  const { contentHash: ignoredNoiseHash, ...noiseUnsigned } = noise;
  noise.contentHash = canonicalSha256(noiseUnsigned);

  const approved = {
    reference: validateG17ReferenceDecision(reference),
    performance: validateG17PerformanceDecision(performance),
    noise: validateG17NoiseDecision(noise),
  };
  assert.equal(
    assertG17DecisionApprovalsBefore(approved, "2026-08-27T12:00:00.001Z"),
    true,
  );
  for (const startedAt of [
    "2026-08-27T12:00:00.000Z",
    "2026-08-27T11:59:59.999Z",
  ]) {
    assert.throws(
      () => assertG17DecisionApprovalsBefore(approved, startedAt),
      /not approved before/u,
    );
  }

  const contract = structuredClone(loadG17Contract().contract);
  contract.referenceDecision.contentHash = reference.contentHash;
  contract.referenceDecision.sha256 = sha256(
    Buffer.from(`${canonicalJson(reference)}\n`, "utf8"),
  );
  assert.throws(
    () => loadG17DecisionSet({ contract }),
    /descriptor (?:sha256|contentHash) drifted/u,
  );
});

test("decision validators reject evaluator-as-product and fabricated approval", () => {
  const decisions = loadG17DecisionSet({
    contract: loadG17Contract().contract,
  });
  const wrongProduct = structuredClone(decisions.reference);
  wrongProduct.products.performanceReference.commit =
    G17_EVALUATOR_OVERLAY.commit;
  const { contentHash: ignoredReferenceHash, ...wrongProductUnsigned } =
    wrongProduct;
  wrongProduct.contentHash = canonicalSha256(wrongProductUnsigned);
  assert.throws(
    () => validateG17ReferenceDecision(wrongProduct),
    /product identities drifted|substituted/u,
  );

  const wrongOverlay = structuredClone(decisions.reference);
  wrongOverlay.evaluatorOverlay.roleCompositions.noiseControl.effectiveTree =
    "d".repeat(40);
  const { contentHash: ignoredOverlayHash, ...wrongOverlayUnsigned } =
    wrongOverlay;
  wrongOverlay.contentHash = canonicalSha256(wrongOverlayUnsigned);
  assert.throws(
    () => validateG17ReferenceDecision(wrongOverlay),
    /overlay binding drifted/u,
  );

  const fabricated = structuredClone(decisions.noise);
  fabricated.status = "APPROVED";
  fabricated.approval.status = "APPROVED";
  fabricated.approval.approvedBy = null;
  fabricated.approval.approvedAt = "2026-08-27T00:00:00.000Z";
  const { contentHash: ignoredNoiseHash, ...fabricatedUnsigned } = fabricated;
  fabricated.contentHash = canonicalSha256(fabricatedUnsigned);
  assert.throws(() => validateG17NoiseDecision(fabricated), /named approver/u);

  const prematureSelection = structuredClone(decisions.reference);
  prematureSelection.status = "SELECTED";
  prematureSelection.approval = {
    status: "APPROVED",
    approvedBy: "reviewer@example.invalid",
    approvedAt: "2026-08-27T00:00:00.000Z",
  };
  const { contentHash: ignoredSelectionHash, ...selectionUnsigned } =
    prematureSelection;
  prematureSelection.contentHash = canonicalSha256(selectionUnsigned);
  assert.throws(
    () => validateG17ReferenceDecision(prematureSelection),
    /frozen negative-control signature/u,
  );
});

test("decision loader rejects noncanonical bytes and caller-rewritten descriptors", async (t) => {
  const sourceContract = loadG17Contract().contract;
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-decisions-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "qualification", "g1.7", "decisions");
  await mkdir(target, { recursive: true });
  const artifacts = {};
  for (const [name, descriptor] of [
    ["reference", sourceContract.referenceDecision],
    ["performance-budget", sourceContract.budgetDecision],
    ["noise-budget", sourceContract.noiseDecision],
  ]) {
    const bytes = await readFile(
      new URL(`../qualification/g1.7/decisions/${name}.json`, import.meta.url),
    );
    artifacts[name] = bytes;
    await writeFile(join(target, `${name}.json`), bytes);
  }
  const contract = structuredClone(sourceContract);
  const value = JSON.parse(artifacts.reference);
  const noncanonical = Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(target, "reference.json"), noncanonical);
  assert.throws(
    () => loadG17DecisionSet({ contract: sourceContract, root }),
    /raw hash does not verify/u,
  );
  contract.referenceDecision.sha256 = sha256(noncanonical);
  contract.decisionSetSha256 = g17DecisionSetSha256({
    reference: contract.referenceDecision,
    performance: contract.budgetDecision,
    noise: contract.noiseDecision,
  });
  assert.throws(
    () => loadG17DecisionSet({ contract, root }),
    /descriptor sha256 drifted/u,
  );
});

test("decision loader uses no-follow stable reads", async (t) => {
  const sourceContract = loadG17Contract().contract;
  const root = await mkdtemp(join(tmpdir(), "oxigraph-g17-decisions-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "qualification", "g1.7", "decisions");
  await mkdir(target, { recursive: true });
  for (const name of ["performance-budget", "noise-budget"]) {
    const bytes = await readFile(
      new URL(`../qualification/g1.7/decisions/${name}.json`, import.meta.url),
    );
    await writeFile(join(target, `${name}.json`), bytes);
  }
  const referencePath = new URL(
    "../qualification/g1.7/decisions/reference.json",
    import.meta.url,
  );
  await symlink(referencePath, join(target, "reference.json"));
  assert.throws(
    () => loadG17DecisionSet({ contract: sourceContract, root }),
    /cannot be read safely/u,
  );
});

test("decision files bind canonical self-hash and raw LF bytes", async () => {
  const { contract } = loadG17Contract();
  for (const descriptor of [
    contract.referenceDecision,
    contract.budgetDecision,
    contract.noiseDecision,
  ]) {
    const bytes = await readFile(
      new URL(`../${descriptor.path}`, import.meta.url),
    );
    const value = JSON.parse(bytes);
    const { contentHash, ...unsigned } = value;
    assert.equal(contentHash, canonicalSha256(unsigned));
    assert.equal(
      bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8")),
      true,
    );
    assert.equal(sha256(bytes), descriptor.sha256);
    assert.equal(contentHash, descriptor.contentHash);
  }
});
