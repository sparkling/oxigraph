#!/usr/bin/env node
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { extractClauseInventory } from "./clause-extract.mjs";
import { writeJsonAtomically } from "./output.mjs";
import { loadRegisteredDocuments, repositoryRoot } from "./registry.mjs";
import { acquireRegisteredSource } from "./stable-source.mjs";

const evidenceRoot = resolve(repositoryRoot, "target/w3c/normative-control");
const sourceRoot = resolve(evidenceRoot, "sources");
const outputPath = resolve(evidenceRoot, "clause-inventory.json");
const documents = loadRegisteredDocuments();
const extracted = [];

for (const document of documents) {
  const source = await acquireRegisteredSource(document, {
    cacheRoot: sourceRoot,
    repositoryRoot,
  });
  extracted.push({
    document,
    fetchedUrl: source.fetchedUrl,
    extraction: extractClauseInventory(document, source.bytes),
  });
}

const records = extracted.flatMap(({ extraction }) => extraction.records);
const byKind = Object.fromEntries(
  [...new Set(records.map((record) => record.kind))]
    .sort()
    .map((kind) => [
      kind,
      records.filter((record) => record.kind === kind).length,
    ]),
);
const inventory = {
  schemaVersion: 1,
  qualification:
    "Over-inclusive structural review inventory; not a complete normative-clause enumeration or a conformance claim.",
  scope: {
    registeredDocumentSetEquality: true,
    sourceHashesExact: true,
    informativeDocumentsExcluded: true,
    informativeAndExampleAncestryExcluded: true,
    includes:
      "BCP14 sentences, normative prose blocks, definition-list entries, table rows, code blocks, and grammar productions with right-hand sides",
    knownLimitations:
      "Heuristic HTML tokenization and normative-region classification can over- or under-include content; actors and dispositions remain unassessed.",
    clauseEnumerationComplete: false,
    conformanceClaim: "none",
  },
  totals: {
    documents: documents.length,
    records: records.length,
    byKind,
  },
  documents: extracted.map(({ document, fetchedUrl, extraction }) => ({
    id: document.id,
    family: document.family,
    applicability: document.applicability,
    registeredUrl: document.url,
    fetchedUrl,
    sourceSha256: document.sha256,
    sectionCount: extraction.sectionIds.length,
    recordCount: extraction.records.length,
    recordSetSha256: sha256(
      JSON.stringify(extraction.records.map((record) => record.bindingSha256)),
    ),
  })),
  records,
};
inventory.inventoryContentSha256 = sha256(JSON.stringify(inventory));
writeJsonAtomically(outputPath, inventory, { root: repositoryRoot });
console.log(
  `W3C structural clause inventory PASS: ${documents.length} documents, ${records.length} unassessed records`,
);
console.log(relative(repositoryRoot, outputPath));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
