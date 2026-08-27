#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  agenticRuntimeContentHash,
  implementationSnapshot as agenticImplementationSnapshot,
  readAgenticFileBytes,
  validateAgenticArtifactArchive,
  validateAgenticPublication,
  validateAgenticReceipt,
} from "../agentic-qe/evidence.mjs";
import { agenticRuntimeProvenance } from "../agentic-qe/execution-provenance.mjs";
import {
  commands as agenticCommands,
  profiles as agenticProfiles,
} from "../agentic-qe/profile-definitions.mjs";
import { agenticQeDependencyResolution } from "../agentic-qe/version-policy.mjs";
import { verifyMutationQualification } from "./mutation-binding.mjs";
import {
  darwinInstallationSnapshot,
  portable,
  protectedSnapshot,
  sha256,
  trustedRealGateValid,
  validateQualificationReceipt,
  validateVerificationReceipt,
  verificationContentHash,
  verificationFromQualification,
  writeJsonAtomic,
} from "./evidence.mjs";
import { agenticQualificationBindingValid } from "./agentic-binding.mjs";

const toolDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
const repoRoot = realpathSync(resolve(toolDir, "../.."));
const semanticProfile = "metaharness-semantic-gate";

async function verifyAgentic(
  binding,
  minimumGeneratedAtMs,
  maximumGeneratedAtMs,
) {
  const agenticQeDependency = agenticQeDependencyResolution();
  if (!agenticQualificationBindingValid(binding)) {
    throw new Error("Agentic-QE qualification binding is invalid");
  }
  const receiptBytes = readAgenticFileBytes(binding?.path, {
    repositoryRoot: repoRoot,
  });
  if (sha256(receiptBytes) !== binding.sha256) {
    throw new Error("Agentic-QE receipt bytes differ from qualification");
  }
  const candidate = JSON.parse(receiptBytes);
  const publication = validateAgenticPublication(candidate);
  const receipt = publication.receipt;
  const selected = agenticProfiles[semanticProfile];
  const expectedRuntime = await agenticRuntimeProvenance(
    selected,
    agenticCommands,
    agenticQeDependency.version,
  );
  validateAgenticReceipt(receipt, {
    expectedProfile: semanticProfile,
    expectedAgenticQeVersion: agenticQeDependency.version,
    expectedAgenticQeDependency: agenticQeDependency,
    expectedRuntime,
    expectedCommandIds: selected,
    expectedCommands: agenticCommands,
    minimumGeneratedAtMs,
    maximumGeneratedAtMs,
  });
  const archive = validateAgenticArtifactArchive(receipt);
  const implementation = agenticImplementationSnapshot(
    selected,
    agenticCommands,
  );
  if (
    implementation.contentHash !== receipt.implementation.contentHash ||
    receipt.contentHash !== binding.contentHash ||
    receipt.executionHash !== binding.executionHash ||
    receipt.schemaVersion !== binding.schemaVersion ||
    receipt.runId !== binding.runId ||
    receipt.generatedAt !== binding.generatedAt ||
    receipt.publication.receiptPath !== binding.path ||
    receipt.publication.oraclePath !== binding.oraclePath ||
    implementation.contentHash !== binding.implementationContentHash ||
    receipt.artifacts.contentHash !== binding.artifactContentHash ||
    archive.contentHash !== binding.archiveContentHash ||
    archive.root !== binding.archiveRoot ||
    archive.files.length !== binding.archiveFileCount
  ) {
    throw new Error("Agentic-QE archived evidence differs from qualification");
  }
  const oracleBytes = publication.oracleBytes;
  if (sha256(oracleBytes) !== binding.oracleSha256) {
    throw new Error("Agentic-QE oracle does not bind the verified receipt");
  }
  if (
    !publication.receiptBytes.equals(receiptBytes) ||
    publication.oracle.receiptSha256 !== binding.sha256
  ) {
    throw new Error(
      "Agentic-QE immutable publication differs from qualification",
    );
  }
  return {
    schemaVersion: receipt.schemaVersion,
    runId: receipt.runId,
    generatedAt: receipt.generatedAt,
    receiptSha256: sha256(receiptBytes),
    oracleSha256: sha256(oracleBytes),
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    runtimeContentHash: agenticRuntimeContentHash(expectedRuntime),
    implementationContentHash: implementation.contentHash,
    artifactContentHash: receipt.artifacts.contentHash,
    archiveContentHash: archive.contentHash,
  };
}

async function main() {
  const qualificationRelativePath = "target/metaharness/qualification.json";
  const canonicalQualification = resolve(repoRoot, qualificationRelativePath);
  const qualificationBytes = readAgenticFileBytes(qualificationRelativePath, {
    repositoryRoot: repoRoot,
  });
  const qualification = JSON.parse(qualificationBytes);
  const darwin = darwinInstallationSnapshot(repoRoot, toolDir);
  validateQualificationReceipt(qualification, {
    expectedDarwinVersion: darwin.version,
    requireFull: true,
    strictNested: true,
  });
  if (!trustedRealGateValid(qualification.realGate)) {
    throw new Error(
      "Darwin qualification real gate is not independently closed",
    );
  }
  const current = protectedSnapshot(repoRoot);
  if (
    current.contentHash !== qualification.inputs.after.contentHash ||
    darwin.contentHash !== qualification.inputs.darwin.after.contentHash
  ) {
    throw new Error("Darwin qualification inputs are stale");
  }
  const nodePath = realpathSync(qualification.runtime.node.path);
  const currentNodePath = realpathSync(process.execPath);
  if (
    nodePath !== currentNodePath ||
    qualification.runtime.node.path !== currentNodePath ||
    qualification.runtime.node.invokedPath !== process.execPath ||
    sha256(readFileSync(nodePath)) !==
      qualification.runtime.node.executableSha256 ||
    process.version !== qualification.runtime.node.version ||
    qualification.runtime.platform !== process.platform ||
    qualification.runtime.architecture !== process.arch
  ) {
    throw new Error("Darwin qualification Node provenance drifted");
  }
  const mutation = verifyMutationQualification(
    repoRoot,
    qualification.mutation,
  );
  const agentic = await verifyAgentic(
    qualification.realGate.agenticReceipt,
    Date.parse(qualification.startedAt),
    Date.parse(qualification.finishedAt),
  );
  const verification = {
    schemaVersion: 1,
    verified: true,
    qualification: {
      path: portable(relative(repoRoot, canonicalQualification)),
      sha256: sha256(qualificationBytes),
      contentHash: qualification.contentHash,
    },
    protectedContentHash: current.contentHash,
    darwinContentHash: darwin.contentHash,
    mutation,
    agentic,
  };
  verification.contentHash = verificationContentHash(verification);
  const derivedVerification = verificationFromQualification(
    qualification,
    qualificationBytes,
  );
  if (JSON.stringify(verification) !== JSON.stringify(derivedVerification)) {
    throw new Error(
      "Darwin verification evidence is not derived from qualification",
    );
  }
  validateVerificationReceipt(verification, {
    qualification: derivedVerification.qualification,
    protectedContentHash: derivedVerification.protectedContentHash,
    darwinContentHash: derivedVerification.darwinContentHash,
    mutation: derivedVerification.mutation,
    agentic: derivedVerification.agentic,
  });
  const outputPath = join(
    repoRoot,
    "target",
    "metaharness",
    "verification.json",
  );
  writeJsonAtomic(outputPath, verification, repoRoot);
  console.log("Darwin qualification verification: PASS");
  console.log(`Receipt: ${portable(relative(repoRoot, outputPath))}`);
  console.log(`Content: ${verification.contentHash}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
