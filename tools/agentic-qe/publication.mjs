import { relative, resolve } from "node:path";
import {
  assertDirectorySnapshot,
  captureDirectorySnapshot,
  stableRegularFileBytes,
} from "./file-safety.mjs";
import { portablePath, repoRoot } from "./path-policy.mjs";

function expectedPublication(receipt) {
  const root = `target/agentic-qe/${receipt.profile}/runs/${receipt.runId}`;
  return {
    schemaVersion: 1,
    immutable: true,
    root,
    receiptPath: `${root}/receipt.json`,
    oraclePath: `${root}/oracle.json`,
  };
}

export function publicationStructureMatches(receipt) {
  const expected = expectedPublication(receipt);
  return (
    receipt?.publication?.schemaVersion === expected.schemaVersion &&
    receipt.publication.immutable === true &&
    receipt.publication.root === expected.root &&
    receipt.publication.receiptPath === expected.receiptPath &&
    receipt.publication.oraclePath === expected.oraclePath
  );
}

function stablePublicationBytes(repositoryRoot, relativePath) {
  const lexical = resolve(repositoryRoot, relativePath);
  if (portablePath(relative(repositoryRoot, lexical)) !== relativePath) {
    throw new Error(`Agentic-QE publication path is invalid: ${relativePath}`);
  }
  return stableRegularFileBytes(lexical, {
    repositoryRoot,
    label: `Agentic-QE publication ${relativePath}`,
    requireSingleLink: true,
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
