export const WORKER_ROLES = Object.freeze([
  "architecture",
  "critique",
  "implementation",
  "review",
  "repair",
]);

export function validateWorkerRole(role) {
  if (!WORKER_ROLES.includes(role)) {
    throw new Error(`unsupported worker role: ${role}`);
  }
  return role;
}

export function validateWorkerOutput(output, role) {
  validateWorkerRole(role);
  if (output === null || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("worker output must be an object");
  }
  const allowed = new Set(["summary", "patch", "findings", "verdict"]);
  for (const key of Object.keys(output)) {
    if (!allowed.has(key)) throw new Error(`worker output has unknown field: ${key}`);
  }
  if (typeof output.summary !== "string" || output.summary.length > 4096) {
    throw new Error("worker summary is invalid");
  }
  if (
    output.patch !== null &&
    (typeof output.patch !== "string" || Buffer.byteLength(output.patch) > 262_144)
  ) {
    throw new Error("worker patch is invalid");
  }
  if (
    !Array.isArray(output.findings) ||
    output.findings.length > 128 ||
    output.findings.some((finding) => typeof finding !== "string" || finding.length > 2048)
  ) {
    throw new Error("worker findings are invalid");
  }
  if (!["ACCEPT", "REJECT", "INCONCLUSIVE"].includes(output.verdict)) {
    throw new Error("worker verdict is invalid");
  }
  if (["architecture", "critique", "review"].includes(role) && output.patch !== null) {
    throw new Error(`${role} workers may not propose a patch`);
  }
  if (["implementation", "repair"].includes(role) && output.patch === null) {
    throw new Error(`${role} workers must return a patch`);
  }
  return Object.freeze({
    summary: output.summary,
    patch: output.patch,
    findings: Object.freeze([...output.findings]),
    verdict: output.verdict,
  });
}
