import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { extractClauseInventory } from "../w3c-tests/clause-extract.mjs";
import { isReviewedW3cUrl, readStableFile } from "../w3c-tests/stable-source.mjs";
import { parseStrictJson } from "../w3c-tests/strict-json.mjs";
import { validateNormativeControlSource } from "./normative-control.mjs";

const MAX_INVENTORY_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/;
const QUALIFICATION =
  "Over-inclusive structural review inventory; not a complete normative-clause enumeration or a conformance claim.";
const INCLUDES =
  "BCP14 sentences, normative prose blocks, definition-list entries, table rows, code blocks, and grammar productions with right-hand sides";
const LIMITATIONS =
  "Heuristic HTML tokenization and normative-region classification can over- or under-include content; actors and dispositions remain unassessed.";
const KINDS = new Set([
  "bcp14-clause",
  "grammar-production",
  "normative-code-block",
  "normative-definition",
  "normative-prose-block",
  "normative-table-row",
]);
const BCP14 = new Set([
  "MUST NOT",
  "SHALL NOT",
  "SHOULD NOT",
  "NOT RECOMMENDED",
  "MUST",
  "SHALL",
  "SHOULD",
  "RECOMMENDED",
  "MAY",
  "OPTIONAL",
  "REQUIRED",
]);

export function validateNormativeClauseInventoryBytes(
  bytes,
  {
    root,
    source = undefined,
    readSourceBytes = undefined,
  } = {},
) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length === 0 ||
    bytes.length > MAX_INVENTORY_BYTES
  ) {
    throw new Error("W3C structural clause inventory byte count is invalid");
  }
  const inventory = parseStrictJson(
    Buffer.from(bytes),
    "W3C structural clause inventory",
  );
  validateNormativeClauseInventory(inventory, {
    root,
    source: source ?? validateNormativeControlSource(root),
    readSourceBytes,
  });
  return inventory;
}

export function validateNormativeClauseInventory(
  inventory,
  { root, source, readSourceBytes = undefined } = {},
) {
  exactKeys(
    inventory,
    [
      "schemaVersion",
      "qualification",
      "scope",
      "totals",
      "documents",
      "records",
      "inventoryContentSha256",
    ],
    "W3C structural clause inventory",
  );
  if (inventory.schemaVersion !== 1 || inventory.qualification !== QUALIFICATION) {
    throw new Error("W3C structural clause inventory qualification is invalid");
  }
  validateScope(inventory.scope);

  const registered = validateRegisteredSource(source);
  const loader =
    readSourceBytes ??
    ((document) => readCachedSource(root, document));
  if (typeof loader !== "function") {
    throw new Error("W3C structural clause source reader is invalid");
  }
  const extractions = new Map();
  for (const document of registered) {
    const bytes = loader(document);
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.length === 0 ||
      bytes.length > MAX_SOURCE_BYTES
    ) {
      throw new Error(`${document.id} clause source byte count is invalid`);
    }
    extractions.set(
      document.id,
      extractClauseInventory(document, Buffer.from(bytes)),
    );
  }

  const documentById = validateDocuments(
    inventory.documents,
    registered,
    extractions,
  );
  const expectedRecords = registered.flatMap(
    (document) => extractions.get(document.id).records,
  );
  validateRecords(inventory.records, expectedRecords, documentById);
  validateTotals(inventory.totals, registered.length, inventory.records);

  const { inventoryContentSha256, ...content } = inventory;
  if (
    !SHA256.test(inventoryContentSha256 ?? "") ||
    inventoryContentSha256 !== sha256(JSON.stringify(content))
  ) {
    throw new Error("W3C structural clause inventory content hash is invalid");
  }
  return inventory;
}

function validateScope(scope) {
  exactKeys(
    scope,
    [
      "registeredDocumentSetEquality",
      "sourceHashesExact",
      "informativeDocumentsExcluded",
      "informativeAndExampleAncestryExcluded",
      "includes",
      "knownLimitations",
      "clauseEnumerationComplete",
      "conformanceClaim",
    ],
    "W3C structural clause inventory scope",
  );
  if (
    scope.registeredDocumentSetEquality !== true ||
    scope.sourceHashesExact !== true ||
    scope.informativeDocumentsExcluded !== true ||
    scope.informativeAndExampleAncestryExcluded !== true ||
    scope.includes !== INCLUDES ||
    scope.knownLimitations !== LIMITATIONS ||
    scope.clauseEnumerationComplete !== false ||
    scope.conformanceClaim !== "none"
  ) {
    throw new Error("W3C structural clause inventory scope overstates its claim");
  }
}

function validateRegisteredSource(source) {
  if (!source || !Array.isArray(source.documents)) {
    throw new Error("W3C structural clause registered source is invalid");
  }
  const seen = new Set();
  for (const document of source.documents) {
    if (
      !document ||
      typeof document !== "object" ||
      !/^[a-z0-9-]+$/.test(document.id ?? "") ||
      seen.has(document.id) ||
      !["rdf-1.2", "sparql-1.2"].includes(document.family) ||
      ![
        "applicable",
        "informative",
        "separate-surface",
        "optional-surface",
      ].includes(document.applicability) ||
      !isReviewedW3cUrl(document.url) ||
      !SHA256.test(document.sha256 ?? "")
    ) {
      throw new Error("W3C structural clause registered document is invalid");
    }
    seen.add(document.id);
  }
  return source.documents;
}

function validateDocuments(documents, registered, extractions) {
  if (!Array.isArray(documents) || documents.length !== registered.length) {
    throw new Error("W3C structural clause document count is invalid");
  }
  exactOrder(
    documents.map((item) => item?.id),
    registered.map((item) => item.id),
    "W3C structural clause document order",
  );
  const result = new Map();
  for (const [index, item] of documents.entries()) {
    exactKeys(
      item,
      [
        "id",
        "family",
        "applicability",
        "registeredUrl",
        "fetchedUrl",
        "sourceSha256",
        "sectionCount",
        "recordCount",
        "recordSetSha256",
      ],
      `${item.id} structural clause document`,
    );
    const expected = registered[index];
    const extraction = extractions.get(expected.id);
    const bindings = extraction.records.map((record) => record.bindingSha256);
    if (
      item.family !== expected.family ||
      item.applicability !== expected.applicability ||
      item.registeredUrl !== expected.url ||
      !isReviewedW3cUrl(item.fetchedUrl) ||
      item.sourceSha256 !== expected.sha256 ||
      item.sectionCount !== extraction.sectionIds.length ||
      item.recordCount !== extraction.records.length ||
      item.recordSetSha256 !== sha256(JSON.stringify(bindings))
    ) {
      throw new Error(`${expected.id} structural clause document binding is invalid`);
    }
    result.set(item.id, item);
  }
  return result;
}

function validateRecords(records, expectedRecords, documentById) {
  if (!Array.isArray(records) || records.length !== expectedRecords.length) {
    throw new Error("W3C structural clause record count is invalid");
  }
  const seen = new Set();
  for (const record of records) {
    exactKeys(
      record,
      [
        "id",
        "documentId",
        "family",
        "documentApplicability",
        "kind",
        "sectionRef",
        "structuralRef",
        "keywords",
        "actor",
        "disposition",
        "textSha256",
        "sourceSha256",
        "excerpt",
        "bindingSha256",
      ],
      "W3C structural clause record",
    );
    const document = documentById.get(record.documentId);
    if (
      !document ||
      seen.has(record.id) ||
      !KINDS.has(record.kind) ||
      record.family !== document.family ||
      record.documentApplicability !== document.applicability ||
      !record.id.startsWith(`${record.documentId}:${record.kind}:`) ||
      !/^[0-9a-f]{24}$/.test(record.id.slice(record.id.lastIndexOf(":") + 1)) ||
      typeof record.sectionRef !== "string" ||
      record.sectionRef.length === 0 ||
      typeof record.structuralRef !== "string" ||
      record.structuralRef.length === 0 ||
      record.actor !== "unassessed" ||
      record.disposition !== "unassessed" ||
      !SHA256.test(record.textSha256 ?? "") ||
      record.sourceSha256 !== document.sourceSha256 ||
      typeof record.excerpt !== "string" ||
      record.excerpt.length === 0 ||
      record.excerpt.length > 240 ||
      !SHA256.test(record.bindingSha256 ?? "")
    ) {
      throw new Error(`invalid W3C structural clause record ${record.id}`);
    }
    seen.add(record.id);
    sortedUniqueStrings(record.keywords, `${record.id} keywords`);
    if (
      (record.kind === "bcp14-clause" &&
        (record.keywords.length === 0 ||
          record.keywords.some((keyword) => !BCP14.has(keyword)))) ||
      (record.kind !== "bcp14-clause" && record.keywords.length !== 0) ||
      record.bindingSha256 !== recordBindingHash(record)
    ) {
      throw new Error(`${record.id} structural clause binding is invalid`);
    }
  }
  if (JSON.stringify(records) !== JSON.stringify(expectedRecords)) {
    throw new Error(
      "W3C structural clause record set differs from source-bound extraction",
    );
  }
}

function validateTotals(totals, documentCount, records) {
  exactKeys(
    totals,
    ["documents", "records", "byKind"],
    "W3C structural clause totals",
  );
  const byKind = Object.fromEntries(
    [...new Set(records.map((record) => record.kind))]
      .sort()
      .map((kind) => [
        kind,
        records.filter((record) => record.kind === kind).length,
      ]),
  );
  exactKeys(totals.byKind, Object.keys(byKind), "W3C structural clause kinds");
  if (
    totals.documents !== documentCount ||
    totals.records !== records.length ||
    JSON.stringify(totals.byKind) !== JSON.stringify(byKind)
  ) {
    throw new Error("W3C structural clause totals are invalid");
  }
}

function readCachedSource(root, document) {
  if (typeof root !== "string" || !isAbsolute(root)) {
    throw new Error("W3C structural clause repository root is invalid");
  }
  const canonicalRoot = realpathSync(root);
  const lexicalDirectory = resolve(
    canonicalRoot,
    "target/w3c/normative-control/sources",
  );
  const directory = realpathSync(lexicalDirectory);
  if (
    directory !== lexicalDirectory ||
    !inside(canonicalRoot, directory)
  ) {
    throw new Error("W3C structural clause source directory is unsafe");
  }
  const path = resolve(
    directory,
    `${document.id}-${document.sha256}.html`,
  );
  if (dirname(path) !== directory || realpathSync(path) !== path) {
    throw new Error(`${document.id} clause source path is unsafe`);
  }
  return readStableFile(path);
}

function recordBindingHash(record) {
  return sha256(
    JSON.stringify([
      record.id,
      record.documentId,
      record.family,
      record.documentApplicability,
      record.kind,
      record.sectionRef,
      record.structuralRef,
      record.keywords,
      record.actor,
      record.disposition,
      record.textSha256,
      record.sourceSha256,
    ]),
  );
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} fields are invalid`);
  }
}

function exactOrder(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} is missing, extra, stale, or reordered`);
  }
}

function sortedUniqueStrings(values, label) {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || value.length === 0) ||
    new Set(values).size !== values.length ||
    JSON.stringify(values) !== JSON.stringify([...values].sort())
  ) {
    throw new Error(`${label} must be sorted, unique, non-empty strings`);
  }
}

function inside(root, path) {
  const child = relative(root, path);
  return (
    child !== "" &&
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
