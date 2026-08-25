import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  realpathSync,
} from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedProcess } from "../native/process.mjs";
import { summarizeCommandFailure } from "./failure-diagnostic.mjs";

const bwrapExecutable = "/usr/bin/bwrap";
const prlimitExecutable = "/usr/bin/prlimit";
const systemdRunExecutable = "/usr/bin/systemd-run";
const workerSource = fileURLToPath(
  new URL("./sandbox-session-worker.mjs", import.meta.url),
);
const seccompLauncherSource = fileURLToPath(
  new URL("./seccomp-launcher.py", import.meta.url),
);
const commandOrder = Object.freeze([
  "format",
  "build",
  "public",
  "independent",
  "regression",
]);
const minimumDiskBytes = 33_554_432;
const maximumDiskBytes = 137_438_953_472;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
  if (existing(source)) args.push("--ro-bind", realpathSync(source), destination);
}

function validateCeilings({
  maxTotalWallMs,
  maxResidentBytes,
  maxDiskBytes,
  cargoBuildJobs,
  maxBuildOutputBytes,
  maxTestOutputBytesPerCommand,
}) {
  if (
    !Number.isInteger(maxTotalWallMs) ||
    maxTotalWallMs < 1_000 ||
    maxTotalWallMs > 7_200_000
  ) {
    throw new Error("verifier total timeout is invalid");
  }
  if (
    !Number.isSafeInteger(maxResidentBytes) ||
    maxResidentBytes < 268_435_456 ||
    maxResidentBytes > 68_719_476_736
  ) {
    throw new Error("verifier resident-memory ceiling is invalid");
  }
  if (
    !Number.isSafeInteger(maxDiskBytes) ||
    maxDiskBytes < minimumDiskBytes ||
    maxDiskBytes > maximumDiskBytes
  ) {
    throw new Error("verifier aggregate disk ceiling is invalid");
  }
  if (!Number.isInteger(cargoBuildJobs) || cargoBuildJobs < 1 || cargoBuildJobs > 16) {
    throw new Error("verifier Cargo job ceiling is invalid");
  }
  for (const [name, value] of [
    ["build", maxBuildOutputBytes],
    ["test", maxTestOutputBytesPerCommand],
  ]) {
    if (!Number.isInteger(value) || value < 1_024 || value > 67_108_864) {
      throw new Error(`verifier ${name} output ceiling is invalid`);
    }
  }
}

function frozenCommands(commands, maxBuildOutputBytes, maxTestOutputBytesPerCommand) {
  if (commands === null || typeof commands !== "object") {
    throw new Error("verifier commands are required");
  }
  return Object.freeze(
    commandOrder.map((name) => {
      const command = commands[name];
      if (
        command === null ||
        typeof command !== "object" ||
        !Array.isArray(command.argv) ||
        command.argv.length < 2 ||
        command.argv[0] !== "cargo" ||
        command.argv.some(
          (argument) =>
            typeof argument !== "string" ||
            argument.length === 0 ||
            argument.includes("\0"),
        ) ||
        !Number.isInteger(command.timeoutMs) ||
        command.timeoutMs < 1_000
      ) {
        throw new Error(`invalid frozen Cargo command: ${name}`);
      }
      return Object.freeze({
        name,
        argv: Object.freeze([...command.argv]),
        timeoutMs: command.timeoutMs,
        maxOutputBytes:
          name === "build"
            ? maxBuildOutputBytes
            : maxTestOutputBytesPerCommand,
      });
    }),
  );
}

function resultCeiling(commands) {
  const capturedBytes = commands.reduce(
    (total, command) => total + command.maxOutputBytes,
    0,
  );
  const encodedBytes = Math.ceil(capturedBytes / 3) * 4;
  return Math.min(268_435_456, encodedBytes + 2_097_152);
}

export function sandboxSessionArguments({
  workspace,
  outputFile,
  maxDiskBytes,
  cargoBuildJobs,
}) {
  if (
    !Number.isSafeInteger(maxDiskBytes) ||
    maxDiskBytes < minimumDiskBytes ||
    maxDiskBytes > maximumDiskBytes
  ) {
    throw new Error("verifier aggregate disk ceiling is invalid");
  }
  if (!Number.isInteger(cargoBuildJobs) || cargoBuildJobs < 1 || cargoBuildJobs > 16) {
    throw new Error("verifier Cargo job ceiling is invalid");
  }
  const home = userInfo().homedir;
  const cargo = join(home, ".cargo");
  const rustup = join(home, ".rustup");
  for (const path of [
    bwrapExecutable,
    workspace,
    outputFile,
    workerSource,
    seccompLauncherSource,
    cargo,
    rustup,
  ]) {
    accessSync(path, constants.R_OK);
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
    String(maxDiskBytes),
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
  bindIfPresent(args, join(cargo, ".global-cache"), "/state/cargo/.global-cache");
  args.push(
    "--ro-bind",
    realpathSync(rustup),
    "/rustup",
    "--ro-bind",
    realpathSync(workspace),
    "/workspace",
    "--dir",
    "/runner",
    "--ro-bind",
    realpathSync(workerSource),
    "/runner/session-worker.mjs",
    "--ro-bind",
    realpathSync(seccompLauncherSource),
    "/runner/seccomp-launcher.py",
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
    String(cargoBuildJobs),
    "--setenv",
    "CARGO_HOME",
    "/state/cargo",
    "--setenv",
    "CARGO_NET_OFFLINE",
    "true",
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
    "/runner/session-worker.mjs",
  );
  return Object.freeze(args);
}

function strictBase64(value, label) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`invalid ${label} encoding in verifier result`);
  }
  const buffer = Buffer.from(value, "base64");
  if (buffer.toString("base64") !== value) {
    throw new Error(`non-canonical ${label} encoding in verifier result`);
  }
  return buffer;
}

function sameArgv(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeSession(raw, commands, maxDiskBytes) {
  if (
    raw?.schemaVersion !== 1 ||
    !["completed", "error"].includes(raw.status) ||
    !Array.isArray(raw.commands) ||
    !Array.isArray(raw.artifacts)
  ) {
    throw new Error("invalid verifier-session result schema");
  }
  if (
    raw.stateBytes !== null &&
    (!Number.isSafeInteger(raw.stateBytes) || raw.stateBytes < 0 || raw.stateBytes > maxDiskBytes)
  ) {
    throw new Error("verifier reported invalid aggregate state usage");
  }
  if (raw.commands.length > commands.length) {
    throw new Error("verifier reported too many command outcomes");
  }
  const normalizedCommands = raw.commands.map((record, index) => {
    const expected = commands[index];
    if (
      record?.name !== expected.name ||
      !sameArgv(record.logicalArgv, expected.argv) ||
      !["completed", "timeout", "timeout-unreaped", "output-limit", "output-limit-unreaped"].includes(record.disposition) ||
      !Number.isInteger(record.durationMs) ||
      record.durationMs < 0
    ) {
      throw new Error(`invalid verifier command result at ${expected.name}`);
    }
    const stdout = strictBase64(record.stdoutBase64, `${expected.name} stdout`);
    const stderr = strictBase64(record.stderrBase64, `${expected.name} stderr`);
    if (stdout.length + stderr.length > expected.maxOutputBytes) {
      throw new Error(`${expected.name} exceeded its admitted output ceiling`);
    }
    if (sha256(stdout) !== record.stdoutSha256 || sha256(stderr) !== record.stderrSha256) {
      throw new Error(`${expected.name} output digest does not match its evidence`);
    }
    return Object.freeze({
      name: expected.name,
      logicalArgv: expected.argv,
      exitCode: record.exitCode,
      signal: record.signal,
      disposition: record.disposition,
      durationMs: record.durationMs,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
      stdoutSha256: record.stdoutSha256,
      stderrSha256: record.stderrSha256,
      diagnostic: summarizeCommandFailure({
        stdout,
        stderr,
        disposition: record.disposition,
        exitCode: record.exitCode,
      }),
      terminationErrors: Object.freeze([...(record.terminationErrors ?? [])]),
    });
  });
  const names = new Set();
  const artifacts = raw.artifacts.map((artifact) => {
    if (
      artifact === null ||
      typeof artifact !== "object" ||
      typeof artifact.name !== "string" ||
      artifact.name !== basename(artifact.name) ||
      names.has(artifact.name) ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.bytes) ||
      artifact.bytes < 0 ||
      !Number.isInteger(artifact.mode) ||
      (artifact.mode & 0o111) === 0
    ) {
      throw new Error("invalid executable-artifact evidence");
    }
    names.add(artifact.name);
    return Object.freeze({
      name: artifact.name,
      sha256: artifact.sha256,
      bytes: artifact.bytes,
      mode: artifact.mode,
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    status: raw.status,
    stage: raw.stage,
    commands: Object.freeze(normalizedCommands),
    artifacts: Object.freeze(artifacts),
    stateBytes: raw.stateBytes,
    durationMs: raw.durationMs,
    error: raw.error,
  });
}

async function assertOutputFile(path, maximumBytes) {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (metadata.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid()) ||
    metadata.size <= 0 ||
    metadata.size > maximumBytes
  ) {
    throw new Error("verifier result file violated its ownership or size contract");
  }
  return metadata;
}

export async function runSandboxVerificationSession({
  workspace,
  commands,
  maxTotalWallMs,
  maxResidentBytes,
  maxDiskBytes,
  cargoBuildJobs,
  maxBuildOutputBytes,
  maxTestOutputBytesPerCommand,
  signal,
  processRunner = runBoundedProcess,
}) {
  validateCeilings({
    maxTotalWallMs,
    maxResidentBytes,
    maxDiskBytes,
    cargoBuildJobs,
    maxBuildOutputBytes,
    maxTestOutputBytesPerCommand,
  });
  const logicalCommands = frozenCommands(
    commands,
    maxBuildOutputBytes,
    maxTestOutputBytesPerCommand,
  );
  if (logicalCommands.some(({ timeoutMs }) => timeoutMs > maxTotalWallMs)) {
    throw new Error("command timeout exceeds the total verifier timeout");
  }
  const maximumResultBytes = resultCeiling(logicalCommands);
  const outputRoot = await mkdtemp(join(tmpdir(), "oxigraph-verifier-session-"));
  const outputFile = join(outputRoot, "session.json");
  let descriptor;
  try {
    descriptor = await open(outputFile, "wx", 0o600);
    await descriptor.close();
    descriptor = undefined;
    const sandboxArgs = sandboxSessionArguments({
      workspace,
      outputFile,
      maxDiskBytes,
      cargoBuildJobs,
    });
    const invocationArgs = Object.freeze([
      "--user",
      "--scope",
      "--quiet",
      "--collect",
      "-p",
      "TasksMax=512",
      "-p",
      `MemoryMax=${maxResidentBytes}`,
      "-p",
      "MemorySwapMax=0",
      "--",
      prlimitExecutable,
      "--core=0",
      `--fsize=${maxDiskBytes}`,
      "--",
      bwrapExecutable,
      ...sandboxArgs,
    ]);
    const configuration = Object.freeze({
      schemaVersion: 1,
      totalTimeoutMs: maxTotalWallMs,
      maxResultBytes: maximumResultBytes,
      cargoBuildJobs,
      commands: logicalCommands,
    });
    const outcome = await processRunner({
      executable: systemdRunExecutable,
      args: invocationArgs,
      cwd: tmpdir(),
      environment: Object.freeze({
        HOME: "/nonexistent",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin",
        XDG_RUNTIME_DIR: `/run/user/${typeof process.getuid === "function" ? process.getuid() : 1000}`,
      }),
      stdin: JSON.stringify(configuration),
      timeoutMs: maxTotalWallMs,
      maxOutputBytes: 65_536,
      signal,
    });
    if (outcome.disposition !== "completed" || outcome.exitCode !== 0) {
      const error = new Error(
        `verifier namespace did not complete: ${outcome.disposition}/${outcome.exitCode}`,
      );
      error.outcome = outcome;
      throw error;
    }
    const metadata = await assertOutputFile(outputFile, maximumResultBytes);
    const serialized = await readFile(outputFile);
    const raw = JSON.parse(serialized.toString("utf8"));
    const session = normalizeSession(raw, logicalCommands, maxDiskBytes);
    return Object.freeze({
      invocation: Object.freeze({
        argv: Object.freeze([systemdRunExecutable, ...invocationArgs]),
        logicalCommands,
        network: "isolated",
        workspace: "read-only",
        state: "single-quota-tmpfs",
      }),
      outcome,
      resultSha256: sha256(serialized),
      resultBytes: metadata.size,
      session,
    });
  } finally {
    await descriptor?.close();
    await rm(outputRoot, { recursive: true, force: true });
  }
}
