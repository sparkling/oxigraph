import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  openSync,
  readSync,
  statfsSync,
  writeSync,
} from "node:fs";
import { open, opendir } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { types as utilTypes } from "node:util";

import { runBoundedProcessBytes } from "../native/process.mjs";
import { exactCargoBuildArtifactStemsV2 } from "../policy/build-command-v2.mjs";
import {
  MAX_LOGICAL_ARGV_ITEMS,
  MAX_TASK_ARG_BYTES,
} from "../policy/evidence-limits.mjs";
import {
  V2_COMMAND_ARGV_BYTES_CEILING,
  V2_SESSION_CONFIGURATION_BYTES_CEILING,
} from "../policy/session-v2-limits.mjs";
import {
  isTaskV2Failure,
  taskV2Failure,
  withTaskV2FailureBoundary,
} from "../policy/task-v2-failures.mjs";
import { canonicalJson } from "../routing/features.mjs";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const COMMAND_COUNT_CEILING = 16;
const COMMAND_OUTPUT_FLOOR = 1024;
const COMMAND_OUTPUT_CEILING = 64 * MiB;
const TOTAL_WALL_FLOOR_MS = 1000;
const TOTAL_WALL_CEILING_MS = 7_200_000;
const VERIFIER_DISK_FLOOR = 32 * MiB;
const VERIFIER_DISK_CEILING = 128 * GiB;
const CARGO_BUILD_JOBS_CEILING = 16;
const SESSION_RESULT_ENVELOPE_BYTES = 2 * MiB;
const NATIVE_RESULT_BYTES_CEILING = 256 * MiB;
const PUBLIC_TAIL_BYTES = 16 * 1024;
const ARTIFACT_COUNT_CEILING = 256;
const ARTIFACT_DIRECTORY_ENTRY_CEILING = 4096;
const ARTIFACT_NAME_BYTES_CEILING = 255;
const CARGO_EXECUTABLE = "/state/cargo/bin/cargo";
const SETPRIV_EXECUTABLE = "/usr/bin/setpriv";
const PYTHON_EXECUTABLE = "/usr/bin/python3";
const SECCOMP_LAUNCHER = "/runner/seccomp-launcher.py";
const WORKSPACE = "/workspace";
const TARGET_DEPENDENCY_ROOT = "/state/target/debug/deps";
const STATE_ROOT = "/state";
const RESULT_PATH = "/result/session.json";
const SHA256 = /^[0-9a-f]{64}$/u;
const COMMAND_ROLE = /^[a-z][a-z0-9-]{0,63}$/u;
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const nativeTypedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
).get;
const nativeTypedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
).get;
const nativeTypedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
).get;

export const SANDBOX_SESSION_WORKER_V2_FAILURE_CODES = Object.freeze([
  "CONFIGURATION",
  "PROCESS_PROOF",
  "TIME_BUDGET",
  "STATE_INVARIANT",
  "ARTIFACT_EVIDENCE",
  "RESULT_CEILING",
  "INTERNAL_FAIL_CLOSED",
]);

const FAILURE_CODES = new Set(SANDBOX_SESSION_WORKER_V2_FAILURE_CODES);
const CONFIGURATION_KEYS = Object.freeze([
  "schemaVersion",
  "contractSha256",
  "verificationSequence",
  "commands",
  "ceilings",
]);
const CEILING_KEYS = Object.freeze([
  "maxBuildOutputBytes",
  "maxTestOutputBytesPerCommand",
  "maxTotalVerifierWallMs",
  "maxVerifierDiskBytes",
  "cargoBuildJobs",
]);
const RESULT_KEYS = Object.freeze([
  "schemaVersion",
  "configurationSha256",
  "status",
  "stage",
  "commandCount",
  "commands",
  "artifacts",
  "stateBytes",
  "failure",
]);
const COMMAND_RESULT_KEYS = Object.freeze([
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
const ARTIFACT_KEYS = Object.freeze(["name", "sha256", "bytes", "mode"]);
const PROCESS_OUTCOME_KEYS = Object.freeze([
  "disposition",
  "firstTerminalReason",
  "syntheticTestOnly",
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
  "stdout",
  "stderr",
  "durationMs",
  "terminationErrors",
  "processErrors",
]);

class WorkerFault extends Error {
  constructor(code) {
    super("sandbox session worker failed closed");
    this.name = "WorkerFault";
    this.code = FAILURE_CODES.has(code) ? code : "INTERNAL_FAIL_CLOSED";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function schemaFault() {
  throw taskV2Failure(
    "ERR_CONTRACT_SCHEMA_OR_KEYS",
    "sandbox session v2 wire is invalid",
  );
}

function exactRecord(value, expectedKeys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    schemaFault();
  }
  let prototype;
  let descriptors;
  try {
    prototype = objectGetPrototypeOf(value);
    descriptors = objectGetOwnPropertyDescriptors(value);
  } catch {
    schemaFault();
  }
  if (prototype !== objectPrototype && prototype !== null) schemaFault();
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== "string") ||
    expectedKeys.some(
      (key) =>
        !Object.hasOwn(descriptors, key) ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    ) ||
    keys.some((key) => !expectedKeys.includes(key))
  ) {
    schemaFault();
  }
  return Object.fromEntries(
    expectedKeys.map((key) => [key, descriptors[key].value]),
  );
}

function denseArray(value, maximum) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    objectGetPrototypeOf(value) !== arrayPrototype
  ) {
    schemaFault();
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximum
  ) {
    schemaFault();
  }
  const length = lengthDescriptor.value;
  const keys = reflectOwnKeys(descriptors);
  const expected = new Set([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (
    keys.some((key) => typeof key !== "string" || !expected.has(key)) ||
    keys.length !== expected.size
  ) {
    schemaFault();
  }
  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      schemaFault();
    }
    result.push(descriptor.value);
  }
  return result;
}

function copyPrivateBytes(value, maximumBytes) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !utilTypes.isUint8Array(value)
  ) {
    schemaFault();
  }
  let buffer;
  let byteLength;
  let byteOffset;
  try {
    buffer = nativeTypedArrayBufferGetter.call(value);
    byteLength = nativeTypedArrayByteLengthGetter.call(value);
    byteOffset = nativeTypedArrayByteOffsetGetter.call(value);
  } catch {
    schemaFault();
  }
  if (
    utilTypes.isSharedArrayBuffer(buffer) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > maximumBytes ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0
  ) {
    schemaFault();
  }
  try {
    return Buffer.from(new Uint8Array(buffer, byteOffset, byteLength));
  } catch {
    schemaFault();
  }
}

function parseCanonicalWire(bytes, maximumBytes) {
  const copied = copyPrivateBytes(bytes, maximumBytes);
  let text;
  let value;
  try {
    text = UTF8.decode(copied);
    if (!text.endsWith("\n") || text.endsWith("\n\n")) schemaFault();
    value = JSON.parse(text.slice(0, -1));
    if (!copied.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
      schemaFault();
    }
  } catch (error) {
    if (isTaskV2Failure(error)) throw error;
    schemaFault();
  }
  return Object.freeze({ copied, value });
}

function safeInteger(value, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    schemaFault();
  }
  return value;
}

function freezeJson(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJson(child);
  return Object.freeze(value);
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

function validateConfiguration(value) {
  const configuration = exactRecord(value, CONFIGURATION_KEYS);
  if (
    configuration.schemaVersion !== 2 ||
    !SHA256.test(configuration.contractSha256)
  ) {
    schemaFault();
  }
  const roles = denseArray(
    configuration.verificationSequence,
    COMMAND_COUNT_CEILING,
  );
  if (
    roles.length < 3 ||
    roles[0] !== "format" ||
    roles[1] !== "build" ||
    roles.some(
      (role) => typeof role !== "string" || !COMMAND_ROLE.test(role),
    ) ||
    new Set(roles).size !== roles.length
  ) {
    schemaFault();
  }
  const commands = exactRecord(configuration.commands, roles);
  const ceilings = exactRecord(configuration.ceilings, CEILING_KEYS);
  safeInteger(
    ceilings.maxBuildOutputBytes,
    COMMAND_OUTPUT_FLOOR,
    COMMAND_OUTPUT_CEILING,
  );
  safeInteger(
    ceilings.maxTestOutputBytesPerCommand,
    COMMAND_OUTPUT_FLOOR,
    COMMAND_OUTPUT_CEILING,
  );
  safeInteger(
    ceilings.maxTotalVerifierWallMs,
    TOTAL_WALL_FLOOR_MS,
    TOTAL_WALL_CEILING_MS,
  );
  safeInteger(
    ceilings.maxVerifierDiskBytes,
    VERIFIER_DISK_FLOOR,
    VERIFIER_DISK_CEILING,
  );
  safeInteger(ceilings.cargoBuildJobs, 1, CARGO_BUILD_JOBS_CEILING);

  for (const role of roles) {
    const command = exactRecord(commands[role], ["argv", "timeoutMs"]);
    const argv = denseArray(command.argv, MAX_LOGICAL_ARGV_ITEMS);
    if (argv.length < 2 || argv[0] !== "cargo") schemaFault();
    let aggregateBytes = 0;
    for (const argument of argv) {
      if (
        typeof argument !== "string" ||
        argument.length === 0 ||
        /[\u0000-\u001f\u007f]/u.test(argument) ||
        !isUnicodeScalarString(argument) ||
        Buffer.byteLength(argument, "utf8") > MAX_TASK_ARG_BYTES
      ) {
        schemaFault();
      }
      aggregateBytes += Buffer.byteLength(argument, "utf8");
    }
    if (aggregateBytes > V2_COMMAND_ARGV_BYTES_CEILING) schemaFault();
    safeInteger(
      command.timeoutMs,
      TOTAL_WALL_FLOOR_MS,
      ceilings.maxTotalVerifierWallMs,
    );
  }
  if (exactCargoBuildArtifactStemsV2(commands.build.argv) === undefined) {
    schemaFault();
  }

  const capturedBytes =
    ceilings.maxBuildOutputBytes +
    (roles.length - 1) * ceilings.maxTestOutputBytesPerCommand;
  const resultBytesCeiling =
    Math.ceil(capturedBytes / 3) * 4 + SESSION_RESULT_ENVELOPE_BYTES;
  if (
    !Number.isSafeInteger(resultBytesCeiling) ||
    resultBytesCeiling > NATIVE_RESULT_BYTES_CEILING
  ) {
    schemaFault();
  }
  return Object.freeze({ roles, resultBytesCeiling });
}

export function parseSandboxSessionWorkerConfigurationV2(bytes) {
  const { copied, value } = parseCanonicalWire(
    bytes,
    V2_SESSION_CONFIGURATION_BYTES_CEILING,
  );
  const { resultBytesCeiling } = validateConfiguration(value);
  freezeJson(value);
  return Object.freeze({
    configuration: value,
    configurationSha256: sha256(copied),
    resultBytesCeiling,
  });
}

function fixedEnvironment(cargoBuildJobs) {
  return Object.freeze({
    CARGO_BUILD_JOBS: String(cargoBuildJobs),
    CARGO_HOME: "/state/cargo",
    CARGO_INCREMENTAL: "0",
    CARGO_NET_OFFLINE: "true",
    CARGO_PROFILE_TEST_DEBUG: "0",
    CARGO_TARGET_DIR: "/state/target",
    HOME: "/state/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/state/cargo/bin:/usr/bin:/bin",
    RUSTUP_HOME: "/rustup",
    SOURCE_DATE_EPOCH: "946684800",
    TMPDIR: "/state/tmp",
    USER: "sandbox",
  });
}

function fixedCargoInvocation(logicalArgv) {
  return Object.freeze([
    "--bounding-set=-all",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--no-new-privs",
    "--pdeathsig=SIGKILL",
    PYTHON_EXECUTABLE,
    "-I",
    "-S",
    SECCOMP_LAUNCHER,
    CARGO_EXECUTABLE,
    ...logicalArgv.slice(1),
  ]);
}

function inspectDenseDataArrayLength(value) {
  if (
    !Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    objectGetPrototypeOf(value) !== arrayPrototype
  ) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 4096) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  const expected = new Set([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  for (let index = 0; index < length; index += 1) {
    if (!("value" in descriptors[index])) {
      throw new WorkerFault("PROCESS_PROOF");
    }
  }
  return length;
}

function capturedOutcomeBytes(outcome, descriptor, trusted, maximumBytes) {
  let value;
  if (descriptor !== undefined && "value" in descriptor) {
    value = descriptor.value;
  } else if (
    trusted &&
    descriptor !== undefined &&
    typeof descriptor.get === "function" &&
    descriptor.set === undefined
  ) {
    try {
      value = descriptor.get.call(outcome);
    } catch {
      throw new WorkerFault("PROCESS_PROOF");
    }
  } else {
    throw new WorkerFault("PROCESS_PROOF");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !utilTypes.isUint8Array(value)
  ) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  let buffer;
  let length;
  let offset;
  try {
    buffer = nativeTypedArrayBufferGetter.call(value);
    length = nativeTypedArrayByteLengthGetter.call(value);
    offset = nativeTypedArrayByteOffsetGetter.call(value);
  } catch {
    throw new WorkerFault("PROCESS_PROOF");
  }
  if (
    utilTypes.isSharedArrayBuffer(buffer) ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumBytes ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  try {
    return Buffer.from(new Uint8Array(buffer, offset, length));
  } catch {
    throw new WorkerFault("PROCESS_PROOF");
  }
}

function captureProcessOutcome(outcome, maximumBytes, trusted) {
  if (
    outcome === null ||
    typeof outcome !== "object" ||
    utilTypes.isProxy(outcome)
  ) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  let descriptors;
  try {
    if (objectGetPrototypeOf(outcome) !== objectPrototype) {
      throw new WorkerFault("PROCESS_PROOF");
    }
    descriptors = objectGetOwnPropertyDescriptors(outcome);
  } catch (error) {
    if (error instanceof WorkerFault) throw error;
    throw new WorkerFault("PROCESS_PROOF");
  }
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.length !== PROCESS_OUTCOME_KEYS.length ||
    keys.some(
      (key) => typeof key !== "string" || !PROCESS_OUTCOME_KEYS.includes(key),
    ) ||
    PROCESS_OUTCOME_KEYS.some(
      (key) =>
        !Object.hasOwn(descriptors, key) ||
        (!["stdout", "stderr"].includes(key) &&
          !("value" in descriptors[key])) ||
        descriptors[key].enumerable !== true,
    )
  ) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  const captured = Object.fromEntries(
    PROCESS_OUTCOME_KEYS.filter(
      (key) => !["stdout", "stderr"].includes(key),
    ).map((key) => [key, descriptors[key].value]),
  );
  const stdout = capturedOutcomeBytes(
    outcome,
    descriptors.stdout,
    trusted,
    maximumBytes,
  );
  const stderr = capturedOutcomeBytes(
    outcome,
    descriptors.stderr,
    trusted,
    maximumBytes,
  );
  if (stdout.length + stderr.length > maximumBytes) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  const booleanKeys = [
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
  ];
  if (
    typeof captured.disposition !== "string" ||
    captured.disposition.length < 1 ||
    captured.disposition.length > 128 ||
    captured.disposition.includes("\0") ||
    typeof captured.firstTerminalReason !== "string" ||
    captured.firstTerminalReason.length < 1 ||
    captured.firstTerminalReason.length > 128 ||
    captured.firstTerminalReason.includes("\0") ||
    captured.syntheticTestOnly !== false ||
    booleanKeys.some((key) => typeof captured[key] !== "boolean") ||
    (captured.exitCode !== null &&
      (!Number.isInteger(captured.exitCode) ||
        captured.exitCode < 0 ||
        captured.exitCode > 255)) ||
    (captured.closeCode !== null &&
      (!Number.isInteger(captured.closeCode) ||
        captured.closeCode < 0 ||
        captured.closeCode > 255)) ||
    (captured.signal !== null &&
      (typeof captured.signal !== "string" ||
        captured.signal.length < 1 ||
        captured.signal.length > 128 ||
        captured.signal.includes("\0"))) ||
    (captured.closeSignal !== null &&
      (typeof captured.closeSignal !== "string" ||
        captured.closeSignal.length < 1 ||
        captured.closeSignal.length > 128 ||
        captured.closeSignal.includes("\0"))) ||
    !Number.isSafeInteger(captured.durationMs) ||
    captured.durationMs < 0
  ) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  const terminationErrorCount = inspectDenseDataArrayLength(
    captured.terminationErrors,
  );
  const processErrorCount = inspectDenseDataArrayLength(captured.processErrors);
  const noChildProof =
    captured.noChild === true &&
    captured.spawned === false &&
    captured.reaped === false &&
    captured.directChildCleanupSafe === true &&
    captured.processGroupQuiescent === true;
  const reapedProof =
    captured.spawned === true &&
    captured.noChild === false &&
    captured.statusAgreement === true &&
    captured.reaped === true &&
    captured.directChildCleanupSafe === true &&
    captured.exitObserved === true &&
    captured.closeObserved === true &&
    captured.stdoutEof === true &&
    captured.stderrEof === true &&
    captured.exitCode === captured.closeCode &&
    captured.signal === captured.closeSignal;
  if (
    (captured.noChild && !noChildProof) ||
    (captured.reaped && !reapedProof) ||
    (captured.statusAgreement &&
      (!captured.exitObserved ||
        !captured.closeObserved ||
        captured.exitCode !== captured.closeCode ||
        captured.signal !== captured.closeSignal)) ||
    (captured.captureComplete &&
      (!reapedProof ||
        !captured.processGroupQuiescent ||
        !captured.stdinComplete ||
        captured.outputTruncated ||
        terminationErrorCount !== 0 ||
        processErrorCount !== 0))
  ) {
    throw new WorkerFault("PROCESS_PROOF");
  }
  return Object.freeze({
    evidence: Object.freeze({
      disposition: captured.disposition,
      firstTerminalReason: captured.firstTerminalReason,
      spawned: captured.spawned,
      noChild: captured.noChild,
      exitCode: captured.exitCode,
      signal: captured.signal,
      closeCode: captured.closeCode,
      closeSignal: captured.closeSignal,
      statusAgreement: captured.statusAgreement,
      reaped: captured.reaped,
      directChildCleanupSafe: captured.directChildCleanupSafe,
      processGroupQuiescent: captured.processGroupQuiescent,
      exitObserved: captured.exitObserved,
      closeObserved: captured.closeObserved,
      stdoutEof: captured.stdoutEof,
      stderrEof: captured.stderrEof,
      stdinComplete: captured.stdinComplete,
      captureComplete: captured.captureComplete,
      outputTruncated: captured.outputTruncated,
      terminationErrorCount,
      processErrorCount,
    }),
    stdout,
    stderr,
  });
}

function completedExactly(evidence) {
  return (
    evidence.disposition === "completed" &&
    evidence.firstTerminalReason === "completed" &&
    evidence.spawned === true &&
    evidence.noChild === false &&
    Number.isInteger(evidence.exitCode) &&
    evidence.closeCode === evidence.exitCode &&
    evidence.signal === null &&
    evidence.closeSignal === null &&
    evidence.statusAgreement === true &&
    evidence.reaped === true &&
    evidence.directChildCleanupSafe === true &&
    evidence.processGroupQuiescent === true &&
    evidence.exitObserved === true &&
    evidence.closeObserved === true &&
    evidence.stdoutEof === true &&
    evidence.stderrEof === true &&
    evidence.stdinComplete === true &&
    evidence.captureComplete === true &&
    evidence.outputTruncated === false &&
    evidence.terminationErrorCount === 0 &&
    evidence.processErrorCount === 0
  );
}

function exactObservedPassed(role, evidence, stdout, stderr) {
  if (
    ["format", "build"].includes(role) ||
    evidence.exitCode !== 0 ||
    !completedExactly(evidence)
  ) {
    return null;
  }
  const summaryLines = [];
  for (const bytes of [stdout, stderr]) {
    for (const line of bytes.toString("latin1").split("\n")) {
      if (line.startsWith("test result:")) summaryLines.push(line);
    }
  }
  if (summaryLines.length !== 1) return null;
  const match =
    /^test result: ok\. (0|[1-9][0-9]*) passed; 0 failed; (?:0|[1-9][0-9]*) ignored; (?:0|[1-9][0-9]*) measured; (?:0|[1-9][0-9]*) filtered out; finished in (?:0|[1-9][0-9]*)(?:\.[0-9]+)?s$/u.exec(
      summaryLines[0],
    );
  if (match === null) return null;
  const passed = Number(match[1]);
  return Number.isSafeInteger(passed) ? passed : null;
}

function commandResult(role, captured) {
  const { evidence, stdout, stderr } = captured;
  return Object.freeze({
    role,
    ...evidence,
    observedPassed: exactObservedPassed(role, evidence, stdout, stderr),
    stdoutBytes: stdout.length,
    stdoutSha256: sha256(stdout),
    stdoutBase64: stdout.toString("base64"),
    stderrBytes: stderr.length,
    stderrSha256: sha256(stderr),
    stderrBase64: stderr.toString("base64"),
  });
}

function artifactTargetNames(argv) {
  const targets = exactCargoBuildArtifactStemsV2(argv);
  if (targets === undefined || targets.length > ARTIFACT_COUNT_CEILING) {
    throw new WorkerFault("ARTIFACT_EVIDENCE");
  }
  return targets;
}

function bytewiseNameOrder(left, right) {
  return Buffer.compare(
    Buffer.from(left.name, "utf8"),
    Buffer.from(right.name, "utf8"),
  );
}

function capturedArtifacts(value, targetNames, maximumDiskBytes) {
  let records;
  try {
    records = denseArray(value, ARTIFACT_COUNT_CEILING);
  } catch {
    throw new WorkerFault("ARTIFACT_EVIDENCE");
  }
  if (records.length === 0) throw new WorkerFault("ARTIFACT_EVIDENCE");
  const names = new Set();
  let aggregateBytes = 0;
  const captured = records.map((value) => {
    let record;
    try {
      record = exactRecord(value, ARTIFACT_KEYS);
    } catch {
      throw new WorkerFault("ARTIFACT_EVIDENCE");
    }
    if (
      typeof record.name !== "string" ||
      !ARTIFACT_NAME.test(record.name) ||
      Buffer.byteLength(record.name, "utf8") > ARTIFACT_NAME_BYTES_CEILING ||
      names.has(record.name) ||
      !SHA256.test(record.sha256) ||
      !Number.isSafeInteger(record.bytes) ||
      record.bytes < 1 ||
      record.bytes > maximumDiskBytes ||
      !Number.isInteger(record.mode) ||
      record.mode < 1 ||
      record.mode > 0o777 ||
      (record.mode & 0o111) === 0
    ) {
      throw new WorkerFault("ARTIFACT_EVIDENCE");
    }
    names.add(record.name);
    aggregateBytes += record.bytes;
    if (
      !Number.isSafeInteger(aggregateBytes) ||
      aggregateBytes > maximumDiskBytes
    ) {
      throw new WorkerFault("ARTIFACT_EVIDENCE");
    }
    return Object.freeze({ ...record });
  });
  captured.sort(bytewiseNameOrder);
  for (const target of targetNames) {
    if (!captured.some(({ name }) => name.startsWith(`${target}-`))) {
      throw new WorkerFault("ARTIFACT_EVIDENCE");
    }
  }
  return Object.freeze(captured);
}

function sameFileIdentity(left, right) {
  return [
    "dev",
    "ino",
    "nlink",
    "size",
    "mode",
    "uid",
    "gid",
    "mtimeNs",
    "ctimeNs",
  ].every((key) => left[key] === right[key]);
}

async function hashPinnedArtifact(path, maximumDiskBytes) {
  let handle;
  try {
    handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > BigInt(maximumDiskBytes)
    ) {
      throw new WorkerFault("ARTIFACT_EVIDENCE");
    }
    if ((before.mode & 0o111n) === 0n) return null;
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(64 * 1024);
    let offset = 0;
    while (offset < Number(before.size)) {
      const { bytesRead } = await handle.read(
        chunk,
        0,
        Math.min(chunk.length, Number(before.size) - offset),
        offset,
      );
      if (bytesRead < 1) throw new WorkerFault("ARTIFACT_EVIDENCE");
      hash.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (!sameFileIdentity(before, after)) {
      throw new WorkerFault("ARTIFACT_EVIDENCE");
    }
    return Object.freeze({
      sha256: hash.digest("hex"),
      bytes: Number(before.size),
      mode: Number(before.mode & 0o777n),
    });
  } catch (error) {
    if (error instanceof WorkerFault) throw error;
    throw new WorkerFault("ARTIFACT_EVIDENCE");
  } finally {
    try {
      await handle?.close();
    } catch {
      throw new WorkerFault("ARTIFACT_EVIDENCE");
    }
  }
}

async function collectProductionArtifacts({ targetNames, maximumDiskBytes }) {
  const entries = [];
  try {
    const directory = await opendir(TARGET_DEPENDENCY_ROOT);
    for await (const entry of directory) {
      if (entries.length >= ARTIFACT_DIRECTORY_ENTRY_CEILING) {
        throw new WorkerFault("ARTIFACT_EVIDENCE");
      }
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof WorkerFault) throw error;
    throw new WorkerFault("ARTIFACT_EVIDENCE");
  }
  const admitted = new Map();
  for (const target of targetNames) {
    const matches = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          ARTIFACT_NAME.test(entry.name) &&
          entry.name.startsWith(`${target}-`) &&
          !entry.name.endsWith(".d"),
      )
      .map(({ name }) => name)
      .sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      );
    let executableMatch = false;
    for (const name of matches) {
      if (admitted.has(name)) {
        executableMatch = true;
        continue;
      }
      if (admitted.size >= ARTIFACT_COUNT_CEILING) {
        throw new WorkerFault("ARTIFACT_EVIDENCE");
      }
      const evidence = await hashPinnedArtifact(
        join(TARGET_DEPENDENCY_ROOT, name),
        maximumDiskBytes,
      );
      if (evidence === null) continue;
      executableMatch = true;
      admitted.set(
        name,
        Object.freeze({
          name,
          ...evidence,
        }),
      );
    }
    if (!executableMatch) throw new WorkerFault("ARTIFACT_EVIDENCE");
  }
  return Object.freeze([...admitted.values()].sort(bytewiseNameOrder));
}

function readProductionStateBytes() {
  try {
    const state = statfsSync(STATE_ROOT, { bigint: true });
    const used = (state.blocks - state.bfree) * state.bsize;
    if (used < 0n || used > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new WorkerFault("STATE_INVARIANT");
    }
    return Number(used);
  } catch (error) {
    if (error instanceof WorkerFault) throw error;
    throw new WorkerFault("STATE_INVARIANT");
  }
}

function serializedResult(
  result,
  ceiling,
  configurationSha256,
  stage,
  stateBytes,
) {
  let bytes;
  try {
    bytes = Buffer.from(`${canonicalJson(result)}\n`, "utf8");
  } catch {
    throw new WorkerFault("INTERNAL_FAIL_CLOSED");
  }
  if (bytes.length <= ceiling) return bytes;
  const fallback = Object.freeze({
    schemaVersion: 2,
    configurationSha256,
    status: "failed",
    stage,
    commandCount: 0,
    commands: Object.freeze([]),
    artifacts: Object.freeze([]),
    stateBytes,
    failure: "RESULT_CEILING",
  });
  const fallbackBytes = Buffer.from(`${canonicalJson(fallback)}\n`, "utf8");
  if (fallbackBytes.length > ceiling) {
    throw new WorkerFault("RESULT_CEILING");
  }
  return fallbackBytes;
}

async function executeSession(configurationBytes, authority) {
  const parsed = parseSandboxSessionWorkerConfigurationV2(configurationBytes);
  const { configuration, configurationSha256, resultBytesCeiling } = parsed;
  const { verificationSequence: roles, commands, ceilings } = configuration;
  const started = performance.now();
  const commandRecords = [];
  let artifacts = Object.freeze([]);
  let status = "completed";
  let stage = "complete";
  let failure = null;
  const wallExpired = () =>
    performance.now() - started >= ceilings.maxTotalVerifierWallMs;

  for (const role of roles) {
    stage = role;
    const elapsed = Math.ceil(performance.now() - started);
    const remaining = ceilings.maxTotalVerifierWallMs - elapsed;
    if (remaining < 1) {
      status = "failed";
      failure = "TIME_BUDGET";
      break;
    }
    const command = commands[role];
    const maximumBytes =
      role === "build"
        ? ceilings.maxBuildOutputBytes
        : ceilings.maxTestOutputBytesPerCommand;
    let captured;
    try {
      const outcome = await authority.processRunner({
        executable: SETPRIV_EXECUTABLE,
        args: fixedCargoInvocation(command.argv),
        cwd: WORKSPACE,
        environment: fixedEnvironment(ceilings.cargoBuildJobs),
        timeoutMs: Math.min(command.timeoutMs, remaining),
        maxOutputBytes: maximumBytes,
        stdin: Buffer.alloc(0),
      });
      captured = captureProcessOutcome(
        outcome,
        maximumBytes,
        authority.trustedProcessEvidence,
      );
    } catch (error) {
      status = "failed";
      failure =
        error instanceof WorkerFault ? error.code : "INTERNAL_FAIL_CLOSED";
      break;
    }
    if (wallExpired()) {
      status = "failed";
      failure = "TIME_BUDGET";
      break;
    }
    if (!completedExactly(captured.evidence)) {
      status = "failed";
      failure =
        captured.evidence.disposition.startsWith("timeout") ||
        captured.evidence.firstTerminalReason === "timeout"
          ? "TIME_BUDGET"
          : "PROCESS_PROOF";
      break;
    }
    const record = commandResult(role, captured);
    commandRecords.push(record);
    if (role === "format" && record.exitCode !== 0) break;
    if (role === "build") {
      if (record.exitCode !== 0) break;
      try {
        const targetNames = artifactTargetNames(command.argv);
        const observed = await authority.artifactCollector({
          targetNames,
          maximumDiskBytes: ceilings.maxVerifierDiskBytes,
        });
        artifacts = capturedArtifacts(
          observed,
          targetNames,
          ceilings.maxVerifierDiskBytes,
        );
      } catch {
        status = "failed";
        failure = "ARTIFACT_EVIDENCE";
        break;
      }
      if (wallExpired()) {
        status = "failed";
        failure = "TIME_BUDGET";
        break;
      }
    }
  }

  if (status === "completed") {
    if (commandRecords.length === roles.length) stage = "complete";
    else stage = commandRecords.at(-1)?.role ?? roles[0];
  }

  let stateBytes = null;
  try {
    const observed = await authority.stateBytesReader();
    if (
      !Number.isSafeInteger(observed) ||
      observed < 0 ||
      observed > ceilings.maxVerifierDiskBytes
    ) {
      throw new WorkerFault("STATE_INVARIANT");
    }
    stateBytes = observed;
  } catch {
    status = "failed";
    stage = stage === "complete" ? roles.at(-1) : stage;
    failure = "STATE_INVARIANT";
    stateBytes = null;
  }
  if (status === "completed" && wallExpired()) {
    status = "failed";
    stage = stage === "complete" ? roles.at(-1) : stage;
    failure = "TIME_BUDGET";
  }

  const safeCommands =
    status === "failed" ? Object.freeze([]) : Object.freeze(commandRecords);
  const safeArtifacts =
    status === "failed" ? Object.freeze([]) : Object.freeze(artifacts);
  const result = Object.freeze({
    schemaVersion: 2,
    configurationSha256,
    status,
    stage,
    commandCount: safeCommands.length,
    commands: safeCommands,
    artifacts: safeArtifacts,
    stateBytes,
    failure: status === "failed" ? (failure ?? "INTERNAL_FAIL_CLOSED") : null,
  });
  return serializedResult(
    result,
    resultBytesCeiling,
    configurationSha256,
    stage,
    stateBytes,
  );
}

const productionAuthority = Object.freeze({
  processRunner: runBoundedProcessBytes,
  trustedProcessEvidence: true,
  artifactCollector: collectProductionArtifacts,
  stateBytesReader: readProductionStateBytes,
});

export function runSandboxSessionWorkerV2(configurationBytes) {
  return withTaskV2FailureBoundary(() =>
    executeSession(configurationBytes, productionAuthority),
  );
}

function capturedTestingControllerOptions(options) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    utilTypes.isProxy(options) ||
    objectGetPrototypeOf(options) !== objectPrototype
  ) {
    schemaFault();
  }
  const captured = exactRecord(options, [
    "processRunner",
    "artifactCollector",
    "stateBytesReader",
  ]);
  if (
    typeof captured.processRunner !== "function" ||
    typeof captured.artifactCollector !== "function" ||
    typeof captured.stateBytesReader !== "function"
  ) {
    schemaFault();
  }
  return Object.freeze(captured);
}

export function createSandboxSessionWorkerV2ControllerForTesting(options) {
  const captured = capturedTestingControllerOptions(options);
  const authority = Object.freeze({
    ...captured,
    trustedProcessEvidence: false,
  });
  return Object.freeze({
    run(configurationBytes) {
      return withTaskV2FailureBoundary(() =>
        executeSession(configurationBytes, authority),
      );
    },
  });
}

function strictBase64(value) {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    schemaFault();
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) schemaFault();
  return bytes;
}

function validateCommandResult(value, expectedRole, maximumBytes) {
  const record = exactRecord(value, COMMAND_RESULT_KEYS);
  if (record.role !== expectedRole) schemaFault();
  const booleanKeys = [
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
  ];
  if (
    record.disposition !== "completed" ||
    record.firstTerminalReason !== "completed" ||
    booleanKeys.some((key) => typeof record[key] !== "boolean") ||
    !Number.isInteger(record.exitCode) ||
    record.exitCode < 0 ||
    record.exitCode > 255 ||
    record.signal !== null ||
    record.closeCode !== record.exitCode ||
    record.closeSignal !== null ||
    !Number.isSafeInteger(record.terminationErrorCount) ||
    record.terminationErrorCount !== 0 ||
    !Number.isSafeInteger(record.processErrorCount) ||
    record.processErrorCount !== 0 ||
    record.spawned !== true ||
    record.noChild !== false ||
    record.statusAgreement !== true ||
    record.reaped !== true ||
    record.directChildCleanupSafe !== true ||
    record.processGroupQuiescent !== true ||
    record.exitObserved !== true ||
    record.closeObserved !== true ||
    record.stdoutEof !== true ||
    record.stderrEof !== true ||
    record.stdinComplete !== true ||
    record.captureComplete !== true ||
    record.outputTruncated !== false ||
    !SHA256.test(record.stdoutSha256) ||
    !SHA256.test(record.stderrSha256)
  ) {
    schemaFault();
  }
  const stdout = strictBase64(record.stdoutBase64);
  const stderr = strictBase64(record.stderrBase64);
  const observedPassed = exactObservedPassed(
    expectedRole,
    record,
    stdout,
    stderr,
  );
  if (
    !Number.isSafeInteger(record.stdoutBytes) ||
    record.stdoutBytes !== stdout.length ||
    !Number.isSafeInteger(record.stderrBytes) ||
    record.stderrBytes !== stderr.length ||
    stdout.length + stderr.length > maximumBytes ||
    sha256(stdout) !== record.stdoutSha256 ||
    sha256(stderr) !== record.stderrSha256 ||
    record.observedPassed !== observedPassed
  ) {
    schemaFault();
  }
  return Object.freeze({ record, stdout, stderr });
}

function validateResultArtifact(value, names, maximumDiskBytes) {
  const record = exactRecord(value, ARTIFACT_KEYS);
  if (
    typeof record.name !== "string" ||
    !ARTIFACT_NAME.test(record.name) ||
    Buffer.byteLength(record.name) > ARTIFACT_NAME_BYTES_CEILING ||
    names.has(record.name) ||
    !SHA256.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes < 1 ||
    record.bytes > maximumDiskBytes ||
    !Number.isInteger(record.mode) ||
    record.mode < 1 ||
    record.mode > 0o777 ||
    (record.mode & 0o111) === 0
  ) {
    schemaFault();
  }
  names.add(record.name);
  return Object.freeze({ ...record });
}

function validatePrivateResult(value, configuration, configurationSha256) {
  const result = exactRecord(value, RESULT_KEYS);
  const roles = configuration.verificationSequence;
  if (
    result.schemaVersion !== 2 ||
    result.configurationSha256 !== configurationSha256 ||
    !["completed", "failed"].includes(result.status) ||
    !["complete", ...roles].includes(result.stage) ||
    !Number.isSafeInteger(result.commandCount) ||
    result.commandCount < 0 ||
    result.commandCount > roles.length
  ) {
    schemaFault();
  }
  const commands = denseArray(result.commands, roles.length);
  if (commands.length !== result.commandCount) schemaFault();
  const decoded = commands.map((record, index) =>
    validateCommandResult(
      record,
      roles[index],
      roles[index] === "build"
        ? configuration.ceilings.maxBuildOutputBytes
        : configuration.ceilings.maxTestOutputBytesPerCommand,
    ),
  );

  if (result.status === "completed") {
    if (result.failure !== null || result.stateBytes === null) schemaFault();
    const failedControlIndex = commands.findIndex(
      (record, index) => index < 2 && record.exitCode !== 0,
    );
    if (result.stage === "complete") {
      if (commands.length !== roles.length || failedControlIndex !== -1) {
        schemaFault();
      }
    } else {
      const stageIndex = roles.indexOf(result.stage);
      if (
        !["format", "build"].includes(result.stage) ||
        commands.length !== stageIndex + 1 ||
        failedControlIndex !== stageIndex
      ) {
        schemaFault();
      }
    }
  } else if (
    !FAILURE_CODES.has(result.failure) ||
    result.failure === "CONFIGURATION" ||
    result.stage === "complete" ||
    commands.length !== 0
  ) {
    schemaFault();
  }

  if (
    result.stateBytes !== null &&
    (!Number.isSafeInteger(result.stateBytes) ||
      result.stateBytes < 0 ||
      result.stateBytes > configuration.ceilings.maxVerifierDiskBytes)
  ) {
    schemaFault();
  }
  const artifactValues = denseArray(result.artifacts, ARTIFACT_COUNT_CEILING);
  if (result.status === "failed" && artifactValues.length !== 0) schemaFault();
  if (
    result.status === "completed" &&
    result.stage !== "complete" &&
    artifactValues.length !== 0
  ) {
    schemaFault();
  }
  const names = new Set();
  const artifacts = artifactValues.map((record) =>
    validateResultArtifact(
      record,
      names,
      configuration.ceilings.maxVerifierDiskBytes,
    ),
  );
  if (
    artifacts.some(
      (record, index) =>
        index > 0 && bytewiseNameOrder(artifacts[index - 1], record) >= 0,
    )
  ) {
    schemaFault();
  }
  let artifactBytes = 0;
  for (const artifact of artifacts) artifactBytes += artifact.bytes;
  if (artifactBytes > configuration.ceilings.maxVerifierDiskBytes)
    schemaFault();
  if (result.status === "completed" && result.stage === "complete") {
    let targets;
    try {
      targets = artifactTargetNames(configuration.commands.build.argv);
    } catch {
      schemaFault();
    }
    if (
      targets.some(
        (target) =>
          !artifacts.some(({ name }) => name.startsWith(`${target}-`)),
      )
    ) {
      schemaFault();
    }
  }
  return Object.freeze({ result, decoded, artifacts });
}

export function parseSandboxSessionWorkerResultV2(
  resultBytes,
  configurationBytes,
) {
  const parsedConfiguration =
    parseSandboxSessionWorkerConfigurationV2(configurationBytes);
  const { copied, value } = parseCanonicalWire(
    resultBytes,
    parsedConfiguration.resultBytesCeiling,
  );
  const { result, decoded, artifacts } = validatePrivateResult(
    value,
    parsedConfiguration.configuration,
    parsedConfiguration.configurationSha256,
  );
  const commands = decoded.map(({ record, stdout, stderr }) =>
    Object.freeze({
      role: record.role,
      disposition: record.disposition,
      exitCode: record.exitCode,
      signal: record.signal,
      observedPassed: record.observedPassed,
      stdoutBytes: record.stdoutBytes,
      stdoutSha256: record.stdoutSha256,
      stdoutTailBase64: stdout
        .subarray(Math.max(0, stdout.length - PUBLIC_TAIL_BYTES))
        .toString("base64"),
      stderrBytes: record.stderrBytes,
      stderrSha256: record.stderrSha256,
      stderrTailBase64: stderr
        .subarray(Math.max(0, stderr.length - PUBLIC_TAIL_BYTES))
        .toString("base64"),
    }),
  );
  return Object.freeze({
    resultSha256: sha256(copied),
    resultBytes: copied.length,
    schemaVersion: 2,
    configurationSha256: result.configurationSha256,
    status: result.status,
    stage: result.stage,
    commandCount: result.commandCount,
    commands: Object.freeze(commands),
    artifacts: Object.freeze(artifacts),
    stateBytes: result.stateBytes,
    failure: result.failure,
  });
}

function readConfigurationFromStdin() {
  const chunks = [];
  let total = 0;
  const chunk = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const count = readSync(0, chunk, 0, chunk.length, null);
    if (count === 0) break;
    total += count;
    if (total > V2_SESSION_CONFIGURATION_BYTES_CEILING) {
      throw new WorkerFault("CONFIGURATION");
    }
    chunks.push(Buffer.from(chunk.subarray(0, count)));
  }
  if (total === 0) throw new WorkerFault("CONFIGURATION");
  return Buffer.concat(chunks, total);
}

function writeResultFile(bytes) {
  let descriptor;
  try {
    descriptor = openSync(
      RESULT_PATH,
      fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW | fsConstants.O_CLOEXEC,
    );
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600 ||
      metadata.size !== 0 ||
      (typeof process.getuid === "function" &&
        metadata.uid !== process.getuid())
    ) {
      throw new WorkerFault("STATE_INVARIANT");
    }
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (written < 1) throw new WorkerFault("STATE_INVARIANT");
      offset += written;
    }
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isDirectWorkerEntrypoint() {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectWorkerEntrypoint()) {
  try {
    const configurationBytes = readConfigurationFromStdin();
    const resultBytes = await runSandboxSessionWorkerV2(configurationBytes);
    writeResultFile(resultBytes);
  } catch {
    process.exitCode = 70;
  }
}
