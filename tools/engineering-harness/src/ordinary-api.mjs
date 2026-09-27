// Ordinary engineering transport only; never used by frozen qualification.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workerOutput } from "./workflow-output.mjs";

export const apiDefaults = Object.freeze({
  model: "deepseek/deepseek-v4.1-flash", maxRequestUsd: 1, maxTotalUsd: null,
  resolvedModels: Object.freeze(["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash-20260910"]),
  maxOutputTokens: 131072, timeoutMs: 1800000, maxResponseBytes: 2000000,
  promptPrice: 0.5, completionPrice: 2,
});
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class OrdinaryApiFailure extends Error {
  constructor(code, evidence) { super(code); this.name = "OrdinaryApiFailure"; this.code = code; this.evidence = evidence; }
}

export function renderOrdinaryPrompt(request) {
  const p = request.payload;
  const review = p.route.role === "review";
  return JSON.stringify({
    mode: review ? "independent-review" : "implementation", toolsAvailable: false,
    taskId: request.taskId, sourceSha256: request.sourceSha256,
    goal: p.goal, completionCheck: p.completionCheck, files: p.files,
    ...(review ? { initialFiles: p.initialFiles, checks: p.checks }
      : { feedback: p.feedback }),
    instructions: review
      ? "Review current admitted source and deterministic results independently. Return an actual JSON verdict, not a schema. ACCEPT requires findings=[]; REJECT requires actionable findings. changes must be []."
      : "Propose full UTF-8 contents only for admitted files. No tools, file writes or tests are available. Return an actual JSON result, not a schema.",
    response: { summary: "string", verdict: "ACCEPT|REJECT|INCONCLUSIVE", findings: ["string"], changes: [{ path: "admitted path", content: "complete UTF-8 source" }] },
  });
}

async function boundedJson(response, maximum) {
  if (!response.body) throw new Error("Missing response body");
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) throw new Error("API response exceeds structural limit");
      chunks.push(Buffer.from(chunk.value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Durable reservation precedes network I/O. Unknown completion remains held. */
export function createOrdinaryApi({ directory, fetchImpl = fetch, apiKey = () => process.env.OPENROUTER_API_KEY,
  policy = {}, signal, observation = () => {} }) {
  const settings = { ...apiDefaults, ...policy };
  if (settings.model !== apiDefaults.model || settings.maxRequestUsd !== 1 || settings.maxTotalUsd !== null ||
      !Array.isArray(settings.resolvedModels) || !settings.resolvedModels.length ||
      settings.resolvedModels.some((model) => !apiDefaults.resolvedModels.includes(model)) ||
      !["maxOutputTokens", "timeoutMs", "maxResponseBytes"].every((key) => Number.isSafeInteger(settings[key]) && settings[key] > 0) ||
      !["promptPrice", "completionPrice"].every((key) => Number.isFinite(settings[key]) && settings[key] > 0) ||
      settings.promptPrice > 0.5 || settings.completionPrice > 2) throw new Error("Invalid ordinary API policy");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const emit = (phase, requestId) => { try { observation({ phase, requestId }); } catch {} };
  return async (request) => {
    if (signal?.aborted) throw new OrdinaryApiFailure("cancelled-before-dispatch", {});
    const unknownPath = join(directory, "unknown-charge.json");
    if (existsSync(unknownPath)) throw new OrdinaryApiFailure("completion-unknown", JSON.parse(readFileSync(unknownPath, "utf8")));
    const prompt = renderOrdinaryPrompt(request);
    // UTF-8 bytes conservatively bound token count, including JSON framing overhead.
    const inputTokenBound = Buffer.byteLength(prompt) + 4096;
    const maximumUsd = (inputTokenBound * settings.promptPrice + settings.maxOutputTokens * settings.completionPrice) / 1e6;
    if (!Number.isFinite(maximumUsd) || maximumUsd > settings.maxRequestUsd) throw new OrdinaryApiFailure("request-cost-bound", { maximumUsd });
    const key = apiKey();
    if (typeof key !== "string" || !key.trim()) throw new OrdinaryApiFailure("api-key-unavailable", {});
    const policyDigest = hash(settings);
    const taskScope = hash({ task: request.specSha256, policyDigest, packet: request.payload.route.role });
    const holdPath = join(directory, `hold-${taskScope}.json`);
    try {
      const hold = JSON.parse(readFileSync(holdPath, "utf8"));
      throw new OrdinaryApiFailure(hold.status === "completed-invalid-output" ? "task-output-held" : "completion-unknown", hold);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const reservation = hash({ taskScope, prompt, runId: request.runId, requestId: request.requestId });
    const path = join(directory, `request-${reservation}.json`);
    const evidence = { schema: 1, requestId: randomUUID(), reservation, taskScope, policyDigest,
      taskId: request.taskId, model: settings.model, maximumUsd, status: "reserved", actualUsd: null };
    try { writeFileSync(path, JSON.stringify(evidence), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code === "EEXIST") throw new OrdinaryApiFailure("request-replay-refused", { reservation }); throw error; }
    const save = () => writeFileSync(path, JSON.stringify(evidence), { mode: 0o600 });
    const hold = () => {
      try { writeFileSync(holdPath, JSON.stringify(evidence), { flag: "wx", mode: 0o600 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
    };
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("API timeout")), settings.timeoutMs);
    let body;
    emit("api-start", evidence.requestId);
    try {
      if (signal?.aborted) {
        evidence.status = "cancelled-before-dispatch"; evidence.actualUsd = 0; save();
        throw new OrdinaryApiFailure("cancelled-before-dispatch", evidence);
      }
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: settings.model, messages: [{ role: "user", content: prompt }],
          max_tokens: settings.maxOutputTokens, reasoning: { effort: "high", exclude: true },
          provider: { max_price: { prompt: settings.promptPrice, completion: settings.completionPrice }, require_parameters: true },
          response_format: { type: "json_object" }, stream: false }),
      });
      body = await boundedJson(response, settings.maxResponseBytes);
      const refused = body?.error?.code === response.status && !body.id && !body.choices && !body.usage;
      if ([401, 403].includes(response.status) && refused) {
        evidence.status = "authentication-rejected"; evidence.actualUsd = 0; save();
        throw new OrdinaryApiFailure("authentication-rejected", evidence);
      }
      if (response.status === 402 && refused) {
        evidence.status = "confirmed-credit-rejection"; evidence.actualUsd = 0; save();
        throw new OrdinaryApiFailure("confirmed-credit-rejection", evidence);
      }
      if (typeof body?.id === "string" && body.id) evidence.providerRequestId = body.id;
      if (Number.isFinite(body?.usage?.cost) && body.usage.cost >= 0) evidence.actualUsd = body.usage.cost;
      if (!response.ok || !evidence.providerRequestId || evidence.actualUsd === null) throw new Error("Unconfirmed completion accounting");
      evidence.resolvedModel = body.model;
      evidence.status = "completed"; save();
      if (!settings.resolvedModels.includes(body.model)) {
        evidence.status = "completed-model-mismatch"; save();
        throw new OrdinaryApiFailure("completed-model-mismatch", evidence);
      }
      let result;
      try {
        result = JSON.parse(body.choices?.[0]?.message?.content);
        if (body.choices?.[0]?.finish_reason !== "stop" || !result || typeof result !== "object" || Array.isArray(result) ||
            Object.keys(result).some((k) => !["summary", "verdict", "findings", "changes"].includes(k)) ||
            typeof result.summary !== "string" || !result.summary.trim() ||
            !["ACCEPT", "REJECT", "INCONCLUSIVE"].includes(result.verdict) ||
            !Array.isArray(result.findings) || result.findings.length > 32 ||
            result.findings.some((v) => typeof v !== "string" || !v.trim() || v.length > 2048) ||
            (result.verdict === "ACCEPT" && result.findings.length !== 0) ||
            (result.verdict === "REJECT" && result.findings.length === 0) ||
            !Array.isArray(result.changes) || result.changes.length > 16 ||
            (request.payload.route.role === "review" && result.changes.length > 0)) throw new Error("Invalid result");
        workerOutput({ ...result, status: "completed", client: "openrouter-direct", workerId: body.id,
          model: settings.model, effort: "high" }, request.payload.route, request.payload.files.map((file) => file.path));
      } catch {
        evidence.status = "completed-invalid-output"; save(); hold();
        throw new OrdinaryApiFailure("completed-invalid-output", evidence);
      }
      emit("api-complete", evidence.requestId);
      return { result: { ...result, status: "completed", client: "openrouter-direct", workerId: body.id,
        model: settings.model, effort: "high", apiEvidence: { ...evidence, path, sha256: hash(evidence) } }, evidence };
    } catch (error) {
      if (error instanceof OrdinaryApiFailure) throw error;
      evidence.status = "completion-unknown"; save(); hold();
      try { writeFileSync(unknownPath, JSON.stringify(evidence), { flag: "wx", mode: 0o600 }); }
      catch (writeError) { if (writeError.code !== "EEXIST") throw writeError; }
      throw new OrdinaryApiFailure("completion-unknown", evidence);
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      emit("api-settled", evidence.requestId);
    }
  };
}

/** Decorates the existing host callback; root application and MCP stay host-owned. */
export function withOrdinaryApi(host, invokeApi) {
  return async (request) => {
    if (request.action !== "native-worker" || request.payload.route.transport !== "openrouter-api") return host(request);
    const { result } = await invokeApi(request);
    const { action, payload, ...identity } = request;
    return { ...identity, result };
  };
}
