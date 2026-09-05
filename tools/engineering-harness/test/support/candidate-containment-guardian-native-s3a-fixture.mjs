import assert from "node:assert/strict";

import { canonicalSha256 } from "../../src/routing/features.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS,
  CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256,
  assertCandidateContainmentGuardianManagerProtocolTransitionV1,
  createCandidateContainmentGuardianManagerActorEpochV1,
  createCandidateContainmentGuardianManagerProtocolInputV1,
  initializeCandidateContainmentGuardianManagerProtocolV1,
  reduceCandidateContainmentGuardianManagerProtocolV1,
} from "../../src/candidate/containment-guardian-manager-protocol-v1.mjs";
import {
  CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS,
  CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256,
  assertCandidateContainmentGuardianStatefsRequestV1,
  planCandidateContainmentGuardianStatefsOperationV1,
} from "../../src/candidate/containment-guardian-statefs-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1 } from "../../src/candidate/containment-guardian-native-adapter-v1.mjs";
import { CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1 } from "../../src/candidate/containment-guardian-recovery-executor-v1.mjs";

export const CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_MODULE_V1 =
  "../../src/candidate/containment-guardian-manager-transition-consumer-v1.mjs";
export const CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_ENTRYPOINT_V1 =
  "consumeCandidateContainmentGuardianManagerProtocolTransitionV1";

function nullRecord(entries) {
  const value = Object.create(null);
  for (const [key, child] of entries) value[key] = child;
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function claims(authority, physicalFacts, nonclaims) {
  return [
    ["authority", authority],
    ["physicalFacts", physicalFacts],
    ["nonclaims", nonclaims],
  ];
}

const AUTHORITY = deepFreeze(
  nullRecord([
    ["filesystemExecution", false],
    ["processExecution", false],
    ["cgroupMutation", false],
    ["descriptorMutation", false],
    ["runtimeRegistration", false],
    ["g17Execution", false],
    ["g22Execution", false],
    ["qualification", false],
    ["readiness", false],
    ["promotion", false],
    ["publication", false],
    ["deployment", false],
    ["productionContainment", false],
  ]),
);

const PHYSICAL_FACTS = deepFreeze(
  nullRecord([
    ["managerTransitionConsumed", null],
    ["statefsRequestDispatched", null],
    ["statefsEffect", null],
    ["descriptorValidated", null],
    ["descriptorMutation", null],
    ["filesystemDurability", null],
  ]),
);

const NONCLAIMS = deepFreeze([
  "manager-process-identity",
  "statefs-c-execution",
  "descriptor-validity",
  "filesystem-effect",
  "filesystem-durability",
  "runtime-registration",
  "G1.7",
  "G2.2",
  "qualification",
  "production-readiness",
  "promotion",
  "publication",
  "deployment",
]);

export const CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS =
  deepFreeze(
    nullRecord([
      [
        "schema",
        "oxigraph.candidate-containment-guardian-manager-transition-consumer-requirements/v1",
      ],
      ["version", 1],
      [
        "predecessors",
        deepFreeze(
          nullRecord([
            [
              "managerProtocolRequirementsSha256",
              CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS_SHA256,
            ],
            [
              "statefsRequirementsSha256",
              CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS_SHA256,
            ],
            [
              "nativeAdapterRequirementsSha256",
              CANDIDATE_CONTAINMENT_GUARDIAN_NATIVE_REQUIREMENTS_SHA256_V1,
            ],
            [
              "recoveryExecutorRequirementsSha256",
              CANDIDATE_CONTAINMENT_GUARDIAN_RECOVERY_EXECUTOR_REQUIREMENTS_SHA256_V1,
            ],
          ]),
        ),
      ],
      [
        "entrypoint",
        CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_ENTRYPOINT_V1,
      ],
      ["entrypointArity", 2],
      [
        "ordering",
        deepFreeze([
          "manager-transition-assertion-before-transition-property-access",
          "exact-transition-statefs-request-identity",
          "adapter-validation-before-statefs-request-assertion",
          "statefs-request-assertion-exactly-once",
          "immediate-evaluator-bound-statefs-dispatch",
          "exact-executor-result-verification",
          "exact-branded-statefs-receipt-return",
          "manager-receipt-input-and-reduction-ownership",
          "post-consumption-failure-is-terminal",
        ]),
      ],
      ["evaluatorBoundary", "exact-adr0037-lock-executor-result/v1"],
      ["errors", deepFreeze(["S3A_BOUNDARY"])],
      ["binding", null],
      [
        "readiness",
        deepFreeze(
          nullRecord([
            ["status", "unavailable"],
            ["reason", "native-adapter-unavailable"],
          ]),
        ),
      ],
      ...claims(AUTHORITY, PHYSICAL_FACTS, NONCLAIMS),
    ]),
  );

export const CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256 =
  canonicalSha256(
    CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS,
  );

function exactRecord(fields, values) {
  return nullRecord(fields.map((field) => [field, values[field]]));
}

function epochBytes(label) {
  const bytes = Buffer.alloc(32);
  const seed = Buffer.from(label, "utf8");
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (seed[index % seed.length] + index + 1) & 0xff;
  }
  return bytes;
}

function heldStateRootObservation() {
  const prefix = nullRecord([
    [
      "schema",
      "oxigraph.candidate-containment-guardian-statefs-held-directory-observation/v1",
    ],
    ["role", "STATE_ROOT"],
    ["accessMode", "O_RDONLY"],
    ["closeOnExec", false],
    ["fileType", "DIRECTORY"],
    ["ownerUid", 1000],
    ["ownerGid", 1000],
    ["mode", "0700"],
    ["linkCount", "2"],
    ["deviceMajor", "8"],
    ["deviceMinor", "1"],
    ["inode", "100"],
    ["mountId", "42"],
    ["filesystemMagic", "61267"],
  ]);
  return deepFreeze(
    nullRecord([
      ...Object.entries(prefix),
      ["identitySha256", canonicalSha256(prefix)],
      ["authority", CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS.authority],
      [
        "physicalFacts",
        CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS.physicalFacts,
      ],
      ["nonclaims", CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS.nonclaims],
    ]),
  );
}

function statefsPlannerInput(managerActorEpochSha256, requestSequence) {
  const values = {
    kind: "LOCK_EX_NB",
    managerActorEpochSha256,
    requestSequence,
    inventorySetSha256: null,
    stateRootObservation: heldStateRootObservation(),
    currentInventorySet: null,
    unresolvedReceipt: null,
    generationManifest: null,
    normalJournalBundles: null,
    lifetimeReplayArguments: null,
    recoveryTarget: null,
    recoveryInventory: null,
    recoveryReplay: null,
    recoveryPlan: null,
    recoveryAttempt: null,
    recoveryRecord: null,
    artifactBytes: null,
    inventoryDirectoryRole: null,
    directoryRoleA: null,
    directoryRoleB: null,
    nameA: null,
    nameB: null,
    expectedOutcome: "LOCK_HELD",
  };
  return exactRecord(
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS.plannerInputFields,
    values,
  );
}

function managerPlanInput(state, plan) {
  const values = {
    kind: "STATEFS_PLAN",
    statefsPlan: plan,
    statefsReceipt: null,
    guardianStartupProjection: null,
    guardianControlState: null,
    guardianRecoveryRequestFrameBytes: null,
    guardianRequestEofObserved: null,
    guardianStatusFrameBytes: null,
  };
  return createCandidateContainmentGuardianManagerProtocolInputV1(
    state,
    exactRecord(
      CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS
        .inputArgumentFields,
      values,
    ),
  );
}

function managerReceiptInput(state, receipt) {
  const values = {
    kind: "STATEFS_RECEIPT",
    statefsPlan: null,
    statefsReceipt: receipt,
    guardianStartupProjection: null,
    guardianControlState: null,
    guardianRecoveryRequestFrameBytes: null,
    guardianRequestEofObserved: null,
    guardianStatusFrameBytes: null,
  };
  return createCandidateContainmentGuardianManagerProtocolInputV1(
    state,
    exactRecord(
      CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_PROTOCOL_V1_REQUIREMENTS
        .inputArgumentFields,
      values,
    ),
  );
}

function localStatefsNativeObservationV1() {
  const values = {
    kind: "DIRECTORY",
    role: "STATE_ROOT",
    name: null,
    deviceMajor: "8",
    deviceMinor: "1",
    inode: "100",
    mountId: "42",
    byteLength: "4096",
    linkCount: "2",
    mode: 0o40_700,
    ownerUid: 1000,
    ownerGid: 1000,
    statxMask: 0x17ff,
    filesystemMagic: "61267",
    contentOffset: 0,
    contentLength: 0,
  };
  return exactRecord(
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS
      .nativeObservationFields,
    values,
  );
}

export function exactLocalStatefsLockExecutorResultV1(request) {
  const values = {
    schema:
      "oxigraph.candidate-containment-guardian-statefs-executor-result/v1",
    abiVersion: 1,
    requestSha256: request.requestSha256,
    operation: request.operation,
    status: "COMPLETE",
    effectClass: "COMPLETE",
    lastCompletedStep: "LOCK_ACQUIRED",
    failedStep: "NONE",
    errno: 0,
    completedStepCount: 3,
    bytesConsumed: 0,
    observations: [localStatefsNativeObservationV1()],
    outputBytes: null,
    returnedDirectoryFd: -1,
  };
  return exactRecord(
    CANDIDATE_CONTAINMENT_GUARDIAN_STATEFS_V1_REQUIREMENTS
      .executorResultFields,
    values,
  );
}

export function createFreshStatefsManagerTransitionV1(label) {
  const epoch = createCandidateContainmentGuardianManagerActorEpochV1(
    epochBytes(label),
  );
  const initial = initializeCandidateContainmentGuardianManagerProtocolV1(epoch);
  assert.equal(
    assertCandidateContainmentGuardianManagerProtocolTransitionV1(initial),
    true,
  );
  const plan = planCandidateContainmentGuardianStatefsOperationV1(
    statefsPlannerInput(
      initial.state.managerActorEpochSha256,
      initial.state.nextStatefsRequestSequence,
    ),
  );
  const input = managerPlanInput(initial.state, plan);
  const transition = reduceCandidateContainmentGuardianManagerProtocolV1(
    initial.state,
    input,
  );
  assert.equal(transition.statefsRequest, plan.request);
  return { transition, request: plan.request };
}

export async function loadCandidateManagerTransitionConsumerV1() {
  try {
    return await import(
      new URL(
        CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_MODULE_V1,
        import.meta.url,
      )
    );
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "ADR38_S3A_MISSING_ONE_USE_MANAGER_PROTOCOL_STATEFS_BRIDGE",
      );
    }
    throw error;
  }
}

function expectCode(action, code) {
  assert.throws(action, (error) => error?.message === code);
}

export function assertCandidateManagerTransitionConsumerContractV1(candidate) {
  assert.deepEqual(
    Object.keys(candidate).sort(),
    [
      "CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS",
      "CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256",
      CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_ENTRYPOINT_V1,
    ].sort(),
  );
  assert.deepEqual(
    candidate.CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS,
    CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS,
  );
  assert.equal(
    candidate.CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256,
    CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_V1_REQUIREMENTS_SHA256,
  );
  const consume =
    candidate[
      CANDIDATE_CONTAINMENT_GUARDIAN_MANAGER_TRANSITION_CONSUMER_ENTRYPOINT_V1
    ];
  assert.equal(typeof consume, "function");
  assert.equal(consume.length, 2);

  const foreign = createFreshStatefsManagerTransitionV1("s3a-foreign");
  let transitionReads = 0;
  let dispatches = 0;
  const foreignProxy = new Proxy(foreign.transition, {
    get() {
      transitionReads += 1;
      throw new Error("S3A_TRANSITION_GET");
    },
    ownKeys() {
      transitionReads += 1;
      throw new Error("S3A_TRANSITION_KEYS");
    },
    getOwnPropertyDescriptor() {
      transitionReads += 1;
      throw new Error("S3A_TRANSITION_DESCRIPTOR");
    },
  });
  expectCode(
    () =>
      consume(foreignProxy, () => {
        dispatches += 1;
      }),
    "MANAGER_BINDING",
  );
  assert.equal(transitionReads, 0);
  assert.equal(dispatches, 0);

  const receipt = consume(foreign.transition, (request) => {
    dispatches += 1;
    assert.equal(request, foreign.request);
    expectCode(
      () => assertCandidateContainmentGuardianStatefsRequestV1(request),
      "STATEFS_BINDING",
    );
    return exactLocalStatefsLockExecutorResultV1(request);
  });
  assert.equal(receipt.request, foreign.request);
  assert.equal(receipt.requestSha256, foreign.request.requestSha256);
  assert.equal(receipt.operation, "LOCK_EX_NB");
  assert.equal(receipt.outcome, "LOCK_HELD");
  assert.equal(receipt.retryDisposition, "NO_RETRY");
  assert.equal(dispatches, 1);
  expectCode(
    () =>
      consume(foreign.transition, () => {
        dispatches += 1;
      }),
    "MANAGER_BINDING",
  );
  assert.equal(dispatches, 1);

  expectCode(
    () => managerReceiptInput(foreign.transition.state, null),
    "MANAGER_SHAPE",
  );
  expectCode(
    () => managerReceiptInput(foreign.transition.state, { ...receipt }),
    "MANAGER_PREDECESSOR",
  );
  const retainedReceiptInput = managerReceiptInput(
    foreign.transition.state,
    receipt,
  );
  const receiptTransition = reduceCandidateContainmentGuardianManagerProtocolV1(
    foreign.transition.state,
    retainedReceiptInput,
  );
  assert.equal(receiptTransition.state.status, "INVENTORY_REQUIRED");
  assert.equal(
    receiptTransition.state.inventorySetSha256,
    receipt.inventorySetSha256,
  );
  assert.equal(receiptTransition.statefsRequest, null);
  assert.equal(
    assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      receiptTransition,
    ),
    true,
  );
  expectCode(
    () => managerReceiptInput(foreign.transition.state, receipt),
    "MANAGER_BINDING",
  );

  const copied = createFreshStatefsManagerTransitionV1("s3a-copy");
  const transitionCopy = { ...copied.transition };
  expectCode(
    () =>
      consume(transitionCopy, () => {
        dispatches += 1;
      }),
    "MANAGER_BINDING",
  );
  assert.equal(dispatches, 1);
  assert.equal(
    assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      copied.transition,
    ),
    true,
  );

  const bare = createFreshStatefsManagerTransitionV1("s3a-bare-request");
  let requestReads = 0;
  const requestProxy = new Proxy(bare.request, {
    get() {
      requestReads += 1;
      throw new Error("S3A_REQUEST_GET");
    },
    ownKeys() {
      requestReads += 1;
      throw new Error("S3A_REQUEST_KEYS");
    },
    getOwnPropertyDescriptor() {
      requestReads += 1;
      throw new Error("S3A_REQUEST_DESCRIPTOR");
    },
  });
  expectCode(
    () =>
      consume(requestProxy, () => {
        dispatches += 1;
      }),
    "MANAGER_BINDING",
  );
  assert.equal(requestReads, 0);
  assert.equal(dispatches, 1);
  assert.equal(
    assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      bare.transition,
    ),
    true,
  );

  const invalidBoundary = createFreshStatefsManagerTransitionV1(
    "s3a-invalid-boundary",
  );
  expectCode(
    () => consume(invalidBoundary.transition, null),
    "S3A_BOUNDARY",
  );
  expectCode(
    () =>
      consume(invalidBoundary.transition, () => {
        dispatches += 1;
      }),
    "MANAGER_BINDING",
  );
  assert.equal(dispatches, 1);
  assert.equal(
    assertCandidateContainmentGuardianStatefsRequestV1(
      invalidBoundary.request,
    ),
    true,
  );

  const omittedResult = createFreshStatefsManagerTransitionV1(
    "s3a-omitted-result",
  );
  let omittedDispatches = 0;
  expectCode(
    () =>
      consume(omittedResult.transition, (request) => {
        omittedDispatches += 1;
        assert.equal(request, omittedResult.request);
        return undefined;
      }),
    "STATEFS_RESULT",
  );
  assert.equal(omittedDispatches, 1);
  expectCode(
    () => consume(omittedResult.transition, () => null),
    "MANAGER_BINDING",
  );
  expectCode(
    () =>
      assertCandidateContainmentGuardianStatefsRequestV1(
        omittedResult.request,
      ),
    "STATEFS_BINDING",
  );

  const substitutedResult = createFreshStatefsManagerTransitionV1(
    "s3a-substituted-result",
  );
  const resultSource = createFreshStatefsManagerTransitionV1(
    "s3a-result-source",
  );
  const unrelatedResult = exactLocalStatefsLockExecutorResultV1(
    resultSource.request,
  );
  expectCode(
    () => consume(substitutedResult.transition, () => unrelatedResult),
    "STATEFS_RESULT",
  );
  expectCode(
    () => consume(substitutedResult.transition, () => unrelatedResult),
    "MANAGER_BINDING",
  );
  expectCode(
    () =>
      assertCandidateContainmentGuardianStatefsRequestV1(
        substitutedResult.request,
      ),
    "STATEFS_BINDING",
  );

  const thrownDispatch = createFreshStatefsManagerTransitionV1(
    "s3a-thrown-dispatch",
  );
  expectCode(
    () =>
      consume(thrownDispatch.transition, () => {
        throw new Error("S3A_DISPATCH_THROW");
      }),
    "S3A_DISPATCH_THROW",
  );
  expectCode(
    () => consume(thrownDispatch.transition, () => null),
    "MANAGER_BINDING",
  );
  expectCode(
    () =>
      assertCandidateContainmentGuardianStatefsRequestV1(
        thrownDispatch.request,
      ),
    "STATEFS_BINDING",
  );

  const substitutedReceiptTarget = createFreshStatefsManagerTransitionV1(
    "s3a-substituted-receipt-target",
  );
  expectCode(
    () =>
      managerReceiptInput(substitutedReceiptTarget.transition.state, receipt),
    "MANAGER_BINDING",
  );
  assert.equal(
    assertCandidateContainmentGuardianManagerProtocolTransitionV1(
      substitutedReceiptTarget.transition,
    ),
    true,
  );
}
