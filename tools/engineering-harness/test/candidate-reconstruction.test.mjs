import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGitHome, runGit } from "../src/candidate/git.mjs";
import { sha256, treeManifest } from "../src/candidate/manifest.mjs";
import { canonicalizeCandidatePatch } from "../src/policy/paths.mjs";
import {
  candidateSource,
  disposeCandidate,
  reconstructCandidate,
  reconstructEvaluator,
} from "../src/candidate/reconstruct.mjs";

const identity = Object.freeze({
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_AUTHOR_EMAIL: "fixture@localhost",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_EMAIL: "fixture@localhost",
  GIT_COMMITTER_NAME: "Fixture",
});

async function commit(repo, home, message) {
  await runGit({ args: ["add", "-A"], cwd: repo, home });
  await runGit({
    args: ["commit", "-m", message],
    cwd: repo,
    home,
    environmentOverrides: identity,
  });
  const commit = (await runGit({ args: ["rev-parse", "HEAD"], cwd: repo, home })).trim();
  const tree = (
    await runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: repo, home })
  ).trim();
  return { commit, tree };
}

test("candidate reconstruction seals baseline, evaluator, patch, and protected tree", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxigraph-reconstruct-fixture-"));
  const repo = join(fixtureRoot, "source");
  const home = await createGitHome(fixtureRoot);
  let candidate;
  try {
    await mkdir(join(repo, "src"), { recursive: true });
    await mkdir(join(repo, "tests"), { recursive: true });
    await runGit({ args: ["init", "--initial-branch=main", repo], cwd: fixtureRoot, home });
    await writeFile(join(repo, "src/value.txt"), "old\n", "utf8");
    await writeFile(join(repo, "tests/oracle.txt"), "oracle\n", "utf8");
    const baseline = await commit(repo, home, "baseline");
    await writeFile(join(repo, "tests/evaluator.txt"), "evaluator\n", "utf8");
    const evaluator = await commit(repo, home, "evaluator");
    const evaluatorPatch = await runGit({
      args: ["diff", "--binary", baseline.commit, evaluator.commit],
      cwd: repo,
      home,
    });
    const protectedEvaluator = await treeManifest({
      workspace: repo,
      tree: evaluator.tree,
      home,
      exclude: ["src/value.txt"],
    });
    const contract = Object.freeze({
      baseline,
      evaluator: {
        ...evaluator,
        parent: baseline.commit,
        path: "tests/evaluator.txt",
        patchSha256: sha256(evaluatorPatch),
      },
      scope: {
        mutableExact: ["src/value.txt"],
        mutablePrefixes: [],
        blockedPrefixes: ["tests"],
        blockedExact: [],
        allowCreate: false,
      },
      protected: { evaluator: protectedEvaluator },
      ceilings: {
        maxPatchBytes: 4096,
        maxChangedFiles: 1,
        maxChangedLines: 8,
      },
    });
    const patch = "diff --git a/src/value.txt b/src/value.txt\n--- a/src/value.txt\n+++ b/src/value.txt\n@@ -1 +1 @@\n-old\n+new\n";
    const evaluatorWorkspace = await reconstructEvaluator({
      repositoryRoot: repo,
      contract,
    });
    assert.equal(evaluatorWorkspace.kind, "evaluator");
    assert.equal(evaluatorWorkspace.candidateTree, evaluator.tree);
    assert.equal(evaluatorWorkspace.candidatePatchSha256, null);
    assert.equal(
      await candidateSource(evaluatorWorkspace, "tests/evaluator.txt"),
      "evaluator\n",
    );
    await assert.rejects(
      candidateSource(evaluatorWorkspace, "../outside"),
      /escapes repository/,
    );
    await disposeCandidate(evaluatorWorkspace);

    for (const noncanonical of [
      patch.slice(0, -1),
      patch.replace("@@ -1 +1 @@", "@@ -1,1 +1,1 @@"),
      patch.replaceAll("\n", "\r\n"),
    ]) {
      await assert.rejects(
        reconstructCandidate({ repositoryRoot: repo, contract, patch: noncanonical }),
        /canonical form/,
      );
    }

    candidate = await reconstructCandidate({ repositoryRoot: repo, contract, patch });
    assert.deepEqual(candidate.changedPaths, ["src/value.txt"]);
    assert.equal(candidate.candidatePatchSha256, sha256(patch));
    assert.equal(candidate.protectedManifest.sha256, protectedEvaluator.sha256);
    assert.equal(await readFile(join(candidate.workspace, "src/value.txt"), "utf8"), "new\n");
    assert.equal(
      await readFile(join(candidate.workspace, "tests/evaluator.txt"), "utf8"),
      "evaluator\n",
    );
    const referenceIdentity = {
      patchSha256: candidate.candidatePatchSha256,
      commit: candidate.candidateCommit,
      tree: candidate.candidateTree,
      protectedManifest: candidate.protectedManifest,
    };
    const candidateRoot = candidate.temporaryRoot;
    await disposeCandidate(candidate);
    candidate = undefined;
    await assert.rejects(access(candidateRoot));

    for (const raw of [
      patch.replace("@@ -1 +1 @@", "@@ -1,9 +1,7 @@"),
      patch.replaceAll("\n", "\r\n"),
      patch.slice(0, -1),
    ]) {
      const canonical = canonicalizeCandidatePatch(raw);
      assert.equal(canonical, patch);
      const replayed = await reconstructCandidate({
        repositoryRoot: repo,
        contract,
        patch: canonical,
      });
      assert.deepEqual(
        {
          patchSha256: replayed.candidatePatchSha256,
          commit: replayed.candidateCommit,
          tree: replayed.candidateTree,
          protectedManifest: replayed.protectedManifest,
        },
        referenceIdentity,
      );
      await disposeCandidate(replayed);
    }
  } finally {
    if (candidate !== undefined) await disposeCandidate(candidate);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
