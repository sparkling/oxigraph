import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ordinaryClaudeEnvironment } from "./environment.mjs";
import { ordinaryRustEnvironment } from "../../../child-environment.mjs";
import { resolveNativeExecutable } from "./executable.mjs";
import { codexInvocation } from "./codex.mjs";
import { ordinaryClaudeStreamArgs, startOrdinaryClaudeStream, forwardOrdinaryStreamSignals } from "./ordinary-stream.mjs";
import { workerOutput } from "../workflow-output.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
// Request scoped startup settings without changing user provider configuration.
const ORDINARY_CODEX_ISOLATION_CONFIG = Object.freeze([
  "project_doc_max_bytes=0", "project_doc_fallback_filenames=[]", "mcp_servers={}",
  "features.hooks=false", "features.remote_plugin=false",
]);
// Positive native diagnostics only. Exit codes, parser failures and signals are
// not evidence that a subscription or requested model is unavailable.
const outage = error => /^(?:API Error:\s*(?:401|403|429|5\d\d)\b|(?:authentication_error|permission_error|rate_limit_error|overloaded_error)\b|not logged in\b|invalid API key\b|OAuth token (?:has )?expired\b|(?:requested )?model\b[^\n]*(?:not found|not available|unavailable|does not exist|not supported))/i.test(error.trim());
const schema = { type: "object", additionalProperties: false, required: ["summary", "verdict", "findings", "changes"], properties: {
  summary: { type: "string" }, verdict: { enum: ["ACCEPT", "REJECT", "INCONCLUSIVE"] }, findings: { type: "array", items: { type: "string" } },
  changes: { type: "array", items: { type: "object", additionalProperties: false, required: ["path", "content"], properties: { path: { type: "string" }, content: { type: "string" } } } },
} };

/** One ordinary bridge invocation; caller owns packet, supplemental reads and recovery. */
export async function runOrdinaryNativeRequest({
  request, requestPath, prompt, directory, reads = [], readSource, driverUrl,
  resolveExecutable = resolveNativeExecutable, streamLimits, observation = value => console.log(JSON.stringify(value)),
}) {
  const { payload, action, ...identity } = request;
  assert.equal(action, "native-worker");
  assert.equal(payload.route.transport, "native-subscription");
  assert.ok(["gpt-6.1-sol", "cc/claude-sonnet-5-5[1m]", "cc/claude-opus-5-5[1m]"].includes(payload.route.model));
  assert.equal(payload.route.effort, "high");
  assert.deepEqual(JSON.parse(readFileSync(requestPath, "utf8")), request);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value, null, 2), { flag: "wx", mode: 0o600 });
  const client = payload.route.model === "gpt-6.1-sol" ? "codex" : "claude-code";
  // Keep Codex's existing temporary-root policy even when bridge receipts live in target/.
  const executionRoot = client === "codex" ? mkdtempSync(join(tmpdir(), "oxigraph-ordinary-codex-")) : directory;
  const invocation = client === "codex" ? codexInvocation({ executionRoot, model: payload.route.model,
    reasoningEffort: payload.route.effort, prompt, workerSchemaVersion: "ordinary", resolveExecutable }) : undefined;
  const executable = invocation?.attestation ?? resolveExecutable("claude");
  let argv = invocation?.args ?? ordinaryClaudeStreamArgs(["--print", "--safe-mode", "--no-session-persistence", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--model", payload.route.model, "--effort", payload.route.effort, "--permission-mode", "dontAsk", "--tools", "", "--output-format", "json",
    "--json-schema", JSON.stringify(schema), "--no-chrome", "--disable-slash-commands"]);
  const environment = ordinaryRustEnvironment(invocation?.environment ?? ordinaryClaudeEnvironment());
  if (client === "codex") {
    argv = [...argv.slice(0, -1), ...ORDINARY_CODEX_ISOLATION_CONFIG.flatMap(value => ["-c", value]),
      ...Object.entries(ordinaryRustEnvironment({})).flatMap(([name, value]) =>
      ["-c", `shell_environment_policy.set.${name}=${JSON.stringify(value)}`]),
      argv.at(-1)];
  }
  // All fallible metadata reads precede spawn; later host exceptions drain the child.
  const start = { runId: request.runId, requestId: request.requestId, taskId: request.taskId, role: payload.route.role,
    client, model: payload.route.model, effort: payload.route.effort, startedAt: new Date().toISOString(),
    executableSha256: executable.sha256, driverSha256: sha(readFileSync(driverUrl)),
    hostHelperSha256: sha(readFileSync(new URL(import.meta.url))),
    streamHelperSha256: sha(readFileSync(new URL("./ordinary-stream.mjs", import.meta.url))),
    argv, executionRoot, ...(client === "claude-code" ? { outputLimit: Number(environment.CLAUDE_CODE_MAX_OUTPUT_TOKENS) } : {}), promptSha256: sha(prompt),
    requestSha256: sha(readFileSync(requestPath)), reads: reads.map(({ content, ...r }) => r) };
  const execution = startOrdinaryClaudeStream({ executable: executable.path, args: argv, cwd: executionRoot, environment, stdin: prompt,
    identity: request, progressPath: join(directory, "progress.jsonl"), limits: streamLimits, client,
    onProgress: progress => observation({ ...progress, type: "native-progress", event: progress.type }) });
  forwardOrdinaryStreamSignals(execution);
  start.pid = execution.pid;
  try {
    save("start.json", { ...start, readSource });
    observation({ type: "native-start", ...start, argv: undefined, directory });
    const terminal = await execution.completion;
    const { exitCode: code, stdout, stderr } = terminal;
    save("terminal.json", { ...terminal, code, endedAt: new Date().toISOString() });
    const fail = (classification, error) => {
      const failure = { ...identity, client, model: payload.route.model,
        classification, custodyReleased: terminal.custodyReleased, pid: terminal.pid,
        ...(error === undefined ? {} : { error }) };
      save("failure.json", failure);
      observation({ type: "native-end", runId: request.runId, requestId: request.requestId, code, status: "failed",
        classification, custodyReleased: terminal.custodyReleased, pid: terminal.pid,
        errorSha256: error === undefined ? undefined : sha(error), failure: join(directory, "failure.json") });
      return { status: "failed", failure, terminal };
    };
    const nativeErrorWithoutEnvelope = terminal.disposition === "invalid-output" && stdout === "" &&
      Number.isInteger(code) && code !== 0 && terminal.signal === null && stderr.length > 0;
    if (terminal.signal !== null && ["completed", "invalid-output"].includes(terminal.disposition)) {
      return fail("native-signal-exit", terminal.signal);
    }
    if ((terminal.disposition !== "completed" && !nativeErrorWithoutEnvelope) || !terminal.custodyReleased) {
      return fail(terminal.disposition);
    }
    let envelope;
    try { envelope = JSON.parse(stdout); } catch { /* validation below retains diagnostic */ }
    const error = typeof envelope?.result === "string" ? envelope.result
      : Array.isArray(envelope?.errors) && envelope.errors.every(value => typeof value === "string") ? envelope.errors.join("\n")
        : stderr || `exit=${code}`;
    let result;
    let classification;
    if ((code !== 0 || envelope?.is_error) && /response exceeded .* output token maximum/.test(error)) {
      classification = "output-token-limit";
      if (typeof envelope?.session_id !== "string" || !envelope.session_id) return fail(classification, error);
      result = { status: "completed", client, workerId: envelope.session_id, model: payload.route.model,
        effort: payload.route.effort, summary: error, verdict: "INCONCLUSIVE", findings: [], changes: [] };
    } else if (code !== 0 || envelope?.is_error) {
      if (!outage(error)) return fail("native-client-error", error);
      classification = "native-unavailable";
      result = { status: "unavailable", client, model: payload.route.model, effort: payload.route.effort, error };
    } else {
      let structured = envelope.structured_output;
      if (client === "codex") {
        const path = join(executionRoot, "last-message.json");
        assert.ok(statSync(path).isFile() && statSync(path).size <= 1024 * 1024, "Native result exceeds structural limit");
        structured = JSON.parse(readFileSync(path, "utf8"));
      }
      result = workerOutput({ ...structured ?? JSON.parse(envelope.result), status: "completed", client,
        workerId: envelope.session_id, model: payload.route.model, effort: payload.route.effort }, payload.route, payload.files.map(f => f.path));
    }
    const response = { ...identity, result };
    save("response.json", response);
    observation({ type: "native-end", runId: request.runId, requestId: request.requestId, code, status: result.status, verdict: result.verdict,
      classification, workerId: result.workerId, errorSha256: result.error ? sha(result.error) : undefined, response: join(directory, "response.json") });
    return { status: result.status, classification, response, terminal };
  } catch (error) {
    execution.cancel();
    await execution.completion;
    save("validation-error.json", { errorSha256: sha(String(error.message)), classification: "host-validation-error" });
    throw error;
  }
}

// Existing host drivers retain their import while routing through either native client.
export const runOrdinaryClaudeRequest = runOrdinaryNativeRequest;
