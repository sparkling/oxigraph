import { createHash } from "node:crypto";
import {
  readMutationFileBytes,
  snapshotProtectedInputs,
  validateMutationPublication,
} from "../mutation/evidence.mjs";
import {
  mutationProjectionValid,
  mutationQualificationBindingValid,
} from "./mutation-contract.mjs";

export {
  mutationProjectionFromQualificationBinding,
  mutationProjectionValid,
  mutationQualificationBindingValid,
} from "./mutation-contract.mjs";

const latestReceipt = "target/mutation/oxdatalog/receipt.json";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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
