import {
  boundedInteger,
  canonicalJsonBytes,
  canonicalJsonLine,
  copyBoundedBufferByFailureCategory,
  decodeCanonicalBase64,
  decodeCanonicalJsonLine,
  deepFreeze,
  exactBoolean,
  exactDigest,
  exactRecord,
  frozenCopyOnReadBytes,
  nullRecord,
  sha256,
} from "./containment-exact-v2.mjs";
import {
  CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1,
  CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1,
  CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1,
  CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1,
  CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1,
  CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1,
  CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1,
} from "./containment-guardian-recovery-v1.mjs";
import {
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3,
  CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3,
  verifyCandidateContainmentLaunchCapsuleV3,
} from "./containment-launch-capsule-v3.mjs";

const startupMetadata = new WeakMap();
const inputMetadata = new WeakMap();
const stateMetadata = new WeakMap();

const guardianContract = deepFreeze(
  nullRecord([
    [
      "schema",
      "oxigraph.candidate-containment-guardian-control-requirements/v1",
    ],
    ["version", 1],
    [
      "predecessors",
      nullRecord([
        [
          "direct",
          [
            nullRecord([
              ["specifier", "./containment-exact-v2.mjs"],
              [
                "sha256",
                "194fb41e523b334206e91b2dfda8894f5e661a3d034b7330e3e6bd549e4c744e",
              ],
              ["requirementsSha256", null],
              [
                "imports",
                [
                  "boundedInteger",
                  "canonicalJsonBytes",
                  "canonicalJsonLine",
                  "copyBoundedBufferByFailureCategory",
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
            ]),
            nullRecord([
              ["specifier", "./containment-guardian-recovery-v1.mjs"],
              [
                "sha256",
                "e8873c848411bb719139962d1940f0bdb825e09e0df079345ae95cf01c598c1d",
              ],
              [
                "requirementsSha256",
                "278031a43b331036e6c849f796d480e7fe680219d07bdb5b30185668a9337c5a",
              ],
              [
                "imports",
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
            ]),
            nullRecord([
              ["specifier", "./containment-launch-capsule-v3.mjs"],
              [
                "sha256",
                "9579d8b66a81a09be1efc60e2f23e930070dda66175273548fcf1d3e9d23c41d",
              ],
              [
                "requirementsSha256",
                "4432b3334ff07b847f1ee8abe49c184df5c993545c21f405ccc1247ecb20604a",
              ],
              [
                "imports",
                [
                  "CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3",
                  "CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_V3",
                  "verifyCandidateContainmentLaunchCapsuleV3",
                ],
              ],
            ]),
          ],
        ],
        [
          "evidenceOnly",
          [
            nullRecord([
              ["specifier", "./containment-supervisor-control-v2.mjs"],
              [
                "sha256",
                "92cfae3b2e6b8e2ee196d7c5a21c760ae5d35d4f5335263a5ffc816fc2a80842",
              ],
            ]),
            nullRecord([
              ["specifier", "./containment-supervisor-preflight-v4.mjs"],
              [
                "sha256",
                "747c913e60768c53bdeeec923a6ff2f1319121d743bddd8e4db663c1a03d23ff",
              ],
            ]),
          ],
        ],
      ]),
    ],
    [
      "schemas",
      nullRecord([
        [
          "startupReport",
          "oxigraph.candidate-containment-guardian-startup-report/v1",
        ],
        [
          "openFileDescriptionScope",
          "oxigraph.candidate-containment-guardian-ofd-observation-scope/v1",
        ],
        [
          "openFileDescriptionObservation",
          "oxigraph.candidate-containment-guardian-ofd-observation/v1",
        ],
        [
          "admissionRecvmsgReport",
          "oxigraph.candidate-containment-guardian-admission-recvmsg-report/v1",
        ],
        [
          "wireFrame",
          "oxigraph.candidate-containment-guardian-control-frame/v1",
        ],
        [
          "recoverySelection",
          "oxigraph.candidate-containment-guardian-recovery-selection/v1",
        ],
        [
          "diagnosticSummary",
          "oxigraph.candidate-containment-guardian-diagnostic-summary/v1",
        ],
        [
          "startupProjection",
          "oxigraph.candidate-containment-guardian-startup/v1",
        ],
        [
          "inputProjection",
          "oxigraph.candidate-containment-guardian-control-input/v1",
        ],
        [
          "stateProjection",
          "oxigraph.candidate-containment-guardian-control-state/v1",
        ],
        [
          "transitionProjection",
          "oxigraph.candidate-containment-guardian-control-transition/v1",
        ],
        [
          "statusArtifact",
          "oxigraph.candidate-containment-guardian-status-artifact/v1",
        ],
      ]),
    ],
    [
      "limits",
      nullRecord([
        ["startupReportMaximumBytes", 8192],
        ["epochBytes", 32],
        ["admissionFrameMaximumBytes", 131072],
        ["admissionRecvmsgReportMaximumBytes", 16384],
        ["cancelFrameMaximumBytes", 4096],
        ["recoveryRequestMaximumBytes", 32768],
        ["statusFrameMaximumBytes", 8192],
        ["rawDiagnosticsMaximumBytes", 16384],
        ["diagnosticSummaryMaximumBytes", 1024],
        ["maximumTranscriptSymbols", 7],
        ["maximumAggregateWireBytes", 196608],
        ["admissionRightsCount", 14],
        ["admissionControlMessageCount", 1],
        ["recoveryStateMinimumCount", 1],
        ["recoveryStateSlots", 19],
        ["maximumStatusFramesPerTransition", 2],
        ["maximumAdmissionsPerTranscript", 1],
        ["concurrentAdmissionsPermitted", false],
        ["maximumAdmissionsPerGuardianLifetime", null],
      ]),
    ],
    ["modes", ["NORMAL", "RECOVERY_ONLY"]],
    [
      "startupMaps",
      nullRecord([
        ["normalDescriptorCount", 8],
        [
          "normalSha256",
          "1f2bcfca0089977fc1c5fdde2bfcfa6eed671e839a2daee87b5c19d3c2b4fffb",
        ],
        ["recoveryOnlyDescriptorCount", 7],
        [
          "recoveryOnlySha256",
          "620b125181725cff59b7d11d08f193250f9046d3aec4021016418d0ab42d4594",
        ],
      ]),
    ],
    [
      "admissionRights",
      nullRecord([
        ["count", 14],
        [
          "sha256",
          "082b09e65c5b58c92a909f27e3f9dd8b83e4833885e35846a31ace14c82744a2",
        ],
      ]),
    ],
    [
      "frameFields",
      nullRecord([
        [
          "startupReport",
          [
            "schema",
            "mode",
            "requirementsSha256",
            "expectedEpochSha256",
            "openFileDescriptionObservationScopeSha256",
            "descriptorCount",
            "fd0",
            "fd1",
            "fd2",
            "fd3",
            "fd4",
            "fd5",
            "fd6",
            "fd7",
          ],
        ],
        [
          "startupDescriptor",
          [
            "fd",
            "role",
            "kind",
            "accessMode",
            "closeOnExec",
            "direction",
            "statusFlags",
            "openFileDescriptionClass",
            "openFileDescriptionIdentitySha256",
            "byteLength",
            "contentSha256",
            "launchFileIdentitySha256",
            "currentOffset",
            "socketFamily",
            "socketType",
            "connected",
            "lockHeld",
          ],
        ],
        [
          "admissionRecvmsgReport",
          [
            "schema",
            "messageByteLength",
            "messageRawSha256",
            "messageTruncated",
            "controlTruncated",
            "controlMessageCount",
            "controlLevel",
            "controlType",
            "rightsCount",
            "right0",
            "right1",
            "right2",
            "right3",
            "right4",
            "right5",
            "right6",
            "right7",
            "right8",
            "right9",
            "right10",
            "right11",
            "right12",
            "right13",
          ],
        ],
        [
          "admissionRight",
          [
            "index",
            "role",
            "targetSupervisorFd",
            "kind",
            "accessMode",
            "closeOnExec",
            "statusFlags",
            "openFileDescriptionClass",
            "openFileDescriptionIdentitySha256",
            "byteLength",
            "contentSha256",
            "launchFileIdentitySha256",
            "currentOffset",
          ],
        ],
        [
          "ADMIT",
          [
            "schema",
            "action",
            "mode",
            "sequence",
            "previousFrameSha256",
            "requirementsSha256",
            "startupSha256",
            "epochSha256",
            "launchCapsuleV3Sha256",
            "launchCapsuleV3",
          ],
        ],
        [
          "CANCEL",
          [
            "schema",
            "action",
            "mode",
            "sequence",
            "previousFrameSha256",
            "requirementsSha256",
            "startupSha256",
            "epochSha256",
            "admissionFrameSha256",
          ],
        ],
        [
          "RECOVERY_REQUEST",
          [
            "schema",
            "action",
            "mode",
            "sequence",
            "previousFrameSha256",
            "requirementsSha256",
            "startupSha256",
            "epochSha256",
            "recoverySelectionSha256",
            "recoverySelection",
          ],
        ],
        [
          "recoverySelection",
          [
            "schema",
            "targetSha256",
            "recoveryRequirementsSha256",
            "recoveryPlanSha256",
            "recoveryReplaySha256",
            "lifecycleInventorySha256",
            "attemptSha256",
            "planStatus",
            "requiredActorKind",
            "actorKind",
            "recoveryActorEpochSha256",
            "attemptDirectoryName",
            "lifetimeAnchorProjectionSha256",
            "lifetimeAttemptAnchorRawSha256",
            "disposition",
            "quarantineReason",
            "sourceLocation",
            "decisionSourceLocation",
            "requiredDestinationLocation",
            "stateCount",
            "state0",
            "state1",
            "state2",
            "state3",
            "state4",
            "state5",
            "state6",
            "state7",
            "state8",
            "state9",
            "state10",
            "state11",
            "state12",
            "state13",
            "state14",
            "state15",
            "state16",
            "state17",
            "state18",
          ],
        ],
        [
          "STATUS",
          [
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
          ],
        ],
        [
          "diagnosticSummary",
          ["schema", "byteLength", "rawSha256", "eofObserved"],
        ],
        [
          "startupProjection",
          [
            "schema",
            "mode",
            "requirementsSha256",
            "startupReportByteLength",
            "startupReportSha256",
            "epochSha256",
            "descriptorCount",
            "authority",
            "physicalFacts",
          ],
        ],
        [
          "inputProjection",
          [
            "schema",
            "kind",
            "boundStateSha256",
            "frameByteLength",
            "frameSha256",
            "auxiliaryByteLength",
            "auxiliarySha256",
            "authority",
            "physicalFacts",
          ],
        ],
        [
          "stateProjection",
          [
            "schema",
            "mode",
            "phase",
            "requirementsSha256",
            "startupSha256",
            "epochSha256",
            "lastWireFrameSha256",
            "nextWireSequence",
            "aggregateWireBytes",
            "admissionFrameSha256",
            "recoveryRequestFrameSha256",
            "admissionCount",
            "cancelObserved",
            "controllerClosedObserved",
            "diagnosticFailureObserved",
            "recoveryControlHandoffObserved",
            "controlTerminalReason",
            "statusEofObserved",
            "transcriptTerminal",
            "eventCount",
            "authority",
            "physicalFacts",
            "stateSha256",
          ],
        ],
        [
          "transitionProjection",
          [
            "schema",
            "state",
            "statusFrameCount",
            "statusFrame0",
            "statusFrame1",
          ],
        ],
        [
          "statusArtifactOwnKeys",
          [
            "bytes",
            "schema",
            "mode",
            "sequence",
            "byteLength",
            "rawSha256",
            "state",
            "terminalReason",
            "authority",
            "physicalFacts",
          ],
        ],
      ]),
    ],
    [
      "vocabularies",
      nullRecord([
        [
          "inputKinds",
          [
            "ADMIT",
            "CANCEL",
            "RECOVERY_REQUEST",
            "CONTROLLER_CLOSED",
            "DIAGNOSTIC_FAILURE",
            "RECOVERY_CONTROL_HANDOFF",
            "STATUS_EOF",
          ],
        ],
        [
          "statusStates",
          [
            "NORMAL_READY",
            "ADMISSION_ACCEPTED",
            "CANCEL_REQUIRED",
            "RECOVERY_REQUIRED",
            "RECOVERY_REQUEST_ACCEPTED",
            "CONTROL_TERMINAL",
          ],
        ],
        [
          "terminalReasons",
          [
            "EXPLICIT_CANCEL",
            "CONTROLLER_CLOSED",
            "DIAGNOSTIC_FAILURE",
            "RECOVERY_CONTROL_HANDOFF",
          ],
        ],
        [
          "phases",
          [
            "WAITING_NORMAL_INPUT",
            "WAITING_RECOVERY_REQUEST",
            "WAITING_RECOVERY_HANDOFF",
            "CONTROL_TERMINAL_EMITTED",
            "TRANSCRIPT_TERMINAL",
          ],
        ],
        [
          "failureCodes",
          [
            "CONTROL_BOUNDS",
            "CONTROL_SHAPE",
            "CONTROL_STARTUP",
            "CONTROL_FRAME",
            "CONTROL_RIGHTS",
            "CONTROL_BINDING",
            "CONTROL_TRANSITION",
          ],
        ],
        [
          "failurePrecedence",
          [
            "CONTROL_BOUNDS",
            "CONTROL_SHAPE",
            "CONTROL_STARTUP",
            "CONTROL_FRAME",
            "CONTROL_RIGHTS",
            "CONTROL_BINDING",
            "CONTROL_TRANSITION",
          ],
        ],
        ["descriptorKinds", ["unix-seqpacket", "pipe", "directory", "regular"]],
        ["accessModes", ["O_RDONLY", "O_WRONLY", "O_RDWR"]],
        ["statusFlags", ["NONE", "O_LARGEFILE", "O_LARGEFILE|O_DIRECTORY"]],
        [
          "directions",
          [
            "BIDIRECTIONAL",
            "GUARDIAN_TO_MANAGER",
            "MANAGER_TO_GUARDIAN",
            "NONE",
          ],
        ],
        ["controlLevel", "SOL_SOCKET"],
        ["controlType", "SCM_RIGHTS"],
        ["receivedRightsCloseOnExec", true],
        [
          "openFileDescriptionNonAliasMethod",
          "startup-kcmp;admission-right-pairs-and-fd7-kcmp;cross-kind-exclusion-or-ADR0039-qualified-equivalent",
        ],
        ["planStatus", "RECOVERY_PLAN_READY"],
        ["recoveryActorKind", "RECOVERY_ONLY_GUARDIAN"],
        [
          "previousFrameGenesisSha256",
          "0000000000000000000000000000000000000000000000000000000000000000",
        ],
        [
          "byteCarrierAdditionalOwnPropertyPolicy",
          "additional-non-index-string-and-symbol-properties-ignored-without-enumeration-inspection-read-write-or-invocation;own-length-rejected;semantics-derived-only-from-immediate-intrinsic-copy-of-indexed-bytes/v1",
        ],
        [
          "ambientIntrinsics",
          [
            "Array",
            "Boolean",
            "Error",
            "Number",
            "Object",
            "Reflect",
            "Set",
            "String",
            "WeakMap",
          ],
        ],
      ]),
    ],
    [
      "legalSequences",
      nullRecord([
        [
          "N1",
          [
            "NORMAL_READY",
            "CANCEL",
            "CANCEL_REQUIRED",
            "CONTROL_TERMINAL(EXPLICIT_CANCEL)",
            "STATUS_EOF",
          ],
        ],
        [
          "N2",
          [
            "NORMAL_READY",
            "ADMIT",
            "ADMISSION_ACCEPTED",
            "CANCEL",
            "CANCEL_REQUIRED",
            "CONTROL_TERMINAL(EXPLICIT_CANCEL)",
            "STATUS_EOF",
          ],
        ],
        [
          "N3",
          [
            "NORMAL_READY",
            "CONTROLLER_CLOSED",
            "RECOVERY_REQUIRED",
            "CONTROL_TERMINAL(CONTROLLER_CLOSED)",
            "STATUS_EOF",
          ],
        ],
        [
          "N4",
          [
            "NORMAL_READY",
            "ADMIT",
            "ADMISSION_ACCEPTED",
            "CONTROLLER_CLOSED",
            "RECOVERY_REQUIRED",
            "CONTROL_TERMINAL(CONTROLLER_CLOSED)",
            "STATUS_EOF",
          ],
        ],
        [
          "N5a",
          [
            "NORMAL_READY",
            "DIAGNOSTIC_FAILURE",
            "CONTROL_TERMINAL(DIAGNOSTIC_FAILURE)",
            "STATUS_EOF",
          ],
        ],
        [
          "N5b",
          [
            "NORMAL_READY",
            "ADMIT",
            "ADMISSION_ACCEPTED",
            "DIAGNOSTIC_FAILURE",
            "CONTROL_TERMINAL(DIAGNOSTIC_FAILURE)",
            "STATUS_EOF",
          ],
        ],
        [
          "R1",
          [
            "RECOVERY_REQUEST",
            "RECOVERY_REQUEST_ACCEPTED",
            "RECOVERY_CONTROL_HANDOFF",
            "CONTROL_TERMINAL(RECOVERY_CONTROL_HANDOFF)",
            "STATUS_EOF",
          ],
        ],
        [
          "R2",
          [
            "RECOVERY_REQUEST",
            "RECOVERY_REQUEST_ACCEPTED",
            "DIAGNOSTIC_FAILURE",
            "CONTROL_TERMINAL(DIAGNOSTIC_FAILURE)",
            "STATUS_EOF",
          ],
        ],
      ]),
    ],
    [
      "privateStateStores",
      ["startupMetadata", "inputMetadata", "stateMetadata"],
    ],
    [
      "authority",
      nullRecord([
        ["transportAuthority", false],
        ["descriptorAuthority", false],
        ["filesystemAuthority", false],
        ["cgroupAuthority", false],
        ["processAuthority", false],
        ["recoveryAuthority", false],
        ["runtimeAuthority", false],
      ]),
    ],
    [
      "physicalFacts",
      nullRecord([
        ["socketTransfer", null],
        ["descriptorInventory", null],
        ["epochOrigin", null],
        ["guardianExecution", null],
        ["recoveryExecution", null],
        ["cleanup", null],
      ]),
    ],
    [
      "nonclaims",
      nullRecord([
        ["socketTransferProved", false],
        ["descriptorFactsProved", false],
        ["epochOriginProved", false],
        ["recoveryBrandProvenanceProved", false],
        ["runtimeSerializationProved", false],
        ["guardianExecutionProved", false],
        ["recoveryExecutionProved", false],
        ["cleanupProved", false],
        ["runtimeRegistrationProved", false],
        ["productionReadinessProved", false],
      ]),
    ],
  ]),
);

export const CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS =
  guardianContract;

export const CANDIDATE_CONTAINMENT_GUARDIAN_CONTROL_V1_REQUIREMENTS_SHA256 =
  "7348640cbf1128447cea9af280e4c5eec4fbcdb5405055fa883a0c81cb462fe8";

const normalStartupMap = deepFreeze([
  nullRecord([
    ["fd", 0],
    ["role", "controllerChannel"],
    ["kind", "unix-seqpacket"],
    ["accessMode", "O_RDWR"],
    ["direction", "BIDIRECTIONAL"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", "AF_UNIX"],
    ["socketType", "SOCK_SEQPACKET"],
    ["connected", true],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 1],
    ["role", "statusWrite"],
    ["kind", "pipe"],
    ["accessMode", "O_WRONLY"],
    ["direction", "GUARDIAN_TO_MANAGER"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 2],
    ["role", "diagnosticsWrite"],
    ["kind", "pipe"],
    ["accessMode", "O_WRONLY"],
    ["direction", "GUARDIAN_TO_MANAGER"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 3],
    ["role", "stateRoot"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", true],
  ]),
  nullRecord([
    ["fd", 4],
    ["role", "delegatedRoot"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 5],
    ["role", "guardianLifetimeCgroup"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 6],
    ["role", "epochRead"],
    ["kind", "pipe"],
    ["accessMode", "O_RDONLY"],
    ["direction", "MANAGER_TO_GUARDIAN"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 7],
    ["role", "supervisorExecutable"],
    ["kind", "regular"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE"],
    ["currentOffset", 0],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
]);

const recoveryStartupMap = deepFreeze([
  nullRecord([
    ["fd", 0],
    ["role", "recoveryRequestRead"],
    ["kind", "pipe"],
    ["accessMode", "O_RDONLY"],
    ["direction", "MANAGER_TO_GUARDIAN"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 1],
    ["role", "statusWrite"],
    ["kind", "pipe"],
    ["accessMode", "O_WRONLY"],
    ["direction", "GUARDIAN_TO_MANAGER"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 2],
    ["role", "diagnosticsWrite"],
    ["kind", "pipe"],
    ["accessMode", "O_WRONLY"],
    ["direction", "GUARDIAN_TO_MANAGER"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 3],
    ["role", "stateRoot"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", true],
  ]),
  nullRecord([
    ["fd", 4],
    ["role", "delegatedRoot"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 5],
    ["role", "recoveryActorLifetimeCgroup"],
    ["kind", "directory"],
    ["accessMode", "O_RDONLY"],
    ["direction", "NONE"],
    ["statusFlags", "O_LARGEFILE|O_DIRECTORY"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
  nullRecord([
    ["fd", 6],
    ["role", "epochRead"],
    ["kind", "pipe"],
    ["accessMode", "O_RDONLY"],
    ["direction", "MANAGER_TO_GUARDIAN"],
    ["statusFlags", "NONE"],
    ["currentOffset", null],
    ["socketFamily", null],
    ["socketType", null],
    ["connected", null],
    ["lockHeld", null],
  ]),
]);

const recoverySlotOrdinals = deepFreeze([
  [0],
  [1],
  [2],
  [3],
  [4],
  [5],
  [6],
  [7],
  [8],
  [9],
  [10],
  [11],
  [12],
  [13],
  [14],
  [15],
  [16],
  [17],
  [18],
]);

const admissionRightOrdinals = deepFreeze([
  [0],
  [1],
  [2],
  [3],
  [4],
  [5],
  [6],
  [7],
  [8],
  [9],
  [10],
  [11],
  [12],
  [13],
]);

const recoveryDigestOrdinals = deepFreeze([
  [0],
  [1],
  [2],
  [3],
  [4],
  [5],
  [6],
  [7],
  [8],
  [9],
  [10],
  [11],
  [12],
  [13],
  [14],
  [15],
  [16],
  [17],
  [18],
  [19],
  [20],
  [21],
  [22],
  [23],
  [24],
  [25],
  [26],
  [27],
]);

const guardianRequirementsSha256 =
  "7348640cbf1128447cea9af280e4c5eec4fbcdb5405055fa883a0c81cb462fe8";

export function createCandidateContainmentGuardianStartupV1(
  startupReportBytes,
  epochBytes,
  epochEofObserved,
) {
  const startupCarrier = copyBoundedBufferByFailureCategory(
    startupReportBytes,
    "startup report bytes",
    {
      minimumBytes: 0,
      maximumBytes: guardianContract.limits.startupReportMaximumBytes,
    },
    failBounds,
    failShape,
  );
  const epoch = copyBoundedBufferByFailureCategory(
    epochBytes,
    "epoch bytes",
    {
      minimumBytes: guardianContract.limits.epochBytes,
      maximumBytes: guardianContract.limits.epochBytes,
    },
    failBounds,
    failShape,
  );
  const decoded = decodeCanonicalJsonLine(
    startupCarrier,
    "startup report bytes",
    guardianContract.limits.startupReportMaximumBytes,
    failShape,
  );
  const report = exactRecord(
    decoded.value,
    guardianContract.frameFields.startupReport,
    "startup report",
    failShape,
  );
  exactBoolean(epochEofObserved, true, "epoch EOF observation", failStartup);
  validateStartupReport(report, epoch);
  const result = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.startupProjection],
      ["mode", report.mode],
      ["requirementsSha256", guardianRequirementsSha256],
      ["startupReportByteLength", decoded.bytes.length],
      ["startupReportSha256", sha256(decoded.bytes)],
      ["epochSha256", sha256(epoch)],
      ["descriptorCount", report.descriptorCount],
      ["authority", guardianContract.authority],
      ["physicalFacts", guardianContract.physicalFacts],
    ]),
  );
  const metadata = deepFreeze(
    nullRecord([
      ["mode", result.mode],
      ["startupSha256", result.startupReportSha256],
      ["epochSha256", result.epochSha256],
    ]),
  );
  startupMetadata.set(result, metadata);
  return result;
}

export function createCandidateContainmentGuardianAdmissionInputV1(
  currentState,
  admissionFrameBytes,
  recvmsgReportBytes,
) {
  const frameCarrier = copyBoundedBufferByFailureCategory(
    admissionFrameBytes,
    "admission frame bytes",
    {
      minimumBytes: 0,
      maximumBytes: guardianContract.limits.admissionFrameMaximumBytes,
    },
    failBounds,
    failShape,
  );
  const reportCarrier = copyBoundedBufferByFailureCategory(
    recvmsgReportBytes,
    "admission recvmsg report bytes",
    {
      minimumBytes: 0,
      maximumBytes: guardianContract.limits.admissionRecvmsgReportMaximumBytes,
    },
    failBounds,
    failShape,
  );
  const currentStateBrand = stateMetadata.has(currentState);
  exactBoolean(currentStateBrand, true, "current state brand", failBinding);
  const currentStatePrivateProjection = stateMetadata.get(currentState);
  const state = exactRecord(
    currentState,
    guardianContract.frameFields.stateProjection,
    "current state",
    failShape,
  );
  boundedInteger(
    state.aggregateWireBytes + frameCarrier.length,
    "aggregate wire bytes",
    0,
    guardianContract.limits.maximumAggregateWireBytes,
    failBounds,
  );
  const decodedFrame = decodeCanonicalJsonLine(
    frameCarrier,
    "admission frame bytes",
    guardianContract.limits.admissionFrameMaximumBytes,
    failShape,
  );
  const frame = exactRecord(
    decodedFrame.value,
    guardianContract.frameFields.ADMIT,
    "admission frame",
    failShape,
  );
  validateAdmissionFrameStructure(frame);
  const capsuleBytes = decodeCanonicalBase64(
    frame.launchCapsuleV3,
    "launch capsule v3",
    65536,
    failFrame,
  );
  const capsule = verifyAdmissionLaunchCapsuleV3(capsuleBytes);
  const decodedReport = decodeCanonicalJsonLine(
    reportCarrier,
    "admission recvmsg report bytes",
    guardianContract.limits.admissionRecvmsgReportMaximumBytes,
    failShape,
  );
  const report = exactRecord(
    decodedReport.value,
    guardianContract.frameFields.admissionRecvmsgReport,
    "admission recvmsg report",
    failShape,
  );
  validateAdmissionReportStructure(report);
  validateAdmissionRights(report, capsule, state);
  validateAdmissionBindings(frame, report, capsule, state, decodedFrame.bytes);
  const result = inputProjection(
    "ADMIT",
    state.stateSha256,
    decodedFrame.bytes.length,
    sha256(decodedFrame.bytes),
    decodedReport.bytes.length,
    sha256(decodedReport.bytes),
  );
  const metadata = inputProjectionMetadata(result);
  inputMetadata.set(result, metadata);
  return result;
}

export function createCandidateContainmentGuardianCancelInputV1(
  currentState,
  cancelFrameBytes,
  messageTruncated,
  controlTruncated,
  controlMessageCount,
) {
  const frameCarrier = copyBoundedBufferByFailureCategory(
    cancelFrameBytes,
    "cancel frame bytes",
    {
      minimumBytes: 0,
      maximumBytes: guardianContract.limits.cancelFrameMaximumBytes,
    },
    failBounds,
    failShape,
  );
  const currentStateBrand = stateMetadata.has(currentState);
  exactBoolean(currentStateBrand, true, "current state brand", failBinding);
  const currentStatePrivateProjection = stateMetadata.get(currentState);
  const state = exactRecord(
    currentState,
    guardianContract.frameFields.stateProjection,
    "current state",
    failShape,
  );
  boundedInteger(
    state.aggregateWireBytes + frameCarrier.length,
    "aggregate wire bytes",
    0,
    guardianContract.limits.maximumAggregateWireBytes,
    failBounds,
  );
  const decodedFrame = decodeCanonicalJsonLine(
    frameCarrier,
    "cancel frame bytes",
    guardianContract.limits.cancelFrameMaximumBytes,
    failShape,
  );
  const frame = exactRecord(
    decodedFrame.value,
    guardianContract.frameFields.CANCEL,
    "cancel frame",
    failShape,
  );
  validateCancelFrameStructure(frame);
  exactBoolean(messageTruncated, false, "cancel message truncation", failFrame);
  exactBoolean(controlTruncated, false, "cancel control truncation", failFrame);
  boundedInteger(
    controlMessageCount,
    "cancel control message count",
    0,
    0,
    failFrame,
  );
  validateCancelBindings(frame, state);
  const result = inputProjection(
    "CANCEL",
    state.stateSha256,
    decodedFrame.bytes.length,
    sha256(decodedFrame.bytes),
    null,
    null,
  );
  const metadata = inputProjectionMetadata(result);
  inputMetadata.set(result, metadata);
  return result;
}

export function createCandidateContainmentGuardianRecoveryRequestInputV1(
  currentState,
  recoveryRequestFrameBytes,
  requestEofObserved,
) {
  const frameCarrier = copyBoundedBufferByFailureCategory(
    recoveryRequestFrameBytes,
    "recovery request frame bytes",
    {
      minimumBytes: 0,
      maximumBytes: guardianContract.limits.recoveryRequestMaximumBytes,
    },
    failBounds,
    failShape,
  );
  const currentStateBrand = stateMetadata.has(currentState);
  exactBoolean(currentStateBrand, true, "current state brand", failBinding);
  const currentStatePrivateProjection = stateMetadata.get(currentState);
  const state = exactRecord(
    currentState,
    guardianContract.frameFields.stateProjection,
    "current state",
    failShape,
  );
  boundedInteger(
    state.aggregateWireBytes + frameCarrier.length,
    "aggregate wire bytes",
    0,
    guardianContract.limits.maximumAggregateWireBytes,
    failBounds,
  );
  const decodedFrame = decodeCanonicalJsonLine(
    frameCarrier,
    "recovery request frame bytes",
    guardianContract.limits.recoveryRequestMaximumBytes,
    failShape,
  );
  const frame = exactRecord(
    decodedFrame.value,
    guardianContract.frameFields.RECOVERY_REQUEST,
    "recovery request frame",
    failShape,
  );
  const selection = exactRecord(
    frame.recoverySelection,
    guardianContract.frameFields.recoverySelection,
    "recovery selection",
    failShape,
  );
  validateRecoveryRequestStructure(frame, selection);
  exactBoolean(
    requestEofObserved,
    true,
    "recovery request EOF observation",
    failFrame,
  );
  validateRecoverySelection(selection, state);
  validateRecoveryRequestBindings(frame, selection, state);
  const result = inputProjection(
    "RECOVERY_REQUEST",
    state.stateSha256,
    decodedFrame.bytes.length,
    sha256(decodedFrame.bytes),
    null,
    null,
  );
  const metadata = inputProjectionMetadata(result);
  inputMetadata.set(result, metadata);
  return result;
}

export function createCandidateContainmentGuardianControllerClosedInputV1(
  currentState,
) {
  const currentStateBrand = stateMetadata.has(currentState);
  exactBoolean(currentStateBrand, true, "current state brand", failBinding);
  const currentStatePrivateProjection = stateMetadata.get(currentState);
  const state = exactRecord(
    currentState,
    guardianContract.frameFields.stateProjection,
    "current state",
    failShape,
  );
  const result = inputProjection(
    "CONTROLLER_CLOSED",
    state.stateSha256,
    null,
    null,
    null,
    null,
  );
  const metadata = inputProjectionMetadata(result);
  inputMetadata.set(result, metadata);
  return result;
}

export function createCandidateContainmentGuardianDiagnosticFailureInputV1(
  currentState,
  diagnosticSummaryReportBytes,
  rawDiagnosticBytes,
) {
  const summaryCarrier = copyBoundedBufferByFailureCategory(
    diagnosticSummaryReportBytes,
    "diagnostic summary report bytes",
    {
      minimumBytes: 0,
      maximumBytes: guardianContract.limits.diagnosticSummaryMaximumBytes,
    },
    failBounds,
    failShape,
  );
  const raw = copyBoundedBufferByFailureCategory(
    rawDiagnosticBytes,
    "raw diagnostic bytes",
    {
      minimumBytes: 0,
      maximumBytes: guardianContract.limits.rawDiagnosticsMaximumBytes,
    },
    failBounds,
    failShape,
  );
  const currentStateBrand = stateMetadata.has(currentState);
  exactBoolean(currentStateBrand, true, "current state brand", failBinding);
  const currentStatePrivateProjection = stateMetadata.get(currentState);
  const state = exactRecord(
    currentState,
    guardianContract.frameFields.stateProjection,
    "current state",
    failShape,
  );
  const decodedSummary = decodeCanonicalJsonLine(
    summaryCarrier,
    "diagnostic summary report bytes",
    guardianContract.limits.diagnosticSummaryMaximumBytes,
    failShape,
  );
  const summary = exactRecord(
    decodedSummary.value,
    guardianContract.frameFields.diagnosticSummary,
    "diagnostic summary",
    failShape,
  );
  validateDiagnosticSummary(summary, raw);
  const result = inputProjection(
    "DIAGNOSTIC_FAILURE",
    state.stateSha256,
    decodedSummary.bytes.length,
    sha256(decodedSummary.bytes),
    raw.length,
    sha256(raw),
  );
  const metadata = inputProjectionMetadata(result);
  inputMetadata.set(result, metadata);
  return result;
}

export function createCandidateContainmentGuardianRecoveryControlHandoffInputV1(
  currentState,
) {
  const currentStateBrand = stateMetadata.has(currentState);
  exactBoolean(currentStateBrand, true, "current state brand", failBinding);
  const currentStatePrivateProjection = stateMetadata.get(currentState);
  const state = exactRecord(
    currentState,
    guardianContract.frameFields.stateProjection,
    "current state",
    failShape,
  );
  const result = inputProjection(
    "RECOVERY_CONTROL_HANDOFF",
    state.stateSha256,
    null,
    null,
    null,
    null,
  );
  const metadata = inputProjectionMetadata(result);
  inputMetadata.set(result, metadata);
  return result;
}

export function createCandidateContainmentGuardianStatusEofInputV1(
  currentState,
) {
  const currentStateBrand = stateMetadata.has(currentState);
  exactBoolean(currentStateBrand, true, "current state brand", failBinding);
  const currentStatePrivateProjection = stateMetadata.get(currentState);
  const state = exactRecord(
    currentState,
    guardianContract.frameFields.stateProjection,
    "current state",
    failShape,
  );
  const result = inputProjection(
    "STATUS_EOF",
    state.stateSha256,
    null,
    null,
    null,
    null,
  );
  const metadata = inputProjectionMetadata(result);
  inputMetadata.set(result, metadata);
  return result;
}

export function initializeCandidateContainmentGuardianControlV1(
  startupProjection,
) {
  const startupProjectionBrand = startupMetadata.has(startupProjection);
  exactBoolean(
    startupProjectionBrand,
    true,
    "startup projection brand",
    failBinding,
  );
  const startupPrivateProjection = startupMetadata.get(startupProjection);
  const startup = exactRecord(
    startupProjection,
    guardianContract.frameFields.startupProjection,
    "startup projection",
    failShape,
  );
  validateStartupProjection(startup);
  const initialFields = initialStateFields(startup);
  const firstStatus =
    startup.mode === "NORMAL"
      ? createStatusArtifact(initialFields, "NORMAL_READY", null)
      : null;
  const finalFields =
    firstStatus === null
      ? initialFields
      : appendStatusFields(initialFields, firstStatus);
  const result = stateProjection(finalFields);
  const transition = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.transitionProjection],
      ["state", result],
      ["statusFrameCount", firstStatus === null ? 0 : 1],
      ["statusFrame0", firstStatus === null ? null : firstStatus.artifact],
      ["statusFrame1", null],
    ]),
  );
  const metadata = stateProjectionMetadata(result);
  stateMetadata.set(result, metadata);
  return transition;
}

export function reduceCandidateContainmentGuardianControlV1(
  currentState,
  brandedInput,
) {
  const currentStateBrand = stateMetadata.has(currentState);
  exactBoolean(currentStateBrand, true, "current state brand", failBinding);
  const currentStatePrivateProjection = stateMetadata.get(currentState);
  const state = exactRecord(
    currentState,
    guardianContract.frameFields.stateProjection,
    "current state",
    failShape,
  );
  const brandedInputBrand = inputMetadata.has(brandedInput);
  exactBoolean(brandedInputBrand, true, "input brand", failBinding);
  const inputPrivateProjection = inputMetadata.get(brandedInput);
  const input = exactRecord(
    brandedInput,
    guardianContract.frameFields.inputProjection,
    "branded input",
    failShape,
  );
  if (input.boundStateSha256 !== state.stateSha256) failBinding();
  const plan = reductionPlan(state, input);
  const afterInput = applyInputFields(state, input, plan);
  const firstStatus =
    plan.statusFrameCount > 0
      ? createStatusArtifact(
          afterInput,
          plan.statusFrame0,
          plan.statusFrame0 === "CONTROL_TERMINAL" ? plan.terminalReason : null,
        )
      : null;
  const afterFirstStatus =
    firstStatus === null
      ? afterInput
      : appendStatusFields(afterInput, firstStatus);
  const secondStatus =
    plan.statusFrameCount > 1
      ? createStatusArtifact(
          afterFirstStatus,
          plan.statusFrame1,
          plan.terminalReason,
        )
      : null;
  const finalFields =
    secondStatus === null
      ? afterFirstStatus
      : appendStatusFields(afterFirstStatus, secondStatus);
  const result = stateProjection(finalFields);
  const transition = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.transitionProjection],
      ["state", result],
      ["statusFrameCount", plan.statusFrameCount],
      ["statusFrame0", firstStatus === null ? null : firstStatus.artifact],
      ["statusFrame1", secondStatus === null ? null : secondStatus.artifact],
    ]),
  );
  const metadata = stateProjectionMetadata(result);
  stateMetadata.set(result, metadata);
  return transition;
}

export function verifyCandidateContainmentGuardianStatusFrameV1(
  startupProjection,
  statusFrameBytes,
) {
  const frameCarrier = copyBoundedBufferByFailureCategory(
    statusFrameBytes,
    "status frame bytes",
    {
      minimumBytes: 0,
      maximumBytes: guardianContract.limits.statusFrameMaximumBytes,
    },
    failBounds,
    failShape,
  );
  const startupProjectionBrand = startupMetadata.has(startupProjection);
  exactBoolean(
    startupProjectionBrand,
    true,
    "startup projection brand",
    failBinding,
  );
  const startupPrivateProjection = startupMetadata.get(startupProjection);
  const startup = exactRecord(
    startupProjection,
    guardianContract.frameFields.startupProjection,
    "startup projection",
    failShape,
  );
  const decodedFrame = decodeCanonicalJsonLine(
    frameCarrier,
    "status frame bytes",
    guardianContract.limits.statusFrameMaximumBytes,
    failShape,
  );
  const frame = exactRecord(
    decodedFrame.value,
    guardianContract.frameFields.STATUS,
    "status frame",
    failShape,
  );
  validateStatusFrame(frame, startup);
  return statusArtifact(
    decodedFrame.bytes,
    frame.mode,
    frame.sequence,
    frame.state,
    frame.terminalReason,
  );
}

function failBounds() {
  throw new Error("CONTROL_BOUNDS");
}

function failShape() {
  throw new Error("CONTROL_SHAPE");
}

function failStartup() {
  throw new Error("CONTROL_STARTUP");
}

function failFrame() {
  throw new Error("CONTROL_FRAME");
}

function failRights() {
  throw new Error("CONTROL_RIGHTS");
}

function verifyAdmissionLaunchCapsuleV3(capsuleBytes) {
  try {
    return verifyCandidateContainmentLaunchCapsuleV3(capsuleBytes);
  } catch {
    failBinding();
  }
}

function failBinding() {
  throw new Error("CONTROL_BINDING");
}

function failTransition() {
  throw new Error("CONTROL_TRANSITION");
}

function validateStartupReport(report, epoch) {
  if (
    report.schema !== guardianContract.schemas.startupReport ||
    !guardianContract.modes.includes(report.mode)
  ) {
    failStartup();
  }
  const expectedDescriptorCount =
    report.mode === "NORMAL"
      ? guardianContract.startupMaps.normalDescriptorCount
      : guardianContract.startupMaps.recoveryOnlyDescriptorCount;
  boundedInteger(
    report.descriptorCount,
    "startup descriptor count",
    expectedDescriptorCount,
    expectedDescriptorCount,
    failStartup,
  );
  exactDigest(
    report.requirementsSha256,
    "startup contract digest",
    failStartup,
  );
  exactDigest(report.expectedEpochSha256, "startup epoch digest", failStartup);
  exactDigest(
    report.openFileDescriptionObservationScopeSha256,
    "startup observation scope digest",
    failStartup,
  );
  const descriptors = deepFreeze([
    report.fd0,
    report.fd1,
    report.fd2,
    report.fd3,
    report.fd4,
    report.fd5,
    report.fd6,
    report.fd7,
  ]);
  const expectedMap =
    report.mode === "NORMAL" ? normalStartupMap : recoveryStartupMap;
  for (const expected of expectedMap) {
    const descriptor = descriptors.at(expected.fd);
    validateStartupDescriptor(
      descriptor,
      expected,
      report.openFileDescriptionObservationScopeSha256,
    );
  }
  if (report.mode === "RECOVERY_ONLY" && report.fd7 !== null) {
    failStartup();
  }
  const epochSha256 = sha256(epoch);
  const scope = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.openFileDescriptionScope],
      ["requirementsSha256", guardianRequirementsSha256],
      ["mode", report.mode],
      ["epochSha256", epochSha256],
    ]),
  );
  if (
    report.requirementsSha256 !== guardianRequirementsSha256 ||
    report.expectedEpochSha256 !== epochSha256 ||
    report.openFileDescriptionObservationScopeSha256 !==
      sha256(canonicalJsonBytes(scope))
  ) {
    failBinding();
  }
  return null;
}

function validateStartupDescriptor(descriptorValue, expected, scopeSha256) {
  const descriptor = exactRecord(
    descriptorValue,
    guardianContract.frameFields.startupDescriptor,
    "startup descriptor",
    failShape,
  );
  boundedInteger(
    descriptor.fd,
    "startup descriptor fd",
    expected.fd,
    expected.fd,
    failStartup,
  );
  boundedInteger(
    descriptor.openFileDescriptionClass,
    "startup descriptor class",
    expected.fd,
    expected.fd,
    failStartup,
  );
  if (
    descriptor.role !== expected.role ||
    descriptor.kind !== expected.kind ||
    descriptor.accessMode !== expected.accessMode ||
    descriptor.closeOnExec !== false ||
    descriptor.direction !== expected.direction ||
    descriptor.statusFlags !== expected.statusFlags ||
    descriptor.byteLength !== null ||
    descriptor.contentSha256 !== null ||
    descriptor.launchFileIdentitySha256 !== null ||
    descriptor.currentOffset !== expected.currentOffset ||
    descriptor.socketFamily !== expected.socketFamily ||
    descriptor.socketType !== expected.socketType ||
    descriptor.connected !== expected.connected ||
    descriptor.lockHeld !== expected.lockHeld
  ) {
    failStartup();
  }
  exactDigest(
    descriptor.openFileDescriptionIdentitySha256,
    "startup descriptor identity",
    failStartup,
  );
  const observation = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.openFileDescriptionObservation],
      ["scopeSha256", scopeSha256],
      ["equivalenceClass", expected.fd],
    ]),
  );
  if (
    descriptor.openFileDescriptionIdentitySha256 !==
    sha256(canonicalJsonBytes(observation))
  ) {
    failBinding();
  }
  return null;
}

function validateAdmissionFrameStructure(frame) {
  if (
    frame.schema !== guardianContract.schemas.wireFrame ||
    frame.action !== "ADMIT" ||
    frame.mode !== "NORMAL"
  ) {
    failFrame();
  }
  boundedInteger(
    frame.sequence,
    "admission sequence",
    0,
    guardianContract.limits.maximumTranscriptSymbols,
    failFrame,
  );
  exactDigest(frame.previousFrameSha256, "admission predecessor", failFrame);
  exactDigest(frame.requirementsSha256, "admission contract digest", failFrame);
  exactDigest(frame.startupSha256, "admission startup", failFrame);
  exactDigest(frame.epochSha256, "admission epoch", failFrame);
  exactDigest(frame.launchCapsuleV3Sha256, "launch capsule digest", failFrame);
  if (typeof frame.launchCapsuleV3 !== "string") failFrame();
  return null;
}

function validateAdmissionReportStructure(report) {
  if (report.schema !== guardianContract.schemas.admissionRecvmsgReport) {
    failRights();
  }
  boundedInteger(
    report.messageByteLength,
    "admission message byte length",
    2,
    guardianContract.limits.admissionFrameMaximumBytes,
    failRights,
  );
  exactDigest(report.messageRawSha256, "admission message digest", failRights);
  exactBoolean(
    report.messageTruncated,
    false,
    "admission message truncation",
    failRights,
  );
  exactBoolean(
    report.controlTruncated,
    false,
    "admission control truncation",
    failRights,
  );
  boundedInteger(
    report.controlMessageCount,
    "admission control message count",
    guardianContract.limits.admissionControlMessageCount,
    guardianContract.limits.admissionControlMessageCount,
    failRights,
  );
  boundedInteger(
    report.rightsCount,
    "admission rights count",
    guardianContract.limits.admissionRightsCount,
    guardianContract.limits.admissionRightsCount,
    failRights,
  );
  if (
    report.controlLevel !== guardianContract.vocabularies.controlLevel ||
    report.controlType !== guardianContract.vocabularies.controlType
  ) {
    failRights();
  }
  return null;
}

function validateAdmissionRights(report, capsule, state) {
  const rights = deepFreeze([
    report.right0,
    report.right1,
    report.right2,
    report.right3,
    report.right4,
    report.right5,
    report.right6,
    report.right7,
    report.right8,
    report.right9,
    report.right10,
    report.right11,
    report.right12,
    report.right13,
  ]);
  const scope = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.openFileDescriptionScope],
      ["requirementsSha256", guardianRequirementsSha256],
      ["mode", state.mode],
      ["epochSha256", state.epochSha256],
    ]),
  );
  const scopeSha256 = sha256(canonicalJsonBytes(scope));
  for (const entry of admissionRightOrdinals) {
    const expectedIndex = entry.at(0);
    const rightValue = rights.at(expectedIndex);
    validateAdmissionRight(rightValue, capsule, scopeSha256, expectedIndex);
  }
  return null;
}

function validateAdmissionRight(
  rightValue,
  capsule,
  scopeSha256,
  expectedIndex,
) {
  const right = exactRecord(
    rightValue,
    guardianContract.frameFields.admissionRight,
    "admission right",
    failShape,
  );
  const index = boundedInteger(
    right.index,
    "admission right index",
    expectedIndex,
    expectedIndex,
    failRights,
  );
  const file = capsule.files.at(index);
  boundedInteger(
    right.targetSupervisorFd,
    "admission target fd",
    index + 4,
    index + 4,
    failRights,
  );
  boundedInteger(
    right.openFileDescriptionClass,
    "admission descriptor class",
    index + 8,
    index + 8,
    failRights,
  );
  boundedInteger(
    right.byteLength,
    "admission right byte length",
    0,
    67108864,
    failRights,
  );
  boundedInteger(
    right.currentOffset,
    "admission current offset",
    0,
    0,
    failRights,
  );
  exactDigest(
    right.openFileDescriptionIdentitySha256,
    "admission descriptor identity",
    failRights,
  );
  exactDigest(right.contentSha256, "admission content digest", failRights);
  exactDigest(
    right.launchFileIdentitySha256,
    "admission launch identity digest",
    failRights,
  );
  const observation = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.openFileDescriptionObservation],
      ["scopeSha256", scopeSha256],
      ["equivalenceClass", index + 8],
    ]),
  );
  if (
    right.role !== file.role ||
    right.kind !== "regular" ||
    right.accessMode !== (index === 13 ? "O_RDWR" : "O_RDONLY") ||
    right.closeOnExec !== true ||
    right.statusFlags !== "O_LARGEFILE" ||
    right.openFileDescriptionIdentitySha256 !==
      sha256(canonicalJsonBytes(observation)) ||
    right.byteLength !== file.byteLength ||
    right.contentSha256 !== file.sha256 ||
    right.launchFileIdentitySha256 !==
      sha256(canonicalJsonBytes(file.identity)) ||
    right.currentOffset !== file.initialOffset
  ) {
    failRights();
  }
  return null;
}

function validateAdmissionBindings(frame, report, capsule, state, frameBytes) {
  if (
    frame.previousFrameSha256 !== state.lastWireFrameSha256 ||
    frame.requirementsSha256 !== state.requirementsSha256 ||
    frame.startupSha256 !== state.startupSha256 ||
    frame.epochSha256 !== state.epochSha256 ||
    frame.launchCapsuleV3Sha256 !==
      sha256(
        decodeCanonicalBase64(
          frame.launchCapsuleV3,
          "launch capsule v3",
          65536,
          failFrame,
        ),
      ) ||
    frame.launchCapsuleV3Sha256 !== capsule.rawSha256 ||
    capsule.requirementsSha256 !==
      CANDIDATE_CONTAINMENT_LAUNCH_REQUIREMENTS_SHA256_V3 ||
    report.messageByteLength !== frameBytes.length ||
    report.messageRawSha256 !== sha256(frameBytes)
  ) {
    failBinding();
  }
  if (frame.sequence !== state.nextWireSequence) failTransition();
  return null;
}

function validateCancelFrameStructure(frame) {
  if (
    frame.schema !== guardianContract.schemas.wireFrame ||
    frame.action !== "CANCEL" ||
    frame.mode !== "NORMAL"
  ) {
    failFrame();
  }
  boundedInteger(
    frame.sequence,
    "cancel sequence",
    0,
    guardianContract.limits.maximumTranscriptSymbols,
    failFrame,
  );
  exactDigest(frame.previousFrameSha256, "cancel predecessor", failFrame);
  exactDigest(frame.requirementsSha256, "cancel contract digest", failFrame);
  exactDigest(frame.startupSha256, "cancel startup", failFrame);
  exactDigest(frame.epochSha256, "cancel epoch", failFrame);
  if (frame.admissionFrameSha256 !== null) {
    exactDigest(
      frame.admissionFrameSha256,
      "cancel admission digest",
      failFrame,
    );
  }
  return null;
}

function validateCancelBindings(frame, state) {
  if (
    frame.previousFrameSha256 !== state.lastWireFrameSha256 ||
    frame.requirementsSha256 !== state.requirementsSha256 ||
    frame.startupSha256 !== state.startupSha256 ||
    frame.epochSha256 !== state.epochSha256 ||
    frame.admissionFrameSha256 !== state.admissionFrameSha256
  ) {
    failBinding();
  }
  if (frame.sequence !== state.nextWireSequence) failTransition();
  return null;
}

function validateRecoveryRequestStructure(frame, selection) {
  if (
    frame.schema !== guardianContract.schemas.wireFrame ||
    frame.action !== "RECOVERY_REQUEST" ||
    frame.mode !== "RECOVERY_ONLY" ||
    selection.schema !== guardianContract.schemas.recoverySelection
  ) {
    failFrame();
  }
  boundedInteger(
    frame.sequence,
    "recovery request sequence",
    0,
    guardianContract.limits.maximumTranscriptSymbols,
    failFrame,
  );
  exactDigest(
    frame.previousFrameSha256,
    "recovery request predecessor",
    failFrame,
  );
  exactDigest(
    frame.requirementsSha256,
    "recovery request contract digest",
    failFrame,
  );
  exactDigest(frame.startupSha256, "recovery request startup", failFrame);
  exactDigest(frame.epochSha256, "recovery request epoch", failFrame);
  exactDigest(
    frame.recoverySelectionSha256,
    "recovery selection digest",
    failFrame,
  );
  return null;
}

function validateRecoverySelection(selection, state) {
  exactDigest(selection.targetSha256, "recovery target", failFrame);
  exactDigest(
    selection.recoveryRequirementsSha256,
    "recovery contract digest",
    failFrame,
  );
  exactDigest(selection.recoveryPlanSha256, "recovery plan", failFrame);
  exactDigest(selection.recoveryReplaySha256, "recovery replay", failFrame);
  exactDigest(
    selection.lifecycleInventorySha256,
    "recovery lifecycle inventory",
    failFrame,
  );
  exactDigest(selection.attemptSha256, "recovery attempt", failFrame);
  exactDigest(
    selection.recoveryActorEpochSha256,
    "recovery actor epoch",
    failFrame,
  );
  exactDigest(
    selection.attemptDirectoryName,
    "recovery attempt directory",
    failFrame,
  );
  exactDigest(
    selection.lifetimeAnchorProjectionSha256,
    "recovery lifetime anchor",
    failFrame,
  );
  exactDigest(
    selection.lifetimeAttemptAnchorRawSha256,
    "recovery lifetime attempt anchor",
    failFrame,
  );
  if (
    !CANDIDATE_CONTAINMENT_RECOVERY_PLAN_STATUSES_V1.includes(
      selection.planStatus,
    ) ||
    selection.planStatus !== guardianContract.vocabularies.planStatus ||
    !CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1.includes(
      selection.requiredActorKind,
    ) ||
    !CANDIDATE_CONTAINMENT_RECOVERY_ACTOR_KINDS_V1.includes(
      selection.actorKind,
    ) ||
    selection.requiredActorKind !==
      guardianContract.vocabularies.recoveryActorKind ||
    selection.actorKind !== selection.requiredActorKind ||
    !CANDIDATE_CONTAINMENT_RECOVERY_DISPOSITIONS_V1.includes(
      selection.disposition,
    ) ||
    !CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1.includes(
      selection.sourceLocation,
    ) ||
    !CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1.includes(
      selection.decisionSourceLocation,
    ) ||
    !CANDIDATE_CONTAINMENT_RECOVERY_SOURCE_LOCATIONS_V1.includes(
      selection.requiredDestinationLocation,
    )
  ) {
    failBinding();
  }
  if (selection.disposition === "QUARANTINE") {
    if (
      !CANDIDATE_CONTAINMENT_RECOVERY_QUARANTINE_REASONS_V1.includes(
        selection.quarantineReason,
      ) ||
      selection.requiredDestinationLocation !== "quarantined"
    ) {
      failBinding();
    }
  } else if (
    selection.quarantineReason !== null ||
    selection.requiredDestinationLocation !== "recovered"
  ) {
    failBinding();
  }
  boundedInteger(
    selection.stateCount,
    "recovery state count",
    guardianContract.limits.recoveryStateMinimumCount,
    guardianContract.limits.recoveryStateSlots,
    failFrame,
  );
  validateRecoveryStateSlots(selection);
  if (
    selection.recoveryRequirementsSha256 !==
      CANDIDATE_CONTAINMENT_RECOVERY_REQUIREMENTS_SHA256_V1 ||
    selection.recoveryActorEpochSha256 !== state.epochSha256 ||
    selection.attemptDirectoryName !== state.epochSha256
  ) {
    failBinding();
  }
  return null;
}

function validateRecoveryStateSlots(selection) {
  const values = deepFreeze([
    selection.state0,
    selection.state1,
    selection.state2,
    selection.state3,
    selection.state4,
    selection.state5,
    selection.state6,
    selection.state7,
    selection.state8,
    selection.state9,
    selection.state10,
    selection.state11,
    selection.state12,
    selection.state13,
    selection.state14,
    selection.state15,
    selection.state16,
    selection.state17,
    selection.state18,
  ]);
  const digests = recoveryStateDigests();
  for (const entry of recoverySlotOrdinals) {
    const slot = entry.at(0);
    const value = values.at(slot);
    if (slot < selection.stateCount) {
      exactDigest(value, "recovery state digest", failFrame);
      if (!digests.includes(value)) failBinding();
      if (slot > 0) {
        const previousValue = values.at(slot - 1);
        for (const previousEntry of recoveryDigestOrdinals) {
          const previousIndex = previousEntry.at(0);
          if (digests.at(previousIndex) === previousValue) {
            for (const currentEntry of recoveryDigestOrdinals) {
              const currentIndex = currentEntry.at(0);
              if (
                currentIndex <= previousIndex &&
                digests.at(currentIndex) === value
              ) {
                failBinding();
              }
            }
          }
        }
      }
    } else if (value !== null) {
      failBinding();
    }
  }
  return null;
}

function validateRecoveryRequestBindings(frame, selection, state) {
  if (
    frame.previousFrameSha256 !== state.lastWireFrameSha256 ||
    frame.requirementsSha256 !== state.requirementsSha256 ||
    frame.startupSha256 !== state.startupSha256 ||
    frame.epochSha256 !== state.epochSha256 ||
    frame.recoverySelectionSha256 !== sha256(canonicalJsonBytes(selection))
  ) {
    failBinding();
  }
  if (frame.sequence !== state.nextWireSequence) failTransition();
  return null;
}

function validateDiagnosticSummary(summary, raw) {
  if (summary.schema !== guardianContract.schemas.diagnosticSummary) {
    failFrame();
  }
  boundedInteger(
    summary.byteLength,
    "diagnostic byte length",
    0,
    guardianContract.limits.rawDiagnosticsMaximumBytes,
    failFrame,
  );
  exactDigest(summary.rawSha256, "diagnostic digest", failFrame);
  if (typeof summary.eofObserved !== "boolean") failFrame();
  if (summary.byteLength !== raw.length || summary.rawSha256 !== sha256(raw)) {
    failBinding();
  }
  return null;
}

function inputProjection(
  kind,
  boundStateSha256,
  frameByteLength,
  frameSha256,
  auxiliaryByteLength,
  auxiliarySha256,
) {
  return deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.inputProjection],
      ["kind", kind],
      ["boundStateSha256", boundStateSha256],
      ["frameByteLength", frameByteLength],
      ["frameSha256", frameSha256],
      ["auxiliaryByteLength", auxiliaryByteLength],
      ["auxiliarySha256", auxiliarySha256],
      ["authority", guardianContract.authority],
      ["physicalFacts", guardianContract.physicalFacts],
    ]),
  );
}

function inputProjectionMetadata(input) {
  return deepFreeze(
    nullRecord([
      ["kind", input.kind],
      ["boundStateSha256", input.boundStateSha256],
      ["frameSha256", input.frameSha256],
      ["auxiliarySha256", input.auxiliarySha256],
    ]),
  );
}

function validateStartupProjection(startup) {
  if (
    startup.schema !== guardianContract.schemas.startupProjection ||
    !guardianContract.modes.includes(startup.mode) ||
    startup.requirementsSha256 !== guardianRequirementsSha256
  ) {
    failBinding();
  }
  boundedInteger(
    startup.startupReportByteLength,
    "startup report byte length",
    2,
    guardianContract.limits.startupReportMaximumBytes,
    failBinding,
  );
  exactDigest(
    startup.startupReportSha256,
    "startup report digest",
    failBinding,
  );
  exactDigest(startup.epochSha256, "startup epoch digest", failBinding);
  const expectedCount =
    startup.mode === "NORMAL"
      ? guardianContract.startupMaps.normalDescriptorCount
      : guardianContract.startupMaps.recoveryOnlyDescriptorCount;
  boundedInteger(
    startup.descriptorCount,
    "startup descriptor count",
    expectedCount,
    expectedCount,
    failBinding,
  );
  return null;
}

function initialStateFields(startup) {
  return deepFreeze(
    nullRecord([
      ["mode", startup.mode],
      [
        "phase",
        startup.mode === "NORMAL"
          ? "WAITING_NORMAL_INPUT"
          : "WAITING_RECOVERY_REQUEST",
      ],
      ["requirementsSha256", guardianRequirementsSha256],
      ["startupSha256", startup.startupReportSha256],
      ["epochSha256", startup.epochSha256],
      [
        "lastWireFrameSha256",
        guardianContract.vocabularies.previousFrameGenesisSha256,
      ],
      ["nextWireSequence", 0],
      ["aggregateWireBytes", 0],
      ["admissionFrameSha256", null],
      ["recoveryRequestFrameSha256", null],
      ["admissionCount", 0],
      ["cancelObserved", false],
      ["controllerClosedObserved", false],
      ["diagnosticFailureObserved", false],
      ["recoveryControlHandoffObserved", false],
      ["controlTerminalReason", null],
      ["statusEofObserved", false],
      ["transcriptTerminal", false],
      ["eventCount", 0],
    ]),
  );
}

function createStatusArtifact(fields, state, terminalReason) {
  const frame = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.wireFrame],
      ["action", "STATUS"],
      ["mode", fields.mode],
      ["sequence", fields.nextWireSequence],
      ["previousFrameSha256", fields.lastWireFrameSha256],
      ["requirementsSha256", guardianRequirementsSha256],
      ["startupSha256", fields.startupSha256],
      ["epochSha256", fields.epochSha256],
      ["state", state],
      ["admissionFrameSha256", fields.admissionFrameSha256],
      ["recoveryRequestFrameSha256", fields.recoveryRequestFrameSha256],
      ["terminalReason", terminalReason],
    ]),
  );
  const bytes = canonicalJsonLine(frame);
  boundedInteger(
    bytes.length,
    "status frame byte length",
    2,
    guardianContract.limits.statusFrameMaximumBytes,
    failBounds,
  );
  const rawSha256 = sha256(bytes);
  const artifact = statusArtifact(
    bytes,
    fields.mode,
    fields.nextWireSequence,
    state,
    terminalReason,
  );
  return deepFreeze(
    nullRecord([
      ["artifact", artifact],
      ["byteLength", bytes.length],
      ["rawSha256", rawSha256],
    ]),
  );
}

function statusArtifact(bytes, mode, sequence, state, terminalReason) {
  return frozenCopyOnReadBytes(bytes, [
    ["schema", guardianContract.schemas.statusArtifact],
    ["mode", mode],
    ["sequence", sequence],
    ["byteLength", bytes.length],
    ["rawSha256", sha256(bytes)],
    ["state", state],
    ["terminalReason", terminalReason],
    ["authority", guardianContract.authority],
    ["physicalFacts", guardianContract.physicalFacts],
  ]);
}

function appendStatusFields(fields, status) {
  const aggregateWireBytes = boundedInteger(
    fields.aggregateWireBytes + status.byteLength,
    "aggregate wire bytes",
    0,
    guardianContract.limits.maximumAggregateWireBytes,
    failBounds,
  );
  return deepFreeze(
    nullRecord([
      ["mode", fields.mode],
      ["phase", fields.phase],
      ["requirementsSha256", fields.requirementsSha256],
      ["startupSha256", fields.startupSha256],
      ["epochSha256", fields.epochSha256],
      ["lastWireFrameSha256", status.rawSha256],
      ["nextWireSequence", fields.nextWireSequence + 1],
      ["aggregateWireBytes", aggregateWireBytes],
      ["admissionFrameSha256", fields.admissionFrameSha256],
      ["recoveryRequestFrameSha256", fields.recoveryRequestFrameSha256],
      ["admissionCount", fields.admissionCount],
      ["cancelObserved", fields.cancelObserved],
      ["controllerClosedObserved", fields.controllerClosedObserved],
      ["diagnosticFailureObserved", fields.diagnosticFailureObserved],
      ["recoveryControlHandoffObserved", fields.recoveryControlHandoffObserved],
      ["controlTerminalReason", fields.controlTerminalReason],
      ["statusEofObserved", fields.statusEofObserved],
      ["transcriptTerminal", fields.transcriptTerminal],
      ["eventCount", fields.eventCount + 1],
    ]),
  );
}

function stateProjection(fields) {
  const unsigned = deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.stateProjection],
      ["mode", fields.mode],
      ["phase", fields.phase],
      ["requirementsSha256", fields.requirementsSha256],
      ["startupSha256", fields.startupSha256],
      ["epochSha256", fields.epochSha256],
      ["lastWireFrameSha256", fields.lastWireFrameSha256],
      ["nextWireSequence", fields.nextWireSequence],
      ["aggregateWireBytes", fields.aggregateWireBytes],
      ["admissionFrameSha256", fields.admissionFrameSha256],
      ["recoveryRequestFrameSha256", fields.recoveryRequestFrameSha256],
      ["admissionCount", fields.admissionCount],
      ["cancelObserved", fields.cancelObserved],
      ["controllerClosedObserved", fields.controllerClosedObserved],
      ["diagnosticFailureObserved", fields.diagnosticFailureObserved],
      ["recoveryControlHandoffObserved", fields.recoveryControlHandoffObserved],
      ["controlTerminalReason", fields.controlTerminalReason],
      ["statusEofObserved", fields.statusEofObserved],
      ["transcriptTerminal", fields.transcriptTerminal],
      ["eventCount", fields.eventCount],
      ["authority", guardianContract.authority],
      ["physicalFacts", guardianContract.physicalFacts],
    ]),
  );
  const stateSha256 = sha256(canonicalJsonBytes(unsigned));
  return deepFreeze(
    nullRecord([
      ["schema", guardianContract.schemas.stateProjection],
      ["mode", fields.mode],
      ["phase", fields.phase],
      ["requirementsSha256", fields.requirementsSha256],
      ["startupSha256", fields.startupSha256],
      ["epochSha256", fields.epochSha256],
      ["lastWireFrameSha256", fields.lastWireFrameSha256],
      ["nextWireSequence", fields.nextWireSequence],
      ["aggregateWireBytes", fields.aggregateWireBytes],
      ["admissionFrameSha256", fields.admissionFrameSha256],
      ["recoveryRequestFrameSha256", fields.recoveryRequestFrameSha256],
      ["admissionCount", fields.admissionCount],
      ["cancelObserved", fields.cancelObserved],
      ["controllerClosedObserved", fields.controllerClosedObserved],
      ["diagnosticFailureObserved", fields.diagnosticFailureObserved],
      ["recoveryControlHandoffObserved", fields.recoveryControlHandoffObserved],
      ["controlTerminalReason", fields.controlTerminalReason],
      ["statusEofObserved", fields.statusEofObserved],
      ["transcriptTerminal", fields.transcriptTerminal],
      ["eventCount", fields.eventCount],
      ["authority", guardianContract.authority],
      ["physicalFacts", guardianContract.physicalFacts],
      ["stateSha256", stateSha256],
    ]),
  );
}

function stateProjectionMetadata(state) {
  return deepFreeze(
    nullRecord([
      ["mode", state.mode],
      ["phase", state.phase],
      ["stateSha256", state.stateSha256],
      ["eventCount", state.eventCount],
    ]),
  );
}

function reductionPlan(state, input) {
  if (state.transcriptTerminal || state.phase === "TRANSCRIPT_TERMINAL") {
    failTransition();
  }
  if (
    input.kind === "ADMIT" &&
    state.mode === "NORMAL" &&
    state.phase === "WAITING_NORMAL_INPUT" &&
    state.admissionCount === 0
  ) {
    return deepFreeze(
      nullRecord([
        ["phase", "WAITING_NORMAL_INPUT"],
        ["statusFrameCount", 1],
        ["statusFrame0", "ADMISSION_ACCEPTED"],
        ["statusFrame1", null],
        ["terminalReason", null],
      ]),
    );
  }
  if (
    input.kind === "CANCEL" &&
    state.mode === "NORMAL" &&
    state.phase === "WAITING_NORMAL_INPUT"
  ) {
    return deepFreeze(
      nullRecord([
        ["phase", "CONTROL_TERMINAL_EMITTED"],
        ["statusFrameCount", 2],
        ["statusFrame0", "CANCEL_REQUIRED"],
        ["statusFrame1", "CONTROL_TERMINAL"],
        ["terminalReason", "EXPLICIT_CANCEL"],
      ]),
    );
  }
  if (
    input.kind === "CONTROLLER_CLOSED" &&
    state.mode === "NORMAL" &&
    state.phase === "WAITING_NORMAL_INPUT"
  ) {
    return deepFreeze(
      nullRecord([
        ["phase", "CONTROL_TERMINAL_EMITTED"],
        ["statusFrameCount", 2],
        ["statusFrame0", "RECOVERY_REQUIRED"],
        ["statusFrame1", "CONTROL_TERMINAL"],
        ["terminalReason", "CONTROLLER_CLOSED"],
      ]),
    );
  }
  if (
    input.kind === "DIAGNOSTIC_FAILURE" &&
    (state.phase === "WAITING_NORMAL_INPUT" ||
      state.phase === "WAITING_RECOVERY_HANDOFF")
  ) {
    return deepFreeze(
      nullRecord([
        ["phase", "CONTROL_TERMINAL_EMITTED"],
        ["statusFrameCount", 1],
        ["statusFrame0", "CONTROL_TERMINAL"],
        ["statusFrame1", null],
        ["terminalReason", "DIAGNOSTIC_FAILURE"],
      ]),
    );
  }
  if (
    input.kind === "RECOVERY_REQUEST" &&
    state.mode === "RECOVERY_ONLY" &&
    state.phase === "WAITING_RECOVERY_REQUEST"
  ) {
    return deepFreeze(
      nullRecord([
        ["phase", "WAITING_RECOVERY_HANDOFF"],
        ["statusFrameCount", 1],
        ["statusFrame0", "RECOVERY_REQUEST_ACCEPTED"],
        ["statusFrame1", null],
        ["terminalReason", null],
      ]),
    );
  }
  if (
    input.kind === "RECOVERY_CONTROL_HANDOFF" &&
    state.mode === "RECOVERY_ONLY" &&
    state.phase === "WAITING_RECOVERY_HANDOFF"
  ) {
    return deepFreeze(
      nullRecord([
        ["phase", "CONTROL_TERMINAL_EMITTED"],
        ["statusFrameCount", 1],
        ["statusFrame0", "CONTROL_TERMINAL"],
        ["statusFrame1", null],
        ["terminalReason", "RECOVERY_CONTROL_HANDOFF"],
      ]),
    );
  }
  if (
    input.kind === "STATUS_EOF" &&
    state.phase === "CONTROL_TERMINAL_EMITTED"
  ) {
    return deepFreeze(
      nullRecord([
        ["phase", "TRANSCRIPT_TERMINAL"],
        ["statusFrameCount", 0],
        ["statusFrame0", null],
        ["statusFrame1", null],
        ["terminalReason", state.controlTerminalReason],
      ]),
    );
  }
  failTransition();
}

function applyInputFields(state, input, plan) {
  const wireInput =
    input.kind === "ADMIT" ||
    input.kind === "CANCEL" ||
    input.kind === "RECOVERY_REQUEST";
  const aggregateWireBytes = wireInput
    ? boundedInteger(
        state.aggregateWireBytes + input.frameByteLength,
        "aggregate wire bytes",
        0,
        guardianContract.limits.maximumAggregateWireBytes,
        failBounds,
      )
    : state.aggregateWireBytes;
  return deepFreeze(
    nullRecord([
      ["mode", state.mode],
      ["phase", plan.phase],
      ["requirementsSha256", state.requirementsSha256],
      ["startupSha256", state.startupSha256],
      ["epochSha256", state.epochSha256],
      [
        "lastWireFrameSha256",
        wireInput ? input.frameSha256 : state.lastWireFrameSha256,
      ],
      [
        "nextWireSequence",
        wireInput ? state.nextWireSequence + 1 : state.nextWireSequence,
      ],
      ["aggregateWireBytes", aggregateWireBytes],
      [
        "admissionFrameSha256",
        input.kind === "ADMIT" ? input.frameSha256 : state.admissionFrameSha256,
      ],
      [
        "recoveryRequestFrameSha256",
        input.kind === "RECOVERY_REQUEST"
          ? input.frameSha256
          : state.recoveryRequestFrameSha256,
      ],
      ["admissionCount", input.kind === "ADMIT" ? 1 : state.admissionCount],
      ["cancelObserved", input.kind === "CANCEL" ? true : state.cancelObserved],
      [
        "controllerClosedObserved",
        input.kind === "CONTROLLER_CLOSED"
          ? true
          : state.controllerClosedObserved,
      ],
      [
        "diagnosticFailureObserved",
        input.kind === "DIAGNOSTIC_FAILURE"
          ? true
          : state.diagnosticFailureObserved,
      ],
      [
        "recoveryControlHandoffObserved",
        input.kind === "RECOVERY_CONTROL_HANDOFF"
          ? true
          : state.recoveryControlHandoffObserved,
      ],
      [
        "controlTerminalReason",
        plan.terminalReason === null
          ? state.controlTerminalReason
          : plan.terminalReason,
      ],
      [
        "statusEofObserved",
        input.kind === "STATUS_EOF" ? true : state.statusEofObserved,
      ],
      [
        "transcriptTerminal",
        input.kind === "STATUS_EOF" ? true : state.transcriptTerminal,
      ],
      ["eventCount", state.eventCount + 1],
    ]),
  );
}

function validateStatusFrame(frame, startup) {
  if (
    frame.schema !== guardianContract.schemas.wireFrame ||
    frame.action !== "STATUS" ||
    !guardianContract.modes.includes(frame.mode) ||
    !guardianContract.vocabularies.statusStates.includes(frame.state)
  ) {
    failFrame();
  }
  boundedInteger(
    frame.sequence,
    "status sequence",
    0,
    guardianContract.limits.maximumTranscriptSymbols,
    failFrame,
  );
  exactDigest(frame.previousFrameSha256, "status predecessor", failFrame);
  exactDigest(frame.requirementsSha256, "status contract digest", failFrame);
  exactDigest(frame.startupSha256, "status startup", failFrame);
  exactDigest(frame.epochSha256, "status epoch", failFrame);
  if (frame.admissionFrameSha256 !== null) {
    exactDigest(
      frame.admissionFrameSha256,
      "status admission digest",
      failFrame,
    );
  }
  if (frame.recoveryRequestFrameSha256 !== null) {
    exactDigest(
      frame.recoveryRequestFrameSha256,
      "status recovery request digest",
      failFrame,
    );
  }
  if (frame.terminalReason !== null) {
    if (
      !guardianContract.vocabularies.terminalReasons.includes(
        frame.terminalReason,
      )
    ) {
      failFrame();
    }
  }
  if (
    (frame.state === "CONTROL_TERMINAL") !== (frame.terminalReason !== null) ||
    (frame.mode === "NORMAL" && frame.recoveryRequestFrameSha256 !== null) ||
    (frame.mode === "RECOVERY_ONLY" && frame.admissionFrameSha256 !== null) ||
    (frame.admissionFrameSha256 !== null &&
      frame.recoveryRequestFrameSha256 !== null) ||
    (frame.state === "NORMAL_READY" && frame.admissionFrameSha256 !== null) ||
    (frame.state === "ADMISSION_ACCEPTED" &&
      frame.admissionFrameSha256 === null) ||
    (frame.state === "RECOVERY_REQUEST_ACCEPTED" &&
      frame.recoveryRequestFrameSha256 === null) ||
    (frame.mode === "RECOVERY_ONLY" &&
      frame.state === "CONTROL_TERMINAL" &&
      frame.recoveryRequestFrameSha256 === null)
  ) {
    failFrame();
  }
  if (
    frame.mode !== startup.mode ||
    frame.requirementsSha256 !== startup.requirementsSha256 ||
    frame.startupSha256 !== startup.startupReportSha256 ||
    frame.epochSha256 !== startup.epochSha256
  ) {
    failBinding();
  }
  if (
    (frame.mode === "NORMAL" && frame.state === "RECOVERY_REQUEST_ACCEPTED") ||
    (frame.mode === "RECOVERY_ONLY" &&
      (frame.state === "NORMAL_READY" ||
        frame.state === "ADMISSION_ACCEPTED" ||
        frame.state === "CANCEL_REQUIRED" ||
        frame.state === "RECOVERY_REQUIRED")) ||
    (frame.terminalReason === "RECOVERY_CONTROL_HANDOFF" &&
      frame.mode !== "RECOVERY_ONLY") ||
    (frame.terminalReason !== null &&
      frame.terminalReason !== "RECOVERY_CONTROL_HANDOFF" &&
      frame.mode !== "NORMAL" &&
      frame.terminalReason !== "DIAGNOSTIC_FAILURE")
  ) {
    failBinding();
  }
  return null;
}

function recoveryStateDigests() {
  return deepFreeze([
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(0)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(1)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(2)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(3)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(4)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(5)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(6)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(7)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(8)),
    ),
    sha256(
      canonicalJsonBytes(CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(9)),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(10),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(11),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(12),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(13),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(14),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(15),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(16),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(17),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(18),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(19),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(20),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(21),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(22),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(23),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(24),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(25),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(26),
      ),
    ),
    sha256(
      canonicalJsonBytes(
        CANDIDATE_CONTAINMENT_RECOVERY_RECORD_STATES_V1.at(27),
      ),
    ),
  ]);
}
