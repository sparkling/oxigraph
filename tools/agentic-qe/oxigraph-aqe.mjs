#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { atomicJson, createDurableDirectory } from "./atomic-json.mjs";
import {
  agenticReceiptContentHash,
  agenticReceiptExecutionHash,
  agenticReceiptBytes,
  archiveOutputArtifacts,
  changedInputs,
  implementationSnapshot,
  implementationManifestsEqual,
  outputArtifacts,
  sha256,
  validateAgenticArtifactArchive,
  validateAgenticOracle,
  validateAgenticPublication,
  validateAgenticReceipt,
} from "./evidence.mjs";
import {
  cargoTestInventory,
  commandAuthority,
  executablePathProvenance,
  runtimeProvenance,
} from "./execution-provenance.mjs";
import {
  acquireProfileRunLease,
  auditOutputFor,
  prepareGeneratedOutput,
  profileOutputDirectory,
  portablePath,
  repoRoot,
  resolveAuditInput,
  resolveRustSource,
  toolDir,
  uniqueCandidateDestination,
} from "./path-policy.mjs";
import {
  applyCommandSafeguards,
  commandPassed,
  execute,
  validateCommand,
} from "./process-runner.mjs";
import {
  commands,
  profileNames,
  profiles,
} from "./profile-definitions.mjs";

const EXPECTED_AGENTIC_QE_VERSION = "3.13.2";
const aqeBin = join(
  toolDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "aqe.cmd" : "aqe",
);

function usage() {
  console.log(`Oxigraph Agentic-QE adapter

Usage:
  node tools/agentic-qe/oxigraph-aqe.mjs run <${profileNames}>
  node tools/agentic-qe/oxigraph-aqe.mjs candidate <rust-source>
  node tools/agentic-qe/oxigraph-aqe.mjs audit <candidate-result.json>
  node tools/agentic-qe/oxigraph-aqe.mjs probe

The adapter records Agentic-QE's pinned version, but Cargo and the pinned W3C
manifests remain the executable correctness oracle.`);
}

async function capture(program, args, cwd = repoRoot, timeoutMs = 30_000) {
  return execute(program, args, {
    cwd,
    quiet: true,
    announce: false,
    timeoutMs,
  });
}

async function gitValue(args, cwd = repoRoot) {
  const result = await capture("git", args, cwd);
  if (result.code !== 0 || result.timedOut || result.spawnError) {
    throw new Error(`unable to capture Git repository state: git ${args.join(" ")}`);
  }
  return result.stdoutTail.trim();
}

async function probeAqe() {
  const result = await capture(aqeBin, ["--version"], toolDir);
  if (result.code !== 0 || result.timedOut || result.spawnError) {
    throw new Error(
      "Agentic-QE is not installed. Run `npm ci` in tools/agentic-qe first.",
    );
  }
  const version = result.stdoutTail.trim();
  if (version !== EXPECTED_AGENTIC_QE_VERSION) {
    throw new Error(
      `Agentic-QE ${EXPECTED_AGENTIC_QE_VERSION} is required, found ${version}`,
    );
  }
  return version;
}

function safeguardFailure(id, result) {
  const safeguard = result.testSafeguard;
  if (result.timedOut) {
    console.error(`${id} exceeded its ${result.timeoutMs} ms timeout`);
  } else if (safeguard?.passed === false) {
    const exact = safeguard.expectedPassedTests;
    const requirement =
      exact === null
        ? `at least ${safeguard.minimumPassedTests}`
        : `exactly ${exact}`;
    console.error(
      `${id} ran ${safeguard.observedPassedTests} tests; ${requirement} required`,
    );
  }
}

async function runProfile(profile) {
  const selected = profiles[profile];
  if (!selected) throw new Error(`Unknown profile: ${profile}`);
  for (const id of selected) {
    const [program, args, policy = {}] = commands[id];
    validateCommand(id, program, args, policy);
  }

  const lease = acquireProfileRunLease(profile);
  let executionError;
  try {
    await executeProfile(profile, selected);
  } catch (error) {
    executionError = error;
    throw error;
  } finally {
    try {
      lease.release();
    } catch (releaseError) {
      if (executionError) {
        console.error(
          `Agentic-QE profile lease release also failed: ${releaseError.message}`,
        );
      } else {
        throw releaseError;
      }
    }
  }
}

async function executeProfile(profile, selected) {
  const runId = randomUUID();
  const profileDir = profileOutputDirectory(profile);
  const latestReceiptPath = join(profileDir, "receipt.json");
  const latestOraclePath = join(profileDir, "oracle.json");
  prepareGeneratedOutput(relative(repoRoot, latestOraclePath));
  prepareGeneratedOutput(relative(repoRoot, latestReceiptPath));
  const publicationRoot = createDurableDirectory(
    join(profileDir, "runs", runId),
  );
  const receiptPath = join(publicationRoot, "receipt.json");
  const oraclePath = join(publicationRoot, "oracle.json");
  const publication = {
    schemaVersion: 1,
    immutable: true,
    root: portablePath(relative(repoRoot, publicationRoot)),
    receiptPath: portablePath(relative(repoRoot, receiptPath)),
    oraclePath: portablePath(relative(repoRoot, oraclePath)),
  };
  const selectedOutputs = new Set();
  for (const id of selected) {
    const policy = commands[id][2] ?? {};
    for (const path of policy.outputPaths ?? []) selectedOutputs.add(path);
  }
  for (const path of selectedOutputs) prepareGeneratedOutput(path);

  const aqeVersion = await probeAqe();
  const runtime = await runtimeProvenance(selected, commands);
  runtime.push(
    executablePathProvenance("agentic-qe", aqeBin, aqeVersion),
  );
  runtime.sort((left, right) =>
    `${left.context}:${left.program}`.localeCompare(
      `${right.context}:${right.program}`,
    ),
  );
  const gitHead = await gitValue(["rev-parse", "HEAD"]);
  const worktreeStatus = await gitValue(["status", "--short"]);
  const rdfTestsCommit = await gitValue(
    ["rev-parse", "HEAD"],
    join(repoRoot, "testsuite", "rdf-tests"),
  );
  const rdfCanonTestsCommit = await gitValue(
    ["rev-parse", "HEAD"],
    join(repoRoot, "testsuite", "rdf-canon"),
  );
  const before = implementationSnapshot(selected, commands);

  const results = [];
  for (const id of selected) {
    const [program, args, policy = {}] = commands[id];
    const testInventory =
      program === "cargo"
        ? await cargoTestInventory(id, args, policy)
        : null;
    const result = applyCommandSafeguards(
      await execute(program, args, { timeoutMs: policy.timeoutMs }),
      policy,
    );
    results.push({ id, program, args, testInventory, ...result });
    if (!commandPassed(result)) {
      safeguardFailure(id, result);
      break;
    }
  }

  const after = implementationSnapshot(selected, commands);
  const implementationStable = implementationManifestsEqual(before, after);
  const implementation = {
    algorithm: "sha256",
    stable: implementationStable,
    contentHash: before.contentHash,
    afterContentHash: after.contentHash,
    changedPaths: changedInputs(before, after),
    files: before.files,
  };
  if (!implementationStable) {
    console.error("implementation inputs changed while the profile was running");
  }

  const liveArtifacts = outputArtifacts(selected, commands);
  const artifacts = {
    ...liveArtifacts,
    archive: liveArtifacts.complete
      ? archiveOutputArtifacts(profile, liveArtifacts)
      : null,
  };
  if (artifacts.archive) {
    validateAgenticArtifactArchive({ profile, artifacts });
  }
  const allRan = results.length === selected.length;
  const passed =
    allRan &&
    implementationStable &&
    artifacts.complete &&
    results.every(commandPassed);
  if (!artifacts.complete) {
    console.error(
      `required outputs missing or invalid: ${[
        ...artifacts.missingPaths,
        ...artifacts.invalidPaths,
      ].join(", ")}`,
    );
  }
  const receipt = {
    schemaVersion: 4,
    runId,
    adapter: "oxigraph-agentic-qe",
    agenticQeVersion: aqeVersion,
    profile,
    generatedAt: new Date().toISOString(),
    repository: {
      root: repoRoot,
      gitHead,
      worktreeDirty: Boolean(worktreeStatus),
      rdfTestsCommit,
      rdfCanonTestsCommit,
    },
    implementation,
    authority: {
      verdict: "profile-defined native, standards, and differential commands",
      commands: selected.map((id) => ({
        id,
        program: commands[id][0],
        role: commandAuthority(id, commands[id][0]),
      })),
      adapterRole: "native-command-coordination-and-receipt",
      agenticQeRole: "version-pinned-presence-gate-and-optional-advisory-generator",
    },
    runtime,
    commands: results,
    artifacts,
    publication,
    passed,
  };
  receipt.contentHash = agenticReceiptContentHash(receipt);
  receipt.executionHash = agenticReceiptExecutionHash(receipt);
  validateAgenticReceipt(receipt, {
    expectedProfile: profile,
    expectedAgenticQeVersion: EXPECTED_AGENTIC_QE_VERSION,
    expectedCommandIds: selected,
    expectedCommands: commands,
  });

  const receiptPublication = atomicJson(receiptPath, receipt, { replace: false });
  if (
    !receiptPublication.bytes.equals(agenticReceiptBytes(receipt))
  ) {
    throw new Error("published Agentic-QE receipt serialization drifted");
  }
  const oracle = {
    schemaVersion: 1,
    profile,
    runId,
    passed,
    baselinePassed: passed,
    contentHash: receipt.contentHash,
    executionHash: receipt.executionHash,
    receiptSha256: receiptPublication.sha256,
  };
  validateAgenticOracle(oracle, receipt, receiptPublication.bytes);
  atomicJson(oraclePath, oracle, { replace: false });
  validateAgenticPublication(receipt);
  atomicJson(latestReceiptPath, receipt);
  atomicJson(latestOraclePath, oracle);
  console.log(`\nReceipt: ${relative(repoRoot, receiptPath)}`);
  console.log(`Oracle:  ${relative(repoRoot, oraclePath)}`);
  console.log(`Content: ${receipt.contentHash}`);
  console.log(`Execution: ${receipt.executionHash}`);
  if (!passed) process.exitCode = 1;
}

async function generateCandidate(sourceArg) {
  if (!sourceArg) throw new Error("candidate requires a Rust source path");
  const { sourceRelative } = resolveRustSource(sourceArg);
  await probeAqe();
  const destination = uniqueCandidateDestination(sourceRelative);
  const result = await execute(
    aqeBin,
    [
      "test",
      "generate",
      sourceRelative,
      "--framework",
      "rust-test",
      "--type",
      "unit",
      "--format",
      "json",
      "--output",
      destination,
    ],
    {
      timeoutMs: 300_000,
      env: {
        AQE_MEMORY_BACKEND: "memory",
        AQE_V3_MODE: "true",
      },
    },
  );
  if (result.code !== 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`Candidate: ${relative(repoRoot, destination)}`);
  auditCandidate(destination);
}

function auditCandidate(pathArg) {
  const sourcePath = resolveAuditInput(pathArg);
  const result = JSON.parse(readFileSync(sourcePath, "utf8"));
  const findings = [];
  const tests = Array.isArray(result.tests) ? result.tests : [];
  if (tests.length === 0) findings.push({ severity: "error", code: "no-tests" });
  for (const test of tests) {
    if (test.language !== "rust" || test.framework !== "rust-test") {
      findings.push({
        severity: "error",
        code: "not-rust-test",
        test: test.name,
      });
    }
    if (typeof test.testCode !== "string" || !test.testCode.trim()) {
      findings.push({
        severity: "error",
        code: "empty-test-code",
        test: test.name,
      });
    } else if (/^rust\s*\n/.test(test.testCode)) {
      findings.push({
        severity: "error",
        code: "bare-language-prefix",
        test: test.name,
        detail: "Generated code starts with `rust` outside a Markdown fence.",
      });
    }
    const gate = test.qualityGateResult;
    if (
      gate?.passed === true &&
      gate.issues?.some((issue) => issue.severity === "error")
    ) {
      findings.push({
        severity: "error",
        code: "contradictory-quality-gate",
        test: test.name,
      });
    }
  }

  const accepted = !findings.some((finding) => finding.severity === "error");
  const audit = {
    schemaVersion: 2,
    source: relative(repoRoot, sourcePath),
    sourceSha256: sha256(readFileSync(sourcePath)),
    generatedAt: new Date().toISOString(),
    accepted,
    findings,
    policy:
      "Candidate generation is advisory; compile, native tests, and frozen conformance oracles are mandatory before adoption.",
  };
  const auditPath = auditOutputFor(sourcePath);
  atomicJson(auditPath, audit);
  console.log(`Audit:     ${relative(repoRoot, auditPath)}`);
  console.log(`Accepted:  ${accepted}`);
  return audit;
}

async function main() {
  const [action = "help", arg] = process.argv.slice(2);
  if (action === "help" || action === "--help" || action === "-h") {
    usage();
  } else if (action === "probe") {
    console.log(await probeAqe());
  } else if (action === "run") {
    await runProfile(arg ?? "existing");
  } else if (action === "candidate") {
    await generateCandidate(arg);
  } else if (action === "audit") {
    auditCandidate(arg);
  } else {
    usage();
    throw new Error(`Unknown action: ${action}`);
  }
}

main().catch((error) => {
  console.error(`oxigraph-aqe: ${error.message}`);
  process.exitCode = 1;
});
