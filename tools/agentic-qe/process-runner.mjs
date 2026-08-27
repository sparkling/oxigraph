import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { TextDecoder } from "node:util";
import { scrubbedChildEnvironment } from "../child-environment.mjs";
import {
  countCargoPassedTests,
  normalizeCargoTestObservation,
  parseCargoTestSummaries,
} from "./native-test-contract.mjs";
import {
  nodeSummaryFields,
  nodeTestDuration,
  nodeTestPlan,
  nodeTestSummary,
  normalizeNodeTestSummary,
  parseNodeTestSummary,
} from "./node-test-contract.mjs";
import { repoRoot } from "./path-policy.mjs";

const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_SCANNER_LINE_BYTES = 65_536;
const MAX_CARGO_TEST_IDS = 16_384;
const MAX_CARGO_TEST_ID_BYTES = 4_096;
const MAX_CARGO_TEST_ID_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_CARGO_SUMMARIES = 4_096;
const MAX_DUPLICATE_MARKERS = 2;
const DEFAULT_TERMINATION_GRACE_MS = 5_000;

function tail(value, max = 65536) {
  return value.length <= max ? value : value.slice(value.length - max);
}

function quoteForDisplay(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value);
}

function signalTree(child, signal) {
  if (
    process.platform === "win32" ||
    !Number.isInteger(child.pid) ||
    child.pid <= 0
  ) {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

export async function execute(program, args, options = {}) {
  const captureOutputBytes = options.captureOutputBytes;
  const outputLimitBytes = captureOutputBytes ?? MAX_CAPTURED_OUTPUT_BYTES;
  const retainedOutputCharacters =
    options.retainCompleteOutput === true ? outputLimitBytes : 65_536;
  const retainOutput = (value) => tail(value, retainedOutputCharacters);
  const terminationGraceMs =
    options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
  if (
    options.inheritEnvironment !== undefined &&
    typeof options.inheritEnvironment !== "boolean"
  ) {
    throw new Error("process environment inheritance policy is invalid");
  }
  if (
    captureOutputBytes !== undefined &&
    (!Number.isSafeInteger(captureOutputBytes) ||
      captureOutputBytes < 1 ||
      captureOutputBytes > MAX_CAPTURED_OUTPUT_BYTES)
  ) {
    throw new Error("captured process output ceiling is invalid");
  }
  if (
    !Number.isSafeInteger(terminationGraceMs) ||
    terminationGraceMs < 1 ||
    terminationGraceMs > DEFAULT_TERMINATION_GRACE_MS
  ) {
    throw new Error("process termination grace period is invalid");
  }
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let outputLimitExceeded = false;
  let scanLimitExceeded = false;
  let scanFailureReason = null;
  let acceptingOutput = true;
  const capturedStdout = [];
  const capturedStderr = [];
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  const cargoTestScan = {
    stdout: "",
    stderr: "",
    summaries: [],
    sequence: { stdout: 0, stderr: 0 },
    lastNonemptySequence: { stdout: 0, stderr: 0 },
    lastSummarySequence: { stdout: 0, stderr: 0 },
  };
  const cargoTestIdScan = options.captureCargoTestIds
    ? {
        stdout: "",
        stderr: "",
        ids: [],
        totalBytes: 0,
      }
    : null;
  const nodeTestScan = {
    stdout: "",
    plans: [],
    durations: [],
    lastNonemptyLines: [],
    values: Object.fromEntries(nodeSummaryFields.map((field) => [field, []])),
  };
  const display = [program, ...args].map(quoteForDisplay).join(" ");
  if (options.announce !== false) console.log(`\n$ ${display}`);

  const failScan = (reason) => {
    scanLimitExceeded = true;
    if (scanFailureReason === null) scanFailureReason = reason;
  };

  const scanLines = (scan, stream, text, onLine, flush = false) => {
    if (scanLimitExceeded) {
      scan[stream] = "";
      return;
    }
    const lines = `${scan[stream]}${text}`.split(/\r?\n/u);
    if (!flush) {
      const fragment = lines.pop() ?? "";
      if (Buffer.byteLength(fragment, "utf8") > MAX_SCANNER_LINE_BYTES) {
        failScan("unterminated-scanner-fragment-limit");
        scan[stream] = "";
        return;
      }
      scan[stream] = fragment;
    }
    for (const line of lines) {
      if (Buffer.byteLength(line, "utf8") > MAX_SCANNER_LINE_BYTES) {
        failScan("scanner-line-limit");
        break;
      }
      onLine(line);
      if (scanLimitExceeded) break;
    }
    if (flush) scan[stream] = "";
  };

  const pushDuplicateMarker = (values, value) => {
    if (values.length < MAX_DUPLICATE_MARKERS) values.push(value);
    else failScan("duplicate-node-summary-limit");
  };

  const scanCargoTestOutput = (stream, text, flush = false) => {
    scanLines(
      cargoTestScan,
      stream,
      text,
      (line) => {
        if (line.length > 0) {
          cargoTestScan.sequence[stream] += 1;
          cargoTestScan.lastNonemptySequence[stream] =
            cargoTestScan.sequence[stream];
        }
        for (const summary of parseCargoTestSummaries(line)) {
          if (cargoTestScan.summaries.length >= MAX_CARGO_SUMMARIES) {
            failScan("cargo-summary-count-limit");
            return;
          }
          const counts = [
            summary.passed,
            summary.failed,
            summary.ignored,
            summary.measured,
            summary.filteredOut,
          ];
          if (counts.some((count) => !Number.isSafeInteger(count))) {
            failScan("cargo-summary-integer-limit");
            return;
          }
          cargoTestScan.summaries.push({ ...summary, stream });
          cargoTestScan.lastSummarySequence[stream] =
            cargoTestScan.sequence[stream];
        }
      },
      flush,
    );
  };
  const scanCargoTestIds = (stream, text, flush = false) => {
    if (cargoTestIdScan === null) return;
    scanLines(
      cargoTestIdScan,
      stream,
      text,
      (line) => {
        const match = /^(\S(?:.*\S)?): test$/u.exec(line);
        if (match === null) return;
        const idBytes = Buffer.byteLength(match[1], "utf8");
        if (idBytes > MAX_CARGO_TEST_ID_BYTES) {
          failScan("cargo-test-id-byte-limit");
        } else if (cargoTestIdScan.ids.length >= MAX_CARGO_TEST_IDS) {
          failScan("cargo-test-id-count-limit");
        } else if (
          cargoTestIdScan.totalBytes + idBytes >
          MAX_CARGO_TEST_ID_TOTAL_BYTES
        ) {
          failScan("cargo-test-id-total-byte-limit");
        } else {
          cargoTestIdScan.ids.push(match[1]);
          cargoTestIdScan.totalBytes += idBytes;
        }
      },
      flush,
    );
  };
  const scanNodeTestOutput = (text, flush = false) => {
    scanLines(
      nodeTestScan,
      "stdout",
      text,
      (line) => {
        if (line.length > 0) {
          nodeTestScan.lastNonemptyLines.push(line);
          if (nodeTestScan.lastNonemptyLines.length > 9) {
            nodeTestScan.lastNonemptyLines.shift();
          }
        }
        const plan = nodeTestPlan.exec(line);
        if (plan) {
          pushDuplicateMarker(nodeTestScan.plans, Number.parseInt(plan[1], 10));
          return;
        }
        const summary = nodeTestSummary.exec(line);
        if (summary) {
          pushDuplicateMarker(
            nodeTestScan.values[summary[1]],
            Number.parseInt(summary[2], 10),
          );
          return;
        }
        const duration = nodeTestDuration.exec(line);
        if (duration) {
          pushDuplicateMarker(
            nodeTestScan.durations,
            Number.parseFloat(duration[1]),
          );
        }
      },
      flush,
    );
  };

  const scannerDecoders = {
    stdout: new TextDecoder("utf-8", { fatal: true }),
    stderr: new TextDecoder("utf-8", { fatal: true }),
  };
  const decoderFailed = { stdout: false, stderr: false };
  const decodeScannerText = (stream, chunk, flush = false) => {
    if (decoderFailed[stream]) return "";
    try {
      return scannerDecoders[stream].decode(chunk, { stream: !flush });
    } catch {
      decoderFailed[stream] = true;
      failScan("invalid-or-incomplete-utf8");
      return "";
    }
  };
  const scanDecodedOutput = (stream, text, flush = false) => {
    scanCargoTestOutput(stream, text, flush);
    scanCargoTestIds(stream, text, flush);
    if (stream === "stdout") scanNodeTestOutput(text, flush);
  };

  const result = await new Promise((resolvePromise) => {
    let settled = false;
    let timedOut = false;
    let terminationStarted = false;
    let terminationReason = null;
    let terminationSignalError = null;
    let terminationCloseResult = null;
    let timeoutHandle;
    let forceKillHandle;
    const child = spawn(program, args, {
      cwd: options.cwd ?? repoRoot,
      env: scrubbedChildEnvironment(
        options.env,
        options.inheritEnvironment === false ? {} : process.env,
      ),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stopOutputStreams = () => {
      acceptingOutput = false;
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const settle = (value) => {
      if (settled) return;
      settled = true;
      acceptingOutput = false;
      clearTimeout(timeoutHandle);
      clearTimeout(forceKillHandle);
      resolvePromise(value);
    };
    const beginTermination = (reason) => {
      if (terminationStarted) return;
      terminationStarted = true;
      terminationReason = reason;
      acceptingOutput = false;
      if (reason === "output-limit") {
        outputLimitExceeded = true;
        clearTimeout(timeoutHandle);
      } else {
        timedOut = true;
      }
      try {
        signalTree(child, "SIGTERM");
      } catch (error) {
        terminationSignalError = error.message;
      }
      forceKillHandle = setTimeout(() => {
        try {
          signalTree(child, "SIGKILL");
        } catch (error) {
          terminationSignalError ??= error.message;
        }
        stopOutputStreams();
        settle({
          code: terminationCloseResult?.code ?? null,
          signal: terminationCloseResult?.signal ?? "SIGKILL",
          spawnError: terminationCloseResult?.spawnError ?? null,
          timedOut,
          cleanupUnconfirmed: true,
          terminationReason,
          terminationSignalError,
          killAttempted: true,
        });
      }, terminationGraceMs);
    };
    const captureChunk = (chunks, chunk) => {
      if (!acceptingOutput) return null;
      const remaining = outputLimitBytes - stdoutBytes - stderrBytes;
      if (chunk.length <= remaining) {
        if (captureOutputBytes !== undefined) chunks.push(Buffer.from(chunk));
        return chunk;
      }
      const prefix = chunk.subarray(0, Math.max(remaining, 0));
      if (captureOutputBytes !== undefined && remaining > 0) {
        chunks.push(Buffer.from(prefix));
      }
      beginTermination("output-limit");
      return prefix;
    };
    if (options.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        beginTermination("timeout");
      }, options.timeoutMs);
      timeoutHandle.unref();
    }
    child.stdout.on("data", (chunk) => {
      if (!acceptingOutput) return;
      const observed = captureChunk(capturedStdout, chunk);
      if (observed === null || observed.length === 0) return;
      stdoutBytes += observed.length;
      stdoutHash.update(observed);
      const text = decodeScannerText("stdout", observed);
      if (!outputLimitExceeded) {
        scanDecodedOutput("stdout", text);
      }
      stdout = retainOutput(stdout + text);
      if (!options.quiet) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      if (!acceptingOutput) return;
      const observed = captureChunk(capturedStderr, chunk);
      if (observed === null || observed.length === 0) return;
      stderrBytes += observed.length;
      stderrHash.update(observed);
      const text = decodeScannerText("stderr", observed);
      if (!outputLimitExceeded) {
        scanDecodedOutput("stderr", text);
      }
      stderr = retainOutput(stderr + text);
      if (!options.quiet) process.stderr.write(text);
    });
    child.on("error", (error) => {
      stderr = retainOutput(`${stderr}\n${error.message}`);
      const failure = {
        code: null,
        signal: null,
        spawnError: error.message,
        timedOut,
        cleanupUnconfirmed: terminationStarted,
        terminationReason,
        terminationSignalError,
      };
      if (terminationStarted) terminationCloseResult = failure;
      else settle(failure);
    });
    child.on("close", (code, signal) => {
      const closed = {
        code,
        signal,
        spawnError: null,
        timedOut,
        cleanupUnconfirmed: terminationStarted,
        terminationReason,
        terminationSignalError,
      };
      if (terminationStarted) terminationCloseResult = closed;
      else settle(closed);
    });
  });
  for (const stream of ["stdout", "stderr"]) {
    const finalText = decodeScannerText(stream, new Uint8Array(), true);
    scanDecodedOutput(stream, finalText, true);
    if (stream === "stdout") stdout = retainOutput(stdout + finalText);
    else stderr = retainOutput(stderr + finalText);
    if (!options.quiet && finalText.length > 0) {
      if (stream === "stdout") process.stdout.write(finalText);
      else process.stderr.write(finalText);
    }
  }
  const cargoObservation = normalizeCargoTestObservation(
    cargoTestScan.summaries,
    cargoTestScan.summaries.length > 0 &&
      cargoTestScan.lastSummarySequence.stdout ===
        cargoTestScan.lastNonemptySequence.stdout,
    "stream",
  );

  const processResult = {
    display,
    code: result.code,
    signal: result.signal,
    spawnError: result.spawnError,
    timedOut: result.timedOut,
    cleanupUnconfirmed: result.cleanupUnconfirmed ?? false,
    terminationReason: result.terminationReason ?? null,
    terminationSignalError: result.terminationSignalError ?? null,
    killAttempted: result.killAttempted ?? false,
    outputLimitExceeded,
    outputLimitBytes,
    scanLimitExceeded,
    scanFailureReason,
    timeoutMs: options.timeoutMs ?? null,
    durationMs: Date.now() - started,
    observedPassedTests: cargoObservation.totals.passed,
    observedCargoTestSummary: cargoObservation,
    ...(cargoTestIdScan === null
      ? {}
      : { observedCargoTestIds: cargoTestIdScan.ids.sort() }),
    observedNodeTestSummary: normalizeNodeTestSummary(nodeTestScan),
    output: {
      stdoutBytes,
      stderrBytes,
      stdoutSha256: stdoutHash.digest("hex"),
      stderrSha256: stderrHash.digest("hex"),
    },
    ...(captureOutputBytes === undefined
      ? {}
      : {
          capturedOutput: {
            limitBytes: captureOutputBytes,
            stdout: Buffer.concat(capturedStdout),
            stderr: Buffer.concat(capturedStderr),
          },
        }),
    stdoutTail: stdout,
    stderrTail: stderr,
  };
  if (processResult.cleanupUnconfirmed) {
    const error = new Error(
      `process cleanup cannot be confirmed after ${processResult.terminationReason}`,
    );
    error.code = "PROCESS_CLEANUP_UNCONFIRMED";
    error.processResult = processResult;
    throw error;
  }
  return processResult;
}

export { countCargoPassedTests };

function cargoObservationFromTails(result) {
  const stdout = result.stdoutTail ?? "";
  const stderr = result.stderrTail ?? "";
  const summaries = [
    ...parseCargoTestSummaries(stdout).map((summary) => ({
      ...summary,
      stream: "stdout",
    })),
    ...parseCargoTestSummaries(stderr).map((summary) => ({
      ...summary,
      stream: "stderr",
    })),
  ];
  const nonemptyStdout = stdout
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);
  const terminalLine = nonemptyStdout.at(-1) ?? "";
  return normalizeCargoTestObservation(
    summaries,
    parseCargoTestSummaries(terminalLine).length === 1,
    "bounded-tail-compatibility",
  );
}

export { parseNodeTestSummary };

export function applyCommandSafeguards(result, policy) {
  if (policy.expectedNodeTests !== undefined) {
    const observed =
      result.observedNodeTestSummary ??
      parseNodeTestSummary(`${result.stdoutTail}\n${result.stderrTail}`);
    const expectedSuites = policy.expectedNodeSuites ?? 0;
    const passed =
      result.scanLimitExceeded !== true &&
      observed.duplicateOrMissing === false &&
      observed.terminal === true &&
      observed.summaryBlockCount === 1 &&
      observed.conserved === true &&
      Number.isFinite(observed.durationMs) &&
      observed.durationMs >= 0 &&
      observed.plan === policy.expectedNodeTests &&
      observed.tests === policy.expectedNodeTests &&
      observed.pass === policy.expectedNodeTests &&
      observed.suites === expectedSuites &&
      observed.fail === 0 &&
      observed.cancelled === 0 &&
      observed.skipped === 0 &&
      observed.todo === 0;
    return {
      ...result,
      testSafeguard: {
        format: "node-tap-v13",
        minimumPassedTests: policy.expectedNodeTests,
        expectedPassedTests: policy.expectedNodeTests,
        observedPassedTests: observed.pass,
        expectedSuites,
        observed,
        passed,
      },
    };
  }
  if (
    policy.minimumPassedTests === undefined &&
    policy.expectedPassedTests === undefined
  ) {
    return result;
  }
  const observedPassedTests = Number.isInteger(result.observedPassedTests)
    ? result.observedPassedTests
    : countCargoPassedTests(
        `${result.stdoutTail ?? ""}\n${result.stderrTail ?? ""}`,
      );
  const observed =
    result.observedCargoTestSummary ?? cargoObservationFromTails(result);
  const expectedSummaryCount = policy.expectedCargoSummaryCount ?? null;
  const minimumSatisfied =
    policy.minimumPassedTests === undefined ||
    observedPassedTests >= policy.minimumPassedTests;
  const exactSatisfied =
    policy.expectedPassedTests === undefined ||
    observedPassedTests === policy.expectedPassedTests;
  const summaryCountSatisfied =
    expectedSummaryCount === null
      ? observed.summaryCount > 0
      : observed.summaryCount === expectedSummaryCount;
  const inventoryConserved =
    policy.expectedPassedTests === undefined ||
    observed.outcomeCount === policy.expectedPassedTests;
  return {
    ...result,
    testSafeguard: {
      format: "cargo-libtest-v1",
      minimumPassedTests: policy.minimumPassedTests ?? null,
      expectedPassedTests: policy.expectedPassedTests ?? null,
      observedPassedTests,
      expectedSummaryCount,
      observedSummaryCount: observed.summaryCount,
      observed,
      passed:
        result.scanLimitExceeded !== true &&
        observed.countsSafe === true &&
        observed.allSuccessful === true &&
        observed.allOnStdout === true &&
        observed.terminal === true &&
        summaryCountSatisfied &&
        inventoryConserved &&
        observed.totals.passed === observedPassedTests &&
        minimumSatisfied &&
        exactSatisfied,
    },
  };
}

export function commandPassed(result) {
  return (
    result.code === 0 &&
    result.signal === null &&
    result.spawnError === null &&
    result.timedOut === false &&
    result.cleanupUnconfirmed !== true &&
    result.outputLimitExceeded !== true &&
    result.scanLimitExceeded !== true &&
    result.testSafeguard?.passed !== false
  );
}

export function validateCommand(id, program, args, policy) {
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof program !== "string" ||
    program.length === 0 ||
    !Array.isArray(args) ||
    args.some((argument) => typeof argument !== "string") ||
    !Number.isSafeInteger(policy.timeoutMs) ||
    policy.timeoutMs <= 0
  ) {
    throw new Error(`${id}: invalid command or timeout`);
  }
  if (
    policy.requireCompleteOutputReplay !== undefined &&
    typeof policy.requireCompleteOutputReplay !== "boolean"
  ) {
    throw new Error(`${id}: invalid complete-output replay policy`);
  }
  if (policy.expectedNodeTests !== undefined) {
    if (
      program !== "node" ||
      !args.includes("--test") ||
      !args.includes("--test-reporter=tap") ||
      !Number.isInteger(policy.expectedNodeTests) ||
      policy.expectedNodeTests <= 0 ||
      !Number.isInteger(policy.expectedNodeSuites ?? 0) ||
      (policy.expectedNodeSuites ?? 0) < 0
    ) {
      throw new Error(`${id}: invalid exact Node test safeguard`);
    }
  }
  if (program !== "cargo") return;
  if (!args.includes("--locked")) {
    throw new Error(`${id}: every Cargo oracle must use --locked`);
  }
  if (
    !Number.isInteger(policy.minimumPassedTests) ||
    policy.minimumPassedTests <= 0
  ) {
    throw new Error(`${id}: every Cargo oracle needs a nonzero test minimum`);
  }
  if (
    policy.expectedPassedTests !== undefined &&
    (!Number.isInteger(policy.expectedPassedTests) ||
      policy.expectedPassedTests < policy.minimumPassedTests)
  ) {
    throw new Error(`${id}: invalid exact test safeguard`);
  }
  if (
    policy.expectedCargoSummaryCount !== undefined &&
    (!Number.isSafeInteger(policy.expectedCargoSummaryCount) ||
      policy.expectedCargoSummaryCount < 1 ||
      policy.expectedCargoSummaryCount > MAX_CARGO_SUMMARIES)
  ) {
    throw new Error(`${id}: invalid Cargo summary-count safeguard`);
  }
  if (policy.expectedTestIds !== undefined) {
    if (
      !Array.isArray(policy.expectedTestIds) ||
      policy.expectedTestIds.some(
        (testId) => typeof testId !== "string" || testId.length === 0,
      ) ||
      new Set(policy.expectedTestIds).size !== policy.expectedTestIds.length ||
      policy.expectedTestIds.length !== policy.expectedPassedTests
    ) {
      throw new Error(`${id}: invalid reviewed Cargo test inventory`);
    }
  }
  if (policy.requiredTestIds !== undefined) {
    if (
      policy.expectedTestIds !== undefined ||
      !Array.isArray(policy.requiredTestIds) ||
      policy.requiredTestIds.length === 0 ||
      policy.requiredTestIds.some(
        (testId) => typeof testId !== "string" || testId.length === 0,
      ) ||
      new Set(policy.requiredTestIds).size !== policy.requiredTestIds.length ||
      policy.requiredTestIds.length > policy.expectedPassedTests
    ) {
      throw new Error(`${id}: invalid required Cargo test sentinels`);
    }
  }
}
