import { createHash } from "node:crypto";

import {
  agenticProjectionFromQualificationBinding,
  agenticProjectionValid,
  agenticQualificationBindingValid,
} from "./agentic-binding.mjs";
import {
  mutationProjectionFromQualificationBinding,
  mutationProjectionValid,
  mutationQualificationBindingValid,
} from "./mutation-contract.mjs";
import {
  comparePortablePaths,
  mutablePolicy,
  protectedInputs,
} from "./policy-contract.mjs";

const DIGEST = /^[0-9a-f]{64}$/u;
const EXACT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const QUALIFICATION_KEYS = Object.freeze([
  "schemaVersion",
  "qualification",
  "darwinVersion",
  "mode",
  "runtime",
  "startedAt",
  "finishedAt",
  "policyBoundary",
  "inputs",
  "synthetic",
  "safety",
  "mutation",
  "realGate",
  "gates",
  "passed",
  "contentHash",
]);
const REAL_GATE_KEYS = Object.freeze([
  "taskId",
  "exitCode",
  "timedOut",
  "blockedActions",
  "durationMs",
  "stdoutHash",
  "stderrHash",
  "agenticReceipt",
  "receiptError",
  "passed",
]);
const QUALIFICATION_GATE_KEYS = Object.freeze([
  "solve",
  "regression",
  "safety",
  "cost",
  "reproducibility",
]);
const VERIFICATION_KEYS = Object.freeze([
  "schemaVersion",
  "verified",
  "qualification",
  "protectedContentHash",
  "darwinContentHash",
  "mutation",
  "agentic",
  "contentHash",
]);
const RUNTIME_KEYS = Object.freeze(["node", "platform", "architecture"]);
const NODE_KEYS = Object.freeze([
  "invokedPath",
  "path",
  "version",
  "executableSha256",
]);
const POLICY_BOUNDARY_KEYS = Object.freeze(["mutable", "protectedInputs"]);
const INPUT_KEYS = Object.freeze([
  "before",
  "after",
  "changedPaths",
  "protectedInputsStable",
  "darwin",
  "implementationStable",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "algorithm",
  "contentHash",
  "fileCount",
  "roots",
  "files",
]);
const FILE_KEYS = Object.freeze(["path", "kind", "sha256", "bytes"]);
const SYMLINK_KEYS = Object.freeze([
  "path",
  "kind",
  "linkTarget",
  "target",
  "sha256",
  "bytes",
]);
const DARWIN_WRAPPER_KEYS = Object.freeze(["before", "after", "stable"]);
const DARWIN_KEYS = Object.freeze([
  "name",
  "policy",
  "version",
  "resolved",
  "integrity",
  "manifest",
  "manifestSha256",
  "lockfile",
  "lockfileSha256",
  "npmrc",
  "npmrcSha256",
  "path",
  "entry",
  "packageJsonSha256",
  "entrySha256",
  "contentHash",
  "fileCount",
]);
const SYNTHETIC_KEYS = Object.freeze([
  "seed",
  "generations",
  "childrenPerGeneration",
  "first",
  "second",
  "projectionHash",
  "replayProjectionHash",
]);
const SYNTHETIC_SUMMARY_KEYS = Object.freeze([
  "baseline",
  "winner",
  "recordCount",
  "promotedCount",
]);
const SYNTHETIC_SCORE_KEYS = Object.freeze([
  "finalScore",
  "testPassRate",
  "safetyScore",
]);
const SAFETY_KEYS = Object.freeze([
  "directoryBlocked",
  "generatedCodeBlocked",
  "directoryFindingCount",
  "codeFindingCount",
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactOrderedKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value)) === JSON.stringify(keys)
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function portableRelativePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  return path
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function runtimeValid(runtime) {
  return (
    exactOrderedKeys(runtime, RUNTIME_KEYS) &&
    exactOrderedKeys(runtime.node, NODE_KEYS) &&
    [runtime.node.invokedPath, runtime.node.path, runtime.node.version].every(
      (value) => typeof value === "string" && value.length > 0,
    ) &&
    DIGEST.test(runtime.node.executableSha256 ?? "") &&
    typeof runtime.platform === "string" &&
    runtime.platform.length > 0 &&
    typeof runtime.architecture === "string" &&
    runtime.architecture.length > 0
  );
}

function policyBoundaryValid(boundary) {
  return (
    exactOrderedKeys(boundary, POLICY_BOUNDARY_KEYS) &&
    sameJson(boundary.mutable, mutablePolicy) &&
    sameJson(boundary.protectedInputs, protectedInputs)
  );
}

function snapshotRecordValid(record) {
  const keys = record?.kind === "symlink" ? SYMLINK_KEYS : FILE_KEYS;
  return (
    exactOrderedKeys(record, keys) &&
    portableRelativePath(record.path) &&
    (record.kind === "file" ||
      (record.kind === "symlink" &&
        typeof record.linkTarget === "string" &&
        record.linkTarget.length > 0 &&
        portableRelativePath(record.target))) &&
    typeof record.sha256 === "string" &&
    DIGEST.test(record.sha256) &&
    Number.isSafeInteger(record.bytes) &&
    record.bytes >= 0
  );
}

function protectedSnapshotValid(snapshot) {
  if (
    !exactOrderedKeys(snapshot, SNAPSHOT_KEYS) ||
    snapshot.algorithm !== "sha256" ||
    !DIGEST.test(snapshot.contentHash ?? "") ||
    !Number.isSafeInteger(snapshot.fileCount) ||
    snapshot.fileCount < 1 ||
    !sameJson(snapshot.roots, protectedInputs) ||
    !Array.isArray(snapshot.files) ||
    snapshot.fileCount !== snapshot.files.length ||
    !snapshot.files.every(snapshotRecordValid)
  ) {
    return false;
  }
  for (let index = 1; index < snapshot.files.length; index += 1) {
    if (
      comparePortablePaths(
        snapshot.files[index - 1].path,
        snapshot.files[index].path,
      ) >= 0
    ) {
      return false;
    }
  }
  return snapshot.contentHash === sha256(JSON.stringify(snapshot.files));
}

function exactVersionValid(value) {
  const match = typeof value === "string" ? EXACT_SEMVER.exec(value) : null;
  return (
    match !== null &&
    !(
      match[4] !== undefined &&
      match[4]
        .split(".")
        .some((part) => /^\d+$/u.test(part) && part.length > 1 && part[0] === "0")
    )
  );
}

function sha512IntegrityValid(value) {
  if (typeof value !== "string" || !value.startsWith("sha512-")) return false;
  const encoded = value.slice("sha512-".length);
  const digest = Buffer.from(encoded, "base64");
  return digest.length === 64 && digest.toString("base64") === encoded;
}

function darwinDependencyValid(value, expected) {
  const expectedResolved =
    `https://registry.npmjs.org/@metaharness/darwin/-/` +
    `darwin-${value?.version}.tgz`;
  if (
    !exactOrderedKeys(value, DARWIN_KEYS) ||
    value.name !== "@metaharness/darwin" ||
    value.policy !== "latest" ||
    !exactVersionValid(value.version) ||
    value.resolved !== expectedResolved ||
    !sha512IntegrityValid(value.integrity) ||
    ![
      value.manifestSha256,
      value.lockfileSha256,
      value.npmrcSha256,
      value.packageJsonSha256,
      value.entrySha256,
      value.contentHash,
    ].every((digest) => DIGEST.test(digest ?? "")) ||
    ![value.manifest, value.lockfile, value.npmrc, value.path, value.entry].every(
      portableRelativePath,
    ) ||
    !Number.isSafeInteger(value.fileCount) ||
    value.fileCount < 1
  ) {
    return false;
  }
  return (
    expected === undefined ||
    (expected?.name === value.name &&
      expected.policy === value.policy &&
      expected.version === value.version &&
      expected.resolved === value.resolved &&
      expected.integrity === value.integrity &&
      expected.installedPackageJsonSha256 === value.packageJsonSha256)
  );
}

function qualificationInputsValid(receipt, expectedDarwinDependency) {
  const inputs = receipt.inputs;
  return (
    exactOrderedKeys(inputs, INPUT_KEYS) &&
    protectedSnapshotValid(inputs.before) &&
    protectedSnapshotValid(inputs.after) &&
    sameJson(inputs.before, inputs.after) &&
    Array.isArray(inputs.changedPaths) &&
    inputs.changedPaths.length === 0 &&
    inputs.protectedInputsStable === true &&
    exactOrderedKeys(inputs.darwin, DARWIN_WRAPPER_KEYS) &&
    inputs.darwin.stable === true &&
    sameJson(inputs.darwin.before, inputs.darwin.after) &&
    darwinDependencyValid(inputs.darwin.before, expectedDarwinDependency) &&
    inputs.darwin.before.version === receipt.darwinVersion &&
    inputs.implementationStable === true
  );
}

function syntheticScoreValid(score) {
  return (
    exactOrderedKeys(score, SYNTHETIC_SCORE_KEYS) &&
    Number.isFinite(score.finalScore) &&
    Number.isFinite(score.testPassRate) &&
    score.testPassRate >= 0 &&
    score.testPassRate <= 1 &&
    Number.isFinite(score.safetyScore) &&
    score.safetyScore >= 0 &&
    score.safetyScore <= 1
  );
}

function syntheticSummaryValid(summary) {
  return (
    exactOrderedKeys(summary, SYNTHETIC_SUMMARY_KEYS) &&
    syntheticScoreValid(summary.baseline) &&
    syntheticScoreValid(summary.winner) &&
    Number.isSafeInteger(summary.recordCount) &&
    summary.recordCount > 0 &&
    summary.recordCount <= 7 &&
    Number.isSafeInteger(summary.promotedCount) &&
    summary.promotedCount >= 0 &&
    summary.promotedCount <= summary.recordCount &&
    summary.winner.testPassRate >= summary.baseline.testPassRate &&
    summary.winner.safetyScore === 1
  );
}

function syntheticEvidenceValid(synthetic) {
  return (
    exactOrderedKeys(synthetic, SYNTHETIC_KEYS) &&
    synthetic.seed === 12026 &&
    synthetic.generations === 2 &&
    synthetic.childrenPerGeneration === 2 &&
    syntheticSummaryValid(synthetic.first) &&
    sameJson(synthetic.first, synthetic.second) &&
    DIGEST.test(synthetic.projectionHash ?? "") &&
    synthetic.projectionHash === synthetic.replayProjectionHash
  );
}

function safetyEvidenceValid(safety) {
  return (
    exactOrderedKeys(safety, SAFETY_KEYS) &&
    safety.directoryBlocked === true &&
    safety.generatedCodeBlocked === true &&
    Number.isSafeInteger(safety.directoryFindingCount) &&
    safety.directoryFindingCount > 0 &&
    Number.isSafeInteger(safety.codeFindingCount) &&
    safety.codeFindingCount > 0
  );
}

function strictIsoTimestampMs(value) {
  if (typeof value !== "string") return NaN;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? parsed
    : NaN;
}

export function qualificationContentHash(receipt) {
  const realGate = receipt.realGate;
  return sha256(
    JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      qualification: receipt.qualification,
      darwinVersion: receipt.darwinVersion,
      mode: receipt.mode,
      startedAt: receipt.startedAt,
      finishedAt: receipt.finishedAt,
      runtime: receipt.runtime,
      policyBoundary: receipt.policyBoundary,
      inputs: receipt.inputs,
      synthetic: receipt.synthetic,
      safety: receipt.safety,
      mutation: receipt.mutation,
      realGate:
        realGate === null
          ? null
          : {
              taskId: realGate.taskId,
              exitCode: realGate.exitCode,
              timedOut: realGate.timedOut,
              blockedActions: realGate.blockedActions,
              durationMs: realGate.durationMs,
              stdoutHash: realGate.stdoutHash,
              stderrHash: realGate.stderrHash,
              agenticReceipt: realGate.agenticReceipt,
              receiptError: realGate.receiptError,
              passed: realGate.passed,
            },
      gates: receipt.gates,
      passed: receipt.passed,
    }),
  );
}

export function trustedRealGateValid(
  realGate,
  { timeoutMs = 1_200_000 } = {},
) {
  return (
    realGate !== null &&
    typeof realGate === "object" &&
    !Array.isArray(realGate) &&
    JSON.stringify(Object.keys(realGate)) === JSON.stringify(REAL_GATE_KEYS) &&
    typeof realGate.taskId === "string" &&
    realGate.taskId.length > 0 &&
    realGate.exitCode === 0 &&
    realGate.timedOut === false &&
    Array.isArray(realGate.blockedActions) &&
    realGate.blockedActions.length === 0 &&
    Number.isFinite(timeoutMs) &&
    timeoutMs >= 0 &&
    Number.isFinite(realGate.durationMs) &&
    realGate.durationMs >= 0 &&
    realGate.durationMs <= timeoutMs &&
    DIGEST.test(realGate.stdoutHash ?? "") &&
    DIGEST.test(realGate.stderrHash ?? "") &&
    agenticQualificationBindingValid(realGate.agenticReceipt) &&
    realGate.receiptError === null &&
    realGate.passed === true
  );
}

export function validateQualificationReceipt(
  receipt,
  {
    expectedDarwinVersion,
    expectedDarwinDependency,
    requireFull = true,
    strictNested = false,
  },
) {
  const startedAt = strictIsoTimestampMs(receipt?.startedAt);
  const finishedAt = strictIsoTimestampMs(receipt?.finishedAt);
  const agenticGeneratedAt = strictIsoTimestampMs(
    receipt?.realGate?.agenticReceipt?.generatedAt,
  );
  const fullMode = receipt?.mode === "synthetic-and-semantic-gate";
  const syntheticMode = receipt?.mode === "synthetic-only";
  if (
    !exactOrderedKeys(receipt, QUALIFICATION_KEYS) ||
    receipt.schemaVersion !== 2 ||
    receipt.qualification !== "oxigraph-policy-only-darwin" ||
    receipt.darwinVersion !== expectedDarwinVersion ||
    (!fullMode && !syntheticMode) ||
    (requireFull && !fullMode) ||
    receipt.passed !== true ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(finishedAt) ||
    finishedAt < startedAt ||
    receipt.inputs?.protectedInputsStable !== true ||
    receipt.inputs?.implementationStable !== true ||
    receipt.inputs?.darwin?.stable !== true ||
    receipt.inputs?.before?.contentHash !== receipt.inputs?.after?.contentHash ||
    !Array.isArray(receipt.inputs?.changedPaths) ||
    receipt.inputs.changedPaths.length !== 0 ||
    receipt.synthetic?.projectionHash !==
      receipt.synthetic?.replayProjectionHash ||
    receipt.safety?.directoryBlocked !== true ||
    receipt.safety?.generatedCodeBlocked !== true ||
    receipt.gates === null ||
    typeof receipt.gates !== "object" ||
    Array.isArray(receipt.gates) ||
    JSON.stringify(Object.keys(receipt.gates)) !==
      JSON.stringify(QUALIFICATION_GATE_KEYS) ||
    QUALIFICATION_GATE_KEYS.some((gate) => receipt.gates[gate] !== true) ||
    (fullMode &&
      (!mutationQualificationBindingValid(receipt.mutation) ||
        !trustedRealGateValid(receipt.realGate) ||
        !Number.isFinite(agenticGeneratedAt) ||
        agenticGeneratedAt < startedAt ||
        agenticGeneratedAt > finishedAt)) ||
    (syntheticMode &&
      (receipt.mutation !== null || receipt.realGate !== null)) ||
    (strictNested &&
      (!runtimeValid(receipt.runtime) ||
        !policyBoundaryValid(receipt.policyBoundary) ||
        !qualificationInputsValid(receipt, expectedDarwinDependency) ||
        !syntheticEvidenceValid(receipt.synthetic) ||
        !safetyEvidenceValid(receipt.safety))) ||
    receipt.contentHash !== qualificationContentHash(receipt)
  ) {
    throw new Error("Darwin qualification receipt failed its hash or gate contract");
  }
  return receipt;
}

export function verificationContentHash(receipt) {
  return sha256(
    JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      verified: receipt.verified,
      qualification: receipt.qualification,
      protectedContentHash: receipt.protectedContentHash,
      darwinContentHash: receipt.darwinContentHash,
      mutation: receipt.mutation,
      agentic: receipt.agentic,
    }),
  );
}

export function validateVerificationReceipt(
  receipt,
  {
    qualification,
    protectedContentHash,
    darwinContentHash,
    mutation,
    agentic,
  },
) {
  if (
    !exactOrderedKeys(receipt, VERIFICATION_KEYS) ||
    receipt.schemaVersion !== 1 ||
    receipt.verified !== true ||
    !DIGEST.test(receipt.qualification?.sha256 ?? "") ||
    !DIGEST.test(receipt.qualification?.contentHash ?? "") ||
    !DIGEST.test(receipt.protectedContentHash ?? "") ||
    !DIGEST.test(receipt.darwinContentHash ?? "") ||
    !mutationProjectionValid(receipt.mutation) ||
    !agenticProjectionValid(receipt.agentic) ||
    JSON.stringify(receipt.qualification) !== JSON.stringify(qualification) ||
    receipt.protectedContentHash !== protectedContentHash ||
    receipt.darwinContentHash !== darwinContentHash ||
    JSON.stringify(receipt.mutation) !== JSON.stringify(mutation) ||
    JSON.stringify(receipt.agentic) !== JSON.stringify(agentic) ||
    receipt.contentHash !== verificationContentHash(receipt)
  ) {
    throw new Error("Darwin verification receipt failed its evidence bindings");
  }
  return receipt;
}

export function qualificationReceiptBytes(receipt) {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export function verificationReceiptBytes(receipt) {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export function verificationFromQualification(qualification, qualificationBytes) {
  const verification = {
    schemaVersion: 1,
    verified: true,
    qualification: {
      path: "target/metaharness/qualification.json",
      sha256: sha256(qualificationBytes),
      contentHash: qualification.contentHash,
    },
    protectedContentHash: qualification.inputs.after.contentHash,
    darwinContentHash: qualification.inputs.darwin.after.contentHash,
    mutation: mutationProjectionFromQualificationBinding(
      qualification.mutation,
    ),
    agentic: agenticProjectionFromQualificationBinding(
      qualification.realGate.agenticReceipt,
    ),
  };
  verification.contentHash = verificationContentHash(verification);
  return verification;
}

export function validateSemanticEvidencePair({
  qualification,
  qualificationBytes,
  verification,
  verificationBytes,
  expectedDarwinVersion,
  expectedDarwinDependency,
  maximumFinishedAtMs = Number.POSITIVE_INFINITY,
}) {
  if (
    !Buffer.isBuffer(qualificationBytes) ||
    !Buffer.isBuffer(verificationBytes) ||
    !qualificationBytes.equals(qualificationReceiptBytes(qualification)) ||
    !verificationBytes.equals(verificationReceiptBytes(verification))
  ) {
    throw new Error("MetaHarness receipt serialization drifted");
  }
  validateQualificationReceipt(qualification, {
    expectedDarwinVersion,
    expectedDarwinDependency,
    requireFull: true,
    strictNested: true,
  });
  const finishedAtMs = strictIsoTimestampMs(qualification.finishedAt);
  if (
    !(
      Number.isFinite(maximumFinishedAtMs) ||
      maximumFinishedAtMs === Number.POSITIVE_INFINITY
    ) ||
    finishedAtMs > maximumFinishedAtMs
  ) {
    throw new Error("MetaHarness qualification chronology is invalid");
  }
  const expected = verificationFromQualification(
    qualification,
    qualificationBytes,
  );
  validateVerificationReceipt(verification, {
    qualification: expected.qualification,
    protectedContentHash: expected.protectedContentHash,
    darwinContentHash: expected.darwinContentHash,
    mutation: expected.mutation,
    agentic: expected.agentic,
  });
  if (JSON.stringify(verification) !== JSON.stringify(expected)) {
    throw new Error("MetaHarness verification is not derived from qualification");
  }
  return {
    status: "PASS",
    qualification: {
      sha256: sha256(qualificationBytes),
      contentHash: qualification.contentHash,
      mode: qualification.mode,
      darwinVersion: qualification.darwinVersion,
    },
    verification: {
      sha256: sha256(verificationBytes),
      contentHash: expected.contentHash,
      protectedContentHash: expected.protectedContentHash,
      darwinContentHash: expected.darwinContentHash,
    },
  };
}
