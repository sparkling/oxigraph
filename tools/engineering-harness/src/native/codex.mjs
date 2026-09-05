import { join } from "node:path";
import {
  CODEX_DISABLED_FEATURES,
  validateProviderInvocation,
} from "../policy/providers.mjs";
import { nativeChildEnvironment } from "./environment.mjs";
import { resolveNativeExecutable } from "./executable.mjs";
import { workerOutputSchemaPathForVersion } from "./worker-schema.mjs";
import { validateAstraReasoningEffort } from "../policy/astra-routing.mjs";

export function codexInvocation({
  executionRoot,
  model,
  prompt,
  reasoningEffort = null,
  workerSchemaVersion = 1,
}) {
  const validatedEffort = validateAstraReasoningEffort(model, reasoningEffort);
  const environment = nativeChildEnvironment();
  const attestation = resolveNativeExecutable("codex");
  const args = [
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
    ...(validatedEffort === null
      ? []
      : ["--config", `model_reasoning_effort="${validatedEffort}"`]),
    "--json",
    "--color",
    "never",
    "--output-schema",
    workerOutputSchemaPathForVersion(workerSchemaVersion),
    "--output-last-message",
    join(executionRoot, "last-message.json"),
    "--cd",
    executionRoot,
    "--skip-git-repo-check",
    "-",
  ];
  const invocation = Object.freeze({
    provider: "codex",
    executable: attestation.path,
    args: Object.freeze(args),
    environment: Object.freeze(environment),
    stdin: prompt,
    cwd: executionRoot,
    attestation,
  });
  validateProviderInvocation(invocation);
  return invocation;
}
