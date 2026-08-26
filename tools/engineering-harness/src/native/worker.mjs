import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeInvocation } from "./claude.mjs";
import { codexInvocation } from "./codex.mjs";
import { runBoundedProcess } from "./process.mjs";
import {
  validateWorkerOutput,
  validateWorkerRole,
} from "../policy/authority.mjs";
import { NATIVE_FAILURE_CODES } from "../policy/native-failures.mjs";
import { nativeWorkerTimeoutCeilingMs } from "../policy/native-timeouts.mjs";
import {
  canonicalizeCandidatePatch,
  validateCandidatePatch,
  validateCandidatePatchSize,
} from "../policy/paths.mjs";

const MAX_TASK_BYTES = 2_097_152;
const MAX_OUTPUT_BYTES = 1_048_576;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nativeFailure(code, detail, retryable) {
  if (!NATIVE_FAILURE_CODES.includes(code)) {
    throw new Error(`unknown native failure code: ${code}`);
  }
  return Object.freeze({
    code,
    detailSha256: sha256(
      JSON.stringify({
        code,
        detail: detail instanceof Error ? detail.message : detail,
      }),
    ),
    retryable,
  });
}

function inconclusiveResult({ provider, model, role, outcome, invocation, failure }) {
  return Object.freeze({
    provider,
    model,
    role,
    status: "INCONCLUSIVE",
    outcome,
    invocation,
    failure,
  });
}

function cancellationError() {
  const error = new Error("native worker cancelled before spawn");
  error.code = "OXIGRAPH_CANCELLED";
  return error;
}

function promptFor({ role, encodedTask }) {
  const lines = [
    "You are a bounded Oxigraph engineering worker.",
    `Role: ${role}.`,
    "You have no local tools. Inspect only the allowlisted source snapshot embedded in this task. Do not publish, push, deploy, request external access, or alter evaluators and governance inputs.",
    "Return only the requested structured object. Implementation and repair roles return a unified diff in patch; all other roles return patch=null.",
  ];
  if (["implementation", "repair"].includes(role)) {
    lines.push(
      "The patch string must be an exact git unified diff: begin each file with `diff --git a/<path> b/<path>`, then exact `--- a/<path>` and `+++ b/<path>` headers, followed by one or more standard `@@ -oldStart,oldCount +newStart,newCount @@` hunks.",
      "Every line inside a hunk must begin with exactly one context (` `), deletion (`-`), or addition (`+`) marker. A blank context line is one space, never an empty line. Hunk old/new counts must mechanically equal the marked lines that follow.",
      "Do not wrap the patch in Markdown fences, add prose or `*** Begin Patch` markers, use timestamps, elide unchanged hunk lines, or include a trailing unmarked blank line before another hunk/file.",
    );
  }
  lines.push("Task contract:", encodedTask);
  return lines.join("\n");
}

function decodeClaude(stdout) {
  const decoded = JSON.parse(stdout);
  // Claude Code 2.1.x may serialize the complete stream as a JSON array even
  // when --output-format json is requested. Only the unique terminal result
  // envelope has application authority; lifecycle and assistant events are
  // deliberately ignored.
  const envelope = Array.isArray(decoded)
    ? (() => {
        if (decoded.length === 0 || decoded.length > 4096) {
          throw new Error("Claude event envelope is empty or exceeds its bound");
        }
        const terminal = decoded.filter((item) => item?.type === "result");
        if (terminal.length !== 1 || terminal[0] !== decoded.at(-1)) {
          throw new Error("Claude event envelope lacks a unique terminal result");
        }
        return terminal[0];
      })()
    : decoded;
  if (envelope === null || typeof envelope !== "object") {
    throw new Error("Claude result envelope must be an object");
  }
  if (envelope.structured_output !== undefined) return envelope.structured_output;
  if (envelope.result !== undefined && typeof envelope.result === "object") {
    return envelope.result;
  }
  if (typeof envelope.result === "string") return JSON.parse(envelope.result);
  return envelope;
}

export async function runNativeWorker({
  provider,
  role,
  model,
  task,
  contract,
  timeoutMs = 120_000,
  maxOutputBytes = 1_048_576,
  signal,
  processRunner = runBoundedProcess,
}) {
  if (signal?.aborted) throw cancellationError();
  if (provider !== "codex" && provider !== "claude") {
    throw new Error(`unsupported native provider: ${provider}`);
  }
  validateWorkerRole(role);
  if (typeof model !== "string" || model.length === 0 || model.length > 256) {
    throw new Error("native worker model is invalid");
  }
  let encodedTask;
  try {
    encodedTask = JSON.stringify(task);
  } catch {
    throw new Error("native worker task must be JSON-serializable");
  }
  if (
    task === null ||
    typeof task !== "object" ||
    Array.isArray(task) ||
    typeof encodedTask !== "string" ||
    Buffer.byteLength(encodedTask) > MAX_TASK_BYTES
  ) {
    throw new Error(`native worker task exceeds the ${MAX_TASK_BYTES}-byte structural ceiling`);
  }
  const timeoutCeilingMs = nativeWorkerTimeoutCeilingMs(role);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > timeoutCeilingMs
  ) {
    throw new Error(
      `native worker timeout must be within 1..${timeoutCeilingMs} ms for ${role}`,
    );
  }
  if (
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes <= 0 ||
    maxOutputBytes > MAX_OUTPUT_BYTES
  ) {
    throw new Error(`native worker output ceiling must be within 1..${MAX_OUTPUT_BYTES} bytes`);
  }
  if (["implementation", "repair"].includes(role) && contract === undefined) {
    throw new Error(`${role} workers require a trusted path contract`);
  }
  const outputRoot = await mkdtemp(join(tmpdir(), "oxigraph-worker-"));
  try {
    const outputPath = join(outputRoot, "last-message.json");
    const prompt = promptFor({ role, encodedTask });
    const invocation =
      provider === "codex"
        ? codexInvocation({ executionRoot: outputRoot, model, prompt })
        : claudeInvocation({ executionRoot: outputRoot, model, prompt });
    const invocationEvidence = Object.freeze({
      executable: invocation.executable,
      args: invocation.args,
      attestation: invocation.attestation,
      taskSha256: sha256(Buffer.from(encodedTask, "utf8")),
      promptSha256: sha256(Buffer.from(invocation.stdin, "utf8")),
    });
    const outcome = await processRunner({
      ...invocation,
      timeoutMs,
      maxOutputBytes,
      signal,
    });
    if (outcome.disposition !== "completed" || outcome.exitCode !== 0) {
      return inconclusiveResult({
        provider,
        model,
        role,
        outcome,
        invocation: invocationEvidence,
        failure: nativeFailure(
          outcome.disposition === "completed"
            ? "process-nonzero"
            : "process-incomplete",
          {
            disposition: outcome.disposition,
            exitCode: outcome.exitCode,
            signal: outcome.signal,
          },
          true,
        ),
      });
    }
    let untrustedOutput;
    if (provider === "codex") {
      let raw;
      try {
        raw = await readFile(outputPath, "utf8");
      } catch (error) {
        return inconclusiveResult({
          provider,
          model,
          role,
          outcome,
          invocation: invocationEvidence,
          failure: nativeFailure("output-missing", error, false),
        });
      }
      try {
        untrustedOutput = JSON.parse(raw);
      } catch (error) {
        return inconclusiveResult({
          provider,
          model,
          role,
          outcome,
          invocation: invocationEvidence,
          failure: nativeFailure("worker-json-invalid", error, false),
        });
      }
    } else {
      try {
        untrustedOutput = decodeClaude(outcome.stdout);
      } catch (error) {
        return inconclusiveResult({
          provider,
          model,
          role,
          outcome,
          invocation: invocationEvidence,
          failure: nativeFailure("provider-envelope-invalid", error, false),
        });
      }
    }
    let output;
    try {
      output = validateWorkerOutput(untrustedOutput, role);
    } catch (error) {
      return inconclusiveResult({
        provider,
        model,
        role,
        outcome,
        invocation: invocationEvidence,
        failure: nativeFailure("role-contract-invalid", error, false),
      });
    }
    if (output.patch !== null) {
      try {
        validateCandidatePatchSize(output.patch, contract);
        const canonicalPatch = canonicalizeCandidatePatch(output.patch);
        validateCandidatePatch(canonicalPatch, contract);
        output = Object.freeze({ ...output, patch: canonicalPatch });
      } catch (error) {
        return inconclusiveResult({
          provider,
          model,
          role,
          outcome,
          invocation: invocationEvidence,
          failure: nativeFailure("patch-policy-invalid", error, false),
        });
      }
    }
    return Object.freeze({
      provider,
      model,
      role,
      status: output.verdict,
      output,
      outcome,
      invocation: invocationEvidence,
      ...(output.verdict === "INCONCLUSIVE"
        ? { failure: nativeFailure("worker-declined", output.summary, false) }
        : {}),
    });
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
}
