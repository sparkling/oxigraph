import {
  MUTATION_RECEIPT_SCHEMA_VERSION,
  mutationPublicationStructureMatches,
  readMutationFileBytes,
  readMutationPublication,
} from "./publication.mjs";
import {
  strictNativeTimestampMs,
  validateMutantInventory,
  validateOutcomes,
} from "./native-evidence.mjs";
import {
  assertCurrentInventoryMatches,
  listCurrentMutationInventory,
} from "./inventory-check.mjs";
import {
  assertExactCurrentSnapshots,
  changedInputs,
  currentRuntimeProvenance,
  executableProvenance,
  protectedSnapshotValid,
  sha256,
  snapshotFile,
  snapshotProtectedInputs,
} from "./source-snapshot.mjs";
import {
  createExclusiveDirectoryInside,
  ensureDirectoryInside,
  isInside,
  portable,
  readStableFileBytes,
  regularFileInside,
  rejectSymlinksUnder,
  writeJsonAtomic,
} from "./path-policy.mjs";

const PROFILE = "oxdatalog-d2-complete";
const CONFIG_PATH = "tools/mutation/oxdatalog.toml";
const RECEIPT_KEYS = [
  "schemaVersion",
  "runId",
  "profile",
  "gateClosed",
  "baselinePassed",
  "baselineSummary",
  "cargoMutantsVersion",
  "expectedCargoMutantsVersion",
  "command",
  "runtime",
  "startedAt",
  "endedAt",
  "protectedInputs",
  "counts",
  "mutationScorePercent",
  "evidence",
  "publication",
  "limitations",
  "contentHash",
  "executionHash",
];

function exactKeySet(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function strictWrapperTimestampMs(value, field) {
  if (typeof value !== "string") {
    throw new Error(`mutation wrapper ${field} is missing`);
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw new Error(`mutation wrapper ${field} is not canonical ISO-8601`);
  }
  return milliseconds;
}

function expectedEvidencePaths(runId) {
  const native = `target/mutation/oxdatalog/native/${runId}/mutants.out`;
  return {
    nativeOutcomes: `${native}/outcomes.json`,
    nativeInventory: `${native}/mutants.json`,
    config: CONFIG_PATH,
  };
}

function runtimeRecordShape(record, program) {
  if (
    record === null ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.program !== program ||
    typeof record.invokedPath !== "string" ||
    record.invokedPath.length === 0 ||
    typeof record.path !== "string" ||
    record.path.length === 0 ||
    !/^[0-9a-f]{64}$/.test(record.executableSha256 ?? "") ||
    typeof record.version !== "string" ||
    record.version.length === 0
  ) {
    return false;
  }
  const baseKeys = [
    "program",
    "invokedPath",
    "path",
    "executableSha256",
    "version",
  ];
  const hasToolchain =
    Object.hasOwn(record, "toolchainPath") ||
    Object.hasOwn(record, "toolchainExecutableSha256");
  const keys = hasToolchain
    ? [...baseKeys, "toolchainPath", "toolchainExecutableSha256"]
    : baseKeys;
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Object.hasOwn(record, key)) &&
    (!hasToolchain ||
      (["cargo", "rustc"].includes(program) &&
        typeof record.toolchainPath === "string" &&
        record.toolchainPath.length > 0 &&
        /^[0-9a-f]{64}$/.test(record.toolchainExecutableSha256 ?? "")))
  );
}

export function parseCargoMutantsVersion(output) {
  if (typeof output !== "string") return null;
  return /^cargo-mutants ([^\s]+)\r?$/m.exec(output)?.[1] ?? null;
}

function validateRuntime(runtime, expectedRuntime) {
  const programs = ["cargo", "cargo-mutants", "rustc"];
  if (
    !Array.isArray(runtime) ||
    runtime.length !== programs.length ||
    !runtime.every((record, index) =>
      runtimeRecordShape(record, programs[index]),
    )
  ) {
    throw new Error("mutation receipt has invalid executable provenance");
  }
  if (
    expectedRuntime &&
    JSON.stringify(runtime) !== JSON.stringify(expectedRuntime)
  ) {
    throw new Error("mutation executable provenance differs from current tools");
  }
  const cargoMutantsVersion = parseCargoMutantsVersion(runtime[1].version);
  if (cargoMutantsVersion === null) {
    throw new Error("mutation cargo-mutants provenance has an invalid version");
  }
  return {
    cargoPath: runtime[0].toolchainPath ?? runtime[0].path,
    cargoMutantsVersion,
  };
}

function validateTimes(receipt, outcomes) {
  const wrapperStarted = strictWrapperTimestampMs(
    receipt.command?.startedAt,
    "startedAt",
  );
  const wrapperEnded = strictWrapperTimestampMs(
    receipt.command?.endedAt,
    "endedAt",
  );
  const nativeStarted = strictNativeTimestampMs(receipt.startedAt, "start_time");
  const nativeEnded = strictNativeTimestampMs(receipt.endedAt, "end_time");
  const wrapperWallDuration = wrapperEnded - wrapperStarted;
  if (
    receipt.startedAt !== outcomes.start_time ||
    receipt.endedAt !== outcomes.end_time ||
    wrapperEnded < wrapperStarted ||
    nativeStarted < wrapperStarted ||
    nativeEnded < nativeStarted ||
    nativeEnded > wrapperEnded ||
    nativeEnded - nativeStarted > receipt.command.outerTimeoutMs ||
    wrapperEnded - wrapperStarted > receipt.command.outerTimeoutMs + 5_000 ||
    !Number.isSafeInteger(receipt.command.durationMs) ||
    receipt.command.durationMs < 0 ||
    receipt.command.durationMs > receipt.command.outerTimeoutMs ||
    Math.abs(receipt.command.durationMs - wrapperWallDuration) > 2_000
  ) {
    throw new Error("mutation wrapper and native timestamps are inconsistent");
  }
}

function validateEvidencePathsAndHashes(
  receipt,
  outcomeBytes,
  inventoryBytes,
  configBytes,
) {
  const expected = expectedEvidencePaths(receipt.runId);
  if (
    !exactKeySet(receipt.evidence, [
      "nativeOutcomes",
      "nativeOutcomesSha256",
      "nativeInventory",
      "nativeInventorySha256",
      "config",
      "configSha256",
    ]) ||
    receipt.evidence.nativeOutcomes !== expected.nativeOutcomes ||
    receipt.evidence.nativeInventory !== expected.nativeInventory ||
    receipt.evidence.config !== expected.config ||
    receipt.evidence.nativeOutcomesSha256 !== sha256(outcomeBytes) ||
    receipt.evidence.nativeInventorySha256 !== sha256(inventoryBytes) ||
    receipt.evidence.configSha256 !== sha256(configBytes)
  ) {
    throw new Error("mutation receipt evidence paths or hashes are invalid");
  }
}

function validateSourceBinding(receipt, currentSnapshot, configBytes) {
  assertExactCurrentSnapshots(
    receipt.protectedInputs?.before,
    receipt.protectedInputs?.after,
    currentSnapshot,
  );
  if (
    !exactKeySet(receipt.protectedInputs, [
      "before",
      "after",
      "stable",
      "changedPaths",
    ]) ||
    receipt.protectedInputs.stable !== true ||
    !Array.isArray(receipt.protectedInputs.changedPaths) ||
    receipt.protectedInputs.changedPaths.length !== 0 ||
    changedInputs(
      receipt.protectedInputs.before,
      receipt.protectedInputs.after,
    ).length !== 0
  ) {
    throw new Error("mutation protected inputs are not stable");
  }
  const currentConfig = snapshotFile(currentSnapshot, CONFIG_PATH);
  if (
    currentConfig.sha256 !== sha256(configBytes) ||
    currentConfig.bytes !== configBytes.length
  ) {
    throw new Error("immutable mutation config differs from current source");
  }
}

export function mutationReceiptContentHash(receipt) {
  const command = receipt.command;
  return sha256(
    JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      profile: receipt.profile,
      gateClosed: receipt.gateClosed,
      baselinePassed: receipt.baselinePassed,
      baselineSummary: receipt.baselineSummary,
      cargoMutantsVersion: receipt.cargoMutantsVersion,
      expectedCargoMutantsVersion: receipt.expectedCargoMutantsVersion,
      command: {
        status: command?.status,
        signal: command?.signal,
        timedOut: command?.timedOut,
        outerTimeoutMs: command?.outerTimeoutMs,
      },
      runtime: receipt.runtime,
      protectedInputs: receipt.protectedInputs,
      counts: receipt.counts,
      mutationScorePercent: receipt.mutationScorePercent,
      evidence: receipt.evidence,
      limitations: receipt.limitations,
    }),
  );
}

export function mutationReceiptExecutionHash(receipt) {
  return sha256(
    JSON.stringify({
      runId: receipt.runId,
      contentHash: receipt.contentHash,
      command: {
        startedAt: receipt.command?.startedAt,
        endedAt: receipt.command?.endedAt,
        durationMs: receipt.command?.durationMs,
      },
      startedAt: receipt.startedAt,
      endedAt: receipt.endedAt,
      publication: receipt.publication,
    }),
  );
}

export function mutationReceiptBytes(receipt) {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
}

export function validateMutationReceipt(
  receipt,
  {
    currentSnapshot,
    currentContentHash,
    outcomes,
    inventory,
    outcomeBytes,
    inventoryBytes,
    configBytes,
    expectedVersion = receipt?.cargoMutantsVersion,
    expectedRuntime,
  },
) {
  if (
    !exactKeySet(receipt, RECEIPT_KEYS) ||
    receipt.schemaVersion !== MUTATION_RECEIPT_SCHEMA_VERSION ||
    !mutationPublicationStructureMatches(receipt) ||
    receipt.profile !== PROFILE ||
    receipt.gateClosed !== true ||
    receipt.baselinePassed !== true ||
    receipt.baselineSummary !== "Success" ||
    receipt.cargoMutantsVersion !== expectedVersion ||
    receipt.expectedCargoMutantsVersion !== expectedVersion ||
    !exactKeySet(receipt.command, [
      "status",
      "signal",
      "timedOut",
      "outerTimeoutMs",
      "startedAt",
      "endedAt",
      "durationMs",
    ]) ||
    receipt.command.status !== 0 ||
    receipt.command.signal !== null ||
    receipt.command.timedOut !== false ||
    !Number.isSafeInteger(receipt.command.outerTimeoutMs) ||
    receipt.command.outerTimeoutMs < 30_000 ||
    receipt.command.outerTimeoutMs > 7_200_000 ||
    !protectedSnapshotValid(currentSnapshot) ||
    (currentContentHash !== undefined &&
      currentContentHash !== currentSnapshot.contentHash)
  ) {
    throw new Error("mutation receipt failed its gate or current-source contract");
  }
  const runtime = validateRuntime(receipt.runtime, expectedRuntime);
  if (runtime.cargoMutantsVersion !== expectedVersion) {
    throw new Error(
      "mutation cargo-mutants provenance version differs from the receipt",
    );
  }
  const validation = validateOutcomes(outcomes, expectedVersion, inventory, {
    cargoPath: runtime.cargoPath,
  });
  validateTimes(receipt, outcomes);
  validateEvidencePathsAndHashes(
    receipt,
    outcomeBytes,
    inventoryBytes,
    configBytes,
  );
  validateSourceBinding(receipt, currentSnapshot, configBytes);
  const viable = validation.caught + validation.missed + validation.timeout;
  const expectedScore = Number(
    ((validation.caught / viable) * 100).toFixed(2),
  );
  if (
    viable < 1 ||
    !exactKeySet(receipt.counts, [
      "generated",
      "caught",
      "missed",
      "timeout",
      "unviable",
      "viable",
    ]) ||
    receipt.counts.generated !== validation.generated ||
    receipt.counts.caught !== validation.caught ||
    receipt.counts.missed !== validation.missed ||
    receipt.counts.timeout !== validation.timeout ||
    receipt.counts.unviable !== validation.unviable ||
    receipt.counts.viable !== viable ||
    receipt.counts.missed !== 0 ||
    receipt.counts.timeout !== 0 ||
    receipt.mutationScorePercent !== expectedScore ||
    !Array.isArray(receipt.limitations) ||
    receipt.limitations.length === 0 ||
    receipt.limitations.some(
      (limitation) => typeof limitation !== "string" || limitation.length === 0,
    ) ||
    receipt.contentHash !== mutationReceiptContentHash(receipt) ||
    receipt.executionHash !== mutationReceiptExecutionHash(receipt)
  ) {
    throw new Error("mutation receipt failed its native evidence contract");
  }
  return validation;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes);
  } catch {
    throw new Error(`immutable mutation ${label} is not valid JSON`);
  }
}

export function validateMutationPublication(
  receipt,
  {
    repositoryRoot,
    currentContentHash,
    expectedVersion = receipt?.cargoMutantsVersion,
    expectedRuntime = currentRuntimeProvenance(),
    inventoryLister = listCurrentMutationInventory,
  },
) {
  const publication = readMutationPublication(receipt, { repositoryRoot });
  if (!publication.receiptBytes.equals(mutationReceiptBytes(receipt))) {
    throw new Error("immutable mutation receipt bytes differ from the receipt");
  }
  const outcomes = parseJson(publication.outcomeBytes, "outcomes");
  const inventory = parseJson(publication.inventoryBytes, "inventory");
  const currentInventory = inventoryLister(repositoryRoot, {
    expectedVersion,
  });
  assertExactCurrentSnapshots(
    currentInventory.before,
    currentInventory.after,
    currentInventory.after,
  );
  assertCurrentInventoryMatches(inventory, currentInventory.inventory);
  const currentSnapshot = currentInventory.after;
  const validation = validateMutationReceipt(receipt, {
    currentSnapshot,
    currentContentHash,
    outcomes,
    inventory,
    outcomeBytes: publication.outcomeBytes,
    inventoryBytes: publication.inventoryBytes,
    configBytes: publication.configBytes,
    expectedVersion,
    expectedRuntime,
  });
  return { ...publication, outcomes, inventory, validation };
}

export {
  changedInputs,
  createExclusiveDirectoryInside,
  currentRuntimeProvenance,
  ensureDirectoryInside,
  executableProvenance,
  isInside,
  MUTATION_RECEIPT_SCHEMA_VERSION,
  portable,
  protectedSnapshotValid,
  readMutationFileBytes,
  readStableFileBytes,
  regularFileInside,
  rejectSymlinksUnder,
  sha256,
  snapshotProtectedInputs,
  validateMutantInventory,
  validateOutcomes,
  writeJsonAtomic,
};
