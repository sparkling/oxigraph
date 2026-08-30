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

function sourceWithImportMutation(mutate) {
  const [firstSpecifier, firstNames] = [...ALLOWED_IMPORTS][0];
  const original = `import { ${firstNames.join(", ")} } from ${JSON.stringify(firstSpecifier)};`;
  return sourceSkeleton().replace(original, mutate(original, firstNames));
}

const STATIC_EVIDENCE_MANIFEST_SCHEMA =
  "oxigraph.candidate-containment-guardian-control-static-evidence-manifest/v1";
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
]);
const EXPECTED_STATIC_EVIDENCE_AGGREGATES = Object.freeze({
  orderedControlIdentityProjectionSha256:
    "af44b6f3f20713ffdc3d48cae4eff404b80a1e27ae07783c4a6315e7dd562df0",
  orderedSemanticProjectionSha256:
    "597e02c51e9bb92c7bbfebf5562fc82930d88a78cbdd99ec0fd7b1c6a211360f",
  bucketProjectionSha256:
    "2205bbbfb666fc3b0de1350e9760c932d5fdfcfbd8be7961c9c1d86f6b8ac82e",
  foundationNameProjectionSha256:
    "3064a09db3f937a55e3d0febeca0a2f41ea836bc394cc1259748b268f59f6ce5",
  positiveNameProjectionSha256:
    "7237029edd59dee361030e12d12d3214c38fa83512a2866f8c7ce8e0bfb7bc28",
  commitIdProjectionSha256:
    "cda7855dc809ea3c5fefea4cb8417aae203ebb805b97e93f55a8899284171f1c",
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
SEM-N013|b4bc0847cbbd9b7f908f1abcd38b754f657952ae064dc489cc4b2d0e336b8329|20450c27418578ab4a84626011816d8be65662f565d91aefa7a0e6427ba9cfce|1162|estree-policy|static gate: ESTree deepFreeze argument provenance
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
SEM-N048|ff65ffbafbd9bac23794dd43586b6d3f3d9f4e5cefcd93a103fdde7ce7634330|602773f1e8cc8a795d7443b0d13f4cce39d95d5d192f77102702f7e97c13bce3|1160|estree-policy|static gate: ESTree recursive call graph recursiveFailure`;

const POSITIVE_CONTROL_EXPECTATION_PINS_TEXT = `POS-P001|1833d04623330968e87ecdcdefb7f9324598301cf89691bf7a5f18b30bcb13b0|958d07ae92f1e08483b9948bb86525299ce5a7d8a5c77450916f39c679590df1|1149|accepted|-
POS-P002|52136dd8f54a7cf4d2f3b09314696e4b96136c50f27bbb6730aeee761e240f6c|55d6de40d7edc001614d95da59266e6f507397160e15f6b84492d0c1879aa35d|1171|accepted|-
POS-P003|ee9c363f0f7fa62114a29bb5eb70176753d4061e2714090f7126e3dca8ce6423|0c14bf96bb50459894fbd9130fd275bd13d1764423f2e57ebf554de291745278|1167|accepted|-
POS-P004|f07475cf64ecec73afb4b645cb64032184d03c43ed3b4a99e8c08f753b20e3e6|216a6b69c2684c0d8741d61af956e6137ca311f055af5fb466b6ef7178b30fef|1155|accepted|-
POS-P005|612e51636159788b3dd225f1d01b5aaac928ea2a2cd40a1ad1ac855414bb13ae|8f09df4ff27f4dabbe635485ff84fb577e5c75d9b80a3eed62552dde88c3fce1|1168|accepted|-`;

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
assert.equal(SEMANTIC_CONTROL_EXPECTATION_PINS.length, 48);
assert.equal(POSITIVE_CONTROL_EXPECTATION_PINS.length, 5);
assert.equal(Object.keys(STATIC_CONTROL_EXPECTATION_PINS).length, 122);

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
  assert.notEqual(expected, undefined, id);
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
  ];
  assert.equal(positiveSources.length, POSITIVE_CONTROL_NAMES.length);
  const positiveEvidence = positiveSources.map((source, index) => {
    const stageAudit = {
      astNodeCount: null,
      astSha256: null,
      estreePolicyReached: false,
      expectedStage: "parse",
    };
    assert.doesNotThrow(() => auditCandidateSource(source, stageAudit));
    return createStaticControlEvidenceEntry({
      id: staticControlId("POS-P", index),
      name: POSITIVE_CONTROL_NAMES[index],
      bucket: "positive",
      source,
      stageAudit,
      rejection: null,
    });
  });
  assert.equal(namedStageAudit.length, 64);
  assert.equal(SEMANTIC_BUCKET_BY_ORDINAL.length, 48);
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
  return Object.freeze({
    rejected: sources.length + namedRejected.length,
    namedRejected: Object.freeze(namedRejected),
    layeredStaticNegativeEvidence,
    accepted: positiveSources.length,
    namedAccepted: POSITIVE_CONTROL_NAMES,
    evaluationAttempts,
    evidenceManifest,
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
  const { evidenceManifest, ...staticNegativeControlReceipt } =
    STATIC_NEGATIVE_CONTROLS;
  assert.equal(evidenceManifest.schema, STATIC_EVIDENCE_MANIFEST_SCHEMA);
  assert.deepEqual(staticNegativeControlReceipt, {
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
    Array.from({ length: 48 }, (_, index) => staticControlId("SEM-N", index)),
  );
  assert.deepEqual(
    positiveEntries.map(({ id }) => id),
    Array.from({ length: 5 }, (_, index) => staticControlId("POS-P", index)),
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
  assert.equal(new Set(allEvidenceEntries.map(({ id }) => id)).size, 122);
  assert.equal(new Set(allEvidenceEntries.map(({ name }) => name)).size, 122);
  assert.equal(
    new Set(allEvidenceEntries.map(({ sourceSha256 }) => sourceSha256)).size,
    122,
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
    122,
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
      { bucket: "protectedAliases", target: 12, current: 7, remaining: 5 },
      { bucket: "indirectCalls", target: 12, current: 1, remaining: 11 },
      { bucket: "reflectComputed", target: 12, current: 1, remaining: 11 },
      {
        bucket: "bindingMemberWrites",
        target: 14,
        current: 4,
        remaining: 10,
      },
      { bucket: "untrustedSinks", target: 24, current: 6, remaining: 18 },
      { bucket: "rawEscapes", target: 12, current: 3, remaining: 9 },
      { bucket: "literalMisuse", target: 14, current: 4, remaining: 10 },
      { bucket: "scopeJoins", target: 18, current: 2, remaining: 16 },
      { bucket: "nestedRecursion", target: 12, current: 3, remaining: 9 },
      { bucket: "commitMutations", target: 200, current: 17, remaining: 183 },
    ],
  );
  const bucketIds = evidenceManifest.bucketProjection.flatMap(
    ({ controlIds }) => controlIds,
  );
  assert.equal(bucketIds.length, 48);
  assert.equal(new Set(bucketIds).size, 48);
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
    semanticNegatives: 48,
    allCurrentNegatives: 117,
    semanticTargetNegatives: 330,
    semanticRemainingNegatives: 282,
    allLayerTargetNegatives: 399,
    positiveCurrent: 5,
    positiveTarget: 11,
    positiveRemaining: 6,
    commitCurrent: 17,
    commitTarget: 200,
    commitRemaining: 183,
    evaluationAttempts: 0,
  });
  assert.equal(117, 69 + 48);
  assert.equal(399, 69 + 330);
  assert.equal(282, 330 - 48);
  assert.equal(6, 11 - 5);
  assert.equal(183, 200 - 17);
  assert.equal(STATIC_NEGATIVE_CONTROLS.evaluationAttempts, 0);
  assert.deepEqual(
    evidenceManifest.aggregates,
    EXPECTED_STATIC_EVIDENCE_AGGREGATES,
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
