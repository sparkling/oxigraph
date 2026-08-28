import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { types as utilTypes } from "node:util";
import { runBoundedProcess } from "../native/process.mjs";
import { runBoundedProcessBytes } from "../native/process.mjs";

const gitExecutable = "/usr/bin/git";
const maximumGitStdinBytes = 4 * 1024 * 1024;
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

export class GitProcessFault extends Error {
  constructor(args, outcome) {
    const detail = outcome.stderr.trim() || outcome.stdout.trim() || "no output";
    super(
      `git ${args[0]} failed (${outcome.disposition}/${outcome.exitCode}): ${detail}`,
    );
    this.name = "GitProcessFault";
    this.disposition = outcome.disposition;
    this.outcome = outcome;
  }
}

export class GitBytesProcessFault extends Error {
  constructor(args, outcome) {
    const stderr = Buffer.isBuffer(outcome.stderr)
      ? outcome.stderr
      : Buffer.alloc(0);
    const stdout = Buffer.isBuffer(outcome.stdout)
      ? outcome.stdout
      : Buffer.alloc(0);
    const detailBytes = stderr.length > 0 ? stderr : stdout;
    const detail =
      detailBytes.length > 0
        ? detailBytes.subarray(0, 4_096).toString("utf8").trim() || "no output"
        : "no output";
    super(
      `git ${args[0]} failed (${outcome.disposition}/${outcome.exitCode}): ${detail}`,
    );
    this.name = "GitBytesProcessFault";
    this.disposition = outcome.disposition;
    this.outcome = outcome;
  }
}

export async function createGitHome(root) {
  const home = join(root, "git-home");
  await mkdir(home, { mode: 0o700 });
  return home;
}

function gitEnvironment(home, overrides = {}) {
  return Object.freeze({
    ...overrides,
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: "/",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    HOME: home,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/bin:/bin",
  });
}

async function executeGit({
  args,
  cwd,
  home,
  stdin = "",
  timeoutMs = 120_000,
  maxOutputBytes = 4_194_304,
  environmentOverrides,
  inheritedFileDescriptors = [],
  signal,
}, processRunner) {
  const outcome = await processRunner({
    executable: gitExecutable,
    args,
    cwd,
    environment: gitEnvironment(home, environmentOverrides),
    stdin,
    timeoutMs,
    maxOutputBytes,
    inheritedFileDescriptors,
    signal,
  });
  if (outcome.disposition !== "completed" || outcome.exitCode !== 0) {
    throw new GitProcessFault(args, outcome);
  }
  return outcome.stdout;
}

export function runGit(input) {
  return executeGit(input, runBoundedProcess);
}

function copyGitStdinBytes(value) {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value !== "object" ||
    utilTypes.isProxy(value) ||
    !utilTypes.isUint8Array(value)
  ) {
    throw new TypeError("Git byte stdin must be bounded private bytes");
  }
  let buffer;
  let byteLength;
  let byteOffset;
  try {
    buffer = nativeTypedArrayBufferGetter.call(value);
    byteLength = nativeTypedArrayByteLengthGetter.call(value);
    byteOffset = nativeTypedArrayByteOffsetGetter.call(value);
  } catch {
    throw new TypeError("Git byte stdin must be bounded private bytes");
  }
  if (
    utilTypes.isSharedArrayBuffer(buffer) ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > maximumGitStdinBytes ||
    !Number.isSafeInteger(byteOffset) ||
    byteOffset < 0
  ) {
    throw new TypeError("Git byte stdin must be bounded private bytes");
  }
  try {
    return Buffer.from(new Uint8Array(buffer, byteOffset, byteLength));
  } catch {
    throw new TypeError("Git byte stdin must be bounded private bytes");
  }
}

async function executeGitBytes(
  {
    args,
    cwd,
    home,
    stdin,
    timeoutMs = 120_000,
    maxOutputBytes = 4_194_304,
    environmentOverrides,
    inheritedFileDescriptors = [],
    signal,
  },
  processRunner,
) {
  const stdinBytes = copyGitStdinBytes(stdin);
  const request = {
    executable: gitExecutable,
    args,
    cwd,
    environment: gitEnvironment(home, environmentOverrides),
    timeoutMs,
    maxOutputBytes,
    inheritedFileDescriptors,
    signal,
  };
  if (stdinBytes !== undefined) request.stdin = stdinBytes;
  const outcome = await processRunner(request);
  if (
    outcome.disposition !== "completed" ||
    outcome.exitCode !== 0 ||
    outcome.captureComplete !== true ||
    !Buffer.isBuffer(outcome.stdout) ||
    !Buffer.isBuffer(outcome.stderr)
  ) {
    throw new GitBytesProcessFault(args, outcome);
  }
  return Buffer.from(outcome.stdout);
}

export function runGitBytes(input) {
  return executeGitBytes(input, runBoundedProcessBytes);
}

/** Explicitly test-only bounded-process outcome injection. */
export function runGitWithProcessRunnerForTesting(input, processRunner) {
  if (typeof processRunner !== "function") {
    throw new TypeError("test process runner must be a function");
  }
  return executeGit(input, processRunner);
}

/** Explicitly test-only bounded-byte-process outcome injection. */
export function runGitBytesWithProcessRunnerForTesting(input, processRunner) {
  if (typeof processRunner !== "function") {
    throw new TypeError("test process runner must be a function");
  }
  return executeGitBytes(input, processRunner);
}
