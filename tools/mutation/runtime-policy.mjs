import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  assertDirectoryIdentity,
  createExclusiveDirectoryInside,
  directoryIdentity,
  syncDirectory,
} from "./path-policy.mjs";

// The prior complete qualification occupied a 65-75 minute execution
// envelope. Ninety minutes keeps the exact default command bounded while
// leaving measured headroom for cold or slower workers.
export const DEFAULT_OUTER_TIMEOUT_MS = 5_400_000;
export const CURRENT_QUALIFICATION_TIMEOUT_MS = 300_000;

const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value ?? "",
  );

function nulRecords(value, label) {
  if (typeof value !== "string") {
    throw new Error(`mutation Git ${label} did not return text`);
  }
  return value.split("\0").filter(Boolean);
}

function qualificationGitEnvironment(baseEnvironment) {
  return Object.fromEntries(
    Object.entries(baseEnvironment).filter(
      ([name]) => !name.toUpperCase().startsWith("GIT_"),
    ),
  );
}

function runGit(root, args, execute, environment) {
  return execute("git", args, {
    cwd: root,
    encoding: "utf8",
    env: environment,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

const allowedGeneratedRoots = [
  ".agentic-qe",
  "js/node_modules",
  "lib/tests/rocksdb_bc_data",
  "tools/agentic-qe/node_modules",
  "tools/engineering-harness/.runtime",
  "tools/engineering-harness/node_modules",
  "tools/metaharness/node_modules",
];

function allowedIgnoredGeneratedPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  if (normalized.split("/").includes("target")) return true;
  return allowedGeneratedRoots.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

export function assertCleanQualificationWorktree(
  repositoryRoot,
  { execute = execFileSync, baseEnvironment = process.env } = {},
) {
  const root = realpathSync(repositoryRoot);
  const environment = qualificationGitEnvironment(baseEnvironment);
  const status = nulRecords(
    runGit(
      root,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      execute,
      environment,
    ),
    "status",
  );
  if (status.length > 0) {
    const paths = status.map((entry) => entry.slice(3)).join(", ");
    throw new Error(
      `mutation qualification requires a clean disposable worktree; dirty paths: ${paths}`,
    );
  }

  const indexFlags = nulRecords(
    runGit(root, ["ls-files", "-v", "-z"], execute, environment),
    "index inventory",
  );
  const hidden = indexFlags.flatMap((entry) => {
    const flag = entry[0];
    const path = entry.slice(2);
    if (flag === "S") return [`skip-worktree ${path}`];
    if (flag === "s") return [`skip-worktree/assume-unchanged ${path}`];
    if (/^[a-z]$/.test(flag)) return [`assume-unchanged ${path}`];
    return [];
  });
  if (hidden.length > 0) {
    throw new Error(
      `mutation qualification rejects hidden Git index flags: ${hidden.join(", ")}`,
    );
  }

  const ignored = nulRecords(
    runGit(
      root,
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "--no-empty-directory",
        "-z",
      ],
      execute,
      environment,
    ),
    "ignored inventory",
  );
  const rejectedIgnored = ignored.filter(
    (path) => !allowedIgnoredGeneratedPath(path),
  );
  if (rejectedIgnored.length > 0) {
    throw new Error(
      `mutation qualification rejects ignored untracked paths outside its generated-output allowlist: ${rejectedIgnored.join(", ")}`,
    );
  }
  return root;
}

export function createMutationEnvironment(
  repositoryRoot,
  runId,
  { baseEnvironment = process.env } = {},
) {
  if (!uuid(runId)) {
    throw new Error("mutation temporary directory requires a UUIDv4 run id");
  }
  if (
    baseEnvironment === null ||
    typeof baseEnvironment !== "object" ||
    Array.isArray(baseEnvironment)
  ) {
    throw new Error("mutation base environment is invalid");
  }
  const root = realpathSync(repositoryRoot);
  const temporaryDirectory = createExclusiveDirectoryInside(
    root,
    join(root, "target", "cargo-mutants-tmp", runId),
  );
  return Object.freeze({
    ...baseEnvironment,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
  });
}

export function cleanupMutationEnvironment(repositoryRoot, environment) {
  const root = realpathSync(repositoryRoot);
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment) ||
    typeof environment.TMPDIR !== "string" ||
    environment.TMPDIR !== environment.TMP ||
    environment.TMPDIR !== environment.TEMP
  ) {
    throw new Error("mutation temporary directory binding is invalid");
  }
  const parent = join(root, "target", "cargo-mutants-tmp");
  const temporaryDirectory = resolve(environment.TMPDIR);
  const runId = basename(temporaryDirectory);
  if (
    dirname(temporaryDirectory) !== parent ||
    !uuid(runId) ||
    relative(parent, temporaryDirectory).includes(sep) ||
    realpathSync(parent) !== parent ||
    realpathSync(temporaryDirectory) !== temporaryDirectory
  ) {
    throw new Error("mutation temporary directory binding is invalid");
  }

  const parentIdentity = directoryIdentity(parent);
  const temporaryIdentity = directoryIdentity(temporaryDirectory);
  const quarantine = join(parent, `.cleanup-${runId}-${randomUUID()}`);
  assertDirectoryIdentity(parentIdentity);
  renameSync(temporaryDirectory, quarantine);
  assertDirectoryIdentity(parentIdentity);
  assertDirectoryIdentity({ ...temporaryIdentity, path: quarantine });
  rmSync(quarantine, { recursive: true, force: false });
  assertDirectoryIdentity(parentIdentity);
  syncDirectory(parent);
  assertDirectoryIdentity(parentIdentity);
}
