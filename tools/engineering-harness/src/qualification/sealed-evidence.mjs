import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  agenticDependencyEvidenceNames,
  agenticOracleBytes,
  agenticReceiptBytes,
  agenticRuntimeContentHash,
  validateAgenticDependencyEvidence,
  validateAgenticOracle,
  validateAgenticReceipt,
} from "../../../agentic-qe/receipt-contract.mjs";
import {
  commands as agenticCommands,
  profiles as agenticProfiles,
} from "../../../agentic-qe/profile-definitions.mjs";
import { validateSemanticEvidencePair } from "../../../metaharness/receipt-contract.mjs";
import { G17_SEMANTIC_EVIDENCE_SCHEMA } from "./evidence-contract.mjs";
import {
  G17_G14B_PREREQUISITE_ARTIFACT_NAME,
  replayG17G14bPrerequisite,
} from "./g14b-prerequisite.mjs";
import {
  G17_NATIVE_APPLICATION_ARTIFACT_NAMES,
  verifyG17NativeApplicationEvidence,
} from "./native-application-contract.mjs";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes);
  } catch (error) {
    throw new Error(`${label} is invalid JSON`, { cause: error });
  }
}

function archiveName(index) {
  return `agentic-archive-${String(index).padStart(4, "0")}.bin`;
}

function expectedAgenticProjection(
  receipt,
  receiptBytes,
  oracleBytes,
  dependencyContentHash,
) {
  const passedTests = receipt.commands.reduce(
    (sum, command) => sum + command.testSafeguard.observedPassedTests,
    0,
  );
  return {
    status: "PASS",
    subjectCommit: receipt.repository.gitHead,
    profile: receipt.profile,
    runId: receipt.runId,
    generatedAt: receipt.generatedAt,
    commandCount: receipt.commands.length,
    passedTests,
    receiptSha256: sha256(receiptBytes),
    oracleSha256: sha256(oracleBytes),
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    runtimeContentHash: agenticRuntimeContentHash(receipt.runtime),
    implementationContentHash: receipt.implementation.contentHash,
    artifactContentHash: receipt.artifacts.contentHash,
    archiveContentHash: receipt.artifacts.archive.contentHash,
    archiveFileCount: receipt.artifacts.archive.files.length,
    dependencyContentHash,
  };
}

function reviewedAgenticProfile(contract) {
  const reviewed = contract.compatibility.agenticQe;
  const commandIds = agenticProfiles[reviewed.profile];
  if (!Array.isArray(commandIds)) {
    throw new Error("reviewed Agentic-QE profile is unknown");
  }
  const expectedPassedTests = commandIds.reduce((sum, id) => {
    const policy = agenticCommands[id]?.[2];
    const count = policy?.expectedPassedTests ?? policy?.expectedNodeTests;
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error("reviewed Agentic-QE command has no exact test count");
    }
    return sum + count;
  }, 0);
  const owner = {
    profile: reviewed.profile,
    commandIds,
    expectedCommands: commandIds.length,
    expectedPassedTests,
  };
  if (!isDeepStrictEqual(reviewed, owner)) {
    throw new Error("reviewed Agentic-QE profile drifted from its owner");
  }
  return owner;
}

function darwinDependency(identity) {
  const matches = (identity?.control?.dependencies ?? []).filter(
    (dependency) => dependency?.name === "@metaharness/darwin",
  );
  if (matches.length !== 1) {
    throw new Error("sealed identity has no unique Darwin dependency");
  }
  return matches[0];
}

export function verifySealedAgenticEvidence({
  contract,
  g17Receipt,
  identity,
  compatibility,
  bytesByName,
}) {
  const reviewed = reviewedAgenticProfile(contract);
  const receiptBytes = bytesByName.get("agentic-receipt.json");
  const oracleBytes = bytesByName.get("agentic-oracle.json");
  if (!Buffer.isBuffer(receiptBytes) || !Buffer.isBuffer(oracleBytes)) {
    throw new Error("copied Agentic-QE publication is incomplete");
  }
  const receipt = parseJson(receiptBytes, "copied Agentic-QE receipt");
  if (!receiptBytes.equals(agenticReceiptBytes(receipt))) {
    throw new Error("copied Agentic-QE receipt serialization drifted");
  }
  const dependencyEvidence = validateAgenticDependencyEvidence({
    dependency: receipt.authority?.agenticQeDependency,
    manifestBytes: bytesByName.get(agenticDependencyEvidenceNames.manifest),
    lockfileBytes: bytesByName.get(agenticDependencyEvidenceNames.lockfile),
    npmrcBytes: bytesByName.get(agenticDependencyEvidenceNames.npmrc),
    installedPackageJsonBytes: bytesByName.get(
      agenticDependencyEvidenceNames.installedPackageJson,
    ),
  });
  const dependency = dependencyEvidence.dependency;
  if (dependency.version !== receipt.agenticQeVersion) {
    throw new Error("copied Agentic-QE dependency binding is invalid");
  }
  validateAgenticReceipt(receipt, {
    expectedProfile: reviewed.profile,
    expectedAgenticQeVersion: dependency.version,
    expectedAgenticQeDependency: dependency,
    expectedRuntimeContentHash:
      compatibility.projection?.agenticQe?.runtimeContentHash,
    expectedCommandIds: reviewed.commandIds,
    expectedCommands: agenticCommands,
    minimumGeneratedAtMs: 0,
    maximumGeneratedAtMs: Date.parse(g17Receipt.run.startedAt),
  });
  if (
    receipt.repository?.gitHead !== identity.subject.commit ||
    receipt.repository?.worktreeDirty !== false ||
    receipt.commands.length !== reviewed.expectedCommands
  ) {
    throw new Error("copied Agentic-QE subject binding is invalid");
  }

  const oracle = parseJson(oracleBytes, "copied Agentic-QE oracle");
  if (!oracleBytes.equals(agenticOracleBytes(oracle))) {
    throw new Error("copied Agentic-QE oracle serialization drifted");
  }
  validateAgenticOracle(oracle, receipt, receiptBytes);

  const archive = receipt.artifacts.archive;
  const expectedArchiveNames = archive.files.map((_, index) =>
    archiveName(index),
  );
  const copiedArchiveNames = [...bytesByName.keys()]
    .filter((name) => /^agentic-archive-[0-9]{4}\.bin$/u.test(name))
    .sort();
  if (!isDeepStrictEqual(copiedArchiveNames, expectedArchiveNames)) {
    throw new Error("copied Agentic-QE archive inventory drifted");
  }
  for (const [index, file] of archive.files.entries()) {
    const bytes = bytesByName.get(archiveName(index));
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== file.bytes ||
      sha256(bytes) !== file.sha256
    ) {
      throw new Error("copied Agentic-QE archive bytes drifted");
    }
  }

  const projection = expectedAgenticProjection(
    receipt,
    receiptBytes,
    oracleBytes,
    dependencyEvidence.contentHash,
  );
  if (
    projection.commandCount !== reviewed.expectedCommands ||
    projection.passedTests !== reviewed.expectedPassedTests ||
    !isDeepStrictEqual(projection, compatibility.projection?.agenticQe)
  ) {
    throw new Error("copied Agentic-QE projection drifted");
  }
  return Object.freeze(projection);
}

export function verifySealedG14bPrerequisiteEvidence({
  compatibility,
  bytesByName,
}) {
  const receiptBytes = bytesByName.get(G17_G14B_PREREQUISITE_ARTIFACT_NAME);
  if (!Buffer.isBuffer(receiptBytes)) {
    throw new Error("copied G1.4b application receipt is missing");
  }
  const projection = replayG17G14bPrerequisite({ receiptBytes });
  if (
    !isDeepStrictEqual(compatibility.projection?.applicationReceipts, [
      projection,
    ])
  ) {
    throw new Error("copied G1.4b prerequisite projection drifted");
  }
  return projection;
}

export function verifySealedNativeCompatibilityEvidence({
  contractBytes,
  contractSha256,
  g17Receipt,
  identity,
  compatibility,
  bytesByName,
}) {
  const artifacts = G17_NATIVE_APPLICATION_ARTIFACT_NAMES.map((name) => {
    const bytes = bytesByName.get(name);
    if (!Buffer.isBuffer(bytes)) {
      throw new Error(`copied native application artifact ${name} is missing`);
    }
    return { name, bytes };
  });
  const projection = verifyG17NativeApplicationEvidence({
    artifacts,
    runId: g17Receipt.run.id,
    contractBytes,
    contractSha256,
    identity,
  });
  if (!isDeepStrictEqual(projection, compatibility.projection?.native)) {
    throw new Error("copied native compatibility projection drifted");
  }
  return projection;
}

export function verifySealedSemanticEvidence({
  g17Receipt,
  identity,
  semantic,
  bytesByName,
}) {
  const qualificationBytes = bytesByName.get("semantic-qualification.json");
  const verificationBytes = bytesByName.get("semantic-verification.json");
  if (
    !Buffer.isBuffer(qualificationBytes) ||
    !Buffer.isBuffer(verificationBytes)
  ) {
    throw new Error("copied MetaHarness publication is incomplete");
  }
  const qualification = parseJson(
    qualificationBytes,
    "copied MetaHarness qualification",
  );
  const verification = parseJson(
    verificationBytes,
    "copied MetaHarness verification",
  );
  const dependency = darwinDependency(identity);
  const ownerProjection = validateSemanticEvidencePair({
    qualification,
    qualificationBytes,
    verification,
    verificationBytes,
    expectedDarwinVersion: dependency.version,
    expectedDarwinDependency: dependency,
    maximumFinishedAtMs: Date.parse(g17Receipt.run.startedAt),
  });
  const projection = {
    ...ownerProjection,
    schema: G17_SEMANTIC_EVIDENCE_SCHEMA,
  };
  if (!isDeepStrictEqual(projection, semantic.projection)) {
    throw new Error("copied MetaHarness projection drifted");
  }
  return Object.freeze(projection);
}
