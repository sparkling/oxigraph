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
  const oracleSha256BeforeFixtureMutation = digest(oracle);
  fixture.legalSequences.N1[0] = "MUTATED_AFTER_ORACLE_CONSTRUCTION";
  fixture.admissionRights.count = 0;
  fixture.startupMaps.normalDescriptorCount = 0;
  assert.equal(digest(oracle), oracleSha256BeforeFixtureMutation);
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
