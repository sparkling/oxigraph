import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { comparePortablePaths } from "../../../metaharness/policy-contract.mjs";
import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";
import { G17_CONTRACT_GENERATION } from "./contract-identity.mjs";
import { decodeSealedG17ContractForReplay } from "./contract-replay.mjs";
import {
  decodeSealedG17ControlProtocol,
  validateG17QualificationOwnerGate,
} from "./control-protocol.mjs";
import {
  G17_COMPATIBILITY_EVIDENCE_SCHEMA,
  G17_SEMANTIC_EVIDENCE_SCHEMA,
  g17EvidenceSchemaState,
} from "./evidence-contract.mjs";
import {
  decodeSealedG17DecisionSet,
  validateG17DecisionSetBinding,
} from "./decision-contract.mjs";
import { verifyG17Receipt } from "./receipt.mjs";
import {
  verifySealedAgenticEvidence,
  verifySealedG14bPrerequisiteEvidence,
  verifySealedNativeCompatibilityEvidence,
  verifySealedSemanticEvidence,
} from "./sealed-evidence.mjs";
import { G17_NATIVE_APPLICATION_ARTIFACT_NAMES } from "./native-application-contract.mjs";
import { G17_G14B_PREREQUISITE_ARTIFACT_NAME } from "./g14b-prerequisite.mjs";
import { g17RunsRoot, openSealedG17Run } from "./storage.mjs";

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
  const currentCompatibility =
    receipt.evidence.compatibility.projection?.schema ===
    G17_COMPATIBILITY_EVIDENCE_SCHEMA;
  const projectedNativeOwner =
    receipt.evidence.compatibility.projection?.native?.ownerArtifact;
  const workspaceOwnerName = G17_NATIVE_APPLICATION_ARTIFACT_NAMES[3];
  const hasNativeOwner = bytesByName.has(workspaceOwnerName);
  if (
    currentCompatibility &&
    (projectedNativeOwner !== null && projectedNativeOwner !== undefined) !==
      hasNativeOwner
  ) {
    fail("native compatibility owner artifact projection is asymmetric");
  }
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
    const archiveCount =
      receipt.evidence.compatibility.projection?.agenticQe?.archiveFileCount;
    if (!Number.isSafeInteger(archiveCount) || archiveCount < 0) {
      fail("compatibility PASS archive inventory is invalid");
    }
    for (let index = 0; index < archiveCount; index += 1) {
      requireArtifact(
        bytesByName,
        `agentic-archive-${String(index).padStart(4, "0")}.bin`,
        "compatibility PASS artifacts are incomplete",
      );
    }
    if (currentCompatibility) {
      requireArtifact(
        bytesByName,
        G17_G14B_PREREQUISITE_ARTIFACT_NAME,
        "compatibility PASS G1.4b prerequisite evidence is incomplete",
      );
      for (const name of G17_NATIVE_APPLICATION_ARTIFACT_NAMES) {
        requireArtifact(
          bytesByName,
          name,
          "compatibility PASS seven-artifact native evidence is incomplete",
        );
      }
      if (bytesByName.has("native-compatibility-owner.json")) {
        fail("compatibility PASS contains a legacy native owner artifact");
      }
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
  if (
    receipt.artifacts.length + 1 > 64 ||
    receipt.artifacts.reduce(
      (sum, artifact) => sum + artifact.bytes,
      receiptBytes.length,
    ) >
      64 * 1024 * 1024
  ) {
    fail("sealed envelope exceeds its file or byte ceiling");
  }
  const expectedEntries = [
    ...receipt.artifacts.map(({ name }) => name),
    "receipt.json",
  ].sort(comparePortablePaths);
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
  const contractBytes = bytesByName.get("contract.json");
  const decodedContract = await decodeSealedG17ContractForReplay({
    bytes: contractBytes,
    receiptSha256: receipt.contract.sha256,
  });
  const { contract, generation: contractGeneration } = decodedContract;
  const legacyV4 = contractGeneration === G17_CONTRACT_GENERATION.LEGACY_V4;
  const legacyV5 = contractGeneration === G17_CONTRACT_GENERATION.LEGACY_V5;
  const currentV6 = contractGeneration === G17_CONTRACT_GENERATION.CURRENT_V6;
  if (legacyV5) {
    fail("legacy v5 qualification receipt replay owner is unavailable");
  }
  let decisionBinding = null;
  let controlProtocol = null;
  if (legacyV4) {
    for (const descriptor of [
      contract.referenceDecision,
      contract.budgetDecision,
      contract.noiseDecision,
    ]) {
      requireArtifact(
        bytesByName,
        descriptor.sealedName,
        "current contract decision artifacts are incomplete",
      );
    }
    const decisions = decodeSealedG17DecisionSet({ contract, bytesByName });
    decisionBinding = validateG17DecisionSetBinding({
      contract,
      decisions,
      startedAt: receipt.run.startedAt,
    });
  } else if (currentV6) {
    controlProtocol = decodeSealedG17ControlProtocol({
      contract,
      bytesByName,
    });
  }
  const currentFinalApproved =
    controlProtocol?.authorization.status === "CONTROL_AUTHORIZED" &&
    controlProtocol?.finalDecisionSet.status === "APPROVED";
  const projectedDecisions =
    controlProtocol !== null
      ? currentFinalApproved
        ? {
            reference: "SELECTED",
            performance: "APPROVED",
            noise: "APPROVED",
          }
        : {
            reference: "PROPOSED",
            performance: "PROPOSED",
            noise: "PROPOSED",
          }
      : decisionBinding === null
        ? {
            reference: contract.referenceDecision.status,
            performance: contract.budgetDecision.status,
            noise: contract.noiseDecision.status,
          }
        : {
            reference: decisionBinding.reference.status,
            performance: decisionBinding.performance.status,
            noise: decisionBinding.noise.status,
          };
  if (
    sha256(contractBytes) !== receipt.contract.sha256 ||
    contract.id !== receipt.contract.id ||
    contract.benchmark.suite.taskHash !== receipt.contract.suiteHash ||
    projectedDecisions.reference !== receipt.contract.referenceDecision ||
    projectedDecisions.performance !== receipt.contract.budgetDecision ||
    projectedDecisions.noise !== receipt.contract.noiseDecision
  ) {
    fail("sealed contract projection differs from the receipt");
  }
  if (currentV6) {
    if (
      controlProtocol.finalDecisionSet.status === "APPROVED" &&
      controlProtocol.authorization.status !== "CONTROL_AUTHORIZED"
    ) {
      fail("approved final decision is paired with a proposed authorization");
    }
    if (currentFinalApproved) {
      validateG17QualificationOwnerGate({
        authorization: controlProtocol.authorization,
        authorizationRawSha256:
          controlProtocol.artifacts.authorization.rawSha256,
        finalDecisionSet: controlProtocol.finalDecisionSet,
        qualificationStartedAt: receipt.run.startedAt,
      });
    }
    fail("current v6 qualification receipt owner is unavailable");
  }
  verifyEvidenceArtifactInventory(receipt, bytesByName);
  if (
    legacyV4 &&
    ["PASS", "FAIL", "NOISY"].includes(receipt.benchmark.status)
  ) {
    fail("executed benchmark replay owner is unavailable");
  }
  const identity = parseCanonical(bytesByName.get("identity.json"), "identity");
  if (
    !isDeepStrictEqual(sealedIdentityProjection(identity), receipt.identity)
  ) {
    fail("sealed identity projection differs from the receipt");
  }
  const evidenceSchemaState = Object.freeze({
    semantic: g17EvidenceSchemaState(
      receipt.evidence.semantic,
      G17_SEMANTIC_EVIDENCE_SCHEMA,
    ),
    compatibility: g17EvidenceSchemaState(
      receipt.evidence.compatibility,
      G17_COMPATIBILITY_EVIDENCE_SCHEMA,
    ),
  });
  const generationState = Object.freeze({
    currentContract: false,
    currentCompatibility: false,
    legacyReplayOnly: true,
  });
  if (
    legacyV4 &&
    evidenceSchemaState.compatibility === "CURRENT_SCHEMA_UNREPLAYED"
  ) {
    try {
      verifySealedAgenticEvidence({
        contract,
        g17Receipt: receipt,
        identity,
        compatibility: receipt.evidence.compatibility,
        bytesByName,
      });
    } catch {
      fail("copied Agentic-QE evidence is invalid");
    }
    try {
      verifySealedNativeCompatibilityEvidence({
        contractBytes,
        contractSha256: receipt.contract.sha256,
        g17Receipt: receipt,
        identity,
        compatibility: receipt.evidence.compatibility,
        bytesByName,
      });
    } catch {
      fail("copied native compatibility evidence is invalid");
    }
    try {
      verifySealedG14bPrerequisiteEvidence({
        compatibility: receipt.evidence.compatibility,
        bytesByName,
      });
    } catch {
      fail("copied G1.4b prerequisite evidence is invalid");
    }
  }
  if (
    legacyV4 &&
    evidenceSchemaState.semantic === "CURRENT_SCHEMA_UNREPLAYED"
  ) {
    try {
      verifySealedSemanticEvidence({
        g17Receipt: receipt,
        identity,
        semantic: receipt.evidence.semantic,
        bytesByName,
      });
    } catch {
      fail("copied MetaHarness evidence is invalid");
    }
  }
  const observations = parseCanonical(
    bytesByName.get("observations.json"),
    "observations",
  );
  if (
    observations.schema !== "oxigraph.g1.7-qualification-observations/v1" ||
    !isDeepStrictEqual(observations.identity, identity) ||
    !isDeepStrictEqual(observations.semantic, receipt.evidence.semantic) ||
    !isDeepStrictEqual(
      observations.compatibility,
      receipt.evidence.compatibility,
    ) ||
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
  const legacyReplayOnly =
    generationState.legacyReplayOnly ||
    Object.values(evidenceSchemaState).includes("LEGACY_REPLAY_ONLY");
  const evidenceAssurance = Object.freeze(
    Object.fromEntries(
      Object.entries(evidenceSchemaState).map(([lane, schemaState]) => [
        lane,
        schemaState === "NOT_APPLICABLE"
          ? schemaState
          : contractGeneration !== G17_CONTRACT_GENERATION.CURRENT_V6
            ? "LEGACY_REPLAY_ONLY"
            : schemaState === "CURRENT_SCHEMA_UNREPLAYED"
              ? lane === "semantic"
                ? "METAHARNESS_OWNER_CONTRACT_REPLAYED"
                : "COMPATIBILITY_OWNER_CONTRACT_REPLAYED"
              : schemaState,
      ]),
    ),
  );
  const qualificationEligible =
    !legacyReplayOnly &&
    contractGeneration === G17_CONTRACT_GENERATION.CURRENT_V6 &&
    decisionBinding?.approved === true &&
    receipt.final.verdict === "ACCEPT" &&
    evidenceAssurance.semantic === "METAHARNESS_OWNER_CONTRACT_REPLAYED" &&
    evidenceAssurance.compatibility === "COMPATIBILITY_OWNER_CONTRACT_REPLAYED";
  return Object.freeze({
    ok: !legacyReplayOnly,
    verificationStatus: legacyReplayOnly
      ? "LEGACY_REPLAY_ONLY"
      : "SEALED_RUN_VERIFIED",
    qualificationEligible,
    evidenceAssurance,
    decisionAuthority: decisionBinding?.authority ?? "LEGACY_REPLAY_ONLY",
    contractGeneration,
    runId: receipt.run.id,
    receiptSha256: receipt.receiptSha256,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    verdict: receipt.final.verdict,
    reasons: receipt.final.reasons,
    authority: receipt.authority,
  });
}
