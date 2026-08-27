import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { canonicalJson, canonicalSha256 } from "../routing/features.mjs";

const compiler = "/usr/bin/x86_64-linux-gnu-gcc-13";
const helperSource = fileURLToPath(
  new URL("./native-snapshot-helper.c", import.meta.url),
);
const digestPattern = /^[0-9a-f]{64}$/u;
const safeAbsolute = /^\/(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\0]+$/u;
const safeRelative = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)[^\0]+$/u;
const MAX_CONTROLLER_OUTPUT_BYTES = 256 * 1024;
const MAX_HELPER_SOURCE_BYTES = 1024 * 1024;
const MAX_HELPER_BINARY_BYTES = 4 * 1024 * 1024;
const liveHelpers = new WeakMap();

export class G17NativeSnapshotFault extends Error {
  constructor(classification, phase, reason, cause) {
    super(`G1.7 native snapshot ${phase}/${classification}: ${reason}`, { cause });
    this.name = "G17NativeSnapshotFault";
    this.classification = classification;
    this.phase = phase;
    this.reason = reason;
  }
}

function fail(classification, phase, reason, cause) {
  throw new G17NativeSnapshotFault(classification, phase, reason, cause);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail("FAIL", "preflight", `${label} must be a plain object`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  if (!isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort())) {
    fail("FAIL", "preflight", `${label} fields are not exact`);
  }
}

function metadataIdentity(metadata) {
  return Object.freeze({
    device: metadata.dev.toString(),
    inode: metadata.ino.toString(),
    mode: metadata.mode.toString(),
    links: metadata.nlink.toString(),
    size: metadata.size.toString(),
    modifiedNs: metadata.mtimeNs.toString(),
    changedNs: metadata.ctimeNs.toString(),
  });
}

function contained(parent, candidate) {
  const child = relative(parent, candidate);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`));
}

function splitSnapshotPath(path, label) {
  if (typeof path !== "string" || !safeAbsolute.test(path) || resolve(path) !== path) {
    fail("FAIL", "preflight", `${label} is not a canonical absolute path`);
  }
  const parent = dirname(path);
  const name = basename(path);
  if (!safeRelative.test(name) || name.includes("/") || Buffer.byteLength(name) > 255) {
    fail("FAIL", "preflight", `${label} leaf name is unsafe`);
  }
  return Object.freeze({ path, parent, name });
}

async function openPinnedDirectory(path, label) {
  let handle;
  try {
    const [resolvedBefore, before] = await Promise.all([
      realpath(path),
      lstat(path, { bigint: true }),
    ]);
    if (resolvedBefore !== path || before.isSymbolicLink() || !before.isDirectory()) {
      fail("FAIL", "preflight", `${label} is not a real canonical directory`);
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
    const expected = metadataIdentity(before);
    if (
      resolvedAfter !== path ||
      !opened.isDirectory() ||
      !isDeepStrictEqual(metadataIdentity(opened), expected) ||
      !isDeepStrictEqual(metadataIdentity(after), expected)
    ) {
      fail("FAIL", "preflight", `${label} changed while it was pinned`);
    }
    return Object.freeze({ handle, identity: expected, path });
  } catch (error) {
    await handle?.close();
    if (error instanceof G17NativeSnapshotFault) throw error;
    fail(
      error?.code === "ENOENT" ? "MISSING" : "FAIL",
      "preflight",
      `${label} could not be pinned`,
      error,
    );
  }
}

async function boundedBytes(path, maximumBytes, label) {
  let descriptor;
  try {
    descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await descriptor.stat({ bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maximumBytes)) {
      fail("FAIL", "attest", `${label} is not a bounded regular file`);
    }
    const bytes = await descriptor.readFile();
    const after = await descriptor.stat({ bigint: true });
    if (
      bytes.length !== Number(before.size) ||
      !isDeepStrictEqual(metadataIdentity(before), metadataIdentity(after))
    ) {
      fail("FAIL", "attest", `${label} changed while read`);
    }
    return Object.freeze({ bytes, identity: metadataIdentity(before) });
  } catch (error) {
    if (error instanceof G17NativeSnapshotFault) throw error;
    fail(
      error?.code === "ENOENT" ? "MISSING" : "FAIL",
      "attest",
      `${label} cannot be read safely`,
      error,
    );
  } finally {
    await descriptor?.close();
  }
}

function appendBounded(chunks, chunk, state, label) {
  state.bytes += chunk.length;
  if (state.bytes > MAX_CONTROLLER_OUTPUT_BYTES) {
    fail("FAIL", "execute", `${label} exceeded its output ceiling`);
  }
  chunks.push(chunk);
}

async function runController({ executable, args, cwd, signal, inherited = [] }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stdout = [];
    const stderr = [];
    const stdoutState = { bytes: 0 };
    const stderrState = { bytes: 0 };
    const child = spawn(executable, args, {
      cwd,
      env: Object.freeze({
        HOME: "/nonexistent",
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin:/bin",
        SOURCE_DATE_EPOCH: "0",
      }),
      signal,
      stdio: ["ignore", "pipe", "pipe", ...inherited],
    });
    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, 120_000);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    child.stdout.on("data", (chunk) => {
      try {
        appendBounded(stdout, chunk, stdoutState, "controller stdout");
      } catch (error) {
        child.kill("SIGKILL");
        finish(() => reject(error));
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        appendBounded(stderr, chunk, stderrState, "controller stderr");
      } catch (error) {
        child.kill("SIGKILL");
        finish(() => reject(error));
      }
    });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code, observedSignal) => finish(() => resolve({
      code,
      signal: observedSignal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
    })));
  });
}

function rawRecord(bytes) {
  return Object.freeze({
    bytes: bytes.length,
    sha256: sha256(bytes),
    base64: bytes.toString("base64"),
  });
}

function validateOutput(value) {
  exactKeys(
    value,
    ["bytes", "directories", "entries", "files", "schema", "symlinks"],
    "snapshot result",
  );
  if (
    value.schema !== "oxigraph.g1.7-openat2-snapshot/v2" ||
    ["bytes", "directories", "entries", "files", "symlinks"].some(
      (key) => !Number.isSafeInteger(value[key]) || value[key] < 0,
    ) ||
    value.entries !== value.directories + value.files + value.symlinks ||
    value.entries < 1
  ) {
    fail("FAIL", "execute", "snapshot helper result is contradictory");
  }
  return Object.freeze(value);
}

export async function buildG17NativeSnapshotHelper(input) {
  exactKeys(input, ["outputDirectory", "signal"], "snapshot helper build input");
  if (
    typeof input.outputDirectory !== "string" ||
    !safeAbsolute.test(input.outputDirectory)
  ) {
    fail("FAIL", "preflight", "snapshot helper output directory is unsafe");
  }
  const outputDirectory = await realpath(input.outputDirectory).catch((error) =>
    fail("MISSING", "preflight", "snapshot helper output directory is absent", error));
  const directory = await lstat(outputDirectory, { bigint: true });
  if (directory.isSymbolicLink() || !directory.isDirectory()) {
    fail("FAIL", "preflight", "snapshot helper output directory is not real");
  }
  const sourceBefore = await boundedBytes(
    helperSource,
    MAX_HELPER_SOURCE_BYTES,
    "snapshot helper source",
  );
  const compilerBefore = await boundedBytes(
    compiler,
    MAX_HELPER_BINARY_BYTES,
    "snapshot helper compiler",
  );
  const executable = `${outputDirectory}/g17-native-snapshot-helper`;
  const version = await runController({
    executable: compiler,
    args: ["--version"],
    cwd: outputDirectory,
    signal: input.signal,
  }).catch((error) => fail("MISSING", "build", "compiler version probe failed", error));
  if (version.code !== 0 || version.signal !== null) {
    fail("STALE", "build", "compiler version probe did not complete");
  }
  const compile = await runController({
    executable: compiler,
    args: [
      "-std=c17",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-fstack-protector-strong",
      "-D_FORTIFY_SOURCE=2",
      "-Wl,-z,relro,-z,now",
      helperSource,
      "-o",
      executable,
    ],
    cwd: outputDirectory,
    signal: input.signal,
  }).catch((error) => fail("MISSING", "build", "snapshot helper compilation failed", error));
  if (compile.code !== 0 || compile.signal !== null) {
    fail("STALE", "build", "snapshot helper compiler rejected the reviewed source");
  }
  await chmod(executable, 0o500);
  const [sourceAfter, compilerAfter, executableEvidence] = await Promise.all([
    boundedBytes(helperSource, MAX_HELPER_SOURCE_BYTES, "snapshot helper source"),
    boundedBytes(compiler, MAX_HELPER_BINARY_BYTES, "snapshot helper compiler"),
    boundedBytes(executable, MAX_HELPER_BINARY_BYTES, "compiled snapshot helper"),
  ]);
  if (
    !sourceBefore.bytes.equals(sourceAfter.bytes) ||
    !compilerBefore.bytes.equals(compilerAfter.bytes) ||
    !isDeepStrictEqual(sourceBefore.identity, sourceAfter.identity) ||
    !isDeepStrictEqual(compilerBefore.identity, compilerAfter.identity)
  ) {
    fail("FAIL", "build", "snapshot helper source or compiler changed during build");
  }
  const handle = await open(executable, constants.O_RDONLY | constants.O_NOFOLLOW);
  const held = await handle.stat({ bigint: true });
  if (!isDeepStrictEqual(metadataIdentity(held), executableEvidence.identity)) {
    await handle.close();
    fail("FAIL", "build", "compiled snapshot helper changed before it was held");
  }
  const base = {
    schema: "oxigraph.g1.7-native-snapshot-helper/v2",
    source: {
      bytes: sourceBefore.bytes.length,
      sha256: sha256(sourceBefore.bytes),
    },
    compiler: {
      path: "/usr/bin/x86_64-linux-gnu-gcc-13",
      executableSha256: sha256(compilerBefore.bytes),
      version: rawRecord(version.stdout),
    },
    compile: {
      argv: [
        "/usr/bin/x86_64-linux-gnu-gcc-13",
        "-std=c17",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-fstack-protector-strong",
        "-D_FORTIFY_SOURCE=2",
        "-Wl,-z,relro,-z,now",
        "native-snapshot-helper.c",
        "-o",
        "g17-native-snapshot-helper",
      ],
      stdout: rawRecord(compile.stdout),
      stderr: rawRecord(compile.stderr),
    },
    executable: {
      bytes: executableEvidence.bytes.length,
      sha256: sha256(executableEvidence.bytes),
      identity: executableEvidence.identity,
    },
  };
  const attestation = Object.freeze({
    ...base,
    sha256: canonicalSha256(base),
  });
  const helper = Object.freeze({
    executable,
    attestation,
  });
  liveHelpers.set(helper, { phase: "live", handle, executableEvidence });
  return helper;
}

export async function snapshotG17NativeNode(input) {
  exactKeys(
    input,
    [
      "helper",
      "source",
      "destination",
      "maxFileBytes",
      "maxBytes",
      "maxEntries",
      "excludes",
      "signal",
    ],
    "snapshot request",
  );
  const state = liveHelpers.get(input.helper);
  if (state?.phase !== "live") fail("FAIL", "preflight", "snapshot helper is not live");
  const source = splitSnapshotPath(input.source, "snapshot source");
  const destination = splitSnapshotPath(input.destination, "snapshot destination");
  if (
    !Number.isSafeInteger(input.maxFileBytes) ||
    input.maxFileBytes < 1 ||
    input.maxFileBytes > 512 * 1024 * 1024 ||
    !Number.isSafeInteger(input.maxBytes) ||
    input.maxBytes < 1 ||
    input.maxFileBytes > input.maxBytes ||
    !Number.isSafeInteger(input.maxEntries) ||
    input.maxEntries < 1 ||
    !Array.isArray(input.excludes) ||
    input.excludes.length > 64 ||
    input.excludes.some((value) => typeof value !== "string" || !safeRelative.test(value)) ||
    new Set(input.excludes).size !== input.excludes.length ||
    !isDeepStrictEqual([...input.excludes].sort(), input.excludes)
  ) {
    fail("FAIL", "preflight", "snapshot request paths, ceilings, or exclusions are invalid");
  }
  if (
    contained(source.path, destination.path) ||
    contained(destination.path, source.path)
  ) {
    fail("FAIL", "preflight", "snapshot source and destination overlap");
  }
  state.phase = "snapshotting";
  let sourceParent;
  let destinationParent;
  try {
    sourceParent = await openPinnedDirectory(source.parent, "snapshot source parent");
    destinationParent = await openPinnedDirectory(
      destination.parent,
      "snapshot destination parent",
    );
    const arguments_ = [
      "--source-name",
      source.name,
      "--destination-name",
      destination.name,
      "--max-file-bytes",
      String(input.maxFileBytes),
      "--max-bytes",
      String(input.maxBytes),
      "--max-entries",
      String(input.maxEntries),
    ];
    for (const exclude of input.excludes) arguments_.push("--exclude", exclude);
    const outcome = await runController({
      executable: "/proc/self/fd/3",
      args: arguments_,
      cwd: "/",
      signal: input.signal,
      inherited: [state.handle.fd, sourceParent.handle.fd, destinationParent.handle.fd],
    }).catch((error) => {
      if (error instanceof G17NativeSnapshotFault) throw error;
      fail("FAIL", "execute", "snapshot helper could not start", error);
    });
    if (outcome.code !== 0 || outcome.signal !== null || outcome.stderr.length !== 0) {
      fail(
        outcome.code === 70 ? "FAIL" : "STALE",
        "execute",
        `snapshot helper failed: ${outcome.stderr.toString("utf8").trim().slice(0, 1_024)}`,
      );
    }
    let value;
    try {
      value = JSON.parse(outcome.stdout);
    } catch (error) {
      fail("FAIL", "execute", `snapshot helper returned invalid JSON: ${error.message}`);
    }
    if (!outcome.stdout.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
      fail("FAIL", "execute", "snapshot helper output is not canonical JSON");
    }
    const raw = validateOutput(value);
    if (raw.bytes > input.maxBytes || raw.entries > input.maxEntries) {
      fail("FAIL", "execute", "snapshot helper result exceeds the requested ceilings");
    }
    return Object.freeze({
      ...raw,
      operation: "copy",
      source: Object.freeze({
        name: source.name,
        parentIdentity: sourceParent.identity,
      }),
      destination: Object.freeze({
        name: destination.name,
        parentIdentity: destinationParent.identity,
      }),
      limits: Object.freeze({
        maxFileBytes: input.maxFileBytes,
        maxBytes: input.maxBytes,
        maxEntries: input.maxEntries,
      }),
    });
  } finally {
    await Promise.allSettled([
      sourceParent?.handle.close(),
      destinationParent?.handle.close(),
    ]);
    if (liveHelpers.get(input.helper) === state && state.phase === "snapshotting") {
      state.phase = "live";
    }
  }
}

export async function verifyG17NativeSnapshotHelper(helper) {
  const state = liveHelpers.get(helper);
  if (state?.phase !== "live") fail("FAIL", "verify", "snapshot helper is not live");
  state.phase = "verifying";
  try {
    const observed = await state.handle.stat({ bigint: true });
    const path = await boundedBytes(
      helper.executable,
      MAX_HELPER_BINARY_BYTES,
      "compiled snapshot helper",
    );
    if (
      !isDeepStrictEqual(metadataIdentity(observed), state.executableEvidence.identity) ||
      !isDeepStrictEqual(path.identity, state.executableEvidence.identity) ||
      sha256(path.bytes) !== helper.attestation.executable.sha256 ||
      helper.attestation.sha256 !== canonicalSha256(
        Object.fromEntries(
          Object.entries(helper.attestation).filter(([key]) => key !== "sha256"),
        ),
      ) ||
      !digestPattern.test(helper.attestation.sha256)
    ) {
      fail("FAIL", "verify", "snapshot helper identity drifted");
    }
    return helper.attestation;
  } finally {
    if (liveHelpers.get(helper) === state && state.phase === "verifying") {
      state.phase = "live";
    }
  }
}

export async function closeG17NativeSnapshotHelper(helper) {
  const state = liveHelpers.get(helper);
  if (state?.phase !== "live") fail("FAIL", "cleanup", "snapshot helper is not live");
  state.phase = "closing";
  liveHelpers.delete(helper);
  await state.handle.close();
}
