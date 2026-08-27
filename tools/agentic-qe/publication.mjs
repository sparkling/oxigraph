import { relative, resolve } from "node:path";
import {
  assertDirectorySnapshot,
  captureDirectorySnapshot,
  stableRegularFileBytes,
} from "./file-safety.mjs";
import { portablePath, repoRoot } from "./path-policy.mjs";
import { publicationStructureMatches } from "./receipt-contract.mjs";

export { publicationStructureMatches } from "./receipt-contract.mjs";

const MAX_PUBLICATION_FILE_BYTES = 64 * 1024 * 1024;

function stablePublicationBytes(repositoryRoot, relativePath) {
  const lexical = resolve(repositoryRoot, relativePath);
  if (portablePath(relative(repositoryRoot, lexical)) !== relativePath) {
    throw new Error(`Agentic-QE publication path is invalid: ${relativePath}`);
  }
  return stableRegularFileBytes(lexical, {
    repositoryRoot,
    label: `Agentic-QE publication ${relativePath}`,
    requireSingleLink: true,
    maximumBytes: MAX_PUBLICATION_FILE_BYTES,
  }).bytes;
}

export function readAgenticFileBytes(
  relativePath,
  { repositoryRoot = repoRoot } = {},
) {
  return stablePublicationBytes(repositoryRoot, relativePath);
}

export function readAgenticPublication(
  receipt,
  { repositoryRoot = repoRoot } = {},
) {
  if (!publicationStructureMatches(receipt)) {
    throw new Error("Agentic-QE immutable publication contract is invalid");
  }
  const root = resolve(repositoryRoot, receipt.publication.root);
  const expectedEntries = ["oracle.json", "receipt.json"];
  const before = captureDirectorySnapshot(root, {
    repositoryRoot,
    expectedEntries,
    label: "Agentic-QE immutable publication root",
  });
  const receiptBytes = stablePublicationBytes(
    repositoryRoot,
    receipt.publication.receiptPath,
  );
  assertDirectorySnapshot(before, {
    repositoryRoot,
    expectedEntries,
    label: "Agentic-QE immutable publication root",
    stableMetadata: true,
  });
  const oracleBytes = stablePublicationBytes(
    repositoryRoot,
    receipt.publication.oraclePath,
  );
  assertDirectorySnapshot(before, {
    repositoryRoot,
    expectedEntries,
    label: "Agentic-QE immutable publication root",
    stableMetadata: true,
  });
  return {
    publication: receipt.publication,
    receiptBytes,
    oracleBytes,
  };
}
