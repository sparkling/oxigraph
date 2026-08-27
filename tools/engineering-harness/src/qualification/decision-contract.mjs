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
  G17_DARWIN_STATISTICS,
  G17_NOISE_MAD_BASIS_POINTS,
  G17_PERFORMANCE_SLOWDOWN_BASIS_POINTS,
} from "./benchmark-contract.mjs";

export const G17_REFERENCE_DECISION_SCHEMA =
  "oxigraph.g1.7-reference-decision/v1";
export const G17_PERFORMANCE_DECISION_SCHEMA =
  "oxigraph.g1.7-performance-budget-decision/v1";
export const G17_NOISE_DECISION_SCHEMA =
  "oxigraph.g1.7-noise-budget-decision/v1";
export const G17_DECISION_SET_SCHEMA = "oxigraph.g1.7-decision-set/v1";
export const G17_NEGATIVE_CONTROL_SIGNATURE_SCHEMA =
  "oxigraph.g1.7-negative-control-signature/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const MAX_DECISION_BYTES = 32_768;
const APPROVAL_KEYS = Object.freeze(["status", "approvedBy", "approvedAt"]);

export const G17_PRODUCT_IDENTITIES = deepFreeze({
  performanceReference: {
    commit: "7eec1f0715e4f28434b2f505e289c9b599991aae",
    tree: "5d1034cac3a37c8cecc9f26b3f5844c4ed248f53",
    cargoLockBlob: "2f450bd98dafca7188177f7d306a12dcfe9a60a5",
    cargoLockSha256:
      "4d441937d61daebdc3381a4ce2916df9321d72acc55b1d4429d7f7a1f89a76e6",
  },
  noiseControl: {
    commit: "623adae314f3c4093d563900f6376ce78262a9f0",
    tree: "b82d79f2cb25399d80e1f0250bacd1a7e538da19",
    cargoLockBlob: "2f450bd98dafca7188177f7d306a12dcfe9a60a5",
    cargoLockSha256:
      "4d441937d61daebdc3381a4ce2916df9321d72acc55b1d4429d7f7a1f89a76e6",
  },
  negativeControl: {
    commit: "1da47285113eee75c916c34f543e7f7f4e5c747b",
    tree: "20305e76355f2d39a4a62abbdf1941bb03087d6e",
    cargoLockBlob: "2f450bd98dafca7188177f7d306a12dcfe9a60a5",
    cargoLockSha256:
      "4d441937d61daebdc3381a4ce2916df9321d72acc55b1d4429d7f7a1f89a76e6",
  },
});

export const G17_EVALUATOR_OVERLAY = deepFreeze({
  commit: "3aca932e4062f9b087adfa486fac936b5bbeaebb",
  parent: "623adae314f3c4093d563900f6376ce78262a9f0",
  tree: "a8b0310482b88a813aa602ebb7264b259e066586",
  patchSha256:
    "3c3df24b0021b1bfebb42ffed2ff9a2c228d7e0ac302c4a5aa9e6b6e8e68db46",
  paths: [
    {
      path: "lib/oxigraph/Cargo.toml",
      changeStatus: "M",
      blob: "8b4a1d3f82829d0f2780b88904f8bd2149151020",
      contentSha256:
        "e83b4ab43124affe47706192de6af6ae462bf6d819f66e8caecf3897888bb868",
    },
    {
      path: "lib/oxigraph/benches/transactional_write.rs",
      changeStatus: "A",
      blob: "07560ff94aaf12f9c4bd3e70e58a61edf3446fcb",
      contentSha256:
        "4a1ce885de13b2db4562195c2735b350e0623109c52a44d54f6b7b0076e10727",
    },
  ],
  roleCompositions: {
    performanceReference: {
      baseManifestBlob: "c2c7eccaf8a5e62d1e5e56eaf1808706d65d599e",
      effectiveManifestBlob: "d4a9bde30ba10d20e42c65bde0d9cc39529fc594",
      effectiveManifestSha256:
        "de667739f772715fd753d8372658186803095301d1aaae36e6682443da71d452",
      effectiveTree: "2f800745c958c8d749af40ae66324c41f6fe409b",
    },
    noiseControl: {
      baseManifestBlob: "c41d349c75b69bc6f8c640aa7f1a7aac06853b46",
      effectiveManifestBlob: "8b4a1d3f82829d0f2780b88904f8bd2149151020",
      effectiveManifestSha256:
        "e83b4ab43124affe47706192de6af6ae462bf6d819f66e8caecf3897888bb868",
      effectiveTree: "a8b0310482b88a813aa602ebb7264b259e066586",
    },
    negativeControl: {
      baseManifestBlob: "c2c7eccaf8a5e62d1e5e56eaf1808706d65d599e",
      effectiveManifestBlob: "d4a9bde30ba10d20e42c65bde0d9cc39529fc594",
      effectiveManifestSha256:
        "de667739f772715fd753d8372658186803095301d1aaae36e6682443da71d452",
      effectiveTree: "4949301d1b66d7a104692d12230023757bdf1ca0",
    },
  },
});

export const G17_CONTROL_PLAN = deepFreeze({
  negativeControl: {
    productRole: "negativeControl",
    purpose: "detect-frozen-known-bad-product",
    expectedSignature: null,
  },
  noiseControl: {
    productRole: "noiseControl",
    purpose: "independently-built-a-a-environmental-control",
  },
  qualification: {
    subjectRole: "currentSubject",
    referenceRole: "performanceReference",
  },
  substitutionsForbidden: true,
});

const EXPECTED_DESCRIPTORS = deepFreeze({
  reference: {
    id: "reference",
    path: "qualification/g1.7/decisions/reference.json",
    sealedName: "reference-decision.json",
    schema: G17_REFERENCE_DECISION_SCHEMA,
    maxBytes: MAX_DECISION_BYTES,
    sha256: "45fbb9b98f9dabc7742c254a4b5b3bafc0f25174713445965332176df7af3a84",
    contentHash:
      "0a3f5e4f1ff40ead49f809cc124f54ce58bf5e3c4ca74114e0c565c33c0ea367",
  },
  performance: {
    id: "performance-budget",
    path: "qualification/g1.7/decisions/performance-budget.json",
    sealedName: "performance-budget-decision.json",
    schema: G17_PERFORMANCE_DECISION_SCHEMA,
    maxBytes: MAX_DECISION_BYTES,
    sha256: "b38ae4b929dcf9e5da701808c726ada68a8c8188b7f3700f2fc47d4de6727d12",
    contentHash:
      "3184f0603d1a74f66161d097f995f572bf9592c3b90f316f6969ec1b499a5e98",
  },
  noise: {
    id: "noise-budget",
    path: "qualification/g1.7/decisions/noise-budget.json",
    sealedName: "noise-budget-decision.json",
    schema: G17_NOISE_DECISION_SCHEMA,
    maxBytes: MAX_DECISION_BYTES,
    sha256: "72666540abf5196bb65bfeab2eac1b6ae8b0f4ab25621f5eadf998e054deeb01",
    contentHash:
      "3cf2243f1febc0e86322b1fec21bd67bcf6ba2e66ff4d97cb58783921202cb06",
  },
});

function fail(message) {
  throw new Error(`G1.7 decision contract: ${message}`);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalTimestamp(value, label) {
  const parsed = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  ) {
    fail(`${label} must be a canonical UTC timestamp`);
  }
  return parsed;
}

function validateApproval(approval, { approvedStatus, decisionStatus }, label) {
  exactKeys(approval, APPROVAL_KEYS, `${label} approval`);
  if (!["APPROVED", "UNAPPROVED"].includes(approval.status)) {
    fail(`${label} approval status is invalid`);
  }
  if (approval.status === "APPROVED") {
    if (
      decisionStatus !== approvedStatus ||
      typeof approval.approvedBy !== "string" ||
      approval.approvedBy.trim().length === 0
    ) {
      fail(`${label} approved state lacks a named approver`);
    }
    canonicalTimestamp(approval.approvedAt, `${label} approvedAt`);
  } else if (
    approval.approvedBy !== null ||
    approval.approvedAt !== null ||
    decisionStatus === approvedStatus
  ) {
    fail(`${label} unapproved state is inconsistent`);
  }
}

function validateContentHash(value, label) {
  if (!DIGEST.test(value.contentHash ?? "")) {
    fail(`${label} contentHash is malformed`);
  }
  const { contentHash, ...unsigned } = value;
  if (contentHash !== canonicalSha256(unsigned)) {
    fail(`${label} self-hash does not verify`);
  }
}

function validateNegativeControlSignature(signature) {
  exactKeys(
    signature,
    ["schema", "suiteHash", "status", "budgetBreaches", "sampleSetSha256"],
    "negative-control signature",
  );
  const indexes = Array.isArray(signature.budgetBreaches)
    ? signature.budgetBreaches.map((caseId) =>
        G17_BENCHMARK_CASE_IDS.indexOf(caseId),
      )
    : [];
  if (
    signature.schema !== G17_NEGATIVE_CONTROL_SIGNATURE_SCHEMA ||
    signature.suiteHash !== G17_BENCHMARK_SUITE_HASH ||
    signature.status !== "FAIL" ||
    indexes.length < 1 ||
    indexes.some((index) => index < 0) ||
    new Set(indexes).size !== indexes.length ||
    indexes.some(
      (index, position) => position > 0 && index <= indexes[position - 1],
    ) ||
    !DIGEST.test(signature.sampleSetSha256 ?? "")
  ) {
    fail("negative-control signature is invalid");
  }
}

function validateControlPlan(controlPlan, status) {
  const signature = controlPlan?.negativeControl?.expectedSignature;
  const normalized = structuredClone(controlPlan);
  if (normalized?.negativeControl) {
    normalized.negativeControl.expectedSignature = null;
  }
  if (!isDeepStrictEqual(normalized, G17_CONTROL_PLAN)) {
    fail("reference control plan drifted");
  }
  if (status === "PROPOSED") {
    if (signature !== null) {
      fail(
        "proposed reference contains an unapproved negative-control signature",
      );
    }
    return;
  }
  if (signature === null) {
    fail("selected reference lacks a frozen negative-control signature");
  }
  validateNegativeControlSignature(signature);
}

export function validateG17ReferenceDecision(value) {
  exactKeys(
    value,
    [
      "schema",
      "id",
      "status",
      "suiteHash",
      "products",
      "evaluatorOverlay",
      "controlPlan",
      "approval",
      "contentHash",
    ],
    "reference decision",
  );
  if (
    value.schema !== G17_REFERENCE_DECISION_SCHEMA ||
    value.id !== "reference" ||
    !["PROPOSED", "SELECTED"].includes(value.status) ||
    value.suiteHash !== G17_BENCHMARK_SUITE_HASH
  ) {
    fail("reference decision identity drifted");
  }
  if (!isDeepStrictEqual(value.products, G17_PRODUCT_IDENTITIES)) {
    fail("reference product identities drifted");
  }
  if (
    Object.values(value.products).some(
      ({ commit }) => commit === G17_EVALUATOR_OVERLAY.commit,
    )
  ) {
    fail("evaluator overlay was substituted for a product identity");
  }
  if (!isDeepStrictEqual(value.evaluatorOverlay, G17_EVALUATOR_OVERLAY)) {
    fail("evaluator overlay binding drifted");
  }
  validateControlPlan(value.controlPlan, value.status);
  validateApproval(
    value.approval,
    { approvedStatus: "SELECTED", decisionStatus: value.status },
    "reference decision",
  );
  validateContentHash(value, "reference decision");
  return deepFreeze(value);
}

function expectedPerformanceCases() {
  return G17_BENCHMARK_CASE_IDS.map((id) => ({
    id,
    maximumSlowdownBasisPoints: G17_PERFORMANCE_SLOWDOWN_BASIS_POINTS,
  }));
}

export function validateG17PerformanceDecision(value) {
  exactKeys(
    value,
    [
      "schema",
      "id",
      "status",
      "suiteHash",
      "metric",
      "aggregation",
      "cases",
      "bootstrap",
      "approval",
      "contentHash",
    ],
    "performance budget decision",
  );
  if (
    value.schema !== G17_PERFORMANCE_DECISION_SCHEMA ||
    value.id !== "performance-budget" ||
    !["PROPOSED", "APPROVED"].includes(value.status) ||
    value.suiteHash !== G17_BENCHMARK_SUITE_HASH ||
    value.metric !== "paired-log-noninferiority" ||
    value.aggregation !== "all-cases"
  ) {
    fail("performance budget decision identity drifted");
  }
  if (!isDeepStrictEqual(value.cases, expectedPerformanceCases())) {
    fail("performance budget cases drifted");
  }
  if (!isDeepStrictEqual(value.bootstrap, G17_DARWIN_STATISTICS)) {
    fail("paired Darwin statistics binding drifted");
  }
  validateApproval(
    value.approval,
    { approvedStatus: "APPROVED", decisionStatus: value.status },
    "performance budget decision",
  );
  validateContentHash(value, "performance budget decision");
  return deepFreeze(value);
}

function expectedNoiseCases() {
  return G17_BENCHMARK_CASE_IDS.map((id) => ({
    id,
    maximumMadBasisPoints: G17_NOISE_MAD_BASIS_POINTS,
  }));
}

export function validateG17NoiseDecision(value) {
  exactKeys(
    value,
    [
      "schema",
      "id",
      "status",
      "suiteHash",
      "method",
      "implementations",
      "aggregation",
      "cases",
      "comparison",
      "outlierDeletion",
      "adaptiveStopping",
      "approval",
      "contentHash",
    ],
    "noise budget decision",
  );
  if (
    value.schema !== G17_NOISE_DECISION_SCHEMA ||
    value.id !== "noise-budget" ||
    !["PROPOSED", "APPROVED"].includes(value.status) ||
    value.suiteHash !== G17_BENCHMARK_SUITE_HASH ||
    value.method !== "per-implementation-mad-over-median-elapsed" ||
    !isDeepStrictEqual(value.implementations, ["subject", "reference"]) ||
    value.aggregation !== "all-cases" ||
    value.comparison !== "madNs*10000<=medianElapsedNs*maximumMadBasisPoints" ||
    value.outlierDeletion !== false ||
    value.adaptiveStopping !== false
  ) {
    fail("noise budget decision identity drifted");
  }
  if (!isDeepStrictEqual(value.cases, expectedNoiseCases())) {
    fail("noise budget cases drifted");
  }
  validateApproval(
    value.approval,
    { approvedStatus: "APPROVED", decisionStatus: value.status },
    "noise budget decision",
  );
  validateContentHash(value, "noise budget decision");
  return deepFreeze(value);
}

function stableRead(path, maxBytes) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    fail("O_NOFOLLOW is unavailable");
  }
  let descriptor;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor, { bigint: true });
    if (
      !before.isFile() ||
      before.size < 1n ||
      before.size > BigInt(maxBytes)
    ) {
      fail("decision artifact is not a bounded regular file");
    }
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) {
      if (before[key] !== after[key]) {
        fail("decision artifact changed while being read");
      }
    }
    if (BigInt(bytes.length) !== before.size) {
      fail("decision artifact read length drifted");
    }
    return bytes;
  } catch (error) {
    if (error.message.startsWith("G1.7 decision contract:")) throw error;
    fail(`decision artifact cannot be read safely: ${error.message}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateDescriptor(descriptor, expected, label) {
  exactKeys(
    descriptor,
    ["id", "path", "sealedName", "schema", "sha256", "contentHash", "maxBytes"],
    `${label} descriptor`,
  );
  for (const key of [
    "id",
    "path",
    "sealedName",
    "schema",
    "maxBytes",
    "sha256",
    "contentHash",
  ]) {
    if (descriptor[key] !== expected[key]) {
      fail(`${label} descriptor ${key} drifted`);
    }
  }
  if (
    !DIGEST.test(descriptor.sha256 ?? "") ||
    !DIGEST.test(descriptor.contentHash ?? "")
  ) {
    fail(`${label} descriptor digest is malformed`);
  }
}

function loadDecision({ root, descriptor, expected, validate, label }) {
  validateDescriptor(descriptor, expected, label);
  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, descriptor.path);
  if (!path.startsWith(`${resolvedRoot}${sep}`)) {
    fail(`${label} path escapes the harness root`);
  }
  const bytes = stableRead(path, descriptor.maxBytes);
  if (sha256(bytes) !== descriptor.sha256) {
    fail(`${label} raw hash does not verify`);
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  const canonicalBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  if (!bytes.equals(canonicalBytes)) {
    fail(`${label} bytes are not canonical JSON plus one LF`);
  }
  const decision = validate(value);
  if (
    decision.schema !== descriptor.schema ||
    decision.id !== descriptor.id ||
    decision.contentHash !== descriptor.contentHash
  ) {
    fail(`${label} descriptor does not bind the decoded decision`);
  }
  return Object.freeze({
    decision,
    byteLength: bytes.length,
    rawSha256: descriptor.sha256,
  });
}

export function g17DecisionSetSha256({ reference, performance, noise }) {
  return canonicalSha256({
    schema: G17_DECISION_SET_SCHEMA,
    reference: {
      sha256: reference.sha256,
      contentHash: reference.contentHash,
    },
    performance: {
      sha256: performance.sha256,
      contentHash: performance.contentHash,
    },
    noise: {
      sha256: noise.sha256,
      contentHash: noise.contentHash,
    },
  });
}

export function loadG17DecisionSet({ contract, root = harnessRoot } = {}) {
  try {
    const reference = loadDecision({
      root,
      descriptor: contract?.referenceDecision,
      expected: EXPECTED_DESCRIPTORS.reference,
      validate: validateG17ReferenceDecision,
      label: "reference decision",
    });
    const performance = loadDecision({
      root,
      descriptor: contract?.budgetDecision,
      expected: EXPECTED_DESCRIPTORS.performance,
      validate: validateG17PerformanceDecision,
      label: "performance budget decision",
    });
    const noise = loadDecision({
      root,
      descriptor: contract?.noiseDecision,
      expected: EXPECTED_DESCRIPTORS.noise,
      validate: validateG17NoiseDecision,
      label: "noise budget decision",
    });
    const decisionSetSha256 = g17DecisionSetSha256({
      reference: contract.referenceDecision,
      performance: contract.budgetDecision,
      noise: contract.noiseDecision,
    });
    if (decisionSetSha256 !== contract.decisionSetSha256) {
      fail("decision-set hash does not verify");
    }
    return deepFreeze({
      reference: reference.decision,
      performance: performance.decision,
      noise: noise.decision,
      artifacts: { reference, performance, noise },
      decisionSetSha256,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 decision contract:")) throw error;
    fail(error.message);
  }
}

function bindDecisionToDescriptor(
  decision,
  descriptor,
  expected,
  validate,
  label,
) {
  validateDescriptor(descriptor, expected, label);
  const validated = validate(decision);
  const bytes = Buffer.from(`${canonicalJson(validated)}\n`, "utf8");
  if (
    sha256(bytes) !== descriptor.sha256 ||
    validated.contentHash !== descriptor.contentHash ||
    validated.schema !== descriptor.schema ||
    validated.id !== descriptor.id
  ) {
    fail(`${label} does not match its exact canonical descriptor`);
  }
  return validated;
}

export function validateG17DecisionSetBinding({
  contract,
  decisions,
  startedAt,
} = {}) {
  const reference = bindDecisionToDescriptor(
    decisions?.reference,
    contract?.referenceDecision,
    EXPECTED_DESCRIPTORS.reference,
    validateG17ReferenceDecision,
    "reference decision",
  );
  const performance = bindDecisionToDescriptor(
    decisions?.performance,
    contract?.budgetDecision,
    EXPECTED_DESCRIPTORS.performance,
    validateG17PerformanceDecision,
    "performance budget decision",
  );
  const noise = bindDecisionToDescriptor(
    decisions?.noise,
    contract?.noiseDecision,
    EXPECTED_DESCRIPTORS.noise,
    validateG17NoiseDecision,
    "noise budget decision",
  );
  const decisionSetSha256 = g17DecisionSetSha256({
    reference: contract.referenceDecision,
    performance: contract.budgetDecision,
    noise: contract.noiseDecision,
  });
  if (
    decisionSetSha256 !== contract.decisionSetSha256 ||
    decisions?.decisionSetSha256 !== decisionSetSha256
  ) {
    fail("decision-set hash does not verify at the statistics boundary");
  }

  const approvedStates = [
    reference.status === "SELECTED" && reference.approval.status === "APPROVED",
    performance.status === "APPROVED" &&
      performance.approval.status === "APPROVED",
    noise.status === "APPROVED" && noise.approval.status === "APPROVED",
  ];
  const approved = approvedStates.every(Boolean);
  if (!approved && approvedStates.some(Boolean)) {
    fail("decision set mixes approved and proposed decisions");
  }
  if (approved) {
    if (startedAt === undefined) {
      fail("an approved decision set requires the run start timestamp");
    }
    assertG17DecisionApprovalsBefore(
      { reference, performance, noise },
      startedAt,
    );
  }

  return deepFreeze({
    reference,
    performance,
    noise,
    decisionSetSha256,
    approved,
    authority: approved ? "APPROVED_PRE_RESULT" : "DIAGNOSTIC_ONLY",
  });
}

export function assertG17DecisionApprovalsBefore(decisions, startedAt) {
  const runStartedAt = canonicalTimestamp(startedAt, "run startedAt");
  for (const [label, decision] of [
    ["reference decision", decisions?.reference],
    ["performance budget decision", decisions?.performance],
    ["noise budget decision", decisions?.noise],
  ]) {
    if (decision?.approval?.status !== "APPROVED") {
      fail(`${label} is not approved`);
    }
    if (
      canonicalTimestamp(decision.approval.approvedAt, `${label} approvedAt`) >=
      runStartedAt
    ) {
      fail(`${label} was not approved before the run started`);
    }
  }
  return true;
}
