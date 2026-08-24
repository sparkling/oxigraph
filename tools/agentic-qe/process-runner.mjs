import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { scrubbedChildEnvironment } from "../child-environment.mjs";
import { repoRoot } from "./path-policy.mjs";

const cargoTestSummary =
  /^test result: (?:ok|FAILED)\. (\d+) passed; \d+ failed; \d+ ignored; \d+ measured; \d+ filtered out; finished in (?:\d+(?:\.\d+)?|\.\d+)s$/;
const nodeTestPlan = /^1\.\.(\d+)$/;
const nodeTestSummary = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/;
const nodeTestDuration = /^# duration_ms (\d+(?:\.\d+)?)$/;
const nodeSummaryFields = [
  "tests",
  "suites",
  "pass",
  "fail",
  "cancelled",
  "skipped",
  "todo",
];

function tail(value, max = 65536) {
  return value.length <= max ? value : value.slice(value.length - max);
}

function quoteForDisplay(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value)
    ? value
    : JSON.stringify(value);
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
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  const stdoutHash = createHash("sha256");
  const stderrHash = createHash("sha256");
  const cargoTestScan = {
    stdout: "",
    stderr: "",
    passed: 0,
  };
  const cargoTestIdScan = options.captureCargoTestIds
    ? {
        stdout: "",
        stderr: "",
        ids: [],
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

  const scanCargoTestOutput = (stream, text, flush = false) => {
    cargoTestScan[stream] += text;
    const lines = cargoTestScan[stream].split(/\r?\n/);
    if (!flush) cargoTestScan[stream] = lines.pop() ?? "";
    for (const line of lines) {
      const match = cargoTestSummary.exec(line);
      if (match) cargoTestScan.passed += Number.parseInt(match[1], 10);
    }
    if (flush) cargoTestScan[stream] = "";
  };
  const scanCargoTestIds = (stream, text, flush = false) => {
    if (cargoTestIdScan === null) return;
    cargoTestIdScan[stream] += text;
    const lines = cargoTestIdScan[stream].split(/\r?\n/);
    if (!flush) cargoTestIdScan[stream] = lines.pop() ?? "";
    for (const line of lines) {
      const match = /^(\S(?:.*\S)?): test$/.exec(line);
      if (match) cargoTestIdScan.ids.push(match[1]);
    }
    if (flush) cargoTestIdScan[stream] = "";
  };
  const scanNodeTestOutput = (text, flush = false) => {
    nodeTestScan.stdout += text;
    const lines = nodeTestScan.stdout.split(/\r?\n/);
    if (!flush) nodeTestScan.stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        nodeTestScan.lastNonemptyLines.push(line);
        if (nodeTestScan.lastNonemptyLines.length > 9) {
          nodeTestScan.lastNonemptyLines.shift();
        }
      }
      const plan = nodeTestPlan.exec(line);
      if (plan) {
        nodeTestScan.plans.push(Number.parseInt(plan[1], 10));
        continue;
      }
      const summary = nodeTestSummary.exec(line);
      if (summary) {
        nodeTestScan.values[summary[1]].push(
          Number.parseInt(summary[2], 10),
        );
        continue;
      }
      const duration = nodeTestDuration.exec(line);
      if (duration) nodeTestScan.durations.push(Number.parseFloat(duration[1]));
    }
    if (flush) nodeTestScan.stdout = "";
  };

  const result = await new Promise((resolvePromise) => {
    let settled = false;
    let timedOut = false;
    let timeoutHandle;
    let forceKillHandle;
    const child = spawn(program, args, {
      cwd: options.cwd ?? repoRoot,
      env: scrubbedChildEnvironment(options.env),
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(forceKillHandle);
      resolvePromise(value);
    };
    if (options.timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        signalTree(child, "SIGTERM");
        forceKillHandle = setTimeout(() => signalTree(child, "SIGKILL"), 5_000);
        forceKillHandle.unref();
      }, options.timeoutMs);
      timeoutHandle.unref();
    }
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      stdoutHash.update(chunk);
      const text = chunk.toString();
      scanCargoTestOutput("stdout", text);
      scanCargoTestIds("stdout", text);
      scanNodeTestOutput(text);
      stdout = tail(stdout + text);
      if (!options.quiet) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      stderrHash.update(chunk);
      const text = chunk.toString();
      scanCargoTestOutput("stderr", text);
      scanCargoTestIds("stderr", text);
      stderr = tail(stderr + text);
      if (!options.quiet) process.stderr.write(text);
    });
    child.on("error", (error) => {
      stderr = tail(`${stderr}\n${error.message}`);
      settle({
        code: null,
        signal: null,
        spawnError: error.message,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      if (timedOut) signalTree(child, "SIGKILL");
      settle({ code, signal, spawnError: null, timedOut });
    });
  });
  scanCargoTestOutput("stdout", "", true);
  scanCargoTestOutput("stderr", "", true);
  scanCargoTestIds("stdout", "", true);
  scanCargoTestIds("stderr", "", true);
  scanNodeTestOutput("", true);

  return {
    display,
    code: result.code,
    signal: result.signal,
    spawnError: result.spawnError,
    timedOut: result.timedOut,
    timeoutMs: options.timeoutMs ?? null,
    durationMs: Date.now() - started,
    observedPassedTests: cargoTestScan.passed,
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
    stdoutTail: stdout,
    stderrTail: stderr,
  };
}

function cargoPassedTests(output) {
  let passed = 0;
  for (const line of output.split(/\r?\n/)) {
    const match = cargoTestSummary.exec(line);
    if (match) passed += Number.parseInt(match[1], 10);
  }
  return passed;
}

export function countCargoPassedTests(output) {
  return cargoPassedTests(output);
}

function normalizeNodeTestSummary(scan) {
  const value = (values) => values.length === 1 ? values[0] : null;
  const result = {
    plan: value(scan.plans),
    durationMs: value(scan.durations),
    duplicateOrMissing:
      scan.plans.length !== 1 || scan.durations.length !== 1,
  };
  for (const field of nodeSummaryFields) {
    result[field] = value(scan.values[field]);
    if (scan.values[field].length !== 1) result.duplicateOrMissing = true;
  }
  const terminal = scan.lastNonemptyLines ?? [];
  const expectedTerminal = [
    `1..${result.plan}`,
    `# tests ${result.tests}`,
    `# suites ${result.suites}`,
    `# pass ${result.pass}`,
    `# fail ${result.fail}`,
    `# cancelled ${result.cancelled}`,
    `# skipped ${result.skipped}`,
    `# todo ${result.todo}`,
    `# duration_ms ${result.durationMs}`,
  ];
  result.terminal =
    terminal.length === expectedTerminal.length &&
    terminal.every((line, index) => line === expectedTerminal[index]);
  result.summaryBlockCount =
    result.terminal && !result.duplicateOrMissing ? 1 : 0;
  result.conserved =
    result.tests ===
    result.pass +
      result.fail +
      result.cancelled +
      result.skipped +
      result.todo;
  return result;
}

export function parseNodeTestSummary(output) {
  const scan = {
    plans: [],
    durations: [],
    lastNonemptyLines: [],
    values: Object.fromEntries(nodeSummaryFields.map((field) => [field, []])),
  };
  for (const line of output.split(/\r?\n/)) {
    if (line.length > 0) {
      scan.lastNonemptyLines.push(line);
      if (scan.lastNonemptyLines.length > 9) {
        scan.lastNonemptyLines.shift();
      }
    }
    const plan = nodeTestPlan.exec(line);
    if (plan) {
      scan.plans.push(Number.parseInt(plan[1], 10));
      continue;
    }
    const summary = nodeTestSummary.exec(line);
    if (summary) {
      scan.values[summary[1]].push(Number.parseInt(summary[2], 10));
      continue;
    }
    const duration = nodeTestDuration.exec(line);
    if (duration) scan.durations.push(Number.parseFloat(duration[1]));
  }
  return normalizeNodeTestSummary(scan);
}

export function applyCommandSafeguards(result, policy) {
  if (policy.expectedNodeTests !== undefined) {
    const observed =
      result.observedNodeTestSummary ??
      parseNodeTestSummary(`${result.stdoutTail}\n${result.stderrTail}`);
    const expectedSuites = policy.expectedNodeSuites ?? 0;
    const passed =
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
    : cargoPassedTests(`${result.stdoutTail}\n${result.stderrTail}`);
  const minimumSatisfied =
    policy.minimumPassedTests === undefined ||
    observedPassedTests >= policy.minimumPassedTests;
  const exactSatisfied =
    policy.expectedPassedTests === undefined ||
    observedPassedTests === policy.expectedPassedTests;
  return {
    ...result,
    testSafeguard: {
      minimumPassedTests: policy.minimumPassedTests ?? null,
      expectedPassedTests: policy.expectedPassedTests ?? null,
      observedPassedTests,
      passed: minimumSatisfied && exactSatisfied,
    },
  };
}

export function commandPassed(result) {
  return (
    result.code === 0 &&
    result.timedOut === false &&
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
