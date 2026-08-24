import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { scrubbedChildEnvironment } from "../../child-environment.mjs";
import { isContained, repositoryRoot } from "./paths.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function regularBytes(path, label) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return readFileSync(path);
}

function json(path, label) {
  const bytes = regularBytes(path, label);
  return { bytes, value: JSON.parse(bytes) };
}

function run(root, executable, args) {
  return spawnSync(executable, args, {
    cwd: root,
    env: scrubbedChildEnvironment({ NO_COLOR: "1" }),
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1_048_576,
  });
}

function hostConfiguration(root, host) {
  if (host === "claude-code") {
    return regularBytes(join(root, ".claude/settings.json"), "Claude settings");
  }
  if (host === "codex") {
    return regularBytes(join(root, ".codex/config.toml"), "Codex config");
  }
  throw new Error(`unsupported factory host: ${host}`);
}

export function diagnoseFactory(root, host, { runTests = false } = {}) {
  const canonicalRoot = realpathSync(root);
  if (isContained(repositoryRoot, canonicalRoot)) {
    throw new Error("factory diagnostics require a disposable path outside the repository");
  }
  const manifest = json(join(canonicalRoot, "package.json"), "factory manifest");
  const cli = regularBytes(join(canonicalRoot, "bin/cli.js"), "factory CLI");
  const hostConfig = hostConfiguration(canonicalRoot, host);
  const help = run(canonicalRoot, process.execPath, ["bin/cli.js", "--help"]);
  const mcp = run(canonicalRoot, process.execPath, ["bin/cli.js", "mcp", "start"]);
  const test = runTests
    ? run(canonicalRoot, "npm", ["test", "--", "--run"])
    : undefined;
  const configuration = hostConfig.toString("utf8");
  const dependencies = {
    ...(manifest.value.dependencies ?? {}),
    ...(manifest.value.devDependencies ?? {}),
  };
  const issues = [];
  if (manifest.value.publishConfig?.access === "public") {
    issues.push("public-publish-config");
  }
  if (
    Object.entries(dependencies).some(
      ([name, range]) =>
        (name === "@metaharness/kernel" || name.startsWith("@metaharness/host-")) &&
        typeof range === "string" &&
        range.startsWith("^"),
    )
  ) {
    issues.push("legacy-caret-dependencies");
  }
  if (configuration.includes("mcp") && configuration.includes("start") && mcp.status !== 0) {
    issues.push("declared-mcp-command-missing");
  }
  if (configuration.includes("mcp") && configuration.includes("index")) {
    issues.push("declared-mcp-index-command-unreviewed");
  }
  if (configuration.includes("Bash(npx") || configuration.includes("Bash(npm run*)")) {
    issues.push("broad-shell-permission");
  }
  if (help.status !== 0) {
    issues.push("factory-cli-help-failed");
  }
  if (runTests && test?.status !== 0) {
    issues.push("factory-tests-failed");
  }
  return Object.freeze({
    schema: 1,
    host,
    root: canonicalRoot,
    accepted: issues.length === 0,
    issues: Object.freeze(issues),
    manifestSha256: sha256(manifest.bytes),
    cliSha256: sha256(cli),
    hostConfigurationSha256: sha256(hostConfig),
    cliHelpExitCode: help.status,
    cliHelp: help.stdout.trim(),
    mcpStartExitCode: mcp.status,
    mcpStartStderr: mcp.stderr.trim(),
    testExitCode: test?.status ?? null,
  });
}
