import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { isReviewedW3cUrl, readStableFile } from "./stable-source.mjs";
import { parseStrictJson } from "./strict-json.mjs";

const TARGET_FAMILIES = Object.freeze(["rdf-1.2", "sparql-1.2"]);
const SHA256 = /^[0-9a-f]{64}$/;
const APPLICABILITY = new Set([
  "applicable",
  "informative",
  "separate-surface",
  "optional-surface",
]);

export const repositoryRoot = realpathSync(
  resolve(import.meta.dirname, "../.."),
);

export function loadRegisteredDocuments({
  requirementsPath = resolve(
    repositoryRoot,
    "docs/research/normative-requirements.json",
  ),
  standardsPath = resolve(
    repositoryRoot,
    "docs/research/standards-registry.json",
  ),
} = {}) {
  const requirements = parseJsonFile(requirementsPath, "requirements registry");
  const standards = parseJsonFile(standardsPath, "standards registry");
  return validateRegisteredDocuments(requirements, standards);
}

export function validateRegisteredDocuments(requirements, standards) {
  requireObject(requirements, "requirements registry");
  requireObject(standards, "standards registry");
  if (!Array.isArray(requirements.documents)) {
    throw new Error("requirements registry documents must be an array");
  }
  if (!Array.isArray(standards.families)) {
    throw new Error("standards registry families must be an array");
  }

  const allRequirements = uniqueById(
    requirements.documents,
    "requirements document",
  );
  const declaredCoverage = requirements.reviewState?.documentCoverage;
  if (
    declaredCoverage?.registered !== allRequirements.size ||
    declaredCoverage?.represented !== allRequirements.size ||
    declaredCoverage?.setEquality !== true
  ) {
    throw new Error("requirements document-coverage declaration is stale");
  }

  const standardFamilies = uniqueById(standards.families, "standards family");
  const selected = [];
  for (const familyId of TARGET_FAMILIES) {
    const family = standardFamilies.get(familyId);
    if (!family || !Array.isArray(family.documents)) {
      throw new Error(`standards registry is missing family ${familyId}`);
    }
    if (family.documentCount !== family.documents.length) {
      throw new Error(`${familyId} documentCount is stale`);
    }
    for (const document of family.documents) {
      requireObject(document, `${familyId} standards document`);
      selected.push({ ...document, family: familyId });
    }
  }

  const standardDocuments = uniqueById(selected, "selected standards document");
  const requirementDocuments = new Map();
  for (const document of requirements.documents) {
    if (!TARGET_FAMILIES.includes(document.family)) continue;
    requireObject(document, "requirements document");
    if (!SHA256.test(document.sha256 ?? "")) {
      throw new Error(`${document.id} has an invalid registered SHA-256`);
    }
    if (!isReviewedW3cUrl(document.url)) {
      throw new Error(`${document.id} has an unreviewed W3C document URL`);
    }
    if (!APPLICABILITY.has(document.applicability)) {
      throw new Error(`${document.id} has an invalid applicability`);
    }
    requirementDocuments.set(document.id, document);
  }
  assertSameIdSet(
    requirementDocuments,
    standardDocuments,
    "requirements and standards document sets",
  );

  const ordered = [];
  for (const familyId of TARGET_FAMILIES) {
    for (const standard of selected.filter(
      (item) => item.family === familyId,
    )) {
      const requirement = requirementDocuments.get(standard.id);
      if (requirement.family !== familyId || requirement.url !== standard.url) {
        throw new Error(`${standard.id} registry family or URL mismatch`);
      }
      ordered.push(Object.freeze({ ...requirement }));
    }
  }
  return Object.freeze(ordered);
}

function parseJsonFile(path, label) {
  try {
    return parseStrictJson(readStableFile(path), label);
  } catch (error) {
    throw new Error(`unable to parse ${label}: ${error.message}`, {
      cause: error,
    });
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function uniqueById(values, label) {
  const result = new Map();
  for (const value of values) {
    requireObject(value, label);
    if (typeof value.id !== "string" || value.id.length === 0) {
      throw new Error(`${label} has an invalid id`);
    }
    if (result.has(value.id)) {
      throw new Error(`duplicate ${label} id: ${value.id}`);
    }
    result.set(value.id, value);
  }
  return result;
}

function assertSameIdSet(left, right, label) {
  const missing = [...right.keys()].filter((id) => !left.has(id));
  const extra = [...left.keys()].filter((id) => !right.has(id));
  if (missing.length || extra.length) {
    throw new Error(
      `${label} differ: missing=[${missing.join(",")}], extra=[${extra.join(",")}]`,
    );
  }
}

export const registeredFamilies = TARGET_FAMILIES;
