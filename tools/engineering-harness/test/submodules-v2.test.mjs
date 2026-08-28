import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  createSubmoduleV2MaterializerForTesting,
  createSubmoduleV2MaterializerForTrustedController,
  createSubmoduleV2TestSeam,
} from "../src/candidate/submodules-v2.mjs";
import {
  createGitHome,
  GitBytesProcessFault,
  runGit,
  runGitBytes,
} from "../src/candidate/git.mjs";
import { runBoundedProcessBytes } from "../src/native/process.mjs";
import { TaskV2Failure } from "../src/policy/task-v2-failures.mjs";

const fixtureIdentity = Object.freeze({
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_AUTHOR_EMAIL: "submodule-v2@localhost",
  GIT_AUTHOR_NAME: "Submodule V2 Fixture",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_EMAIL: "submodule-v2@localhost",
  GIT_COMMITTER_NAME: "Submodule V2 Fixture",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function frozenDeclarations(values) {
  return Object.freeze(values.map((value) => Object.freeze({ ...value })));
}

function taskFailure(forbidden = []) {
  return (error) => {
    assert.equal(error instanceof TaskV2Failure, true);
    assert.equal(error.terminal, true);
    assert.equal(error.retryAllowed, false);
    assert.deepEqual(Object.keys(error), [
      "code",
      "publicMessage",
      "terminal",
      "retryAllowed",
      "detailSha256",
    ]);
    const publicJson = JSON.stringify(error);
    for (const value of forbidden) {
      assert.equal(publicJson.includes(value), false);
    }
    assert.doesNotMatch(publicJson, /stderr|stdout|token|git-home/iu);
    return true;
  };
}

async function commit(repo, home) {
  await runGit({ args: ["add", "-A"], cwd: repo, home });
  await runGit({
    args: ["commit", "-m", "frozen submodule"],
    cwd: repo,
    home,
    environmentOverrides: fixtureIdentity,
  });
  const head = (
    await runGit({ args: ["rev-parse", "HEAD"], cwd: repo, home })
  ).trim();
  const tree = (
    await runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: repo, home })
  ).trim();
  return Object.freeze({ commit: head, tree });
}

async function fixture(t, { empty = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "oxigraph-submodules-v2-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, "controller");
  const moduleRoot = join(sourceRoot, "vendor", "module");
  const temporaryRoot = join(root, "candidate");
  const workspace = join(temporaryRoot, "repo");
  await mkdir(moduleRoot, { recursive: true });
  await mkdir(temporaryRoot, { mode: 0o700 });
  await mkdir(join(workspace, "vendor"), { recursive: true });
  const gitHome = await createGitHome(temporaryRoot);
  await runGit({
    args: ["init", "--initial-branch=main"],
    cwd: moduleRoot,
    home: gitHome,
  });
  await writeFile(join(moduleRoot, "module.txt"), "frozen module\n", "utf8");
  const frozen = await commit(moduleRoot, gitHome);
  let submodules = empty
    ? frozenDeclarations([])
    : frozenDeclarations([
        { path: "vendor/module", commit: frozen.commit, tree: frozen.tree },
      ]);
  const candidate = Object.freeze({ schemaVersion: 2, tree: "candidate-tree" });
  let state = "ready";
  let claims = 0;
  let completedEvidence;
  let detailSha256;
  const transitions = [];

  const claimCandidate = (value) => {
    assert.equal(value, candidate);
    assert.equal(state, "ready");
    claims += 1;
    state = "materializing-submodules";
    return Object.freeze({
      sourceRoot,
      temporaryRoot,
      workspace,
      gitHome,
      submodules,
      complete(evidence) {
        assert.equal(state, "materializing-submodules");
        completedEvidence = evidence;
        state = "submodules-ready";
        transitions.push("complete");
      },
      failSafe(detail) {
        assert.equal(state, "materializing-submodules");
        detailSha256 = detail;
        state = "submodules-failed";
        transitions.push("failSafe");
      },
      quarantine(detail) {
        assert.equal(state, "materializing-submodules");
        detailSha256 = detail;
        state = "quarantined";
        transitions.push("quarantine");
      },
    });
  };

  return Object.freeze({
    root,
    sourceRoot,
    moduleRoot,
    temporaryRoot,
    workspace,
    gitHome,
    frozen,
    candidate,
    claimCandidate,
    setSubmodules(value) {
      assert.equal(state, "ready");
      submodules = frozenDeclarations(value);
    },
    lifecycle() {
      return Object.freeze({
        state,
        claims,
        completedEvidence,
        detailSha256,
        transitions: Object.freeze([...transitions]),
      });
    },
  });
}

function coherentProcessFailure() {
  return Object.freeze({
    disposition: "completed",
    exitCode: 1,
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
    processErrors: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.from("private tar failure", "utf8"),
  });
}

function unreapedProcessFailure() {
  return Object.freeze({
    disposition: "timeout-unreaped",
    exitCode: null,
    captureComplete: false,
    noChild: false,
    spawned: true,
    reaped: false,
    statusAgreement: false,
    directChildCleanupSafe: false,
    processGroupQuiescent: false,
    exitObserved: false,
    closeObserved: false,
    stdoutEof: false,
    stderrEof: false,
    stdinComplete: false,
    outputTruncated: false,
    processErrors: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.from("private unreaped tar", "utf8"),
  });
}

test("v2 materialization uses only a claimed private handle and returns frozen host-path-free evidence", async (t) => {
  const value = await fixture(t);
  const materializer = createSubmoduleV2MaterializerForTrustedController({
    claimCandidate: value.claimCandidate,
  });
  const evidence = await materializer.materialize(value.candidate);

  assert.deepEqual(evidence, [
    {
      path: "vendor/module",
      commit: value.frozen.commit,
      tree: value.frozen.tree,
      archiveSha256: evidence[0].archiveSha256,
      method: "git-archive-tar-v1",
    },
  ]);
  assert.match(evidence[0].archiveSha256, /^[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(evidence), true);
  assert.equal(Object.isFrozen(evidence[0]), true);
  assert.equal(
    await readFile(
      join(value.workspace, "vendor", "module", "module.txt"),
      "utf8",
    ),
    "frozen module\n",
  );
  await assert.rejects(
    lstat(join(value.workspace, "vendor", "module", ".git")),
    { code: "ENOENT" },
  );
  const publicJson = JSON.stringify(evidence);
  for (const privatePath of [
    value.root,
    value.sourceRoot,
    value.temporaryRoot,
    value.workspace,
    value.gitHome,
  ]) {
    assert.equal(publicJson.includes(privatePath), false);
  }
  assert.deepEqual(value.lifecycle().transitions, ["complete"]);
  assert.equal(value.lifecycle().completedEvidence, evidence);
  await assert.rejects(
    materializer.materialize(value.candidate),
    taskFailure([value.root]),
  );
  assert.equal(value.lifecycle().claims, 1);
});

test("v2 empty declarations still claim and complete exactly once", async (t) => {
  const value = await fixture(t, { empty: true });
  const materializer = createSubmoduleV2MaterializerForTrustedController({
    claimCandidate: value.claimCandidate,
  });
  const evidence = await materializer.materialize(value.candidate);
  assert.deepEqual(evidence, []);
  assert.equal(Object.isFrozen(evidence), true);
  assert.deepEqual(value.lifecycle().transitions, ["complete"]);
  assert.equal(value.lifecycle().completedEvidence, evidence);
});

test("v2 source validation rejects missing, dirty, symlinked, escaped, wrong-commit, and wrong-tree sources before extraction", async (t) => {
  const cases = [
    [
      "missing",
      async (value) =>
        rename(value.moduleRoot, join(value.root, "missing-module")),
    ],
    [
      "dirty",
      async (value) =>
        writeFile(join(value.moduleRoot, "dirty.txt"), "dirty\n"),
    ],
    [
      "symlink",
      async (value) => {
        const real = join(value.sourceRoot, "module-real");
        await rename(value.moduleRoot, real);
        await symlink("../module-real", value.moduleRoot, "dir");
      },
    ],
    [
      "escape",
      async (value) => {
        const outside = join(value.root, "outside-module");
        await rename(value.moduleRoot, outside);
        await symlink("../../outside-module", value.moduleRoot, "dir");
      },
    ],
    [
      "wrong-commit",
      async (value) =>
        value.setSubmodules([
          {
            path: "vendor/module",
            commit: "1".repeat(value.frozen.commit.length),
            tree: value.frozen.tree,
          },
        ]),
    ],
    [
      "wrong-tree",
      async (value) =>
        value.setSubmodules([
          {
            path: "vendor/module",
            commit: value.frozen.commit,
            tree: "2".repeat(value.frozen.tree.length),
          },
        ]),
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, async (t) => {
      const value = await fixture(t);
      await mutate(value);
      let extractionCalls = 0;
      const seam = createSubmoduleV2TestSeam({
        gitBytesRunner: runGitBytes,
        processBytesRunner: async () => {
          extractionCalls += 1;
          throw new Error("extraction must not start");
        },
      });
      const materializer = createSubmoduleV2MaterializerForTesting(
        { claimCandidate: value.claimCandidate },
        seam,
      );
      await assert.rejects(
        materializer.materialize(value.candidate),
        taskFailure([value.root, value.sourceRoot, value.moduleRoot]),
      );
      assert.equal(extractionCalls, 0);
      assert.equal(value.lifecycle().state, "submodules-failed");
      assert.deepEqual(value.lifecycle().transitions, ["failSafe"]);
      assert.match(value.lifecycle().detailSha256, /^[0-9a-f]{64}$/u);
    });
  }
});

test("v2 unreaped extraction quarantines and preserves candidate evidence", async (t) => {
  const value = await fixture(t);
  let extractionRequest;
  const seam = createSubmoduleV2TestSeam({
    gitBytesRunner: runGitBytes,
    processBytesRunner: async (input) => {
      extractionRequest = input;
      return unreapedProcessFailure();
    },
  });
  const materializer = createSubmoduleV2MaterializerForTesting(
    { claimCandidate: value.claimCandidate },
    seam,
  );
  await assert.rejects(
    materializer.materialize(value.candidate),
    taskFailure([value.root, "private unreaped tar"]),
  );
  assert.equal(value.lifecycle().state, "quarantined");
  assert.deepEqual(value.lifecycle().transitions, ["quarantine"]);
  assert.match(value.lifecycle().detailSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    (await readdir(value.temporaryRoot)).some((name) =>
      name.startsWith("submodule-v2-"),
    ),
    true,
  );
  assert.deepEqual(extractionRequest.args, [
    "--extract",
    "--file=/proc/self/fd/3",
    "--directory=.",
    "--no-same-owner",
    "--no-same-permissions",
    "--delay-directory-restore",
    "--no-overwrite-dir",
    "--restrict",
  ]);
  assert.equal(Object.hasOwn(extractionRequest, "stdin"), false);
  assert.equal(extractionRequest.inheritedFileDescriptors.length, 1);
  await materializer.releaseRetainedForTesting();
});

test("v2 coherently reaped extraction failure cleans staging and remains disposable", async (t) => {
  const value = await fixture(t);
  const seam = createSubmoduleV2TestSeam({
    gitBytesRunner: runGitBytes,
    processBytesRunner: async () => coherentProcessFailure(),
  });
  const materializer = createSubmoduleV2MaterializerForTesting(
    { claimCandidate: value.claimCandidate },
    seam,
  );
  await assert.rejects(
    materializer.materialize(value.candidate),
    taskFailure([value.root, "private tar failure"]),
  );
  assert.equal(value.lifecycle().state, "submodules-failed");
  assert.deepEqual(value.lifecycle().transitions, ["failSafe"]);
  assert.equal(
    (await readdir(value.temporaryRoot)).some((name) =>
      name.startsWith("submodule-v2-"),
    ),
    false,
  );
});

test("v2 unreaped Git failure quarantines before archive extraction", async (t) => {
  const value = await fixture(t);
  const outcome = unreapedProcessFailure();
  let extractionCalls = 0;
  const seam = createSubmoduleV2TestSeam({
    gitBytesRunner: async (input) => {
      throw new GitBytesProcessFault(input.args, outcome);
    },
    processBytesRunner: async () => {
      extractionCalls += 1;
      return coherentProcessFailure();
    },
  });
  const materializer = createSubmoduleV2MaterializerForTesting(
    { claimCandidate: value.claimCandidate },
    seam,
  );
  await assert.rejects(
    materializer.materialize(value.candidate),
    taskFailure([value.root, "private unreaped tar"]),
  );
  assert.equal(extractionCalls, 0);
  assert.equal(value.lifecycle().state, "quarantined");
  assert.deepEqual(value.lifecycle().transitions, ["quarantine"]);
});

test("v2 extraction rejects a non-tar byte protocol and cleans safely", async (t) => {
  const value = await fixture(t);
  const seam = createSubmoduleV2TestSeam({
    gitBytesRunner: async (input) =>
      input.args.includes("archive")
        ? Buffer.from("not an exact Git tar archive", "utf8")
        : runGitBytes(input),
    processBytesRunner: runBoundedProcessBytes,
  });
  const materializer = createSubmoduleV2MaterializerForTesting(
    { claimCandidate: value.claimCandidate },
    seam,
  );
  await assert.rejects(
    materializer.materialize(value.candidate),
    taskFailure([value.root]),
  );
  assert.equal(value.lifecycle().state, "submodules-failed");
  assert.equal(
    (await readdir(value.temporaryRoot)).some((name) =>
      name.startsWith("submodule-v2-"),
    ),
    false,
  );
});

test("v2 runner injection requires the exact branded test seam", async (t) => {
  const value = await fixture(t, { empty: true });
  const seam = createSubmoduleV2TestSeam({
    gitBytesRunner: runGitBytes,
    processBytesRunner: runBoundedProcessBytes,
  });
  assert.throws(
    () =>
      createSubmoduleV2MaterializerForTesting(
        { claimCandidate: value.claimCandidate },
        { ...seam },
      ),
    /branded test seam/u,
  );
  assert.throws(
    () =>
      createSubmoduleV2MaterializerForTesting(
        { claimCandidate: value.claimCandidate },
        new Proxy(seam, {}),
      ),
    /branded test seam/u,
  );
});
