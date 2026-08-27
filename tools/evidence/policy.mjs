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
  agentic: 18,
  agenticPersistenceWrite: 34,
  agenticPersistenceCommands: 7,
  agenticPersistenceRunId: "47a995c5-5cf0-4cf6-baaf-8b0cfa44a149",
  agenticPersistenceReceiptSha256:
    "e965c63fd696c3bdd2f50c6f6028e15d53d6567fa8d64cdfa4d2c10615b864a0",
  agenticPersistenceContentHash:
    "2561ffb02391d5d0b36bf3c29e91b75d27244e4abddcfedb49e2d7927f7471a8",
  agenticPersistenceExecutionHash:
    "1de5ea6f38a4ee0e266228ac1ff875526f5138233de193b14a1f9e5dcadc2814",
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
  "w3c-n3": "b975fc59ab5d2ad2d28e7206f1c34c716977d2ad",
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
      ["rules", "shacl12-rules"],
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
  const supporting = result("E-SUPPORTING-PARSER-SUITES");
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
  equal(
    errors,
    "Agentic-QE persistence-write tests",
    agenticQualification?.reconciledProfiles?.persistenceWrite?.passed,
    EXPECTED.agenticPersistenceWrite,
  );
  equal(
    errors,
    "Agentic-QE persistence-write commands",
    agenticQualification?.reconciledProfiles?.persistenceWrite?.commands,
    EXPECTED.agenticPersistenceCommands,
  );
  equal(
    errors,
    "Agentic-QE persistence-write run",
    agenticQualification?.reconciledProfiles?.persistenceWrite?.runId,
    EXPECTED.agenticPersistenceRunId,
  );
  equal(
    errors,
    "Agentic-QE persistence-write receipt hash",
    agenticQualification?.reconciledProfiles?.persistenceWrite?.receiptSha256,
    EXPECTED.agenticPersistenceReceiptSha256,
  );
  equal(
    errors,
    "Agentic-QE persistence-write content hash",
    agenticQualification?.reconciledProfiles?.persistenceWrite?.contentHash,
    EXPECTED.agenticPersistenceContentHash,
  );
  equal(
    errors,
    "Agentic-QE persistence-write execution hash",
    agenticQualification?.reconciledProfiles?.persistenceWrite?.executionHash,
    EXPECTED.agenticPersistenceExecutionHash,
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
  { id: "Agentic-QE", label: /\bAgentic-QE\b/i, tokens: [pair(18)], window: 500 },
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
