import { createHash } from "node:crypto";
import {
  lastNonemptyBoundedTestOutputLine,
  MAX_CARGO_SUMMARIES,
  MAX_CARGO_TEST_IDS,
  MAX_CARGO_TEST_ID_TOTAL_BYTES,
  normalizeCargoTestObservation,
  parseCargoTestIds,
  parseCargoTestSummaries,
} from "./native-test-contract.mjs";
import { parseNodeTestSummary } from "./node-test-contract.mjs";
import { runtimeProgramPlan } from "./runtime-plan.mjs";

const CHILD_ENVIRONMENT_POLICY = "inherited-safe-name-allowlist-v1";
const DIGEST = /^[0-9a-f]{64}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROFILE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;
const EXACT_SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DEPENDENCY_KEYS = Object.freeze([
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
  "installedPackageJsonSha256",
]);

export const agenticDependencyEvidenceNames = Object.freeze({
  manifest: "agentic-dependency-manifest.json",
  lockfile: "agentic-dependency-lock.json",
  npmrc: "agentic-dependency-npmrc",
  installedPackageJson: "agentic-dependency-installed-package.json",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
  const segments = path.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function parseJsonBytes(bytes, label) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error(`${label} is not a byte buffer`);
  }
  try {
    return JSON.parse(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function exactVersionValid(value) {
  const match = typeof value === "string" ? EXACT_SEMVER.exec(value) : null;
  return (
    match !== null &&
    !(
      match[4] !== undefined &&
      match[4]
        .split(".")
        .some(
          (part) => /^\d+$/u.test(part) && part.length > 1 && part[0] === "0",
        )
    )
  );
}

function sha512IntegrityValid(value) {
  if (typeof value !== "string" || !value.startsWith("sha512-")) return false;
  const encoded = value.slice("sha512-".length);
  const digest = Buffer.from(encoded, "base64");
  return digest.length === 64 && digest.toString("base64") === encoded;
}

function lifecyclePolicyValid(bytes) {
  return (
    Buffer.isBuffer(bytes) &&
    /^ignore-scripts=true\r?\n?$/u.test(bytes.toString("utf8"))
  );
}

export function validateAgenticDependencyEvidence({
  dependency,
  manifestBytes,
  lockfileBytes,
  npmrcBytes,
  installedPackageJsonBytes,
}) {
  if (
    dependency === null ||
    typeof dependency !== "object" ||
    Array.isArray(dependency) ||
    JSON.stringify(Object.keys(dependency)) !==
      JSON.stringify(DEPENDENCY_KEYS) ||
    dependency.name !== "agentic-qe" ||
    dependency.policy !== "latest" ||
    !exactVersionValid(dependency.version) ||
    dependency.resolved !==
      `https://registry.npmjs.org/agentic-qe/-/agentic-qe-${dependency.version}.tgz` ||
    !sha512IntegrityValid(dependency.integrity) ||
    dependency.manifest !== "tools/agentic-qe/package.json" ||
    dependency.lockfile !== "tools/agentic-qe/package-lock.json" ||
    dependency.npmrc !== "tools/agentic-qe/.npmrc" ||
    ![
      manifestBytes,
      lockfileBytes,
      npmrcBytes,
      installedPackageJsonBytes,
    ].every(Buffer.isBuffer) ||
    !lifecyclePolicyValid(npmrcBytes) ||
    sha256(manifestBytes) !== dependency.manifestSha256 ||
    sha256(lockfileBytes) !== dependency.lockfileSha256 ||
    sha256(npmrcBytes) !== dependency.npmrcSha256 ||
    sha256(installedPackageJsonBytes) !== dependency.installedPackageJsonSha256
  ) {
    throw new Error("Agentic-QE dependency evidence is invalid");
  }
  const manifest = parseJsonBytes(manifestBytes, "Agentic-QE adapter manifest");
  const lockfile = parseJsonBytes(lockfileBytes, "Agentic-QE adapter lockfile");
  const installed = parseJsonBytes(
    installedPackageJsonBytes,
    "installed Agentic-QE manifest",
  );
  const root = lockfile?.packages?.[""];
  const locked = lockfile?.packages?.["node_modules/agentic-qe"];
  if (
    lockfile?.lockfileVersion !== 3 ||
    manifest?.dependencies?.["agentic-qe"] !== "latest" ||
    root?.dependencies?.["agentic-qe"] !== "latest" ||
    locked?.version !== dependency.version ||
    locked?.resolved !== dependency.resolved ||
    locked?.integrity !== dependency.integrity ||
    installed?.name !== dependency.name ||
    installed?.version !== dependency.version
  ) {
    throw new Error("Agentic-QE dependency resolution is inconsistent");
  }
  const contentHash = sha256(
    JSON.stringify({
      dependency,
      manifestSha256: sha256(manifestBytes),
      lockfileSha256: sha256(lockfileBytes),
      npmrcSha256: sha256(npmrcBytes),
      installedPackageJsonSha256: sha256(installedPackageJsonBytes),
    }),
  );
  return Object.freeze({ dependency, contentHash });
}

export function implementationManifestValid(manifest) {
  if (
    manifest === null ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.algorithm !== "sha256" ||
    !Array.isArray(manifest.files)
  ) {
    return false;
  }
  let previous = "";
  for (const file of manifest.files) {
    if (
      JSON.stringify(Object.keys(file ?? {})) !==
        JSON.stringify(["path", "bytes", "sha256"]) ||
      !portableRelativePath(file.path) ||
      file.path <= previous ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      typeof file.sha256 !== "string" ||
      !DIGEST.test(file.sha256 ?? "")
    ) {
      return false;
    }
    previous = file.path;
  }
  return (
    DIGEST.test(manifest.contentHash ?? "") &&
    manifest.contentHash ===
      sha256(
        JSON.stringify(
          manifest.files.map(({ path, bytes, sha256: digest }) => ({
            path,
            bytes,
            sha256: digest,
          })),
        ),
      )
  );
}

export function publicationStructureMatches(receipt) {
  const root = `target/agentic-qe/${receipt?.profile}/runs/${receipt?.runId}`;
  return (
    receipt?.publication?.schemaVersion === 1 &&
    receipt.publication.immutable === true &&
    receipt.publication.root === root &&
    receipt.publication.receiptPath === `${root}/receipt.json` &&
    receipt.publication.oraclePath === `${root}/oracle.json`
  );
}

export function archiveStructureMatches(receipt) {
  const artifacts = receipt?.artifacts;
  const archive = artifacts?.archive;
  if (
    artifacts?.algorithm !== "sha256" ||
    artifacts?.complete !== true ||
    !Array.isArray(artifacts.files) ||
    !Array.isArray(artifacts.missingPaths) ||
    artifacts.missingPaths.length !== 0 ||
    !Array.isArray(artifacts.invalidPaths) ||
    artifacts.invalidPaths.length !== 0 ||
    artifacts.contentHash !== sha256(JSON.stringify(artifacts.files)) ||
    archive?.algorithm !== "sha256" ||
    archive.complete !== true ||
    !Array.isArray(archive.files) ||
    archive.files.length !== artifacts.files.length ||
    !Number.isSafeInteger(archive.totalBytes) ||
    archive.totalBytes < 0 ||
    archive.totalBytes > 64 * 1024 * 1024 ||
    !DIGEST.test(archive.contentHash ?? "")
  ) {
    return false;
  }
  if (!PROFILE.test(receipt?.profile ?? "")) return false;
  const expectedRoot = `target/agentic-qe/${receipt.profile}/artifacts/${artifacts.contentHash}`;
  if (archive.root !== expectedRoot) return false;
  let totalBytes = 0;
  let previousSource = "";
  const seen = new Set();
  for (const [index, file] of archive.files.entries()) {
    const source = artifacts.files[index];
    const expectedPath = `${expectedRoot}/${String(index).padStart(4, "0")}.bin`;
    if (
      source === null ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      !portableRelativePath(source.path) ||
      source.path <= previousSource ||
      !Number.isSafeInteger(source.bytes) ||
      source.bytes < 0 ||
      !DIGEST.test(source.sha256 ?? "") ||
      file === null ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      seen.has(file.sourcePath) ||
      file.sourcePath !== source.path ||
      file.path !== expectedPath ||
      file.bytes !== source.bytes ||
      file.sha256 !== source.sha256
    ) {
      return false;
    }
    previousSource = source.path;
    seen.add(file.sourcePath);
    totalBytes += file.bytes;
  }
  return (
    totalBytes === archive.totalBytes &&
    archive.contentHash === sha256(JSON.stringify(archive.files))
  );
}

export function stableCommandResult(result) {
  const {
    id,
    program,
    args,
    code,
    signal,
    spawnError,
    timedOut,
    cleanupUnconfirmed,
    terminationReason,
    terminationSignalError,
    killAttempted,
    outputLimitExceeded,
    scanLimitExceeded,
    scanFailureReason,
    outputLimitBytes,
    timeoutMs,
    testSafeguard,
    testInventory,
  } = result;
  return {
    id,
    program,
    args,
    code,
    signal,
    spawnFailed: spawnError !== null,
    timedOut,
    cleanupUnconfirmed,
    terminationReason,
    terminationSignalError,
    killAttempted,
    outputLimitExceeded,
    scanLimitExceeded,
    scanFailureReason,
    outputLimitBytes,
    timeoutMs,
    testSafeguard: testSafeguard ?? null,
    testInventory:
      testInventory === null || testInventory === undefined
        ? null
        : {
            observedTests: testInventory.observedTests,
            ids: testInventory.ids,
          },
  };
}

export function outputBinding(result) {
  return {
    id: result.id,
    ...result.output,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
    testInventoryOutput:
      result.testInventory === null || result.testInventory === undefined
        ? null
        : {
            ...result.testInventory.output,
            outputLimitBytes: result.testInventory.outputLimitBytes,
            stdoutTail: result.testInventory.stdoutTail,
            stderrTail: result.testInventory.stderrTail,
          },
  };
}

export function agenticReceiptContentHash(receipt) {
  return sha256(
    JSON.stringify({
      schemaVersion: receipt.schemaVersion,
      adapter: receipt.adapter,
      agenticQeVersion: receipt.agenticQeVersion,
      profile: receipt.profile,
      repository: {
        gitHead: receipt.repository?.gitHead,
        worktreeDirty: receipt.repository?.worktreeDirty,
        rdfTestsCommit: receipt.repository?.rdfTestsCommit,
        rdfCanonTestsCommit: receipt.repository?.rdfCanonTestsCommit,
      },
      implementation: receipt.implementation,
      authority: receipt.authority,
      commands: receipt.commands?.map(stableCommandResult),
      passed: receipt.passed,
    }),
  );
}

export function agenticReceiptExecutionHash(receipt) {
  return sha256(
    JSON.stringify({
      runId: receipt.runId,
      contentHash: receipt.contentHash,
      publication: receipt.publication,
      outputs: receipt.commands?.map(outputBinding),
      artifacts: receipt.artifacts,
      runtime: receipt.runtime,
    }),
  );
}

export function agenticRuntimeContentHash(runtime) {
  return sha256(JSON.stringify(runtime));
}

export function agenticReceiptBytes(receipt) {
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  if (bytes.length > MAX_AGENTIC_RECEIPT_BYTES) {
    throw new Error("Agentic-QE receipt exceeds its serialized byte ceiling");
  }
  return bytes;
}

export function agenticOracleBytes(oracle) {
  const bytes = Buffer.from(`${JSON.stringify(oracle, null, 2)}\n`, "utf8");
  if (bytes.length > MAX_AGENTIC_ORACLE_BYTES) {
    throw new Error("Agentic-QE oracle exceeds its serialized byte ceiling");
  }
  return bytes;
}

export function validateAgenticOracle(oracle, receipt, receiptBytes) {
  const bytes = receiptBytes ?? agenticReceiptBytes(receipt);
  if (
    oracle === null ||
    typeof oracle !== "object" ||
    Array.isArray(oracle) ||
    oracle.schemaVersion !== 1 ||
    oracle.profile !== receipt?.profile ||
    oracle.runId !== receipt?.runId ||
    oracle.passed !== true ||
    oracle.baselinePassed !== true ||
    oracle.contentHash !== receipt?.contentHash ||
    oracle.executionHash !== receipt?.executionHash ||
    oracle.receiptSha256 !== sha256(bytes)
  ) {
    throw new Error("Agentic-QE oracle does not bind the exact receipt");
  }
  return oracle;
}

const PROCESS_OUTPUT_KEYS = Object.freeze([
  "stdoutBytes",
  "stderrBytes",
  "stdoutSha256",
  "stderrSha256",
]);
const PROCESS_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const PROCESS_TAIL_UTF8_LIMIT_BYTES = PROCESS_OUTPUT_LIMIT_BYTES;
export const MAX_AGENTIC_RETAINED_OUTPUT_BYTES = 32 * 1024 * 1024;
export const MAX_AGENTIC_RECEIPT_BYTES = 64 * 1024 * 1024;
export const MAX_AGENTIC_ORACLE_BYTES = 64 * 1024;

function aggregateRetainedOutputValid(commands) {
  if (!Array.isArray(commands)) return false;
  let total = 0;
  for (const command of commands) {
    for (const owner of [command, command?.testInventory]) {
      if (owner === null || owner === undefined) continue;
      if (
        typeof owner.stdoutTail !== "string" ||
        typeof owner.stderrTail !== "string"
      ) {
        return false;
      }
      total += Buffer.byteLength(owner.stdoutTail, "utf8");
      total += Buffer.byteLength(owner.stderrTail, "utf8");
      if (
        !Number.isSafeInteger(total) ||
        total > MAX_AGENTIC_RETAINED_OUTPUT_BYTES
      ) {
        return false;
      }
    }
  }
  return true;
}

function processOutputValid(owner, requireComplete) {
  const output = owner?.output;
  if (
    JSON.stringify(Object.keys(output ?? {})) !==
      JSON.stringify(PROCESS_OUTPUT_KEYS) ||
    owner?.outputLimitBytes !== PROCESS_OUTPUT_LIMIT_BYTES ||
    typeof owner.stdoutTail !== "string" ||
    typeof owner.stderrTail !== "string" ||
    !Number.isSafeInteger(output.stdoutBytes) ||
    output.stdoutBytes < 0 ||
    !Number.isSafeInteger(output.stderrBytes) ||
    output.stderrBytes < 0 ||
    output.stdoutBytes + output.stderrBytes > PROCESS_OUTPUT_LIMIT_BYTES ||
    !DIGEST.test(output.stdoutSha256 ?? "") ||
    !DIGEST.test(output.stderrSha256 ?? "")
  ) {
    return false;
  }
  const stdout = Buffer.from(owner.stdoutTail, "utf8");
  const stderr = Buffer.from(owner.stderrTail, "utf8");
  if (
    stdout.length > PROCESS_TAIL_UTF8_LIMIT_BYTES ||
    stderr.length > PROCESS_TAIL_UTF8_LIMIT_BYTES ||
    stdout.length > output.stdoutBytes ||
    stderr.length > output.stderrBytes
  ) {
    return false;
  }
  const stdoutComplete = stdout.length === output.stdoutBytes;
  const stderrComplete = stderr.length === output.stderrBytes;
  if (
    (stdoutComplete && sha256(stdout) !== output.stdoutSha256) ||
    (stderrComplete && sha256(stderr) !== output.stderrSha256)
  ) {
    return false;
  }
  return requireComplete !== true || (stdoutComplete && stderrComplete);
}

function cargoObservationFromCompleteOutput(command) {
  const summaries = [
    ...parseCargoTestSummaries(command.stdoutTail).map((summary) => ({
      ...summary,
      stream: "stdout",
    })),
    ...parseCargoTestSummaries(command.stderrTail).map((summary) => ({
      ...summary,
      stream: "stderr",
    })),
  ];
  if (summaries.length > MAX_CARGO_SUMMARIES) {
    throw new Error("Cargo summaries exceed their combined replay ceiling");
  }
  const terminalLine = lastNonemptyBoundedTestOutputLine(command.stdoutTail);
  return normalizeCargoTestObservation(
    summaries,
    summaries.length > 0 && parseCargoTestSummaries(terminalLine).length === 1,
    "stream",
  );
}

function cargoInventoryIdsFromCompleteOutput(inventory) {
  const ids = [
    ...parseCargoTestIds(inventory.stdoutTail),
    ...parseCargoTestIds(inventory.stderrTail),
  ];
  if (
    ids.length > MAX_CARGO_TEST_IDS ||
    ids.reduce((total, id) => total + Buffer.byteLength(id, "utf8"), 0) >
      MAX_CARGO_TEST_ID_TOTAL_BYTES
  ) {
    throw new Error("Cargo test IDs exceed their combined replay ceiling");
  }
  return ids.sort();
}

function nodeSafeguardReplaysCompleteOutput(command) {
  try {
    const observed = command.testSafeguard?.observed;
    return (
      JSON.stringify(parseNodeTestSummary(command.stdoutTail)) ===
      JSON.stringify(observed)
    );
  } catch {
    return false;
  }
}

function cargoSafeguardReplaysCompleteOutput(command) {
  try {
    return (
      JSON.stringify(cargoObservationFromCompleteOutput(command)) ===
        JSON.stringify(command.testSafeguard?.observed) &&
      JSON.stringify(
        cargoInventoryIdsFromCompleteOutput(command.testInventory),
      ) === JSON.stringify(command.testInventory?.ids)
    );
  } catch {
    return false;
  }
}

const CARGO_SUMMARY_KEYS = Object.freeze([
  "stream",
  "status",
  "passed",
  "failed",
  "ignored",
  "measured",
  "filteredOut",
]);
const CARGO_TOTAL_KEYS = Object.freeze([
  "passed",
  "failed",
  "ignored",
  "measured",
  "filteredOut",
]);

function cargoSafeguardMatchesPolicy(safeguard, policy) {
  const observed = safeguard?.observed;
  const summaries = observed?.summaries;
  const expectedSummaryCount = policy.expectedCargoSummaryCount ?? null;
  if (
    safeguard?.format !== "cargo-libtest-v1" ||
    safeguard.minimumPassedTests !== policy.minimumPassedTests ||
    safeguard.expectedPassedTests !== policy.expectedPassedTests ||
    safeguard.observedPassedTests !== policy.expectedPassedTests ||
    safeguard.expectedSummaryCount !== expectedSummaryCount ||
    !Array.isArray(summaries) ||
    summaries.length === 0 ||
    summaries.length > 4_096 ||
    safeguard.observedSummaryCount !== summaries.length ||
    observed?.source !== "stream" ||
    observed.summaryCount !== summaries.length ||
    observed.terminal !== true ||
    observed.countsSafe !== true ||
    observed.allSuccessful !== true ||
    observed.allOnStdout !== true ||
    safeguard.passed !== true ||
    (expectedSummaryCount !== null &&
      summaries.length !== expectedSummaryCount) ||
    (expectedSummaryCount === null && summaries.length < 1)
  ) {
    return false;
  }
  const totals = Object.fromEntries(
    CARGO_TOTAL_KEYS.map((field) => [field, 0]),
  );
  for (const summary of summaries) {
    if (
      JSON.stringify(Object.keys(summary ?? {})) !==
        JSON.stringify(CARGO_SUMMARY_KEYS) ||
      summary.stream !== "stdout" ||
      summary.status !== "ok" ||
      summary.failed !== 0
    ) {
      return false;
    }
    for (const field of CARGO_TOTAL_KEYS) {
      if (!Number.isSafeInteger(summary[field]) || summary[field] < 0) {
        return false;
      }
      const total = totals[field] + summary[field];
      if (!Number.isSafeInteger(total)) return false;
      totals[field] = total;
    }
  }
  const outcomeCount =
    totals.passed + totals.failed + totals.ignored + totals.measured;
  return (
    Number.isSafeInteger(outcomeCount) &&
    observed.outcomeCount === outcomeCount &&
    outcomeCount === policy.expectedPassedTests &&
    totals.passed === policy.expectedPassedTests &&
    JSON.stringify(observed.totals) === JSON.stringify(totals)
  );
}

function trustedCommandContractsValid(receipt, expectedCommands) {
  if (
    !expectedCommands ||
    typeof expectedCommands !== "object" ||
    Array.isArray(expectedCommands)
  ) {
    return false;
  }
  return receipt.commands.every((command) => {
    const definition = expectedCommands[command.id];
    if (!Array.isArray(definition) || definition.length < 2) return false;
    const [program, args, policy = {}] = definition;
    if (
      command.program !== program ||
      JSON.stringify(command.args) !== JSON.stringify(args) ||
      command.timeoutMs !== policy.timeoutMs ||
      !processOutputValid(command, policy.requireCompleteOutputReplay === true)
    ) {
      return false;
    }
    if (program === "cargo") {
      const safeguard = command.testSafeguard;
      const inventory = command.testInventory;
      const ids = inventory?.ids;
      const expectedIds = policy.expectedTestIds
        ? [...policy.expectedTestIds].sort()
        : null;
      const requiredIds = policy.requiredTestIds ?? null;
      const requiredIdsValid =
        requiredIds === null ||
        (expectedIds === null &&
          Array.isArray(requiredIds) &&
          requiredIds.length > 0 &&
          requiredIds.length <= policy.expectedPassedTests &&
          requiredIds.every(
            (testId) => typeof testId === "string" && testId.length > 0,
          ) &&
          new Set(requiredIds).size === requiredIds.length &&
          requiredIds.every((testId) => ids.includes(testId)));
      return (
        policy.requireCompleteOutputReplay === true &&
        cargoSafeguardMatchesPolicy(safeguard, policy) &&
        processOutputValid(
          inventory,
          policy.requireCompleteOutputReplay === true,
        ) &&
        inventory?.observedTests === policy.expectedPassedTests &&
        Array.isArray(ids) &&
        ids.length === policy.expectedPassedTests &&
        new Set(ids).size === ids.length &&
        JSON.stringify(ids) === JSON.stringify([...ids].sort()) &&
        (expectedIds === null ||
          JSON.stringify(ids) === JSON.stringify(expectedIds)) &&
        requiredIdsValid &&
        cargoSafeguardReplaysCompleteOutput(command)
      );
    }
    if (policy.expectedNodeTests !== undefined) {
      const safeguard = command.testSafeguard;
      const observed = safeguard?.observed;
      const expectedSuites = policy.expectedNodeSuites ?? 0;
      return (
        policy.requireCompleteOutputReplay === true &&
        command.testInventory === null &&
        safeguard?.format === "node-tap-v13" &&
        safeguard.minimumPassedTests === policy.expectedNodeTests &&
        safeguard.expectedPassedTests === policy.expectedNodeTests &&
        safeguard.observedPassedTests === policy.expectedNodeTests &&
        safeguard.expectedSuites === expectedSuites &&
        safeguard.passed === true &&
        observed?.duplicateOrMissing === false &&
        observed?.terminal === true &&
        observed?.summaryBlockCount === 1 &&
        observed?.conserved === true &&
        observed?.plan === policy.expectedNodeTests &&
        observed?.tests === policy.expectedNodeTests &&
        observed?.pass === policy.expectedNodeTests &&
        observed?.suites === expectedSuites &&
        observed?.fail === 0 &&
        observed?.cancelled === 0 &&
        observed?.skipped === 0 &&
        observed?.todo === 0 &&
        nodeSafeguardReplaysCompleteOutput(command)
      );
    }
    return (
      command.testInventory === null && command.testSafeguard === undefined
    );
  });
}

const HOST_RUNTIME_KEYS = Object.freeze([
  "program",
  "context",
  "invokedPath",
  "path",
  "executableSha256",
  "versionStdout",
  "versionStderr",
]);
const RUSTUP_RUNTIME_KEYS = Object.freeze([
  ...HOST_RUNTIME_KEYS,
  "toolchainPath",
  "toolchainExecutableSha256",
]);
const MISE_RUNTIME_KEYS = Object.freeze([
  "program",
  "context",
  "launcher",
  "invokedPath",
  "path",
  "executableSha256",
  "versionStdout",
  "versionStderr",
]);

function absoluteExecutablePath(value) {
  return (
    typeof value === "string" &&
    value.length > 1 &&
    value.length <= 32_768 &&
    !value.includes("\0") &&
    (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value))
  );
}

function versionEvidenceValid(record) {
  return (
    typeof record.versionStdout === "string" &&
    typeof record.versionStderr === "string" &&
    record.versionStdout.length <= 65_536 &&
    record.versionStderr.length <= 65_536 &&
    !record.versionStdout.includes("\0") &&
    !record.versionStderr.includes("\0") &&
    record.versionStdout === record.versionStdout.trim() &&
    record.versionStderr === record.versionStderr.trim() &&
    (record.versionStdout.length > 0 || record.versionStderr.length > 0)
  );
}

function runtimeRecordValid(record, expected, expectedAgenticQeVersion) {
  if (
    record === null ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    record.program !== expected.program ||
    record.context !== expected.context ||
    !absoluteExecutablePath(record.invokedPath) ||
    !absoluteExecutablePath(record.path) ||
    !DIGEST.test(record.executableSha256 ?? "") ||
    !versionEvidenceValid(record)
  ) {
    return false;
  }
  const keys = Object.keys(record);
  if (expected.context === "tools/jena-parity/.mise.toml") {
    return (
      JSON.stringify(keys) === JSON.stringify(MISE_RUNTIME_KEYS) &&
      record.launcher === "mise exec --"
    );
  }
  const extended = JSON.stringify(keys) === JSON.stringify(RUSTUP_RUNTIME_KEYS);
  if (JSON.stringify(keys) !== JSON.stringify(HOST_RUNTIME_KEYS) && !extended) {
    return false;
  }
  if (
    extended &&
    (!["cargo", "rustc"].includes(record.program) ||
      !absoluteExecutablePath(record.toolchainPath) ||
      !DIGEST.test(record.toolchainExecutableSha256 ?? ""))
  ) {
    return false;
  }
  return (
    record.program !== "agentic-qe" ||
    (record.versionStdout === expectedAgenticQeVersion &&
      record.versionStderr === "")
  );
}

function runtimeEvidenceValid(
  runtime,
  expectedRuntime,
  expectedRuntimeContentHash,
  expectedCommandIds,
  expectedCommands,
  expectedAgenticQeVersion,
) {
  if (
    !Array.isArray(runtime) ||
    !Array.isArray(expectedCommandIds) ||
    (expectedRuntime === undefined &&
      expectedRuntimeContentHash === undefined) ||
    (expectedRuntime !== undefined &&
      (!Array.isArray(expectedRuntime) ||
        JSON.stringify(runtime) !== JSON.stringify(expectedRuntime))) ||
    (expectedRuntimeContentHash !== undefined &&
      (!DIGEST.test(expectedRuntimeContentHash) ||
        agenticRuntimeContentHash(runtime) !== expectedRuntimeContentHash))
  )
    return false;
  const plan = runtimeProgramPlan(expectedCommandIds, expectedCommands);
  const expected = [
    ...plan.host.map((program) => ({ program, context: "host" })),
    ...plan.jenaParityMise.map((program) => ({
      program,
      context: "tools/jena-parity/.mise.toml",
    })),
    { program: "agentic-qe", context: "host" },
  ].sort((left, right) =>
    `${left.context}:${left.program}`.localeCompare(
      `${right.context}:${right.program}`,
    ),
  );
  return (
    runtime.length === expected.length &&
    runtime.every((record, index) =>
      runtimeRecordValid(record, expected[index], expectedAgenticQeVersion),
    )
  );
}

export function validateAgenticReceipt(
  receipt,
  {
    expectedProfile,
    expectedAgenticQeVersion,
    expectedAgenticQeDependency,
    expectedRuntime,
    expectedRuntimeContentHash,
    expectedCommandIds,
    expectedCommands,
    minimumGeneratedAtMs = 0,
    maximumGeneratedAtMs = Number.POSITIVE_INFINITY,
  },
) {
  const generatedAtMs = Date.parse(receipt?.generatedAt);
  const observedCommandIds = Array.isArray(receipt?.commands)
    ? receipt.commands.map((command) => command?.id)
    : [];
  const commandInventoryMatches =
    expectedCommandIds === undefined ||
    (Array.isArray(expectedCommandIds) &&
      expectedCommandIds.length > 0 &&
      JSON.stringify(observedCommandIds) ===
        JSON.stringify(expectedCommandIds));
  const retainedOutputValid = aggregateRetainedOutputValid(receipt?.commands);
  let serializedReceiptValid = false;
  if (retainedOutputValid) {
    try {
      serializedReceiptValid =
        agenticReceiptBytes(receipt).length <= MAX_AGENTIC_RECEIPT_BYTES;
    } catch {
      serializedReceiptValid = false;
    }
  }
  const trustedContractsValid =
    retainedOutputValid &&
    serializedReceiptValid &&
    Array.isArray(receipt?.commands) &&
    trustedCommandContractsValid(receipt, expectedCommands);
  if (
    !receipt ||
    typeof receipt !== "object" ||
    receipt.schemaVersion !== 5 ||
    receipt.adapter !== "oxigraph-agentic-qe" ||
    !UUID.test(receipt.runId ?? "") ||
    receipt.profile !== expectedProfile ||
    receipt.agenticQeVersion !== expectedAgenticQeVersion ||
    receipt.authority?.childEnvironmentPolicy !== CHILD_ENVIRONMENT_POLICY ||
    (expectedAgenticQeDependency !== undefined &&
      JSON.stringify(receipt.authority?.agenticQeDependency) !==
        JSON.stringify(expectedAgenticQeDependency)) ||
    receipt.passed !== true ||
    !Number.isFinite(minimumGeneratedAtMs) ||
    !(
      Number.isFinite(maximumGeneratedAtMs) ||
      maximumGeneratedAtMs === Number.POSITIVE_INFINITY
    ) ||
    maximumGeneratedAtMs < minimumGeneratedAtMs ||
    !Number.isFinite(generatedAtMs) ||
    new Date(generatedAtMs).toISOString() !== receipt.generatedAt ||
    generatedAtMs < minimumGeneratedAtMs ||
    generatedAtMs > maximumGeneratedAtMs ||
    receipt.implementation?.stable !== true ||
    !implementationManifestValid(receipt.implementation) ||
    receipt.implementation.contentHash !==
      receipt.implementation.afterContentHash ||
    !Array.isArray(receipt.implementation.changedPaths) ||
    receipt.implementation.changedPaths.length !== 0 ||
    receipt.artifacts?.complete !== true ||
    !Array.isArray(receipt.artifacts.missingPaths) ||
    receipt.artifacts.missingPaths.length !== 0 ||
    !Array.isArray(receipt.artifacts.invalidPaths) ||
    receipt.artifacts.invalidPaths.length !== 0 ||
    !publicationStructureMatches(receipt) ||
    !archiveStructureMatches(receipt) ||
    !Array.isArray(receipt.commands) ||
    receipt.commands.length === 0 ||
    !commandInventoryMatches ||
    !trustedContractsValid ||
    receipt.commands.some(
      (command) =>
        command?.code !== 0 ||
        command?.signal !== null ||
        command?.spawnError !== null ||
        command?.timedOut !== false ||
        command?.cleanupUnconfirmed !== false ||
        command?.terminationReason !== null ||
        command?.terminationSignalError !== null ||
        command?.killAttempted !== false ||
        command?.outputLimitExceeded !== false ||
        command?.scanLimitExceeded !== false ||
        command?.scanFailureReason !== null ||
        command?.testSafeguard?.passed === false,
    ) ||
    !runtimeEvidenceValid(
      receipt.runtime,
      expectedRuntime,
      expectedRuntimeContentHash,
      expectedCommandIds,
      expectedCommands,
      expectedAgenticQeVersion,
    ) ||
    receipt.contentHash !== agenticReceiptContentHash(receipt) ||
    receipt.executionHash !== agenticReceiptExecutionHash(receipt)
  ) {
    throw new Error("Agentic-QE receipt failed its execution or hash contract");
  }
  return receipt;
}
