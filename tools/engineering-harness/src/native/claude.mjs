import { validateProviderInvocation } from "../policy/providers.mjs";
import { nativeChildEnvironment } from "./environment.mjs";
import { resolveNativeExecutable } from "./executable.mjs";
import { claudeWorkerOutputSchema } from "./worker-schema.mjs";

export function claudeInvocation({ executionRoot, model, prompt }) {
  const environment = nativeChildEnvironment();
  const attestation = resolveNativeExecutable("claude");
  const schema = claudeWorkerOutputSchema();
  const args = [
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
  ];
  const invocation = Object.freeze({
    provider: "claude",
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
