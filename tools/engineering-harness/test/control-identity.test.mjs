import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { loadTaskContract } from "../src/contract.mjs";
import { canonicalSha256 } from "../src/routing/features.mjs";
import {
  currentCommittedHarnessIdentity,
  currentControlIdentity,
  ignoredByGit,
} from "../src/runtime/control-identity.mjs";
import { harnessRoot, repositoryRoot } from "../src/paths.mjs";

test("committed control identity binds Git, dependencies, and both native hosts", async () => {
  const { contract } = loadTaskContract();
  const repoRoot =
    process.env.OXIGRAPH_TEST_COMMITTED_REPOSITORY_ROOT ?? repositoryRoot;
  const committed = currentCommittedHarnessIdentity({ repoRoot });
  const identity = await currentControlIdentity({ contract, repoRoot });
  assert.deepEqual(Object.keys(committed), [
    "controlCommit",
    "harnessTree",
    "harnessManifestSha256",
    "manifestSha256",
    "lockfileSha256",
    "npmrcSha256",
    "dependencies",
  ]);
  assert.ok(Object.isFrozen(committed));
  assert.deepEqual(
    {
      controlCommit: identity.controlCommit,
      harnessTree: identity.harnessTree,
      harnessManifestSha256: identity.harnessManifestSha256,
      manifestSha256: identity.manifestSha256,
      lockfileSha256: identity.lockfileSha256,
      npmrcSha256: identity.npmrcSha256,
      dependencies: identity.dependencies,
    },
    committed,
  );
  const legacyBinding = Object.freeze({
    schema: "oxigraph.engineering-control-identity/v1",
    ...committed,
    nativeHosts: identity.nativeHosts,
    nativeWorkerTimeoutCeilingsMs: identity.nativeWorkerTimeoutCeilingsMs,
    registration: identity.registration,
  });
  assert.deepEqual(identity, {
    ...legacyBinding,
    harnessSha256: canonicalSha256(legacyBinding),
  });
  assert.deepEqual(Object.keys(identity), [
    "schema",
    "controlCommit",
    "harnessTree",
    "harnessManifestSha256",
    "manifestSha256",
    "lockfileSha256",
    "npmrcSha256",
    "dependencies",
    "nativeHosts",
    "nativeWorkerTimeoutCeilingsMs",
    "registration",
    "harnessSha256",
  ]);
  assert.match(identity.controlCommit, /^[0-9a-f]{40}$/);
  assert.match(identity.harnessTree, /^[0-9a-f]{40}$/);
  assert.match(identity.harnessSha256, /^[0-9a-f]{64}$/);
  assert.equal(identity.registration.commit, identity.controlCommit);
  assert.deepEqual(
    identity.nativeHosts.map(({ provider }) => provider),
    ["codex", "claude"],
  );
  assert.ok(identity.nativeHosts.every(({ available }) => available));
  assert.deepEqual(identity.nativeWorkerTimeoutCeilingsMs, {
    architecture: 600_000,
    critique: 600_000,
    implementation: 1_200_000,
    review: 600_000,
    repair: 1_200_000,
  });
});

test("runtime state is admitted only below the committed ignored directory", () => {
  const relative = join(
    "tools",
    "engineering-harness",
    ".runtime",
    "router-history.jsonl",
  );
  assert.equal(ignoredByGit(relative), true);
  assert.equal(ignoredByGit(join(harnessRoot, ".runtime", "router-history.jsonl")), true);
  assert.equal(ignoredByGit(join(repositoryRoot, "README.md")), false);
});
