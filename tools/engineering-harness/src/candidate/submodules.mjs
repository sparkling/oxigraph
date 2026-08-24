import { mkdir, readdir, realpath, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { runBoundedProcess } from "../native/process.mjs";
import { runGit } from "./git.mjs";

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child !== ".." && !child.startsWith(`..${sep}`);
}

async function extractArchive(archive, destination) {
  const outcome = await runBoundedProcess({
    executable: "/usr/bin/tar",
    args: ["-xf", archive, "-C", destination, "--no-same-owner"],
    cwd: destination,
    environment: Object.freeze({
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
    }),
    timeoutMs: 300_000,
    maxOutputBytes: 4_194_304,
  });
  if (outcome.disposition !== "completed" || outcome.exitCode !== 0) {
    throw new Error(`submodule archive extraction failed: ${outcome.stderr}`);
  }
}

export async function materializeFrozenSubmodules({
  controllerRoot,
  candidate,
  contract,
}) {
  const frozenSubmodules = contract.submodules ?? contract.protectedInputs?.submodules;
  if (!Array.isArray(frozenSubmodules) || frozenSubmodules.length === 0) {
    throw new Error("task contract must freeze required native submodules");
  }
  const canonicalController = await realpath(controllerRoot);
  const reports = [];
  for (const [index, frozen] of frozenSubmodules.entries()) {
    if (
      frozen === null ||
      typeof frozen !== "object" ||
      typeof frozen.path !== "string" ||
      !/^[0-9a-f]{40}$/.test(frozen.commit) ||
      !/^[0-9a-f]{40}$/.test(frozen.tree)
    ) {
      throw new Error(`submodules[${index}] is invalid`);
    }
    const source = await realpath(join(canonicalController, frozen.path));
    if (!contained(canonicalController, source)) {
      throw new Error(`submodule source escapes the controller: ${frozen.path}`);
    }
    const head = (
      await runGit({ args: ["rev-parse", "HEAD"], cwd: source, home: candidate.gitHome })
    ).trim();
    const tree = (
      await runGit({
        args: ["rev-parse", "HEAD^{tree}"],
        cwd: source,
        home: candidate.gitHome,
      })
    ).trim();
    const status = await runGit({
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      cwd: source,
      home: candidate.gitHome,
    });
    if (head !== frozen.commit || tree !== frozen.tree || status.length !== 0) {
      throw new Error(`submodule is not at its frozen clean state: ${frozen.path}`);
    }
    const destination = join(candidate.workspace, frozen.path);
    await mkdir(destination, { recursive: true, mode: 0o700 });
    if ((await readdir(destination)).length !== 0) {
      throw new Error(`candidate submodule destination is not empty: ${frozen.path}`);
    }
    const archive = join(candidate.temporaryRoot, `submodule-${index}.tar`);
    try {
      await runGit({
        args: ["archive", "--format=tar", `--output=${archive}`, frozen.commit],
        cwd: source,
        home: candidate.gitHome,
        timeoutMs: 300_000,
        maxOutputBytes: 4_194_304,
      });
      await extractArchive(archive, destination);
    } finally {
      await rm(archive, { force: true });
    }
    reports.push(
      Object.freeze({ path: frozen.path, commit: head, tree, source: "local-archive" }),
    );
  }
  return Object.freeze(reports);
}
