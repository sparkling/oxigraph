#!/usr/bin/env node
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import {
  assertNormativeControlContract,
  normativeControlContract,
} from "./contract.mjs";
import { extractCandidates } from "./extract.mjs";
import { loadReviewedMappings, verifyReviewedMappings } from "./mapping.mjs";
import { writeJsonAtomically } from "./output.mjs";
import {
  loadRegisteredDocuments,
  registeredFamilies,
  repositoryRoot,
} from "./registry.mjs";
import { acquireRegisteredSource, readStableFile } from "./stable-source.mjs";

const evidenceRoot = resolve(repositoryRoot, "target/w3c/normative-control");
const sourceRoot = resolve(evidenceRoot, "sources");
const outputPath = resolve(evidenceRoot, "audit.json");

const documents = loadRegisteredDocuments();
const extractions = await mapConcurrent(documents, 4, async (document) => {
  const source = await acquireRegisteredSource(document, {
    cacheRoot: sourceRoot,
    repositoryRoot,
  });
  return {
    document,
    extraction: extractCandidates(document, source.bytes),
    cachePath: relative(repositoryRoot, source.cachePath),
    fetchedUrl: source.fetchedUrl,
  };
});
const mappings = loadReviewedMappings();
const verifiedMappings = verifyReviewedMappings(
  documents,
  extractions,
  mappings,
);
const controlFiles = normativeControlContract.controlPaths.map(bindControlFile);

const candidates = extractions.flatMap(
  ({ extraction }) => extraction.candidates,
);
const totals = {
  documents: documents.length,
  candidates: candidates.length,
  bcp14Blocks: candidates.filter((item) => item.kind === "bcp14-block").length,
  grammarProductions: candidates.filter(
    (item) =>
      item.kind === "grammar-production" || item.kind === "syntax-production",
  ).length,
};
assertNormativeControlContract({ families: registeredFamilies, totals });
const audit = {
  schemaVersion: normativeControlContract.schemaVersion,
  scope: {
    families: normativeControlContract.families,
    registeredDocumentSetEquality: true,
    extraction: normativeControlContract.extraction,
    exclusions: normativeControlContract.exclusions,
    candidateDisposition: normativeControlContract.candidateDisposition,
    clauseEnumerationComplete:
      normativeControlContract.clauseEnumerationComplete,
    conformanceClaim: normativeControlContract.conformanceClaim,
  },
  sourcePolicy: {
    registry: "docs/research/normative-requirements.json",
    exactRegisteredResponseSha256Required: true,
    currentUrlFetchedOnEveryAudit: true,
    descriptorStableControlAndCacheReads: true,
    controlFiles,
  },
  totals,
  documents: extractions.map(
    ({ document, extraction, cachePath, fetchedUrl }) => {
      const verification = verifiedMappings.find(
        (item) => item.documentId === document.id,
      );
      return {
        id: document.id,
        family: document.family,
        applicability: document.applicability,
        registeredUrl: document.url,
        fetchedUrl,
        sourceSha256: document.sha256,
        sourceCache: cachePath,
        sectionCount: extraction.sectionIds.length,
        candidateCount: extraction.candidates.length,
        candidateSetSha256: verification.candidateSetSha256,
      };
    },
  ),
  candidates,
};
audit.auditContentSha256 = sha256(JSON.stringify(audit));
writeJsonAtomically(outputPath, audit, { root: repositoryRoot });
console.log(
  `W3C normative candidate audit PASS: ${documents.length} documents, ${candidates.length} mapped-unassessed candidates`,
);
console.log(relative(repositoryRoot, outputPath));

async function mapConcurrent(values, concurrency, operation) {
  const results = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await operation(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function bindControlFile(path) {
  const bytes = readStableFile(resolve(repositoryRoot, path));
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}
