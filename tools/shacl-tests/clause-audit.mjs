#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { residualClaims, reviewedObligations } from "./clause-reviews.mjs";
import { shaclRequirementMappings } from "./shacl-requirements.mjs";

const COMMIT = "eedda09f93c39be1d2e978f3f942631494ae25a0";
const specifications = {
  overview: {
    path: "shacl12-overview/index.html",
    sha256: "35a964193d49b39204db4b84d5825e53cd56843e578626f64d292eebc9948298",
    applicability: "informative-navigation",
    defaultStatus: "not-applicable-informative",
  },
  core: {
    path: "shacl12-core/index.html",
    sha256: "69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e",
    applicability: "validation-processor",
    defaultStatus: "residual-clause-trace-required",
    expectedSyntaxRules: 113,
  },
  sparql: {
    path: "shacl12-sparql/index.html",
    sha256: "c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c",
    applicability: "sparql-validation-processor",
    defaultStatus: "residual-clause-trace-required",
    expectedSyntaxRules: 56,
  },
  nodeExpressions: {
    path: "shacl12-node-expr/index.html",
    sha256: "a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72",
    applicability: "node-expression-processor",
    defaultStatus: "suite-covered-clause-trace-required",
    expectedSyntaxRules: 35,
  },
  rules: {
    path: "shacl12-rules/index.html",
    sha256: "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
    applicability: "rules-processor",
    defaultStatus: "implemented-subset-fail-closed",
  },
  compact: {
    path: "shacl12-cs/index.html",
    sha256: "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
    applicability: "compact-syntax-parser",
    defaultStatus: "implemented-tested-informative-suite",
  },
  ui: {
    path: "shacl12-ui/index.html",
    sha256: "3b289645228d4cf154608259d38555d9b946f50b52c21648d586fd8172c07853",
    applicability: "renderer-or-ui",
    defaultStatus: "not-applicable-to-oxshacl",
  },
  profiling: {
    path: "shacl12-profiling/index.html",
    sha256: "248602e3a92b2c6d72b6734ce65638dcdc05afe7c4a657abba719d2c07f25202",
    applicability: "profile-author-or-data-author",
    defaultStatus: "not-applicable-no-w3c-profiling-claim",
  },
};

const repositoryRoot = realpathSync(resolve(import.meta.dirname, "../.."));
const evidenceRoot = resolve(repositoryRoot, "target/w3c/shacl-1.2");
const checkout = resolve(evidenceRoot, `data-shapes-${COMMIT.slice(0, 12)}`);
const documents = {};
const documentHtml = {};
const clauseCandidates = [];
const syntaxRules = [];

for (const [name, definition] of Object.entries(specifications)) {
  const path = resolve(checkout, definition.path);
  const source = readFileSync(path);
  const actualHash = sha256(source);
  if (actualHash !== definition.sha256) {
    throw new Error(`${name} specification hash mismatch: ${actualHash}`);
  }
  const html = source.toString("utf8");
  documentHtml[name] = html;
  const rules = extractSyntaxRules(name, html, definition);
  if (
    definition.expectedSyntaxRules !== undefined &&
    rules.length !== definition.expectedSyntaxRules
  ) {
    throw new Error(
      `${name} syntax-rule count ${rules.length}, expected ${definition.expectedSyntaxRules}`,
    );
  }
  const clauses = extractBcp14Clauses(name, html, definition);
  syntaxRules.push(...rules);
  clauseCandidates.push(...clauses);
  documents[name] = {
    repositoryPath: relative(repositoryRoot, path),
    sha256: actualHash,
    applicability: definition.applicability,
    syntaxRules: rules.length,
    bcp14ClauseCandidates: clauses.length,
  };
}

const requirementSource = JSON.parse(
  readFileSync(resolve(repositoryRoot, "docs/research/normative-requirements.json"), "utf8"),
).requirements.filter(({ id }) => id.startsWith("SHACL12-"));
const sourceRequirementIds = requirementSource.map(({ id }) => id).sort();
const mappedRequirementIds = shaclRequirementMappings.map(({ id }) => id).sort();
if (JSON.stringify(sourceRequirementIds) !== JSON.stringify(mappedRequirementIds)) {
  throw new Error(
    `SHACL grouped-requirement set mismatch: source=${sourceRequirementIds.join(",")} mapped=${mappedRequirementIds.join(",")}`,
  );
}
const sourceRequirements = new Map(
  requirementSource.map((requirement) => [requirement.id, requirement]),
);
const groupedRequirements = shaclRequirementMappings.map((mapping) => {
  const source = sourceRequirements.get(mapping.id);
  if (!documents[mapping.document]) {
    throw new Error(`${mapping.id} maps unknown document ${mapping.document}`);
  }
  for (const anchor of mapping.sourceAnchors) {
    const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\bid=["']${escaped}["']`, "i").test(documentHtml[mapping.document])) {
      throw new Error(`${mapping.id} maps missing ${mapping.document} anchor ${anchor}`);
    }
  }
  return {
    ...mapping,
    ledgerDocument: source.document,
    ledgerSection: source.section,
    ledgerApplicability: source.applicability,
    ledgerDisposition: source.disposition,
    obligation: source.obligation,
  };
});

const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    repository: "https://github.com/w3c/data-shapes.git",
    commit: COMMIT,
    immutable: true,
  },
  qualification:
    "Clause inventory, not a complete conformance claim. Every extracted BCP14 candidate is scope-classified; reviewed obligations carry implementation evidence or an explicit residual.",
  documents,
  groupedRequirements,
  reviewedObligations,
  clauseCandidates,
  syntaxRules,
  residualClaims,
};

const output = resolve(evidenceRoot, "clause-obligations.json");
atomicJson(output, artifact);
process.stdout.write(
  `${JSON.stringify({
    output: relative(repositoryRoot, output),
    documents: Object.keys(documents).length,
    clauseCandidates: clauseCandidates.length,
    syntaxRules: syntaxRules.length,
    reviewedObligations: reviewedObligations.length,
    groupedRequirements: groupedRequirements.length,
    residualClaims: artifact.residualClaims.length,
  }, null, 2)}\n`,
);

function extractSyntaxRules(document, html, definition) {
  const rules = [];
  const pattern = /data-syntax-rule=["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const tagStart = html.lastIndexOf("<", match.index);
    const openEnd = html.indexOf(">", match.index);
    const tag = /^<([a-z][\w-]*)\b/i.exec(html.slice(tagStart, openEnd + 1))?.[1];
    const close = tag
      ? html.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, openEnd)
      : -1;
    const text = normalizeHtml(
      html.slice(openEnd + 1, close < 0 ? openEnd + 1 : close),
    );
    rules.push({
      id: `${document}:${match[1]}`,
      document,
      rule: match[1],
      textSha256: sha256(text),
      applicability: definition.applicability,
      status: definition.defaultStatus,
    });
  }
  return rules;
}

function extractBcp14Clauses(document, html, definition) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const clauses = new Map();
  const pattern = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of cleaned.matchAll(pattern)) {
    const text = normalizeHtml(match[2]);
    const keywords = [
      ...new Set(
        [...text.matchAll(/\b(MUST(?: NOT)?|SHOULD(?: NOT)?|MAY|REQUIRED)\b/g)].map(
          (keyword) => keyword[1],
        ),
      ),
    ];
    if (keywords.length === 0) continue;
    const textHash = sha256(text);
    const section = nearestSection(cleaned, match.index);
    clauses.set(textHash, {
      id: `${document}:${section ?? "unsectioned"}:${textHash.slice(0, 12)}`,
      document,
      section,
      keywords,
      textSha256: textHash,
      applicability: definition.applicability,
      status: definition.defaultStatus,
    });
  }
  return [...clauses.values()];
}

function nearestSection(html, position) {
  const prefix = html.slice(0, position);
  const matches = [
    ...prefix.matchAll(/<section\b[^>]*\bid=["']([^"']+)["'][^>]*>/gi),
  ];
  return matches.at(-1)?.[1] ?? null;
}

function normalizeHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporary, path);
}
