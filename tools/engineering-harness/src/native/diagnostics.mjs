import { createHash } from "node:crypto";
import { nativeChildEnvironment } from "./environment.mjs";
import { resolveNativeExecutable } from "./executable.mjs";
import { runBoundedProcess } from "./process.mjs";

const definitions = Object.freeze({
  codex: Object.freeze({
    versionArgs: Object.freeze(["--version"]),
    helpArgs: Object.freeze(["exec", "--help"]),
    requiredHelp: Object.freeze([
      "--sandbox",
      "--ignore-user-config",
      "--disable",
      "--output-schema",
    ]),
  }),
  claude: Object.freeze({
    versionArgs: Object.freeze(["--version"]),
    helpArgs: Object.freeze(["--help"]),
    requiredHelp: Object.freeze([
      "--safe-mode",
      "--strict-mcp-config",
      "--tools",
      "--json-schema",
    ]),
  }),
});

export async function nativeHostDiagnostics() {
  const environment = nativeChildEnvironment();
  const reports = [];
  for (const [provider, definition] of Object.entries(definitions)) {
    try {
      const attestation = resolveNativeExecutable(provider);
      const [version, help] = await Promise.all([
        runBoundedProcess({
          executable: attestation.path,
          args: definition.versionArgs,
          cwd: process.cwd(),
          environment,
          timeoutMs: 10_000,
          maxOutputBytes: 16_384,
        }),
        runBoundedProcess({
          executable: attestation.path,
          args: definition.helpArgs,
          cwd: process.cwd(),
          environment,
          timeoutMs: 10_000,
          maxOutputBytes: 131_072,
        }),
      ]);
      const helpText = `${help.stdout}\n${help.stderr}`;
      const interfaceValid =
        help.exitCode === 0 &&
        help.disposition === "completed" &&
        definition.requiredHelp.every((token) => helpText.includes(token));
      reports.push(
        Object.freeze({
          host: provider,
          available:
            version.exitCode === 0 &&
            version.disposition === "completed" &&
            interfaceValid,
          version: `${version.stdout}\n${version.stderr}`.trim(),
          disposition:
            version.disposition === "completed" ? help.disposition : version.disposition,
          interfaceValid,
          interfaceSha256: createHash("sha256").update(helpText).digest("hex"),
          executable: attestation,
        }),
      );
    } catch (error) {
      reports.push(
        Object.freeze({
          host: provider,
          available: false,
          version: "",
          disposition: error.code ?? "attestation-error",
          interfaceValid: false,
          error: error.message,
        }),
      );
    }
  }
  return Object.freeze(reports);
}
