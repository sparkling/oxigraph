import { mkdtemp, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isContained } from "../paths.mjs";
import {
  normalizeCandidatePath,
  validateCandidatePatch,
} from "../policy/paths.mjs";
import { createGitHome, runGit } from "./git.mjs";
import { sha256, treeManifest } from "./manifest.mjs";

function nulList(output) {
  return output.split("\0").filter(Boolean);
}

async function requireClean(workspace, home) {
  const status = await runGit({
    args: ["status", "--porcelain=v1", "--untracked-files=all"],
    cwd: workspace,
    home,
  });
  if (status.length !== 0) throw new Error(`candidate workspace is not clean: ${status}`);
}

async function requireTree(workspace, home, expected) {
  const actual = (
    await runGit({ args: ["rev-parse", "HEAD^{tree}"], cwd: workspace, home })
  ).trim();
  if (actual !== expected) {
    throw new Error(`checked-out tree mismatch: expected ${expected}, found ${actual}`);
  }
}

function expectedProtectedManifest(contract) {
  return contract.protected?.evaluator ?? {
    entries: contract.protectedInputs.evaluatorManifest.protectedEntries,
    sha256: contract.protectedInputs.evaluatorManifest.protectedSha256,
  };
}

async function requireProtectedManifest({ workspace, tree, home, contract }) {
  const manifest = await treeManifest({
    workspace,
    tree,
    home,
    exclude: contract.scope?.mutableExact ?? [],
  });
  const expected = expectedProtectedManifest(contract);
  if (manifest.entries !== expected.entries || manifest.sha256 !== expected.sha256) {
    throw new Error("candidate changed the frozen protected-tree projection");
  }
  return manifest;
}

async function prepareEvaluatorWorkspace({ repositoryRoot, contract }) {
  const source = await realpath(repositoryRoot);
  if (source === resolve("/")) throw new Error("repository root may not be the filesystem root");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "oxigraph-candidate-"));
  const workspace = join(temporaryRoot, "repo");
  const targetRoot = join(temporaryRoot, "target");
  const commandTemp = join(temporaryRoot, "tmp");
  const gitHome = await createGitHome(temporaryRoot);
  try {
    await mkdir(targetRoot, { mode: 0o700 });
    await mkdir(commandTemp, { mode: 0o700 });
    await runGit({
      args: [
        "clone",
        "--local",
        "--no-hardlinks",
        "--no-checkout",
        "--config",
        "core.hooksPath=/dev/null",
        "--",
        source,
        workspace,
      ],
      cwd: temporaryRoot,
      home: gitHome,
      timeoutMs: 300_000,
      maxOutputBytes: 8_388_608,
    });
    for (const [name, value] of [
      ["core.hooksPath", "/dev/null"],
      ["core.autocrlf", "false"],
      ["credential.helper", ""],
      ["protocol.file.allow", "never"],
    ]) {
      await runGit({
        args: ["config", "--local", name, value],
        cwd: workspace,
        home: gitHome,
      });
    }
    await runGit({
      args: ["checkout", "--detach", contract.baseline.commit],
      cwd: workspace,
      home: gitHome,
    });
    await requireTree(workspace, gitHome, contract.baseline.tree);
    await requireClean(workspace, gitHome);

    const evaluatorParent = (
      await runGit({
        args: ["rev-parse", `${contract.evaluator.commit}^`],
        cwd: workspace,
        home: gitHome,
      })
    ).trim();
    if (evaluatorParent !== contract.baseline.commit) {
      throw new Error("evaluator commit is not the direct child of the baseline");
    }
    const evaluatorPatch = await runGit({
      args: ["diff", "--binary", contract.baseline.commit, contract.evaluator.commit],
      cwd: workspace,
      home: gitHome,
      maxOutputBytes: 8_388_608,
    });
    if (sha256(evaluatorPatch) !== contract.evaluator.patchSha256) {
      throw new Error("evaluator patch digest does not match the frozen contract");
    }
    await runGit({
      args: ["apply", "--index", "--whitespace=error", "-"],
      cwd: workspace,
      home: gitHome,
      stdin: evaluatorPatch,
    });
    const evaluatorTree = (
      await runGit({ args: ["write-tree"], cwd: workspace, home: gitHome })
    ).trim();
    if (evaluatorTree !== contract.evaluator.tree) {
      throw new Error("evaluator overlay did not reconstruct the frozen tree");
    }

    return {
      temporaryRoot,
      workspace,
      targetRoot,
      commandTemp,
      gitHome,
      evaluatorPatch,
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function requireOwnerOnly(candidate) {
  const rootMode = (await stat(candidate.temporaryRoot)).mode & 0o777;
  if (rootMode !== 0o700) throw new Error("candidate root is not owner-only");
}

export async function reconstructEvaluator({ repositoryRoot, contract }) {
  const prepared = await prepareEvaluatorWorkspace({ repositoryRoot, contract });
  try {
    await runGit({
      args: ["checkout", "--detach", contract.evaluator.commit],
      cwd: prepared.workspace,
      home: prepared.gitHome,
    });
    await requireTree(prepared.workspace, prepared.gitHome, contract.evaluator.tree);
    await requireClean(prepared.workspace, prepared.gitHome);
    const protectedManifest = await requireProtectedManifest({
      workspace: prepared.workspace,
      tree: contract.evaluator.tree,
      home: prepared.gitHome,
      contract,
    });
    const result = Object.freeze({
      ...prepared,
      candidateTree: contract.evaluator.tree,
      candidateCommit: contract.evaluator.commit,
      candidatePatchSha256: null,
      evaluatorPatchSha256: sha256(prepared.evaluatorPatch),
      changedPaths: Object.freeze([]),
      protectedManifest,
      kind: "evaluator",
    });
    await requireOwnerOnly(result);
    return result;
  } catch (error) {
    await rm(prepared.temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function reconstructCandidate({ repositoryRoot, contract, patch }) {
  validateCandidatePatch(patch, contract);
  const prepared = await prepareEvaluatorWorkspace({ repositoryRoot, contract });
  const {
    temporaryRoot,
    workspace,
    targetRoot,
    commandTemp,
    gitHome,
    evaluatorPatch,
  } = prepared;
  try {

    await runGit({
      args: ["apply", "--check", "--index", "--whitespace=error", "-"],
      cwd: workspace,
      home: gitHome,
      stdin: patch,
    });
    await runGit({
      args: ["apply", "--index", "--whitespace=error", "-"],
      cwd: workspace,
      home: gitHome,
      stdin: patch,
    });
    const candidateTree = (
      await runGit({ args: ["write-tree"], cwd: workspace, home: gitHome })
    ).trim();
    const changedPaths = nulList(
      await runGit({
        args: ["diff", "--name-only", "-z", contract.evaluator.tree, candidateTree],
        cwd: workspace,
        home: gitHome,
      }),
    );
    const expectedPaths = [...(contract.scope?.mutableExact ?? [])].sort();
    if (
      changedPaths.length === 0 ||
      changedPaths.some((path) => !expectedPaths.includes(path))
    ) {
      throw new Error(`candidate tree changed unexpected paths: ${changedPaths.join(", ")}`);
    }
    for (const path of changedPaths) {
      const entry = await runGit({
        args: ["ls-tree", candidateTree, "--", path],
        cwd: workspace,
        home: gitHome,
      });
      if (!entry.startsWith("100644 blob ")) {
        throw new Error(`candidate path is not a regular 100644 blob: ${path}`);
      }
    }
    const protectedManifest = await requireProtectedManifest({
      workspace,
      tree: candidateTree,
      home: gitHome,
      contract,
    });
    const candidateCommit = (
      await runGit({
        args: ["commit-tree", candidateTree, "-p", contract.evaluator.commit],
        cwd: workspace,
        home: gitHome,
        stdin: "Oxigraph engineering-harness candidate\n",
        environmentOverrides: {
          GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
          GIT_AUTHOR_EMAIL: "harness@localhost",
          GIT_AUTHOR_NAME: "Oxigraph Engineering Harness",
          GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
          GIT_COMMITTER_EMAIL: "harness@localhost",
          GIT_COMMITTER_NAME: "Oxigraph Engineering Harness",
        },
      })
    ).trim();
    await runGit({
      args: ["checkout", "--detach", candidateCommit],
      cwd: workspace,
      home: gitHome,
    });
    await requireTree(workspace, gitHome, candidateTree);
    await requireClean(workspace, gitHome);
    const result = Object.freeze({
      temporaryRoot,
      workspace,
      targetRoot,
      commandTemp,
      gitHome,
      candidateTree,
      candidateCommit,
      candidatePatchSha256: sha256(patch),
      evaluatorPatchSha256: sha256(evaluatorPatch),
      changedPaths: Object.freeze(changedPaths),
      protectedManifest,
      kind: "candidate",
    });
    await requireOwnerOnly(result);
    return result;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function disposeCandidate(candidate) {
  const canonical = await realpath(candidate.temporaryRoot);
  const temporary = await realpath(tmpdir());
  if (!canonical.startsWith(`${temporary}/oxigraph-candidate-`)) {
    throw new Error("refusing to dispose an unrecognized candidate root");
  }
  await rm(canonical, { recursive: true, force: true });
}

export async function candidateSource(candidate, path) {
  const normalized = normalizeCandidatePath(path);
  const source = await realpath(join(candidate.workspace, normalized));
  if (!isContained(await realpath(candidate.workspace), source)) {
    throw new Error(`candidate source escapes the sealed workspace: ${normalized}`);
  }
  return readFile(source, "utf8");
}
