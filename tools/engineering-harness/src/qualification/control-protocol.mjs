import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { harnessRoot } from "../paths.mjs";
import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import {
  G17_BENCHMARK_CASE_IDS,
  G17_BENCHMARK_SUITE_HASH,
  G17_DARWIN_RUNTIME_MODULES,
  G17_DARWIN_STATISTICS,
} from "./benchmark-contract.mjs";
import {
  G17_CONTROL_SAMPLE_SCHEMA,
  G17_CONTROL_STATISTICS_CONTRACT,
} from "./control-statistics-contract.mjs";
import {
  G17_EVALUATOR_OVERLAY,
  G17_PRODUCT_IDENTITIES,
} from "./decision-contract.mjs";
import {
  G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  G17_G14B_PREREQUISITE_BINDING_SCHEMA,
  G17_G14B_PREREQUISITE_SCHEMA,
} from "./g14b-prerequisite-contract.mjs";

export {
  G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  G17_G14B_PREREQUISITE_BINDING_SCHEMA,
  G17_G14B_PREREQUISITE_SCHEMA,
} from "./g14b-prerequisite-contract.mjs";

export const G17_CONTROL_AUTHORIZATION_SCHEMA =
  "oxigraph.g1.7-control-authorization/v2";
export const G17_FINAL_DECISION_SET_SCHEMA =
  "oxigraph.g1.7-final-decision-set/v2";
export const G17_NEGATIVE_CONTROL_SIGNATURE_V2_SCHEMA =
  "oxigraph.g1.7-negative-control-signature/v2";
export const G17_CONTROL_RUN_RECEIPT_SCHEMA =
  "oxigraph.g1.7-control-run-receipt/v1";
export const G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA =
  "oxigraph.g1.7-benchmark-workspace-owner/v1";
export const G17_BENCHMARK_BUILD_OWNER_SCHEMA =
  "oxigraph.g1.7-benchmark-build-owner/v1";
export const G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA =
  "oxigraph.g1.7-benchmark-launch-attestation/v1";
export const G17_BENCHMARK_SESSION_OWNER_SCHEMA =
  "oxigraph.g1.7-benchmark-session-owner/v1";
export const G17_QUALIFICATION_SAMPLE_V3_SCHEMA = G17_CONTROL_SAMPLE_SCHEMA;

const DIGEST = /^[0-9a-f]{64}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const MAX_PROTOCOL_BYTES = 128 * 1024;
const APPROVAL_KEYS = Object.freeze(["status", "approvedBy", "approvedAt"]);
const CONTROL_AUTHORIZATION_KEYS = Object.freeze([
  "schema",
  "id",
  "status",
  "protocol",
  "approval",
  "contentHash",
]);
const FINAL_DECISION_KEYS = Object.freeze([
  "schema",
  "id",
  "status",
  "protocol",
  "controlAuthorization",
  "controlReceipt",
  "negativeControlSignature",
  "g14bPrerequisite",
  "approval",
  "contentHash",
]);

function deepFreeze(value) {
  if (ArrayBuffer.isView(value)) return value;
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function snapshotProtocolData(value, label, ancestors = new WeakSet()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object" || ArrayBuffer.isView(value)) {
    fail(`${label} contains non-JSON data`);
  }
  if (ancestors.has(value)) fail(`${label} contains a cycle`);
  const array = Array.isArray(value);
  if (
    Object.getPrototypeOf(value) !==
    (array ? Array.prototype : Object.prototype)
  ) {
    fail(`${label} must contain only ordinary JSON objects and arrays`);
  }
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) {
      fail(`${label} contains symbol fields`);
    }
    for (const key of keys) {
      const descriptor = descriptors[key];
      if ("get" in descriptor || "set" in descriptor) {
        fail(`${label} contains accessor fields`);
      }
    }
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        fail(`${label} array length is invalid`);
      }
      const expectedKeys = [
        ...Array.from({ length }, (_, index) => String(index)),
        "length",
      ];
      if (!isDeepStrictEqual([...keys].sort(), expectedKeys.sort())) {
        fail(`${label} arrays must be dense and field-free`);
      }
      return Array.from({ length }, (_, index) =>
        snapshotProtocolData(
          descriptors[String(index)].value,
          `${label}[${index}]`,
          ancestors,
        ),
      );
    }
    const snapshot = {};
    for (const key of keys) {
      if (!descriptors[key].enumerable) {
        fail(`${label}.${key} is not enumerable`);
      }
      Object.defineProperty(snapshot, key, {
        value: snapshotProtocolData(
          descriptors[key].value,
          `${label}.${key}`,
          ancestors,
        ),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return snapshot;
  } finally {
    ancestors.delete(value);
  }
}

function fail(message) {
  throw new Error(`G1.7 control protocol: ${message}`);
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} is not a SHA-256 digest`);
  return value;
}

function timestamp(value, label) {
  const milliseconds = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return milliseconds;
}

function strictBefore(left, right, message) {
  if (!(left < right)) fail(message);
}

function validateSelfHash(value, label) {
  digest(value.contentHash, `${label} contentHash`);
  const { contentHash, ...unsigned } = value;
  if (value.contentHash !== canonicalSha256(unsigned)) {
    fail(`${label} self-hash does not verify`);
  }
}

function validateApproval(approval, { approved, label }) {
  exactKeys(approval, APPROVAL_KEYS, `${label} approval`);
  if (!new Set(["UNAPPROVED", "APPROVED"]).has(approval.status)) {
    fail(`${label} approval status is invalid`);
  }
  if (approved) {
    if (
      approval.status !== "APPROVED" ||
      typeof approval.approvedBy !== "string" ||
      approval.approvedBy.trim().length === 0
    ) {
      fail(`${label} approved state lacks one named approver`);
    }
    timestamp(approval.approvedAt, `${label} approvedAt`);
  } else if (
    approval.status !== "UNAPPROVED" ||
    approval.approvedBy !== null ||
    approval.approvedAt !== null
  ) {
    fail(`${label} proposed state carries approval authority`);
  }
}

const schedules = deepFreeze([
  ["subject", "reference", "reference", "subject"],
  ["reference", "subject", "subject", "reference"],
]);

export const G17_CONTROL_AUTHORIZATION_PROTOCOL = deepFreeze({
  suite: {
    id: "oxigraph-g1.7-transactional-write",
    version: "1",
    taskHash: G17_BENCHMARK_SUITE_HASH,
    caseIds: G17_BENCHMARK_CASE_IDS,
  },
  darwin: {
    statistics: G17_DARWIN_STATISTICS,
    runtimeModuleSha256: G17_DARWIN_RUNTIME_MODULES,
  },
  controlStatistics: G17_CONTROL_STATISTICS_CONTRACT,
  products: G17_PRODUCT_IDENTITIES,
  evaluatorOverlay: G17_EVALUATOR_OVERLAY,
  execution: {
    controls: [
      {
        id: "negative-control",
        subjectRole: "negativeControl",
        referenceRole: "performanceReference",
        purpose: "detect-frozen-known-bad-product",
      },
      {
        id: "a-a-noise-control",
        subjectRole: "noiseControl",
        referenceRole: "noiseControl",
        subjectBuildId: "noise-control-a",
        referenceBuildId: "noise-control-b",
        independentBuildOwnersRequired: true,
        purpose: "independently-built-a-a-environmental-control",
      },
    ],
    schedules,
    warmupBlocks: 2,
    measuredBlocks: 5,
    measuredPairsPerCase: 10,
    rowsPerCase: 28,
    finalQualificationRows: 196,
    controlRows: 392,
    baseSeed: 170_017,
    seedDerivation: "base-plus-case100000-plus-globalblock2-plus-pair",
    adaptiveStopping: false,
    outlierDeletion: false,
  },
  thresholds: {
    negativeControlNoninferiorityBasisPoints: 1_000,
    aaEquivalenceBasisPoints: 500,
    maximumMadBasisPoints: 500,
    aggregation: "all-cases",
    bootstrapSamples: 5_000,
    bootstrapDecision: "lower95-strictly-positive",
    negativeSignatureSchema: G17_NEGATIVE_CONTROL_SIGNATURE_V2_SCHEMA,
  },
  ownerPolicy: {
    controlReceiptSchema: G17_CONTROL_RUN_RECEIPT_SCHEMA,
    workspaceOwnerSchema: G17_BENCHMARK_WORKSPACE_OWNER_SCHEMA,
    buildOwnerSchema: G17_BENCHMARK_BUILD_OWNER_SCHEMA,
    launchAttestationSchema: G17_BENCHMARK_LAUNCH_ATTESTATION_SCHEMA,
    sessionOwnerSchema: G17_BENCHMARK_SESSION_OWNER_SCHEMA,
    rawBuildReplayRequired: true,
    rawLaunchReplayRequired: true,
    summaryRecomputationRequired: true,
    isolatedWorkspacePerProduct: true,
    isolatedTargetPerProduct: true,
    productSubstitutionForbidden: true,
    controlEnvelope: {
      maxFiles: 128,
      maxFileBytes: 67_108_864,
      maxAggregateBytes: 268_435_456,
      regularFilesOnly: true,
      singleLinkOnly: true,
      ownerOnly: true,
      writeOnce: true,
      receiptLast: true,
    },
  },
  environment: {
    class: "linux-x86_64-cgroup-v2-non-tmpfs-serialized",
    harnessSessionExclusive: true,
    dedicatedHostRequired: false,
    dedicatedCpusetRequired: false,
    nonTmpfsVolumeRequired: true,
    hardVolumeQuotaRequired: false,
    cargoBuildJobs: 4,
    maximumControlToFinalApprovalMs: 86_400_000,
    maximumFinalApprovalToQualificationMs: 86_400_000,
    requireSameClassForQualification: true,
  },
  authorizationScope: {
    negativeControlExecution: true,
    aaNoiseControlExecution: true,
    subjectQualificationExecution: false,
    performanceReferenceQualificationExecution: false,
    promotionAuthority: false,
    publicationAuthority: false,
    routerQualityAuthority: false,
    providerExecutionAuthority: false,
  },
});

export const G17_PRE_CONTROL_DECISION_SET = deepFreeze({
  schema: "oxigraph.g1.7-decision-set/v1",
  contractSha256:
    "dd97f4a25b9555c1b711d697cdf636d1949690138fd3a78eb2f02a8b7a9b24f0",
  decisionSetSha256:
    "9a76ace507534b00cb5587e340e89ae24d6a8174b1bc257d532e694185a61efc",
  reference: {
    rawSha256:
      "45fbb9b98f9dabc7742c254a4b5b3bafc0f25174713445965332176df7af3a84",
    contentHash:
      "0a3f5e4f1ff40ead49f809cc124f54ce58bf5e3c4ca74114e0c565c33c0ea367",
    products: G17_PRODUCT_IDENTITIES,
    evaluatorOverlay: G17_EVALUATOR_OVERLAY,
  },
  performance: {
    rawSha256:
      "b38ae4b929dcf9e5da701808c726ada68a8c8188b7f3700f2fc47d4de6727d12",
    contentHash:
      "3184f0603d1a74f66161d097f995f572bf9592c3b90f316f6969ec1b499a5e98",
    maximumSlowdownBasisPoints: 1_000,
    metric: "paired-log-noninferiority",
    aggregation: "all-cases",
    bootstrap: G17_DARWIN_STATISTICS,
  },
  noise: {
    rawSha256:
      "72666540abf5196bb65bfeab2eac1b6ae8b0f4ab25621f5eadf998e054deeb01",
    contentHash:
      "3cf2243f1febc0e86322b1fec21bd67bcf6ba2e66ff4d97cb58783921202cb06",
    maximumMadBasisPoints: 500,
    method: "per-implementation-mad-over-median-elapsed",
    aggregation: "all-cases",
    outlierDeletion: false,
    adaptiveStopping: false,
  },
});

export const G17_FINAL_DECISION_PROTOCOL = deepFreeze({
  suiteHash: G17_BENCHMARK_SUITE_HASH,
  preControlDecisionSet: G17_PRE_CONTROL_DECISION_SET,
  qualification: {
    subjectRole: "currentSubject",
    referenceRole: "performanceReference",
    sampleSchema: G17_QUALIFICATION_SAMPLE_V3_SCHEMA,
    schedules,
    warmupBlocks: 2,
    measuredBlocks: 5,
    measuredPairsPerCase: 10,
    rows: 196,
    maximumSlowdownBasisPoints: 1_000,
    maximumMadBasisPoints: 500,
    adaptiveStopping: false,
    outlierDeletion: false,
  },
  prerequisite: {
    schema: G17_G14B_PREREQUISITE_SCHEMA,
    bindingSchema: G17_G14B_PREREQUISITE_BINDING_SCHEMA,
    artifactName: G17_G14B_PREREQUISITE_ARTIFACT_NAME,
    status: "REQUIRED_FOR_FINAL_APPROVAL",
    verifier: "replayApplicationReceipt",
    projectionHash: "canonical-sha256",
    expectedProjectionSha256:
      "d57eb7cb753d905e8951131c0bbcac188afb00e6ba893f572a994eeb5d20de87",
    expectedBindingSha256:
      "5a4f57211ab6bce138a4a5facc78092559e8f371f836687d1fc539e9129d08e5",
  },
  authorizationScope: {
    controlExecution: false,
    subjectQualificationExecution: true,
    performanceReferenceQualificationExecution: true,
    promotionAuthority: false,
    publicationAuthority: false,
    routerQualityAuthority: false,
    providerExecutionAuthority: false,
  },
});

export function validateG17ControlAuthorization(value) {
  const candidate = snapshotProtocolData(value, "control authorization");
  exactKeys(candidate, CONTROL_AUTHORIZATION_KEYS, "control authorization");
  if (
    candidate.schema !== G17_CONTROL_AUTHORIZATION_SCHEMA ||
    candidate.id !== "control-authorization" ||
    !new Set(["CONTROL_AUTH_PROPOSED", "CONTROL_AUTHORIZED"]).has(
      candidate.status,
    ) ||
    !isDeepStrictEqual(candidate.protocol, G17_CONTROL_AUTHORIZATION_PROTOCOL)
  ) {
    fail("control authorization identity or frozen policy drifted");
  }
  const approved = candidate.status === "CONTROL_AUTHORIZED";
  validateApproval(candidate.approval, {
    approved,
    label: "control authorization",
  });
  validateSelfHash(candidate, "control authorization");
  return deepFreeze(candidate);
}

export function validateG17NegativeControlSignature(value) {
  const candidate = snapshotProtocolData(value, "negative-control signature");
  exactKeys(
    candidate,
    [
      "schema",
      "suiteHash",
      "status",
      "budgetBreaches",
      "sampleSetSha256",
      "authorizationContentHash",
      "controlRunId",
      "contentHash",
    ],
    "negative-control signature",
  );
  const indexes = Array.isArray(candidate.budgetBreaches)
    ? candidate.budgetBreaches.map((caseId) =>
        G17_BENCHMARK_CASE_IDS.indexOf(caseId),
      )
    : [];
  if (
    candidate.schema !== G17_NEGATIVE_CONTROL_SIGNATURE_V2_SCHEMA ||
    candidate.suiteHash !== G17_BENCHMARK_SUITE_HASH ||
    candidate.status !== "FAIL" ||
    indexes.length < 1 ||
    indexes.some((index) => index < 0) ||
    new Set(indexes).size !== indexes.length ||
    indexes.some(
      (index, position) => position > 0 && index <= indexes[position - 1],
    ) ||
    !SAFE_ID.test(candidate.controlRunId ?? "")
  ) {
    fail("negative-control signature is invalid");
  }
  digest(candidate.sampleSetSha256, "negative-control sampleSetSha256");
  digest(
    candidate.authorizationContentHash,
    "negative-control authorizationContentHash",
  );
  validateSelfHash(candidate, "negative-control signature");
  return deepFreeze(candidate);
}

function validateControlAuthorizationBinding(binding) {
  exactKeys(
    binding,
    ["schema", "rawSha256", "contentHash"],
    "control authorization binding",
  );
  if (binding.schema !== G17_CONTROL_AUTHORIZATION_SCHEMA) {
    fail("control authorization binding schema drifted");
  }
  digest(binding.rawSha256, "control authorization rawSha256");
  digest(binding.contentHash, "control authorization binding contentHash");
  return binding;
}

function validateControlReceiptBinding(binding) {
  exactKeys(
    binding,
    [
      "schema",
      "status",
      "runId",
      "rawSha256",
      "receiptSha256",
      "authorizationRawSha256",
      "authorizationContentHash",
      "negativeControlSignatureContentHash",
      "startedAt",
      "completedAt",
      "environmentClass",
    ],
    "control receipt binding",
  );
  if (
    binding.schema !== G17_CONTROL_RUN_RECEIPT_SCHEMA ||
    binding.status !== "CONTROL_SEALED_PASS" ||
    !SAFE_ID.test(binding.runId ?? "") ||
    binding.environmentClass !==
      G17_CONTROL_AUTHORIZATION_PROTOCOL.environment.class
  ) {
    fail("control receipt binding identity drifted");
  }
  for (const key of [
    "rawSha256",
    "receiptSha256",
    "authorizationRawSha256",
    "authorizationContentHash",
    "negativeControlSignatureContentHash",
  ]) {
    digest(binding[key], `control receipt ${key}`);
  }
  const startedAt = timestamp(binding.startedAt, "control startedAt");
  const completedAt = timestamp(binding.completedAt, "control completedAt");
  strictBefore(startedAt, completedAt, "control start must precede completion");
  return { binding, startedAt, completedAt };
}

function validateG14bBinding(binding) {
  exactKeys(
    binding,
    ["schema", "status", "projectionSha256", "bindingSha256"],
    "G1.4b prerequisite binding",
  );
  if (
    binding.schema !== G17_G14B_PREREQUISITE_SCHEMA ||
    binding.status !== "PASS"
  ) {
    fail("G1.4b prerequisite is not a replayed PASS projection");
  }
  digest(binding.projectionSha256, "G1.4b prerequisite projectionSha256");
  digest(binding.bindingSha256, "G1.4b prerequisite bindingSha256");
  if (
    binding.projectionSha256 !==
      G17_FINAL_DECISION_PROTOCOL.prerequisite.expectedProjectionSha256 ||
    binding.bindingSha256 !==
      G17_FINAL_DECISION_PROTOCOL.prerequisite.expectedBindingSha256
  ) {
    fail("G1.4b prerequisite hashes do not match the accepted replay");
  }
  return binding;
}

export function validateG17FinalDecisionSet(value) {
  const candidate = snapshotProtocolData(value, "final decision set");
  exactKeys(candidate, FINAL_DECISION_KEYS, "final decision set");
  if (
    candidate.schema !== G17_FINAL_DECISION_SET_SCHEMA ||
    candidate.id !== "final-decision-set" ||
    !new Set(["PROPOSED", "APPROVED"]).has(candidate.status) ||
    !isDeepStrictEqual(candidate.protocol, G17_FINAL_DECISION_PROTOCOL)
  ) {
    fail("final decision identity or pre-control policy drifted");
  }
  validateControlAuthorizationBinding(candidate.controlAuthorization);
  const approved = candidate.status === "APPROVED";
  validateApproval(candidate.approval, {
    approved,
    label: "final decision set",
  });
  if (approved) {
    validateControlReceiptBinding(candidate.controlReceipt);
    validateG17NegativeControlSignature(candidate.negativeControlSignature);
    validateG14bBinding(candidate.g14bPrerequisite);
  } else if (
    candidate.controlReceipt !== null ||
    candidate.negativeControlSignature !== null ||
    candidate.g14bPrerequisite !== null
  ) {
    fail("proposed final decision contains post-control evidence");
  }
  validateSelfHash(candidate, "final decision set");
  return deepFreeze(candidate);
}

export function validateG17ControlExecutionBinding({
  authorization,
  authorizationRawSha256,
  controlStartedAt,
} = {}) {
  const validated = validateG17ControlAuthorization(authorization);
  if (validated.status !== "CONTROL_AUTHORIZED") {
    fail("proposed control authorization cannot start controls");
  }
  digest(authorizationRawSha256, "control authorization rawSha256");
  const approvedAt = timestamp(
    validated.approval.approvedAt,
    "control authorization approvedAt",
  );
  const startedAt = timestamp(controlStartedAt, "control startedAt");
  strictBefore(
    approvedAt,
    startedAt,
    "control authorization must be approved before control start",
  );
  return deepFreeze({
    phase: "CONTROL_AUTHORIZED",
    authorization: validated,
    authorizationRawSha256,
    controlStartedAt,
    controlExecutionAuthorized: true,
    qualificationExecutionAuthorized: false,
  });
}

function validateApprovedFinalLifecycle({
  authorization,
  authorizationRawSha256,
  finalDecisionSet,
  qualificationStartedAt,
} = {}) {
  const validatedAuthorization = validateG17ControlAuthorization(authorization);
  const validatedFinal = validateG17FinalDecisionSet(finalDecisionSet);
  digest(authorizationRawSha256, "control authorization rawSha256");
  if (
    validatedAuthorization.status !== "CONTROL_AUTHORIZED" ||
    validatedFinal.status !== "APPROVED" ||
    validatedFinal.controlAuthorization.rawSha256 !== authorizationRawSha256 ||
    validatedFinal.controlAuthorization.contentHash !==
      validatedAuthorization.contentHash
  ) {
    fail("final decision does not bind the authorized control policy");
  }
  const receipt = validateControlReceiptBinding(validatedFinal.controlReceipt);
  if (
    receipt.binding.authorizationRawSha256 !== authorizationRawSha256 ||
    receipt.binding.authorizationContentHash !==
      validatedAuthorization.contentHash
  ) {
    fail("control receipt does not bind the authorized control policy");
  }
  const signature = validateG17NegativeControlSignature(
    validatedFinal.negativeControlSignature,
  );
  if (
    signature.controlRunId !== receipt.binding.runId ||
    signature.authorizationContentHash !== validatedAuthorization.contentHash ||
    signature.contentHash !==
      receipt.binding.negativeControlSignatureContentHash
  ) {
    fail(
      "negative-control signature does not match the sealed control receipt",
    );
  }
  const authorizationApprovedAt = timestamp(
    validatedAuthorization.approval.approvedAt,
    "control authorization approvedAt",
  );
  strictBefore(
    authorizationApprovedAt,
    receipt.startedAt,
    "control authorization must be approved before control start",
  );
  const finalApprovedAt = timestamp(
    validatedFinal.approval.approvedAt,
    "final decision approvedAt",
  );
  strictBefore(
    receipt.completedAt,
    finalApprovedAt,
    "control completion must precede final approval",
  );
  if (
    finalApprovedAt - receipt.completedAt >
    G17_CONTROL_AUTHORIZATION_PROTOCOL.environment
      .maximumControlToFinalApprovalMs
  ) {
    fail("sealed controls are too old for final approval");
  }
  const qualificationStart = timestamp(
    qualificationStartedAt,
    "qualification startedAt",
  );
  strictBefore(
    finalApprovedAt,
    qualificationStart,
    "final approval must precede qualification start",
  );
  if (
    qualificationStart - finalApprovedAt >
    G17_CONTROL_AUTHORIZATION_PROTOCOL.environment
      .maximumFinalApprovalToQualificationMs
  ) {
    fail("final approval is too old for qualification start");
  }
  return {
    validatedAuthorization,
    validatedFinal,
    receipt,
  };
}

export function validateG17QualificationOwnerGate(options = {}) {
  const { validatedAuthorization, validatedFinal, receipt } =
    validateApprovedFinalLifecycle(options);
  return deepFreeze({
    phase: "FINAL_SET_APPROVED",
    authorization: validatedAuthorization,
    finalDecisionSet: validatedFinal,
    controlRunId: receipt.binding.runId,
    ownerGatePassed: true,
    executionOwnerAvailable: false,
    qualificationExecutionAuthorized: false,
    promotionAuthority: false,
    publicationAuthority: false,
  });
}

export function validateG17FinalDecisionBinding({
  g14bPrerequisiteProjection,
  ...options
} = {}) {
  const ownerGate = validateG17QualificationOwnerGate(options);
  const validatedFinal = ownerGate.finalDecisionSet;
  const prerequisite = snapshotProtocolData(
    g14bPrerequisiteProjection,
    "G1.4b prerequisite projection",
  );
  if (
    prerequisite === null ||
    typeof prerequisite !== "object" ||
    prerequisite.schema !== G17_G14B_PREREQUISITE_SCHEMA ||
    prerequisite.status !== "PASS" ||
    prerequisite.bindingSha256 !==
      validatedFinal.g14bPrerequisite.bindingSha256 ||
    canonicalSha256(prerequisite) !==
      validatedFinal.g14bPrerequisite.projectionSha256
  ) {
    fail("final decision does not bind the replayed G1.4b prerequisite");
  }
  return deepFreeze({
    ...ownerGate,
    finalDecisionSet: validatedFinal,
    ownerGatePassed: true,
    executionOwnerAvailable: false,
    g14bPrerequisiteBound: true,
    controlReceiptReplayAvailable: false,
    qualificationExecutionAuthorized: false,
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableRead(path, maximumBytes, label) {
  if (
    !Number.isInteger(constants.O_NOFOLLOW) ||
    !Number.isInteger(constants.O_NONBLOCK)
  ) {
    fail("O_NOFOLLOW or O_NONBLOCK is unavailable");
  }
  let descriptor;
  try {
    const closeOnExec = Number.isInteger(constants.O_CLOEXEC)
      ? constants.O_CLOEXEC
      : 0;
    descriptor = openSync(
      path,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        closeOnExec,
    );
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.size < 1n ||
      before.size > BigInt(maximumBytes)
    ) {
      fail(`${label} is not a bounded regular file`);
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== after[key]) fail(`${label} changed while being read`);
    }
    if (BigInt(bytes.length) !== before.size)
      fail(`${label} read length drifted`);
    return bytes;
  } catch (error) {
    if (error.message.startsWith("G1.7 control protocol:")) throw error;
    fail(`${label} cannot be read safely: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function decodeProtocolArtifact({ bytes, descriptor, validate, label }) {
  const copiedBytes = Buffer.isBuffer(bytes) ? Buffer.from(bytes) : bytes;
  const copiedDescriptor = snapshotProtocolData(
    descriptor,
    `${label} descriptor`,
  );
  exactKeys(
    copiedDescriptor,
    ["id", "path", "sealedName", "schema", "sha256", "contentHash", "maxBytes"],
    `${label} descriptor`,
  );
  if (
    !Buffer.isBuffer(copiedBytes) ||
    copiedBytes.length < 1 ||
    copiedBytes.length > copiedDescriptor.maxBytes ||
    copiedBytes.length > MAX_PROTOCOL_BYTES ||
    sha256(copiedBytes) !== copiedDescriptor.sha256
  ) {
    fail(`${label} copied bytes do not match their descriptor`);
  }
  let value;
  try {
    value = JSON.parse(copiedBytes);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  if (!copiedBytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail(`${label} bytes are not canonical JSON plus one LF`);
  }
  const validated = validate(value);
  if (
    validated.id !== copiedDescriptor.id ||
    validated.schema !== copiedDescriptor.schema ||
    validated.contentHash !== copiedDescriptor.contentHash
  ) {
    fail(`${label} descriptor does not bind the decoded artifact`);
  }
  return deepFreeze({
    value: validated,
    bytes: copiedBytes,
    rawSha256: copiedDescriptor.sha256,
    byteLength: copiedBytes.length,
  });
}

function loadProtocolArtifact({ root, descriptor, validate, label }) {
  const copiedDescriptor = snapshotProtocolData(
    descriptor,
    `${label} descriptor`,
  );
  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, copiedDescriptor?.path ?? "");
  if (!path.startsWith(`${resolvedRoot}${sep}`)) {
    fail(`${label} path escapes the harness root`);
  }
  return decodeProtocolArtifact({
    bytes: stableRead(path, copiedDescriptor.maxBytes, label),
    descriptor: copiedDescriptor,
    validate,
    label,
  });
}

export function loadG17ControlProtocol({ contract, root = harnessRoot } = {}) {
  const authorization = loadProtocolArtifact({
    root,
    descriptor: contract?.controlAuthorizationDecision,
    validate: validateG17ControlAuthorization,
    label: "control authorization",
  });
  const finalDecisionSet = loadProtocolArtifact({
    root,
    descriptor: contract?.finalDecisionSet,
    validate: validateG17FinalDecisionSet,
    label: "final decision set",
  });
  return deepFreeze({
    authorization: authorization.value,
    finalDecisionSet: finalDecisionSet.value,
    artifacts: {
      authorization: {
        rawSha256: authorization.rawSha256,
        byteLength: authorization.byteLength,
      },
      finalDecisionSet: {
        rawSha256: finalDecisionSet.rawSha256,
        byteLength: finalDecisionSet.byteLength,
      },
    },
  });
}

export function decodeSealedG17ControlProtocol({ contract, bytesByName } = {}) {
  if (bytesByName === null || typeof bytesByName?.get !== "function") {
    fail("sealed protocol artifact map is invalid");
  }
  const authorization = decodeProtocolArtifact({
    bytes: bytesByName.get(contract?.controlAuthorizationDecision?.sealedName),
    descriptor: contract?.controlAuthorizationDecision,
    validate: validateG17ControlAuthorization,
    label: "control authorization",
  });
  const finalDecisionSet = decodeProtocolArtifact({
    bytes: bytesByName.get(contract?.finalDecisionSet?.sealedName),
    descriptor: contract?.finalDecisionSet,
    validate: validateG17FinalDecisionSet,
    label: "final decision set",
  });
  return deepFreeze({
    authorization: authorization.value,
    finalDecisionSet: finalDecisionSet.value,
    artifacts: {
      authorization: {
        rawSha256: authorization.rawSha256,
        byteLength: authorization.byteLength,
      },
      finalDecisionSet: {
        rawSha256: finalDecisionSet.rawSha256,
        byteLength: finalDecisionSet.byteLength,
      },
    },
  });
}
