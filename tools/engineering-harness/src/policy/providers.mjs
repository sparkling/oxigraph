import { blockedChildEnvironmentName } from "../../../child-environment.mjs";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { harnessRoot, isContained } from "../paths.mjs";
import { nativeChildEnvironment } from "../native/environment.mjs";

export const PROVIDERS = Object.freeze(["codex", "claude"]);
export const FORBIDDEN_ARGUMENTS = Object.freeze([
  "--oss",
  "--local-provider",
  "--profile",
  "--config",
  "--config-sources",
  "--settings",
  "--setting-sources",
  "--add-dir",
  "--permission-prompt-tool",
  "--fallback-model",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--chrome",
  "--cloud",
  "--plugin-url",
]);

export const CODEX_DISABLED_FEATURES = Object.freeze([
  "apps",
  "browser_use",
  "browser_use_external",
  "code_mode_host",
  "computer_use",
  "goals",
  "image_generation",
  "multi_agent",
  "plugins",
  "shell_tool",
  "skill_mcp_dependency_install",
  "skill_search",
]);

function assertSequence(actual, expected, provider) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${provider} invocation does not match the canonical argument shape`);
  }
}

function validateModel(model, provider) {
  if (typeof model !== "string" || model.length === 0 || model.startsWith("-")) {
    throw new Error(`${provider} invocation must select an explicit model`);
  }
  if (/openrouter/i.test(model)) throw new Error("OpenRouter transport is prohibited");
}

function validateExecutionRoot(root) {
  if (!isAbsolute(root)) throw new Error("native execution root must be absolute");
  const canonical = realpathSync(root);
  const temporaryRoot = realpathSync(tmpdir());
  if (!isContained(temporaryRoot, canonical) || canonical === temporaryRoot) {
    throw new Error("native execution root must be a private temporary directory");
  }
  const stat = statSync(canonical);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
    throw new Error("native execution root must be a private owner-only directory");
  }
  return canonical;
}

export function validateProviderInvocation({
  provider,
  executable,
  args,
  environment,
  cwd,
  attestation,
}) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`unsupported native provider: ${provider}`);
  }
  if (
    attestation?.provider !== provider ||
    attestation.path !== executable ||
    !isAbsolute(executable) ||
    !/^[0-9a-f]{64}$/.test(attestation.sha256 ?? "")
  ) {
    throw new Error(`${provider} invocation must use an attested native executable`);
  }
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
    throw new Error(`${provider} invocation arguments must be strings`);
  }
  if (environment === null || typeof environment !== "object") {
    throw new Error(`${provider} invocation environment is invalid`);
  }
  const flattened = [executable, ...args].join(" ");
  if (/openrouter/i.test(flattened)) {
    throw new Error("OpenRouter transport is prohibited");
  }
  for (const forbidden of FORBIDDEN_ARGUMENTS) {
    if (args.some((argument) => argument === forbidden || argument.startsWith(`${forbidden}=`))) {
      throw new Error(`${provider} invocation contains prohibited argument ${forbidden}`);
    }
  }
  const executionRoot = validateExecutionRoot(cwd);
  for (const name of Object.keys(environment)) {
    if (blockedChildEnvironmentName(name)) {
      throw new Error(`${provider} child environment retains prohibited authority: ${name}`);
    }
  }
  if (JSON.stringify(environment) !== JSON.stringify(nativeChildEnvironment())) {
    throw new Error(`${provider} child environment is not the canonical minimal environment`);
  }
  if (provider === "codex") {
    const model = args[8 + CODEX_DISABLED_FEATURES.length * 2];
    validateModel(model, provider);
    const schemaPath = join(harnessRoot, "schemas/worker-output.schema.json");
    const outputPath = join(executionRoot, "last-message.json");
    assertSequence(
      args,
      [
        "exec",
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--strict-config",
        ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
        "--model",
        model,
        "--json",
        "--color",
        "never",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "--cd",
        executionRoot,
        "--skip-git-repo-check",
        "-",
      ],
      provider,
    );
  } else {
    const model = args[11];
    validateModel(model, provider);
    const schema = readFileSync(
      join(harnessRoot, "schemas/worker-output.schema.json"),
      "utf8",
    );
    assertSequence(
      args,
      [
        "--print",
        "--safe-mode",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--tools",
        "",
        "--permission-mode",
        "dontAsk",
        "--model",
        model,
        "--output-format",
        "json",
        "--json-schema",
        schema,
        "--no-chrome",
        "--disable-slash-commands",
      ],
      provider,
    );
  }
  return true;
}
