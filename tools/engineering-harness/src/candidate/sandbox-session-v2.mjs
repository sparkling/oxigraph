import { createHash } from "node:crypto";
import { accessSync, constants, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, types as utilTypes } from "node:util";

import { runBoundedProcessBytes } from "../native/process.mjs";
import {
  MAX_LOGICAL_ARGV_ITEMS,
  MAX_TASK_ARG_BYTES,
} from "../policy/evidence-limits.mjs";
import { exactCargoBuildArtifactStemsV2 } from "../policy/build-command-v2.mjs";
import { canonicalJson } from "../routing/features.mjs";
import {
  V2_COMMAND_ARGV_BYTES_CEILING,
  V2_SESSION_CONFIGURATION_BYTES_CEILING,
} from "../policy/session-v2-limits.mjs";

const commandRolePattern = /^[a-z][a-z0-9-]{0,63}$/u;
const digestPattern = /^[0-9a-f]{64}$/u;
const artifactNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const maximumCommands = 16;
const maximumResultBytes = 256 * 1024 * 1024;
const resultEnvelopeBytes = 2 * 1024 * 1024;
const publicTailBytes = 16 * 1024;
const maximumArtifacts = 256;
const maximumClosureFileBytes = 16 * 1024 * 1024;
const maximumClosureBytes = 64 * 1024 * 1024;
const outputFloor = 1024;
const outputCeiling = 64 * 1024 * 1024;
const wallFloorMs = 1000;
const wallCeilingMs = 7_200_000;
const diskFloorBytes = 32 * 1024 * 1024;
const diskCeilingBytes = 128 * 1024 * 1024 * 1024;
const failureCodes = new Set([
  "CONFIGURATION",
  "PROCESS_PROOF",
  "TIME_BUDGET",
  "STATE_INVARIANT",
  "ARTIFACT_EVIDENCE",
  "RESULT_CEILING",
  "INTERNAL_FAIL_CLOSED",
]);
const bwrapExecutable = "/usr/bin/bwrap";
const prlimitExecutable = "/usr/bin/prlimit";
const systemdRunExecutable = "/usr/bin/systemd-run";
const workerSource = fileURLToPath(
  new URL("./sandbox-session-worker-v2.mjs", import.meta.url),
);
const seccompLauncherSource = fileURLToPath(
  new URL("./seccomp-launcher.py", import.meta.url),
);
const workerModuleSources = Object.freeze([
  Object.freeze({
    source: workerSource,
    destination: "/runner/candidate/sandbox-session-worker-v2.mjs",
  }),
  Object.freeze({
    source: fileURLToPath(new URL("../native/process.mjs", import.meta.url)),
    destination: "/runner/native/process.mjs",
  }),
  Object.freeze({
    source: fileURLToPath(
      new URL("../policy/build-command-v2.mjs", import.meta.url),
    ),
    destination: "/runner/policy/build-command-v2.mjs",
  }),
  Object.freeze({
    source: fileURLToPath(
      new URL("../policy/evidence-limits.mjs", import.meta.url),
    ),
    destination: "/runner/policy/evidence-limits.mjs",
  }),
  Object.freeze({
    source: fileURLToPath(
      new URL("../policy/session-v2-limits.mjs", import.meta.url),
    ),
    destination: "/runner/policy/session-v2-limits.mjs",
  }),
  Object.freeze({
    source: fileURLToPath(
      new URL("../policy/task-v2-failures.mjs", import.meta.url),
    ),
    destination: "/runner/policy/task-v2-failures.mjs",
  }),
  Object.freeze({
    source: fileURLToPath(new URL("../routing/features.mjs", import.meta.url)),
    destination: "/runner/routing/features.mjs",
  }),
]);
const executableClosureSources = Object.freeze([
  ...workerModuleSources,
  Object.freeze({
    source: seccompLauncherSource,
    destination: "/runner/seccomp-launcher.py",
  }),
]);
const trustedFaults = new WeakSet();
const trustedReports = new WeakSet();
const retainedSessionRoots = new Set();
const containmentReadiness = Object.freeze({
  status: "unavailable",
  reason: "co-located-cgroup-owner-unavailable",
});
const commandRecordKeys = Object.freeze([
  "role",
  "disposition",
  "firstTerminalReason",
  "spawned",
  "noChild",
  "exitCode",
  "signal",
  "closeCode",
  "closeSignal",
  "statusAgreement",
  "reaped",
  "directChildCleanupSafe",
  "processGroupQuiescent",
  "exitObserved",
  "closeObserved",
  "stdoutEof",
  "stderrEof",
  "stdinComplete",
  "captureComplete",
  "outputTruncated",
  "terminationErrorCount",
  "processErrorCount",
  "observedPassed",
  "stdoutBytes",
  "stdoutSha256",
  "stdoutBase64",
  "stderrBytes",
  "stderrSha256",
  "stderrBase64",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fail(label, detail) {
  throw new Error(`${label} is invalid: ${detail}`);
}

function ownDataRecord(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(label, "expected a plain own-data record");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== "string" || !keys.includes(key)) ||
    keys.some((key) => !actual.includes(key)) ||
    actual.some((key) => {
      const descriptor = descriptors[key];
      return !("value" in descriptor) || descriptor.enumerable !== true;
    })
  ) {
    fail(label, "fields are not exact enumerable data properties");
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function denseArray(value, label, { minimum = 0, maximum }) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    fail(label, "expected a plain dense array");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isInteger(length) || length < minimum || length > maximum) {
    fail(label, "array shape or length is invalid");
  }
  const keys = Reflect.ownKeys(descriptors);
  const expected = new Set([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== "string" || !expected.has(key)) ||
    keys.some((key) => key !== "length" && descriptors[key].enumerable !== true)
  ) {
    fail(label, "array shape or length is invalid");
  }
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (descriptor === undefined || !("value" in descriptor)) {
      fail(label, "array contains a non-data or missing element");
    }
    snapshot.push(descriptor.value);
  }
  return snapshot;
}

function boundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(label, "integer is outside its bound");
  }
  return value;
}

function isUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function snapshotConfiguration(value, label = "v2 session configuration") {
  const input = ownDataRecord(
    value,
    ["contractSha256", "verificationSequence", "commands", "ceilings"],
    label,
  );
  if (!digestPattern.test(input.contractSha256)) {
    fail(label, "contract digest is not exact lowercase SHA-256");
  }
  const roles = denseArray(input.verificationSequence, `${label} roles`, {
    minimum: 3,
    maximum: maximumCommands,
  });
  if (
    roles[0] !== "format" ||
    roles[1] !== "build" ||
    new Set(roles).size !== roles.length ||
    roles.some(
      (role) => typeof role !== "string" || !commandRolePattern.test(role),
    )
  ) {
    fail(label, "roles are not the exact generic verifier sequence");
  }
  const commandRecord = ownDataRecord(
    input.commands,
    roles,
    `${label} commands`,
  );
  const commands = {};
  for (const role of roles) {
    const command = ownDataRecord(
      commandRecord[role],
      ["argv", "timeoutMs"],
      `${label} command ${role}`,
    );
    const argv = denseArray(command.argv, `${label} command ${role} argv`, {
      minimum: 2,
      maximum: MAX_LOGICAL_ARGV_ITEMS,
    });
    let aggregateBytes = 0;
    if (
      argv[0] !== "cargo" ||
      argv.some((argument) => {
        if (
          typeof argument !== "string" ||
          argument.length === 0 ||
          !isUnicodeScalarString(argument) ||
          /[\u0000-\u001f\u007f]/u.test(argument) ||
          Buffer.byteLength(argument, "utf8") > MAX_TASK_ARG_BYTES
        ) {
          return true;
        }
        aggregateBytes += Buffer.byteLength(argument, "utf8");
        return false;
      }) ||
      aggregateBytes > V2_COMMAND_ARGV_BYTES_CEILING
    ) {
      fail(label, `command ${role} is not a bounded literal Cargo invocation`);
    }
    commands[role] = Object.freeze({
      argv: Object.freeze([...argv]),
      timeoutMs: boundedInteger(
        command.timeoutMs,
        `${label} command ${role} timeout`,
        wallFloorMs,
        wallCeilingMs,
      ),
    });
  }
  if (exactCargoBuildArtifactStemsV2(commands.build.argv) === undefined) {
    fail(label, "build command does not bind exact debug artifact targets");
  }
  const rawCeilings = ownDataRecord(
    input.ceilings,
    [
      "maxBuildOutputBytes",
      "maxTestOutputBytesPerCommand",
      "maxTotalVerifierWallMs",
      "maxVerifierDiskBytes",
      "cargoBuildJobs",
    ],
    `${label} ceilings`,
  );
  const ceilings = Object.freeze({
    maxBuildOutputBytes: boundedInteger(
      rawCeilings.maxBuildOutputBytes,
      `${label} build output ceiling`,
      outputFloor,
      outputCeiling,
    ),
    maxTestOutputBytesPerCommand: boundedInteger(
      rawCeilings.maxTestOutputBytesPerCommand,
      `${label} test output ceiling`,
      outputFloor,
      outputCeiling,
    ),
    maxTotalVerifierWallMs: boundedInteger(
      rawCeilings.maxTotalVerifierWallMs,
      `${label} total wall ceiling`,
      wallFloorMs,
      wallCeilingMs,
    ),
    maxVerifierDiskBytes: boundedInteger(
      rawCeilings.maxVerifierDiskBytes,
      `${label} disk ceiling`,
      diskFloorBytes,
      diskCeilingBytes,
    ),
    cargoBuildJobs: boundedInteger(
      rawCeilings.cargoBuildJobs,
      `${label} Cargo jobs`,
      1,
      16,
    ),
  });
  if (
    roles.some(
      (role) => commands[role].timeoutMs > ceilings.maxTotalVerifierWallMs,
    )
  ) {
    fail(label, "a command timeout exceeds the total wall ceiling");
  }
  const capturedBytes =
    ceilings.maxBuildOutputBytes +
    (roles.length - 1) * ceilings.maxTestOutputBytesPerCommand;
  const resultCeiling = Math.ceil(capturedBytes / 3) * 4 + resultEnvelopeBytes;
  if (resultCeiling > maximumResultBytes) {
    fail(label, "derived result ceiling exceeds the native byte limit");
  }
  return Object.freeze({
    schemaVersion: 2,
    contractSha256: input.contractSha256,
    verificationSequence: Object.freeze([...roles]),
    commands: Object.freeze(commands),
    ceilings,
    resultCeiling,
  });
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

function wireConfiguration(snapshot) {
  return Object.freeze({
    schemaVersion: snapshot.schemaVersion,
    contractSha256: snapshot.contractSha256,
    verificationSequence: snapshot.verificationSequence,
    commands: snapshot.commands,
    ceilings: snapshot.ceilings,
  });
}

export function encodeSandboxSessionConfigurationV2(value) {
  const snapshot = snapshotConfiguration(value);
  const bytes = canonicalBytes(wireConfiguration(snapshot));
  if (
    bytes.length < 1 ||
    bytes.length > V2_SESSION_CONFIGURATION_BYTES_CEILING
  ) {
    fail("v2 session configuration", "canonical bytes exceed their ceiling");
  }
  return bytes;
}

function privateBytes(value, label, maximum) {
  if (!Buffer.isBuffer(value) || utilTypes.isProxy(value)) {
    fail(label, "expected private Buffer bytes");
  }
  const bytes = Buffer.from(value);
  if (bytes.length < 1 || bytes.length > maximum) {
    fail(label, "byte length is outside its bound");
  }
  return bytes;
}

function decodeCanonical(bytesValue, label, maximum) {
  const bytes = privateBytes(bytesValue, label, maximum);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(label, "bytes are not exact UTF-8");
  }
  if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
    fail(label, "wire must be one LF-terminated JSON value");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(label, "wire is not JSON");
  }
  if (!bytes.equals(canonicalBytes(value))) {
    fail(label, "wire is not canonical JSON");
  }
  return Object.freeze({ bytes, value });
}

function configurationFromBytes(bytesValue) {
  const decoded = decodeCanonical(
    bytesValue,
    "v2 session configuration",
    V2_SESSION_CONFIGURATION_BYTES_CEILING,
  );
  const raw = ownDataRecord(
    decoded.value,
    [
      "schemaVersion",
      "contractSha256",
      "verificationSequence",
      "commands",
      "ceilings",
    ],
    "v2 session configuration",
  );
  if (raw.schemaVersion !== 2) {
    fail("v2 session configuration", "schemaVersion is not 2");
  }
  const snapshot = snapshotConfiguration({
    contractSha256: raw.contractSha256,
    verificationSequence: raw.verificationSequence,
    commands: raw.commands,
    ceilings: raw.ceilings,
  });
  if (!decoded.bytes.equals(canonicalBytes(wireConfiguration(snapshot)))) {
    fail("v2 session configuration", "wire projection is not exact");
  }
  return Object.freeze({ ...snapshot, bytes: decoded.bytes });
}

function exactNullableStatus(value, label, { integer = false } = {}) {
  if (value === null) return null;
  if (
    integer
      ? !Number.isInteger(value) || value < 0 || value > 255
      : typeof value !== "string"
  ) {
    fail("v2 session result", `${label} is invalid`);
  }
  if (!integer && (value.length === 0 || value.length > 64)) {
    fail("v2 session result", `${label} is invalid`);
  }
  return value;
}

function canonicalBase64(value, bytes, expectedDigest, label) {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    fail("v2 session result", `${label} base64 is not canonical`);
  }
  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    decoded.length !== bytes ||
    sha256(decoded) !== expectedDigest
  ) {
    fail("v2 session result", `${label} bytes do not match their evidence`);
  }
  return decoded;
}

function validCompletedProcessRecord(record) {
  return (
    record.disposition === "completed" &&
    record.firstTerminalReason === "completed" &&
    record.spawned === true &&
    record.noChild === false &&
    record.statusAgreement === true &&
    record.reaped === true &&
    record.directChildCleanupSafe === true &&
    record.processGroupQuiescent === true &&
    record.exitObserved === true &&
    record.closeObserved === true &&
    record.stdoutEof === true &&
    record.stderrEof === true &&
    record.stdinComplete === true &&
    record.captureComplete === true &&
    record.outputTruncated === false &&
    record.terminationErrorCount === 0 &&
    record.processErrorCount === 0 &&
    Number.isInteger(record.exitCode) &&
    record.signal === null &&
    record.closeSignal === null &&
    record.exitCode === record.closeCode &&
    record.signal === record.closeSignal
  );
}

function exactObservedPassed(role, record, stdout, stderr) {
  if (
    ["format", "build"].includes(role) ||
    record.exitCode !== 0 ||
    !validCompletedProcessRecord(record)
  ) {
    return null;
  }
  const lines = [];
  for (const bytes of [stdout, stderr]) {
    for (const line of bytes.toString("latin1").split("\n")) {
      if (line.startsWith("test result:")) lines.push(line);
    }
  }
  if (lines.length !== 1) return null;
  const match =
    /^test result: ok\. (0|[1-9][0-9]*) passed; 0 failed; (?:0|[1-9][0-9]*) ignored; (?:0|[1-9][0-9]*) measured; (?:0|[1-9][0-9]*) filtered out; finished in (?:0|[1-9][0-9]*)(?:\.[0-9]+)?s$/u.exec(
      lines[0],
    );
  if (match === null) return null;
  const passed = Number(match[1]);
  return Number.isSafeInteger(passed) ? passed : null;
}

function normalizeCommand(recordValue, role, outputCeiling) {
  const record = ownDataRecord(
    recordValue,
    commandRecordKeys,
    `v2 session result command ${role}`,
  );
  if (record.role !== role) {
    fail("v2 session result", "command records are not the exact role prefix");
  }
  for (const key of [
    "spawned",
    "noChild",
    "statusAgreement",
    "reaped",
    "directChildCleanupSafe",
    "processGroupQuiescent",
    "exitObserved",
    "closeObserved",
    "stdoutEof",
    "stderrEof",
    "stdinComplete",
    "captureComplete",
    "outputTruncated",
  ]) {
    if (typeof record[key] !== "boolean") {
      fail("v2 session result", `${role}.${key} is not boolean`);
    }
  }
  for (const key of ["terminationErrorCount", "processErrorCount"]) {
    boundedInteger(
      record[key],
      `v2 session result ${role}.${key}`,
      0,
      1_000_000,
    );
  }
  if (
    typeof record.disposition !== "string" ||
    record.disposition.length === 0 ||
    record.disposition.length > 64 ||
    typeof record.firstTerminalReason !== "string" ||
    record.firstTerminalReason.length === 0 ||
    record.firstTerminalReason.length > 64
  ) {
    fail("v2 session result", `${role} process classification is invalid`);
  }
  const exitCode = exactNullableStatus(record.exitCode, `${role}.exitCode`, {
    integer: true,
  });
  const closeCode = exactNullableStatus(record.closeCode, `${role}.closeCode`, {
    integer: true,
  });
  const signal = exactNullableStatus(record.signal, `${role}.signal`);
  const closeSignal = exactNullableStatus(
    record.closeSignal,
    `${role}.closeSignal`,
  );
  const stdoutBytes = boundedInteger(
    record.stdoutBytes,
    `v2 session result ${role}.stdoutBytes`,
    0,
    outputCeiling,
  );
  const stderrBytes = boundedInteger(
    record.stderrBytes,
    `v2 session result ${role}.stderrBytes`,
    0,
    outputCeiling,
  );
  if (
    stdoutBytes + stderrBytes > outputCeiling ||
    !digestPattern.test(record.stdoutSha256) ||
    !digestPattern.test(record.stderrSha256)
  ) {
    fail("v2 session result", `${role} output evidence exceeds its bound`);
  }
  const stdout = canonicalBase64(
    record.stdoutBase64,
    stdoutBytes,
    record.stdoutSha256,
    `${role} stdout`,
  );
  const stderr = canonicalBase64(
    record.stderrBase64,
    stderrBytes,
    record.stderrSha256,
    `${role} stderr`,
  );
  const observedPassed = exactObservedPassed(role, record, stdout, stderr);
  if (record.observedPassed !== observedPassed) {
    fail("v2 session result", `${role} typed pass count is not exact`);
  }
  return Object.freeze({
    role,
    disposition: record.disposition,
    firstTerminalReason: record.firstTerminalReason,
    spawned: record.spawned,
    noChild: record.noChild,
    exitCode,
    signal,
    closeCode,
    closeSignal,
    statusAgreement: record.statusAgreement,
    reaped: record.reaped,
    directChildCleanupSafe: record.directChildCleanupSafe,
    processGroupQuiescent: record.processGroupQuiescent,
    exitObserved: record.exitObserved,
    closeObserved: record.closeObserved,
    stdoutEof: record.stdoutEof,
    stderrEof: record.stderrEof,
    stdinComplete: record.stdinComplete,
    captureComplete: record.captureComplete,
    outputTruncated: record.outputTruncated,
    terminationErrorCount: record.terminationErrorCount,
    processErrorCount: record.processErrorCount,
    observedPassed,
    stdoutBytes,
    stdoutSha256: record.stdoutSha256,
    stdoutTailBase64: stdout.subarray(-publicTailBytes).toString("base64"),
    stderrBytes,
    stderrSha256: record.stderrSha256,
    stderrTailBase64: stderr.subarray(-publicTailBytes).toString("base64"),
  });
}

function normalizeArtifacts(values, maximumDiskBytes) {
  const artifacts = denseArray(values, "v2 session result artifacts", {
    maximum: maximumArtifacts,
  });
  let previous;
  let totalBytes = 0;
  return Object.freeze(
    artifacts.map((value, index) => {
      const artifact = ownDataRecord(
        value,
        ["name", "sha256", "bytes", "mode"],
        `v2 session result artifact ${index}`,
      );
      if (
        typeof artifact.name !== "string" ||
        !artifactNamePattern.test(artifact.name) ||
        artifact.name === "." ||
        artifact.name === ".." ||
        (previous !== undefined &&
          Buffer.compare(
            Buffer.from(previous, "utf8"),
            Buffer.from(artifact.name, "utf8"),
          ) >= 0) ||
        !digestPattern.test(artifact.sha256) ||
        !Number.isSafeInteger(artifact.bytes) ||
        artifact.bytes < 1 ||
        !Number.isInteger(artifact.mode) ||
        artifact.mode < 0 ||
        artifact.mode > 0o777 ||
        (artifact.mode & 0o111) === 0
      ) {
        fail("v2 session result", "artifact evidence is invalid or unsorted");
      }
      previous = artifact.name;
      totalBytes += artifact.bytes;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumDiskBytes) {
        fail("v2 session result", "artifact bytes exceed the disk ceiling");
      }
      return Object.freeze({ ...artifact });
    }),
  );
}

function artifactTargetNames(argv) {
  const targets = exactCargoBuildArtifactStemsV2(argv);
  if (targets === undefined || targets.length > maximumArtifacts) {
    fail("v2 session result", "build declares invalid exact artifact targets");
  }
  return targets;
}

function decodeResult(bytesValue, configuration) {
  const decoded = decodeCanonical(
    bytesValue,
    "v2 session result",
    configuration.resultCeiling,
  );
  const result = ownDataRecord(
    decoded.value,
    [
      "schemaVersion",
      "configurationSha256",
      "status",
      "stage",
      "commandCount",
      "commands",
      "artifacts",
      "stateBytes",
      "failure",
    ],
    "v2 session result",
  );
  if (
    result.schemaVersion !== 2 ||
    result.configurationSha256 !== sha256(configuration.bytes) ||
    !["completed", "failed"].includes(result.status) ||
    !["complete", ...configuration.verificationSequence].includes(result.stage)
  ) {
    fail("v2 session result", "top-level binding is invalid");
  }
  const records = denseArray(result.commands, "v2 session result commands", {
    maximum: configuration.verificationSequence.length,
  });
  if (
    !Number.isInteger(result.commandCount) ||
    result.commandCount !== records.length
  ) {
    fail("v2 session result", "command count does not match its array");
  }
  const commands = Object.freeze(
    records.map((record, index) => {
      const role = configuration.verificationSequence[index];
      const outputCeiling =
        role === "build"
          ? configuration.ceilings.maxBuildOutputBytes
          : configuration.ceilings.maxTestOutputBytesPerCommand;
      return normalizeCommand(record, role, outputCeiling);
    }),
  );
  const artifacts = normalizeArtifacts(
    result.artifacts,
    configuration.ceilings.maxVerifierDiskBytes,
  );
  const stateBytes =
    result.stateBytes === null
      ? null
      : boundedInteger(
          result.stateBytes,
          "v2 session result state bytes",
          0,
          configuration.ceilings.maxVerifierDiskBytes,
        );

  if (result.status === "completed") {
    if (
      result.failure !== null ||
      stateBytes === null ||
      commands.length === 0 ||
      commands.some((record) => !validCompletedProcessRecord(record))
    ) {
      fail("v2 session result", "completed session lacks exact process proof");
    }
    const failedControlIndex = commands.findIndex(
      (record, index) => index < 2 && record.exitCode !== 0,
    );
    const expectedStage =
      failedControlIndex === -1 &&
      commands.length === configuration.verificationSequence.length
        ? "complete"
        : configuration.verificationSequence[
            failedControlIndex === -1 ? commands.length - 1 : failedControlIndex
          ];
    if (
      result.stage !== expectedStage ||
      (failedControlIndex === -1 &&
        commands.length !== configuration.verificationSequence.length) ||
      (failedControlIndex !== -1 &&
        failedControlIndex !== commands.length - 1) ||
      (result.stage === "complete" &&
        commands.length !== configuration.verificationSequence.length)
    ) {
      fail("v2 session result", "stage disagrees with the attempted prefix");
    }
    if (result.stage === "complete" && artifacts.length === 0) {
      fail("v2 session result", "successful build has no exact artifacts");
    }
    if (result.stage === "complete") {
      const targets = artifactTargetNames(configuration.commands.build.argv);
      if (
        targets.some(
          (target) =>
            !artifacts.some(({ name }) => name.startsWith(`${target}-`)),
        )
      ) {
        fail("v2 session result", "artifact evidence omits a build target");
      }
    }
    if (commands.length < 2 || commands[1]?.exitCode !== 0) {
      if (artifacts.length !== 0) {
        fail("v2 session result", "artifacts exist before successful build");
      }
    }
  } else if (
    !failureCodes.has(result.failure) ||
    result.failure === "CONFIGURATION" ||
    result.stage === "complete" ||
    commands.length !== 0 ||
    artifacts.length !== 0
  ) {
    fail("v2 session result", "failed session classification is invalid");
  }

  return Object.freeze({
    bytes: decoded.bytes,
    session: Object.freeze({
      schemaVersion: 2,
      configurationSha256: result.configurationSha256,
      status: result.status,
      stage: result.stage,
      commandCount: commands.length,
      commands,
      artifacts,
      stateBytes,
      failure: result.failure,
    }),
  });
}

/** Test-only decoder. Production callers receive only the host session report. */
export function decodeSandboxSessionResultV2ForTesting(inputValue) {
  const input = ownDataRecord(
    inputValue,
    ["bytes", "configurationBytes"],
    "v2 session result decoder input",
  );
  const configuration = configurationFromBytes(input.configurationBytes);
  const decoded = decodeResult(input.bytes, configuration);
  return Object.freeze({
    resultSha256: sha256(decoded.bytes),
    resultBytes: decoded.bytes.length,
    session: decoded.session,
  });
}

function cleanupProof(outcome) {
  if (
    outcome === null ||
    typeof outcome !== "object" ||
    utilTypes.isProxy(outcome) ||
    Array.isArray(outcome) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(outcome))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(outcome);
  const keys = [
    "disposition",
    "firstTerminalReason",
    "spawned",
    "noChild",
    "exitCode",
    "signal",
    "closeCode",
    "closeSignal",
    "statusAgreement",
    "reaped",
    "directChildCleanupSafe",
    "processGroupQuiescent",
    "exitObserved",
    "closeObserved",
    "stdoutEof",
    "stderrEof",
    "stdinComplete",
    "captureComplete",
    "outputTruncated",
    "terminationErrors",
    "processErrors",
  ];
  if (
    keys.some(
      (key) => descriptors[key] === undefined || !("value" in descriptors[key]),
    )
  ) {
    return undefined;
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function cleanupSafe(outcome) {
  let proof;
  try {
    proof = cleanupProof(outcome);
  } catch {
    return false;
  }
  if (
    proof === undefined ||
    !Array.isArray(proof.terminationErrors) ||
    !Array.isArray(proof.processErrors) ||
    proof.terminationErrors.length !== 0 ||
    proof.outputTruncated !== false
  ) {
    return false;
  }
  if (proof.noChild === true) {
    const reasonIsCoherent =
      proof.firstTerminalReason === proof.disposition &&
      ((proof.disposition === "cancelled" &&
        proof.processErrors.length === 0) ||
        (proof.disposition === "spawn-error" &&
          proof.processErrors.length > 0));
    return (
      reasonIsCoherent &&
      proof.spawned === false &&
      proof.exitCode === null &&
      proof.signal === null &&
      proof.closeCode === null &&
      proof.closeSignal === null &&
      proof.statusAgreement === false &&
      proof.reaped === false &&
      proof.directChildCleanupSafe === true &&
      proof.processGroupQuiescent === true &&
      proof.exitObserved === false &&
      proof.closeObserved === false &&
      proof.stdoutEof === false &&
      proof.stderrEof === false &&
      typeof proof.stdinComplete === "boolean" &&
      proof.captureComplete === false
    );
  }
  const statusIsCoherent =
    proof.exitCode === proof.closeCode &&
    proof.signal === proof.closeSignal &&
    ((Number.isInteger(proof.exitCode) && proof.signal === null) ||
      (proof.exitCode === null &&
        typeof proof.signal === "string" &&
        proof.signal.length > 0));
  return (
    proof.noChild === false &&
    proof.spawned === true &&
    proof.captureComplete === true &&
    proof.reaped === true &&
    proof.statusAgreement === true &&
    proof.directChildCleanupSafe === true &&
    proof.processGroupQuiescent === true &&
    proof.exitObserved === true &&
    proof.closeObserved === true &&
    proof.stdoutEof === true &&
    proof.stderrEof === true &&
    proof.stdinComplete === true &&
    proof.processErrors.length === 0 &&
    statusIsCoherent
  );
}

/** Pure test seam for the fail-closed direct-process cleanup predicate. */
export function sandboxSessionV2CleanupSafeForTesting(outcome) {
  return cleanupSafe(outcome);
}

function existing(path) {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function bindIfPresent(args, source, destination) {
  if (existing(source)) {
    args.push("--ro-bind", realpathSync(source), destination);
  }
}

function structuralSandboxArguments({
  workspace,
  outputFile,
  ceilings,
  executableClosure,
}) {
  const home = userInfo().homedir;
  const cargo = join(home, ".cargo");
  const rustup = join(home, ".rustup");
  for (const path of [bwrapExecutable, workspace, outputFile, cargo, rustup]) {
    accessSync(path, constants.R_OK);
  }
  if (
    !Array.isArray(executableClosure) ||
    executableClosure.length !== executableClosureSources.length ||
    executableClosure.some(
      (record, index) =>
        record?.destination !== executableClosureSources[index].destination ||
        !Number.isInteger(record?.handle?.fd),
    )
  ) {
    throw new Error("v2 executable closure transport is not exact");
  }
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--uid",
    "0",
    "--gid",
    "0",
    "--unshare-net",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "CAP_SYS_ADMIN",
    "--cap-add",
    "CAP_SETPCAP",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/bin",
    "/bin",
    "--ro-bind",
    "/lib",
    "/lib",
  ];
  bindIfPresent(args, "/lib64", "/lib64");
  bindIfPresent(args, "/etc", "/etc");
  args.push(
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--remount-ro",
    "/dev",
    "--size",
    String(ceilings.maxVerifierDiskBytes),
    "--tmpfs",
    "/state",
    "--dir",
    "/state/cargo",
    "--dir",
    "/state/home",
    "--dir",
    "/state/target",
    "--dir",
    "/state/tmp",
  );
  bindIfPresent(args, join(cargo, "bin"), "/state/cargo/bin");
  bindIfPresent(args, join(cargo, "registry"), "/state/cargo/registry");
  bindIfPresent(args, join(cargo, "git"), "/state/cargo/git");
  bindIfPresent(
    args,
    join(cargo, ".global-cache"),
    "/state/cargo/.global-cache",
  );
  args.push(
    "--ro-bind",
    realpathSync(rustup),
    "/rustup",
    "--ro-bind",
    realpathSync(workspace),
    "/workspace",
    "--dir",
    "/runner",
    "--dir",
    "/runner/candidate",
    "--dir",
    "/runner/native",
    "--dir",
    "/runner/policy",
    "--dir",
    "/runner/routing",
  );
  for (const [index, { destination }] of executableClosure.entries()) {
    args.push("--ro-bind-fd", String(3 + index), destination);
  }
  args.push(
    "--dir",
    "/result",
    "--bind",
    realpathSync(outputFile),
    "/result/session.json",
    "--symlink",
    "/state/tmp",
    "/tmp",
    "--remount-ro",
    "/",
    "--chdir",
    "/workspace",
    "--setenv",
    "CARGO_BUILD_JOBS",
    String(ceilings.cargoBuildJobs),
    "--setenv",
    "CARGO_HOME",
    "/state/cargo",
    "--setenv",
    "CARGO_INCREMENTAL",
    "0",
    "--setenv",
    "CARGO_NET_OFFLINE",
    "true",
    "--setenv",
    "CARGO_PROFILE_TEST_DEBUG",
    "0",
    "--setenv",
    "CARGO_TARGET_DIR",
    "/state/target",
    "--setenv",
    "HOME",
    "/state/home",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "LC_ALL",
    "C.UTF-8",
    "--setenv",
    "PATH",
    "/state/cargo/bin:/usr/local/bin:/usr/bin:/bin",
    "--setenv",
    "RUSTUP_HOME",
    "/rustup",
    "--setenv",
    "SOURCE_DATE_EPOCH",
    "946684800",
    "--setenv",
    "TMPDIR",
    "/state/tmp",
    "--setenv",
    "USER",
    "sandbox",
    "--",
    "/usr/bin/node",
    "/runner/candidate/sandbox-session-worker-v2.mjs",
  );
  return Object.freeze(args);
}

function sessionEnvironment() {
  return Object.freeze({
    HOME: "/nonexistent",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/bin:/bin",
    XDG_RUNTIME_DIR: `/run/user/${
      typeof process.getuid === "function" ? process.getuid() : 1000
    }`,
  });
}

function invocationArguments(sandboxArguments, ceilings) {
  return Object.freeze([
    "--user",
    "--scope",
    "--quiet",
    "-p",
    "TasksMax=512",
    "-p",
    `MemoryMax=${ceilings.maxResidentBytes}`,
    "-p",
    "MemorySwapMax=0",
    "--",
    prlimitExecutable,
    "--core=0",
    `--fsize=${ceilings.maxVerifierDiskBytes}`,
    "--",
    bwrapExecutable,
    ...sandboxArguments,
  ]);
}

function normalizedInvocationArguments(args, workspace, outputFile) {
  return Object.freeze(
    args.map((argument) => {
      if (argument === workspace || argument === realpathSync(workspace)) {
        return "<candidate-workspace>";
      }
      if (argument === outputFile || argument === realpathSync(outputFile)) {
        return "<session-result>";
      }
      return argument;
    }),
  );
}

function processEvidence(outcome) {
  const stdout = Buffer.from(outcome?.stdout ?? Buffer.alloc(0));
  const stderr = Buffer.from(outcome?.stderr ?? Buffer.alloc(0));
  return Object.freeze({
    disposition:
      typeof outcome?.disposition === "string"
        ? outcome.disposition.slice(0, 64)
        : "invalid",
    firstTerminalReason:
      typeof outcome?.firstTerminalReason === "string"
        ? outcome.firstTerminalReason.slice(0, 64)
        : null,
    spawned: outcome?.spawned === true,
    noChild: outcome?.noChild === true,
    exitCode: Number.isInteger(outcome?.exitCode) ? outcome.exitCode : null,
    signal: typeof outcome?.signal === "string" ? outcome.signal : null,
    closeCode: Number.isInteger(outcome?.closeCode) ? outcome.closeCode : null,
    closeSignal:
      typeof outcome?.closeSignal === "string" ? outcome.closeSignal : null,
    statusAgreement: outcome?.statusAgreement === true,
    reaped: outcome?.reaped === true,
    directChildCleanupSafe: outcome?.directChildCleanupSafe === true,
    processGroupQuiescent: outcome?.processGroupQuiescent === true,
    exitObserved: outcome?.exitObserved === true,
    closeObserved: outcome?.closeObserved === true,
    stdoutEof: outcome?.stdoutEof === true,
    stderrEof: outcome?.stderrEof === true,
    stdinComplete: outcome?.stdinComplete === true,
    captureComplete: outcome?.captureComplete === true,
    outputTruncated: outcome?.outputTruncated === true,
    stdoutBytes: stdout.length,
    stdoutSha256: sha256(stdout),
    stderrBytes: stderr.length,
    stderrSha256: sha256(stderr),
    terminationErrorCount: Array.isArray(outcome?.terminationErrors)
      ? outcome.terminationErrors.length
      : 1,
    processErrorCount: Array.isArray(outcome?.processErrors)
      ? outcome.processErrors.length
      : 1,
  });
}

function statIdentity(metadata) {
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    links: metadata.nlink.toString(),
    mode: metadata.mode.toString(),
    owner: metadata.uid.toString(),
    group: metadata.gid.toString(),
    size: metadata.size.toString(),
    modifiedNs: metadata.mtimeNs.toString(),
    changedNs: metadata.ctimeNs.toString(),
  });
}

function validateClosureFile(metadata, label) {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1n ||
    (metadata.mode & 0o777n) !== 0o400n ||
    metadata.size < 1n ||
    metadata.size > BigInt(maximumClosureFileBytes) ||
    (typeof process.getuid === "function" &&
      metadata.uid !== BigInt(process.getuid()))
  ) {
    throw new Error(`${label} is not an exact private closure file`);
  }
}

async function readExactHandleBytes(handle, size, label) {
  if (
    typeof size !== "bigint" ||
    size < 1n ||
    size > BigInt(maximumClosureFileBytes)
  ) {
    throw new Error(`${label} size is outside its bound`);
  }
  const length = Number(size);
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(bytes, offset, length - offset, offset);
    if (result.bytesRead < 1) {
      throw new Error(`${label} ended before its retained size`);
    }
    offset += result.bytesRead;
  }
  const trailing = Buffer.allocUnsafe(1);
  const result = await handle.read(trailing, 0, 1, length);
  if (result.bytesRead !== 0) {
    throw new Error(`${label} grew beyond its retained size`);
  }
  return bytes;
}

async function closeClosureHandles(state, selected = [...state.handles]) {
  const errors = [];
  for (const handle of selected) {
    try {
      await state.closeHandle(handle);
      state.handles.delete(handle);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "v2 executable closure did not close");
  }
}

async function materializeExecutableClosure(sessionRoot, state) {
  const closureRoot = join(sessionRoot, "closure");
  await mkdir(closureRoot, { mode: 0o700 });
  let aggregateBytes = 0;
  for (const [index, sourceRecord] of executableClosureSources.entries()) {
    let sourceHandle;
    let writer;
    let retained;
    const label = `v2 executable closure entry ${index}`;
    try {
      sourceHandle = await open(
        sourceRecord.source,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      state.handles.add(sourceHandle);
      const [sourceBefore, sourceNamedBefore] = await Promise.all([
        sourceHandle.stat({ bigint: true }),
        lstat(sourceRecord.source, { bigint: true }),
      ]);
      if (
        !sourceBefore.isFile() ||
        sourceNamedBefore.isSymbolicLink() ||
        sourceBefore.size < 1n ||
        sourceBefore.size > BigInt(maximumClosureFileBytes) ||
        !samePinnedInode(
          statIdentity(sourceBefore),
          statIdentity(sourceNamedBefore),
        )
      ) {
        throw new Error(`${label} source is not a bounded regular file`);
      }
      aggregateBytes += Number(sourceBefore.size);
      if (aggregateBytes > maximumClosureBytes) {
        throw new Error("v2 executable closure exceeds its aggregate bound");
      }
      const bytes = await readExactHandleBytes(
        sourceHandle,
        sourceBefore.size,
        `${label} source`,
      );
      const [sourceAfter, sourceNamedAfter] = await Promise.all([
        sourceHandle.stat({ bigint: true }),
        lstat(sourceRecord.source, { bigint: true }),
      ]);
      if (
        !isDeepStrictEqual(
          statIdentity(sourceAfter),
          statIdentity(sourceBefore),
        ) ||
        !isDeepStrictEqual(
          statIdentity(sourceNamedAfter),
          statIdentity(sourceBefore),
        )
      ) {
        throw new Error(`${label} source changed while it was copied`);
      }
      await closeClosureHandles(state, [sourceHandle]);
      sourceHandle = undefined;

      const path = join(closureRoot, `entry-${index}`);
      writer = await open(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      state.handles.add(writer);
      await writer.writeFile(bytes);
      await writer.sync();
      await writer.chmod(0o400);
      await closeClosureHandles(state, [writer]);
      writer = undefined;

      retained = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      state.handles.add(retained);
      const [opened, named] = await Promise.all([
        retained.stat({ bigint: true }),
        lstat(path, { bigint: true }),
      ]);
      validateClosureFile(opened, label);
      validateClosureFile(named, label);
      const identity = statIdentity(opened);
      if (!isDeepStrictEqual(identity, statIdentity(named))) {
        throw new Error(`${label} path does not name its retained inode`);
      }
      const retainedBytes = await readExactHandleBytes(
        retained,
        opened.size,
        label,
      );
      if (!retainedBytes.equals(bytes)) {
        throw new Error(
          `${label} private bytes differ from the captured source`,
        );
      }
      state.records.push(
        Object.freeze({
          destination: sourceRecord.destination,
          handle: retained,
          identity,
          path,
          bytes,
          sha256: sha256(bytes),
        }),
      );
      retained = undefined;
    } finally {
      await closeClosureHandles(
        state,
        [sourceHandle, writer, retained].filter(
          (handle) => handle !== undefined,
        ),
      );
    }
  }
  return state.records;
}

async function verifyExecutableClosure(records) {
  if (records.length !== executableClosureSources.length) {
    throw new Error("v2 executable closure inventory changed");
  }
  for (const [index, record] of records.entries()) {
    const [opened, named] = await Promise.all([
      record.handle.stat({ bigint: true }),
      lstat(record.path, { bigint: true }),
    ]);
    validateClosureFile(opened, `v2 executable closure entry ${index}`);
    validateClosureFile(named, `v2 executable closure entry ${index}`);
    if (
      !isDeepStrictEqual(statIdentity(opened), record.identity) ||
      !isDeepStrictEqual(statIdentity(named), record.identity)
    ) {
      throw new Error(`v2 executable closure entry ${index} identity changed`);
    }
    const bytes = await readExactHandleBytes(
      record.handle,
      opened.size,
      `v2 executable closure entry ${index}`,
    );
    if (sha256(bytes) !== record.sha256 || !bytes.equals(record.bytes)) {
      throw new Error(`v2 executable closure entry ${index} bytes changed`);
    }
  }
}

function samePinnedInode(left, right) {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.links === right.links &&
    left.mode === right.mode &&
    left.owner === right.owner &&
    left.group === right.group
  );
}

function assertInitialResultInode(metadata) {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1n ||
    (metadata.mode & 0o777n) !== 0o600n ||
    metadata.size !== 0n ||
    (typeof process.getuid === "function" &&
      metadata.uid !== BigInt(process.getuid()))
  ) {
    throw new Error("v2 session result inode is not initially exact");
  }
}

function assertFinalResultInode({
  before,
  descriptorAfter,
  pathAfter,
  ceiling,
}) {
  const pinnedBefore = statIdentity(before);
  const pinnedAfter = statIdentity(descriptorAfter);
  const namedAfter = statIdentity(pathAfter);
  if (
    !descriptorAfter.isFile() ||
    descriptorAfter.isSymbolicLink() ||
    descriptorAfter.nlink !== 1n ||
    (descriptorAfter.mode & 0o777n) !== 0o600n ||
    descriptorAfter.size < 1n ||
    descriptorAfter.size > BigInt(ceiling) ||
    !samePinnedInode(pinnedBefore, pinnedAfter) ||
    !samePinnedInode(pinnedAfter, namedAfter) ||
    pinnedAfter.size !== namedAfter.size ||
    pinnedAfter.modifiedNs !== namedAfter.modifiedNs ||
    pinnedAfter.changedNs !== namedAfter.changedNs
  ) {
    throw new Error("v2 session result inode identity changed");
  }
}

function snapshotSessionInput(value) {
  const input = ownDataRecord(
    value,
    [
      "workspace",
      "contractSha256",
      "verificationSequence",
      "commands",
      "ceilings",
      "signal",
    ],
    "v2 sandbox session input",
  );
  if (
    typeof input.workspace !== "string" ||
    input.workspace.length === 0 ||
    input.workspace.length > 4096 ||
    input.workspace.includes("\0")
  ) {
    fail("v2 sandbox session input", "workspace is not a bounded path");
  }
  const rawCeilings = ownDataRecord(
    input.ceilings,
    [
      "maxBuildOutputBytes",
      "maxTestOutputBytesPerCommand",
      "maxTotalVerifierWallMs",
      "maxResidentBytes",
      "maxVerifierDiskBytes",
      "cargoBuildJobs",
    ],
    "v2 sandbox session ceilings",
  );
  const maxResidentBytes = boundedInteger(
    rawCeilings.maxResidentBytes,
    "v2 sandbox resident-memory ceiling",
    256 * 1024 * 1024,
    64 * 1024 * 1024 * 1024,
  );
  const configurationBytes = encodeSandboxSessionConfigurationV2({
    contractSha256: input.contractSha256,
    verificationSequence: input.verificationSequence,
    commands: input.commands,
    ceilings: {
      maxBuildOutputBytes: rawCeilings.maxBuildOutputBytes,
      maxTestOutputBytesPerCommand: rawCeilings.maxTestOutputBytesPerCommand,
      maxTotalVerifierWallMs: rawCeilings.maxTotalVerifierWallMs,
      maxVerifierDiskBytes: rawCeilings.maxVerifierDiskBytes,
      cargoBuildJobs: rawCeilings.cargoBuildJobs,
    },
  });
  const configuration = configurationFromBytes(configurationBytes);
  return Object.freeze({
    workspace: input.workspace,
    signal: input.signal,
    configuration,
    configurationBytes,
    ceilings: Object.freeze({
      ...configuration.ceilings,
      maxResidentBytes,
    }),
  });
}

class SandboxSessionV2Fault extends Error {
  constructor(
    reason,
    { cleanupSafe: safe, invocation, process: processRecord },
  ) {
    super("v2 sandbox session failed closed");
    Object.defineProperty(this, "name", { value: "SandboxSessionV2Fault" });
    this.reason = reason;
    this.cleanupSafe = safe;
    this.invocation = invocation;
    this.process = processRecord;
    this.stack = `${this.name}: ${this.message}`;
    trustedFaults.add(this);
    Object.freeze(this);
  }
}

export function isSandboxSessionV2Fault(error) {
  try {
    return error instanceof SandboxSessionV2Fault && trustedFaults.has(error);
  } catch {
    return false;
  }
}

function invocationEvidence({
  normalizedArgs,
  environment,
  configurationBytes,
  workerModuleBytes,
  launcherBytes,
}) {
  const workerClosure = workerModuleSources.map(({ destination }, index) =>
    Object.freeze({
      destination,
      sha256: sha256(workerModuleBytes[index]),
    }),
  );
  return Object.freeze({
    transport: "systemd-user-scope-bwrap-v2-structural",
    containment: "unproved",
    executableClosureBinding: "partial-esm-launcher-retained-fd-v1",
    runtimeExecutableClosureBinding: "path-exec-unproved",
    esmClosureInventory: "tested-static-request-inventory-v1",
    dynamicCodeLoadingResistance: false,
    execveat: false,
    sameUidTamperResistance: false,
    transientMutationPrevention: false,
    argsNormalization: "candidate-and-session-roots-token-v1",
    argsSha256: sha256(canonicalBytes(normalizedArgs)),
    environmentSha256: sha256(canonicalBytes(environment)),
    configurationSha256: sha256(configurationBytes),
    observedWorkerSha256: workerClosure[0].sha256,
    observedWorkerClosureSha256: sha256(canonicalBytes(workerClosure)),
    observedSeccompLauncherSha256: sha256(launcherBytes),
  });
}

async function removeSafeSessionRoot(root) {
  await rm(root, { recursive: true, force: true });
}

async function runStructuralSession(inputValue, processRunner, closeHandle) {
  const input = snapshotSessionInput(inputValue);
  const canonicalWorkspace = await realpath(input.workspace);
  const workspaceMetadata = await stat(canonicalWorkspace);
  if (!workspaceMetadata.isDirectory()) {
    throw new Error("v2 candidate workspace is not a directory");
  }
  const sessionRoot = await mkdtemp(
    join(tmpdir(), "oxigraph-verifier-session-v2-"),
  );
  const outputFile = join(sessionRoot, "session.json");
  let descriptor;
  const closureState = { records: [], handles: new Set(), closeHandle };
  let executableClosure = closureState.records;
  let safeToRemove = true;
  let sessionCompleted = false;
  let invocation;
  let processRecord;
  try {
    descriptor = await open(
      outputFile,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_RDWR |
        constants.O_NOFOLLOW,
      0o600,
    );
    const before = await descriptor.stat({ bigint: true });
    assertInitialResultInode(before);
    await materializeExecutableClosure(sessionRoot, closureState);
    const workerModuleBytes = executableClosure
      .slice(0, workerModuleSources.length)
      .map(({ bytes }) => bytes);
    const launcherBytes = executableClosure.at(-1).bytes;
    const sandboxArguments = structuralSandboxArguments({
      workspace: canonicalWorkspace,
      outputFile,
      ceilings: input.ceilings,
      executableClosure,
    });
    const args = invocationArguments(sandboxArguments, input.ceilings);
    const environment = sessionEnvironment();
    const normalizedArgs = normalizedInvocationArguments(
      args,
      canonicalWorkspace,
      outputFile,
    );
    invocation = invocationEvidence({
      normalizedArgs,
      environment,
      configurationBytes: input.configurationBytes,
      workerModuleBytes,
      launcherBytes,
    });
    safeToRemove = false;
    const outcome = await processRunner({
      executable: systemdRunExecutable,
      args,
      cwd: tmpdir(),
      environment,
      timeoutMs: input.ceilings.maxTotalVerifierWallMs,
      maxOutputBytes: 65_536,
      signal: input.signal,
      stdin: input.configurationBytes,
      inheritedFileDescriptors: executableClosure.map(
        ({ handle }) => handle.fd,
      ),
    });
    safeToRemove = cleanupSafe(outcome);
    processRecord = processEvidence(outcome);
    if (safeToRemove) await verifyExecutableClosure(executableClosure);
    if (
      !safeToRemove ||
      outcome.disposition !== "completed" ||
      outcome.exitCode !== 0
    ) {
      throw new SandboxSessionV2Fault("outer-process", {
        cleanupSafe: safeToRemove,
        invocation,
        process: processRecord,
      });
    }
    const [descriptorAfter, pathAfter] = await Promise.all([
      descriptor.stat({ bigint: true }),
      lstat(outputFile, { bigint: true }),
    ]);
    assertFinalResultInode({
      before,
      descriptorAfter,
      pathAfter,
      ceiling: input.configuration.resultCeiling,
    });
    const resultBytes = await readFile(descriptor);
    const descriptorFinal = await descriptor.stat({ bigint: true });
    if (
      statIdentity(descriptorAfter).size !==
        statIdentity(descriptorFinal).size ||
      statIdentity(descriptorAfter).modifiedNs !==
        statIdentity(descriptorFinal).modifiedNs ||
      statIdentity(descriptorAfter).changedNs !==
        statIdentity(descriptorFinal).changedNs
    ) {
      throw new Error("v2 session result changed during retained-FD read");
    }
    const decoded = decodeResult(resultBytes, input.configuration);
    const report = Object.freeze({
      invocation,
      process: processRecord,
      resultSha256: sha256(decoded.bytes),
      resultBytes: decoded.bytes.length,
      session: decoded.session,
      cleanupSafe: true,
    });
    trustedReports.add(report);
    sessionCompleted = true;
    return report;
  } catch (error) {
    if (isSandboxSessionV2Fault(error)) throw error;
    throw new SandboxSessionV2Fault("protocol-or-inode", {
      cleanupSafe: safeToRemove,
      invocation:
        invocation ??
        Object.freeze({
          transport: "systemd-user-scope-bwrap-v2-structural",
          containment: "unproved",
        }),
      process:
        processRecord ??
        Object.freeze({
          disposition: "not-started",
          spawned: false,
          noChild: true,
        }),
    });
  } finally {
    if (!safeToRemove) {
      retainedSessionRoots.add(
        Object.freeze({
          root: sessionRoot,
          resultDescriptor: descriptor,
          executableClosure,
          closureHandles: Object.freeze([...closureState.handles]),
        }),
      );
    } else {
      try {
        await closeClosureHandles(closureState);
        executableClosure = [];
        await descriptor?.close();
        descriptor = undefined;
        await removeSafeSessionRoot(sessionRoot);
      } catch {
        retainedSessionRoots.add(
          Object.freeze({
            root: sessionRoot,
            resultDescriptor: descriptor,
            executableClosure,
            closureHandles: Object.freeze([...closureState.handles]),
          }),
        );
        throw new SandboxSessionV2Fault("cleanup", {
          cleanupSafe: false,
          invocation:
            invocation ??
            Object.freeze({
              transport: "systemd-user-scope-bwrap-v2-structural",
              containment: "unproved",
            }),
          process:
            processRecord ??
            Object.freeze({
              disposition: sessionCompleted ? "completed" : "not-started",
              spawned: false,
              noChild: true,
            }),
        });
      }
    }
  }
}

export function isTrustedSandboxSessionV2Report(report) {
  try {
    return trustedReports.has(report);
  } catch {
    return false;
  }
}

/** Fixed preflight; it performs no filesystem access and spawns no process. */
export function sandboxSessionV2ContainmentReadiness() {
  return containmentReadiness;
}

/**
 * Production remains fail-closed until the co-located cgroup owner can prove
 * membership, limits, cancellation, and terminal emptiness. The structural
 * runner below is test-only and cannot be selected through this API.
 */
export async function runSandboxVerificationSessionV2(inputValue) {
  snapshotSessionInput(inputValue);
  throw new SandboxSessionV2Fault("containment-unavailable", {
    cleanupSafe: true,
    invocation: Object.freeze({
      transport: "systemd-user-scope-bwrap-v2-disabled",
      containment: "unavailable",
      executableClosureBinding: "not-attempted",
    }),
    process: Object.freeze({
      disposition: "not-started",
      spawned: false,
      noChild: true,
    }),
  });
}

/** Explicit test-only structural runner injection; production never calls it. */
export function createSandboxVerificationSessionV2ForTesting(
  processRunner,
  closeHandle = (handle) => handle.close(),
) {
  if (typeof processRunner !== "function" || utilTypes.isProxy(processRunner)) {
    throw new TypeError("v2 test session requires one fixed process runner");
  }
  if (typeof closeHandle !== "function" || utilTypes.isProxy(closeHandle)) {
    throw new TypeError("v2 test session requires one fixed handle closer");
  }
  return Object.freeze({
    runSandboxVerificationSessionV2: (input) =>
      runStructuralSession(input, processRunner, closeHandle),
  });
}
