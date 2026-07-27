import { createHash } from "node:crypto";
import {
  EXPECTED_CARGO_MUTANTS_VERSION,
  MUTATION_RECEIPT_SCHEMA_VERSION,
  readMutationFileBytes,
  snapshotProtectedInputs,
  validateMutationPublication,
} from "../mutation/evidence.mjs";

const latestReceipt = "target/mutation/oxdatalog/receipt.json";
const hash = (value) => /^[0-9a-f]{64}$/.test(value ?? "");
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value ?? "",
  );
const countKeys = ["generated", "caught", "missed", "timeout", "unviable", "viable"];
const projectionKeys = [
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
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validCounts(counts) {
  return (
    counts !== null &&
    typeof counts === "object" &&
    !Array.isArray(counts) &&
    JSON.stringify(Object.keys(counts)) === JSON.stringify(countKeys) &&
    countKeys.every(
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
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(keys) &&
    value.schemaVersion === MUTATION_RECEIPT_SCHEMA_VERSION &&
    uuid(value.runId) &&
    hash(value.contentHash) &&
    hash(value.executionHash) &&
    hash(value.inputContentHash) &&
    hash(value.publicationContentHash) &&
    hash(value.nativeOutcomesSha256) &&
    hash(value.configSha256) &&
    validCounts(value.counts) &&
    value.mutationScorePercent === 100
  );
}

export function mutationProjectionValid(value) {
  return (
    commonProjectionValid(value, projectionKeys) &&
    hash(value.receiptSha256)
  );
}

export function mutationQualificationBindingValid(value) {
  const keys = [
    "valid",
    "error",
    "path",
    "sha256",
    ...projectionKeys.slice(1),
  ];
  return (
    commonProjectionValid(value, keys) &&
    value.valid === true &&
    value.error === null &&
    value.path ===
      `target/mutation/oxdatalog/runs/${value.runId}/receipt.json` &&
    hash(value.sha256)
  );
}

function parseReceipt(bytes) {
  try {
    return JSON.parse(bytes);
  } catch {
    throw new Error("mutation receipt is not valid JSON");
  }
}

function projection(receipt, publication, inputContentHash) {
  return {
    receiptSha256: sha256(publication.receiptBytes),
    schemaVersion: receipt.schemaVersion,
    runId: receipt.runId,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    inputContentHash,
    publicationContentHash: receipt.publication.contentHash,
    nativeOutcomesSha256: receipt.evidence.nativeOutcomesSha256,
    configSha256: receipt.evidence.configSha256,
    counts: receipt.counts,
    mutationScorePercent: receipt.mutationScorePercent,
  };
}

function qualificationBinding(receipt, verified) {
  return {
    valid: true,
    error: null,
    path: receipt.publication.receiptPath,
    sha256: verified.receiptSha256,
    schemaVersion: verified.schemaVersion,
    runId: verified.runId,
    contentHash: verified.contentHash,
    executionHash: verified.executionHash,
    inputContentHash: verified.inputContentHash,
    publicationContentHash: verified.publicationContentHash,
    nativeOutcomesSha256: verified.nativeOutcomesSha256,
    configSha256: verified.configSha256,
    counts: verified.counts,
    mutationScorePercent: verified.mutationScorePercent,
  };
}

function loadPublication(repositoryRoot, relativePath) {
  const sourceBytes = readMutationFileBytes(relativePath, { repositoryRoot });
  const receipt = parseReceipt(sourceBytes);
  const current = snapshotProtectedInputs(repositoryRoot);
  const publication = validateMutationPublication(receipt, {
    repositoryRoot,
    currentContentHash: current.contentHash,
    expectedVersion: EXPECTED_CARGO_MUTANTS_VERSION,
  });
  if (!publication.receiptBytes.equals(sourceBytes)) {
    throw new Error("mutation receipt differs from its immutable publication");
  }
  return {
    receipt,
    publication,
    verified: projection(receipt, publication, current.contentHash),
  };
}

export function currentMutationQualification(repositoryRoot) {
  try {
    const loaded = loadPublication(repositoryRoot, latestReceipt);
    return qualificationBinding(loaded.receipt, loaded.verified);
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function loadBoundMutationQualification(repositoryRoot, binding) {
  if (!mutationQualificationBindingValid(binding)) {
    throw new Error("mutation qualification binding is invalid");
  }
  const loaded = loadPublication(repositoryRoot, binding.path);
  const expected = qualificationBinding(loaded.receipt, loaded.verified);
  if (JSON.stringify(binding) !== JSON.stringify(expected)) {
    throw new Error("mutation qualification binding is inconsistent");
  }
  return { receipt: loaded.receipt, verified: loaded.verified };
}

export function verifyMutationQualification(repositoryRoot, binding) {
  return loadBoundMutationQualification(repositoryRoot, binding).verified;
}
