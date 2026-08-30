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
  const makeValue = (
    kind,
    { freezable = true, origins = [], tainted = false } = {},
  ) =>
    Object.freeze({
      kind,
      freezable,
      origins: Object.freeze([...new Set(origins)]),
      tainted,
    });
  const IMMUTABLE_VALUE = makeValue("immutable");
  const UNTRUSTED_VALUE = makeValue("untrusted", {
    freezable: false,
    tainted: true,
  });
  const valueWithOrigin = (kind, node, children = []) =>
    makeValue(kind, {
      freezable: children.every(({ freezable }) => freezable),
      origins: [node, ...children.flatMap(({ origins }) => origins)],
      tainted: children.some(({ tainted }) => tainted),
    });
  const frozenValue = (value) =>
    makeValue("frozen", {
      freezable: value.freezable,
      origins: value.origins,
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
    return left;
  };
  const valuesAreDisjoint = (left, right) =>
    left.origins.length > 0 &&
    right.origins.length > 0 &&
    left.origins.every((origin) => !right.origins.includes(origin));

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
    return IMMUTABLE_VALUE;
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
    if (node.key.type === "Identifier") {
      markIdentifier(node.key, "property-key");
      if (capabilityLookingString(node.key.name) && !normativeKey) {
        fail(
          `capability-looking property key outside requirements ${node.key.name}`,
        );
      }
    } else if (node.key.type === "Literal") {
      visitLiteral(
        node.key,
        normativeKey ? "requirements-value" : "property-key",
      );
    } else {
      fail(`object key ${node.key.type}`);
    }
    return evaluateExpression(node.value, scope, context);
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

  const recordCallEdge = (from, to) => {
    if (from === null) fail(`module initializer called local function ${to}`);
    const edge = `${from.name}\u0000${to}`;
    if (!moduleCallEdges.has(edge)) {
      moduleCallEdges.add(edge);
      counters.moduleCallEdgeCount += 1;
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
      if (member.memberName === "has") {
        if (arguments_.length !== 1) fail("private has arity");
        return IMMUTABLE_VALUE;
      }
      if (member.memberName === "get") {
        if (arguments_.length !== 1) fail("private get arity");
        return makeValue("private-read", {
          freezable: false,
          origins: [node, ...arguments_.flatMap(({ origins }) => origins)],
          tainted: true,
        });
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
      return IMMUTABLE_VALUE;
    }
    if (node.type === "LogicalExpression") {
      mark(node, "logical-expression");
      const left = evaluateExpression(node.left, scope, context);
      requireTrusted(left, `logical ${node.operator}`);
      const right = evaluateExpression(node.right, scope, {
        ...context,
        controlDepth: (context.controlDepth ?? 0) + 1,
      });
      return joinValues(left, right, `logical ${node.operator}`);
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
    for (const statement of node.body) {
      const statementContext = functionBody
        ? {
            ...context,
            directStatement: statement,
            expressionStatement: null,
          }
        : { ...context, controlDepth: context.controlDepth + 1 };
      visitStatement(statement, blockScope, statementContext);
    }
  };

  visitStatement = (node, scope, context) => {
    if (node.type === "VariableDeclaration") {
      visitVariableDeclaration(node, scope, context);
      return;
    }
    if (node.type === "ReturnStatement") {
      mark(node, "return-statement");
      const value =
        node.argument === null
          ? IMMUTABLE_VALUE
          : evaluateExpression(node.argument, scope, context);
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
      return;
    }
    if (node.type === "ExpressionStatement") {
      mark(node, "expression-statement");
      evaluateExpression(node.expression, scope, {
        ...context,
        expressionStatement: node,
      });
      return;
    }
    if (node.type === "BlockStatement") {
      visitBlock(node, scope, context);
      return;
    }
    if (node.type === "IfStatement") {
      mark(node, "if-statement");
      const testValue = evaluateExpression(node.test, scope, context);
      requireTrusted(testValue, "if condition");
      counters.joinCount += 1;
      visitStatement(node.consequent, scope, {
        ...context,
        controlDepth: context.controlDepth + 1,
      });
      if (node.alternate !== null) {
        visitStatement(node.alternate, scope, {
          ...context,
          controlDepth: context.controlDepth + 1,
        });
      }
      return;
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
      visitStatement(node.body, loopScope, {
        ...context,
        controlDepth: context.controlDepth + 1,
      });
      return;
    }
    if (node.type === "ThrowStatement") {
      mark(node, "throw-statement");
      const value = evaluateExpression(node.argument, scope, context);
      requireTrusted(value, "thrown", { allowMutable: true });
      return;
    }
    if (node.type === "EmptyStatement") {
      mark(node, "empty-statement");
      return;
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
    for (const parameter of node.params) {
      if (parameter.type !== "Identifier") fail("non-identifier parameter");
      markIdentifier(parameter, "parameter-binding");
      declare(scope, parameter.name, {
        kind: "parameter",
        value: UNTRUSTED_VALUE,
        node: parameter,
      });
    }
    const context = {
      functionRecord: record,
      returnValues: [],
      returnStatements: [],
      controlDepth: 0,
      directStatement: null,
      expressionStatement: null,
      literalRole: "ordinary",
    };
    visitBlock(node.body, scope, context, { functionBody: true });
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
    moduleCallEdges: Object.freeze([...moduleCallEdges].sort()),
    nodeRoleCount: counters.classifiedNodeCount,
  });
}

function auditCandidateSource(source, stageAudit = null) {
  const parsed = parseCandidateModuleAst(source);
  const tokens = lexCandidateSource(source);
  assertBoundedSourceSubset(tokens);
  const imports = parseExactImports(tokens);
  const exports = parseExactExports(tokens);
  const privateStores = assertExactPrivateStoreManifest(tokens);
  const moduleStoreCount = assertModuleInitializationClosure(tokens);
  const identifierClosure = assertPositiveIdentifierClosure(
    tokens,
    imports,
    exports,
  );
  if (stageAudit !== null) stageAudit.estreePolicyReached = true;
  const astPolicy = assertRejectByDefaultEstreePolicy(
    parsed.program,
    parsed.nodeCount,
  );
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

function sourceWithImportMutation(mutate) {
  const [firstSpecifier, firstNames] = [...ALLOWED_IMPORTS][0];
  const original = `import { ${firstNames.join(", ")} } from ${JSON.stringify(firstSpecifier)};`;
  return sourceSkeleton().replace(original, mutate(original, firstNames));
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
        "function exposePrivateMetadata(key) { return deepFreeze([startupMetadata.get(key)]); }",
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
  ]);
  const sources = [
    ...imports.map((create) => create()),
    ...exports.map((create) => create()),
    ...authorityAndGadgets.map((body) => sourceSkeleton(body)),
    ...stores,
  ];
  let evaluationAttempts = 0;
  for (const source of sources) {
    assert.throws(() => {
      auditCandidateSource(source);
      evaluationAttempts += 1;
    });
  }
  const namedRejected = [];
  const namedStageAudit = [];
  for (const { name, source, expected } of namedStaticGateEscapes) {
    const stageAudit = { estreePolicyReached: false };
    assert.throws(
      () => {
        auditCandidateSource(source, stageAudit);
        evaluationAttempts += 1;
      },
      expected,
      `static policy control: ${name}`,
    );
    namedRejected.push(name);
    namedStageAudit.push(
      Object.freeze({
        name,
        estreePolicyReached: stageAudit.estreePolicyReached,
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
  ];
  for (const source of positiveSources) {
    assert.doesNotThrow(() => auditCandidateSource(source));
  }
  const layeredStartIndex = namedStageAudit.findIndex(
    ({ name }) => name === "function-scoped imported helper alias",
  );
  assert.notEqual(layeredStartIndex, -1);
  const layeredStageAudit = namedStageAudit.slice(layeredStartIndex);
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
  return Object.freeze({
    rejected: sources.length + namedRejected.length,
    namedRejected: Object.freeze(namedRejected),
    layeredStaticNegativeEvidence,
    accepted: positiveSources.length,
    namedAccepted: Object.freeze([
      "exact requirements AST normalization",
      "approved untrusted-value normalizer",
      "frozen local iteration",
      "frozen local module table",
      "pure requirements and ephemeral canonical digest initializers",
    ]),
    evaluationAttempts,
  });
}

function evaluateCandidateOnlyWhenEvaluatorCloses(source, evaluate) {
  if (source !== null) {
    auditCandidateSource(source);
    throw new Error(
      "candidate evaluation disabled until the complete evaluator matrix is executable and receiver-origin; ambient-binding/alias/member-write, computed-key, and indirect-call; path-sensitive normative key-literal representation; module/import/export-binding-write; and private-store commit-position closure are proved",
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
  sourceIndependentNegativeControls: 117,
  acceptedSyntheticSources: 5,
  layeredStaticNegativeEvidence:
    STATIC_NEGATIVE_CONTROLS.layeredStaticNegativeEvidence,
  representativeCommitMutationSourceInventory: 17,
  finalRequiredNegativeControls: 330,
  finalRequiredPositiveControls: 11,
  fullSemanticGateClosed: false,
  nonclaims: Object.freeze([
    "the final 330-negative and 11-positive AST/dataflow matrix is not complete",
    "the 17 representative commit mutation sources are inventory, not per-gate or final 200-mutation closure",
    "private-store get positives and exact read-to-owner provenance remain unproved",
    "failure callbacks are accepted only as exact zero-parameter pinned-code throwers",
    "successful-path reachability before the syntactic private-store commit tail remains unproved",
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
  assert.deepEqual(STATIC_NEGATIVE_CONTROLS, {
    rejected: 117,
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
    ],
    layeredStaticNegativeEvidence: {
      totalDeltaSinceParserFoundation: 48,
      estreePolicyReachedCount: 46,
      preEstreePolicyRejectionCount: 2,
      preEstreePolicyRejectionNames: [
        "requirements initializer semantic drift",
        "shallow ambient freeze used as deep freeze",
      ],
    },
    accepted: 5,
    namedAccepted: [
      "exact requirements AST normalization",
      "approved untrusted-value normalizer",
      "frozen local iteration",
      "frozen local module table",
      "pure requirements and ephemeral canonical digest initializers",
    ],
    evaluationAttempts: 0,
  });
  assert.deepEqual(STATIC_ESTREE_SUBSET_EVIDENCE, {
    sourceIndependentNegativeControls: 117,
    acceptedSyntheticSources: 5,
    layeredStaticNegativeEvidence: {
      totalDeltaSinceParserFoundation: 48,
      estreePolicyReachedCount: 46,
      preEstreePolicyRejectionCount: 2,
      preEstreePolicyRejectionNames: [
        "requirements initializer semantic drift",
        "shallow ambient freeze used as deep freeze",
      ],
    },
    representativeCommitMutationSourceInventory: 17,
    finalRequiredNegativeControls: 330,
    finalRequiredPositiveControls: 11,
    fullSemanticGateClosed: false,
    nonclaims: [
      "the final 330-negative and 11-positive AST/dataflow matrix is not complete",
      "the 17 representative commit mutation sources are inventory, not per-gate or final 200-mutation closure",
      "private-store get positives and exact read-to-owner provenance remain unproved",
      "failure callbacks are accepted only as exact zero-parameter pinned-code throwers",
      "successful-path reachability before the syntactic private-store commit tail remains unproved",
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
  "close receiver-origin and alias dataflow; ambient binding, alias, and member writes, computed-key construction, and indirect calls; path-sensitive normative key-literal representation; module/import/export binding and member writes; and private-store owning-operation commit-position proof before lifting the source-presence stop",
  { todo: true },
  () => {},
);
test(
  "complete all remaining ADR-0036 acceptance groups: 252 descriptor aliases; every bound, error-precedence rule, and frame field; transition, status-byte, and prefix goldens; recovery binding; WeakMap failure atomicity; and the complete Node 20 and non-G1.7 matrix",
  { todo: true },
  () => {},
);
