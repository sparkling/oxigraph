import { createHash } from "node:crypto";
import { trustedRealGateValid } from "../metaharness/evidence.mjs";
const EXPECTED = Object.freeze({
  rdf: 575,
  sparql: 269,
  rdfc: 86,
  rdfSemantics: 77,
  rdfSimpleRegime: 24,
  rdfRegime: 27,
  rdfsRegime: 26,
  owlAssertions: 98,
  owlCases: 68,
  owlRules: 78,
  shaclDiscovered: 521,
  shacl: 519,
  shaclInvalid: 2,
  shaclRustAllFeatures: 167,
  shaclRustNoDefault: 114,
  shaclJenaCompact: 32,
  cliDefault: 144,
  cliNoDefault: 129,
  jenaProfile: "jena-6.1.0-outcome-intersection-2026-07-27-v1",
  jenaSubjectSha256:
    "182972ecb68f5d6e3868fa30bb44b860d50da6c135f2cc50e4236a2eb5876a63",
  jenaScenarios: 76,
  jenaAssertions: 198,
  jenaDomains: Object.freeze({
    rdf: 17,
    sparql: 30,
    shacl: 13,
    rdfs: 7,
    "owl2-rl": 9,
  }),
  jenaDomainAssertions: Object.freeze({
    rdf: 46,
    sparql: 77,
    shacl: 43,
    rdfs: 14,
    "owl2-rl": 18,
  }),
  jenaClassifications: Object.freeze({
    agreement: 70,
    "w3c-overrides-jena": 4,
    "w3c-permitted-divergence": 1,
    "jena-extension": 1,
  }),
  jenaReproducibilityRuns: 2,
  jenaProfileLockSha256:
    "b6b176c674451451b8b456ea8fc1e81a4dc6e01f471858e3b912d7c0af0e61e6",
  jenaReceiptSha256:
    "7209da6a1610f4f5252de97d13f75b46483b88f8f8a754d0d30170a92b6c401e",
  jenaResolvedInventorySha256:
    "be03e50517be71a7574d89982644fc3c1e54030c5d8375a792180ad37c476cb5",
  jenaObservationsSha256:
    "b9ad72609b05dbe3aaf29cbf8bdd2b8572f85e833a30bf123a580d7cf59e95b4",
  datalog: 70,
  agentic: 40,
  agenticSubjectCommit: "5a93890f792f908da930e97fc3b1e7c910fc5802",
  agenticAdapterCommands: 1,
  agenticAdapterRunId: "5e6202d7-e020-4af9-ae0d-1d4c8704a28e",
  agenticAdapterReceiptSha256:
    "0f1e3204b821acbd9f83f88f21afbe2cd9b60f48e9154c14c3f1e7509b261d05",
  agenticAdapterOracleSha256:
    "28b3cf49bfd7af8b4626d085d76745a0d4fe345a15a29ab471bae45e21711d05",
  agenticAdapterContentHash:
    "c110376a07c11f329011950342db5a9bce78c9975252015dd1c854449482687f",
  agenticAdapterExecutionHash:
    "0684c7b14febafb35707ed0980535ca2fbd5275e165946aba4ae10cafde78230",
  agenticPersistenceWrite: 45,
  agenticPersistenceCommands: 7,
  agenticPersistenceRunId: "73b6a484-f830-49d2-b4cc-de1549928613",
  agenticPersistenceReceiptSha256:
    "9f79554a22121e96b90c0861de7b9ff10fc64a2889590c52405de8bb05144ea7",
  agenticPersistenceOracleSha256:
    "f5cfbf2689d95c89098ce836c2f93f0597176c8d24a873221c27ef60abfd3338",
  agenticPersistenceContentHash:
    "b8f70d784e13c1af5db2fca853f5c6324543c2e3c7f221f7bc7de83c6e7e11e7",
  agenticPersistenceExecutionHash:
    "4daf9149c72b9d556168b5ce1becb646df9f73a97f2e19b15f2fc8fdd678f19f",
  agenticG1: 66,
  agenticG1Commands: 11,
  agenticG1RunId: "34602f2a-7332-4649-aef0-d51029389cfb",
  agenticG1ReceiptSha256:
    "0b74b063f11b82762fa2b9501430a8eb2db69797eccb28e83c025835a9453fcc",
  agenticG1OracleSha256:
    "b63b707204fddc365820334ea0936809ba020c7a58d278a53ec29043ae3762fe",
  agenticG1ContentHash:
    "af605096f4ffb13c3d36dd38ab6275a850a59d18891c3c628f9673075e147a64",
  agenticG1ExecutionHash:
    "828e385bcabe4339594d5cb55e92c108c7537c20b1e2233e765f0d969de357c0",
  mutationRunId: "731e6467-2cab-4260-8d15-b34e4ebc8ed6",
  mutationReceiptSha256:
    "fc0ec6dbb0c8dec0b3c9e2d58814372c8feebc8ec291528df1fdf432879b2ba5",
  mutationContentHash:
    "88de934ca8eba02ac985ab7bab25e7ea98d8b5412ecfcb623261b27e7cfec308",
  mutationExecutionHash:
    "cfe719d36a35d22325ba980690bdb1a5e6f69303dab3761f54b043744139353d",
  mutationInputContentHash:
    "9898ef56c90cbcd8eef9cd490c2d63c9ed42a9a96c5ccab39d99ba834d707c3d",
  mutationPublicationContentHash:
    "7e029baef4c99817d7ea126e852e4b280591d985d61effd97f78ca52f87280c7",
  mutationNativeOutcomesSha256:
    "edce7e97639bb40aa3846031d12d4e8581eb644a33962e8d6468b00cf81e95bd",
  mutationNativeInventorySha256:
    "ff5244d9a7386627731f193aaba76d91b923590421551833d959c9bb284cc052",
  mutationConfigSha256:
    "26cb0050c153299e5b98839c1a620d14deb25dc23ac765813b476acbb7825084",
  semanticIntegration: 4,
  supportingWrapper: 5,
});

export const semanticCommandIds = Object.freeze([
  "agenticAdapter",
  "oxrdf12",
  "sparql12Parser",
  "sparql12Evaluator",
  "sparqlUpdateAtomicity",
  "queryEntailmentProfiles",
  "queryEntailmentBoundary",
  "sparqlServiceHttp",
  "sparql12Results",
  "sparql11ResultsBoundary",
  "jsonLd12",
  "jsonLd11DirectionBoundary",
  "rdfXml12",
  "terseSerializerApis",
  "rdfIoProfiles",
  "cliHttp",
  "cliHttpNoDefault",
  "geosparql",
  "rdfc10",
  "supportingParserSuites",
  "normativeControlAudit",
  "normativeClauseInventory",
  "w3cRdf12",
  "rdfXmlSerializerManifest",
  "terseSerializerManifest",
  "w3cSparql12",
  "datalogFull",
  "storeReasoning",
  "storeSemanticProfiles",
  "datalogJena",
  "datalogSouffle",
  "rdfsFull",
  "rdfsJena",
  "owlFull",
  "owlW3c",
  "shaclFull",
  "shaclNoDefault",
  "shaclW3c",
  "shaclClauseAudit",
  "shaclJena",
  "jenaParity",
]);

function strictIsoTimestampMs(value) {
  if (typeof value !== "string") return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : NaN;
}

export function agenticGeneratedWithinQualificationWindow(
  qualification,
  agentic,
) {
  const startedAt = strictIsoTimestampMs(qualification?.startedAt);
  const finishedAt = strictIsoTimestampMs(qualification?.finishedAt);
  const generatedAt = strictIsoTimestampMs(agentic?.generatedAt);
  return (
    Number.isFinite(startedAt) &&
    Number.isFinite(finishedAt) &&
    Number.isFinite(generatedAt) &&
    startedAt <= finishedAt &&
    generatedAt >= startedAt &&
    generatedAt <= finishedAt
  );
}

export const expectedPins = Object.freeze({
  "w3c-rdf-tests": "3d0b0613d0177d25aad7ec60e88df2338f461516",
  "w3c-data-shapes": "eedda09f93c39be1d2e978f3f942631494ae25a0",
  "w3c-rdf-canon-tests": "15619df2fda7a4ca88308733789b6774517f9638",
  "w3c-json-ld-api": "92f07705a0c0ac27aa9bc6fe1322dcc9fad0114d",
  "w3c-json-ld-streaming": "64e6fea9eee3cf5d80468810552f50f6c487925f",
  "w3c-n3": "8a9ea8ed42ae0487b20803f5687017980bbe8e37",
});

export const expectedHistoricalPins = Object.freeze({
  "w3c-n3-semantic-receipt": "b975fc59ab5d2ad2d28e7206f1c34c716977d2ad",
});

export const expectedN3MaintenanceReceipt = Object.freeze({
  path: "n3-dependency-maintenance-receipt.json",
  sha256: "f721c9ccc52e946c4a1d35b301da6291e0f682bf8d4bb13e2a771bdfd5b9db56",
  schema: "oxigraph.n3-dependency-maintenance-receipt/v1",
  commit: "8a9ea8ed42ae0487b20803f5687017980bbe8e37",
  parent: "a9d5740cbd7d52c5a7f8314753a41929a52843fe",
  tree: "f27062aad2b1a6e39844a4ac725b373ba6faff35",
  reviewCommit: "71a80570fe6fb6c2292854baa33dd110603a81d1",
  canonicalDiffSha256:
    "063357740116ce829fd50b08113eaa4e8f04030eb6f65d417fc1ba4b40a38152",
  historicalDiffSha256:
    "f93b031eacd8e1fcfc2a0b7a495db879d384363c580939cc8c44f3b36bc70d6b",
  historicalStablePatchId: "821b792cb166348b980463ec6bc32237d3ba50ce",
  packageLockSha256:
    "7ed442b494053f6de4033e90bdc97980e9739011295e97fc61b5cffbaa8878a6",
});

export const expectedShaclIntegrity = Object.freeze({
  suiteContentSha256:
    "1d2c1c40769da1cf63fef62f3029447a66b5e81b5744b4cf2eaa5e128ba51a3a",
  specificationSha256: Object.freeze({
    core: "69497e1f3ef6993766f8a4f0812b61f4aa23b75e6a18e7425bc66dbf65d59b6e",
    nodeExpressions:
      "a1db16376a928ed90acd049537c645c4750f6fe2cb1ab99656ac689b40681f72",
    sparql:
      "c94be2019923aedacf01fe312404ef1e618bb06e3f9587eae35400633088db1c",
    rules:
      "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
    compact:
      "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
  }),
  grammarSha256:
    "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04",
});


function freezeCandidateContract(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeCandidateContract(child);
  }
  return value;
}

export const expectedCandidateShacl = freezeCandidateContract({
  revision: {
    repository: "https://github.com/w3c/data-shapes.git",
    suiteCommit: "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
    suiteContentSha256:
      "fa1ff95904600c553036123fd6eef66ad281a934830673ee7e9402b3257a3376",
    specificationFiles: {
      overview: "shacl12-overview/index.html",
      core: "shacl12-core/index.html",
      nodeExpressions: "shacl12-node-expr/index.html",
      sparql: "shacl12-sparql/index.html",
      sparqlRl: "sparql12-rl/index.html",
      inferenceRules: "shacl12-inference-rules/index.html",
      compact: "shacl12-cs/index.html",
      ui: "shacl12-ui/index.html",
      profiling: "shacl12-profiling/index.html",
    },
    specificationSha256: {
      overview: "b6030ce909fa3364e9afb21a6c68fee9c5256a28b9bb8d0962023f7b5b5c67c8",
      core: "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
      nodeExpressions:
        "24be3d6a35983bb795f282da462b52583e6330e5452996187ded39e0080802ea",
      sparql: "cae9dbeab7a626c131f4d99e6ad09b7a2cc46e1d8d7c4bfbbe4da1d529f878d8",
      sparqlRl: "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
      inferenceRules:
        "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
      compact: "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
      ui: "aeacbe7e229b41f0c533d2943ca5f73de0341c40dfa86f0caf4abf35d5ddaeea",
      profiling:
        "0c74dd12c4d19be4601b91c3204a78353f1e6fc7204cc8adc02e1a3e8961b0cf",
    },
    grammarFiles: {
      sparqlRl: "sparql12-rl/sparql-rl-grammar.bnf",
      compact: "shacl12-cs/SHACLC.g4",
    },
    grammarSha256: {
      sparqlRl: "511e88cfa9e33f7d38ee9379bf77c0db56bacfbd5858b7b55b4ca7a39f237a9e",
      compact: "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04",
    },
    declarationRows: 569,
    declarationBytes: 235376,
    declarationSha256:
      "25730098efb04ac9be0f853439843b7874784428ae712a73cc0d05bdcbc1909a",
  },
  counts: {
    validate: 170,
    nodeExpressions: 143,
    inferenceRules: 21,
    srl: 203,
    compactSyntax: 32,
  },
  declarations: {
    validate: { selected: 168, unsupported: 0, excluded: 2 },
    nodeExpressions: { selected: 143, unsupported: 0, excluded: 0 },
    inferenceRules: { selected: 14, unsupported: 7, excluded: 0 },
    srl: { selected: 203, unsupported: 0, excluded: 0 },
    compactSyntax: { selected: 32, unsupported: 0, excluded: 0 },
  },
  knownInferenceOrphan: {
    path: "shacl12-test-suite/tests/inference-rules/rdfs/rdfs1.ttl",
    sha256: "ad5003e7aabafcf5a5ff2647f08584da7c6ea4831f322f6e437eaac2855fdfe6",
    reason:
      "not reachable through inference-rules/manifest.ttl; excluded from manifest inventory",
  },
  fixedCoreExclusions: [
    {
      stableId: "shacl12-test-suite/tests/core/node/in-002.ttl#<in-002>",
      path: "shacl12-test-suite/tests/core/node/in-002.ttl",
      sha256: "9fbabda6e0d4eddbbf0cbb71b83ac1ba434368a5fca30869fc3e6f06d07e640d",
      requiredCapability: "Core/NodeExpr/SPARQL-validation",
      reason: "no-focus-node-and-absent-expected-source-shape",
    },
    {
      stableId:
        "shacl12-test-suite/tests/core/node/in-003.ttl#unparsed-approved-case",
      path: "shacl12-test-suite/tests/core/node/in-003.ttl",
      sha256: "3b6f11aec2bdb76b042b4b788064036ef4e9d3ae736efed28b3644b4caad4db3",
      requiredCapability: "valid-Turtle-fixture",
      reason: "undeclared-shsh-prefix",
    },
  ],
  unsupportedInference: [
    {
      stableId:
        "shacl12-test-suite/tests/inference-rules/SPARQLRuleTemplate-example-Multiply.ttl#<SPARQLRuleTemplate-example-Multiply>",
      path: "shacl12-test-suite/tests/inference-rules/SPARQLRuleTemplate-example-Multiply.ttl",
      sha256: "643639cb9ccdc476114c86f33c1e85b1d150b808e54678ab5d348a4227bee974",
      requirement: "requires-sh:SPARQLRuleTemplate",
    },
    {
      stableId:
        "shacl12-test-suite/tests/inference-rules/SPARQLRuleTemplate-example-SymmetricProperty.ttl#<SPARQLRuleTemplate-example-SymmetricProperty>",
      path: "shacl12-test-suite/tests/inference-rules/SPARQLRuleTemplate-example-SymmetricProperty.ttl",
      sha256: "4b90244c027c66adf80021355cf3819c4fc12f716a4d9b070ae66473f6f4f22b",
      requirement: "requires-sh:SPARQLRuleTemplate",
    },
    {
      stableId:
        "shacl12-test-suite/tests/inference-rules/TripleRule-example-childCount.ttl#<TripleRule-example-childCount>",
      path: "shacl12-test-suite/tests/inference-rules/TripleRule-example-childCount.ttl",
      sha256: "17a9f7bdbaaad63c4c2ee4c58eb4d143aff4c645cddaab22a6b1bce02d91c475",
      requirement: "requires-rdf-sh:TripleRule-compilation",
    },
    {
      stableId:
        "shacl12-test-suite/tests/inference-rules/TripleRule-example-squares.ttl#<TripleRule-example-squares>",
      path: "shacl12-test-suite/tests/inference-rules/TripleRule-example-squares.ttl",
      sha256: "560b9f62c5876ff84cf04f87770df5f537fa4465fdad522e305f9b0080b6e3b8",
      requirement: "requires-rdf-sh:TripleRule-compilation",
    },
    {
      stableId:
        "shacl12-test-suite/tests/inference-rules/run-once-example.ttl#<run-once-example>",
      path: "shacl12-test-suite/tests/inference-rules/run-once-example.ttl",
      sha256: "740a64ee711a34a905dc57646ce756d8790de0ad5cc67fb91aec87c56113c45b",
      requirement: "requires-sh:runOnce",
    },
    {
      stableId:
        "shacl12-test-suite/tests/inference-rules/temp-triples-example.ttl#<temp-triples-example>",
      path: "shacl12-test-suite/tests/inference-rules/temp-triples-example.ttl",
      sha256: "392e4dd847c678ba3560ddca4aaaba0f8f3fe0b817d36d45c419ee99bddf1f91",
      requirement: "requires-temporary-triple-semantics",
    },
    {
      stableId:
        "shacl12-test-suite/tests/inference-rules/layers-example.ttl#<layers-example>",
      path: "shacl12-test-suite/tests/inference-rules/layers-example.ttl",
      sha256: "fefcdee5d947442a7d7825a207cbd622a5ca1275d9168ec8bb147a090ab561c8",
      requirement: "requires-sh:layer-and-sh:runOnce",
    },
  ],
  evidence: {
    rustSuite: {
      lanes: {
        validate: {
          inventoryLane: "validate",
          counts: { discovered: 170, eligible: 168, passed: 168, unsupported: 0, failed: 0, excluded: 2 },
          exitCode: 0,
          command: { example: "w3c_runner", root: ["shacl12-test-suite", "tests"] },
          artifactName: "validate",
        },
        nodeExpressions: {
          inventoryLane: "nodeExpressions",
          counts: { discovered: 143, eligible: 143, passed: 143, unsupported: 0, failed: 0, excluded: 0 },
          exitCode: 0,
          command: { example: "w3c_node_expr_runner", root: ["shacl12-test-suite", "tests", "node-expr"] },
          artifactName: "node-expressions",
        },
        sparqlRulesInfer: {
          inventoryLane: "inferenceRules",
          counts: { discovered: 21, eligible: 21, passed: 14, unsupported: 7, failed: 0, excluded: 0 },
          exitCode: 2,
          command: { example: "w3c_sparql_rules_runner", root: ["shacl12-test-suite", "tests", "inference-rules"] },
          artifactName: "sparql-rules-infer",
        },
        srlRules: {
          inventoryLane: "srl",
          counts: { discovered: 203, eligible: 203, passed: 203, unsupported: 0, failed: 0, excluded: 0 },
          exitCode: 0,
          command: { example: "w3c_srl_rules_runner", root: ["shacl12-test-suite", "tests", "sparql-rl"] },
          artifactName: "srl-rules",
        },
        compactSyntax: {
          inventoryLane: "compactSyntax",
          counts: { discovered: 32, eligible: 32, passed: 32, unsupported: 0, failed: 0, excluded: 0 },
          exitCode: 0,
          command: { example: "w3c_compact_runner", root: ["shacl12-cs", "tests", "valid"] },
          artifactName: "compact-syntax",
        },
      },
      aggregateCounts: { discovered: 569, eligible: 567, passed: 560, unsupported: 7, failed: 0, excluded: 2 },
    },
    jenaCompact: {
      lanes: {
        jenaCompact: {
          inventoryLane: "compactSyntax",
          counts: { discovered: 32, eligible: 32, passed: 32, unsupported: 0, failed: 0, excluded: 0 },
          exitCode: 0,
          command: { program: "mvn" },
          artifactName: "jena-compact",
        },
      },
      aggregateCounts: { discovered: 32, eligible: 32, passed: 32, unsupported: 0, failed: 0, excluded: 0 },
    },
  },
});

export const expectedCandidateClauseAudit = freezeCandidateContract({
  "schema": "oxigraph.shacl-candidate-clause-audit/v1",
  "hashes": {
    "mappingRevision": "a83a2b9e511ea7c63934acb1e30d55f4967d50cf0b921c88b2317c391348639d",
    "groupedRequirements": "c440145383354ad5b3b6a1655ae1fe423ac755b3f3d6fd79c43415eca62c8829",
    "reviewedObligations": "20b00a0d637257d16a13e0cb480ed79b86933fb3f30e2caa32f074abef8ca521",
    "residualClaims": "46f21e8957852eb7ba03e9611a28477d6f6933bc3d6fe5f31dc4f4828cfe7b92"
  },
  "counts": {
    "mappings": 25,
    "sourceFacets": 42,
    "obligations": 38,
    "residualClaims": 14,
    "syntaxRules": {
      "core": 113,
      "nodeExpressions": 35,
      "sparql": 46,
      "inferenceRules": 25
    },
    "sparqlRlGrammarProductions": 153
  },
  "mappingRevision": {
    "schema": "oxigraph.shacl-candidate-clause-mapping/v1",
    "repository": "https://github.com/w3c/data-shapes.git",
    "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
    "suiteContentSha256": "fa1ff95904600c553036123fd6eef66ad281a934830673ee7e9402b3257a3376",
    "inventoryBinding": {
      "schema": "oxigraph.shacl-candidate-inventory/v1",
      "declarationProjection": {
        "rows": 569,
        "bytes": 235376,
        "sha256": "25730098efb04ac9be0f853439843b7874784428ae712a73cc0d05bdcbc1909a"
      }
    },
    "receiptBinding": {
      "schema": "oxigraph.shacl-candidate-run/v1",
      "kind": "clause-audit",
      "auditArtifactSchema": "oxigraph.shacl-candidate-clause-audit/v1",
      "completeConformance": false,
      "qualified": false,
      "promoted": false
    },
    "documents": {
      "overview": {
        "path": "shacl12-overview/index.html",
        "sha256": "b6030ce909fa3364e9afb21a6c68fee9c5256a28b9bb8d0962023f7b5b5c67c8"
      },
      "core": {
        "path": "shacl12-core/index.html",
        "sha256": "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9"
      },
      "nodeExpressions": {
        "path": "shacl12-node-expr/index.html",
        "sha256": "24be3d6a35983bb795f282da462b52583e6330e5452996187ded39e0080802ea"
      },
      "sparql": {
        "path": "shacl12-sparql/index.html",
        "sha256": "cae9dbeab7a626c131f4d99e6ad09b7a2cc46e1d8d7c4bfbbe4da1d529f878d8"
      },
      "sparqlRl": {
        "path": "sparql12-rl/index.html",
        "sha256": "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74"
      },
      "inferenceRules": {
        "path": "shacl12-inference-rules/index.html",
        "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499"
      },
      "compact": {
        "path": "shacl12-cs/index.html",
        "sha256": "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd"
      },
      "ui": {
        "path": "shacl12-ui/index.html",
        "sha256": "aeacbe7e229b41f0c533d2943ca5f73de0341c40dfa86f0caf4abf35d5ddaeea"
      },
      "profiling": {
        "path": "shacl12-profiling/index.html",
        "sha256": "0c74dd12c4d19be4601b91c3204a78353f1e6fc7204cc8adc02e1a3e8961b0cf"
      }
    },
    "grammars": {
      "sparqlRl": {
        "path": "sparql12-rl/sparql-rl-grammar.bnf",
        "sha256": "511e88cfa9e33f7d38ee9379bf77c0db56bacfbd5858b7b55b4ca7a39f237a9e"
      },
      "compact": {
        "path": "shacl12-cs/SHACLC.g4",
        "sha256": "d0ccc4594b88a19c021ae4a50719b35ff6f2eebc774f0187a4f8e02ecfbced04"
      }
    },
    "retiredHistoricalRules": {
      "path": "shacl12-rules/index.html",
      "sha256": "45ef06db0d7df325171e877032774f989f96a22f96d2cc373755eda1dd514ad4",
      "state": "deleted-at-candidate"
    },
    "candidateInventories": {
      "coreSyntaxRules": 113,
      "nodeExpressionSyntaxRules": 35,
      "sparqlExtensionSyntaxRules": 46,
      "inferenceRuleSyntaxRules": 25,
      "sparqlRlGrammarProductions": 153
    },
    "movedSyntaxRuleIds": [
      "RulesGraph",
      "condition-node",
      "construct-count",
      "construct-datatype",
      "deactivated-in",
      "deactivated-maxCount",
      "rule",
      "rule-order-datatype",
      "rule-order-maxCount",
      "rule-type"
    ],
    "preservedDatedProfiles": [
      "shacl-1.2-core-2026-07-23-subset-v1",
      "shacl-1.2-node-expressions-2026-01-08-subset-v1",
      "shacl-1.2-sparql-extensions-2026-01-30-subset-v1",
      "shacl-1.2-rules-2026-07-27-subset-v1",
      "shacl-1.2-compact-syntax-2025-10-30-subset-v1"
    ],
    "historicalExports": {
      "requirementMappings": {
        "export": "shaclRequirementMappings",
        "sourcePath": "tools/shacl-tests/shacl-requirements.mjs",
        "baselineSourceSha256": "f8fc2457ca04949047f704fe6bbac8cca9599ae47c4766945692a1eaa24e2b37"
      },
      "reviewedObligations": {
        "export": "reviewedObligations",
        "residualExport": "residualClaims",
        "sourcePath": "tools/shacl-tests/clause-reviews.mjs",
        "baselineSourceSha256": "70b8738d88d389320fbcea6e1c8d86f1853844eb30d7151384acf04e4f0a131a"
      }
    },
    "ordinaryEvidenceCommits": {
      "dataExecutionAndRuleProcessor": "e9a285c8217087a255072271f1bb444e70d43d32",
      "bodyAbbreviationsAndRuleOrdering": "6e933eea37bd0f27660ee4a3471cdf11b910c949",
      "coreValueUnion": "6c317a9a0448c9c92e6e47cf90e4434751b24a15",
      "expectedPredicateLifecycle": "85580fc93f122565bdc0de48aef42a334174bb9e",
      "candidateEvidenceContracts": "049e81c9fafa7aaf984808d48231e98ef56e6f46",
      "completeGroundData": "2e63c6920a9c51e7b078d9a87c3070f6a8fb3978",
      "srlBnode": "f706742b17e6674360c34cf6bdfc3b1b59ab59f3"
    },
    "acceptedSliceEvidence": {
      "completeGroundData": {
        "taskId": "task-1789908162318-haeyko",
        "commit": "2e63c6920a9c51e7b078d9a87c3070f6a8fb3978",
        "acceptanceArtifact": "target/engineering-delivery/adr0046-srl-data/accepted-EGzKud.json",
        "acceptanceSha256": "39955651bc5bf1ecf071fff9c3fbf1df1dced2432861b3c3102ddbdbb989807f",
        "workflowRunId": "e12bca4c-4d2c-48b3-8f13-d9fcfcf5c4c7",
        "evidenceKey": "programme-task-evidence/workflow-e12bca4c-4d2c-48b3-8f13-d9fcfcf5c4c7",
        "reviewArtifact": "target/engineering-delivery/adr0046-srl-data/accepted-EGzKud.json#reviewResponse",
        "reviewSha256": "15e46e33100c48c15687d722a6b2fc73988fa5910da4d1bac79b88ae7c65079b"
      },
      "srlBnode": {
        "taskId": "task-1789919062167-d1g7i1",
        "commit": "f706742b17e6674360c34cf6bdfc3b1b59ab59f3",
        "acceptanceArtifact": "target/engineering-delivery/adr0046-srl-bnode/accepted-8tVvxP.json",
        "acceptanceSha256": "962baef59d23bc12cfa28421a437daa4d7ffa6fd1077cee5b08b72064b06ae9c",
        "workflowRunId": "384d7494-7e95-49a0-8f71-442839b63a2c",
        "evidenceKey": "programme-task-evidence/workflow-384d7494-7e95-49a0-8f71-442839b63a2c",
        "reviewArtifact": "target/engineering-delivery/adr0046-srl-bnode/accepted-8tVvxP.json#artifactReferences[1]",
        "reviewSha256": "0f5020e450a2a325700d226d946d90e656cd783441c5c1229d6bbb6da322fd4b"
      }
    },
    "requiredBeforeAdoption": []
  },
  "mappings": [
    {
      "id": "SHACL12-OVERVIEW-INFORMATIVE",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "not-applicable-informative",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "not-applicable",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "overview-navigation",
          "document": "overview",
          "path": "shacl12-overview/index.html",
          "sha256": "b6030ce909fa3364e9afb21a6c68fee9c5256a28b9bb8d0962023f7b5b5c67c8",
          "anchors": [
            "shacl-1.2",
            "introduction"
          ],
          "interpretation": "Informative navigation only."
        }
      ]
    },
    {
      "id": "SHACL12-CORE-SHAPES-GRAPH",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "core-shapes-graph",
          "document": "core",
          "path": "shacl12-core/index.html",
          "sha256": "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
          "anchors": [
            "shapes",
            "shapes-graph",
            "ill-formed-shape-graphs",
            "shapes-recursion"
          ],
          "interpretation": "Core shapes-graph and well-formedness source."
        }
      ]
    },
    {
      "id": "SHACL12-CORE-TARGETS-PATHS",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "core-targets-and-value-nodes",
          "document": "core",
          "path": "shacl12-core/index.html",
          "sha256": "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
          "anchors": [
            "targets",
            "property-paths",
            "focusNodes",
            "value-nodes",
            "value-nodes-property-shapes",
            "subClassOfInShapesGraph"
          ],
          "interpretation": "Target, path, focus, value-node union/default, and optional shapes-graph subclass semantics."
        }
      ]
    },
    {
      "id": "SHACL12-CORE-CONSTRAINTS",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "core-constraints",
          "document": "core",
          "path": "shacl12-core/index.html",
          "sha256": "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
          "anchors": [
            "core-components",
            "constraints",
            "value-nodes",
            "value-nodes-property-shapes"
          ],
          "interpretation": "Core constraint evaluation including the candidate value-node algorithm."
        }
      ]
    },
    {
      "id": "SHACL12-CORE-REPORTS",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "core-reports",
          "document": "core",
          "path": "shacl12-core/index.html",
          "sha256": "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
          "anchors": [
            "validation-report",
            "results-validation-result",
            "conformanceDisallows",
            "shapesGraphWellFormed"
          ],
          "interpretation": "Validation report construction and optional well-formedness declaration."
        }
      ]
    },
    {
      "id": "SHACL12-CORE-FAILURES",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "core-failures",
          "document": "core",
          "path": "shacl12-core/index.html",
          "sha256": "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
          "anchors": [
            "failures",
            "ill-formed-shape-graphs",
            "validation-definition"
          ],
          "interpretation": "Core failure and validation boundaries."
        }
      ]
    },
    {
      "id": "SHACL12-CORE-UPSTREAM-FIXTURES",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable-with-frozen-exclusions",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "blocked-upstream",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "core-candidate-fixtures",
          "document": "core",
          "path": "shacl12-core/index.html",
          "sha256": "295a3ef4a18471369e7605eb08558bfac0986919aa0e857339733604356506b9",
          "anchors": [
            "conformance"
          ],
          "interpretation": "Candidate Core conformance source associated with the independently frozen inventory."
        }
      ]
    },
    {
      "id": "SHACL12-SPARQL-CONSTRAINTS",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "sparql-constraints",
          "document": "sparql",
          "path": "shacl12-sparql/index.html",
          "sha256": "cae9dbeab7a626c131f4d99e6ad09b7a2cc46e1d8d7c4bfbbe4da1d529f878d8",
          "anchors": [
            "sparql-constraints",
            "constraint-components-validators",
            "pre-binding",
            "sparql-constraints-annotations"
          ],
          "interpretation": "SPARQL constraint, validator, prebinding, and annotation clauses."
        }
      ]
    },
    {
      "id": "SHACL12-SPARQL-NODE-EXPRESSIONS",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "sparql-node-expressions",
          "document": "sparql",
          "path": "shacl12-sparql/index.html",
          "sha256": "cae9dbeab7a626c131f4d99e6ad09b7a2cc46e1d8d7c4bfbbe4da1d529f878d8",
          "anchors": [
            "sparql-node-expressions",
            "SelectExpression",
            "SPARQLExprExpression"
          ],
          "interpretation": "SPARQL-backed node-expression syntax and execution."
        }
      ]
    },
    {
      "id": "SHACL12-SPARQL-RULES",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable-with-unsupported-facets",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset-and-explicit-unsupported",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "inference-rule-syntax",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "syntax",
            "SPARQLRule"
          ],
          "interpretation": "RDF SHACL rule types and SPARQL rule execution."
        },
        {
          "id": "inference-rules-graph",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "rules-graph"
          ],
          "interpretation": "Rules-graph role and IRI identity."
        },
        {
          "id": "inference-global-rules",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "global-rules",
            "rules-execution"
          ],
          "interpretation": "Global rules execute with an empty focus set."
        },
        {
          "id": "inference-rule-conditions",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "condition",
            "rules-execution"
          ],
          "interpretation": "Conditions constrain shape-rule focus nodes; they are not a global-rule rejection rule."
        },
        {
          "id": "inference-deactivated-rules",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "deactivated-rules"
          ],
          "interpretation": "Deactivated rules are ignored."
        },
        {
          "id": "inference-rule-layers",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "rule-layers",
            "rules-execution"
          ],
          "interpretation": "Numeric SHACL rule layers."
        },
        {
          "id": "inference-rule-order",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "rule-order",
            "rules-execution"
          ],
          "interpretation": "Same-order concurrency and ordered visibility."
        },
        {
          "id": "inference-run-once",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "run-once",
            "rules-execution"
          ],
          "interpretation": "RDF sh:runOnce semantics, distinct from SPARQL-RL run-once strata."
        },
        {
          "id": "inference-expected-predicate",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "expectedPredicate",
            "rules-execution"
          ],
          "interpretation": "Expected derived triples, per-layer preparation, and cleanup."
        },
        {
          "id": "inference-temporary-triples",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "tempTriple",
            "rules-execution"
          ],
          "interpretation": "Temporary triples and reifier cleanup."
        },
        {
          "id": "inference-custom-processors",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "ruleProcessor"
          ],
          "interpretation": "Unsupported custom processors must fail."
        },
        {
          "id": "inference-rule-sets",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "ruleSet"
          ],
          "interpretation": "Named and included rule sets."
        }
      ]
    },
    {
      "id": "SHACL12-SPARQL-CONFORMANCE",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "residual-family-claim-withheld",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "sparql-conformance",
          "document": "sparql",
          "path": "shacl12-sparql/index.html",
          "sha256": "cae9dbeab7a626c131f4d99e6ad09b7a2cc46e1d8d7c4bfbbe4da1d529f878d8",
          "anchors": [
            "conformance",
            "syntax-rules"
          ],
          "interpretation": "SPARQL Extensions conformance without moved rule syntax."
        }
      ]
    },
    {
      "id": "SHACL12-NODEEXPR-OPERATORS",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "node-expression-operators",
          "document": "nodeExpressions",
          "path": "shacl12-node-expr/index.html",
          "sha256": "24be3d6a35983bb795f282da462b52583e6330e5452996187ded39e0080802ea",
          "anchors": [
            "library",
            "library-list-operators",
            "library-advanced-sequence",
            "library-aggregation",
            "InstancesOfExpression",
            "NodesMatchingExpression"
          ],
          "interpretation": "Node-expression library plus changed InstancesOf and NodesMatching syntax."
        }
      ]
    },
    {
      "id": "SHACL12-NODEEXPR-FUNCTIONS",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "node-expression-functions",
          "document": "nodeExpressions",
          "path": "shacl12-node-expr/index.html",
          "sha256": "24be3d6a35983bb795f282da462b52583e6330e5452996187ded39e0080802ea",
          "anchors": [
            "blank-node-functions",
            "NamedParameterFunctions",
            "ListParameterFunction",
            "sparql-functions"
          ],
          "interpretation": "Built-in and custom functions, including the changed CustomListParameterFunction syntax."
        }
      ]
    },
    {
      "id": "SHACL12-NODEEXPR-WELLFORMED",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset-fail-closed",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "node-expression-wellformed",
          "document": "nodeExpressions",
          "path": "shacl12-node-expr/index.html",
          "sha256": "24be3d6a35983bb795f282da462b52583e6330e5452996187ded39e0080802ea",
          "anchors": [
            "syntax",
            "failure-handling",
            "custom-node-expressions"
          ],
          "interpretation": "Node-expression syntax and failure behavior."
        }
      ]
    },
    {
      "id": "SHACL12-NODEEXPR-CONFORMANCE",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "residual-family-claim-withheld",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "node-expression-conformance",
          "document": "nodeExpressions",
          "path": "shacl12-node-expr/index.html",
          "sha256": "24be3d6a35983bb795f282da462b52583e6330e5452996187ded39e0080802ea",
          "anchors": [
            "conformance",
            "index"
          ],
          "interpretation": "Node-expression processor conformance."
        }
      ]
    },
    {
      "id": "SHACL12-RULES-CONCRETE-SYNTAX",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable-with-distinct-rdf-facet",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-text-syntax-subset-and-rdf-unsupported",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "sparql-rl-text-syntax",
          "document": "sparqlRl",
          "path": "sparql12-rl/index.html",
          "sha256": "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
          "anchors": [
            "sparql-rl-grammar",
            "grammar",
            "version-announcement"
          ],
          "interpretation": "SPARQL-RL textual syntax and version announcement."
        },
        {
          "id": "rdf-shacl-rule-syntax",
          "document": "inferenceRules",
          "path": "shacl12-inference-rules/index.html",
          "sha256": "4d0a82bcd515a15ced94eda13edde1d846442589855287e0812ec2211e022499",
          "anchors": [
            "syntax",
            "SPARQLRule",
            "TripleRule",
            "SPARQLRuleTemplate"
          ],
          "interpretation": "Distinct RDF SHACL rule forms; no RDF-to-SPARQL-RL mapping is implied."
        }
      ]
    },
    {
      "id": "SHACL12-RULES-WELLFORMED-STRATIFICATION",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "sparql-rl-wellformed-stratification",
          "document": "sparqlRl",
          "path": "sparql12-rl/index.html",
          "sha256": "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
          "anchors": [
            "wellformed",
            "rule-dependency",
            "dependency-graph-construction-algorithm",
            "stratification"
          ],
          "interpretation": "SPARQL-RL well-formedness, dependencies, and outcome-compatible stratification."
        }
      ]
    },
    {
      "id": "SHACL12-RULES-EVALUATION",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable-with-ambiguous-source",
      "sourceStatus": "source-reviewed-with-explicit-ambiguity",
      "implementationStatus": "ordinary-tested-subset-complete-ground-data-and-srl-bnode-evidence-bound",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "sparql-rl-evaluation",
          "document": "sparqlRl",
          "path": "sparql12-rl/index.html",
          "sha256": "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
          "anchors": [
            "rule-set-evaluation",
            "evaluation-preparation",
            "eval-rule",
            "eval-rule-set"
          ],
          "interpretation": "Rule-set preparation and evaluation algorithm."
        },
        {
          "id": "sparql-rl-expression-evaluation",
          "document": "sparqlRl",
          "path": "sparql12-rl/index.html",
          "sha256": "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
          "anchors": [
            "eval-expression"
          ],
          "interpretation": "Expression and functional-form evaluation."
        },
        {
          "id": "sparql-rl-ground-data",
          "document": "sparqlRl",
          "path": "sparql12-rl/index.html",
          "sha256": "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
          "anchors": [
            "ground-data",
            "eval-rule",
            "eval-rule-set"
          ],
          "interpretation": "Ground DATA and DATA-sensitive matching."
        },
        {
          "id": "sparql-rl-imports",
          "document": "sparqlRl",
          "path": "sparql12-rl/index.html",
          "sha256": "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
          "anchors": [
            "process-imports"
          ],
          "interpretation": "Optional bounded import processing and fail-closed errors."
        }
      ]
    },
    {
      "id": "SHACL12-RULES-CONFORMANCE",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "residual-family-claim-withheld",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "sparql-rl-conformance",
          "document": "sparqlRl",
          "path": "sparql12-rl/index.html",
          "sha256": "524c7d69e61f926e5bf5e82b0019c088dfb6da950517eea9bb1673f47facbc74",
          "anchors": [
            "conformance",
            "rules-abstract-syntax",
            "rule-set-evaluation",
            "rules-defns"
          ],
          "interpretation": "SPARQL-RL syntax and rule-set evaluation conformance surfaces."
        }
      ]
    },
    {
      "id": "SHACL12-UI-METADATA",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "not-applicable-renderer-surface",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "not-applicable",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "ui-metadata",
          "document": "ui",
          "path": "shacl12-ui/index.html",
          "sha256": "aeacbe7e229b41f0c533d2943ca5f73de0341c40dfa86f0caf4abf35d5ddaeea",
          "anchors": [
            "rendering-concepts",
            "widgets",
            "editors",
            "viewers",
            "property-roles"
          ],
          "interpretation": "UI rendering metadata."
        }
      ]
    },
    {
      "id": "SHACL12-UI-ROLE",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "not-applicable-role-separated",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "not-applicable",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "ui-role",
          "document": "ui",
          "path": "shacl12-ui/index.html",
          "sha256": "aeacbe7e229b41f0c533d2943ca5f73de0341c40dfa86f0caf4abf35d5ddaeea",
          "anchors": [
            "scope",
            "conformance",
            "renderer"
          ],
          "interpretation": "Separate UI implementation role."
        }
      ]
    },
    {
      "id": "SHACL12-CS-PARSER",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable-informative-suite",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-informative-subset",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "compact-parser",
          "document": "compact",
          "path": "shacl12-cs/index.html",
          "sha256": "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
          "anchors": [
            "grammar-section"
          ],
          "interpretation": "SHACL-C grammar and mapping source."
        }
      ]
    },
    {
      "id": "SHACL12-CS-DRAFT",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "applicable-informative-suite",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "draft-bound-no-normative-oracle",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "compact-draft",
          "document": "compact",
          "path": "shacl12-cs/index.html",
          "sha256": "f6db1b05cd0201e7afb16dcc5b02c9306c7568cfbdf487b81c19ee14e34151cd",
          "anchors": [
            "conventions",
            "grammar-section"
          ],
          "interpretation": "Editor-draft conventions and grammar."
        }
      ]
    },
    {
      "id": "SHACL12-PROFILING-DESCRIPTION",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "not-applicable-publisher-role",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "internal-catalog-only-w3c-claim-withheld",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "profiling-description",
          "document": "profiling",
          "path": "shacl12-profiling/index.html",
          "sha256": "0c74dd12c4d19be4601b91c3204a78353f1e6fc7204cc8adc02e1a3e8961b0cf",
          "anchors": [
            "defining-profiles",
            "creating-profiles",
            "profiling-specifications",
            "profiling-data"
          ],
          "interpretation": "W3C profile description and publication roles."
        }
      ]
    },
    {
      "id": "SHACL12-PROFILING-NEGOTIATION",
      "mappingSchema": "oxigraph.shacl-candidate-clause-mapping/v1",
      "suiteCommit": "0ccfab4f28324edaac59a1227f8c60ad5b7bbf89",
      "applicability": "not-applicable-publisher-and-data-author-role",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "internal-library-negotiation-only",
      "candidateExecutionStatus": "unexecuted",
      "sourceFacets": [
        {
          "id": "profiling-negotiation",
          "document": "profiling",
          "path": "shacl12-profiling/index.html",
          "sha256": "0c74dd12c4d19be4601b91c3204a78353f1e6fc7204cc8adc02e1a3e8961b0cf",
          "anchors": [
            "conformance",
            "dependencies",
            "profiling-of-shacl"
          ],
          "interpretation": "Profiling conformance, dependency, and SHACL profile description."
        },
        {
          "id": "profiling-conforms-to-shapes-graph",
          "document": "profiling",
          "path": "shacl12-profiling/index.html",
          "sha256": "0c74dd12c4d19be4601b91c3204a78353f1e6fc7204cc8adc02e1a3e8961b0cf",
          "anchors": [
            "rule-conformstoshapesgraph"
          ],
          "interpretation": "Derives sh:conformsToShapesGraph from a validation activity, its used graphs, generated report, and sh:conforms true."
        },
        {
          "id": "profiling-conforms-to-specification",
          "document": "profiling",
          "path": "shacl12-profiling/index.html",
          "sha256": "0c74dd12c4d19be4601b91c3204a78353f1e6fc7204cc8adc02e1a3e8961b0cf",
          "anchors": [
            "rule-conformstospecification"
          ],
          "interpretation": "Propagates graph conformance through prof:isProfileOf to dcterms:conformsTo."
        }
      ]
    }
  ],
  "obligations": [
    {
      "id": "core-entailment-unsupported-failure",
      "mappingId": "SHACL12-CORE-FAILURES",
      "sourceFacetIds": [
        "core-failures"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "core-validation-input-immutability",
      "mappingId": "SHACL12-CORE-FAILURES",
      "sourceFacetIds": [
        "core-failures"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-by-api",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "core-property-value-union-default",
      "mappingId": "SHACL12-CORE-TARGETS-PATHS",
      "sourceFacetIds": [
        "core-targets-and-value-nodes"
      ],
      "level": "ALGORITHM",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "core-well-formed-shapes-graph",
      "mappingId": "SHACL12-CORE-SHAPES-GRAPH",
      "sourceFacetIds": [
        "core-shapes-graph"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "residual-not-claimed",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "core-report-graph",
      "mappingId": "SHACL12-CORE-REPORTS",
      "sourceFacetIds": [
        "core-reports"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "core-subclass-hierarchy-source",
      "mappingId": "SHACL12-CORE-TARGETS-PATHS",
      "sourceFacetIds": [
        "core-targets-and-value-nodes"
      ],
      "level": "SHOULD",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "core-shapes-graph-well-formed-flag",
      "mappingId": "SHACL12-CORE-REPORTS",
      "sourceFacetIds": [
        "core-reports"
      ],
      "level": "SHOULD",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested-opt-in",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-prefix-collection",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-resulting-query-parse",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-prebinding-restrictions",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-path-substitution",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-solution-failure",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-result-mapping",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-message-interpolation",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "SHOULD",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-result-annotations",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MAY",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-custom-parameter-syntax",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-parameter-shape-conformance",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-validator-query-roles",
      "mappingId": "SHACL12-SPARQL-CONSTRAINTS",
      "sourceFacetIds": [
        "sparql-constraints"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "sparql-select-expression-syntax",
      "mappingId": "SHACL12-SPARQL-NODE-EXPRESSIONS",
      "sourceFacetIds": [
        "sparql-node-expressions"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "node-expression-processor",
      "mappingId": "SHACL12-NODEEXPR-CONFORMANCE",
      "sourceFacetIds": [
        "node-expression-conformance"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "candidate-unexecuted",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "node-by-expression-source-copy",
      "mappingId": "SHACL12-NODEEXPR-OPERATORS",
      "sourceFacetIds": [
        "node-expression-operators"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-srl-syntax-recognition",
      "mappingId": "SHACL12-RULES-CONCRETE-SYNTAX",
      "sourceFacetIds": [
        "sparql-rl-text-syntax"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested-subset",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-srl-wellformed-stratification",
      "mappingId": "SHACL12-RULES-WELLFORMED-STRATIFICATION",
      "sourceFacetIds": [
        "sparql-rl-wellformed-stratification"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested-subset",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-srl-evaluation",
      "mappingId": "SHACL12-RULES-EVALUATION",
      "sourceFacetIds": [
        "sparql-rl-evaluation",
        "sparql-rl-expression-evaluation",
        "sparql-rl-ground-data",
        "sparql-rl-imports"
      ],
      "level": "ALGORITHM",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-tested-subset-complete-ground-data-and-srl-bnode-evidence-bound",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-srl-data-source-interpretation",
      "mappingId": "SHACL12-RULES-EVALUATION",
      "sourceFacetIds": [
        "sparql-rl-evaluation",
        "sparql-rl-ground-data"
      ],
      "level": "AMBIGUOUS-SOURCE",
      "sourceStatus": "source-reviewed-with-explicit-ambiguity",
      "implementationStatus": "ordinary-local-contract-tested-source-ambiguous",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-deleted-for-clause-rejection",
      "mappingId": "SHACL12-RULES-CONCRETE-SYNTAX",
      "sourceFacetIds": [
        "sparql-rl-text-syntax"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-parser-fail-closed",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-body-abbreviations",
      "mappingId": "SHACL12-RULES-EVALUATION",
      "sourceFacetIds": [
        "sparql-rl-evaluation"
      ],
      "level": "ALGORITHM",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested-subset",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-rdf-syntax-boundaries",
      "mappingId": "SHACL12-RULES-CONCRETE-SYNTAX",
      "sourceFacetIds": [
        "rdf-shacl-rule-syntax"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "explicit-unsupported-subset",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-graph-identifier-syntax",
      "mappingId": "SHACL12-SPARQL-RULES",
      "sourceFacetIds": [
        "inference-rules-graph"
      ],
      "level": "MAY-AND-SYNTAX",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested-subset",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-global-condition-policy",
      "mappingId": "SHACL12-SPARQL-RULES",
      "sourceFacetIds": [
        "inference-global-rules",
        "inference-rule-conditions"
      ],
      "level": "LOCAL-POLICY",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-local-policy-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-expected-predicate-lifecycle",
      "mappingId": "SHACL12-SPARQL-RULES",
      "sourceFacetIds": [
        "inference-expected-predicate",
        "inference-rule-layers",
        "inference-rules-graph"
      ],
      "level": "ALGORITHM",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-run-once-and-temporary-triples",
      "mappingId": "SHACL12-SPARQL-RULES",
      "sourceFacetIds": [
        "inference-run-once",
        "inference-temporary-triples"
      ],
      "level": "ALGORITHM",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "unsupported",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-rule-processor-failure",
      "mappingId": "SHACL12-SPARQL-RULES",
      "sourceFacetIds": [
        "inference-custom-processors"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-tested",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "rules-abstract-query-surface",
      "mappingId": "SHACL12-RULES-CONFORMANCE",
      "sourceFacetIds": [
        "sparql-rl-conformance"
      ],
      "level": "ABSTRACT-OPERATION",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "ordinary-implemented-subset",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "compact-grammar-mapping",
      "mappingId": "SHACL12-CS-PARSER",
      "sourceFacetIds": [
        "compact-parser"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "candidate-unexecuted-ordinary-local-oracles-exist",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "ui-renderer-conformance",
      "mappingId": "SHACL12-UI-ROLE",
      "sourceFacetIds": [
        "ui-role"
      ],
      "level": "MUST",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "not-applicable-to-store-neutral-validator",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "profiling-author-conventions",
      "mappingId": "SHACL12-PROFILING-DESCRIPTION",
      "sourceFacetIds": [
        "profiling-description"
      ],
      "level": "SHOULD",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "not-applicable-no-w3c-profiling-claim",
      "candidateExecutionStatus": "unexecuted"
    },
    {
      "id": "profiling-conformance-provenance-rules",
      "mappingId": "SHACL12-PROFILING-NEGOTIATION",
      "sourceFacetIds": [
        "profiling-conforms-to-shapes-graph",
        "profiling-conforms-to-specification"
      ],
      "level": "RULE",
      "sourceStatus": "source-reviewed",
      "implementationStatus": "not-applicable-no-w3c-profiling-claim",
      "candidateExecutionStatus": "unexecuted"
    }
  ],
  "residualClaims": [
    "All candidate collections are bound to data-shapes commit 0ccfab4f28324edaac59a1227f8c60ad5b7bbf89 and remain candidate-unexecuted until E4 ordinary execution.",
    "Historical mappings, dated profiles, source IRIs, the 156-production SRL TSV, fixed-path artifacts, receipts, and archive validators retain their historical commit and hashes.",
    "Complete SHACL 1.2 Core well-formedness, import compatibility, SPARQL Extensions, Node Expressions, Inference Rules, SPARQL-RL, Compact Syntax, UI, and Profiling conformance are not claimed.",
    "The candidate SPARQL Extensions inventory has 46 syntax-rule IDs; ten rule IDs moved to the distinct 25-ID Inference Rules source. Historical 56-ID evidence remains historical.",
    "The candidate SPARQL-RL grammar has 153 productions and is a distinct identity from the historical 156-production inventory and receipts.",
    "RDF sh:runOnce, sh:tempTriple, sh:TripleRule, and sh:SPARQLRuleTemplate execution remain exact predeclared unsupported surfaces; the programmatic Datalog API is not an RDF compiler.",
    "sh:expectedPredicate has bounded ordinary implementation evidence for layer-start derivation and cleanup, but supporting it does not close the inference-rules family or optional sh:sourceRule provenance.",
    "Accepted local base-plus-inline DATA interpretation; differs from literal G0 call sites; upstream intent unresolved. This prevents an unqualified literal candidate-algorithm equivalence claim and does not authorize changing accepted DATA semantics.",
    "Complete-ground-DATA slice D and SRL BNODE slice N are bound to exact accepted commits, acceptance artifacts, review hashes, workflow runs, and programme evidence keys before E3 adoption.",
    "The candidate public abstract Query operation exists, but no concrete Query grammar is supplied and the local single-triple goal restriction is not a specification MUST.",
    "Candidate Node Expressions retain 35 syntax-rule IDs but include reviewed semantic text changes for InstancesOfExpression, NodesMatchingExpression, and CustomListParameterFunction.",
    "The profiling rule-conformsto anchor is deleted and replaced by semantically distinct conforms-to-shapes-graph and conforms-to-specification rules; neither transfers historical evidence or creates a W3C profiling role for Oxigraph.",
    "SHACL UI and W3C Profiling roles remain outside the store-neutral validator, and SHACL-C upstream pairs remain informative.",
    "A candidate suite pass records only exact observed cases and cannot resolve source ambiguity, close untested prose, change preexecution declarations, qualify, promote, or replace historical evidence."
  ]
});

const CANDIDATE_COUNT_FIELDS = Object.freeze([
  "discovered",
  "eligible",
  "passed",
  "unsupported",
  "failed",
  "excluded",
]);
const CANDIDATE_SHA256 = /^[0-9a-f]{64}$/u;
const CANDIDATE_COMMIT = /^[0-9a-f]{40}$/u;
const CANDIDATE_UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANDIDATE_OUTCOME = Object.freeze({
  selected: "PASS",
  unsupported: "UNSUPPORTED",
  excluded: "EXCLUDED",
});

function candidateRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function candidateExactKeys(errors, label, value, expected) {
  const actual = candidateRecord(value) ? Object.keys(value).sort() : [];
  equal(errors, `${label} keys`, JSON.stringify(actual), JSON.stringify([...expected].sort()));
}

function candidateDeepEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => candidateDeepEqual(value, right[index]))
    );
  }
  if (!candidateRecord(left) || !candidateRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    candidateDeepEqual(leftKeys, rightKeys) &&
    leftKeys.every((key) => candidateDeepEqual(left[key], right[key]))
  );
}

function candidateEqualValue(errors, label, actual, expected) {
  if (!candidateDeepEqual(actual, expected)) {
    errors.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function candidateJsonSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function candidateStringArray(errors, label, value, { nonempty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${label} is not an array`);
    return [];
  }
  if (nonempty && value.length === 0) errors.push(`${label} is empty`);
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== "string" || !entry) {
      errors.push(`${label} contains an invalid string`);
    } else if (seen.has(entry)) {
      errors.push(`${label} duplicates ${entry}`);
    }
    seen.add(entry);
  }
  return value;
}

function candidateRelativePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function validateCandidateCounts(label, value, errors) {
  candidateExactKeys(errors, label, value, CANDIDATE_COUNT_FIELDS);
  for (const field of CANDIDATE_COUNT_FIELDS) {
    if (!Number.isSafeInteger(value?.[field]) || value[field] < 0) {
      errors.push(`${label} ${field} is not a non-negative safe integer`);
    }
  }
  equal(
    errors,
    `${label} discovered conservation`,
    value?.discovered,
    (value?.eligible ?? NaN) + (value?.excluded ?? NaN),
  );
  equal(
    errors,
    `${label} eligible conservation`,
    value?.eligible,
    (value?.passed ?? NaN) + (value?.unsupported ?? NaN) + (value?.failed ?? NaN),
  );
}

function candidateProjection(lanes) {
  const rows = Object.entries(lanes ?? {}).flatMap(([lane, cases]) =>
    (Array.isArray(cases) ? cases : []).map((entry) => {
      const sources = new Map();
      for (const source of Array.isArray(entry?.sources) ? entry.sources : []) {
        sources.set(`${source?.path}\0${source?.sha256}`, [source?.path, source?.sha256]);
      }
      return [
        lane,
        entry?.stableId ?? entry?.id,
        entry?.type,
        entry?.status,
        entry?.declaration,
        [...(Array.isArray(entry?.profileIds) ? entry.profileIds : [])].sort(),
        [...sources.values()].sort((left, right) =>
          left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0,
        ),
      ];
    }),
  );
  rows.sort((left, right) =>
    left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0,
  );
  const bytes = Buffer.from(rows.map((row) => `${JSON.stringify(row)}\n`).join(""), "utf8");
  return {
    rows: rows.length,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function candidateSpecialIdentity(entry) {
  const source = (entry?.sources ?? []).find((item) => item?.path === entry?.manifest?.path) ?? entry?.sources?.[0];
  return {
    stableId: entry?.stableId ?? entry?.id,
    path: source?.path,
    sha256: source?.sha256,
    requiredCapability: entry?.requiredCapability,
    reason: entry?.exclusion,
    requirement: entry?.requiredCapability,
  };
}

export function validateCandidateShaclInventory(value, errors) {
  candidateExactKeys(errors, "candidate inventory", value, [
    "schema",
    "source",
    "integrity",
    "lanes",
    "counts",
    "knownInferenceOrphan",
    "fixedCoreExclusions",
    "completeConformance",
    "qualified",
    "promoted",
  ]);
  equal(errors, "candidate inventory schema", value?.schema, "oxigraph.shacl-candidate-inventory/v1");
  candidateExactKeys(errors, "candidate inventory source", value?.source, [
    "repository",
    "suiteCommit",
    "implementationCommit",
  ]);
  equal(errors, "candidate repository", value?.source?.repository, expectedCandidateShacl.revision.repository);
  equal(errors, "candidate suite commit", value?.source?.suiteCommit, expectedCandidateShacl.revision.suiteCommit);
  if (!CANDIDATE_COMMIT.test(value?.source?.implementationCommit ?? "")) {
    errors.push("candidate implementation commit is not a full lowercase Git commit");
  }
  equal(errors, "candidate suite-content hash", value?.integrity?.suiteContentSha256, expectedCandidateShacl.revision.suiteContentSha256);
  candidateEqualValue(errors, "candidate specification hashes", value?.integrity?.specificationSha256, expectedCandidateShacl.revision.specificationSha256);
  candidateEqualValue(errors, "candidate grammar hashes", value?.integrity?.grammarSha256, expectedCandidateShacl.revision.grammarSha256);
  candidateEqualValue(errors, "candidate lane counts", value?.counts, expectedCandidateShacl.counts);
  equal(errors, "candidate complete-conformance claim", value?.completeConformance, false);
  equal(errors, "candidate qualified claim", value?.qualified, false);
  equal(errors, "candidate promoted claim", value?.promoted, false);

  const laneNames = Object.keys(expectedCandidateShacl.counts);
  candidateExactKeys(errors, "candidate inventory lanes", value?.lanes, laneNames);
  const observedIdentities = new Set();
  const dispositions = Object.fromEntries(
    laneNames.map((lane) => [lane, { selected: 0, unsupported: 0, excluded: 0 }]),
  );
  const excluded = [];
  const unsupported = [];
  for (const lane of laneNames) {
    const cases = value?.lanes?.[lane];
    equal(errors, `candidate ${lane} count`, cases?.length, expectedCandidateShacl.counts[lane]);
    if (!Array.isArray(cases)) continue;
    for (const [index, entry] of cases.entries()) {
      const label = `candidate ${lane}[${index}]`;
      const identity = entry?.stableId ?? entry?.id;
      if (typeof identity !== "string" || !identity) errors.push(`${label} has no stable identity`);
      else if (observedIdentities.has(identity)) errors.push(`${label} duplicates identity ${identity}`);
      else observedIdentities.add(identity);
      equal(errors, `${label} lane`, entry?.lane, lane);
      if (!Object.hasOwn(dispositions[lane], entry?.declaration)) {
        errors.push(`${label} has invalid declaration ${JSON.stringify(entry?.declaration)}`);
      } else {
        dispositions[lane][entry.declaration] += 1;
      }
      if (!Array.isArray(entry?.profileIds)) errors.push(`${label} profileIds is not an array`);
      if (!Array.isArray(entry?.sources) || entry.sources.length === 0) {
        errors.push(`${label} sources is empty`);
      } else {
        const seenSources = new Set();
        for (const source of entry.sources) {
          const key = `${source?.path}\0${source?.sha256}`;
          if (!candidateRelativePath(source?.path) || !CANDIDATE_SHA256.test(source?.sha256 ?? "")) {
            errors.push(`${label} contains an invalid source reference`);
          } else if (seenSources.has(key)) {
            errors.push(`${label} contains a duplicate source reference`);
          }
          seenSources.add(key);
        }
        for (const reference of entry?.references ?? []) {
          if (
            typeof reference?.role !== "string" ||
            typeof reference?.disposition !== "string" ||
            !seenSources.has(`${reference?.path}\0${reference?.sha256}`)
          ) {
            errors.push(`${label} contains a reference not bound by sources`);
          }
        }
      }
      if (
        !candidateRelativePath(entry?.runnerIdentity?.file) ||
        typeof entry?.runnerIdentity?.testId !== "string" ||
        !entry.runnerIdentity.testId
      ) {
        errors.push(`${label} has an invalid runner identity`);
      }
      if (entry?.declaration === "excluded") excluded.push(candidateSpecialIdentity(entry));
      if (entry?.declaration === "unsupported") unsupported.push(candidateSpecialIdentity(entry));
    }
  }
  candidateEqualValue(errors, "candidate declarations", dispositions, expectedCandidateShacl.declarations);

  const expectedExcluded = expectedCandidateShacl.fixedCoreExclusions.map((entry) => ({
    stableId: entry.stableId,
    path: entry.path,
    sha256: entry.sha256,
    requiredCapability: entry.requiredCapability,
    reason: entry.reason,
    requirement: entry.requiredCapability,
  })).sort((left, right) => left.stableId.localeCompare(right.stableId));
  excluded.sort((left, right) => String(left.stableId).localeCompare(String(right.stableId)));
  candidateEqualValue(errors, "candidate excluded identities", excluded, expectedExcluded);
  const expectedUnsupported = expectedCandidateShacl.unsupportedInference.map((entry) => ({
    stableId: entry.stableId,
    path: entry.path,
    sha256: entry.sha256,
    requiredCapability: entry.requirement,
    reason: undefined,
    requirement: entry.requirement,
  })).sort((left, right) => left.stableId.localeCompare(right.stableId));
  unsupported.sort((left, right) => String(left.stableId).localeCompare(String(right.stableId)));
  candidateEqualValue(errors, "candidate unsupported identities", unsupported, expectedUnsupported);
  candidateEqualValue(
    errors,
    "candidate fixed exclusions",
    value?.fixedCoreExclusions,
    expectedCandidateShacl.fixedCoreExclusions.map(({ path, sha256, reason }) => ({ path, sha256, reason })),
  );
  candidateEqualValue(
    errors,
    "candidate known inference orphan",
    value?.knownInferenceOrphan,
    expectedCandidateShacl.knownInferenceOrphan,
  );

  const projection = candidateProjection(value?.lanes);
  candidateEqualValue(errors, "candidate declaration projection", projection, {
    rows: expectedCandidateShacl.revision.declarationRows,
    bytes: expectedCandidateShacl.revision.declarationBytes,
    sha256: expectedCandidateShacl.revision.declarationSha256,
  });
  candidateEqualValue(errors, "candidate recorded declaration projection", value?.integrity?.declarationProjection, projection);
}

function candidateCasesByIdentity(inventory) {
  return new Map(
    Object.values(inventory?.lanes ?? {}).flatMap((cases) =>
      (Array.isArray(cases) ? cases : []).map((entry) => [entry.stableId ?? entry.id, entry]),
    ),
  );
}

function candidateRawEvidence(name, stdout, errors) {
  if (typeof stdout !== "string") {
    errors.push(`candidate lane ${name} stdout is not UTF-8 text`);
    return { counts: undefined, cases: [] };
  }
  const lines = stdout.split(/\r?\n/u);
  const cases = [];
  for (const line of lines) {
    if (!/^(?:PASS|FAIL|UNSUPPORTED|EXCLUDED)\t/u.test(line)) continue;
    const fields = line.split("\t");
    if (fields.length !== 4) {
      errors.push(`candidate lane ${name} emitted a case line without exactly four fields`);
      continue;
    }
    const [kind, file, testId, detail] = fields;
    if (
      !candidateRelativePath(file) ||
      !testId ||
      /[\r\n\0]/u.test(testId) ||
      /[\r\n\0]/u.test(detail)
    ) {
      errors.push(`candidate lane ${name} emitted an invalid case identity`);
      continue;
    }
    cases.push({ kind, file, testId, detail });
  }
  const summaries = lines.filter((line) => line.startsWith("SUMMARY "));
  if (summaries.length !== 1) {
    errors.push(`candidate lane ${name} emitted ${summaries.length} summary lines instead of one`);
    return { counts: undefined, cases };
  }
  const match =
    /^SUMMARY discovered=(\d+) eligible=(\d+) passed=(\d+) unsupported=(\d+) failed=(\d+) excluded=(\d+)$/u.exec(
      summaries[0],
    );
  if (!match) {
    errors.push(`candidate lane ${name} emitted a malformed six-field summary`);
    return { counts: undefined, cases };
  }
  const counts = Object.fromEntries(
    CANDIDATE_COUNT_FIELDS.map((field, index) => [field, Number(match[index + 1])]),
  );
  validateCandidateCounts(`candidate lane ${name} raw counts`, counts, errors);
  const byKind = { PASS: 0, FAIL: 0, UNSUPPORTED: 0, EXCLUDED: 0 };
  for (const entry of cases) byKind[entry.kind] += 1;
  for (const [kind, field] of [["PASS", "passed"], ["FAIL", "failed"], ["UNSUPPORTED", "unsupported"], ["EXCLUDED", "excluded"]]) {
    equal(errors, `candidate lane ${name} raw ${kind} count`, byKind[kind], counts[field]);
  }
  equal(errors, `candidate lane ${name} raw discovered cases`, cases.length, counts.discovered);
  return { counts, cases };
}

function validateCandidateCommand(name, value, expected, checkoutPath, repositoryRoot, errors) {
  const command = value?.command;
  if (expected.command.program === "mvn") {
    equal(errors, `candidate lane ${name} command program`, command?.program, "mvn");
    candidateEqualValue(errors, `candidate lane ${name} command arguments`, command?.args, [
      "-q",
      "-f",
      `${repositoryRoot}/tools/shacl-tests/jena-compact/pom.xml`,
      "compile",
      "exec:java",
      `-Dexec.args=${checkoutPath}/shacl12-cs/tests/valid`,
    ]);
    return;
  }
  equal(errors, `candidate lane ${name} command program`, command?.program, "cargo");
  candidateEqualValue(errors, `candidate lane ${name} command arguments`, command?.args, [
    "run",
    "--locked",
    "-p",
    "oxshacl",
    "--example",
    expected.command.example,
    "--features",
    "w3c-tests,rdf-12",
    "--",
    `${checkoutPath}/${expected.command.root.join("/")}`,
  ]);
}

function validateCandidateLaneReceipt(name, value, expected, raw, checkoutPath, repositoryRoot, runDirectory, errors) {
  candidateExactKeys(errors, `candidate lane ${name}`, value, [
    "inventoryLane", "command", "status", "stdoutArtifact", "stderrArtifact",
    "counts", "complete", "errors",
  ]);
  candidateExactKeys(errors, `candidate lane ${name} command`, value?.command, ["program", "args"]);
  candidateExactKeys(errors, `candidate lane ${name} status`, value?.status, ["code", "signal", "error"]);
  equal(errors, `candidate lane ${name} stdout path`, value?.stdoutArtifact?.path, `${runDirectory}/${expected.artifactName}.stdout.log`);
  equal(errors, `candidate lane ${name} stderr path`, value?.stderrArtifact?.path, `${runDirectory}/${expected.artifactName}.stderr.log`);
  equal(errors, `candidate lane ${name} inventory lane`, value?.inventoryLane, expected.inventoryLane);
  validateCandidateCounts(`candidate lane ${name} counts`, value?.counts, errors);
  candidateEqualValue(errors, `candidate lane ${name} exact counts`, value?.counts, expected.counts);
  equal(errors, `candidate lane ${name} exit code`, value?.status?.code, expected.exitCode);
  equal(errors, `candidate lane ${name} signal`, value?.status?.signal, null);
  equal(errors, `candidate lane ${name} spawn error`, value?.status?.error, null);
  equal(errors, `candidate lane ${name} complete`, value?.complete, true);
  candidateEqualValue(errors, `candidate lane ${name} errors`, value?.errors, []);
  validateCandidateCommand(name, value, expected, checkoutPath, repositoryRoot, errors);
  const rawEvidence = candidateRawEvidence(name, raw?.stdout, errors);
  candidateEqualValue(errors, `candidate lane ${name} raw/receipt counts`, rawEvidence.counts, value?.counts);
  return rawEvidence.cases;
}

function candidateClauseMappingProjection(value) {
  return {
    id: value?.id,
    mappingSchema: value?.mappingSchema,
    suiteCommit: value?.suiteCommit,
    applicability: value?.applicability,
    sourceStatus: value?.sourceStatus,
    implementationStatus: value?.implementationStatus,
    candidateExecutionStatus: value?.candidateExecutionStatus,
    sourceFacets: value?.sourceFacets,
  };
}

function candidateClauseObligationProjection(value) {
  return {
    id: value?.id,
    mappingId: value?.mappingId,
    sourceFacetIds: value?.sourceFacetIds,
    level: value?.level,
    sourceStatus: value?.sourceStatus,
    implementationStatus: value?.implementationStatus,
    candidateExecutionStatus: value?.candidateExecutionStatus,
  };
}

function expectedCandidateSourceFacets() {
  return expectedCandidateClauseAudit.mappings.flatMap((mapping) =>
    mapping.sourceFacets.map((facet) => ({
      ...facet,
      mappingId: mapping.id,
      sourceStatus: mapping.sourceStatus,
    })),
  );
}

function validateCandidateClauseSourceRecord(label, value, expectedSources, errors) {
  if (!CANDIDATE_SHA256.test(value?.sha256 ?? "")) {
    errors.push(`${label} source SHA-256 is invalid`);
  }
  const expected = expectedSources.get(value?.document);
  if (!expected) {
    errors.push(`${label} names unknown document ${JSON.stringify(value?.document)}`);
    return;
  }
  equal(errors, `${label} source path`, value?.path, expected.path);
  equal(errors, `${label} source SHA-256`, value?.sha256, expected.sha256);
}

function validateCandidateAcceptedSliceEvidence(revision, mappings, obligations, errors) {
  const evidence = revision?.acceptedSliceEvidence;
  candidateExactKeys(errors, "candidate accepted slice evidence", evidence, [
    "completeGroundData",
    "srlBnode",
  ]);
  const fields = [
    "taskId",
    "commit",
    "acceptanceArtifact",
    "acceptanceSha256",
    "workflowRunId",
    "evidenceKey",
    "reviewArtifact",
    "reviewSha256",
  ];
  for (const [name, value] of Object.entries(evidence ?? {})) {
    if (value === null) continue;
    const label = `candidate accepted slice ${name}`;
    candidateExactKeys(errors, label, value, fields);
    if (!/^task-[a-z0-9-]+$/u.test(value?.taskId ?? "")) {
      errors.push(`${label} task ID is invalid`);
    }
    if (!CANDIDATE_COMMIT.test(value?.commit ?? "")) {
      errors.push(`${label} commit is not a full lowercase Git commit`);
    }
    if (!CANDIDATE_SHA256.test(value?.acceptanceSha256 ?? "")) {
      errors.push(`${label} acceptance SHA-256 is invalid`);
    }
    if (!CANDIDATE_UUID_V4.test(value?.workflowRunId ?? "")) {
      errors.push(`${label} workflow run ID is not a lowercase UUID v4`);
    }
    if (
      typeof value?.evidenceKey !== "string" ||
      !value.evidenceKey.startsWith("programme-task-evidence/workflow-")
    ) {
      errors.push(`${label} evidence key is invalid`);
    }
    if (typeof value?.acceptanceArtifact !== "string" || !value.acceptanceArtifact) {
      errors.push(`${label} acceptance artifact is invalid`);
    }
    if (typeof value?.reviewArtifact !== "string" || !value.reviewArtifact) {
      errors.push(`${label} review artifact is invalid`);
    }
    if (!CANDIDATE_SHA256.test(value?.reviewSha256 ?? "")) {
      errors.push(`${label} review SHA-256 is invalid`);
    }
  }
  for (const [name, commit] of Object.entries(revision?.ordinaryEvidenceCommits ?? {})) {
    if (!CANDIDATE_COMMIT.test(commit ?? "")) {
      errors.push(`candidate ordinary evidence commit ${name} is not full lowercase Git`);
    }
  }
  const pendingN = evidence?.srlBnode === null;
  const statuses = [...mappings, ...obligations].map(({ implementationStatus }) =>
    String(implementationStatus),
  );
  if (pendingN && !statuses.some((status) => status.includes("pending-n"))) {
    errors.push("candidate mapping cleared pending N status without accepted SRL BNODE evidence");
  }
  if (!pendingN && statuses.some((status) => status.includes("pending-n"))) {
    errors.push("candidate mapping retains pending N status after accepted SRL BNODE evidence");
  }
  if (
    !pendingN &&
    !statuses.some((status) =>
      status.includes("complete-ground-data-and-srl-bnode-evidence-bound"),
    )
  ) {
    errors.push("candidate mapping does not name the accepted DATA and BNODE slice evidence");
  }
}

function validateCandidateClauseAuditEvidence(bundle, errors) {
  const receipt = bundle?.receipt;
  const inventory = bundle?.inventory;
  const audit = bundle?.audit;
  const runDirectory = bundle?.runDirectory;
  validateCandidateShaclInventory(inventory, errors);

  candidateExactKeys(errors, "candidate clause-audit receipt", receipt, [
    "schema", "kind", "suiteCommit", "implementationCommit", "runId",
    "inventoryArtifact", "auditArtifact", "sourceBefore", "sourceAfter",
    "complete", "errors", "completeConformance", "qualified", "promoted",
  ]);
  equal(errors, "candidate clause-audit receipt schema", receipt?.schema, "oxigraph.shacl-candidate-run/v1");
  equal(errors, "candidate clause-audit receipt kind", receipt?.kind, "clause-audit");
  if (!CANDIDATE_COMMIT.test(receipt?.implementationCommit ?? "")) {
    errors.push("candidate clause-audit implementation commit is not a full lowercase Git commit");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(receipt?.runId ?? "")) {
    errors.push("candidate clause-audit run ID is not a lowercase UUID v4");
  }
  for (const [label, actual, expected] of [
    ["inventory suite", inventory?.source?.suiteCommit, receipt?.suiteCommit],
    ["audit suite", audit?.suiteCommit, receipt?.suiteCommit],
    ["receipt suite", receipt?.suiteCommit, expectedCandidateShacl.revision.suiteCommit],
    ["inventory implementation", inventory?.source?.implementationCommit, receipt?.implementationCommit],
    ["audit implementation", audit?.implementationCommit, receipt?.implementationCommit],
    ["audit run", audit?.runId, receipt?.runId],
  ]) equal(errors, `candidate clause-audit ${label}`, actual, expected);
  equal(errors, "candidate clause-audit inventory path", receipt?.inventoryArtifact?.path, `${runDirectory}/inventory.json`);
  equal(errors, "candidate clause-audit artifact path", receipt?.auditArtifact?.path, `${runDirectory}/clause-obligations.json`);
  equal(errors, "candidate clause-audit complete", receipt?.complete, true);
  candidateEqualValue(errors, "candidate clause-audit receipt errors", receipt?.errors, []);
  equal(errors, "candidate clause-audit complete-conformance claim", receipt?.completeConformance, false);
  equal(errors, "candidate clause-audit qualified claim", receipt?.qualified, false);
  equal(errors, "candidate clause-audit promoted claim", receipt?.promoted, false);
  for (const [label, source] of [["before", receipt?.sourceBefore], ["after", receipt?.sourceAfter]]) {
    candidateExactKeys(errors, `candidate clause-audit source ${label}`, source, ["commit", "branch", "status"]);
    equal(errors, `candidate clause-audit source ${label} commit`, source?.commit, receipt?.implementationCommit);
    equal(errors, `candidate clause-audit source ${label} branch`, source?.branch, "main");
    equal(errors, `candidate clause-audit source ${label} status`, source?.status, "");
  }
  candidateEqualValue(errors, "candidate clause-audit source identity stability", receipt?.sourceAfter, receipt?.sourceBefore);

  candidateExactKeys(errors, "candidate clause-audit artifact", audit, [
    "schema", "suiteCommit", "implementationCommit", "runId", "source",
    "inventoryArtifact", "mappingRevision", "documents", "grammars",
    "groupedRequirements", "reviewedObligations", "sourceFacets",
    "rawObligationJoins", "clauseCandidates", "syntaxRules",
    "grammarProductions", "residualClaims", "completeConformance",
    "qualified", "promoted",
  ]);
  equal(errors, "candidate clause-audit schema", audit?.schema, expectedCandidateClauseAudit.schema);
  candidateExactKeys(errors, "candidate clause-audit source", audit?.source, [
    "repository", "suiteCommit", "implementationCommit", "immutable",
  ]);
  equal(errors, "candidate clause-audit repository", audit?.source?.repository, expectedCandidateClauseAudit.mappingRevision.repository);
  equal(errors, "candidate clause-audit source suite", audit?.source?.suiteCommit, receipt?.suiteCommit);
  equal(errors, "candidate clause-audit source implementation", audit?.source?.implementationCommit, receipt?.implementationCommit);
  equal(errors, "candidate clause-audit immutable source", audit?.source?.immutable, true);
  candidateEqualValue(errors, "candidate clause-audit inventory binding", audit?.inventoryArtifact, receipt?.inventoryArtifact);
  equal(errors, "candidate clause-audit complete-conformance", audit?.completeConformance, false);
  equal(errors, "candidate clause-audit qualified", audit?.qualified, false);
  equal(errors, "candidate clause-audit promoted", audit?.promoted, false);

  candidateEqualValue(errors, "candidate clause-audit mapping revision", audit?.mappingRevision, expectedCandidateClauseAudit.mappingRevision);
  equal(errors, "candidate clause-audit mapping revision hash", candidateJsonSha256(audit?.mappingRevision), expectedCandidateClauseAudit.hashes.mappingRevision);
  const documentApplicability = {
    overview: "informative-navigation",
    core: "validation-processor",
    nodeExpressions: "node-expression-processor",
    sparql: "sparql-validation-processor",
    sparqlRl: "sparql-rl-processor",
    inferenceRules: "inference-rules-processor",
    compact: "compact-syntax-parser",
    ui: "renderer-or-ui",
    profiling: "profile-author-or-data-author",
  };
  candidateExactKeys(errors, "candidate clause-audit documents", audit?.documents, Object.keys(expectedCandidateClauseAudit.mappingRevision.documents));
  for (const [name, descriptor] of Object.entries(expectedCandidateClauseAudit.mappingRevision.documents)) {
    const value = audit?.documents?.[name];
    candidateExactKeys(errors, `candidate clause-audit document ${name}`, value, [
      "path", "sha256", "applicability", "syntaxRules",
      "bcp14ClauseCandidates", "sourceFacetAnchors",
    ]);
    equal(errors, `candidate clause-audit document ${name} path`, value?.path, descriptor.path);
    equal(errors, `candidate clause-audit document ${name} SHA-256`, value?.sha256, descriptor.sha256);
    equal(errors, `candidate clause-audit document ${name} applicability`, value?.applicability, documentApplicability[name]);
    for (const field of ["syntaxRules", "bcp14ClauseCandidates", "sourceFacetAnchors"]) {
      if (!Number.isSafeInteger(value?.[field]) || value[field] < 0) {
        errors.push(`candidate clause-audit document ${name} ${field} is invalid`);
      }
    }
  }
  candidateExactKeys(errors, "candidate clause-audit grammars", audit?.grammars, Object.keys(expectedCandidateClauseAudit.mappingRevision.grammars));
  for (const [name, descriptor] of Object.entries(expectedCandidateClauseAudit.mappingRevision.grammars)) {
    const value = audit?.grammars?.[name];
    candidateExactKeys(errors, `candidate clause-audit grammar ${name}`, value, ["path", "sha256", "productions"]);
    equal(errors, `candidate clause-audit grammar ${name} path`, value?.path, descriptor.path);
    equal(errors, `candidate clause-audit grammar ${name} SHA-256`, value?.sha256, descriptor.sha256);
    const expectedProductions = name === "sparqlRl" ? expectedCandidateClauseAudit.counts.sparqlRlGrammarProductions : null;
    equal(errors, `candidate clause-audit grammar ${name} production count`, value?.productions, expectedProductions);
  }
  equal(errors, "candidate clause-audit grouped requirements hash", candidateJsonSha256(audit?.groupedRequirements), expectedCandidateClauseAudit.hashes.groupedRequirements);
  equal(errors, "candidate clause-audit reviewed obligations hash", candidateJsonSha256(audit?.reviewedObligations), expectedCandidateClauseAudit.hashes.reviewedObligations);
  equal(errors, "candidate clause-audit residual claims hash", candidateJsonSha256(audit?.residualClaims), expectedCandidateClauseAudit.hashes.residualClaims);
  candidateEqualValue(
    errors,
    "candidate clause-audit mapping projections",
    Array.isArray(audit?.groupedRequirements) ? audit.groupedRequirements.map(candidateClauseMappingProjection) : audit?.groupedRequirements,
    expectedCandidateClauseAudit.mappings,
  );
  candidateEqualValue(
    errors,
    "candidate clause-audit obligation projections",
    Array.isArray(audit?.reviewedObligations) ? audit.reviewedObligations.map(candidateClauseObligationProjection) : audit?.reviewedObligations,
    expectedCandidateClauseAudit.obligations,
  );
  candidateEqualValue(errors, "candidate clause-audit residual claims", audit?.residualClaims, expectedCandidateClauseAudit.residualClaims);

  const mappings = Array.isArray(audit?.groupedRequirements) ? audit.groupedRequirements : [];
  const mappingIds = new Set();
  const facetIds = new Set();
  for (const [index, mapping] of mappings.entries()) {
    const label = `candidate clause-audit mapping[${index}]`;
    if (typeof mapping?.id !== "string" || !mapping.id) errors.push(`${label} has no ID`);
    else if (mappingIds.has(mapping.id)) errors.push(`${label} duplicates ${mapping.id}`);
    else mappingIds.add(mapping.id);
    equal(errors, `${label} mapping schema`, mapping?.mappingSchema, expectedCandidateClauseAudit.mappingRevision.schema);
    equal(errors, `${label} suite commit`, mapping?.suiteCommit, receipt?.suiteCommit);
    equal(errors, `${label} execution status`, mapping?.candidateExecutionStatus, "unexecuted");
    for (const facet of Array.isArray(mapping?.sourceFacets) ? mapping.sourceFacets : []) {
      if (typeof facet?.id !== "string" || !facet.id) errors.push(`${label} contains a facet without an ID`);
      else if (facetIds.has(facet.id)) errors.push(`${label} duplicates facet ${facet.id}`);
      else facetIds.add(facet.id);
    }
  }
  equal(errors, "candidate clause-audit mapping count", mappings.length, expectedCandidateClauseAudit.counts.mappings);
  equal(errors, "candidate clause-audit source-facet count", facetIds.size, expectedCandidateClauseAudit.counts.sourceFacets);

  const obligations = Array.isArray(audit?.reviewedObligations) ? audit.reviewedObligations : [];
  const obligationIds = new Set();
  for (const [index, obligation] of obligations.entries()) {
    const label = `candidate clause-audit obligation[${index}]`;
    if (typeof obligation?.id !== "string" || !obligation.id) errors.push(`${label} has no ID`);
    else if (obligationIds.has(obligation.id)) errors.push(`${label} duplicates ${obligation.id}`);
    else obligationIds.add(obligation.id);
    if (!mappingIds.has(obligation?.mappingId)) errors.push(`${label} names unknown mapping ${JSON.stringify(obligation?.mappingId)}`);
    for (const facetId of candidateStringArray(errors, `${label} source facet IDs`, obligation?.sourceFacetIds, { nonempty: true })) {
      if (!facetIds.has(facetId)) errors.push(`${label} names unknown source facet ${facetId}`);
    }
    equal(errors, `${label} execution status`, obligation?.candidateExecutionStatus, "unexecuted");
  }
  equal(errors, "candidate clause-audit obligation count", obligations.length, expectedCandidateClauseAudit.counts.obligations);
  validateCandidateAcceptedSliceEvidence(audit?.mappingRevision, mappings, obligations, errors);

  const expectedFacets = expectedCandidateSourceFacets();
  candidateEqualValue(errors, "candidate clause-audit flattened source facets", audit?.sourceFacets, expectedFacets);
  const expectedDocuments = new Map(Object.entries(expectedCandidateClauseAudit.mappingRevision.documents));
  const expectedGrammars = new Map(Object.entries(expectedCandidateClauseAudit.mappingRevision.grammars));
  const expectedFacetById = new Map(expectedFacets.map((facet) => [facet.id, facet]));

  const clauseCandidates = Array.isArray(audit?.clauseCandidates) ? audit.clauseCandidates : [];
  const clauseCandidateIds = new Set();
  const clauseCandidateById = new Map();
  const sourceAnchorKeys = new Set();
  for (const [index, value] of clauseCandidates.entries()) {
    const label = `candidate clause-audit clause candidate[${index}]`;
    candidateExactKeys(errors, label, value, [
      "id", "kind", "document", "path", "sha256", "section", "anchor",
      "facetId", "keywords", "textSha256", "applicability", "status",
    ]);
    if (typeof value?.id !== "string" || !value.id) errors.push(`${label} has no ID`);
    else if (clauseCandidateIds.has(value.id)) errors.push(`${label} duplicates ${value.id}`);
    else {
      clauseCandidateIds.add(value.id);
      clauseCandidateById.set(value.id, value);
    }
    if (!CANDIDATE_SHA256.test(value?.textSha256 ?? "")) errors.push(`${label} text SHA-256 is invalid`);
    validateCandidateClauseSourceRecord(label, value, expectedDocuments, errors);
    if (value?.kind === "bcp14") {
      if (!/^bcp14:[^:]+:[^:]+:[0-9a-f]{12}$/u.test(value?.id ?? "")) errors.push(`${label} BCP14 ID is invalid`);
      candidateStringArray(errors, `${label} keywords`, value?.keywords, { nonempty: true });
      equal(errors, `${label} anchor`, value?.anchor, null);
      equal(errors, `${label} facet ID`, value?.facetId, null);
      if (value?.section !== null && (typeof value?.section !== "string" || !value.section)) {
        errors.push(`${label} section is invalid`);
      }
    } else if (value?.kind === "source-facet") {
      if (typeof value?.anchor !== "string" || !value.anchor) errors.push(`${label} anchor is invalid`);
      if (typeof value?.facetId !== "string" || !value.facetId) errors.push(`${label} facet ID is invalid`);
      equal(errors, `${label} section`, value?.section, value?.anchor);
      candidateEqualValue(errors, `${label} keywords`, value?.keywords, []);
      const expectedFacet = expectedFacetById.get(value?.facetId);
      if (!expectedFacet) errors.push(`${label} names unknown source facet ${JSON.stringify(value?.facetId)}`);
      else {
        equal(errors, `${label} ID`, value?.id, `facet:${value.facetId}:${value.anchor}`);
        equal(errors, `${label} facet document`, value?.document, expectedFacet.document);
        if (!expectedFacet.anchors.includes(value?.anchor)) errors.push(`${label} anchor is outside source facet ${value.facetId}`);
        equal(errors, `${label} status`, value?.status, expectedFacet.sourceStatus);
      }
      const key = `${value?.facetId}\0${value?.document}\0${value?.path}\0${value?.sha256}\0${value?.anchor}`;
      if (sourceAnchorKeys.has(key)) errors.push(`${label} duplicates source anchor ${value?.facetId}#${value?.anchor}`);
      sourceAnchorKeys.add(key);
    } else {
      errors.push(`${label} has invalid kind ${JSON.stringify(value?.kind)}`);
    }
    equal(errors, `${label} applicability`, value?.applicability, documentApplicability[value?.document]);
    if (value?.kind === "bcp14") equal(errors, `${label} status`, value?.status, "raw-candidate-unreviewed");
    if (typeof value?.status !== "string" || !value.status) errors.push(`${label} status is invalid`);
  }
  for (const [name, value] of Object.entries(audit?.documents ?? {})) {
    const clauses = (audit?.clauseCandidates ?? []).filter((entry) => entry?.kind === "bcp14" && entry?.document === name).length;
    const anchors = (audit?.clauseCandidates ?? []).filter((entry) => entry?.kind === "source-facet" && entry?.document === name).length;
    const rules = (audit?.syntaxRules ?? []).filter((entry) => entry?.document === name).length;
    equal(errors, `candidate clause-audit document ${name} recorded BCP14 count`, value?.bcp14ClauseCandidates, clauses);
    equal(errors, `candidate clause-audit document ${name} recorded source-facet count`, value?.sourceFacetAnchors, anchors);
    equal(errors, `candidate clause-audit document ${name} recorded syntax-rule count`, value?.syntaxRules, rules);
  }
  for (const facet of expectedFacets) {
    for (const anchor of facet.anchors) {
      const key = `${facet.id}\0${facet.document}\0${facet.path}\0${facet.sha256}\0${anchor}`;
      if (!sourceAnchorKeys.has(key)) errors.push(`candidate clause-audit source-facet record is missing ${facet.id}#${anchor}`);
    }
  }

  const syntaxRules = Array.isArray(audit?.syntaxRules) ? audit.syntaxRules : [];
  const syntaxRuleIds = new Set();
  const syntaxCounts = { core: 0, nodeExpressions: 0, sparql: 0, inferenceRules: 0 };
  for (const [index, value] of syntaxRules.entries()) {
    const label = `candidate clause-audit syntax rule[${index}]`;
    candidateExactKeys(errors, label, value, ["id", "document", "path", "sha256", "rule", "textSha256", "applicability", "status"]);
    if (typeof value?.id !== "string" || !value.id) errors.push(`${label} has no ID`);
    else if (syntaxRuleIds.has(value.id)) errors.push(`${label} duplicates ${value.id}`);
    else syntaxRuleIds.add(value.id);
    validateCandidateClauseSourceRecord(label, value, expectedDocuments, errors);
    equal(errors, `${label} ID`, value?.id, `${value?.document}:${value?.rule}`);
    equal(errors, `${label} applicability`, value?.applicability, documentApplicability[value?.document]);
    equal(errors, `${label} status`, value?.status, "candidate-unexecuted");
    if (!CANDIDATE_SHA256.test(value?.textSha256 ?? "")) errors.push(`${label} text SHA-256 is invalid`);
    if (!Object.hasOwn(syntaxCounts, value?.document)) errors.push(`${label} belongs to an unexpected document`);
    else syntaxCounts[value.document] += 1;
  }
  candidateEqualValue(errors, "candidate clause-audit syntax-rule counts", syntaxCounts, expectedCandidateClauseAudit.counts.syntaxRules);

  const grammarProductions = Array.isArray(audit?.grammarProductions) ? audit.grammarProductions : [];
  const grammarProductionIds = new Set();
  const productionNumbers = new Set();
  for (const [index, value] of grammarProductions.entries()) {
    const label = `candidate clause-audit grammar production[${index}]`;
    candidateExactKeys(errors, label, value, ["id", "grammar", "path", "sha256", "number", "name", "textSha256", "status"]);
    if (typeof value?.id !== "string" || !value.id) errors.push(`${label} has no ID`);
    else if (grammarProductionIds.has(value.id)) errors.push(`${label} duplicates ${value.id}`);
    else grammarProductionIds.add(value.id);
    const expected = expectedGrammars.get(value?.grammar);
    if (!expected) errors.push(`${label} names unknown grammar ${JSON.stringify(value?.grammar)}`);
    else {
      equal(errors, `${label} path`, value?.path, expected.path);
      equal(errors, `${label} SHA-256`, value?.sha256, expected.sha256);
    }
    if (!Number.isSafeInteger(value?.number) || value.number < 1) errors.push(`${label} number is invalid`);
    else if (productionNumbers.has(value.number)) errors.push(`${label} duplicates production number ${value.number}`);
    else productionNumbers.add(value.number);
    if (!CANDIDATE_SHA256.test(value?.textSha256 ?? "")) errors.push(`${label} text SHA-256 is invalid`);
    equal(errors, `${label} ID`, value?.id, `${value?.grammar}:${value?.number}`);
    equal(errors, `${label} status`, value?.status, "candidate-unexecuted");
    if (typeof value?.name !== "string" || !value.name) errors.push(`${label} name is invalid`);
  }
  equal(errors, "candidate clause-audit grammar-production count", grammarProductionIds.size, expectedCandidateClauseAudit.counts.sparqlRlGrammarProductions);

  const joins = Array.isArray(audit?.rawObligationJoins) ? audit.rawObligationJoins : [];
  const joinIds = new Set();
  const expectedObligationById = new Map(expectedCandidateClauseAudit.obligations.map((value) => [value.id, value]));
  for (const [index, join] of joins.entries()) {
    const label = `candidate clause-audit raw obligation join[${index}]`;
    candidateExactKeys(errors, label, join, [
      "obligationId", "mappingId", "sourceFacetIds", "sourceFacets",
      "sourceStatus", "implementationStatus", "candidateExecutionStatus",
      "clauseCandidateIds", "syntaxRuleIds", "grammarProductionIds",
    ]);
    const expected = expectedObligationById.get(join?.obligationId);
    if (!expected) errors.push(`${label} names unknown obligation ${JSON.stringify(join?.obligationId)}`);
    else {
      candidateEqualValue(errors, `${label} mapping`, join?.mappingId, expected.mappingId);
      candidateEqualValue(errors, `${label} source facet IDs`, join?.sourceFacetIds, expected.sourceFacetIds);
      candidateEqualValue(errors, `${label} source status`, join?.sourceStatus, expected.sourceStatus);
      candidateEqualValue(errors, `${label} implementation status`, join?.implementationStatus, expected.implementationStatus);
      candidateEqualValue(errors, `${label} execution status`, join?.candidateExecutionStatus, expected.candidateExecutionStatus);
      candidateEqualValue(
        errors,
        `${label} source facets`,
        join?.sourceFacets,
        expected.sourceFacetIds.map((id) => {
          const facet = expectedFacetById.get(id);
          return facet && { id: facet.id, document: facet.document, path: facet.path, sha256: facet.sha256, anchors: facet.anchors };
        }),
      );
      const joinedFacets = expected.sourceFacetIds.map((id) => expectedFacetById.get(id));
      const expectedFacetClauseIds = joinedFacets.flatMap((facet) =>
        facet.anchors.map((anchor) => `facet:${facet.id}:${anchor}`),
      );
      const expectedSyntaxIds = syntaxRules
        .filter((rule) => joinedFacets.some((facet) =>
          facet.document === rule.document && facet.anchors.includes(rule.rule),
        ))
        .map(({ id }) => id);
      const expectedGrammarIds = join?.obligationId === "rules-srl-syntax-recognition"
        ? grammarProductions.map(({ id }) => id)
        : join?.obligationId === "rules-deleted-for-clause-rejection"
          ? ["sparqlRl:11", "sparqlRl:107"]
          : [];
      candidateEqualValue(
        errors,
        `${label} exact source-facet clause candidate IDs`,
        (join?.clauseCandidateIds ?? []).filter((id) => id.startsWith("facet:")),
        expectedFacetClauseIds,
      );
      candidateEqualValue(errors, `${label} exact syntax rule IDs`, join?.syntaxRuleIds, expectedSyntaxIds);
      candidateEqualValue(errors, `${label} exact grammar production IDs`, join?.grammarProductionIds, expectedGrammarIds);
    }
    if (joinIds.has(join?.obligationId)) errors.push(`${label} duplicates ${join?.obligationId}`);
    else joinIds.add(join?.obligationId);
    const clauseIds = candidateStringArray(errors, `${label} clause candidate IDs`, join?.clauseCandidateIds);
    const syntaxIds = candidateStringArray(errors, `${label} syntax rule IDs`, join?.syntaxRuleIds);
    const grammarIds = candidateStringArray(errors, `${label} grammar production IDs`, join?.grammarProductionIds);
    if (clauseIds.length + syntaxIds.length + grammarIds.length === 0) errors.push(`${label} has no raw source record identity`);
    for (const id of clauseIds) {
      if (!clauseCandidateIds.has(id)) {
        errors.push(`${label} names unknown clause candidate ${id}`);
      } else if (!id.startsWith("facet:") && clauseCandidateById.get(id)?.kind !== "bcp14") {
        errors.push(`${label} joins non-BCP14 raw clause candidate ${id}`);
      }
    }
    for (const id of syntaxIds) if (!syntaxRuleIds.has(id)) errors.push(`${label} names unknown syntax rule ${id}`);
    for (const id of grammarIds) if (!grammarProductionIds.has(id)) errors.push(`${label} names unknown grammar production ${id}`);
  }
  equal(errors, "candidate clause-audit raw obligation join count", joins.length, expectedCandidateClauseAudit.counts.obligations);
  candidateEqualValue(errors, "candidate clause-audit raw obligation join IDs", [...joinIds], expectedCandidateClauseAudit.obligations.map(({ id }) => id));

  if ((audit?.mappingRevision?.requiredBeforeAdoption ?? []).length !== 0) {
    errors.push("candidate clause-audit mapping still requires exact accepted slice evidence rebinding");
  }
  if ([...mappings, ...obligations].some((value) => String(value?.implementationStatus).includes("pending-n"))) {
    errors.push("candidate clause-audit contains a pending N implementation status");
  }
}

export function validateCandidateShaclEvidence(bundle, errors) {
  const receipt = bundle?.receipt;
  const inventory = bundle?.inventory;
  const casesArtifact = bundle?.cases;
  const auditArtifact = bundle?.audit;
  const raw = bundle?.raw;
  const checkoutPath = bundle?.checkoutPath;
  const repositoryRoot = bundle?.repositoryRoot;
  const runDirectory = bundle?.runDirectory;
  if (receipt?.kind === "clause-audit") {
    validateCandidateClauseAuditEvidence({
      receipt,
      inventory,
      audit: auditArtifact,
      runDirectory,
    }, errors);
    return;
  }
  validateCandidateShaclInventory(inventory, errors);
  candidateExactKeys(errors, "candidate receipt", receipt, [
    "schema", "kind", "suiteCommit", "implementationCommit", "runId",
    "inventoryArtifact", "casesArtifact", "lanes", "aggregateCounts",
    "sourceBefore", "sourceAfter", "complete", "errors",
    "completeConformance", "qualified", "promoted",
  ]);
  equal(errors, "candidate receipt schema", receipt?.schema, "oxigraph.shacl-candidate-run/v1");
  if (!["rust-suite", "jena-compact", "clause-audit"].includes(receipt?.kind)) {
    errors.push(`candidate receipt kind is invalid: ${JSON.stringify(receipt?.kind)}`);
  }
  if (!CANDIDATE_COMMIT.test(receipt?.implementationCommit ?? "")) {
    errors.push("candidate receipt implementation commit is not a full lowercase Git commit");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(receipt?.runId ?? "")) {
    errors.push("candidate receipt run ID is not a lowercase UUID v4");
  }
  for (const [label, actual, expected] of [
    ["inventory suite", inventory?.source?.suiteCommit, receipt?.suiteCommit],
    ["cases suite", casesArtifact?.suiteCommit, receipt?.suiteCommit],
    ["receipt suite", receipt?.suiteCommit, expectedCandidateShacl.revision.suiteCommit],
    ["inventory implementation", inventory?.source?.implementationCommit, receipt?.implementationCommit],
    ["cases implementation", casesArtifact?.implementationCommit, receipt?.implementationCommit],
    ["cases run", casesArtifact?.runId, receipt?.runId],
  ]) equal(errors, `candidate ${label}`, actual, expected);
  candidateExactKeys(errors, "candidate cases artifact", casesArtifact, [
    "schema", "suiteCommit", "implementationCommit", "runId", "cases",
  ]);
  equal(errors, "candidate inventory artifact path", receipt?.inventoryArtifact?.path, `${runDirectory}/inventory.json`);
  equal(errors, "candidate cases artifact path", receipt?.casesArtifact?.path, `${runDirectory}/cases.json`);
  equal(errors, "candidate cases schema", casesArtifact?.schema, "oxigraph.shacl-candidate-cases/v1");
  equal(errors, "candidate complete", receipt?.complete, true);
  candidateEqualValue(errors, "candidate receipt errors", receipt?.errors, []);
  equal(errors, "candidate receipt complete-conformance claim", receipt?.completeConformance, false);
  equal(errors, "candidate receipt qualified claim", receipt?.qualified, false);
  equal(errors, "candidate receipt promoted claim", receipt?.promoted, false);
  for (const [label, source] of [["before", receipt?.sourceBefore], ["after", receipt?.sourceAfter]]) {
    candidateExactKeys(errors, `candidate source ${label}`, source, ["commit", "branch", "status"]);
    equal(errors, `candidate source ${label} commit`, source?.commit, receipt?.implementationCommit);
    equal(errors, `candidate source ${label} branch`, source?.branch, "main");
    equal(errors, `candidate source ${label} status`, source?.status, "");
  }
  candidateEqualValue(errors, "candidate source identity stability", receipt?.sourceAfter, receipt?.sourceBefore);

  const declarationByIdentity = candidateCasesByIdentity(inventory);
  const observedCases = Array.isArray(casesArtifact?.cases) ? casesArtifact.cases : [];
  if (!Array.isArray(casesArtifact?.cases)) errors.push("candidate cases is not an array");
  const observedIdentities = new Set();
  const observedCounts = { discovered: 0, eligible: 0, passed: 0, unsupported: 0, failed: 0, excluded: 0 };
  for (const [index, observed] of observedCases.entries()) {
    const label = `candidate observed case[${index}]`;
    const expectedCaseKeys = [
      "kind", "file", "testId", "detail", "inventoryLane", "stableId", "id",
      "type", "status", "profileIds", "declaration", "sources", "references",
      "runnerIdentity",
      ...(receipt?.kind === "rust-suite" ? ["requiredCapability"] : []),
    ];
    candidateExactKeys(errors, label, observed, expectedCaseKeys);
    const identity = observed?.stableId;
    if (typeof identity !== "string" || !identity) errors.push(`${label} has no stableId`);
    else if (observedIdentities.has(identity)) errors.push(`${label} duplicates ${identity}`);
    else observedIdentities.add(identity);
    const declaration = declarationByIdentity.get(identity);
    if (!declaration) {
      errors.push(`${label} is not present in the bound inventory`);
      continue;
    }
    const requiredKind = CANDIDATE_OUTCOME[declaration.declaration];
    equal(errors, `${label} outcome`, observed?.kind, requiredKind);
    if (declaration.declaration === "unsupported") {
      equal(
        errors,
        `${label} unsupported detail`,
        observed?.detail,
        declaration.requiredCapability,
      );
    }
    equal(errors, `${label} inventory lane`, observed?.inventoryLane, declaration.lane);
    equal(errors, `${label} file`, observed?.file, declaration.runnerIdentity?.file);
    equal(errors, `${label} test ID`, observed?.testId, declaration.runnerIdentity?.testId);
    if (receipt?.kind === "rust-suite") {
      candidateEqualValue(
        errors,
        `${label} requiredCapability`,
        observed?.requiredCapability,
        declaration.requiredCapability,
      );
    }
    for (const field of ["id", "type", "status", "profileIds", "declaration", "sources", "references", "runnerIdentity"]) {
      candidateEqualValue(errors, `${label} ${field}`, observed?.[field], field === "references" ? declaration[field] ?? [] : declaration[field]);
    }
    observedCounts.discovered += 1;
    if (observed.kind === "EXCLUDED") observedCounts.excluded += 1;
    else {
      observedCounts.eligible += 1;
      if (observed.kind === "PASS") observedCounts.passed += 1;
      else if (observed.kind === "UNSUPPORTED") observedCounts.unsupported += 1;
      else if (observed.kind === "FAIL") observedCounts.failed += 1;
    }
  }
  validateCandidateCounts("candidate observed counts", observedCounts, errors);
  candidateEqualValue(errors, "candidate aggregate counts from cases", receipt?.aggregateCounts, observedCounts);
  validateCandidateCounts("candidate aggregate counts", receipt?.aggregateCounts, errors);

  let expectedEvidence;
  if (receipt?.kind === "rust-suite") expectedEvidence = expectedCandidateShacl.evidence.rustSuite;
  else if (receipt?.kind === "jena-compact") expectedEvidence = expectedCandidateShacl.evidence.jenaCompact;
  if (expectedEvidence) {
    candidateExactKeys(errors, "candidate receipt lanes", receipt?.lanes, Object.keys(expectedEvidence.lanes));
    const rawCases = new Map();
    for (const [name, expected] of Object.entries(expectedEvidence.lanes)) {
      const parsed = validateCandidateLaneReceipt(
        name,
        receipt?.lanes?.[name],
        expected,
        raw?.[name],
        checkoutPath,
        repositoryRoot,
        runDirectory,
        errors,
      );
      rawCases.set(name, parsed);
      const joined = observedCases
        .filter((entry) => entry?.inventoryLane === expected.inventoryLane)
        .map(({ kind, file, testId, detail }) => ({ kind, file, testId, detail }));
      candidateEqualValue(errors, `candidate lane ${name} raw/joined cases`, parsed, joined);
    }
    candidateEqualValue(errors, "candidate exact aggregate counts", receipt?.aggregateCounts, expectedEvidence.aggregateCounts);
    const expectedInventoryLanes = new Set(Object.values(expectedEvidence.lanes).map((lane) => lane.inventoryLane));
    const expectedCaseCount = Object.entries(inventory?.lanes ?? {})
      .filter(([lane]) => expectedInventoryLanes.has(lane))
      .reduce((sum, [, cases]) => sum + (Array.isArray(cases) ? cases.length : 0), 0);
    equal(errors, "candidate observed case total", observedCases.length, expectedCaseCount);
  }
}

function equal(errors, label, actual, expected) {
  if (actual !== expected) {
    errors.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function equalExactRecord(errors, label, actual, expected) {
  const actualKeys =
    actual && typeof actual === "object" && !Array.isArray(actual)
      ? Object.keys(actual).sort()
      : [];
  const expectedKeys = Object.keys(expected).sort();
  equal(
    errors,
    `${label} keys`,
    JSON.stringify(actualKeys),
    JSON.stringify(expectedKeys),
  );
  for (const key of expectedKeys) {
    equal(errors, `${label} ${key}`, actual?.[key], expected[key]);
  }
}

function validateShaclIntegrity(label, value, errors) {
  equal(
    errors,
    `${label} suite-content hash`,
    value?.suiteContentSha256,
    expectedShaclIntegrity.suiteContentSha256,
  );
  for (const [name, expected] of Object.entries(
    expectedShaclIntegrity.specificationSha256,
  )) {
    equal(
      errors,
      `${label} ${name} specification hash`,
      value?.specificationSha256?.[name],
      expected,
    );
  }
}

export function validateN3MaintenanceReceipt(value, errors) {
  const expected = expectedN3MaintenanceReceipt;
  for (const [label, actual, required] of [
    ["receipt schema", value?.schema, expected.schema],
    [
      "maintenance historical semantic commit",
      value?.transition?.historicalSemanticCommit,
      expectedHistoricalPins["w3c-n3-semantic-receipt"],
    ],
    [
      "maintenance selected commit",
      value?.transition?.selectedCommit,
      expected.commit,
    ],
    [
      "maintenance selected parent",
      value?.transition?.selectedCommitParent,
      expected.parent,
    ],
    ["maintenance transition commits", value?.transition?.commits, 2],
    [
      "maintenance transition changed paths",
      value?.transition?.changedPathsFromHistoricalCommit,
      50,
    ],
    [
      "maintenance transition diff hash",
      value?.transition?.canonicalDiffSha256FromHistoricalCommit,
      expected.historicalDiffSha256,
    ],
    [
      "maintenance transition patch id",
      value?.transition?.stablePatchIdFromHistoricalCommit,
      expected.historicalStablePatchId,
    ],
    ["maintenance selected tree", value?.selectedArtifact?.tree, expected.tree],
    [
      "maintenance changed paths",
      value?.selectedArtifact?.changedPathsAgainstParent,
      46,
    ],
    [
      "maintenance generated Java paths",
      value?.selectedArtifact?.generatedJavaPaths,
      40,
    ],
    [
      "maintenance diff hash",
      value?.selectedArtifact?.canonicalDiffSha256,
      expected.canonicalDiffSha256,
    ],
    [
      "maintenance lock hash",
      value?.selectedArtifact?.packageLockSha256,
      expected.packageLockSha256,
    ],
    [
      "independent review commit",
      value?.independentReview?.commit,
      expected.reviewCommit,
    ],
    ["independent review tree", value?.independentReview?.tree, expected.tree],
    [
      "independent review byte identity",
      value?.independentReview?.treeAndDiffByteIdentical,
      true,
    ],
    ["ANTLR npm resolution", value?.dependencies?.antlrNpm?.resolved, "4.13.2"],
    [
      "ANTLR Maven resolution",
      value?.dependencies?.antlrMavenPluginAndRuntime,
      "4.13.2",
    ],
    ["Webpack policy", value?.dependencies?.webpack?.selector, "latest"],
    ["Webpack resolution", value?.dependencies?.webpack?.resolved, "5.110.2"],
    [
      "all dependencies dev-only",
      value?.dependencies?.allDependenciesDevOnly,
      true,
    ],
    ["lifecycle scripts", value?.dependencies?.lifecycleScripts, 0],
    [
      "off-registry dependencies",
      value?.dependencies?.offRegistryDependencies,
      0,
    ],
    ["current npm audit", value?.gates?.current?.auditIncludingDev, 0],
    [
      "Node 20 floor npm audit",
      value?.gates?.node20Floor?.auditIncludingDev,
      0,
    ],
    [
      "Node 20 current npm audit",
      value?.gates?.node20Current?.auditIncludingDev,
      0,
    ],
    [
      "historical semantic receipt commit",
      value?.historicalSemanticEvidence?.sourceCommit,
      expectedHistoricalPins["w3c-n3-semantic-receipt"],
    ],
    [
      "selected commit remote reachability",
      value?.publication?.selectedCommitReachableFromConfiguredRemote,
      false,
    ],
    [
      "parent integration publication status",
      value?.publication?.parentIntegrationStatus,
      "local-only",
    ],
    [
      "semantic qualification authority",
      value?.authority?.semanticQualification,
      false,
    ],
    [
      "production qualification authority",
      value?.authority?.productionQualification,
      false,
    ],
    ["readiness authority", value?.authority?.readinessLift, false],
    ["publication authority", value?.authority?.publicationAuthority, false],
  ]) {
    equal(errors, `N3 ${label}`, actual, required);
  }
}

function idMap(values, label, errors) {
  if (!Array.isArray(values)) {
    errors.push(`${label}: expected an array`);
    return new Map();
  }
  const result = new Map();
  for (const value of values) {
    if (!value || typeof value !== "object" || typeof value.id !== "string") {
      errors.push(`${label}: every entry must have a string id`);
      continue;
    }
    if (result.has(value.id)) errors.push(`${label}: duplicate id ${value.id}`);
    result.set(value.id, value);
  }
  return result;
}

export function validateJsonDocuments(documents, errors) {
  const required = {
    "conformance-ledger.json": ["claimPolicy", "evidence", "profiles", "qualification"],
    "n3-dependency-maintenance-receipt.json": [
      "schema",
      "transition",
      "selectedArtifact",
      "independentReview",
      "dependencies",
      "gates",
      "signatureVerification",
      "historicalSemanticEvidence",
      "publication",
      "authority",
    ],
    "normative-requirements.json": ["documents", "requirements", "reviewState"],
    "standards-registry.json": ["claimPolicy", "families", "testSources"],
  };
  for (const [name, keys] of Object.entries(required)) {
    const value = documents.get(name);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`docs/research/${name}: expected a JSON object`);
      continue;
    }
    for (const key of keys) {
      if (!(key in value)) errors.push(`docs/research/${name}: missing ${key}`);
    }
  }
  for (const [name, value] of documents) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`docs/research/${name}: root must be a JSON object`);
    }
  }
  const ledger = documents.get("conformance-ledger.json");
  if (ledger && typeof ledger === "object" && !Array.isArray(ledger)) {
    equal(errors, "conformance ledger schema", ledger.schemaVersion, 2);
  }
  const n3Maintenance = documents.get("n3-dependency-maintenance-receipt.json");
  if (
    n3Maintenance &&
    typeof n3Maintenance === "object" &&
    !Array.isArray(n3Maintenance)
  ) {
    validateN3MaintenanceReceipt(n3Maintenance, errors);
  }
  const normative = documents.get("normative-requirements.json");
  if (normative && typeof normative === "object" && !Array.isArray(normative)) {
    const shaclDocuments = new Map(
      (Array.isArray(normative.documents) ? normative.documents : [])
        .filter((document) => typeof document?.id === "string")
        .map((document) => [document.id, document]),
    );
    for (const [integrityName, documentId] of [
      ["core", "shacl12-core"],
      ["nodeExpressions", "shacl12-node-expr"],
      ["sparql", "shacl12-sparql"],
      ["rules", "sparql12-rl"],
      ["compact", "shacl12-compact-syntax"],
    ]) {
      equal(
        errors,
        `normative ${documentId} hash`,
        shaclDocuments.get(documentId)?.sha256,
        expectedShaclIntegrity.specificationSha256[integrityName],
      );
    }
  }
}

export function validateLedgerCounts(ledger, errors) {
  const evidence = idMap(ledger?.evidence, "conformance ledger evidence", errors);
  const result = (id) => evidence.get(id)?.result;

  equal(errors, "Datalog passed tests", result("E-DATALOG-NATIVE")?.passed, EXPECTED.datalog);
  equal(errors, "Datalog failed tests", result("E-DATALOG-NATIVE")?.failed, 0);
  equal(errors, "semantic integration passed tests", result("E-STORE-NATIVE")?.passed, EXPECTED.semanticIntegration);
  equal(errors, "semantic integration failed tests", result("E-STORE-NATIVE")?.failed, 0);
  const supportingEvidence = evidence.get("E-SUPPORTING-PARSER-SUITES");
  const supporting = supportingEvidence?.result;
  equal(
    errors,
    "supporting parser source pins",
    JSON.stringify(supportingEvidence?.sourcePins),
    JSON.stringify([
      "jsonLdApi",
      "jsonLdStreaming",
      "n3HistoricalSemanticReceipt",
    ]),
  );
  equal(errors, "supporting wrapper passed tests", supporting?.wrapperTests?.passed, EXPECTED.supportingWrapper);
  equal(errors, "supporting wrapper failed tests", supporting?.wrapperTests?.failed, 0);
  equal(errors, "supporting N3 parser", supporting?.n3?.parser, "208/208");
  equal(errors, "supporting N3 extended", supporting?.n3?.extended, "871/871");
  equal(errors, "supporting N3 Turtle", supporting?.n3?.turtle, "296/296");
  equal(errors, "supporting JSON-LD entries", supporting?.jsonLdToRdf?.entries, 467);
  equal(errors, "supporting JSON-LD passed", supporting?.jsonLdToRdf?.passed, 446);
  equal(errors, "supporting JSON-LD exclusions", supporting?.jsonLdToRdf?.declaredExclusions, 21);
  equal(errors, "supporting streaming stable entries", supporting?.jsonLdStreaming?.stableEntries, 479);
  equal(errors, "supporting streaming passed", supporting?.jsonLdStreaming?.passed, 452);
  equal(errors, "supporting streaming failures", supporting?.jsonLdStreaming?.declaredFailures, 27);

  const n3Maintenance = evidence.get("E-N3-DEPENDENCY-MAINTENANCE");
  equal(
    errors,
    "N3 maintenance ledger source pin",
    n3Maintenance?.sourcePin,
    "n3OptionalCommunityGroupProfile",
  );
  equal(
    errors,
    "N3 maintenance ledger receipt path",
    n3Maintenance?.receipt?.path,
    expectedN3MaintenanceReceipt.path,
  );
  equal(
    errors,
    "N3 maintenance ledger receipt hash",
    n3Maintenance?.receipt?.sha256,
    expectedN3MaintenanceReceipt.sha256,
  );
  equal(
    errors,
    "N3 maintenance ledger audit including dev",
    n3Maintenance?.result?.npmAuditIncludingDev,
    0,
  );
  equal(
    errors,
    "N3 maintenance ledger production audit",
    n3Maintenance?.result?.npmAuditOmitDev,
    0,
  );

  for (const [id, label, count] of [
    ["E-RDF12-OFFICIAL", "RDF 1.2", EXPECTED.rdf],
    ["E-SPARQL12-OFFICIAL", "SPARQL 1.2", EXPECTED.sparql],
    ["E-RDFC10-OFFICIAL", "RDF canonicalization", EXPECTED.rdfc],
  ]) {
    equal(errors, `${label} cases`, result(id)?.cases, count);
    equal(errors, `${label} passed`, result(id)?.passed, count);
    equal(errors, `${label} failed`, result(id)?.failed, 0);
    equal(errors, `${label} unsupported`, result(id)?.unsupported, 0);
  }
  const semantics = result("E-RDF12-OFFICIAL")?.categories?.rdfSemanticsAggregate;
  equal(errors, "RDF Semantics aggregate cases", semantics?.cases, EXPECTED.rdfSemantics);
  equal(errors, "RDF Semantics Simple-regime cases", semantics?.simpleRegime, EXPECTED.rdfSimpleRegime);
  equal(errors, "RDF Semantics RDF-regime cases", semantics?.rdfRegime, EXPECTED.rdfRegime);
  equal(errors, "RDF Semantics RDFS-regime cases", semantics?.rdfsRegime, EXPECTED.rdfsRegime);
  equal(errors, "RDF Semantics regime subtotal", semantics?.simpleRegime + semantics?.rdfRegime + semantics?.rdfsRegime, semantics?.cases);

  const owl = evidence.get("E-OWL2RL-OFFICIAL");
  equal(errors, "OWL 2 RL RDF-based cases", owl?.inventory?.rdfBasedCases, EXPECTED.owlCases);
  equal(errors, "OWL 2 RL rule identifiers", owl?.inventory?.ruleIdentifiers, EXPECTED.owlRules);
  equal(errors, "OWL 2 RL assertions", owl?.result?.assertions, EXPECTED.owlAssertions);
  equal(errors, "OWL 2 RL passed assertions", owl?.result?.passed, EXPECTED.owlAssertions);
  equal(errors, "OWL 2 RL failed assertions", owl?.result?.failed, 0);

  const shacl = evidence.get("E-SHACL12-RUN");
  equal(errors, "SHACL discovered cases", shacl?.result?.aggregate?.discovered, EXPECTED.shaclDiscovered);
  equal(errors, "SHACL eligible cases", shacl?.result?.aggregate?.eligible, EXPECTED.shacl);
  equal(errors, "SHACL passed cases", shacl?.result?.aggregate?.passed, EXPECTED.shacl);
  equal(errors, "SHACL failed cases", shacl?.result?.aggregate?.failed, 0);
  equal(errors, "SHACL unsupported cases", shacl?.result?.aggregate?.unsupported, 0);
  equal(errors, "SHACL excluded cases", shacl?.result?.aggregate?.excluded, EXPECTED.shaclInvalid);
  equal(errors, "SHACL invalid upstream exclusions", shacl?.result?.aggregate?.invalidUpstreamExclusions, EXPECTED.shaclInvalid);
  equal(errors, "SHACL exclusion records", shacl?.upstreamExclusions?.length, EXPECTED.shaclInvalid);
  for (const [lane, expected] of [
    [
      "rootValidation",
      {
        discovered: 169,
        eligible: 167,
        passed: 167,
        failed: 0,
        unsupported: 0,
        excluded: 2,
      },
    ],
    [
      "rootNodeExpressions",
      {
        discovered: 143,
        eligible: 143,
        passed: 143,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
    ],
    [
      "legacySparqlRulesInfer",
      {
        discovered: 6,
        eligible: 6,
        passed: 6,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
    ],
    [
      "supplementalRules",
      {
        discovered: 171,
        eligible: 171,
        passed: 171,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
    ],
    [
      "informativeShaclCompact",
      {
        discovered: 32,
        eligible: 32,
        passed: 32,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
    ],
  ]) {
    for (const [field, count] of Object.entries(expected)) {
      equal(
        errors,
        `SHACL ${lane} ${field}`,
        shacl?.result?.[lane]?.[field],
        count,
      );
    }
  }

  const shaclNative = evidence.get("E-SHACL12-NATIVE");
  equal(
    errors,
    "SHACL Rust all-feature tests",
    shaclNative?.result?.allFeatures?.passed,
    EXPECTED.shaclRustAllFeatures,
  );
  equal(
    errors,
    "SHACL Rust all-feature failures",
    shaclNative?.result?.allFeatures?.failed,
    0,
  );
  equal(
    errors,
    "SHACL Rust no-default tests",
    shaclNative?.result?.noDefaultFeatures?.passed,
    EXPECTED.shaclRustNoDefault,
  );
  equal(
    errors,
    "SHACL Rust no-default failures",
    shaclNative?.result?.noDefaultFeatures?.failed,
    0,
  );

  const shaclJena = evidence.get("E-SHACL12-JENA-COMPACT");
  equal(errors, "SHACL Jena Compact discovered", shaclJena?.result?.discovered, EXPECTED.shaclJenaCompact);
  equal(errors, "SHACL Jena Compact eligible", shaclJena?.result?.eligible, EXPECTED.shaclJenaCompact);
  equal(errors, "SHACL Jena Compact passed", shaclJena?.result?.passed, EXPECTED.shaclJenaCompact);
  equal(errors, "SHACL Jena Compact failed", shaclJena?.result?.failed, 0);
  equal(errors, "SHACL Jena Compact unsupported", shaclJena?.result?.unsupported, 0);
  equal(errors, "SHACL Jena Compact excluded", shaclJena?.result?.excluded, 0);

  const cli = evidence.get("E-CLI-HTTP-NATIVE");
  equal(
    errors,
    "CLI default-feature tests",
    cli?.result?.defaultFeatures?.passed,
    EXPECTED.cliDefault,
  );
  equal(
    errors,
    "CLI default-feature failures",
    cli?.result?.defaultFeatures?.failed,
    0,
  );
  equal(
    errors,
    "CLI no-default-feature tests",
    cli?.result?.noDefaultFeatures?.passed,
    EXPECTED.cliNoDefault,
  );
  equal(
    errors,
    "CLI no-default-feature failures",
    cli?.result?.noDefaultFeatures?.failed,
    0,
  );

  const jena = evidence.get("E-JENA-PARITY");
  equal(errors, "Jena profile", jena?.profile, EXPECTED.jenaProfile);
  equal(errors, "Jena scenarios", jena?.result?.scenarios, EXPECTED.jenaScenarios);
  equal(errors, "Jena assertions", jena?.result?.assertions, EXPECTED.jenaAssertions);
  equalExactRecord(
    errors,
    "Jena scenario domains",
    jena?.result?.domains,
    EXPECTED.jenaDomains,
  );
  equalExactRecord(
    errors,
    "Jena domain assertions",
    jena?.result?.domainAssertions,
    EXPECTED.jenaDomainAssertions,
  );
  equalExactRecord(
    errors,
    "Jena classifications",
    jena?.result?.classifications,
    EXPECTED.jenaClassifications,
  );
  equal(
    errors,
    "Jena reproducibility runs",
    jena?.reproducibility?.runs,
    EXPECTED.jenaReproducibilityRuns,
  );
  equal(
    errors,
    "Jena reproducibility subject hash",
    jena?.reproducibility?.subjectSha256,
    EXPECTED.jenaSubjectSha256,
  );
  equal(
    errors,
    "Jena reproducibility profile lock hash",
    jena?.reproducibility?.profileLockSha256,
    EXPECTED.jenaProfileLockSha256,
  );
  equal(
    errors,
    "Jena reproducibility receipt hash",
    jena?.reproducibility?.receiptSha256,
    EXPECTED.jenaReceiptSha256,
  );
  equal(
    errors,
    "Jena reproducibility resolved inventory hash",
    jena?.reproducibility?.resolvedInventorySha256,
    EXPECTED.jenaResolvedInventorySha256,
  );
  equal(
    errors,
    "Jena reproducibility observations hash",
    jena?.reproducibility?.jenaObservationsSha256,
    EXPECTED.jenaObservationsSha256,
  );

  const mutation = evidence.get("E-DATALOG-MUTATION");
  equal(errors, "mutation ledger gate", mutation?.result?.gateClosed, true);
  equal(errors, "mutation ledger baseline", mutation?.result?.baselinePassed, true);
  equal(errors, "mutation ledger generated", mutation?.result?.generated, 358);
  equal(errors, "mutation ledger caught", mutation?.result?.caught, 278);
  equal(errors, "mutation ledger missed", mutation?.result?.missed, 0);
  equal(errors, "mutation ledger timeouts", mutation?.result?.timeout, 0);
  equal(errors, "mutation ledger unviable", mutation?.result?.unviable, 80);
  equal(errors, "mutation ledger run", mutation?.runId, EXPECTED.mutationRunId);
  equal(
    errors,
    "mutation ledger receipt hash",
    mutation?.receiptSha256,
    EXPECTED.mutationReceiptSha256,
  );
  equal(
    errors,
    "mutation ledger content hash",
    mutation?.contentHash,
    EXPECTED.mutationContentHash,
  );
  equal(
    errors,
    "mutation ledger execution hash",
    mutation?.executionHash,
    EXPECTED.mutationExecutionHash,
  );
  equal(
    errors,
    "mutation ledger input hash",
    mutation?.inputContentHash,
    EXPECTED.mutationInputContentHash,
  );
  equal(
    errors,
    "mutation ledger publication hash",
    mutation?.publicationContentHash,
    EXPECTED.mutationPublicationContentHash,
  );
  equal(
    errors,
    "mutation ledger native outcomes hash",
    mutation?.nativeOutcomesSha256,
    EXPECTED.mutationNativeOutcomesSha256,
  );
  equal(
    errors,
    "mutation ledger native inventory hash",
    mutation?.nativeInventorySha256,
    EXPECTED.mutationNativeInventorySha256,
  );
  equal(
    errors,
    "mutation ledger config hash",
    mutation?.configSha256,
    EXPECTED.mutationConfigSha256,
  );

  const qualification = idMap(ledger?.qualification, "conformance ledger qualification", errors);
  const agenticQualification = qualification.get("agentic-qe");
  const agentic = agenticQualification?.adapterAdversarialTests;
  equal(errors, "Agentic-QE adapter passed tests", agentic?.passed, EXPECTED.agentic);
  equal(errors, "Agentic-QE adapter failed tests", agentic?.failed, 0);
  equal(
    errors,
    "Agentic-QE semantic-gate command inventory",
    agenticQualification?.semanticGateCommandInventory,
    semanticCommandIds.length,
  );
  equal(
    errors,
    "Agentic-QE parity command inventory",
    agenticQualification?.parityCommandInventory,
    47,
  );
  equal(
    errors,
    "Agentic-QE reconciled default CLI tests",
    agenticQualification?.reconciledProfiles?.cliDefault?.passed,
    EXPECTED.cliDefault,
  );
  equal(
    errors,
    "Agentic-QE reconciled no-default CLI tests",
    agenticQualification?.reconciledProfiles?.cliNoDefault?.passed,
    EXPECTED.cliNoDefault,
  );
  const validateScopedReceipt = (label, value, expected) => {
    for (const [field, expectedValue] of Object.entries({
      passed: expected.passed,
      failed: 0,
      commands: expected.commands,
      receiptSchemaVersion: 5,
      freshnessStatus: "current-scoped-subject",
      sourceCommit: EXPECTED.agenticSubjectCommit,
      runId: expected.runId,
      receiptSha256: expected.receiptSha256,
      oracleSha256: expected.oracleSha256,
      contentHash: expected.contentHash,
      executionHash: expected.executionHash,
      worktreeDirty: true,
      independentlyReopened: true,
    })) {
      equal(errors, `Agentic-QE ${label} ${field}`, value?.[field], expectedValue);
    }
  };
  validateScopedReceipt(
    "adapter",
    agenticQualification?.reconciledProfiles?.agenticAdapter,
    {
      passed: EXPECTED.agentic,
      commands: EXPECTED.agenticAdapterCommands,
      runId: EXPECTED.agenticAdapterRunId,
      receiptSha256: EXPECTED.agenticAdapterReceiptSha256,
      oracleSha256: EXPECTED.agenticAdapterOracleSha256,
      contentHash: EXPECTED.agenticAdapterContentHash,
      executionHash: EXPECTED.agenticAdapterExecutionHash,
    },
  );
  validateScopedReceipt(
    "persistence-write",
    agenticQualification?.reconciledProfiles?.persistenceWrite,
    {
      passed: EXPECTED.agenticPersistenceWrite,
      commands: EXPECTED.agenticPersistenceCommands,
      runId: EXPECTED.agenticPersistenceRunId,
      receiptSha256: EXPECTED.agenticPersistenceReceiptSha256,
      oracleSha256: EXPECTED.agenticPersistenceOracleSha256,
      contentHash: EXPECTED.agenticPersistenceContentHash,
      executionHash: EXPECTED.agenticPersistenceExecutionHash,
    },
  );
  validateScopedReceipt(
    "G1 regression",
    agenticQualification?.reconciledProfiles?.g1Regression,
    {
      passed: EXPECTED.agenticG1,
      commands: EXPECTED.agenticG1Commands,
      runId: EXPECTED.agenticG1RunId,
      receiptSha256: EXPECTED.agenticG1ReceiptSha256,
      oracleSha256: EXPECTED.agenticG1OracleSha256,
      contentHash: EXPECTED.agenticG1ContentHash,
      executionHash: EXPECTED.agenticG1ExecutionHash,
    },
  );
}

export function validateDependencyClaims(
  ledger,
  { agenticQe, darwin },
  errors,
) {
  const qualification = idMap(
    ledger?.qualification,
    "conformance ledger qualification",
    errors,
  );
  for (const [label, pinName, qualificationId, resolution] of [
    ["Agentic-QE", "agenticQe", "agentic-qe", agenticQe],
    ["Darwin", "darwin", "metaharness-darwin", darwin],
  ]) {
    const pin = ledger?.reviewedPins?.[pinName];
    const row = qualification.get(qualificationId);
    equal(errors, `${label} pin policy`, pin?.policy, resolution?.policy);
    equal(errors, `${label} pin resolution`, pin?.resolved, resolution?.version);
    equal(
      errors,
      `${label} pin integrity`,
      pin?.integrity,
      resolution?.integrity,
    );
    equal(
      errors,
      `${label} qualification policy`,
      row?.versionPolicy,
      resolution?.policy,
    );
    equal(
      errors,
      `${label} qualification resolution`,
      row?.resolvedVersion,
      resolution?.version,
    );
    equal(
      errors,
      `${label} qualification integrity`,
      row?.lockIntegrity,
      resolution?.integrity,
    );
  }
}

function requirementsClosed(normative) {
  const requirements = Array.isArray(normative?.requirements) ? normative.requirements : [];
  const documentsEqual = normative?.reviewState?.documentCoverage?.setEquality === true;
  return (
    requirements.length > 0 &&
    documentsEqual &&
    requirements.every((item) => ["pass", "not-applicable"].includes(item?.disposition))
  );
}

export function validateNormativeClaims(normative, ledger, errors) {
  const requirements = Array.isArray(normative?.requirements) ? normative.requirements : [];
  const review = normative?.reviewState ?? {};
  const evidenceIds = new Set(
    (Array.isArray(ledger?.evidence) ? ledger.evidence : [])
      .map((item) => item?.id)
      .filter((id) => typeof id === "string"),
  );
  const counts = {};
  for (const requirement of requirements) {
    const disposition = requirement?.disposition;
    counts[disposition] = (counts[disposition] ?? 0) + 1;
    for (const evidenceId of requirement?.evidence ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        errors.push(
          `normative requirement ${requirement?.id ?? "<unknown>"} references unknown evidence ${evidenceId}`,
        );
      }
    }
  }
  equal(errors, "normative grouped requirement total", review?.groupedRequirementCoverage?.total, requirements.length);
  for (const [state, count] of Object.entries(review?.dispositionCounts ?? {})) {
    equal(errors, `normative disposition ${state}`, count, counts[state] ?? 0);
  }
  const familyByDocument = new Map(
    (normative?.documents ?? []).map((document) => [document.id, document.family]),
  );
  const profiles = idMap(ledger?.profiles, "conformance ledger profiles", errors);
  for (const [family, profileId] of [["rdf-1.2", "rdf12-w3c"], ["sparql-1.2", "sparql12-w3c"], ["shacl-1.2", "shacl12-w3c"]]) {
    const scoped = requirements.filter((item) => familyByDocument.get(item.document) === family);
    if (!scoped.length) continue;
    const applicable = scoped.filter((item) => item.disposition !== "not-applicable");
    const closedCount = applicable.filter((item) => item.disposition === "pass").length;
    const coverage = profiles.get(profileId)?.normativeCoverage;
    equal(errors, `${family} grouped requirements`, review?.groupedRequirementCoverage?.[family], scoped.length);
    equal(errors, `${family} applicable requirements`, coverage?.applicableRequirements, applicable.length);
    equal(errors, `${family} closed requirements`, coverage?.closedRequirements, closedCount);
    equal(errors, `${family} unresolved requirements`, coverage?.unresolvedRequirements, applicable.length - closedCount);
  }

  const closed = requirementsClosed(normative);
  if (review?.clauseEnumerationComplete === true && !closed) {
    errors.push("normative clauseEnumerationComplete is true while obligations remain unresolved");
  }
  if (
    review?.claimReady === true &&
    !(review?.clauseEnumerationComplete === true && closed)
  ) {
    errors.push("normative claimReady is true without complete, closed obligations");
  }
  if (!closed) {
    equal(errors, "normative claimReady", review?.claimReady, false);
    equal(errors, "normative clauseEnumerationComplete", review?.clauseEnumerationComplete, false);
    equal(errors, "normative umbrella claim", review?.umbrellaClaim, "withheld");
    equal(errors, "ledger umbrella claim", ledger?.claimPolicy?.currentUmbrellaClaim, "withheld");
    for (const profile of ledger?.profiles ?? []) {
      if (profile?.normativeFamilyParity === true) {
        errors.push(`profile ${profile.id ?? "<unknown>"} claims family parity before obligation closure`);
      }
    }
  }
}

export function validateRegistryPins(registry, ledger, heads, errors) {
  const sources = idMap(registry?.testSources, "standards registry testSources", errors);
  for (const [id, expected] of Object.entries(expectedPins)) {
    equal(errors, `${id} registry pin`, sources.get(id)?.commit, expected);
    if (heads[id] !== undefined) equal(errors, `${id} checkout HEAD`, heads[id], expected);
  }
  equal(errors, "ledger RDF/SPARQL pin", ledger?.reviewedPins?.rdfAndSparqlTests?.commit, expectedPins["w3c-rdf-tests"]);
  equal(errors, "ledger SHACL pin", ledger?.reviewedPins?.shaclSpecificationsAndTests?.commit, expectedPins["w3c-data-shapes"]);
  validateShaclIntegrity(
    "registry SHACL",
    sources.get("w3c-data-shapes"),
    errors,
  );
  validateShaclIntegrity(
    "ledger SHACL",
    ledger?.reviewedPins?.shaclSpecificationsAndTests,
    errors,
  );
  equal(errors, "ledger RDF canonicalization pin", ledger?.reviewedPins?.rdfCanonTests?.commit, expectedPins["w3c-rdf-canon-tests"]);
  equal(errors, "ledger JSON-LD API pin", ledger?.reviewedPins?.jsonLdApi, expectedPins["w3c-json-ld-api"]);
  equal(
    errors,
    "ledger JSON-LD streaming pin",
    ledger?.reviewedPins?.jsonLdStreaming,
    expectedPins["w3c-json-ld-streaming"],
  );
  equal(
    errors,
    "ledger N3 pin",
    ledger?.reviewedPins?.n3OptionalCommunityGroupProfile,
    expectedPins["w3c-n3"],
  );
  equal(
    errors,
    "registry N3 historical semantic receipt pin",
    sources.get("w3c-n3")?.historicalSemanticAudit?.sourceCommit,
    expectedHistoricalPins["w3c-n3-semantic-receipt"],
  );
  equal(
    errors,
    "ledger N3 historical semantic receipt pin",
    ledger?.reviewedPins?.n3HistoricalSemanticReceipt,
    expectedHistoricalPins["w3c-n3-semantic-receipt"],
  );
  equal(
    errors,
    "registry N3 maintenance receipt path",
    sources.get("w3c-n3")?.dependencyMaintenanceReceipt?.path,
    expectedN3MaintenanceReceipt.path,
  );
  equal(
    errors,
    "registry N3 maintenance receipt hash",
    sources.get("w3c-n3")?.dependencyMaintenanceReceipt?.sha256,
    expectedN3MaintenanceReceipt.sha256,
  );
}

function normalizeDocument(text) {
  return text
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_#|[\]()>]/g, " ")
    .replace(/&(?:nbsp|mdash|ndash);/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const pair = (value) =>
  new RegExp(
    `(?:\\b${value}\\s*(?:/|of)\\s*${value}\\b|\\b${value}\\b[^.]{0,100}\\b${value}\\b)`,
    "i",
  );
export const documentClaims = Object.freeze([
  { id: "Datalog", label: /\b(?:OxDatalog|Datalog D0.?D2)\b/i, tokens: [/\b70(?:\s*\/\s*70)?\b[^.]{0,55}\btests?\b/i], window: 420 },
  { id: "RDF 1.2", label: /\bRDF 1\.2\b/i, tokens: [pair(575)], window: 460 },
  { id: "SPARQL 1.2", label: /\bSPARQL 1\.2\b/i, tokens: [pair(269)], window: 460 },
  { id: "RDF canonicalization", label: /\bRDF (?:Dataset )?Canonicalization(?: 1\.0)?\b/i, tokens: [/(?:86\s*(?:\/|of)\s*86|\b86[- ]tests?\b)/i], window: 460 },
  { id: "RDF Semantics aggregate", label: /\bRDF 1\.2 Semantics\b/i, tokens: [pair(77)], window: 460 },
  { id: "OWL 2 RL", label: /\bOWL 2 RL(?:\/RDF)?\b/i, tokens: [pair(98), /\b68\b[^.]{0,80}\bcases?\b/i, /\b78\b[^.]{0,80}\brule/i], window: 720 },
  { id: "SHACL 1.2", label: /\bSHACL 1\.2\b/i, tokens: [pair(519), /(?:\b2\b|two)[^.]{0,100}\binvalid\b/i], window: 680 },
  { id: "Jena", label: /\b(?:Apache )?Jena 6\.1\.0\b/i, tokens: [/\b76\b[^.]{0,90}\bscenarios?\b/i, /\b198\b[^.]{0,90}\bassertions?\b/i], window: 680 },
  { id: "Agentic-QE", label: /\bAgentic-QE\b/i, tokens: [pair(40)], window: 500 },
  { id: "semantic integration", label: /\b(?:semantic store integration|semantic-integration|semantic profile integration|store integration)\b/i, tokens: [/(?:4\s*(?:\/|of)\s*4|\b4\b[^.]{0,80}\btests?\b)/i], window: 460 },
]);

export function validateDocumentClaims(name, text, claims, errors) {
  const normalized = normalizeDocument(text);
  for (const claim of claims) {
    const flags = claim.label.flags.includes("g") ? claim.label.flags : `${claim.label.flags}g`;
    const label = new RegExp(claim.label.source, flags);
    const matches = [...normalized.matchAll(label)];
    if (matches.length === 0) {
      errors.push(`${name}: missing labelled ${claim.id} evidence`);
      continue;
    }
    const valid = matches.some((match) => {
      const excerpt = claim.documentWide
        ? normalized
        : normalized.slice(match.index, match.index + claim.window);
      return claim.tokens.every((token) => token.test(excerpt));
    });
    if (!valid) errors.push(`${name}: ${claim.id} evidence does not contain the current exact count`);
  }
}

export function validateAdrIndex(index, adrNames, errors) {
  const targets = [...index.matchAll(/\[[^\]]+]\(([^)#?]+\.md)(?:#[^)]+)?\)/g)]
    .map((match) => match[1])
    .filter((target) => /^\d{4}-[^/]+\.md$/.test(target));
  const listed = new Set(targets);
  for (const target of targets) {
    if (!adrNames.has(target)) errors.push(`docs/adr/README.md: missing target ${target}`);
  }
  for (const name of adrNames) {
    if (/^\d{4}-.*\.md$/.test(name) && !listed.has(name)) {
      errors.push(`docs/adr/README.md: ADR is not indexed: ${name}`);
    }
  }
}

export function validateFullReceipts(receipts, errors) {
  const jena = receipts.jena;
  if (jena) {
    equal(errors, "Jena receipt gate", jena.gate_closed, true);
    equal(errors, "Jena receipt profile", jena.profile_id, EXPECTED.jenaProfile);
    equal(
      errors,
      "Jena receipt subject hash",
      jena.subject_sha256,
      EXPECTED.jenaSubjectSha256,
    );
    equal(errors, "Jena receipt scenarios", jena.counts?.scenarios, EXPECTED.jenaScenarios);
    equal(errors, "Jena receipt assertions", jena.counts?.assertions, EXPECTED.jenaAssertions);
    equalExactRecord(
      errors,
      "Jena receipt scenario domains",
      jena.counts?.domains,
      EXPECTED.jenaDomains,
    );
    equalExactRecord(
      errors,
      "Jena receipt classifications",
      jena.counts?.classifications,
      EXPECTED.jenaClassifications,
    );
    equal(errors, "Jena receipt scenario rows", jena.scenarios?.length, EXPECTED.jenaScenarios);
    equal(
      errors,
      "Jena receipt assertion row sum",
      jena.scenarios?.reduce((sum, item) => sum + (item?.assertion_count ?? 0), 0),
      EXPECTED.jenaAssertions,
    );
    const rows = Array.isArray(jena.scenarios) ? jena.scenarios : [];
    const domains = {};
    const domainAssertions = {};
    const classifications = {};
    for (const row of rows) {
      domains[row?.domain] = (domains[row?.domain] ?? 0) + 1;
      domainAssertions[row?.domain] =
        (domainAssertions[row?.domain] ?? 0) + (row?.assertion_count ?? 0);
      classifications[row?.classification] =
        (classifications[row?.classification] ?? 0) + 1;
    }
    equalExactRecord(
      errors,
      "Jena receipt derived scenario domains",
      domains,
      EXPECTED.jenaDomains,
    );
    equalExactRecord(
      errors,
      "Jena receipt derived domain assertions",
      domainAssertions,
      EXPECTED.jenaDomainAssertions,
    );
    equalExactRecord(
      errors,
      "Jena receipt derived classifications",
      classifications,
      EXPECTED.jenaClassifications,
    );
  }

  const shaclInventory = receipts.shaclInventory;
  if (shaclInventory) {
    equal(errors, "SHACL inventory schema", shaclInventory.schemaVersion, 1);
    equal(
      errors,
      "SHACL inventory source pin",
      shaclInventory.source?.commit,
      expectedPins["w3c-data-shapes"],
    );
    validateShaclIntegrity(
      "SHACL inventory",
      shaclInventory.integrity,
      errors,
    );
    equal(
      errors,
      "SHACL inventory TTL files",
      shaclInventory.inventory?.ttlFiles,
      347,
    );
    equal(
      errors,
      "SHACL inventory manifest files",
      shaclInventory.inventory?.manifestFiles,
      25,
    );
    equal(
      errors,
      "SHACL inventory approved entries",
      shaclInventory.inventory?.statuses?.approved,
      318,
    );
    equal(
      errors,
      "SHACL inventory Rules TTL files",
      shaclInventory.inventory?.categories?.rules?.ttlFiles,
      36,
    );
    equal(
      errors,
      "SHACL inventory SRL fixture files",
      shaclInventory.inventory?.rulesEvidence?.srlFixtureFiles,
      166,
    );
    equal(
      errors,
      "SHACL inventory Rules manifest entries",
      shaclInventory.inventory?.rulesEvidence?.manifestEntries,
      171,
    );
    const rulesManifestTypes =
      shaclInventory.inventory?.rulesEvidence?.manifestTypes;
    equal(
      errors,
      "SHACL inventory Rules syntax entries",
      (rulesManifestTypes?.RulesPositiveSyntaxTest ?? 0) +
        (rulesManifestTypes?.RulesNegativeSyntaxTest ?? 0),
      138,
    );
    equal(
      errors,
      "SHACL inventory Rules well-formedness entries",
      (rulesManifestTypes?.RulesPositiveWellFormednessTest ?? 0) +
        (rulesManifestTypes?.RulesNegativeWellFormednessTest ?? 0),
      8,
    );
    equal(
      errors,
      "SHACL inventory Rules stratification entries",
      (rulesManifestTypes?.RulesPositiveStratificationTest ?? 0) +
        (rulesManifestTypes?.RulesNegativeStratificationTest ?? 0),
      9,
    );
    equal(
      errors,
      "SHACL inventory Rules evaluation entries",
      rulesManifestTypes?.RulesEvalTest,
      16,
    );
    equal(
      errors,
      "SHACL inventory Rules root reachability",
      shaclInventory.inventory?.rulesEvidence?.rootReachable,
      false,
    );
    equal(
      errors,
      "SHACL inventory Rules approval",
      shaclInventory.inventory?.rulesEvidence?.mfApproval,
      "unspecified",
    );
    equal(
      errors,
      "SHACL inventory Compact pairs",
      shaclInventory.inventory?.compactSyntaxEvidence?.sourceExpectedPairs,
      32,
    );
    equal(
      errors,
      "SHACL inventory Compact grammar hash",
      shaclInventory.inventory?.compactSyntaxEvidence?.grammarSha256,
      expectedShaclIntegrity.grammarSha256,
    );
    equal(
      errors,
      "SHACL inventory Compact normative status",
      shaclInventory.inventory?.compactSyntaxEvidence?.normative,
      false,
    );
  }

  const shacl = receipts.shacl;
  if (shacl) {
    equal(errors, "SHACL receipt discovered", shacl.aggregateCounts?.discovered, EXPECTED.shaclDiscovered);
    equal(errors, "SHACL receipt eligible", shacl.aggregateCounts?.eligible, EXPECTED.shacl);
    equal(errors, "SHACL receipt passed", shacl.aggregateCounts?.passed, EXPECTED.shacl);
    equal(errors, "SHACL receipt failed", shacl.aggregateCounts?.failed, 0);
    equal(errors, "SHACL receipt unsupported", shacl.aggregateCounts?.unsupported, 0);
    equal(errors, "SHACL receipt exclusions", shacl.aggregateCounts?.excluded, EXPECTED.shaclInvalid);
    const expectedLanes = {
      validate: {
        discovered: 169,
        eligible: 167,
        passed: 167,
        failed: 0,
        unsupported: 0,
        excluded: 2,
      },
      nodeExpressions: {
        discovered: 143,
        eligible: 143,
        passed: 143,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
      sparqlRulesInfer: {
        discovered: 6,
        eligible: 6,
        passed: 6,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
      srlRules: {
        discovered: 171,
        eligible: 171,
        passed: 171,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
      compactSyntax: {
        discovered: 32,
        eligible: 32,
        passed: 32,
        failed: 0,
        unsupported: 0,
        excluded: 0,
      },
    };
    equal(
      errors,
      "SHACL receipt exact lane inventory",
      JSON.stringify(Object.keys(shacl.lanes ?? {}).sort()),
      JSON.stringify(Object.keys(expectedLanes).sort()),
    );
    for (const [lane, expectedCounts] of Object.entries(expectedLanes)) {
      for (const [field, expected] of Object.entries(expectedCounts)) {
        equal(
          errors,
          `SHACL receipt ${lane} ${field}`,
          shacl.lanes?.[lane]?.counts?.[field],
          expected,
        );
      }
    }
    const lanes = Object.values(shacl.lanes ?? {});
    if (lanes.length === 0) {
      errors.push("SHACL receipt has no separately classified lanes");
    } else {
      for (const field of [
        "discovered",
        "eligible",
        "passed",
        "failed",
        "unsupported",
        "excluded",
      ]) {
        const sum = lanes.reduce((total, lane) => total + (lane?.counts?.[field] ?? 0), 0);
        equal(errors, `SHACL receipt lane ${field} sum`, sum, shacl.aggregateCounts?.[field]);
      }
    }
  }

  const shaclJenaCompact = receipts.shaclJenaCompact;
  if (shaclJenaCompact) {
    equal(errors, "SHACL Jena Compact schema", shaclJenaCompact.schemaVersion, 1);
    equal(
      errors,
      "SHACL Jena Compact source pin",
      shaclJenaCompact.source?.commit,
      expectedPins["w3c-data-shapes"],
    );
    equal(
      errors,
      "SHACL Jena Compact suite hash",
      shaclJenaCompact.source?.suiteContentSha256,
      expectedShaclIntegrity.suiteContentSha256,
    );
    equal(
      errors,
      "SHACL Jena Compact grammar hash",
      shaclJenaCompact.source?.grammarSha256,
      expectedShaclIntegrity.grammarSha256,
    );
    for (const [field, expected] of Object.entries({
      discovered: 32,
      eligible: 32,
      passed: 32,
      failed: 0,
      unsupported: 0,
      excluded: 0,
    })) {
      equal(
        errors,
        `SHACL Jena Compact ${field}`,
        shaclJenaCompact.counts?.[field],
        expected,
      );
    }
  }

  const agentic = receipts.agentic;
  if (agentic) {
    equal(errors, "Agentic-QE receipt schema", agentic.schemaVersion, 5);
    equal(errors, "Agentic-QE receipt profile", agentic.profile, "metaharness-semantic-gate");
    equal(errors, "Agentic-QE receipt passed", agentic.passed, true);
    equal(errors, "Agentic-QE implementation stability", agentic.implementation?.stable, true);
    equal(errors, "Agentic-QE artifact completeness", agentic.artifacts?.complete, true);
    equal(errors, "Agentic-QE archive completeness", agentic.artifacts?.archive?.complete, true);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        agentic.runId ?? "",
      )
    ) {
      errors.push("Agentic-QE receipt runId is not a UUIDv4");
    }
    if (!/^[a-f0-9]{64}$/.test(agentic.contentHash ?? "")) {
      errors.push("Agentic-QE receipt contentHash is not SHA-256");
    }
    if (!/^[a-f0-9]{64}$/.test(agentic.executionHash ?? "")) {
      errors.push("Agentic-QE receipt executionHash is not SHA-256");
    }
    const commands = Array.isArray(agentic.commands) ? agentic.commands : [];
    if (
      JSON.stringify(commands.map((command) => command?.id)) !==
      JSON.stringify(semanticCommandIds)
    ) {
      errors.push(
        `Agentic-QE receipt must contain the exact ordered ${semanticCommandIds.length}-command semantic inventory`,
      );
    }
    for (const command of commands) {
      if (command?.code !== 0 || command?.timedOut !== false) {
        errors.push(`Agentic-QE command ${command?.id ?? "<unknown>"} is not closed`);
      }
    }
    const adapter = commands.find((command) => command?.id === "agenticAdapter");
    equal(errors, "Agentic-QE adapter observed tests", adapter?.testSafeguard?.observedPassedTests, EXPECTED.agentic);
    equal(errors, "Agentic-QE adapter count safeguard", adapter?.testSafeguard?.passed, true);
    const supporting = commands.find(
      (command) => command?.id === "supportingParserSuites",
    );
    equal(errors, "supporting-suite wrapper tests", supporting?.testSafeguard?.observedPassedTests, EXPECTED.supportingWrapper);
    equal(errors, "supporting-suite wrapper safeguard", supporting?.testSafeguard?.passed, true);
  }

  const mutation = receipts.mutation;
  if (mutation) {
    equal(errors, "mutation gate", mutation.gateClosed, true);
    equal(errors, "mutation baseline", mutation.baselinePassed, true);
    equal(errors, "mutation missed", mutation.counts?.missed, 0);
    equal(errors, "mutation timeouts", mutation.counts?.timeout, 0);
    equal(
      errors,
      "mutation count conservation",
      mutation.counts?.generated,
      (mutation.counts?.caught ?? 0) +
        (mutation.counts?.missed ?? 0) +
        (mutation.counts?.timeout ?? 0) +
        (mutation.counts?.unviable ?? 0),
    );
  }

  const meta = receipts.meta;
  if (meta) {
    equal(errors, "MetaHarness mode", meta.mode, "synthetic-and-semantic-gate");
    equal(errors, "MetaHarness passed", meta.passed, true);
    equal(
      errors,
      "MetaHarness real gate",
      trustedRealGateValid(meta.realGate),
      true,
    );
    equal(
      errors,
      "MetaHarness Agentic temporal binding",
      agenticGeneratedWithinQualificationWindow(meta, agentic),
      true,
    );
    equal(errors, "MetaHarness protected inputs stable", meta.inputs?.protectedInputsStable, true);
    for (const gate of ["solve", "regression", "safety", "cost", "reproducibility"]) {
      equal(errors, `MetaHarness ${gate} gate`, meta.gates?.[gate], true);
    }
  }
  if (receipts.metaVerification) {
    equal(errors, "MetaHarness independent verification", receipts.metaVerification.verified, true);
    equal(
      errors,
      "MetaHarness verification content binding",
      receipts.metaVerification.qualification?.contentHash,
      meta?.contentHash,
    );
  }
}
