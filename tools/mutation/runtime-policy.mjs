import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { createExclusiveDirectoryInside } from "./path-policy.mjs";

// The prior complete qualification occupied a 65-75 minute execution
// envelope. Ninety minutes keeps the exact default command bounded while
// leaving measured headroom for cold or slower workers.
export const DEFAULT_OUTER_TIMEOUT_MS = 5_400_000;
export const CURRENT_QUALIFICATION_TIMEOUT_MS = 300_000;

const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value ?? "",
  );

export function assertCleanQualificationWorktree(
  repositoryRoot,
  { execute = execFileSync } = {},
) {
  const root = realpathSync(repositoryRoot);
  const status = execute(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (typeof status !== "string") {
    throw new Error("mutation Git status did not return text");
  }
  const entries = status.trim().split(/\r?\n/).filter(Boolean);
  if (entries.length > 0) {
    const paths = entries.map((entry) => entry.slice(3)).join(", ");
    throw new Error(
      `mutation qualification requires a clean disposable worktree; dirty paths: ${paths}`,
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
  return {
    ...baseEnvironment,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
  };
}
