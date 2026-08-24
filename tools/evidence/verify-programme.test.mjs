import assert from "node:assert/strict";
import test from "node:test";
import {
  documentClaims,
  expectedPins,
  expectedShaclIntegrity,
  validateAdrIndex,
  validateDependencyClaims,
  validateDocumentClaims,
  validateFullReceipts,
  validateJsonDocuments,
  validateLedgerCounts,
  validateNormativeClaims,
  validateRegistryPins,
  semanticCommandIds,
} from "./policy.mjs";
import { profiles as agenticProfiles } from "../agentic-qe/profile-definitions.mjs";

const jenaProfile = "jena-6.1.0-outcome-intersection-2026-07-27-v1";
const agenticIntegrity =
  "sha512-1bfL3zJJiwZNvcQ2yV7/6Z98U3LIKGS0eemYAxdVxwQ1DHgE9tuTt6pnluivXs3OSiKbd/v2X1iPP7FU0gFtfw==";
const darwinIntegrity =
  "sha512-V+AhQvj9ijR8OK9TvogSngtz47q8pHPjMm1mWMoDUk1JaRKz88oJu/sPUQ5BApCIgeSWEKo/bzrFSV4Krb/3Fg==";
const jenaSubjectSha256 =
  "1fe53cef38fb579188b61f1ccd60c383b1098c922012753733c4ef9c154b095d";
const jenaDomains = {
  rdf: 17,
  sparql: 30,
  shacl: 13,
  rdfs: 7,
  "owl2-rl": 9,
};
const jenaDomainAssertions = {
  rdf: 46,
  sparql: 77,
  shacl: 43,
  rdfs: 14,
  "owl2-rl": 18,
};
const jenaClassifications = {
  agreement: 70,
  "w3c-overrides-jena": 4,
  "w3c-permitted-divergence": 1,
  "jena-extension": 1,
};
const jenaReproducibility = {
  runs: 2,
  subjectSha256: jenaSubjectSha256,
  profileLockSha256:
    "00b01191d9c15661f9d8743261d2e104980d6ea73d444794acd56a822749bf4e",
  receiptSha256:
    "48673fdb0540dfe3a41a8c624f6ce98f31fe39a06e193007a5f84db3df005c76",
  resolvedInventorySha256:
    "be03e50517be71a7574d89982644fc3c1e54030c5d8375a792180ad37c476cb5",
  jenaObservationsSha256:
    "b9ad72609b05dbe3aaf29cbf8bdd2b8572f85e833a30bf123a580d7cf59e95b4",
};

function ledgerFixture() {
  return {
    schemaVersion: 2,
    claimPolicy: { currentUmbrellaClaim: "withheld" },
    evidence: [
      { id: "E-DATALOG-NATIVE", result: { passed: 70, failed: 0 } },
      { id: "E-STORE-NATIVE", result: { passed: 4, failed: 0 } },
      {
        id: "E-SUPPORTING-PARSER-SUITES",
        result: {
          wrapperTests: { passed: 5, failed: 0 },
          n3: {
            parser: "208/208",
            extended: "871/871",
            turtle: "296/296",
          },
          jsonLdToRdf: {
            entries: 467,
            passed: 446,
            declaredExclusions: 21,
          },
          jsonLdStreaming: {
            stableEntries: 479,
            passed: 452,
            declaredFailures: 27,
          },
        },
      },
      {
        id: "E-RDF12-OFFICIAL",
        result: {
          cases: 575,
          passed: 575,
          failed: 0,
          unsupported: 0,
          categories: {
            rdfSemanticsAggregate: {
              cases: 77,
              simpleRegime: 24,
              rdfRegime: 27,
              rdfsRegime: 26,
            },
          },
        },
      },
      {
        id: "E-SPARQL12-OFFICIAL",
        result: { cases: 269, passed: 269, failed: 0, unsupported: 0 },
      },
      {
        id: "E-RDFC10-OFFICIAL",
        result: { cases: 86, passed: 86, failed: 0, unsupported: 0 },
      },
      {
        id: "E-OWL2RL-OFFICIAL",
        inventory: { rdfBasedCases: 68, ruleIdentifiers: 78 },
        result: { assertions: 98, passed: 98, failed: 0 },
      },
      {
        id: "E-SHACL12-RUN",
        result: {
          aggregate: {
            discovered: 521,
            eligible: 519,
            passed: 519,
            failed: 0,
            unsupported: 0,
            excluded: 2,
            invalidUpstreamExclusions: 2,
          },
          rootValidation: {
            discovered: 169,
            eligible: 167,
            passed: 167,
            failed: 0,
            unsupported: 0,
            excluded: 2,
          },
          rootNodeExpressions: {
            discovered: 143,
            eligible: 143,
            passed: 143,
            failed: 0,
            unsupported: 0,
            excluded: 0,
          },
          legacySparqlRulesInfer: {
            discovered: 6,
            eligible: 6,
            passed: 6,
            failed: 0,
            unsupported: 0,
            excluded: 0,
          },
          supplementalRules: {
            discovered: 171,
            eligible: 171,
            passed: 171,
            failed: 0,
            unsupported: 0,
            excluded: 0,
          },
          informativeShaclCompact: {
            discovered: 32,
            eligible: 32,
            passed: 32,
            failed: 0,
            unsupported: 0,
            excluded: 0,
          },
        },
        upstreamExclusions: [{}, {}],
      },
      {
        id: "E-SHACL12-NATIVE",
        result: {
          allFeatures: { passed: 167, failed: 0 },
          noDefaultFeatures: { passed: 114, failed: 0 },
        },
      },
      {
        id: "E-SHACL12-JENA-COMPACT",
        result: {
          discovered: 32,
          eligible: 32,
          passed: 32,
          failed: 0,
          unsupported: 0,
          excluded: 0,
        },
      },
      {
        id: "E-JENA-PARITY",
        profile: jenaProfile,
        result: {
          scenarios: 76,
          assertions: 198,
          domains: { ...jenaDomains },
          domainAssertions: { ...jenaDomainAssertions },
          classifications: { ...jenaClassifications },
        },
        reproducibility: { ...jenaReproducibility },
      },
    ],
    qualification: [
      {
        id: "agentic-qe",
        versionPolicy: "latest",
        resolvedVersion: "3.13.12",
        lockIntegrity: agenticIntegrity,
        adapterAdversarialTests: { passed: 18, failed: 0 },
        semanticGateCommandInventory: 41,
        parityCommandInventory: 47,
      },
      {
        id: "metaharness-darwin",
        versionPolicy: "latest",
        resolvedVersion: "0.9.3",
        lockIntegrity: darwinIntegrity,
      },
    ],
    profiles: [{ id: "w3c-12-full", normativeFamilyParity: false }],
    reviewedPins: {
      rdfAndSparqlTests: { commit: expectedPins["w3c-rdf-tests"] },
      shaclSpecificationsAndTests: {
        commit: expectedPins["w3c-data-shapes"],
        suiteContentSha256: expectedShaclIntegrity.suiteContentSha256,
        specificationSha256: {
          ...expectedShaclIntegrity.specificationSha256,
        },
      },
      rdfCanonTests: { commit: expectedPins["w3c-rdf-canon-tests"] },
      jsonLdApi: expectedPins["w3c-json-ld-api"],
      jsonLdStreaming: expectedPins["w3c-json-ld-streaming"],
      n3OptionalCommunityGroupProfile: expectedPins["w3c-n3"],
      agenticQe: {
        policy: "latest",
        resolved: "3.13.12",
        integrity: agenticIntegrity,
      },
      darwin: {
        policy: "latest",
        resolved: "0.9.3",
        integrity: darwinIntegrity,
      },
    },
  };
}

test("canonical ledger exact counts pass and stale counts are all reported", () => {
  assert.deepEqual(
    semanticCommandIds,
    agenticProfiles["metaharness-semantic-gate"],
  );
  const ledger = ledgerFixture();
  const errors = [];
  validateLedgerCounts(ledger, errors);
  assert.deepEqual(errors, []);

  ledger.evidence.find((item) => item.id === "E-DATALOG-NATIVE").result.passed = 58;
  ledger.evidence.find((item) => item.id === "E-SHACL12-RUN").result.aggregate.passed = 316;
  ledger.evidence.find(
    (item) => item.id === "E-RDF12-OFFICIAL",
  ).result.categories.rdfSemanticsAggregate.rdfsRegime = 25;
  ledger.qualification[0].adapterAdversarialTests.passed = 13;
  ledger.evidence.find(
    (item) => item.id === "E-JENA-PARITY",
  ).result.classifications["w3c-permitted-divergence"] = 0;
  validateLedgerCounts(ledger, errors);
  assert(errors.some((error) => error.startsWith("Datalog passed tests:")));
  assert(errors.some((error) => error.startsWith("RDF Semantics RDFS-regime cases:")));
  assert(errors.some((error) => error.startsWith("RDF Semantics regime subtotal:")));
  assert(errors.some((error) => error.startsWith("SHACL passed cases:")));
  assert(
    errors.some((error) =>
      error.startsWith(
        "Jena classifications w3c-permitted-divergence:",
      ),
    ),
  );
  assert(errors.some((error) => error.startsWith("Agentic-QE adapter passed tests:")));
});

test("dependency claims are derived from exact integrity-bearing locks", () => {
  const ledger = ledgerFixture();
  const resolutions = {
    agenticQe: {
      policy: "latest",
      version: "3.13.12",
      integrity: agenticIntegrity,
    },
    darwin: {
      policy: "latest",
      version: "0.9.3",
      integrity: darwinIntegrity,
    },
  };
  const errors = [];
  validateDependencyClaims(ledger, resolutions, errors);
  assert.deepEqual(errors, []);

  ledger.reviewedPins.agenticQe.resolved = "3.13.11";
  ledger.qualification.find(
    (item) => item.id === "metaharness-darwin",
  ).lockIntegrity = "sha512-stale";
  validateDependencyClaims(ledger, resolutions, errors);
  assert(
    errors.some((error) => error.startsWith("Agentic-QE pin resolution:")),
  );
  assert(
    errors.some((error) =>
      error.startsWith("Darwin qualification integrity:"),
    ),
  );
});

test("normative broad claims remain withheld until every obligation closes", () => {
  const ledger = ledgerFixture();
  const normative = {
    requirements: [
      { id: "r1", disposition: "pass" },
      { id: "r2", disposition: "unsupported" },
    ],
    reviewState: {
      documentCoverage: { setEquality: true },
      groupedRequirementCoverage: { total: 2 },
      dispositionCounts: { pass: 1, unsupported: 1 },
      clauseEnumerationComplete: false,
      claimReady: false,
      umbrellaClaim: "withheld",
    },
  };
  let errors = [];
  validateNormativeClaims(normative, ledger, errors);
  assert.deepEqual(errors, []);

  normative.reviewState.claimReady = true;
  normative.reviewState.clauseEnumerationComplete = true;
  errors = [];
  validateNormativeClaims(normative, ledger, errors);
  assert(errors.some((error) => error.includes("clauseEnumerationComplete")));
  assert(errors.some((error) => error.includes("claimReady is true")));

  normative.requirements[1].disposition = "not-applicable";
  normative.reviewState.dispositionCounts = { pass: 1, "not-applicable": 1 };
  errors = [];
  validateNormativeClaims(normative, ledger, errors);
  assert.deepEqual(errors, []);
});

test("normative family coverage is mechanically derived from dispositions", () => {
  const ledger = ledgerFixture();
  ledger.profiles.push({
    id: "sparql12-w3c",
    normativeCoverage: {
      applicableRequirements: 2,
      closedRequirements: 1,
      unresolvedRequirements: 1,
    },
  });
  const normative = {
    documents: [{ id: "sparql", family: "sparql-1.2" }],
    requirements: [
      { id: "pass", document: "sparql", disposition: "pass" },
      { id: "open", document: "sparql", disposition: "unsupported" },
      { id: "info", document: "sparql", disposition: "not-applicable" },
    ],
    reviewState: {
      documentCoverage: { setEquality: true },
      groupedRequirementCoverage: { total: 3, "sparql-1.2": 3 },
      dispositionCounts: { pass: 1, unsupported: 1, "not-applicable": 1 },
      clauseEnumerationComplete: false,
      claimReady: false,
      umbrellaClaim: "withheld",
    },
  };
  let errors = [];
  validateNormativeClaims(normative, ledger, errors);
  assert.deepEqual(errors, []);

  ledger.profiles.find(
    (profile) => profile.id === "sparql12-w3c",
  ).normativeCoverage.closedRequirements = 0;
  errors = [];
  validateNormativeClaims(normative, ledger, errors);
  assert(errors.some((error) => error.startsWith("sparql-1.2 closed requirements:")));
});

test("registry pins must match both the reviewed constants and checkout heads", () => {
  const ledger = ledgerFixture();
  const registry = {
    testSources: Object.entries(expectedPins).map(([id, commit]) => ({
      id,
      commit,
      ...(id === "w3c-data-shapes"
        ? {
            suiteContentSha256: expectedShaclIntegrity.suiteContentSha256,
            specificationSha256: {
              ...expectedShaclIntegrity.specificationSha256,
            },
          }
        : {}),
    })),
  };
  const heads = { ...expectedPins };
  let errors = [];
  validateRegistryPins(registry, ledger, heads, errors);
  assert.deepEqual(errors, []);

  registry.testSources.find((item) => item.id === "w3c-json-ld-api").commit = "0".repeat(40);
  heads["w3c-n3"] = "1".repeat(40);
  errors = [];
  validateRegistryPins(registry, ledger, heads, errors);
  assert(errors.some((error) => error.startsWith("w3c-json-ld-api registry pin:")));
  assert(errors.some((error) => error.startsWith("w3c-n3 checkout HEAD:")));

  registry.testSources.find(
    (item) => item.id === "w3c-data-shapes",
  ).suiteContentSha256 = "2".repeat(64);
  errors = [];
  validateRegistryPins(registry, ledger, { ...expectedPins }, errors);
  assert(
    errors.some((error) =>
      error.startsWith("registry SHACL suite-content hash:"),
    ),
  );
});

test("key JSON shape validation rejects missing and non-object documents", () => {
  const documents = new Map([
    ["conformance-ledger.json", []],
    ["normative-requirements.json", { documents: [], requirements: [] }],
    ["standards-registry.json", { claimPolicy: {}, families: [], testSources: [] }],
  ]);
  const errors = [];
  validateJsonDocuments(documents, errors);
  assert(errors.some((error) => error.includes("conformance-ledger.json")));
  assert(errors.some((error) => error.includes("normative-requirements.json: missing reviewState")));
});

test("normative SHACL document hashes are pinned to the generated inventory", () => {
  const shaclDocumentIds = {
    core: "shacl12-core",
    nodeExpressions: "shacl12-node-expr",
    sparql: "shacl12-sparql",
    rules: "shacl12-rules",
    compact: "shacl12-compact-syntax",
  };
  const normative = {
    documents: Object.entries(shaclDocumentIds).map(([name, id]) => ({
      id,
      sha256: expectedShaclIntegrity.specificationSha256[name],
    })),
    requirements: [],
    reviewState: {},
  };
  const documents = new Map([
    [
      "conformance-ledger.json",
      {
        schemaVersion: 2,
        claimPolicy: {},
        evidence: [],
        profiles: [],
        qualification: [],
      },
    ],
    ["normative-requirements.json", normative],
    [
      "standards-registry.json",
      { claimPolicy: {}, families: [], testSources: [] },
    ],
  ]);
  let errors = [];
  validateJsonDocuments(documents, errors);
  assert.deepEqual(errors, []);

  documents.get("conformance-ledger.json").schemaVersion = 1;
  errors = [];
  validateJsonDocuments(documents, errors);
  assert(
    errors.some((error) => error.startsWith("conformance ledger schema:")),
  );
  documents.get("conformance-ledger.json").schemaVersion = 2;

  normative.documents.find((document) => document.id === "shacl12-core").sha256 =
    "0".repeat(64);
  errors = [];
  validateJsonDocuments(documents, errors);
  assert(
    errors.some((error) => error.startsWith("normative shacl12-core hash:")),
  );
});

test("labelled document checks detect stale evidence without policing unrelated numbers", () => {
  const datalog = documentClaims.find((claim) => claim.id === "Datalog");
  const jena = documentClaims.find((claim) => claim.id === "Jena");
  let errors = [];
  validateDocumentClaims(
    "current.md",
    "OxDatalog D0-D2 | 70 native tests pass | 318 unrelated historical items",
    [datalog],
    errors,
  );
  assert.deepEqual(errors, []);

  errors = [];
  validateDocumentClaims(
    "current.md",
    "OxDatalog D0-D2 | 58 native tests pass | 70 OWL cases",
    [datalog],
    errors,
  );
  assert.deepEqual(errors, [
    "current.md: Datalog evidence does not contain the current exact count",
  ]);

  errors = [];
  validateDocumentClaims(
    "current.md",
    "Apache Jena 6.1.0 differential: 76 reviewed scenarios and 198 assertions",
    [jena],
    errors,
  );
  assert.deepEqual(errors, []);

  errors = [];
  validateDocumentClaims(
    "current.md",
    "Apache Jena 6.1.0 differential: 73 reviewed scenarios and 168 assertions",
    [jena],
    errors,
  );
  assert.deepEqual(errors, [
    "current.md: Jena evidence does not contain the current exact count",
  ]);
});

test("ADR index validation reports broken targets and unindexed records together", () => {
  const names = new Set([
    "README.md",
    "0001-first.md",
    "0002-second.md",
  ]);
  const errors = [];
  validateAdrIndex(
    "# ADRs\n\n[First](0001-first.md)\n[Missing](0003-missing.md)\n",
    names,
    errors,
  );
  assert.deepEqual(errors, [
    "docs/adr/README.md: missing target 0003-missing.md",
    "docs/adr/README.md: ADR is not indexed: 0002-second.md",
  ]);
});

function fullReceiptsFixture() {
  const agenticRunId = "00000000-0000-4000-8000-000000000000";
  const agenticRoot =
    `target/agentic-qe/metaharness-semantic-gate/runs/${agenticRunId}`;
  const agenticArtifactHash = "f".repeat(64);
  const scenarios = Object.entries(jenaDomains).flatMap(
    ([domain, count]) => {
      const total = jenaDomainAssertions[domain];
      const base = Math.floor(total / count);
      const remainder = total % count;
      return Array.from({ length: count }, (_, index) => ({
        domain,
        assertion_count: base + (index < remainder ? 1 : 0),
      }));
    },
  );
  for (const [index, scenario] of scenarios.entries()) {
    scenario.classification =
      index < 70
        ? "agreement"
        : index < 74
          ? "w3c-overrides-jena"
          : index === 74
            ? "w3c-permitted-divergence"
            : "jena-extension";
  }
  const shaclInventory = {
    schemaVersion: 1,
    source: { commit: expectedPins["w3c-data-shapes"] },
    integrity: {
      suiteContentSha256: expectedShaclIntegrity.suiteContentSha256,
      specificationSha256: {
        ...expectedShaclIntegrity.specificationSha256,
      },
    },
    inventory: {
      ttlFiles: 347,
      manifestFiles: 25,
      statuses: { approved: 318 },
      categories: { rules: { ttlFiles: 36 } },
      rulesEvidence: {
        srlFixtureFiles: 166,
        manifestEntries: 171,
        manifestTypes: {
          RulesPositiveSyntaxTest: 108,
          RulesNegativeSyntaxTest: 30,
          RulesPositiveWellFormednessTest: 4,
          RulesNegativeWellFormednessTest: 4,
          RulesPositiveStratificationTest: 5,
          RulesNegativeStratificationTest: 4,
          RulesEvalTest: 16,
        },
        rootReachable: false,
        mfApproval: "unspecified",
      },
      compactSyntaxEvidence: {
        sourceExpectedPairs: 32,
        grammarSha256: expectedShaclIntegrity.grammarSha256,
        normative: false,
      },
    },
  };
  return {
    jena: {
      profile_id: jenaProfile,
      subject_sha256: jenaSubjectSha256,
      gate_closed: true,
      counts: {
        scenarios: 76,
        assertions: 198,
        domains: { ...jenaDomains },
        classifications: { ...jenaClassifications },
      },
      scenarios,
    },
    shaclInventory,
    shacl: {
      aggregateCounts: {
        discovered: 521,
        eligible: 519,
        passed: 519,
        failed: 0,
        unsupported: 0,
        excluded: 2,
      },
      lanes: {
        validate: {
          counts: {
            discovered: 169,
            eligible: 167,
            passed: 167,
            failed: 0,
            unsupported: 0,
            excluded: 2,
          },
        },
        nodeExpressions: {
          counts: {
            discovered: 143,
            eligible: 143,
            passed: 143,
            failed: 0,
            unsupported: 0,
            excluded: 0,
          },
        },
        sparqlRulesInfer: {
          counts: {
            discovered: 6,
            eligible: 6,
            passed: 6,
            failed: 0,
            unsupported: 0,
            excluded: 0,
          },
        },
        srlRules: {
          counts: {
            discovered: 171,
            eligible: 171,
            passed: 171,
            failed: 0,
            unsupported: 0,
            excluded: 0,
          },
        },
        compactSyntax: {
          counts: {
            discovered: 32,
            eligible: 32,
            passed: 32,
            failed: 0,
            unsupported: 0,
            excluded: 0,
          },
        },
      },
    },
    shaclJenaCompact: {
      schemaVersion: 1,
      source: {
        commit: expectedPins["w3c-data-shapes"],
        suiteContentSha256: expectedShaclIntegrity.suiteContentSha256,
        grammarSha256: expectedShaclIntegrity.grammarSha256,
      },
      counts: {
        discovered: 32,
        eligible: 32,
        passed: 32,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
    },
    agentic: {
      schemaVersion: 4,
      runId: agenticRunId,
      profile: "metaharness-semantic-gate",
      generatedAt: "2026-07-26T00:00:00.500Z",
      passed: true,
      contentHash: "b".repeat(64),
      executionHash: "c".repeat(64),
      implementation: { stable: true },
      artifacts: { complete: true, archive: { complete: true } },
      commands: semanticCommandIds.map((id) => ({
          id,
          code: 0,
          timedOut: false,
          testSafeguard:
            id === "agenticAdapter"
              ? { observedPassedTests: 18, passed: true }
              : id === "supportingParserSuites"
                ? { observedPassedTests: 5, passed: true }
                : null,
        })),
    },
    mutation: {
      gateClosed: true,
      baselinePassed: true,
      counts: { generated: 358, caught: 278, missed: 0, timeout: 0, unviable: 80 },
    },
    meta: {
      mode: "synthetic-and-semantic-gate",
      passed: true,
      contentHash: "a".repeat(64),
      startedAt: "2026-07-26T00:00:00.000Z",
      finishedAt: "2026-07-26T00:00:01.000Z",
      realGate: {
        taskId: "task",
        exitCode: 0,
        timedOut: false,
        blockedActions: [],
        durationMs: 500,
        stdoutHash: "d".repeat(64),
        stderrHash: "e".repeat(64),
        agenticReceipt: {
          path: `${agenticRoot}/receipt.json`,
          sha256: "1".repeat(64),
          schemaVersion: 4,
          runId: agenticRunId,
          generatedAt: "2026-07-26T00:00:00.500Z",
          contentHash: "b".repeat(64),
          executionHash: "c".repeat(64),
          oraclePath: `${agenticRoot}/oracle.json`,
          oracleSha256: "2".repeat(64),
          implementationContentHash: "3".repeat(64),
          artifactContentHash: agenticArtifactHash,
          archiveContentHash: "4".repeat(64),
          archiveRoot:
            `target/agentic-qe/metaharness-semantic-gate/artifacts/${agenticArtifactHash}`,
          archiveFileCount: 23,
        },
        receiptError: null,
        passed: true,
      },
      inputs: { protectedInputsStable: true },
      gates: {
        solve: true,
        regression: true,
        safety: true,
        cost: true,
        reproducibility: true,
      },
    },
    metaVerification: {
      verified: true,
      qualification: { contentHash: "a".repeat(64) },
    },
  };
}

test("full receipt checks require closed gates and exact bounded counts", () => {
  const receipts = fullReceiptsFixture();
  let errors = [];
  validateFullReceipts(receipts, errors);
  assert.deepEqual(errors, []);

  const stale = fullReceiptsFixture();
  stale.agentic.generatedAt = "2026-07-25T23:59:59.999Z";
  errors = [];
  validateFullReceipts(stale, errors);
  assert(
    errors.some((error) =>
      error.startsWith("MetaHarness Agentic temporal binding:"),
    ),
  );

  const future = fullReceiptsFixture();
  future.agentic.generatedAt = "2026-07-26T00:00:01.001Z";
  errors = [];
  validateFullReceipts(future, errors);
  assert(
    errors.some((error) =>
      error.startsWith("MetaHarness Agentic temporal binding:"),
    ),
  );

  const malformed = fullReceiptsFixture();
  malformed.agentic.generatedAt = "2026-07-26T00:00:00Z";
  errors = [];
  validateFullReceipts(malformed, errors);
  assert(
    errors.some((error) =>
      error.startsWith("MetaHarness Agentic temporal binding:"),
    ),
  );

  errors = [];
  receipts.mutation.counts.missed = 1;
  receipts.shacl.aggregateCounts.unsupported = 1;
  receipts.jena.counts.classifications["w3c-permitted-divergence"] = 0;
  receipts.jena.scenarios[74].classification = "agreement";
  receipts.meta.realGate.passed = false;
  delete receipts.meta.gates.safety;
  receipts.agentic.commands.pop();
  errors = [];
  validateFullReceipts(receipts, errors);
  assert(errors.some((error) => error.startsWith("mutation missed:")));
  assert(errors.some((error) => error.startsWith("mutation count conservation:")));
  assert(errors.some((error) => error.startsWith("SHACL receipt unsupported:")));
  assert(
    errors.some((error) =>
      error.startsWith(
        "Jena receipt classifications w3c-permitted-divergence:",
      ),
    ),
  );
  assert(
    errors.some((error) =>
      error.startsWith(
        "Jena receipt derived classifications w3c-permitted-divergence:",
      ),
    ),
  );
  assert(errors.some((error) => error.startsWith("MetaHarness real gate:")));
  assert(errors.some((error) => error.startsWith("MetaHarness safety gate:")));
  assert(
    errors.some((error) =>
      error.startsWith("Agentic-QE receipt must contain the exact ordered"),
    ),
  );
});
