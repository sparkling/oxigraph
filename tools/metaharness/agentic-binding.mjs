const profile = "metaharness-semantic-gate";
const hash = (value) => /^[0-9a-f]{64}$/.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value ?? "",
  );
const bindingKeys = [
  "path",
  "sha256",
  "schemaVersion",
  "runId",
  "generatedAt",
  "contentHash",
  "executionHash",
  "oraclePath",
  "oracleSha256",
  "implementationContentHash",
  "artifactContentHash",
  "archiveContentHash",
  "archiveRoot",
  "archiveFileCount",
];
const projectionKeys = [
  "schemaVersion",
  "runId",
  "generatedAt",
  "receiptSha256",
  "oracleSha256",
  "contentHash",
  "executionHash",
  "implementationContentHash",
  "artifactContentHash",
  "archiveContentHash",
];

function canonicalIso(value) {
  const milliseconds = Date.parse(value);
  return (
    typeof value === "string" &&
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

export function agenticQualificationBindingValid(value) {
  const runRoot = `target/agentic-qe/${profile}/runs/${value?.runId}`;
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(bindingKeys) &&
    value.schemaVersion === 4 &&
    uuid(value.runId) &&
    canonicalIso(value.generatedAt) &&
    value.path === `${runRoot}/receipt.json` &&
    value.oraclePath === `${runRoot}/oracle.json` &&
    hash(value.sha256) &&
    hash(value.oracleSha256) &&
    hash(value.contentHash) &&
    hash(value.executionHash) &&
    hash(value.implementationContentHash) &&
    hash(value.artifactContentHash) &&
    hash(value.archiveContentHash) &&
    value.archiveRoot ===
      `target/agentic-qe/${profile}/artifacts/${value.artifactContentHash}` &&
    Number.isSafeInteger(value.archiveFileCount) &&
    value.archiveFileCount > 0
  );
}

export function agenticProjectionValid(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(projectionKeys) &&
    value.schemaVersion === 4 &&
    uuid(value.runId) &&
    canonicalIso(value.generatedAt) &&
    projectionKeys.slice(3).every((key) => hash(value[key]))
  );
}

export function agenticProjectionFromQualificationBinding(binding) {
  if (!agenticQualificationBindingValid(binding)) {
    throw new Error("Agentic-QE qualification binding is invalid");
  }
  return {
    schemaVersion: binding.schemaVersion,
    runId: binding.runId,
    generatedAt: binding.generatedAt,
    receiptSha256: binding.sha256,
    oracleSha256: binding.oracleSha256,
    contentHash: binding.contentHash,
    executionHash: binding.executionHash,
    implementationContentHash: binding.implementationContentHash,
    artifactContentHash: binding.artifactContentHash,
    archiveContentHash: binding.archiveContentHash,
  };
}
