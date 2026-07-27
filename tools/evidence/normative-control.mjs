import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { normativeControlContract } from "../w3c-tests/contract.mjs";
import {
  candidateSetHash,
  loadReviewedMappings,
} from "../w3c-tests/mapping.mjs";
import { validateRegisteredDocuments } from "../w3c-tests/registry.mjs";
import { readStableFile } from "../w3c-tests/stable-source.mjs";
import { parseStrictJson } from "../w3c-tests/strict-json.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
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
const candidateKinds = new Set([
  "bcp14-block",
  "grammar-production",
  "syntax-production",
]);

export function validateNormativeControlSource(root) {
  const requirements = readControlJson(
    root,
    "docs/research/normative-requirements.json",
  );
  const standards = readControlJson(
    root,
    "docs/research/standards-registry.json",
  );
  const documents = validateRegisteredDocuments(requirements, standards);
  const mappings = loadReviewedMappings(resolve(root, "tools/w3c-tests"));
  exactOrder(
    mappings.map((item) => item.documentId),
    documents.map((item) => item.id),
    "reviewed mapping document order",
  );
  const documentById = uniqueMap(documents, "id", "registered document");
  for (const mapping of mappings) {
    exactKeys(
      mapping,
      [
        "documentId",
        "family",
        "sourceSha256",
        "candidateCount",
        "candidateSetSha256",
        "sectionRefs",
      ],
      `${mapping.documentId} reviewed mapping`,
    );
    const document = documentById.get(mapping.documentId);
    if (
      mapping.family !== document.family ||
      mapping.sourceSha256 !== document.sha256 ||
      !Number.isSafeInteger(mapping.candidateCount) ||
      mapping.candidateCount < 0 ||
      !SHA256.test(mapping.candidateSetSha256 ?? "")
    ) {
      throw new Error(`${mapping.documentId} reviewed mapping is stale`);
    }
    sortedUniqueStrings(
      mapping.sectionRefs,
      `${mapping.documentId} mapping section refs`,
    );
  }
  const families = [...new Set(documents.map((item) => item.family))];
  const candidateCount = mappings.reduce(
    (sum, item) => sum + item.candidateCount,
    0,
  );
  if (
    JSON.stringify(families) !==
      JSON.stringify(normativeControlContract.families) ||
    documents.length !== normativeControlContract.documents ||
    candidateCount !== normativeControlContract.candidates ||
    requirements.reviewState?.clauseEnumerationComplete !== false ||
    requirements.reviewState?.claimReady !== false ||
    requirements.reviewState?.umbrellaClaim !== "withheld"
  ) {
    throw new Error(
      "committed W3C normative control topology is not the reviewed bounded state",
    );
  }
  return {
    documents,
    mappings,
    controlFiles: normativeControlContract.controlPaths.map((path) =>
      controlRecord(root, path),
    ),
  };
}

export function validateNormativeControlAuditBytes(
  bytes,
  { root, source = undefined, contract = normativeControlContract } = {},
) {
  const audit = parseStrictJson(bytes, "W3C normative control receipt");
  validateNormativeControlAudit(audit, {
    root,
    source: source ?? validateNormativeControlSource(root),
    contract,
  });
  return audit;
}

export function validateNormativeControlAudit(
  audit,
  { root, source, contract = normativeControlContract },
) {
  exactKeys(
    audit,
    [
      "schemaVersion",
      "scope",
      "sourcePolicy",
      "totals",
      "documents",
      "candidates",
      "auditContentSha256",
    ],
    "W3C normative control receipt",
  );
  if (audit.schemaVersion !== contract.schemaVersion) {
    throw new Error("W3C normative control receipt schema is invalid");
  }
  validateScope(audit.scope, contract);
  validateSourcePolicy(audit.sourcePolicy, source, contract);
  validateTotals(audit.totals, contract);
  const documentById = validateDocuments(audit.documents, source, contract);
  validateCandidates(audit.candidates, documentById, source, contract);
  const { auditContentSha256, ...content } = audit;
  if (
    !SHA256.test(auditContentSha256 ?? "") ||
    auditContentSha256 !== sha256(JSON.stringify(content))
  ) {
    throw new Error("W3C normative control receipt content hash is invalid");
  }
  return audit;
}

function validateScope(scope, contract) {
  exactKeys(
    scope,
    [
      "families",
      "registeredDocumentSetEquality",
      "extraction",
      "exclusions",
      "candidateDisposition",
      "clauseEnumerationComplete",
      "conformanceClaim",
    ],
    "W3C normative control scope",
  );
  if (
    JSON.stringify(scope.families) !== JSON.stringify(contract.families) ||
    scope.registeredDocumentSetEquality !== true ||
    scope.extraction !== contract.extraction ||
    scope.exclusions !== contract.exclusions ||
    scope.candidateDisposition !== contract.candidateDisposition ||
    scope.clauseEnumerationComplete !== contract.clauseEnumerationComplete ||
    scope.conformanceClaim !== contract.conformanceClaim
  ) {
    throw new Error("W3C normative control scope overstates its bounded claim");
  }
}

function validateSourcePolicy(policy, source, contract) {
  exactKeys(
    policy,
    [
      "registry",
      "exactRegisteredResponseSha256Required",
      "currentUrlFetchedOnEveryAudit",
      "descriptorStableControlAndCacheReads",
      "controlFiles",
    ],
    "W3C normative source policy",
  );
  if (
    policy.registry !== contract.controlPaths[0] ||
    policy.exactRegisteredResponseSha256Required !== true ||
    policy.currentUrlFetchedOnEveryAudit !== true ||
    policy.descriptorStableControlAndCacheReads !== true
  ) {
    throw new Error("W3C normative source policy is weakened");
  }
  exactOrder(
    policy.controlFiles.map((item) => item.path),
    contract.controlPaths,
    "W3C normative control file order",
  );
  if (
    JSON.stringify(policy.controlFiles) !== JSON.stringify(source.controlFiles)
  ) {
    throw new Error("W3C normative control files changed after the audit");
  }
}

function validateTotals(totals, contract) {
  exactKeys(
    totals,
    [
      "documents",
      "candidates",
      "bcp14Blocks",
      "grammarProductions",
    ],
    "W3C normative control totals",
  );
  for (const key of [
    "documents",
    "candidates",
    "bcp14Blocks",
    "grammarProductions",
  ]) {
    if (totals[key] !== contract[key]) {
      throw new Error(`W3C normative control total ${key} is invalid`);
    }
  }
  if (totals.bcp14Blocks + totals.grammarProductions !== totals.candidates) {
    throw new Error("W3C normative candidate classifications do not conserve");
  }
}

function validateDocuments(documents, source, contract) {
  if (
    !Array.isArray(documents) ||
    documents.length !== contract.documents ||
    source.documents.length !== contract.documents
  ) {
    throw new Error("W3C normative receipt document count is invalid");
  }
  exactOrder(
    documents.map((item) => item.id),
    source.documents.map((item) => item.id),
    "W3C normative receipt document order",
  );
  const mappings = uniqueMap(source.mappings, "documentId", "reviewed mapping");
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
        "sourceCache",
        "sectionCount",
        "candidateCount",
        "candidateSetSha256",
      ],
      `${item.id} receipt document`,
    );
    const registered = source.documents[index];
    const mapping = mappings.get(item.id);
    const expectedCache =
      `target/w3c/normative-control/sources/${item.id}-${registered.sha256}.html`;
    if (
      item.family !== registered.family ||
      item.applicability !== registered.applicability ||
      item.registeredUrl !== registered.url ||
      !safeFetchedUrl(item.fetchedUrl) ||
      item.sourceSha256 !== registered.sha256 ||
      item.sourceCache !== expectedCache ||
      !Number.isSafeInteger(item.sectionCount) ||
      item.sectionCount < 0 ||
      item.candidateCount !== mapping.candidateCount ||
      item.candidateSetSha256 !== mapping.candidateSetSha256
    ) {
      throw new Error(`${item.id} receipt document binding is invalid`);
    }
  }
  return uniqueMap(documents, "id", "receipt document");
}

function validateCandidates(candidates, documentById, source, contract) {
  if (!Array.isArray(candidates) || candidates.length !== contract.candidates) {
    throw new Error("W3C normative receipt candidate count is invalid");
  }
  const grouped = new Map([...documentById.keys()].map((id) => [id, []]));
  const seen = new Set();
  let bcp14Blocks = 0;
  for (const candidate of candidates) {
    validateCandidate(candidate, documentById, seen);
    grouped.get(candidate.documentId).push(candidate);
    if (candidate.kind === "bcp14-block") bcp14Blocks += 1;
  }
  const mappings = uniqueMap(source.mappings, "documentId", "reviewed mapping");
  const expectedOrder = [];
  for (const [id, values] of grouped) {
    values.sort((left, right) => left.id.localeCompare(right.id));
    expectedOrder.push(...values.map((item) => item.id));
    const mapping = mappings.get(id);
    const sections = [...new Set(values.map((item) => item.sectionRef))].sort();
    if (
      values.length !== mapping.candidateCount ||
      candidateSetHash(values) !== mapping.candidateSetSha256 ||
      JSON.stringify(sections) !== JSON.stringify(mapping.sectionRefs)
    ) {
      throw new Error(`${id} receipt candidate set is stale`);
    }
  }
  exactOrder(
    candidates.map((item) => item.id),
    expectedOrder,
    "W3C normative receipt candidate order",
  );
  if (
    bcp14Blocks !== contract.bcp14Blocks ||
    candidates.length - bcp14Blocks !== contract.grammarProductions
  ) {
    throw new Error("W3C normative receipt candidate kinds are invalid");
  }
}

function validateCandidate(candidate, documentById, seen) {
  exactKeys(
    candidate,
    [
      "id",
      "documentId",
      "family",
      "kind",
      "sectionRef",
      "structuralRef",
      "keywords",
      "textSha256",
      "sourceSha256",
      "excerpt",
      "bindingSha256",
    ],
    "W3C normative candidate",
  );
  const document = documentById.get(candidate.documentId);
  if (
    !document ||
    seen.has(candidate.id) ||
    !candidateKinds.has(candidate.kind) ||
    candidate.family !== document.family ||
    !candidate.id.startsWith(
      `${candidate.documentId}:${candidate.kind}:`,
    ) ||
    !/^[0-9a-f]{24}$/.test(candidate.id.slice(candidate.id.lastIndexOf(":") + 1)) ||
    typeof candidate.sectionRef !== "string" ||
    candidate.sectionRef.length === 0 ||
    typeof candidate.structuralRef !== "string" ||
    candidate.structuralRef.length === 0 ||
    !SHA256.test(candidate.textSha256 ?? "") ||
    candidate.sourceSha256 !== document.sourceSha256 ||
    typeof candidate.excerpt !== "string" ||
    candidate.excerpt.length === 0 ||
    candidate.excerpt.length > 240
  ) {
    throw new Error(`invalid W3C normative candidate ${candidate.id}`);
  }
  seen.add(candidate.id);
  sortedUniqueStrings(candidate.keywords, `${candidate.id} keywords`, false);
  if (
    (candidate.kind === "bcp14-block" &&
      (candidate.keywords.length === 0 ||
        candidate.keywords.some((keyword) => !BCP14.has(keyword)))) ||
    (candidate.kind !== "bcp14-block" && candidate.keywords.length !== 0) ||
    candidate.bindingSha256 !== candidateBindingHash(candidate)
  ) {
    throw new Error(`${candidate.id} candidate binding is invalid`);
  }
}

function candidateBindingHash(candidate) {
  return sha256(
    JSON.stringify([
      candidate.id,
      candidate.documentId,
      candidate.family,
      candidate.kind,
      candidate.sectionRef,
      candidate.structuralRef,
      candidate.keywords,
      candidate.textSha256,
      candidate.sourceSha256,
    ]),
  );
}

function readControlJson(root, path) {
  return parseStrictJson(readControl(root, path), path);
}

function controlRecord(root, path) {
  const bytes = readControl(root, path);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

function readControl(root, path) {
  const absolute = resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`W3C normative control path escapes repository: ${path}`);
  }
  return readStableFile(absolute);
}

function safeFetchedUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
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

function uniqueMap(values, key, label) {
  if (!Array.isArray(values)) throw new Error(`${label} values must be an array`);
  const result = new Map();
  for (const value of values) {
    const identity = value?.[key];
    if (typeof identity !== "string" || identity.length === 0) {
      throw new Error(`${label} has an invalid identifier`);
    }
    if (result.has(identity)) throw new Error(`duplicate ${label}: ${identity}`);
    result.set(identity, value);
  }
  return result;
}

function sortedUniqueStrings(values, label, requireSorted = true) {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== "string" || value.length === 0) ||
    new Set(values).size !== values.length ||
    (requireSorted &&
      JSON.stringify(values) !== JSON.stringify([...values].sort()))
  ) {
    throw new Error(`${label} must be sorted, unique, non-empty strings`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
