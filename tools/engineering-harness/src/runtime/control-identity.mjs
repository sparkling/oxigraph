import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { canonicalSha256 } from "../routing/features.mjs";
import { installedDependencyResolution } from "../dependency-binding.mjs";
import { nativeHostDiagnostics } from "../native/diagnostics.mjs";
import { NATIVE_WORKER_TIMEOUT_CEILINGS_MS } from "../policy/native-timeouts.mjs";
import { repositoryRoot } from "../paths.mjs";
import { verifyTaskContractRepository } from "../contract.mjs";

const gitEnvironment = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/nonexistent",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/bin:/bin",
});

function git(root, args, { buffer = false } = {}) {
  return execFileSync("/usr/bin/git", args, {
    cwd: root,
    env: gitEnvironment,
    encoding: buffer ? undefined : "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function frozenNativeHosts(reports) {
  return Object.freeze(
    reports.map((report) =>
      Object.freeze({
        provider: report.host,
        available: report.available,
        version: report.version,
        interfaceValid: report.interfaceValid,
        interfaceSha256: report.interfaceSha256 ?? null,
        executableSha256: report.executable?.sha256 ?? null,
        executablePath: report.executable?.path ?? null,
      }),
    ),
  );
}

export async function currentControlIdentity({
  contract,
  repoRoot = repositoryRoot,
} = {}) {
  const root = realpathSync(repoRoot);
  const status = git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    "tools/engineering-harness",
  ]);
  if (status.length !== 0) {
    throw new Error(`engineering harness must be committed and clean:\n${status}`);
  }
  const controlCommit = git(root, ["rev-parse", "HEAD"]).trim();
  const harnessTree = git(root, [
    "rev-parse",
    `${controlCommit}:tools/engineering-harness`,
  ]).trim();
  const harnessManifest = git(
    root,
    ["ls-tree", "-r", "-z", controlCommit, "--", "tools/engineering-harness"],
    { buffer: true },
  );
  const repositoryBinding = verifyTaskContractRepository(contract, {
    repoRoot: root,
    registrationCommit: controlCommit,
  });
  const dependencies = installedDependencyResolution();
  const nativeHosts = frozenNativeHosts(await nativeHostDiagnostics());
  if (!nativeHosts.every(({ available, interfaceValid }) => available && interfaceValid)) {
    throw new Error("both native provider hosts must be available and interface-attested");
  }
  const binding = Object.freeze({
    schema: "oxigraph.engineering-control-identity/v1",
    controlCommit,
    harnessTree,
    harnessManifestSha256: sha256(harnessManifest),
    manifestSha256: dependencies.manifestSha256,
    lockfileSha256: dependencies.lockfileSha256,
    npmrcSha256: dependencies.npmrcSha256,
    dependencies: dependencies.packages,
    nativeHosts,
    nativeWorkerTimeoutCeilingsMs: NATIVE_WORKER_TIMEOUT_CEILINGS_MS,
    registration: repositoryBinding.registration,
  });
  return Object.freeze({
    ...binding,
    harnessSha256: canonicalSha256(binding),
  });
}

export function ignoredByGit(path, repoRoot = repositoryRoot) {
  const root = realpathSync(repoRoot);
  try {
    git(root, ["check-ignore", "--quiet", "--no-index", "--", path]);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}
