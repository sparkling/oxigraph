import { spawn } from "node:child_process";
import { fstatSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { types as utilTypes } from "node:util";

const maximumInheritedFileDescriptors = 32;
const maximumByteProcessArguments = 4_096;
const maximumByteProcessArgumentBytes = 1024 * 1024;
const maximumByteProcessEnvironmentEntries = 4_096;
const maximumByteProcessEnvironmentBytes = 1024 * 1024;
const maximumByteProcessOutputBytes = 256 * 1024 * 1024;
const maximumByteProcessTimeoutMs = 7_200_000;
const byteProcessTerminationGraceMs = 250;
const byteProcessReapDeadlineMs = 2_000;
const NativeAbortController = AbortController;
const arrayPrototype = Array.prototype;
const objectPrototype = Object.prototype;
const objectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const objectGetPrototypeOf = Object.getPrototypeOf;
const reflectOwnKeys = Reflect.ownKeys;
const nativeAbortSignalPrototype = AbortSignal.prototype;
const nativeAbortedGetter = Object.getOwnPropertyDescriptor(
  nativeAbortSignalPrototype,
  "aborted",
).get;
const nativeAddEventListener = EventTarget.prototype.addEventListener;
const nativeRemoveEventListener = EventTarget.prototype.removeEventListener;
const nativeProcessKill = process.kill.bind(process);
// This single strong root bounds both active capture and unreaped retention.
// A later run is rejected until the owned direct child reaches genuine
// close/status/EOF observations (or native spawn proves there was no child).
// No completion token or lifecycle authority is exposed to callers.
let activeOrRetainedByteProcess;

function capturedAbortSignal(value) {
  if (value === undefined) {
    return Object.freeze({ signal: undefined, release() {} });
  }
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) {
    throw new Error("process cancellation signal must be a genuine native AbortSignal");
  }
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    throw new Error("process cancellation signal cannot be inspected safely", {
      cause: error,
    });
  }
  if (prototype !== nativeAbortSignalPrototype) {
    throw new Error("process cancellation signal must be a native AbortSignal");
  }
  try {
    nativeAbortedGetter.call(value);
  } catch (error) {
    throw new Error("process cancellation signal failed its native brand check", {
      cause: error,
    });
  }
  const controller = new NativeAbortController();
  const propagate = () => controller.abort();
  try {
    // Subscribe first and then re-read to close the same abort race as the
    // process-side listener. This all occurs before spawn.
    nativeAddEventListener.call(value, "abort", propagate, { once: true });
    if (nativeAbortedGetter.call(value)) controller.abort();
  } catch (error) {
    try {
      nativeRemoveEventListener.call(value, "abort", propagate);
    } catch {}
    throw new Error("process cancellation signal could not be captured", {
      cause: error,
    });
  }
  let source = value;
  let released = false;
  return Object.freeze({
    signal: controller.signal,
    release() {
      if (released) return;
      released = true;
      const captured = source;
      source = undefined;
      if (captured === undefined) return;
      try {
        if (nativeAbortedGetter.call(captured)) controller.abort();
        nativeRemoveEventListener.call(captured, "abort", propagate);
        if (nativeAbortedGetter.call(captured)) controller.abort();
      } catch {}
    },
  });
}

function validatedInheritedFileDescriptors(value) {
  if (!Array.isArray(value) || value.length > maximumInheritedFileDescriptors) {
    throw new Error("inherited file descriptors must be a bounded array");
  }
  const descriptors = [...value];
  if (
    descriptors.some((descriptor) => !Number.isInteger(descriptor) || descriptor < 0) ||
    new Set(descriptors).size !== descriptors.length
  ) {
    throw new Error("inherited file descriptors must be unique non-negative integers");
  }
  for (const [index, descriptor] of descriptors.entries()) {
    try {
      fstatSync(descriptor);
    } catch (error) {
      throw new Error(`inherited file descriptor ${index} is not live`, { cause: error });
    }
  }
  return descriptors;
}

function ownDataRecord(value, { allowed, required, label }) {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) {
    throw new Error(`${label} must be a plain own-data record`);
  }
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    throw new Error(`${label} cannot be inspected safely`, { cause: error });
  }
  if (prototype !== objectPrototype && prototype !== null) {
    throw new Error(`${label} must be a plain own-data record`);
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    throw new Error(`${label} must not contain symbol properties`);
  }
  for (const key of keys) {
    if (!allowed.has(key)) {
      throw new Error(`${label} has an unexpected property: ${key}`);
    }
    if (!("value" in descriptors[key])) {
      throw new Error(`${label} property ${key} must be an own data property`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(descriptors, key)) {
      throw new Error(`${label} is missing required property: ${key}`);
    }
  }
  return Object.freeze(
    Object.fromEntries(keys.map((key) => [key, descriptors[key].value])),
  );
}

function capturedDenseArray(value, label, maximumLength, validate) {
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !Array.isArray(value)
  ) {
    throw new Error(`${label} must be a plain dense array`);
  }
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    throw new Error(`${label} cannot be inspected safely`, { cause: error });
  }
  if (prototype !== arrayPrototype) {
    throw new Error(`${label} must be a plain dense array`);
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const lengthDescriptor = descriptors.length;
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > maximumLength
  ) {
    throw new Error(`${label} must be a bounded plain dense array`);
  }
  const length = lengthDescriptor.value;
  const keys = reflectOwnKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    throw new Error(`${label} must not contain symbol properties`);
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
    throw new Error(`${label} must be a plain dense array`);
  }
  const captured = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`${label} must contain only own data elements`);
    }
    validate(descriptor.value, index);
    captured.push(descriptor.value);
  }
  return Object.freeze(captured);
}

function capturedByteProcessEnvironment(value) {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value)) {
    throw new Error("process environment must be a plain own-data record");
  }
  let prototype;
  try {
    prototype = objectGetPrototypeOf(value);
  } catch (error) {
    throw new Error("process environment cannot be inspected safely", {
      cause: error,
    });
  }
  if (prototype !== objectPrototype && prototype !== null) {
    throw new Error("process environment must be a plain own-data record");
  }
  const descriptors = objectGetOwnPropertyDescriptors(value);
  const keys = reflectOwnKeys(descriptors);
  if (
    keys.length > maximumByteProcessEnvironmentEntries ||
    keys.some((key) => typeof key === "symbol")
  ) {
    throw new Error("process environment must be a bounded string record");
  }
  const environment = Object.create(null);
  let totalBytes = 0;
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor)) {
      throw new Error(`process environment property ${key} must be data`);
    }
    const entry = descriptor.value;
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.includes("\0") ||
      key.includes("=") ||
      typeof entry !== "string" ||
      entry.includes("\0")
    ) {
      throw new Error(`process environment property ${key} is not a safe string entry`);
    }
    totalBytes += Buffer.byteLength(key) + Buffer.byteLength(entry);
    if (totalBytes > maximumByteProcessEnvironmentBytes) {
      throw new Error("process environment exceeds its byte ceiling");
    }
    environment[key] = entry;
  }
  return Object.freeze(environment);
}

function capturedByteProcessInput(input) {
  const allowed = new Set([
    "executable",
    "args",
    "cwd",
    "environment",
    "timeoutMs",
    "maxOutputBytes",
    "signal",
    "inheritedFileDescriptors",
  ]);
  const captured = ownDataRecord(input, {
    allowed,
    required: [
      "executable",
      "args",
      "cwd",
      "environment",
      "timeoutMs",
      "maxOutputBytes",
    ],
    label: "bounded byte process input",
  });
  if (
    typeof captured.executable !== "string" ||
    captured.executable.length === 0 ||
    captured.executable.length > 4_096 ||
    captured.executable.includes("\0")
  ) {
    throw new Error("process executable must be a bounded non-empty string");
  }
  if (
    typeof captured.cwd !== "string" ||
    captured.cwd.length === 0 ||
    captured.cwd.length > 4_096 ||
    captured.cwd.includes("\0")
  ) {
    throw new Error("process working directory must be a bounded non-empty string");
  }
  if (
    !Number.isInteger(captured.timeoutMs) ||
    captured.timeoutMs <= 0 ||
    captured.timeoutMs > maximumByteProcessTimeoutMs
  ) {
    throw new Error("process timeout must be a bounded positive integer");
  }
  if (
    !Number.isInteger(captured.maxOutputBytes) ||
    captured.maxOutputBytes <= 0 ||
    captured.maxOutputBytes > maximumByteProcessOutputBytes
  ) {
    throw new Error("process output ceiling must be a bounded positive integer");
  }
  let aggregateArgumentBytes = 0;
  const args = capturedDenseArray(
    captured.args,
    "process arguments",
    maximumByteProcessArguments,
    (argument, index) => {
      if (typeof argument !== "string" || argument.includes("\0")) {
        throw new Error(`process argument ${index} is not a bounded safe string`);
      }
      const argumentBytes = Buffer.byteLength(argument, "utf8");
      if (argumentBytes > maximumByteProcessArgumentBytes) {
        throw new Error(`process argument ${index} is not a bounded safe string`);
      }
      aggregateArgumentBytes += argumentBytes;
      if (aggregateArgumentBytes > maximumByteProcessArgumentBytes) {
        throw new Error("process arguments exceed their aggregate UTF-8 byte ceiling");
      }
    },
  );
  const inheritedFileDescriptors = capturedDenseArray(
    captured.inheritedFileDescriptors ?? [],
    "inherited file descriptors",
    maximumInheritedFileDescriptors,
    (descriptor) => {
      if (!Number.isInteger(descriptor) || descriptor < 0) {
        throw new Error(
          "inherited file descriptors must be unique non-negative integers",
        );
      }
    },
  );
  if (new Set(inheritedFileDescriptors).size !== inheritedFileDescriptors.length) {
    throw new Error(
      "inherited file descriptors must be unique non-negative integers",
    );
  }
  for (const [index, descriptor] of inheritedFileDescriptors.entries()) {
    try {
      fstatSync(descriptor);
    } catch (error) {
      throw new Error(`inherited file descriptor ${index} is not live`, {
        cause: error,
      });
    }
  }
  return Object.freeze({
    executable: captured.executable,
    args,
    cwd: captured.cwd,
    environment: capturedByteProcessEnvironment(captured.environment),
    timeoutMs: captured.timeoutMs,
    maxOutputBytes: captured.maxOutputBytes,
    signal: captured.signal,
    inheritedFileDescriptors,
  });
}

function diagnosticError(error) {
  const text = (field, fallback) => {
    try {
      return typeof error?.[field] === "string"
        ? error[field].slice(0, 4_096)
        : fallback;
    } catch {
      return fallback;
    }
  };
  return Object.freeze({
    name: text("name", "Error"),
    code: text("code", "UNKNOWN"),
    message: text("message", "native process error"),
  });
}

function sealByteProcessCapture(state) {
  if (state.capture !== undefined) return state.capture;
  const stdout =
    state.stdoutChunks.length === 0
      ? Buffer.alloc(0)
      : Buffer.concat(state.stdoutChunks, state.stdoutBytes);
  const stderr =
    state.stderrChunks.length === 0
      ? Buffer.alloc(0)
      : Buffer.concat(state.stderrChunks, state.stderrBytes);
  state.capture = Object.freeze({ stdout, stderr });
  state.stdoutChunks = [];
  state.stderrChunks = [];
  return state.capture;
}

function byteProcessStatus(state) {
  const noChild =
    !state.spawned &&
    (state.child === undefined || state.spawnErrorObserved);
  const statusAgreement =
    state.exitObserved &&
    state.closeObserved &&
    state.exitCode === state.closeCode &&
    state.exitSignal === state.closeSignal;
  const reaped =
    state.spawned &&
    statusAgreement &&
    state.stdoutEof &&
    state.stderrEof;
  const directChildCleanupSafe =
    noChild ||
    (state.spawned && state.closeObserved && state.exitObserved);
  return Object.freeze({
    noChild,
    statusAgreement,
    reaped,
    directChildCleanupSafe,
  });
}

function byteProcessOutcome(state, disposition) {
  const capture = sealByteProcessCapture(state);
  const terminationErrors = Object.freeze(
    state.terminationErrors.map((record) => Object.freeze({ ...record })),
  );
  const processErrors = Object.freeze([...state.processErrors]);
  const status = byteProcessStatus(state);
  const captureComplete =
    status.reaped &&
    status.statusAgreement &&
    processErrors.length === 0 &&
    !state.outputTruncated;
  return Object.freeze({
    disposition,
    firstTerminalReason: state.terminalReason,
    syntheticTestOnly: false,
    spawned: state.spawned,
    noChild: status.noChild,
    exitCode: state.exitCode,
    signal: state.exitSignal,
    closeCode: state.closeCode,
    closeSignal: state.closeSignal,
    statusAgreement: status.statusAgreement,
    reaped: status.reaped,
    directChildCleanupSafe: status.directChildCleanupSafe,
    exitObserved: state.exitObserved,
    closeObserved: state.closeObserved,
    stdoutEof: state.stdoutEof,
    stderrEof: state.stderrEof,
    captureComplete,
    outputTruncated: state.outputTruncated,
    get stdout() {
      return Buffer.from(capture.stdout);
    },
    get stderr() {
      return Buffer.from(capture.stderr);
    },
    durationMs: Math.round(performance.now() - state.started),
    terminationErrors,
    processErrors,
  });
}

/**
 * Test-only pure event-status driver. It cannot execute a command, capture
 * bytes, retain a child, or produce the production diagnostic shape.
 */
export function deriveBoundedProcessByteStatusForTesting(input) {
  const captured = ownDataRecord(input, {
    allowed: new Set([
      "spawned",
      "spawnErrorObserved",
      "exitObserved",
      "exitCode",
      "exitSignal",
      "closeObserved",
      "closeCode",
      "closeSignal",
      "stdoutEof",
      "stderrEof",
    ]),
    required: [
      "spawned",
      "spawnErrorObserved",
      "exitObserved",
      "exitCode",
      "exitSignal",
      "closeObserved",
      "closeCode",
      "closeSignal",
      "stdoutEof",
      "stderrEof",
    ],
    label: "synthetic test-only byte process status input",
  });
  for (const key of [
    "spawned",
    "spawnErrorObserved",
    "exitObserved",
    "closeObserved",
    "stdoutEof",
    "stderrEof",
  ]) {
    if (typeof captured[key] !== "boolean") {
      throw new Error(`synthetic test-only byte process status ${key} must be boolean`);
    }
  }
  for (const key of ["exitCode", "closeCode"]) {
    if (
      captured[key] !== null &&
      !Number.isInteger(captured[key])
    ) {
      throw new Error(`synthetic test-only byte process status ${key} is invalid`);
    }
  }
  for (const key of ["exitSignal", "closeSignal"]) {
    if (
      captured[key] !== null &&
      (typeof captured[key] !== "string" || captured[key].length === 0)
    ) {
      throw new Error(`synthetic test-only byte process status ${key} is invalid`);
    }
  }
  return Object.freeze({
    schema: "oxigraph.synthetic-test-only-bounded-process-byte-status/v1",
    syntheticTestOnly: true,
    ...byteProcessStatus({ ...captured, child: undefined }),
  });
}

function terminateByteProcess(state, signal) {
  if (state.child === undefined) return;
  if (!Number.isInteger(state.child.pid) || state.child.pid <= 0) {
    state.terminationErrors.push({
      signal,
      error: "child process has no positive pid",
    });
    return;
  }
  try {
    nativeProcessKill(-state.child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      state.terminationErrors.push({
        signal,
        error: `${error?.code ?? error?.name ?? "Error"}: ${error?.message ?? "termination failed"}`,
      });
    }
  }
}

/**
 * Runs one native process with a shared raw-output byte ceiling.
 *
 * The returned value is an authority-free diagnostic, not a child-reap proof or
 * a workspace/containment completion capability. In particular, callers cannot
 * inject a process runner, kill implementation, clock, or observed outcome.
 */
export function runBoundedProcessBytes(input) {
  if (process.platform === "win32") {
    throw new Error(
      "bounded byte process execution is disabled on Windows until job-object tree termination exists",
    );
  }
  const request = capturedByteProcessInput(input);
  const cancellation = capturedAbortSignal(request.signal);
  const capturedSignal = cancellation.signal;
  const started = performance.now();
  if (
    capturedSignal !== undefined &&
    nativeAbortedGetter.call(capturedSignal)
  ) {
    cancellation.release();
    return Promise.resolve(
      byteProcessOutcome(
        {
          started,
          spawned: false,
          exitCode: null,
          exitSignal: null,
          closeCode: null,
          closeSignal: null,
          exitObserved: false,
          closeObserved: false,
          stdoutEof: false,
          stderrEof: false,
          terminalReason: "cancelled",
          spawnErrorObserved: false,
          outputTruncated: false,
          stdoutChunks: [],
          stderrChunks: [],
          stdoutBytes: 0,
          stderrBytes: 0,
          capture: undefined,
          terminationErrors: [],
          processErrors: [],
        },
        "cancelled",
      ),
    );
  }
  if (activeOrRetainedByteProcess !== undefined) {
    cancellation.release();
    const error = new Error(
      "bounded byte process execution is busy with an active or retained process",
    );
    error.code = "ERR_BOUNDED_BYTE_PROCESS_BUSY";
    throw error;
  }

  return new Promise((resolve) => {
    const state = {
      started,
      child: undefined,
      spawned: false,
      terminalReason: undefined,
      exitCode: null,
      exitSignal: null,
      closeCode: null,
      closeSignal: null,
      exitObserved: false,
      closeObserved: false,
      stdoutEof: false,
      stderrEof: false,
      spawnErrorObserved: false,
      outputTruncated: false,
      stdoutChunks: [],
      stderrChunks: [],
      stdoutBytes: 0,
      stderrBytes: 0,
      capturedBytes: 0,
      capture: undefined,
      terminationErrors: [],
      processErrors: [],
      abortSubscribed: false,
      timeout: undefined,
      killTimer: undefined,
      reapTimer: undefined,
      promiseSettled: false,
      cancellation,
      capturedSignal,
      resolve,
    };
    activeOrRetainedByteProcess = state;

    const releaseCancellation = () => {
      if (state.abortSubscribed) {
        nativeRemoveEventListener.call(capturedSignal, "abort", abort);
        state.abortSubscribed = false;
      }
      state.cancellation.release();
    };
    const clearTimers = () => {
      clearTimeout(state.timeout);
      clearTimeout(state.killTimer);
      clearTimeout(state.reapTimer);
    };
    const releaseAdmission = () => {
      if (activeOrRetainedByteProcess === state) {
        activeOrRetainedByteProcess = undefined;
      }
    };
    const settle = (unreapedDeadline = false) => {
      if (state.promiseSettled) return;
      state.promiseSettled = true;
      clearTimers();
      releaseCancellation();
      const reason = state.terminalReason ?? "completed";
      if (state.terminalReason === undefined) state.terminalReason = reason;
      const status = byteProcessStatus(state);
      const retain = !status.noChild && !status.reaped;
      if (!retain) releaseAdmission();
      state.resolve(
        byteProcessOutcome(
          state,
          unreapedDeadline || retain ? `${reason}-unreaped` : reason,
        ),
      );
    };
    const observeTerminalProgress = () => {
      const status = byteProcessStatus(state);
      if (state.promiseSettled) {
        // Late native observations may release only this low-level strong root.
        // They never mutate the already-sealed outcome or create success proof.
        if (status.noChild || status.reaped) releaseAdmission();
        return;
      }
      if (
        state.closeObserved &&
        (status.noChild ||
          (state.exitObserved && state.stdoutEof && state.stderrEof))
      ) {
        settle();
      }
    };
    const stop = (reason) => {
      if (state.terminalReason !== undefined) return;
      state.terminalReason = reason;
      terminateByteProcess(state, "SIGTERM");
      state.killTimer = setTimeout(() => {
        terminateByteProcess(state, "SIGKILL");
      }, byteProcessTerminationGraceMs);
      state.reapTimer = setTimeout(() => {
        settle(true);
      }, byteProcessReapDeadlineMs);
    };
    const append = (name, chunkInput) => {
      if (state.capture !== undefined) return;
      const chunk = Buffer.from(chunkInput);
      const remaining = Math.max(
        0,
        request.maxOutputBytes - state.capturedBytes,
      );
      if (chunk.length > remaining) {
        state.outputTruncated = true;
        stop("output-limit");
      }
      const admitted = chunk.subarray(0, remaining);
      if (admitted.length === 0) return;
      const stored = Buffer.from(admitted);
      state[`${name}Chunks`].push(stored);
      state[`${name}Bytes`] += stored.length;
      state.capturedBytes += stored.length;
    };
    const abort = () => stop("cancelled");

    try {
      state.child = spawn(request.executable, request.args, {
        cwd: request.cwd,
        env: request.environment,
        detached: true,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
          ...request.inheritedFileDescriptors,
        ],
      });
    } catch (error) {
      state.terminalReason = "spawn-error";
      state.processErrors.push(diagnosticError(error));
      settle();
      return;
    }

    const attach = (stream, name) => {
      if (stream === null || stream === undefined) {
        stop(`${name}-unavailable`);
        return;
      }
      stream.on("data", (chunk) => append(name, chunk));
      stream.once("end", () => {
        state[`${name}Eof`] = true;
        observeTerminalProgress();
      });
      stream.once("error", (error) => {
        state.processErrors.push(diagnosticError(error));
        stop(`${name}-error`);
      });
    };
    attach(state.child.stdout, "stdout");
    attach(state.child.stderr, "stderr");
    state.child.once("spawn", () => {
      state.spawned = true;
    });
    state.child.once("error", (error) => {
      state.spawnErrorObserved = !state.spawned;
      state.processErrors.push(diagnosticError(error));
      stop("spawn-error");
    });
    state.child.once("exit", (exitCode, exitSignal) => {
      state.exitObserved = true;
      state.exitCode = exitCode;
      state.exitSignal = exitSignal;
      observeTerminalProgress();
    });
    state.child.once("close", (exitCode, exitSignal) => {
      state.closeObserved = true;
      state.closeCode = exitCode;
      state.closeSignal = exitSignal;
      observeTerminalProgress();
    });
    state.timeout = setTimeout(() => stop("timeout"), request.timeoutMs);
    if (capturedSignal !== undefined) {
      nativeAddEventListener.call(capturedSignal, "abort", abort, { once: true });
      state.abortSubscribed = true;
      if (nativeAbortedGetter.call(capturedSignal)) abort();
    }
  });
}

function terminate(child, signal, killProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return null;
  try {
    if (!Number.isInteger(child.pid)) child.kill(signal);
    else killProcess(-child.pid, signal);
    return null;
  } catch (error) {
    if (error.code === "ESRCH") return null;
    return `${error.code ?? error.name}: ${error.message}`;
  }
}

export function runBoundedProcess({
  executable,
  args,
  cwd,
  environment,
  stdin = "",
  timeoutMs,
  maxOutputBytes,
  signal,
  killProcess = process.kill,
  inheritedFileDescriptors = [],
}) {
  if (process.platform === "win32") {
    throw new Error("bounded process execution is disabled on Windows until job-object tree termination exists");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("process timeout must be a positive integer");
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error("process output ceiling must be a positive integer");
  }
  const inherited = validatedInheritedFileDescriptors(inheritedFileDescriptors);
  const cancellation = capturedAbortSignal(signal);
  const capturedSignal = cancellation.signal;
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let child;
    try {
      child = spawn(executable, args, {
        cwd,
        env: environment,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe", ...inherited],
      });
    } catch (error) {
      cancellation.release();
      throw error;
    }
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let disposition = "completed";
    let killTimer;
    let reapTimer;
    let timeout;
    let settled = false;
    let capturedBytes = 0;
    const terminationErrors = [];

    const outcome = (exitCode, exitSignal) =>
      Object.freeze({
        exitCode,
        signal: exitSignal,
        disposition,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
        durationMs: Math.round(performance.now() - started),
        terminationErrors: Object.freeze([...terminationErrors]),
      });
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
      if (capturedSignal !== undefined) {
        nativeRemoveEventListener.call(capturedSignal, "abort", abort);
      }
      cancellation.release();
    };

    const stop = (reason) => {
      if (disposition !== "completed") return;
      disposition = reason;
      const termError = terminate(child, "SIGTERM", killProcess);
      if (termError !== null) terminationErrors.push({ signal: "SIGTERM", error: termError });
      killTimer = setTimeout(() => {
        const killError = terminate(child, "SIGKILL", killProcess);
        if (killError !== null) {
          terminationErrors.push({ signal: "SIGKILL", error: killError });
        }
      }, 250);
      reapTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        disposition = `${disposition}-unreaped`;
        cleanup();
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        resolve(outcome(null, null));
      }, 2_000);
    };
    const append = (target, chunk) => {
      const remaining = Math.max(0, maxOutputBytes - capturedBytes);
      if (chunk.length > remaining) stop("output-limit");
      const admitted = chunk.subarray(0, remaining);
      capturedBytes += admitted.length;
      return admitted.length === 0 ? target : Buffer.concat([target, admitted]);
    };
    const abort = () => stop("cancelled");
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome(exitCode, exitSignal));
    });
    timeout = setTimeout(() => stop("timeout"), timeoutMs);
    if (capturedSignal !== undefined) {
      // Subscribe first, then re-read. An abort between these operations is
      // either delivered by EventTarget or observed by the getter; `stop` is
      // idempotent when both paths win the race.
      nativeAddEventListener.call(capturedSignal, "abort", abort, {
        once: true,
      });
      if (nativeAbortedGetter.call(capturedSignal)) abort();
    }
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE" && !settled) stop("stdin-error");
    });
    child.stdin.end(stdin);
  });
}
