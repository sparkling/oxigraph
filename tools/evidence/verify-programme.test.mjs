import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  documentClaims,
  expectedHistoricalPins,
  expectedN3MaintenanceReceipt,
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
const n3MaintenanceReceipt = JSON.parse(
  readFileSync(
    new URL(
      "../../docs/research/n3-dependency-maintenance-receipt.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const jenaSubjectSha256 =
  "182972ecb68f5d6e3868fa30bb44b860d50da6c135f2cc50e4236a2eb5876a63";
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
    "b6b176c674451451b8b456ea8fc1e81a4dc6e01f471858e3b912d7c0af0e61e6",
  receiptSha256:
    "7209da6a1610f4f5252de97d13f75b46483b88f8f8a754d0d30170a92b6c401e",
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
        sourcePins: [
          "jsonLdApi",
          "jsonLdStreaming",
          "n3HistoricalSemanticReceipt",
        ],
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
        id: "E-N3-DEPENDENCY-MAINTENANCE",
        sourcePin: "n3OptionalCommunityGroupProfile",
        receipt: {
          path: expectedN3MaintenanceReceipt.path,
          sha256: expectedN3MaintenanceReceipt.sha256,
        },
        result: {
          npmAuditIncludingDev: 0,
          npmAuditOmitDev: 0,
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
        id: "E-CLI-HTTP-NATIVE",
        result: {
          defaultFeatures: { passed: 144, failed: 0 },
          noDefaultFeatures: { passed: 129, failed: 0 },
        },
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
      {
        id: "E-DATALOG-MUTATION",
        result: {
          gateClosed: true,
          baselinePassed: true,
          generated: 358,
          caught: 278,
          unviable: 80,
          missed: 0,
          timeout: 0,
        },
        runId: "731e6467-2cab-4260-8d15-b34e4ebc8ed6",
        receiptSha256:
          "fc0ec6dbb0c8dec0b3c9e2d58814372c8feebc8ec291528df1fdf432879b2ba5",
        contentHash:
          "88de934ca8eba02ac985ab7bab25e7ea98d8b5412ecfcb623261b27e7cfec308",
        executionHash:
          "cfe719d36a35d22325ba980690bdb1a5e6f69303dab3761f54b043744139353d",
        inputContentHash:
          "9898ef56c90cbcd8eef9cd490c2d63c9ed42a9a96c5ccab39d99ba834d707c3d",
        publicationContentHash:
          "7e029baef4c99817d7ea126e852e4b280591d985d61effd97f78ca52f87280c7",
        nativeOutcomesSha256:
          "edce7e97639bb40aa3846031d12d4e8581eb644a33962e8d6468b00cf81e95bd",
        nativeInventorySha256:
          "ff5244d9a7386627731f193aaba76d91b923590421551833d959c9bb284cc052",
        configSha256:
          "26cb0050c153299e5b98839c1a620d14deb25dc23ac765813b476acbb7825084",
      },
    ],
    qualification: [
      {
        id: "agentic-qe",
        versionPolicy: "latest",
        resolvedVersion: "3.13.12",
        lockIntegrity: agenticIntegrity,
        adapterAdversarialTests: { passed: 40, failed: 0 },
        semanticGateCommandInventory: 41,
        parityCommandInventory: 47,
        reconciledProfiles: {
          agenticAdapter: {
            passed: 40,
            failed: 0,
            commands: 1,
            receiptSchemaVersion: 5,
            freshnessStatus: "current-scoped-subject",
            sourceCommit: "5a93890f792f908da930e97fc3b1e7c910fc5802",
            runId: "5e6202d7-e020-4af9-ae0d-1d4c8704a28e",
            receiptSha256:
              "0f1e3204b821acbd9f83f88f21afbe2cd9b60f48e9154c14c3f1e7509b261d05",
            oracleSha256:
              "28b3cf49bfd7af8b4626d085d76745a0d4fe345a15a29ab471bae45e21711d05",
            contentHash:
              "c110376a07c11f329011950342db5a9bce78c9975252015dd1c854449482687f",
            executionHash:
              "0684c7b14febafb35707ed0980535ca2fbd5275e165946aba4ae10cafde78230",
            worktreeDirty: true,
            independentlyReopened: true,
          },
          cliDefault: { passed: 144, failed: 0 },
          cliNoDefault: { passed: 129, failed: 0 },
          persistenceWrite: {
            passed: 45,
            failed: 0,
            commands: 7,
            receiptSchemaVersion: 5,
            freshnessStatus: "current-scoped-subject",
            sourceCommit: "5a93890f792f908da930e97fc3b1e7c910fc5802",
            runId: "73b6a484-f830-49d2-b4cc-de1549928613",
            receiptSha256:
              "9f79554a22121e96b90c0861de7b9ff10fc64a2889590c52405de8bb05144ea7",
            oracleSha256:
              "f5cfbf2689d95c89098ce836c2f93f0597176c8d24a873221c27ef60abfd3338",
            contentHash:
              "b8f70d784e13c1af5db2fca853f5c6324543c2e3c7f221f7bc7de83c6e7e11e7",
            executionHash:
              "4daf9149c72b9d556168b5ce1becb646df9f73a97f2e19b15f2fc8fdd678f19f",
            worktreeDirty: true,
            independentlyReopened: true,
          },
          g1Regression: {
            passed: 66,
            failed: 0,
            commands: 11,
            receiptSchemaVersion: 5,
            freshnessStatus: "current-scoped-subject",
            sourceCommit: "5a93890f792f908da930e97fc3b1e7c910fc5802",
            runId: "34602f2a-7332-4649-aef0-d51029389cfb",
            receiptSha256:
              "0b74b063f11b82762fa2b9501430a8eb2db69797eccb28e83c025835a9453fcc",
            oracleSha256:
              "b63b707204fddc365820334ea0936809ba020c7a58d278a53ec29043ae3762fe",
            contentHash:
              "af605096f4ffb13c3d36dd38ab6275a850a59d18891c3c628f9673075e147a64",
            executionHash:
              "828e385bcabe4339594d5cb55e92c108c7537c20b1e2233e765f0d969de357c0",
            worktreeDirty: true,
            independentlyReopened: true,
          },
        },
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
      n3HistoricalSemanticReceipt:
        expectedHistoricalPins["w3c-n3-semantic-receipt"],
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

  ledger.evidence.find((item) => item.id === "E-DATALOG-NATIVE").result.passed =
    58;
  ledger.evidence.find(
    (item) => item.id === "E-SHACL12-RUN",
  ).result.aggregate.passed = 316;
  ledger.evidence.find(
    (item) => item.id === "E-RDF12-OFFICIAL",
  ).result.categories.rdfSemanticsAggregate.rdfsRegime = 25;
  ledger.qualification[0].adapterAdversarialTests.passed = 13;
  ledger.evidence.find(
    (item) => item.id === "E-JENA-PARITY",
  ).result.classifications["w3c-permitted-divergence"] = 0;
  ledger.evidence.find(
    (item) => item.id === "E-CLI-HTTP-NATIVE",
  ).result.defaultFeatures.passed = 143;
  ledger.evidence.find((item) => item.id === "E-DATALOG-MUTATION").runId =
    "stale-run";
  ledger.evidence.find(
    (item) => item.id === "E-SUPPORTING-PARSER-SUITES",
  ).sourcePins[2] = "n3OptionalCommunityGroupProfile";
  ledger.qualification.find(
    (item) => item.id === "agentic-qe",
  ).reconciledProfiles.persistenceWrite.receiptSha256 = "0".repeat(64);
  ledger.qualification.find(
    (item) => item.id === "agentic-qe",
  ).reconciledProfiles.g1Regression.oracleSha256 = "0".repeat(64);
  validateLedgerCounts(ledger, errors);
  assert(errors.some((error) => error.startsWith("Datalog passed tests:")));
  assert(
    errors.some((error) =>
      error.startsWith("RDF Semantics RDFS-regime cases:"),
    ),
  );
  assert(
    errors.some((error) => error.startsWith("RDF Semantics regime subtotal:")),
  );
  assert(errors.some((error) => error.startsWith("SHACL passed cases:")));
  assert(
    errors.some((error) =>
      error.startsWith("Jena classifications w3c-permitted-divergence:"),
    ),
  );
  assert(
    errors.some((error) => error.startsWith("CLI default-feature tests:")),
  );
  assert(errors.some((error) => error.startsWith("mutation ledger run:")));
  assert(
    errors.some((error) => error.startsWith("supporting parser source pins:")),
  );
  assert(
    errors.some((error) =>
      error.startsWith("Agentic-QE persistence-write receiptSha256:"),
    ),
  );
  assert(
    errors.some((error) =>
      error.startsWith("Agentic-QE G1 regression oracleSha256:"),
    ),
  );
  assert(
    errors.some((error) =>
      error.startsWith("Agentic-QE adapter passed tests:"),
    ),
  );
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
    errors.some((error) => error.startsWith("Darwin qualification integrity:")),
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
  assert(
    errors.some((error) => error.startsWith("sparql-1.2 closed requirements:")),
  );
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
      ...(id === "w3c-n3"
        ? {
            dependencyMaintenanceReceipt: {
              path: expectedN3MaintenanceReceipt.path,
              sha256: expectedN3MaintenanceReceipt.sha256,
            },
            historicalSemanticAudit: {
              sourceCommit: expectedHistoricalPins["w3c-n3-semantic-receipt"],
            },
          }
        : {}),
    })),
  };
  const heads = { ...expectedPins };
  let errors = [];
  validateRegistryPins(registry, ledger, heads, errors);
  assert.deepEqual(errors, []);

  registry.testSources.find((item) => item.id === "w3c-json-ld-api").commit =
    "0".repeat(40);
  heads["w3c-n3"] = "1".repeat(40);
  errors = [];
  validateRegistryPins(registry, ledger, heads, errors);
  assert(
    errors.some((error) => error.startsWith("w3c-json-ld-api registry pin:")),
  );
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

  registry.testSources.find((item) => item.id === "w3c-json-ld-api").commit =
    expectedPins["w3c-json-ld-api"];
  const n3 = registry.testSources.find((item) => item.id === "w3c-n3");
  n3.historicalSemanticAudit.sourceCommit = "3".repeat(40);
  n3.dependencyMaintenanceReceipt.sha256 = "4".repeat(64);
  ledger.reviewedPins.n3HistoricalSemanticReceipt = "5".repeat(40);
  errors = [];
  validateRegistryPins(registry, ledger, { ...expectedPins }, errors);
  assert(
    errors.some((error) =>
      error.startsWith("registry N3 historical semantic receipt pin:"),
    ),
  );
  assert(
    errors.some((error) =>
      error.startsWith("ledger N3 historical semantic receipt pin:"),
    ),
  );
  assert(
    errors.some((error) =>
      error.startsWith("registry N3 maintenance receipt hash:"),
    ),
  );
});

test("key JSON shape validation rejects missing and non-object documents", () => {
  const documents = new Map([
    ["conformance-ledger.json", []],
    ["normative-requirements.json", { documents: [], requirements: [] }],
    [
      "standards-registry.json",
      { claimPolicy: {}, families: [], testSources: [] },
    ],
  ]);
  const errors = [];
  validateJsonDocuments(documents, errors);
  assert(errors.some((error) => error.includes("conformance-ledger.json")));
  assert(
    errors.some((error) =>
      error.includes("normative-requirements.json: missing reviewState"),
    ),
  );
});

test("N3 maintenance receipt cannot relabel historical semantics or mint authority", () => {
  const receipt = structuredClone(n3MaintenanceReceipt);
  receipt.historicalSemanticEvidence.sourceCommit =
    receipt.transition.selectedCommit;
  receipt.publication.selectedCommitReachableFromConfiguredRemote = true;
  receipt.authority.semanticQualification = true;
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
    ["n3-dependency-maintenance-receipt.json", receipt],
    [
      "normative-requirements.json",
      { documents: [], requirements: [], reviewState: {} },
    ],
    [
      "standards-registry.json",
      { claimPolicy: {}, families: [], testSources: [] },
    ],
  ]);
  const errors = [];
  validateJsonDocuments(documents, errors);
  assert(
    errors.some((error) =>
      error.startsWith("N3 historical semantic receipt commit:"),
    ),
  );
  assert(
    errors.some((error) =>
      error.startsWith("N3 semantic qualification authority:"),
    ),
  );
  assert(
    errors.some((error) =>
      error.startsWith("N3 selected commit remote reachability:"),
    ),
  );
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
    ["n3-dependency-maintenance-receipt.json", n3MaintenanceReceipt],
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

  normative.documents.find(
    (document) => document.id === "shacl12-core",
  ).sha256 = "0".repeat(64);
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
  const names = new Set(["README.md", "0001-first.md", "0002-second.md"]);
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
  const agenticRoot = `target/agentic-qe/metaharness-semantic-gate/runs/${agenticRunId}`;
  const agenticArtifactHash = "f".repeat(64);
  const scenarios = Object.entries(jenaDomains).flatMap(([domain, count]) => {
    const total = jenaDomainAssertions[domain];
    const base = Math.floor(total / count);
    const remainder = total % count;
    return Array.from({ length: count }, (_, index) => ({
      domain,
      assertion_count: base + (index < remainder ? 1 : 0),
    }));
  });
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
      schemaVersion: 5,
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
            ? { observedPassedTests: 40, passed: true }
            : id === "supportingParserSuites"
              ? { observedPassedTests: 5, passed: true }
              : null,
      })),
    },
    mutation: {
      gateClosed: true,
      baselinePassed: true,
      counts: {
        generated: 358,
        caught: 278,
        missed: 0,
        timeout: 0,
        unviable: 80,
      },
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
          schemaVersion: 5,
          runId: agenticRunId,
          generatedAt: "2026-07-26T00:00:00.500Z",
          contentHash: "b".repeat(64),
          executionHash: "c".repeat(64),
          runtimeContentHash: "5".repeat(64),
          oraclePath: `${agenticRoot}/oracle.json`,
          oracleSha256: "2".repeat(64),
          implementationContentHash: "3".repeat(64),
          artifactContentHash: agenticArtifactHash,
          archiveContentHash: "4".repeat(64),
          archiveRoot: `target/agentic-qe/metaharness-semantic-gate/artifacts/${agenticArtifactHash}`,
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
  assert(
    errors.some((error) => error.startsWith("mutation count conservation:")),
  );
  assert(
    errors.some((error) => error.startsWith("SHACL receipt unsupported:")),
  );
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
