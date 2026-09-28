// Ordinary non-Git source isolation; frozen qualification workspaces are separate.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  readlinkSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { scrubbedChildEnvironment } from "../../child-environment.mjs";
import { ensureDirectoryInsideRepository } from "../../agentic-qe/path-policy.mjs";
import { repository, runDelivery, sourceObservation } from "./delivery.mjs";
import { jsonReference, readWorkflowFiles, runWorkflow, validateWorkflow, verifyJsonReference } from "./workflow.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const excluded = new Set([".git", "node_modules", "target", ".swarm", ".claude-flow", ".ruvnet-brain", ".agentic-qe"]);
export const isSecretSourcePath = (path) => /(^|\/)\.env(?:[./]|$)/.test(path);
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
};
function cleanSubmodules(root = repository) {
  const git = (args) => execFileSync("git", args, { cwd: root, env: scrubbedChildEnvironment(),
    maxBuffer: 32 * 1024 * 1024 }).toString();
  const links = git(["ls-files", "--stage", "-z"]).split("\0")
    .map((entry) => /^160000 [a-f0-9]+ 0\t([\s\S]+)$/.exec(entry)?.[1]).filter(Boolean);
  return links.sort().flatMap((path) => {
    const directory = join(root, path);
    if (!inside(root, directory) || !existsSync(join(directory, ".git")) || realpathSync(directory) !== directory) {
      throw new Error(`Candidate needs initialized regular submodule: ${path}`);
    }
    const read = (args) => execFileSync("git", args, { cwd: directory, env: scrubbedChildEnvironment(),
      maxBuffer: 32 * 1024 * 1024 }).toString().trim();
    if (read(["status", "--porcelain=v1", "--untracked-files=all"])) {
      throw new Error(`Candidate snapshot requires clean submodule bytes: ${directory}`);
    }
    return [{ root: directory, head: read(["rev-parse", "HEAD"]) }, ...cleanSubmodules(directory)];
  });
}

function snapshotEntries(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).flatMap((entry) => {
    if (excluded.has(entry.name)) return [];
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(root, path), stat = lstatSync(absolute);
    if (stat.isDirectory()) return snapshotEntries(root, path);
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(absolute);
      if (!inside(root, resolve(dirname(absolute), link))) throw new Error(`Candidate symlink leaves source: ${path}`);
      return [{ path, mode: "symlink", sha256: hash(link) }];
    }
    if (!stat.isFile()) throw new Error(`Candidate source is not regular: ${path}`);
    return [{ path, mode: stat.mode & 0o777, sha256: hash(readFileSync(absolute)) }];
  });
}

function retainCandidateFailure(error, root, directory, phase) {
  Object.assign(error, { candidateRoot: root, evidenceDirectory: directory ?? root });
  try {
    writeFileSync(join(error.evidenceDirectory, directory ? "failure.json" : "preparation-failure.json"),
      JSON.stringify({ phase, error: error.message, candidateRoot: root }), { flag: "wx", mode: 0o600 });
  } catch (evidenceError) { error.evidenceWriteError = evidenceError.message; }
  return error;
}

export function createOrdinaryWorkspace() {
  const base = sourceObservation();
  const submodules = cleanSubmodules();
  const paths = execFileSync("git", ["ls-files", "--recurse-submodules", "-z"],
    { cwd: repository, env: scrubbedChildEnvironment(), maxBuffer: 32 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
  // Git's recursive listing omits inactive but locally initialized submodules.
  for (const module of submodules) {
    const prefix = relative(repository, module.root);
    const entries = execFileSync("git", ["ls-files", "-z"], { cwd: module.root,
      env: scrubbedChildEnvironment(), maxBuffer: 32 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
    paths.push(...entries.map((path) => `${prefix}/${path}`));
  }
  paths.push(...base.untracked.map((entry) => entry.path));
  const parent = ensureDirectoryInsideRepository(join(repository, "target", "engineering-delivery", "candidates"));
  const root = mkdtempSync(join(parent, "source-"));
  try { return prepareWorkspace(root, base, submodules, paths); }
  catch (error) {
    throw retainCandidateFailure(error, root, undefined, "snapshot-preparation");
  }
}

function prepareWorkspace(root, base, submodules, paths) {
  for (const path of [...new Set(paths)].sort()) {
    if (path.split("/").some((part) => excluded.has(part))) continue;
    if (!inside(repository, resolve(repository, path)) || isSecretSourcePath(path)) {
      throw new Error(`Unsafe candidate input: ${path}`);
    }
    const from = join(repository, path), to = join(root, path);
    let stat;
    try { stat = lstatSync(from); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (stat.isDirectory() && submodules.some((module) => module.root === from)) {
      mkdirSync(to, { recursive: true });
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    if (stat.isSymbolicLink()) {
      const link = readlinkSync(from);
      if (isAbsolute(link) || !inside(root, resolve(dirname(to), link))) throw new Error(`Unsafe source symlink: ${path}`);
      symlinkSync(link, to);
    } else if (stat.isFile() && realpathSync(from) === from) copyFileSync(from, to);
    else throw new Error(`Unsafe candidate input type: ${path}`);
  }
  if (!same(base, sourceObservation()) || !same(submodules, cleanSubmodules())) {
    throw new Error("Canonical source changed during candidate snapshot; candidate retained");
  }
  // Installed dependencies are shared read-only inputs, never candidate mutation paths.
  for (const path of ["node_modules", "tools/engineering-harness/node_modules"]) {
    const dependency = join(repository, path);
    if (existsSync(dependency)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      symlinkSync(realpathSync(dependency), join(root, path), "dir");
    }
  }
  const initial = snapshotEntries(root);
  const observe = () => ({ root, kind: "ordinary-non-git-candidate", base, submodules,
    sourceSha256: hash(JSON.stringify(snapshotEntries(root))) });
  return Object.freeze({ root, base, initial,
    observe,
    files: (paths) => readWorkflowFiles(paths, root),
    outside: (paths) => snapshotEntries(root).filter((entry) => !paths.includes(entry.path)),
    execute: (command) => runDelivery(command, { root, observe }),
  });
}

export async function runIsolatedWorkflow(rawSpec, host, options = {}) {
  const spec = validateWorkflow(rawSpec);
  const workspace = createOrdinaryWorkspace();
  let directory;
  let sequence = 0;
  const event = (value) => {
    const path = join(directory, `event-${++sequence}.json`);
    writeFileSync(path, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    return jsonReference(path, value, workspace.root);
  };
  try {
    directory = mkdtempSync(join(ensureDirectoryInsideRepository(join(workspace.root, "target", "engineering-delivery")), "workflow-"));
    const result = await runWorkflow(spec, host, {
      ...options, ...workspace, event,
      verifyReference: (reference, expected) => verifyJsonReference(reference, expected, workspace.root),
      checkReference: (run) => { const { directory: output, ...record } = run;
        return jsonReference(join(output, "result.json"), record, workspace.root); },
    });
    const output = { ...result, integration: "pending-owner-acceptance", candidateRoot: workspace.root, base: workspace.base };
    writeFileSync(join(directory, "result.json"), JSON.stringify(output), { flag: "wx", mode: 0o600 });
    return { directory, ...output };
  } catch (error) {
    throw retainCandidateFailure(error, workspace.root, directory, directory ? "workflow" : "workflow-preparation");
  }
}
