import { isDeepStrictEqual } from "node:util";

import { comparePortablePaths } from "../../../metaharness/policy-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import { classifyG17Qualification } from "./classification.mjs";
import {
  G17_CURRENT_CONTRACT_SHA256,
  G17_LEGACY_V1_CONTRACT_SHA256,
  G17_LEGACY_V3_CONTRACT_SHA256,
  G17_LEGACY_V4_CONTRACT_SHA256,
  G17_LEGACY_V5_CONTRACT_SHA256,
  G17_LEGACY_V6_CONTRACT_SHA256,
} from "./contract-identity.mjs";
import {
  G17_COMPATIBILITY_EVIDENCE_SCHEMA,
  G17_LEGACY_COMPATIBILITY_EVIDENCE_SCHEMAS,
  G17_SEMANTIC_EVIDENCE_SCHEMA,
  g17EvidenceSchemaState,
} from "./evidence-contract.mjs";

export const G17_RECEIPT_SCHEMA = "oxigraph.g1.7-qualification-receipt/v1";

const DIGEST = /^[0-9a-f]{64}$/u;
const GIT_OBJECT = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u;
const SAFE_ARTIFACT = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const EVIDENCE_STATES = new Set([
  "PASS",
  "FAIL",
  "MISSING",
  "STALE",
  "NOISY",
  "INCONCLUSIVE",
  "NOT_RUN",
]);
const VERDICTS = new Set(["ACCEPT", "REJECT", "INCONCLUSIVE"]);
const AUTHORITY = Object.freeze({
  localOnly: true,
  promotionAuthority: false,
  routerQualityAuthority: false,
  publicationAuthority: false,
});
const DRAFT_KEYS = Object.freeze([
  "run",
  "contract",
  "identity",
  "evidence",
  "benchmark",
  "final",
  "artifacts",
]);
const RECEIPT_KEYS = Object.freeze([
  "schema",
  "run",
  "contract",
  "identity",
  "evidence",
  "benchmark",
  "authority",
  "final",
  "artifacts",
  "contentHash",
  "executionHash",
  "receiptSha256",
]);

function fail(message) {
  throw new Error(`G1.7 qualification receipt: ${message}`);
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail(`${label} fields are not exact`);
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function canonicalClone(value, label) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch (error) {
    fail(`${label} is not canonical JSON: ${error.message}`);
  }
}

function timestamp(value, label) {
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

function status(value, label) {
  if (!EVIDENCE_STATES.has(value)) fail(`${label} status is invalid`);
}

function validateRun(run) {
  exactKeys(run, ["id", "startedAt", "finishedAt"], "run");
  if (!SAFE_ID.test(run.id)) fail("run id is unsafe");
  if (
    timestamp(run.finishedAt, "finishedAt") <
    timestamp(run.startedAt, "startedAt")
  ) {
    fail("run finished before it started");
  }
}

function validateContractProjection(contract) {
  exactKeys(
    contract,
    [
      "id",
      "sha256",
      "suiteHash",
      "referenceDecision",
      "budgetDecision",
      "noiseDecision",
    ],
    "contract projection",
  );
  if (contract.id !== "g1.7-compatibility-performance-qualification") {
    fail("contract id drifted");
  }
  if (!DIGEST.test(contract.sha256) || !DIGEST.test(contract.suiteHash)) {
    fail("contract digest is malformed");
  }
  const supportsDecisionProtocol = [
    G17_LEGACY_V4_CONTRACT_SHA256,
    G17_LEGACY_V5_CONTRACT_SHA256,
    G17_LEGACY_V6_CONTRACT_SHA256,
    G17_CURRENT_CONTRACT_SHA256,
  ].includes(contract.sha256);
  if (
    !(
      supportsDecisionProtocol
        ? ["SELECTED", "UNSELECTED", "PROPOSED"]
        : ["SELECTED", "UNSELECTED"]
    ).includes(contract.referenceDecision)
  ) {
    fail("reference decision is invalid");
  }
  const budgetDecisionStates = supportsDecisionProtocol
    ? ["APPROVED", "ABSENT", "PROPOSED"]
    : ["APPROVED", "ABSENT"];
  if (!budgetDecisionStates.includes(contract.budgetDecision)) {
    fail("performance budget decision is invalid");
  }
  if (!budgetDecisionStates.includes(contract.noiseDecision)) {
    fail("noise budget decision is invalid");
  }
  return supportsDecisionProtocol;
}

function validateIdentity(identity, { currentV7 }) {
  exactKeys(
    identity,
    currentV7
      ? [
          "schema",
          "subjectCommit",
          "subjectTree",
          "controlCommit",
          "harnessSha256",
          "evaluatorCommit",
          "evaluatorBlobSha256",
          "identitySha256",
        ]
      : [
          "schema",
          "subjectCommit",
          "subjectTree",
          "harnessSha256",
          "evaluatorCommit",
          "evaluatorBlobSha256",
          "identitySha256",
        ],
    "identity",
  );
  if (
    identity.schema !==
      (currentV7
        ? "oxigraph.g1.7-qualification-identity/v2"
        : "oxigraph.g1.7-qualification-identity/v1") ||
    !GIT_OBJECT.test(identity.subjectCommit ?? "") ||
    !GIT_OBJECT.test(identity.subjectTree ?? "") ||
    (currentV7 && !GIT_OBJECT.test(identity.controlCommit ?? "")) ||
    !DIGEST.test(identity.harnessSha256 ?? "") ||
    !GIT_OBJECT.test(identity.evaluatorCommit ?? "") ||
    !DIGEST.test(identity.evaluatorBlobSha256 ?? "") ||
    !DIGEST.test(identity.identitySha256 ?? "")
  ) {
    fail("identity projection is invalid");
  }
}

function validateEvidence(
  evidence,
  { requireCurrentPassSchemas = false } = {},
) {
  exactKeys(evidence, ["semantic", "compatibility"], "evidence");
  const currentSchemas = {
    semantic: G17_SEMANTIC_EVIDENCE_SCHEMA,
    compatibility: G17_COMPATIBILITY_EVIDENCE_SCHEMA,
  };
  const supportedSchemas = {
    semantic: new Set([G17_SEMANTIC_EVIDENCE_SCHEMA]),
    compatibility: new Set([
      G17_COMPATIBILITY_EVIDENCE_SCHEMA,
      ...G17_LEGACY_COMPATIBILITY_EVIDENCE_SCHEMAS,
    ]),
  };
  for (const label of ["semantic", "compatibility"]) {
    const entry = evidence[label];
    exactKeys(
      entry,
      ["status", "sha256", "reasons", "projection"],
      `${label} evidence`,
    );
    status(entry.status, label);
    if (
      !(entry.sha256 === null || DIGEST.test(entry.sha256)) ||
      !Array.isArray(entry.reasons) ||
      entry.reasons.some(
        (reason) => typeof reason !== "string" || reason.length === 0,
      ) ||
      !(
        entry.projection === null ||
        (typeof entry.projection === "object" &&
          !Array.isArray(entry.projection))
      )
    ) {
      fail(`${label} evidence is malformed`);
    }
    if (
      entry.projection !== null &&
      (entry.sha256 !== canonicalSha256(entry.projection) ||
        entry.projection.status !== entry.status)
    ) {
      fail(`${label} evidence projection is not hash-bound`);
    }
    if (
      entry.status === "PASS" &&
      (entry.projection === null ||
        !DIGEST.test(entry.sha256 ?? "") ||
        entry.reasons.length !== 0)
    ) {
      fail(`${label} PASS evidence requires a hash-bound projection`);
    }
    if (
      entry.projection?.schema !== undefined &&
      !supportedSchemas[label].has(entry.projection.schema)
    ) {
      fail(`${label} evidence projection schema is unsupported`);
    }
    if (
      requireCurrentPassSchemas &&
      entry.status === "PASS" &&
      entry.projection.schema !== currentSchemas[label]
    ) {
      fail(`${label} PASS evidence requires its current projection schema`);
    }
    if (entry.status !== "PASS" && entry.reasons.length === 0) {
      fail(`${label} non-PASS evidence requires a reason`);
    }
  }
}

function validateBenchmark(benchmark, { currentV4 }) {
  exactKeys(
    benchmark,
    [
      "status",
      "sampleCount",
      "samplesSha256",
      "summarySha256",
      "budgetBreaches",
    ],
    "benchmark",
  );
  status(benchmark.status, "benchmark");
  if (
    !Number.isSafeInteger(benchmark.sampleCount) ||
    benchmark.sampleCount < 0
  ) {
    fail("benchmark sampleCount is invalid");
  }
  for (const key of ["samplesSha256", "summarySha256"]) {
    if (!(benchmark[key] === null || DIGEST.test(benchmark[key]))) {
      fail(`benchmark ${key} is invalid`);
    }
  }
  if (
    !Array.isArray(benchmark.budgetBreaches) ||
    benchmark.budgetBreaches.some(
      (value) => typeof value !== "string" || value.length === 0,
    )
  ) {
    fail("benchmark budget breach inventory is invalid");
  }
  if (
    benchmark.status === "NOT_RUN" &&
    (benchmark.sampleCount !== 0 ||
      benchmark.samplesSha256 !== null ||
      benchmark.summarySha256 !== null)
  ) {
    fail("not-run benchmark contains execution evidence");
  }
  const executed = ["PASS", "FAIL", "NOISY"].includes(benchmark.status);
  if (
    executed &&
    (benchmark.sampleCount < 1 ||
      !DIGEST.test(benchmark.samplesSha256 ?? "") ||
      !DIGEST.test(benchmark.summarySha256 ?? ""))
  ) {
    fail("executed benchmark requires samples and summary digests");
  }
  if (
    !executed &&
    benchmark.status !== "NOT_RUN" &&
    (benchmark.sampleCount !== 0 ||
      benchmark.samplesSha256 !== null ||
      benchmark.summarySha256 !== null)
  ) {
    fail("unexecuted benchmark contains execution evidence");
  }
  if (
    (currentV4 ? benchmark.status !== "FAIL" : benchmark.status === "PASS") &&
    benchmark.budgetBreaches.length !== 0
  ) {
    fail("only a failing benchmark may contain budget breaches");
  }
}

function validateFinal(final, receipt, { currentV4 }) {
  exactKeys(final, ["verdict", "reasons"], "final classification");
  if (!VERDICTS.has(final.verdict)) fail("final verdict is invalid");
  if (
    !Array.isArray(final.reasons) ||
    final.reasons.some(
      (reason) => typeof reason !== "string" || reason.length === 0,
    )
  ) {
    fail("final reasons are invalid");
  }
  const classified = classifyG17Qualification(
    {
      semantic: { status: receipt.evidence.semantic.status },
      compatibility: { status: receipt.evidence.compatibility.status },
      benchmark: {
        status: receipt.benchmark.status,
        budgetBreaches: receipt.benchmark.budgetBreaches,
      },
      referenceDecision: { status: receipt.contract.referenceDecision },
      budgetDecision: { status: receipt.contract.budgetDecision },
      noiseDecision: { status: receipt.contract.noiseDecision },
    },
    { currentV4 },
  );
  if (!isDeepStrictEqual(final, classified)) {
    fail("classification does not match sealed evidence");
  }
}

function validateArtifacts(artifacts) {
  // The sealed directory ceiling is 64 total files and receipt.json is written
  // separately, leaving at most 63 receipt-listed artifacts.
  if (
    !Array.isArray(artifacts) ||
    artifacts.length < 1 ||
    artifacts.length > 63
  ) {
    fail("artifact inventory size is invalid");
  }
  const names = new Set();
  let previous = "";
  let totalBytes = 0;
  for (const [index, artifact] of artifacts.entries()) {
    exactKeys(artifact, ["name", "bytes", "sha256"], `artifact ${index}`);
    if (
      !SAFE_ARTIFACT.test(artifact.name) ||
      names.has(artifact.name) ||
      comparePortablePaths(artifact.name, previous) <= 0 ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 1 ||
      !DIGEST.test(artifact.sha256)
    ) {
      fail("artifact inventory is invalid");
    }
    names.add(artifact.name);
    previous = artifact.name;
    totalBytes += artifact.bytes;
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes > 67_108_864) {
    fail("artifact inventory exceeds its byte ceiling");
  }
}

function contentProjection(receipt) {
  return {
    schema: receipt.schema,
    contract: receipt.contract,
    identity: receipt.identity,
    evidence: receipt.evidence,
    benchmark: receipt.benchmark,
    authority: receipt.authority,
    final: receipt.final,
    artifacts: receipt.artifacts,
  };
}

function executionProjection(receipt) {
  return {
    contentHash: receipt.contentHash,
    run: receipt.run,
  };
}

function receiptProjection(receipt) {
  return {
    schema: receipt.schema,
    run: receipt.run,
    contract: receipt.contract,
    identity: receipt.identity,
    evidence: receipt.evidence,
    benchmark: receipt.benchmark,
    authority: receipt.authority,
    final: receipt.final,
    artifacts: receipt.artifacts,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
  };
}

function validateStructure(receipt, options) {
  exactKeys(receipt, RECEIPT_KEYS, "receipt");
  if (receipt.schema !== G17_RECEIPT_SCHEMA) fail("schema is not v1");
  validateRun(receipt.run);
  const supportsDecisionProtocol = validateContractProjection(receipt.contract);
  validateIdentity(receipt.identity, {
    currentV7: receipt.contract.sha256 === G17_CURRENT_CONTRACT_SHA256,
  });
  validateEvidence(receipt.evidence, options);
  validateBenchmark(receipt.benchmark, {
    currentV4: supportsDecisionProtocol,
  });
  if (!isDeepStrictEqual(receipt.authority, AUTHORITY))
    fail("authority drifted");
  validateFinal(receipt.final, receipt, {
    currentV4: supportsDecisionProtocol,
  });
  validateArtifacts(receipt.artifacts);
  if (
    receipt.contentHash !== canonicalSha256(contentProjection(receipt)) ||
    receipt.executionHash !== canonicalSha256(executionProjection(receipt)) ||
    receipt.receiptSha256 !== canonicalSha256(receiptProjection(receipt))
  ) {
    fail("hash contract failed");
  }
  return receipt;
}

export function createG17Receipt(draft) {
  exactKeys(draft, DRAFT_KEYS, "receipt draft");
  const cloned = canonicalClone(draft, "receipt draft");
  const receipt = {
    schema: G17_RECEIPT_SCHEMA,
    run: cloned.run,
    contract: cloned.contract,
    identity: cloned.identity,
    evidence: cloned.evidence,
    benchmark: cloned.benchmark,
    authority: { ...AUTHORITY },
    final: cloned.final,
    artifacts: cloned.artifacts,
  };
  receipt.contentHash = canonicalSha256(contentProjection(receipt));
  receipt.executionHash = canonicalSha256(executionProjection(receipt));
  receipt.receiptSha256 = canonicalSha256(receiptProjection(receipt));
  return deepFreeze(
    validateStructure(receipt, { requireCurrentPassSchemas: true }),
  );
}

export function g17ReceiptBytes(receipt) {
  validateStructure(receipt);
  return Buffer.from(`${canonicalJson(receipt)}\n`, "utf8");
}

export function verifyG17Receipt(input) {
  try {
    const bytes =
      typeof input === "string" || Buffer.isBuffer(input)
        ? Buffer.from(input)
        : null;
    const receipt = bytes === null ? input : JSON.parse(bytes.toString("utf8"));
    const verified = deepFreeze(validateStructure(receipt));
    if (bytes !== null && !bytes.equals(g17ReceiptBytes(verified))) {
      fail("serialized bytes are not canonical");
    }
    const evidenceSchemaState = Object.freeze({
      semantic: g17EvidenceSchemaState(
        verified.evidence.semantic,
        G17_SEMANTIC_EVIDENCE_SCHEMA,
      ),
      compatibility: g17EvidenceSchemaState(
        verified.evidence.compatibility,
        G17_COMPATIBILITY_EVIDENCE_SCHEMA,
      ),
    });
    const legacyReplayOnly =
      [
        G17_LEGACY_V1_CONTRACT_SHA256,
        G17_LEGACY_V3_CONTRACT_SHA256,
        G17_LEGACY_V4_CONTRACT_SHA256,
        G17_LEGACY_V5_CONTRACT_SHA256,
        G17_LEGACY_V6_CONTRACT_SHA256,
      ].includes(verified.contract.sha256) ||
      Object.values(evidenceSchemaState).includes("LEGACY_REPLAY_ONLY");
    return Object.freeze({
      ok: !legacyReplayOnly,
      structurallyValid: true,
      verificationStatus: legacyReplayOnly
        ? "LEGACY_REPLAY_ONLY"
        : "STRUCTURALLY_VALID",
      qualificationEligible: false,
      evidenceSchemaState,
      receipt: verified,
      contentHash: verified.contentHash,
      executionHash: verified.executionHash,
      receiptSha256: verified.receiptSha256,
    });
  } catch (error) {
    if (error.message.startsWith("G1.7 qualification receipt:")) throw error;
    fail(error.message);
  }
}
