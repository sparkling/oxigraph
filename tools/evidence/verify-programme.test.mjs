import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  documentClaims,
  expectedCandidateShacl,
  expectedHistoricalPins,
  expectedN3MaintenanceReceipt,
  expectedPins,
  expectedShaclIntegrity,
  validateAdrIndex,
  validateCandidateShaclInventory,
  validateDependencyClaims,
  validateDocumentClaims,
  validateFullReceipts,
  validateJsonDocuments,
  validateLedgerCounts,
  validateNormativeClaims,
  validateRegistryPins,
  semanticCommandIds,
} from "./policy.mjs";
import {
  candidateShaclRevision,
  collectCandidateInventory,
  collectCandidateInventoryContents,
  createCandidateRun,
  writeCandidateArtifact,
} from "../shacl-tests/inventory.mjs";
import {
  executeCandidateChild,
  parseEvidence,
} from "../shacl-tests/run.mjs";
import {
  verifyShaclCandidateArtifacts,
} from "./verify-programme.mjs";
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
    rules: "sparql12-rl",
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

const oracleRepositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const oracleCandidateCorpusBase64 = [
  "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",
].join("");
const oracleCandidateCorpusJsonSha256 =
  "ae9940db9c1fedbb17463d26c538a2fc56e72a60d5c0840e08508d19a19a15d3";
const oracleCandidateGitObjectsBase64 = [
  "H4sIAAAAAAACA+y9x5LbWrcm+C53yoogvBn0AB6EI+FNRQ/gPQkSBGGevjeVmUpS0tH9O27d6ujuf3BCRxS3W3uZb7nN//k//yO99H19/4//8R9QmhZxghUIhSJYnsVxitMxjCBkQaUEFGd4QiZJQdHgq5msdJHNzIZjbke+a4ytRQwpxHQ+a/XehHVfX458uOqNVeuSWIdN1YSN1R0dr+bObJX23pRxbKfzXRv2Sq37Vh36Jmw0XaXzHvhuiBkS+KzxeqNxN50XUB2Jar0pEa4X4UyqHmnNimlvdYnN812PVwnHUFGgtJEPP5JeHHVHZBLUgxKJfsQr3iQItDuAeY58ixl8u+oOU6obs+o8o4YIfU/8Dsokbz0I2ZAJFRzWDJX09BoF7Ji77DkOrEvmH6bnd081sxhbiR95E9cbYT5w4wzmm7k+myPUGKKVuWs2dNdcRbSg7ngQWdnlWMd2s6PpWZ7buh//bl5KrmbRFIoasxVZszVY0xM51x2W9OzCRmvY5iZWrpPBmeN5sbSwpius6TmzTHfoXSiKVVSUU6G7pK3CR3IlZIFiZxwtg3k3XawIE7LqDBVRo8VtP4js1IeQSCqx0MXmo5gtNkTdTNhSnN7ccv/eHWXRi9qoNv12TmGR81p9sxGR8B0F1sVwA/OuNqyM6nqX4s2Y485EjfrO5dwddT3WskXDSrZoS3slirxMjMWusuHumPtLHUKWnG4prDtRpG7G0Q2GOuGtg9W2z3mnsL0/AA8sIZzebHdcEtjiwi6rcp5BM9iao0C8hYh19NrBsJHw4bp3OeuUFtAJsXrLcITKO/oQ7AiWnvnZDM4VgHkR69zVDmK5LmJVlgPohYr2URxiXWyR2M3WrF+uLmrdHFFYUtESDOmCpUEWpAiue4JyiJyIt5ABtUVRS9w7Z4iKB+aN7R4XjtKC2rLVR7B38SVYTntc9iQcN91IMPzINaAOt6XO1qES06BMtc4p5kBR5Mssl2zeQ4OEOXVD1N26PhIrDcx7SwMTdmHrbHqdBM42556HmOfhavW4aW0MkDNLjc+G4ctWpMOWkchKEG3d6jnKZHdD7LiVrKFdlDvG4m6KkfBV/OSz0B0MvXM3u7HURFTONlyuLt8JdtO5SWD0OtRJeR/eNNSTPShrTXRo7SAyvNZQjS0L40BxQwQe/NaA8345mND9DObVbHh4RCigoDRAqWu13jl7HD1wn47IWZ0Yx/1dNbzhmp2NUwpVvANfVvNsbYakhFkQziZqndSVth3Ewxwfw/2z4j75QUey2hYWyUTudupVrb11WN4unN6ma4RYegwZcgotlbPSWtZYV8sfZr3PwDz6lksH3GjYLt2M2pVcRIVo3earDszbhk2JxefunHkeBDhHs6To6CKGH8KDcgw61pDuh5xnL27Q1aYXsR4fcVYjTirkqdZWGSnUwb5PP0xUsRzfmhJ4YMG8TiRlSOgekLyxWsMzRl8wiDBQiJi5lCd/QH25VQ8c9EP2LRcX/qoXysFLEbf0kO4WB2wXSV11EKwqk8QxQdIS6NAe6Lsu6Y3uP/7P//E//+N+y/OnGscxlKJTkiawgoLIDMlwOIUpAkGwBIqThEoTLKfxBHzV4JkZqL9S64HKk4DKK3ntokb0gLgMDBiOaDx4xh2tqA7tjhfAd0PI4JgpQjoo9rMpQZWO0fpQpRKRPjMsqcwyFZmaKZId4aD8UyUajQkdBONkCV4B2L4wIfpoiR7vcfg9YhiBZlHhhFRiSZ0Meq+UMTPugtpa8e1rPZZ3INx1247zPKCm2nRKfJNBeTU7O3vhZJyZWSt04eL1cMvip9thAWdCDN4sHaHjAZkdy36uxTZ7XOfbtmQhwxmu9PngNJu0H9dd/r2Wbbmi4LjujzUkIRZGP6uWw8nmFdzJTiNxv7PmAyhs/Uk7DrBSYFVaYFxCcEXpCkNRYEDg7zAwFx3DOOy9ezjYVrkxoUVt4GwLUDpI6ThftI8kEQpteIslEag3/Z75xsoYR3turl49XTTucrrfFR+qJ98c7u7yNS5FjBWwBZTOQNfDCe4dMxSbGT9CTFUi1OsC81eJN5/fnQ8y2J9vjJov1ilqreD/n3vEk7NV5Qx/dSQUpWaTQnQIZdPFoEt0q+GdETS/je8ZdYkLMvSbC4OryG1ulFpZ1IXzXN383ltVhch8f5rKVBKbjIOBacGhMCiZbf+wDtvjMS07L2rkB7rAcn3qLKcNv2j6pEWTcPA1nRn+RFiFQK2FEzo26t0urIj5yYM+Kb/tbdgSBB8jDgamHgf3UEGMptRYn5DDcWsw4YFDI7Q1+5W+kTful70yFxrcwbUTrqkbhMU5v2e6yp79gRXN933xwqr5xiN5woySrQTkwEiPZDzouePt+qXSZFvlrUzY3venO4cnPdbI5IYHraocUPRbLBxNIZmZaLfxbVomfxqD6kwEybik0QObFB1JsIXCZijfBYVQtn/YWzdFvbdGPt5ENrxm/tKlM3s9Xqmu6u+80jqwdRfmjszOruD7avP7mgD2tGBsl8vsyqh+PeywAJePD70ttuJCK/qpD+/sefqFhotew48MrJ31XZfN/PEeRpbYn69IACs74XDcaTcpPuoe6vy+Ziorj6jvxtjHzwwfXDNzGifEaC57M1fK1bhpuBDFIf6HNTfAY2vqz8yG6CO+aXG2Y6Rqz9GattHofRwvrvs7nYB8pqh5T1EP6D6Xwa7ztDNp5IZx1vEu3R/96Y6hw4ycwz+M9QZGxQb4dFk3ZmdERYSQLtQW7IlM/dT+wx6RBDGq8OyNwBwMQM6Zq7rnlYPPulZDqEmGpBhKXDPj4G7Cz/U+z/UcvyYMy98rkRX2l5H1ZAcwj9JM0wRPtCD/pKcH9JY4POUa0LED+jUCE6rbdUSKEUEKZdrGbaxWxzrkzU+dB6C1Du6cuoc9WA9o3qxPmWIvQavJnZYsguak7kfMKtEE3Q/J5ad+zTaj0fqn3GHMecuwwxCakqqjynyiZ+ReGncTle7p//FqntIkhmKCzGKSwCEoIwkMIfMYxUk8RWksTcgcuBzAcoGv/jQfMgsn0lIAi7dkvrdlIg0BlD8nQHVGP1Q751KdWJLHAtpusLVjkeGMVrIZ1YzxU6SyR9rfe+ANoEAcMhFqXGbaFQ1bYXt36jKUy4yRplPm/3jbLp7BJEZlGITkBQ0cIZgiqSLDkhgnSRKiM5RICzIjodftSk8HhQIc7dWJ1G0xB79pjrR3p9yHR0aEewnBnY2kL2WzJEUmHflTeL3JXPOvzYU/Ism9A003A9JsKdI9krP+MTeniie6TK+wJms3/B7g9yb3ro8O1qV/ae7AmAGnLgmH4wmQLN6ICZZWzhxAawLlknvTNOPo0q8M9ZMbwgA4Wys8Z74yxsAi/pzjx3zKqJ27e8JwI+uj2l69+AQpwaM0nVH/dOb9oAGo/YsjvywAHNswEvrL8LSSsU9PH3PwW7Bu15srjSuPnPpe96daQhdH99L5/fogLIUTAk8yNAcmDseIJEYymgZ3WqApHqMQnsUQlqGv18fhT19viBD8eVUMBpP1cpbcB7cwPX1MF8Zfw6s2lPT88+jamV0TZOhC1GS08SSkcndMiiJIdqisYXfqmkvuqTB/ft9tgaMkwKIGIAvDHmU2cht9AMrIVS+6HWQQbZE3/KkYv64KKHXJw7S+gp7XUUh1/IByg0ztgbu4fDjvGqKQihQ+fCmPaxhE1TdI4H29uBSBoM6jcIxkzmTqvZtYKGzo32S/h8D/eyrhyGQz1WY4A2dijZcuMWD2yyDibBj680+DoXSpRK+ZrDMOKZTTwIi3QMrxjr5Vvnufe22tu2/Fm8lgXsAWke+B/bDheaU6WF0eu5VCH1HbGcCvEU6XQvw5/1NBA29HLFRPQG9TiaqCw9bRhPOCfxUaWzVfrzojULiI4QJPMSSBEghDwT2nCAZBVFLgcIKRZAZuGn6TVANIkHcHbs2aoIcPvPI8Fmp0EYcD/MGdEnKslLna3+pBQo3MKcCOVGoPn7715xYi4ggUUR8H5RSfdQY43fqwJDG87Mp0Lign6aBb1E770+GNO7EigREoiWkIwuOMhOk8J/CCSCicwJEs",
  "RQikQKgYx1+3LBoH0zV0y6sKyxdX4MV93IJIO7Yg8g6HQ5k0M/gw3Iw9LtVy4zE1wR2RyRlwCMOsby4EgjVmEtCnsj5lsjUyJ1mVslIZ7hvSM9OZZFZmHe0+PtynV5I9lU1kw19C2oU/hNuCgGA6BpL4gXlyd8lKLpVdR0eK723LsH66D2yboNYUBdYaSeH9CypGz7N87t10qQMbBY7SLXpxlGFW4Eb+wteyUP7c++v3UT8/UeYCWYRZ4cHd4xchgbUHxYfY+/e/OJbDgWJ5jl0whqUganauwKFbL1iEyqMP7l47KtfwRQnjHfC6zn8+M4siBL/Dqx5pzKXtD8qMiJNcm4x+/2aROQ++YKpXpf38QW/pPhrxrkyE28m6z5JNlkazqHVUH3fftk9po7M3xYH5R1qN1hFhOEhWqEegWnvzYq7nu7c/jvH3PT/HZYg3AiftGc16pGfzY31BqYmcsCOhVHK5imiSTsttvov2UH6vbz1SSQEuQ9dqfzqDhiYQ7zQTuafOhceV3L7vQnnFdSJ6s6MUXQBuxjMsTomiSJACJROgiREcJVEIpWDoKbsw8c/SOYUoUBHc6UpDsNBTQLQhwtO68WK16rG53ZcXuIBHCNwBFFRkslKFK96kAEUv10jUbLtouSszyllCsYa9UsNDFcZvUqEWngCR0HpjA96HC2XCSCeJryJHFb1eD0v1gHGnyrryF5hApjGOYVmeAHiTpTEMoxCBEESeYygMEzEFMASC0NCL0/3hDPC93F7vrukK8anzPUwOWrYZCurosc2rXsYHAOq37PPWOdWvptQVFfz8SNmqP2IwSmoRYMzLr+CR4WJGMa7Q7BT1glp3+nKbRC5R4ji7vB0hJ+AcA5/iMAT0BEEVNNBCJAVnJCA4ldNkAQAaDhHvRwD+3dLlwFLY/f0hqZPa6lNDSTIsXOgLKYjK4vzzMfZ0mESMIpOk45KVKpjowdniC5VDP80GuH2jYRgj0rodseDT1hOE6whpKjBWv61H9msvP3wWkyNMhQkijWSY63zOyf4BawRGnCiD/YmR2SqTSuZU8Ox5IwQiU2muhvCru7/wxoB0zfy1NkBVNPDJFSg3eQJtSneKOIaP9bt2uyHydhVlKSy6n/NaQCiy7mkOEbvqL8V44Kig5qqxp+M7rYsOxYQ//bV3VBN8m9LJ5nUnvgYjKhRaSVVlpNCeiu/znfB2XQCTxkRCFDAVJxSwIABXowVEAPsHI1RBUHmKwRidvtkOCa6Svut/hCg+dNfUVrjvn2qg6iupzcIHN85niWrm5PvaniR4utZdLok/rvtzbNAZxeW8Px/LwKOblnKvo2EflD6I+N+A3Nefv4RLPthguWXWgEob3Xm0jd6C3Aw7/njuNeTwpsOeuu/zzw/dc6jN1E3jkj+Zu56nm8jSql1ygvCD9gYCUZxGcrxI4pQEwozSSZzTGJZiJJzCEOB1gOERoILeSGV1zyhJDEAUMJGtBj7X7Y/tlsrNIOz4cQoG0m/mVRsCgbgfbHfUv82N5FUhag1ZD1wU37yDz9cPsjFCz7on9WZBhHFtNxhnaUo56jwk5X8R+P1+4c/HtCtaKCnPZ/aqlNxameG2fJvExH/6AE8zBYF5hA8ScdB+dIJM1cJAUkZcUMqLvteCYRr23/rS6J5eOwC9+Os5/Q2/Ncrql9K5FNJkqMpxpHsXoNXXa/EQwB5DJrcvZ+Tk8UoG6ZRBaE1ZdCmZbIS3PPhrbL7rzSTGIKBegBeY5CkEIXGKkGSS0PHTx8oTKqeKAsqgdy4WgRy+HNHgwwgpJfJ+cvYPOcEuqq16nefYSfX7mMMn0rFnyRijuZSdeN4XTpT4cbeh1d6jX8wPcNaN7ZUkVzwPMqEXIzO/wraiez1Ecd2q09M3SUJkqYC5eSEHu5AeZnjSJbrlKtAyvTtH/Tkmukr/vvIGeLNbuj73+InG2HjLd+AUWhMRN4PNTo8c8Prd5ej5dY/JD7D6Qg9pms55o1gXo1FVyYBG6q4xrJrftObP4z5pYqQTQdopgcZMWJSt2t93AO/vL8E6vIjFM/4M5UB6X+linr0VFqmU7gQl2mGkKFrlo3H3VCm8iIQIAenHU+CyvtBmAsxV7dmwXA7jYzU0zITj7J40ZvqtgVpgBK4J0k3Z2733LLDLua8Ky0SUpENlK+deh4kzXu7wGTEQxw+6fo47UE3XT4a390+O2NyHvW9Nmt2qZuV8j6uqFI6qRPbezskNnXjbTUSyf6gPOdPNbmu7m7qt6/c5Yx97nm/5FIXTXedEJYVCcS1KV3ROcZMdTqhNHL615AjE/Qz2eY7cbnpdb+KjTAkjtM4uj4vvX+75vmUsXV9o6kXsxSn2o2cw6+N8Ik/rfoYWTf3YhWx3qu6Se34gvhhzr5YgFzwM8CrAUR3ypjLk+SaikrZwvJblbtBmGlcPYThT5ON9fDf9cfxJ1zsu8Je0TRd+frBcrWj+leRSWXofv3RJn0Hx651qUFTUHrTupdxMjO4EPKLatNP7jnmRZXhI2n/a+yESTXMOaJLSnBEQHdlwuGzPYgm/j/+HvR8P1nHPcjPMmj48m4NaN/GFmE9uhv19/KcMHfsLQFG63U2nk6F0jcvqnc7iRRvc/z7+U+Z5dhywxxD02ZTpp6PZIRYPe6u8c9f38X+gnex68q4gD+o0BOHaZ3cjp7DzbePGF/n9CBm98CcCL+nBB8ZWZXuiYR6JmDV1pEQZ+i1/U4JYnQ3k703PMOypIZS0mo4KkSTVKXwYKS8pwJmyX9d7k1mxFoyROuojkWZ1cb7uEf84H+wLQ5S/j/mkqU7z4YqO+w0W7/oW786js5vddDbZF6+UXl/lxvJWPWL51H9w282E/BN6n5aFowHG/DZdQB898/1J/bI/Xg6Kx/JYs3NXCkyHxH19FoxBHS/Ki3tRZc/YRI+96DEAEAUk9kytgiRLlwpR5tzSK9vb0n8nl37oIiCrwyckWDT/qU+/eM/2dBG5jrHseWKZyg6axEauZbXwLbeyCP8Ajn33pfN/IKL06bJ87APS1aI8CJymVCLqxkTajwHpNaPAOn/Zx4cuvtYpF51ttYvPO8GNmIhUonvGEvn6rauwJxJ8pXVuClm9vxQ01NLD7hHPAJPxN2YAEP0nrXOJnoD33GYBC9Y1wJnd+0fi6zNaobhzEF+XS+a5Pjtnp+x+gbE7cjAPf53jl7NPK+LRwDvOcAXZk+iNCsXrhHb1Jje/7N+3YIBkhxD5EUH+0O1RbwYLQ/bzdexOdoJDpm/dd0EfhW+QBc0KKIXpAgXSldMZkgAxRDKUjmmsyCkofUa2aQJN/wq8GcrwCJkMqzgeeycUQ/RQVcdjf78036Segbm8aOCqfrApQJIAjb6RnqgjxMIwlghMSI5OS3O4ATGMFoIM39g8/pETewbMPex1/JID7EfO3CRf5ZJfUl9L111cIpk1/n18/QnkP8hOk4cFw9yhWGmYTjdBWq/WvWgG8YXlPs9iPBJwfVFQfojOL47ALq/PR7r38825YWZ8vNKxD4C1F9/S/2Q/nyi52HYBg6vtZJLAOTBi/KiGtzKn7fnX8UNyBibzbLzRc9Dt0bFMrU4RfVWQ3WM8YLTcbFD9Gz0fSe+d0hZ+hohf1WkAH5lZlANJas+VvW/r8wOGrD2wJtsvtAiMLg28H+n71z1E+WK3NZMm/lJ2PR53J86K1GkrDr/RYIsCEf7I872oS+HWx+EjxSwRh63BAn5pXxzu695U1jcVJpVAfH4kVIApAuIoe4CeXQP29raf0o50j6Kzjuv0qLjEEiaZhKA9Bvf3/TyjLcAsvY1XmLNmyiOVRatoPfxdsZ8M6cQPMCL8ffznnZoDj1NxWsxqPBfWLg1gXo732XYfflsfTs7e9mfVesHm5JGvpEkM1aOSBWEkxnM72d39V5pkPg7M8pfH9zMv/2nyYr6Wk+1WYyUhBvQhyXStvZecNB7+Ps/HWexJNVvnfFmVI70hiN0fBU2KKR/XDr+ehQBe1cNBFeNZY/F2H9AVpxx0YlkL7Qcyz9q8aEnUh14g4S9znJI3HmUmp3FgaeobxNiMC88S1wVSalqO0V+iWkWc5cAvxhKahigI",
  "ymIUyZA8iQsCLtCYAgckwP/Rf/XOxGK6Qd54F3giQ72yE/tQKZfGapnub56Wiuf7soFMr6UzHiAyrO/bDPOBbxD+k0fxeTx+GZPSpfoW6+Pdmu3mGTnfoiNS4uNLDPqpvjK5m99E57T4BuqcUBmTVDVQNKulmmaekEfP/aMH9Km63CEW2e2K5LeCUti21VHlOg9JowR/9oBifxk1PwLqAwaW/E2ddjp2I2pkdvgHLfp2KDmoYyE7opidP+0fqDJpvkc9vSa+1/6qUg981ChtZCpXzej3MY+X/M6cpBY/t//Cvj4toyTkdtgBVaZIwzbG3rnF4+ISzvBrwKPb4p4GavUVUXDaXqps6NY05UXe6ou0uNAt9e7XFv2+i6caBJ6W/opEWqbdXN6XqQ0pzBqojSolqcfCYOfvceCchg/QEPzufeyu/O2xpsH1KNUnJ9TWu7nK8aPL4dds2iuvbbRB7VC83J9SFXOpy32CBd1GShf7vrvkydeoV0WIp7whRoYfkHAytt6ndAqNfIo5sjud39jjy3rLM6XkAlXyti6MjChys+H1kFjpHsXM+2Hsn8k6BnpZ19tS2LqE/iva5ArDJrd6V56IM99qYoNjotmyxxgXvnnkmW3bPODJJi29WsEP5PgmY3M8W7IukxPjBjyvnkjIw8sdX4hO+s/eJWMYipNbPu2pj8veKpBHe10lK3oQ9bt3ZzyACoRe13N7lyaVGD9wLeRDPiK4stNtxbwE7et6mInQ8CcffQXNGoS7yMN8Wlj1KBpGfdnXmDXrO+cFXd/DoBJzoEuywBiyN5XHyl5/PV3cGtogrjWh5az3LMlu9J5+H68Ac/yH8czoysWcKTfT9o7WI4vD5ezJizO3Nv82Xo+enrxUvntYmn2iOX+5PQK3qqB+qFPSdB7u+hIaj32cT1DvPcIhlaezMMnyNagls585syqI+3J/2Jv+7g2+0PrTbMKasxzXVRlF8QHLNKGFGX7A2RsTv95tN1lB1SSyt/0KLRulh46IMcU2euoezh74IOIM4PguZ/4+/nN9pdKqqHJNkZDT5aoOB3fwlZ4hTyv2Nt6RPCBXAA69rM0+VAmbiC1zNHgbo3oJ8Zgj5b1+fZHHHyVKr4FORWznacyIuon48eDzJ/XUUbT2uB3/4P1+eW2zevL2MLvwdaIKnKiKGrzfbUwt9c1/4v0apihm/MRxCzydrIPubbcb7OVDQz/+0fvVbib+GHP+vo/lCVH254it07lRlvvxnzxZvSFNOqhPQoHsL1uGpYPbBu6OtqdvSPtMXX/rcO9NxlGxhw6iUC2HEY0dd37s0ttYciLhjH/3hLmluYWMGd4H/GKj84hdrvvLdebRFP27J8wqDXchRAZ6XKAHTB+DQOLTw3zcTtcX1+ZnauX1DnWY3LvaDr7O9XyLayXqvZmMUHsWxT96wMI371t/tD8Mg1hzW3exJTYBoLR1nwhDQRUMR/7olVsf9sT7sKFvrta9QaX0uJEbS1bpJmKkzbH98Y5B7jcdn3ZM6voY2GGvB26b7zkf8NEQ/hjBZLfDSsnSCbtvbLp213KtLxYaKBKXf5/3mfsFMN9dADROX3HOnmT2M6Wy3tJUUiVf8lE/KkECq/I3nWHgdj4hvv6MMP7uurHGeD4el5SMdqbh7JqiILR6w23kXmx/neMdFku2YXOyYkkPFXr0wNbqu4OT9jdFvP3lHF8yyI7FkdQeZrjuCKQnerPBj6O9PzvTL8U8GY1QBBHDRQLQaJLiOQLFcIIQBR4nZIZCOFakEPyjQeWfPW9+yoYezYMHZc301UWdrM5OIcYhavliCjJ/Ad42MKHez6zeq0pnrxHBMtSgu1515JA6aWr1cM7cTPieA4ijco4Ci/8O7H95I7I3eCtE4wMWAxd05rkcb9kFPuLIS9r9Y13hAxrbP8rduuZZBvDC3uL62LRJpWp9TRvePl8GGd38Cr29BDy+9nF8qrFXlgbO835/IladtmMinmQt8SrqoQ9F+G2OAdRdAeSBHES5Rr4BpRDdvwXEc/IaeXxTdXZrZ+RsbDAN6bkAlMRvc7ioV8e912SycYpeVY3CDlQwMmeUI7xZUEadFM6zGOb1yvxGD9GAw/5ZaGVtDhK+slF7i7dUobf7khW4v3Pu9jqgUHFS119K+hIagdIUy+KYJhOUhOECyaECgSmYRsgMx+KcLMgkh//KRhzY2yWYtF4JzZqxlelai7fH8TjPePOW/VyfDulrrMvtj2dZp/WDd0GMq+VSSMTVR6eakPkt25n2v6N55WGjuqtVhop213FB5OVBcZczhNTM72M/9jnZs6zKpzw2oJXXiY0hyp5Wqnk5/5KKg+gYgmiUiIEkYVlBJXCWwUCuYiRJKByiEwSPCTqLf8v/0xMAPRCj7dppTtThmNtefpZNdF/ZTbBfyaD5izSGB8qzBmIiZJgL+6h02Ju9tseCFb8KNz+MNiM8mCWOjr7iOVM8XoMBJbNiskb2YL7k69172D9L5cB/MzPsVZKvPJ0zHbMnpYV2joU7PZbhuy6eXRMUkPds4eBGH86hPOpX7LK/imUFICeS7U9AG69v3FPEWJJARBrHWE7SCI7ndEpiKFnkMBajeFGkSYLn6N/z7o3oxzWlmzcZhh9OC3WGdLPJYDy8+EU/cMfTjsQ/QhnvuECirpSVdn3ewbqXR7mYhRgyXrvz1X3BBeyP8oLQn1+VxulIyFhXXoT0YS3SWMzFPdpTCn8L/mSfvehp054245ECvR/5y7PK8VUZdkzqcbv4zoR84u+ManMpe7rsH13xPd/PcocnVnnB5ecp69R5LjHFjXrEEDYvFEbaUIfoF90PIwWEwgRNozQBaI7lORGnQIBjksyzjMxzjEghjML+rvtFWqsmO5nOuoXzYqv1lR1c7uoBOW2vR/f6OKi6N51tYANUxMPgGUR122LkGEIFOrNa4swvefTPmtlXXX8bgttmQjvmOglIdmQhNBsgwrpmpz+P+0okJVnBSmSgmgsczH2Megc1wVjqYth/Hqd/wbbyVA1VcxRXCT6PJ4roo3lfHo09+kpOhC7SOE9RCsdRCMFgFEOIPCVSEiDMnHzWNxcpQcPU34PYYer1vdwZ65rSp8P5dB5rd9/elY5sXsn5IpSvJNV3pgKb5njcow+9qE7pEgWiFnTLpL4gzDWy4Rp4R238E318BsKi+0W8PlRlk0qIu4pScHqUeguDU3/rQlnpNF8Zkt4aPlHH9uXRLRYvVPvQchMA7hnFv56N/e6Y5Pb2t71/esFHKdVK6ADvGIno8mzNSKVw5W3X3vm/7d34CuKhrTZS5Y48toNbNMIyQV2ZzMnj0f5t78in1OSlpCK6vWcc5LZbOa94DMGw2iPEOX/be/rphUyde4yg+0U9rPXcSFZ86A6Z1tTNSwndp92BshX8+eadrYwvCr2rIeN8QzWjKA/m3fPEw6p8e3YAkW9ZwM4Jqvwof0lRtkrP4vjmmaSMfJ3Qw41aGcs2KAiCRx5xden4L85Tf0XeSPzCbjcs8y9HHbfsTMPScOOnk/CvzfNpW5lRssjD/XhJMiBmWNc2HAd3mICI4780j/EZLStuVL2ro9PBy7rLoalPe1OEd6UJX5l/bZ5P+pzcnMLDckTpkWZt+rYFFifTysh06b82zyd96sJEzf20v9JSbmzhZM5V2e4DDBitNw2LpHGBpRQF5SgS5whV5DFMQBSBZhSS0VmRFnhKA7j9d1hEZg/z1vWXhncufmck4aSaED3y0PwtVl+lia/OTHCdmJWLBMFg/DTbWp63c8e9TsX+F5iSoTSSImhM41Scx1ACxRSaZwlG4wkGPsFpKCYy/L3MW/B4W+gEpxUA97bO4e6g9Kw+dl3hNuusRrYiMkr5UsGBt9GzlFu27kDabs79hAgjJoS8V3cT4fr3Ek6tG5V8wQhp2BgJupGnshGHYC0m/uEefVtpr4zJX+9fcCn7Me/hCZumZxte9iwwA/aZkYYD6j6QNrtad+AE8JozJbIOjQh8ez06kSFJnhYU8jSEeIEAqwflBQ6BQyMIgcUUhEFoHGdvN0QD7P0M4RlQ6Cub1g9PV27N7Wd1O/9g6WxdcB9J7Fo4Cs4S",
  "Kt6D4OjT8RfMTMQYlQGzUACjkMWADYABJgno2UqaA6uBoliCEhmRvFGdfpaGIcAbRr/6FoaLV/fJvlbvsTWhTTHNvHR04ksUfcu8gz4Tc8AbD7Ii6b/HliwLDwVSPBQsVW+Cm9eQV0wdq+XhS+0V3T6ZMfd/VCliGcMrR9LallbgF70aB2lfhrbkQ5ZY/mxulCook5kyQDM0W3EU6IMHcDUKT1QKvQEyC9NHB7aAZXqCxWfFunfXnAMw+/ps8PocrLDwTJqBc05AicT2zEImwVy2/IGhlDWmvsNfWMx9qS36L66HXzIJYuSDqse1ebQTsdHczO4E+6ZhicoX2D9wMuM9rowOuwzTigSUwQic3gZ4I+ne+EZqT3vT5fxh0RzzcxzvajZ/CejH/Rrm3CVz6RurAfeRY1+iBB/jRKUDuuj8dWePnYlZ/p66tRHnJIvAZ3Nw5fZxekl/2WMFzi7AX+P2V7SxhD1RdmxOHei884iaopJhNLDfxkWyd0/5AxRs7dd+k74/1QTAzH2Md35129nJ8Yjtlcvut/3SbQZca73pCqAvAV1hAPWmONxpVxGKo1vvxdIDV0aMbKi+IX/txwkQC04CBqwdfq7N3fQlvscbjc8DdOfxdOfv7EOcQKno/LI2cGnDs/51N5cdjpq+damncNeECQQnm1mLJJVrL/7k0wsAfLZ5rrF90eqCEKe7GlZIN8LHg7EzOcPOdDYdjPTVBa9/dHpwn2c8zah65m3+QW/7jtqzBLkrhZFxDusL9gKuemCsX+tUrH9wRl9OK1Xk7XJ27tP9Tg44ALfvfmQCAw8JgkgMQ2MIodIsTwoK2A+A0EmYwFLwKQx8pbcGvx/iviWot4aI+1Hpb+gH/RbXi9JO2qGLg+WkNjYyyKR3f/PHMrjAiYIGLgEJfAEUwAiCIAnsGRqKkThOSaAg43ckKyqi6VrGZ1u4Za8XPZMG6kYqzPmCNSaOWuN96T8q9FLYsNkmlrwmXuGfNdDPVu84sJ5tP8825WoZBM7Neccf6FsvMnRC4HGzW5nI+W2O72o/GwZKOTt/WG5rfaJE4Olfn91R3sMUQ+6MYXtCO+1jxXDRpg8phP1pc5YhLPmQcB/ngLgbdqFnNau7aS1uV8EXnBcEHvrGDawD0OTyCJFxis/GIyk5X1mtZFUFZiSZtaOu6p6RNXkWj9mfxn62edrkBQkC94hN6OCMJbGsB5QkYZzefkQvUMNxyxTtpnB9lmhYnRYAcQqeNeTW0/hsDN/hHkXezqVzqjw52JQabQuVxJL8+mbmqZwGn5H480maDKMLFM4oCkZhjEQQmERjCsMpDMvf20RXsAyUu1+d4D86uJBtKpH7TBIPNjLOTgYxV7Ve4VhiXsKkmdSNn6QfvDh1p6GaVCTrb0V/vgXRcNlU0/nFJuYxlhJZQRYohKFpBhgdJSH8GVkqgHYtUCrBAd/jb1v8pY9vr80FzaE63NYbdkZQd/9QXQo5PWr9bak4xWOySAiYoHIKAggoIeIColKaougUi1Ps6RKjMPSXpc5a5tk7l9Hgel0yuVuXhlj6pHEh5r0/tyiASCEomuRFkjyz+wSBwnmRFXCGkdSzLQTGgLf9h540c8XPBsP4g9lDO8gYkglCQy/PcLVnqEfSU80vGvBLG6mojgzjZGLa0DlV3uzm4JToQ+0x/k/s9NGnxsx4RJCDfz74t5scnswDTp0iLNoJ2Xt7RIrSBBnnOQ0Ih8BEnCeAf9AMQlC6gAqCpAgyh+EMfolmZT9CLSZjSKxdjZupXMhjsylWeBoTdXfYScF7wwyKERCOUESagmmfDRc5VaAIDkBzkQCcnOQImsM0Gb9XR6xpL+LPJn3t/NFNFc7s1CSHeb8tgWId1I5DZkvilhlJmuHbZgBcr1T5M9v/ietlfit4xhz5KuGH/kpsrbxv2aua099+T9iLW+zrn3Vy7rOVavhel2MFhdE871arrq6xGXaZXL/dIafp8b1uHQbGAKT5I+IP1k/79quWM4b61BBdxIwtbSPN9sCY1eb06Ev9tVKlSNd8xTG14PnQSHn/Cgl/74W5ycS8GfOlmWuBt1Vz52SnVOTAPTb/uBc0/lFI9Rka/vS/Viy/Xup7MyaPezyfzmnLsNXgXST8n+mSPR804eCvUPn2cjcaLB5PzGLg1bAv8qbEKVtU/BQ/vRTq/X1fX92VPK2xS5TAbtKX1ytKkKMbFwrd4c8e3H+g1/ddlcSWLnYJTf0aBAh5Z5bdZl2Qy2uo/5d9fMaMUWRppN3dJTT/6lmR1pBWJ9DK1oe/9ixMH901S8McB4BBvOXEi41wiDEFJ21PcleUSerfqnY+HLiIqozSKWaLQSZBzdHdg7DNZX97kNtLjwMC35/B4pd731OXKIwP22mCmtug1O48jWiFekzzx3E/YjdejuZNI9OuLKJqffOaqSQax7ugYvM25keBoG7jH91Hks4kVSGj/m0vNdJg6SdMJY5ut3QeKY2vPsRHU9tXnEo4nDjjvosqPWvXQxkJBwuZb9e5DZnXVsXPwsb1+2x8mruyrrfEkeXprlu3Ou/OEs15pfanfX7KtVao7HVkFra6436kdvOt9xnz0kub8LrHjwoJDlpe1pPjTNycbYXSKg1ozz3hDINDeuLuXmn5WWWgOV9142TB7fST0R95joFys+uSBd9IVzw5r+f7rDB4FrYBNQkPP9qivtdG4HG2UJIdZhh36s2KW3FHBbJPv3T+fq8deFMidffnIzlfVUYbrPDkI9+ETL5YNEyLR6f1tPOW89Tv57ahFzqzBMZYs5cyvjpU5hL1Z31Ihp2V8L3z29rAr/kMsSr5zr0rgDGOgXkXT5xsyvdHlqaVXv9+buEfzs04k4uP44Z0vXawa82rS3FgCz24C/wf1v7DudsAyvb1mtqlZ1HjlFxDpGFyUtSgP1Zofcsof5Fu6XTWD2Xqk/CwX6WwlyupsxTij9VqH7FDdhHongxkWKVFn6gcjDjDeya9QtL22m+jdB/ta96LLuSH8EpqWwLL7FU7TopuqlPjMz5xfck4/zL2h7zqQtVAR/V8CO8zwgTIsUHwQs3b80unYAfkB8pfZBUf0LonNQtuDa1e+ymDb+E82br7osefr4Bk8qc90qnmvJd92B1s8U4ADR1zi5oNwe1yfu3kBki7i8Rf9Ssfi7WICao7iwobwnN/h0LycBHuNP6SkXnGFiLfcl71qx6nkP6QFZj2w3hY99mhX6RtiqXJ/aVaBX6k9Rvf+lloKZcO4voLsVtvHSIm86pd9TD6pfdC85/Zn69+iMK+sfHRRtCjyNF8UVx6hNg5pbWHfq10+ZFtWeEpQc1vvhE36lHu4VJ0wzFxRaotQpLIHLyF8r+N/8j0G4tznaPlmtFMqxRdoPB25QbZREzvYz3t6Z+/nDW2rkfHR71+1nWlM+F0ekDxnJkdx/+p0uazIHyP9Zzne4ZyGHTGE63jDPmP8UjvfiuYrZIflSg44PdnT803H81K3D8yYiCjHKGuiGBL17S38db1/9M5PnDWkcQP9BYeyeRwBR7IUGSbVMVBq5X/XJT+rR8e5ESD2YiVuaAoKhSVfmZCQSCY7J+L4z/1skSe7VGj3Y1gkasltwxRIRMFsQH+a7ExoPUz1ra9nnv0gofWdvWuR6yw2RePdIwmpZhH3PznYvgPW36gKXpcUvUYZbLTzvXxiuTHDOpwsfl1z/QUufTqAP58XTuzZya1pjbNjlAVGjNK7K/sLMtEhv2tkP7z3OfeOvZMuKf4w8Jot3t0vZrsiiLl5S8F7N/8rUUKsAd12+dyOCWKyq9jchy3rsfMv43/qG4U0fgU3GlGvgmxULndDhuaoPUlqf51bN57awL9fvarkNNhsLk8zY+hjVKWoJM1XqWtBf29yPuD9mjRM1erSOjiXsfimIvaRd2RMdqmv9I+GACv0oB2z76Y7/V7W73paxZp487f8DwcF1xBK6o/xe7fCsQ/c0M7v7KdVVsP6X3Y8c2tvl8cw5W4enx1s7+S5prv3VMZ/PnN75LK+YkxBo6+jpxTN6FMlWaMiDdh+1P1F/yl9z90KYxv+wZls91RhO7zeHB4hOzdpu7e8mKPVPLWZ8sx",
  "0KsvWJKNrsXpPl/Cq0GnQkHSFF8KtvmwHqXzx7Vf9JqkVpBrTGc1iQDnY0e/PPiEZjgk++dzf+jjnzx3oI3MwPrZ3+AgHCo1vRsr5t/hRW/+Nv7H2upsCwDCqBQlkMAF1BL2Usgc1DEx/89jX7A6K7pzuQ/dUPfiSCP7/WmPQ06uqH39t/GfHfRUqV3r62U6GbRr9nxFiyZeqhp++jUX6PZe/3LPZC75enzVifLQSlfzvou7vMzUVjy+d//Pkad00Se2xSdLUm9GrKl3aDBY6nIGGHpJMMDe7zFEFC1iDC9gNE3pAssoLEOyDI9zCsLwHCaIvCiwAiH+Eu+4Y49oifBwP55vTez2IidvmCVlQvMeKEgQAskRgiiSGAMuPJpDWFLQGZJmKEo9izmy+PlwwHvayxpSxIBT1BgSBPvxVOR+yFqTNuZMojYnMiViT1L1klyIYvwqT/mOHc4MXxXQbFwOuH5zyxuP0lVrZGg0lMxvbyfgP58z1Pql/YrD8Xd2JaL2PiladTRv7oNJGqIOseBQ/kJJCi8yFEIJCkFpFElwBIpTNCsyisBQPMsyOiYg6D1y9PMlxZdw52c8DaEnxhjUWXqk3AN/iIfqvq+IS6PobChFj/9kjh9McCxXsaKbgA7SLrOR+4mXdnxRlZ7/fjMxmmUkSsQxjWExneIw+Ww2yfIEB+eJIYLEYxqwA/YPmb7dVFcqCVuWd9t5uyA47bD25ok4Xvx80G9InlHYQGcgJBtLnAyl3XH0LHYPaZVzaLOm8aF/yKXwBhKaDTkSsLWQ876kVUoOIBZGOm17jdCyMhVJWhAoqgIMt8Df8JshJbB72bn/+ErGZ4XPVa0H6NF7bJlB5n5r1FSqzxax64VfX8X4xIXbRl7iXTpgp0XYcQkjRjYxkRo0je8JVIIkUgql84yCkxyNUxyHIbLIoITCUQTBSAKlMuIti/hZhai51hD62Rr60N388SpPBiA+gMUzu1h5uRfkpXxMBvRQ4VoD7ht6oDXh22x9PlAF+29vn3jPp9OM7kf4QcLPzHHQYCJ9OH2NUAfi1FrAJyoNKsDr45tK+vEQ0ee+fPj5QNP9CR8B+eakT5lGeKBbBCOGzNqNw8V+7qnEnfCI5T1dgZEFTMMUYCoSwWKExCCchCE0Lug4zWA6eRYEojn++nIPEJ82QQDXEHJeTQdn6zi7dQzoAqWhnCdWlaS/pKxjOMspIkeAPgNT0cCLRVESzIuRMAX+ichgCk/I18q6H28dWf3dXUQteSyDKLl6Hz+29qRH4rV+S9xjBJHgWIrhSJYkBQwUJ0xjKNBpcZHmGFChBIbH8ZsGkw00kujm85mjUA3osEP3aj/qA9O6eGhP1jmrheuvaWAYRgkEguC4IPIUgVKSRnEypxOYwhI4QxAKxfAMfi9+eyYdxPFZyhL2y5D8iLLzMhrcmt0sX3HVh/zzA2WDgOwdV3Sc1zoBr3kWZj/bdJ+8kq6fAWOGJPOkXG30oUX5tcsjNnKH/THNpfbliB9p4B9H5JYpOTc1L6QQqWNdXGgau+nGHX6Iv9QXxHRSZAgVQ1QCxcAKxDCUYxBGFODUdJGg4G8kAhHFy2XFPvzsC9qY4zGTIim7M/GZYJfrnWaJm30RqMEf/vElP9hs8To+p/IuzJjHqfVvIQrcDNsOX3qA6OZZwxf23fOhxsePPIpeZPl0Ipn81g6JFef7VMyKKTJMz/ivkiBHacD5NExnCQYRMZlTcEo8S6whMo4zJIaA6aWB8v2XNYSBRDPvhN5Vv2d3ujDx/axp4sQcbleJcOX/hRrijVlJDNgLINoFQUNAvHI8L2IILxAMfr7dmeN4VsAIRP+vzGSwvH/Thtul0K2NTsLDnWQfu3Z3sPbX/9u34vzyDiIbQ5GroNfblIZaoO/ZekJh7mLtHf+tUpJIMALHEBJcVpLQKQEleJoWKUzFeVbgUEwBlYdlxB8yHzYhVqdjrm3xbmGgRLp1A8pDwbrn31vgsSSGiacuI6kkfeIjoDAxAvBIjseAsgVAbkiRosS/Mx//znz8P5j5MDA5qmgqKNn4cqR2uXpfeP1s7Kel/X9p5oPtWiUnx0e/IV6+7ip+Vx0R/9Qb8u0/yXxo4uGUDnUTHXGcOwdq1d92u5MkD5Twz5kPeRcpkyifmQrxvOli3K9UgUH6yYa5v2c+OFjcsX5FLxZk47pkMkVcwK62RinL/3PmI/bqxsQH5YyInXrLs3PncsWRqh7L/N+T+dBJi8vTGhJV8mzoZIUqN8HJ7EMMp/87Mx95gnEdbV3tW0+0Ou2Uwn6N0TNeyP9NmQ8BP+N1qomBELjRsZmNOjag/nQYvfJ/Z+Yjf8yxPaFHhZx6wBsc9YDyk9PV7jn9/0rm43A65yYHeRB7NS8QOSr4XqpOsrtw/yszHyq5RRXX3CLRmzFTnuOBRkW8n1II/+/MfPCjNaewitPsXp6iwyDmJ+jYsaP1uPz3ZD446E4Grnq1qFAct4UPIuZ0KrgCOYb/7ZkPFfJmBLNV5FzBozgmJ59tkBqcVNH+nfn4d+bj35mPf2c+/iuZDxZp66GTHEIdDtn5grmVfxIUfcMr4d+Zj/8fZT6IGI3jAsEpArjxKEJgWIFjRAajEE0mJEHiEIbTBBL/JfNRXqh9fypWKbBspg4enjyNQz3vFUv/5Z3zz0prTsHdLNUk9nxe5jZbWh3Wb4dt79zfflgsxmMkJvMcJnOMROMCRTCyQMkc+AQ0ChU0TSXY8ycM3n9L49lOCSjQgRtQGoYpNhx77BVc2azFZEgbP2aPvuSCLP0tmsZUa0IK5mLsd6xM9dwKHNHTpSx9gfmno3tH17RZXdcuPFKXx7M2o0cV3jVXaPzz0TUJn/LjQbc2Z9xqb6DGUdZnBPUp7y2LQpEIUSQwDD2re4scAidHCChBcgKOsSJGIAom4PcsyucDOFZQVT+M23dk7COKpaM1qzRiGSkn1LlNOZKdyq3qaoX5VjhCNPwwzN0HI/7jXAdM2TPHcITCdK+PyQ0yJqrcF8nt+Bb6T/MEMBYOwwRB53FGk8/CagpDoLygkjglCCpHYTzL/sJcFb7WfbhDKqIPrCa8jNR+XytX/FSn/yUKo3geA+YGu0gSAiXQGC0wOAc0TqkMfJZjGIHHBEr/F5kr+qJgoDMhvKdOPqIuUl3GNnF/7Mpk6pKIRcvfEkSjR+jFxSJYPbTweR8PTJXb+VIyA/VPCSKEIM6EusniHn9Qxyr3ca8+Vaqd6C9q4sePotgfv0/ApMR+1hiKSRgug9WZ6wQY2mP8aXjPWBA/mszRjMioOMUIKoYIGgHXmRQ5BSdJjBMZDZHkW8fDS/e3gCEDmq9COBebZLm0aXd2fVwa9qeV+u6t5GM1KDnhfnQNS3LqQhVLsUf2Vnb6jk7/bD2WGOwghGkoam1WAIfM4P0TXqZXicRe9vEVySiQIbDZEU0uZe8yMVc2Y3CWbsck/f6hweWrN/MqO9nBYNLpOvs5OVF7cp/eL673KKk//6aOkV5hp8VKSetbaVdA9I2xuOA2FbviO9ZLv7R6f/ZKKsJeSCnXeexCSqCCvIVPBKS1Vf+KeOkv747DeAt/kD2ErvZwOhmW1lXTAZ/h4a3/me5jf/ns4f35TvGpv5oUqfcuxquPw0xuR6ZPOqhB3ywXAhTAV//u18tKpArPtnnQLnVBQPJOJpPTOJ9HknpHCl8/pqY5Xz3P3Lbj5BYtlLWonIqSyzAqLya5QbD13vmPaL7YPD2BH0/Cf5zVaOGVG4A5McNt1p3H/npHJPbqX3znl7GBMfwQsU9kc3DKhQzqWU7OUBClUqMUzNGUuOZFY2Q/XznwihcRnVIA/RkTZ8jO2Z0CztRl2SCWdArwQ9d770HpBP6/mHuPLcWVYG30gRggb4ZyyCEJeTOTl5AFBDJP/4tq6KZMV/U+59y17qS3WZ0oMjMyfMSHpkS8qiMEDwEkxkAwxYEsCUMEINAUIdMYAwCIzN4Jt6G+O953vDM3TfPLoQDn0KasWz2uLnxsbrbi+fRSerIaXzFUL8nblXxEpnrLcii3xNTjcq6RALw6KSHxB8mXmKyTra9ZImnuyR0JjPjd/KTFVxY95sjy",
  "hp1pajaQXkRQ9CDgzgb40KuBwVCc4jCU3OcgAABG4BlwB5OL4ixJ0iSC4hBE0G/k+UTFAxxXCIQ0RTyPK1tszgezXNj+L/KcKZENN9j+xCeFOUzCUbWngjFSPDLf5ZDuo/zTjAQyHAszAiBBOEzAVUilGJwmKYyHOHCflPvXtiwW3KoLecO5i0AkOq7BWeuf92HbHK/sh8QIpVxmXjocREoMqbQlso3SoLt+ouHz+1IIKI4JDLpDfxEAQGAEsFKRgVlGxGREghgZI2CSRp8xWuahtxmk8TT45uROjHIbbW/vMDb4DSrCfwm6GAlb1OenqddCbcMBy0DSJTDsXDtg/w71cJXFU7VdHIMF0sNw5vuhLmcOuG3t38Akj8iIg8SCSLGmxbDdQSyq1PPolt9n7p4Q8Fnrq49YMEPcjBTYypLaSbxqLWDQcJ4BYUtxcDYYaX/CjqlaLNQ8UBg6o7Wq3SK3Kp3esr2mX94PCoUijESBeyENGq/Xm6EYgK7/tlqvxGrYIOD6JFelhH6JHUOlmT2jTMXtl3NEoMXu0N7ctqtbxjn+H2DHiI64O1h5PLuuKSNdzsmOj+20Uz+U77FjWBMwfTzX3Eo0TVewvXN/dcoFXN3pD9gxoVCf06XF46NRbKvB84ghvCxAYTP6F9gx1O18GhyZnYK+bLf2bFdbqlaxvKb65TN2TNKSGTrF2hWxB20/axaBAbtb22kd8iN2jMATM0rdCMDHAQFTqvGs0vUwTbT5vscLvI/4iCMSCBEQiFarEMvi1ZIFkYxcry7EQwglYwjF/j/DjqF0vZrFCeuURbOybm4zjw2r0x7qdOv/X9gxBIoQ67kgKbBK2dXzus8YgAgCQCASXa1UEEnDkIww6B+xYzhyuDK0EMqu3xnQLYRPwwmI/fr4kuL4O3YMkxU0Noj48ajQwnTdo5vVax/0zdF6Sf9UwUN5+2+h9pfZMFwNDXsU4zcTzQIhMFOSwQYOuD+eqG+ueRjOaj/uFiJVzLmpDAmzUkFsmWB8eZ33UaNvbaKve51l56YcfS/LhXpPD+mZlHw7lYRh/AtmzSMswE9cknZb8TQMHOT3mOQllOAdZe50+Amz5uyEe4E95OnZ0dmMODiWLG9MOFEo/QfMGjrN9DiBoXYCMN9xdiy6Bf2Ci7au+tKAHXhBHTf1Y2zhM73ZpiQoZ0t9KZV+oDpAscTT8Vxdi+5v9D6HhSSCRVPXUjAwAwXEfIDz+Yo1N46JqL/RCz7o3QRahGS2OsygSB1OYpHDvkZA0QH6ODEDSkAIgyMCSNEQgUAIITEwQdA0CrEUxaA4Q0kIw8nvpjhzuuFMg8LDTic2RyanbI448HFWxH/H2FG0mHTDUN5mEshoMY/lm3apKs1Ik+8mP3OVIpnzqjptKkpL+SJlIDVsjcgR/W8wdlhfzMgLNtJenUxOY7juqDO7EDYn+TuMHSZwvUoljzLCBqhrY6lyuN3sGLBs4FuMHdbnl4NwOF3raapzmat7bdwgACzm0rcYO5wxBme8dc9Wub9a2nCxbh7IJQOugF+ve9ApbWlENDNnY/BkIrCWtzkQCcd6wbH7et0T4W91cKtaT6lLLSVgje1Ilz2bkmdI1U+YPrS2EuVtKUeGoUEwRS9YL3+LKstA/YDpw9rMEmxYxGsGbTEixFeVUETJqfYH628TuJ/3YVGyyBcKVNI4FXktwB7HxFicpi/eV9/2t/DDdGEG3ikjPncU0qZ7pgL2nj3gCOXy1cuU6i+mIHcEhF+41k6WhNyNCdK4ZUhjXaJyL679yje/Jnq+myoMgNc4bZ3drfTHUATMgDvF2N4Y88vrnIl3ow43Ot10TXQT1DDfe8zWkSd5Ti9jYX+aTv3w91LQhqwJIU6HeLbwRU8AuLfV0MGp+CPm0NMvPawCCegYE0JxexLFi7IywvUmXDX4+DPmkGJgN8NBLvIFUI73EUa9PsKDeNldur9PhVbtbLCF7aDrpDDAHu2kUbL4k705IP+EOSQHOLDQLihOV0Ba1QVwmQRWlFEYaP8Jc0gJTvt4LGC1sgzKlWlpuaBnB6tuePcj5pDMH4mLsPR5d7RZIePhGZ/tgV0P8yNeUb+6G19MeGZLe4vwzH4MnGBWdsQhhIUGzAOli15GigYuWK5i/JFBfZ20a1M3B/IjW3XHxVJjMLVi3A7B5YT9E+aRmjOKrXDmvvRxW8U73tqXztFB3d74J8yjHZ7rHrvQDmpuAmi/ayVTt3FywhXrnzCPmMXFWHOEjVbIDW5ohctqMvRlfQHTf8I8omAOhsyCUnGroMbO1ClWRPaUuimIHzGPGNEe571kcmxgZKRSQjBUn3Tc2y7Vh7V/uTtaovvTfja5EM2IPCASMFKb1RiGZOzDBOh3sqaYcuoKRa4qB5O8i1OoR9BQNi62/z7zbUuo8QrP/W5y/GlDUtAi6zouoNNx1XDNfBP5G9nSX2aUX74veAfOIINLoGSmwB1TZszj9Q4mWPmQebeHPmpeTUjWI6xJzi8OhsFH3B/TfSTWBD/fTi/VSvfs0OvEyB7Upx1+MGHe8q3SAVOysVJuXmU6+2nNc2K7vFAHMgnq2ylNpFTwbhWGHMZaV196n+9VAS9v+IBlgrabBA+EQ2Gj0Rs94rCyGE/zXyZOP+mrbSjeE6DfKXLeOM0tOp0R1wncU/E+cwis7++dbDUYIQ1cWYSq6NZetzdzDNkJhjQG07+c6vwABXmdoMx6SyjetjRuqHuj0m/0Ls7BGhjo/jvcpw9ejJVeBkbrIcQpTsMUch54uNgYFtxk4hs6fq31nFUPkIxMXMQDtimc1afbY1GudnvgdU5cfwebsVxn8Fcz9N1oS67HbnSbWkzIhcaw5TQ0MS+K0zYb/tP0ZucXJl4MBO/vbn8aAoEc/eYGnlA6OClHsB2ESskE5effeGYDuyEREdDaF5OAy9A2VcWpUwsY9fKff+MhS+Q8Gez0xuQNgIvTaslta8ViIATb/sNenggHFpNx6IYJsPLQalU/9ynUDAbGyfLPv/HIJtMy1eRAUJ0RZeRpQjgfJm4KFw+uXiZiF7f3wCx0eWX6duwuqlyeLc8f9D5B8r05NC+oDn/wtx48DHgb9RIutTVn5WZSV6ew2W+nMk+Xj9hZL+d0kC2pFeBStp3RovpJBfcQngoVi0wf6XsHDPQKqsOpmdqVW0IYOGDgDYbgnJl1PRPg229/4wPvM2WYw8D6DwWbJd3HLU+p9KkXmLH7DvvrYU8FpkpcjfLEe3WIDXhftcd8ETK2ur5LmRA4iUV4BJNZhEMwgoFZikQojmZxhIYRDCcQiALQ99NjKW632amDdnUZNQPa9rhB2NbBVxvWO/47Ztc4EjvrNk2YvNPV881pw5z2sJsaqco/YXYtKLN0BEe6VFQ2TcIecELXSj9rWOQ/YHbRYw+GOFdKiGRSvgSOCILwDeuxfnX8b5hdKLmgoeqywZxePfPGn3MUYc4Xcsyrf8Ps6t0jkSDCfqZKQZPaLSWU5gabhLb7J8yuhEVFuxuHYatW55POSJCdKMVh4RXgXzG7DCQLL0ldIHZ52LW7rQNvNb+9LKed9W+YXaY3lx3hbXYlSzhSZW2zHl6ug5lVl3/D7JLBxYCNak/D3HRKm7ZV6AGBUcXuk/8JZldy2YQEpzqr90QJSH6oSkqqNt3Oqex/x8zinCTT235nMPyC5n3HMuQZJBgc1y7/CTNLA82FNpZg3sKc3fln8jDMINV4ZQP8C2ZWA+PjZcykzRhfVyGAnZhqc/YZ3tv5/4yZ5SvUMpDHwZvy1ARgNXCv5h1p0Jj1f8TMYlmWibXFE5bF3A3+gJZELgoCrZ2nD9EWKAvTMEJRiIBjlAwxiMwyFIZQ6A5OQCJJGq5/AiH+XbRFvM3YddL6U1NcXY3kKTZRKwGGew35LnKSD5co7ybTdCwizLRY1jQfdS4OB1y+iZwwVXdVh6zi6/6G0WblSooZ8hUUbMG/4mU9oyBnKa1i/eTSG+WauRScJJsEPFeKyv01uvB49hkyo81V5JmTilG79Oj7Mp3tZVIFlL9FFx7eLc1lpFNeipPYbCVzd4siQdywu4Jp7b/S+5zaLCnQSbSrjW0osttYTazO",
  "s3SL+637Jb1ufYkYsFnZafg4xb8SkhOHkZTr297NXP3kw0JaoOCCM/UveF/vnwhj0hJmIzPLhoSd9QU9oE57RewAd/6BrkfQdNxBC+yKGDvIueoU217ktY7hTnT1U+SkREd8My4wfGYuIwOctqKuEdhJEkXxb/hez6Bpg2/4doq78zXuz6AS1Ru83wfdUQuW7/C9KO58k6+RxFQpCKApXyRItZ87DTxJ1pfrnt8Dmnzdnr3Dr8xFvl3QeMtPQNKo2Iuo/hoXjJuMgnKb5gZt/Bg9O5AhhfqOVQ7m+DdcsIOIHnjbhNyD7cjtFstQzYYmptlxys+4YOKpXQQSxMk0EPruhvSgej0fHWJglJ9wwTINPmvadb7trliCN5lqp8DuyhemPP6AC8Y2mcZA7GEfsDdRPPJqrSFWPJ6AC/EVLtir5UzXNNvJSVNQgyZkxajINxKTYFXdhl/Ru4rI3ed7ZeOrxm7PBy3iD4Qo7TmSlAY8KPdLufwDLtlDNnBb4HDBJoDJJLsvdDvTWvwiexRjX/4egeLTDsPMitjrE3vQEmHX36J8fX5EzvyES5aFxYIUjmdaK0dqEo3fij13UIyOIX7AJWNH6Wr2ugucYozzI26eZhK92PeeAutfcMmoEeIA6BxsNcS4mXUUDF5XexvZZ+l/wiVjMt4rz82onk5B7Jz2LHWKyOTqhcnF+gmXjD0cdCiVpXhzPTh7lsECUPWzPFMb+f23lXA1gb/C6RI5wp/RIDcS8UibOz/2o4g6bzdwB7wmeN48TvvRb/YqA3CDOAyUCvMeMzAqlnSLO3erBnvNjn+Ji7Zj28G+kKnk8WaK8WXuU5gA7WlgTn/CRRu0Oh92W7LNJbd39LA9M4ZdSPsb0/0TLtrShqNjnZsE7kmAUm4OPtZ7eodw8PhPuGg8InhbjjP358U7Y/Uex0cCQob9jvV/xEUrLa3rdT6asx2/u+zL3pEsYLzZN/jj2npJvop0SoTh9Swu8cUJItwNV4dE3RxV16vSbxDC8xMa3KZ+c44Vt0MHOgKjwz5HXFxYvoiQPfa5EAxSjwIRKxaHH9rtydCnLVQ0rkr9LUL1/B5bsxgAgun+QgDylvHAQcMvgV5eLtZfI1SzlKtVaOmRcx3Ami5Ed+To5kKn/t+iTdpVP5qxQ3gCRFK1TPaXQ9bqSXoxo3dYbO4fvfsuaiKdTVyzagyB9sP+6MLQjsrO8TEyMOP7aBV7CXY3HJtZsJXz8sybOUfOqGEfp+aHaBVc5R6LNYQEngVMue24fWIQrBV75Nc14i/fBFEVtLelZ0THTSduybwtNWTh0Nj7GgdN/f3uuK9tBmmcEuAsMAe0gq7LTfKgWUP8UywOl5/x0F718v5oSI7YRRNQiGlGXG+2vVzNuibx8kvMt92viIv9QP7+C+4bweWB6QqlA/t1RyG32OcPW7O1t8GfM54D9422r2QTmA8FAXJLEVxhb9r5jjeeVM5EhNPy7fpn9BOimY1h97YlbKiphRYLzkd33h9P4cv3I4gE9D/2+PPbhuyyhljteRSEronmqQ6T2qcmHNAXCIV7Zd9qAyjrP9/Jp+0tuBBSVhu4uM/hne2FpOCNQXqyXyoYIXJ4Rq7ewV+jx1M0tJFG+NrUcMu+6hH6tInT7LV62injN0Aw/zVyxYPXEOAQmBPaPX7OyT7D2FTPFLZ8LXZ1pdX9NR7gX8+MKACZ16t5Y/BJ4zapIsD5qWqEE3ZtfsbAY/i9mEzkibmSJY3Byo2WK28OsCSBrH/GwCsl0jVRGk3Yg+uKZHCoGolqcfhSWP8BA08Cq9AGua09dfoqzas+wYiqIGedOfyMgUcrXDqLtGGkuUgDJq546d6hzof9pfuOhkcIZtRgXshVLheSDdW7Wx6OVJve7iblHyPAbBEifoN0Qn0z91xGuXWXqW6huOW78nEcwzM0S3EQB9I7JhiUwEQUE+nq2aYRAmIZmRJwSKTfI4Sc4i2rAzRiYnZwtJPD1Te4cjzG2Nb6V/w9FrkdaxT1ibOCCi1/2+takXMt3YGe9aEF45eoeee6pYswz3sjsjaSm4Vuhnr1rpfPErK5vAdReycS6GNVXEaq5YDZyhoQTNRTyWrClipA6x8w/9RmOLh5jAcXzdgxhVIQPGgJsZ654H/D/GMowu4VFhgN1N9UrtilcZ06jXiyXurK39MB1PfSq96H6nemUKg0eGASRnIzRjF2RhK97Xv9eFvY+DP+30e41UMS5tC1oACAO0OsSKjukehWe2dn1Z/3Q/4F9+98S8HrzdJoVVHOGVUq0bSKra3ZsP+A+/fkhTR0lNk4qMBgaCZVnhBe1yPBzwn8MwaitYqg9ziGj7OgsZAcUTg6XTAfrWG76JBzLGEeOgOfzsKBivpDBDGPwx1OJg0zsJUiVhesI+2+2VmK+AFRHYyxDIZSBIiyOAGJNEPALIQhJIYiGAFJLInx1SGG3o/jUm9R8xY5KN4Cj+5dI+8uEU/C72Elw7AlSB6UBpU/7LaaV8mCasyx9yJJf/yth1SmeIa/FFeng9O6ZPdb0Y7GG9ouNRx/A69WuH4BiqulmPq7q9ZONQg11Nm/Lov1PSaiuetq6rin92aV27w0iQabSJcL0NDIj5iI+07eGg4nS92VRpFa5Dc7tpyWulD9v2AiUmdTTqyT3eyuW+uM77dVplcnvTlZ/gfUOTQCsyxFCTBaL46EyRCOUhBG4jRZL46IkAhBURLBkPcjZHTdkQxrd6/pduzg7RXvgMD8Mwltb4NgJKxHz0+P8np6P1D3ILjP9UY+2RR1KJCxL+scPf951ZbN7Uzbnsx7ebHDO/ffuqdCht8l8yZopS64/vcdTELV/zT8PQZibC6+mfqrC0RivKYY1Q3aSKODA/GfQI8jSHe6art1Lu9odtUudKfq4QQ/4tY+OTiagdsstfGh6zk/gzzJYDeZ2fw5j5WWN0l+P493tC53AzH+3SzPztRR2xJxcVSDRKe9usfbWpSuu5vxEhRKBfouBVZD8G6AGW+zod7R+WjNoO10u8NTNSfYtqQsxF5kGCOz4qVhfzWgyPI+WCmG62F1VIG4qY+P+7jEFFviBYnmqTY5RdZmy+5s8ZbwAnmzSul755Hyuqd5fQ73u30GK7cNLGjO0eIOY5C4CecsgTAnJ5lore9+52FkE/KEMag4XuKOu0Blmfh+rkI6qHF/D4QIBIWcj3HFno7FiNULGBR6fHFDdTz+HmDWGE08snbs4JUOtueTXqt1WWqapXESa/QvM7jm4A056m5s2sMduCrg60e/w5vk22TXDL22zcwVpBGCgrRam4jOcaS4fP0bH6pbH9qkwdU8Ck4UN5yOjYMcWQ82jzeG2bzkP96GK6wiJ7m8DRRoVsfqIb1xHB7U2t/XoZqEqVuyUdv02XlI0pf0+V0D3YN10Moj3p2moE/534MaBl4QaYFPadrvtVxGgRxNxHPDXm/Hr/cRQ/ULvzHVqstOhK0a2/2tbaazlm8n4EQH7osDOicuMkTQW4vAB35lrxsIM3C8xYgbm7pmQEHkEkB+WWxeRKfvgm8DEdYzfAagpvEshi0byY7oiTJ/28Tl1TzIPoa+WCV3GbT3Hu/Q+8xntXHrd3wh7zRGn5RmJ1T9jU5NkLl9GGSH4CCapggCo2QaheQ9n0FiEEGkMAnDBAIhMIKt/+99MfQ9pTS8sdwMVhEEFm/Vak8c00uApSSvqlEPSMh8jS9pzvCK39ji+zj6/WnxwbJqrNvK8vequmf+YqGT2l0VU+7ljdiyvkWciQI6zlfx+D4fsPekKlifWdzc2cD+TQMtkAubRd02RIRFKWoMd5d6rxxukf81DZ50Z8P6dx8zL23ckJq40lPC8GIsHpNeE7oPTqr7l3O4+0LPatSn3xfOHHtVQFsCQiy294BnXQthyDKqW/6yj7sv9urvP8+UqqTNgvIuFXXTQjGkx7EkE7glVf1dbGgJHapzzm0wp9GafHPZwua5ibcZ/1IR8Ou7AU8O/n2O13OOzo7Y4l4qa1sXumFAHtbkATtEPiFyyt/XPv2/pLVvQuNhBtPgMU84sFxkmgyPofxx7cd768DGxSEjmE70wpV7qQ7U/WkLK5n/ovl/",
  "nfd8f7aB+eQZdiMvOJ7dunPbtdpmkjxTm/U0Akrv9bm/3fXd8Hzm2p5VZ82OXDBh6wgNuN0IwAYluqnsWB8+fqL5L3fkFUTKMVpng21HOZs8323k/Oor8hx/oB391U30sHZ60LhoXcl1TrxuSJkyyjn3Xrbf58r7dcszvoJu0G2DpZFoCuDubMdVkrEFpVvA8V1zVHI3QoHVgYsJAkNwEkdjkIwxKMlQIsoAPM3uoIvk32G0SMJsIjLqmKwDFZmVgiTZNz45i9ZvoL3V+GxX27tZn29rrIx5Sy2Wo8oKnq/MgNQweiTbyWG2hvWNkbkh0DIsh9LE0NWNupEGMUVeWhzby+9uGrWLViWyXt0vfFyKDny4FTf7na4rwk0LM3lG3B22M9Z3/34NxSGHo5bcjttB27l9by5mNOZ9nzKE+C7LGyUpEsMgABAhkmRQREARTpA4nmJwhuExiq4WPoK+H4R579eS6sfU4FfXkja3/bbtZZbZjOlqbexDAveimwk13zRAufWlZEzPIgSfPFv72zzWscJzB5Ae/70Gkd6RttKCgKv14hHkBJxajb9D22gJ9s4OJjEYJ2PijgqOAggQg2m2WsN4HMYRgRJoSqAInsTx+6R2+WRaA6VOYHYyOBHMV9u2P+GCUsJZaR5fBns1b4Hnh7fc7iVf3Kp6pNmRr/uoyaxaCqLEBXoZGHcP7lfPLhVdRw3KLKci9KiILQ44uF/N78lqXwaABeuZPZSGPMWMhzvC2fNbfzB97lK5oVjmJPNukNrunqw6PvUkFsgO4oOoK2Z8UmAbHqAWZz/rPti9Duq63m3Sx3eSY6+UpVzTUSna9DUlwJwuzEuiH18HdEEocBeKz/OqqIOTXBXobNjsrpW2nh0mRztlgmD8cjDWrzObTFbPohxLQBfBNN63yfPtsqkOcveqhJ6+QF7OZ7zhN83gd1m+j7NAgkI/l7UXmJng3gLsGk8bhyHYPK9Zn7R3TTv6FRfX9vFMqvGLjXOvjflzj3QDbBVwz8dGavvL0J/GTNExC5Dzw8uzeAs8P/e+qOiqZiOCmklwTGNnvoV+eGQsKPhjywXNdIvgJ4zLdD7ZXadcVgsGG/3jDCo3XofK/CXwxier7bbam544JG+Jz/tAKvBXgvnxnE6QG2+VLM716dpSEF6SLl8wJsLrLwl9eLVBvbvdCQJvSdtf53K51vq539xGkil0ZkOm45hZyXQ7ae+T0r8Cd7/WuChJpjeJnKK6APs6aAWr3UGuOSZfrFnv4Wns0JZKrVxXrdYClEYjjAmCgez7BgRe1t1xFH/zUkKxqdgz1CjhPr+jyngD7lmYT1HlpX3Af/gOJL6zQLDAO+wc+WkS0jF+Wq3U23bzkiSfw2ewmZ+cSKU9u3aEOhjMDdFWqwdfJsoLmK6nMvckefigR3TSMxaEk4XQNZ4wVJf6dNInnMjar2sku3oMN+PMjbNoIHCmkmtwA9WDbKGNQNpY8ArHuVirXxLcDbPHfVodPPuiUayWbVru0oPYBdqskdzMKq/f0ZLVpv7j97GS35WVcXKsjqogz0jdLnOsNkfOL7DgfQw+bOlny8TCQCbRDrytg2xcDeBkcPix5DPp8vot5/ee6INMjcSVMLeBU/s5kEltezq5G1x/CdW8BYkfBmYmS8IijidZadXQl2iC6dwiOQ3g9f3fT9SVP+9Ak8+Wf/OMONLsuiBi2IE82gR7lfOkYXjxQyvIHx5jCSFJJ4KEC81UVMTU9mhNsRwoRPtXnxXaLc/9ZxtXIk2PT7Ca3W4adXuqT5sNNx9n5X3Bwvx4N/dBPO6vd/8wfptjuz07irATDRQeLD3li7Ey6xa8HN8XDqx+zL3o4VEybnCDiRy7EaDO9oZR85w46JTc78b6df50ANW/Bij/1hcUt2evVSke5p5BggKtI7DQty3lwtrL9yIo6X/NrkZvT7WLHjdH3yIJotEBgqVJRrbZFhs94kq9Dmxu72WqEXOXM799+eTaokNdpDtAQVcjTioJKdX66JuiBhFQHf+ConIvl0bP2oThaDuJx/zDS9EKWD0hw0fCMWh7e06s+aj4FCkA6coQ6MmX9HcJ4uQuwx7v0caM3M5CnMPGW9/q+rBA0yVrbSZ/LX4grwn/GM62V4K9gWqGuOkGTVr/iK/5maNYZfPStvAxvkUdWOWyTZerQukyhozwRUFvZr66rscPLQS/W7R+6fUcG0A2wdy6Ol4ock/ys9UFM3k8Dy+J3V+R4WcrEjqDMkSLkoZ23RiZO+HEnE6YfBxfysjpS/JM3MjqKG1TJovMa0UONsPi7vbiVSq20d4hi/6ONT3OLZ8gKwqyEArk/QgrNgyMPW/AEwq8xhza30PtmMNpXgAp90m8zpFib4vGVcA5hsCy1xjHPab3eyibdMBX790JnVt3vfGTqxt6Rco6x3QvtZOvdhDViPnespUjvseDikk5A6l5qZJF5qVD+C2O4Nzrk5/tJIRJKNRZOClTOM22lCHqpT8RuHN+baLe/Uka/pITfW4PmI6fUvMIRZeZ3mHVeIh7hBNeYhbBvX64ecbDmB2NtioUQjIacyHl+b1YbrEUXo2Zd8OzuN+m8QiwicNcb3TJmSmlwXsgZMWrY+Dv//6sWg8dprIRT8uzUNCFrtqJ6btpWwxSyc67d4O9LAV5duGSp2F17pfARxTSJKPcF7jBW7pllfvvQsiqxT0TdhUIVsX2lM+HlGIWauOzGYENu4aHl9fpPg8bRTNJd3VAiOlowUVQV9XFWl3G/WWT4q9jwVfPqEl+x3bosklnQjRIIChM4di1NXG2RNaiRPQVElqQyuCtsPBpcy23DRF1fZI4Z3agI50MqzEv9wkBvv+W8bRRTU8sMFET2ImC+CMeJUyhuSZ6to13e5HqP/dIjdv8POWbK6o0ZAxXTgcKg42EMPUS17yvubzYPM7pQhmsgvkVsO5mvA1tuEnDts519vOaP/qIHjoeLDGhFFAqIGGevOreaqUxVuW8P4dL8NQL3LQzrwkuzAWlbXdodGiT08UA0mlbvjuD1RtdPUTgKQsl90DAuyBEgNS7ZuSQgsF661nXvtjEd6DmxHP656BO1txjWcMKHA/ZwlFfGTkpxInaATHwLmn+lgF7rDlW+cTfDpErQaZ8OQEsO9s73k9IJX6faF+/9Ti726lCjjuYTrBzNsGORkndLXMgUb5a7xLsdx76/R3ZTO1wI64KMclvV9YtVkMQbOEjLnIvWa16lbn97fcgRHareCxQU4lqr77Qngu6OAi0NoGTl9aV9/bPXAXBobQd6MxchY0z80pfCMawaTd/3k8idI+3oIQknRUMRtpwKLfwjl+fKi42Nr5/hR5fbd+nnHEg5tCiEDhr0YEDFySCz32dt7p7Or4mx+/zc8B7wRj4u7WETscqg0LKhWLgYGz5yjEa8LbtbpfXxHgRt9U9Fvt7nYB513nAjzcTtdXzXpaprdHyBlXML+f2NlD+7W5G52YtpwEO2sMwLeca5HaXQmm6xXlJ3ierCntGMKxqtX/0rUKMQAaj+rY7HBYtqsSX4ld09Vee9hh9mRjALBxBoIPWiIJLWnmAbm1s5QM8B5ICGRGnOJYRWRYhKYhiIUau54WQUQwB67/jBJQBxKfsolr8Zk0q7JBmTIrWLY4alUAGPEsZj+wP7+aEX4OGnCNPtSPwOU/4V20Tq7NMOESt0x0xdkuVW6Cxyn4qiffu7nIPxT+/yUyUlYB6DWV6eTP4nZJfSthvjJTMP86/fqhSHr4daYVH4FwGL55DEaFL7rXBhrx3tc6w0a97ewaO5Ek/Tmk88cVK+nVCWvSSh8EwxrvPs5h/1VvFhi1crzXKCtt2TEP5YJWiH0Yz9eIie8X9O09zJTgrLCuVCCkjpt2CpyKzAx6rT6L/R5TeRz8BfzqBf30LYpPuDGwNgHJvRpWdhayq+wTs0Pjy4vbW14AL+rvYeta98eRm4n0G7TSbgfa5UJA0zyYaGv15Gs09/Wi5u/FBo8uxrDuPGRJkGo4I0mnKb02+l+PDC6rFc25lOgH6KY2hQOVb49Qe44QO5/OS+FH1Ovju7T59yLkn5x9qiB9h8MBop8tIK+bGCk1F2Q5b",
  "hTGw13rr5G2k1j01c49MPUyrU9encADttfncjBwacGHAO0R5eOmG/DVL/NmxN9bGGbjIiHtq9T0hesysCWQt4vTLNIZ7B/Dj7+/pfrv3eSuSd2GBkQbCTrGqqqvA3nzT/tUYE+QEYw2oSUAmB3M7tu3YKXD/vl52db/W9/90Q8P94PJCpbnERlpVhanqJ2wc4NtFetdNjzxEiQbzHTy5RXGISXECjv1mbsiI3AHp8loT+1BzB7jHL41oqDQ8TDvWhMptAEzjkIbuhw7iZb1/wIeK/rdLyay3mdqdY0A2MGZ1WRy0JtVSWti9ZPjJJmjV3/gS98l3qW7K4REP6otG2ilBbRNVCIOX+lNYqlbeZp5vCGmN25XLSfR0zuCjgq6C7qAdo1W+fWiNetT1PUVwMTC4MeZ1VHBOM/sKgDLbHtSHqctfzeshgoOn7MmzJridTKs/oJg6gA547RiCyZuJfDVjXOBhWls0fNVKDy1D11wdJj6mqWy+rZ7uH6weISie7hsKi+5SRAcs9w766awoGQN5e97PvfdT6BIMh1bXGSMgBINROM5QDMNAEEdwLI1gAslQPE2jBP1rHJ0x3PV4K4uSlc3OMXhqiv3zlr2Cg/572JgDrd4stXWi1t5Bh5lKV5N1bmccvSh4e2ij+Dfk3H2wnpIzBrxJwH3A0+PW2ZTneVr6VLjxwOL+js07iP9WqeAslArnHXJePywmEw55Pom1/EYswXqCvnwezzg7A85Ptk8BDpwEL1yuDeFWOlTLytL4fOn0yu8hY6vFdh833vxq6Fyff8742gG+GmkszFO5+sklmaXapOeaIP+J06NRaxQpRe3nKS9uRZXSbXMcz60QgHscSg834rknIakjfnq2yVDhOdRI0uBL4WztXAbEaD8U8cYcKvv9MLMExVIcBdCEyGICwMmIAIk4xOMoSrEYhiMyzsgkwr/Icr50f2RQtTqMnXLy0F1U6J7rHOCYoKfT5zUPJ4HuZ3dfM8GQ9YnnFxKXX/zUQySIRD+ueTf9X92S/owfrXRxgR7wJgAYQtLZUwHx6VvBGyST+DsLtcNPdivF3bzNJeXcEidDc6wgaFQd+Jj5vAZu8uuayj+zKHHTk4/UsUZTkoUCoIsNVGv0C0VM3E/Z299Zz6ntccAHwGurt0cZnSeMEv2pDPS/ZG8/ZRD3yg5yQi+Z6ZTxy1gtDvNtFsKDjJR/yb4+s4G/OxEyWFHJ65E855ky8955iDT7Mm7I4acM8uMc/BYNOpYzpXjqT5OgxhKGAitrd+DfMshfZBXps6hryOLorXHuJ/1mJBrGpSBJMMdvssgvU71/78dn9BY/VIFPX4+CQu3BWD8AUh2KzEshzV007N3dPSfUvt3pu7kGbLZ1lSsCwBdwkJMdkah79+aYI5+9zFP66jc+FMAwJkwt6bbDUSYl+MO1aOyFls+GTAXf0oIu91mFlGu2G9uDbZRp0BqsALwTEN9g45cugsAL7oG24p5XC97yauK72jJ4yEPc7dH0mjFEnhyJSK47qvQKxP/2N+75snsZ6lMjIeRQD5YzqbqxybtKL509naBQzJLKd79zjWHpQgkJF9DYAMWndE8kySxcEGFfaVCwfbnbN7E+3HkidJPr29zW14ZcuuKVZbM5AhXm7oYLcrC7y04Klxunffsb9wGBsHP5jcZE77cpafNUuRCbrsPOJ0I4gsM4xC+zZ7/6nVad744oECE9Z9Qn46zcDruzA0XbOeM56bD87T7B+3jme/fF9IkWjm22kLqJthmdn/PwxpoAdrY793T4+7m4q8XY3Ce5c7/OlqJFhLupzn4OZrDcg13X57XqXFNG+PQbD/Sre0nwx/sVOtUyyCk4qe3hEolzqtrE3uzpQqs+3u8DbeoPn1pwqx3TDGBvsUesFou4OkAHrLwqvfj3teXHt0JhchR7Qyq5s7Sr8H0CCyquSio9oZ/O9oGWZd0ryN/uBfN3CsFmMJlQ4Q3tBQK2oZk7Nxh6/MtaV3rr2lnlyEu3yftSaaDKCddUhbmgj5kLEo0ChMlZa5KF+su+wPIt5+ytMvIeCrkHGb+6dzoxSZVmYdsmfFN3cl5qNyJyheTC+dud/UoQOys/v3TVPM7/eiLr40XWF1DMMmQ6dehlKhrVDuPxv9A5v3tvqiQedtXRIDrdh8Ehk46rDxQufRuP/4nGT/fM8rY5LdZiMca8dFi2W1gXUq+kIUPsf7mrh2yhhcncev3hBrhCG3E7FCCILBoECD79Jzrnd10R7d7AClkorxTnj7Zpo9RJHuQdEizWf6FR+fTOBjpnrG6pXCQ4s8ci2zDZ5MTYVWqQ/3JXD3lESVTfOTiHbMRBhCmIt0REAXpb9/3/ROf7emRR5nSFyDPsJJtmzAAcvU0hFA0h6/JfaAQ+8T2vy3hmjpII0VhxWk1uP2jAbJYhF/0vd6Uyv/geQrbIuW1P3AnZgG1mZorPb0NWKTj9E51P+r6SfZv0yJWwHy9pqV+KmiB1cLNL8dDy4+9+5xf/cUR0th1FYBtDds4D2h+36GIcD5CZfN7TYy93ufXxbFips1D3MPbHDmmMPV+IgY1dWGIzVN/+zhsfsPtABvjTDi6uBAUmh7bk+xOVakwlfn5Tj/tfZfD8yV7Zj6t+toFGj2GdY9JbnitaGLqCNS/f/c6v+whDv9sFZ2E+Yjwc2gwonGIR4A/O7ZMc+vXWLOqzbFTCjudTLLtC/fnk0XEP50rQxPpqVn48h188+0cPsVJf1LJwvRA4ZzlhtWFAc0CiPQ3qf/v+53vgJxHfnLf9PgBrXxdtfL6g1P6MnBbsr98vf33fuI6a6bR9E8w5c2IUwi6vxHLMVJH7+P1HFEwcPrbn9LLZdr3TM8iOiYgL5VVk7O6oDEqAb3/jI09j3lndOoeycfeLpSvbeONh8dGHwKL67nceNoUbY+AhczH+gIdYmVKVvblKl+pw+XwHTf027OfFLvlsWwRkJtMcsgV47cS29iweDIfWZOv4d1pefLVfvCVei664OURI2xHcnRfay08ViIZh/vE3Vl8tfuGNV7lO8XjfZ17PWvutqHGhCl07+kKdJ0T9JC/ROpi/4dODIsTAqQv9GrP4pBlbI+G8EwjZp/TjGUWN0z50658zZkfdaSg0BZO9yhMyDO8TZkQuShdC369/b98TY7KYp6IvvV4JoIhJdoCRnr3A7JHvz+Wz/bVfwGOPgnRd2/01cJYiK+pVCAmX7fLt2TxkEDVMVNxDJwW9perpstUgHPDIOujC8Pjt+vd2/v/4XD/rWoYgfSxN9CBw5PXvxoiHBCbv0PiB+P5sHvIMP11dFdJuSbi0WKAU02WWmTOkn7HLt+tV5v+E54D/O57Tf/GcRsx+tGxOfCTtJZQ6SPNGPPQ51UL99+vt/xOeUz/5x2x/VvXTRZRaAoUsjoWzLtHxG08K5+95DnzwHAvssXQnFrhdFKyAJIHVyVAgzfaF/XY99H/Dc/5nuRsutnxmmGCrJdVEkTAm2Bo+3Qzse55THzpE5k4Wex5Rt+vdccMJG8sbHF9td5n/xfqXmJT52Z9y0Jba3ojZbnovZIYML2CPOIJl/dV7fIDMv8m6t7OlL1XIE2NbRhVxoqJGtsBpJx7IE6gv367/rFP3jp/2wa3ZMiXN1qc7QC2oLIJXZ9pX57ve0aNGWCoetGC8sScoU2kEd9LBKTOWi2Dq06L8RIv/OFdgtx7TWBExGvE5AoseFrTllT0Eh0/6Aw5XfRaYL7L/lVeo6NrUZFqpyo3IEaODQyznR+Ym5ODHvSSPVskXXfSR/xcaVuUT30hpNbXBRQI8Y4cNSS23H+/IS7pVJ9af9AhXSuOlhaQix89HcDaKG3eibipVboMf6XnXCf6/oeVzvOg/+M4fz/uhT+iSmkaDObO23N3OdAfF1UmqDUrMT8tP9Cj/U3n1kZbP8aP/4Bd/Ou+HXjFY3B3kA3nenkQV2aCBrlJZlNc8k/+9GE4msUUBgiy7tbhy6SjSPrQbQ9gJLfNNh8qne9leRHsop0G9YNAG2HqqE3dx5WXmMn7sGvnTrfTZViD0qyoZ08npug69zmPr10w3bojlJZv8oVvoMy3EEkaNBxKWXfsJ",
  "IJ/UnIA0FI/izfj3DpZPssUYVjVy2lhUpTf7mHKXgcmuQdDG2lfdKL8nwH2Wl2fLUfLBPF4DzU2JE6aQu6KE4uhWWl90xbQvyIpf7K2RAxnPpW45WsKA+vfReuSIsixUAR87XN54guiqeQ5HgIaOQ5GU0sRKnj8ayql5n54hwSRLcRyFEhIkwBi+Z9SIMIojME5JnFgPD0tgGH2PkPh0V4LVpHjUsL2pw0/mcXNoXMm4gfvYxSyXn3ZBExAYX7PSJ1PFaBLmDQMKDMxfquwrNyTi1cmm98A2b+OFKQCML9MDIZ7T7lPYeL0ifUgeY+bf1OwfVYT3ARwJ4E1lIxRSqo0DAgKFKQFis/9C13uTWTqidWlHpAnvrhVYXAw3aDKt6PXZ/heavnDdk41vHaGoLYCATZxVIDd4vFWZw5H7pzt4qCitLhIPJMOIxW0SwXdie+ZFYpeMV/1bupLfHfnc/8k+X3/vk/i4zjAaNI5bkD6YiPxBE01gwFwz8f/1N3+pLWnLFHcQj8DMSnCf+jye4iNPBJvs+u2ZPUX9/R5e1TLjbwK/5rf2MEW96kec0wTt0oW2Uv/z730yt/HLsFllsNNlruqZ9HEpuWGf1lXr/vNv/uJfYCIHciz6s4nD1wSbvMnf3BiskF56u+9wdeePIWinVWaRNf2lQCdD0cobb/sidCKrrnstBrmG90ZK722O6CPlkpuldzDOiFLq87aLxpwk2Wrjodr8WhQSNZcvRCFjVA56BvZARwrg9qgAhHLju+xQKi+u4IPe928rkswu7Ota2VtYfDXVdhEPTtkhaaF8pHd+R6/W0yezoJetW1R5Bhztrd2pIU7IVPSJ3k/qiB4uLSzM/r5dzuTNEuXG2C8Srmzr3Pp7C5km6Wft4obNCSwCMtvBvhkdQezCQu9FbpKkQAgTYQzEaAyBSYxHCYljcJKGOBilEAQlGBq/B3P7XVBw79d8FbHM6B7cS8O18CacE1hzIrs8SpsldYgXq+Z3e/TKDusxN4+1amwTTWdqAmGG0plMMEW7VGdEEjZfr/11tKvTmWKhzxobdRywrRrY+/N2yyXM4H1Jb/m/oVd8pZfe4Ge7qjcbzdqZ4zxokH7SyORcItaXax/0kkhvtHo1OfMVudz87Sz5m1M57U35S3rn/w29ygu9NBxRRwV2M8/ww9T2PO6wZ/PbVRior9f+olc90ozJT4ejIOjnXRmhnXne1SZawu1X9L6PDrASfyTKxNYoveVqeJRbdKcY3hgnBfvVN/UXeqkWKEL5YKvAEt6KYzphGeJw0+yb9ddrf9ErDxxsm8vRrvg22jbbXSKnjGWVgVF9Se97E0EdNBQwFuQ6XENzX4nUqSH36MU63L68U/uVH26BNY5RiSsZTfvNdit1h77bp023/Xrt43zxK8o1QYaVxtCrwgHNzdsmNovc/aZejbZ4zkb2m9DmtoNm4DyfbvAbLl1L5cOUE5KAiSxJUwRNcQBfDSkiBHECJaIET1I4AhEIgAkcIr6fji4cYAoEiFA7Tru22qeW3pkLi3ku9766+33Nz0uyHw8EFt0IY2CUCiTLzJYmzpKPX7vXKnzYmO/OcdC8Tb1+OMmPZ6OVi9+g1ynC8LQ/LTxh+1QOFV7rNx+q7IH7mDv/j5P8TG6XWgRd42HZasReX6pa5LCJoY1Ta1rf7+GZkFliIlYxnkHHqlnYfbNF9gJI6VHGdz/s4XHV/JE2r57UR4NkXsSq5IqDrQn0JJTnb/fgSsXbCOnHWbanCWt2IX+gEGcp3aMbbrwQhk9oyn1Lh9/sqhetfbrB3Hihz2E/m9vB8MRYomYYVx3j2/MAS/9tovhDPFA80lIhzMrl4LDQbZPQFh6lVUDbxb/s6Xm28mbrUmIA6zZm6s41X2R8JOQKBFngX/b0CJjRXjcQbZtCt+6c9iC5PfBmotp4eRM/PAvg7lMQ0KrgQBJMAQwnQziGIjK+w7BD2aoCUzjNMujbZ8HuHBf29grN07yUHMbWMSZPZ5HEZl+qElMXBXwv/5TPAWWpujn16YrmipWubLWZrQsoYrfqFcr9XkW7Q15iEY/nYBcO6miHKsGKU3aMd1wIUbdy53Ev47Ue5XTMi7//K66YTRCLXhGT1eUAhR3UaI6RX24H5aWS+xPdz6u6iOOtpxfQJOk6yDj+4vCRHYwHS/e/ofvxBDjD65rWoXbFdNud/fPuJO3tjr917PQN3dDjeo1jlSLarJX4dqphvVY6n/X0EZjT7+h++KDLVFe2zGFW1IC4rIF1fOsI+XhgIeobuh8GnCwOS8P6OMavTJmuXF5tt8d56zkS9A3d6OO8I15T7WNrLzfzPFo6wpdO1LC1p702bn2ge1Ie5933ndHFFKjTyGIB/aooRj2kxG7DfsMnT+tIQ9ne90YU1k85t2zqBuYV0D7ZW13/O93cM+dhHSb5rPjNKBebbYdcAHHZu8nEUaz1Dd2P8z6guCnJxRWuZsMGgxS74J4t7Ii6Qb6h+6HFJY7UbHrgqmuGHfrZTU6xpOYhKTDSN3Q/xACToHVLkc6tT8igFj2WTNJpGuDDjLB/p/sZox4uq63jXdUa2WVBQqWueOtOx5FFC/0buuNH3stRqqxIz7Oe7hZx0enrvpNq8uye3W/oRh557nMf0iEOQemwx9R1ZYJIkNOmzNx/Q7f2kCf5SEjyWdbvgOoLOF2BhiGO9tQUC/B3uo/Ug27lloXcCNkysNfPqmaOh1uJRCiJHP9Ot/gIYLA2WS5nelOc5VPUuC58HK4756DQqPVXup9q5MGnggUWGbhVcCxlNE89skaDWzYv+ePur99/qsXHvW1tz7VKfqrY6y66hRsik7pex2n1nVp8v/+H+njKRa4lObtNg1t+sZoNOhCgkbijG7DT8tM+HnxLiVXHRKEgyVySJ3B3JZFAQZNLoBI/7UN93KOw4Th55IQ88fIwlWtjFKRGK53RsX/ax0NOUufObeP9UiMykvdIeGq3tNdjwOFw/PE+Hny8u5V5LMrFQJcDst1i4HJByFQ7Qqjw0z60h9zSNhUAnzKY4CFsiwubfU7oQb6xNkv80z4ecpNN9BbdcjtwKUBIl7lBcHLyssqCdn/8YR8W9dSTu9iFQjaeBwCjnf1YL3l+O522CvnDPqannjZXV6hCGWBQmEFelsw+b0yc5JkdkX/ex2vN1W/edmKWtMiGD298OlEz2Fzno974nbv/gobX6dDP+hcaVva+uaorDW8yoNsdd8LS9MTqIH1xDi81Sr9j8tNB2e+5o+oVypxDPeJiWauaGNOg4g97ePC1WLQJYu0mi62FmG50ISCnyUA2ghj/sIdnLnOmiJ1HSYmUABBsJ6FQrYKiO09W88MennK5vSB4W5PlpmT6+VBKMk1zathFu/qne3jydBy5gtqa0lW1PSDBtx5+6dECH9DjD3t4yGdqPEdncUf21mojyrZLEzYAoHgXofkPe3jKaGUn3ydrhKQ756KyR1xevqaKx87XH+7hNz+PBSyjW74XOHeT5bq6FPKJiUzaP3y/B+4ZbDam1VLfaaitZ97pCEUjkZ6qbLqUxPLtHqannAX2jmuFap0Ze38jNJbUZu28HqumKD/s4eEySKN6iXJwLpZy3q2yN22KfMcsbI9FP+wBeOj3kNSuN/siqAq04eR0uRHp7KdKPJ9/2MNTxu5CSb02ssWJ9g3UGIc9V9fIR8TB1n/Yg/+Q81E1qfCwbJKrNLRyzYl+nXWNig74D3uAn7WNm8NFWLbOCGpa2yCgjp/oja7xBfnDHp7yNR7DEU6O/TUCPUwDkl0l29P1eh69n3ipetSWYhfXU62l23dEvo/P205ccqyuJFD4fg/i+NgDLBPFoeKSbDNvsz2M9eUSSNZ+QAT22z3MT9mqr1rKoYDEbjXFa3DXwRnDLs1julTf7+H48IPY42T27EFts5Ew1G0XQ55+xp1tC/xwD+JD59OsitudxYONINlnuMJsTF/kIBRs5Ic9PP0hJxvIXEmgBBnO08UgBHic7FSg9uUP93B8+EQ7ZegPQTTt/GERkyTfHVpg591EcyR/2MNT36ssQeC+20khIGebktzuad6d3XHplh/28NAP617z7Hblyzm/",
  "QibjUbE4DAzMxrvv38NDXz9kCyMDEjVkuWfezC7gU7SZKHpV9oK7t76j42l7PGuePTzHsNpmMgQlR8Fl+Oz/lfZdzYoq39sfyAvJ4ZIgiAIKSqx6L8g5SBDh0//BrTPqmT17fvVeTM3UOXbTT4eVevV6spVG7aoE/Ot8PO3BBybfJ5zDBjRXY6SxiJ4OhMEcqQuyptp/wfSUNSjXTPW0k0sFYzfl5cBGZ1ITOB/p/yTzC/0j9PPMY9CqUt7zVQi0IZhtuY7cXRqUZw6O/wdMD/YB+fVN1h0Ts1orK7fZ6CBfdpGAXUiF7ZJ8up6HP2Da5d+EwiwNPhgmYhlTr22sUG0v0AGrChr7k5/xX0wPm0CsspO2GaUEchwsO22lwlvbs7shrLx/wfSUxdHRrG+yxtZ+JHPe5hBi64G+RqoCWP+C6RkbOFyuARAOrg2vXAXsgO4GaCtwP0bn879getgIlEYSFsvbIglZEk05R0ifDQWqNpj+XzA9ZTN+lv29N/HqELF9JAZweYV1DTgw4Z9kwlfx5M+zFG93mM6DuHtUoULDW6g/avtIP4N/WqOvgs7v54jPeLc60QxAg0oYYzArz9K5KS+qof4Jy1KJ8vMMwWe9w2G1JqdozBjPTPKekI8DuMt/xPE4PzSD7bnNZocIKbo+agbg4LDbb1sv4c8/4XhGyHN94tSgQkvnmiJl31UKynlQ0wTITzietiM+I8CJzC9gNr+CQO8CFQFarDP53+Ow535cQ+8XeoJfecC/1ofKfGnDndjLur+RNBDrkXfBMWS3udbTt7hyl9fnflHAG1/zkh/rJZL5zbcbeEDIa7HaUt1QjLF2mfyw+B7n3K8x91uqkzifC3eRYS92P2/l3GHfASa9o+II56wQnRfQxneHf8PtFiTwGzN7Qt3Gd4WjJ6+6dYwVDNv3YivqAHD+J8wPZp8n3pVBONNVdZmVy2RmRcjjbn1K1bhp/w3vUrjrN9a1VkqMrINQfQxykGuO6QD3LptYevW/YH3K/dIqV8eR35ZCeDhBNSNgxECve6zcpd9ivROJei9vx8Qo6CJzdxlBTjrHUwnN4kQrFyb44dsx3V/M3ykxHvMkUZTtI02Ps9Ce3ROcYmlFZ92EGyp9O0/3y+d4+i3zaTu/XnleXCF76oLhV9p0Ob3Z962Hfo9n0avdgudpJxiZtxskHbzctjWTn8TUQGvINclgkr7Fc9fx9zclj1gq71eJSLNHIElFs7y43BqkyExj2XT3PZ5FN4PT79gAU1vZ0TALkDpF5llXExM7ewISOwo+/YjnV2yVd42I3xk9YJy59EiddE6HyCsToef2ZzzPGOuxuYkVjUE3AQWRUtbXjHhjlSwWwvXPeJ6xVsZ2ZCIcEAlGEd5qG2UTbY2BchUSSP8Bz2N9+pbgglIkq7Ki20OTGUmUFZI62GT0D3ievn6iZlsB3LXhSXOo7uxxO+ZUTqZ3of4Bz8PfZydBPeBryM3p0lIxBb/Rl56/tLyfsz/jecrtiw5TkqlQbGBCpxOXFwmMVynqtNef8fx/2aZv4/nQq4dVfzpJ0BZuixsdgDAbGRfbHwWz4n6cnw/9Suh4cDEGWU8qxs2iBHWTmxCBOOMB3+DTJ9tUunuhKkMG/K9EnKd8Lspg77bd1lCAXtw7KGx0KYMKt3P2HUZzqQACLtd8oAWr4FcS0wOnHOwPXgB6nQPF5bZNLxIDyVdXJoVv5c7CHiWaS/GthRJmyTX9jRUd43Nvd4vpKx1XE1fvQCE9rYTVpvpfsD7lM6nCEM4jm8pnzHMecFmJ5+nO91fr9H/B+rAxqCiQLvrpyEUinuTE6EPFHsNZblLr/wXrc9+6Jkgq3i2lY1RDyxXqki4DE6jr/+lub94bS8H+B9HzM04z+GtUUlxjs7G7qCqB/DD2gn7x9e4P+PwXwpBf68fRARVxfoiMcYMcitwXQPyw77dy8qe7COA3mcnvNct5lnW4NacM/do8Iznr7dYcx+7Fk/UTjqf9V+GDel6fzcuavyHZUTvupa14YaJpw/6E47E2dDvgYNAkmLjeAlvPj8n1WYsysrUuP+F4rgcoqLeowYUcrBRCtHzowNzU9UaKjegnHPAzbsaZuICw672i+4ZSUok8MjQ9grU4/YTjofckchap0Yo4UOMJ3TVRcQqtM7Yqz+vsJxzP+OFRq7KdaiHcCe9n2YSsQZvr9oCpBN4PODaPmA0zIPwNVzuwBQIKMPC0QLWp9W9eIv2E46nvGG97YjZyNpTYfoK8kvP0GO8TkDk2P+D4FUOUEWkve0R9JuJh2q59cG3FmhPBoLr5CcfTngFjp7vmEMRvnCjwtREB93KDrc1M/el8PPWcZMK4p1/79GDkxCEeWvGaQLmNrLc/4nj6rkp+pbxb1MshEbBFugq2uyrwT8ZO+emcbx5+K2s59ZWszKI0ADTnaTNZR9sEm0765UccD5/1kNpxieJsZvqtjFWU5KGbfRqrHlr9hOPpr7ajtUsTx2hVBaKgeJS9LjywYBqkwE84nvaY39Khcw1thoL4i6fkN0fzmTNtOuVPOJ53kJTIcLfjLbxmXWae+bCawgOwSvrgFv6A41c8UWjGERyT1lgPThauEtSMlaPio8fhp/MhPO0wx5VUHMpl/sKgxXFwDLtkSGMTt9RP5yN9xLcPUhUV2nprkMIAJhcc3XK+ZZU0Hyk/4XjGFINq19mjHnPYiBTy2mlhPK4cw8Dp4Sccz/sWPZ0g6KjvU22beQ18Vet1d1qzu8I9/4TjEeOW45slociwtWB9bR3PPbdbg5Fqbl8yFb/D8dAfwJkHE78IzgekLy6sshYgqG8w7sIJf8fxkfIkMkSUs5XDbS41SI/NeIWrhow5XP3Hfh5yp6rgzqxSNlmlq8GHrsKOC2MmRcCf9MCH3TaBZ4RdKbrhx0kgwzuBVnbTEPUHAPmnfp7rTBPXHg2w4Xay8euF3J/H/QAVw0HwpH/r5zE/hhw6DqrvGq6jwHXDVEet1HjugFyBf+vnebcDcY7tdUAHp9s4pC0o16fwxFCisHlLn8IcFyOCEPcRBCMI3PFhEMUAFw0IEAMdCHZJEnIxBP17VuEasyMh3UYbPhEK6uLeEFa8HjjASH8fNXh20dt7QUpDfzHnqaobYMJz3Y5IYwIK5cOFs1zmTIHY922fR5zOuXGDe7Ef60w1b6AV6a7ghEvDlyTPz7YPtcMiTBWzswbFTIY2yfHAYmVIJmW11r9v+zRZlcttXElqJYwAN7Arf3fLxE6frir/XduPY8Cr28gi4ptN1YiCksz5GrTXUzhq9W8T2of01uXvNIC5zXy4LqKNslPADrwVq7YympQBIde4LlX6d4mK98pqnykS9pHWspuN9cd009Ds/loRyS2gLtPwA4bnlr+p2iARwPm8lHm+IeroYJa4AYyGaN8TVyE8IB2YnPcYPm82BMORAAFxGHJweP7bCXHPhUnAnX/6pD6zIHKWYmS/RJsoXrYixz7wAGfrGI7Wabo7xsG1Pwv98/d2qfcLXdlSs5Ta61gajOxa4HtLL5ltTp2sLgvyFGf/soXT2fDZnjbzt0B+pGl2dz2sclHEr9Gvgn536hNqqmdxXJB7lLYysFE46QpAuci3Xmo9i+YNi0diLXVA+fnPQIWaEvTj4VQo/MEYz8a41jbcQHRM+6sI3u9XWhSDxK187ZL2yOByKXmNMqxivL1t1sET75Pk0psVZabTO00CsRxOTqHNOa5s15sNFYofpJYYjBIE6GBIALoIiJIo7gQh6WDz4SPhYFkHl4Qh6O+8sHTKGU5CSEqzBcHrOQNm9dqccLMVYPaFwnt7X4rYfaU1Z0s0c+WzmiOIJ+3iixs6QI23wJaXXyu4P6dhoaJ27skk5Dg7Z0vwMX2jl+cB54juPbgw9od1j8U3SE2G3Yp1B/i1NKTL50syyAetuJ8hckw0kQWEm8hVzMoNNydVulq31ylz5jki/MAj4NCbpy7A5mnzIDBAARDClpdtAYnBgffOH5TPB1S983Y+SBj/Q+QW3Sog7cAVg2SEQ/KpdJS2se5g1IvNvJBx2MAttgq9/a4fK79c4bbExcr3zxKeM+TGwlLSoGTl+/eZzJFN",
  "N5yYNwUDgAkMbNWVd7vYGE+83l8NliHn9uZZdfiTCI+GaoVLdn6y9op9vJImB3MEBet8DfvYdV5AeiHmO1iIOPOpxyDEx1wEQGEo9OGl6jHoeDgEY3/XL0dpPDVDFCXQJi/G4ojHFzztgEubvJCxe4VeOGb8TgDPpmGOyQgpwmpw5PNwGyD9bZDjug/feQMePIOvRO4ywq+U7tiw7RBgiQapyplckfjQv7o2dDz7Te0rQbeuQpQMzrLVw1h71jM2Hl3EGNJNU/lzu8f3mtEnpRYrEs4IpPqGpdugX7EtNDXIn9s93rrJx0m4aaMAkpbQizdnjXVjT3Z74Qq8s9qGKAjMh37hgp7FAIDBJDYffdSdlwIBAdSDPReB3L9nSjMhi4b9USW40ZV7sJFnw0vta7JRtOl1KV7k3+ty8KYGV6h3ozxTCMucvWCrhAkmqbgYb8txAmcfBs2cXzzeX1DB9Ayz8THTrRsmMviFD71iCw/TxXmJYmyXF9a72i2WutJ3/u7n8yvct8FVA5L4pvEqVbDNepZft4wwX+gb/zD258lxSodXHEUSHO8QXij2MpprYu/Ep+5vY3/SfkwJDe9rqd64oSyI0A0aaNYTOpJRs7+NHX7WHKZdT632U9kxMO+d11yglntk3AYvUdhZSsigt50FcKkuJsPkzXrCM4ZXFrPDyMpmUGeQlfJEjcgpWcb1ZR/z/9jPs9S9wRZedlEocX8wqi3vQvCpM3q1qMZ/6+f5mvl4EVjtNMBOeUY2QHBo9Vzi057MovSf+gGf1LxSTcXHztFOMD0O6Ekf6CV7dsCBfxsP9KRMwFZYw+MR2GYaMWIWU2P6Ke9xl1LeJRsUQKAL+G7gE858dKDA80lvlmUuAgOhAwaB5yFI6P9dn1IOKEyqQzvoCTAM3iAOE7o8lAqL4O04PYuHgtNy0WXBr1zjLL4P/RFqt3hJRACE1SJnSlwThpcw/XMfX7BvXDBv11fJFTZ6EfL5aePHA3qr1igDyjLRdsnbJeN/JV5SRbWokNfMPpbG7K5eYe6wa3D5Gr1bggBBLsR0JAp4Pu6QOE7MtuGsRlEH83wMI0EAAcDwBxOEic8ED2m4cK6wRoOU3XLFx5RXl2X/S61+WGp//dF8YE8b8nyrkv3xysRdtdKanYORka6C3psJEECkjyzs354HhISPoSGGY4GP+BCCeyAcujiI4SD0baVoVhhM9xByqYGkBVLyJaCVKzErL5z/e3U0y5Sb5Wp6Vu2oawwU5FTkYGCHoho2Ja5diwowqArfgbzwNDLrWbXPECVKHV3mqlciHMWykNWMBSIpiHIhukFei79nC8eNs1W7ecdsHHx/JHMklJqbU90UdjjOPvTYHNo3LpH7eFIPlqj2hgh65UBd617O2yMZDrOpdFbGEzY8xwPP1toy5RPFGcjA25cqN+xJMxOJyA8GFxok1ldvPAg4hHmQ66MO4PoBQMxTCiEOAs2GagDBPj7vizBAkODFL5hlcmzDu9kKkqh1RFz4zabLgc1Oiq8m3WxqwnHNU9n+Kqy90CDP7s80iwcOxXmhRIM0Za9nFNveDoRg1sx4/WVTF3k+u1zjbFPnuYWqvESI8iaxx5N8Bg4+0TObXv6QAWEAhJADEgg4W4P4rERnCxp0fRzAXBAiw9na9nHEwd3X3bGw2hhyuyTAuAs7cqE/X4h3CzSPj3p7easF5dfZU4PspWbLkd9OV/mQwulw0NO4zJ1DDmfF5p2wPXXviSzLSu8W9rvpTl2wMAl/9XtPYnrvm92vu8JOG3KbQaFT7TS3ryT0lJe4w/6vfQsffVMSyKc8JiTXY5Pk5iYR16ezNjtqx9dE4T/0DTgGmCxFTiRouczXJ5+fvc9ieTPm1+6ITn7hURgVXCow5vwzlIJBg5bAes9Glm8k0RsbkAUNS5JQv7AxfzEL5rN6Hzp/ktPPPglBuiiiq+RskuHcetv4aqxJK+yWZe+WFOShAe6CBEGGJO7MHhTs+nCAO2AIwu7sIeDzNvac8HXZNxw4uzKsC93LtwO2pmfO3S1Bh1nTU+RUA+ZZ2iazl3s0OVGJsngU0EPzkg+mFOR1bhu7+UOebd77cLdmyOC2r8ly3PjuKtwaMB6vaRb8fQeuLnE9na4tqMu97L29WLaezxJoo6qyGK3hnVhduXXmo7z10X62TgxdcYxZaJk77uuUCb3HoyW11cjWzG1IajipTqCTvHaQfeThjPLbwtuo+ezB1u5Wfm8rH9QEmjXQenbXzX4FX0HDr4at24ja77Z67xvg+UsNqu/tN1YStGZAHLhbpAGljV69XNZVNtBevp2fTh9zXyookU0sOFseQzMp7UHqTPaAQgL5G7dW5KnDqXmw/fgmZQ2OCOX2ITufjWzNh7jsqsZFjrjfbuhXO3rehrFqqPXdpS3pfj5+FWagrj+J06C6edIcT/iG369pBXoJnGmz3wco89GwdH9uG9/JJj/60dKzdlKz2CAGwLsaibAGUsFONlvoox91lnIu/4GB2VSzn5nre9gLGyPLVDM/YroXzf76BwbeWfJ2uG/HsYWxbi2veLY+pXW+bzILahlq8sbDh18IoSRKBCgIEl44DwRBCJL0SAhGYR8IcNxzCQiEAvidgeGrboXOc8m8/Y15KPB8oh/LsBvB22ARGXKkr/NKHSG54mbLWh+ubxS5qEt4AIZhjgOh6PxJH1mUDeyRSIASKO5jIe64DvGqcx4IvYE1AXN25dogdBSyPfiOwOh+40wxx78ISwsiFx/gKSAf1Zh6p1P8mwOw4WWSwRSI3K6IT1URjC+KIZ11VX4vz/EraPGoQGRVQuKe2To+31JLzVK6BLkzbWr77KnroK/pmHXdlmWZemx3mVaa0w6YEmM8cRW5vyGHt3IRuA/iBOTMhitOhhgJhJgHkz5GEACJ4piLLUQYKPj+nnwRYkT3FZ675f498eq5Ae62KKnaNXyRkmrl9ydKTaOhgdNkMFXqt8xPvphGwXthVtH4dRjvUK+qCkSINntSCGSvrKRPycHiTzRoSS8sxA9BmID5cyN/FWXtdVhay/aOrikBjNuVmdR4dagtDHwvzr8kZ80HGroXBH37PssQp/KApTZ7k2kLVAU43BlnX1HY9o0kYEkqmfXUkqD1JUw/x7J3tmApSrDh4zs6yQaZSJLKK7OcfWFEfQpC6WMeaQMlmV004Y0HElZtprF/PEauicgvzG25W+rdb+P24/vH1WHysrUacY1Rn2H75iZGDoExI4t/ClYtRAVP3+JjTSWNg/fBDeC3uJUXri6AFNMgER3p7AvbapF9tKPm/6YzqtPreXVMi6pdleIO8FdH7eXR6SLMk3sh1btg+vw2HQyn6GS7xKHST6wNpjrEihzvTv1LMvA4K6JquQwJtp/tGYjv1E2anRDnvGODAU77rJCygrQvb4xsQvcsuPXRPpcx0T2k9ZCGgp8IeT8ectPfEZvot2AFFsEqGtxsw2w+5yAR3VUvImeA2SfovruWmMGdzckHUPbP7Wf7CXAY8IuR72NvWpeVy2Pijey3uGlPttk5J7G4XokXBtvZVkL8e4HaWVB/7onDWstped7JKHfourimoKg+N/FqGF8Swh7z+FiPv43HdCKytNOR4VeDQZ9Uco+arN2cTvy7vYQDHgw4pOd4EIagEI6GMIQjXgChLoQQqAP7kAsGwLvfdycYbJbcUHvJBXtY588KM1chkwPpCOYRmrSHPUFdoehgUBTywgUyOyOxs5CUmnZtm37+HHZB8sOVNSto3ocrDFePzRbdxTEzpC9EwIujxIDQU8l81VTsfCdX2hs3TlqdzHa+sr9dpUoxjJf6kDHqLXlr9+JBH+03iJakR8RKx6DYRB7q9WyaUt62XDsvR7KzDD//HHM86VI5NMRuwlORMeVCJziaiUEZFl7Ii3f1Z7sw3Hg1UGD+fi/tWre06USbjUPBW78S4XKJvdQBfJtjNjZhojlWWwI4Do7qwBURbmezm7ek8zsp8T13aomYfeI9nvfUqRg3QXs5MdfVMW+lPTAZ6ja9vRZLWvL8rP98nzF2zBkfYp9iVrREmw248j361uLjC7fJs4AaYBm7Jc/vY72MaHfaG9Ee",
  "A9ZnmqEOLLWCFZuxvOjNxyec0IOXnUiAi0USOhDp4jiGw4QfOg7pw/P/gmHwxSjwtrvr3V+fHdFDTbOYvw1Z1U4x7ipTomrLrtRiO+m/nsjX309KnG4Mrzh1xfcoSY8Q0/KRrRkHAuD/6y3qTx7DBBVhed72UXPBLfLGOocVigi1jW//47E9SlxCHeG6lGLzysW0tJiWSpQ011NJUK/j6+0lve4Z3fn61sqG8E2HXNYYW+oTsBOak5fjxsoy3jw4NA8e3/J1y4BrV24HfhUbUlPPPYzUNpVv75Eg2CEBBA5IH/RDwAcxDA4I1PV8AHARdIlJw5AXEOT7zYqcPQNOwcGU+9qoET1Qw2LQyNvEGKhHhCL1TrUIuxgIIiAIz2vqASgK+jDhwhhBEkHgOoGPBSGCgP6boyYLioZuVV3qXUOhgkwllU3AeoAhmXS7A1gwb0G7Yq3sm+gK5XjpDgIOZ8Ip1LjD+di1R7t2Tpj/skLP0KM3+6L3kIYBLjRmiVtYFMLT+XZcKfqUs7IW4wDBKwMSDVYi/TcOZ+5a0fDnAwR21rzxv8bA5EJ/6tZHqYwoVoV4bJ/Rviw2WbH+CGGAJAQi3iyaA2eeGDzwfBfDPdJ1YReGZ2/VIxfjHHfeojD399m/QgDzYVj8wZGirXhzE44FszUrb6070pgHkmpN+87/ti0U5wEvUTo0APusbTq5hwpS0HOUOU3MZfIh7RcVmT1PkVuqtQVLVFYzmJP7NykPKqpoOvB04FbdZdsdqF+/f4QWYquUH4Sr4DNPhtKIsi2lAoULLXNWnp7T44CTOo1ayvv0YNC8e0AICMnZI/FnF99bmMeIecZQnPAQdPmXi/ov0zNbhbEN6RN1IGejr54UMptt/X0ANa6GVIEcbvn+1QKzZ40tFjGwxP1GOy5shdEuAmwj2XiDIMRN+FK4cMArR/1ssTx5hEHRaFMgq0mphNwrtOGwci2uXVl9KZp2y1wI+LVMz29N3mqM8V0sMqc4TZjpRHerg27VF3R4UQ3q1TXlhQN+dmrQdinZ+pANAHLkM7zJSHDccGlEol1arlKTy9dvlykLb61wP0mwm67n1ZoVbeWSCGqKoBSbZHQY6uFTTvb3bUGxeYZW0tbDuxK0pqQr8fnYWNQOZYRvZN12m9/a815CbgcRmvV/xhmpEzs3FrdeLaRHipQ+PecCcUfwcqlv5xHP6NKI11Xl8JGHlxbxth2CEAdg3FsyF2CfhHzSASEy8B0X85EAInDCxz0cdIJP7laTnh0n/R4BEA0bXPhO76/e7l4zveERgmMUYdMy0dHdhsKBkdNDdyW49D9T2T2319x28LcRhZi1gqARNKtAReSyum2nY6567Y18DdpzoHWvPPxgM1to0u9CA/hyn0UEgbEc6U5rGC4TuztNKqFP14tqAm/uMz77iAjkIC7kuojvuhjp+hCIkjgJkJDnQbMMmRUn+nEh/rrDm8njAqQCPIZTEXJH8ph2Zlo3kU+vtKFkOhsEvQXLE0XXAobEw5QKTVzlnHClO1oWCMJ32vcsExJwHWw+lTgIQ8vFPQBhs4T3UQgm0NDxHQJ3kQB4HRqDLtciF9uQAUqIwhV+c+nRK6v4xJnkSdMyUQsbUHiJ4SHzqi3sobU1opXPg/MBPKoGsxLpUriR5YBoE1OoAlfJ6fQ7R5CTFUXfqWfm0WYvCEexvpKaxNS31SVwB6GSt6sGUH5Fox/256z80cw1uGy2bX4F/OvZn6Jqgmfz7hpcQv4QnYNcrAdZjV5UEljO2vIe32qzASp2oQRkVAeXuWJShTyfP0rNiPffj1+/ryQPV42Dg8o4KEO009dCr/EHeP7q2+9l5uv3+CmFoQK7UMpFl5DipAllPdVlGh2r998/xgOO5+MG09upms6469OmbKSYMKr780f/z7hkjPPW8WhJqpxldJS2XI3SeFEc9x+/f4wfg06iSJPott+DKHwEpKhsCN0HuJvy9vvDY/yIdb4xAMn7m3pn0a43W7RRQMp+KWTvv3+M/xTccD2Eo0luzyy4sQ91YdsBL0Zr4BuTgNkUQr8JSlQWaETsgqbryK0/XDfZi0nQupAcz4LsfuGC1nBS4KIKZrKYjEXvg4019CdJQzevjKyjB2m9V26oqN3OuylshqQqEWWvtPG13FK10xyqNwHmYKgDhABEhgAGBKi7xLsc3MNgB0D8gERcZxZwn1Gf+QQX+hKhT+/bsLRzr5TzxzOdLwHCreWMRtxBmbUBHXBigjXiGdrudcP5pp+rW+hXO3k8q/kShPuYGcWO4Th5PWgxofLMahouxlWgXiINbmEvtya9BWmP5yDSI/TcT03Uj0cCMg+3dj2q6JV2bIzBT7dvxjA5j+KRHiRXi3nxGAfT9nBT46dIxLxk3fb7pDi3bEfOUuh31OHrGaNcuVA+9/W1NTJL3c128rZQkVjG/YG1gZMk4QHuvtxKfD1Jmj1p+fIIm87+9wasoCw1ZLM/5vE5BSVGzXxkYj+/N+uurYo+xomFApZr+9soFMZwGKtqVOrBZkhJ+M84/dGF9eHxvdPFL5M+6lbshj5jQgZIiaARWiu/uHbP504PDnnwixB8u5tdahT46oeJNMZdDbEzbVy3u4yd0sWKQid0d/0I96KwRwYe6c2GJekHGAohmBvgs+JAQM8FgtmkQsAAJZC/KA7hBhQQIZM7nVl7oEeU5wSoEY5qjsqfFQerSDh80lhzm6FZgcoYvtalOj4F/mtVjMq+Z00Tv1yzxxUpdA4ZEZJI8UbS2aBB+PF4VtXbddTuBvT/+z+O7G38lD8BAA==",
].join("");
const oracleImplementation = "1".repeat(40);
const oracleRunId = "00000000-0000-4000-8000-000000000001";

function oracleSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function oracleJsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function oracleWriteArtifact(root, runDirectory, name, value, raw = false) {
  const bytes = raw ? Buffer.from(value, "utf8") : oracleJsonBytes(value);
  const relativePath = `${runDirectory}/${name}`;
  const path = resolve(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes, { flag: "wx" });
  return { path: relativePath, sha256: oracleSha256(bytes), bytes: bytes.length };
}

function oracleOutcome(declaration) {
  if (declaration === "unsupported") return "UNSUPPORTED";
  if (declaration === "excluded") return "EXCLUDED";
  return "PASS";
}

function oracleCounts(cases) {
  const counts = {
    discovered: cases.length,
    eligible: 0,
    passed: 0,
    unsupported: 0,
    failed: 0,
    excluded: 0,
  };
  for (const item of cases) {
    if (item.kind === "EXCLUDED") counts.excluded += 1;
    else {
      counts.eligible += 1;
      if (item.kind === "PASS") counts.passed += 1;
      else if (item.kind === "UNSUPPORTED") counts.unsupported += 1;
      else counts.failed += 1;
    }
  }
  return counts;
}

function oracleMaterializeCandidateCorpus(checkout) {
  const serialized = gunzipSync(
    Buffer.from(oracleCandidateCorpusBase64, "base64"),
  );
  assert.equal(oracleSha256(serialized), oracleCandidateCorpusJsonSha256);
  const files = JSON.parse(serialized.toString("utf8"));
  assert.equal(Object.keys(files).length, 704);
  let totalBytes = 0;
  for (const relativePath of Object.keys(files).sort()) {
    assert.equal(relativePath.includes("\\"), false);
    assert.equal(
      relativePath.split("/").some((part) => !part || part === "." || part === ".."),
      false,
    );
    const path = resolve(checkout, relativePath);
    assert(path.startsWith(`${resolve(checkout)}${sep}`));
    const bytes = Buffer.from(files[relativePath], "utf8");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { flag: "wx" });
    assert.deepEqual(readFileSync(path), bytes);
    totalBytes += bytes.length;
  }
  assert.equal(totalBytes, 1_689_423);
}

function oracleGit(cwd, args, input) {
  const result = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function oracleSkipAbsentCandidatePaths(checkout) {
  const deleted = oracleGit(checkout, ["ls-files", "--deleted"])
    .split("\n")
    .filter((entry) => entry !== "");
  if (deleted.length === 0) return;
  oracleGit(
    checkout,
    ["update-index", "--skip-worktree", "--stdin"],
    `${deleted.join("\n")}\n`,
  );
}

function oracleInstallCandidateGitIdentity(checkout) {
  oracleGit(checkout, ["init", "-b", "main"]);
  const serialized = gunzipSync(
    Buffer.from(oracleCandidateGitObjectsBase64, "base64"),
  );
  const objects = JSON.parse(serialized.toString("utf8"));
  for (const [type, expected, encoded] of objects) {
    const actual = oracleGit(
      checkout,
      ["hash-object", "-w", "-t", type, "--stdin"],
      Buffer.from(encoded, "base64"),
    );
    assert.equal(actual, expected);
  }
  oracleGit(checkout, ["update-ref", "HEAD", candidateShaclRevision.suiteCommit]);
}

let oracleInventoryCache;

function oracleInventory() {
  if (oracleInventoryCache) return structuredClone(oracleInventoryCache);
  const checkout = mkdtempSync(resolve(tmpdir(), "oxigraph-candidate-corpus-"));
  try {
    oracleMaterializeCandidateCorpus(checkout);
    const inventory = collectCandidateInventoryContents({
      checkout,
      implementation: oracleImplementation,
    });
    assert.equal(inventory.source.suiteCommit, candidateShaclRevision.suiteCommit);
    assert.deepEqual(inventory.integrity.declarationProjection, {
      rows: 569,
      bytes: 235376,
      sha256: "25730098efb04ac9be0f853439843b7874784428ae712a73cc0d05bdcbc1909a",
    });
    oracleInventoryCache = inventory;
    return structuredClone(inventory);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}

function oracleObservedCase(declaration) {
  const kind = oracleOutcome(declaration.declaration);
  return {
    kind,
    file: declaration.runnerIdentity.file,
    testId: declaration.runnerIdentity.testId,
    detail: kind === "UNSUPPORTED" ? declaration.requiredCapability : "",
    inventoryLane: declaration.lane,
    stableId: declaration.stableId ?? declaration.id,
    id: declaration.id,
    type: declaration.type,
    status: declaration.status,
    profileIds: declaration.profileIds,
    declaration: declaration.declaration,
    requiredCapability: declaration.requiredCapability,
    sources: declaration.sources,
    references: declaration.references ?? [],
    runnerIdentity: declaration.runnerIdentity,
  };
}

const oracleLaneDefinitions = {
  validate: {
    inventoryLane: "validate",
    artifactName: "validate",
    example: "w3c_runner",
    root: ["shacl12-test-suite", "tests"],
  },
  nodeExpressions: {
    inventoryLane: "nodeExpressions",
    artifactName: "node-expressions",
    example: "w3c_node_expr_runner",
    root: ["shacl12-test-suite", "tests", "node-expr"],
  },
  sparqlRulesInfer: {
    inventoryLane: "inferenceRules",
    artifactName: "sparql-rules-infer",
    example: "w3c_sparql_rules_runner",
    root: ["shacl12-test-suite", "tests", "inference-rules"],
  },
  srlRules: {
    inventoryLane: "srl",
    artifactName: "srl-rules",
    example: "w3c_srl_rules_runner",
    root: ["shacl12-test-suite", "tests", "sparql-rl"],
  },
  compactSyntax: {
    inventoryLane: "compactSyntax",
    artifactName: "compact-syntax",
    example: "w3c_compact_runner",
    root: ["shacl12-cs", "tests", "valid"],
  },
};

function oracleCandidateFixture(mutate = () => {}) {
  const root = mkdtempSync(resolve(tmpdir(), "oxigraph-candidate-oracle-"));
  const inventory = oracleInventory();
  const runDirectory = [
    "target/w3c/shacl-1.2/revisions",
    candidateShaclRevision.suiteCommit,
    oracleImplementation,
    oracleRunId,
  ].join("/");
  const observed = Object.values(inventory.lanes)
    .flat()
    .map(oracleObservedCase);
  const lanes = {};
  const raw = {};
  for (const [name, definition] of Object.entries(oracleLaneDefinitions)) {
    const laneCases = observed.filter(
      (item) => item.inventoryLane === definition.inventoryLane,
    );
    const counts = oracleCounts(laneCases);
    raw[name] = `${laneCases
      .map((item) => [item.kind, item.file, item.testId, item.detail].join("\t"))
      .join("\n")}\nSUMMARY discovered=${counts.discovered} eligible=${counts.eligible} passed=${counts.passed} unsupported=${counts.unsupported} failed=${counts.failed} excluded=${counts.excluded}\n`;
    lanes[name] = {
      inventoryLane: definition.inventoryLane,
      command: {
        program: "cargo",
        args: [
          "run",
          "--locked",
          "-p",
          "oxshacl",
          "--example",
          definition.example,
          "--features",
          "w3c-tests,rdf-12",
          "--",
          `${root}/target/w3c/shacl-1.2/data-shapes-${candidateShaclRevision.suiteCommit.slice(0, 12)}/${definition.root.join("/")}`,
        ],
      },
      status: {
        code: counts.unsupported > 0 ? 2 : 0,
        signal: null,
        error: null,
      },
      counts,
      complete: true,
      errors: [],
    };
  }
  const state = {
    root,
    runDirectory,
    inventory,
    observed,
    raw,
    lanes,
    aggregateCounts: oracleCounts(observed),
    implementationCommit: oracleImplementation,
  };
  mutate(state);

  const inventoryArtifact = oracleWriteArtifact(
    root,
    runDirectory,
    "inventory.json",
    state.inventory,
  );
  const casesArtifact = oracleWriteArtifact(root, runDirectory, "cases.json", {
    schema: "oxigraph.shacl-candidate-cases/v1",
    suiteCommit: candidateShaclRevision.suiteCommit,
    implementationCommit: state.implementationCommit,
    runId: oracleRunId,
    cases: state.observed,
  });
  for (const [name, definition] of Object.entries(oracleLaneDefinitions)) {
    state.lanes[name].stdoutArtifact = oracleWriteArtifact(
      root,
      runDirectory,
      `${definition.artifactName}.stdout.log`,
      state.raw[name],
      true,
    );
    state.lanes[name].stderrArtifact = oracleWriteArtifact(
      root,
      runDirectory,
      `${definition.artifactName}.stderr.log`,
      "",
      true,
    );
  }
  const receipt = {
    schema: "oxigraph.shacl-candidate-run/v1",
    kind: "rust-suite",
    suiteCommit: candidateShaclRevision.suiteCommit,
    implementationCommit: state.implementationCommit,
    runId: oracleRunId,
    inventoryArtifact,
    casesArtifact,
    lanes: state.lanes,
    aggregateCounts: state.aggregateCounts,
    sourceBefore: { commit: state.implementationCommit, branch: "main", status: "" },
    sourceAfter: { commit: state.implementationCommit, branch: "main", status: "" },
    complete: true,
    errors: [],
    completeConformance: false,
    qualified: false,
    promoted: false,
  };
  if (state.mutateReceipt) state.mutateReceipt(receipt);
  const receiptRef = oracleWriteArtifact(
    root,
    runDirectory,
    "receipt.json",
    receipt,
  );
  return { ...state, receipt, receiptRef, inventoryArtifact, casesArtifact };
}

function oracleJenaFixture(mutate = () => {}) {
  const root = mkdtempSync(resolve(tmpdir(), "oxigraph-jena-candidate-oracle-"));
  const inventory = oracleInventory();
  const runDirectory = [
    "target/datalog-oracles/jena-shaclc/revisions",
    candidateShaclRevision.suiteCommit,
    oracleImplementation,
    oracleRunId,
  ].join("/");
  const observed = inventory.lanes.compactSyntax.map((declaration) => {
    const { requiredCapability: _requiredCapability, ...item } = oracleObservedCase(declaration);
    return item;
  });
  const counts = oracleCounts(observed);
  const raw = `${observed
    .map((item) => [item.kind, item.file, item.testId, item.detail].join("\t"))
    .join("\n")}\nSUMMARY discovered=${counts.discovered} eligible=${counts.eligible} passed=${counts.passed} unsupported=${counts.unsupported} failed=${counts.failed} excluded=${counts.excluded}\n`;
  const lane = {
    inventoryLane: "compactSyntax",
    command: {
      program: "mvn",
      args: [
        "-q",
        "-f",
        `${root}/tools/shacl-tests/jena-compact/pom.xml`,
        "compile",
        "exec:java",
        `-Dexec.args=${root}/target/w3c/shacl-1.2/data-shapes-${candidateShaclRevision.suiteCommit.slice(0, 12)}/shacl12-cs/tests/valid`,
      ],
    },
    status: { code: 0, signal: null, error: null },
    counts,
    complete: true,
    errors: [],
  };
  const state = {
    root,
    runDirectory,
    inventory,
    observed,
    raw,
    lane,
    aggregateCounts: counts,
    implementationCommit: oracleImplementation,
  };
  mutate(state);

  const inventoryArtifact = oracleWriteArtifact(
    root,
    runDirectory,
    "inventory.json",
    state.inventory,
  );
  const casesArtifact = oracleWriteArtifact(root, runDirectory, "cases.json", {
    schema: "oxigraph.shacl-candidate-cases/v1",
    suiteCommit: candidateShaclRevision.suiteCommit,
    implementationCommit: state.implementationCommit,
    runId: oracleRunId,
    cases: state.observed,
  });
  state.lane.stdoutArtifact = oracleWriteArtifact(
    root,
    runDirectory,
    "jena-compact.stdout.log",
    state.raw,
    true,
  );
  state.lane.stderrArtifact = oracleWriteArtifact(
    root,
    runDirectory,
    "jena-compact.stderr.log",
    "",
    true,
  );
  const receipt = {
    schema: "oxigraph.shacl-candidate-run/v1",
    kind: "jena-compact",
    suiteCommit: candidateShaclRevision.suiteCommit,
    implementationCommit: state.implementationCommit,
    runId: oracleRunId,
    inventoryArtifact,
    casesArtifact,
    lanes: { jenaCompact: state.lane },
    aggregateCounts: state.aggregateCounts,
    sourceBefore: { commit: state.implementationCommit, branch: "main", status: "" },
    sourceAfter: { commit: state.implementationCommit, branch: "main", status: "" },
    complete: true,
    errors: [],
    completeConformance: false,
    qualified: false,
    promoted: false,
  };
  if (state.mutateReceipt) state.mutateReceipt(receipt);
  const receiptRef = oracleWriteArtifact(
    root,
    runDirectory,
    "receipt.json",
    receipt,
  );
  return { ...state, receipt, receiptRef, inventoryArtifact, casesArtifact };
}

function oracleErrors(fixture, expectedImplementationCommit = oracleImplementation) {
  return verifyShaclCandidateArtifacts(fixture.root, {
    receiptRef: fixture.receiptRef,
    expectedImplementationCommit,
  });
}

test("candidate producer imports are inert", () => {
  const cwd = mkdtempSync(resolve(tmpdir(), "oxigraph-import-oracle-"));
  try {
    const modules = [
      "tools/shacl-tests/inventory.mjs",
      "tools/shacl-tests/run.mjs",
      "tools/shacl-tests/jena-compact.mjs",
      "tools/evidence/verify-programme.mjs",
    ].map((path) => pathToFileURL(resolve(oracleRepositoryRoot, path)).href);
    const script = `await Promise.all(${JSON.stringify(modules)}.map((value) => import(value)));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(readdirSync(cwd), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("candidate source entrypoints retain strict authenticated inventory collection", () => {
  const sourcePaths = [
    "tools/shacl-tests/inventory.mjs",
    "tools/shacl-tests/run.mjs",
    "tools/shacl-tests/jena-compact.mjs",
  ];
  const sources = Object.fromEntries(
    sourcePaths.map((path) => [
      path,
      readFileSync(resolve(oracleRepositoryRoot, path), "utf8"),
    ]),
  );
  const forbidden = ["adr0046", "repin", "research"].join("-");
  for (const source of Object.values(sources)) {
    assert.equal(source.includes(forbidden), false);
  }
  for (const path of sourcePaths.slice(1)) {
    assert.match(sources[path], /\bcollectCandidateInventory\s*\(/u);
    assert.doesNotMatch(sources[path], /\bcollectCandidateInventoryContents\b/u);
  }
  assert.match(
    sources["tools/shacl-tests/inventory.mjs"],
    /export function collectCandidateInventory\([\s\S]*?assertGitIdentity\([\s\S]*?collectCandidateInventoryContents\(/u,
  );
  assert.match(
    sources["tools/shacl-tests/run.mjs"],
    /export function executeCandidateChild\([\s\S]*?authenticateCheckout\s*=\s*verifyCandidateCheckout[\s\S]*?executeChild\([\s\S]*?authenticateCheckout\(checkout, targetRoot\)/u,
  );
  assert.match(
    sources["tools/shacl-tests/run.mjs"],
    /executeCandidateChild\(\{[\s\S]*?program:\s*"cargo"[\s\S]*?checkout,[\s\S]*?targetRoot/u,
  );
  assert.match(
    sources["tools/shacl-tests/jena-compact.mjs"],
    /import\s*\{[\s\S]*?executeCandidateChild[\s\S]*?\}\s*from\s*"\.\/run\.mjs"/u,
  );
  assert.match(
    sources["tools/shacl-tests/jena-compact.mjs"],
    /executeCandidateChild\(\{[\s\S]*?program:\s*"mvn"[\s\S]*?checkout,[\s\S]*?targetRoot/u,
  );
});

test("candidate child execution reauthenticates Run and Jena checkouts", () => {
  const scenarios = [
    { program: "cargo", args: ["run", "--locked"], stdout: "run output\n" },
    { program: "mvn", args: ["-q", "compile"], stdout: "jena output\n" },
  ];
  for (const scenario of scenarios) {
    const targetRoot = mkdtempSync(resolve(tmpdir(), `oxigraph-${scenario.program}-reauth-`));
    const checkout = resolve(
      targetRoot,
      `data-shapes-${candidateShaclRevision.suiteCommit.slice(0, 12)}`,
    );
    mkdirSync(checkout);
    try {
      const events = [];
      const expectedExecution = {
        status: 0,
        signal: null,
        error: null,
        stdout: scenario.stdout,
        stderr: "",
      };
      const result = executeCandidateChild({
        cwd: oracleRepositoryRoot,
        program: scenario.program,
        args: scenario.args,
        checkout,
        targetRoot,
        executeChild(cwd, program, args) {
          events.push("child");
          assert.equal(cwd, oracleRepositoryRoot);
          assert.equal(program, scenario.program);
          assert.deepEqual(args, scenario.args);
          writeFileSync(resolve(checkout, "post-child-mutation.txt"), "mutated\n");
          return expectedExecution;
        },
        authenticateCheckout(candidate, parent) {
          events.push("authenticate");
          assert.equal(candidate, checkout);
          assert.equal(parent, targetRoot);
          assert.equal(
            readFileSync(resolve(checkout, "post-child-mutation.txt"), "utf8"),
            "mutated\n",
          );
          throw new Error("candidate checkout is not the exact clean pinned revision");
        },
      });
      assert.deepEqual(events, ["child", "authenticate"]);
      assert.deepEqual(result.execution, expectedExecution);
      assert.match(
        result.checkoutAuthenticationError,
        /candidate checkout is not the exact clean pinned revision/u,
      );
      assert.equal(result.execution.stdout, scenario.stdout);
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  }
});

test("candidate strict wrapper rejects unauthenticated, wrong-revision, and dirty checkouts", () => {
  const unauthenticated = mkdtempSync(resolve(tmpdir(), "oxigraph-candidate-unauthenticated-"));
  const wrongRevision = mkdtempSync(resolve(tmpdir(), "oxigraph-candidate-wrong-revision-"));
  const dirtyCandidate = mkdtempSync(resolve(tmpdir(), "oxigraph-candidate-dirty-"));
  try {
    assert.throws(
      () =>
        collectCandidateInventory({
          checkout: unauthenticated,
          implementation: oracleImplementation,
        }),
      (error) =>
        /not a git repository|rev-parse/u.test(
          `${error?.message ?? ""}\n${error?.stderr ?? ""}`,
        ),
    );

    oracleGit(wrongRevision, ["init", "-b", "main"]);
    oracleGit(wrongRevision, ["config", "user.name", "Oxigraph Oracle"]);
    oracleGit(wrongRevision, ["config", "user.email", "oracle@example.invalid"]);
    writeFileSync(resolve(wrongRevision, "source.txt"), "wrong revision\n");
    oracleGit(wrongRevision, ["add", "source.txt"]);
    oracleGit(wrongRevision, ["commit", "-m", "test: wrong candidate revision"]);
    assert.throws(
      () =>
        collectCandidateInventory({
          checkout: wrongRevision,
          implementation: oracleImplementation,
        }),
      /candidate checkout commit mismatch/u,
    );

    oracleInstallCandidateGitIdentity(dirtyCandidate);
    assert.notEqual(
      oracleGit(dirtyCandidate, ["status", "--porcelain=v1", "--untracked-files=all"]),
      "",
    );
    assert.throws(
      () =>
        collectCandidateInventory({
          checkout: dirtyCandidate,
          implementation: oracleImplementation,
        }),
      /candidate checkout is not clean/u,
    );
  } finally {
    for (const path of [unauthenticated, wrongRevision, dirtyCandidate]) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

test("candidate inventory extraction matches the independent complete projection", () => {
  const inventory = oracleInventory();
  const errors = [];
  validateCandidateShaclInventory(inventory, errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(inventory.integrity.declarationProjection, {
    rows: 569,
    bytes: 235376,
    sha256: "25730098efb04ac9be0f853439843b7874784428ae712a73cc0d05bdcbc1909a",
  });

  const drift = structuredClone(inventory);
  drift.lanes.inferenceRules.find((item) => item.declaration === "unsupported").sources[0].sha256 =
    "0".repeat(64);
  const driftErrors = [];
  validateCandidateShaclInventory(drift, driftErrors);
  assert(driftErrors.some((error) => error.startsWith("candidate declaration projection:")));
  assert(driftErrors.some((error) => error.startsWith("candidate unsupported identities:")));
});

test("candidate run writes are unique, exclusive, and identity-bound", () => {
  const repository = mkdtempSync(resolve(tmpdir(), "oxigraph-run-writer-oracle-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-b", "main");
  git("config", "user.name", "Oxigraph Oracle");
  git("config", "user.email", "oracle@example.invalid");
  writeFileSync(resolve(repository, ".gitignore"), "target/\n");
  writeFileSync(resolve(repository, "source.txt"), "fixed source\n");
  git("add", ".gitignore", "source.txt");
  git("commit", "-m", "test: fixed source");
  const head = git("rev-parse", "HEAD");
  const first = createCandidateRun({
    repositoryRoot: repository,
    implementation: head,
    kind: "rust-suite",
  });
  const second = createCandidateRun({
    repositoryRoot: repository,
    implementation: head,
    kind: "rust-suite",
  });
  try {
    assert.notEqual(first.path, second.path);
    const ref = writeCandidateArtifact({
      repositoryRoot: repository,
      run: first,
      name: "inventory.json",
      value: { fixed: true },
    });
    assert.equal(ref.path, `${first.path}/inventory.json`);
    assert.throws(
      () =>
        writeCandidateArtifact({
          repositoryRoot: repository,
          run: first,
          name: "inventory.json",
          value: { replaced: true },
        }),
      /EEXIST|exist/u,
    );
    assert.throws(
      () =>
        writeCandidateArtifact({
          repositoryRoot: repository,
          run: { ...first, path: second.path },
          name: "wrong.json",
          value: {},
        }),
      /immutable identity/u,
    );
    assert.throws(
      () =>
        writeCandidateArtifact({
          repositoryRoot: repository,
          run: { ...first, implementationCommit: "0".repeat(40) },
          name: "wrong.json",
          value: {},
        }),
      /commit/u,
    );
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("candidate receipt joins exact cases and raw logs while preserving historical evidence", () => {
  const fixture = oracleCandidateFixture();
  try {
    assert.deepEqual(oracleErrors(fixture), { ok: true, errors: [] });
    assert.equal(fixture.receipt.lanes.sparqlRulesInfer.status.code, 2);
    assert.deepEqual(fixture.receipt.aggregateCounts, {
      discovered: 569,
      eligible: 567,
      passed: 560,
      unsupported: 7,
      failed: 0,
      excluded: 2,
    });
    assert.equal(ledgerFixture().evidence.find((item) => item.id === "E-SHACL12-RUN").result.aggregate.discovered, 521);
    assert.equal(expectedPins["w3c-data-shapes"], "eedda09f93c39be1d2e978f3f942631494ae25a0");
    assert.equal(candidateShaclRevision.suiteCommit, expectedCandidateShacl.revision.suiteCommit);
    assert.notEqual(candidateShaclRevision.suiteCommit, expectedPins["w3c-data-shapes"]);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("candidate verifier rejects source, path, and immutable-byte disagreement", () => {
  const source = oracleCandidateFixture((state) => {
    state.implementationCommit = "2".repeat(40);
    state.inventory.source.implementationCommit = state.implementationCommit;
  });
  const path = oracleCandidateFixture((state) => {
    state.mutateReceipt = (receipt) => {
      receipt.inventoryArtifact.path = receipt.inventoryArtifact.path.replace("/inventory.json", "/nested/inventory.json");
    };
  });
  const bytes = oracleCandidateFixture();
  try {
    assert.equal(oracleErrors(source).ok, false);
    assert(oracleErrors(source).errors.some((error) => error.includes("differs from the expected source")));
    assert.equal(oracleErrors(path).ok, false);
    assert(oracleErrors(path).errors.some((error) => error.includes("direct child")));
    const artifactPath = resolve(bytes.root, bytes.inventoryArtifact.path);
    const tampered = readFileSync(artifactPath);
    tampered[0] ^= 1;
    writeFileSync(artifactPath, tampered);
    const receiptMtimeMs = statSync(
      resolve(bytes.root, bytes.receiptRef.path),
    ).mtimeMs;
    const beforeReceipt = new Date(receiptMtimeMs - 1_000);
    utimesSync(artifactPath, beforeReceipt, beforeReceipt);
    assert.equal(oracleErrors(bytes).ok, false);
    const byteErrors = oracleErrors(bytes).errors;
    assert(
      byteErrors.includes(
        "candidate inventory artifact: candidate inventory artifact SHA-256 does not match its ref",
      ),
    );
    assert.equal(
      byteErrors.some((error) => error.includes("newer than its receipt")),
      false,
    );
  } finally {
    for (const fixture of [source, path, bytes]) rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("candidate verifier rejects case joins, raw logs, and selected-as-unsupported relabelling", () => {
  const joined = oracleCandidateFixture((state) => {
    state.observed[0].testId = "wrong-case";
  });
  const raw = oracleCandidateFixture((state) => {
    state.raw.validate = state.raw.validate.replace(/^PASS\t/u, "FAIL\t");
  });
  const relabelled = oracleCandidateFixture((state) => {
    const selected = state.observed.find((item) => item.declaration === "selected");
    selected.kind = "UNSUPPORTED";
    selected.detail = "invented-after-execution";
    state.aggregateCounts = oracleCounts(state.observed);
  });
  try {
    const joinedResult = oracleErrors(joined);
    assert.equal(joinedResult.ok, false);
    assert(joinedResult.errors.some((error) => error.includes("test ID")));
    const rawResult = oracleErrors(raw);
    assert.equal(rawResult.ok, false);
    assert(rawResult.errors.some((error) => error.includes("raw FAIL count")));
    const relabelledResult = oracleErrors(relabelled);
    assert.equal(relabelledResult.ok, false);
    assert(relabelledResult.errors.some((error) => error.includes("outcome")));
  } finally {
    for (const fixture of [joined, raw, relabelled]) rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("candidate verifier binds unsupported detail to the exact frozen requirement", () => {
  const mismatches = [
    "invented-unsupported-reason",
    "requires-rdf-sh:TripleRule-compilation ",
    "requires-rdf-sh:triplerule-compilation",
  ];
  const fixtures = mismatches.map((detail) =>
    oracleCandidateFixture((state) => {
      const unsupported = state.observed.find(
        (item) =>
          item.detail === "requires-rdf-sh:TripleRule-compilation",
      );
      const frozen = unsupported.detail;
      unsupported.detail = detail;
      state.raw.sparqlRulesInfer = state.raw.sparqlRulesInfer.replace(
        `\t${unsupported.testId}\t${frozen}\n`,
        `\t${unsupported.testId}\t${unsupported.detail}\n`,
      );
    }),
  );
  try {
    for (const fixture of fixtures) {
      const result = oracleErrors(fixture);
      assert.equal(result.ok, false);
      assert.deepEqual(
        result.errors.filter((error) => error.includes("unsupported detail")),
        [
          expectErrorPrefix(
            result.errors,
            "candidate observed case[",
            "unsupported detail",
          ),
        ],
      );
      assert.equal(
        result.errors.some((error) => error.includes("raw/joined cases")),
        false,
        "the negative must isolate the exact requirement literal",
      );
    }
  } finally {
    for (const fixture of fixtures) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("candidate verifier binds observed requiredCapability independently of raw detail", () => {
  const fixture = oracleCandidateFixture((state) => {
    const unsupported = state.observed.find(
      (item) => item.detail === "requires-rdf-sh:TripleRule-compilation",
    );
    assert.equal(unsupported.requiredCapability, unsupported.detail);
    unsupported.requiredCapability = `${unsupported.requiredCapability} `;
  });
  try {
    const result = oracleErrors(fixture);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.errors.filter((error) => error.includes("requiredCapability")),
      [
        expectErrorPrefix(
          result.errors,
          "candidate observed case[",
          "requiredCapability",
        ),
      ],
    );
    assert.equal(
      result.errors.some((error) => error.includes("unsupported detail")),
      false,
      "the negative must leave the raw unsupported detail unchanged",
    );
    assert.equal(
      result.errors.some((error) => error.includes("raw/joined cases")),
      false,
      "the negative must isolate the observed requiredCapability field",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function expectErrorPrefix(errors, prefix, contains) {
  const matches = errors.filter(
    (error) => error.startsWith(prefix) && error.includes(contains),
  );
  assert.equal(matches.length, 1, JSON.stringify(errors));
  return matches[0];
}

test("candidate Jena receipt validates without executing Maven", () => {
  const fixture = oracleJenaFixture();
  try {
    assert.deepEqual(oracleErrors(fixture), { ok: true, errors: [] });
    assert.equal(fixture.receipt.kind, "jena-compact");
    assert.deepEqual(fixture.receipt.aggregateCounts, {
      discovered: 32,
      eligible: 32,
      passed: 32,
      unsupported: 0,
      failed: 0,
      excluded: 0,
    });
    assert.deepEqual(Object.keys(fixture.receipt.lanes), ["jenaCompact"]);
    assert.equal(fixture.receipt.lanes.jenaCompact.command.program, "mvn");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("candidate Jena verifier rejects command, ref, and count disagreement", () => {
  const command = oracleJenaFixture((state) => {
    state.lane.command.args[0] = "--quiet";
  });
  const ref = oracleJenaFixture((state) => {
    state.mutateReceipt = (receipt) => {
      receipt.lanes.jenaCompact.stdoutArtifact.path =
        `${state.runDirectory}/nested/jena-compact.stdout.log`;
    };
  });
  const count = oracleJenaFixture((state) => {
    state.mutateReceipt = (receipt) => {
      receipt.lanes.jenaCompact.counts = {
        ...receipt.lanes.jenaCompact.counts,
        discovered: 31,
      };
    };
  });
  try {
    const commandResult = oracleErrors(command);
    assert.equal(commandResult.ok, false);
    assert(
      commandResult.errors.some((error) =>
        error.startsWith("candidate lane jenaCompact command arguments:"),
      ),
    );
    const refResult = oracleErrors(ref);
    assert.equal(refResult.ok, false);
    assert(refResult.errors.some((error) => error.includes("direct child")));
    const countResult = oracleErrors(count);
    assert.equal(countResult.ok, false);
    assert(
      countResult.errors.some((error) =>
        error.startsWith("candidate lane jenaCompact exact counts:"),
      ),
    );
    assert(
      countResult.errors.some((error) =>
        error.startsWith("candidate lane jenaCompact raw/receipt counts:"),
      ),
    );
  } finally {
    for (const fixture of [command, ref, count]) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("six-field parsing enforces exit-disposition evidence", () => {
  const definition = {
    name: "inference",
    expected: {
      discovered: 2,
      eligible: 2,
      passed: 1,
      unsupported: 1,
      failed: 0,
      excluded: 0,
    },
  };
  const valid = [
    "PASS\tselected.ttl\tselected\t",
    "UNSUPPORTED\tunsupported.ttl\tunsupported\trequires-sh:runOnce",
    "SUMMARY discovered=2 eligible=2 passed=1 unsupported=1 failed=0 excluded=0",
    "",
  ].join("\n");
  assert.deepEqual(parseEvidence(definition, valid).counts, definition.expected);
  assert.throws(
    () => parseEvidence(definition, valid.replace("unsupported=1", "unsupported=0")),
    /conservation|UNSUPPORTED/u,
  );
  assert.throws(
    () => parseEvidence(definition, valid.replace("UNSUPPORTED", "PASS")),
    /PASS case lines|UNSUPPORTED case lines/u,
  );
});
let oracleE3ModulesPromise;
function oracleE3Modules() {
  oracleE3ModulesPromise ??= Promise.all([
    import("./policy.mjs"),
    import("../shacl-tests/clause-audit.mjs"),
    import("../shacl-tests/shacl-requirements.mjs"),
    import("../shacl-tests/clause-reviews.mjs"),
  ]).then(([policy, audit, requirements, reviews]) => ({
    policy,
    audit,
    requirements,
    reviews,
  }));
  return oracleE3ModulesPromise;
}
function oracleRequirementLedger() {
  return JSON.parse(
    readFileSync(
      resolve(
        oracleRepositoryRoot,
        "docs/research/normative-requirements.json",
      ),
      "utf8",
    ),
  ).requirements;
}
function oracleCandidateClauseSources(checkout, revision) {
  return {
    documentSources: Object.fromEntries(
      Object.entries(revision.documents).map(([name, source]) => [
        name,
        readFileSync(resolve(checkout, source.path)),
      ]),
    ),
    grammarSources: Object.fromEntries(
      Object.entries(revision.grammars).map(([name, source]) => [
        name,
        readFileSync(resolve(checkout, source.path)),
      ]),
    ),
  };
}
async function oracleCollectCandidateClauseAudit({
  inventoryArtifact,
  mutateInputs = () => {},
} = {}) {
  const modules = await oracleE3Modules();
  const checkout = mkdtempSync(resolve(tmpdir(), "oxigraph-clause-corpus-"));
  try {
    oracleMaterializeCandidateCorpus(checkout);
    const inventory = oracleInventory();
    const sources = oracleCandidateClauseSources(
      checkout,
      modules.requirements.candidateClauseMappingRevision,
    );
    const inputs = {
      ...sources,
      inventory,
      inventoryArtifact: inventoryArtifact ?? {
        path: `target/w3c/shacl-1.2/revisions/${candidateShaclRevision.suiteCommit}/${oracleImplementation}/${oracleRunId}/inventory.json`,
        sha256: "2".repeat(64),
        bytes: 1,
      },
      implementation: oracleImplementation,
      runId: oracleRunId,
      requirementLedger: oracleRequirementLedger(),
      mappingRevision: structuredClone(
        modules.requirements.candidateClauseMappingRevision,
      ),
      requirementMappings: structuredClone(
        modules.requirements.candidateShaclRequirementMappings,
      ),
      obligations: structuredClone(
        modules.reviews.candidateReviewedObligations,
      ),
      residuals: structuredClone(modules.reviews.candidateResidualClaims),
      definitions: structuredClone(
        modules.audit.candidateClauseAuditDefinitions,
      ),
    };
    mutateInputs(inputs);
    const audit = modules.audit.collectCandidateClauseAuditContents(inputs);
    return { audit, inventory, inputs, modules };
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
}
async function oracleClauseAuditFixture({
  mutateAudit = () => {},
  mutateReceipt = () => {},
} = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "oxigraph-clause-audit-oracle-"));
  const runDirectory = [
    "target/w3c/shacl-1.2/revisions",
    candidateShaclRevision.suiteCommit,
    oracleImplementation,
    oracleRunId,
  ].join("/");
  const checkout = resolve(
    root,
    `target/w3c/shacl-1.2/data-shapes-${candidateShaclRevision.suiteCommit.slice(0, 12)}`,
  );
  mkdirSync(checkout, { recursive: true });
  oracleMaterializeCandidateCorpus(checkout);
  oracleInstallCandidateGitIdentity(checkout);
  oracleGit(checkout, ["reset", "--mixed", "HEAD"]);
  oracleSkipAbsentCandidatePaths(checkout);
  const inventory = oracleInventory();
  const inventoryArtifact = oracleWriteArtifact(
    root,
    runDirectory,
    "inventory.json",
    inventory,
  );
  try {
    const collected = await oracleCollectCandidateClauseAudit({
      inventoryArtifact,
    });
    const audit = collected.audit;
    mutateAudit(audit);
    const auditArtifact = oracleWriteArtifact(
      root,
      runDirectory,
      "clause-obligations.json",
      audit,
    );
    const receipt = {
      schema: "oxigraph.shacl-candidate-run/v1",
      kind: "clause-audit",
      suiteCommit: candidateShaclRevision.suiteCommit,
      implementationCommit: oracleImplementation,
      runId: oracleRunId,
      inventoryArtifact,
      auditArtifact,
      sourceBefore: {
        commit: oracleImplementation,
        branch: "main",
        status: "",
      },
      sourceAfter: { commit: oracleImplementation, branch: "main", status: "" },
      complete: true,
      errors: [],
      completeConformance: false,
      qualified: false,
      promoted: false,
    };
    mutateReceipt(receipt);
    const receiptRef = oracleWriteArtifact(
      root,
      runDirectory,
      "receipt.json",
      receipt,
    );
    return {
      root,
      runDirectory,
      inventory,
      inventoryArtifact,
      audit,
      auditArtifact,
      receipt,
      receiptRef,
      modules: collected.modules,
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
function oracleCandidateClausePolicyErrors(fixture) {
  const errors = [];
  fixture.modules.policy.validateCandidateShaclEvidence(
    {
      receipt: fixture.receipt,
      inventory: fixture.inventory,
      audit: fixture.audit,
      runDirectory: fixture.runDirectory,
    },
    errors,
  );
  return errors;
}
function oracleNormalizedHtml(value) {
  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}
const oracleAcceptedSliceEvidence = {
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
};
test("E3 binds exact accepted D and N evidence identities", async () => {
  const { requirements, reviews } = await oracleE3Modules();
  assert.deepEqual(
    requirements.candidateClauseMappingRevision.acceptedSliceEvidence,
    oracleAcceptedSliceEvidence,
  );
  assert.deepEqual(
    requirements.candidateClauseMappingRevision.requiredBeforeAdoption,
    [],
  );
  assert(
    [
      ...requirements.candidateShaclRequirementMappings,
      ...reviews.candidateReviewedObligations,
    ].every(({ implementationStatus }) =>
      !implementationStatus.includes("pending-n"),
    ),
  );
});
test("E3 binds complete prose, table clauses, and occurrence identity", async () => {
  const { audit } = await oracleE3Modules();
  const html = `<section id="outer"><h2>Outer</h2><p>Algorithm prose without keywords.</p><section id="inner"><table><tr><td>A processor MUST preserve this cell.</td></tr></table><p>Repeated text SHOULD remain.</p><p>Repeated text SHOULD remain.</p></section><p>Trailing section prose.</p></section><section id="other"><p>Repeated text SHOULD remain.</p></section><div id="algorithm"><span>Compute all reachable values.</span></div>`;
  const definition = {
    path: "synthetic.html",
    sha256: oracleSha256(Buffer.from(html)),
    applicability: "synthetic",
    defaultStatus: "raw-candidate-unreviewed",
  };
  const clauses = audit.extractBcp14Clauses("synthetic", html, definition);
  assert.equal(clauses.length, 3);
  const tableClause = clauses.find(({ keywords }) => keywords.includes("MUST"));
  assert(tableClause);
  const changedTableClauses = audit.extractBcp14Clauses(
    "synthetic",
    html.replace("preserve this cell", "reject this mutated cell"),
    { ...definition, sha256: "2".repeat(64) },
  );
  assert.notEqual(
    changedTableClauses.find(({ keywords }) => keywords.includes("MUST")).textSha256,
    tableClause.textSha256,
  );
  const repeated = clauses.filter(({ keywords }) => keywords.includes("SHOULD"));
  assert.deepEqual(repeated.map(({ section }) => section).sort(), ["inner", "other"]);
  const facets = [{
    id: "synthetic-prose",
    document: "synthetic",
    anchors: ["outer", "algorithm"],
    sourceStatus: "source-reviewed",
  }];
  const records = audit.extractAnchorRecords(
    "synthetic",
    html,
    definition,
    facets,
  );
  const outer = records.find(({ anchor }) => anchor === "outer");
  assert.equal(
    outer.textSha256,
    oracleSha256(Buffer.from(oracleNormalizedHtml(html.match(/<section id="outer">([\s\S]*)<\/section><section id="other">/u)[1]))),
  );
  const changed = audit.extractAnchorRecords(
    "synthetic",
    html.replace("Trailing section prose.", "Mutated trailing section prose."),
    { ...definition, sha256: "1".repeat(64) },
    facets,
  );
  assert.notEqual(changed.find(({ anchor }) => anchor === "outer").textSha256, outer.textSha256);
  const algorithm = records.find(({ anchor }) => anchor === "algorithm");
  assert.equal(algorithm.keywords.length, 0);
  assert.equal(
    algorithm.textSha256,
    oracleSha256(Buffer.from("Compute all reachable values.")),
  );
  const changedAlgorithm = audit.extractAnchorRecords(
    "synthetic",
    html.replace("Compute all reachable values.", "Compute only direct values."),
    { ...definition, sha256: "3".repeat(64) },
    facets,
  );
  assert.notEqual(
    changedAlgorithm.find(({ anchor }) => anchor === "algorithm").textSha256,
    algorithm.textSha256,
  );
});

test("E3 joins only exact contained clauses in stable facet order", async () => {
  const { audit } = await oracleE3Modules();
  const facets = [{
    id: "facet",
    document: "synthetic",
    path: "synthetic.html",
    sha256: "1".repeat(64),
    anchors: ["outer", "inner", "algorithm"],
    sourceStatus: "source-reviewed",
  }];
  const clauseCandidates = [
    ...facets[0].anchors.map((anchor) => ({ id: `facet:facet:${anchor}` })),
    ...["outer", "inner", "unjoined"].map((name) => ({ id: `bcp14:${name}` })),
  ];
  const joins = audit.joinCandidateObligations({
    obligations: [{
      id: "obligation",
      mappingId: "mapping",
      sourceFacetIds: ["facet"],
      sourceStatus: "source-reviewed",
      implementationStatus: "ordinary-tested-subset",
      candidateExecutionStatus: "unexecuted",
    }],
    requirementMappings: [{ id: "mapping", sourceFacets: facets }],
    sourceFacets: facets,
    clauseCandidates,
    syntaxRules: [],
    grammarProductions: [],
    documentIndexes: new Map([["synthetic", {
      elementsById: new Map([
        ["outer", [{ start: 0, end: 100 }]],
        ["inner", [{ start: 20, end: 60 }]],
        ["algorithm", [{ start: 110, end: 140 }]],
      ]),
      bcp14Occurrences: new Map([
        ["bcp14:outer", [{ start: 5, end: 15 }]],
        ["bcp14:inner", [{ start: 30, end: 40 }, { start: 45, end: 55 }]],
        ["bcp14:unjoined", [{ start: 150, end: 160 }]],
      ]),
    }]]),
  });
  assert.deepEqual(joins[0].clauseCandidateIds, [
    "facet:facet:outer",
    "bcp14:outer",
    "bcp14:inner",
    "facet:facet:inner",
    "facet:facet:algorithm",
  ]);
  assert.equal(joins[0].clauseCandidateIds.includes("bcp14:unjoined"), false);
});
test("E3 freezes sources and historical separation", async () => {
  const { policy, requirements, reviews } = await oracleE3Modules();
  const revision = requirements.candidateClauseMappingRevision;
  assert.equal(
    oracleSha256(Buffer.from(JSON.stringify(revision))),
    "a83a2b9e511ea7c63934acb1e30d55f4967d50cf0b921c88b2317c391348639d",
  );
  assert.equal(
    oracleSha256(Buffer.from(JSON.stringify(requirements.candidateShaclRequirementMappings))),
    "c440145383354ad5b3b6a1655ae1fe423ac755b3f3d6fd79c43415eca62c8829",
  );
  assert.equal(
    oracleSha256(Buffer.from(JSON.stringify(reviews.candidateReviewedObligations))),
    "20b00a0d637257d16a13e0cb480ed79b86933fb3f30e2caa32f074abef8ca521",
  );
  assert.equal(
    oracleSha256(Buffer.from(JSON.stringify(reviews.candidateResidualClaims))),
    "46f21e8957852eb7ba03e9611a28477d6f6933bc3d6fe5f31dc4f4828cfe7b92",
  );
  assert.equal(
    oracleSha256(Buffer.from(JSON.stringify(revision.documents))),
    "5656b225a91bb7c4e5485071a7fb3f63bc568b924f58dd77344a865bcb8a065d",
  );
  assert.equal(
    oracleSha256(Buffer.from(JSON.stringify(revision.grammars))),
    "c6928ecc4bdd4c7d24dacd96c647f722d2737a058c100a1788964e84c0fc68bb",
  );
  assert.deepEqual(revision.retiredHistoricalRules, {
    path: "shacl12-rules/index.html",
    sha256: "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
    state: "deleted-at-candidate",
  });
  assert.deepEqual(revision.requiredBeforeAdoption, []);
  assert.equal(requirements.candidateShaclRequirementMappings.length, 25);
  assert.equal(
    requirements.candidateShaclRequirementMappings.flatMap(
      ({ sourceFacets }) => sourceFacets,
    ).length,
    42,
  );
  assert.equal(reviews.candidateReviewedObligations.length, 38);
  assert.equal(reviews.candidateResidualClaims.length, 14);
  assert(
    requirements.candidateShaclRequirementMappings.every(
      ({ candidateExecutionStatus }) =>
        candidateExecutionStatus === "unexecuted",
    ),
  );
  assert(
    reviews.candidateReviewedObligations.every(
      ({ candidateExecutionStatus }) =>
        candidateExecutionStatus === "unexecuted",
    ),
  );
  assert.equal(
    expectedPins["w3c-data-shapes"],
    "eedda09f93c39be1d2e978f3f942631494ae25a0",
  );
  assert.notEqual(expectedPins["w3c-data-shapes"], revision.suiteCommit);
  assert.deepEqual(
    policy.expectedCandidateClauseAudit.mappingRevision,
    revision,
  );
});

test("E3 retains ambiguity and unsupported surfaces", async () => {
  const { requirements, reviews } = await oracleE3Modules();
  const revision = requirements.candidateClauseMappingRevision;
  const ambiguity = reviews.candidateReviewedObligations.find(
    ({ id }) => id === "rules-srl-data-source-interpretation",
  );
  assert.equal(ambiguity.level, "AMBIGUOUS-SOURCE");
  assert.equal(
    ambiguity.sourceStatus,
    "source-reviewed-with-explicit-ambiguity",
  );
  assert.match(ambiguity.residual, /base-plus-inline DATA/u);
  assert.match(ambiguity.residual, /literal G0/u);
  assert.match(ambiguity.residual, /upstream intent unresolved/u);
  const unsupported = reviews.candidateReviewedObligations.find(
    ({ id }) => id === "rules-run-once-and-temporary-triples",
  );
  assert.equal(unsupported.implementationStatus, "unsupported");
  assert.match(unsupported.residual, /sh:runOnce/u);
  assert.match(unsupported.residual, /sh:tempTriple/u);
  const rdfBoundary = reviews.candidateReviewedObligations.find(
    ({ id }) => id === "rules-rdf-syntax-boundaries",
  );
  assert.equal(rdfBoundary.implementationStatus, "explicit-unsupported-subset");
  assert.match(rdfBoundary.residual, /sh:TripleRule/u);
  assert.match(rdfBoundary.residual, /sh:SPARQLRuleTemplate/u);
  const historicalProductions = readFileSync(
    resolve(
      oracleRepositoryRoot,
      "lib/oxshacl/tests/fixtures/srl_clause_productions.tsv",
    ),
    "utf8",
  );
  assert.match(historicalProductions, /^# W3C data-shapes commit: eedda09f/mu);
  assert.match(historicalProductions, /^156\tPN_LOCAL_ESC\t/mu);
  assert.equal(revision.candidateInventories.sparqlRlGrammarProductions, 153);
});

test("E3 audit binds anchors, rules, grammar, and joins", async () => {
  const { audit } = await oracleCollectCandidateClauseAudit();
  assert.equal(audit.schema, "oxigraph.shacl-candidate-clause-audit/v1");
  assert.deepEqual(audit.source, {
    repository: "https://github.com/w3c/data-shapes.git",
    suiteCommit: candidateShaclRevision.suiteCommit,
    implementationCommit: oracleImplementation,
    immutable: true,
  });
  assert.deepEqual(
    Object.keys(audit.documents),
    Object.keys(audit.mappingRevision.documents),
  );
  for (const [name, identity] of Object.entries(
    audit.mappingRevision.documents,
  )) {
    assert.deepEqual(
      {
        path: audit.documents[name].path,
        sha256: audit.documents[name].sha256,
      },
      identity,
    );
  }
  assert.deepEqual(
    Object.fromEntries(
      ["core", "nodeExpressions", "sparql", "inferenceRules"].map((name) => [
        name,
        audit.syntaxRules.filter(({ document }) => document === name).length,
      ]),
    ),
    { core: 113, nodeExpressions: 35, sparql: 46, inferenceRules: 25 },
  );
  assert.equal(audit.grammarProductions.length, 153);
  assert.deepEqual(
    audit.grammarProductions.map(({ number }) => number),
    Array.from({ length: 153 }, (_, index) => index + 1),
  );
  assert.equal(audit.sourceFacets.length, 42);
  assert.equal(audit.rawObligationJoins.length, 38);
  const clauseIds = new Set(audit.clauseCandidates.map(({ id }) => id));
  const syntaxIds = new Set(audit.syntaxRules.map(({ id }) => id));
  const grammarIds = new Set(audit.grammarProductions.map(({ id }) => id));
  for (const join of audit.rawObligationJoins) {
    assert.equal(join.candidateExecutionStatus, "unexecuted");
    assert(
      join.clauseCandidateIds.length +
        join.syntaxRuleIds.length +
        join.grammarProductionIds.length >
        0,
    );
    for (const id of join.clauseCandidateIds) assert(clauseIds.has(id), id);
    for (const id of join.syntaxRuleIds) assert(syntaxIds.has(id), id);
    for (const id of join.grammarProductionIds) assert(grammarIds.has(id), id);
  }
  const joinedClauseIds = new Set(
    audit.rawObligationJoins.flatMap(({ clauseCandidateIds }) => clauseCandidateIds),
  );
  const unjoinedRawClauses = audit.clauseCandidates.filter(
    ({ id, kind }) => kind === "bcp14" && !joinedClauseIds.has(id),
  );
  assert(unjoinedRawClauses.length > 0);
  assert(
    unjoinedRawClauses.every(
      ({ status }) => status === "raw-candidate-unreviewed",
    ),
  );
  for (const facet of audit.sourceFacets) {
    const identity = audit.mappingRevision.documents[facet.document];
    assert.deepEqual({ path: facet.path, sha256: facet.sha256 }, identity);
    for (const anchor of facet.anchors) {
      assert(
        audit.clauseCandidates.some(
          (candidate) =>
            candidate.kind === "source-facet" &&
            candidate.facetId === facet.id &&
            candidate.anchor === anchor &&
            candidate.document === facet.document,
        ),
        `${facet.id}#${anchor}`,
      );
    }
  }
  assert.equal(audit.completeConformance, false);
  assert.equal(audit.qualified, false);
  assert.equal(audit.promoted, false);
});

test("E3 collector rejects source and grammar drift", async () => {
  await assert.rejects(
    oracleCollectCandidateClauseAudit({
      mutateInputs: (inputs) => {
        inputs.documentSources.core = Buffer.concat([
          inputs.documentSources.core,
          Buffer.from("\n", "utf8"),
        ]);
      },
    }),
    /core document SHA-256/u,
  );
  await assert.rejects(
    oracleCollectCandidateClauseAudit({
      mutateInputs: (inputs) => {
        inputs.grammarSources.sparqlRl[0] ^= 1;
      },
    }),
    /sparqlRl grammar SHA-256/u,
  );
});

test("E3 rejects missing and swapped contained BCP14 joins", async () => {
  const missing = await oracleClauseAuditFixture({
    mutateAudit: (audit) => {
      const join = audit.rawObligationJoins.find(({ clauseCandidateIds }) =>
        clauseCandidateIds.some((id) => id.startsWith("bcp14:")),
      );
      assert(join);
      join.clauseCandidateIds.splice(
        join.clauseCandidateIds.findIndex((id) => id.startsWith("bcp14:")),
        1,
      );
    },
  });
  const swapped = await oracleClauseAuditFixture({
    mutateAudit: (audit) => {
      const join = audit.rawObligationJoins.find(
        ({ clauseCandidateIds }) =>
          clauseCandidateIds.filter((id) => id.startsWith("bcp14:")).length >= 2,
      );
      assert(join);
      const indexes = join.clauseCandidateIds
        .map((id, index) => id.startsWith("bcp14:") ? index : -1)
        .filter((index) => index >= 0);
      [join.clauseCandidateIds[indexes[0]], join.clauseCandidateIds[indexes[1]]] =
        [join.clauseCandidateIds[indexes[1]], join.clauseCandidateIds[indexes[0]]];
    },
  });
  try {
    for (const fixture of [missing, swapped]) {
      const result = verifyShaclCandidateArtifacts(fixture.root, {
        receiptRef: fixture.receiptRef,
        expectedImplementationCommit: oracleImplementation,
      });
      assert.equal(result.ok, false);
      assert(
        result.errors.some((error) =>
          error.includes("raw BCP14 join differs from pinned anchor scope"),
        ),
      );
    }
  } finally {
    for (const fixture of [missing, swapped]) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("E3 validates its distinct receipt branch", async () => {
  const fixture = await oracleClauseAuditFixture();
  try {
    assert.deepEqual(oracleCandidateClausePolicyErrors(fixture), []);
    assert.deepEqual(
      verifyShaclCandidateArtifacts(fixture.root, {
        receiptRef: fixture.receiptRef,
        expectedImplementationCommit: oracleImplementation,
      }),
      { ok: true, errors: [] },
    );
    assert.equal(Object.hasOwn(fixture.receipt, "casesArtifact"), false);
    assert.equal(Object.hasOwn(fixture.receipt, "lanes"), false);
    assert.equal(Object.hasOwn(fixture.receipt, "aggregateCounts"), false);
    assert.deepEqual(
      fixture.audit.inventoryArtifact,
      fixture.inventoryArtifact,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("E3 rejects pending adoption, status promotion, and authority claims", async () => {
  const fixtures = await Promise.all([
    oracleClauseAuditFixture({
      mutateAudit: (audit) => {
        audit.mappingRevision.requiredBeforeAdoption = [
          "accepted Slice N identity is not bound",
        ];
      },
    }),
    oracleClauseAuditFixture({
      mutateAudit: (audit) => {
        audit.reviewedObligations[0].candidateExecutionStatus = "passed";
      },
    }),
    oracleClauseAuditFixture({
      mutateAudit: (audit) => {
        audit.completeConformance = true;
      },
    }),
  ]);
  try {
    const errors = fixtures.map(oracleCandidateClausePolicyErrors);
    assert(
      errors[0].some((error) =>
        error.includes("requires exact accepted slice evidence rebinding"),
      ),
    );
    assert(errors[1].some((error) => error.includes("execution status")));
    assert(errors[2].some((error) => error.includes("complete-conformance")));
  } finally {
    for (const fixture of fixtures) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("E3 rejects missing, truncated, and swapped D N evidence", async () => {
  const { requirements } = await oracleE3Modules();
  assert(
    requirements.candidateClauseMappingRevision.acceptedSliceEvidence.srlBnode,
    "negative D/N evidence tests require final Slice N rebinding",
  );
  const fixtures = await Promise.all([
    oracleClauseAuditFixture({
      mutateAudit: (audit) => {
        delete audit.mappingRevision.acceptedSliceEvidence.srlBnode;
      },
    }),
    oracleClauseAuditFixture({
      mutateAudit: (audit) => {
        assert(audit.mappingRevision.acceptedSliceEvidence.srlBnode);
        audit.mappingRevision.acceptedSliceEvidence.srlBnode.commit =
          audit.mappingRevision.acceptedSliceEvidence.srlBnode.commit.slice(0, 12);
      },
    }),
    oracleClauseAuditFixture({
      mutateAudit: (audit) => {
        const evidence = audit.mappingRevision.acceptedSliceEvidence;
        assert(evidence.srlBnode);
        [evidence.completeGroundData, evidence.srlBnode] =
          [evidence.srlBnode, evidence.completeGroundData];
      },
    }),
  ]);
  try {
    const errors = fixtures.map(oracleCandidateClausePolicyErrors);
    assert(errors[0].some((error) => error.includes("accepted slice evidence keys")));
    assert(
      errors[1].some((error) =>
        error.includes("accepted slice srlBnode commit is not a full"),
      ),
    );
    assert(
      errors[2].some((error) => error.includes("mapping revision")),
    );
  } finally {
    for (const fixture of fixtures) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("E3 rejects a dirty or wrong-revision candidate checkout", async () => {
  const dirty = await oracleClauseAuditFixture();
  const wrongRevision = await oracleClauseAuditFixture();
  try {
    const dirtyCheckout = resolve(
      dirty.root,
      `target/w3c/shacl-1.2/data-shapes-${candidateShaclRevision.suiteCommit.slice(0, 12)}`,
    );
    writeFileSync(resolve(dirtyCheckout, "intruder.txt"), "tampered\n");
    const dirtyResult = verifyShaclCandidateArtifacts(dirty.root, {
      receiptRef: dirty.receiptRef,
      expectedImplementationCommit: oracleImplementation,
    });
    assert.equal(dirtyResult.ok, false);
    assert(
      dirtyResult.errors.includes(
        "candidate clause-audit checkout is not clean",
      ),
    );

    const wrongCheckout = resolve(
      wrongRevision.root,
      `target/w3c/shacl-1.2/data-shapes-${candidateShaclRevision.suiteCommit.slice(0, 12)}`,
    );
    oracleGit(wrongCheckout, ["config", "user.name", "Oxigraph Oracle"]);
    oracleGit(wrongCheckout, ["config", "user.email", "oracle@example.invalid"]);
    const strayTree = oracleGit(wrongCheckout, ["hash-object", "-w", "-t", "tree", "--stdin"], "");
    const strayCommit = oracleGit(wrongCheckout, [
      "-c",
      "commit.gpgsign=false",
      "commit-tree",
      strayTree.trim(),
      "-m",
      "test: wrong candidate revision",
    ]).trim();
    assert.notEqual(strayCommit, candidateShaclRevision.suiteCommit);
    oracleGit(wrongCheckout, ["update-ref", "HEAD", strayCommit]);
    const wrongResult = verifyShaclCandidateArtifacts(wrongRevision.root, {
      receiptRef: wrongRevision.receiptRef,
      expectedImplementationCommit: oracleImplementation,
    });
    assert.equal(wrongResult.ok, false);
  } finally {
    for (const fixture of [dirty, wrongRevision]) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("E3 rejects ref, path, byte, and source drift", async () => {
  const ref = await oracleClauseAuditFixture({
    mutateReceipt: (receipt) => {
      receipt.auditArtifact = {
        ...receipt.auditArtifact,
        sha256: "5".repeat(64),
      };
    },
  });
  const path = await oracleClauseAuditFixture({
    mutateReceipt: (receipt) => {
      receipt.auditArtifact = {
        ...receipt.auditArtifact,
        path: receipt.auditArtifact.path.replace(
          "/clause-obligations.json",
          "/nested/clause-obligations.json",
        ),
      };
    },
  });
  const bytes = await oracleClauseAuditFixture();
  const source = await oracleClauseAuditFixture();
  try {
    const bytesPath = resolve(bytes.root, bytes.auditArtifact.path);
    const tampered = readFileSync(bytesPath);
    tampered[tampered.length - 2] ^= 1;
    writeFileSync(bytesPath, tampered);
    const bytesReceiptMtimeMs = statSync(
      resolve(bytes.root, bytes.receiptRef.path),
    ).mtimeMs;
    const beforeBytesReceipt = new Date(bytesReceiptMtimeMs - 1_000);
    utimesSync(bytesPath, beforeBytesReceipt, beforeBytesReceipt);
    const refResult = verifyShaclCandidateArtifacts(ref.root, {
      receiptRef: ref.receiptRef,
      expectedImplementationCommit: oracleImplementation,
    });
    assert.equal(refResult.ok, false);
    assert(refResult.errors.some((error) => error.includes("SHA-256")));
    const pathResult = verifyShaclCandidateArtifacts(path.root, {
      receiptRef: path.receiptRef,
      expectedImplementationCommit: oracleImplementation,
    });
    assert.equal(pathResult.ok, false);
    assert(pathResult.errors.some((error) => error.includes("direct child")));
    const bytesResult = verifyShaclCandidateArtifacts(bytes.root, {
      receiptRef: bytes.receiptRef,
      expectedImplementationCommit: oracleImplementation,
    });
    assert.equal(bytesResult.ok, false);
    assert(
      bytesResult.errors.includes(
        "candidate clause-audit artifact: candidate clause-audit artifact SHA-256 does not match its ref",
      ),
    );
    const sourceResult = verifyShaclCandidateArtifacts(source.root, {
      receiptRef: source.receiptRef,
      expectedImplementationCommit: "6".repeat(40),
    });
    assert.equal(sourceResult.ok, false);
    assert(
      sourceResult.errors.some((error) =>
        error.includes("differs from the expected source"),
      ),
    );
  } finally {
    for (const fixture of [ref, path, bytes, source]) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("E3 rejects run, inventory, and source identity drift", async () => {
  const run = await oracleClauseAuditFixture({
    mutateAudit: (audit) => {
      audit.runId = "00000000-0000-4000-8000-000000000000";
    },
  });
  const inventory = await oracleClauseAuditFixture({
    mutateAudit: (audit) => {
      audit.inventoryArtifact = {
        ...audit.inventoryArtifact,
        sha256: "7".repeat(64),
      };
    },
  });
  const source = await oracleClauseAuditFixture({
    mutateReceipt: (receipt) => {
      receipt.sourceBefore.commit = "8".repeat(40);
      receipt.sourceBefore.status = " M tools/evidence/policy.mjs";
      receipt.sourceAfter.branch = "detached";
    },
  });
  try {
    const runErrors = oracleCandidateClausePolicyErrors(run);
    assert(runErrors.some((error) => error.includes("audit run")));
    const inventoryErrors = oracleCandidateClausePolicyErrors(inventory);
    assert(
      inventoryErrors.some((error) => error.includes("inventory binding")),
    );
    const sourceErrors = oracleCandidateClausePolicyErrors(source);
    assert(sourceErrors.some((error) => error.includes("source before commit")));
    assert(sourceErrors.some((error) => error.includes("source before status")));
    assert(sourceErrors.some((error) => error.includes("source after branch")));
    assert(
      sourceErrors.some((error) => error.includes("source identity stability")),
    );
  } finally {
    for (const fixture of [run, inventory, source]) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
