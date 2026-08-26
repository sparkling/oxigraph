#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
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
const bubblewrapExecutable = "/usr/bin/bwrap";
const maximumCommandOutputBytes = 8 * 1024 * 1024;
const protectedWorkspaceEntries = new Set([
  ".agentic-qe",
  ".claude",
  ".claude-flow",
  ".env",
  ".git-credentials",
  ".htpasswd",
  ".netrc",
  ".npmrc",
  ".swarm",
  "target",
  "var",
]);

function sandboxEvidence(executableSha256 = null) {
  return {
    executableSha256,
    network: "isolated",
    processTree: "pid-namespace",
    workspace: "read-only",
    target: "ephemeral",
  };
}

function signalProcessTree(child, signal) {
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

function runCapturedProcess(program, args, {
  cwd,
  env,
  timeoutMs,
  maxOutputBytes = maximumCommandOutputBytes,
}) {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let terminationReason = null;
    let settled = false;
    let timeoutHandle;
    let forceKillHandle;
    let spawnError = null;
    const child = spawn(program, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const terminate = (reason) => {
      if (terminationReason !== null) return;
      terminationReason = reason;
      signalProcessTree(child, "SIGTERM");
      forceKillHandle = setTimeout(() => {
        signalProcessTree(child, "SIGKILL");
      }, 500);
      forceKillHandle.unref();
    };
    const collect = (stream, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes <= maxOutputBytes) {
        if (stream === "stdout") stdout += chunk.toString();
        else stderr += chunk.toString();
      }
      if (outputBytes > maxOutputBytes) terminate("OUTPUT_LIMIT");
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    timeoutHandle = setTimeout(() => terminate("TIMEOUT"), timeoutMs);
    timeoutHandle.unref();
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(forceKillHandle);
      resolvePromise({
        status,
        signal,
        stdout,
        stderr,
        error: spawnError,
        terminationReason,
      });
    });
  });
}

function bindReadOnlyIfPresent(args, source, destination) {
  try {
    accessSync(source, constants.R_OK);
    args.push("--ro-bind", realpathSync(source), destination);
  } catch {
    // Optional host path.
  }
}

function worktreeCommonGitDirectory(root) {
  const dotGit = join(root, ".git");
  const metadata = lstatSync(dotGit);
  if (metadata.isDirectory()) return null;
  if (!metadata.isFile()) {
    throw new Error("repository .git entry is not a regular file or directory");
  }
  const match = /^gitdir: ([^\0\r\n]+)\n?$/u.exec(readFileSync(dotGit, "utf8"));
  if (!match) throw new Error("repository worktree Git pointer is malformed");
  const gitDirectory = realpathSync(resolve(root, match[1]));
  const commonPointer = join(gitDirectory, "commondir");
  if (!lstatSync(commonPointer).isFile()) {
    throw new Error("repository worktree common Git pointer is missing");
  }
  const common = readFileSync(commonPointer, "utf8").trim();
  if (!common || common.includes("\0") || common.includes("\n")) {
    throw new Error("repository worktree common Git pointer is malformed");
  }
  return realpathSync(resolve(gitDirectory, common));
}

function trackedTopLevelEntries(root) {
  const executable = resolveReviewedExecutable(root, "git");
  const result = spawnSync(executable.invocation, [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "ls-files",
    "-z",
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    env: scrubbedChildEnvironment({
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    }),
    shell: false,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error("failed to resolve the tracked sandbox workspace");
  }
  return new Set(
    result.stdout
      .split("\0")
      .filter(Boolean)
      .map((path) => path.split("/", 1)[0]),
  );
}

function appendCandidateWorkspace(args, root) {
  const tracked = trackedTopLevelEntries(root);
  const entries = readdirSync(root)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  args.push(
    "--size",
    String(16 * 1024 * 1024),
    "--tmpfs",
    "/workspace",
  );
  for (const entry of entries) {
    if (
      protectedWorkspaceEntries.has(entry) ||
      /\.rvf(?:\.|$)/u.test(entry) ||
      /^ruvector\.db(?:\.|$)/u.test(entry)
    ) {
      continue;
    }
    if (entry !== ".git" && !tracked.has(entry)) continue;
    const hostPath = join(root, entry);
    const destination = join("/workspace", entry);
    const metadata = lstatSync(hostPath);
    if (metadata.isSymbolicLink()) {
      args.push("--symlink", readlinkSync(hostPath), destination);
    } else if (metadata.isFile() || metadata.isDirectory()) {
      args.push(
        "--ro-bind",
        hostPath,
        destination,
      );
    } else {
      throw new Error(`unsupported repository root entry: ${entry}`);
    }
  }
  args.push(
    "--dir",
    "/workspace/target",
    "--size",
    String(512 * 1024 * 1024),
    "--tmpfs",
    "/workspace/target",
    "--remount-ro",
    "/workspace",
  );
}

function commandSandbox(root, command, sandbox) {
  if (process.platform !== "linux") {
    throw new Error("programme QA command sandbox requires Linux namespaces");
  }
  const nodeRuntime = realpathSync(join(dirname(realpathSync(process.execPath)), ".."));
  const home = userInfo().homedir;
  const cargoHome = existsSync("/cargo/bin") ? "/cargo" : join(home, ".cargo");
  const rustupHome = existsSync("/rustup") ? "/rustup" : join(home, ".rustup");
  const commonGitDirectory = worktreeCommonGitDirectory(root);
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-net",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--cap-drop",
    "ALL",
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
  bindReadOnlyIfPresent(args, "/lib64", "/lib64");
  bindReadOnlyIfPresent(args, "/etc", "/etc");
  args.push(
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--remount-ro",
    "/dev",
    "--size",
    String(512 * 1024 * 1024),
    "--tmpfs",
    "/tmp",
    "--size",
    String(16 * 1024 * 1024),
    "--tmpfs",
    "/home",
    "--dir",
    "/home/sandbox",
    "--dir",
    "/cargo",
    "--ro-bind",
    nodeRuntime,
    "/node",
  );
  bindReadOnlyIfPresent(args, join(cargoHome, "bin"), "/cargo/bin");
  bindReadOnlyIfPresent(args, join(cargoHome, "registry"), "/cargo/registry");
  bindReadOnlyIfPresent(args, join(cargoHome, "git"), "/cargo/git");
  bindReadOnlyIfPresent(
    args,
    join(cargoHome, ".global-cache"),
    "/cargo/.global-cache",
  );
  bindReadOnlyIfPresent(args, rustupHome, "/rustup");
  if (commonGitDirectory !== null) {
    args.push(
      "--ro-bind",
      commonGitDirectory,
      commonGitDirectory,
    );
  }
  appendCandidateWorkspace(args, root);
  args.push(
    "--chdir",
    "/workspace",
    "--setenv",
    "CARGO_HOME",
    "/cargo",
    "--setenv",
    "CARGO_NET_OFFLINE",
    "true",
    "--setenv",
    "CI",
    "1",
    "--setenv",
    "GIT_CONFIG_GLOBAL",
    "/dev/null",
    "--setenv",
    "GIT_CONFIG_SYSTEM",
    "/dev/null",
    "--setenv",
    "HOME",
    "/home/sandbox",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "LC_ALL",
    "C.UTF-8",
    "--setenv",
    "NO_COLOR",
    "1",
    "--setenv",
    "PATH",
    "/node/bin:/cargo/bin:/usr/bin:/bin",
    "--setenv",
    "RUSTUP_HOME",
    "/rustup",
    "--setenv",
    "SOURCE_DATE_EPOCH",
    "946684800",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "USER",
    "sandbox",
    "--",
    command.program === "cargo" ? "/cargo/bin/cargo" : "/node/bin/node",
    ...command.args,
  );
  return {
    program: sandbox.invocation,
    args,
  };
}

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

export function unexecutedQuickCommands(policy, failureClass) {
  return policy.quickCommands.map((command) => ({
    id: command.id,
    argv: [command.program, ...command.args],
    executableSha256: null,
    sandbox: sandboxEvidence(null),
    expected: command.expectedNodeTests === undefined
      ? { exitCode: 0, signal: null }
      : nodeExpectation(command),
    observed: null,
    disposition: "INCONCLUSIVE",
    failureClass,
  }));
}

export async function runBoundedQuickCommand(rootInput, command) {
  const root = realpathSync(rootInput);
  const argv = [command.program, ...command.args];
  const expected = command.expectedNodeTests === undefined
    ? { exitCode: 0, signal: null }
    : nodeExpectation(command);
  let executable;
  let sandbox;
  try {
    executable = resolveReviewedExecutable(root, command.program);
    sandbox = resolveReviewedExecutable(root, bubblewrapExecutable);
  } catch {
    return {
      id: command.id,
      argv,
      executableSha256: null,
      sandbox: sandboxEvidence(null),
      expected,
      observed: null,
      disposition: "INCONCLUSIVE",
      failureClass: "SANDBOX_UNAVAILABLE",
    };
  }
  const base = {
    id: command.id,
    argv,
    executableSha256: executable.sha256,
    sandbox: sandboxEvidence(sandbox.sha256),
    expected,
  };
  let result;
  try {
    const invocation = commandSandbox(root, command, sandbox);
    result = await runCapturedProcess(invocation.program, invocation.args, {
      cwd: tmpdir(),
      env: scrubbedChildEnvironment({
        HOME: "/nonexistent",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin",
        TMPDIR: tmpdir(),
      }),
      timeoutMs: command.timeoutMs,
    });
  } catch (error) {
    result = {
      status: null,
      signal: null,
      stdout: "",
      stderr: "",
      error,
      terminationReason: null,
    };
  }
  if (result.terminationReason !== null) {
    return {
      ...base,
      observed: null,
      disposition: "INCONCLUSIVE",
      failureClass: result.terminationReason,
    };
  }
  if (result.error) {
    return {
      ...base,
      observed: null,
      disposition: "INCONCLUSIVE",
      failureClass: "SPAWN_ERROR",
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
    executableChanged =
      resolveReviewedExecutable(root, command.program).sha256 !== executable.sha256 ||
      resolveReviewedExecutable(root, bubblewrapExecutable).sha256 !== sandbox.sha256;
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

export async function runBoundedQuickCommands(root, policy) {
  const results = [];
  for (let index = 0; index < policy.quickCommands.length; index += 1) {
    const command = policy.quickCommands[index];
    const result = await runBoundedQuickCommand(root, command);
    results.push(result);
    if (result.disposition !== "PASS") {
      for (const skipped of policy.quickCommands.slice(index + 1)) {
        results.push({
          id: skipped.id,
          argv: [skipped.program, ...skipped.args],
          executableSha256: null,
          sandbox: sandboxEvidence(null),
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

async function runIndependentVerifier(
  root,
  receiptPath,
  rufloSnapshot,
  expectedReceipt,
  expectedReceiptSha256,
) {
  const verifier = join(root, "tools", "evidence", "verify-expanded-programme-qa.mjs");
  const args = [verifier, "--root", root, "--receipt", receiptPath];
  if (rufloSnapshot !== null) args.push("--ruflo-snapshot", rufloSnapshot);
  const result = await runCapturedProcess(
    process.execPath,
    args,
    {
      cwd: root,
      env: scrubbedChildEnvironment(),
      timeoutMs: 10 * 60_000,
      maxOutputBytes: 4 * 1024 * 1024,
    },
  );
  const expectedStatus = expectedReceipt.verdict === "PASS"
    ? 0
    : expectedReceipt.verdict === "INCONCLUSIVE"
      ? 2
      : 1;
  if (
    result.error ||
    result.terminationReason !== null ||
    result.signal ||
    result.status !== expectedStatus ||
    result.stderr !== ""
  ) {
    throw new Error("independent verifier did not complete normally");
  }
  let verification;
  try {
    verification = JSON.parse(result.stdout);
  } catch {
    throw new Error("independent verifier returned invalid JSON");
  }
  if (result.stdout !== `${JSON.stringify(verification)}\n`) {
    throw new Error("independent verifier returned non-canonical output");
  }
  if (
    verification.ok !== true ||
    !Array.isArray(verification.errors) ||
    verification.errors.length !== 0 ||
    verification.verdict !== expectedReceipt.verdict ||
    verification.receiptSha256 !== expectedReceiptSha256 ||
    verification.commit !== expectedReceipt.subject.commit ||
    verification.tree !== expectedReceipt.subject.tree ||
    JSON.stringify(verification.score) !== JSON.stringify(expectedReceipt.score)
  ) {
    throw new Error("independent verifier rejected or misbound the receipt");
  }
  return verification;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const policy = loadExpandedProgrammePolicy(options.root);
  const subject = readExpandedProgrammeGitSubject(options.root);
  const source = validateExpandedProgramme(options.root, { policy, subject });
  const commands = source.ok
    ? await runBoundedQuickCommands(options.root, policy)
    : unexecutedQuickCommands(policy, "NOT_RUN_AFTER_SOURCE_FAILURE");
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
  const verification = await runIndependentVerifier(
    options.root,
    publication.path,
    options.rufloSnapshot,
    receipt,
    publication.sha256,
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
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
