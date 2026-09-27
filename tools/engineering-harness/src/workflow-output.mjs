const text = (value) => typeof value === "string" && value.trim().length > 0;
export class NativeHostUnavailable extends Error {
  constructor(result) {
    super(`${result.client}; model=${result.model}; ${result.error}`);
    this.name = "NativeHostUnavailable";
  }
}

/** One boundary for native and completed API packets, before root mutation. */
export function workerOutput(result, route, paths) {
  const keys = ["status", "client", "workerId", "model", "effort", "error", "summary", "verdict", "findings", "changes", "contributors", "apiEvidence"];
  if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).some((key) => !keys.includes(key))) throw new Error("Invalid worker result");
  if (!text(result.client) || result.model !== route.model || result.effort !== route.effort) throw new Error("Native route/result mismatch");
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new Error("Native result exceeds structural limit");
  if (result.status === "unavailable" && text(result.error)) throw new NativeHostUnavailable(result);
  if (result.status !== "completed" || !text(result.workerId) || !text(result.summary) ||
      !["ACCEPT", "REJECT", "INCONCLUSIVE"].includes(result.verdict) || !Array.isArray(result.findings) ||
      result.findings.length > 32 || result.findings.some((finding) => !text(finding) || finding.length > 2048) ||
      !Array.isArray(result.changes) || result.changes.length > 16 ||
      (result.verdict === "ACCEPT" && result.findings.length > 0) ||
      (result.verdict === "REJECT" && result.findings.length === 0)) throw new Error("Incomplete or unbounded native result");
  if (route.role === "review" && result.changes.length) throw new Error("Reviewer must not propose source changes");
  const seen = new Set();
  for (const change of result.changes) {
    if (!change || typeof change !== "object" || Array.isArray(change) ||
        Object.keys(change).some((key) => !["path", "content"].includes(key)) ||
        !paths.includes(change.path) || seen.has(change.path) || typeof change.content !== "string" ||
        Buffer.byteLength(change.content) > 512 * 1024) throw new Error("Proposed change leaves the bounded source scope");
    seen.add(change.path);
  }
  if (result.contributors !== undefined && (!Array.isArray(result.contributors) || result.contributors.length !== 0)) {
    throw new Error("Active native contributors are disabled; contributors must be omitted or empty");
  }
  return result;
}
