import { blockedChildEnvironmentName } from "../../../child-environment.mjs";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { isContained } from "../paths.mjs";
import { nativeChildEnvironment } from "../native/environment.mjs";
import {
  claudeWorkerOutputSchema,
  workerOutputSchemaPath,
  workerOutputV2SchemaPath,
} from "../native/worker-schema.mjs";
import { validateAstraReasoningEffort } from "./astra-routing.mjs";

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

export function codexFeatureArguments(reasoningEffort) {
  // Ultra is native Codex orchestration, not another API reasoning level.
  // Keep the existing tool restrictions while permitting its subagents.
  return [
    ...CODEX_DISABLED_FEATURES.filter(
      (feature) => reasoningEffort !== "ultra" || feature !== "multi_agent",
    ).flatMap((feature) => ["--disable", feature]),
    ...(reasoningEffort === "ultra" ? ["--enable", "multi_agent"] : []),
  ];
}

function assertSequence(actual, expected, provider) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${provider} invocation does not match the canonical argument shape`,
    );
  }
}

function validateModel(model, provider) {
  if (
    typeof model !== "string" ||
    model.length === 0 ||
    model.startsWith("-")
  ) {
    throw new Error(`${provider} invocation must select an explicit model`);
  }
  if (/openrouter/i.test(model))
    throw new Error("OpenRouter transport is prohibited");
}

function validateExecutionRoot(root) {
  if (!isAbsolute(root))
    throw new Error("native execution root must be absolute");
  const canonical = realpathSync(root);
  const temporaryRoot = realpathSync(tmpdir());
  if (!isContained(temporaryRoot, canonical) || canonical === temporaryRoot) {
    throw new Error(
      "native execution root must be a private temporary directory",
    );
  }
  const stat = statSync(canonical);
  const uid =
    typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
    throw new Error(
      "native execution root must be a private owner-only directory",
    );
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
    throw new Error(
      `${provider} invocation must use an attested native executable`,
    );
  }
  if (
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string")
  ) {
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
    if (
      args.some(
        (argument, index) => {
          if (
            forbidden === "--config" &&
            provider === "codex" &&
            argument === "--config" &&
            index === args.indexOf("--config")
          ) {
            return false;
          }
          return argument === forbidden || argument.startsWith(`${forbidden}=`);
        },
      )
    ) {
      throw new Error(
        `${provider} invocation contains prohibited argument ${forbidden}`,
      );
    }
  }
  const executionRoot = validateExecutionRoot(cwd);
  for (const name of Object.keys(environment)) {
    if (blockedChildEnvironmentName(name)) {
      throw new Error(
        `${provider} child environment retains prohibited authority: ${name}`,
      );
    }
  }
  if (
    JSON.stringify(environment) !== JSON.stringify(nativeChildEnvironment())
  ) {
    throw new Error(
      `${provider} child environment is not the canonical minimal environment`,
    );
  }
  if (provider === "codex") {
    const modelIndex = args.indexOf("--model");
    const model = args[modelIndex + 1];
    validateModel(model, provider);
    const configIndexes = args.flatMap((argument, index) =>
      argument === "--config" ? [index] : [],
    );
    if (configIndexes.length > 1) {
      throw new Error("codex invocation may select one reasoning effort");
    }
    const reasoningEffort =
      configIndexes.length === 0
        ? null
        : /^model_reasoning_effort="([a-z]+)"$/u.exec(
            args[configIndexes[0] + 1] ?? "",
          )?.[1];
    if (configIndexes.length === 1 && reasoningEffort === undefined) {
      throw new Error("codex invocation contains an unsupported configuration");
    }
    validateAstraReasoningEffort(model, reasoningEffort);
    const suppliedSchemaPath = args[args.indexOf("--output-schema") + 1];
    if (
      suppliedSchemaPath !== workerOutputSchemaPath &&
      suppliedSchemaPath !== workerOutputV2SchemaPath
    ) {
      throw new Error("codex invocation selected an unsupported output schema");
    }
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
        ...codexFeatureArguments(reasoningEffort),
        "--model",
        model,
        ...(reasoningEffort === null
          ? []
          : ["--config", `model_reasoning_effort="${reasoningEffort}"`]),
        "--json",
        "--color",
        "never",
        "--output-schema",
        suppliedSchemaPath,
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
    const suppliedSchema = args[args.indexOf("--json-schema") + 1];
    const supportedSchemas = [
      claudeWorkerOutputSchema(1),
      claudeWorkerOutputSchema(2),
    ];
    if (!supportedSchemas.includes(suppliedSchema)) {
      throw new Error(
        "claude invocation selected an unsupported output schema",
      );
    }
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
        suppliedSchema,
        "--no-chrome",
        "--disable-slash-commands",
      ],
      provider,
    );
  }
  return true;
}
