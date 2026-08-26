import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import { validateG17Contract } from "./contract.mjs";
import { verifyG17Receipt } from "./receipt.mjs";
import {
  g17RunsRoot,
  openSealedG17Run,
} from "./storage.mjs";

function fail(message) {
  throw new Error(`G1.7 sealed verification: ${message}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseCanonical(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail(`${label} is not canonical JSON`);
  }
  return value;
}

function sealedIdentityProjection(identity) {
  const binding = {
    schema: identity?.schema,
    subject: identity?.subject,
    control: identity?.control,
    evaluator: identity?.evaluator,
    cargoLock: identity?.cargoLock,
    toolchain: identity?.toolchain,
    host: identity?.host,
  };
  if (
    identity?.schema !== "oxigraph.g1.7-qualified-subject-identity/v1" ||
    identity.identitySha256 !== canonicalSha256(binding)
  ) {
    fail("sealed subject identity hash is invalid");
  }
  return {
    schema: "oxigraph.g1.7-qualification-identity/v1",
    subjectCommit: identity.subject.commit,
    subjectTree: identity.subject.tree,
    harnessSha256: identity.control.harnessSha256,
    evaluatorCommit: identity.evaluator.commit,
    evaluatorBlobSha256: identity.evaluator.blobSetSha256,
    identitySha256: identity.identitySha256,
  };
}

function requireArtifact(bytesByName, name, message) {
  if (!bytesByName.has(name)) fail(message);
}

function verifyEvidenceArtifactInventory(receipt, bytesByName) {
  if (receipt.evidence.compatibility.status === "PASS") {
    requireArtifact(
      bytesByName,
      "agentic-receipt.json",
      "compatibility PASS artifacts are incomplete",
    );
    requireArtifact(
      bytesByName,
      "agentic-oracle.json",
      "compatibility PASS artifacts are incomplete",
    );
    const archiveCount = receipt.evidence.compatibility.projection?.agenticQe?.archiveFileCount;
    if (!Number.isSafeInteger(archiveCount) || archiveCount < 1) {
      fail("compatibility PASS archive inventory is invalid");
    }
    for (let index = 0; index < archiveCount; index += 1) {
      requireArtifact(
        bytesByName,
        `agentic-archive-${String(index).padStart(4, "0")}.bin`,
        "compatibility PASS artifacts are incomplete",
      );
    }
  }

  if (receipt.evidence.semantic.status === "PASS") {
    requireArtifact(
      bytesByName,
      "semantic-qualification.json",
      "semantic PASS artifacts are incomplete",
    );
    requireArtifact(
      bytesByName,
      "semantic-verification.json",
      "semantic PASS artifacts are incomplete",
    );
  }

  if (["PASS", "FAIL", "NOISY"].includes(receipt.benchmark.status)) {
    requireArtifact(
      bytesByName,
      "benchmark-samples.json",
      "executed benchmark artifacts are incomplete",
    );
    requireArtifact(
      bytesByName,
      "benchmark-summary.json",
      "executed benchmark artifacts are incomplete",
    );
  }
}

export async function verifySealedG17Run({
  runId,
  runsRoot = g17RunsRoot,
} = {}) {
  const run = await openSealedG17Run({ runId, runsRoot });
  const receiptBytes = await run.read("receipt.json");
  const { receipt } = verifyG17Receipt(receiptBytes);
  const expectedEntries = [
    ...receipt.artifacts.map(({ name }) => name),
    "receipt.json",
  ].sort();
  if (!isDeepStrictEqual(run.entries, expectedEntries)) {
    fail("sealed run contains missing or extra entries");
  }

  const bytesByName = new Map();
  for (const artifact of receipt.artifacts) {
    const bytes = await run.read(artifact.name);
    if (bytes.length !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
      fail(`artifact digest mismatch: ${artifact.name}`);
    }
    bytesByName.set(artifact.name, bytes);
  }
  verifyEvidenceArtifactInventory(receipt, bytesByName);
  const contractBytes = bytesByName.get("contract.json");
  const contract = validateG17Contract(JSON.parse(contractBytes));
  if (
    sha256(contractBytes) !== receipt.contract.sha256 ||
    contract.id !== receipt.contract.id ||
    contract.benchmark.suite.taskHash !== receipt.contract.suiteHash ||
    contract.referenceDecision.status !== receipt.contract.referenceDecision ||
    contract.budgetDecision.status !== receipt.contract.budgetDecision ||
    contract.noiseDecision.status !== receipt.contract.noiseDecision
  ) {
    fail("sealed contract projection differs from the receipt");
  }
  const identity = parseCanonical(bytesByName.get("identity.json"), "identity");
  if (!isDeepStrictEqual(sealedIdentityProjection(identity), receipt.identity)) {
    fail("sealed identity projection differs from the receipt");
  }
  const observations = parseCanonical(
    bytesByName.get("observations.json"),
    "observations",
  );
  if (
    observations.schema !== "oxigraph.g1.7-qualification-observations/v1" ||
    !isDeepStrictEqual(observations.identity, identity) ||
    !isDeepStrictEqual(observations.semantic, receipt.evidence.semantic) ||
    !isDeepStrictEqual(observations.compatibility, receipt.evidence.compatibility) ||
    !isDeepStrictEqual(observations.benchmark, receipt.benchmark)
  ) {
    fail("sealed observations differ from the receipt");
  }
  const manifest = parseCanonical(bytesByName.get("manifest.json"), "manifest");
  const expectedManifestArtifacts = receipt.artifacts.filter(
    ({ name }) => name !== "manifest.json",
  );
  if (
    manifest.schema !== "oxigraph.g1.7-qualification-artifact-manifest/v1" ||
    manifest.runId !== receipt.run.id ||
    !isDeepStrictEqual(manifest.artifacts, expectedManifestArtifacts)
  ) {
    fail("sealed artifact manifest differs from the receipt");
  }
  return Object.freeze({
    ok: true,
    runId: receipt.run.id,
    receiptSha256: receipt.receiptSha256,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    verdict: receipt.final.verdict,
    reasons: receipt.final.reasons,
    authority: receipt.authority,
  });
}
