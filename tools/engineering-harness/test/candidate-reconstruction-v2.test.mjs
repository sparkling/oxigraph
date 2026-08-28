import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createCandidateV2LifecycleHarnessForTesting,
  createCandidateV2LifecycleTestSeam,
  createCandidateV2ReconstructorForTesting,
  disposeCandidateV2,
  reconstructCandidateV2 as reconstructCandidateV2FromBytes,
} from "../src/candidate/reconstruct-v2.mjs";
import { verifyCandidateV2 } from "../src/candidate/verifier-v2.mjs";
import {
  createGitHome,
  GitBytesProcessFault,
  runGit,
  runGitBytes,
  runGitBytesWithProcessRunnerForTesting,
} from "../src/candidate/git.mjs";
import {
  createSandboxVerificationSessionV2ForTesting,
  runSandboxVerificationSessionV2,
} from "../src/candidate/sandbox-session-v2.mjs";
import { createSubmoduleV2MaterializerForTrustedController } from "../src/candidate/submodules-v2.mjs";
import {
  loadTreeV2,
  projectTreeManifestV2,
  readBlobByOid,
  treeEntryAtPath,
} from "../src/candidate/tree-v2.mjs";
import { gitBlobObjectIdV2 } from "../src/policy/paths-v2.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";
import { canonicalJson } from "../src/routing/features.mjs";

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

function exactSessionOutcome() {
  return Object.freeze({
    disposition: "completed",
    firstTerminalReason: "completed",
    syntheticTestOnly: false,
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
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    durationMs: 1,
    terminationErrors: Object.freeze([]),
    processErrors: Object.freeze([]),
  });
}

function exactSessionCommand(role, stdout = Buffer.alloc(0), passed = null) {
  return {
    role,
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
    terminationErrorCount: 0,
    processErrorCount: 0,
    observedPassed: passed,
    stdoutBytes: stdout.length,
    stdoutSha256: sha256(stdout),
    stdoutBase64: stdout.toString("base64"),
    stderrBytes: 0,
    stderrSha256: sha256(Buffer.alloc(0)),
    stderrBase64: "",
  };
}

function exactSessionResult(configurationSha256) {
  const publicOutput = Buffer.from(
    "test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n",
    "utf8",
  );
  return Buffer.from(
    `${canonicalJson({
      schemaVersion: 2,
      configurationSha256,
      status: "completed",
      stage: "complete",
      commandCount: 3,
      commands: [
        exactSessionCommand("format"),
        exactSessionCommand("build"),
        exactSessionCommand("public", publicOutput, 1),
      ],
      artifacts: [
        {
          name: "exact_create-0123456789abcdef",
          sha256: "a".repeat(64),
          bytes: 4096,
          mode: 0o755,
        },
      ],
      stateBytes: 8192,
      failure: null,
    })}\n`,
    "utf8",
  );
}

function resultFileFromSessionRequest(request) {
  const index = request.args.indexOf("/result/session.json");
  assert.notEqual(index, -1);
  return request.args[index - 1];
}

function verifiedReadiness() {
  return Object.freeze({ status: "verified", reason: "test-only-preflight" });
}

function exactContractBytes(contract, space = undefined) {
  return Buffer.from(JSON.stringify(contract, null, space), "utf8");
}

function reconstructCandidateV2({ repositoryRoot, contract, patch }) {
  return reconstructCandidateV2FromBytes({
    repositoryRoot,
    contractBytes: exactContractBytes(contract),
    patch,
  });
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
        build: {
          argv: ["cargo", "test", "--no-run", "--test", "exact_create"],
          timeoutMs: 1_800_000,
        },
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

test("v2 reconstruction derives authority only from exact contract bytes", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const contractBytes = exactContractBytes(contract, 2);
  const expectedContractSha256 = sha256(contractBytes);
  const patch = creationSection("src/created.txt", "created\n", "sha1");
  const reconstruction = reconstructCandidateV2FromBytes({
    repositoryRoot: fixture.repo,
    contractBytes,
    patch,
  });
  contractBytes.fill(0);
  const candidate = await reconstruction;
  try {
    assert.equal(candidate.contractSha256, expectedContractSha256);
    assert.equal(
      candidate.evaluatorPatchSha256,
      contract.evaluator.patchSha256,
    );
    assert.equal(Object.hasOwn(candidate, "contract"), false);
    assert.equal(Object.hasOwn(candidate, "contractBytes"), false);
    assert.equal(Object.hasOwn(candidate, "repositoryRoot"), false);
  } finally {
    await disposeCandidateV2(candidate);
  }

  await assert.rejects(
    reconstructCandidateV2FromBytes({
      repositoryRoot: "/definitely/not/a/repository",
      contract,
      patch,
    }),
    v2Failure("ERR_RECONSTRUCTION"),
  );
});

test("v2 reconstruction retains quarantined roots for unproved or contradictory Git cleanup", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const patch = creationSection("src/created.txt", "created\n", "sha1");
  const unsafeOutcomes = [
    {
      disposition: "timeout-unreaped",
      exitCode: null,
      captureComplete: false,
      noChild: false,
      spawned: true,
      reaped: false,
      directChildCleanupSafe: false,
      processGroupQuiescent: false,
    },
    {
      disposition: "spawn-error",
      exitCode: null,
      captureComplete: false,
      noChild: true,
      spawned: true,
      reaped: false,
      directChildCleanupSafe: true,
      processGroupQuiescent: true,
    },
    {
      disposition: "timeout-unreaped",
      exitCode: null,
      captureComplete: true,
      noChild: false,
      spawned: true,
      reaped: false,
      statusAgreement: true,
      directChildCleanupSafe: true,
      processGroupQuiescent: true,
      exitObserved: true,
      closeObserved: true,
      stdoutEof: true,
      stderrEof: true,
      stdinComplete: true,
      outputTruncated: false,
      processErrors: [],
    },
    {
      disposition: "spawn-error",
      firstTerminalReason: "spawn-error",
      exitCode: 0,
      signal: null,
      closeCode: 0,
      closeSignal: null,
      captureComplete: false,
      noChild: true,
      spawned: false,
      reaped: false,
      statusAgreement: true,
      directChildCleanupSafe: true,
      processGroupQuiescent: true,
      exitObserved: true,
      closeObserved: true,
      stdoutEof: false,
      stderrEof: false,
      stdinComplete: false,
      outputTruncated: false,
      terminationErrors: [],
      processErrors: [{ kind: "spawn", message: "synthetic failure" }],
    },
  ];

  for (const unsafe of unsafeOutcomes) {
    const unsafeOutcome = Object.freeze({
      ...unsafe,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });
    let retainedRoot;
    const controller = createCandidateV2ReconstructorForTesting((input) =>
      runGitBytesWithProcessRunnerForTesting(input, async (request) => {
        retainedRoot = request.cwd;
        return unsafeOutcome;
      }),
    );

    await assert.rejects(
      controller.reconstructCandidateV2({
        repositoryRoot: fixture.repo,
        contractBytes: exactContractBytes(contract),
        patch,
      }),
      v2Failure("ERR_RECONSTRUCTION"),
    );
    assert.equal(typeof retainedRoot, "string");
    await access(retainedRoot);
    t.after(() => rm(retainedRoot, { recursive: true, force: true }));
  }
});

test("v2 reconstruction removes failed roots only after coherent Git cleanup proof", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const patch = creationSection("src/created.txt", "created\n", "sha1");
  const safeOutcomes = [
    {
      disposition: "spawn-error",
      firstTerminalReason: "spawn-error",
      exitCode: null,
      signal: null,
      closeCode: null,
      closeSignal: null,
      captureComplete: false,
      noChild: true,
      spawned: false,
      reaped: false,
      statusAgreement: false,
      directChildCleanupSafe: true,
      processGroupQuiescent: true,
      exitObserved: false,
      closeObserved: false,
      stdoutEof: false,
      stderrEof: false,
      stdinComplete: false,
      outputTruncated: false,
      terminationErrors: [],
      processErrors: [{ kind: "spawn", message: "synthetic failure" }],
    },
    {
      disposition: "completed",
      firstTerminalReason: "completed",
      exitCode: 1,
      signal: null,
      closeCode: 1,
      closeSignal: null,
      captureComplete: true,
      noChild: false,
      spawned: true,
      reaped: true,
      statusAgreement: true,
      directChildCleanupSafe: true,
      processGroupQuiescent: true,
      exitObserved: true,
      closeObserved: true,
      stdoutEof: true,
      stderrEof: true,
      stdinComplete: true,
      outputTruncated: false,
      terminationErrors: [],
      processErrors: [],
    },
  ];

  for (const safe of safeOutcomes) {
    const safeOutcome = Object.freeze({
      ...safe,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
    });
    let removedRoot;
    const controller = createCandidateV2ReconstructorForTesting((input) =>
      runGitBytesWithProcessRunnerForTesting(input, async (request) => {
        removedRoot = request.cwd;
        return safeOutcome;
      }),
    );
    await assert.rejects(
      controller.reconstructCandidateV2({
        repositoryRoot: fixture.repo,
        contractBytes: exactContractBytes(contract),
        patch,
      }),
      v2Failure("ERR_RECONSTRUCTION"),
    );
    await assert.rejects(access(removedRoot), { code: "ENOENT" });
  }
});

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
      "contractSha256",
      "evaluatorPatchSha256",
      "patchSha256",
      "commit",
      "tree",
      "pathStatuses",
      "createdBlobs",
      "manifests",
    ]);
    assert.deepEqual(candidate, {
      schemaVersion: 2,
      contractSha256: sha256(exactContractBytes(contract)),
      evaluatorPatchSha256: contract.evaluator.patchSha256,
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
    await assert.rejects(
      disposeCandidateV2({ ...candidate }),
      v2Failure("ERR_RECONSTRUCTION"),
    );
    await assert.rejects(
      disposeCandidateV2(new Proxy(candidate, {})),
      v2Failure("ERR_RECONSTRUCTION"),
    );
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

test("v2 reconstruction rejects non-data and extra input authority before repository access", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const contractBytes = exactContractBytes(contract);
  const patch = creationSection("src/created.txt", "created\n", "sha1");

  let getterCalls = 0;
  const accessorInput = {
    repositoryRoot: "/definitely/not/a/repository",
    patch,
  };
  Object.defineProperty(accessorInput, "contractBytes", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return contractBytes;
    },
  });
  await assert.rejects(
    reconstructCandidateV2FromBytes(accessorInput),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  assert.equal(getterCalls, 0);

  const hiddenInput = {
    repositoryRoot: fixture.repo,
    contractBytes,
    patch,
  };
  hiddenInput[Symbol("hidden")] = true;
  await assert.rejects(
    reconstructCandidateV2FromBytes(hiddenInput),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  await assert.rejects(
    reconstructCandidateV2FromBytes(
      new Proxy(
        {
          repositoryRoot: fixture.repo,
          contractBytes,
          patch,
        },
        {},
      ),
    ),
    v2Failure("ERR_RECONSTRUCTION"),
  );
});

test("v2 opaque verification is one-shot and fails closed before spawn without cgroup ownership", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const candidate = await reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contract,
    patch: creationSection("src/created.txt", "created\n", "sha1"),
  });

  const verification = verifyCandidateV2({ candidate });
  const duplicateVerification = assert.rejects(
    verifyCandidateV2({ candidate }),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  const concurrentDisposal = assert.rejects(
    disposeCandidateV2(candidate),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  await Promise.all([duplicateVerification, concurrentDisposal]);

  const result = await verification;
  assert.equal(result.schema, "oxigraph.engineering-candidate-verification/v2");
  assert.equal(result.verdict, "INCONCLUSIVE");
  assert.equal(result.stage, "infrastructure");
  assert.equal(result.reason, "containment-unavailable");
  assert.strictEqual(result.candidate, candidate);
  assert.equal(result.session.containment, "unavailable");
  assert.equal(result.session.cleanupSafe, true);
  assert.equal(result.commands.length, 0);
  assert.equal(result.artifacts.length, 0);
  assert.match(result.projectionSha256, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(fixture.root, "u"));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.session), true);

  await assert.rejects(
    verifyCandidateV2({ candidate }),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  await disposeCandidateV2(candidate);
  await assert.rejects(
    disposeCandidateV2(candidate),
    v2Failure("ERR_RECONSTRUCTION"),
  );
});

test("v2 containment preflight consumes verification without further Git work", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  let gitCalls = 0;
  const harness = createCandidateV2ReconstructorForTesting((input) => {
    gitCalls += 1;
    return runGitBytes(input);
  });
  const candidate = await harness.reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contractBytes: exactContractBytes(contract),
    patch: creationSection("src/created.txt", "created\n", "sha1"),
  });
  const reconstructionCalls = gitCalls;
  const result = await harness.verifyCandidateV2({ candidate });
  assert.equal(result.reason, "containment-unavailable");
  assert.equal(gitCalls, reconstructionCalls);
  await assert.rejects(
    harness.verifyCandidateV2({ candidate }),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  assert.equal(gitCalls, reconstructionCalls);
  await harness.disposeCandidateV2(candidate);
});

test("v2 lifecycle seam rejects unbranded authority without invoking it", () => {
  let calls = 0;
  const dependencies = Object.freeze({
    gitBytesRunner() {
      calls += 1;
    },
    sessionRunner() {
      calls += 1;
    },
    containmentPreflight() {
      calls += 1;
    },
    materializerFactory() {
      calls += 1;
    },
  });
  const seam = createCandidateV2LifecycleTestSeam(dependencies);
  for (const invalid of [
    Object.freeze(Object.create(null)),
    structuredClone(seam),
    new Proxy(seam, {}),
  ]) {
    assert.throws(
      () => createCandidateV2LifecycleHarnessForTesting(invalid),
      /branded test seam/u,
    );
  }
  assert.equal(calls, 0);
});

test("v2 verified preflight exercises materialization and one branded session while active disposal rejects", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  let sessionCalls = 0;
  let materializerCalls = 0;
  let releaseSession;
  let sessionEntered;
  const entered = new Promise((resolve) => {
    sessionEntered = resolve;
  });
  const release = new Promise((resolve) => {
    releaseSession = resolve;
  });
  const structural = createSandboxVerificationSessionV2ForTesting(
    async (request) => {
      await writeFile(
        resultFileFromSessionRequest(request),
        exactSessionResult(sha256(request.stdin)),
      );
      return exactSessionOutcome();
    },
  );
  const seam = createCandidateV2LifecycleTestSeam(
    Object.freeze({
      gitBytesRunner: runGitBytes,
      sessionRunner: async (input) => {
        sessionCalls += 1;
        sessionEntered();
        await release;
        return structural.runSandboxVerificationSessionV2(input);
      },
      containmentPreflight: verifiedReadiness,
      materializerFactory: (input) => {
        const materializer =
          createSubmoduleV2MaterializerForTrustedController(input);
        return Object.freeze({
          async materialize(candidate) {
            materializerCalls += 1;
            return materializer.materialize(candidate);
          },
        });
      },
    }),
  );
  const harness = createCandidateV2LifecycleHarnessForTesting(seam);
  const candidate = await harness.reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contractBytes: exactContractBytes(contract),
    patch: creationSection("src/created.txt", "created\n", "sha1"),
  });
  const verification = harness.verifyCandidateV2({ candidate });
  await entered;
  await assert.rejects(
    harness.disposeCandidateV2(candidate),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  await assert.rejects(
    harness.verifyCandidateV2({ candidate }),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  releaseSession();
  const result = await verification;
  assert.equal(result.verdict, "INCONCLUSIVE");
  assert.equal(result.reason, "containment-unproved");
  assert.equal(materializerCalls, 1);
  assert.equal(sessionCalls, 1);
  await harness.disposeCandidateV2(candidate);
});

test("v2 pending materialization blocks disposal and settles through one safe session fault", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  let materializationEntered;
  let releaseMaterialization;
  const entered = new Promise((resolve) => {
    materializationEntered = resolve;
  });
  const release = new Promise((resolve) => {
    releaseMaterialization = resolve;
  });
  let sessionCalls = 0;
  const seam = createCandidateV2LifecycleTestSeam(
    Object.freeze({
      gitBytesRunner: runGitBytes,
      sessionRunner: async (input) => {
        sessionCalls += 1;
        return runSandboxVerificationSessionV2(input);
      },
      containmentPreflight: verifiedReadiness,
      materializerFactory: ({ claimCandidate }) =>
        Object.freeze({
          async materialize(candidate) {
            const claim = claimCandidate(candidate);
            materializationEntered();
            await release;
            claim.complete(Object.freeze([]));
            return Object.freeze([]);
          },
        }),
    }),
  );
  const harness = createCandidateV2LifecycleHarnessForTesting(seam);
  const candidate = await harness.reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contractBytes: exactContractBytes(contract),
    patch: creationSection("src/created.txt", "created\n", "sha1"),
  });
  const verification = harness.verifyCandidateV2({ candidate });
  await entered;
  await assert.rejects(
    harness.disposeCandidateV2(candidate),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  releaseMaterialization();
  const result = await verification;
  assert.equal(result.reason, "containment-unavailable");
  assert.equal(sessionCalls, 1);
  await harness.disposeCandidateV2(candidate);
});

test("v2 materialization settlement distinguishes safe disposal from quarantine", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  for (const unsafe of [false, true]) {
    let retainedRoot;
    const seam = createCandidateV2LifecycleTestSeam(
      Object.freeze({
        gitBytesRunner: runGitBytes,
        sessionRunner: runSandboxVerificationSessionV2,
        containmentPreflight: verifiedReadiness,
        materializerFactory: ({ claimCandidate }) =>
          Object.freeze({
            async materialize(candidate) {
              const claim = claimCandidate(candidate);
              retainedRoot = claim.temporaryRoot;
              if (unsafe) claim.quarantine("b".repeat(64));
              else claim.failSafe("c".repeat(64));
              throw new Error("synthetic materialization failure");
            },
          }),
      }),
    );
    const harness = createCandidateV2LifecycleHarnessForTesting(seam);
    const candidate = await harness.reconstructCandidateV2({
      repositoryRoot: fixture.repo,
      contractBytes: exactContractBytes(contract),
      patch: creationSection("src/created.txt", "created\n", "sha1"),
    });
    const result = await harness.verifyCandidateV2({ candidate });
    assert.equal(result.reason, "submodule-materialization");
    assert.equal(result.session.cleanupSafe, !unsafe);
    if (unsafe) {
      await assert.rejects(
        harness.disposeCandidateV2(candidate),
        v2Failure("ERR_RECONSTRUCTION"),
      );
      await access(retainedRoot);
      t.after(() => rm(retainedRoot, { recursive: true, force: true }));
    } else {
      await harness.disposeCandidateV2(candidate);
      await assert.rejects(access(retainedRoot), { code: "ENOENT" });
    }
  }
});

test("v2 unsafe sandbox fault quarantines the candidate and retains its authority", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  let retainedRoot;
  const structural = createSandboxVerificationSessionV2ForTesting(async () => {
    throw new Error("runner outcome is unknown");
  });
  const seam = createCandidateV2LifecycleTestSeam(
    Object.freeze({
      gitBytesRunner: runGitBytes,
      sessionRunner: structural.runSandboxVerificationSessionV2,
      containmentPreflight: verifiedReadiness,
      materializerFactory: ({ claimCandidate }) =>
        createSubmoduleV2MaterializerForTrustedController({
          claimCandidate(candidate) {
            const claim = claimCandidate(candidate);
            retainedRoot = claim.temporaryRoot;
            return claim;
          },
        }),
    }),
  );
  const harness = createCandidateV2LifecycleHarnessForTesting(seam);
  const candidate = await harness.reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contractBytes: exactContractBytes(contract),
    patch: creationSection("src/created.txt", "created\n", "sha1"),
  });
  const result = await harness.verifyCandidateV2({ candidate });
  assert.equal(result.reason, "protocol-or-inode");
  assert.equal(result.session.cleanupSafe, false);
  await assert.rejects(
    harness.disposeCandidateV2(candidate),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  await access(retainedRoot);
  t.after(() => rm(retainedRoot, { recursive: true, force: true }));
});

test("v2 post-report Git cleanup uncertainty quarantines the candidate", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  let retainedRoot;
  let reportProduced = false;
  const unsafeGitOutcome = Object.freeze({
    ...exactSessionOutcome(),
    disposition: "timeout-unreaped",
    firstTerminalReason: "timeout",
    exitCode: null,
    closeCode: null,
    statusAgreement: false,
    reaped: false,
    directChildCleanupSafe: false,
    processGroupQuiescent: false,
    exitObserved: false,
    closeObserved: false,
    stdoutEof: false,
    stderrEof: false,
    stdinComplete: false,
    captureComplete: false,
  });
  const structural = createSandboxVerificationSessionV2ForTesting(
    async (request) => {
      await writeFile(
        resultFileFromSessionRequest(request),
        exactSessionResult(sha256(request.stdin)),
      );
      reportProduced = true;
      return exactSessionOutcome();
    },
  );
  const seam = createCandidateV2LifecycleTestSeam(
    Object.freeze({
      gitBytesRunner: (input) => {
        if (!reportProduced) return runGitBytes(input);
        throw new GitBytesProcessFault(input.args, unsafeGitOutcome);
      },
      sessionRunner: structural.runSandboxVerificationSessionV2,
      containmentPreflight: verifiedReadiness,
      materializerFactory: ({ claimCandidate }) =>
        createSubmoduleV2MaterializerForTrustedController({
          claimCandidate(candidate) {
            const claim = claimCandidate(candidate);
            retainedRoot = claim.temporaryRoot;
            return claim;
          },
        }),
    }),
  );
  const harness = createCandidateV2LifecycleHarnessForTesting(seam);
  const candidate = await harness.reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contractBytes: exactContractBytes(contract),
    patch: creationSection("src/created.txt", "created\n", "sha1"),
  });
  const result = await harness.verifyCandidateV2({ candidate });
  assert.equal(result.reason, "candidate-identity-unproved");
  assert.equal(result.session.cleanupSafe, false);
  await assert.rejects(
    harness.disposeCandidateV2(candidate),
    v2Failure("ERR_RECONSTRUCTION"),
  );
  await access(retainedRoot);
  t.after(() => rm(retainedRoot, { recursive: true, force: true }));
});

test("v2 disposal failure becomes a retained quarantine state", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  let retainedRoot;
  const structural = createSandboxVerificationSessionV2ForTesting(
    async (request) => {
      await writeFile(
        resultFileFromSessionRequest(request),
        exactSessionResult(sha256(request.stdin)),
      );
      return exactSessionOutcome();
    },
  );
  const seam = createCandidateV2LifecycleTestSeam(
    Object.freeze({
      gitBytesRunner: runGitBytes,
      sessionRunner: structural.runSandboxVerificationSessionV2,
      containmentPreflight: verifiedReadiness,
      materializerFactory: ({ claimCandidate }) =>
        createSubmoduleV2MaterializerForTrustedController({
          claimCandidate(candidate) {
            const claim = claimCandidate(candidate);
            retainedRoot = claim.temporaryRoot;
            return claim;
          },
        }),
    }),
  );
  const harness = createCandidateV2LifecycleHarnessForTesting(seam);
  const candidate = await harness.reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contractBytes: exactContractBytes(contract),
    patch: creationSection("src/created.txt", "created\n", "sha1"),
  });
  const result = await harness.verifyCandidateV2({ candidate });
  assert.equal(result.reason, "containment-unproved");

  await chmod(retainedRoot, 0);
  t.after(async () => {
    await chmod(retainedRoot, 0o700).catch(() => {});
    await rm(retainedRoot, { recursive: true, force: true });
  });
  await assert.rejects(
    harness.disposeCandidateV2(candidate),
    v2Failure("ERR_INTERNAL_FAIL_CLOSED"),
  );
  await chmod(retainedRoot, 0o700);
  await access(retainedRoot);
  await assert.rejects(
    harness.disposeCandidateV2(candidate),
    v2Failure("ERR_RECONSTRUCTION"),
  );
});

test("v2 verification rejects foreign authority before consuming a valid candidate", async (t) => {
  const fixture = await createFixture(t);
  const contract = await fixture.contractFor({
    mutableExact: ["src/created.txt"],
    createExact: ["src/created.txt"],
  });
  const candidate = await reconstructCandidateV2({
    repositoryRoot: fixture.repo,
    contract,
    patch: creationSection("src/created.txt", "created\n", "sha1"),
  });
  try {
    await assert.rejects(
      verifyCandidateV2({ candidate: { ...candidate } }),
      v2Failure("ERR_RECONSTRUCTION"),
    );
    await assert.rejects(
      verifyCandidateV2({ candidate: new Proxy(candidate, {}) }),
      v2Failure("ERR_RECONSTRUCTION"),
    );
    await assert.rejects(
      verifyCandidateV2({ candidate, workspace: fixture.repo }),
      v2Failure("ERR_RECONSTRUCTION"),
    );
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, "candidate", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return candidate;
      },
    });
    await assert.rejects(
      verifyCandidateV2(accessor),
      v2Failure("ERR_RECONSTRUCTION"),
    );
    assert.equal(getterCalls, 0);

    const controller = new AbortController();
    controller.abort();
    const result = await verifyCandidateV2({
      candidate,
      signal: controller.signal,
    });
    assert.equal(result.verdict, "INCONCLUSIVE");
    assert.equal(result.reason, "containment-unavailable");
    await assert.rejects(
      verifyCandidateV2({ candidate }),
      v2Failure("ERR_RECONSTRUCTION"),
    );
  } finally {
    await disposeCandidateV2(candidate);
  }
});
