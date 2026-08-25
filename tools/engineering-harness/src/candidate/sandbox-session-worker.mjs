import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  statfsSync,
  statSync,
  truncateSync,
  writeSync,
  fsyncSync,
} from "node:fs";
import { basename, join } from "node:path";
import { performance } from "node:perf_hooks";

const resultPath = "/result/session.json";
const workspace = "/workspace";
const targetRoot = "/state/target";
const commandOrder = Object.freeze([
  "format",
  "build",
  "public",
  "independent",
  "regression",
]);
const cargoExecutable = "/state/cargo/bin/cargo";
const mountExecutable = "/usr/bin/mount";
const pythonExecutable = "/usr/bin/python3";
const seccompLauncher = "/runner/seccomp-launcher.py";
const setprivExecutable = "/usr/bin/setpriv";
const maxConfigurationBytes = 1_048_576;
const resultReserveMs = 750;
const stateAnchorDefinitions = Object.freeze([
  Object.freeze({ name: "home", path: "/state/home" }),
  Object.freeze({ name: "temp", path: "/state/tmp" }),
  Object.freeze({ name: "target", path: "/state/target" }),
]);

class StateInvariantError extends Error {
  constructor(anchor, phase) {
    super(`verifier state anchor ${phase}: ${anchor}`);
    this.name = "StateInvariantError";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readConfiguration() {
  const chunks = [];
  let bytes = 0;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  for (;;) {
    const count = readSync(0, buffer, 0, buffer.length, null);
    if (count === 0) break;
    bytes += count;
    if (bytes > maxConfigurationBytes) {
      throw new Error("session configuration exceeds its byte ceiling");
    }
    chunks.push(Buffer.from(buffer.subarray(0, count)));
  }
  const source = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(source);
}

function validateConfiguration(value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.commands)) {
    throw new Error("invalid verifier-session configuration");
  }
  if (
    !Number.isInteger(value.totalTimeoutMs) ||
    value.totalTimeoutMs < 1_000 ||
    value.totalTimeoutMs > 7_200_000
  ) {
    throw new Error("invalid total verifier timeout");
  }
  if (
    !Number.isInteger(value.maxResultBytes) ||
    value.maxResultBytes < 65_536 ||
    value.maxResultBytes > 268_435_456
  ) {
    throw new Error("invalid verifier result ceiling");
  }
  if (
    !Number.isInteger(value.cargoBuildJobs) ||
    value.cargoBuildJobs < 1 ||
    value.cargoBuildJobs > 16
  ) {
    throw new Error("invalid Cargo build-job ceiling");
  }
  if (value.commands.length !== commandOrder.length) {
    throw new Error("verifier session requires the five frozen command roles");
  }
  const commands = value.commands.map((command, index) => {
    if (command?.name !== commandOrder[index]) {
      throw new Error("verifier commands are not in frozen order");
    }
    if (
      !Array.isArray(command.argv) ||
      command.argv.length < 2 ||
      command.argv[0] !== "cargo" ||
      command.argv.some(
        (argument) =>
          typeof argument !== "string" ||
          argument.length === 0 ||
          argument.includes("\0"),
      )
    ) {
      throw new Error(`invalid literal Cargo argv for ${command.name}`);
    }
    if (
      !Number.isInteger(command.timeoutMs) ||
      command.timeoutMs < 1_000 ||
      command.timeoutMs > value.totalTimeoutMs
    ) {
      throw new Error(`invalid timeout for ${command.name}`);
    }
    if (
      !Number.isInteger(command.maxOutputBytes) ||
      command.maxOutputBytes < 1_024 ||
      command.maxOutputBytes > 67_108_864
    ) {
      throw new Error(`invalid output ceiling for ${command.name}`);
    }
    return Object.freeze({
      name: command.name,
      argv: Object.freeze([...command.argv]),
      timeoutMs: command.timeoutMs,
      maxOutputBytes: command.maxOutputBytes,
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    totalTimeoutMs: value.totalTimeoutMs,
    maxResultBytes: value.maxResultBytes,
    cargoBuildJobs: value.cargoBuildJobs,
    commands: Object.freeze(commands),
  });
}

function remountResult(mode) {
  const outcome = spawnSync(
    mountExecutable,
    ["-o", `remount,bind,${mode}`, resultPath],
    {
      env: Object.freeze({
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin",
      }),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (outcome.status !== 0) {
    const detail = `${outcome.stderr ?? ""}`.trim().slice(-1_024);
    throw new Error(`failed to remount result ${mode}: ${detail}`);
  }
}

function bindStateAnchor({ name, path }) {
  const outcome = spawnSync(mountExecutable, ["--bind", path, path], {
    env: Object.freeze({
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin:/bin",
    }),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (outcome.status !== 0) {
    throw new StateInvariantError(name, "setup failed");
  }
}

function mountId(path, name) {
  const matches = readFileSync("/proc/self/mountinfo", "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(" "))
    .filter((fields) => fields[4] === path);
  if (matches.length !== 1 || !/^\d+$/u.test(matches[0][0])) {
    throw new StateInvariantError(name, "mount identity changed");
  }
  return matches[0][0];
}

function stateAnchorIdentity({ name, path }) {
  try {
    const metadata = lstatSync(path, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new StateInvariantError(name, "type changed");
    }
    return Object.freeze({
      name,
      path,
      device: metadata.dev.toString(),
      group: metadata.gid.toString(),
      inode: metadata.ino.toString(),
      mode: metadata.mode.toString(),
      mountId: mountId(path, name),
      owner: metadata.uid.toString(),
    });
  } catch (error) {
    if (error instanceof StateInvariantError) throw error;
    throw new StateInvariantError(name, "identity unavailable");
  }
}

function protectStateAnchors() {
  for (const anchor of stateAnchorDefinitions) bindStateAnchor(anchor);
  return Object.freeze(stateAnchorDefinitions.map(stateAnchorIdentity));
}

function assertStateAnchors(expected) {
  for (const anchor of expected) {
    const observed = stateAnchorIdentity(anchor);
    if (
      observed.device !== anchor.device ||
      observed.group !== anchor.group ||
      observed.inode !== anchor.inode ||
      observed.mode !== anchor.mode ||
      observed.mountId !== anchor.mountId ||
      observed.owner !== anchor.owner
    ) {
      throw new StateInvariantError(anchor.name, "identity changed");
    }
  }
}

function terminateProcessGroup(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function commandEnvironment(cargoBuildJobs) {
  return Object.freeze({
    CARGO_BUILD_JOBS: String(cargoBuildJobs),
    CARGO_HOME: "/state/cargo",
    CARGO_NET_OFFLINE: "true",
    CARGO_TARGET_DIR: targetRoot,
    HOME: "/state/home",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/state/cargo/bin:/usr/local/bin:/usr/bin:/bin",
    RUSTUP_HOME: "/rustup",
    SOURCE_DATE_EPOCH: "946684800",
    TMPDIR: "/state/tmp",
    USER: "sandbox",
  });
}

function candidateCommandArguments(argv) {
  return [
    "--bounding-set=-all",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--no-new-privs",
    "--pdeathsig=SIGKILL",
    pythonExecutable,
    "-I",
    "-S",
    seccompLauncher,
    ...argv,
  ];
}

function verifyCandidateSandbox(cargoBuildJobs) {
  const outcome = spawnSync(
    setprivExecutable,
    candidateCommandArguments(["/bin/true"]),
    {
      cwd: workspace,
      env: commandEnvironment(cargoBuildJobs),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (outcome.status !== 0) {
    throw new Error("candidate syscall filter did not initialize");
  }
}

function runCargoCommand({ command, timeoutMs, cargoBuildJobs }) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(
      setprivExecutable,
      candidateCommandArguments([cargoExecutable, ...command.argv.slice(1)]),
      {
        cwd: workspace,
        detached: true,
        env: commandEnvironment(cargoBuildJobs),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let capturedBytes = 0;
    let disposition = "completed";
    let settled = false;
    let killTimer;
    let reapTimer;
    let timeout;
    const terminationErrors = [];

    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      clearTimeout(reapTimer);
    };
    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(
        Object.freeze({
          exitCode,
          signal,
          disposition,
          durationMs: Math.round(performance.now() - started),
          stdout,
          stderr,
          terminationErrors: Object.freeze([...terminationErrors]),
        }),
      );
    };
    const stop = (reason) => {
      if (disposition !== "completed") return;
      disposition = reason;
      try {
        terminateProcessGroup(child, "SIGTERM");
      } catch (error) {
        terminationErrors.push(`SIGTERM: ${error.code ?? error.name}`);
      }
      killTimer = setTimeout(() => {
        try {
          terminateProcessGroup(child, "SIGKILL");
        } catch (error) {
          terminationErrors.push(`SIGKILL: ${error.code ?? error.name}`);
        }
      }, 250);
      reapTimer = setTimeout(() => {
        if (settled) return;
        disposition = `${disposition}-unreaped`;
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, null);
      }, 2_000);
    };
    const append = (current, chunk) => {
      const remaining = Math.max(0, command.maxOutputBytes - capturedBytes);
      if (chunk.length > remaining) stop("output-limit");
      const admitted = chunk.subarray(0, remaining);
      capturedBytes += admitted.length;
      return admitted.length === 0
        ? current
        : Buffer.concat([current, admitted]);
    };

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
    child.once("close", finish);
    timeout = setTimeout(() => stop("timeout"), timeoutMs);
  });
}

function numericProcessIds() {
  return readdirSync("/proc", { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));
}

async function quiesceUntrustedProcesses() {
  const deadline = performance.now() + 1_500;
  for (;;) {
    const remaining = numericProcessIds().filter(
      (pid) => pid !== 1 && pid !== process.pid,
    );
    if (remaining.length === 0) return;
    for (const pid of remaining) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    if (performance.now() >= deadline) {
      throw new Error("untrusted verifier descendants could not be reaped");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function artifactPrefixes(buildArgv) {
  const prefixes = [];
  for (let index = 0; index < buildArgv.length; index += 1) {
    if (
      ["--bin", "--test"].includes(buildArgv[index]) &&
      typeof buildArgv[index + 1] === "string"
    ) {
      prefixes.push(buildArgv[index + 1]);
      index += 1;
    }
  }
  const unique = [...new Set(prefixes)];
  if (unique.length === 0) {
    throw new Error("build command declares no exact executable targets");
  }
  return unique;
}

function fileSha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function artifactEvidence(buildArgv) {
  const dependencyRoot = join(targetRoot, "debug", "deps");
  const entries = readdirSync(dependencyRoot, { withFileTypes: true });
  const reports = [];
  const admitted = new Set();
  for (const prefix of artifactPrefixes(buildArgv)) {
    const matches = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(`${prefix}-`) &&
          !entry.name.endsWith(".d"),
      )
      .map((entry) => entry.name)
      .sort();
    let executableMatches = 0;
    for (const name of matches) {
      const path = join(dependencyRoot, name);
      const metadata = lstatSync(path);
      if (!metadata.isFile() || (metadata.mode & 0o111) === 0) continue;
      executableMatches += 1;
      if (admitted.has(name)) continue;
      admitted.add(name);
      reports.push(
        Object.freeze({
          name: basename(path),
          sha256: await fileSha256(path),
          bytes: metadata.size,
          mode: metadata.mode & 0o777,
        }),
      );
    }
    if (executableMatches === 0) {
      throw new Error(`fresh ${prefix} artifact is not executable`);
    }
  }
  return Object.freeze(reports.sort((left, right) => left.name.localeCompare(right.name)));
}

function aggregateStateBytes() {
  const state = statfsSync("/state", { bigint: true });
  const used = (state.blocks - state.bfree) * state.bsize;
  if (used > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("aggregate state usage exceeds the evidence integer range");
  }
  return Number(used);
}

function commandRecord(command, outcome) {
  return Object.freeze({
    name: command.name,
    logicalArgv: command.argv,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    disposition: outcome.disposition,
    durationMs: outcome.durationMs,
    stdoutBase64: outcome.stdout.toString("base64"),
    stderrBase64: outcome.stderr.toString("base64"),
    stdoutSha256: sha256(outcome.stdout),
    stderrSha256: sha256(outcome.stderr),
    terminationErrors: outcome.terminationErrors,
  });
}

async function executeSession(configuration, started, stateAnchors) {
  const commands = [];
  let artifacts = Object.freeze([]);
  let stage = "format";
  for (const command of configuration.commands) {
    assertStateAnchors(stateAnchors);
    const elapsed = performance.now() - started;
    const remaining = Math.floor(
      configuration.totalTimeoutMs - elapsed - resultReserveMs,
    );
    if (remaining < 1_000) {
      throw new Error(`total verifier timeout exhausted before ${command.name}`);
    }
    const outcome = await runCargoCommand({
      command,
      timeoutMs: Math.min(command.timeoutMs, remaining),
      cargoBuildJobs: configuration.cargoBuildJobs,
    });
    await quiesceUntrustedProcesses();
    assertStateAnchors(stateAnchors);
    commands.push(commandRecord(command, outcome));
    if (command.name === "format") {
      if (outcome.disposition !== "completed" || outcome.exitCode !== 0) {
        return { stage: "format", commands, artifacts };
      }
      stage = "build";
      continue;
    }
    if (command.name === "build") {
      if (outcome.disposition !== "completed" || outcome.exitCode !== 0) {
        return { stage: "build", commands, artifacts };
      }
      artifacts = await artifactEvidence(command.argv);
      stage = "evaluation";
    }
  }
  return { stage: "complete", commands, artifacts };
}

function boundedError(error) {
  return `${error?.name ?? "Error"}: ${error?.message ?? String(error)}`.slice(0, 4_096);
}

function serializedResult(result, ceiling) {
  const serialized = Buffer.from(`${JSON.stringify(result)}\n`, "utf8");
  if (serialized.length <= ceiling) return serialized;
  const fallback = Buffer.from(
    `${JSON.stringify({
      schemaVersion: 1,
      status: "error",
      stage: "result",
      commands: [],
      artifacts: [],
      stateBytes: null,
      durationMs: result.durationMs,
      error: "verifier result exceeded its byte ceiling",
    })}\n`,
    "utf8",
  );
  if (fallback.length > ceiling) throw new Error("result ceiling cannot hold error evidence");
  return fallback;
}

function writeResult(buffer) {
  truncateSync(resultPath, 0);
  const descriptor = openSync(resultPath, "r+");
  try {
    let offset = 0;
    while (offset < buffer.length) {
      offset += writeSync(descriptor, buffer, offset, buffer.length - offset, offset);
    }
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

async function main() {
  const started = performance.now();
  let configuration;
  let resultProtected = false;
  let result;
  try {
    configuration = validateConfiguration(readConfiguration());
    if (typeof process.getuid !== "function" || process.getuid() !== 0) {
      throw new Error("verifier worker did not enter its private user namespace");
    }
    remountResult("ro");
    resultProtected = true;
    const stateAnchors = protectStateAnchors();
    verifyCandidateSandbox(configuration.cargoBuildJobs);
    const execution = await executeSession(configuration, started, stateAnchors);
    result = {
      schemaVersion: 1,
      status: "completed",
      stage: execution.stage,
      commands: execution.commands,
      artifacts: execution.artifacts,
      stateBytes: aggregateStateBytes(),
      durationMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    result = {
      schemaVersion: 1,
      status: "error",
      stage: "infrastructure",
      commands: [],
      artifacts: [],
      stateBytes: null,
      durationMs: Math.round(performance.now() - started),
      error: boundedError(error),
    };
  }
  await quiesceUntrustedProcesses();
  if (resultProtected) remountResult("rw");
  const ceiling = configuration?.maxResultBytes ?? 65_536;
  writeResult(serializedResult(result, ceiling));
}

await main();
