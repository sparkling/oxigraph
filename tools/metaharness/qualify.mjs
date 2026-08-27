#!/usr/bin/env node

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
import { currentMutationQualification } from "./mutation-binding.mjs";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evolve,
  generateBaselineHarness,
  inspectVariant,
  runVariantTask,
  validateGeneratedCode,
} from "@metaharness/darwin";
import {
  changedInputs,
  darwinInstallationSnapshot,
  ensureDirectoryInside,
  isInside,
  portable,
  protectedInputs,
  protectedSnapshot,
  qualificationContentHash,
  sha256,
  validateQualificationReceipt,
  writeJsonAtomic,
} from "./evidence.mjs";
import { mutablePolicy } from "./policy-contract.mjs";

const toolDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
const repoRoot = realpathSync(resolve(toolDir, "../.."));
const outputRoot = join(repoRoot, "target", "metaharness");
const outputNames = new Set([
  "synthetic-a",
  "synthetic-b",
  "semantic-gate",
  "safety-probe",
]);
const syntheticOnly = process.argv.includes("--synthetic-only");
const realTimeoutMs = 1_200_000;
const semanticProfile = "metaharness-semantic-gate";

function publicationPaths(stdout) {
  const read = (label, suffix) => {
    const pattern = new RegExp(
      `^${label}:\\s+(target/agentic-qe/${semanticProfile}/runs/[0-9a-f-]+/${suffix})$`,
      "gm",
    );
    const matches = [...stdout.matchAll(pattern)].map((match) => match[1]);
    if (matches.length !== 1) {
      throw new Error(`semantic gate emitted ${matches.length} ${label} paths`);
    }
    return matches[0];
  };
  return {
    receipt: read("Receipt", "receipt\\.json"),
    oracle: read("Oracle", "oracle\\.json"),
  };
}

function cleanOutput(name) {
  if (!outputNames.has(name)) throw new Error(`unknown output name: ${name}`);
  const root = ensureDirectoryInside(repoRoot, outputRoot);
  const path = join(root, name);
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`refusing to remove symlinked output: ${path}`);
    }
    const canonical = realpathSync(path);
    if (!isInside(root, canonical)) {
      throw new Error(`output target escapes MetaHarness root: ${canonical}`);
    }
    rmSync(canonical, { recursive: true });
  }
  return ensureDirectoryInside(repoRoot, path);
}

function stableScore(score) {
  if (!score) return null;
  const { variantId: _variantId, reason: _reason, ...stable } = score;
  return stable;
}

function stableEvolution(result) {
  return {
    generations: result.generations,
    winnerLineage: result.winnerLineage,
    winnerId: result.winner?.variant.id ?? null,
    records: result.records.map((record) => ({
      id: record.variant.id,
      parentId: record.variant.parentId,
      generation: record.variant.generation,
      mutationSurface: record.variant.mutationSurface,
      mutationSummary: record.variant.mutationSummary,
      children: record.children,
      score: stableScore(record.score),
    })),
  };
}

function scoreSummary(result) {
  const baseline = result.baseline.score;
  const winner = result.winner?.score ?? null;
  return {
    baseline: baseline
      ? {
          finalScore: baseline.finalScore,
          testPassRate: baseline.testPassRate,
          safetyScore: baseline.safetyScore,
        }
      : null,
    winner: winner
      ? {
          finalScore: winner.finalScore,
          testPassRate: winner.testPassRate,
          safetyScore: winner.safetyScore,
        }
      : null,
    recordCount: result.records.length,
    promotedCount: result.records.filter((record) => record.score?.promoted)
      .length,
  };
}

async function runSynthetic(name) {
  const workRoot = cleanOutput(name);
  const result = await evolve({
    repoRoot,
    workRoot,
    generations: 2,
    childrenPerGeneration: 2,
    concurrency: 2,
    promotionDelta: 0.01,
    seed: 12026,
    tasks: ["synthetic-policy-qualification"],
    sandboxMode: "mock",
    selection: "quality-diversity",
    tieBreaker: "insertion",
    costBudgetSeconds: 30,
  });
  return {
    result,
    projection: stableEvolution(result),
    summary: scoreSummary(result),
  };
}

async function runRealGate() {
  const agenticQeDependency = agenticQeDependencyResolution();
  const workRoot = cleanOutput("semantic-gate");
  const profile = {
    root: repoRoot,
    packageManager: "unknown",
    testCommand: "node tools/metaharness/semantic-gate.mjs",
    sourceFiles: protectedInputs,
    riskFiles: [],
    summary: "Oxigraph immutable semantic qualification gate",
  };
  const baseline = await generateBaselineHarness(profile, workRoot);
  const findings = await inspectVariant(baseline.dir);
  if (findings.length > 0) {
    throw new Error(`generated baseline was unsafe: ${findings.join("; ")}`);
  }
  const gateStartedAtMs = Date.now();
  const trace = await runVariantTask(
    baseline,
    profile,
    "metaharness-semantic-gate",
    { taskTimeoutMs: realTimeoutMs },
  );
  const gateFinishedAtMs = Date.now();
  let agenticReceipt = null;
  let receiptError = null;
  try {
    const paths = publicationPaths(trace.stdout);
    const bytes = readAgenticFileBytes(paths.receipt, {
      repositoryRoot: repoRoot,
    });
    const candidate = JSON.parse(bytes);
    const publication = validateAgenticPublication(candidate);
    const value = publication.receipt;
    const selected = agenticProfiles[semanticProfile];
    const expectedRuntime = await agenticRuntimeProvenance(
      selected,
      agenticCommands,
      agenticQeDependency.version,
    );
    validateAgenticReceipt(value, {
      expectedProfile: semanticProfile,
      expectedAgenticQeVersion: agenticQeDependency.version,
      expectedAgenticQeDependency: agenticQeDependency,
      expectedRuntime,
      expectedCommandIds: selected,
      expectedCommands: agenticCommands,
      minimumGeneratedAtMs: gateStartedAtMs,
      maximumGeneratedAtMs: gateFinishedAtMs,
    });
    const archive = validateAgenticArtifactArchive(value);
    const currentImplementation = agenticImplementationSnapshot(
      selected,
      agenticCommands,
    );
    if (
      currentImplementation.contentHash !== value.implementation.contentHash
    ) {
      throw new Error("receipt implementation snapshot is stale");
    }
    if (
      value.publication.receiptPath !== paths.receipt ||
      value.publication.oraclePath !== paths.oracle
    ) {
      throw new Error(
        "semantic gate publication paths differ from the receipt",
      );
    }
    if (!publication.receiptBytes.equals(bytes)) {
      throw new Error("semantic gate immutable publication bytes drifted");
    }
    agenticReceipt = {
      path: paths.receipt,
      sha256: sha256(bytes),
      schemaVersion: value.schemaVersion,
      runId: value.runId,
      generatedAt: value.generatedAt,
      contentHash: value.contentHash,
      executionHash: value.executionHash,
      runtimeContentHash: agenticRuntimeContentHash(expectedRuntime),
      oraclePath: paths.oracle,
      oracleSha256: sha256(publication.oracleBytes),
      implementationContentHash: value.implementation?.contentHash ?? null,
      artifactContentHash: value.artifacts?.contentHash ?? null,
      archiveContentHash: archive.contentHash,
      archiveRoot: archive.root,
      archiveFileCount: archive.files.length,
    };
  } catch (error) {
    receiptError = error instanceof Error ? error.message : String(error);
  }
  return {
    taskId: trace.taskId,
    exitCode: trace.exitCode,
    timedOut: trace.timedOut,
    blockedActions: trace.blockedActions,
    durationMs: trace.durationMs,
    stdoutHash: sha256(trace.stdout),
    stderrHash: sha256(trace.stderr),
    agenticReceipt,
    receiptError,
    passed:
      trace.exitCode === 0 &&
      !trace.timedOut &&
      trace.blockedActions.length === 0 &&
      agenticReceipt !== null,
  };
}

async function safetyProbe() {
  const workRoot = cleanOutput("safety-probe");
  const variantDir = join(workRoot, "variant");
  mkdirSync(variantDir, { recursive: true });
  writeFileSync(
    join(variantDir, "package.json"),
    '{"scripts":{"test":"curl https://example.invalid"}}\n',
  );
  const directoryFindings = await inspectVariant(variantDir);
  const codeFindings = validateGeneratedCode(
    "export const leak = process.env.SECRET_TOKEN;",
  );
  return {
    directoryBlocked: directoryFindings.length > 0,
    generatedCodeBlocked: codeFindings.length > 0,
    directoryFindingCount: directoryFindings.length,
    codeFindingCount: codeFindings.length,
  };
}

function writeReceipt(receipt) {
  const root = ensureDirectoryInside(repoRoot, outputRoot);
  const path = join(root, "qualification.json");
  writeJsonAtomic(path, receipt, repoRoot);
  return portable(relative(repoRoot, path));
}

async function main() {
  const nodePath = realpathSync(process.execPath);
  const runtime = {
    node: {
      invokedPath: process.execPath,
      path: nodePath,
      version: process.version,
      executableSha256: sha256(readFileSync(nodePath)),
    },
    platform: process.platform,
    architecture: process.arch,
  };
  const before = protectedSnapshot(repoRoot);
  const darwinBefore = darwinInstallationSnapshot(repoRoot, toolDir);
  const startedAt = new Date().toISOString();
  const first = await runSynthetic("synthetic-a");
  const second = await runSynthetic("synthetic-b");
  const safety = await safetyProbe();
  const mutation = syntheticOnly
    ? null
    : currentMutationQualification(repoRoot);
  const realGate = syntheticOnly ? null : await runRealGate();
  const after = protectedSnapshot(repoRoot);
  const darwinAfter = darwinInstallationSnapshot(repoRoot, toolDir);

  const reproducible =
    JSON.stringify(first.projection) === JSON.stringify(second.projection);
  const changedPaths = changedInputs(before, after);
  const protectedInputsStable =
    before.contentHash === after.contentHash && changedPaths.length === 0;
  const darwinStable =
    JSON.stringify(darwinBefore) === JSON.stringify(darwinAfter);
  const implementationStable = protectedInputsStable && darwinStable;
  const baselineScore = first.result.baseline.score;
  const winnerScore = first.result.winner?.score ?? null;
  const syntheticSolved =
    baselineScore !== null &&
    winnerScore !== null &&
    winnerScore.testPassRate >= baselineScore.testPassRate &&
    winnerScore.safetyScore === 1;
  const gates = {
    solve:
      syntheticSolved &&
      (mutation?.valid ?? true) &&
      (realGate?.passed ?? true),
    regression:
      implementationStable &&
      winnerScore !== null &&
      baselineScore !== null &&
      winnerScore.testPassRate >= baselineScore.testPassRate &&
      (mutation?.valid ?? true) &&
      (realGate?.passed ?? true),
    safety:
      safety.directoryBlocked &&
      safety.generatedCodeBlocked &&
      implementationStable,
    cost:
      first.result.records.length <= 7 &&
      second.result.records.length <= 7 &&
      (realGate === null || realGate.durationMs <= realTimeoutMs),
    reproducibility: reproducible,
  };
  const passed = Object.values(gates).every(Boolean);
  const receipt = {
    schemaVersion: 2,
    qualification: "oxigraph-policy-only-darwin",
    darwinVersion: darwinBefore.version,
    mode: syntheticOnly ? "synthetic-only" : "synthetic-and-semantic-gate",
    runtime,
    startedAt,
    finishedAt: new Date().toISOString(),
    policyBoundary: {
      mutable: mutablePolicy,
      protectedInputs,
    },
    inputs: {
      before,
      after,
      changedPaths,
      protectedInputsStable,
      darwin: {
        before: darwinBefore,
        after: darwinAfter,
        stable: darwinStable,
      },
      implementationStable,
    },
    synthetic: {
      seed: 12026,
      generations: 2,
      childrenPerGeneration: 2,
      first: first.summary,
      second: second.summary,
      projectionHash: sha256(JSON.stringify(first.projection)),
      replayProjectionHash: sha256(JSON.stringify(second.projection)),
    },
    safety,
    mutation,
    realGate,
    gates,
    passed,
  };
  receipt.contentHash = qualificationContentHash(receipt);
  if (passed) {
    validateQualificationReceipt(receipt, {
      expectedDarwinVersion: darwinBefore.version,
      requireFull: !syntheticOnly,
    });
  }
  const path = writeReceipt(receipt);
  console.log(`Darwin qualification: ${passed ? "PASS" : "FAIL"}`);
  console.log(`Receipt: ${path}`);
  console.log(`Content: ${receipt.contentHash}`);
  if (!passed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
