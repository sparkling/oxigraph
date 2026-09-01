import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const SOURCE_URL = new URL(
  "../src/candidate/containment-guardian-control-v1.mjs",
  import.meta.url,
);
const SOURCE_PATH = fileURLToPath(SOURCE_URL);
const REQUIREMENTS_URL = new URL(
  "../../../docs/adr/fixtures/0036-guardian-control-requirements-v1.json",
  import.meta.url,
);
const EXACT_V2_URL = new URL(
  "../src/candidate/containment-exact-v2.mjs",
  import.meta.url,
);
const HARNESS_PACKAGE_URL = new URL("../package.json", import.meta.url);
const HARNESS_LOCK_URL = new URL("../package-lock.json", import.meta.url);
const ACORN_PACKAGE_URL = new URL(
  "../node_modules/acorn/package.json",
  import.meta.url,
);
const EXPECTED_DIRECT_ACORN = Object.freeze({
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
const ACORN_IMPORT_ENTRYPOINT_URL = new URL(
  EXPECTED_DIRECT_ACORN.importEntrypoint,
  ACORN_PACKAGE_URL,
);
const DIRECT_ACORN_PARSE_OPTIONS = Object.freeze({
  ecmaVersion: 2022,
  sourceType: "module",
  allowAwaitOutsideFunction: false,
  allowHashBang: false,
  allowReturnOutsideFunction: false,
  preserveParens: true,
});
const DIRECT_PARSER_LOAD_AUDIT_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-direct-parser-load/v1";
const EXPECTED_EXACT_V2_SOURCE_SHA256 =
  "2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3";
const ADVERSARIAL_EXACT_V2_LOAD_AUDIT_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-adversarial-exact-v2-load/v1";
const EXPECTED_REQUIREMENTS_SHA256 =
  "0f244f7242eb40a615245a5eda77d5380e368f43a8382f27b3cdb5c1a387e499";
const EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY =
  "additional-non-index-string-and-symbol-properties-ignored-without-enumeration-inspection-read-write-or-invocation;own-length-rejected;semantics-derived-only-from-immediate-intrinsic-copy-of-indexed-bytes/v1";
const SOURCE_INDEPENDENT_ADVERSARIAL_ORACLE_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-adversarial-oracle-design/v1";
const EXPECTED_SOURCE_INDEPENDENT_ORACLE_COUNTS = Object.freeze({
  wholeTransitionStateGoldenDesigns: 20,
  emittedStatusByteGoldenDesigns: 15,
  atomicTwoStatusWirePrefixControls: 4,
  acceptedSymbolicPrefixObservations: 26,
  descriptorAliasControls: 252,
  constructibleFailurePrecedencePairs: 18,
});
const EXPECTED_SOURCE_INDEPENDENT_ORACLE_INVENTORY_SHA256 = Object.freeze({
  wholeTransitionStateGoldenDesigns:
    "251604392360b8024cbaf7d1e6ad48cdbddb5187d049aaeb5dbb50ce3f1d5acb",
  emittedStatusByteGoldenDesigns:
    "6e03baa638cd3b48221e9182d9de1dd74a9a7b454fce40719badb3d0d9b7de5e",
  atomicTwoStatusWirePrefixControls:
    "a2b9524c88bbd78aca2d189c150a9e5499c0da3505c9109734ce78f0fa038ba1",
  acceptedSymbolicPrefixObservations:
    "eeac031f7f929c856d3b46af63bbaeebc33b827eb55fee6f93a4a55f643e89a6",
  descriptorAliasControls:
    "30129d8d237f720fea41a8730d561e4dd615f35da565e5807e54aebb0c2ab9da",
  constructibleFailurePrecedencePairs:
    "51fb17d1ff193dc37db2b16be60251c7bc745f479f0a8ee980ee24bc0caa0762",
});
const SOURCE_INDEPENDENT_MATERIALIZED_STATUS_ORACLE_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-materialized-status-oracle/v1";
const STATUS_ORACLE_CONSTRUCTION_CONTEXT_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-status-oracle-construction-context/v1";
const STATUS_ORACLE_BINDING_PREIMAGE_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-status-oracle-binding/v1";
const STATUS_ORACLE_ENTRY_IDENTITY_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-status-oracle-entry-identity/v1";
const STATUS_ORACLE_ATOMIC_IDENTITY_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-status-oracle-atomic-identity/v1";
const EXPECTED_STATUS_FRAME_FIELDS = Object.freeze([
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
const STATUS_ORACLE_CONSTRUCTION_PREIMAGE_SPECS = Object.freeze([
  Object.freeze({
    id: "normal-startup-report",
    format: "CANONICAL_JSONL",
    value: `{"binding":"NORMAL_STARTUP_REPORT","schema":"${STATUS_ORACLE_BINDING_PREIMAGE_SCHEMA}"}\n`,
  }),
  Object.freeze({
    id: "normal-epoch",
    format: "RAW_HEX",
    value: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  }),
  Object.freeze({
    id: "recovery-only-startup-report",
    format: "CANONICAL_JSONL",
    value: `{"binding":"RECOVERY_ONLY_STARTUP_REPORT","schema":"${STATUS_ORACLE_BINDING_PREIMAGE_SCHEMA}"}\n`,
  }),
  Object.freeze({
    id: "recovery-only-epoch",
    format: "RAW_HEX",
    value: "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
  }),
  Object.freeze({
    id: "normal-admission-frame",
    format: "CANONICAL_JSONL",
    value: `{"binding":"NORMAL_ADMISSION_FRAME","schema":"${STATUS_ORACLE_BINDING_PREIMAGE_SCHEMA}"}\n`,
  }),
  Object.freeze({
    id: "normal-cancel-without-admission-frame",
    format: "CANONICAL_JSONL",
    value: `{"binding":"NORMAL_CANCEL_WITHOUT_ADMISSION_FRAME","schema":"${STATUS_ORACLE_BINDING_PREIMAGE_SCHEMA}"}\n`,
  }),
  Object.freeze({
    id: "normal-cancel-after-admission-frame",
    format: "CANONICAL_JSONL",
    value: `{"binding":"NORMAL_CANCEL_AFTER_ADMISSION_FRAME","schema":"${STATUS_ORACLE_BINDING_PREIMAGE_SCHEMA}"}\n`,
  }),
  Object.freeze({
    id: "recovery-only-request-frame",
    format: "CANONICAL_JSONL",
    value: `{"binding":"RECOVERY_ONLY_REQUEST_FRAME","schema":"${STATUS_ORACLE_BINDING_PREIMAGE_SCHEMA}"}\n`,
  }),
]);
const EXPECTED_STATUS_ORACLE_BINDING_SHA256 = Object.freeze({
  "normal-startup-report":
    "d3e1ff2fb63ad41d7f3aa2a6331e27951935649cff629579c540962e207e4d70",
  "normal-epoch":
    "630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd",
  "recovery-only-startup-report":
    "8d3875efc7bac9141588f9b3c7616192a088d281c832d5225ad662dadcdf7eff",
  "recovery-only-epoch":
    "72dbb7336c76780023f83da4c355f2eeea85733b13d3477697917790c1229084",
  "normal-admission-frame":
    "41aaf237406afdf9f566c526c1516452d846f83bf02d91515d571717ae7224a5",
  "normal-cancel-without-admission-frame":
    "5d3e696b9736d744fc3cc5ad10aa4969d864c2593d79d560dd798661891cf06a",
  "normal-cancel-after-admission-frame":
    "c9959c2be56ece16cd7bdb39429a5512931f1e3c21026695d45877e80d9c0aa6",
  "recovery-only-request-frame":
    "afe6b47b961d9651c595c868955b2b1a30a869b03f0a44fef109ebe6126fe541",
});
const EXPECTED_STATUS_ORACLE_CONSTRUCTION_CONTEXT_SHA256 =
  "fd008c99ac11e32de80c25399d5a8d34bb6ab4832c6e58e969b84993b7470f23";
const EXPECTED_PRIMARY_STATUS_DESIGN_PROJECTION_SHA256 =
  "6e03baa638cd3b48221e9182d9de1dd74a9a7b454fce40719badb3d0d9b7de5e";
const EXPECTED_PRIMARY_ATOMIC_DESIGN_PROJECTION_SHA256 =
  "a2b9524c88bbd78aca2d189c150a9e5499c0da3505c9109734ce78f0fa038ba1";
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
const EXPECTED_MATERIALIZED_STATUS_ORACLE_SHA256 =
  "57872372c67c5ad4580ed2945512fc5c7ec0923b121690c2a2927604608b3583";
const FAILURE_PRECEDENCE_CONSTRUCTOR_APPLICABILITY = Object.freeze([
  Object.freeze({
    operation: "createCandidateContainmentGuardianStartupV1",
    codes: Object.freeze([
      "CONTROL_BOUNDS",
      "CONTROL_SHAPE",
      "CONTROL_STARTUP",
      "CONTROL_BINDING",
    ]),
    contractAnchor:
      "ADR-0036 startup positional signature plus exact failure-category table",
    fixtureEvidenceByCode: Object.freeze({
      CONTROL_BOUNDS: Object.freeze([
        "limits.startupReportMaximumBytes",
        "limits.epochBytes",
      ]),
      CONTROL_SHAPE: Object.freeze([
        "schemas.startupReport",
        "frameFields.startupReport",
        "predecessors.direct[0].imports:copyBoundedBuffer/decodeCanonicalJsonLine/exactRecord",
      ]),
      CONTROL_STARTUP: Object.freeze([
        "startupMaps",
        "frameFields.startupDescriptor",
      ]),
      CONTROL_BINDING: Object.freeze([
        "frameFields.startupReport:requirementsSha256/expectedEpochSha256/openFileDescriptionObservationScopeSha256",
        "predecessors.direct",
      ]),
    }),
  }),
  Object.freeze({
    operation: "createCandidateContainmentGuardianAdmissionInputV1",
    codes: Object.freeze([
      "CONTROL_BOUNDS",
      "CONTROL_SHAPE",
      "CONTROL_FRAME",
      "CONTROL_RIGHTS",
      "CONTROL_BINDING",
      "CONTROL_TRANSITION",
    ]),
    contractAnchor:
      "ADR-0036 admission positional signature plus exact failure-category table",
    fixtureEvidenceByCode: Object.freeze({
      CONTROL_BOUNDS: Object.freeze([
        "limits.admissionFrameMaximumBytes",
        "limits.admissionRecvmsgReportMaximumBytes",
        "limits.maximumAggregateWireBytes",
      ]),
      CONTROL_SHAPE: Object.freeze([
        "schemas.admissionRecvmsgReport",
        "schemas.wireFrame",
        "predecessors.direct[0].imports:copyBoundedBuffer/decodeCanonicalJsonLine/exactRecord",
      ]),
      CONTROL_FRAME: Object.freeze(["frameFields.ADMIT"]),
      CONTROL_RIGHTS: Object.freeze([
        "admissionRights",
        "frameFields.admissionRecvmsgReport",
        "frameFields.admissionRight",
      ]),
      CONTROL_BINDING: Object.freeze([
        "frameFields.ADMIT:requirementsSha256/startupSha256/epochSha256/launchCapsuleV3Sha256",
        "predecessors.direct",
      ]),
      CONTROL_TRANSITION: Object.freeze([
        "legalSequences",
        "limits.maximumAdmissionsPerTranscript",
        "limits.concurrentAdmissionsPermitted",
      ]),
    }),
  }),
]);
const EXPECTED_CONSTRUCTIBLE_FAILURE_PRECEDENCE_PAIR_IDS = Object.freeze([
  "CONTROL_BOUNDS-before-CONTROL_SHAPE",
  "CONTROL_BOUNDS-before-CONTROL_STARTUP",
  "CONTROL_BOUNDS-before-CONTROL_FRAME",
  "CONTROL_BOUNDS-before-CONTROL_RIGHTS",
  "CONTROL_BOUNDS-before-CONTROL_BINDING",
  "CONTROL_BOUNDS-before-CONTROL_TRANSITION",
  "CONTROL_SHAPE-before-CONTROL_STARTUP",
  "CONTROL_SHAPE-before-CONTROL_FRAME",
  "CONTROL_SHAPE-before-CONTROL_RIGHTS",
  "CONTROL_SHAPE-before-CONTROL_BINDING",
  "CONTROL_SHAPE-before-CONTROL_TRANSITION",
  "CONTROL_STARTUP-before-CONTROL_BINDING",
  "CONTROL_FRAME-before-CONTROL_RIGHTS",
  "CONTROL_FRAME-before-CONTROL_BINDING",
  "CONTROL_FRAME-before-CONTROL_TRANSITION",
  "CONTROL_RIGHTS-before-CONTROL_BINDING",
  "CONTROL_RIGHTS-before-CONTROL_TRANSITION",
  "CONTROL_BINDING-before-CONTROL_TRANSITION",
]);
const EXCLUDED_FAILURE_PRECEDENCE_PAIR_IDS = Object.freeze([
  "CONTROL_STARTUP-before-CONTROL_FRAME",
  "CONTROL_STARTUP-before-CONTROL_RIGHTS",
  "CONTROL_STARTUP-before-CONTROL_TRANSITION",
]);
const SOURCE_INDEPENDENT_ORACLE_REGISTRY_FIELDS = Object.freeze({
  wholeTransitionStateGoldenDesigns: Object.freeze([
    "id",
    "mode",
    "operation",
    "beforePrefix",
    "emittedStatuses",
    "acceptedPrefix",
    "acceptedPrefixObservationId",
    "sourceSequences",
    "statusFrameCount",
    "successorPhase",
    "nextWireSequence",
    "lastWireSymbol",
    "eventCount",
    "admissionCount",
    "cancelObserved",
    "controllerClosedObserved",
    "diagnosticFailureObserved",
    "recoveryControlHandoffObserved",
    "controlTerminalReason",
    "statusEofObserved",
    "transcriptTerminal",
  ]),
  emittedStatusByteGoldenDesigns: Object.freeze([
    "id",
    "mode",
    "state",
    "terminalReason",
    "prefix",
    "acceptedPrefixObservationId",
    "wireSequence",
    "previousWireSymbol",
    "admissionFrameBinding",
    "recoveryRequestFrameBinding",
    "sourceSequences",
  ]),
  atomicTwoStatusWirePrefixControls: Object.freeze([
    "id",
    "mode",
    "operation",
    "beforePrefix",
    "firstStatus",
    "secondStatus",
    "firstStatusPrefix",
    "completeTransitionPrefix",
    "firstStatusObservationId",
    "completeTransitionObservationId",
    "firstStatusDesignId",
    "secondStatusDesignId",
    "publicIntermediateState",
  ]),
  acceptedSymbolicPrefixObservations: Object.freeze([
    "id",
    "kind",
    "mode",
    "symbols",
    "sourceSequences",
  ]),
  descriptorAliasControls: Object.freeze([
    "id",
    "family",
    "mode",
    "leftSlot",
    "rightSlot",
  ]),
  constructibleFailurePrecedencePairs: Object.freeze([
    "id",
    "earlier",
    "later",
    "witnessOperations",
  ]),
});
const WIRE_INPUT_KINDS = Object.freeze(["ADMIT", "CANCEL", "RECOVERY_REQUEST"]);
const SUCCESSOR_PHASE_BY_OPERATION = Object.freeze({
  ADMIT: "WAITING_NORMAL_INPUT",
  CANCEL: "CONTROL_TERMINAL_EMITTED",
  CONTROLLER_CLOSED: "CONTROL_TERMINAL_EMITTED",
  DIAGNOSTIC_FAILURE: "CONTROL_TERMINAL_EMITTED",
  RECOVERY_REQUEST: "WAITING_RECOVERY_HANDOFF",
  RECOVERY_CONTROL_HANDOFF: "CONTROL_TERMINAL_EMITTED",
  STATUS_EOF: "TRANSCRIPT_TERMINAL",
});

const BYTE_POSITION_SPECS = Object.freeze([
  Object.freeze({
    name: "startupReportBytes",
    minimumBytes: 0,
    maximumBytes: 8_192,
  }),
  Object.freeze({
    name: "epochBytes",
    minimumBytes: 32,
    maximumBytes: 32,
  }),
  Object.freeze({
    name: "admissionFrameBytes",
    minimumBytes: 0,
    maximumBytes: 131_072,
  }),
  Object.freeze({
    name: "recvmsgReportBytes",
    minimumBytes: 0,
    maximumBytes: 16_384,
  }),
  Object.freeze({
    name: "cancelFrameBytes",
    minimumBytes: 0,
    maximumBytes: 4_096,
  }),
  Object.freeze({
    name: "recoveryRequestFrameBytes",
    minimumBytes: 0,
    maximumBytes: 32_768,
  }),
  Object.freeze({
    name: "diagnosticSummaryReportBytes",
    minimumBytes: 0,
    maximumBytes: 1_024,
  }),
  Object.freeze({
    name: "rawDiagnosticBytes",
    minimumBytes: 0,
    maximumBytes: 16_384,
  }),
  Object.freeze({
    name: "statusFrameBytes",
    minimumBytes: 0,
    maximumBytes: 8_192,
  }),
]);

const BYTE_POSITIONS = Object.freeze(
  BYTE_POSITION_SPECS.map(({ name }) => name),
);

const PRIVATE_STORE_COMMIT_CONTROL_PLAN = Object.freeze([
  Object.freeze({
    store: "startupMetadata",
    operations: Object.freeze(["createCandidateContainmentGuardianStartupV1"]),
    earlyFailure: "startup-report-over-byte-ceiling-before-decode",
    lateFailure: "epoch-eof-or-startup-binding-after-bounded-copies",
    success: "one-startup-brand-commit-after-all-fallible-work",
    failureAfterSuccess:
      "later-failed-startup-construction-does-not-corrupt-the-first-brand",
    crossModule:
      "startup-created-by-instance-a-rejected-by-initializer-instance-b",
  }),
  Object.freeze({
    store: "inputMetadata",
    operations: Object.freeze([
      "createCandidateContainmentGuardianAdmissionInputV1",
      "createCandidateContainmentGuardianCancelInputV1",
      "createCandidateContainmentGuardianRecoveryRequestInputV1",
      "createCandidateContainmentGuardianControllerClosedInputV1",
      "createCandidateContainmentGuardianDiagnosticFailureInputV1",
      "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
      "createCandidateContainmentGuardianStatusEofInputV1",
    ]),
    earlyFailure:
      "per-constructor-earliest-applicable-failure-before-private-commit",
    lateFailure:
      "per-constructor-latest-applicable-failure-before-private-commit",
    success: "one-input-brand-commit-per-successful-constructor",
    failureAfterSuccess:
      "later-failed-input-construction-does-not-corrupt-the-first-brand",
    crossModule: "input-created-by-instance-a-rejected-by-reducer-instance-b",
  }),
  Object.freeze({
    store: "stateMetadata",
    operations: Object.freeze([
      "initializeCandidateContainmentGuardianControlV1",
      "reduceCandidateContainmentGuardianControlV1",
    ]),
    earlyFailure:
      "per-operation-earliest-applicable-failure-before-private-commit",
    lateFailure:
      "per-operation-latest-applicable-failure-before-private-commit",
    success: "one-state-brand-commit-per-successful-initialize-or-reduce",
    failureAfterSuccess:
      "failed-reduction-does-not-corrupt-the-existing-state-brand",
    crossModule: "state-created-by-instance-a-rejected-by-instance-b",
  }),
]);

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
const EXPECTED_DIRECT_FUNCTION_SIGNATURES = Object.freeze(
  Object.entries({
    createCandidateContainmentGuardianStartupV1: [
      "startupReportBytes",
      "epochBytes",
      "epochEofObserved",
    ],
    createCandidateContainmentGuardianAdmissionInputV1: [
      "currentState",
      "admissionFrameBytes",
      "recvmsgReportBytes",
    ],
    createCandidateContainmentGuardianCancelInputV1: [
      "currentState",
      "cancelFrameBytes",
      "messageTruncated",
      "controlTruncated",
      "controlMessageCount",
    ],
    createCandidateContainmentGuardianRecoveryRequestInputV1: [
      "currentState",
      "recoveryRequestFrameBytes",
      "requestEofObserved",
    ],
    createCandidateContainmentGuardianControllerClosedInputV1: ["currentState"],
    createCandidateContainmentGuardianDiagnosticFailureInputV1: [
      "currentState",
      "diagnosticSummaryReportBytes",
      "rawDiagnosticBytes",
    ],
    createCandidateContainmentGuardianRecoveryControlHandoffInputV1: [
      "currentState",
    ],
    createCandidateContainmentGuardianStatusEofInputV1: ["currentState"],
    initializeCandidateContainmentGuardianControlV1: ["startupProjection"],
    reduceCandidateContainmentGuardianControlV1: [
      "currentState",
      "brandedInput",
    ],
    verifyCandidateContainmentGuardianStatusFrameV1: [
      "startupProjection",
      "statusFrameBytes",
    ],
  }).map(([name, parameters]) =>
    Object.freeze({ name, parameters: Object.freeze(parameters) }),
  ),
);

const ADVERSARIAL_CANDIDATE_REGISTRATION_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-adversarial-registration/v1";
const EXPECTED_ADVERSARIAL_CANDIDATE_TEST_INVENTORY_SHA256 =
  "f448be91b5a4bb086e93e4ef529428bd0d509c14fd532e75e02ea1a256c0cb3e";
const ADVERSARIAL_CANDIDATE_TEST_INVENTORY = Object.freeze([
  Object.freeze({
    id: "byte-position-carrier-controls",
    name: "connect the source-independent 9-position matrices to the candidate after static-audit closure, including over-byte collisions with own-length, subclass, foreign-prototype, and shared backing under CONTROL_BOUNDS-before-CONTROL_SHAPE while Proxy and non-Buffer carriers reject immediately trap-free",
    options: Object.freeze({ todo: true }),
    requiredInputs: Object.freeze(["candidate", "oracle"]),
  }),
  Object.freeze({
    id: "private-store-commit-controls",
    name: "execute early, late, success, failure-after-success, and cross-module commit controls for every one of the 10 listed private-store mutating exports after static-audit closure",
    options: Object.freeze({ todo: true }),
    requiredInputs: Object.freeze([
      "candidate",
      "oracle",
      "loadFreshCandidate",
    ]),
  }),
]);

function adversarialCandidateTestInventoryProjection(inventory) {
  return Object.freeze(
    inventory.map(({ id, name, options, requiredInputs }) =>
      Object.freeze({ id, name, options, requiredInputs }),
    ),
  );
}

function validateAdversarialCandidateTestInventory() {
  assert.equal(Object.isFrozen(ADVERSARIAL_CANDIDATE_TEST_INVENTORY), true);
  assert.equal(ADVERSARIAL_CANDIDATE_TEST_INVENTORY.length, 2);
  const ids = [];
  const names = [];
  for (const entry of ADVERSARIAL_CANDIDATE_TEST_INVENTORY) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(typeof entry.id, "string");
    assert.notEqual(entry.id.length, 0);
    assert.equal(typeof entry.name, "string");
    assert.notEqual(entry.name.length, 0);
    assert.equal(Object.isFrozen(entry.options), true);
    assert.deepEqual(entry.options, { todo: true });
    assert.equal(Object.isFrozen(entry.requiredInputs), true);
    assert.equal(entry.requiredInputs.length > 0, true);
    assert.equal(
      entry.requiredInputs.every((name) =>
        ["candidate", "oracle", "loadFreshCandidate"].includes(name),
      ),
      true,
    );
    assert.equal(
      new Set(entry.requiredInputs).size,
      entry.requiredInputs.length,
    );
    ids.push(entry.id);
    names.push(entry.name);
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length);
  const projection = adversarialCandidateTestInventoryProjection(
    ADVERSARIAL_CANDIDATE_TEST_INVENTORY,
  );
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(
    projection.every((entry) => Object.isFrozen(entry)),
    true,
  );
  const inventorySha256 = digest(projection);
  assert.equal(
    inventorySha256,
    EXPECTED_ADVERSARIAL_CANDIDATE_TEST_INVENTORY_SHA256,
  );
  const todoCount = projection.filter(({ options }) => options.todo).length;
  assert.equal(todoCount, 2);
  return Object.freeze({
    inventory: ADVERSARIAL_CANDIDATE_TEST_INVENTORY,
    inventorySha256,
    todoCount,
  });
}

function assertCandidateTestInputsAtExecution(captured, requiredInputs) {
  for (const name of requiredInputs) {
    const value = captured[name];
    assert.notEqual(
      value,
      undefined,
      `${name} must be supplied by the main lane`,
    );
    if (name === "loadFreshCandidate") {
      assert.equal(typeof value, "function");
    }
  }
}

const C13_DEFERRED_CALLBACK_RESULT_SCHEMA =
  "oxigraph.test.candidate-containment-guardian-control-v1-c13-deferred-callback/v1";
const C13_BYTE_POSITION_OPERATION = Object.freeze({
  startupReportBytes: "createCandidateContainmentGuardianStartupV1",
  epochBytes: "createCandidateContainmentGuardianStartupV1",
  admissionFrameBytes: "createCandidateContainmentGuardianAdmissionInputV1",
  recvmsgReportBytes: "createCandidateContainmentGuardianAdmissionInputV1",
  cancelFrameBytes: "createCandidateContainmentGuardianCancelInputV1",
  recoveryRequestFrameBytes:
    "createCandidateContainmentGuardianRecoveryRequestInputV1",
  diagnosticSummaryReportBytes:
    "createCandidateContainmentGuardianDiagnosticFailureInputV1",
  rawDiagnosticBytes:
    "createCandidateContainmentGuardianDiagnosticFailureInputV1",
  statusFrameBytes: "verifyCandidateContainmentGuardianStatusFrameV1",
});
const C13_BYTE_POSITION_CASES = Object.freeze([
  "minimum",
  "maximum",
  "own-length-collision",
  "subclass",
  "foreign-prototype",
  "shared-backing",
  "bounds-before-shape",
  "proxy-trap-free",
  "non-buffer",
]);
const C13_PRIVATE_STORE_PHASES = Object.freeze([
  "earlyFailure",
  "lateFailure",
  "success",
  "failureAfterSuccess",
  "crossModule",
]);

function c13DeferredCallbackResult(id) {
  return Object.freeze({
    schema: C13_DEFERRED_CALLBACK_RESULT_SCHEMA,
    id,
    status: "DEFERRED_SOURCE_ABSENT",
    candidateBehaviorAttemptCount: 0,
    freshLoaderCallCount: 0,
    candidateBehaviorProved: false,
  });
}

function c13RunBytePositionCandidateControls({ candidate, oracle }) {
  if (candidate === null) {
    return c13DeferredCallbackResult("byte-position-carrier-controls");
  }
  assert.equal(typeof candidate, "object");
  assert.notEqual(oracle, null);
  const oracleIdentitySha256 =
    oracle.identitySha256 ?? oracle.requirementsSha256 ?? null;
  assert.match(oracleIdentitySha256, /^[0-9a-f]{64}$/u);
  const controlIds = [];
  for (const spec of BYTE_POSITION_SPECS) {
    const operation = C13_BYTE_POSITION_OPERATION[spec.name];
    assert.equal(typeof candidate[operation], "function", operation);
    for (const family of C13_BYTE_POSITION_CASES) {
      const control = Object.freeze({
        schema:
          "oxigraph.test.candidate-containment-guardian-control-v1-c13-byte-position-control/v1",
        position: spec.name,
        minimumBytes: spec.minimumBytes,
        maximumBytes: spec.maximumBytes,
        family,
        oracleIdentitySha256,
      });
      candidate[operation](control);
      controlIds.push(`${spec.name}:${family}`);
    }
  }
  assert.equal(controlIds.length, 81);
  assert.equal(new Set(controlIds).size, 81);
  return Object.freeze({
    schema:
      "oxigraph.test.candidate-containment-guardian-control-v1-c13-byte-position-dispatch/v1",
    positionCount: BYTE_POSITION_SPECS.length,
    familyCount: C13_BYTE_POSITION_CASES.length,
    controlCount: controlIds.length,
    controlIds: Object.freeze(controlIds),
    candidateBehaviorProved: false,
  });
}

async function c13RunPrivateStoreCandidateControls({
  candidate,
  oracle,
  loadFreshCandidate,
}) {
  if (candidate === null) {
    return c13DeferredCallbackResult("private-store-commit-controls");
  }
  assert.equal(typeof candidate, "object");
  assert.notEqual(oracle, null);
  assert.equal(typeof loadFreshCandidate, "function");
  const freshCandidate = await loadFreshCandidate();
  assert.equal(typeof freshCandidate, "object");
  assert.notEqual(freshCandidate, candidate);
  const controlIds = [];
  for (const entry of PRIVATE_STORE_COMMIT_CONTROL_PLAN) {
    for (const operation of entry.operations) {
      for (const phase of C13_PRIVATE_STORE_PHASES) {
        const moduleInstance =
          phase === "crossModule" ? freshCandidate : candidate;
        assert.equal(typeof moduleInstance[operation], "function", operation);
        moduleInstance[operation](
          Object.freeze({
            schema:
              "oxigraph.test.candidate-containment-guardian-control-v1-c13-private-store-control/v1",
            store: entry.store,
            operation,
            phase,
            oracleIdentitySha256:
              oracle.identitySha256 ?? oracle.requirementsSha256 ?? null,
          }),
        );
        controlIds.push(`${operation}:${phase}`);
      }
    }
  }
  assert.equal(controlIds.length, 50);
  assert.equal(new Set(controlIds).size, 50);
  return Object.freeze({
    schema:
      "oxigraph.test.candidate-containment-guardian-control-v1-c13-private-store-dispatch/v1",
    ownerCount: 10,
    phaseCount: 5,
    controlCount: controlIds.length,
    freshLoaderCallCount: 1,
    controlIds: Object.freeze(controlIds),
    candidateBehaviorProved: false,
  });
}

export function registerAdversarialCandidateTests(registration) {
  if (
    registration === null ||
    (typeof registration !== "object" && typeof registration !== "function")
  ) {
    throw new TypeError("adversarial candidate registration must be an object");
  }
  for (const name of ["candidate", "oracle", "loadFreshCandidate"]) {
    if (!Object.hasOwn(registration, name)) {
      throw new TypeError(`adversarial candidate registration missing ${name}`);
    }
  }
  const { registerTest = nodeTest } = registration;
  if (typeof registerTest !== "function") {
    throw new TypeError(
      "adversarial candidate registerTest must be a function",
    );
  }

  const { inventory, inventorySha256, todoCount } =
    validateAdversarialCandidateTestInventory();
  let registeredCount = 0;
  for (const entry of inventory) {
    registerTest(entry.name, entry.options, async () => {
      const captured = Object.freeze(
        Object.fromEntries(
          entry.requiredInputs.map((name) => [name, registration[name]]),
        ),
      );
      assertCandidateTestInputsAtExecution(captured, entry.requiredInputs);
      if (entry.id === "byte-position-carrier-controls") {
        return c13RunBytePositionCandidateControls(captured);
      }
      if (entry.id === "private-store-commit-controls") {
        return c13RunPrivateStoreCandidateControls(captured);
      }
      throw new Error(`unknown adversarial candidate test id: ${entry.id}`);
    });
    registeredCount += 1;
  }
  assert.equal(registeredCount, inventory.length);
  return Object.freeze({
    schema: ADVERSARIAL_CANDIDATE_REGISTRATION_SCHEMA,
    inventorySha256,
    registeredCount,
    todoCount,
    inputsDeferredUntilExecution: true,
  });
}

function isDirectEntry(moduleUrl, entryPath) {
  if (
    typeof moduleUrl !== "string" ||
    typeof entryPath !== "string" ||
    entryPath.length === 0
  ) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}

async function loadExactV2ForAdversarialEntry({
  directEntry,
  readExactV2Source = () => readFileSync(EXACT_V2_URL),
  importExactV2 = () => import(EXACT_V2_URL.href),
}) {
  assert.equal(typeof directEntry, "boolean");
  assert.equal(typeof readExactV2Source, "function");
  assert.equal(typeof importExactV2, "function");
  if (!directEntry) {
    return Object.freeze({
      copyBoundedBuffer: null,
      audit: Object.freeze({
        schema: ADVERSARIAL_EXACT_V2_LOAD_AUDIT_SCHEMA,
        mode: "IMPORTED",
        expectedSourceSha256: EXPECTED_EXACT_V2_SOURCE_SHA256,
        observedSourceSha256: null,
        sourceReadCount: 0,
        sourcePinSequence: null,
        moduleLoadAttemptCount: 0,
        moduleLoadAttemptSequence: null,
        sourcePinnedBeforeModuleLoad: false,
        copyBoundedBufferLoaded: false,
      }),
    });
  }

  let sequence = 0;
  const exactV2SourceBytes = readExactV2Source();
  const observedSourceSha256 = createHash("sha256")
    .update(exactV2SourceBytes)
    .digest("hex");
  assert.equal(
    observedSourceSha256,
    EXPECTED_EXACT_V2_SOURCE_SHA256,
    "adversarial exact-v2 source pin mismatch",
  );
  const sourcePinSequence = (sequence += 1);
  const moduleLoadAttemptSequence = (sequence += 1);
  assert.equal(sourcePinSequence < moduleLoadAttemptSequence, true);
  const exactV2 = await importExactV2();
  assert.equal(typeof exactV2.copyBoundedBuffer, "function");
  return Object.freeze({
    copyBoundedBuffer: exactV2.copyBoundedBuffer,
    audit: Object.freeze({
      schema: ADVERSARIAL_EXACT_V2_LOAD_AUDIT_SCHEMA,
      mode: "DIRECT_ENTRY",
      expectedSourceSha256: EXPECTED_EXACT_V2_SOURCE_SHA256,
      observedSourceSha256,
      sourceReadCount: 1,
      sourcePinSequence,
      moduleLoadAttemptCount: 1,
      moduleLoadAttemptSequence,
      sourcePinnedBeforeModuleLoad: true,
      copyBoundedBufferLoaded: true,
    }),
  });
}

async function loadDirectParserForAdversarialEntry({
  directEntry,
  readHarnessManifest = () => readFileSync(HARNESS_PACKAGE_URL),
  readHarnessLock = () => readFileSync(HARNESS_LOCK_URL),
  readInstalledPackage = () => readFileSync(ACORN_PACKAGE_URL),
  readInstalledEntrypoint = () => readFileSync(ACORN_IMPORT_ENTRYPOINT_URL),
  importParser = () => import(ACORN_IMPORT_ENTRYPOINT_URL.href),
}) {
  assert.equal(typeof directEntry, "boolean");
  if (!directEntry) {
    return Object.freeze({
      parse: null,
      audit: Object.freeze({
        schema: DIRECT_PARSER_LOAD_AUDIT_SCHEMA,
        mode: "IMPORTED",
        manifestReadCount: 0,
        lockReadCount: 0,
        installedPackageReadCount: 0,
        installedEntrypointReadCount: 0,
        parserImportCount: 0,
        identityPinnedBeforeImport: false,
        version: null,
      }),
    });
  }
  for (const dependency of [
    readHarnessManifest,
    readHarnessLock,
    readInstalledPackage,
    readInstalledEntrypoint,
    importParser,
  ]) {
    assert.equal(typeof dependency, "function");
  }
  let sequence = 0;
  const manifestBytes = readHarnessManifest();
  const manifestReadSequence = (sequence += 1);
  const lockBytes = readHarnessLock();
  const lockReadSequence = (sequence += 1);
  const installedPackageBytes = readInstalledPackage();
  const installedPackageReadSequence = (sequence += 1);
  const installedEntrypointBytes = readInstalledEntrypoint();
  const installedEntrypointReadSequence = (sequence += 1);
  const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8"));
  const lock = JSON.parse(Buffer.from(lockBytes).toString("utf8"));
  const installed = JSON.parse(
    Buffer.from(installedPackageBytes).toString("utf8"),
  );
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
      version: EXPECTED_DIRECT_ACORN.version,
      integrity: EXPECTED_DIRECT_ACORN.integrity,
      license: EXPECTED_DIRECT_ACORN.license,
    },
  );
  assert.equal(Object.hasOwn(locked, "dependencies"), false);
  assert.deepEqual(
    { version: installed.version, license: installed.license },
    {
      version: EXPECTED_DIRECT_ACORN.version,
      license: EXPECTED_DIRECT_ACORN.license,
    },
  );
  assert.equal(
    createHash("sha256").update(installedPackageBytes).digest("hex"),
    EXPECTED_DIRECT_ACORN.packageJsonSha256,
  );
  assert.equal(
    installed.exports?.["."]?.[0]?.import,
    EXPECTED_DIRECT_ACORN.importEntrypoint,
  );
  assert.equal(
    createHash("sha256").update(installedEntrypointBytes).digest("hex"),
    EXPECTED_DIRECT_ACORN.importEntrypointSha256,
  );
  const identityPinSequence = (sequence += 1);
  const parserImportSequence = (sequence += 1);
  const parser = await importParser();
  assert.equal(parser.version, EXPECTED_DIRECT_ACORN.version);
  assert.equal(typeof parser.parse, "function");
  assert.equal(identityPinSequence < parserImportSequence, true);
  return Object.freeze({
    parse: parser.parse,
    audit: Object.freeze({
      schema: DIRECT_PARSER_LOAD_AUDIT_SCHEMA,
      mode: "DIRECT_ENTRY",
      manifestReadCount: 1,
      lockReadCount: 1,
      installedPackageReadCount: 1,
      installedEntrypointReadCount: 1,
      parserImportCount: 1,
      manifestReadSequence,
      lockReadSequence,
      installedPackageReadSequence,
      installedEntrypointReadSequence,
      identityPinSequence,
      parserImportSequence,
      identityPinnedBeforeImport: true,
      version: parser.version,
    }),
  });
}

const DIRECT_ENTRY = isDirectEntry(import.meta.url, process.argv[1]);
const DIRECT_PARSER_LOAD = await loadDirectParserForAdversarialEntry({
  directEntry: DIRECT_ENTRY,
});
const directParse = DIRECT_PARSER_LOAD.parse;
const DIRECT_PARSER_LOAD_AUDIT = DIRECT_PARSER_LOAD.audit;
const EXACT_V2_LOAD = await loadExactV2ForAdversarialEntry({
  directEntry: DIRECT_ENTRY,
});
const copyBoundedBuffer = EXACT_V2_LOAD.copyBoundedBuffer;
const ADVERSARIAL_EXACT_V2_LOAD_AUDIT = EXACT_V2_LOAD.audit;
if (!DIRECT_ENTRY) {
  assert.equal(directParse, null);
  assert.deepEqual(DIRECT_PARSER_LOAD_AUDIT, {
    schema: DIRECT_PARSER_LOAD_AUDIT_SCHEMA,
    mode: "IMPORTED",
    manifestReadCount: 0,
    lockReadCount: 0,
    installedPackageReadCount: 0,
    installedEntrypointReadCount: 0,
    parserImportCount: 0,
    identityPinnedBeforeImport: false,
    version: null,
  });
  assert.equal(copyBoundedBuffer, null);
  assert.deepEqual(ADVERSARIAL_EXACT_V2_LOAD_AUDIT, {
    schema: ADVERSARIAL_EXACT_V2_LOAD_AUDIT_SCHEMA,
    mode: "IMPORTED",
    expectedSourceSha256: EXPECTED_EXACT_V2_SOURCE_SHA256,
    observedSourceSha256: null,
    sourceReadCount: 0,
    sourcePinSequence: null,
    moduleLoadAttemptCount: 0,
    moduleLoadAttemptSequence: null,
    sourcePinnedBeforeModuleLoad: false,
    copyBoundedBufferLoaded: false,
  });
}
const test = DIRECT_ENTRY ? nodeTest : () => {};

const FORBIDDEN = Object.freeze([
  "Buffer",
  "Date",
  "JSON",
  "Promise",
  "Proxy",
  "WeakSet",
  "__proto__",
  "constructor",
  "eval",
  "fetch",
  "globalThis",
  "process",
  "prototype",
  "setTimeout",
]);

function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function digest(value) {
  return createHash("sha256")
    .update(Buffer.from(canonicalJson(value), "utf8"))
    .digest("hex");
}

function byteDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function recursivelyFreezeStatusOracleValue(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  assert.equal(
    ArrayBuffer.isView(value),
    false,
    "materialized status oracle must not retain mutable byte views",
  );
  assert.equal(
    value instanceof ArrayBuffer,
    false,
    "materialized status oracle must not retain ArrayBuffer instances",
  );
  if (typeof SharedArrayBuffer === "function") {
    assert.equal(
      value instanceof SharedArrayBuffer,
      false,
      "materialized status oracle must not retain SharedArrayBuffer instances",
    );
  }
  seen.add(value);
  for (const nested of Object.values(value)) {
    recursivelyFreezeStatusOracleValue(nested, seen);
  }
  return Object.freeze(value);
}

function frozenArray(values) {
  return Object.freeze([...values]);
}

function paddedId(prefix, index) {
  return `${prefix}-${String(index).padStart(2, "0")}`;
}

function sequenceMode(sequenceId) {
  return sequenceId.startsWith("R") ? "RECOVERY_ONLY" : "NORMAL";
}

function terminalStatusParts(requirements, symbol) {
  const match = /^CONTROL_TERMINAL\(([^()]+)\)$/u.exec(symbol);
  if (match !== null) {
    assert.equal(
      requirements.vocabularies.terminalReasons.includes(match[1]),
      true,
    );
    return Object.freeze({
      state: "CONTROL_TERMINAL",
      terminalReason: match[1],
    });
  }
  if (
    symbol !== "CONTROL_TERMINAL" &&
    requirements.vocabularies.statusStates.includes(symbol)
  ) {
    return Object.freeze({ state: symbol, terminalReason: null });
  }
  return null;
}

function isWireSymbol(requirements, symbol) {
  return (
    WIRE_INPUT_KINDS.includes(symbol) ||
    terminalStatusParts(requirements, symbol) !== null
  );
}

function frozenSequenceEntries(requirements) {
  return Object.freeze(
    Object.entries(requirements.legalSequences).map(([id, symbols]) =>
      Object.freeze({
        id,
        mode: sequenceMode(id),
        symbols: frozenArray(symbols),
      }),
    ),
  );
}

function assertPinnedSourceIndependentOracleFixture(requirements) {
  assert.equal(
    requirements !== null &&
      typeof requirements === "object" &&
      !Array.isArray(requirements),
    true,
  );
  assert.equal(digest(requirements), EXPECTED_REQUIREMENTS_SHA256);
  assert.deepEqual(Object.keys(requirements.legalSequences), [
    "N1",
    "N2",
    "N3",
    "N4",
    "N5a",
    "N5b",
    "R1",
    "R2",
  ]);
  assert.deepEqual(
    requirements.vocabularies.failureCodes,
    requirements.vocabularies.failurePrecedence,
  );
  assert.equal(requirements.admissionRights.count, 14);
  assert.equal(requirements.startupMaps.normalDescriptorCount, 8);
  assert.equal(requirements.startupMaps.recoveryOnlyDescriptorCount, 7);
}

function generateAcceptedSymbolicPrefixObservations(sequenceEntries) {
  const builders = [];
  const builderByKey = new Map();
  const add = (symbols, sequenceId) => {
    const key = canonicalJson(symbols);
    let builder = builderByKey.get(key);
    if (builder === undefined) {
      builder = {
        mode: sequenceMode(sequenceId),
        symbols: [...symbols],
        sourceSequences: [],
      };
      builderByKey.set(key, builder);
      builders.push(builder);
    }
    assert.equal(builder.mode, sequenceMode(sequenceId));
    if (!builder.sourceSequences.includes(sequenceId)) {
      builder.sourceSequences.push(sequenceId);
    }
  };

  add([], "R1");
  add([], "R2");
  for (const { id, symbols } of sequenceEntries) {
    for (let length = 1; length < symbols.length; length += 1) {
      add(symbols.slice(0, length), id);
    }
  }

  return Object.freeze(
    builders.map((builder, index) =>
      Object.freeze({
        id: paddedId("symbolic-prefix", index),
        kind:
          builder.symbols.length === 0
            ? "RECOVERY_INITIALIZATION_EMPTY"
            : "NONEMPTY_PROPER_PREFIX",
        mode: builder.mode,
        symbols: frozenArray(builder.symbols),
        sourceSequences: frozenArray(builder.sourceSequences),
      }),
    ),
  );
}

function prefixIdBySymbols(prefixObservations) {
  return new Map(
    prefixObservations.map(({ id, symbols }) => [canonicalJson(symbols), id]),
  );
}

function successorPhase(operation, mode) {
  if (operation === "INITIALIZE") {
    return mode === "NORMAL"
      ? "WAITING_NORMAL_INPUT"
      : "WAITING_RECOVERY_REQUEST";
  }
  const phase = SUCCESSOR_PHASE_BY_OPERATION[operation];
  assert.notEqual(phase, undefined, operation);
  return phase;
}

function generateWholeTransitionStateGoldenDesigns(
  requirements,
  sequenceEntries,
  prefixObservations,
) {
  const inputKinds = new Set(requirements.vocabularies.inputKinds);
  const builders = [];
  const builderByKey = new Map();
  const add = ({
    acceptedPrefix,
    beforePrefix,
    emittedStatuses,
    mode,
    operation,
    sequenceId,
  }) => {
    const key = canonicalJson(acceptedPrefix);
    let builder = builderByKey.get(key);
    if (builder === undefined) {
      builder = {
        acceptedPrefix: [...acceptedPrefix],
        beforePrefix: [...beforePrefix],
        emittedStatuses: [...emittedStatuses],
        mode,
        operation,
        sourceSequences: [],
      };
      builderByKey.set(key, builder);
      builders.push(builder);
    }
    assert.equal(builder.mode, mode);
    assert.equal(builder.operation, operation);
    assert.deepEqual(builder.beforePrefix, beforePrefix);
    assert.deepEqual(builder.emittedStatuses, emittedStatuses);
    if (!builder.sourceSequences.includes(sequenceId)) {
      builder.sourceSequences.push(sequenceId);
    }
  };

  for (const { id, mode, symbols } of sequenceEntries) {
    const recovery = mode === "RECOVERY_ONLY";
    add({
      acceptedPrefix: recovery ? [] : symbols.slice(0, 1),
      beforePrefix: [],
      emittedStatuses: recovery ? [] : symbols.slice(0, 1),
      mode,
      operation: "INITIALIZE",
      sequenceId: id,
    });
    for (let index = 0; index < symbols.length; index += 1) {
      const operation = symbols[index];
      if (!inputKinds.has(operation)) continue;
      let end = index + 1;
      while (end < symbols.length && !inputKinds.has(symbols[end])) end += 1;
      add({
        acceptedPrefix: symbols.slice(0, end),
        beforePrefix: symbols.slice(0, index),
        emittedStatuses: symbols.slice(index + 1, end),
        mode,
        operation,
        sequenceId: id,
      });
    }
  }

  const prefixIds = prefixIdBySymbols(prefixObservations);
  return Object.freeze(
    builders.map((builder, index) => {
      const wireSymbols = builder.acceptedPrefix.filter((symbol) =>
        isWireSymbol(requirements, symbol),
      );
      const terminal = [...builder.acceptedPrefix]
        .reverse()
        .map((symbol) => terminalStatusParts(requirements, symbol))
        .find((parts) => parts?.state === "CONTROL_TERMINAL");
      const transcriptTerminal = builder.operation === "STATUS_EOF";
      return Object.freeze({
        id: paddedId("whole-transition-state", index),
        mode: builder.mode,
        operation: builder.operation,
        beforePrefix: frozenArray(builder.beforePrefix),
        emittedStatuses: frozenArray(builder.emittedStatuses),
        acceptedPrefix: frozenArray(builder.acceptedPrefix),
        acceptedPrefixObservationId:
          prefixIds.get(canonicalJson(builder.acceptedPrefix)) ?? null,
        sourceSequences: frozenArray(builder.sourceSequences),
        statusFrameCount: builder.emittedStatuses.length,
        successorPhase: successorPhase(builder.operation, builder.mode),
        nextWireSequence: wireSymbols.length,
        lastWireSymbol: wireSymbols.at(-1) ?? "GENESIS",
        eventCount: builder.acceptedPrefix.length,
        admissionCount: builder.acceptedPrefix.includes("ADMIT") ? 1 : 0,
        cancelObserved: builder.acceptedPrefix.includes("CANCEL"),
        controllerClosedObserved:
          builder.acceptedPrefix.includes("CONTROLLER_CLOSED"),
        diagnosticFailureObserved:
          builder.acceptedPrefix.includes("DIAGNOSTIC_FAILURE"),
        recoveryControlHandoffObserved: builder.acceptedPrefix.includes(
          "RECOVERY_CONTROL_HANDOFF",
        ),
        controlTerminalReason: terminal?.terminalReason ?? null,
        statusEofObserved: builder.acceptedPrefix.includes("STATUS_EOF"),
        transcriptTerminal,
      });
    }),
  );
}

function generateEmittedStatusByteGoldenDesigns(
  requirements,
  sequenceEntries,
  prefixObservations,
) {
  const builders = [];
  const builderByKey = new Map();
  for (const { id, mode, symbols } of sequenceEntries) {
    for (let index = 0; index < symbols.length; index += 1) {
      const parts = terminalStatusParts(requirements, symbols[index]);
      if (parts === null) continue;
      const prefix = symbols.slice(0, index + 1);
      const key = canonicalJson(prefix);
      let builder = builderByKey.get(key);
      if (builder === undefined) {
        const priorWireSymbols = symbols
          .slice(0, index)
          .filter((symbol) => isWireSymbol(requirements, symbol));
        builder = {
          admissionFrameBinding: prefix.includes("ADMIT") ? "PRESENT" : "NULL",
          mode,
          prefix,
          previousWireSymbol: priorWireSymbols.at(-1) ?? "GENESIS",
          recoveryRequestFrameBinding: prefix.includes("RECOVERY_REQUEST")
            ? "PRESENT"
            : "NULL",
          sourceSequences: [],
          state: parts.state,
          terminalReason: parts.terminalReason,
          wireSequence: priorWireSymbols.length,
        };
        builderByKey.set(key, builder);
        builders.push(builder);
      }
      assert.equal(builder.mode, mode);
      if (!builder.sourceSequences.includes(id))
        builder.sourceSequences.push(id);
    }
  }

  const prefixIds = prefixIdBySymbols(prefixObservations);
  return Object.freeze(
    builders.map((builder, index) =>
      Object.freeze({
        id: paddedId("emitted-status-byte", index),
        mode: builder.mode,
        state: builder.state,
        terminalReason: builder.terminalReason,
        prefix: frozenArray(builder.prefix),
        acceptedPrefixObservationId: prefixIds.get(
          canonicalJson(builder.prefix),
        ),
        wireSequence: builder.wireSequence,
        previousWireSymbol: builder.previousWireSymbol,
        admissionFrameBinding: builder.admissionFrameBinding,
        recoveryRequestFrameBinding: builder.recoveryRequestFrameBinding,
        sourceSequences: frozenArray(builder.sourceSequences),
      }),
    ),
  );
}

function generateAtomicTwoStatusWirePrefixControls(
  wholeTransitionDesigns,
  emittedStatusDesigns,
  prefixObservations,
) {
  const statusIdByPrefix = new Map(
    emittedStatusDesigns.map(({ id, prefix }) => [canonicalJson(prefix), id]),
  );
  const prefixIds = prefixIdBySymbols(prefixObservations);
  return Object.freeze(
    wholeTransitionDesigns
      .filter(({ statusFrameCount }) => statusFrameCount === 2)
      .map((transition, index) => {
        const firstStatusPrefix = [
          ...transition.beforePrefix,
          transition.operation,
          transition.emittedStatuses[0],
        ];
        return Object.freeze({
          id: paddedId("atomic-two-status-wire-prefix", index),
          mode: transition.mode,
          operation: transition.operation,
          beforePrefix: frozenArray(transition.beforePrefix),
          firstStatus: transition.emittedStatuses[0],
          secondStatus: transition.emittedStatuses[1],
          firstStatusPrefix: frozenArray(firstStatusPrefix),
          completeTransitionPrefix: frozenArray(transition.acceptedPrefix),
          firstStatusObservationId: prefixIds.get(
            canonicalJson(firstStatusPrefix),
          ),
          completeTransitionObservationId:
            transition.acceptedPrefixObservationId,
          firstStatusDesignId: statusIdByPrefix.get(
            canonicalJson(firstStatusPrefix),
          ),
          secondStatusDesignId: statusIdByPrefix.get(
            canonicalJson(transition.acceptedPrefix),
          ),
          publicIntermediateState: false,
        });
      }),
  );
}

function unorderedIndexPairs(count) {
  const pairs = [];
  for (let left = 0; left < count; left += 1) {
    for (let right = left + 1; right < count; right += 1) {
      pairs.push(Object.freeze([left, right]));
    }
  }
  return Object.freeze(pairs);
}

function generateDescriptorAliasControls(requirements) {
  const controls = [];
  const add = (family, mode, leftSlot, rightSlot) => {
    controls.push(
      Object.freeze({
        id: `descriptor-alias:${family}:${leftSlot}:${rightSlot}`,
        family,
        mode,
        leftSlot,
        rightSlot,
      }),
    );
  };
  const rightCount = requirements.admissionRights.count;
  const normalCount = requirements.startupMaps.normalDescriptorCount;
  const recoveryCount = requirements.startupMaps.recoveryOnlyDescriptorCount;

  for (const [left, right] of unorderedIndexPairs(rightCount)) {
    add("ADMISSION_RIGHT_PAIR", "NORMAL", `right${left}`, `right${right}`);
  }
  for (let right = 0; right < rightCount; right += 1) {
    for (let fd = 0; fd < normalCount; fd += 1) {
      add(
        "ADMISSION_RIGHT_TO_NORMAL_STARTUP",
        "NORMAL",
        `right${right}`,
        `fd${fd}`,
      );
    }
  }
  for (const [left, right] of unorderedIndexPairs(normalCount)) {
    add("NORMAL_STARTUP_PAIR", "NORMAL", `fd${left}`, `fd${right}`);
  }
  for (const [left, right] of unorderedIndexPairs(recoveryCount)) {
    add("RECOVERY_STARTUP_PAIR", "RECOVERY_ONLY", `fd${left}`, `fd${right}`);
  }
  return Object.freeze(controls);
}

function generateConstructibleFailurePrecedencePairs(requirements) {
  const precedence = requirements.vocabularies.failurePrecedence;
  const precedenceIndex = new Map(
    precedence.map((code, index) => [code, index]),
  );
  const builderById = new Map();
  for (const witness of FAILURE_PRECEDENCE_CONSTRUCTOR_APPLICABILITY) {
    for (const code of witness.codes)
      assert.equal(precedenceIndex.has(code), true);
    for (const [leftIndex, rightIndex] of unorderedIndexPairs(
      witness.codes.length,
    )) {
      let earlier = witness.codes[leftIndex];
      let later = witness.codes[rightIndex];
      if (precedenceIndex.get(earlier) > precedenceIndex.get(later)) {
        [earlier, later] = [later, earlier];
      }
      const id = `${earlier}-before-${later}`;
      let builder = builderById.get(id);
      if (builder === undefined) {
        builder = { id, earlier, later, witnessOperations: [] };
        builderById.set(id, builder);
      }
      builder.witnessOperations.push(witness.operation);
    }
  }
  return Object.freeze(
    [...builderById.values()]
      .sort(
        (left, right) =>
          precedenceIndex.get(left.earlier) -
            precedenceIndex.get(right.earlier) ||
          precedenceIndex.get(left.later) - precedenceIndex.get(right.later),
      )
      .map((builder) =>
        Object.freeze({
          id: builder.id,
          earlier: builder.earlier,
          later: builder.later,
          witnessOperations: frozenArray(builder.witnessOperations),
        }),
      ),
  );
}

function inventoryCounts(registries) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(registries).map(([name, registry]) => [
        name,
        registry.length,
      ]),
    ),
  );
}

function inventoryDigests(registries) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(registries).map(([name, registry]) => [
        name,
        digest(registry),
      ]),
    ),
  );
}

function projectSourceIndependentOracleRegistries(registries) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(SOURCE_INDEPENDENT_ORACLE_REGISTRY_FIELDS).map(
        ([name, fields]) => {
          const rows = registries[name];
          assert.equal(Array.isArray(rows), true, name);
          return [
            name,
            Object.freeze(
              rows.map((row) => {
                assert.deepEqual(Object.keys(row), fields, name);
                return Object.freeze(fields.map((field) => row[field]));
              }),
            ),
          ];
        },
      ),
    ),
  );
}

function recordsFromSourceIndependentOracleProjection(projection) {
  return Object.fromEntries(
    Object.entries(SOURCE_INDEPENDENT_ORACLE_REGISTRY_FIELDS).map(
      ([name, fields]) => [
        name,
        projection[name].map((values) => {
          assert.equal(values.length, fields.length, name);
          return Object.fromEntries(
            fields.map((field, index) => [field, values[index]]),
          );
        }),
      ],
    ),
  );
}

// This deliberately does not call any generate* function above. It derives a
// differently shaped tuple projection from the pinned fixture, then the test
// below reconstructs full records from the separately pinned field inventory.
function independentlyReconstructSourceIndependentOracleProjection(
  requirements,
) {
  assertPinnedSourceIndependentOracleFixture(requirements);
  const sequenceRows = Object.entries(requirements.legalSequences).map(
    ([id, symbols]) => ({
      id,
      mode: id[0] === "R" ? "RECOVERY_ONLY" : "NORMAL",
      symbols: [...symbols],
    }),
  );
  const inputKinds = new Set(requirements.vocabularies.inputKinds);
  const statusStates = new Set(requirements.vocabularies.statusStates);
  const terminalReasons = new Set(requirements.vocabularies.terminalReasons);
  const wireInputKinds = new Set(
    Object.keys(requirements.frameFields).filter((name) =>
      inputKinds.has(name),
    ),
  );
  const statusParts = (symbol) => {
    const terminal = /^CONTROL_TERMINAL\(([^()]+)\)$/u.exec(symbol);
    if (terminal !== null) {
      assert.equal(terminalReasons.has(terminal[1]), true);
      return { state: "CONTROL_TERMINAL", terminalReason: terminal[1] };
    }
    if (symbol !== "CONTROL_TERMINAL" && statusStates.has(symbol)) {
      return { state: symbol, terminalReason: null };
    }
    return null;
  };
  const isWire = (symbol) =>
    wireInputKinds.has(symbol) || statusParts(symbol) !== null;
  const identifier = (family, index) =>
    `${family}-${String(index).padStart(2, "0")}`;

  const prefixBuilders = [];
  const prefixBuilderBySymbols = new Map();
  const observePrefix = (row, symbols) => {
    const key = JSON.stringify(symbols);
    let builder = prefixBuilderBySymbols.get(key);
    if (builder === undefined) {
      builder = {
        mode: row.mode,
        symbols: [...symbols],
        sourceSequences: [],
      };
      prefixBuilderBySymbols.set(key, builder);
      prefixBuilders.push(builder);
    }
    assert.equal(builder.mode, row.mode);
    if (!builder.sourceSequences.includes(row.id)) {
      builder.sourceSequences.push(row.id);
    }
  };
  for (const row of sequenceRows.filter(
    ({ mode }) => mode === "RECOVERY_ONLY",
  )) {
    observePrefix(row, []);
  }
  for (const row of sequenceRows) {
    for (let length = 1; length < row.symbols.length; length += 1) {
      observePrefix(row, row.symbols.slice(0, length));
    }
  }
  const acceptedSymbolicPrefixObservations = prefixBuilders.map(
    (builder, index) => ({
      id: identifier("symbolic-prefix", index),
      kind:
        builder.symbols.length === 0
          ? "RECOVERY_INITIALIZATION_EMPTY"
          : "NONEMPTY_PROPER_PREFIX",
      mode: builder.mode,
      symbols: builder.symbols,
      sourceSequences: builder.sourceSequences,
    }),
  );
  const prefixId = new Map(
    acceptedSymbolicPrefixObservations.map(({ id, symbols }) => [
      JSON.stringify(symbols),
      id,
    ]),
  );

  const transitionCandidates = [];
  for (const row of sequenceRows) {
    transitionCandidates.push({
      acceptedPrefix:
        row.mode === "RECOVERY_ONLY" ? [] : row.symbols.slice(0, 1),
      beforePrefix: [],
      emittedStatuses:
        row.mode === "RECOVERY_ONLY" ? [] : row.symbols.slice(0, 1),
      mode: row.mode,
      operation: "INITIALIZE",
      sequenceId: row.id,
    });
    for (const [index, operation] of row.symbols.entries()) {
      if (!inputKinds.has(operation)) continue;
      const nextInputOffset = row.symbols
        .slice(index + 1)
        .findIndex((symbol) => inputKinds.has(symbol));
      const end =
        nextInputOffset === -1
          ? row.symbols.length
          : index + 1 + nextInputOffset;
      transitionCandidates.push({
        acceptedPrefix: row.symbols.slice(0, end),
        beforePrefix: row.symbols.slice(0, index),
        emittedStatuses: row.symbols.slice(index + 1, end),
        mode: row.mode,
        operation,
        sequenceId: row.id,
      });
    }
  }
  const transitionBuilders = [];
  const transitionBuilderByPrefix = new Map();
  for (const candidate of transitionCandidates) {
    const key = JSON.stringify(candidate.acceptedPrefix);
    let builder = transitionBuilderByPrefix.get(key);
    if (builder === undefined) {
      builder = {
        acceptedPrefix: candidate.acceptedPrefix,
        beforePrefix: candidate.beforePrefix,
        emittedStatuses: candidate.emittedStatuses,
        mode: candidate.mode,
        operation: candidate.operation,
        sourceSequences: [],
      };
      transitionBuilderByPrefix.set(key, builder);
      transitionBuilders.push(builder);
    }
    assert.deepEqual(
      [
        builder.mode,
        builder.operation,
        builder.beforePrefix,
        builder.emittedStatuses,
      ],
      [
        candidate.mode,
        candidate.operation,
        candidate.beforePrefix,
        candidate.emittedStatuses,
      ],
    );
    if (!builder.sourceSequences.includes(candidate.sequenceId)) {
      builder.sourceSequences.push(candidate.sequenceId);
    }
  }
  const phaseAfter = (operation, mode) => {
    if (operation === "INITIALIZE") {
      return mode === "NORMAL"
        ? "WAITING_NORMAL_INPUT"
        : "WAITING_RECOVERY_REQUEST";
    }
    if (operation === "ADMIT") return "WAITING_NORMAL_INPUT";
    if (operation === "RECOVERY_REQUEST") return "WAITING_RECOVERY_HANDOFF";
    if (operation === "STATUS_EOF") return "TRANSCRIPT_TERMINAL";
    return "CONTROL_TERMINAL_EMITTED";
  };
  const wholeTransitionStateGoldenDesigns = transitionBuilders.map(
    (builder, index) => {
      const wireSymbols = builder.acceptedPrefix.filter(isWire);
      const terminal = builder.acceptedPrefix
        .map(statusParts)
        .filter((parts) => parts?.state === "CONTROL_TERMINAL")
        .at(-1);
      return {
        id: identifier("whole-transition-state", index),
        mode: builder.mode,
        operation: builder.operation,
        beforePrefix: builder.beforePrefix,
        emittedStatuses: builder.emittedStatuses,
        acceptedPrefix: builder.acceptedPrefix,
        acceptedPrefixObservationId:
          prefixId.get(JSON.stringify(builder.acceptedPrefix)) ?? null,
        sourceSequences: builder.sourceSequences,
        statusFrameCount: builder.emittedStatuses.length,
        successorPhase: phaseAfter(builder.operation, builder.mode),
        nextWireSequence: wireSymbols.length,
        lastWireSymbol: wireSymbols.at(-1) ?? "GENESIS",
        eventCount: builder.acceptedPrefix.length,
        admissionCount: builder.acceptedPrefix.includes("ADMIT") ? 1 : 0,
        cancelObserved: builder.acceptedPrefix.includes("CANCEL"),
        controllerClosedObserved:
          builder.acceptedPrefix.includes("CONTROLLER_CLOSED"),
        diagnosticFailureObserved:
          builder.acceptedPrefix.includes("DIAGNOSTIC_FAILURE"),
        recoveryControlHandoffObserved: builder.acceptedPrefix.includes(
          "RECOVERY_CONTROL_HANDOFF",
        ),
        controlTerminalReason: terminal?.terminalReason ?? null,
        statusEofObserved: builder.acceptedPrefix.includes("STATUS_EOF"),
        transcriptTerminal: builder.operation === "STATUS_EOF",
      };
    },
  );

  const statusCandidates = sequenceRows.flatMap((row) =>
    row.symbols.flatMap((symbol, index) => {
      const parts = statusParts(symbol);
      if (parts === null) return [];
      const prefix = row.symbols.slice(0, index + 1);
      const priorWireSymbols = row.symbols.slice(0, index).filter(isWire);
      return [
        {
          admissionFrameBinding: prefix.includes("ADMIT") ? "PRESENT" : "NULL",
          mode: row.mode,
          prefix,
          previousWireSymbol: priorWireSymbols.at(-1) ?? "GENESIS",
          recoveryRequestFrameBinding: prefix.includes("RECOVERY_REQUEST")
            ? "PRESENT"
            : "NULL",
          sequenceId: row.id,
          state: parts.state,
          terminalReason: parts.terminalReason,
          wireSequence: priorWireSymbols.length,
        },
      ];
    }),
  );
  const statusBuilders = [];
  const statusBuilderByPrefix = new Map();
  for (const candidate of statusCandidates) {
    const key = JSON.stringify(candidate.prefix);
    let builder = statusBuilderByPrefix.get(key);
    if (builder === undefined) {
      builder = {
        admissionFrameBinding: candidate.admissionFrameBinding,
        mode: candidate.mode,
        prefix: candidate.prefix,
        previousWireSymbol: candidate.previousWireSymbol,
        recoveryRequestFrameBinding: candidate.recoveryRequestFrameBinding,
        sourceSequences: [],
        state: candidate.state,
        terminalReason: candidate.terminalReason,
        wireSequence: candidate.wireSequence,
      };
      statusBuilderByPrefix.set(key, builder);
      statusBuilders.push(builder);
    }
    if (!builder.sourceSequences.includes(candidate.sequenceId)) {
      builder.sourceSequences.push(candidate.sequenceId);
    }
  }
  const emittedStatusByteGoldenDesigns = statusBuilders.map(
    (builder, index) => ({
      id: identifier("emitted-status-byte", index),
      mode: builder.mode,
      state: builder.state,
      terminalReason: builder.terminalReason,
      prefix: builder.prefix,
      acceptedPrefixObservationId: prefixId.get(JSON.stringify(builder.prefix)),
      wireSequence: builder.wireSequence,
      previousWireSymbol: builder.previousWireSymbol,
      admissionFrameBinding: builder.admissionFrameBinding,
      recoveryRequestFrameBinding: builder.recoveryRequestFrameBinding,
      sourceSequences: builder.sourceSequences,
    }),
  );
  const statusDesignId = new Map(
    emittedStatusByteGoldenDesigns.map(({ id, prefix }) => [
      JSON.stringify(prefix),
      id,
    ]),
  );
  const atomicTwoStatusWirePrefixControls = wholeTransitionStateGoldenDesigns
    .filter(({ emittedStatuses }) => emittedStatuses.length === 2)
    .map((transition, index) => {
      const firstStatusPrefix = [
        ...transition.beforePrefix,
        transition.operation,
        transition.emittedStatuses[0],
      ];
      return {
        id: identifier("atomic-two-status-wire-prefix", index),
        mode: transition.mode,
        operation: transition.operation,
        beforePrefix: transition.beforePrefix,
        firstStatus: transition.emittedStatuses[0],
        secondStatus: transition.emittedStatuses[1],
        firstStatusPrefix,
        completeTransitionPrefix: transition.acceptedPrefix,
        firstStatusObservationId: prefixId.get(
          JSON.stringify(firstStatusPrefix),
        ),
        completeTransitionObservationId: transition.acceptedPrefixObservationId,
        firstStatusDesignId: statusDesignId.get(
          JSON.stringify(firstStatusPrefix),
        ),
        secondStatusDesignId: statusDesignId.get(
          JSON.stringify(transition.acceptedPrefix),
        ),
        publicIntermediateState: false,
      };
    });

  const descriptorAliasControls = [];
  const addAlias = (family, mode, leftSlot, rightSlot) => {
    descriptorAliasControls.push({
      id: `descriptor-alias:${family}:${leftSlot}:${rightSlot}`,
      family,
      mode,
      leftSlot,
      rightSlot,
    });
  };
  for (let left = 0; left < requirements.admissionRights.count; left += 1) {
    for (
      let right = left + 1;
      right < requirements.admissionRights.count;
      right += 1
    ) {
      addAlias(
        "ADMISSION_RIGHT_PAIR",
        "NORMAL",
        `right${left}`,
        `right${right}`,
      );
    }
  }
  for (let left = 0; left < requirements.admissionRights.count; left += 1) {
    for (
      let startup = 0;
      startup < requirements.startupMaps.normalDescriptorCount;
      startup += 1
    ) {
      addAlias(
        "ADMISSION_RIGHT_TO_NORMAL_STARTUP",
        "NORMAL",
        `right${left}`,
        `fd${startup}`,
      );
    }
  }
  for (
    let left = 0;
    left < requirements.startupMaps.normalDescriptorCount;
    left += 1
  ) {
    for (
      let right = left + 1;
      right < requirements.startupMaps.normalDescriptorCount;
      right += 1
    ) {
      addAlias("NORMAL_STARTUP_PAIR", "NORMAL", `fd${left}`, `fd${right}`);
    }
  }
  for (
    let left = 0;
    left < requirements.startupMaps.recoveryOnlyDescriptorCount;
    left += 1
  ) {
    for (
      let right = left + 1;
      right < requirements.startupMaps.recoveryOnlyDescriptorCount;
      right += 1
    ) {
      addAlias(
        "RECOVERY_STARTUP_PAIR",
        "RECOVERY_ONLY",
        `fd${left}`,
        `fd${right}`,
      );
    }
  }

  const constructibleFailurePrecedencePairs =
    EXPECTED_CONSTRUCTIBLE_FAILURE_PRECEDENCE_PAIR_IDS.map((id) => {
      const [earlier, later] = id.split("-before-");
      const witnessOperations =
        FAILURE_PRECEDENCE_CONSTRUCTOR_APPLICABILITY.filter(
          ({ codes }) => codes.includes(earlier) && codes.includes(later),
        ).map(({ operation }) => operation);
      assert.notEqual(witnessOperations.length, 0, id);
      return { id, earlier, later, witnessOperations };
    });

  return projectSourceIndependentOracleRegistries({
    wholeTransitionStateGoldenDesigns,
    emittedStatusByteGoldenDesigns,
    atomicTwoStatusWirePrefixControls,
    acceptedSymbolicPrefixObservations,
    descriptorAliasControls,
    constructibleFailurePrecedencePairs,
  });
}

export function createSourceIndependentAdversarialOracle(requirements) {
  assertPinnedSourceIndependentOracleFixture(requirements);
  const sequenceEntries = frozenSequenceEntries(requirements);
  const acceptedSymbolicPrefixObservations =
    generateAcceptedSymbolicPrefixObservations(sequenceEntries);
  const wholeTransitionStateGoldenDesigns =
    generateWholeTransitionStateGoldenDesigns(
      requirements,
      sequenceEntries,
      acceptedSymbolicPrefixObservations,
    );
  const emittedStatusByteGoldenDesigns = generateEmittedStatusByteGoldenDesigns(
    requirements,
    sequenceEntries,
    acceptedSymbolicPrefixObservations,
  );
  const atomicTwoStatusWirePrefixControls =
    generateAtomicTwoStatusWirePrefixControls(
      wholeTransitionStateGoldenDesigns,
      emittedStatusByteGoldenDesigns,
      acceptedSymbolicPrefixObservations,
    );
  const descriptorAliasControls = generateDescriptorAliasControls(requirements);
  const constructibleFailurePrecedencePairs =
    generateConstructibleFailurePrecedencePairs(requirements);
  const registries = Object.freeze({
    wholeTransitionStateGoldenDesigns,
    emittedStatusByteGoldenDesigns,
    atomicTwoStatusWirePrefixControls,
    acceptedSymbolicPrefixObservations,
    descriptorAliasControls,
    constructibleFailurePrecedencePairs,
  });
  const counts = inventoryCounts(registries);
  const inventorySha256 = inventoryDigests(registries);
  assert.deepEqual(counts, EXPECTED_SOURCE_INDEPENDENT_ORACLE_COUNTS);
  assert.deepEqual(
    inventorySha256,
    EXPECTED_SOURCE_INDEPENDENT_ORACLE_INVENTORY_SHA256,
  );
  return Object.freeze({
    schema: SOURCE_INDEPENDENT_ADVERSARIAL_ORACLE_SCHEMA,
    requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
    counts,
    inventorySha256,
    registries,
    construction: Object.freeze({
      fixtureDerived: true,
      constructorApplicabilityProvenancePinned: true,
      candidateInputAccepted: false,
      candidateModuleReadByGenerator: false,
      candidateModuleImportedByGenerator: false,
      candidateModuleEvaluatedByGenerator: false,
      candidateBehaviorExecuted: false,
      wholeTransitionValuesMaterialized: false,
      emittedStatusBytesMaterialized: false,
    }),
    failurePrecedenceFoundation: Object.freeze({
      constructorApplicability: FAILURE_PRECEDENCE_CONSTRUCTOR_APPLICABILITY,
      constructiblePairIds: EXPECTED_CONSTRUCTIBLE_FAILURE_PRECEDENCE_PAIR_IDS,
      excludedPairIds: EXCLUDED_FAILURE_PRECEDENCE_PAIR_IDS,
    }),
  });
}

function createStatusOracleConstructionBinding(spec) {
  assert.equal(typeof spec.id, "string");
  assert.equal(typeof spec.value, "string");
  let bytes;
  let jsonl = null;
  if (spec.format === "CANONICAL_JSONL") {
    assert.equal(spec.value.endsWith("\n"), true);
    assert.equal(spec.value.slice(0, -1).includes("\n"), false);
    assert.equal(spec.value.includes("\r"), false);
    assert.equal(
      spec.value,
      `${canonicalJson(JSON.parse(spec.value))}\n`,
      spec.id,
    );
    jsonl = spec.value;
    bytes = Buffer.from(jsonl, "utf8");
  } else {
    assert.equal(spec.format, "RAW_HEX");
    assert.match(spec.value, /^(?:[0-9a-f]{2})+$/u);
    bytes = Buffer.from(spec.value, "hex");
    assert.equal(bytes.toString("hex"), spec.value);
  }
  const rawSha256 = byteDigest(bytes);
  assert.equal(rawSha256, EXPECTED_STATUS_ORACLE_BINDING_SHA256[spec.id]);
  return Object.freeze({
    id: spec.id,
    format: spec.format,
    jsonl,
    bytesHex: bytes.toString("hex"),
    byteLength: bytes.length,
    rawSha256,
  });
}

function createStatusOracleConstructionContext() {
  const bindings = Object.freeze(
    Object.fromEntries(
      STATUS_ORACLE_CONSTRUCTION_PREIMAGE_SPECS.map((spec) => {
        const binding = createStatusOracleConstructionBinding(spec);
        return [binding.id, binding];
      }),
    ),
  );
  assert.equal(Object.keys(bindings).length, 8);
  assert.equal(
    new Set(Object.values(bindings).map(({ rawSha256 }) => rawSha256)).size,
    8,
  );
  assert.equal(bindings["normal-epoch"].byteLength, 32);
  assert.equal(bindings["recovery-only-epoch"].byteLength, 32);
  const projection = {
    schema: STATUS_ORACLE_CONSTRUCTION_CONTEXT_SCHEMA,
    requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
    previousFrameGenesisSha256: "0".repeat(64),
    bindings,
    modeBindings: Object.freeze({
      NORMAL: Object.freeze({
        startupReportBindingId: "normal-startup-report",
        epochBindingId: "normal-epoch",
      }),
      RECOVERY_ONLY: Object.freeze({
        startupReportBindingId: "recovery-only-startup-report",
        epochBindingId: "recovery-only-epoch",
      }),
    }),
    priorWireBindings: Object.freeze({
      ADMIT: "normal-admission-frame",
      CANCEL_WITHOUT_ADMISSION: "normal-cancel-without-admission-frame",
      CANCEL_AFTER_ADMISSION: "normal-cancel-after-admission-frame",
      RECOVERY_REQUEST: "recovery-only-request-frame",
    }),
  };
  const identitySha256 = digest(projection);
  assert.equal(
    identitySha256,
    EXPECTED_STATUS_ORACLE_CONSTRUCTION_CONTEXT_SHA256,
  );
  return recursivelyFreezeStatusOracleValue({
    ...projection,
    identitySha256,
  });
}

function statusOracleBinding(context, bindingId) {
  assert.equal(Object.hasOwn(context.bindings, bindingId), true, bindingId);
  return context.bindings[bindingId];
}

function statusOracleModeDigests(context, mode) {
  const modeBinding = context.modeBindings[mode];
  assert.notEqual(modeBinding, undefined, mode);
  return Object.freeze({
    startupSha256: statusOracleBinding(
      context,
      modeBinding.startupReportBindingId,
    ).rawSha256,
    epochSha256: statusOracleBinding(context, modeBinding.epochBindingId)
      .rawSha256,
  });
}

function primaryPrefixObservationIdFromLegalSequences(
  requirements,
  targetSymbols,
) {
  const targetKey = canonicalJson(targetSymbols);
  const observedKeys = new Set();
  let matchedId;
  const observe = (mode, symbols, sequenceId) => {
    const key = canonicalJson(symbols);
    if (observedKeys.has(key)) return;
    const id = paddedId("symbolic-prefix", observedKeys.size);
    observedKeys.add(key);
    if (key === targetKey) matchedId = id;
    assert.equal(typeof mode, "string");
    assert.equal(typeof sequenceId, "string");
  };
  const sequenceRows = Object.entries(requirements.legalSequences).map(
    ([id, symbols]) => ({ id, mode: sequenceMode(id), symbols }),
  );
  for (const row of sequenceRows) {
    if (row.mode === "RECOVERY_ONLY") observe(row.mode, [], row.id);
  }
  for (const row of sequenceRows) {
    for (let length = 1; length < row.symbols.length; length += 1) {
      observe(row.mode, row.symbols.slice(0, length), row.id);
    }
  }
  assert.equal(observedKeys.size, 26);
  assert.notEqual(matchedId, undefined, targetKey);
  return matchedId;
}

function primaryPreviousWireSha256FromStatusPrefix(
  requirements,
  context,
  design,
  statusByPrefix,
) {
  const preceding = design.prefix.slice(0, -1);
  for (let index = preceding.length - 1; index >= 0; index -= 1) {
    const symbol = preceding[index];
    if (symbol === "ADMIT") {
      assert.equal(design.previousWireSymbol, symbol);
      return statusOracleBinding(context, context.priorWireBindings.ADMIT)
        .rawSha256;
    }
    if (symbol === "CANCEL") {
      assert.equal(design.previousWireSymbol, symbol);
      const key = design.prefix.includes("ADMIT")
        ? "CANCEL_AFTER_ADMISSION"
        : "CANCEL_WITHOUT_ADMISSION";
      return statusOracleBinding(context, context.priorWireBindings[key])
        .rawSha256;
    }
    if (symbol === "RECOVERY_REQUEST") {
      assert.equal(design.previousWireSymbol, symbol);
      return statusOracleBinding(
        context,
        context.priorWireBindings.RECOVERY_REQUEST,
      ).rawSha256;
    }
    if (terminalStatusParts(requirements, symbol) !== null) {
      assert.equal(design.previousWireSymbol, symbol);
      const priorStatus = statusByPrefix.get(
        canonicalJson(preceding.slice(0, index + 1)),
      );
      assert.notEqual(priorStatus, undefined, design.id);
      return priorStatus.rawSha256;
    }
  }
  assert.equal(design.previousWireSymbol, "GENESIS");
  return context.previousFrameGenesisSha256;
}

function statusEntryIdentityProjection(entry) {
  return {
    schema: STATUS_ORACLE_ENTRY_IDENTITY_SCHEMA,
    id: entry.id,
    designId: entry.designId,
    designSha256: entry.designSha256,
    acceptedPrefixObservationId: entry.acceptedPrefixObservationId,
    prefix: entry.prefix,
    sourceSequences: entry.sourceSequences,
    frameFields: EXPECTED_STATUS_FRAME_FIELDS,
    frame: entry.frame,
    canonicalJsonl: entry.canonicalJsonl,
    byteLength: entry.byteLength,
    frameSha256: entry.frameSha256,
    rawSha256: entry.rawSha256,
  };
}

function materializePrimaryStatusEntriesFromLegalSequences(
  requirements,
  context,
) {
  assert.deepEqual(
    requirements.frameFields.STATUS,
    EXPECTED_STATUS_FRAME_FIELDS,
  );
  assert.equal(
    context.previousFrameGenesisSha256,
    requirements.vocabularies.previousFrameGenesisSha256,
  );
  const plans = [];
  const planByPrefix = new Map();
  for (const [sequenceId, symbols] of Object.entries(
    requirements.legalSequences,
  )) {
    const mode = sequenceMode(sequenceId);
    for (let index = 0; index < symbols.length; index += 1) {
      const parts = terminalStatusParts(requirements, symbols[index]);
      if (parts === null) continue;
      const prefix = symbols.slice(0, index + 1);
      const key = canonicalJson(prefix);
      const precedingWireSymbols = symbols
        .slice(0, index)
        .filter((symbol) => isWireSymbol(requirements, symbol));
      const candidate = {
        mode,
        state: parts.state,
        terminalReason: parts.terminalReason,
        prefix,
        acceptedPrefixObservationId:
          primaryPrefixObservationIdFromLegalSequences(requirements, prefix),
        wireSequence: precedingWireSymbols.length,
        previousWireSymbol: precedingWireSymbols.at(-1) ?? "GENESIS",
        admissionFrameBinding: prefix.includes("ADMIT") ? "PRESENT" : "NULL",
        recoveryRequestFrameBinding: prefix.includes("RECOVERY_REQUEST")
          ? "PRESENT"
          : "NULL",
        sourceSequences: [],
      };
      assert.notEqual(candidate.acceptedPrefixObservationId, undefined, key);
      let plan = planByPrefix.get(key);
      if (plan === undefined) {
        plan = candidate;
        planByPrefix.set(key, plan);
        plans.push(plan);
      } else {
        assert.deepEqual(
          { ...plan, sourceSequences: [] },
          { ...candidate, sourceSequences: [] },
        );
      }
      if (!plan.sourceSequences.includes(sequenceId)) {
        plan.sourceSequences.push(sequenceId);
      }
    }
  }
  assert.equal(plans.length, 15);

  const statusByPrefix = new Map();
  const designProjections = [];
  const entries = plans.map((plan, index) => {
    const design = {
      id: paddedId("emitted-status-byte", index),
      mode: plan.mode,
      state: plan.state,
      terminalReason: plan.terminalReason,
      prefix: [...plan.prefix],
      acceptedPrefixObservationId: plan.acceptedPrefixObservationId,
      wireSequence: plan.wireSequence,
      previousWireSymbol: plan.previousWireSymbol,
      admissionFrameBinding: plan.admissionFrameBinding,
      recoveryRequestFrameBinding: plan.recoveryRequestFrameBinding,
      sourceSequences: [...plan.sourceSequences],
    };
    designProjections.push(design);
    const { startupSha256, epochSha256 } = statusOracleModeDigests(
      context,
      design.mode,
    );
    const admissionFrameSha256 = design.prefix.includes("ADMIT")
      ? statusOracleBinding(context, context.priorWireBindings.ADMIT).rawSha256
      : null;
    const recoveryRequestFrameSha256 = design.prefix.includes(
      "RECOVERY_REQUEST",
    )
      ? statusOracleBinding(context, context.priorWireBindings.RECOVERY_REQUEST)
          .rawSha256
      : null;
    const frame = {
      schema: requirements.schemas.wireFrame,
      action: "STATUS",
      mode: design.mode,
      sequence: design.wireSequence,
      previousFrameSha256: primaryPreviousWireSha256FromStatusPrefix(
        requirements,
        context,
        design,
        statusByPrefix,
      ),
      requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
      startupSha256,
      epochSha256,
      state: design.state,
      admissionFrameSha256,
      recoveryRequestFrameSha256,
      terminalReason: design.terminalReason,
    };
    assert.deepEqual(Object.keys(frame), EXPECTED_STATUS_FRAME_FIELDS);
    const frozenFrame = recursivelyFreezeStatusOracleValue(frame);
    const canonicalJsonl = `${canonicalJson(frozenFrame)}\n`;
    assert.equal(canonicalJsonl.includes("\r"), false);
    assert.equal(canonicalJsonl.slice(0, -1).includes("\n"), false);
    const bytes = Buffer.from(canonicalJsonl, "utf8");
    assert.equal(
      bytes.length <= requirements.limits.statusFrameMaximumBytes,
      true,
    );
    const draft = {
      id: design.id,
      designId: design.id,
      designSha256: digest(design),
      acceptedPrefixObservationId: design.acceptedPrefixObservationId,
      prefix: frozenArray(design.prefix),
      sourceSequences: frozenArray(design.sourceSequences),
      frame: frozenFrame,
      canonicalJsonl,
      byteLength: bytes.length,
      frameSha256: digest(frozenFrame),
      rawSha256: byteDigest(bytes),
    };
    const entry = recursivelyFreezeStatusOracleValue({
      ...draft,
      identitySha256: digest(statusEntryIdentityProjection(draft)),
    });
    statusByPrefix.set(canonicalJson(design.prefix), entry);
    return entry;
  });
  assert.equal(entries.length, 15);
  const designProjectionSha256 = digest(designProjections);
  assert.equal(
    designProjectionSha256,
    EXPECTED_PRIMARY_STATUS_DESIGN_PROJECTION_SHA256,
  );
  return {
    entries: Object.freeze(entries),
    designProjectionSha256,
  };
}

function atomicEntryIdentityProjection(entry) {
  return {
    schema: STATUS_ORACLE_ATOMIC_IDENTITY_SCHEMA,
    id: entry.id,
    designId: entry.designId,
    designSha256: entry.designSha256,
    mode: entry.mode,
    operation: entry.operation,
    beforePrefix: entry.beforePrefix,
    firstStatusPrefix: entry.firstStatusPrefix,
    completeTransitionPrefix: entry.completeTransitionPrefix,
    firstStatusObservationId: entry.firstStatusObservationId,
    completeTransitionObservationId: entry.completeTransitionObservationId,
    firstStatusDesignId: entry.firstStatusDesignId,
    secondStatusDesignId: entry.secondStatusDesignId,
    firstSequence: entry.firstSequence,
    secondSequence: entry.secondSequence,
    firstByteLength: entry.firstByteLength,
    secondByteLength: entry.secondByteLength,
    firstRawSha256: entry.firstRawSha256,
    secondRawSha256: entry.secondRawSha256,
    secondPreviousFrameSha256: entry.secondPreviousFrameSha256,
    concatenatedJsonl: entry.concatenatedJsonl,
    concatenatedByteLength: entry.concatenatedByteLength,
    concatenatedRawSha256: entry.concatenatedRawSha256,
    publicIntermediateState: entry.publicIntermediateState,
  };
}

function materializePrimaryAtomicStatusPrefixesFromLegalSequences(
  requirements,
  statusEntries,
) {
  const statusByPrefix = new Map(
    statusEntries.map((entry) => [canonicalJson(entry.prefix), entry]),
  );
  const inputKinds = new Set(requirements.vocabularies.inputKinds);
  const plans = [];
  const observedCompletePrefixes = new Set();
  for (const [sequenceId, symbols] of Object.entries(
    requirements.legalSequences,
  )) {
    const mode = sequenceMode(sequenceId);
    for (let index = 0; index < symbols.length; index += 1) {
      const operation = symbols[index];
      if (!inputKinds.has(operation)) continue;
      let end = index + 1;
      while (end < symbols.length && !inputKinds.has(symbols[end])) end += 1;
      const emittedStatuses = symbols.slice(index + 1, end);
      if (
        emittedStatuses.length !== 2 ||
        emittedStatuses.some(
          (symbol) => terminalStatusParts(requirements, symbol) === null,
        )
      ) {
        continue;
      }
      const completeTransitionPrefix = symbols.slice(0, end);
      const completeKey = canonicalJson(completeTransitionPrefix);
      if (observedCompletePrefixes.has(completeKey)) continue;
      observedCompletePrefixes.add(completeKey);
      plans.push({
        mode,
        operation,
        beforePrefix: symbols.slice(0, index),
        firstStatus: emittedStatuses[0],
        secondStatus: emittedStatuses[1],
        firstStatusPrefix: symbols.slice(0, index + 2),
        completeTransitionPrefix,
      });
    }
  }
  assert.equal(plans.length, 4);

  const designProjections = [];
  const entries = plans.map((plan, index) => {
    const id = paddedId("atomic-two-status-wire-prefix", index);
    const firstStatusKey = canonicalJson(plan.firstStatusPrefix);
    const completeKey = canonicalJson(plan.completeTransitionPrefix);
    const first = statusByPrefix.get(firstStatusKey);
    const second = statusByPrefix.get(completeKey);
    assert.notEqual(first, undefined, id);
    assert.notEqual(second, undefined, id);
    const design = {
      id,
      mode: plan.mode,
      operation: plan.operation,
      beforePrefix: [...plan.beforePrefix],
      firstStatus: plan.firstStatus,
      secondStatus: plan.secondStatus,
      firstStatusPrefix: [...plan.firstStatusPrefix],
      completeTransitionPrefix: [...plan.completeTransitionPrefix],
      firstStatusObservationId: primaryPrefixObservationIdFromLegalSequences(
        requirements,
        plan.firstStatusPrefix,
      ),
      completeTransitionObservationId:
        primaryPrefixObservationIdFromLegalSequences(
          requirements,
          plan.completeTransitionPrefix,
        ),
      firstStatusDesignId: first.id,
      secondStatusDesignId: second.id,
      publicIntermediateState: false,
    };
    assert.notEqual(design.firstStatusObservationId, undefined, id);
    assert.notEqual(design.completeTransitionObservationId, undefined, id);
    designProjections.push(design);
    assert.notEqual(first, undefined, design.id);
    assert.notEqual(second, undefined, design.id);
    assert.equal(second.frame.sequence, first.frame.sequence + 1, design.id);
    assert.equal(second.frame.previousFrameSha256, first.rawSha256, design.id);
    const concatenatedJsonl = `${first.canonicalJsonl}${second.canonicalJsonl}`;
    const concatenatedBytes = Buffer.from(concatenatedJsonl, "utf8");
    assert.equal(
      concatenatedBytes.length,
      first.byteLength + second.byteLength,
      design.id,
    );
    const draft = {
      id: design.id,
      designId: design.id,
      designSha256: digest(design),
      mode: design.mode,
      operation: design.operation,
      beforePrefix: frozenArray(design.beforePrefix),
      firstStatusPrefix: frozenArray(design.firstStatusPrefix),
      completeTransitionPrefix: frozenArray(design.completeTransitionPrefix),
      firstStatusObservationId: design.firstStatusObservationId,
      completeTransitionObservationId: design.completeTransitionObservationId,
      firstStatusDesignId: design.firstStatusDesignId,
      secondStatusDesignId: design.secondStatusDesignId,
      firstSequence: first.frame.sequence,
      secondSequence: second.frame.sequence,
      firstByteLength: first.byteLength,
      secondByteLength: second.byteLength,
      firstRawSha256: first.rawSha256,
      secondRawSha256: second.rawSha256,
      secondPreviousFrameSha256: second.frame.previousFrameSha256,
      concatenatedJsonl,
      concatenatedByteLength: concatenatedBytes.length,
      concatenatedRawSha256: byteDigest(concatenatedBytes),
      publicIntermediateState: design.publicIntermediateState,
    };
    assert.equal(draft.publicIntermediateState, false);
    return recursivelyFreezeStatusOracleValue({
      ...draft,
      identitySha256: digest(atomicEntryIdentityProjection(draft)),
    });
  });
  assert.equal(entries.length, 4);
  const designProjectionSha256 = digest(designProjections);
  assert.equal(
    designProjectionSha256,
    EXPECTED_PRIMARY_ATOMIC_DESIGN_PROJECTION_SHA256,
  );
  return {
    entries: Object.freeze(entries),
    designProjectionSha256,
  };
}

function materializedStatusEntryTuple(entry) {
  return Object.freeze([
    entry.id,
    entry.designId,
    entry.designSha256,
    entry.acceptedPrefixObservationId,
    entry.prefix,
    entry.sourceSequences,
    Object.freeze(
      EXPECTED_STATUS_FRAME_FIELDS.map((field) => entry.frame[field]),
    ),
    entry.canonicalJsonl,
    entry.byteLength,
    entry.frameSha256,
    entry.rawSha256,
    entry.identitySha256,
  ]);
}

function materializedAtomicEntryTuple(entry) {
  return Object.freeze([
    entry.id,
    entry.designId,
    entry.designSha256,
    entry.mode,
    entry.operation,
    entry.beforePrefix,
    entry.firstStatusPrefix,
    entry.completeTransitionPrefix,
    entry.firstStatusObservationId,
    entry.completeTransitionObservationId,
    entry.firstStatusDesignId,
    entry.secondStatusDesignId,
    entry.firstSequence,
    entry.secondSequence,
    entry.firstByteLength,
    entry.secondByteLength,
    entry.firstRawSha256,
    entry.secondRawSha256,
    entry.secondPreviousFrameSha256,
    entry.concatenatedJsonl,
    entry.concatenatedByteLength,
    entry.concatenatedRawSha256,
    entry.publicIntermediateState,
    entry.identitySha256,
  ]);
}

function independentlyCanonicalizeStatusOracleJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    let encoded = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) encoded += ",";
      encoded += independentlyCanonicalizeStatusOracleJson(value[index]);
    }
    return `${encoded}]`;
  }
  assert.equal(typeof value, "object");
  const keys = Object.keys(value).sort();
  let encoded = "{";
  for (let index = 0; index < keys.length; index += 1) {
    if (index > 0) encoded += ",";
    const key = keys[index];
    encoded += `${JSON.stringify(key)}:${independentlyCanonicalizeStatusOracleJson(value[key])}`;
  }
  return `${encoded}}`;
}

function independentlyDigestStatusOracleValue(value) {
  return createHash("sha256")
    .update(
      Buffer.from(independentlyCanonicalizeStatusOracleJson(value), "utf8"),
    )
    .digest("hex");
}

function independentlyDigestStatusOracleBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function independentlyParseStatusSymbol(requirements, symbol) {
  const terminal = /^CONTROL_TERMINAL\(([^()]+)\)$/u.exec(symbol);
  if (terminal !== null) {
    assert.equal(
      requirements.vocabularies.terminalReasons.includes(terminal[1]),
      true,
    );
    return { state: "CONTROL_TERMINAL", terminalReason: terminal[1] };
  }
  if (
    symbol !== "CONTROL_TERMINAL" &&
    requirements.vocabularies.statusStates.includes(symbol)
  ) {
    return { state: symbol, terminalReason: null };
  }
  return null;
}

// This reconstruction deliberately walks legalSequences directly. It does not
// consume the primary status-design registry, either primary materializer, or
// either primary identity encoder above.
function independentlyReconstructMaterializedStatusTuples(
  requirements,
  context,
) {
  assert.deepEqual(
    requirements.frameFields.STATUS,
    EXPECTED_STATUS_FRAME_FIELDS,
  );
  const identifier = (family, index) =>
    `${family}-${String(index).padStart(2, "0")}`;
  const sequenceRows = Object.entries(requirements.legalSequences).map(
    ([id, symbols]) => ({
      id,
      mode: id.startsWith("R") ? "RECOVERY_ONLY" : "NORMAL",
      symbols: [...symbols],
    }),
  );

  const prefixBuilders = [];
  const prefixByKey = new Map();
  const observePrefix = (row, symbols) => {
    const key = JSON.stringify(symbols);
    let builder = prefixByKey.get(key);
    if (builder === undefined) {
      builder = { mode: row.mode, symbols: [...symbols], sourceSequences: [] };
      prefixByKey.set(key, builder);
      prefixBuilders.push(builder);
    }
    assert.equal(builder.mode, row.mode);
    if (!builder.sourceSequences.includes(row.id)) {
      builder.sourceSequences.push(row.id);
    }
  };
  for (const row of sequenceRows) {
    if (row.mode === "RECOVERY_ONLY") observePrefix(row, []);
  }
  for (const row of sequenceRows) {
    for (let length = 1; length < row.symbols.length; length += 1) {
      observePrefix(row, row.symbols.slice(0, length));
    }
  }
  const prefixIdByKey = new Map(
    prefixBuilders.map(({ symbols }, index) => [
      JSON.stringify(symbols),
      identifier("symbolic-prefix", index),
    ]),
  );
  assert.equal(prefixIdByKey.size, 26);

  const statusBuilders = [];
  const statusBuilderByPrefix = new Map();
  for (const row of sequenceRows) {
    const modeBinding = context.modeBindings[row.mode];
    const startupSha256 =
      context.bindings[modeBinding.startupReportBindingId].rawSha256;
    const epochSha256 = context.bindings[modeBinding.epochBindingId].rawSha256;
    let sequence = 0;
    let previousFrameSha256 = context.previousFrameGenesisSha256;
    let previousWireSymbol = "GENESIS";
    let admissionFrameSha256 = null;
    let recoveryRequestFrameSha256 = null;
    for (let index = 0; index < row.symbols.length; index += 1) {
      const symbol = row.symbols[index];
      const status = independentlyParseStatusSymbol(requirements, symbol);
      if (status !== null) {
        const prefix = row.symbols.slice(0, index + 1);
        const frame = {
          schema: requirements.schemas.wireFrame,
          action: "STATUS",
          mode: row.mode,
          sequence,
          previousFrameSha256,
          requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
          startupSha256,
          epochSha256,
          state: status.state,
          admissionFrameSha256,
          recoveryRequestFrameSha256,
          terminalReason: status.terminalReason,
        };
        assert.deepEqual(Object.keys(frame), EXPECTED_STATUS_FRAME_FIELDS);
        const canonicalJsonl = `${independentlyCanonicalizeStatusOracleJson(frame)}\n`;
        const bytes = Buffer.from(canonicalJsonl, "utf8");
        const candidate = {
          admissionFrameBinding:
            admissionFrameSha256 === null ? "NULL" : "PRESENT",
          mode: row.mode,
          prefix,
          previousWireSymbol,
          recoveryRequestFrameBinding:
            recoveryRequestFrameSha256 === null ? "NULL" : "PRESENT",
          sourceSequences: [],
          state: status.state,
          terminalReason: status.terminalReason,
          wireSequence: sequence,
          frame,
          canonicalJsonl,
          byteLength: bytes.length,
          frameSha256: independentlyDigestStatusOracleValue(frame),
          rawSha256: independentlyDigestStatusOracleBytes(bytes),
        };
        const key = JSON.stringify(prefix);
        let builder = statusBuilderByPrefix.get(key);
        if (builder === undefined) {
          builder = candidate;
          statusBuilderByPrefix.set(key, builder);
          statusBuilders.push(builder);
        } else {
          assert.deepEqual(
            { ...builder, sourceSequences: [] },
            { ...candidate, sourceSequences: [] },
          );
        }
        if (!builder.sourceSequences.includes(row.id)) {
          builder.sourceSequences.push(row.id);
        }
        previousFrameSha256 = candidate.rawSha256;
        previousWireSymbol = symbol;
        sequence += 1;
        continue;
      }

      if (symbol === "ADMIT") {
        previousFrameSha256 =
          context.bindings[context.priorWireBindings.ADMIT].rawSha256;
        admissionFrameSha256 = previousFrameSha256;
      } else if (symbol === "CANCEL") {
        const bindingKey =
          admissionFrameSha256 === null
            ? "CANCEL_WITHOUT_ADMISSION"
            : "CANCEL_AFTER_ADMISSION";
        previousFrameSha256 =
          context.bindings[context.priorWireBindings[bindingKey]].rawSha256;
      } else if (symbol === "RECOVERY_REQUEST") {
        previousFrameSha256 =
          context.bindings[context.priorWireBindings.RECOVERY_REQUEST]
            .rawSha256;
        recoveryRequestFrameSha256 = previousFrameSha256;
      } else {
        continue;
      }
      previousWireSymbol = symbol;
      sequence += 1;
    }
  }
  assert.equal(statusBuilders.length, 15);

  const independentStatusByPrefix = new Map();
  const statusTuples = statusBuilders.map((builder, index) => {
    const id = identifier("emitted-status-byte", index);
    const acceptedPrefixObservationId = prefixIdByKey.get(
      JSON.stringify(builder.prefix),
    );
    assert.notEqual(acceptedPrefixObservationId, undefined, id);
    const design = {
      id,
      mode: builder.mode,
      state: builder.state,
      terminalReason: builder.terminalReason,
      prefix: builder.prefix,
      acceptedPrefixObservationId,
      wireSequence: builder.wireSequence,
      previousWireSymbol: builder.previousWireSymbol,
      admissionFrameBinding: builder.admissionFrameBinding,
      recoveryRequestFrameBinding: builder.recoveryRequestFrameBinding,
      sourceSequences: builder.sourceSequences,
    };
    const draft = {
      id,
      designId: id,
      designSha256: independentlyDigestStatusOracleValue(design),
      acceptedPrefixObservationId,
      prefix: builder.prefix,
      sourceSequences: builder.sourceSequences,
      frame: builder.frame,
      canonicalJsonl: builder.canonicalJsonl,
      byteLength: builder.byteLength,
      frameSha256: builder.frameSha256,
      rawSha256: builder.rawSha256,
    };
    const identityProjection = {
      schema: STATUS_ORACLE_ENTRY_IDENTITY_SCHEMA,
      id: draft.id,
      designId: draft.designId,
      designSha256: draft.designSha256,
      acceptedPrefixObservationId: draft.acceptedPrefixObservationId,
      prefix: draft.prefix,
      sourceSequences: draft.sourceSequences,
      frameFields: EXPECTED_STATUS_FRAME_FIELDS,
      frame: draft.frame,
      canonicalJsonl: draft.canonicalJsonl,
      byteLength: draft.byteLength,
      frameSha256: draft.frameSha256,
      rawSha256: draft.rawSha256,
    };
    const entry = {
      ...draft,
      identitySha256: independentlyDigestStatusOracleValue(identityProjection),
    };
    independentStatusByPrefix.set(JSON.stringify(builder.prefix), entry);
    return [
      entry.id,
      entry.designId,
      entry.designSha256,
      entry.acceptedPrefixObservationId,
      entry.prefix,
      entry.sourceSequences,
      EXPECTED_STATUS_FRAME_FIELDS.map((field) => entry.frame[field]),
      entry.canonicalJsonl,
      entry.byteLength,
      entry.frameSha256,
      entry.rawSha256,
      entry.identitySha256,
    ];
  });

  const inputKinds = new Set(requirements.vocabularies.inputKinds);
  const atomicByPrefix = new Map();
  const atomicBuilders = [];
  for (const row of sequenceRows) {
    for (let index = 0; index < row.symbols.length; index += 1) {
      const operation = row.symbols[index];
      if (!inputKinds.has(operation)) continue;
      let end = index + 1;
      while (end < row.symbols.length && !inputKinds.has(row.symbols[end])) {
        end += 1;
      }
      const emittedStatuses = row.symbols.slice(index + 1, end);
      if (
        emittedStatuses.length !== 2 ||
        emittedStatuses.some(
          (symbol) =>
            independentlyParseStatusSymbol(requirements, symbol) === null,
        )
      ) {
        continue;
      }
      const completeTransitionPrefix = row.symbols.slice(0, end);
      const key = JSON.stringify(completeTransitionPrefix);
      if (atomicByPrefix.has(key)) continue;
      const firstStatusPrefix = row.symbols.slice(0, index + 2);
      const builder = {
        mode: row.mode,
        operation,
        beforePrefix: row.symbols.slice(0, index),
        firstStatus: emittedStatuses[0],
        secondStatus: emittedStatuses[1],
        firstStatusPrefix,
        completeTransitionPrefix,
      };
      atomicByPrefix.set(key, builder);
      atomicBuilders.push(builder);
    }
  }
  assert.equal(atomicBuilders.length, 4);

  const atomicTuples = atomicBuilders.map((builder, index) => {
    const id = identifier("atomic-two-status-wire-prefix", index);
    const first = independentStatusByPrefix.get(
      JSON.stringify(builder.firstStatusPrefix),
    );
    const second = independentStatusByPrefix.get(
      JSON.stringify(builder.completeTransitionPrefix),
    );
    assert.notEqual(first, undefined, id);
    assert.notEqual(second, undefined, id);
    const firstStatusObservationId = prefixIdByKey.get(
      JSON.stringify(builder.firstStatusPrefix),
    );
    const completeTransitionObservationId = prefixIdByKey.get(
      JSON.stringify(builder.completeTransitionPrefix),
    );
    const design = {
      id,
      mode: builder.mode,
      operation: builder.operation,
      beforePrefix: builder.beforePrefix,
      firstStatus: builder.firstStatus,
      secondStatus: builder.secondStatus,
      firstStatusPrefix: builder.firstStatusPrefix,
      completeTransitionPrefix: builder.completeTransitionPrefix,
      firstStatusObservationId,
      completeTransitionObservationId,
      firstStatusDesignId: first.id,
      secondStatusDesignId: second.id,
      publicIntermediateState: false,
    };
    assert.equal(second.frame.sequence, first.frame.sequence + 1, id);
    assert.equal(second.frame.previousFrameSha256, first.rawSha256, id);
    const concatenatedJsonl = `${first.canonicalJsonl}${second.canonicalJsonl}`;
    const concatenatedBytes = Buffer.from(concatenatedJsonl, "utf8");
    const draft = {
      id,
      designId: id,
      designSha256: independentlyDigestStatusOracleValue(design),
      mode: builder.mode,
      operation: builder.operation,
      beforePrefix: builder.beforePrefix,
      firstStatusPrefix: builder.firstStatusPrefix,
      completeTransitionPrefix: builder.completeTransitionPrefix,
      firstStatusObservationId,
      completeTransitionObservationId,
      firstStatusDesignId: first.id,
      secondStatusDesignId: second.id,
      firstSequence: first.frame.sequence,
      secondSequence: second.frame.sequence,
      firstByteLength: first.byteLength,
      secondByteLength: second.byteLength,
      firstRawSha256: first.rawSha256,
      secondRawSha256: second.rawSha256,
      secondPreviousFrameSha256: second.frame.previousFrameSha256,
      concatenatedJsonl,
      concatenatedByteLength: concatenatedBytes.length,
      concatenatedRawSha256:
        independentlyDigestStatusOracleBytes(concatenatedBytes),
      publicIntermediateState: false,
    };
    const identityProjection = {
      schema: STATUS_ORACLE_ATOMIC_IDENTITY_SCHEMA,
      id: draft.id,
      designId: draft.designId,
      designSha256: draft.designSha256,
      mode: draft.mode,
      operation: draft.operation,
      beforePrefix: draft.beforePrefix,
      firstStatusPrefix: draft.firstStatusPrefix,
      completeTransitionPrefix: draft.completeTransitionPrefix,
      firstStatusObservationId: draft.firstStatusObservationId,
      completeTransitionObservationId: draft.completeTransitionObservationId,
      firstStatusDesignId: draft.firstStatusDesignId,
      secondStatusDesignId: draft.secondStatusDesignId,
      firstSequence: draft.firstSequence,
      secondSequence: draft.secondSequence,
      firstByteLength: draft.firstByteLength,
      secondByteLength: draft.secondByteLength,
      firstRawSha256: draft.firstRawSha256,
      secondRawSha256: draft.secondRawSha256,
      secondPreviousFrameSha256: draft.secondPreviousFrameSha256,
      concatenatedJsonl: draft.concatenatedJsonl,
      concatenatedByteLength: draft.concatenatedByteLength,
      concatenatedRawSha256: draft.concatenatedRawSha256,
      publicIntermediateState: draft.publicIntermediateState,
    };
    const entry = {
      ...draft,
      identitySha256: independentlyDigestStatusOracleValue(identityProjection),
    };
    return [
      entry.id,
      entry.designId,
      entry.designSha256,
      entry.mode,
      entry.operation,
      entry.beforePrefix,
      entry.firstStatusPrefix,
      entry.completeTransitionPrefix,
      entry.firstStatusObservationId,
      entry.completeTransitionObservationId,
      entry.firstStatusDesignId,
      entry.secondStatusDesignId,
      entry.firstSequence,
      entry.secondSequence,
      entry.firstByteLength,
      entry.secondByteLength,
      entry.firstRawSha256,
      entry.secondRawSha256,
      entry.secondPreviousFrameSha256,
      entry.concatenatedJsonl,
      entry.concatenatedByteLength,
      entry.concatenatedRawSha256,
      entry.publicIntermediateState,
      entry.identitySha256,
    ];
  });

  return {
    statusTuples,
    atomicTuples,
    reconstruction: {
      method: "independent-legalSequences-wire-simulation-and-tuple-projection",
      primaryStatusDesignRegistryConsumed: false,
      primaryStatusBuilderConsumed: false,
      primaryAtomicBuilderConsumed: false,
      primaryStatusEncoderConsumed: false,
      primaryAtomicEncoderConsumed: false,
      statusCount: statusTuples.length,
      atomicCount: atomicTuples.length,
      statusInventorySha256: independentlyDigestStatusOracleValue(statusTuples),
      atomicInventorySha256: independentlyDigestStatusOracleValue(atomicTuples),
    },
  };
}

function createMaterializedStatusCoverageReceipt(statusEntries) {
  const modeCounts = { NORMAL: 0, RECOVERY_ONLY: 0 };
  const bindingPartitionCounts = {
    admissionOnly: 0,
    recoveryOnly: 0,
    neither: 0,
    both: 0,
  };
  let sourceSequenceMembershipCount = 0;
  for (const entry of statusEntries) {
    modeCounts[entry.frame.mode] += 1;
    const admission = entry.frame.admissionFrameSha256 !== null;
    const recovery = entry.frame.recoveryRequestFrameSha256 !== null;
    const partition = admission
      ? recovery
        ? "both"
        : "admissionOnly"
      : recovery
        ? "recoveryOnly"
        : "neither";
    bindingPartitionCounts[partition] += 1;
    sourceSequenceMembershipCount += entry.sourceSequences.length;
  }
  const receipt = {
    modeCounts,
    bindingPartitionCounts,
    sourceSequenceMembershipCount,
    uniqueRawSha256Count: new Set(
      statusEntries.map(({ rawSha256 }) => rawSha256),
    ).size,
  };
  assert.deepEqual(receipt, {
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
  return recursivelyFreezeStatusOracleValue(receipt);
}

function createAtomicNegativeControlReceipt(atomicEntries, statusEntries) {
  const statusById = new Map(statusEntries.map((entry) => [entry.id, entry]));
  const receipt = {
    controlCount: atomicEntries.length,
    reversedConcatenationMismatchCount: 0,
    firstFrameOmissionMismatchCount: 0,
    secondFrameOmissionMismatchCount: 0,
    insertedDelimiterMismatchCount: 0,
  };
  for (const entry of atomicEntries) {
    const first = statusById.get(entry.firstStatusDesignId);
    const second = statusById.get(entry.secondStatusDesignId);
    assert.notEqual(first, undefined, entry.id);
    assert.notEqual(second, undefined, entry.id);
    const negativeVariants = {
      reversedConcatenation: `${second.canonicalJsonl}${first.canonicalJsonl}`,
      firstFrameOmission: second.canonicalJsonl,
      secondFrameOmission: first.canonicalJsonl,
      insertedDelimiter: `${first.canonicalJsonl}\n${second.canonicalJsonl}`,
    };
    for (const [name, value] of Object.entries(negativeVariants)) {
      assert.notEqual(value, entry.concatenatedJsonl, `${entry.id}:${name}`);
      assert.notEqual(
        byteDigest(Buffer.from(value, "utf8")),
        entry.concatenatedRawSha256,
        `${entry.id}:${name}`,
      );
    }
    receipt.reversedConcatenationMismatchCount += 1;
    receipt.firstFrameOmissionMismatchCount += 1;
    receipt.secondFrameOmissionMismatchCount += 1;
    receipt.insertedDelimiterMismatchCount += 1;
  }
  assert.deepEqual(receipt, {
    controlCount: 4,
    reversedConcatenationMismatchCount: 4,
    firstFrameOmissionMismatchCount: 4,
    secondFrameOmissionMismatchCount: 4,
    insertedDelimiterMismatchCount: 4,
  });
  return recursivelyFreezeStatusOracleValue(receipt);
}

export function createSourceIndependentMaterializedStatusOracle(requirements) {
  assertPinnedSourceIndependentOracleFixture(requirements);
  const constructionContext = createStatusOracleConstructionContext();
  const statusMaterialization =
    materializePrimaryStatusEntriesFromLegalSequences(
      requirements,
      constructionContext,
    );
  const emittedStatusByteGoldens = statusMaterialization.entries;
  const atomicMaterialization =
    materializePrimaryAtomicStatusPrefixesFromLegalSequences(
      requirements,
      emittedStatusByteGoldens,
    );
  const atomicTwoStatusWirePrefixes = atomicMaterialization.entries;
  const designProjectionSha256 = recursivelyFreezeStatusOracleValue({
    statuses: statusMaterialization.designProjectionSha256,
    atomicPrefixes: atomicMaterialization.designProjectionSha256,
  });
  assert.deepEqual(designProjectionSha256, {
    statuses: EXPECTED_PRIMARY_STATUS_DESIGN_PROJECTION_SHA256,
    atomicPrefixes: EXPECTED_PRIMARY_ATOMIC_DESIGN_PROJECTION_SHA256,
  });
  const statusTuples = Object.freeze(
    emittedStatusByteGoldens.map(materializedStatusEntryTuple),
  );
  const atomicTuples = Object.freeze(
    atomicTwoStatusWirePrefixes.map(materializedAtomicEntryTuple),
  );
  const independent = independentlyReconstructMaterializedStatusTuples(
    requirements,
    constructionContext,
  );
  assert.deepEqual(statusTuples, independent.statusTuples);
  assert.deepEqual(atomicTuples, independent.atomicTuples);

  const counts = Object.freeze({
    emittedStatusByteGoldens: emittedStatusByteGoldens.length,
    atomicTwoStatusWirePrefixes: atomicTwoStatusWirePrefixes.length,
  });
  assert.deepEqual(counts, {
    emittedStatusByteGoldens: 15,
    atomicTwoStatusWirePrefixes: 4,
  });
  const inventorySha256 = Object.freeze({
    emittedStatusByteGoldens: digest(statusTuples),
    atomicTwoStatusWirePrefixes: digest(atomicTuples),
  });
  assert.equal(
    inventorySha256.emittedStatusByteGoldens,
    independent.reconstruction.statusInventorySha256,
  );
  assert.equal(
    inventorySha256.atomicTwoStatusWirePrefixes,
    independent.reconstruction.atomicInventorySha256,
  );
  const statusEntryDigests = Object.freeze(
    emittedStatusByteGoldens.map(
      ({ id, frameSha256, rawSha256, identitySha256 }) =>
        Object.freeze({ id, frameSha256, rawSha256, identitySha256 }),
    ),
  );
  const atomicEntryDigests = Object.freeze(
    atomicTwoStatusWirePrefixes.map(
      ({ id, concatenatedRawSha256, identitySha256 }) =>
        Object.freeze({ id, concatenatedRawSha256, identitySha256 }),
    ),
  );
  assert.deepEqual(
    statusEntryDigests,
    EXPECTED_MATERIALIZED_STATUS_ENTRY_DIGESTS,
  );
  assert.deepEqual(
    atomicEntryDigests,
    EXPECTED_MATERIALIZED_ATOMIC_ENTRY_DIGESTS,
  );
  assert.deepEqual(
    inventorySha256,
    EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256,
  );
  const reconstruction = recursivelyFreezeStatusOracleValue({
    ...independent.reconstruction,
    independentlyReconstructedProjectionMatches: true,
  });
  const coverage = createMaterializedStatusCoverageReceipt(
    emittedStatusByteGoldens,
  );
  const atomicNegativeControls = createAtomicNegativeControlReceipt(
    atomicTwoStatusWirePrefixes,
    emittedStatusByteGoldens,
  );
  const construction = recursivelyFreezeStatusOracleValue({
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
  const statusFrameFields = recursivelyFreezeStatusOracleValue([
    ...EXPECTED_STATUS_FRAME_FIELDS,
  ]);
  const identityProjection = {
    schema: SOURCE_INDEPENDENT_MATERIALIZED_STATUS_ORACLE_SCHEMA,
    requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
    constructionContextSha256: constructionContext.identitySha256,
    statusFrameFields,
    counts,
    designProjectionSha256,
    inventorySha256,
    statusEntryDigests,
    atomicEntryDigests,
    reconstruction,
    coverage,
    atomicNegativeControls,
    construction,
  };
  const identitySha256 = digest(identityProjection);
  assert.equal(identitySha256, EXPECTED_MATERIALIZED_STATUS_ORACLE_SHA256);
  return recursivelyFreezeStatusOracleValue({
    ...identityProjection,
    constructionContext,
    emittedStatusByteGoldens,
    atomicTwoStatusWirePrefixes,
    identitySha256,
  });
}

function assertRecursivelyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(ArrayBuffer.isView(value), false);
  assert.equal(value instanceof ArrayBuffer, false);
  if (typeof SharedArrayBuffer === "function") {
    assert.equal(value instanceof SharedArrayBuffer, false);
  }
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertRecursivelyFrozen(value[key], seen);
  }
}

function nonPrimitiveObjectReferences(value, references = new Set()) {
  if (value === null || typeof value !== "object" || references.has(value)) {
    return references;
  }
  references.add(value);
  for (const key of Reflect.ownKeys(value)) {
    nonPrimitiveObjectReferences(value[key], references);
  }
  return references;
}

function sharedNonPrimitiveObjectReferences(left, right) {
  const leftReferences = nonPrimitiveObjectReferences(left);
  const rightReferences = nonPrimitiveObjectReferences(right);
  return [...leftReferences].filter((reference) =>
    rightReferences.has(reference),
  );
}

function assertUniqueRegistryIds(registry) {
  assert.equal(new Set(registry.map(({ id }) => id)).size, registry.length);
}

function fixtureAnchorExists(requirements, anchor) {
  const path = anchor.split(":", 1)[0];
  const segments = path.match(/[^.[\]]+/gu) ?? [];
  let value = requirements;
  for (const segment of segments) {
    if (value === null || typeof value !== "object") return false;
    const key = /^\d+$/u.test(segment) ? Number(segment) : segment;
    if (!Object.hasOwn(value, key)) return false;
    value = value[key];
  }
  return segments.length > 0 && value !== undefined;
}

function assertSourceIndependentAdversarialOracle(oracle, requirements) {
  assertRecursivelyFrozen(oracle);
  assert.deepEqual(oracle.counts, EXPECTED_SOURCE_INDEPENDENT_ORACLE_COUNTS);
  assert.deepEqual(
    oracle.inventorySha256,
    EXPECTED_SOURCE_INDEPENDENT_ORACLE_INVENTORY_SHA256,
  );
  const allIds = [];
  for (const [name, expectedCount] of Object.entries(oracle.counts)) {
    const registry = oracle.registries[name];
    assert.equal(registry.length, expectedCount, name);
    assertUniqueRegistryIds(registry);
    assert.equal(digest(registry), oracle.inventorySha256[name], name);
    allIds.push(...registry.map(({ id }) => id));
  }
  assert.equal(new Set(allIds).size, allIds.length);
  const independentProjection =
    independentlyReconstructSourceIndependentOracleProjection(requirements);
  const generatedProjection = projectSourceIndependentOracleRegistries(
    oracle.registries,
  );
  assert.deepEqual(generatedProjection, independentProjection);
  const independentlyReconstructedRegistries =
    recordsFromSourceIndependentOracleProjection(independentProjection);
  assert.deepEqual(independentlyReconstructedRegistries, oracle.registries);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(independentlyReconstructedRegistries).map(
        ([name, registry]) => [name, digest(registry)],
      ),
    ),
    EXPECTED_SOURCE_INDEPENDENT_ORACLE_INVENTORY_SHA256,
  );

  const prefixes = oracle.registries.acceptedSymbolicPrefixObservations;
  assert.equal(
    prefixes.filter(({ symbols }) => symbols.length === 0).length,
    1,
  );
  assert.equal(prefixes.filter(({ symbols }) => symbols.length > 0).length, 25);
  for (const observation of prefixes) {
    for (const sequenceId of observation.sourceSequences) {
      const complete = requirements.legalSequences[sequenceId];
      assert.equal(observation.symbols.length < complete.length, true);
      assert.deepEqual(
        observation.symbols,
        complete.slice(0, observation.symbols.length),
      );
      if (observation.symbols.length === 0) {
        assert.equal(sequenceMode(sequenceId), "RECOVERY_ONLY");
      }
    }
  }

  const whole = oracle.registries.wholeTransitionStateGoldenDesigns;
  assert.deepEqual(
    Object.fromEntries(
      requirements.vocabularies.inputKinds
        .concat("INITIALIZE")
        .map((operation) => [
          operation,
          whole.filter((entry) => entry.operation === operation).length,
        ]),
    ),
    {
      ADMIT: 1,
      CANCEL: 2,
      RECOVERY_REQUEST: 1,
      CONTROLLER_CLOSED: 2,
      DIAGNOSTIC_FAILURE: 3,
      RECOVERY_CONTROL_HANDOFF: 1,
      STATUS_EOF: 8,
      INITIALIZE: 2,
    },
  );
  assert.equal(
    whole.reduce((total, entry) => total + entry.statusFrameCount, 0),
    15,
  );
  assert.equal(
    whole.filter(({ operation }) => operation === "INITIALIZE").length,
    2,
  );
  assert.equal(
    whole.filter(({ operation }) => operation === "STATUS_EOF").length,
    8,
  );
  assert.equal(
    whole.filter(({ transcriptTerminal }) => transcriptTerminal).length,
    8,
  );

  const atomic = oracle.registries.atomicTwoStatusWirePrefixControls;
  assert.deepEqual(
    Object.fromEntries(
      ["CANCEL", "CONTROLLER_CLOSED"].map((operation) => [
        operation,
        atomic.filter((entry) => entry.operation === operation).length,
      ]),
    ),
    { CANCEL: 2, CONTROLLER_CLOSED: 2 },
  );
  assert.equal(
    atomic.every(({ publicIntermediateState }) => !publicIntermediateState),
    true,
  );

  const aliases = oracle.registries.descriptorAliasControls;
  assert.deepEqual(
    Object.fromEntries(
      [
        "ADMISSION_RIGHT_PAIR",
        "ADMISSION_RIGHT_TO_NORMAL_STARTUP",
        "NORMAL_STARTUP_PAIR",
        "RECOVERY_STARTUP_PAIR",
      ].map((family) => [
        family,
        aliases.filter((entry) => entry.family === family).length,
      ]),
    ),
    {
      ADMISSION_RIGHT_PAIR: 91,
      ADMISSION_RIGHT_TO_NORMAL_STARTUP: 112,
      NORMAL_STARTUP_PAIR: 28,
      RECOVERY_STARTUP_PAIR: 21,
    },
  );

  const precedence = requirements.vocabularies.failurePrecedence;
  const precedenceIndex = new Map(
    precedence.map((code, index) => [code, index]),
  );
  const constructible = oracle.registries.constructibleFailurePrecedencePairs;
  assert.deepEqual(
    constructible.map(({ id }) => id),
    EXPECTED_CONSTRUCTIBLE_FAILURE_PRECEDENCE_PAIR_IDS,
  );
  assert.equal(
    constructible.every(
      ({ earlier, later, witnessOperations }) =>
        precedenceIndex.get(earlier) < precedenceIndex.get(later) &&
        witnessOperations.length > 0,
    ),
    true,
  );
  const allPairs = unorderedIndexPairs(precedence.length).map(
    ([earlier, later]) => `${precedence[earlier]}-before-${precedence[later]}`,
  );
  const constructibleIds = new Set(constructible.map(({ id }) => id));
  assert.deepEqual(
    allPairs.filter((id) => !constructibleIds.has(id)),
    EXCLUDED_FAILURE_PRECEDENCE_PAIR_IDS,
  );
  const independentlyApplicablePairIds = new Set();
  for (const applicability of FAILURE_PRECEDENCE_CONSTRUCTOR_APPLICABILITY) {
    assert.match(applicability.contractAnchor, /^ADR-0036 /u);
    assert.deepEqual(
      Object.keys(applicability.fixtureEvidenceByCode),
      applicability.codes,
    );
    for (const evidence of Object.values(applicability.fixtureEvidenceByCode)) {
      assert.notEqual(evidence.length, 0);
      assert.equal(
        evidence.every((anchor) => fixtureAnchorExists(requirements, anchor)),
        true,
      );
    }
    for (let left = 0; left < applicability.codes.length; left += 1) {
      for (
        let right = left + 1;
        right < applicability.codes.length;
        right += 1
      ) {
        const ordered = [
          applicability.codes[left],
          applicability.codes[right],
        ].sort(
          (first, second) =>
            precedenceIndex.get(first) - precedenceIndex.get(second),
        );
        independentlyApplicablePairIds.add(
          `${ordered[0]}-before-${ordered[1]}`,
        );
      }
    }
  }
  assert.deepEqual(
    allPairs.filter((id) => independentlyApplicablePairIds.has(id)),
    EXPECTED_CONSTRUCTIBLE_FAILURE_PRECEDENCE_PAIR_IDS,
  );
  assert.deepEqual(oracle.failurePrecedenceFoundation, {
    constructorApplicability: FAILURE_PRECEDENCE_CONSTRUCTOR_APPLICABILITY,
    constructiblePairIds: EXPECTED_CONSTRUCTIBLE_FAILURE_PRECEDENCE_PAIR_IDS,
    excludedPairIds: EXCLUDED_FAILURE_PRECEDENCE_PAIR_IDS,
  });
  assert.deepEqual(oracle.construction, {
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
}

const EXPECTED_DIRECT_AMBIENT_MEMBER_POLICY = Object.freeze([
  Object.freeze(["Array", Object.freeze(["isArray"])]),
  Object.freeze(["Boolean", Object.freeze([])]),
  Object.freeze(["Error", Object.freeze([])]),
  Object.freeze([
    "Number",
    Object.freeze(["isFinite", "isInteger", "isSafeInteger"]),
  ]),
  Object.freeze([
    "Object",
    Object.freeze([
      "create",
      "defineProperty",
      "freeze",
      "hasOwn",
      "isExtensible",
      "isFrozen",
    ]),
  ]),
  Object.freeze(["Reflect", Object.freeze([])]),
  Object.freeze(["Set", Object.freeze([])]),
  Object.freeze(["String", Object.freeze([])]),
  Object.freeze(["WeakMap", Object.freeze([])]),
]);
const DIRECT_ALLOWED_AMBIENT_MEMBERS = new Map([
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

function directAmbientMemberPolicyProjection(policy) {
  return [...policy].map(([name, members]) => [name, [...members]]);
}

function directAssertAmbientMemberPolicyProjection(projection) {
  if (
    canonicalJson(projection) !==
    canonicalJson(EXPECTED_DIRECT_AMBIENT_MEMBER_POLICY)
  ) {
    throw new Error(
      "direct evaluator policy gate: ambient member contract mismatch",
    );
  }
  return Object.freeze({
    entryCount: projection.length,
    policySha256: digest(projection),
  });
}
const DIRECT_ALLOWED_AMBIENT_DIRECT_CALLS = new Set([
  "Boolean",
  "Number",
  "String",
]);
const DIRECT_ALLOWED_AMBIENT_CONSTRUCTORS = new Set([
  "Error",
  "Set",
  "WeakMap",
]);
const DIRECT_CONTEXTUAL_AMBIENT_MEMBER_CALLS = new Map([
  ["Array", new Set(["isArray"])],
  ["Number", new Set(["isFinite", "isInteger", "isSafeInteger"])],
  ["Object", new Set(["hasOwn", "isExtensible", "isFrozen"])],
]);
const DIRECT_FORBIDDEN_MEMBER_NAMES = new Set([
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
const DIRECT_FORBIDDEN_IDENTIFIER_NAMES = new Set([
  ...FORBIDDEN,
  "ArrayBuffer",
  "AsyncFunction",
  "AsyncGeneratorFunction",
  "Atomics",
  "BigInt64Array",
  "BigUint64Array",
  "BroadcastChannel",
  "Bun",
  "DataView",
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
  "Math",
  "MessageChannel",
  "MessagePort",
  "SharedArrayBuffer",
  "SharedWorker",
  "TextDecoder",
  "TextEncoder",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "WeakRef",
  "WebAssembly",
  "WebSocket",
  "Worker",
  "XMLHttpRequest",
  "__dirname",
  "__filename",
  "arguments",
  "atob",
  "btoa",
  "clearImmediate",
  "clearInterval",
  "clearTimeout",
  "console",
  "crypto",
  "global",
  "module",
  "navigator",
  "performance",
  "queueMicrotask",
  "require",
  "setImmediate",
  "setInterval",
  "structuredClone",
]);
const DIRECT_PRIVATE_STORE_NAMES = new Set([
  "startupMetadata",
  "inputMetadata",
  "stateMetadata",
]);
const DIRECT_IMPORTED_CALLABLE_NAMES = new Set([
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
  "verifyCandidateContainmentLaunchCapsuleV3",
]);
const DIRECT_IMPORTED_FAILURE_CALLBACK_INDEX = new Map([
  ["boundedInteger", 4],
  ["copyBoundedBuffer", 3],
  ["decodeCanonicalBase64", 3],
  ["decodeCanonicalJsonLine", 3],
  ["exactBoolean", 3],
  ["exactDigest", 2],
  ["exactRecord", 3],
]);
const DIRECT_PRIVATE_STORE_OWNER_BY_FUNCTION = new Map(
  PRIVATE_STORE_COMMIT_CONTROL_PLAN.flatMap(({ store, operations }) =>
    operations.map((operation) => [operation, store]),
  ),
);
const DIRECT_PRIVATE_LOOKUP_POLICY = new Map(
  [
    [
      "initializeCandidateContainmentGuardianControlV1",
      "startupMetadata",
      "startupProjection",
    ],
    [
      "verifyCandidateContainmentGuardianStatusFrameV1",
      "startupMetadata",
      "startupProjection",
    ],
    ...[
      "createCandidateContainmentGuardianAdmissionInputV1",
      "createCandidateContainmentGuardianCancelInputV1",
      "createCandidateContainmentGuardianRecoveryRequestInputV1",
      "createCandidateContainmentGuardianControllerClosedInputV1",
      "createCandidateContainmentGuardianDiagnosticFailureInputV1",
      "createCandidateContainmentGuardianRecoveryControlHandoffInputV1",
      "createCandidateContainmentGuardianStatusEofInputV1",
    ].map((functionName) => [functionName, "stateMetadata", "currentState"]),
    [
      "reduceCandidateContainmentGuardianControlV1",
      "stateMetadata",
      "currentState",
    ],
    [
      "reduceCandidateContainmentGuardianControlV1",
      "inputMetadata",
      "brandedInput",
    ],
  ].map(([functionName, storeName, parameterName]) => [
    `${functionName}\u0000${storeName}`,
    parameterName,
  ]),
);
const DIRECT_PROTECTED_BINDING_NAMES = new Set([
  ...[...ALLOWED_IMPORTS.values()].flat(),
  ...EXPECTED_EXPORTS,
  ...DIRECT_PRIVATE_STORE_NAMES,
  ...DIRECT_ALLOWED_AMBIENT_MEMBERS.keys(),
  ...DIRECT_FORBIDDEN_IDENTIFIER_NAMES,
]);
const DIRECT_FORBIDDEN_COMPILE_TIME_STRINGS = new Set(
  [
    ...DIRECT_FORBIDDEN_IDENTIFIER_NAMES,
    ...DIRECT_FORBIDDEN_MEMBER_NAMES,
    "OPENROUTER_API_KEY",
    "openrouter",
  ].map((value) => value.toLowerCase()),
);
const DIRECT_SAFE_MEMBER_METHODS = new Set([
  "at",
  "get",
  "has",
  "includes",
  "slice",
]);
const DIRECT_METHOD_MEMBER_NAMES = new Set([
  "add",
  "at",
  "get",
  "has",
  "includes",
  "push",
  "set",
  "slice",
]);
const DIRECT_ALLOWED_MEMBER_NAMES = new Set([
  "ADMIT",
  "CANCEL",
  "N1",
  "N2",
  "N3",
  "N4",
  "N5a",
  "N5b",
  "R1",
  "R2",
  "RECOVERY_REQUEST",
  "STATUS",
  "accessMode",
  "accessModes",
  "action",
  "actorKind",
  "add",
  "admissionControlMessageCount",
  "admissionCount",
  "admissionFrameMaximumBytes",
  "admissionFrameSha256",
  "admissionRecvmsgReport",
  "admissionRecvmsgReportMaximumBytes",
  "admissionRight",
  "admissionRights",
  "admissionRightsCount",
  "aggregateWireBytes",
  "ambientIntrinsics",
  "artifact",
  "at",
  "attemptDirectoryName",
  "attemptSha256",
  "argv",
  "authority",
  "auxiliaryByteLength",
  "auxiliarySha256",
  "binding",
  "boundStateSha256",
  "byteCarrierAdditionalOwnPropertyPolicy",
  "byteLength",
  "bytes",
  "cancelFrameMaximumBytes",
  "cancelObserved",
  "cgroupAuthority",
  "cleanup",
  "cleanupProved",
  "closeOnExec",
  "concurrentAdmissionsPermitted",
  "connected",
  "contentSha256",
  "controlLevel",
  "controlMessageCount",
  "controlTerminalReason",
  "controlTruncated",
  "controlType",
  "controllerClosedObserved",
  "count",
  "currentOffset",
  "decisionSourceLocation",
  "descriptorAuthority",
  "descriptorCount",
  "descriptorFactsProved",
  "descriptorInventory",
  "descriptorKinds",
  "diagnosticFailureObserved",
  "diagnosticSummary",
  "diagnosticSummaryMaximumBytes",
  "direct",
  "direction",
  "directions",
  "disposition",
  "environment",
  "eofObserved",
  "epochBytes",
  "epochOrigin",
  "epochOriginProved",
  "epochSha256",
  "eventCount",
  "evidenceOnly",
  "expectedEpochSha256",
  "failureCodes",
  "failurePrecedence",
  "fd",
  "fd0",
  "fd1",
  "fd2",
  "fd3",
  "fd4",
  "fd5",
  "fd6",
  "fd7",
  "fileDescriptorMapSha256",
  "files",
  "filesystemAuthority",
  "frameByteLength",
  "frameFields",
  "frameSha256",
  "generationSha256",
  "get",
  "guardianExecution",
  "guardianExecutionProved",
  "has",
  "hasOwn",
  "identity",
  "imports",
  "includes",
  "index",
  "initialOffset",
  "inputKinds",
  "inputProjection",
  "isArray",
  "isExtensible",
  "isFinite",
  "isFrozen",
  "isInteger",
  "isSafeInteger",
  "kind",
  "lastWireFrameSha256",
  "launchCapsuleV3",
  "launchCapsuleV3Sha256",
  "launchFileIdentitySha256",
  "legalSequences",
  "length",
  "lifecycleInventorySha256",
  "lifetimeAnchorProjectionSha256",
  "lifetimeAttemptAnchorRawSha256",
  "limits",
  "lockHeld",
  "maximumBytes",
  "maximumAdmissionsPerGuardianLifetime",
  "maximumAdmissionsPerTranscript",
  "maximumAggregateWireBytes",
  "maximumStatusFramesPerTransition",
  "maximumTranscriptSymbols",
  "messageByteLength",
  "messageRawSha256",
  "messageTruncated",
  "minimumBytes",
  "mode",
  "modes",
  "name",
  "nextWireSequence",
  "nonclaims",
  "normalDescriptorCount",
  "normalSha256",
  "openFileDescriptionClass",
  "openFileDescriptionIdentitySha256",
  "openFileDescriptionNonAliasMethod",
  "openFileDescriptionObservation",
  "openFileDescriptionObservationScopeSha256",
  "openFileDescriptionScope",
  "phase",
  "phases",
  "physicalEligibility",
  "physicalFacts",
  "planStatus",
  "predecessors",
  "previousFrameGenesisSha256",
  "previousFrameSha256",
  "privateStateStores",
  "processAuthority",
  "productionReadinessProved",
  "projectionSha256",
  "protocolSchema",
  "push",
  "quarantineReason",
  "rawDiagnosticsMaximumBytes",
  "rawSha256",
  "receivedRightsCloseOnExec",
  "recoveryActorEpochSha256",
  "recoveryActorKind",
  "recoveryAuthority",
  "recoveryBrandProvenanceProved",
  "recoveryControlHandoffObserved",
  "recoveryExecution",
  "recoveryExecutionProved",
  "recoveryOnlyDescriptorCount",
  "recoveryOnlySha256",
  "recoveryPlanSha256",
  "recoveryReplaySha256",
  "recoveryRequestFrameSha256",
  "recoveryRequestMaximumBytes",
  "recoveryRequirementsSha256",
  "recoverySelection",
  "recoverySelectionSha256",
  "recoveryStateMinimumCount",
  "recoveryStateSlots",
  "requiredActorKind",
  "requiredDestinationLocation",
  "requestSha256",
  "remapPlanSha256",
  "requirementsSha256",
  "resultMaximumBytes",
  "right0",
  "right1",
  "right10",
  "right11",
  "right12",
  "right13",
  "right2",
  "right3",
  "right4",
  "right5",
  "right6",
  "right7",
  "right8",
  "right9",
  "rightsCount",
  "role",
  "runtimeAuthority",
  "runtimeClosureEligibility",
  "runtimeRegistrationProved",
  "runtimeSerializationProved",
  "schema",
  "schemas",
  "sequence",
  "set",
  "sha256",
  "size",
  "slice",
  "socketFamily",
  "socketTransfer",
  "socketTransferProved",
  "socketType",
  "sourceLocation",
  "specifier",
  "startupDescriptor",
  "startupMaps",
  "startupProjection",
  "startupReport",
  "startupReportByteLength",
  "startupReportMaximumBytes",
  "startupReportSha256",
  "startupSha256",
  "state",
  "state0",
  "state1",
  "state10",
  "state11",
  "state12",
  "state13",
  "state14",
  "state15",
  "state16",
  "state17",
  "state18",
  "state2",
  "state3",
  "state4",
  "state5",
  "state6",
  "state7",
  "state8",
  "state9",
  "stateCount",
  "stateProjection",
  "stateSha256",
  "statusArtifact",
  "statusArtifactOwnKeys",
  "statusEofObserved",
  "statusFlags",
  "statusFrame0",
  "statusFrame1",
  "statusFrameCount",
  "statusFrameMaximumBytes",
  "statusStates",
  "targetSha256",
  "targetSupervisorFd",
  "terminalReason",
  "terminalReasons",
  "transcriptTerminal",
  "transitionProjection",
  "transportAuthority",
  "value",
  "version",
  "vocabularies",
  "wireFrame",
]);
const DIRECT_NODE_FIELDS = Object.freeze({
  Program: Object.freeze(["body", "sourceType"]),
  ImportDeclaration: Object.freeze(["specifiers", "source"]),
  ImportSpecifier: Object.freeze(["local", "imported"]),
  ExportNamedDeclaration: Object.freeze([
    "declaration",
    "specifiers",
    "source",
  ]),
  VariableDeclaration: Object.freeze(["declarations", "kind"]),
  VariableDeclarator: Object.freeze(["id", "init"]),
  FunctionDeclaration: Object.freeze([
    "id",
    "expression",
    "generator",
    "async",
    "params",
    "body",
  ]),
  FunctionExpression: Object.freeze([
    "id",
    "expression",
    "generator",
    "async",
    "params",
    "body",
  ]),
  ArrowFunctionExpression: Object.freeze([
    "id",
    "expression",
    "generator",
    "async",
    "params",
    "body",
  ]),
  BlockStatement: Object.freeze(["body"]),
  EmptyStatement: Object.freeze([]),
  ReturnStatement: Object.freeze(["argument"]),
  ExpressionStatement: Object.freeze(["expression"]),
  IfStatement: Object.freeze(["test", "consequent", "alternate"]),
  ThrowStatement: Object.freeze(["argument"]),
  TryStatement: Object.freeze(["block", "handler", "finalizer"]),
  CatchClause: Object.freeze(["param", "body"]),
  ForStatement: Object.freeze(["init", "test", "update", "body"]),
  ForOfStatement: Object.freeze(["left", "right", "body", "await"]),
  ForInStatement: Object.freeze(["left", "right", "body"]),
  WhileStatement: Object.freeze(["test", "body"]),
  DoWhileStatement: Object.freeze(["body", "test"]),
  SwitchStatement: Object.freeze(["discriminant", "cases"]),
  SwitchCase: Object.freeze(["test", "consequent"]),
  BreakStatement: Object.freeze(["label"]),
  ContinueStatement: Object.freeze(["label"]),
  LabeledStatement: Object.freeze(["label", "body"]),
  Identifier: Object.freeze(["name"]),
  Literal: Object.freeze(["value", "raw", "regex", "bigint"]),
  ObjectExpression: Object.freeze(["properties"]),
  ObjectPattern: Object.freeze(["properties"]),
  Property: Object.freeze([
    "method",
    "shorthand",
    "computed",
    "key",
    "value",
    "kind",
  ]),
  ArrayExpression: Object.freeze(["elements"]),
  ArrayPattern: Object.freeze(["elements"]),
  CallExpression: Object.freeze(["callee", "arguments", "optional"]),
  NewExpression: Object.freeze(["callee", "arguments"]),
  MemberExpression: Object.freeze([
    "object",
    "property",
    "computed",
    "optional",
  ]),
  UnaryExpression: Object.freeze(["operator", "prefix", "argument"]),
  UpdateExpression: Object.freeze(["operator", "prefix", "argument"]),
  BinaryExpression: Object.freeze(["left", "operator", "right"]),
  LogicalExpression: Object.freeze(["left", "operator", "right"]),
  AssignmentExpression: Object.freeze(["operator", "left", "right"]),
  AssignmentPattern: Object.freeze(["left", "right"]),
  ConditionalExpression: Object.freeze(["test", "consequent", "alternate"]),
  SequenceExpression: Object.freeze(["expressions"]),
  TemplateLiteral: Object.freeze(["expressions", "quasis"]),
  TemplateElement: Object.freeze(["value", "tail"]),
  TaggedTemplateExpression: Object.freeze(["tag", "quasi"]),
  SpreadElement: Object.freeze(["argument"]),
  RestElement: Object.freeze(["argument"]),
  ParenthesizedExpression: Object.freeze(["expression"]),
});

function directStrictUtf8Source(sourceBytes) {
  if (
    !Buffer.isBuffer(sourceBytes) ||
    Object.getPrototypeOf(sourceBytes) !== Buffer.prototype ||
    Object.getOwnPropertyDescriptor(sourceBytes, "length") !== undefined
  ) {
    throw new Error("direct static gate: source must be an ordinary Buffer");
  }
  const copied = Buffer.from(sourceBytes);
  const source = copied.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(copied)) {
    throw new Error("direct static gate: source is not strict UTF-8");
  }
  if (source.includes("\u2028") || source.includes("\u2029")) {
    throw new Error("direct static gate: Unicode line separator");
  }
  return source;
}

function directAssertNodeShape(node) {
  const allowedFields = DIRECT_NODE_FIELDS[node.type];
  if (allowedFields === undefined) {
    throw new Error(`direct static gate: unknown AST node ${node.type}`);
  }
  const allowed = new Set(["type", "start", "end", ...allowedFields]);
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) {
      throw new Error(
        `direct static gate: unknown AST key ${node.type}.${key}`,
      );
    }
  }
}

function directFoldString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node?.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  if (node?.type === "BinaryExpression" && node.operator === "+") {
    const left = directFoldString(node.left);
    const right = directFoldString(node.right);
    return left === null || right === null ? null : `${left}${right}`;
  }
  return null;
}

function directAssertLiteralSafe(value, parent) {
  if (typeof value !== "string" || parent?.type === "ImportDeclaration") {
    return;
  }
  const normalized = value.toLowerCase();
  if (
    normalized.includes("node:") ||
    /(?:^|\/)proc(?:\/|$)/u.test(normalized) ||
    normalized.includes("openrouter") ||
    normalized.includes("evaluator") ||
    /(?:^|[\\/])tests?(?:[\\/.]|$)/u.test(normalized)
  ) {
    throw new Error("direct static gate: forbidden literal or path");
  }
}

function directWalkAst(program, source) {
  let nodeCount = 0;
  const seenNodes = new WeakSet();
  const weakMapConstructions = [];
  const walk = (node, parent = null) => {
    if (node === null || typeof node !== "object") return;
    if (seenNodes.has(node)) return;
    seenNodes.add(node);
    directAssertNodeShape(node);
    nodeCount += 1;
    if (
      node.type === "NewExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "WeakMap"
    ) {
      weakMapConstructions.push(node);
    }
    if (node.type === "Identifier") {
      const spelling = source.slice(node.start, node.end);
      if (
        spelling !== node.name ||
        !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(spelling)
      ) {
        throw new Error("direct static gate: escaped or encoded identifier");
      }
    }
    if (node.type === "Literal") {
      if (node.regex !== undefined || typeof node.value === "bigint") {
        throw new Error("direct static gate: unsupported literal syntax");
      }
      directAssertLiteralSafe(node.value, parent);
    }
    if (
      node.type === "TemplateLiteral" ||
      node.type === "TaggedTemplateExpression"
    ) {
      throw new Error("direct static gate: template literal syntax");
    }
    if (
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      throw new Error("direct static gate: function expression syntax");
    }
    if (node.type === "FunctionDeclaration" && (node.async || node.generator)) {
      throw new Error("direct static gate: asynchronous or generator function");
    }
    if (node.type === "SpreadElement") {
      throw new Error("direct static gate: spread syntax");
    }
    if (node.type === "MemberExpression") {
      const memberName = node.computed
        ? directFoldString(node.property)
        : node.property.type === "Identifier"
          ? node.property.name
          : null;
      if (node.computed || node.optional === true) {
        throw new Error(
          "direct static gate: computed or optional member access",
        );
      }
      if (
        node.object.type === "Identifier" &&
        DIRECT_ALLOWED_AMBIENT_MEMBERS.has(node.object.name)
      ) {
        if (
          !DIRECT_ALLOWED_AMBIENT_MEMBERS.get(node.object.name).has(memberName)
        ) {
          throw new Error(
            `direct static gate: ambient member ${node.object.name}.${memberName}`,
          );
        }
        if (parent?.type !== "CallExpression" || parent.callee !== node) {
          throw new Error("direct static gate: ambient member used as value");
        }
      }
    }
    if (node.type === "Property" && node.computed) {
      throw new Error("direct static gate: computed property");
    }
    if (
      node.type === "CallExpression" &&
      (node.optional === true || node.callee.type === "ParenthesizedExpression")
    ) {
      throw new Error("direct static gate: indirect or optional call");
    }
    if (node.type === "ForOfStatement" && node.await) {
      throw new Error("direct static gate: for-await syntax");
    }
    const folded = directFoldString(node);
    if (folded !== null && node.type !== "Literal") {
      directAssertLiteralSafe(folded, parent);
    }
    for (const [key, value] of Object.entries(node)) {
      if (["type", "start", "end"].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child !== null && typeof child?.type === "string")
            walk(child, node);
        }
      } else if (value !== null && typeof value?.type === "string") {
        walk(value, node);
      }
    }
  };
  walk(program);
  return Object.freeze({
    nodeCount,
    weakMapConstructions: Object.freeze(weakMapConstructions),
  });
}

function directAssertContextualGrammar(program, expectedNodeCount) {
  const classifiedNodes = new WeakSet();
  const moduleScope = { parent: null, bindings: new Map() };
  const functionRecords = new Map();
  const activeFunctionSummaries = new Set();
  const counters = {
    classifiedNodeCount: 0,
    referenceCount: 0,
    privateOperationCount: 0,
  };
  const fail = (reason) => {
    throw new Error(`direct static gate: contextual ${reason}`);
  };
  const mark = (node, role) => {
    if (node === null || typeof node?.type !== "string") {
      fail(`invalid ${role} node`);
    }
    if (!classifiedNodes.has(node)) {
      classifiedNodes.add(node);
      counters.classifiedNodeCount += 1;
    }
  };
  const markIdentifier = (node, role, { reference = false } = {}) => {
    if (node?.type !== "Identifier") fail(`${role} must be an identifier`);
    const firstClassification = !classifiedNodes.has(node);
    mark(node, role);
    if (reference && firstClassification) counters.referenceCount += 1;
  };
  const DIRECT_STATIC_STRING_VALUE_LIMIT = 2_048;
  const DIRECT_STATIC_STRING_BYTE_LIMIT = 131_072;
  const boundedStaticStrings = (values, role) => {
    if (values.length > DIRECT_STATIC_STRING_VALUE_LIMIT) {
      fail(`bounded static-string provenance ${role}`);
    }
    const strings = [...new Set(values)];
    if (
      strings.some(
        (value) =>
          typeof value !== "string" ||
          Buffer.byteLength(value, "utf8") > DIRECT_STATIC_STRING_BYTE_LIMIT,
      )
    ) {
      fail(`bounded static-string provenance ${role}`);
    }
    return Object.freeze(strings);
  };
  const makeValue = (
    kind,
    staticStrings = [],
    exactStrings = [],
    staticIntegers = [],
    arrayElements = null,
    objectProperties = null,
    compileTime = null,
  ) =>
    Object.freeze({
      kind,
      staticStrings: boundedStaticStrings(staticStrings, "fragments"),
      exactStrings: boundedStaticStrings(exactStrings, "exact-values"),
      staticIntegers: Object.freeze([
        ...new Set(
          staticIntegers.filter((value) => Number.isSafeInteger(value)),
        ),
      ]),
      arrayElements:
        arrayElements === null ? null : Object.freeze([...arrayElements]),
      objectProperties:
        objectProperties === null
          ? null
          : Object.freeze(
              objectProperties.map(([name, value]) =>
                Object.freeze([name, value]),
              ),
            ),
      compileTime: Object.freeze({
        known: compileTime?.known === true,
        callerDerived: compileTime?.callerDerived === true,
        unknownString: compileTime?.unknownString === true,
        unknownStringCoercion: compileTime?.unknownStringCoercion === true,
        byteSequence: compileTime?.byteSequence === true,
        arraySequence: compileTime?.arraySequence === true,
        sequenceShape: compileTime?.sequenceShape === true,
        sequenceElement: compileTime?.sequenceElement ?? null,
        iterableElements:
          compileTime?.iterableElements == null
            ? null
            : Object.freeze([...compileTime.iterableElements]),
        unknownMemberValue: compileTime?.unknownMemberValue === true,
        stringConversions: boundedStaticStrings(
          compileTime?.stringConversions ?? [],
          "string-conversions",
        ),
        arrayElementStringConversions: boundedStaticStrings(
          compileTime?.arrayElementStringConversions ?? [],
          "array-element-string-conversions",
        ),
        typeofStrings: boundedStaticStrings(
          compileTime?.typeofStrings ?? [],
          "typeof-values",
        ),
        plusStrings: boundedStaticStrings(
          compileTime?.plusStrings ?? [],
          "to-primitive-string-values",
        ),
      }),
    });
  const immutableValue = makeValue("immutable");
  const exactUndefinedValue = makeValue("immutable", [], [], [], null, null, {
    known: true,
    stringConversions: ["undefined"],
    arrayElementStringConversions: [""],
    typeofStrings: ["undefined"],
  });
  const mergeStaticStrings = (...values) => [
    ...new Set(values.flatMap(({ staticStrings }) => staticStrings)),
  ];
  const mergeExactStrings = (...values) => [
    ...new Set(values.flatMap(({ exactStrings }) => exactStrings)),
  ];
  const combineExactStrings = (left, right) =>
    left.length > 0 &&
    right.length > DIRECT_STATIC_STRING_VALUE_LIMIT / left.length
      ? fail("bounded static-string provenance concatenation")
      : boundedStaticStrings(
          left.flatMap((leftValue) =>
            right.map((rightValue) => leftValue + rightValue),
          ),
          "concatenation",
        );
  const exactArrayElementStringConversions = (value) =>
    value.compileTime.unknownString || value.compileTime.unknownStringCoercion
      ? []
      : value.compileTime.arrayElementStringConversions.length > 0
        ? value.compileTime.arrayElementStringConversions
        : exactStringConversions(value);
  const exactArrayStringConversions = (elements) => {
    let conversions = [""];
    for (const [index, element] of elements.entries()) {
      const elementConversions = exactArrayElementStringConversions(element);
      if (elementConversions.length === 0) return [];
      conversions = combineExactStrings(
        conversions.map((prefix) => (index === 0 ? prefix : `${prefix},`)),
        elementConversions,
      );
    }
    return conversions;
  };
  const exactStringConversions = (value) => {
    if (value.compileTime.unknownString) return [];
    if (value.compileTime.stringConversions.length > 0) {
      return value.compileTime.stringConversions;
    }
    if (value.exactStrings.length > 0) return value.exactStrings;
    if (value.staticIntegers.length > 0) {
      return boundedStaticStrings(
        value.staticIntegers.map((integer) => String(integer)),
        "integer-string-conversion",
      );
    }
    if (value.arrayElements === null) return [];
    return exactArrayStringConversions(value.arrayElements);
  };
  const hasUnknownStringProvenance = (value) =>
    value.compileTime.unknownString ||
    (value.compileTime.typeofStrings.includes("string") &&
      exactStringConversions(value).length === 0);
  const hasCallerDerivedProvenance = (value) => value.compileTime.callerDerived;
  const isDefinitelyNonStringPrimitive = (value) =>
    value.compileTime.typeofStrings.length > 0 &&
    value.compileTime.typeofStrings.every((type) =>
      ["boolean", "number", "undefined"].includes(type),
    );
  const makeCallerDerivedUnknownValue = (callerDerived = true) =>
    makeValue("immutable", [], [], [], null, null, {
      callerDerived,
      unknownString: true,
      unknownMemberValue: true,
    });
  const makeCallerDerivedTypedValue = (
    type,
    {
      callerDerived = true,
      unknownStringCoercion = false,
      unknownMemberValue = false,
    } = {},
  ) =>
    makeValue("immutable", [], [], [], null, null, {
      callerDerived,
      unknownString: type === "string",
      unknownStringCoercion,
      unknownMemberValue,
      typeofStrings: [type],
    });
  const makeByteSequenceValue = (
    kind,
    { known = false, callerDerived = false } = {},
  ) =>
    makeValue(kind, [], [], [], null, null, {
      known,
      callerDerived,
      unknownStringCoercion: callerDerived,
      byteSequence: true,
      sequenceShape: true,
      sequenceElement: makeValue("immutable", [], [], [], null, null, {
        callerDerived,
        typeofStrings: ["number", "undefined"],
      }),
      typeofStrings: ["object"],
    });
  const makeArraySequenceValue = (callerDerived) =>
    makeValue("immutable", [], [], [], null, null, {
      callerDerived,
      unknownStringCoercion: callerDerived,
      arraySequence: true,
      sequenceShape: true,
      sequenceElement: makeCallerDerivedUnknownValue(callerDerived),
      typeofStrings: ["object"],
    });
  const makeLaunchProjectionValue = (callerDerived) => {
    const stringValue = () =>
      makeCallerDerivedTypedValue("string", {
        callerDerived,
        unknownMemberValue: false,
      });
    const numericValue = () =>
      makeCallerDerivedTypedValue("number", {
        callerDerived,
        unknownMemberValue: false,
      });
    const fixedFalse = makeValue("immutable", [], [], [], null, null, {
      known: true,
      stringConversions: ["false"],
      typeofStrings: ["boolean"],
    });
    const exactNull = makeValue("immutable", [], [], [], null, null, {
      known: true,
      stringConversions: ["null"],
      arrayElementStringConversions: [""],
      typeofStrings: ["object"],
    });
    const fixedRecord = makeValue("frozen", [], [], [], null, null, {
      known: true,
      typeofStrings: ["object"],
    });
    return makeValue(
      "frozen",
      [],
      [],
      [],
      null,
      [
        ["schema", stringValue()],
        ["protocolSchema", stringValue()],
        ["byteLength", numericValue()],
        ["rawSha256", stringValue()],
        ["requestSha256", stringValue()],
        ["generationSha256", stringValue()],
        ["requirementsSha256", stringValue()],
        ["fileDescriptorMapSha256", stringValue()],
        ["remapPlanSha256", stringValue()],
        ["argv", makeArraySequenceValue(callerDerived)],
        ["environment", makeCallerDerivedUnknownValue(callerDerived)],
        ["files", makeArraySequenceValue(callerDerived)],
        ["resultMaximumBytes", numericValue()],
        ["binding", exactNull],
        ["physicalEligibility", fixedFalse],
        ["runtimeClosureEligibility", fixedFalse],
        ["authority", fixedRecord],
        ["nonclaims", fixedRecord],
        ["projectionSha256", stringValue()],
      ],
      {
        callerDerived,
        typeofStrings: ["object"],
      },
    );
  };
  const joinAbstractValues = (...values) => {
    const arrayLength = values[0].arrayElements?.length ?? null;
    const arrayElements =
      arrayLength !== null &&
      values.every((value) => value.arrayElements?.length === arrayLength)
        ? Array.from({ length: arrayLength }, (_, index) =>
            joinAbstractValues(
              ...values.map((value) => value.arrayElements[index]),
            ),
          )
        : null;
    const allPropertiesKnown = values.every(
      (value) => value.objectProperties !== null,
    );
    const propertyNames = allPropertiesKnown
      ? [
          ...new Set(
            values.flatMap((value) =>
              value.objectProperties.map(([name]) => name),
            ),
          ),
        ].sort()
      : null;
    const objectProperties =
      propertyNames === null
        ? null
        : propertyNames.map((name) => [
            name,
            joinAbstractValues(
              ...values.map((value) => {
                const property = value.objectProperties.find(
                  ([candidate]) => candidate === name,
                );
                return (
                  property?.[1] ??
                  (value.compileTime.unknownMemberValue
                    ? makeCallerDerivedUnknownValue(
                        hasCallerDerivedProvenance(value),
                      )
                    : exactUndefinedValue)
                );
              }),
            ),
          ]);
    const sequenceShape = values.every(
      (value) => value.compileTime.sequenceShape,
    );
    const sequenceElement = sequenceShape
      ? joinAbstractValues(
          ...values.map((value) => {
            if (value.arrayElements !== null) {
              return value.arrayElements.length === 0
                ? exactUndefinedValue
                : joinAbstractValues(...value.arrayElements);
            }
            return (
              value.compileTime.sequenceElement ??
              makeCallerDerivedUnknownValue(hasCallerDerivedProvenance(value))
            );
          }),
        )
      : null;
    const iterableElementsKnown = values.every(
      (value) => value.compileTime.iterableElements !== null,
    );
    const iterableLengths = values.map(
      (value) => value.compileTime.iterableElements?.length ?? null,
    );
    const iterableElements =
      iterableElementsKnown &&
      iterableLengths.every((length) => length === iterableLengths[0])
        ? Array.from({ length: iterableLengths[0] }, (_, index) =>
            joinAbstractValues(
              ...values.map(
                (value) => value.compileTime.iterableElements[index],
              ),
            ),
          )
        : null;
    const completeTypeSets = values.every(
      (value) => value.compileTime.typeofStrings.length > 0,
    );
    const joinedTypeStrings = completeTypeSets
      ? [
          ...new Set(
            values.flatMap(({ compileTime }) => compileTime.typeofStrings),
          ),
        ]
      : [];
    const stringConversionSets = values.map(exactStringConversions);
    const completeStringConversions = stringConversionSets.every(
      (conversions) => conversions.length > 0,
    );
    const arrayElementConversionSets = values.map(
      exactArrayElementStringConversions,
    );
    const completeArrayElementConversions = arrayElementConversionSets.every(
      (conversions) => conversions.length > 0,
    );
    return makeValue(
      values.every((value) => value.kind === values[0].kind)
        ? values[0].kind
        : "immutable",
      mergeStaticStrings(...values),
      mergeExactStrings(...values),
      [...new Set(values.flatMap(({ staticIntegers }) => staticIntegers))],
      arrayElements,
      objectProperties,
      {
        known: values.every(({ compileTime }) => compileTime.known),
        callerDerived: values.some(hasCallerDerivedProvenance),
        unknownString:
          values.some(hasUnknownStringProvenance) ||
          (!completeStringConversions && joinedTypeStrings.includes("string")),
        unknownStringCoercion: values.some(
          (value) => value.compileTime.unknownStringCoercion,
        ),
        byteSequence: values.every((value) => value.compileTime.byteSequence),
        arraySequence: values.every((value) => value.compileTime.arraySequence),
        sequenceShape,
        sequenceElement,
        iterableElements,
        unknownMemberValue:
          values.some((value) => value.compileTime.unknownMemberValue) ||
          (objectProperties === null &&
            values.some((value) => value.objectProperties !== null)),
        stringConversions: completeStringConversions
          ? [...new Set(stringConversionSets.flat())]
          : [],
        arrayElementStringConversions: completeArrayElementConversions
          ? [...new Set(arrayElementConversionSets.flat())]
          : [],
        typeofStrings: joinedTypeStrings,
        plusStrings: [
          ...new Set(
            values.flatMap(({ compileTime }) => compileTime.plusStrings),
          ),
        ],
      },
    );
  };
  const capabilityLookingString = (value) => {
    const normalized = value.toLowerCase();
    return (
      [...DIRECT_FORBIDDEN_COMPILE_TIME_STRINGS].some((fragment) =>
        normalized.includes(fragment),
      ) ||
      normalized.startsWith("file://") ||
      normalized.includes("node:") ||
      /(?:^|[\\/])proc(?:[\\/]|$)/u.test(normalized) ||
      normalized.includes("openrouter") ||
      normalized.includes("evaluator") ||
      /(?:^|[\\/])tests?(?:[\\/.]|$)/u.test(normalized)
    );
  };
  const assertStaticStrings = (strings, literalRole) => {
    if (literalRole !== "ordinary") return;
    const capability = strings.find(capabilityLookingString);
    if (capability !== undefined) {
      fail(`capability-looking compile-time string ${capability}`);
    }
  };
  const declare = (
    scope,
    name,
    binding,
    { allowProtectedName = false } = {},
  ) => {
    if (!allowProtectedName && DIRECT_PROTECTED_BINDING_NAMES.has(name)) {
      fail(`protected binding declaration ${name}`);
    }
    if (scope.bindings.has(name)) fail(`duplicate binding ${name}`);
    const declared = { name, scope, ...binding };
    scope.bindings.set(name, declared);
    return declared;
  };
  const resolve = (scope, name) => {
    for (let current = scope; current !== null; current = current.parent) {
      const binding = current.bindings.get(name);
      if (binding !== undefined) return binding;
    }
    if (DIRECT_ALLOWED_AMBIENT_MEMBERS.has(name)) {
      return { name, kind: "ambient", value: makeValue("protected") };
    }
    fail(`free identifier ${name}`);
  };
  const registerVariable = (node, exported) => {
    if (node.kind !== "const" || node.declarations.length !== 1) {
      fail("module variable must be one const declarator");
    }
    const declarator = node.declarations[0];
    if (declarator.id.type !== "Identifier" || declarator.init === null) {
      fail("module const requires a simple initialized identifier");
    }
    const name = declarator.id.name;
    const privateStore = DIRECT_PRIVATE_STORE_NAMES.has(name);
    declare(
      moduleScope,
      name,
      {
        kind: privateStore
          ? "private-store"
          : exported
            ? "export-value"
            : "pending",
        value: privateStore ? makeValue("protected") : null,
        declarator,
      },
      { allowProtectedName: privateStore || exported },
    );
  };
  const registerFunction = (node, exported) => {
    if (
      node.id?.type !== "Identifier" ||
      node.async ||
      node.generator ||
      node.expression ||
      node.params.some((parameter) => parameter.type !== "Identifier")
    ) {
      fail("only named synchronous functions with identifier parameters");
    }
    const binding = declare(
      moduleScope,
      node.id.name,
      {
        kind: exported ? "export-function" : "local-function",
        value: makeValue("protected"),
      },
      { allowProtectedName: exported },
    );
    functionRecords.set(node.id.name, { node, binding, exported });
  };
  for (const statement of program.body) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers) {
        declare(
          moduleScope,
          specifier.local.name,
          {
            kind: DIRECT_IMPORTED_CALLABLE_NAMES.has(specifier.local.name)
              ? "import-callable"
              : "import-value",
            value: makeValue("protected"),
          },
          { allowProtectedName: true },
        );
      }
      continue;
    }
    if (statement.type === "ExportNamedDeclaration") {
      if (
        statement.source !== null ||
        statement.specifiers.length !== 0 ||
        statement.declaration === null
      ) {
        fail("only declaration exports are supported");
      }
      if (statement.declaration.type === "VariableDeclaration") {
        registerVariable(statement.declaration, true);
      } else if (statement.declaration.type === "FunctionDeclaration") {
        registerFunction(statement.declaration, true);
      } else {
        fail(`export declaration ${statement.declaration.type}`);
      }
      continue;
    }
    if (statement.type === "VariableDeclaration") {
      registerVariable(statement, false);
      continue;
    }
    if (statement.type === "FunctionDeclaration") {
      registerFunction(statement, false);
      continue;
    }
    if (statement.type !== "EmptyStatement") {
      fail(`module statement ${statement.type}`);
    }
  }

  let evaluateExpression;
  let evaluateLocalFunctionCall;
  let visitStatement;
  const visitLiteral = (node, literalRole) => {
    mark(node, `literal:${literalRole}`);
    if (
      node.regex !== undefined ||
      typeof node.value === "bigint" ||
      (!["boolean", "number", "string"].includes(typeof node.value) &&
        node.value !== null)
    ) {
      fail("unsupported literal value");
    }
    if (typeof node.value === "number") {
      if (
        !Number.isSafeInteger(node.value) ||
        !/^(?:0|[1-9][0-9]*)$/u.test(node.raw)
      ) {
        fail(`non-canonical integer literal ${node.raw}`);
      }
      return makeValue("immutable", [], [], [node.value], null, null, {
        known: true,
        stringConversions: [String(node.value)],
        typeofStrings: ["number"],
      });
    }
    if (typeof node.value === "string") {
      assertStaticStrings([node.value], literalRole);
      return makeValue(
        "immutable",
        [node.value],
        [node.value],
        [],
        null,
        null,
        {
          known: true,
          stringConversions: [node.value],
          typeofStrings: ["string"],
          plusStrings: [node.value],
        },
      );
    }
    return makeValue("immutable", [], [], [], null, null, {
      known: true,
      stringConversions: [String(node.value)],
      arrayElementStringConversions: node.value === null ? [""] : [],
      typeofStrings: [node.value === null ? "object" : typeof node.value],
    });
  };
  const evaluateIdentifier = (
    node,
    scope,
    { usage = "value", literalRole = "ordinary" } = {},
  ) => {
    markIdentifier(node, `identifier:${usage}`, { reference: true });
    const binding = resolve(scope, node.name);
    if (binding.kind === "pending" || binding.value === null) {
      fail(`binding used before initializer ${node.name}`);
    }
    if (usage === "callee") {
      if (
        !["ambient", "import-callable", "local-function"].includes(binding.kind)
      ) {
        fail(`protected or non-callable direct callee ${node.name}`);
      }
      if (
        binding.kind === "ambient" &&
        !DIRECT_ALLOWED_AMBIENT_DIRECT_CALLS.has(node.name)
      ) {
        fail(`ambient direct call ${node.name}`);
      }
      return binding;
    }
    if (usage === "constructor") {
      if (
        binding.kind !== "ambient" ||
        !DIRECT_ALLOWED_AMBIENT_CONSTRUCTORS.has(node.name)
      ) {
        fail(`constructor ${node.name}`);
      }
      return binding;
    }
    if (usage === "failure-callback") {
      if (binding.kind !== "local-function") {
        fail(`failure callback ${node.name}`);
      }
      return binding;
    }
    if (usage === "receiver") return binding;
    if (
      [
        "ambient",
        "export-function",
        "import-callable",
        "local-function",
        "private-store",
      ].includes(binding.kind) ||
      (["export-value", "import-value"].includes(binding.kind) &&
        literalRole === "ordinary")
    ) {
      fail(`protected binding used as value ${node.name}`);
    }
    return binding.value ?? immutableValue;
  };
  const visitProperty = (node, scope, context) => {
    if (
      node.type !== "Property" ||
      node.kind !== "init" ||
      node.method ||
      node.shorthand ||
      node.computed
    ) {
      fail("object property form");
    }
    mark(node, "object-property");
    let key;
    if (node.key.type === "Identifier") {
      markIdentifier(node.key, "property-key");
      key = node.key.name;
    } else if (node.key.type === "Literal") {
      const keyValue = visitLiteral(node.key, context.literalRole);
      key = node.key.value;
      assertStaticStrings(keyValue.staticStrings, context.literalRole);
    } else {
      fail(`object key ${node.key.type}`);
    }
    if (
      typeof key !== "string" ||
      DIRECT_FORBIDDEN_MEMBER_NAMES.has(key) ||
      !DIRECT_ALLOWED_MEMBER_NAMES.has(key)
    ) {
      fail(`object property key ${String(key)}`);
    }
    return {
      key,
      value: evaluateExpression(node.value, scope, context),
    };
  };
  const evaluateMember = (node, scope, context, { asCallee = false } = {}) => {
    mark(node, asCallee ? "member-callee" : "member-value");
    if (node.computed || node.optional || node.property.type !== "Identifier") {
      fail("computed, optional, or non-identifier member");
    }
    markIdentifier(node.property, "member-name");
    const memberName = node.property.name;
    if (
      DIRECT_FORBIDDEN_MEMBER_NAMES.has(memberName) ||
      !DIRECT_ALLOWED_MEMBER_NAMES.has(memberName)
    ) {
      fail(`member name ${memberName}`);
    }
    if (node.object.type === "ParenthesizedExpression") {
      fail("parenthesized member receiver");
    }
    if (node.object.type === "Identifier") {
      const binding = resolve(scope, node.object.name);
      if (binding.kind === "private-store" || binding.kind === "ambient") {
        evaluateIdentifier(node.object, scope, {
          usage: "receiver",
          literalRole: context.literalRole,
        });
        if (binding.kind === "private-store") {
          if (!asCallee || !["has", "get", "set"].includes(memberName)) {
            fail(`private-store member use ${memberName}`);
          }
          return {
            kind: "private-method",
            memberName,
            storeName: binding.name,
          };
        }
        if (
          !asCallee ||
          !DIRECT_CONTEXTUAL_AMBIENT_MEMBER_CALLS.get(binding.name)?.has(
            memberName,
          )
        ) {
          fail(`ambient member use ${binding.name}.${memberName}`);
        }
        return {
          kind: "ambient-method",
          memberName,
          ambientName: binding.name,
        };
      }
    }
    const receiver = evaluateExpression(node.object, scope, context);
    if (["parameter", "private-read", "protected"].includes(receiver.kind)) {
      fail(`untrusted or protected member receiver`);
    }
    if (asCallee) {
      if (!DIRECT_SAFE_MEMBER_METHODS.has(memberName)) {
        fail(`member call ${memberName}`);
      }
      return { kind: "safe-method", memberName, receiver };
    }
    if (DIRECT_METHOD_MEMBER_NAMES.has(memberName)) {
      fail(`method member used as value ${memberName}`);
    }
    if (memberName === "length") {
      const lengths =
        receiver.exactStrings.length > 0
          ? receiver.exactStrings.map((value) => value.length)
          : receiver.arrayElements !== null
            ? [receiver.arrayElements.length]
            : [];
      if (lengths.length > 0) {
        return makeValue("immutable", [], [], lengths, null, null, {
          known: true,
          callerDerived: hasCallerDerivedProvenance(receiver),
          stringConversions: lengths.map((value) => String(value)),
          typeofStrings: ["number"],
        });
      }
      if (
        receiver.compileTime.typeofStrings.includes("string") ||
        receiver.compileTime.sequenceShape
      ) {
        return makeValue("immutable", [], [], [], null, null, {
          callerDerived: hasCallerDerivedProvenance(receiver),
          typeofStrings: ["number"],
        });
      }
    }
    if (receiver.objectProperties !== null) {
      const property = receiver.objectProperties.find(
        ([name]) => name === memberName,
      );
      if (property !== undefined) return property[1];
      return exactUndefinedValue;
    }
    if (receiver.compileTime.unknownMemberValue) {
      return makeCallerDerivedUnknownValue(
        hasCallerDerivedProvenance(receiver),
      );
    }
    if (
      receiver.compileTime.known &&
      receiver.arrayElements === null &&
      receiver.compileTime.typeofStrings.length > 0 &&
      receiver.compileTime.typeofStrings.every((value) => value === "object")
    ) {
      fail("unanalyzable string-bearing known object member");
    }
    if (
      receiver.compileTime.known ||
      (receiver.compileTime.typeofStrings.length > 0 &&
        receiver.compileTime.typeofStrings.every((value) => value !== "object"))
    ) {
      const exactUndefined =
        receiver.exactStrings.length > 0 ||
        receiver.arrayElements !== null ||
        (receiver.compileTime.typeofStrings.length > 0 &&
          receiver.compileTime.typeofStrings.every(
            (value) => value !== "object",
          ));
      return makeValue("immutable", [], [], [], null, null, {
        known: exactUndefined,
        stringConversions: exactUndefined ? ["undefined"] : [],
        arrayElementStringConversions: exactUndefined ? [""] : [],
        typeofStrings: exactUndefined ? ["undefined"] : [],
      });
    }
    return immutableValue;
  };
  const requireStaticIntegerArgument = (argumentValue, memberName) => {
    if (argumentValue.staticIntegers.length !== 1) {
      fail(`unanalyzable string-bearing member transform ${memberName}`);
    }
    return argumentValue.staticIntegers[0];
  };
  const evaluateSafeMemberTransform = (member, argumentValues, context) => {
    const { memberName, receiver } = member;
    if (
      ["at", "slice"].includes(memberName) &&
      hasUnknownStringProvenance(receiver)
    ) {
      fail(`unanalyzable string-bearing member transform ${memberName}`);
    }
    if (memberName === "at") {
      if (argumentValues.length !== 1) {
        if (
          receiver.staticStrings.length > 0 ||
          receiver.arrayElements !== null ||
          receiver.compileTime.known
        ) {
          fail(`unanalyzable string-bearing member transform ${memberName}`);
        }
        return immutableValue;
      }
      if (
        receiver.exactStrings.length === 0 &&
        receiver.arrayElements === null
      ) {
        if (
          receiver.compileTime.sequenceShape &&
          receiver.compileTime.sequenceElement !== null
        ) {
          return receiver.compileTime.sequenceElement;
        }
        if (receiver.compileTime.byteSequence) {
          return makeValue("immutable", [], [], [], null, null, {
            callerDerived: hasCallerDerivedProvenance(receiver),
            typeofStrings: ["number", "undefined"],
          });
        }
        if (receiver.compileTime.arraySequence) {
          return makeCallerDerivedUnknownValue(
            hasCallerDerivedProvenance(receiver),
          );
        }
        if (receiver.staticStrings.length > 0 || receiver.compileTime.known) {
          fail(`unanalyzable string-bearing member transform ${memberName}`);
        }
        return immutableValue;
      }
      const index = requireStaticIntegerArgument(argumentValues[0], memberName);
      if (receiver.exactStrings.length > 0) {
        const transformed = receiver.exactStrings.map((value) =>
          value.at(index),
        );
        const exactStrings = transformed.filter((value) => value !== undefined);
        const hasUndefined = transformed.some((value) => value === undefined);
        const stringConversions = [
          ...exactStrings,
          ...(hasUndefined ? ["undefined"] : []),
        ];
        const typeofStrings = [
          ...(exactStrings.length > 0 ? ["string"] : []),
          ...(hasUndefined ? ["undefined"] : []),
        ];
        const staticStrings = [
          ...mergeStaticStrings(receiver),
          ...stringConversions,
        ];
        assertStaticStrings(staticStrings, context.literalRole);
        return makeValue(
          "immutable",
          staticStrings,
          exactStrings,
          [],
          null,
          null,
          {
            known: true,
            callerDerived: hasCallerDerivedProvenance(receiver),
            stringConversions,
            arrayElementStringConversions: [
              ...exactStrings,
              ...(hasUndefined ? [""] : []),
            ],
            typeofStrings,
            plusStrings: stringConversions,
          },
        );
      }
      const normalizedIndex =
        index < 0 ? receiver.arrayElements.length + index : index;
      const element = receiver.arrayElements[normalizedIndex];
      if (element === undefined) return exactUndefinedValue;
      assertStaticStrings(element.staticStrings, context.literalRole);
      return makeValue(
        "immutable",
        element.staticStrings,
        element.exactStrings,
        element.staticIntegers,
        element.arrayElements,
        element.objectProperties,
        element.compileTime,
      );
    }
    if (memberName === "slice") {
      if (argumentValues.length > 2) {
        if (
          receiver.staticStrings.length > 0 ||
          receiver.arrayElements !== null ||
          receiver.compileTime.known
        ) {
          fail(`unanalyzable string-bearing member transform ${memberName}`);
        }
        return immutableValue;
      }
      const indexes = argumentValues.map((argumentValue) =>
        requireStaticIntegerArgument(argumentValue, memberName),
      );
      if (
        receiver.compileTime.sequenceShape &&
        !receiver.compileTime.byteSequence &&
        !receiver.compileTime.arraySequence
      ) {
        return makeValue("mutable-local", [], [], [], null, null, {
          known:
            receiver.compileTime.known &&
            argumentValues.every(({ compileTime }) => compileTime.known),
          callerDerived: hasCallerDerivedProvenance(receiver),
          unknownStringCoercion: receiver.compileTime.unknownStringCoercion,
          sequenceShape: true,
          sequenceElement: receiver.compileTime.sequenceElement,
          typeofStrings: ["object"],
        });
      }
      if (receiver.compileTime.byteSequence) {
        return makeByteSequenceValue(receiver.kind, {
          known:
            receiver.compileTime.known &&
            argumentValues.every(({ compileTime }) => compileTime.known),
          callerDerived: hasCallerDerivedProvenance(receiver),
        });
      }
      if (
        receiver.compileTime.arraySequence &&
        receiver.arrayElements === null
      ) {
        return makeArraySequenceValue(hasCallerDerivedProvenance(receiver));
      }
      if (receiver.exactStrings.length > 0) {
        const exactStrings = receiver.exactStrings.map((value) =>
          value.slice(...indexes),
        );
        const staticStrings = [
          ...mergeStaticStrings(receiver),
          ...exactStrings,
        ];
        assertStaticStrings(staticStrings, context.literalRole);
        return makeValue(
          "immutable",
          staticStrings,
          exactStrings,
          [],
          null,
          null,
          {
            known: true,
            callerDerived: hasCallerDerivedProvenance(receiver),
            stringConversions: exactStrings,
            typeofStrings: ["string"],
            plusStrings: exactStrings,
          },
        );
      }
      if (receiver.arrayElements !== null) {
        const arrayElements = receiver.arrayElements.slice(...indexes);
        const stringConversions = exactArrayStringConversions(arrayElements);
        const staticStrings = mergeStaticStrings(...arrayElements);
        assertStaticStrings(staticStrings, context.literalRole);
        return makeValue(
          "mutable-local",
          staticStrings,
          [],
          [],
          arrayElements,
          null,
          {
            known: arrayElements.every(({ compileTime }) => compileTime.known),
            callerDerived: arrayElements.some(hasCallerDerivedProvenance),
            unknownStringCoercion: arrayElements.some(
              (value) =>
                hasUnknownStringProvenance(value) ||
                value.compileTime.unknownStringCoercion,
            ),
            stringConversions,
            typeofStrings: ["object"],
            plusStrings: stringConversions,
          },
        );
      }
      if (receiver.staticStrings.length > 0 || receiver.compileTime.known) {
        fail(`unanalyzable string-bearing member transform ${memberName}`);
      }
    }
    const knownResult =
      receiver.compileTime.known &&
      argumentValues.every(({ compileTime }) => compileTime.known);
    const resultCallerDerived =
      hasCallerDerivedProvenance(receiver) ||
      argumentValues.some(hasCallerDerivedProvenance);
    return makeValue("immutable", [], [], [], null, null, {
      known: knownResult,
      callerDerived: resultCallerDerived,
      unknownString: memberName === "get" && resultCallerDerived,
      unknownStringCoercion: memberName === "get" && resultCallerDerived,
      unknownMemberValue: memberName === "get" && resultCallerDerived,
      typeofStrings: ["has", "includes"].includes(memberName)
        ? ["boolean"]
        : [],
    });
  };
  const evaluateCall = (node, scope, context) => {
    mark(node, "call-expression");
    if (node.optional || node.callee.type === "ParenthesizedExpression") {
      fail("indirect or optional call");
    }
    const directBinding =
      node.callee.type === "Identifier"
        ? evaluateIdentifier(node.callee, scope, {
            usage: "callee",
            literalRole: context.literalRole,
          })
        : null;
    const failureCallbackIndex =
      directBinding?.kind === "import-callable"
        ? (DIRECT_IMPORTED_FAILURE_CALLBACK_INDEX.get(directBinding.name) ??
          null)
        : null;
    const argumentValues = node.arguments.map((argument, index) => {
      if (argument.type === "SpreadElement") fail("spread call argument");
      if (index === failureCallbackIndex) {
        if (argument.type !== "Identifier") {
          fail("failure callback must be an identifier");
        }
        evaluateIdentifier(argument, scope, {
          usage: "failure-callback",
          literalRole: context.literalRole,
        });
        return makeValue("protected");
      }
      return evaluateExpression(argument, scope, context);
    });
    const deterministicArgumentsKnown = argumentValues.every(
      ({ compileTime }, index) =>
        index === failureCallbackIndex || compileTime.known,
    );
    const callArgumentsCallerDerived = argumentValues.some(
      (value, index) =>
        index !== failureCallbackIndex && hasCallerDerivedProvenance(value),
    );
    if (node.callee.type === "Identifier") {
      const binding = directBinding;
      if (binding.kind === "ambient" && binding.name === "String") {
        const strings = argumentValues[0]?.staticStrings ?? [];
        const exactStrings =
          argumentValues.length === 0
            ? [""]
            : exactStringConversions(argumentValues[0]);
        if (
          exactStrings.length === 0 &&
          argumentValues[0]?.compileTime.known === true
        ) {
          fail("unanalyzable string-bearing String conversion");
        }
        assertStaticStrings(strings, context.literalRole);
        const staticStrings = [...strings, ...exactStrings];
        assertStaticStrings(staticStrings, context.literalRole);
        return makeValue(
          "immutable",
          staticStrings,
          exactStrings,
          [],
          null,
          null,
          {
            known: exactStrings.length > 0,
            callerDerived: callArgumentsCallerDerived,
            unknownString: exactStrings.length === 0,
            stringConversions: exactStrings,
            typeofStrings: ["string"],
            plusStrings: exactStrings,
          },
        );
      }
      if (
        binding.kind === "ambient" &&
        ["Boolean", "Number"].includes(binding.name)
      ) {
        const booleanConversions =
          binding.name === "Boolean" ? ["false", "true"] : [];
        return makeValue("immutable", [], [], [], null, null, {
          known: deterministicArgumentsKnown,
          callerDerived: callArgumentsCallerDerived,
          stringConversions: booleanConversions,
          arrayElementStringConversions: booleanConversions,
          typeofStrings: [binding.name.toLowerCase()],
          plusStrings: booleanConversions,
        });
      }
      if (
        binding.kind === "import-callable" &&
        [
          "copyBoundedBuffer",
          "decodeCanonicalBase64",
          "decodeCanonicalJsonLine",
          "canonicalJsonBytes",
          "canonicalJsonLine",
          "nullRecord",
        ].includes(binding.name)
      ) {
        if (binding.name === "nullRecord") {
          const entries = argumentValues[0]?.arrayElements ?? null;
          if (entries === null) {
            if (argumentValues[0]?.staticStrings.length > 0) {
              fail("unanalyzable string-bearing nullRecord construction");
            }
          } else {
            const objectProperties = entries.map((entry) => {
              if (
                entry.arrayElements?.length !== 2 ||
                entry.arrayElements[0].exactStrings.length !== 1
              ) {
                fail("unanalyzable string-bearing nullRecord entry");
              }
              return [
                entry.arrayElements[0].exactStrings[0],
                entry.arrayElements[1],
              ];
            });
            if (
              new Set(objectProperties.map(([name]) => name)).size !==
              objectProperties.length
            ) {
              fail("duplicate nullRecord property");
            }
            return makeValue(
              "mutable-local",
              mergeStaticStrings(...argumentValues),
              [],
              [],
              null,
              objectProperties,
              {
                known: entries.every(({ compileTime }) => compileTime.known),
                callerDerived: entries.some(hasCallerDerivedProvenance),
                typeofStrings: ["object"],
              },
            );
          }
        }
        if (
          [
            "copyBoundedBuffer",
            "decodeCanonicalBase64",
            "canonicalJsonBytes",
            "canonicalJsonLine",
          ].includes(binding.name)
        ) {
          return makeByteSequenceValue("mutable-local", {
            known: deterministicArgumentsKnown,
            callerDerived: callArgumentsCallerDerived,
          });
        }
        if (binding.name === "decodeCanonicalJsonLine") {
          return makeValue(
            "mutable-local",
            [],
            [],
            [],
            null,
            [
              [
                "bytes",
                makeByteSequenceValue("mutable-local", {
                  known: deterministicArgumentsKnown,
                  callerDerived: callArgumentsCallerDerived,
                }),
              ],
              [
                "value",
                makeCallerDerivedUnknownValue(callArgumentsCallerDerived),
              ],
            ],
            {
              known: deterministicArgumentsKnown,
              callerDerived: callArgumentsCallerDerived,
              stringConversions: ["[object Object]"],
              typeofStrings: ["object"],
              plusStrings: ["[object Object]"],
            },
          );
        }
        return makeValue("mutable-local", [], [], [], null, null, {
          known: deterministicArgumentsKnown,
          callerDerived: callArgumentsCallerDerived,
          unknownMemberValue: callArgumentsCallerDerived,
          typeofStrings: ["object"],
        });
      }
      if (
        binding.kind === "import-callable" &&
        [
          "deepFreeze",
          "frozenCopyOnReadBytes",
          "verifyCandidateContainmentLaunchCapsuleV3",
        ].includes(binding.name)
      ) {
        if (binding.name === "deepFreeze") {
          const value = argumentValues[0] ?? immutableValue;
          return makeValue(
            "frozen",
            value.staticStrings,
            value.exactStrings,
            value.staticIntegers,
            value.arrayElements,
            value.objectProperties,
            value.compileTime,
          );
        }
        if (binding.name === "frozenCopyOnReadBytes") {
          const entryValues = argumentValues[1]?.arrayElements ?? null;
          const objectProperties = [
            [
              "bytes",
              makeByteSequenceValue("mutable-local", {
                known: argumentValues[0]?.compileTime.known === true,
                callerDerived:
                  argumentValues[0] !== undefined &&
                  hasCallerDerivedProvenance(argumentValues[0]),
              }),
            ],
          ];
          if (entryValues !== null) {
            for (const entry of entryValues) {
              if (
                entry.arrayElements?.length !== 2 ||
                entry.arrayElements[0].exactStrings.length !== 1
              ) {
                fail("unanalyzable frozenCopyOnReadBytes entry");
              }
              objectProperties.push([
                entry.arrayElements[0].exactStrings[0],
                entry.arrayElements[1],
              ]);
            }
          }
          if (
            new Set(objectProperties.map(([name]) => name)).size !==
            objectProperties.length
          ) {
            fail("duplicate frozenCopyOnReadBytes property");
          }
          return makeValue("frozen", [], [], [], null, objectProperties, {
            known: deterministicArgumentsKnown,
            callerDerived: callArgumentsCallerDerived,
            unknownMemberValue:
              argumentValues.length > 1 && entryValues === null,
            typeofStrings: ["object"],
          });
        }
        return makeLaunchProjectionValue(callArgumentsCallerDerived);
      }
      if (binding.kind === "import-callable") {
        if (binding.name === "exactRecord") {
          const sourceRecord = argumentValues[0];
          const expectedKeys = argumentValues[1]?.arrayElements ?? null;
          const objectProperties =
            expectedKeys === null
              ? null
              : expectedKeys.map((keyValue) => {
                  if (keyValue.exactStrings.length !== 1) {
                    fail("unanalyzable exactRecord expected key");
                  }
                  const key = keyValue.exactStrings[0];
                  const sourceProperty = sourceRecord?.objectProperties?.find(
                    ([name]) => name === key,
                  );
                  return [
                    key,
                    sourceProperty?.[1] ??
                      makeCallerDerivedUnknownValue(callArgumentsCallerDerived),
                  ];
                });
          return makeValue(
            "mutable-local",
            [],
            [],
            [],
            null,
            objectProperties,
            {
              known: deterministicArgumentsKnown,
              callerDerived: callArgumentsCallerDerived,
              unknownMemberValue: objectProperties === null,
              typeofStrings: ["object"],
            },
          );
        }
        const resultType = new Map([
          ["boundedInteger", "number"],
          ["exactBoolean", "boolean"],
          ["exactDigest", "string"],
          ["exactRecord", "object"],
          ["sha256", "string"],
        ]).get(binding.name);
        return makeValue(
          "immutable",
          mergeStaticStrings(...argumentValues),
          [],
          [],
          null,
          null,
          {
            known: deterministicArgumentsKnown,
            callerDerived: callArgumentsCallerDerived,
            unknownString:
              resultType === "string" &&
              (!deterministicArgumentsKnown || callArgumentsCallerDerived),
            typeofStrings: resultType === undefined ? [] : [resultType],
          },
        );
      }
      if (binding.kind === "local-function") {
        return evaluateLocalFunctionCall(binding, argumentValues);
      }
      return makeValue(
        "immutable",
        mergeStaticStrings(...argumentValues),
        [],
        [],
        null,
        null,
        {
          callerDerived: callArgumentsCallerDerived,
          unknownString:
            callArgumentsCallerDerived ||
            argumentValues.some(hasUnknownStringProvenance),
          unknownStringCoercion:
            callArgumentsCallerDerived ||
            argumentValues.some(
              (value) => value.compileTime.unknownStringCoercion,
            ),
          unknownMemberValue: callArgumentsCallerDerived,
        },
      );
    }
    if (node.callee.type !== "MemberExpression") {
      fail(`callee ${node.callee.type}`);
    }
    const member = evaluateMember(node.callee, scope, context, {
      asCallee: true,
    });
    if (member.kind === "private-method") {
      counters.privateOperationCount += 1;
      const functionName = context.functionName;
      if (["has", "get"].includes(member.memberName)) {
        const expectedParameter = DIRECT_PRIVATE_LOOKUP_POLICY.get(
          `${functionName}\u0000${member.storeName}`,
        );
        if (
          expectedParameter === undefined ||
          node.arguments.length !== 1 ||
          node.arguments[0].type !== "Identifier" ||
          node.arguments[0].name !== expectedParameter ||
          resolve(scope, expectedParameter).kind !== "parameter"
        ) {
          fail(
            `private lookup ${functionName}:${member.storeName}.${member.memberName}`,
          );
        }
        return member.memberName === "has"
          ? makeValue("immutable", [], [], [], null, null, {
              callerDerived: true,
              typeofStrings: ["boolean"],
            })
          : makeValue("private-read", [], [], [], null, null, {
              callerDerived: true,
              unknownString: true,
              unknownMemberValue: true,
            });
      }
      if (
        DIRECT_PRIVATE_STORE_OWNER_BY_FUNCTION.get(functionName) !==
          member.storeName ||
        node.arguments.length !== 2 ||
        node.arguments[0].type !== "Identifier" ||
        node.arguments[0].name !== "result" ||
        node.arguments[1].type !== "Identifier" ||
        node.arguments[1].name !== "metadata" ||
        resolve(scope, "result").kind !== "local" ||
        resolve(scope, "metadata").kind !== "local"
      ) {
        fail(`private commit ${functionName}:${member.storeName}`);
      }
    }
    if (member.kind === "safe-method") {
      return evaluateSafeMemberTransform(member, argumentValues, context);
    }
    if (member.kind === "ambient-method") {
      return makeValue("immutable", [], [], [], null, null, {
        known: deterministicArgumentsKnown,
        callerDerived: callArgumentsCallerDerived,
        typeofStrings: ["boolean"],
      });
    }
    return immutableValue;
  };
  const evaluateNew = (node, scope, context) => {
    mark(node, "new-expression");
    if (node.callee.type !== "Identifier") fail("indirect constructor");
    const binding = evaluateIdentifier(node.callee, scope, {
      usage: "constructor",
      literalRole: context.literalRole,
    });
    const argumentValues = node.arguments.map((argument) => {
      if (argument.type === "SpreadElement") fail("spread constructor");
      return evaluateExpression(argument, scope, context);
    });
    let stringConversions = [];
    let objectProperties = null;
    let iterableElements = null;
    let unknownString = false;
    const callerDerived = argumentValues.some(hasCallerDerivedProvenance);
    if (binding.name === "Error") {
      const messages =
        argumentValues.length === 0
          ? [""]
          : exactStringConversions(argumentValues[0]);
      unknownString =
        argumentValues.length > 0 &&
        (messages.length === 0 ||
          hasUnknownStringProvenance(argumentValues[0]));
      stringConversions = messages.map((message) =>
        message.length === 0 ? "Error" : `Error: ${message}`,
      );
      const nameValue = makeValue(
        "immutable",
        ["Error"],
        ["Error"],
        [],
        null,
        null,
        {
          known: true,
          stringConversions: ["Error"],
          typeofStrings: ["string"],
          plusStrings: ["Error"],
        },
      );
      const messageValue = makeValue(
        "immutable",
        messages,
        messages,
        [],
        null,
        null,
        {
          known: messages.length > 0,
          callerDerived,
          unknownString,
          stringConversions: messages,
          typeofStrings: messages.length > 0 ? ["string"] : [],
          plusStrings: messages,
        },
      );
      objectProperties = [
        ["name", nameValue],
        ["message", messageValue],
      ];
    } else if (binding.name === "Set") {
      stringConversions = ["[object Set]"];
      const size = argumentValues.length === 0 ? 0 : null;
      if (argumentValues.length === 0) {
        iterableElements = [];
      } else if (argumentValues[0].arrayElements !== null) {
        iterableElements = argumentValues[0].arrayElements;
      } else if (argumentValues[0].exactStrings.length > 0) {
        iterableElements = argumentValues[0].exactStrings.flatMap((value) =>
          [...value].map((element) =>
            makeValue("immutable", [element], [element], [], null, null, {
              known: true,
              stringConversions: [element],
              typeofStrings: ["string"],
              plusStrings: [element],
            }),
          ),
        );
      } else if (argumentValues[0].compileTime.iterableElements !== null) {
        iterableElements = argumentValues[0].compileTime.iterableElements;
      } else if (
        argumentValues[0].compileTime.sequenceShape &&
        argumentValues[0].compileTime.sequenceElement !== null
      ) {
        iterableElements = [argumentValues[0].compileTime.sequenceElement];
      }
      objectProperties = [
        [
          "size",
          makeValue(
            "immutable",
            [],
            [],
            size === null ? [] : [size],
            null,
            null,
            {
              known: size !== null,
              callerDerived,
              stringConversions: size === null ? [] : [String(size)],
              typeofStrings: ["number"],
            },
          ),
        ],
      ];
    } else if (binding.name === "WeakMap") {
      stringConversions = ["[object WeakMap]"];
    }
    return makeValue(
      binding.name === "WeakMap" ? "private-store-value" : "mutable-local",
      [],
      [],
      [],
      null,
      objectProperties,
      {
        known: stringConversions.length > 0,
        callerDerived,
        unknownString,
        stringConversions,
        iterableElements,
        typeofStrings: ["object"],
        plusStrings: stringConversions,
      },
    );
  };
  evaluateExpression = (node, scope, context = {}) => {
    const literalRole = context.literalRole ?? "ordinary";
    const expressionContext = { ...context, literalRole };
    if (node.type === "Identifier") {
      return evaluateIdentifier(node, scope, { literalRole });
    }
    if (node.type === "Literal") return visitLiteral(node, literalRole);
    if (node.type === "ArrayExpression") {
      mark(node, "array-expression");
      if (node.elements.some((element) => element === null)) fail("array hole");
      const values = node.elements.map((element) => {
        if (element.type === "SpreadElement") fail("array spread");
        return evaluateExpression(element, scope, expressionContext);
      });
      const stringConversions = exactArrayStringConversions(values);
      return makeValue(
        "mutable-local",
        mergeStaticStrings(...values),
        [],
        [],
        values,
        null,
        {
          known: values.every(({ compileTime }) => compileTime.known),
          callerDerived: values.some(hasCallerDerivedProvenance),
          unknownStringCoercion: values.some(
            (value) =>
              hasUnknownStringProvenance(value) ||
              value.compileTime.unknownStringCoercion,
          ),
          arraySequence: true,
          sequenceShape: true,
          sequenceElement:
            values.length === 0
              ? exactUndefinedValue
              : joinAbstractValues(...values),
          stringConversions,
          typeofStrings: ["object"],
          plusStrings: stringConversions,
        },
      );
    }
    if (node.type === "ObjectExpression") {
      mark(node, "object-expression");
      const properties = node.properties.map((property) =>
        visitProperty(property, scope, expressionContext),
      );
      if (
        new Set(properties.map(({ key }) => key)).size !== properties.length
      ) {
        fail("duplicate object property");
      }
      return makeValue(
        "mutable-local",
        mergeStaticStrings(...properties.map(({ value }) => value)),
        [],
        [],
        null,
        properties.map(({ key, value }) => [key, value]),
        {
          known: true,
          callerDerived: properties.some(({ value }) =>
            hasCallerDerivedProvenance(value),
          ),
          stringConversions: ["[object Object]"],
          typeofStrings: ["object"],
          plusStrings: ["[object Object]"],
        },
      );
    }
    if (node.type === "CallExpression") {
      return evaluateCall(node, scope, expressionContext);
    }
    if (node.type === "NewExpression") {
      return evaluateNew(node, scope, expressionContext);
    }
    if (node.type === "MemberExpression") {
      return evaluateMember(node, scope, expressionContext);
    }
    if (node.type === "ParenthesizedExpression") {
      mark(node, "parenthesized-expression");
      return evaluateExpression(node.expression, scope, expressionContext);
    }
    if (node.type === "UnaryExpression") {
      mark(node, "unary-expression");
      if (
        !node.prefix ||
        !["!", "-", "typeof", "void"].includes(node.operator)
      ) {
        fail(`unary operator ${node.operator}`);
      }
      if (
        node.operator === "-" &&
        node.argument.type === "Literal" &&
        Object.is(node.argument.value, 0)
      ) {
        fail("non-canonical negative zero");
      }
      const argument = evaluateExpression(
        node.argument,
        scope,
        expressionContext,
      );
      if (node.operator === "typeof") {
        const exactStrings = argument.compileTime.typeofStrings;
        assertStaticStrings(exactStrings, literalRole);
        return makeValue(
          "immutable",
          exactStrings,
          exactStrings,
          [],
          null,
          null,
          {
            known: exactStrings.length > 0,
            callerDerived: hasCallerDerivedProvenance(argument),
            unknownString: exactStrings.length === 0,
            stringConversions: exactStrings,
            typeofStrings: ["string"],
            plusStrings: exactStrings,
          },
        );
      }
      if (node.operator === "void") {
        return makeValue("immutable", [], [], [], null, null, {
          known: true,
          stringConversions: ["undefined"],
          arrayElementStringConversions: [""],
          typeofStrings: ["undefined"],
        });
      }
      if (node.operator === "-" && argument.staticIntegers.length > 0) {
        const integers = argument.staticIntegers.map((value) => -value);
        return makeValue("immutable", [], [], integers, null, null, {
          known: true,
          callerDerived: hasCallerDerivedProvenance(argument),
          stringConversions: integers.map((value) => String(value)),
          typeofStrings: ["number"],
        });
      }
      return makeValue("immutable", [], [], [], null, null, {
        known: argument.compileTime.known,
        callerDerived: hasCallerDerivedProvenance(argument),
        typeofStrings: [node.operator === "-" ? "number" : "boolean"],
      });
    }
    if (node.type === "BinaryExpression") {
      mark(node, "binary-expression");
      if (["in", "instanceof"].includes(node.operator)) {
        fail(`binary operator ${node.operator}`);
      }
      const left = evaluateExpression(node.left, scope, expressionContext);
      const right = evaluateExpression(node.right, scope, expressionContext);
      const compileTimeKnown =
        left.compileTime.known && right.compileTime.known;
      const unknownStringOperand =
        hasUnknownStringProvenance(left) || hasUnknownStringProvenance(right);
      const unknownStringCoercionOperand =
        left.compileTime.unknownStringCoercion ||
        right.compileTime.unknownStringCoercion;
      const stringCoercion =
        node.operator === "+" &&
        (unknownStringOperand ||
          unknownStringCoercionOperand ||
          left.compileTime.plusStrings.length > 0 ||
          right.compileTime.plusStrings.length > 0 ||
          left.compileTime.typeofStrings.includes("string") ||
          right.compileTime.typeofStrings.includes("string"));
      const leftConversions =
        node.operator === "+" ? exactStringConversions(left) : [];
      const rightConversions =
        node.operator === "+" ? exactStringConversions(right) : [];
      if (
        stringCoercion &&
        (unknownStringOperand || unknownStringCoercionOperand)
      ) {
        fail("caller-drivable string concatenation");
      }
      if (
        stringCoercion &&
        ((left.compileTime.known && leftConversions.length === 0) ||
          (right.compileTime.known && rightConversions.length === 0))
      ) {
        fail("unanalyzable string-bearing binary + conversion");
      }
      const exactStrings =
        stringCoercion &&
        leftConversions.length > 0 &&
        rightConversions.length > 0
          ? combineExactStrings(leftConversions, rightConversions)
          : [];
      const comparison = [
        "<",
        "<=",
        ">",
        ">=",
        "==",
        "!=",
        "===",
        "!==",
      ].includes(node.operator);
      const numericAddition =
        node.operator === "+" &&
        !stringCoercion &&
        isDefinitelyNonStringPrimitive(left) &&
        isDefinitelyNonStringPrimitive(right);
      const resultTypes =
        exactStrings.length > 0
          ? ["string"]
          : comparison
            ? ["boolean"]
            : node.operator === "+"
              ? stringCoercion
                ? ["string"]
                : numericAddition
                  ? ["number"]
                  : ["number", "string"]
              : ["number"];
      const staticStrings = [
        ...mergeStaticStrings(left, right),
        ...exactStrings,
      ];
      assertStaticStrings(staticStrings, literalRole);
      return makeValue(
        "immutable",
        staticStrings,
        exactStrings,
        [],
        null,
        null,
        {
          known: compileTimeKnown,
          callerDerived:
            hasCallerDerivedProvenance(left) ||
            hasCallerDerivedProvenance(right),
          unknownString:
            resultTypes.includes("string") && exactStrings.length === 0,
          stringConversions: exactStrings,
          typeofStrings: resultTypes,
          plusStrings: exactStrings,
        },
      );
    }
    if (node.type === "LogicalExpression") {
      mark(node, "logical-expression");
      if (!["&&", "||", "??"].includes(node.operator)) {
        fail(`logical operator ${node.operator}`);
      }
      const left = evaluateExpression(node.left, scope, expressionContext);
      const right = evaluateExpression(node.right, scope, expressionContext);
      const staticStrings = mergeStaticStrings(left, right);
      assertStaticStrings(staticStrings, literalRole);
      return joinAbstractValues(left, right);
    }
    if (node.type === "ConditionalExpression") {
      mark(node, "conditional-expression");
      evaluateExpression(node.test, scope, expressionContext);
      const consequent = evaluateExpression(
        node.consequent,
        scope,
        expressionContext,
      );
      const alternate = evaluateExpression(
        node.alternate,
        scope,
        expressionContext,
      );
      const staticStrings = mergeStaticStrings(consequent, alternate);
      assertStaticStrings(staticStrings, literalRole);
      return joinAbstractValues(consequent, alternate);
    }
    fail(`expression ${node.type}`);
  };
  const visitVariable = (
    node,
    scope,
    context,
    { module = false, forOf = false, forOfValue = null } = {},
  ) => {
    mark(node, module ? "module-variable" : "local-variable");
    if (node.kind !== "const" || node.declarations.length !== 1) {
      fail("only one const declarator");
    }
    const declarator = node.declarations[0];
    mark(declarator, "variable-declarator");
    if (declarator.id.type !== "Identifier") fail("destructuring binding");
    markIdentifier(declarator.id, "binding");
    let binding;
    if (module) {
      binding = moduleScope.bindings.get(declarator.id.name);
      if (binding === undefined) fail(`unregistered module binding`);
    } else {
      binding = declare(scope, declarator.id.name, {
        kind: "local",
        value: null,
      });
    }
    if (forOf) {
      if (declarator.init !== null) fail("for-of initializer");
      if (forOfValue === null) fail("for-of value summary");
      if (forOfValue.exactStrings.length > 0) {
        const elements = forOfValue.exactStrings.flatMap((value) =>
          [...value].map((element) =>
            makeValue("immutable", [element], [element], [], null, null, {
              known: true,
              stringConversions: [element],
              typeofStrings: ["string"],
              plusStrings: [element],
            }),
          ),
        );
        binding.value =
          elements.length === 0
            ? immutableValue
            : joinAbstractValues(...elements);
      } else if (forOfValue.arrayElements !== null) {
        binding.value =
          forOfValue.arrayElements.length === 0
            ? immutableValue
            : joinAbstractValues(...forOfValue.arrayElements);
      } else if (forOfValue.compileTime.iterableElements !== null) {
        binding.value =
          forOfValue.compileTime.iterableElements.length === 0
            ? immutableValue
            : joinAbstractValues(...forOfValue.compileTime.iterableElements);
      } else if (
        forOfValue.compileTime.sequenceShape &&
        forOfValue.compileTime.sequenceElement !== null
      ) {
        binding.value = forOfValue.compileTime.sequenceElement;
      } else if (forOfValue.compileTime.byteSequence) {
        binding.value = makeCallerDerivedTypedValue("number", {
          callerDerived: hasCallerDerivedProvenance(forOfValue),
        });
      } else if (
        forOfValue.compileTime.arraySequence ||
        hasCallerDerivedProvenance(forOfValue)
      ) {
        binding.value = makeCallerDerivedUnknownValue(
          hasCallerDerivedProvenance(forOfValue),
        );
      } else {
        binding.value = immutableValue;
      }
      return;
    }
    if (declarator.init === null) fail("uninitialized const");
    const literalRole =
      declarator.id.name ===
      "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS"
        ? "requirements-value"
        : declarator.id.name ===
            "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256"
          ? "requirements-digest"
          : "ordinary";
    const value = evaluateExpression(declarator.init, scope, {
      ...context,
      literalRole,
    });
    if (binding.kind === "private-store") {
      if (
        value.kind !== "private-store-value" ||
        declarator.init.type !== "NewExpression" ||
        declarator.init.callee.name !== "WeakMap" ||
        declarator.init.arguments.length !== 0
      ) {
        fail(`private store initializer ${binding.name}`);
      }
      return;
    }
    if (module && value.kind === "mutable-local") {
      fail(`mutable module binding ${binding.name}`);
    }
    binding.value = value;
    if (binding.kind === "pending") binding.kind = "local";
  };
  const visitBlock = (node, scope, context, { functionBody = false } = {}) => {
    mark(node, functionBody ? "function-body" : "block-statement");
    const blockScope = functionBody
      ? scope
      : { parent: scope, bindings: new Map() };
    let fallsThrough = true;
    for (const statement of node.body) {
      const statementFallsThrough = visitStatement(
        statement,
        blockScope,
        fallsThrough ? context : { ...context, returnValues: null },
      );
      if (fallsThrough) fallsThrough = statementFallsThrough;
    }
    return fallsThrough;
  };
  evaluateLocalFunctionCall = (binding, argumentValues) => {
    const record = functionRecords.get(binding.name);
    if (record === undefined || record.binding !== binding || record.exported) {
      fail(`local function summary ${binding.name}`);
    }
    if (activeFunctionSummaries.has(binding.name)) {
      fail(`recursive local function summary ${binding.name}`);
    }
    activeFunctionSummaries.add(binding.name);
    try {
      const functionScope = { parent: moduleScope, bindings: new Map() };
      for (const [index, parameter] of record.node.params.entries()) {
        declare(functionScope, parameter.name, {
          kind: "parameter",
          value: argumentValues[index] ?? exactUndefinedValue,
        });
      }
      const returnValues = [];
      const fallsThrough = visitBlock(
        record.node.body,
        functionScope,
        {
          functionName: binding.name,
          literalRole: "ordinary",
          returnValues,
        },
        { functionBody: true },
      );
      if (fallsThrough) returnValues.push(exactUndefinedValue);
      return returnValues.length === 0
        ? exactUndefinedValue
        : joinAbstractValues(...returnValues);
    } finally {
      activeFunctionSummaries.delete(binding.name);
    }
  };
  visitStatement = (node, scope, context) => {
    if (node.type === "VariableDeclaration") {
      visitVariable(node, scope, context);
      return true;
    }
    if (node.type === "ReturnStatement") {
      mark(node, "return-statement");
      const value =
        node.argument === null
          ? exactUndefinedValue
          : evaluateExpression(node.argument, scope, context);
      if (Array.isArray(context.returnValues)) {
        context.returnValues.push(value);
      }
      return false;
    }
    if (node.type === "ExpressionStatement") {
      mark(node, "expression-statement");
      if (node.expression.type !== "CallExpression") {
        fail(`expression statement ${node.expression.type}`);
      }
      evaluateExpression(node.expression, scope, context);
      return true;
    }
    if (node.type === "BlockStatement") {
      return visitBlock(node, scope, context);
    }
    if (node.type === "IfStatement") {
      mark(node, "if-statement");
      evaluateExpression(node.test, scope, context);
      const consequentFallsThrough = visitStatement(
        node.consequent,
        scope,
        context,
      );
      if (node.alternate === null) return true;
      const alternateFallsThrough = visitStatement(
        node.alternate,
        scope,
        context,
      );
      return consequentFallsThrough || alternateFallsThrough;
    }
    if (node.type === "ForOfStatement") {
      mark(node, "for-of-statement");
      if (
        node.await ||
        node.left.type !== "VariableDeclaration" ||
        node.body.type !== "BlockStatement"
      ) {
        fail("for-of shape");
      }
      const forOfValue = evaluateExpression(node.right, scope, context);
      const loopScope = { parent: scope, bindings: new Map() };
      visitVariable(node.left, loopScope, context, {
        forOf: true,
        forOfValue,
      });
      visitBlock(node.body, loopScope, context);
      return true;
    }
    if (node.type === "ThrowStatement") {
      mark(node, "throw-statement");
      evaluateExpression(node.argument, scope, context);
      return false;
    }
    if (node.type === "EmptyStatement") {
      mark(node, "empty-statement");
      return true;
    }
    fail(`statement ${node.type}`);
  };
  const visitFunction = (node) => {
    mark(node, "function-declaration");
    markIdentifier(node.id, "function-binding");
    const functionScope = { parent: moduleScope, bindings: new Map() };
    for (const parameter of node.params) {
      if (parameter.type !== "Identifier") fail("function parameter pattern");
      markIdentifier(parameter, "parameter-binding");
      declare(functionScope, parameter.name, {
        kind: "parameter",
        value: makeValue("parameter", [], [], [], null, null, {
          callerDerived: true,
          unknownString: true,
          unknownMemberValue: true,
        }),
      });
    }
    visitBlock(
      node.body,
      functionScope,
      { functionName: node.id.name, literalRole: "ordinary" },
      { functionBody: true },
    );
  };
  const visitImport = (node) => {
    mark(node, "import-declaration");
    for (const specifier of node.specifiers) {
      mark(specifier, "import-specifier");
      markIdentifier(specifier.imported, "imported-name");
      markIdentifier(specifier.local, "import-binding");
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
        visitVariable(node.declaration, moduleScope, {}, { module: true });
      } else {
        visitFunction(node.declaration);
      }
      return;
    }
    if (node.type === "VariableDeclaration") {
      visitVariable(node, moduleScope, {}, { module: true });
      return;
    }
    if (node.type === "FunctionDeclaration") {
      visitFunction(node);
      return;
    }
    if (node.type === "EmptyStatement") {
      mark(node, "module-empty-statement");
      return;
    }
    fail(`module statement ${node.type}`);
  };
  mark(program, "program");
  for (const statement of program.body) visitModuleStatement(statement);
  if (counters.classifiedNodeCount !== expectedNodeCount) {
    const unclassifiedNodeTypes = [];
    const collectUnclassified = (node) => {
      if (node === null || typeof node?.type !== "string") return;
      if (!classifiedNodes.has(node)) unclassifiedNodeTypes.push(node.type);
      for (const field of DIRECT_NODE_FIELDS[node.type]) {
        const value = node[field];
        if (Array.isArray(value)) {
          for (const child of value) collectUnclassified(child);
        } else {
          collectUnclassified(value);
        }
      }
    };
    collectUnclassified(program);
    fail(
      `node closure ${counters.classifiedNodeCount}/${expectedNodeCount}:${unclassifiedNodeTypes.join(",")}`,
    );
  }
  return Object.freeze({
    moduleBindingCount: moduleScope.bindings.size,
    referenceCount: counters.referenceCount,
    classifiedNodeCount: counters.classifiedNodeCount,
    privateOperationCount: counters.privateOperationCount,
  });
}

function directAssertExactSurface(program, weakMapConstructions) {
  assert.equal(Object.isFrozen(weakMapConstructions), true);
  const imports = program.body.filter(
    ({ type }) => type === "ImportDeclaration",
  );
  assert.equal(imports.length, ALLOWED_IMPORTS.size);
  assert.deepEqual(
    imports.map(({ source }) => source.value),
    [...ALLOWED_IMPORTS.keys()],
  );
  imports.forEach((declaration, index) => {
    const expectedNames = [...ALLOWED_IMPORTS.values()][index];
    assert.equal(declaration.specifiers.length, expectedNames.length);
    assert.deepEqual(
      declaration.specifiers.map((specifier) => ({
        type: specifier.type,
        imported: specifier.imported.name,
        local: specifier.local.name,
      })),
      expectedNames.map((name) => ({
        type: "ImportSpecifier",
        imported: name,
        local: name,
      })),
    );
  });
  const exports = program.body.filter(
    ({ type }) => type === "ExportNamedDeclaration",
  );
  assert.equal(exports.length, EXPECTED_EXPORTS.length);
  const exportedNames = [];
  for (const declaration of exports) {
    assert.equal(declaration.source, null);
    assert.deepEqual(declaration.specifiers, []);
    assert.notEqual(declaration.declaration, null);
    if (declaration.declaration.type === "FunctionDeclaration") {
      const functionNode = declaration.declaration;
      exportedNames.push(functionNode.id.name);
      const signature = EXPECTED_DIRECT_FUNCTION_SIGNATURES.find(
        ({ name }) => name === functionNode.id.name,
      );
      assert.notEqual(signature, undefined);
      assert.deepEqual(
        functionNode.params.map((parameter) => parameter.name),
        signature.parameters,
      );
      assert.equal(functionNode.async, false);
      assert.equal(functionNode.generator, false);
    } else {
      assert.equal(declaration.declaration.type, "VariableDeclaration");
      assert.equal(declaration.declaration.kind, "const");
      assert.equal(declaration.declaration.declarations.length, 1);
      exportedNames.push(declaration.declaration.declarations[0].id.name);
    }
  }
  assert.deepEqual(exportedNames, EXPECTED_EXPORTS);
  assert.equal(new Set(exportedNames).size, EXPECTED_EXPORTS.length);
  const stores = program.body.flatMap((statement) => {
    if (statement.type !== "VariableDeclaration") return [];
    return statement.declarations.flatMap((declaration) => {
      if (
        declaration.init?.type !== "NewExpression" ||
        declaration.init.callee?.type !== "Identifier" ||
        declaration.init.callee.name !== "WeakMap"
      ) {
        return [];
      }
      assert.equal(statement.kind, "const");
      assert.equal(declaration.id.type, "Identifier");
      assert.deepEqual(declaration.init.arguments, []);
      return [
        Object.freeze({
          name: declaration.id.name,
          construction: declaration.init,
        }),
      ];
    });
  });
  assert.deepEqual(
    stores.map(({ name }) => name),
    ["startupMetadata", "inputMetadata", "stateMetadata"],
  );
  assert.equal(weakMapConstructions.length, stores.length);
  assert.equal(
    weakMapConstructions.every((construction) =>
      stores.some((store) => store.construction === construction),
    ),
    true,
  );
  return Object.freeze({
    importCount: imports.length,
    exportCount: exports.length,
    privateStoreCount: stores.length,
  });
}

function independentStaticAudit(sourceBytes) {
  if (directParse === null) {
    throw new Error(
      "direct static gate: parser unavailable outside direct entry",
    );
  }
  const source = directStrictUtf8Source(sourceBytes);
  let program;
  try {
    program = directParse(source, DIRECT_ACORN_PARSE_OPTIONS);
  } catch (error) {
    throw new Error(
      `direct static gate: invalid module syntax: ${error.message}`,
    );
  }
  assert.equal(program.type, "Program");
  assert.equal(program.sourceType, "module");
  const walkAudit = directWalkAst(program, source);
  const surface = directAssertExactSurface(
    program,
    walkAudit.weakMapConstructions,
  );
  const scope = directAssertContextualGrammar(program, walkAudit.nodeCount);
  return Object.freeze({
    ...surface,
    ...scope,
    nodeCount: walkAudit.nodeCount,
  });
}

function directEvaluatorAmbientMemberPolicyProjection(program) {
  const matches = program.body.flatMap((statement) => {
    if (statement.type !== "VariableDeclaration") return [];
    return statement.declarations.filter(
      (declaration) =>
        declaration.id.type === "Identifier" &&
        declaration.id.name === "DIRECT_ALLOWED_AMBIENT_MEMBERS",
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      "direct evaluator policy gate: ambient member declaration mismatch",
    );
  }
  const initializer = matches[0].init;
  if (
    initializer?.type !== "NewExpression" ||
    initializer.callee.type !== "Identifier" ||
    initializer.callee.name !== "Map" ||
    initializer.arguments.length !== 1 ||
    initializer.arguments[0].type !== "ArrayExpression"
  ) {
    throw new Error(
      "direct evaluator policy gate: ambient member declaration mismatch",
    );
  }
  const projection = [];
  for (const entry of initializer.arguments[0].elements) {
    if (
      entry?.type !== "ArrayExpression" ||
      entry.elements.length !== 2 ||
      entry.elements[0]?.type !== "Literal" ||
      typeof entry.elements[0].value !== "string"
    ) {
      throw new Error(
        "direct evaluator policy gate: ambient member declaration mismatch",
      );
    }
    const setInitializer = entry.elements[1];
    if (
      setInitializer?.type !== "NewExpression" ||
      setInitializer.callee.type !== "Identifier" ||
      setInitializer.callee.name !== "Set" ||
      setInitializer.arguments.length > 1
    ) {
      throw new Error(
        "direct evaluator policy gate: ambient member declaration mismatch",
      );
    }
    const members = [];
    if (setInitializer.arguments.length === 1) {
      const memberArray = setInitializer.arguments[0];
      if (memberArray.type !== "ArrayExpression") {
        throw new Error(
          "direct evaluator policy gate: ambient member declaration mismatch",
        );
      }
      for (const member of memberArray.elements) {
        if (member?.type !== "Literal" || typeof member.value !== "string") {
          throw new Error(
            "direct evaluator policy gate: ambient member declaration mismatch",
          );
        }
        members.push(member.value);
      }
    }
    projection.push([entry.elements[0].value, members]);
  }
  return projection;
}

function directAssertEvaluatorSemanticPolicyBytes(evaluatorBytes) {
  const source = directStrictUtf8Source(evaluatorBytes);
  let program;
  try {
    program = directParse(source, DIRECT_ACORN_PARSE_OPTIONS);
  } catch (error) {
    throw new Error(
      `direct evaluator policy gate: invalid module syntax: ${error.message}`,
    );
  }
  const projection = directEvaluatorAmbientMemberPolicyProjection(program);
  const receipt = directAssertAmbientMemberPolicyProjection(projection);
  return Object.freeze({
    schema:
      "oxigraph.test.candidate-containment-guardian-control-v1-c13-direct-evaluator-policy-gate/v1",
    ...receipt,
  });
}

function validSkeleton(extra = "", functionBodyOverrides = new Map()) {
  const imports = [...ALLOWED_IMPORTS]
    .map(
      ([specifier, names]) =>
        `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`,
    )
    .join("\n");
  const exports = EXPECTED_EXPORTS.map((name, index) => {
    if (index < 2) return `export const ${name} = ${index};`;
    const signature = EXPECTED_DIRECT_FUNCTION_SIGNATURES.find(
      (candidate) => candidate.name === name,
    );
    assert.notEqual(signature, undefined);
    return `export function ${name}(${signature.parameters.join(", ")}) { ${
      functionBodyOverrides.get(name) ?? "return null;"
    } }`;
  }).join("\n");
  return `${imports}\nconst startupMetadata = new WeakMap();\nconst inputMetadata = new WeakMap();\nconst stateMetadata = new WeakMap();\n${exports}\n${extra}`;
}

function snapshotCarrier(
  value,
  { label = "guardian byte carrier", minimumBytes = 0, maximumBytes = 64 } = {},
) {
  return copyBoundedBuffer(
    value,
    label,
    { minimumBytes, maximumBytes },
    (message) => {
      throw new TypeError(message);
    },
  );
}

function snapshotCarrierAtPosition(spec, value) {
  return snapshotCarrier(value, {
    label: spec.name,
    minimumBytes: spec.minimumBytes,
    maximumBytes: spec.maximumBytes,
  });
}

function sampleCarrierBytes(spec) {
  if (spec.name === "epochBytes") return Buffer.alloc(32, 0x45);
  if (spec.name === "rawDiagnosticBytes") return Buffer.from([0x64]);
  return Buffer.from([0x7b, 0x7d, 0x0a]);
}

function trapEveryObjectOperation(value, label) {
  const sentinel = new Error(`${label}: Buffer Proxy trap ran`);
  const state = { hits: 0 };
  const trap = () => {
    state.hits += 1;
    throw sentinel;
  };
  return Object.freeze({
    sentinel,
    state,
    value: new Proxy(value, {
      defineProperty: trap,
      deleteProperty: trap,
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      isExtensible: trap,
      ownKeys: trap,
      preventExtensions: trap,
      set: trap,
      setPrototypeOf: trap,
    }),
  });
}

function assertCarrierRejection(invoke, expectedMessage, sentinel = null) {
  assert.throws(invoke, (error) => {
    if (sentinel !== null) assert.notEqual(error, sentinel);
    assert.match(error.message, expectedMessage);
    return true;
  });
}

function ignoredPropertyVariants() {
  const variants = [];
  for (const keyKind of ["string", "symbol"]) {
    for (const descriptorKind of ["data", "getter", "setter"]) {
      for (const enumerable of [false, true]) {
        variants.push(Object.freeze({ keyKind, descriptorKind, enumerable }));
      }
    }
  }
  return Object.freeze(variants);
}

const IGNORED_PROPERTY_VARIANTS = ignoredPropertyVariants();

function exportedFunctionSource(source, name) {
  const marker = `export function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, name);
  const next = source.indexOf("\nexport function ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function sourceIndependentStaticControls() {
  const cases = [
    'import value from "node:fs";',
    'import * as exact from "./containment-exact-v2.mjs";',
    'export { sha256 } from "./containment-exact-v2.mjs";',
    'const dynamic = import("./containment-exact-v2.mjs");',
    "const metadata = import.meta.url;",
    "const escaped = gl\\u006fbalThis;",
    "const gadget = value.constructor;",
    "const callback = setTimeout;",
  ];
  let evaluationAttempts = 0;
  for (const value of cases) {
    assert.throws(() => {
      independentStaticAudit(Buffer.from(validSkeleton(value), "utf8"));
      evaluationAttempts += 1;
    });
  }
  assert.equal(evaluationAttempts, 0);
  assert.doesNotThrow(() =>
    independentStaticAudit(Buffer.from(validSkeleton(), "utf8")),
  );
  return Object.freeze({ rejected: cases.length, evaluationAttempts });
}

const STATIC_CONTROLS = DIRECT_ENTRY ? sourceIndependentStaticControls() : null;
let candidateSourceGateError = null;
let sourceBytes = null;
let sourceAudit = null;
const DIRECT_CANDIDATE_ACTIVITY = {
  sourceReads: 0,
  sourceAudits: 0,
  moduleImports: 0,
  moduleEvaluations: 0,
};
if (DIRECT_ENTRY) {
  try {
    DIRECT_CANDIDATE_ACTIVITY.sourceReads += 1;
    sourceBytes = readFileSync(SOURCE_PATH);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (sourceBytes !== null) {
    try {
      sourceAudit = independentStaticAudit(sourceBytes);
      DIRECT_CANDIDATE_ACTIVITY.sourceAudits += 1;
    } catch (error) {
      candidateSourceGateError = error;
    }
  }
}

test("independently verifies the fixture digest in the adversarial lane", () => {
  const fixtureText = readFileSync(REQUIREMENTS_URL, "utf8");
  const fixture = JSON.parse(fixtureText);
  assert.equal(digest(fixture), EXPECTED_REQUIREMENTS_SHA256);
  assert.equal(
    fixture.vocabularies.byteCarrierAdditionalOwnPropertyPolicy,
    EXPECTED_BYTE_CARRIER_ADDITIONAL_OWN_PROPERTY_POLICY,
  );
  const oracle = createSourceIndependentAdversarialOracle(fixture);
  assert.deepEqual(oracle.counts, {
    wholeTransitionStateGoldenDesigns: 20,
    emittedStatusByteGoldenDesigns: 15,
    atomicTwoStatusWirePrefixControls: 4,
    acceptedSymbolicPrefixObservations: 26,
    descriptorAliasControls: 252,
    constructibleFailurePrecedencePairs: 18,
  });
  assertSourceIndependentAdversarialOracle(oracle, JSON.parse(fixtureText));
  const independentlyCreatedOracle = createSourceIndependentAdversarialOracle(
    JSON.parse(fixtureText),
  );
  assert.notEqual(independentlyCreatedOracle, oracle);
  assert.notEqual(independentlyCreatedOracle.registries, oracle.registries);
  assert.deepEqual(independentlyCreatedOracle, oracle);
  const materialized = createSourceIndependentMaterializedStatusOracle(
    JSON.parse(fixtureText),
  );
  const independentlyAllocatedMaterialized =
    createSourceIndependentMaterializedStatusOracle(JSON.parse(fixtureText));
  const primaryMaterializerRegistryReferences = [
    ...[
      createSourceIndependentMaterializedStatusOracle,
      materializePrimaryStatusEntriesFromLegalSequences,
      materializePrimaryAtomicStatusPrefixesFromLegalSequences,
    ]
      .map((implementation) => implementation.toString())
      .join("\n")
      .matchAll(
        /\b(?:createSourceIndependentAdversarialOracle|generateWholeTransitionStateGoldenDesigns|generateEmittedStatusByteGoldenDesigns|generateAtomicTwoStatusWirePrefixControls|generateAcceptedSymbolicPrefixObservations|materializeStatusEntries|materializeAtomicStatusPrefixes|registries|emittedStatusByteGoldenDesigns|atomicTwoStatusWirePrefixControls|wholeTransitionStateGoldenDesigns|acceptedSymbolicPrefixObservations)\b/gu,
      ),
  ].map(([name]) => name);
  const secondaryReconstructionPrimaryDependencies = [
    ...independentlyReconstructMaterializedStatusTuples
      .toString()
      .matchAll(
        /\b(?:materializePrimaryStatusEntriesFromLegalSequences|materializePrimaryAtomicStatusPrefixesFromLegalSequences|primaryPrefixObservationIdFromLegalSequences|primaryPreviousWireSha256FromStatusPrefix|statusEntryIdentityProjection|atomicEntryIdentityProjection)\b/gu,
      ),
  ].map(([name]) => name);
  const firstGraphObjectReferences = nonPrimitiveObjectReferences(materialized);
  const secondGraphObjectReferences = nonPrimitiveObjectReferences(
    independentlyAllocatedMaterialized,
  );
  const sharedGraphObjectReferences = sharedNonPrimitiveObjectReferences(
    materialized,
    independentlyAllocatedMaterialized,
  );
  assert.deepEqual(
    {
      primaryMaterializerRegistryReferences,
      secondaryReconstructionPrimaryDependencies,
      sharedNonPrimitiveObjectReferenceCount:
        sharedGraphObjectReferences.length,
    },
    {
      primaryMaterializerRegistryReferences: [],
      secondaryReconstructionPrimaryDependencies: [],
      sharedNonPrimitiveObjectReferenceCount: 0,
    },
  );
  assert.equal(firstGraphObjectReferences.size > 0, true);
  assert.equal(
    secondGraphObjectReferences.size,
    firstGraphObjectReferences.size,
  );
  assert.deepEqual(independentlyAllocatedMaterialized, materialized);
  assertRecursivelyFrozen(materialized);
  assert.equal(
    materialized.schema,
    SOURCE_INDEPENDENT_MATERIALIZED_STATUS_ORACLE_SCHEMA,
  );
  assert.deepEqual(materialized.counts, {
    emittedStatusByteGoldens: 15,
    atomicTwoStatusWirePrefixes: 4,
  });
  assert.deepEqual(
    materialized.inventorySha256,
    EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256,
  );
  assert.deepEqual(materialized.designProjectionSha256, {
    statuses: EXPECTED_PRIMARY_STATUS_DESIGN_PROJECTION_SHA256,
    atomicPrefixes: EXPECTED_PRIMARY_ATOMIC_DESIGN_PROJECTION_SHA256,
  });
  assert.deepEqual(
    materialized.statusEntryDigests,
    EXPECTED_MATERIALIZED_STATUS_ENTRY_DIGESTS,
  );
  assert.deepEqual(
    materialized.atomicEntryDigests,
    EXPECTED_MATERIALIZED_ATOMIC_ENTRY_DIGESTS,
  );
  assert.equal(
    materialized.identitySha256,
    EXPECTED_MATERIALIZED_STATUS_ORACLE_SHA256,
  );
  assert.deepEqual(materialized.reconstruction, {
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
  assert.deepEqual(materialized.coverage, {
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
  assert.deepEqual(materialized.atomicNegativeControls, {
    controlCount: 4,
    reversedConcatenationMismatchCount: 4,
    firstFrameOmissionMismatchCount: 4,
    secondFrameOmissionMismatchCount: 4,
    insertedDelimiterMismatchCount: 4,
  });
  assert.deepEqual(materialized.construction, {
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
  for (const entry of materialized.emittedStatusByteGoldens) {
    assert.deepEqual(Object.keys(entry.frame), EXPECTED_STATUS_FRAME_FIELDS);
    assert.equal(entry.canonicalJsonl, `${canonicalJson(entry.frame)}\n`);
    assert.equal(entry.canonicalJsonl.includes("\r"), false);
    assert.equal(entry.canonicalJsonl.slice(0, -1).includes("\n"), false);
    assert.equal(
      entry.byteLength,
      Buffer.byteLength(entry.canonicalJsonl, "utf8"),
    );
    assert.equal(
      entry.rawSha256,
      byteDigest(Buffer.from(entry.canonicalJsonl, "utf8")),
    );
  }
  for (const entry of materialized.atomicTwoStatusWirePrefixes) {
    const first = materialized.emittedStatusByteGoldens.find(
      ({ id }) => id === entry.firstStatusDesignId,
    );
    const second = materialized.emittedStatusByteGoldens.find(
      ({ id }) => id === entry.secondStatusDesignId,
    );
    assert.notEqual(first, undefined);
    assert.notEqual(second, undefined);
    assert.equal(second.frame.sequence, first.frame.sequence + 1);
    assert.equal(second.frame.previousFrameSha256, first.rawSha256);
    assert.equal(entry.secondPreviousFrameSha256, first.rawSha256);
    assert.equal(
      entry.concatenatedJsonl,
      `${first.canonicalJsonl}${second.canonicalJsonl}`,
    );
    assert.equal(entry.publicIntermediateState, false);
  }
  const materializedBeforeReconstructedByteMutation = digest(materialized);
  for (const binding of Object.values(
    materialized.constructionContext.bindings,
  )) {
    const fromPreimage =
      binding.format === "CANONICAL_JSONL"
        ? Buffer.from(binding.jsonl, "utf8")
        : Buffer.from(binding.bytesHex, "hex");
    const independentlyReconstructed = Buffer.from(binding.bytesHex, "hex");
    assert.notEqual(fromPreimage, independentlyReconstructed);
    assert.deepEqual(fromPreimage, independentlyReconstructed);
    const independentlyReconstructedHex =
      independentlyReconstructed.toString("hex");
    fromPreimage[0] ^= 0xff;
    assert.notDeepEqual(fromPreimage, independentlyReconstructed);
    assert.equal(
      independentlyReconstructed.toString("hex"),
      independentlyReconstructedHex,
    );
    assert.equal(binding.bytesHex, independentlyReconstructedHex);
    assert.equal(byteDigest(independentlyReconstructed), binding.rawSha256);
  }
  assert.equal(
    digest(materialized),
    materializedBeforeReconstructedByteMutation,
  );
  assert.deepEqual(
    materialized.inventorySha256,
    EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256,
  );
  const oracleSha256BeforeFixtureMutation = digest(oracle);
  const materializedSha256BeforeFixtureMutation = digest(materialized);
  fixture.legalSequences.N1[0] = "MUTATED_AFTER_ORACLE_CONSTRUCTION";
  fixture.admissionRights.count = 0;
  fixture.startupMaps.normalDescriptorCount = 0;
  assert.equal(digest(oracle), oracleSha256BeforeFixtureMutation);
  assert.equal(digest(materialized), materializedSha256BeforeFixtureMutation);
  assert.deepEqual(oracle.counts, EXPECTED_SOURCE_INDEPENDENT_ORACLE_COUNTS);
});

test("keeps its own pre-import gate green with zero evaluation attempts", async () => {
  assert.deepEqual(ADVERSARIAL_EXACT_V2_LOAD_AUDIT, {
    schema:
      "oxigraph.test.candidate-containment-guardian-control-v1-adversarial-exact-v2-load/v1",
    mode: "DIRECT_ENTRY",
    expectedSourceSha256:
      "2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3",
    observedSourceSha256:
      "2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3",
    sourceReadCount: 1,
    sourcePinSequence: 1,
    moduleLoadAttemptCount: 1,
    moduleLoadAttemptSequence: 2,
    sourcePinnedBeforeModuleLoad: true,
    copyBoundedBufferLoaded: true,
  });

  let importedModeSourceReads = 0;
  let importedModeModuleLoads = 0;
  const importedModeLoad = await loadExactV2ForAdversarialEntry({
    directEntry: false,
    readExactV2Source() {
      importedModeSourceReads += 1;
      throw new Error("imported mode read exact-v2 source");
    },
    importExactV2() {
      importedModeModuleLoads += 1;
      throw new Error("imported mode loaded exact-v2");
    },
  });
  assert.equal(importedModeLoad.copyBoundedBuffer, null);
  assert.deepEqual(importedModeLoad.audit, {
    schema:
      "oxigraph.test.candidate-containment-guardian-control-v1-adversarial-exact-v2-load/v1",
    mode: "IMPORTED",
    expectedSourceSha256:
      "2c9d075538da2b114d58a208a97c97fe97a0cf9f78f7558b24ebacdab54d5bc3",
    observedSourceSha256: null,
    sourceReadCount: 0,
    sourcePinSequence: null,
    moduleLoadAttemptCount: 0,
    moduleLoadAttemptSequence: null,
    sourcePinnedBeforeModuleLoad: false,
    copyBoundedBufferLoaded: false,
  });
  assert.deepEqual(
    { importedModeSourceReads, importedModeModuleLoads },
    { importedModeSourceReads: 0, importedModeModuleLoads: 0 },
  );

  let driftModuleLoads = 0;
  await assert.rejects(
    () =>
      loadExactV2ForAdversarialEntry({
        directEntry: true,
        readExactV2Source: () => Buffer.from("drift", "utf8"),
        importExactV2() {
          driftModuleLoads += 1;
          throw new Error("drifted exact-v2 source was loaded");
        },
      }),
    /adversarial exact-v2 source pin mismatch/gu,
  );
  assert.equal(driftModuleLoads, 0);

  assert.deepEqual(STATIC_CONTROLS, { rejected: 8, evaluationAttempts: 0 });
  assert.doesNotThrow(() =>
    independentStaticAudit(Buffer.from(validSkeleton(), "utf8")),
  );
  assert.deepEqual(
    {
      moduleImports: DIRECT_CANDIDATE_ACTIVITY.moduleImports,
      moduleEvaluations: DIRECT_CANDIDATE_ACTIVITY.moduleEvaluations,
    },
    { moduleImports: 0, moduleEvaluations: 0 },
  );
});

test("pins the bounded snapshot path against extra-property traversal", () => {
  const exactSource = readFileSync(EXACT_V2_URL, "utf8");
  const copySource = exportedFunctionSource(exactSource, "copyBoundedBuffer");
  const lengthSource = exportedFunctionSource(
    exactSource,
    "exactBufferByteLength",
  );
  for (const source of [copySource, lengthSource]) {
    assert.doesNotMatch(
      source,
      /reflectOwnKeys|objectGetOwnPropertyDescriptors|objectKeys|objectValues/gu,
    );
  }
  assert.match(
    lengthSource,
    /objectGetOwnPropertyDescriptor\(value,\s*"length"\)/gu,
  );
  assert.match(
    copySource,
    /reflectApply\(typedArraySet,\s*copied,\s*\[value\]\)/gu,
  );
});

test("pins source-independent exact-v2 copy controls for all nine byte positions", () => {
  assert.deepEqual(BYTE_POSITION_SPECS, [
    { name: "startupReportBytes", minimumBytes: 0, maximumBytes: 8_192 },
    { name: "epochBytes", minimumBytes: 32, maximumBytes: 32 },
    { name: "admissionFrameBytes", minimumBytes: 0, maximumBytes: 131_072 },
    { name: "recvmsgReportBytes", minimumBytes: 0, maximumBytes: 16_384 },
    { name: "cancelFrameBytes", minimumBytes: 0, maximumBytes: 4_096 },
    {
      name: "recoveryRequestFrameBytes",
      minimumBytes: 0,
      maximumBytes: 32_768,
    },
    {
      name: "diagnosticSummaryReportBytes",
      minimumBytes: 0,
      maximumBytes: 1_024,
    },
    { name: "rawDiagnosticBytes", minimumBytes: 0, maximumBytes: 16_384 },
    { name: "statusFrameBytes", minimumBytes: 0, maximumBytes: 8_192 },
  ]);
  assert.deepEqual(BYTE_POSITIONS, [
    "startupReportBytes",
    "epochBytes",
    "admissionFrameBytes",
    "recvmsgReportBytes",
    "cancelFrameBytes",
    "recoveryRequestFrameBytes",
    "diagnosticSummaryReportBytes",
    "rawDiagnosticBytes",
    "statusFrameBytes",
  ]);

  let overBoundGetterHits = 0;
  let overBoundControls = 0;
  for (const spec of BYTE_POSITION_SPECS) {
    const atMaximum = Buffer.alloc(spec.maximumBytes, 0x61);
    const maximumSnapshot = snapshotCarrierAtPosition(spec, atMaximum);
    assert.equal(maximumSnapshot.length, spec.maximumBytes, spec.name);
    assert.notEqual(maximumSnapshot, atMaximum, spec.name);

    const oversized = Buffer.alloc(spec.maximumBytes + 1, 0x61);
    Object.defineProperty(oversized, `ignored-${spec.name}`, {
      configurable: true,
      enumerable: true,
      get() {
        overBoundGetterHits += 1;
        throw new Error(`${spec.name}: over-bound getter ran`);
      },
    });
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, oversized),
      /outside its byte bound/gu,
    );
    overBoundControls += 1;
  }
  assert.deepEqual(
    { overBoundControls, overBoundGetterHits },
    { overBoundControls: 9, overBoundGetterHits: 0 },
  );

  assertCarrierRejection(
    () =>
      snapshotCarrierAtPosition(BYTE_POSITION_SPECS[1], Buffer.alloc(31, 0x45)),
    /outside its byte bound/gu,
  );
});

test("normalizes 12 string and symbol own-property controls at every byte position", () => {
  const touches = { reads: 0, writes: 0, invocations: 0 };
  let controls = 0;
  for (const spec of BYTE_POSITION_SPECS) {
    const baseline = sampleCarrierBytes(spec);
    const baselineSnapshot = snapshotCarrierAtPosition(spec, baseline);
    for (const variant of IGNORED_PROPERTY_VARIANTS) {
      const bytes = Buffer.from(baseline);
      const callable = new Proxy(() => null, {
        apply() {
          touches.invocations += 1;
          return null;
        },
      });
      const label = `${spec.name}-${variant.keyKind}-${variant.descriptorKind}-${variant.enumerable}`;
      const key =
        variant.keyKind === "string" ? `extra-${label}` : Symbol(label);
      const descriptor = {
        configurable: true,
        enumerable: variant.enumerable,
      };
      if (variant.descriptorKind === "getter") {
        descriptor.get = () => {
          touches.reads += 1;
          return callable;
        };
      } else if (variant.descriptorKind === "setter") {
        descriptor.set = () => {
          touches.writes += 1;
        };
      } else {
        descriptor.value = callable;
        descriptor.writable = true;
      }
      Object.defineProperty(bytes, key, descriptor);
      const descriptorBefore = Object.getOwnPropertyDescriptor(bytes, key);
      const decoratedSnapshot = snapshotCarrierAtPosition(spec, bytes);
      const descriptorAfter = Object.getOwnPropertyDescriptor(bytes, key);

      assert.deepEqual(decoratedSnapshot, baselineSnapshot, label);
      assert.notEqual(decoratedSnapshot, bytes, label);
      assert.equal(Object.getPrototypeOf(decoratedSnapshot), Buffer.prototype);
      assert.equal(Object.hasOwn(decoratedSnapshot, key), false, label);
      assert.equal(
        Object.getOwnPropertyDescriptor(decoratedSnapshot, "length"),
        undefined,
      );
      assert.deepEqual(
        Reflect.ownKeys(decoratedSnapshot),
        Reflect.ownKeys(baselineSnapshot),
        label,
      );
      assert.deepEqual(descriptorAfter, descriptorBefore, label);
      assert.equal(Object.hasOwn(bytes, key), true, label);

      const originalFirstByte = decoratedSnapshot[0];
      bytes[0] ^= 0xff;
      assert.equal(decoratedSnapshot[0], originalFirstByte, label);
      controls += 1;
    }
  }
  assert.deepEqual(
    {
      positions: BYTE_POSITIONS.length,
      variants: IGNORED_PROPERTY_VARIANTS.length,
      controls,
      touches,
    },
    {
      positions: 9,
      variants: 12,
      controls: 108,
      touches: { reads: 0, writes: 0, invocations: 0 },
    },
  );
});

test("rejects every hostile byte-carrier class trap-free at all positions", () => {
  class LocalBufferSubclass extends Buffer {}

  const totals = {
    brandedLookalikes: 0,
    foreignPrototypes: 0,
    nonBufferViews: 0,
    ownLength: 0,
    ownLengthGetterHits: 0,
    proxies: 0,
    proxyTrapHits: 0,
    sharedBacking: 0,
    subclasses: 0,
  };

  for (const spec of BYTE_POSITION_SPECS) {
    const sample = sampleCarrierBytes(spec);

    const trapped = trapEveryObjectOperation(Buffer.from(sample), spec.name);
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, trapped.value),
      /exact non-Proxy Buffer/gu,
      trapped.sentinel,
    );
    totals.proxies += 1;
    totals.proxyTrapHits += trapped.state.hits;

    const shared = Buffer.from(new SharedArrayBuffer(sample.length));
    shared.set(sample);
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, shared),
      /shared mutable backing/gu,
    );
    totals.sharedBacking += 1;

    const subclass = Buffer.from(sample);
    Object.setPrototypeOf(subclass, LocalBufferSubclass.prototype);
    assert.equal(Buffer.isBuffer(subclass), true);
    assert.notEqual(Object.getPrototypeOf(subclass), Buffer.prototype);
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, subclass),
      /exact non-Proxy Buffer/gu,
    );
    totals.subclasses += 1;

    const foreignPrototype = runInNewContext("Object.create(bufferPrototype)", {
      bufferPrototype: Buffer.prototype,
    });
    const foreign = Buffer.from(sample);
    Object.setPrototypeOf(foreign, foreignPrototype);
    assert.equal(Buffer.isBuffer(foreign), true);
    assert.notEqual(Object.getPrototypeOf(foreign), Buffer.prototype);
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, foreign),
      /exact non-Proxy Buffer/gu,
    );
    totals.foreignPrototypes += 1;

    const ownLength = Buffer.from(sample);
    const ownLengthSentinel = new Error(`${spec.name}: own length getter ran`);
    Object.defineProperty(ownLength, "length", {
      configurable: true,
      get() {
        totals.ownLengthGetterHits += 1;
        throw ownLengthSentinel;
      },
    });
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, ownLength),
      /exact non-Proxy Buffer/gu,
      ownLengthSentinel,
    );
    totals.ownLength += 1;

    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, new Uint8Array(sample)),
      /exact non-Proxy Buffer/gu,
    );
    totals.nonBufferViews += 1;

    const brandedLookalike = Object.create(Buffer.prototype);
    Object.defineProperty(brandedLookalike, "_isBuffer", {
      configurable: true,
      enumerable: true,
      value: true,
    });
    assertCarrierRejection(
      () => snapshotCarrierAtPosition(spec, brandedLookalike),
      /(?:exact non-Proxy Buffer|length cannot be read intrinsically)/gu,
    );
    totals.brandedLookalikes += 1;
  }

  assert.deepEqual(totals, {
    brandedLookalikes: 9,
    foreignPrototypes: 9,
    nonBufferViews: 9,
    ownLength: 9,
    ownLengthGetterHits: 0,
    proxies: 9,
    proxyTrapHits: 0,
    sharedBacking: 9,
    subclasses: 9,
  });
});

test("freezes the 10-operation private-store evaluator design without claiming candidate execution", () => {
  assert.deepEqual(
    PRIVATE_STORE_COMMIT_CONTROL_PLAN.map(({ store }) => store),
    ["startupMetadata", "inputMetadata", "stateMetadata"],
  );
  const expectedOperations = [
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
  ];
  const operations = PRIVATE_STORE_COMMIT_CONTROL_PLAN.flatMap(
    (entry) => entry.operations,
  );
  assert.deepEqual(operations, expectedOperations);
  assert.equal(new Set(operations).size, 10);
  assert.deepEqual(
    EXPECTED_EXPORTS.filter(
      (name) =>
        !name.startsWith(
          "CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS",
        ) && name !== "verifyCandidateContainmentGuardianStatusFrameV1",
    ),
    expectedOperations,
  );
  const phases = [
    "earlyFailure",
    "lateFailure",
    "success",
    "failureAfterSuccess",
    "crossModule",
  ];
  const controls = [];
  for (const entry of PRIVATE_STORE_COMMIT_CONTROL_PLAN) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.operations), true);
    assert.equal(entry.operations.length > 0, true);
    for (const phase of phases) {
      assert.equal(typeof entry[phase], "string");
      assert.notEqual(entry[phase].length, 0);
      controls.push(`${entry.store}:${phase}:${entry[phase]}`);
    }
  }
  assert.equal(new Set(controls).size, 15);
  assert.equal(Object.isFrozen(PRIVATE_STORE_COMMIT_CONTROL_PLAN), true);

  const expectedCandidateTestNames = [
    "connect the source-independent 9-position matrices to the candidate after static-audit closure, including over-byte collisions with own-length, subclass, foreign-prototype, and shared backing under CONTROL_BOUNDS-before-CONTROL_SHAPE while Proxy and non-Buffer carriers reject immediately trap-free",
    "execute early, late, success, failure-after-success, and cross-module commit controls for every one of the 10 listed private-store mutating exports after static-audit closure",
  ];
  assert.deepEqual(
    ADVERSARIAL_CANDIDATE_TEST_INVENTORY.map(({ name }) => name),
    expectedCandidateTestNames,
  );
  assert.equal(Object.isFrozen(ADVERSARIAL_CANDIDATE_TEST_INVENTORY), true);
  for (const entry of ADVERSARIAL_CANDIDATE_TEST_INVENTORY) {
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.options), true);
    assert.deepEqual(entry.options, { todo: true });
  }

  const accesses = { candidate: 0, oracle: 0, loadFreshCandidate: 0 };
  const registrations = [];
  const registration = {
    registerTest(name, options, run) {
      registrations.push(Object.freeze({ name, options, run }));
    },
  };
  for (const name of Object.keys(accesses)) {
    Object.defineProperty(registration, name, {
      configurable: false,
      enumerable: true,
      get() {
        accesses[name] += 1;
        throw new Error(`${name} accessed during registration`);
      },
    });
  }
  const receipt = registerAdversarialCandidateTests(registration);
  assert.deepEqual(accesses, {
    candidate: 0,
    oracle: 0,
    loadFreshCandidate: 0,
  });
  assert.deepEqual(
    registrations.map(({ name }) => name),
    expectedCandidateTestNames,
  );
  assert.deepEqual(
    registrations.map(({ options }) => options),
    [{ todo: true }, { todo: true }],
  );
  assert.equal(
    registrations.every(({ run }) => typeof run === "function"),
    true,
  );
  assert.deepEqual(receipt, {
    schema:
      "oxigraph.test.candidate-containment-guardian-control-v1-adversarial-registration/v1",
    inventorySha256:
      "f448be91b5a4bb086e93e4ef529428bd0d509c14fd532e75e02ea1a256c0cb3e",
    registeredCount: 2,
    todoCount: 2,
    inputsDeferredUntilExecution: true,
  });
  assert.equal(Object.isFrozen(receipt), true);

  assert.equal(isDirectEntry(import.meta.url, undefined), false);
  assert.equal(isDirectEntry(import.meta.url, ""), false);
  assert.equal(
    isDirectEntry(import.meta.url, fileURLToPath(import.meta.url)),
    true,
  );
  assert.equal(isDirectEntry(import.meta.url, SOURCE_PATH), false);
});

test("keeps snapshot cost byte-bounded despite many extra own properties", () => {
  const bytes = Buffer.from([0x61]);
  let accessorHits = 0;
  for (let index = 0; index < 2_048; index += 1) {
    Object.defineProperty(bytes, `extra-${index}`, {
      configurable: true,
      enumerable: true,
      get() {
        accessorHits += 1;
        return index;
      },
    });
    bytes[Symbol(`extra-${index}`)] = index;
  }
  const snapshot = snapshotCarrier(bytes, { maximumBytes: 1 });
  assert.deepEqual(snapshot, Buffer.from([0x61]));
  assert.equal(accessorHits, 0);
  assert.deepEqual(Reflect.ownKeys(snapshot), ["0"]);
});

test("does not create a second missing-module failure", () => {
  if (candidateSourceGateError !== null) throw candidateSourceGateError;
  assert.equal(sourceBytes === null || sourceAudit !== null, true);
  assert.deepEqual(
    {
      sourceAudits: DIRECT_CANDIDATE_ACTIVITY.sourceAudits,
      moduleImports: DIRECT_CANDIDATE_ACTIVITY.moduleImports,
      moduleEvaluations: DIRECT_CANDIDATE_ACTIVITY.moduleEvaluations,
    },
    {
      sourceAudits: sourceBytes === null ? 0 : 1,
      moduleImports: 0,
      moduleEvaluations: 0,
    },
  );
});

test("replace the fail-closed source-presence stop with exhaustive positive-allowlist parser closure for free identifiers, imports, exports, encoded identifiers, computed access, ambient authority, and test-gaming paths", async () => {
  const asBytes = (sourceText) => Buffer.from(sourceText, "utf8");
  const baseline = validSkeleton();
  const baselineAudit = independentStaticAudit(asBytes(baseline));
  assert.deepEqual(
    {
      importCount: baselineAudit.importCount,
      exportCount: baselineAudit.exportCount,
      privateStoreCount: baselineAudit.privateStoreCount,
    },
    { importCount: 3, exportCount: 13, privateStoreCount: 3 },
  );
  assert.equal(baselineAudit.nodeCount > 0, true);
  assert.equal(baselineAudit.referenceCount > 0, true);
  assert.deepEqual(DIRECT_PARSER_LOAD_AUDIT, {
    schema: DIRECT_PARSER_LOAD_AUDIT_SCHEMA,
    mode: "DIRECT_ENTRY",
    manifestReadCount: 1,
    lockReadCount: 1,
    installedPackageReadCount: 1,
    installedEntrypointReadCount: 1,
    parserImportCount: 1,
    manifestReadSequence: 1,
    lockReadSequence: 2,
    installedPackageReadSequence: 3,
    installedEntrypointReadSequence: 4,
    identityPinSequence: 5,
    parserImportSequence: 6,
    identityPinnedBeforeImport: true,
    version: "8.18.0",
  });

  let importedModeReads = 0;
  let importedModeLoads = 0;
  const importedModeParser = await loadDirectParserForAdversarialEntry({
    directEntry: false,
    readHarnessManifest() {
      importedModeReads += 1;
    },
    readHarnessLock() {
      importedModeReads += 1;
    },
    readInstalledPackage() {
      importedModeReads += 1;
    },
    readInstalledEntrypoint() {
      importedModeReads += 1;
    },
    importParser() {
      importedModeLoads += 1;
    },
  });
  assert.equal(importedModeParser.parse, null);
  assert.deepEqual(
    { importedModeReads, importedModeLoads },
    { importedModeReads: 0, importedModeLoads: 0 },
  );
  assert.deepEqual(importedModeParser.audit, {
    schema: DIRECT_PARSER_LOAD_AUDIT_SCHEMA,
    mode: "IMPORTED",
    manifestReadCount: 0,
    lockReadCount: 0,
    installedPackageReadCount: 0,
    installedEntrypointReadCount: 0,
    parserImportCount: 0,
    identityPinnedBeforeImport: false,
    version: null,
  });

  const approvedAmbientAudit = independentStaticAudit(
    asBytes(
      validSkeleton(`
function approvedAmbientCalls() {
  Array.isArray([]);
  Boolean(false);
  const error = new Error("bounded");
  Number(0);
  Number.isFinite(0);
  Number.isInteger(0);
  Number.isSafeInteger(0);
  Object.hasOwn({}, "value");
  Object.isExtensible({});
  Object.isFrozen({});
  const set = new Set();
  String("bounded");
  if (false) { throw error; }
  set.has(null);
  return null;
}`),
    ),
  );
  assert.equal(approvedAmbientAudit.nodeCount > baselineAudit.nodeCount, true);
  assert.equal(
    directAssertAmbientMemberPolicyProjection(
      directAmbientMemberPolicyProjection(DIRECT_ALLOWED_AMBIENT_MEMBERS),
    ).entryCount,
    9,
  );

  const contextualPositiveSources = [
    validSkeleton(),
    validSkeleton(
      'function failValidation() { throw new Error("CONTROL_SHAPE"); } function localHelper(value) { const localValue = exactBoolean(value, true, "value", failValidation); return localValue; }',
    ),
    validSkeleton(
      "function select() { for (const value of deepFreeze([])) { if (value) { return false; } } return null; }",
    ),
    validSkeleton("const frozenLocalTable = deepFreeze([]);"),
    validSkeleton(
      'const localRequirements = deepFreeze(nullRecord([["schema", "safe"]])); const localDigest = sha256(canonicalJsonBytes(localRequirements));',
    ),
    validSkeleton(
      "",
      new Map([
        [
          "initializeCandidateContainmentGuardianControlV1",
          "const present = startupMetadata.has(startupProjection); const observed = startupMetadata.get(startupProjection); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
        ],
      ]),
    ),
    validSkeleton(
      "",
      new Map([
        [
          "verifyCandidateContainmentGuardianStatusFrameV1",
          "const present = startupMetadata.has(startupProjection); const observed = startupMetadata.get(startupProjection); return null;",
        ],
      ]),
    ),
    validSkeleton(
      "",
      new Map([
        [
          "createCandidateContainmentGuardianAdmissionInputV1",
          "const present = stateMetadata.has(currentState); const observed = stateMetadata.get(currentState); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); inputMetadata.set(result, metadata); return result;",
        ],
      ]),
    ),
    validSkeleton(
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
    validSkeleton(
      "",
      new Map([
        [
          "reduceCandidateContainmentGuardianControlV1",
          "const present = stateMetadata.has(currentState); const observed = stateMetadata.get(currentState); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
        ],
      ]),
    ),
    validSkeleton(
      "",
      new Map([
        [
          "reduceCandidateContainmentGuardianControlV1",
          "const present = inputMetadata.has(brandedInput); const observed = inputMetadata.get(brandedInput); const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
        ],
      ]),
    ),
    validSkeleton(
      "function sameOriginJoin() { const value = deepFreeze([]); return true ? value : value; }",
    ),
    validSkeleton(
      "function completeBranches() { if (true) { return null; } else { return null; } }",
    ),
    validSkeleton(
      "function completeLoop() { const values = deepFreeze([null]); for (const value of values) { return null; } return null; }",
    ),
    validSkeleton(
      "function acyclicLeaf() { return null; } function acyclicRoot() { return acyclicLeaf(); }",
    ),
    validSkeleton(
      'function pinnedFailure() { throw new Error("CONTROL_SHAPE"); } function normalizedValue(value) { return exactBoolean(value, true, "value", pinnedFailure); }',
    ),
  ];
  assert.equal(contextualPositiveSources.length, 16);
  const contextualPositiveAudits = contextualPositiveSources.map((sourceText) =>
    independentStaticAudit(asBytes(sourceText)),
  );
  assert.equal(
    contextualPositiveAudits.every(
      ({ nodeCount, classifiedNodeCount }) =>
        nodeCount === classifiedNodeCount && nodeCount > 0,
    ),
    true,
  );
  const antiOverrejectAudit = independentStaticAudit(
    asBytes(
      validSkeleton(`
function contextualPositive() {
  const array = [null, true, 1, "bounded"];
  const record = { value: null };
  const set = new Set();
  const error = new Error("bounded");
  if (Boolean(false)) { ; }
  for (const item of array) { if (item) { ; } }
  if (false) { throw error; }
  const result = (true ? 1 : 2) + (false || 0);
  Array.isArray(array);
  Number.isInteger(result);
  Object.hasOwn(record, "value");
  set.has(null);
  String("bounded");
  return null;
}`),
    ),
  );
  assert.equal(
    antiOverrejectAudit.classifiedNodeCount,
    antiOverrejectAudit.nodeCount,
  );
  const trustedMemberRolePositiveSources = [
    validSkeleton(
      "function helper() { const value = deepFreeze([null]); const member = value.length; return member; }",
    ),
    validSkeleton(
      "function helper() { const value = deepFreeze([null]); value.slice(0); return null; }",
    ),
    validSkeleton(
      "function helper() { const value = deepFreeze([null]).slice(0); return value.length; }",
    ),
    validSkeleton(
      'function helper() { const value = String("bounded").length; return value; }',
    ),
  ];
  assert.equal(trustedMemberRolePositiveSources.length, 4);
  for (const sourceText of trustedMemberRolePositiveSources) {
    const audit = independentStaticAudit(asBytes(sourceText));
    assert.equal(audit.classifiedNodeCount, audit.nodeCount);
  }
  const trustedComputedStringPositiveSources = [
    validSkeleton('const boundedAt = "bounded".at(0);'),
    validSkeleton('const boundedSlice = "bounded".slice(1, 4);'),
    validSkeleton('const boundedStringSlice = String("bounded").slice(0, 7);'),
    validSkeleton('const boundedFrozenAt = deepFreeze(["bounded"]).at(0);'),
    validSkeleton(
      'function helper() { const values = deepFreeze(["bounded"]); return values.at(0); }',
    ),
    validSkeleton(
      'function helper() { const value = String("bounded"); return value.slice(0, 3); }',
    ),
    validSkeleton(
      'const boundedFrozenString = String(deepFreeze(["bounded"]));',
    ),
    validSkeleton(
      'const boundedObjectMember = deepFreeze({ value: "bounded" }).value;',
    ),
    validSkeleton(
      'function helper() { const record = deepFreeze({ value: "bounded" }); return record.value; }',
    ),
    validSkeleton(
      'const boundedNullRecordMember = deepFreeze(nullRecord([["value", "bounded"]])).value;',
    ),
    validSkeleton(
      'const boundedSliceAt = deepFreeze(["bounded"]).slice(0, 1).at(0);',
    ),
    validSkeleton(
      'const boundedSliceString = String(deepFreeze(["bounded"]).slice(0, 1));',
    ),
    validSkeleton("const boundedNullString = String(null);"),
    validSkeleton("const boundedBooleanString = String(false);"),
    validSkeleton("const boundedVoidString = String(void 0);"),
    validSkeleton('const boundedErrorString = String(new Error("bounded"));'),
    validSkeleton("const boundedSetString = String(new Set());"),
    validSkeleton(
      "function helper() { const kind = typeof false; return kind.slice(0, 3); }",
    ),
    validSkeleton('const boundedArrayConcat = ["bound"] + "ed";'),
    validSkeleton(
      'const boundedFrozenArrayConcat = deepFreeze(["bound"]) + "ed";',
    ),
    validSkeleton(
      'function helper() { const values = deepFreeze(["bound"]); return values.slice(0, 1) + "ed"; }',
    ),
    validSkeleton(
      'const boundedRecordArrayConcat = deepFreeze({ value: ["bound"] }).value + "ed";',
    ),
    validSkeleton(
      'const boundedErrorConcat = new Error("bounded") + " suffix";',
    ),
    validSkeleton(
      'const boundedIncludes = "bounded".includes("bound"); const boundedSetHas = new Set().has(null);',
    ),
    validSkeleton(
      "const boundedStaticDigest = sha256(canonicalJsonBytes(false)); function staticLineHelper() { const boundedStaticLine = canonicalJsonLine(false); return null; }",
    ),
    validSkeleton(
      "const boundedMissing = deepFreeze({}).value; const boundedSum = 1 + 2; const boundedSumType = typeof boundedSum;",
    ),
    validSkeleton("const boundedPrimitiveMissing = Boolean(false).value;"),
    validSkeleton("const boundedUnaryType = typeof -true;"),
    validSkeleton(
      'const boundedStringAtMiss = "".at(0); const boundedArrayAtMiss = deepFreeze([]).at(0);',
    ),
    validSkeleton(
      'const boundedNullJoin = "bounded" + [null]; const boundedUndefinedJoin = "bounded" + [void 0]; const boundedNestedNullJoin = "bounded" + [[null]];',
    ),
    validSkeleton("const boundedLineType = typeof canonicalJsonLine(null);"),
    validSkeleton(
      "function invariantCallTypeHelper(input) { const stringKind = typeof String(input); const booleanKind = typeof Boolean(input); const numberKind = typeof Number(input); const bytesKind = typeof canonicalJsonBytes(input); return null; }",
    ),
    validSkeleton(
      "function invariantOperatorTypeHelper(input) { const negated = !input; const discarded = void input; const compared = input === input; const subtracted = input - 1; return null; }",
    ),
    validSkeleton(
      "function opaqueResultHelper() { const bytes = canonicalJsonBytes(null); return null; }",
    ),
  ];
  assert.equal(trustedComputedStringPositiveSources.length, 34);
  for (const sourceText of trustedComputedStringPositiveSources) {
    const audit = independentStaticAudit(asBytes(sourceText));
    assert.equal(audit.classifiedNodeCount, audit.nodeCount);
  }

  const approvedOneParameterExportSourceWithExtra = (body, extra = "") =>
    validSkeleton(
      extra,
      new Map([
        ["createCandidateContainmentGuardianControllerClosedInputV1", body],
      ]),
    );
  const approvedOneParameterExportSource = (body) =>
    approvedOneParameterExportSourceWithExtra(body);
  const approvedOneParameterExportSourceWithFailure = (body) =>
    approvedOneParameterExportSourceWithExtra(
      body,
      'function failValidation() { throw new Error("CONTROL_SHAPE"); }',
    );
  const callerStringTypeOnlyPositiveSources = [
    approvedOneParameterExportSource(
      "const kind = typeof String(currentState); return kind;",
    ),
    approvedOneParameterExportSource(
      "const kind = typeof currentState; return kind;",
    ),
    approvedOneParameterExportSource(
      "const length = String(currentState).length; return length;",
    ),
    approvedOneParameterExportSource(
      'const present = String(currentState).includes("bounded"); return present;',
    ),
    approvedOneParameterExportSource(
      "const present = Boolean(currentState); return present;",
    ),
    approvedOneParameterExportSource(
      "const next = Number(currentState) + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const next = Number(currentState) + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const kind = typeof sha256(currentState); return kind;",
    ),
    approvedOneParameterExportSource(
      "const next = sha256(currentState).length + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const kind = typeof currentState; const next = kind.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = currentState ? Number(currentState) : Number(currentState); const next = selected + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = Number(currentState) && Number(currentState); const next = selected + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = Number(currentState) || Number(currentState); const next = selected + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = Number(currentState) ?? Number(currentState); const next = selected + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = currentState ? Number(currentState) : Number(currentState); const next = 1 + selected + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = currentState ? [currentState] : [currentState]; const next = selected.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = [currentState] || [currentState]; const next = selected.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const left = deepFreeze({ value: Number(currentState) }); const right = deepFreeze({ value: Number(currentState) }); const selected = currentState ? left : right; const next = selected.value + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const bytes = canonicalJsonBytes(currentState); const next = bytes.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const bytes = canonicalJsonLine(currentState); const next = bytes.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const byte = canonicalJsonBytes(currentState).at(0); const next = byte + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const byte = canonicalJsonLine(currentState).at(0); const present = byte === 123; return present;",
    ),
    approvedOneParameterExportSource(
      "const prefix = canonicalJsonBytes(currentState).slice(0, 1); const next = prefix.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSourceWithFailure(
      'const bytes = copyBoundedBuffer(currentState, "value", { minimumBytes: 0, maximumBytes: 64 }, failValidation); const next = bytes.length + 1 + 1; return next;',
    ),
    approvedOneParameterExportSourceWithFailure(
      'const bytes = decodeCanonicalBase64(currentState, "value", 64, failValidation); const byte = bytes.at(0); const next = byte + 1 + 1; return next;',
    ),
    approvedOneParameterExportSourceWithFailure(
      'const decoded = decodeCanonicalJsonLine(currentState, "value", 64, failValidation); const next = decoded.bytes.length + 1 + 1; return next;',
    ),
    approvedOneParameterExportSource(
      "const record = frozenCopyOnReadBytes(currentState); const byte = record.bytes.at(0); const next = byte + 1 + 1; return next;",
    ),
    approvedOneParameterExportSourceWithFailure(
      'const source = deepFreeze({ value: Number(currentState) }); const record = exactRecord(source, ["value"], "value", failValidation); const next = record.value + 1 + 1; return next;',
    ),
    approvedOneParameterExportSource(
      "const projection = verifyCandidateContainmentLaunchCapsuleV3(currentState); const next = projection.byteLength + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const projection = verifyCandidateContainmentLaunchCapsuleV3(currentState); const present = projection.physicalEligibility === false; return present;",
    ),
    approvedOneParameterExportSource(
      "const projection = verifyCandidateContainmentLaunchCapsuleV3(currentState); const next = projection.rawSha256.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSourceWithFailure(
      'const decoded = decodeCanonicalJsonLine(currentState, "value", 64, failValidation); const byte = decoded.bytes.at(0); const next = byte + 1 + 1; return next;',
    ),
    approvedOneParameterExportSource(
      "const record = frozenCopyOnReadBytes(currentState); const prefix = record.bytes.slice(0, 1); const next = prefix.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const text = String(canonicalJsonBytes(currentState)); const kind = typeof text; return kind;",
    ),
    approvedOneParameterExportSourceWithFailure(
      'const decoded = decodeCanonicalJsonLine(currentState, "value", 64, failValidation); const kind = typeof decoded.value; return kind;',
    ),
    approvedOneParameterExportSourceWithExtra(
      "const result = localBytes(Number(currentState)); const kind = typeof result; const next = kind.length + 1 + 1; return next;",
      "function localBytes(value) { return canonicalJsonBytes(value); }",
    ),
    approvedOneParameterExportSource(
      "const bytes = canonicalJsonBytes(Array.isArray(currentState)); const next = bytes.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "for (const value of [Number(currentState)]) { const next = value + 1 + 1; } return null;",
    ),
    approvedOneParameterExportSourceWithFailure(
      'const record = exactRecord(currentState, ["value"], "value", failValidation); const result = record.value.get("value"); const kind = typeof result; const next = kind.length + 1 + 1; return next;',
    ),
  ];
  assert.equal(callerStringTypeOnlyPositiveSources.length, 39);
  for (const sourceText of callerStringTypeOnlyPositiveSources) {
    const audit = independentStaticAudit(asBytes(sourceText));
    assert.equal(audit.classifiedNodeCount, audit.nodeCount);
  }
  const returnAndContainerPrecisionPositiveSources = [
    approvedOneParameterExportSourceWithExtra(
      "const next = localNumber() + 1 + 1; return next;",
      "function localNumber() { return 1; }",
    ),
    approvedOneParameterExportSourceWithExtra(
      "const next = localIdentity(Number(currentState)) + 1 + 1; return next;",
      "function localIdentity(value) { return value; }",
    ),
    approvedOneParameterExportSourceWithExtra(
      'const next = localIdentity("bounded").length + 1 + 1; return next;',
      "function localIdentity(value) { return value; }",
    ),
    approvedOneParameterExportSourceWithExtra(
      "const selected = localNumber(currentState); const next = selected + 1 + 1; return next;",
      "function localNumber(value) { if (value) { return Number(value); } return Number(value); }",
    ),
    approvedOneParameterExportSource(
      'for (const value of "ok") { const next = value.length + 1 + 1; } return null;',
    ),
    approvedOneParameterExportSource(
      "for (const value of new Set([Number(currentState)])) { const next = value + 1 + 1; } return null;",
    ),
    approvedOneParameterExportSource(
      'for (const value of new Set(["ok"])) { const next = value.length + 1 + 1; } return null;',
    ),
    approvedOneParameterExportSource(
      "const selected = Array.isArray(currentState) ? canonicalJsonBytes(currentState) : [String(currentState)]; const next = selected.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = Array.isArray(currentState) ? canonicalJsonBytes(currentState) : [String(currentState)]; const prefix = selected.slice(0, 1); const next = prefix.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      "const selected = Array.isArray(currentState) ? canonicalJsonBytes(currentState) : [String(currentState)]; const kind = typeof selected.at(0); const next = kind.length + 1 + 1; return next;",
    ),
    approvedOneParameterExportSource(
      'const left = deepFreeze({ value: Number(currentState), schema: "safe" }); const right = deepFreeze({ schema: "safe", value: Number(currentState) }); const selected = currentState ? left : right; const next = selected.value + 1 + 1; return next;',
    ),
    approvedOneParameterExportSource(
      'const left = deepFreeze({ value: Number(currentState) }); const right = deepFreeze({ value: Number(currentState), schema: "safe" }); const selected = currentState ? left : right; const next = selected.value + 1 + 1; return next;',
    ),
    approvedOneParameterExportSource(
      'const left = deepFreeze({ value: Number(currentState) }); const right = deepFreeze({ value: Number(currentState), schema: "safe" }); const selected = currentState ? left : right; const kind = typeof selected.schema; const next = kind.length + 1 + 1; return next;',
    ),
    approvedOneParameterExportSource(
      'const record = frozenCopyOnReadBytes(canonicalJsonBytes(false), [["value", Number(currentState)]]); const next = record.value + 1 + 1; return next;',
    ),
    approvedOneParameterExportSource(
      'const selected = Boolean(currentState) && "safe"; const text = String(selected); const kind = typeof text; const next = kind.length + 1 + 1; return next;',
    ),
    approvedOneParameterExportSource(
      'const selected = currentState ? Number(currentState) : "safe"; const text = String(selected); const next = text.length + 1 + 1; return next;',
    ),
  ];
  assert.equal(returnAndContainerPrecisionPositiveSources.length, 16);
  for (const sourceText of returnAndContainerPrecisionPositiveSources) {
    const audit = independentStaticAudit(asBytes(sourceText));
    assert.equal(audit.classifiedNodeCount, audit.nodeCount);
  }

  const mutationKills = [];
  const kill = (id, run, expectedMessage = null) => {
    let rejection = null;
    try {
      run();
    } catch (error) {
      rejection = error;
    }
    assert.notEqual(rejection, null, `${id} survived`);
    if (expectedMessage !== null) {
      assert.match(String(rejection.message), expectedMessage, id);
    }
    mutationKills.push(
      Object.freeze({
        id,
        reason: String(rejection.message).split("\n", 1)[0],
      }),
    );
  };
  const auditExtra = (extra) =>
    independentStaticAudit(asBytes(validSkeleton(extra)));
  const forbiddenFreeAmbientControls = [
    ...new Set([
      ...DIRECT_FORBIDDEN_IDENTIFIER_NAMES,
      "Atomics",
      "BigInt",
      "console",
      "crypto",
      "Intl",
      "Math",
      "navigator",
      "performance",
      "setImmediate",
      "SharedArrayBuffer",
      "structuredClone",
      "URL",
      "WebAssembly",
    ]),
  ].sort();
  for (const freeIdentifier of forbiddenFreeAmbientControls) {
    kill(`direct-free-${freeIdentifier}`, () =>
      auditExtra(`const leaked = ${freeIdentifier};`),
    );
  }
  const contextualMutationSources = [
    [
      "direct-context-param-object-pattern",
      "function helper({ value }) { return value; }",
    ],
    [
      "direct-context-param-array-pattern",
      "function helper([value]) { return value; }",
    ],
    [
      "direct-context-param-rest",
      "function helper(...values) { return values; }",
    ],
    [
      "direct-context-param-default",
      "function helper(value = null) { return value; }",
    ],
    [
      "direct-context-param-rest-destructure",
      "function helper(...[value]) { return value; }",
    ],
    ["direct-context-var-object-pattern", "const { value } = { value: null };"],
    ["direct-context-var-array-pattern", "const [value] = [null];"],
    [
      "direct-context-var-object-rest",
      "const { value, ...rest } = { value: null };",
    ],
    ["direct-context-var-array-rest", "const [value, ...rest] = [null];"],
    ["direct-context-let", "let value = null;"],
    ["direct-context-var", "var value = null;"],
    [
      "direct-context-multiple-declarators",
      "const first = null, second = null;",
    ],
    [
      "direct-context-nested-function",
      "function outer() { function inner() { return null; } return null; }",
    ],
    ["direct-context-try-catch", "try {} catch (error) {}"],
    ["direct-context-try-finally", "try {} finally {}"],
    ["direct-context-while", "while (false) {}"],
    ["direct-context-do-while", "do {} while (false);"],
    ["direct-context-classic-for", "for (;;) {}"],
    [
      "direct-context-for-in",
      "const value = deepFreeze({}); for (const key in value) {}",
    ],
    [
      "direct-context-switch",
      "const value = null; switch (value) { case null: break; default: break; }",
    ],
    ["direct-context-label", "label: {}"],
    ["direct-context-continue-label", "loop: for (;;) { continue loop; }"],
    [
      "direct-context-assignment",
      "function helper() { const value = null; value = false; return null; }",
    ],
    [
      "direct-context-compound-assignment",
      "function helper() { const value = 0; value += 1; return null; }",
    ],
    [
      "direct-context-update",
      "function helper() { const value = 0; value++; return null; }",
    ],
    ["direct-context-sequence", "const value = (null, false);"],
    ["direct-context-decimal-fraction", "const value = 1.5;"],
    ["direct-context-exponent-number", "const value = 1e3;"],
    ["direct-context-numeric-separator", "const value = 1_000;"],
    ["direct-context-negative-zero", "const value = -0;"],
    ["direct-context-array-hole", "const value = deepFreeze([,]);"],
    [
      "direct-context-object-shorthand",
      "const value = null; const record = deepFreeze({ value });",
    ],
    ["direct-context-import-as-value", "const helperAlias = sha256;"],
    [
      "direct-context-import-member-as-value",
      "const helperMember = sha256.call;",
    ],
    [
      "direct-context-export-as-value",
      "const operation = reduceCandidateContainmentGuardianControlV1;",
    ],
    [
      "direct-context-private-store-as-value",
      "const storeAlias = startupMetadata;",
    ],
    [
      "direct-context-private-member-as-value",
      "const setter = startupMetadata.set;",
    ],
    [
      "direct-context-lexical-member-as-value",
      "const value = deepFreeze({}); const member = value.toString;",
    ],
    [
      "direct-context-lexical-member-call",
      "function helper() { const value = {}; value.toString(); return null; }",
    ],
    [
      "direct-context-param-member-call",
      "function helper(value) { value.toString(); return null; }",
    ],
    [
      "direct-context-param-safe-member-call",
      "function helper(value) { value.slice(0); return null; }",
    ],
    [
      "direct-context-ambient-call-result-member",
      "function helper() { Object.freeze({}).toString(); return null; }",
    ],
    [
      "direct-context-new-lexical-constructor",
      "function Helper() { return null; } const value = new Helper();",
    ],
    ["direct-context-mutable-module-set", "const value = new Set();"],
    [
      "direct-context-delete",
      "function helper() { const value = {}; delete value.value; return null; }",
    ],
    ["direct-context-in-operator", 'const value = "value" in {};'],
    ["direct-context-top-level-throw", 'throw new Error("bounded");'],
    [
      "direct-context-shadow-import-parameter",
      "function helper(sha256) { return null; }",
    ],
    [
      "direct-context-shadow-store-parameter",
      "function helper(startupMetadata) { return null; }",
    ],
    [
      "direct-context-shadow-export-parameter",
      "function helper(reduceCandidateContainmentGuardianControlV1) { return null; }",
    ],
    [
      "direct-context-shadow-import-local",
      "function helper() { const sha256 = null; return null; }",
    ],
    [
      "direct-context-import-call-indirection",
      "function helper() { sha256.call(null, null); return null; }",
    ],
    [
      "direct-context-import-bind-indirection",
      "function helper() { const bound = sha256.bind(null); return null; }",
    ],
    [
      "direct-context-store-call-indirection",
      "function helper() { startupMetadata.set.call(null, null, null); return null; }",
    ],
    [
      "direct-context-export-call-indirection",
      "function helper() { reduceCandidateContainmentGuardianControlV1.call(null, null, null); return null; }",
    ],
    [
      "direct-context-object-key-proto",
      'const value = deepFreeze({ "__proto__": null });',
    ],
    [
      "direct-context-object-key-constructor",
      'const value = deepFreeze({ "constructor": null });',
    ],
    [
      "direct-context-object-key-prototype",
      'const value = deepFreeze({ "prototype": null });',
    ],
    [
      "direct-context-object-define-constructor",
      'function helper() { Object.defineProperty({}, "constructor", { value: null }); return null; }',
    ],
    ["direct-context-capability-constructor", 'const value = "constructor";'],
    [
      "direct-context-capability-folded-constructor",
      'const value = "con" + "structor";',
    ],
    ["direct-context-capability-process", 'const value = "process";'],
    ["direct-context-capability-global", 'const value = "globalThis";'],
    ["direct-context-capability-require", 'const value = "require";'],
    ["direct-context-capability-function", 'const value = "Function";'],
    [
      "direct-context-error-stack",
      'function helper() { const error = new Error("bounded"); return error.stack; }',
    ],
    [
      "direct-context-lookup-getter",
      "function helper(value) { value.__lookupGetter__; return null; }",
    ],
    [
      "direct-context-define-getter",
      "function helper(value) { value.__defineGetter__; return null; }",
    ],
    [
      "direct-context-caller",
      "function helper(value) { value.caller; return null; }",
    ],
    [
      "direct-context-callee",
      "function helper(value) { value.callee; return null; }",
    ],
    [
      "direct-context-arguments-member",
      "function helper(value) { value.arguments; return null; }",
    ],
    [
      "direct-context-object-create",
      "function helper() { Object.create(null); return null; }",
    ],
    [
      "direct-context-object-define-property",
      'function helper() { Object.defineProperty({}, "value", { value: null }); return null; }',
    ],
    [
      "direct-context-object-freeze",
      "function helper() { Object.freeze({}); return null; }",
    ],
  ];
  for (const [id, sourceText] of contextualMutationSources) {
    kill(id, () => auditExtra(sourceText), /^direct static gate: contextual /u);
  }
  const computedEquivalentMutationSources = [
    [
      "direct-computed-equivalent-node-at",
      'const value = "n".at(0) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-node-string-at",
      'const value = String("n").at(0) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-node-frozen-array-at",
      'const value = deepFreeze(["n"]).at(0) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-node-frozen-local-at",
      'function helper() { const values = deepFreeze(["n"]); return values.at(0) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-string-frozen-array",
      'const value = String(deepFreeze(["n"])) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-frozen-object-member",
      'const value = deepFreeze({ value: "n" }).value + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-frozen-local-object-member",
      'function helper() { const record = deepFreeze({ value: "n" }); return record.value + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-null-record-member",
      'const value = deepFreeze(nullRecord([["value", "n"]])).value + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-array-slice-at",
      'const value = deepFreeze(["n"]).slice(0, 1).at(0) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-array-slice-string",
      'const value = String(deepFreeze(["n"]).slice(0, 1)) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-proc-slice",
      'const value = "/prX".slice(0, 3) + "oc/self/environ";',
    ],
    [
      "direct-computed-equivalent-evaluator-slice",
      'const value = "evaX".slice(0, 3) + "luator";',
    ],
    [
      "direct-computed-equivalent-test-path-slice",
      'const value = "../teX".slice(0, 5) + "st/probe.mjs";',
    ],
    [
      "direct-computed-equivalent-openrouter-slice",
      'const value = "OpenX".slice(0, 4) + "Router";',
    ],
    [
      "direct-computed-equivalent-process-at",
      'const value = "p".at(0) + "rocess";',
    ],
    [
      "direct-computed-equivalent-constructor-slice",
      'const value = "conX".slice(0, 3) + "structor";',
    ],
    ["direct-computed-equivalent-eval-at", 'const value = "e".at(0) + "val";'],
    [
      "direct-computed-equivalent-function-slice",
      'const value = "FunX".slice(0, 3) + "ction";',
    ],
    [
      "direct-computed-equivalent-buffer-slice",
      'const value = "BufX".slice(0, 3) + "fer";',
    ],
    ["direct-computed-equivalent-date-at", 'const value = "D".at(0) + "ate";'],
    [
      "direct-computed-equivalent-json-slice",
      'const value = "JSX".slice(0, 2) + "ON";',
    ],
    [
      "direct-computed-equivalent-promise-slice",
      'const value = "ProX".slice(0, 3) + "mise";',
    ],
    [
      "direct-computed-equivalent-proxy-slice",
      'const value = "PrX".slice(0, 2) + "oxy";',
    ],
    [
      "direct-computed-equivalent-weakset-slice",
      'const value = "WeakX".slice(0, 4) + "Set";',
    ],
    [
      "direct-computed-equivalent-proto-slice",
      'const value = "__prX".slice(0, 4) + "oto__";',
    ],
    [
      "direct-computed-equivalent-fetch-at",
      'const value = "f".at(0) + "etch";',
    ],
    [
      "direct-computed-equivalent-global-slice",
      'const value = "globalX".slice(0, 6) + "This";',
    ],
    [
      "direct-computed-equivalent-prototype-slice",
      'const value = "proX".slice(0, 3) + "totype";',
    ],
    [
      "direct-computed-equivalent-timeout-slice",
      'const value = "setX".slice(0, 3) + "Timeout";',
    ],
    [
      "direct-computed-equivalent-require-slice",
      'const value = "reX".slice(0, 2) + "quire";',
    ],
    [
      "direct-computed-equivalent-null-string-at",
      'const value = String(null).at(0) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-boolean-string-at",
      'const value = String(false).at(0) + "etch";',
    ],
    [
      "direct-computed-equivalent-void-string-at",
      'const value = String(void 0).at(3) + "val";',
    ],
    [
      "direct-computed-equivalent-error-string-at",
      'const value = String(new Error("n")).at(7) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-set-string-slice",
      'const value = String(new Set()).slice(8, 9) + "etTimeout";',
    ],
    [
      "direct-computed-equivalent-local-typeof-at",
      'function helper() { const kind = typeof false; return kind.at(0) + "uffer"; }',
    ],
  ];
  assert.equal(computedEquivalentMutationSources.length, 36);
  for (const [id, sourceText] of computedEquivalentMutationSources) {
    kill(
      id,
      () => auditExtra(sourceText),
      /^direct static gate: contextual capability-looking compile-time string /u,
    );
  }
  kill(
    "direct-computed-equivalent-arithmetic-string-at",
    () => auditExtra('const value = String(0 / 0).at(0) + "ode:fs";'),
    /^direct static gate: contextual unanalyzable string-bearing String conversion$/u,
  );
  kill(
    "direct-computed-equivalent-duplicate-object-last-value",
    () =>
      auditExtra(
        'const value = deepFreeze({ value: "safe", value: "n" }).value + "ode:fs";',
      ),
    /^direct static gate: contextual duplicate object property$/u,
  );
  const computedKnownResultMutationSources = [
    [
      "direct-computed-equivalent-implicit-array-plus",
      'const value = ["n"] + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-frozen-array-plus",
      'const value = deepFreeze(["n"]) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-array-slice-plus",
      'const value = deepFreeze(["n"]).slice(0, 1) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-nested-array-plus",
      'const value = [["n"]] + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-conditional-array-plus",
      'const value = (true ? ["n"] : ["safe"]) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-logical-array-plus",
      'const value = (true && ["n"]) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-nullish-array-plus",
      'const value = (null ?? ["n"]) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-record-array-plus",
      'const value = deepFreeze({ value: ["n"] }).value + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-null-record-array-plus",
      'const value = deepFreeze(nullRecord([["value", ["n"]]])).value + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-implicit-error-plus",
      'const value = new Error("n") + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-boolean-call-string",
      'const value = String(Boolean(false)).at(0) + "etch";',
    ],
    [
      "direct-computed-equivalent-includes-string",
      'const value = String("x".includes("x")).at(3) + "val";',
    ],
    [
      "direct-computed-equivalent-set-has-string",
      'const value = String(new Set().has(null)).at(3) + "val";',
    ],
    [
      "direct-computed-equivalent-array-is-array-string",
      'const value = String(Array.isArray([])).at(3) + "val";',
    ],
    [
      "direct-computed-equivalent-number-is-integer-string",
      'const value = String(Number.isInteger(0)).at(3) + "val";',
    ],
    [
      "direct-computed-equivalent-object-has-own-string",
      'const value = String(Object.hasOwn({ value: null }, "value")).at(3) + "val";',
    ],
    [
      "direct-computed-equivalent-canonical-json-bytes-string",
      'const value = String(canonicalJsonBytes(null)).at(0) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-canonical-json-line-string",
      'const value = String(canonicalJsonLine(false)).at(0) + "etch";',
    ],
    [
      "direct-computed-equivalent-static-sha-at",
      'const value = sha256(canonicalJsonBytes(false)).at(0) + "etch";',
    ],
    [
      "direct-computed-equivalent-arithmetic-typeof",
      'function helper() { const result = 1 - 1; const kind = typeof result; return kind.at(0) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-comparison-typeof",
      'function helper() { const result = 1 < 2; const kind = typeof result; return kind.at(4) + "val"; }',
    ],
    [
      "direct-computed-equivalent-error-name",
      'const value = new Error("bounded").name.at(0) + "val";',
    ],
    [
      "direct-computed-equivalent-set-size-typeof",
      'function helper() { const size = new Set().size; const kind = typeof size; return kind.at(0) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-missing-object-property",
      'const value = String(deepFreeze({}).value).at(1) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-missing-null-record-property",
      'function helper() { const record = deepFreeze(nullRecord([])); const missing = record.value; const kind = typeof missing; return kind.at(1) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-missing-primitive-property",
      'const value = String(Boolean(false).value).at(1) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-unary-number-type",
      'const result = -true; const kind = typeof result; const value = kind.at(0) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-string-at-undefined-type",
      'const result = "".at(0); const kind = typeof result; const value = kind.at(1) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-array-at-undefined-type",
      'const result = deepFreeze([]).at(0); const kind = typeof result; const value = kind.at(1) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-line-result-type",
      'const kind = typeof canonicalJsonLine(null); const value = kind.at(0) + "penRouter";',
    ],
    [
      "direct-computed-equivalent-null-array-join",
      'const value = "n" + [null] + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-frozen-null-array-join",
      'const value = "n" + deepFreeze([null]) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-nested-null-array-join",
      'const value = "n" + deepFreeze([[null]]) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-missing-array-element-join",
      'const missing = deepFreeze({}).value; const value = "n" + [missing] + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-null-array-string",
      'const value = "n" + String([null]) + "ode:fs";',
    ],
    [
      "direct-computed-equivalent-dynamic-string-type",
      'function helper(input) { const kind = typeof String(input); return kind.at(4) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-boolean-type",
      'function helper(input) { const kind = typeof Boolean(input); return kind.at(4) + "val"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-number-type",
      'function helper(input) { const kind = typeof Number(input); return kind.at(0) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-bytes-type",
      'function helper(input) { const kind = typeof canonicalJsonBytes(input); return kind.at(0) + "penRouter"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-sha-type",
      'function helper(input) { const kind = typeof sha256(input); return kind.at(4) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-includes-type",
      'function helper(input) { const result = "x".includes(String(input)); const kind = typeof result; return kind.at(4) + "val"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-negation-type",
      'function helper(input) { const result = !input; const kind = typeof result; return kind.at(4) + "val"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-void-type",
      'function helper(input) { const result = void input; const kind = typeof result; return kind.at(1) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-comparison-type",
      'function helper(input) { const result = input === input; const kind = typeof result; return kind.at(4) + "val"; }',
    ],
    [
      "direct-computed-equivalent-dynamic-arithmetic-type",
      'function helper(input) { const result = input - 1; const kind = typeof result; return kind.at(0) + "ode:fs"; }',
    ],
    [
      "direct-computed-equivalent-known-opaque-member",
      'function helper() { const bytes = canonicalJsonBytes(null); const result = bytes.name; return String(result).at(1) + "ode:fs"; }',
    ],
  ];
  assert.equal(computedKnownResultMutationSources.length, 46);
  for (const [id, sourceText] of computedKnownResultMutationSources) {
    kill(
      id,
      () => auditExtra(sourceText),
      /^direct static gate: contextual (?:capability-looking compile-time string |unanalyzable string-bearing)/u,
    );
  }
  const callerDrivenStringMutationSources = [
    [
      "direct-caller-string-at-derived-value",
      "const hidden = String(currentState).at(0); return null;",
    ],
    [
      "direct-caller-string-slice-derived-value",
      "const hidden = String(currentState).slice(0, 1); return null;",
    ],
    [
      "direct-caller-string-at-node",
      'const hidden = String(currentState).at(0) + "ode:fs"; return null;',
    ],
    [
      "direct-caller-string-slice-node",
      'const hidden = String(currentState).slice(0, 1) + "ode:fs"; return null;',
    ],
    [
      "direct-caller-string-direct-node",
      'const hidden = String(currentState) + "ode:fs"; return null;',
    ],
    [
      "direct-caller-string-reversed-node",
      'const hidden = "nod" + String(currentState); return null;',
    ],
    [
      "direct-caller-coercion-node",
      'const hidden = currentState + "ode:fs"; return null;',
    ],
    [
      "direct-caller-string-at-openrouter",
      'const hidden = String(currentState).at(0) + "penRouter"; return null;',
    ],
    [
      "direct-caller-string-at-evaluator",
      'const hidden = String(currentState).at(0) + "valuator"; return null;',
    ],
    [
      "direct-caller-string-at-test-path",
      'const hidden = String(currentState).at(0) + "est/probe.mjs"; return null;',
    ],
    [
      "direct-caller-string-slice-proc",
      'const hidden = String(currentState).slice(0, 2) + "roc/self/status"; return null;',
    ],
    [
      "direct-caller-string-at-process",
      'const hidden = String(currentState).at(0) + "rocess"; return null;',
    ],
    [
      "direct-caller-string-slice-constructor",
      'const hidden = String(currentState).slice(0, 3) + "structor"; return null;',
    ],
    [
      "direct-caller-string-at-function",
      'const hidden = String(currentState).at(0) + "unction"; return null;',
    ],
    [
      "direct-caller-string-conditional-node",
      'const prefix = true ? String(currentState) : "n"; const hidden = prefix + "ode:fs"; return null;',
    ],
    [
      "direct-caller-string-logical-node",
      'const prefix = false || String(currentState); const hidden = prefix + "ode:fs"; return null;',
    ],
    [
      "direct-caller-array-string-at-node",
      'const hidden = String([currentState]).at(0) + "ode:fs"; return null;',
    ],
    [
      "direct-caller-object-member-string-at-node",
      'const value = deepFreeze({ value: currentState }).value; const hidden = String(value).at(0) + "ode:fs"; return null;',
    ],
    [
      "direct-caller-error-string-evaluator",
      'const hidden = new Error(String(currentState)) + "valuator"; return null;',
    ],
    [
      "direct-caller-boolean-string-at-fetch",
      'const hidden = String(Boolean(currentState)).at(0) + "etch"; return null;',
    ],
    [
      "direct-caller-sha-string-at-fetch",
      'const hidden = sha256(currentState).at(0) + "etch"; return null;',
    ],
    [
      "direct-private-read-string-at-node",
      'const observed = stateMetadata.get(currentState); const hidden = String(observed).at(0) + "ode:fs"; return null;',
    ],
    [
      "direct-caller-string-slice-at-node",
      'const hidden = String(currentState).slice(0, 2).at(0) + "ode:fs"; return null;',
    ],
  ];
  assert.equal(callerDrivenStringMutationSources.length, 23);
  for (const [id, body] of callerDrivenStringMutationSources) {
    kill(
      id,
      () =>
        independentStaticAudit(asBytes(approvedOneParameterExportSource(body))),
      /^direct static gate: contextual (?:caller-drivable string concatenation|unanalyzable string-bearing member transform|capability-looking compile-time string )/u,
    );
  }
  const adjacentCallerProvenanceMutationSources = [
    [
      "direct-caller-raw-typeof-at-node",
      approvedOneParameterExportSource(
        'const kind = typeof currentState; const hidden = kind.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-raw-typeof-slice-node",
      approvedOneParameterExportSource(
        'const kind = typeof currentState; const hidden = kind.slice(0, 1) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-private-read-typeof-at-node",
      approvedOneParameterExportSource(
        'const observed = stateMetadata.get(currentState); const kind = typeof observed; const hidden = kind.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-record-member-typeof-at-node",
      approvedOneParameterExportSource(
        'const record = deepFreeze({ value: currentState }); const kind = typeof record.value; const hidden = kind.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-conditional-number-typeof-at-node",
      approvedOneParameterExportSource(
        'const selected = currentState ? Number(currentState) : Number(currentState); const kind = typeof selected; const hidden = kind.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-logical-number-typeof-at-node",
      approvedOneParameterExportSource(
        'const selected = Number(currentState) && Number(currentState); const kind = typeof selected; const hidden = kind.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-nullish-number-typeof-at-node",
      approvedOneParameterExportSource(
        'const selected = Number(currentState) ?? Number(currentState); const kind = typeof selected; const hidden = kind.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-conditional-array-typeof-at-openrouter",
      approvedOneParameterExportSource(
        'const selected = currentState ? [currentState] : [currentState]; const kind = typeof selected; const hidden = kind.at(0) + "penRouter"; return null;',
      ),
    ],
    [
      "direct-caller-canonical-json-bytes-plus-node",
      approvedOneParameterExportSource(
        'const bytes = canonicalJsonBytes(currentState); const hidden = bytes + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-canonical-json-bytes-reversed-node",
      approvedOneParameterExportSource(
        'const bytes = canonicalJsonBytes(currentState); const hidden = "nod" + bytes; return null;',
      ),
    ],
    [
      "direct-caller-canonical-json-line-plus-node",
      approvedOneParameterExportSource(
        'const bytes = canonicalJsonLine(currentState); const hidden = bytes + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-canonical-json-line-reversed-node",
      approvedOneParameterExportSource(
        'const bytes = canonicalJsonLine(currentState); const hidden = "nod" + bytes; return null;',
      ),
    ],
    [
      "direct-caller-copy-bounded-buffer-plus-node",
      approvedOneParameterExportSourceWithFailure(
        'const bytes = copyBoundedBuffer(currentState, "value", { minimumBytes: 0, maximumBytes: 64 }, failValidation); const hidden = bytes + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-decoded-base64-plus-node",
      approvedOneParameterExportSourceWithFailure(
        'const bytes = decodeCanonicalBase64(currentState, "value", 64, failValidation); const hidden = bytes + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-decoded-json-bytes-slice-node",
      approvedOneParameterExportSourceWithFailure(
        'const decoded = decodeCanonicalJsonLine(currentState, "value", 64, failValidation); const prefix = decoded.bytes.slice(0, 1); const hidden = prefix + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-decoded-json-value-plus-node",
      approvedOneParameterExportSourceWithFailure(
        'const decoded = decodeCanonicalJsonLine(currentState, "value", 64, failValidation); const hidden = decoded.value + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-frozen-copy-bytes-slice-node",
      approvedOneParameterExportSource(
        'const record = frozenCopyOnReadBytes(currentState); const prefix = record.bytes.slice(0, 1); const hidden = prefix + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-exact-record-member-at-node",
      approvedOneParameterExportSourceWithFailure(
        'const record = exactRecord(currentState, ["value"], "value", failValidation); const hidden = record.value.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-launch-projection-member-at-evaluator",
      approvedOneParameterExportSource(
        'const projection = verifyCandidateContainmentLaunchCapsuleV3(currentState); const hidden = projection.requestSha256.at(0) + "valuator"; return null;',
      ),
    ],
    [
      "direct-caller-string-canonical-json-bytes-at-node",
      approvedOneParameterExportSource(
        'const bytes = canonicalJsonBytes(currentState); const text = String(bytes); const hidden = text.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-canonical-json-bytes-slice-node",
      approvedOneParameterExportSource(
        'const prefix = canonicalJsonBytes(currentState).slice(0, 1); const hidden = prefix + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-conditional-buffer-slice-node",
      approvedOneParameterExportSource(
        'const left = canonicalJsonBytes(currentState); const right = canonicalJsonLine(currentState); const selected = currentState ? left : right; const prefix = selected.slice(0, 1); const hidden = prefix + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-array-buffer-plus-node",
      approvedOneParameterExportSource(
        'const values = [canonicalJsonBytes(currentState)]; const hidden = values + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-decoded-json-join-value-plus-node",
      approvedOneParameterExportSourceWithFailure(
        'const left = decodeCanonicalJsonLine(currentState, "left", 64, failValidation); const right = decodeCanonicalJsonLine(currentState, "right", 64, failValidation); const selected = currentState ? left : right; const hidden = selected.value + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-local-json-bytes-wrapper-plus-node",
      approvedOneParameterExportSourceWithExtra(
        'const bytes = localBytes(Number(currentState)); const hidden = bytes + "ode:fs"; return null;',
        "function localBytes(value) { return canonicalJsonBytes(value); }",
      ),
    ],
    [
      "direct-caller-local-json-bytes-wrapper-reversed-node",
      approvedOneParameterExportSourceWithExtra(
        'const bytes = localBytes(Number(currentState)); const hidden = "nod" + bytes; return null;',
        "function localBytes(value) { return canonicalJsonBytes(value); }",
      ),
    ],
    [
      "direct-caller-local-buffer-identity-plus-node",
      approvedOneParameterExportSourceWithExtra(
        'const bytes = localIdentity(canonicalJsonBytes(currentState)); const hidden = bytes + "ode:fs"; return null;',
        "function localIdentity(value) { return value; }",
      ),
    ],
    [
      "direct-caller-local-buffer-array-identity-plus-node",
      approvedOneParameterExportSourceWithExtra(
        'const values = localIdentity([canonicalJsonBytes(currentState)]); const hidden = values + "ode:fs"; return null;',
        "function localIdentity(value) { return value; }",
      ),
    ],
    [
      "direct-caller-local-string-wrapper-at-node",
      approvedOneParameterExportSourceWithExtra(
        'const text = localString(Number(currentState)); const hidden = text.at(0) + "ode:fs"; return null;',
        "function localString(value) { return String(value); }",
      ),
    ],
    [
      "direct-caller-ambient-boolean-canonical-bytes-plus-node",
      approvedOneParameterExportSource(
        'const present = Array.isArray(currentState); const bytes = canonicalJsonBytes(present); const hidden = bytes + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-caller-array-for-of-canonical-bytes-plus-node",
      approvedOneParameterExportSource(
        'for (const value of [currentState]) { const bytes = canonicalJsonBytes(value); const hidden = bytes + "ode:fs"; } return null;',
      ),
    ],
    [
      "direct-caller-exact-record-nested-get-plus-node",
      approvedOneParameterExportSourceWithFailure(
        'const record = exactRecord(currentState, ["value"], "value", failValidation); const result = record.value.get("value"); const hidden = result + "ode:fs"; return null;',
      ),
    ],
  ];
  assert.equal(adjacentCallerProvenanceMutationSources.length, 32);
  for (const [id, sourceText] of adjacentCallerProvenanceMutationSources) {
    kill(
      id,
      () => independentStaticAudit(asBytes(sourceText)),
      /^direct static gate: contextual (?:caller-drivable string concatenation|unanalyzable string-bearing member transform|capability-looking compile-time string )/u,
    );
  }
  const returnAndContainerProvenanceMutationSources = [
    [
      "direct-local-zero-argument-return-plus-node",
      approvedOneParameterExportSourceWithExtra(
        'const hidden = localPrefix() + "ode:fs"; return null;',
        'function localPrefix() { return "n"; }',
      ),
    ],
    [
      "direct-local-static-identity-plus-node",
      approvedOneParameterExportSourceWithExtra(
        'const hidden = localIdentity("n") + "ode:fs"; return null;',
        "function localIdentity(value) { return value; }",
      ),
    ],
    [
      "direct-local-static-identity-at-node",
      approvedOneParameterExportSourceWithExtra(
        'const hidden = localIdentity("n").at(0) + "ode:fs"; return null;',
        "function localIdentity(value) { return value; }",
      ),
    ],
    [
      "direct-local-zero-argument-return-at-node",
      approvedOneParameterExportSourceWithExtra(
        'const hidden = localPrefix().at(0) + "ode:fs"; return null;',
        'function localPrefix() { return "n"; }',
      ),
    ],
    [
      "direct-static-string-for-of-plus-node",
      approvedOneParameterExportSource(
        'for (const value of "n") { const hidden = value + "ode:fs"; } return null;',
      ),
    ],
    [
      "direct-static-set-for-of-plus-node",
      approvedOneParameterExportSource(
        'for (const value of new Set(["n"])) { const hidden = value + "ode:fs"; } return null;',
      ),
    ],
    [
      "direct-mixed-buffer-array-at-plus-node",
      approvedOneParameterExportSource(
        'const selected = currentState ? canonicalJsonBytes(currentState) : ["n"]; const hidden = selected.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-dynamic-mixed-buffer-array-at-plus-node",
      approvedOneParameterExportSource(
        'const selected = Array.isArray(currentState) ? canonicalJsonBytes(currentState) : [String(currentState)]; const hidden = selected.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-correlated-mixed-buffer-array-at-plus-node",
      approvedOneParameterExportSource(
        'const selected = Array.isArray(currentState) ? canonicalJsonBytes(currentState) : [currentState]; const hidden = selected.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-different-record-keys-member-plus-node",
      approvedOneParameterExportSourceWithFailure(
        'const left = exactRecord(currentState, ["value"], "value", failValidation); const right = exactRecord(currentState, ["schema"], "schema", failValidation); const selected = currentState ? left : right; const hidden = selected.value + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-different-exact-record-keys-member-at-node",
      approvedOneParameterExportSourceWithFailure(
        'const left = exactRecord(currentState, ["value"], "value", failValidation); const right = exactRecord(currentState, ["name"], "name", failValidation); const selected = currentState ? left : right; const hidden = selected.value.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-frozen-copy-duplicate-entry-plus-node",
      approvedOneParameterExportSource(
        'const record = frozenCopyOnReadBytes(canonicalJsonBytes(false), [["value", false], ["value", currentState]]); const hidden = record.value + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-frozen-copy-duplicate-entry-at-node",
      approvedOneParameterExportSource(
        'const record = frozenCopyOnReadBytes(canonicalJsonBytes(null), [["value", "bounded"], ["value", String(currentState)]]); const hidden = record.value.at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-frozen-copy-reserved-bytes-entry-plus-node",
      approvedOneParameterExportSource(
        'const record = frozenCopyOnReadBytes(canonicalJsonBytes(false), [["bytes", currentState]]); const hidden = record.bytes + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-boolean-and-string-conversion-at-fetch",
      approvedOneParameterExportSource(
        'const selected = Boolean(currentState) && "safe"; const hidden = String(selected).at(0) + "etch"; return null;',
      ),
    ],
    [
      "direct-boolean-or-string-conversion-at-test",
      approvedOneParameterExportSource(
        'const selected = Boolean(currentState) || "safe"; const hidden = String(selected).at(0) + "est"; return null;',
      ),
    ],
    [
      "direct-boolean-nullish-string-conversion-at-test",
      approvedOneParameterExportSource(
        'const selected = Boolean(currentState) ?? "safe"; const hidden = String(selected).at(0) + "est"; return null;',
      ),
    ],
    [
      "direct-boolean-conditional-string-conversion-at-test",
      approvedOneParameterExportSource(
        'const selected = currentState ? Boolean(currentState) : "safe"; const hidden = String(selected).at(0) + "est"; return null;',
      ),
    ],
    [
      "direct-number-conditional-string-conversion-at-node",
      approvedOneParameterExportSource(
        'const selected = currentState ? Number(currentState) : "safe"; const hidden = String(selected).at(0) + "ode:fs"; return null;',
      ),
    ],
    [
      "direct-string-and-number-conversion-at-node",
      approvedOneParameterExportSource(
        'const selected = "safe" && Number(currentState); const hidden = String(selected).at(0) + "ode:fs"; return null;',
      ),
    ],
  ];
  assert.equal(returnAndContainerProvenanceMutationSources.length, 20);
  for (const [id, sourceText] of returnAndContainerProvenanceMutationSources) {
    kill(
      id,
      () => independentStaticAudit(asBytes(sourceText)),
      id.includes("frozen-copy")
        ? /^direct static gate: contextual duplicate frozenCopyOnReadBytes property$/u
        : null,
    );
  }
  const contextualPrivateMutationSources = [
    [
      "direct-context-private-wrong-store",
      new Map([
        [
          "initializeCandidateContainmentGuardianControlV1",
          "const present = stateMetadata.has(startupProjection); return null;",
        ],
      ]),
    ],
    [
      "direct-context-private-wrong-key",
      new Map([
        [
          "initializeCandidateContainmentGuardianControlV1",
          "const local = deepFreeze(nullRecord([])); const observed = startupMetadata.get(local); return null;",
        ],
      ]),
    ],
    [
      "direct-context-private-wrong-commit-owner",
      new Map([
        [
          "createCandidateContainmentGuardianAdmissionInputV1",
          "const result = deepFreeze(nullRecord([])); const metadata = deepFreeze(nullRecord([])); stateMetadata.set(result, metadata); return result;",
        ],
      ]),
    ],
    [
      "direct-context-private-member-value-in-owner",
      new Map([
        [
          "initializeCandidateContainmentGuardianControlV1",
          "const getter = startupMetadata.get; return null;",
        ],
      ]),
    ],
  ];
  for (const [id, overrides] of contextualPrivateMutationSources) {
    kill(
      id,
      () => independentStaticAudit(asBytes(validSkeleton("", overrides))),
      /^direct static gate: contextual /u,
    );
  }
  for (const [id, sourceText] of [
    [
      "direct-import-default",
      `${baseline}\nimport value from "./containment-exact-v2.mjs";`,
    ],
    [
      "direct-import-namespace",
      `${baseline}\nimport * as exact from "./containment-exact-v2.mjs";`,
    ],
    [
      "direct-import-side-effect",
      `${baseline}\nimport "./containment-exact-v2.mjs";`,
    ],
    [
      "direct-import-alias",
      baseline.replace("boundedInteger,", "boundedInteger as renamed,"),
    ],
    ["direct-import-missing", baseline.replace("boundedInteger, ", "")],
    [
      "direct-import-extra",
      baseline.replace("boundedInteger,", "boundedInteger, extraHelper,"),
    ],
    [
      "direct-import-duplicate",
      baseline.replace("boundedInteger,", "boundedInteger, boundedInteger,"),
    ],
    [
      "direct-export-missing",
      baseline.replace(
        "export function createCandidateContainmentGuardianStartupV1",
        "function createCandidateContainmentGuardianStartupV1",
      ),
    ],
    ["direct-export-extra", `${baseline}\nexport const extraExport = null;`],
    [
      "direct-export-duplicate",
      `${baseline}\nexport { CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS };`,
    ],
    ["direct-export-default", `${baseline}\nexport default null;`],
    [
      "direct-reexport",
      `${baseline}\nexport { sha256 } from "./containment-exact-v2.mjs";`,
    ],
    [
      "direct-function-signature-drift",
      baseline.replace(
        "(startupReportBytes, epochBytes, epochEofObserved)",
        "(epochBytes, startupReportBytes, epochEofObserved)",
      ),
    ],
    [
      "direct-private-store-name-drift",
      baseline.replaceAll("startupMetadata", "renamedStartupMetadata"),
    ],
    [
      "direct-private-store-extra",
      baseline.replace(
        "const startupMetadata = new WeakMap();",
        "const startupMetadata = new WeakMap();\nconst extraMetadata = new WeakMap();",
      ),
    ],
    [
      "direct-private-store-nested-extra",
      `${baseline}\nfunction hiddenStore() { const hiddenMetadata = new WeakMap(); return null; }`,
    ],
    ["direct-static-template", `${baseline}\nconst literal = \`static text\`;`],
    [
      "direct-tagged-template",
      `${baseline}\nfunction tag(parts) { return parts; } const literal = tag\`static text\`;`,
    ],
    ["direct-regular-expression", `${baseline}\nconst pattern = /^[a-z]+$/u;`],
    ["direct-bigint-literal", `${baseline}\nconst value = 1n;`],
    ["direct-arrow-function", `${baseline}\nconst helper = () => null;`],
    [
      "direct-function-expression",
      `${baseline}\nconst helper = function named() { return null; };`,
    ],
    [
      "direct-async-function-declaration",
      `${baseline}\nasync function helper() { return null; }`,
    ],
    [
      "direct-async-function-expression",
      `${baseline}\nconst helper = async function () { return null; };`,
    ],
    [
      "direct-generator-function-declaration",
      `${baseline}\nfunction* helper() { return null; }`,
    ],
    ["direct-class-declaration", `${baseline}\nclass Hidden {}`],
    ["direct-spread-syntax", `${baseline}\nconst spread = [...[]];`],
    [
      "direct-assignment-default-free-identifier",
      `${baseline}\nfunction helper(value = ambientLeak) { return value; }`,
    ],
    ["direct-ambient-array-from", `${baseline}\nconst value = Array.from([]);`],
    [
      "direct-ambient-boolean-call-member",
      `${baseline}\nconst value = Boolean.call(null, false);`,
    ],
    [
      "direct-ambient-error-capture-stack-trace",
      `${baseline}\nError.captureStackTrace({});`,
    ],
    [
      "direct-ambient-number-parse-int",
      `${baseline}\nconst value = Number.parseInt("1", 10);`,
    ],
    [
      "direct-ambient-object-assign",
      `${baseline}\nconst value = Object.assign({}, {});`,
    ],
    [
      "direct-ambient-reflect-get",
      `${baseline}\nconst value = Reflect.get({}, "value");`,
    ],
    [
      "direct-ambient-set-call-member",
      `${baseline}\nconst value = Set.call(null);`,
    ],
    [
      "direct-ambient-string-raw-member",
      `${baseline}\nconst value = String.raw("bounded");`,
    ],
    [
      "direct-ambient-weak-map-call-member",
      `${baseline}\nconst value = WeakMap.call(null);`,
    ],
    [
      "direct-ambient-member-as-value",
      `${baseline}\nconst freeze = Object.freeze;`,
    ],
    [
      "direct-ambient-object-as-value",
      `${baseline}\nconst objectAlias = Object;`,
    ],
    [
      "direct-ambient-reflect-as-value",
      `${baseline}\nconst reflectAlias = Reflect;`,
    ],
    ["direct-ambient-invalid-call", `${baseline}\nconst value = Object();`],
    [
      "direct-ambient-invalid-constructor",
      `${baseline}\nconst value = new Object();`,
    ],
    ["direct-protected-ambient-binding", `${baseline}\nconst Object = null;`],
    [
      "direct-string-computed-constructor",
      `${baseline}\nconst gadget = Object["constructor"];`,
    ],
    [
      "direct-folded-computed-constructor",
      `${baseline}\nconst gadget = Object["con" + "structor"];`,
    ],
    [
      "direct-dynamic-import",
      `${baseline}\nconst dynamic = import("./containment-exact-v2.mjs");`,
    ],
    ["direct-import-meta", `${baseline}\nconst metadata = import.meta.url;`],
    [
      "direct-escaped-identifier",
      `${baseline}\nconst escaped = gl\\u006fbalThis;`,
    ],
    [
      "direct-unicode-line-separator",
      `${baseline}\nconst split = 1;\u2028const line = 2;`,
    ],
    ["direct-computed-member", `${baseline}\nconst member = Object["keys"];`],
    [
      "direct-constructor-gadget",
      `${baseline}\nconst gadget = Object.constructor;`,
    ],
    [
      "direct-prototype-gadget",
      `${baseline}\nconst gadget = Object.prototype;`,
    ],
    ["direct-node-literal", `${baseline}\nconst path = "node:fs";`],
    ["direct-proc-literal", `${baseline}\nconst path = "/proc/self/environ";`],
    ["direct-evaluator-literal", `${baseline}\nconst path = "evaluator";`],
    [
      "direct-test-path-literal",
      `${baseline}\nconst path = "../test/probe.mjs";`,
    ],
    ["direct-openrouter-literal", `${baseline}\nconst path = "OpenRouter";`],
    [
      "direct-computed-forbidden-literal",
      `${baseline}\nconst path = "node" + ":fs";`,
    ],
    ["direct-top-level-await", `${baseline}\nawait null;`],
    ["direct-hashbang", `#!/usr/bin/env node\n${baseline}`],
    ["direct-for-await", `${baseline}\nfor await (const value of []) {}`],
  ]) {
    kill(id, () => independentStaticAudit(asBytes(sourceText)));
  }
  kill("direct-invalid-utf8", () =>
    independentStaticAudit(Buffer.from([0xc3, 0x28])),
  );
  kill("direct-non-byte-source", () => independentStaticAudit(baseline));
  kill("direct-unknown-node", () =>
    directAssertNodeShape({ type: "FutureExpression", start: 0, end: 0 }),
  );
  kill("direct-unknown-key", () =>
    directAssertNodeShape({
      type: "Identifier",
      start: 0,
      end: 1,
      name: "x",
      futureParserField: true,
    }),
  );
  let fallbackImportCount = 0;
  await assert.rejects(
    () =>
      loadDirectParserForAdversarialEntry({
        directEntry: true,
        importParser() {
          fallbackImportCount += 1;
          return Promise.resolve({ version: "8.18.0", parse: null });
        },
      }),
    /function|strictEqual/gu,
  );
  assert.equal(fallbackImportCount, 1);
  mutationKills.push(
    Object.freeze({
      id: "direct-no-parser-fallback",
      reason: "pinned parser must expose the exact parse function",
    }),
  );

  const evaluatorBytes = readFileSync(fileURLToPath(import.meta.url));
  const evaluatorSha256Before = byteDigest(evaluatorBytes);
  const baselineEvaluatorPolicy =
    directAssertEvaluatorSemanticPolicyBytes(evaluatorBytes);
  const evaluatorPolicyProbe = Buffer.from(evaluatorBytes);
  const policyMarker = Buffer.from(
    ["  [", JSON.stringify("Reflect"), ", new Set()],"].join(""),
    "utf8",
  );
  const policyMutant = Buffer.from(
    ["  [", JSON.stringify("Refleck"), ", new Set()],"].join(""),
    "utf8",
  );
  assert.equal(policyMutant.length, policyMarker.length);
  const markerOffset = evaluatorPolicyProbe.indexOf(policyMarker);
  assert.notEqual(markerOffset, -1);
  assert.equal(
    evaluatorPolicyProbe.indexOf(
      policyMarker,
      markerOffset + policyMarker.length,
    ),
    -1,
  );
  policyMutant.copy(evaluatorPolicyProbe, markerOffset);
  let evaluatorPolicyRejection = null;
  try {
    directAssertEvaluatorSemanticPolicyBytes(evaluatorPolicyProbe);
  } catch (error) {
    evaluatorPolicyRejection = error;
  }
  assert.equal(
    evaluatorPolicyRejection?.message,
    "direct evaluator policy gate: ambient member contract mismatch",
  );
  const mutatedEvaluatorSha256 = byteDigest(evaluatorPolicyProbe);
  policyMarker.copy(evaluatorPolicyProbe, markerOffset);
  const restoredEvaluatorPolicy =
    directAssertEvaluatorSemanticPolicyBytes(evaluatorPolicyProbe);
  assert.equal(evaluatorPolicyProbe.equals(evaluatorBytes), true);
  assert.equal(byteDigest(evaluatorPolicyProbe), evaluatorSha256Before);
  assert.deepEqual(restoredEvaluatorPolicy, baselineEvaluatorPolicy);

  const mutationIds = mutationKills.map(({ id }) => id);
  const mutationReceipt = recursivelyFreezeStatusOracleValue({
    schema:
      "oxigraph.test.candidate-containment-guardian-control-v1-c13-direct-mutation-receipt/v1",
    count: mutationKills.length,
    killed: mutationKills.length,
    survivors: 0,
    idsSha256: digest(mutationIds),
    kills: mutationKills,
    concreteRestoration: {
      preSha256: evaluatorSha256Before,
      mutatedSha256: mutatedEvaluatorSha256,
      postSha256: byteDigest(evaluatorPolicyProbe),
      mutationOffset: markerOffset,
      semanticPolicyField: "DIRECT_ALLOWED_AMBIENT_MEMBERS.Reflect",
      semanticEdit: "Reflect->Refleck",
      mutatedRejectedByPolicyGate:
        evaluatorPolicyRejection?.message ===
        "direct evaluator policy gate: ambient member contract mismatch",
      restoredAcceptedByPolicyGate: true,
      restoredByteExact: true,
      mutatedPolicyProjectionValidated: true,
      mutatedEvaluatorModuleExecuted: false,
      mutationKillClaimed: false,
    },
  });
  assert.deepEqual(
    {
      count: mutationReceipt.count,
      killed: mutationReceipt.killed,
      survivors: mutationReceipt.survivors,
      idsSha256: mutationReceipt.idsSha256,
    },
    {
      count: 374,
      killed: 374,
      survivors: 0,
      idsSha256:
        "c1717af0e5f429c0308726a88a53793e7fa9d44f3fc4599430b61770158b5347",
    },
  );
  assert.equal(
    mutationReceipt.concreteRestoration.preSha256,
    mutationReceipt.concreteRestoration.postSha256,
  );
  assert.notEqual(
    mutationReceipt.concreteRestoration.mutatedSha256,
    mutationReceipt.concreteRestoration.preSha256,
  );
});
