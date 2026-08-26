#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { scrubbedChildEnvironment } from "../child-environment.mjs";
import {
  buildExpandedProgrammeReceipt,
  createRepositoryManifest,
  expandedProgrammeImplementationPaths,
  loadExpandedProgrammePolicy,
  observeProtectedRufloSnapshot,
  observeRufloState,
  publishExpandedProgrammeReceipt,
  readProtectedRufloSnapshot,
  readExpandedProgrammeGitSubject,
  resolveReviewedExecutable,
  validateExpandedProgramme,
} from "./expanded-programme-qa.mjs";

const nodeSummaryFields = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];

function parseTap(stdout) {
  const values = Object.fromEntries(nodeSummaryFields.map((field) => [field, []]));
  const plans = [];
  const durations = [];
  const lines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
  for (const line of lines) {
    const plan = /^1\.\.(\d+)$/u.exec(line);
    if (plan) plans.push(Number.parseInt(plan[1], 10));
    const summary = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/u.exec(line);
    if (summary) values[summary[1]].push(Number.parseInt(summary[2], 10));
    const duration = /^# duration_ms (\d+(?:\.\d+)?)$/u.exec(line);
    if (duration) durations.push(Number.parseFloat(duration[1]));
  }
  const one = (items) => items.length === 1 ? items[0] : null;
  const observed = {
    plan: one(plans),
    ...Object.fromEntries(nodeSummaryFields.map((field) => [field, one(values[field])])),
    summaryBlockCount: plans.length === 1 && durations.length === 1 && nodeSummaryFields.every((field) => values[field].length === 1) ? 1 : 0,
    terminal: false,
    conserved: false,
    durationPresent: durations.length === 1 && Number.isFinite(durations[0]) && durations[0] >= 0,
  };
  const terminal = lines.slice(-9);
  observed.terminal =
    terminal.length === 9 &&
    terminal[0] === `1..${observed.plan}` &&
    nodeSummaryFields.every((field, index) => terminal[index + 1] === `# ${field} ${observed[field]}`) &&
    /^# duration_ms \d+(?:\.\d+)?$/u.test(terminal[8]);
  observed.conserved =
    Number.isInteger(observed.tests) &&
    observed.tests === observed.pass + observed.fail + observed.cancelled + observed.skipped + observed.todo;
  return observed;
}

function nodeExpectation(command) {
  return {
    plan: command.expectedNodeTests,
    tests: command.expectedNodeTests,
    suites: 0,
    pass: command.expectedNodeTests,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    summaryBlockCount: 1,
    terminal: true,
    conserved: true,
    durationPresent: true,
  };
}

export function runBoundedQuickCommand(root, command) {
  const argv = [command.program, ...command.args];
  const expected = command.expectedNodeTests === undefined
    ? { exitCode: 0, signal: null }
    : nodeExpectation(command);
  let executable;
  try {
    executable = resolveReviewedExecutable(root, command.program);
  } catch {
    return {
      id: command.id,
      argv,
      executableSha256: null,
      expected,
      observed: null,
      disposition: "INCONCLUSIVE",
      failureClass: "SPAWN_ERROR",
    };
  }
  const base = { id: command.id, argv, executableSha256: executable.sha256, expected };
  const result = spawnSync(executable.invocation, command.args, {
    cwd: root,
    encoding: "utf8",
    timeout: command.timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    env: scrubbedChildEnvironment(),
    shell: false,
  });
  if (result.error) {
    return {
      ...base,
      observed: null,
      disposition: "INCONCLUSIVE",
      failureClass: result.error.code === "ETIMEDOUT" ? "TIMEOUT" : "SPAWN_ERROR",
    };
  }
  if (result.signal || result.status === null) {
    return {
      ...base,
      observed: { exitCode: result.status, signal: result.signal },
      disposition: "INCONCLUSIVE",
      failureClass: "PROCESS_SIGNAL",
    };
  }
  let executableChanged = false;
  try {
    executableChanged = resolveReviewedExecutable(root, command.program).sha256 !== executable.sha256;
  } catch {
    executableChanged = true;
  }
  if (executableChanged) {
    return {
      ...base,
      observed: { exitCode: result.status, signal: null },
      disposition: "INCONCLUSIVE",
      failureClass: "EXECUTABLE_CHANGED",
    };
  }
  if (command.expectedNodeTests !== undefined) {
    const observed = parseTap(result.stdout);
    const diagnostics = `${result.stdout}\n${result.stderr}`;
    const dependencyUnavailable =
      /ERR_MODULE_NOT_FOUND|Cannot find package|ENOENT[^\n]*node_modules/iu.test(
        diagnostics,
      );
    if (result.status !== 0 && dependencyUnavailable) {
      return {
        ...base,
        observed,
        disposition: "INCONCLUSIVE",
        failureClass: "DEPENDENCY_UNAVAILABLE",
      };
    }
    const passed =
      result.status === 0 &&
      Object.entries(expected).every(([key, value]) => observed[key] === value);
    return {
      ...base,
      observed,
      disposition: passed ? "PASS" : "FAIL",
      failureClass: passed
        ? null
        : result.status === 0
          ? "TEST_INVENTORY_MISMATCH"
          : "EXIT_NONZERO",
    };
  }
  const observed = { exitCode: result.status, signal: null };
  return {
    ...base,
    observed,
    disposition: result.status === 0 ? "PASS" : "FAIL",
    failureClass: result.status === 0 ? null : "EXIT_NONZERO",
  };
}

function ensureGeneratedTargetRoot(root) {
  const target = join(root, "target");
  if (existsSync(target)) {
    const metadata = lstatSync(target);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("repository target root is unsafe");
    }
    return;
  }
  mkdirSync(target, { mode: 0o700 });
}

export function runBoundedQuickCommands(root, policy) {
  const results = [];
  for (let index = 0; index < policy.quickCommands.length; index += 1) {
    const command = policy.quickCommands[index];
    const result = runBoundedQuickCommand(root, command);
    results.push(result);
    if (result.disposition !== "PASS") {
      for (const skipped of policy.quickCommands.slice(index + 1)) {
        results.push({
          id: skipped.id,
          argv: [skipped.program, ...skipped.args],
          executableSha256: null,
          expected: skipped.expectedNodeTests === undefined
            ? { exitCode: 0, signal: null }
            : nodeExpectation(skipped),
          observed: null,
          disposition: "INCONCLUSIVE",
          failureClass: "NOT_RUN_AFTER_FAILURE",
        });
      }
      break;
    }
  }
  return results;
}

export function collectRufloObservation(root, policy, snapshotPath = null) {
  if (snapshotPath === null) {
    return observeRufloState({ policy, taskStore: null, memoryMaps: null });
  }
  const { snapshot, binding } = readProtectedRufloSnapshot(root, snapshotPath);
  return observeProtectedRufloSnapshot({ policy, snapshot, binding });
}

function parseArguments(args) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  let rufloSnapshot = null;
  let withoutRuflo = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--root" && args[index + 1]) {
      root = resolve(args[++index]);
    } else if (args[index] === "--ruflo-snapshot" && args[index + 1]) {
      rufloSnapshot = args[++index];
    } else if (args[index] === "--without-ruflo") {
      withoutRuflo = true;
    } else {
      throw new Error(`unknown or incomplete argument: ${args[index]}`);
    }
  }
  if (withoutRuflo && rufloSnapshot !== null) {
    throw new Error("--without-ruflo and --ruflo-snapshot are mutually exclusive");
  }
  return { root: realpathSync(root), rufloSnapshot };
}

function runIndependentVerifier(root, receiptPath, rufloSnapshot) {
  const verifier = join(root, "tools", "evidence", "verify-expanded-programme-qa.mjs");
  const args = [verifier, "--root", root, "--receipt", receiptPath];
  if (rufloSnapshot !== null) args.push("--ruflo-snapshot", rufloSnapshot);
  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: scrubbedChildEnvironment(),
      shell: false,
    },
  );
  if (result.error || result.signal || ![0, 1, 2].includes(result.status)) {
    throw new Error("independent verifier did not complete normally");
  }
  let verification;
  try {
    verification = JSON.parse(result.stdout);
  } catch {
    throw new Error("independent verifier returned invalid JSON");
  }
  if (!verification.ok) throw new Error("independent verifier rejected the receipt");
  return verification;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const policy = loadExpandedProgrammePolicy(options.root);
  const subject = readExpandedProgrammeGitSubject(options.root);
  const source = validateExpandedProgramme(options.root, { policy, subject });
  ensureGeneratedTargetRoot(options.root);
  const commands = source.ok ? runBoundedQuickCommands(options.root, policy) : [];
  const rufloObservation = collectRufloObservation(
    options.root,
    policy,
    options.rufloSnapshot,
  );
  const implementation = createRepositoryManifest(
    options.root,
    expandedProgrammeImplementationPaths,
  );
  const receipt = buildExpandedProgrammeReceipt({
    policy,
    source,
    commands,
    rufloObservation,
    implementation,
  });
  const publication = publishExpandedProgrammeReceipt(options.root, receipt);
  const verification = runIndependentVerifier(
    options.root,
    publication.path,
    options.rufloSnapshot,
  );
  const result = {
    verdict: receipt.verdict,
    score: receipt.score,
    commit: receipt.subject.commit,
    tree: receipt.subject.tree,
    receiptPath: relative(options.root, publication.path).split(sep).join("/"),
    receiptSha256: publication.sha256,
    independentlyVerified: verification.ok,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (receipt.verdict === "FAIL") process.exitCode = 1;
  else if (receipt.verdict === "INCONCLUSIVE") process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
