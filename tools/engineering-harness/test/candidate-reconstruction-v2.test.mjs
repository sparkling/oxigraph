import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  disposeCandidateV2,
  reconstructCandidateV2,
} from "../src/candidate/reconstruct-v2.mjs";
import { createGitHome, runGit, runGitBytes } from "../src/candidate/git.mjs";
import {
  loadTreeV2,
  projectTreeManifestV2,
  readBlobByOid,
  treeEntryAtPath,
} from "../src/candidate/tree-v2.mjs";
import { gitBlobObjectIdV2 } from "../src/policy/paths-v2.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";

const fixtureIdentity = Object.freeze({
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_AUTHOR_EMAIL: "fixture@localhost",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_EMAIL: "fixture@localhost",
  GIT_COMMITTER_NAME: "Fixture",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function v2Failure(code) {
  return (error) => {
    assert.equal(error instanceof TaskV2Failure, true);
    if (code !== undefined) assert.equal(error.code, code);
    assert.equal(error.terminal, true);
    assert.equal(error.retryAllowed, false);
    assert.deepEqual(Object.keys(error), [
      "code",
      "publicMessage",
      "terminal",
      "retryAllowed",
      "detailSha256",
    ]);
    assert.doesNotMatch(JSON.stringify(error), /private|stderr|token/u);
    return true;
  };
}

async function commit(repo, home, message) {
  await runGit({ args: ["add", "-A"], cwd: repo, home });
  await runGit({
    args: ["commit", "-m", message],
    cwd: repo,
    home,
    environmentOverrides: fixtureIdentity,
  });
  return Object.freeze({
    commit: (
      await runGit({ args: ["rev-parse", "HEAD"], cwd: repo, home })
    ).trim(),
    tree: (
      await runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: repo, home })
    ).trim(),
  });
}

const evaluatorDiffArgs = (baseline, evaluator) => [
  "diff",
  "--binary",
  "--full-index",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  baseline,
  evaluator,
];

function manifestBinding(full, protectedManifest) {
  return {
    entries: full.entries,
    fullSha256: full.sha256,
    protectedEntries: protectedManifest.entries,
    protectedSha256: protectedManifest.sha256,
  };
}

async function createFixture(
  t,
  { objectFormat = "sha1", folded = false } = {},
) {
  const root = await mkdtemp(
    join(tmpdir(), "oxigraph-reconstruct-v2-fixture-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, "source");
  const home = await createGitHome(root);
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "tests"), { recursive: true });
  const initArgs =
    objectFormat === "sha256"
      ? ["init", "--object-format=sha256", "--initial-branch=main", repo]
      : ["init", "--initial-branch=main", repo];
  await runGit({ args: initArgs, cwd: root, home });
  await writeFile(join(repo, "src/existing.txt"), "old\n", "utf8");
  await writeFile(join(repo, "src/other.txt"), "stable\n", "utf8");
  await writeFile(join(repo, "tests/protected.txt"), "protected\n", "utf8");
  if (folded) {
    await writeFile(join(repo, "src/Created.txt"), "collision\n", "utf8");
  }
  const baseline = await commit(repo, home, "baseline");
  await writeFile(join(repo, "tests/evaluator.txt"), "evaluator\n", "utf8");
  const evaluator = await commit(repo, home, "evaluator");
  const evaluatorPatch = await runGitBytes({
    args: evaluatorDiffArgs(baseline.commit, evaluator.commit),
    cwd: repo,
    home,
    maxOutputBytes: 8 * 1024 * 1024,
  });
  const baselineTree = await loadTreeV2({
    workspace: repo,
    home,
    tree: baseline.tree,
  });
  const evaluatorTree = await loadTreeV2({
    workspace: repo,
    home,
    tree: evaluator.tree,
  });
  const evaluatorEntry = treeEntryAtPath(evaluatorTree, "tests/evaluator.txt");
  const evaluatorContent = await readBlobByOid({
    workspace: repo,
    home,
    oid: evaluatorEntry.oid,
  });

  async function contractFor({ mutableExact, createExact }) {
    const createPaths = new Set(createExact);
    const mutableBaselines = [];
    for (const path of mutableExact) {
      if (createPaths.has(path)) {
        mutableBaselines.push({
          path,
          state: "absent",
          baseline: { state: "absent" },
          evaluator: { state: "absent" },
        });
        continue;
      }
      const baselineEntry = treeEntryAtPath(baselineTree, path);
      const evaluatorEntry = treeEntryAtPath(evaluatorTree, path);
      assert.equal(baselineEntry?.mode, "100644");
      assert.equal(baselineEntry?.type, "blob");
      assert.equal(evaluatorEntry?.oid, baselineEntry.oid);
      const baselineContent = await readBlobByOid({
        workspace: repo,
        home,
        oid: baselineEntry.oid,
      });
      const evaluatorContent = await readBlobByOid({
        workspace: repo,
        home,
        oid: evaluatorEntry.oid,
      });
      mutableBaselines.push({
        path,
        state: "present",
        baseline: {
          state: "present",
          mode: "100644",
          type: "blob",
          objectId: baselineEntry.oid,
          contentSha256: sha256(baselineContent),
        },
        evaluator: {
          state: "present",
          mode: "100644",
          type: "blob",
          objectId: evaluatorEntry.oid,
          contentSha256: sha256(evaluatorContent),
        },
      });
    }
    const presentPaths = mutableBaselines
      .filter((binding) => binding.state === "present")
      .map((binding) => binding.path);
    const baselineFull = projectTreeManifestV2(baselineTree);
    const baselineProtected = projectTreeManifestV2(baselineTree, {
      exclude: presentPaths,
    });
    const evaluatorFull = projectTreeManifestV2(evaluatorTree);
    const evaluatorProtected = projectTreeManifestV2(evaluatorTree, {
      exclude: presentPaths,
    });
    return {
      schemaVersion: 2,
      id: "test-reconstruct-v2",
      programme: "linked-data-store",
      decision: "ADR-0034",
      objective:
        "Prove exact schema-v2 candidate reconstruction in an isolated repository fixture.",
      localOnly: true,
      promotionAuthority: false,
      routing: {
        pairedCalibration: true,
        forbidOpenRouter: true,
        providers: [
          { provider: "codex", transport: "native", model: "gpt-5.6-sol" },
          { provider: "claude", transport: "native", model: "opus" },
        ],
      },
      baseline: { ...baseline },
      evaluator: {
        ...evaluator,
        parent: baseline.commit,
        path: "tests/evaluator.txt",
        changeStatus: "A",
        blob: evaluatorEntry.oid,
        contentSha256: sha256(evaluatorContent),
        patchSha256: sha256(evaluatorPatch),
      },
      scope: {
        mutableExact,
        createExact,
        mutablePrefixes: [],
        blockedExact: ["tests/evaluator.txt"],
        blockedPrefixes: [],
        allowCreate: createExact.length > 0,
        allowDelete: false,
        allowRename: false,
        allowModeChange: false,
        allowSymlink: false,
        allowSubmoduleChange: false,
      },
      protectedInputs: {
        manifestAlgorithm: "git-ls-tree-r-z-sort-nul-sha256-v1",
        mutableBaselines,
        baselineManifest: manifestBinding(baselineFull, baselineProtected),
        evaluatorManifest: manifestBinding(evaluatorFull, evaluatorProtected),
        submodules: [],
      },
      ceilings: {
        maxPatchBytes: 16_384,
        maxChangedFiles: 8,
        maxChangedLines: 64,
        maxWorkerOutputBytes: 262_144,
        maxBuildOutputBytes: 8_388_608,
        maxTestOutputBytesPerCommand: 2_097_152,
        maxTotalVerifierWallMs: 2_700_000,
        maxResidentBytes: 8_589_934_592,
        maxVerifierDiskBytes: 17_179_869_184,
        cargoBuildJobs: 4,
        maxRepairCycles: 0,
        maxCritiqueRounds: 0,
        networkDuringVerification: false,
      },
      verificationSequence: ["format", "build", "public"],
      commands: {
        format: { argv: ["cargo", "fmt", "--check"], timeoutMs: 120_000 },
        build: { argv: ["cargo", "test", "--no-run"], timeoutMs: 1_800_000 },
        public: { argv: ["cargo", "test"], timeoutMs: 120_000 },
      },
      initialRed: {
        commandRole: "public",
        exitCode: 101,
        passed: 0,
        failed: 1,
        requiredSubstrings: ["expected red fixture"],
        forbiddenSubstrings: [],
      },
      success: { publicPassed: 1 },
    };
  }

  return Object.freeze({
    root,
    repo,
    home,
    objectFormat,
    baseline,
    evaluator,
    evaluatorTree,
    contractFor,
  });
}

function creationSection(path, content, objectFormat) {
  assert.equal(content.length > 0 && content.endsWith("\n"), true);
  const payload = content.slice(0, -1).split("\n");
  const objectId = gitBlobObjectIdV2(
    Buffer.from(content, "utf8"),
    objectFormat,
  );
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    `index ${"0".repeat(objectId.length)}..${objectId}`,
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${payload.length} @@`,
    ...payload.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function modificationSection(path, before, after) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${before}`,
    `+${after}`,
    "",
  ].join("\n");
}

test("v2 create-only reconstruction freezes the exact public identity", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const content = "created\n";
  const patch = creationSection("src/created.txt", content, "sha1");
  const expectedObjectId = gitBlobObjectIdV2(content, "sha1");
  const candidate = await reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contract,
    patch,
  });
  try {
    assert.deepEqual(Object.keys(candidate), [
      "schemaVersion",
      "patchSha256",
      "commit",
      "tree",
      "pathStatuses",
      "createdBlobs",
      "manifests",
    ]);
    assert.deepEqual(candidate, {
      schemaVersion: 2,
      patchSha256: sha256(patch),
      commit: candidate.commit,
      tree: candidate.tree,
      pathStatuses: [{ path: "src/created.txt", status: "A" }],
      createdBlobs: [
        {
          path: "src/created.txt",
          mode: "100644",
          type: "blob",
          objectId: expectedObjectId,
          contentSha256: sha256(content),
        },
      ],
      manifests: {
        full: candidate.manifests.full,
        protected: {
          entries: contract.protectedInputs.evaluatorManifest.protectedEntries,
          sha256: contract.protectedInputs.evaluatorManifest.protectedSha256,
        },
      },
    });
    assert.equal(Object.isFrozen(candidate), true);
    assert.equal(Object.isFrozen(candidate.pathStatuses), true);
    assert.equal(Object.isFrozen(candidate.pathStatuses[0]), true);
    assert.equal(Object.isFrozen(candidate.createdBlobs), true);
    assert.equal(Object.isFrozen(candidate.createdBlobs[0]), true);
    assert.equal(Object.isFrozen(candidate.manifests), true);
    assert.equal(Object.hasOwn(candidate, "workspace"), false);
    assert.equal(Object.hasOwn(candidate, "temporaryRoot"), false);
  } finally {
    await disposeCandidateV2(candidate);
  }
  await assert.rejects(
    disposeCandidateV2(candidate),
    v2Failure("ERR_RECONSTRUCTION"),
  );
});

test("v2 mixed reconstruction emits canonical M/A status and is deterministic", async (t) => {
  const fixture = await createFixture(t, { objectFormat: "sha256" });
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt", "src/existing.txt"],
    createExact: ["src/created.txt"],
  });
  const patch =
    modificationSection("src/existing.txt", "old", "new") +
    creationSection("src/created.txt", "new module\n", "sha256");
  const candidates = [];
  try {
    candidates.push(
      await reconstructCandidateV2({
        repositoryRoot: fixture.repo,
        contract,
        patch,
      }),
    );
    candidates.push(
      await reconstructCandidateV2({
        repositoryRoot: fixture.repo,
        contract,
        patch,
      }),
    );
    assert.deepEqual(candidates[0], candidates[1]);
    assert.deepEqual(candidates[0].pathStatuses, [
      { path: "src/created.txt", status: "A" },
      { path: "src/existing.txt", status: "M" },
    ]);
    assert.equal(candidates[0].createdBlobs.length, 1);
    assert.equal(candidates[0].createdBlobs[0].objectId.length, 64);
    assert.deepEqual(candidates[0].manifests.protected, {
      entries: contract.protectedInputs.evaluatorManifest.protectedEntries,
      sha256: contract.protectedInputs.evaluatorManifest.protectedSha256,
    });
  } finally {
    await Promise.all(
      candidates.map((candidate) => disposeCandidateV2(candidate)),
    );
  }
});

test("v2 reconstruction rejects missing, extra, and relabelled A/M sections", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt", "src/existing.txt"],
    createExact: ["src/created.txt"],
  });
  const modification = modificationSection("src/existing.txt", "old", "new");
  const creation = creationSection("src/created.txt", "created\n", "sha1");
  const extra = modificationSection("src/other.txt", "stable", "changed");
  const createRelabelledAsModification = modificationSection(
    "src/created.txt",
    "absent",
    "created",
  );
  const modificationRelabelledAsCreate = creationSection(
    "src/existing.txt",
    "replacement\n",
    "sha1",
  );

  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract,
      patch: modification,
    }),
    v2Failure("ERR_CANDIDATE_STATUS"),
  );
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract,
      patch: modification + creation + extra,
    }),
    v2Failure("ERR_PATH_INVALID"),
  );
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract,
      patch: modification + createRelabelledAsModification,
    }),
    v2Failure("ERR_PATCH_CANONICAL"),
  );
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract,
      patch: modificationRelabelledAsCreate + creation,
    }),
    v2Failure("ERR_PATCH_CANONICAL"),
  );
});

test("v2 reconstruction rejects mode, type, OID, and protected-manifest tamper", async (t) => {
  const fixture = await createFixture(t);
  const original = await fixture.contractFor({
    mutableExact: ["src/created.txt", "src/existing.txt"],
    createExact: ["src/created.txt"],
  });
  const patch =
    modificationSection("src/existing.txt", "old", "new") +
    creationSection("src/created.txt", "created\n", "sha1");

  const mode = structuredClone(original);
  mode.protectedInputs.mutableBaselines[1].baseline.mode = "100755";
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract: mode,
      patch,
    }),
    v2Failure("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );

  const type = structuredClone(original);
  type.protectedInputs.mutableBaselines[1].baseline.type = "tree";
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract: type,
      patch,
    }),
    v2Failure("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );

  const objectId = structuredClone(original);
  const wrongObjectId = "1".repeat(original.baseline.tree.length);
  objectId.protectedInputs.mutableBaselines[1].baseline.objectId =
    wrongObjectId;
  objectId.protectedInputs.mutableBaselines[1].evaluator.objectId =
    wrongObjectId;
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract: objectId,
      patch,
    }),
    v2Failure("ERR_BASELINE_STATE"),
  );

  const protectedManifest = structuredClone(original);
  protectedManifest.protectedInputs.evaluatorManifest.protectedSha256 =
    "f".repeat(64);
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract: protectedManifest,
      patch,
    }),
    v2Failure("ERR_PROTECTED_MANIFEST"),
  );

  const evaluatorPatch = structuredClone(original);
  evaluatorPatch.evaluator.patchSha256 = "e".repeat(64);
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract: evaluatorPatch,
      patch,
    }),
    v2Failure("ERR_RECONSTRUCTION"),
  );

  const expectedCreatedOid = gitBlobObjectIdV2("created\n", "sha1");
  const tamperedCreatedOid = patch.replace(expectedCreatedOid, "2".repeat(40));
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract: original,
      patch: tamperedCreatedOid,
    }),
    v2Failure("ERR_PATCH_CANONICAL"),
  );

  const tamperedMode = patch.replace(
    "new file mode 100644",
    "new file mode 100755",
  );
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract: original,
      patch: tamperedMode,
    }),
    v2Failure("ERR_PATCH_CANONICAL"),
  );
});

test("v2 reconstruction rejects raw noncanonical patches without normalization", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const patch = creationSection("src/created.txt", "created\n", "sha1");
  const objectId = gitBlobObjectIdV2("created\n", "sha1");
  const variants = [
    patch.slice(0, -1),
    patch.replaceAll("\n", "\r\n"),
    patch.replace("@@ -0,0 +1,1 @@", "@@ -0,0 +1 @@"),
    patch.replace("--- /dev/null", "\n--- /dev/null"),
    patch.replace(objectId, objectId.slice(0, -1)),
  ];
  for (const candidatePatch of variants) {
    await assert.rejects(
      reconstructCandidateV2({
        repositoryRoot: fixture.repo,
        contract,
        patch: candidatePatch,
      }),
      v2Failure("ERR_PATCH_CANONICAL"),
    );
  }
});

test("v2 reconstruction rejects portable folded collisions before creation", async (t) => {
  const fixture = await createFixture(t, { folded: true });
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const patch = creationSection("src/created.txt", "created\n", "sha1");
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contract,
      patch,
    }),
    v2Failure("ERR_PATH_COLLISION"),
  );
});

test("v2 reconstruction rejects hidden keys and accessors before repository access", async (t) => {
  const fixture = await createFixture(t);
  const original = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const patch = creationSection("src/created.txt", "created\n", "sha1");

  const symbolContract = structuredClone(original);
  symbolContract[Symbol("hidden")] = true;
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: "/definitely/not/a/repository",
      contract: symbolContract,
      patch,
    }),
    v2Failure("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );

  const hiddenPhase = structuredClone(original);
  Object.defineProperty(
    hiddenPhase.protectedInputs.mutableBaselines[0].baseline,
    "hidden",
    { value: true },
  );
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: "/definitely/not/a/repository",
      contract: hiddenPhase,
      patch,
    }),
    v2Failure("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );

  let getterCalls = 0;
  const accessorArray = structuredClone(original);
  const mutableBaseline = accessorArray.protectedInputs.mutableBaselines[0];
  Object.defineProperty(accessorArray.protectedInputs, "mutableBaselines", {
    value: [],
    enumerable: true,
  });
  Object.defineProperty(accessorArray.protectedInputs.mutableBaselines, "0", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return mutableBaseline;
    },
  });
  accessorArray.protectedInputs.mutableBaselines.length = 1;
  await assert.rejects(
    reconstructCandidateV2({
      repositoryRoot: "/definitely/not/a/repository",
      contract: accessorArray,
      patch,
    }),
    v2Failure("ERR_CONTRACT_SCHEMA_OR_KEYS"),
  );
  assert.equal(getterCalls, 0);

  const hiddenInput = {
    repositoryRoot: fixture.repo,
    contract: original,
    patch,
  };
  hiddenInput[Symbol("hidden")] = true;
  await assert.rejects(
    reconstructCandidateV2(hiddenInput),
    v2Failure("ERR_RECONSTRUCTION"),
  );
});
