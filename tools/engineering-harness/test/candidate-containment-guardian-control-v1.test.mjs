import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REQUIREMENTS_URL = new URL(
  "../../../docs/adr/fixtures/0036-guardian-control-requirements-v1.json",
  import.meta.url,
);
const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-control-v1.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const EVALUATOR_PATH = fileURLToPath(import.meta.url);
const NODE_20_0_MISSING_CANDIDATE_MESSAGE = `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`;
const REQUIREMENTS_ORACLE = JSON.parse(readFileSync(REQUIREMENTS_URL, "utf8"));

const EXPECTED_REQUIREMENTS_SHA256 =
  "0f244f7242eb40a615245a5eda77d5380e368f43a8382f27b3cdb5c1a387e499";
const EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY =
  "additional-non-index-string-and-symbol-properties-ignored-without-enumeration-inspection-read-write-or-invocation;own-length-rejected;semantics-derived-only-from-immediate-intrinsic-copy-of-indexed-bytes/v1";
const EXPECTED_NORMAL_MAP_SHA256 =
  "1f2bcfca0089977fc1c5fdde2bfcfa6eed671e839a2daee87b5c19d3c2b4fffb";
const EXPECTED_RECOVERY_MAP_SHA256 =
  "620b125181725cff59b7d11d08f193250f9046d3aec4021016418d0ab42d4594";
const EXPECTED_RIGHT_MAP_SHA256 =
  "082b09e65c5b58c92a909f27e3f9dd8b83e4833885e35846a31ace14c82744a2";
const EXPECTED_ACORN = Object.freeze({
  version: "8.18.0",
  integrity:
    "sha512-lGq+9yr1/GuAWaVYIHRjvvySG5/4VfKIvC8EWxStPdcDh/Ka7FG3twP6v4d5BkravUilhIAsG4Qj83t02LWUPQ==",
  license: "MIT",
  packageJsonSha256:
    "5c1ed7259579a7899b303f514b0194adcb9fe474fc7d136a84c6a45f10eefc84",
  importEntrypoint: "./dist/acorn.mjs",
  importEntrypointSha256:
    "953573b8fdab71599749ea5f2b33d3e760c2116178f9423ee7458dbe39d59453",
});
const ACORN_PARSE_OPTIONS = Object.freeze({
  ecmaVersion: 2022,
  sourceType: "module",
  allowAwaitOutsideFunction: false,
  allowHashBang: false,
  allowReturnOutsideFunction: false,
  preserveParens: true,
});
const ACORN_PACKAGE_URL = new URL(
  "../node_modules/acorn/package.json",
  import.meta.url,
);
const ACORN_IMPORT_ENTRYPOINT_URL = new URL(
  EXPECTED_ACORN.importEntrypoint,
  ACORN_PACKAGE_URL,
);

function pinParserDependencyBeforeCandidateRead() {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  const lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const installedPackageBytes = readFileSync(ACORN_PACKAGE_URL);
  const installed = JSON.parse(installedPackageBytes.toString("utf8"));
  assert.deepEqual(manifest.devDependencies, { acorn: "latest" });
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
  const locked = lock.packages["node_modules/acorn"];
  assert.deepEqual(
    {
      version: locked?.version,
      integrity: locked?.integrity,
      license: locked?.license,
    },
    {
      version: EXPECTED_ACORN.version,
      integrity: EXPECTED_ACORN.integrity,
      license: EXPECTED_ACORN.license,
    },
  );
  assert.equal(Object.hasOwn(locked, "dependencies"), false);
  assert.deepEqual(
    { version: installed.version, license: installed.license },
    { version: EXPECTED_ACORN.version, license: EXPECTED_ACORN.license },
  );
  assert.equal(
    byteSha256(installedPackageBytes),
    EXPECTED_ACORN.packageJsonSha256,
  );
  assert.equal(
    installed.exports?.["."]?.[0]?.import,
    EXPECTED_ACORN.importEntrypoint,
  );
  assert.equal(
    byteSha256(readFileSync(ACORN_IMPORT_ENTRYPOINT_URL)),
    EXPECTED_ACORN.importEntrypointSha256,
  );
  return Object.freeze({
    completedBeforeCandidateRead: true,
    policy: manifest.devDependencies.acorn,
    ...EXPECTED_ACORN,
  });
}

const SYNCHRONOUS_PARSER_AUDIT = pinParserDependencyBeforeCandidateRead();
const acornModule = await import(ACORN_IMPORT_ENTRYPOINT_URL.href);
assert.equal(acornModule.version, EXPECTED_ACORN.version);
assert.equal(typeof acornModule.parse, "function");
const parse = acornModule.parse;
const PARSER_LOAD_AUDIT = Object.freeze({
  completedAfterIdentityPin: true,
  completedBeforeCandidateRead: true,
  entrypoint: EXPECTED_ACORN.importEntrypoint,
  version: acornModule.version,
});

function parseCandidateModuleAst(source) {
  let program;
  try {
    program = parse(source, ACORN_PARSE_OPTIONS);
  } catch (error) {
    throw new Error(
      `static gate: invalid ECMAScript module syntax: ${error.message}`,
    );
  }
  assert.equal(program.type, "Program");
  assert.equal(program.sourceType, "module");
  const stack = [program];
  const visited = new WeakSet();
  let nodeCount = 0;
  while (stack.length > 0) {
    const node = stack.pop();
    if (visited.has(node)) continue;
    visited.add(node);
    nodeCount += 1;
    if (
      node.type === "AwaitExpression" ||
      (node.type === "ForOfStatement" && node.await === true)
    ) {
      throw new Error("static gate: await syntax forbidden");
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child !== null && typeof child?.type === "string")
            stack.push(child);
        }
      } else if (value !== null && typeof value?.type === "string") {
        stack.push(value);
      }
    }
  }
  return Object.freeze({ program, nodeCount });
}

const EXPECTED_EXPORTS = Object.freeze([
  "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS",
  "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256",
  "createCandidateContainmentGuardianStartupV1",
  "createCandidateContainmentGuardianAdmissionInputV1",
  "createCandidateContainmentGuardianCancelInputV1",
  "createCandidateContainmentGuardianRecoveryRequestInputV1",
  "createCandidateContainmentGuardianControllerClosedInputV1",
  "createCandidateContainmentGuardianDiagnosticFailureInputV1",
  "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
  "createCandidateContainmentGuardianStatusEofInputV1",
  "initializeCandidateContainmentGuardianControlV1",
  "reduceCandidateContainmentGuardianControlV1",
  "verifyCandidateContainmentGuardianStatusFrameV1",
]);

const EXPECTED_FUNCTION_SIGNATURES = Object.freeze([
  Object.freeze({
    name: "createCandidateContainmentGuardianStartupV1",
    parameters: Object.freeze([
      "startupReportBytes",
      "epochBytes",
      "epochEofObserved",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianAdmissionInputV1",
    parameters: Object.freeze([
      "currentState",
      "admissionFrameBytes",
      "recvmsgReportBytes",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianCancelInputV1",
    parameters: Object.freeze([
      "currentState",
      "cancelFrameBytes",
      "messageTruncated",
      "controlTruncated",
      "controlMessageCount",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianRecoveryRequestInputV1",
    parameters: Object.freeze([
      "currentState",
      "recoveryRequestFrameBytes",
      "requestEofObserved",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianControllerClosedInputV1",
    parameters: Object.freeze(["currentState"]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianDiagnosticFailureInputV1",
    parameters: Object.freeze([
      "currentState",
      "diagnosticSummaryReportBytes",
      "rawDiagnosticBytes",
    ]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
    parameters: Object.freeze(["currentState"]),
  }),
  Object.freeze({
    name: "createCandidateContainmentGuardianStatusEofInputV1",
    parameters: Object.freeze(["currentState"]),
  }),
  Object.freeze({
    name: "initializeCandidateContainmentGuardianControlV1",
    parameters: Object.freeze(["startupProjection"]),
  }),
  Object.freeze({
    name: "reduceCandidateContainmentGuardianControlV1",
    parameters: Object.freeze(["currentState", "brandedInput"]),
  }),
  Object.freeze({
    name: "verifyCandidateContainmentGuardianStatusFrameV1",
    parameters: Object.freeze(["startupProjection", "statusFrameBytes"]),
  }),
]);

const EXPECTED_EXPORT_MANIFEST = Object.freeze([
  Object.freeze({
    name: "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS",
    kind: "const",
    arity: null,
  }),
  Object.freeze({
    name: "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256",
    kind: "const",
    arity: null,
  }),
  ...EXPECTED_FUNCTION_SIGNATURES.map(({ name, parameters }) =>
    Object.freeze({ name, kind: "function", arity: parameters.length }),
  ),
]);

const EXPECTED_PRIVATE_STORE_COMMITS = Object.freeze([
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStartupV1",
    storeName: "startupMetadata",
  }),
  ...[
    "createCandidateContainmentGuardianAdmissionInputV1",
    "createCandidateContainmentGuardianCancelInputV1",
    "createCandidateContainmentGuardianRecoveryRequestInputV1",
    "createCandidateContainmentGuardianControllerClosedInputV1",
    "createCandidateContainmentGuardianDiagnosticFailureInputV1",
    "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
    "createCandidateContainmentGuardianStatusEofInputV1",
  ].map((functionName) =>
    Object.freeze({ functionName, storeName: "inputMetadata" }),
  ),
  ...[
    "initializeCandidateContainmentGuardianControlV1",
    "reduceCandidateContainmentGuardianControlV1",
  ].map((functionName) =>
    Object.freeze({ functionName, storeName: "stateMetadata" }),
  ),
]);

const PRIVATE_STORE_OWNER_BY_FUNCTION = new Map(
  EXPECTED_PRIVATE_STORE_COMMITS.map(({ functionName, storeName }) => [
    functionName,
    storeName,
  ]),
);

const EXPECTED_PRIVATE_STORE_LOOKUPS = Object.freeze([
  Object.freeze({
    functionName: "initializeCandidateContainmentGuardianControlV1",
    storeName: "startupMetadata",
    keyParameterName: "startupProjection",
  }),
  Object.freeze({
    functionName: "verifyCandidateContainmentGuardianStatusFrameV1",
    storeName: "startupMetadata",
    keyParameterName: "startupProjection",
  }),
  ...[
    "createCandidateContainmentGuardianAdmissionInputV1",
    "createCandidateContainmentGuardianCancelInputV1",
    "createCandidateContainmentGuardianRecoveryRequestInputV1",
    "createCandidateContainmentGuardianControllerClosedInputV1",
    "createCandidateContainmentGuardianDiagnosticFailureInputV1",
    "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
    "createCandidateContainmentGuardianStatusEofInputV1",
  ].map((functionName) =>
    Object.freeze({
      functionName,
      storeName: "stateMetadata",
      keyParameterName: "currentState",
    }),
  ),
  Object.freeze({
    functionName: "reduceCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    keyParameterName: "currentState",
  }),
  Object.freeze({
    functionName: "reduceCandidateContainmentGuardianControlV1",
    storeName: "inputMetadata",
    keyParameterName: "brandedInput",
  }),
]);
const PRIVATE_LOOKUP_POLICY_BY_FUNCTION_STORE = new Map(
  EXPECTED_PRIVATE_STORE_LOOKUPS.map((entry) => [
    `${entry.functionName}\u0000${entry.storeName}`,
    entry,
  ]),
);
assert.equal(EXPECTED_PRIVATE_STORE_LOOKUPS.length, 11);
assert.equal(PRIVATE_LOOKUP_POLICY_BY_FUNCTION_STORE.size, 11);

const EXPECTED_REQUIREMENTS_TOP_LEVEL_FIELDS = Object.freeze([
  "schema",
  "version",
  "predecessors",
  "schemas",
  "limits",
  "modes",
  "startupMaps",
  "admissionRights",
  "frameFields",
  "vocabularies",
  "legalSequences",
  "privateStateStores",
  "authority",
  "physicalFacts",
  "nonclaims",
]);

function assertPinnedRequirementsOracleForStaticPolicy() {
  assert.equal(
    REQUIREMENTS_ORACLE !== null &&
      typeof REQUIREMENTS_ORACLE === "object" &&
      !Array.isArray(REQUIREMENTS_ORACLE),
    true,
  );
  assert.equal(
    semanticSha256(REQUIREMENTS_ORACLE),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.schema,
    "oxigraph.candidate-containment-guardian-control-requirements/v1",
  );
  assert.equal(REQUIREMENTS_ORACLE.version, 1);
  assert.deepEqual(
    Object.keys(REQUIREMENTS_ORACLE),
    EXPECTED_REQUIREMENTS_TOP_LEVEL_FIELDS,
  );
  return REQUIREMENTS_ORACLE;
}

// Source-policy allowlists may only be derived after this synchronous pin.
// The later node:test repeats the checks as independently visible evidence.
const STATIC_POLICY_REQUIREMENTS_ORACLE =
  assertPinnedRequirementsOracleForStaticPolicy();

const EXPANSION_ANCHORS = Object.freeze({
  namedExports: 13,
  wholeTransitionAndStateGoldens: 20,
  emittedStatusByteGoldens: 15,
  atomicTwoStatusInternalPrefixControls: 4,
  completeSequenceWireFrameCounts: Object.freeze({
    N1: 4,
    N2: 6,
    N3: 3,
    N4: 5,
    N5a: 2,
    N5b: 4,
    R1: 3,
    R2: 3,
  }),
  terminalEventCounts: Object.freeze({
    N1: 5,
    N2: 7,
    N3: 5,
    N4: 7,
    N5a: 4,
    N5b: 6,
    R1: 5,
    R2: 5,
  }),
});

const EXPECTED_MATERIALIZED_STATUS_FRAME_FIELDS = Object.freeze([
  "schema",
  "action",
  "mode",
  "sequence",
  "previousFrameSha256",
  "requirementsSha256",
  "startupSha256",
  "epochSha256",
  "state",
  "admissionFrameSha256",
  "recoveryRequestFrameSha256",
  "terminalReason",
]);
const EXPECTED_MATERIALIZED_STATUS_ENTRY_DIGESTS = Object.freeze([
  Object.freeze({
    id: "emitted-status-byte-00",
    frameSha256:
      "edb6895fe23a0862b0d8e99c6915567622199ae260d32a6066f4033afe750f5e",
    rawSha256:
      "50dd61c048bf89b9c7bdd14fb269ca032f7129b0eeda18d47e4f0ef730c8e91f",
    identitySha256:
      "cec89783bc76b6e67cb1d57ff9e452d8d44b0c342f72d30f855f5605982d1024",
  }),
  Object.freeze({
    id: "emitted-status-byte-01",
    frameSha256:
      "40f48560c823eff17a4dc2798798ea0a198b803194b1e103533226d7918b44a5",
    rawSha256:
      "0f266cbf8085670bf5f04bb24f375095232e036d8cc5b0fa75bd7a5205b2064d",
    identitySha256:
      "1dd8b29ff9bb1bf2c69997f8dcd010506b344e7a3467e8922f2a1eba4b18bd49",
  }),
  Object.freeze({
    id: "emitted-status-byte-02",
    frameSha256:
      "9a2c66ef3dc4fcb6dca88b3a7bfefd4cf2ff4da0fdc3af79153983030061b59d",
    rawSha256:
      "59dcc9bd09b16f2f81f1ce89c0d283b9fe733799d34bcd8f1a83d30375f3a4de",
    identitySha256:
      "4970e65dbe175dc58ef45bd0626d102b3944451861a0f09f494a920764a887c3",
  }),
  Object.freeze({
    id: "emitted-status-byte-03",
    frameSha256:
      "c5508bef6fbbc738caa92d11e9c2d5353d9ee793715de1f471f68aba1f9b0345",
    rawSha256:
      "50208e22fcb8808ebfe6d32734a7a3054da4c10e0f8084331f455ff78c388de0",
    identitySha256:
      "212c94e1cbcb3016adae65b22dd32d41e11b4608957c73eeb54bc6db899bc67a",
  }),
  Object.freeze({
    id: "emitted-status-byte-04",
    frameSha256:
      "87cd122e04f649f18bb287d32b67571c93fdff2d39b93571848ff1fca347304e",
    rawSha256:
      "970cfda692bc7f1212d398b9c0db19a100fc5c60be91bc5a42a8728f14474fc3",
    identitySha256:
      "349807613a7f942bd6dea09fbf1264a53d653edb30706442c59840b417f0fdc4",
  }),
  Object.freeze({
    id: "emitted-status-byte-05",
    frameSha256:
      "ba2799bbbbd4c4eccb8369bae8493cd6bdb5483f6fd4255be64ebd10a76cdaf7",
    rawSha256:
      "1136a1f92fe3a29ff71738fc6558ffedb6914d591f0b5d19f389399cba8f7b62",
    identitySha256:
      "5afa4223e46a0d9c0d273face2ab7302a6fa332fcaa3d9d3b98da7d798ef7991",
  }),
  Object.freeze({
    id: "emitted-status-byte-06",
    frameSha256:
      "506f3dbc68fa1dd140699fd4ef68fb4e44a9a27019e4a991094f9910cc4d441c",
    rawSha256:
      "d4de93c414d6c421408dc3fb858bc56fa4e987fed4fd3e98eb9983bda223141e",
    identitySha256:
      "beb48e22bc0ffc0d49d217dbe3f2be4e1400579214427f134a6186a2bf3b2c58",
  }),
  Object.freeze({
    id: "emitted-status-byte-07",
    frameSha256:
      "2280149c20d13c97c689f755c8247fcdc34f6abf05b60088ff25c7fce9e01b0e",
    rawSha256:
      "616927a88cae6d6b1fdee85f70927324fed23a7d1a8ec2659f08516e5aa8a9d8",
    identitySha256:
      "685a25e74b8d19504298675d6a50711e8200d55d34d138fb1574c6f8f23c66e3",
  }),
  Object.freeze({
    id: "emitted-status-byte-08",
    frameSha256:
      "756c13d0c8ab97af961a07202e265e1deebb4901c018198b348b8efbe5f9b3fc",
    rawSha256:
      "2bdff765b3f4bcf1afde64b0ebcdc6df45bf4a2a1cd184ca3494a0cb4380c3c1",
    identitySha256:
      "9d93ca3c68b87a831fdf75d00f1e29da9966f24ffe363c09a3d1bb0a2d0f13f7",
  }),
  Object.freeze({
    id: "emitted-status-byte-09",
    frameSha256:
      "25b99423a4f44ed2db739e48d1cc7ee309035c7ab504f65a7c8abf8ad3d8f224",
    rawSha256:
      "37c3afe9aac6e48fe7c05c97041d3fb464ded1c9264ff6fe194785ede2b69831",
    identitySha256:
      "a52f9ead6789752dd99ec4dbdddc4075a8623b5350e02e3ebefc9508f4d7248d",
  }),
  Object.freeze({
    id: "emitted-status-byte-10",
    frameSha256:
      "5e97b53029fe430edd096e020d85e434d0b4b7db68c74afce68d053e85ccbda8",
    rawSha256:
      "007e1192642b1165dda19089af909e1532fa5b1534d3979b92b04edb409b4869",
    identitySha256:
      "1bace9ac1065fa5df7ed35c7483f4aa3be711b79f24d2782894d1130f10f2415",
  }),
  Object.freeze({
    id: "emitted-status-byte-11",
    frameSha256:
      "e1ee298eb52f405e8d4e49c6300453e830009d041a828928a7a6edf000c330a6",
    rawSha256:
      "2a547f6435c0b405d19049d9af68afec5d465716f31edb3996c4da79d86e825d",
    identitySha256:
      "004ec0e68f90ac906eb33d330d203e9895ca8930380a4bc0b018d94aa5f35ab2",
  }),
  Object.freeze({
    id: "emitted-status-byte-12",
    frameSha256:
      "a1f8e21b88ddad6f624130979f5108e64aa673dfca75f4048fb27d9cdef9e444",
    rawSha256:
      "4dd5816d7407b2d2495b5424a53c740055f43f0969accb000f825ac6f77f44bc",
    identitySha256:
      "e528ab5673fc5b804f8407e70a38d7fc86394593a31366d3024539fb0e269148",
  }),
  Object.freeze({
    id: "emitted-status-byte-13",
    frameSha256:
      "5cdec0b9bb4bafa4ffd2d9a3c17e1ee4f73153329409a220c9123edfbf85da93",
    rawSha256:
      "459818f5b8a17ae8f0ecfcfc9fa93495405e3e6cfae886c06b5a8b340e8f9c7e",
    identitySha256:
      "a2e964b88302a6b2621b4c898b4864095b29f23af8b69751d82fd707dca50a58",
  }),
  Object.freeze({
    id: "emitted-status-byte-14",
    frameSha256:
      "b373f9b91f7119d52355030f909caf30ce8331ea647ffa97230131ca7dd8e6ba",
    rawSha256:
      "5810d72d9091658f81b7b45c0ab019c0954306d96b4fd6f141d9b7978f300054",
    identitySha256:
      "7cf75981bb46ae6035de624582fda2e525f2f6642ce19de3a9d2de0b0c050a5e",
  }),
]);
const EXPECTED_MATERIALIZED_ATOMIC_ENTRY_DIGESTS = Object.freeze([
  Object.freeze({
    id: "atomic-two-status-wire-prefix-00",
    concatenatedRawSha256:
      "c3f40f6e60994b8136bc9682fd6868882318e7ccf717284221b428cecdd84b77",
    identitySha256:
      "e78e57bf892bd874944e5595d4ea3fe948d924b931cde8e5c8e00d36f3ee09f7",
  }),
  Object.freeze({
    id: "atomic-two-status-wire-prefix-01",
    concatenatedRawSha256:
      "186f006c63b529f25a6ce363d391fdc054f3581d0713f8839aef69e6318ece62",
    identitySha256:
      "c92229fba9ad435b54dd47636c58ecc6a07833e22d09e9e9ce98ea8c3e52fd36",
  }),
  Object.freeze({
    id: "atomic-two-status-wire-prefix-02",
    concatenatedRawSha256:
      "6a58191f299e0cd18588bd3587409d93da53e73e05fee2e11d09ca0904bd40b7",
    identitySha256:
      "8c96a1bdea1ba0cf6a0fafe67ca44748ac13a0663af2523e988d910b639ce4c8",
  }),
  Object.freeze({
    id: "atomic-two-status-wire-prefix-03",
    concatenatedRawSha256:
      "dc8487106a97106c1ef808bbe4d896e0c097940d84864ed64007c3b007ef32d1",
    identitySha256:
      "7abf9a7f2094913630148b755a2ad9799dc55833f60dd50ba001369565c503da",
  }),
]);
const EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256 = Object.freeze({
  emittedStatusByteGoldens:
    "d871cbce866d934a6d30d8c1062e30f93b8a250b772b5284da50b83514fc4762",
  atomicTwoStatusWirePrefixes:
    "c6735a0da37cdaf3d6e9775dcb5dffc47f039e08df7d8db0adcf0313499479d4",
});
const EXPECTED_MATERIALIZED_DESIGN_PROJECTION_SHA256 = Object.freeze({
  statuses: "6e03baa638cd3b48221e9182d9de1dd74a9a7b454fce40719badb3d0d9b7de5e",
  atomicPrefixes:
    "a2b9524c88bbd78aca2d189c150a9e5499c0da3505c9109734ce78f0fa038ba1",
});
const EXPECTED_MATERIALIZED_STATUS_CONTEXT_SHA256 =
  "fd008c99ac11e32de80c25399d5a8d34bb6ab4832c6e58e969b84993b7470f23";
const EXPECTED_MATERIALIZED_STATUS_ORACLE_SHA256 =
  "57872372c67c5ad4580ed2945512fc5c7ec0923b121690c2a2927604608b3583";

// Independently measured from the five ratified files. The fixture is verified
// against these constants, never used to supply them.
const PREDECESSOR_SOURCE_GOLDENS = Object.freeze([
  Object.freeze({
    kind: "direct",
    specifier: "./containment-exact-v2.mjs",
    byteLength: 10_833,
    sha256: "2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3",
  }),
  Object.freeze({
    kind: "direct",
    specifier: "./containment-guardian-recovery-v1.mjs",
    byteLength: 143_143,
    sha256: "e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d",
  }),
  Object.freeze({
    kind: "direct",
    specifier: "./containment-launch-capsule-v3.mjs",
    byteLength: 17_977,
    sha256: "9579d8b66a81a09be1efc60e2f23e930070dda66175273548fcf1d3e9d23c41d",
  }),
  Object.freeze({
    kind: "evidenceOnly",
    specifier: "./containment-supervisor-control-v2.mjs",
    byteLength: 31_785,
    sha256: "92cfae3b2e6b8e2ee196d7c5a21c760ae5d35d4f5335263a5ffc816fc2a80842",
  }),
  Object.freeze({
    kind: "evidenceOnly",
    specifier: "./containment-supervisor-preflight-v4.mjs",
    byteLength: 60_224,
    sha256: "747c913e60768c53bdeeec923a6ff2f1319121d743bddd8e4db663c1a03d23ff",
  }),
]);

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite oracle value");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object") throw new TypeError("non-JSON oracle value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function semanticSha256(value) {
  return createHash("sha256")
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex");
}

function byteSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const AST_EVIDENCE_OMITTED_FIELDS = new Set([
  "end",
  "loc",
  "range",
  "raw",
  "sourceFile",
  "start",
]);

function normalizeAstForEvidence(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeAstForEvidence);
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !AST_EVIDENCE_OMITTED_FIELDS.has(key))
      .sort()
      .map((key) => [key, normalizeAstForEvidence(value[key])]),
  );
}

function recursivelyFreezeEvidence(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    recursivelyFreezeEvidence(value[key], seen);
  }
  return Object.freeze(value);
}

function assertRecursivelyFrozenWithoutByteViews(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(ArrayBuffer.isView(value), false);
  assert.equal(value instanceof ArrayBuffer, false);
  if (typeof SharedArrayBuffer === "function") {
    assert.equal(value instanceof SharedArrayBuffer, false);
  }
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertRecursivelyFrozenWithoutByteViews(value[key], seen);
  }
}

function collectNonPrimitiveObjectReferences(value, references = new Set()) {
  if (value === null || typeof value !== "object" || references.has(value)) {
    return references;
  }
  references.add(value);
  for (const key of Reflect.ownKeys(value)) {
    collectNonPrimitiveObjectReferences(value[key], references);
  }
  return references;
}

function countSharedNonPrimitiveObjectReferences(left, right) {
  const rightReferences = collectNonPrimitiveObjectReferences(right);
  return [...collectNonPrimitiveObjectReferences(left)].filter((reference) =>
    rightReferences.has(reference),
  ).length;
}

function assertPinnedPredecessorBytes(bytes, golden) {
  if (
    bytes.length !== golden.byteLength ||
    byteSha256(bytes) !== golden.sha256
  ) {
    throw new Error(`predecessor source pin mismatch: ${golden.specifier}`);
  }
}

function predecessorByteMutations(bytes) {
  assert.equal(bytes.length > 2, true);
  const mutations = [];
  for (const index of [0, Math.floor(bytes.length / 2), bytes.length - 1]) {
    const mutated = Buffer.from(bytes);
    mutated[index] ^= 1;
    mutations.push(mutated);
  }
  mutations.push(Buffer.concat([bytes, Buffer.from([0x0a])]));
  mutations.push(Buffer.from(bytes.subarray(0, bytes.length - 1)));
  return Object.freeze(mutations);
}

function assertRequirementsValue(actual, expected) {
  if (expected === null || typeof expected !== "object") {
    assert.equal(actual, expected);
    return;
  }
  assert.equal(Object.isFrozen(actual), true);
  if (Array.isArray(expected)) {
    assert.equal(Array.isArray(actual), true);
    assert.equal(Object.getPrototypeOf(actual), Array.prototype);
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < expected.length; index += 1) {
      assertRequirementsValue(actual[index], expected[index]);
    }
    return;
  }
  assert.equal(Object.getPrototypeOf(actual), null);
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const key of Object.keys(expected)) {
    assertRequirementsValue(actual[key], expected[key]);
  }
}

function assertCandidateModuleContract(moduleNamespace) {
  assert.equal(Object.getPrototypeOf(moduleNamespace), null);
  assert.equal(Object.isExtensible(moduleNamespace), false);
  assert.deepEqual(Reflect.ownKeys(moduleNamespace), [
    ...[...EXPECTED_EXPORTS].sort(),
    Symbol.toStringTag,
  ]);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(moduleNamespace, Symbol.toStringTag),
    {
      value: "Module",
      writable: false,
      enumerable: false,
      configurable: false,
    },
  );
  for (const { name, kind, arity } of EXPECTED_EXPORT_MANIFEST) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(moduleNamespace, name), {
      value: moduleNamespace[name],
      writable: true,
      enumerable: true,
      configurable: false,
    });
    if (kind !== "function") continue;
    const value = moduleNamespace[name];
    assert.equal(typeof value, "function");
    assert.equal(value.name, name);
    assert.equal(value.length, arity);
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, "name"), {
      value: name,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    assert.deepEqual(Object.getOwnPropertyDescriptor(value, "length"), {
      value: arity,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    const prototype = Object.getOwnPropertyDescriptor(value, "prototype");
    assert.equal(typeof prototype.value, "object");
    assert.equal(Object.getPrototypeOf(prototype.value), Object.prototype);
    assert.deepEqual(
      {
        writable: prototype.writable,
        enumerable: prototype.enumerable,
        configurable: prototype.configurable,
      },
      { writable: true, enumerable: false, configurable: false },
    );
  }
  assert.equal(
    moduleNamespace.CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256,
    EXPECTED_REQUIREMENTS_SHA256,
  );
  const requirements =
    moduleNamespace.CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS;
  assertRequirementsValue(requirements, REQUIREMENTS_ORACLE);
  assert.deepEqual(requirements, REQUIREMENTS_ORACLE);
  assert.equal(semanticSha256(requirements), EXPECTED_REQUIREMENTS_SHA256);
}

function startupDescriptor(
  fd,
  role,
  kind,
  accessMode,
  direction,
  statusFlags,
  currentOffset,
  {
    socketFamily = null,
    socketType = null,
    connected = null,
    lockHeld = null,
  } = {},
) {
  return Object.freeze({
    fd,
    role,
    kind,
    accessMode,
    closeOnExec: false,
    direction,
    statusFlags,
    openFileDescriptionClass: fd,
    byteBinding: "NONE",
    currentOffset,
    socketFamily,
    socketType,
    connected,
    lockHeld,
  });
}

// Independently authored from ADR-0036. These are not read from the candidate
// module or copied out of the normative requirements fixture.
const NORMAL_STARTUP_MAP_GOLDEN = Object.freeze([
  startupDescriptor(
    0,
    "controllerChannel",
    "unix-seqpacket",
    "O_RDWR",
    "BIDIRECTIONAL",
    "NONE",
    null,
    {
      socketFamily: "AF_UNIX",
      socketType: "SOCK_SEQPACKET",
      connected: true,
    },
  ),
  startupDescriptor(
    1,
    "statusWrite",
    "pipe",
    "O_WRONLY",
    "GUARDIAN_TO_MANAGER",
    "NONE",
    null,
  ),
  startupDescriptor(
    2,
    "diagnosticsWrite",
    "pipe",
    "O_WRONLY",
    "GUARDIAN_TO_MANAGER",
    "NONE",
    null,
  ),
  startupDescriptor(
    3,
    "stateRoot",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
    { lockHeld: true },
  ),
  startupDescriptor(
    4,
    "delegatedRoot",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
  ),
  startupDescriptor(
    5,
    "guardianLifetimeCgroup",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
  ),
  startupDescriptor(
    6,
    "epochRead",
    "pipe",
    "O_RDONLY",
    "MANAGER_TO_GUARDIAN",
    "NONE",
    null,
  ),
  startupDescriptor(
    7,
    "supervisorExecutable",
    "regular",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE",
    0,
  ),
]);

const RECOVERY_STARTUP_MAP_GOLDEN = Object.freeze([
  startupDescriptor(
    0,
    "recoveryRequestRead",
    "pipe",
    "O_RDONLY",
    "MANAGER_TO_GUARDIAN",
    "NONE",
    null,
  ),
  startupDescriptor(
    1,
    "statusWrite",
    "pipe",
    "O_WRONLY",
    "GUARDIAN_TO_MANAGER",
    "NONE",
    null,
  ),
  startupDescriptor(
    2,
    "diagnosticsWrite",
    "pipe",
    "O_WRONLY",
    "GUARDIAN_TO_MANAGER",
    "NONE",
    null,
  ),
  startupDescriptor(
    3,
    "stateRoot",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
    { lockHeld: true },
  ),
  startupDescriptor(
    4,
    "delegatedRoot",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
  ),
  startupDescriptor(
    5,
    "recoveryActorLifetimeCgroup",
    "directory",
    "O_RDONLY",
    "NONE",
    "O_LARGEFILE|O_DIRECTORY",
    null,
  ),
  startupDescriptor(
    6,
    "epochRead",
    "pipe",
    "O_RDONLY",
    "MANAGER_TO_GUARDIAN",
    "NONE",
    null,
  ),
  null,
]);

const RIGHT_ROLES = Object.freeze([
  "childExecutable",
  "childStdin",
  "supervisorSelf",
  "payloadSandboxWorker",
  "payloadProcess",
  "payloadBuildCommand",
  "payloadEvidenceLimits",
  "payloadSessionLimits",
  "payloadTaskFailures",
  "payloadRoutingFeatures",
  "payloadSeccompLauncher",
  "launchArgv",
  "launchEnvironment",
  "childResult",
]);

const ADMISSION_RIGHT_MAP_GOLDEN = Object.freeze(
  RIGHT_ROLES.map((role, index) =>
    Object.freeze({
      index,
      role,
      targetSupervisorFd: index + 4,
      kind: "regular",
      accessMode: index === 13 ? "O_RDWR" : "O_RDONLY",
      closeOnExec: true,
      statusFlags: "O_LARGEFILE",
      openFileDescriptionClass: index + 8,
      byteBinding: "MATCH_LAUNCH_CAPSULE_V3_ROLE",
      currentOffset: 0,
    }),
  ),
);

const ALLOWED_IMPORTS = new Map([
  [
    "./containment-exact-v2.mjs",
    [
      "boundedInteger",
      "canonicalJsonBytes",
      "canonicalJsonLine",
      "copyBoundedBuffer",
      "decodeCanonicalBase64",
      "decodeCanonicalJsonLine",
      "deepFreeze",
      "exactBoolean",
      "exactDigest",
      "exactRecord",
      "frozenCopyOnReadBytes",
      "nullRecord",
      "sha256",
    ],
  ],
  [
    "./containment-guardian-recovery-v1.mjs",
    [
      "CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1",
      "CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1",
    ],
  ],
  [
    "./containment-launch-capsule-v3.mjs",
    [
      "CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3",
      "CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3",
      "verifyCandidateContainmentLaunchCapsuleV3",
    ],
  ],
]);

const ALLOWED_AMBIENT_INTRINSICS = Object.freeze([
  "Array",
  "Boolean",
  "Error",
  "Number",
  "Object",
  "Reflect",
  "Set",
  "String",
  "WeakMap",
]);

const FORBIDDEN_SOURCE_IDENTIFIERS = Object.freeze([
  "ArrayBuffer",
  "AsyncFunction",
  "AsyncGeneratorFunction",
  "Atomics",
  "BigInt64Array",
  "BigUint64Array",
  "BroadcastChannel",
  "Buffer",
  "Bun",
  "DataView",
  "Date",
  "Deno",
  "EventSource",
  "FinalizationRegistry",
  "Float32Array",
  "Float64Array",
  "Function",
  "GeneratorFunction",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "JSON",
  "Math",
  "MessageChannel",
  "MessagePort",
  "Promise",
  "Proxy",
  "SharedArrayBuffer",
  "SharedWorker",
  "TextDecoder",
  "TextEncoder",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "WeakRef",
  "WeakSet",
  "WebAssembly",
  "WebSocket",
  "Worker",
  "XMLHttpRequest",
  "__dirname",
  "__filename",
  "__proto__",
  "arguments",
  "atob",
  "btoa",
  "clearImmediate",
  "clearInterval",
  "clearTimeout",
  "console",
  "constructor",
  "crypto",
  "eval",
  "fetch",
  "global",
  "globalThis",
  "module",
  "navigator",
  "performance",
  "process",
  "prototype",
  "queueMicrotask",
  "require",
  "setImmediate",
  "setInterval",
  "setTimeout",
  "structuredClone",
]);

const FORBIDDEN_MEMBER_NAMES = Object.freeze([
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
  "arguments",
  "callee",
  "caller",
  "constructor",
  "prototype",
]);

const FORBIDDEN_EXACT_COMPILE_TIME_STRINGS = new Set(
  [
    ...FORBIDDEN_SOURCE_IDENTIFIERS,
    ...FORBIDDEN_MEMBER_NAMES,
    "OPENROUTER_API_KEY",
    "openrouter",
  ].map((value) => value.toLowerCase()),
);

const FORBIDDEN_COMPILE_TIME_PATH_PREFIXES = Object.freeze([
  "file://",
  "node:",
  "/proc/",
]);

const FORBIDDEN_COMPILE_TIME_PATH_SUFFIXES = Object.freeze([
  "OPENROUTER_API_KEY",
  "candidate-containment-guardian-control-v1.test.mjs",
  "candidate-containment-guardian-control-v1-adversarial.test.mjs",
]);

const ASSIGNMENT_OPERATORS = new Set([
  "=",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "**=",
  "<<=",
  ">>=",
  ">>>=",
  "&=",
  "^=",
  "|=",
  "&&=",
  "||=",
  "??=",
]);

const PURE_MODULE_INITIALIZER_CALL_ARITIES = new Map([
  ["canonicalJsonBytes", 1],
  ["deepFreeze", 1],
  ["nullRecord", 1],
  ["sha256", 1],
]);

const SOURCE_KEYWORDS = new Set([
  "break",
  "case",
  "catch",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "export",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "import",
  "let",
  "new",
  "null",
  "of",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "typeof",
  "void",
  "while",
]);

const ALLOWED_AMBIENT_MEMBERS = new Map([
  ["Array", new Set(["isArray"])],
  ["Boolean", new Set()],
  ["Error", new Set()],
  ["Number", new Set(["isFinite", "isInteger", "isSafeInteger"])],
  [
    "Object",
    new Set([
      "create",
      "defineProperty",
      "freeze",
      "hasOwn",
      "isExtensible",
      "isFrozen",
    ]),
  ],
  ["Reflect", new Set()],
  ["Set", new Set()],
  ["String", new Set()],
  ["WeakMap", new Set()],
]);

function collectOracleRecordKeys(value, keys = new Set()) {
  if (value === null || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const child of value) collectOracleRecordKeys(child, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectOracleRecordKeys(child, keys);
  }
  return keys;
}

function collectOracleSourceLiterals(value, literals = new Set()) {
  if (typeof value === "string") {
    literals.add(value);
    return literals;
  }
  if (value === null || typeof value !== "object") return literals;
  if (Array.isArray(value)) {
    for (const child of value) collectOracleSourceLiterals(child, literals);
    return literals;
  }
  for (const [key, child] of Object.entries(value)) {
    literals.add(key);
    collectOracleSourceLiterals(child, literals);
  }
  return literals;
}

const PINNED_NORMATIVE_SOURCE_LITERALS = collectOracleSourceLiterals(
  STATIC_POLICY_REQUIREMENTS_ORACLE,
);

const ALLOWED_MEMBER_NAMES = new Set([
  ...collectOracleRecordKeys(STATIC_POLICY_REQUIREMENTS_ORACLE),
  ...Object.values(STATIC_POLICY_REQUIREMENTS_ORACLE.frameFields).flat(),
  "add",
  "artifact",
  "at",
  "binding",
  "byteLength",
  "bytes",
  "files",
  "get",
  "has",
  "identity",
  "includes",
  "initialOffset",
  "length",
  "name",
  "projectionSha256",
  "push",
  "rawSha256",
  "set",
  "sha256",
  "size",
  "slice",
  "value",
]);

const UNTRUSTED_PUBLIC_PARAMETER_NAMES = new Set(
  EXPECTED_FUNCTION_SIGNATURES.flatMap(({ parameters }) => parameters),
);

function lexCandidateSource(source) {
  if (typeof source !== "string") throw new Error("static gate: source");
  const tokens = [];
  let index = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  const fail = (reason) => {
    throw new Error(`static gate: ${reason}`);
  };
  const push = (type, value, start, end) => {
    tokens.push(
      Object.freeze({
        type,
        value,
        raw: source.slice(start, end),
        start,
        end,
        braceDepth,
        parenDepth,
        bracketDepth,
      }),
    );
  };
  const identifierStart = (value) =>
    value !== undefined && /[$_\p{ID_Start}]/u.test(value);
  const identifierPart = (value) =>
    value !== undefined && /[$_\u200c\u200d\p{ID_Continue}]/u.test(value);
  const codePointAt = (position) => {
    if (position >= source.length) return null;
    const value = String.fromCodePoint(source.codePointAt(position));
    return { value, end: position + value.length };
  };
  const unicodeEscapeAt = (position) => {
    if (source[position] !== "\\" || source[position + 1] !== "u") return null;
    let cursor = position + 2;
    let hexadecimal;
    if (source[cursor] === "{") {
      const close = source.indexOf("}", cursor + 1);
      if (close === -1) fail("unterminated Unicode escape");
      hexadecimal = source.slice(cursor + 1, close);
      if (!/^[0-9A-Fa-f]{1,6}$/u.test(hexadecimal)) {
        fail("malformed Unicode escape");
      }
      cursor = close + 1;
    } else {
      hexadecimal = source.slice(cursor, cursor + 4);
      if (!/^[0-9A-Fa-f]{4}$/u.test(hexadecimal)) {
        fail("malformed Unicode escape");
      }
      cursor += 4;
    }
    const codePoint = Number.parseInt(hexadecimal, 16);
    if (codePoint > 0x10ffff) fail("Unicode escape outside scalar range");
    return { value: String.fromCodePoint(codePoint), end: cursor };
  };
  const escapedValue = () => {
    if (index >= source.length) fail("unterminated escape");
    const value = source[index++];
    const simple = {
      0: "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    if (Object.hasOwn(simple, value)) return simple[value];
    if (["\n", "\u2028", "\u2029"].includes(value)) return "";
    if (value === "\r") {
      if (source[index] === "\n") index += 1;
      return "";
    }
    if (value === "x") {
      const hexadecimal = source.slice(index, index + 2);
      if (!/^[0-9A-Fa-f]{2}$/u.test(hexadecimal)) {
        fail("malformed hexadecimal escape");
      }
      index += 2;
      return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
    }
    if (value === "u") {
      index -= 2;
      const decoded = unicodeEscapeAt(index);
      index = decoded.end;
      return decoded.value;
    }
    return value;
  };
  const scanString = (quote) => {
    const start = index++;
    let value = "";
    while (index < source.length) {
      const character = source[index++];
      if (character === quote) {
        push("string", value, start, index);
        return;
      }
      if (character === "\n" || character === "\r") {
        fail("unterminated string");
      }
      value += character === "\\" ? escapedValue() : character;
    }
    fail("unterminated string");
  };
  const scanIdentifier = () => {
    const start = index;
    let value = "";
    let first = true;
    while (index < source.length) {
      const escaped = unicodeEscapeAt(index);
      const decoded = escaped ?? codePointAt(index);
      if (decoded === null) break;
      if (
        !(first
          ? identifierStart(decoded.value)
          : identifierPart(decoded.value))
      ) {
        break;
      }
      value += decoded.value;
      index = decoded.end;
      first = false;
    }
    if (first) fail("malformed identifier");
    push("identifier", value, start, index);
  };

  while (index < source.length) {
    const character = source[index];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (
        index < source.length &&
        !/[\r\n\u2028\u2029]/u.test(source[index])
      ) {
        index += 1;
      }
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index += 2;
      const end = source.indexOf("*/", index);
      if (end === -1) fail("unterminated comment");
      index = end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      scanString(character);
      continue;
    }
    if (character === "`") fail("template literal outside bounded subset");
    const escaped = unicodeEscapeAt(index);
    const codePoint = codePointAt(index);
    if (
      (escaped !== null && identifierStart(escaped.value)) ||
      (codePoint !== null && identifierStart(codePoint.value))
    ) {
      scanIdentifier();
      continue;
    }
    if (/[0-9]/u.test(character)) {
      const start = index++;
      while (/[0-9]/u.test(source[index] ?? "")) index += 1;
      const raw = source.slice(start, index);
      const continuation = codePointAt(index)?.value;
      if (
        !/^(?:0|[1-9][0-9]*)$/u.test(raw) ||
        source[index] === "." ||
        source[index] === "\\" ||
        identifierPart(continuation)
      ) {
        fail("numeric literal outside bounded decimal-integer subset");
      }
      push("number", source.slice(start, index), start, index);
      continue;
    }
    const start = index;
    const four = source.slice(index, index + 4);
    const three = source.slice(index, index + 3);
    const two = source.slice(index, index + 2);
    let punctuator = character;
    if (four === ">>>=") {
      punctuator = four;
    } else if (
      [
        "...",
        "===",
        "!==",
        ">>>",
        "**=",
        "<<=",
        ">>=",
        "&&=",
        "||=",
        "??=",
      ].includes(three)
    ) {
      punctuator = three;
    } else if (
      [
        "=>",
        "++",
        "--",
        "?.",
        "**",
        "&&",
        "||",
        "??",
        "==",
        "!=",
        "<=",
        ">=",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "&=",
        "|=",
        "^=",
        "<<",
        ">>",
      ].includes(two)
    ) {
      punctuator = two;
    }
    index += punctuator.length;
    if (punctuator === "{") {
      push("punctuator", punctuator, start, index);
      braceDepth += 1;
    } else if (punctuator === "}") {
      braceDepth -= 1;
      if (braceDepth < 0) fail("unbalanced closing brace");
      push("punctuator", punctuator, start, index);
    } else if (punctuator === "(") {
      push("punctuator", punctuator, start, index);
      parenDepth += 1;
    } else if (punctuator === ")") {
      parenDepth -= 1;
      if (parenDepth < 0) fail("unbalanced closing parenthesis");
      push("punctuator", punctuator, start, index);
    } else if (punctuator === "[") {
      push("punctuator", punctuator, start, index);
      bracketDepth += 1;
    } else if (punctuator === "]") {
      bracketDepth -= 1;
      if (bracketDepth < 0) fail("unbalanced closing bracket");
      push("punctuator", punctuator, start, index);
    } else {
      push("punctuator", punctuator, start, index);
    }
  }
  if (braceDepth !== 0 || parenDepth !== 0 || bracketDepth !== 0) {
    fail("unbalanced source");
  }
  return Object.freeze(tokens);
}

function matchingToken(tokens, openingIndex, opening, closing) {
  let depth = 0;
  for (let index = openingIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === opening) depth += 1;
    if (tokens[index].value === closing) depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error(`static gate: unterminated ${opening}`);
}

function parseExactImports(tokens) {
  const declarations = [];
  const syntaxIndexes = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || token.value !== "import") continue;
    if (
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      throw new Error("static gate: nested or dynamic import");
    }
    const expectedEntry = [...ALLOWED_IMPORTS][declarations.length];
    if (expectedEntry === undefined || tokens[index + 1]?.value !== "{") {
      throw new Error("static gate: import form");
    }
    const [expectedSpecifier, expectedNames] = expectedEntry;
    let cursor = index + 2;
    const names = [];
    while (tokens[cursor]?.value !== "}") {
      const imported = tokens[cursor];
      if (imported?.type !== "identifier") {
        throw new Error("static gate: named import");
      }
      names.push(imported.value);
      cursor += 1;
      if (tokens[cursor]?.value === ",") {
        cursor += 1;
      } else if (tokens[cursor]?.value !== "}") {
        throw new Error("static gate: named import separator");
      }
    }
    if (
      tokens[cursor + 1]?.value !== "from" ||
      tokens[cursor + 2]?.type !== "string"
    ) {
      throw new Error("static gate: named import source");
    }
    const specifier = tokens[cursor + 2].value;
    assert.equal(specifier, expectedSpecifier, "static gate: import order");
    assert.deepEqual(names, expectedNames, "static gate: import names");
    for (let covered = index; covered <= cursor + 2; covered += 1) {
      syntaxIndexes.add(covered);
    }
    declarations.push(
      Object.freeze({
        specifier,
        names: Object.freeze(names),
        start: index,
        end: cursor + 2,
      }),
    );
    index = cursor + 2;
  }
  assert.equal(declarations.length, ALLOWED_IMPORTS.size);
  assert.equal(
    declarations.reduce(
      (count, declaration) => count + declaration.names.length,
      0,
    ),
    23,
  );
  return Object.freeze({
    declarations: Object.freeze(declarations),
    syntaxIndexes,
  });
}

function parseExactExports(tokens) {
  const declarations = [];
  const syntaxIndexes = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier" || token.value !== "export") continue;
    if (
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      throw new Error("static gate: nested export");
    }
    const expected = EXPECTED_EXPORT_MANIFEST[declarations.length];
    const kind = tokens[index + 1]?.value;
    const name = tokens[index + 2]?.value;
    if (
      expected === undefined ||
      kind !== expected.kind ||
      name !== expected.name ||
      tokens[index + 2]?.type !== "identifier"
    ) {
      throw new Error("static gate: export inventory");
    }
    syntaxIndexes.add(index);
    syntaxIndexes.add(index + 1);
    syntaxIndexes.add(index + 2);
    if (kind === "function") {
      if (tokens[index + 3]?.value !== "(") {
        throw new Error("static gate: export signature");
      }
      const closing = matchingToken(tokens, index + 3, "(", ")");
      const parameters = [];
      let cursor = index + 4;
      while (cursor < closing) {
        if (tokens[cursor]?.type !== "identifier") {
          throw new Error("static gate: export parameter");
        }
        parameters.push(tokens[cursor].value);
        syntaxIndexes.add(cursor);
        cursor += 1;
        if (cursor < closing) {
          if (tokens[cursor]?.value !== ",") {
            throw new Error("static gate: export parameter separator");
          }
          cursor += 1;
        }
      }
      const signature = EXPECTED_FUNCTION_SIGNATURES.find(
        (candidate) => candidate.name === name,
      );
      assert.deepEqual(parameters, signature.parameters);
      if (tokens[closing + 1]?.value !== "{") {
        throw new Error("static gate: export function body");
      }
      declarations.push(
        Object.freeze({
          name,
          kind,
          arity: parameters.length,
          parameters: Object.freeze(parameters),
          functionIndex: index + 1,
          bodyOpenIndex: closing + 1,
        }),
      );
    } else {
      if (tokens[index + 3]?.value !== "=") {
        throw new Error("static gate: exported const initializer");
      }
      declarations.push(Object.freeze({ name, kind, arity: null }));
    }
  }
  assert.deepEqual(
    declarations.map(({ name, kind, arity }) => ({ name, kind, arity })),
    EXPECTED_EXPORT_MANIFEST,
  );
  return Object.freeze({
    declarations: Object.freeze(declarations),
    syntaxIndexes,
  });
}

function buildLexicalScopes(tokens) {
  const scopes = [{ parent: null, bindings: new Map() }];
  const scopeAt = [];
  const childScopeAtBrace = new Map();
  const stack = [0];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === "}") stack.pop();
    if (stack.length === 0) throw new Error("static gate: scope underflow");
    scopeAt[index] = stack.at(-1);
    if (token.value === "{") {
      const child = scopes.length;
      scopes.push({ parent: stack.at(-1), bindings: new Map() });
      childScopeAtBrace.set(index, child);
      stack.push(child);
    }
  }
  if (stack.length !== 1) throw new Error("static gate: scope imbalance");
  return { scopes, scopeAt, childScopeAtBrace };
}

function assertPositiveIdentifierClosure(tokens, imports, exports) {
  const { scopes, scopeAt, childScopeAtBrace } = buildLexicalScopes(tokens);
  const syntaxIndexes = new Set([
    ...imports.syntaxIndexes,
    ...exports.syntaxIndexes,
  ]);
  const protectedBindings = new Set([
    ...ALLOWED_AMBIENT_INTRINSICS,
    ...FORBIDDEN_SOURCE_IDENTIFIERS,
    ...EXPECTED_EXPORTS,
    ...[...ALLOWED_IMPORTS.values()].flat(),
  ]);
  const addBinding = (
    scope,
    name,
    tokenIndex,
    { protectedSeed = false } = {},
  ) => {
    if (!protectedSeed && protectedBindings.has(name)) {
      throw new Error(`static gate: protected binding ${name}`);
    }
    const bindings = scopes[scope].bindings;
    const existing = bindings.get(name);
    if (existing !== undefined && existing !== tokenIndex) {
      throw new Error(`static gate: duplicate binding ${name}`);
    }
    bindings.set(name, tokenIndex);
    syntaxIndexes.add(tokenIndex);
  };
  for (const declaration of imports.declarations) {
    for (const name of declaration.names)
      addBinding(0, name, declaration.start, { protectedSeed: true });
  }
  for (const declaration of exports.declarations) {
    const tokenIndex = tokens.findIndex(
      (token, index) =>
        index >= 0 &&
        token.value === declaration.name &&
        tokens[index - 2]?.value === "export",
    );
    addBinding(0, declaration.name, tokenIndex, { protectedSeed: true });
  }

  const functionBodies = new Map(
    exports.declarations
      .filter(({ kind }) => kind === "function")
      .map((declaration) => [
        declaration.functionIndex,
        declaration.bodyOpenIndex,
      ]),
  );
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "function") continue;
    const previous = tokens[index - 1]?.value;
    if (![undefined, ";", "{", "}", "export"].includes(previous)) {
      throw new Error(
        "static gate: function expression outside bounded subset",
      );
    }
    const nameToken = tokens[index + 1];
    if (nameToken?.type !== "identifier" || tokens[index + 2]?.value !== "(") {
      throw new Error("static gate: function declaration");
    }
    const closing = matchingToken(tokens, index + 2, "(", ")");
    const bodyOpenIndex = closing + 1;
    if (tokens[bodyOpenIndex]?.value !== "{") {
      throw new Error("static gate: function body");
    }
    const bodyScope = childScopeAtBrace.get(bodyOpenIndex);
    if (bodyScope === undefined) throw new Error("static gate: function scope");
    if (!functionBodies.has(index)) {
      addBinding(scopeAt[index], nameToken.value, index + 1);
    }
    syntaxIndexes.add(index);
    syntaxIndexes.add(index + 1);
    let cursor = index + 3;
    while (cursor < closing) {
      const parameter = tokens[cursor];
      if (parameter?.type !== "identifier") {
        throw new Error("static gate: simple parameters required");
      }
      addBinding(bodyScope, parameter.value, cursor);
      cursor += 1;
      if (cursor < closing) {
        if (tokens[cursor]?.value !== ",") {
          throw new Error("static gate: parameter separator");
        }
        cursor += 1;
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const declarationKind = tokens[index].value;
    if (declarationKind === "var") {
      throw new Error("static gate: var outside bounded subset");
    }
    if (!["const", "let"].includes(declarationKind)) continue;
    syntaxIndexes.add(index);
    const nameToken = tokens[index + 1];
    if (nameToken?.type !== "identifier") {
      throw new Error("static gate: simple binding required");
    }
    const forOf =
      tokens[index - 1]?.value === "(" && tokens[index - 2]?.value === "for";
    if (forOf) {
      if (tokens[index + 2]?.value !== "of") {
        throw new Error("static gate: only braced for-of loops are permitted");
      }
      const closing = matchingToken(tokens, index - 1, "(", ")");
      if (tokens[closing + 1]?.value !== "{") {
        throw new Error("static gate: for-of body must be braced");
      }
      addBinding(
        childScopeAtBrace.get(closing + 1),
        nameToken.value,
        index + 1,
      );
      syntaxIndexes.add(index + 2);
      continue;
    }
    if (tokens[index - 1]?.value === "export") {
      continue;
    }
    if (!["=", ";"].includes(tokens[index + 2]?.value)) {
      throw new Error("static gate: one simple declarator per statement");
    }
    addBinding(scopeAt[index], nameToken.value, index + 1);
    const base = tokens[index];
    for (let cursor = index + 2; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor];
      if (
        token.value === ";" &&
        token.braceDepth === base.braceDepth &&
        token.parenDepth === base.parenDepth &&
        token.bracketDepth === base.bracketDepth
      ) {
        break;
      }
      if (
        token.value === "," &&
        token.braceDepth === base.braceDepth &&
        token.parenDepth === base.parenDepth &&
        token.bracketDepth === base.bracketDepth
      ) {
        throw new Error("static gate: multiple declarators");
      }
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "catch") continue;
    if (
      tokens[index + 1]?.value !== "(" ||
      tokens[index + 2]?.type !== "identifier" ||
      tokens[index + 3]?.value !== ")" ||
      tokens[index + 4]?.value !== "{"
    ) {
      throw new Error("static gate: catch binding");
    }
    addBinding(
      childScopeAtBrace.get(index + 4),
      tokens[index + 2].value,
      index + 2,
    );
    syntaxIndexes.add(index);
  }

  const resolve = (name, startingScope) => {
    let scope = startingScope;
    while (scope !== null) {
      if (scopes[scope].bindings.has(name)) return true;
      scope = scopes[scope].parent;
    }
    return false;
  };
  const forbiddenMembers = new Set(FORBIDDEN_MEMBER_NAMES);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "identifier") continue;
    if (token.raw.includes("\\")) {
      throw new Error("static gate: encoded identifier");
    }
    if (syntaxIndexes.has(index) || SOURCE_KEYWORDS.has(token.value)) continue;
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (previous?.value === ".") {
      if (
        forbiddenMembers.has(token.value) ||
        !ALLOWED_MEMBER_NAMES.has(token.value)
      ) {
        throw new Error(`static gate: forbidden member ${token.value}`);
      }
      const base = tokens[index - 2];
      if (UNTRUSTED_PUBLIC_PARAMETER_NAMES.has(base?.value)) {
        throw new Error(
          `static gate: direct member access on public input ${base.value}`,
        );
      }
      const ambientMembers = ALLOWED_AMBIENT_MEMBERS.get(base?.value);
      if (ambientMembers !== undefined && !ambientMembers.has(token.value)) {
        throw new Error(
          `static gate: ambient member ${base.value}.${token.value}`,
        );
      }
      continue;
    }
    const objectKey =
      ["{", ","].includes(previous?.value) && next?.value === ":";
    if (objectKey) {
      if (forbiddenMembers.has(token.value)) {
        throw new Error(`static gate: forbidden key ${token.value}`);
      }
      continue;
    }
    if (
      !ALLOWED_AMBIENT_INTRINSICS.includes(token.value) &&
      !resolve(token.value, scopeAt[index])
    ) {
      throw new Error(`static gate: free identifier ${token.value}`);
    }
  }
  return Object.freeze({
    scopeCount: scopes.length,
    bindingCount: scopes.reduce(
      (total, scope) => total + scope.bindings.size,
      0,
    ),
  });
}

function assertComputedMembersAreStaticIndexes(tokens) {
  const canEndBase = (token) =>
    token !== undefined &&
    (["identifier", "number", "string"].includes(token.type) ||
      [")", "]", "}"].includes(token.value));
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "[") continue;
    const closing = matchingToken(tokens, index, "[", "]");
    const previous = tokens[index - 1];
    if (
      ["{", ","].includes(previous?.value) &&
      tokens[closing + 1]?.value === ":"
    ) {
      throw new Error("static gate: computed object key");
    }
    if (!canEndBase(previous)) continue;
    const key = tokens.slice(index + 1, closing);
    if (
      key.length !== 1 ||
      key[0].type !== "number" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(key[0].value)
    ) {
      throw new Error("static gate: dynamic computed member");
    }
    index = closing;
  }
}

function decodedCompileTimeStrings(tokens) {
  const values = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "string") continue;
    let value = tokens[index].value;
    values.push(value);
    let cursor = index;
    while (
      tokens[cursor + 1]?.value === "+" &&
      tokens[cursor + 2]?.type === "string"
    ) {
      value += tokens[cursor + 2].value;
      values.push(value);
      cursor += 2;
    }
  }
  return values;
}

function assertBoundedSourceSubset(tokens) {
  for (const token of tokens) {
    if (["...", "=>", "++", "--", "?.", "/", "/="].includes(token.value)) {
      throw new Error(`static gate: punctuator ${token.value}`);
    }
    if (
      token.type === "identifier" &&
      [
        "async",
        "await",
        "class",
        "debugger",
        "delete",
        "extends",
        "instanceof",
        "super",
        "this",
        "with",
        "yield",
      ].includes(token.value)
    ) {
      throw new Error(`static gate: syntax ${token.value}`);
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value !== "new") continue;
    if (!["Error", "Set", "WeakMap"].includes(tokens[index + 1]?.value)) {
      throw new Error("static gate: constructor outside bounded subset");
    }
  }
  for (const value of decodedCompileTimeStrings(tokens)) {
    if (PINNED_NORMATIVE_SOURCE_LITERALS.has(value)) continue;
    const normalized = value.toLowerCase();
    const fragment = [...FORBIDDEN_EXACT_COMPILE_TIME_STRINGS].find(
      (candidate) => normalized.includes(candidate),
    );
    if (fragment !== undefined) {
      throw new Error(`static gate: forbidden string fragment ${fragment}`);
    }
    const prefix = FORBIDDEN_COMPILE_TIME_PATH_PREFIXES.find((candidate) =>
      normalized.startsWith(candidate.toLowerCase()),
    );
    if (prefix !== undefined) {
      throw new Error(`static gate: forbidden path prefix ${prefix}`);
    }
    const suffix = FORBIDDEN_COMPILE_TIME_PATH_SUFFIXES.find((candidate) =>
      normalized.endsWith(candidate.toLowerCase()),
    );
    if (suffix !== undefined) {
      throw new Error(`static gate: forbidden path suffix ${suffix}`);
    }
  }
  assertComputedMembersAreStaticIndexes(tokens);
}

function assertExactPrivateStoreManifest(tokens) {
  const stores = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index].value === "const" &&
      tokens[index].braceDepth === 0 &&
      tokens[index].parenDepth === 0 &&
      tokens[index].bracketDepth === 0 &&
      tokens[index + 1]?.type === "identifier" &&
      tokens[index + 2]?.value === "=" &&
      tokens[index + 3]?.value === "new" &&
      tokens[index + 4]?.value === "WeakMap" &&
      tokens[index + 5]?.value === "(" &&
      tokens[index + 6]?.value === ")" &&
      tokens[index + 7]?.value === ";"
    ) {
      stores.push(tokens[index + 1].value);
    }
  }
  assert.deepEqual(stores, [
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  assert.equal(
    tokens.filter(
      (token, index) =>
        token.value === "new" && tokens[index + 1]?.value === "WeakMap",
    ).length,
    3,
  );
  for (const name of stores) {
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].value !== name) continue;
      if (
        ASSIGNMENT_OPERATORS.has(tokens[index + 1]?.value) ||
        (tokens[index + 1]?.value === "." &&
          ASSIGNMENT_OPERATORS.has(tokens[index + 3]?.value))
      ) {
        const declaration =
          tokens[index - 1]?.value === "const" &&
          tokens[index - 1]?.braceDepth === 0 &&
          tokens[index - 1]?.parenDepth === 0 &&
          tokens[index - 1]?.bracketDepth === 0 &&
          tokens[index + 1]?.value === "=" &&
          tokens[index + 2]?.value === "new";
        if (!declaration) {
          throw new Error(`static gate: private store reassignment ${name}`);
        }
      }
    }
  }
  return Object.freeze(stores);
}

function statementTerminator(tokens, start) {
  const base = tokens[start];
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.value === ";" &&
      token.braceDepth === base.braceDepth &&
      token.parenDepth === base.parenDepth &&
      token.bracketDepth === base.bracketDepth
    ) {
      return index;
    }
  }
  throw new Error("static gate: unterminated module statement");
}

function functionDeclarationEnd(tokens, start) {
  const functionIndex = tokens[start].value === "export" ? start + 1 : start;
  if (
    tokens[functionIndex]?.value !== "function" ||
    tokens[functionIndex + 1]?.type !== "identifier" ||
    tokens[functionIndex + 2]?.value !== "("
  ) {
    throw new Error("static gate: module function declaration");
  }
  const parametersEnd = matchingToken(tokens, functionIndex + 2, "(", ")");
  const bodyStart = parametersEnd + 1;
  if (tokens[bodyStart]?.value !== "{") {
    throw new Error("static gate: module function body");
  }
  return matchingToken(tokens, bodyStart, "{", "}");
}

function assertModuleStatementTopology(tokens) {
  let statementCount = 0;
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      throw new Error("static gate: module statement depth");
    }
    if (token.value === ";") {
      index += 1;
      continue;
    }
    if (token.value === "import" || token.value === "const") {
      index = statementTerminator(tokens, index) + 1;
      statementCount += 1;
      continue;
    }
    if (token.value === "function") {
      index = functionDeclarationEnd(tokens, index) + 1;
      statementCount += 1;
      continue;
    }
    if (token.value === "export") {
      if (tokens[index + 1]?.value === "const") {
        index = statementTerminator(tokens, index) + 1;
        statementCount += 1;
        continue;
      }
      if (tokens[index + 1]?.value === "function") {
        index = functionDeclarationEnd(tokens, index) + 1;
        statementCount += 1;
        continue;
      }
    }
    throw new Error(`static gate: module statement ${token.value}`);
  }
  return statementCount;
}

function assertPureModuleInitializer(tokens, start, end, pureBindings) {
  for (let index = start; index < end; index += 1) {
    if (ASSIGNMENT_OPERATORS.has(tokens[index].value)) {
      throw new Error("static gate: assignment in module initializer");
    }
  }

  let cursor = start;
  const result = (immutable, freezable) =>
    Object.freeze({ immutable, freezable });
  const primitiveResult = result(true, true);
  let parseValue;

  const parseDelimitedValues = (closing) => {
    const values = [];
    if (tokens[cursor]?.value === closing) {
      cursor += 1;
      return values;
    }
    while (cursor < end) {
      values.push(parseValue());
      if (tokens[cursor]?.value === closing) {
        cursor += 1;
        return values;
      }
      if (tokens[cursor]?.value !== ",") {
        throw new Error("static gate: pure initializer separator");
      }
      cursor += 1;
      if (tokens[cursor]?.value === closing) {
        cursor += 1;
        return values;
      }
    }
    throw new Error(`static gate: unterminated pure initializer ${closing}`);
  };

  parseValue = () => {
    const token = tokens[cursor];
    if (token === undefined || cursor >= end) {
      throw new Error("static gate: missing pure initializer value");
    }
    if (token.type === "string" || token.type === "number") {
      cursor += 1;
      return primitiveResult;
    }
    if (["false", "null", "true"].includes(token.value)) {
      cursor += 1;
      return primitiveResult;
    }
    if (token.value === "-") {
      if (
        tokens[cursor + 1]?.type !== "number" ||
        tokens[cursor + 1]?.value === "0"
      ) {
        throw new Error("static gate: bounded negative integer");
      }
      cursor += 2;
      return primitiveResult;
    }
    if (token.value === "[") {
      cursor += 1;
      const children = parseDelimitedValues("]");
      return result(
        false,
        children.every(({ freezable }) => freezable),
      );
    }
    if (token.value === "{") {
      cursor += 1;
      const children = [];
      if (tokens[cursor]?.value === "}") {
        cursor += 1;
        return result(false, true);
      }
      while (cursor < end) {
        const key = tokens[cursor];
        if (!["identifier", "number", "string"].includes(key?.type)) {
          throw new Error("static gate: static object key");
        }
        cursor += 1;
        if (tokens[cursor]?.value !== ":") {
          throw new Error("static gate: explicit object value");
        }
        cursor += 1;
        children.push(parseValue());
        if (tokens[cursor]?.value === "}") {
          cursor += 1;
          break;
        }
        if (tokens[cursor]?.value !== ",") {
          throw new Error("static gate: object initializer separator");
        }
        cursor += 1;
        if (tokens[cursor]?.value === "}") {
          cursor += 1;
          break;
        }
      }
      return result(
        false,
        children.every(({ freezable }) => freezable),
      );
    }
    if (token.value === "(") {
      cursor += 1;
      const nested = parseValue();
      if (tokens[cursor]?.value !== ")") {
        throw new Error("static gate: pure initializer parenthesis");
      }
      cursor += 1;
      return nested;
    }
    if (token.type === "identifier") {
      if (tokens[cursor + 1]?.value === "(") {
        const expectedArity = PURE_MODULE_INITIALIZER_CALL_ARITIES.get(
          token.value,
        );
        if (expectedArity === undefined) {
          throw new Error(
            `static gate: module initializer effect call ${token.value}`,
          );
        }
        cursor += 2;
        const parameters = parseDelimitedValues(")");
        if (parameters.length !== expectedArity) {
          throw new Error(`static gate: pure initializer arity ${token.value}`);
        }
        const [parameter] = parameters;
        if (token.value === "deepFreeze") {
          if (!parameter.freezable) {
            throw new Error("static gate: non-freezable deepFreeze input");
          }
          return primitiveResult;
        }
        if (token.value === "canonicalJsonBytes") {
          if (!parameter.freezable) {
            throw new Error("static gate: unsafe canonical JSON input");
          }
          return result(false, false);
        }
        if (token.value === "nullRecord") {
          if (!parameter.freezable) {
            throw new Error("static gate: unsafe null-record input");
          }
          return result(false, true);
        }
        return primitiveResult;
      }
      if (!pureBindings.has(token.value)) {
        throw new Error(`static gate: module initializer alias ${token.value}`);
      }
      cursor += 1;
      return primitiveResult;
    }
    throw new Error(`static gate: impure module initializer ${token.value}`);
  };

  const initializer = parseValue();
  if (cursor !== end) {
    throw new Error("static gate: trailing module initializer syntax");
  }
  if (!initializer.immutable) {
    throw new Error("static gate: mutable module initializer result");
  }
}

function assertModuleInitializationClosure(tokens) {
  assertModuleStatementTopology(tokens);
  const privateStores = new Set([
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  const pureBindings = new Set();
  let checked = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.value !== "const" ||
      token.braceDepth !== 0 ||
      token.parenDepth !== 0 ||
      token.bracketDepth !== 0
    ) {
      continue;
    }
    const name = tokens[index + 1]?.value;
    const initializer = tokens[index + 3];
    if (
      tokens[index + 1]?.type !== "identifier" ||
      tokens[index + 2]?.value !== "=" ||
      initializer === undefined
    ) {
      throw new Error("static gate: module declaration shape");
    }
    checked += 1;
    const declarationEnd = statementTerminator(tokens, index);
    if (privateStores.has(name)) {
      if (
        initializer.value !== "new" ||
        tokens[index + 4]?.value !== "WeakMap" ||
        tokens[index + 5]?.value !== "(" ||
        tokens[index + 6]?.value !== ")" ||
        declarationEnd !== index + 7
      ) {
        throw new Error("static gate: private store initializer");
      }
      continue;
    }
    assertPureModuleInitializer(
      tokens,
      index + 3,
      declarationEnd,
      pureBindings,
    );
    pureBindings.add(name);
  }
  return checked;
}

function assertRejectByDefaultEstreePolicy(program, expectedNodeCount) {
  const counters = {
    classifiedNodeCount: 0,
    bindingCount: 0,
    referenceCount: 0,
    callCount: 0,
    calleeCount: 0,
    memberCount: 0,
    receiverCount: 0,
    literalCount: 0,
    mutationCount: 0,
    joinCount: 0,
    rawEscapeCount: 0,
    unknownProvenanceCount: 0,
    privateOperationCount: 0,
    privateCommitCount: 0,
    privateDominatedCallCount: 0,
    privateOwnerReturnCount: 0,
    moduleCallEdgeCount: 0,
  };
  const classifiedNodes = new WeakSet();
  const nodeRoles = new WeakMap();
  const moduleScope = { parent: null, bindings: new Map() };
  const moduleInitializers = new Map();
  const functionRecords = new Map();
  const requirementsDependencies = new Set();
  const privateCommits = [];
  const privateLookups = [];
  const privateLookupResultPolicies = [];
  const moduleCallEdges = new Set();
  const privateStoreNames = new Set([
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  const pinnedFailureCodes = new Set(
    STATIC_POLICY_REQUIREMENTS_ORACLE.vocabularies.failureCodes,
  );
  const protectedBindingKinds = new Set([
    "ambient",
    "export-value",
    "export-function",
    "import-callable",
    "import-value",
    "local-function",
    "private-read",
    "private-store",
  ]);
  const mutableKinds = new Set(["error", "mutable-local"]);
  const importedNormalizers = new Set([
    "boundedInteger",
    "copyBoundedBuffer",
    "decodeCanonicalBase64",
    "decodeCanonicalJsonLine",
    "exactBoolean",
    "exactDigest",
    "exactRecord",
  ]);
  const importedFrozenResults = new Set([
    "deepFreeze",
    "frozenCopyOnReadBytes",
    "verifyCandidateContainmentLaunchCapsuleV3",
  ]);
  const importedCallArities = new Map([
    ["boundedInteger", new Set([5])],
    ["canonicalJsonBytes", new Set([1])],
    ["canonicalJsonLine", new Set([1])],
    ["copyBoundedBuffer", new Set([4])],
    ["decodeCanonicalBase64", new Set([4])],
    ["decodeCanonicalJsonLine", new Set([4])],
    ["deepFreeze", new Set([1])],
    ["exactBoolean", new Set([4])],
    ["exactDigest", new Set([3])],
    ["exactRecord", new Set([4])],
    ["frozenCopyOnReadBytes", new Set([1, 2])],
    ["nullRecord", new Set([1])],
    ["sha256", new Set([1])],
    ["verifyCandidateContainmentLaunchCapsuleV3", new Set([1])],
  ]);
  const importedFailureCallbackIndex = new Map([
    ["boundedInteger", 4],
    ["copyBoundedBuffer", 3],
    ["decodeCanonicalBase64", 3],
    ["decodeCanonicalJsonLine", 3],
    ["exactBoolean", 3],
    ["exactDigest", 2],
    ["exactRecord", 3],
  ]);
  const safeMemberMethods = new Set([
    "add",
    "at",
    "get",
    "has",
    "includes",
    "push",
    "slice",
  ]);

  const fail = (reason) => {
    throw new Error(`static gate: ESTree ${reason}`);
  };
  const STATIC_STRING_VALUE_LIMIT = 1024;
  const mergeStaticStrings = (...collections) => {
    const merged = [...new Set(collections.flat())];
    if (merged.length > STATIC_STRING_VALUE_LIMIT) {
      fail(`static string alternative limit ${merged.length}`);
    }
    return merged;
  };
  const makeValue = (
    kind,
    {
      freezable = true,
      origins = [],
      staticStrings = [],
      tainted = false,
    } = {},
  ) =>
    Object.freeze({
      kind,
      freezable,
      origins: Object.freeze([...new Set(origins)]),
      staticStrings: Object.freeze(mergeStaticStrings(staticStrings)),
      tainted,
    });
  const IMMUTABLE_VALUE = makeValue("immutable");
  const UNTRUSTED_VALUE = makeValue("untrusted", {
    freezable: false,
    tainted: true,
  });
  const valueWithOrigin = (
    kind,
    node,
    children = [],
    { staticStrings = null } = {},
  ) =>
    makeValue(kind, {
      freezable: children.every(({ freezable }) => freezable),
      origins: [node, ...children.flatMap(({ origins }) => origins)],
      staticStrings:
        staticStrings ??
        mergeStaticStrings(...children.map((child) => child.staticStrings)),
      tainted: children.some(({ tainted }) => tainted),
    });
  const frozenValue = (value) =>
    makeValue("frozen", {
      freezable: value.freezable,
      origins: value.origins,
      staticStrings: value.staticStrings,
      tainted: value.tainted,
    });
  const mark = (node, role) => {
    if (node === null || typeof node?.type !== "string") {
      fail(`invalid ${role} node`);
    }
    if (classifiedNodes.has(node)) return false;
    classifiedNodes.add(node);
    nodeRoles.set(node, role);
    counters.classifiedNodeCount += 1;
    return true;
  };
  const markIdentifier = (node, role, { reference = false } = {}) => {
    if (node.type !== "Identifier") fail(`${role} must be an identifier`);
    if (mark(node, role) && reference) counters.referenceCount += 1;
  };
  const declare = (
    scope,
    name,
    binding,
    { allowProtectedName = false } = {},
  ) => {
    if (
      !allowProtectedName &&
      (ALLOWED_AMBIENT_INTRINSICS.includes(name) ||
        FORBIDDEN_SOURCE_IDENTIFIERS.includes(name) ||
        EXPECTED_EXPORTS.includes(name) ||
        privateStoreNames.has(name) ||
        [...ALLOWED_IMPORTS.values()].some((names) => names.includes(name)))
    ) {
      fail(`protected binding declaration ${name}`);
    }
    if (scope.bindings.has(name)) fail(`duplicate binding ${name}`);
    const declared = { name, scope, ...binding };
    scope.bindings.set(name, declared);
    counters.bindingCount += 1;
    return declared;
  };
  const resolve = (scope, name) => {
    for (let current = scope; current !== null; current = current.parent) {
      const binding = current.bindings.get(name);
      if (binding !== undefined) return binding;
    }
    if (ALLOWED_AMBIENT_INTRINSICS.includes(name)) {
      return { name, kind: "ambient", value: makeValue("ambient") };
    }
    fail(`unresolved binding ${name}`);
  };
  const bindingValue = (binding) =>
    binding.value ?? makeValue(binding.kind, { freezable: false });
  const recordRawEscape = (reason) => {
    counters.rawEscapeCount += 1;
    fail(`raw or unknown value ${reason}`);
  };
  const requireTrusted = (value, reason, { allowMutable = false } = {}) => {
    const escapedCapabilityString = value.staticStrings.find((candidate) =>
      capabilityLookingString(candidate),
    );
    if (escapedCapabilityString !== undefined) {
      fail(
        `capability-looking normative literal ${reason} ${escapedCapabilityString}`,
      );
    }
    if (
      value.kind === "untrusted" ||
      value.kind === "unknown" ||
      protectedBindingKinds.has(value.kind) ||
      (!allowMutable && mutableKinds.has(value.kind)) ||
      value.tainted
    ) {
      recordRawEscape(reason);
    }
    return value;
  };
  const sameProvenance = (left, right) =>
    left.kind === right.kind &&
    left.freezable === right.freezable &&
    left.tainted === right.tainted &&
    left.origins.length === right.origins.length &&
    left.origins.every((origin) => right.origins.includes(origin));
  const joinValues = (left, right, reason) => {
    counters.joinCount += 1;
    if (!sameProvenance(left, right)) {
      counters.unknownProvenanceCount += 1;
      fail(`unknown provenance join ${reason}`);
    }
    return makeValue(left.kind, {
      freezable: left.freezable,
      origins: left.origins,
      staticStrings: mergeStaticStrings(
        left.staticStrings,
        right.staticStrings,
      ),
      tainted: left.tainted,
    });
  };
  const valuesAreDisjoint = (left, right) =>
    left.origins.length > 0 &&
    right.origins.length > 0 &&
    left.origins.every((origin) => !right.origins.includes(origin));
  const completion = (...states) => new Set(states);
  const unionCompletions = (...completions) =>
    new Set(completions.flatMap((states) => [...states]));
  const sequenceCompletions = (before, after) => {
    if (!before.has("normal")) return new Set(before);
    return unionCompletions(
      new Set([...before].filter((state) => state !== "normal")),
      after,
    );
  };

  const privateLookupArgumentLabel = (arguments_) => {
    if (arguments_.length !== 1) return `<arity-${arguments_.length}>`;
    return arguments_[0].type === "Identifier"
      ? arguments_[0].name
      : `<${arguments_[0].type}>`;
  };

  let importIndex = 0;
  let exportIndex = 0;
  const registerModuleVariable = (declaration, exported) => {
    if (declaration.kind !== "const" || declaration.declarations.length !== 1) {
      fail("module variables must be one const declarator");
    }
    const declarator = declaration.declarations[0];
    if (declarator.id.type !== "Identifier" || declarator.init === null) {
      fail("module const requires a simple initialized binding");
    }
    const name = declarator.id.name;
    let kind = "pending";
    let value = null;
    if (privateStoreNames.has(name)) {
      kind = "private-store";
      value = makeValue(kind, { freezable: false });
    } else if (
      name === "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS"
    ) {
      kind = "export-value";
      value = makeValue("frozen");
    } else if (
      name === "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256"
    ) {
      kind = "export-value";
      value = IMMUTABLE_VALUE;
    }
    const binding = declare(
      moduleScope,
      name,
      { kind, value, node: declarator.id, exported },
      { allowProtectedName: exported || privateStoreNames.has(name) },
    );
    moduleInitializers.set(name, {
      binding,
      declarator,
      initializer: declarator.init,
    });
  };
  const registerFunction = (declaration, exported) => {
    if (
      declaration.id?.type !== "Identifier" ||
      declaration.async ||
      declaration.generator
    ) {
      fail("only named synchronous functions are supported");
    }
    const name = declaration.id.name;
    const kind = exported ? "export-function" : "local-function";
    const value = makeValue(kind, { freezable: false });
    const binding = declare(
      moduleScope,
      name,
      { kind, value, node: declaration.id, exported },
      { allowProtectedName: exported },
    );
    functionRecords.set(name, {
      name,
      node: declaration,
      binding,
      exported,
      status: "pending",
      returnValue: null,
      provenNonReturning: false,
      calls: [],
      commits: [],
    });
  };
  const registerExport = (statement) => {
    if (
      statement.source !== null ||
      statement.specifiers.length !== 0 ||
      statement.declaration === null
    ) {
      fail("only direct declaration exports are supported");
    }
    const expected = EXPECTED_EXPORT_MANIFEST[exportIndex++];
    const declaration = statement.declaration;
    const name =
      declaration.type === "FunctionDeclaration"
        ? declaration.id?.name
        : declaration.type === "VariableDeclaration" &&
            declaration.declarations.length === 1 &&
            declaration.declarations[0].id.type === "Identifier"
          ? declaration.declarations[0].id.name
          : null;
    const kind =
      declaration.type === "FunctionDeclaration"
        ? "function"
        : declaration.type === "VariableDeclaration"
          ? declaration.kind
          : null;
    if (
      expected === undefined ||
      expected.name !== name ||
      expected.kind !== kind
    ) {
      fail("export manifest mismatch");
    }
    if (declaration.type === "FunctionDeclaration") {
      const signature = EXPECTED_FUNCTION_SIGNATURES.find(
        (entry) => entry.name === name,
      );
      if (
        declaration.params.some(
          (parameter) => parameter.type !== "Identifier",
        ) ||
        declaration.params
          .map(({ name: parameterName }) => parameterName)
          .join("\u0000") !== signature.parameters.join("\u0000")
      ) {
        fail(`export signature mismatch ${name}`);
      }
      registerFunction(declaration, true);
    } else {
      registerModuleVariable(declaration, true);
    }
  };

  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      const expected = [...ALLOWED_IMPORTS][importIndex++];
      if (
        expected === undefined ||
        statement.source.type !== "Literal" ||
        statement.source.value !== expected[0] ||
        statement.specifiers.length !== expected[1].length
      ) {
        fail("import manifest mismatch");
      }
      for (let index = 0; index < statement.specifiers.length; index += 1) {
        const specifier = statement.specifiers[index];
        const expectedName = expected[1][index];
        if (
          specifier.type !== "ImportSpecifier" ||
          specifier.imported.type !== "Identifier" ||
          specifier.local.type !== "Identifier" ||
          specifier.imported.name !== expectedName ||
          specifier.local.name !== expectedName
        ) {
          fail("import binding mismatch");
        }
        const callable =
          PURE_MODULE_INITIALIZER_CALL_ARITIES.has(expectedName) ||
          [
            "boundedInteger",
            "canonicalJsonLine",
            "copyBoundedBuffer",
            "decodeCanonicalBase64",
            "decodeCanonicalJsonLine",
            "exactBoolean",
            "exactDigest",
            "exactRecord",
            "frozenCopyOnReadBytes",
            "verifyCandidateContainmentLaunchCapsuleV3",
          ].includes(expectedName);
        const kind = callable ? "import-callable" : "import-value";
        declare(
          moduleScope,
          expectedName,
          {
            kind,
            value: makeValue(kind, { freezable: false }),
            node: specifier.local,
          },
          { allowProtectedName: true },
        );
      }
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      registerExport(statement);
      continue;
    }
    if (statement.type === "VariableDeclaration") {
      registerModuleVariable(statement, false);
      continue;
    }
    if (statement.type === "FunctionDeclaration") {
      registerFunction(statement, false);
      continue;
    }
    if (statement.type === "EmptyStatement") continue;
    fail(`unclassified module statement ${statement.type}`);
  }
  if (importIndex !== ALLOWED_IMPORTS.size) fail("incomplete import manifest");
  if (exportIndex !== EXPECTED_EXPORT_MANIFEST.length) {
    fail("incomplete export manifest");
  }
  for (const name of privateStoreNames) {
    if (moduleScope.bindings.get(name)?.kind !== "private-store") {
      fail(`private store manifest ${name}`);
    }
  }

  const normalizeStaticValue = (node, stack = new Set()) => {
    if (node.type === "Literal") {
      if (
        node.regex !== undefined ||
        typeof node.value === "bigint" ||
        (!["boolean", "number", "string"].includes(typeof node.value) &&
          node.value !== null)
      ) {
        fail("non-JSON requirements literal");
      }
      return node.value;
    }
    if (node.type === "UnaryExpression") {
      if (
        node.operator !== "-" ||
        node.argument.type !== "Literal" ||
        typeof node.argument.value !== "number" ||
        !Number.isSafeInteger(node.argument.value) ||
        node.argument.value === 0
      ) {
        fail("requirements unary expression");
      }
      return -node.argument.value;
    }
    if (node.type === "ArrayExpression") {
      if (node.elements.some((element) => element === null)) {
        fail("requirements array hole");
      }
      return node.elements.map((element) =>
        normalizeStaticValue(element, stack),
      );
    }
    if (node.type === "ObjectExpression") {
      const record = {};
      for (const property of node.properties) {
        if (
          property.type !== "Property" ||
          property.kind !== "init" ||
          property.method ||
          property.shorthand ||
          property.computed ||
          !["Identifier", "Literal"].includes(property.key.type)
        ) {
          fail("requirements object property");
        }
        const key =
          property.key.type === "Identifier"
            ? property.key.name
            : property.key.value;
        if (typeof key !== "string" || Object.hasOwn(record, key)) {
          fail("requirements object key");
        }
        record[key] = normalizeStaticValue(property.value, stack);
      }
      return record;
    }
    if (node.type === "Identifier") {
      const entry = moduleInitializers.get(node.name);
      if (entry === undefined || stack.has(node.name)) {
        fail(`requirements initializer reference ${node.name}`);
      }
      requirementsDependencies.add(node.name);
      const next = new Set(stack);
      next.add(node.name);
      return normalizeStaticValue(entry.initializer, next);
    }
    if (node.type === "CallExpression") {
      if (
        node.optional ||
        node.callee.type !== "Identifier" ||
        node.arguments.length !== 1 ||
        node.arguments[0].type === "SpreadElement"
      ) {
        fail("requirements initializer call");
      }
      const argument = normalizeStaticValue(node.arguments[0], stack);
      if (node.callee.name === "deepFreeze") return argument;
      if (node.callee.name !== "nullRecord" || !Array.isArray(argument)) {
        fail(`requirements initializer call ${node.callee.name}`);
      }
      const record = {};
      for (const entry of argument) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string" ||
          Object.hasOwn(record, entry[0])
        ) {
          fail("requirements null-record entry");
        }
        record[entry[0]] = entry[1];
      }
      return record;
    }
    fail(`unclassified requirements initializer ${node.type}`);
  };

  const requirementsName =
    "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS";
  const requirementsEntry = moduleInitializers.get(requirementsName);
  const requirementsDigestEntry = moduleInitializers.get(
    "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256",
  );
  if (
    requirementsEntry === undefined ||
    requirementsDigestEntry === undefined
  ) {
    fail("missing requirements exports");
  }
  requirementsDependencies.add(requirementsName);
  const normalizedRequirements = normalizeStaticValue(
    requirementsEntry.initializer,
    new Set([requirementsName]),
  );
  if (
    canonicalJson(normalizedRequirements) !==
      canonicalJson(STATIC_POLICY_REQUIREMENTS_ORACLE) ||
    semanticSha256(normalizedRequirements) !== EXPECTED_REQUIREMENTS_SHA256
  ) {
    fail("requirements initializer mismatch");
  }
  const digestInitializer = requirementsDigestEntry.initializer;
  const digestIsLiteral =
    digestInitializer.type === "Literal" &&
    digestInitializer.value === EXPECTED_REQUIREMENTS_SHA256;
  const digestIsExactComputation =
    digestInitializer.type === "CallExpression" &&
    !digestInitializer.optional &&
    digestInitializer.callee.type === "Identifier" &&
    digestInitializer.callee.name === "sha256" &&
    digestInitializer.arguments.length === 1 &&
    digestInitializer.arguments[0]?.type === "CallExpression" &&
    !digestInitializer.arguments[0].optional &&
    digestInitializer.arguments[0].callee.type === "Identifier" &&
    digestInitializer.arguments[0].callee.name === "canonicalJsonBytes" &&
    digestInitializer.arguments[0].arguments.length === 1 &&
    digestInitializer.arguments[0].arguments[0]?.type === "Identifier" &&
    digestInitializer.arguments[0].arguments[0].name === requirementsName;
  if (!digestIsLiteral && !digestIsExactComputation) {
    fail("requirements digest initializer mismatch");
  }

  const capabilityLookingString = (value) => {
    const normalized = value.toLowerCase();
    return (
      [...FORBIDDEN_EXACT_COMPILE_TIME_STRINGS].some((fragment) =>
        normalized.includes(fragment),
      ) ||
      FORBIDDEN_COMPILE_TIME_PATH_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix.toLowerCase()),
      ) ||
      FORBIDDEN_COMPILE_TIME_PATH_SUFFIXES.some((suffix) =>
        normalized.endsWith(suffix.toLowerCase()),
      )
    );
  };
  const normativeLiteralRoles = new Set([
    "import-source",
    "requirements-digest",
    "requirements-value",
  ]);
  const visitLiteral = (node, role) => {
    if (node.type !== "Literal") fail(`${role} must be a literal`);
    mark(node, `literal:${role}`);
    counters.literalCount += 1;
    if (node.regex !== undefined || typeof node.value === "bigint") {
      fail(`unsupported literal ${role}`);
    }
    if (
      typeof node.value === "string" &&
      capabilityLookingString(node.value) &&
      !["import-source", "requirements-digest", "requirements-value"].includes(
        role,
      )
    ) {
      fail(`capability-looking literal outside normative role ${node.value}`);
    }
    return typeof node.value === "string"
      ? makeValue("immutable", { staticStrings: [node.value] })
      : IMMUTABLE_VALUE;
  };
  const evaluateIdentifier = (node, scope, usage = "value") => {
    markIdentifier(node, `identifier:${usage}`, { reference: true });
    const binding = resolve(scope, node.name);
    if (binding.kind === "pending")
      fail(`binding used before proof ${node.name}`);
    if (binding.kind === "ambient" && binding.name === "Reflect") {
      fail("Reflect use is outside the closed subset");
    }
    if (usage === "callee") {
      if (binding.kind === "export-function") {
        fail(`internal call to exported operation ${node.name}`);
      }
      if (
        !["ambient", "import-callable", "local-function"].includes(binding.kind)
      ) {
        fail(`non-callable direct callee ${node.name}`);
      }
      return { binding, value: bindingValue(binding) };
    }
    if (usage === "constructor") {
      if (binding.kind !== "ambient") {
        fail(`non-ambient constructor ${node.name}`);
      }
      return { binding, value: bindingValue(binding) };
    }
    if (usage === "failure-callback") {
      if (binding.kind !== "local-function") {
        fail(`failure callback provenance ${node.name}`);
      }
      return { binding, value: bindingValue(binding) };
    }
    if (usage === "receiver") {
      if (!["ambient", "private-store"].includes(binding.kind)) {
        fail(`protected receiver provenance ${node.name}`);
      }
      return { binding, value: bindingValue(binding) };
    }
    if (protectedBindingKinds.has(binding.kind)) {
      fail(`protected binding used as value ${node.name}`);
    }
    return { binding, value: bindingValue(binding) };
  };

  let evaluateExpression;
  let visitStatement;
  let visitFunction;

  const visitProperty = (node, scope, context) => {
    if (
      node.type !== "Property" ||
      node.kind !== "init" ||
      node.method ||
      node.shorthand ||
      node.computed
    ) {
      fail("unclassified object property");
    }
    mark(node, "object-property");
    const normativeKey = context.literalRole === "requirements-value";
    let keyValue = IMMUTABLE_VALUE;
    if (node.key.type === "Identifier") {
      markIdentifier(node.key, "property-key");
      if (capabilityLookingString(node.key.name) && !normativeKey) {
        fail(
          `capability-looking property key outside requirements ${node.key.name}`,
        );
      }
      if (capabilityLookingString(node.key.name)) {
        keyValue = makeValue("immutable", {
          staticStrings: [node.key.name],
        });
      }
    } else if (node.key.type === "Literal") {
      keyValue = visitLiteral(
        node.key,
        normativeKey ? "requirements-value" : "property-key",
      );
    } else {
      fail(`object key ${node.key.type}`);
    }
    const propertyValue = evaluateExpression(node.value, scope, context);
    return valueWithOrigin("immutable", node, [keyValue, propertyValue]);
  };

  const evaluateMember = (node, scope, context, { asCallee = false } = {}) => {
    mark(node, asCallee ? "direct-member-callee" : "member-value");
    counters.memberCount += 1;
    counters.receiverCount += 1;
    if (node.optional) fail("optional member access");
    if (node.computed) fail("computed member access");
    if (node.property.type !== "Identifier") fail("non-identifier member");
    markIdentifier(node.property, "member-name");
    const memberName = node.property.name;
    if (
      FORBIDDEN_MEMBER_NAMES.includes(memberName) ||
      !ALLOWED_MEMBER_NAMES.has(memberName)
    ) {
      fail(`forbidden member ${memberName}`);
    }
    if (node.object.type === "ParenthesizedExpression") {
      fail("parenthesized receiver");
    }
    if (node.object.type === "Identifier") {
      const binding = resolve(scope, node.object.name);
      if (binding.kind === "private-store" || binding.kind === "ambient") {
        evaluateIdentifier(node.object, scope, "receiver");
        if (binding.kind === "private-store") {
          if (!["get", "has", "set"].includes(memberName)) {
            fail(`private-store member ${memberName}`);
          }
          if (!asCallee) fail("private-store member used as value");
          return {
            kind: "private-method",
            memberName,
            storeName: binding.name,
          };
        }
        if (binding.name === "Reflect") fail("Reflect member use");
        if (!ALLOWED_AMBIENT_MEMBERS.get(binding.name)?.has(memberName)) {
          fail(`ambient member ${binding.name}.${memberName}`);
        }
        if (!asCallee) fail("ambient member used as value");
        return {
          kind: "ambient-method",
          ambientName: binding.name,
          memberName,
        };
      }
    }
    const receiver = evaluateExpression(node.object, scope, context);
    requireTrusted(receiver, `used as receiver for .${memberName}`, {
      allowMutable: true,
    });
    if (asCallee) {
      if (!safeMemberMethods.has(memberName)) {
        fail(`non-callable approved member ${memberName}`);
      }
      if (["add", "push"].includes(memberName)) {
        fail(`mutating member call ${memberName}`);
      }
      return { kind: "safe-method", memberName, receiver };
    }
    if (safeMemberMethods.has(memberName)) {
      fail(`method member used as value ${memberName}`);
    }
    if (memberName === "bytes") {
      return valueWithOrigin("mutable-local", node, [receiver]);
    }
    return valueWithOrigin("immutable", node, [receiver]);
  };

  const evaluateArguments = (
    nodes,
    scope,
    context,
    { failureCallbackIndex = null } = {},
  ) =>
    nodes.map((argument, index) => {
      if (argument.type === "SpreadElement") fail("spread argument");
      if (index === failureCallbackIndex) {
        if (argument.type !== "Identifier") {
          fail("failure callback must be a direct identifier");
        }
        const { binding, value } = evaluateIdentifier(
          argument,
          scope,
          "failure-callback",
        );
        recordCallEdge(context.functionRecord, binding.name);
        const callbackRecord = functionRecords.get(binding.name);
        visitFunction(callbackRecord);
        if (!callbackRecord.provenNonReturning) {
          fail(`failure callback may return ${binding.name}`);
        }
        return value;
      }
      return evaluateExpression(argument, scope, context);
    });

  const assertAcyclicLocalCallGraph = () => {
    const names = [...functionRecords.keys()].sort();
    const adjacency = new Map(names.map((name) => [name, []]));
    for (const edge of moduleCallEdges) {
      const [from, to] = edge.split("\u0000");
      adjacency.get(from).push(to);
    }
    for (const targets of adjacency.values()) targets.sort();

    let nextIndex = 0;
    const indices = new Map();
    const lowLinks = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];
    const visit = (name) => {
      indices.set(name, nextIndex);
      lowLinks.set(name, nextIndex);
      nextIndex += 1;
      stack.push(name);
      onStack.add(name);
      for (const target of adjacency.get(name)) {
        if (!indices.has(target)) {
          visit(target);
          lowLinks.set(
            name,
            Math.min(lowLinks.get(name), lowLinks.get(target)),
          );
        } else if (onStack.has(target)) {
          lowLinks.set(name, Math.min(lowLinks.get(name), indices.get(target)));
        }
      }
      if (lowLinks.get(name) !== indices.get(name)) return;
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== name);
      components.push(component.sort());
    };
    for (const name of names) {
      if (!indices.has(name)) visit(name);
    }
    const recursiveComponent = components
      .filter(
        (component) =>
          component.length > 1 ||
          adjacency.get(component[0]).includes(component[0]),
      )
      .sort((left, right) => left[0].localeCompare(right[0]))[0];
    if (recursiveComponent !== undefined) {
      fail(`recursive call graph ${recursiveComponent.join(" -> ")}`);
    }
  };

  const recordCallEdge = (from, to) => {
    if (from === null) fail(`module initializer called local function ${to}`);
    const edge = `${from.name}\u0000${to}`;
    if (!moduleCallEdges.has(edge)) {
      moduleCallEdges.add(edge);
      counters.moduleCallEdgeCount += 1;
      assertAcyclicLocalCallGraph();
    }
  };

  const evaluateCall = (node, scope, context) => {
    mark(node, "call-expression");
    counters.callCount += 1;
    counters.calleeCount += 1;
    context.functionRecord?.calls.push({
      node,
      controlDepth: context.controlDepth,
      directStatement: context.directStatement,
    });
    if (node.optional) fail("optional call");
    if (node.callee.type === "ParenthesizedExpression") {
      fail("parenthesized or indirect call");
    }
    if (node.callee.type === "Identifier") {
      const { binding } = evaluateIdentifier(node.callee, scope, "callee");
      const allowedArities = importedCallArities.get(binding.name);
      if (
        binding.kind === "import-callable" &&
        !allowedArities?.has(node.arguments.length)
      ) {
        fail(`imported callee arity ${binding.name}`);
      }
      const arguments_ = evaluateArguments(node.arguments, scope, context, {
        failureCallbackIndex:
          importedFailureCallbackIndex.get(binding.name) ?? null,
      });
      if (binding.kind === "import-callable") {
        if (binding.name === "deepFreeze") {
          if (
            arguments_.length !== 1 ||
            !arguments_[0].freezable ||
            arguments_[0].tainted
          ) {
            fail("deepFreeze argument provenance");
          }
          return frozenValue(arguments_[0]);
        }
        if (binding.name === "nullRecord") {
          if (
            arguments_.length !== 1 ||
            arguments_[0].kind !== "mutable-local" ||
            arguments_[0].tainted
          ) {
            fail("nullRecord argument provenance");
          }
          return valueWithOrigin("mutable-local", node, arguments_);
        }
        if (importedNormalizers.has(binding.name)) {
          const rawFirstArgumentAllowed = new Set([
            "boundedInteger",
            "copyBoundedBuffer",
            "decodeCanonicalBase64",
            "exactBoolean",
            "exactDigest",
          ]).has(binding.name);
          for (let index = 0; index < arguments_.length; index += 1) {
            if (index === importedFailureCallbackIndex.get(binding.name)) {
              continue;
            }
            if (
              index === 0 &&
              rawFirstArgumentAllowed &&
              arguments_[index].kind === "untrusted"
            ) {
              continue;
            }
            requireTrusted(
              arguments_[index],
              `normalizer argument ${binding.name}[${index}]`,
              { allowMutable: true },
            );
          }
          if (binding.name === "copyBoundedBuffer") {
            return valueWithOrigin("mutable-local", node);
          }
          if (
            ["decodeCanonicalBase64", "decodeCanonicalJsonLine"].includes(
              binding.name,
            )
          ) {
            return valueWithOrigin("mutable-local", node);
          }
          if (binding.name === "exactRecord") return arguments_[0];
          return IMMUTABLE_VALUE;
        }
        for (const argument of arguments_) {
          requireTrusted(argument, `passed to ${binding.name}`, {
            allowMutable: true,
          });
        }
        if (importedFrozenResults.has(binding.name)) {
          return valueWithOrigin(
            "frozen",
            node,
            binding.name === "frozenCopyOnReadBytes" ? [] : arguments_,
          );
        }
        if (
          ["canonicalJsonBytes", "canonicalJsonLine"].includes(binding.name)
        ) {
          return valueWithOrigin("mutable-local", node);
        }
        if (binding.name === "sha256") return IMMUTABLE_VALUE;
        fail(`unclassified imported callee ${binding.name}`);
      }
      if (binding.kind === "ambient") {
        if (!["Boolean", "Number", "String"].includes(binding.name)) {
          fail(`ambient direct call ${binding.name}`);
        }
        for (const argument of arguments_) {
          requireTrusted(argument, `ambient coercion ${binding.name}`);
        }
        if (binding.name === "String") {
          return valueWithOrigin("immutable", node, arguments_, {
            staticStrings: arguments_[0]?.staticStrings ?? [""],
          });
        }
        return IMMUTABLE_VALUE;
      }
      if (binding.kind === "local-function") {
        for (const argument of arguments_) {
          requireTrusted(argument, `passed to local function ${binding.name}`);
        }
        recordCallEdge(context.functionRecord, binding.name);
        return visitFunction(functionRecords.get(binding.name));
      }
      fail(`unclassified direct callee ${binding.name}`);
    }
    if (node.callee.type !== "MemberExpression") {
      fail(`indirect callee ${node.callee.type}`);
    }
    const member = evaluateMember(node.callee, scope, context, {
      asCallee: true,
    });
    const arguments_ = evaluateArguments(node.arguments, scope, context);
    if (member.kind === "private-method") {
      counters.privateOperationCount += 1;
      if (["has", "get"].includes(member.memberName)) {
        const functionName = context.functionRecord?.name ?? "<module>";
        const policy = PRIVATE_LOOKUP_POLICY_BY_FUNCTION_STORE.get(
          `${functionName}\u0000${member.storeName}`,
        );
        if (policy === undefined) {
          fail(
            `private lookup policy ${functionName}:${member.storeName}.${member.memberName}`,
          );
        } else {
          const argumentLabel = privateLookupArgumentLabel(node.arguments);
          const argumentNode = node.arguments[0];
          const argumentBinding =
            node.arguments.length === 1 && argumentNode.type === "Identifier"
              ? resolve(scope, argumentNode.name)
              : null;
          if (
            node.arguments.length !== 1 ||
            argumentNode.type !== "Identifier" ||
            argumentNode.name !== policy.keyParameterName ||
            argumentBinding !==
              context.parameterBindings.get(policy.keyParameterName)
          ) {
            fail(
              `private lookup key ${functionName}:${member.storeName}.${member.memberName}:${argumentLabel}`,
            );
          } else {
            privateLookups.push({
              functionName,
              storeName: member.storeName,
              method: member.memberName,
              keyParameterName: argumentNode.name,
            });
          }
        }
        const lookupResult =
          member.memberName === "has"
            ? IMMUTABLE_VALUE
            : makeValue("private-read", {
                freezable: false,
                origins: [
                  node,
                  ...arguments_.flatMap(({ origins }) => origins),
                ],
                tainted: true,
              });
        privateLookupResultPolicies.push({
          functionName,
          storeName: member.storeName,
          method: member.memberName,
          keyParameterName: node.arguments[0].name,
          kind: lookupResult.kind,
          freezable: lookupResult.freezable,
          tainted: lookupResult.tainted,
        });
        return lookupResult;
      }
      counters.mutationCount += 1;
      counters.privateCommitCount += 1;
      if (
        arguments_.length !== 2 ||
        node.arguments.some((argument) => argument.type !== "Identifier")
      ) {
        fail("private commit requires two identifiers");
      }
      if (
        node.arguments.some((argument) => {
          const binding = resolve(scope, argument.name);
          return binding.kind !== "local" || binding.scope !== scope;
        })
      ) {
        fail("private commit requires function-local arguments");
      }
      const expectedStore = PRIVATE_STORE_OWNER_BY_FUNCTION.get(
        context.functionRecord?.name,
      );
      if (expectedStore !== member.storeName) {
        fail(
          `private commit owner ${context.functionRecord?.name ?? "<module>"}`,
        );
      }
      if (
        context.controlDepth !== 0 ||
        context.expressionStatement?.expression !== node ||
        context.directStatement !== context.expressionStatement
      ) {
        fail("private commit must be a direct function-body statement");
      }
      const [keyValue, metadataValue] = arguments_;
      if (
        keyValue.kind !== "frozen" ||
        metadataValue.kind !== "frozen" ||
        !valuesAreDisjoint(keyValue, metadataValue)
      ) {
        fail("private commit arguments must be frozen and disjoint");
      }
      const commit = {
        call: node,
        functionName: context.functionRecord.name,
        storeName: member.storeName,
        statement: context.expressionStatement,
        keyName: node.arguments[0].name,
        metadataName: node.arguments[1].name,
      };
      context.functionRecord.commits.push(commit);
      privateCommits.push(commit);
      return IMMUTABLE_VALUE;
    }
    for (const argument of arguments_) {
      requireTrusted(argument, `passed to member ${member.memberName}`, {
        allowMutable: true,
      });
    }
    if (member.kind === "ambient-method") {
      if (
        member.ambientName === "Object" &&
        ["create", "defineProperty", "freeze"].includes(member.memberName)
      ) {
        fail(`ambient heap mutation ${member.memberName}`);
      }
      return IMMUTABLE_VALUE;
    }
    if (["at", "get", "slice"].includes(member.memberName)) {
      return valueWithOrigin("mutable-local", node, [member.receiver]);
    }
    return IMMUTABLE_VALUE;
  };

  const evaluateNew = (node, scope, context) => {
    mark(node, "new-expression");
    counters.callCount += 1;
    counters.calleeCount += 1;
    context.functionRecord?.calls.push({
      node,
      controlDepth: context.controlDepth,
      directStatement: context.directStatement,
    });
    if (node.callee.type !== "Identifier") fail("indirect constructor");
    const { binding } = evaluateIdentifier(node.callee, scope, "constructor");
    const arguments_ = evaluateArguments(node.arguments, scope, context);
    if (!["Error", "Set", "WeakMap"].includes(binding.name)) {
      fail(`constructor ${binding.name}`);
    }
    for (const argument of arguments_) {
      requireTrusted(argument, `constructor ${binding.name}`, {
        allowMutable: true,
      });
    }
    if (binding.name === "Error") return valueWithOrigin("error", node);
    return valueWithOrigin("mutable-local", node, arguments_);
  };

  evaluateExpression = (node, scope, context = {}) => {
    const literalRole = context.literalRole ?? "ordinary";
    if (node.type === "Identifier") {
      return evaluateIdentifier(node, scope).value;
    }
    if (node.type === "Literal") return visitLiteral(node, literalRole);
    if (node.type === "ArrayExpression") {
      mark(node, "array-expression");
      if (node.elements.some((element) => element === null)) {
        fail("array hole");
      }
      const children = node.elements.map((element) => {
        if (element.type === "SpreadElement") fail("array spread");
        return evaluateExpression(element, scope, context);
      });
      return valueWithOrigin("mutable-local", node, children);
    }
    if (node.type === "ObjectExpression") {
      mark(node, "object-expression");
      const children = node.properties.map((property) =>
        visitProperty(property, scope, context),
      );
      return valueWithOrigin("mutable-local", node, children);
    }
    if (node.type === "CallExpression") {
      return evaluateCall(node, scope, context);
    }
    if (node.type === "NewExpression") return evaluateNew(node, scope, context);
    if (node.type === "MemberExpression") {
      return evaluateMember(node, scope, context);
    }
    if (node.type === "ParenthesizedExpression") {
      mark(node, "parenthesized-expression");
      return evaluateExpression(node.expression, scope, context);
    }
    if (node.type === "UnaryExpression") {
      mark(node, "unary-expression");
      if (!["!", "-", "typeof", "void"].includes(node.operator)) {
        fail(`unary operator ${node.operator}`);
      }
      const argument = evaluateExpression(node.argument, scope, context);
      requireTrusted(argument, `unary coercion ${node.operator}`);
      return IMMUTABLE_VALUE;
    }
    if (node.type === "BinaryExpression") {
      mark(node, "binary-expression");
      const left = evaluateExpression(node.left, scope, context);
      const right = evaluateExpression(node.right, scope, context);
      requireTrusted(left, `binary ${node.operator}`);
      requireTrusted(right, `binary ${node.operator}`);
      let staticStrings = [];
      if (
        node.operator === "+" &&
        left.staticStrings.length > 0 &&
        right.staticStrings.length > 0
      ) {
        staticStrings = mergeStaticStrings(
          left.staticStrings.flatMap((leftValue) =>
            right.staticStrings.map((rightValue) => leftValue + rightValue),
          ),
        );
        const constructedCapabilityString = staticStrings.find((candidate) =>
          capabilityLookingString(candidate),
        );
        if (
          constructedCapabilityString !== undefined &&
          !normativeLiteralRoles.has(literalRole)
        ) {
          fail(
            `capability-looking constructed literal outside normative role ${constructedCapabilityString}`,
          );
        }
      }
      return valueWithOrigin("immutable", node, [left, right], {
        staticStrings,
      });
    }
    if (node.type === "LogicalExpression") {
      mark(node, "logical-expression");
      const left = evaluateExpression(node.left, scope, context);
      requireTrusted(left, `logical ${node.operator}`);
      const right = evaluateExpression(node.right, scope, {
        ...context,
        controlDepth: (context.controlDepth ?? 0) + 1,
      });
      return joinValues(
        left,
        right,
        node.operator === "||" ? "logical OR" : `logical ${node.operator}`,
      );
    }
    if (node.type === "ConditionalExpression") {
      mark(node, "conditional-expression");
      const testValue = evaluateExpression(node.test, scope, context);
      requireTrusted(testValue, "conditional test");
      const branchContext = {
        ...context,
        controlDepth: (context.controlDepth ?? 0) + 1,
      };
      const consequent = evaluateExpression(
        node.consequent,
        scope,
        branchContext,
      );
      const alternate = evaluateExpression(
        node.alternate,
        scope,
        branchContext,
      );
      return joinValues(consequent, alternate, "conditional expression");
    }
    if (node.type === "AssignmentExpression") {
      mark(node, "assignment-expression");
      counters.mutationCount += 1;
      fail("binding or member assignment");
    }
    if (node.type === "UpdateExpression") {
      mark(node, "update-expression");
      counters.mutationCount += 1;
      fail("binding or member update");
    }
    fail(`unclassified expression ${node.type}`);
  };

  const visitVariableDeclaration = (
    node,
    scope,
    context,
    { module = false, loopValue = null } = {},
  ) => {
    mark(node, module ? "module-variable-declaration" : "variable-declaration");
    if (node.kind !== "const" || node.declarations.length !== 1) {
      fail("only one const declarator is supported");
    }
    const declarator = node.declarations[0];
    mark(declarator, "variable-declarator");
    if (declarator.id.type !== "Identifier") fail("destructuring binding");
    markIdentifier(declarator.id, "binding");
    let binding;
    if (module) {
      binding = moduleScope.bindings.get(declarator.id.name);
      if (binding === undefined) {
        fail(`unregistered module binding ${declarator.id.name}`);
      }
    } else {
      binding = declare(scope, declarator.id.name, {
        kind: "local",
        value: null,
        node: declarator.id,
      });
    }
    let value;
    if (loopValue !== null) {
      if (declarator.init !== null) fail("for-of binding initializer");
      value = loopValue;
    } else {
      if (declarator.init === null) fail("uninitialized const");
      const name = declarator.id.name;
      const literalRole = requirementsDependencies.has(name)
        ? "requirements-value"
        : name ===
            "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256"
          ? "requirements-digest"
          : "ordinary";
      value = evaluateExpression(declarator.init, scope, {
        ...context,
        literalRole,
      });
    }
    if (module && binding.kind === "private-store") {
      if (
        declarator.init.type !== "NewExpression" ||
        declarator.init.callee.type !== "Identifier" ||
        declarator.init.callee.name !== "WeakMap" ||
        declarator.init.arguments.length !== 0
      ) {
        fail(`private store initializer ${binding.name}`);
      }
      return;
    }
    if (module && mutableKinds.has(value.kind)) {
      fail(`mutable module binding ${binding.name}`);
    }
    binding.kind = binding.kind === "export-value" ? binding.kind : "local";
    binding.value = value;
  };

  const visitBlock = (node, scope, context, { functionBody = false } = {}) => {
    mark(node, functionBody ? "function-body" : "block-statement");
    const blockScope = functionBody
      ? scope
      : { parent: scope, bindings: new Map() };
    let blockCompletion = completion("normal");
    for (const statement of node.body) {
      const statementContext = functionBody
        ? {
            ...context,
            directStatement: statement,
            expressionStatement: null,
          }
        : { ...context, controlDepth: context.controlDepth + 1 };
      blockCompletion = sequenceCompletions(
        blockCompletion,
        visitStatement(statement, blockScope, statementContext),
      );
    }
    return blockCompletion;
  };

  visitStatement = (node, scope, context) => {
    if (node.type === "VariableDeclaration") {
      visitVariableDeclaration(node, scope, context);
      return completion("normal");
    }
    if (node.type === "ReturnStatement") {
      mark(node, "return-statement");
      const value =
        node.argument === null
          ? IMMUTABLE_VALUE
          : evaluateExpression(node.argument, scope, context);
      const escapedCapabilityString = value.staticStrings.find((candidate) =>
        capabilityLookingString(candidate),
      );
      if (escapedCapabilityString !== undefined) {
        fail(
          `capability-looking normative literal returned from function ${escapedCapabilityString}`,
        );
      }
      if (
        value.kind === "untrusted" ||
        value.kind === "unknown" ||
        mutableKinds.has(value.kind) ||
        value.tainted
      ) {
        recordRawEscape("returned from function");
      }
      context.returnValues.push(value);
      context.returnStatements.push(node);
      return completion("return");
    }
    if (node.type === "ExpressionStatement") {
      mark(node, "expression-statement");
      evaluateExpression(node.expression, scope, {
        ...context,
        expressionStatement: node,
      });
      return completion("normal");
    }
    if (node.type === "BlockStatement") {
      return visitBlock(node, scope, context);
    }
    if (node.type === "IfStatement") {
      mark(node, "if-statement");
      const testValue = evaluateExpression(node.test, scope, context);
      requireTrusted(testValue, "if condition");
      counters.joinCount += 1;
      const consequentCompletion = visitStatement(node.consequent, scope, {
        ...context,
        controlDepth: context.controlDepth + 1,
      });
      const alternateCompletion =
        node.alternate === null
          ? completion("normal")
          : visitStatement(node.alternate, scope, {
              ...context,
              controlDepth: context.controlDepth + 1,
            });
      return unionCompletions(consequentCompletion, alternateCompletion);
    }
    if (node.type === "ForOfStatement") {
      mark(node, "for-of-statement");
      if (node.await || node.left.type !== "VariableDeclaration") {
        fail("for-of syntax");
      }
      const iterable = evaluateExpression(node.right, scope, context);
      requireTrusted(iterable, "iterated", { allowMutable: false });
      if (iterable.kind !== "frozen") fail("iterable must be frozen");
      counters.joinCount += 1;
      const loopScope = { parent: scope, bindings: new Map() };
      visitVariableDeclaration(node.left, loopScope, context, {
        loopValue: IMMUTABLE_VALUE,
      });
      const bodyCompletion = visitStatement(node.body, loopScope, {
        ...context,
        controlDepth: context.controlDepth + 1,
      });
      return unionCompletions(completion("normal"), bodyCompletion);
    }
    if (node.type === "ThrowStatement") {
      mark(node, "throw-statement");
      const value = evaluateExpression(node.argument, scope, context);
      requireTrusted(value, "thrown", { allowMutable: true });
      return completion("throw");
    }
    if (node.type === "EmptyStatement") {
      mark(node, "empty-statement");
      return completion("normal");
    }
    fail(`unclassified statement ${node.type}`);
  };

  visitFunction = (record) => {
    if (record === undefined) fail("unknown function record");
    if (record.status === "complete") return record.returnValue;
    if (record.status === "analyzing")
      fail(`recursive call graph ${record.name}`);
    record.status = "analyzing";
    const node = record.node;
    mark(node, record.exported ? "exported-function" : "local-function");
    markIdentifier(node.id, "function-binding");
    const scope = { parent: moduleScope, bindings: new Map() };
    const parameterBindings = new Map();
    for (const parameter of node.params) {
      if (parameter.type !== "Identifier") fail("non-identifier parameter");
      markIdentifier(parameter, "parameter-binding");
      parameterBindings.set(
        parameter.name,
        declare(scope, parameter.name, {
          kind: "parameter",
          value: UNTRUSTED_VALUE,
          node: parameter,
        }),
      );
    }
    const context = {
      functionRecord: record,
      parameterBindings,
      returnValues: [],
      returnStatements: [],
      controlDepth: 0,
      directStatement: null,
      expressionStatement: null,
      literalRole: "ordinary",
    };
    const functionCompletion = visitBlock(node.body, scope, context, {
      functionBody: true,
    });
    const [onlyStatement] = node.body.body;
    record.provenNonReturning =
      node.params.length === 0 &&
      node.body.body.length === 1 &&
      onlyStatement.type === "ThrowStatement" &&
      onlyStatement.argument.type === "NewExpression" &&
      onlyStatement.argument.callee.type === "Identifier" &&
      onlyStatement.argument.callee.name === "Error" &&
      onlyStatement.argument.arguments.length === 1 &&
      onlyStatement.argument.arguments[0].type === "Literal" &&
      typeof onlyStatement.argument.arguments[0].value === "string" &&
      pinnedFailureCodes.has(onlyStatement.argument.arguments[0].value);
    const expectedStore = PRIVATE_STORE_OWNER_BY_FUNCTION.get(record.name);
    if (expectedStore === undefined) {
      if (record.commits.length !== 0)
        fail(`commit in non-owner ${record.name}`);
    } else {
      if (
        record.commits.length !== 1 ||
        record.commits[0].storeName !== expectedStore
      ) {
        fail(`exact private commit count ${record.name}`);
      }
      const commit = record.commits[0];
      const body = node.body.body;
      const commitIndex = body.indexOf(commit.statement);
      const returnStatement = body.at(-1);
      if (
        context.returnStatements.length !== 1 ||
        context.returnStatements[0] !== returnStatement ||
        commitIndex !== body.length - 2 ||
        returnStatement?.type !== "ReturnStatement" ||
        returnStatement.argument?.type !== "Identifier" ||
        returnStatement.argument.name !== commit.keyName ||
        commit.keyName === commit.metadataName
      ) {
        fail(`private commit tail ${record.name}`);
      }
      counters.privateOwnerReturnCount += context.returnStatements.length;
      for (const call of record.calls) {
        if (call.node === commit.call) continue;
        const statementIndex = body.indexOf(call.directStatement);
        if (call.controlDepth !== 0 || statementIndex >= commitIndex) {
          fail(`fallible operation does not dominate commit ${record.name}`);
        }
        counters.privateDominatedCallCount += 1;
      }
    }
    if (expectedStore !== undefined && !functionCompletion.has("return")) {
      fail(`private commit return unreachable ${record.name}`);
    }
    if (functionCompletion.has("normal")) {
      fail(`function may complete without explicit return ${record.name}`);
    }
    let returnValue = IMMUTABLE_VALUE;
    if (context.returnValues.length > 0) {
      returnValue = context.returnValues[0];
      for (const value of context.returnValues.slice(1)) {
        returnValue = joinValues(
          returnValue,
          value,
          `returns of ${record.name}`,
        );
      }
    }
    record.returnValue = returnValue;
    record.status = "complete";
    return returnValue;
  };

  const visitImport = (node) => {
    mark(node, "import-declaration");
    for (const specifier of node.specifiers) {
      mark(specifier, "import-specifier");
      markIdentifier(specifier.local, "import-binding");
      if (specifier.imported !== specifier.local) {
        markIdentifier(specifier.imported, "imported-name");
      }
    }
    visitLiteral(node.source, "import-source");
  };
  const visitModuleStatement = (node) => {
    if (node.type === "ImportDeclaration") {
      visitImport(node);
      return;
    }
    if (node.type === "ExportNamedDeclaration") {
      mark(node, "export-declaration");
      if (node.declaration.type === "VariableDeclaration") {
        visitVariableDeclaration(
          node.declaration,
          moduleScope,
          {
            functionRecord: null,
            literalRole: "ordinary",
          },
          { module: true },
        );
      } else {
        visitFunction(functionRecords.get(node.declaration.id.name));
      }
      return;
    }
    if (node.type === "VariableDeclaration") {
      visitVariableDeclaration(
        node,
        moduleScope,
        { functionRecord: null, literalRole: "ordinary" },
        { module: true },
      );
      return;
    }
    if (node.type === "FunctionDeclaration") {
      visitFunction(functionRecords.get(node.id.name));
      return;
    }
    if (node.type === "EmptyStatement") {
      mark(node, "module-empty-statement");
      return;
    }
    fail(`unclassified module node ${node.type}`);
  };

  mark(program, "program");
  for (const statement of program.body) visitModuleStatement(statement);
  if (privateCommits.length !== EXPECTED_PRIVATE_STORE_COMMITS.length) {
    fail("exact ten private commits");
  }
  for (const expected of EXPECTED_PRIVATE_STORE_COMMITS) {
    const matches = privateCommits.filter(
      ({ functionName, storeName }) =>
        functionName === expected.functionName &&
        storeName === expected.storeName,
    );
    if (matches.length !== 1) {
      fail(`private commit manifest ${expected.functionName}`);
    }
  }
  const storeCounts = Object.fromEntries(
    [...privateStoreNames].map((storeName) => [
      storeName,
      privateCommits.filter((commit) => commit.storeName === storeName).length,
    ]),
  );
  if (
    storeCounts.startupMetadata !== 1 ||
    storeCounts.inputMetadata !== 7 ||
    storeCounts.stateMetadata !== 2
  ) {
    fail("private commit 1/7/2 store manifest");
  }
  if (counters.classifiedNodeCount !== expectedNodeCount) {
    fail(`node closure ${counters.classifiedNodeCount}/${expectedNodeCount}`);
  }
  if (counters.rawEscapeCount !== 0 || counters.unknownProvenanceCount !== 0) {
    fail("nonzero escape or unknown-provenance counter");
  }
  return Object.freeze({
    ...counters,
    privateStoreCommitCounts: Object.freeze(storeCounts),
    privateStoreCommitManifest: Object.freeze(
      EXPECTED_PRIVATE_STORE_COMMITS.map((entry) =>
        Object.freeze({ ...entry }),
      ),
    ),
    privateLookupOperations: Object.freeze(
      privateLookups.map((entry) => Object.freeze({ ...entry })),
    ),
    privateLookupResultPolicies: Object.freeze(
      privateLookupResultPolicies.map((entry) => Object.freeze({ ...entry })),
    ),
    moduleCallEdges: Object.freeze([...moduleCallEdges].sort()),
    nodeRoleCount: counters.classifiedNodeCount,
  });
}

function auditCandidateSource(source, stageAudit = null) {
  if (stageAudit !== null) stageAudit.expectedStage = "parse";
  const parsed = parseCandidateModuleAst(source);
  if (stageAudit !== null) {
    stageAudit.astNodeCount = parsed.nodeCount;
    stageAudit.astSha256 = semanticSha256(
      normalizeAstForEvidence(parsed.program),
    );
    stageAudit.expectedStage = "lex";
  }
  const tokens = lexCandidateSource(source);
  if (stageAudit !== null) stageAudit.expectedStage = "bounded-source-subset";
  assertBoundedSourceSubset(tokens);
  if (stageAudit !== null) stageAudit.expectedStage = "imports";
  const imports = parseExactImports(tokens);
  if (stageAudit !== null) stageAudit.expectedStage = "exports";
  const exports = parseExactExports(tokens);
  if (stageAudit !== null) stageAudit.expectedStage = "private-store-manifest";
  const privateStores = assertExactPrivateStoreManifest(tokens);
  if (stageAudit !== null) stageAudit.expectedStage = "module-initialization";
  const moduleStoreCount = assertModuleInitializationClosure(tokens);
  if (stageAudit !== null) stageAudit.expectedStage = "identifier-closure";
  const identifierClosure = assertPositiveIdentifierClosure(
    tokens,
    imports,
    exports,
  );
  if (stageAudit !== null) {
    stageAudit.estreePolicyReached = true;
    stageAudit.expectedStage = "estree-policy";
  }
  const astPolicy = assertRejectByDefaultEstreePolicy(
    parsed.program,
    parsed.nodeCount,
  );
  if (stageAudit !== null) stageAudit.expectedStage = "accepted";
  return Object.freeze({
    importCount: imports.declarations.length,
    importedNameCount: imports.declarations.reduce(
      (count, declaration) => count + declaration.names.length,
      0,
    ),
    exportCount: exports.declarations.length,
    privateStoreCount: privateStores.length,
    scopeCount: identifierClosure.scopeCount,
    bindingCount: identifierClosure.bindingCount,
    moduleStoreCount,
    astNodeCount: parsed.nodeCount,
    astPolicy,
  });
}

function sourceSkeleton(extra = "", functionBodyOverrides = new Map()) {
  const importText = [...ALLOWED_IMPORTS]
    .map(
      ([specifier, names]) =>
        `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`,
    )
    .join("\n");
  const requirementsSource = JSON.stringify(REQUIREMENTS_ORACLE);
  const exports = EXPECTED_EXPORT_MANIFEST.map((entry) => {
    if (
      entry.name === "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS"
    ) {
      return `export const ${entry.name} = deepFreeze(${requirementsSource});`;
    }
    if (
      entry.name ===
      "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256"
    ) {
      const digestSource = JSON.stringify(EXPECTED_REQUIREMENTS_SHA256);
      return `export const ${entry.name} = ${digestSource};`;
    }
    if (entry.kind === "const") {
      throw new Error(`unclassified synthetic const export ${entry.name}`);
    }
    const signature = EXPECTED_FUNCTION_SIGNATURES.find(
      ({ name }) => name === entry.name,
    );
    const storeName = PRIVATE_STORE_OWNER_BY_FUNCTION.get(entry.name);
    const body =
      functionBodyOverrides.get(entry.name) ??
      (storeName === undefined
        ? "return null;"
        : `const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); ${storeName}.set(result, metadata); return result;`);
    const parameters = signature.parameters.join(", ");
    return `export function ${entry.name}(${parameters}) { ${body} }`;
  }).join("\n");
  return `${importText}\nconst startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();\n${exports}\n${extra}\n`;
}

const PRIVATE_COMMIT_DOMINANCE_FAMILIES = Object.freeze([
  Object.freeze({ name: "if branch", probeName: "dominanceProbe1" }),
  Object.freeze({
    name: "conditional expression",
    probeName: "dominanceProbe2",
  }),
  Object.freeze({ name: "logical AND RHS", probeName: "dominanceProbe3" }),
  Object.freeze({ name: "logical OR RHS", probeName: "dominanceProbe4" }),
  Object.freeze({
    name: "logical nullish RHS",
    probeName: "dominanceProbe5",
  }),
]);

const EXPECTED_PRIVATE_COMMIT_DOMINANCE_OWNER_RANGES = Object.freeze([
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStartupV1",
    storeName: "startupMetadata",
    firstId: "SEM-N148",
    lastId: "SEM-N152",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianAdmissionInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N153",
    lastId: "SEM-N157",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianCancelInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N158",
    lastId: "SEM-N162",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianRecoveryRequestInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N163",
    lastId: "SEM-N167",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianControllerClosedInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N168",
    lastId: "SEM-N172",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianDiagnosticFailureInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N173",
    lastId: "SEM-N177",
  }),
  Object.freeze({
    functionName:
      "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N178",
    lastId: "SEM-N182",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStatusEofInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N183",
    lastId: "SEM-N187",
  }),
  Object.freeze({
    functionName: "initializeCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    firstId: "SEM-N188",
    lastId: "SEM-N192",
  }),
  Object.freeze({
    functionName: "reduceCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    firstId: "SEM-N193",
    lastId: "SEM-N197",
  }),
]);

function privateCommitDominanceBranch(familyName, probeName) {
  if (familyName === "if branch") {
    return `if (true) { sha256(canonicalJsonBytes(${probeName})); }`;
  }
  if (familyName === "conditional expression") {
    return `const dominanceBranch = false ? sha256(canonicalJsonBytes(${probeName})) : null;`;
  }
  if (familyName === "logical AND RHS") {
    return `const dominanceBranch = false && sha256(canonicalJsonBytes(${probeName}));`;
  }
  if (familyName === "logical OR RHS") {
    return `const dominanceBranch = true || sha256(canonicalJsonBytes(${probeName}));`;
  }
  if (familyName === "logical nullish RHS") {
    return `const dominanceBranch = true ?? sha256(canonicalJsonBytes(${probeName}));`;
  }
  throw new Error(`unclassified private commit dominance family ${familyName}`);
}

const PRIVATE_COMMIT_DOMINANCE_CONTROLS = Object.freeze(
  EXPECTED_PRIVATE_STORE_COMMITS.flatMap(
    ({ functionName, storeName }, ownerIndex) =>
      PRIVATE_COMMIT_DOMINANCE_FAMILIES.map(
        ({ name: familyName, probeName }, familyIndex) => {
          const body = [
            "const result = deepFreeze(nullRecord([]));",
            "const metadata = deepFreeze(nullRecord([]));",
            `const ${probeName} = null;`,
            privateCommitDominanceBranch(familyName, probeName),
            `${storeName}.set(result, metadata);`,
            "return result;",
          ].join(" ");
          return Object.freeze({
            id: staticControlId(
              "SEM-N",
              147 +
                ownerIndex * PRIVATE_COMMIT_DOMINANCE_FAMILIES.length +
                familyIndex,
            ),
            functionName,
            storeName,
            familyName,
            name: `${functionName} pre-commit ${familyName} dominance`,
            source: sourceSkeleton("", new Map([[functionName, body]])),
            expected: new RegExp(
              `^Error: static gate: ESTree fallible operation does not dominate commit ${functionName}$`,
              "u",
            ),
          });
        },
      ),
  ),
);
assert.equal(PRIVATE_COMMIT_DOMINANCE_CONTROLS.length, 50);

const PRIVATE_COMMIT_TAIL_FAMILIES = Object.freeze([
  "post-commit operation",
  "extra tail statement",
  "wrong return/metadata path",
]);

const EXPECTED_PRIVATE_COMMIT_TAIL_OWNER_RANGES = Object.freeze([
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStartupV1",
    storeName: "startupMetadata",
    firstId: "SEM-N198",
    lastId: "SEM-N200",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianAdmissionInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N201",
    lastId: "SEM-N203",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianCancelInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N204",
    lastId: "SEM-N206",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianRecoveryRequestInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N207",
    lastId: "SEM-N209",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianControllerClosedInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N210",
    lastId: "SEM-N212",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianDiagnosticFailureInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N213",
    lastId: "SEM-N215",
  }),
  Object.freeze({
    functionName:
      "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N216",
    lastId: "SEM-N218",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStatusEofInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N219",
    lastId: "SEM-N221",
  }),
  Object.freeze({
    functionName: "initializeCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    firstId: "SEM-N222",
    lastId: "SEM-N224",
  }),
  Object.freeze({
    functionName: "reduceCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    firstId: "SEM-N225",
    lastId: "SEM-N227",
  }),
]);

function privateCommitTailBody(familyName, storeName) {
  if (familyName === "post-commit operation") {
    return `const postCommitResult = deepFreeze(nullRecord([])); const postCommitMetadata = deepFreeze(nullRecord([])); const postCommitProbe = null; ${storeName}.set(postCommitResult, postCommitMetadata); sha256(canonicalJsonBytes(postCommitProbe)); return postCommitResult;`;
  }
  if (familyName === "extra tail statement") {
    return `const extraTailResult = deepFreeze(nullRecord([])); const extraTailMetadata = deepFreeze(nullRecord([])); ${storeName}.set(extraTailResult, extraTailMetadata); return extraTailResult; const extraTailProbe = null;`;
  }
  if (familyName === "wrong return/metadata path") {
    return `const returnPathResult = deepFreeze(nullRecord([])); const returnPathMetadata = deepFreeze(nullRecord([])); ${storeName}.set(returnPathResult, returnPathMetadata); return returnPathMetadata;`;
  }
  throw new Error(`unclassified private commit tail family ${familyName}`);
}

const PRIVATE_COMMIT_TAIL_CONTROLS = Object.freeze(
  EXPECTED_PRIVATE_STORE_COMMITS.flatMap(
    ({ functionName, storeName }, ownerIndex) =>
      PRIVATE_COMMIT_TAIL_FAMILIES.map((familyName, familyIndex) =>
        Object.freeze({
          id: staticControlId(
            "SEM-N",
            197 +
              ownerIndex * PRIVATE_COMMIT_TAIL_FAMILIES.length +
              familyIndex,
          ),
          functionName,
          storeName,
          familyName,
          name: `${functionName} ${familyName} isolation`,
          source: sourceSkeleton(
            "",
            new Map([
              [functionName, privateCommitTailBody(familyName, storeName)],
            ]),
          ),
          // A post-commit call also violates call dominance, but the literal
          // evaluator order rejects the shared tail invariant first.
          expected: new RegExp(
            `^Error: static gate: ESTree private commit tail ${functionName}$`,
            "u",
          ),
        }),
      ),
  ),
);
assert.equal(PRIVATE_COMMIT_TAIL_CONTROLS.length, 30);

const PRIVATE_COMMIT_PROVENANCE_FAMILIES = Object.freeze([
  "unfrozen key",
  "unfrozen metadata",
  "alias/shared nested origin",
]);

const EXPECTED_PRIVATE_COMMIT_PROVENANCE_OWNER_RANGES = Object.freeze([
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStartupV1",
    storeName: "startupMetadata",
    firstId: "SEM-N228",
    lastId: "SEM-N230",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianAdmissionInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N231",
    lastId: "SEM-N233",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianCancelInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N234",
    lastId: "SEM-N236",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianRecoveryRequestInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N237",
    lastId: "SEM-N239",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianControllerClosedInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N240",
    lastId: "SEM-N242",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianDiagnosticFailureInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N243",
    lastId: "SEM-N245",
  }),
  Object.freeze({
    functionName:
      "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N246",
    lastId: "SEM-N248",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStatusEofInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N249",
    lastId: "SEM-N251",
  }),
  Object.freeze({
    functionName: "initializeCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    firstId: "SEM-N252",
    lastId: "SEM-N254",
  }),
  Object.freeze({
    functionName: "reduceCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    firstId: "SEM-N255",
    lastId: "SEM-N257",
  }),
]);

function privateCommitProvenanceBody(familyName, storeName) {
  if (familyName === "unfrozen key") {
    return `const unfrozenKeyResult = String(null); const unfrozenKeyMetadata = deepFreeze(nullRecord([])); ${storeName}.set(unfrozenKeyResult, unfrozenKeyMetadata); return unfrozenKeyResult;`;
  }
  if (familyName === "unfrozen metadata") {
    return `const unfrozenMetadataResult = deepFreeze(nullRecord([])); const unfrozenMetadataValue = String(null); ${storeName}.set(unfrozenMetadataResult, unfrozenMetadataValue); return unfrozenMetadataResult;`;
  }
  if (familyName === "alias/shared nested origin") {
    return `const sharedOriginSeed = deepFreeze({ bytes: nullRecord([]) }); const sharedOriginResult = deepFreeze({ bytes: sharedOriginSeed.bytes }); const sharedOriginMetadata = deepFreeze({ bytes: sharedOriginSeed.bytes }); ${storeName}.set(sharedOriginResult, sharedOriginMetadata); return sharedOriginResult;`;
  }
  throw new Error(
    `unclassified private commit provenance family ${familyName}`,
  );
}

const PRIVATE_COMMIT_PROVENANCE_CONTROLS = Object.freeze(
  EXPECTED_PRIVATE_STORE_COMMITS.flatMap(
    ({ functionName, storeName }, ownerIndex) =>
      PRIVATE_COMMIT_PROVENANCE_FAMILIES.map((familyName, familyIndex) =>
        Object.freeze({
          id: staticControlId(
            "SEM-N",
            227 +
              ownerIndex * PRIVATE_COMMIT_PROVENANCE_FAMILIES.length +
              familyIndex,
          ),
          functionName,
          storeName,
          familyName,
          name: `${functionName} ${familyName} provenance`,
          source: sourceSkeleton(
            "",
            new Map([
              [
                functionName,
                privateCommitProvenanceBody(familyName, storeName),
              ],
            ]),
          ),
          expected:
            /^Error: static gate: ESTree private commit arguments must be frozen and disjoint$/u,
        }),
      ),
  ),
);
assert.equal(PRIVATE_COMMIT_PROVENANCE_CONTROLS.length, 30);

const PRIVATE_COMMIT_CALL_SHAPE_FAMILIES = Object.freeze([
  "parenthesized/computed callee",
  "arity",
  "inline",
  "nonlocal argument",
]);

const EXPECTED_PRIVATE_COMMIT_CALL_SHAPE_OWNER_RANGES = Object.freeze([
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStartupV1",
    storeName: "startupMetadata",
    firstId: "SEM-N258",
    lastId: "SEM-N261",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianAdmissionInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N262",
    lastId: "SEM-N265",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianCancelInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N266",
    lastId: "SEM-N269",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianRecoveryRequestInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N270",
    lastId: "SEM-N273",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianControllerClosedInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N274",
    lastId: "SEM-N277",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianDiagnosticFailureInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N278",
    lastId: "SEM-N281",
  }),
  Object.freeze({
    functionName:
      "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N282",
    lastId: "SEM-N285",
  }),
  Object.freeze({
    functionName: "createCandidateContainmentGuardianStatusEofInputV1",
    storeName: "inputMetadata",
    firstId: "SEM-N286",
    lastId: "SEM-N289",
  }),
  Object.freeze({
    functionName: "initializeCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    firstId: "SEM-N290",
    lastId: "SEM-N293",
  }),
  Object.freeze({
    functionName: "reduceCandidateContainmentGuardianControlV1",
    storeName: "stateMetadata",
    firstId: "SEM-N294",
    lastId: "SEM-N297",
  }),
]);

function privateCommitCallShapeSource(familyName, functionName, storeName) {
  let body;
  if (familyName === "parenthesized/computed callee") {
    body = `const callShapeResult = deepFreeze(nullRecord([])); const callShapeMetadata = deepFreeze(nullRecord([])); (${storeName}.set)(callShapeResult, callShapeMetadata); return callShapeResult;`;
  } else if (familyName === "arity") {
    body = `const arityResult = deepFreeze(nullRecord([])); const arityMetadata = deepFreeze(nullRecord([])); const arityExtra = deepFreeze(nullRecord([])); ${storeName}.set(arityResult, arityMetadata, arityExtra); return arityResult;`;
  } else if (familyName === "inline") {
    body = `const inlineResult = deepFreeze(nullRecord([])); ${storeName}.set(inlineResult, deepFreeze(nullRecord([]))); return inlineResult;`;
  } else if (familyName === "nonlocal argument") {
    body = `const nonlocalResult = deepFreeze(nullRecord([])); ${storeName}.set(nonlocalResult, nonlocalCommitMetadata); return nonlocalResult;`;
  } else {
    throw new Error(
      `unclassified private commit call-shape family ${familyName}`,
    );
  }
  const source = sourceSkeleton("", new Map([[functionName, body]]));
  if (familyName !== "nonlocal argument") return source;
  const sourceWithNonlocal = source.replace(
    "const stateMetadata = new WeakMap();",
    "const stateMetadata = new WeakMap();\nconst nonlocalCommitMetadata = deepFreeze(nullRecord([]));",
  );
  assert.notEqual(sourceWithNonlocal, source);
  return sourceWithNonlocal;
}

function privateCommitCallShapeExpectedError(familyName) {
  if (familyName === "parenthesized/computed callee") {
    return "static gate: ESTree parenthesized or indirect call";
  }
  if (familyName === "arity" || familyName === "inline") {
    return "static gate: ESTree private commit requires two identifiers";
  }
  if (familyName === "nonlocal argument") {
    return "static gate: ESTree private commit requires function-local arguments";
  }
  throw new Error(
    `unclassified private commit call-shape family ${familyName}`,
  );
}

const PRIVATE_COMMIT_CALL_SHAPE_CONTROLS = Object.freeze(
  EXPECTED_PRIVATE_STORE_COMMITS.flatMap(
    ({ functionName, storeName }, ownerIndex) =>
      PRIVATE_COMMIT_CALL_SHAPE_FAMILIES.map((familyName, familyIndex) =>
        Object.freeze({
          id: staticControlId(
            "SEM-N",
            257 +
              ownerIndex * PRIVATE_COMMIT_CALL_SHAPE_FAMILIES.length +
              familyIndex,
          ),
          functionName,
          storeName,
          familyName,
          name: `${functionName} ${familyName} commit call shape`,
          source: privateCommitCallShapeSource(
            familyName,
            functionName,
            storeName,
          ),
          expected: new RegExp(
            `^Error: ${privateCommitCallShapeExpectedError(familyName)}$`,
            "u",
          ),
        }),
      ),
  ),
);
assert.equal(PRIVATE_COMMIT_CALL_SHAPE_CONTROLS.length, 40);

function sourceWithFactoredNormativeAuthority(extra = "") {
  const requirementsSource = JSON.stringify(REQUIREMENTS_ORACLE);
  const authoritySource = JSON.stringify(REQUIREMENTS_ORACLE.authority);
  const authorityFieldSource = `"authority":${authoritySource}`;
  const factoredRequirementsSource = requirementsSource.replace(
    authorityFieldSource,
    '"authority":normativeAuthority',
  );
  assert.notEqual(factoredRequirementsSource, requirementsSource);
  const inlineRequirementsExport = `export const CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS = deepFreeze(${requirementsSource});`;
  const factoredRequirementsExport = `const normativeAuthority = deepFreeze(${authoritySource});\nexport const CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS = deepFreeze(${factoredRequirementsSource});`;
  const source = sourceSkeleton(extra).replace(
    inlineRequirementsExport,
    factoredRequirementsExport,
  );
  assert.notEqual(source, sourceSkeleton(extra));
  return source;
}

function sourceWithImportMutation(mutate) {
  const [firstSpecifier, firstNames] = [...ALLOWED_IMPORTS][0];
  const original = `import { ${firstNames.join(", ")} } from ${JSON.stringify(firstSpecifier)};`;
  return sourceSkeleton().replace(original, mutate(original, firstNames));
}

const STATIC_EVIDENCE_MANIFEST_SCHEMA =
  "oxigraph.candidate-containment-guardian-control-static-evidence-manifest/v1";
const PRIVATE_LOOKUP_EVIDENCE_SCHEMA =
  "oxigraph.candidate-containment-guardian-control-private-lookup-evidence/v1";
const PRIVATE_LOOKUP_METHODS = Object.freeze(["has", "get"]);
const EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS = Object.freeze({
  schemaSha256:
    "5ca5d446d3357b0b43b6421e1cedae2b62f37f9e58135349c7a663ec48b42b47",
  methodsSha256:
    "f0afdaedcb5432d380f9d18e533963f7dcdcff465c7b7864b89e72d09d235a01",
  orderedAuthorizedPairProjectionSha256:
    "562ce95945ad0e110eb9c01866a44c5202f37f2d4381a8ac8d68d7bded28b1e1",
  orderedObservedOperationProjectionSha256:
    "164ab5c6d611fa840804fb88d4e59035e897f9f72db97e8161ef52f92834ada7",
  receiptWithoutProjectionHashesSha256:
    "c86485d7298cd768a4ceb254274c6b331a9fb6981a5ae73cd6fb6328d90bbd6b",
});
const NAMED_FOUNDATION_CONTROL_COUNT = 16;
const FOUNDATION_GENERATED_CONTROL_NAMES = Object.freeze([
  "default import",
  "namespace import",
  "side-effect import",
  "renamed imported binding",
  "missing imported binding",
  "extra imported binding",
  "wrong import specifier",
  "late import declaration",
  "dynamic import expression",
  "import.meta expression",
  "default export",
  "named re-export",
  "export-all declaration",
  "function-valued exported const",
  "missing exported-function parameter",
  "renamed exported-function parameter",
  "defaulted exported-function parameter",
  "escaped forbidden identifier",
  "direct ambient process identifier",
  "function-local binding escape",
  "bare-block binding escape",
  "forbidden function binding",
  "constructor member gadget",
  "computed constructor member gadget",
  "concatenated constructor member gadget",
  "Reflect.construct authority gadget",
  "timer callback authority gadget",
  "Function constructor gadget",
  "Proxy constructor gadget",
  "WeakSet constructor gadget",
  "globalThis process authority gadget",
  "Worker constructor gadget",
  "dynamic computed member",
  "spread syntax",
  "arrow function expression",
  "named function expression",
  "class declaration",
  "async function declaration",
  "forbidden node path literal",
  "evaluator source path literal",
  "proc filesystem path literal",
  "regular expression literal",
  "template literal",
  "mutable startup private-store binding",
  "renamed startup private-store binding",
  "extra private-store declaration",
  "module private-store binding write",
  "module mutable Set",
  "module mutable Array",
  "module mutable object",
  "module mutable let binding",
  "frozen mutable Set",
  "top-level function invocation",
]);
const POSITIVE_CONTROL_NAMES = Object.freeze([
  "exact requirements AST normalization",
  "approved untrusted-value normalizer",
  "frozen local iteration",
  "frozen local module table",
  "pure requirements and ephemeral canonical digest initializers",
  "initializer startup private lookup pair",
  "status verifier startup private lookup pair",
  "admission state private lookup pair",
  "remaining input-constructor state private lookup pairs",
  "reducer state private lookup pair",
  "reducer branded-input private lookup pair",
]);
const SEMANTIC_BUCKET_BY_ORDINAL = Object.freeze([
  "protectedAliases",
  "untrustedSinks",
  "indirectCalls",
  "reflectComputed",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "literalMisuse",
  "literalMisuse",
  "scopeJoins",
  "untrustedSinks",
  "untrustedSinks",
  "rawEscapes",
  "rawEscapes",
  "commitMutations",
  "commitMutations",
  "protectedAliases",
  "protectedAliases",
  "protectedAliases",
  "protectedAliases",
  "protectedAliases",
  "protectedAliases",
  "nestedRecursion",
  "nestedRecursion",
  "literalMisuse",
  "literalMisuse",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "commitMutations",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "untrustedSinks",
  "rawEscapes",
  "untrustedSinks",
  "untrustedSinks",
  "scopeJoins",
  "nestedRecursion",
  "protectedAliases",
  "protectedAliases",
  "protectedAliases",
  "protectedAliases",
  "protectedAliases",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "rawEscapes",
  "rawEscapes",
  "scopeJoins",
  "scopeJoins",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "indirectCalls",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "reflectComputed",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "bindingMemberWrites",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "untrustedSinks",
  "rawEscapes",
  "rawEscapes",
  "rawEscapes",
  "rawEscapes",
  "rawEscapes",
  "rawEscapes",
  "rawEscapes",
  "literalMisuse",
  "literalMisuse",
  "literalMisuse",
  "literalMisuse",
  "literalMisuse",
  "literalMisuse",
  "literalMisuse",
  "literalMisuse",
  "literalMisuse",
  "literalMisuse",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "scopeJoins",
  "nestedRecursion",
  "nestedRecursion",
  "nestedRecursion",
  "nestedRecursion",
  "nestedRecursion",
  "nestedRecursion",
  "nestedRecursion",
  "nestedRecursion",
  "nestedRecursion",
  ...Array.from({ length: 50 }, () => "commitMutations"),
  ...Array.from({ length: 30 }, () => "commitMutations"),
  ...Array.from({ length: 30 }, () => "commitMutations"),
  ...Array.from({ length: 40 }, () => "commitMutations"),
]);
const SEMANTIC_BUCKET_TARGETS = Object.freeze([
  Object.freeze({ bucket: "protectedAliases", target: 12 }),
  Object.freeze({ bucket: "indirectCalls", target: 12 }),
  Object.freeze({ bucket: "reflectComputed", target: 12 }),
  Object.freeze({ bucket: "bindingMemberWrites", target: 14 }),
  Object.freeze({ bucket: "untrustedSinks", target: 24 }),
  Object.freeze({ bucket: "rawEscapes", target: 12 }),
  Object.freeze({ bucket: "literalMisuse", target: 14 }),
  Object.freeze({ bucket: "scopeJoins", target: 18 }),
  Object.freeze({ bucket: "nestedRecursion", target: 12 }),
  Object.freeze({ bucket: "commitMutations", target: 200 }),
]);
const COMMIT_MUTATION_IDS = Object.freeze([
  "SEM-N014",
  "SEM-N015",
  "SEM-N026",
  "SEM-N027",
  "SEM-N028",
  "SEM-N029",
  "SEM-N030",
  "SEM-N031",
  "SEM-N032",
  "SEM-N033",
  "SEM-N034",
  "SEM-N035",
  "SEM-N036",
  "SEM-N037",
  "SEM-N038",
  "SEM-N039",
  "SEM-N040",
  ...Array.from({ length: 50 }, (_, index) =>
    staticControlId("SEM-N", 147 + index),
  ),
  ...Array.from({ length: 30 }, (_, index) =>
    staticControlId("SEM-N", 197 + index),
  ),
  ...Array.from({ length: 30 }, (_, index) =>
    staticControlId("SEM-N", 227 + index),
  ),
  ...Array.from({ length: 40 }, (_, index) =>
    staticControlId("SEM-N", 257 + index),
  ),
]);
const EXPECTED_STATIC_EVIDENCE_AGGREGATES = Object.freeze({
  schemaSha256:
    "eb34893fe9502ba08706fde2ee442711e1f902de281e3aa41552a1ce98df60e0",
  orderedControlIdentityProjectionSha256:
    "e1d730ea2341b9912d4b1bee68ced9ade851702f758dcbe1989ce11e61f117e2",
  orderedSemanticProjectionSha256:
    "ff0f1c9c6fb9c932136efa470d7449dbc063324780b132f920612ba6573cd1b9",
  bucketProjectionSha256:
    "b05165391fa4202e3373cd58f1a396e78c74d7f475ce2035fba0fba5a1a89bc1",
  foundationNameProjectionSha256:
    "3064a09db3f937a55e3d0febeca0a2f41ea836bc394cc1259748b268f59f6ce5",
  positiveNameProjectionSha256:
    "f73112c110a5ced50c3f64fcd53da66e022f20abbaef83ddb5be69d32390f420",
  commitIdProjectionSha256:
    "d315e7be4ee3a429256137608788eb51fccbaf6df4fcf62facdb55729f2c8b6f",
});

const FOUNDATION_CONTROL_EXPECTATION_PINS_TEXT = `FOUNDATION-N001|73b72eff1cb782348cd15eb554c75e9596fff4a5168f3fa0710a96f9191e7b6b|5e7971eb3c93baefc55f6b11670faef071baefc98d3d863f9fb733531e631b22|1125|bounded-source-subset|static gate: forbidden path prefix node:
FOUNDATION-N002|9cc6387a03b706b4cee2c2df8fc8aaad47da3e4a8048c78fee15c53ad420ab13|926af5e0a9c17b36ba25df60e5396e779ef1a2dda84be970233be6989a3be2b6|1125|imports|static gate: import form
FOUNDATION-N003|427c686deeef3eff2c2839a22f6575f4bdccbe7d1a01818784d4b22d4a396a7a|6a57106090219851e881d6e6c3745310ee392f04fa97f43e6621b7f3993bee9d|1123|imports|static gate: import form
FOUNDATION-N004|7c07ee80f1c0e9f34628ecf15001340d59339b75b9a94aa31967a1dca079e31d|36c74c304480e5769ec7c4b5ac5d01a9b1e4088d3084ac55ce5a8dd2b77372b2|1150|imports|static gate: named import separator
FOUNDATION-N005|d93607d67163ee6747606f341027e749b02b45c871e26c445fe59f63d1a6bbd5|4dae7d06b8e6f67f385f99ead988934c95a7659c9e6704faf992920066592d06|1147|imports|static gate: import names
FOUNDATION-N006|cce746f1d09331e4177dffe802a1c56b8c3d751d31197fcd371bdd77a0d655f7|cd6619209126e06e5570a5dea2320f4251400e6cd9cd55c06c29901edd8a8f0a|1151|imports|static gate: import names
FOUNDATION-N007|4ee10549486f29fe962fab513439f0822306f8e731e692be7b4519d22a4a44cb|3d1218ec6552f7f4b45cc40e8dd7ee3185ac0a79f40bcf01f5354b5dd594b9d0|1149|imports|static gate: import order
FOUNDATION-N008|72b400af675f82f94ee2da3adc86c4c8743b2f3b2e549ee839bc323907ab8f4c|-|-|parse|static gate: invalid ECMAScript module syntax: Identifier 'sha256' has already been declared (22:9)
FOUNDATION-N009|a6c18aa72614ae04ac30289c33f1b178d724d41687a1ad69117c5b524224a0ff|32591e5c9c1b1b78c10cb378f3f586f6569ddb91d1da6528eae552c51eceb9c4|1154|imports|static gate: import form
FOUNDATION-N010|c8c6fa5bab67667efa083a924b80e41b2c93b275b70937cf3b0e137553e8a914|0935c7ce1a3b4c439175a78ed799510563698afe8ac499d0d10ff36ffb0ca1fa|1155|imports|static gate: import form
FOUNDATION-N011|892a3a1c1ef6f3360ba31a4953f35dde47db2292cb587fb8d2b971920c41e027|1a44dd45914c8bd199b4c47b8c37be538281c910929c6b793b6210db86e5b46a|1151|exports|static gate: export inventory
FOUNDATION-N012|79b4fbdae47319768e5a74aea728d34ec41a839da8f8ae9426c03e9a1a9352e9|42a101e7f2b834728ba46a8870ac98e3cc5e3066812078595d92e79a06ac8d2b|1152|exports|static gate: export inventory
FOUNDATION-N013|ea2a24fd835d0db1418074a39b8699ba2c09918ce90a232e4832488e330a2da0|068ee78d2bf54e563d34d5f06d01cd1be61302aa76221caa5ccb1ee934d7441e|1151|exports|static gate: export inventory
FOUNDATION-N014|26f5420ce577a1754ed66d13d5b470f2ade21eb0112ee0138d3c63ec7c66b385|a12d1515f4662db273ea0b08d51555951ef06871e593bc0863c7a8b58ba68e79|1151|exports|static gate: export inventory
FOUNDATION-N015|f804b6f800922287452ef6d74079a5a378700e9b9fbc3cd1cf17db5c30944fb5|7a096d45addfba633176cafae2bbf8341f5e8d8727a28078b1d8c952debd9473|1148|exports|Expected values to be strictly deep-equal:
FOUNDATION-N016|a4921e487b887022fc26930f898fb5fa15d7b9223659bced35d424d1b451df55|3a4e0b203fa87d3506f4082bf772a9a16452f2aa9a44b6c575bb47bfce2847aa|1149|exports|Expected values to be strictly deep-equal:
FOUNDATION-N017|17129c92f9a153f7fa46d7a7e2e430efa16bb4f633eddce8b9c7e448c195bffc|0df4f105a508d724f9934ec9566b8aac59a7d9b0a2763a331593952f5902fa93|1151|exports|static gate: export parameter separator
FOUNDATION-N018|83ead52ff068dba2102f1fbe44d7144ce2de92caa8f38cbb44bf1e2ead130c79|ab7b07f930dc5d49e040a80ff244501b11ba19e30f8941e78a5fc68c49673d8c|1153|module-initialization|static gate: module initializer alias process
FOUNDATION-N019|56f161f42c5bacce15dc85bc270fd848f4cbf0e127a0c2049b2eaad955c81bf2|1aed6796df9f32edab6258ef013f8aba1a7767481ee6be9de2bbf33728b11bbe|1153|module-initialization|static gate: module initializer alias process
FOUNDATION-N020|24ffbb2c263ef205b27833492097b20ed1a19e5a8aa0de73594fe09c6596be34|e555987b49f151dbb208ae272648d5d5075a96798a2080477639a3db69fb2c4d|1160|module-initialization|static gate: module initializer alias local
FOUNDATION-N021|a03bf7ce5f58cb7dec99576b1438087042c50cd4be3ed7b8f2bf73ad40135caf|f93da4ac87d9ef2dca6acca2704447101af8468b708fd732cb9e4b7357674573|1158|module-initialization|static gate: module statement {
FOUNDATION-N022|14a60f679f7bbf9325a6888a977ddfbbcfe00d7c3ef5506f696e83bba964c3d8|3b2c06b359362495ca4d08cc5f0785247de92220d6a5b4218e488c2496262b0e|1154|identifier-closure|static gate: protected binding process
FOUNDATION-N023|77f5c0dda026f523caf1364136f9b1d53f50f99b4ed1fe6977f83951585cbad8|1ac2d5614d53e97adb5e2c8920be4b3d1b1bd37b19bf13328b65ed0e03a306df|1155|module-initialization|static gate: module initializer alias value
FOUNDATION-N024|4547eee05c294e63e5cb5aeb26dc7b9d45500fcb03a68c4913a4092e7ebf9073|19fc99f930404e73afd75d9a89648647a05254272ae1ce2a2516f872d02f20de|1155|bounded-source-subset|static gate: forbidden string fragment constructor
FOUNDATION-N025|736ee2239c03244fd8627e36dfe5cb8ed36b008e8175b8da4f63f367ee5600b5|f99ceb4298cae426f12d390059bdafbfc0a987cb448a8767b3851528227a775d|1157|bounded-source-subset|static gate: forbidden string fragment constructor
FOUNDATION-N026|5706ded83be154cf2c586fd3b2d17edcc68c82087ae4d173dc955025e5bc7197|28ea7dda67d7854ba1f3fd20bfb49894370d30232e0b9e87d71fab52961ab3d1|1155|module-initialization|static gate: module initializer alias Reflect
FOUNDATION-N027|2352f1fb891d5daf63c726559c1322abaf2afdc9bb884fe6c6116596cc9b0faf|d6111b564c587a5c9dd329512486a528d18ea9ef0b85d257332141d00f7312b1|1153|module-initialization|static gate: module initializer alias setTimeout
FOUNDATION-N028|86ff8e1fdeb0068818df08f1fa60f5238994665afb3153f1f1f0fd5aee29fcbb|109cc5ca3e053b798a8a9f64e943806de335a808ffa1f223c48839f2917fdc4a|1154|bounded-source-subset|static gate: constructor outside bounded subset
FOUNDATION-N029|71c4e5b380c64767de16828075db0b5cfafc6ec2c8e2792b01398cfffaebfc41|85b17dfa2b13990ea9577b8c086d93af88de80cffe463bd99a5779dc2e8d6862|1154|bounded-source-subset|static gate: constructor outside bounded subset
FOUNDATION-N030|a95d29d791265e082e5bf9ed9853313f46218b335cc5dd94a51045af146ed6a4|3ead90910544badeb575c35a82dfc1c0c320dd4d17a1ed5f007cbb7b438541f2|1154|bounded-source-subset|static gate: constructor outside bounded subset
FOUNDATION-N031|edc77b8dd6a41d5ce4fc3c87632857f97523a52f7347483c5650929ff9349fd3|0feeee17efd941165f9ebc24da7c46663aa2e287276685249386c2ae65b8dbe4|1155|module-initialization|static gate: module initializer alias globalThis
FOUNDATION-N032|40095bb0d48331224caeaffdb303735882e0150c225e5460bd3ef107019a82b0|f26002f99bf179288ff9af231118ea874543aa78fe6aa6195eec9342b79eba90|1154|bounded-source-subset|static gate: constructor outside bounded subset
FOUNDATION-N033|916198fbbd6ef3f84e00ae8525ae845b1decf61f6fe3abaae5feb5bc048ed842|62b30babe3887a2d4271303f292b2d257c1b07afc7a4bf0da8c4e82246666f5f|1155|bounded-source-subset|static gate: dynamic computed member
FOUNDATION-N034|a40c8f5e1cbd9a01ce8ea205b14373ea77bedddabfb972e3867f343e1415b220|1e82dbe49711b28835ffe3c019ca64956b3108984734c8d7564e1f2d6b67fbed|1155|bounded-source-subset|static gate: punctuator ...
FOUNDATION-N035|f464cd621b23e6c853e55953e27af829904cfc2c8cfbef800f991beb2461f331|b79b76d36b642d76f9955ebc41cc14ed117d981c77a476afab7775d26d5888c6|1154|bounded-source-subset|static gate: punctuator =>
FOUNDATION-N036|cb0e6954c7f24cf57ed4dca52a7ef04dda074ad20fd3b948fadd72d948d79eec|971f2a6412e3d9cdc4c2909007999a382b3cf196c4243a49b3b1076a7769a190|1157|module-initialization|static gate: module initializer alias function
FOUNDATION-N037|7e9e97731070baaab7d08d27293c3e47e60ded87b2693f604b14c8668c1661bd|d2036db6a233da0fcc259a1f961654d63f318d7d309b3daabd4e2bdbc6285629|1152|bounded-source-subset|static gate: syntax class
FOUNDATION-N038|7f4e92a7cc68016695499ceaf0f6c7ff5f90e7ef714b20446da4179240f09a95|2757ecbe918455ecbc28e670e7ee63940f5a99f6c8f132c7ce1da8b688eef381|1154|bounded-source-subset|static gate: syntax async
FOUNDATION-N039|a72506f107e8669e77c3850c0a374826a4bb6e16e910609c5fb02a99f13b1216|11b00ef412df0cd73d274a635a49608c8ee5aae04baede49595ea513616ebbc0|1155|bounded-source-subset|static gate: forbidden path prefix node:
FOUNDATION-N040|55bc59a4fba8adebc75cf567de6a63237791883c5d6a5ee3a345061773165e61|c4ed0194ffa065cfd0418e7d3fa5aef0f1742aff70c4e1f7913d2b64c82ab00b|1153|bounded-source-subset|static gate: forbidden string fragment date
FOUNDATION-N041|c1d7fd98703a6cf2e46e8cfe40fbb94575c0d7e5e9b712df2db8f6005f07f076|f90cd898b48fddee64bf8b49640707ab675405d73f61c639848ccbcdefd0ffca|1153|bounded-source-subset|static gate: forbidden path prefix /proc/
FOUNDATION-N042|9178c18484a5f2178f8aef56e12901ddfc4875093fcf8ddfdb0de778f3accf3e|b70590689d74c707b0dc1b7eb8c6aafc4bfe1cd4081bf50eb28e7a5be81c4053|1153|bounded-source-subset|static gate: punctuator /
FOUNDATION-N043|bff14fc33c2b1b31ca386bf6a21f9720615acfc1a488463cfba405f5a931152e|72dd69a59e50c7e7204d5a75839810c700fffeb55c83fe568fec8bf4c02b1530|1154|lex|static gate: template literal outside bounded subset
FOUNDATION-N044|e73657410af7812dc4b1ef6bfac3fab358a3da72ca927baa2a152c3902bcbfb3|87e37657e6e5e8a3694f2653f1e548cd09aca8b38273e56675baf673b691f87b|1149|private-store-manifest|Expected values to be strictly deep-equal:
FOUNDATION-N045|8c3242c6b60d9f5da7afa41aa80dad9fbabd4f4dc4b595c872c9cb7a30a73f9e|52cd59f0c4cb81152a0b05e88ef621d81629f7ee8ede3d50e3a38a19250e8a44|1149|private-store-manifest|Expected values to be strictly deep-equal:
FOUNDATION-N046|cf873a1cb4ef26a5b6ff59c749d641835319e2aff604a9dacb07b83052a5b524|6611abeda5c9d8bc3e24a0296b7f3dc5675ba56084f898672fe043a3f1ad837d|1154|private-store-manifest|Expected values to be strictly deep-equal:
FOUNDATION-N047|e6b6d543358c169e1504d97601184589fea0f91d062bb1ec50807a14ab1cc859|bfe6fe154da56fbc485cc2f110af810871ff549afc1d2551c66ef0f358e88b72|1153|private-store-manifest|static gate: private store reassignment startupMetadata
FOUNDATION-N048|d04f0a456225aac22a47c599a031090d03ca22693f34824dd3cfe5b7c1299437|796603c563569201e4887e023fb9fb8b77c1f6a178b075f86248affed97d45a7|1154|module-initialization|static gate: module initializer alias new
FOUNDATION-N049|66d84fa18b1e577ef6e638c1508c71e8d9daa8ba3774d161183f5dcb5dcff302|0a6e11d8db79a91ab07152a1a2988cb4b75a710787de285bc7faf5ff751c04e6|1153|module-initialization|static gate: mutable module initializer result
FOUNDATION-N050|8a296be0cfa623b81bc68577536c72354656a9df915f72b29351f9066dee4963|d1c366da943e5419f2b10f7b5c8fed5760d994d3d80a047d328c99d2aee8ce93|1153|module-initialization|static gate: mutable module initializer result
FOUNDATION-N051|f1667c0c5cc3b69dd02558024eefc18699211d9e53798e96ce64b0d5baed7273|87e3797afd9296f6b66e11550133f44a4e5a467113d23956cf8a88d4b6c5a646|1153|module-initialization|static gate: module statement let
FOUNDATION-N052|84fc900490b22cb74de4762754fc1409362cb994d33ae1c66578049d0e0af199|b05fa70a35c7242991b5e365e38a03203742afd3a49a26f961af40db61398feb|1156|module-initialization|static gate: module initializer alias new
FOUNDATION-N053|88e63fa422faf2a130b4f904aa5d910b613cc4888af5e5bacb9ac4cfb4041f95|6f34c1dc8dcd0351e64825c2ad77bcfd98a2c118dba37589c5b6270473eafd49|1157|module-initialization|static gate: module statement populate
FOUNDATION-N054|4b46e1b2f28d643a14d333eff015b82acb9b1f5c57c965f9bc226eea82fe6d1a|0d773050618e63a59d539e77d6312c46444f50ca1503e874c22f4242ce05d177|1161|module-initialization|static gate: module initializer alias startupMetadata
FOUNDATION-N055|ce3c566373fec18729a0aeeb70d54ab96964edc6cb242171848cc1b9baa07e3a|816da92bccd9a57b5f58a01d8e3906c72f2c91fc883e269bb6dd2fa4f02d23cc|1166|module-initialization|static gate: assignment in module initializer
FOUNDATION-N056|bed5f961339f7cad14e3724b133ad4aa3db47a25d5888d03f624623c6b3b874e|1cf9b4d3a4b8c971da0ec96d7fc00eaefb8e54a11857e200c8e566d938dddbc8|1150|private-store-manifest|Expected values to be strictly deep-equal:
FOUNDATION-N057|3ceb229e6684cdac9115c5cc379bae3232f3021914aa701b4b39a78932ed54b7|eb087eccb11d8b8082f6304aecbdcf3a9834e16feddba36f87c95ead91734b2e|1166|module-initialization|static gate: assignment in module initializer
FOUNDATION-N058|6cd8e04c8452a776a1ea1481e93c27821c8e2478989309728781dba4331e892e|fa762291dec7d64aa45e5d0a811f263e9d0bd68a2ab48b9ccba855ba18982795|1156|module-initialization|static gate: module initializer alias startupMetadata
FOUNDATION-N059|9f6be9e6383691d0bfd09881dc65ea3579a69275a3474b1669c1751f33d8e1af|8b5948630a487fafa804032601fe8cc9681e9343c68b60d9937b10028481e9ca|1156|module-initialization|static gate: module initializer alias sha256
FOUNDATION-N060|81b13edbb027433fee2831708650278b40afcd0394a1fb21891a52a91f9d7e4e|77cc4aa6270773835c938aff62a7a497b1b6113bea3fcd29c2432f702cc1b4d5|1157|module-initialization|static gate: non-freezable deepFreeze input
FOUNDATION-N061|81a6f3d253fe07a482f1d18454d37bfb52181b4b9b0393197d0b222a5d75ec43|daf74107bc5dc1c0e3b7c13c74a097f01dd71150ff80a89c53abd856ed3e5266|1159|estree-policy|static gate: ESTree capability-looking literal outside normative role processAuthority
FOUNDATION-N062|7d383f646623737dbc5e3d22306f69f284dbd59462f2068c8fcb6e95b1b24660|18e8b2da60829a207e890a7b731cc9c953ca35f71478b1319de48d86ba35399a|1166|lex|static gate: numeric literal outside bounded decimal-integer subset
FOUNDATION-N063|119521d4e0749e687ef1491528506a0046f86ff644939ff6a671aab96cf4f7c0|f03b095f333b2969d39255ea77e349a9dd3a506a7d079218af8a4a878350f8b1|1158|module-initialization|static gate: module statement (
FOUNDATION-N064|72a1e80e78fa4a94896955537d5e6f235fa90099cfbae846144c0c735b59b316|1dca32dd8bb8b62db25cc3f3b92a641cea517949eed2841a00a2436f9482756f|1159|module-initialization|static gate: module statement (
FOUNDATION-N065|fd20164d839bf2a76da4008d62f552fe84b11dc1d32bc87f872da6dd0326ccae|ad67d8d2dc88e9d7dfaabbd40fa7050a4dff651564decd3eb5a15c2bc3679cf9|1196|bounded-source-subset|static gate: forbidden string fragment constructor
FOUNDATION-N066|261f5b29d6f3229aa7a98b5a31c015e19e3437d416826dde9267e4b716d8cbc3|353627c5d4a78a613e59e77c8038da2debce382b5f483449ce69fe15e2a57c61|1159|bounded-source-subset|static gate: forbidden path prefix node:
FOUNDATION-N067|73e9339680322fd43cbee054f6e63cafdc6101269c56a36aa20d9e8a05e9f6db|353627c5d4a78a613e59e77c8038da2debce382b5f483449ce69fe15e2a57c61|1159|bounded-source-subset|static gate: forbidden path prefix node:
FOUNDATION-N068|b530ac724bb99ebb00ab4545071d400ea3c3a4a75c9b710f4853a2f4cac0a344|a261c4be665ebf8283a5074ce80a9db53feda97a69b80da25d8baacf1e71b4bc|1153|bounded-source-subset|static gate: forbidden string fragment process
FOUNDATION-N069|4e0cfb3f154f542add2c800d057142f740b707d0875bb91a4b2014886d9a79a9|a261c4be665ebf8283a5074ce80a9db53feda97a69b80da25d8baacf1e71b4bc|1153|bounded-source-subset|static gate: forbidden string fragment process`;

const SEMANTIC_CONTROL_EXPECTATION_PINS_TEXT = `SEM-N001|83e881f193db0129666e2efcf160d0b1a4e1d69a5b337ca48a4a6d176e91651a|195eb4597f2653d256f147fa8429315d21127fa5869eee6e3df3482d9424c18f|1159|estree-policy|static gate: ESTree protected binding used as value sha256
SEM-N002|f2e0bf284990a53d632ac3d7203fa22bece8bad7397fc7d082565e43dfd03ceb|436570f2afd940fce7000c1c2548040a3b62b3bdff8242eb0eb0ad63e21e0a52|1161|estree-policy|static gate: ESTree raw or unknown value used as receiver for .length
SEM-N003|d03483c9ca4fc3d1f61f67f5aa76fec76d583f2774ffda8dcc18ace439f50032|390bf02cb01ae37b7fa3d92184805b9b4dba3a7ec2df6ae12e97a7ccf140b77d|1158|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N004|d8ecf0a5e279e7b8fc753b091111fa08c35d08af5f6b68067e0470fc44adb43e|1550291afaf6f209f85288148c838fac759861064595dcf994deb855de41d0c1|1162|estree-policy|static gate: ESTree computed member access
SEM-N005|4fc577cebcf0877404bdb5b91119401ea27d3699efe41b6aefccab4801c4722f|504d991c2c339e15cb9e319f5d91c61aa03d63d43a473c4bba020441abe94613|1169|estree-policy|static gate: ESTree binding or member assignment
SEM-N006|3dfcc27a44ecb4ba14972a3e2f708ddd1237b60240fc98d3ea6924059ed88c3d|1104e05cfe9973c129fef6ce9ad6a342c9ab37a7bc252b1e2a2cc956d135479a|1164|estree-policy|static gate: ESTree only one const declarator is supported
SEM-N007|e4b68417cd753f7bf2c6367e64d9c29de75482a8d09968e73fedd6fd35558c26|203870f99996940bdbd7b56fffa546a98a8552d5c0cacaec24b48d08b691d1e1|1154|estree-policy|static gate: ESTree capability-looking literal outside normative role processAuthority
SEM-N008|502e4d044bff2ea272d5e5bfce2cd130cbded344f703d4a858a744e1824b853f|92e0674ebbe239243645edf87d6c4afd5d84cebcf67fa955a82aac6fc46986ce|1158|estree-policy|static gate: ESTree capability-looking property key outside requirements processAuthority
SEM-N009|c9f5b7a191e60cb104774c727d051d5adccad35fca446326fee03bf0f0d73150|8ae35ead2089ab6968a08d096b05c0b9f483aba4fafbca8e2760c97f4eaff1dc|1166|estree-policy|static gate: ESTree unknown provenance join conditional expression
SEM-N010|8379f545a53d3685a982b616424e2a62f159ac4a9e6c3df6d92d65a4777e8103|f6a3a1490bb2708e4f719329cc19f8ac27ab2b2625a9ef0f53713a739cc577af|1160|estree-policy|static gate: ESTree raw or unknown value if condition
SEM-N011|f83775d137f0326e7ee050201f2582716a7d639c97ac55c28f3c35be30061aad|fbe0d5fc2515ac258c175bb3715592026df946787a5f2d4642fe9d2ea0845f82|1163|estree-policy|static gate: ESTree raw or unknown value iterated
SEM-N012|8e536d6d5f981f5e2398689a850b3191b786096e9cad8e4e93c6929d9a5f2a51|60d005a3f851daf3b373f1130b06db111721014704d686481783c7f255e9aca4|1155|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N013|cbc214639b03132d01081ac7c6acb6535a1b049ff7bb7e83989ee9d77d9d5364|179b90dc7f86d6790e60e5ebc2308386a6982e37e576447821eedee195fbe331|1156|estree-policy|static gate: ESTree deepFreeze argument provenance
SEM-N014|5fa3f306b1814be88b0f6812b59a615e705fb5966f465ecd8015e8f1a26fa976|57d8eb99875937213b130828b8dac93b2ca1d652a87fe2403ba21da759aafc69|1177|estree-policy|static gate: ESTree private commit owner wrongOwner
SEM-N015|a0d9c0b4d5b58ef45558ca295fd528a5ea3764e00f04645cccbf1c232809d6b7|370c70cddc155742d8916762b369ef6371ea68374a512aa0af919205b916d117|1160|estree-policy|static gate: ESTree private commit must be a direct function-body statement
SEM-N016|3fcfe1ed7df99d1bb91509df0819192d25e7e4177481689517b342311aec4110|d43b43f3e54da6b2742c1c8c12b9e6c85fda47417e2dc97071f0a9770a092199|1158|estree-policy|static gate: ESTree protected binding used as value Object
SEM-N017|a0000bd789c6b8e96fbd059bd8bfb05a24c7230c95c9e882e1cb04983eaf0c21|883da9d7f052f5be224987099db20aa8bb553ac4ff7e5dee663e0b911d668733|1158|estree-policy|static gate: ESTree Reflect use is outside the closed subset
SEM-N018|eea2e1289d0749fc079ca14caaf4e78bad00b011620169b297ec89e98c892847|511a7e7fff98aeb4fbaea81c05e469374db37ec1e20a92c5f013b23101c4c98b|1158|estree-policy|static gate: ESTree protected binding used as value reduceCandidateContainmentGuardianControlV1
SEM-N019|368503accc540dd8ee85bcf265b3476eb362412b3f9e754fb6acec131b11fdbd|860b257cf1956aca1207ded350a4032760d178a42af6ac90529e90b7555fc98e|1173|estree-policy|static gate: ESTree internal call to exported operation reduceCandidateContainmentGuardianControlV1
SEM-N020|6ac89467a280f327c02ab37967a218e3a323dbc75efc9015015c6c0f2a6c8cf9|fdf97521c9bdb128cbfa122b05eb9359a7a133c1172b14471c752747dc3898fe|1158|estree-policy|static gate: ESTree protected binding used as value CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS
SEM-N021|f4339d932aeae295e6caf4f5ed5938f6c75bf65c1a9a7bd40530a5c33dec561f|389a697243f39dffe61acf92691697063ad791401e6184ddd443fee2e741a486|1158|estree-policy|static gate: ESTree protected binding used as value inputMetadata
SEM-N022|8cdc043cfd9780bc62c9d2d02cb8b701b95418e852753ae017440197822e77b9|8dac1998c5220b69047f14e8a72bb7ea4c7e5e7df50ec2f8193aa38015fc8003|1159|estree-policy|static gate: ESTree unclassified statement FunctionDeclaration
SEM-N023|0b8a80623f6fdbb6ecad7a07f4348f321f68db4a547c474305a97361fe6f08f1|6f6b78dda074913faff55b1761d25b64ee43148545fff97a512c01d3592c56aa|1155|estree-policy|static gate: ESTree recursive call graph recursive
SEM-N024|7288bf9f0dc6c2d0c6a5cafade17bc29b24bbcf6897bddabe6a4f48e0fd6a860|9feba9ecbff7e9d2137464ef7aa9c79db3de3195cfaf7c0a5e4219b03ded1967|1149|bounded-source-subset|static gate: forbidden string fragment date
SEM-N025|e02ccde70bd51c9344a1082863dbfa249a1388a24ee84f95e6fa7191af2f7d4f|cecf19069fec8b05c30a18b9d67e4fc1d3a29858c24859d96d2b2d2843d45bf0|1149|estree-policy|static gate: ESTree requirements digest initializer mismatch
SEM-N026|c3ed0185b91adaa7a4bb74edd14fb3638fba3fefc3d71dc0d15e671451b97431|17b754a671b4a89df589d84987db397734ad08d99ef4cbf4c1bf70d6b2431cac|1155|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStartupV1
SEM-N027|63de6cd7ee8157052d9e57ad96855c5abaf51382b16a308b68b9d1357bbda725|33e677af5d259f4733bac767a64ca10df14c65aabb74669e5279f889b51cce36|1154|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStartupV1
SEM-N028|7bd378d2f780d09562c9c520d1399c94bff4556cb70ebbcc06405566a8f72b9b|f41a69e4e9044572f112bb9529e45277be62c77c71ec2a481d250ea1509ff434|1158|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N029|30b3684372eb13827cf5f6bb4660eecf3ef7870d15458b5d7e551108991259df|2022f290dd74889f74daff30bd875cb98ea48f8fb8d9c2a4793642f08238939b|1160|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N030|cb919be7e35acbfb73246bb9587d7f569ec67a04f8c995a9d6b3fd885b52f28c|cdcb72104669046aa31b427f4f49a1e83097090d4667d0e74e7d5e76fbb60585|1159|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N031|2262a6802c3a96197bf7e959b3198d61dc2aaf8f099438bbbe37fa3642462be4|b19d30ceae209cb369785de8300152c9ce8a1dc825f3a52c1c882a083367367f|1159|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N032|a91d769013f25df127f21f9fd4e0c3ba64d877119f2c0f7a601175a9204780cc|69080be85843ed739c902dcc8e6bdce7332f2b3b8a63e231aa2412def56d826c|1159|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N033|c242f1c32ba0ed39204dcba4461933447f53dba4d3c16329b3ca2cd6b8311de5|514f726547b088c8e593f9a6930cc2a9126a2032160253db4c1a80334e0cae16|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStartupV1
SEM-N034|57cceca4d63535be1f4cb536a0e79c5071b1052e569b2e6c9ba4414d1f61d050|209ccde56f32e9fa4146812e1c7cd8e32425e1830ab09ce58e22715a041c60a3|1145|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N035|d2df86e25bca79df6ed255e934979720bf9d0185e061203b653ac806e0165f23|6aac992b27fe9c9eb54fdca67927aa43e121cb53bbd5e98ab14507cb106ff457|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N036|4914094b858dedff4206e31a44394c47b9a4cb9d45fe5d4e52353f3a8e7100de|30231dd04d920ab217209f2d8e571069708fea792dd91665486154beae4cf62b|1156|estree-policy|static gate: ESTree exact private commit count createCandidateContainmentGuardianStartupV1
SEM-N037|4c65d700242a18b82b18a853719cf48e99ad5b553682d8147594350f794418b8|73c81bf8944a63a1f38410cc98fad77a7cd2d62aa1b38a9a60fa22aee3b9df67|1149|estree-policy|static gate: ESTree private commit owner createCandidateContainmentGuardianStartupV1
SEM-N038|c42a42e8620c1d046cfdbee314308685824592b8b8e0a3efccd98d968b831dc1|76952aca040711388842baede7b72749d918118ce90a2a5b3999d2f9bed23873|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N039|c69c5ff28054e5903d42a5a4d40e68fa927430f8726b4830228c594e3c9b3b03|6702a27228a5a7e8aeaee9848b1794317ca32af2d9bde11cc4eb462fb54cd309|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N040|5b17e05d44b0720aeaad31d6914888c94b748f7e6a6357c44382afd925f8fa73|f599a4659fd18d9a40710832843e5ac7dd25eb7210019599da1a919ad9a24264|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N041|4d1312f5ba4184b262c995d355104462b8777f9d92c3ddb53a582ec89995a093|0f86cf568c24aa31817c470e50c2ec73010f263432a3ad7fa99158125f81a375|1164|estree-policy|static gate: ESTree mutating member call push
SEM-N042|8db1f59718fbfcff2c7395fec5258edf215e84dca680c18bccba588195baddec|da4da9347ce5152e04c7a6b8ec9abaec3e3af5fc19b5595af45d55d15749de50|1165|estree-policy|static gate: ESTree mutating member call add
SEM-N043|480c3c2c72e0ec9cae3ba435b158cbe8d7b01866d8ad6ae3828c540f4ea5c069|acc5703c6796876ef66b0362e046513e00ed2b14f5b297519aa67b44ec6c1339|1159|identifier-closure|static gate: forbidden member freeze
SEM-N044|01281e395bbf50677cdb90a12562ae9fffdb46b0941c884a7d3a8fedca83e44d|0fe5bf8514332b71b34c8fa0b44d828d408bc680fc1a87e6bdb3b69f809a74c9|1158|estree-policy|static gate: ESTree deepFreeze argument provenance
SEM-N045|dcd0b84e6ec634e54af1d63a350acdde0aba11e081a17b885eb41cf67cf77933|1d5c8592b1eac9972ae2ac0682ae0b56a99adc9aa1366ade8910d5d47a8b2cf8|1157|estree-policy|static gate: ESTree raw or unknown value ambient coercion String
SEM-N046|42b089a8944b1e58989a7c72c9ed105711ee527c10823331a850b5fe02de445e|4d5400af18156c7794d1e8d65c32ac09c85d42c98a8eed4453127345391f587f|1162|estree-policy|static gate: ESTree raw or unknown value passed to local function localSink
SEM-N047|3b0777daf5f80bffd69c3abc6d4d84ddb0b31a6d0f757c2823f02007a76874a7|225f4572c3ca11fe891d8c96a7d8e1a9a5b2f2bf86c430b142113dccbc1d3934|1165|estree-policy|static gate: ESTree failure callback may return noFail
SEM-N048|ff65ffbafbd9bac23794dd43586b6d3f3d9f4e5cefcd93a103fdde7ce7634330|602773f1e8cc8a795d7443b0d13f4cce39d95d5d192f77102702f7e97c13bce3|1160|estree-policy|static gate: ESTree recursive call graph recursiveFailure
SEM-N049|382eaedfa6842eba585d845e089a53dab26a00b82c126e782824fcd78ee67c65|6c9a2234babfcdb49e06419dbd3d3c4567e4d467c4475b3ba8fa0a84d97a2b6f|1159|estree-policy|static gate: ESTree private lookup policy probeStartupBrand:startupMetadata.has
SEM-N050|70ca10f37e8ebad60afa2fa616ab95ce880e5f5d21b9804eff9e34c48a6e131e|26dfdbd3b58f04cc9e65d20527f122fd0d7bc298d2ade5da603fc55ed9be761b|1157|estree-policy|static gate: ESTree private lookup policy createCandidateContainmentGuardianStartupV1:startupMetadata.get
SEM-N051|c339d7613797fc85ad23489a06e96387faf785cb0f19cdfedf7ca5ec8d1962c9|848065bc8c4c285e4ff93067d221a521e37d07fe38f03a7da8b61d167b150dbc|1157|estree-policy|static gate: ESTree private lookup policy initializeCandidateContainmentGuardianControlV1:inputMetadata.get
SEM-N052|a043f1ad1bc8b2e87a645b819ef4f8892048fa2bf2a71918ab41680d92db5121|563cb87a947a86fd583c96d8e7812192eb335f64aec1f5ed3808faa8f849cd69|1157|estree-policy|static gate: ESTree private lookup policy verifyCandidateContainmentGuardianStatusFrameV1:stateMetadata.get
SEM-N053|bba11346f57637522f2a2128ed0f35103210c464890e7a89439a787a64c615bd|34f4047fc78ffe53614c44eacabe6a4fb20853f54a0f9f4b8e9d3da453aacfe2|1157|estree-policy|static gate: ESTree private lookup policy createCandidateContainmentGuardianAdmissionInputV1:inputMetadata.get
SEM-N054|47b81074a11b2844daaa07b77ea699ee7c56649cf9f9d6adf671962c7346f98b|576a2d852de3be582a76db52a46b4629194244449044376cef232e9ae88bbb62|1165|estree-policy|static gate: ESTree private lookup key initializeCandidateContainmentGuardianControlV1:startupMetadata.get:forged
SEM-N055|feec76da1661e18039e45a197fcf5164a04025c5ddd146e83baafdaf59466952|7399c79db007804f44ec97beea7d48099fa0089faf2d5c5997d46d2177d1be47|1157|estree-policy|static gate: ESTree private lookup key reduceCandidateContainmentGuardianControlV1:stateMetadata.get:brandedInput
SEM-N056|1aa0e7958497f77ab9d91f54bff2fbbc03d229e00baebab291ce1af8b1cf7d5d|3fc3a0c4850918a259815806812834a2751ed2a49ada7f25ee7a1e474e8deb84|1157|estree-policy|static gate: ESTree private lookup key createCandidateContainmentGuardianAdmissionInputV1:stateMetadata.has:admissionFrameBytes
SEM-N057|6d0b349e5438d23e354d81b9f6e3aa05f2b97b289e795036098fd1e9c206840a|817cea47a5e6063c2e07d007c60c2c7e8b93dac46c5537c058e07a785a9b0502|1153|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N058|9d0d8d67f2ffe8a6952b52de79fa7be6c44516452d7ec1fc5c409d3e0460b9fd|0d55d80e7cb11bdde162be7dca6cd1c7e5741852ecd97f6becea175df897eff9|1159|estree-policy|static gate: ESTree raw or unknown value used as receiver for .bytes
SEM-N059|ace81930dfdfb66cae570a3a0959828027a2de46843093fb472491b9f68a52c4|971ba3d9783b0ed4c8fb6b0e83afb58998ebcb8db16b4a8ad4df301c08275cb0|1164|estree-policy|static gate: ESTree unknown provenance join conditional expression
SEM-N060|5318716e01ff9f07dbb0b84f47fd78466619b8d29f4975020afc422fb5452f45|3d81f243ae80ad914e0a941cea897e156fe0f6341cd8f5986bec3be301dbeede|1167|estree-policy|static gate: ESTree raw or unknown value logical ??
SEM-N061|a9441d716cfd98fbcc210dc70c744e8c4d1f04231f3567f110b92bf51dd5060c|ca5beea638af85c4206d87535cc2228fa00e1b9ea6b4a6ef91081125c1f49558|1157|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N062|10534c204545368bdb1fecbe23e48216b07536a336a99e181d7f498d4bbcc52e|1eff79a987a215e3f3f5590a732c0322d4baa6013ca2330ff2019ed3c8986cc2|1161|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N063|cd85bf60cdae51a8349481736dccc549e6511fee1ed0ce2a97cf3394dbe52ad2|f06297b857972c3d3c71d1e1d5725aa15323abc6ee26421883577605db0e792a|1158|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N064|fe34edd0f00aa5f6921a5fb3547e261e7f562ebe9af58631b286122d60f0d519|677d906a0a0091d6bc026dab4fd7ea9334ab0f25c85abd27658cd98494a8a0af|1158|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N065|6f993c0f41ed6770e441b0965b4576a4530c06c0fd4afbb86755757c6daaa509|a50fb763e4ab3759a98e6af0d3e3b91e201e1ced8845fcc1560d3970f9c2ab15|1165|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N066|84900a459ae5b59b94087a9d267b1bbd9fb06055c90af760587a3f6d2981eb17|99cdb73584e8c7035b987d4363133cb89107b95bb8a5dc2654abe1e1a2c9dcd2|1161|estree-policy|static gate: ESTree indirect callee CallExpression
SEM-N067|59ca91012c5daca2fc3d0d18f641a2dd875a047b2e2ccffe87e09c86186561af|12f71f68e5436f0b1138683627935a780b01fb378996d9a3b6876e5e1bdc2351|1169|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N068|0f8286014c19b1759d3eba3280cb7d6d7a5336f7ebaa11f7bc591c9cad9ff51c|bd09af652abe96bb4a41d252757c8abbe8ce96299fa1e18fef9f1202e25d2a13|1163|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N069|0fc2442d3c3c9eb6265468d7b3efbe05b58c790b819c5f90c3c4da9b8b7d3009|127f0e4ae3bb9eef5d95af78295e05be251fea204e9f29f81267cdb9510f8883|1163|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N070|24e97e48cc5f889060f1bfd679fb4eb4b1ec523f5b96c6046bea2fec26223415|a330a98df337d4984beb812f97b28203352118fd68291576a8a8ea551e08a254|1166|estree-policy|static gate: ESTree indirect callee CallExpression
SEM-N071|1b1a3f9f2f6ac5a747c0e313dd387e30ddf57297776a81478bfc87d8e8e8a3c9|977ad1c90de7b48bdf2d3688cffbd8417d4c6e5b4c50b691df0cddb3cbe24740|1157|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N072|34d34e48eb17d602f09a797dc2945d878a467021a8146fbbf0e454a989fc273b|2b37927aba3c71dace09b1f7cb5bb467c1653f1e0d44bd9823bc317d243b9fbf|1157|estree-policy|static gate: ESTree computed member access
SEM-N073|afa803c71adbe56dc713d5736491b585dde51bbef9617f600d967555a0ac4ada|054593ab2d4cf131bf452526f5d420cb8f368f6de2e0078278a2a870bc3aa06f|1156|estree-policy|static gate: ESTree computed member access
SEM-N074|e6989bf63703bff28b704af5e79bd6e7df47d5363b8d0bb65880501512eaa1db|029be0389c72900b79486f8d1407eb8b955adb0cd62ea68fb8d4e6e25d203e30|1156|estree-policy|static gate: ESTree computed member access
SEM-N075|369ac585797e30be7fb23c84f58731e373ca05baf3aeefd290ec28c5a875b2f5|4cb5a33b81d10ae2821f6ef11992feba6269ac161e18b919d13d34e21a788914|1156|estree-policy|static gate: ESTree computed member access
SEM-N076|6df202d7c2bb0a82a81da9c507f6ea8f13858864c570abc1252de43a48adea5f|05eb26638f70a80495bd951a75cbd6f57d6c66b4294b97148512d210444a0f93|1156|estree-policy|static gate: ESTree computed member access
SEM-N077|4dd3b4566db8b9e53380d9caacc8f5f502ac6e4a665480127eea76620e67cf03|5524c96f96712543543df9b6c50477b7eda268066ad96b79121402a8c5fec6db|1163|estree-policy|static gate: ESTree computed member access
SEM-N078|3256db49c97c36ae1c4607100afa000e7e0b875742fb966324feb741b8cfa6e6|41af6f4f068ba13cece25559d855492aca6bea0f352011cefba45dac3a0b2362|1155|estree-policy|static gate: ESTree Reflect use is outside the closed subset
SEM-N079|5f28652f30a53fb5cc67afec8ac59baa6e2f9f89b312615a25ce909b12e47081|65ca7ac96337b6d041bc2a655fb5f4bcd77f3dbe71f147c01cb6abfeb89f414e|1157|estree-policy|static gate: ESTree Reflect use is outside the closed subset
SEM-N080|d29d2c6e0578d42475aba5029b02218a7e2728c57fb984a488237284e7b980b6|53c24a222af8ddbeeb4d4946c370ff34a1dbc4a0f6153da9cbad30440910a867|1155|estree-policy|static gate: ESTree Reflect use is outside the closed subset
SEM-N081|7d17a1f5a8cee11d3cfd1ef90b899b64caba0bc91fd6eb6057c509dad862d296|1fdef7e685c16fa2240bac43b6c00183ed0c57682814ad1d246af71bcae9d912|1156|estree-policy|static gate: ESTree Reflect use is outside the closed subset
SEM-N082|2d00dccbc881916c2ccfcb8db429120df47c645caac218dfdc787bc370fad314|55d7e02471e4800b11b9c008961952038a93ce1654524082a82278f305a9a68e|1161|estree-policy|static gate: ESTree Reflect use is outside the closed subset
SEM-N083|850d4e1a5edadfb0d6552c837a9aa4e72fe1a6777ae15804a9b85faa65d859aa|7744eee313a4a1802f1a3aa8bd22d5cf0aa339e5560c8b7cc95d93624fd45c74|1166|estree-policy|static gate: ESTree binding or member assignment
SEM-N084|9f5cf7ae108dcb6a7e317f898d6aab85a828c5822e1ba323f0688169e2a48847|05cb4ae877584a76b8d33bdd4c092eddfd5df070890a20140f02204bf7242d6c|1169|estree-policy|static gate: ESTree binding or member assignment
SEM-N085|2e8389d406fa7e6b88d22fcfb79a6ac7368ed356c5b86f2da57ef3ff42d4e2e7|2420564a5747d9dfd75d489badf946a312c15a53687bbf5dc292c4b2e5ddaa5a|1158|estree-policy|static gate: ESTree binding or member assignment
SEM-N086|ca2c393d339eb3a72229ba6d6b599fe03f8ba4eb03cb3f23c1834184e64f3ef7|787914a8f3270aa7bf55e5ee93f8060e19226ade22f44828fdbd2c7a22887812|1160|identifier-closure|static gate: ambient member Object.length
SEM-N087|cfc4d0bb2b180f2cb82729a1c302a6dd683fa3457ef0ff5bfb43fe1c9bf3158f|67adf309a33a1530ac10f63fca40d5c3dce68afff93b94366a858e01ac8bcce3|1158|estree-policy|static gate: ESTree binding or member assignment
SEM-N088|de1f691413e5129708d8a57fb2590b62642607d8efed1dce5f3fceadddc1139e|64c3ddb6666e4434811d22a2a232dace1f67f1677f3dac9b23a277a625766440|1160|estree-policy|static gate: ESTree binding or member assignment
SEM-N089|22adaf750c33b5ccf4e54b2c397ae695efea4dce91686747c5ccbe622e1d87ea|106fb2fd098b207f9f4ca5a1f084876606eb55798cb354309d5f499f19a75ea5|1158|estree-policy|static gate: ESTree binding or member assignment
SEM-N090|3ca3b668c2702d570da491353b3054d3ee49733d135d1bb7e8664d969495d736|d612caa18465f142a931a9ac058e56348019a897dfd29407b7616250dd90c917|1160|estree-policy|static gate: ESTree binding or member assignment
SEM-N091|73beee1db36b456475b0411a69a8c93229d0a13d9e643581aa8163602175ae48|345cbad706f87203f48fa539e538122ad4a564092745731f88ced510ff5fa042|1158|estree-policy|static gate: ESTree binding or member assignment
SEM-N092|3834945ee3c0c0df25c90eceb02a5c8daa38720358fab8895077b9cf952b1362|f0a486596a3f72f77672e868027636292c065acb5e6222992ec71f02e645a910|1160|estree-policy|static gate: ESTree binding or member assignment
SEM-N093|102862b37805ee83bf5b431c473bc8f887682dda053a9723ac1851422763da31|4f127964592414dc5390b666c993e35fab68a4f1badb4987c9c91827cb40eebd|1157|estree-policy|static gate: ESTree raw or unknown value passed to sha256
SEM-N094|12b5a978c86424e87aa896aa3775564d73b4dd61fc3377a37141880445e6f5b6|f311025de64344e1c1be0d4fc869b14467d4e5b86d1f837d4717532f220238df|1157|estree-policy|static gate: ESTree raw or unknown value passed to canonicalJsonBytes
SEM-N095|7d782282f4a36faf557559d55ca22771d2352ba7bc678c02da26c3df8998da06|10f4ed1b0cad4e993682a264728941e944945351faca9bc8a9f74efacda0d9df|1157|estree-policy|static gate: ESTree raw or unknown value passed to canonicalJsonLine
SEM-N096|4e02af5f33c38dab0c885c8cfa7025481e01d234c858b7e87a11122b0ba2873b|8048a57a196a6c97c923a32ad203a2fba088b8dfd452246a38fa37c2c3985d58|1157|estree-policy|static gate: ESTree raw or unknown value ambient coercion Boolean
SEM-N097|ecfc8f9a908b7d47934c832937ac47c0a52fe7fb1a2789ccab7294cb9d6978e9|9218591d15d87c3147620a042d4829fadb7f7398f97412b803102a7d27492795|1157|estree-policy|static gate: ESTree raw or unknown value constructor Error
SEM-N098|931105a3c4de88eb76ce338856e43e567638dd0e2c3ff92b7a80b4b778d1fdcb|db742f0184b2dc39c44a8e099f3bff9e810b112fe37db94dff2684c9c3f80751|1161|estree-policy|static gate: ESTree raw or unknown value constructor Set
SEM-N099|544ca84d32d81128a88c9c7ae70e9cfb16d028b962db39472d5a60abf9759332|9a209cdc2742005a3c0f65b01a9c43fc0e35572fee51e513477e74bedb78153a|1163|estree-policy|static gate: ESTree raw or unknown value passed to local function localBoundary
SEM-N100|74e7a0e4f9cdfa69b8163f6df8b65b9bf772b18e9f12c14b1744420fa4ac256d|e1220c17028c2aa0cb19863ed11ec43bbd77ccb09bfd807d5effeac0678515e6|1165|estree-policy|static gate: ESTree raw or unknown value passed to member includes
SEM-N101|20715e07ceb0be58524cd075d8d9ead1a25c557b9863143660050bf03f06222d|6761782d304da30ccbc644e184540d7fa72d8f0ef858321f23f7199428970632|1165|estree-policy|static gate: ESTree raw or unknown value passed to member at
SEM-N102|ace474623e5f208fb3c968caf467c403055e59fe9c84ea822dbd95bb2fcc140d|a028c27ec66743a466dde1fea7782ef1bf0721e2874c15cdaed586ec16e28b0a|1161|estree-policy|static gate: ESTree raw or unknown value used as receiver for .bytes
SEM-N103|07c6228e2e6f5a30daae6e9e5db0d02d1c6a1140f3c4c97addb52002ce531481|2a381a12b19bd62e356aab53e5f90f3938c287ef49dd64980d71f1aa27f5e73c|1156|estree-policy|static gate: ESTree raw or unknown value unary coercion !
SEM-N104|0d6810f0bd421beb52a1a51874a1491213cb0207ef39eacca7e29eaa1bb7771c|0a69634c2282a518a272243608b251bf23a886d83f9b4fe557192c6e315da8e5|1157|estree-policy|static gate: ESTree raw or unknown value binary ===
SEM-N105|3ff9ce4d437d5a7441afa70147188f842587b7492166ae045c533e516cf7c9b3|75298021dd5a5297baf7259bb9ed81f6b1993bcaa884f6752bb721620ba65e7b|1157|estree-policy|static gate: ESTree raw or unknown value logical &&
SEM-N106|fb0732be0832b0698fbc9ac0cd92c28f4364a244cfac7030489f58691e784a31|7a234361d68d02e3c02c4e60f97fa80867596950ce2150ee027e8dd5d3049691|1158|estree-policy|static gate: ESTree raw or unknown value conditional test
SEM-N107|178ea57186bd4456d631449411eea23c25a9c980aa95e45604841cbd57847660|99ad03576b113ec8a8f7fea3e2321e1662947441ca4e17a2c70f3228e1c517e5|1155|estree-policy|static gate: ESTree raw or unknown value thrown
SEM-N108|45a50f597d1e5b8fa2b543d5feda9b526357c55b6e9593f8834acfca69659f7c|a1035accbfc725b919c28b01f507d1fe9c500454db1d0269bb837cdf61bf20a6|1163|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N109|04df07caf08d4042b0e599272c6749fb37f2d9732c739cb4e45ed485eaa8476a|59af11c9f759edb58e9ecd6efb387bc0a82103093c1001833e62cf25f3869fc0|1160|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N110|b284d9ea72324cdcb62c24c0994db9bc7f9ee51239668138250ebfe2c6b3597e|71b8baad9b376339e135f117ec45db02a2d075b72ebdff7472cf2528cdcd687b|1162|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N111|2136e7ffc08ba3abcb36375c67fb55dbf541309a1b5178ac04eca4893baa5c10|97dd1edf8d8b2388ed44e9c9d4baafd10d5ad1d624c48785ae3c3bd29838e721|1167|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N112|0ad909d4766f51ba1f048d1b5fcdc6e802873401ec397dc392442e5257dbdf78|e7f08e4fcc81655347bd84e9e9632d19ee279c1238fda310a7c4e7a1aa383add|1167|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N113|207978a4079e7ed7a094122d4daa674834f49451062a892ffe16e96e8bc47444|c5d6ffc1a4a745887d659fbd59508983a9abccdccb9ccac17a78f4d4faac5e64|1171|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N114|a5a98a6099e102690f19e6e3a0b1b420396d3284c592664bd08f75fdfd5d1851|b4f39ab0a0189f0000725d2a2f9abe1ca12caf5db1877caf9a7832ce6d7e370f|1161|estree-policy|static gate: ESTree raw or unknown value returned from function
SEM-N115|b198b464987a52f4b75c1aab2c6ee929373025aca3e258fcaf47264b9d714c0b|c4c0728ac98fee2511482c41a6d92f395fd09eb928347f3345f78f2f1b894a24|1162|estree-policy|static gate: ESTree capability-looking constructed literal outside normative role processAuthority
SEM-N116|75237558f8293d42f95dd537607617260307c1f604303fbde402f478b7e93409|361ba13d3a84a201de8b073ca3475885f08f6c32715e1faaff652b035c837481|1163|estree-policy|static gate: ESTree capability-looking constructed literal outside normative role processAuthority
SEM-N117|06011b51de535383d91a7548ae02dd4dd2e819f8b458daf66d726e4f7115f344|172d6215ae5c57f8a4fdbb35ed0d55d6c4ec3e03d8f7f8c2d0c41fa6421ca55a|1168|estree-policy|static gate: ESTree capability-looking constructed literal outside normative role processAuthority
SEM-N118|08ea2687ec4715324fc0d9521f2337b78892b7bdb19c371642b8274b44659289|6c6ba22d31f735350e67927f6a84a4e2d3c275175a24f7f8fe1c5515a073470e|1168|estree-policy|static gate: ESTree capability-looking constructed literal outside normative role processAuthority
SEM-N119|a4033470e243fbcbc8ef55930d548c96bd906b32875e9b23cb2f1e5dc5b08231|6303e49a413d7bee0c56f5c2d18e9d77ef6d0f187b5c3209ac2f2d6e392b887b|1167|estree-policy|static gate: ESTree capability-looking constructed literal outside normative role processAuthority
SEM-N120|c31728f13d1f9903c753f15aef359c6f45604e07cfa6fd7f649c40668c4f842b|df5987520ae2a11cf465afe7ab30e21ffbe17e5b9e3ffd058367f88f2f9ff301|1167|estree-policy|static gate: ESTree capability-looking constructed literal outside normative role processAuthority
SEM-N121|2d01644d83c9ac9ca14bc59c795b8ca8f17de13a59b0d104ac027afd9f673974|22ed7656f51ac599224e9c2e31ca5a7501f325b0ba0fe9f5c75e68690bf0c87e|1166|estree-policy|static gate: ESTree capability-looking constructed literal outside normative role processAuthority
SEM-N122|8a38870e5d6e2592e606da6ba46b5910873c37a384aa1f1932ac6f91a59c8889|e7d666e6164099782e73f38392303a0f3529e8a691cd22019978ebfeacb7c04b|1166|estree-policy|static gate: ESTree capability-looking constructed literal outside normative role processAuthority
SEM-N123|17136b465e235e153899b98a8add09d210ef00fda8ff5fbced63c3846802dab1|12b5dfd0eea8a7337ee360d50e643a928578c014fd927cd9cfdc672ffccd22ee|1160|estree-policy|static gate: ESTree capability-looking normative literal returned from function processAuthority
SEM-N124|6bdb8210d9e2817e8efc182ee10d042ea50f8ab3cbc750ae890234abffa899d5|22f2273e62f1aae3408b4ffb8216813bbd56e89746ff35dca75c340d96e43f92|1162|estree-policy|static gate: ESTree capability-looking normative literal passed to sha256 processAuthority
SEM-N125|38765ae9e7053f89fe112c743ffea83e245893acfee20c6f1aac33d7b93ca378|e39d0626198656380399cecaa03f404d21713e7ed116b3b5cb95fa30a70291ff|1162|estree-policy|static gate: ESTree unknown provenance join conditional expression
SEM-N126|1039f451af8d171277f1ee2c939ec38d0b7e648142938fcf6b978219bbba0c93|9b1bca11a1b77e6c7f4e53c97bce9df84044c559ca265c3c72c8ab30618f3dd1|1161|estree-policy|static gate: ESTree unknown provenance join logical &&
SEM-N127|d78c882bb12f6d49b78a60587817bd8a28d38d227e3163d4855181f47ff484ac|ec5970a81852fd173f582b4e3123b0932a4a2d0f31df52c0a607de3ac5c992c0|1161|estree-policy|static gate: ESTree unknown provenance join logical OR
SEM-N128|27b9281cccbaf7e9ad152f0f773fa5d4e85f7245576e68d9746c1bf095982b35|3ea643b25cbff26f054d63fb953eed7e1385410658fce4c331f0ecff20534d12|1161|estree-policy|static gate: ESTree unknown provenance join logical ??
SEM-N129|93708314e9d81bd24f7700f27587e07bd01e049432da695d5dbca397f5fc6502|5aa33f64be6a8b7ef6cd36006c66187f21f36c1e3ad08af9802d2db5277f4e82|1165|estree-policy|static gate: ESTree unknown provenance join returns of joinBranchReturns
SEM-N130|929535cad3305742a1f5102fb73589fd50c777fdd71d3c38a04302f7750e9702|7a7b3d138c701d91073ca549792ac1022a46ccc83cc8364bb3124f8fb10db995|1172|estree-policy|static gate: ESTree unknown provenance join returns of joinNestedReturns
SEM-N131|dfe3b4b50151747568c441cc130d5caefe8425e2d8ea0e6ed514b14c7fde5766|4820e17484bc604f438c3f62f412ed87708d1b0d47f7a0a0aa48ac14b093c576|1174|estree-policy|static gate: ESTree unknown provenance join returns of joinLoopReturns
SEM-N132|3927be0eb11d7238c3aa0d6e8aefa6047dc565ba968c0ac9ee24e6e8d452b83d|f8cb61a0689974659116e6aed79ba2ee3af2cfd7712aedcfcd6fce0fe859e4a2|1157|estree-policy|static gate: ESTree function may complete without explicit return conditionalFallthrough
SEM-N133|2eae9153bd6bb4604c96ea3191c72df363519a0df4bc0da99476923fbae396ff|2916c381e4a2d943fd122ba35dada5b96ee0424ad948bdbd9f45d3dfc3a97b5a|1167|estree-policy|static gate: ESTree function may complete without explicit return loopFallthrough
SEM-N134|1beb513c29e898044a73d95612edddfad143009425c2dfb2543611c8334245d8|1e40d91f1721a376dcf682806812d0cdad59c2420166d6854882af4eb601ae5d|1152|estree-policy|static gate: ESTree function may complete without explicit return emptyFallthrough
SEM-N135|0e4e3e58d3206b89a841ddbda6fe43b246c3e23a58390dfc313a3ab937eae51a|2f1e6ba6203993962638b17aba4fc8090c1238eabb82a41df3d6b3ed2247f207|1157|estree-policy|static gate: ESTree function may complete without explicit return throwFallthrough
SEM-N136|c61bbf97696e2d09eba05916c7a122803294bea03ee3e9b753e2272341bc7d2f|7544cecb98fb59800a2b4a8024fe8d0d64b3e4c1009b839e503323baa82d9795|1163|estree-policy|static gate: ESTree function may complete without explicit return maybeFallthrough
SEM-N137|5e4bdaf4e18c0cfb8b4d07844e0c465d16f8c21c66bcd94e52843c0252e21160|5efdd3f95d51f733a4f40b748832b1e3cd89c88312cc2de460223d78a519c85e|1170|estree-policy|static gate: ESTree function may complete without explicit return fallthroughFailure
SEM-N138|b771bd80b5af4134b7d5d3ef347868c1d541dcde714a0734d5c2c5f04c7d0cb3|d1686b95db6a9e6e8957655b795799908b8c2253c3db3ec54f7fdfcf75f0e0e3|1151|estree-policy|static gate: ESTree private commit return unreachable createCandidateContainmentGuardianStartupV1
SEM-N139|55854e968879748f1f553f0c30ddd18782f5ff0d6342acdcdb8086b1e507f377|4cbeba4967d4a22ebb05458878b945b1cb820518d2c795520b89ed9b3fcdc1a3|1161|estree-policy|static gate: ESTree recursive call graph sccAlpha -> sccBeta
SEM-N140|15d1b2f889c580f6c726b78011b0f92189d2114986376bdb942cfcab40aa4ea2|1f2d1c206a2deaead465c34671082cd963326f7a1ead859f3571a1a7640b4508|1167|estree-policy|static gate: ESTree recursive call graph cycleAlpha -> cycleBeta -> cycleGamma
SEM-N141|9b19bc3c84097b344c6860456fa9673169830ca45362be008d0f038ae9b09229|b0b9fa1a49daf00cc115ff53f05008898deeff10308a1d37bdac6fa7e609bf26|1164|estree-policy|static gate: ESTree recursive call graph branchAlpha -> branchBeta
SEM-N142|2b5929e7ba0bbbbd480a4e16b2629e6367d3cdc3968cf0e669daaa7f3aaf678a|a497e6edd0615891682517534c36769244acc8eab47d59ba5b0285ad37eb4391|1176|estree-policy|static gate: ESTree recursive call graph loopAlpha -> loopBeta
SEM-N143|583c3f93b53176b6b8bccd50dd5acd776c70582c243777f2ca804d5dafa68563|622b41854f87db1d8c6720d73066b3b9146d7cc05a506fa58127d1748e464b44|1159|estree-policy|static gate: ESTree recursive call graph selfFailure
SEM-N144|0326186356891c60ceb4ecaa9cf5e1dfa1c5ed4393a7c34494bf501225f5af77|3518291a9f17865063002caa86ec6ef90032fd1e947f4049ddebd4505e60e68a|1165|estree-policy|static gate: ESTree recursive call graph mixedCallback -> mixedCaller
SEM-N145|f3bc3c7dc472c7d0aef8dd6005e17ca09931d1f3b0c5c7d4c0d4f38d670bce81|6abfb35b9cb2cf67678f5d7cf63fdd4968e6ba7f70591422f4e0f9467521e84e|1169|estree-policy|static gate: ESTree recursive call graph callbackAlpha -> callbackBeta
SEM-N146|345da80e39d34f452217707e5c133fb9634d5d1b8283109cdb87356b0aec50ed|afd6b2a755bd665b72f1a2c25045cd11599bac4abaa3c591447e661c139f2ff2|1157|estree-policy|static gate: ESTree recursive call graph unreachableSelf
SEM-N147|12d2de2828b58eee93bc513eabf168d9dd3ecd3e0b3c219c35da71c8b12504d1|7916520978e5a6bda609d58d51444c495ab0a501067a2caa1ed0f9e3a2de91fb|1165|estree-policy|static gate: ESTree recursive call graph detachedAlpha -> detachedBeta
SEM-N148|2b423912ae64d30b40b81ee25e8554a35b64f2311e51c034087b83506933fc50|7bd5bd8cfaa3bde6b803f86475b4c38245c81cec2be7cb00ee30a94bbfe678f6|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N149|03b37a437d3a5c8c7c89ca459d1a1e7a9657e797da6d300b3e674592382af910|1db57c3df329aa921eb1f2ce734d20c4692d7ed95899561edcae05f706b56264|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N150|22646df7ff8291f2ffbec20c2bbd085afd34da8e579992dd02b27a80c58e573d|0a6b83f18af80e9db0a5b074199d0df51cfe43046aca7e76783f9743d5f298c9|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N151|1281a916391235153d7995f510ad7d42197fa1f9f6fb414c1d2e80e556d9cab7|56e063db4e1a3ec28a6452a8d644916ad5c3a180173bbff69dd7cac63b161a8a|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N152|859b7751b00729dfe6f18f567664494b94cc1d5cd69597a772e92bc2f466f6c1|455c16692eab21f89600537d76d565fb8813239e3b73c56169530a9f7a7f0aaf|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1
SEM-N153|eab0697efb2b75642b9d1ef03809577a5d1198d3eb27e121eb35dbeace1207be|8df82a16bec1992d957c44c4525e5f3b1148701e05f31590b75af60c094416dd|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianAdmissionInputV1
SEM-N154|30ea438be4bea1dad1b3e8761e04274cb32d650a5d7a7e2f827bf2c1621378ab|dbbf3873ebe25d272c065a831b66eacc7df101504e8ec439db6a26444435246d|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianAdmissionInputV1
SEM-N155|27eef7f3496c6123aa002e13afcb6a60d1addbc37f9352ff460c1f8c8e34ae69|5dad04a8f60d97da0c95eaef9675d6a39bfb18bbd8e228cbc2eef9d3960af456|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianAdmissionInputV1
SEM-N156|3bba1f55af9b9d5d1fe57b46418c7ed0f6d2f70934b252f2665759784eaea29a|13e37d7898681124931e13daa81b6f7cf01b2e22e49a5fd2dbfb283955043aeb|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianAdmissionInputV1
SEM-N157|8d0e48fdd0138c56fd4a6922fd97308600ee51895c0b2c0be62515c52923b050|5845a95b0df30469e00b19c8aa5294e97078990d81c9d90326e47bf267121a26|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianAdmissionInputV1
SEM-N158|3a595e0350b33f3757d5182be78262ef1a9725a23486e576ff75c6221bc5d4a5|714bc1aa152e615823dbbe91c496c5ce4882f9d427e4c55fcf19dc29fd805c52|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianCancelInputV1
SEM-N159|cca655f3eab0bbe295b5db0512b74718aa73d1ff90c946f19fa434aff9919050|b2cda4bfdd8ab3ba0060bd04721c6e8ca404c39c9a83bc5d5891d479892658eb|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianCancelInputV1
SEM-N160|12a8a597206f78c776936549a4848d12462796bd127ad80778cd859284100e9c|3f2902d7181558a549e537f39e62bdf15c3846302bdc7c7ac99f77f68b263d8a|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianCancelInputV1
SEM-N161|e59829f8a19b95d95fc02ffc5dfcc922e05382c5457769af7981c0eeaa32e926|b3915eeb7006eb3190a72e59441b83b7e136c25da6b0e678caefc1b3f0d6043f|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianCancelInputV1
SEM-N162|2be699eef3234cac2ce0b5720ef1b2ef6bcf585668a539a04e1ac2812bd52c81|d3996e9684a855bbce5ef706d83e9a678937f21e745592b39b6dae267ca34674|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianCancelInputV1
SEM-N163|c9470a6db14e32ff1c4f29bb114cb0d60481ca10b5e7a40813bc1b86cffd9e91|8c5408c6d86fee0685cd998ac109de07bb8a7b844a37d12b3477be3119592cb1|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryRequestInputV1
SEM-N164|c27b60f7b4079e9799c59a048f3d110f2eb1ed977eb2395f6205f64c54b31283|b7c47a80a053d2e159383ff848b6e37b4647085389780af1562eef72b84b7f46|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryRequestInputV1
SEM-N165|51c9af9a8901f1585f63120bbb8e7da53116701e8453555a4cfbb8bd591153d1|de21913b53fc013606fdf39bbc809b1d91b9f52188564349a64987305f268483|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryRequestInputV1
SEM-N166|4026ac5805e64ab47fe0e263cb006110ca55eff805aff123a7c3e28aa159a0f9|90513c15e965ba2fdcfd11600418be7f178a486d5a8575bb0776c71c70e17716|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryRequestInputV1
SEM-N167|f3f8f0c4000b8589c8b8fbc3673b14d848c3acb76b90fdb6db0dcb62be6637a5|6427e8daa76694aa8f86c865293c899667143858a8359ee0017b2735e12c4ca1|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryRequestInputV1
SEM-N168|dfc84b5438de9d9d70cc9f4d78dcde818af2472751615d079a5a6b3a24c0b114|43b29723426cafc1255a74bb963eaa5a7de312b4bd74036538f78f0f854accf6|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianControllerClosedInputV1
SEM-N169|f91ce2d20c01169399b74378828e9239b215976a5a2ceb2870e74262eff869b8|82ce8de347e7a341c8dc0aa012da34ddf29c9f0e7f026951580fba1becd46acb|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianControllerClosedInputV1
SEM-N170|16c012d1750a2876fabbda6ee11f0e805acb10b1c26640059d886271dbbb22fe|25cb4cb9ec309b4de12790c7af2f91126dc55889ee73d95e71abf1d4f8d75c11|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianControllerClosedInputV1
SEM-N171|a193fde1322bf8b2ecd4535b13b8dc86cfe544e4d043e6ddd7addabbd4f5bd0c|af32b2e55da17202638f4404b29c8086d3b043abf2b6325fba5c78cdf325f963|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianControllerClosedInputV1
SEM-N172|85e0227f36b05a4fc7d58743cb5ccaab77c51c3deb1997894e169b5e174a5562|ec01bb9f8a92165c4e57e8cfd00e43713fb165a5d153d8b37ee5bc90344e05ce|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianControllerClosedInputV1
SEM-N173|03c00886c3797910b0dcbf151175faa947aebe78bf96bd4029b50068c8e32a47|0cd2aed28f0c79e8eef4ab5f4fb603d61f2b308bcae8dbdb1cdc91f6a50eb9c7|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianDiagnosticFailureInputV1
SEM-N174|462e03d7564906700ea33c313293fd967536da4ee2e06badf8386282fb8c5e66|e6801590179fc21c95c92c3a15f9e447c555c829a3b454a3c71de05cffaff366|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianDiagnosticFailureInputV1
SEM-N175|5d265f9a7610043a7529e85e38d332749ce3c749ff79c1113add408462802b97|0781c7291d4648f8ce5ab84d4afdf763f06481e9e689904c9ee02af78b556255|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianDiagnosticFailureInputV1
SEM-N176|cf0262747c2bf86b43eac2438c24fbd3e4d91253805c2bf03e355f7f4687df83|d7e8b16b85c92997547322f214e15b538bd67d83dee40b97120470554d28f524|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianDiagnosticFailureInputV1
SEM-N177|fd00d420f98062835ed52ba4d310282dd6c9c83fdf69a1e47333c512932f2d4c|8a9e5573d3c45598075e543ae049f532636f38caec89f24e189c5f4454995d2f|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianDiagnosticFailureInputV1
SEM-N178|b74a163065e8330a15fc7dc821dcae5b0dc9f60a544c4bd0175598845ddb570e|8061ca6bf8b7502fe69640051e5c5f4cdb50140dafeaaed8130e98f21b05f1b8|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryControlHandoffInputV1
SEM-N179|183c3aaf413e131ec2d0acb2c592fd5fe715227631fd4fd49284d07340e3bfc6|8ed1ba57e8c8927992ceff0d4a7b73bbc70f8380a9cec20b97111eed824a2991|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryControlHandoffInputV1
SEM-N180|30f1af69b7fbb5c38c33bd78af8ed4f3c4df4d4c9a78c59dcadb44da2dad16fe|dc276dd0616fd92ae4896b2cd0ee9c1690a5aacf82cf645b75521a5f52d454cc|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryControlHandoffInputV1
SEM-N181|4acc64a52cc723fe83ccece21afe1c92272531d60d6b74df86351a24cf881d14|01e0b26ab4f99906fb64c6a35933e3b1aa6f173e2f70817052a1e074b353809b|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryControlHandoffInputV1
SEM-N182|e38079229a79b66d4a4b2b7eac7871ddb3a37af1d698aff74006cc5601faf4d0|3a43498567d876dde4691e82d9005731a6f55ef787cfd5683f078330c77ad530|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianRecoveryControlHandoffInputV1
SEM-N183|c1500a7d12a90a41a168f88a2341d1037892368a63c7d5dd645004baa75532ef|e4512253373a2acdfff641b8a8b5d25298f25d704b43af1ab6c416a9178f7d16|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStatusEofInputV1
SEM-N184|c3f81e3d9750cdba447fde5478d51da5d7346e9359ed188271fb2d75a518f387|3181ffe3cc9d6fe1e8f4f3363e01bef6f69163faf07a329a72fc9daace33a5f1|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStatusEofInputV1
SEM-N185|dbe4ad697e312edacedcfc03fd9f4e7a9b64245e23c915f54caa8d34a881f0f7|cdb232b7af46ac5da007395d27c784d08784bb7176f910a8f1e194da1605a120|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStatusEofInputV1
SEM-N186|ca8f2d484d89c6f05f63c04128152676f16e60bb7a9d1c46e9c622fe67b8bce0|24cca1b18c36ac2c5065f807965c04bae7b1c2065ca4dcb5b9034e05507afae0|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStatusEofInputV1
SEM-N187|f5760c232a030fcef50e6f1dfa725b33b91f74a1a2dcc30be595e90b376bacd8|d13ea9a68bb3f521187484a2342c7f424545cdf2cf72d3a575da393669e2fb2a|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit createCandidateContainmentGuardianStatusEofInputV1
SEM-N188|ebd3651022e7839fd2f23e20c60c56c6f3f107a040f10ec1b50edd6d2d2496b3|8928aa133b119212486ade5e790378125b664fd3332f918ac41dc060f3ff93c2|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit initializeCandidateContainmentGuardianControlV1
SEM-N189|656c54adacc5652ecd99893d31aa017ecf75626919f72f77be7bceaf99a57c91|2218ccbd9bfbdd49e5631a3285cfc214eaee950ea62c0bce3a42d402ce7ab19a|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit initializeCandidateContainmentGuardianControlV1
SEM-N190|f3e34b91952acc79f1a036b563c6b2ed90225fa4d3c5800f72f60694a74063f3|a0b483dbe66c229b289f27589916be79fd5329dcb55efc9c8ee5af61abfa43b9|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit initializeCandidateContainmentGuardianControlV1
SEM-N191|713f62c8e1b315029fdb1f077598ed8a34e6edfd8dab04377b1b6d892c23cbf3|15d34dcc67f614d9dbb68b8cdd124603ce1e2bf87d01fbde0c682a4e6886e6d5|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit initializeCandidateContainmentGuardianControlV1
SEM-N192|8ff58f8cbe1bb5746b35f8d68660e9b5209ae500b050d2e9fec7cb1cf0c63651|f22161e2e070bb6b4d004e3fb1ae88deba08e21fd14651305944c01baa42cc08|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit initializeCandidateContainmentGuardianControlV1
SEM-N193|256c098b18c531758d510c16b5892937e974112a6588cebfc08da213ce7b9fe1|c980b8dcfc6de686cde22eea313a4b8b7b0599cf430c7431b52ee97b0e894a77|1162|estree-policy|static gate: ESTree fallible operation does not dominate commit reduceCandidateContainmentGuardianControlV1
SEM-N194|f3652faa0fc0f4eee8b31a675bd9ae5427ecc05c8d298379662f1b8507dc4ff4|3639848e0b12b63bb15caf8da9ba3540e0d2669251c4271c8dc0ed35c1a53096|1164|estree-policy|static gate: ESTree fallible operation does not dominate commit reduceCandidateContainmentGuardianControlV1
SEM-N195|352ad0df937bd61acae4960a5c5de9c3170702804ba366ccd0d6baa21353d868|424f5ed6926ed8de4be469e4133d763296e71d3c78a58b7bca4081bdd724626f|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit reduceCandidateContainmentGuardianControlV1
SEM-N196|278426c47cfc04d4bf17884e9242ef0bc4499bb434d6f8dd35f087daf960723c|d31f335719a779a96408f3a189025fc59c0b37b98816b7e0361b20110ab15d9b|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit reduceCandidateContainmentGuardianControlV1
SEM-N197|4390a17b89547cf29f4b8bb08959468c1d1046caab819d04fb2f409e62ddf4bd|e615310522fd4f33ba0efca2e6b626bc8e5e7728d1809fa57b5a1e1650b9b073|1163|estree-policy|static gate: ESTree fallible operation does not dominate commit reduceCandidateContainmentGuardianControlV1
SEM-N198|c64b76ecf03f3d935517668ad29fb445c9546ea3368a4a76b7eaa19c2e373e9f|e6076594b0f34825fb2e070911a453e25f4709abd5a9721dfdeca6776c7274d9|1159|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStartupV1
SEM-N199|6ff9598ec617ae431af90cc5e5ee1d4bfd22aaaad8e942310368f2e68d49f2f1|45390b3b38808aedddbc36e83de8bbc6aed02c4f67a89993e2dd8c960a7f4b78|1153|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStartupV1
SEM-N200|098731d2c0430955350a64a8e21ff9ec4a2e9a503864a02ce0992e705b7f3ec0|d0e3e77b2d5ccfdb4cb5c04bf5da009eb2f94e6a964724a0ae059cbc65f14ed7|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStartupV1
SEM-N201|75882313046a04e08bff4d960bc3c42854c62a5ed7ed173ce382bf5448bafa21|d65b1730db354e67430c46203ce96f0c9a40563b4649f491a886285603000e9a|1159|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianAdmissionInputV1
SEM-N202|301ed59bff5c26535904b76c96e54a0987123c41d9a5f48a6aa74fcd4ec51d60|b79b2a8f9956805500dc434bad328398bda9ac4e401032e41bde10469ff5496c|1153|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianAdmissionInputV1
SEM-N203|5164d9fa6cf385de104d55ba97b9da119655d24610377ecc5dec7119d1ab6adf|2f7e115652caa89beb2f1f842991fb07776e1938577e4eacb99911807254da6f|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianAdmissionInputV1
SEM-N204|1575ee3eb80cd72bde5b516663b463d31e5b63f24efd5105048f1eea6c1567df|6091528e3a23f75c758fdb37296dec4225a32392fe8d41c98a0d0ddf9fe75358|1159|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianCancelInputV1
SEM-N205|1ed65566317f53450689ba25a12fb1fe1772e3b71ebb502960fd16548bef4962|e6485f3ec0c73df6b7ced587b8f871aab79f279cbbdbc76835395dd7b0bf8981|1153|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianCancelInputV1
SEM-N206|cba47fb27321fa27c8a750cc3615f88574b5a5916eae3d142bce8cefea297717|9eecbdac279f63dc0daa606f67f4d6b1d2bf391eb86c58ca8aa39f0723258322|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianCancelInputV1
SEM-N207|a5f0868d510ef79aee0bbccea7780212864c70ea6f0ae541e251286cf3b5d6dc|36c01e85f81cee5f06f7461434ff06f07f565955b0fc56547f79dea9cbf2f688|1159|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianRecoveryRequestInputV1
SEM-N208|2a32ef73bf8e7d86856976031b5b6aa159d1afe0ef4e991b1edf00caa3e8840a|994f9f95cd78cc51bfd539e434aeb84fb7e6f08c28f81e507ffe4146499ebd4b|1153|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianRecoveryRequestInputV1
SEM-N209|afd441357f75d255d3d2d4530018451b8420e5e2b9d2fa183246d9d93565429f|789422904f5c75bfe3a0fa6199d27a1cd4f32fc57418d4893379631ce1119365|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianRecoveryRequestInputV1
SEM-N210|99df4f27b6267b106cc147546e0680d4940eb5f1aaef74410757f005dd605f42|0d58b18d519a3d699633d8802035a1d4422d432d2e5528b9ffc3d936f316f8cf|1159|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianControllerClosedInputV1
SEM-N211|7719aa315fd0143fe38175e2c13b2ede7b259289f7062b0e47d1afc457048711|39e2b483f244a863fbcc8d15da00faba08deb8748171e375abb4f486bc6f6e24|1153|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianControllerClosedInputV1
SEM-N212|8e6e73137c15b9ea46c23e5e3c079b9c255523b1fb7ac6186e6d612643a1ba73|d00af08171ff7fe30b0cad7ab647625c288081993e85788f0000e81de39e2b88|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianControllerClosedInputV1
SEM-N213|cb0005f94c8ba8c493cdaed83653a9d018bc9395ca6f96a50987f8a48f0f860b|5cf5cf442adc206d7d8d22c400feb1074f7725549f40e3294c685a6423c2dc13|1159|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianDiagnosticFailureInputV1
SEM-N214|c2d4f21f7eb600409f8597c540e42a0991830222a3c9dc8b476e69fd1a4d152c|5d8712feec5bc3cce37e1702b88c3272bc81673c3ae159340fff5dbc97aef7c8|1153|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianDiagnosticFailureInputV1
SEM-N215|f1ae35b8531682647b90689a713be48e08be7821e1aa31c6f17bbeca59afac94|d6e6af9b29b2a86cf26f475c07fdc2192e9e3d05eb9ade31e14f506e680e2363|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianDiagnosticFailureInputV1
SEM-N216|cd9f4457c30dac217589047f2a6f943cd2185b183248fd8b1288c70115187e6e|7dea45488a8a64095c75b127481e3eaede0b8dabc2e95c7f866ceac337a86527|1159|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianRecoveryControlHandoffInputV1
SEM-N217|68caa4a8cc6bd7a2353b54697f54bbaa01fd981c7bf3a0087c7f3846d78eeba8|da0149f487b3c35604ae62e0c7fa743191d30379247a2e9e07bce6b615206cae|1153|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianRecoveryControlHandoffInputV1
SEM-N218|e80754c03bd6e2013d116c8088b5a4160007b2de8ce25a24322abc0b7d475d03|1e4080440105548d80434e7a3a7ccf45d229b2ef09a15e978053fbf0b76e1038|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianRecoveryControlHandoffInputV1
SEM-N219|de9875c01815aa469ec52247244a1a54134790fbd7f83bafdff0d19dd0c3e1f8|dd1b53cdc1b1ed76a6aabff946261c6068138bb6a37fccf87f2088b3e2d31ce3|1159|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStatusEofInputV1
SEM-N220|bb3b728163a72cc2beac483797662ad173ef81cb1a3082696695aa5f3ddb497a|a507303545af1f8c6fc12681c5b00ccfd3d987fc119c307747a5e4b0fccd8588|1153|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStatusEofInputV1
SEM-N221|83bccf2c598452c344210647d737b96e3ebf42439dadbc524d8e457236e49ae1|714166c33821a4d8b1975eecd84fa5f10e6331d93afd1ff143d09059928bf921|1149|estree-policy|static gate: ESTree private commit tail createCandidateContainmentGuardianStatusEofInputV1
SEM-N222|fae65c0cc9fa182ed4ffe8417a27186fb05546b03feb05ccdce05524b2fc6963|855c6403b9b113e001868bcfd8af1e120e4c0adf1b0a6140056898a94b1b9f43|1159|estree-policy|static gate: ESTree private commit tail initializeCandidateContainmentGuardianControlV1
SEM-N223|3fd326434b9c59da8a905fa3efc7435086114d4545547de7c00d09efb317ace4|6657546aa78193b19afdf875d6ded6bee7ec280805a6d5237b37d4f0e7359db4|1153|estree-policy|static gate: ESTree private commit tail initializeCandidateContainmentGuardianControlV1
SEM-N224|5a178b991382ee94153ca50c85d13ffbb21d5a5a2197508311b0a67a534e0c62|b0180234c2c81c723fa0b095750852e6d71165e02aa7f363b09917229093e722|1149|estree-policy|static gate: ESTree private commit tail initializeCandidateContainmentGuardianControlV1
SEM-N225|171e3b1727d32d5f260a039f2c04d836cd8cd4f891eb4423aef6733a4391af0d|d3e599c51d81da6f92aab4f2bacfb7a34869bb05bc4de311042e3b6af580cb1d|1159|estree-policy|static gate: ESTree private commit tail reduceCandidateContainmentGuardianControlV1
SEM-N226|6e9c99a94e05c9183497654a60448d167253ee9908f9dfb5e385518f1cc9f97b|a6af8ad95063d6a3b5b7a092b7b26bd0bf8a73a7e96df36877bf584b8f366b68|1153|estree-policy|static gate: ESTree private commit tail reduceCandidateContainmentGuardianControlV1
SEM-N227|0b80a03664f824f2a9285ce7e92aabf74cbec8fd1b616faf9f938c6feb866540|a5cb2615eeaeb132a7a657cbc9b2d870fbc1291639b884c10b06a973511e612c|1149|estree-policy|static gate: ESTree private commit tail reduceCandidateContainmentGuardianControlV1
SEM-N228|e4cc526cc251aa19c81f9eff7df4d07b3a16801feee33c7549705191afda7800|24521668fd08e543cfe0fb41772e3bac0190c887ffe93ce8c0f1d6b72a706e02|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N229|773dca5f5d3117312bcb26fbaca69cea227c8af0cb028431b5bf1801dcb57c38|767d9229509daf8ef1d655651db55c05b8e8c904eda5b646dceb96233a87e121|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N230|c28fa31c1dd156662c1d0ee4a6c91e4207ee9971e22ffd8ca9b48d8fa5a8429d|4744744ca8d48dad8004fd5bb5a3ad4e62dd32ff756afe89077a173368abd379|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N231|40afc51a28aedb346730a816d65afb1e3e0e8d97adffd0e9280bcaed67c7d973|ae7da45964792a79358ba24f63a468a95e77390c8b6fde10ba7895ebac0cea08|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N232|6276a797f5db3d690856f0477242eac5a3294c1d9b91ebe6d45aaf349d0e3920|e2a9a3b32cb52ec39344b9aaab1c4a427e4cbc0aca3e19c158f1f7abea8e6ebc|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N233|7b2c007b32f066d85e3611620910921f8f78c9d253a8344db99835e077f183a6|2428dcf468782fc59cf8685661942a518b36b17e3a3a2cca9b83f24d55467157|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N234|2579d492f633586a96b1ae36c4d2c04637cafef939b3361be4e8df872f1e7193|644fdbb60edc1232bc7fd4a0074b74d71bd6e7e4909b83f9cae71a2b04b8ff0b|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N235|4dedc9e524ccd5d8ac7abbb6cfae60cc476c668dcf21f3f139e16bbd56ab1cef|58c6992583f7d80d6beaa1b0ea89d5e094c090d6437a9437022181323ae52502|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N236|85aefca01ab9c63621d86487a3a0973be1fe34a3ac151f3192af96ccd9e4182a|55a3ef7635351f7d23a84869a6876387b315114555dc5d777dcee97808cb084c|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N237|0a8c4a2a5889a6581abca34bc35e23be1697175fc46383dd71e6a92097150837|3bdcb9608c7374b4613bd9f24d4e354b4e255ccc8736feac1621f84f63ddb537|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N238|7b4b7026e323c6760ebcf86c0a9c05fbe9f3d51abbfc03f40c94c67db6ddae22|bc0bea58cf920a46a74874343f2a7bbb082a88fc28b0579b5ede0c1d3055df53|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N239|5ad3e300ecfa1e93828d0245a5942e1fc1964165dea178a0ebfd8c197c705730|5ef58ea81c1ffcc2058228a4605f2b03300605b72e9b6851a48651f71b487608|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N240|447a35311c84f13116ed8b368fcc7ca9637d7d5747a3c46c1aa86df919ec6c3a|ab8ece4cafad57c468a92eaf1483fdffd4665656cd50ced8ee70c2de9e8fdf0e|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N241|beaf43dbd3488de020d18f10cc472d1b9d02f0e723b429dbe442a8dce4443834|1cbbd3eac3454003f1f566e4aa0d87964e22caf6834e92f36f1529efd908b09e|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N242|f6b16a0d13461743e335d77257629c9979d3b48a003cab3c48db07af86044525|ec89d60fea662ab73a5c8ddbae05862f3ccf16b33eb2a13eb739441a3bf7a168|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N243|db3631ca6a7a06a3f389a7818c319f3ba98416372a77d68713c7c12352346b1b|91afd318d0688d692ef55a3e9b3b6cabe11b3e83b526857d0535b566aff23d70|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N244|dfd496ad7d896324ef5254f8a9262bc1a2bbee1210676e49dce3da52e09e7189|026b05f85fbcc358e0ba5e14455c0fb271af6d374cc1c95417eb7a568c57e8e7|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N245|51069daeb258d2d93e4addd289dd414b1756ab8b7fd30e994a2624d8b2939e93|23efd6290fc26d8369ba6d0074c7c0f5eb294ab0761ac58dde9b88a89908a130|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N246|d83f24dd4101840bedf3680341a1132e390283bf3461cb640c33fed5811e8abc|53b4da0590bee0c535973474b16fe868f41c88a44dd3649c4482fef4b9b52d36|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N247|26ccf2be3629345a96ef6700a937cb08bfa3634294d8483b253203e4b05053c0|a9bcae55566c1323c07ec53319c3901274bcb61f97ca587ee305f67354db9551|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N248|de6de51d8868cb1f8bd74b6fad32cc809412e9ab0f9416617d1fe4e01d60c622|d83fa8644d85ed98034a79209cc6b4e4d7eb35238b953aab592828d7070e4346|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N249|17a138d681db1960068a83687ba857ed9b6ee851b18162e6921b8442edef92a7|e62ab7e7d6c62298c9d54355ba181924d19c1d5b1a58a76c7a96df81e7b346eb|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N250|85b2be030e342ba0cc54818743e0523d2adfb8b0f2033df3dc9c5075bb7254f3|f8724852e1b93f5d066db5ff898ea667a9331ac784ddfe39f877294f14334cd6|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N251|ea179276dad58e40d73880ee40492e09a871558f2239c6fe4b9bd97ae62e46b2|ceec091443d363e8fae4e0fae40f64d51d58b1ef17e6f4be391d5e9d088a5ce2|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N252|df13cb1208bbb968fd449ed9f8189c85542d77be239d7a75cb22c3aee0d06b5f|c4fe0799506476ae781999a43991b8f97f737eb79a96dad4fc1bbdd9376be063|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N253|e2db90e1c76e1a076c6c80e886c13621afca93c65f7683e1bf2f1908ba98b00e|14b5786db4f7d987e5363f965a471f866227b450df3ff3a05fbe62378e4c3858|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N254|107183f4604a4757c2b9df5ed696f7907bb52ea788a15d843fc92f6a95ce6b4b|c0f0d65272692ce7ac9c097371ce59b03cc1e47ab66b3f4aec3ea8257382a82c|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N255|5533804968328a33ce2d4f1a85f5d19175fef2cea4a5f61ca37b3a30bf29c27f|9ef787d593d1bede24985426f5973b2609301c7a33fc3da2daf2114883b703ac|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N256|a053480287b3f5c7027acdf4f27a49e2e31ae0b636a7297cde52bae2588a2637|85dbcef44371afd0fbf378f4398e7abc571a1b47602576cfa57e2cec35f694e4|1147|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N257|cf919543621736a3cb9ff44f8fa3f7b9d8123e35b9918f4ee32920680ee507e4|400bab09b23990e7857e83a6a0c77d3d937f77a9e33888b1e69820e18cca3926|1166|estree-policy|static gate: ESTree private commit arguments must be frozen and disjoint
SEM-N258|c2d74327170f2ab50d2e98e2cb93440c88be96b2a7e15840bee7d5b4cda7c2f9|4e4e55471354a53b47573587e6f9b7f43a1ddee3d3399bf5411e64f0b7a47d22|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N259|d29b19ce3eba50bae213399eb7bb8d5de1d53df3b244917068cd341506ce569c|1bbd677f31de3a920ef36d6ace538e48c052ffb497d67f38149e8b226f23f528|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N260|09196842b04fbc87c11f72e58cb8f8e536b2c8b395472f4151e52d0ac8fff201|dc726bc69fd92981af4515d4b5a32e3d8d6d72a5852dfd98dbd13047e0f02a00|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N261|897e6f03e366c63e3a1171664b9bdc2c98fa43f958de662dafa0cfb33756f310|cdb331f2097ee9067f0b5264eca811fde5fa8597728e7dab64ee6a53ac9a5a41|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N262|32e6a14cf8044103316962e76ecb3b9e1b1e3cf9d73ba8b00ce30b7f3d2ebb9b|3531a3a81f1152c831891f72832c8bc061921ceac9c0c38a8b3e8255254b75e1|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N263|8cb217504d70a90bea5d2298d29601273911883480c37f47fa29f1b3ac4fd1f5|b41ac26d585a765d8e4fce064d69b917bbf56ab5399b885fc2b279600e328cf6|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N264|fb0d0eded04999d19d6fbd46e2ff3e0125496eac94741bcd18afa1d7faa0b481|5e73345c1335715919b1bbbf88eea36e5dcf2a80a9cc035f8c2734cc1ddba495|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N265|5d965d99bb78baf3b30ebbeec97cb48dce3b5bcd58b745c90dc9b42e6b023677|0340ce07e692a3a8c70cde7de9b758c2d54d57ee02d987345eaec89fb6f69906|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N266|ffb2508ec1e36a7195911a501f31a3bf4e0a1fa4fc99b632ce52dd6dad87ee2c|fd7b9c23311c304c5b96590bee61f883d530f9a5cb2ca45ad8d9ca3a1e38ae6c|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N267|fc3657b8a85e01baee0d2cb5d0f7340a1be902851842bf34242cddbdc757768a|cef50998171d0667104adbdf8592433cd0d4e579423e26346618a23f8ab89ea1|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N268|44e0d2bc2539ab45db60ea55b0c2f460093330b1840a76eb799851aecfc4d9b1|432faf8d9f67668d4200f20a890a477e00e54dc3704923c6418c7cc40058a4c5|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N269|127bd0fbc7866b4cc0b6dea1789c23bea364959329655fb49c739451ea17b77d|7c94d8a8a6b24d8f67d6e25921d9b03fb58ad4672e78b993f379bfc7fa2508c8|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N270|d4735cce3110190d5f2d4576ad0c6d98ddca02bf57bf73e2e558d65489237165|551e1e96d60a9765220ee10b5d99bd2250f9a989e50a9af425fcbad9f8fff082|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N271|13b9f99616064602a4acc09434e0ca622cffd52aa8fdc9275b65c5ecb46ed8b1|6a37bfb9744bf74a12b2d868a6e4654eeac032febcecb09032d797469fccb6ed|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N272|0adfa6042dd03fe7e18ad0926c42b136f32b0effd0203c99f37d56c216434add|c1d97ce9b2cc6133454248a14be0f6897404a4ffb631126f3d7490b7a3fdbe7c|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N273|7ddb9d4a0810afaa16cda73bdd125af7d9be325b06261bfae7eeac56e02e8948|f5a69bac8bc3345f17184ddb1f34e199c23b0560c21a5bf31aaeec37d0bf4c84|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N274|4eec78f0b6553c79f714e2e6bc694a16595d457a2677365f8fdaa9d6f004e07d|cea574b6a41b9e215888c3cdcabc296b4eaa5f3a0fb3067d1e4d7d19c895a3a6|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N275|bbf9e35b820689f7ff40e1c6cb5d85927dd3da50c44a6b9fce5c24731ee73571|9c11dc8d8b3b37366d0985c1e1b3d24fe98cfbcb4efbd19ef4e1b6d2ec1cd5b4|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N276|c008a4c79b0602090160c6994fd11eb0c688a3037a0eb7a65b5d8b1f4285a188|a6b2675e983d55af39bdac9f5f6cd3648d0dcbbdccfc0105089276a8b9fbeadc|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N277|58db48d06b2df328402651e1307109d80b63b07d01955b97916e76cde4744773|ff593760310d6197f511a11500dea916477f51c446bd517fe65cd56ed9cb2a9c|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N278|29f1808962cd5b1f936f222f803af7795119b709c5446e81737b015bc78f267a|1f6c1260bf80c18e68ddc8a6aabf7df517d4882ad8875001dcbf1f27d9a239d9|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N279|19326bba66a447d7219c2d3e641614313374f28f3d4b7bbef3e282646721749a|9a07e833e6f0556aa6a9f73401ba72a26db6b9e00ac937961355cc4cfe7a3ab6|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N280|f9da2b36fe9dd222d0c6805acb4cbc844c3e2c22dd6299ce97bbaddb0b0bdf12|abb3ec69bf505e5fe80055bcf7cd2f80afa6e0b6ba78a1a6f5394d7c80020668|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N281|e2e6276c5cb35fa2da46495d44d77b2b0d7f61af5f7840661688e626e6d31fdd|39f5182ef7148eb18fc1d7414fdd77ed261ac5cfd53f3852e79f68a28e85e6a8|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N282|99de7c47364288eefb1a2d07eec319a826da7906570aadaae6b762b2faa71e61|710cdce696d015487c552c1dda8eeb22178ffafea8222406d69a211b69fe09bb|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N283|641b6bde48991836bc2251215934165600f5171cd4577b397b09592aa59e8852|3ad21cb709cb393a5be96cc0945d882b9b91f42be95b8589f95b30e34d0531dc|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N284|e1bfa635f523d822d9adad630b2fe59b6d87eff020ee0afa032f253e3c37de66|d336729f160b7fde774af36b476986899da445e0b3dfae828032acfcf48aa984|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N285|23f8cfad05eba7f30b14554f87607c9d1cf9a507d0561189d557abab4bc24b48|646b9db6d1e46f43bbf1a373793d41628761e9cc517e549ada5ecb55515615e0|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N286|4408f52e6cf1012ea75fc041c0acdaeb0636ce1e3119da0cdca4dc84621bf635|f0ab2dda241bb122fb74dab6256dd1cccf40d2ce9884b60c986c2ccc1c6d43c5|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N287|f8572d12dcad3d099b27cb37e55a76876d61c858d2b73f247ec37327fe96adae|6e081d324229244463ff883152dc76238549db2131d185c94e8deb89596b164a|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N288|a383127ccbab169ca1fc152b630eed9866a225964a61065a8777da0467b67823|01b25b409a3f326d15e3e53bd857ea4f8922007966afe353b56f25c7c34754f9|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N289|08f095c2c79670485d464691e5c987a43b62661c86077069f3996ed6ec347cb2|d62aa47a951e6918d87f8a888c45d2cf7260d2adfb75f6024eb0ee164069c0df|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N290|1697d5cdffd200eccb16376af36722f07d9ecc85736526540155583db70f73e1|ea490bc57638e592dc836f245860e40a576bfc06700cf667aa9938bcd754f06a|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N291|0e4fa576956b0588e87bcbac9ac09f7da7ecf99893409f10212c10a52335e6ff|b9b472edd1e03115f166eeba11b7717d4d677f76111162c79f34f28ec6ccfe60|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N292|5ab30c989e4e128668ffeff98e79c2e812e21cc588d78b5ac18693c92b5c0194|894ce3d4076b546b6fa5706c4600d373ab7d2a594c04410e684cef8a4b8d1cba|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N293|6e410ea5d695fc0dca51eb0299ba01cef6064faccdc11c344f058285c85c7cb7|bae3c5bbff194126eba09d10a2e66ae0c92047e7b57cf9311c1baeebecde296d|1149|estree-policy|static gate: ESTree private commit requires function-local arguments
SEM-N294|1b23e1505cf67d6bba0e2c5621ac0dcf454bf29ed4b2a84fad7922ca69714153|f58974cd7fee1a05e391998d7305bad2c2af5c33d7f49dcdef1dab605788ce75|1150|estree-policy|static gate: ESTree parenthesized or indirect call
SEM-N295|74120d44635bd38194dd5cd9a3b51047a763541ce6eff66889a9a85e259e614e|13baefd748d5ddb126ada361aa5082625c58dca4ea4f90b8baf225114d913081|1158|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N296|0a1703c955b9b07b411aa3e99b9b4d9243f9ccb54b9705e3f8171790dfa0c02a|cb5fe9b7bec8bf246f3ae9c5bf3f66f0dfd3446ca7f6f127675f0311d41f2537|1145|estree-policy|static gate: ESTree private commit requires two identifiers
SEM-N297|a915d664013e95e241b9fce8403abf2f48d7be02e5146e138d62e649c3fe67c5|40a48c7bc3588c0e5768ace3a1ce4522d54bc23d5e06c5ed50b690142fccb73b|1149|estree-policy|static gate: ESTree private commit requires function-local arguments`;

const POSITIVE_CONTROL_EXPECTATION_PINS_TEXT = `POS-P001|1833d04623330968e87ecdcdefb7f9324598301cf89691bf7a5f18b30bcb13b0|958d07ae92f1e08483b9948bb86525299ce5a7d8a5c77450916f39c679590df1|1149|accepted|-
POS-P002|52136dd8f54a7cf4d2f3b09314696e4b96136c50f27bbb6730aeee761e240f6c|55d6de40d7edc001614d95da59266e6f507397160e15f6b84492d0c1879aa35d|1171|accepted|-
POS-P003|ee9c363f0f7fa62114a29bb5eb70176753d4061e2714090f7126e3dca8ce6423|0c14bf96bb50459894fbd9130fd275bd13d1764423f2e57ebf554de291745278|1167|accepted|-
POS-P004|f07475cf64ecec73afb4b645cb64032184d03c43ed3b4a99e8c08f753b20e3e6|216a6b69c2684c0d8741d61af956e6137ca311f055af5fb466b6ef7178b30fef|1155|accepted|-
POS-P005|612e51636159788b3dd225f1d01b5aaac928ea2a2cd40a1ad1ac855414bb13ae|8f09df4ff27f4dabbe635485ff84fb577e5c75d9b80a3eed62552dde88c3fce1|1168|accepted|-
POS-P006|dbbcd95be39251964ab93f8efbf764bf7b3d296909558e0af929fa1136c50aa9|39068b60e31c1171c0d36a5a7465c1870436dbf98d4ef4fef9107017e5ee5fe3|1165|accepted|-
POS-P007|dd612825afc1432da1801457984feb772ab602c4b7dd863922318c521e06b28b|39a504a9c65bad80c39d4d4c80486003d616dfdaa1a848ed0695fb3c7e99929a|1165|accepted|-
POS-P008|1cad7a64848a0d03c0e3a92c19bb6981e5efd1f3aa587342503784588ae675c5|683624ec04e5dfb038b32041d8781ad717982424c9e2e011894b299c24e7cec8|1165|accepted|-
POS-P009|492103fc5d819387ca0d71d45f499dfd0187e69dff406cd4a0fc7e4da5577603|2121d9703c44fcb45ef4c6438fb5cd6a963023184e0757f7a329a01da7f37c3a|1245|accepted|-
POS-P010|2475a732fbb911b6cb3d152de04f88cb05deda9a38cef76accf77df77ea75b6a|fe3579f4ec165e5710024694e55502c602e07dbfc2cc7b374b9aaa3a9483fed0|1165|accepted|-
POS-P011|6e746ae655f2d45553cf5e0348b84ba9a373c07836029a4a664150a9c86524d9|1f31397aae0b77941325b14d0aba2eab2a6c825b6b3069a654cb0e90ac3a1763|1165|accepted|-`;

// Preserve the complete canonical assertion payloads without delimiter or
// newline loss in the compact literal pin table above.
const ASSERTION_CONTROL_EXPECTATION_PINS_BASE64 =
  "W3siaWQiOiJGT1VOREFUSU9OLU4wMDUiLCJlcnJvciI6Im5vZGU6YXNzZXJ0L3N0cmljdCBkZWVwU3RyaWN0RXF1YWw6IGFjdHVhbD1bXCJjYW5vbmljYWxKc29uQnl0ZXNcIixcImNhbm9uaWNhbEpzb25MaW5lXCIsXCJjb3B5Qm91bmRlZEJ1ZmZlclwiLFwiZGVjb2RlQ2Fub25pY2FsQmFzZTY0XCIsXCJkZWNvZGVDYW5vbmljYWxKc29uTGluZVwiLFwiZGVlcEZyZWV6ZVwiLFwiZXhhY3RCb29sZWFuXCIsXCJleGFjdERpZ2VzdFwiLFwiZXhhY3RSZWNvcmRcIixcImZyb3plbkNvcHlPblJlYWRCeXRlc1wiLFwibnVsbFJlY29yZFwiLFwic2hhMjU2XCJdIGV4cGVjdGVkPVtcImJvdW5kZWRJbnRlZ2VyXCIsXCJjYW5vbmljYWxKc29uQnl0ZXNcIixcImNhbm9uaWNhbEpzb25MaW5lXCIsXCJjb3B5Qm91bmRlZEJ1ZmZlclwiLFwiZGVjb2RlQ2Fub25pY2FsQmFzZTY0XCIsXCJkZWNvZGVDYW5vbmljYWxKc29uTGluZVwiLFwiZGVlcEZyZWV6ZVwiLFwiZXhhY3RCb29sZWFuXCIsXCJleGFjdERpZ2VzdFwiLFwiZXhhY3RSZWNvcmRcIixcImZyb3plbkNvcHlPblJlYWRCeXRlc1wiLFwibnVsbFJlY29yZFwiLFwic2hhMjU2XCJdIn0seyJpZCI6IkZPVU5EQVRJT04tTjAwNiIsImVycm9yIjoibm9kZTphc3NlcnQvc3RyaWN0IGRlZXBTdHJpY3RFcXVhbDogYWN0dWFsPVtcImJvdW5kZWRJbnRlZ2VyXCIsXCJleHRyYUhlbHBlclwiLFwiY2Fub25pY2FsSnNvbkJ5dGVzXCIsXCJjYW5vbmljYWxKc29uTGluZVwiLFwiY29weUJvdW5kZWRCdWZmZXJcIixcImRlY29kZUNhbm9uaWNhbEJhc2U2NFwiLFwiZGVjb2RlQ2Fub25pY2FsSnNvbkxpbmVcIixcImRlZXBGcmVlemVcIixcImV4YWN0Qm9vbGVhblwiLFwiZXhhY3REaWdlc3RcIixcImV4YWN0UmVjb3JkXCIsXCJmcm96ZW5Db3B5T25SZWFkQnl0ZXNcIixcIm51bGxSZWNvcmRcIixcInNoYTI1NlwiXSBleHBlY3RlZD1bXCJib3VuZGVkSW50ZWdlclwiLFwiY2Fub25pY2FsSnNvbkJ5dGVzXCIsXCJjYW5vbmljYWxKc29uTGluZVwiLFwiY29weUJvdW5kZWRCdWZmZXJcIixcImRlY29kZUNhbm9uaWNhbEJhc2U2NFwiLFwiZGVjb2RlQ2Fub25pY2FsSnNvbkxpbmVcIixcImRlZXBGcmVlemVcIixcImV4YWN0Qm9vbGVhblwiLFwiZXhhY3REaWdlc3RcIixcImV4YWN0UmVjb3JkXCIsXCJmcm96ZW5Db3B5T25SZWFkQnl0ZXNcIixcIm51bGxSZWNvcmRcIixcInNoYTI1NlwiXSJ9LHsiaWQiOiJGT1VOREFUSU9OLU4wMDciLCJlcnJvciI6Im5vZGU6YXNzZXJ0L3N0cmljdCBzdHJpY3RFcXVhbDogYWN0dWFsPVwiLi9jb250YWlubWVudC1leGFjdC12MS5tanNcIiBleHBlY3RlZD1cIi4vY29udGFpbm1lbnQtZXhhY3QtdjIubWpzXCIifSx7ImlkIjoiRk9VTkRBVElPTi1OMDE1IiwiZXJyb3IiOiJub2RlOmFzc2VydC9zdHJpY3QgZGVlcFN0cmljdEVxdWFsOiBhY3R1YWw9W1wic3RhcnR1cFJlcG9ydEJ5dGVzXCIsXCJlcG9jaEJ5dGVzXCJdIGV4cGVjdGVkPVtcInN0YXJ0dXBSZXBvcnRCeXRlc1wiLFwiZXBvY2hCeXRlc1wiLFwiZXBvY2hFb2ZPYnNlcnZlZFwiXSJ9LHsiaWQiOiJGT1VOREFUSU9OLU4wMTYiLCJlcnJvciI6Im5vZGU6YXNzZXJ0L3N0cmljdCBkZWVwU3RyaWN0RXF1YWw6IGFjdHVhbD1bXCJzdGFydHVwUmVwb3J0Qnl0ZXNcIixcImVwb2NoQnl0ZXNcIixcIm9ic2VydmVkRW9mXCJdIGV4cGVjdGVkPVtcInN0YXJ0dXBSZXBvcnRCeXRlc1wiLFwiZXBvY2hCeXRlc1wiLFwiZXBvY2hFb2ZPYnNlcnZlZFwiXSJ9LHsiaWQiOiJGT1VOREFUSU9OLU4wNDQiLCJlcnJvciI6Im5vZGU6YXNzZXJ0L3N0cmljdCBkZWVwU3RyaWN0RXF1YWw6IGFjdHVhbD1bXCJpbnB1dE1ldGFkYXRhXCIsXCJzdGF0ZU1ldGFkYXRhXCJdIGV4cGVjdGVkPVtcInN0YXJ0dXBNZXRhZGF0YVwiLFwiaW5wdXRNZXRhZGF0YVwiLFwic3RhdGVNZXRhZGF0YVwiXSJ9LHsiaWQiOiJGT1VOREFUSU9OLU4wNDUiLCJlcnJvciI6Im5vZGU6YXNzZXJ0L3N0cmljdCBkZWVwU3RyaWN0RXF1YWw6IGFjdHVhbD1bXCJzdGFydHVwTWV0YWRhdGFXcm9uZ1wiLFwiaW5wdXRNZXRhZGF0YVwiLFwic3RhdGVNZXRhZGF0YVwiXSBleHBlY3RlZD1bXCJzdGFydHVwTWV0YWRhdGFcIixcImlucHV0TWV0YWRhdGFcIixcInN0YXRlTWV0YWRhdGFcIl0ifSx7ImlkIjoiRk9VTkRBVElPTi1OMDQ2IiwiZXJyb3IiOiJub2RlOmFzc2VydC9zdHJpY3QgZGVlcFN0cmljdEVxdWFsOiBhY3R1YWw9W1wic3RhcnR1cE1ldGFkYXRhXCIsXCJpbnB1dE1ldGFkYXRhXCIsXCJzdGF0ZU1ldGFkYXRhXCIsXCJleHRyYU1ldGFkYXRhXCJdIGV4cGVjdGVkPVtcInN0YXJ0dXBNZXRhZGF0YVwiLFwiaW5wdXRNZXRhZGF0YVwiLFwic3RhdGVNZXRhZGF0YVwiXSJ9LHsiaWQiOiJGT1VOREFUSU9OLU4wNTYiLCJlcnJvciI6Im5vZGU6YXNzZXJ0L3N0cmljdCBkZWVwU3RyaWN0RXF1YWw6IGFjdHVhbD1bXSBleHBlY3RlZD1bXCJzdGFydHVwTWV0YWRhdGFcIixcImlucHV0TWV0YWRhdGFcIixcInN0YXRlTWV0YWRhdGFcIl0ifV0=";
const ASSERTION_CONTROL_EXPECTATION_PINS = Object.freeze(
  Object.fromEntries(
    JSON.parse(
      Buffer.from(ASSERTION_CONTROL_EXPECTATION_PINS_BASE64, "base64").toString(
        "utf8",
      ),
    ).map(({ id, error }) => [id, error]),
  ),
);
assert.equal(Object.keys(ASSERTION_CONTROL_EXPECTATION_PINS).length, 9);

function parseStaticControlExpectationPins(text) {
  return text.split("\n").map((line) => {
    const [
      id,
      sourceSha256,
      astSha256Text,
      astNodeCountText,
      expectedStage,
      expectedErrorText,
    ] = line.split("|");
    assert.equal(line.split("|").length, 6, id);
    assert.match(sourceSha256, /^[0-9a-f]{64}$/u, id);
    assert.equal(
      astSha256Text === "-" || /^[0-9a-f]{64}$/u.test(astSha256Text),
      true,
      id,
    );
    assert.equal(
      astNodeCountText === "-" || /^[1-9][0-9]*$/u.test(astNodeCountText),
      true,
      id,
    );
    assert.equal(expectedStage.length > 0, true, id);
    assert.equal(expectedErrorText.length > 0, true, id);
    return Object.freeze({
      id,
      sourceSha256,
      astSha256: astSha256Text === "-" ? null : astSha256Text,
      astNodeCount: astNodeCountText === "-" ? null : Number(astNodeCountText),
      expectedStage,
      expectedError:
        ASSERTION_CONTROL_EXPECTATION_PINS[id] ??
        (expectedErrorText === "-" ? null : expectedErrorText),
    });
  });
}

const FOUNDATION_CONTROL_EXPECTATION_PINS = Object.freeze(
  parseStaticControlExpectationPins(FOUNDATION_CONTROL_EXPECTATION_PINS_TEXT),
);
const SEMANTIC_CONTROL_EXPECTATION_PINS = Object.freeze(
  parseStaticControlExpectationPins(SEMANTIC_CONTROL_EXPECTATION_PINS_TEXT),
);
const POSITIVE_CONTROL_EXPECTATION_PINS = Object.freeze(
  parseStaticControlExpectationPins(POSITIVE_CONTROL_EXPECTATION_PINS_TEXT),
);
const STATIC_CONTROL_EXPECTATION_PINS = Object.freeze(
  Object.fromEntries(
    [
      ...FOUNDATION_CONTROL_EXPECTATION_PINS,
      ...SEMANTIC_CONTROL_EXPECTATION_PINS,
      ...POSITIVE_CONTROL_EXPECTATION_PINS,
    ].map((pin) => [pin.id, pin]),
  ),
);
assert.equal(FOUNDATION_CONTROL_EXPECTATION_PINS.length, 69);
assert.equal(SEMANTIC_CONTROL_EXPECTATION_PINS.length, 297);
assert.equal(POSITIVE_CONTROL_EXPECTATION_PINS.length, 11);
assert.equal(Object.keys(STATIC_CONTROL_EXPECTATION_PINS).length, 377);

function canonicalStaticControlRejectionMessage(error) {
  if (error?.code !== "ERR_ASSERTION") return error.message;
  return `node:assert/strict ${error.operator}: actual=${canonicalJson(error.actual)} expected=${canonicalJson(error.expected)}`;
}

function staticControlId(prefix, index) {
  return `${prefix}${String(index + 1).padStart(3, "0")}`;
}

function createStaticControlEvidenceEntry({
  id,
  name,
  bucket,
  source,
  stageAudit,
  rejection,
}) {
  const expected = STATIC_CONTROL_EXPECTATION_PINS[id];
  const actual = {
    id,
    sourceSha256: byteSha256(Buffer.from(source, "utf8")),
    astSha256: stageAudit.astSha256 ?? null,
    astNodeCount: stageAudit.astNodeCount ?? null,
    expectedStage: stageAudit.expectedStage,
    expectedError:
      rejection === null
        ? null
        : canonicalStaticControlRejectionMessage(rejection),
  };
  assert.notEqual(expected, undefined, id);
  assert.deepEqual(actual, expected, `${id} literal evidence pin`);
  return Object.freeze({
    id,
    name,
    bucket,
    sourceSha256: expected.sourceSha256,
    astSha256: expected.astSha256,
    astNodeCount: expected.astNodeCount,
    expectedStage: expected.expectedStage,
    expectedError: expected.expectedError,
  });
}

function staticControlIdentityProjection(entries) {
  return entries.map(
    ({
      id,
      name,
      bucket,
      sourceSha256,
      astSha256,
      astNodeCount,
      expectedStage,
      expectedError,
    }) => ({
      id,
      name,
      bucket,
      sourceSha256,
      astSha256,
      astNodeCount,
      expectedStage,
      expectedError,
    }),
  );
}

function createStaticEvidenceManifest({
  foundationNegatives,
  semanticNegatives,
  positives,
  evaluationAttempts,
}) {
  const bucketProjection = SEMANTIC_BUCKET_TARGETS.map(({ bucket, target }) => {
    const controlIds = semanticNegatives
      .filter((entry) => entry.bucket === bucket)
      .map((entry) => entry.id);
    return Object.freeze({
      bucket,
      target,
      current: controlIds.length,
      remaining: target - controlIds.length,
      controlIds: Object.freeze(controlIds),
    });
  });
  const allEntries = [
    ...foundationNegatives,
    ...semanticNegatives,
    ...positives,
  ];
  const aggregates = {
    schemaSha256: semanticSha256(STATIC_EVIDENCE_MANIFEST_SCHEMA),
    orderedControlIdentityProjectionSha256: semanticSha256(
      staticControlIdentityProjection(allEntries),
    ),
    orderedSemanticProjectionSha256: semanticSha256(
      staticControlIdentityProjection(semanticNegatives),
    ),
    bucketProjectionSha256: semanticSha256(bucketProjection),
    foundationNameProjectionSha256: semanticSha256(
      foundationNegatives.map(({ id, name }) => ({ id, name })),
    ),
    positiveNameProjectionSha256: semanticSha256(
      positives.map(({ id, name }) => ({ id, name })),
    ),
    commitIdProjectionSha256: semanticSha256(COMMIT_MUTATION_IDS),
  };
  return recursivelyFreezeEvidence({
    schema: STATIC_EVIDENCE_MANIFEST_SCHEMA,
    foundationNegatives,
    semanticNegatives,
    positives,
    commitMutationIds: [...COMMIT_MUTATION_IDS],
    bucketProjection,
    counts: {
      foundationNegatives: foundationNegatives.length,
      semanticNegatives: semanticNegatives.length,
      allCurrentNegatives:
        foundationNegatives.length + semanticNegatives.length,
      semanticTargetNegatives: 330,
      semanticRemainingNegatives: 330 - semanticNegatives.length,
      allLayerTargetNegatives: 69 + 330,
      positiveCurrent: positives.length,
      positiveTarget: 11,
      positiveRemaining: 11 - positives.length,
      commitCurrent: COMMIT_MUTATION_IDS.length,
      commitTarget: 200,
      commitRemaining: 200 - COMMIT_MUTATION_IDS.length,
      evaluationAttempts,
    },
    aggregates,
  });
}

function createPrivateLookupManifest(positiveAudits) {
  const positiveControlIds = Object.freeze(
    Array.from({ length: 6 }, (_, index) =>
      staticControlId("POS-P", index + 5),
    ),
  );
  const selectedAudits = positiveAudits.filter(({ controlId }) =>
    positiveControlIds.includes(controlId),
  );
  assert.deepEqual(
    selectedAudits.map(({ controlId }) => controlId),
    positiveControlIds,
  );
  assert.deepEqual(
    selectedAudits.map(({ privateLookups }) => privateLookups.length),
    [2, 2, 2, 12, 2, 2],
  );
  const observedOperations = selectedAudits.flatMap(
    ({ controlId, privateLookups }) =>
      privateLookups.map((lookup) => ({ controlId, ...lookup })),
  );
  const observedProjection = observedOperations.map(
    ({ functionName, storeName, method, keyParameterName }) => ({
      functionName,
      storeName,
      method,
      keyParameterName,
    }),
  );
  const expectedProjection = EXPECTED_PRIVATE_STORE_LOOKUPS.flatMap((pair) =>
    PRIVATE_LOOKUP_METHODS.map((method) => ({ ...pair, method })),
  );
  assert.deepEqual(observedProjection, expectedProjection);
  assert.equal(
    new Set(observedProjection.map((entry) => canonicalJson(entry))).size,
    22,
  );
  const storePairCounts = Object.fromEntries(
    ["startupMetadata", "stateMetadata", "inputMetadata"].map((storeName) => [
      storeName,
      EXPECTED_PRIVATE_STORE_LOOKUPS.filter(
        (entry) => entry.storeName === storeName,
      ).length,
    ]),
  );
  assert.deepEqual(storePairCounts, {
    startupMetadata: 2,
    stateMetadata: 8,
    inputMetadata: 1,
  });
  const receiptWithoutProjectionHashes = {
    schema: PRIVATE_LOOKUP_EVIDENCE_SCHEMA,
    methods: [...PRIVATE_LOOKUP_METHODS],
    authorizedPairs: EXPECTED_PRIVATE_STORE_LOOKUPS.map((entry) => ({
      ...entry,
    })),
    positiveControlIds: [...positiveControlIds],
    observedOperations,
    counts: {
      authorizedPairs: EXPECTED_PRIVATE_STORE_LOOKUPS.length,
      methods: PRIVATE_LOOKUP_METHODS.length,
      expectedOperations:
        EXPECTED_PRIVATE_STORE_LOOKUPS.length * PRIVATE_LOOKUP_METHODS.length,
      observedOperations: observedOperations.length,
    },
  };
  assert.equal(
    semanticSha256(PRIVATE_LOOKUP_EVIDENCE_SCHEMA),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.schemaSha256,
  );
  assert.equal(
    semanticSha256(PRIVATE_LOOKUP_METHODS),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.methodsSha256,
  );
  assert.equal(
    semanticSha256(EXPECTED_PRIVATE_STORE_LOOKUPS),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.orderedAuthorizedPairProjectionSha256,
  );
  assert.equal(
    semanticSha256(observedOperations),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.orderedObservedOperationProjectionSha256,
  );
  assert.equal(
    semanticSha256(receiptWithoutProjectionHashes),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.receiptWithoutProjectionHashesSha256,
  );
  return recursivelyFreezeEvidence({
    ...receiptWithoutProjectionHashes,
    orderedAuthorizedPairProjectionSha256:
      EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.orderedAuthorizedPairProjectionSha256,
    orderedObservedOperationProjectionSha256:
      EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.orderedObservedOperationProjectionSha256,
  });
}

function runStaticNegativeControls() {
  const imports = [
    () => sourceWithImportMutation(() => 'import value from "node:fs";'),
    () =>
      sourceWithImportMutation(
        () => 'import * as exact from "./containment-exact-v2.mjs";',
      ),
    () =>
      sourceWithImportMutation(() => 'import "./containment-exact-v2.mjs";'),
    () =>
      sourceWithImportMutation((original) =>
        original.replace("boundedInteger", "boundedInteger as bounded"),
      ),
    () =>
      sourceWithImportMutation((original) =>
        original.replace("boundedInteger, ", ""),
      ),
    () =>
      sourceWithImportMutation((original) =>
        original.replace("boundedInteger", "boundedInteger, extraHelper"),
      ),
    () =>
      sourceWithImportMutation((original) =>
        original.replace(
          "./containment-exact-v2.mjs",
          "./containment-exact-v1.mjs",
        ),
      ),
    () =>
      `${sourceSkeleton()}\nimport { sha256 } from "./containment-exact-v2.mjs";`,
    () =>
      `${sourceSkeleton()}\nconst late = import("./containment-exact-v2.mjs");`,
    () => `${sourceSkeleton()}\nconst metadata = import.meta;`,
  ];
  const exports = [
    () => `${sourceSkeleton()}\nexport default null;`,
    () => `${sourceSkeleton()}\nexport { sha256 };`,
    () => `${sourceSkeleton()}\nexport * from "./containment-exact-v2.mjs";`,
    () =>
      sourceSkeleton().replace(
        "export function createCandidateContainmentGuardianStartupV1(",
        "export const createCandidateContainmentGuardianStartupV1 = function(",
      ),
    () =>
      sourceSkeleton().replace(
        "startupReportBytes, epochBytes, epochEofObserved",
        "startupReportBytes, epochBytes",
      ),
    () =>
      sourceSkeleton().replace(
        "startupReportBytes, epochBytes, epochEofObserved",
        "startupReportBytes, epochBytes, observedEof",
      ),
    () =>
      sourceSkeleton().replace(
        "startupReportBytes, epochBytes, epochEofObserved",
        "startupReportBytes, epochBytes, epochEofObserved = true",
      ),
  ];
  const authorityAndGadgets = [
    "const escaped = pr\\u006fcess;",
    "const direct = process;",
    "function hidden() { const local = null; } const leaked = local;",
    "{ const sibling = null; } const leaked = sibling;",
    "function process() { return null; }",
    "const gadget = value.constructor;",
    'const gadget = value["constructor"];',
    'const gadget = value["con" + "structor"];',
    "const gadget = Reflect.construct;",
    "const delayed = setTimeout;",
    "const callback = new Function();",
    "const proxied = new Proxy();",
    "const weak = new WeakSet();",
    "const metadata = globalThis.process;",
    "const worker = new Worker();",
    "const dynamic = value[key];",
    "const spread = [...value];",
    "const arrow = () => null;",
    "const expression = function named() { return null; };",
    "class Hidden {}",
    "async function hidden() { return null; }",
    'const path = "node:" + "fs";',
    'const testPath = "candidate-containment-guardian-control-v1.test.mjs";',
    'const hostPath = "/proc/self/fd";',
    "const regularExpression = /^[a-z]+$/u;",
    "const template = `static text`;",
  ];
  const stores = [
    sourceSkeleton().replace("const startupMetadata", "let startupMetadata"),
    sourceSkeleton().replace("startupMetadata", "startupMetadataWrong"),
    sourceSkeleton().replace(
      "const stateMetadata = new WeakMap();",
      "const stateMetadata = new WeakMap();\nconst extraMetadata = new WeakMap();",
    ),
    `${sourceSkeleton()}\nstartupMetadata = stateMetadata;`,
    sourceSkeleton("const permissionStore = new Set();"),
    sourceSkeleton("const mutableArray = [];"),
    sourceSkeleton("const mutableRecord = {};"),
    sourceSkeleton("let mutableSession = null;"),
    sourceSkeleton("const frozenSet = deepFreeze(new Set());"),
    sourceSkeleton("function populate() { return null; } populate();"),
  ];
  const namedStaticGateEscapes = Object.freeze([
    Object.freeze({
      name: "nested private-store set call",
      source: sourceSkeleton(
        "const stable = deepFreeze([startupMetadata.set(null, null)]);",
      ),
    }),
    Object.freeze({
      name: "nested member assignment",
      source: sourceSkeleton(
        "const permissionStore = deepFreeze([]);\nconst stable = deepFreeze([permissionStore.set = null]);",
      ),
    }),
    Object.freeze({
      name: "bare-block private-store declarations",
      source: sourceSkeleton().replace(
        "const startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();",
        "{\nconst startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();\n}",
      ),
    }),
    Object.freeze({
      name: "nested compound member assignment",
      source: sourceSkeleton(
        "const permissionStore = deepFreeze([]);\nconst stable = deepFreeze([permissionStore.set += 1]);",
      ),
    }),
    Object.freeze({
      name: "private-store frozen alias",
      source: sourceSkeleton("const stable = deepFreeze([startupMetadata]);"),
    }),
    Object.freeze({
      name: "imported-function frozen alias",
      source: sourceSkeleton("const stable = deepFreeze([sha256]);"),
    }),
    Object.freeze({
      name: "deepFreeze retains mutable canonical bytes",
      source: sourceSkeleton(
        'const stable = deepFreeze(canonicalJsonBytes("safe"));',
      ),
      expected: /non-freezable deepFreeze input/u,
    }),
    Object.freeze({
      name: "fixture key is not a normative string-value exception",
      source: sourceSkeleton(`
function deriveAuthorityKey() {
  return "processAuthority".slice(0, 7);
}`),
      expected:
        /ESTree capability-looking literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "numeric member-chain authority gadget",
      source: sourceSkeleton(
        'const stable = deepFreeze([0..constructor.constructor("return pro" + ("cess"))()]);',
      ),
      expected: /numeric literal outside bounded decimal-integer subset/u,
    }),
    Object.freeze({
      name: "parenthesized top-level invocation",
      source: sourceSkeleton(
        "function moduleEffect() { return null; }\n(moduleEffect)();",
      ),
      expected: /module statement \(/u,
    }),
    Object.freeze({
      name: "parenthesized private-store method invocation",
      source: sourceSkeleton("(startupMetadata.set)(nullRecord([]), null);"),
      expected: /module statement \(/u,
    }),
    Object.freeze({
      name: "non-normative substring Reflect authority gadget",
      source: sourceSkeleton(`
function reflectedAuthority(startupReportBytes) {
  const mirror = Reflect;
  const key = "xconstructor".slice(1);
  const first = mirror.get(startupReportBytes, key);
  const second = mirror.get(first, key);
  const source = "xreturn process".slice(1);
  return second(source)();
}`),
      expected: /forbidden string fragment constructor/u,
    }),
    Object.freeze({
      name: "U+2028 line-comment import smuggling",
      source: sourceSkeleton(
        '// audit comment\u2028import fs from "node:fs"; fs.readFileSync("/proc/self/status");',
      ),
      expected: /forbidden path prefix node:/u,
    }),
    Object.freeze({
      name: "U+2029 line-comment import smuggling",
      source: sourceSkeleton(
        '// audit comment\u2029import fs from "node:fs"; fs.readFileSync("/proc/self/status");',
      ),
      expected: /forbidden path prefix node:/u,
    }),
    Object.freeze({
      name: "U+2028 string-continuation authority spelling",
      source: sourceSkeleton(
        `const forbidden = "pro\\${String.fromCodePoint(0x2028)}cess";`,
      ),
      expected: /forbidden string fragment process/u,
    }),
    Object.freeze({
      name: "U+2029 string-continuation authority spelling",
      source: sourceSkeleton(
        `const forbidden = "pro\\${String.fromCodePoint(0x2029)}cess";`,
      ),
      expected: /forbidden string fragment process/u,
    }),
    Object.freeze({
      name: "function-scoped imported helper alias",
      source: sourceSkeleton(
        "function aliasImported(value) { const helper = sha256; return null; }",
      ),
    }),
    Object.freeze({
      name: "laundered untrusted receiver",
      source: sourceSkeleton(
        "function launder(startupReportBytes) { const alias = startupReportBytes; return alias.length; }",
      ),
    }),
    Object.freeze({
      name: "parenthesized imported-helper call",
      source: sourceSkeleton(
        "function indirect(value) { return (sha256)(value); }",
      ),
    }),
    Object.freeze({
      name: "computed member on frozen local",
      source: sourceSkeleton(
        "function computed() { const values = deepFreeze([]); return values[0]; }",
      ),
    }),
    Object.freeze({
      name: "function-scoped member write",
      source: sourceSkeleton(
        "function mutateMember() { const value = deepFreeze({ length: 0 }); value.length = 1; return null; }",
      ),
    }),
    Object.freeze({
      name: "function-scoped binding write",
      source: sourceSkeleton(
        "function mutateBinding() { let value = null; value = deepFreeze([]); return value; }",
      ),
    }),
    Object.freeze({
      name: "normative literal outside normative role",
      source: sourceSkeleton(
        'function leakNormativeLiteral() { return "processAuthority"; }',
      ),
    }),
    Object.freeze({
      name: "normative record key outside requirements initializer",
      source: sourceSkeleton(
        "const unrelatedAuthority = deepFreeze({ processAuthority: false });",
      ),
    }),
    Object.freeze({
      name: "unknown provenance branch join",
      source: sourceSkeleton(
        "function joined(startupReportBytes) { const value = true ? deepFreeze([]) : startupReportBytes; return value.length; }",
      ),
    }),
    Object.freeze({
      name: "untrusted condition coercion",
      source: sourceSkeleton(
        "function coerce(startupReportBytes) { if (startupReportBytes) { return true; } return false; }",
      ),
    }),
    Object.freeze({
      name: "untrusted iteration",
      source: sourceSkeleton(
        "function iterate(startupReportBytes) { for (const value of startupReportBytes) { return value; } return null; }",
      ),
    }),
    Object.freeze({
      name: "raw untrusted return",
      source: sourceSkeleton(
        "function escape(startupReportBytes) { return startupReportBytes; }",
      ),
    }),
    Object.freeze({
      name: "private-store get embedded in returned frozen graph",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "verifyCandidateContainmentGuardianStatusFrameV1",
            "return deepFreeze([startupMetadata.get(startupProjection)]);",
          ],
        ]),
      ),
      expected: /deepFreeze argument provenance/u,
    }),
    Object.freeze({
      name: "private-store commit in non-owner",
      source: sourceSkeleton(
        "function wrongOwner() { const key = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); startupMetadata.set(key, metadata); return key; }",
      ),
    }),
    Object.freeze({
      name: "private-store commit under control flow",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); if (true) { const key = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); startupMetadata.set(key, metadata); } return result;",
          ],
        ]),
      ),
      expected: /private commit must be a direct function-body statement/u,
    }),
    Object.freeze({
      name: "function-scoped ambient alias",
      source: sourceSkeleton(
        "function aliasAmbient() { const ambient = Object; return null; }",
      ),
    }),
    Object.freeze({
      name: "function-scoped Reflect alias",
      source: sourceSkeleton(
        "function aliasReflect() { const reflect = Reflect; return null; }",
      ),
    }),
    Object.freeze({
      name: "function-scoped exported-function alias",
      source: sourceSkeleton(
        "function aliasExport() { const operation = reduceCandidateContainmentGuardianControlV1; return null; }",
      ),
    }),
    Object.freeze({
      name: "direct internal exported-operation call",
      source: sourceSkeleton(
        "function callExportedOperation() { const state = deepFreeze(nullRecord([])); const input = deepFreeze(nullRecord([])); return reduceCandidateContainmentGuardianControlV1(state, input); }",
      ),
    }),
    Object.freeze({
      name: "function-scoped exported-value alias",
      source: sourceSkeleton(
        "function aliasExportValue() { const value = CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS; return null; }",
      ),
    }),
    Object.freeze({
      name: "function-scoped private-store alias",
      source: sourceSkeleton(
        "function aliasStore() { const store = inputMetadata; return null; }",
      ),
    }),
    Object.freeze({
      name: "nested function declaration",
      source: sourceSkeleton(
        "function outer() { function nested() { return null; } return null; }",
      ),
    }),
    Object.freeze({
      name: "recursive module-function call",
      source: sourceSkeleton("function recursive() { return recursive(); }"),
    }),
    Object.freeze({
      name: "requirements initializer semantic drift",
      source: sourceSkeleton().replace(
        '"oxigraph.candidate-containment-guardian-control-requirements/v1"',
        '"oxigraph.candidate-containment-guardian-control-requirements/v2"',
      ),
    }),
    Object.freeze({
      name: "requirements digest initializer drift",
      source: sourceSkeleton().replace(
        `export const CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256 = ${JSON.stringify(EXPECTED_REQUIREMENTS_SHA256)};`,
        `export const CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256 = ${JSON.stringify("1".repeat(64))};`,
      ),
    }),
    Object.freeze({
      name: "private-store commit followed by fallible work",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); startupMetadata.set(result, metadata); sha256(canonicalJsonBytes(null)); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "private-store owner has early return",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); if (true) { return result; } startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "conditional fallible work before private-store commit",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); if (true) { sha256(canonicalJsonBytes(null)); } startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "conditional-expression skipped arm before private-store commit",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); const branch = false ? sha256(canonicalJsonBytes(null)) : null; startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1/u,
    }),
    Object.freeze({
      name: "logical-expression skipped AND RHS before private-store commit",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); const branch = false && sha256(canonicalJsonBytes(null)); startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1/u,
    }),
    Object.freeze({
      name: "logical-expression skipped OR RHS before private-store commit",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); const branch = true || sha256(canonicalJsonBytes(null)); startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1/u,
    }),
    Object.freeze({
      name: "logical-expression skipped nullish RHS before private-store commit",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); const branch = true ?? sha256(canonicalJsonBytes(null)); startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /fallible operation does not dominate commit createCandidateContainmentGuardianStartupV1/u,
    }),
    Object.freeze({
      name: "private-store commit returns metadata",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); startupMetadata.set(result, metadata); return metadata;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "private-store commit aliases result and metadata",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = result; startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "private-store result and metadata share nested origin",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const seed = deepFreeze({ bytes: nullRecord([]) }); const result = deepFreeze({ bytes: seed.bytes }); const metadata = deepFreeze({ bytes: seed.bytes }); startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "second private-store commit",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); startupMetadata.set(result, metadata); startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "private-store commit uses wrong owning store",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); inputMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "parenthesized owning private-store callee",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); (startupMetadata.set)(result, metadata); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "inline private-store commit arguments",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); startupMetadata.set(result, deepFreeze(nullRecord([]))); return result;",
          ],
        ]),
      ),
    }),
    Object.freeze({
      name: "module-scoped private-store metadata argument",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const result = deepFreeze(nullRecord([])); startupMetadata.set(result, moduleMetadata); return result;",
          ],
        ]),
      ).replace(
        "const stateMetadata = new WeakMap();",
        "const stateMetadata = new WeakMap();\nconst moduleMetadata = deepFreeze(nullRecord([]));",
      ),
    }),
    Object.freeze({
      name: "mutable array push call",
      source: sourceSkeleton(
        "function pushValue() { const values = []; values.push(null); return null; }",
      ),
    }),
    Object.freeze({
      name: "mutable set add call",
      source: sourceSkeleton(
        "function addValue() { const values = new Set(); values.add(null); return null; }",
      ),
    }),
    Object.freeze({
      name: "shallow ambient freeze used as deep freeze",
      source: sourceSkeleton(
        "function shallowFreeze() { return Object.freeze([{}]); }",
      ),
    }),
    Object.freeze({
      name: "untrusted value retained by frozen graph",
      source: sourceSkeleton(
        "function freezeRaw(startupReportBytes) { return deepFreeze([startupReportBytes]); }",
      ),
    }),
    Object.freeze({
      name: "ambient coercion of untrusted value",
      source: sourceSkeleton(
        "function stringifyRaw(startupReportBytes) { return String(startupReportBytes); }",
      ),
    }),
    Object.freeze({
      name: "untrusted argument passed to local function",
      source: sourceSkeleton(
        "function localSink() { return null; } function routeRaw(startupReportBytes) { return localSink(startupReportBytes); }",
      ),
    }),
    Object.freeze({
      name: "nonthrowing imported failure callback",
      source: sourceSkeleton(
        'function noFail() { return null; } function normalizeWithNoFail(value) { return exactBoolean(value, true, "value", noFail); }',
      ),
      expected: /failure callback may return noFail/u,
    }),
    Object.freeze({
      name: "recursive imported failure callback",
      source: sourceSkeleton(
        'function recursiveFailure(value) { return exactBoolean(value, true, "value", recursiveFailure); }',
      ),
      expected: /recursive call graph recursiveFailure/u,
    }),
    Object.freeze({
      name: "private lookup from unowned local helper",
      source: sourceSkeleton(
        "function probeStartupBrand(key) { return startupMetadata.has(key); }",
      ),
      expected:
        /ESTree private lookup policy probeStartupBrand:startupMetadata\.has/u,
    }),
    Object.freeze({
      name: "startup commit ownership does not grant private lookup",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "const observed = startupMetadata.get(startupReportBytes); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /ESTree private lookup policy createCandidateContainmentGuardianStartupV1:startupMetadata\.get/u,
    }),
    Object.freeze({
      name: "initializer private lookup uses wrong store",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "initializeCandidateContainmentGuardianControlV1",
            "const observed = inputMetadata.get(startupProjection); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /ESTree private lookup policy initializeCandidateContainmentGuardianControlV1:inputMetadata\.get/u,
    }),
    Object.freeze({
      name: "status verifier private lookup uses wrong store",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "verifyCandidateContainmentGuardianStatusFrameV1",
            "const observed = stateMetadata.get(startupProjection); return null;",
          ],
        ]),
      ),
      expected:
        /ESTree private lookup policy verifyCandidateContainmentGuardianStatusFrameV1:stateMetadata\.get/u,
    }),
    Object.freeze({
      name: "input commit ownership does not grant private lookup",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianAdmissionInputV1",
            "const observed = inputMetadata.get(currentState); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); inputMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /ESTree private lookup policy createCandidateContainmentGuardianAdmissionInputV1:inputMetadata\.get/u,
    }),
    Object.freeze({
      name: "private lookup rejects function-local key",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "initializeCandidateContainmentGuardianControlV1",
            "const forged = deepFreeze(nullRecord([])); const observed = startupMetadata.get(forged); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /ESTree private lookup key initializeCandidateContainmentGuardianControlV1:startupMetadata\.get:forged/u,
    }),
    Object.freeze({
      name: "private lookup rejects wrong reducer parameter",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "reduceCandidateContainmentGuardianControlV1",
            "const observed = stateMetadata.get(brandedInput); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /ESTree private lookup key reduceCandidateContainmentGuardianControlV1:stateMetadata\.get:brandedInput/u,
    }),
    Object.freeze({
      name: "private lookup rejects wrong input-constructor parameter",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianAdmissionInputV1",
            "const observed = stateMetadata.has(admissionFrameBytes); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); inputMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /ESTree private lookup key createCandidateContainmentGuardianAdmissionInputV1:stateMetadata\.has:admissionFrameBytes/u,
    }),
    Object.freeze({
      name: "private lookup value returned",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "verifyCandidateContainmentGuardianStatusFrameV1",
            "return startupMetadata.get(startupProjection);",
          ],
        ]),
      ),
      expected: /raw or unknown value returned from function/u,
    }),
    Object.freeze({
      name: "private lookup value inspected",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "verifyCandidateContainmentGuardianStatusFrameV1",
            "const observed = startupMetadata.get(startupProjection); return observed.bytes;",
          ],
        ]),
      ),
      expected: /raw or unknown value used as receiver for \.bytes/u,
    }),
    Object.freeze({
      name: "private lookup value joined conditionally",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "verifyCandidateContainmentGuardianStatusFrameV1",
            "const observed = startupMetadata.get(startupProjection); const selected = true ? observed : null; return null;",
          ],
        ]),
      ),
      expected: /unknown provenance join conditional expression/u,
    }),
    Object.freeze({
      name: "private lookup value used as logical operand",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "verifyCandidateContainmentGuardianStatusFrameV1",
            "const observed = startupMetadata.get(startupProjection); const selected = observed ?? deepFreeze(nullRecord([])); return null;",
          ],
        ]),
      ),
      expected: /raw or unknown value logical \?\?/u,
    }),
    Object.freeze({
      name: "parenthesized ambient coercer call",
      source: sourceSkeleton(
        "function parenthesizedAmbientCall() { return (String)(null); }",
      ),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "parenthesized local-function call",
      source: sourceSkeleton(
        "function directTarget() { return null; }\nfunction parenthesizedLocalCall() { return (directTarget)(); }",
      ),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "parenthesized exported-operation call",
      source: sourceSkeleton(
        "function parenthesizedExportCall() { return (verifyCandidateContainmentGuardianStatusFrameV1)(null, null); }",
      ),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "parenthesized authorized private-lookup call",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "verifyCandidateContainmentGuardianStatusFrameV1",
            "const observed = (startupMetadata.get)(startupProjection); return null;",
          ],
        ]),
      ),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "parenthesized safe-member call",
      source: sourceSkeleton(
        "function parenthesizedMemberCall() { const values = deepFreeze([]); return (values.includes)(null); }",
      ),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "call-result callee",
      source: sourceSkeleton(
        "function returnNull() { return null; }\nfunction callResultAsCallee() { return returnNull()(); }",
      ),
      expected: /static gate: ESTree indirect callee CallExpression/u,
    }),
    Object.freeze({
      name: "conditional-expression callee",
      source: sourceSkeleton(
        "function conditionalLeft() { return null; }\nfunction conditionalRight() { return null; }\nfunction conditionalCallee() { return (true ? conditionalLeft : conditionalRight)(); }",
      ),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "logical-expression callee",
      source: sourceSkeleton(
        "function logicalTarget() { return null; }\nfunction logicalCallee() { return (logicalTarget && logicalTarget)(); }",
      ),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "sequence-expression callee",
      source: sourceSkeleton(
        "function sequenceTarget() { return null; }\nfunction sequenceCallee() { return (null, sequenceTarget)(); }",
      ),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "member-call result used as callee",
      source: sourceSkeleton(
        "function memberResultCallee() { const values = deepFreeze([null]); return values.at(0)(); }",
      ),
      expected: /static gate: ESTree indirect callee CallExpression/u,
    }),
    Object.freeze({
      name: "unary-expression callee",
      source: sourceSkeleton("function unaryCallee() { return (!false)(); }"),
      expected: /static gate: ESTree parenthesized or indirect call/u,
    }),
    Object.freeze({
      name: "computed public-input index",
      source: sourceSkeleton(
        "function computedPublicInput(startupReportBytes) { return startupReportBytes[0]; }",
      ),
      expected: /static gate: ESTree computed member access/u,
    }),
    Object.freeze({
      name: "computed private-store index",
      source: sourceSkeleton(
        "function computedPrivateStore() { return startupMetadata[0]; }",
      ),
      expected: /static gate: ESTree computed member access/u,
    }),
    Object.freeze({
      name: "computed imported-helper index",
      source: sourceSkeleton(
        "function computedImportedHelper() { return sha256[0]; }",
      ),
      expected: /static gate: ESTree computed member access/u,
    }),
    Object.freeze({
      name: "computed ambient-intrinsic index",
      source: sourceSkeleton(
        "function computedAmbientIntrinsic() { return Object[0]; }",
      ),
      expected: /static gate: ESTree computed member access/u,
    }),
    Object.freeze({
      name: "computed exported-operation index",
      source: sourceSkeleton(
        "function computedExportedOperation() { return verifyCandidateContainmentGuardianStatusFrameV1[0]; }",
      ),
      expected: /static gate: ESTree computed member access/u,
    }),
    Object.freeze({
      name: "computed member callee",
      source: sourceSkeleton(
        "function computedMemberCallee() { const values = deepFreeze([]); return values[0](); }",
      ),
      expected: /static gate: ESTree computed member access/u,
    }),
    Object.freeze({
      name: "direct Reflect call",
      source: sourceSkeleton(
        "function directReflectCall() { return Reflect(); }",
      ),
      expected: /static gate: ESTree Reflect use is outside the closed subset/u,
    }),
    Object.freeze({
      name: "Reflect array element",
      source: sourceSkeleton(
        "function reflectArrayElement() { return deepFreeze([Reflect]); }",
      ),
      expected: /static gate: ESTree Reflect use is outside the closed subset/u,
    }),
    Object.freeze({
      name: "Reflect unary operand",
      source: sourceSkeleton(
        "function reflectUnaryOperand() { return typeof Reflect; }",
      ),
      expected: /static gate: ESTree Reflect use is outside the closed subset/u,
    }),
    Object.freeze({
      name: "Reflect argument",
      source: sourceSkeleton(
        "function reflectArgument() { return Boolean(Reflect); }",
      ),
      expected: /static gate: ESTree Reflect use is outside the closed subset/u,
    }),
    Object.freeze({
      name: "Reflect conditional branch",
      source: sourceSkeleton(
        "function reflectConditionalBranch() { const value = true ? Reflect : null; return null; }",
      ),
      expected: /static gate: ESTree Reflect use is outside the closed subset/u,
    }),
    Object.freeze({
      name: "local alias binding assignment",
      source: sourceSkeleton(
        "function writeLocalAlias() { const alias = deepFreeze([]); alias = deepFreeze([]); return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "local alias member compound assignment",
      source: sourceSkeleton(
        "function writeLocalAliasMember() { const alias = deepFreeze({ length: 0 }); alias.length += 1; return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "ambient intrinsic binding assignment",
      source: sourceSkeleton(
        "function writeAmbientBinding() { Object = null; return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "ambient intrinsic member assignment",
      source: sourceSkeleton(
        "function writeAmbientMember() { Object.length = 0; return null; }",
      ),
      expected: /static gate: ambient member Object\.length/u,
    }),
    Object.freeze({
      name: "imported helper binding compound assignment",
      source: sourceSkeleton(
        "function writeImportedBinding() { sha256 += null; return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "imported helper member assignment",
      source: sourceSkeleton(
        "function writeImportedMember() { sha256.length = 0; return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "exported operation binding assignment",
      source: sourceSkeleton(
        "function writeExportedOperation() { verifyCandidateContainmentGuardianStatusFrameV1 = null; return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "exported operation member compound assignment",
      source: sourceSkeleton(
        "function writeExportedOperationMember() { verifyCandidateContainmentGuardianStatusFrameV1.length += 1; return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "exported value binding assignment",
      source: sourceSkeleton(
        "function writeExportedValue() { CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS = null; return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "exported value member assignment",
      source: sourceSkeleton(
        "function writeExportedValueMember() { CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS.length = 0; return null; }",
      ),
      expected: /static gate: ESTree binding or member assignment/u,
    }),
    Object.freeze({
      name: "untrusted value passed to sha256",
      source: sourceSkeleton(
        "function hashUntrusted(startupReportBytes) { return sha256(startupReportBytes); }",
      ),
      expected: /raw or unknown value passed to sha256/u,
    }),
    Object.freeze({
      name: "untrusted value passed to canonical JSON bytes",
      source: sourceSkeleton(
        "function encodeUntrusted(startupReportBytes) { return canonicalJsonBytes(startupReportBytes); }",
      ),
      expected: /raw or unknown value passed to canonicalJsonBytes/u,
    }),
    Object.freeze({
      name: "untrusted value passed to canonical JSON line",
      source: sourceSkeleton(
        "function lineEncodeUntrusted(startupReportBytes) { return canonicalJsonLine(startupReportBytes); }",
      ),
      expected: /raw or unknown value passed to canonicalJsonLine/u,
    }),
    Object.freeze({
      name: "untrusted ambient Boolean coercion",
      source: sourceSkeleton(
        "function booleanUntrusted(startupReportBytes) { return Boolean(startupReportBytes); }",
      ),
      expected: /raw or unknown value ambient coercion Boolean/u,
    }),
    Object.freeze({
      name: "untrusted Error constructor argument",
      source: sourceSkeleton(
        "function errorUntrusted(startupReportBytes) { throw new Error(startupReportBytes); }",
      ),
      expected: /raw or unknown value constructor Error/u,
    }),
    Object.freeze({
      name: "untrusted Set constructor argument",
      source: sourceSkeleton(
        "function setUntrusted(startupReportBytes) { const values = new Set(startupReportBytes); return null; }",
      ),
      expected: /raw or unknown value constructor Set/u,
    }),
    Object.freeze({
      name: "untrusted value passed through local sink",
      source: sourceSkeleton(
        "function localBoundary(value) { return null; } function callLocalBoundary(startupReportBytes) { return localBoundary(startupReportBytes); }",
      ),
      expected: /raw or unknown value passed to local function localBoundary/u,
    }),
    Object.freeze({
      name: "untrusted argument passed to includes",
      source: sourceSkeleton(
        "function includesUntrusted(startupReportBytes) { const values = deepFreeze([]); return values.includes(startupReportBytes); }",
      ),
      expected: /raw or unknown value passed to member includes/u,
    }),
    Object.freeze({
      name: "untrusted argument passed to at",
      source: sourceSkeleton(
        "function atUntrusted(startupReportBytes) { const values = deepFreeze([]); return values.at(startupReportBytes); }",
      ),
      expected: /raw or unknown value passed to member at/u,
    }),
    Object.freeze({
      name: "untrusted alias used as bytes receiver",
      source: sourceSkeleton(
        "function inspectUntrustedBytes(startupReportBytes) { const alias = startupReportBytes; return alias.bytes; }",
      ),
      expected: /raw or unknown value used as receiver for \.bytes/u,
    }),
    Object.freeze({
      name: "untrusted unary coercion",
      source: sourceSkeleton(
        "function negateUntrusted(startupReportBytes) { return !startupReportBytes; }",
      ),
      expected: /raw or unknown value unary coercion !/u,
    }),
    Object.freeze({
      name: "untrusted binary operand",
      source: sourceSkeleton(
        "function compareUntrusted(startupReportBytes) { return startupReportBytes === null; }",
      ),
      expected: /raw or unknown value binary ===/u,
    }),
    Object.freeze({
      name: "untrusted logical operand",
      source: sourceSkeleton(
        "function logicalUntrusted(startupReportBytes) { return startupReportBytes && null; }",
      ),
      expected: /raw or unknown value logical &&/u,
    }),
    Object.freeze({
      name: "untrusted conditional test",
      source: sourceSkeleton(
        "function conditionalUntrusted(startupReportBytes) { return startupReportBytes ? null : null; }",
      ),
      expected: /raw or unknown value conditional test/u,
    }),
    Object.freeze({
      name: "untrusted value thrown directly",
      source: sourceSkeleton(
        "function throwUntrusted(startupReportBytes) { throw startupReportBytes; }",
      ),
      expected: /raw or unknown value thrown/u,
    }),
    Object.freeze({
      name: "double-aliased untrusted return",
      source: sourceSkeleton(
        "function returnAliasedUntrusted(startupReportBytes) { const first = startupReportBytes; const second = first; return second; }",
      ),
      expected: /raw or unknown value returned from function/u,
    }),
    Object.freeze({
      name: "untrusted array graph returned",
      source: sourceSkeleton(
        "function returnUntrustedArray(startupReportBytes) { const graph = [startupReportBytes]; return graph; }",
      ),
      expected: /raw or unknown value returned from function/u,
    }),
    Object.freeze({
      name: "untrusted object graph returned",
      source: sourceSkeleton(
        "function returnUntrustedObject(startupReportBytes) { const graph = { bytes: startupReportBytes }; return graph; }",
      ),
      expected: /raw or unknown value returned from function/u,
    }),
    Object.freeze({
      name: "bounded buffer copy returned without freezing",
      source: sourceSkeleton(
        'function failBufferCopy() { throw new Error("CONTROL_SHAPE"); } function returnCopiedBytes(startupReportBytes) { return copyBoundedBuffer(startupReportBytes, 0, 1, failBufferCopy); }',
      ),
      expected: /raw or unknown value returned from function/u,
    }),
    Object.freeze({
      name: "decoded base64 bytes returned without freezing",
      source: sourceSkeleton(
        'function failBase64Decode() { throw new Error("CONTROL_SHAPE"); } function returnDecodedBytes(startupReportBytes) { return decodeCanonicalBase64(startupReportBytes, 1, 1, failBase64Decode); }',
      ),
      expected: /raw or unknown value returned from function/u,
    }),
    Object.freeze({
      name: "sliced bounded buffer returned without freezing",
      source: sourceSkeleton(
        'function failBufferSlice() { throw new Error("CONTROL_SHAPE"); } function returnSlicedBytes(startupReportBytes) { return copyBoundedBuffer(startupReportBytes, 0, 1, failBufferSlice).slice(0); }',
      ),
      expected: /raw or unknown value returned from function/u,
    }),
    Object.freeze({
      name: "aliased private lookup value returned",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "verifyCandidateContainmentGuardianStatusFrameV1",
            "const observed = startupMetadata.get(startupProjection); const alias = observed; return alias;",
          ],
        ]),
      ),
      expected: /raw or unknown value returned from function/u,
    }),
    Object.freeze({
      name: "ambient String coercion constructs normative authority key",
      source: sourceSkeleton(
        'function constructAuthorityKey() { const key = String("pro") + "cessAuthority"; return null; }',
      ),
      expected:
        /capability-looking constructed literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "nested fragments construct normative authority key",
      source: sourceSkeleton(
        'function constructNestedAuthorityKey() { const key = "pr" + ("oc" + "essAuthority"); return null; }',
      ),
      expected:
        /capability-looking constructed literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "local aliases construct normative authority key",
      source: sourceSkeleton(
        'function constructAliasedAuthorityKey() { const prefix = "pro"; const suffix = "cessAuthority"; const key = prefix + suffix; return null; }',
      ),
      expected:
        /capability-looking constructed literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "module aliases construct normative authority key",
      source: sourceSkeleton(
        'const authorityPrefix = "pro"; const authoritySuffix = "cessAuthority"; function constructModuleAuthorityKey() { const key = authorityPrefix + authoritySuffix; return null; }',
      ),
      expected:
        /capability-looking constructed literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "conditional prefix constructs normative authority key",
      source: sourceSkeleton(
        'function constructConditionalPrefixAuthorityKey() { const prefix = true ? "pro" : "pr"; const key = prefix + "cessAuthority"; return null; }',
      ),
      expected:
        /capability-looking constructed literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "conditional suffix constructs normative authority key",
      source: sourceSkeleton(
        'function constructConditionalSuffixAuthorityKey() { const suffix = true ? "cessAuthority" : "ocessAuthority"; const key = "pro" + suffix; return null; }',
      ),
      expected:
        /capability-looking constructed literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "logical prefix constructs normative authority key",
      source: sourceSkeleton(
        'function constructLogicalAuthorityKey() { const prefix = true && "pro"; const key = prefix + "cessAuthority"; return null; }',
      ),
      expected:
        /capability-looking constructed literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "local return constructs normative authority key",
      source: sourceSkeleton(
        'function authorityPrefix() { return "pro"; } function constructReturnedAuthorityKey() { const key = authorityPrefix() + "cessAuthority"; return null; }',
      ),
      expected:
        /capability-looking constructed literal outside normative role processAuthority/u,
    }),
    Object.freeze({
      name: "factored normative authority object returned",
      source: sourceWithFactoredNormativeAuthority(
        "function returnNormativeAuthority() { return normativeAuthority; }",
      ),
      expected:
        /capability-looking normative literal returned from function processAuthority/u,
    }),
    Object.freeze({
      name: "factored normative authority object passed to sink",
      source: sourceWithFactoredNormativeAuthority(
        "function hashNormativeAuthority() { return sha256(normativeAuthority); }",
      ),
      expected:
        /capability-looking normative literal passed to sha256 processAuthority/u,
    }),
    Object.freeze({
      name: "conditional-expression joins distinct frozen origins",
      source: sourceSkeleton(
        "function joinConditionalOrigins() { return true ? deepFreeze([]) : deepFreeze([null]); }",
      ),
      expected: /unknown provenance join conditional expression/u,
    }),
    Object.freeze({
      name: "logical AND joins distinct frozen origins",
      source: sourceSkeleton(
        "function joinLogicalAndOrigins() { return deepFreeze([]) && deepFreeze([null]); }",
      ),
      expected: /unknown provenance join logical &&/u,
    }),
    Object.freeze({
      name: "logical OR joins distinct frozen origins",
      source: sourceSkeleton(
        "function joinLogicalOrOrigins() { return deepFreeze([]) || deepFreeze([null]); }",
      ),
      expected: /unknown provenance join logical OR/u,
    }),
    Object.freeze({
      name: "logical nullish joins distinct frozen origins",
      source: sourceSkeleton(
        "function joinLogicalNullishOrigins() { return deepFreeze([]) ?? deepFreeze([null]); }",
      ),
      expected: /unknown provenance join logical \?\?/u,
    }),
    Object.freeze({
      name: "if branches join distinct return origins",
      source: sourceSkeleton(
        "function joinBranchReturns() { if (true) { return deepFreeze([]); } else { return deepFreeze([null]); } }",
      ),
      expected: /unknown provenance join returns of joinBranchReturns/u,
    }),
    Object.freeze({
      name: "nested conditional joins distinct return origins",
      source: sourceSkeleton(
        "function joinNestedReturns() { if (true) { if (false) { return deepFreeze([]); } return deepFreeze([null]); } return deepFreeze([false]); }",
      ),
      expected: /unknown provenance join returns of joinNestedReturns/u,
    }),
    Object.freeze({
      name: "for-of and fallthrough join distinct return origins",
      source: sourceSkeleton(
        "function joinLoopReturns() { const values = deepFreeze([null]); for (const value of values) { return deepFreeze([]); } return deepFreeze([null]); }",
      ),
      expected: /unknown provenance join returns of joinLoopReturns/u,
    }),
    Object.freeze({
      name: "conditional return leaves successful fallthrough",
      source: sourceSkeleton(
        "function conditionalFallthrough() { if (true) { return null; } }",
      ),
      expected:
        /function may complete without explicit return conditionalFallthrough/u,
    }),
    Object.freeze({
      name: "for-of return leaves zero-iteration fallthrough",
      source: sourceSkeleton(
        "function loopFallthrough() { const values = deepFreeze([null]); for (const value of values) { return null; } }",
      ),
      expected:
        /function may complete without explicit return loopFallthrough/u,
    }),
    Object.freeze({
      name: "empty local function falls through",
      source: sourceSkeleton("function emptyFallthrough() {}"),
      expected:
        /function may complete without explicit return emptyFallthrough/u,
    }),
    Object.freeze({
      name: "conditional throw leaves successful fallthrough",
      source: sourceSkeleton(
        "function throwFallthrough() { if (true) { throw null; } }",
      ),
      expected:
        /function may complete without explicit return throwFallthrough/u,
    }),
    Object.freeze({
      name: "called local function may fall through",
      source: sourceSkeleton(
        "function callFallthrough() { return maybeFallthrough(); } function maybeFallthrough() { if (true) { return null; } }",
      ),
      expected:
        /function may complete without explicit return maybeFallthrough/u,
    }),
    Object.freeze({
      name: "failure callback may fall through",
      source: sourceSkeleton(
        'function normalizeWithFallthrough(value) { return exactBoolean(value, true, "value", fallthroughFailure); } function fallthroughFailure() { if (true) { throw new Error("CONTROL_SHAPE"); } }',
      ),
      expected:
        /function may complete without explicit return fallthroughFailure/u,
    }),
    Object.freeze({
      name: "private-store owner commit return is unreachable",
      source: sourceSkeleton(
        "",
        new Map([
          [
            "createCandidateContainmentGuardianStartupV1",
            "throw null; const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); startupMetadata.set(result, metadata); return result;",
          ],
        ]),
      ),
      expected:
        /private commit return unreachable createCandidateContainmentGuardianStartupV1/u,
    }),
    Object.freeze({
      name: "two-function call graph SCC",
      source: sourceSkeleton(
        "function sccAlpha() { return sccBeta(); } function sccBeta() { return sccAlpha(); }",
      ),
      expected: /recursive call graph sccAlpha -> sccBeta/u,
    }),
    Object.freeze({
      name: "three-function call graph SCC",
      source: sourceSkeleton(
        "function cycleAlpha() { return cycleBeta(); } function cycleBeta() { return cycleGamma(); } function cycleGamma() { return cycleAlpha(); }",
      ),
      expected: /recursive call graph cycleAlpha -> cycleBeta -> cycleGamma/u,
    }),
    Object.freeze({
      name: "conditional-edge call graph SCC",
      source: sourceSkeleton(
        "function branchAlpha() { return true ? branchBeta() : null; } function branchBeta() { return branchAlpha(); }",
      ),
      expected: /recursive call graph branchAlpha -> branchBeta/u,
    }),
    Object.freeze({
      name: "loop-edge call graph SCC",
      source: sourceSkeleton(
        "function loopAlpha() { const values = deepFreeze([null]); for (const value of values) { return loopBeta(); } return null; } function loopBeta() { return loopAlpha(); }",
      ),
      expected: /recursive call graph loopAlpha -> loopBeta/u,
    }),
    Object.freeze({
      name: "self-recursive failure callback SCC",
      source: sourceSkeleton(
        'function selfFailure() { return exactBoolean(null, true, "value", selfFailure); }',
      ),
      expected: /recursive call graph selfFailure/u,
    }),
    Object.freeze({
      name: "mixed callback and direct-call SCC",
      source: sourceSkeleton(
        'function mixedCallback() { return mixedCaller(); } function mixedCaller() { return exactBoolean(null, true, "value", mixedCallback); }',
      ),
      expected: /recursive call graph mixedCallback -> mixedCaller/u,
    }),
    Object.freeze({
      name: "two-callback-edge SCC",
      source: sourceSkeleton(
        'function callbackAlpha() { return exactBoolean(null, true, "value", callbackBeta); } function callbackBeta() { return exactBoolean(null, true, "value", callbackAlpha); }',
      ),
      expected: /recursive call graph callbackAlpha -> callbackBeta/u,
    }),
    Object.freeze({
      name: "unreachable self-recursive call",
      source: sourceSkeleton(
        "function unreachableSelf() { return null; unreachableSelf(); }",
      ),
      expected: /recursive call graph unreachableSelf/u,
    }),
    Object.freeze({
      name: "unreachable detached call graph SCC",
      source: sourceSkeleton(
        "function detachedAlpha() { return null; detachedBeta(); } function detachedBeta() { return null; detachedAlpha(); }",
      ),
      expected: /recursive call graph detachedAlpha -> detachedBeta/u,
    }),
    ...PRIVATE_COMMIT_DOMINANCE_CONTROLS,
    ...PRIVATE_COMMIT_TAIL_CONTROLS,
    ...PRIVATE_COMMIT_PROVENANCE_CONTROLS,
    ...PRIVATE_COMMIT_CALL_SHAPE_CONTROLS,
  ]);
  const sources = [
    ...imports.map((create) => create()),
    ...exports.map((create) => create()),
    ...authorityAndGadgets.map((body) => sourceSkeleton(body)),
    ...stores,
  ];
  assert.equal(sources.length, FOUNDATION_GENERATED_CONTROL_NAMES.length);
  let evaluationAttempts = 0;
  const generatedFoundationEvidence = [];
  for (const [index, source] of sources.entries()) {
    const stageAudit = {
      astNodeCount: null,
      astSha256: null,
      estreePolicyReached: false,
      expectedStage: "parse",
    };
    let rejection = null;
    assert.throws(() => {
      try {
        auditCandidateSource(source, stageAudit);
        evaluationAttempts += 1;
      } catch (error) {
        rejection = error;
        throw error;
      }
    });
    assert.notEqual(rejection, null);
    generatedFoundationEvidence.push(
      createStaticControlEvidenceEntry({
        id: staticControlId("FOUNDATION-N", index),
        name: FOUNDATION_GENERATED_CONTROL_NAMES[index],
        bucket: "foundation",
        source,
        stageAudit,
        rejection,
      }),
    );
  }
  const namedRejected = [];
  const namedStageAudit = [];
  const namedEvidence = [];
  for (const [
    index,
    { name, source, expected },
  ] of namedStaticGateEscapes.entries()) {
    const stageAudit = {
      astNodeCount: null,
      astSha256: null,
      estreePolicyReached: false,
      expectedStage: "parse",
    };
    let rejection = null;
    assert.throws(
      () => {
        try {
          auditCandidateSource(source, stageAudit);
          evaluationAttempts += 1;
        } catch (error) {
          rejection = error;
          throw error;
        }
      },
      expected,
      `static policy control: ${name}`,
    );
    assert.notEqual(rejection, null);
    namedRejected.push(name);
    namedStageAudit.push(
      Object.freeze({
        name,
        estreePolicyReached: stageAudit.estreePolicyReached,
      }),
    );
    const foundation = index < 16;
    namedEvidence.push(
      createStaticControlEvidenceEntry({
        id: foundation
          ? staticControlId(
              "FOUNDATION-N",
              generatedFoundationEvidence.length + index,
            )
          : staticControlId("SEM-N", index - 16),
        name,
        bucket: foundation
          ? "foundation"
          : SEMANTIC_BUCKET_BY_ORDINAL[index - 16],
        source,
        stageAudit,
        rejection,
      }),
    );
  }
  assert.equal(evaluationAttempts, 0);
  const requiredNormativeLiterals = Object.freeze([
    "Array",
    "Set",
    "String",
    "WeakMap",
    "currentOffset",
    "oxigraph.candidate-containment-guardian-control-requirements/v1",
    EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY,
  ]);
  for (const value of requiredNormativeLiterals) {
    assert.equal(PINNED_NORMATIVE_SOURCE_LITERALS.has(value), true, value);
  }
  const positiveSources = [
    sourceSkeleton(),
    sourceSkeleton(
      'function failValidation() { throw new Error("CONTROL_SHAPE"); } function localHelper(value) { const localValue = exactBoolean(value, true, "value", failValidation); return localValue; }',
    ),
    sourceSkeleton(
      "function select() { for (const value of deepFreeze([])) { if (value) { return false; } } return null; }",
    ),
    sourceSkeleton("const frozenLocalTable = deepFreeze([]);"),
    sourceSkeleton(
      'const localRequirements = deepFreeze(nullRecord([["schema", "safe"]]));\nconst localDigest = sha256(canonicalJsonBytes(localRequirements));',
    ),
    sourceSkeleton(
      "",
      new Map([
        [
          "initializeCandidateContainmentGuardianControlV1",
          "const present = startupMetadata.has(startupProjection); const observed = startupMetadata.get(startupProjection); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
        ],
      ]),
    ),
    sourceSkeleton(
      "",
      new Map([
        [
          "verifyCandidateContainmentGuardianStatusFrameV1",
          "const present = startupMetadata.has(startupProjection); const observed = startupMetadata.get(startupProjection); return null;",
        ],
      ]),
    ),
    sourceSkeleton(
      "",
      new Map([
        [
          "createCandidateContainmentGuardianAdmissionInputV1",
          "const present = stateMetadata.has(currentState); const observed = stateMetadata.get(currentState); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); inputMetadata.set(result, metadata); return result;",
        ],
      ]),
    ),
    sourceSkeleton(
      "",
      new Map(
        [
          "createCandidateContainmentGuardianCancelInputV1",
          "createCandidateContainmentGuardianRecoveryRequestInputV1",
          "createCandidateContainmentGuardianControllerClosedInputV1",
          "createCandidateContainmentGuardianDiagnosticFailureInputV1",
          "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
          "createCandidateContainmentGuardianStatusEofInputV1",
        ].map((functionName) => [
          functionName,
          "const present = stateMetadata.has(currentState); const observed = stateMetadata.get(currentState); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); inputMetadata.set(result, metadata); return result;",
        ]),
      ),
    ),
    sourceSkeleton(
      "",
      new Map([
        [
          "reduceCandidateContainmentGuardianControlV1",
          "const present = stateMetadata.has(currentState); const observed = stateMetadata.get(currentState); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
        ],
      ]),
    ),
    sourceSkeleton(
      "",
      new Map([
        [
          "reduceCandidateContainmentGuardianControlV1",
          "const present = inputMetadata.has(brandedInput); const observed = inputMetadata.get(brandedInput); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
        ],
      ]),
    ),
  ];
  assert.equal(positiveSources.length, POSITIVE_CONTROL_NAMES.length);
  const positiveAudits = [];
  const positiveEvidence = positiveSources.map((source, index) => {
    const stageAudit = {
      astNodeCount: null,
      astSha256: null,
      estreePolicyReached: false,
      expectedStage: "parse",
    };
    let audit = null;
    assert.doesNotThrow(() => {
      audit = auditCandidateSource(source, stageAudit);
    });
    assert.notEqual(audit, null);
    positiveAudits.push(
      Object.freeze({
        controlId: staticControlId("POS-P", index),
        privateLookups: audit.astPolicy.privateLookupOperations,
      }),
    );
    return createStaticControlEvidenceEntry({
      id: staticControlId("POS-P", index),
      name: POSITIVE_CONTROL_NAMES[index],
      bucket: "positive",
      source,
      stageAudit,
      rejection: null,
    });
  });
  assert.equal(namedStageAudit.length, 313);
  assert.equal(SEMANTIC_BUCKET_BY_ORDINAL.length, 297);
  const layeredStageAudit = namedStageAudit.slice(
    NAMED_FOUNDATION_CONTROL_COUNT,
  );
  assert.equal(layeredStageAudit.length, SEMANTIC_BUCKET_BY_ORDINAL.length);
  const preEstreePolicyRejections = layeredStageAudit.filter(
    ({ estreePolicyReached }) => !estreePolicyReached,
  );
  const layeredStaticNegativeEvidence = Object.freeze({
    totalDeltaSinceParserFoundation: layeredStageAudit.length,
    estreePolicyReachedCount:
      layeredStageAudit.length - preEstreePolicyRejections.length,
    preEstreePolicyRejectionCount: preEstreePolicyRejections.length,
    preEstreePolicyRejectionNames: Object.freeze(
      preEstreePolicyRejections.map(({ name }) => name),
    ),
  });
  const foundationNegatives = Object.freeze([
    ...generatedFoundationEvidence,
    ...namedEvidence.slice(0, NAMED_FOUNDATION_CONTROL_COUNT),
  ]);
  const semanticNegatives = Object.freeze(
    namedEvidence.slice(NAMED_FOUNDATION_CONTROL_COUNT),
  );
  const evidenceManifest = createStaticEvidenceManifest({
    foundationNegatives,
    semanticNegatives,
    positives: Object.freeze(positiveEvidence),
    evaluationAttempts,
  });
  const privateLookupManifest = createPrivateLookupManifest(positiveAudits);
  return Object.freeze({
    rejected: sources.length + namedRejected.length,
    namedRejected: Object.freeze(namedRejected),
    layeredStaticNegativeEvidence,
    accepted: positiveSources.length,
    namedAccepted: POSITIVE_CONTROL_NAMES,
    evaluationAttempts,
    evidenceManifest,
    privateLookupManifest,
  });
}

function evaluateCandidateOnlyWhenEvaluatorCloses(source, evaluate) {
  if (source !== null) {
    auditCandidateSource(source);
    throw new Error(
      "candidate evaluation disabled until the complete evaluator matrix is executable and the remaining private-store commit-position and semantic-mutation quotas are proved",
    );
  }
  return evaluate();
}

function isExpectedAbsentCandidateModuleError(error, candidateSourceText) {
  if (candidateSourceText !== null || error?.code !== "ERR_MODULE_NOT_FOUND") {
    return false;
  }
  if (error.url !== undefined) return error.url === SOURCE_URL.href;
  return error.message === NODE_20_0_MISSING_CANDIDATE_MESSAGE;
}

function pinPredecessorSourcesBeforeCandidateRead() {
  const fixturePins = new Map(
    [
      ...STATIC_POLICY_REQUIREMENTS_ORACLE.predecessors.direct,
      ...STATIC_POLICY_REQUIREMENTS_ORACLE.predecessors.evidenceOnly,
    ].map(({ specifier, sha256: expectedSha256 }) => [
      specifier,
      expectedSha256,
    ]),
  );
  assert.equal(fixturePins.size, PREDECESSOR_SOURCE_GOLDENS.length);
  let directCount = 0;
  let evidenceOnlyCount = 0;
  for (const golden of PREDECESSOR_SOURCE_GOLDENS) {
    const bytes = readFileSync(
      new URL(`../src/candidate/${golden.specifier.slice(2)}`, import.meta.url),
    );
    assertPinnedPredecessorBytes(bytes, golden);
    assert.equal(fixturePins.get(golden.specifier), golden.sha256);
    if (golden.kind === "direct") directCount += 1;
    else if (golden.kind === "evidenceOnly") evidenceOnlyCount += 1;
    else throw new Error(`unknown predecessor kind: ${golden.kind}`);
  }
  return Object.freeze({
    completedBeforeCandidateRead: true,
    directCount,
    evidenceOnlyCount,
    sourceCount: PREDECESSOR_SOURCE_GOLDENS.length,
  });
}

const SYNCHRONOUS_PREDECESSOR_AUDIT =
  pinPredecessorSourcesBeforeCandidateRead();
const ADVERSARIAL_WIRING_ACTIVITY = {
  candidateSourceReadAttempts: 0,
  candidateModuleImportAttempts: 0,
  candidateModuleEvaluationCompletions: 0,
  candidateBehaviorExecutionAttempts: 0,
  candidateInputReads: 0,
  oracleInputReads: 0,
  freshLoaderInputReads: 0,
  freshLoaderCalls: 0,
};
const adversarialModule = await import(
  new URL(
    "./candidate-containment-guardian-control-v1-adversarial.test.mjs",
    import.meta.url,
  ).href
);
const SOURCE_INDEPENDENT_ADVERSARIAL_ORACLE =
  adversarialModule.createSourceIndependentAdversarialOracle(
    REQUIREMENTS_ORACLE,
  );
const SOURCE_INDEPENDENT_MATERIALIZED_STATUS_ORACLE =
  adversarialModule.createSourceIndependentMaterializedStatusOracle(
    REQUIREMENTS_ORACLE,
  );
const failClosedFreshCandidateLoader = () => {
  ADVERSARIAL_WIRING_ACTIVITY.freshLoaderCalls += 1;
  throw new Error(
    "fresh candidate loading remains disabled until the candidate-connected TODO is implemented",
  );
};
const DEFERRED_ADVERSARIAL_INPUTS = {
  candidate: null,
  oracle: SOURCE_INDEPENDENT_ADVERSARIAL_ORACLE,
  loadFreshCandidate: failClosedFreshCandidateLoader,
};
const adversarialRegistration = {};
for (const [name, activityName] of [
  ["candidate", "candidateInputReads"],
  ["oracle", "oracleInputReads"],
  ["loadFreshCandidate", "freshLoaderInputReads"],
]) {
  Object.defineProperty(adversarialRegistration, name, {
    configurable: false,
    enumerable: true,
    get() {
      ADVERSARIAL_WIRING_ACTIVITY[activityName] += 1;
      return DEFERRED_ADVERSARIAL_INPUTS[name];
    },
  });
}
Object.freeze(adversarialRegistration);
const ADVERSARIAL_REGISTRATION_RECEIPT =
  adversarialModule.registerAdversarialCandidateTests(adversarialRegistration);
const SYNCHRONOUS_ADVERSARIAL_REGISTRATION_AUDIT = Object.freeze({
  predecessorAuditCompletedBeforeAdversarialImport:
    SYNCHRONOUS_PREDECESSOR_AUDIT.completedBeforeCandidateRead,
  candidateSourceReadAttemptsAtImportAndRegistration:
    ADVERSARIAL_WIRING_ACTIVITY.candidateSourceReadAttempts,
  candidateModuleImportAttemptsAtImportAndRegistration:
    ADVERSARIAL_WIRING_ACTIVITY.candidateModuleImportAttempts,
  candidateModuleEvaluationCompletionsAtImportAndRegistration:
    ADVERSARIAL_WIRING_ACTIVITY.candidateModuleEvaluationCompletions,
  candidateBehaviorExecutionAttemptsAtImportAndRegistration:
    ADVERSARIAL_WIRING_ACTIVITY.candidateBehaviorExecutionAttempts,
  candidateInputReadsAtRegistration:
    ADVERSARIAL_WIRING_ACTIVITY.candidateInputReads,
  oracleInputReadsAtRegistration: ADVERSARIAL_WIRING_ACTIVITY.oracleInputReads,
  freshLoaderInputReadsAtRegistration:
    ADVERSARIAL_WIRING_ACTIVITY.freshLoaderInputReads,
  freshLoaderCallsAtImportAndRegistration:
    ADVERSARIAL_WIRING_ACTIVITY.freshLoaderCalls,
});
const PARENTHESIZED_CALLEE_AST =
  parseCandidateModuleAst("(sha256)(bytes);").program;
const STRICT_PARSER_CONTROLS = Object.freeze({
  acceptedNodeCount: parseCandidateModuleAst(sourceSkeleton()).nodeCount,
  preservedParenthesizedCallee:
    PARENTHESIZED_CALLEE_AST.body[0].expression.callee.type,
  rejected: Object.freeze(
    [
      Object.freeze({
        name: "hashbang",
        source: `#!/usr/bin/env node\n${sourceSkeleton()}`,
      }),
      Object.freeze({ name: "top-level return", source: "return null;" }),
      Object.freeze({ name: "top-level await", source: "await null;" }),
      Object.freeze({
        name: "for-await",
        source:
          "async function consume(values) { for await (const value of values) {} }",
      }),
    ].map(({ name, source }) => {
      assert.throws(
        () => parseCandidateModuleAst(source),
        /static gate:/u,
        name,
      );
      return name;
    }),
  ),
});
const STATIC_NEGATIVE_CONTROLS = runStaticNegativeControls();
const STATIC_ESTREE_SUBSET_EVIDENCE = Object.freeze({
  sourceIndependentNegativeControls: 366,
  acceptedSyntheticSources: 11,
  layeredStaticNegativeEvidence:
    STATIC_NEGATIVE_CONTROLS.layeredStaticNegativeEvidence,
  representativeCommitMutationSourceInventory: 167,
  finalRequiredNegativeControls: 330,
  finalRequiredPositiveControls: 11,
  fullSemanticGateClosed: false,
  nonclaims: Object.freeze([
    "the final 330-negative and 11-positive AST/dataflow matrix is not complete",
    "the 167 current commit mutation sources are partial, not final 200-mutation closure",
    "private-store lookup evidence proves only the exact static owner, store, method, and key-parameter policy",
    "failure callbacks are accepted only as exact zero-parameter pinned-code throwers",
    "candidate evaluation and candidate-connected runtime acceptance remain disabled",
  ]),
});

let candidate = null;
let candidateImportError = null;
let candidateSourceGateError = null;
let sourceText = null;
try {
  ADVERSARIAL_WIRING_ACTIVITY.candidateSourceReadAttempts += 1;
  sourceText = readFileSync(SOURCE_PATH, "utf8");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
try {
  candidate = await evaluateCandidateOnlyWhenEvaluatorCloses(sourceText, () => {
    ADVERSARIAL_WIRING_ACTIVITY.candidateModuleImportAttempts += 1;
    return import(SOURCE_URL.href).then((loadedCandidate) => {
      ADVERSARIAL_WIRING_ACTIVITY.candidateModuleEvaluationCompletions += 1;
      return loadedCandidate;
    });
  });
} catch (error) {
  if (sourceText !== null) {
    candidateSourceGateError = error;
  } else if (isExpectedAbsentCandidateModuleError(error, sourceText)) {
    candidateImportError = error;
  } else {
    throw error;
  }
}
DEFERRED_ADVERSARIAL_INPUTS.candidate = candidate;

test("independently canonicalizes the normative requirements fixture", () => {
  assert.equal(
    semanticSha256(REQUIREMENTS_ORACLE),
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.schema,
    "oxigraph.candidate-containment-guardian-control-requirements/v1",
  );
  assert.equal(REQUIREMENTS_ORACLE.version, 1);
  assert.equal(
    REQUIREMENTS_ORACLE.vocabularies.byteCarrierAdditionalOwnPropertyPolicy,
    EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.predecessors.direct.length,
    ALLOWED_IMPORTS.size,
  );
  assert.deepEqual(
    Object.keys(REQUIREMENTS_ORACLE),
    EXPECTED_REQUIREMENTS_TOP_LEVEL_FIELDS,
  );
  assert.deepEqual(REQUIREMENTS_ORACLE.modes, ["NORMAL", "RECOVERY_ONLY"]);
  assert.deepEqual(REQUIREMENTS_ORACLE.privateStateStores, [
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  assert.deepEqual(
    REQUIREMENTS_ORACLE.vocabularies.ambientIntrinsics,
    ALLOWED_AMBIENT_INTRINSICS,
  );
  assert.deepEqual(REQUIREMENTS_ORACLE.authority, {
    transportAuthority: false,
    descriptorAuthority: false,
    filesystemAuthority: false,
    cgroupAuthority: false,
    processAuthority: false,
    recoveryAuthority: false,
    runtimeAuthority: false,
  });
  assert.deepEqual(REQUIREMENTS_ORACLE.physicalFacts, {
    socketTransfer: null,
    descriptorInventory: null,
    epochOrigin: null,
    guardianExecution: null,
    recoveryExecution: null,
    cleanup: null,
  });
  assert.deepEqual(
    REQUIREMENTS_ORACLE.predecessors.direct.map(
      ({ specifier, sha256, requirementsSha256, imports }) => ({
        specifier,
        sha256,
        requirementsSha256,
        imports,
      }),
    ),
    [
      {
        specifier: "./containment-exact-v2.mjs",
        sha256:
          "2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3",
        requirementsSha256: null,
        imports: ALLOWED_IMPORTS.get("./containment-exact-v2.mjs"),
      },
      {
        specifier: "./containment-guardian-recovery-v1.mjs",
        sha256:
          "e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d",
        requirementsSha256:
          "278031a43b331036e6c849f796d480e7fe680219d07bdb5b30185668a9337c5a",
        imports: ALLOWED_IMPORTS.get("./containment-guardian-recovery-v1.mjs"),
      },
      {
        specifier: "./containment-launch-capsule-v3.mjs",
        sha256:
          "9579d8b66a81a09be1efc60e2f23e930070dda66175273548fcf1d3e9d23c41d",
        requirementsSha256:
          "4432b3334ff07b847f1ee8abe49c184df5c993545c21f405ccc1247ecb20604a",
        imports: ALLOWED_IMPORTS.get("./containment-launch-capsule-v3.mjs"),
      },
    ],
  );
});

test("reconstructs all three map digests from separately authored goldens", () => {
  assert.equal(
    semanticSha256(NORMAL_STARTUP_MAP_GOLDEN),
    EXPECTED_NORMAL_MAP_SHA256,
  );
  assert.equal(
    semanticSha256(RECOVERY_STARTUP_MAP_GOLDEN),
    EXPECTED_RECOVERY_MAP_SHA256,
  );
  assert.equal(
    semanticSha256(ADMISSION_RIGHT_MAP_GOLDEN),
    EXPECTED_RIGHT_MAP_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.startupMaps.normalSha256,
    EXPECTED_NORMAL_MAP_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.startupMaps.recoveryOnlySha256,
    EXPECTED_RECOVERY_MAP_SHA256,
  );
  assert.equal(
    REQUIREMENTS_ORACLE.admissionRights.sha256,
    EXPECTED_RIGHT_MAP_SHA256,
  );
});

test("pins all predecessor bytes and rejects independent drift mutations", () => {
  assert.deepEqual(SYNCHRONOUS_PREDECESSOR_AUDIT, {
    completedBeforeCandidateRead: true,
    directCount: 3,
    evidenceOnlyCount: 2,
    sourceCount: 5,
  });
  assert.deepEqual(SYNCHRONOUS_ADVERSARIAL_REGISTRATION_AUDIT, {
    predecessorAuditCompletedBeforeAdversarialImport: true,
    candidateSourceReadAttemptsAtImportAndRegistration: 0,
    candidateModuleImportAttemptsAtImportAndRegistration: 0,
    candidateModuleEvaluationCompletionsAtImportAndRegistration: 0,
    candidateBehaviorExecutionAttemptsAtImportAndRegistration: 0,
    candidateInputReadsAtRegistration: 0,
    oracleInputReadsAtRegistration: 0,
    freshLoaderInputReadsAtRegistration: 0,
    freshLoaderCallsAtImportAndRegistration: 0,
  });
  assert.deepEqual(ADVERSARIAL_REGISTRATION_RECEIPT, {
    schema:
      "oxigraph.test.candidate-containment-guardian-control-v1-adversarial-registration/v1",
    inventorySha256:
      "f448be91b5a4bb086e93e4ef529428bd0d509c14fd532e75e02ea1a256c0cb3e",
    registeredCount: 2,
    todoCount: 2,
    inputsDeferredUntilExecution: true,
  });
  assert.equal(Object.isFrozen(ADVERSARIAL_REGISTRATION_RECEIPT), true);
  assert.equal(Object.isFrozen(SOURCE_INDEPENDENT_ADVERSARIAL_ORACLE), true);
  assert.equal(
    SOURCE_INDEPENDENT_ADVERSARIAL_ORACLE.requirementsSha256,
    EXPECTED_REQUIREMENTS_SHA256,
  );
  assert.deepEqual(SOURCE_INDEPENDENT_ADVERSARIAL_ORACLE.construction, {
    fixtureDerived: true,
    constructorApplicabilityProvenancePinned: true,
    candidateInputAccepted: false,
    candidateModuleReadByGenerator: false,
    candidateModuleImportedByGenerator: false,
    candidateModuleEvaluatedByGenerator: false,
    candidateBehaviorExecuted: false,
    wholeTransitionValuesMaterialized: false,
    emittedStatusBytesMaterialized: false,
  });
  assert.deepEqual(SOURCE_INDEPENDENT_ADVERSARIAL_ORACLE.counts, {
    wholeTransitionStateGoldenDesigns: 20,
    emittedStatusByteGoldenDesigns: 15,
    atomicTwoStatusWirePrefixControls: 4,
    acceptedSymbolicPrefixObservations: 26,
    descriptorAliasControls: 252,
    constructibleFailurePrecedencePairs: 18,
  });
  assert.deepEqual(
    {
      candidate: ADVERSARIAL_WIRING_ACTIVITY.candidateInputReads,
      oracle: ADVERSARIAL_WIRING_ACTIVITY.oracleInputReads,
      loadFreshCandidate: ADVERSARIAL_WIRING_ACTIVITY.freshLoaderInputReads,
    },
    { candidate: 2, oracle: 2, loadFreshCandidate: 1 },
  );
  assert.equal(ADVERSARIAL_WIRING_ACTIVITY.freshLoaderCalls, 0);
  assert.equal(
    ADVERSARIAL_WIRING_ACTIVITY.candidateModuleEvaluationCompletions,
    0,
  );
  assert.equal(
    ADVERSARIAL_WIRING_ACTIVITY.candidateBehaviorExecutionAttempts,
    0,
  );
  const fixturePins = new Map(
    [
      ...REQUIREMENTS_ORACLE.predecessors.direct,
      ...REQUIREMENTS_ORACLE.predecessors.evidenceOnly,
    ].map(({ specifier, sha256 }) => [specifier, sha256]),
  );
  assert.equal(PREDECESSOR_SOURCE_GOLDENS.length, 5);
  assert.equal(
    PREDECESSOR_SOURCE_GOLDENS.filter(({ kind }) => kind === "direct").length,
    3,
  );
  assert.equal(
    PREDECESSOR_SOURCE_GOLDENS.filter(({ kind }) => kind === "evidenceOnly")
      .length,
    2,
  );
  let rejectedMutations = 0;
  for (const golden of PREDECESSOR_SOURCE_GOLDENS) {
    const bytes = readFileSync(
      new URL(`../src/candidate/${golden.specifier.slice(2)}`, import.meta.url),
    );
    assert.doesNotThrow(() => assertPinnedPredecessorBytes(bytes, golden));
    assert.equal(
      fixturePins.get(golden.specifier),
      golden.sha256,
      golden.specifier,
    );
    for (const mutated of predecessorByteMutations(bytes)) {
      assert.throws(
        () => assertPinnedPredecessorBytes(mutated, golden),
        /predecessor source pin mismatch/gu,
      );
      rejectedMutations += 1;
    }
  }
  assert.equal(rejectedMutations, 25);
});

test("freezes the evaluator expansion-count anchors without claiming coverage", () => {
  assert.equal(EXPECTED_EXPORTS.length, EXPANSION_ANCHORS.namedExports);
  assert.deepEqual(EXPANSION_ANCHORS.completeSequenceWireFrameCounts, {
    N1: 4,
    N2: 6,
    N3: 3,
    N4: 5,
    N5a: 2,
    N5b: 4,
    R1: 3,
    R2: 3,
  });
  assert.deepEqual(EXPANSION_ANCHORS.terminalEventCounts, {
    N1: 5,
    N2: 7,
    N3: 5,
    N4: 7,
    N5a: 4,
    N5b: 6,
    R1: 5,
    R2: 5,
  });
});

test("rejects static-policy negative controls before any evaluation attempt", () => {
  assert.deepEqual(SYNCHRONOUS_PARSER_AUDIT, {
    completedBeforeCandidateRead: true,
    policy: "latest",
    ...EXPECTED_ACORN,
  });
  assert.deepEqual(PARSER_LOAD_AUDIT, {
    completedAfterIdentityPin: true,
    completedBeforeCandidateRead: true,
    entrypoint: EXPECTED_ACORN.importEntrypoint,
    version: EXPECTED_ACORN.version,
  });
  assert.equal(STRICT_PARSER_CONTROLS.acceptedNodeCount > 0, true);
  assert.equal(
    STRICT_PARSER_CONTROLS.preservedParenthesizedCallee,
    "ParenthesizedExpression",
  );
  assert.deepEqual(STRICT_PARSER_CONTROLS.rejected, [
    "hashbang",
    "top-level return",
    "top-level await",
    "for-await",
  ]);
  const {
    evidenceManifest,
    privateLookupManifest,
    ...staticNegativeControlReceipt
  } = STATIC_NEGATIVE_CONTROLS;
  assert.equal(
    evidenceManifest.schema,
    "oxigraph.candidate-containment-guardian-control-static-evidence-manifest/v1",
  );
  assert.deepEqual(Object.keys(evidenceManifest), [
    "schema",
    "foundationNegatives",
    "semanticNegatives",
    "positives",
    "commitMutationIds",
    "bucketProjection",
    "counts",
    "aggregates",
  ]);
  assert.deepEqual(
    Object.keys(evidenceManifest.aggregates),
    Object.keys(EXPECTED_STATIC_EVIDENCE_AGGREGATES),
  );
  assert.deepEqual(staticNegativeControlReceipt, {
    rejected: 366,
    namedRejected: [
      "nested private-store set call",
      "nested member assignment",
      "bare-block private-store declarations",
      "nested compound member assignment",
      "private-store frozen alias",
      "imported-function frozen alias",
      "deepFreeze retains mutable canonical bytes",
      "fixture key is not a normative string-value exception",
      "numeric member-chain authority gadget",
      "parenthesized top-level invocation",
      "parenthesized private-store method invocation",
      "non-normative substring Reflect authority gadget",
      "U+2028 line-comment import smuggling",
      "U+2029 line-comment import smuggling",
      "U+2028 string-continuation authority spelling",
      "U+2029 string-continuation authority spelling",
      "function-scoped imported helper alias",
      "laundered untrusted receiver",
      "parenthesized imported-helper call",
      "computed member on frozen local",
      "function-scoped member write",
      "function-scoped binding write",
      "normative literal outside normative role",
      "normative record key outside requirements initializer",
      "unknown provenance branch join",
      "untrusted condition coercion",
      "untrusted iteration",
      "raw untrusted return",
      "private-store get embedded in returned frozen graph",
      "private-store commit in non-owner",
      "private-store commit under control flow",
      "function-scoped ambient alias",
      "function-scoped Reflect alias",
      "function-scoped exported-function alias",
      "direct internal exported-operation call",
      "function-scoped exported-value alias",
      "function-scoped private-store alias",
      "nested function declaration",
      "recursive module-function call",
      "requirements initializer semantic drift",
      "requirements digest initializer drift",
      "private-store commit followed by fallible work",
      "private-store owner has early return",
      "conditional fallible work before private-store commit",
      "conditional-expression skipped arm before private-store commit",
      "logical-expression skipped AND RHS before private-store commit",
      "logical-expression skipped OR RHS before private-store commit",
      "logical-expression skipped nullish RHS before private-store commit",
      "private-store commit returns metadata",
      "private-store commit aliases result and metadata",
      "private-store result and metadata share nested origin",
      "second private-store commit",
      "private-store commit uses wrong owning store",
      "parenthesized owning private-store callee",
      "inline private-store commit arguments",
      "module-scoped private-store metadata argument",
      "mutable array push call",
      "mutable set add call",
      "shallow ambient freeze used as deep freeze",
      "untrusted value retained by frozen graph",
      "ambient coercion of untrusted value",
      "untrusted argument passed to local function",
      "nonthrowing imported failure callback",
      "recursive imported failure callback",
      "private lookup from unowned local helper",
      "startup commit ownership does not grant private lookup",
      "initializer private lookup uses wrong store",
      "status verifier private lookup uses wrong store",
      "input commit ownership does not grant private lookup",
      "private lookup rejects function-local key",
      "private lookup rejects wrong reducer parameter",
      "private lookup rejects wrong input-constructor parameter",
      "private lookup value returned",
      "private lookup value inspected",
      "private lookup value joined conditionally",
      "private lookup value used as logical operand",
      "parenthesized ambient coercer call",
      "parenthesized local-function call",
      "parenthesized exported-operation call",
      "parenthesized authorized private-lookup call",
      "parenthesized safe-member call",
      "call-result callee",
      "conditional-expression callee",
      "logical-expression callee",
      "sequence-expression callee",
      "member-call result used as callee",
      "unary-expression callee",
      "computed public-input index",
      "computed private-store index",
      "computed imported-helper index",
      "computed ambient-intrinsic index",
      "computed exported-operation index",
      "computed member callee",
      "direct Reflect call",
      "Reflect array element",
      "Reflect unary operand",
      "Reflect argument",
      "Reflect conditional branch",
      "local alias binding assignment",
      "local alias member compound assignment",
      "ambient intrinsic binding assignment",
      "ambient intrinsic member assignment",
      "imported helper binding compound assignment",
      "imported helper member assignment",
      "exported operation binding assignment",
      "exported operation member compound assignment",
      "exported value binding assignment",
      "exported value member assignment",
      "untrusted value passed to sha256",
      "untrusted value passed to canonical JSON bytes",
      "untrusted value passed to canonical JSON line",
      "untrusted ambient Boolean coercion",
      "untrusted Error constructor argument",
      "untrusted Set constructor argument",
      "untrusted value passed through local sink",
      "untrusted argument passed to includes",
      "untrusted argument passed to at",
      "untrusted alias used as bytes receiver",
      "untrusted unary coercion",
      "untrusted binary operand",
      "untrusted logical operand",
      "untrusted conditional test",
      "untrusted value thrown directly",
      "double-aliased untrusted return",
      "untrusted array graph returned",
      "untrusted object graph returned",
      "bounded buffer copy returned without freezing",
      "decoded base64 bytes returned without freezing",
      "sliced bounded buffer returned without freezing",
      "aliased private lookup value returned",
      "ambient String coercion constructs normative authority key",
      "nested fragments construct normative authority key",
      "local aliases construct normative authority key",
      "module aliases construct normative authority key",
      "conditional prefix constructs normative authority key",
      "conditional suffix constructs normative authority key",
      "logical prefix constructs normative authority key",
      "local return constructs normative authority key",
      "factored normative authority object returned",
      "factored normative authority object passed to sink",
      "conditional-expression joins distinct frozen origins",
      "logical AND joins distinct frozen origins",
      "logical OR joins distinct frozen origins",
      "logical nullish joins distinct frozen origins",
      "if branches join distinct return origins",
      "nested conditional joins distinct return origins",
      "for-of and fallthrough join distinct return origins",
      "conditional return leaves successful fallthrough",
      "for-of return leaves zero-iteration fallthrough",
      "empty local function falls through",
      "conditional throw leaves successful fallthrough",
      "called local function may fall through",
      "failure callback may fall through",
      "private-store owner commit return is unreachable",
      "two-function call graph SCC",
      "three-function call graph SCC",
      "conditional-edge call graph SCC",
      "loop-edge call graph SCC",
      "self-recursive failure callback SCC",
      "mixed callback and direct-call SCC",
      "two-callback-edge SCC",
      "unreachable self-recursive call",
      "unreachable detached call graph SCC",
      ...PRIVATE_COMMIT_DOMINANCE_CONTROLS.map(({ name }) => name),
      ...PRIVATE_COMMIT_TAIL_CONTROLS.map(({ name }) => name),
      ...PRIVATE_COMMIT_PROVENANCE_CONTROLS.map(({ name }) => name),
      ...PRIVATE_COMMIT_CALL_SHAPE_CONTROLS.map(({ name }) => name),
    ],
    layeredStaticNegativeEvidence: {
      totalDeltaSinceParserFoundation: 297,
      estreePolicyReachedCount: 294,
      preEstreePolicyRejectionCount: 3,
      preEstreePolicyRejectionNames: [
        "requirements initializer semantic drift",
        "shallow ambient freeze used as deep freeze",
        "ambient intrinsic member assignment",
      ],
    },
    accepted: 11,
    namedAccepted: [
      "exact requirements AST normalization",
      "approved untrusted-value normalizer",
      "frozen local iteration",
      "frozen local module table",
      "pure requirements and ephemeral canonical digest initializers",
      "initializer startup private lookup pair",
      "status verifier startup private lookup pair",
      "admission state private lookup pair",
      "remaining input-constructor state private lookup pairs",
      "reducer state private lookup pair",
      "reducer branded-input private lookup pair",
    ],
    evaluationAttempts: 0,
  });
  const foundationEntries = evidenceManifest.foundationNegatives;
  const semanticEntries = evidenceManifest.semanticNegatives;
  const positiveEntries = evidenceManifest.positives;
  const allEvidenceEntries = [
    ...foundationEntries,
    ...semanticEntries,
    ...positiveEntries,
  ];
  assertRecursivelyFrozenWithoutByteViews(evidenceManifest);
  assert.deepEqual(
    foundationEntries.map(({ id }) => id),
    Array.from({ length: 69 }, (_, index) =>
      staticControlId("FOUNDATION-N", index),
    ),
  );
  assert.deepEqual(
    semanticEntries.map(({ id }) => id),
    Array.from({ length: 297 }, (_, index) => staticControlId("SEM-N", index)),
  );
  assert.deepEqual(
    positiveEntries.map(({ id }) => id),
    Array.from({ length: 11 }, (_, index) => staticControlId("POS-P", index)),
  );
  for (const entry of allEvidenceEntries) {
    assert.deepEqual(Object.keys(entry), [
      "id",
      "name",
      "bucket",
      "sourceSha256",
      "astSha256",
      "astNodeCount",
      "expectedStage",
      "expectedError",
    ]);
    assert.equal(Object.hasOwn(entry, "source"), false, entry.id);
  }
  assert.equal(new Set(allEvidenceEntries.map(({ id }) => id)).size, 377);
  assert.equal(new Set(allEvidenceEntries.map(({ name }) => name)).size, 377);
  assert.equal(
    new Set(allEvidenceEntries.map(({ sourceSha256 }) => sourceSha256)).size,
    377,
  );
  assert.deepEqual(
    EXPECTED_PRIVATE_COMMIT_DOMINANCE_OWNER_RANGES.map(
      ({ functionName, storeName }) => ({ functionName, storeName }),
    ),
    EXPECTED_PRIVATE_STORE_COMMITS,
  );
  assert.deepEqual(
    EXPECTED_PRIVATE_COMMIT_DOMINANCE_OWNER_RANGES.map(
      ({ functionName, storeName, firstId, lastId }, ownerIndex) => {
        const ownerControls = PRIVATE_COMMIT_DOMINANCE_CONTROLS.slice(
          ownerIndex * PRIVATE_COMMIT_DOMINANCE_FAMILIES.length,
          (ownerIndex + 1) * PRIVATE_COMMIT_DOMINANCE_FAMILIES.length,
        );
        return {
          functionNames: [
            ...new Set(ownerControls.map((control) => control.functionName)),
          ],
          storeNames: [
            ...new Set(ownerControls.map((control) => control.storeName)),
          ],
          firstId: ownerControls.at(0).id,
          lastId: ownerControls.at(-1).id,
          controlCount: ownerControls.length,
        };
      },
    ),
    EXPECTED_PRIVATE_COMMIT_DOMINANCE_OWNER_RANGES.map(
      ({ functionName, storeName, firstId, lastId }) => ({
        functionNames: [functionName],
        storeNames: [storeName],
        firstId,
        lastId,
        controlCount: 5,
      }),
    ),
  );
  const privateCommitDominanceEntries = semanticEntries.slice(147, 197);
  assert.equal(privateCommitDominanceEntries.length, 50);
  assert.deepEqual(
    privateCommitDominanceEntries.map((entry, index) => {
      const control = PRIVATE_COMMIT_DOMINANCE_CONTROLS[index];
      return {
        id: entry.id,
        functionName: control.functionName,
        storeName: control.storeName,
        familyName: control.familyName,
        name: entry.name,
        bucket: entry.bucket,
        expectedStage: entry.expectedStage,
        expectedError: entry.expectedError,
      };
    }),
    EXPECTED_PRIVATE_COMMIT_DOMINANCE_OWNER_RANGES.flatMap(
      ({ functionName, storeName }, ownerIndex) =>
        PRIVATE_COMMIT_DOMINANCE_FAMILIES.map(
          ({ name: familyName }, familyIndex) => ({
            id: staticControlId(
              "SEM-N",
              147 +
                ownerIndex * PRIVATE_COMMIT_DOMINANCE_FAMILIES.length +
                familyIndex,
            ),
            functionName,
            storeName,
            familyName,
            name: `${functionName} pre-commit ${familyName} dominance`,
            bucket: "commitMutations",
            expectedStage: "estree-policy",
            expectedError: `static gate: ESTree fallible operation does not dominate commit ${functionName}`,
          }),
        ),
    ),
  );
  assert.deepEqual(
    privateCommitDominanceEntries.map(({ sourceSha256 }) => sourceSha256),
    PRIVATE_COMMIT_DOMINANCE_CONTROLS.map(({ source }) =>
      byteSha256(Buffer.from(source, "utf8")),
    ),
  );
  assert.equal(
    new Set(PRIVATE_COMMIT_DOMINANCE_CONTROLS.map(({ source }) => source)).size,
    50,
  );
  assert.equal(
    new Set(
      privateCommitDominanceEntries.map(({ sourceSha256 }) => sourceSha256),
    ).size,
    50,
  );
  assert.equal(
    new Set(privateCommitDominanceEntries.map(({ astSha256 }) => astSha256))
      .size,
    50,
  );
  assert.equal(
    privateCommitDominanceEntries.every(
      ({ astSha256, astNodeCount }) =>
        astSha256 !== null && astNodeCount !== null,
    ),
    true,
  );
  const preB6EvidenceEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 147),
    ...positiveEntries,
  ];
  const preB6SourceHashes = new Set(
    preB6EvidenceEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preB6AstHashes = new Set(
    preB6EvidenceEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(
    privateCommitDominanceEntries.some(({ sourceSha256 }) =>
      preB6SourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    privateCommitDominanceEntries.some(({ astSha256 }) =>
      preB6AstHashes.has(astSha256),
    ),
    false,
  );
  assert.deepEqual(
    EXPECTED_PRIVATE_COMMIT_TAIL_OWNER_RANGES.map(
      ({ functionName, storeName }) => ({ functionName, storeName }),
    ),
    EXPECTED_PRIVATE_STORE_COMMITS,
  );
  assert.deepEqual(
    EXPECTED_PRIVATE_COMMIT_TAIL_OWNER_RANGES.map(
      ({ functionName, storeName, firstId, lastId }, ownerIndex) => {
        const ownerControls = PRIVATE_COMMIT_TAIL_CONTROLS.slice(
          ownerIndex * PRIVATE_COMMIT_TAIL_FAMILIES.length,
          (ownerIndex + 1) * PRIVATE_COMMIT_TAIL_FAMILIES.length,
        );
        return {
          functionNames: [
            ...new Set(ownerControls.map((control) => control.functionName)),
          ],
          storeNames: [
            ...new Set(ownerControls.map((control) => control.storeName)),
          ],
          firstId: ownerControls.at(0).id,
          lastId: ownerControls.at(-1).id,
          controlCount: ownerControls.length,
        };
      },
    ),
    EXPECTED_PRIVATE_COMMIT_TAIL_OWNER_RANGES.map(
      ({ functionName, storeName, firstId, lastId }) => ({
        functionNames: [functionName],
        storeNames: [storeName],
        firstId,
        lastId,
        controlCount: 3,
      }),
    ),
  );
  const privateCommitTailEntries = semanticEntries.slice(197, 227);
  assert.equal(privateCommitTailEntries.length, 30);
  assert.deepEqual(
    privateCommitTailEntries.map((entry, index) => {
      const control = PRIVATE_COMMIT_TAIL_CONTROLS[index];
      return {
        id: entry.id,
        functionName: control.functionName,
        storeName: control.storeName,
        familyName: control.familyName,
        name: entry.name,
        bucket: entry.bucket,
        expectedStage: entry.expectedStage,
        expectedError: entry.expectedError,
      };
    }),
    EXPECTED_PRIVATE_COMMIT_TAIL_OWNER_RANGES.flatMap(
      ({ functionName, storeName }, ownerIndex) =>
        PRIVATE_COMMIT_TAIL_FAMILIES.map((familyName, familyIndex) => ({
          id: staticControlId(
            "SEM-N",
            197 +
              ownerIndex * PRIVATE_COMMIT_TAIL_FAMILIES.length +
              familyIndex,
          ),
          functionName,
          storeName,
          familyName,
          name: `${functionName} ${familyName} isolation`,
          bucket: "commitMutations",
          expectedStage: "estree-policy",
          expectedError: `static gate: ESTree private commit tail ${functionName}`,
        })),
    ),
  );
  assert.deepEqual(
    privateCommitTailEntries.map(({ sourceSha256 }) => sourceSha256),
    PRIVATE_COMMIT_TAIL_CONTROLS.map(({ source }) =>
      byteSha256(Buffer.from(source, "utf8")),
    ),
  );
  assert.equal(
    new Set(PRIVATE_COMMIT_TAIL_CONTROLS.map(({ source }) => source)).size,
    30,
  );
  assert.equal(
    new Set(privateCommitTailEntries.map(({ sourceSha256 }) => sourceSha256))
      .size,
    30,
  );
  assert.equal(
    new Set(privateCommitTailEntries.map(({ astSha256 }) => astSha256)).size,
    30,
  );
  assert.equal(
    privateCommitTailEntries.every(
      ({ astSha256, astNodeCount }) =>
        astSha256 !== null && astNodeCount !== null,
    ),
    true,
  );
  const preB7EvidenceEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 197),
    ...positiveEntries,
  ];
  const preB7SourceHashes = new Set(
    preB7EvidenceEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preB7AstHashes = new Set(
    preB7EvidenceEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(
    privateCommitTailEntries.some(({ sourceSha256 }) =>
      preB7SourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    privateCommitTailEntries.some(({ astSha256 }) =>
      preB7AstHashes.has(astSha256),
    ),
    false,
  );
  assert.deepEqual(
    EXPECTED_PRIVATE_COMMIT_PROVENANCE_OWNER_RANGES.map(
      ({ functionName, storeName }) => ({ functionName, storeName }),
    ),
    EXPECTED_PRIVATE_STORE_COMMITS,
  );
  assert.deepEqual(
    EXPECTED_PRIVATE_COMMIT_PROVENANCE_OWNER_RANGES.map(
      ({ functionName, storeName, firstId, lastId }, ownerIndex) => {
        const ownerControls = PRIVATE_COMMIT_PROVENANCE_CONTROLS.slice(
          ownerIndex * PRIVATE_COMMIT_PROVENANCE_FAMILIES.length,
          (ownerIndex + 1) * PRIVATE_COMMIT_PROVENANCE_FAMILIES.length,
        );
        return {
          functionNames: [
            ...new Set(ownerControls.map((control) => control.functionName)),
          ],
          storeNames: [
            ...new Set(ownerControls.map((control) => control.storeName)),
          ],
          firstId: ownerControls.at(0).id,
          lastId: ownerControls.at(-1).id,
          controlCount: ownerControls.length,
        };
      },
    ),
    EXPECTED_PRIVATE_COMMIT_PROVENANCE_OWNER_RANGES.map(
      ({ functionName, storeName, firstId, lastId }) => ({
        functionNames: [functionName],
        storeNames: [storeName],
        firstId,
        lastId,
        controlCount: 3,
      }),
    ),
  );
  const privateCommitProvenanceEntries = semanticEntries.slice(227, 257);
  assert.equal(privateCommitProvenanceEntries.length, 30);
  assert.deepEqual(
    privateCommitProvenanceEntries.map((entry, index) => {
      const control = PRIVATE_COMMIT_PROVENANCE_CONTROLS[index];
      return {
        id: entry.id,
        functionName: control.functionName,
        storeName: control.storeName,
        familyName: control.familyName,
        name: entry.name,
        bucket: entry.bucket,
        expectedStage: entry.expectedStage,
        expectedError: entry.expectedError,
      };
    }),
    EXPECTED_PRIVATE_COMMIT_PROVENANCE_OWNER_RANGES.flatMap(
      ({ functionName, storeName }, ownerIndex) =>
        PRIVATE_COMMIT_PROVENANCE_FAMILIES.map((familyName, familyIndex) => ({
          id: staticControlId(
            "SEM-N",
            227 +
              ownerIndex * PRIVATE_COMMIT_PROVENANCE_FAMILIES.length +
              familyIndex,
          ),
          functionName,
          storeName,
          familyName,
          name: `${functionName} ${familyName} provenance`,
          bucket: "commitMutations",
          expectedStage: "estree-policy",
          expectedError:
            "static gate: ESTree private commit arguments must be frozen and disjoint",
        })),
    ),
  );
  assert.deepEqual(
    privateCommitProvenanceEntries.map(({ sourceSha256 }) => sourceSha256),
    PRIVATE_COMMIT_PROVENANCE_CONTROLS.map(({ source }) =>
      byteSha256(Buffer.from(source, "utf8")),
    ),
  );
  assert.equal(
    new Set(PRIVATE_COMMIT_PROVENANCE_CONTROLS.map(({ source }) => source))
      .size,
    30,
  );
  assert.equal(
    new Set(
      privateCommitProvenanceEntries.map(({ sourceSha256 }) => sourceSha256),
    ).size,
    30,
  );
  assert.equal(
    new Set(privateCommitProvenanceEntries.map(({ astSha256 }) => astSha256))
      .size,
    30,
  );
  assert.equal(
    privateCommitProvenanceEntries.every(
      ({ astSha256, astNodeCount }) =>
        astSha256 !== null && astNodeCount !== null,
    ),
    true,
  );
  const preB8EvidenceEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 227),
    ...positiveEntries,
  ];
  const preB8SourceHashes = new Set(
    preB8EvidenceEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preB8AstHashes = new Set(
    preB8EvidenceEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(
    privateCommitProvenanceEntries.some(({ sourceSha256 }) =>
      preB8SourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    privateCommitProvenanceEntries.some(({ astSha256 }) =>
      preB8AstHashes.has(astSha256),
    ),
    false,
  );
  assert.deepEqual(
    EXPECTED_PRIVATE_COMMIT_CALL_SHAPE_OWNER_RANGES.map(
      ({ functionName, storeName }) => ({ functionName, storeName }),
    ),
    EXPECTED_PRIVATE_STORE_COMMITS,
  );
  assert.deepEqual(
    EXPECTED_PRIVATE_COMMIT_CALL_SHAPE_OWNER_RANGES.map(
      ({ functionName, storeName, firstId, lastId }, ownerIndex) => {
        const ownerControls = PRIVATE_COMMIT_CALL_SHAPE_CONTROLS.slice(
          ownerIndex * PRIVATE_COMMIT_CALL_SHAPE_FAMILIES.length,
          (ownerIndex + 1) * PRIVATE_COMMIT_CALL_SHAPE_FAMILIES.length,
        );
        return {
          functionNames: [
            ...new Set(ownerControls.map((control) => control.functionName)),
          ],
          storeNames: [
            ...new Set(ownerControls.map((control) => control.storeName)),
          ],
          firstId: ownerControls.at(0).id,
          lastId: ownerControls.at(-1).id,
          controlCount: ownerControls.length,
        };
      },
    ),
    EXPECTED_PRIVATE_COMMIT_CALL_SHAPE_OWNER_RANGES.map(
      ({ functionName, storeName, firstId, lastId }) => ({
        functionNames: [functionName],
        storeNames: [storeName],
        firstId,
        lastId,
        controlCount: 4,
      }),
    ),
  );
  const privateCommitCallShapeEntries = semanticEntries.slice(257);
  assert.equal(privateCommitCallShapeEntries.length, 40);
  assert.deepEqual(
    privateCommitCallShapeEntries.map((entry, index) => {
      const control = PRIVATE_COMMIT_CALL_SHAPE_CONTROLS[index];
      return {
        id: entry.id,
        functionName: control.functionName,
        storeName: control.storeName,
        familyName: control.familyName,
        name: entry.name,
        bucket: entry.bucket,
        expectedStage: entry.expectedStage,
        expectedError: entry.expectedError,
      };
    }),
    EXPECTED_PRIVATE_COMMIT_CALL_SHAPE_OWNER_RANGES.flatMap(
      ({ functionName, storeName }, ownerIndex) =>
        PRIVATE_COMMIT_CALL_SHAPE_FAMILIES.map((familyName, familyIndex) => ({
          id: staticControlId(
            "SEM-N",
            257 +
              ownerIndex * PRIVATE_COMMIT_CALL_SHAPE_FAMILIES.length +
              familyIndex,
          ),
          functionName,
          storeName,
          familyName,
          name: `${functionName} ${familyName} commit call shape`,
          bucket: "commitMutations",
          expectedStage: "estree-policy",
          expectedError: privateCommitCallShapeExpectedError(familyName),
        })),
    ),
  );
  assert.deepEqual(
    privateCommitCallShapeEntries.map(({ sourceSha256 }) => sourceSha256),
    PRIVATE_COMMIT_CALL_SHAPE_CONTROLS.map(({ source }) =>
      byteSha256(Buffer.from(source, "utf8")),
    ),
  );
  assert.equal(
    new Set(PRIVATE_COMMIT_CALL_SHAPE_CONTROLS.map(({ source }) => source))
      .size,
    40,
  );
  assert.equal(
    new Set(
      privateCommitCallShapeEntries.map(({ sourceSha256 }) => sourceSha256),
    ).size,
    40,
  );
  assert.equal(
    new Set(privateCommitCallShapeEntries.map(({ astSha256 }) => astSha256))
      .size,
    40,
  );
  assert.equal(
    privateCommitCallShapeEntries.every(
      ({ astSha256, astNodeCount }) =>
        astSha256 !== null && astNodeCount !== null,
    ),
    true,
  );
  assert.equal(
    PRIVATE_COMMIT_CALL_SHAPE_CONTROLS.filter(
      ({ familyName }) => familyName === "parenthesized/computed callee",
    ).every(({ source, storeName }) =>
      source.includes(`(${storeName}.set)(callShapeResult, callShapeMetadata)`),
    ),
    true,
  );
  const preB9EvidenceEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 257),
    ...positiveEntries,
  ];
  const preB9SourceHashes = new Set(
    preB9EvidenceEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preB9AstHashes = new Set(
    preB9EvidenceEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(
    privateCommitCallShapeEntries.some(({ sourceSha256 }) =>
      preB9SourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    privateCommitCallShapeEntries.some(({ astSha256 }) =>
      preB9AstHashes.has(astSha256),
    ),
    false,
  );
  const foundationIds = new Set(foundationEntries.map(({ id }) => id));
  const semanticIds = new Set(semanticEntries.map(({ id }) => id));
  const positiveIds = new Set(positiveEntries.map(({ id }) => id));
  assert.equal(
    [...foundationIds].filter((id) => semanticIds.has(id)).length,
    0,
  );
  assert.equal(
    [...foundationIds].filter((id) => positiveIds.has(id)).length,
    0,
  );
  assert.equal([...semanticIds].filter((id) => positiveIds.has(id)).length, 0);
  assert.equal(
    new Set([...foundationIds, ...semanticIds, ...positiveIds]).size,
    377,
  );
  assert.deepEqual(
    allEvidenceEntries
      .filter(({ astSha256 }) => astSha256 === null)
      .map(({ id, astNodeCount, expectedStage }) => ({
        id,
        astNodeCount,
        expectedStage,
      })),
    [
      {
        id: "FOUNDATION-N008",
        astNodeCount: null,
        expectedStage: "parse",
      },
    ],
  );
  for (const entry of allEvidenceEntries.filter(
    ({ astSha256 }) => astSha256 !== null,
  )) {
    assert.match(entry.astSha256, /^[0-9a-f]{64}$/u, entry.id);
    assert.equal(entry.astNodeCount > 0, true, entry.id);
  }
  assert.deepEqual(
    allEvidenceEntries.map(
      ({
        id,
        sourceSha256,
        astSha256,
        astNodeCount,
        expectedStage,
        expectedError,
      }) => ({
        id,
        sourceSha256,
        astSha256,
        astNodeCount,
        expectedStage,
        expectedError,
      }),
    ),
    [
      ...FOUNDATION_CONTROL_EXPECTATION_PINS,
      ...SEMANTIC_CONTROL_EXPECTATION_PINS,
      ...POSITIVE_CONTROL_EXPECTATION_PINS,
    ],
  );
  assert.deepEqual(
    semanticEntries.map(({ id, bucket }) => ({ id, bucket })),
    SEMANTIC_BUCKET_BY_ORDINAL.map((bucket, index) => ({
      id: staticControlId("SEM-N", index),
      bucket,
    })),
  );
  assert.deepEqual(
    evidenceManifest.bucketProjection.map(
      ({ bucket, target, current, remaining }) => ({
        bucket,
        target,
        current,
        remaining,
      }),
    ),
    [
      { bucket: "protectedAliases", target: 12, current: 12, remaining: 0 },
      { bucket: "indirectCalls", target: 12, current: 12, remaining: 0 },
      { bucket: "reflectComputed", target: 12, current: 12, remaining: 0 },
      {
        bucket: "bindingMemberWrites",
        target: 14,
        current: 14,
        remaining: 0,
      },
      { bucket: "untrustedSinks", target: 24, current: 24, remaining: 0 },
      { bucket: "rawEscapes", target: 12, current: 12, remaining: 0 },
      { bucket: "literalMisuse", target: 14, current: 14, remaining: 0 },
      { bucket: "scopeJoins", target: 18, current: 18, remaining: 0 },
      { bucket: "nestedRecursion", target: 12, current: 12, remaining: 0 },
      { bucket: "commitMutations", target: 200, current: 167, remaining: 33 },
    ],
  );
  const bucketIds = evidenceManifest.bucketProjection.flatMap(
    ({ controlIds }) => controlIds,
  );
  assert.equal(bucketIds.length, 297);
  assert.equal(new Set(bucketIds).size, 297);
  assert.deepEqual([...bucketIds].sort(), [...semanticIds].sort());
  for (const { bucket, controlIds } of evidenceManifest.bucketProjection) {
    assert.deepEqual(
      controlIds,
      semanticEntries
        .filter((entry) => entry.bucket === bucket)
        .map(({ id }) => id),
    );
  }
  assert.deepEqual(evidenceManifest.commitMutationIds, COMMIT_MUTATION_IDS);
  assert.deepEqual(
    semanticEntries
      .filter(({ bucket }) => bucket === "commitMutations")
      .map(({ id }) => id),
    COMMIT_MUTATION_IDS,
  );
  assert.equal(
    evidenceManifest.commitMutationIds.every((id) => semanticIds.has(id)),
    true,
  );
  assert.deepEqual(
    ["SEM-N017", "SEM-N019", "SEM-N038", "SEM-N043", "SEM-N047"].map((id) => {
      const { name, bucket } = semanticEntries.find((entry) => entry.id === id);
      return { id, name, bucket };
    }),
    [
      {
        id: "SEM-N017",
        name: "function-scoped Reflect alias",
        bucket: "protectedAliases",
      },
      {
        id: "SEM-N019",
        name: "direct internal exported-operation call",
        bucket: "protectedAliases",
      },
      {
        id: "SEM-N038",
        name: "parenthesized owning private-store callee",
        bucket: "commitMutations",
      },
      {
        id: "SEM-N043",
        name: "shallow ambient freeze used as deep freeze",
        bucket: "untrustedSinks",
      },
      {
        id: "SEM-N047",
        name: "nonthrowing imported failure callback",
        bucket: "scopeJoins",
      },
    ],
  );
  assert.deepEqual(evidenceManifest.counts, {
    foundationNegatives: 69,
    semanticNegatives: 297,
    allCurrentNegatives: 366,
    semanticTargetNegatives: 330,
    semanticRemainingNegatives: 33,
    allLayerTargetNegatives: 399,
    positiveCurrent: 11,
    positiveTarget: 11,
    positiveRemaining: 0,
    commitCurrent: 167,
    commitTarget: 200,
    commitRemaining: 33,
    evaluationAttempts: 0,
  });
  assert.equal(366, 69 + 297);
  assert.equal(399, 69 + 330);
  assert.equal(33, 330 - 297);
  assert.equal(0, 11 - 11);
  assert.equal(33, 200 - 167);
  assert.equal(STATIC_NEGATIVE_CONTROLS.evaluationAttempts, 0);
  assert.deepEqual(
    evidenceManifest.aggregates,
    EXPECTED_STATIC_EVIDENCE_AGGREGATES,
  );
  assert.equal(
    semanticSha256(evidenceManifest.schema),
    EXPECTED_STATIC_EVIDENCE_AGGREGATES.schemaSha256,
  );
  assert.equal(
    semanticSha256(staticControlIdentityProjection(allEvidenceEntries)),
    EXPECTED_STATIC_EVIDENCE_AGGREGATES.orderedControlIdentityProjectionSha256,
  );
  assert.equal(
    semanticSha256(staticControlIdentityProjection(semanticEntries)),
    EXPECTED_STATIC_EVIDENCE_AGGREGATES.orderedSemanticProjectionSha256,
  );
  assert.equal(
    semanticSha256(evidenceManifest.bucketProjection),
    EXPECTED_STATIC_EVIDENCE_AGGREGATES.bucketProjectionSha256,
  );
  assert.equal(
    semanticSha256(foundationEntries.map(({ id, name }) => ({ id, name }))),
    EXPECTED_STATIC_EVIDENCE_AGGREGATES.foundationNameProjectionSha256,
  );
  assert.equal(
    semanticSha256(positiveEntries.map(({ id, name }) => ({ id, name }))),
    EXPECTED_STATIC_EVIDENCE_AGGREGATES.positiveNameProjectionSha256,
  );
  assert.equal(
    semanticSha256(evidenceManifest.commitMutationIds),
    EXPECTED_STATIC_EVIDENCE_AGGREGATES.commitIdProjectionSha256,
  );
  assertRecursivelyFrozenWithoutByteViews(privateLookupManifest);
  assert.deepEqual(Object.keys(privateLookupManifest), [
    "schema",
    "methods",
    "authorizedPairs",
    "positiveControlIds",
    "observedOperations",
    "counts",
    "orderedAuthorizedPairProjectionSha256",
    "orderedObservedOperationProjectionSha256",
  ]);
  assert.equal(privateLookupManifest.schema, PRIVATE_LOOKUP_EVIDENCE_SCHEMA);
  assert.deepEqual(privateLookupManifest.methods, ["has", "get"]);
  assert.deepEqual(
    privateLookupManifest.authorizedPairs,
    EXPECTED_PRIVATE_STORE_LOOKUPS,
  );
  assert.deepEqual(privateLookupManifest.counts, {
    authorizedPairs: 11,
    methods: 2,
    expectedOperations: 22,
    observedOperations: 22,
  });
  assert.deepEqual(
    privateLookupManifest.positiveControlIds,
    Array.from({ length: 6 }, (_, index) =>
      staticControlId("POS-P", index + 5),
    ),
  );
  assert.equal(
    new Set(
      privateLookupManifest.observedOperations.map((entry) =>
        canonicalJson(entry),
      ),
    ).size,
    22,
  );
  assert.deepEqual(
    privateLookupManifest.positiveControlIds.map(
      (controlId) =>
        privateLookupManifest.observedOperations.filter(
          (entry) => entry.controlId === controlId,
        ).length,
    ),
    [2, 2, 2, 12, 2, 2],
  );
  assert.deepEqual(
    Object.fromEntries(
      ["startupMetadata", "stateMetadata", "inputMetadata"].map((storeName) => [
        storeName,
        privateLookupManifest.authorizedPairs.filter(
          (entry) => entry.storeName === storeName,
        ).length,
      ]),
    ),
    { startupMetadata: 2, stateMetadata: 8, inputMetadata: 1 },
  );
  assert.equal(
    privateLookupManifest.authorizedPairs.some(
      ({ functionName }) =>
        functionName === "createCandidateContainmentGuardianStartupV1" ||
        functionName === "probeStartupBrand",
    ),
    false,
  );
  assert.equal(
    semanticSha256(privateLookupManifest.schema),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.schemaSha256,
  );
  assert.equal(
    semanticSha256(privateLookupManifest.methods),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.methodsSha256,
  );
  assert.equal(
    semanticSha256(privateLookupManifest.authorizedPairs),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.orderedAuthorizedPairProjectionSha256,
  );
  assert.equal(
    semanticSha256(privateLookupManifest.observedOperations),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.orderedObservedOperationProjectionSha256,
  );
  assert.equal(
    privateLookupManifest.orderedAuthorizedPairProjectionSha256,
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.orderedAuthorizedPairProjectionSha256,
  );
  assert.equal(
    privateLookupManifest.orderedObservedOperationProjectionSha256,
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.orderedObservedOperationProjectionSha256,
  );
  const privateLookupReceiptWithoutProjectionHashes = Object.fromEntries(
    Object.entries(privateLookupManifest).filter(
      ([key]) =>
        ![
          "orderedAuthorizedPairProjectionSha256",
          "orderedObservedOperationProjectionSha256",
        ].includes(key),
    ),
  );
  assert.equal(
    semanticSha256(privateLookupReceiptWithoutProjectionHashes),
    EXPECTED_PRIVATE_LOOKUP_EVIDENCE_PINS.receiptWithoutProjectionHashesSha256,
  );
  const preCalleeReceiverEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 60),
    ...positiveEntries,
  ];
  const newCalleeReceiverEntries = semanticEntries.slice(60, 82);
  const preCalleeReceiverSourceHashes = new Set(
    preCalleeReceiverEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preCalleeReceiverAstHashes = new Set(
    preCalleeReceiverEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(newCalleeReceiverEntries.length, 22);
  assert.deepEqual(
    newCalleeReceiverEntries.map(({ id, bucket }) => ({ id, bucket })),
    [
      ...Array.from({ length: 11 }, (_, index) => ({
        id: staticControlId("SEM-N", index + 60),
        bucket: "indirectCalls",
      })),
      ...Array.from({ length: 11 }, (_, index) => ({
        id: staticControlId("SEM-N", index + 71),
        bucket: "reflectComputed",
      })),
    ],
  );
  assert.equal(
    new Set(newCalleeReceiverEntries.map(({ sourceSha256 }) => sourceSha256))
      .size,
    22,
  );
  assert.equal(
    new Set(newCalleeReceiverEntries.map(({ astSha256 }) => astSha256)).size,
    22,
  );
  assert.equal(
    newCalleeReceiverEntries.some(({ sourceSha256 }) =>
      preCalleeReceiverSourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    newCalleeReceiverEntries.some(({ astSha256 }) =>
      preCalleeReceiverAstHashes.has(astSha256),
    ),
    false,
  );
  assert.equal(
    newCalleeReceiverEntries.every(
      ({ expectedStage }) => expectedStage === "estree-policy",
    ),
    true,
  );
  const preBindingWriteEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 82),
    ...positiveEntries,
  ];
  const newBindingWriteEntries = semanticEntries.slice(82, 92);
  const preBindingWriteSourceHashes = new Set(
    preBindingWriteEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preBindingWriteAstHashes = new Set(
    preBindingWriteEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(newBindingWriteEntries.length, 10);
  assert.deepEqual(
    newBindingWriteEntries.map(({ id, bucket }) => ({ id, bucket })),
    Array.from({ length: 10 }, (_, index) => ({
      id: staticControlId("SEM-N", index + 82),
      bucket: "bindingMemberWrites",
    })),
  );
  assert.equal(
    new Set(newBindingWriteEntries.map(({ sourceSha256 }) => sourceSha256))
      .size,
    10,
  );
  assert.equal(
    new Set(newBindingWriteEntries.map(({ astSha256 }) => astSha256)).size,
    10,
  );
  assert.equal(
    newBindingWriteEntries.some(({ sourceSha256 }) =>
      preBindingWriteSourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    newBindingWriteEntries.some(({ astSha256 }) =>
      preBindingWriteAstHashes.has(astSha256),
    ),
    false,
  );
  assert.deepEqual(
    newBindingWriteEntries
      .filter(({ expectedStage }) => expectedStage !== "estree-policy")
      .map(({ id, name, expectedStage, expectedError }) => ({
        id,
        name,
        expectedStage,
        expectedError,
      })),
    [
      {
        id: "SEM-N086",
        name: "ambient intrinsic member assignment",
        expectedStage: "identifier-closure",
        expectedError: "static gate: ambient member Object.length",
      },
    ],
  );
  assert.equal(
    newBindingWriteEntries.filter(
      ({ expectedStage, expectedError }) =>
        expectedStage === "estree-policy" &&
        expectedError === "static gate: ESTree binding or member assignment",
    ).length,
    9,
  );
  const bindingWriteMutationCoverage = Object.freeze([
    Object.freeze({
      mutation: "local alias binding and member writes",
      coveredBy: Object.freeze(["SEM-N083", "SEM-N084"]),
    }),
    Object.freeze({
      mutation: "ambient binding and member writes",
      coveredBy: Object.freeze(["SEM-N085", "SEM-N086"]),
    }),
    Object.freeze({
      mutation: "imported binding and member writes",
      coveredBy: Object.freeze(["SEM-N087", "SEM-N088"]),
    }),
    Object.freeze({
      mutation: "exported operation binding and member writes",
      coveredBy: Object.freeze(["SEM-N089", "SEM-N090"]),
    }),
    Object.freeze({
      mutation: "exported value binding and member writes",
      coveredBy: Object.freeze(["SEM-N091", "SEM-N092"]),
    }),
  ]);
  const bindingWriteMutationControlIds = bindingWriteMutationCoverage.flatMap(
    ({ coveredBy }) => coveredBy,
  );
  assert.deepEqual(
    bindingWriteMutationControlIds,
    newBindingWriteEntries.map(({ id }) => id),
  );
  assert.equal(new Set(bindingWriteMutationControlIds).size, 10);
  const preTaintBoundaryEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 92),
    ...positiveEntries,
  ];
  const newTaintBoundaryEntries = semanticEntries.slice(92, 114);
  const preTaintBoundarySourceHashes = new Set(
    preTaintBoundaryEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preTaintBoundaryAstHashes = new Set(
    preTaintBoundaryEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(newTaintBoundaryEntries.length, 22);
  assert.deepEqual(
    newTaintBoundaryEntries.map(({ id, bucket }) => ({ id, bucket })),
    [
      ...Array.from({ length: 15 }, (_, index) => ({
        id: staticControlId("SEM-N", index + 92),
        bucket: "untrustedSinks",
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        id: staticControlId("SEM-N", index + 107),
        bucket: "rawEscapes",
      })),
    ],
  );
  assert.equal(
    new Set(newTaintBoundaryEntries.map(({ sourceSha256 }) => sourceSha256))
      .size,
    22,
  );
  assert.equal(
    new Set(newTaintBoundaryEntries.map(({ astSha256 }) => astSha256)).size,
    22,
  );
  assert.equal(
    newTaintBoundaryEntries.some(({ sourceSha256 }) =>
      preTaintBoundarySourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    newTaintBoundaryEntries.some(({ astSha256 }) =>
      preTaintBoundaryAstHashes.has(astSha256),
    ),
    false,
  );
  assert.equal(
    newTaintBoundaryEntries.every(
      ({ expectedStage }) => expectedStage === "estree-policy",
    ),
    true,
  );
  assert.equal(
    newTaintBoundaryEntries
      .slice(0, 15)
      .every(({ expectedError }) =>
        expectedError.startsWith("static gate: ESTree raw or unknown value "),
      ),
    true,
  );
  assert.equal(
    newTaintBoundaryEntries
      .slice(15)
      .every(
        ({ expectedError }) =>
          expectedError ===
          "static gate: ESTree raw or unknown value returned from function",
      ),
    true,
  );
  const taintBoundaryMutationCoverage = Object.freeze([
    Object.freeze({
      mutation: "trusted-sink call arguments accept raw or unknown values",
      coveredBy: Object.freeze([
        "SEM-N093",
        "SEM-N094",
        "SEM-N095",
        "SEM-N096",
        "SEM-N097",
        "SEM-N098",
        "SEM-N099",
      ]),
    }),
    Object.freeze({
      mutation: "member calls and receivers accept raw or unknown values",
      coveredBy: Object.freeze(["SEM-N100", "SEM-N101", "SEM-N102"]),
    }),
    Object.freeze({
      mutation: "operators, branches, and throws accept raw values",
      coveredBy: Object.freeze([
        "SEM-N103",
        "SEM-N104",
        "SEM-N105",
        "SEM-N106",
        "SEM-N107",
      ]),
    }),
    Object.freeze({
      mutation: "aliases and aggregate graphs escape raw values",
      coveredBy: Object.freeze(["SEM-N108", "SEM-N109", "SEM-N110"]),
    }),
    Object.freeze({
      mutation: "helper and private-read results escape without freezing",
      coveredBy: Object.freeze([
        "SEM-N111",
        "SEM-N112",
        "SEM-N113",
        "SEM-N114",
      ]),
    }),
  ]);
  const taintBoundaryMutationControlIds = taintBoundaryMutationCoverage.flatMap(
    ({ coveredBy }) => coveredBy,
  );
  assert.deepEqual(
    taintBoundaryMutationControlIds,
    newTaintBoundaryEntries.map(({ id }) => id),
  );
  assert.equal(new Set(taintBoundaryMutationControlIds).size, 22);
  const preLiteralPathEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 114),
    ...positiveEntries,
  ];
  const newLiteralPathEntries = semanticEntries.slice(114, 124);
  const preLiteralPathSourceHashes = new Set(
    preLiteralPathEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preLiteralPathAstHashes = new Set(
    preLiteralPathEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(newLiteralPathEntries.length, 10);
  assert.deepEqual(
    newLiteralPathEntries.map(({ id, bucket }) => ({ id, bucket })),
    Array.from({ length: 10 }, (_, index) => ({
      id: staticControlId("SEM-N", index + 114),
      bucket: "literalMisuse",
    })),
  );
  assert.equal(
    new Set(newLiteralPathEntries.map(({ sourceSha256 }) => sourceSha256)).size,
    10,
  );
  assert.equal(
    new Set(newLiteralPathEntries.map(({ astSha256 }) => astSha256)).size,
    10,
  );
  assert.equal(
    newLiteralPathEntries.some(({ sourceSha256 }) =>
      preLiteralPathSourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    newLiteralPathEntries.some(({ astSha256 }) =>
      preLiteralPathAstHashes.has(astSha256),
    ),
    false,
  );
  assert.equal(
    newLiteralPathEntries.every(
      ({ expectedStage }) => expectedStage === "estree-policy",
    ),
    true,
  );
  assert.equal(
    newLiteralPathEntries
      .slice(0, 8)
      .every(
        ({ expectedError }) =>
          expectedError ===
          "static gate: ESTree capability-looking constructed literal outside normative role processAuthority",
      ),
    true,
  );
  assert.equal(
    newLiteralPathEntries[8].expectedError,
    "static gate: ESTree capability-looking normative literal returned from function processAuthority",
  );
  assert.equal(
    newLiteralPathEntries[9].expectedError,
    "static gate: ESTree capability-looking normative literal passed to sha256 processAuthority",
  );
  const literalPathMutationCoverage = Object.freeze([
    Object.freeze({
      mutation:
        "ambient String coercion and nested fragments evade direct-literal checks",
      coveredBy: Object.freeze(["SEM-N115", "SEM-N116"]),
    }),
    Object.freeze({
      mutation: "local and module aliases erase literal-fragment provenance",
      coveredBy: Object.freeze(["SEM-N117", "SEM-N118"]),
    }),
    Object.freeze({
      mutation: "conditional and logical joins erase literal fragments",
      coveredBy: Object.freeze(["SEM-N119", "SEM-N120", "SEM-N121"]),
    }),
    Object.freeze({
      mutation: "local function returns erase literal-fragment provenance",
      coveredBy: Object.freeze(["SEM-N122"]),
    }),
    Object.freeze({
      mutation:
        "factored requirements dependencies escape their normative path",
      coveredBy: Object.freeze(["SEM-N123", "SEM-N124"]),
    }),
  ]);
  const literalPathMutationControlIds = literalPathMutationCoverage.flatMap(
    ({ coveredBy }) => coveredBy,
  );
  assert.deepEqual(
    literalPathMutationControlIds,
    newLiteralPathEntries.map(({ id }) => id),
  );
  assert.equal(new Set(literalPathMutationControlIds).size, 10);
  const preControlFlowEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 124),
    ...positiveEntries,
  ];
  const newControlFlowEntries = semanticEntries.slice(124, 147);
  const preControlFlowSourceHashes = new Set(
    preControlFlowEntries.map(({ sourceSha256 }) => sourceSha256),
  );
  const preControlFlowAstHashes = new Set(
    preControlFlowEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(newControlFlowEntries.length, 23);
  assert.deepEqual(
    newControlFlowEntries.map(({ id, bucket }) => ({ id, bucket })),
    [
      ...Array.from({ length: 14 }, (_, index) => ({
        id: staticControlId("SEM-N", index + 124),
        bucket: "scopeJoins",
      })),
      ...Array.from({ length: 9 }, (_, index) => ({
        id: staticControlId("SEM-N", index + 138),
        bucket: "nestedRecursion",
      })),
    ],
  );
  assert.equal(
    new Set(newControlFlowEntries.map(({ sourceSha256 }) => sourceSha256)).size,
    23,
  );
  assert.equal(
    new Set(newControlFlowEntries.map(({ astSha256 }) => astSha256)).size,
    23,
  );
  assert.equal(
    newControlFlowEntries.some(({ sourceSha256 }) =>
      preControlFlowSourceHashes.has(sourceSha256),
    ),
    false,
  );
  assert.equal(
    newControlFlowEntries.some(({ astSha256 }) =>
      preControlFlowAstHashes.has(astSha256),
    ),
    false,
  );
  assert.equal(
    newControlFlowEntries.every(
      ({ expectedStage }) => expectedStage === "estree-policy",
    ),
    true,
  );
  const controlFlowMutationCoverage = Object.freeze([
    Object.freeze({
      mutation: "distinct expression origins merge without a provenance join",
      coveredBy: Object.freeze([
        "SEM-N125",
        "SEM-N126",
        "SEM-N127",
        "SEM-N128",
      ]),
    }),
    Object.freeze({
      mutation: "multi-return and loop origins merge without a provenance join",
      coveredBy: Object.freeze(["SEM-N129", "SEM-N130", "SEM-N131"]),
    }),
    Object.freeze({
      mutation: "conditional and loop fallthrough is treated as a return",
      coveredBy: Object.freeze([
        "SEM-N132",
        "SEM-N133",
        "SEM-N134",
        "SEM-N135",
      ]),
    }),
    Object.freeze({
      mutation: "callee, callback, or private-owner completion is not proved",
      coveredBy: Object.freeze(["SEM-N136", "SEM-N137", "SEM-N138"]),
    }),
    Object.freeze({
      mutation: "ordinary control-flow SCCs are not rejected",
      coveredBy: Object.freeze([
        "SEM-N139",
        "SEM-N140",
        "SEM-N141",
        "SEM-N142",
      ]),
    }),
    Object.freeze({
      mutation: "failure-callback edges are omitted from SCC detection",
      coveredBy: Object.freeze(["SEM-N143", "SEM-N144", "SEM-N145"]),
    }),
    Object.freeze({
      mutation: "unreachable call edges are omitted from SCC detection",
      coveredBy: Object.freeze(["SEM-N146", "SEM-N147"]),
    }),
  ]);
  const controlFlowMutationControlIds = controlFlowMutationCoverage.flatMap(
    ({ coveredBy }) => coveredBy,
  );
  assert.deepEqual(
    controlFlowMutationControlIds,
    newControlFlowEntries.map(({ id }) => id),
  );
  assert.equal(new Set(controlFlowMutationControlIds).size, 23);
  const acceptedControlFlowVariations = Object.freeze([
    sourceSkeleton(
      "function sameOriginJoin() { const value = deepFreeze([]); return true ? value : value; }",
    ),
    sourceSkeleton(
      "function completeBranches() { if (true) { return null; } else { return null; } }",
    ),
    sourceSkeleton(
      "function completeLoop() { const values = deepFreeze([null]); for (const value of values) { return null; } return null; }",
    ),
    sourceSkeleton(
      "function acyclicLeaf() { return null; } function acyclicRoot() { return acyclicLeaf(); }",
    ),
    sourceSkeleton(
      'function pinnedFailure() { throw new Error("CONTROL_SHAPE"); } function normalizedValue(value) { return exactBoolean(value, true, "value", pinnedFailure); }',
    ),
  ]);
  for (const source of acceptedControlFlowVariations) {
    assert.doesNotThrow(() => auditCandidateSource(source));
  }
  const preLookupEntries = [
    ...foundationEntries,
    ...semanticEntries.slice(0, 48),
    ...positiveEntries.slice(0, 5),
  ];
  const newLookupEntries = [
    ...semanticEntries.slice(48, 60),
    ...positiveEntries.slice(5),
  ];
  const preLookupAstHashes = new Set(
    preLookupEntries
      .map(({ astSha256 }) => astSha256)
      .filter((astSha256) => astSha256 !== null),
  );
  assert.equal(newLookupEntries.length, 18);
  assert.equal(
    new Set(newLookupEntries.map(({ astSha256 }) => astSha256)).size,
    18,
  );
  assert.equal(
    newLookupEntries.some(({ astSha256 }) => preLookupAstHashes.has(astSha256)),
    false,
  );
  const privateLookupMutationCoverage = [
    { mutation: "permissive local owner", coveredBy: ["SEM-N049"] },
    {
      mutation: "commit and read ownership conflation",
      coveredBy: ["SEM-N050", "SEM-N053"],
    },
    {
      mutation: "wrong store authorization",
      coveredBy: ["SEM-N051", "SEM-N052"],
    },
    {
      mutation: "wrong parameter authorization",
      coveredBy: ["SEM-N055", "SEM-N056"],
    },
    {
      mutation: "function-local key authorization",
      coveredBy: ["SEM-N054"],
    },
    {
      mutation: "weakened private-read provenance",
      coveredBy: ["SEM-N057", "SEM-N058", "SEM-N059", "SEM-N060"],
    },
  ];
  assert.equal(
    privateLookupMutationCoverage.every(({ coveredBy }) =>
      coveredBy.every((id) => semanticIds.has(id)),
    ),
    true,
  );
  assert.throws(
    () =>
      auditCandidateSource(
        sourceSkeleton(
          "",
          new Map([
            [
              "verifyCandidateContainmentGuardianStatusFrameV1",
              "{ const startupProjection = deepFreeze(nullRecord([])); const observed = startupMetadata.get(startupProjection); } return null;",
            ],
          ]),
        ),
      ),
    {
      message:
        "static gate: ESTree private lookup key verifyCandidateContainmentGuardianStatusFrameV1:startupMetadata.get:startupProjection",
    },
  );
  const immutableHasProbe = auditCandidateSource(
    sourceSkeleton(
      "",
      new Map([
        [
          "verifyCandidateContainmentGuardianStatusFrameV1",
          "return startupMetadata.has(startupProjection);",
        ],
      ]),
    ),
  );
  assert.deepEqual(immutableHasProbe.astPolicy.privateLookupOperations, [
    {
      functionName: "verifyCandidateContainmentGuardianStatusFrameV1",
      storeName: "startupMetadata",
      method: "has",
      keyParameterName: "startupProjection",
    },
  ]);
  assert.deepEqual(immutableHasProbe.astPolicy.privateLookupResultPolicies, [
    {
      functionName: "verifyCandidateContainmentGuardianStatusFrameV1",
      storeName: "startupMetadata",
      method: "has",
      keyParameterName: "startupProjection",
      kind: "immutable",
      freezable: true,
      tainted: false,
    },
  ]);
  const privateGetProbe = auditCandidateSource(
    sourceSkeleton(
      "",
      new Map([
        [
          "verifyCandidateContainmentGuardianStatusFrameV1",
          "const observed = startupMetadata.get(startupProjection); return null;",
        ],
      ]),
    ),
  );
  assert.deepEqual(privateGetProbe.astPolicy.privateLookupResultPolicies, [
    {
      functionName: "verifyCandidateContainmentGuardianStatusFrameV1",
      storeName: "startupMetadata",
      method: "get",
      keyParameterName: "startupProjection",
      kind: "private-read",
      freezable: false,
      tainted: true,
    },
  ]);
  assert.throws(
    () =>
      auditCandidateSource(
        sourceSkeleton(
          "",
          new Map([
            [
              "verifyCandidateContainmentGuardianStatusFrameV1",
              "return startupMetadata.has(deepFreeze(nullRecord([])));",
            ],
          ]),
        ),
      ),
    {
      message:
        "static gate: ESTree private lookup key verifyCandidateContainmentGuardianStatusFrameV1:startupMetadata.has:<CallExpression>",
    },
  );
  assert.deepEqual(STATIC_ESTREE_SUBSET_EVIDENCE, {
    sourceIndependentNegativeControls: 366,
    acceptedSyntheticSources: 11,
    layeredStaticNegativeEvidence: {
      totalDeltaSinceParserFoundation: 297,
      estreePolicyReachedCount: 294,
      preEstreePolicyRejectionCount: 3,
      preEstreePolicyRejectionNames: [
        "requirements initializer semantic drift",
        "shallow ambient freeze used as deep freeze",
        "ambient intrinsic member assignment",
      ],
    },
    representativeCommitMutationSourceInventory: 167,
    finalRequiredNegativeControls: 330,
    finalRequiredPositiveControls: 11,
    fullSemanticGateClosed: false,
    nonclaims: [
      "the final 330-negative and 11-positive AST/dataflow matrix is not complete",
      "the 167 current commit mutation sources are partial, not final 200-mutation closure",
      "private-store lookup evidence proves only the exact static owner, store, method, and key-parameter policy",
      "failure callbacks are accepted only as exact zero-parameter pinned-code throwers",
      "candidate evaluation and candidate-connected runtime acceptance remain disabled",
    ],
  });
  const baselineAudit = auditCandidateSource(sourceSkeleton());
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(baselineAudit).filter(([key]) =>
        [
          "importCount",
          "importedNameCount",
          "exportCount",
          "privateStoreCount",
        ].includes(key),
      ),
    ),
    {
      importCount: 3,
      importedNameCount: 23,
      exportCount: 13,
      privateStoreCount: 3,
    },
  );
  assert.deepEqual(baselineAudit.astPolicy, {
    classifiedNodeCount: 1_149,
    bindingCount: 84,
    referenceCount: 84,
    callCount: 54,
    calleeCount: 54,
    memberCount: 10,
    receiverCount: 10,
    literalCount: 561,
    mutationCount: 10,
    joinCount: 0,
    rawEscapeCount: 0,
    unknownProvenanceCount: 0,
    privateOperationCount: 10,
    privateCommitCount: 10,
    privateDominatedCallCount: 40,
    privateOwnerReturnCount: 10,
    moduleCallEdgeCount: 0,
    privateStoreCommitCounts: {
      startupMetadata: 1,
      inputMetadata: 7,
      stateMetadata: 2,
    },
    privateStoreCommitManifest: EXPECTED_PRIVATE_STORE_COMMITS,
    privateLookupOperations: [],
    privateLookupResultPolicies: [],
    moduleCallEdges: [],
    nodeRoleCount: 1_149,
  });
  assert.equal(
    baselineAudit.astPolicy.classifiedNodeCount,
    baselineAudit.astNodeCount,
  );
  let sourcePresentEvaluationAttempts = 0;
  assert.throws(
    () =>
      evaluateCandidateOnlyWhenEvaluatorCloses(sourceSkeleton(), () => {
        sourcePresentEvaluationAttempts += 1;
      }),
    /evaluation disabled until the complete evaluator matrix is executable/gu,
  );
  assert.equal(sourcePresentEvaluationAttempts, 0);
});

test("recognizes only exact absent-candidate module-load failures", () => {
  const urlShape = Object.freeze({
    code: "ERR_MODULE_NOT_FOUND",
    message: "URL-bearing runtimes use the authoritative URL field",
    url: SOURCE_URL.href,
  });
  const node20Shape = Object.freeze({
    code: "ERR_MODULE_NOT_FOUND",
    message: NODE_20_0_MISSING_CANDIDATE_MESSAGE,
  });
  assert.equal(isExpectedAbsentCandidateModuleError(urlShape, null), true);
  assert.equal(isExpectedAbsentCandidateModuleError(node20Shape, null), true);

  const negativeControls = Object.freeze([
    Object.freeze({
      name: "source text is present",
      error: urlShape,
      sourceText: "export const present = true;",
    }),
    Object.freeze({
      name: "wrong error code",
      error: Object.freeze({
        ...node20Shape,
        code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "wrong candidate path",
      error: Object.freeze({
        ...node20Shape,
        message: `Cannot find module '${SOURCE_PATH}.other' imported from ${EVALUATOR_PATH}`,
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "wrong importer",
      error: Object.freeze({
        ...node20Shape,
        message: `Cannot find module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}.other`,
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "wrong message",
      error: Object.freeze({
        ...node20Shape,
        message: `Cannot load module '${SOURCE_PATH}' imported from ${EVALUATOR_PATH}`,
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "message suffix",
      error: Object.freeze({
        ...node20Shape,
        message: `${NODE_20_0_MISSING_CANDIDATE_MESSAGE}\nextra`,
      }),
      sourceText: null,
    }),
    Object.freeze({
      name: "wrong URL",
      error: Object.freeze({ ...urlShape, url: `${SOURCE_URL.href}.other` }),
      sourceText: null,
    }),
    Object.freeze({
      name: "non-undefined URL cannot use the message fallback",
      error: Object.freeze({ ...node20Shape, url: null }),
      sourceText: null,
    }),
  ]);
  for (const {
    name,
    error,
    sourceText: syntheticSourceText,
  } of negativeControls) {
    assert.equal(
      isExpectedAbsentCandidateModuleError(error, syntheticSourceText),
      false,
      name,
    );
  }
  assert.equal(negativeControls.length, 8);
});

test("loads the candidate once and freezes its exact module contract", () => {
  if (candidateSourceGateError !== null) throw candidateSourceGateError;
  if (candidateImportError !== null) throw candidateImportError;
  assert.notEqual(candidate, null);
  assertCandidateModuleContract(candidate);
});

test(
  "expand 20 exact whole-transition and state goldens",
  { todo: true },
  () => {},
);
test("expand 15 independently encoded emitted-status byte goldens", () => {
  assert.equal(
    typeof adversarialModule.createSourceIndependentMaterializedStatusOracle,
    "function",
  );
  const oracle = SOURCE_INDEPENDENT_MATERIALIZED_STATUS_ORACLE;
  const separatelyAllocatedOracle =
    adversarialModule.createSourceIndependentMaterializedStatusOracle(
      JSON.parse(JSON.stringify(REQUIREMENTS_ORACLE)),
    );
  assert.deepEqual(separatelyAllocatedOracle, oracle);
  assert.equal(
    countSharedNonPrimitiveObjectReferences(oracle, separatelyAllocatedOracle),
    0,
  );
  assert.equal(
    collectNonPrimitiveObjectReferences(separatelyAllocatedOracle).size,
    collectNonPrimitiveObjectReferences(oracle).size,
  );
  assertRecursivelyFrozenWithoutByteViews(oracle);
  assertRecursivelyFrozenWithoutByteViews(separatelyAllocatedOracle);
  assert.equal(
    oracle.schema,
    "oxigraph.test.candidate-containment-guardian-control-v1-materialized-status-oracle/v1",
  );
  assert.equal(oracle.requirementsSha256, EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(
    oracle.constructionContextSha256,
    EXPECTED_MATERIALIZED_STATUS_CONTEXT_SHA256,
  );
  assert.equal(
    oracle.constructionContext.identitySha256,
    EXPECTED_MATERIALIZED_STATUS_CONTEXT_SHA256,
  );
  assert.deepEqual(
    oracle.statusFrameFields,
    EXPECTED_MATERIALIZED_STATUS_FRAME_FIELDS,
  );
  assert.deepEqual(oracle.counts, {
    emittedStatusByteGoldens: 15,
    atomicTwoStatusWirePrefixes: 4,
  });
  assert.deepEqual(
    oracle.inventorySha256,
    EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256,
  );
  assert.deepEqual(
    oracle.designProjectionSha256,
    EXPECTED_MATERIALIZED_DESIGN_PROJECTION_SHA256,
  );
  assert.deepEqual(
    oracle.statusEntryDigests,
    EXPECTED_MATERIALIZED_STATUS_ENTRY_DIGESTS,
  );
  assert.equal(
    oracle.identitySha256,
    EXPECTED_MATERIALIZED_STATUS_ORACLE_SHA256,
  );
  assert.deepEqual(oracle.reconstruction, {
    method: "independent-legalSequences-wire-simulation-and-tuple-projection",
    primaryStatusDesignRegistryConsumed: false,
    primaryStatusBuilderConsumed: false,
    primaryAtomicBuilderConsumed: false,
    primaryStatusEncoderConsumed: false,
    primaryAtomicEncoderConsumed: false,
    statusCount: 15,
    atomicCount: 4,
    statusInventorySha256:
      EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256.emittedStatusByteGoldens,
    atomicInventorySha256:
      EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256.atomicTwoStatusWirePrefixes,
    independentlyReconstructedProjectionMatches: true,
  });
  assert.deepEqual(oracle.construction, {
    fixtureDerivedStatusTopology: true,
    evaluatorOwnedConstructionContext: true,
    constructionBindingsRehashed: true,
    hashBindingPreimagesConstructed: true,
    emittedStatusBytesMaterialized: true,
    atomicConcatenatedBytesMaterialized: true,
    primaryStatusDesignRegistryConsumed: false,
    primaryAtomicDesignRegistryConsumed: false,
    brandedReducerInputsConstructed: false,
    candidateConstructorsExecuted: false,
    candidateReducerExecuted: false,
    candidateAcceptanceProved: false,
    candidateInputAccepted: false,
    contractValidInputPreimagesProved: false,
    reducerReachabilityProved: false,
    candidateModuleReadByGenerator: false,
    candidateModuleImportedByGenerator: false,
    candidateModuleEvaluatedByGenerator: false,
    candidateBehaviorExecuted: false,
    candidateStatusBytesObserved: false,
    runtimeWireEmissionProved: false,
    runtimeRegistrationProved: false,
    publicIntermediateStateInvented: false,
    physicalAuthorityProved: false,
  });
  const independentlyCountedCoverage = {
    modeCounts: { NORMAL: 0, RECOVERY_ONLY: 0 },
    bindingPartitionCounts: {
      admissionOnly: 0,
      recoveryOnly: 0,
      neither: 0,
      both: 0,
    },
    sourceSequenceMembershipCount: 0,
    uniqueRawSha256Count: new Set(
      oracle.emittedStatusByteGoldens.map(({ rawSha256 }) => rawSha256),
    ).size,
  };
  for (const entry of oracle.emittedStatusByteGoldens) {
    independentlyCountedCoverage.modeCounts[entry.frame.mode] += 1;
    const admission = entry.frame.admissionFrameSha256 !== null;
    const recovery = entry.frame.recoveryRequestFrameSha256 !== null;
    const partition = admission
      ? recovery
        ? "both"
        : "admissionOnly"
      : recovery
        ? "recoveryOnly"
        : "neither";
    independentlyCountedCoverage.bindingPartitionCounts[partition] += 1;
    independentlyCountedCoverage.sourceSequenceMembershipCount +=
      entry.sourceSequences.length;
  }
  assert.deepEqual(independentlyCountedCoverage, {
    modeCounts: { NORMAL: 12, RECOVERY_ONLY: 3 },
    bindingPartitionCounts: {
      admissionOnly: 6,
      recoveryOnly: 3,
      neither: 6,
      both: 0,
    },
    sourceSequenceMembershipCount: 23,
    uniqueRawSha256Count: 15,
  });
  assert.deepEqual(oracle.coverage, independentlyCountedCoverage);

  const bindings = Object.values(oracle.constructionContext.bindings);
  assert.equal(bindings.length, 8);
  assert.equal(new Set(bindings.map(({ id }) => id)).size, 8);
  const oracleSha256BeforeReconstructedByteMutation = semanticSha256(oracle);
  for (const binding of bindings) {
    assert.match(binding.bytesHex, /^(?:[0-9a-f]{2})+$/u);
    const reconstructedFromHex = Buffer.from(binding.bytesHex, "hex");
    const reconstructedFromPreimage =
      binding.format === "CANONICAL_JSONL"
        ? Buffer.from(binding.jsonl, "utf8")
        : Buffer.from(binding.bytesHex, "hex");
    assert.notEqual(reconstructedFromHex, reconstructedFromPreimage);
    assert.deepEqual(reconstructedFromHex, reconstructedFromPreimage);
    assert.equal(reconstructedFromHex.toString("hex"), binding.bytesHex);
    assert.equal(reconstructedFromHex.length, binding.byteLength);
    assert.equal(byteSha256(reconstructedFromHex), binding.rawSha256);
    if (binding.format === "CANONICAL_JSONL") {
      assert.equal(binding.jsonl, reconstructedFromHex.toString("utf8"));
      assert.equal(binding.jsonl.endsWith("\n"), true);
      assert.equal(binding.jsonl.slice(0, -1).includes("\n"), false);
      assert.equal(binding.jsonl.includes("\r"), false);
    } else {
      assert.equal(binding.format, "RAW_HEX");
      assert.equal(binding.jsonl, null);
    }
    const preservedHex = reconstructedFromHex.toString("hex");
    reconstructedFromPreimage[0] ^= 0xff;
    assert.notDeepEqual(reconstructedFromPreimage, reconstructedFromHex);
    assert.equal(reconstructedFromHex.toString("hex"), preservedHex);
    assert.equal(binding.bytesHex, preservedHex);
    assert.equal(byteSha256(reconstructedFromHex), binding.rawSha256);
  }
  assert.equal(
    semanticSha256(oracle),
    oracleSha256BeforeReconstructedByteMutation,
  );
  assert.deepEqual(
    oracle.inventorySha256,
    EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256,
  );

  assert.equal(oracle.emittedStatusByteGoldens.length, 15);
  assert.equal(
    new Set(oracle.emittedStatusByteGoldens.map(({ id }) => id)).size,
    15,
  );
  for (const entry of oracle.emittedStatusByteGoldens) {
    assert.deepEqual(
      Object.keys(entry.frame),
      EXPECTED_MATERIALIZED_STATUS_FRAME_FIELDS,
    );
    assert.equal(entry.frame.action, "STATUS");
    assert.equal(entry.canonicalJsonl, `${canonicalJson(entry.frame)}\n`);
    assert.equal(entry.canonicalJsonl.endsWith("\n"), true);
    assert.equal(entry.canonicalJsonl.slice(0, -1).includes("\n"), false);
    assert.equal(entry.canonicalJsonl.includes("\r"), false);
    const bytes = Buffer.from(entry.canonicalJsonl, "utf8");
    assert.equal(entry.byteLength, bytes.length);
    assert.equal(entry.frameSha256, semanticSha256(entry.frame));
    assert.equal(entry.rawSha256, byteSha256(bytes));
  }
});
test("expand 4 atomic two-status internal wire-prefix controls", () => {
  assert.equal(
    typeof adversarialModule.createSourceIndependentMaterializedStatusOracle,
    "function",
  );
  const oracle = SOURCE_INDEPENDENT_MATERIALIZED_STATUS_ORACLE;
  assert.deepEqual(oracle.atomicNegativeControls, {
    controlCount: 4,
    reversedConcatenationMismatchCount: 4,
    firstFrameOmissionMismatchCount: 4,
    secondFrameOmissionMismatchCount: 4,
    insertedDelimiterMismatchCount: 4,
  });
  assert.deepEqual(
    oracle.atomicEntryDigests,
    EXPECTED_MATERIALIZED_ATOMIC_ENTRY_DIGESTS,
  );
  assert.equal(oracle.atomicTwoStatusWirePrefixes.length, 4);
  assert.equal(
    new Set(oracle.atomicTwoStatusWirePrefixes.map(({ id }) => id)).size,
    4,
  );
  const statusById = new Map(
    oracle.emittedStatusByteGoldens.map((entry) => [entry.id, entry]),
  );
  const expectedPairs = [
    [
      "atomic-two-status-wire-prefix-00",
      "emitted-status-byte-01",
      "emitted-status-byte-02",
      1_150,
    ],
    [
      "atomic-two-status-wire-prefix-01",
      "emitted-status-byte-04",
      "emitted-status-byte-05",
      1_274,
    ],
    [
      "atomic-two-status-wire-prefix-02",
      "emitted-status-byte-06",
      "emitted-status-byte-07",
      1_154,
    ],
    [
      "atomic-two-status-wire-prefix-03",
      "emitted-status-byte-08",
      "emitted-status-byte-09",
      1_278,
    ],
  ];
  for (const [index, expected] of expectedPairs.entries()) {
    const [id, firstStatusDesignId, secondStatusDesignId, byteLength] =
      expected;
    const entry = oracle.atomicTwoStatusWirePrefixes[index];
    assert.equal(entry.id, id);
    assert.equal(entry.firstStatusDesignId, firstStatusDesignId);
    assert.equal(entry.secondStatusDesignId, secondStatusDesignId);
    const first = statusById.get(firstStatusDesignId);
    const second = statusById.get(secondStatusDesignId);
    assert.notEqual(first, undefined);
    assert.notEqual(second, undefined);
    assert.equal(entry.firstSequence, first.frame.sequence);
    assert.equal(entry.secondSequence, second.frame.sequence);
    assert.equal(entry.secondSequence, entry.firstSequence + 1);
    assert.equal(second.frame.previousFrameSha256, first.rawSha256);
    assert.equal(entry.secondPreviousFrameSha256, first.rawSha256);
    assert.equal(entry.firstRawSha256, first.rawSha256);
    assert.equal(entry.secondRawSha256, second.rawSha256);
    assert.equal(entry.firstByteLength, first.byteLength);
    assert.equal(entry.secondByteLength, second.byteLength);
    assert.equal(
      entry.concatenatedJsonl,
      `${first.canonicalJsonl}${second.canonicalJsonl}`,
    );
    const concatenatedBytes = Buffer.from(entry.concatenatedJsonl, "utf8");
    assert.equal(entry.concatenatedByteLength, byteLength);
    assert.equal(entry.concatenatedByteLength, concatenatedBytes.length);
    assert.equal(entry.concatenatedRawSha256, byteSha256(concatenatedBytes));
    for (const negativeConcatenation of [
      `${second.canonicalJsonl}${first.canonicalJsonl}`,
      second.canonicalJsonl,
      first.canonicalJsonl,
      `${first.canonicalJsonl}\n${second.canonicalJsonl}`,
    ]) {
      assert.notEqual(negativeConcatenation, entry.concatenatedJsonl);
      assert.notEqual(
        byteSha256(Buffer.from(negativeConcatenation, "utf8")),
        entry.concatenatedRawSha256,
      );
    }
    assert.equal(entry.publicIntermediateState, false);
  }
});
test(
  "expand every proper prefix and mutation of N1 through R2",
  { todo: true },
  () => {},
);
test(
  "close the remaining private-store commit-position and semantic-mutation quotas before lifting the source-presence stop",
  { todo: true },
  () => {},
);
test(
  "complete all remaining ADR-0036 acceptance groups: 252 descriptor aliases; every bound, error-precedence rule, and frame field; transition, status-byte, and prefix goldens; recovery binding; WeakMap failure atomicity; and the complete Node 20 and non-G1.7 matrix",
  { todo: true },
  () => {},
);
