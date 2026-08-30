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
  "be634123e0de20c05ee292215b456589ac2ed885524bb350c83f7044160eb1f6";
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

function assertCandidateTestInputsAtExecution(registration, requiredInputs) {
  for (const name of requiredInputs) {
    const value = registration[name];
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
    registerTest(entry.name, entry.options, () => {
      assertCandidateTestInputsAtExecution(registration, entry.requiredInputs);
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

const DIRECT_ENTRY = isDirectEntry(import.meta.url, process.argv[1]);
const EXACT_V2_LOAD = await loadExactV2ForAdversarialEntry({
  directEntry: DIRECT_ENTRY,
});
const copyBoundedBuffer = EXACT_V2_LOAD.copyBoundedBuffer;
const ADVERSARIAL_EXACT_V2_LOAD_AUDIT = EXACT_V2_LOAD.audit;
if (!DIRECT_ENTRY) {
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

const STATUS_ORACLE_CONSTRUCTION_CONTEXT =
  createStatusOracleConstructionContext();

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

function previousWireBindingForStatusDesign(
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

function materializeStatusEntries(requirements, context, statusDesigns) {
  assert.deepEqual(
    requirements.frameFields.STATUS,
    EXPECTED_STATUS_FRAME_FIELDS,
  );
  assert.equal(
    context.previousFrameGenesisSha256,
    requirements.vocabularies.previousFrameGenesisSha256,
  );
  const statusByPrefix = new Map();
  const entries = statusDesigns.map((design) => {
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
      previousFrameSha256: previousWireBindingForStatusDesign(
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
  return Object.freeze(entries);
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

function materializeAtomicStatusPrefixes(atomicDesigns, statusEntries) {
  const statusById = new Map(statusEntries.map((entry) => [entry.id, entry]));
  const entries = atomicDesigns.map((design) => {
    const first = statusById.get(design.firstStatusDesignId);
    const second = statusById.get(design.secondStatusDesignId);
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
  return Object.freeze(entries);
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
      primaryStatusEncoderConsumed: false,
      statusCount: statusTuples.length,
      atomicCount: atomicTuples.length,
      statusInventorySha256: independentlyDigestStatusOracleValue(statusTuples),
      atomicInventorySha256: independentlyDigestStatusOracleValue(atomicTuples),
    },
  };
}

export function createSourceIndependentMaterializedStatusOracle(requirements) {
  assertPinnedSourceIndependentOracleFixture(requirements);
  const designOracle = createSourceIndependentAdversarialOracle(requirements);
  const emittedStatusByteGoldens = materializeStatusEntries(
    requirements,
    STATUS_ORACLE_CONSTRUCTION_CONTEXT,
    designOracle.registries.emittedStatusByteGoldenDesigns,
  );
  const atomicTwoStatusWirePrefixes = materializeAtomicStatusPrefixes(
    designOracle.registries.atomicTwoStatusWirePrefixControls,
    emittedStatusByteGoldens,
  );
  const statusTuples = Object.freeze(
    emittedStatusByteGoldens.map(materializedStatusEntryTuple),
  );
  const atomicTuples = Object.freeze(
    atomicTwoStatusWirePrefixes.map(materializedAtomicEntryTuple),
  );
  const independent = independentlyReconstructMaterializedStatusTuples(
    requirements,
    STATUS_ORACLE_CONSTRUCTION_CONTEXT,
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
  const construction = recursivelyFreezeStatusOracleValue({
    fixtureDerivedStatusTopology: true,
    evaluatorOwnedConstructionContext: true,
    constructionBindingsRehashed: true,
    emittedStatusBytesMaterialized: true,
    atomicConcatenatedBytesMaterialized: true,
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
  const identityProjection = {
    schema: SOURCE_INDEPENDENT_MATERIALIZED_STATUS_ORACLE_SCHEMA,
    requirementsSha256: EXPECTED_REQUIREMENTS_SHA256,
    constructionContextSha256:
      STATUS_ORACLE_CONSTRUCTION_CONTEXT.identitySha256,
    statusFrameFields: EXPECTED_STATUS_FRAME_FIELDS,
    counts,
    inventorySha256,
    statusEntryDigests,
    atomicEntryDigests,
    reconstruction,
    construction,
  };
  const identitySha256 = digest(identityProjection);
  assert.equal(identitySha256, EXPECTED_MATERIALIZED_STATUS_ORACLE_SHA256);
  return recursivelyFreezeStatusOracleValue({
    ...identityProjection,
    constructionContext: STATUS_ORACLE_CONSTRUCTION_CONTEXT,
    emittedStatusByteGoldens,
    atomicTwoStatusWirePrefixes,
    identitySha256,
  });
}

function assertRecursivelyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    assertRecursivelyFrozen(value[key], seen);
  }
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

function maskCommentsAndStrings(source) {
  let output = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index + 2);
      const stop = end === -1 ? source.length : end;
      output += " ".repeat(stop - index);
      index = stop;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end === -1) throw new Error("static gate: comment");
      const stop = end + 2;
      output += source.slice(index, stop).replace(/[^\n]/gu, " ");
      index = stop;
      continue;
    }
    if (
      source[index] === '"' ||
      source[index] === "'" ||
      source[index] === "`"
    ) {
      const quote = source[index];
      let stop = index + 1;
      while (stop < source.length) {
        if (source[stop] === "\\") stop += 2;
        else if (source[stop] === quote) {
          stop += 1;
          break;
        } else stop += 1;
      }
      if (source[stop - 1] !== quote) throw new Error("static gate: string");
      output += source.slice(index, stop).replace(/[^\n]/gu, " ");
      index = stop;
      continue;
    }
    output += source[index];
    index += 1;
  }
  return output;
}

function independentStaticAudit(source) {
  const imports = [
    ...source.matchAll(
      /(^|\n)\s*import\s*\{([^}]*)\}\s*from\s*(["'])([^"']+)\3\s*;?/gu,
    ),
  ].map((match) => ({
    specifier: match[4],
    names: match[2]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  }));
  const masked = maskCommentsAndStrings(source);
  assert.equal(imports.length, masked.match(/\bimport\b/gu)?.length ?? 0);
  assert.equal(imports.length, 3);
  assert.equal(new Set(imports.map(({ specifier }) => specifier)).size, 3);
  for (const { specifier, names } of imports) {
    assert.deepEqual(names, ALLOWED_IMPORTS.get(specifier));
  }
  assert.equal(/\bexport\s+(?:\*|\{[^}]*\})\s+from\b/gu.test(masked), false);
  assert.equal(/\\u(?:\{|[0-9a-fA-F]{4})/gu.test(masked), false);
  for (const token of FORBIDDEN) {
    assert.equal(new RegExp(`\\b${token}\\b`, "u").test(masked), false, token);
  }
  const stores = [
    ...masked.matchAll(
      /\b(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*new\s+WeakMap\s*\(\s*\)/gu,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(stores, [
    "startupMetadata",
    "inputMetadata",
    "stateMetadata",
  ]);
  const exported = [
    ...masked.matchAll(
      /\bexport\s+(?:const|function)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(exported.sort(), [...EXPECTED_EXPORTS].sort());
  return Object.freeze({ imports: imports.length, stores: stores.length });
}

function validSkeleton(extra = "") {
  const imports = [...ALLOWED_IMPORTS]
    .map(
      ([specifier, names]) =>
        `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`,
    )
    .join("\n");
  const exports = EXPECTED_EXPORTS.map((name, index) =>
    index < 2
      ? `export const ${name} = ${index};`
      : `export function ${name}() { return null; }`,
  ).join("\n");
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
      independentStaticAudit(validSkeleton(value));
      evaluationAttempts += 1;
    });
  }
  assert.equal(evaluationAttempts, 0);
  assert.doesNotThrow(() => independentStaticAudit(validSkeleton()));
  return Object.freeze({ rejected: cases.length, evaluationAttempts });
}

function evaluateCandidateOnlyWhenSourceAbsent(source, evaluate) {
  if (source !== null) {
    throw new Error(
      "candidate evaluation disabled until exhaustive positive-allowlist parser closure is implemented",
    );
  }
  return evaluate();
}

const STATIC_CONTROLS = DIRECT_ENTRY ? sourceIndependentStaticControls() : null;
let candidateSourceGateError = null;
let source = null;
if (DIRECT_ENTRY) {
  try {
    source = readFileSync(SOURCE_PATH, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (source !== null) {
    try {
      evaluateCandidateOnlyWhenSourceAbsent(source, () => {
        throw new Error("candidate evaluation attempted");
      });
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
    primaryStatusEncoderConsumed: false,
    statusCount: 15,
    atomicCount: 4,
    statusInventorySha256:
      EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256.emittedStatusByteGoldens,
    atomicInventorySha256:
      EXPECTED_MATERIALIZED_STATUS_INVENTORY_SHA256.atomicTwoStatusWirePrefixes,
    independentlyReconstructedProjectionMatches: true,
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
  let sourcePresentEvaluationAttempts = 0;
  assert.throws(
    () =>
      evaluateCandidateOnlyWhenSourceAbsent(validSkeleton(), () => {
        sourcePresentEvaluationAttempts += 1;
      }),
    /evaluation disabled until exhaustive positive-allowlist parser closure/gu,
  );
  assert.equal(sourcePresentEvaluationAttempts, 0);
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
  assert.equal(source, null);
});

test(
  "replace the fail-closed source-presence stop with exhaustive positive-allowlist parser closure for free identifiers, imports, exports, encoded identifiers, computed access, ambient authority, and test-gaming paths",
  { todo: true },
  () => {},
);
