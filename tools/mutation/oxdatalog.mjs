#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  changedInputs,
  createExclusiveDirectoryInside,
  currentRuntimeProvenance,
  ensureDirectoryInside,
  EXPECTED_CARGO_MUTANTS_VERSION,
  MUTATION_RECEIPT_SCHEMA_VERSION,
  mutationReceiptContentHash,
  mutationReceiptBytes,
  mutationReceiptExecutionHash,
  portable,
  readStableFileBytes,
  rejectSymlinksUnder,
  sha256,
  snapshotProtectedInputs,
  validateMutationPublication,
  validateMutationReceipt,
  validateMutantInventory,
  validateOutcomes,
  writeJsonAtomic,
} from "./evidence.mjs";
import { runProcess } from "./process.mjs";
import {
  createMutationPublication,
  publishMutationPublication,
} from "./publication.mjs";

export const EXPECTED_TOOL_VERSION = EXPECTED_CARGO_MUTANTS_VERSION;
export const PROFILE = "oxdatalog-d2-complete";
export const DEFAULT_OUTER_TIMEOUT_MS = 3_600_000;
const toolDir = realpathSync(dirname(fileURLToPath(import.meta.url)));
export const repoRoot = realpathSync(resolve(toolDir, "../.."));
const configPath = join(toolDir, "oxdatalog.toml");
const outputRoot = join(repoRoot, "target", "mutation", "oxdatalog");
const receiptPath = join(outputRoot, "receipt.json");

async function runCargoMutants(args, options = {}) {
  return runProcess("cargo", ["mutants", ...args], {
    cwd: repoRoot,
    ...options,
  });
}

async function installedVersion() {
  const result = await runCargoMutants(["--version"], {
    capture: true,
    timeoutMs: 30_000,
  });
  if (result.error?.code === "ENOENT" || result.status !== 0 || result.timedOut) {
    throw new Error(
      `cargo-mutants ${EXPECTED_TOOL_VERSION} is required; install it with:\n` +
        `cargo install --locked cargo-mutants --version ${EXPECTED_TOOL_VERSION}`,
    );
  }
  const match = /^cargo-mutants ([^\s]+)\r?$/m.exec(result.stdout);
  if (!match || match[1] !== EXPECTED_TOOL_VERSION) {
    throw new Error(
      `cargo-mutants ${EXPECTED_TOOL_VERSION} is required, found ` +
        `${match?.[1] ?? "an unknown version"}`,
    );
  }
  return match[1];
}

function usage() {
  console.log(`Oxigraph Datalog D0-D2 mutation-competence lane

Usage:
  node tools/mutation/oxdatalog.mjs [--jobs <count>] [--outer-timeout-seconds <seconds>] [--list]

Options:
  --jobs <count>  Parallel cargo-mutants jobs (default: 2, maximum: 8)
  --outer-timeout-seconds <seconds>
                  Whole cargo-mutants process-tree ceiling (default: 3600;
                  accepted range: 30 through 7200)
  --list          List the reviewed mutation inventory without executing it
  --help          Show this help

Prerequisite:
  cargo install --locked cargo-mutants --version ${EXPECTED_TOOL_VERSION}

The gate requires a stable protected-input snapshot, one passing baseline,
complete and internally consistent native outcomes, at least one mutant, zero
missed mutants, and zero timed-out mutants.`);
}

function parseArgs(values) {
  const args = { jobs: 2, list: false, outerTimeoutMs: DEFAULT_OUTER_TIMEOUT_MS };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--help") {
      usage();
      return null;
    }
    if (value === "--list") {
      args.list = true;
      continue;
    }
    if (value === "--jobs") {
      const raw = values[index + 1];
      if (!/^[1-8]$/.test(raw ?? "")) {
        throw new Error("--jobs must be an integer from 1 through 8");
      }
      args.jobs = Number(raw);
      index += 1;
      continue;
    }
    if (value === "--outer-timeout-seconds") {
      const raw = values[index + 1];
      if (!/^\d+$/.test(raw ?? "") || Number(raw) < 30 || Number(raw) > 7200) {
        throw new Error("--outer-timeout-seconds must be from 30 through 7200");
      }
      args.outerTimeoutMs = Number(raw) * 1000;
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${value}`);
  }
  return args;
}

async function listInventory(commonArgs, version, timeoutMs) {
  const before = snapshotProtectedInputs(repoRoot);
  const result = await runCargoMutants([...commonArgs, "--list", "--json"], {
    capture: true,
    timeoutMs,
  });
  const after = snapshotProtectedInputs(repoRoot);
  const changedPaths = changedInputs(before, after);
  if (result.timedOut) throw new Error(`mutation inventory exceeded ${timeoutMs} ms`);
  if (result.status !== 0 || result.error) {
    process.stderr.write(result.stderr);
    throw new Error("cargo-mutants inventory failed");
  }
  if (changedPaths.length > 0) {
    throw new Error(`protected inputs changed during inventory: ${changedPaths.join(", ")}`);
  }
  const mutants = JSON.parse(result.stdout);
  validateMutantInventory(mutants);
  const inventoryPath = join(outputRoot, "inventory.json");
  writeJsonAtomic(
    inventoryPath,
    {
      profile: PROFILE,
      cargoMutantsVersion: version,
      generatedMutants: mutants.length,
      protectedInputs: { before, after, stable: true, changedPaths },
      mutants,
    },
    repoRoot,
  );
  console.log(
    `${PROFILE}: ${mutants.length} reviewed mutants\n` +
      `${portable(relative(repoRoot, inventoryPath))}`,
  );
}

function buildReceipt(
  runId,
  outcomes,
  outcomeBytes,
  inventoryBytes,
  configBytes,
  validation,
  command,
  runtime,
  version,
  before,
  after,
  nativeOutcomes,
  nativeInventory,
) {
  const changedPaths = changedInputs(before, after);
  const implementationStable =
    before.contentHash === after.contentHash && changedPaths.length === 0;
  const viable = validation.caught + validation.missed + validation.timeout;
  const gateClosed =
    command.status === 0 &&
    !command.timedOut &&
    implementationStable &&
    validation.baselinePassed &&
    validation.generated > 0 &&
    validation.missed === 0 &&
    validation.timeout === 0;
  return {
    schemaVersion: MUTATION_RECEIPT_SCHEMA_VERSION,
    runId,
    profile: PROFILE,
    gateClosed,
    baselinePassed: validation.baselinePassed,
    baselineSummary: validation.baselineSummary,
    cargoMutantsVersion: version,
    expectedCargoMutantsVersion: EXPECTED_TOOL_VERSION,
    command: {
      status: command.status,
      signal: command.signal,
      timedOut: command.timedOut,
      outerTimeoutMs: command.timeoutMs,
      startedAt: command.startedAt,
      endedAt: command.endedAt,
      durationMs: command.durationMs,
    },
    runtime,
    startedAt: outcomes.start_time,
    endedAt: outcomes.end_time,
    protectedInputs: {
      before,
      after,
      stable: implementationStable,
      changedPaths,
    },
    counts: {
      generated: validation.generated,
      caught: validation.caught,
      missed: validation.missed,
      timeout: validation.timeout,
      unviable: validation.unviable,
      viable,
    },
    mutationScorePercent:
      viable === 0
        ? null
        : Number(((validation.caught / viable) * 100).toFixed(2)),
    evidence: {
      nativeOutcomes: portable(relative(repoRoot, nativeOutcomes)),
      nativeOutcomesSha256: sha256(outcomeBytes),
      nativeInventory: portable(relative(repoRoot, nativeInventory)),
      nativeInventorySha256: sha256(inventoryBytes),
      config: portable(relative(repoRoot, configPath)),
      configSha256: sha256(configBytes),
    },
    publication: createMutationPublication(runId, {
      outcomeBytes,
      inventoryBytes,
      configBytes,
    }),
    limitations: [
      "The lane covers the generic Datalog D0-D2 crate; RDFS, OWL, SHACL, and Store integration have separate gates.",
      "Compiler-rejected unviable mutants are reported but do not measure test competence.",
      "The receipt reflects one host and toolchain run; CI must rerun it for merge evidence.",
      "Jena and Soufflé differential evidence remains a separate conformance condition.",
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) return;
  const version = await installedVersion();
  const safeOutputRoot = ensureDirectoryInside(repoRoot, outputRoot);
  const commonArgs = [
    "--config",
    configPath,
    "--package",
    "oxdatalog",
    "--colors",
    "never",
    "--annotations",
    "none",
  ];
  if (args.list) {
    rejectSymlinksUnder(safeOutputRoot);
    await listInventory(commonArgs, version, args.outerTimeoutMs);
    return;
  }

  const runId = randomUUID();
  const nativeParent = ensureDirectoryInside(
    repoRoot,
    join(safeOutputRoot, "native"),
  );
  const nativeRunRoot = createExclusiveDirectoryInside(
    repoRoot,
    join(nativeParent, runId),
  );
  const nativeOutput = join(nativeRunRoot, "mutants.out");
  const nativeOutcomes = join(nativeOutput, "outcomes.json");
  const nativeInventory = join(nativeOutput, "mutants.json");
  const before = snapshotProtectedInputs(repoRoot);
  const command = await runCargoMutants(
    [
      ...commonArgs,
      "--baseline",
      "run",
      "--jobs",
      String(args.jobs),
      "--output",
      nativeRunRoot,
    ],
    { timeoutMs: args.outerTimeoutMs },
  );
  const after = snapshotProtectedInputs(repoRoot);
  if (command.timedOut) {
    throw new Error(`cargo-mutants exceeded its ${command.timeoutMs} ms outer timeout`);
  }
  rejectSymlinksUnder(nativeRunRoot);
  const outcomeBytes = readStableFileBytes(nativeRunRoot, nativeOutcomes);
  const inventoryBytes = readStableFileBytes(nativeRunRoot, nativeInventory);
  const outcomes = JSON.parse(outcomeBytes);
  const inventory = JSON.parse(inventoryBytes);
  const runtime = currentRuntimeProvenance();
  const validation = validateOutcomes(outcomes, version, inventory, {
    cargoPath: runtime[0].toolchainPath ?? runtime[0].path,
  });
  const configBytes = readStableFileBytes(repoRoot, configPath);
  const configName = portable(relative(repoRoot, configPath));
  const snapshottedConfig = after.files.find(
    (file) => file.path === configName,
  );
  if (
    snapshottedConfig?.sha256 !== sha256(configBytes) ||
    snapshottedConfig.bytes !== configBytes.length
  ) {
    throw new Error("mutation config differs from the protected input snapshot");
  }
  const receipt = buildReceipt(
    runId,
    outcomes,
    outcomeBytes,
    inventoryBytes,
    configBytes,
    validation,
    command,
    runtime,
    version,
    before,
    after,
    nativeOutcomes,
    nativeInventory,
  );
  receipt.contentHash = mutationReceiptContentHash(receipt);
  receipt.executionHash = mutationReceiptExecutionHash(receipt);
  if (receipt.gateClosed) {
    validateMutationReceipt(receipt, {
      currentSnapshot: after,
      outcomes,
      inventory,
      outcomeBytes,
      inventoryBytes,
      configBytes,
      expectedVersion: version,
      expectedRuntime: runtime,
    });
  }
  const receiptBytes = mutationReceiptBytes(receipt);
  const immutable = publishMutationPublication(receipt, {
    repositoryRoot: repoRoot,
    receiptBytes,
    outcomeBytes,
    inventoryBytes,
    configBytes,
  });
  if (receipt.gateClosed) {
    validateMutationPublication(receipt, {
      repositoryRoot: repoRoot,
      currentContentHash: after.contentHash,
      expectedVersion: version,
      expectedRuntime: runtime,
    });
  }
  writeJsonAtomic(receiptPath, receipt, repoRoot);
  console.log(
    `${PROFILE}: ${receipt.gateClosed ? "PASS" : "FAIL"}\n` +
      `caught=${receipt.counts.caught} missed=${receipt.counts.missed} ` +
      `timeout=${receipt.counts.timeout} unviable=${receipt.counts.unviable}\n` +
      `receipt=${portable(relative(repoRoot, receiptPath))}\n` +
      `immutableReceipt=${immutable.publication.receiptPath}`,
  );
  process.exitCode = receipt.gateClosed ? 0 : command.status || 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
