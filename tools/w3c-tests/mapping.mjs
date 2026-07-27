import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { registeredFamilies, repositoryRoot } from "./registry.mjs";
import { readStableFile } from "./stable-source.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const MAPPING_FILES = Object.freeze({
  "rdf-1.2": "reviewed-rdf-1.2.json",
  "sparql-1.2": "reviewed-sparql-1.2.json",
});

export function loadReviewedMappings(
  directory = resolve(repositoryRoot, "tools/w3c-tests"),
) {
  const documents = [];
  for (const family of registeredFamilies) {
    const path = resolve(directory, MAPPING_FILES[family]);
    let mapping;
    try {
      mapping = parseStrictJson(readStableFile(path), `${family} mapping`);
    } catch (error) {
      throw new Error(
        `unable to parse reviewed mapping ${family}: ${error.message}`,
        {
          cause: error,
        },
      );
    }
    validateMappingHeader(mapping, family);
    documents.push(...mapping.documents);
  }
  return documents;
}

export function verifyReviewedMappings(documents, extractions, mappings) {
  const documentIds = new Set(documents.map((document) => document.id));
  const extractionById = uniqueMap(
    extractions,
    (item) => item.document.id,
    "extraction",
  );
  const mappingById = uniqueMap(
    mappings,
    (item) => item.documentId,
    "reviewed mapping document",
  );
  assertExactSet(
    documentIds,
    new Set(extractionById.keys()),
    "extraction documents",
  );
  assertExactSet(documentIds, new Set(mappingById.keys()), "mapping documents");

  const verified = [];
  for (const document of documents) {
    const extraction = extractionById.get(document.id).extraction;
    const mapping = mappingById.get(document.id);
    if (
      mapping.family !== document.family ||
      mapping.sourceSha256 !== document.sha256 ||
      extraction.sourceSha256 !== document.sha256
    ) {
      throw new Error(`${document.id} mapping source binding is stale`);
    }
    const actual = uniqueMap(
      extraction.candidates,
      (item) => item.id,
      `${document.id} extracted candidate`,
    );
    if (
      !Number.isSafeInteger(mapping.candidateCount) ||
      mapping.candidateCount < 0 ||
      mapping.candidateCount !== actual.size
    ) {
      throw new Error(`${document.id} candidate mapping count is stale`);
    }
    const actualSetHash = candidateSetHash([...actual.values()]);
    if (mapping.candidateSetSha256 !== actualSetHash) {
      throw new Error(
        `${document.id} candidate mappings are missing, extra, or stale`,
      );
    }
    if (!Array.isArray(mapping.sectionRefs)) {
      throw new Error(`${document.id} mapping sectionRefs must be an array`);
    }
    const mappedSections = new Set(mapping.sectionRefs);
    if (mappedSections.size !== mapping.sectionRefs.length) {
      throw new Error(`${document.id} mapping has duplicate section refs`);
    }
    const actualSections = new Set(
      [...actual.values()].map((candidate) => candidate.sectionRef),
    );
    assertExactSet(
      actualSections,
      mappedSections,
      `${document.id} candidate section refs`,
    );
    const sectionIds = new Set(extraction.sectionIds);
    sectionIds.add("document");
    for (const sectionRef of mappedSections) {
      if (!sectionIds.has(sectionRef)) {
        throw new Error(
          `${document.id} mapping has stale section ref ${sectionRef}`,
        );
      }
    }
    verified.push({
      documentId: document.id,
      sourceSha256: document.sha256,
      candidateCount: actual.size,
      candidateSetSha256: actualSetHash,
    });
  }
  return verified;
}

export function candidateSetHash(candidates) {
  const canonical = candidates
    .map((candidate) => [
      candidate.id,
      candidate.kind,
      candidate.sectionRef,
      candidate.structuralRef,
      candidate.textSha256,
      candidate.bindingSha256,
    ])
    .sort((left, right) => left[0].localeCompare(right[0]));
  return sha256(JSON.stringify(canonical));
}

function validateMappingHeader(mapping, family) {
  if (
    !mapping ||
    mapping.schemaVersion !== 1 ||
    mapping.family !== family ||
    mapping.reviewBoundary !==
      "extraction-topology-only; no implementation or conformance disposition" ||
    mapping.candidateDisposition !== "mapped-unassessed" ||
    !Array.isArray(mapping.documents)
  ) {
    throw new Error(`${family} reviewed mapping header is invalid`);
  }
}

function uniqueMap(values, keyOf, label) {
  const result = new Map();
  for (const value of values) {
    const key = keyOf(value);
    if (typeof key !== "string" || key.length === 0) {
      throw new Error(`${label} has an invalid key`);
    }
    if (result.has(key)) throw new Error(`duplicate ${label}: ${key}`);
    result.set(key, value);
  }
  return result;
}

function assertExactSet(expected, actual, label) {
  const missing = [...expected].filter((value) => !actual.has(value)).sort();
  const extra = [...actual].filter((value) => !expected.has(value)).sort();
  if (missing.length || extra.length) {
    throw new Error(
      `${label} differ: missing=[${missing.join(",")}], extra=[${extra.join(",")}]`,
    );
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
