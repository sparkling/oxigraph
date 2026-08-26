import { MUTATION_RECEIPT_SCHEMA_VERSION } from "../mutation/schema.mjs";

const DIGEST = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COUNT_KEYS = Object.freeze([
  "generated",
  "caught",
  "missed",
  "timeout",
  "unviable",
  "viable",
]);
const PROJECTION_KEYS = Object.freeze([
  "receiptSha256",
  "schemaVersion",
  "runId",
  "contentHash",
  "executionHash",
  "inputContentHash",
  "publicationContentHash",
  "nativeOutcomesSha256",
  "configSha256",
  "counts",
  "mutationScorePercent",
]);

function exactOrderedKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(keys)
  );
}

function validCounts(counts) {
  return (
    exactOrderedKeys(counts, COUNT_KEYS) &&
    COUNT_KEYS.every(
      (key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0,
    ) &&
    counts.generated ===
      counts.caught + counts.missed + counts.timeout + counts.unviable &&
    counts.viable === counts.caught + counts.missed + counts.timeout &&
    counts.caught > 0 &&
    counts.missed === 0 &&
    counts.timeout === 0
  );
}

function commonProjectionValid(value, keys) {
  return (
    exactOrderedKeys(value, keys) &&
    value.schemaVersion === MUTATION_RECEIPT_SCHEMA_VERSION &&
    UUID.test(value.runId ?? "") &&
    DIGEST.test(value.contentHash ?? "") &&
    DIGEST.test(value.executionHash ?? "") &&
    DIGEST.test(value.inputContentHash ?? "") &&
    DIGEST.test(value.publicationContentHash ?? "") &&
    DIGEST.test(value.nativeOutcomesSha256 ?? "") &&
    DIGEST.test(value.configSha256 ?? "") &&
    validCounts(value.counts) &&
    value.mutationScorePercent === 100
  );
}

export function mutationProjectionValid(value) {
  return (
    commonProjectionValid(value, PROJECTION_KEYS) &&
    DIGEST.test(value.receiptSha256 ?? "")
  );
}

export function mutationQualificationBindingValid(value) {
  const keys = [
    "valid",
    "error",
    "path",
    "sha256",
    ...PROJECTION_KEYS.slice(1),
  ];
  return (
    commonProjectionValid(value, keys) &&
    value.valid === true &&
    value.error === null &&
    value.path ===
      `target/mutation/oxdatalog/runs/${value.runId}/receipt.json` &&
    DIGEST.test(value.sha256 ?? "")
  );
}

export function mutationProjectionFromQualificationBinding(binding) {
  if (!mutationQualificationBindingValid(binding)) {
    throw new Error("mutation qualification binding is invalid");
  }
  return {
    receiptSha256: binding.sha256,
    schemaVersion: binding.schemaVersion,
    runId: binding.runId,
    contentHash: binding.contentHash,
    executionHash: binding.executionHash,
    inputContentHash: binding.inputContentHash,
    publicationContentHash: binding.publicationContentHash,
    nativeOutcomesSha256: binding.nativeOutcomesSha256,
    configSha256: binding.configSha256,
    counts: binding.counts,
    mutationScorePercent: binding.mutationScorePercent,
  };
}
