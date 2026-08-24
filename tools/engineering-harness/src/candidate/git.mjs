import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runBoundedProcess } from "../native/process.mjs";

const gitExecutable = "/usr/bin/git";

export async function createGitHome(root) {
  const home = join(root, "git-home");
  await mkdir(home, { mode: 0o700 });
  return home;
}

function gitEnvironment(home, overrides = {}) {
  return Object.freeze({
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/bin:/bin",
    ...overrides,
  });
}

export async function runGit({
  args,
  cwd,
  home,
  stdin = "",
  timeoutMs = 120_000,
  maxOutputBytes = 4_194_304,
  environmentOverrides,
}) {
  const outcome = await runBoundedProcess({
    executable: gitExecutable,
    args,
    cwd,
    environment: gitEnvironment(home, environmentOverrides),
    stdin,
    timeoutMs,
    maxOutputBytes,
  });
  if (outcome.disposition !== "completed" || outcome.exitCode !== 0) {
    const detail = outcome.stderr.trim() || outcome.stdout.trim() || "no output";
    throw new Error(`git ${args[0]} failed (${outcome.disposition}/${outcome.exitCode}): ${detail}`);
  }
  return outcome.stdout;
}
