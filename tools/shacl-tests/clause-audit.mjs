#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  candidateResidualClaims,
  candidateReviewedObligations,
  residualClaims,
  reviewedObligations,
} from "./clause-reviews.mjs";
import {
  candidateClauseMappingRevision,
  candidateShaclRequirementMappings,
  shaclRequirementMappings,
} from "./shacl-requirements.mjs";
import {
  candidateShaclRevision,
  collectCandidateInventory,
  createCandidateRun,
  writeCandidateArtifact,
} from "./inventory.mjs";
import { verifyShaclCandidateArtifacts } from "../evidence/verify-programme.mjs";

const HISTORICAL_COMMIT = "eedda09f93c39be1d2e978f3f942631494ae25a0";
const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const historicalClauseAuditDefinitions = deepFreeze({
  overview: historicalDefinition(
    "shacl12-overview/index.html",
    "35a964193d49b39204db4b84d5825e53cd56843e578626f64d292eebc9948298",
    "informative-navigation",
    "not-applicable-informative",
  ),
  core: historicalDefinition(
    "shacl12-core/index.html",
    "69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e",
    "validation-processor",
    "residual-clause-trace-required",
    113,
  ),
  sparql: historicalDefinition(
    "shacl12-sparql/index.html",
    "c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c",
    "sparql-validation-processor",
    "residual-clause-trace-required",
    56,
  ),
  nodeExpressions: historicalDefinition(
    "shacl12-node-expr/index.html",
    "a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72",
    "node-expression-processor",
    "suite-covered-clause-trace-required",
    35,
  ),
  rules: historicalDefinition(
    "shacl12-rules/index.html",
    "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
    "rules-processor",
    "implemented-subset-fail-closed",
  ),
  compact: historicalDefinition(
    "shacl12-cs/index.html",
    "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
    "compact-syntax-parser",
    "implemented-tested-informative-suite",
  ),
  ui: historicalDefinition(
    "shacl12-ui/index.html",
    "3b289645228d4cf154608259d38555d9b946f50b52c21648d586fd8172c07853",
    "renderer-or-ui",
    "not-applicable-to-oxshacl",
  ),
  profiling: historicalDefinition(
    "shacl12-profiling/index.html",
    "248602e3a92b2c6d72b6734ce65638dcdc05afe7c4a657abba719d2c07f25202",
    "profile-author-or-data-author",
    "not-applicable-no-w3c-profiling-claim",
  ),
});

export const candidateClauseAuditDefinitions = deepFreeze({
  documents: {
    overview: candidateDefinition("informative-navigation"),
    core: candidateDefinition("validation-processor", 113),
    nodeExpressions: candidateDefinition("node-expression-processor", 35),
    sparql: candidateDefinition("sparql-validation-processor", 46),
    sparqlRl: candidateDefinition("sparql-rl-processor"),
    inferenceRules: candidateDefinition("inference-rules-processor", 25),
    compact: candidateDefinition("compact-syntax-parser"),
    ui: candidateDefinition("renderer-or-ui"),
    profiling: candidateDefinition("profile-author-or-data-author"),
  },
  grammars: {
    sparqlRl: { expectedProductions: 153 },
    compact: { expectedProductions: null },
  },
});

export async function main() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = realpathSync(resolve(moduleDirectory, "../.."));
  const sourceBefore = implementationIdentity(repositoryRoot);
  const checkout = ensureCandidateCheckout(repositoryRoot);
  const inventory = collectCandidateInventory({
    checkout,
    implementation: sourceBefore.commit,
  });
  const run = createCandidateRun({
    repositoryRoot,
    implementation: sourceBefore.commit,
    kind: "clause-audit",
  });
  const inventoryArtifact = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "inventory.json",
    value: inventory,
  });
  const audit = collectCandidateClauseAudit({
    repositoryRoot,
    checkout,
    inventory,
    inventoryArtifact,
    implementation: sourceBefore.commit,
    run,
  });
  const auditArtifact = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "clause-obligations.json",
    value: audit,
  });
  const sourceAfter = implementationIdentity(repositoryRoot, false);
  requireDeepEqual(sourceAfter, sourceBefore, "implementation source changed during clause audit");
  const receipt = {
    schema: "oxigraph.shacl-candidate-run/v1",
    kind: "clause-audit",
    suiteCommit: run.suiteCommit,
    implementationCommit: run.implementationCommit,
    runId: run.runId,
    inventoryArtifact,
    auditArtifact,
    sourceBefore,
    sourceAfter,
    complete: true,
    errors: [],
    completeConformance: false,
    qualified: false,
    promoted: false,
  };
  const receiptRef = writeCandidateArtifact({
    repositoryRoot,
    run,
    name: "receipt.json",
    value: receipt,
  });
  const verification = await verifyShaclCandidateArtifacts(repositoryRoot, {
    receiptRef,
    expectedImplementationCommit: sourceBefore.commit,
  });
  if (!verification || verification.ok !== true) {
    throw new Error(
      `candidate verifier rejected clause audit: ${JSON.stringify(verification?.errors ?? [])}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      receiptRef,
      documents: Object.keys(audit.documents).length,
      clauseCandidates: audit.clauseCandidates.length,
      syntaxRules: audit.syntaxRules.length,
      grammarProductions: audit.grammarProductions.length,
      rawObligationJoins: audit.rawObligationJoins.length,
    }, null, 2)}\n`,
  );
  return 0;
}

export function collectHistoricalClauseAudit({
  repositoryRoot,
  checkout,
  generatedAt = new Date().toISOString(),
  requirementLedger = readRequirementLedger(repositoryRoot),
  requirementMappings = shaclRequirementMappings,
  obligations = reviewedObligations,
  residuals = residualClaims,
  definitions = historicalClauseAuditDefinitions,
}) {
  const documents = {};
  const documentHtml = {};
  const clauseCandidates = [];
  const syntaxRules = [];
  for (const [name, definition] of Object.entries(definitions)) {
    const path = resolve(checkout, definition.path);
    const source = readFileSync(path);
    requireEqual(sha256(source), definition.sha256, `${name} specification SHA-256`);
    const html = source.toString("utf8");
    documentHtml[name] = html;
    const rules = extractSyntaxRules(name, html, definition);
    if (definition.expectedSyntaxRules !== undefined) {
      requireEqual(rules.length, definition.expectedSyntaxRules, `${name} syntax-rule count`);
    }
    const clauses = extractBcp14Clauses(name, html, definition);
    syntaxRules.push(...rules);
    clauseCandidates.push(...clauses);
    documents[name] = {
      repositoryPath: relative(repositoryRoot, path),
      sha256: definition.sha256,
      applicability: definition.applicability,
      syntaxRules: rules.length,
      bcp14ClauseCandidates: clauses.length,
    };
  }
  const groupedRequirements = joinHistoricalRequirements(
    requirementLedger,
    requirementMappings,
    documents,
    documentHtml,
  );
  return {
    schemaVersion: 1,
    generatedAt,
    source: {
      repository: "https://github.com/w3c/data-shapes.git",
      commit: HISTORICAL_COMMIT,
      immutable: true,
    },
    qualification:
      "Clause inventory, not a complete conformance claim. Every extracted BCP14 candidate is scope-classified; reviewed obligations carry implementation evidence or an explicit residual.",
    documents,
    groupedRequirements,
    reviewedObligations: obligations,
    clauseCandidates,
    syntaxRules,
    residualClaims: residuals,
  };
}

export function collectCandidateClauseAudit({
  repositoryRoot,
  checkout,
  inventory,
  inventoryArtifact,
  implementation,
  run,
}) {
  requireFullCommit(implementation, "candidate implementation");
  validateRun(run, implementation);
  const checkoutRoot = requireCleanGitCheckout(
    checkout,
    candidateShaclRevision.suiteCommit,
    "candidate checkout",
  );
  validateInventory(inventory, implementation);
  const documentSources = Object.fromEntries(
    Object.entries(candidateShaclRevision.specificationFiles).map(([name, path]) => [
      name,
      readFileSync(requireFileInside(resolve(checkoutRoot, path), checkoutRoot, `${name} document`)),
    ]),
  );
  const grammarSources = Object.fromEntries(
    Object.entries(candidateShaclRevision.grammarFiles).map(([name, path]) => [
      name,
      readFileSync(requireFileInside(resolve(checkoutRoot, path), checkoutRoot, `${name} grammar`)),
    ]),
  );
  return collectCandidateClauseAuditContents({
    documentSources,
    grammarSources,
    inventory,
    inventoryArtifact,
    implementation,
    runId: run.runId,
    requirementLedger: readRequirementLedger(repositoryRoot),
  });
}

export function collectCandidateClauseAuditContents({
  documentSources,
  grammarSources,
  inventory,
  inventoryArtifact,
  implementation,
  runId,
  requirementLedger,
  mappingRevision = candidateClauseMappingRevision,
  requirementMappings = candidateShaclRequirementMappings,
  obligations = candidateReviewedObligations,
  residuals = candidateResidualClaims,
  definitions = candidateClauseAuditDefinitions,
}) {
  requireFullCommit(implementation, "candidate implementation");
  requireUuid(runId);
  validateInventory(inventory, implementation);
  validateArtifactReference(inventoryArtifact, "inventory artifact");
  validateMappingRevision(mappingRevision);
  validateRequirementSet(requirementLedger, requirementMappings);

  const sourceFacets = flattenSourceFacets(requirementMappings, mappingRevision);
  const facetsByDocument = new Map();
  for (const facet of sourceFacets) {
    const documentFacets = facetsByDocument.get(facet.document) ?? [];
    documentFacets.push(facet);
    facetsByDocument.set(facet.document, documentFacets);
  }
  const documents = {};
  const documentIndexes = new Map();
  const syntaxRules = [];
  const clauseCandidates = [];
  for (const [name, descriptor] of Object.entries(mappingRevision.documents)) {
    const definition = definitions.documents[name];
    if (!definition) throw new Error(`missing candidate audit definition for ${name}`);
    const source = requireSource(documentSources, name, "document");
    requireEqual(sha256(source), descriptor.sha256, `${name} document SHA-256`);
    const html = source.toString("utf8");
    const documentIndex = indexHtmlDocument(html);
    documentIndexes.set(name, documentIndex);
    const rules = definition.expectedSyntaxRules === undefined
      ? []
      : extractSyntaxRules(name, html, {
          ...definition,
          path: descriptor.path,
          sha256: descriptor.sha256,
          defaultStatus: "candidate-unexecuted",
        });
    if (definition.expectedSyntaxRules !== undefined) {
      requireEqual(rules.length, definition.expectedSyntaxRules, `${name} syntax-rule count`);
    }
    const clauses = extractBcp14Clauses(name, html, {
      ...definition,
      path: descriptor.path,
      sha256: descriptor.sha256,
      defaultStatus: "raw-candidate-unreviewed",
    }, documentIndex).map((entry) => ({
      ...entry,
      kind: "bcp14",
      anchor: null,
      facetId: null,
    }));
    const anchors = extractAnchorRecords(
      name,
      html,
      {
        ...definition,
        path: descriptor.path,
        sha256: descriptor.sha256,
      },
      facetsByDocument.get(name) ?? [],
      documentIndex,
    );
    syntaxRules.push(...rules);
    clauseCandidates.push(...clauses, ...anchors);
    documents[name] = {
      path: descriptor.path,
      sha256: descriptor.sha256,
      applicability: definition.applicability,
      syntaxRules: rules.length,
      bcp14ClauseCandidates: clauses.length,
      sourceFacetAnchors: anchors.length,
    };
  }
  validateSyntaxInventories(syntaxRules, mappingRevision);

  const grammars = {};
  const grammarProductions = [];
  for (const [name, descriptor] of Object.entries(mappingRevision.grammars)) {
    const definition = definitions.grammars[name];
    if (!definition) throw new Error(`missing candidate grammar definition for ${name}`);
    const source = requireSource(grammarSources, name, "grammar");
    requireEqual(sha256(source), descriptor.sha256, `${name} grammar SHA-256`);
    const productions = definition.expectedProductions === null
      ? []
      : extractGrammarProductions(name, source.toString("utf8"), descriptor);
    if (definition.expectedProductions !== null) {
      requireEqual(
        productions.length,
        definition.expectedProductions,
        `${name} grammar production count`,
      );
      grammarProductions.push(...productions);
    }
    grammars[name] = {
      path: descriptor.path,
      sha256: descriptor.sha256,
      productions: definition.expectedProductions,
    };
  }
  requireEqual(
    grammarProductions.length,
    mappingRevision.candidateInventories.sparqlRlGrammarProductions,
    "candidate SPARQL-RL grammar inventory",
  );

  const rawObligationJoins = joinCandidateObligations({
    obligations,
    requirementMappings,
    sourceFacets,
    clauseCandidates,
    syntaxRules,
    grammarProductions,
    documentIndexes,
  });
  return {
    schema: "oxigraph.shacl-candidate-clause-audit/v1",
    suiteCommit: mappingRevision.suiteCommit,
    implementationCommit: implementation,
    runId,
    source: {
      repository: mappingRevision.repository,
      suiteCommit: mappingRevision.suiteCommit,
      implementationCommit: implementation,
      immutable: true,
    },
    inventoryArtifact,
    mappingRevision,
    documents,
    grammars,
    groupedRequirements: requirementMappings,
    reviewedObligations: obligations,
    sourceFacets,
    rawObligationJoins,
    clauseCandidates,
    syntaxRules,
    grammarProductions,
    residualClaims: residuals,
    completeConformance: false,
    qualified: false,
    promoted: false,
  };
}

export function extractSyntaxRules(document, html, definition) {
  const rules = [];
  const pattern = /data-syntax-rule=["']([^"']+)["']/giu;
  for (const match of html.matchAll(pattern)) {
    const tagStart = html.lastIndexOf("<", match.index);
    const openEnd = html.indexOf(">", match.index);
    const tag = /^<([a-z][\w-]*)\b/iu.exec(html.slice(tagStart, openEnd + 1))?.[1];
    const close = tag ? html.toLowerCase().indexOf(`</${tag.toLowerCase()}>`, openEnd) : -1;
    const text = normalizeHtml(html.slice(openEnd + 1, close < 0 ? openEnd + 1 : close));
    rules.push({
      id: `${document}:${match[1]}`,
      document,
      path: definition.path,
      sha256: definition.sha256,
      rule: match[1],
      textSha256: sha256(text),
      applicability: definition.applicability,
      status: definition.defaultStatus,
    });
  }
  requireUnique(rules.map(({ id }) => id), `${document} syntax-rule IDs`);
  return rules;
}

export function extractBcp14Clauses(
  document,
  html,
  definition,
  documentIndex = indexHtmlDocument(html),
) {
  const clauses = new Map();
  const occurrences = new Map();
  const textElements = new Set(["p", "li", "td", "th"]);
  for (const element of documentIndex.elements) {
    if (!textElements.has(element.tag)) continue;
    if (element.closeStart === null) {
      throw new Error(`unclosed candidate BCP14 element ${element.tag} at ${element.start}`);
    }
    const text = normalizeHtml(documentIndex.masked.slice(element.openEnd, element.closeStart));
    const keywords = [
      ...new Set(
        [...text.matchAll(/\b(MUST(?: NOT)?|SHOULD(?: NOT)?|MAY|REQUIRED)\b/gu)].map(
          (keyword) => keyword[1],
        ),
      ),
    ];
    if (keywords.length === 0) continue;
    const textSha256 = sha256(text);
    const section = element.sectionIds.at(-1) ?? null;
    const id = `bcp14:${document}:${section ?? "unsectioned"}:${textSha256.slice(0, 12)}`;
    clauses.set(id, {
      id,
      document,
      path: definition.path,
      sha256: definition.sha256,
      section,
      keywords,
      textSha256,
      applicability: definition.applicability,
      status: definition.defaultStatus,
    });
    const positions = occurrences.get(id) ?? [];
    positions.push({ start: element.start, end: element.end });
    occurrences.set(id, positions);
  }
  documentIndex.bcp14Occurrences = occurrences;
  return [...clauses.values()];
}

export function extractAnchorRecords(
  document,
  html,
  definition,
  sourceFacets,
  documentIndex = indexHtmlDocument(html),
) {
  const records = [];
  for (const facet of sourceFacets) {
    for (const anchor of facet.anchors) {
      const text = anchoredText(html, anchor, documentIndex);
      records.push({
        id: `facet:${facet.id}:${anchor}`,
        kind: "source-facet",
        document,
        path: definition.path,
        sha256: definition.sha256,
        section: anchor,
        anchor,
        facetId: facet.id,
        keywords: [],
        textSha256: sha256(text),
        applicability: definition.applicability,
        status: facet.sourceStatus,
      });
    }
  }
  requireUnique(records.map(({ id }) => id), `${document} source-facet records`);
  return records;
}

export function extractGrammarProductions(grammar, source, descriptor) {
  const records = [];
  let current = null;
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\[(\d+)\]\s+([^\s]+)\s+::=\s*(.*)$/u.exec(line);
    if (match) {
      if (current !== null) records.push(grammarProduction(grammar, descriptor, current));
      current = { number: Number(match[1]), name: match[2], lines: [match[3]] };
    } else if (current !== null && /^\s+/u.test(line)) {
      current.lines.push(line.trim());
    } else if (/^@[A-Za-z][A-Za-z0-9_-]*$/u.test(line.trim())) {
      if (current !== null) records.push(grammarProduction(grammar, descriptor, current));
      current = null;
    } else if (line.trim() !== "") {
      throw new Error(`unparsed ${grammar} grammar line after production ${current?.number ?? 0}`);
    }
  }
  if (current !== null) records.push(grammarProduction(grammar, descriptor, current));
  records.forEach((record, index) =>
    requireEqual(record.number, index + 1, `${grammar} grammar production sequence`),
  );
  requireUnique(records.map(({ id }) => id), `${grammar} grammar production IDs`);
  return records;
}

export function joinCandidateObligations({
  obligations,
  requirementMappings,
  sourceFacets,
  clauseCandidates,
  syntaxRules,
  grammarProductions,
  documentIndexes,
}) {
  const mappings = uniqueMap(requirementMappings, "id", "candidate requirement mapping");
  const facets = uniqueMap(sourceFacets, "id", "candidate source facet");
  const clauses = uniqueMap(clauseCandidates, "id", "candidate clause record");
  const rules = uniqueMap(syntaxRules, "id", "candidate syntax rule");
  const productions = uniqueMap(grammarProductions, "id", "candidate grammar production");
  return obligations.map((obligation) => {
    const mapping = mappings.get(obligation.mappingId);
    if (!mapping) throw new Error(`${obligation.id} maps unknown ${obligation.mappingId}`);
    const joinedFacets = obligation.sourceFacetIds.map((id) => {
      const facet = facets.get(id);
      if (!facet) throw new Error(`${obligation.id} joins unknown source facet ${id}`);
      if (!mapping.sourceFacets.some((candidate) => candidate.id === id)) {
        throw new Error(`${obligation.id} joins facet ${id} outside ${mapping.id}`);
      }
      return facet;
    });
    const clauseCandidateIds = [];
    const joinedClauseIds = new Set();
    const addClause = (id) => {
      if (!joinedClauseIds.has(id)) {
        clauseCandidateIds.push(id);
        joinedClauseIds.add(id);
      }
    };
    for (const facet of joinedFacets) {
      const documentIndex = documentIndexes?.get(facet.document);
      if (!documentIndex) {
        throw new Error(`${obligation.id} has no structural index for ${facet.document}`);
      }
      for (const anchor of facet.anchors) {
        addClause(`facet:${facet.id}:${anchor}`);
        const scope = anchoredElement(documentIndex, anchor);
        for (const [id, occurrences] of documentIndex.bcp14Occurrences ?? []) {
          if (
            occurrences.some(
              ({ start, end }) => start >= scope.start && end <= scope.end,
            )
          ) {
            addClause(id);
          }
        }
      }
    }
    const syntaxRuleIds = syntaxRules
      .filter((rule) =>
        joinedFacets.some(
          (facet) => facet.document === rule.document && facet.anchors.includes(rule.rule),
        ),
      )
      .map(({ id }) => id);
    const grammarProductionIds = grammarIdsForObligation(obligation.id, grammarProductions);
    for (const id of clauseCandidateIds) {
      if (!clauses.has(id)) throw new Error(`${obligation.id} joins missing clause ${id}`);
    }
    for (const id of syntaxRuleIds) {
      if (!rules.has(id)) throw new Error(`${obligation.id} joins missing syntax rule ${id}`);
    }
    for (const id of grammarProductionIds) {
      if (!productions.has(id)) throw new Error(`${obligation.id} joins missing production ${id}`);
    }
    if (clauseCandidateIds.length + syntaxRuleIds.length + grammarProductionIds.length === 0) {
      throw new Error(`${obligation.id} has no raw source join`);
    }
    return {
      obligationId: obligation.id,
      mappingId: obligation.mappingId,
      sourceFacetIds: [...obligation.sourceFacetIds],
      sourceFacets: joinedFacets.map(({ id, document, path, sha256: digest, anchors }) => ({
        id,
        document,
        path,
        sha256: digest,
        anchors: [...anchors],
      })),
      clauseCandidateIds,
      syntaxRuleIds,
      grammarProductionIds,
      sourceStatus: obligation.sourceStatus,
      implementationStatus: obligation.implementationStatus,
      candidateExecutionStatus: obligation.candidateExecutionStatus,
    };
  });
}

function joinHistoricalRequirements(requirementLedger, mappings, documents, documentHtml) {
  validateRequirementSet(requirementLedger, mappings);
  const requirements = new Map(requirementLedger.map((entry) => [entry.id, entry]));
  return mappings.map((mapping) => {
    const source = requirements.get(mapping.id);
    if (!documents[mapping.document]) {
      throw new Error(`${mapping.id} maps unknown document ${mapping.document}`);
    }
    for (const anchor of mapping.sourceAnchors) anchoredText(documentHtml[mapping.document], anchor);
    return {
      ...mapping,
      ledgerDocument: source.document,
      ledgerSection: source.section,
      ledgerApplicability: source.applicability,
      ledgerDisposition: source.disposition,
      obligation: source.obligation,
    };
  });
}

function flattenSourceFacets(mappings, mappingRevision) {
  const facets = [];
  for (const mapping of mappings) {
    requireEqual(mapping.mappingSchema, mappingRevision.schema, `${mapping.id} mapping schema`);
    requireEqual(mapping.suiteCommit, mappingRevision.suiteCommit, `${mapping.id} suite commit`);
    for (const facet of mapping.sourceFacets) {
      const document = mappingRevision.documents[facet.document];
      if (!document) throw new Error(`${facet.id} names unknown document ${facet.document}`);
      requireEqual(facet.path, document.path, `${facet.id} document path`);
      requireEqual(facet.sha256, document.sha256, `${facet.id} document SHA-256`);
      if (!Array.isArray(facet.anchors) || facet.anchors.length === 0) {
        throw new Error(`${facet.id} has no candidate source anchors`);
      }
      facets.push({
        id: facet.id,
        mappingId: mapping.id,
        document: facet.document,
        path: facet.path,
        sha256: facet.sha256,
        anchors: [...facet.anchors],
        interpretation: facet.interpretation,
        sourceStatus: mapping.sourceStatus,
      });
    }
  }
  requireUnique(facets.map(({ id }) => id), "candidate source facet IDs");
  return facets;
}

function validateMappingRevision(revision) {
  requireEqual(revision.schema, "oxigraph.shacl-candidate-clause-mapping/v1", "mapping schema");
  requireEqual(revision.repository, candidateShaclRevision.repository, "mapping repository");
  requireEqual(revision.suiteCommit, candidateShaclRevision.suiteCommit, "mapping suite commit");
  requireEqual(
    revision.suiteContentSha256,
    candidateShaclRevision.suiteContentSha256,
    "mapping suite content SHA-256",
  );
  requireDeepEqual(revision.documents, candidateDocuments(), "mapping document identities");
  requireDeepEqual(revision.grammars, candidateGrammars(), "mapping grammar identities");
  requireDeepEqual(
    revision.inventoryBinding.declarationProjection,
    {
      rows: candidateShaclRevision.declarationRows,
      bytes: candidateShaclRevision.declarationBytes,
      sha256: candidateShaclRevision.declarationSha256,
    },
    "mapping declaration projection",
  );
  requireDeepEqual(
    revision.receiptBinding,
    {
      schema: "oxigraph.shacl-candidate-run/v1",
      kind: "clause-audit",
      auditArtifactSchema: "oxigraph.shacl-candidate-clause-audit/v1",
      completeConformance: false,
      qualified: false,
      promoted: false,
    },
    "mapping receipt binding",
  );
  requireDeepEqual(
    revision.ordinaryEvidenceCommits,
    {
      dataExecutionAndRuleProcessor: "e9a285c8217087a255072271f1bb444e70d43d32",
      bodyAbbreviationsAndRuleOrdering: "6e933eea37bd0f27660ee4a3471cdf11b910c949",
      coreValueUnion: "6c317a9a0448c9c92e6e47cf90e4434751b24a15",
      expectedPredicateLifecycle: "85580fc93f122565bdc0de48aef42a334174bb9e",
      candidateEvidenceContracts: "049e81c9fafa7aaf984808d48231e98ef56e6f46",
      completeGroundData: "2e63c6920a9c51e7b078d9a87c3070f6a8fb3978",
      srlBnode: "f706742b17e6674360c34cf6bdfc3b1b59ab59f3",
    },
    "ordinary evidence commit identities",
  );
  requireDeepEqual(
    revision.requiredBeforeAdoption,
    [],
    "accepted slice evidence prerequisites",
  );
  requireDeepEqual(
    revision.acceptedSliceEvidence,
    {
      completeGroundData: {
        taskId: "task-1789908162318-haeyko",
        commit: "2e63c6920a9c51e7b078d9a87c3070f6a8fb3978",
        acceptanceArtifact:
          "target/engineering-delivery/adr0046-srl-data/accepted-EGzKud.json",
        acceptanceSha256:
          "39955651bc5bf1ecf071fff9c3fbf1df1dced2432861b3c3102ddbdbb989807f",
        workflowRunId: "e12bca4c-4d2c-48b3-8f13-d9fcfcf5c4c7",
        evidenceKey:
          "programme-task-evidence/workflow-e12bca4c-4d2c-48b3-8f13-d9fcfcf5c4c7",
        reviewArtifact:
          "target/engineering-delivery/adr0046-srl-data/accepted-EGzKud.json#reviewResponse",
        reviewSha256:
          "15e46e33100c48c15687d722a6b2fc73988fa5910da4d1bac79b88ae7c65079b",
      },
      srlBnode: {
        taskId: "task-1789919062167-d1g7i1",
        commit: "f706742b17e6674360c34cf6bdfc3b1b59ab59f3",
        acceptanceArtifact:
          "target/engineering-delivery/adr0046-srl-bnode/accepted-8tVvxP.json",
        acceptanceSha256:
          "962baef59d23bc12cfa28421a437daa4d7ffa6fd1077cee5b08b72064b06ae9c",
        workflowRunId: "384d7494-7e95-49a0-8f71-442839b63a2c",
        evidenceKey:
          "programme-task-evidence/workflow-384d7494-7e95-49a0-8f71-442839b63a2c",
        reviewArtifact:
          "target/engineering-delivery/adr0046-srl-bnode/accepted-8tVvxP.json#artifactReferences[1]",
        reviewSha256:
          "0f5020e450a2a325700d226d946d90e656cd783441c5c1229d6bbb6da322fd4b",
      },
    },
    "accepted D and N evidence identities",
  );
}

function validateSyntaxInventories(syntaxRules, revision) {
  const counts = Object.fromEntries(
    ["core", "nodeExpressions", "sparql", "inferenceRules"].map((document) => [
      document,
      syntaxRules.filter((rule) => rule.document === document).length,
    ]),
  );
  requireEqual(counts.core, revision.candidateInventories.coreSyntaxRules, "Core syntax inventory");
  requireEqual(
    counts.nodeExpressions,
    revision.candidateInventories.nodeExpressionSyntaxRules,
    "Node Expressions syntax inventory",
  );
  requireEqual(
    counts.sparql,
    revision.candidateInventories.sparqlExtensionSyntaxRules,
    "SPARQL Extensions syntax inventory",
  );
  requireEqual(
    counts.inferenceRules,
    revision.candidateInventories.inferenceRuleSyntaxRules,
    "Inference Rules syntax inventory",
  );
  const sparqlIds = new Set(
    syntaxRules.filter((rule) => rule.document === "sparql").map((rule) => rule.rule),
  );
  const inferenceIds = new Set(
    syntaxRules.filter((rule) => rule.document === "inferenceRules").map((rule) => rule.rule),
  );
  for (const id of revision.movedSyntaxRuleIds) {
    if (sparqlIds.has(id) || !inferenceIds.has(id)) {
      throw new Error(`moved syntax-rule identity mismatch: ${id}`);
    }
  }
}

function validateInventory(inventory, implementation) {
  if (
    inventory?.schema !== "oxigraph.shacl-candidate-inventory/v1" ||
    inventory.source?.repository !== candidateShaclRevision.repository ||
    inventory.source?.suiteCommit !== candidateShaclRevision.suiteCommit ||
    inventory.source?.implementationCommit !== implementation
  ) {
    throw new Error("candidate inventory source identity mismatch");
  }
  requireDeepEqual(
    inventory.integrity?.declarationProjection,
    {
      rows: candidateShaclRevision.declarationRows,
      bytes: candidateShaclRevision.declarationBytes,
      sha256: candidateShaclRevision.declarationSha256,
    },
    "candidate inventory declaration projection",
  );
  requireEqual(inventory.completeConformance, false, "inventory complete-conformance flag");
  requireEqual(inventory.qualified, false, "inventory qualified flag");
  requireEqual(inventory.promoted, false, "inventory promoted flag");
}

function validateRequirementSet(requirementLedger, mappings) {
  if (!Array.isArray(requirementLedger)) throw new Error("SHACL requirement ledger is missing");
  const sourceIds = requirementLedger
    .filter(({ id }) => id.startsWith("SHACL12-"))
    .map(({ id }) => id)
    .sort();
  const mappedIds = mappings.map(({ id }) => id).sort();
  requireDeepEqual(mappedIds, sourceIds, "SHACL grouped-requirement set");
  requireUnique(mappedIds, "SHACL grouped-requirement IDs");
}

function grammarIdsForObligation(obligationId, productions) {
  if (obligationId === "rules-srl-syntax-recognition") {
    return productions.map(({ id }) => id);
  }
  if (obligationId === "rules-deleted-for-clause-rejection") {
    return ["sparqlRl:11", "sparqlRl:107"];
  }
  return [];
}

function grammarProduction(grammar, descriptor, production) {
  const text = normalizeWhitespace(production.lines.join(" "));
  return {
    id: `${grammar}:${production.number}`,
    grammar,
    path: descriptor.path,
    sha256: descriptor.sha256,
    number: production.number,
    name: production.name,
    textSha256: sha256(text),
    status: "candidate-unexecuted",
  };
}

function anchoredText(html, anchor, documentIndex = indexHtmlDocument(html)) {
  const element = anchoredElement(documentIndex, anchor);
  if (element.closeStart === null) {
    throw new Error(`unclosed candidate source anchor ${anchor}`);
  }
  return normalizeHtml(documentIndex.masked.slice(element.openEnd, element.closeStart));
}

function anchoredElement(documentIndex, anchor) {
  const matches = documentIndex.elementsById.get(anchor) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `missing candidate source anchor ${anchor}`
        : `duplicate candidate source anchor ${anchor}`,
    );
  }
  return matches[0];
}

function indexHtmlDocument(html) {
  const masked = maskIgnoredHtml(html);
  const elements = [];
  const elementsById = new Map();
  const stack = [];
  const voidElements = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr",
  ]);
  for (let start = masked.indexOf("<"); start >= 0; start = masked.indexOf("<", start + 1)) {
    let quote = null;
    let end = start + 1;
    for (; end < masked.length; end += 1) {
      const character = masked[end];
      if (quote !== null) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= masked.length) break;
    const raw = html.slice(start, end + 1);
    const tagMatch = /^<\s*(\/?)\s*([a-z][\w:-]*)\b/iu.exec(raw);
    if (!tagMatch) {
      start = end;
      continue;
    }
    const tag = tagMatch[2].toLowerCase();
    if (tagMatch[1]) {
      const openIndex = stack.findLastIndex((element) => element.tag === tag);
      if (openIndex >= 0) {
        for (let index = stack.length - 1; index >= openIndex; index -= 1) {
          const element = stack.pop();
          element.closeStart = start;
          element.end = index === openIndex ? end + 1 : start;
        }
      }
      start = end;
      continue;
    }
    const id = /\bid\s*=\s*(["'])([^"']+)\1/iu.exec(raw)?.[2] ?? null;
    const sectionIds = stack.at(-1)?.sectionIds.slice() ?? [];
    if (tag === "section" && id !== null) sectionIds.push(id);
    const element = {
      id,
      tag,
      start,
      openEnd: end + 1,
      closeStart: null,
      end: null,
      sectionIds,
    };
    elements.push(element);
    if (id !== null) {
      const matches = elementsById.get(id) ?? [];
      matches.push(element);
      elementsById.set(id, matches);
    }
    if (/\/\s*>$/u.test(raw) || voidElements.has(tag)) {
      element.closeStart = end + 1;
      element.end = end + 1;
    } else {
      stack.push(element);
    }
    start = end;
  }
  return { masked, elements, elementsById, bcp14Occurrences: new Map() };
}

function maskIgnoredHtml(html) {
  const mask = (value) => value.replace(/[^\r\n]/gu, " ");
  return html
    .replace(/<!--[\s\S]*?-->/gu, mask)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/giu, mask);
}

function normalizeHtml(value) {
  return normalizeWhitespace(
    value
      .replace(/<[^>]+>/gu, " ")
      .replace(/&nbsp;/giu, " ")
      .replace(/&lt;/giu, "<")
      .replace(/&gt;/giu, ">")
      .replace(/&amp;/giu, "&")
      .replace(/&quot;/giu, '"')
      .replace(/&#39;/giu, "'"),
  );
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function readRequirementLedger(repositoryRoot) {
  return JSON.parse(
    readFileSync(resolve(repositoryRoot, "docs/research/normative-requirements.json"), "utf8"),
  ).requirements;
}

function ensureCandidateCheckout(repositoryRoot) {
  const targetRoot = resolve(repositoryRoot, "target/w3c/shacl-1.2");
  mkdirSync(targetRoot, { recursive: true });
  const checkout = resolve(
    targetRoot,
    `data-shapes-${candidateShaclRevision.suiteCommit.slice(0, 12)}`,
  );
  if (!existsSync(checkout)) {
    const temporary = `${checkout}.tmp-${randomUUID()}`;
    try {
      git(repositoryRoot, [
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        candidateShaclRevision.repository,
        temporary,
      ]);
      git(temporary, ["checkout", "--detach", candidateShaclRevision.suiteCommit]);
      requireCleanGitCheckout(temporary, candidateShaclRevision.suiteCommit, "temporary checkout");
      renameSync(temporary, checkout);
    } finally {
      if (existsSync(temporary)) rmSync(temporary, { recursive: true, force: true });
    }
  }
  return requireCleanGitCheckout(
    checkout,
    candidateShaclRevision.suiteCommit,
    "candidate checkout",
  );
}

function implementationIdentity(repositoryRoot, requireClean = true) {
  const root = realpathSync(repositoryRoot);
  requireEqual(realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()), root, "repository root");
  const branch = git(root, ["branch", "--show-current"]).trim();
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  requireFullCommit(commit, "implementation commit");
  if (requireClean && (branch !== "main" || status !== "")) {
    throw new Error("candidate clause audit requires clean main source");
  }
  return { commit, branch, status };
}

function requireCleanGitCheckout(path, commit, label) {
  const root = realpathSync(path);
  requireEqual(git(root, ["rev-parse", "HEAD"]).trim(), commit, `${label} commit`);
  requireEqual(
    git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    "",
    `${label} status`,
  );
  return root;
}

function requireFileInside(path, parent, label) {
  const root = realpathSync(parent);
  const candidate = resolve(path);
  if (candidate !== root && !candidate.startsWith(`${root}/`)) {
    throw new Error(`${label} escapes candidate checkout`);
  }
  let current = root;
  for (const component of relative(root, candidate).split("/").filter(Boolean)) {
    current = resolve(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`${label} contains a symbolic link`);
  }
  if (!lstatSync(candidate).isFile()) throw new Error(`${label} is not a regular file`);
  return candidate;
}

function validateRun(run, implementation) {
  if (
    run?.kind !== "clause-audit" ||
    run.suiteCommit !== candidateShaclRevision.suiteCommit ||
    run.implementationCommit !== implementation
  ) {
    throw new Error("candidate clause-audit run identity mismatch");
  }
  requireUuid(run.runId);
}

function validateArtifactReference(reference, label) {
  if (
    !reference ||
    typeof reference.path !== "string" ||
    !/^[0-9a-f]{64}$/u.test(reference.sha256) ||
    !Number.isSafeInteger(reference.bytes) ||
    reference.bytes <= 0
  ) {
    throw new Error(`${label} is not an exact artifact reference`);
  }
}

function candidateDocuments() {
  return Object.fromEntries(
    Object.entries(candidateShaclRevision.specificationFiles).map(([name, path]) => [
      name,
      { path, sha256: candidateShaclRevision.specificationSha256[name] },
    ]),
  );
}

function candidateGrammars() {
  return Object.fromEntries(
    Object.entries(candidateShaclRevision.grammarFiles).map(([name, path]) => [
      name,
      { path, sha256: candidateShaclRevision.grammarSha256[name] },
    ]),
  );
}

function historicalDefinition(
  path,
  digest,
  applicability,
  defaultStatus,
  expectedSyntaxRules,
) {
  return { path, sha256: digest, applicability, defaultStatus, expectedSyntaxRules };
}

function candidateDefinition(applicability, expectedSyntaxRules) {
  return { applicability, expectedSyntaxRules };
}

function requireSource(sources, name, label) {
  const source = sources?.[name];
  if (Buffer.isBuffer(source)) return source;
  if (typeof source === "string") return Buffer.from(source, "utf8");
  throw new Error(`missing ${name} ${label} source bytes`);
}

function uniqueMap(values, key, label) {
  const result = new Map();
  for (const value of values) {
    const identity = value?.[key];
    if (typeof identity !== "string" || !identity || result.has(identity)) {
      throw new Error(`${label} has invalid or duplicate identity ${identity}`);
    }
    result.set(identity, value);
  }
  return result;
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} are not unique`);
}

function requireFullCommit(value, label) {
  if (typeof value !== "string" || !FULL_COMMIT.test(value)) {
    throw new Error(`${label} must be a full lowercase Git commit`);
  }
}

function requireUuid(value) {
  if (typeof value !== "string" || !UUID_V4.test(value)) {
    throw new Error("candidate clause-audit run ID is not a lowercase UUID v4");
  }
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch: ${actual} != ${expected}`);
}

function requireDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : null;
if (entry !== null && entry === resolve(fileURLToPath(import.meta.url))) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
