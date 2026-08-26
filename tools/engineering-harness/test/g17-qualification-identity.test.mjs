import assert from "node:assert/strict";
import test from "node:test";

import { loadG17Contract } from "../src/qualification/contract.mjs";
import {
  currentG17QualificationIdentity,
  g17ReceiptIdentity,
} from "../src/qualification/identity.mjs";
import { repositoryRoot } from "../src/paths.mjs";

test("G1.7 identity binds clean subject, harness, evaluator, lock, toolchain, and host", async () => {
  const repoRoot =
    process.env.OXIGRAPH_TEST_COMMITTED_REPOSITORY_ROOT ?? repositoryRoot;
  const { contract } = loadG17Contract();
  const identity = await currentG17QualificationIdentity({ contract, repoRoot });
  assert.equal(identity.schema, "oxigraph.g1.7-qualified-subject-identity/v1");
  assert.equal(identity.subject.trackedClean, true);
  assert.match(identity.subject.commit, /^[0-9a-f]{40}$/u);
  assert.match(identity.subject.tree, /^[0-9a-f]{40}$/u);
  assert.equal(identity.control.controlCommit, identity.subject.commit);
  assert.match(identity.control.harnessSha256, /^[0-9a-f]{64}$/u);
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
  assert.ok(identity.toolchain.every(({ executableSha256 }) => /^[0-9a-f]{64}$/u.test(executableSha256)));
  assert.match(identity.host.targetTriple, /^[a-z0-9_.-]+$/u);
  assert.ok(Number.isSafeInteger(identity.host.cpuCount) && identity.host.cpuCount > 0);
  assert.match(identity.identitySha256, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.toolchain), true);

  assert.deepEqual(g17ReceiptIdentity(identity), {
    schema: "oxigraph.g1.7-qualification-identity/v1",
    subjectCommit: identity.subject.commit,
    subjectTree: identity.subject.tree,
    harnessSha256: identity.control.harnessSha256,
    evaluatorCommit: identity.evaluator.commit,
    evaluatorBlobSha256: identity.evaluator.blobSetSha256,
    identitySha256: identity.identitySha256,
  });
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
