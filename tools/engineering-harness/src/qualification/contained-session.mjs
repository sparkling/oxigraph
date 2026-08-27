import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { summarizeCommandFailure } from "../candidate/failure-diagnostic.mjs";
import { runBoundedProcess } from "../native/process.mjs";
import {
  G17_NATIVE_SESSION_ARTIFACT_NAME,
  G17_NATIVE_SESSION_RESULT_SCHEMA,
  createG17NativeSessionConfiguration,
  g17NativeSessionEnvironment,
  verifyG17NativeSessionArtifact,
} from "./native-session-contract.mjs";

const bwrapExecutable = "/usr/bin/bwrap";
const prlimitExecutable = "/usr/bin/prlimit";
const systemdRunExecutable = "/usr/bin/systemd-run";
const hostCgroupRoot = "/sys/fs/cgroup";
const sandboxCgroupRoot = "/control/cgroup2";
const resultSchema = G17_NATIVE_SESSION_RESULT_SCHEMA;
const safeLane = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;
const safeEnvironmentName = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const minimumDiskBytes = 33_554_432;
const maximumDiskBytes = 137_438_953_472;
const maximumPinnedFileBytes = 16 * 1024 * 1024;
const childFileDescriptors = Object.freeze({
  platform: "3",
  cgroup: "4",
  cargoHome: "5",
  toolchain: "6",
  workspace: "7",
  worker: "8",
  launcher: "9",
  output: "10",
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    expected.length !== Object.keys(value).length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`${label} fields are not exact`);
  }
}

function validateCeilings({
  maxTotalWallMs,
  maxResidentBytes,
  maxDiskBytes,
  cargoBuildJobs,
}) {
  if (
    !Number.isInteger(maxTotalWallMs) ||
    maxTotalWallMs < 1_000 ||
    maxTotalWallMs > 7_200_000
  ) {
    throw new Error("qualification total timeout is invalid");
  }
  if (
    !Number.isSafeInteger(maxResidentBytes) ||
    maxResidentBytes < 268_435_456 ||
    maxResidentBytes > 68_719_476_736
  ) {
    throw new Error("qualification resident-memory ceiling is invalid");
  }
  if (
    !Number.isSafeInteger(maxDiskBytes) ||
    maxDiskBytes < minimumDiskBytes ||
    maxDiskBytes > maximumDiskBytes
  ) {
    throw new Error("qualification aggregate disk ceiling is invalid");
  }
  if (!Number.isInteger(cargoBuildJobs) || cargoBuildJobs < 1 || cargoBuildJobs > 16) {
    throw new Error("qualification Cargo job ceiling is invalid");
  }
}

function frozenCommands(commands, maxTotalWallMs) {
  if (
    !Array.isArray(commands) ||
    commands.length < 2 ||
    commands.length > 64 ||
    commands.length % 2 !== 0
  ) {
    throw new Error("qualification commands must be bounded inventory/execution pairs");
  }
  const lanes = new Set();
  const frozen = commands.map((command, index) => {
    exactKeys(command, ["name", "argv", "timeoutMs", "maxOutputBytes"], `command ${index}`);
    const separator = command.name.indexOf(":");
    const phase = command.name.slice(0, separator);
    const lane = command.name.slice(separator + 1);
    const expectedPhase = index % 2 === 0 ? "inventory" : "execution";
    if (
      separator < 1 ||
      phase !== expectedPhase ||
      !safeLane.test(lane) ||
      (phase === "inventory" && lanes.has(lane)) ||
      (phase === "execution" && commands[index - 1]?.name !== `inventory:${lane}`)
    ) {
      throw new Error("qualification commands are not frozen inventory/execution pairs");
    }
    if (phase === "inventory") lanes.add(lane);
    if (!Array.isArray(command.argv)) {
      throw new Error(`invalid qualification Cargo command: ${command.name}`);
    }
    const targetIndexes = command.argv
      .map((argument, argvIndex) => argument === "--target-dir" ? argvIndex : -1)
      .filter((argvIndex) => argvIndex >= 0);
    if (
      command.argv.length < 8 ||
      command.argv[0] !== "cargo" ||
      command.argv[1] !== "test" ||
      !command.argv.includes("--locked") ||
      !command.argv.includes("--offline") ||
      targetIndexes.length !== 1 ||
      command.argv[targetIndexes[0] + 1] !== "/state/target" ||
      command.argv.some(
        (argument) =>
          typeof argument !== "string" ||
          argument.length === 0 ||
          argument.includes("\0"),
      ) ||
      !Number.isInteger(command.timeoutMs) ||
      command.timeoutMs < 1_000 ||
      command.timeoutMs > maxTotalWallMs ||
      !Number.isInteger(command.maxOutputBytes) ||
      command.maxOutputBytes < 1_024 ||
      command.maxOutputBytes > 67_108_864
    ) {
      throw new Error(`invalid qualification Cargo command: ${command.name}`);
    }
    return Object.freeze({
      name: command.name,
      argv: Object.freeze([...command.argv]),
      timeoutMs: command.timeoutMs,
      maxOutputBytes: command.maxOutputBytes,
    });
  });
  return Object.freeze(frozen);
}

export function qualificationSandboxEnvironment(platform, cargoBuildJobs) {
  return g17NativeSessionEnvironment(platform, cargoBuildJobs);
}

export function qualificationSandboxSessionArguments(input) {
  exactKeys(
    input,
    ["maxDiskBytes", "environment"],
    "qualification sandbox argument input",
  );
  const { maxDiskBytes, environment } = input;
  if (
    !Number.isSafeInteger(maxDiskBytes) ||
    maxDiskBytes < minimumDiskBytes ||
    maxDiskBytes > maximumDiskBytes
  ) {
    throw new Error("qualification aggregate disk ceiling is invalid");
  }
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new Error("qualification sandbox environment is missing");
  }
  for (const [name, value] of Object.entries(environment)) {
    if (
      !safeEnvironmentName.test(name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.includes("\0")
    ) {
      throw new Error("qualification sandbox environment is malformed");
    }
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
    "--ro-bind-fd",
    childFileDescriptors.platform,
    "/",
    "--proc",
    "/proc",
    "--ro-bind-fd",
    childFileDescriptors.cgroup,
    sandboxCgroupRoot,
    "--dev",
    "/dev",
    "--remount-ro",
    "/dev",
    "--size",
    String(maxDiskBytes),
    "--tmpfs",
    "/state",
    "--dir",
    "/state/home",
    "--dir",
    "/state/target",
    "--dir",
    "/state/tmp",
    "--ro-bind-fd",
    childFileDescriptors.cargoHome,
    "/cargo-home",
    "--ro-bind-fd",
    childFileDescriptors.toolchain,
    "/toolchain",
    "--ro-bind-fd",
    childFileDescriptors.workspace,
    "/workspace",
    "--ro-bind-fd",
    childFileDescriptors.worker,
    "/runner/contained-session-worker.mjs",
    "--ro-bind-fd",
    childFileDescriptors.launcher,
    "/runner/seccomp-launcher.py",
    "--bind-fd",
    childFileDescriptors.output,
    "/result/session.json",
    "--remount-ro",
    "/",
    "--chdir",
    "/workspace",
  ];
  for (const name of Object.keys(environment).sort()) {
    const value = environment[name];
    args.push("--setenv", name, value);
  }
  args.push("--", "/usr/bin/node", "/runner/contained-session-worker.mjs");
  return Object.freeze(args);
}

function strictBase64(value, label) {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new Error(`invalid ${label} encoding in qualification result`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new Error(`non-canonical ${label} encoding in qualification result`);
  }
  return bytes;
}

function sameArgv(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeSession(raw, commands, maxDiskBytes) {
  exactKeys(
    raw,
    [
      "schema",
      "status",
      "stage",
      "commands",
      "stateBytes",
      "durationMs",
      "error",
      "finalDescendantsObserved",
    ],
    "qualification result",
  );
  if (
    raw.schema !== resultSchema ||
    !["completed", "incomplete", "error"].includes(raw.status) ||
    !Array.isArray(raw.commands) ||
    !Number.isSafeInteger(raw.durationMs) ||
    raw.durationMs < 0 ||
    raw.commands.length > commands.length
  ) {
    throw new Error("invalid qualification-session result schema");
  }
  if (
    raw.stateBytes !== null &&
    (!Number.isSafeInteger(raw.stateBytes) || raw.stateBytes < 0 || raw.stateBytes > maxDiskBytes)
  ) {
    throw new Error("qualification reported invalid aggregate state usage");
  }
  if (
    (raw.status === "completed" &&
      (raw.stage !== "complete" ||
        raw.commands.length !== commands.length ||
        raw.stateBytes === null ||
        raw.error !== null ||
        raw.finalDescendantsObserved !== 0)) ||
    (raw.status === "incomplete" &&
      (raw.stage !== "containment" ||
        raw.commands.length < 1 ||
        raw.stateBytes === null ||
        typeof raw.error !== "string" ||
        !raw.error.startsWith("live-descendants:") ||
        !Number.isSafeInteger(raw.finalDescendantsObserved) ||
        raw.finalDescendantsObserved < 0)) ||
    (raw.status === "error" &&
      (raw.stage !== "infrastructure" ||
        raw.commands.length !== 0 ||
        raw.stateBytes !== null ||
        typeof raw.error !== "string" ||
        raw.error.length < 1 ||
        raw.finalDescendantsObserved !== null))
  ) {
    throw new Error("invalid qualification-session result schema");
  }
  const normalizedCommands = raw.commands.map((record, index) => {
    const expected = commands[index];
    exactKeys(
      record,
      [
        "name",
        "logicalArgv",
        "exitCode",
        "signal",
        "disposition",
        "durationMs",
        "stdoutBase64",
        "stderrBase64",
        "stdoutSha256",
        "stderrSha256",
        "launchAttestationBase64",
        "launchAttestationSha256",
        "terminationErrors",
        "descendantsObserved",
      ],
      `qualification command result ${index}`,
    );
    if (
      record.name !== expected.name ||
      !sameArgv(record.logicalArgv, expected.argv) ||
      !["completed", "timeout", "timeout-unreaped", "output-limit", "output-limit-unreaped"].includes(record.disposition) ||
      !Number.isInteger(record.durationMs) ||
      record.durationMs < 0 ||
      !Number.isSafeInteger(record.descendantsObserved) ||
      record.descendantsObserved < 0 ||
      !Array.isArray(record.terminationErrors) ||
      record.terminationErrors.some((value) => typeof value !== "string" || value.length === 0)
    ) {
      throw new Error(`invalid qualification command result at ${expected.name}`);
    }
    const exitCodeValid =
      record.exitCode === null ||
      (Number.isInteger(record.exitCode) && record.exitCode >= 0);
    const signalValid =
      record.signal === null ||
      (typeof record.signal === "string" && record.signal.length > 0);
    if (
      !exitCodeValid ||
      !signalValid ||
      (record.exitCode !== null && record.signal !== null) ||
      (record.disposition === "completed" &&
        ((record.exitCode === null && record.signal === null) ||
          record.terminationErrors.length !== 0))
    ) {
      throw new Error(`impossible qualification command result at ${expected.name}`);
    }
    const stdout = strictBase64(record.stdoutBase64, `${expected.name} stdout`);
    const stderr = strictBase64(record.stderrBase64, `${expected.name} stderr`);
    const launchAttestation = strictBase64(
      record.launchAttestationBase64,
      `${expected.name} launch attestation`,
    );
    if (stdout.length + stderr.length > expected.maxOutputBytes) {
      throw new Error(`${expected.name} exceeded its admitted output ceiling`);
    }
    if (
      sha256(stdout) !== record.stdoutSha256 ||
      sha256(stderr) !== record.stderrSha256 ||
      launchAttestation.length < 1 ||
      launchAttestation.length > 128 * 1024 ||
      sha256(launchAttestation) !== record.launchAttestationSha256
    ) {
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
      stdoutBytes: stdout,
      stderrBytes: stderr,
      stdoutSha256: record.stdoutSha256,
      stderrSha256: record.stderrSha256,
      launchAttestationSha256: record.launchAttestationSha256,
      diagnostic: summarizeCommandFailure({
        stdout,
        stderr,
        disposition: record.disposition,
        exitCode: record.exitCode,
      }),
      terminationErrors: Object.freeze([...record.terminationErrors]),
      descendantsObserved: record.descendantsObserved,
    });
  });
  if (raw.status === "completed") {
    if (normalizedCommands.some(({ descendantsObserved }) => descendantsObserved !== 0)) {
      throw new Error("invalid qualification-session completed descendant state");
    }
  } else if (raw.status === "incomplete") {
    const commandContainment = raw.error !== "live-descendants:final";
    if (commandContainment) {
      const last = normalizedCommands.at(-1);
      if (
        raw.finalDescendantsObserved !== 0 ||
        raw.error !== `live-descendants:${last.name}` ||
        last.descendantsObserved < 1 ||
        normalizedCommands.slice(0, -1).some(({ descendantsObserved }) => descendantsObserved !== 0)
      ) {
        throw new Error("invalid qualification-session command containment state");
      }
    } else if (
      normalizedCommands.length !== commands.length ||
      raw.finalDescendantsObserved < 1 ||
      normalizedCommands.some(({ descendantsObserved }) => descendantsObserved !== 0)
    ) {
      throw new Error("invalid qualification-session final containment state");
    }
  }
  return Object.freeze({
    schema: resultSchema,
    status: raw.status,
    stage: raw.stage,
    commands: Object.freeze(normalizedCommands),
    stateBytes: raw.stateBytes,
    durationMs: raw.durationMs,
    error: raw.error,
    finalDescendantsObserved: raw.finalDescendantsObserved,
  });
}

function metadataIdentity(metadata) {
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    links: metadata.nlink.toString(),
    owner: metadata.uid.toString(),
    group: metadata.gid.toString(),
    size: metadata.size.toString(),
    modifiedNs: metadata.mtimeNs.toString(),
    changedNs: metadata.ctimeNs.toString(),
  });
}

function persistentIdentity(metadata) {
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    links: metadata.nlink.toString(),
    owner: metadata.uid.toString(),
    group: metadata.gid.toString(),
  });
}

function permissions(metadata) {
  return Number(metadata.mode & 0o7777n);
}

function validateAbsolutePath(path, label) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    !isAbsolute(path) ||
    resolve(path) !== path
  ) {
    throw new Error(`${label} is not a canonical absolute path`);
  }
}

function validateDirectoryMetadata(metadata, label, expectedMode = null) {
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.nlink < 1n ||
    (expectedMode !== null && permissions(metadata) !== expectedMode)
  ) {
    throw new Error(`${label} is not an exact real directory`);
  }
}

function validatePinnedFileMetadata(
  metadata,
  label,
  { executable = false, maximumBytes = maximumPinnedFileBytes } = {},
) {
  const mode = permissions(metadata);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1n ||
    metadata.size < 1n ||
    metadata.size > BigInt(maximumBytes) ||
    (mode & 0o222) !== 0 ||
    (executable ? (mode & 0o111) === 0 : (mode & 0o444) === 0)
  ) {
    throw new Error(`${label} is not a bounded sealed regular file`);
  }
}

async function openPinnedDirectory(path, label, expectedMode = null) {
  validateAbsolutePath(path, label);
  if (
    !Number.isInteger(constants.O_DIRECTORY) ||
    !Number.isInteger(constants.O_NOFOLLOW)
  ) {
    throw new Error("qualification directory pinning is unavailable");
  }
  let handle;
  try {
    const [resolvedBefore, before] = await Promise.all([
      realpath(path),
      lstat(path, { bigint: true }),
    ]);
    validateDirectoryMetadata(before, label, expectedMode);
    if (resolvedBefore !== path) {
      throw new Error(`${label} traverses a symbolic link`);
    }
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const [opened, resolvedAfter, after] = await Promise.all([
      handle.stat({ bigint: true }),
      realpath(path),
      lstat(path, { bigint: true }),
    ]);
    validateDirectoryMetadata(opened, label, expectedMode);
    if (
      resolvedAfter !== path ||
      !isDeepStrictEqual(metadataIdentity(opened), metadataIdentity(before)) ||
      !isDeepStrictEqual(metadataIdentity(after), metadataIdentity(before))
    ) {
      throw new Error(`${label} changed while it was pinned`);
    }
    return Object.freeze({
      handle,
      identity: metadataIdentity(before),
      persistent: persistentIdentity(before),
      label,
      path,
      canonical: true,
      type: "directory",
    });
  } catch (error) {
    await handle?.close();
    throw new Error(`${label} could not be pinned`, { cause: error });
  }
}

function pinnedChildPath(parent, name, label) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(name) ||
    parent?.type !== "directory"
  ) {
    throw new Error(`${label} has an unsafe pinned child name`);
  }
  return `/proc/self/fd/${parent.handle.fd}/${name}`;
}

async function openPinnedChildDirectory(parent, name, label) {
  const path = pinnedChildPath(parent, name, label);
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    validateDirectoryMetadata(before, label);
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const [opened, after] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    validateDirectoryMetadata(opened, label);
    if (
      !isDeepStrictEqual(metadataIdentity(opened), metadataIdentity(before)) ||
      !isDeepStrictEqual(metadataIdentity(after), metadataIdentity(before))
    ) {
      throw new Error(`${label} changed while it was pinned`);
    }
    return Object.freeze({
      handle,
      identity: metadataIdentity(before),
      persistent: persistentIdentity(before),
      label,
      path,
      canonical: false,
      type: "directory",
    });
  } catch (error) {
    await handle?.close();
    throw new Error(`${label} could not be pinned`, { cause: error });
  }
}

async function openPinnedChildFile(parent, name, label, options = {}) {
  const path = pinnedChildPath(parent, name, label);
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    validatePinnedFileMetadata(before, label, options);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const [opened, after] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    validatePinnedFileMetadata(opened, label, options);
    if (
      !isDeepStrictEqual(metadataIdentity(opened), metadataIdentity(before)) ||
      !isDeepStrictEqual(metadataIdentity(after), metadataIdentity(before))
    ) {
      throw new Error(`${label} changed while it was pinned`);
    }
    return Object.freeze({
      handle,
      identity: metadataIdentity(before),
      persistent: persistentIdentity(before),
      label,
      path,
      canonical: false,
      type: "file",
    });
  } catch (error) {
    await handle?.close();
    throw new Error(`${label} could not be pinned`, { cause: error });
  }
}

async function verifyPinnedObject(record) {
  const [opened, named, resolved] = await Promise.all([
    record.handle.stat({ bigint: true }),
    lstat(record.path, { bigint: true }),
    record.canonical ? realpath(record.path) : Promise.resolve(record.path),
  ]);
  if (
    (record.type === "directory" && (!opened.isDirectory() || named.isSymbolicLink())) ||
    (record.type === "file" && (!opened.isFile() || named.isSymbolicLink())) ||
    (record.canonical && resolved !== record.path) ||
    !isDeepStrictEqual(metadataIdentity(opened), record.identity) ||
    !isDeepStrictEqual(metadataIdentity(named), record.identity)
  ) {
    throw new Error(`${record.label} changed while the qualification session ran`);
  }
}

function failureWithCleanupErrors(error, cleanupErrors, message) {
  if (cleanupErrors.length === 0) return error;
  if (
    error !== null &&
    ["object", "function"].includes(typeof error) &&
    Object.isExtensible(error)
  ) {
    error.cleanupErrors = Object.freeze(
      cleanupErrors.map((cleanupError) => cleanupError.message),
    );
    return error;
  }
  return new AggregateError([error, ...cleanupErrors], message);
}

async function createPrivateOutput() {
  const rootPath = await mkdtemp(join(tmpdir(), "oxigraph-g17-native-session-"));
  let root;
  let output;
  try {
    await chmod(rootPath, 0o700);
    root = await openPinnedDirectory(rootPath, "qualification output root", 0o700);
    const expectedOwner = typeof process.getuid === "function"
      ? String(process.getuid())
      : root.persistent.owner;
    const expectedGroup = typeof process.getgid === "function"
      ? String(process.getgid())
      : root.persistent.group;
    if (
      root.persistent.owner !== expectedOwner ||
      root.persistent.group !== expectedGroup
    ) {
      throw new Error("qualification output root ownership is not private");
    }
    const outputPath = pinnedChildPath(root, "session.json", "qualification result file");
    output = await open(
      outputPath,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await output.chmod(0o600);
    await output.sync();
    const [opened, named] = await Promise.all([
      output.stat({ bigint: true }),
      lstat(outputPath, { bigint: true }),
    ]);
    const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : opened.uid;
    const gid = typeof process.getgid === "function" ? BigInt(process.getgid()) : opened.gid;
    if (
      !opened.isFile() ||
      named.isSymbolicLink() ||
      opened.nlink !== 1n ||
      opened.size !== 0n ||
      permissions(opened) !== 0o600 ||
      opened.uid !== uid ||
      opened.gid !== gid ||
      !isDeepStrictEqual(metadataIdentity(named), metadataIdentity(opened))
    ) {
      throw new Error("qualification result file creation was not private and exact");
    }
    return Object.freeze({
      root,
      rootPath,
      output: Object.freeze({
        handle: output,
        initialPersistent: persistentIdentity(opened),
        label: "qualification result file",
        path: outputPath,
        type: "output",
      }),
    });
  } catch (error) {
    const cleanupErrors = [];
    if (output !== undefined && root !== undefined) {
      try {
        const path = pinnedChildPath(root, "session.json", "qualification result file");
        const [opened, named] = await Promise.all([
          output.stat({ bigint: true }),
          lstat(path, { bigint: true }),
        ]);
        if (
          named.isSymbolicLink() ||
          !named.isFile() ||
          !isDeepStrictEqual(
            persistentIdentity(opened),
            persistentIdentity(named),
          )
        ) {
          throw new Error("qualification result pathname changed during construction cleanup");
        }
        await unlink(path);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (output !== undefined) {
      try {
        await output.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (root !== undefined) {
      try {
        const [opened, named, resolved] = await Promise.all([
          root.handle.stat({ bigint: true }),
          lstat(rootPath, { bigint: true }),
          realpath(rootPath),
        ]);
        if (
          resolved !== rootPath ||
          !isDeepStrictEqual(
            persistentIdentity(opened),
            persistentIdentity(named),
          ) ||
          !isDeepStrictEqual(persistentIdentity(opened), root.persistent)
        ) {
          throw new Error("qualification output root changed during construction cleanup");
        }
        await rmdir(rootPath);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      try {
        await root.handle.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    } else {
      try {
        await rmdir(rootPath);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    throw failureWithCleanupErrors(
      error,
      cleanupErrors,
      "qualification output construction and cleanup failed",
    );
  }
}

async function readBoundedOutputHandle(record, maximumBytes) {
  const before = await record.handle.stat({ bigint: true });
  const namedBefore = await lstat(record.path, { bigint: true });
  const uid = typeof process.getuid === "function" ? BigInt(process.getuid()) : before.uid;
  const gid = typeof process.getgid === "function" ? BigInt(process.getgid()) : before.gid;
  if (
    !before.isFile() ||
    namedBefore.isSymbolicLink() ||
    before.nlink !== 1n ||
    permissions(before) !== 0o600 ||
    before.uid !== uid ||
    before.gid !== gid ||
    before.size < 1n ||
    before.size > BigInt(maximumBytes) ||
    !isDeepStrictEqual(persistentIdentity(before), record.initialPersistent) ||
    !isDeepStrictEqual(metadataIdentity(namedBefore), metadataIdentity(before))
  ) {
    throw new Error("qualification result file violated its ownership or size contract");
  }
  const size = Number(before.size);
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await record.handle.read(
      bytes,
      offset,
      size - offset,
      offset,
    );
    if (bytesRead === 0) {
      throw new Error("qualification result file ended before its admitted size");
    }
    offset += bytesRead;
  }
  const [after, namedAfter] = await Promise.all([
    record.handle.stat({ bigint: true }),
    lstat(record.path, { bigint: true }),
  ]);
  if (
    !isDeepStrictEqual(metadataIdentity(after), metadataIdentity(before)) ||
    !isDeepStrictEqual(metadataIdentity(namedAfter), metadataIdentity(before))
  ) {
    throw new Error("qualification result file changed while it was read");
  }
  return Object.freeze({ bytes: Buffer.from(bytes), size });
}

async function cleanupSessionResources({ records, privateOutput }) {
  const errors = [];
  if (privateOutput?.output !== undefined) {
    try {
      const named = await lstat(privateOutput.output.path, { bigint: true });
      const opened = await privateOutput.output.handle.stat({ bigint: true });
      if (
        named.isSymbolicLink() ||
        !named.isFile() ||
        !isDeepStrictEqual(persistentIdentity(named), persistentIdentity(opened)) ||
        !isDeepStrictEqual(persistentIdentity(opened), privateOutput.output.initialPersistent)
      ) {
        throw new Error("qualification result pathname changed before cleanup");
      }
      await unlink(privateOutput.output.path);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const record of [...records].reverse()) {
    try {
      await record.handle.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (privateOutput?.root !== undefined) {
    try {
      const [opened, named, resolved] = await Promise.all([
        privateOutput.root.handle.stat({ bigint: true }),
        lstat(privateOutput.rootPath, { bigint: true }),
        realpath(privateOutput.rootPath),
      ]);
      if (
        resolved !== privateOutput.rootPath ||
        permissions(opened) !== 0o700 ||
        !isDeepStrictEqual(persistentIdentity(opened), persistentIdentity(named)) ||
        !isDeepStrictEqual(persistentIdentity(opened), privateOutput.root.persistent)
      ) {
        throw new Error("qualification output root changed before cleanup");
      }
      await rmdir(privateOutput.rootPath);
    } catch (error) {
      errors.push(error);
    }
    try {
      await privateOutput.root.handle.close();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function runQualificationSandboxSessionWithRunner(options, processRunner) {
  const {
    runId,
    contractBytes,
    contractSha256,
    platform,
    policy,
    workspaceProjectionSha256,
    requestedLimits,
    sourceDirectory,
    cargoHomeDirectory,
    toolchainDirectory,
    platformDirectory,
    signal,
  } = options;
  const configuration = createG17NativeSessionConfiguration({
    runId,
    contractBytes,
    contractSha256,
    platform,
    policy,
    workspaceProjectionSha256,
    requestedLimits,
  });
  const {
    totalWallMs: maxTotalWallMs,
    residentBytes: maxResidentBytes,
    diskBytes: maxDiskBytes,
    cargoBuildJobs,
  } = configuration.requestedLimits;
  validateCeilings({
    maxTotalWallMs,
    maxResidentBytes,
    maxDiskBytes,
    cargoBuildJobs,
  });
  const logicalCommands = frozenCommands(configuration.commands, maxTotalWallMs);
  const maximumResultBytes = configuration.maxResultBytes;
  const records = [];
  let privateOutput;
  let report;
  let failure;
  try {
    const platformRoot = await openPinnedDirectory(
      platformDirectory,
      "qualification platform root",
    );
    records.push(platformRoot);
    const cgroupRoot = await openPinnedDirectory(
      hostCgroupRoot,
      "qualification cgroup root",
    );
    records.push(cgroupRoot);
    const cargoHomeRoot = await openPinnedDirectory(
      cargoHomeDirectory,
      "qualification Cargo home",
    );
    records.push(cargoHomeRoot);
    const toolchainRoot = await openPinnedDirectory(
      toolchainDirectory,
      "qualification toolchain root",
    );
    records.push(toolchainRoot);
    const workspaceRoot = await openPinnedDirectory(
      sourceDirectory,
      "qualification workspace root",
    );
    records.push(workspaceRoot);
    const roots = [
      platformRoot,
      cgroupRoot,
      cargoHomeRoot,
      toolchainRoot,
      workspaceRoot,
    ];
    if (
      new Set(
        roots.map(({ persistent }) => `${persistent.device}:${persistent.inode}`),
      ).size !== roots.length
    ) {
      throw new Error("qualification sandbox roots are not distinct objects");
    }

    const runnerRoot = await openPinnedChildDirectory(
      platformRoot,
      "runner",
      "qualification platform runner root",
    );
    records.push(runnerRoot);
    const worker = await openPinnedChildFile(
      runnerRoot,
      "contained-session-worker.mjs",
      "qualification contained-session worker",
    );
    records.push(worker);
    const launcher = await openPinnedChildFile(
      runnerRoot,
      "seccomp-launcher.py",
      "qualification seccomp launcher",
    );
    records.push(launcher);
    const toolchainBin = await openPinnedChildDirectory(
      toolchainRoot,
      "bin",
      "qualification toolchain bin directory",
    );
    records.push(toolchainBin);
    const cargo = await openPinnedChildFile(
      toolchainBin,
      "cargo",
      "qualification Cargo executable",
      { executable: true, maximumBytes: 256 * 1024 * 1024 },
    );
    records.push(cargo);
    const rustc = await openPinnedChildFile(
      toolchainBin,
      "rustc",
      "qualification rustc executable",
      { executable: true, maximumBytes: 256 * 1024 * 1024 },
    );
    records.push(rustc);

    privateOutput = await createPrivateOutput();
    records.push(privateOutput.output);
    const inheritedRecords = [
      platformRoot,
      cgroupRoot,
      cargoHomeRoot,
      toolchainRoot,
      workspaceRoot,
      worker,
      launcher,
      privateOutput.output,
    ];
    const inheritedFileDescriptors = inheritedRecords.map(({ handle }) => handle.fd);
    if (
      inheritedFileDescriptors.length !== Object.keys(childFileDescriptors).length ||
      new Set(inheritedFileDescriptors).size !== inheritedFileDescriptors.length
    ) {
      throw new Error("qualification descriptor transport is not exact");
    }
    const sandboxArgs = qualificationSandboxSessionArguments({
      maxDiskBytes,
      environment: configuration.environment,
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
      inheritedFileDescriptors,
    });
    for (const record of records) {
      if (record.type !== "output") await verifyPinnedObject(record);
    }
    if (outcome.disposition !== "completed" || outcome.exitCode !== 0) {
      const error = new Error(
        `qualification namespace did not complete: ${outcome.disposition}/${outcome.exitCode}`,
      );
      error.outcome = outcome;
      throw error;
    }
    const output = await readBoundedOutputHandle(
      privateOutput.output,
      maximumResultBytes,
    );
    const serialized = output.bytes;
    const raw = JSON.parse(serialized.toString("utf8"));
    const projection = verifyG17NativeSessionArtifact({
      bytes: serialized,
      expectedConfiguration: configuration,
      contractBytes,
      contractSha256,
    });
    const session = normalizeSession(
      {
        schema: raw.schema,
        status: raw.status,
        stage: raw.stage,
        commands: raw.commands,
        stateBytes: raw.stateBytes,
        durationMs: raw.durationMs,
        error: raw.error,
        finalDescendantsObserved: raw.finalDescendantsObserved,
      },
      logicalCommands,
      maxDiskBytes,
    );
    const storedBytes = Buffer.from(serialized);
    report = Object.freeze({
      invocation: Object.freeze({
        kind: "qualification",
        argv: Object.freeze([systemdRunExecutable, ...invocationArgs]),
        logicalCommands,
        network: "isolated",
        source: "read-only",
        cargoHome: "read-only",
        toolchain: "read-only",
        platform: "read-only-root",
        state: "single-quota-tmpfs",
        cwd: "/workspace",
        cargoExecutable: configuration.cargoExecutable,
        environment: configuration.environment,
      }),
      outcome,
      artifact: Object.freeze({
        name: G17_NATIVE_SESSION_ARTIFACT_NAME,
        get bytes() {
          return Buffer.from(storedBytes);
        },
        sha256: sha256(storedBytes),
      }),
      resultSha256: sha256(storedBytes),
      resultBytes: output.size,
      projection,
      session,
    });
  } catch (error) {
    failure = error;
  }
  const cleanupErrors = await cleanupSessionResources({ records, privateOutput });
  if (failure !== undefined) {
    throw failureWithCleanupErrors(
      failure,
      cleanupErrors,
      "qualification session and cleanup failed",
    );
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "qualification session cleanup failed");
  }
  return report;
}

export function runQualificationSandboxSession(options) {
  return runQualificationSandboxSessionWithRunner(options, runBoundedProcess);
}

export function createQualificationSandboxSessionForTesting(processRunner) {
  if (typeof processRunner !== "function") {
    throw new Error("qualification whole-session test runner is required");
  }
  return (options) => runQualificationSandboxSessionWithRunner(options, processRunner);
}
