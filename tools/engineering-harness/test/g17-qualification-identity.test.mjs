import assert from "node:assert/strict";
import test from "node:test";

import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  currentG17QualificationIdentity,
  g17QualificationToolchain,
  g17ReceiptIdentity,
  verifyG17QualificationIdentity,
} from "../src/qualification/identity.mjs";
import { canonicalSha256 } from "../src/routing/features.mjs";
import { repositoryRoot } from "../src/paths.mjs";
import { g17IdentityFixture } from "./support/g17-identity-fixture.mjs";

function rehashIdentity(identity) {
  const { identitySha256: _identitySha256, ...binding } = identity;
  identity.identitySha256 = canonicalSha256(binding);
  return identity;
}

test("G1.7 identity v2 fixture separates the pinned subject from its control commit", () => {
  const identity = g17IdentityFixture();
  assert.equal(
    identity.subject.commit,
    "e9d2db1b7c4eb974b406136e667e09ba06e34b48",
  );
  assert.equal(
    identity.control.controlCommit,
    "285e6e4b96980f060b450ba96393c13ea5e5c5dd",
  );
  assert.notEqual(identity.control.controlCommit, identity.subject.commit);

  const receiptIdentity = g17ReceiptIdentity(identity);
  assert.equal(
    receiptIdentity.schema,
    "oxigraph.g1.7-qualification-identity/v2",
  );
  assert.equal(receiptIdentity.subjectCommit, identity.subject.commit);
  assert.equal(receiptIdentity.controlCommit, identity.control.controlCommit);

  const tampered = structuredClone(identity);
  tampered.control.controlCommit = "f".repeat(40);
  rehashIdentity(tampered);
  assert.throws(
    () => verifyG17QualificationIdentity(tampered),
    /qualified control digest is invalid/u,
  );
});

test("G1.7 identity binds the sealed e9 subject separately from descendant harness control", async () => {
  const repoRoot =
    process.env.OXIGRAPH_TEST_COMMITTED_REPOSITORY_ROOT ?? repositoryRoot;
  const { contract } = loadG17Contract();
  const identity = await currentG17QualificationIdentity({
    contract,
    repoRoot,
  });
  assert.equal(identity.schema, "oxigraph.g1.7-qualified-subject-identity/v2");
  assert.equal(identity.subject.trackedClean, true);
  assert.deepEqual(
    {
      commit: identity.subject.commit,
      tree: identity.subject.tree,
      cargoLockBlob: identity.cargoLock.blob,
      cargoLockSha256: identity.cargoLock.sha256,
    },
    contract.subject.product,
  );
  assert.notEqual(identity.control.controlCommit, identity.subject.commit);
  assert.match(identity.control.harnessSha256, /^[0-9a-f]{64}$/u);
  assert.equal(contract.subject.evaluator.commit, contract.evaluator.commit);
  assert.equal(contract.subject.evaluator.state, "PRESENT_AS_ANCESTOR");
  assert.equal(contract.subject.evaluator.composition.mode, "ALREADY_PRESENT");
  assert.equal(
    contract.subject.evaluator.composition.baseManifestBlob,
    contract.subject.evaluator.composition.effectiveManifestBlob,
  );
  assert.equal(
    contract.subject.evaluator.composition.effectiveTree,
    contract.subject.product.tree,
  );
  assert.equal(identity.evaluator.commit, contract.evaluator.commit);
  assert.equal(identity.evaluator.parent, contract.evaluator.parent);
  assert.equal(identity.evaluator.tree, contract.evaluator.tree);
  assert.match(identity.evaluator.blobSetSha256, /^[0-9a-f]{64}$/u);
  assert.match(identity.cargoLock.blob, /^[0-9a-f]{40}$/u);
  assert.match(identity.cargoLock.sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(
    identity.toolchain.map(({ program }) => program),
    ["cargo", "rustc"],
  );
  assert.ok(
    identity.toolchain.every(({ executableSha256 }) =>
      /^[0-9a-f]{64}$/u.test(executableSha256),
    ),
  );
  assert.match(identity.host.targetTriple, /^[a-z0-9_.-]+$/u);
  assert.ok(
    Number.isSafeInteger(identity.host.cpuCount) && identity.host.cpuCount > 0,
  );
  assert.match(identity.identitySha256, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.toolchain), true);

  assert.deepEqual(g17ReceiptIdentity(identity), {
    schema: "oxigraph.g1.7-qualification-identity/v2",
    subjectCommit: identity.subject.commit,
    subjectTree: identity.subject.tree,
    controlCommit: identity.control.controlCommit,
    harnessSha256: identity.control.harnessSha256,
    evaluatorCommit: identity.evaluator.commit,
    evaluatorBlobSha256: identity.evaluator.blobSetSha256,
    identitySha256: identity.identitySha256,
  });
  assert.deepEqual(verifyG17QualificationIdentity(identity), identity);
  assert.deepEqual(Object.keys(g17QualificationToolchain(identity)), [
    "cargo",
    "rustc",
  ]);

  const mutants = [
    (candidate) => delete candidate.toolchain[0].toolchainExecutableSha256,
    (candidate) => {
      candidate.toolchain[1].program = "cargo";
    },
    (candidate) => {
      candidate.toolchain[0].versionStdout += "\n";
    },
    (candidate) => {
      candidate.toolchain[0].toolchainPath = "relative/cargo";
    },
    (candidate) => {
      candidate.toolchain[0].toolchainExecutableSha256 = "z".repeat(64);
    },
    (candidate) => {
      candidate.control.controlCommit = "f".repeat(40);
    },
  ];
  for (const mutate of mutants) {
    const candidate = structuredClone(identity);
    mutate(candidate);
    rehashIdentity(candidate);
    assert.throws(
      () => verifyG17QualificationIdentity(candidate),
      /G1\.7 identity/u,
    );
    assert.throws(() => g17ReceiptIdentity(candidate), /G1\.7 identity/u);
  }
});

test("G1.7 identity rejects evaluator claims that do not match Git", async () => {
  const repoRoot =
    process.env.OXIGRAPH_TEST_COMMITTED_REPOSITORY_ROOT ?? repositoryRoot;
  const { contract } = loadG17Contract();
  const candidate = structuredClone(contract);
  candidate.evaluator.paths[0].blob = "f".repeat(40);
  await assert.rejects(
    currentG17QualificationIdentity({ contract: candidate, repoRoot }),
    /G1\.7 identity: evaluator/u,
  );
});
